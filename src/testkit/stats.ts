// TEST-ONLY helpers for the stat engine. Never import from app code.
import baseStatsJson from "@manual/base-stats.json";
import buffsJson from "@manual/buffs.json";
import racialsJson from "@manual/racials.json";
import targetsJson from "@data/targets.json";
import weaponsJson from "@data/weapons.json";
import type {
  BaseStatsFile,
  BuffsFile,
  ClassToken,
  RacialsFile,
  TargetPresetId,
  TargetsFile,
  WeaponsFile,
} from "@/data/types";
import {
  EMPTY_BONUS,
  assemble,
  computeCharacter,
  evaluateTarget,
  presetTarget,
  type BonusStats,
  type EquippedWeapons,
  type RankedTalent,
} from "@/engine/stats";
import { treeFor } from "./talents";

export const baseStats = baseStatsJson as unknown as BaseStatsFile;
export const buffs = buffsJson as unknown as BuffsFile;
export const racials = racialsJson as unknown as RacialsFile;
export const targets = targetsJson as unknown as TargetsFile;
export const weaponsFile = weaponsJson as unknown as WeaponsFile;

export const weapon = (id: number) => {
  const w = weaponsFile.weapons.find((x) => x.id === id);
  if (!w) throw new Error(`no weapon ${id}`);
  return w;
};
export const ammo = (id: number) => {
  const a = weaponsFile.ammo.find((x) => x.id === id);
  if (!a) throw new Error(`no ammo ${id}`);
  return a;
};
export const NO_WEAPONS: EquippedWeapons = { mainHand: null, offHand: null, ranged: null, ammo: null };

/** Talents by name with a rank, e.g. { Cruelty: 5 }. */
export function ranked(token: ClassToken, byName: Record<string, number>): RankedTalent[] {
  const tree = treeFor(token);
  return Object.entries(byName).map(([name, rank]) => {
    const t = [...tree.nodes.values()].find((n) => n.talent.name === name);
    if (!t) throw new Error(`no talent ${name} for ${token}`);
    return { talent: t.talent, rank };
  });
}

export interface Scenario {
  classToken: ClassToken;
  race: string;
  weapons?: Partial<EquippedWeapons>;
  bonus?: Partial<BonusStats>;
  buffIds?: string[];
  talents?: Record<string, number>;
  target?: TargetPresetId;
}

export function run(s: Scenario) {
  const a = assemble({
    classToken: s.classToken,
    race: s.race,
    level: 60,
    baseStats,
    racials,
    buffs,
    buffIds: s.buffIds ?? [],
    talents: ranked(s.classToken, s.talents ?? {}),
    weapons: { ...NO_WEAPONS, ...s.weapons },
    bonus: { ...EMPTY_BONUS, ...s.bonus },
  });
  const stats = computeCharacter(a.input);
  const dw = a.input.weapons.offHand !== null;
  const view = evaluateTarget(
    stats,
    presetTarget(targets, s.target ?? "boss", 60, a.debuffs),
    targets.armorFormula,
    dw,
  );
  return { ...a, stats, view };
}
