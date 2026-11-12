"""classes.json and pet-families.json builders (plan section 1.9)."""
import collections

from . import constants as C
from .spells import spec_skill_lines
from .util import I


def build_classes(db, icons, build):
    lines = spec_skill_lines(db)
    lines_of = collections.defaultdict(list)
    for sl, cid in lines.items():
        lines_of[cid].append(sl)
    tabs = collections.defaultdict(list)
    for r in db.rows("TalentTab"):
        tabs[I(r["ClassMask"])].append(r)
    chr_classes = db.by_id("ChrClasses")
    prof = collections.defaultdict(set)   # class mask bit -> weapon subclasses
    dual = set()
    for r in db.rows("SkillLineAbility"):
        if I(r["AcquireMethod"]) == C.ACQUIRE_RUNE:
            continue
        sl, cm = I(r["SkillLine"]), I(r["ClassMask"])
        if sl in C.WEAPON_SKILL_SUBCLASSES:
            for _, _, _, mask in C.CLASS_TREES:
                if cm & mask:
                    prof[mask].update(C.WEAPON_SKILL_SUBCLASSES[sl])
        elif sl == C.DUAL_WIELD_SKILL_LINE:
            for _, _, _, mask in C.CLASS_TREES:
                if cm & mask:
                    dual.add(mask)
    combos = collections.defaultdict(set)
    for r in db.rows("CharBaseInfo"):
        combos[I(r["ClassID"])].add(I(r["RaceID"]))
    classes = []
    for cid, token, tree, mask in C.CLASS_TREES:
        r = chr_classes[str(cid)]
        assert r["Filename"] == token, "class %d token %s != %s" % (cid, r["Filename"], token)
        color = "#%02x%02x%02x" % (I(r["ClassColorR"]), I(r["ClassColorG"]), I(r["ClassColorB"]))
        specs = []
        for i, t in enumerate(sorted(tabs[mask], key=lambda t: I(t["OrderIndex"]))):
            fid = I(t["SpellIconID"])
            specs.append({"index": i, "name": t["Name_lang"], "talentTabId": I(t["ID"]),
                          "background": t["BackgroundFile"], "icon": icons.resolve(fid, "spec", I(t["ID"])),
                          "iconFileId": fid})
        fid = I(r["IconFileDataID"])
        classes.append({
            "id": cid, "token": token.lower(), "name": r["Name_lang"], "color": color,
            "spellClassSet": I(r["SpellClassSet"]), "powerType": I(r["DisplayPower"]),
            "icon": icons.resolve(fid, "class", cid), "iconFileId": fid, "traitTreeId": tree,
            "skillLineIds": sorted(lines_of[cid]), "specs": specs,
            "raceIds": [rid for rid in C.RACES_V1 if rid in combos[cid]],
            "weaponSubclasses": sorted(prof[mask]), "dualWield": mask in dual,
        })
    races = []
    rr = db.by_id("ChrRaces")
    for rid in C.RACES_V1:
        r = rr[str(rid)]
        races.append({"id": rid, "token": r["ClientFileString"].lower(), "name": r["Name_lang"],
                      "faction": "horde" if I(r["Alliance"]) == 1 else "alliance"})
    currency = db.by_id("TraitCurrency")[str(C.TALENT_CURRENCY_ID)]
    assert I(currency["SourcedMax"]) == C.TALENT_CURRENCY_MAX, \
        "TraitCurrency %d SourcedMax %s != %d" % (C.TALENT_CURRENCY_ID, currency["SourcedMax"], C.TALENT_CURRENCY_MAX)
    entry_node = {}       # TraitNodeEntryID -> (TraitNodeID, _Index)
    for r in db.rows("TraitNodeXTraitNodeEntry"):
        entry_node[I(r["TraitNodeEntryID"])] = (I(r["TraitNodeID"]), I(r["_Index"]))
    node_entries = collections.defaultdict(list)
    for eid, (nid, idx) in entry_node.items():
        node_entries[nid].append((idx, eid))
    entries = db.by_id("TraitNodeEntry")
    defs = db.by_id("TraitDefinition")
    spell_names = db.by_id("SpellName")
    sources = []
    for r in db.rows("TraitCurrencySource"):
        if I(r["TraitCurrencyID"]) != C.TALENT_CURRENCY_ID:
            continue
        src = {"level": I(r["PlayerLevel"]), "amount": I(r["Amount"]), "requirement": r["Requirement_lang"]}
        eid = I(r["TraitNodeEntryID"])
        if eid:
            nid, _ = entry_node[eid]
            rank = [e for _, e in sorted(node_entries[nid])].index(eid) + 1
            spell_id = I(defs[entries[str(eid)]["TraitDefinitionID"]]["SpellID"])
            src["perk"] = {"nodeId": nid, "entryId": eid, "rank": rank, "spellId": spell_id,
                           "name": spell_names[str(spell_id)]["Name_lang"]}
        sources.append(src)
    sources.sort(key=lambda s: (s["level"], s["requirement"]))
    return {"build": build,
            "talentCurrency": {"id": C.TALENT_CURRENCY_ID, "max": I(currency["SourcedMax"]), "sources": sources},
            "classes": classes, "races": races}


def build_pet_families(db, icons, build):
    fams = []
    for r in db.rows("CreatureFamily"):
        fid = I(r["IconFileID"])
        fams.append({"id": I(r["ID"]), "name": r["Name_lang"], "icon": icons.resolve(fid, "petFamily", I(r["ID"])),
                     "skillLine": I(r["SkillLine_0"]), "petTalentType": I(r["PetTalentType"])})
    fams.sort(key=lambda f: f["id"])
    return {"build": build, "families": fams}
