"""Minimal XLSX writer - stdlib only, and a byte-for-byte match in intent for the
browser writer in web/xlsx.js.

An .xlsx is a ZIP of OOXML parts. Strings are written inline rather than through a
shared-strings table: it costs a few bytes and removes a whole class of index bugs,
and these sheets are a cleanup queue, not a data warehouse."""
import zipfile

ESC = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}


def _x(s):
    out = "".join(ESC.get(c, c) for c in str(s))
    # Excel rejects most control characters outright; drop them rather than
    # producing a workbook that will not open
    return "".join(c for c in out if c >= " " or c in "\t\n")


def _col(i):
    """0 -> A, 25 -> Z, 26 -> AA."""
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _cell(ref, v, style):
    st = ' s="%d"' % style if style else ""
    if v is None or v == "":
        return '<c r="%s"%s/>' % (ref, st)
    if _is_num(v):
        return '<c r="%s"%s><v>%s</v></c>' % (ref, st, v)
    return ('<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>'
            % (ref, st, _x(v)))


def _sheet(spec):
    header, rows, widths = spec["header"], spec["rows"], spec.get("widths") or []
    parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">']
    parts.append('<sheetViews><sheetView workbookViewId="0">'
                 '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
                 '</sheetView></sheetViews>')
    if widths:
        parts.append("<cols>" + "".join(
            '<col min="%d" max="%d" width="%d" customWidth="1"/>' % (i + 1, i + 1, wdt)
            for i, wdt in enumerate(widths)) + "</cols>")
    parts.append("<sheetData>")
    parts.append('<row r="1">' + "".join(
        _cell(_col(i) + "1", h, 1) for i, h in enumerate(header)) + "</row>")
    for n, r in enumerate(rows, start=2):
        parts.append('<row r="%d">' % n + "".join(
            _cell(_col(i) + str(n), v, 0) for i, v in enumerate(r)) + "</row>")
    parts.append("</sheetData>")
    if spec.get("filter") and (header or rows):
        parts.append('<autoFilter ref="A1:%s%d"/>' % (_col(len(header) - 1), len(rows) + 1))
    parts.append("</worksheet>")
    return "".join(parts)


STYLES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    '<fonts count="2">'
    '<font><sz val="11"/><name val="Calibri"/></font>'
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
    '</fonts>'
    '<fills count="3">'
    '<fill><patternFill patternType="none"/></fill>'
    '<fill><patternFill patternType="gray125"/></fill>'
    '<fill><patternFill patternType="solid"><fgColor rgb="FF2F6FB5"/>'
    '<bgColor indexed="64"/></patternFill></fill>'
    '</fills>'
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    '<cellXfs count="2">'
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
    '</cellXfs>'
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    "</styleSheet>")


def write(path, sheets):
    """sheets: [{name, header, rows, widths, filter}] -> an .xlsx at path."""
    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.'
          'relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-'
          'officedocument.spreadsheetml.sheet.main+xml"/>'
          + "".join('<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/'
                    'vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % (i + 1)
                    for i in range(len(sheets)))
          + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-'
            'officedocument.spreadsheetml.styles+xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
            'relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
          "<sheets>" + "".join(
              '<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (_x(s["name"]), i + 1, i + 1)
              for i, s in enumerate(sheets)) + "</sheets></workbook>")
    wbrels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
              'relationships">' + "".join(
                  '<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/'
                  'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>'
                  % (i + 1, i + 1) for i in range(len(sheets)))
              + '<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/'
                '2006/relationships/styles" Target="styles.xml"/></Relationships>'
              % (len(sheets) + 1))
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", wbrels)
        z.writestr("xl/styles.xml", STYLES)
        for i, sp in enumerate(sheets):
            z.writestr("xl/worksheets/sheet%d.xml" % (i + 1), _sheet(sp))
    return path
