#!/usr/bin/env python3
"""Raw DB2 CSV -> data/generated/<build>/ (see docs/phase1-implementation-plan.md)."""
import argparse
import collections
import datetime
import json
import os
import sys

if __package__ in (None, ""):
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from pipeline import constants as C  # noqa: E402
from pipeline.classes import build_classes, build_pet_families  # noqa: E402
from pipeline.coverage import build_coverage  # noqa: E402
from pipeline.db2 import MissingTableError, RawDB  # noqa: E402
from pipeline.icons import IconResolver  # noqa: E402
from pipeline.items import build_weapons  # noqa: E402
from pipeline.manual import validate_manual  # noqa: E402
from pipeline.pets import build_pets  # noqa: E402
from pipeline.spells import build_ability_chains, build_spell, collect_spells  # noqa: E402
from pipeline.talents import BuildError, attach_effects, build_talent_trees  # noqa: E402
from pipeline.targets import build_targets  # noqa: E402
from pipeline.writer import write_json, write_records  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


class Opts:
    def __init__(self, include_hidden):
        self.include_hidden = include_hidden


def parse_args(argv):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--build", default=C.BUILD_DEFAULT)
    ap.add_argument("--raw")
    ap.add_argument("--out")
    ap.add_argument("--era-raw")
    ap.add_argument("--era-build", default=C.ERA_BUILD_DEFAULT)
    ap.add_argument("--no-era-fallback", action="store_true")
    ap.add_argument("--include-hidden-nodes", action="store_true")
    ap.add_argument("--manual", default=os.path.join(ROOT, "data", "manual"))
    ap.add_argument("--date", default=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"))
    a = ap.parse_args(argv)
    a.raw = a.raw or os.path.join(ROOT, "data", "raw", a.build)
    a.out = a.out or os.path.join(ROOT, "data", "generated", a.build)
    if a.era_raw is None:
        a.era_raw = os.path.join(ROOT, "data", "raw", a.era_build)
        legacy = os.path.join(ROOT, "data", "raw", "era", a.era_build)     # location used in the plan text
        if not os.path.isdir(a.era_raw) and os.path.isdir(legacy):
            a.era_raw = legacy
    return a


def _plain(o):
    if isinstance(o, set):
        return sorted(o)
    if isinstance(o, collections.Counter):
        return dict(sorted(o.items()))
    return o


def run(a):
    db = RawDB(a.raw)
    era = None
    if not a.no_era_fallback:
        if os.path.isfile(os.path.join(a.era_raw, "ItemSparse.csv")):
            era = RawDB(a.era_raw)
        else:
            print("WARNING: era raw data not found at %s; building without the Classic Era weapon fallback "
                  "(run tools/pipeline/fetch_era_items.sh)" % a.era_raw)
    icons = IconResolver(db)
    report = {"build": a.build}
    opts = Opts(a.include_hidden_nodes)

    # talents
    talent_files = build_talent_trees(db, opts, icons, report)
    for f in talent_files.values():
        f["build"] = a.build

    # spells
    tsc = {}
    for cid, f in talent_files.items():
        for s in f["specs"]:
            for t in s["talents"]:
                tsc[t["spellId"]] = cid
    seeds = collect_spells(db, tsc, report)
    spells = [build_spell(db, sid, seeds[sid], icons) for sid in sorted(seeds)]
    spells_by_id = {s["id"]: s for s in spells}
    attach_effects(talent_files, spells_by_id)
    chains = build_ability_chains(db, seeds)
    unresolved = report.pop("_unresolved")
    for s in spells:
        for t in s.get("unresolved", []):
            unresolved[t] += 1

    # classes, pets, targets
    classes = build_classes(db, icons, a.build)
    pets = build_pet_families(db, icons, a.build)
    targets = build_targets(db, a.build)

    # manual data + weapons
    manual = validate_manual(a.manual, db, report)
    weapons, ammo = build_weapons(db, era, manual.get("weapon-overrides.json", {}), icons, report)

    coverage = build_coverage(talent_files, spells_by_id, a.build)
    pet_files = build_pets(db, icons, chains, manual.get("pets.json", {}), report)

    # report finishing
    seen = set()
    missing = []
    for m in icons.missing:
        k = (m["kind"], m["id"])
        if k not in seen:
            seen.add(k)
            missing.append(m)
    missing.sort(key=lambda m: (m["kind"], m["id"]))
    report["unknownStatIds"] = sorted(report.get("unknownStatIds", []))
    final = collections.OrderedDict()
    for k in ("build", "hiddenNodes", "positionFixes", "posYInconsistent", "gateScopeAnomalies", "edges",
              "curveBaseMismatch", "multiRankWithoutCurve", "excludedRuneSpells"):
        final[k] = report.get(k, [])
    # Deterministic order for clean diffs (sources iterate sets).
    final["curveBaseMismatch"] = sorted(final["curveBaseMismatch"], key=lambda r: (r["nodeId"], r["effectIndex"]))
    final["multiRankWithoutCurve"] = sorted(final["multiRankWithoutCurve"], key=lambda r: json.dumps(r, sort_keys=True))
    final["missingIcons"] = missing
    final["unresolvedTokens"] = dict(sorted(unresolved.items()))
    final["weaponFilters"] = dict(sorted(report.get("weaponFilters", {}).items()))
    final["unknownStatIds"] = report["unknownStatIds"]
    final["manualValidation"] = report.get("manualValidation", [])
    final["warnings"] = report.get("warnings", [])
    final["petsSkipped"] = report.get("petsSkipped", [])

    # ---- write ----
    out = a.out
    os.makedirs(os.path.join(out, "talents"), exist_ok=True)
    n_talents = 0
    n_hidden = 0
    for cid, f in sorted(talent_files.items()):
        hdr = {k: f[k] for k in ("build", "classId", "token", "traitTreeId", "maxPoints")}
        write_records(os.path.join(out, "talents", f["token"] + ".json"), hdr, {"specs": f["specs"]})
        for s in f["specs"]:
            n_talents += len(s["talents"])
            n_hidden += sum(1 for t in s["talents"] if t.get("hidden"))
    write_json(os.path.join(out, "classes.json"), classes)
    write_records(os.path.join(out, "spells.json"), {"build": a.build}, {"spells": spells, "abilities": chains})
    # Phase 4: one lazy chunk per class for the app (same records as spells.json; a spell may be in several files).
    for cid, f in sorted(talent_files.items()):
        hdr = {"build": a.build, "classId": cid, "token": f["token"]}
        write_records(os.path.join(out, "spells", f["token"] + ".json"), hdr,
                      {"spells": [s for s in spells if cid in s["classIds"]],
                       "abilities": [c for c in chains if c["classId"] == cid]})
    write_records(os.path.join(out, "weapons.json"), {"build": a.build}, {"weapons": weapons, "ammo": ammo})
    write_json(os.path.join(out, "targets.json"), targets)
    write_json(os.path.join(out, "pet-families.json"), pets)
    # Phase 6: one lazy chunk per pet owner (hunter, warlock).
    for tok, pf in sorted(pet_files.items()):
        hdr = {"build": a.build, "classId": pf["classId"], "token": tok}
        write_records(os.path.join(out, "pets", tok + ".json"), hdr, {"pets": pf["pets"], "spells": pf["spells"]})
    write_records(os.path.join(out, "coverage.json"), {"build": a.build, "summary": coverage["summary"]},
                  {"talents": coverage["talents"]})
    hdr = {k: v for k, v in final.items() if not isinstance(v, list)}
    arr = {k: v for k, v in final.items() if isinstance(v, list)}
    write_records(os.path.join(out, "report.json"), hdr, arr)

    raw_tables = [{"name": t, "rows": db.row_count(t), "sha256": db.sha256(t)} for t in sorted(db.tables_read)]
    manifest = collections.OrderedDict()
    manifest["build"] = a.build
    manifest["eraBuild"] = a.era_build if era is not None else None
    manifest["generatedAt"] = a.date
    manifest["pipelineVersion"] = C.PIPELINE_VERSION
    manifest["options"] = {"includeHiddenNodes": a.include_hidden_nodes, "eraFallback": era is not None}
    manifest["iconUrlTemplate"] = C.ICON_URL_TEMPLATE
    manifest["iconUrlFallback"] = C.ICON_URL_FALLBACK
    manifest["rawTables"] = raw_tables
    if era is not None:
        manifest["eraRawTables"] = [{"name": t, "rows": era.row_count(t), "sha256": era.sha256(t)}
                                    for t in sorted(era.tables_read)]
    manifest["counts"] = {
        "classes": len(classes["classes"]), "specs": sum(len(c["specs"]) for c in classes["classes"]),
        "talents": n_talents, "hiddenTalents": n_hidden, "spells": len(spells), "abilityChains": len(chains),
        "weapons": len(weapons), "weaponsEraFallback": sum(1 for w in weapons if w["source"] == "classic_era"),
        "ammo": len(ammo), "targetLevels": len(targets["levels"]), "petFamilies": len(pets["families"]),
        "pets": sum(len(pf["pets"]) for pf in pet_files.values()),
        "petSpells": sum(len(pf["spells"]) for pf in pet_files.values()),
    }
    write_json(os.path.join(out, "manifest.json"), manifest)

    print("Built %s -> %s" % (a.build, out))
    for k, v in manifest["counts"].items():
        print("  %-20s %d" % (k, v))
    s = coverage["summary"]
    print("  coverage: generic %d, special %d, unsupported %d (dpsRelevant %d / %d)" %
          (s["generic"], s["special"], s["unsupported"], s["dpsRelevant"], s["total"]))
    print("  report items: hidden %d, positionFixes %d, posYInconsistent %d, gateAnomalies %d, curveMismatch %d, "
          "noCurve %d, missingIcons %d, unresolvedTokens %d, manualValidation %d, warnings %d" %
          (len(final["hiddenNodes"]), len(final["positionFixes"]), len(final["posYInconsistent"]),
           len(final["gateScopeAnomalies"]), len(final["curveBaseMismatch"]), len(final["multiRankWithoutCurve"]),
           len(missing), len(unresolved), len(final["manualValidation"]), len(final["warnings"])))
    return 0


def main(argv=None):
    a = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        return run(a)
    except (BuildError, AssertionError, MissingTableError, KeyError) as e:
        print("ERROR: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
