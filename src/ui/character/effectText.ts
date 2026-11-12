import type { ManualEffect, PrimaryStat } from "@/data/types";

const MINUS = "−";
const STAT_NAMES: Record<PrimaryStat | "all", string> = {
  str: "Strength",
  agi: "Agility",
  sta: "Stamina",
  int: "Intellect",
  spi: "Spirit",
  all: "all stats",
};
const sign = (v: number) => (v < 0 ? MINUS : "+") + Math.abs(v);
const schoolText = (e: ManualEffect, fallback: string) =>
  e.schools?.length ? e.schools.join("/") : fallback;

/** Short description of one manual effect for the buff list. */
export function effectSummary(e: ManualEffect): string {
  const v = e.value;
  switch (e.key) {
    case "stat":
      return `${sign(v)} ${STAT_NAMES[e.stat ?? "all"]}`;
    case "statPct":
      return `${sign(v)}% ${STAT_NAMES[e.stat ?? "all"]}`;
    case "meleeAttackPower":
      return `${sign(v)} melee AP`;
    case "rangedAttackPower":
      return `${sign(v)} ranged AP`;
    case "attackPower":
      return `${sign(v)} AP`;
    case "spellPower":
      return e.schools?.length ? `${sign(v)} ${e.schools.join("/")} spell power` : `${sign(v)} spell power`;
    case "crit":
      return `${sign(v)}% crit`;
    case "weaponCrit":
      return `${sign(v)}% weapon crit`;
    case "spellCrit":
      return `${sign(v)}% spell crit`;
    case "hit":
      return `${sign(v)}% hit`;
    case "weaponHit":
      return `${sign(v)}% weapon hit`;
    case "spellHit":
      return `${sign(v)}% spell hit`;
    case "haste":
      return `${sign(v)}% haste`;
    case "health":
      return `${sign(v)} health`;
    case "weaponDamage":
      return `${sign(v)} weapon damage`;
    case "targetArmor":
      return `${sign(v)} armor`;
    case "targetResist":
      return `${sign(v)} ${e.schools && e.schools.length < 6 ? schoolText(e, "") : "magic"} resistance`;
    case "targetDamageTakenPct":
      return `${sign(v)}% ${e.schools && e.schools.length < 6 ? schoolText(e, "") : "magic"} damage taken`;
    default:
      return `${e.key} ${v}`;
  }
}

export function effectsSummary(effects: readonly ManualEffect[]): string {
  return effects.map(effectSummary).join(", ");
}
