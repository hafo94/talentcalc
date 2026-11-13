import { useRef } from "react";
import type { Talent } from "@/data/types";
import type { NodeState } from "@/engine/talents";
import { useCalc } from "@/state/store";
import { WowIcon } from "@/ui/common/WowIcon";
import { fmtDec1, fmtSigned } from "@/ui/stats/format";
import { ICON, nodeBox } from "./geometry";
import { useTooltip } from "./tooltipStore";
import styles from "./TalentNode.module.css";

interface Props {
  talent: Talent;
  rank: number;
  state: NodeState;
  canAddNow: boolean;
  impactDps?: number; // Phase 7 heat map: DPS of the next point
}

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10;

function stateWord(state: NodeState, canAddNow: boolean): string {
  if (state === "locked") return "locked";
  if (state === "available") return "available";
  if (state === "maxed") return "maxed";
  return canAddNow ? "available" : "learned";
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

type Dir = "up" | "down" | "left" | "right";

function focusNeighbor(el: HTMLElement, dir: Dir) {
  const treeEl = el.closest("[data-tree]");
  if (!treeEl) return;
  const tier = Number(el.dataset.tier);
  const col = Number(el.dataset.col);
  const nodes = [...treeEl.querySelectorAll<HTMLElement>("[data-node-id]")].filter((n) => n !== el);
  let best: HTMLElement | undefined;
  let bestKey: number[] | undefined;
  for (const n of nodes) {
    const t = Number(n.dataset.tier);
    const c = Number(n.dataset.col);
    let key: number[] | undefined;
    if (dir === "left" || dir === "right") {
      if (t !== tier) continue;
      if (dir === "left" ? c >= col : c <= col) continue;
      key = [Math.abs(c - col)];
    } else {
      if (dir === "up" ? t >= tier : t <= tier) continue;
      key = [c === col ? 0 : 1, Math.abs(t - tier), Math.abs(c - col)];
    }
    if (!bestKey || lexLess(key, bestKey)) {
      best = n;
      bestKey = key;
    }
  }
  best?.focus();
}

export function TalentNode({ talent, rank, state, canAddNow, impactDps }: Props) {
  const addPoint = useCalc((s) => s.addPoint);
  const removePoint = useCalc((s) => s.removePoint);
  const tooltipOpen = useTooltip((s) => s.nodeId === talent.nodeId);
  const openTooltip = useTooltip((s) => s.open);
  const closeTooltip = useTooltip((s) => s.close);
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const box = nodeBox(talent.tier, talent.col);

  const cancelPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressStart.current = null;
  };

  return (
    <button
      type="button"
      className={styles.node}
      style={{ left: box.left, top: box.top }}
      data-node-id={talent.nodeId}
      data-tier={talent.tier}
      data-col={talent.col}
      data-state={state}
      aria-label={`${talent.name}, rank ${rank} of ${talent.maxRank}, ${stateWord(state, canAddNow)}`}
      aria-describedby={tooltipOpen ? "talent-tooltip" : undefined}
      onClick={(e) => {
        if (swallowClick.current) {
          swallowClick.current = false;
          return;
        }
        if (e.shiftKey) removePoint(talent.nodeId);
        else addPoint(talent.nodeId);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (swallowClick.current) return;
        removePoint(talent.nodeId);
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        openTooltip(talent.nodeId, e.currentTarget);
        cancelPress();
        pressStart.current = { x: e.clientX, y: e.clientY };
        pressTimer.current = window.setTimeout(() => {
          pressTimer.current = null;
          swallowClick.current = true;
          removePoint(talent.nodeId);
          navigator.vibrate?.(15);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        const s = pressStart.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) cancelPress();
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onMouseEnter={(e) => openTooltip(talent.nodeId, e.currentTarget)}
      onMouseLeave={closeTooltip}
      onFocus={(e) => openTooltip(talent.nodeId, e.currentTarget)}
      onBlur={closeTooltip}
      onKeyDown={(e) => {
        const el = e.currentTarget;
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          addPoint(talent.nodeId);
        } else if (["-", "_", "Delete", "Backspace"].includes(e.key)) {
          e.preventDefault();
          removePoint(talent.nodeId);
        } else if (
          e.key === "ArrowUp" ||
          e.key === "ArrowDown" ||
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight"
        ) {
          e.preventDefault();
          focusNeighbor(el, e.key.slice(5).toLowerCase() as Dir);
        }
      }}
    >
      <span className={styles.iconWrap}>
        <WowIcon name={talent.icon} size={ICON} />
      </span>
      {impactDps !== undefined && (
        <span
          className={styles.impact}
          data-testid="node-impact"
          data-sign={Math.abs(impactDps) < 0.05 ? "zero" : impactDps > 0 ? "pos" : "neg"}
          aria-hidden="true"
        >
          {fmtSigned(impactDps, fmtDec1)}
        </span>
      )}
      <span className={styles.badge} data-testid="rank">
        {rank}/{talent.maxRank}
      </span>
    </button>
  );
}
