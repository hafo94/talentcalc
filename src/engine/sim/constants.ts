// Phase 5 simulator constants. Classic 1.12 values unless stated; none is confirmed in Forever ([VERIFY], Q59-Q66).
import type { ClassToken } from "@/data/types";

/**
 * src: vmangos Player::OCTRegenMPPerSpirit (Classic 1.12): mana per 2 s regeneration tick = Spirit x perSpirit + flat.
 * Warriors and rogues have no mana. [VERIFY Q59]
 */
export const SPIRIT_REGEN: Readonly<Record<ClassToken, { perSpirit: number; flat: number }>> = {
  druid: { perSpirit: 1 / 5, flat: 15 },
  hunter: { perSpirit: 1 / 5, flat: 15 },
  mage: { perSpirit: 1 / 4, flat: 12.5 },
  paladin: { perSpirit: 1 / 5, flat: 15 },
  priest: { perSpirit: 1 / 4, flat: 12.5 },
  shaman: { perSpirit: 1 / 5, flat: 17 },
  warlock: { perSpirit: 1 / 5, flat: 15 },
  warrior: { perSpirit: 0, flat: 0 },
  rogue: { perSpirit: 0, flat: 0 },
};
export const REGEN_TICK_SEC = 2;
/** src: Classic "five-second rule": no Spirit regeneration for 5 s after spending mana (aura 134 talents allow a %). [VERIFY Q59] */
export const FIVE_SECOND_RULE_SEC = 5;

export const MAX_RAGE = 100;
export const MAX_ENERGY = 100;
export const MAX_COMBO_POINTS = 5;
/** Rotations start with full energy and mana and with 0 rage (no pre-pull Bloodrage). */
export const START_RAGE = 0;

/** src: Classic Execute rank 5 tooltip "converting each extra point of rage into 15 additional damage"; the Forever
 * tooltip token ($*10;F1) is not resolved. [VERIFY Q60] */
export const EXECUTE_DAMAGE_PER_RAGE = 15;

/** Talent procs (values from the talent ranks; durations from Classic tooltips where the data has no spell). [VERIFY Q61] */
export const IGNITE = { durationSec: 4, periodSec: 2 } as const; // rolling: a new crit adds to the unticked damage and refreshes
export const DEEP_WOUNDS = { durationSec: 12, periodSec: 3 } as const; // "over 12 sec"; a crit restarts the bleed
export const IMPROVED_SHADOW_BOLT_SEC = 12; // "for 12 sec" (no charges, like the Phase 4 handler)
export const SHADOW_TRANCE_SEC = 10; // Classic Shadow Trance (17941) lasts 10 s; not in the Forever data
export const FLURRY_SWINGS = 3; // "for your next 3 swings"
export const COMBUSTION_CRITS = 3; // "until you have caused 3 non-periodic critical strikes"

/** Seconds between decisions while waiting for a time-based condition (target health, fight time left). */
export const POLL_SEC = 0.5;
/** Resource timeline of iteration 0: one point per this many seconds at most. */
export const TIMELINE_STEP_SEC = 0.5;
