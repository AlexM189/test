#!/usr/bin/env python3
"""Structural validation for a generated .pptx.

LibreOffice is not always available to render-test a deck, and python-pptx is
lenient, so this checks the things that actually break PowerPoint: the
relationship graph, content-type coverage, and XML well-formedness of every part.
"""
import sys, zipfile, posixpath
import xml.etree.ElementTree as ET

CT = "{http://schemas.openxmlformats.org/package/2006/content-types}"
RS = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def main(path):
    z = zipfile.ZipFile(path)
    names = set(z.namelist())
    errors, warnings = [], []

    if z.namelist()[0] != "[Content_Types].xml":
        errors.append("[Content_Types].xml must be the first entry in the package")

    # 1. every part is well-formed XML
    for n in names:
        if n.endswith((".xml", ".rels")):
            try:
                ET.fromstring(z.read(n))
            except Exception as e:
                errors.append("malformed XML in %s: %s" % (n, e))

    # 2. content types cover every part
    ct = ET.fromstring(z.read("[Content_Types].xml"))
    defaults = {d.get("Extension").lower() for d in ct.findall(CT + "Default")}
    overrides = {o.get("PartName").lstrip("/") for o in ct.findall(CT + "Override")}
    for n in names:
        if n == "[Content_Types].xml":
            continue
        ext = n.rsplit(".", 1)[-1].lower()
        if n not in overrides and ext not in defaults:
            errors.append("no content type declared for %s" % n)
    for o in overrides:
        if o not in names:
            errors.append("content type override for missing part /%s" % o)

    # 3. every relationship target exists, and every r:id used resolves
    rels_by_source = {}
    for n in names:
        if not n.endswith(".rels"):
            continue
        base = posixpath.dirname(posixpath.dirname(n))
        root = ET.fromstring(z.read(n))
        ids = {}
        for r in root.findall(RS + "Relationship"):
            rid, tgt = r.get("Id"), r.get("Target")
            if (r.get("TargetMode") or "") == "External":
                continue
            resolved = posixpath.normpath(posixpath.join(base, tgt)).lstrip("/")
            ids[rid] = resolved
            if resolved not in names:
                errors.append("%s -> %s (%s) does not exist" % (n, rid, resolved))
        src = posixpath.join(base, posixpath.basename(n)[:-5]).lstrip("/")
        rels_by_source[src] = ids

    for src, ids in rels_by_source.items():
        if src not in names:
            continue
        body = z.read(src).decode("utf-8", "replace")
        import re
        for rid in set(re.findall(r'r:(?:id|embed|link)="([^"]+)"', body)):
            if rid not in ids:
                errors.append("%s uses %s but its .rels does not define it" % (src, rid))

    # 4. the parts PowerPoint requires
    for req in ("ppt/presentation.xml", "_rels/.rels", "ppt/_rels/presentation.xml.rels"):
        if req not in names:
            errors.append("missing required part %s" % req)
    masters = [n for n in names if n.startswith("ppt/slideMasters/slideMaster")
               and n.endswith(".xml")]
    layouts = [n for n in names if n.startswith("ppt/slideLayouts/slideLayout")
               and n.endswith(".xml")]
    slides = [n for n in names if n.startswith("ppt/slides/slide") and n.endswith(".xml")]
    themes = [n for n in names if n.startswith("ppt/theme/")]
    if not masters:
        errors.append("no slide master")
    if not layouts:
        errors.append("no slide layout")
    if not themes:
        errors.append("no theme")
    if not slides:
        errors.append("no slides")
    for m in masters:
        x = z.read(m).decode()
        for need in ("p:txStyles", "p:clrMap", "p:sldLayoutIdLst"):
            if need not in x:
                warnings.append("%s has no <%s> - PowerPoint may reject it" % (m, need))
    for s in slides:
        r = "ppt/slides/_rels/%s.rels" % posixpath.basename(s)
        if r not in names:
            errors.append("%s has no .rels (needs a slideLayout relationship)" % s)

    print("package : %s" % path)
    print("parts   : %d (%d slides, %d layouts, %d masters)"
          % (len(names), len(slides), len(layouts), len(masters)))
    for w in warnings:
        print("  WARN  %s" % w)
    for e in errors:
        print("  ERROR %s" % e)
    if not errors:
        print("RESULT  : structurally valid%s" % (" (with warnings)" if warnings else ""))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
