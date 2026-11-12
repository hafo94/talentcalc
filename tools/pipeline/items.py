"""Weapons and ammo (plan section 1.5)."""
import math

from . import constants as C
from .util import F, I, num, rhu

SLOT_OF_INV = {13: "oneHand", 21: "mainHand", 22: "offHand", 17: "twoHand"}


def _quality_key(q):
    if q >= 4:
        return "Epic"
    if q == 3:
        return "Superior"
    return "Good"


def damage_table_name(sparse, item):
    """-> (table name, slot) or None when the combination is unsupported."""
    inv = I(sparse["InventoryType"])
    sub = I(item["SubclassID"])
    caster = bool(I(sparse.get("Flags_1", "0")) & C.ITEM_FLAG2_CASTER_WEAPON)
    if inv in (13, 21, 22):
        return ("ItemDamageOneHandCaster" if caster else "ItemDamageOneHand"), SLOT_OF_INV[inv]
    if inv == 17:
        return ("ItemDamageTwoHandCaster" if caster else "ItemDamageTwoHand"), "twoHand"
    if inv in (15, 26):
        if sub in (2, 3, 18):
            return "ItemDamageRanged", "ranged"
        if sub == 19:
            return "ItemDamageWand", "wand"
    if inv == 25 and sub == 16:
        return "ItemDamageThrown", "thrown"
    return None


def _dps_row(db, table, item_level):
    idx = db.__dict__.setdefault("_dmg_idx", {})
    if table not in idx:
        idx[table] = {I(r["ItemLevel"]): r for r in db.rows(table)}
    return idx[table].get(item_level)


def damage_from_dps(dps, delay_ms, variance):
    avg = dps * delay_ms / 1000.0
    lo = math.floor(avg * (1 - variance / 2) + 1e-9)
    hi = math.floor(avg * (1 + variance / 2) + 0.5 + 1e-9)
    return lo, hi


def weapon_damage(db, sparse, item):
    """-> (min, max, table) computed from ItemDamage tables, or None if unsupported/no row."""
    tn = damage_table_name(sparse, item)
    if tn is None:
        return None
    table = tn[0]
    row = _dps_row(db, table, I(sparse["ItemLevel"]))
    if row is None:
        return None
    q = I(sparse["OverallQualityID"])
    dps = F(row["Quality_%d" % q])
    lo, hi = damage_from_dps(dps, I(sparse["ItemDelay"]), F(sparse["DmgVariance"]))
    return lo, hi, table


def _stat_name(stat, report):
    n = C.STAT_NAMES.get(stat)
    if n is None:
        n = "stat_%d" % stat
        report["unknownStatIds"].add(stat)
    return n


def item_stats(db, sparse, report):
    """Forever stats from StatPercentEditor x RandPropPoints."""
    inv = I(sparse["InventoryType"])
    slot = C.RPP_SLOT.get(inv)
    if slot is None:
        return []
    rpp = db.by_id("RandPropPoints").get(sparse["ItemLevel"])
    if rpp is None:
        return []
    col = "%sF_%d" % (_quality_key(I(sparse["OverallQualityID"])), slot)
    budget = F(rpp[col])
    out = []
    for k in range(10):
        stat = I(sparse["StatModifier_bonusStat_%d" % k])
        alloc = I(sparse["StatPercentEditor_%d" % k])
        if stat > 0 and alloc != 0:
            out.append({"stat": stat, "name": _stat_name(stat, report),
                        "value": rhu(alloc * budget / 10000.0)})
    out.sort(key=lambda s: s["stat"])
    return out


def _era_stats(era_row, report):
    out = []
    for k in range(10):
        stat = I(era_row["StatModifier_bonusStat_%d" % k])
        amt = I(era_row["StatModifier_bonusAmount_%d" % k])
        if stat > 0 and amt != 0:
            out.append({"stat": stat, "name": _stat_name(stat, report), "value": amt})
    for r, stat in C.ERA_RESISTANCE_STAT.items():
        v = I(era_row["Resistances_%d" % r])
        if v:
            out.append({"stat": stat, "name": _stat_name(stat, report), "value": v})
    out.sort(key=lambda s: s["stat"])
    return out


def _filter_reason(name, sub, item_level, req_level, delay):
    if C.WEAPON_NAME_FILTER.search(name):
        return "nameFilter"
    if sub in C.EXCLUDED_WEAPON_SUBCLASSES:
        return "subclassExcluded"
    if item_level <= 1:
        return "itemLevel<=1"
    if req_level > 60:
        return "requiredLevel>60"
    if delay == 0:
        return "noDelay"
    return None


def build_weapons(db, era_db, overrides, icons, report):
    """-> (weapons, ammo). Mutates report (weaponFilters, unknownStatIds, manualValidation)."""
    sparse = db.by_id("ItemSparse")
    items = db.by_id("Item")
    filters = report.setdefault("weaponFilters", {})
    report.setdefault("unknownStatIds", set())
    era = era_db.by_id("ItemSparse") if era_db is not None else {}

    def bump(reason):
        filters[reason] = filters.get(reason, 0) + 1

    def bonus_from_era(wid):
        er = era.get(str(wid))
        if er is not None and I(er["MaxDamage_1"]) > 0:
            return {"min": I(er["MinDamage_1"]), "max": I(er["MaxDamage_1"]), "school": None,
                    "source": "classic_era"}
        return None

    weapons = {}
    for iid, item in items.items():
        if I(item["ClassID"]) != 2:
            continue
        wid = I(iid)
        sp = sparse.get(iid)
        if sp is not None:
            name = sp["Display_lang"]
            sub = I(item["SubclassID"])
            reason = _filter_reason(name, sub, I(sp["ItemLevel"]), I(sp["RequiredLevel"]), I(sp["ItemDelay"]))
            if reason:
                bump(reason)
                continue
            tn = damage_table_name(sp, item)
            if tn is None:
                bump("unsupportedType")
                continue
            dmg = weapon_damage(db, sp, item)
            if dmg is None:
                bump("noDamageRow")
                continue
            lo, hi, table = dmg
            if hi == 0:
                bump("zeroDamage")
                continue
            delay = I(sp["ItemDelay"])
            stats = item_stats(db, sp, report)
            rec = _weapon_record(wid, name, sp, item, tn[1], sub, delay, lo, hi, table, stats, icons,
                                 "forever")
        elif era:
            er = era.get(iid)
            if er is None or I(er["MaxDamage_0"]) <= 0:
                continue
            name = er["Display_lang"]
            sub = I(item["SubclassID"])
            reason = _filter_reason(name, sub, I(er["ItemLevel"]), I(er["RequiredLevel"]), I(er["ItemDelay"]))
            if reason:
                bump(reason)
                continue
            tn = damage_table_name(er, item)
            if tn is None:
                bump("unsupportedType")
                continue
            rec = _weapon_record(wid, name, er, item, tn[1], sub, I(er["ItemDelay"]), I(er["MinDamage_0"]),
                                 I(er["MaxDamage_0"]), None, _era_stats(er, report), icons, "classic_era")
        else:
            continue
        b = bonus_from_era(wid)
        if b:
            rec["bonusDamage"] = b
        weapons[wid] = rec

    # manual overrides last
    for sid, ov in (overrides.get("weapons") or {}).items():
        wid = I(sid)
        w = weapons.get(wid)
        if w is None:
            report["manualValidation"].append({"file": "weapon-overrides.json", "id": sid,
                                               "problem": "weapon id not in output"})
            continue
        if "bonusDamage" in ov:
            cur = w.get("bonusDamage")
            od = ov["bonusDamage"]
            if cur is None:
                w["bonusDamage"] = {"min": od["min"], "max": od["max"], "school": od.get("school"),
                                    "source": "manual"}
            else:
                cur["school"] = od.get("school", cur["school"])
    # keep key order stable: bonusDamage sits after damageTable
    out = []
    for wid in sorted(weapons):
        w = weapons[wid]
        out.append(_ordered(w))

    ammo = _build_ammo(db, icons)
    return out, ammo


_ORDER = ["id", "name", "quality", "itemLevel", "requiredLevel", "inventoryType", "slot", "subclass",
          "weaponType", "speedMs", "min", "max", "dps", "damageTable", "bonusDamage", "stats",
          "allowableClass", "allowableRace", "bonding", "icon", "iconFileId", "source"]


def _ordered(w):
    return {k: w[k] for k in _ORDER if k in w}


def _weapon_record(wid, name, sp, item, slot, sub, delay, lo, hi, table, stats, icons, source):
    dps = num(rhu((lo + hi) / 2.0 / (delay / 1000.0) * 10) / 10.0)
    fid = I(item["IconFileDataID"])
    return {
        "id": wid, "name": name, "quality": I(sp["OverallQualityID"]), "itemLevel": I(sp["ItemLevel"]),
        "requiredLevel": I(sp["RequiredLevel"]), "inventoryType": I(sp["InventoryType"]), "slot": slot,
        "subclass": sub, "weaponType": C.WEAPON_TYPE_NAMES.get(sub, "subclass_%d" % sub),
        "speedMs": delay, "min": lo, "max": hi, "dps": dps, "damageTable": table, "stats": stats,
        "allowableClass": I(sp["AllowableClass"]),
        "allowableRace": [I(sp["AllowableRace_0"]), I(sp["AllowableRace_1"])],
        "bonding": I(sp["Bonding"]), "icon": icons.resolve(fid, "item", wid), "iconFileId": fid,
        "source": source,
    }


def _build_ammo(db, icons):
    sparse = db.by_id("ItemSparse")
    ammo = []
    for iid, item in db.by_id("Item").items():
        if I(item["ClassID"]) != 6:
            continue
        sp = sparse.get(iid)
        if sp is None or I(sp["InventoryType"]) != C.INV_AMMO:
            continue
        sub = I(item["SubclassID"])
        if sub not in (2, 3):
            continue
        name = sp["Display_lang"]
        if C.WEAPON_NAME_FILTER.search(name):
            continue
        row = _dps_row(db, "ItemDamageAmmo", I(sp["ItemLevel"]))
        if row is None:
            continue
        dps = F(row["Quality_%d" % I(sp["OverallQualityID"])])
        ammo.append({"id": I(iid), "name": name, "quality": I(sp["OverallQualityID"]),
                     "itemLevel": I(sp["ItemLevel"]), "requiredLevel": I(sp["RequiredLevel"]),
                     "subclass": sub, "dps": num(rhu(dps * 100) / 100.0),
                     "icon": icons.name(I(item["IconFileDataID"]))})
    ammo.sort(key=lambda a: a["id"])
    return ammo
