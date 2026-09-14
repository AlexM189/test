# Contact Resolution Rate

**Metric.** % of phone contacts resolved and closed.

**Targets.**

| # | Target | Measured as |
|---|--------|-------------|
| A | 80% of incoming calls resolved on the **first contact** | first-contact cases ÷ all cases |
| B | Of the remaining 20%, **90% resolved within 2 calendar days** of the initial contact | cases resolved ≤ 2 calendar days ÷ all re-opened cases |

Where it lives: **`contact-resolution/index.html`** — one self-contained page that runs
from disk, with the spreadsheet reader vendored inside it so it works offline. The
export is parsed by the page itself: nothing is uploaded, and no case note is written
to disk or to browser storage. The same rules also back the **📞 Resolution** tab of the
reservations app (`templates/index.html`); the standalone report is the one that gets
new work.

## Input

An Excel/CSV export with **one row per case-note entry**. Three columns are required;
the header only has to *contain* the name, so the CRM's
`Case Number (Regarding) (Case)` is matched as well as a plain `Case Number`.

| Needed | Header matched on (after lower-casing and stripping non-alphanumerics) |
|--------|------------------------------------------------------------------------|
| Case number | `casenumber`, `caseid`, `caseno`, `ticketnumber` |
| Timestamp | `createdon`, `createddate`, `createdat`, `datecreated`, `timestamp` |
| Note text | `description`, `note`, `comment`, `details` |
| *(optional)* agent | `createdby`, `agent`, `owner`, `user` |
| *(optional)* origin | `caseorigin`, `origin`, `channel` |

The first sheet carrying all three required columns is used, so hidden helper sheets
in a CRM export are skipped automatically. Rows with no case number or an unreadable
timestamp are dropped and counted in the file summary line.

Because the metric is about *phone* contacts, cases whose origin does not contain
"phone" are excluded when an origin column exists (toggle: **Phone-origin cases
only**, on by default). Origin is a case-level attribute in the export, so the filter
drops or keeps a case whole — a case is never half-analysed.

## Rules

1. Group rows by case number, sort each group by `Created On` ascending. The earliest
   row is the **initial contact**.
2. **One row only → resolved at first contact.** The note is not read at all. A single
   touch with no follow-up is a closed first contact even if it says "escalated" or
   "member didn't respond" — if it had not been closed, there would be a second row.
3. **Two or more rows → not a first-contact resolution.** The extra rows *are* the
   re-opens. Scan rows 2, 3, 4 … in order; the first row containing **resolution
   language** is the moment of resolution. A row that only records another try
   ("LMOM", "no answer") is not an outcome, so scanning continues — and so does a
   substantive row that simply never states an outcome.
4. For a case resolved this way, the elapsed time is **calendar days** between the
   initial contact's date and the resolving row's date (13 Aug 23:50 → 14 Aug 00:10 is
   1 day, not 0). ≤ 2 days counts toward target B.
5. **No row ever shows resolution language → the case was never resolved.** It counts
   as a **breach**: it stays in the target-B denominator and never in the numerator.

### Decision log

These three points were open when the metric was specified. Answers below are what the
code implements.

**1 — The contradiction in the source text.** The spec says both "a single row counts
as resolved at first contact even if the note says escalated" *and* "if the 2nd
description has a resolution, the case was resolved at the 1st contact". The second
sentence cannot be literally true: the existence of a second row *is* the re-open, so
the first contact did not close the case. Read as "…that means the case counts as
resolved (full stop)", the two statements agree, and that is what is implemented:
≥ 2 rows is never a first-contact resolution; it lands in the "remaining 20%" bucket
and is timed against the 2-day sub-target.

**2 — Phrase matching, not judgement.** Tone cannot be judged reliably from free text,
so classification is pure phrase matching against two explicit lists (below), editable
in the **Phrase lists** card and persisted per browser. Only the **resolution list
changes the numbers**: a row that matches nothing is skipped exactly like a placeholder
row, so the placeholder list is purely explanatory — it labels *why* a row was skipped
in the per-case timeline. Matching is case-insensitive, ignores punctuation and is
whole-word ("attempt" does not match "attempted").

**3 — A case whose last note is still generic.** Counted as **unresolved / breach**,
in the denominator of target B. Excluding such cases would flatter the number: a case
nobody ever resolved is the exact failure the metric exists to catch. The alternative
(*Excluded from the population*) is available in the dropdown for comparison; it drops
those cases from every denominator, including target A's.

### Telemetry stripping

Screenwise notes carry device dumps after the free text (`Status: ACTIVE`,
`- Last Heartbeat: …`, `State: PAUSED`, bare serials and ISO timestamps). Those lines
are removed before matching so a router's `Status: ACTIVE` cannot be read as "the
member's problem is fixed". The full note is still shown in the timeline.

## Default phrase lists

**Resolution language** — an outcome; the case is resolved at this row:

> closing case · closing the case · closing this case · case closed · closed the case ·
> case is closed · ticket closed · closing out · case resolved · resolved · resolution
> provided · marked as resolved · issue fixed · fixed the issue · issue is fixed ·
> problem solved · solved the issue · problem fixed · issue has been fixed · no longer
> an issue · sorted out · working now · works now · is working now · working properly ·
> working fine · working as expected · up and running · back online · came back online ·
> became active · now active · shows as active · confirmed working · verified working ·
> confirmed resolved · confirmed the issue was resolved · connected successfully ·
> successfully connected · managed to connect · connection restored · service restored ·
> restored service · reconnected successfully · devices are online · successfully
> completed · completed successfully · successfully installed · installation completed ·
> installation was completed · setup completed · setup complete · replacement shipped ·
> replacement delivered · replacement processed · return label sent · points credited ·
> points were credited · refund processed · credit applied · request completed ·
> completed the request · no further assistance · no further action · no further
> questions · nothing further · member thanked · pm thanked · thanked us · thanking us ·
> thanked and the call ended · call ended · member confirmed no other concerns · member
> was satisfied · member is satisfied

**Placeholder / another attempt** — no outcome; keep scanning:

> lmom · lmtcb · lvm · lm · left voicemail · left a voicemail · left message · left a
> message · voicemail left · vm left · voicemail full · mailbox full · no answer · no
> response · did not answer · didn't answer · did not pick up · didn't pick up · no pick
> up · unable to reach · could not reach · couldn't reach · tried to reach · tried
> calling · call dropped · line busy · busy signal · wrong number · number not in
> service · attempt · attempted · attempted contact · attempted to contact · attempt to
> contact · call attempt · second attempt · 2nd attempt · third attempt · 3rd attempt ·
> follow up attempt · follow up call · following up · follow up · checking in · awaiting
> response · awaiting member response · pending member response · waiting for member ·
> waiting on member · will call back · advised to call back · call back scheduled ·
> callback scheduled · follow up scheduled · pending follow up · case remains owned · no
> contact made

Deliberately **not** resolution language: "escalated", "technician scheduled", "advised
to call back", "follow-up scheduled" — those describe work still owed to the member.

## Output

The report is one self-contained HTML file (`contact-resolution/index.html`) that runs
from disk with no server and no network — the spreadsheet reader is vendored inside it.

- **KPI row** — both rates against their targets, the target marked on each bar, and a
  scope tile reporting what was excluded or reclassified.
- **At a glance** — written takeaways (each rate in percentage points against its
  target, median follow-up time, the slowest case, how many cases breach), a
  composition bar over all four buckets carrying the 80% line, the same for the
  remainder carrying the 90% line, and a resolution-time profile (same day / 1 / 2 /
  3+ days).
- **Falls outside the KPI window** — the breaches, in detail (below).
- **Inside the window, still worth a look** — cases that pass but whose read is
  doubtful (below).
- **Case-level detail** — every case, sortable on any column; expanding a row shows the
  automatic verdict and every note, each labelled with what the classifier made of it.
- **Export CSV** — one line per case carrying both the final and the automatic verdict.

### Chart colours

The four buckets need to stay apart from each other, and the report's own brand green,
amber and red do not: set side by side they fail the colour-blind separation and
normal-vision floors, and a second green built from the first reads as grey. So chart
marks carry their own tokens — green, blue, amber, red — validated against the report's
surface for CVD separation, contrast and lightness, while the page's brand colours stay
untouched for text, badges and borders. Each segment is labelled with its count (white
on the fill, dark ink where white would not clear 3:1, dropped when the segment is too
narrow), the legend repeats name, count and share, and the case table carries every
value — so colour never has to carry the meaning alone.

### Falls outside the KPI window

Standing question for a team leader: *which cases do I go and check in the CRM?* This
section lists every breach — resolved after the window, or never resolved — with the
case number, the exact first-contact and resolution timestamps, the calendar days the
metric counted, and the **true elapsed time** beside it, because the two differ (case
11997868: 14 calendar days, 13d 19h 44m).

Each card also carries **the notes the verdict rests on**: the initial contact, the
deciding note (the resolving note, or the last note when nothing resolved it), and a
drawer holding the rest. The words behind a breach are visible without leaving the
section.

Two actions per card: **reclassify** it (below), or **confirm the breach is genuine**,
which clears it from the list into a "reviewed & cleared" drawer. Confirming changes
nothing about the metric — the case still counts against the KPI; it only records that
a human has checked it.

### Inside the window, still worth a look

Cases that pass the KPI but whose classification is doubtful, each with the same
timestamps, elapsed time, deciding note and reclassify control:

| Flag | Why it matters |
|---|---|
| Notes continue after the resolving note | The case came back; the metric timed the first closure |
| First note on the export's earliest day | The case may have started before the window, so its "initial contact" may be wrong |
| Reclassified by hand | Someone overrode the automatic verdict — shown with their reason |

### Overriding a classification

Phrase matching will misjudge some cases, so the verdict is editable from the flag
cards, the watch cards, or any expanded table row. The choices are: the automatic
verdict, *resolved on first contact*, *resolved at note N* (each option shows that
note's date and the calendar days it would produce), or *still unresolved* — plus a
free-text reason.

- Overrides drive the KPIs, the charts and both review sections immediately.
- The automatic verdict is never discarded: the CSV exports `Classified By`,
  `Automatic Status`, `Automatic Days` and `Override Reason` beside the final numbers,
  so a reader of the export can always see what was changed by hand and why.
- Overrides live in the page for as long as the tab is open. The report states that
  nothing it touches is stored, and that promise is kept literally — closing the tab or
  loading another file clears them. Export the CSV to keep a record.

## Worked example — August 2026 sample (15 notes, 5 cases)

| Case | Notes | Outcome | Days | Matched |
|------|-------|---------|------|---------|
| 12169934 | 2 | resolved ≤ 2 days | 0 | "managed to connect" |
| 12011542 | 1 | first contact | 0 | *(single contact)* |
| 12071037 | 2 | resolved ≤ 2 days | 1 | "became active" |
| 11997868 | 9 | resolved > 2 days ↻ | 14 | "closing case" |
| 12079315 | 1 | first contact | 0 | *(single contact)* |

- First-contact resolution: **40.0%** (2 of 5) — target 80%, **not met**
- Of the remaining 3, within 2 calendar days: **66.7%** (2 of 3) — target 90%, **not met**

The sample is 5 cases; it exercises the rules, it does not measure the team. Run the
full month's export before reading anything into the percentages.

## Known limits

- Phrase matching is only as good as the lists. Sort the table by "Matched phrase" on a
  real export and audit the odd ones before publishing a number; add missing phrasings
  to the list rather than hand-correcting the output.
- Case 11997868 shows the pattern to watch: it was closed on 27 Aug and picked up again
  on 31 Aug. The metric times resolution to the *first* resolving row, per the spec, and
  flags the case with `↻` and in the "still worth a look" section. If a re-open after closure should
  re-start the clock, that is a rule change, not a bug fix — until then, the override bar
  is the escape hatch for individual cases.
- Overrides last only while the tab is open, by design — the report promises it stores
  nothing. A published number should come from one person's run, with the CSV exported
  as the record: it carries every override and its reason.
- Cases whose initial contact falls outside the export's window are analysed on the rows
  present, so a case that started in July will look like it began on its first August
  note. Export a window wide enough to carry each case's opening note.
