"""Phase 7: tools/refresh_build.py (no network: the diff of a build with itself, the --switch patterns)."""
import importlib.util
import os
import re
import unittest

from ._fixtures import BUILD, ROOT

_spec = importlib.util.spec_from_file_location("refresh_build", os.path.join(ROOT, "tools", "refresh_build.py"))
refresh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(refresh)
GEN = os.path.join(ROOT, "data", "generated", BUILD)


class TestRefresh(unittest.TestCase):
    def test_current_build_matches_vite_config(self):
        self.assertEqual(refresh.current_build(), "1.60.1.70888")

    def test_every_switch_pattern_matches_once(self):
        for rel, pat in refresh.SWITCH:
            with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
                self.assertEqual(len(re.findall(pat, f.read())), 1, rel)

    @unittest.skipUnless(os.path.isdir(GEN), "generated data missing")
    def test_diff_of_a_build_with_itself_is_empty(self):
        lines, problems = refresh.diff_summary(GEN, GEN)
        text = "\n".join(lines)
        self.assertEqual(problems, 0)
        self.assertIn("identical, 0 changed, 0 new, 0 removed", text)
        self.assertIn("## Talents: 0 added, 0 removed, 0 changed", text)
        self.assertIn("## Spells (class and pet files): 0 added, 0 removed, 0 changed", text)
        self.assertIn("## Targets: unchanged", text)
