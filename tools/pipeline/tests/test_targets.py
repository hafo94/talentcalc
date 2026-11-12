import unittest

from pipeline.db2 import RawDB
from pipeline.targets import build_targets

from ._fixtures import RAW, needs_raw


@needs_raw
class TestTargets(unittest.TestCase):
    def setUp(self):
        self.t = build_targets(RawDB(RAW), "x")

    def test_levels(self):
        lv = {l["level"]: l for l in self.t["levels"]}
        self.assertEqual(len(lv), 63)
        self.assertEqual(lv[63]["armor"], 3731)
        self.assertEqual(lv[60]["armor"], 3566)
        self.assertEqual(lv[10]["armor"], 518)
        for l, r in lv.items():
            self.assertEqual(r["armorConstant"], 400 + 85 * l)

    def test_presets(self):
        p = {x["preset"]: x for x in self.t["byPlayerLevel"]["60"]}
        self.assertEqual((p["boss"]["level"], p["boss"]["armor"]), (63, 3731))
        self.assertEqual((p["elite"]["level"], p["elite"]["armor"]), (62, 3677))
        self.assertEqual((p["same"]["level"], p["same"]["armor"]), (60, 3566))
        self.assertEqual((p["lowArmorBoss"]["level"], p["lowArmorBoss"]["armor"]), (63, 1866))
        self.assertEqual((p["custom"]["level"], p["custom"]["armor"]), (63, 3731))
        self.assertEqual(set(self.t["byPlayerLevel"]), {str(i) for i in range(1, 61)})
        self.assertEqual([x["id"] for x in self.t["presets"] if x.get("default")], ["boss"])


if __name__ == "__main__":
    unittest.main()
