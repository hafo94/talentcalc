"""SpellIconFileDataID -> icon name via ManifestInterfaceData."""
import os

from .util import I


class IconResolver:
    def __init__(self, db):
        self.db = db
        self.missing = []   # (kind, id, fileId)
        self._names = None

    def _load(self):
        if self._names is None:
            self._names = {}
            for r in self.db.rows("ManifestInterfaceData"):
                self._names[I(r["ID"])] = r["FileName"]
        return self._names

    def name(self, file_id):
        file_id = I(file_id)
        if file_id == 0:
            return None
        fn = self._load().get(file_id)
        if not fn:
            return None
        base = os.path.splitext(fn)[0].lower()
        if base == "temp":
            return None
        return base

    def resolve(self, file_id, kind, ident):
        """Like name() but records a missing-icon report entry (file id 0 is not reported as missing data
        for items/spells that simply have no icon, but is still counted)."""
        n = self.name(file_id)
        if n is None:
            self.missing.append({"kind": kind, "id": ident, "fileId": I(file_id)})
        return n
