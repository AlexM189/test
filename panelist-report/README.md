# Panelist Support — Executive Report Pipeline

Builds a single self-contained HTML executive report from raw support-case exports.

## Usage

```bash
# drop exports (CSV / TSV / XLSX / XLS / PDF / PPTX) into data/, then:
python3 run.py

# or pass paths explicitly - multiple files are reconciled into one dataset
python3 run.py '/path/to/*.xlsx' /path/to/site-b.csv
```

Output: `out/panelist-support-report.html` — inline CSS/JS, no external requests,
mobile-responsive, print-friendly, light and dark.

With no files in `data/`, it falls back to `sample/` (3 rows transcribed from the
export header screenshot) and renders a clearly-labelled layout preview. The member
numbers in that fixture are replaced with placeholders; only the category, origin and
date structure is real.

## Files

| File | Role |
|---|---|
| `ingest.py`  | Reads each format, fuzzy-maps headers to canonical fields, de-duplicates |
| `analyze.py` | Primary-category assignment, bucket mapping, cross-tabs, lift tests, forecast |
| `render.py`  | Server-side SVG charts and the HTML document |
| `run.py`     | Entry point |

## Rules the pipeline enforces

- **Primary category = the first label in the Category field.** One bucket per case,
  so section 1 shares sum to 100%. Secondary tags are counted separately as topic load.
- **Nothing is estimated.** Any figure that cannot be computed renders as a
  `NOT COMPUTABLE` panel naming the missing field or the sample size required.
  Gates: 30+ cases and 5+ joint occurrences for a lift figure, 3+ months for a fitted trend.
- **No PII.** Member IDs group cases and are never printed. Subject text is used only
  for keyword matching; the description body is excluded from all processing that
  reaches the page. No row-level record is ever rendered.
- **Category label mapping is published** in Appendix A — every raw label, its assigned
  bucket, and its frequency, so the mapping can be audited and corrected.

## Adding a field

Header aliases live in `ingest.ALIASES`; bucket rules in `analyze.BUCKET_RULES`
(ordered, first match wins); correlation signals in `analyze.SIGNALS`.
