import os
import unittest

from pipeline.db2 import RawDB, MissingTableError
from pipeline.util import rhu, num, fmt


class TestUtil(unittest.TestCase):
    def test_rhu(self):
        self.assertEqual(rhu(2.5), 3)
        self.assertEqual(rhu(-2.5), -3)
        self.assertEqual(rhu(1865.5), 1866)
        self.assertEqual(rhu(0.49), 0)

    def test_num_fmt(self):
        self.assertEqual(num(3.0), 3)
        self.assertEqual(num(0.1234567891), 0.123457)
        self.assertEqual(fmt(4.0), "4")
        self.assertEqual(fmt(1.25), "1.3")
        self.assertEqual(fmt(2.5), "2.5")

    def test_missing_table(self):
        with self.assertRaises(MissingTableError) as cm:
            RawDB("/nonexistent").rows("Nope")
        self.assertIn("fetch_db2.sh", str(cm.exception))


if __name__ == "__main__":
    unittest.main()


from pipeline.tooltips import SpellTextContext, render

FIREBALL_TPL = "Hurls a fiery ball that causes $s1 Fire damage and an additional $o2 Fire damage over $d."
FIREBALL_OUT = "Hurls a fiery ball that causes 14 to 22 Fire damage and an additional 2 Fire damage over 4 sec."


def ctx(effects, **kw):
    return SpellTextContext(effects, **kw)


class TestTooltips(unittest.TestCase):
    def test_fireball(self):
        c = ctx([{"base": 18, "variance": 0.4444444}, {"base": 1, "periodMs": 2000}], duration_ms=4000)
        text, unres = render(FIREBALL_TPL, c)
        self.assertEqual(text, FIREBALL_OUT)
        self.assertEqual(unres, [])

    def test_plural(self):
        c = ctx([])
        self.assertEqual(render("1 $lpoint:points;", c)[0], "1 point")
        self.assertEqual(render("2 $lpoint:points;", c)[0], "2 points")
        c = ctx([{"base": 1}])
        self.assertEqual(render("$s1 $lpoint:points;", c)[0], "1 point")
        c = ctx([{"base": 3}])
        self.assertEqual(render("$s1 $lpoint:points;", c)[0], "3 points")

    def test_expressions(self):
        self.assertEqual(render("${$s1*4}", ctx([{"base": 3}]))[0], "12")
        self.assertEqual(render("${$s1/-1000}", ctx([{"base": -2000}]))[0], "2")
        self.assertEqual(render("$s1", ctx([{"base": -40}]))[0], "40")
        self.assertEqual(render("${$s1/3}.1", ctx([{"base": 10}]))[0], "3.3")

    def test_conditionals_and_gender(self):
        self.assertEqual(render("$?a123[X][Y]", ctx([]))[0], "Y")
        self.assertEqual(render("$?a1[A]?s2[B][C] done", ctx([]))[0], "C done")
        self.assertEqual(render("$ghis:her; sword", ctx([]))[0], "his sword")

    def test_unresolved(self):
        text, unres = render("Does $<mult> damage.", ctx([]))
        self.assertEqual(text, "Does $<mult> damage.")
        self.assertEqual(unres, ["$<mult>"])
        text, unres = render("x ${$m2*$<mult>} y", ctx([{"base": 1}, {"base": 2}]))
        self.assertEqual(text, "x ${$m2*$<mult>} y")
        self.assertEqual(unres, ["${$m2*$<mult>}"])
        text, unres = render("$SPI and $AP", ctx([]))
        self.assertEqual(sorted(unres), ["$AP", "$SPI"])

    def test_duration_formats(self):
        for ms, exp in ((-1, "until cancelled"), (30000, "30 sec"), (120000, "2 min"), (7200000, "2 hr")):
            self.assertEqual(render("$d", ctx([], duration_ms=ms))[0], exp)

    def test_mM_and_div(self):
        c = ctx([{"base": 100, "variance": 0.2}])
        self.assertEqual(render("$m1 $M1", c)[0], "90 110")
        self.assertEqual(render("$/10;s1", ctx([{"base": 100}]))[0], "10")
        self.assertEqual(render("$*2;s1", ctx([{"base": 5}]))[0], "10")
