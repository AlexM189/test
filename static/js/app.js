/* ── State ───────────────────────────────────────────────────── */
let state   = { desks: {}, parking: {} };
let myName  = () => document.getElementById("user-name").value.trim();
let pending = null; // { type, id, action }

/* ── Boot ────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("today-label").textContent =
    new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const saved = localStorage.getItem("office_name");
  if (saved) document.getElementById("user-name").value = saved;
  document.getElementById("user-name").addEventListener("input", () => {
    localStorage.setItem("office_name", document.getElementById("user-name").value);
    renderAll();
  });

  setupTabs();
  setupModal();
  fetchData().then(connectSSE);
});

/* ── Tabs ────────────────────────────────────────────────────── */
function setupTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));

      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      document.getElementById("panel-" + btn.dataset.tab).classList.remove("hidden");
    });
  });
}

/* ── Data fetch ──────────────────────────────────────────────── */
async function fetchData() {
  try {
    const res = await fetch("/api/data");
    state = await res.json();
    renderAll();
  } catch (e) {
    showToast("Could not load data", "error");
  }
}

/* ── SSE live updates ────────────────────────────────────────── */
function connectSSE() {
  const dot   = document.getElementById("status-dot");
  const badge = document.getElementById("live-badge");
  const es    = new EventSource("/api/stream");

  es.onopen = () => {
    dot.className   = "status-dot connected";
    dot.ariaLabel   = "Connected";
    badge.textContent = "Live";
    badge.classList.add("live");
  };

  es.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.action === "update") {
      state[msg.type][msg.id] = msg.spot;
      renderSpot(msg.type, msg.spot);
    }
  };

  es.onerror = () => {
    dot.className     = "status-dot disconnected";
    dot.ariaLabel     = "Disconnected";
    badge.textContent = "Reconnecting…";
    badge.classList.remove("live");
    // EventSource reconnects automatically
  };
}

/* ── Render ──────────────────────────────────────────────────── */
function renderAll() {
  renderGrid("desks");
  renderGrid("parking");
}

function renderGrid(type) {
  const grid = document.getElementById("grid-" + type);
  grid.innerHTML = "";
  const icon = type === "desks" ? "🪑" : "🚗";
  Object.values(state[type])
    .sort((a, b) => +a.id - +b.id)
    .forEach(spot => grid.appendChild(buildCard(type, spot, icon)));
}

function buildCard(type, spot, icon) {
  const name = myName();
  const isMine  = spot.reserved_by && spot.reserved_by === name;
  const isTaken = spot.reserved_by && !isMine;
  const cls     = isMine ? "mine" : isTaken ? "taken" : "free";

  const card = document.createElement("div");
  card.className = `spot ${cls}`;
  card.id        = `spot-${type}-${spot.id}`;
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", isTaken ? "-1" : "0");
  card.setAttribute("aria-label",
    isMine  ? `${spot.label} — reserved by you. Click to cancel.` :
    isTaken ? `${spot.label} — reserved by ${spot.reserved_by}` :
              `${spot.label} — free. Click to reserve.`
  );
  card.innerHTML = `
    <span class="spot-icon" aria-hidden="true">${icon}</span>
    <span class="spot-label">${spot.label}</span>
    <span class="spot-name">${
      isMine  ? "You"              :
      isTaken ? spot.reserved_by  :
                "Available"
    }</span>
  `;

  if (!isTaken) {
    const handler = () => openModal(type, spot.id);
    card.addEventListener("click", handler);
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); } });
  }
  return card;
}

function renderSpot(type, spot) {
  const existing = document.getElementById(`spot-${type}-${spot.id}`);
  if (!existing) return;
  const icon = type === "desks" ? "🪑" : "🚗";
  existing.replaceWith(buildCard(type, spot, icon));
}

/* ── Modal ───────────────────────────────────────────────────── */
function setupModal() {
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-cancel-btn").addEventListener("click", closeModal);
  document.getElementById("modal-overlay").addEventListener("click", e => {
    if (e.target.id === "modal-overlay") closeModal();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
  document.getElementById("modal-confirm").addEventListener("click", confirmAction);
}

function openModal(type, id) {
  const name = myName();
  if (!name) { showToast("Please enter your name first", "error"); document.getElementById("user-name").focus(); return; }

  const spot   = state[type][id];
  const isMine = spot.reserved_by === name;
  const label  = spot.label;
  const section = type === "desks" ? "Desk" : "Parking spot";

  pending = { type, id, action: isMine ? "cancel" : "reserve" };

  const title  = document.getElementById("modal-title");
  const body   = document.getElementById("modal-body");
  const btn    = document.getElementById("modal-confirm");

  if (isMine) {
    title.textContent  = `Cancel reservation`;
    body.textContent   = `Are you sure you want to free up ${label}?`;
    btn.className      = "btn btn-danger";
    btn.textContent    = "Free up spot";
  } else {
    title.textContent  = `Reserve ${label}`;
    body.textContent   = `Reserve ${section.toLowerCase()} "${label}" for ${name} today?`;
    btn.className      = "btn btn-primary";
    btn.textContent    = "Reserve";
  }

  document.getElementById("modal-overlay").classList.remove("hidden");
  document.getElementById("modal-confirm").focus();
}

function closeModal() {
  pending = null;
  document.getElementById("modal-overlay").classList.add("hidden");
}

async function confirmAction() {
  if (!pending) return;
  closeModal();

  const { type, id, action } = pending;
  const endpoint = action === "reserve" ? "/api/reserve" : "/api/cancel";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, id, name: myName() }),
    });
    const data = await res.json();

    if (!res.ok) {
      // If someone grabbed it just before us, re-render to show it
      if (res.status === 409) {
        state[type][id] = data.spot;
        renderSpot(type, data.spot);
        showToast("Someone just reserved that spot!", "error");
      } else {
        showToast(data.error || "Something went wrong", "error");
      }
      return;
    }

    showToast(
      action === "reserve"
        ? `${data.spot.label} reserved!`
        : `${data.spot.label} is now free`,
      "success"
    );
  } catch {
    showToast("Network error", "error");
  }
}

/* ── Toast ───────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg, type = "") {
  const toast = document.getElementById("toast");
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className   = `toast show${type ? " " + type : ""}`;
  toastTimer = setTimeout(() => { toast.classList.remove("show"); }, 3000);
}
