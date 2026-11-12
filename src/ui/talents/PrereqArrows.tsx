import type { Spec } from "@/data/types";
import type { Ranks } from "@/engine/talents";
import { ARROW_WIDTH, TREE_H, TREE_W, arrowPath } from "./geometry";

interface Props {
  spec: Spec;
  ranks: Ranks;
}

export function PrereqArrows({ spec, ranks }: Props) {
  const byId = new Map(spec.talents.map((t) => [t.nodeId, t]));
  const arrows = spec.talents.flatMap((dep) => {
    const pre = dep.prereqNodeId === undefined ? undefined : byId.get(dep.prereqNodeId);
    if (!pre) return [];
    const { shaft, head } = arrowPath(pre, dep);
    const color = (ranks[pre.nodeId] ?? 0) >= pre.maxRank ? "var(--gold)" : "var(--grey)";
    return [{ id: dep.nodeId, shaft, head, color }];
  });
  return (
    <svg
      width={TREE_W}
      height={TREE_H}
      viewBox={`0 0 ${TREE_W} ${TREE_H}`}
      aria-hidden
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 1 }}
    >
      {arrows.map((a) => (
        <g key={a.id} data-testid="prereq-arrow">
          <path
            d={a.shaft}
            fill="none"
            stroke="rgba(0,0,0,.6)"
            strokeWidth={ARROW_WIDTH + 2}
            strokeLinecap="butt"
          />
          <polygon points={a.head} fill={a.color} stroke="rgba(0,0,0,.6)" strokeWidth={1} />
          <path d={a.shaft} fill="none" stroke={a.color} strokeWidth={ARROW_WIDTH} strokeLinecap="butt" />
        </g>
      ))}
    </svg>
  );
}
