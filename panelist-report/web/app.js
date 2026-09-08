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
  const has = state.files.length > 0;
  $("runBtn").disabled = !has;
  $("fileList").classList.toggle("hidden", !has);
  setStep(1, has ? "done" : "active");
  if (!state.doc) setStep(2, has ? "active" : "todo");
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
function setStatus(s, kind) {
  const el = $("status");
  el.textContent = s;
  el.className = "status" + (kind ? " " + kind : "");
}

/* The three steps show where you are: what is done, what is next, what is not
   reachable yet. Without it a long build looks like nothing happened. */
function setStep(n, state) {
  const el = $("step" + n);
  if (el) el.dataset.state = state;
}
const yield_ = () => new Promise(r => setTimeout(r, 0));

async function run() {
  clearError();
  $("runBtn").disabled = true;
  $("reportHost").classList.add("hidden");
  $("downloadBtn").classList.add("hidden");
  try {
    const tables = [];
    for (const f of state.files) {
      setStatus("Reading " + f.name + " …", "busy");
      await yield_();
      const parsed = await readFile(f);
      tables.push(...parsed);
    }
    if (!tables.length) throw new Error("No readable sheet was found in the selected file(s).");

    setStatus("Mapping columns and de-duplicating …", "busy");
    await yield_();
    const { recs, prov, stats } = engine.buildRecords(tables);
    if (!recs.length) {
      const seen = tables.map(t => (t.rows[0] || []).filter(Boolean).join(", ")).join(" | ");
      throw new Error("No case table was recognised. A sheet needs a Category or Case Origin " +
        "column to be treated as case data. Headers found: " + (seen.slice(0, 400) || "(none)"));
    }

    setStatus("Analysing " + recs.length.toLocaleString("en-US") + " case(s) …", "busy");
    await yield_();
    const res = engine.run(recs);

    setStatus("Rendering report …", "busy");
    await yield_();
    const meta = { prov, stats, file_count: state.files.length };
    const host = $("reportHost");
    host.innerHTML = renderer.buildBody(res, meta);
    host.classList.remove("hidden");
    window.__reportInit(host);
    // the report body is injected after page load, so the explorer has to be
    // wired up here rather than on DOMContentLoaded
    if (window.__explorerInit) window.__explorerInit(host);
    if (window.__chromeInit) window.__chromeInit(host);

    // full standalone document for download
    state.doc = renderer.buildDocument(res, meta);
    // the deck reuses the report's own findings and recommendations verbatim
    state.res = Object.assign({}, res, {
      __findings: renderer.buildFindings(res.volume, res.correlation).map(f => f[0]),
      __recs: renderer.buildRecs(res.volume, res.correlation),
    });
    state.meta = meta;
    $("downloadBtn").classList.remove("hidden");
    $("pptBtn").classList.remove("hidden");
    const xb = $("xlsxBtn");
    xb.classList.remove("hidden");
    xb.querySelector(".n").textContent = res.fit.not_fitted
      ? res.fit.not_fitted.toLocaleString("en-US") + " not fitted"
      : "all fitted";

    const skipped = prov.filter(p => p.status !== "loaded").length;
    setStatus(recs.length.toLocaleString("en-US") + " case(s) analysed from " +
      prov.filter(p => p.status === "loaded").length + " sheet(s)" +
      (skipped ? ", " + skipped + " sheet(s) skipped as non-case tables" : "") +
      (stats.exact_duplicates_removed ? ", " + stats.exact_duplicates_removed +
        " duplicate row(s) removed" : "") + ".", "done");
    setStep(2, "done");
    setStep(3, "active");
    host.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    setStatus("");
    setStep(2, "active");
    showError("Could not build the report", e && e.message ? e.message : String(e));
  } finally {
    $("runBtn").disabled = state.files.length === 0;
  }
}

function downloadPpt() {
  try {
    setStatus("Building the deck …", "busy");
    const bytes = buildDeck(state.res, state.meta);
    saveBlob(bytes,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "panelist-support-deck-" + new Date().toISOString().slice(0, 10) + ".pptx");
    setStatus("Deck downloaded — " + (bytes.length / 1024).toFixed(0) + " KB.", "done");
  } catch (e) {
    showError("Could not build the deck", e && e.message ? e.message : String(e));
  }
}

async function downloadFit() {
  try {
    setStatus("Building the category fit …", "busy");
    await yield_();
    const fit = state.res.fit;
    const sheets = engine.fitSheets(fit, {
      files: state.files.map(f => f.name).join(", "),
      generated: new Date().toISOString().slice(0, 10),
    });
    const bytes = await buildWorkbook(sheets);
    saveBlob(bytes,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "category-fit-" + new Date().toISOString().slice(0, 10) + ".xlsx");
    setStatus(fit.fitted.toLocaleString("en-US") + " case(s) fitted to a category, " +
      fit.not_fitted.toLocaleString("en-US") + " not fitted.", "done");
  } catch (e) {
    showError("Could not build the category fit", e && e.message ? e.message : String(e));
  }
}

function saveBlob(data, type, filename) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function download() {
  saveBlob(state.doc, "text/html;charset=utf-8",
    "panelist-support-report-" + new Date().toISOString().slice(0, 10) + ".html");
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
$("pptBtn").addEventListener("click", downloadPpt);
$("xlsxBtn").addEventListener("click", downloadFit);
$("resetBtn").addEventListener("click", () => {
  state.files = []; state.doc = null; state.res = null;
  renderFileList(); clearError(); setStatus("");
  $("reportHost").classList.add("hidden");
  $("reportHost").innerHTML = "";
  $("downloadBtn").classList.add("hidden");
  $("pptBtn").classList.add("hidden");
  $("xlsxBtn").classList.add("hidden");
  setStep(1, "active"); setStep(2, "todo"); setStep(3, "todo");
  const t = document.querySelector(".totop");
  if (t) t.remove();
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
