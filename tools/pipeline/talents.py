"""Talent trees from the Trait* tables (plan sections 1.1, 1.2, 4.1)."""
import collections

from . import constants as C
from .curves import curve_value
from .tooltips import SpellTextContext, render
from .util import F, I, num, rhu, u32


class BuildError(Exception):
    pass


def _check(cond, msg):
    if not cond:
        raise BuildError(msg)


class _Maps:
    def __init__(self, db):
        self.db = db
        self.node = db.by_id("TraitNode")
        self.entry = db.by_id("TraitNodeEntry")
        self.defn = db.by_id("TraitDefinition")
        self.cond = db.by_id("TraitCond")
        self.spell_name = db.by_id("SpellName")
        self.spell = db.by_id("Spell")
        self.misc = db.by_spell("SpellMisc")
        self.nodes_of_tree = collections.defaultdict(list)
        for r in db.rows("TraitNode"):
            self.nodes_of_tree[I(r["TraitTreeID"])].append(r)
        self.groups_of = collections.defaultdict(set)
        self.nodes_of_group = collections.defaultdict(set)
        for r in db.rows("TraitNodeGroupXTraitNode"):
            self.groups_of[r["TraitNodeID"]].add(r["TraitNodeGroupID"])
            self.nodes_of_group[r["TraitNodeGroupID"]].add(r["TraitNodeID"])
        self.conds_of_group = collections.defaultdict(list)
        for r in db.rows("TraitNodeGroupXTraitCond"):
            c = self.cond.get(r["TraitCondID"])
            if c is None:
                continue
            # ignore dummy rows (no amount, or no scope group)
            if I(c["SpentAmountRequired"]) == 0 or I(c["TraitNodeGroupID"]) == 0:
                continue
            self.conds_of_group[r["TraitNodeGroupID"]].append(c)
        self.entries_of_node = collections.defaultdict(list)
        for r in db.rows("TraitNodeXTraitNodeEntry"):
            self.entries_of_node[r["TraitNodeID"]].append((I(r["_Index"]), r["TraitNodeEntryID"]))
        for k in self.entries_of_node:
            self.entries_of_node[k].sort()
        self.effect_points = {}
        for r in db.rows("TraitDefinitionEffectPoints"):
            k = (r["TraitDefinitionID"], I(r["EffectIndex"]))
            _check(k not in self.effect_points, "duplicate TraitDefinitionEffectPoints %s" % (k,))
            self.effect_points[k] = r
        self.effects_of_spell = db.group("SpellEffect", "SpellID")


def _identity(m, icons, entry_id):
    """name/icon/spell/definition of one node entry."""
    e = m.entry[entry_id]
    d = m.defn[e["TraitDefinitionID"]]
    sid = d["SpellID"]
    name = d["OverrideName_lang"] or (m.spell_name.get(sid) or {}).get("Name_lang", "")
    icon_fid = I(d["OverrideIcon"])
    if not icon_fid:
        mi = m.misc.get(sid)
        icon_fid = I(mi["SpellIconFileDataID"]) if mi else 0
    return {
        "entryId": I(entry_id), "definitionId": I(d["ID"]), "spellId": I(sid), "name": name,
        "iconFileId": icon_fid, "maxRank": I(e["MaxRanks"]), "defRow": d,
    }


def _is_passive(m, spell_id):
    mi = m.misc.get(str(spell_id))
    return bool(mi and (u32(mi["Attributes_0"]) & C.ATTR0_PASSIVE))


def _rank_values(m, ident, report, node_id, class_id):
    """-> (valueSources, [[values per effect] per rank])."""
    db = m.db
    sid = str(ident["spellId"])
    did = str(ident["definitionId"])
    effs = sorted(m.effects_of_spell.get(sid, []), key=lambda r: I(r["EffectIndex"]))
    max_rank = ident["maxRank"]
    sources = []
    per_effect = []
    for e in effs:
        ei = I(e["EffectIndex"])
        base = F(e["EffectBasePointsF"])
        ep = m.effect_points.get((did, ei))
        if ep is not None:
            cid = ep["CurveID"]
            vals = [curve_value(db, cid, r) for r in range(1, max_rank + 1)]
            sources.append("curve")
            if abs(vals[-1] - base) > 0.01:
                report["curveBaseMismatch"].append({"nodeId": node_id, "name": ident["name"],
                                                    "effectIndex": ei, "base": num(base), "curveMax": num(vals[-1])})
        else:
            vals = [base] * max_rank
            sources.append("base")
            if (max_rank > 1 and base != 0 and I(e["Effect"]) in C.APPLY_AURA_EFFECTS
                    and I(e["EffectAura"]) in C.GENERIC_AURAS):
                report["multiRankWithoutCurve"].append({"nodeId": node_id, "name": ident["name"],
                                                        "effectIndex": ei, "aura": I(e["EffectAura"]),
                                                        "base": num(base)})
        per_effect.append(vals)
    ranks = [[pe[r] for pe in per_effect] for r in range(max_rank)]
    return sources, ranks


def _talent_record(m, icons, ident, node_id, class_id, report):
    sources, rank_vals = _rank_values(m, ident, report, node_id, class_id)
    d = ident["defRow"]
    tpl = d["OverrideDescription_lang"] or (m.spell.get(str(ident["spellId"])) or {}).get("Description_lang", "")
    ranks = []
    for r, vals in enumerate(rank_vals, start=1):
        ctx = SpellTextContext.from_db(m.db, ident["spellId"], values=vals)
        text, unres = render(tpl, ctx)
        rec = {"rank": r, "values": [num(v) for v in vals], "description": text}
        if unres:
            rec["unresolved"] = unres
            for t in unres:
                report["_unresolved"][t] += 1
        ranks.append(rec)
    icon = icons.resolve(ident["iconFileId"], "talent", node_id)
    return {
        "nodeId": node_id, "entryId": ident["entryId"], "definitionId": ident["definitionId"],
        "spellId": ident["spellId"], "name": ident["name"], "icon": icon,
        "iconFileId": ident["iconFileId"],
    }, sources, ranks


def build_talent_trees(db, opts, icons, report):
    """-> dict class_id -> ClassTalentsFile (in-memory). Mutates `report`."""
    m = _Maps(db)
    include_hidden = bool(getattr(opts, "include_hidden", False))
    for k in ("hiddenNodes", "positionFixes", "posYInconsistent", "gateScopeAnomalies",
              "curveBaseMismatch", "multiRankWithoutCurve", "warnings"):
        report.setdefault(k, [])
    report.setdefault("edges", {"kept": 0, "reoriented": [], "droppedExcluded": 0, "duplicates": 0,
                                "rawTypes": {}})
    report.setdefault("_unresolved", collections.Counter())
    tabs = collections.defaultdict(list)
    for r in db.rows("TalentTab"):
        tabs[I(r["ClassMask"])].append(r)

    out = {}
    all_edges = db.rows("TraitEdge")
    for class_id, token, tree_id, mask in C.CLASS_TREES:
        nodes = m.nodes_of_tree[tree_id]
        _check(nodes, "no nodes for tree %d" % tree_id)
        node_ids = {n["ID"] for n in nodes}
        groups = set()
        for n in nodes:
            groups |= m.groups_of.get(n["ID"], set())

        # --- spec groups ---
        gating = []       # (cond, gated group)
        for g in sorted(groups):
            for c in m.conds_of_group.get(g, []):
                gating.append((c, g))
        spec_group_ids = sorted({c["TraitNodeGroupID"] for c, g in gating
                                 if I(c["SpentAmountRequired"]) == C.SPEC_GATE_POINTS})
        _check(len(spec_group_ids) == 3, "tree %d: expected 3 spec groups, got %d" % (tree_id, len(spec_group_ids)))
        posx = {n["ID"]: I(n["PosX"]) for n in nodes}
        spec_members = {g: m.nodes_of_group[g] & node_ids for g in spec_group_ids}
        spec_group_ids.sort(key=lambda g: min(posx[n] for n in spec_members[g]))
        union = set()
        for g in spec_group_ids:
            _check(not (union & spec_members[g]), "tree %d: spec groups overlap" % tree_id)
            union |= spec_members[g]
        _check(union == node_ids, "tree %d: spec groups do not cover all nodes" % tree_id)
        spec_of = {}
        for si, g in enumerate(spec_group_ids):
            for n in spec_members[g]:
                spec_of[n] = si

        tab_rows = sorted(tabs[mask], key=lambda r: I(r["OrderIndex"]))
        _check(len(tab_rows) == 3, "class %d: expected 3 TalentTab rows" % class_id)

        # --- per node info ---
        info = {}
        for n in nodes:
            nid = n["ID"]
            gate = 0
            for g in m.groups_of.get(nid, ()):
                for c in m.conds_of_group.get(g, []):
                    gate = max(gate, I(c["SpentAmountRequired"]))
            _check(gate in C.VALID_GATES, "node %s: invalid gate %d" % (nid, gate))
            flags = I(n["Flags"])
            _check(flags in (0, C.NODE_FLAG_HIDDEN), "node %s: unexpected flags %d" % (nid, flags))
            ents = m.entries_of_node.get(nid, [])
            _check(len(ents) >= 1, "node %s has no entries" % nid)
            ident = _identity(m, icons, ents[0][1])
            info[nid] = {
                "row": n, "gate": gate, "tier": gate // 5 + 1, "hidden": bool(flags & C.NODE_FLAG_HIDDEN),
                "spec": spec_of[nid], "ents": ents, "ident": ident,
            }

        # --- hidden-node report + twins ---
        included = {nid for nid, i in info.items() if include_hidden or not i["hidden"]}
        by_spec_spell = collections.defaultdict(list)
        for nid, i in info.items():
            by_spec_spell[(i["spec"], i["ident"]["spellId"])].append(nid)

        def col_of_x(nid):
            i = info[nid]
            x = I(i["row"]["PosX"]) - C.SPEC_BASE_X[i["spec"]]
            if x % C.COL_STEP == 0 and 0 <= x // C.COL_STEP <= 3:
                return x // C.COL_STEP
            return None

        twin_of = {}
        for nid, i in info.items():
            for other in by_spec_spell[(i["spec"], i["ident"]["spellId"])]:
                if other != nid and info[other]["hidden"] != i["hidden"] and i["hidden"]:
                    twin_of[nid] = other
        for nid in sorted(info, key=int):
            i = info[nid]
            if i["hidden"]:
                rec = {"classId": class_id, "nodeId": I(nid), "name": i["ident"]["name"],
                       "posX": I(i["row"]["PosX"]), "posY": I(i["row"]["PosY"])}
                if nid in twin_of:
                    rec["twinOf"] = I(twin_of[nid])
                report["hiddenNodes"].append(rec)

        # --- columns ---
        for nid in sorted(included, key=int):
            i = info[nid]
            col = col_of_x(nid)
            if col is None:
                method = None
                twins = [o for o in by_spec_spell[(i["spec"], i["ident"]["spellId"])]
                         if o != nid and info[o]["hidden"] and col_of_x(o) is not None]
                if twins:
                    col = col_of_x(twins[0])
                    method = "twin"
                elif I(nid) in C.POSITION_OVERRIDES:
                    col = C.POSITION_OVERRIDES[I(nid)]["col"]
                    method = "override"
                else:
                    raise BuildError("node %s (%s): PosX %s gives no valid column" %
                                     (nid, i["ident"]["name"], i["row"]["PosX"]))
                report["positionFixes"].append({
                    "nodeId": I(nid), "name": i["ident"]["name"], "field": "col", "value": col,
                    "method": method, "posX": I(i["row"]["PosX"]), "posY": I(i["row"]["PosY"])})
            i["col"] = col
            ytier = rhu((I(i["row"]["PosY"]) - C.ROW_BASE_Y) / C.ROW_STEP) + 1
            if ytier != i["tier"]:
                report["posYInconsistent"].append({"nodeId": I(nid), "name": i["ident"]["name"],
                                                   "posY": I(i["row"]["PosY"]), "tier": i["tier"]})

        # --- collision check ---
        seen = {}
        for nid in sorted(included, key=int):
            i = info[nid]
            k = (i["spec"], i["tier"], i["col"])
            if k in seen:
                msg = "tree %d: nodes %s and %s share spec/tier/col %s" % (tree_id, seen[k], nid, k)
                if include_hidden and (i["hidden"] or info[seen[k]]["hidden"]):
                    report["warnings"].append(msg)
                else:
                    raise BuildError(msg)
            else:
                seen[k] = nid

        # --- prerequisites ---
        prereq = {}
        for e in all_edges:
            a, b = e["LeftTraitNodeID"], e["RightTraitNodeID"]
            if a not in node_ids or b not in node_ids:
                continue          # other tree (drafts etc.)
            t = e["Type"]
            report["edges"]["rawTypes"][t] = report["edges"]["rawTypes"].get(t, 0) + 1
            if a not in included or b not in included:
                report["edges"]["droppedExcluded"] += 1
                continue
            lo, hi = a, b
            if info[a]["tier"] > info[b]["tier"]:
                lo, hi = b, a
                report["edges"]["reoriented"].append({"from": I(a), "to": I(b)})
            if hi in prereq:
                if prereq[hi] == lo:
                    report["edges"]["duplicates"] += 1
                    continue
                raise BuildError("node %s has more than one prerequisite" % hi)
            prereq[hi] = lo
            report["edges"]["kept"] += 1

        # --- spec groups gates (tierGates) ---
        gates_by_spec = collections.defaultdict(dict)
        for c, g in gating:
            amt = I(c["SpentAmountRequired"])
            if amt >= C.SPEC_GATE_POINTS:
                continue
            members = m.nodes_of_group[g] & node_ids
            if not members:
                continue
            sp = spec_of[next(iter(members))]
            tier = amt // 5 + 1
            counted = sorted(I(x) for x in (m.nodes_of_group[c["TraitNodeGroupID"]] & included))
            gates_by_spec[sp].setdefault(tier, {"tier": tier, "requiredPoints": amt, "countedNodeIds": counted})
        # 30-point gate (whole spec)
        for c, g in gating:
            if I(c["SpentAmountRequired"]) == C.SPEC_GATE_POINTS:
                members = m.nodes_of_group[g] & node_ids
                if members:
                    sp = spec_of[next(iter(members))]
                    counted = sorted(I(x) for x in (m.nodes_of_group[c["TraitNodeGroupID"]] & included))
                    gates_by_spec[sp].setdefault(7, {"tier": 7, "requiredPoints": 30, "countedNodeIds": counted})

        # --- build specs ---
        specs = []
        for si, g in enumerate(spec_group_ids):
            tab = tab_rows[si]
            talents = []
            for nid in included:
                i = info[nid]
                if i["spec"] != si:
                    continue
                rec, sources, ranks = _talent_record(m, icons, i["ident"], I(nid), class_id, report)
                t = dict(rec)
                t.update({"tier": i["tier"], "col": i["col"], "maxRank": i["ident"]["maxRank"],
                          "requiredPoints": i["gate"]})
                if nid in prereq:
                    t["prereqNodeId"] = I(prereq[nid])
                t["kind"] = "passive" if _is_passive(m, i["ident"]["spellId"]) else "ability"
                if i["hidden"]:
                    t["hidden"] = True
                t["valueSources"] = sources
                t["ranks"] = ranks
                if I(i["row"]["Type"]) == 1 or len(i["ents"]) > 1:
                    report["warnings"].append("node %s (%s) is a choice node" % (nid, i["ident"]["name"]))
                    ch = []
                    for _, eid in i["ents"]:
                        idn = _identity(m, icons, eid)
                        r2, s2, rk2 = _talent_record(m, icons, idn, I(nid), class_id, report)
                        r2 = dict(r2)
                        r2.update({"maxRank": idn["maxRank"], "kind": "passive" if _is_passive(m, idn["spellId"]) else "ability",
                                   "valueSources": s2, "ranks": rk2})
                        ch.append(r2)
                    t["choices"] = ch
                talents.append(t)
            talents.sort(key=lambda t: (t["tier"], t["col"], t["nodeId"]))
            gates = [gates_by_spec[si][k] for k in sorted(gates_by_spec[si])]
            # anomalies: included node missing from a gate scope that should count it
            for t in talents:
                missing = [gt["requiredPoints"] for gt in gates
                           if gt["requiredPoints"] < C.SPEC_GATE_POINTS and gt["requiredPoints"] > t["requiredPoints"]
                           and t["nodeId"] not in gt["countedNodeIds"]]
                if missing:
                    report["gateScopeAnomalies"].append({"nodeId": t["nodeId"], "name": t["name"],
                                                         "missingFromGates": missing})
            specs.append({
                "index": si, "name": tab["Name_lang"], "talentTabId": I(tab["ID"]), "specGroupId": I(g),
                "nodeCount": len(talents), "maxPoints": sum(t["maxRank"] for t in talents),
                "tierGates": gates, "talents": talents,
            })
        out[class_id] = {"build": None, "classId": class_id, "token": token.lower(), "traitTreeId": tree_id,
                         "maxPoints": C.TALENT_CURRENCY_MAX, "specs": specs}
    return out
