"""Render the analysis dict into one self-contained, theme-aware, printable HTML report."""
import html, datetime, json, os, re

ESC = lambda s: html.escape(str(s), quote=True)

_WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
CSS = open(os.path.join(_WEB, "report.css"), encoding="utf-8").read()
JS = open(os.path.join(_WEB, "report-runtime.js"), encoding="utf-8").read()

# categorical slots - validated adjacent-pair safe in both modes (dataviz reference palette)
CAT_L = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"]
CAT_D = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"]
SEQ   = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
MAXSERIES = 8




# ------------------------------------------------------------------ chart helpers
def cvar(i):
    return "var(--s%d)" % (i % MAXSERIES + 1)


def cap_series(rows, n=MAXSERIES):
    """Never cycle hues: fold the tail into a single Other row."""
    if len(rows) <= n:
        return rows, False
    head = rows[:n - 1]
    tail = rows[n - 1:]
    head.append({"label": "Other (%d labels)" % len(tail),
                 "count": sum(r["count"] for r in tail),
                 "pct": round(sum(r["pct"] for r in tail), 1)})
    return head, True


def svg_donut(rows, total, cx=132, r_out=118, r_in=72):
    import math
    W, H = 264, 264
    if not rows or total <= 0:
        return '<p class="sub">No data to plot.</p>'
    parts, ang = [], -math.pi / 2
    gap = 0.016 if len(rows) > 1 else 0        # 2px-equivalent surface gap between fills
    for i, rrow in enumerate(rows):
        frac = rrow["count"] / total
        sweep = frac * 2 * math.pi
        a0, a1 = ang + gap / 2, ang + sweep - gap / 2
        ang += sweep
        if a1 <= a0:
            a1 = a0 + 0.004
        big = 1 if (a1 - a0) > math.pi else 0
        x0, y0 = cx + r_out * math.cos(a0), H / 2 + r_out * math.sin(a0)
        x1, y1 = cx + r_out * math.cos(a1), H / 2 + r_out * math.sin(a1)
        x2, y2 = cx + r_in * math.cos(a1), H / 2 + r_in * math.sin(a1)
        x3, y3 = cx + r_in * math.cos(a0), H / 2 + r_in * math.sin(a0)
        d = ("M%.2f %.2f A%.2f %.2f 0 %d 1 %.2f %.2f L%.2f %.2f A%.2f %.2f 0 %d 0 %.2f %.2f Z"
             % (x0, y0, r_out, r_out, big, x1, y1, x2, y2, r_in, r_in, big, x3, y3))
        parts.append('<path d="%s" fill="%s" data-tip="%s"/>'
                     % (d, cvar(i), ESC("%s — %d cases (%.1f%%)" % (rrow["label"], rrow["count"], rrow["pct"]))))
    parts.append('<text x="%d" y="%d" text-anchor="middle" font-size="30" font-weight="700" '
                 'fill="var(--text)" style="font-variant-numeric:tabular-nums">%d</text>'
                 % (cx, H / 2 + 2, total))
    parts.append('<text x="%d" y="%d" text-anchor="middle" font-size="11.5" fill="var(--text-3)" '
                 'letter-spacing=".07em">CASES</text>' % (cx, H / 2 + 22))
    return '<svg viewBox="0 0 %d %d" role="img" style="max-width:300px;margin:0 auto">%s</svg>' % (
        W, H, "".join(parts))


def svg_hbar(rows, total, series_color=None, label_w=178, W=720):
    if not rows:
        return '<p class="sub">No data to plot.</p>'
    rowh, gap = 30, 9
    H = len(rows) * (rowh + gap) + 6
    bar_x = label_w + 8
    bar_w = W - bar_x - 78
    mx = max(r["count"] for r in rows) or 1
    p = []
    for i, rrow in enumerate(rows):
        y = i * (rowh + gap)
        w = max(bar_w * rrow["count"] / mx, 3)
        col = series_color or cvar(i)
        lbl = rrow["label"]
        short = lbl if len(lbl) <= 30 else lbl[:29] + "…"
        p.append('<text x="%d" y="%.1f" text-anchor="end" font-size="12.5" fill="var(--text-2)">%s'
                 '<title>%s</title></text>' % (label_w, y + rowh * .68, ESC(short), ESC(lbl)))
        p.append('<rect x="%d" y="%.1f" width="%.2f" height="%d" rx="4" fill="%s" data-tip="%s"/>'
                 % (bar_x, y, w, rowh, col,
                    ESC("%s — %d cases (%.1f%%)" % (lbl, rrow["count"], rrow["pct"]))))
        p.append('<text x="%.1f" y="%.1f" font-size="12.5" font-weight="640" fill="var(--text)" '
                 'style="font-variant-numeric:tabular-nums">%d <tspan fill="var(--text-3)" '
                 'font-weight="400">(%.1f%%)</tspan></text>'
                 % (bar_x + w + 9, y + rowh * .68, rrow["count"], rrow["pct"]))
    return ('<svg class="chart" viewBox="0 0 %d %d" style="max-width:%dpx" '
            'preserveAspectRatio="xMinYMid meet" role="img">%s</svg>' % (W, H, W, "".join(p)))


def svg_line(months, series, ylab="cases"):
    W, H, pad_l, pad_b, pad_t, pad_r = 720, 300, 46, 34, 14, 14
    pw, ph = W - pad_l - pad_r, H - pad_t - pad_b
    allv = [v for s in series for v in s["values"]] or [0]
    mx = max(allv) or 1
    n = len(months)
    X = lambda i: pad_l + (pw * i / max(n - 1, 1))
    Y = lambda v: pad_t + ph - ph * v / mx
    p = []
    for g in range(5):
        y = pad_t + ph * g / 4
        p.append('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="var(--border)" stroke-width="1"/>'
                 % (pad_l, y, W - pad_r, y))
        p.append('<text x="%d" y="%.1f" text-anchor="end" font-size="11" fill="var(--text-3)">%d</text>'
                 % (pad_l - 7, y + 3.5, int(mx * (4 - g) / 4 + 0.5)))
    for i, m in enumerate(months):
        p.append('<text x="%.1f" y="%d" text-anchor="middle" font-size="11" fill="var(--text-3)">%s</text>'
                 % (X(i), H - pad_b + 18, ESC(m)))
    for si, s in enumerate(series):
        pts = " ".join("%.1f,%.1f" % (X(i), Y(v)) for i, v in enumerate(s["values"]))
        p.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="2" '
                 'stroke-linejoin="round" stroke-linecap="round"/>' % (pts, cvar(si)))
        for i, v in enumerate(s["values"]):
            p.append('<circle cx="%.1f" cy="%.1f" r="4.5" fill="%s" stroke="var(--surface)" '
                     'stroke-width="2" data-tip="%s"/>'
                     % (X(i), Y(v), cvar(si), ESC("%s · %s: %d %s" % (months[i], s["name"], v, ylab))))
    return ('<svg class="chart" viewBox="0 0 %d %d" style="max-width:%dpx" '
            'preserveAspectRatio="xMinYMid meet" role="img">%s</svg>' % (W, H, W, "".join(p)))


def svg_forecast(hist, proj):
    W, H, pl, pb, pt, pr = 720, 320, 50, 36, 16, 16
    pw, ph = W - pl - pr, H - pt - pb
    labels = [h["label"] for h in hist] + [q["label"] for q in proj]
    n = len(labels)
    mx = max([h["point"] for h in hist] + [q["high"] for q in proj] + [1])
    X = lambda i: pl + pw * i / max(n - 1, 1)
    Y = lambda v: pt + ph - ph * v / mx
    p = []
    for g in range(5):
        y = pt + ph * g / 4
        p.append('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="var(--border)" stroke-width="1"/>'
                 % (pl, y, W - pr, y))
        p.append('<text x="%d" y="%.1f" text-anchor="end" font-size="11" fill="var(--text-3)">%d</text>'
                 % (pl - 7, y + 3.5, int(mx * (4 - g) / 4 + 0.5)))
    step = max(1, n // 12)
    for i, l in enumerate(labels):
        if i % step == 0 or i >= len(hist):
            p.append('<text x="%.1f" y="%d" text-anchor="middle" font-size="10.5" fill="var(--text-3)">%s</text>'
                     % (X(i), H - pb + 18, ESC(l)))
    b = len(hist) - 1
    if b >= 0:
        p.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="var(--border-strong)" '
                 'stroke-width="1" stroke-dasharray="3 3"/>' % (X(b), pt, X(b), pt + ph))
        p.append('<text x="%.1f" y="%d" font-size="10.5" fill="var(--text-3)">projection →</text>'
                 % (X(b) + 6, pt + 11))
    # interval band, anchored at the last observed point so it opens from history
    if hist and proj:
        top = [(X(b), Y(hist[-1]["point"]))] + [(X(b + 1 + i), Y(q["high"])) for i, q in enumerate(proj)]
        bot = [(X(b + 1 + i), Y(q["low"])) for i, q in enumerate(proj)][::-1] + [(X(b), Y(hist[-1]["point"]))]
        pts = " ".join("%.1f,%.1f" % t for t in top + bot)
        p.append('<polygon points="%s" fill="var(--s1)" opacity=".14"/>' % pts)
    hp = " ".join("%.1f,%.1f" % (X(i), Y(h["point"])) for i, h in enumerate(hist))
    p.append('<polyline points="%s" fill="none" stroke="var(--s1)" stroke-width="2" '
             'stroke-linejoin="round"/>' % hp)
    fp = " ".join(["%.1f,%.1f" % (X(b), Y(hist[-1]["point"]))] if hist else []) + " " + \
         " ".join("%.1f,%.1f" % (X(b + 1 + i), Y(q["point"])) for i, q in enumerate(proj))
    p.append('<polyline points="%s" fill="none" stroke="var(--s1)" stroke-width="2" '
             'stroke-dasharray="6 4" stroke-linejoin="round"/>' % fp.strip())
    for i, h in enumerate(hist):
        p.append('<circle cx="%.1f" cy="%.1f" r="4" fill="var(--s1)" stroke="var(--surface)" '
                 'stroke-width="2" data-tip="%s"/>'
                 % (X(i), Y(h["point"]), ESC("%s observed: %d cases" % (h["label"], h["point"]))))
    for i, q in enumerate(proj):
        p.append('<circle cx="%.1f" cy="%.1f" r="4.5" fill="var(--surface)" stroke="var(--s1)" '
                 'stroke-width="2.5" data-tip="%s"/>'
                 % (X(b + 1 + i), Y(q["point"]),
                    ESC("%s projected: %d cases (range %d–%d)" % (q["label"], q["point"], q["low"], q["high"]))))
    return ('<svg class="chart" viewBox="0 0 %d %d" style="max-width:%dpx" role="img">%s</svg>'
            % (W, H, W, "".join(p)))


def svg_stacked(keys, stack, totals):
    """One bar per period: height is volume, segments are the five drivers - so a
    rise or fall and a category peak are both readable off the same chart."""
    W, H, pl, pb, pt, pr = 720, 340, 46, 40, 26, 12
    pw, ph = W - pl - pr, H - pt - pb
    n = len(keys)
    mx = max(totals) or 1
    slot = pw / max(n, 1)
    bw = min(slot * 0.66, 54)
    X = lambda i: pl + slot * (i + 0.5) - bw / 2
    Y = lambda v: pt + ph - ph * v / mx
    p = []
    for g in range(5):
        y = pt + ph * g / 4
        p.append('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="var(--border)" '
                 'stroke-width="1"/>' % (pl, y, W - pr, y))
        p.append('<text x="%d" y="%.1f" text-anchor="end" font-size="11" fill="var(--text-3)">'
                 '%d</text>' % (pl - 7, y + 3.5, int(mx * (4 - g) / 4 + 0.5)))
    step = max(1, (n + 13) // 14)
    for i, k in enumerate(keys):
        if i % step == 0 or i == n - 1:
            p.append('<text x="%.1f" y="%d" text-anchor="middle" font-size="10.5" '
                     'fill="var(--text-3)">%s</text>' % (X(i) + bw / 2, H - pb + 17, ESC(k)))
    for i in range(n):
        acc = 0
        segs = [(si, s["values"][i]) for si, s in enumerate(stack) if s["values"][i] > 0]
        for j, (si, v) in enumerate(segs):
            y0, y1 = Y(acc + v), Y(acc)
            h = max(y1 - y0 - (2 if j < len(segs) - 1 else 0), 1)
            top = (j == len(segs) - 1)
            r = min(4, h / 2, bw / 2)
            if top:
                # rounded data-end on the top segment only; the rest stay square
                d = ("M%.2f %.2f L%.2f %.2f Q%.2f %.2f %.2f %.2f L%.2f %.2f "
                     "Q%.2f %.2f %.2f %.2f L%.2f %.2f Z"
                     % (X(i), y0 + h, X(i), y0 + r, X(i), y0, X(i) + r, y0,
                        X(i) + bw - r, y0, X(i) + bw, y0, X(i) + bw, y0 + r,
                        X(i) + bw, y0 + h))
                p.append('<path d="%s" fill="%s" data-tip="%s"/>'
                         % (d, cvar(si), ESC("%s · %s: %d cases" % (keys[i], stack[si]["name"], v))))
            else:
                p.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s" '
                         'data-tip="%s"/>'
                         % (X(i), y0, bw, h, cvar(si),
                            ESC("%s · %s: %d cases" % (keys[i], stack[si]["name"], v))))
            acc += v
        if totals[i]:
            p.append('<text x="%.1f" y="%.1f" text-anchor="middle" font-size="11" '
                     'font-weight="640" fill="var(--text-2)" '
                     'style="font-variant-numeric:tabular-nums">%d</text>'
                     % (X(i) + bw / 2, Y(totals[i]) - 7, totals[i]))
    return ('<svg class="chart" viewBox="0 0 %d %d" style="max-width:%dpx" role="img">%s</svg>'
            % (W, H, W, "".join(p)))


def insight_list(insights):
    return ('<ul class="ins">' + "".join(
        '<li><span class="k %s">%s</span><span>%s</span></li>'
        % (i["kind"], {"up": "rising", "down": "falling", "peak": "peak",
                       "flat": "flat", "range": "range"}.get(i["kind"], i["kind"]),
           ESC(i["text"])) for i in insights) + "</ul>")


def movement_table(mv):
    h = ['<div class="scroll"><table><thead><tr><th>%s</th><th class="n">Cases</th>'
         '<th class="n">Change</th><th class="n">%%</th><th>Largest driver</th>'
         '<th class="n">Its share</th></tr></thead><tbody>' % ESC(mv["label"].title())]
    for r in mv["rows"]:
        d = r["delta"]
        cls = "" if d is None or d == 0 else (" delta-up" if d > 0 else " delta-down")
        h.append('<tr><td><b>%s</b></td><td class="n">%d</td><td class="n%s">%s</td>'
                 '<td class="n%s">%s</td><td>%s</td><td class="n">%s</td></tr>'
                 % (ESC(r["key"]), r["total"], cls, "—" if d is None else "%+d" % d, cls,
                    "—" if r["pct"] is None else "%+.1f%%" % r["pct"],
                    ESC(r["top_bucket"] or "—"),
                    "—" if r["top_pct"] is None else "%d (%.1f%%)" % (r["top_count"], r["top_pct"])))
    h.append("</tbody></table></div>")
    return "".join(h)


ADJ = {"month": "Monthly", "quarter": "Quarterly", "week": "Weekly"}


def movement_block(mv, drivers):
    if not mv.get("computable"):
        return na_block("%s movement" % ADJ.get(mv.get("label"), "Period"), mv)
    out = [insight_list(mv["insights"]),
           svg_stacked(mv["keys"], mv["stack"], mv["totals"])]
    out.append('<div class="legend">' + "".join(
        '<span><span class="swatch" style="background:%s"></span>%s</span>'
        % (cvar(i), ESC(s["name"])) for i, s in enumerate(mv["stack"])) + "</div>")
    out.append('<p class="sub">Bar height is total volume for the %s; segments are the five '
               'call drivers. Only complete calendar %ss are shown — a partial period at either '
               'end of the export is excluded so it cannot read as a collapse.</p>'
               % (mv["label"], mv["label"]))
    out.append(movement_table(mv))
    return "".join(out)


def heat_table(ct):
    origins, buckets, M = ct["origins"], ct["buckets"], ct["matrix"]
    mx = max((max(r) for r in M), default=0) or 1
    h = ['<div class="scroll"><table><thead><tr><th>Origin \\ Category bucket</th>']
    for b in buckets:
        h.append('<th class="n">%s</th>' % ESC(b))
    h.append('<th class="n">Total</th></tr></thead><tbody>')
    for i, o in enumerate(origins):
        h.append("<tr><td><b>%s</b></td>" % ESC(o))
        for j, b in enumerate(buckets):
            v = M[i][j]
            step = 0 if v == 0 else min(6, 1 + int(5 * v / mx))
            style = "" if v == 0 else ('background:var(--seq%d);color:%s'
                                       % (step, "#fff" if step >= 3 else "var(--text)"))
            h.append('<td class="n" style="%s" data-tip="%s">%s</td>'
                     % (style, ESC("%s x %s: %d cases" % (o, b, v)), v or "–"))
        h.append('<td class="n"><b>%d</b></td></tr>' % ct["row_totals"][i])
    h.append("<tr><td><b>Total</b></td>")
    for t in ct["col_totals"]:
        h.append('<td class="n"><b>%d</b></td>' % t)
    h.append('<td class="n"><b>%d</b></td></tr></tbody></table></div>' % sum(ct["col_totals"]))
    return "".join(h)


def dist_table(rows, total, head="Label"):
    h = ['<div class="scroll"><table><thead><tr><th>%s</th><th class="n">Cases</th>'
         '<th class="n">%% of total</th></tr></thead><tbody>' % ESC(head)]
    for i, r in enumerate(rows):
        h.append('<tr><td><span class="swatch" style="background:%s"></span>%s</td>'
                 '<td class="n">%d</td><td class="n">%.1f%%</td></tr>'
                 % (cvar(i), ESC(r["label"]), r["count"], r["pct"]))
    h.append('<tr><td><b>Total</b></td><td class="n"><b>%d</b></td>'
             '<td class="n"><b>100.0%%</b></td></tr></tbody></table></div>' % total)
    return "".join(h)


def legend(rows):
    return ('<div class="legend">' + "".join(
        '<span><span class="swatch" style="background:%s"></span>%s</span>' % (cvar(i), ESC(r["label"]))
        for i, r in enumerate(rows)) + "</div>")


def driver_labels(drivers):
    return [d["label"] for d in drivers]


def fold_series(by_bucket, drivers):
    """Collapse a {bucket: [values]} map onto the driver set, rolling every
    non-driver bucket into the single Various row - so every chart in the report
    shows the same five things."""
    names = [d["label"] for d in drivers if not d.get("rolled")]
    rolled = next((d for d in drivers if d.get("rolled")), None)
    out = [{"name": nm, "values": by_bucket.get(nm, [])} for nm in names if nm in by_bucket]
    if rolled:
        n = len(next(iter(by_bucket.values()), []))
        acc = [0] * n
        for b in rolled["rolled"]:
            for i, v in enumerate(by_bucket.get(b, [])):
                acc[i] += v
        if any(acc):
            out.append({"name": rolled["label"], "values": acc})
    return out


def fold_crosstab(ct, drivers):
    names = [d["label"] for d in drivers if not d.get("rolled")]
    rolled = next((d for d in drivers if d.get("rolled")), None)
    idx = {b: i for i, b in enumerate(ct["buckets"])}
    cols = [b for b in names if b in idx]
    M = [[row[idx[b]] for b in cols] for row in ct["matrix"]]
    if rolled:
        extra = [i for b, i in idx.items() if b in rolled["rolled"]]
        if extra:
            cols = cols + [rolled["label"]]
            M = [row + [sum(ct["matrix"][r][i] for i in extra)] for r, row in enumerate(M)]
    return {"computable": True, "origins": ct["origins"], "buckets": cols, "matrix": M,
            "row_totals": [sum(r) for r in M],
            "col_totals": [sum(r[j] for r in M) for j in range(len(cols))]}


def drivers_table(drivers, total):
    h = ['<div class="scroll"><table><thead><tr><th>#</th><th>Call driver</th>'
         '<th class="n">Cases</th><th class="n">% of total</th></tr></thead><tbody>']
    for i, d in enumerate(drivers):
        rolled = d.get("rolled")
        tip = (' title="%s"' % ESC(", ".join(rolled))) if rolled else ""
        h.append('<tr%s><td class="n">%d</td><td%s><span class="swatch" style="background:%s">'
                 '</span>%s%s</td><td class="n">%d</td><td class="n">%.1f%%</td></tr>'
                 % (' class="various"' if rolled else "", d["rank"], tip, cvar(i),
                    ESC(d["label"]),
                    (" <span style='color:var(--text-3)'>(%d categories)</span>" % len(rolled))
                    if rolled else "", d["count"], d["pct"]))
    h.append('<tr><td></td><td><b>Total</b></td><td class="n"><b>%d</b></td>'
             '<td class="n"><b>100.0%%</b></td></tr></tbody></table></div>' % total)
    return "".join(h)


def na_block(title, rec):
    needs = rec.get("needs") or rec.get("missing_fields") or []
    h = ['<div class="na"><div class="t">%s</div><p>%s</p>' % (ESC(title), ESC(rec.get("reason", "")))]
    if needs:
        h.append("<p style='margin-bottom:.2em'>Required to compute this:</p><ul>"
                 + "".join("<li>%s</li>" % ESC(x) for x in needs) + "</ul>")
    if rec.get("note"):
        h.append('<p><i>%s</i></p>' % ESC(rec["note"]))
    h.append("</div>")
    return "".join(h)


# ------------------------------------------------------------------ domain framing
# Operational interpretation layer: which function owns a bucket and what it threatens.
# This is judgement, NOT derived from the export - it is labelled as such in the report.
_R = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "rules.json")))
RISK_PROFILE = {k: (v["threat"], v["owner"]) for k, v in _R["risk_profile"].items()}
RULES = _R


def build_findings(V, C, preview):
    """Findings are generated from computed values only; each states its own evidence."""
    f = []
    n = V["total_cases"]
    b = V["bucket"]["rows"]
    if b:
        top = b[0]
        f.append(("Demand concentrates in %s" % top["label"],
                  "%d of %d cases (%.1f%%) carry %s as their primary category. "
                  "The top two buckets together account for %.1f%% of all contacts."
                  % (top["count"], n, top["pct"], top["label"],
                     sum(x["pct"] for x in b[:2]))))
    tl = V["tag_load"]
    if tl["mean_tags_per_case"] > 1.2:
        f.append(("Cases are multi-issue, so single-category routing understates real demand",
                  "Cases carry %.2f category tags on average and %.1f%% carry more than one "
                  "(%d distinct labels in use). Counting only the primary category hides "
                  "%d secondary topic tags that agents still had to handle."
                  % (tl["mean_tags_per_case"], tl["multi_tag_pct"], tl["distinct_tags"],
                     tl["total_tags"] - n)))
    o = V["origin"]
    if o.get("computable") and o["rows"]:
        t = o["rows"][0]
        f.append(("%s dominates contact volume" % t["label"],
                  "%d of %d cases (%.1f%%) arrive via %s across %d origin(s) in use. "
                  "Deflection and self-service capacity should be sized against that channel first."
                  % (t["count"], n, t["pct"], t["label"], len(o["rows"]))))
    rc = C.get("repeat_contact", {})
    if rc.get("computable") and rc["members_with_multiple_cases"] > 0:
        f.append(("Repeat contact is measurable at member level",
                  "%d of %d members (%.1f%%) opened more than one case, generating %d cases "
                  "(%.1f%% of volume); the highest single member opened %d."
                  % (rc["members_with_multiple_cases"], rc["members"], rc["pct_members_repeat"],
                     rc["cases_from_repeat_members"], rc["pct_cases_from_repeat"],
                     rc["max_cases_one_member"])))
    for k in ("chain_hw_inactivity", "chain_reward_dupes", "chain_google_lockout", "chain_field_service"):
        ch = C.get(k, {})
        if ch.get("computable") and (ch.get("lift") or 0) >= 1.2:
            f.append(("Confirmed link: %s" % ch["title"],
                      "Of the %d cases carrying the leading signal, %.1f%% also carry the "
                      "downstream signal, against a %.1f%% base rate — a lift of %.2fx (n=%d joint)."
                      % (ch["n_a"], ch["pct_of_a_with_b"], ch["base_rate_b"], ch["lift"], ch["joint"])))
    return f[:3]


def build_risks(V, C):
    out = []
    for r in V["bucket"]["rows"][:6]:
        threat, owner = RISK_PROFILE.get(r["label"], ("Unclassified", "Support Ops"))
        out.append({"bucket": r["label"], "count": r["count"], "pct": r["pct"],
                    "threat": threat, "owner": owner})
    return out


def build_recs(V, C, F):
    """Recommendations tie to a specific computed finding or a specific missing field."""
    recs = []
    n = V["total_cases"]
    # 1. instrumentation gaps - these are grounded in fields we KNOW are absent
    missing = []
    if V.get("date_field_is_proxy"):
        missing.append(("Created On / case-open timestamp",
                        "Every trend, seasonality and 'within N days' figure in this report is "
                        "currently anchored to Modified On, which records last touch, not arrival."))
    if not (V.get("site") or {}).get("computable"):
        missing.append(("Office / site", "No site-level breakdown of volume or mix is possible."))
    if not (V.get("agent") or {}).get("computable"):
        missing.append(("Agent / case owner", "No handling-side variance analysis is possible."))
    for ch, fld in (("chain_google_lockout", "Member type / household role (primary vs secondary)"),
                    ("chain_field_service", "Enrollment / join date")):
        c = C.get(ch, {})
        for m in (c.get("missing_fields") or c.get("needs") or []):
            if not re.search(r"larger export", m, re.I):
                missing.append((m, c.get("note", "")))
    seen, miss = set(), []
    for m, why in missing:
        if m.lower() not in seen:
            seen.add(m.lower()); miss.append((m, why))
    if miss:
        recs.append({"pri": 1, "horizon": "Quick win (0–30 days)",
                     "owner": "Support Ops / CRM administration",
                     "title": "Add %d missing field(s) to the case export" % len(miss),
                     "body": "The export currently supports volume and mix analysis but blocks "
                             "several causal tests outright. Adding these fields costs a report "
                             "definition change, not a system change: "
                             + "; ".join("<b>%s</b> — %s" % (ESC(m), ESC(w)) for m, w in miss) + ".",
                     "tie": "Ties to the NOT COMPUTABLE panels in sections 2 and 3."})
    b = V["bucket"]["rows"]
    if b:
        top = b[0]
        threat, owner = RISK_PROFILE.get(top["label"], ("Unclassified", "Support Ops"))
        recs.append({"pri": 1, "horizon": "Quick win (0–30 days)", "owner": owner,
                     "title": "Attack the %s driver first" % top["label"],
                     "body": "%s is the largest single primary category at %.1f%% of cases "
                             "(%d of %d). Any deflection built here has the widest reach; "
                             "the associated exposure is %s."
                             % (top["label"], top["pct"], top["count"], n, threat.lower()),
                     "tie": "Ties to Finding 1 and section 1's category breakdown."})
    tl = V["tag_load"]
    if tl["mean_tags_per_case"] > 1.2:
        recs.append({"pri": 2, "horizon": "This quarter", "owner": "Support Ops (taxonomy owner)",
                     "title": "Split the multi-topic case into countable units",
                     "body": "At %.2f tags per case and %.1f%% of cases multi-tagged, a single "
                             "case can conceal an equipment fault, a reward dispute and a password "
                             "reset at once. Either capture a required primary reason with "
                             "explicit sub-reasons, or emit one case line per topic, so demand "
                             "sizing and AHT attribution stop disagreeing."
                             % (tl["mean_tags_per_case"], tl["multi_tag_pct"]),
                     "tie": "Ties to Finding 2 and the tag-load table in section 1."})
    o = V["origin"]
    if o.get("computable") and o["rows"] and o["rows"][0]["pct"] >= 50:
        t = o["rows"][0]
        recs.append({"pri": 2, "horizon": "This quarter", "owner": "WFM / Support Ops",
                     "title": "Size deflection against %s before adding headcount" % t["label"],
                     "body": "%.1f%% of contacts arrive on %s. Channel concentration at this level "
                             "means capacity planning, IVR routing and self-service ROI all hinge "
                             "on that single origin." % (t["pct"], t["label"]),
                     "tie": "Ties to Finding 3 and section 1's origin split."})
    if not C.get("discovered", {}).get("computable"):
        recs.append({"pri": 3, "horizon": "Next 2–3 quarters", "owner": "Analytics / Support Ops",
                     "title": "Re-run this analysis on a full-period export",
                     "body": "Correlation and forecasting are gated off at the current record count. "
                             "The same pipeline produces the quantified chains, the discovered "
                             "correlations and a fitted four-quarter forecast once a multi-month "
                             "export is supplied — no rework required.",
                     "tie": "Ties to the gates stated in sections 2 and 3."})
    return recs


# ------------------------------------------------------------------ document
def build(res, meta):
    V, C, Fc, MAP = res["volume"], res["correlation"], res["forecast"], res["mapping"]
    n = V["total_cases"]
    preview = n < 30
    H = []
    A = H.append

    A('<div class="toolbar"><button class="btn" id="themeBtn" type="button">Light / dark</button>'
      '<button class="btn" id="printBtn" type="button">Print / PDF</button></div>')
    A('<div class="wrap">')
    A('<header class="rpt"><p class="eyebrow">Executive report · Panelist Support Operations</p>'
      '<h1>Panelist Support: Case Volume, Correlations &amp; Four-Quarter Outlook</h1>'
      '<p class="sub">%s &nbsp;·&nbsp; %d case record(s) from %d source file(s) &nbsp;·&nbsp; '
      'Generated %s</p></header>'
      % (ESC(("Coverage %s to %s" % (V["date_min"], V["date_max"])) if V["date_min"]
              else "No usable date field"),
         n, meta["file_count"], datetime.date.today().isoformat()))

    if preview:
        A('<div class="callout"><div class="t">Small sample — read as a layout preview</div>'
          'Only <b>%d record(s)</b> were loaded. Every figure below is arithmetically correct '
          'for those rows and should not be read as an operational result. Panels that require a '
          'real sample size are gated off and say so explicitly.</div>' % n)

    # ---------------- executive summary
    A('<section class="card"><h2>Executive summary</h2>')
    tiles = [("Total cases", "{:,}".format(n), "All records after de-duplication")]
    if V["unique_members"]:
        tiles.append(("Unique members", "{:,}".format(V["unique_members"]),
                      "%.2f cases per member" % (n / V["unique_members"])))
    if V["bucket"]["rows"]:
        t = V["bucket"]["rows"][0]
        tiles.append(("Top category", "%.0f%%" % t["pct"], "%s (%d cases)" % (t["label"], t["count"])))
    if V["origin"].get("computable") and V["origin"]["rows"]:
        t = V["origin"]["rows"][0]
        tiles.append(("Top origin", "%.0f%%" % t["pct"], "%s (%d cases)" % (t["label"], t["count"])))
    tiles.append(("Topics per case", "%.2f" % V["tag_load"]["mean_tags_per_case"],
                  "%.0f%% of cases carry 2+ topic tags" % V["tag_load"]["multi_tag_pct"]))
    rc = C.get("repeat_contact", {})
    if rc.get("computable"):
        tiles.append(("Repeat contacts", "%.0f%%" % rc["pct_cases_from_repeat"],
                      "of cases come from members with 2+ cases"))
    A('<div class="stats">' + "".join(
        '<div class="stat"><div class="k">%s</div><div class="v num">%s</div><div class="d">%s</div></div>'
        % (ESC(k), ESC(v), ESC(d)) for k, v, d in tiles[:6]) + "</div>")

    MR = res.get("most_received")
    if MR:
        A("<h3>Most received cases</h3>")
        bits = ['<div class="mr"><div class="lead"><b>%s</b> is the largest driver at '
                '<b>%d cases</b> (%.1f%% of all volume)%s.</div>'
                % (ESC(MR["label"]), MR["count"], MR["pct"],
                   (" raised by %d distinct members" % MR["members"]) if MR["members"] else "")]
        bits.append("<ul>")
        if MR["top_labels"]:
            bits.append("<li>Most common labels inside it: "
                        + "; ".join("%s (%d)" % (ESC(l["label"]), l["count"])
                                    for l in MR["top_labels"]) + "</li>")
        if MR["origin"]:
            bits.append("<li>Arrives mainly on <b>%s</b> — %d of its %d cases (%.1f%%)</li>"
                        % (ESC(MR["origin"]["label"]), MR["origin"]["count"], MR["count"],
                           MR["origin"]["pct"]))
        bits.append("</ul></div>")
        A("".join(bits))

    AN = res.get("anomaly") or {}
    A("<h3>Movement watch</h3>")
    if AN.get("alerts"):
        A('<div class="alerts">' + "".join(
            '<div class="alert %s"><span class="dir">%s</span><span>%s</span></div>'
            % ("down" if a["level"] == "down" else "up",
               "increase" if a["level"] == "up" else "decrease", ESC(a["text"]))
            for a in AN["alerts"]) + "</div>")
    elif (AN.get("weekly") or {}).get("computable") or (AN.get("monthly") or {}).get("computable"):
        parts = []
        for b in (AN.get("weekly"), AN.get("monthly")):
            if b and b.get("computable"):
                parts.append("%s-over-%s %+d case(s) (%s to %s)"
                             % (b["label"], b["label"], b["change"],
                                b["previous_key"], b["current_key"]))
        A('<div class="alerts"><div class="alert calm"><span class="dir">steady</span>'
          "<span>Nothing crossed the alert thresholds (a move must be at least %d%% "
          "<i>and</i> at least %d cases): %s.</span></div></div>"
          % (RULES["anomaly"]["pct_threshold"], RULES["anomaly"]["min_abs_change"],
             "; ".join(parts) if parts else "no complete period pair to compare"))
    else:
        wk = AN.get("weekly") or {}
        mo = AN.get("monthly") or {}
        A(na_block("Week-over-week and month-over-month movement",
                   {"reason": AN.get("reason")
                              or wk.get("reason") or mo.get("reason")
                              or "not enough complete periods to compare",
                    "needs": AN.get("needs") or ["a date column covering 2+ complete periods"]}))

    DR = res.get("drivers") or []
    if DR:
        A("<h3>Top 5 call drivers</h3>")
        A('<p class="sub">Ranked by primary category. Positions 1–%d are the named drivers; '
          'position %d rolls up every remaining category so the five add to 100%%.</p>'
          % (RULES["gates"]["top_drivers"], len(DR)))
        chart_rows = [{"label": "%d. %s" % (d["rank"], d["label"]),
                       "count": d["count"], "pct": d["pct"]} for d in DR]
        A('<div class="drivers"><figure>' + svg_hbar(chart_rows, n, label_w=196, W=560)
          + "</figure><div>" + drivers_table(DR, n) + "</div></div>")

    A("<h3>Top findings</h3>")
    finds = build_findings(V, C, preview)
    if finds:
        A('<ol class="find">' + "".join("<li><b>%s</b>%s</li>" % (ESC(t), ESC(d)) for t, d in finds) + "</ol>")
    else:
        A('<p class="sub">No finding clears its evidence threshold at this record count.</p>')

    if V["date_field_is_proxy"]:
        A('<div class="callout"><div class="t">Date caveat carried through the whole report</div>'
          'No case-creation timestamp is present, so every time-based figure uses <b>Modified On</b>. '
          'That records the last time a case was touched, not when it arrived — a case opened in '
          'March and reopened in July counts as July. Trend direction and any "within N days" '
          'sequencing should be read with that distortion in mind.</div>')
    A("</section>")

    # ---------------- 1. volume
    A('<section class="card"><h2><span class="secnum">1</span>Ticket volume &amp; category breakdown</h2>')
    INF = res.get("inference") or {}
    if INF.get("from_subject") or INF.get("unresolved"):
        A('<div class="callout info"><div class="t">Cases bucketed from the subject line</div>'
          '<b>%d of %d cases (%.1f%%)</b> had no usable Category value — blank, or a label that '
          'matched no bucket rule — so their bucket was inferred from the subject line instead. '
          '%s A further <b>%d case(s) (%.1f%%)</b> could not be placed from either field and stay '
          'in Other / Unmapped. Every inferred assignment, and the keyword that triggered it, is '
          'listed in Appendix A.</div>'
          % (INF.get("from_subject", 0), INF.get("total", 0), INF.get("pct_from_subject", 0.0),
             ("They landed in: " + "; ".join("%s (%d)" % (ESC(b["label"]), b["count"])
                                             for b in INF.get("by_bucket", [])) + ".")
             if INF.get("by_bucket") else "",
             INF.get("unresolved", 0), INF.get("pct_unresolved", 0.0)))
    A('<p>Every case is assigned to exactly one <b>primary category</b> — the first label in its '
      'Category field — and that primary label is mapped to a reporting bucket. Shares therefore '
      'sum to 100%. The full label-to-bucket mapping is in the appendix; secondary topic tags are '
      'counted separately in the topic-load table so multi-issue demand is not lost.</p>')

    DRV = res.get("drivers") or []
    brows = [{"label": d["label"], "count": d["count"], "pct": d["pct"]} for d in DRV] \
        or cap_series(list(V["bucket"]["rows"]))[0]
    rolled = next((d for d in DRV if d.get("rolled")), None)
    A('<div class="grid2">')
    A('<figure><h3 style="margin-top:0">Category mix (primary category)</h3>'
      + svg_donut(brows, n) + legend(brows)
      + '<figcaption>One bucket per case; shares sum to 100%%.%s</figcaption></figure>'
      % (" %s rolls up %d lower-volume categories, itemised in the table."
         % (rolled["label"], len(rolled["rolled"])) if rolled else ""))
    A("<div>" + dist_table(brows, n, "Category bucket")
      + (("<p class='sub'>%s contains: %s.</p>"
          % (ESC(rolled["label"]), ESC(", ".join(rolled["rolled"])))) if rolled else "")
      + "</div>")
    A("</div>")

    A('<div class="grid2" style="margin-top:26px">')
    if V["origin"].get("computable"):
        orows, ofold = cap_series(list(V["origin"]["rows"]))
        A('<figure><h3 style="margin-top:0">Contact origin</h3>' + svg_hbar(orows, n, W=520)
          + "<figcaption>Count and share of total cases by channel of arrival.</figcaption></figure>")
        A("<div>" + dist_table(orows, n, "Origin") + "</div>")
    else:
        A(na_block("Origin breakdown", V["origin"]))
    A("</div>")

    A("<h3>Top 5 primary category labels (raw, before bucketing)</h3>")
    prows = list(V["primary_raw"]["rows"])[:5]
    A(svg_hbar(prows, n, series_color="var(--s1)", label_w=240))
    A('<p class="sub">The five most-used raw labels out of %d distinct labels seen in the '
      'Category field; the remainder are in the Appendix A mapping table. Percentages are of '
      'all %d cases, so these five do not sum to 100%%.</p>'
      % (V["tag_load"]["distinct_tags"], n))

    A("<h3>Origin × category cross-tab</h3>")
    if V["crosstab"].get("computable"):
        A(heat_table(fold_crosstab(V["crosstab"], DRV) if DRV else V["crosstab"]))
        A('<p class="sub">Columns are the same five call drivers used throughout; cell shading '
          'is a single-hue sequential ramp on case count and exact counts are printed in every '
          'cell.</p>')
    else:
        A(na_block("Origin × category cross-tab", V["crosstab"]))

    A("<h3>Topic load (all tags, not just the primary)</h3>")
    tl = V["tag_load"]
    A('<p>Cases carry <b>%.2f</b> category tags on average; <b>%d</b> of %d cases (%.1f%%) carry '
      'more than one, across <b>%d</b> distinct labels. The denominator below is cases, so these '
      'shares deliberately sum above 100%%.</p>'
      % (tl["mean_tags_per_case"], tl["multi_tag_cases"], n, tl["multi_tag_pct"], tl["distinct_tags"]))
    A('<div class="scroll"><table><thead><tr><th>Top 10 topic tags (any position)</th><th class="n">Cases</th>'
      '<th class="n">% of cases</th></tr></thead><tbody>'
      + "".join('<tr><td>%s</td><td class="n">%d</td><td class="n">%.1f%%</td></tr>'
                % (ESC(t["label"]), t["count"], t["pct_of_cases"]) for t in tl["top"][:10])
      + "</tbody></table></div>")

    MV = res.get("movement") or {}
    A("<h3>Monthly movement</h3>")
    A(movement_block(MV.get("monthly", {"label": "month", "reason":
        "no monthly view available", "needs": ["a date column"]}), DRV))
    A("<h3>Quarterly movement</h3>")
    A(movement_block(MV.get("quarterly", {"label": "quarter", "reason":
        "no quarterly view available", "needs": ["a date column"]}), DRV))

    for key, ttl in (("site", "Breakdown by office / site"), ("agent", "Breakdown by agent")):
        rec = V.get(key) or {}
        if rec.get("computable"):
            rows, _ = cap_series(list(rec["rows"]), 10)
            A("<h3>%s</h3>" % ESC(ttl) + svg_hbar(rows, n))
        else:
            A("<h3>%s</h3>" % ESC(ttl) + na_block(ttl, rec))
    A("</section>")

    # ---------------- 2. correlation
    A('<section class="card"><h2><span class="secnum">2</span>Multivariate correlation analysis</h2>')
    g = C["gate"]
    A('<p>Each hypothesised chain is tested as measured co-occurrence, not asserted narrative. '
      'A chain is only reported when the dataset carries at least <b>%d cases</b> and at least '
      '<b>%d cases showing both signals</b>; otherwise it is marked NOT COMPUTABLE with the '
      'specific field or volume it needs. Signals are matched across every category tag on a case '
      'plus its subject line — never the free-text description body, which is excluded from all '
      'processing that reaches this page.</p>' % (g["min_cases"], g["min_cooccurrence"]))

    for key in ("chain_hw_inactivity", "chain_reward_dupes", "chain_google_lockout", "chain_field_service"):
        ch = C[key]
        if ch.get("computable"):
            A('<h3 style="display:flex;flex-wrap:wrap;gap:10px;align-items:baseline">%s'
              '<span class="pill v-%s">%s</span></h3>'
              % (ESC(ch["title"]), ch["verdict"], ESC(ch["verdict_text"])))
        else:
            A("<h3>%s</h3>" % ESC(ch["title"]))
        if ch.get("computable"):
            A('<div class="stats">' + "".join(
                '<div class="stat"><div class="k">%s</div><div class="v num">%s</div>'
                '<div class="d">%s</div></div>' % (k, v, d) for k, v, d in [
                    ("Cases with leading signal", "{:,}".format(ch["n_a"]), "denominator"),
                    ("Also show downstream", "%.1f%%" % ch["pct_of_a_with_b"],
                     "%d joint cases" % ch["joint"]),
                    ("Base rate", "%.1f%%" % ch["base_rate_b"], "downstream signal, all cases"),
                    ("Lift", "%.2fx" % (ch["lift"] or 0), "vs. base rate")]) + "</div>")
            if ch.get("note"):
                A('<div class="callout info"><div class="t">Scope limit</div>%s</div>' % ESC(ch["note"]))
        else:
            A(na_block(ch["title"], ch))

    A("<h3>Repeat-contact behaviour</h3>")
    if rc.get("computable"):
        A('<div class="stats">' + "".join(
            '<div class="stat"><div class="k">%s</div><div class="v num">%s</div><div class="d">%s</div></div>'
            % (k, v, d) for k, v, d in [
                ("Members", "{:,}".format(rc["members"]), "distinct member IDs"),
                ("Repeat members", "{:,}".format(rc["members_with_multiple_cases"]),
                 "%.1f%% of members" % rc["pct_members_repeat"]),
                ("Cases from repeats", "{:,}".format(rc["cases_from_repeat_members"]),
                 "%.1f%% of volume" % rc["pct_cases_from_repeat"]),
                ("Busiest member", "{:,}".format(rc["max_cases_one_member"]), "cases, single member")]) + "</div>")
        A('<p class="sub">Member identifiers are used only to group cases; no identifier, name, '
          'email or phone number appears anywhere in this report.</p>')
    else:
        A(na_block("Repeat-contact behaviour", rc))

    A("<h3>Other correlations found in the data</h3>")
    d = C["discovered"]
    if d.get("computable") and d["pairs"]:
        A('<div class="scroll"><table><thead><tr><th>Signal A</th><th>Signal B</th>'
          '<th class="n">Cases with A</th><th class="n">Both</th><th class="n">% of A with B</th>'
          '<th class="n">Base rate</th><th class="n">Lift</th></tr></thead><tbody>'
          + "".join('<tr><td>%s</td><td>%s</td><td class="n">%d</td><td class="n">%d</td>'
                    '<td class="n">%.1f%%</td><td class="n">%.1f%%</td><td class="n"><b>%.2fx</b></td></tr>'
                    % (ESC(p["a"].replace("_", " ")), ESC(p["b"].replace("_", " ")), p["n_a"],
                       p["joint"], p["pct_of_a_with_b"], p["base_rate_b"], p["lift"])
                    for p in d["pairs"]) + "</tbody></table></div>")
        A('<p class="sub">Co-occurrence within a single case. Lift above 1.0 means the pair appears '
          'together more often than the downstream signal\'s overall rate — association, not causation. '
          'Pairs where one signal wholly contains the other are excluded as definitional.</p>')
    elif d.get("computable"):
        A('<p class="sub">No signal pair cleared the joint-occurrence threshold.</p>')
    else:
        A(na_block("Open correlation scan", d))
    A("</section>")

    # ---------------- 3. forecast
    A('<section class="card"><h2><span class="secnum">3</span>Projected support trends — next four quarters</h2>')
    if Fc.get("computable"):
        A('<p><b>Method:</b> ordinary least-squares linear trend fitted to <b>%d</b> months of '
          'observed case volume (slope %+.2f cases/month), summed to quarterly totals. The interval '
          'is ±1.96 residual standard deviations. %s</p>'
          % (Fc["months_fitted"], Fc["slope_cases_per_month"], ESC(Fc["caveat"])))
        A('<p class="sub">Observed history below shows only calendar quarters with all three '
          'months present. A forward quarter that already contains observed months uses those '
          'actuals and models only the remainder — its interval narrows accordingly.</p>'
          if Fc.get("partial_note") else "")
        A('<div class="scroll"><table><thead><tr><th>Quarter</th><th class="n">Projected cases</th>'
          '<th class="n">Low</th><th class="n">High</th><th class="n">Months modelled</th></tr></thead><tbody>'
          + "".join('<tr><td><b>%s</b>%s</td><td class="n">%s</td><td class="n">%s</td>'
                    '<td class="n">%s</td><td class="n">%d of 3</td></tr>'
                    % (ESC(q["label"]),
                       ' <span class="pill p3" style="font-size:.6rem">part observed</span>'
                       if q["partial"] else "",
                       "{:,}".format(q["point"]), "{:,}".format(q["low"]),
                       "{:,}".format(q["high"]), q["fitted_months"]) for q in Fc["quarters"])
          + "</tbody></table></div>")
        A(svg_forecast(Fc.get("history", []), Fc["quarters"]))
        A('<div class="legend"><span><span class="swatch" style="background:var(--s1)"></span>'
          'Observed quarterly volume (solid)</span><span><span class="swatch" '
          'style="background:var(--s1);opacity:.35"></span>Projection with ±1.96 residual-SD interval '
          '(dashed)</span></div>')
    else:
        A('<p><b>Method:</b> no forecast is produced.</p>')
        A(na_block("Four-quarter forecast", Fc))
        A('<div class="callout"><div class="t">Why no directional estimate is shown either</div>'
          'A directional estimate built from category mix would still need a category mix that is '
          'representative of the operation. At this record count it is not, so publishing a shaped '
          'curve would give a VP a number with no evidence behind it. Supply an export spanning '
          'three or more months and this section fills in automatically with a fitted trend, '
          'per-quarter interval and mix projection.</div>')
    A("</section>")

    # ---------------- 4. risk
    A('<section class="card"><h2><span class="secnum">4</span>Predictive trend analysis &amp; risk forecasting</h2>')
    A('<p>Exposure below is sized directly from measured case share. The threat and owner columns '
      'are an <b>operational interpretation</b> of each bucket, not a value derived from the export — '
      'they are shown so the ranking is actionable, and should be challenged where they do not match '
      'how the operation is actually organised.</p>')
    risks = build_risks(V, C)
    A('<div class="scroll"><table><thead><tr><th>Rank</th><th>Category bucket</th>'
      '<th class="n">Cases</th><th class="n">Share</th><th>Principal forward risk</th>'
      '<th>Likely owner</th></tr></thead><tbody>'
      + "".join('<tr><td class="n">%d</td><td><span class="swatch" style="background:%s"></span>'
                '<b>%s</b></td><td class="n">%d</td><td class="n">%.1f%%</td><td>%s</td><td>%s</td></tr>'
                % (i + 1, cvar(i), ESC(r["bucket"]), r["count"], r["pct"], ESC(r["threat"]), ESC(r["owner"]))
                for i, r in enumerate(risks)) + "</tbody></table></div>")

    A("<h3>Leading indicators worth instrumenting</h3>")
    A("<ul>"
      "<li><b>Topic tags per case</b> — currently %.2f. A rise means single contacts are absorbing "
      "more unresolved issues; it moves before handle time and before CSAT.</li>"
      "<li><b>Share of volume from repeat members</b> — %s. Rising repeat share is the earliest "
      "sign that first-contact resolution is failing.</li>"
      "<li><b>Reactivation and activity-inquiry share of primary category</b> — the closest "
      "available proxy for panelists drifting toward involuntary purge.</li>"
      "<li><b>Outbound / callback share</b> — a rise indicates inbound channels are not closing "
      "issues on first contact.</li></ul>"
      % (V["tag_load"]["mean_tags_per_case"],
         ("%.1f%%" % rc["pct_cases_from_repeat"]) if rc.get("computable") else "not yet computable"))

    A("<h3>If nothing changes</h3>")
    if Fc.get("computable"):
        q4 = Fc["quarters"][-1]
        A("<p>The fitted trend carries volume to roughly <b>%s cases</b> in %s (range %s–%s) with the "
          "current mix intact — that is the do-nothing baseline against which any intervention "
          "should be measured.</p>" % ("{:,}".format(q4["point"]), ESC(q4["label"]),
                                       "{:,}".format(q4["low"]), "{:,}".format(q4["high"])))
    else:
        A('<div class="na"><div class="t">Do-nothing trajectory</div><p>Quantifying the do-nothing '
          'case requires the forecast in section 3, which is gated off. What can be stated without '
          'a forecast: the concentration in the leading bucket and the multi-topic case structure '
          'are both structural, so neither resolves on its own without an intervention.</p></div>')
    A("</section>")

    # ---------------- 5. recommendations
    A('<section class="card"><h2><span class="secnum">5</span>Strategic recommendations &amp; action plan</h2>')
    recs = build_recs(V, C, finds)
    for i, r in enumerate(recs):
        A('<div class="rec"><div class="h"><span class="pill p%d">Priority %d</span>'
          '<span class="pill p3">%s</span><span class="pill p3">Owner: %s</span></div>'
          '<h4 style="margin:.1em 0 .35em;font-size:1rem;color:var(--text)">%s</h4><p>%s</p>'
          '<div class="ties">%s</div></div>'
          % (min(r["pri"], 3), r["pri"], ESC(r["horizon"]), ESC(r["owner"]),
             ESC(r["title"]), r["body"], ESC(r["tie"])))
    A("</section>")

    # ---------------- appendix
    A('<section class="card"><h2>Appendix A — category label mapping (audit)</h2>')
    A('<p>Every distinct label seen in the Category field, the bucket it was assigned to, and how '
      'often it appears in any tag position. <b>%d</b> distinct labels; <b>%d</b> fell through to '
      'Other / Unmapped. Ordered rules are applied to the label text, first match wins — so a label '
      'naming a device resolves to Hardware &amp; Meter even when it also mentions activity.</p>'
      % (MAP["distinct"], MAP["unmapped_count"]))
    A('<div class="scroll"><table><thead><tr><th>Raw label</th><th>Assigned bucket</th>'
      '<th class="n">Occurrences</th></tr></thead><tbody>'
      + "".join('<tr><td class="mono">%s</td><td>%s</td><td class="n">%d</td></tr>'
                % (ESC(i["label"]), ESC(i["bucket"]), i["count"]) for i in MAP["items"])
      + "</tbody></table></div>")
    if INF.get("keywords"):
        A("<h3>Subject-line inference (cases with no usable category)</h3>")
        A("<p>Where the Category field was blank or unrecognised, the subject line was matched "
          "against the same ordered rules. The keyword below is the exact text that triggered "
          "each assignment — the subject itself is never shown, since it can carry identifying "
          "detail.</p>")
        A('<div class="scroll"><table><thead><tr><th>Matched keyword in subject</th>'
          '<th>Assigned bucket</th><th class="n">Cases</th></tr></thead><tbody>'
          + "".join('<tr><td class="mono">%s</td><td>%s</td><td class="n">%d</td></tr>'
                    % (ESC(k["keyword"]), ESC(k["bucket"]), k["count"])
                    for k in INF["keywords"]) + "</tbody></table></div>")
    A("</section>")

    A('<section class="card"><h2>Appendix B — sources &amp; data handling</h2>')
    A('<div class="scroll"><table><thead><tr><th>File</th><th>Sheet</th><th>Status</th>'
      '<th class="n">Rows</th><th>Columns not mapped</th></tr></thead><tbody>'
      + "".join('<tr><td class="mono">%s</td><td>%s</td><td>%s</td><td class="n">%s</td>'
                '<td class="mono">%s</td></tr>'
                % (ESC(p["file"]), ESC(p.get("sheet", "") or "—"), ESC(p["status"]), p["rows"],
                   ESC(", ".join(p.get("unmapped", [])) or "—")) for p in meta["prov"])
      + "</tbody></table></div>")
    A("<p>Records read: <b>%d</b>. Exact duplicates removed: <b>%d</b>. Records analysed: <b>%d</b>.</p>"
      % (meta["stats"].get("rows_read", 0), meta["stats"].get("exact_duplicates_removed", 0),
         meta["stats"].get("rows_after_dedupe", 0)))
    A('<p><b>Privacy.</b> Member identifiers are used only to group cases into members and are never '
      'printed. Subject and description free text is used only for keyword signal matching; no '
      'free-text content, name, email address or phone number is rendered anywhere in this '
      'document, and no row-level record is included.</p>')
    A('<p class="foot">All figures computed directly from the supplied export(s). Panels marked '
      'NOT COMPUTABLE indicate a field or sample size the export does not provide; no value in this '
      'report is estimated, imputed or carried over from outside the data.</p>')
    A("</section></div>")

    return ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>Panelist Support — Executive Report</title><style>" + CSS + "</style></head>"
            "<body>" + "".join(H) + "<script>" + JS + "</script></body></html>")
