// Phase 7 compare: the "#B~A" link format, loading a pinned build, talent differences.
import { describe, expect, it } from "vitest";
import { isClassToken } from "@/data";
import { decodeBuild } from "./buildCode";
import { joinHash, loadBuild, splitHash, talentDiff } from "./compare";
import { derive } from "./derived";
import { useCalc } from "./store";
import { useCharacter } from "./character";
import { useRotation } from "./rotation";

const MAGE = "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N"; // Fire 33 / Frost 18 (Phase 2 golden)
const WARRIOR_V2 = "#v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8"; // Phase 3 golden

describe("compare link format", () => {
  it("joins and splits '#B~A'; links without '~' are unchanged", () => {
    const h = joinHash(MAGE, WARRIOR_V2);
    expect(h).toBe(
      "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N~v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8",
    );
    expect(splitHash(h)).toEqual({ build: MAGE, pinned: WARRIOR_V2 });
    expect(splitHash(MAGE)).toEqual({ build: MAGE, pinned: null });
    expect(splitHash("")).toEqual({ build: "", pinned: null });
    expect(joinHash(MAGE, null)).toBe(MAGE);
    expect(joinHash("", MAGE)).toBe("");
    for (const part of [splitHash(h).build, splitHash(h).pinned!])
      expect(decodeBuild(part, isClassToken).ok).toBe(true);
    expect(decodeBuild(h, isClassToken).ok).toBe(false); // the whole hash is not one build
  });
});

describe("loadBuild", () => {
  it("rebuilds a link's inputs exactly like applying the link to the stores", async () => {
    for (const hash of [MAGE, WARRIOR_V2, "#v2.hunter.60.0..CAMCAAA", "#v1.mage.30.0"]) {
      const a = await loadBuild(hash);
      if (!a) throw new Error(hash);
      const r = decodeBuild(hash, isClassToken);
      if (!r.ok) throw new Error(hash);
      await useCalc.getState().applyBuildCode(r.build);
      const s = useCalc.getState();
      const c = useCharacter.getState();
      const viaStores = derive(
        { tree: s.tree, ranks: s.ranks, level: s.level, spells: s.spells, pets: s.pets },
        c,
        useRotation.getState().custom,
      );
      const viaLoad = derive(a.inputs.calc, a.inputs.ch, a.inputs.rotation);
      if (!viaStores.ok || !viaLoad.ok) throw new Error(hash);
      expect(viaLoad.damage!.totalDps, hash).toBeCloseTo(viaStores.damage!.totalDps, 10);
      expect(a.inputs.calc.ranks).toEqual(s.ranks);
    }
    expect(await loadBuild("#v9.mage.60.0")).toBeNull();
  });
  it("talent differences in tree order; null for different classes", async () => {
    const a = (await loadBuild(MAGE))!;
    const b = (await loadBuild("#v1.mage.60.0"))!;
    const diff = talentDiff(a.tree, a.inputs.calc.ranks, b.tree, b.inputs.calc.ranks)!;
    expect(diff.reduce((n, c) => n + c.a - c.b, 0)).toBe(51);
    expect(diff.every((c) => c.b === 0)).toBe(true);
    expect(diff.map((c) => c.specIndex)).toEqual([...diff.map((c) => c.specIndex)].sort());
    const w = (await loadBuild(WARRIOR_V2))!;
    expect(talentDiff(a.tree, a.inputs.calc.ranks, w.tree, w.inputs.calc.ranks)).toBeNull();
  });
});
