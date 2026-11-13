import type { MagicSchool } from "@/data/types";
import type { BonusStats } from "@/engine/stats";
import { derive } from "./derived";
import type { InsightInputs } from "./insight";

/**
 * Phase 7 stat weights (EP): DPS per point of each stat, from paired evaluations of the same build with more of one
 * bonus stat. Analytical by default; the same jobs (bonus patches and pairs) drive the simulation weights in the worker.
 */
export type WeightKey = keyof BonusStats;
export interface WeightDef {
  key: WeightKey;
  label: string;
  step: number; // points (percent points for pct stats) added for the measurement
  pct: boolean;
  school?: MagicSchool;
  hitOf?: "melee" | "spell"; // hit stats: measured below and above the hit cap
}
const school = (s: MagicSchool, label: string): WeightDef => ({
  key: `${s}SpellPower` as WeightKey,
  label: `${label} spell power`,
  step: 25,
  pct: false,
  school: s,
});
/** Stats in display order. Power stats first: the reference stat is one of them. */
export const WEIGHT_STATS: readonly WeightDef[] = [
  { key: "attackPower", label: "Attack power", step: 50, pct: false },
  { key: "rangedAttackPower", label: "Ranged attack power", step: 50, pct: false },
  { key: "spellPower", label: "Spell power", step: 25, pct: false },
  school("holy", "Holy"),
  school("fire", "Fire"),
  school("nature", "Nature"),
  school("frost", "Frost"),
  school("shadow", "Shadow"),
  school("arcane", "Arcane"),
  { key: "str", label: "Strength", step: 25, pct: false },
  { key: "agi", label: "Agility", step: 25, pct: false },
  { key: "int", label: "Intellect", step: 25, pct: false },
  { key: "hit", label: "Hit", step: 1, pct: true, hitOf: "melee" },
  { key: "spellHit", label: "Spell hit", step: 1, pct: true, hitOf: "spell" },
  { key: "crit", label: "Crit", step: 1, pct: true },
  { key: "spellCrit", label: "Spell crit", step: 1, pct: true },
  { key: "haste", label: "Haste", step: 1, pct: true },
  { key: "weaponSkill", label: "Weapon skill", step: 5, pct: false },
];
const POWER: readonly WeightKey[] = ["attackPower", "rangedAttackPower", "spellPower"];

/** A measurement: (DPS(to) - DPS(from)) / per. Patches are absolute bonus values; "base" is the build itself. */
export interface WeightPair {
  id: string; // stat key, or "<key>:above" for hit above the cap
  from: string;
  to: string;
  per: number;
}
export interface HitState {
  current: number; // hit on the character sheet (hunters: ranged hit)
  cap: number; // hit needed vs the selected target (TargetView hitCap)
}
export interface WeightJobs {
  patches: Record<string, Partial<BonusStats>>;
  pairs: WeightPair[];
  hits: Partial<Record<"melee" | "spell", HitState>>;
}

export interface WeightRow {
  def: WeightDef;
  perPoint: number | null; // DPS per point (per 1%); hit: average per 1% from your hit to the cap (null at the cap)
  ep: number | null; // perPoint / reference perPoint
  cap?: { current: number; cap: number; above: number; aboveEp: number | null }; // hit stats
}
export interface Weights {
  dps: number;
  reference: WeightDef | null; // the power stat with the most DPS per point
  rows: WeightRow[]; // stats that change the DPS
  jobs: WeightJobs; // the measurements of `rows` (for the simulation)
}

/** Hit now and the hit caps vs the selected target. */
function hitStates(inp: InsightInputs): WeightJobs["hits"] {
  const d = derive(inp.calc, inp.ch, inp.rotation, { reference: false });
  if (!d.ok) return {};
  const ranged = d.stats.classToken === "hunter" && d.stats.hit.ranged !== null && d.view.ranged !== null;
  const o = ranged ? d.view.ranged : d.view.mainHand;
  return {
    spell: { current: d.stats.hit.spell.value, cap: d.view.spell.hitCap },
    ...(o
      ? { melee: { current: ranged ? d.stats.hit.ranged!.value : d.stats.hit.mainHand.value, cap: o.hitCap } }
      : {}),
  };
}

/** All measurements for the current build (every stat; statWeights keeps those that change the DPS). */
export function weightJobs(inp: InsightInputs): WeightJobs {
  const b = inp.ch.bonus;
  const patches: Record<string, Partial<BonusStats>> = { base: {} };
  const pairs: WeightPair[] = [];
  const hits = hitStates(inp);
  for (const def of WEIGHT_STATS) {
    const k = def.key;
    if (!def.hitOf) {
      patches[k] = { [k]: b[k] + def.step };
      pairs.push({ id: k, from: "base", to: k, per: def.step });
      continue;
    }
    const h = hits[def.hitOf];
    if (!h) continue;
    const gap = Math.round((h.cap - h.current) * 100) / 100;
    if (gap > 0) {
      patches[`${k}:cap`] = { [k]: b[k] + gap };
      patches[`${k}:cap+1`] = { [k]: b[k] + gap + 1 };
      pairs.push({ id: k, from: "base", to: `${k}:cap`, per: gap });
      pairs.push({ id: `${k}:above`, from: `${k}:cap`, to: `${k}:cap+1`, per: 1 });
    } else {
      patches[`${k}:cap+1`] = { [k]: b[k] + 1 };
      pairs.push({ id: `${k}:above`, from: "base", to: `${k}:cap+1`, per: 1 });
    }
  }
  return { patches, pairs, hits };
}

/** Keeps the patches the pairs use. */
export function usedJobs(jobs: WeightJobs, ids: ReadonlySet<string>): WeightJobs {
  const pairs = jobs.pairs.filter((p) => ids.has(p.id));
  const keys = new Set(pairs.flatMap((p) => [p.from, p.to]));
  return {
    pairs,
    patches: Object.fromEntries(Object.entries(jobs.patches).filter(([k]) => keys.has(k))),
    hits: jobs.hits,
  };
}

/**
 * Rows from measured pair values (analytical, or simulated means): stats that change the DPS, EP relative to the
 * power stat with the most DPS per point. One school's spell power alone is the same as Spell power and is dropped.
 */
export function weightRows(
  jobs: WeightJobs,
  value: (pairId: string) => number | undefined,
  eps = 1e-6,
): { reference: WeightDef | null; rows: WeightRow[] } {
  const raw = WEIGHT_STATS.map((def) => ({
    def,
    per: value(def.key) ?? null,
    above: value(`${def.key}:above`) ?? null,
  })).filter((r) => r.per !== null || r.above !== null);
  const powers = raw.filter((r) => POWER.includes(r.def.key) && (r.per ?? 0) > eps);
  // Ties go to the later, more specific stat (a hunter's +AP also adds ranged AP: the reference is ranged AP).
  const reference = powers.reduce<(typeof raw)[number] | null>(
    (a, r) => (!a || r.per! >= a.per! ? r : a),
    null,
  );
  const refPer = reference?.per ?? null;
  const epOf = (v: number | null) => (v === null || refPer === null ? null : v / refPer);
  const schools = raw.filter((r) => r.def.school && Math.abs(r.per ?? 0) > eps);
  const rows: WeightRow[] = raw
    .filter((r) => Math.abs(r.per ?? 0) > eps || Math.abs(r.above ?? 0) > eps)
    .filter((r) => !r.def.school || schools.length > 1) // one school: the same as Spell power
    .map((r) => ({
      def: r.def,
      perPoint: r.per,
      ep: epOf(r.per),
      ...(r.def.hitOf && jobs.hits[r.def.hitOf]
        ? { cap: { ...jobs.hits[r.def.hitOf]!, above: r.above ?? 0, aboveEp: epOf(r.above ?? 0) } }
        : {}),
    }));
  return { reference: reference?.def ?? null, rows };
}

/** Analytical stat weights (one light derive per patch: about 20 x 0.3-0.8 ms). Null without damage. */
export function statWeights(inp: InsightInputs): Weights | null {
  const jobs = weightJobs(inp);
  const dps: Record<string, number> = {};
  for (const [k, patch] of Object.entries(jobs.patches)) {
    const d = derive(inp.calc, { ...inp.ch, bonus: { ...inp.ch.bonus, ...patch } }, inp.rotation, {
      reference: false,
    });
    if (!d.ok || !d.damage) return null;
    dps[k] = d.damage.totalDps;
  }
  const pairValue = new Map(jobs.pairs.map((p) => [p.id, (dps[p.to]! - dps[p.from]!) / p.per]));
  const { reference, rows } = weightRows(jobs, (id) => pairValue.get(id));
  const ids = new Set(rows.flatMap((r) => [r.def.key, `${r.def.key}:above`]));
  return { dps: dps.base!, reference, rows, jobs: usedJobs(jobs, ids) };
}
