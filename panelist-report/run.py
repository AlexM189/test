#!/usr/bin/env python3
"""Build the panelist support executive report.

    python3 run.py                      # uses data/* if present, else sample/*
    python3 run.py path/to/export.xlsx ...
"""
import sys, glob, os
import ingest, analyze, render

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = ("csv", "tsv", "txt", "xlsx", "xls", "xlsm", "pdf", "pptx", "ppt")


def discover():
    for sub in ("data", "sample"):
        found = sorted(sum([glob.glob(os.path.join(HERE, sub, "*." + e)) for e in EXT], []))
        if found:
            return found
    return []


def main(argv):
    paths = sorted(sum([glob.glob(a) for a in argv], [])) if argv else discover()
    if not paths:
        sys.exit("No input files. Drop exports into %s/data/ or pass paths." % HERE)
    print("Reading %d file(s):" % len(paths))
    for p in paths:
        print("   ", os.path.basename(p))
    df, prov = ingest.load_paths(paths)
    if df.empty:
        sys.exit("No case table recognised in the supplied file(s).")
    df, stats = ingest.clean(df)
    res = analyze.run(df)
    out = os.path.join(HERE, "out", "panelist-support-report.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(render.build(res, {"prov": prov, "stats": stats, "file_count": len(paths)}))
    v = res["volume"]
    print("\n  cases        : %d" % v["total_cases"])
    print("  members      : %s" % v["unique_members"])
    print("  date field   : %s%s" % (v["date_field_used"], "  (PROXY - last touch)" if v["date_field_is_proxy"] else ""))
    print("  coverage     : %s -> %s (%d month[s])" % (v["date_min"], v["date_max"], v["months_spanned"]))
    print("  buckets      : %s" % ", ".join("%s %d" % (r["label"], r["count"]) for r in v["bucket"]["rows"]))
    print("  labels       : %d distinct, %d unmapped" % (res["mapping"]["distinct"], res["mapping"]["unmapped_count"]))
    print("  forecast     : %s" % res["forecast"]["method"])
    print("\nWrote %s (%.1f KB)" % (out, os.path.getsize(out) / 1024))


if __name__ == "__main__":
    main(sys.argv[1:])
