import { useEffect, useMemo, useRef, useState } from "react";
import { availablePoints, pointsBySpec, pointsSpent, requiredLevel } from "@/engine/talents";
import { classesFile } from "@/data";
import { pointsContext, useCalc } from "@/state/store";
import styles from "./PointsSummary.module.css";

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // fall through to the legacy path
  }
  const input = document.createElement("input");
  input.value = text;
  input.readOnly = true;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

export function PointsSummary() {
  const tree = useCalc((s) => s.tree);
  const ranks = useCalc((s) => s.ranks);
  const level = useCalc((s) => s.level);
  const talentedRank = useCalc((s) => s.talentedRank);
  const setTalented = useCalc((s) => s.setTalented);
  const resetAll = useCalc((s) => s.resetAll);
  const [copied, setCopied] = useState(false);
  const [announce, setAnnounce] = useState("");
  const prev = useRef(ranks);

  const available = useMemo(
    () => availablePoints(pointsContext({ level, talentedRank })),
    [level, talentedRank],
  );

  useEffect(() => {
    const before = prev.current;
    prev.current = ranks;
    if (!tree || before === ranks) return;
    const ids = new Set([...Object.keys(before), ...Object.keys(ranks)].map(Number));
    for (const id of ids) {
      if ((before[id] ?? 0) !== (ranks[id] ?? 0)) {
        const t = tree.nodes.get(id)?.talent;
        if (!t) continue;
        setAnnounce(
          `${t.name} ${ranks[id] ?? 0}/${t.maxRank}. ${available - pointsSpent(tree, ranks)} points left.`,
        );
        return;
      }
    }
  }, [ranks, tree, available]);

  if (!tree) return null;
  const spent = pointsSpent(tree, ranks);
  const left = available - spent;
  const req = requiredLevel(spent, talentedRank, classesFile.talentCurrency);

  return (
    <div className={styles.bar}>
      <span className={styles.className} style={{ color: tree.info.color }}>
        {tree.info.name}
      </span>
      <span className={styles.item} data-testid="points-by-spec" title="Points per tree">
        {pointsBySpec(tree, ranks).join("/")}
      </span>
      <span className={`${styles.item} ${left < 0 ? styles.neg : ""}`} data-testid="points-left">
        Points left: {left}
      </span>
      <span className={styles.item} data-testid="required-level">
        Required level: {req ?? "–"}
      </span>
      <span className={styles.item}>Level {level}</span>
      <label
        className={styles.item}
        title="Account perk: talent points start at level 5 instead of 10 (max 51). At level 60 it only lowers the required level."
      >
        <input type="checkbox" checked={talentedRank > 0} onChange={(e) => setTalented(e.target.checked)} />{" "}
        Talented (Legacy perk)
      </label>
      <span className={styles.actions}>
        <button type="button" className={styles.btn} disabled={spent === 0} onClick={() => resetAll()}>
          Reset all
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={() => {
            void copyText(location.href).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      </span>
      <span className="sr-only" aria-live="polite" style={srOnly}>
        {announce}
      </span>
    </div>
  );
}

const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};
