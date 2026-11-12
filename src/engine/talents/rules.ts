import type { PointsContext } from "./points";
import { availablePoints } from "./points";
import type { ClassTree } from "./tree";

export type Ranks = Readonly<Record<number, number>>; // nodeId -> rank; only ranks > 0 are stored
export type NodeState = "locked" | "available" | "partial" | "maxed";
export type Requirement =
  | { kind: "gate"; specIndex: number; points: number; counted: number; excludedInvested: number[] }
  | { kind: "prereq"; nodeId: number; points: number };
export type Violation =
  | { kind: "unknownNode"; nodeId: number }
  | { kind: "rankOutOfRange"; nodeId: number; rank: number }
  | { kind: "gate"; nodeId: number; required: number; counted: number }
  | { kind: "prereq"; nodeId: number; prereqNodeId: number }
  | { kind: "overBudget"; spent: number; available: number };

export function rankOf(ranks: Ranks, id: number): number {
  return ranks[id] ?? 0;
}

function withRank(ranks: Ranks, id: number, k: number): Ranks {
  if (k > 0) return { ...ranks, [id]: k };
  const out = { ...ranks };
  delete out[id];
  return out;
}

export function pointsInSpec(tree: ClassTree, ranks: Ranks, specIndex: number): number {
  let n = 0;
  for (const id of tree.specNodeIds[specIndex] ?? []) n += rankOf(ranks, id);
  return n;
}

export function pointsBySpec(tree: ClassTree, ranks: Ranks): number[] {
  return tree.specNodeIds.map((_, i) => pointsInSpec(tree, ranks, i));
}

export function pointsSpent(tree: ClassTree, ranks: Ranks): number {
  return pointsBySpec(tree, ranks).reduce((a, b) => a + b, 0);
}

export function gateProgress(tree: ClassTree, ranks: Ranks, specIndex: number, tier: number) {
  const g = tree.gates[specIndex]?.[tier];
  if (!g) return { required: 0, counted: 0, excludedInvested: [] as number[] };
  let counted = 0;
  for (const id of g.counted) counted += rankOf(ranks, id);
  return {
    required: g.requiredPoints,
    counted,
    excludedInvested: g.excludedLower.filter((id) => rankOf(ranks, id) > 0),
  };
}

export function unmetRequirements(tree: ClassTree, ranks: Ranks, id: number): Requirement[] {
  const n = tree.nodes.get(id);
  if (!n) return [];
  const t = n.talent;
  const out: Requirement[] = [];
  const gp = gateProgress(tree, ranks, n.specIndex, t.tier);
  if (gp.counted < gp.required) {
    out.push({
      kind: "gate",
      specIndex: n.specIndex,
      points: gp.required,
      counted: gp.counted,
      excludedInvested: gp.excludedInvested,
    });
  }
  if (t.prereqNodeId !== undefined) {
    const p = tree.nodes.get(t.prereqNodeId)!.talent;
    if (rankOf(ranks, p.nodeId) < p.maxRank)
      out.push({ kind: "prereq", nodeId: p.nodeId, points: p.maxRank });
  }
  return out;
}

export function isUnlocked(tree: ClassTree, ranks: Ranks, id: number): boolean {
  return unmetRequirements(tree, ranks, id).length === 0;
}

export function canAdd(tree: ClassTree, ranks: Ranks, id: number, ctx: PointsContext): boolean {
  const n = tree.nodes.get(id);
  if (!n) return false;
  return (
    rankOf(ranks, id) < n.talent.maxRank &&
    pointsSpent(tree, ranks) < availablePoints(ctx) &&
    isUnlocked(tree, ranks, id)
  );
}

/** A point may be removed only if the build is still valid afterwards (gates and prerequisites). */
export function canRemove(tree: ClassTree, ranks: Ranks, id: number): boolean {
  const n = tree.nodes.get(id);
  const r = rankOf(ranks, id);
  if (!n || r === 0) return false;
  const next = withRank(ranks, id, r - 1);
  for (const other of tree.specNodeIds[n.specIndex] ?? []) {
    if (rankOf(next, other) > 0 && !isUnlocked(tree, next, other)) return false;
  }
  return true;
}

export function addPoint(tree: ClassTree, ranks: Ranks, id: number, ctx: PointsContext): Ranks {
  return canAdd(tree, ranks, id, ctx) ? withRank(ranks, id, rankOf(ranks, id) + 1) : ranks;
}

export function removePoint(tree: ClassTree, ranks: Ranks, id: number): Ranks {
  return canRemove(tree, ranks, id) ? withRank(ranks, id, rankOf(ranks, id) - 1) : ranks;
}

export function resetSpec(tree: ClassTree, ranks: Ranks, specIndex: number): Ranks {
  const out = { ...ranks };
  for (const id of tree.specNodeIds[specIndex] ?? []) delete out[id];
  return out;
}

export function resetAll(): Ranks {
  return {};
}

export function nodeState(tree: ClassTree, ranks: Ranks, id: number, ctx: PointsContext): NodeState {
  const n = tree.nodes.get(id);
  const r = rankOf(ranks, id);
  if (n && r === n.talent.maxRank) return "maxed";
  if (r > 0) return "partial"; // green even when no points are left (Q31)
  return canAdd(tree, ranks, id, ctx) ? "available" : "locked";
}

export function validate(tree: ClassTree, ranks: Ranks, ctx: PointsContext): Violation[] {
  const out: Violation[] = [];
  for (const k of Object.keys(ranks)) {
    const id = Number(k);
    if (!tree.nodes.has(id)) out.push({ kind: "unknownNode", nodeId: id });
  }
  let spent = 0;
  for (const id of tree.order) {
    const r = ranks[id];
    if (r === undefined) continue;
    const n = tree.nodes.get(id)!;
    if (!Number.isInteger(r) || r < 1 || r > n.talent.maxRank) {
      out.push({ kind: "rankOutOfRange", nodeId: id, rank: r });
      continue;
    }
    spent += r;
    for (const req of unmetRequirements(tree, ranks, id)) {
      if (req.kind === "gate")
        out.push({ kind: "gate", nodeId: id, required: req.points, counted: req.counted });
      else out.push({ kind: "prereq", nodeId: id, prereqNodeId: req.nodeId });
    }
  }
  const available = availablePoints(ctx);
  if (spent > available) out.push({ kind: "overBudget", spent, available });
  return out;
}

/** Rebuilds a legal build from untrusted input (URL). Greedy in (spec, tier, col) order. */
export function sanitize(
  tree: ClassTree,
  wanted: Ranks,
  ctx: PointsContext,
): { ranks: Ranks; dropped: boolean } {
  let out: Ranks = {};
  let dropped = false;
  for (const id of tree.order) {
    const want = wanted[id] ?? 0;
    const max = tree.nodes.get(id)!.talent.maxRank;
    const target = Math.min(want, max);
    if (want > max) dropped = true;
    while (rankOf(out, id) < target && canAdd(tree, out, id, ctx))
      out = withRank(out, id, rankOf(out, id) + 1);
    if (rankOf(out, id) < target) dropped = true;
  }
  for (const k of Object.keys(wanted)) if (!tree.nodes.has(Number(k))) dropped = true;
  return { ranks: out, dropped };
}
