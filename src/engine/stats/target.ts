import type { AttackSlot, MagicSchool, School, TargetPresetId, TargetsFile } from "@/data/types";
import {
  BASE_DODGE,
  BASE_GLANCE,
  BASE_MELEE_MISS,
  BOSS_CRIT_SUPPRESSION,
  BOSS_LEVEL_GAP,
  CRIT_PER_SKILL,
  DODGE_PER_SKILL,
  DUAL_WIELD_MISS,
  GLANCE_PER_SKILL,
  HIT_SUPPRESSION,
  HIT_SUPPRESSION_SKILL_GAP,
  MAX_GLANCE,
  MIN_SPELL_MISS,
  MISS_PER_SKILL_ABOVE,
  MISS_PER_SKILL_HIGH,
  MISS_PER_SKILL_LOW,
  SKILL_PER_LEVEL,
  baseSpellMiss,
} from "./constants";
import { makeStat, type Stat } from "./stat";
import {
  MAGIC_SCHOOLS,
  SCHOOL_BITS,
  type CharacterStats,
  type MeleeOutcome,
  type SourcedEffect,
  type SpellOutcome,
  type TargetInput,
  type TargetView,
} from "./types";

const ZERO_RESIST: Record<MagicSchool, number> = {
  holy: 0,
  fire: 0,
  nature: 0,
  frost: 0,
  shadow: 0,
  arcane: 0,
};

/** Preset target for player level L (targets.json byPlayerLevel); custom keeps the user's numbers. */
export function presetTarget(
  file: TargetsFile,
  presetId: TargetPresetId,
  playerLevel: number,
  debuffs: readonly SourcedEffect[],
  custom?: { level: number; armor: number; resist: Record<MagicSchool, number> },
): TargetInput {
  if (presetId === "custom" && custom)
    return { presetId, level: custom.level, armor: custom.armor, resist: custom.resist, debuffs };
  const row = file.byPlayerLevel[String(playerLevel)]?.find((r) => r.preset === presetId);
  if (!row) throw new Error(`no ${presetId} target for level ${playerLevel}`);
  return { presetId, level: row.level, armor: row.armor, resist: { ...ZERO_RESIST }, debuffs };
}

/** Base miss chance in % for a skill vs defense difference (white single-wield and special attacks). */
export function baseMeleeMiss(defenseMinusSkill: number): number {
  const d = defenseMinusSkill;
  if (d < 0) return Math.max(0, BASE_MELEE_MISS + d * MISS_PER_SKILL_ABOVE);
  return BASE_MELEE_MISS + d * (d > HIT_SUPPRESSION_SKILL_GAP ? MISS_PER_SKILL_HIGH : MISS_PER_SKILL_LOW);
}

function meleeOutcome(
  stats: CharacterStats,
  slot: AttackSlot,
  t: TargetInput,
  dualWield: boolean,
): MeleeOutcome | null {
  const skillStat = stats.weaponSkill[slot];
  const critStat = stats.crit[slot];
  const hitStat = stats.hit[slot];
  if (!skillStat || !critStat || !hitStat) return null;
  const skill = skillStat.value;
  const defense = t.level * SKILL_PER_LEVEL;
  const diff = defense - skill;
  const ranged = slot === "ranged";
  const suppressed = diff > HIT_SUPPRESSION_SKILL_GAP;
  const effHit = Math.max(0, hitStat.value - (suppressed ? HIT_SUPPRESSION : 0));
  const base = baseMeleeMiss(diff);
  const miss = makeStat([
    { label: `Base vs level ${t.level} (skill ${skill} vs defense ${defense})`, kind: "rule", value: base },
    {
      label: suppressed
        ? `Hit ${hitStat.value}% (first ${HIT_SUPPRESSION}% ignored)`
        : `Hit ${hitStat.value}%`,
      kind: "gear",
      value: -Math.min(base, effHit),
    },
  ]);
  const dwPenalty = dualWield && !ranged ? DUAL_WIELD_MISS : 0;
  const whiteMiss = makeStat([
    { label: `Base vs level ${t.level}`, kind: "rule", value: base },
    { label: "Dual wield", kind: "rule", value: dwPenalty },
    { label: `Hit ${hitStat.value}%`, kind: "gear", value: -Math.min(base + dwPenalty, effHit) },
  ]);
  const dodge = makeStat([
    {
      label: `Base vs level ${t.level}`,
      kind: "rule",
      value: Math.max(0, BASE_DODGE + diff * DODGE_PER_SKILL),
    },
    {
      label: "Expertise",
      kind: "talent",
      value: -Math.min(Math.max(0, BASE_DODGE + diff * DODGE_PER_SKILL), stats.expertise.value),
    },
  ]);
  const levelGap = t.level - stats.level;
  const crit = makeStat([
    ...critStat.parts,
    {
      label: `Weapon skill ${skill} vs defense ${defense}`,
      kind: "rule",
      value: (skill - defense) * CRIT_PER_SKILL,
    },
    {
      label: `Crit suppression vs level ${t.level}`,
      kind: "rule",
      value: levelGap >= BOSS_LEVEL_GAP ? -BOSS_CRIT_SUPPRESSION : 0,
    },
  ]);
  const cappedSkill = Math.min(skill, stats.level * SKILL_PER_LEVEL);
  const glancing =
    ranged || t.level < stats.level
      ? 0
      : Math.min(MAX_GLANCE, Math.max(0, BASE_GLANCE + (defense - cappedSkill) * GLANCE_PER_SKILL));
  const parry = 0;
  const block = 0;
  const whiteCritCap = Math.max(0, 100 - whiteMiss.value - dodge.value - parry - block - glancing);
  return {
    miss,
    dodge,
    parry,
    block,
    crit: { value: Math.max(0, crit.value), parts: crit.parts },
    whiteMiss,
    glancing,
    whiteCrit: Math.min(Math.max(0, crit.value), whiteCritCap),
    whiteCritCap,
    hitCap: base + (suppressed ? HIT_SUPPRESSION : 0),
    whiteHitCap: base + dwPenalty + (suppressed ? HIT_SUPPRESSION : 0),
  };
}

function spellOutcome(stats: CharacterStats, t: TargetInput): SpellOutcome {
  const base = baseSpellMiss(t.level - stats.level);
  const hit = stats.hit.spell.value;
  const miss = makeStat([
    { label: `Base vs level ${t.level}`, kind: "rule", value: base },
    { label: `Spell hit ${hit}%`, kind: "gear", value: -Math.min(hit, base - MIN_SPELL_MISS) },
  ]);
  return { miss, crit: stats.crit.spell, hitCap: base - MIN_SPELL_MISS };
}

const hasSchool = (e: SourcedEffect, s: School) => !e.schools || e.schools.includes(s);

/** Everything that depends on the target: armor after debuffs, armor reduction, resistances, outcome tables. */
export function evaluateTarget(
  stats: CharacterStats,
  t: TargetInput,
  armorFormula: TargetsFile["armorFormula"],
  dualWield: boolean,
): TargetView {
  const debuffArmor = t.debuffs.filter((e) => e.key === "targetArmor");
  const armorAfterDebuffs = Math.max(0, t.armor + debuffArmor.reduce((a, e) => a + e.value, 0));
  const pen = Math.min(100, stats.armorPenPct.value);
  const armor = makeStat([
    { label: `Level ${t.level} armor`, kind: "base", value: t.armor },
    ...debuffArmor.map((e) => ({ label: e.label, kind: e.kind, value: e.value })),
    {
      label: "Armor cannot go below 0",
      kind: "rule" as const,
      value: armorAfterDebuffs - (t.armor + debuffArmor.reduce((a, e) => a + e.value, 0)),
    },
    { label: `Armor penetration ${pen}%`, kind: "talent" as const, value: (-armorAfterDebuffs * pen) / 100 },
  ]);
  const k = armorFormula.base + armorFormula.perLevel * stats.level;
  const dr = Math.min(armorFormula.cap, armor.value / (armor.value + k)) * 100;
  const armorReduction: Stat = {
    value: dr,
    parts: [
      {
        label: `${Math.round(armor.value)} / (${Math.round(armor.value)} + ${armorFormula.base} + ${armorFormula.perLevel} x ${stats.level})`,
        kind: "rule",
        value: dr,
      },
    ],
  };
  const resist = {} as Record<MagicSchool, Stat>;
  for (const sc of MAGIC_SCHOOLS) {
    const parts = [
      { label: "Target", kind: "base" as const, value: t.resist[sc] },
      ...t.debuffs
        .filter((e) => e.key === "targetResist" && hasSchool(e, sc))
        .map((e) => ({ label: e.label, kind: e.kind, value: e.value })),
      ...stats.spellPen[sc].parts.filter((p) => p.value !== 0).map((p) => ({ ...p, value: -p.value })),
    ];
    const raw = parts.reduce((a, p) => a + p.value, 0);
    resist[sc] = makeStat([
      ...parts,
      { label: "Resistance cannot go below 0", kind: "rule", value: Math.max(0, raw) - raw },
    ]);
  }
  const damageTakenPct = {} as Record<School, number>;
  for (const sc of SCHOOL_BITS)
    damageTakenPct[sc] = t.debuffs
      .filter((e) => e.key === "targetDamageTakenPct" && hasSchool(e, sc))
      .reduce((a, e) => a + e.value, 0);
  return {
    presetId: t.presetId,
    level: t.level,
    armor,
    armorReduction,
    resist,
    damageTakenPct,
    mainHand: meleeOutcome(stats, "mainHand", t, dualWield),
    offHand: meleeOutcome(stats, "offHand", t, dualWield),
    ranged: meleeOutcome(stats, "ranged", t, false),
    spell: spellOutcome(stats, t),
  };
}
