import json
import os
import threading
import time
import uuid
import io
from datetime import date, datetime, timedelta
from functools import wraps

from flask import (
    Flask,
    Response,
    jsonify,
    render_template,
    request,
    session,
    stream_with_context,
    send_file,
)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "ors-secret-change-me")
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)

ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "IIS12354")

# ---------------------------------------------------------------------------
# Storage configuration
#   DATA_DIR=/mnt/shared/office-reservations  python app.py
# ---------------------------------------------------------------------------
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
DATA_FILE = os.path.join(DATA_DIR, "reservations.json")
os.makedirs(DATA_DIR, exist_ok=True)

SHIFTS = ["day", "evening", "night", "weekend"]
WEEKDAY_SHIFTS = ["day", "evening", "night"]
WEEKEND_SHIFTS = ["weekend"]

SHIFT_HOURS = {
    "day": "09:00-18:00",
    "evening": "16:00-24:00",
    "night": "23:00-07:00",
    "weekend": "19:00-03:00",
}


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)
    return decorated


def _default_state():
    return {
        "config": {
            "desks": 28,
            "parking": 10,
            "targetDays": 2,
            "year": 2026,
            "unavailableDesks": [],
            "unavailableParking": [],
        },
        "employees": [],
        "bookings": {},
        "feedback": [],
    }


def _empty_day():
    return {s: {"desks": {}, "parking": {}} for s in SHIFTS}


file_lock = threading.Lock()

# ---------------------------------------------------------------------------
# SSE broadcast helpers
# ---------------------------------------------------------------------------
_clients = []
_clients_lock = threading.Lock()


def _broadcast(payload):
    msg = "data: " + json.dumps(payload) + "\n\n"
    with _clients_lock:
        for q in _clients:
            q.append(msg)


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------
def load_data():
    if not os.path.exists(DATA_FILE):
        st = _default_state()
        _save_data(st)
        return st
    with open(DATA_FILE, "r") as fh:
        data = json.load(fh)
    # normalize / migrate
    base = _default_state()
    cfg = base["config"]
    cfg.update(data.get("config", {}))
    data["config"] = cfg
    data.setdefault("employees", [])
    data.setdefault("bookings", {})
    data.setdefault("feedback", [])
    return data


def _save_data(data):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, DATA_FILE)


def _ensure_day(data, dt):
    if dt not in data["bookings"]:
        data["bookings"][dt] = _empty_day()
    else:
        # make sure all shifts/kinds exist
        day = data["bookings"][dt]
        for s in SHIFTS:
            day.setdefault(s, {"desks": {}, "parking": {}})
            day[s].setdefault("desks", {})
            day[s].setdefault("parking", {})
    return data["bookings"][dt]


def _gen_id():
    return "e_" + uuid.uuid4().hex[:8]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/state")
def api_state():
    with file_lock:
        return jsonify(load_data())


# ---------------------------------------------------------------------------
# Admin auth
# ---------------------------------------------------------------------------

@app.route("/api/login", methods=["POST"])
def api_login():
    body = request.get_json(silent=True) or {}
    if body.get("username") == ADMIN_USER and body.get("password") == ADMIN_PASS:
        session.permanent = True
        session["is_admin"] = True
        return jsonify({"ok": True, "isAdmin": True})
    return jsonify({"error": "Invalid credentials"}), 401


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me")
def api_me():
    return jsonify({"isAdmin": bool(session.get("is_admin"))})


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------

@app.route("/api/feedback", methods=["GET"])
@admin_required
def api_feedback_list():
    with file_lock:
        data = load_data()
    return jsonify({"feedback": data.get("feedback", [])})


@app.route("/api/feedback", methods=["POST"])
def api_feedback_submit():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "Anonymous").strip()[:80]
    message = (body.get("message") or "").strip()[:1000]
    category = body.get("category", "general")
    if not message:
        return jsonify({"error": "Message required"}), 400
    entry = {
        "id": "fb_" + uuid.uuid4().hex[:8],
        "name": name,
        "message": message,
        "category": category,
        "ts": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "read": False,
    }
    with file_lock:
        data = load_data()
        data["feedback"].append(entry)
        _save_data(data)
    _broadcast({"action": "feedback_count", "count": len(data["feedback"])})
    return jsonify({"ok": True})


@app.route("/api/feedback/delete", methods=["POST"])
@admin_required
def api_feedback_delete():
    fb_id = (request.get_json(silent=True) or {}).get("id")
    with file_lock:
        data = load_data()
        before = len(data["feedback"])
        data["feedback"] = [f for f in data["feedback"] if f["id"] != fb_id]
        if len(data["feedback"]) == before:
            return jsonify({"error": "Not found"}), 404
        _save_data(data)
        count = len(data["feedback"])
    _broadcast({"action": "feedback_count", "count": count})
    return jsonify({"ok": True, "count": count})


@app.route("/api/feedback/read", methods=["POST"])
@admin_required
def api_feedback_read():
    fb_id = (request.get_json(silent=True) or {}).get("id")
    with file_lock:
        data = load_data()
        for f in data["feedback"]:
            if f["id"] == fb_id:
                f["read"] = True
        _save_data(data)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Config / employees
# ---------------------------------------------------------------------------

@app.route("/api/config", methods=["POST"])
def api_config():
    body = request.get_json(silent=True) or {}
    with file_lock:
        data = load_data()
        cfg = data["config"]
        for key in ("desks", "parking", "targetDays", "year"):
            if key in body:
                try:
                    cfg[key] = int(body[key])
                except (TypeError, ValueError):
                    pass
        for key in ("unavailableDesks", "unavailableParking"):
            if key in body:
                vals = body[key]
                if isinstance(vals, str):
                    vals = [v.strip() for v in vals.split(",") if v.strip()]
                cleaned = []
                for v in vals:
                    try:
                        cleaned.append(int(v))
                    except (TypeError, ValueError):
                        pass
                cfg[key] = cleaned
        _save_data(data)
        out_cfg = data["config"]
    _broadcast({"action": "config", "config": out_cfg})
    return jsonify({"ok": True, "config": out_cfg})


def _normalize_shifts(raw, fallback="day"):
    """Accept a list or comma-string of shift names; return a deduplicated list of valid ones."""
    if isinstance(raw, str):
        raw = [s.strip() for s in raw.split(",") if s.strip()]
    if not isinstance(raw, list):
        raw = [fallback]
    valid = [s for s in raw if s in SHIFTS]
    return valid if valid else [fallback]


@app.route("/api/employees/add", methods=["POST"])
@admin_required
def api_emp_add():
    body = request.get_json(silent=True) or {}
    with file_lock:
        data = load_data()
        default_target = data["config"].get("targetDays", 2)
        names = body.get("names")
        # shifts: accept array or single value from body
        raw_shifts = body.get("shifts") or [body.get("shift", "day")]
        shifts = _normalize_shifts(raw_shifts)
        if isinstance(names, list) and names:
            added = []
            for nm in names:
                nm = (nm or "").strip()
                if not nm:
                    continue
                emp = {
                    "id": _gen_id(),
                    "name": nm,
                    "shift": shifts[0],
                    "shifts": shifts,
                    "department": body.get("department", ""),
                    "targetDays": int(body.get("targetDays", default_target)),
                }
                data["employees"].append(emp)
                added.append(emp)
        else:
            emp = {
                "id": _gen_id(),
                "name": (body.get("name") or "New Employee").strip() or "New Employee",
                "shift": shifts[0],
                "shifts": shifts,
                "department": body.get("department", ""),
                "targetDays": int(body.get("targetDays", default_target)),
            }
            data["employees"].append(emp)
        _save_data(data)
        emps = data["employees"]
    _broadcast({"action": "employees", "employees": emps})
    return jsonify({"ok": True, "employees": emps})


@app.route("/api/employees/update", methods=["POST"])
def api_emp_update():
    body = request.get_json(silent=True) or {}
    emp_id = body.get("id")
    with file_lock:
        data = load_data()
        found = None
        for emp in data["employees"]:
            if emp["id"] == emp_id:
                found = emp
                break
        if not found:
            return jsonify({"error": "Employee not found"}), 404
        for key in ("name", "department"):
            if key in body:
                found[key] = body[key]
        if "shifts" in body:
            shifts = _normalize_shifts(body["shifts"])
            found["shifts"] = shifts
            found["shift"] = shifts[0]   # keep primary in sync
        elif "shift" in body and body["shift"] in SHIFTS:
            found["shift"] = body["shift"]
            # if no multi-shift record yet, create one from the single value
            if not found.get("shifts"):
                found["shifts"] = [body["shift"]]
        if "remote" in body:
            found["remote"] = bool(body["remote"])
        if "targetDays" in body:
            try:
                found["targetDays"] = int(body["targetDays"])
            except (TypeError, ValueError):
                pass
        _save_data(data)
        emps = data["employees"]
    _broadcast({"action": "employees", "employees": emps})
    return jsonify({"ok": True, "employees": emps})


@app.route("/api/employees/delete", methods=["POST"])
@admin_required
def api_emp_delete():
    body = request.get_json(silent=True) or {}
    emp_id = body.get("id")
    with file_lock:
        data = load_data()
        before = len(data["employees"])
        data["employees"] = [e for e in data["employees"] if e["id"] != emp_id]
        if len(data["employees"]) == before:
            return jsonify({"error": "Employee not found"}), 404
        _save_data(data)
        emps = data["employees"]
    _broadcast({"action": "employees", "employees": emps})
    return jsonify({"ok": True, "employees": emps})


@app.route("/api/book", methods=["POST"])
def api_book():
    body = request.get_json(silent=True) or {}
    dt = body.get("date")
    shift = body.get("shift")
    kind = body.get("kind")
    slot = str(body.get("slot", ""))
    user_id = body.get("userId")

    if not dt or shift not in SHIFTS or kind not in ("desks", "parking") or not slot:
        return jsonify({"error": "Invalid request"}), 400
    if not user_id:
        return jsonify({"error": "No user selected"}), 400

    with file_lock:
        data = load_data()
        day = _ensure_day(data, dt)
        current = day[shift][kind].get(slot)
        if current and current != user_id:
            return jsonify({"error": "Slot already taken", "by": current}), 409
        # Prevent double-booking same kind in same shift
        already = [k for k, v in day[shift][kind].items() if v == user_id]
        if already and slot not in already:
            label = "desk" if kind == "desks" else "parking spot"
            return jsonify({"error": f"You already have a {label} booked for this shift"}), 409
        day[shift][kind][slot] = user_id
        _save_data(data)
        day_data = data["bookings"][dt]
    _broadcast({"action": "booking", "date": dt, "day": day_data})
    return jsonify({"ok": True, "day": day_data})


@app.route("/api/unbook", methods=["POST"])
def api_unbook():
    body = request.get_json(silent=True) or {}
    dt = body.get("date")
    shift = body.get("shift")
    kind = body.get("kind")
    slot = str(body.get("slot", ""))
    user_id = body.get("userId")

    if not dt or shift not in SHIFTS or kind not in ("desks", "parking") or not slot:
        return jsonify({"error": "Invalid request"}), 400

    with file_lock:
        data = load_data()
        day = _ensure_day(data, dt)
        current = day[shift][kind].get(slot)
        if current is None:
            return jsonify({"ok": True, "day": data["bookings"][dt]})
        if user_id and current != user_id and not session.get("is_admin"):
            return jsonify({"error": "Not your booking", "by": current}), 403
        del day[shift][kind][slot]
        _save_data(data)
        day_data = data["bookings"][dt]
    _broadcast({"action": "booking", "date": dt, "day": day_data})
    return jsonify({"ok": True, "day": day_data})


@app.route("/api/stream")
def api_stream():
    q = []
    with _clients_lock:
        _clients.append(q)

    def generate():
        try:
            yield 'data: {"action":"connected"}\n\n'
            last_ping = time.time()
            while True:
                if q:
                    yield q.pop(0)
                else:
                    time.sleep(0.05)
                    if time.time() - last_ping > 20:
                        last_ping = time.time()
                        yield ": ping\n\n"
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


# ---------------------------------------------------------------------------
# Excel export
# ---------------------------------------------------------------------------
HEADER_FILL = "4f46e5"
ALT_FILL = "f1f4f9"


def _period_range(period, ref):
    try:
        ref_d = datetime.strptime(ref, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        ref_d = date.today()
    if period == "week":
        start = ref_d - timedelta(days=ref_d.weekday())
        end = start + timedelta(days=6)
    elif period == "month":
        start = ref_d.replace(day=1)
        if start.month == 12:
            nxt = start.replace(year=start.year + 1, month=1)
        else:
            nxt = start.replace(month=start.month + 1)
        end = nxt - timedelta(days=1)
    elif period == "quarter":
        q = (ref_d.month - 1) // 3
        start = date(ref_d.year, q * 3 + 1, 1)
        em = q * 3 + 3
        if em == 12:
            end = date(ref_d.year, 12, 31)
        else:
            end = date(ref_d.year, em + 1, 1) - timedelta(days=1)
    else:  # year
        start = date(ref_d.year, 1, 1)
        end = date(ref_d.year, 12, 31)
    return start, end


def _iter_dates(start, end):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def _shifts_for(d):
    return WEEKEND_SHIFTS if d.weekday() >= 5 else WEEKDAY_SHIFTS


@app.route("/api/export/excel")
def api_export_excel():
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    period = request.args.get("period", "week")
    ref = request.args.get("ref", date.today().isoformat())
    start, end = _period_range(period, ref)

    with file_lock:
        data = load_data()

    cfg = data["config"]
    n_desks = cfg.get("desks", 28)
    n_park = cfg.get("parking", 10)
    employees = data["employees"]
    emp_by_id = {e["id"]: e for e in employees}
    bookings = data["bookings"]

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor=HEADER_FILL)
    alt_fill = PatternFill("solid", fgColor=ALT_FILL)
    thin = Side(style="thin", color="e2e8f0")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", vertical="center")

    wb = Workbook()
    wb.remove(wb.active)

    def style_sheet(ws, header_cols, rows, pct_cols=None):
        pct_cols = pct_cols or set()
        ws.append(header_cols)
        for ci, _ in enumerate(header_cols, 1):
            c = ws.cell(row=1, column=ci)
            c.font = header_font
            c.fill = header_fill
            c.alignment = center
            c.border = border
        for ri, row in enumerate(rows, start=2):
            ws.append(row)
            for ci in range(1, len(header_cols) + 1):
                c = ws.cell(row=ri, column=ci)
                c.border = border
                c.alignment = center
                if ri % 2 == 0:
                    c.fill = alt_fill
                if (ci - 1) in pct_cols and isinstance(row[ci - 1], (int, float)):
                    c.number_format = "0.0%"
        # column widths
        for ci, hdr in enumerate(header_cols, 1):
            maxlen = len(str(hdr))
            for row in rows:
                if ci - 1 < len(row):
                    maxlen = max(maxlen, len(str(row[ci - 1])))
            ws.column_dimensions[get_column_letter(ci)].width = min(max(maxlen + 2, 10), 40)

    def day_util(d):
        """Return dict shift -> (desk_frac, park_frac) for a date."""
        dt = d.isoformat()
        day = bookings.get(dt, _empty_day())
        out = {}
        for s in _shifts_for(d):
            sd = day.get(s, {"desks": {}, "parking": {}})
            dfrac = (len(sd.get("desks", {})) / n_desks) if n_desks else 0
            pfrac = (len(sd.get("parking", {})) / n_park) if n_park else 0
            out[s] = (dfrac, pfrac)
        return out

    # ----- Summary stats -----
    total_desk_book = 0
    total_park_book = 0
    desk_slots = 0
    park_slots = 0
    presence = {e["id"]: set() for e in employees}
    for d in _iter_dates(start, end):
        dt = d.isoformat()
        day = bookings.get(dt)
        for s in _shifts_for(d):
            desk_slots += n_desks
            park_slots += n_park
            if not day:
                continue
            sd = day.get(s, {})
            dd = sd.get("desks", {})
            pp = sd.get("parking", {})
            total_desk_book += len(dd)
            total_park_book += len(pp)
            for uid in list(dd.values()) + list(pp.values()):
                if uid in presence:
                    presence[uid].add(dt)

    desk_util = (total_desk_book / desk_slots) if desk_slots else 0
    park_util = (total_park_book / park_slots) if park_slots else 0

    ws = wb.create_sheet("Summary")
    summary_rows = [
        ["Period", period.capitalize()],
        ["Range", f"{start.isoformat()} to {end.isoformat()}"],
        ["Total desks", n_desks],
        ["Total parking", n_park],
        ["Employees", len(employees)],
        ["Desk bookings", total_desk_book],
        ["Parking bookings", total_park_book],
        ["Avg desk utilization", desk_util],
        ["Avg parking utilization", park_util],
    ]
    style_sheet(ws, ["Metric", "Value"], summary_rows, pct_cols=set())
    # format the two util rows as %
    for ri in range(2, len(summary_rows) + 2):
        label = ws.cell(row=ri, column=1).value
        if "utilization" in str(label):
            ws.cell(row=ri, column=2).number_format = "0.0%"

    if period == "week":
        # Daily sheet
        ws_d = wb.create_sheet("Daily")
        rows = []
        for d in _iter_dates(start, end):
            util = day_util(d)
            for s in SHIFTS:
                if s in util:
                    dfrac, pfrac = util[s]
                    rows.append([d.isoformat(), d.strftime("%a"), s,
                                 SHIFT_HOURS[s], dfrac, pfrac])
        style_sheet(ws_d, ["Date", "Day", "Shift", "Hours", "Desk Util", "Parking Util"],
                    rows, pct_cols={4, 5})

        # Presence
        ws_p = wb.create_sheet("Presence")
        days = list(_iter_dates(start, end))
        hdr = ["Employee", "Shift"] + [d.strftime("%a %d") for d in days] + ["Total", "Target", "Met?"]
        rows = []
        for e in employees:
            pres = presence.get(e["id"], set())
            marks = ["X" if d.isoformat() in pres else "" for d in days]
            total = len(pres)
            target = e.get("targetDays", cfg.get("targetDays", 2))
            rows.append([e["name"], e.get("shift", ""), *marks, total, target,
                         "Yes" if total >= target else "No"])
        style_sheet(ws_p, hdr, rows)

    elif period == "month":
        # Weekly Agg
        ws_w = wb.create_sheet("Weekly Agg")
        rows = []
        wk_start = start - timedelta(days=start.weekday())
        wk = wk_start
        widx = 1
        while wk <= end:
            wk_end = wk + timedelta(days=6)
            db, pb, ds, ps = 0, 0, 0, 0
            for d in _iter_dates(max(wk, start), min(wk_end, end)):
                util = day_util(d)
                for s, (df, pf) in util.items():
                    db += df
                    pb += pf
                    ds += 1
                    ps += 1
            rows.append([f"Week {widx}", wk.isoformat(),
                         (db / ds) if ds else 0, (pb / ps) if ps else 0])
            wk += timedelta(days=7)
            widx += 1
        style_sheet(ws_w, ["Week", "Starting", "Avg Desk Util", "Avg Parking Util"],
                    rows, pct_cols={2, 3})

        # Daily
        ws_d = wb.create_sheet("Daily")
        rows = []
        for d in _iter_dates(start, end):
            util = day_util(d)
            db = sum(x[0] for x in util.values())
            pb = sum(x[1] for x in util.values())
            n = len(util) or 1
            rows.append([d.isoformat(), d.strftime("%a"), db / n, pb / n])
        style_sheet(ws_d, ["Date", "Day", "Avg Desk Util", "Avg Parking Util"],
                    rows, pct_cols={2, 3})

        # Presence matrix
        ws_p = wb.create_sheet("Presence")
        days = list(_iter_dates(start, end))
        hdr = ["Employee"] + [d.strftime("%d") for d in days] + ["Total", "Target", "Met?"]
        rows = []
        for e in employees:
            pres = presence.get(e["id"], set())
            marks = ["X" if d.isoformat() in pres else "" for d in days]
            total = len(pres)
            target_days = e.get("targetDays", cfg.get("targetDays", 2))
            weeks = max(1, (end - start).days // 7 + 1)
            target = target_days * weeks
            rows.append([e["name"], *marks, total, target,
                         "Yes" if total >= target else "No"])
        style_sheet(ws_p, hdr, rows)

    else:  # quarter / year
        ws_m = wb.create_sheet("Monthly Agg")
        rows = []
        cur = start.replace(day=1)
        while cur <= end:
            if cur.month == 12:
                nxt = cur.replace(year=cur.year + 1, month=1)
            else:
                nxt = cur.replace(month=cur.month + 1)
            m_end = min(nxt - timedelta(days=1), end)
            db, pb, ds, ps = 0, 0, 0, 0
            for d in _iter_dates(max(cur, start), m_end):
                util = day_util(d)
                for s, (df, pf) in util.items():
                    db += df
                    pb += pf
                    ds += 1
                    ps += 1
            rows.append([cur.strftime("%B %Y"),
                         (db / ds) if ds else 0, (pb / ps) if ps else 0])
            cur = nxt
        style_sheet(ws_m, ["Month", "Avg Desk Util", "Avg Parking Util"],
                    rows, pct_cols={1, 2})

    # ----- Occupancy sheet -----
    ws_occ = wb.create_sheet("Occupancy")
    occ_rows = []
    for d in _iter_dates(start, end):
        dt = d.isoformat()
        day = bookings.get(dt, {})
        all_people: set = set()
        shift_heads = {}
        for s in _shifts_for(d):
            sd = day.get(s, {})
            people = set((sd.get("desks") or {}).values())
            shift_heads[s] = len(people)
            all_people |= people
        unique = len(all_people)
        occ_pct = (unique / n_desks) if n_desks else 0
        row = [
            dt,
            d.strftime("%a"),
            unique,
            occ_pct,
            shift_heads.get("day", 0) if d.weekday() < 5 else "",
            shift_heads.get("evening", 0) if d.weekday() < 5 else "",
            shift_heads.get("night", 0) if d.weekday() < 5 else "",
            shift_heads.get("weekend", 0) if d.weekday() >= 5 else "",
        ]
        occ_rows.append(row)
    style_sheet(
        ws_occ,
        ["Date", "Day", "Unique People", "Occupancy %", "Day shift", "Evening shift", "Night shift", "Weekend shift"],
        occ_rows,
        pct_cols={3},
    )

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    fname = f"office-report-{period}-{start.isoformat()}.xlsx"
    return send_file(
        bio,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=fname,
    )


# ---------------------------------------------------------------------------
# Occupancy report API
# ---------------------------------------------------------------------------

@app.route("/api/report/occupancy")
def api_report_occupancy():
    period = request.args.get("period", "week")
    ref    = request.args.get("ref", date.today().isoformat())
    start, end = _period_range(period, ref)

    with file_lock:
        data = load_data()

    bookings = data["bookings"]
    emp_by_id = {e["id"]: e for e in data["employees"]}

    days_out = []
    for d in _iter_dates(start, end):
        dt = d.isoformat()
        day = bookings.get(dt, {})
        all_people: set = set()
        shifts_data = {}
        for s in _shifts_for(d):
            sd = day.get(s, {})
            people = set((sd.get("desks") or {}).values())
            shifts_data[s] = {
                "headcount": len(people),
                "names": [emp_by_id[uid]["name"] for uid in people if uid in emp_by_id],
            }
            all_people |= people
        days_out.append({
            "date":         dt,
            "weekday":      d.weekday(),
            "shifts":       shifts_data,
            "unique_people": len(all_people),
        })

    total    = sum(r["unique_people"] for r in days_out)
    peak     = max((r["unique_people"] for r in days_out), default=0)
    avg      = round(total / len(days_out), 1) if days_out else 0

    return jsonify({
        "period": period,
        "start":  start.isoformat(),
        "end":    end.isoformat(),
        "days":   days_out,
        "summary": {
            "total_person_days": total,
            "peak_headcount":    peak,
            "avg_headcount":     avg,
            "total_days":        len(days_out),
        },
    })


if __name__ == "__main__":
    print(f"[office-reservations] Data stored at: {DATA_FILE}")
    print("[office-reservations] Access at http://<your-ip>:5000")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
