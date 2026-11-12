import type { Stat } from "@/engine/stats";
import { StatValue } from "./StatValue";
import { fmtDec1, fmtInt, fmtPct } from "./format";
import { useDerived } from "./useDerived";
import styles from "./StatStrip.module.css";

interface Field {
  testId: string;
  label: string;
  stat: Stat;
  format: (n: number) => string;
}

/** Compact stat line under the points bar, so every talent click shows its effect. */
export function StatStrip() {
  const d = useDerived();
  if (!d.ok) {
    return d.reason === "level" ? (
      <div className={styles.strip} data-testid="stat-strip">
        <span className={styles.note}>Stats: level 60 only</span>
      </div>
    ) : null;
  }
  const { stats, view } = d;
  const token = stats.classToken;
  let fields: Field[];
  if (token === "mage" || token === "priest" || token === "warlock") {
    const best = Object.values(stats.spellPower).reduce((a, b) => (b.value > a.value ? b : a));
    fields = [
      { testId: "strip-sp", label: "Spell power", stat: best, format: fmtInt },
      { testId: "strip-crit", label: "Spell crit vs target", stat: view.spell.crit, format: fmtPct },
      { testId: "strip-miss", label: "Spell miss vs target", stat: view.spell.miss, format: fmtPct },
      ...(stats.mana ? [{ testId: "strip-mana", label: "Mana", stat: stats.mana, format: fmtInt }] : []),
    ];
  } else if (token === "hunter" && stats.rangedAttackPower) {
    const o = view.ranged ?? view.mainHand;
    fields = [
      { testId: "strip-ap", label: "Ranged AP", stat: stats.rangedAttackPower, format: fmtInt },
      ...(o
        ? [
            { testId: "strip-crit", label: "Crit vs target", stat: o.crit, format: fmtPct },
            { testId: "strip-miss", label: "Miss vs target", stat: o.miss, format: fmtPct },
          ]
        : []),
      { testId: "strip-dr", label: "Armor DR", stat: view.armorReduction, format: fmtPct },
    ];
  } else {
    const o = view.mainHand;
    fields = [
      { testId: "strip-ap", label: "Attack power", stat: stats.attackPower, format: fmtInt },
      ...(o
        ? [
            { testId: "strip-crit", label: "Crit vs target", stat: o.crit, format: fmtPct },
            { testId: "strip-miss", label: "Miss vs target", stat: o.miss, format: fmtPct },
          ]
        : []),
      { testId: "strip-dr", label: "Armor DR", stat: view.armorReduction, format: fmtPct },
    ];
  }
  const dps = d.damage?.result.rotation.dps;
  return (
    <div className={styles.strip} data-testid="stat-strip" aria-label="Key stats">
      {dps !== undefined && (
        <span className={styles.item}>
          <span className={styles.label}>DPS</span>
          <span data-testid="strip-dps">{fmtDec1(dps)}</span>
        </span>
      )}
      {fields.map((f) => (
        <span key={f.testId} className={styles.item}>
          <span className={styles.label}>{f.label}</span>
          <StatValue stat={f.stat} format={f.format} label={f.label} testId={f.testId} />
        </span>
      ))}
    </div>
  );
}
