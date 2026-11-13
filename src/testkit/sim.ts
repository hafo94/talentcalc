// TEST-ONLY helpers for the simulator. Never import from app code.
import type { SpecRotation, TargetPresetId } from "@/data/types";
import { classesFile } from "@/data";
import { pickRotation } from "@/engine/rotation";
import type { SimInput } from "@/engine/sim";
import { EMPTY_BONUS, assemble, presetTarget } from "@/engine/stats";
import { scenarioPet } from "./pets";
import { NO_WEAPONS, baseStats, buffs, racials, ranked, targets } from "./stats";
import { treeFor } from "./talents";
import { rotations, spellFile, type DamageScenario } from "./damage";

export type SimScenario = DamageScenario;

/** The rotation of a scenario (by id, else picked by points), with `entries` replaced when given. */
export function scenarioRotation(s: SimScenario): SpecRotation {
  const tree = treeFor(s.classToken);
  const talents = ranked(s.classToken, s.talents ?? {});
  const points = [0, 1, 2].map((i) =>
    talents.filter((t) => tree.nodes.get(t.talent.nodeId)!.specIndex === i).reduce((a, t) => a + t.rank, 0),
  );
  const base = s.rotation
    ? rotations.rotations.find((r) => r.id === s.rotation)!
    : pickRotation(rotations, s.classToken, points);
  return s.entries ? { ...base, entries: s.entries } : base;
}

/** SimInput of a scenario vs a target preset (same inputs as runDamage). */
export function simInput(s: SimScenario, preset: TargetPresetId = s.target ?? "boss"): SimInput {
  const tree = treeFor(s.classToken);
  const talents = ranked(s.classToken, s.talents ?? {});
  const info = classesFile.classes.find((c) => c.token === s.classToken)!;
  const resolved = scenarioPet(s.classToken, s.pet, talents);
  const prepare = {
    classToken: s.classToken,
    race: s.race,
    level: 60,
    baseStats,
    racials,
    buffs,
    buffIds: s.buffIds ?? [],
    talents,
    weapons: { ...NO_WEAPONS, ...s.weapons },
    bonus: { ...EMPTY_BONUS, ...s.bonus },
    spells: spellFile(s.classToken),
    spellClassSet: info.spellClassSet,
    classTalents: [...tree.nodes.values()].map((n) => n.talent),
    petActive: resolved.pet !== null,
    petOwnerEffects: resolved.ownerEffects,
  };
  const debuffs = assemble(prepare).debuffs;
  return {
    prepare,
    rotation: scenarioRotation(s),
    target: presetTarget(targets, preset, 60, debuffs),
    armorFormula: targets.armorFormula,
    pet: resolved.pet,
  };
}
