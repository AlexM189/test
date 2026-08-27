#!/usr/bin/env python3
"""Prove the browser engine and the Python engine still agree.

    python3 tools/crossvalidate.py sample/sample_cases.csv [more.csv ...]

Runs both implementations over the same CSV and compares 20 headline metrics -
volume, mix, cross-tab totals, every correlation chain, repeat contact, the
discovered pairs and the full four-quarter forecast. Exits non-zero on any
difference, so it can gate a commit. Requires node.
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def numbers(html):
    body = re.sub(r"<[^>]+>", " ", html)
    return re.findall(r"-?\d+\.?\d*%?", re.sub(r"\s+", " ", body))


def render_diff(path):
    """Diff every number in the two rendered documents, not just the metrics.
    Formatting divergence - a different rounding mode, a different number of
    decimals - only shows up here."""
    js = subprocess.run(["node", os.path.join(HERE, "renderdiff.mjs"), path],
                        capture_output=True, text=True)
    if js.returncode:
        return ["renderer failed: " + js.stderr.strip()[:400]]
    sys.path.insert(0, ROOT)
    import ingest, analyze, render
    df, prov = ingest.load_paths([path])
    df, stats = ingest.clean(df)
    res = analyze.run(df)
    doc = render.build(res, {"prov": prov, "stats": stats, "file_count": 1})
    m = re.search(r"<body>(.*)</body>", doc, re.S)     # skip the stylesheet
    py = m.group(1) if m else doc
    py = re.sub(r"<script[^>]*>.*?</script>", " ", py, flags=re.S)
    js_body = re.sub(r"<script[^>]*>.*?</script>", " ", js.stdout, flags=re.S)
    a, b = numbers(js_body), numbers(py)
    if a == b:
        return []
    out = ["rendered documents differ: %d numbers vs %d" % (len(a), len(b))]
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            out.append("  first difference at position %d: js=%s py=%s" % (i, x, y))
            break
    return out


def main(paths):
    if not paths:
        paths = [os.path.join(ROOT, "sample", "sample_cases.csv")]
    failed = 0
    for p in paths:
        try:
            js = json.loads(subprocess.run(
                ["node", os.path.join(HERE, "crossvalidate.mjs"), p],
                capture_output=True, text=True, check=True).stdout)
        except FileNotFoundError:
            sys.exit("node is required to cross-validate the browser engine.")
        except subprocess.CalledProcessError as e:
            sys.exit("JS engine failed on %s:\n%s" % (p, e.stderr[:2000]))
        py = json.loads(subprocess.run(
            [sys.executable, os.path.join(HERE, "_xval_py.py"), p],
            capture_output=True, text=True, check=True).stdout)
        diff = [k for k in js if js[k] != py.get(k)]
        name = os.path.basename(p)
        if diff:
            failed += 1
            print("FAIL %s - %d metric(s) differ" % (name, len(diff)))
            for k in diff:
                print("   %-16s js=%s" % (k, json.dumps(js[k])[:160]))
                print("   %-16s py=%s" % ("", json.dumps(py.get(k))[:160]))
            continue
        rd = render_diff(p)
        if rd:
            failed += 1
            print("FAIL %s - metrics agree but the rendered output does not" % name)
            for line in rd:
                print("   " + line)
        else:
            print("OK   %s - %d metrics and every rendered number identical" % (name, len(js)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
