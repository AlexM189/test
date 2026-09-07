window.__reportInit = function(root){
  root = root || document;
  var r=document.documentElement, K='panelist-report-theme';
  try{var s=localStorage.getItem(K); if(s) r.setAttribute('data-theme',s);}catch(e){}
  var b=root.getElementById ? root.getElementById('themeBtn') : root.querySelector('#themeBtn');
  if(b) b.addEventListener('click',function(){
    var cur=r.getAttribute('data-theme');
    if(!cur) cur = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light';
    var nxt = cur==='dark' ? 'light':'dark';
    r.setAttribute('data-theme',nxt);
    try{localStorage.setItem(K,nxt);}catch(e){}
  });
  if(!window.__ddPrintBound){
    window.__ddPrintBound=true;
    window.addEventListener('beforeprint',function(){
      document.querySelectorAll('details.dd').forEach(function(d){
        if(!d.open){ d.open=true; d.setAttribute('data-reopened','1'); }
      });
    });
    window.addEventListener('afterprint',function(){
      document.querySelectorAll('details.dd[data-reopened]').forEach(function(d){
        d.open=false; d.removeAttribute('data-reopened');
      });
    });
  }
  var pb=root.getElementById ? root.getElementById('printBtn') : root.querySelector('#printBtn'); if(pb) pb.addEventListener('click',function(){window.print();});
  var tip=document.querySelector('body > .tip');
  if(!tip){ tip=document.createElement('div'); tip.className='tip'; document.body.appendChild(tip); }
  function show(e){
    var t=e.currentTarget.getAttribute('data-tip'); if(!t) return;
    tip.textContent=t; tip.classList.add('on');
    var x=e.clientX+14, y=e.clientY-34, w=tip.offsetWidth||140;
    if(x+w>innerWidth-8) x=e.clientX-w-14; if(y<6) y=e.clientY+20;
    tip.style.left=x+'px'; tip.style.top=y+'px';
  }
  function hide(){tip.classList.remove('on');}
  root.querySelectorAll('[data-tip]').forEach(function(el){
    if(el.__tipBound) return; el.__tipBound=true;
    el.classList.add('hit');
    el.addEventListener('mousemove',show); el.addEventListener('mouseenter',show);
    el.addEventListener('mouseleave',hide);
    el.addEventListener('touchstart',function(ev){show(ev.touches?{clientX:ev.touches[0].clientX,
      clientY:ev.touches[0].clientY,currentTarget:el}:ev);},{passive:true});
  });
};
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', function(){ window.__reportInit(document); });
else window.__reportInit(document);

/* ------------------------------------------------------------------ explorer
   Slice the whole period by time grain, date range, case origin and topic.
   Everything is computed from a small aggregation cube (origin x period x
   driver) embedded in the page; no row-level record is ever shipped, so
   filtering cannot expose a case. */
window.__explorerInit = function (root) {
  root = root || document;
  var host = root.querySelector('#explorer');
  var data = root.querySelector('#cubeData');
  if (!host || !data) return;
  var cube;
  try { cube = JSON.parse(data.textContent); } catch (e) { return; }

  var keysOf = function (g) { return (cube.periods || {})[g] || []; };
  var countsOf = function (g) { return (cube.counts || {})[g] || []; };
  var GRAINS = [['day', 'Day', 'day'], ['week', 'Week', 'week'],
                ['month', 'Month', 'month'], ['quarter', 'Quarter', 'quarter']]
    .filter(function (g) { return keysOf(g[0]).length > 0; });
  if (!GRAINS.length) return;

  var TOP = cube.top_drivers || 4;
  var VARIOUS = cube.various_label || 'Various topics';
  var NDRV = (cube.drivers || []).length;

  // the week is the grain the operation plans around, so lead with it - unless the
  // export is too short for weeks to say anything, in which case drop to days
  var grain = keysOf('week').length >= 4 ? 'week' : GRAINS[0][0];
  var state = { grain: grain, origin: -1, topic: -1,
                a: 0, b: keysOf(grain).length - 1 };

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c];
    });
  };
  var f1 = function (n) { return (Math.round(n * 10) / 10).toFixed(1); };
  var th = function (n) { return Number(n).toLocaleString('en-US'); };
  var grainName = function (g, n) {
    var w = { day: 'day', week: 'week', month: 'month', quarter: 'quarter' }[g || state.grain];
    return n === 1 ? w : w + 's';
  };

  /* ---------------------------------------------------------------- totals */

  // [origin][driver] summed over periods a..b of a grain
  function rangeTotals(g, a, b) {
    var counts = countsOf(g);
    return counts.map(function (perPeriod) {
      var row = [], d;
      for (d = 0; d < NDRV; d++) row.push(0);
      for (var p = a; p <= b; p++) {
        var cell = perPeriod[p];
        if (!cell) continue;
        for (d = 0; d < cell.length; d++) row[d] += cell[d];
      }
      return row;
    });
  }
  // the whole period means every case, including any that fall in a partial week
  // at either end and so belong to no complete period - that is the total quoted
  // everywhere else in the report, and the explorer must agree with it
  function wholeRange() { return state.a === 0 && state.b === keysOf(state.grain).length - 1; }
  function selTotals() {
    return (wholeRange() && cube.total) ? cube.total
      : rangeTotals(state.grain, state.a, state.b);
  }
  function pick(mat, oi, ti) {
    var t = 0;
    for (var o = 0; o < mat.length; o++) {
      if (oi >= 0 && o !== oi) continue;
      if (ti >= 0) t += mat[o][ti];
      else for (var d = 0; d < mat[o].length; d++) t += mat[o][d];
    }
    return t;
  }
  function seriesFor(g, oi, ti) {
    var counts = countsOf(g);
    return keysOf(g).map(function (_, p) {
      var t = 0;
      for (var o = 0; o < counts.length; o++) {
        if (oi >= 0 && o !== oi) continue;
        var cell = counts[o][p];
        if (!cell) continue;
        if (ti >= 0) t += cell[ti];
        else for (var d = 0; d < cell.length; d++) t += cell[d];
      }
      return t;
    });
  }

  /* Top N drivers, plus any pinned driver wherever it ranks, plus one rolled-up
     row - the same rule the static report uses, so filtering can never make a
     pinned driver disappear or let the roll-up pose as the biggest driver. */
  function rankRows(mat, oi) {
    var tot = [], d;
    for (d = 0; d < NDRV; d++) tot.push(0);
    for (var o = 0; o < mat.length; o++) {
      if (oi >= 0 && o !== oi) continue;
      for (d = 0; d < mat[o].length; d++) tot[d] += mat[o][d];
    }
    var rows = cube.drivers.map(function (n, i) { return { label: n, count: tot[i] }; })
      .filter(function (r) { return r.count > 0; })
      .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
    rows.forEach(function (r, i) { r.volume_rank = i + 1; });
    var sum = rows.reduce(function (a, r) { return a + r.count; }, 0);
    var pinned = cube.pinned || [];
    var head = rows.slice(0, TOP).slice();
    var namedSet = {};
    head.forEach(function (r) { namedSet[r.label] = 1; });
    pinned.forEach(function (p) {
      if (namedSet[p]) return;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].label === p) { head.push(rows[i]); namedSet[p] = 1; break; }
      }
    });
    head = head.map(function (r, i) {
      return { rank: i + 1, label: r.label, count: r.count, volume_rank: r.volume_rank,
               pinned: pinned.indexOf(r.label) >= 0 && i >= TOP,
               pct: sum ? 100 * r.count / sum : 0 };
    });
    var tail = rows.filter(function (r) { return !namedSet[r.label]; });
    if (tail.length) {
      var c = tail.reduce(function (a, r) { return a + r.count; }, 0);
      head.push({ rank: head.length + 1, label: VARIOUS, count: c,
                  pct: sum ? 100 * c / sum : 0,
                  rolled: tail.map(function (r) { return r.label; }),
                  detail: tail.slice(0, 6) });
    }
    return { rows: head, total: sum };
  }

  /* ---------------------------------------------------------------- charts */

  var CH = { W: 980, H: 250, pl: 46, pb: 30, pt: 18, pr: 10 };
  function timeChart(vals, keys) {
    var W = CH.W, H = CH.H, pl = CH.pl, pb = CH.pb, pt = CH.pt, pr = CH.pr;
    var pw = W - pl - pr, ph = H - pt - pb;
    var mx = Math.max.apply(null, vals.concat([1]));
    var n = vals.length, slot = pw / n;
    var p = [], g, y, i;
    for (g = 0; g < 5; g++) {
      y = pt + ph * g / 4;
      p.push('<line x1="' + pl + '" y1="' + y.toFixed(1) + '" x2="' + (W - pr) + '" y2="' +
        y.toFixed(1) + '" stroke="var(--border)" stroke-width="1"/>');
      p.push('<text x="' + (pl - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" ' +
        'font-size="10.5" fill="var(--text-3)">' + th(Math.round(mx * (4 - g) / 4)) + '</text>');
    }
    // the selection is a band behind the marks, so it stays readable however
    // many periods are on the axis
    if (!(state.a === 0 && state.b === n - 1)) {
      p.push('<rect x="' + (pl + slot * state.a).toFixed(1) + '" y="' + pt + '" width="' +
        (slot * (state.b - state.a + 1)).toFixed(1) + '" height="' + ph +
        '" fill="var(--accent)" opacity=".10"/>');
    }
    var inSel = function (i) { return i >= state.a && i <= state.b; };
    if (n > 60) {
      // too many periods to read as bars: an area keeps the shape legible and the
      // band still says which part of it is selected
      var pts = vals.map(function (v, i) {
        return [(pl + slot * (i + 0.5)).toFixed(1), (pt + ph - ph * v / mx).toFixed(1)];
      });
      p.push('<path d="M' + pts[0][0] + ' ' + (pt + ph) + 'L' +
        pts.map(function (q) { return q[0] + ' ' + q[1]; }).join('L') + 'L' +
        pts[pts.length - 1][0] + ' ' + (pt + ph) + 'Z" fill="var(--s1)" opacity=".18"/>');
      p.push('<path d="M' + pts.map(function (q) { return q[0] + ' ' + q[1]; }).join('L') +
        '" fill="none" stroke="var(--s1)" stroke-width="1.6"/>');
      for (i = 0; i < n; i++) {
        if (!inSel(i)) continue;
        p.push('<rect x="' + (pl + slot * i).toFixed(1) + '" y="' +
          (pt + ph - Math.max(ph * vals[i] / mx, vals[i] ? 1 : 0)).toFixed(1) + '" width="' +
          Math.max(slot, 1).toFixed(1) + '" height="' +
          Math.max(ph * vals[i] / mx, vals[i] ? 1 : 0).toFixed(1) + '" fill="var(--s1)"/>');
      }
    } else {
      var bw = Math.min(slot * 0.72, 40);
      for (i = 0; i < n; i++) {
        var x = pl + slot * (i + 0.5) - bw / 2;
        var h = Math.max(ph * vals[i] / mx, vals[i] ? 1.5 : 0);
        p.push('<rect x="' + x.toFixed(1) + '" y="' + (pt + ph - h).toFixed(1) + '" width="' +
          bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="var(--s1)"' +
          (inSel(i) ? '' : ' opacity=".3"') + '/>');
      }
    }
    // axis labels: the two ends of the selection always, then as many evenly
    // spaced others as fit without colliding
    var step = Math.max(1, Math.ceil(n / Math.min(12, Math.floor(pw / 58))));
    var shown = {};
    var label = function (i, strong) {
      if (shown[i]) return;
      shown[i] = 1;
      p.push('<text x="' + (pl + slot * (i + 0.5)).toFixed(1) + '" y="' + (H - pb + 15) +
        '" text-anchor="middle" font-size="9.5" fill="' +
        (strong ? 'var(--text)' : 'var(--text-3)') + '"' +
        (strong ? ' font-weight="700"' : '') + '>' + esc(keys[i]) + '</text>');
    };
    label(state.a, true);
    if (state.b !== state.a) label(state.b, true);
    for (i = 0; i < n; i += step) {
      if (Math.abs(i - state.a) * slot > 52 && Math.abs(i - state.b) * slot > 52) label(i, false);
    }
    // one transparent slot per period on top: the whole column is the hit target,
    // so a one-pixel daily bar is still clickable and draggable
    for (i = 0; i < n; i++) {
      p.push('<rect class="xslot" data-i="' + i + '" x="' + (pl + slot * i).toFixed(1) +
        '" y="' + pt + '" width="' + Math.max(slot, 1).toFixed(1) + '" height="' + ph +
        '" fill="transparent" style="cursor:col-resize" data-tip="' +
        esc(keys[i] + ': ' + th(vals[i]) + ' contact(s) — click, or drag across to pick a range') +
        '"/>');
    }
    return '<svg class="chart xchart" viewBox="0 0 ' + W + ' ' + H + '" style="max-width:' + W +
      'px" role="img">' + p.join('') + '</svg>';
  }

  function miniList(d) {
    // scale against the biggest real driver, never the roll-up - and give the
    // roll-up no bar at all, so a bag of leftovers can never read as rank one
    var mx = 1;
    d.rows.forEach(function (r) { if (!r.rolled && r.count > mx) mx = r.count; });
    return '<ul class="mini">' + d.rows.map(function (r, i) {
      var w = Math.max(4, 100 * Math.min(r.count, mx) / mx);
      var tip = r.rolled ? ' data-tip="' + esc('Includes ' + r.rolled.length + ' smaller ' +
        'categories: ' + r.detail.map(function (x) { return x.label + ' (' + th(x.count) + ')'; })
          .join('; ') + (r.rolled.length > r.detail.length
            ? '; +' + (r.rolled.length - r.detail.length) + ' more' : '')) + '"' : '';
      return '<li' + tip + (r.rolled ? ' class="roll"' : '') + '><span class="rk">' + r.rank +
        '</span><span class="track">' +
        (r.rolled ? '<span class="bag" aria-hidden="true"></span>'
          : '<span class="bar" style="width:' + w.toFixed(1) + 'px;background:var(--s' +
            ((i % 8) + 1) + ')"></span>') + '<span class="t">' +
        esc(r.label) +
        (r.rolled ? ' <span style="color:var(--text-3)">(' + r.rolled.length + ')</span>' : '') +
        (r.pinned ? ' <span style="color:var(--text-3)">#' + r.volume_rank + ' by volume</span>' : '') +
        '</span></span><span class="vl">' + th(r.count) + ' · ' + f1(r.pct) + '%</span></li>';
    }).join('') + '</ul>';
  }

  /* ---------------------------------------------------------------- chrome */

  function chips(el, lab, opts, cur, set) {
    if (!el) return;
    el.innerHTML = '<span class="lab">' + esc(lab) + '</span>' + opts.map(function (o) {
      return '<button class="chip" type="button" data-v="' + o.v + '" aria-pressed="' +
        (o.v === cur ? 'true' : 'false') + '">' + esc(o.t) +
        (o.c == null ? '' : '<span class="ct">' + th(o.c) + '</span>') + '</button>';
    }).join('');
    el.querySelectorAll('.chip').forEach(function (c) {
      c.addEventListener('click', function () { set(c.getAttribute('data-v')); });
    });
  }

  function rangeLabel() {
    var keys = keysOf(state.grain);
    if (wholeRange()) return 'Whole period';
    if (state.a === state.b) return keys[state.a];
    return keys[state.a] + ' → ' + keys[state.b];
  }

  /* A period label back to the calendar days it covers, so a selection can be
     carried from one grain to another instead of being thrown away. */
  var DAY = 86400000;
  function boundsOf(g, key) {
    var m;
    if (g === 'day') {
      m = key.split('-');
      var t = Date.UTC(+m[0], +m[1] - 1, +m[2]);
      return [t, t];
    }
    if (g === 'week') {
      m = key.split('-W');
      var jan4 = Date.UTC(+m[0], 0, 4);
      var dow = (new Date(jan4).getUTCDay() + 6) % 7;             // Monday = 0
      var start = jan4 - dow * DAY + (+m[1] - 1) * 7 * DAY;
      return [start, start + 6 * DAY];
    }
    if (g === 'quarter') {
      m = key.split('Q');
      return [Date.UTC(+m[0], (+m[1] - 1) * 3, 1), Date.UTC(+m[0], (+m[1] - 1) * 3 + 3, 0)];
    }
    m = key.split('-');
    return [Date.UTC(+m[0], +m[1] - 1, 1), Date.UTC(+m[0], +m[1], 0)];
  }

  function setGrain(g) {
    if (g === state.grain) return;
    var newKeys = keysOf(g);
    if (!newKeys.length) return;
    if (wholeRange()) {
      state.grain = g; state.a = 0; state.b = newKeys.length - 1;
      render();
      return;
    }
    // keep the same slice of calendar time, so week -> day zooms into what you
    // were already looking at rather than dumping you back to the whole export
    var oldKeys = keysOf(state.grain);
    var lo = boundsOf(state.grain, oldKeys[state.a])[0];
    var hi = boundsOf(state.grain, oldKeys[state.b])[1];
    var a = -1, b = -1;
    for (var i = 0; i < newKeys.length; i++) {
      var q = boundsOf(g, newKeys[i]);
      if (q[1] < lo || q[0] > hi) continue;                        // no overlap
      if (a < 0) a = i;
      b = i;
    }
    state.grain = g;
    // a range too short to contain a single whole period of the coarser grain
    // still has to land somewhere sensible
    if (a < 0) {
      a = 0;
      for (var j = 0; j < newKeys.length; j++) {
        if (boundsOf(g, newKeys[j])[0] <= lo) a = j;
      }
      b = a;
    }
    state.a = a; state.b = b;
    render();
  }

  function setRange(a, b) {
    var n = keysOf(state.grain).length;
    state.a = Math.max(0, Math.min(a, b));
    state.b = Math.min(n - 1, Math.max(a, b));
    render();
  }

  /* ---------------------------------------------------------------- render */

  function render() {
    var keys = keysOf(state.grain);
    var vals = seriesFor(state.grain, state.origin, state.topic);
    var originName = state.origin < 0 ? 'all origins' : cube.origins[state.origin];
    var topicName = state.topic < 0 ? 'all topics' : cube.drivers[state.topic];
    var mat = selTotals();
    var sel = pick(mat, state.origin, state.topic);
    var grand = pick(cube.total || mat, -1, -1);

    // grain chips carry the number of periods, so it is obvious that a
    // one-week export has 7 days and no months to look at
    chips(root.querySelector('#granSlicer'), 'Time grain', GRAINS.map(function (g) {
      return { v: g[0], t: g[1], c: keysOf(g[0]).length };
    }), state.grain, setGrain);

    chips(root.querySelector('#originSlicer'), 'Case origin',
      [{ v: '-1', t: 'All', c: pick(cube.total || mat, -1, state.topic) }].concat(
        cube.origins.map(function (o, i) {
          return { v: String(i), t: o, c: pick(cube.total || mat, i, state.topic) };
        })), String(state.origin),
      function (v) { state.origin = +v; render(); });

    var tsel = root.querySelector('#topicSlicer');
    if (tsel) {
      var order = cube.drivers.map(function (d, i) {
        return { i: i, label: d, count: pick(cube.total || mat, state.origin, i) };
      }).sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
      tsel.innerHTML = '<span class="lab">Topic</span><select id="topicPick" ' +
        'aria-label="Filter by topic"><option value="-1">All topics</option>' +
        order.map(function (o) {
          return '<option value="' + o.i + '"' + (o.i === state.topic ? ' selected' : '') + '>' +
            esc(o.label) + ' (' + th(o.count) + ')</option>';
        }).join('') + '</select>';
      tsel.querySelector('#topicPick').addEventListener('change', function () {
        state.topic = +this.value; render();
      });
    }

    var rb = root.querySelector('#rangeBar');
    if (rb) {
      var quick = [];
      [4, 12, 26].forEach(function (k) {
        if (keys.length <= k) return;
        var on = state.a === keys.length - k && state.b === keys.length - 1;
        quick.push('<button class="chip" type="button" data-last="' + k + '" aria-pressed="' +
          (on ? 'true' : 'false') + '">Last ' + k + ' ' + grainName(state.grain, k) + '</button>');
      });
      rb.innerHTML = '<span class="lab">Range</span>' +
        '<button class="chip" type="button" data-last="0" aria-pressed="' +
        (wholeRange() ? 'true' : 'false') + '">Whole period</button>' + quick.join('') +
        '<span class="fromto"><label>From <select id="fromPick">' +
        keys.map(function (k, i) {
          return '<option value="' + i + '"' + (i === state.a ? ' selected' : '') + '>' +
            esc(k) + '</option>'; }).join('') + '</select></label>' +
        '<label>to <select id="toPick">' + keys.map(function (k, i) {
          return '<option value="' + i + '"' + (i === state.b ? ' selected' : '') + '>' +
            esc(k) + '</option>'; }).join('') + '</select></label></span>';
      rb.querySelectorAll('.chip').forEach(function (c) {
        c.addEventListener('click', function () {
          var k = +c.getAttribute('data-last');
          if (!k) setRange(0, keys.length - 1);
          else setRange(keys.length - k, keys.length - 1);
        });
      });
      rb.querySelector('#fromPick').addEventListener('change', function () {
        setRange(+this.value, Math.max(+this.value, state.b));
      });
      rb.querySelector('#toPick').addEventListener('change', function () {
        setRange(Math.min(state.a, +this.value), +this.value);
      });
    }

    root.querySelector('#xChart').innerHTML = timeChart(vals, keys);

    // headline figures for the slice: how big, how it compares with the window
    // immediately before it, and where its own peak sits
    var span = state.b - state.a + 1;
    var stats = [];
    if (grand) stats.push(['Share of all cases', f1(100 * sel / grand) + '%']);
    stats.push(['Average per ' + grainName(state.grain, 1),
                th(Math.round(sel / span)) + ' contacts']);
    if (state.a - span >= 0) {
      var prevMat = rangeTotals(state.grain, state.a - span, state.a - 1);
      var prev = pick(prevMat, state.origin, state.topic);
      var dp = prev ? 100 * (sel - prev) / prev : null;
      stats.push(['vs previous ' + span + ' ' + grainName(state.grain, span),
                  (dp === null ? '—' : (dp >= 0 ? '+' : '−') + f1(Math.abs(dp)) + '%'),
                  th(prev) + ' before', dp === null ? '' : (dp >= 0 ? 'up' : 'down')]);
    }
    var peak = state.a;
    for (var i = state.a; i <= state.b; i++) if (vals[i] > vals[peak]) peak = i;
    if (span > 1) stats.push(['Busiest ' + grainName(state.grain, 1),
                              keys[peak], th(vals[peak]) + ' contacts']);

    var body;
    if (state.topic < 0) {
      body = sel ? miniList(rankRows(mat, state.origin))
        : '<p class="sub">No contacts in this selection.</p>';
    } else {
      // one topic: the chart above is already its trend, so the panel answers
      // where those contacts came in and how much of the slice they are
      var rows = cube.origins.map(function (o, i) {
        return { label: o, count: pick(mat, i, state.topic) };
      }).filter(function (r) { return r.count > 0; })
        .sort(function (a, b) { return b.count - a.count; });
      var tot = rows.reduce(function (a, r) { return a + r.count; }, 0);
      var all = pick(mat, state.origin, -1);
      body = tot ? miniList({ rows: rows.map(function (r, i) {
        return { rank: i + 1, label: r.label, count: r.count,
                 pct: tot ? 100 * r.count / tot : 0 };
      }) }) + '<p class="sub" style="margin-top:.6em"><b>' + esc(topicName) + '</b> is ' +
        f1(all ? 100 * sel / all : 0) + '% of the ' + th(all) +
        ' contact(s) in this selection.</p>'
        : '<p class="sub">No <b>' + esc(topicName) + '</b> contacts in this selection.</p>';
    }

    root.querySelector('#xDetail').innerHTML =
      '<div class="wkdetail"><div class="hd"><b>' + esc(rangeLabel()) + '</b>' +
      '<span>' + th(sel) + ' contacts · ' + esc(originName) + ' · ' + esc(topicName) + '</span>' +
      '<span class="hint">click a bar, or drag across to pick a range</span></div>' +
      (stats.length ? '<div class="xstats">' + stats.map(function (s) {
        return '<div class="xstat' + (s[3] ? ' ' + s[3] : '') + '"><span class="k">' + esc(s[0]) +
          '</span><span class="v">' + esc(s[1]) + '</span>' +
          (s[2] ? '<span class="n">' + esc(s[2]) + '</span>' : '') + '</div>';
      }).join('') + '</div>' : '') + body + '</div>';

    // the call-driver ranking below the chart answers the same question for the
    // same slice - it would be a trap for it to keep showing the whole period
    var db = root.querySelector('#driverBlock');
    if (db) {
      // unfiltered, the rendered chart and table say it better than a mini list -
      // keep them, and swap in the compact list only once a filter narrows things
      if (db.__orig == null) db.__orig = db.innerHTML;
      var dmat = selTotals();
      var dsel = pick(dmat, state.origin, -1);
      var edge = wholeRange() && cube.total
        ? pick(cube.total, state.origin, -1) -
          seriesFor(state.grain, state.origin, -1).reduce(function (a, b) { return a + b; }, 0)
        : 0;
      db.innerHTML = (wholeRange() && state.origin < 0) ? db.__orig
        : '<p class="sub"><b>' + esc(rangeLabel()) + '</b> · ' + esc(originName) +
        ' · ' + th(dsel) + ' case(s).' +
        (edge > 0 ? ' Includes ' + th(edge) + ' case(s) in a partial ' +
          grainName(state.grain, 1) + ' at the edge of the export, which the chart above ' +
          'leaves out because a part-' + grainName(state.grain, 1) +
          ' bar reads as a collapse that never happened.' : '') + '</p>' +
        (dsel ? miniList(rankRows(dmat, state.origin))
          : '<p class="sub">No cases in this selection.</p>');
    }

    if (window.__reportInit) window.__reportInit(root.querySelector('#explorer'));
  }

  // redraw only the chart while a drag is in flight - re-rendering the tables on
  // every pointer move makes the sweep stutter
  function paint() {
    root.querySelector('#xChart').innerHTML =
      timeChart(seriesFor(state.grain, state.origin, state.topic), keysOf(state.grain));
  }

  /* Which period sits under the pointer. Derived from the chart geometry rather
     than from what was hit, so it works the same for a mouse, a finger, and a
     one-pixel daily bar. */
  function idxAt(clientX) {
    var svg = host.querySelector('#xChart svg');
    if (!svg) return -1;
    var r = svg.getBoundingClientRect();
    if (!r.width) return -1;
    var n = keysOf(state.grain).length;
    var vx = (clientX - r.left) / r.width * CH.W;
    var slot = (CH.W - CH.pl - CH.pr) / n;
    return Math.max(0, Math.min(n - 1, Math.floor((vx - CH.pl) / slot)));
  }

  /* Click a period to pick it, shift-click to extend, drag across to sweep.
     Bound once to the container: the chart inside it is replaced on every
     repaint, so per-bar listeners would not survive a drag. */
  var chartHost = root.querySelector('#xChart');
  var anchor = null;
  chartHost.addEventListener('pointerdown', function (ev) {
    var i = idxAt(ev.clientX);
    if (i < 0) return;
    ev.preventDefault();
    if (ev.shiftKey) { setRange(Math.min(i, state.a), Math.max(i, state.b)); return; }
    anchor = i;
    state.a = i; state.b = i;
    try { chartHost.setPointerCapture(ev.pointerId); } catch (e) {}
    paint();
  });
  chartHost.addEventListener('pointermove', function (ev) {
    if (anchor === null) return;
    var i = idxAt(ev.clientX);
    if (i < 0) return;
    state.a = Math.min(anchor, i);
    state.b = Math.max(anchor, i);
    paint();
  });
  var endDrag = function () {
    if (anchor === null) return;
    anchor = null;
    setRange(state.a, state.b);
  };
  chartHost.addEventListener('pointerup', endDrag);
  chartHost.addEventListener('pointercancel', endDrag);

  render();
};
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', function () { window.__explorerInit(document); });
else window.__explorerInit(document);

/* ------------------------------------------------------------------ chrome
   Section rail, scroll spy, back-to-top and change-direction colouring on the
   stat tiles. All of it is derived from the rendered DOM, so the Python and
   JavaScript renderers stay byte-identical and cannot drift apart here. */
window.__chromeInit = function (root) {
  root = root || document;
  var wrap = root.querySelector('.wrap');
  if (!wrap || wrap.querySelector('.tocbar')) return;
  var sections = [].slice.call(wrap.querySelectorAll('section.card'));
  if (sections.length < 3) return;

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c];
    });
  };

  var items = sections.map(function (sec, i) {
    if (!sec.id) sec.id = 'section-' + (i + 1);
    var h2 = sec.querySelector('h2');
    var badge = h2 && h2.querySelector('.secnum');
    // the badge is the section number; the rest of the heading is its name
    var num = badge ? badge.textContent.trim() : '';
    var name = h2 ? h2.textContent.replace(/^\s*\d+\s*/, '').trim() : sec.id;
    var short = name.split(/\s+[-—]\s+/)[0];
    if (short.length > 30) short = short.slice(0, 29).trim() + '…';
    return { id: sec.id, el: sec, num: num, label: short, full: name };
  });

  var bar = document.createElement('nav');
  bar.className = 'tocbar';
  bar.setAttribute('aria-label', 'Report sections');
  bar.innerHTML = '<div class="inner">' + items.map(function (it) {
    return '<a href="#' + it.id + '" title="' + esc(it.full) + '">' +
      (it.num ? '<span class="n">' + esc(it.num) + '</span>' : '') + esc(it.label) + '</a>';
  }).join('') + '</div>';
  wrap.insertBefore(bar, wrap.firstChild.nextSibling || wrap.firstChild);

  var links = [].slice.call(bar.querySelectorAll('a'));
  links.forEach(function (a, i) {
    a.addEventListener('click', function (ev) {
      ev.preventDefault();
      var top = items[i].el.getBoundingClientRect().top + window.pageYOffset - 62;
      window.scrollTo({ top: top, behavior: 'smooth' });
      history.replaceState(null, '', '#' + items[i].id);
    });
  });

  var current = -1;
  function spy() {
    var y = window.pageYOffset + 90;
    var idx = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].el.offsetTop <= y) idx = i;
    }
    if (idx !== current) {
      current = idx;
      links.forEach(function (a, i) {
        if (i === idx) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
      var a = links[idx];
      if (a && a.offsetLeft < bar.firstChild.scrollLeft) bar.firstChild.scrollLeft = a.offsetLeft - 12;
      else if (a && a.offsetLeft + a.offsetWidth > bar.firstChild.scrollLeft + bar.firstChild.clientWidth)
        bar.firstChild.scrollLeft = a.offsetLeft + a.offsetWidth - bar.firstChild.clientWidth + 12;
      edges();
    }
    top.classList.toggle('on', window.pageYOffset > 600);
  }

  var top = document.createElement('button');
  top.className = 'totop';
  top.type = 'button';
  top.setAttribute('aria-label', 'Back to top');
  top.innerHTML = '↑';
  top.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.body.appendChild(top);

  // the rail scrolls sideways when the sections do not fit; fade the edge that
  // still has links behind it so it does not look truncated
  var inner = bar.firstChild;
  function edges() {
    var over = inner.scrollWidth - inner.clientWidth;
    bar.classList.toggle('fade-l', over > 2 && inner.scrollLeft > 2);
    bar.classList.toggle('fade-r', over > 2 && inner.scrollLeft < over - 2);
  }
  inner.addEventListener('scroll', edges, { passive: true });
  window.addEventListener('resize', edges, { passive: true });
  edges();

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { spy(); ticking = false; });
  }, { passive: true });
  spy();

  // a tile whose value opens with a sign is a change - colour it like one
  root.querySelectorAll('.stat').forEach(function (st) {
    var v = st.querySelector('.v');
    if (!v) return;
    var t = v.textContent.trim();
    if (/^\+/.test(t)) st.classList.add('dir-up');
    else if (/^[-−]/.test(t)) st.classList.add('dir-down');
  });
};
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', function () { window.__chromeInit(document); });
else window.__chromeInit(document);
