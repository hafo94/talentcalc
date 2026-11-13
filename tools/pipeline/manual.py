"""Validation of hand-maintained inputs in data/manual/ (plan section 5)."""
import json
import os

from .util import F, I, num

REQUIRED = {
    "base-stats.json": ["level", "classes", "raceOffsets", "conversions"],
    "pets.json": ["level", "owners", "sacrifice", "masterDemonologist", "soulLink"],
    "buffs.json": ["buffs", "presets"],
    "racials.json": ["racials"],
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


def _check_effect_sources(fn, d, sid, db, mv):
    """effects[].src = {effectIndex, field?: "base" | "perResource", mult?}: value must equal the SpellEffect
    (Difficulty 0) column x mult. Phase 3: catches stale hand-copied buff values."""
    rows = {I(r["EffectIndex"]): r for r in db.group("SpellEffect", "SpellID").get(str(sid), [])}
    for e in d.get("effects") or []:
        src = e.get("src")
        if not isinstance(src, dict):
            continue
        r = rows.get(src.get("effectIndex"))
        col = {"base": "EffectBasePointsF", "perResource": "EffectPointsPerResource"}[src.get("field", "base")]
        if r is None:
            mv.append({"file": fn, "id": str(d.get("id", sid)),
                       "problem": "spell %s has no effect index %s" % (sid, src.get("effectIndex"))})
            continue
        want = F(r[col]) * src.get("mult", 1)
        if abs(want - e["value"]) > 1e-6:
            mv.append({"file": fn, "id": str(d.get("id", sid)),
                       "problem": "%s %s: value %s != SpellEffect %s x %s = %s" %
                                  (e["key"], src, e["value"], r[col], src.get("mult", 1), num(want))})


def _check_min_level(d, db, mv):
    """Phase 7: buffs.json minLevel (absent = 1) must equal SpellLevels.BaseLevel of the buff's spell (class buffs and
    debuffs: the modeled rank) and, with an itemId, max(1, ItemSparse.RequiredLevel) of the item."""
    want = d.get("minLevel", 1)
    bid = str(d.get("id"))
    if d.get("category") in ("raid", "debuff") and d.get("spellId") is not None:
        row = db.by_spell("SpellLevels").get(str(d["spellId"]))
        base = I(row["BaseLevel"]) if row else 0
        if base > 0 and base != want:
            mv.append({"file": "buffs.json", "id": bid,
                       "problem": "minLevel %s != SpellLevels.BaseLevel %s" % (want, base)})
    if d.get("itemId") is not None:
        item = db.by_id("ItemSparse").get(str(d["itemId"]))
        if item is None:
            mv.append({"file": "buffs.json", "id": bid, "problem": "itemId %s not in ItemSparse" % d["itemId"]})
        elif max(1, I(item["RequiredLevel"])) != want:
            mv.append({"file": "buffs.json", "id": bid,
                       "problem": "minLevel %s != ItemSparse.RequiredLevel %s" % (want, item["RequiredLevel"])})


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
            expect = str(d.get("spellName") or d.get("name") or "")
            row = names.get(str(sid))
            if row is None:
                mv.append({"file": fn, "id": str(d.get("id", sid)), "problem": "spellId %s not in SpellName" % sid})
            elif expect.lower() not in row["Name_lang"].lower():
                mv.append({"file": fn, "id": str(d.get("id", sid)),
                           "problem": "spellId %s is '%s', expected name containing '%s'" %
                                      (sid, row["Name_lang"], expect)})
            _check_effect_sources(fn, d, sid, db, mv)
    for d in data.get("buffs.json", {}).get("buffs") or []:
        _check_min_level(d, db, mv)
    fam = {r["ID"]: r["Name_lang"] for r in db.rows("CreatureFamily")}
    pets = data.get("pets.json", {})
    for grp in ("sacrifice", "masterDemonologist"):
        for v in pets.get(grp) or []:
            fid = str(v.get("family"))
            if fid not in fam:
                mv.append({"file": "pets.json", "id": fid, "problem": "CreatureFamily id not found"})
            elif fam[fid].lower() != v.get("name", "").lower():
                mv.append({"file": "pets.json", "id": fid,
                           "problem": "family is '%s', entry says '%s'" % (fam[fid], v.get("name"))})
    return data
