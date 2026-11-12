import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pointsContext, useCalc } from "@/state/store";
import { buildTooltipModel } from "./tooltipModel";
import { useTooltip } from "./tooltipStore";
import { parseWowText } from "./wowText";
import styles from "./TalentTooltip.module.css";

function WowText({ text }: { text: string }) {
  return (
    <>
      {parseWowText(text).map((seg, i) => (
        <span key={i} style={seg.color ? { color: seg.color } : undefined}>
          {seg.text}
        </span>
      ))}
    </>
  );
}

export function TalentTooltip() {
  const nodeId = useTooltip((s) => s.nodeId);
  const anchor = useTooltip((s) => s.anchor);
  const tree = useCalc((s) => s.tree);
  const ranks = useCalc((s) => s.ranks);
  const level = useCalc((s) => s.level);
  const talentedRank = useCalc((s) => s.talentedRank);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const model = useMemo(() => {
    if (!tree || nodeId === null || !tree.nodes.has(nodeId)) return null;
    return buildTooltipModel(tree, ranks, nodeId, pointsContext({ level, talentedRank }));
  }, [tree, ranks, nodeId, level, talentedRank]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor || !model) {
      setPos(null);
      return;
    }
    const a = anchor.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    let left = a.right + 8;
    let top = a.top;
    if (left + width > window.innerWidth - 8) {
      left = a.left - 8 - width;
      if (left < 8) {
        left = 8;
        top = a.bottom + 8;
      }
    }
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
    setPos({ left, top });
  }, [anchor, model]);

  if (!model || !anchor || !anchor.isConnected) return null;
  return createPortal(
    <div
      ref={ref}
      id="talent-tooltip"
      role="tooltip"
      className={styles.tooltip}
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      <div className={styles.name}>{model.name}</div>
      <div className={styles.white}>{model.rankLine}</div>
      {model.requirements.map((r) => (
        <div key={r} className={styles.red}>
          {r}
        </div>
      ))}
      {model.gateNote && <div className={styles.grey}>{model.gateNote}</div>}
      {model.current && (
        <div className={styles.gold}>
          <WowText text={model.current} />
        </div>
      )}
      {model.next && (
        <>
          <div className={styles.gap} />
          <div className={styles.white}>Next rank:</div>
          <div className={styles.gold}>
            <WowText text={model.next} />
          </div>
        </>
      )}
      {model.learnHint && <div className={styles.green}>Click to learn</div>}
    </div>,
    document.body,
  );
}
