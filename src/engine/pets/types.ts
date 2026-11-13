import type { ClassToken, PetInfo, PetOwnerConfig, Spell } from "@/data/types";
import type { AbilityEval, DamageContext, RotationEffect } from "@/engine/abilities";
import type { RotationResult } from "@/engine/rotation";
import type { CharacterStats, SourcedEffect, TargetView } from "@/engine/stats";

/** The user's pet choice (URL tag 8). family/sacrifice: CreatureFamily ids, 0 = none. */
export interface PetChoice {
  family: number; // active pet
  sacrifice: number; // warlock: sacrificed demon (Demonic Sacrifice)
  scaling: boolean; // pets scale with the owner's stats (Q5)
}
export const NO_PET: PetChoice = { family: 0, sacrifice: 0, scaling: true };
/**
 * Phase 7 (owner decision): the pet a new build starts with when the class is picked in the UI (Cat 2, Imp 23,
 * CreatureFamily ids). Links never use it: a link without a pet record (tag 8) is NO_PET, the URL default.
 */
export const DEFAULT_PET_FAMILY: Partial<Record<ClassToken, number>> = { hunter: 2, warlock: 23 };
export const defaultPet = (token: ClassToken): PetChoice => ({
  ...NO_PET,
  family: DEFAULT_PET_FAMILY[token] ?? 0,
});

/** The active pet, as plain data (SimInput carries it to the worker). */
export interface PetSetup {
  info: PetInfo;
  spells: Spell[]; // pets/<owner>.json spells
  config: PetOwnerConfig; // data/manual/pets.json owners[owner]
  scaling: boolean;
  effects: SourcedEffect[]; // owner talents that also apply to the pet (Focused Fire, Master Demonologist, Soul Link ...)
}

/** resolvePet: what a pet choice does with the current talents. */
export interface ResolvedPet {
  pet: PetSetup | null;
  ownerEffects: SourcedEffect[]; // effects on the owner (shared talents and Demonic Sacrifice)
  notes: string[]; // parts of the choice that do nothing (missing talent, sacrifice cancelled ...)
}

/** Analytical pet damage vs one target (the pet's own stats and outcome tables). */
export interface PetDamage {
  name: string;
  icon: string | null;
  stats: CharacterStats;
  view: TargetView;
  ctx: DamageContext;
  rotation: RotationResult;
  abilities: AbilityEval[]; // pet rotation entries in order
  effects: RotationEffect[]; // uptime effects of pass 2 (Frenzy)
  focusPerSecond: number | null;
}
