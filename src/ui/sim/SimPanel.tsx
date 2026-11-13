import { useMemo, useState } from "react";
import { DEFAULT_SIM_CONFIG, type SimResult } from "@/engine/sim/types";
import { useCharacter } from "@/state/character";
import { simInputFor } from "@/state/derived";
import { useRotation } from "@/state/rotation";
import { useSim } from "@/state/sim";
import { useCalc } from "@/state/store";
import { slug } from "@/ui/results/slug";
import { fmtDec1, fmtInt, fmtPct } from "@/ui/stats/format";
import { useDerived } from "@/ui/stats/useDerived";
import styles from "./SimPanel.module.css";

const LOG_LIMIT = DEFAULT_SIM_CONFIG.logLimit;

/** The simulator input of the current state and a key that changes whenever it does (stale results). */
function useSimInput() {
  const tree = useCalc((s) => s.tree);
  const spells = useCalc((s) => s.spells);
  const ranks = useCalc((s) => s.ranks);
  const level = useCalc((s) => s.level);
  const ch = useCharacter();
  const custom = useRotation((s) => s.custom);
  const sim = useRotation((s) => s.sim);
  const { raceId, weaponIds, bonus, buffIds, target, weapons } = ch;
  const customTarget = ch.custom;
  return useMemo(() => {
    const input = simInputFor(
      { tree, ranks, level, spells },
      { raceId, weaponIds, bonus, buffIds, target, custom: customTarget, weapons },
      custom,
    );
    const key = JSON.stringify([
      tree?.token,
      ranks,
      level,
      raceId,
      weaponIds,
      bonus,
      buffIds,
      target,
      customTarget,
      custom,
      sim,
    ]);
    return { input, key, sim };
  }, [
    tree,
    spells,
    ranks,
    level,
    raceId,
    weaponIds,
    bonus,
    buffIds,
    target,
    customTarget,
    weapons,
    custom,
    sim,
  ]);
}

function Settings({ running }: { running: boolean }) {
  const sim = useRotation((s) => s.sim);
  const setSim = useRotation((s) => s.setSim);
  const num = (key: "fightSec" | "iterations" | "seed", label: string, testId: string) => (
    <label className={styles.field}>
      {label}
      <input
        type="number"
        data-testid={testId}
        disabled={running}
        value={sim[key]}
        onChange={(e) => setSim({ [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <div className={styles.settings}>
      {num("fightSec", "Fight length (s)", "sim-fight")}
      {num("iterations", "Iterations", "sim-iterations")}
      {num("seed", "Seed", "sim-seed")}
      <label className={styles.check}>
        <input
          type="checkbox"
          data-testid="sim-unlimited-mana"
          disabled={running}
          checked={sim.unlimitedMana}
          onChange={(e) => setSim({ unlimitedMana: e.target.checked })}
        />
        Unlimited mana
      </label>
    </div>
  );
}

/** Damage sources with an inline share bar (one series: no legend; the table is the table view). */
function Sources({ r }: { r: SimResult }) {
  const max = Math.max(...r.sources.map((s) => s.share), 1);
  return (
    <table className={styles.table} data-testid="sim-breakdown">
      <caption>Damage by source (mean per fight)</caption>
      <thead>
        <tr>
          <th>Source</th>
          <th>DPS</th>
          <th>Share</th>
          <th>Casts</th>
          <th>Crit</th>
          <th>Avg hit</th>
        </tr>
      </thead>
      <tbody>
        {r.sources.map((s) => {
          const landed = s.hits + s.ticks;
          return (
            <tr key={s.key} data-testid={`sim-row-${slug(s.key)}`}>
              <td>
                {s.key}
                {s.averaged && (
                  <span className={styles.avg} title="Expected value from the analytical model">
                    {" "}
                    avg
                  </span>
                )}
              </td>
              <td>{fmtDec1(s.dps)}</td>
              <td className={styles.shareCell}>
                <svg className={styles.bar} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
                  <title>{`${s.key}: ${fmtPct(s.share)}`}</title>
                  <rect x="0" y="1" width={(s.share / max) * 100} height="8" rx="2" />
                </svg>
                {fmtPct(s.share)}
              </td>
              <td>{s.casts > 0 ? fmtDec1(s.casts) : "–"}</td>
              <td>{landed > 0 ? fmtPct((s.crits / landed) * 100) : "–"}</td>
              <td>{landed > 0 ? fmtInt(s.damage / landed) : "–"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const W = 600;
const H = 140;
const PAD = { l: 40, r: 8, t: 8, b: 20 };

/** Resource over time of iteration 1 (one series, hover readout, execute-phase marker). */
function ResourceChart({ r }: { r: SimResult }) {
  const [hover, setHover] = useState<number | null>(null);
  const tl = r.timeline;
  if (!tl || tl.points.length < 2 || !r.power) return null;
  const T = r.config.fightSec;
  const x = (t: number) => PAD.l + (t / T) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / Math.max(1, tl.max)) * (H - PAD.t - PAD.b);
  const pts = tl.points.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: Math.floor(T / 30) + 1 }, (_, i) => i * 30);
  const p = hover !== null ? tl.points[hover] : undefined;
  const name = r.power[0]!.toUpperCase() + r.power.slice(1);
  return (
    <figure className={styles.figure} data-testid="sim-resource-chart">
      <figcaption>{name} over time (iteration 1)</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.chart}
        role="img"
        aria-label={`${name} over the fight, one sample iteration`}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const t = ((((e.clientX - box.left) / box.width) * W - PAD.l) / (W - PAD.l - PAD.r)) * T;
          let best = 0;
          for (let i = 1; i < tl.points.length; i++)
            if (Math.abs(tl.points[i]![0] - t) < Math.abs(tl.points[best]![0] - t)) best = i;
          setHover(best);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className={styles.grid} x1={PAD.l} x2={W - PAD.r} y1={y(f * tl.max)} y2={y(f * tl.max)} />
            <text className={styles.axis} x={PAD.l - 4} y={y(f * tl.max) + 4} textAnchor="end">
              {fmtInt(f * tl.max)}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} className={styles.axis} x={x(t)} y={H - 4} textAnchor="middle">
            {t}s
          </text>
        ))}
        <line className={styles.execute} x1={x(T * 0.8)} x2={x(T * 0.8)} y1={PAD.t} y2={H - PAD.b} />
        <polyline className={styles.line} points={pts} />
        {p && (
          <g>
            <line className={styles.cross} x1={x(p[0])} x2={x(p[0])} y1={PAD.t} y2={H - PAD.b} />
            <circle className={styles.dot} cx={x(p[0])} cy={y(p[1])} r={4} />
          </g>
        )}
      </svg>
      <p className={styles.readout} data-testid="sim-resource-readout">
        {p
          ? `${fmtDec1(p[0])} s: ${fmtInt(p[1])} ${r.power}`
          : "Hover the chart for values. Dashed line: execute phase (20% health)."}
      </p>
    </figure>
  );
}

function Log({ r }: { r: SimResult }) {
  return (
    <details className={styles.log} data-testid="sim-log">
      <summary>Combat log (first {r.log.length} events of iteration 1)</summary>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Source</th>
            <th>Event</th>
            <th>Damage</th>
            {r.power && <th>{r.power}</th>}
          </tr>
        </thead>
        <tbody>
          {r.log.map((l, i) => (
            <tr key={i}>
              <td>{l.t.toFixed(2)}</td>
              <td>{l.source}</td>
              <td>{l.outcome}</td>
              <td>{l.damage ? fmtInt(l.damage) : ""}</td>
              {r.power && <td>{l.resource === null ? "" : fmtInt(l.resource)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** "Run simulation" with progress and cancel; results of the last run (section 6.2). The analytical DPS stays live. */
export function SimPanel() {
  const d = useDerived();
  const { input, key, sim } = useSimInput();
  const s = useSim();
  const running = s.status === "running";
  const r = s.result;
  const analytical = d.ok && d.damage ? d.damage.result.rotation.dps : null;
  return (
    <section className={styles.panel} data-testid="sim-panel" aria-labelledby="sim-title">
      <h2 id="sim-title" className={styles.title}>
        Simulation
      </h2>
      <Settings running={running} />
      <div className={styles.actions}>
        {running ? (
          <button type="button" data-testid="sim-cancel" onClick={s.cancel}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            data-testid="sim-run"
            disabled={!input}
            onClick={() => input && s.run(input, { ...DEFAULT_SIM_CONFIG, ...sim, logLimit: LOG_LIMIT }, key)}
          >
            Run simulation
          </button>
        )}
        {running && (
          <span className={styles.progress} data-testid="sim-progress">
            <progress max={s.total} value={s.done} aria-label="Simulation progress" /> {s.done} / {s.total}
          </span>
        )}
        {s.status === "cancelled" && <span data-testid="sim-cancelled">Cancelled.</span>}
        {s.status === "error" && <span className={styles.error}>Simulation failed: {s.error}</span>}
      </div>
      {r && (
        <div data-testid="sim-results">
          {s.key !== key && (
            <p className={styles.stale} data-testid="sim-stale">
              These results are for an earlier setup. Run the simulation again.
            </p>
          )}
          <div className={styles.summary}>
            <span className={styles.dps} data-testid="sim-dps">
              {fmtDec1(r.dps.mean)}
            </span>
            <span className={styles.unit}>DPS ± {fmtDec1(r.dps.stdev)}</span>
            <span className={styles.meta} data-testid="sim-ci">
              95% CI {fmtDec1(r.dps.ci95[0])}–{fmtDec1(r.dps.ci95[1])} · min {fmtDec1(r.dps.min)} · max{" "}
              {fmtDec1(r.dps.max)}
            </span>
          </div>
          <p className={styles.meta}>
            {r.config.iterations} iterations of {r.config.fightSec} s, seed {r.config.seed} ·{" "}
            {fmtInt(r.elapsedMs)} ms
            {analytical !== null && s.key === key && (
              <span data-testid="sim-vs-analytical">
                {" "}
                · analytical {fmtDec1(analytical)} ({r.dps.mean >= analytical ? "+" : "−"}
                {fmtPct((Math.abs(r.dps.mean - analytical) / Math.max(1, analytical)) * 100)})
              </span>
            )}
          </p>
          <p className={styles.meta} data-testid="sim-idle">
            Idle {fmtDec1(r.idleSec)} s per fight
            {r.oomSec > 0.05 ? ` · out of mana ${fmtDec1(r.oomSec)} s (gear enters only as bonus stats)` : ""}
          </p>
          <Sources r={r} />
          <ResourceChart r={r} />
          <Log r={r} />
          {(r.modeled.length > 0 || r.averaged.length > 0) && (
            <ul className={styles.notes}>
              {r.modeled.map((m) => (
                <li key={m}>Simulated: {m}</li>
              ))}
              {r.averaged.map((m) => (
                <li key={m}>Average (analytical): {m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
