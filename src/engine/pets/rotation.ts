import type { PetInfo, RotationEntry, SpecRotation, Spell, Talent } from "@/data/types";
import { buildSpellbook, learn, type Spellbook } from "@/engine/abilities";
import type { RankedTalent } from "@/engine/stats";
import { AURA_DAMAGE_DONE, TARGET_PET } from "./constants";
import type { PetSetup } from "./types";

const DIRECT = new Set([2, 17, 31, 58, 121]); // school damage, weapon damage
const PERIODIC = new Set([3, 53]); // periodic damage, leech

const books = new WeakMap<PetInfo, { owner: readonly Spell[]; book: Spellbook }>();
/**
 * The pet's spellbook: the owner's class spells (Bestial Wrath) plus the pet file's spells; chains = pet abilities.
 * Memoized per pet (data objects are immutable): derive evaluates the pet up to 10 times per click.
 */
export function petBook(setup: PetSetup, ownerSpells: readonly Spell[], classSet: number): Spellbook {
  const hit = books.get(setup.info);
  if (hit && hit.owner === ownerSpells && hit.book.classSet === classSet) return hit.book;
  const book = buildSpellbook(
    {
      build: "",
      classId: 0,
      token: setup.info.owner,
      spells: [...ownerSpells, ...setup.spells],
      abilities: setup.info.abilities.map((c) => ({
        classId: 0,
        name: c.name,
        skillLineId: setup.info.skillLine,
        passive: false,
        ranks: c.ranks,
      })),
    },
    classSet,
    0,
  );
  books.set(setup.info, { owner: ownerSpells, book });
  return book;
}

/**
 * The pet's priority list (section 4.4), from the data: every learned pet ability that deals damage. Cooldown and
 * DoT abilities first (longest cooldown first), then the abilities without a cooldown (Claw, Firebolt, Lightning
 * Breath). Owner talent abilities that put a damage aura on the pet (Bestial Wrath) are pet "burst" entries
 * (simulation only, like the owner's bursts). Imp-like pets (pets.json noMelee) have no white attacks.
 */
export function petRotation(
  setup: PetSetup,
  book: Spellbook,
  level: number,
  talents: readonly RankedTalent[],
  classTalents: readonly Talent[],
): SpecRotation {
  const timed: { entry: RotationEntry; cd: number }[] = [];
  const fillers: RotationEntry[] = [];
  for (const c of setup.info.abilities) {
    const l = learn(book, c.name, level, talents, classTalents);
    if (!("spell" in l)) continue;
    const s = l.spell;
    const direct = s.effects.some((e) => DIRECT.has(e.effect));
    const periodic = s.effects.some((e) => e.effect === 6 && PERIODIC.has(e.aura));
    if (s.passive || (!direct && !periodic)) continue;
    const cd = Math.max(s.cooldownMs, s.categoryCooldownMs);
    if (periodic && !direct) timed.push({ entry: { ability: c.name, kind: "dot" }, cd });
    else if (cd > 0) timed.push({ entry: { ability: c.name, kind: "cooldown" }, cd });
    else fillers.push({ ability: c.name, kind: "filler" });
  }
  timed.sort((a, b) => b.cd - a.cd || a.entry.ability.localeCompare(b.entry.ability));
  const bursts: RotationEntry[] = [];
  for (const t of classTalents) {
    if (t.kind !== "ability") continue;
    const l = learn(book, t.name, level, talents, classTalents);
    if (!("spell" in l)) continue;
    const onPet = l.spell.effects.some((e) => e.aura === AURA_DAMAGE_DONE && e.targets?.[0] === TARGET_PET);
    if (onPet && l.spell.cooldownMs > 0) bursts.push({ ability: t.name, kind: "burst" });
  }
  return {
    id: `pet-${setup.info.id}`,
    class: setup.info.owner,
    spec: 0,
    label: setup.info.name,
    role: "dps",
    tier: 2,
    selfBuffs: [],
    melee: !setup.config.noMelee.includes(setup.info.id),
    autoShot: false,
    entries: [...bursts, ...timed.map((t) => t.entry), ...fillers],
    notes: [],
  };
}
