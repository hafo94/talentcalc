import type {
  ClassSpellFile,
  ClassToken,
  RotationEntry,
  RotationEntryKind,
  RotationsFile,
  Spell,
  Talent,
} from "@/data/types";

/** One ability the rotation editor offers. `id` is its stable URL key (section 5.2). */
export interface CatalogAbility {
  name: string;
  id: number; // first spell id of the rank chain, or the talent spell id for a talent-only ability
  icon: string | null;
  talent: string | null; // the talent that grants it
  entry: RotationEntry; // default entry when added (kind, cp, everySec, requires ... from the default rotations)
}

const WEAPON_OR_SCHOOL_DAMAGE = new Set([2, 17, 31, 58, 121]);
const PERIODIC_DAMAGE = new Set([3, 53]);
const TRIGGER_SPELL = 64;
const PERIODIC_TRIGGER = 23;
/** Caster auras of a cooldown that change damage or resources (same set the simulator applies, section 4.3). */
const BUFF_AURAS = new Set([65, 79, 107, 108, 110, 134, 140, 290, 319, 342]);
const COMBO_POINTS = 4;
const TARGET_CASTER = 1;

const directDamage = (s: Spell) => s.effects.some((e) => WEAPON_OR_SCHOOL_DAMAGE.has(e.effect));
/** Deals damage itself, over time, or through a triggered spell (Mutilate strikes, Arcane Missiles). */
function damaging(s: Spell, spells: ReadonlyMap<number, Spell>): boolean {
  if (directDamage(s)) return true;
  return s.effects.some((e) => {
    if (e.effect === 6 && PERIODIC_DAMAGE.has(e.aura)) return true;
    const triggers = e.effect === TRIGGER_SPELL || (e.effect === 6 && e.aura === PERIODIC_TRIGGER);
    const t = triggers && e.triggerSpell ? spells.get(e.triggerSpell) : undefined;
    return t !== undefined && directDamage(t);
  });
}
/** A cooldown whose caster auras or energize change damage or resources (Death Wish, Evocation, Bloodrage). */
function burst(s: Spell): boolean {
  if (s.cooldownMs <= 0) return false;
  return s.effects.some(
    (e) =>
      (e.effect === 6 && BUFF_AURAS.has(e.aura) && (!e.targets || e.targets[0] === TARGET_CASTER)) ||
      (e.effect === 30 && (e.misc[0] === 1 || e.misc[0] === 3)),
  );
}

/** Kind of a new entry when no default rotation uses the ability (section 5.1). */
export function suggestKind(s: Spell): RotationEntryKind {
  const direct = directDamage(s) || s.effects.some((e) => e.effect === TRIGGER_SPELL);
  const periodic = s.effects.some(
    (e) => e.effect === 6 && (PERIODIC_DAMAGE.has(e.aura) || e.aura === PERIODIC_TRIGGER),
  );
  if (s.effects.some((e) => (e.pointsPerCombo ?? 0) !== 0)) return "finisher";
  if (s.effects.some((e) => e.effect === 30 && e.misc[0] === COMBO_POINTS)) return "builder";
  if (!direct && !periodic) return "burst";
  if (periodic && !direct && !s.channeled) return "dot";
  if (s.gcdMs === 0 && s.effects.some((e) => e.effect === 17) && s.cooldownMs === 0) return "nextSwing";
  if (s.cooldownMs > 0 || s.categoryCooldownMs > 0) return "cooldown";
  return "filler";
}

/**
 * Abilities of a class for the rotation editor: rank chains and talent abilities that deal damage, are buff cooldowns,
 * or appear in a default rotation. Sorted by name. Pure.
 */
export function abilityCatalog(
  file: ClassSpellFile,
  classTalents: readonly Talent[],
  rotations: RotationsFile,
  token: ClassToken,
): CatalogAbility[] {
  const spells = new Map(file.spells.map((s) => [s.id, s]));
  const defaults = new Map<string, RotationEntry>();
  for (const r of rotations.rotations.filter((x) => x.class === token))
    for (const e of r.entries) if (!defaults.has(e.ability)) defaults.set(e.ability, e);
  const out = new Map<string, CatalogAbility>();
  const add = (name: string, id: number, top: Spell | undefined, talent: string | null) => {
    if (!top || out.has(name)) return;
    if (!defaults.has(name) && (top.passive || (!damaging(top, spells) && !burst(top)))) return;
    const entry = defaults.get(name) ?? { ability: name, kind: suggestKind(top) };
    out.set(name, { name, id, icon: top.icon, talent, entry: structuredClone(entry) });
  };
  for (const c of file.abilities) {
    if (c.passive || c.ranks.length === 0) continue;
    const talent = classTalents.find((t) => t.kind === "ability" && t.name === c.name);
    add(c.name, c.ranks[0]!, spells.get(c.ranks[c.ranks.length - 1]!), talent?.name ?? null);
  }
  for (const t of classTalents)
    if (t.kind === "ability") add(t.name, t.spellId, spells.get(t.spellId), t.name);
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
