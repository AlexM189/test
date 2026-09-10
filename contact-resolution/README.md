# Contact Resolution Rate — standalone

One HTML file. No server, no install, no upload: open `index.html` in a browser and
it runs. SheetJS is vendored inside the file, so it also works with no network at all.

```bash
# just open it
xdg-open contact-resolution/index.html      # Linux
open contact-resolution/index.html          # macOS
start contact-resolution\index.html         # Windows
```

Drag the raw case-note export onto the page (or click **choose a file**). The file is
read by the page itself — nothing is sent anywhere, and no case note is ever written to
disk or to storage. Only your settings (phrase lists, the two options, light/dark) are
kept in the browser's local storage. **Demo data** loads ten made-up case notes if you
want to see the output before using a real export.

## What it reports

| | Target |
|---|---|
| % of cases resolved at **first contact** | 80% |
| of the remainder, % resolved **within 2 calendar days** | 90% |

Below the two KPI tiles:

- **Where the cases fall** — a bar per bucket (first contact / within the window /
  late / never resolved) with the case count and share of the population on each bar,
  hover or keyboard focus for what the bucket means.
- **Needs manual review** — every case that misses the KPI definition or whose
  classification is worth a second look, with the case number (click to copy) and the
  **exact timeframe**: both timestamps, the calendar days the metric used, and the real
  elapsed time (`13d 19h 44m`). A case is flagged when it was resolved after the
  window, was never resolved, kept receiving notes after its resolution row, or opens
  on the export's first day (so it may have started before the window).
- **Per-case table** with the phrase that classified each case, expandable to the full
  note timeline with every row labelled.
- CSV export and a print/PDF layout.

## Overriding a classification

Phrase matching gets cases wrong. **Review ▸** on any flagged case (or clicking the
case in the table) opens its notes with an override bar: pick the right bucket — or the
exact contact row that resolved it, which recomputes the timeframe — type a reason, and
apply. Overridden cases are marked ✎, the percentages and the chart follow them
immediately, and the CSV carries both the manual verdict and the automatic one it
replaced, with the reason and when it was set. Overrides are keyed by case number, so
they survive re-loading the same export; **Clear all overrides** returns everything to
the automatic verdicts.

## Input

One row per case-note entry, with columns whose headers *contain*:

- `Case Number` — also matches `Case Number (Regarding) (Case)`, `Case ID`, `Ticket Number`
- `Created On` — also `Created Date`, `Created At`, `Timestamp`
- `Description` — also `Note`, `Comment`, `Details`

Optional and used when present: `Created By` / `Agent`, `Case Origin` (drives the
phone-origin filter), `Household`. The first sheet carrying the three required columns
is used, so hidden helper sheets in a CRM export are skipped.

## The rules, in short

1. Group by case number, sort by `Created On` ascending.
2. **One row → resolved at first contact**, whatever the note says. One touch with no
   follow-up is closed.
3. **Two or more rows → never a first-contact resolution.** Rows 2, 3, 4 … are scanned
   in order; the first with resolution language is the moment of resolution.
4. Elapsed time is **calendar days** (13 Aug 23:50 → 14 Aug 00:10 is 1 day).
5. No resolution language anywhere → **breach**, kept in the denominator. Switchable to
   "excluded" in the dropdown.

Classification is explicit phrase matching against two editable lists; only the
resolution list changes the numbers. Device telemetry lines are stripped before matching.

Full write-up, the default phrase lists and the reasoning behind the rules:
[`../docs/contact-resolution-metric.md`](../docs/contact-resolution-metric.md).

## Third-party

[SheetJS](https://sheetjs.com) (xlsx) 0.18.5, Apache-2.0, embedded in `index.html`.
