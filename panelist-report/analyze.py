"""Derive categories, buckets and every statistic the report needs.
Hard rule: anything that cannot be computed from the data returns a
`not_computable` record naming the missing field - never an estimate."""
import re, math, itertools
from collections import Counter, defaultdict
import pandas as pd

# ------------------------------------------------------------------ gates
MIN_CASES_LIFT   = 30    # min cases before a lift/co-occurrence figure is reported
MIN_COOCCUR      = 5     # min joint occurrences before lift is reported
MIN_PERIODS_FIT  = 3     # min historical periods before a trend is fitted

# ------------------------------------------------------------------ bucket rules
# Ordered: first match wins. Specific signals beat generic ones.
BUCKET_RULES = [
    ("Account Access & Security",
     r"password|passwd|pwd|login|log in|sign[- ]?in|2fa|mfa|authenticat|\bump\b|"
     r"google[ _-]?account|account security|security question|lock(?:ed)? out|credential"),
    ("Incentives & Rewards",
     r"incentive|reward|\bpoint|prepaid|visa|gift ?card|redeem|payout|payment|"
     r"compensat|sweepstake|bonus|blocked reward"),
    ("Hardware & Meter",
     r"tv meter|\bmeter\b|router|box switch|screenwise|tablet|browser extension|"
     r"google chrome|\bchrome\b|\bdevice\b|equipment|hardware|modem|set[- ]?top|"
     r"\bstb\b|dongle|battery|firmware|wi-?fi|connectivity|offline"),
    ("Logistics & Returns",
     r"\bars\b|return|\bship|deliver|tag requested|\brma\b|pick[- ]?up|tracking|"
     r"appointment|field service|technician|install visit|dispatch"),
    ("Activity & Reactivation",
     r"activity|reactivat|inactiv|\bpurge|dormant|non[- ]?complian|participation"),
    ("Onboarding & Setup",
     r"set[- ]?up|install|how to|training|onboard|welcome|registration|enrol|sign[- ]?up"),
    ("Outbound & Callbacks",
     r"outbound|call ?back|follow[- ]?up call"),
    ("Communications & Contact",
     r"email|bounce|\bsms\b|text message|mailing|contact preference|address change|"
     r"unsubscribe|opt[- ]?out|phone number change"),
    ("Billing & Tax",  r"\btax\b|w-?9|1099|invoice|billing"),
    ("Complaint & Escalation", r"complaint|escalat|supervisor|dissatisf|legal|bbb"),
]
BUCKETS = [b for b, _ in BUCKET_RULES] + ["Other / Unmapped"]

# tag-level signals used by the correlation chains (searched across ALL tags on a case)
SIGNALS = {
    "hardware_meter":  r"tv meter|\bmeter\b|router|box switch|screenwise|tablet|"
                       r"browser extension|chrome|equipment|hardware|modem|offline|wi-?fi",
    "activity":        r"activity|participation|non[- ]?complian",
    "reactivation":    r"reactivat|inactiv|dormant|\bpurge",
    "blocked_reward":  r"blocked reward|reward.*(?:block|hold|fail)|incentive.*(?:block|hold|fail)",
    "reward_any":      r"incentive|reward|\bpoint|prepaid|visa|redeem",
    "email_issue":     r"email|bounce|undeliver|mailing",
    "password_access": r"password|login|sign[- ]?in|\bump\b|credential|lock(?:ed)? out",
    "google_account":  r"google[ _-]?account|google[ _-]?android|gmail|google chrome",
    "outbound_cb":     r"outbound|call ?back",
    "returns_ars":     r"\bars\b|return|tag requested|\brma\b",
    "shipping":        r"\bship|deliver|tracking",
    "appointment":     r"appointment|field service|technician|dispatch|install visit",
    "lost_stolen":     r"lost or stolen|lost/stolen|stolen",
    "setup":           r"set[- ]?up|install|how to|onboard",
}

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


def derive(df):
    df = df.copy()
    df["tags"] = df.get("category", "").apply(split_tags)
    df["primary_category"] = df["tags"].apply(lambda t: t[0] if t else "")
    df["bucket"] = df["primary_category"].apply(lambda t: bucket_of(t) if t else "Other / Unmapped")
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
            "buckets": BUCKETS}
