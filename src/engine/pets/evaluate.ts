import type { SpecRotation, Spell, Talent, TargetsFile } from "@/data/types";
import {
  evaluateAbility,
  evaluateWhite,
  talentModSources,
  type AbilityEval,
  type AbilityResult,
  type DamageContext,
  type RotationEffect,
  type WhiteResult,
} from "@/engine/abilities";
import { runRotation, type RotationResult } from "@/engine/rotation";
import {
  evaluateTarget,
  type CharacterStats,
  type RankedTalent,
  type SpellMod,
  type TargetInput,
} from "@/engine/stats";
import { petBook, petRotation } from "./rotation";
import { computePetStats, petAuras, type PetAuras } from "./stats";
import type { PetDamage, PetSetup } from "./types";

const MINUTE = 60;
const AURA_MELEE_HASTE = 319;

/** Everything the pet engine needs besides the pet: the owner's evaluated character and the target. */
export interface PetEvalArgs {
  setup: PetSetup;
  level: number;
  owner: CharacterStats; // the owner's stats (scaling)
  ownerSpells: readonly Spell[]; // spells/<class>.json (Bestial Wrath)
  classSet: number;
  talents: readonly RankedTalent[];
  classTalents: readonly Talent[];
  spellMods: readonly SpellMod[]; // the owner's talent spell modifiers (they modify pet spells and passives)
  target: TargetInput;
  armorFormula: TargetsFile["armorFormula"];
}

/** One evaluation of the pet with a set of active pet buffs (the simulator memoizes one per buff set). */
export interface PetState {
  ctx: DamageContext;
  rotation: SpecRotation;
  abilities: AbilityEval[]; // per rotation entry
  white: WhiteResult | null; // named "Melee"
  auras: PetAuras;
  focusPerSecond: number | null; // null: the pet has no focus (demons: mana is not modeled)
}

export function petState(
  a: PetEvalArgs,
  buffs: readonly Spell[] = [],
  effects: readonly RotationEffect[] = [],
): PetState {
  const mods = talentModSources(a.spellMods, a.talents);
  const auras = petAuras(a.setup, buffs, mods, a.classSet, a.level);
  const { stats, weapons } = computePetStats(a.setup, { level: a.level, owner: a.owner, auras });
  const view = evaluateTarget(stats, a.target, a.armorFormula, false);
  const book = petBook(a.setup, a.ownerSpells, a.classSet);
  const rotation = petRotation(a.setup, book, a.level, a.talents, a.classTalents);
  const ctx: DamageContext = {
    level: a.level,
    stats,
    view,
    book,
    weapons,
    form: null,
    talents: a.talents,
    classTalents: a.classTalents,
    mods,
    selfBuffs: [],
    effects,
    rotationAbilities: new Set(rotation.entries.map((e) => e.ability)),
    abilityHooks: [],
  };
  // Owner abilities in the pet's list (Bestial Wrath) cost the owner's mana, not the pet's resource.
  const abilities = rotation.entries.map((entry) => {
    const x = evaluateAbility(entry, ctx);
    return entry.kind === "burst" && x.available ? { ...x, power: null, cost: 0 } : x;
  });
  const w = rotation.melee ? evaluateWhite(ctx, "mainHand") : null;
  const focus = a.setup.config.focus;
  return {
    ctx,
    rotation,
    abilities,
    white: w ? { ...w, name: "Melee" } : null,
    auras,
    focusPerSecond: focus ? focus.perSecond * (1 + auras.focusRegenPct / 100) : null,
  };
}

/** Frenzy (analytical): +x% melee haste for d seconds after a crit at the talent's chance; Poisson uptime. */
function frenzyEffect(auras: PetAuras, r: RotationResult): RotationEffect | null {
  const f = auras.frenzy;
  if (!f) return null;
  const w = r.white.mainHand;
  let crits = w ? (w.swingsPerMinute * w.white.critChance) / 100 : 0;
  for (const c of r.casts)
    if (c.ability.kind === "melee")
      crits += (c.perMinute * c.ability.hitChance * Math.min(100, c.ability.critChance)) / 10000;
  const haste = f.spell.effects.find((e) => e.aura === AURA_MELEE_HASTE)?.base ?? 0;
  const sec = (f.spell.duration?.ms ?? 0) / 1000;
  const uptime = 1 - Math.exp((-crits * (f.chance / 100) * sec) / MINUTE);
  return haste > 0 && uptime > 0 ? { label: `${f.label}: Frenzy`, meleeHastePct: haste * uptime } : null;
}

/**
 * Analytical pet damage (section 4.5): the pet's priority list through the Phase 4 rotation model (focus income from
 * pets.json and Bestial Discipline), two passes for the Frenzy uptime. Bursts (Bestial Wrath) are simulation only.
 */
export function evaluatePet(a: PetEvalArgs): PetDamage {
  const pass = (effects: RotationEffect[]) => {
    const st = petState(a, [], effects);
    const rotation = runRotation({
      rotation: st.rotation,
      evals: st.rotation.entries.map((entry, i) => ({ entry, ability: st.abilities[i]! })),
      white: { mainHand: st.white, offHand: null, ranged: null },
      ctx: st.ctx,
      talentRank: () => 0,
      focusPerMinute: (st.focusPerSecond ?? 0) * MINUTE,
    });
    return { st, rotation };
  };
  const p1 = pass([]);
  const fx = frenzyEffect(p1.st.auras, p1.rotation);
  const p2 = fx ? pass([fx]) : p1;
  return {
    name: a.setup.info.name,
    icon: a.setup.info.icon,
    stats: p2.st.ctx.stats,
    view: p2.st.ctx.view,
    ctx: p2.st.ctx,
    rotation: p2.rotation,
    abilities: p2.st.abilities,
    effects: fx ? [fx] : [],
    focusPerSecond: p2.st.focusPerSecond,
  };
}

export const availablePetAbilities = (p: PetDamage): AbilityResult[] =>
  p.abilities.filter((x): x is AbilityResult => x.available);
