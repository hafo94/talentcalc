import type { BaseStatsFile, ClassBaseStats, ManualClassToken } from "@/data/types";
import { UnsupportedLevelError } from "./errors";

/** Base stats and stat conversions of a class at one level (Phase 7). */
export interface LevelBase {
  base: ClassBaseStats;
  agiPerMeleeCrit: number; // Agility per 1% melee crit at this level
  intPerSpellCrit: number | undefined; // Intellect per 1% spell crit (undefined: the class gets no spell crit from Int)
}

const LEVEL_STATS = ["str", "agi", "sta", "int", "spi", "health", "mana"] as const;

/**
 * Class base stats at `level` (1..file.level). Level `file.level` (60) is the `classes` table itself. Below it the
 * values are a linear interpolation between `level1` and `classes`, rounded to whole points; base crit and race offsets
 * do not change with level. Agility/Intellect per 1% crit scale with the class's base Agility/Intellect, so a naked
 * character keeps the same crit from its base stats at every level. [VERIFY Q76]
 */
export function baseStatsAt(file: BaseStatsFile, cls: ManualClassToken, level: number): LevelBase {
  const top = file.classes[cls];
  const conv = file.conversions;
  if (!top) throw new Error(`no base stats for ${cls}`);
  if (level === file.level)
    return {
      base: top,
      agiPerMeleeCrit: conv.agiPerMeleeCrit[cls],
      intPerSpellCrit: conv.intPerSpellCrit[cls],
    };
  const one = file.level1?.classes[cls];
  if (!one || !Number.isInteger(level) || level < 1 || level > file.level)
    throw new UnsupportedLevelError(`no base stats for level ${level} (1..${file.level})`);
  const t = (level - 1) / (file.level - 1);
  const base: ClassBaseStats = { ...top };
  for (const k of LEVEL_STATS) base[k] = Math.round(one[k] + (top[k] - one[k]) * t);
  const intPer = conv.intPerSpellCrit[cls];
  return {
    base,
    agiPerMeleeCrit: (conv.agiPerMeleeCrit[cls] * base.agi) / top.agi,
    intPerSpellCrit: intPer === undefined ? undefined : (intPer * base.int) / top.int,
  };
}
