import unittest

from pipeline import constants as C
from pipeline.db2 import RawDB
from pipeline.items import weapon_damage
from pipeline.util import F, I

from ._fixtures import ERA_RAW, RAW, needs_era, needs_raw, weapons


def stats(w):
    return {s["stat"]: s["value"] for s in w["stats"]}


@needs_raw
class TestItems(unittest.TestCase):
    def setUp(self):
        w, self.ammo, self.report = weapons()
        self.by = {x["id"]: x for x in w}
        self.all = w

    def test_known_weapons(self):
        w = self.by[17182]
        self.assertEqual((w["min"], w["max"], w["speedMs"]), (223, 372, 3700))
        self.assertEqual((w["damageTable"], w["slot"], w["source"]), ("ItemDamageTwoHand", "twoHand", "forever"))
        self.assertEqual(stats(w), {4: 12, 7: 12, 51: 30})
        w = self.by[19019]
        self.assertEqual((w["min"], w["max"], w["speedMs"], w["slot"]), (82, 153, 1900, "oneHand"))
        self.assertEqual(stats(w), {3: 5, 7: 8, 51: 8, 55: 9})
        b = w["bonusDamage"]
        self.assertEqual((b["min"], b["max"], b["school"]), (16, 30, "nature"))
        w = self.by[18713]
        self.assertEqual((w["min"], w["max"], w["damageTable"], w["slot"]), (89, 166, "ItemDamageRanged", "ranged"))
        self.assertEqual(stats(w), {32: 14, 39: 17})
        w = self.by[12784]
        self.assertEqual((w["min"], w["max"]), (153, 256))
        self.assertEqual(stats(w)[7], 13)

    def test_ammo(self):
        a = {x["id"]: x for x in self.ammo}
        self.assertEqual(a[18042]["dps"], 17.71)

    def test_filters_and_counts(self):
        for w in self.all:
            self.assertIsNone(C.WEAPON_NAME_FILTER.search(w["name"]), w["name"])
            self.assertGreater(w["max"], 0)
        self.assertGreaterEqual(sum(1 for w in self.all if w["source"] == "forever"), 1000)
        self.assertEqual([w["id"] for w in self.all], sorted(w["id"] for w in self.all))


@needs_raw
@needs_era
class TestEraItems(unittest.TestCase):
    def setUp(self):
        w, _, _ = weapons()
        self.by = {x["id"]: x for x in w}

    def test_fallback(self):
        a = self.by[19364]
        self.assertEqual((a["min"], a["max"], a["speedMs"], a["source"]), (229, 344, 3500, "classic_era"))
        self.assertIsNone(a["damageTable"])
        b = self.by[19352]
        self.assertEqual((b["min"], b["max"], b["speedMs"]), (106, 198, 2600))

    def test_cross_validation(self):
        db, era = RawDB(RAW), RawDB(ERA_RAW)
        es = era.by_id("ItemSparse")
        items = db.by_id("Item")
        ok = total = 0
        for iid, sp in db.by_id("ItemSparse").items():
            item = items.get(iid)
            e = es.get(iid)
            if item is None or e is None or I(item["ClassID"]) != 2 or I(e["MaxDamage_0"]) <= 0:
                continue
            if C.WEAPON_NAME_FILTER.search(sp["Display_lang"]) or I(item["SubclassID"]) in C.EXCLUDED_WEAPON_SUBCLASSES:
                continue
            if I(sp["ItemLevel"]) <= 1 or I(sp["RequiredLevel"]) > 60 or I(sp["ItemDelay"]) == 0:
                continue
            if not (sp["ItemLevel"] == e["ItemLevel"] and sp["OverallQualityID"] == e["OverallQualityID"]
                    and sp["ItemDelay"] == e["ItemDelay"] and F(sp["DmgVariance"]) == F(e["DmgVariance"])):
                continue
            d = weapon_damage(db, sp, item)
            if d is None:
                continue
            total += 1
            if (d[0], d[1]) == (I(e["MinDamage_0"]), I(e["MaxDamage_0"])):
                ok += 1
        self.assertGreater(total, 500)
        self.assertGreaterEqual(ok / total, 0.97, "%d/%d" % (ok, total))


if __name__ == "__main__":
    unittest.main()
