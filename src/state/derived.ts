import { baseStatsFile, buffsFile, getRace, racialsFile, rotationsFile, targetsFile } from "@/data";
import type { ClassSpellFile, MagicSchool, SpecRotation, TargetPresetId } from "@/data/types";
import { pointsBySpec, type ClassTree, type Ranks } from "@/engine/talents";
import { SPECIAL_HANDLERS, type ActiveHandler } from "@/engine/talents/special";
import { evaluateDamage, pickRotation, prepareDamage, type DamageResult } from "@/engine/rotation";
import {
  UnsupportedLevelError,
  assemble,
  computeCharacter,
  evaluateTarget,
  presetTarget,
  type Assembled,
  type CharacterStats,
  type EquippedWeapons,
  type NotModeled,
  type TalentMapping,
  type TargetView,
} from "@/engine/stats";
import type { CharacterState } from "./character";
import { RESIST_ORDER } from "./character";

export const REFERENCE_PRESETS: readonly TargetPresetId[] = ["boss", "elite", "same", "lowArmorBoss"];

/** Damage of the default rotation vs the selected target (null until spells/<class>.json is loaded). */
export interface DamageView {
  rotation: SpecRotation;
  result: DamageResult;
  handlers: ActiveHandler[];
}
export type Derived =
  | {
      ok: true;
      stats: CharacterStats;
      view: TargetView;
      reference: TargetView[]; // `dps` filled when `damage` is not null
      mapping: TalentMapping;
      notModeled: NotModeled[]; // mapping.notModeled minus what the damage engine models (section 8.4)
      damage: DamageView | null;
      weaponsLoading: boolean;
    }
  | { ok: false; reason: "noClass" | "level" };

/** Pure: everything the stats and damage UI shows, from the two stores. */
export function derive(
  calc: { tree: ClassTree | null; ranks: Ranks; level: number; spells: ClassSpellFile | null },
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
  const classTalents = tree.order.map((id) => tree.nodes.get(id)!.talent);
  const args = {
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
  };
  const rotation = pickRotation(rotationsFile, tree.token, pointsBySpec(tree, calc.ranks));
  let a: Assembled;
  let stats: CharacterStats;
  let prepared: ReturnType<typeof prepareDamage> | null = null;
  try {
    if (calc.spells) {
      prepared = prepareDamage({
        ...args,
        spells: calc.spells,
        spellClassSet: tree.info.spellClassSet,
        classTalents,
        rotation,
      });
      a = prepared.assembled;
      stats = prepared.stats;
    } else {
      a = assemble(args);
      stats = computeCharacter(a.input);
    }
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
  const damageAt = (view: TargetView): DamageResult | null =>
    prepared
      ? evaluateDamage({
          level: calc.level,
          stats,
          view,
          book: prepared.book,
          weapons: a.input.weapons,
          rotation,
          talents,
          classTalents,
          spellMods: a.mapping.spellMods,
          selfBuffs: prepared.selfBuffs,
          handlers: prepared.handlers,
        })
      : null;
  const view = at(ch.target);
  const result = damageAt(view);
  const reference = [...REFERENCE_PRESETS, ...(ch.target === "custom" ? (["custom"] as const) : [])].map(
    (p) => {
      const v = at(p);
      const d = p === ch.target && result ? result : damageAt(v);
      return d ? { ...v, dps: d.rotation.dps } : v;
    },
  );
  const damage = result && prepared ? { rotation, result, handlers: prepared.handlers } : null;
  return {
    ok: true,
    stats,
    view,
    reference,
    mapping: a.mapping,
    notModeled: notModeled(a.mapping, tree, damage),
    damage,
    weaponsLoading: ch.weapons === null,
  };
}

/** Talents the damage engine now models are dropped from the "not modeled" list. */
function notModeled(mapping: TalentMapping, tree: ClassTree, damage: DamageView | null): NotModeled[] {
  if (!damage) return mapping.notModeled;
  const used = new Set(damage.result.abilities.filter((x) => x.available).map((x) => x.key));
  for (const s of damage.rotation.selfBuffs) used.add(s);
  return mapping.notModeled.filter((n) => {
    const t = tree.nodes.get(n.nodeId)?.talent;
    if (!t) return true;
    if (n.reason === "special" && SPECIAL_HANDLERS.has(t.spellId)) return false;
    if (n.reason === "ability" && used.has(t.name)) return false;
    return true;
  });
}
