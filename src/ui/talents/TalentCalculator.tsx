import { useEffect, useState } from "react";
import { useCalc } from "@/state/store";
import { WowIcon } from "@/ui/common/WowIcon";
import { useMediaQuery } from "@/ui/common/useMediaQuery";
import { StatStrip } from "@/ui/stats/StatStrip";
import { PointsSummary } from "./PointsSummary";
import { TalentTooltip } from "./TalentTooltip";
import { TalentTree } from "./TalentTree";
import { useTooltip } from "./tooltipStore";
import { useHeatmap, useTreeContribution } from "./useInsight";
import { pointsInSpec } from "@/engine/talents";
import styles from "./TalentCalculator.module.css";

export function TalentCalculator() {
  const tree = useCalc((s) => s.tree);
  const ranks = useCalc((s) => s.ranks);
  const status = useCalc((s) => s.status);
  const error = useCalc((s) => s.error);
  const classToken = useCalc((s) => s.classToken);
  const activeSpec = useCalc((s) => s.activeSpec);
  const setActiveSpec = useCalc((s) => s.setActiveSpec);
  const desktop = useMediaQuery("(min-width: 980px)");
  const closeTooltip = useTooltip((s) => s.close);
  const [heat, setHeat] = useState(false);
  const contribution = useTreeContribution();
  const heatmap = useHeatmap(heat);

  useEffect(() => {
    closeTooltip();
  }, [classToken, closeTooltip]);

  useEffect(() => {
    // A tap outside any node closes the tooltip (touch).
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" && !(e.target as Element).closest("[data-node-id]")) closeTooltip();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [closeTooltip]);

  if (!classToken) return <p className={styles.hint}>Choose a class to start.</p>;
  if (status === "error") return <p className={styles.error}>Could not load talents: {error}</p>;
  if (!tree) return <p className={styles.hint}>Loading…</p>;

  const specs = tree.file.specs;
  return (
    <div>
      <PointsSummary />
      <StatStrip />
      <label className={styles.heatToggle}>
        <input
          type="checkbox"
          data-testid="heatmap-toggle"
          checked={heat}
          onChange={(e) => setHeat(e.target.checked)}
        />{" "}
        Show the DPS of the next point on every talent
        {heat && !heatmap && <span className={styles.busy}> (computing…)</span>}
      </label>
      {!desktop && (
        <div className={styles.tabs} role="tablist" aria-label="Talent trees">
          {specs.map((s, i) => (
            <button
              key={s.index}
              type="button"
              role="tab"
              id={`tab-${i}`}
              aria-selected={activeSpec === i}
              aria-controls={`tree-panel-${i}`}
              className={styles.tab}
              onClick={() => setActiveSpec(i)}
            >
              <WowIcon name={tree.info.specs[i]?.icon ?? null} size={20} />
              <span className={styles.tabName}>{s.name}</span>
              <span>{pointsInSpec(tree, ranks, i)}</span>
            </button>
          ))}
        </div>
      )}
      <div className={desktop ? styles.row : styles.single}>
        {specs.map((s, i) => (
          <TalentTree
            key={s.index}
            specIndex={i}
            hidden={!desktop && activeSpec !== i}
            contribution={contribution?.[i] ?? null}
            heatmap={heatmap}
          />
        ))}
      </div>
      <TalentTooltip />
    </div>
  );
}
