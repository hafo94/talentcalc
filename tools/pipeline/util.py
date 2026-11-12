"""Small numeric/string helpers shared by the pipeline."""
import math


def I(v):
    """int from a raw CSV string ('' -> 0). Accepts floats written as text."""
    if v is None or v == "":
        return 0
    try:
        return int(v)
    except ValueError:
        return int(float(v))


def F(v):
    """float from a raw CSV string ('' -> 0.0)."""
    if v is None or v == "":
        return 0.0
    return float(v)


def rhu(x):
    """Round half up, away from zero. Never use Python's round() for game numbers."""
    return int(math.copysign(math.floor(abs(x) + 0.5), x))


def num(x):
    """Deterministic JSON number: int if integral, else rounded to 6 decimals."""
    if isinstance(x, int):
        return x
    if abs(x - round(x)) < 1e-9:
        return int(round(x))
    return round(x, 6)


def u32(v):
    return int(v) & 0xFFFFFFFF


def fmt(x):
    """Integer if integral, else up to 1 decimal with trailing zeros stripped."""
    if abs(x - round(x)) < 1e-9:
        return str(int(round(x)))
    s = "%.1f" % (rhu(x * 10) / 10.0)
    return s.rstrip("0").rstrip(".")
