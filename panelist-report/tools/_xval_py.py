import sys, json, glob
import os; sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import ingest, analyze
d,prov=ingest.load_paths([sys.argv[1]]); d,stats=ingest.clean(d)
r=analyze.run(d); V,C,F=r['volume'],r['correlation'],r['forecast']
out={
 "total":V["total_cases"],"members":V["unique_members"],"months":V["months_spanned"],
 "dmin":V["date_min"],"dmax":V["date_max"],"dedupe":stats["exact_duplicates_removed"],
 "buckets":[[x["label"],x["count"],x["pct"]] for x in V["bucket"]["rows"]],
 "origins":[[x["label"],x["count"],x["pct"]] for x in V["origin"]["rows"]],
 "tag_mean":V["tag_load"]["mean_tags_per_case"],"tag_distinct":V["tag_load"]["distinct_tags"],
 "crosstab_total":V["crosstab"]["col_totals"],
 "chains":[[k,([C[k]["n_a"],C[k]["joint"],C[k]["pct_of_a_with_b"],C[k]["lift"]] if C[k].get("computable") else "NC")]
           for k in ("chain_hw_inactivity","chain_reward_dupes","chain_google_lockout","chain_field_service")],
 "repeat":([C["repeat_contact"]["members"],C["repeat_contact"]["members_with_multiple_cases"],
            C["repeat_contact"]["pct_cases_from_repeat"]] if C["repeat_contact"].get("computable") else "NC"),
 "discovered":[[p["a"],p["b"],p["lift"]] for p in C["discovered"].get("pairs",[])],
 "fc_method":F["method"],"fc_slope":F.get("slope_cases_per_month"),
 "fc_hist":[[h["label"],h["point"]] for h in F.get("history",[])],
 "fc_q":[[q["label"],q["point"],q["low"],q["high"],q["fitted_months"]] for q in F.get("quarters",[])],
 "map_distinct":r["mapping"]["distinct"],"map_unmapped":r["mapping"]["unmapped_count"],
 "inf":[r["inference"]["from_category"],r["inference"]["from_subject"],r["inference"]["unresolved"],r["inference"]["pct_from_subject"]],
 "inf_kw":[[k["bucket"],k["keyword"],k["count"]] for k in r["inference"]["keywords"]],
 "drivers":[[x["rank"],x["label"],x["count"],x["pct"]] for x in r["drivers"]],
 "wk":([len(r["anomaly"]["weekly"]["keys"]),r["anomaly"]["weekly"]["current"],r["anomaly"]["weekly"]["previous"],r["anomaly"]["weekly"]["pct_change"],r["anomaly"]["weekly"].get("z")] if r["anomaly"]["weekly"] and r["anomaly"]["weekly"].get("computable") else "NC"),
 "mo":([len(r["anomaly"]["monthly"]["keys"]),r["anomaly"]["monthly"]["current"],r["anomaly"]["monthly"]["previous"],r["anomaly"]["monthly"]["pct_change"],r["anomaly"]["monthly"].get("z")] if r["anomaly"]["monthly"] and r["anomaly"]["monthly"].get("computable") else "NC"),
 "alerts":[[a["level"],a["scope"],a["text"]] for a in r["anomaly"]["alerts"]],
 "mv_m":([r["movement"]["monthly"]["keys"],r["movement"]["monthly"]["totals"],[[s["name"],s["values"]] for s in r["movement"]["monthly"]["stack"]],[[i["kind"],i["text"]] for i in r["movement"]["monthly"]["insights"]],[[x["key"],x["total"],x["delta"],x["pct"],x["top_bucket"],x["top_count"],x["top_pct"]] for x in r["movement"]["monthly"]["rows"]]] if r["movement"]["monthly"]["computable"] else ["NC",r["movement"]["monthly"]["reason"]]),
 "mv_q":([r["movement"]["quarterly"]["keys"],r["movement"]["quarterly"]["totals"],[[s["name"],s["values"]] for s in r["movement"]["quarterly"]["stack"]],[[i["kind"],i["text"]] for i in r["movement"]["quarterly"]["insights"]],[[x["key"],x["total"],x["delta"],x["pct"],x["top_bucket"],x["top_count"],x["top_pct"]] for x in r["movement"]["quarterly"]["rows"]]] if r["movement"]["quarterly"]["computable"] else ["NC",r["movement"]["quarterly"]["reason"]]),
 "most":([r["most_received"]["label"],r["most_received"]["count"],[l["label"] for l in r["most_received"]["top_labels"]],(r["most_received"]["origin"]["label"] if r["most_received"]["origin"] else None)] if r["most_received"] else None),
}
print(json.dumps(out))
