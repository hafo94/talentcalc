import { useMemo, useRef } from "react";
import { REMOTE_BACKGROUNDS, SPEC_TINTS, specBackgroundUrl } from "@/data/assets";
import { canAdd, nodeState, pointsInSpec } from "@/engine/talents";
import { pointsContext, useCalc } from "@/state/store";
import { WowIcon } from "@/ui/common/WowIcon";
import { fmtDec1, fmtSigned } from "@/ui/stats/format";
import { PrereqArrows } from "./PrereqArrows";
import { TREE_H, TREE_W } from "./geometry";
import { TalentNode } from "./TalentNode";
import styles from "./TalentTree.module.css";

interface Props {
  specIndex: number;
  hidden?: boolean;
  contribution?: number | null; // Phase 7: DPS of this tree's points (null while computing)
  heatmap?: ReadonlyMap<number, number> | null; // Phase 7: next-point DPS per node
}

export function TalentTree({ specIndex, hidden, contribution, heatmap }: Props) {
  const tree = useCalc((s) => s.tree);
  const ranks = useCalc((s) => s.ranks);
  const level = useCalc((s) => s.level);
  const talentedRank = useCalc((s) => s.talentedRank);
  const resetSpec = useCalc((s) => s.resetSpec);
  const setActiveSpec = useCalc((s) => s.setActiveSpec);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const spec = tree?.file.specs[specIndex];
  const nodes = useMemo(() => {
    if (!tree || !spec) return [];
    const ctx = pointsContext({ level, talentedRank });
    return spec.talents.map((t) => ({
      talent: t,
      rank: ranks[t.nodeId] ?? 0,
      state: nodeState(tree, ranks, t.nodeId, ctx),
      canAddNow: canAdd(tree, ranks, t.nodeId, ctx),
    }));
  }, [tree, spec, ranks, level, talentedRank]);

  if (!tree || !spec) return null;
  const points = pointsInSpec(tree, ranks, specIndex);
  const info = tree.info.specs[specIndex];
  const tint = SPEC_TINTS[spec.talentTabId] ?? "#3a3a3a";

  return (
    <section
      className={`${styles.tree} ${hidden ? styles.hidden : ""}`}
      data-testid={`tree-${specIndex}`}
      data-tree
      aria-label={`${spec.name} talents, ${points} points`}
    >
      <header className={styles.header}>
        <WowIcon name={info?.icon ?? null} size={20} />
        <span className={styles.specName}>{spec.name}</span>
        {points > 0 && contribution != null && (
          <span
            className={styles.dps}
            data-testid={`spec-dps-${specIndex}`}
            title={`DPS from the ${spec.name} points: current DPS minus the DPS without them (same rotation)`}
          >
            {fmtSigned(contribution, fmtDec1)} DPS
          </span>
        )}
        <span className={styles.points} data-testid={`spec-points-${specIndex}`}>
          {points}
        </span>
        <button
          type="button"
          className={styles.reset}
          aria-label={`Reset ${spec.name}`}
          title={`Reset ${spec.name}`}
          disabled={points === 0}
          onClick={() => resetSpec(specIndex)}
        >
          ↺
        </button>
      </header>
      <div
        className={styles.grid}
        style={{ width: TREE_W, height: TREE_H }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          swipe.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const s = swipe.current;
          const t = e.changedTouches[0];
          swipe.current = null;
          if (!s || !t) return;
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          if (Math.abs(dx) > 60 && Math.abs(dy) < 40) {
            const next = specIndex + (dx < 0 ? 1 : -1);
            if (next >= 0 && next <= 2) setActiveSpec(next);
          }
        }}
      >
        <div
          className={styles.fallback}
          style={{ background: `radial-gradient(ellipse at 50% 30%, ${tint} 0%, #0d0d12 75%)` }}
        >
          <div className={styles.watermark}>
            <WowIcon name={info?.icon ?? null} size={160} />
          </div>
        </div>
        {REMOTE_BACKGROUNDS && (
          <img
            className={styles.art}
            src={specBackgroundUrl(spec.talentTabId)}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        <div className={styles.shade} />
        <PrereqArrows spec={spec} ranks={ranks} />
        {nodes.map((n) => (
          <TalentNode key={n.talent.nodeId} {...n} impactDps={heatmap?.get(n.talent.nodeId)} />
        ))}
      </div>
    </section>
  );
}
