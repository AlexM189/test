# Panelist Support — Executive Report

Turns raw support-case exports into a single self-contained HTML executive report:
volume and category breakdown, multivariate correlation tests, a four-quarter
forecast, risk ranking and a prioritised action plan.

Two front ends, one analysis engine.

## 1. Browser tool (no install)

```bash
python3 build.py          # -> out/panelist-report-builder.html
```

Open that file in a browser, drop in `.xlsx` / `.xlsm` / `.csv` / `.tsv` (several at
once), click **Build report**. The report renders in the page and downloads as a
standalone HTML file.

**Nothing is uploaded.** Files are read, parsed and analysed inside the page — the
build fails if any external reference or network call survives bundling. It works
offline and can be emailed as a single file.

XLSX is unzipped with the platform `DecompressionStream` and the sheet XML parsed
directly, so no spreadsheet library is bundled. Excel serial dates are converted
using the workbook's own 1900/1904 epoch and number formats.

## 2. Python CLI (batch, plus PDF/PPT)

```bash
# drop exports into data/, then:
python3 run.py

# or pass paths explicitly - multiple files reconcile into one dataset
python3 run.py '/path/to/*.xlsx' /path/to/site-b.csv
```

Output: `out/panelist-support-report.html`. The CLI additionally reads **PDF and
PPTX** table exports, which the browser tool does not.

With no files in `data/`, it falls back to `sample/` (3 rows transcribed from the
export header screenshot) and renders a clearly-labelled preview. The member
numbers in that fixture are placeholders; only the category, origin and date
structure is real.

## Keeping the two in step

`rules.json` is the single source of truth for header aliases, bucket rules,
correlation signals, gates and the risk/owner table. `web/report.css` and
`web/report-runtime.js` are shared too. Only the report-building code exists
twice (`render.py` and `web/render.js`), so:

```bash
python3 tools/crossvalidate.py sample/sample_cases.csv       # any CSV(s)
```

runs both engines over the same input and compares 20 headline metrics — volume,
mix, cross-tab totals, every correlation chain, repeat contact, discovered pairs
and the full forecast. It exits non-zero on any difference. Run it after touching
either engine. (Requires `node`.)

## Files

| File | Role |
|---|---|
| `rules.json` | Shared aliases, bucket rules, signals, gates, risk table |
| `ingest.py` | CSV/XLSX/PDF/PPTX readers, header mapping, de-duplication |
| `analyze.py` | Category assignment, cross-tabs, lift tests, forecast |
| `render.py` | Server-side SVG charts and the HTML document |
| `run.py` | CLI entry point |
| `build.py` | Bundles the browser tool into one HTML file |
| `web/parse.js` | Zero-dependency ZIP + XLSX + CSV readers |
| `web/analyze.js` | Analysis engine (port of `analyze.py`) |
| `web/render.js` | Renderer (port of `render.py`) |
| `web/app.js` | Upload UI controller |
| `web/report.css`, `web/report-runtime.js` | Shared styling and runtime |
| `tools/crossvalidate.py` | Engine equivalence check |

## Rules the pipeline enforces

- **Primary category = the first label in the Category field.** One bucket per case,
  so section 1 shares sum to 100%. Secondary tags are counted separately as topic
  load against a case denominator, deliberately summing above 100%.
- **Subject-line fallback.** When the Category field is blank or its primary label
  matches no bucket rule, the subject line is matched against `subject_rules`
  instead ("missing 100% reward" -> Incentives & Rewards). The report states how
  many cases were placed this way, which buckets they went to, and Appendix A
  lists every triggering keyword. Cases neither field can place stay in
  Other / Unmapped and are counted separately. Only the matched keyword is ever
  shown - never the subject text, which can carry identifying detail.
- **Five call drivers everywhere.** `gates.top_drivers` (default 4) named buckets
  plus one rolled-up "Various topics" row. The same five appear in the exec-summary
  driver chart, the donut, the cross-tab columns and the trend lines, so no chart
  carries more series than a reader can follow.
- **Movement watch.** Week-over-week and month-over-month change on complete
  calendar periods only, plus per-driver moves. A move is only flagged when it
  clears both a percentage and an absolute-case threshold, so small counts cannot
  manufacture an alarming percentage. Thresholds live in `rules.json` under
  `anomaly`.
- **Nothing is estimated.** Any figure that cannot be computed renders as a
  `NOT COMPUTABLE` panel naming the missing field or the sample size required.
  Gates: 30+ cases and 5+ joint occurrences for a lift figure, 3+ months for a
  fitted trend.
- **Definitional pairs are excluded** from the open correlation scan — if one signal
  wholly contains another, that is a tautology, not a finding.
- **Forecast uses real calendar quarters**, taking actuals for already-observed
  months and narrowing the interval accordingly; partly-observed quarters are
  flagged.
- **De-duplication normalises dates first**, so the same case exported as `.xlsx`
  and as `.csv` is recognised as one case rather than two.
- **No PII.** Member IDs group cases and are never printed. Subject text is used only
  for keyword matching; the description body is excluded from all processing that
  reaches the page. No row-level record is ever rendered.
- **Category label mapping is published** in Appendix A — every raw label, its
  assigned bucket, and its frequency, so the mapping can be audited and corrected.

## Adding a field or changing a mapping

Everything lives in `rules.json`: `aliases` (header synonyms), `bucket_rules`
(ordered, first match wins), `signals` (correlation matching), `gates`,
`risk_profile`. Edit it, run `python3 build.py`, then `python3 tools/crossvalidate.py`.
