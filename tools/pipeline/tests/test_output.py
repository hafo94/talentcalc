import json
import os
import tempfile
import unittest

from ._fixtures import BUILD, ERA_RAW, MANUAL, RAW, build_dir, load, needs_raw

FILES = ["manifest.json", "classes.json", "spells.json", "weapons.json", "targets.json", "pet-families.json",
         "coverage.json", "report.json"]
TOKENS = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]


def read_all(d):
    out = {}
    for root, _, files in os.walk(d):
        for f in files:
            p = os.path.join(root, f)
            with open(p, "rb") as fh:
                out[os.path.relpath(p, d)] = fh.read()
    return out


@needs_raw
class TestOutput(unittest.TestCase):
    def setUp(self):
        self.d = build_dir()

    def test_files_exist_and_parse(self):
        for f in FILES + ["talents/%s.json" % t for t in TOKENS]:
            p = os.path.join(self.d, f)
            self.assertTrue(os.path.isfile(p), f)
            load(self.d, f)

    def test_manifest(self):
        m = load(self.d, "manifest.json")
        self.assertEqual(m["build"], BUILD)
        self.assertEqual(m["generatedAt"], "2000-01-01")
        names = [t["name"] for t in m["rawTables"]]
        self.assertEqual(names, sorted(names))
        c = m["counts"]
        spells = load(self.d, "spells.json")
        weapons = load(self.d, "weapons.json")
        classes = load(self.d, "classes.json")
        self.assertEqual(c["spells"], len(spells["spells"]))
        self.assertEqual(c["abilityChains"], len(spells["abilities"]))
        self.assertEqual(c["weapons"], len(weapons["weapons"]))
        self.assertEqual(c["weaponsEraFallback"], sum(1 for w in weapons["weapons"] if w["source"] == "classic_era"))
        self.assertEqual(c["ammo"], len(weapons["ammo"]))
        self.assertEqual(c["classes"], len(classes["classes"]))
        self.assertEqual(c["specs"], 27)
        self.assertEqual(c["targetLevels"], len(load(self.d, "targets.json")["levels"]))
        self.assertEqual(c["petFamilies"], len(load(self.d, "pet-families.json")["families"]))
        n = 0
        for t in TOKENS:
            f = load(self.d, "talents/%s.json" % t)
            n += sum(len(s["talents"]) for s in f["specs"])
        self.assertEqual(c["talents"], n)
        self.assertEqual(n, 447)
        self.assertEqual(c["hiddenTalents"], 0)

    def test_classes(self):
        c = load(self.d, "classes.json")
        self.assertEqual(len(c["classes"]), 9)
        self.assertEqual(len(c["races"]), 8)
        self.assertEqual(c["talentCurrency"]["max"], 51)
        self.assertEqual(len(c["talentCurrency"]["sources"]), 56)
        perk = [s for s in c["talentCurrency"]["sources"] if "perk" in s]
        self.assertEqual(sorted(s["perk"]["rank"] for s in perk), [1, 2, 3, 4, 5])
        for s in perk:
            self.assertEqual(s["level"], 10 - s["perk"]["rank"])
            self.assertEqual(s["perk"]["name"], "Talented")
            self.assertEqual(s["perk"]["nodeId"], 110298)
        self.assertEqual(sum(s["amount"] for s in c["talentCurrency"]["sources"] if "perk" not in s), 51)
        self.assertTrue(all(s["level"] >= 10 for s in c["talentCurrency"]["sources"] if "perk" not in s))
        for k in c["classes"]:
            self.assertEqual(len(k["specs"]), 3)
            self.assertTrue(k["color"].startswith("#") and len(k["color"]) == 7)

    def test_coverage(self):
        cov = load(self.d, "coverage.json")
        self.assertEqual(cov["summary"]["total"], 447)
        self.assertEqual(len(cov["talents"]), 447)
        by = {t["spellId"]: t for t in cov["talents"]}
        for t in cov["talents"]:
            self.assertIn(t["class"], ("generic", "special", "unsupported"))
        self.assertEqual(by[11119]["class"], "special")
        self.assertEqual(by[11115]["class"], "generic")
        self.assertEqual(by[12042]["kind"], "ability")
        s = cov["summary"]
        self.assertEqual(s["generic"] + s["special"] + s["unsupported"], 447)

    def test_report(self):
        r = load(self.d, "report.json")
        self.assertEqual(len(r["hiddenNodes"]), 23)
        self.assertEqual(sorted(p["nodeId"] for p in r["positionFixes"]), [104982, 105865])
        self.assertEqual(sorted(p["nodeId"] for p in r["posYInconsistent"]), [104982, 105003, 105865])
        self.assertEqual(sorted(p["nodeId"] for p in r["gateScopeAnomalies"]), [105003, 105865])
        self.assertEqual(r["manualValidation"], [])

    def test_size(self):
        total = sum(len(v) for v in read_all(self.d).values())
        self.assertLess(total, 10 * 1024 * 1024)

    def test_determinism(self):
        from pipeline import build_data
        with tempfile.TemporaryDirectory() as td:
            out2 = os.path.join(td, "out")
            rc = build_data.main(["--build", BUILD, "--raw", RAW, "--out", out2, "--manual", MANUAL,
                                  "--date", "2000-01-01", "--era-raw", ERA_RAW])
            self.assertEqual(rc, 0)
            a, b = read_all(self.d), read_all(out2)
            self.assertEqual(sorted(a), sorted(b))
            for k in a:
                self.assertEqual(a[k], b[k], k)

    def test_include_hidden_build(self):
        d = build_dir(include_hidden=True)
        m = load(d, "manifest.json")
        self.assertTrue(m["options"]["includeHiddenNodes"])
        self.assertEqual(m["counts"]["hiddenTalents"], 23)
        self.assertEqual(m["counts"]["talents"], 447 + 23)

    def test_no_era_fallback(self):
        d = build_dir(era=False)
        m = load(d, "manifest.json")
        self.assertIsNone(m["eraBuild"])
        self.assertEqual(m["counts"]["weaponsEraFallback"], 0)


if __name__ == "__main__":
    unittest.main()
