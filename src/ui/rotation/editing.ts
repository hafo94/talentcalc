import type { ConditionType, RotationCondition, RotationEntry, RotationEntryKind } from "@/data/types";
import { PROC_AURAS } from "@/state/rotation";

export const KIND_LABEL: Record<RotationEntryKind, string> = {
  cooldown: "On cooldown",
  dot: "Keep DoT up",
  maintain: "Recast every …",
  filler: "Filler",
  builder: "Combo builder",
  finisher: "Finisher",
  nextSwing: "On next swing",
  burst: "Cooldown buff",
};
export const KINDS = Object.keys(KIND_LABEL) as RotationEntryKind[];

/** A new condition of a type with its default operands. */
export function newCondition(type: ConditionType, refs: readonly string[]): RotationCondition {
  switch (type) {
    case "aura":
      return { type, ref: refs[0] ?? PROC_AURAS[0]!, active: true };
    case "cooldown":
      return { type, ref: refs[0] ?? "", ready: true };
    case "targetHp":
      return { type, cmp: "lt", value: 20 };
    case "auraLeft":
      return { type, cmp: "lt", value: 2 };
    default:
      return { type, cmp: "gte", value: type === "comboPoints" ? 5 : 50 };
  }
}

export function move<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

/** A copy of an entry without one optional field. */
export function strip(e: RotationEntry, key: "off" | "conditions"): RotationEntry {
  const out = { ...e };
  delete out[key];
  return out;
}
