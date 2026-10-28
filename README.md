# Office Reservations

A lightweight, real-time office desk & parking reservation web app.  
One person runs the server; everyone else connects via browser on the same network.

## Quick start

```bash
pip install flask
python app.py
```

Open **http://\<your-ip\>:5000** from any device on the network.

## Shared drive / network storage

Point `DATA_DIR` at a shared drive so the reservation file lives on a network partition:

```bash
DATA_DIR=/mnt/shared/office-reservations python app.py
# or on Windows
set DATA_DIR=Z:\office-reservations
python app.py
```

The data file (`reservations.json`) is written atomically so concurrent reads are safe.

## How it works

- **Real-time updates** — all connected browsers receive instant updates via Server-Sent Events (SSE) whenever a desk or parking spot changes.  
- **Name is remembered** — your name is saved in the browser's `localStorage`.  
- **Conflict protection** — if two people click at the exact same moment, the second request is rejected with a clear message and the UI updates immediately.

## Customising seats / parking spots

Edit the `DEFAULT_DATA` dictionary at the top of `app.py` to match your floor plan.  
Delete `data/reservations.json` to reset all reservations.

## Contact Resolution Rate

**[`contact-resolution/index.html`](contact-resolution/)** is a standalone local report:
open the file, drop in a raw case-note export (one row per case note, with `Case Number`,
`Created On` and `Description` columns) and it reports

- **% resolved on first contact** against the 80% target
- **of the remainder, % resolved within 2 calendar days** against the 90% target

with a breakdown chart, a review section for every case outside the KPI window (exact
timeframes and the notes behind the verdict), per-case reclassification, a sortable case
table, a CSV export and a one-click presentation (on-screen deck, print to PDF, or a
standalone .html deck). It runs entirely in the browser with **no outbound request of any
kind** — reader, fonts and all are embedded, and a CSP in the file enforces it. See [`contact-resolution/README.md`](contact-resolution/README.md).

The reservations app carries the same logic in its admin **📞 Resolution** tab.

Rules, the phrase lists and the decisions behind them:
[`docs/contact-resolution-metric.md`](docs/contact-resolution-metric.md).

## Sales CRM

This repository also contains a standalone **[Sales CRM](crm/)** — a single HTML
file (`crm/index.html`) with pipeline, deals, contacts, companies, activities and
reports. It has no server and no dependencies: open the file in a browser. See
[`crm/README.md`](crm/README.md).
