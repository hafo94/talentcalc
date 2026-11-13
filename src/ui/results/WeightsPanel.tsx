import { useEffect, useMemo, useState } from "react";
import { targetsFile } from "@/data";
import { DEFAULT_SIM_CONFIG } from "@/engine/sim/types";
import { simInputFor } from "@/state/derived";
import type { InsightInputs } from "@/state/insight";
import { useRotation } from "@/state/rotation";
import { statWeights, type WeightRow, type Weights } from "@/state/weights";
import { useWeightsSim } from "@/state/weightsSim";
import { fmtDec2, fmtPct } from "@/ui/stats/format";
import { onIdle, useInsightInputs } from "@/ui/talents/useInsight";
import styles from "./DamagePanel.module.css";

const fmt3 = (n: number) => n.toFixed(3);

/** Everything the weights depend on, as text (a simulated result whose key differs is stale). */
function inputKey(inp: InsightInputs | null, sim: object): string {
  if (!inp) return "";
  const { calc, ch } = inp;
  return JSON.stringify([
    calc.tree?.token,
    calc.ranks,
    calc.level,
    ch.raceId,
    ch.weaponIds,
    ch.bonus,
    ch.buffIds,
    ch.target,
    ch.custom,
    ch.pet,
    inp.rotation,
    sim,
  ]);
}

interface Line {
  id: string; // pair id
  label: string;
  per: number;
  ep: number | null;
  unit: string;
}
function lines(rows: readonly WeightRow[]): Line[] {
  return rows.flatMap((r) => {
    const unit = r.def.pct ? "per 1%" : "per point";
    const out: Line[] = [];
    if (r.perPoint !== null)
      out.push({
        id: r.def.key,
        label: r.cap
          ? `${r.def.label} up to the cap (${fmtPct(r.cap.current)} of ${fmtPct(r.cap.cap)})`
          : r.def.label,
        per: r.perPoint,
        ep: r.ep,
        unit,
      });
    if (r.cap && (r.cap.above !== 0 || r.perPoint === null))
      out.push({
        id: `${r.def.key}:above`,
        label: `${r.def.label} above the cap`,
        per: r.cap.above,
        ep: r.cap.aboveEp,
        unit,
      });
    return out;
  });
}

/**
 * Phase 7: stat weights (EP) of the current build vs the selected target. Computed only while the section is open:
 * analytical at once (about 20 evaluations), simulated on demand in a worker with the Simulation panel's settings.
 */
export function WeightsPanel() {
  const inp = useInsightInputs();
  const sim = useRotation((s) => s.sim);
  const ws = useWeightsSim();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ inp: InsightInputs; w: Weights | null } | null>(null);
  useEffect(() => {
    if (!open || !inp) return;
    const h = onIdle(() => setState({ inp, w: statWeights(inp) }));
    return () => h.cancel();
  }, [open, inp]);
  const w = state && state.inp === inp ? state.w : null;
  const key = useMemo(() => inputKey(inp, sim), [inp, sim]);
  const target = targetsFile.presets.find((p) => p.id === inp?.ch.target)?.label ?? "the target";
  const simResult = ws.result && ws.key === key ? ws.result : null;
  const simPair = new Map(simResult?.pairs.map((p) => [p.id, p.delta]) ?? []);
  const refSim = w?.reference ? simPair.get(w.reference.key)?.mean : undefined;
  const running = ws.status === "running";

  const runSim = () => {
    if (!inp || !w) return;
    const input = simInputFor(inp.calc, inp.ch, inp.rotation);
    if (!input) return;
    ws.run({ input, ...w.jobs, config: { ...DEFAULT_SIM_CONFIG, ...sim, logLimit: 0 } }, key);
  };

  return (
    <section className={styles.panel} data-testid="weights-panel" aria-labelledby="weights-title">
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className={styles.summaryToggle}>
          <h2 id="weights-title" className={styles.titleInline}>
            Stat weights
          </h2>
        </summary>
        {!w && <p className={styles.line}>Computing…</p>}
        {w && (
          <>
            <p className={styles.line}>
              DPS gained per point of each stat (per 1% for percentages) vs {target}, from the analytical
              model.
              {w.reference ? ` EP: relative to ${w.reference.label} = 1.` : ""} Hit is measured up to the hit
              cap and above it.
            </p>
            <table className={styles.table} data-testid="weights-table">
              <caption>Stat weights (EP)</caption>
              <thead>
                <tr>
                  <th>Stat</th>
                  <th>DPS</th>
                  <th>EP</th>
                  {simResult && <th>Sim DPS (95% CI)</th>}
                  {simResult && <th>Sim EP</th>}
                </tr>
              </thead>
              <tbody>
                {lines(w.rows).map((l) => {
                  const s = simPair.get(l.id);
                  return (
                    <tr key={l.id} data-testid={`weight-${l.id.replace(":", "-")}`}>
                      <td>
                        {l.label} <span className={styles.unit}>{l.unit}</span>
                      </td>
                      <td>{fmt3(l.per)}</td>
                      <td data-testid="weight-ep">{l.ep === null ? "–" : fmtDec2(l.ep)}</td>
                      {simResult && (
                        <td>{s ? `${fmt3(s.mean)} ± ${fmt3((s.ci95[1] - s.ci95[0]) / 2)}` : "–"}</td>
                      )}
                      {simResult && <td>{s && refSim ? fmtDec2(s.mean / refSim) : "–"}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className={styles.actionsRow}>
              {running ? (
                <button type="button" data-testid="weights-sim-cancel" onClick={ws.cancel}>
                  Cancel
                </button>
              ) : (
                <button type="button" data-testid="weights-sim-run" onClick={runSim}>
                  Simulate weights
                </button>
              )}
              <span className={styles.line}>
                {Object.keys(w.jobs.patches).length} simulations of {sim.iterations} iterations ×{" "}
                {sim.fightSec} s, seed {sim.seed}, the same random numbers for every stat (Simulation panel
                settings)
              </span>
              {running && (
                <span className={styles.line} data-testid="weights-sim-progress">
                  <progress max={ws.total} value={ws.done} aria-label="Stat weight simulation progress" />{" "}
                  {ws.done} / {ws.total}
                </span>
              )}
              {ws.status === "error" && <span className={styles.note}>Simulation failed: {ws.error}</span>}
            </div>
          </>
        )}
      </details>
    </section>
  );
}
