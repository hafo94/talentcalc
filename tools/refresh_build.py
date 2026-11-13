#!/usr/bin/env python3
"""Data refresh for a new WoW Forever build (Phase 7, docs/DATA_SOURCES.md "Refreshing the data").

  python3 tools/refresh_build.py                       # latest wowf build: fetch, build, compare, test (report only)
  python3 tools/refresh_build.py --build 1.60.1.70938 --date 2026-11-13 --report /tmp/refresh.md
  python3 tools/refresh_build.py --build X --skip-fetch --switch   # point the app at build X (then run npm test/e2e)

Steps: 1. latest build from wago.tools /api/builds (product wowf), 2. tools/research/fetch_db2.sh into data/raw/<build>,
3. tools/pipeline/build_data.py into data/generated/<build>, 4. a diff summary against the app's current build
(manifest counts, talents, spell values, weapons, targets, manual-data validation), 5. the pipeline tests against the
new build (TALENTCALC_BUILD). Nothing in the app changes unless --switch is given. Exit code 0 = no blocking problem
(pipeline built, no manual-data mismatches), 1 = review needed, 2 = error.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BUILDS_URL = "https://wago.tools/api/builds"
PRODUCT = "wowf"
# Files that name the app's data build (--switch rewrites the first match of each pattern).
SWITCH = [
    ("vite.config.ts", r'(const DATA_BUILD = ")([0-9.]+)(")'),
    ("tsconfig.app.json", r'("@data/\*": \["data/generated/)([0-9.]+)(/\*"\])'),
    ("e2e/helpers.ts", r'(const DATA_DIR = "data/generated/)([0-9.]+)(")'),
    ("tools/pipeline/constants.py", r'(?m)^(BUILD_DEFAULT = ")([0-9.]+)(")'),
    ("tools/pipeline/tests/_fixtures.py", r'(os.environ.get\("TALENTCALC_BUILD", ")([0-9.]+)("\))'),
    ("tools/research/fetch_db2.sh", r'(BUILD="\$\{1:-)([0-9.]+)(\}")'),
    ("tools/pipeline/check_icons.py", r'(os.path.join\("data", "generated", ")([0-9.]+)("\))'),
]


def log(msg):
    print(msg, flush=True)


def current_build():
    with open(os.path.join(ROOT, "vite.config.ts"), encoding="utf-8") as f:
        m = re.search(SWITCH[0][1], f.read())
    if not m:
        raise SystemExit("DATA_BUILD not found in vite.config.ts")
    return m.group(2)


def latest_build():
    """Newest wowf version on wago.tools (the API lists the newest first)."""
    req = urllib.request.Request(BUILDS_URL, headers={"User-Agent": "talentcalc-refresh/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        builds = json.load(r).get(PRODUCT) or []
    if not builds:
        raise SystemExit("no %s builds in %s" % (PRODUCT, BUILDS_URL))
    return builds[0]["version"]


def load(d, rel):
    p = os.path.join(d, rel)
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def file_hashes(d, build):
    """Relative path -> hash of the file with its build string and generation date blanked (real changes only)."""
    out = {}
    for base, _, files in os.walk(d):
        for fn in files:
            p = os.path.join(base, fn)
            with open(p, encoding="utf-8") as f:
                text = f.read().replace(build, "<build>")
            text = re.sub(r'"generatedAt": "[0-9-]+"', '"generatedAt": ""', text)
            out[os.path.relpath(p, d)] = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return out


def talent_index(d):
    """(class, node id) -> (name, max rank, tier, col, rank values) of every talent."""
    out = {}
    for fn in sorted(os.listdir(os.path.join(d, "talents"))):
        f = load(d, os.path.join("talents", fn))
        for spec in f["specs"]:
            for t in spec["talents"]:
                out[(f["token"], t["nodeId"])] = (
                    t["name"], t["maxRank"], t["tier"], t["col"], [r["values"] for r in t["ranks"]])
    return out


def spell_index(d):
    """Spell id -> (name, rank, effect values) over spells/<class>.json and pets/<owner>.json."""
    out = {}
    for sub in ("spells", "pets"):
        p = os.path.join(d, sub)
        if not os.path.isdir(p):
            continue
        for fn in sorted(os.listdir(p)):
            for s in load(d, os.path.join(sub, fn))["spells"]:
                eff = [(e["effect"], e.get("aura", 0), e["base"], e.get("perLevel", 0), e.get("spCoef", 0)) for e in s["effects"]]
                out[s["id"]] = (s["name"], s.get("rank"), eff, s.get("castMs"), s.get("cooldownMs"))
    return out


def diff_summary(old_dir, new_dir, limit=25):
    """Markdown lines describing what changed between two generated builds."""
    lines = []
    om, nm = load(old_dir, "manifest.json"), load(new_dir, "manifest.json")
    lines.append("## Counts (manifest)")
    for k in sorted(set(om["counts"]) | set(nm["counts"])):
        a, b = om["counts"].get(k), nm["counts"].get(k)
        lines.append("- %s: %s -> %s%s" % (k, a, b, "" if a == b else "  **changed**"))
    oh, nh = file_hashes(old_dir, om["build"]), file_hashes(new_dir, nm["build"])
    same = sorted(k for k in oh if nh.get(k) == oh[k])
    changed = sorted(k for k in oh if k in nh and nh[k] != oh[k])
    lines.append("## Files (build string and date ignored): %d identical, %d changed, %d new, %d removed" % (
        len(same), len(changed), len(set(nh) - set(oh)), len(set(oh) - set(nh))))
    lines += ["- changed: %s" % k for k in changed]
    lines += ["- new: %s" % k for k in sorted(set(nh) - set(oh))]
    lines += ["- removed: %s" % k for k in sorted(set(oh) - set(nh))]
    ot, nt = talent_index(old_dir), talent_index(new_dir)
    lines.append("## Talents: %d added, %d removed, %d changed" % (
        len(set(nt) - set(ot)), len(set(ot) - set(nt)), sum(1 for k in ot if k in nt and ot[k] != nt[k])))
    for k in sorted(set(nt) - set(ot))[:limit]:
        lines.append("- added %s %s %s" % (k[0], k[1], nt[k][0]))
    for k in sorted(set(ot) - set(nt))[:limit]:
        lines.append("- removed %s %s %s" % (k[0], k[1], ot[k][0]))
    for k in [k for k in sorted(ot) if k in nt and ot[k] != nt[k]][:limit]:
        lines.append("- changed %s %s %s: %s -> %s" % (k[0], k[1], ot[k][0], ot[k][1:], nt[k][1:]))
    os_, ns = spell_index(old_dir), spell_index(new_dir)
    changed_spells = [k for k in sorted(os_) if k in ns and os_[k] != ns[k]]
    lines.append("## Spells (class and pet files): %d added, %d removed, %d changed" % (
        len(set(ns) - set(os_)), len(set(os_) - set(ns)), len(changed_spells)))
    for k in changed_spells[:limit]:
        lines.append("- changed %s %s (rank %s)" % (k, ns[k][0], ns[k][1]))
    ow, nw = load(old_dir, "weapons.json"), load(new_dir, "weapons.json")
    wo = {w["id"]: w for w in ow["weapons"]}
    wn = {w["id"]: w for w in nw["weapons"]}
    wchg = [i for i in wo if i in wn and wo[i] != wn[i]]
    lines.append("## Weapons: %d added, %d removed, %d changed" % (len(set(wn) - set(wo)), len(set(wo) - set(wn)), len(wchg)))
    ott, ntt = load(old_dir, "targets.json"), load(new_dir, "targets.json")
    lines.append("## Targets: %s" % ("unchanged" if ott["byPlayerLevel"] == ntt["byPlayerLevel"] else "**changed**"))
    rep = load(new_dir, "report.json")
    mv = rep.get("manualValidation", [])
    lines.append("## Manual data checks (data/manual vs the new SpellEffect / SpellLevels / ItemSparse): %d problem(s)" % len(mv))
    lines += ["- %s %s: %s" % (m["file"], m["id"], m["problem"]) for m in mv]
    lines.append("## Pipeline warnings: %d" % len(rep.get("warnings", [])))
    lines += ["- %s" % w for w in rep.get("warnings", [])[:limit]]
    return lines, len(mv)


def switch_app(build):
    for rel, pat in SWITCH:
        p = os.path.join(ROOT, rel)
        with open(p, encoding="utf-8") as f:
            s = f.read()
        s2, n = re.subn(pat, lambda m: m.group(1) + build + m.group(3), s, count=1)
        if n != 1:
            raise SystemExit("--switch: pattern not found in %s" % rel)
        with open(p, "w", encoding="utf-8") as f:
            f.write(s2)
        log("switched %s -> %s" % (rel, build))


def run(cmd, env=None):
    log("$ " + " ".join(cmd))
    return subprocess.run(cmd, cwd=ROOT, env=env).returncode


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--build", help="wowf build version (default: the latest on wago.tools)")
    ap.add_argument("--date", default=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"),
                    help="manifest generatedAt (pass it explicitly for reproducible output)")
    ap.add_argument("--skip-fetch", action="store_true", help="use data/raw/<build> as it is")
    ap.add_argument("--no-tests", action="store_true", help="skip the pipeline tests")
    ap.add_argument("--force", action="store_true", help="rebuild even when the build is the app's current one")
    ap.add_argument("--switch", action="store_true", help="point the app (vite, tsconfig, tests, tools) at the build")
    ap.add_argument("--report", help="also write the summary to this Markdown file")
    a = ap.parse_args(argv)

    cur = current_build()
    build = a.build or latest_build()
    log("app data build: %s, target build: %s" % (cur, build))
    if build == cur and not a.force:
        log("Up to date: the app already uses %s." % build)
        return 0
    raw = os.path.join(ROOT, "data", "raw", build)
    if not a.skip_fetch:
        if run(["bash", "tools/research/fetch_db2.sh", build, raw]) != 0:
            return 2
    if run([sys.executable, "tools/pipeline/build_data.py", "--build", build, "--date", a.date]) != 0:
        log("The pipeline failed: read the error above (a renamed table or column needs a pipeline fix).")
        return 2
    new_dir = os.path.join(ROOT, "data", "generated", build)
    old_dir = os.path.join(ROOT, "data", "generated", cur)
    problems = 0
    lines = ["# Data refresh %s -> %s (%s)" % (cur, build, a.date)]
    if os.path.isdir(old_dir) and old_dir != new_dir:
        body, problems = diff_summary(old_dir, new_dir)
        lines += body
    tests = None
    if not a.no_tests:
        env = dict(os.environ, TALENTCALC_BUILD=build)
        tests = run([sys.executable, "-m", "unittest", "discover", "-s", "tools/pipeline/tests", "-t", "tools"], env)
        lines.append("## Pipeline tests against %s: %s" % (
            build, "OK" if tests == 0 else "FAILED (expected values changed: review each failure)"))
    lines.append("## Next steps")
    lines += [
        "- Review the changes above; update data/manual for every manual-data problem (values are [VERIFY] copies).",
        "- python3 tools/refresh_build.py --build %s --skip-fetch --switch, then npm test and npm run e2e;" % build,
        "  goldens that move are re-derived with the plan's independent Python scripts, never copied from the app.",
        "- Commit data/generated/%s (never hand-edit it) and remove the old build directory in the same commit." % build,
    ]
    if a.switch:
        switch_app(build)
    text = "\n".join(lines)
    log("\n" + text)
    if a.report:
        with open(a.report, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    return 1 if problems or (tests not in (None, 0)) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
