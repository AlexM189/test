/* Analysis engine - a direct port of analyze.py, driven by the same rules.json
   (inlined as RULES at build time) so bucket mappings can never drift between
   the browser tool and the Python CLI. */

export function makeEngine(RULES) {
  const G = RULES.gates;
  const MIN_CASES_LIFT = G.min_cases_lift;
  const MIN_COOCCUR = G.min_cooccurrence;
  const MIN_PERIODS_FIT = G.min_periods_fit;
  const DRIVER_RULES = RULES.driver_rules.map(([n, p]) => [n, new RegExp(p, "i")]);
  const DRIVERS = RULES.drivers;
  const catnorm = s => String(s ?? "").replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").trim().toLowerCase();
  const CATEGORY_MAP = new Map(Object.entries(RULES.category_map).map(([k, v]) => [catnorm(k), v]));
  const SIGNALS = Object.entries(RULES.signals).map(([k, p]) => [k, new RegExp(p, "i")]);
  const SUBJECT_RULES = RULES.subject_rules.map(([n, p]) => [n, new RegExp(p, "i")]);
  const TOP_DRIVERS = G.top_drivers;
  const VARIOUS = RULES.various_label;
  const PINNED = RULES.pinned_drivers || [];
  const ANOM = RULES.anomaly;
  const UNMAPPED = "Other / Unmapped";
  const FACET_SETS = {};
  for (const [k, fs] of Object.entries(RULES.facet_sets || {})) {
    FACET_SETS[k] = fs.map(f => ({ name: f.name,
      terms: f.terms.map(([label, pat]) => [label, new RegExp(pat, "i")]) }));
  }
  const DRIVER_FACETS = RULES.driver_facets || {};
  const DD_DEFAULTS = RULES.deep_dive_defaults || { set: "default", cross: [], expanded: 3 };
  const SCRUB = [[/[\w.+-]+@[\w-]+\.[\w.]+/g, " "], [/https?:\/\/\S+/g, " "],
                 [/\b\d{7,}\b/g, " "]];
  const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const ws = s => String(s ?? "").replace(/\s+/g, " ").trim();
  const pct = (n, d) => (d ? Math.round(1000 * n / d) / 10 : 0);

  /* ------------------------------------------------ header mapping */
  const lookup = new Map();
  for (const [canon, list] of Object.entries(RULES.aliases))
    for (const a of list) if (!lookup.has(a)) lookup.set(a, canon);

  /* Two passes on purpose. An exact header match always beats a substring one, so a
     sheet carrying both "Category" and "Category Count" maps Category and leaves the
     count alone - a single greedy pass would let whichever came first win and feed
     the analysis a column of numbers. */
  function mapColumns(cols) {
    const mapping = {}, unmapped = [], claimed = new Set();
    const norms = cols.map(c => norm(c));
    cols.forEach((c, i) => {
      const canon = lookup.get(norms[i]);
      if (canon && !claimed.has(canon)) { claimed.add(canon); mapping[i] = canon; }
    });
    cols.forEach((c, i) => {
      if (mapping[i]) return;
      let best = null;
      for (const [a, cn] of lookup) {
        if (a.length >= 5 && norms[i].includes(a) && !claimed.has(cn) &&
            (!best || a.length > best[0].length)) best = [a, cn];
      }
      if (best) { claimed.add(best[1]); mapping[i] = best[1]; }
    });
    cols.forEach((c, i) => {
      if (!mapping[i] && String(c).trim() !== "") unmapped.push(c);
    });
    return { mapping, unmapped };
  }

  /* ------------------------------------------------ dates */
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function parseDate(v) {
    if (!v) return null;
    const s = ws(v);
    if (!s) return null;
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s)))
      return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
    if ((m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])?)?/.exec(s))) {
      let y = +m[3];
      if (y < 100) y += y < 70 ? 2000 : 1900;
      // ambiguous d/m vs m/d: a value over 12 in the first slot forces day-first
      let mo = +m[1] - 1, da = +m[2];
      if (+m[1] > 12 && +m[2] <= 12) { mo = +m[2] - 1; da = +m[1]; }
      let h = +(m[4] || 0);
      if (m[7]) { const pm = /p/i.test(m[7]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
      return new Date(Date.UTC(y, mo, da, h, +(m[5] || 0), +(m[6] || 0)));
    }
    if ((m = /^(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ](\d{2,4})/.exec(s))) {
      const mo = MON[m[2].toLowerCase()];
      if (mo !== undefined) {
        let y = +m[3]; if (y < 100) y += y < 70 ? 2000 : 1900;
        return new Date(Date.UTC(y, mo, +m[1]));
      }
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const monKey = d => d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
  const qKey = d => d.getUTCFullYear() + "Q" + (Math.floor(d.getUTCMonth() / 3) + 1);
  const monIdx = d => d.getUTCFullYear() * 12 + d.getUTCMonth();
  const idxToKey = i => Math.floor(i / 12) + "-" + String((i % 12) + 1).padStart(2, "0");

  /* ------------------------------------------------ derivation */
  const splitTags = cell => String(cell ?? "").split(",").map(ws).filter(Boolean);
  /* Driver for a category label. Exact match against the KB category list wins;
     only a label the KB does not contain falls through to the ordered rules. */
  function bucketSrc(tag) {
    const key = catnorm(tag);
    if (!key) return [UNMAPPED, "none"];
    const hit = CATEGORY_MAP.get(key);
    if (hit) return [hit, "kb"];
    for (const [name, re] of DRIVER_RULES) if (re.test(key)) return [name, "rule"];
    return [UNMAPPED, "none"];
  }
  const bucketOf = tag => bucketSrc(tag)[0];

  /* Labels that carry no reportable meaning - pure numbers, single characters,
     placeholders. A data-entry problem, not a category. */
  const JUNK_WORDS = new Set(["n/a", "na", "none", "null", "other", "test", "tbd", "-", "--", "."]);
  function isJunkLabel(tag) {
    const t = ws(tag);
    if (!t) return true;
    if (/^[\d.,;:_\-/\s]+$/.test(t)) return true;
    if (t.length <= 2) return true;
    return JUNK_WORDS.has(t.toLowerCase());
  }

  /* Fallback when the Category field is blank or its primary label matches no
     bucket rule: read the intent off the subject line instead. Only the matched
     keyword is ever surfaced - never the subject text, which can carry
     identifying detail. */
  function bucketFromSubject(subject) {
    const t = ws(subject).toLowerCase();
    if (!t) return [null, null];
    for (const [name, re] of SUBJECT_RULES) {
      const m = re.exec(t);
      if (m) return [name, ws(m[0]).slice(0, 40)];
    }
    return [null, null];
  }

  function buildRecords(tables) {
    const recs = [], prov = [];
    for (const t of tables) {
      if (!t.rows.length) continue;
      const header = t.rows[0].map(x => String(x ?? ""));
      const { mapping, unmapped } = mapColumns(header);
      const canon = new Set(Object.values(mapping));
      if (!canon.has("category") && !canon.has("case_origin")) {
        prov.push({ file: t.file, sheet: t.sheet, status: "skipped - not a case table",
                    rows: 0, unmapped: [] });
        continue;
      }
      let n = 0;
      for (let i = 1; i < t.rows.length; i++) {
        const row = t.rows[i];
        if (!row.some(c => String(c ?? "").trim() !== "")) continue;
        const r = { _source_file: t.file };
        for (const ci of Object.keys(mapping)) r[mapping[ci]] = ws(row[+ci]);
        recs.push(r); n++;
      }
      // which header actually fed each field, so a wrong column shows
      const headers = Object.keys(mapping)
        .map(ci => [mapping[ci], String(header[+ci])]).sort();
      prov.push({ file: t.file, sheet: t.sheet, status: "loaded", rows: n,
                  mapped: [...canon].sort(), headers, unmapped });
    }
    // De-duplicate on the same key the Python path uses. Dates are normalised
    // first: the identical case exported as .xlsx and as .csv carries different
    // raw date text, and comparing the raw strings would double the volume.
    const keyFields = ["mno", "case_origin", "modified_on", "subject", "category"];
    const dateFields = new Set(["modified_on", "created_on", "closed_on"]);
    const seen = new Set(), out = [];
    for (const r of recs) {
      const k = keyFields.map(f => {
        const v = r[f] ?? "";
        if (!dateFields.has(f) || !v) return v;
        const d = parseDate(v);
        return d ? d.toISOString() : v;
      }).join(" | ");
      if (seen.has(k)) continue;
      seen.add(k); out.push(r);
    }
    return { recs: out, prov, stats: { rows_read: recs.length, rows_after_dedupe: out.length,
                                       exact_duplicates_removed: recs.length - out.length } };
  }

  function derive(recs) {
    let dateCol = null;
    if (recs.some(r => r.created_on && parseDate(r.created_on))) dateCol = "created_on";
    else if (recs.some(r => r.modified_on)) dateCol = "modified_on";
    for (const r of recs) {
      r.tags = splitTags(r.category);
      // A cell like "1, Withdraw/Member/No Answer Uncooperative" is one case with one
      // real category and an export artefact in front of it. Placeholder tokens are
      // dropped before anything is counted - they stay visible only in the data-quality
      // panel, which reports them against the raw cell they came from.
      r.tags_clean = r.tags.filter(t => !isJunkLabel(t));
      r.primary_category = r.tags_clean[0] || "";
      const [b0, s0] = r.primary_category ? bucketSrc(r.primary_category) : [UNMAPPED, "none"];
      r.bucket = b0;
      r.bucket_source = s0;
      r.inferred_keyword = "";
      if (r.bucket === UNMAPPED) {
        const [b, kw] = bucketFromSubject(r.subject);
        if (b) { r.bucket = b; r.bucket_source = "subject"; r.inferred_keyword = kw; }
        else r.bucket_source = "none";
      }
      r.tag_count = r.tags_clean.length;
      const hay = (r.tags_clean.join(" | ") + " | " + (r.subject || "")).toLowerCase();
      r.sig = {};
      for (const [k, re] of SIGNALS) r.sig[k] = re.test(hay);
      r._date = dateCol ? parseDate(r[dateCol]) : null;
    }
    return dateCol;
  }

  const nc = (reason, needs) => ({ computable: false, reason, needs });

  function counts(recs, field, n) {
    const m = new Map();
    for (const r of recs) {
      const v = (r[field] ?? "") === "" ? "(blank)" : r[field];
      m.set(v, (m.get(v) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count, pct: pct(count, n) }));
  }

  /* ------------------------------------------------ sections */
  function volumeSection(recs, dateCol) {
    const n = recs.length;
    const V = { total_cases: n, date_field_used: dateCol,
                date_field_is_proxy: dateCol === "modified_on" };
    V.unique_members = recs.some(r => r.mno)
      ? new Set(recs.map(r => r.mno).filter(Boolean)).size : null;
    const dts = recs.map(r => r._date).filter(Boolean).sort((a, b) => a - b);
    if (dts.length) {
      V.date_min = dts[0].toISOString().slice(0, 10);
      V.date_max = dts[dts.length - 1].toISOString().slice(0, 10);
      V.months_spanned = new Set(dts.map(monKey)).size;
    } else { V.date_min = null; V.date_max = null; V.months_spanned = 0; }

    const dist = (field, label) => recs.some(r => (r[field] ?? "") !== "")
      ? { computable: true, rows: counts(recs, field, n) }
      : nc("column '" + field + "' absent or empty", [label]);

    V.origin = dist("case_origin", "case_origin");
    V.bucket = { computable: true, rows: counts(recs, "bucket", n) };
    V.primary_raw = { computable: true, rows: counts(recs, "primary_category", n).slice(0, 25) };
    const cleanRecs = recs.filter(r => !isJunkLabel(r.primary_category));
    V.primary_raw_clean = { computable: true, excluded_cases: n - cleanRecs.length,
      rows: counts(cleanRecs, "primary_category", n).slice(0, 25) };
    V.member_status = dist("member_status", "member_status");
    V.case_status = dist("case_status", "case_status");
    V.site = recs.some(r => r.site) ? { computable: true, rows: counts(recs, "site", n) }
      : nc("no office/site column in the export", ["site / office"]);
    V.agent = recs.some(r => r.agent) ? { computable: true, rows: counts(recs, "agent", n) }
      : nc("no agent/owner column in the export", ["agent / owner"]);

    const tagC = new Map();
    let totalTags = 0, multi = 0;
    for (const r of recs) {
      totalTags += r.tag_count;
      if (r.tag_count > 1) multi++;
      for (const t of r.tags_clean) tagC.set(t, (tagC.get(t) || 0) + 1);
    }
    V.tag_load = {
      total_tags: totalTags,
      mean_tags_per_case: n ? Math.round(100 * totalTags / n) / 100 : 0,
      multi_tag_cases: multi, multi_tag_pct: pct(multi, n), distinct_tags: tagC.size,
      top: [...tagC.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
        .map(([label, count]) => ({ label, count, pct_of_cases: pct(count, n) })),
    };

    if (V.origin.computable) {
      const origins = V.origin.rows.map(r => r.label);
      const buckets = V.bucket.rows.map(r => r.label);
      const M = origins.map(() => buckets.map(() => 0));
      const oi = new Map(origins.map((o, i) => [o, i]));
      const bi = new Map(buckets.map((b, i) => [b, i]));
      for (const r of recs) {
        const o = (r.case_origin ?? "") === "" ? "(blank)" : r.case_origin;
        if (oi.has(o) && bi.has(r.bucket)) M[oi.get(o)][bi.get(r.bucket)]++;
      }
      V.crosstab = { computable: true, origins, buckets, matrix: M,
                     row_totals: M.map(r => r.reduce((a, b) => a + b, 0)),
                     col_totals: buckets.map((_, j) => M.reduce((a, r) => a + r[j], 0)) };
    } else V.crosstab = nc("origin column unavailable", ["case_origin"]);

    if (V.months_spanned >= 2) {
      const withD = recs.filter(r => r._date);
      const months = [...new Set(withD.map(r => monKey(r._date)))].sort();
      const mpos = new Map(months.map((m, i) => [m, i]));
      const bySet = field => {
        const o = {};
        for (const r of withD) {
          const k = r[field] || "(blank)";
          if (!o[k]) o[k] = months.map(() => 0);
          o[k][mpos.get(monKey(r._date))]++;
        }
        return o;
      };
      V.monthly = { computable: true, months,
                    total: months.map(() => 0),
                    by_bucket: bySet("bucket"),
                    by_origin: V.origin.computable ? bySet("case_origin") : {} };
      for (const r of withD) V.monthly.total[mpos.get(monKey(r._date))]++;
    } else {
      V.monthly = nc("data spans " + V.months_spanned +
        " month(s); at least 2 needed for growth/decline", ["a date column covering 2+ months"]);
    }
    return V;
  }

  function lift(recs, a, b) {
    const n = recs.length;
    let na = 0, nb = 0, joint = 0;
    for (const r of recs) {
      const A = r.sig[a], B = r.sig[b];
      if (A) na++;
      if (B) nb++;
      if (A && B) joint++;
    }
    const base = n ? nb / n : 0, cond = na ? joint / na : 0;
    return { n, n_a: na, n_b: nb, joint,
             pct_of_a_with_b: Math.round(1000 * cond) / 10,
             base_rate_b: Math.round(1000 * base) / 10,
             lift: base ? Math.round(100 * cond / base) / 100 : null };
  }

  function correlationSection(recs) {
    const n = recs.length;
    const res = { gate: { min_cases: MIN_CASES_LIFT, min_cooccurrence: MIN_COOCCUR, n } };
    const hasMember = recs.some(r => r.mno);

    const chain = (key, title, a, b, extraMissing, note) => {
      const missing = (extraMissing || []).slice();
      if (n < MIN_CASES_LIFT) {
        res[key] = Object.assign({ title }, nc("only " + n + " case(s) loaded; " + MIN_CASES_LIFT +
          "+ needed before a co-occurrence rate is meaningful",
          missing.length ? missing : ["a larger export"]), { note });
        return;
      }
      const r = lift(recs, a, b);
      if (r.joint < MIN_COOCCUR) {
        res[key] = Object.assign({ title }, nc("only " + r.joint + " case(s) carry both signals; " +
          MIN_COOCCUR + "+ needed", missing), { note, raw: r });
        return;
      }
      const lf = r.lift || 0;
      const v = lf >= 1.5 ? ["supported", "Strongly supported"]
        : lf >= 1.2 ? ["supported", "Supported"]
          : lf >= 0.9 ? ["none", "No meaningful association"]
            : ["inverse", "Inverse association"];
      res[key] = Object.assign({ title, computable: true, missing_fields: missing, note,
                                 verdict: v[0], verdict_text: v[1] }, r);
    };

    chain("chain_hw_inactivity", "Meter / hardware problems → participation & activity doubt",
      "hardware_meter", "activity", [],
      "Whether an activity gap became an involuntary purge needs a panelist status history; " +
      "case data alone cannot confirm the outcome.");
    chain("chain_activity_withdraw", "Participation & activity doubt → withdrawal or suspension",
      "activity", "withdrawal", [],
      "Co-occurrence within a case, not a sequence over time. A created-date field would let " +
      "this be tested as an ordered progression instead.");
    chain("chain_reward_dupes", "Blocked or missing rewards → outbound / callback load",
      "blocked_reward", "outbound_cb", hasMember ? [] : ["MNO (to link repeat contacts)"],
      "Repeat-contact linkage below sizes how much of this is the same panelist calling again.");
    chain("chain_bounce_withdraw", "Email deliverability failure → withdrawal",
      "email_bounce", "withdrawal", [],
      "The category list itself links these ('Email Bounce/Wrong address/Last attempt before " +
      "Withdrawal', 'Withdraw/Household/Initial email bounced'), so the measured rate below is " +
      "the check on how often that path is actually travelled.");
    chain("chain_google_lockout", "Google account migration → access lockout",
      "google_account", "password_access", ["member type / household role (primary vs secondary)"],
      "Secondary-member lockout and household attrition are NOT computable without a member-type " +
      "or household-link field.");
    chain("chain_field_service", "Install appointment / field service → onboarding contact",
      "appointment", "setup", ["enrollment or join date (for 30/60/90-day tenure)"],
      "Early-life churn is NOT computable without an enrollment date; tenure cannot be derived " +
      "from case dates alone.");

    if (hasMember) {
      const vc = new Map();
      for (const r of recs) if (r.mno) vc.set(r.mno, (vc.get(r.mno) || 0) + 1);
      const vals = [...vc.values()];
      const repeat = vals.filter(v => v > 1);
      const repeatCases = repeat.reduce((a, b) => a + b, 0);
      res.repeat_contact = { computable: true, members: vc.size,
        members_with_multiple_cases: repeat.length,
        pct_members_repeat: pct(repeat.length, vc.size),
        cases_from_repeat_members: repeatCases,
        pct_cases_from_repeat: pct(repeatCases, n),
        max_cases_one_member: vals.length ? Math.max(...vals) : 0 };
    } else res.repeat_contact = nc("no member identifier column", ["MNO"]);

    if (n >= MIN_CASES_LIFT) {
      const keys = SIGNALS.map(s => s[0]), pairs = [];
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const r = lift(recs, keys[i], keys[j]);
          if (!(r.joint >= MIN_COOCCUR && r.lift && r.lift > 1)) continue;
          if (r.joint === r.n_a || r.joint === r.n_b) continue;   // definitional containment
          pairs.push(Object.assign({ a: keys[i], b: keys[j] }, r));
        }
      }
      pairs.sort((x, y) => y.lift - x.lift || y.joint - x.joint);
      res.discovered = { computable: true, pairs: pairs.slice(0, 12) };
    } else {
      res.discovered = nc("only " + n + " case(s); pairwise scanning needs " + MIN_CASES_LIFT +
        "+ to avoid spurious pairs", ["a larger export"]);
    }
    return res;
  }

  function forecastSection(V) {
    const monthly = V.monthly;
    if (!monthly.computable || monthly.months.length < MIN_PERIODS_FIT) {
      const got = monthly.computable ? monthly.months.length : V.months_spanned;
      return { method: "not_fitted", computable: false,
        reason: "data covers " + got + " period(s); a fitted trend needs " + MIN_PERIODS_FIT +
          "+ historical months. No directional estimate is produced here because the category " +
          "mix at this sample size is not representative.",
        needs: ["a date column spanning 3+ months"] };
    }
    const months = monthly.months, y = monthly.total, k = y.length;
    const xbar = (k - 1) / 2, ybar = y.reduce((a, b) => a + b, 0) / k;
    let sxx = 0, sxy = 0;
    for (let i = 0; i < k; i++) { sxx += (i - xbar) ** 2; sxy += (i - xbar) * (y[i] - ybar); }
    const slope = sxx ? sxy / sxx : 0, icpt = ybar - slope * xbar;
    let ss = 0;
    for (let i = 0; i < k; i++) ss += (y[i] - (icpt + slope * i)) ** 2;
    const sd = Math.sqrt(ss / Math.max(k - 2, 1));

    const obs = new Map(months.map((m, i) => [m, y[i]]));
    const first = monIdx(new Date(months[0] + "-01T00:00:00Z"));
    const lastIdx = monIdx(new Date(months[k - 1] + "-01T00:00:00Z"));

    // observed history: only calendar quarters whose three months are all present
    const hist = [];
    const qset = new Set(months.map(m => qKey(new Date(m + "-01T00:00:00Z"))));
    for (const q of [...qset].sort()) {
      const yr = +q.slice(0, 4), qn = +q.slice(5);
      const qm = [0, 1, 2].map(j => idxToKey(yr * 12 + (qn - 1) * 3 + j));
      if (qm.every(m => obs.has(m)))
        hist.push({ label: q, point: qm.reduce((a, m) => a + obs.get(m), 0) });
    }

    // forward quarters start at the quarter holding the first unobserved month
    const out = [];
    let qn = Math.floor(((lastIdx + 1) % 12) / 3) + 1;
    let yr = Math.floor((lastIdx + 1) / 12);
    for (let step = 0; step < 4; step++) {
      let pt = 0, fitted = 0, nObs = 0;
      for (let j = 0; j < 3; j++) {
        const gi = yr * 12 + (qn - 1) * 3 + j, key = idxToKey(gi);
        if (obs.has(key)) { pt += obs.get(key); nObs++; }
        else { pt += Math.max(icpt + slope * (gi - first), 0); fitted++; }
      }
      const band = fitted ? 1.96 * sd * Math.sqrt(fitted) : 0;
      out.push({ label: yr + "Q" + qn, point: Math.round(pt),
                 low: Math.round(Math.max(pt - band, 0)), high: Math.round(pt + band),
                 observed_months: nObs, fitted_months: fitted, partial: nObs > 0 });
      qn++; if (qn > 4) { qn = 1; yr++; }
    }
    return { method: "ols_linear_on_monthly_volume", computable: true, history: hist,
      months_fitted: k, slope_cases_per_month: Math.round(slope * 100) / 100,
      residual_sd: Math.round(sd * 100) / 100, quarters: out,
      partial_note: out.some(q => q.partial),
      caveat: "Mix is held at the observed share for each bucket." +
        (V.date_field_is_proxy
          ? " Fitted on Modified On, which records last touch rather than case arrival." : "") };
  }

  function inferenceAudit(recs) {
    const n = recs.length;
    let fromKb = 0, fromRule = 0, fromSub = 0, none = 0;
    const kw = new Map(), byB = new Map();
    for (const r of recs) {
      if (r.bucket_source === "kb") fromKb++;
      else if (r.bucket_source === "rule") fromRule++;
      else if (r.bucket_source === "subject") {
        fromSub++;
        const k = r.bucket + "\u0000" + r.inferred_keyword;
        kw.set(k, (kw.get(k) || 0) + 1);
        byB.set(r.bucket, (byB.get(r.bucket) || 0) + 1);
      } else none++;
    }
    const keywords = [...kw.entries()].map(([k, count]) => {
      const [bucket, keyword] = k.split("\u0000");
      return { bucket, keyword, count };
    }).sort((a, b) => b.count - a.count || a.bucket.localeCompare(b.bucket) ||
      a.keyword.localeCompare(b.keyword)).slice(0, 40);
    const by_bucket = [...byB.entries()].sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count, pct: pct(count, fromSub) }));
    return { total: n, from_category: fromKb + fromRule, from_kb: fromKb, from_rule: fromRule,
             pct_from_kb: pct(fromKb, n), pct_from_rule: pct(fromRule, n),
             from_subject: fromSub, unresolved: none,
             pct_from_subject: pct(fromSub, n), pct_unresolved: pct(none, n),
             keywords, by_bucket };
  }

  /* Category values the KB does not contain, plus labels that carry no meaning
     at all. This is the cleanup list, sized. */
  function dataQuality(recs) {
    const n = recs.length;
    const unknown = new Map(), junk = new Map();
    const ex = new Map();          // label -> example raw Category cells
    let primJunk = 0, primUnknown = 0, touched = 0;
    for (const r of recs) {
      for (const t of r.tags) {
        const lab = ws(t) || "(blank)";
        const bad = isJunkLabel(t);
        if (bad) junk.set(lab, (junk.get(lab) || 0) + 1);
        else if (!CATEGORY_MAP.has(catnorm(t))) unknown.set(lab, (unknown.get(lab) || 0) + 1);
        else continue;
        const cell = ws(r.category).slice(0, 160);
        if (!ex.has(lab)) ex.set(lab, []);
        const e = ex.get(lab);
        if (e.length < 3 && !e.some(x => x.cell === cell)) {
          e.push({ cell, position: ws(r.primary_category) === lab ? "primary" : "secondary tag" });
        }
      }
      // cases carrying at least one placeholder token that was stripped before counting
      const hadJunk = r.tags.length !== r.tags_clean.length;
      if (hadJunk) touched++;
      // cases where every token was a placeholder - these have no category at all
      if (hadJunk && !r.tags_clean.length) primJunk++;
      const p = r.primary_category;
      if (ws(p) && !CATEGORY_MAP.has(catnorm(p))) primUnknown++;
    }
    const top = m => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 25).map(([label, count]) => ({ label, count, examples: ex.get(label) || [] }));
    const sum = m => [...m.values()].reduce((a, b) => a + b, 0);
    return { kb_size: CATEGORY_MAP.size,
             junk_labels: top(junk), junk_distinct: junk.size, junk_tag_total: sum(junk),
             unknown_labels: top(unknown), unknown_distinct: unknown.size,
             unknown_tag_total: sum(unknown),
             cases_with_junk_token: touched, pct_with_junk_token: pct(touched, n),
             primary_junk_cases: primJunk, primary_junk_pct: pct(primJunk, n),
             primary_unknown_cases: primUnknown, primary_unknown_pct: pct(primUnknown, n) };
  }

  /* Small aggregation cube (origin x period x driver) so the report can be filtered
     in the browser without ever shipping a row-level record. */
  /* Subject + description with obvious identifiers removed. Used only for keyword
     matching - the text itself never reaches the report. */
  function freeText(r) {
    let t = ((r.subject || "") + " " + (r.description || "")).toLowerCase();
    for (const [rx, rep] of SCRUB) t = t.replace(rx, rep);
    return t.replace(/\s+/g, " ").trim();
  }

  /* Drill-down for one family of drivers. Facets are matched against the free text
     only, so they add information the category field does not already carry. Output
     is a fixed vocabulary of facet labels - never text from a case. */
  /* Facet set for one driver: an override where configured, otherwise the generic
     set, so every family gets a drill-down without hand-writing 14 of them. */
  function diveConfig(driver) {
    const o = DRIVER_FACETS[driver] || {};
    const name = o.set || DD_DEFAULTS.set || "default";
    return { id: driver.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
             title: driver, drivers: [driver],
             cross: o.cross || DD_DEFAULTS.cross || [],
             facet_set: name, facets: FACET_SETS[name] || [] };
  }

  /* One dive per driver present in the data, biggest first. */
  function allDeepDives(recs, V) {
    const out = [];
    for (const row of V.bucket.rows) {
      if (!row.count) continue;
      const cfg = diveConfig(row.label);
      const d = deepDive(recs, V, cfg);
      d.facet_set = cfg.facet_set;
      out.push(d);
    }
    return out;
  }

  function deepDive(recs, V, cfg) {
    const fam = recs.filter(r => cfg.drivers.indexOf(r.bucket) >= 0);
    const nAll = recs.length, n = fam.length;
    const out = { id: cfg.id, title: cfg.title, drivers: cfg.drivers, cases: n,
                  pct_of_total: pct(n, nAll) };
    if (!n) {
      Object.assign(out, nc("no cases fall in " + cfg.drivers.join(" or "),
                            ["cases in these drivers"]));
      return out;
    }
    const hasDesc = fam.filter(r => ws(r.description) !== "").length;
    const txt = fam.map(freeText);
    const nonEmpty = txt.filter(t => t.length > 0).length;
    out.with_description = hasDesc;
    out.pct_with_description = pct(hasDesc, n);
    out.with_free_text = nonEmpty;
    out.pct_with_free_text = pct(nonEmpty, n);
    // A case placed by the subject fallback has no meaningful category value - its
    // Category cell was a placeholder or a label the KB does not list. Charting it
    // would show "1" as though it were a category, so those cases are counted
    // separately instead.
    const bs = { kb: 0, rule: 0, subject: 0, none: 0 };
    for (const r of fam) if (bs[r.bucket_source] !== undefined) bs[r.bucket_source]++;
    out.by_source = bs;
    const real = fam.filter(r => (r.bucket_source === "kb" || r.bucket_source === "rule") &&
                                 !isJunkLabel(r.primary_category));
    out.categories_charted = real.length;
    out.categories_excluded = n - real.length;
    out.top_categories = counts(real, "primary_category", n).slice(0, 8)
      .map(x => ({ label: x.label, count: x.count, pct: x.pct }));

    const facetHits = {};
    out.facets = [];
    for (const f of cfg.facets) {
      const rows = [], hits = {};
      const matchedAny = new Array(n).fill(false);
      for (const [label, re] of f.terms) {
        const m = txt.map(t => re.test(t));
        hits[label] = m;
        let c = 0;
        for (let i = 0; i < n; i++) if (m[i]) { c++; matchedAny[i] = true; }
        if (c) rows.push({ label, count: c, pct: pct(c, n) });
      }
      rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      const cov = matchedAny.filter(Boolean).length;
      facetHits[f.name] = hits;
      out.facets.push({ name: f.name, rows, matched: cov, coverage_pct: pct(cov, n),
                        unmatched: n - cov, unmatched_pct: pct(n - cov, n), basis: nonEmpty });
    }

    out.cross = null;
    const ca = (cfg.cross || [])[0], cb = (cfg.cross || [])[1];
    if (facetHits[ca] && facetHits[cb]) {
      const A = out.facets.find(x => x.name === ca).rows.map(r => r.label).slice(0, 6);
      const B = out.facets.find(x => x.name === cb).rows.map(r => r.label).slice(0, 6);
      if (A.length && B.length) {
        const M = A.map(a => B.map(b => {
          let c = 0;
          for (let i = 0; i < n; i++) if (facetHits[ca][a][i] && facetHits[cb][b][i]) c++;
          return c;
        }));
        out.cross = { a_name: ca, b_name: cb, a: A, b: B, matrix: M,
                      row_totals: M.map(r => r.reduce((x, y) => x + y, 0)),
                      col_totals: B.map((_, j) => M.reduce((x, r) => x + r[j], 0)) };
      }
    }

    if (fam.some(r => r.mno)) {
      const vc = new Map();
      for (const r of fam) if (r.mno) vc.set(r.mno, (vc.get(r.mno) || 0) + 1);
      const rep = [...vc.values()].filter(v => v > 1);
      const cs = rep.reduce((a, b) => a + b, 0);
      out.repeat = { computable: true, members: vc.size, repeat_members: rep.length,
                     cases_from_repeat: cs, pct_cases_from_repeat: pct(cs, n) };
    } else out.repeat = nc("no member identifier column", ["MNO"]);

    out.trend = nc("fewer than 2 complete months", ["a longer date range"]);
    const { keys, counts: tot } = series(recs, "M");
    if (V.months_spanned >= 2 && keys.length >= 2 && fam.some(r => r._date)) {
      const pos = new Map(keys.map((k, i) => [k, i]));
      const vals = keys.map(() => 0);
      for (const r of fam) {
        if (!r._date) continue;
        const i = pos.get(plabel(r._date, "M"));
        if (i !== undefined) vals[i]++;
      }
      out.monthly = { computable: true, keys, values: vals };
      const totals = keys.map(k => tot[k]);
      const cur = vals[vals.length - 1], prev = vals[vals.length - 2];
      const first = vals[0], last = vals[vals.length - 1];
      let pi = 0;
      vals.forEach((v, i) => { if (v > vals[pi]) pi = i; });
      const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
      // share of all cases at each end, so a family can be shrinking while the
      // operation shrinks faster - that is a rising share, not a win
      const shF = totals[0] ? pct(first, totals[0]) : 0;
      const shL = totals[totals.length - 1] ? pct(last, totals[totals.length - 1]) : 0;
      const tw = totals[0]
        ? 100 * (totals[totals.length - 1] - totals[0]) / totals[0] : null;
      out.trend = { computable: true,
        cur_key: keys[keys.length - 1], prev_key: keys[keys.length - 2], first_key: keys[0],
        current: cur, previous: prev, mom_change: cur - prev,
        mom_pct: prev ? Math.round(1000 * (cur - prev) / prev) / 10 : null,
        first, last,
        window_pct: first ? Math.round(1000 * (last - first) / first) / 10 : null,
        total_window_pct: tw === null ? null : Math.round(tw * 10) / 10,
        peak_key: keys[pi], peak_value: vals[pi],
        peak_ratio: mu ? Math.round(10 * vals[pi] / mu) / 10 : null,
        share_first: shF, share_last: shL,
        share_change: Math.round((shL - shF) * 10) / 10,
        months: keys.length };
    } else out.monthly = nc("fewer than 2 complete months", ["a longer date range"]);
    return out;
  }

  function buildCube(recs, V) {
    const drivers = V.bucket.rows.map(r => r.label);
    const origins = V.origin.computable ? V.origin.rows.map(r => r.label) : ["(all)"];
    const di = new Map(drivers.map((d, i) => [d, i]));
    const oi = new Map(origins.map((o, i) => [o, i]));
    const out = { origins, drivers, periods: {}, counts: {},
                  top_drivers: TOP_DRIVERS, various_label: VARIOUS, pinned: PINNED };
    // every case, regardless of whether it falls in a complete week - so the driver
    // ranking agrees with the case total quoted everywhere else in the report
    const tot = origins.map(() => drivers.map(() => 0));
    for (const r of recs) {
      const o = V.origin.computable
        ? ((r.case_origin ?? "") === "" ? "(blank)" : r.case_origin) : "(all)";
      const a = oi.get(o), b = di.get(r.bucket);
      if (a !== undefined && b !== undefined) tot[a][b]++;
    }
    out.total = tot;
    for (const [freq, key] of [["D", "day"], ["W", "week"], ["M", "month"], ["Q", "quarter"]]) {
      const keys = denseKeys(recs, freq);
      out.periods[key] = keys;
      if (!keys.length) { out.counts[key] = []; continue; }
      const pos = new Map(keys.map((k, i) => [k, i]));
      const cube = origins.map(() => keys.map(() => drivers.map(() => 0)));
      for (const r of recs) {
        if (!r._date) continue;
        const pi = pos.get(plabel(r._date, freq));
        if (pi === undefined) continue;
        const o = V.origin.computable
          ? ((r.case_origin ?? "") === "" ? "(blank)" : r.case_origin) : "(all)";
        const a = oi.get(o), b = di.get(r.bucket);
        if (a !== undefined && b !== undefined) cube[a][pi][b]++;
      }
      out.counts[key] = cube;
    }
    return out;
  }

  /* Top N named buckets, plus any pinned driver wherever it ranks, plus one rolled-up
     row. Every row carries its true rank by case count, so a pinned driver shows where
     it actually sits rather than pretending to be top five. */
  function topDrivers(V) {
    const rows = V.bucket.rows.map((r, i) => Object.assign({}, r, { volume_rank: i + 1 }));
    let head = rows.slice(0, TOP_DRIVERS).map(r => Object.assign({}, r));
    const named = new Set(head.map(r => r.label));
    for (const p of PINNED) {
      if (named.has(p)) continue;
      const hit = rows.find(r => r.label === p);
      if (hit) { head.push(Object.assign({}, hit, { pinned: true })); named.add(p); }
    }
    head = head.map((r, i) => Object.assign({}, r, { rank: i + 1, driver_count: rows.length }));
    const tail = rows.filter(r => !named.has(r.label));
    if (tail.length) head.push({ rank: head.length + 1, driver_count: rows.length, label: VARIOUS,
      count: tail.reduce((a, b) => a + b.count, 0),
      pct: Math.round(tail.reduce((a, b) => a + b.pct, 0) * 10) / 10,
      rolled: tail.map(r => r.label),
      rolled_detail: tail.map(r => ({ label: r.label, count: r.count, pct: r.pct,
                                      volume_rank: r.volume_rank })) });
    return head;
  }

  /* --- period helpers: complete calendar periods only, so a partial first or
     last period cannot read as a collapse in volume that never happened. */
  const dayMs = 86400000;
  function weekBounds(d) {
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const dow = (new Date(t).getUTCDay() + 6) % 7;           // Monday = 0
    return [t - dow * dayMs, t - dow * dayMs + 6 * dayMs];
  }
  function isoWeekLabel(d) {
    const [start] = weekBounds(d);
    const th = new Date(start + 3 * dayMs);                  // Thursday decides the ISO year
    const y = th.getUTCFullYear();
    const jan4 = new Date(Date.UTC(y, 0, 4));
    const [w1] = weekBounds(jan4);
    const wk = Math.round((start - w1) / (7 * dayMs)) + 1;
    return y + "-W" + String(wk).padStart(2, "0");
  }
  const monthBounds = d => [Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1),
                            Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)];
  const quarterBounds = d => {
    const q = Math.floor(d.getUTCMonth() / 3);
    return [Date.UTC(d.getUTCFullYear(), q * 3, 1), Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0)];
  };
  const dayBounds = d => { const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(),
                                              d.getUTCDate()); return [t, t]; };
  const dayKey = d => d.toISOString().slice(0, 10);
  const plabel = (d, freq) => freq === "W" ? isoWeekLabel(d) : freq === "D" ? dayKey(d)
    : freq === "Q" ? qKey(d) : monKey(d);
  const pbounds = (d, freq) => freq === "W" ? weekBounds(d) : freq === "D" ? dayBounds(d)
    : freq === "Q" ? quarterBounds(d) : monthBounds(d);

  /* Every complete calendar period between the first and last case date, including
     periods with no cases at all. series() lists only periods that carry cases,
     which is right for a trend fit but wrong for a picker: a quiet Sunday has to be
     a flat bar you can still select, not a missing column. */
  function denseKeys(recs, freq) {
    let lo = Infinity, hi = -Infinity;
    for (const r of recs) {
      if (!r._date) continue;
      const t = Date.UTC(r._date.getUTCFullYear(), r._date.getUTCMonth(), r._date.getUTCDate());
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    if (lo > hi) return [];
    const keys = [];
    for (let t = lo; t <= hi;) {
      const d = new Date(t), b = pbounds(d, freq);
      if (b[0] >= lo && b[1] <= hi) keys.push(plabel(d, freq));
      t = b[1] + dayMs;
    }
    return keys;
  }

  function series(recs, freq) {
    const withD = recs.filter(r => r._date);
    if (!withD.length) return { keys: [], counts: {} };
    const days = withD.map(r => Date.UTC(r._date.getUTCFullYear(), r._date.getUTCMonth(),
                                         r._date.getUTCDate()));
    const lo = Math.min(...days), hi = Math.max(...days);
    const counts = new Map(), bounds = new Map();
    for (const r of withD) {
      const lab = plabel(r._date, freq);
      counts.set(lab, (counts.get(lab) || 0) + 1);
      if (!bounds.has(lab)) bounds.set(lab, pbounds(r._date, freq));
    }
    const keys = [...counts.keys()].filter(k => bounds.get(k)[0] >= lo && bounds.get(k)[1] <= hi).sort();
    const out = {};
    for (const k of keys) out[k] = counts.get(k);
    return { keys, counts: out };
  }

  function bucketSeries(recs, freq, keys, buckets) {
    const pos = new Map(keys.map((k, i) => [k, i]));
    const out = {};
    for (const b of buckets) out[b] = keys.map(() => 0);
    for (const r of recs) {
      if (!r._date || !out[r.bucket]) continue;
      const i = pos.get(plabel(r._date, freq));
      if (i !== undefined) out[r.bucket][i]++;
    }
    return out;
  }

  function anomalySection(recs, V) {
    const out = { alerts: [], weekly: null, monthly: null };
    if (!recs.some(r => r._date)) {
      Object.assign(out, nc("no usable date column, so no period comparison is possible",
                            ["a date column"]));
      return out;
    }
    const block = (freq, label) => {
      const { keys, counts } = series(recs, freq);
      if (keys.length < 2) return { computable: false, periods: keys.length, label,
        reason: "only " + keys.length + " complete " + label + "(s) in range; 2+ needed" };
      const vals = keys.map(k => counts[k]);
      const cur = vals[vals.length - 1], prev = vals[vals.length - 2];
      const chg = cur - prev;
      const b = { computable: true, label, keys, values: vals, current: cur, previous: prev,
        change: chg, pct_change: prev ? Math.round(1000 * chg / prev) / 10 : null,
        current_key: keys[keys.length - 1], previous_key: keys[keys.length - 2] };
      if (vals.length >= ANOM.min_periods_for_z) {
        const hist = vals.slice(0, -1);
        const mu = hist.reduce((a, x) => a + x, 0) / hist.length;
        const varr = hist.reduce((a, x) => a + (x - mu) ** 2, 0) / Math.max(hist.length - 1, 1);
        const sd = Math.sqrt(varr);
        b.mean_prior = Math.round(mu * 10) / 10;
        b.z = sd ? Math.round(100 * (cur - mu) / sd) / 100 : null;
      }
      return b;
    };
    const wk = block("W", "week"), mo = block("M", "month");
    out.weekly = wk; out.monthly = mo;

    const flag = b => {
      if (!b.computable || b.pct_change === null) return;
      const pc = b.pct_change, chg = b.change;
      if (Math.abs(pc) >= ANOM.pct_threshold && Math.abs(chg) >= ANOM.min_abs_change) {
        out.alerts.push({ level: chg > 0 ? "up" : "down", scope: "total",
          text: "Total volume " + (chg > 0 ? "rose " : "fell ") +
            (Math.round(Math.abs(pc) * 10) / 10).toFixed(1) +
            "% to " + b.current + " cases in " + b.current_key + ", from " + b.previous +
            " in " + b.previous_key + " (" + (chg > 0 ? "+" : "") + chg + " cases " +
            b.label + "-over-" + b.label + ")." });
      }
      if (b.z !== null && b.z !== undefined && Math.abs(b.z) >= ANOM.z_threshold &&
          Math.abs(chg) >= ANOM.min_abs_change) {
        out.alerts.push({ level: b.z > 0 ? "up" : "down", scope: "total",
          text: b.current_key + " sits " + (Math.round(Math.abs(b.z) * 10) / 10).toFixed(1) +
            " standard deviations " +
            (b.z > 0 ? "above" : "below") + " the mean of the preceding " +
            (b.values.length - 1) + " " + b.label + "s (" + b.mean_prior + " cases)." });
      }
    };
    flag(wk); flag(mo);

    for (const b of [mo, wk]) {
      if (!b.computable) continue;
      const names = V.bucket.rows.slice(0, TOP_DRIVERS + 2).map(r => r.label);
      const ser = bucketSeries(recs, b.label === "month" ? "M" : "W", b.keys, names);
      for (const name of names) {
        const v = ser[name];
        const cur = v[v.length - 1], prev = v[v.length - 2];
        const chg = cur - prev;
        if (!prev) continue;
        const pc = 100 * chg / prev;
        if (Math.abs(pc) >= ANOM.bucket_pct_threshold && Math.abs(chg) >= ANOM.bucket_min_abs) {
          out.alerts.push({ level: chg > 0 ? "up" : "down", scope: "bucket",
            text: name + (chg > 0 ? " rose " : " fell ") + Math.round(Math.abs(pc)) + "% " +
              b.label + "-over-" + b.label + " (" + prev + " to " + cur + " cases, " +
              b.previous_key + " to " + b.current_key + ")." });
        }
      }
      break;
    }
    return out;
  }

  /* Volume and category mix per complete calendar period, with the direction and
     any peak stated in words. Complete periods only - a half-finished month would
     read as a collapse that never happened. */
  function periodMovement(recs, V, freq, label, drivers) {
    const { keys, counts } = series(recs, freq);
    if (keys.length < 2) {
      return { computable: false, label, periods: keys.length,
        reason: "only " + keys.length + " complete " + label + "(s) fall inside the data " +
          "range; 2+ are needed to show movement. Partial periods at the start and end of " +
          "the export are excluded on purpose.",
        needs: ["a date column covering 2+ complete " + label + "s"] };
    }
    const names = drivers.filter(d => !d.rolled).map(d => d.label);
    const rolled = drivers.find(d => d.rolled);
    const ser = bucketSeries(recs, freq, keys, V.bucket.rows.map(b => b.label));
    const stack = names.map(nm => ({ name: nm, values: ser[nm] || keys.map(() => 0) }));
    if (rolled) {
      const acc = keys.map(() => 0);
      for (const b of rolled.rolled) (ser[b] || []).forEach((v, i) => { acc[i] += v; });
      if (acc.some(v => v)) stack.push({ name: rolled.label, values: acc });
    }
    // the rolled-up row is a bag of leftover drivers, not a driver - it can never be
    // "the largest driver" and never earns a peak or growth insight of its own
    const named = stack.filter(s2 => s2.name !== VARIOUS);
    const totals = keys.map(k => counts[k]);
    const rows = keys.map((k, i) => {
      const prev = i ? totals[i - 1] : null;
      const delta = prev === null ? null : totals[i] - prev;
      let top = null;
      for (const s2 of named) if (!top || s2.values[i] > top.values[i]) top = s2;
      return { key: k, total: totals[i], delta,
        pct: prev ? Math.round(1000 * delta / prev) / 10 : null,
        top_bucket: top ? top.name : null, top_count: top ? top.values[i] : null,
        top_pct: top && totals[i] ? pct(top.values[i], totals[i]) : null };
    });

    const ins = [];
    let hi = 0, lo = 0;
    totals.forEach((v, i) => { if (v > totals[hi]) hi = i; if (v < totals[lo]) lo = i; });
    ins.push({ kind: "range", text: "Busiest " + label + " was " + keys[hi] + " at " +
      totals[hi] + " cases; quietest was " + keys[lo] + " at " + totals[lo] + "." });
    const first = totals[0], last = totals[totals.length - 1];
    if (first) {
      const move = 100 * (last - first) / first;
      const dir = move >= ANOM.trend_pct ? "rose"
        : move <= -ANOM.trend_pct ? "fell" : "held roughly flat";
      ins.push({ kind: move >= ANOM.trend_pct ? "up" : move <= -ANOM.trend_pct ? "down" : "flat",
        text: "Across " + keys.length + " " + label + "s volume " + dir +
          (Math.abs(move) < ANOM.trend_pct ? "" : " " + Math.round(Math.abs(move)) + "%") +
          ", from " + first + " in " + keys[0] + " to " + last + " in " + keys[keys.length - 1] + "." });
    }
    const lastRow = rows[rows.length - 1];
    if (lastRow.delta !== null && lastRow.pct !== null) {
      ins.push({ kind: lastRow.delta > 0 ? "up" : lastRow.delta < 0 ? "down" : "flat",
        text: "Latest " + label + " (" + keys[keys.length - 1] + ") is " +
          (lastRow.delta >= 0 ? "+" : "") + lastRow.delta + " case(s) on " +
          keys[keys.length - 2] + ", " + (lastRow.pct >= 0 ? "+" : "") +
          (Math.round(lastRow.pct * 10) / 10).toFixed(1) + "%." });
    }
    const peaks = [], moves = [];
    for (const s2 of named) {
      const v = s2.values;
      const mu = v.reduce((a, b) => a + b, 0) / v.length;
      let pi = 0;
      v.forEach((x, i) => { if (x > v[pi]) pi = i; });
      if (mu && v[pi] >= ANOM.peak_min && v[pi] >= ANOM.peak_ratio * mu) {
        peaks.push({ kind: "peak", text: s2.name + " peaked in " + keys[pi] + " at " + v[pi] +
          " cases — " + (Math.round(10 * v[pi] / mu) / 10).toFixed(1) + "x its " + label +
          " average of " + (Math.round(10 * mu) / 10).toFixed(1) + "." });
      }
      if (v.length >= 2 && v[0]) {
        const mv = 100 * (v[v.length - 1] - v[0]) / v[0];
        if (Math.abs(mv) >= ANOM.bucket_pct_threshold &&
            Math.abs(v[v.length - 1] - v[0]) >= ANOM.bucket_min_abs) {
          moves.push({ kind: mv > 0 ? "up" : "down", text: s2.name + (mv > 0 ? " grew " : " shrank ") +
            Math.round(Math.abs(mv)) + "% across the window (" + v[0] + " in " + keys[0] + " to " +
            v[v.length - 1] + " in " + keys[keys.length - 1] + ")." });
        }
      }
    }
    ins.push(...peaks, ...moves);
    return { computable: true, label, keys, totals, stack, rows, insights: ins };
  }

  function mostReceived(recs, V) {
    if (!V.bucket.rows.length) return null;
    const top = V.bucket.rows[0];
    const sub = recs.filter(r => r.bucket === top.label);
    const top_labels = counts(sub, "primary_category", sub.length).slice(0, 3)
      .map(x => ({ label: x.label, count: x.count }));
    let origin = null;
    if (sub.some(r => (r.case_origin ?? "") !== "")) {
      const o = counts(sub, "case_origin", sub.length)[0];
      origin = { label: o.label, count: o.count, pct: pct(o.count, sub.length) };
    }
    return { label: top.label, count: top.count, pct: top.pct, top_labels, origin,
             members: sub.some(r => r.mno)
               ? new Set(sub.map(r => r.mno).filter(Boolean)).size : null };
  }

  function mappingAudit(recs) {
    const m = new Map();
    for (const r of recs) {
      for (const t of r.tags_clean) {
        if (!m.has(t)) m.set(t, { label: t, bucket: bucketOf(t), count: 0 });
        m.get(t).count++;
      }
    }
    const items = [...m.values()].sort((a, b) =>
      a.bucket.localeCompare(b.bucket) || b.count - a.count);
    return { items, distinct: items.length,
             unmapped_count: items.filter(i => i.bucket === "Other / Unmapped").length };
  }

  return {
    buildRecords,
    run(recs) {
      const dateCol = derive(recs);
      const volume = volumeSection(recs, dateCol);
      return { volume, correlation: correlationSection(recs),
               forecast: forecastSection(volume), mapping: mappingAudit(recs),
               inference: inferenceAudit(recs), drivers: topDrivers(volume),
               anomaly: anomalySection(recs, volume), most_received: mostReceived(recs, volume),
               movement: {
                 monthly: periodMovement(recs, volume, "M", "month", topDrivers(volume)),
                 quarterly: periodMovement(recs, volume, "Q", "quarter", topDrivers(volume)),
               },
               quality: dataQuality(recs), cube: buildCube(recs, volume),
               deep_dives: allDeepDives(recs, volume) };
    },
  };
}
