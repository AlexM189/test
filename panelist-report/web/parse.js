/* Zero-dependency readers for .xlsx / .xlsm / .csv / .tsv.
   XLSX is a ZIP of XML: the central directory is walked by hand and DEFLATE
   entries are inflated with the platform DecompressionStream, so nothing is
   fetched and no parsing library is bundled. */

const td = new TextDecoder();

/* ---------------------------------------------------------------- ZIP */
function u16(d, o) { return d.getUint16(o, true); }
function u32(d, o) { return d.getUint32(o, true); }

function findEOCD(d) {
  const max = Math.min(d.byteLength, 66000);
  for (let i = d.byteLength - 22; i >= d.byteLength - max && i >= 0; i--) {
    if (u32(d, i) === 0x06054b50) return i;
  }
  return -1;
}

function zipEntries(buf) {
  const d = new DataView(buf);
  const eocd = findEOCD(d);
  if (eocd < 0) throw new Error("Not a valid .xlsx file (no ZIP directory found).");
  let count = u16(d, eocd + 10);
  let cdOff = u32(d, eocd + 16);
  // ZIP64 - large workbooks
  if (count === 0xffff || cdOff === 0xffffffff) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (u32(d, i) === 0x07064b50) {
        const z64 = Number(new DataView(buf).getBigUint64(i + 8, true));
        if (u32(d, z64) === 0x06064b50) {
          count = Number(d.getBigUint64(z64 + 32, true));
          cdOff = Number(d.getBigUint64(z64 + 48, true));
        }
        break;
      }
    }
  }
  const out = new Map();
  let p = cdOff;
  for (let i = 0; i < count && p + 46 <= d.byteLength; i++) {
    if (u32(d, p) !== 0x02014b50) break;
    const method = u16(d, p + 10);
    const csize = u32(d, p + 20);
    const nameLen = u16(d, p + 28), extraLen = u16(d, p + 30), cmtLen = u16(d, p + 32);
    let lho = u32(d, p + 42);
    const name = td.decode(new Uint8Array(buf, p + 46, nameLen));
    out.set(name, { method, csize, lho });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

async function readEntry(buf, e) {
  const d = new DataView(buf);
  if (u32(d, e.lho) !== 0x04034b50) throw new Error("Corrupt ZIP entry header.");
  const nameLen = u16(d, e.lho + 26), extraLen = u16(d, e.lho + 28);
  const start = e.lho + 30 + nameLen + extraLen;
  const raw = new Uint8Array(buf, start, e.csize);
  if (e.method === 0) return td.decode(raw);
  if (e.method !== 8) throw new Error("Unsupported ZIP compression method " + e.method + ".");
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress .xlsx (DecompressionStream unavailable). " +
                    "Use a current Chrome, Edge, Firefox or Safari, or upload CSV instead.");
  }
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([raw]).stream().pipeThrough(ds);
  return td.decode(await new Response(stream).arrayBuffer());
}

/* ---------------------------------------------------------------- XML bits */
const attr = (tag, name) => {
  const m = new RegExp("(?:^|\\s)" + name.replace(":", "\\:") + '="([^"]*)"').exec(tag);
  return m ? m[1] : null;
};

const unesc = s => s.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g,
  (m, dec, hex, nm) => dec ? String.fromCodePoint(+dec)
    : hex ? String.fromCodePoint(parseInt(hex, 16))
      : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[nm]);

function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  // each <si> may hold several <t> runs; concatenate them in order
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const body = m[1] || "";
    let s = "";
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
    let t;
    while ((t = tRe.exec(body))) s += unesc(t[1] || "");
    out.push(s);
  }
  return out;
}

/* Which style indices format their number as a date? */
function dateStyles(xml) {
  const isDateFmt = c => /[dmyhs]/i.test(c.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, ""))
                      && /[dmy]/i.test(c.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, ""));
  const custom = new Map();
  if (xml) {
    const re = /<numFmt\b([^>]*)\/?>/g;
    let m; while ((m = re.exec(xml))) {
      const id = attr(m[1], "numFmtId"), code = attr(m[1], "formatCode");
      if (id !== null && code !== null) custom.set(+id, unesc(code));
    }
  }
  const builtin = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
  const set = new Set();
  if (!xml) return set;
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!cellXfs) return set;
  const xfRe = /<xf\b([^>]*?)\/?>/g;
  let m, i = 0;
  while ((m = xfRe.exec(cellXfs[1]))) {
    const id = +(attr(m[1], "numFmtId") ?? -1);
    if (builtin.has(id) || (custom.has(id) && isDateFmt(custom.get(id)))) set.add(i);
    i++;
  }
  return set;
}

const colIndex = ref => {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
};

function serialToISO(v, d1904) {
  const base = d1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  let days = Math.floor(v), frac = v - days;
  if (!d1904 && days > 59) days -= 0;           // Excel's phantom 1900-02-29 is already in the epoch
  const ms = base + days * 86400000 + Math.round(frac * 86400000);
  const dt = new Date(ms);
  if (isNaN(dt)) return String(v);
  const p = n => String(n).padStart(2, "0");
  return dt.getUTCFullYear() + "-" + p(dt.getUTCMonth() + 1) + "-" + p(dt.getUTCDate()) +
    (frac ? " " + p(dt.getUTCHours()) + ":" + p(dt.getUTCMinutes()) + ":" + p(dt.getUTCSeconds()) : "");
}

function sheetRows(xml, sst, dstyles, d1904) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let r;
  while ((r = rowRe.exec(xml))) {
    const body = r[1] || "";
    const cells = [];
    const cRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c;
    while ((c = cRe.exec(body))) {
      const attrs = c[1] || "", inner = c[2] || "";
      const rawRef = attr(attrs, "r");
      const ref = rawRef ? /^([A-Z]+)/.exec(rawRef) : null;
      const idx = ref ? colIndex(ref[1]) : cells.length;
      const type = attr(attrs, "t") || "n";
      const style = +(attr(attrs, "s") ?? -1);
      let val = "";
      if (type === "inlineStr") {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g; let t;
        while ((t = tRe.exec(inner))) val += unesc(t[1]);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (v) {
          const raw = unesc(v[1]);
          if (type === "s") val = sst[+raw] ?? "";
          else if (type === "b") val = raw === "1" ? "TRUE" : "FALSE";
          else if (type === "e") val = "";
          else if (dstyles.has(style) && raw !== "" && !isNaN(+raw)) val = serialToISO(+raw, d1904);
          else val = raw;
        }
      }
      while (cells.length < idx) cells.push("");
      cells[idx] = val;
    }
    rows.push(cells);
  }
  return rows;
}

export async function readXlsx(buf) {
  const zip = zipEntries(buf);
  const get = async n => (zip.has(n) ? await readEntry(buf, zip.get(n)) : "");
  const wb = await get("xl/workbook.xml");
  if (!wb) throw new Error("No workbook found inside the file - is it really an .xlsx?");
  const d1904 = /date1904="(1|true)"/i.test(wb);
  const sst = sharedStrings(await get("xl/sharedStrings.xml"));
  const dstyles = dateStyles(await get("xl/styles.xml"));

  const rels = await get("xl/_rels/workbook.xml.rels");
  // attribute order is not guaranteed by the format, so never rely on it
  const relMap = new Map();
  let m; const relRe = /<Relationship\b([^>]*)>/g;
  while ((m = relRe.exec(rels))) {
    const id = attr(m[1], "Id"), tgt = attr(m[1], "Target");
    if (id && tgt) relMap.set(id, tgt.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }

  const sheets = [];
  const shRe = /<sheet\b([^>]*?)\/?>/g;
  while ((m = shRe.exec(wb))) {
    const rid = attr(m[1], "r:id") || attr(m[1], "id");
    const nm = attr(m[1], "name");
    if (rid) sheets.push({ name: nm ? unesc(nm) : rid, target: relMap.get(rid) });
  }
  if (!sheets.length) {
    for (const k of zip.keys()) if (/^xl\/worksheets\/sheet\d+\.xml$/.test(k))
      sheets.push({ name: k, target: k.replace(/^xl\//, "") });
  }
  const out = [];
  for (const s of sheets) {
    if (!s.target) continue;
    const path = s.target.startsWith("xl/") ? s.target : "xl/" + s.target;
    if (!zip.has(path)) continue;
    const rows = sheetRows(await readEntry(buf, zip.get(path)), sst, dstyles, d1904);
    if (rows.length) out.push({ sheet: s.name, rows });
  }
  return out;
}

/* ---------------------------------------------------------------- CSV */
export function readDelimited(text) {
  text = text.replace(/^﻿/, "");
  const head = text.slice(0, 20000);
  const counts = [[",", 0], ["\t", 0], [";", 0], ["|", 0]].map(([d]) =>
    [d, (head.match(new RegExp("\\" + d, "g")) || []).length]);
  counts.sort((a, b) => b[1] - a[1]);
  const delim = counts[0][1] ? counts[0][0] : ",";
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}

export async function readFile(file) {
  const name = file.name, ext = (name.split(".").pop() || "").toLowerCase();
  if (["xlsx", "xlsm", "xltx"].includes(ext)) {
    return (await readXlsx(await file.arrayBuffer())).map(s => ({ file: name, sheet: s.sheet, rows: s.rows }));
  }
  if (["csv", "tsv", "txt"].includes(ext)) {
    return [{ file: name, sheet: "", rows: readDelimited(await file.text()) }];
  }
  if (ext === "xls") throw new Error("Legacy .xls is not supported - re-save as .xlsx or export CSV.");
  throw new Error("Unsupported file type ." + ext + " - use .xlsx, .xlsm, .csv or .tsv.");
}
