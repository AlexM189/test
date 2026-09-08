"""Load panelist support case exports from CSV/TSV/XLSX/PDF/PPTX into one normalised frame."""
import re, sys, glob, os, json
import pandas as pd

# ---------------------------------------------------------------- column aliases
RULES = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "rules.json")))
ALIASES = RULES["aliases"]

_norm = lambda s: re.sub(r"[^a-z0-9]", "", str(s).lower())


def map_columns(cols):
    """Return {raw_col: canonical} plus the list of unmapped raw columns.

    Two passes on purpose. An exact header match always beats a substring one, so a
    sheet carrying both "Category" and "Category Count" maps Category and leaves the
    count alone - a single greedy pass would let whichever came first win and feed
    the analysis a column of numbers."""
    lookup = {}
    for canon, alist in ALIASES.items():
        for a in alist:
            lookup.setdefault(a, canon)

    final, claimed, unmapped = {}, set(), []
    norms = [(c, _norm(c)) for c in cols]

    # pass 1: exact header matches
    for c, n in norms:
        canon = lookup.get(n)
        if canon and canon not in claimed:
            claimed.add(canon); final[c] = canon

    # pass 2: substring fallback, only for fields nothing matched exactly
    for c, n in norms:
        if c in final:
            continue
        hit = None
        for a, canon in lookup.items():
            if len(a) >= 5 and a in n and canon not in claimed:
                if hit is None or len(a) > len(hit[0]):
                    hit = (a, canon)
        if hit:
            claimed.add(hit[1]); final[c] = hit[1]

    for c, _n in norms:
        if c not in final and str(c).strip() != "":
            unmapped.append(c)
    return final, unmapped


# ---------------------------------------------------------------- readers
def _read_csv(p):
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        for sep in (",", "\t", ";", "|"):
            try:
                df = pd.read_csv(p, encoding=enc, sep=sep, dtype=str,
                                 keep_default_na=False, engine="python")
                if df.shape[1] > 1:
                    return [df]
            except Exception:
                continue
    return []


def _read_excel(p):
    out = []
    for name, df in pd.read_excel(p, sheet_name=None, dtype=str).items():
        df = df.fillna("")
        if df.shape[0] and df.shape[1] > 1:
            df.attrs["sheet"] = name
            out.append(df)
    return out


def _tables_to_frames(tables):
    out = []
    for t in tables:
        rows = [[("" if c is None else str(c).replace("\n", " ").strip()) for c in r] for r in t if r]
        if len(rows) < 2:
            continue
        hdr, body = rows[0], rows[1:]
        width = len(hdr)
        body = [r[:width] + [""] * (width - len(r)) for r in body]
        out.append(pd.DataFrame(body, columns=hdr))
    return out


def _read_pdf(p):
    import pdfplumber
    tables = []
    with pdfplumber.open(p) as pdf:
        for page in pdf.pages:
            tables.extend(page.extract_tables() or [])
    return _tables_to_frames(tables)


def _read_pptx(p):
    from pptx import Presentation
    tables = []
    for slide in Presentation(p).slides:
        for shp in slide.shapes:
            if shp.has_table:
                tables.append([[c.text for c in row.cells] for row in shp.table.rows])
    return _tables_to_frames(tables)


READERS = {".csv": _read_csv, ".tsv": _read_csv, ".txt": _read_csv,
           ".xlsx": _read_excel, ".xls": _read_excel, ".xlsm": _read_excel,
           ".pdf": _read_pdf, ".pptx": _read_pptx, ".ppt": _read_pptx}


def load_paths(paths):
    """Read every file, normalise headers, concatenate. Returns (frame, provenance)."""
    frames, prov = [], []
    for p in paths:
        ext = os.path.splitext(p)[1].lower()
        rd = READERS.get(ext)
        if not rd:
            prov.append({"file": os.path.basename(p), "status": "skipped - unsupported type",
                         "rows": 0, "unmapped": []}); continue
        try:
            raws = rd(p)
        except Exception as e:
            prov.append({"file": os.path.basename(p), "status": f"read error: {e}",
                         "rows": 0, "unmapped": []}); continue
        if not raws:
            prov.append({"file": os.path.basename(p), "status": "no table found",
                         "rows": 0, "unmapped": []}); continue
        for df in raws:
            mapping, unmapped = map_columns(df.columns)
            if "category" not in mapping.values() and "case_origin" not in mapping.values():
                continue                                   # not a case table
            sub = df[list(mapping)].rename(columns=mapping).copy()
            sub["_source_file"] = os.path.basename(p)
            sub["_source_sheet"] = df.attrs.get("sheet", "")
            # the row number as Excel shows it, so a cleanup list can point at the
            # exact line to fix rather than describing it
            sub["_source_row"] = range(2, len(sub) + 2)
            frames.append(sub)
            prov.append({"file": os.path.basename(p),
                         "sheet": df.attrs.get("sheet", ""),
                         "status": "loaded", "rows": len(sub),
                         "mapped": sorted(set(mapping.values())),
                         # which header actually fed each field, so a wrong column shows
                         "headers": sorted((v, str(k)) for k, v in mapping.items()),
                         "unmapped": unmapped})
    if not frames:
        return pd.DataFrame(), prov
    out = pd.concat(frames, ignore_index=True, sort=False)
    return out, prov


def clean(df):
    """Type-coerce, trim, drop exact duplicate rows."""
    if df.empty:
        return df, {}
    for c in df.columns:
        if df[c].dtype == object:
            df[c] = df[c].astype(str).str.replace(r"\s+", " ", regex=True).str.strip()
            df[c] = df[c].replace({"nan": "", "None": "", "NaT": ""})
    for c in ("created_on", "modified_on", "closed_on", "enrolled_on"):
        if c in df:
            df[c] = pd.to_datetime(df[c], errors="coerce", format="mixed")
    before = len(df)
    key = [c for c in ("mno", "case_origin", "modified_on", "subject", "category") if c in df]
    if key:
        df = df.drop_duplicates(subset=key).reset_index(drop=True)
    return df, {"rows_read": before, "rows_after_dedupe": len(df),
                "exact_duplicates_removed": before - len(df)}


if __name__ == "__main__":
    paths = sorted(sum([glob.glob(a) for a in sys.argv[1:]], []))
    d, pv = load_paths(paths)
    d, st = clean(d)
    print(pv); print(st); print(d.head())
