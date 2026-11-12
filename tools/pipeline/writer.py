"""Deterministic JSON writers."""
import json
import os


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")


def _c(o):
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False)


def write_records(path, header, arrays):
    """Header keys one per line, each array element as a compact JSON object on its own line.

    `header` holds scalar/compact values; `arrays` maps key -> list (key order preserved).
    Scalar header entries are written first, then the arrays, so the file is valid JSON."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    parts = []
    for k, v in header.items():
        parts.append(" %s:%s" % (_c(k), _c(v)))
    for k, lst in arrays.items():
        if not lst:
            parts.append(" %s:[]" % _c(k))
        else:
            body = ",\n".join("  " + _c(e) for e in lst)
            parts.append(" %s:[\n%s\n ]" % (_c(k), body))
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("{\n" + ",\n".join(parts) + "\n}\n")
