import type { AttackSlot, RotationEntry, SpecRotation } from "@/data/types";
import type { AbilityResult, PowerKind, WhiteResult } from "@/engine/abilities";

export type CastLimit = "cooldown" | "duration" | "time" | "resource" | "swings" | "procs" | "builder";

/** Casts per minute of one ability and its damage. */
export interface CastLine {
  key: string;
  entry: RotationEntry | null; // null for procs
  ability: AbilityResult;
  perMinute: number;
  damagePerMinute: number;
  dps: number;
  limit: CastLimit;
}
export interface WhiteLine {
  white: WhiteResult;
  swingsPerMinute: number; // white swings that happen (main hand: minus Heroic Strike swings)
  dps: number;
}
export interface RotationResult {
  rotation: SpecRotation;
  power: PowerKind | null;
  casts: CastLine[];
  white: Partial<Record<AttackSlot, WhiteLine>>;
  extras: { label: string; dps: number }[];
  dps: number;
  timeUsedPct: number; // share of the minute spent on GCDs, casts and channels
  resource: { power: PowerKind; incomePerMinute: number; spentPerMinute: number } | null;
  manaPerSecond: number; // mana spent per second (0 for rage/energy rotations)
  oomSeconds: number | null; // seconds until out of mana from full, ignoring regeneration; null if no mana is spent
  skipped: { ability: string; reason: string }[];
}
