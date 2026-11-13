// TEST-ONLY helpers for the damage engine. Never import from app code.
import rotationsJson from "@manual/rotations.json";
import type { ClassSpellFile, ClassToken, RotationEntry, RotationsFile, TargetPresetId } from "@/data/types";
import { classesFile } from "@/data";
import { evaluateDamage, pickRotation, prepareDamage } from "@/engine/rotation";
import { EMPTY_BONUS, evaluateTarget, presetTarget } from "@/engine/stats";
import { NO_WEAPONS, baseStats, buffs, racials, ranked, targets, type Scenario } from "./stats";
import { treeFor } from "./talents";

export const rotations = rotationsJson as unknown as RotationsFile;
const spellFiles = Object.values(
  import.meta.glob<{ default: unknown }>("@data/spells/*.json", { eager: true }),
).map((m) => m.default as unknown as ClassSpellFile);
export const spellFile = (token: ClassToken): ClassSpellFile => {
  const f = spellFiles.find((x) => x.token === token);
  if (!f) throw new Error(`no spell file for ${token}`);
  return f;
};

export interface DamageScenario extends Scenario {
  rotation?: string; // rotation id; default: pickRotation by spent points
  entries?: RotationEntry[]; // Phase 5: replaces the rotation's entries
}

/** Full damage evaluation of a scenario against one target preset (default boss). */
export function runDamage(s: DamageScenario, preset: TargetPresetId = s.target ?? "boss") {
  const tree = treeFor(s.classToken);
  const talents = ranked(s.classToken, s.talents ?? {});
  const points = [0, 1, 2].map((i) =>
    talents.filter((t) => tree.nodes.get(t.talent.nodeId)!.specIndex === i).reduce((a, t) => a + t.rank, 0),
  );
  const base = s.rotation
    ? rotations.rotations.find((r) => r.id === s.rotation)!
    : pickRotation(rotations, s.classToken, points);
  const rotation = s.entries ? { ...base, entries: s.entries } : base;
  const info = classesFile.classes.find((c) => c.token === s.classToken)!;
  const p = prepareDamage({
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
    rotation,
  });
  const view = evaluateTarget(
    p.stats,
    presetTarget(targets, preset, 60, p.assembled.debuffs),
    targets.armorFormula,
    p.assembled.input.weapons.offHand !== null,
  );
  const result = evaluateDamage({
    level: 60,
    stats: p.stats,
    view,
    book: p.book,
    weapons: p.assembled.input.weapons,
    rotation,
    talents,
    classTalents: [...tree.nodes.values()].map((n) => n.talent),
    spellMods: p.assembled.mapping.spellMods,
    selfBuffs: p.selfBuffs,
    handlers: p.handlers,
  });
  const ability = (key: string) => {
    const a =
      result.abilities.find((x) => x.key === key) ??
      result.rotation.casts.find((c) => c.key === key)?.ability;
    if (!a || !a.available)
      throw new Error(`${key} not available: ${a && !a.available ? a.reason : "missing"}`);
    return a;
  };
  return { ...p, view, rotation, result, ability };
}
