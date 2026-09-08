import {readDelimited} from '../web/parse.js';
import {makeEngine} from '../web/analyze.js';
import {readFileSync} from 'fs';
const RULES=JSON.parse(readFileSync(new URL('../rules.json', import.meta.url),'utf8'));
const eng=makeEngine(RULES);
const file=process.argv[2];
const rows=readDelimited(readFileSync(file,'utf8'));
// the real basename: the cleanup worklist reports which file a row came from,
// so a placeholder here would compare two different things
const {recs,stats,prov}=eng.buildRecords([{file:file.split('/').pop(),sheet:'',rows}]);
const r=eng.run(recs);
const V=r.volume,C=r.correlation,F=r.forecast;
const out={
  total:V.total_cases, members:V.unique_members, months:V.months_spanned,
  dmin:V.date_min, dmax:V.date_max, dedupe:stats.exact_duplicates_removed,
  buckets:V.bucket.rows.map(x=>[x.label,x.count,x.pct]),
  origins:V.origin.rows.map(x=>[x.label,x.count,x.pct]),
  tag_mean:V.tag_load.mean_tags_per_case, tag_distinct:V.tag_load.distinct_tags,
  crosstab_total:V.crosstab.col_totals,
  chains:['chain_hw_inactivity','chain_reward_dupes','chain_google_lockout','chain_field_service']
    .map(k=>[k,C[k].computable?[C[k].n_a,C[k].joint,C[k].pct_of_a_with_b,C[k].lift]:'NC']),
  repeat:C.repeat_contact.computable?[C.repeat_contact.members,C.repeat_contact.members_with_multiple_cases,C.repeat_contact.pct_cases_from_repeat]:'NC',
  discovered:(C.discovered.pairs||[]).map(p=>[p.a,p.b,p.lift]),
  fc_method:F.method, fc_slope:F.slope_cases_per_month,
  fc_hist:(F.history||[]).map(h=>[h.label,h.point]),
  fc_q:(F.quarters||[]).map(q=>[q.label,q.point,q.low,q.high,q.fitted_months]),
  wl:[r.worklist.flagged,r.worklist.pct_flagged,r.worklist.has_case_id,
      r.worklist.columns,r.worklist.summary,r.worklist.labels,
      r.worklist.rows.slice(0,40),r.worklist.rows.slice(-10)],
  wl_sheets:eng.worklistSheets(r.worklist,{files:"F",generated:"G"})
    .map(sh=>[sh.name,sh.header,sh.widths,sh.filter,sh.rows.length,sh.rows.slice(0,6)]),
  cube_p:Object.fromEntries(Object.entries(r.cube.periods).map(([k,v])=>[k,[v.length,v.length?v[0]:null,v.length?v[v.length-1]:null]])),
  cube_d:r.cube.counts.day.map(o=>o.reduce((a,p)=>a+p.reduce((x,y)=>x+y,0),0)),
  prc:[r.volume.primary_raw_clean.excluded_cases, r.volume.primary_raw_clean.rows.map(x=>[x.label,x.count])],
  map_distinct:r.mapping.distinct, map_unmapped:r.mapping.unmapped_count,
  inf:[r.inference.from_category,r.inference.from_subject,r.inference.unresolved,r.inference.pct_from_subject],
  inf_kw:r.inference.keywords.map(k=>[k.bucket,k.keyword,k.count]),
  drivers:r.drivers.map(x=>[x.rank,x.volume_rank??null,!!x.pinned,x.label,x.count,x.pct]),
  wk:r.anomaly.weekly&&r.anomaly.weekly.computable?[r.anomaly.weekly.keys.length,r.anomaly.weekly.current,r.anomaly.weekly.previous,r.anomaly.weekly.pct_change,r.anomaly.weekly.z??null]:'NC',
  mo:r.anomaly.monthly&&r.anomaly.monthly.computable?[r.anomaly.monthly.keys.length,r.anomaly.monthly.current,r.anomaly.monthly.previous,r.anomaly.monthly.pct_change,r.anomaly.monthly.z??null]:'NC',
  alerts:r.anomaly.alerts.map(a=>[a.level,a.scope,a.text]),
  mv_m:r.movement.monthly.computable?[r.movement.monthly.keys,r.movement.monthly.totals,r.movement.monthly.stack.map(s=>[s.name,s.values]),r.movement.monthly.insights.map(i=>[i.kind,i.text]),r.movement.monthly.rows.map(x=>[x.key,x.total,x.delta,x.pct,x.top_bucket,x.top_count,x.top_pct])]:['NC',r.movement.monthly.reason],
  mv_q:r.movement.quarterly.computable?[r.movement.quarterly.keys,r.movement.quarterly.totals,r.movement.quarterly.stack.map(s=>[s.name,s.values]),r.movement.quarterly.insights.map(i=>[i.kind,i.text]),r.movement.quarterly.rows.map(x=>[x.key,x.total,x.delta,x.pct,x.top_bucket,x.top_count,x.top_pct])]:['NC',r.movement.quarterly.reason],
  q:[r.quality.kb_size,r.quality.cases_with_junk_token,r.quality.pct_with_junk_token,r.quality.junk_distinct,r.quality.junk_tag_total,r.quality.unknown_distinct,r.quality.unknown_tag_total,r.quality.primary_junk_cases,r.quality.primary_junk_pct,r.quality.primary_unknown_cases,r.quality.primary_unknown_pct],
  q_junk:r.quality.junk_labels.map(x=>[x.label,x.count,(x.examples||[]).map(e=>[e.position,e.cell])]),
  q_unk:r.quality.unknown_labels.map(x=>[x.label,x.count,(x.examples||[]).map(e=>[e.position,e.cell])]),
  hdrs:prov.map(p=>[p.headers||[],p.unmapped||[]]),
  inf2:[r.inference.from_kb,r.inference.from_rule,r.inference.pct_from_kb,r.inference.pct_from_rule],
  cube:[r.cube.origins,r.cube.drivers,r.cube.periods.week.length,r.cube.periods.month.length,r.cube.periods.quarter.length,
        (r.cube.counts.week||[]).map(o=>o.map(p=>p.reduce((a,b)=>a+b,0)).reduce((a,b)=>a+b,0))],
  dd:r.deep_dives.map(d=>[d.id,d.facet_set,d.cases,d.pct_of_total,d.with_free_text,
      (d.facets||[]).map(f=>[f.name,f.coverage_pct,f.unmatched,f.rows.map(x=>[x.label,x.count,x.pct])]),
      d.cross?[d.cross.a,d.cross.b,d.cross.matrix,d.cross.row_totals,d.cross.col_totals]:null,
      [d.by_source,d.categories_charted,d.categories_excluded],
      d.trend&&d.trend.computable?[d.trend.mom_change,d.trend.mom_pct,d.trend.window_pct,d.trend.total_window_pct,d.trend.peak_key,d.trend.peak_value,d.trend.peak_ratio,d.trend.share_first,d.trend.share_last,d.trend.share_change,d.trend.months]:'NC',
      d.repeat&&d.repeat.computable?[d.repeat.members,d.repeat.repeat_members,d.repeat.pct_cases_from_repeat]:'NC',
      d.monthly&&d.monthly.computable?d.monthly.values:'NC',
      (d.top_categories||[]).map(x=>[x.label,x.count])]),
  most:r.most_received?[r.most_received.label,r.most_received.count,r.most_received.top_labels.map(l=>l.label),r.most_received.origin?r.most_received.origin.label:null]:null,
};
console.log(JSON.stringify(out));
