import type { ClassToken, PetFile, PetsManualFile, Spell } from "@/data/types";
import { mapAura, type RankedTalent, type SourcedEffect } from "@/engine/stats";
import { AURA_DAMAGE_DONE, PET_TALENT } from "./constants";
import type { PetChoice, ResolvedPet } from "./types";

const ranked = (talents: readonly RankedTalent[], spellId: number) =>
  talents.find((t) => t.talent.spellId === spellId && t.rank > 0);
const valueOf = (t: RankedTalent, i: number) => t.talent.ranks[t.rank - 1]?.values[i] ?? 0;
const labelOf = (t: RankedTalent) => `${t.talent.name} ${t.rank}/${t.talent.maxRank}`;

/** Aura 79 effects of a spell as damage-done effects (value: the talent's rank value, else the spell's own). */
function damageAuras(spell: Spell | undefined, label: string, value?: number): SourcedEffect[] {
  if (!spell) return [];
  return spell.effects
    .filter((e) => e.aura === AURA_DAMAGE_DONE)
    .flatMap((e) => {
      const m = mapAura(e, value ?? e.base);
      return m.kind === "damageDone" ? m.effects.map((x) => ({ ...x, label, kind: "talent" as const })) : [];
    });
}

/**
 * What a pet choice does with the current talents (section 4.2): the active pet (null: none or not a pet of this
 * class), the effects on the owner, and notes for choices that do nothing. Demonic Sacrifice needs the talent and is
 * cancelled by summoning a demon, unless Demonic Pact is taken and the demon is a different one. Pure.
 */
export function resolvePet(a: {
  choice: PetChoice;
  file: PetFile | null;
  manual: PetsManualFile;
  token: ClassToken;
  talents: readonly RankedTalent[];
  level: number;
}): ResolvedPet {
  const { choice, file, manual, talents, level } = a;
  const config = manual.owners[a.token];
  if (!file || !config) return { pet: null, ownerEffects: [], notes: [] };
  const spells = new Map(file.spells.map((s) => [s.id, s]));
  const info = file.pets.find((p) => p.id === choice.family) ?? null;
  const notes: string[] = [];
  const shared: SourcedEffect[] = [];
  if (info) {
    const ff = ranked(talents, PET_TALENT.FOCUSED_FIRE);
    if (ff && valueOf(ff, 0) !== 0)
      shared.push({ key: "damageDonePct", value: valueOf(ff, 0), label: labelOf(ff), kind: "talent" });
    const md = ranked(talents, PET_TALENT.MASTER_DEMONOLOGIST);
    const mdRef = manual.masterDemonologist.find((m) => m.family === info.id);
    if (md && mdRef)
      shared.push(...damageAuras(spells.get(mdRef.spellId), labelOf(md), valueOf(md, mdRef.valueIndex)));
    if (ranked(talents, PET_TALENT.SOUL_LINK))
      shared.push(...damageAuras(spells.get(manual.soulLink.spellId), "Soul Link"));
    const dk = ranked(talents, PET_TALENT.DEMONIC_KNOWLEDGE);
    if (dk && valueOf(dk, 0) !== 0)
      shared.push({
        key: "spellPower",
        value: (valueOf(dk, 0) * level) / 100,
        label: `${labelOf(dk)} (${valueOf(dk, 0)}% of level ${level})`,
        kind: "talent",
      });
  }
  const ownerOnly: SourcedEffect[] = [];
  const ref = choice.sacrifice ? manual.sacrifice.find((s) => s.family === choice.sacrifice) : undefined;
  if (ref) {
    const pact = ranked(talents, PET_TALENT.DEMONIC_PACT);
    if (!ranked(talents, PET_TALENT.DEMONIC_SACRIFICE))
      notes.push("Demonic Sacrifice needs the talent Demonic Sacrifice.");
    else if (info && (!pact || info.id === ref.family))
      notes.push(
        pact
          ? `Summoning the sacrificed ${ref.name} cancels Demonic Sacrifice.`
          : "Summoning a demon cancels Demonic Sacrifice (Demonic Pact keeps it for a different demon).",
      );
    else {
      const fx = damageAuras(spells.get(ref.spellId), `Demonic Sacrifice (${ref.name}): ${ref.spellName}`);
      if (fx.length === 0)
        notes.push(`${ref.spellName} (${ref.name}) restores health or mana: no damage effect.`);
      ownerOnly.push(...fx);
    }
  }
  return {
    pet: info ? { info, spells: file.spells, config, scaling: choice.scaling, effects: shared } : null,
    ownerEffects: [...shared, ...ownerOnly],
    notes,
  };
}
