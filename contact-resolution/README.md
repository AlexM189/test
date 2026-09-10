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

Plus a per-case table showing the phrase that classified each case, expandable to the
full note timeline with every row labelled, a CSV export and a print/PDF layout.

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
