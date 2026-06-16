import json
import os
import threading
import time
from datetime import date

from flask import Flask, Response, jsonify, render_template, request, stream_with_context

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Storage configuration
# Set DATA_DIR env var to point at a shared network drive/partition, e.g.:
#   DATA_DIR=/mnt/shared/office-reservations  python app.py
# ---------------------------------------------------------------------------
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
DATA_FILE = os.path.join(DATA_DIR, "reservations.json")
os.makedirs(DATA_DIR, exist_ok=True)

DEFAULT_DATA = {
    "desks": {
        str(i): {"id": str(i), "label": f"Desk {i}", "reserved_by": None, "reserved_date": None}
        for i in range(1, 21)
    },
    "parking": {
        str(i): {"id": str(i), "label": f"P{i}", "reserved_by": None, "reserved_date": None}
        for i in range(1, 11)
    },
}

file_lock = threading.Lock()

# ---------------------------------------------------------------------------
# SSE broadcast helpers
# ---------------------------------------------------------------------------
_clients: list[list] = []
_clients_lock = threading.Lock()


def _broadcast(payload: dict) -> None:
    msg = f"data: {json.dumps(payload)}\n\n"
    with _clients_lock:
        for q in _clients:
            q.append(msg)


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------
def load_data() -> dict:
    if not os.path.exists(DATA_FILE):
        _save_data(DEFAULT_DATA)
        return DEFAULT_DATA
    with open(DATA_FILE, "r") as fh:
        return json.load(fh)


def _save_data(data: dict) -> None:
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, DATA_FILE)  # atomic on POSIX


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/data")
def api_data():
    with file_lock:
        return jsonify(load_data())


@app.route("/api/reserve", methods=["POST"])
def api_reserve():
    body = request.get_json(silent=True) or {}
    spot_type = body.get("type")
    spot_id = str(body.get("id", ""))
    name = (body.get("name") or "").strip()

    if spot_type not in ("desks", "parking"):
        return jsonify({"error": "Invalid type"}), 400
    if not name:
        return jsonify({"error": "Name is required"}), 400

    with file_lock:
        data = load_data()
        spot = data[spot_type].get(spot_id)
        if not spot:
            return jsonify({"error": "Spot not found"}), 404
        if spot["reserved_by"]:
            return jsonify({"error": "Already reserved", "spot": spot}), 409
        spot["reserved_by"] = name
        spot["reserved_date"] = date.today().isoformat()
        _save_data(data)

    _broadcast({"action": "update", "type": spot_type, "id": spot_id, "spot": spot})
    return jsonify({"ok": True, "spot": spot})


@app.route("/api/cancel", methods=["POST"])
def api_cancel():
    body = request.get_json(silent=True) or {}
    spot_type = body.get("type")
    spot_id = str(body.get("id", ""))
    name = (body.get("name") or "").strip()

    if spot_type not in ("desks", "parking"):
        return jsonify({"error": "Invalid type"}), 400

    with file_lock:
        data = load_data()
        spot = data[spot_type].get(spot_id)
        if not spot:
            return jsonify({"error": "Spot not found"}), 404
        if spot["reserved_by"] != name:
            return jsonify({"error": "Not your reservation"}), 403
        spot["reserved_by"] = None
        spot["reserved_date"] = None
        _save_data(data)

    _broadcast({"action": "update", "type": spot_type, "id": spot_id, "spot": spot})
    return jsonify({"ok": True, "spot": spot})


@app.route("/api/stream")
def api_stream():
    """Server-Sent Events endpoint — pushes live updates to every connected browser."""
    q: list = []
    with _clients_lock:
        _clients.append(q)

    def generate():
        try:
            yield "data: {\"action\":\"connected\"}\n\n"
            while True:
                if q:
                    yield q.pop(0)
                else:
                    time.sleep(0.05)
        finally:
            with _clients_lock:
                try:
                    _clients.remove(q)
                except ValueError:
                    pass

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    print(f"[office-reservations] Data stored at: {DATA_FILE}")
    print("[office-reservations] Access at http://<your-ip>:5000")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
