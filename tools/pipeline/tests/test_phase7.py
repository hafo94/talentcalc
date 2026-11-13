"""Phase 7: level data in data/manual (buff minLevel checked against SpellLevels / ItemSparse, level-1 base stats)."""
import copy
import json
import os
import unittest

from ._fixtures import MANUAL, RAW, needs_raw


def _manual(name):
    with open(os.path.join(MANUAL, name), encoding="utf-8") as f:
        return json.load(f)


@needs_raw
class TestPhase7(unittest.TestCase):
    def setUp(self):
        from pipeline.db2 import RawDB
        self.db = RawDB(RAW)

    def problems(self, buffs):
        from pipeline.manual import _check_min_level
        mv = []
        for d in buffs:
            _check_min_level(d, self.db, mv)
        return mv

    def test_buff_min_levels_match_the_data(self):
        buffs = _manual("buffs.json")["buffs"]
        self.assertEqual(self.problems(buffs), [])
        lv = {b["id"]: b.get("minLevel", 1) for b in buffs}
        self.assertEqual((lv["battle_shout"], lv["arcane_intellect"], lv["blessing_of_kings"]), (60, 56, 20))
        self.assertEqual((lv["sunder_armor"], lv["faerie_fire"], lv["curse_of_the_elements"]), (58, 54, 50))
        self.assertEqual((lv["elixir_of_the_mongoose"], lv["flask_of_the_titans"], lv["songflower"]), (46, 50, 1))

    def test_wrong_min_level_is_reported(self):
        buffs = copy.deepcopy([b for b in _manual("buffs.json")["buffs"]
                               if b["id"] in ("battle_shout", "elixir_of_the_mongoose")])
        for b in buffs:
            b["minLevel"] = 1
        self.assertEqual([p["problem"] for p in self.problems(buffs)],
                         ["minLevel 1 != SpellLevels.BaseLevel 60", "minLevel 1 != ItemSparse.RequiredLevel 46"])

    def test_level_one_base_stats_below_level_60(self):
        bs = _manual("base-stats.json")
        self.assertEqual(sorted(bs["level1"]["classes"]), sorted(bs["classes"]))
        for cls, one in bs["level1"]["classes"].items():
            for k, v in one.items():
                self.assertLessEqual(v, bs["classes"][cls][k], (cls, k))
        pets = _manual("pets.json")
        for owner in ("hunter", "warlock"):
            o = pets["owners"][owner]
            for k, v in o["level1"].items():
                self.assertLess(v, o["base"][k], (owner, k))
