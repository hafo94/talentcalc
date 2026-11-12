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
