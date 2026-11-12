import { describe, expect, it } from "vitest";
import { CLASS_TOKENS, classesFile } from "./index";
import type { TalentFile } from "./types";
import { buildClassTree } from "@/engine/talents";

const files = Object.values(
  import.meta.glob<{ default: unknown }>("@data/talents/*.json", { eager: true }),
).map((m) => m.default as unknown as TalentFile);
const byToken = new Map(files.map((f) => [f.token, f]));

describe("generated talent data invariants", () => {
  it("has 9 files matching classes.json, 3 specs each", () => {
    expect(files).toHaveLength(9);
    expect([...byToken.keys()].sort()).toEqual([...CLASS_TOKENS].sort());
    for (const c of classesFile.classes) {
      const f = byToken.get(c.token)!;
      expect(f.specs.map((s) => s.index)).toEqual([0, 1, 2]);
      f.specs.forEach((s, i) => expect(s.talentTabId).toBe(c.specs[i]!.talentTabId));
    }
  });

  it("has 447 well-formed talents", () => {
    let n = 0;
    for (const f of files)
      for (const s of f.specs)
        for (const t of s.talents) {
          n++;
          expect(["passive", "ability"]).toContain(t.kind);
          expect(t.hidden).toBeUndefined();
          expect(t.choices).toBeUndefined();
          expect(t.ranks).toHaveLength(t.maxRank);
          expect(t.maxRank).toBeGreaterThanOrEqual(1);
          expect(t.maxRank).toBeLessThanOrEqual(7);
        }
    expect(n).toBe(447);
  });

  it("has valid positions, sorted, no duplicates", () => {
    for (const f of files)
      for (const s of f.specs) {
        const seen = new Set<string>();
        let prev = -1;
        for (const t of s.talents) {
          expect(t.tier).toBeGreaterThanOrEqual(1);
          expect(t.tier).toBeLessThanOrEqual(7);
          expect(t.col).toBeGreaterThanOrEqual(0);
          expect(t.col).toBeLessThanOrEqual(3);
          expect(t.requiredPoints).toBe(5 * (t.tier - 1));
          const key = `${t.tier},${t.col}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
          const order = t.tier * 10 + t.col;
          expect(order).toBeGreaterThan(prev);
          prev = order;
        }
      }
  });

  it("has tier gates 2..7 with counted nodes inside the spec", () => {
    for (const f of files)
      for (const s of f.specs) {
        expect(s.tierGates.map((g) => g.tier)).toEqual([2, 3, 4, 5, 6, 7]);
        const ids = new Set(s.talents.map((t) => t.nodeId));
        for (const g of s.tierGates) {
          expect(g.requiredPoints).toBe(5 * (g.tier - 1));
          for (const id of g.countedNodeIds) expect(ids.has(id)).toBe(true);
        }
      }
  });

  it("has prerequisites in the same spec, earlier in order, with nothing in between", () => {
    for (const f of files)
      for (const s of f.specs) {
        const by = new Map(s.talents.map((t) => [t.nodeId, t]));
        const index = new Map(s.talents.map((t, i) => [t.nodeId, i]));
        for (const t of s.talents) {
          if (t.prereqNodeId === undefined) continue;
          const p = by.get(t.prereqNodeId);
          expect(p, `prereq of ${t.name}`).toBeDefined();
          expect(index.get(p!.nodeId)!).toBeLessThan(index.get(t.nodeId)!);
          if (p!.col === t.col) {
            const between = s.talents.filter((x) => x.col === t.col && x.tier > p!.tier && x.tier < t.tier);
            expect(between).toHaveLength(0);
          }
        }
      }
  });

  it("has the talent currency with the Talented perk ranks", () => {
    const cur = classesFile.talentCurrency;
    expect(cur.max).toBe(51);
    expect(cur.sources.filter((s) => !s.perk).reduce((a, s) => a + s.amount, 0)).toBe(51);
    const perks = cur.sources.filter((s) => s.perk);
    expect(perks.map((s) => s.perk!.rank).sort()).toEqual([1, 2, 3, 4, 5]);
    for (const s of perks) expect(s.level).toBe(10 - s.perk!.rank);
  });

  it("has lowercase icon names", () => {
    for (const f of files)
      for (const s of f.specs)
        for (const t of s.talents) {
          // One real file name ends with a dot (Spell_Shadow_DevouringPlague..blp, Devouring Contagion).
          // Both CDNs serve it as "<name>..jpg" (HTTP 200, checked 2026-11-12), so the dot is allowed.
          expect(t.icon).toMatch(/^[a-z0-9_-]+\.?$/);
        }
  });

  it("builds a class tree for every class with only the known gate anomalies", () => {
    for (const c of classesFile.classes) {
      const tree = buildClassTree(byToken.get(c.token)!, c);
      tree.gates.forEach((perSpec, si) =>
        perSpec.forEach((g, tier) => {
          if (!g) return;
          if (c.token === "priest" && si === 1 && tier >= 2 && tier <= 6) {
            expect(g.excludedLower).toEqual([105865]);
          } else if (c.token === "hunter" && si === 1 && (tier === 5 || tier === 6)) {
            expect(g.excludedLower).toEqual([105003]);
          } else {
            expect(g.excludedLower).toEqual([]);
          }
        }),
      );
    }
  });
});
