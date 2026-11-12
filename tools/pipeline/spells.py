"""Spell collection, per-spell records and ability chains (plan section 1.3)."""
import collections
import re

from . import constants as C
from .tooltips import SpellTextContext, render
from .util import F, I, num, u32

_RANK_RE = re.compile(r"^Rank (\d+)$")


class Seed:
    __slots__ = ("classes", "sources", "ability_classes", "skill_lines")

    def __init__(self):
        self.classes = set()
        self.sources = set()
        self.ability_classes = set()
        self.skill_lines = {}      # classId -> lowest skill line id


def spec_skill_lines(db):
    """skillLineId -> classId for the 27 spec lines."""
    mask_class = {mask: cid for cid, _, _, mask in C.CLASS_TREES}
    by_line = collections.defaultdict(list)
    for r in db.rows("SkillLineAbility"):
        by_line[r["SkillLine"]].append(r)
    out = {}
    for r in db.rows("SkillLine"):
        if I(r["CategoryID"]) == C.SPEC_SKILL_LINE_CATEGORY and I(r["Flags"]) in C.SPEC_SKILL_LINE_FLAGS:
            masks = {I(a["ClassMask"]) for a in by_line.get(r["ID"], []) if I(a["ClassMask"]) != 0}
            assert len(masks) == 1, "skill line %s: expected one class mask, got %s" % (r["ID"], masks)
            out[I(r["ID"])] = mask_class[masks.pop()]
    assert len(out) == 27, "expected 27 spec skill lines, got %d" % len(out)
    return out


def collect_spells(db, talent_spell_class, report):
    """talent_spell_class: spellId -> classId. Returns dict spellId -> Seed."""
    names = db.by_id("SpellName")
    lines = spec_skill_lines(db)
    seeds = {}
    excluded = set()

    def seed(sid):
        if sid not in seeds:
            seeds[sid] = Seed()
        return seeds[sid]

    for r in db.rows("SkillLineAbility"):
        sl = I(r["SkillLine"])
        if sl not in lines:
            continue
        sid = I(r["Spell"])
        if I(r["AcquireMethod"]) == C.ACQUIRE_RUNE:
            if r["Spell"] in names:
                excluded.add(sid)
            continue
        if r["Spell"] not in names:
            continue          # unnamed legacy talent rank spell
        s = seed(sid)
        cid = lines[sl]
        s.sources.add("ability")
        s.classes.add(cid)
        s.ability_classes.add(cid)
        if cid not in s.skill_lines or sl < s.skill_lines[cid]:
            s.skill_lines[cid] = sl
    for sid, cid in talent_spell_class.items():
        s = seed(sid)
        s.sources.add("talent")
        s.classes.add(cid)
    report["excludedRuneSpells"] = sorted(excluded)

    # closure over triggered spells
    effects = db.group("SpellEffect", "SpellID")
    work = collections.deque(sorted(seeds))
    while work:
        sid = work.popleft()
        parent = seeds[sid]
        for e in effects.get(str(sid), []):
            kids = []
            t = I(e["EffectTriggerSpell"])
            if t:
                kids.append(t)
            if I(e["EffectAura"]) == C.AURA_OVERRIDE_ACTIONBAR:
                kids.append(int(F(e["EffectBasePointsF"])))
            for k in kids:
                if k == 0 or str(k) not in names:
                    continue
                child = seed(k)
                changed = False
                if "triggered" not in child.sources:
                    child.sources.add("triggered")
                    changed = True
                if not parent.classes <= child.classes:
                    child.classes |= parent.classes
                    changed = True
                if changed:
                    work.append(k)
    return seeds


def _effects(db, sid):
    out = []
    for r in sorted(db.group("SpellEffect", "SpellID").get(str(sid), []), key=lambda r: I(r["EffectIndex"])):
        e = {
            "index": I(r["EffectIndex"]), "effect": I(r["Effect"]), "aura": I(r["EffectAura"]),
            "base": num(F(r["EffectBasePointsF"])),
            "misc": [I(r["EffectMiscValue_0"]), I(r["EffectMiscValue_1"])],
            "mask": [u32(I(r["EffectSpellClassMask_%d" % i])) for i in range(4)],
        }

        def opt(key, v):
            if v:
                e[key] = num(v) if isinstance(v, float) else v

        opt("variance", F(r["Variance"]))
        opt("perLevel", F(r["EffectRealPointsPerLevel"]))
        opt("spCoef", F(r["EffectBonusCoefficient"]))
        opt("apCoef", F(r["BonusCoefficientFromAP"]))
        opt("periodMs", I(r["EffectAuraPeriod"]))
        opt("amplitude", F(r["EffectAmplitude"]))
        opt("chainTargets", I(r["EffectChainTargets"]))
        opt("pointsPerCombo", F(r["EffectPointsPerResource"]))
        opt("triggerSpell", I(r["EffectTriggerSpell"]))
        opt("mechanic", I(r["EffectMechanic"]))
        t = [I(r["ImplicitTarget_0"]), I(r["ImplicitTarget_1"])]
        if any(t):
            e["targets"] = t
        ri = [I(r["EffectRadiusIndex_0"]), I(r["EffectRadiusIndex_1"])]
        if any(ri):
            e["radiusIndex"] = ri
        out.append(e)
    return out


def build_spell(db, sid, seed, icons, report=None):
    s = str(sid)
    names = db.by_id("SpellName")
    spell = db.by_id("Spell").get(s) or {}
    misc = db.by_spell("SpellMisc").get(s)
    sub = spell.get("NameSubtext_lang", "")
    m = _RANK_RE.match(sub or "")
    attrs = [u32(I(misc["Attributes_%d" % i])) for i in range(17)] if misc else [0] * 17
    icon_fid = I(misc["SpellIconFileDataID"]) if misc else 0

    cast_ms = 0
    duration = None
    rng = None
    school = 0
    if misc:
        school = I(misc["SchoolMask"])
        ci = misc["CastingTimeIndex"]
        if ci not in ("", "0"):
            ct = db.by_id("SpellCastTimes").get(ci)
            cast_ms = I(ct["Base"]) if ct else 0
        di = misc["DurationIndex"]
        if di not in ("", "0"):
            d = db.by_id("SpellDuration").get(di)
            if d:
                duration = {"ms": I(d["Duration"]), "perLevel": num(F(d["DurationPerLevel"])),
                            "maxMs": I(d["MaxDuration"])}
        ri = misc["RangeIndex"]
        if ri not in ("", "0"):
            rr = db.by_id("SpellRange").get(ri)
            if rr:
                rng = {"min": num(F(rr["RangeMin_0"])), "max": num(F(rr["RangeMax_0"]))}

    lv = db.by_spell("SpellLevels").get(s)
    levels = {"base": I(lv["BaseLevel"]), "max": I(lv["MaxLevel"]), "spell": I(lv["SpellLevel"])} if lv else None
    cd = db.by_spell("SpellCooldowns").get(s)
    cat = db.by_spell("SpellCategories").get(s)
    ao = db.by_spell("SpellAuraOptions").get(s)
    proc = None
    if ao:
        ppm = None
        if I(ao["SpellProcsPerMinuteID"]):
            row = db.by_id("SpellProcsPerMinute").get(ao["SpellProcsPerMinuteID"])
            if row:
                ppm = num(F(row["BaseProcRate"]))
        proc = {"chance": I(ao["ProcChance"]), "charges": I(ao["ProcCharges"]),
                "categoryRecoveryMs": I(ao["ProcCategoryRecovery"]),
                "typeMask": [u32(I(ao["ProcTypeMask_0"])), u32(I(ao["ProcTypeMask_1"]))], "ppm": ppm}
    costs = []
    for r in sorted(db.group("SpellPower", "SpellID", diff0=False).get(s, []), key=lambda r: I(r["OrderIndex"])):
        pt = I(r["PowerType"])
        amt = I(r["ManaCost"])
        costs.append({"powerType": pt, "amount": num(amt / 10.0) if pt == C.POWER_RAGE else amt,
                      "pct": num(F(r["PowerCostPct"])), "perLevel": num(F(r["ManaCostPerLevel"])),
                      "perSecond": num(F(r["ManaPerSecond"])), "optional": I(r["OptionalCost"])})
    co = db.by_spell("SpellClassOptions").get(s)
    family = {"set": I(co["SpellClassSet"]),
              "mask": [u32(I(co["SpellClassMask_%d" % i])) for i in range(4)]} if co else None

    ctx = SpellTextContext.from_db(db, sid)
    desc, u1 = render(spell.get("Description_lang", ""), ctx)
    adesc, u2 = render(spell.get("AuraDescription_lang", ""), ctx)
    unresolved = sorted(set(u1) | set(u2))

    rec = {
        "id": sid, "name": names[s]["Name_lang"], "subtext": sub or None,
        "rank": int(m.group(1)) if m else None,
        "classIds": sorted(seed.classes), "sources": sorted(seed.sources),
        "icon": icons.resolve(icon_fid, "spell", sid), "iconFileId": icon_fid, "school": school,
        "passive": bool(attrs[0] & C.ATTR0_PASSIVE), "channeled": bool(attrs[1] & C.ATTR1_CHANNELED),
        "attributes": attrs, "levels": levels, "castMs": cast_ms,
        "gcdMs": I(cd["StartRecoveryTime"]) if cd else 0,
        "gcdCategory": I(cat["StartRecoveryCategory"]) if cat else 0,
        "cooldownMs": I(cd["RecoveryTime"]) if cd else 0,
        "categoryCooldownMs": I(cd["CategoryRecoveryTime"]) if cd else 0,
        "category": I(cat["Category"]) if cat else 0,
        "costs": costs, "range": rng, "duration": duration, "family": family, "proc": proc,
        "maxStacks": I(ao["CumulativeAura"]) if ao else 0,
        "defenseType": I(cat["DefenseType"]) if cat else 0, "dispelType": I(cat["DispelType"]) if cat else 0,
        "mechanic": I(cat["Mechanic"]) if cat else 0, "preventionType": I(cat["PreventionType"]) if cat else 0,
        "description": desc, "auraDescription": adesc,
    }
    if unresolved:
        rec["unresolved"] = unresolved
    rec["effects"] = _effects(db, sid)
    return rec


def build_ability_chains(db, seeds):
    names = db.by_id("SpellName")
    levels = db.by_spell("SpellLevels")
    misc = db.by_spell("SpellMisc")
    groups = collections.defaultdict(list)
    for sid, s in seeds.items():
        if "ability" not in s.sources or "talent" in s.sources:
            continue
        for cid in s.ability_classes:
            groups[(cid, names[str(sid)]["Name_lang"])].append((sid, s))
    chains = []
    for (cid, name), members in groups.items():
        members.sort(key=lambda t: (I(levels[str(t[0])]["BaseLevel"]) if str(t[0]) in levels else 0, t[0]))
        first = members[0][0]
        mi = misc.get(str(first))
        passive = bool(mi and (u32(I(mi["Attributes_0"])) & C.ATTR0_PASSIVE))
        chains.append({"classId": cid, "name": name,
                       "skillLineId": min(s.skill_lines[cid] for _, s in members if cid in s.skill_lines),
                       "passive": passive, "ranks": [sid for sid, _ in members]})
    chains.sort(key=lambda c: (c["classId"], c["name"]))
    return chains
