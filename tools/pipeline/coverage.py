"""Talent coverage classification (plan section 1.8)."""
from . import constants as C


def classify_effect(effect, aura):
    if effect == 0:
        return "ignored"
    if effect in C.APPLY_AURA_EFFECTS:
        if aura in C.GENERIC_AURAS:
            return "generic"
        if aura in C.IGNORED_AURAS or aura == 0:
            return "ignored"
        if aura in C.SPECIAL_AURAS:
            return "special"
        return "unsupported"
    if effect in C.DAMAGE_EFFECTS:
        return "generic"
    if effect in C.IGNORED_EFFECTS:
        return "ignored"
    if effect in C.SPECIAL_EFFECTS:
        return "special"
    return "unsupported"


def build_coverage(talent_files, spells_by_id, build):
    summary = {"generic": 0, "special": 0, "unsupported": 0, "dpsRelevant": 0, "total": 0, "byClass": {}}
    talents = []
    for cid in sorted(talent_files):
        f = talent_files[cid]
        by = summary["byClass"].setdefault(f["token"], {"generic": 0, "special": 0, "unsupported": 0})
        for s in f["specs"]:
            for t in s["talents"]:
                effs = [{"index": e["index"], "effect": e["effect"], "aura": e["aura"],
                         "category": classify_effect(e["effect"], e["aura"])}
                        for e in spells_by_id[t["spellId"]]["effects"]]
                cats = {e["category"] for e in effs}
                if "special" in cats:
                    cls = "special"
                elif "unsupported" in cats:
                    cls = "unsupported"
                else:
                    cls = "generic"
                relevant = bool(cats & {"generic", "special", "unsupported"})
                talents.append({"classId": cid, "spec": s["index"], "nodeId": t["nodeId"], "spellId": t["spellId"],
                                "name": t["name"], "class": cls, "kind": t["kind"], "dpsRelevant": relevant,
                                "effects": effs})
                summary[cls] += 1
                by[cls] += 1
                summary["total"] += 1
                if relevant:
                    summary["dpsRelevant"] += 1
    return {"build": build, "summary": summary, "talents": talents}
