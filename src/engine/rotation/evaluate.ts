import type { SpecRotation, Spell, Talent } from "@/data/types";
import {
  buffModSources,
  evaluateWhite,
  talentModSources,
  type AbilityEval,
  type DamageContext,
  type RotationEffect,
  type Spellbook,
} from "@/engine/abilities";
import type { CharacterStats, EquippedWeapons, RankedTalent, SpellMod, TargetView } from "@/engine/stats";
import { rotationEffects, type ActiveHandler } from "@/engine/talents/special";
import { evaluateEntries, runRotation } from "./analytical";
import type { RotationResult } from "./types";

export interface DamageInput {
  level: number;
  stats: CharacterStats;
  view: TargetView;
  book: Spellbook;
  weapons: EquippedWeapons;
  rotation: SpecRotation;
  talents: readonly RankedTalent[];
  classTalents: readonly Talent[];
  spellMods: readonly SpellMod[];
  selfBuffs: readonly Spell[];
  handlers: readonly ActiveHandler[];
}
export interface DamageResult {
  rotation: RotationResult;
  abilities: AbilityEval[]; // rotation entries in order (pass 2), unavailable ones with their reason
  effects: RotationEffect[]; // uptime effects applied in pass 2
  ctx: DamageContext; // Phase 5: the pass-2 context (the simulator evaluates proc spells and extra white hits with it)
}

/**
 * Two passes (section 6.8): pass 1 without uptime effects gives casts and crits per minute; the talent handlers turn
 * them into uptime effects (Flurry haste, Improved Shadow Bolt, Deep Wounds, extra rage ...); pass 2 recomputes
 * everything with those effects. Pure and deterministic.
 */
export function evaluateDamage(input: DamageInput): DamageResult {
  const base: DamageContext = {
    level: input.level,
    stats: input.stats,
    view: input.view,
    book: input.book,
    weapons: input.weapons,
    form: input.rotation.form ?? null,
    talents: input.talents,
    classTalents: input.classTalents,
    mods: [...talentModSources(input.spellMods, input.talents), ...buffModSources(input.selfBuffs)],
    selfBuffs: input.selfBuffs,
    effects: [],
    rotationAbilities: new Set(),
    abilityHooks: input.handlers.flatMap((h) => (h.handler.ability ? [h.handler.ability(h.args)] : [])),
  };
  const pass = (ctx: DamageContext) => {
    const evals = evaluateEntries(input.rotation, ctx);
    const learned = new Set(evals.filter((e) => e.ability.available).map((e) => e.entry.ability));
    const ctx2 = { ...ctx, rotationAbilities: learned };
    const evals2 =
      learned.size === ctx.rotationAbilities.size ? evals : evaluateEntries(input.rotation, ctx2);
    const white = {
      mainHand: input.rotation.melee ? evaluateWhite(ctx2, "mainHand") : null,
      offHand: input.rotation.melee && ctx2.form !== "cat" ? evaluateWhite(ctx2, "offHand") : null,
      ranged: input.rotation.autoShot ? evaluateWhite(ctx2, "ranged") : null,
    };
    const talentRank = (name: string) => input.talents.find((t) => t.talent.name === name)?.rank ?? 0;
    return {
      ctx: ctx2,
      evals: evals2,
      rotation: runRotation({ rotation: input.rotation, evals: evals2, white, ctx: ctx2, talentRank }),
    };
  };
  const p1 = pass(base);
  const effects = rotationEffects(input.handlers, p1.rotation, p1.ctx);
  const p2 = pass({ ...p1.ctx, effects });
  return { rotation: p2.rotation, abilities: p2.evals.map((e) => e.ability), effects, ctx: p2.ctx };
}
