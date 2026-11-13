import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Impact } from "@/state/insight";
import { pointsContext, useCalc } from "@/state/store";
import { fmtDec1, fmtDec2, fmtInt, fmtSigned } from "@/ui/stats/format";
import { useDerived } from "@/ui/stats/useDerived";
import { buildTooltipModel } from "./tooltipModel";
import { useTooltip } from "./tooltipStore";
import { insightCache, useInsightInputs } from "./useInsight";
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

const pctText = (n: number) => fmtSigned(n, fmtDec2) + "%";

/** Phase 7: "Next point: +12.3 DPS (+1.4%)" and the visible stat changes under it. */
function ImpactLine({ label, x, testId }: { label: string; x: Impact; testId: string }) {
  const tone = Math.abs(x.dps) < 0.05 ? styles.grey : x.dps > 0 ? styles.green : styles.red;
  return (
    <div data-testid={testId}>
      <span className={styles.white}>{label}: </span>
      <span className={tone}>
        {fmtSigned(x.dps, fmtDec1)} DPS ({pctText(x.pct)})
      </span>
      {x.stats.length > 0 && (
        <div className={styles.grey}>
          {x.stats
            .slice(0, 4)
            .map((s) => `${s.format === "pct" ? pctText(s.delta) : fmtSigned(s.delta, fmtInt)} ${s.label}`)
            .join(" · ")}
        </div>
      )}
      {x.rotation && <div className={styles.grey}>Rotation becomes: {x.rotation}</div>}
    </div>
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
  const inp = useInsightInputs();
  const d = useDerived();
  const impact = useMemo(
    () => (inp && nodeId !== null ? insightCache.impact(inp, nodeId) : null),
    [inp, nodeId],
  );
  const notModeled = d.ok && nodeId !== null && d.notModeled.some((n) => n.nodeId === nodeId);
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
  }, [anchor, model, impact]);

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
      {impact && (impact.next || impact.prev) && (
        <div className={styles.impact} data-testid="talent-impact">
          {impact.next && <ImpactLine label="Next point" x={impact.next} testId="impact-next" />}
          {impact.prev && <ImpactLine label="Last point" x={impact.prev} testId="impact-prev" />}
          {notModeled && <div className={styles.grey}>Not modeled: its DPS is not counted.</div>}
        </div>
      )}
      {model.learnHint && <div className={styles.green}>Click to learn</div>}
    </div>,
    document.body,
  );
}
