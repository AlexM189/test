/* Analysis engine - a direct port of analyze.py, driven by the same rules.json
   (inlined as RULES at build time) so bucket mappings can never drift between
   the browser tool and the Python CLI. */

export function makeEngine(RULES) {
  const G = RULES.gates;
  const MIN_CASES_LIFT = G.min_cases_lift;
  const MIN_COOCCUR = G.min_cooccurrence;
  const MIN_PERIODS_FIT = G.min_periods_fit;
  const BUCKET_RULES = RULES.bucket_rules.map(([n, p]) => [n, new RegExp(p, "i")]);
  const SIGNALS = Object.entries(RULES.signals).map(([k, p]) => [k, new RegExp(p, "i")]);
  const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const ws = s => String(s ?? "").replace(/\s+/g, " ").trim();
  const pct = (n, d) => (d ? Math.round(1000 * n / d) / 10 : 0);

  /* ------------------------------------------------ header mapping */
  const lookup = new Map();
  for (const [canon, list] of Object.entries(RULES.aliases))
    for (const a of list) if (!lookup.has(a)) lookup.set(a, canon);

  function mapColumns(cols) {
    const mapping = {}, unmapped = [], seen = new Set();
    cols.forEach((c, i) => {
      const n = norm(c);
      let canon = lookup.get(n) || null;
      if (!canon) {
        let best = null;
        for (const [a, cn] of lookup)
          if (a.length >= 5 && n.includes(a) && (!best || a.length > best[0].length)) best = [a, cn];
        if (best) canon = best[1];
      }
      if (canon && !seen.has(canon)) { seen.add(canon); mapping[i] = canon; }
      else if (String(c).trim() !== "") unmapped.push(c);
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
  function bucketOf(tag) {
    const t = String(tag);
    for (const [name, re] of BUCKET_RULES) if (re.test(t)) return name;
    return "Other / Unmapped";
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
      prov.push({ file: t.file, sheet: t.sheet, status: "loaded", rows: n,
                  mapped: [...canon].sort(), unmapped });
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
      r.primary_category = r.tags[0] || "";
      r.bucket = r.primary_category ? bucketOf(r.primary_category) : "Other / Unmapped";
      r.tag_count = r.tags.length;
      const hay = (r.tags.join(" | ") + " | " + (r.subject || "")).toLowerCase();
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
      for (const t of r.tags) tagC.set(t, (tagC.get(t) || 0) + 1);
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

    chain("chain_hw_inactivity", "Hardware/meter instability → activity & reactivation contact",
      "hardware_meter", "activity", [],
      "Purge outcome requires a purged/inactive value in Member Status; case-level data alone " +
      "cannot confirm an involuntary purge.");
    chain("chain_reward_dupes", "Blocked rewards → repeat contact → outbound/callback load",
      "blocked_reward", "outbound_cb", hasMember ? [] : ["MNO (to link repeat contacts)"],
      "Bounced-email evidence needs an email-status or bounce field; not present in the columns seen so far.");
    chain("chain_google_lockout", "Google account migration → access lockout",
      "google_account", "password_access", ["member type / household role (primary vs secondary)"],
      "Secondary-member lockout and household attrition are NOT computable without a member-type " +
      "or household-link field.");
    chain("chain_field_service", "Field service / shipping → onboarding & setup contact",
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

  function mappingAudit(recs) {
    const m = new Map();
    for (const r of recs) {
      for (const t of r.tags) {
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
               forecast: forecastSection(volume), mapping: mappingAudit(recs) };
    },
  };
}
