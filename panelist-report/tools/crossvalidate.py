#!/usr/bin/env python3
"""Prove the browser engine and the Python engine still agree.

    python3 tools/crossvalidate.py sample/sample_cases.csv [more.csv ...]

Runs both implementations over the same CSV and compares 20 headline metrics -
volume, mix, cross-tab totals, every correlation chain, repeat contact, the
discovered pairs and the full four-quarter forecast. Exits non-zero on any
difference, so it can gate a commit. Requires node.
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


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
        else:
            print("OK   %s - all %d metrics identical" % (name, len(js)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
