import type { SpecRotation } from "@/data/types";
import type { CharacterStats, TargetView } from "@/engine/stats";
import type { Ranks } from "@/engine/talents";
import { derive, type CalcInput, type CharInput } from "./derived";

/**
 * Phase 7 insight: what one talent point, one talent tree or one stat is worth. Every number is a difference of two
 * analytical evaluations (`derive` without the reference rows) against the selected target, with the same rotation
 * rule as the panels: the editor's rotation, else the default rotation of the spec with the most points. So a delta
 * is exactly the change the Damage panel shows after the click (a point that changes the leading spec also changes
 * the rotation).
 */
export interface InsightInputs {
  calc: CalcInput;
  ch: CharInput;
  rotation: SpecRotation | null; // the rotation editor's rotation (useRotation.custom)
}

export type ImpactFormat = "int" | "pct";
export interface ImpactStatDef {
  id: string;
  label: string;
  format: ImpactFormat;
  get(stats: CharacterStats, view: TargetView): number;
}
const bestSpellPower = (s: CharacterStats) => Math.max(...Object.values(s.spellPower).map((x) => x.value));
/** The stats a talent tooltip and the compare view report, in display order. */
export const IMPACT_STATS: readonly ImpactStatDef[] = [
  { id: "ap", label: "attack power", format: "int", get: (s) => s.attackPower.value },
  { id: "rap", label: "ranged attack power", format: "int", get: (s) => s.rangedAttackPower?.value ?? 0 },
  { id: "sp", label: "spell power", format: "int", get: bestSpellPower },
  { id: "hit", label: "hit", format: "pct", get: (s) => s.hit.mainHand.value },
  { id: "rangedHit", label: "ranged hit", format: "pct", get: (s) => s.hit.ranged?.value ?? 0 },
  { id: "spellHit", label: "spell hit", format: "pct", get: (s) => s.hit.spell.value },
  { id: "crit", label: "crit vs target", format: "pct", get: (_, v) => v.mainHand?.crit.value ?? 0 },
  {
    id: "rangedCrit",
    label: "ranged crit vs target",
    format: "pct",
    get: (_, v) => v.ranged?.crit.value ?? 0,
  },
  { id: "spellCrit", label: "spell crit vs target", format: "pct", get: (_, v) => v.spell.crit.value },
  { id: "haste", label: "melee haste", format: "pct", get: (s) => s.haste.melee.value },
  { id: "rangedHaste", label: "ranged haste", format: "pct", get: (s) => s.haste.ranged.value },
  { id: "spellHaste", label: "spell haste", format: "pct", get: (s) => s.haste.spell.value },
  { id: "skill", label: "weapon skill", format: "int", get: (s) => s.weaponSkill.mainHand.value },
  { id: "str", label: "Strength", format: "int", get: (s) => s.primary.str.value },
  { id: "agi", label: "Agility", format: "int", get: (s) => s.primary.agi.value },
  { id: "int", label: "Intellect", format: "int", get: (s) => s.primary.int.value },
];
/** Deltas below these are rounding noise and are not shown. */
const SHOW_MIN: Record<ImpactFormat, number> = { int: 0.5, pct: 0.005 };

export interface Snapshot {
  dps: number; // owner + pet vs the selected target
  stats: Record<string, number>; // IMPACT_STATS values by id
  rotation: { id: string; label: string }; // the rotation evaluated
}
export interface StatDelta {
  id: string;
  label: string;
  format: ImpactFormat;
  delta: number;
}
export interface Impact {
  dps: number; // variant - current
  pct: number; // dps / current DPS x 100 (0 when the current DPS is 0)
  stats: StatDelta[]; // only visible changes, IMPACT_STATS order
  rotation: string | null; // label of the other rotation when the change switches it (leading spec changed)
}
export interface TalentImpact {
  next: Impact | null; // one more point (null at max rank)
  prev: Impact | null; // one point less (null at rank 0)
}

/** DPS and key stats of one evaluation (null without damage: spells loading or an unsupported level). */
export function snapshot(
  inp: InsightInputs,
  ranks: Ranks = inp.calc.ranks,
  bonus = inp.ch.bonus,
): Snapshot | null {
  const d = derive({ ...inp.calc, ranks }, { ...inp.ch, bonus }, inp.rotation, { reference: false });
  if (!d.ok || !d.damage) return null;
  const stats: Record<string, number> = {};
  for (const s of IMPACT_STATS) stats[s.id] = s.get(d.stats, d.view);
  const r = d.damage.rotation;
  return { dps: d.damage.totalDps, stats, rotation: { id: r.id, label: r.label } };
}

export function compare(base: Snapshot, other: Snapshot): Impact {
  const dps = other.dps - base.dps;
  return {
    dps,
    pct: base.dps > 0 ? (dps / base.dps) * 100 : 0,
    stats: IMPACT_STATS.flatMap((s) => {
      const delta = (other.stats[s.id] ?? 0) - (base.stats[s.id] ?? 0);
      return Math.abs(delta) >= SHOW_MIN[s.format]
        ? [{ id: s.id, label: s.label, format: s.format, delta }]
        : [];
    }),
    rotation: other.rotation.id !== base.rotation.id ? other.rotation.label : null,
  };
}

const withRank = (ranks: Ranks, nodeId: number, rank: number): Ranks => {
  const out: Record<number, number> = { ...ranks };
  if (rank > 0) out[nodeId] = rank;
  else delete out[nodeId];
  return out;
};

/**
 * One point more and one point less in a talent. The point rules are not checked: the tooltip of a locked talent
 * shows what its first point would add.
 */
export function talentImpact(inp: InsightInputs, base: Snapshot, nodeId: number): TalentImpact {
  const node = inp.calc.tree?.nodes.get(nodeId);
  if (!node) return { next: null, prev: null };
  const rank = inp.calc.ranks[nodeId] ?? 0;
  const at = (r: number) => {
    const s = snapshot(inp, withRank(inp.calc.ranks, nodeId, r));
    return s ? compare(base, s) : null;
  };
  return {
    next: rank < node.talent.maxRank ? at(rank + 1) : null,
    prev: rank > 0 ? at(rank - 1) : null,
  };
}

/** DPS of each tree's points: current DPS minus the DPS without that tree's points (rotation pinned). */
export function treeContribution(inp: InsightInputs, base: Snapshot): number[] {
  const tree = inp.calc.tree;
  if (!tree) return [];
  return tree.specNodeIds.map((ids) => {
    if (!ids.some((id) => (inp.calc.ranks[id] ?? 0) > 0)) return 0;
    const ranks: Record<number, number> = { ...inp.calc.ranks };
    for (const id of ids) delete ranks[id];
    const s = snapshot(inp, ranks);
    return s ? base.dps - s.dps : 0;
  });
}

const sameInputs = (a: InsightInputs, b: InsightInputs): boolean =>
  a.rotation === b.rotation &&
  (Object.keys(a.calc) as (keyof CalcInput)[]).every((k) => a.calc[k] === b.calc[k]) &&
  (Object.keys(a.ch) as (keyof CharInput)[]).every((k) => a.ch[k] === b.ch[k]) &&
  Object.keys(a.calc).length === Object.keys(b.calc).length &&
  Object.keys(a.ch).length === Object.keys(b.ch).length;

/**
 * Memo of the insight numbers for one set of inputs (store references). A new set clears it, so hovering the same
 * talent twice, or the heat map and the tooltip, evaluate each variant once.
 */
export class InsightCache {
  private inp: InsightInputs | null = null;
  private base: Snapshot | null = null;
  private impacts = new Map<number, TalentImpact>();
  private trees: number[] | null = null;

  private reset(inp: InsightInputs): void {
    if (this.inp && sameInputs(this.inp, inp)) return;
    this.inp = inp;
    this.base = snapshot(inp);
    this.impacts.clear();
    this.trees = null;
  }
  baseline(inp: InsightInputs): Snapshot | null {
    this.reset(inp);
    return this.base;
  }
  impact(inp: InsightInputs, nodeId: number): TalentImpact | null {
    this.reset(inp);
    if (!this.base) return null;
    let x = this.impacts.get(nodeId);
    if (!x) {
      x = talentImpact(inp, this.base, nodeId);
      this.impacts.set(nodeId, x);
    }
    return x;
  }
  has(inp: InsightInputs, nodeId: number): boolean {
    this.reset(inp);
    return this.impacts.has(nodeId);
  }
  contribution(inp: InsightInputs): number[] | null {
    this.reset(inp);
    if (!this.base) return null;
    this.trees ??= treeContribution(inp, this.base);
    return this.trees;
  }
}
