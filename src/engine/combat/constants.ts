// Phase 4 combat constants. Classic 1.12 values unless stated; none is confirmed in Forever ([VERIFY], Q3/Q47-Q58).

/** src: Classic 1.12: spells crit for 150% (bonus 0.5), melee and ranged attacks for 200% (bonus 1.0). [VERIFY Q3] */
export const SPELL_CRIT_BONUS = 0.5;
export const PHYSICAL_CRIT_BONUS = 1.0;

/**
 * src: vmangos Unit::CalculateGlancingDamage (Classic 1.12, recalled): a glancing blow deals a uniform random
 * fraction between low = clamp(1.3 - 0.05 d, 0.01, 0.91) and high = clamp(1.2 - 0.03 d, 0.2, 0.99) of the damage,
 * d = defense - weapon skill. 300 vs 315: 0.55..0.75 (average 0.65, i.e. -35%); 308 vs 315: -5%. [VERIFY Q34]
 */
export function glancingMultiplier(defenseMinusSkill: number): number {
  const d = defenseMinusSkill;
  const low = Math.min(0.91, Math.max(0.01, 1.3 - 0.05 * d));
  const high = Math.min(0.99, Math.max(0.2, 1.2 - 0.03 * d));
  return (low + high) / 2;
}

/** src: Classic 1.12 normalized weapon speeds for instant attacks (effect 121). Cat Form uses its own 1.0. [VERIFY] */
export const NORMALIZED_SPEED = { dagger: 1.7, oneHand: 2.4, twoHand: 3.3, ranged: 2.8 } as const;
export const DAGGER_SUBCLASS = 15;

/**
 * src: Classic 1.12 average partial resist for non-binary spells: 0.75 x R / (5 x casterLevel), cap 0.75; targets
 * above the caster's level add 8 resistance per level (boss +3: 24 -> 6.0%). Holy cannot be resisted. [VERIFY Q50]
 */
export const RESIST_PER_LEVEL = 8;
export const MAX_AVERAGE_RESIST = 0.75;
export function averageResist(resistance: number, casterLevel: number): number {
  return Math.min(MAX_AVERAGE_RESIST, (0.75 * Math.max(0, resistance)) / (5 * casterLevel));
}

/**
 * src: vmangos Player::RewardRage (Classic 1.12): rage from damage dealt = 7.5 x damage / c(L),
 * c(L) = 0.0091107836 L^2 + 3.225598133 L + 4.2652911 (230.6 at 60). A Heroic Strike swing generates no rage. [VERIFY Q51]
 */
export function rageConversion(level: number): number {
  return 0.0091107836 * level * level + 3.225598133 * level + 4.2652911;
}
export const RAGE_PER_DAMAGE_FACTOR = 7.5;
/** src: Classic: energy regenerates 20 per 2 sec tick. [VERIFY] */
export const ENERGY_PER_SECOND = 10;

/** src: SpellCastTimes Base -1000000 on instant hunter shots (Arcane Shot, Serpent Sting ...): treated as instant. */
export const INSTANT_CAST_SENTINEL = 0;

/** src: Classic 1.12 Seal of Command: 7 procs per minute (not in client data; proc chance 100 in SpellAuraOptions). [VERIFY Q54] */
export const SEAL_OF_COMMAND_PPM = 7;
/** src: Windfury Weapon rank 4 (16362) tooltip "Each hit has a 20% chance of granting you 2 extra attacks with 333 extra
 * melee attack power" (the enchant values are not exported). Main-hand white hits only. [VERIFY Q54] */
export const WINDFURY = { chance: 20, attacks: 2, attackPower: 333 } as const;
/** src: Seal of Command tooltip "$/2;20966s1 Holy damage, $20966s1 if the target is stunned": half damage. [VERIFY] */
export const JUDGEMENT_DAMAGE_FACTOR: Readonly<Record<string, number>> = { "Judgement of Command": 0.5 };

/** src: vmangos Player::UpdateDamagePhysical (Classic 1.12): Cat Form swing 1.0 sec for level x 0.85 .. level x 1.25. [VERIFY Q55] */
export const CAT_FORM = { speed: 1.0, minPerLevel: 0.85, maxPerLevel: 1.25, apPerAgi: 1 } as const;

/**
 * Finisher attack power scaling (not in client data; descriptions say "increased by Attack Power"). [VERIFY Q53]
 * src: TBC 2.4 tooltips: Eviscerate and Ferocious Bite +3% AP per combo point; Rip +6% AP per combo point up to 4.
 */
export const FINISHER_AP: Readonly<Record<string, (cp: number) => number>> = {
  Eviscerate: (cp) => 0.03 * cp,
  "Ferocious Bite": (cp) => 0.03 * cp,
  Rip: (cp) => 0.06 * Math.min(cp, 4),
};

/** Shapeshift form ids (SpellShapeshiftForm); a talent's ShapeshiftMask bit is 1 << (form - 1). */
export const FORM_ID = {
  cat: 1,
  bear: 5,
  battle: 17,
  defensive: 18,
  berserker: 19,
  shadowform: 28,
  moonkin: 31,
} as const;
export const formMask = (form: keyof typeof FORM_ID | null | undefined): number =>
  form ? 1 << (FORM_ID[form] - 1) : 0;

/** SpellMisc.Attributes_2 bit SPELL_ATTR2_CANT_CRIT (modern enum). */
export const ATTR2_CANT_CRIT = 0x20000000;
/** SpellMechanic 15 = bleed: ignores armor. */
export const MECHANIC_BLEED = 15;
