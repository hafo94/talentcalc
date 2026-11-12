"""targets.json from ExpectedStat (plan section 1.7)."""
from . import constants as C
from .util import F, I, num, rhu


def build_targets(db, build):
    rows = {}
    for r in db.rows("ExpectedStat"):
        if I(r["ExpansionID"]) != -2:
            continue
        lvl = I(r["Lvl"])
        assert lvl not in rows, "duplicate ExpectedStat level %d" % lvl
        rows[lvl] = r
    levels = []
    for lvl in range(1, C.TARGET_MAX_LEVEL + 1):
        r = rows[lvl]
        ac = I(r["ArmorConstant"])
        assert ac == C.ARMOR_FORMULA["base"] + C.ARMOR_FORMULA["perLevel"] * lvl, \
            "ArmorConstant at level %d is %d" % (lvl, ac)
        levels.append({"level": lvl, "armor": rhu(F(r["CreatureArmor"])), "health": rhu(F(r["CreatureHealth"])),
                       "armorConstant": ac, "autoAttackDps": num(F(r["CreatureAutoAttackDps"])),
                       "spellDamage": num(F(r["CreatureSpellDamage"]))})
    presets = [dict(p) for p in C.TARGET_PRESETS]
    by_level = {}
    for pl in range(1, C.PLAYER_MAX_LEVEL + 1):
        lst = []
        for p in C.TARGET_PRESETS:
            tl = pl + p["levelOffset"]
            r = rows[tl]
            lst.append({"preset": p["id"], "level": tl,
                        "armor": rhu(F(r["CreatureArmor"]) * p["armorMultiplier"]),
                        "health": rhu(F(r["CreatureHealth"]))})
        by_level[str(pl)] = lst
    return {"build": build, "armorFormula": dict(C.ARMOR_FORMULA), "levels": levels, "presets": presets,
            "byPlayerLevel": by_level}
