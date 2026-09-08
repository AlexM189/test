/* Report renderer - port of render.py. Shares report.css, report-runtime.js and
   rules.json with the Python CLI; tools/crossvalidate.py checks the two engines
   still agree. Produces the full report body as an HTML string. */

export function makeRenderer(RULES, CSS, RUNTIME_JS) {
  const RISK = RULES.risk_profile;
  const MAXSERIES = 8;

  const ESC = s => String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" }[c]));
  const cvar = i => "var(--s" + (i % MAXSERIES + 1) + ")";
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const f2 = n => (Math.round(n * 100) / 100).toFixed(2);
  const f0 = n => String(Math.round(n));
  const th = n => Number(n).toLocaleString("en-US");

  function capSeries(rows, n) {
    n = n || MAXSERIES;
    if (rows.length <= n) return [rows, false];
    const head = rows.slice(0, n - 1), tail = rows.slice(n - 1);
    head.push({ label: "Other (" + tail.length + " labels)",
                count: tail.reduce((a, b) => a + b.count, 0),
                pct: Math.round(tail.reduce((a, b) => a + b.pct, 0) * 10) / 10 });
    return [head, true];
  }

  /* ---------------------------------------------------------- charts */
  function svgDonut(rows, total) {
    const W = 264, H = 264, cx = 132, rOut = 118, rIn = 72;
    if (!rows.length || total <= 0) return '<p class="sub">No data to plot.</p>';
    const p = [];
    let ang = -Math.PI / 2;
    const gap = rows.length > 1 ? 0.016 : 0;
    rows.forEach((row, i) => {
      const sweep = row.count / total * 2 * Math.PI;
      let a0 = ang + gap / 2, a1 = ang + sweep - gap / 2;
      ang += sweep;
      if (a1 <= a0) a1 = a0 + 0.004;
      const big = (a1 - a0) > Math.PI ? 1 : 0;
      const x0 = cx + rOut * Math.cos(a0), y0 = H / 2 + rOut * Math.sin(a0);
      const x1 = cx + rOut * Math.cos(a1), y1 = H / 2 + rOut * Math.sin(a1);
      const x2 = cx + rIn * Math.cos(a1), y2 = H / 2 + rIn * Math.sin(a1);
      const x3 = cx + rIn * Math.cos(a0), y3 = H / 2 + rIn * Math.sin(a0);
      const d = `M${x0.toFixed(2)} ${y0.toFixed(2)} A${rOut} ${rOut} 0 ${big} 1 ` +
        `${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)} ` +
        `A${rIn} ${rIn} 0 ${big} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
      const tip = row.tip || (row.label + " — " + row.count + " cases (" + f1(row.pct) + "%)");
      p.push(`<path d="${d}" fill="${row.color || cvar(i)}" data-tip="${ESC(tip)}"/>`);
    });
    p.push(`<text x="${cx}" y="${H / 2 + 2}" text-anchor="middle" font-size="30" font-weight="700" ` +
      `fill="var(--text)" style="font-variant-numeric:tabular-nums">${th(total)}</text>`);
    p.push(`<text x="${cx}" y="${H / 2 + 22}" text-anchor="middle" font-size="11.5" ` +
      `fill="var(--text-3)" letter-spacing=".07em">CASES</text>`);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" style="max-width:300px;margin:0 auto">${p.join("")}</svg>`;
  }

  function svgHbar(rows, total, seriesColor, labelW, W) {
    labelW = labelW || 178; W = W || 720;
    if (!rows.length) return '<p class="sub">No data to plot.</p>';
    const rowh = 30, gap = 9;
    const H = rows.length * (rowh + gap) + 6;
    const barX = labelW + 8, barW = W - barX - 78;
    const mx = Math.max(...rows.map(r => r.count)) || 1;
    const p = [];
    rows.forEach((row, i) => {
      const y = i * (rowh + gap);
      const w = Math.max(barW * row.count / mx, 3);
      const col = row.color || seriesColor || cvar(i);
      const lbl = row.label;
      const short = lbl.length <= 30 ? lbl : lbl.slice(0, 29) + "…";
      p.push(`<text x="${labelW}" y="${(y + rowh * 0.68).toFixed(1)}" text-anchor="end" ` +
        `font-size="12.5" fill="var(--text-2)">${ESC(short)}<title>${ESC(lbl)}</title></text>`);
      const tip = row.tip || (lbl + " — " + row.count + " cases (" + f1(row.pct) + "%)");
      p.push(`<rect x="${barX}" y="${y.toFixed(1)}" width="${w.toFixed(2)}" height="${rowh}" ` +
        `rx="4" fill="${col}" data-tip="${ESC(tip)}"/>`);
      p.push(`<text x="${(barX + w + 9).toFixed(1)}" y="${(y + rowh * 0.68).toFixed(1)}" ` +
        `font-size="12.5" font-weight="640" fill="var(--text)" ` +
        `style="font-variant-numeric:tabular-nums">${th(row.count)} ` +
        `<tspan fill="var(--text-3)" font-weight="400">(${f1(row.pct)}%)</tspan></text>`);
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" ` +
      `preserveAspectRatio="xMinYMid meet" role="img">${p.join("")}</svg>`;
  }

  function svgLine(months, series, ylab) {
    ylab = ylab || "cases";
    const W = 720, H = 300, pl = 46, pb = 34, pt = 14, pr = 14;
    const pw = W - pl - pr, ph = H - pt - pb;
    const all = series.flatMap(s => s.values);
    const mx = Math.max(...(all.length ? all : [0])) || 1;
    const n = months.length;
    const X = i => pl + pw * i / Math.max(n - 1, 1);
    const Y = v => pt + ph - ph * v / mx;
    const p = [];
    for (let g = 0; g < 5; g++) {
      const y = pt + ph * g / 4;
      p.push(`<line x1="${pl}" y1="${y.toFixed(1)}" x2="${W - pr}" y2="${y.toFixed(1)}" ` +
        `stroke="var(--border)" stroke-width="1"/>`);
      p.push(`<text x="${pl - 7}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="11" ` +
        `fill="var(--text-3)">${Math.round(mx * (4 - g) / 4)}</text>`);
    }
    const step = Math.max(1, Math.ceil(n / 14));
    months.forEach((m, i) => {
      if (i % step === 0 || i === n - 1)
        p.push(`<text x="${X(i).toFixed(1)}" y="${H - pb + 18}" text-anchor="middle" ` +
          `font-size="11" fill="var(--text-3)">${ESC(m)}</text>`);
    });
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
      p.push(`<polyline points="${pts}" fill="none" stroke="${cvar(si)}" stroke-width="2" ` +
        `stroke-linejoin="round" stroke-linecap="round"/>`);
      s.values.forEach((v, i) => {
        p.push(`<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="4.5" fill="${cvar(si)}" ` +
          `stroke="var(--surface)" stroke-width="2" data-tip="${ESC(months[i] + " · " +
          s.name + ": " + v + " " + ylab)}"/>`);
      });
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" ` +
      `preserveAspectRatio="xMinYMid meet" role="img">${p.join("")}</svg>`;
  }

  function svgForecast(hist, proj) {
    const W = 720, H = 320, pl = 50, pb = 36, pt = 16, pr = 16;
    const pw = W - pl - pr, ph = H - pt - pb;
    const labels = hist.map(h => h.label).concat(proj.map(q => q.label));
    const n = labels.length;
    const mx = Math.max(...hist.map(h => h.point), ...proj.map(q => q.high), 1);
    const X = i => pl + pw * i / Math.max(n - 1, 1);
    const Y = v => pt + ph - ph * v / mx;
    const p = [];
    for (let g = 0; g < 5; g++) {
      const y = pt + ph * g / 4;
      p.push(`<line x1="${pl}" y1="${y.toFixed(1)}" x2="${W - pr}" y2="${y.toFixed(1)}" ` +
        `stroke="var(--border)" stroke-width="1"/>`);
      p.push(`<text x="${pl - 7}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="11" ` +
        `fill="var(--text-3)">${Math.round(mx * (4 - g) / 4)}</text>`);
    }
    const step = Math.max(1, Math.floor(n / 12));
    labels.forEach((l, i) => {
      if (i % step === 0 || i >= hist.length)
        p.push(`<text x="${X(i).toFixed(1)}" y="${H - pb + 18}" text-anchor="middle" ` +
          `font-size="10.5" fill="var(--text-3)">${ESC(l)}</text>`);
    });
    const b = hist.length - 1;
    if (b >= 0) {
      p.push(`<line x1="${X(b).toFixed(1)}" y1="${pt}" x2="${X(b).toFixed(1)}" y2="${pt + ph}" ` +
        `stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="3 3"/>`);
      p.push(`<text x="${(X(b) + 6).toFixed(1)}" y="${pt + 11}" font-size="10.5" ` +
        `fill="var(--text-3)">projection →</text>`);
    }
    if (hist.length && proj.length) {
      const top = [[X(b), Y(hist[hist.length - 1].point)]]
        .concat(proj.map((q, i) => [X(b + 1 + i), Y(q.high)]));
      const bot = proj.map((q, i) => [X(b + 1 + i), Y(q.low)]).reverse()
        .concat([[X(b), Y(hist[hist.length - 1].point)]]);
      const pts = top.concat(bot).map(t => `${t[0].toFixed(1)},${t[1].toFixed(1)}`).join(" ");
      p.push(`<polygon points="${pts}" fill="var(--s1)" opacity=".14"/>`);
    }
    const hp = hist.map((h, i) => `${X(i).toFixed(1)},${Y(h.point).toFixed(1)}`).join(" ");
    p.push(`<polyline points="${hp}" fill="none" stroke="var(--s1)" stroke-width="2" ` +
      `stroke-linejoin="round"/>`);
    const fp = (hist.length ? [`${X(b).toFixed(1)},${Y(hist[hist.length - 1].point).toFixed(1)}`] : [])
      .concat(proj.map((q, i) => `${X(b + 1 + i).toFixed(1)},${Y(q.point).toFixed(1)}`)).join(" ");
    p.push(`<polyline points="${fp}" fill="none" stroke="var(--s1)" stroke-width="2" ` +
      `stroke-dasharray="6 4" stroke-linejoin="round"/>`);
    hist.forEach((h, i) => {
      p.push(`<circle cx="${X(i).toFixed(1)}" cy="${Y(h.point).toFixed(1)}" r="4" fill="var(--s1)" ` +
        `stroke="var(--surface)" stroke-width="2" data-tip="${ESC(h.label + " observed: " +
        h.point + " cases")}"/>`);
    });
    proj.forEach((q, i) => {
      p.push(`<circle cx="${X(b + 1 + i).toFixed(1)}" cy="${Y(q.point).toFixed(1)}" r="4.5" ` +
        `fill="var(--surface)" stroke="var(--s1)" stroke-width="2.5" data-tip="${ESC(q.label +
        " projected: " + q.point + " cases (range " + q.low + "–" + q.high + ")")}"/>`);
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" role="img">${p.join("")}</svg>`;
  }

  /* One bar per period: height is volume, segments are the five drivers - so a
     rise or fall and a category peak are both readable off the same chart. */
  function svgStacked(keys, stack, totals) {
    const W = 720, H = 340, pl = 46, pb = 40, pt = 26, pr = 12;
    const pw = W - pl - pr, ph = H - pt - pb;
    const n = keys.length;
    const mx = Math.max(...totals, 1);
    const slot = pw / Math.max(n, 1);
    const bw = Math.min(slot * 0.66, 54);
    const X = i => pl + slot * (i + 0.5) - bw / 2;
    const Y = v => pt + ph - ph * v / mx;
    const p = [];
    for (let g = 0; g < 5; g++) {
      const y = pt + ph * g / 4;
      p.push(`<line x1="${pl}" y1="${y.toFixed(1)}" x2="${W - pr}" y2="${y.toFixed(1)}" ` +
        `stroke="var(--border)" stroke-width="1"/>`);
      p.push(`<text x="${pl - 7}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="11" ` +
        `fill="var(--text-3)">${Math.round(mx * (4 - g) / 4)}</text>`);
    }
    const step = Math.max(1, Math.floor((n + 13) / 14));
    keys.forEach((k, i) => {
      if (i % step === 0 || i === n - 1)
        p.push(`<text x="${(X(i) + bw / 2).toFixed(1)}" y="${H - pb + 17}" text-anchor="middle" ` +
          `font-size="10.5" fill="var(--text-3)">${ESC(k)}</text>`);
    });
    for (let i = 0; i < n; i++) {
      let acc = 0;
      const segs = [];
      stack.forEach((s2, si) => { if (s2.values[i] > 0) segs.push([si, s2.values[i]]); });
      segs.forEach(([si, v], j) => {
        const y0 = Y(acc + v), y1 = Y(acc);
        const h = Math.max(y1 - y0 - (j < segs.length - 1 ? 2 : 0), 1);
        const tip = ESC(keys[i] + " · " + stack[si].name + ": " + v + " cases");
        if (j === segs.length - 1) {
          const r = Math.min(4, h / 2, bw / 2);
          const d = `M${X(i).toFixed(2)} ${(y0 + h).toFixed(2)} L${X(i).toFixed(2)} ` +
            `${(y0 + r).toFixed(2)} Q${X(i).toFixed(2)} ${y0.toFixed(2)} ` +
            `${(X(i) + r).toFixed(2)} ${y0.toFixed(2)} L${(X(i) + bw - r).toFixed(2)} ` +
            `${y0.toFixed(2)} Q${(X(i) + bw).toFixed(2)} ${y0.toFixed(2)} ` +
            `${(X(i) + bw).toFixed(2)} ${(y0 + r).toFixed(2)} L${(X(i) + bw).toFixed(2)} ` +
            `${(y0 + h).toFixed(2)} Z`;
          p.push(`<path d="${d}" fill="${cvar(si)}" data-tip="${tip}"/>`);
        } else {
          p.push(`<rect x="${X(i).toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" ` +
            `height="${h.toFixed(1)}" fill="${cvar(si)}" data-tip="${tip}"/>`);
        }
        acc += v;
      });
      if (totals[i]) {
        p.push(`<text x="${(X(i) + bw / 2).toFixed(1)}" y="${(Y(totals[i]) - 7).toFixed(1)}" ` +
          `text-anchor="middle" font-size="11" font-weight="640" fill="var(--text-2)" ` +
          `style="font-variant-numeric:tabular-nums">${totals[i]}</text>`);
      }
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" role="img">` +
      `${p.join("")}</svg>`;
  }

  const INS_WORD = { up: "rising", down: "falling", peak: "peak", flat: "flat", range: "range" };

  const insightList = insights => '<ul class="ins">' + insights.map(i =>
    `<li><span class="k ${i.kind}">${INS_WORD[i.kind] || i.kind}</span>` +
    `<span>${ESC(i.text)}</span></li>`).join("") + "</ul>";

  function movementTable(mv) {
    const cap = mv.label.charAt(0).toUpperCase() + mv.label.slice(1);
    const h = [`<div class="scroll"><table><thead><tr><th>${ESC(cap)}</th>` +
      '<th class="n">Cases</th><th class="n">Change</th><th class="n">%</th>' +
      '<th>Largest driver</th><th class="n">Its share</th></tr></thead><tbody>'];
    for (const r of mv.rows) {
      const d = r.delta;
      const cls = (d === null || d === 0) ? "" : (d > 0 ? " delta-up" : " delta-down");
      h.push(`<tr><td><b>${ESC(r.key)}</b></td><td class="n">${r.total}</td>` +
        `<td class="n${cls}">${d === null ? "—" : (d >= 0 ? "+" : "") + d}</td>` +
        `<td class="n${cls}">${r.pct === null ? "—" :
          (r.pct >= 0 ? "+" : "") + f1(r.pct) + "%"}</td>` +
        `<td>${ESC(r.top_bucket || "—")}</td><td class="n">${r.top_pct === null ? "—" :
          r.top_count + " (" + f1(r.top_pct) + "%)"}</td></tr>`);
    }
    h.push("</tbody></table></div>");
    return h.join("");
  }

  const ADJ = { month: "Monthly", quarter: "Quarterly", week: "Weekly" };

  function movementBlock(mv) {
    if (!mv || !mv.computable) {
      return naBlock((ADJ[mv && mv.label] || "Period") + " movement", mv || {});
    }
    const out = [insightList(mv.insights), svgStacked(mv.keys, mv.stack, mv.totals)];
    out.push('<div class="legend">' + mv.stack.map((s2, i) =>
      `<span><span class="swatch" style="background:${cvar(i)}"></span>${ESC(s2.name)}</span>`)
      .join("") + "</div>");
    out.push(`<p class="sub">Bar height is total volume for the ${mv.label}; segments are the ` +
      `five call drivers. Only complete calendar ${mv.label}s are shown — a partial period at ` +
      "either end of the export is excluded so it cannot read as a collapse.</p>");
    out.push(movementTable(mv));
    return out.join("");
  }

  function facetBlock(f, n) {
    if (!f.rows.length) {
      return `<p class="sub"><b>${ESC(f.name)}</b> — no term in this facet matched any case.</p>`;
    }
    return `<h4>${ESC(f.name)}</h4>` + svgHbar(f.rows.slice(0, 8), n, null, 210, 640) +
      `<p class="sub">${th(f.matched)} of ${th(n)} cases in this family matched at least one ` +
      `term (${f1(f.coverage_pct)}%); ${th(f.unmatched)} matched none. A case can match several ` +
      "terms, so the bars deliberately sum above the case count.</p>";
  }

  function crossHeat(c) {
    const mx = Math.max(...c.matrix.map(r => Math.max(...r, 0)), 0) || 1;
    const h = [`<div class="scroll"><table><thead><tr><th>${ESC(c.a_name)} \\ ` +
      `${ESC(c.b_name)}</th>`];
    c.b.forEach(b => h.push(`<th class="n">${ESC(b)}</th>`));
    h.push('<th class="n">Total</th></tr></thead><tbody>');
    c.a.forEach((a, i) => {
      h.push(`<tr><td><b>${ESC(a)}</b></td>`);
      c.b.forEach((b, j) => {
        const v = c.matrix[i][j];
        const stp = v === 0 ? 0 : Math.min(6, 1 + Math.floor(5 * v / mx));
        const style = v === 0 ? "" :
          `background:var(--seq${stp});color:${stp >= 3 ? "#fff" : "var(--text)"}`;
        h.push(`<td class="n" style="${style}" data-tip="${ESC(a + " + " + b + ": " + v +
          " cases")}">${v || "–"}</td>`);
      });
      h.push(`<td class="n"><b>${c.row_totals[i]}</b></td></tr>`);
    });
    h.push("</tbody></table></div>");
    return h.join("");
  }

  function deepDiveBlock(dd) {
    if (!dd.facets) return naBlock(dd.title.replace(/&amp;/g, "&"), dd);
    const n = dd.cases;
    const h = [];
    const tiles = [["Cases in family", th(n), f1(dd.pct_of_total) + "% of all cases"],
      ["With free text", f1(dd.pct_with_free_text) + "%",
       th(dd.with_free_text) + " of " + th(n) + " carry a subject or description"]];
    const bsrc = dd.by_source || {};
    if (bsrc.subject) tiles.push(["Placed by subject",
      f1(100 * bsrc.subject / n) + "%",
      th(bsrc.subject) + " case(s) had no usable category value"]);
    const T = dd.trend || {};
    if (T.computable) {
      tiles.push(["Month over month",
        (T.mom_change >= 0 ? "+" : "") + T.mom_change +
        (T.mom_pct === null ? "" : " (" + (T.mom_pct >= 0 ? "+" : "") + f1(T.mom_pct) + "%)"),
        T.cur_key + " vs " + T.prev_key]);
      tiles.push(["Across " + T.months + " months",
        T.window_pct === null ? "—" : (T.window_pct >= 0 ? "+" : "") + f1(T.window_pct) + "%",
        T.total_window_pct === null ? "first to last complete month"
          : "all cases moved " + (T.total_window_pct >= 0 ? "+" : "") +
            f1(T.total_window_pct) + "% over the same window"]);
      tiles.push(["Peak month", T.peak_key,
        th(T.peak_value) + " cases, " + f1(T.peak_ratio || 0) +
        "x this family's monthly average"]);
    }
    const rp = dd.repeat || {};
    if (rp.computable) tiles.push(["Repeat contact", f1(rp.pct_cases_from_repeat) + "%",
      "of this family's cases come from members with 2+ cases here"]);
    if (dd.facets.length && dd.facets[0].rows.length) {
      const t = dd.facets[0].rows[0];
      tiles.push(["Top " + dd.facets[0].name.split("/")[0].trim().toLowerCase(),
        f0(t.pct) + "%", t.label + " (" + th(t.count) + " cases)"]);
    }
    h.push('<div class="stats">' + tiles.slice(0, 6).map(([k, v, d]) =>
      `<div class="stat"><div class="k">${ESC(k)}</div><div class="v num">${ESC(v)}</div>` +
      `<div class="d">${ESC(d)}</div></div>`).join("") + "</div>");
    if (T.computable) {
      const sc = T.share_change;
      const word = sc > 0 ? "gained" : sc < 0 ? "lost" : "held";
      h.push('<p class="sub">Share of all cases moved from <b>' + f1(T.share_first) +
        "%</b> in " + ESC(T.first_key) + " to <b>" + f1(T.share_last) + "%</b> in " +
        ESC(T.cur_key) + " — " + word + " <b>" + f1(Math.abs(sc)) + "</b> percentage " +
        "point(s). Share matters separately from volume: a family can shrink while the " +
        "operation shrinks faster, which is a rising share, not a win.</p>");
    }

    const bs = dd.by_source || {};
    const inferred = bs.subject || 0;
    h.push("<h4>Categories inside this family</h4>");
    if ((dd.top_categories || []).length) {
      h.push(svgHbar(dd.top_categories.slice(0, 6), n, "var(--s1)", 250, 640));
    } else {
      h.push('<p class="sub">No case in this family carries a real category label.</p>');
    }
    let note = "Only the <b>" + th(dd.categories_charted || 0) +
      " case(s)</b> that carry a real category label are charted.";
    if (inferred) {
      note += " The other <b>" + th(inferred) + "</b> reached this family through the " +
        "<b>subject line</b>, because their Category cell held a placeholder (a bare number, " +
        "N/A) or a label the knowledge base does not list — there is no real category to chart " +
        "for them, so they are counted here rather than plotted. Their facet counts below " +
        "still include them.";
    }
    if (bs.none) {
      note += " A further <b>" + th(bs.none) + "</b> could not be placed from either field.";
    }
    h.push('<p class="sub">' + note + "</p>");
    for (const f of dd.facets) h.push(facetBlock(f, n));

    if (dd.cross) {
      h.push(`<h4>${ESC(dd.cross.a_name)} against ${ESC(dd.cross.b_name)}</h4>`);
      h.push(crossHeat(dd.cross));
      h.push('<p class="sub">Cases where both terms appear in the same free text. This is ' +
        "co-occurrence in one case, not a proven cause.</p>");
    }
    if ((dd.monthly || {}).computable) {
      h.push("<h4>Volume for this family by month</h4>");
      h.push(svgLine(dd.monthly.keys, [{ name: "cases", values: dd.monthly.values }]));
    }
    return h.join("");
  }

  function heatTable(ct) {
    const mx = Math.max(...ct.matrix.map(r => Math.max(...r, 0)), 0) || 1;
    const h = ['<div class="scroll"><table><thead><tr><th>Origin \\ Category bucket</th>'];
    ct.buckets.forEach(b => h.push(`<th class="n">${ESC(b)}</th>`));
    h.push('<th class="n">Total</th></tr></thead><tbody>');
    ct.origins.forEach((o, i) => {
      h.push(`<tr><td><b>${ESC(o)}</b></td>`);
      ct.buckets.forEach((b, j) => {
        const v = ct.matrix[i][j];
        const stp = v === 0 ? 0 : Math.min(6, 1 + Math.floor(5 * v / mx));
        const style = v === 0 ? "" :
          `background:var(--seq${stp});color:${stp >= 3 ? "#fff" : "var(--text)"}`;
        h.push(`<td class="n" style="${style}" data-tip="${ESC(o + " x " + b + ": " + v +
          " cases")}">${v || "–"}</td>`);
      });
      h.push(`<td class="n"><b>${ct.row_totals[i]}</b></td></tr>`);
    });
    h.push("<tr><td><b>Total</b></td>");
    ct.col_totals.forEach(t => h.push(`<td class="n"><b>${t}</b></td>`));
    h.push(`<td class="n"><b>${ct.col_totals.reduce((a, b) => a + b, 0)}</b></td></tr></tbody></table></div>`);
    return h.join("");
  }

  function distTable(rows, total, head) {
    const h = [`<div class="scroll"><table><thead><tr><th>${ESC(head)}</th>` +
      `<th class="n">Cases</th><th class="n">% of total</th></tr></thead><tbody>`];
    rows.forEach((r, i) => {
      h.push(`<tr${r.color ? ' class="various"' : ""}><td><span class="swatch" ` +
        `style="background:${r.color || cvar(i)}"></span>${ESC(r.label)}</td>` +
        `<td class="n">${th(r.count)}</td><td class="n">${f1(r.pct)}%</td></tr>`);
    });
    h.push(`<tr><td><b>Total</b></td><td class="n"><b>${th(total)}</b></td>` +
      `<td class="n"><b>100.0%</b></td></tr></tbody></table></div>`);
    return h.join("");
  }

  const legend = rows => '<div class="legend">' + rows.map((r, i) =>
    `<span><span class="swatch" style="background:${r.color || cvar(i)}"></span>` +
    `${ESC(r.label)}</span>`).join("") + "</div>";

  /* Collapse a {bucket: [values]} map onto the driver set, rolling every
     non-driver bucket into the single Various row - so every chart in the
     report shows the same five things. */
  function foldSeries(byBucket, drivers) {
    const names = drivers.filter(d => !d.rolled).map(d => d.label);
    const rolled = drivers.find(d => d.rolled);
    const out = names.filter(nm => byBucket[nm]).map(nm => ({ name: nm, values: byBucket[nm] }));
    if (rolled) {
      const first = Object.values(byBucket)[0] || [];
      const acc = first.map(() => 0);
      for (const b of rolled.rolled)
        (byBucket[b] || []).forEach((v, i) => { acc[i] += v; });
      if (acc.some(v => v)) out.push({ name: rolled.label, values: acc });
    }
    return out;
  }

  function foldCrosstab(ct, drivers) {
    const names = drivers.filter(d => !d.rolled).map(d => d.label);
    const rolled = drivers.find(d => d.rolled);
    const idx = new Map(ct.buckets.map((b, i) => [b, i]));
    let cols = names.filter(b => idx.has(b));
    let M = ct.matrix.map(row => cols.map(b => row[idx.get(b)]));
    if (rolled) {
      const extra = rolled.rolled.filter(b => idx.has(b)).map(b => idx.get(b));
      if (extra.length) {
        cols = cols.concat([rolled.label]);
        M = M.map((row, r) => row.concat([extra.reduce((a, i) => a + ct.matrix[r][i], 0)]));
      }
    }
    return { computable: true, origins: ct.origins, buckets: cols, matrix: M,
             row_totals: M.map(r => r.reduce((a, b) => a + b, 0)),
             col_totals: cols.map((_, j) => M.reduce((a, r) => a + r[j], 0)) };
  }

  /* Tooltip for the rolled-up row: name what is actually inside it. */
  function rolledTip(d, top) {
    top = top || 5;
    const det = d.rolled_detail || [];
    if (!det.length) return null;
    const head = det.slice(0, top).map(x => x.label + " " + th(x.count)).join("; ");
    const more = det.length > top ? "; +" + (det.length - top) + " more" : "";
    return d.label + " — " + th(d.count) + " cases (" + f1(d.pct) + "%) across " +
      det.length + " categories: " + head + more;
  }
  /* the roll-up is a bag of leftovers, not a driver to look at, so it recedes */
  const withTips = drivers => drivers.map(d => {
    const row = { label: d.label, count: d.count, pct: d.pct };
    const t = rolledTip(d);
    if (t) { row.tip = t; row.color = "var(--rollup)"; }
    return row;
  });

  function driversTable(drivers, total) {
    const h = ['<div class="scroll"><table><thead><tr><th>#</th><th>Call driver</th>' +
      '<th class="n">Rank by volume</th><th class="n">Cases</th>' +
      '<th class="n">% of total</th></tr></thead><tbody>'];
    drivers.forEach((d, i) => {
      const det = d.rolled_detail || [];
      const tip = det.length
        ? ` title="${ESC(det.map(x => x.label + " (" + th(x.count) + ")").join("; "))}"` : "";
      const vr = d.volume_rank ? `#${d.volume_rank} of ${d.driver_count || 0}` : "—";
      h.push(`<tr${d.rolled ? ' class="various"' : ""}>` +
        `<td class="n">${d.rolled ? "—" : d.rank}</td>` +
        `<td${tip}><span class="swatch" style="background:${d.rolled ? "var(--rollup)" : cvar(i)}">` +
        `</span>${ESC(d.label)}` +
        (d.rolled ? ` <span style='color:var(--text-3)'>(${d.rolled.length} categories)</span>` : "") +
        (d.pinned ? ' <span class="pill p3" style="font-size:.6rem">always shown</span>' : "") +
        `</td><td class="n">${vr}</td><td class="n">${th(d.count)}</td>` +
        `<td class="n">${f1(d.pct)}%</td></tr>`);
    });
    h.push(`<tr><td></td><td><b>Total</b></td><td></td><td class="n"><b>${th(total)}</b></td>` +
      `<td class="n"><b>100.0%</b></td></tr></tbody></table></div>`);
    return h.join("");
  }

  function naBlock(title, rec) {
    const needs = rec.needs || rec.missing_fields || [];
    const h = [`<div class="na"><div class="t">${ESC(title)}</div><p>${ESC(rec.reason || "")}</p>`];
    if (needs.length) h.push("<p style='margin-bottom:.2em'>Required to compute this:</p><ul>" +
      needs.map(x => `<li>${ESC(x)}</li>`).join("") + "</ul>");
    if (rec.note) h.push(`<p><i>${ESC(rec.note)}</i></p>`);
    h.push("</div>");
    return h.join("");
  }

  /* ---------------------------------------------------------- narrative */
  function buildFindings(V, C) {
    const f = [], n = V.total_cases, b = V.bucket.rows;
    if (b.length) {
      const t = b[0];
      f.push([`Demand concentrates in ${t.label}`,
        `${th(t.count)} of ${th(n)} cases (${f1(t.pct)}%) carry ${t.label} as their primary ` +
        `category. The top two buckets together account for ` +
        `${f1(b.slice(0, 2).reduce((a, x) => a + x.pct, 0))}% of all contacts.`]);
    }
    const tl = V.tag_load;
    if (tl.mean_tags_per_case > 1.2) {
      f.push(["Cases are multi-issue, so single-category routing understates real demand",
        `Cases carry ${f2(tl.mean_tags_per_case)} category tags on average and ` +
        `${f1(tl.multi_tag_pct)}% carry more than one (${th(tl.distinct_tags)} distinct labels ` +
        `in use). Counting only the primary category hides ${th(tl.total_tags - n)} secondary ` +
        `topic tags that agents still had to handle.`]);
    }
    if (V.origin.computable && V.origin.rows.length) {
      const t = V.origin.rows[0];
      f.push([`${t.label} dominates contact volume`,
        `${th(t.count)} of ${th(n)} cases (${f1(t.pct)}%) arrive via ${t.label} across ` +
        `${V.origin.rows.length} origin(s) in use. Deflection and self-service capacity should be ` +
        `sized against that channel first.`]);
    }
    const rc = C.repeat_contact || {};
    if (rc.computable && rc.members_with_multiple_cases > 0) {
      f.push(["Repeat contact is measurable at member level",
        `${th(rc.members_with_multiple_cases)} of ${th(rc.members)} members ` +
        `(${f1(rc.pct_members_repeat)}%) opened more than one case, generating ` +
        `${th(rc.cases_from_repeat_members)} cases (${f1(rc.pct_cases_from_repeat)}% of volume); ` +
        `the highest single member opened ${th(rc.max_cases_one_member)}.`]);
    }
    for (const k of ["chain_hw_inactivity", "chain_activity_withdraw", "chain_reward_dupes",
                     "chain_bounce_withdraw", "chain_google_lockout", "chain_field_service"]) {
      const ch = C[k] || {};
      if (ch.computable && (ch.lift || 0) >= 1.2) {
        f.push([`Confirmed link: ${ch.title}`,
          `Of the ${ch.n_a} cases carrying the leading signal, ${f1(ch.pct_of_a_with_b)}% also ` +
          `carry the downstream signal, against a ${f1(ch.base_rate_b)}% base rate — a lift of ` +
          `${f2(ch.lift)}x (n=${ch.joint} joint).`]);
      }
    }
    return f.slice(0, 3);
  }

  const buildRisks = V => V.bucket.rows.slice(0, 6).map(r => {
    const p = RISK[r.label] || { threat: "Unclassified", owner: "Support Ops" };
    return { bucket: r.label, count: r.count, pct: r.pct, threat: p.threat, owner: p.owner };
  });

  function buildRecs(V, C) {
    const recs = [], n = V.total_cases, missing = [];
    if (V.date_field_is_proxy) missing.push(["Created On / case-open timestamp",
      "Every trend, seasonality and 'within N days' figure in this report is currently anchored " +
      "to Modified On, which records last touch, not arrival."]);
    if (!(V.site || {}).computable) missing.push(["Office / site",
      "No site-level breakdown of volume or mix is possible."]);
    if (!(V.agent || {}).computable) missing.push(["Agent / case owner",
      "No handling-side variance analysis is possible."]);
    for (const k of ["chain_google_lockout", "chain_field_service"]) {
      const c = C[k] || {};
      for (const m of (c.missing_fields || c.needs || []))
        if (!/larger export/i.test(m)) missing.push([m, c.note || ""]);
    }
    const seen = new Set(), miss = [];
    for (const [m, why] of missing) {
      if (seen.has(m.toLowerCase())) continue;
      seen.add(m.toLowerCase()); miss.push([m, why]);
    }
    if (miss.length) recs.push({ pri: 1, horizon: "Quick win (0–30 days)",
      owner: "Support Ops / CRM administration",
      title: `Add ${miss.length} missing field(s) to the case export`,
      body: "The export currently supports volume and mix analysis but blocks several causal " +
        "tests outright. Adding these fields costs a report definition change, not a system " +
        "change: " + miss.map(([m, w]) => `<b>${ESC(m)}</b> — ${ESC(w)}`).join("; ") + ".",
      tie: "Ties to the NOT COMPUTABLE panels in sections 3 and 4." });

    if (V.bucket.rows.length) {
      const t = V.bucket.rows[0];
      const p = RISK[t.label] || { threat: "Unclassified", owner: "Support Ops" };
      recs.push({ pri: 1, horizon: "Quick win (0–30 days)", owner: p.owner,
        title: `Attack the ${t.label} driver first`,
        body: `${ESC(t.label)} is the largest single primary category at ${f1(t.pct)}% of cases ` +
          `(${t.count} of ${n}). Any deflection built here has the widest reach; the associated ` +
          `exposure is ${ESC(p.threat.toLowerCase())}.`,
        tie: "Ties to Finding 1 and section 1's category breakdown." });
    }
    const tl = V.tag_load;
    if (tl.mean_tags_per_case > 1.2) recs.push({ pri: 2, horizon: "This quarter",
      owner: "Support Ops (taxonomy owner)",
      title: "Split the multi-topic case into countable units",
      body: `At ${f2(tl.mean_tags_per_case)} tags per case and ${f1(tl.multi_tag_pct)}% of cases ` +
        "multi-tagged, a single case can conceal an equipment fault, a reward dispute and a " +
        "password reset at once. Either capture a required primary reason with explicit " +
        "sub-reasons, or emit one case line per topic, so demand sizing and AHT attribution stop " +
        "disagreeing.",
      tie: "Ties to Finding 2 and the tag-load table in section 1." });

    if (V.origin.computable && V.origin.rows.length && V.origin.rows[0].pct >= 50) {
      const t = V.origin.rows[0];
      recs.push({ pri: 2, horizon: "This quarter", owner: "WFM / Support Ops",
        title: `Size deflection against ${t.label} before adding headcount`,
        body: `${f1(t.pct)}% of contacts arrive on ${ESC(t.label)}. Channel concentration at this ` +
          "level means capacity planning, IVR routing and self-service ROI all hinge on that " +
          "single origin.",
        tie: "Ties to Finding 3 and section 1's origin split." });
    }
    if (!(C.discovered || {}).computable) recs.push({ pri: 3, horizon: "Next 2–3 quarters",
      owner: "Analytics / Support Ops",
      title: "Re-run this analysis on a full-period export",
      body: "Correlation and forecasting are gated off at the current record count. The same " +
        "pipeline produces the quantified chains, the discovered correlations and a fitted " +
        "four-quarter forecast once a multi-month export is supplied — no rework required.",
      tie: "Ties to the gates stated in sections 3 and 4." });
    return recs;
  }

  /* ---------------------------------------------------------- document */
  function buildBody(res, meta) {
    const V = res.volume, C = res.correlation, Fc = res.forecast, MAP = res.mapping;
    const n = V.total_cases;
    const preview = n < (RULES.gates.preview_below || 30);
    const H = [];
    const A = s => H.push(s);

    A('<div class="toolbar"><button class="btn" id="themeBtn" type="button">Light / dark</button>' +
      '<button class="btn" id="printBtn" type="button">Print / PDF</button></div>');
    A('<div class="wrap">');
    A('<header class="rpt"><p class="eyebrow">Executive report · Panelist Support Operations</p>' +
      '<h1>Panelist Support: Case Volume, Correlations &amp; Four-Quarter Outlook</h1>' +
      `<p class="sub">${ESC(V.date_min ? "Coverage " + V.date_min + " to " + V.date_max
        : "No usable date field")} &nbsp;·&nbsp; ${th(n)} case record(s) from ` +
      `${meta.file_count} source file(s) &nbsp;·&nbsp; Generated ` +
      `${new Date().toISOString().slice(0, 10)}</p></header>`);

    if (preview) A('<div class="callout"><div class="t">Small sample — read as a layout preview' +
      `</div>Only <b>${n} record(s)</b> were loaded. Every figure below is arithmetically correct ` +
      "for those rows and should not be read as an operational result. Panels that require a " +
      "real sample size are gated off and say so explicitly.</div>");

    // executive summary
    A('<section class="card"><h2>Executive summary</h2>');
    const tiles = [["Total cases", th(n), "All records after de-duplication"]];
    if (V.unique_members) tiles.push(["Unique members", th(V.unique_members),
      f2(n / V.unique_members) + " cases per member"]);
    if (V.bucket.rows.length) {
      const t = V.bucket.rows[0];
      tiles.push(["Top category", f0(t.pct) + "%", `${t.label} (${th(t.count)} cases)`]);
    }
    if (V.origin.computable && V.origin.rows.length) {
      const t = V.origin.rows[0];
      tiles.push(["Top origin", f0(t.pct) + "%", `${t.label} (${th(t.count)} cases)`]);
    }
    tiles.push(["Topics per case", f2(V.tag_load.mean_tags_per_case),
      f0(V.tag_load.multi_tag_pct) + "% of cases carry 2+ topic tags"]);
    const rc = C.repeat_contact || {};
    if (rc.computable) tiles.push(["Repeat contacts", f0(rc.pct_cases_from_repeat) + "%",
      "of cases come from members with 2+ cases"]);
    A('<div class="stats">' + tiles.slice(0, 6).map(([k, v, d]) =>
      `<div class="stat"><div class="k">${ESC(k)}</div><div class="v num">${ESC(v)}</div>` +
      `<div class="d">${ESC(d)}</div></div>`).join("") + "</div>");

    const MR = res.most_received;
    if (MR) {
      A("<h3>Most received cases</h3>");
      const bits = [`<div class="mr"><div class="lead"><b>${ESC(MR.label)}</b> is the largest ` +
        `driver at <b>${th(MR.count)} cases</b> (${f1(MR.pct)}% of all volume)` +
        (MR.members ? ` raised by ${th(MR.members)} distinct members` : "") + ".</div>"];
      bits.push("<ul>");
      if (MR.top_labels.length) bits.push("<li>Most common labels inside it: " +
        MR.top_labels.map(l => `${ESC(l.label)} (${th(l.count)})`).join("; ") + "</li>");
      if (MR.origin) bits.push(`<li>Arrives mainly on <b>${ESC(MR.origin.label)}</b> — ` +
        `${th(MR.origin.count)} of its ${th(MR.count)} cases (${f1(MR.origin.pct)}%)</li>`);
      bits.push("</ul></div>");
      A(bits.join(""));
    }

    const AN = res.anomaly || {};
    const CUBE = res.cube || {};
    const hasWeeks = !!((CUBE.periods || {}).week || []).length;
    A("<h3>Movement watch</h3>");
    if (hasWeeks) {
      A('<p class="sub">Contacts over time. Choose the time grain, then click a bar or drag across the chart to scope every figure in this block - and the call-driver ranking below it - to that range, case origin and topic.</p>');
      A('<div id="explorer"><div class="slicer" id="granSlicer" role="group" aria-label="Time grain"></div><div class="slicer" id="originSlicer" role="group" aria-label="Filter by case origin"></div><div class="slicer" id="topicSlicer" role="group" aria-label="Filter by topic"></div><div class="slicer rangebar" id="rangeBar" role="group" aria-label="Date range"></div><div id="xChart"></div><div id="xDetail"><p class="nojs">The interactive breakdown requires JavaScript; the tables and charts below cover the same period without it.</p></div></div>');
    }
    if ((AN.alerts || []).length) {
      A('<div class="alerts">' + AN.alerts.map(a =>
        `<div class="alert ${a.level === "down" ? "down" : "up"}"><span class="dir">` +
        `${a.level === "up" ? "increase" : "decrease"}</span><span>${ESC(a.text)}</span></div>`)
        .join("") + "</div>");
    } else if ((AN.weekly || {}).computable || (AN.monthly || {}).computable) {
      const parts = [];
      for (const b of [AN.weekly, AN.monthly]) {
        if (b && b.computable) parts.push(`${b.label}-over-${b.label} ` +
          `${b.change >= 0 ? "+" : ""}${b.change} case(s) (${b.previous_key} to ${b.current_key})`);
      }
      A('<div class="alerts"><div class="alert calm"><span class="dir">steady</span><span>' +
        `Nothing crossed the alert thresholds (a move must be at least ` +
        `${RULES.anomaly.pct_threshold}% <i>and</i> at least ${RULES.anomaly.min_abs_change} ` +
        `cases): ${parts.length ? parts.join("; ") : "no complete period pair to compare"}.` +
        "</span></div></div>");
    } else {
      const wk = AN.weekly || {}, mo = AN.monthly || {};
      A(naBlock("Week-over-week and month-over-month movement", {
        reason: AN.reason || wk.reason || mo.reason ||
          "not enough complete periods to compare",
        needs: AN.needs || ["a date column covering 2+ complete periods"] }));
    }

    const DR = res.drivers || [];
    if (DR.length) {
      A("<h3>Top 5 call drivers</h3>");
      const pins = DR.filter(d => d.pinned);
      A('<p class="sub">Ranked by primary category. The first ' + RULES.gates.top_drivers +
        " are the largest by volume; the last row rolls up everything else so the list adds " +
        "to 100%." + (pins.length ? " " + pins.map(p =>
          `<b>${ESC(p.label)}</b> is always shown even though it ranks <b>#${p.volume_rank}</b> ` +
          "by volume").join("; ") + "." : "") + "</p>");
      const chartRows = DR.map(d => {
        const row = { label: d.rank + ". " + d.label, count: d.count, pct: d.pct };
        const t = rolledTip(d);
        if (t) { row.tip = t; row.color = "var(--rollup)"; }
        return row;
      });
      A('<div id="driverBlock">');
      A('<div class="drivers"><figure>' + svgHbar(chartRows, n, null, 196, 560) +
        "</figure><div>" + driversTable(DR, n) + "</div></div>");
      A("</div>");
    }

    A("<h3>Top findings</h3>");
    const finds = buildFindings(V, C);
    A(finds.length
      ? '<ol class="find">' + finds.map(([t, d]) => `<li><b>${ESC(t)}</b>${ESC(d)}</li>`).join("") + "</ol>"
      : '<p class="sub">No finding clears its evidence threshold at this record count.</p>');

    if (V.date_field_is_proxy) A('<div class="callout"><div class="t">Date caveat carried through ' +
      "the whole report</div>No case-creation timestamp is present, so every time-based figure " +
      "uses <b>Modified On</b>. That records the last time a case was touched, not when it " +
      "arrived — a case opened in March and reopened in July counts as July. Trend direction and " +
      'any "within N days" sequencing should be read with that distortion in mind.</div>');
    A("</section>");

    // 1. volume
    A('<section class="card"><h2><span class="secnum">1</span>Ticket volume &amp; category breakdown</h2>');
    const INF = res.inference || {};
    if (INF.from_subject || INF.unresolved) {
      A('<div class="callout info"><div class="t">Cases bucketed from the subject line</div>' +
        `<b>${INF.from_subject} of ${INF.total} cases (${f1(INF.pct_from_subject)}%)</b> had no ` +
        "usable Category value — blank, or a label that matched no bucket rule — so their bucket " +
        "was inferred from the subject line instead. " +
        ((INF.by_bucket || []).length ? "They landed in: " +
          INF.by_bucket.map(b => `${ESC(b.label)} (${b.count})`).join("; ") + ". " : "") +
        `A further <b>${INF.unresolved} case(s) (${f1(INF.pct_unresolved)}%)</b> could not be ` +
        "placed from either field and stay in Other / Unmapped. Every inferred assignment, and " +
        "the keyword that triggered it, is listed in Appendix A.</div>");
    }
    A("<p>Every case is assigned to exactly one <b>primary category</b> — the first label in its " +
      "Category field — and that primary label is mapped to a reporting bucket. Shares therefore " +
      "sum to 100%. The full label-to-bucket mapping is in the appendix; secondary topic tags are " +
      "counted separately in the topic-load table so multi-issue demand is not lost.</p>");

    const brows = DR.length ? withTips(DR) : capSeries(V.bucket.rows.slice())[0];
    const rolledDrv = DR.find(d => d.rolled);
    A('<div class="grid2">');
    A('<figure><h3 style="margin-top:0">Category mix (primary category)</h3>' + svgDonut(brows, n) +
      legend(brows) + "<figcaption>One bucket per case; shares sum to 100%." +
      (rolledDrv ? ` ${ESC(rolledDrv.label)} rolls up ${rolledDrv.rolled.length} lower-volume ` +
        "categories, itemised in the table." : "") + "</figcaption></figure>");
    A("<div>" + distTable(brows, n, "Category bucket") +
      (rolledDrv ? `<p class='sub'><b>${ESC(rolledDrv.label)}</b> is a roll-up of ` +
        `${(rolledDrv.rolled_detail || rolledDrv.rolled).length} smaller drivers, biggest ` +
        `first: ${ESC((rolledDrv.rolled_detail || []).slice(0, 6)
          .map(x => x.label + " (" + th(x.count) + ")").join("; "))}.</p>` : "") + "</div>");
    A("</div>");

    A('<div class="grid2" style="margin-top:26px">');
    if (V.origin.computable) {
      const [orows] = capSeries(V.origin.rows.slice());
      A('<figure><h3 style="margin-top:0">Contact origin</h3>' + svgHbar(orows, n, null, 178, 520) +
        "<figcaption>Count and share of total cases by channel of arrival.</figcaption></figure>");
      A("<div>" + distTable(orows, n, "Origin") + "</div>");
    } else A(naBlock("Origin breakdown", V.origin));
    A("</div>");

    const Q = res.quality || {};
    const PRC = V.primary_raw_clean || V.primary_raw;
    A("<h3>Top 5 primary category labels (real categories only)</h3>");
    const prows = PRC.rows.slice(0, 5);
    A(svgHbar(prows, n, "var(--s1)", 240));
    A('<p class="sub">The five most-used real category labels out of ' + V.tag_load.distinct_tags +
      " distinct labels seen in the Category field. <b>" + th(PRC.excluded_cases || 0) +
      " case(s)</b> whose primary value is a placeholder are excluded here and sized in the " +
      "data-quality panel below. Percentages are of all " + th(n) + " cases, so these five " +
      "do not " +
      "sum to 100%.</p>");

    if (Q.kb_size) {
      A("<h3>Data quality — what the category field cannot tell you</h3>");
      A("<p>Every category value in the export is checked against the <b>" + Q.kb_size +
        "-category knowledge base</b>. Two things break the reporting: values that are not " +
        "categories at all, and values the KB does not contain.</p>");
      A('<div class="stats">' + [
        ["Mapped from the KB", f1(res.inference.pct_from_kb) + "%",
         th(res.inference.from_kb) + " cases matched a real category exactly"],
        ["Placeholder tokens stripped", f1(Q.pct_with_junk_token || 0) + "%",
         th(Q.cases_with_junk_token || 0) + " cases carried a value that is not a category; " +
         "it was ignored and the case counted under its real one"],
        ["No category at all", f1(Q.primary_junk_pct) + "%",
         th(Q.primary_junk_cases) + " cases where every value was a placeholder"],
        ["Unknown to the KB", f1(Q.primary_unknown_pct) + "%",
         th(Q.primary_unknown_cases) + " cases using a label the KB does not list"],
        ["Distinct problems", th(Q.junk_distinct + Q.unknown_distinct),
         Q.junk_distinct + " placeholder + " + Q.unknown_distinct + " unknown label(s)"],
      ].slice(0, 5).map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div>` +
        `<div class="v num">${v}</div><div class="d">${d}</div></div>`).join("") + "</div>");
      const WL = res.worklist || {};
      if (WL.flagged) {
        A('<div class="callout"><div class="t">Get the list of cases to fix</div>' +
          `The <b>${th(WL.flagged)} case(s)</b> counted above (${f1(WL.pct_flagged)}% of the ` +
          'export) are listed one per row in the <b>cleanup list (.xlsx)</b> you can download ' +
          'from the builder: source file, sheet and row number, the raw Category cell, what is ' +
          'wrong with it and where the case was counted instead. Sort or filter it by Problem ' +
          'to work through one kind at a time, and use the <i>Labels to fix</i> sheet to ' +
          'correct the picklist at source. It carries no member number, name or case text — ' +
          'the row number points at the line in the export you already have.</div>');
      }
      if ((Q.junk_labels || []).length || (Q.unknown_labels || []).length) {
        A("<h4>Where these values come from</h4>");
        A('<p class="sub">The Category cell is split on commas, so a single cell can produce ' +
          "several labels. The <b>raw cell</b> column below is the untouched Category value " +
          "for a case that produced the label — search your export for that text to find the " +
          "rows. <b>Position</b> says whether the label was the first token in the cell (the " +
          "primary category) or a later one.</p>");
        const rowsOut = [];
        for (const [kind, items] of [["not a category", Q.junk_labels || []],
                                     ["not in the KB", Q.unknown_labels || []]]) {
          for (const it of items.slice(0, 10)) {
            const exs = (it.examples && it.examples.length)
              ? it.examples : [{ position: "—", cell: "—" }];
            exs.forEach((e, k) => {
              rowsOut.push("<tr>" + (k === 0
                ? `<td class="mono"><b>${ESC(it.label)}</b></td><td>${ESC(kind)}</td>` +
                  `<td class="n">${th(it.count)}</td>`
                : "<td></td><td></td><td></td>") +
                `<td>${ESC(e.position)}</td><td class="mono">${ESC(e.cell || "(blank)")}</td></tr>`);
            });
          }
        }
        A('<div class="scroll"><table><thead><tr><th>Label</th><th>Kind</th>' +
          '<th class="n">Cases</th><th>Position</th><th>Raw Category cell it came from</th>' +
          "</tr></thead><tbody>" + rowsOut.join("") + "</tbody></table></div>");
      }
    }

    A("<h3>Origin × category cross-tab</h3>");
    if (V.crosstab.computable) {
      A(heatTable(DR.length ? foldCrosstab(V.crosstab, DR) : V.crosstab));
      A('<p class="sub">Columns are the same five call drivers used throughout; cell shading is ' +
        "a single-hue sequential ramp on case count and exact counts are printed in every cell.</p>");
    } else A(naBlock("Origin × category cross-tab", V.crosstab));

    A("<h3>Topic load (all tags, not just the primary)</h3>");
    const tl = V.tag_load;
    A(`<p>Cases carry <b>${f2(tl.mean_tags_per_case)}</b> category tags on average; ` +
      `<b>${tl.multi_tag_cases}</b> of ${n} cases (${f1(tl.multi_tag_pct)}%) carry more than one, ` +
      `across <b>${tl.distinct_tags}</b> distinct labels. The denominator below is cases, so ` +
      "these shares deliberately sum above 100%.</p>");
    A('<div class="scroll"><table><thead><tr><th>Top 10 topic tags (any position)</th>' +
      '<th class="n">Cases</th><th class="n">% of cases</th></tr></thead><tbody>' +
      tl.top.slice(0, 10).map(t => `<tr><td>${ESC(t.label)}</td><td class="n">${t.count}</td>` +
        `<td class="n">${f1(t.pct_of_cases)}%</td></tr>`).join("") + "</tbody></table></div>");

    const MV = res.movement || {};
    A("<h3>Monthly movement</h3>");
    A(movementBlock(MV.monthly || { label: "month", reason: "no monthly view available",
      needs: ["a date column"] }));
    A("<h3>Quarterly movement</h3>");
    A(movementBlock(MV.quarterly || { label: "quarter", reason: "no quarterly view available",
      needs: ["a date column"] }));

    for (const [key, ttl] of [["site", "Breakdown by office / site"], ["agent", "Breakdown by agent"]]) {
      const rec = V[key] || {};
      A(`<h3>${ESC(ttl)}</h3>`);
      if (rec.computable) { const [rows] = capSeries(rec.rows.slice(), 10); A(svgHbar(rows, n)); }
      else A(naBlock(ttl, rec));
    }
    A("</section>");

    // 2. deep dives
    const DD = res.deep_dives || [];
    if (DD.length) {
      A('<section class="card"><h2><span class="secnum">2</span>Category deep dives</h2>');
      A("<p>Every driver family gets a drill-down, biggest first: the category tells you " +
        "<i>what</i> the case was filed as, and the free text tells you <i>what actually " +
        "happened</i>. Each facet is a fixed vocabulary matched against the subject and " +
        "description; <b>no text from any case is reproduced anywhere</b> — only the facet " +
        "label and a count. Email addresses, links and long digit strings are stripped before " +
        "matching. Coverage is reported per facet, so a family whose notes do not use this " +
        "vocabulary says so rather than under-counting quietly. Hardware, troubleshooting and " +
        "incentives use specialised facet sets; the rest use a general intent / action / " +
        "outcome set. Sections open on print.</p>");
      const expanded = (RULES.deep_dive_defaults || {}).expanded ?? 3;
      DD.forEach((dd, i) => {
        let cov = "";
        if ((dd.facets || []).length && dd.facets[0].rows.length) {
          cov = " · top " + dd.facets[0].name.toLowerCase() + ": " + dd.facets[0].rows[0].label;
        }
        A('<details class="dd"' + (i < expanded ? " open" : "") +
          '><summary><span class="nm">' + ESC(dd.title) + '</span><span class="mt">' +
          th(dd.cases) + " cases · " + f1(dd.pct_of_total) + "%" + ESC(cov) +
          '</span></summary><div class="body">');
        A(deepDiveBlock(dd));
        A("</div></details>");
      });
      A("</section>");
    }

    // 3. correlation
    A('<section class="card"><h2><span class="secnum">3</span>Multivariate correlation analysis</h2>');
    A(`<p>Each hypothesised chain is tested as measured co-occurrence, not asserted narrative. ` +
      `A chain is only reported when the dataset carries at least <b>${C.gate.min_cases} cases</b> ` +
      `and at least <b>${C.gate.min_cooccurrence} cases showing both signals</b>; otherwise it is ` +
      "marked NOT COMPUTABLE with the specific field or volume it needs. Signals are matched " +
      "across every category tag on a case plus its subject line — never the free-text " +
      "description body, which is excluded from all processing that reaches this page.</p>");

    for (const key of ["chain_hw_inactivity", "chain_activity_withdraw", "chain_reward_dupes",
                       "chain_bounce_withdraw", "chain_google_lockout", "chain_field_service"]) {
      const ch = C[key];
      if (ch.computable) {
        A('<h3 style="display:flex;flex-wrap:wrap;gap:10px;align-items:baseline">' +
          `${ESC(ch.title)}<span class="pill v-${ch.verdict}">${ESC(ch.verdict_text)}</span></h3>`);
        A('<div class="stats">' + [
          ["Cases with leading signal", th(ch.n_a), "denominator"],
          ["Also show downstream", f1(ch.pct_of_a_with_b) + "%", ch.joint + " joint cases"],
          ["Base rate", f1(ch.base_rate_b) + "%", "downstream signal, all cases"],
          ["Lift", f2(ch.lift || 0) + "x", "vs. base rate"],
        ].slice(0, 5).map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div>` +
          `<div class="v num">${v}</div><div class="d">${d}</div></div>`).join("") + "</div>");
        if (ch.note) A(`<div class="callout info"><div class="t">Scope limit</div>${ESC(ch.note)}</div>`);
      } else {
        A(`<h3>${ESC(ch.title)}</h3>`);
        A(naBlock(ch.title, ch));
      }
    }

    A("<h3>Repeat-contact behaviour</h3>");
    if (rc.computable) {
      A('<div class="stats">' + [
        ["Members", th(rc.members), "distinct member IDs"],
        ["Repeat members", th(rc.members_with_multiple_cases), f1(rc.pct_members_repeat) + "% of members"],
        ["Cases from repeats", th(rc.cases_from_repeat_members), f1(rc.pct_cases_from_repeat) + "% of volume"],
        ["Busiest member", th(rc.max_cases_one_member), "cases, single member"],
      ].map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div><div class="v num">${v}</div>` +
        `<div class="d">${d}</div></div>`).join("") + "</div>");
      A('<p class="sub">Member identifiers are used only to group cases; no identifier, name, ' +
        "email or phone number appears anywhere in this report.</p>");
    } else A(naBlock("Repeat-contact behaviour", rc));

    A("<h3>Other correlations found in the data</h3>");
    const d = C.discovered;
    if (d.computable && d.pairs.length) {
      A('<div class="scroll"><table><thead><tr><th>Signal A</th><th>Signal B</th>' +
        '<th class="n">Cases with A</th><th class="n">Both</th><th class="n">% of A with B</th>' +
        '<th class="n">Base rate</th><th class="n">Lift</th></tr></thead><tbody>' +
        d.pairs.map(p => `<tr><td>${ESC(p.a.replace(/_/g, " "))}</td>` +
          `<td>${ESC(p.b.replace(/_/g, " "))}</td><td class="n">${p.n_a}</td>` +
          `<td class="n">${p.joint}</td><td class="n">${f1(p.pct_of_a_with_b)}%</td>` +
          `<td class="n">${f1(p.base_rate_b)}%</td><td class="n"><b>${f2(p.lift)}x</b></td></tr>`)
          .join("") + "</tbody></table></div>");
      A('<p class="sub">Co-occurrence within a single case. Lift above 1.0 means the pair appears ' +
        "together more often than the downstream signal's overall rate — association, not " +
        "causation. Pairs where one signal wholly contains the other are excluded as definitional.</p>");
    } else if (d.computable) {
      A('<p class="sub">No signal pair cleared the joint-occurrence threshold.</p>');
    } else A(naBlock("Open correlation scan", d));
    A("</section>");

    // 3. forecast
    A('<section class="card"><h2><span class="secnum">4</span>Projected support trends — next four quarters</h2>');
    if (Fc.computable) {
      A(`<p><b>Method:</b> ordinary least-squares linear trend fitted to <b>${Fc.months_fitted}</b> ` +
        `months of observed case volume (slope ${Fc.slope_cases_per_month >= 0 ? "+" : ""}` +
        `${f2(Fc.slope_cases_per_month)} cases/month), summed to quarterly totals. The interval is ` +
        `±1.96 residual standard deviations. ${ESC(Fc.caveat)}</p>`);
      if (Fc.partial_note) A('<p class="sub">Observed history below shows only calendar quarters ' +
        "with all three months present. A forward quarter that already contains observed months " +
        "uses those actuals and models only the remainder — its interval narrows accordingly.</p>");
      A('<div class="scroll"><table><thead><tr><th>Quarter</th><th class="n">Projected cases</th>' +
        '<th class="n">Low</th><th class="n">High</th><th class="n">Months modelled</th>' +
        "</tr></thead><tbody>" + Fc.quarters.map(q =>
          `<tr><td><b>${ESC(q.label)}</b>${q.partial ?
            ' <span class="pill p3" style="font-size:.6rem">part observed</span>' : ""}</td>` +
          `<td class="n">${th(q.point)}</td><td class="n">${th(q.low)}</td>` +
          `<td class="n">${th(q.high)}</td><td class="n">${q.fitted_months} of 3</td></tr>`)
          .join("") + "</tbody></table></div>");
      A(svgForecast(Fc.history || [], Fc.quarters));
      A('<div class="legend"><span><span class="swatch" style="background:var(--s1)"></span>' +
        'Observed quarterly volume (solid)</span><span><span class="swatch" ' +
        'style="background:var(--s1);opacity:.35"></span>Projection with ±1.96 residual-SD ' +
        "interval (dashed)</span></div>");
    } else {
      A("<p><b>Method:</b> no forecast is produced.</p>");
      A(naBlock("Four-quarter forecast", Fc));
      A('<div class="callout"><div class="t">Why no directional estimate is shown either</div>' +
        "A directional estimate built from category mix would still need a category mix that is " +
        "representative of the operation. At this record count it is not, so publishing a shaped " +
        "curve would give a VP a number with no evidence behind it. Supply an export spanning " +
        "three or more months and this section fills in automatically with a fitted trend, " +
        "per-quarter interval and mix projection.</div>");
    }
    A("</section>");

    // 4. risk
    A('<section class="card"><h2><span class="secnum">5</span>Predictive trend analysis &amp; risk forecasting</h2>');
    A("<p>Exposure below is sized directly from measured case share. The threat and owner columns " +
      "are an <b>operational interpretation</b> of each bucket, not a value derived from the " +
      "export — they are shown so the ranking is actionable, and should be challenged where they " +
      "do not match how the operation is actually organised.</p>");
    A('<div class="scroll"><table><thead><tr><th>Rank</th><th>Category bucket</th>' +
      '<th class="n">Cases</th><th class="n">Share</th><th>Principal forward risk</th>' +
      "<th>Likely owner</th></tr></thead><tbody>" + buildRisks(V).map((r, i) =>
        `<tr><td class="n">${i + 1}</td><td><span class="swatch" style="background:${cvar(i)}">` +
        `</span><b>${ESC(r.bucket)}</b></td><td class="n">${r.count}</td>` +
        `<td class="n">${f1(r.pct)}%</td><td>${ESC(r.threat)}</td><td>${ESC(r.owner)}</td></tr>`)
        .join("") + "</tbody></table></div>");

    A("<h3>Leading indicators worth instrumenting</h3>");
    A("<ul><li><b>Topic tags per case</b> — currently " + f2(V.tag_load.mean_tags_per_case) +
      ". A rise means single contacts are absorbing more unresolved issues; it moves before " +
      "handle time and before CSAT.</li><li><b>Share of volume from repeat members</b> — " +
      (rc.computable ? f1(rc.pct_cases_from_repeat) + "%" : "not yet computable") +
      ". Rising repeat share is the earliest sign that first-contact resolution is failing.</li>" +
      "<li><b>Reactivation and activity-inquiry share of primary category</b> — the closest " +
      "available proxy for panelists drifting toward involuntary purge.</li>" +
      "<li><b>Outbound / callback share</b> — a rise indicates inbound channels are not closing " +
      "issues on first contact.</li></ul>");

    A("<h3>If nothing changes</h3>");
    if (Fc.computable) {
      const q4 = Fc.quarters[Fc.quarters.length - 1];
      A(`<p>The fitted trend carries volume to roughly <b>${th(q4.point)} cases</b> in ` +
        `${ESC(q4.label)} (range ${th(q4.low)}–${th(q4.high)}) with the current mix intact — that ` +
        "is the do-nothing baseline against which any intervention should be measured.</p>");
    } else {
      A('<div class="na"><div class="t">Do-nothing trajectory</div><p>Quantifying the do-nothing ' +
        "case requires the forecast in section 3, which is gated off. What can be stated without " +
        "a forecast: the concentration in the leading bucket and the multi-topic case structure " +
        "are both structural, so neither resolves on its own without an intervention.</p></div>");
    }
    A("</section>");

    // 5. recommendations
    A('<section class="card"><h2><span class="secnum">6</span>Strategic recommendations &amp; action plan</h2>');
    for (const r of buildRecs(V, C)) {
      A(`<div class="rec"><div class="h"><span class="pill p${Math.min(r.pri, 3)}">Priority ` +
        `${r.pri}</span><span class="pill p3">${ESC(r.horizon)}</span>` +
        `<span class="pill p3">Owner: ${ESC(r.owner)}</span></div>` +
        `<h4 style="margin:.1em 0 .35em;font-size:1rem;color:var(--text)">${ESC(r.title)}</h4>` +
        `<p>${r.body}</p><div class="ties">${ESC(r.tie)}</div></div>`);
    }
    A("</section>");

    // appendices
    A('<section class="card"><h2>Appendix A — category label mapping (audit)</h2>');
    A("<p>Every distinct label seen in the Category field, the bucket it was assigned to, and how " +
      `often it appears in any tag position. <b>${MAP.distinct}</b> distinct labels; ` +
      `<b>${MAP.unmapped_count}</b> fell through to Other / Unmapped. Ordered rules are applied to ` +
      "the label text, first match wins — so a label naming a device resolves to Hardware &amp; " +
      "Meter even when it also mentions activity.</p>");
    A('<div class="scroll"><table><thead><tr><th>Raw label</th><th>Assigned bucket</th>' +
      '<th class="n">Occurrences</th></tr></thead><tbody>' + MAP.items.map(i =>
        `<tr><td class="mono">${ESC(i.label)}</td><td>${ESC(i.bucket)}</td>` +
        `<td class="n">${i.count}</td></tr>`).join("") + "</tbody></table></div>");
    if ((INF.keywords || []).length) {
      A("<h3>Subject-line inference (cases with no usable category)</h3>");
      A("<p>Where the Category field was blank or unrecognised, the subject line was matched " +
        "against the same ordered rules. The keyword below is the exact text that triggered each " +
        "assignment — the subject itself is never shown, since it can carry identifying detail.</p>");
      A('<div class="scroll"><table><thead><tr><th>Matched keyword in subject</th>' +
        '<th>Assigned bucket</th><th class="n">Cases</th></tr></thead><tbody>' +
        INF.keywords.map(k => `<tr><td class="mono">${ESC(k.keyword)}</td>` +
          `<td>${ESC(k.bucket)}</td><td class="n">${k.count}</td></tr>`).join("") +
        "</tbody></table></div>");
    }
    A("</section>");

    A('<section class="card"><h2>Appendix B — sources &amp; data handling</h2>');
    A('<div class="scroll"><table><thead><tr><th>File</th><th>Sheet</th><th>Status</th>' +
      '<th class="n">Rows</th><th>Columns not mapped</th></tr></thead><tbody>' +
      meta.prov.map(p => `<tr><td class="mono">${ESC(p.file)}</td>` +
        `<td>${ESC(p.sheet || "—")}</td><td>${ESC(p.status)}</td><td class="n">${p.rows}</td>` +
        `<td class="mono">${ESC((p.unmapped || []).join(", ") || "—")}</td></tr>`).join("") +
      "</tbody></table></div>");
    const hdrs = meta.prov.flatMap(p => (p.headers || []).map(([f, h]) => [f, h, p.file]));
    if (hdrs.length) {
      A("<h3>Which column fed which field</h3>");
      A('<p class="sub">An exact header match always wins; a partial match is only used for a ' +
        "field nothing matched exactly. If a column here looks wrong, that is the first thing " +
        "to check when a figure looks wrong.</p>");
      A('<div class="scroll"><table><thead><tr><th>Report field</th><th>Column used</th>' +
        "<th>File</th></tr></thead><tbody>" +
        hdrs.map(([f, h, fl]) => `<tr><td>${ESC(f)}</td><td class="mono">${ESC(h)}</td>` +
          `<td class="mono">${ESC(fl)}</td></tr>`).join("") + "</tbody></table></div>");
    }
    A(`<p>Records read: <b>${meta.stats.rows_read}</b>. Exact duplicates removed: ` +
      `<b>${meta.stats.exact_duplicates_removed}</b>. Records analysed: ` +
      `<b>${meta.stats.rows_after_dedupe}</b>.</p>`);
    A("<p><b>Privacy.</b> Member identifiers are used only to group cases into members and are " +
      "never printed. Subject and description free text is used only for keyword signal matching; " +
      "no free-text content, name, email address or phone number is rendered anywhere in this " +
      "document, and no row-level record is included.</p>");
    A('<p class="foot">All figures computed directly from the supplied export(s). Panels marked ' +
      "NOT COMPUTABLE indicate a field or sample size the export does not provide; no value in " +
      "this report is estimated, imputed or carried over from outside the data. Analysis ran " +
      "entirely in this browser — no file was uploaded to any server.</p>");
    if (hasWeeks) {
      A('<script type="application/json" id="cubeData">' +
        JSON.stringify(CUBE).replace(/<\//g, "<\\/") + "<\/script>");
    }
    A("</section></div>");
    return H.join("");
  }

  function buildDocument(res, meta) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>Panelist Support — Executive Report</title><style>" + CSS + "</style></head><body>" +
      buildBody(res, meta) + "<script>" + RUNTIME_JS + "<\/script></body></html>";
  }

  return { buildBody, buildDocument, buildFindings, buildRecs };
}
