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

## Contact Resolution Rate (📞 Resolution tab)

Upload a raw case-note export (one row per case note, with `Case Number`,
`Created On` and `Description` columns) and the tab reports:

- **% resolved at first contact** against the 80% target
- **of the remainder, % resolved within 2 calendar days** against the 90% target

plus a per-case table with the phrase that decided each classification, an expandable
note timeline, and a CSV export. The file is parsed in the browser with SheetJS —
nothing is uploaded to the server or stored.

Rules, the phrase lists and the decisions behind them:
[`docs/contact-resolution-metric.md`](docs/contact-resolution-metric.md).

## Sales CRM

This repository also contains a standalone **[Sales CRM](crm/)** — a single HTML
file (`crm/index.html`) with pipeline, deals, contacts, companies, activities and
reports. It has no server and no dependencies: open the file in a browser. See
[`crm/README.md`](crm/README.md).
