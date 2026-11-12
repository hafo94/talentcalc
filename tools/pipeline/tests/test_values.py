import unittest

from ._fixtures import needs_raw, talents, talent_by_node


def vals(node, effect=0):
    t = talent_by_node(node)[3]
    return [r["values"][effect] for r in t["ranks"]]


@needs_raw
class TestValues(unittest.TestCase):
    def test_curves(self):
        self.assertEqual(vals(105792), [3, 7, 10])
        self.assertEqual(talent_by_node(105792)[3]["valueSources"][0], "curve")
        self.assertEqual(vals(104982), [3, 6, 9, 12, 15])
        self.assertEqual(vals(105784), [2, 4, 6])
        self.assertEqual(vals(105778), [2, 4, 6])
        self.assertEqual(vals(105794), [8, 16, 24, 32, 40])
        self.assertEqual(vals(105782), [1, 2, 3])
        self.assertEqual(vals(105797, 0), [-1000, -2000])
        self.assertEqual(vals(105797, 1), [8, 15])

    def test_barrage(self):
        f, si, s, t = talent_by_node(105001)
        self.assertEqual(t["spellId"], 19461)
        self.assertEqual(t["valueSources"][1], "base")
        self.assertEqual(vals(105001, 1), [15, 15, 15])
        _, report = talents()
        self.assertIn(105001, [x["nodeId"] for x in report["multiRankWithoutCurve"]])

    def test_descriptions(self):
        t = talent_by_node(105792)[3]
        self.assertEqual(t["ranks"][1]["description"],
                         "Gives your Fire spells a 7% chance to stun the target for 2 sec.")
        t = talent_by_node(105782)[3]
        self.assertEqual(t["ranks"][2]["description"],
                         "Increases the damage done by your Fire spells by 3% per your Fire effects on the "
                         "target, up to a maximum increase of 12%. Effects which mix multiple schools of magic "
                         "do not qualify.")
        t = talent_by_node(105797)[3]
        self.assertEqual(t["ranks"][0]["description"],
                         "Reduces the cooldown of your Fire Blast spell by 1 sec and increases its range by 8 yards.")
        t = talent_by_node(104982)[3]
        self.assertEqual(t["ranks"][4]["description"], "Increases your Agility by 15%.")

    def test_rank_lengths(self):
        out, _ = talents()
        for f in out.values():
            for s in f["specs"]:
                for t in s["talents"]:
                    self.assertEqual(len(t["ranks"]), t["maxRank"])


if __name__ == "__main__":
    unittest.main()
