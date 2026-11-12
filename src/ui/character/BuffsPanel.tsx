import { buffsFile } from "@/data";
import type { BuffCategory, BuffDef } from "@/data/types";
import { useCharacter } from "@/state/character";
import { effectsSummary } from "./effectText";
import styles from "./CharacterPanel.module.css";

export function BuffCheck({ buff }: { buff: BuffDef }) {
  const checked = useCharacter((s) => s.buffIds.includes(buff.id));
  const toggle = useCharacter((s) => s.toggleBuff);
  const title = (buff.notes ?? "") + (buff.classic ? ` Classic 1.12: ${buff.classic}.` : "");
  return (
    <label className={styles.buff} title={title.trim() || undefined}>
      <input
        type="checkbox"
        data-testid={`buff-${buff.id}`}
        checked={checked}
        onChange={() => toggle(buff.id)}
      />
      <span>
        {buff.name} <span className={styles.dim}>{effectsSummary(buff.effects)}</span>
      </span>
    </label>
  );
}

const GROUPS: { category: BuffCategory; title: string; note?: string }[] = [
  { category: "raid", title: "Raid buffs" },
  {
    category: "world",
    title: "World buffs",
    note: "Forever: world buffs have no effect inside raid instances.",
  },
  { category: "consumable", title: "Consumables" },
  { category: "weapon", title: "Weapon (main hand)" },
];

export function PresetToggle({ preset, label }: { preset: "raidBuffs" | "raidDebuffs"; label: string }) {
  const pressed = useCharacter((s) => buffsFile.presets[preset].every((id) => s.buffIds.includes(id)));
  const setPreset = useCharacter((s) => s.setPreset);
  return (
    <button
      type="button"
      className={styles.btn}
      aria-pressed={pressed}
      data-testid={`preset-${preset}`}
      onClick={() => setPreset(preset, !pressed)}
    >
      {label}
    </button>
  );
}

export function BuffsPanel() {
  return (
    <section className={styles.section} aria-labelledby="buffs-h">
      <h2 className={styles.heading} id="buffs-h">
        Buffs and consumables
      </h2>
      {GROUPS.map((g) => (
        <div key={g.category} className={styles.buffGroup}>
          <h3 className={styles.buffTitle}>
            <span>{g.title}</span>
            {g.category === "raid" && <PresetToggle preset="raidBuffs" label="Raid buffed" />}
          </h3>
          {g.note && <p className={styles.hint}>{g.note}</p>}
          <div className={styles.buffList}>
            {buffsFile.buffs
              .filter((b) => b.category === g.category)
              .map((b) => (
                <BuffCheck key={b.id} buff={b} />
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}
