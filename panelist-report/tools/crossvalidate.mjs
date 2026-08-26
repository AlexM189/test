import {readDelimited} from '../web/parse.js';
import {makeEngine} from '../web/analyze.js';
import {readFileSync} from 'fs';
const RULES=JSON.parse(readFileSync(new URL('../rules.json', import.meta.url),'utf8'));
const eng=makeEngine(RULES);
const file=process.argv[2];
const rows=readDelimited(readFileSync(file,'utf8'));
const {recs,stats}=eng.buildRecords([{file:'x',sheet:'',rows}]);
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
  map_distinct:r.mapping.distinct, map_unmapped:r.mapping.unmapped_count,
};
console.log(JSON.stringify(out));
