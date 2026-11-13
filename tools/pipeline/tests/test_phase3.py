"""Phase 3 pipeline additions: proficiencies, race/class combos, talent effects, equip/form requirements, manual checks."""
import json
import os
import shutil
import tempfile
import unittest

from ._fixtures import MANUAL, RAW, build_dir, load, needs_raw

TOKENS = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]


def talent(out, token, name):
    for s in load(out, "talents/%s.json" % token)["specs"]:
        for t in s["talents"]:
            if t["name"] == name:
                return t
    raise KeyError(name)


@needs_raw
class TestPhase3(unittest.TestCase):
    def setUp(self):
        self.d = build_dir()

    def test_classes_combos_and_proficiencies(self):
        c = {k["token"]: k for k in load(self.d, "classes.json")["classes"]}
        self.assertEqual(c["warrior"]["raceIds"], [1, 2, 3, 4, 5, 6, 7, 8])
        self.assertEqual(c["paladin"]["raceIds"], [1, 3, 5])
        self.assertEqual(c["shaman"]["raceIds"], [2, 3, 6, 8])
        self.assertEqual(c["druid"]["raceIds"], [4, 6])
        self.assertEqual(c["priest"]["weaponSubclasses"], [4, 10, 15, 19])
        self.assertEqual(c["rogue"]["weaponSubclasses"], [0, 2, 3, 4, 7, 13, 15, 16, 18])
        self.assertEqual(c["druid"]["weaponSubclasses"], [4, 5, 6, 10, 13, 15])
        self.assertEqual([t for t in TOKENS if c[t]["dualWield"]], ["warrior", "hunter", "rogue"])

    def test_talent_effects_parallel_to_values(self):
        for tok in TOKENS:
            for s in load(self.d, "talents/%s.json" % tok)["specs"]:
                for t in s["talents"]:
                    self.assertEqual(len(t["effects"]), len(t["valueSources"]), t["name"])
                    for r in t["ranks"]:
                        self.assertEqual(len(r["values"]), len(t["effects"]), t["name"])
                    self.assertIn("equipped", t)
                    self.assertIn("shapeshiftMask", t)

    def test_requirements(self):
        self.assertEqual(talent(self.d, "warrior", "Furious Precision")["equipped"],
                         {"itemClass": 2, "subclassMask": 41105, "invTypeMask": 4194304})
        self.assertEqual(talent(self.d, "warrior", "Cruelty")["equipped"]["subclassMask"], 173555)
        self.assertEqual(talent(self.d, "warrior", "Bastion")["equipped"]["itemClass"], 4)
        self.assertEqual(talent(self.d, "druid", "Sharpened Claws")["shapeshiftMask"], 145)
        am = talent(self.d, "mage", "Arcane Mind")
        self.assertIsNone(am["equipped"])
        self.assertEqual(am["shapeshiftMask"], 0)
        self.assertEqual(am["effects"][0], {"index": 0, "effect": 6, "aura": 137, "misc": [0, 8],
                                            "mask": [0, 0, 0, 0], "targets": [1, 0]})
        spells = load(self.d, "spells.json")["spells"]
        self.assertTrue(all("equipped" in s and "shapeshiftMask" in s for s in spells))

    def test_manual_values_match_spell_effects(self):
        self.assertEqual(load(self.d, "report.json")["manualValidation"], [])
        self.assertEqual(load(self.d, "manifest.json")["pipelineVersion"], 4)


@needs_raw
class TestManualValidation(unittest.TestCase):
    def test_wrong_buff_value_is_reported(self):
        from pipeline.db2 import RawDB
        from pipeline.manual import validate_manual
        with tempfile.TemporaryDirectory() as td:
            for fn in os.listdir(MANUAL):
                shutil.copy(os.path.join(MANUAL, fn), td)
            p = os.path.join(td, "buffs.json")
            with open(p, encoding="utf-8") as f:
                b = json.load(f)
            bs = next(x for x in b["buffs"] if x["id"] == "battle_shout")
            bs["effects"][0]["value"] = 232
            with open(p, "w", encoding="utf-8") as f:
                json.dump(b, f)
            report = {}
            validate_manual(td, RawDB(RAW), report)
            probs = report["manualValidation"]
            self.assertEqual(len(probs), 1)
            self.assertEqual(probs[0]["id"], "battle_shout")
            self.assertIn("!= SpellEffect 139", probs[0]["problem"])
