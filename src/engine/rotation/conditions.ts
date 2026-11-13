import type {
  ConditionCmp,
  ConditionType,
  RotationCondition,
  RotationEntry,
  SpecRotation,
} from "@/data/types";
import type { PowerKind } from "@/engine/abilities";

/** src: tooltips "Only usable on enemies that have 20% or less health" (Execute, Hammer of Wrath). */
export const EXECUTE_PHASE_PCT = 20;
export const EXECUTE_ONLY: ReadonlySet<string> = new Set(["Execute", "Hammer of Wrath"]);

/** What a condition can read from the simulator at decision time. */
export interface ConditionState {
  power: PowerKind | null; // the rotation's resource
  resource: number; // rage/energy/focus points, or mana
  maxMana: number;
  comboPoints: number;
  targetHpPct: number; // 0..100
  timeLeft: number; // seconds
  auraLeft(entryIndex: number): number; // seconds left of the entry's own DoT/buff (0 = missing)
  auraActive(name: string): boolean; // player buff/proc or target debuff
  cooldownReady(ability: string): boolean;
}

const cmp = (op: ConditionCmp, a: number, b: number) => (op === "gte" ? a >= b : a < b);

export function conditionHolds(c: RotationCondition, s: ConditionState, entryIndex: number): boolean {
  switch (c.type) {
    case "resource": {
      const v = s.power === "mana" ? (s.maxMana > 0 ? (s.resource / s.maxMana) * 100 : 0) : s.resource;
      return cmp(c.cmp, v, c.value);
    }
    case "comboPoints":
      return cmp(c.cmp, s.comboPoints, c.value);
    case "targetHp":
      return cmp(c.cmp, s.targetHpPct, c.value);
    case "timeLeft":
      return cmp(c.cmp, s.timeLeft, c.value);
    case "auraLeft":
      return cmp(c.cmp, s.auraLeft(entryIndex), c.value);
    case "aura":
      return s.auraActive(c.ref) === c.active;
    case "cooldown":
      return s.cooldownReady(c.ref) === c.ready;
  }
}

export function conditionsHold(entry: RotationEntry, s: ConditionState, entryIndex: number): boolean {
  if (EXECUTE_ONLY.has(entry.ability) && s.targetHpPct >= EXECUTE_PHASE_PCT) return false;
  for (const c of entry.conditions ?? []) if (!conditionHolds(c, s, entryIndex)) return false;
  return true;
}

/** The rotation both engines run: entries switched off in the editor are dropped. */
export function enabledRotation(r: SpecRotation): SpecRotation {
  return r.entries.some((e) => e.off) ? { ...r, entries: r.entries.filter((e) => !e.off) } : r;
}

/** Condition types the analytical model cannot average: entries carrying them are simulation-only. */
const SIM_ONLY: ReadonlySet<ConditionType> = new Set(["targetHp", "aura", "cooldown", "timeLeft"]);

/** Why the analytical model skips an entry (null: it models the entry and ignores resource/cp/auraLeft conditions). */
export function simOnlyReason(entry: RotationEntry): string | null {
  if (entry.kind === "burst") return "cooldown buff: simulation only";
  if (EXECUTE_ONLY.has(entry.ability)) return "execute phase: simulation only";
  const c = (entry.conditions ?? []).find((x) => SIM_ONLY.has(x.type));
  return c ? `condition "${describeCondition(c, null)}": simulation only` : null;
}

/** Metadata for the editor: label, unit and which operands a condition type has. APPEND ONLY (URL index). */
export const CONDITION_TYPES: readonly {
  type: ConditionType;
  label: string;
  operand: "value" | "ref";
  unit: string;
  max: number;
}[] = [
  { type: "resource", label: "Resource", operand: "value", unit: "", max: 10000 },
  { type: "comboPoints", label: "Combo points", operand: "value", unit: "", max: 5 },
  { type: "targetHp", label: "Target health", operand: "value", unit: "%", max: 100 },
  { type: "timeLeft", label: "Fight time left", operand: "value", unit: "s", max: 3600 },
  { type: "auraLeft", label: "Own DoT/buff left", operand: "value", unit: "s", max: 600 },
  { type: "aura", label: "Aura", operand: "ref", unit: "", max: 0 },
  { type: "cooldown", label: "Cooldown", operand: "ref", unit: "", max: 0 },
];

const r1 = (n: number) => String(Math.round(n * 10) / 10);

/** One-line text, e.g. "Rage ≥ 50", "Target health < 20%", "Clearcasting active". */
export function describeCondition(c: RotationCondition, power: PowerKind | null): string {
  const op = (x: ConditionCmp) => (x === "gte" ? "≥" : "<");
  switch (c.type) {
    case "resource": {
      const name = power ? power[0]!.toUpperCase() + power.slice(1) : "Resource";
      return `${name} ${op(c.cmp)} ${r1(c.value)}${power === "mana" ? "%" : ""}`;
    }
    case "comboPoints":
      return `Combo points ${op(c.cmp)} ${r1(c.value)}`;
    case "targetHp":
      return `Target health ${op(c.cmp)} ${r1(c.value)}%`;
    case "timeLeft":
      return `Fight time left ${op(c.cmp)} ${r1(c.value)} s`;
    case "auraLeft":
      return `Own DoT/buff left ${op(c.cmp)} ${r1(c.value)} s`;
    case "aura":
      return `${c.ref} ${c.active ? "active" : "not active"}`;
    case "cooldown":
      return `${c.ref} ${c.ready ? "ready" : "on cooldown"}`;
  }
}
