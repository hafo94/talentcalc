import type {
  Ammo,
  AttackSlot,
  BaseStatsFile,
  ClassToken,
  MagicSchool,
  PrimaryStat,
  School,
  StatEffect,
  TargetPresetId,
  Weapon,
} from "@/data/types";
import type { SourceKind, Stat } from "./stat";

export const PRIMARY_STATS: readonly PrimaryStat[] = ["str", "agi", "sta", "int", "spi"];
export const MAGIC_SCHOOLS: readonly MagicSchool[] = ["holy", "fire", "nature", "frost", "shadow", "arcane"];
/** SpellSchoolMask bit order: physical 1, holy 2, fire 4, nature 8, frost 16, shadow 32, arcane 64. */
export const SCHOOL_BITS: readonly School[] = ["physical", ...MAGIC_SCHOOLS];
export const ATTACK_SLOTS: readonly AttackSlot[] = ["mainHand", "offHand", "ranged"];

export interface EquippedWeapons {
  mainHand: Weapon | null;
  offHand: Weapon | null;
  ranged: Weapon | null; // bow, gun, crossbow, thrown or wand
  ammo: Ammo | null;
}

/** Manual "bonus stats" (gear v1). Percent fields are percentage points. */
export interface BonusStats {
  str: number;
  agi: number;
  sta: number;
  int: number;
  spi: number;
  attackPower: number; // melee and ranged, like "+X Attack Power" gear
  rangedAttackPower: number;
  spellPower: number; // all magic schools
  holySpellPower: number;
  fireSpellPower: number;
  natureSpellPower: number;
  frostSpellPower: number;
  shadowSpellPower: number;
  arcaneSpellPower: number;
  hit: number; // melee + ranged
  spellHit: number;
  crit: number; // melee + ranged
  spellCrit: number;
  haste: number; // melee, ranged and spell
  weaponSkill: number; // every weapon slot
}

export interface SourcedEffect extends StatEffect {
  label: string;
  kind: SourceKind;
}

export interface CharacterInput {
  classToken: ClassToken;
  race: string; // uppercase race token (HUMAN, SCOURGE, ...)
  level: number;
  baseStats: BaseStatsFile;
  weapons: EquippedWeapons;
  bonus: BonusStats;
  effects: readonly SourcedEffect[]; // racials, buffs/debuffs and applied talent effects
}

export interface WeaponDamage {
  slot: AttackSlot;
  weaponId: number;
  name: string;
  min: number;
  max: number;
  speed: number; // seconds, unhasted
  hastedSpeed: number;
  perSwing: Stat; // average damage of one swing/shot (no crit, no armor)
  dps: Stat; // perSwing / hastedSpeed (off hand: x 0.5 x off-hand bonus)
  isWand: boolean;
}

export interface CharacterStats {
  classToken: ClassToken;
  level: number;
  primary: Record<PrimaryStat, Stat>;
  health: Stat;
  mana: Stat | null; // null for rage/energy classes
  attackPower: Stat;
  rangedAttackPower: Stat | null; // null if the class has no ranged attack power formula
  spellPower: Record<MagicSchool, Stat>;
  crit: { mainHand: Stat; offHand: Stat | null; ranged: Stat | null; spell: Stat }; // character sheet, % points
  hit: { mainHand: Stat; offHand: Stat | null; ranged: Stat | null; spell: Stat };
  haste: { melee: Stat; ranged: Stat; spell: Stat }; // % (multiplicative stacking)
  weaponSkill: { mainHand: Stat; offHand: Stat | null; ranged: Stat | null };
  expertise: Stat; // % dodge/parry reduction [VERIFY unit]
  armorPenPct: Stat;
  spellPen: Record<MagicSchool, Stat>;
  weapons: Record<AttackSlot, WeaponDamage | null>;
  damageDone: SourcedEffect[]; // recorded aura-79 modifiers, applied in Phase 4
  hasSpellCrit: boolean; // class has an Int -> spell crit ratio
}

export interface TargetInput {
  presetId: TargetPresetId;
  level: number;
  armor: number; // before debuffs
  resist: Record<MagicSchool, number>;
  debuffs: readonly SourcedEffect[]; // targetArmor / targetResist / targetDamageTakenPct
}

export interface MeleeOutcome {
  /** Special (yellow) attacks: two-roll, no glancing. Percent points. */
  miss: Stat;
  dodge: Stat;
  parry: number; // 0: attacking from behind
  block: number; // 0: attacking from behind
  crit: Stat; // vs target, after suppression
  /** White attacks (single roll). Ranged has glancing 0. */
  whiteMiss: Stat;
  glancing: number;
  whiteCrit: number; // min(crit, whiteCritCap)
  whiteCritCap: number;
  hitCap: number; // +hit needed to remove special misses (incl. suppression)
  whiteHitCap: number;
}
export interface SpellOutcome {
  miss: Stat;
  crit: Stat;
  hitCap: number;
}
export interface TargetView {
  presetId: TargetPresetId;
  level: number;
  armor: Stat; // after debuffs and armor penetration (physical)
  armorReduction: Stat; // percent of physical damage removed
  resist: Record<MagicSchool, Stat>;
  damageTakenPct: Record<School, number>;
  mainHand: MeleeOutcome | null;
  offHand: MeleeOutcome | null;
  ranged: MeleeOutcome | null;
  spell: SpellOutcome;
  /** Phase 4 hook: analytical DPS of the build vs this target. Always undefined in Phase 3. */
  dps?: number;
}
