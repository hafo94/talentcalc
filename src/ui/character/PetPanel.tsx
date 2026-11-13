import { petsManual } from "@/data";
import type { PetFile, PetInfo } from "@/data/types";
import { PET_TALENT } from "@/engine/pets";
import { useCharacter } from "@/state/character";
import { useCalc } from "@/state/store";
import styles from "./CharacterPanel.module.css";

/** Family damage modifier of a pet from its family passive (aura 79 on physical, e.g. Cat +10%). */
function familyText(p: PetInfo, file: PetFile): string {
  for (const id of p.passives) {
    const s = file.spells.find((x) => x.id === id);
    const e =
      s?.name === "Tamed Pet Passive (DND)" ? s.effects.find((x) => x.aura === 79 && x.misc[0] === 1) : null;
    if (e && e.base !== 0) return ` (${e.base > 0 ? "+" : ""}${e.base}% damage)`;
  }
  return "";
}

/** Phase 6: active pet, sacrificed demon (warlock) and owner scaling (Q5). Hunters and warlocks only. */
export function PetPanel() {
  const file = useCalc((s) => s.pets);
  const tree = useCalc((s) => s.tree);
  const ranks = useCalc((s) => s.ranks);
  const pet = useCharacter((s) => s.pet);
  const setPet = useCharacter((s) => s.setPet);
  if (!file || !tree) return null;
  const hasTalent = (spellId: number) =>
    tree.order.some((id) => tree.nodes.get(id)!.talent.spellId === spellId && (ranks[id] ?? 0) > 0);
  const pets = [...file.pets].sort((a, b) => a.name.localeCompare(b.name));
  const warlock = file.token === "warlock";
  const canSacrifice = hasTalent(PET_TALENT.DEMONIC_SACRIFICE);
  const pact = hasTalent(PET_TALENT.DEMONIC_PACT);
  const scaling = petsManual.owners[file.token]?.scaling;
  return (
    <section className={styles.section} aria-labelledby="pet-h" data-testid="pet-panel">
      <h2 className={styles.heading} id="pet-h">
        {warlock ? "Demon" : "Pet"}
      </h2>
      <div className={styles.field}>
        <select
          className={styles.select}
          data-testid="pet-select"
          aria-label={warlock ? "Demon" : "Pet"}
          value={pet.family}
          onChange={(e) => setPet({ family: Number(e.target.value) })}
        >
          <option value={0}>None</option>
          {pets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.exotic ? " (exotic)" : ""}
              {familyText(p, file)}
            </option>
          ))}
        </select>
      </div>
      {warlock && (
        <div className={styles.field}>
          <label htmlFor="pet-sacrifice" className={styles.dim}>
            Demonic Sacrifice
          </label>
          <select
            id="pet-sacrifice"
            className={styles.select}
            data-testid="pet-sacrifice"
            disabled={!canSacrifice}
            title={canSacrifice ? undefined : "Needs the talent Demonic Sacrifice"}
            value={pet.sacrifice}
            onChange={(e) => {
              const sacrifice = Number(e.target.value);
              // Summoning a demon cancels the sacrifice unless Demonic Pact keeps it for a different demon.
              const family = sacrifice && (!pact || pet.family === sacrifice) ? 0 : pet.family;
              setPet({ sacrifice, family });
            }}
          >
            <option value={0}>None</option>
            {petsManual.sacrifice.map((s) => (
              <option key={s.family} value={s.family}>
                {s.name} ({s.spellName})
              </option>
            ))}
          </select>
        </div>
      )}
      <label className={styles.buff}>
        <input
          type="checkbox"
          data-testid="pet-scaling"
          checked={pet.scaling}
          onChange={(e) => setPet({ scaling: e.target.checked })}
        />
        <span>
          Pet scales with your stats{" "}
          <span className={styles.dim}>
            {scaling
              ? `(${scaling.attackPowerPct}% of your ${warlock ? "spell power" : "ranged attack power"} as attack power, ${scaling.spellPowerPct}% as spell power${scaling.inheritHit ? ", your hit" : ""})`
              : ""}
          </span>
        </span>
      </label>
      <p className={styles.hint}>
        Pet stats are unverified Classic/TBC values (Q5). Pet damage is added to the DPS in the Damage and
        Simulation panels.
      </p>
    </section>
  );
}
