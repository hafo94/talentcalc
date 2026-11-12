import type { TalentCurrency } from "@/data/types";
import { MAX_LEVEL, MIN_LEVEL } from "./constants";

export interface PointsContext {
  level: number;
  talentedRank: number;
  currency: TalentCurrency;
}

export function availablePoints(ctx: PointsContext): number {
  let total = 0;
  for (const src of ctx.currency.sources) {
    if (src.level > ctx.level) continue;
    if (src.perk && src.perk.rank > ctx.talentedRank) continue;
    total += src.amount;
  }
  return Math.min(total, ctx.currency.max);
}

/** Smallest level that grants `spent` points, or null when nothing is spent or no level grants that many. */
export function requiredLevel(spent: number, talentedRank: number, currency: TalentCurrency): number | null {
  if (spent <= 0) return null;
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
    if (availablePoints({ level, talentedRank, currency }) >= spent) return level;
  }
  return null;
}
