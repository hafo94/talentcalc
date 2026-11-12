import type { AbilityResult } from "@/engine/abilities";
import type { Derived } from "@/state/derived";
import { AbilityCard } from "@/ui/abilities/AbilityCard";
import abilityStyles from "@/ui/abilities/Abilities.module.css";
import { fmtDec1, fmtDec2, fmtInt, fmtPct } from "@/ui/stats/format";
import { useDerived } from "@/ui/stats/useDerived";
import { slug } from "./slug";
import styles from "./DamagePanel.module.css";

type Ok = Extract<Derived, { ok: true }>;
const TIER_TEXT = {
  1: "Fully modeled",
  2: "Generic model: some talents of this spec are not modeled",
  3: "Basic damage rotation for a tank or healer spec",
} as const;

function Breakdown({ d }: { d: Ok }) {
  const r = d.damage!.result.rotation;
  const rows: { key: string; perMinute: number | null; dps: number }[] = [
    ...r.casts
      .filter((c) => c.perMinute > 0)
      .map((c) => ({ key: c.key, perMinute: c.perMinute, dps: c.dps })),
    ...Object.values(r.white).map((w) => ({
      key: w!.white.name,
      perMinute: w!.swingsPerMinute,
      dps: w!.dps,
    })),
    ...r.extras.map((x) => ({ key: x.label, perMinute: null, dps: x.dps })),
  ].sort((a, b) => b.dps - a.dps);
  return (
    <table className={styles.table} data-testid="dps-breakdown">
      <caption>Damage per second by source (per minute averages)</caption>
      <thead>
        <tr>
          <th>Source</th>
          <th>Per minute</th>
          <th>DPS</th>
          <th>Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.key} data-testid={`dps-row-${slug(x.key)}`}>
            <td>{x.key}</td>
            <td>{x.perMinute === null ? "–" : fmtDec2(x.perMinute)}</td>
            <td>{fmtDec1(x.dps)}</td>
            <td>{fmtPct(r.dps > 0 ? (x.dps / r.dps) * 100 : 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Resource({ d }: { d: Ok }) {
  const r = d.damage!.result.rotation;
  let text: string;
  if (r.resource)
    text = `${r.resource.power}: ${fmtInt(r.resource.incomePerMinute)} gained per minute, all spent`;
  else if (r.manaPerSecond > 0)
    text = `Mana: ${fmtDec1(r.manaPerSecond)} per second${r.oomSeconds ? `, out of mana after ${fmtInt(r.oomSeconds)} s without regeneration` : ""}`;
  else text = "No resource cost";
  return (
    <p className={styles.line} data-testid="dps-resource">
      {text} · {fmtPct(r.timeUsedPct)} of the time casting
    </p>
  );
}

/** Damage of the default rotation vs the selected target, then one card per ability. */
export function DamagePanel() {
  const d = useDerived();
  if (!d.ok) return null;
  if (!d.damage)
    return (
      <section className={styles.panel} data-testid="damage-panel">
        <h2 className={styles.title}>Damage</h2>
        <p className={styles.line}>Loading spells…</p>
      </section>
    );
  const { rotation, result } = d.damage;
  const r = result.rotation;
  const perMinute = new Map(r.casts.map((c) => [c.key, c.perMinute]));
  const cards: AbilityResult[] = [
    ...result.abilities.filter((a): a is AbilityResult => a.available),
    ...r.casts.filter((c) => c.entry === null).map((c) => c.ability),
  ];
  return (
    <section className={styles.panel} data-testid="damage-panel">
      <h2 className={styles.title}>Damage</h2>
      <div className={styles.summary}>
        <span className={styles.dps} data-testid="dps-total">
          {fmtDec1(r.dps)}
        </span>
        <span className={styles.unit}>DPS</span>
        <span className={styles.rotation} data-testid="dps-rotation">
          {rotation.label}
          <span className={styles.badge} title={TIER_TEXT[rotation.tier]} data-testid="dps-tier">
            Tier {rotation.tier}
          </span>
        </span>
      </div>
      <p className={styles.line}>
        {TIER_TEXT[rotation.tier]}. Analytical average; procs and uptimes as expected values.
      </p>
      <Resource d={d} />
      <Breakdown d={d} />
      <div className={abilityStyles.grid}>
        {cards.map((a) => (
          <AbilityCard key={a.key} a={a} perMinute={perMinute.get(a.key) ?? null} />
        ))}
      </div>
      {r.skipped.length > 0 && (
        <ul className={abilityStyles.unavailable} data-testid="dps-skipped">
          {r.skipped.map((s) => (
            <li key={s.ability}>
              {s.ability}: {s.reason}
            </li>
          ))}
        </ul>
      )}
      {rotation.notes.map((n) => (
        <p key={n} className={styles.note}>
          {n}
        </p>
      ))}
    </section>
  );
}
