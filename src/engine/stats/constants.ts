// Phase 3 stat-engine constants. Every value is a Classic 1.12 assumption until confirmed in Forever ([VERIFY], Q3/Q4/Q34).

/** src: Classic 1.12, max weapon skill and defense = 5 x level (CALC_MODEL section 2). [VERIFY] */
export const SKILL_PER_LEVEL = 5;

/** src: vmangos Unit::MeleeMissChanceCalc (Classic 1.12, recalled): 5% base miss. [VERIFY Q3] */
export const BASE_MELEE_MISS = 5;
/** src: same; defense - skill <= 10: +0.1% miss per point. [VERIFY Q3] */
export const MISS_PER_SKILL_LOW = 0.1;
/** src: same; defense - skill > 10: +0.2% miss per point for the whole difference (300 vs 315 = 8%). [VERIFY Q3] */
export const MISS_PER_SKILL_HIGH = 0.2;
/** src: same; skill above defense: -0.04% miss per point. [VERIFY Q3] */
export const MISS_PER_SKILL_ABOVE = 0.04;
/** src: Classic community testing (Magey): when defense - skill > 10 the first 1% of +hit is ignored. [VERIFY Q3] */
export const HIT_SUPPRESSION = 1;
export const HIT_SUPPRESSION_SKILL_GAP = 10;
/** src: vmangos: dual wield white attacks get +19% miss. [VERIFY Q3] */
export const DUAL_WIELD_MISS = 19;
/** src: vmangos: dodge = 5% + 0.1% per defense-skill point. [VERIFY Q3] */
export const BASE_DODGE = 5;
export const DODGE_PER_SKILL = 0.1;
/** src: vmangos: glancing = 10% + 2% per (defense - min(skill, 5 x level)), white melee only, cap 40%. [VERIFY Q3] */
export const BASE_GLANCE = 10;
export const GLANCE_PER_SKILL = 2;
export const MAX_GLANCE = 40;
/** src: vmangos: crit changes by 0.04% per point of (skill - defense). [VERIFY Q3] */
export const CRIT_PER_SKILL = 0.04;
/** src: Classic community testing (Magey): extra -1.8% crit vs targets 3+ levels higher. CALC_MODEL also mentions -3% (Q34). [VERIFY] */
export const BOSS_CRIT_SUPPRESSION = 1.8;
export const BOSS_LEVEL_GAP = 3;

/** src: vmangos Unit::MagicSpellHitResult: hit = 96 - diff (diff <= 2), 94 - 11 x (diff - 2) beyond; 1%..99%. [VERIFY Q3] */
export function baseSpellMiss(levelDiff: number): number {
  const miss = levelDiff <= 2 ? 4 + levelDiff : 6 + 11 * (levelDiff - 2);
  return Math.min(99, Math.max(MIN_SPELL_MISS, miss));
}
export const MIN_SPELL_MISS = 1;

/** src: CALC_MODEL section 3: 14 AP = 1 weapon DPS. [VERIFY Q4] */
export const AP_PER_DPS = 14;
/** src: Classic 1.12: off-hand white damage is halved. [VERIFY] */
export const OFFHAND_DAMAGE_MULT = 0.5;

/** src: Forever weapons carry Classic "+1% hit"/"+1% crit" as rating: Core Marksman Rifle hit 10, Heartseeker crit 14,
 * Fist of Cenarius crit 28 (+2% spell crit). Level-60 rating per 1%, applied to melee, ranged and spells. [VERIFY Q35] */
export const HIT_RATING_PER_PCT = 10;
export const CRIT_RATING_PER_PCT = 14;
export const HASTE_RATING_PER_PCT = 10;

/** ItemSparse stat ids used from weapons (tools/pipeline/constants.py STAT_NAMES). Others are listed as not modeled. */
export const ITEM_STAT = {
  agi: 3,
  str: 4,
  int: 5,
  spi: 6,
  sta: 7,
  hitRating: 31,
  critRating: 32,
  hasteRating: 36,
  attackPower: 38,
  rangedAttackPower: 39,
  spellDamage: 42,
  spellPower: 45,
} as const;

/** Weapon proficiency skill lines -> Item.SubclassID (same table as the pipeline). */
export const WEAPON_SKILL_LINE_SUBCLASSES: Readonly<Record<number, readonly number[]>> = {
  44: [0],
  172: [1],
  45: [2],
  46: [3],
  54: [4],
  160: [5],
  229: [6],
  43: [7],
  55: [8],
  136: [10],
  473: [13],
  173: [15],
  176: [16],
  226: [18],
  228: [19],
};
/** InventoryType 22 = INVTYPE_WEAPONOFFHAND; a requirement with this bit only matches the off-hand slot. */
export const INVTYPE_OFFHAND_BIT = 1 << 22;
export const ITEM_CLASS_WEAPON = 2;
export const ITEM_CLASS_ARMOR = 4;
/** Subclass masks seen in SpellEquippedItems (70888). */
export const SUBCLASS_MASK = {
  melee: 173555,
  twoHand: 136546,
  oneHandOffhand: 41105,
  ranged: 262156,
  wand: 524288,
  dagger: 32768,
} as const;
