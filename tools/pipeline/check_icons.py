#!/usr/bin/env python3
"""OPTIONAL network check: HEAD-request every icon name used in the generated data against the render CDN
(falling back to the second CDN) and print the missing ones. Not used by the build or tests; do not commit its output.

Usage: python3 tools/pipeline/check_icons.py [data/generated/<build>] [--limit N]
"""
import glob
import json
import os
import sys
import urllib.error
import urllib.request

PRIMARY = "https://render.worldofwarcraft.com/us/icons/56/{icon}.jpg"
FALLBACK = "https://wow.zamimg.com/images/wow/icons/large/{icon}.jpg"


def head(url):
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "icon-check"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError):
        return False


def collect(d):
    icons = set()

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "icon" and isinstance(v, str):
                    icons.add(v)
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    for p in glob.glob(os.path.join(d, "**", "*.json"), recursive=True):
        if os.path.basename(p) in ("manifest.json", "report.json"):
            continue
        with open(p, encoding="utf-8") as f:
            walk(json.load(f))
    return sorted(icons)


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    limit = None
    if "--limit" in argv:
        limit = int(argv[argv.index("--limit") + 1])
        args = [a for a in args if a != str(limit)]
    d = args[0] if args else os.path.join("data", "generated", "1.60.1.70888")
    icons = collect(d)
    if limit:
        icons = icons[:limit]
    missing = []
    for i, ic in enumerate(icons):
        if not head(PRIMARY.format(icon=ic)) and not head(FALLBACK.format(icon=ic)):
            missing.append(ic)
        if i % 200 == 0:
            print("checked %d/%d" % (i, len(icons)), file=sys.stderr)
    print("%d icons, %d missing on both CDNs" % (len(icons), len(missing)))
    for m in missing:
        print(m)


if __name__ == "__main__":
    main(sys.argv[1:])
