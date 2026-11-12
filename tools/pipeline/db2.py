"""Lazy loader and indexer for raw wago.tools DB2 CSV exports."""
import csv
import hashlib
import os
import sys

csv.field_size_limit(sys.maxsize)


class MissingTableError(Exception):
    pass


class RawDB:
    def __init__(self, raw_dir):
        self.raw_dir = raw_dir
        self._rows = {}
        self._idx = {}
        self.tables_read = set()

    def path(self, table):
        return os.path.join(self.raw_dir, table + ".csv")

    def has(self, table):
        return os.path.isfile(self.path(table))

    def rows(self, table):
        if table not in self._rows:
            p = self.path(table)
            if not os.path.isfile(p):
                raise MissingTableError(
                    "missing raw table %s (%s): run tools/research/fetch_db2.sh" % (table, p))
            with open(p, newline="", encoding="utf-8") as f:
                self._rows[table] = list(csv.DictReader(f))
            self.tables_read.add(table)
        return self._rows[table]

    def by_id(self, table, key="ID"):
        k = ("by_id", table, key)
        if k not in self._idx:
            d = {}
            for r in self.rows(table):
                d[r[key]] = r
            self._idx[k] = d
        return self._idx[k]

    def by_spell(self, table):
        """SpellID -> row (DifficultyID == "0" only if the column exists); asserts uniqueness."""
        k = ("by_spell", table)
        if k not in self._idx:
            rs = self.rows(table)
            diff = bool(rs) and "DifficultyID" in rs[0]
            d = {}
            for r in rs:
                if diff and r["DifficultyID"] != "0":
                    continue
                sid = r["SpellID"]
                assert sid not in d, "duplicate SpellID %s in %s" % (sid, table)
                d[sid] = r
            self._idx[k] = d
        return self._idx[k]

    def group(self, table, key, diff0=True):
        k = ("group", table, key, diff0)
        if k not in self._idx:
            rs = self.rows(table)
            diff = diff0 and bool(rs) and "DifficultyID" in rs[0]
            d = {}
            for r in rs:
                if diff and r["DifficultyID"] != "0":
                    continue
                d.setdefault(r[key], []).append(r)
            self._idx[k] = d
        return self._idx[k]

    def sha256(self, table):
        h = hashlib.sha256()
        with open(self.path(table), "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()

    def row_count(self, table):
        return len(self.rows(table))
