/* Upload tool controller. Everything runs in the page: files are read with the
   FileReader/ArrayBuffer APIs, parsed, analysed and rendered locally. No network
   call is made anywhere in this file or the modules it uses. */

const engine = makeEngine(RULES);
const renderer = makeRenderer(RULES, CSS, RUNTIME_JS);

const $ = id => document.getElementById(id);
const state = { files: [] };

const fmtSize = b => b < 1024 ? b + " B"
  : b < 1048576 ? (b / 1024).toFixed(0) + " KB"
    : (b / 1048576).toFixed(1) + " MB";

function renderFileList() {
  const ul = $("fileList");
  ul.innerHTML = state.files.map((f, i) =>
    `<li><span class="nm">${escapeHtml(f.name)}</span>` +
    `<span class="sz">${fmtSize(f.size)}</span>` +
    `<button type="button" data-i="${i}" title="Remove" aria-label="Remove ${escapeHtml(f.name)}">&times;</button></li>`
  ).join("");
  ul.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    state.files.splice(+b.dataset.i, 1);
    renderFileList();
  }));
  $("runBtn").disabled = state.files.length === 0;
  $("fileList").classList.toggle("hidden", state.files.length === 0);
}

const escapeHtml = s => String(s).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" }[c]));

function addFiles(list) {
  const ok = /\.(xlsx|xlsm|xltx|csv|tsv|txt)$/i;
  const rejected = [];
  for (const f of list) {
    if (!ok.test(f.name)) { rejected.push(f.name); continue; }
    if (state.files.some(x => x.name === f.name && x.size === f.size)) continue;
    state.files.push(f);
  }
  renderFileList();
  if (rejected.length) {
    showError("Skipped " + rejected.length + " file(s)",
      "Only .xlsx, .xlsm, .csv and .tsv can be read here: " + rejected.join(", ") +
      ". Legacy .xls must be re-saved as .xlsx. PDF and PPT exports are supported by the " +
      "Python CLI in this repo, not by the browser tool.");
  } else clearError();
}

function showError(title, msg) {
  $("error").innerHTML = `<div class="t">${escapeHtml(title)}</div>${escapeHtml(msg)}`;
  $("error").classList.remove("hidden");
}
const clearError = () => $("error").classList.add("hidden");
const setStatus = s => { $("status").textContent = s; };
const yield_ = () => new Promise(r => setTimeout(r, 0));

async function run() {
  clearError();
  $("runBtn").disabled = true;
  $("reportHost").classList.add("hidden");
  $("downloadBtn").classList.add("hidden");
  try {
    const tables = [];
    for (const f of state.files) {
      setStatus("Reading " + f.name + " …");
      await yield_();
      const parsed = await readFile(f);
      tables.push(...parsed);
    }
    if (!tables.length) throw new Error("No readable sheet was found in the selected file(s).");

    setStatus("Mapping columns and de-duplicating …");
    await yield_();
    const { recs, prov, stats } = engine.buildRecords(tables);
    if (!recs.length) {
      const seen = tables.map(t => (t.rows[0] || []).filter(Boolean).join(", ")).join(" | ");
      throw new Error("No case table was recognised. A sheet needs a Category or Case Origin " +
        "column to be treated as case data. Headers found: " + (seen.slice(0, 400) || "(none)"));
    }

    setStatus("Analysing " + recs.length.toLocaleString("en-US") + " case(s) …");
    await yield_();
    const res = engine.run(recs);

    setStatus("Rendering report …");
    await yield_();
    const meta = { prov, stats, file_count: state.files.length };
    const host = $("reportHost");
    host.innerHTML = renderer.buildBody(res, meta);
    host.classList.remove("hidden");
    window.__reportInit(host);
    // the report body is injected after page load, so the explorer has to be
    // wired up here rather than on DOMContentLoaded
    if (window.__explorerInit) window.__explorerInit(host);

    // full standalone document for download
    state.doc = renderer.buildDocument(res, meta);
    const btn = $("downloadBtn");
    btn.classList.remove("hidden");

    const skipped = prov.filter(p => p.status !== "loaded").length;
    setStatus("Done — " + recs.length.toLocaleString("en-US") + " case(s) analysed from " +
      prov.filter(p => p.status === "loaded").length + " sheet(s)" +
      (skipped ? ", " + skipped + " sheet(s) skipped as non-case tables" : "") +
      (stats.exact_duplicates_removed ? ", " + stats.exact_duplicates_removed +
        " duplicate row(s) removed" : "") + ".");
    host.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    setStatus("");
    showError("Could not build the report", e && e.message ? e.message : String(e));
  } finally {
    $("runBtn").disabled = state.files.length === 0;
  }
}

function download() {
  const blob = new Blob([state.doc], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "panelist-support-report-" + new Date().toISOString().slice(0, 10) + ".html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------ wiring */
const drop = $("drop"), input = $("fileInput");
drop.addEventListener("click", () => input.click());
drop.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
});
input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => {
  e.preventDefault(); drop.classList.add("over");
}));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => {
  e.preventDefault(); drop.classList.remove("over");
}));
drop.addEventListener("drop", e => {
  if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
});
$("runBtn").addEventListener("click", run);
$("downloadBtn").addEventListener("click", download);
$("resetBtn").addEventListener("click", () => {
  state.files = []; state.doc = null;
  renderFileList(); clearError(); setStatus("");
  $("reportHost").classList.add("hidden");
  $("reportHost").innerHTML = "";
  $("downloadBtn").classList.add("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
});
$("toolThemeBtn").addEventListener("click", () => {
  const r = document.documentElement;
  let cur = r.getAttribute("data-theme");
  if (!cur) cur = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const nxt = cur === "dark" ? "light" : "dark";
  r.setAttribute("data-theme", nxt);
  try { localStorage.setItem("panelist-report-theme", nxt); } catch (e) { /* private mode */ }
});
try {
  const s = localStorage.getItem("panelist-report-theme");
  if (s) document.documentElement.setAttribute("data-theme", s);
} catch (e) { /* private mode */ }

if (typeof DecompressionStream === "undefined") {
  showError("This browser cannot read .xlsx files",
    "DecompressionStream is unavailable, so the ZIP inside an .xlsx cannot be opened. " +
    "Use a current Chrome, Edge, Firefox or Safari — or export your data as CSV, which still works here.");
}
renderFileList();
