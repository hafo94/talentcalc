import type { School, SpecRotation, Spell } from "@/data/types";
import type { Prepared } from "@/engine/rotation";
import type { EquippedWeapons, RankedTalent } from "@/engine/stats";
import type { BuffDef } from "./model";

/**
 * Talent spell ids whose behavior the simulator samples as real events (section 4.5). Their Phase 4 handlers keep
 * their `stats` hook (applied by prepareDamage) but their `ability`/`rotation` hooks are not passed to evaluateDamage,
 * so nothing is counted twice. Every other handler stays an analytical average (SimResult.averaged).
 */
export const TALENT = {
  IGNITE: 11119,
  FLURRY_WARRIOR: 12319,
  FLURRY_SHAMAN: 16256,
  IMPROVED_SHADOW_BOLT: 17793,
  NIGHTFALL: 18094,
  DEEP_WOUNDS: 12834,
  UNBRIDLED_WRATH: 12322,
  ANGER_MANAGEMENT: 12296,
  SEAL_FATE: 14186,
  RUTHLESSNESS: 14156,
  WEAPONMASTER: 1290261,
  HACK_AND_SLASH: 13960,
  ARCANE_CONCENTRATION: 11213, // no Phase 4 handler (mana only)
  ELEMENTAL_FOCUS: 16164, // no Phase 4 handler (mana only)
  COMBUSTION: 11129,
} as const;
export const SIM_PROC_TALENTS: ReadonlySet<number> = new Set(Object.values(TALENT));

/** Extra-attack part of the weapon talents: same value index and weapon subclasses as handlers.ts weaponTalent(). */
const EXTRA_ATTACK: Readonly<Record<number, { valueIndex: number; subclasses: number[] }>> = {
  [TALENT.WEAPONMASTER]: { valueIndex: 2, subclasses: [7, 8] }, // swords
  [TALENT.HACK_AND_SLASH]: { valueIndex: 0, subclasses: [0, 1, 7, 8] }, // axes and swords
};
const NIGHTFALL_SPELLS: ReadonlySet<string> = new Set(["Corruption", "Drain Life", "Drain Soul", "Wrack"]);
const ELEMENTAL_FOCUS_SCHOOLS: School[] = ["fire", "frost", "nature"];

export interface ActiveProcs {
  ignitePct: number;
  flurryPct: number;
  isbPct: number;
  nightfallPct: number;
  nightfallSpells: ReadonlySet<string>;
  deepWoundsPct: number;
  unbridledWrathPct: number;
  angerManagement: { amount: number; periodSec: number } | null;
  sealFatePct: number;
  ruthlessnessPct: number;
  extraAttackPct: number; // main-hand weapon hits
  clearcasting: { chance: number; schools: School[] | null; spell: Spell; buff: BuffDef | null } | null;
  combustion: { spell: Spell; buff: BuffDef | null } | null;
  sealOfCommand: Spell | null; // the proc spell of the rotation's Seal of Command
  windfury: boolean;
  labels: string[]; // what the simulator samples, for the results panel
}

const value = (t: RankedTalent | undefined, i: number) =>
  t ? (t.talent.ranks[t.rank - 1]?.values[i] ?? 0) : 0;
const triggerOf = (spell: Spell | undefined, book: Prepared["book"]) => {
  const id = spell?.effects.find((e) => e.triggerSpell)?.triggerSpell;
  return id ? book.spells.get(id) : undefined;
};

export function activeProcs(
  prepared: Prepared,
  talents: readonly RankedTalent[],
  weapons: EquippedWeapons,
  rotation: SpecRotation,
): ActiveProcs {
  const ranked = (id: number) => talents.find((t) => t.talent.spellId === id && t.rank > 0);
  const labels: string[] = [];
  const pct = (id: number, i: number, text: string) => {
    const t = ranked(id);
    const v = value(t, i);
    if (t && v > 0) labels.push(`${t.talent.name} ${t.rank}/${t.talent.maxRank}: ${text}`);
    return v;
  };
  const book = prepared.book;
  const mh = weapons.mainHand?.subclass;
  let extraAttackPct = 0;
  for (const [id, x] of Object.entries(EXTRA_ATTACK))
    if (mh !== undefined && x.subclasses.includes(mh))
      extraAttackPct += pct(Number(id), x.valueIndex, "extra main-hand attacks");
  const am = ranked(TALENT.ANGER_MANAGEMENT);
  if (am) labels.push(`${am.talent.name}: 1 rage every ${value(am, 2)} s`);

  let clearcasting: ActiveProcs["clearcasting"] = null;
  for (const [id, schools] of [
    [TALENT.ARCANE_CONCENTRATION, null],
    [TALENT.ELEMENTAL_FOCUS, ELEMENTAL_FOCUS_SCHOOLS],
  ] as const) {
    const t = ranked(id);
    const spell = triggerOf(book.spells.get(id), book);
    if (t && spell && value(t, 0) > 0) {
      clearcasting = { chance: value(t, 0), schools: schools ? [...schools] : null, spell, buff: null };
      labels.push(`${t.talent.name} ${t.rank}/${t.talent.maxRank}: Clearcasting procs`);
    }
  }
  const comb = ranked(TALENT.COMBUSTION) ? triggerOf(book.spells.get(TALENT.COMBUSTION), book) : undefined;
  if (comb) labels.push("Combustion: +10% Fire crit per Fire hit, removed after 3 crits");

  const seal = prepared.selfBuffs.find((s) => s.name === "Seal of Command");
  const sealOfCommand = triggerOf(seal, book) ?? null;
  if (sealOfCommand) labels.push("Seal of Command: 7 procs per minute on main-hand swings");
  const windfury = rotation.melee && prepared.selfBuffs.some((s) => s.name === "Windfury Weapon");
  if (windfury) labels.push("Windfury Weapon: 20% chance of 2 extra attacks");

  return {
    ignitePct: pct(TALENT.IGNITE, 0, "rolling Ignite"),
    flurryPct:
      pct(TALENT.FLURRY_WARRIOR, 0, "Flurry charges on crits") +
      pct(TALENT.FLURRY_SHAMAN, 0, "Flurry charges on crits"),
    isbPct: pct(TALENT.IMPROVED_SHADOW_BOLT, 0, "Shadow Bolt crits apply the debuff"),
    nightfallPct: pct(TALENT.NIGHTFALL, 0, "Shadow Trance procs"),
    nightfallSpells: NIGHTFALL_SPELLS,
    deepWoundsPct: pct(TALENT.DEEP_WOUNDS, 0, "bleed on crits"),
    unbridledWrathPct: pct(TALENT.UNBRIDLED_WRATH, 0, "rage procs"),
    angerManagement: am ? { amount: value(am, 1), periodSec: Math.max(1, value(am, 2)) } : null,
    sealFatePct: pct(TALENT.SEAL_FATE, 0, "extra combo points on crits"),
    ruthlessnessPct: pct(TALENT.RUTHLESSNESS, 0, "combo point refunds"),
    extraAttackPct,
    clearcasting,
    combustion: comb ? { spell: comb, buff: null } : null,
    sealOfCommand,
    windfury,
    labels,
  };
}
