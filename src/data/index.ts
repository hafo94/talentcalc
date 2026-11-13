import targetsJson from "@data/targets.json";
import baseStatsJson from "@manual/base-stats.json";
import buffsJson from "@manual/buffs.json";
import petsJson from "@manual/pets.json";
import racialsJson from "@manual/racials.json";
import rotationsJson from "@manual/rotations.json";
import type {
  BaseStatsFile,
  BuffsFile,
  ClassesFile,
  ClassInfo,
  ClassSpellFile,
  ClassToken,
  Manifest,
  PetFile,
  PetsManualFile,
  RaceInfo,
  RacialsFile,
  RotationsFile,
  TalentFile,
  TargetsFile,
  WeaponsFile,
} from "./types";
import classesJson from "@data/classes.json";
import manifestJson from "@data/manifest.json";

export const classesFile = classesJson as unknown as ClassesFile;
export const manifest = manifestJson as unknown as Manifest;
export const DATA_BUILD = manifest.build;
export const CLASS_TOKENS: readonly ClassToken[] = classesFile.classes.map((c) => c.token);

export function getClassInfo(token: ClassToken): ClassInfo {
  const info = classesFile.classes.find((c) => c.token === token);
  if (!info) throw new Error(`unknown class ${token}`);
  return info;
}

export function isClassToken(s: string): s is ClassToken {
  return (CLASS_TOKENS as readonly string[]).includes(s);
}

const talentLoaders = import.meta.glob<{ default: unknown }>("@data/talents/*.json");
const cache = new Map<ClassToken, Promise<TalentFile>>();

export function loadTalentFile(token: ClassToken): Promise<TalentFile> {
  const hit = cache.get(token);
  if (hit) return hit;
  const key = Object.keys(talentLoaders).find((k) => k.endsWith(`/talents/${token}.json`));
  const loader = key ? talentLoaders[key] : undefined;
  if (!loader) throw new Error(`no talent file for ${token}`);
  const p = loader().then((m) => m.default as unknown as TalentFile);
  p.catch(() => cache.delete(token));
  cache.set(token, p);
  return p;
}

export const targetsFile = targetsJson as unknown as TargetsFile;
export const baseStatsFile = baseStatsJson as unknown as BaseStatsFile;
export const buffsFile = buffsJson as unknown as BuffsFile;
export const racialsFile = racialsJson as unknown as RacialsFile;
export const rotationsFile = rotationsJson as unknown as RotationsFile;
export const petsManual = petsJson as unknown as PetsManualFile;

export function getRace(id: number): RaceInfo {
  const r = classesFile.races.find((x) => x.id === id);
  if (!r) throw new Error(`unknown race ${id}`);
  return r;
}

let weaponsPromise: Promise<WeaponsFile> | null = null;
/** weapons.json (~110 KB gzip) is a lazy chunk, loaded once. */
export function loadWeapons(): Promise<WeaponsFile> {
  weaponsPromise ??= import("@data/weapons.json").then((m) => m.default as unknown as WeaponsFile);
  weaponsPromise.catch(() => (weaponsPromise = null));
  return weaponsPromise;
}

const spellLoaders = import.meta.glob<{ default: unknown }>("@data/spells/*.json");
const spellCache = new Map<ClassToken, Promise<ClassSpellFile>>();
/** spells/<class>.json (~20-30 KB gzip): one lazy chunk per class, loaded together with the talent file. */
export function loadClassSpells(token: ClassToken): Promise<ClassSpellFile> {
  const hit = spellCache.get(token);
  if (hit) return hit;
  const key = Object.keys(spellLoaders).find((k) => k.endsWith(`/spells/${token}.json`));
  const loader = key ? spellLoaders[key] : undefined;
  if (!loader) throw new Error(`no spell file for ${token}`);
  const p = loader().then((m) => m.default as unknown as ClassSpellFile);
  p.catch(() => spellCache.delete(token));
  spellCache.set(token, p);
  return p;
}

const petLoaders = import.meta.glob<{ default: unknown }>("@data/pets/*.json");
const petCache = new Map<ClassToken, Promise<PetFile | null>>();
/** pets/<owner>.json (Phase 6, ~10 KB gzip): hunter and warlock only; null for every other class. */
export function loadPetFile(token: ClassToken): Promise<PetFile | null> {
  const hit = petCache.get(token);
  if (hit) return hit;
  const key = Object.keys(petLoaders).find((k) => k.endsWith(`/pets/${token}.json`));
  const loader = key ? petLoaders[key] : undefined;
  const p = loader ? loader().then((m) => m.default as unknown as PetFile) : Promise.resolve(null);
  p.catch(() => petCache.delete(token));
  petCache.set(token, p);
  return p;
}
