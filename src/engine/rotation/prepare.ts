import type { ClassSpellFile, SpecRotation, Spell, Talent } from "@/data/types";
import { buildSpellbook, type Spellbook } from "@/engine/abilities";
import { CAT_FORM, formMask } from "@/engine/combat";
import {
  assemble,
  computeCharacter,
  type AssembleArgs,
  type Assembled,
  type CharacterStats,
  type SourcedEffect,
} from "@/engine/stats";
import { activeHandlers, type ActiveHandler } from "@/engine/talents/special";
import { selfBuffEffects, selfBuffSpells } from "./selfBuffs";

export interface PrepareArgs extends Omit<AssembleArgs, "extraEffects" | "formMask"> {
  /** Phase 6: effects of the pet choice on the owner (resolvePet: Focused Fire, Master Demonologist, sacrifice ...). */
  petOwnerEffects?: readonly SourcedEffect[];
  spells: ClassSpellFile;
  spellClassSet: number; // ClassInfo.spellClassSet
  classTalents: readonly Talent[];
  rotation: SpecRotation;
  extraBuffs?: readonly Spell[]; // Phase 5: active simulator buffs (Death Wish, Arcane Power ...), applied like self-buffs
}
export interface Prepared {
  assembled: Assembled;
  stats: CharacterStats;
  book: Spellbook;
  selfBuffs: Spell[];
  handlers: ActiveHandler[];
}

/**
 * Character stats for a rotation (section 6.2): the rotation's form activates form-only talents, its self-buffs add
 * their caster auras, and talent handlers add static stat effects (Weaponmaster, Predatory Strikes).
 */
export function prepareDamage(a: PrepareArgs): Prepared {
  const cls = a.classToken.toUpperCase() as Uppercase<typeof a.classToken>;
  const book = buildSpellbook(a.spells, a.spellClassSet, a.baseStats.classes[cls]?.mana ?? 0);
  const form = a.rotation.form ?? null;
  const mask = formMask(form);
  const selfBuffs = [
    ...selfBuffSpells(book, a.rotation, a.level, a.talents, a.classTalents),
    ...(a.extraBuffs ?? []),
  ];
  const handlers = activeHandlers(a.talents, mask);
  const extra: SourcedEffect[] = [
    // src: vmangos (Classic 1.12): Cat Form attack power = 2 Str + Agi - 20 (+ Predatory Strikes) [VERIFY Q55]
    ...(form === "cat"
      ? [
          {
            key: "attackPowerFromStat" as const,
            stat: "agi" as const,
            value: CAT_FORM.apPerAgi * 100,
            label: "Cat Form",
            kind: "rule" as const,
          },
        ]
      : []),
    ...selfBuffEffects(selfBuffs),
    ...handlers.flatMap((h) => h.handler.stats?.(h.args, { weapons: a.weapons, form, level: a.level }) ?? []),
    ...(a.petOwnerEffects ?? []),
  ];
  const assembled = assemble({ ...a, extraEffects: extra, formMask: mask });
  return { assembled, stats: computeCharacter(assembled.input), book, selfBuffs, handlers };
}
