// TEST-ONLY helpers. Never import from app code.
import { classesFile } from "@/data";
import type { ClassToken, TalentFile } from "@/data/types";
import { buildClassTree, type ClassTree, type PointsContext, type Ranks, addPoint } from "@/engine/talents";
import { expect } from "vitest";

const files = Object.values(
  import.meta.glob<{ default: unknown }>("@data/talents/*.json", { eager: true }),
).map((m) => m.default as unknown as TalentFile);

const trees = new Map<ClassToken, ClassTree>();
export function treeFor(token: ClassToken): ClassTree {
  let t = trees.get(token);
  if (!t) {
    const file = files.find((f) => f.token === token);
    const info = classesFile.classes.find((c) => c.token === token);
    if (!file || !info) throw new Error(`no data for ${token}`);
    t = buildClassTree(file, info);
    trees.set(token, t);
  }
  return t;
}

export function ctx60(talentedRank = 0, level = 60): PointsContext {
  return { level, talentedRank, currency: classesFile.talentCurrency };
}

/** Calls addPoint n times per entry and asserts every call changed the ranks. */
export function spend(tree: ClassTree, ranks: Ranks, steps: [number, number][], ctx = ctx60()): Ranks {
  let r = ranks;
  for (const [id, n] of steps) {
    for (let i = 0; i < n; i++) {
      const next = addPoint(tree, r, id, ctx);
      expect(next, `addPoint ${id} #${i + 1}`).not.toBe(r);
      r = next;
    }
  }
  return r;
}

/** Mage, Fire 33 / Frost 18 (plan section 6.3), in table order. */
export const MAGE_51_STEPS: [number, number][] = [
  [105796, 5],
  [105795, 5],
  [105794, 5],
  [105792, 3],
  [105789, 3],
  [105790, 1],
  [105788, 3],
  [105786, 1],
  [105784, 3],
  [105782, 3],
  [105781, 1],
  [105779, 5],
  [105778, 3],
  [105780, 2],
  [105777, 5],
  [105774, 3],
];
export const MAGE_51: Ranks = Object.fromEntries(MAGE_51_STEPS.map(([id, n]) => [id, n]));
