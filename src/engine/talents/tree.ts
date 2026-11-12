import type { ClassInfo, ClassToken, Talent, TalentFile } from "@/data/types";
import { GATE_COUNTS_LOWER_TIERS_ONLY } from "./constants";

export interface GateIndex {
  tier: number;
  requiredPoints: number;
  counted: readonly number[];
  excludedLower: readonly number[];
}
export interface TreeNode {
  talent: Talent;
  specIndex: number;
  dependents: readonly number[];
}
export interface ClassTree {
  token: ClassToken;
  info: ClassInfo;
  file: TalentFile;
  nodes: ReadonlyMap<number, TreeNode>;
  order: readonly number[]; // all nodeIds sorted by (specIndex, tier, col)
  specNodeIds: readonly (readonly number[])[]; // [specIndex] -> nodeIds in (tier, col) order
  gates: readonly (readonly (GateIndex | undefined)[])[]; // [specIndex][tier]
}

export function buildClassTree(file: TalentFile, info: ClassInfo): ClassTree {
  const nodes = new Map<number, { talent: Talent; specIndex: number; dependents: number[] }>();
  const specNodeIds: number[][] = [];
  for (const spec of file.specs) {
    const sorted = [...spec.talents].sort((a, b) => a.tier - b.tier || a.col - b.col);
    specNodeIds[spec.index] = sorted.map((t) => t.nodeId);
    for (const t of sorted) {
      if (nodes.has(t.nodeId)) throw new Error(`duplicate node ${t.nodeId}`);
      nodes.set(t.nodeId, { talent: t, specIndex: spec.index, dependents: [] });
    }
  }
  for (const n of nodes.values()) {
    const pre = n.talent.prereqNodeId;
    if (pre === undefined) continue;
    const p = nodes.get(pre);
    if (!p || p.specIndex !== n.specIndex)
      throw new Error(`bad prerequisite ${pre} of node ${n.talent.nodeId}`);
    p.dependents.push(n.talent.nodeId);
  }
  const gates: (GateIndex | undefined)[][] = [];
  for (const spec of file.specs) {
    const perTier: (GateIndex | undefined)[] = [];
    for (const g of spec.tierGates) {
      const counted = g.countedNodeIds.filter(
        (id) => !GATE_COUNTS_LOWER_TIERS_ONLY || nodes.get(id)!.talent.tier < g.tier,
      );
      const inScope = new Set(g.countedNodeIds);
      const excludedLower = spec.talents
        .filter((t) => t.tier < g.tier && !inScope.has(t.nodeId))
        .sort((a, b) => a.tier - b.tier || a.col - b.col)
        .map((t) => t.nodeId);
      perTier[g.tier] = { tier: g.tier, requiredPoints: g.requiredPoints, counted, excludedLower };
    }
    gates[spec.index] = perTier;
  }
  for (const n of nodes.values()) {
    const t = n.talent;
    if (t.tier < 2) continue;
    const g = gates[n.specIndex]?.[t.tier];
    if (!g) throw new Error(`no gate for tier ${t.tier} of node ${t.nodeId}`);
    if (g.requiredPoints !== t.requiredPoints) throw new Error(`gate mismatch for node ${t.nodeId}`);
  }
  const order = specNodeIds.flat();
  return { token: file.token, info, file, nodes, order, specNodeIds, gates };
}
