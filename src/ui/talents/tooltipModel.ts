import { rankOf, unmetRequirements, canAdd, type PointsContext, type Ranks } from "@/engine/talents";
import type { ClassTree } from "@/engine/talents";

export interface TooltipModel {
  name: string;
  rankLine: string;
  requirements: string[];
  gateNote: string | null;
  current: string | null;
  next: string | null;
  learnHint: boolean;
}

export function buildTooltipModel(
  tree: ClassTree,
  ranks: Ranks,
  nodeId: number,
  ctx: PointsContext,
): TooltipModel {
  const node = tree.nodes.get(nodeId);
  if (!node) throw new Error(`unknown node ${nodeId}`);
  const t = node.talent;
  const rank = rankOf(ranks, nodeId);
  const specName = tree.file.specs[node.specIndex]?.name ?? "";
  const requirements: string[] = [];
  let gateNote: string | null = null;
  for (const req of unmetRequirements(tree, ranks, nodeId)) {
    if (req.kind === "gate") {
      requirements.push(`Requires ${req.points} points in ${specName} Talents`);
      if (req.excludedInvested.length) {
        const names = req.excludedInvested.map((id) => tree.nodes.get(id)!.talent.name).join(", ");
        gateNote = `Points in ${names} do not count toward this requirement.`;
      }
    } else {
      const p = tree.nodes.get(req.nodeId)!.talent;
      requirements.push(`Requires ${req.points} point${req.points === 1 ? "" : "s"} in ${p.name}`);
    }
  }
  const cur = rank === 0 ? t.ranks[0] : t.ranks[rank - 1];
  const next = rank > 0 && rank < t.maxRank ? t.ranks[rank] : undefined;
  return {
    name: t.name,
    rankLine: `Rank ${rank}/${t.maxRank}`,
    requirements,
    gateNote,
    current: cur?.description ?? null,
    next: next?.description ?? null,
    learnHint: canAdd(tree, ranks, nodeId, ctx),
  };
}
