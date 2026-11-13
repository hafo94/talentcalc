import { useEffect, useMemo, useState } from "react";
import { InsightCache, type InsightInputs } from "@/state/insight";
import { useDeriveInputs } from "@/ui/stats/useDerived";

/** One cache for the tooltip, the tree totals and the heat map (cleared when any input changes). */
export const insightCache = new InsightCache();

/** The current inputs of derive (null until the damage engine can run: class spells loaded, a race chosen). */
export function useInsightInputs(): InsightInputs | null {
  const { calc, ch, custom } = useDeriveInputs();
  const ready = calc.tree !== null && calc.spells !== null && ch.raceId !== 0;
  return useMemo(() => (ready ? { calc, ch, rotation: custom } : null), [ready, calc, ch, custom]);
}

type IdleHandle = { cancel(): void };
/** requestIdleCallback when the browser has it (not Safari), else a 0 ms timeout. */
export function onIdle(fn: () => void): IdleHandle {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 500 });
    return { cancel: () => w.cancelIdleCallback!(id) };
  }
  const id = window.setTimeout(fn, 0);
  return { cancel: () => window.clearTimeout(id) };
}

/** DPS of each tree's points, computed when the browser is idle after a change (3 evaluations). */
export function useTreeContribution(): number[] | null {
  const inp = useInsightInputs();
  const [value, setValue] = useState<{ inp: InsightInputs; trees: number[] | null } | null>(null);
  useEffect(() => {
    if (!inp) return;
    const h = onIdle(() => setValue({ inp, trees: insightCache.contribution(inp) }));
    return () => h.cancel();
  }, [inp]);
  return value && value.inp === inp ? value.trees : null;
}

const BATCH = 6; // talents per idle callback (~6 x 2 evaluations, under 10 ms)

/** Heat map: next-point DPS of every talent, computed in idle batches; null while off or not ready. */
export function useHeatmap(on: boolean): ReadonlyMap<number, number> | null {
  const inp = useInsightInputs();
  const [value, setValue] = useState<{ inp: InsightInputs; map: Map<number, number> } | null>(null);
  useEffect(() => {
    if (!on || !inp || !inp.calc.tree) return;
    const ids = [...inp.calc.tree.order];
    const map = new Map<number, number>();
    let h: IdleHandle | null = null;
    const step = () => {
      for (const id of ids.splice(0, BATCH)) {
        const x = insightCache.impact(inp, id);
        if (x?.next) map.set(id, x.next.dps);
      }
      if (ids.length) h = onIdle(step);
      else setValue({ inp, map });
    };
    h = onIdle(step);
    return () => h?.cancel();
  }, [on, inp]);
  return on && value && value.inp === inp ? value.map : null;
}
