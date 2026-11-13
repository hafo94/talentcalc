export type ClassToken =
  | "warrior"
  | "paladin"
  | "hunter"
  | "rogue"
  | "priest"
  | "shaman"
  | "mage"
  | "warlock"
  | "druid";

export interface Manifest {
  build: string;
  eraBuild: string | null;
  generatedAt: string;
  pipelineVersion: number;
  options: { includeHiddenNodes: boolean; eraFallback: boolean };
  iconUrlTemplate: string; // contains "{icon}"
  iconUrlFallback: string; // contains "{icon}"
  rawTables: { name: string; rows: number; sha256: string }[];
  eraRawTables?: { name: string; rows: number; sha256: string }[];
  counts: Record<string, number>;
}

export interface TalentCurrencyPerk {
  nodeId: number;
  entryId: number;
  rank: number;
  spellId: number;
  name: string;
}
export interface TalentCurrencySource {
  level: number;
  amount: number;
  requirement: string;
  perk?: TalentCurrencyPerk;
}
export interface TalentCurrency {
  id: number;
  max: number;
  sources: TalentCurrencySource[];
}

export interface ClassSpecInfo {
  index: number;
  name: string;
  talentTabId: number;
  background: string;
  icon: string | null;
  iconFileId: number;
}
export interface ClassInfo {
  id: number;
  token: ClassToken;
  name: string;
  color: string;
  spellClassSet: number;
  powerType: number;
  icon: string | null;
  iconFileId: number;
  traitTreeId: number;
  skillLineIds: number[];
  specs: ClassSpecInfo[];
  raceIds: number[]; // CharBaseInfo: playable races, in classes.json race order
  weaponSubclasses: number[]; // Item.SubclassID of class-2 weapons the class can learn (SkillLineAbility)
  dualWield: boolean; // SkillLineAbility skill line 118 (rune-granted rows excluded)
}
export interface RaceInfo {
  id: number;
  token: string;
  name: string;
  faction: "alliance" | "horde";
}
export interface ClassesFile {
  build: string;
  talentCurrency: TalentCurrency;
  classes: ClassInfo[];
  races: RaceInfo[];
}

export interface TalentRank {
  rank: number;
  values: number[];
  description: string;
  unresolved?: string[];
}
/** A talent spell effect (Difficulty 0), parallel to `ranks[].values`. */
export interface TalentEffect {
  index: number;
  effect: number; // SpellEffect.Effect (6 = APPLY_AURA)
  aura: number; // SpellEffect.EffectAura (modern enum)
  misc: [number, number];
  mask: [number, number, number, number];
  targets?: [number, number];
}
/** SpellEquippedItems: the aura is active only while a matching item is equipped. */
export interface EquippedRequirement {
  itemClass: number; // 2 = weapon, 4 = armor
  subclassMask: number; // bit = Item.SubclassID; 0 = any subclass
  invTypeMask: number; // bit = InventoryType; 0 = any slot (1 << 22 = off hand)
}
export interface Talent {
  nodeId: number;
  entryId: number;
  definitionId: number;
  spellId: number;
  name: string;
  icon: string | null;
  iconFileId: number;
  tier: number;
  col: number;
  maxRank: number;
  requiredPoints: number;
  prereqNodeId?: number;
  kind: "passive" | "ability";
  hidden?: true;
  valueSources: ("curve" | "base")[];
  ranks: TalentRank[];
  effects: TalentEffect[];
  equipped: EquippedRequirement | null;
  shapeshiftMask: number; // SpellShapeshift.ShapeshiftMask_0; 0 = usable in any form
  choices?: Omit<Talent, "tier" | "col" | "requiredPoints" | "prereqNodeId">[];
}
export interface TierGate {
  tier: number;
  requiredPoints: number;
  countedNodeIds: number[];
}
export interface Spec {
  index: number;
  name: string;
  talentTabId: number;
  specGroupId: number;
  nodeCount: number;
  maxPoints: number;
  tierGates: TierGate[];
  talents: Talent[];
}
export interface TalentFile {
  build: string;
  classId: number;
  token: ClassToken;
  traitTreeId: number;
  maxPoints: number;
  specs: Spec[];
}

export type WeaponSlotKind = "mainHand" | "oneHand" | "twoHand" | "offHand" | "ranged" | "thrown" | "wand";
export interface ItemStat {
  stat: number; // ItemSparse stat id (STAT_NAMES in tools/pipeline/constants.py)
  name: string;
  value: number;
}
export interface Weapon {
  id: number;
  name: string;
  quality: number;
  itemLevel: number;
  requiredLevel: number;
  inventoryType: number;
  slot: WeaponSlotKind;
  subclass: number;
  weaponType: string;
  speedMs: number;
  min: number;
  max: number;
  dps: number;
  damageTable: string | null;
  stats: ItemStat[];
  allowableClass: number;
  allowableRace: [number, number];
  bonding: number;
  icon: string | null;
  iconFileId: number;
  source: "forever" | "classic_era";
  bonusDamage?: { min: number; max: number; school: string; source?: string };
}
export interface Ammo {
  id: number;
  name: string;
  quality: number;
  itemLevel: number;
  requiredLevel: number;
  subclass: number; // 2 arrow, 3 bullet
  dps: number;
  icon: string | null;
}
export interface WeaponsFile {
  build: string;
  weapons: Weapon[];
  ammo: Ammo[];
}

export type TargetPresetId = "boss" | "elite" | "same" | "lowArmorBoss" | "custom";
export interface TargetLevelRow {
  level: number;
  armor: number;
  health: number;
  armorConstant: number;
  autoAttackDps: number;
  spellDamage: number;
}
export interface TargetPreset {
  id: TargetPresetId;
  label: string;
  levelOffset: number;
  armorMultiplier: number;
  default?: boolean;
  editable?: boolean;
  note?: string;
}
export interface TargetsFile {
  build: string;
  armorFormula: { base: number; perLevel: number; cap: number };
  levels: TargetLevelRow[];
  presets: TargetPreset[];
  byPlayerLevel: Record<string, { preset: TargetPresetId; level: number; armor: number; health: number }[]>;
}

// ---- Hand-maintained data (data/manual/*.json), see docs/phase3-implementation-plan.md section 3 ----
export type PrimaryStat = "str" | "agi" | "sta" | "int" | "spi";
export type MagicSchool = "holy" | "fire" | "nature" | "frost" | "shadow" | "arcane";
export type School = "physical" | MagicSchool;
export type AttackSlot = "mainHand" | "offHand" | "ranged";
export type EffectKey =
  | "stat" | "statPct" | "health" | "healthPct" | "mana" | "manaPct"
  | "attackPower" | "meleeAttackPower" | "rangedAttackPower" | "attackPowerPct" | "rangedAttackPowerPct"
  | "attackPowerFromStat" | "rangedAttackPowerFromStat"
  | "spellPower" | "spellPowerFromStat"
  | "crit" | "weaponCrit" | "spellCrit"
  | "hit" | "weaponHit" | "spellHit"
  | "haste" | "meleeHaste" | "rangedHaste" | "spellHaste"
  | "weaponSkill" | "weaponDamage" | "offhandDamagePct" | "expertise"
  | "armorPenPct" | "spellPen" | "damageDonePct"
  | "targetArmor" | "targetResist" | "targetDamageTakenPct";
export interface StatEffect {
  key: EffectKey;
  value: number;
  stat?: PrimaryStat | "all"; // stat, statPct, spellPowerFromStat, attackPowerFromStat, rangedAttackPowerFromStat
  schools?: School[]; // spellPower, spellPen, damageDonePct, target*: absent = all magic schools (all schools for damageDonePct)
  slots?: AttackSlot[]; // weaponCrit, weaponHit, weaponSkill, weaponDamage, damageDonePct: absent = every weapon slot
  // (damageDonePct with slots: only weapon attacks from those slots, e.g. Wand Specialization)
}
export interface ManualEffect extends StatEffect {
  src?: { effectIndex: number; field?: "base" | "perResource"; mult?: number };
}
export type BuffCategory = "raid" | "world" | "consumable" | "weapon" | "debuff";
export interface BuffDef {
  id: string;
  code: number; // stable URL code, never reused
  name: string;
  category: BuffCategory;
  spellId: number | null;
  spellName?: string;
  group?: string; // at most one buff per group
  effects: ManualEffect[];
  notes?: string;
  classic?: string;
  _status: string;
}
export interface BuffsFile {
  _source: string;
  _status: string;
  buffs: BuffDef[];
  presets: { raidBuffs: string[]; raidDebuffs: string[] };
}
export type ManualClassToken = Uppercase<ClassToken>;
export interface RacialDef {
  race: string; // uppercase race token (HUMAN, SCOURGE, ...)
  spellId: number;
  name: string;
  kind: "passive" | "active";
  classes?: ManualClassToken[];
  effects: ManualEffect[];
  notes?: string;
  _status: string;
}
export interface RacialsFile {
  _source: string;
  _status: string;
  racials: RacialDef[];
}
export interface ClassBaseStats {
  str: number;
  agi: number;
  sta: number;
  int: number;
  spi: number;
  health: number;
  mana: number;
  baseMeleeCrit: number;
  baseSpellCrit: number;
}
export interface ApFormula {
  perLevel: number;
  perStr: number;
  perAgi: number;
  flat: number;
}
export interface BaseStatsFile {
  _source: string;
  _status: string;
  level: number;
  baseCritUnit: "percent";
  classes: Record<ManualClassToken, ClassBaseStats>;
  raceOffsets: Record<string, Record<PrimaryStat, number>>;
  conversions: {
    meleeAttackPower: Record<ManualClassToken, ApFormula>;
    rangedAttackPower: Partial<Record<ManualClassToken, ApFormula>>;
    agiPerMeleeCrit: Record<ManualClassToken, number>;
    intPerSpellCrit: Partial<Record<ManualClassToken, number>>;
    healthPerSta: number;
    manaPerInt: number;
    statsWithoutBonus: number;
  };
}

// ---- Phase 4: class spells (data/generated/<build>/spells/<token>.json, same records as spells.json) ----
/** One SpellEffect row (Difficulty 0). Optional fields are omitted by the pipeline when 0. */
export interface SpellEffect {
  index: number;
  effect: number; // SpellEffect.Effect: 2 school damage, 3 dummy, 6 apply aura, 17/58 weapon damage, 31 weapon %, 121 normalized ...
  aura: number; // EffectAura (6 only): 3 periodic damage, 4 dummy, 23 periodic trigger, 42 proc trigger, 53 leech, ...
  base: number; // EffectBasePointsF (average value)
  misc: [number, number];
  mask: [number, number, number, number];
  variance?: number; // damage range = base x (1 +- variance/2)
  perLevel?: number; // EffectRealPointsPerLevel
  spCoef?: number; // EffectBonusCoefficient (1 on every physical effect: a client default, not a coefficient)
  apCoef?: number; // BonusCoefficientFromAP (never set in 70888)
  periodMs?: number;
  amplitude?: number;
  chainTargets?: number;
  pointsPerCombo?: number; // EffectPointsPerResource
  triggerSpell?: number;
  mechanic?: number; // 15 = bleed
  targets?: [number, number];
  radiusIndex?: [number, number];
}
export interface SpellCost {
  powerType: number; // 0 mana, 1 rage (already / 10), 2 focus, 3 energy, 4 combo points, -2 health
  amount: number;
  pct: number; // % of base mana
  perLevel: number;
  perSecond: number;
  optional: number;
}
export type SpellSource = "ability" | "talent" | "triggered" | "pet"; // "pet": pets/<owner>.json (Phase 6)
export interface Spell {
  id: number;
  name: string;
  subtext: string | null;
  rank: number | null;
  classIds: number[];
  sources: SpellSource[];
  icon: string | null;
  iconFileId: number;
  school: number; // SpellSchoolMask (1 physical, 2 holy, 4 fire, 8 nature, 16 frost, 32 shadow, 64 arcane)
  passive: boolean;
  channeled: boolean;
  attributes: number[]; // SpellMisc.Attributes_0..16
  levels: { base: number; max: number; spell: number } | null;
  castMs: number; // < 0 (-1000000) on some instant hunter shots
  gcdMs: number;
  gcdCategory: number;
  cooldownMs: number;
  categoryCooldownMs: number;
  category: number;
  costs: SpellCost[];
  range: { min: number; max: number } | null;
  duration: { ms: number; perLevel: number; maxMs: number } | null;
  family: { set: number; mask: [number, number, number, number] } | null;
  proc: {
    chance: number;
    charges: number;
    categoryRecoveryMs: number;
    typeMask: [number, number];
    ppm: number | null;
  } | null;
  maxStacks: number;
  defenseType: number; // SpellCategories.DefenseType: 0 none, 1 magic, 2 melee, 3 ranged
  dispelType: number;
  mechanic: number;
  preventionType: number;
  description: string;
  auraDescription: string;
  unresolved?: string[];
  effects: SpellEffect[];
  equipped: EquippedRequirement | null;
  shapeshiftMask: number;
}
export interface AbilityChain {
  classId: number;
  name: string;
  skillLineId: number;
  passive: boolean;
  ranks: number[]; // spell ids by learn level; a talent-granted ability starts at rank 2 (rank 1 is the talent spell)
}
export interface ClassSpellFile {
  build: string;
  classId: number;
  token: ClassToken;
  spells: Spell[];
  abilities: AbilityChain[];
}

// ---- Phase 4: default rotations (data/manual/rotations.json) ----
// "burst" (Phase 5): a cooldown whose caster auras apply while it lasts (Death Wish, Arcane Power, Cold Blood, Evocation).
// The analytical model skips it; the simulator casts it when its conditions hold.
export type RotationEntryKind =
  | "cooldown"
  | "dot"
  | "maintain"
  | "filler"
  | "builder"
  | "finisher"
  | "nextSwing"
  | "burst";
/** Comparison of a condition: value >= x ("gte") or value < x ("lt"). */
export type ConditionCmp = "gte" | "lt";
/**
 * Phase 5 rotation condition (all must hold). Evaluated by the simulator (src/engine/rotation/conditions.ts); the
 * analytical model skips entries with sim-only conditions (targetHp, aura, cooldown, timeLeft).
 */
export type RotationCondition =
  | { type: "resource"; cmp: ConditionCmp; value: number } // rage/energy points; mana: % of maximum mana
  | { type: "comboPoints"; cmp: ConditionCmp; value: number }
  | { type: "targetHp"; cmp: ConditionCmp; value: number } // % of target health (execute: lt 20)
  | { type: "timeLeft"; cmp: ConditionCmp; value: number } // seconds of fight left
  | { type: "auraLeft"; cmp: ConditionCmp; value: number } // seconds left of this entry's own DoT/buff (0 = missing)
  | { type: "aura"; ref: string; active: boolean } // a player buff/proc or target debuff by name (Clearcasting, Flurry)
  | { type: "cooldown"; ref: string; ready: boolean }; // another ability's cooldown (by ability name)
export type ConditionType = RotationCondition["type"];
export interface RotationEntry {
  ability: string; // ability name (rank chain name in spells/<class>.json)
  kind: RotationEntryKind;
  cp?: number; // finisher: combo points spent (1..5)
  everySec?: number; // maintain: recast interval in seconds (default: the spell's duration)
  buff?: true; // the ability's caster auras are applied while the rotation runs (Slice and Dice, seals)
  requires?: string; // only cast when this other rotation entry is cast (Conflagrate requires Immolate)
  requiresTalent?: string; // only cast when this talent has a point (Scorch for Improved Scorch)
  conditions?: RotationCondition[]; // Phase 5: extra conditions (all must hold)
  off?: true; // Phase 5: switched off in the editor (both engines ignore the entry)
  note?: string;
}
export type RotationRole = "dps" | "tank" | "healer";
export type ShapeshiftForm = "cat" | "bear" | "moonkin" | "shadowform" | "battle" | "berserker" | "defensive";
export interface SpecRotation {
  id: string; // stable id, e.g. "mage-fire"
  class: ClassToken;
  spec: number; // 0..2 (talent tab order)
  label: string;
  role: RotationRole;
  tier: 1 | 2 | 3; // 1 fully modeled, 2 generic model, 3 basic damage rotation for a tank/healer spec
  form?: ShapeshiftForm;
  selfBuffs: string[]; // abilities whose caster auras are always on (Shadowform, Aspect of the Hawk, Seal of Command)
  melee: boolean; // white melee swings (main hand + off hand)
  autoShot: boolean; // hunter Auto Shot
  entries: RotationEntry[];
  notes: string[];
  noPetNotes?: string[]; // Phase 7: shown only while no pet (and no Demonic Sacrifice) is chosen
}
export interface RotationsFile {
  _source: string;
  _status: string;
  rotations: SpecRotation[];
}

// ---- Phase 6: pets (data/generated/<build>/pets/<owner>.json, docs/phase6-implementation-plan.md section 2) ----
/** A pet ability: one rank chain of the family's skill line, ranks by learn level. */
export interface PetAbilityChain {
  name: string;
  ranks: number[];
}
/** A hunter pet family or a warlock demon (CreatureFamily row whose skill line has the owner's pet scaling aura). */
export interface PetInfo {
  id: number; // CreatureFamily.ID (stable URL key)
  name: string;
  owner: ClassToken;
  icon: string | null;
  skillLine: number;
  exotic: boolean; // CreatureFamily.PetTalentType 1 (Core Hound)
  abilities: PetAbilityChain[]; // active spells of the skill line
  passives: number[]; // passive spells (family damage modifier, talent-modified passives, pet scaling)
}
export interface PetFile {
  build: string;
  classId: number;
  token: ClassToken;
  pets: PetInfo[];
  spells: Spell[]; // abilities, passives, triggered spells and the auras data/manual/pets.json refers to
}

// ---- Phase 6: data/manual/pets.json ----
/** Level-60 pet base stats (server-side, not in client data) [VERIFY Q69]. */
export interface PetBaseStats {
  str: number;
  agi: number;
  sta: number;
  int: number;
  spi: number;
  apPerStr: number; // attack power = apPerStr x Str + apFlat
  apFlat: number;
  minDamage: number; // melee damage per swing before attack power
  maxDamage: number;
  speedMs: number;
  meleeCrit: number; // % before talents and target
  spellCrit: number;
}
export interface PetOwnerConfig {
  base: PetBaseStats;
  /** Owner scaling (Q5): % of the owner's ranged attack power (hunter) or spell power (warlock, max of fire/shadow). */
  scaling: {
    from: "rangedAttackPower" | "spellPower";
    attackPowerPct: number;
    spellPowerPct: number;
    inheritHit: boolean;
  };
  focus: { max: number; perSecond: number } | null; // null: the pet's mana is not modeled (unlimited)
  noMelee: number[]; // family ids that never melee (Imp)
}
export interface PetAuraRef {
  family: number;
  name: string;
  spellId: number;
  spellName: string;
}
export interface PetsManualFile {
  _source: string;
  _status: string;
  level: number;
  owners: Partial<Record<ClassToken, PetOwnerConfig>>;
  sacrifice: PetAuraRef[]; // Demonic Sacrifice: buff of the sacrificed demon (server script, not in client data)
  masterDemonologist: (PetAuraRef & { valueIndex: number })[]; // talent value index per demon
  soulLink: { spellId: number; spellName: string };
}
