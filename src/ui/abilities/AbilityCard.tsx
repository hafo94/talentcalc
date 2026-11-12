import type { AbilityResult } from "@/engine/abilities";
import { WowIcon } from "@/ui/common/WowIcon";
import { fmtDec1, fmtDec2, fmtInt, fmtPct } from "@/ui/stats/format";
import { slug } from "@/ui/results/slug";
import styles from "./Abilities.module.css";

const POWER_LABEL = { mana: "mana", rage: "rage", energy: "energy", focus: "focus" } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td data-testid={testId}>{value}</td>
    </tr>
  );
}

/** One ability vs the selected target: per-cast numbers, chances, timing, cost and what modifies it. */
export function AbilityCard({ a, perMinute }: { a: AbilityResult; perMinute: number | null }) {
  const id = slug(a.key);
  const timing =
    a.channelTime > 0
      ? `${fmtDec2(a.channelTime)} s channel`
      : a.castTime > 0
        ? `${fmtDec2(a.castTime)} s cast`
        : a.timeCost > 0
          ? "Instant"
          : "Instant, off the GCD";
  return (
    <article className={styles.card} data-testid={`ability-${id}`} aria-label={a.key}>
      <header className={styles.head}>
        <WowIcon name={a.icon} size={32} />
        <div>
          <div className={styles.name}>{a.key}</div>
          <div className={styles.meta}>
            {a.rank !== null ? `Rank ${a.rank} · ` : ""}
            {cap(a.school)} · {a.kind === "spell" ? "spell" : `${a.kind} attack`}
          </div>
        </div>
      </header>
      <table className={styles.rows}>
        <tbody>
          {a.hit > 0 && (
            <Row
              label="Hit"
              value={`${fmtInt(a.hit)}${a.hitRange ? ` (${fmtInt(a.hitRange[0])}–${fmtInt(a.hitRange[1])})` : ""}`}
              testId={`ability-${id}-hit`}
            />
          )}
          {a.hit > 0 && <Row label="Crit" value={fmtInt(a.crit)} testId={`ability-${id}-crit`} />}
          {a.tick > 0 && (
            <Row label="Tick" value={`${fmtInt(a.tick)} x ${a.ticks}`} testId={`ability-${id}-tick`} />
          )}
          {a.extras.map((x) => (
            <Row key={x.label} label={x.label} value={`+${fmtDec1(x.value)} per cast`} />
          ))}
          <Row label="Per cast (expected)" value={fmtDec1(a.expected)} testId={`ability-${id}-expected`} />
          <Row label="Per second of cast time" value={fmtDec1(a.dpct)} testId={`ability-${id}-dpct`} />
          <Row label="Hit chance" value={fmtPct(a.hitChance)} testId={`ability-${id}-hitchance`} />
          <Row label="Crit chance" value={fmtPct(a.critChance)} testId={`ability-${id}-critchance`} />
          <Row label="Time" value={timing} />
          {a.cooldown > 0 && <Row label="Cooldown" value={`${fmtDec1(a.cooldown)} s`} />}
          {a.power && a.cost > 0 && <Row label="Cost" value={`${fmtInt(a.cost)} ${POWER_LABEL[a.power]}`} />}
          {perMinute !== null && <Row label="Casts per minute" value={fmtDec2(perMinute)} />}
        </tbody>
      </table>
      {a.sources.length > 0 && (
        <ul className={styles.sources} aria-label={`${a.key} is modified by`}>
          {a.sources.map((s, i) => (
            <li key={i} className={styles[s.kind]}>
              {s.label}: {s.text}
            </li>
          ))}
        </ul>
      )}
      {a.notes.map((n) => (
        <p key={n} className={styles.note}>
          {n}
        </p>
      ))}
    </article>
  );
}
