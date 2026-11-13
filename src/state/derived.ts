import {
  baseStatsFile,
  buffsFile,
  getRace,
  petsManual,
  racialsFile,
  rotationsFile,
  targetsFile,
} from "@/data";
import type { ClassSpellFile, MagicSchool, PetFile, SpecRotation, TargetPresetId } from "@/data/types";
import { PET_TALENT_IDS, evaluatePet, resolvePet, type PetDamage, type ResolvedPet } from "@/engine/pets";
import { pointsBySpec, type ClassTree, type Ranks } from "@/engine/talents";
import { SPECIAL_HANDLERS, type ActiveHandler } from "@/engine/talents/special";
import {
  enabledRotation,
  evaluateDamage,
  pickRotation,
  prepareDamage,
  type DamageResult,
} from "@/engine/rotation";
import type { SimInput } from "@/engine/sim/types";
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
  type TargetInput,
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
  pet: PetDamage | null; // Phase 6: the active pet vs the selected target
  totalDps: number; // owner + pet
  petNotes: string[]; // parts of the pet choice that do nothing (resolvePet)
  notes: string[]; // Phase 7: rotation notes, plus noPetNotes while no pet or sacrifice is chosen
}
export type Derived =
  | {
      ok: true;
      stats: CharacterStats;
      view: TargetView;
      reference: TargetView[]; // `dps` (owner + pet) filled when `damage` is not null
      mapping: TalentMapping;
      notModeled: NotModeled[]; // mapping.notModeled minus what the damage engine models (section 8.4)
      damage: DamageView | null;
      weaponsLoading: boolean;
    }
  | { ok: false; reason: "noClass" | "level" };

export type CalcInput = {
  tree: ClassTree | null;
  ranks: Ranks;
  level: number;
  spells: ClassSpellFile | null;
  pets?: PetFile | null; // Phase 6
};
export type CharInput = Pick<
  CharacterState,
  "raceId" | "weaponIds" | "bonus" | "buffIds" | "target" | "custom" | "weapons"
> &
  Partial<Pick<CharacterState, "pet">>;

/** Phase 5: the inputs derive and simInputFor share (weapons, talents, assemble arguments, rotation, custom target). */
function inputsOf(calc: CalcInput & { tree: ClassTree }, ch: CharInput, custom: SpecRotation | null) {
  const tree = calc.tree;
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
  const pet: ResolvedPet | null = ch.pet
    ? resolvePet({
        choice: ch.pet,
        file: calc.pets ?? null,
        manual: petsManual,
        token: tree.token,
        talents,
        level: calc.level,
      })
    : null;
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
    petActive: pet?.pet != null,
    petOwnerEffects: pet?.ownerEffects ?? [],
  };
  // The editor's rotation (Phase 5) when it belongs to this class, else the spec with the most points.
  const chosen =
    custom && custom.class === tree.token
      ? custom
      : pickRotation(rotationsFile, tree.token, pointsBySpec(tree, calc.ranks));
  const resist = Object.fromEntries(RESIST_ORDER.map((s, i) => [s, ch.custom.resist[i]!])) as Record<
    MagicSchool,
    number
  >;
  const customTarget = { level: ch.custom.level, armor: ch.custom.armor, resist };
  return { weapons, talents, classTalents, args, rotation: enabledRotation(chosen), customTarget, pet };
}

/** Phase 7: `reference: false` skips the reference-target rows (insight and stat weights need only the selected target). */
export interface DeriveOptions {
  reference?: boolean;
}

/** Pure: everything the stats and damage UI shows, from the stores (`custom`: the rotation editor's rotation). */
export function derive(
  calc: CalcInput,
  ch: CharInput,
  custom: SpecRotation | null = null,
  opts: DeriveOptions = {},
): Derived {
  const tree = calc.tree;
  if (!tree || ch.raceId === 0) return { ok: false, reason: "noClass" };
  const { weapons, talents, classTalents, args, rotation, customTarget, pet } = inputsOf(
    { ...calc, tree },
    ch,
    custom,
  );
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
  const targetOf = (p: TargetPresetId) => presetTarget(targetsFile, p, calc.level, a.debuffs, customTarget);
  const at = (p: TargetPresetId) => evaluateTarget(stats, targetOf(p), targetsFile.armorFormula, dw);
  const petAt = (target: TargetInput): PetDamage | null =>
    prepared && pet?.pet && calc.spells
      ? evaluatePet({
          setup: pet.pet,
          level: calc.level,
          owner: stats,
          ownerSpells: calc.spells.spells,
          classSet: tree.info.spellClassSet,
          talents,
          classTalents,
          spellMods: a.mapping.spellMods,
          target,
          armorFormula: targetsFile.armorFormula,
        })
      : null;
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
  const petResult = result ? petAt(targetOf(ch.target)) : null;
  const presets = opts.reference === false ? [] : REFERENCE_PRESETS;
  const reference = [
    ...presets,
    ...(ch.target === "custom" && presets.length ? (["custom"] as const) : []),
  ].map((p) => {
    const v = at(p);
    const d = p === ch.target && result ? result : damageAt(v);
    const pd = p === ch.target ? petResult : d ? petAt(targetOf(p)) : null;
    return d ? { ...v, dps: d.rotation.dps + (pd?.rotation.dps ?? 0) } : v;
  });
  const damage =
    result && prepared
      ? {
          rotation,
          result,
          handlers: prepared.handlers,
          pet: petResult,
          totalDps: result.rotation.dps + (petResult?.rotation.dps ?? 0),
          petNotes: pet?.notes ?? [],
          notes: [
            ...rotation.notes,
            ...(ch.pet && (ch.pet.family !== 0 || ch.pet.sacrifice !== 0) ? [] : (rotation.noPetNotes ?? [])),
          ],
        }
      : null;
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

/** Phase 5: the simulator's input for the current state (null until the class spells are loaded). */
export function simInputFor(calc: CalcInput, ch: CharInput, custom: SpecRotation | null): SimInput | null {
  const tree = calc.tree;
  if (!tree || !calc.spells || ch.raceId === 0) return null;
  const x = inputsOf({ ...calc, tree }, ch, custom);
  try {
    const debuffs = assemble(x.args).debuffs;
    return {
      prepare: {
        ...x.args,
        spells: calc.spells,
        spellClassSet: tree.info.spellClassSet,
        classTalents: x.classTalents,
      },
      rotation: x.rotation,
      target: presetTarget(targetsFile, ch.target, calc.level, debuffs, x.customTarget),
      armorFormula: targetsFile.armorFormula,
      pet: x.pet?.pet ?? null,
    };
  } catch (e) {
    if (e instanceof UnsupportedLevelError) return null;
    throw e;
  }
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
    if (PET_TALENT_IDS.has(t.spellId)) return false; // Phase 6: modeled with the pet choice (Pet panel)
    if (n.reason === "ability" && used.has(t.name)) return false;
    return true;
  });
}
