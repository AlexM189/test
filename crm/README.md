# Sales CRM

A CRM for a selling company, as a **single HTML file**. No server, no build step,
no dependencies — open `crm/index.html` in a browser and it runs.

```bash
# just open it
xdg-open crm/index.html      # Linux
open crm/index.html          # macOS
start crm\index.html         # Windows
```

It is independent of the office-reservations app in the repository root; the two
share nothing.

## What it does

| Area | What's there |
|---|---|
| **Dashboard** | Open pipeline, weighted forecast, won-this-month against target, win rate; pipeline by stage; closed-won revenue over the last 6 months; deals closing soon; overdue activities |
| **Pipeline** | Kanban board across Lead in → Qualified → Proposal → Negotiation, plus Won / Lost drop columns. Drag a card to change its stage |
| **Deals** | Sortable, filterable table; create / edit / delete; mark won, lost or reopen; per-deal detail with stage track and linked activities |
| **Contacts** | People, their job titles, companies and owners |
| **Companies** | Accounts with open pipeline and won-to-date, plus their contacts and deals |
| **Activities** | Calls, emails, meetings, demos and tasks with due dates; open / overdue / today / upcoming / done filters; tick to complete |
| **Reports** | Won revenue by source, why deals are lost, stage reach, owner leaderboard |
| **Settings** | Org name, currency (EUR/USD/GBP/RON), monthly target, sales team, data import/export |

Other bits: global search (`/` to focus), `n` for a new deal, `Esc` to close,
light/dark theme, print-friendly dashboard and reports, and a responsive layout
that collapses the sidebar on narrow screens.

## Where the data lives

Everything is kept in the browser's `localStorage` under `northwind.crm.v1`.
That means:

- Data is **per browser and per device** — it is not shared between people.
- Clearing site data deletes it. Use **Settings → Export backup (JSON)** to keep
  a copy, and **Import backup** to restore it.
- Deals, contacts and companies also export as CSV.

On first run the app seeds a demo data set (10 companies, 12 contacts, 21 deals,
13 activities) so every screen has something in it. **Settings → Delete
everything** clears it; **Reload demo data** puts it back.

## Chart colours

The dashboard and report charts use a palette validated with the data-viz
colour checks rather than picked by eye:

- **One series** (won revenue by month, revenue by source, lost reasons):
  a single blue — `#2a78d6` on light, `#3987e5` on dark. Bar length carries the
  value; colour carries nothing, so it does not vary per bar.
- **Ordered stages** (pipeline by stage, stage reach): a one-hue ordinal ramp,
  light → dark, that follows stage order —
  `#86b6ef #3987e5 #256abf #184f95 #0d366b` on light,
  `#cde2fb #9ec5f4 #6da7ec #3987e5 #184f95` on dark.
  Both ramps pass monotone lightness, adjacent-step separation, and light-end
  contrast against their surface.

Every chart also has a "View as table" disclosure, so no value depends on
reading a colour.

## Customising

Open `index.html` and edit the constants near the top of the `<script>`:

- `STAGES` — pipeline stages and their probabilities (probability drives the
  weighted forecast)
- `SOURCES`, `ACT_TYPES`, `INDUSTRIES` — dropdown vocabularies
- `CURRENCIES` — add a currency with its symbol and locale
- `seedDemo()` — the demo data set

Colour tokens (including the chart palette) are the CSS custom properties in
`:root` and `html[data-theme="dark"]` at the top of the file.
