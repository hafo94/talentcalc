"""Curve evaluation (Curve/CurvePoint) for per-rank talent values."""
from .util import F, I


def _points(db, curve_id):
    cache = db.__dict__.setdefault("_curve_cache", None)
    if cache is None:
        cache = {}
        for r in db.rows("CurvePoint"):
            cache.setdefault(r["CurveID"], []).append((I(r["OrderIndex"]), F(r["Pos_0"]), F(r["Pos_1"])))
        for k in cache:
            cache[k].sort()
        db.__dict__["_curve_cache"] = cache
    pts = cache.get(str(curve_id))
    if not pts:
        raise KeyError("curve %s has no points" % curve_id)
    return [(x, y) for _, x, y in pts]


def curve_value(db, curve_id, x):
    """Exact x match; otherwise linear interpolation between neighbours, clamped to the end points."""
    pts = _points(db, curve_id)
    for px, py in pts:
        if px == x:
            return py
    if x <= pts[0][0]:
        return pts[0][1]
    if x >= pts[-1][0]:
        return pts[-1][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 < x < x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]
