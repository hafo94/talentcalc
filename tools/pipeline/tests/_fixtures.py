"""Shared test fixtures: paths and build-once helpers (cached per process)."""
import json
import os
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BUILD = "1.60.1.70888"
ERA_BUILD = "1.15.9.70576"
RAW = os.path.join(ROOT, "data", "raw", BUILD)
ERA_RAW = os.path.join(ROOT, "data", "raw", ERA_BUILD)
MANUAL = os.path.join(ROOT, "data", "manual")

needs_raw = unittest.skipUnless(os.path.isdir(RAW), "raw data not fetched")
needs_era = unittest.skipUnless(os.path.isfile(os.path.join(ERA_RAW, "ItemSparse.csv")), "era raw data not fetched")

_cache = {}
_tmp = []


class _Opts:
    def __init__(self, **kw):
        self.include_hidden = kw.get("include_hidden", False)


def talents(include_hidden=False):
    """(class_files dict, report dict) built directly from the raw tables."""
    k = ("talents", include_hidden)
    if k not in _cache:
        from pipeline.db2 import RawDB
        from pipeline.icons import IconResolver
        from pipeline.talents import build_talent_trees
        db = RawDB(RAW)
        report = {}
        out = build_talent_trees(db, _Opts(include_hidden=include_hidden), IconResolver(db), report)
        _cache[k] = (out, report)
    return _cache[k]


def talent_by_node(node_id, include_hidden=False):
    out, _ = talents(include_hidden)
    for f in out.values():
        for si, s in enumerate(f["specs"]):
            for t in s["talents"]:
                if t["nodeId"] == node_id:
                    return f, si, s, t
    return None


def build_dir(include_hidden=False, date="2000-01-01", era=True):
    """Run the full CLI build once per process into a temp dir; returns the output directory."""
    k = ("build", include_hidden, date, era)
    if k not in _cache:
        from pipeline import build_data
        td = tempfile.TemporaryDirectory()
        _tmp.append(td)
        out = os.path.join(td.name, "out")
        argv = ["--build", BUILD, "--raw", RAW, "--out", out, "--manual", MANUAL, "--date", date,
                "--era-raw", ERA_RAW]
        if not era:
            argv.append("--no-era-fallback")
        if include_hidden:
            argv.append("--include-hidden-nodes")
        rc = build_data.main(argv)
        assert rc == 0, "build failed"
        _cache[k] = out
    return _cache[k]


def load(out_dir, name):
    with open(os.path.join(out_dir, name), encoding="utf-8") as f:
        return json.load(f)


def spells():
    """(spell records by id, ability chains, seeds, report) built directly from raw tables."""
    k = ("spells",)
    if k not in _cache:
        from pipeline.db2 import RawDB
        from pipeline.icons import IconResolver
        from pipeline.spells import build_ability_chains, build_spell, collect_spells
        out, report = talents()
        db = RawDB(RAW)
        icons = IconResolver(db)
        tsc = {t["spellId"]: f["classId"] for f in out.values() for s in f["specs"] for t in s["talents"]}
        seeds = collect_spells(db, tsc, report)
        recs = {sid: build_spell(db, sid, seed, icons) for sid, seed in sorted(seeds.items())}
        chains = build_ability_chains(db, seeds)
        _cache[k] = (recs, chains, seeds, report)
    return _cache[k]


def weapons():
    """(weapons list, ammo list, report) built directly from raw tables (+ era if present)."""
    k = ("weapons",)
    if k not in _cache:
        from pipeline.db2 import RawDB
        from pipeline.icons import IconResolver
        from pipeline.items import build_weapons
        db = RawDB(RAW)
        era = RawDB(ERA_RAW) if os.path.isfile(os.path.join(ERA_RAW, "ItemSparse.csv")) else None
        with open(os.path.join(MANUAL, "weapon-overrides.json"), encoding="utf-8") as f:
            ov = json.load(f)
        report = {"manualValidation": []}
        w, a = build_weapons(db, era, ov, IconResolver(db), report)
        _cache[k] = (w, a, report)
    return _cache[k]
