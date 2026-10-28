# Checks for the local report

Three scripts, run with Playwright against `../index.html` opened as a `file://` URL
with every non-file request blocked, so they prove the offline claim rather than
assuming it.

```bash
pip install playwright openpyxl && playwright install chromium
python make-fixture.py     # writes fixtures/august-sample.xlsx and fixtures/edge-cases.xlsx
python verify-logic.py     # 25 checks: one per classification rule, plus the targets
python audit-network.py    # every request the page makes, and what it stores
```

- **`make-fixture.py`** rebuilds the August sample (5 cases, 15 notes, the phrases that
  drive classification kept verbatim) and an edge-case workbook: placeholder chains, a
  case that never resolves, a 23:50 → 00:10 boundary, telemetry-only follow-ups, a
  non-phone case, a text-formatted date and a row with no case number.
- **`verify-logic.py`** asserts each rule end to end — single note closes on first
  contact even when it says "escalated"; a multi-note case resolves at the first note
  carrying resolution language, not the first non-placeholder; calendar days, not hours;
  never-resolved stays in the denominator unless excluded; telemetry does not resolve a
  case; an override beats the phrase match and the automatic verdict survives into the
  CSV.
- **`audit-network.py`** records every request the page makes while loading an export,
  sorting, editing phrases, overriding and exporting, then reads back localStorage,
  sessionStorage, cookies, IndexedDB and service workers.

Expected: `25/25 checks passed`, one request (the HTML file itself), and empty storage.

Paths in the scripts are absolute; edit the two constants at the top if you move them.
