import classesJson from "@data/classes.json";
import manifestJson from "@data/manifest.json";
import type { ClassesFile, ClassInfo, ClassToken, Manifest, TalentFile } from "./types";

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
