export const MIN_LEVEL = 1;
export const MAX_LEVEL = 60;
export const MAX_TALENTED_RANK = 5;
/**
 * Tier gates count only nodes in a lower tier than the gate (the raw scope of every tier-7 gate and of the
 * Discipline tier-3 gate contains the gated node itself). [VERIFY Q28] in game: with exactly 30 points in
 * tiers 1-6 plus the capstone, try to refund a tier-1 point.
 */
export const GATE_COUNTS_LOWER_TIERS_ONLY = true;
