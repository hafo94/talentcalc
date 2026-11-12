import type { AttackSlot, MagicSchool, School } from "@/data/types";
import {
  MAGIC_SCHOOLS,
  SCHOOL_BITS,
  SKILL_PER_LEVEL,
  type MeleeOutcome,
  type TargetView,
} from "@/engine/stats";
import {
  PHYSICAL_CRIT_BONUS,
  RESIST_PER_LEVEL,
  SPELL_CRIT_BONUS,
  averageResist,
  glancingMultiplier,
} from "./constants";

export type AttackKind = "spell" | "melee" | "ranged";

/** Schools of a SpellSchoolMask, physical first. */
export function schoolsOf(mask: number): School[] {
  return SCHOOL_BITS.filter((_, i) => (mask & (1 << i)) !== 0);
}
/** The school used for spell power, damage-done and display: the first magic school, else physical. */
export function primarySchool(mask: number): School {
  const s = schoolsOf(mask);
  return s.find((x) => x !== "physical") ?? "physical";
}

/** Two-roll special attack (melee or ranged) or spell: chance to land and crit chance, in %. */
export interface RollChances {
  land: number; // % of casts that hit (spell: 100 - miss; melee: 100 - miss - dodge - parry; ranged: 100 - miss)
  crit: number; // % of landed hits that crit
  critBonus: number; // extra damage of a crit (0.5 = 150%)
}

/** Base chances for a special attack from a slot's outcome table; `hitBonus` = SpellMod op 16 (percent points). */
export function specialChances(
  o: MeleeOutcome,
  ranged: boolean,
  hitBonus: number,
  critBonusPct: number,
): RollChances {
  const miss = Math.max(0, o.miss.value - hitBonus);
  const dodge = ranged ? 0 : o.dodge.value; // [VERIFY Q49] ranged attacks are not dodged
  return {
    land: Math.max(0, 100 - miss - dodge - o.parry - o.block),
    crit: Math.max(0, o.crit.value + critBonusPct),
    critBonus: PHYSICAL_CRIT_BONUS,
  };
}

export function spellChances(view: TargetView, hitBonus: number, critBonusPct: number): RollChances {
  const miss = Math.max(1, view.spell.miss.value - hitBonus);
  return {
    land: 100 - miss,
    crit: Math.max(0, view.spell.crit.value + critBonusPct),
    critBonus: SPELL_CRIT_BONUS,
  };
}

/** Expected damage factor of one cast: land x (1 + crit x bonus x critDamageMult). */
export function expectedFactor(c: RollChances, critDamageMult = 1): number {
  const crit = Math.min(100, c.crit) / 100;
  return (c.land / 100) * (1 + crit * c.critBonus * critDamageMult);
}

/** White melee (single roll): fractions of swings, in %, and the expected damage factor of one swing. */
export interface WhiteTable {
  miss: number;
  dodge: number;
  glancing: number;
  crit: number;
  hit: number;
  glancingMultiplier: number;
  factor: number; // expected damage of a swing / damage of a normal hit
}
export function whiteTable(
  o: MeleeOutcome,
  slot: AttackSlot,
  skill: number,
  targetLevel: number,
  critDamageMult = 1,
): WhiteTable {
  const ranged = slot === "ranged";
  const miss = ranged ? o.miss.value : o.whiteMiss.value;
  const dodge = ranged ? 0 : o.dodge.value;
  const glancing = ranged ? 0 : o.glancing;
  const cap = Math.max(0, 100 - miss - dodge - o.parry - o.block - glancing);
  const crit = Math.min(o.crit.value, cap);
  const hit = Math.max(0, cap - crit);
  const gm = glancingMultiplier(targetLevel * SKILL_PER_LEVEL - skill);
  const factor = (hit + glancing * gm + crit * (1 + PHYSICAL_CRIT_BONUS * critDamageMult)) / 100;
  return { miss, dodge, glancing, crit, hit, glancingMultiplier: gm, factor };
}

/** Physical damage that is not a bleed is reduced by armor. */
export function armorFactor(view: TargetView, school: School, bleed: boolean): number {
  return school === "physical" && !bleed ? 1 - view.armorReduction.value / 100 : 1;
}

/**
 * Average partial resist of a magic school (holy and physical: 0). A multi-school spell uses the lowest resistance
 * of its schools (Frostfire Bolt tooltip). Level-based resistance: 8 per level above the caster.
 */
export function resistFactor(view: TargetView, schoolMask: number, casterLevel: number): number {
  const magic = schoolsOf(schoolMask).filter((s): s is MagicSchool => s !== "physical" && s !== "holy");
  if (magic.length === 0) return 1;
  const r = Math.min(...magic.map((s) => view.resist[s].value));
  const levelResist = Math.max(0, view.level - casterLevel) * RESIST_PER_LEVEL;
  return 1 - averageResist(r + levelResist, casterLevel);
}

/** Target debuffs such as Curse of the Elements: +x% damage taken by school (the highest of a multi-school spell). */
export function damageTakenFactor(view: TargetView, schoolMask: number): number {
  const pcts = schoolsOf(schoolMask).map((s) => view.damageTakenPct[s] ?? 0);
  return 1 + Math.max(0, ...pcts) / 100;
}

export const isMagic = (s: School): s is MagicSchool => (MAGIC_SCHOOLS as readonly string[]).includes(s);
