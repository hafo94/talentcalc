import { create } from "zustand";
import {
  classesFile,
  getClassInfo,
  isClassToken,
  loadClassSpells,
  loadPetFile,
  loadTalentFile,
  loadWeapons,
} from "@/data";
import { buildClassTree, sanitize, type ClassTree, type Ranks } from "@/engine/talents";
import { decodeBuild, type BuildCode } from "./buildCode";
import { characterFromCode, petFromCode } from "./character";
import type { CalcInput, CharInput } from "./derived";
import type { InsightInputs } from "./insight";
import { catalogFor, codeToRotation } from "./rotation";

/**
 * Phase 7 compare: build A is pinned (a build hash), build B is the editor. The URL carries both:
 * `#<build B>~<build A without '#'>` ("~" is not in any build hash, so older links never contain it).
 */
export const COMPARE_SEPARATOR = "~";

/** Splits a location hash into the editor's build and the pinned build (both with "#", pinned null if absent). */
export function splitHash(hash: string): { build: string; pinned: string | null } {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const i = h.indexOf(COMPARE_SEPARATOR);
  if (i < 0) return { build: hash ? `#${h}` : "", pinned: null };
  return { build: `#${h.slice(0, i)}`, pinned: `#${h.slice(i + 1)}` };
}
/** The location hash for the editor's build and the pinned build. */
export function joinHash(build: string, pinned: string | null): string {
  if (!pinned || !build) return build;
  return build + COMPARE_SEPARATOR + pinned.slice(1);
}

export interface CompareState {
  pinned: string | null; // build A as a hash ("#v1..." / "#v2...")
  pin(hash: string): void;
  clear(): void;
}
export const useCompare = create<CompareState>()((set) => ({
  pinned: null,
  pin(hash) {
    set({ pinned: hash || null });
  },
  clear() {
    set({ pinned: null });
  },
}));

/** Build A ready for derive: the stores' inputs, rebuilt from its hash the way a link is applied. */
export interface LoadedBuild {
  hash: string;
  code: BuildCode;
  tree: ClassTree;
  inputs: InsightInputs;
}

/** Loads the class files of a build hash and rebuilds its inputs (null when the hash is not a build). */
export async function loadBuild(hash: string): Promise<LoadedBuild | null> {
  const r = decodeBuild(hash, isClassToken);
  if (!r.ok) return null;
  const code = r.build;
  const token = code.classToken;
  const [file, spells, pets] = await Promise.all([
    loadTalentFile(token),
    loadClassSpells(token),
    loadPetFile(token),
  ]);
  const tree = buildClassTree(file, getClassInfo(token));
  const ctx = { level: code.level, talentedRank: code.talentedRank, currency: classesFile.talentCurrency };
  const { ranks } = sanitize(tree, code.ranks, ctx);
  const w = code.character.weapons;
  const weapons = w.mainHand || w.offHand || w.ranged || w.ammo ? await loadWeapons() : null;
  const { value } = characterFromCode(code.character, token, code.level, weapons);
  const { pet } = petFromCode(code.character.pet, pets);
  const rotation = code.character.rotation
    ? (codeToRotation(code.character.rotation, token, catalogFor(spells, tree))?.rotation ?? null)
    : null;
  const calc: CalcInput = { tree, ranks, level: code.level, spells, pets };
  const ch: CharInput = { ...value, weapons, pet };
  return { hash, code, tree, inputs: { calc, ch, rotation } };
}

export interface TalentChange {
  nodeId: number;
  name: string;
  specIndex: number;
  a: number;
  b: number;
}
/** Talents whose rank differs between A and B, in tree order (null when the classes differ). */
export function talentDiff(tree: ClassTree, a: Ranks, otherTree: ClassTree, b: Ranks): TalentChange[] | null {
  if (tree.token !== otherTree.token) return null;
  return tree.order.flatMap((id) => {
    const ra = a[id] ?? 0;
    const rb = b[id] ?? 0;
    if (ra === rb) return [];
    const n = tree.nodes.get(id)!;
    return [{ nodeId: id, name: n.talent.name, specIndex: n.specIndex, a: ra, b: rb }];
  });
}
