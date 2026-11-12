import unittest

from ._fixtures import needs_raw, talents, talent_by_node

SPEC_NAMES = {
    "mage": ["Arcane", "Fire", "Frost"], "druid": ["Balance", "Feral Combat", "Restoration"],
    "hunter": ["Beast Mastery", "Marksmanship", "Survival"], "paladin": ["Holy", "Protection", "Retribution"],
    "priest": ["Discipline", "Holy", "Shadow"], "rogue": ["Assassination", "Combat", "Subtlety"],
    "shaman": ["Elemental", "Enhancement", "Restoration"], "warlock": ["Affliction", "Demonology", "Destruction"],
    "warrior": ["Arms", "Fury", "Protection"],
}
COUNTS = {
    "mage": [(18, 45), (17, 46), (18, 48)], "druid": [(15, 44), (19, 49), (16, 51)],
    "hunter": [(16, 44), (16, 54), (16, 45)], "paladin": [(15, 39), (17, 49), (16, 42)],
    "priest": [(16, 43), (17, 48), (15, 42)], "rogue": [(16, 41), (18, 46), (18, 43)],
    "shaman": [(16, 46), (18, 51), (16, 51)], "warlock": [(16, 41), (19, 50), (16, 50)],
    "warrior": [(16, 40), (15, 45), (16, 42)],
}
CAPSTONES = {
    "mage": ["Arcane Power", "Combustion", "Ice Barrier"], "druid": ["Moonkin Form", "Primal Bite", "Wild Growth"],
    "hunter": ["Bestial Wrath", "Sniper Shot", "Lacerating Strikes"],
    "paladin": ["Light's Vigil", "Shieldsworn", "Unsealed Wrath"],
    "priest": ["Power Infusion", "Prayer of Mending", "Shadowform"],
    "rogue": ["Mutilate", "Adrenaline Rush", "Death Mark"],
    "shaman": ["Lightning Mastery", "Rage of the Farseer", "Riptide"],
    "warlock": ["Wrack", "Demonic Pact", "Incinerate"], "warrior": ["Mortal Strike", "Bloodthirst", "Shield Slam"],
}
PLACEMENTS = [  # nodeId, name, class token, spec, tier, col, maxRank|None, requiredPoints|None
    (105792, "Impact", "mage", 1, 2, 2, 3, 5),
    (105794, "Ignite", "mage", 1, 2, 0, 5, None),
    (105790, "Pyroblast", "mage", 1, 3, 2, 1, None),
    (105797, "Improved Fire Blast", "mage", 1, 3, 3, 2, None),
    (105784, "Critical Mass", "mage", 1, 5, 1, 3, None),
    (105782, "Fire Power", "mage", 1, 6, 2, 3, None),
    (105798, "Arcane Power", "mage", 0, 7, 1, None, 30),
    (105778, "Precision", "mage", 2, 1, 2, 3, None),
    (104982, "Lightning Reflexes", "hunter", 2, 6, 2, 5, 25),
    (105003, "Improved Serpent Sting", "hunter", 1, 4, 3, None, None),
    (105865, "Holy Specialization", "priest", 1, 1, 2, 5, None),
]


@needs_raw
class TestTalents(unittest.TestCase):
    def setUp(self):
        self.out, self.report = talents()
        self.by_token = {f["token"]: f for f in self.out.values()}

    def test_classes_and_specs(self):
        self.assertEqual(len(self.out), 9)
        total = 0
        for tok, f in self.by_token.items():
            self.assertEqual(len(f["specs"]), 3)
            self.assertEqual([s["name"] for s in f["specs"]], SPEC_NAMES[tok])
            self.assertEqual([(s["nodeCount"], s["maxPoints"]) for s in f["specs"]], COUNTS[tok])
            for s, cap in zip(f["specs"], CAPSTONES[tok]):
                t7 = [t["name"] for t in s["talents"] if t["tier"] == 7]
                self.assertEqual(t7, [cap])
                total += s["nodeCount"]
        self.assertEqual(total, 447)

    def test_hidden(self):
        for f in self.out.values():
            for s in f["specs"]:
                for t in s["talents"]:
                    self.assertNotIn("hidden", t)
        self.assertEqual(len(self.report["hiddenNodes"]), 23)
        ids = {t["nodeId"] for f in self.out.values() for s in f["specs"] for t in s["talents"]}
        for n in (110859, 110855, 110870):
            self.assertNotIn(n, ids)
        self.assertEqual(len(self.by_token["hunter"]["specs"]), 3)

    def test_placements(self):
        for nid, name, tok, spec, tier, col, mr, req in PLACEMENTS:
            f, si, s, t = talent_by_node(nid)
            self.assertEqual(f["token"], tok, nid)
            self.assertEqual((si, t["tier"], t["col"]), (spec, tier, col), name)
            self.assertEqual(t["name"], name)
            if mr is not None:
                self.assertEqual(t["maxRank"], mr, name)
            if req is not None:
                self.assertEqual(t["requiredPoints"], req, name)

    def test_prereqs(self):
        exp = {104961: 104964, 104964: 104970, 104928: 104927, 105825: 105826, 104989: 104986, 105798: 105801}
        for nid, pre in exp.items():
            t = talent_by_node(nid)[3]
            self.assertEqual(t.get("prereqNodeId"), pre, nid)
        count = 0
        by_id = {}
        for f in self.out.values():
            for s in f["specs"]:
                for t in s["talents"]:
                    by_id[t["nodeId"]] = t
        for t in by_id.values():
            if "prereqNodeId" in t:
                count += 1
                self.assertLessEqual(by_id[t["prereqNodeId"]]["tier"], t["tier"])
        self.assertEqual(count, 69)

    def test_position_fixes(self):
        fixes = {p["nodeId"]: p for p in self.report["positionFixes"]}
        self.assertEqual(fixes[104982]["method"], "twin")
        self.assertEqual(fixes[105865]["method"], "twin")
        self.assertEqual(set(p["nodeId"] for p in self.report["posYInconsistent"]), {105003, 104982, 105865})
        self.assertEqual(set(a["nodeId"] for a in self.report["gateScopeAnomalies"]), {105003, 105865})

    def test_no_choices_and_layout(self):
        for f in self.out.values():
            for s in f["specs"]:
                seen = set()
                keys = []
                tiers = set()
                for t in s["talents"]:
                    self.assertNotIn("choices", t)
                    k = (t["tier"], t["col"])
                    self.assertNotIn(k, seen)
                    seen.add(k)
                    keys.append(k)
                    tiers.add(t["tier"])
                self.assertEqual(keys, sorted(keys))
                self.assertEqual(tiers, set(range(1, 8)))

    def test_include_hidden(self):
        out, report = talents(include_hidden=True)
        n = sum(len(s["talents"]) for f in out.values() for s in f["specs"])
        self.assertEqual(n, 447 + 23)
        hidden = [t for f in out.values() for s in f["specs"] for t in s["talents"] if t.get("hidden")]
        self.assertEqual(len(hidden), 23)


if __name__ == "__main__":
    unittest.main()
