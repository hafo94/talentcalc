import type { AbilityChain, ClassSpellFile, Spell, Talent } from "@/data/types";
import type { RankedTalent } from "@/engine/stats";

export interface Spellbook {
  classSet: number; // SpellClassOptions.SpellClassSet of the class (talent masks are relative to it)
  baseMana: number; // base mana at the character level (percent costs)
  spells: ReadonlyMap<number, Spell>;
  chains: ReadonlyMap<string, AbilityChain>;
}

export function buildSpellbook(file: ClassSpellFile, classSet: number, baseMana: number): Spellbook {
  return {
    classSet,
    baseMana,
    spells: new Map(file.spells.map((s) => [s.id, s])),
    chains: new Map(file.abilities.map((c) => [c.name, c])),
  };
}

export type Learned = { spell: Spell; talent: RankedTalent | null } | { reason: string };

/**
 * Highest rank of `name` learnable at `level` (SpellLevels.BaseLevel <= level). A talent-granted ability (a talent of
 * kind "ability" with the same name) needs a point in that talent; its rank 1 is the talent spell and the trained
 * ranks 2+ are in the ability chain.
 */
export function learn(
  book: Spellbook,
  name: string,
  level: number,
  talents: readonly RankedTalent[],
  classTalents: readonly Talent[],
): Learned {
  const gate = classTalents.find((t) => t.kind === "ability" && t.name === name);
  const taken = gate ? talents.find((r) => r.talent.nodeId === gate.nodeId && r.rank > 0) : undefined;
  if (gate && !taken) return { reason: `needs the talent ${name}` };
  const ids = [...(book.chains.get(name)?.ranks ?? []), ...(taken ? [taken.talent.spellId] : [])];
  const candidates = ids
    .map((id) => book.spells.get(id))
    .filter((s): s is Spell => s !== undefined && (s.levels?.base ?? 0) <= level)
    .sort(
      (a, b) => (a.levels?.base ?? 0) - (b.levels?.base ?? 0) || (a.rank ?? 0) - (b.rank ?? 0) || a.id - b.id,
    );
  const spell = candidates[candidates.length - 1];
  if (!spell) return { reason: ids.length ? `not learned at level ${level}` : `unknown ability ${name}` };
  return { spell, talent: taken ?? null };
}
