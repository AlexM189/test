#!/usr/bin/env python3
"""Bundle the browser tool into one self-contained HTML file.

    python3 build.py            ->  out/panelist-report-builder.html

Inlines rules.json, the shared report CSS and runtime JS, and the four ES
modules. No external requests remain in the output, so the file works offline
and can be emailed as-is.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
OUT = os.path.join(HERE, "out", "panelist-report-builder.html")


def read(*parts):
    path = os.path.join(*parts)
    with open(path, "rb") as f:
        raw = f.read()
    # a stray control byte in a source file silently breaks text matching and
    # can corrupt the bundle - refuse to build rather than ship it
    bad = [i for i, b in enumerate(raw) if b < 9 or 13 < b < 32]
    if bad:
        sys.exit("Build failed: %s contains %d control byte(s), first at offset %d."
                 % (os.path.basename(path), len(bad), bad[0]))
    return raw.decode("utf-8")


def strip_module(src):
    """Turn an ES module into plain top-level code for a single module scope."""
    src = re.sub(r"^\s*import\s.*?;\s*$", "", src, flags=re.M)
    src = re.sub(r"^export\s+(?=(function|const|let|var|class)\b)", "", src, flags=re.M)
    src = re.sub(r"^export\s*\{[^}]*\};?\s*$", "", src, flags=re.M)
    return src


def js_string(s):
    """Embed arbitrary text as a JS string literal, safe inside <script>."""
    return json.dumps(s).replace("</", "<\\/").replace("<!--", "<\\!--")


def main():
    rules = read(HERE, "rules.json")
    report_css = read(WEB, "report.css")
    tool_css = read(WEB, "tool.css")
    runtime_js = read(WEB, "report-runtime.js")

    bundle = "\n".join([
        "/* --- shared configuration (rules.json) --- */",
        "const RULES = JSON.parse(" + js_string(rules) + ");",
        "const CSS = " + js_string(report_css) + ";",
        "const RUNTIME_JS = " + js_string(runtime_js) + ";",
        "",
        "/* --- report runtime (theme toggle, tooltips) --- */",
        runtime_js,
        "",
        "/* --- web/parse.js --- */",   strip_module(read(WEB, "parse.js")),
        "/* --- web/analyze.js --- */", strip_module(read(WEB, "analyze.js")),
        "/* --- web/render.js --- */",  strip_module(read(WEB, "render.js")),
        "/* --- web/app.js --- */",     strip_module(read(WEB, "app.js")),
    ])

    html = read(WEB, "shell.html")
    html = html.replace("/*[[REPORT_CSS]]*/", report_css)
    html = html.replace("/*[[TOOL_CSS]]*/", tool_css)
    html = html.replace("/*[[BUNDLE]]*/", bundle)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)

    # the whole point is self-containment - fail loudly if anything reaches out
    external = re.findall(r'(?:src|href)\s*=\s*["\'](https?:|//)', html)
    fetches = re.findall(r"\b(?:fetch|XMLHttpRequest|WebSocket|importScripts)\s*\(", html)
    if external or fetches:
        sys.exit("Build failed: output is not self-contained (%d external refs, %d network calls)."
                 % (len(external), len(fetches)))
    print("Wrote %s (%.1f KB) - no external references, no network calls."
          % (OUT, os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
