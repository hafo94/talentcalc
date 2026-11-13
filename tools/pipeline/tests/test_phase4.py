"""Phase 4 pipeline additions: per-class spell files and the seal -> judgement closure."""
import unittest

from ._fixtures import build_dir, load, needs_raw

TOKENS = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]


@needs_raw
class TestPhase4(unittest.TestCase):
    def setUp(self):
        self.d = build_dir()

    def test_class_spell_files_partition_spells_json(self):
        full = load(self.d, "spells.json")
        ids = set()
        for tok in TOKENS:
            f = load(self.d, "spells/%s.json" % tok)
            self.assertEqual(f["token"], tok)
            self.assertTrue(all(f["classId"] in s["classIds"] for s in f["spells"]), tok)
            self.assertTrue(all(c["classId"] == f["classId"] for c in f["abilities"]), tok)
            ids |= {s["id"] for s in f["spells"]}
        self.assertEqual(ids, {s["id"] for s in full["spells"]})
        self.assertEqual(len(full["spells"]), 2340)

    def test_judgement_closure(self):
        pal = {s["id"]: s for s in load(self.d, "spells/paladin.json")["spells"]}
        # Seal of Command r5 (20920) -> DUMMY 20968 "Judgement of Command" -> DUMMY 20966 (356 Holy, coef 0.429)
        self.assertIn(20968, pal)
        jc = pal[20966]
        self.assertEqual(jc["name"], "Judgement of Command")
        self.assertEqual([(e["effect"], e["base"], e["spCoef"]) for e in jc["effects"]], [(2, 356, 0.429)])
        self.assertIn(20286, pal)  # Judgement of Righteousness
        self.assertNotIn(707, pal)  # Seal of Fury DUMMY base 707 (Immolate) is a number, not a judgement
        self.assertEqual(load(self.d, "manifest.json")["pipelineVersion"], 4)


if __name__ == "__main__":
    unittest.main()
