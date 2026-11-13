"""Phase 6 pipeline additions: pets/<owner>.json (pet families, demons, their abilities, passives and spells)."""
import unittest

from ._fixtures import build_dir, load, needs_raw


@needs_raw
class TestPhase6(unittest.TestCase):
    def setUp(self):
        self.d = build_dir()
        self.hunter = load(self.d, "pets/hunter.json")
        self.warlock = load(self.d, "pets/warlock.json")

    def pet(self, f, name):
        return next(p for p in f["pets"] if p["name"] == name)

    def spell(self, f, sid):
        return next(s for s in f["spells"] if s["id"] == sid)

    def test_owners_and_families(self):
        self.assertEqual((self.hunter["token"], self.hunter["classId"]), ("hunter", 3))
        self.assertEqual((self.warlock["token"], self.warlock["classId"]), ("warlock", 9))
        self.assertEqual(len(self.hunter["pets"]), 19)
        self.assertEqual([p["name"] for p in self.warlock["pets"]],
                         ["Felhunter", "Voidwalker", "Succubus", "Imp", "Incubus"])
        self.assertEqual([p["id"] for p in self.hunter["pets"] if p["exotic"]], [312])  # Core Hound
        skipped = {s["name"] for s in load(self.d, "report.json")["petsSkipped"]}
        self.assertEqual(skipped, {"Doomguard", "Remote Control", "Felguard"})
        m = load(self.d, "manifest.json")["counts"]
        self.assertEqual((m["pets"], m["petSpells"]), (24, len(self.hunter["spells"]) + len(self.warlock["spells"])))

    def test_cat_abilities_and_passives(self):
        cat = self.pet(self.hunter, "Cat")
        abil = {a["name"]: a["ranks"] for a in cat["abilities"]}
        self.assertEqual(sorted(abil), ["Bite", "Claw", "Dash", "Prowl"])
        self.assertEqual(abil["Claw"][-1], 3009)   # rank 8, level 56: 51 physical damage (variance 0.3137)
        self.assertEqual(abil["Bite"][-1], 17261)  # rank 8, level 56: 90, 10 s cooldown, 35 focus
        claw = self.spell(self.hunter, 3009)
        self.assertEqual([(e["effect"], e["base"]) for e in claw["effects"]], [(2, 51)])
        self.assertEqual((claw["costs"][0]["powerType"], claw["costs"][0]["amount"], claw["defenseType"]), (2, 25, 2))
        self.assertEqual(cat["passives"], [8875, 17210, 19580, 19581, 19582, 19589, 19591, 20782, 20784, 409365, 415429])
        fam = self.spell(self.hunter, 17210)  # Cat family passive: +10% physical damage
        self.assertEqual([(e["aura"], e["base"], e["misc"][0]) for e in fam["effects"]][0], (79, 10, 1))
        frenzy = self.spell(self.hunter, 19615)  # triggered by 20784 (talent Frenzy): +30% melee haste, 8 s
        self.assertEqual(([(e["aura"], e["base"]) for e in frenzy["effects"]], frenzy["duration"]["ms"]), ([(319, 30)], 8000))

    def test_demons_and_owner_auras(self):
        imp = self.pet(self.warlock, "Imp")
        fb = next(a for a in imp["abilities"] if a["name"] == "Firebolt")["ranks"]
        self.assertEqual(fb[-1], 11763)
        s = self.spell(self.warlock, 11763)
        e0 = s["effects"][0]
        self.assertEqual((e0["effect"], e0["base"], e0["perLevel"], e0["spCoef"], s["castMs"]), (2, 44, 0.6, 0.571, 2000))
        self.assertEqual(s["family"]["set"], 5)
        for sid, school in ((18789, 32), (18791, 4), (23759, 4), (23761, 32), (25228, 127)):
            e = self.spell(self.warlock, sid)["effects"][0]
            self.assertEqual((e["aura"], e["misc"][0]), (79, school), sid)
        self.assertEqual(self.spell(self.warlock, 18789)["effects"][0]["base"], 15)  # Burning Shadow (Imp sacrifice)


if __name__ == "__main__":
    unittest.main()
