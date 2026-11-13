"""Phase 6: pets/<owner>.json - hunter pet families and warlock demons with their abilities, passives and spells."""
import collections

from . import constants as C
from .spells import Seed, build_spell
from .util import I, u32


def _manual_spell_ids(obj):
    """Every spellId in a manual JSON object (sacrifice, Master Demonologist and Soul Link auras)."""
    out = set()
    if isinstance(obj, dict):
        if isinstance(obj.get("spellId"), int):
            out.add(obj["spellId"])
        for v in obj.values():
            out |= _manual_spell_ids(v)
    elif isinstance(obj, list):
        for v in obj:
            out |= _manual_spell_ids(v)
    return out


def build_pets(db, icons, chains, manual_pets, report):
    """Returns {owner token: {"classId", "pets", "spells"}}. A family belongs to the owner whose pet scaling aura
    (C.PET_SCALING_SPELLS) is in its skill line; a demon also needs a "Summon <name>" warlock ability."""
    names = db.by_id("SpellName")
    misc = db.by_spell("SpellMisc")
    levels = db.by_spell("SpellLevels")
    effects = db.group("SpellEffect", "SpellID")
    by_line = collections.defaultdict(set)
    for r in db.rows("SkillLineAbility"):
        if r["Spell"] in names:
            by_line[I(r["SkillLine"])].add(I(r["Spell"]))
    class_id = {tok.lower(): cid for cid, tok, _, _ in C.CLASS_TREES}
    summons = {c["name"] for c in chains if c["classId"] == class_id["warlock"]}

    def passive(sid):
        m = misc.get(str(sid))
        return bool(m and (u32(I(m["Attributes_0"])) & C.ATTR0_PASSIVE))

    def base_level(sid):
        lv = levels.get(str(sid))
        return I(lv["BaseLevel"]) if lv else 0

    pets = collections.defaultdict(list)
    skipped = []
    for r in sorted(db.rows("CreatureFamily"), key=lambda r: I(r["ID"])):
        fid = I(r["ID"])
        name = r["Name_lang"]
        line = I(r["SkillLine_0"])
        sids = sorted(by_line.get(line, ()))
        owner = next((C.PET_SCALING_SPELLS[s] for s in sids if s in C.PET_SCALING_SPELLS), None)
        if owner is None:
            skipped.append({"id": fid, "name": name, "reason": "no pet scaling aura in skill line %d" % line})
            continue
        if owner == "warlock" and ("Summon " + name) not in summons:
            skipped.append({"id": fid, "name": name, "reason": "no Summon %s warlock ability" % name})
            continue
        groups = collections.defaultdict(list)
        for s in sids:
            if not passive(s):
                groups[names[str(s)]["Name_lang"]].append(s)
        abilities = [{"name": n, "ranks": sorted(ids, key=lambda s: (base_level(s), s))}
                     for n, ids in sorted(groups.items())]
        pets[owner].append({
            "id": fid, "name": name, "owner": owner,
            "icon": icons.resolve(I(r["IconFileID"]), "petFamily", fid), "skillLine": line,
            "exotic": I(r["PetTalentType"]) == 1, "abilities": abilities,
            "passives": [s for s in sids if passive(s)],
        })
    report["petsSkipped"] = skipped

    manual_ids = _manual_spell_ids(manual_pets)
    out = {}
    for owner in sorted(pets):
        cid = class_id[owner]
        ids = set(manual_ids if owner == "warlock" else ())
        for p in pets[owner]:
            ids |= set(p["passives"])
            for a in p["abilities"]:
                ids |= set(a["ranks"])
        work = collections.deque(sorted(ids))
        while work:      # closure over triggered spells (Frenzy 20784 -> 19615)
            sid = work.popleft()
            for e in effects.get(str(sid), []):
                t = I(e["EffectTriggerSpell"])
                if t and str(t) in names and t not in ids:
                    ids.add(t)
                    work.append(t)
        spells = []
        for sid in sorted(ids):
            if str(sid) not in names:
                continue
            seed = Seed()
            seed.classes.add(cid)
            seed.sources.add("pet")
            spells.append(build_spell(db, sid, seed, icons))
        out[owner] = {"classId": cid, "pets": pets[owner], "spells": spells}
    return out
