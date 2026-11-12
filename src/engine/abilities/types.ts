import type { AttackSlot, RotationEntry, School, ShapeshiftForm, Spell, Talent } from "@/data/types";
import type { CharacterStats, EquippedWeapons, RankedTalent, SourceKind, TargetView } from "@/engine/stats";
import type { AttackKind, RollChances } from "@/engine/combat";
import type { Spellbook } from "./spellbook";

export type PowerKind = "mana" | "rage" | "energy" | "focus";

/** One line of an ability's "modified by" list, e.g. { label: "Critical Mass 3/3", text: "+6% crit chance" }. */
export interface SourceLine {
  label: string;
  kind: SourceKind;
  text: string;
}

/** A spell modifier source (talent aura 107/108, self-buff aura 107/108). */
export interface ModSource {
  label: string;
  kind: SourceKind;
  op: number; // SpellModOp (EffectMiscValue_0)
  value: number;
  pct: boolean; // aura 108
  mask: [number, number, number, number];
}

/** Uptime-based effects computed from the first rotation pass (talent handlers, section 7). */
export interface RotationEffect {
  label: string;
  /** Multiplies damage of the given schools (and only these abilities when `abilities` is set). */
  damagePct?: { schools: School[]; pct: number; abilities?: string[] };
  meleeHastePct?: number; // white melee swing speed (Flurry)
  ragePerMinute?: number;
  extraDps?: number; // damage not tied to a rotation entry (Deep Wounds, extra attacks, Nightfall)
}

/** Everything an ability evaluation needs. Built once per target. */
export interface DamageContext {
  level: number;
  stats: CharacterStats;
  view: TargetView;
  book: Spellbook;
  weapons: EquippedWeapons;
  form: ShapeshiftForm | null;
  talents: readonly RankedTalent[]; // invested talents
  classTalents: readonly Talent[]; // every talent of the class (ability gating)
  mods: readonly ModSource[];
  selfBuffs: readonly Spell[]; // learned self-buff spells of the rotation
  effects: readonly RotationEffect[]; // empty in pass 1
  rotationAbilities: ReadonlySet<string>; // learned abilities of the rotation (Incinerate checks Immolate)
  abilityHooks: readonly AbilityHook[]; // talent handlers (section 7)
}

/** One damage component of a cast: `count` hits (or ticks) of `perHit` (after multipliers and mitigation, no crit). */
export interface DamagePart {
  label: string;
  kind: "direct" | "periodic";
  perHit: number;
  count: number;
  chances: RollChances;
  critMultiplier: number;
  range?: [number, number]; // min/max of one normal hit (direct parts)
}
/** Mutable evaluation state passed to talent handlers before the expected damage is summed. */
export interface AbilityDraft {
  key: string;
  spell: Spell;
  kind: AttackKind;
  school: School;
  schoolMask: number;
  slot: AttackSlot | null;
  finisher: boolean;
  parts: DamagePart[];
  extras: { label: string; value: number }[];
  comboPoints: number;
  cpRefund: number;
  sources: SourceLine[];
  notes: string[];
}
export type AbilityHook = (d: AbilityDraft, ctx: DamageContext) => void;

/** A learned ability evaluated against one target (per cast, averages). */
export interface AbilityResult {
  key: string; // rotation ability name (or "Seal of Command (proc)")
  available: true;
  spell: Spell;
  name: string;
  rank: number | null;
  icon: string | null;
  school: School;
  schoolMask: number;
  kind: AttackKind;
  slot: AttackSlot | null; // weapon slot used (null: spell)
  castTime: number; // seconds after modifiers and haste (0 = instant)
  channelTime: number; // seconds (0 = not channeled)
  gcd: number; // seconds
  cooldown: number; // seconds, own or category cooldown, after modifiers (0 = none)
  category: number; // SpellCategories.Category when it has a category cooldown, else 0
  categoryCooldown: number; // seconds
  timeCost: number; // seconds of the player's time per cast: max(gcd, cast, channel); 0 when off the GCD
  power: PowerKind | null;
  cost: number; // per cast, after modifiers (rage in rage points, mana in mana)
  energize: number; // resource returned by the cast itself (Shank energy), same power
  comboPoints: number; // expected combo points awarded per cast (builders)
  cpRefund: number; // expected combo points refunded per finisher (Ruthlessness)
  hitChance: number; // % of casts that land
  critChance: number; // % of landed hits/ticks that crit
  critMultiplier: number; // damage of a crit / damage of a normal hit
  hit: number; // average non-crit damage of the direct part (weapon + direct) after mitigation, 0 if none
  hitRange: [number, number] | null;
  crit: number; // average crit damage of the direct part
  tick: number; // average non-crit periodic tick after mitigation (0 if none)
  ticks: number; // per cast (channel ticks or DoT ticks)
  periodSec: number;
  durationSec: number; // DoT/buff duration (0 if none)
  expectedDirect: number; // per cast, incl. hit/crit/mitigation
  expectedPeriodic: number; // per cast, full duration
  extras: { label: string; value: number }[]; // per cast (Ignite, Lightning Overload)
  expected: number; // expectedDirect + expectedPeriodic + extras
  dpct: number; // expected / execute time (max(timeCost, gcd), or 1.5 s for off-GCD abilities)
  sources: SourceLine[];
  notes: string[];
}
export interface UnavailableAbility {
  key: string;
  available: false;
  reason: string;
}
export type AbilityEval = AbilityResult | UnavailableAbility;

/** White attacks of one slot. */
export interface WhiteResult {
  slot: AttackSlot;
  name: string;
  speed: number; // hasted seconds per swing (before Flurry)
  normalHit: number; // damage of a normal hit after armor and multipliers
  expectedPerSwing: number; // incl. miss/dodge/glancing/crit
  hitChance: number; // % of swings that land (incl. glancing and crit)
  critChance: number; // % of swings that crit
  glancing: number; // % of swings
  glancingMultiplier: number;
  dps: number;
}

export type EntryEval = { entry: RotationEntry; ability: AbilityEval };
