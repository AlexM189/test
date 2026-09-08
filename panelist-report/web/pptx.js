/* Minimal PPTX writer - no dependencies.
   A .pptx is a ZIP of OOXML parts. Entries are stored uncompressed (method 0),
   which PowerPoint, Keynote and Google Slides all accept and which avoids needing
   a compressor. Slides are built from shapes and text boxes only, so there is no
   binary media to embed and nothing leaves the browser. */

/* ---------------------------------------------------------------- ZIP */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = s => new TextEncoder().encode(s);

export function zipStore(files) {
  const enc = files.map(f => {
    const name = utf8(f.name);
    const data = typeof f.data === "string" ? utf8(f.data) : f.data;
    return { name, data, crc: crc32(data) };
  });
  let size = 0;
  for (const e of enc) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
  size += 22;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let off = 0;
  const offsets = [];
  for (const e of enc) {
    offsets.push(off);
    dv.setUint32(off, 0x04034b50, true);
    dv.setUint16(off + 4, 20, true);      // version needed
    dv.setUint16(off + 6, 0, true);       // flags
    dv.setUint16(off + 8, 0, true);       // method 0 = stored
    dv.setUint16(off + 10, 0, true);      // time
    dv.setUint16(off + 12, 0x21, true);   // date (1996-01-01, fixed for reproducibility)
    dv.setUint32(off + 14, e.crc, true);
    dv.setUint32(off + 18, e.data.length, true);
    dv.setUint32(off + 22, e.data.length, true);
    dv.setUint16(off + 26, e.name.length, true);
    dv.setUint16(off + 28, 0, true);
    off += 30;
    out.set(e.name, off); off += e.name.length;
    out.set(e.data, off); off += e.data.length;
  }
  const cdStart = off;
  enc.forEach((e, i) => {
    dv.setUint32(off, 0x02014b50, true);
    dv.setUint16(off + 4, 20, true);
    dv.setUint16(off + 6, 20, true);
    dv.setUint16(off + 8, 0, true);
    dv.setUint16(off + 10, 0, true);
    dv.setUint16(off + 12, 0, true);
    dv.setUint16(off + 14, 0x21, true);
    dv.setUint32(off + 16, e.crc, true);
    dv.setUint32(off + 20, e.data.length, true);
    dv.setUint32(off + 24, e.data.length, true);
    dv.setUint16(off + 28, e.name.length, true);
    dv.setUint16(off + 30, 0, true);
    dv.setUint16(off + 32, 0, true);
    dv.setUint16(off + 34, 0, true);
    dv.setUint16(off + 36, 0, true);
    dv.setUint32(off + 38, 0, true);
    dv.setUint32(off + 42, offsets[i], true);
    off += 46;
    out.set(e.name, off); off += e.name.length;
  });
  dv.setUint32(off, 0x06054b50, true);
  dv.setUint16(off + 8, enc.length, true);
  dv.setUint16(off + 10, enc.length, true);
  dv.setUint32(off + 12, off - cdStart, true);
  dv.setUint32(off + 16, cdStart, true);
  dv.setUint16(off + 20, 0, true);
  return out;
}

/* ---------------------------------------------------------------- OOXML */
const X = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const IN = 914400;                       // EMU per inch
const W = Math.round(13.333 * IN), H = Math.round(7.5 * IN);

/* Slide colours as hex, matching the report's light palette. */
const C = { ink: "111110", ink2: "52514E", ink3: "7A7973", rule: "E0E0DA",
            panel: "F1F1EE", surface: "FCFCFB",
            s: ["2A78D6", "EB6834", "1BAF7A", "EDA100", "E87BA4", "008300", "4A3AA7", "E34948"] };

let shapeId = 1;
const nextId = () => ++shapeId;

function txBody(runs, opts) {
  opts = opts || {};
  const anchor = opts.anchor || "t";
  const paras = runs.map(r => {
    const sz = Math.round((r.size || 14) * 100);
    const b = r.bold ? ' b="1"' : "";
    const i = r.italic ? ' i="1"' : "";
    const col = r.color || C.ink;
    const algn = r.align ? ` algn="${r.align}"` : "";
    const bullet = r.bullet
      ? `<a:buFont typeface="Arial" pitchFamily="34" charset="0"/><a:buChar char="•"/>`
      : "<a:buNone/>";
    const indent = r.bullet ? ' marL="180000" indent="-180000"' : "";
    const space = r.spaceBefore ? `<a:spcBef><a:spcPts val="${r.spaceBefore * 100}"/></a:spcBef>` : "";
    return `<a:p><a:pPr${indent}${algn}>${space}${bullet}</a:pPr>` +
      `<a:r><a:rPr lang="en-US" sz="${sz}"${b}${i} dirty="0">` +
      `<a:solidFill><a:srgbClr val="${col}"/></a:solidFill>` +
      `<a:latin typeface="Segoe UI" pitchFamily="34" charset="0"/></a:rPr>` +
      `<a:t>${X(r.text)}</a:t></a:r></a:p>`;
  }).join("");
  return `<p:txBody><a:bodyPr wrap="square" anchor="${anchor}" ` +
    `lIns="0" tIns="0" rIns="0" bIns="0"><a:normAutofit/></a:bodyPr>` +
    `<a:lstStyle/>${paras || "<a:p/>"}</p:txBody>`;
}

function textBox(x, y, w, h, runs, opts) {
  const id = nextId();
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/>` +
    `<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/>` +
    `<a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    txBody(runs, opts) + "</p:sp>";
}

function rect(x, y, w, h, fill, opts) {
  opts = opts || {};
  const id = nextId();
  const line = opts.line
    ? `<a:ln w="12700"><a:solidFill><a:srgbClr val="${opts.line}"/></a:solidFill></a:ln>`
    : "<a:ln><a:noFill/></a:ln>";
  const geom = opts.round ? "roundRect" : "rect";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/>` +
    `<a:ext cx="${Math.max(Math.round(w), 1)}" cy="${Math.max(Math.round(h), 1)}"/></a:xfrm>` +
    `<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>${line}</p:spPr>` +
    txBody(opts.runs || [], { anchor: "ctr" }) + "</p:sp>";
}

function slideXml(shapes) {
  return HDR + `<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">` +
    `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/>` +
    `</p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    shapes.join("") +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

/* ---------------------------------------------------------------- layout helpers */
const M = 0.62 * IN;                         // page margin
const CONTENT_W = W - 2 * M;

function slideChrome(title, kicker) {
  const s = [];
  s.push(rect(0, 0, W, 0.055 * IN, C.s[0]));
  if (kicker) {
    s.push(textBox(M, 0.42 * IN, CONTENT_W, 0.24 * IN,
      [{ text: kicker.toUpperCase(), size: 9.5, bold: true, color: C.ink3 }]));
  }
  s.push(textBox(M, 0.68 * IN, CONTENT_W, 0.52 * IN,
    [{ text: title, size: 26, bold: true, color: C.ink }]));
  return s;
}

function kpiRow(items, y) {
  const s = [];
  const gap = 0.16 * IN;
  const w = (CONTENT_W - gap * (items.length - 1)) / items.length;
  items.forEach((it, i) => {
    const x = M + i * (w + gap);
    s.push(rect(x, y, w, 1.18 * IN, C.panel, { round: true, line: C.rule }));
    s.push(textBox(x + 0.16 * IN, y + 0.15 * IN, w - 0.32 * IN, 0.2 * IN,
      [{ text: it.k.toUpperCase(), size: 8.5, bold: true, color: C.ink3 }]));
    s.push(textBox(x + 0.16 * IN, y + 0.36 * IN, w - 0.32 * IN, 0.42 * IN,
      [{ text: it.v, size: 24, bold: true, color: C.ink }]));
    s.push(textBox(x + 0.16 * IN, y + 0.8 * IN, w - 0.32 * IN, 0.32 * IN,
      [{ text: it.d, size: 9, color: C.ink2 }]));
  });
  return s;
}

function barList(rows, y, opts) {
  opts = opts || {};
  const s = [];
  const labelW = opts.labelW || 3.1 * IN;
  const valueW = 1.35 * IN;
  const trackW = CONTENT_W - labelW - valueW - 0.3 * IN;
  const rowH = opts.rowH || 0.36 * IN;
  const gap = 0.1 * IN;
  const mx = Math.max(...rows.map(r => r.value), 1);
  rows.forEach((r, i) => {
    const ry = y + i * (rowH + gap);
    s.push(textBox(M, ry + 0.05 * IN, labelW - 0.14 * IN, rowH,
      [{ text: r.label, size: 11, color: C.ink2, align: "r" }]));
    const bw = Math.max(trackW * r.value / mx, 0.04 * IN);
    s.push(rect(M + labelW, ry, bw, rowH, opts.color || C.s[i % C.s.length], { round: true }));
    s.push(textBox(M + labelW + bw + 0.12 * IN, ry + 0.06 * IN, valueW, rowH,
      [{ text: r.note || String(r.value), size: 11, bold: true, color: C.ink }]));
  });
  return s;
}

function bulletBlock(lines, y, size) {
  return [textBox(M, y, CONTENT_W, H - y - 0.6 * IN,
    lines.map(l => ({ text: l.text, size: size || 12.5, bold: !!l.bold,
                      color: l.color || C.ink2, bullet: l.bullet !== false,
                      spaceBefore: 6 })))];
}

function footer(text) {
  return textBox(M, H - 0.5 * IN, CONTENT_W, 0.26 * IN,
    [{ text, size: 8.5, color: C.ink3 }]);
}

/* ---------------------------------------------------------------- package */
function pkg(slides) {
  const n = slides.length;
  const files = [];
  const overrides = slides.map((_, i) =>
    `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  files.push({ name: "[Content_Types].xml", data: HDR +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    overrides + "</Types>" });

  files.push({ name: "_rels/.rels", data: HDR +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    "</Relationships>" });

  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  files.push({ name: "docProps/core.xml", data: HDR +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    "<dc:title>Panelist Support Executive Report</dc:title>" +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
    "</cp:coreProperties>" });
  files.push({ name: "docProps/app.xml", data: HDR +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    `<Slides>${n}</Slides><Application>Panelist Report Builder</Application></Properties>` });

  const sldIds = slides.map((_, i) =>
    `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("");
  files.push({ name: "ppt/presentation.xml", data: HDR +
    `<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" saveSubsetFonts="1">` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    `<p:sldIdLst>${sldIds}</p:sldIdLst>` +
    `<p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` });

  const presRels = slides.map((_, i) =>
    `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("");
  files.push({ name: "ppt/_rels/presentation.xml.rels", data: HDR +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
    presRels +
    `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>` +
    "</Relationships>" });

  const emptyTree = '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/>' +
    '<p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>';
  const bg = '<p:bg><p:bgPr><a:solidFill><a:schemeClr val="lt1"/></a:solidFill>' +
    '<a:effectLst/></p:bgPr></p:bg>';
  const masterTree = '<p:cSld>' + bg + '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/>' +
    '<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
    '<a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>' +
    '</p:grpSpPr></p:spTree></p:cSld>';
  const lvl = i => `<a:lvl${i}pPr marL="${(i - 1) * 342900}" algn="l" rtl="0">` +
    '<a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>' +
    '<a:latin typeface="+mn-lt"/></a:defRPr></a:lvl' + i + 'pPr';
  const lvls = [1, 2, 3, 4, 5].map(i => lvl(i) + ">").join("").replace(/pPr>>/g, "pPr>");
  const txStyles = '<p:txStyles><p:titleStyle><a:lvl1pPr algn="l" rtl="0">' +
    '<a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>' +
    '<a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>' +
    '<p:bodyStyle>' + lvls + '</p:bodyStyle>' +
    '<p:otherStyle><a:lvl1pPr algn="l" rtl="0"><a:defRPr sz="1800" kern="1200">' +
    '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/>' +
    '</a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles>';
  const clrMap = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" ' +
    'accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" ' +
    'accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
  files.push({ name: "ppt/slideMasters/slideMaster1.xml", data: HDR +
    `<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">` +
    masterTree + clrMap +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
    txStyles + "</p:sldMaster>" });
  files.push({ name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: HDR +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>' +
    "</Relationships>" });
  files.push({ name: "ppt/slideLayouts/slideLayout1.xml", data: HDR +
    `<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1">` +
    emptyTree + '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>' });
  files.push({ name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: HDR +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>' +
    "</Relationships>" });

  const dk = (a, b) => `<a:${a}><a:srgbClr val="${b}"/></a:${a}>`;
  files.push({ name: "ppt/theme/theme1.xml", data: HDR +
    `<a:theme xmlns:a="${NS_A}" name="Panelist"><a:themeElements><a:clrScheme name="Panelist">` +
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
    '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    dk("dk2", "111110") + dk("lt2", "F1F1EE") +
    dk("accent1", C.s[0]) + dk("accent2", C.s[1]) + dk("accent3", C.s[2]) +
    dk("accent4", C.s[3]) + dk("accent5", C.s[4]) + dk("accent6", C.s[5]) +
    dk("hlink", "2A78D6") + dk("folHlink", "4A3AA7") + "</a:clrScheme>" +
    '<a:fontScheme name="Panelist"><a:majorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/>' +
    '<a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/>' +
    '<a:cs typeface=""/></a:minorFont></a:fontScheme>' +
    '<a:fmtScheme name="Panelist"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/>' +
    '</a:solidFill></a:fillStyleLst><a:lnStyleLst>' +
    '<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
    '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
    '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>' +
    '</a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/>' +
    '</a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>' });

  slides.forEach((sh, i) => {
    files.push({ name: `ppt/slides/slide${i + 1}.xml`, data: slideXml(sh) });
    files.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: HDR +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
      "</Relationships>" });
  });
  return zipStore(files);
}

/* ---------------------------------------------------------------- deck */
export function buildDeck(res, meta) {
  shapeId = 1;
  const V = res.volume, C2 = res.correlation, F = res.forecast;
  const th = n => Number(n).toLocaleString("en-US");
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const slides = [];
  const period = V.date_min ? `${V.date_min} to ${V.date_max}` : "no usable date field";

  /* 1 - title */
  slides.push([
    rect(0, 0, W, H, C.surface),
    rect(0, 0, W, 0.16 * IN, C.s[0]),
    textBox(M, 2.2 * IN, CONTENT_W, 0.3 * IN,
      [{ text: "EXECUTIVE REPORT · PANELIST SUPPORT OPERATIONS", size: 11, bold: true, color: C.s[0] }]),
    textBox(M, 2.6 * IN, CONTENT_W, 1.5 * IN,
      [{ text: "Case Volume, Correlations & Four-Quarter Outlook", size: 40, bold: true, color: C.ink }]),
    textBox(M, 4.3 * IN, CONTENT_W, 0.9 * IN, [
      { text: `${th(V.total_cases)} cases · ${period}`, size: 15, color: C.ink2 },
      { text: `${meta.file_count} source file(s) · generated ${new Date().toISOString().slice(0, 10)}`,
        size: 12, color: C.ink3, spaceBefore: 6 }]),
    footer("Every figure computed from the supplied export. Panels the data cannot support are stated as such."),
  ]);

  /* 2 - executive summary */
  const tiles = [{ k: "Total cases", v: th(V.total_cases), d: "after de-duplication" }];
  if (V.unique_members) tiles.push({ k: "Unique members", v: th(V.unique_members),
    d: (V.total_cases / V.unique_members).toFixed(2) + " cases per member" });
  if (V.bucket.rows.length) tiles.push({ k: "Top driver", v: f1(V.bucket.rows[0].pct) + "%",
    d: V.bucket.rows[0].label });
  if (V.origin.computable && V.origin.rows.length) tiles.push({ k: "Top origin",
    v: f1(V.origin.rows[0].pct) + "%", d: V.origin.rows[0].label });
  tiles.push({ k: "Topics per case", v: V.tag_load.mean_tags_per_case.toFixed(2),
    d: f1(V.tag_load.multi_tag_pct) + "% carry 2+" });
  const findings = (res.__findings || []).slice(0, 3);
  slides.push([
    ...slideChrome("Executive summary", "At a glance"),
    ...kpiRow(tiles.slice(0, 5), 1.45 * IN),
    textBox(M, 2.95 * IN, CONTENT_W, 0.3 * IN,
      [{ text: "Top findings", size: 15, bold: true, color: C.ink }]),
    ...bulletBlock(findings.map(f => ({ text: f })), 3.35 * IN, 12.5),
    footer(V.date_field_is_proxy
      ? "Time-based figures use Modified On (last touch), not case creation."
      : "Time-based figures use the case creation date."),
  ]);

  /* 3 - top call drivers */
  const DR = res.drivers || [];
  if (DR.length) {
    const rolled = DR.find(d => d.rolled_detail);
    slides.push([
      ...slideChrome("Top call drivers", "Section 1"),
      ...barList(DR.map(d => ({ label: `${d.rank}. ${d.label}`, value: d.count,
                                note: `${th(d.count)} · ${f1(d.pct)}%` })), 1.5 * IN),
      textBox(M, 4.6 * IN, CONTENT_W, 1.4 * IN, rolled ? [
        { text: `${rolled.label} rolls up ${rolled.rolled_detail.length} smaller drivers.`,
          size: 11.5, bold: true, color: C.ink },
        { text: rolled.rolled_detail.slice(0, 6)
            .map(x => `${x.label} (${th(x.count)})`).join("  ·  "),
          size: 11, color: C.ink2, spaceBefore: 4 }] : []),
      footer("One driver per case: the first label in the Category field, mapped to the category knowledge base."),
    ]);
  }

  /* 4 - monthly movement */
  const mv = (res.movement || {}).monthly;
  if (mv && mv.computable) {
    const s = [...slideChrome("Monthly movement", "Section 1")];
    const chartY = 1.5 * IN, chartH = 2.5 * IN;
    const mx = Math.max(...mv.totals, 1);
    const slot = CONTENT_W / mv.totals.length;
    const bw = Math.min(slot * 0.62, 0.42 * IN);
    mv.totals.forEach((v, i) => {
      const bh = Math.max(chartH * v / mx, 2);
      const x = M + slot * (i + 0.5) - bw / 2;
      s.push(rect(x, chartY + chartH - bh, bw, bh, C.s[0], { round: true }));
      if (i % Math.ceil(mv.totals.length / 8) === 0 || i === mv.totals.length - 1) {
        s.push(textBox(x - slot * 0.3, chartY + chartH + 0.06 * IN, slot * 1.2, 0.22 * IN,
          [{ text: mv.keys[i], size: 8.5, color: C.ink3, align: "ctr" }]));
      }
    });
    s.push(...bulletBlock(mv.insights.slice(0, 5).map(x => ({ text: x.text })), 4.5 * IN, 11.5));
    s.push(footer("Complete calendar months only; a partial month at either end is excluded."));
    slides.push(s);
  }

  /* 5 - data quality */
  const Q = res.quality;
  if (Q && Q.kb_size) {
    slides.push([
      ...slideChrome("Data quality", "Section 1"),
      ...kpiRow([
        { k: "Mapped from KB", v: f1(res.inference.pct_from_kb) + "%",
          d: th(res.inference.from_kb) + " cases matched a real category" },
        { k: "Placeholder primary", v: f1(Q.primary_junk_pct) + "%",
          d: th(Q.primary_junk_cases) + " cases with a number or N/A" },
        { k: "Unknown to KB", v: f1(Q.primary_unknown_pct) + "%",
          d: th(Q.primary_unknown_cases) + " cases the KB does not list" },
        { k: "Distinct problems", v: th(Q.junk_distinct + Q.unknown_distinct),
          d: "placeholder + unknown labels" }], 1.5 * IN),
      ...bulletBlock([
        { text: "Values that are not categories at all:", bold: true, color: C.ink, bullet: false },
        ...(Q.junk_labels || []).slice(0, 5)
          .map(j => ({ text: `${j.label} — ${th(j.count)} cases` })),
        ...((Q.unknown_labels || []).length
          ? [{ text: "Labels the knowledge base does not list:", bold: true, color: C.ink,
               bullet: false },
             ...Q.unknown_labels.slice(0, 3).map(u => ({ text: `${u.label} — ${th(u.count)} cases` }))]
          : []),
      ], 3.1 * IN, 12),
      footer("These inflate Other / Unmapped. The fix is upstream, in the case form's picklist."),
    ]);
  }

  /* 6 - deep dives: the biggest real families that the vocabulary actually reaches.
     "Other / Unmapped" is a data-quality problem, covered on its own slide above. */
  const deckDives = (res.deep_dives || [])
    .filter(d => d.title !== "Other / Unmapped" && (d.facets || [])
      .some(f => f.rows.length && f.coverage_pct >= 10))
    .slice(0, 3);
  for (const dd of deckDives) {
    if (!dd.facets || !dd.facets.length) continue;
    const s = [...slideChrome(dd.title, "Section 2 · deep dive")];
    s.push(...kpiRow([
      { k: "Cases", v: th(dd.cases), d: f1(dd.pct_of_total) + "% of all cases" },
      { k: "With free text", v: f1(dd.pct_with_free_text) + "%", d: "basis for the facets below" },
      ...(dd.repeat && dd.repeat.computable
        ? [{ k: "Repeat contact", v: f1(dd.repeat.pct_cases_from_repeat) + "%",
             d: "from members with 2+ cases here" }] : []),
    ], 1.45 * IN));
    let y = 2.95 * IN;
    for (const f of dd.facets.slice(0, 2)) {
      if (!f.rows.length) continue;
      s.push(textBox(M, y, CONTENT_W, 0.26 * IN,
        [{ text: `${f.name} — ${f1(f.coverage_pct)}% of cases matched`, size: 12.5,
           bold: true, color: C.ink }]));
      s.push(...barList(f.rows.slice(0, 4).map(r => ({ label: r.label, value: r.count,
        note: `${th(r.count)} · ${f1(r.pct)}%` })), y + 0.32 * IN,
        { rowH: 0.28 * IN, labelW: 2.9 * IN, color: C.s[0] }));
      y += 0.32 * IN + 4 * (0.28 * IN + 0.1 * IN) + 0.22 * IN;
    }
    s.push(footer("Facets are a fixed vocabulary matched against subject and description; no case text is reproduced."));
    slides.push(s);
  }

  /* 7 - forecast */
  if (F && F.computable) {
    slides.push([
      ...slideChrome("Four-quarter outlook", "Section 4"),
      textBox(M, 1.4 * IN, CONTENT_W, 0.5 * IN, [{
        text: `OLS trend fitted to ${F.months_fitted} months (slope ${F.slope_cases_per_month >= 0 ? "+" : ""}${F.slope_cases_per_month} cases/month). Interval is ±1.96 residual SD.`,
        size: 12, color: C.ink2 }]),
      ...barList(F.quarters.map(q => ({ label: q.label, value: q.point,
        note: `${th(q.point)}  (${th(q.low)}–${th(q.high)})` })), 2.1 * IN,
        { color: C.s[0], labelW: 1.8 * IN }),
      footer(F.caveat || ""),
    ]);
  } else if (F) {
    slides.push([
      ...slideChrome("Four-quarter outlook", "Section 4"),
      ...bulletBlock([{ text: "No forecast is produced.", bold: true, color: C.ink, bullet: false },
        { text: F.reason || "", bullet: false }], 1.6 * IN, 13),
      footer("No directional estimate is shown either: a shaped curve without evidence is worse than none."),
    ]);
  }

  /* 8 - recommendations */
  const recs = res.__recs || [];
  if (recs.length) {
    slides.push([
      ...slideChrome("Recommendations", "Section 6"),
      ...bulletBlock(recs.slice(0, 6).flatMap(r => [
        { text: `${r.title}`, bold: true, color: C.ink },
        { text: `${r.horizon} · ${r.owner}`, color: C.ink3, bullet: false },
      ]), 1.5 * IN, 12.5),
      footer("Each recommendation ties to a finding in the full HTML report."),
    ]);
  }

  return pkg(slides);
}
