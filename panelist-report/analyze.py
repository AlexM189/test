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
DRIVER_RULES    = [(n, p) for n, p in RULES["driver_rules"]]
DRIVERS         = RULES["drivers"]
BUCKETS         = DRIVERS + ["Other / Unmapped"]
_catnorm        = lambda s: re.sub(r"\s*/\s*", "/", re.sub(r"\s+", " ", str(s or ""))).strip().lower()
CATEGORY_MAP    = {_catnorm(k): v for k, v in RULES["category_map"].items()}
KB_NAMES        = {_catnorm(k): k for k in RULES["category_map"]}
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
    """Driver for a category label. Exact match against the KB category list wins;
    only a label the KB does not contain falls through to the ordered rules."""
    return bucket_src(tag)[0]


def bucket_src(tag):
    """(driver, source) where source is 'kb', 'rule' or 'none'."""
    key = _catnorm(tag)
    if not key:
        return "Other / Unmapped", "none"
    hit = CATEGORY_MAP.get(key)
    if hit:
        return hit, "kb"
    for name, pat in DRIVER_RULES:
        if re.search(pat, key, re.I):
            return name, "rule"
    return "Other / Unmapped", "none"


def is_junk_label(tag):
    """Labels that carry no reportable meaning - pure numbers, single characters,
    placeholders. These are a data-entry problem, not a category."""
    t = _ws(tag)
    if not t:
        return True
    if re.fullmatch(r"[\d.,;:_\-/\s]+", t):
        return True
    if len(t) <= 2:
        return True
    return t.lower() in {"n/a", "na", "none", "null", "other", "test", "tbd", "-", "--", "."}


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
    src = df["primary_category"].apply(lambda t: bucket_src(t) if t else (UNMAPPED, "none"))
    df["bucket"] = [b for b, _ in src]
    df["bucket_source"] = [s2 if s2 != "none" else "none" for _, s2 in src]
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

    chain("chain_hw_inactivity", "Meter / hardware problems → participation & activity doubt",
          "hardware_meter", "activity", [],
          "Whether an activity gap became an involuntary purge needs a panelist status "
          "history; case data alone cannot confirm the outcome.")
    chain("chain_activity_withdraw", "Participation & activity doubt → withdrawal or suspension",
          "activity", "withdrawal", [],
          "Co-occurrence within a case, not a sequence over time. A created-date field would "
          "let this be tested as an ordered progression instead.")
    chain("chain_reward_dupes", "Blocked or missing rewards → outbound / callback load",
          "blocked_reward", "outbound_cb", [] if has_member else ["MNO (to link repeat contacts)"],
          "Repeat-contact linkage below sizes how much of this is the same panelist calling again.")
    chain("chain_bounce_withdraw", "Email deliverability failure → withdrawal",
          "email_bounce", "withdrawal", [],
          "The category list itself links these ('Email Bounce/Wrong address/Last attempt before "
          "Withdrawal', 'Withdraw/Household/Initial email bounced'), so the measured rate below "
          "is the check on how often that path is actually travelled.")
    chain("chain_google_lockout", "Google account migration → access lockout",
          "google_account", "password_access", ["member type / household role (primary vs secondary)"],
          "Secondary-member lockout and household attrition are NOT computable without a "
          "member-type or household-link field.")
    chain("chain_field_service", "Install appointment / field service → onboarding contact",
          "appointment", "setup", ["enrollment or join date (for 30/60/90-day tenure)"],
          "Early-life churn is NOT computable without an enrollment date; tenure cannot be "
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
    from_kb = int(src.get("kb", 0))
    from_rule = int(src.get("rule", 0))
    from_cat = from_kb + from_rule
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
    return {"total": n, "from_category": from_cat, "from_kb": from_kb, "from_rule": from_rule,
            "pct_from_kb": pct(from_kb, n), "pct_from_rule": pct(from_rule, n),
            "from_subject": from_sub, "unresolved": none,
            "pct_from_subject": pct(from_sub, n), "pct_unresolved": pct(none, n),
            "keywords": rows[:40], "by_bucket": by_bucket}


def data_quality(df):
    """Category values in the export that the KB does not contain, plus labels that
    carry no meaning at all. This is the cleanup list, sized."""
    n = len(df)
    unknown, junk = Counter(), Counter()
    for lst in df["tags"]:
        for t in lst:
            key = _catnorm(t)
            if is_junk_label(t):
                junk[_ws(t) or "(blank)"] += 1
            elif key not in CATEGORY_MAP:
                unknown[_ws(t)] += 1
    prim_junk = int(df["primary_category"].apply(is_junk_label).sum())
    prim_unknown = int(df["primary_category"].apply(
        lambda t: bool(_ws(t)) and not is_junk_label(t) and _catnorm(t) not in CATEGORY_MAP).sum())
    top = lambda c: [{"label": k, "count": v} for k, v in
                     sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:25]]
    return {"kb_size": len(CATEGORY_MAP),
            "junk_labels": top(junk),
            "junk_distinct": len(junk), "junk_tag_total": sum(junk.values()),
            "unknown_labels": top(unknown),
            "unknown_distinct": len(unknown), "unknown_tag_total": sum(unknown.values()),
            "primary_junk_cases": prim_junk, "primary_junk_pct": pct(prim_junk, n),
            "primary_unknown_cases": prim_unknown, "primary_unknown_pct": pct(prim_unknown, n)}


def build_cube(df, V):
    """Small aggregation cube (origin x period x driver) so the report can be
    filtered in the browser without ever shipping a row-level record."""
    drivers = [r["label"] for r in V["bucket"]["rows"]]
    origins = ([r["label"] for r in V["origin"]["rows"]]
               if V["origin"].get("computable") else ["(all)"])
    di = {d: i for i, d in enumerate(drivers)}
    oi = {o: i for i, o in enumerate(origins)}
    out = {"origins": origins, "drivers": drivers, "periods": {}, "counts": {},
           "top_drivers": TOP_DRIVERS, "various_label": VARIOUS}
    # every case, regardless of whether it falls in a complete week - so the driver
    # ranking agrees with the case total quoted everywhere else in the report
    tot = [[0] * len(drivers) for _ in origins]
    for o, b in zip((df["case_origin"].replace("", "(blank)") if "case_origin" in df
                     else pd.Series(["(all)"] * len(df), index=df.index)), df["bucket"]):
        if o in oi and b in di:
            tot[oi[o]][di[b]] += 1
    out["total"] = tot
    d = df.dropna(subset=["_date"]).copy()
    if d.empty:
        return out
    for freq, key in (("W", "week"), ("M", "month"), ("Q", "quarter")):
        keys, _ = _series(df, freq)
        if not keys:
            out["periods"][key] = []
            out["counts"][key] = []
            continue
        pos = {k: i for i, k in enumerate(keys)}
        cube = [[[0] * len(drivers) for _ in keys] for _ in origins]
        lab = d["_date"].map(lambda x: _plabel(pd.Period(x, freq=freq), freq))
        for (o, p, b), c in d.assign(_p=lab).groupby(
                [d["case_origin"].replace("", "(blank)") if "case_origin" in d
                 else pd.Series(["(all)"] * len(d), index=d.index), "_p", "bucket"]).size().items():
            if p in pos and o in oi and b in di:
                cube[oi[o]][pos[p]][di[b]] += int(c)
        out["periods"][key] = keys
        out["counts"][key] = cube
    return out


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
    """Readable period label: 2026-W30 weeks, 2026-06 months, 2026Q3 quarters."""
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


def period_movement(df, V, freq, label, drivers):
    """Volume and category mix per complete calendar period, with the direction
    and any peak stated in words. Complete periods only - a half-finished month
    would read as a collapse that never happened."""
    keys, counts = _series(df, freq)
    if len(keys) < 2:
        return {"computable": False, "label": label, "periods": len(keys),
                "reason": ("only %d complete %s(s) fall inside the data range; 2+ are needed "
                           "to show movement. Partial periods at the start and end of the "
                           "export are excluded on purpose." % (len(keys), label)),
                "needs": ["a date column covering 2+ complete %ss" % label]}

    names = [d["label"] for d in drivers if not d.get("rolled")]
    rolled = next((d for d in drivers if d.get("rolled")), None)
    ser = _bucket_series(df, freq, keys, [b["label"] for b in V["bucket"]["rows"]])
    stack = [{"name": nm, "values": ser.get(nm, [0] * len(keys))} for nm in names]
    if rolled:
        acc = [0] * len(keys)
        for b in rolled["rolled"]:
            for i, v in enumerate(ser.get(b, [])):
                acc[i] += v
        if any(acc):
            stack.append({"name": rolled["label"], "values": acc})

    totals = [counts[k] for k in keys]
    rows = []
    for i, k in enumerate(keys):
        prev = totals[i - 1] if i else None
        delta = (totals[i] - prev) if prev is not None else None
        top = max(stack, key=lambda s: s["values"][i]) if stack else None
        rows.append({"key": k, "total": totals[i], "delta": delta,
                     "pct": (round(100.0 * delta / prev, 1) if prev else None),
                     "top_bucket": top["name"] if top else None,
                     "top_count": top["values"][i] if top else None,
                     "top_pct": pct(top["values"][i], totals[i]) if top and totals[i] else None})

    ins = []
    hi = max(range(len(totals)), key=lambda i: totals[i])
    lo = min(range(len(totals)), key=lambda i: totals[i])
    ins.append({"kind": "range",
                "text": "Busiest %s was %s at %d cases; quietest was %s at %d."
                        % (label, keys[hi], totals[hi], keys[lo], totals[lo])})
    first, last = totals[0], totals[-1]
    if first:
        move = 100.0 * (last - first) / first
        direction = ("rose" if move >= ANOM["trend_pct"] else
                     "fell" if move <= -ANOM["trend_pct"] else "held roughly flat")
        ins.append({"kind": "up" if move >= ANOM["trend_pct"] else
                            "down" if move <= -ANOM["trend_pct"] else "flat",
                    "text": "Across %d %ss volume %s%s, from %d in %s to %d in %s."
                            % (len(keys), label, direction,
                               "" if abs(move) < ANOM["trend_pct"] else " %.0f%%" % abs(move),
                               first, keys[0], last, keys[-1])})
    d, p = rows[-1]["delta"], rows[-1]["pct"]
    if d is not None and p is not None:
        ins.append({"kind": "up" if d > 0 else "down" if d < 0 else "flat",
                    "text": "Latest %s (%s) is %+d case(s) on %s, %+.1f%%."
                            % (label, keys[-1], d, keys[-2], p)})
    peaks, moves = [], []
    for s_ in stack:
        v = s_["values"]
        mu = sum(v) / len(v)
        pi = max(range(len(v)), key=lambda i: v[i])
        if mu and v[pi] >= ANOM["peak_min"] and v[pi] >= ANOM["peak_ratio"] * mu:
            peaks.append({"kind": "peak",
                        "text": "%s peaked in %s at %d cases — %.1fx its %s average of %.1f."
                                % (s_["name"], keys[pi], v[pi], v[pi] / mu, label, mu)})
        if len(v) >= 2 and v[0]:
            mv = 100.0 * (v[-1] - v[0]) / v[0]
            if abs(mv) >= ANOM["bucket_pct_threshold"] and abs(v[-1] - v[0]) >= ANOM["bucket_min_abs"]:
                moves.append({"kind": "up" if mv > 0 else "down",
                            "text": "%s %s %.0f%% across the window (%d in %s to %d in %s)."
                                    % (s_["name"], "grew" if mv > 0 else "shrank", abs(mv),
                                       v[0], keys[0], v[-1], keys[-1])})
    ins.extend(peaks); ins.extend(moves)
    return {"computable": True, "label": label, "keys": keys, "totals": totals,
            "stack": stack, "rows": rows, "insights": ins}


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
            "movement": {
                "monthly": period_movement(df, vol, "M", "month", top_drivers(vol)),
                "quarterly": period_movement(df, vol, "Q", "quarter", top_drivers(vol)),
            },
            "most_received": most_received(df, vol),
            "quality": data_quality(df),
            "cube": build_cube(df, vol),
            "buckets": BUCKETS}
