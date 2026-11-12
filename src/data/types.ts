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
  stat?: PrimaryStat | "all"; // stat, statPct, spellPowerFromStat
  schools?: School[]; // spellPower, spellPen, damageDonePct, target*: absent = all magic schools (all schools for damageDonePct)
  slots?: AttackSlot[]; // weaponCrit, weaponHit, weaponSkill, weaponDamage: absent = every weapon slot
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
