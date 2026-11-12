import type { AttackSlot, PrimaryStat, School, StatEffect, Talent, TalentEffect } from "@/data/types";
import { WEAPON_SKILL_LINE_SUBCLASSES } from "./constants";
import { describeRequirement, matchingSlots } from "./equip";
import { PRIMARY_STATS, SCHOOL_BITS, type EquippedWeapons, type SourcedEffect } from "./types";

/** SpellEffect.Effect values that apply an aura (same set as tools/pipeline/constants.py APPLY_AURA_EFFECTS). */
const APPLY_AURA_EFFECTS = new Set([6, 35, 65, 119, 128, 129, 143]);
const TARGET_CASTER = 1;

/** Modern aura enum (Q23). Names follow TrinityCore master; [VERIFY] where Forever behavior is unconfirmed. */
export const AURA = {
  MOD_DAMAGE_DONE: 13,
  MOD_STAT: 29,
  MOD_SKILL: 30,
  MOD_WEAPON_CRIT_PERCENT: 52,
  MOD_HIT_CHANCE: 54,
  MOD_SPELL_HIT_CHANCE: 55,
  MOD_SPELL_CRIT_CHANCE: 57,
  MOD_CASTING_SPEED_NOT_STACK: 65,
  MOD_DAMAGE_PERCENT_DONE: 79,
  MOD_ATTACK_POWER: 99,
  ADD_FLAT_MODIFIER: 107,
  ADD_PCT_MODIFIER: 108,
  MOD_OFFHAND_DAMAGE_PCT: 122,
  MOD_TARGET_RESISTANCE: 123,
  MOD_RANGED_ATTACK_POWER: 124,
  MOD_TOTAL_STAT_PERCENTAGE: 137,
  MOD_ATTACK_POWER_PCT: 166,
  MOD_RANGED_ATTACK_POWER_PCT: 167,
  MOD_SPELL_DAMAGE_OF_STAT_PERCENT: 174,
  MOD_EXPERTISE: 240,
  MOD_ARMOR_PENETRATION_PCT: 280, // Serrated Blades "ignore X% armor" [VERIFY]
  MOD_CRIT_PCT: 290,
  MOD_MELEE_HASTE: 319, // [VERIFY]
  MOD_MELEE_RANGED_HASTE: 342, // [VERIFY]
} as const;

/** Auras with server-side behavior (Phase 4 handlers). */
const SPECIAL_AURAS = new Set([4, 42, 231, 226, 332, 109, 36]);
/** Auras that are not DPS stats (defense, health, armor, regen, threat, immunities, ...). */
const IGNORED_AURAS = new Set([
  5, 8, 10, 12, 17, 22, 26, 27, 31, 33, 34, 39, 43, 47, 49, 51, 61, 69, 77, 85, 87, 110, 118, 133, 134, 136,
  142, 154, 172, 175, 178, 185, 186, 232, 268, 271, 466,
]);
const WEAPON_SKILL_LINES = new Set(Object.keys(WEAPON_SKILL_LINE_SUBCLASSES).map(Number));

export type NotModeledReason = "spellMod" | "special" | "unsupported" | "ability" | "inactive";
export interface NotModeled {
  nodeId: number;
  name: string;
  rank: number;
  reason: NotModeledReason;
  detail: string;
}
/** ADD_FLAT_MODIFIER / ADD_PCT_MODIFIER: applied to spells whose family mask matches (Phase 4). */
export interface SpellMod {
  nodeId: number;
  name: string;
  effectIndex: number;
  op: number; // SpellModOp (EffectMiscValue_0): 0 damage, 7 crit chance, 10 cast time, 14 cost, ...
  value: number;
  pct: boolean; // aura 108
  mask: [number, number, number, number];
}
export interface TalentMapping {
  applied: SourcedEffect[]; // stat effects active for the current weapons
  damageDone: SourcedEffect[]; // aura 79, active only (recorded for Phase 4)
  spellMods: SpellMod[];
  notModeled: NotModeled[];
}
export interface RankedTalent {
  talent: Talent;
  rank: number; // 1..maxRank
}

const statsOfMask = (mask: number): PrimaryStat[] => PRIMARY_STATS.filter((_, i) => mask & (1 << i));
const statOfIndex = (i: number): PrimaryStat | "all" => (i < 0 ? "all" : PRIMARY_STATS[i]!);
export const schoolsOfMask = (mask: number): School[] => SCHOOL_BITS.filter((_, i) => mask & (1 << i));

type Mapped =
  | { kind: "stat"; effects: StatEffect[]; perSlot: boolean } // perSlot: restrict to matching weapon slots
  | { kind: "damageDone"; effects: StatEffect[] }
  | { kind: "spellMod" }
  | { kind: "special" }
  | { kind: "unsupported" }
  | { kind: "ignored" };

/** Maps one aura effect to the stat vocabulary. `v` is the per-rank value from ranks[r-1].values. */
export function mapAura(e: TalentEffect, v: number): Mapped {
  const [m0, m1] = e.misc;
  switch (e.aura) {
    case AURA.MOD_STAT:
      return { kind: "stat", perSlot: false, effects: [{ key: "stat", stat: statOfIndex(m0), value: v }] };
    case AURA.MOD_TOTAL_STAT_PERCENTAGE: {
      const mask = m1 !== 0 ? m1 : m0 < 0 ? 31 : 1 << m0;
      const stats = statsOfMask(mask);
      const effects: StatEffect[] =
        stats.length === 5
          ? [{ key: "statPct", stat: "all", value: v }]
          : stats.map((s) => ({ key: "statPct", stat: s, value: v }));
      return { kind: "stat", perSlot: false, effects };
    }
    case AURA.MOD_WEAPON_CRIT_PERCENT:
      return { kind: "stat", perSlot: true, effects: [{ key: "weaponCrit", value: v }] };
    case AURA.MOD_CRIT_PCT:
      return { kind: "stat", perSlot: false, effects: [{ key: "crit", value: v }] };
    case AURA.MOD_SPELL_CRIT_CHANCE:
      return { kind: "stat", perSlot: false, effects: [{ key: "spellCrit", value: v }] };
    case AURA.MOD_HIT_CHANCE:
      return { kind: "stat", perSlot: true, effects: [{ key: "weaponHit", value: v }] };
    case AURA.MOD_SPELL_HIT_CHANCE:
      return { kind: "stat", perSlot: false, effects: [{ key: "spellHit", value: v }] };
    case AURA.MOD_ATTACK_POWER:
      return { kind: "stat", perSlot: false, effects: [{ key: "meleeAttackPower", value: v }] };
    case AURA.MOD_RANGED_ATTACK_POWER:
      return { kind: "stat", perSlot: false, effects: [{ key: "rangedAttackPower", value: v }] };
    case AURA.MOD_ATTACK_POWER_PCT:
      return { kind: "stat", perSlot: false, effects: [{ key: "attackPowerPct", value: v }] };
    case AURA.MOD_RANGED_ATTACK_POWER_PCT:
      return { kind: "stat", perSlot: false, effects: [{ key: "rangedAttackPowerPct", value: v }] };
    case AURA.MOD_DAMAGE_DONE:
      return {
        kind: "stat",
        perSlot: false,
        effects: [{ key: "spellPower", schools: schoolsOfMask(m0 & ~1), value: v }],
      };
    case AURA.MOD_SPELL_DAMAGE_OF_STAT_PERCENT:
      return {
        kind: "stat",
        perSlot: false,
        effects: [
          { key: "spellPowerFromStat", stat: statOfIndex(m1), schools: schoolsOfMask(m0 & ~1), value: v },
        ],
      };
    case AURA.MOD_OFFHAND_DAMAGE_PCT:
      return { kind: "stat", perSlot: false, effects: [{ key: "offhandDamagePct", value: v }] };
    case AURA.MOD_EXPERTISE:
      return { kind: "stat", perSlot: false, effects: [{ key: "expertise", value: v }] };
    case AURA.MOD_ARMOR_PENETRATION_PCT:
      return { kind: "stat", perSlot: false, effects: [{ key: "armorPenPct", value: v }] };
    case AURA.MOD_TARGET_RESISTANCE:
      return {
        kind: "stat",
        perSlot: false,
        effects: [{ key: "spellPen", schools: schoolsOfMask(m0 & ~1), value: -v }],
      };
    case AURA.MOD_MELEE_HASTE:
      return { kind: "stat", perSlot: false, effects: [{ key: "meleeHaste", value: v }] };
    case AURA.MOD_MELEE_RANGED_HASTE:
      return {
        kind: "stat",
        perSlot: false,
        effects: [
          { key: "meleeHaste", value: v },
          { key: "rangedHaste", value: v },
        ],
      };
    case AURA.MOD_CASTING_SPEED_NOT_STACK:
      return { kind: "stat", perSlot: false, effects: [{ key: "spellHaste", value: v }] };
    case AURA.MOD_SKILL:
      if (WEAPON_SKILL_LINES.has(m0))
        return { kind: "stat", perSlot: true, effects: [{ key: "weaponSkill", value: v }] };
      return { kind: "ignored" };
    case AURA.MOD_DAMAGE_PERCENT_DONE:
      return {
        kind: "damageDone",
        effects: [{ key: "damageDonePct", schools: schoolsOfMask(m0), value: v }],
      };
    case AURA.ADD_FLAT_MODIFIER:
    case AURA.ADD_PCT_MODIFIER:
      return { kind: "spellMod" };
    default:
      if (SPECIAL_AURAS.has(e.aura)) return { kind: "special" };
      if (IGNORED_AURAS.has(e.aura)) return { kind: "ignored" };
      return { kind: "unsupported" };
  }
}

function skillSlots(skillLine: number, weapons: EquippedWeapons): AttackSlot[] {
  const subs = WEAPON_SKILL_LINE_SUBCLASSES[skillLine] ?? [];
  return (["mainHand", "offHand", "ranged"] as const).filter((s) => {
    const w = weapons[s];
    return w !== null && subs.includes(w.subclass);
  });
}

/** Generic talent mapper (Phase 3): stat-level auras of passive talents; everything else is listed. */
export function mapTalents(list: readonly RankedTalent[], weapons: EquippedWeapons): TalentMapping {
  const out: TalentMapping = { applied: [], damageDone: [], spellMods: [], notModeled: [] };
  for (const { talent: t, rank } of list) {
    const values = t.ranks[rank - 1]?.values ?? [];
    const label = `${t.name} ${rank}/${t.maxRank}`;
    const note = (reason: NotModeledReason, detail: string) => {
      if (!out.notModeled.some((n) => n.nodeId === t.nodeId && n.reason === reason))
        out.notModeled.push({ nodeId: t.nodeId, name: t.name, rank, reason, detail });
    };
    if (t.kind === "ability") {
      note("ability", "ability or cooldown (Phase 4/5)");
      continue;
    }
    if (t.shapeshiftMask !== 0) {
      note("inactive", "requires a shapeshift form (Phase 4)");
      continue;
    }
    const slots = matchingSlots(t.equipped, weapons);
    const inactive = t.equipped !== null && slots.length === 0;
    for (const [pos, e] of t.effects.entries()) {
      const v = values[pos] ?? 0; // ranks[].values is parallel to effects[] (position, not effect index)
      if (!APPLY_AURA_EFFECTS.has(e.effect)) {
        if (e.effect !== 0) note("special", `effect ${e.effect}`);
        continue;
      }
      if (e.targets && e.targets[0] !== TARGET_CASTER) {
        note("special", `aura ${e.aura} on target ${e.targets[0]}`);
        continue;
      }
      const m = mapAura(e, v);
      switch (m.kind) {
        case "stat":
        case "damageDone":
          if (inactive) {
            note("inactive", describeRequirement(t.equipped!));
            break;
          }
          for (const se of m.effects) {
            const sourced: SourcedEffect = { ...se, label, kind: "talent" };
            if (e.aura === AURA.MOD_SKILL) sourced.slots = skillSlots(e.misc[0], weapons);
            else if (m.kind === "stat" && m.perSlot && t.equipped) sourced.slots = slots;
            (m.kind === "damageDone" ? out.damageDone : out.applied).push(sourced);
          }
          break;
        case "spellMod":
          out.spellMods.push({
            nodeId: t.nodeId,
            name: t.name,
            effectIndex: e.index,
            op: e.misc[0],
            value: v,
            pct: e.aura === AURA.ADD_PCT_MODIFIER,
            mask: e.mask,
          });
          note("spellMod", "modifies specific spells (Phase 4)");
          break;
        case "special":
          note("special", `aura ${e.aura} needs a handler (Phase 4)`);
          break;
        case "unsupported":
          note("unsupported", `aura ${e.aura} is not supported yet`);
          break;
        case "ignored":
          break;
      }
    }
  }
  return out;
}
