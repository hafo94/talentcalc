"""Validation of hand-maintained inputs in data/manual/ (plan section 5)."""
import json
import os

REQUIRED = {
    "base-stats.json": ["classes", "raceOffsets", "validCombos", "conversions"],
    "pets.json": ["hunterFamilies", "warlockDemons", "ownerScaling"],
    "buffs.json": ["buffs"],
    "targets.json": ["named"],
    "weapon-overrides.json": ["weapons"],
}


def _walk(obj):
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


def validate_manual(manual_dir, db, report):
    """Returns {filename: parsed JSON}. Problems go to report['manualValidation'] (warnings)."""
    mv = report.setdefault("manualValidation", [])
    names = db.by_id("SpellName")
    data = {}
    for fn, keys in REQUIRED.items():
        p = os.path.join(manual_dir, fn)
        if not os.path.isfile(p):
            mv.append({"file": fn, "id": "-", "problem": "file missing"})
            data[fn] = {}
            continue
        with open(p, encoding="utf-8") as f:
            obj = json.load(f)       # a parse error aborts the build
        data[fn] = obj
        for k in ("_source", "_status") + tuple(keys):
            if k not in obj:
                mv.append({"file": fn, "id": "-", "problem": "missing key %s" % k})
        for d in _walk(obj):
            sid = d.get("spellId")
            if sid is None:
                continue
            nm = d.get("name") or d.get("id") or ""
            row = names.get(str(sid))
            if row is None:
                mv.append({"file": fn, "id": str(d.get("id", sid)), "problem": "spellId %s not in SpellName" % sid})
            elif str(d.get("name", "")).lower() not in row["Name_lang"].lower():
                mv.append({"file": fn, "id": str(d.get("id", sid)),
                           "problem": "spellId %s is '%s', expected name containing '%s'" %
                                      (sid, row["Name_lang"], d.get("name"))})
    fam = {r["ID"]: r["Name_lang"] for r in db.rows("CreatureFamily")}
    pets = data.get("pets.json", {})
    for grp in ("hunterFamilies", "warlockDemons"):
        for fid, v in (pets.get(grp) or {}).items():
            if fid not in fam:
                mv.append({"file": "pets.json", "id": fid, "problem": "CreatureFamily id not found"})
            elif fam[fid].lower() != v.get("name", "").lower():
                mv.append({"file": "pets.json", "id": fid,
                           "problem": "family is '%s', entry says '%s'" % (fam[fid], v.get("name"))})
    return data
