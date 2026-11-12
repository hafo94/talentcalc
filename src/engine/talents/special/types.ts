import type { ShapeshiftForm, Talent } from "@/data/types";
import type { AbilityHook, DamageContext, RotationEffect } from "@/engine/abilities";
import type { EquippedWeapons, SourcedEffect } from "@/engine/stats";
import type { RotationResult } from "@/engine/rotation/types";

/** A talent rank as seen by its handler: values = ranks[rank-1].values (parallel to talent.effects). */
export interface HandlerArgs {
  talent: Talent;
  rank: number;
  values: readonly number[];
  label: string; // "Ignite 5/5"
}
export interface StatEnv {
  weapons: EquippedWeapons;
  form: ShapeshiftForm | null;
  level: number;
}

/**
 * Hand-written behavior of a DUMMY/proc talent, keyed by its talent spell id (ARCHITECTURE "special/").
 * stats: static stat effects before computeCharacter; ability: per-cast change; rotation: uptime effects from pass 1.
 */
export interface SpecialHandler {
  spellId: number;
  name: string;
  modeled: string; // one line for the UI: what the handler models
  stats?(h: HandlerArgs, env: StatEnv): SourcedEffect[];
  ability?(h: HandlerArgs): AbilityHook;
  rotation?(h: HandlerArgs, r: RotationResult, ctx: DamageContext): RotationEffect[];
}
export interface ActiveHandler {
  handler: SpecialHandler;
  args: HandlerArgs;
}
