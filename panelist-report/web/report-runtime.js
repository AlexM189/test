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
   Origin slicer + weekly volume + per-week top drivers. Everything is computed
   from a small aggregation cube (origin x period x driver) embedded in the page;
   no row-level record is ever shipped, so filtering cannot expose a case. */
window.__explorerInit = function (root) {
  root = root || document;
  var host = root.querySelector('#explorer');
  var data = root.querySelector('#cubeData');
  if (!host || !data) return;
  var cube;
  try { cube = JSON.parse(data.textContent); } catch (e) { return; }
  var weeks = (cube.periods && cube.periods.week) || [];
  var counts = (cube.counts && cube.counts.week) || [];
  if (!weeks.length || !counts.length) return;

  var TOP = cube.top_drivers || 4;
  var VARIOUS = cube.various_label || 'Various topics';
  var state = { origin: -1, week: weeks.length - 1 };   // -1 = all origins

  function seriesFor(oi) {
    return weeks.map(function (_, wi) {
      var t = 0;
      for (var o = 0; o < counts.length; o++) {
        if (oi >= 0 && o !== oi) continue;
        var row = counts[o][wi];
        for (var d = 0; d < row.length; d++) t += row[d];
      }
      return t;
    });
  }
  function driversFor(oi, wi) {
    var tot = cube.drivers.map(function () { return 0; });
    if (wi < 0 && cube.total) {
      // whole period: use the all-cases table, which includes cases that fall in a
      // partial week and so are absent from the weekly cube
      for (var o2 = 0; o2 < cube.total.length; o2++) {
        if (oi >= 0 && o2 !== oi) continue;
        for (var d2 = 0; d2 < cube.total[o2].length; d2++) tot[d2] += cube.total[o2][d2];
      }
    } else {
      for (var o = 0; o < counts.length; o++) {
        if (oi >= 0 && o !== oi) continue;
        for (var w = 0; w < weeks.length; w++) {
          if (wi >= 0 && w !== wi) continue;
          var row = counts[o][w];
          for (var d = 0; d < row.length; d++) tot[d] += row[d];
        }
      }
    }
    var rows = cube.drivers.map(function (n, i) { return { label: n, count: tot[i] }; })
      .filter(function (r) { return r.count > 0; })
      .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
    rows.forEach(function (r, i) { r.volume_rank = i + 1; });
    var sum = rows.reduce(function (a, r) { return a + r.count; }, 0);
    // pinned drivers are always named, never folded into the roll-up - the same rule
    // the static report uses, so filtering cannot make a pinned driver disappear
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
                  pct: sum ? 100 * c / sum : 0, rolled: tail.map(function (r) { return r.label; }) });
    }
    return { rows: head, total: sum };
  }
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c];
    });
  };
  var f1 = function (n) { return (Math.round(n * 10) / 10).toFixed(1); };
  var th = function (n) { return Number(n).toLocaleString('en-US'); };

  function barChart(vals) {
    var W = 720, H = 240, pl = 42, pb = 30, pt = 20, pr = 10;
    var pw = W - pl - pr, ph = H - pt - pb;
    var mx = Math.max.apply(null, vals.concat([1]));
    var slot = pw / vals.length, bw = Math.min(slot * 0.72, 40);
    var p = [], g, y, i;
    for (g = 0; g < 5; g++) {
      y = pt + ph * g / 4;
      p.push('<line x1="' + pl + '" y1="' + y.toFixed(1) + '" x2="' + (W - pr) + '" y2="' +
        y.toFixed(1) + '" stroke="var(--border)" stroke-width="1"/>');
      p.push('<text x="' + (pl - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" ' +
        'font-size="10.5" fill="var(--text-3)">' + Math.round(mx * (4 - g) / 4) + '</text>');
    }
    var step = Math.max(1, Math.ceil(vals.length / 12));
    for (i = 0; i < vals.length; i++) {
      var x = pl + slot * (i + 0.5) - bw / 2;
      var h = Math.max(ph * vals[i] / mx, vals[i] ? 1.5 : 0);
      var sel = i === state.week;
      p.push('<rect class="wkbar" data-w="' + i + '" x="' + x.toFixed(1) + '" y="' +
        (pt + ph - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) +
        '" rx="3" fill="' + (sel ? 'var(--s2)' : 'var(--s1)') + '" style="cursor:pointer" ' +
        'data-tip="' + esc(weeks[i] + ': ' + vals[i] + ' contacts — click for drivers') + '"/>');
      if ((i % step === 0 && Math.abs(i - state.week) > 1 &&
           (i !== vals.length - 1 || state.week !== vals.length - 1)) || sel) {
        p.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - pb + 15) +
          '" text-anchor="middle" font-size="9.5" fill="' +
          (sel ? 'var(--text)' : 'var(--text-3)') + '">' + esc(weeks[i]) + '</text>');
      }
      if (sel) {
        p.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (pt + ph - h - 6).toFixed(1) +
          '" text-anchor="middle" font-size="11" font-weight="700" fill="var(--text)">' +
          vals[i] + '</text>');
      }
    }
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" style="max-width:' + W +
      'px" role="img">' + p.join('') + '</svg>';
  }

  function miniList(d) {
    var mx = d.rows.length ? d.rows[0].count : 1;
    return '<ul class="mini">' + d.rows.map(function (r, i) {
      var w = Math.max(4, 100 * r.count / mx);
      return '<li><span class="rk">' + r.rank + '</span><span class="track">' +
        '<span class="bar" style="width:' + w.toFixed(1) + 'px;background:var(--s' +
        ((i % 8) + 1) + ')"></span><span class="t">' + esc(r.label) +
        (r.rolled ? ' <span style="color:var(--text-3)">(' + r.rolled.length + ')</span>' : '') +
        (r.pinned ? ' <span style="color:var(--text-3)">#' + r.volume_rank + ' by volume</span>' : '') +
        '</span></span><span class="vl">' + th(r.count) + ' · ' + f1(r.pct) + '%</span></li>';
    }).join('') + '</ul>';
  }

  function render() {
    var vals = seriesFor(state.origin);
    var originName = state.origin < 0 ? 'all origins' : cube.origins[state.origin];
    root.querySelector('#weeklyChart').innerHTML = barChart(vals);
    var wk = driversFor(state.origin, state.week);
    var all = driversFor(state.origin, -1);
    root.querySelector('#weekDetail').innerHTML =
      '<div class="wkdetail"><div class="hd"><b>' + esc(weeks[state.week]) + '</b>' +
      '<span>' + th(vals[state.week]) + ' contacts · ' + esc(originName) + '</span>' +
      '<span class="hint">click any bar to change week</span></div>' +
      (wk.total ? miniList(wk)
        : '<p class="sub">No contacts in this week for this origin.</p>') + '</div>';
    var db = root.querySelector('#driverBlock');
    if (db) {
      db.innerHTML = '<p class="sub">Filtered to <b>' + esc(originName) + '</b> — ' +
        th(all.total) + ' cases across the whole period.</p>' + miniList(all);
    }
    root.querySelectorAll('.wkbar').forEach(function (b) {
      b.addEventListener('click', function () {
        state.week = +b.getAttribute('data-w'); render();
      });
    });
    if (window.__reportInit) window.__reportInit(root.querySelector('#explorer'));
  }

  var sl = root.querySelector('#originSlicer');
  if (sl) {
    var totals = cube.origins.map(function (_, i) {
      if (cube.total) return cube.total[i].reduce(function (a, b) { return a + b; }, 0);
      return seriesFor(i).reduce(function (a, b) { return a + b; }, 0);
    });
    var grand = totals.reduce(function (a, b) { return a + b; }, 0);
    var html = '<span class="lab">Case origin</span>' +
      '<button class="chip" type="button" data-o="-1" aria-pressed="true">All' +
      '<span class="ct">' + th(grand) + '</span></button>';
    cube.origins.forEach(function (o, i) {
      html += '<button class="chip" type="button" data-o="' + i + '" aria-pressed="false">' +
        esc(o) + '<span class="ct">' + th(totals[i]) + '</span></button>';
    });
    sl.innerHTML = html;
    sl.querySelectorAll('.chip').forEach(function (c) {
      c.addEventListener('click', function () {
        state.origin = +c.getAttribute('data-o');
        sl.querySelectorAll('.chip').forEach(function (x) {
          x.setAttribute('aria-pressed', x === c ? 'true' : 'false');
        });
        render();
      });
    });
  }
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
