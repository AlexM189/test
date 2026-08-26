"""Derive categories, buckets and every statistic the report needs.
Hard rule: anything that cannot be computed from the data returns a
`not_computable` record naming the missing field - never an estimate."""
import re, math, itertools, json, os
from collections import Counter, defaultdict
import pandas as pd

RULES = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "rules.json")))
MIN_CASES_LIFT  = RULES["gates"]["min_cases_lift"]
MIN_COOCCUR     = RULES["gates"]["min_cooccurrence"]
MIN_PERIODS_FIT = RULES["gates"]["min_periods_fit"]
BUCKET_RULES    = [(n, p) for n, p in RULES["bucket_rules"]]
BUCKETS         = [b for b, _ in BUCKET_RULES] + ["Other / Unmapped"]
SIGNALS         = RULES["signals"]
SUBJECT_RULES   = [(n, p) for n, p in RULES["subject_rules"]]
TOP_DRIVERS     = RULES["gates"]["top_drivers"]
VARIOUS         = RULES["various_label"]
ANOM            = RULES["anomaly"]
UNMAPPED        = "Other / Unmapped"

_ws = lambda s: re.sub(r"\s+", " ", str(s or "")).strip()


def split_tags(cell):
    """Category cell -> ordered list of tags. First tag is the primary category."""
    if not cell:
        return []
    parts = [_ws(p) for p in str(cell).split(",")]
    return [p for p in parts if p]


def bucket_of(tag):
    t = str(tag).lower()
    for name, pat in BUCKET_RULES:
        if re.search(pat, t):
            return name
    return "Other / Unmapped"


def bucket_from_subject(subject):
    """Fallback when the Category field is blank or its primary label matches no
    bucket rule: read the intent off the subject line instead. Returns
    (bucket, matched_keyword) or (None, None). Only the matched keyword is ever
    surfaced - never the subject text itself, which can carry identifying detail."""
    t = _ws(subject).lower()
    if not t:
        return None, None
    for name, pat in SUBJECT_RULES:
        m = re.search(pat, t)
        if m:
            return name, _ws(m.group(0))[:40]
    return None, None


def derive(df):
    df = df.copy()
    df["tags"] = df.get("category", "").apply(split_tags)
    df["primary_category"] = df["tags"].apply(lambda t: t[0] if t else "")
    df["bucket"] = df["primary_category"].apply(lambda t: bucket_of(t) if t else UNMAPPED)
    df["bucket_source"] = "category"
    df["inferred_keyword"] = ""
    # anything the category field could not place gets a second pass over the subject
    needs = df["bucket"] == UNMAPPED
    if needs.any() and "subject" in df:
        got = df.loc[needs, "subject"].apply(bucket_from_subject)
        df.loc[needs, "bucket"] = [b if b else UNMAPPED for b, _ in got]
        df.loc[needs, "bucket_source"] = ["subject" if b else "none" for b, _ in got]
        df.loc[needs, "inferred_keyword"] = [k or "" for _, k in got]
    elif needs.any():
        df.loc[needs, "bucket_source"] = "none"
    df["tag_count"] = df["tags"].apply(len)
    # signal flags evaluated over the whole tag list + subject (never the description body)
    hay = df.apply(lambda r: (" | ".join(r["tags"]) + " | " + str(r.get("subject", ""))).lower(), axis=1)
    for sig, pat in SIGNALS.items():
        df["sig_" + sig] = hay.str.contains(pat, regex=True, na=False)
    # best available date
    date_col = "created_on" if ("created_on" in df and df["created_on"].notna().any()) else \
               ("modified_on" if "modified_on" in df else None)
    df["_date"] = df[date_col] if date_col else pd.NaT
    return df, date_col


def _nc(reason, needs):
    return {"computable": False, "reason": reason, "needs": needs}


def pct(n, d):
    return round(100.0 * n / d, 1) if d else 0.0


# ------------------------------------------------------------------ sections
def volume_section(df, date_col):
    n = len(df)
    out = {"total_cases": n}
    out["unique_members"] = int(df["mno"].nunique()) if "mno" in df else None
    out["date_field_used"] = date_col
    out["date_field_is_proxy"] = (date_col == "modified_on")
    if df["_date"].notna().any():
        out["date_min"] = str(df["_date"].min().date())
        out["date_max"] = str(df["_date"].max().date())
        out["months_spanned"] = int(df["_date"].dt.to_period("M").nunique())
    else:
        out["date_min"] = out["date_max"] = None
        out["months_spanned"] = 0

    def dist(col):
        if col not in df or not df[col].astype(str).str.strip().any():
            return _nc(f"column '{col}' absent or empty", [col])
        vc = df[col].replace("", "(blank)").value_counts()
        return {"computable": True,
                "rows": [{"label": k, "count": int(v), "pct": pct(int(v), n)} for k, v in vc.items()]}

    out["origin"]   = dist("case_origin")
    out["bucket"]   = {"computable": True, "rows": [
        {"label": k, "count": int(v), "pct": pct(int(v), n)}
        for k, v in df["bucket"].value_counts().items()]}
    out["primary_raw"] = {"computable": True, "rows": [
        {"label": k, "count": int(v), "pct": pct(int(v), n)}
        for k, v in df["primary_category"].replace("", "(blank)").value_counts().head(25).items()]}
    out["member_status"] = dist("member_status")
    out["case_status"]   = dist("case_status")
    out["site"]  = dist("site")  if "site"  in df else _nc("no office/site column in the export", ["site / office"])
    out["agent"] = dist("agent") if "agent" in df else _nc("no agent/owner column in the export", ["agent / owner"])

    # tag load (multi-label view, denominator = cases)
    tags = Counter(t for lst in df["tags"] for t in lst)
    out["tag_load"] = {"total_tags": int(df["tag_count"].sum()),
                       "mean_tags_per_case": round(float(df["tag_count"].mean()), 2) if n else 0,
                       "multi_tag_cases": int((df["tag_count"] > 1).sum()),
                       "multi_tag_pct": pct(int((df["tag_count"] > 1).sum()), n),
                       "distinct_tags": len(tags),
                       "top": [{"label": k, "count": v, "pct_of_cases": pct(v, n)}
                               for k, v in tags.most_common(20)]}

    # origin x bucket cross-tab
    if isinstance(out["origin"], dict) and out["origin"].get("computable"):
        ct = pd.crosstab(df["case_origin"].replace("", "(blank)"), df["bucket"])
        # order rows and columns by volume, so the cross-tab reads in the same
        # order as the donut, the legend and the distribution tables
        ct = ct.reindex(index=[r["label"] for r in out["origin"]["rows"] if r["label"] in ct.index],
                        columns=[r["label"] for r in out["bucket"]["rows"] if r["label"] in ct.columns])
        out["crosstab"] = {"computable": True,
                           "origins": list(ct.index),
                           "buckets": list(ct.columns),
                           "matrix": ct.values.tolist(),
                           "row_totals": ct.sum(axis=1).tolist(),
                           "col_totals": ct.sum(axis=0).tolist()}
    else:
        out["crosstab"] = _nc("origin column unavailable", ["case_origin"])

    # month-over-month movement
    if out["months_spanned"] >= 2:
        per = df.dropna(subset=["_date"]).copy()
        per["m"] = per["_date"].dt.to_period("M").astype(str)
        months = sorted(per["m"].unique())
        out["monthly"] = {"computable": True, "months": months,
                          "total": [int((per["m"] == m).sum()) for m in months],
                          "by_bucket": {b: [int(((per["m"] == m) & (per["bucket"] == b)).sum())
                                            for m in months]
                                        for b in per["bucket"].unique()},
                          "by_origin": ({o: [int(((per["m"] == m) & (per["case_origin"] == o)).sum())
                                             for m in months]
                                         for o in per["case_origin"].unique()}
                                        if "case_origin" in per else {})}
    else:
        out["monthly"] = _nc(
            f"data spans {out['months_spanned']} month(s); at least 2 needed for growth/decline",
            ["a date column covering 2+ months"])
    return out


def _lift(df, a, b):
    """P(B|A) vs P(B) for two boolean signal columns."""
    n = len(df)
    na, nb = int(df[a].sum()), int(df[b].sum())
    joint = int((df[a] & df[b]).sum())
    base = nb / n if n else 0
    cond = joint / na if na else 0
    return {"n": n, "n_a": na, "n_b": nb, "joint": joint,
            "pct_of_a_with_b": round(100 * cond, 1),
            "base_rate_b": round(100 * base, 1),
            "lift": round(cond / base, 2) if base else None}


def correlation_section(df):
    n = len(df)
    res = {"gate": {"min_cases": MIN_CASES_LIFT, "min_cooccurrence": MIN_COOCCUR, "n": n}}
    has_member = "mno" in df and df["mno"].astype(str).str.strip().any()

    def chain(key, title, a, b, extra_missing=None, note=""):
        missing = list(extra_missing or [])
        if n < MIN_CASES_LIFT:
            res[key] = {"title": title, **_nc(
                f"only {n} case(s) loaded; {MIN_CASES_LIFT}+ needed before a co-occurrence rate is meaningful",
                missing or ["a larger export"]), "note": note}
            return
        r = _lift(df, "sig_" + a, "sig_" + b)
        if r["joint"] < MIN_COOCCUR:
            res[key] = {"title": title, **_nc(
                f"only {r['joint']} case(s) carry both signals; {MIN_COOCCUR}+ needed", missing),
                "note": note, "raw": r}
            return
        lf = r["lift"] or 0
        if lf >= 1.5:   verdict = ("supported", "Strongly supported")
        elif lf >= 1.2: verdict = ("supported", "Supported")
        elif lf >= 0.9: verdict = ("none", "No meaningful association")
        else:           verdict = ("inverse", "Inverse association")
        res[key] = {"title": title, "computable": True, "missing_fields": missing,
                    "note": note, "verdict": verdict[0], "verdict_text": verdict[1], **r}

    chain("chain_hw_inactivity", "Hardware/meter instability → activity & reactivation contact",
          "hardware_meter", "activity",
          note="Purge outcome requires a purged/inactive value in Member Status; "
               "case-level data alone cannot confirm an involuntary purge.")
    chain("chain_reward_dupes", "Blocked rewards → repeat contact → outbound/callback load",
          "blocked_reward", "outbound_cb",
          extra_missing=[] if has_member else ["MNO (to link repeat contacts)"],
          note="Bounced-email evidence needs an email-status or bounce field; not present in the "
               "columns seen so far.")
    chain("chain_google_lockout", "Google account migration → access lockout",
          "google_account", "password_access",
          extra_missing=["member type / household role (primary vs secondary)"],
          note="Secondary-member lockout and household attrition are NOT computable without a "
               "member-type or household-link field.")
    chain("chain_field_service", "Field service / shipping → onboarding & setup contact",
          "appointment", "setup",
          extra_missing=["enrollment or join date (for 30/60/90-day tenure)"],
          note="Early-life churn is NOT computable without an enrollment date; tenure cannot be "
               "derived from case dates alone.")

    # repeat-contact behaviour
    if has_member:
        vc = df["mno"].value_counts()
        repeat = int((vc > 1).sum())
        res["repeat_contact"] = {"computable": True,
                                 "members": int(vc.size),
                                 "members_with_multiple_cases": repeat,
                                 "pct_members_repeat": pct(repeat, int(vc.size)),
                                 "cases_from_repeat_members": int(vc[vc > 1].sum()),
                                 "pct_cases_from_repeat": pct(int(vc[vc > 1].sum()), n),
                                 "max_cases_one_member": int(vc.max())}
    else:
        res["repeat_contact"] = _nc("no member identifier column", ["MNO"])

    # open discovery: strongest signal pairs beyond the four hypotheses
    if n >= MIN_CASES_LIFT:
        pairs = []
        cols = ["sig_" + s for s in SIGNALS]
        for a, b in itertools.combinations(cols, 2):
            r = _lift(df, a, b)
            if not (r["joint"] >= MIN_COOCCUR and r["lift"] and r["lift"] > 1):
                continue
            # perfect containment means one signal's definition subsumes the other:
            # tautological, not an empirical relationship
            if r["joint"] == r["n_a"] or r["joint"] == r["n_b"]:
                continue
            pairs.append({"a": a[4:], "b": b[4:], **r})
        pairs.sort(key=lambda x: (-x["lift"], -x["joint"]))
        res["discovered"] = {"computable": True, "pairs": pairs[:12]}
    else:
        res["discovered"] = _nc(
            f"only {n} case(s); pairwise scanning needs {MIN_CASES_LIFT}+ to avoid spurious pairs",
            ["a larger export"])
    return res


def forecast_section(vol, df):
    """Fit monthly volume, then roll forward into real calendar quarters.

    A quarter that is only partly observed is completed with fitted months and
    flagged, so the projection never silently double-counts observed volume and
    never collides with a partial bar in the history line."""
    monthly = vol.get("monthly", {})
    if not monthly.get("computable") or len(monthly.get("months", [])) < MIN_PERIODS_FIT:
        got = len(monthly.get("months", [])) if monthly.get("computable") else vol.get("months_spanned", 0)
        return {"method": "not_fitted", "computable": False,
                "reason": (f"data covers {got} period(s); a fitted trend needs {MIN_PERIODS_FIT}+ "
                           f"historical months. No directional estimate is produced here because "
                           f"the category mix at this sample size is not representative."),
                "needs": ["a date column spanning 3+ months"]}

    months, y = monthly["months"], monthly["total"]
    k = len(y)
    xbar, ybar = (k - 1) / 2, sum(y) / k
    sxx = sum((i - xbar) ** 2 for i in range(k))
    slope = sum((i - xbar) * (y[i] - ybar) for i in range(k)) / sxx if sxx else 0
    icpt = ybar - slope * xbar
    resid = [y[i] - (icpt + slope * i) for i in range(k)]
    sd = math.sqrt(sum(r * r for r in resid) / max(k - 2, 1))

    obs = {pd.Period(m, freq="M"): y[i] for i, m in enumerate(months)}
    idx_of = {pd.Period(m, freq="M"): i for i, m in enumerate(months)}
    last_m = pd.Period(months[-1], freq="M")

    # observed history: only calendar quarters whose three months are all present
    hist = []
    for q in sorted({m.asfreq("Q") for m in obs}):
        qm = [q.asfreq("M", "s") + j for j in range(3)]
        if all(m in obs for m in qm):
            hist.append({"label": str(q), "point": int(sum(obs[m] for m in qm))})

    # forward quarters: start at the quarter holding the first unobserved month
    first_future = last_m + 1
    q0 = first_future.asfreq("Q")
    qs = []
    for step in range(4):
        q = q0 + step
        qm = [q.asfreq("M", "s") + j for j in range(3)]
        pt = 0.0
        fitted_var = 0
        n_obs = 0
        for m in qm:
            if m in obs:
                pt += obs[m]; n_obs += 1
            else:
                pt += max(icpt + slope * (idx_of.get(m) if m in idx_of else
                                          k - 1 + (m - last_m).n), 0)
                fitted_var += 1
        band = 1.96 * sd * math.sqrt(fitted_var) if fitted_var else 0.0
        qs.append({"label": str(q), "point": int(round(pt)),
                   "low": int(round(max(pt - band, 0))), "high": int(round(pt + band)),
                   "observed_months": n_obs, "fitted_months": fitted_var,
                   "partial": n_obs > 0})
    return {"method": "ols_linear_on_monthly_volume", "computable": True, "history": hist,
            "months_fitted": k, "slope_cases_per_month": round(slope, 2),
            "intercept": round(icpt, 2), "residual_sd": round(sd, 2),
            "quarters": qs,
            "partial_note": any(q["partial"] for q in qs),
            "caveat": ("Mix is held at the observed share for each bucket.")
                      + (" Fitted on Modified On, which records last touch rather than case arrival."
                         if vol.get("date_field_is_proxy") else "")}


def inference_audit(df):
    """How each case got its bucket, and on what evidence."""
    n = len(df)
    src = df["bucket_source"].value_counts().to_dict()
    from_cat = int(src.get("category", 0))
    from_sub = int(src.get("subject", 0))
    none = int(src.get("none", 0))
    rows = []
    if from_sub:
        sub = df[df["bucket_source"] == "subject"]
        for (b, kw), c in sub.groupby(["bucket", "inferred_keyword"]).size().items():
            rows.append({"bucket": b, "keyword": kw, "count": int(c)})
        rows.sort(key=lambda r: (-r["count"], r["bucket"], r["keyword"]))
    by_bucket = []
    if from_sub:
        for b, c in df[df["bucket_source"] == "subject"]["bucket"].value_counts().items():
            by_bucket.append({"label": b, "count": int(c), "pct": pct(int(c), from_sub)})
    return {"total": n, "from_category": from_cat, "from_subject": from_sub,
            "unresolved": none,
            "pct_from_subject": pct(from_sub, n), "pct_unresolved": pct(none, n),
            "keywords": rows[:40], "by_bucket": by_bucket}


def top_drivers(V):
    """Top N named buckets plus one rolled-up row - the exec-summary call drivers."""
    rows = V["bucket"]["rows"]
    head = [dict(r, rank=i + 1) for i, r in enumerate(rows[:TOP_DRIVERS])]
    tail = rows[TOP_DRIVERS:]
    if tail:
        head.append({"rank": len(head) + 1, "label": VARIOUS,
                     "count": sum(r["count"] for r in tail),
                     "pct": round(sum(r["pct"] for r in tail), 1),
                     "rolled": [r["label"] for r in tail]})
    return head


def _plabel(p, freq):
    """Readable period label: 2026-W30 for weeks, 2026-06 for months."""
    if freq == "W":
        iso = p.start_time.isocalendar()
        return "%d-W%02d" % (iso[0], iso[1])
    return str(p)


def _series(df, freq):
    """Complete calendar periods only - a partial first or last period would
    read as a collapse in volume that never happened."""
    d = df.dropna(subset=["_date"])
    if d.empty:
        return [], {}
    lo, hi = d["_date"].min().normalize(), d["_date"].max().normalize()
    per = d["_date"].dt.to_period(freq)
    keys, counts = [], {}
    for k in sorted(per.unique()):
        if k.start_time.normalize() >= lo and k.end_time.normalize() <= hi:
            lab = _plabel(k, freq)
            keys.append(lab)
            counts[lab] = int((per == k).sum())
    return keys, counts


def _bucket_series(df, freq, keys, buckets):
    d = df.dropna(subset=["_date"]).copy()
    d["_p"] = d["_date"].dt.to_period(freq).map(lambda p: _plabel(p, freq))
    return {b: [int(((d["_p"] == k) & (d["bucket"] == b)).sum()) for k in keys] for b in buckets}


def anomaly_section(df, V):
    """Week-over-week and month-over-month movement, with anything unusual flagged.
    A move must clear a percentage AND an absolute-case threshold to be reported."""
    out = {"alerts": [], "weekly": None, "monthly": None}
    if not df["_date"].notna().any():
        out.update(_nc("no usable date column, so no period comparison is possible",
                       ["a date column"]))
        return out

    def block(freq, label):
        keys, counts = _series(df, freq)
        if len(keys) < 2:
            return {"computable": False, "periods": len(keys), "label": label,
                    "reason": f"only {len(keys)} complete {label}(s) in range; 2+ needed"}
        vals = [counts[k] for k in keys]
        cur, prev = vals[-1], vals[-2]
        chg = cur - prev
        pc = round(100.0 * chg / prev, 1) if prev else None
        b = {"computable": True, "label": label, "keys": keys, "values": vals,
             "current": cur, "previous": prev, "change": chg, "pct_change": pc,
             "current_key": keys[-1], "previous_key": keys[-2]}
        if len(vals) >= ANOM["min_periods_for_z"]:
            hist = vals[:-1]
            mu = sum(hist) / len(hist)
            var = sum((v - mu) ** 2 for v in hist) / max(len(hist) - 1, 1)
            sd = math.sqrt(var)
            b["mean_prior"] = round(mu, 1)
            b["z"] = round((cur - mu) / sd, 2) if sd else None
        return b

    wk = block("W", "week")
    mo = block("M", "month")
    out["weekly"], out["monthly"] = wk, mo

    def flag(b):
        if not b.get("computable") or b.get("pct_change") is None:
            return
        pc, chg = b["pct_change"], b["change"]
        if abs(pc) >= ANOM["pct_threshold"] and abs(chg) >= ANOM["min_abs_change"]:
            out["alerts"].append({
                "level": "up" if chg > 0 else "down", "scope": "total",
                "text": f"Total volume {'rose' if chg > 0 else 'fell'} {abs(pc):.1f}% "
                        f"{'to' if chg > 0 else 'to'} {b['current']} cases in {b['current_key']}, "
                        f"from {b['previous']} in {b['previous_key']} "
                        f"({chg:+d} cases {b['label']}-over-{b['label']})."})
        z = b.get("z")
        if z is not None and abs(z) >= ANOM["z_threshold"] and abs(chg) >= ANOM["min_abs_change"]:
            out["alerts"].append({
                "level": "up" if z > 0 else "down", "scope": "total",
                "text": f"{b['current_key']} sits {abs(z):.1f} standard deviations "
                        f"{'above' if z > 0 else 'below'} the mean of the preceding "
                        f"{len(b['values']) - 1} {b['label']}s ({b['mean_prior']} cases)."})

    flag(wk)
    flag(mo)

    # which category moved, not just how much
    for b in (mo, wk):
        if not b.get("computable"):
            continue
        names = [r["label"] for r in V["bucket"]["rows"][:TOP_DRIVERS + 2]]
        ser = _bucket_series(df, "M" if b["label"] == "month" else "W", b["keys"], names)
        for name in names:
            v = ser[name]
            cur, prev = v[-1], v[-2]
            chg = cur - prev
            if not prev:
                continue
            pc = 100.0 * chg / prev
            if abs(pc) >= ANOM["bucket_pct_threshold"] and abs(chg) >= ANOM["bucket_min_abs"]:
                out["alerts"].append({
                    "level": "up" if chg > 0 else "down", "scope": "bucket",
                    "text": f"{name} {'rose' if chg > 0 else 'fell'} {abs(pc):.0f}% "
                            f"{b['label']}-over-{b['label']} ({prev} to {cur} cases, "
                            f"{b['previous_key']} to {b['current_key']})."})
        break   # report the monthly view when available, else weekly - not both

    return out


def most_received(df, V):
    """Detail on the single largest driver, for the executive summary."""
    if not V["bucket"]["rows"]:
        return None
    top = V["bucket"]["rows"][0]
    sub = df[df["bucket"] == top["label"]]
    labels = [{"label": k, "count": int(v)} for k, v in
              sub["primary_category"].replace("", "(blank)").value_counts().head(3).items()]
    origin = None
    if "case_origin" in sub and sub["case_origin"].astype(str).str.strip().any():
        vc = sub["case_origin"].replace("", "(blank)").value_counts()
        origin = {"label": vc.index[0], "count": int(vc.iloc[0]),
                  "pct": pct(int(vc.iloc[0]), len(sub))}
    return {"label": top["label"], "count": top["count"], "pct": top["pct"],
            "top_labels": labels, "origin": origin,
            "members": int(sub["mno"].nunique()) if "mno" in sub else None}


def mapping_audit(df):
    rows = defaultdict(lambda: {"count": 0, "bucket": ""})
    for lst in df["tags"]:
        for t in lst:
            r = rows[t]; r["count"] += 1; r["bucket"] = bucket_of(t)
    items = [{"label": k, "bucket": v["bucket"], "count": v["count"]} for k, v in rows.items()]
    items.sort(key=lambda x: (x["bucket"], -x["count"]))
    unmapped = [i for i in items if i["bucket"] == "Other / Unmapped"]
    return {"items": items, "distinct": len(items), "unmapped_count": len(unmapped)}


def run(df):
    df, date_col = derive(df)
    vol = volume_section(df, date_col)
    return {"volume": vol,
            "correlation": correlation_section(df),
            "forecast": forecast_section(vol, df),
            "mapping": mapping_audit(df),
            "inference": inference_audit(df),
            "drivers": top_drivers(vol),
            "anomaly": anomaly_section(df, vol),
            "most_received": most_received(df, vol),
            "buckets": BUCKETS}
