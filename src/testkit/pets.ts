// TEST-ONLY helpers for pets. Never import from app code.
import petsJson from "@manual/pets.json";
import type { ClassToken, PetFile, PetsManualFile } from "@/data/types";
import { NO_PET, resolvePet, type PetChoice, type ResolvedPet } from "@/engine/pets";
import type { RankedTalent } from "@/engine/stats";

export const petsManualFile = petsJson as unknown as PetsManualFile;
const files = Object.values(import.meta.glob<{ default: unknown }>("@data/pets/*.json", { eager: true })).map(
  (m) => m.default as unknown as PetFile,
);
export const petFile = (token: ClassToken): PetFile | null => files.find((f) => f.token === token) ?? null;

/** A pet by name ("Cat", "Imp"); sacrifice by demon name. */
export interface PetScenario {
  family?: string;
  sacrifice?: string;
  scaling?: boolean;
}
export function petChoice(token: ClassToken, s: PetScenario | undefined): PetChoice {
  if (!s) return NO_PET;
  const id = (name: string | undefined) => {
    if (!name) return 0;
    const p = petFile(token)?.pets.find((x) => x.name === name);
    if (!p) throw new Error(`no pet ${name} for ${token}`);
    return p.id;
  };
  return { family: id(s.family), sacrifice: id(s.sacrifice), scaling: s.scaling ?? true };
}
export function scenarioPet(
  token: ClassToken,
  s: PetScenario | undefined,
  talents: readonly RankedTalent[],
): ResolvedPet {
  return resolvePet({
    choice: petChoice(token, s),
    file: petFile(token),
    manual: petsManualFile,
    token,
    talents,
    level: 60,
  });
}
