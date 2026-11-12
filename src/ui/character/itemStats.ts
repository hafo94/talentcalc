import { CRIT_RATING_PER_PCT, HIT_RATING_PER_PCT, ITEM_STAT } from "@/engine/stats";
import type { ItemStat } from "@/data/types";

const LABELS: Record<number, string> = {
  3: "Agility",
  4: "Strength",
  5: "Intellect",
  6: "Spirit",
  7: "Stamina",
  31: "Hit rating",
  32: "Crit rating",
  36: "Haste rating",
  38: "Attack Power",
  39: "Ranged Attack Power",
  41: "Healing",
  42: "Spell Power",
  45: "Spell Power",
  43: "Mana per 5 sec",
  50: "Armor",
  51: "Fire Resistance",
  52: "Frost Resistance",
  53: "Holy Resistance",
  54: "Shadow Resistance",
  55: "Nature Resistance",
  56: "Arcane Resistance",
};
const MODELED = new Set<number>([
  ITEM_STAT.agi,
  ITEM_STAT.str,
  ITEM_STAT.int,
  ITEM_STAT.spi,
  ITEM_STAT.sta,
  ITEM_STAT.hitRating,
  ITEM_STAT.critRating,
  ITEM_STAT.hasteRating,
  ITEM_STAT.attackPower,
  ITEM_STAT.rangedAttackPower,
  ITEM_STAT.spellDamage,
  ITEM_STAT.spellPower,
]);

export interface ItemStatLine {
  text: string;
  modeled: boolean;
}

/** One display line per item stat; ratings show their percent value. */
export function itemStatLine(s: ItemStat): ItemStatLine {
  const label = LABELS[s.stat];
  if (!label) return { text: `Unknown stat ${s.stat} (not modeled)`, modeled: false };
  let text = `+${s.value} ${label}`;
  if (s.stat === ITEM_STAT.hitRating) text += ` (= ${(s.value / HIT_RATING_PER_PCT).toFixed(2)}%)`;
  if (s.stat === ITEM_STAT.critRating) text += ` (= ${(s.value / CRIT_RATING_PER_PCT).toFixed(2)}%)`;
  return { text, modeled: MODELED.has(s.stat) };
}
