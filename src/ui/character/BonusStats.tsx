import type { BonusStats as Bonus } from "@/engine/stats";
import { BONUS_LIMITS, useCharacter } from "@/state/character";
import { BONUS_SCALE } from "@/state/charCode";
import styles from "./CharacterPanel.module.css";

type Key = keyof Bonus;
const GROUPS: { title: string; fields: [Key, string][]; spell?: boolean }[] = [
  {
    title: "Attributes",
    fields: [
      ["str", "Strength"],
      ["agi", "Agility"],
      ["sta", "Stamina"],
      ["int", "Intellect"],
      ["spi", "Spirit"],
    ],
  },
  {
    title: "Physical",
    fields: [
      ["attackPower", "Attack power"],
      ["rangedAttackPower", "Ranged attack power"],
      ["hit", "Hit %"],
      ["crit", "Crit %"],
      ["haste", "Haste %"],
      ["weaponSkill", "Weapon skill"],
    ],
  },
  {
    title: "Spell",
    spell: true,
    fields: [
      ["spellPower", "Spell power (all schools)"],
      ["holySpellPower", "Holy spell power"],
      ["fireSpellPower", "Fire spell power"],
      ["natureSpellPower", "Nature spell power"],
      ["frostSpellPower", "Frost spell power"],
      ["shadowSpellPower", "Shadow spell power"],
      ["arcaneSpellPower", "Arcane spell power"],
      ["spellHit", "Spell hit %"],
      ["spellCrit", "Spell crit %"],
    ],
  },
];

export function BonusStats({ hasSpell, hasRap }: { hasSpell: boolean; hasRap: boolean }) {
  const bonus = useCharacter((s) => s.bonus);
  const setBonus = useCharacter((s) => s.setBonus);
  const reset = useCharacter((s) => s.resetBonus);
  return (
    <section className={styles.section} aria-labelledby="bonus-h">
      <h2 className={styles.heading} id="bonus-h">
        Bonus stats
        <button type="button" className={styles.btn} onClick={reset}>
          Reset
        </button>
      </h2>
      <p className={styles.hint}>Totals from gear other than weapons (weapons are added automatically).</p>
      {GROUPS.filter((g) => !g.spell || hasSpell).map((g) => (
        <fieldset key={g.title} className={styles.fieldset}>
          <legend>{g.title}</legend>
          <div className={styles.grid}>
            {g.fields
              .filter(([k]) => k !== "rangedAttackPower" || hasRap)
              .map(([k, label]) => {
                const [min, max] = BONUS_LIMITS[k];
                const step = 1 / (BONUS_SCALE[k] ?? 1);
                return (
                  <div key={k} className={styles.bonus}>
                    <label htmlFor={`bonus-${k}`}>{label}</label>
                    <input
                      type="number"
                      id={`bonus-${k}`}
                      className={styles.number}
                      data-testid={`bonus-${k}`}
                      min={min}
                      max={max}
                      step={step}
                      value={bonus[k]}
                      onChange={(e) => setBonus(k, Number(e.target.value) || 0)}
                    />
                  </div>
                );
              })}
          </div>
        </fieldset>
      ))}
    </section>
  );
}
