import type { Spell } from "@/data/types";
import type { RankedTalent, SpellMod } from "@/engine/stats";
import type { ModSource, SourceLine } from "./types";

/**
 * SpellModOp (EffectMiscValue_0 of aura 107 flat / 108 pct), modern enum, checked against 70888 talents (section 1.4).
 * Ops not listed here (threat 2, charges 4, range 5, radius 6, pushback 9, proc chance 18, ...) do not change damage.
 */
export const OP = {
  DAMAGE: 0, // direct (non-periodic) damage, incl. weapon strikes: Improved Cone of Cold, Aggression, Arcane Power
  DURATION: 1, // Improved Shadow Word: Pain +6000 ms, Improved Slice and Dice +45%
  POINTS_0: 3, // value of effect index 0: Permafrost, Composure
  CRIT_CHANCE: 7, // Critical Mass, Incineration, Improved Overpower
  POINTS_ALL: 8, // all effect values: Clever Traps
  CAST_TIME: 10, // Accelerant -500 ms, Presence of Mind -100%
  COOLDOWN: 11, // Improved Whirlwind -2000 ms, Purifying Power -33%
  POINTS_1: 12, // value of effect index 1: Flash of Steel (+15 energy from Shank)
  COST: 14, // Improved Heroic Strike -30 (= -3 rage, raw x10), Efficient Strikes -5 energy, Convection -10%
  CRIT_DAMAGE: 15, // crit damage bonus %: Ice Shards +100, Impale +20, Mortal Shots +30
  HIT_CHANCE: 16, // Divine Precision +8
  PERIODIC: 22, // periodic damage: Improved Rend, Improved Corruption, Arcane Instability (Fireball DoT part)
  POINTS_2: 23, // value of effect index 2
} as const;

export const OP_LABEL: Readonly<Record<number, string>> = {
  0: "damage",
  1: "duration",
  3: "effect 1",
  7: "crit chance",
  8: "effect values",
  10: "cast time",
  11: "cooldown",
  12: "effect 2",
  14: "cost",
  15: "crit damage bonus",
  16: "hit chance",
  22: "periodic damage",
  23: "effect 3",
};

/** Talent spell modifiers as mod sources (label "Name rank/max"). */
export function talentModSources(mods: readonly SpellMod[], talents: readonly RankedTalent[]): ModSource[] {
  return mods.map((m) => {
    const t = talents.find((r) => r.talent.nodeId === m.nodeId);
    const label = t ? `${m.name} ${t.rank}/${t.talent.maxRank}` : m.name;
    return { label, kind: "talent", op: m.op, value: m.value, pct: m.pct, mask: m.mask };
  });
}

/** 107/108 effects of self-buff spells (Shadowform: +100% shadow crit damage bonus). */
export function buffModSources(spells: readonly Spell[]): ModSource[] {
  return spells.flatMap((s) =>
    s.effects
      .filter((e) => e.effect === 6 && (e.aura === 107 || e.aura === 108))
      .map((e) => ({
        label: s.name,
        kind: "buff" as const,
        op: e.misc[0],
        value: e.base,
        pct: e.aura === 108,
        mask: e.mask,
      })),
  );
}

export function familyMatches(mask: readonly number[], spell: Spell, classSet: number): boolean {
  const f = spell.family;
  if (!f || f.set !== classSet) return false;
  return mask.some((m, i) => (m & f.mask[i]!) !== 0);
}

/** Flat sums and percent products per op for one spell, plus the "modified by" lines. */
export interface ModTotals {
  flat(op: number): number;
  mult(op: number): number; // product of (1 + pct/100)
  sumPct(op: number): number; // sum of pct values (crit damage bonus)
  lines: SourceLine[];
}

const fmt = (op: number, v: number, pct: boolean, rage: boolean): string => {
  const sign = v > 0 ? "+" : "−";
  const a = Math.abs(v);
  if (pct) return `${sign}${a}% ${OP_LABEL[op]}`;
  if (op === OP.CAST_TIME || op === OP.COOLDOWN || op === OP.DURATION)
    return `${sign}${a / 1000} s ${OP_LABEL[op]}`;
  if (op === OP.COST && rage) return `${sign}${a / 10} rage cost`;
  if (op === OP.CRIT_CHANCE || op === OP.HIT_CHANCE) return `${sign}${a}% ${OP_LABEL[op]}`;
  return `${sign}${a} ${OP_LABEL[op]}`;
};

export function collectMods(spell: Spell, sources: readonly ModSource[], classSet: number): ModTotals {
  const flat = new Map<number, number>();
  const mult = new Map<number, number>();
  const sum = new Map<number, number>();
  const lines: SourceLine[] = [];
  const rage = spell.costs[0]?.powerType === 1;
  for (const m of sources) {
    if (!(m.op in OP_LABEL) || m.value === 0 || !familyMatches(m.mask, spell, classSet)) continue;
    if (m.pct) {
      mult.set(m.op, (mult.get(m.op) ?? 1) * (1 + m.value / 100));
      sum.set(m.op, (sum.get(m.op) ?? 0) + m.value);
    } else flat.set(m.op, (flat.get(m.op) ?? 0) + m.value);
    lines.push({ label: m.label, kind: m.kind, text: fmt(m.op, m.value, m.pct, rage) });
  }
  return {
    flat: (op) => flat.get(op) ?? 0,
    mult: (op) => mult.get(op) ?? 1,
    sumPct: (op) => sum.get(op) ?? 0,
    lines,
  };
}
