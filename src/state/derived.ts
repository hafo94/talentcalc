import { baseStatsFile, buffsFile, getRace, racialsFile, targetsFile } from "@/data";
import type { MagicSchool, TargetPresetId } from "@/data/types";
import type { ClassTree, Ranks } from "@/engine/talents";
import {
  UnsupportedLevelError,
  assemble,
  computeCharacter,
  evaluateTarget,
  presetTarget,
  type CharacterStats,
  type EquippedWeapons,
  type TalentMapping,
  type TargetView,
} from "@/engine/stats";
import type { CharacterState } from "./character";
import { RESIST_ORDER } from "./character";

export const REFERENCE_PRESETS: readonly TargetPresetId[] = ["boss", "elite", "same", "lowArmorBoss"];

export type Derived =
  | {
      ok: true;
      stats: CharacterStats;
      view: TargetView;
      reference: TargetView[];
      mapping: TalentMapping;
      weaponsLoading: boolean;
    }
  | { ok: false; reason: "noClass" | "level" };

/** Pure: everything the stats UI shows, from the two stores. */
export function derive(
  calc: { tree: ClassTree | null; ranks: Ranks; level: number },
  ch: Pick<CharacterState, "raceId" | "weaponIds" | "bonus" | "buffIds" | "target" | "custom" | "weapons">,
): Derived {
  const tree = calc.tree;
  if (!tree || ch.raceId === 0) return { ok: false, reason: "noClass" };
  const byId = (id: number) =>
    id && ch.weapons ? (ch.weapons.weapons.find((w) => w.id === id) ?? null) : null;
  const weapons: EquippedWeapons = {
    mainHand: byId(ch.weaponIds.mainHand),
    offHand: byId(ch.weaponIds.offHand),
    ranged: byId(ch.weaponIds.ranged),
    ammo:
      ch.weaponIds.ammo && ch.weapons
        ? (ch.weapons.ammo.find((a) => a.id === ch.weaponIds.ammo) ?? null)
        : null,
  };
  const talents = tree.order
    .filter((id) => (calc.ranks[id] ?? 0) > 0)
    .map((id) => ({ talent: tree.nodes.get(id)!.talent, rank: calc.ranks[id]! }));
  const a = assemble({
    classToken: tree.token,
    race: getRace(ch.raceId).token.toUpperCase(),
    level: calc.level,
    baseStats: baseStatsFile,
    racials: racialsFile,
    buffs: buffsFile,
    buffIds: ch.buffIds,
    talents,
    weapons,
    bonus: ch.bonus,
  });
  let stats: CharacterStats;
  try {
    stats = computeCharacter(a.input);
  } catch (e) {
    if (e instanceof UnsupportedLevelError) return { ok: false, reason: "level" };
    throw e;
  }
  const dw = weapons.offHand !== null;
  const resist = Object.fromEntries(RESIST_ORDER.map((s, i) => [s, ch.custom.resist[i]!])) as Record<
    MagicSchool,
    number
  >;
  const custom = { level: ch.custom.level, armor: ch.custom.armor, resist };
  const at = (p: TargetPresetId) =>
    evaluateTarget(
      stats,
      presetTarget(targetsFile, p, calc.level, a.debuffs, custom),
      targetsFile.armorFormula,
      dw,
    );
  const view = at(ch.target);
  const reference = [...REFERENCE_PRESETS, ...(ch.target === "custom" ? (["custom"] as const) : [])].map(at);
  return { ok: true, stats, view, reference, mapping: a.mapping, weaponsLoading: ch.weapons === null };
}
