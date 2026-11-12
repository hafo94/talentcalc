"""Spell description token resolver (plan section 1.4).

render(text, ctx) -> (resolved_text, sorted unique unresolved raw tokens).
Unresolved tokens stay verbatim in the text.
"""
import ast
import operator
import re

from .util import F, I, fmt, rhu


class EffectCtx:
    __slots__ = ("value", "variance", "periodMs", "chainTargets", "pointsPerCombo", "misc0",
                 "amplitude", "radiusIndex0")

    def __init__(self, value=0.0, variance=0.0, periodMs=0, chainTargets=0, pointsPerCombo=0.0,
                 misc0=0, amplitude=0.0, radiusIndex0=0):
        self.value = value
        self.variance = variance
        self.periodMs = periodMs
        self.chainTargets = chainTargets
        self.pointsPerCombo = pointsPerCombo
        self.misc0 = misc0
        self.amplitude = amplitude
        self.radiusIndex0 = radiusIndex0


class SpellTextContext:
    """Values a description can refer to. `effects` maps 1-based token index (EffectIndex+1) -> EffectCtx."""

    def __init__(self, effects=None, duration_ms=None, proc_chance=0, proc_charges=0, max_stacks=0,
                 range_max=0, resolver=None, radius_fn=None):
        if isinstance(effects, list):
            def mk(e):
                if isinstance(e, EffectCtx):
                    return e
                e = dict(e)
                if "base" in e:
                    e["value"] = e.pop("base")
                return EffectCtx(**e)
            effects = {i + 1: mk(e) for i, e in enumerate(effects)}
        self.effects = effects or {}
        self.duration_ms = duration_ms
        self.proc_chance = proc_chance
        self.proc_charges = proc_charges
        self.max_stacks = max_stacks
        self.range_max = range_max
        self.resolver = resolver
        self.radius_fn = radius_fn

    @classmethod
    def from_db(cls, db, spell_id, values=None, resolver=None):
        """Build the context for a raw spell. `values` (optional) overrides per-effect values and is
        parallel to the EffectIndex-sorted Difficulty-0 effects (talent rank values)."""
        sid = str(spell_id)
        cache = db.__dict__.setdefault("_tooltip_ctx", {})
        if values is None and resolver is None and sid in cache:
            return cache[sid]
        effs = sorted(db.group("SpellEffect", "SpellID").get(sid, []), key=lambda r: I(r["EffectIndex"]))
        emap = {}
        for pos, r in enumerate(effs):
            v = F(r["EffectBasePointsF"])
            if values is not None and pos < len(values):
                v = values[pos]
            emap[I(r["EffectIndex"]) + 1] = EffectCtx(
                value=v, variance=F(r["Variance"]), periodMs=I(r["EffectAuraPeriod"]),
                chainTargets=I(r["EffectChainTargets"]), pointsPerCombo=F(r["EffectPointsPerResource"]),
                misc0=I(r["EffectMiscValue_0"]), amplitude=F(r["EffectAmplitude"]),
                radiusIndex0=I(r["EffectRadiusIndex_0"]))
        misc = db.by_spell("SpellMisc").get(sid)
        dur = None
        rng = 0
        if misc:
            di = misc["DurationIndex"]
            if di not in ("", "0"):
                d = db.by_id("SpellDuration").get(di)
                if d is not None:
                    dur = I(d["Duration"])
            ri = misc["RangeIndex"]
            if ri not in ("", "0"):
                rr = db.by_id("SpellRange").get(ri)
                if rr is not None:
                    rng = F(rr["RangeMax_0"])
        ao = db.by_spell("SpellAuraOptions").get(sid)
        pc = I(ao["ProcChance"]) if ao else 0
        ch = I(ao["ProcCharges"]) if ao else 0
        ms = I(ao["CumulativeAura"]) if ao else 0
        radii = db.by_id("SpellRadius")

        def radius_fn(idx, radii=radii):
            r = radii.get(str(idx))
            return F(r["Radius"]) if r else None

        if resolver is None:
            resolver = lambda other, db=db: cls.from_db(db, other)  # noqa: E731
        ctx = cls(emap, dur, pc, ch, ms, rng, resolver, radius_fn)
        if values is None:
            cache[sid] = ctx
        return ctx


# ---------------------------------------------------------------------------
_TOKEN_RE = re.compile(
    r"\$\{(?P<expr>[^{}]*)\}(?:\.(?P<dec>\d+))?"
    r"|\$(?P<dm>[/*])(?P<dmn>\d+);(?P<dsp>\d+)?(?P<dml>[a-zA-Z])(?P<dmi>\d+)?"
    r"|\$(?P<pl>[lLgG])(?P<a>[^:;$]*):(?P<b>[^;$]*);"
    r"|\$<[^>]*>"
    r"|\$@[A-Za-z]+\d*"
    r"|\$(?P<sp>\d+)?(?P<let>[a-zA-Z])(?P<idx>\d+)?"
)
_SAFE = re.compile(r"^[0-9+\-*/(). ]*$")
_BINOPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}
_KNOWN = set("swmMotaxbqedhnurS")   # S treated as s (deviation from plan: `$/1000;S1` is common, unresolved otherwise)


class _Unresolved(Exception):
    pass


def _safe_eval(expr):
    tree = ast.parse(expr.strip(), mode="eval")

    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return float(n.value)
        if isinstance(n, ast.BinOp) and type(n.op) in _BINOPS:
            return _BINOPS[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.USub, ast.UAdd)):
            v = ev(n.operand)
            return -v if isinstance(n.op, ast.USub) else v
        raise ValueError("unsafe expression")

    return ev(tree)


def _target_ctx(ctx, spell):
    if not spell:
        return ctx
    if ctx.resolver is None:
        return None
    return ctx.resolver(int(spell))


def _eff(c, idx):
    if c is None:
        return None
    return c.effects.get(int(idx) if idx else 1)


def _numeric(letter, spell, idx, ctx, signed):
    """Numeric value of a simple token, or None when unresolvable. Returns float."""
    c = _target_ctx(ctx, spell)
    if c is None:
        return None
    if letter == "S":
        letter = "s"
    if letter in "swmMota xbqe".replace(" ", ""):
        e = _eff(c, idx)
        if e is None:
            return None
        v = e.value
        if letter in "sw":
            return v if signed else abs(v)
        if letter in "mM":
            var = e.variance
            mult = (1 - var / 2) if letter == "m" else (1 + var / 2)
            r = rhu(abs(v) * mult)
            sgn = -1 if (signed and v < 0) else 1
            return float(sgn * r)
        if letter == "o":
            if not e.periodMs:
                return None
            dur = c.duration_ms
            if not dur or dur < 0:
                return None
            r = v * dur / e.periodMs
            return r if signed else abs(r)
        if letter == "t":
            if not e.periodMs:
                return None
            return e.periodMs / 1000.0
        if letter == "a":
            if c.radius_fn is None:
                return None
            r = c.radius_fn(e.radiusIndex0)
            return r
        if letter == "x":
            return float(e.chainTargets)
        if letter == "b":
            return float(e.pointsPerCombo)
        if letter == "q":
            return float(e.misc0) if signed else float(abs(e.misc0))
        if letter == "e":
            return float(e.amplitude)
    if letter == "h":
        return float(c.proc_chance)
    if letter == "n":
        return float(c.proc_charges)
    if letter == "u":
        return float(c.max_stacks)
    if letter == "r":
        return float(c.range_max)
    return None


def _fmt_duration(ms):
    if ms == -1:
        return "until cancelled"
    if ms < 60000:
        return "%s sec" % fmt(ms / 1000.0)
    if ms < 3600000:
        return "%s min" % fmt(ms / 60000.0)
    return "%s hr" % fmt(ms / 3600000.0)


def _simple(letter, spell, idx, ctx):
    """-> (text, number or None); raises _Unresolved."""
    if letter not in _KNOWN:
        raise _Unresolved
    if letter == "S":
        letter = "s"
    if letter == "d":
        c = _target_ctx(ctx, spell)
        if c is None or c.duration_ms is None:
            raise _Unresolved
        return _fmt_duration(c.duration_ms), None
    if letter in "sw":
        c = _target_ctx(ctx, spell)
        e = _eff(c, idx)
        if e is None:
            raise _Unresolved
        if e.variance > 0:
            lo = rhu(abs(e.value) * (1 - e.variance / 2))
            hi = rhu(abs(e.value) * (1 + e.variance / 2))
            return "%d to %d" % (lo, hi), float(hi)
        v = abs(e.value)
        return fmt(v), v
    v = _numeric(letter, spell, idx, ctx, signed=False)
    if v is None:
        raise _Unresolved
    return fmt(v), v


def _expr_value(expr, ctx):
    def sub(m):
        let = m.group("let")
        if let is None:
            raise _Unresolved
        v = _numeric(let, m.group("sp"), m.group("idx"), ctx, signed=True) if let in _KNOWN and let != "d" else None
        if v is None:
            raise _Unresolved
        return "(%r)" % v

    inner = re.compile(r"\$(?P<sp>\d+)?(?P<let>[a-zA-Z])(?P<idx>\d+)?")
    if "$<" in expr or "$@" in expr:
        raise _Unresolved
    s = inner.sub(sub, expr)
    if "$" in s or not _SAFE.match(s):
        raise _Unresolved
    try:
        return _safe_eval(s)
    except (ValueError, SyntaxError, ZeroDivisionError):
        raise _Unresolved


def _resolve_conditionals(text):
    """Replace each `$?cond[A]...[B]` with the last (else) bracket content; no else -> empty."""
    out = []
    i = 0
    n = len(text)
    while i < n:
        j = text.find("$?", i)
        if j < 0:
            out.append(text[i:])
            break
        out.append(text[i:j])
        k = j + 2
        else_content = ""
        ok = True
        while True:
            # condition text up to '['
            b = text.find("[", k)
            if b < 0:
                ok = False
                break
            depth = 0
            e = b
            while e < n:
                ch = text[e]
                if ch == "[":
                    depth += 1
                elif ch == "]":
                    depth -= 1
                    if depth == 0:
                        break
                e += 1
            if depth != 0:
                ok = False
                break
            content = text[b + 1:e]
            k = e + 1
            if k < n and text[k] == "?":
                k += 1
                continue          # another condition follows: `?cond[..]`
            if k < n and text[k] == "[":
                # final else bracket
                depth = 0
                e2 = k
                while e2 < n:
                    ch = text[e2]
                    if ch == "[":
                        depth += 1
                    elif ch == "]":
                        depth -= 1
                        if depth == 0:
                            break
                    e2 += 1
                if depth != 0:
                    ok = False
                    break
                else_content = text[k + 1:e2]
                k = e2 + 1
            break
        if not ok:
            out.append(text[j:j + 2])   # leave malformed construct; scanning continues after "$?"
            i = j + 2
            continue
        # re-scan the chosen content for further conditionals
        out.append(_resolve_conditionals(else_content))
        i = k
    return "".join(out)


def render(text, ctx):
    if not text:
        return "", []
    text = _resolve_conditionals(text)
    unresolved = set()
    out = []
    pos = 0
    last = {"num": None}

    def emit(s):
        out.append(s)

    def tail():
        return "".join(out[-6:])

    for m in _TOKEN_RE.finditer(text):
        emit(text[pos:m.start()])
        pos = m.end()
        raw = m.group(0)
        try:
            if m.group("expr") is not None:
                v = _expr_value(m.group("expr"), ctx)
                dec = m.group("dec")
                if dec is not None:
                    s = ("%." + dec + "f") % (rhu(v * 10 ** int(dec)) / 10 ** int(dec))
                else:
                    s = fmt(v)
                last["num"] = v
                emit(s)
            elif m.group("dm") is not None:
                v = _numeric(m.group("dml"), m.group("dsp"), m.group("dmi"), ctx, signed=False) \
                    if m.group("dml") in _KNOWN else None
                if v is None:
                    raise _Unresolved
                n = float(m.group("dmn"))
                r = v / n if m.group("dm") == "/" else v * n
                last["num"] = r
                emit(fmt(r))
            elif m.group("pl") is not None:
                kind = m.group("pl")
                if kind in "lL":
                    t = re.search(r"(\d+(?:\.\d+)?)[ %]*$", tail())
                    val = float(t.group(1)) if t else last["num"]
                    emit(m.group("a") if (val is not None and abs(val - 1) < 1e-9) else m.group("b"))
                else:
                    emit(m.group("a"))
            elif m.group("let") is not None:
                if (m.group("let") not in _KNOWN or m.group("let") == "S") and m.group("idx") is None:
                    ext = re.match(r"[A-Z]+", text[pos:])
                    if ext:       # e.g. $SPI, $AP, $PL: one unresolved token
                        raw += ext.group(0)
                        pos += len(ext.group(0))
                        unresolved.add(raw)
                        emit(raw)
                        continue
                s, v = _simple(m.group("let"), m.group("sp"), m.group("idx"), ctx)
                if v is not None:
                    last["num"] = v
                emit(s)
            else:
                raise _Unresolved
        except _Unresolved:
            unresolved.add(raw)
            emit(raw)
    emit(text[pos:])
    return "".join(out), sorted(unresolved)
