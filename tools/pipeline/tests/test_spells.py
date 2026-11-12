import unittest

from pipeline.util import rhu

from ._fixtures import needs_raw, spells, talents

FIREBALL = "Hurls a fiery ball that causes 14 to 22 Fire damage and an additional 2 Fire damage over 4 sec."


@needs_raw
class TestSpells(unittest.TestCase):
    def setUp(self):
        self.recs, self.chains, self.seeds, self.report = spells()
        from pipeline.db2 import RawDB
        from ._fixtures import RAW
        self.names = RawDB(RAW).by_id("SpellName")

    def test_counts_and_closure(self):
        self.assertTrue(2200 <= len(self.recs) <= 2600, len(self.recs))
        out, _ = talents()
        for f in out.values():
            for s in f["specs"]:
                for t in s["talents"]:
                    self.assertIn(t["spellId"], self.recs)
        for r in self.recs.values():
            for e in r["effects"]:
                t = e.get("triggerSpell")
                if t and str(t) in self.names:
                    self.assertIn(t, self.recs, "trigger %d of spell %d not exported" % (t, r["id"]))

    def test_fireball(self):
        r = self.recs[133]
        self.assertEqual(r["rank"], 1)
        self.assertEqual(r["castMs"], 1500)
        self.assertEqual(r["gcdMs"], 1500)
        self.assertEqual(r["duration"]["ms"], 4000)
        self.assertEqual(r["range"]["max"], 35)
        self.assertEqual(r["school"], 4)
        self.assertEqual(r["family"]["set"], 3)
        self.assertEqual(r["family"]["mask"][0], 1073741825)
        self.assertEqual(r["costs"][0]["powerType"], 0)
        self.assertEqual(r["costs"][0]["amount"], 30)
        e = r["effects"][0]
        self.assertEqual(e["effect"], 2)
        self.assertEqual(e["base"], 18)
        self.assertLess(abs(e["spCoef"] - 0.429), 1e-3)
        self.assertLess(abs(e["perLevel"] - 0.2), 1e-3)
        self.assertEqual(rhu(18 * (1 - e["variance"] / 2)), 14)
        self.assertEqual(rhu(18 * (1 + e["variance"] / 2)), 22)
        self.assertEqual(r["description"], FIREBALL)

    def test_high_rank_and_costs(self):
        r = self.recs[10151]
        self.assertEqual(r["rank"], 11)
        self.assertEqual(r["castMs"], 3500)
        self.assertEqual(r["effects"][0]["base"], 451)
        self.assertEqual(r["levels"]["base"], 60)
        c = self.recs[78]["costs"][0]
        self.assertEqual((c["powerType"], c["amount"]), (1, 15))
        c = self.recs[1752]["costs"][0]
        self.assertEqual((c["powerType"], c["amount"]), (3, 45))

    def test_chains(self):
        ch = [c for c in self.chains if c["classId"] == 8 and c["name"] == "Fireball"]
        self.assertEqual(len(ch), 1)
        self.assertEqual(ch[0]["ranks"], [133, 143, 145, 3140, 8400, 8401, 8402, 10148, 10149, 10150, 10151, 25306])
        for c in self.chains:
            self.assertNotIn(401556, c["ranks"])
            self.assertNotIn(400613, c["ranks"])
            self.assertNotEqual(c["skillLineId"], 2851)
        self.assertIn(401556, self.report["excludedRuneSpells"])

    def test_shapes(self):
        for r in self.recs.values():
            self.assertEqual(len(r["attributes"]), 17)
            for a in r["attributes"]:
                self.assertTrue(0 <= a < 2 ** 32)
            for e in r["effects"]:
                for v in e["mask"]:
                    self.assertTrue(0 <= v < 2 ** 32)

    def test_passive(self):
        self.assertFalse(self.recs[11366]["passive"])
        self.assertTrue(self.recs[11115]["passive"])


if __name__ == "__main__":
    unittest.main()
