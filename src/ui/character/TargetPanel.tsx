import { buffsFile, targetsFile } from "@/data";
import type { MagicSchool } from "@/data/types";
import { CUSTOM_LIMITS, RESIST_ORDER, useCharacter } from "@/state/character";
import { useCalc } from "@/state/store";
import { StatValue } from "@/ui/stats/StatValue";
import { fmtInt, fmtPct } from "@/ui/stats/format";
import { useDerived } from "@/ui/stats/useDerived";
import { BuffCheck, PresetToggle } from "./BuffsPanel";
import styles from "./CharacterPanel.module.css";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function TargetPanel() {
  const target = useCharacter((s) => s.target);
  const custom = useCharacter((s) => s.custom);
  const setTarget = useCharacter((s) => s.setTarget);
  const setCustom = useCharacter((s) => s.setCustom);
  const d = useDerived();
  const level = useCalc((s) => s.level);
  const rows = targetsFile.byPlayerLevel[String(level)] ?? [];
  const num = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

  return (
    <section className={styles.section} aria-labelledby="target-h" data-testid="target-panel">
      <h2 className={styles.heading} id="target-h">
        Target
      </h2>
      <div role="radiogroup" aria-label="Target" className={styles.radios}>
        {targetsFile.presets.map((p) => {
          const row = rows.find((r) => r.preset === p.id);
          const text = p.id === "custom" || !row ? p.label : `${p.label} (${row.level}, ${row.armor} armor)`;
          return (
            <label key={p.id} className={styles.radio}>
              <input
                type="radio"
                name="target"
                value={p.id}
                data-testid={`target-${p.id}`}
                checked={target === p.id}
                onChange={() => setTarget(p.id)}
              />
              <span>{text}</span>
            </label>
          );
        })}
      </div>
      <div className={styles.custom}>
        <label>
          Level
          <input
            type="number"
            className={styles.number}
            data-testid="custom-level"
            disabled={target !== "custom"}
            min={CUSTOM_LIMITS.level[0]}
            max={CUSTOM_LIMITS.level[1]}
            value={custom.level}
            onChange={(e) => setCustom({ level: num(e.target.value, ...CUSTOM_LIMITS.level) })}
          />
        </label>
        <label>
          Armor
          <input
            type="number"
            className={styles.number}
            data-testid="custom-armor"
            disabled={target !== "custom"}
            min={CUSTOM_LIMITS.armor[0]}
            max={CUSTOM_LIMITS.armor[1]}
            value={custom.armor}
            onChange={(e) => setCustom({ armor: num(e.target.value, ...CUSTOM_LIMITS.armor) })}
          />
        </label>
        {RESIST_ORDER.map((sc: MagicSchool, i) => (
          <label key={sc}>
            {cap(sc)} res.
            <input
              type="number"
              className={styles.number}
              data-testid={`custom-resist-${sc}`}
              disabled={target !== "custom"}
              min={CUSTOM_LIMITS.resist[0]}
              max={CUSTOM_LIMITS.resist[1]}
              value={custom.resist[i]}
              onChange={(e) => {
                const resist = [...custom.resist] as typeof custom.resist;
                resist[i] = num(e.target.value, ...CUSTOM_LIMITS.resist);
                setCustom({ resist });
              }}
            />
          </label>
        ))}
      </div>
      <div className={styles.buffGroup}>
        <h3 className={styles.buffTitle}>
          <span>Debuffs</span>
          <PresetToggle preset="raidDebuffs" label="Raid debuffs" />
        </h3>
        <div className={styles.buffList}>
          {buffsFile.buffs
            .filter((b) => b.category === "debuff")
            .map((b) => (
              <BuffCheck key={b.id} buff={b} />
            ))}
        </div>
      </div>
      {d.ok && (
        <div className={styles.result}>
          Armor <StatValue stat={d.view.armor} format={fmtInt} label="Armor" testId="target-armor" /> ·
          Physical damage reduction{" "}
          <StatValue
            stat={d.view.armorReduction}
            format={fmtPct}
            label="Physical damage reduction"
            testId="target-dr"
          />
        </div>
      )}
    </section>
  );
}
