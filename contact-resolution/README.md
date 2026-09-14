# Contact Resolution — local report

One HTML file. No server, no install, no upload: open `index.html` in a browser and
it runs. SheetJS is vendored inside the file, so it works with no network at all
(the IBM Plex webfonts are the only online part, and they fall back cleanly).

```bash
# just open it
xdg-open contact-resolution/index.html      # Linux
open contact-resolution/index.html          # macOS
start contact-resolution\index.html         # Windows
```

Drop the case export on the page (or click to choose it). The file is parsed by the
page itself — nothing is sent anywhere, and nothing is written to disk or to browser
storage. Close the tab and it is gone, overrides included.

## What it reports

| | Target |
|---|---|
| % of cases resolved on the **first contact** | 80% |
| of the remainder, % resolved **within 2 calendar days** | 90% |

- **KPI row** — both rates against their targets, with the target marked on each bar,
  plus the number of cases in scope and what was excluded or reclassified.
- **Contact resolution at a glance** — written takeaways (each rate in pp against its
  target, median follow-up time, the slowest case), a composition bar of all four
  buckets with the 80% line on it, the same for the remainder with the 90% line, and a
  resolution-time profile (same day / 1 / 2 / 3+ days).
- **Falls outside the KPI window** — every breach, with the exact first-contact and
  resolution timestamps, the calendar days the metric counted, the true elapsed time,
  and **the notes the verdict rests on** (initial contact, the deciding note, and a
  drawer with the rest). Reclassify from the card, or confirm the breach is real to
  clear it from the list — it still counts against the KPI.
- **Inside the window, still worth a look** — cases that pass but whose read is
  doubtful: the case came back after it was closed, the first note sits on the
  export's earliest day (so the real initial contact may predate the window), or
  someone has already reclassified it.
- **Case-level detail** — every case, sortable by case number, household, first
  contact, note count, status, resolution date or days. Status sorts by severity, so
  one click brings the breaches to the top. Expand a row for the automatic verdict and
  every note, each labelled with what the classifier made of it.
- **Export CSV** — one line per case carrying both verdicts: final status and days,
  the exact elapsed time, the matched phrase, the automatic status it replaced, the
  override reason, and whether the case is a breach or has been reviewed.

## Input

One row per case-note entry, with columns whose headers *contain*:

- `Case Number` — also matches `Case Number (Regarding) (Case)`, `Case ID`, `Ticket Number`
- `Created On` — also `Created Date`, `Created At`, `Timestamp`
- `Description` — also `Note`, `Comment`, `Details`

Optional and used when present: `Created By`, `Case Origin` (drives the Inbound Phone
scope toggle — the toggle disables itself when the column is missing) and `Household`.
The first sheet carrying the three required columns is used, so hidden helper sheets in
a CRM export are skipped. Dates are read as Excel dates, serial numbers or text.

## The rules, in short

1. Group by case number, sort notes by `Created On` ascending.
2. **One note → resolved on first contact**, whatever it says. One touch with no
   follow-up is closed.
3. **Two or more notes → never a first-contact resolution.** Notes 2, 3, 4 … are
   scanned in order; the first carrying **resolution language** is the moment of
   resolution. A note that only records another try is skipped, and so is a
   substantive note that states no outcome.
4. Elapsed time is **calendar days** (13 Aug 23:50 → 14 Aug 00:10 is 1 day).
5. No resolution language anywhere → **breach**, kept in the denominator. Switchable to
   "excluded" under *How cases are classified*.

Classification is explicit phrase matching against two editable lists; **only the
resolution list moves the numbers** — the placeholder list labels why a note was
skipped. Device telemetry lines (`Status: ACTIVE`, `Last Heartbeat: …`) are stripped
before matching.

Full write-up, the default phrase lists and the reasoning behind the rules:
[`../docs/contact-resolution-metric.md`](../docs/contact-resolution-metric.md).

## Third-party

[SheetJS](https://sheetjs.com) (xlsx) 0.18.5, Apache-2.0, embedded in `index.html`.
IBM Plex Sans / Mono via Google Fonts, with system fallbacks when offline.
