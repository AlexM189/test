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
