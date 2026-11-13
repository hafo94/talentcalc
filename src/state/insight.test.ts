// Phase 7: talent impact (next/last point), tree contribution, insight cache.
import { describe, expect, it } from "vitest";
import { rotationsFile } from "@/data";
import { EMPTY_BONUS } from "@/engine/stats";
import { spellFile } from "@/testkit/damage";
import { petFile } from "@/testkit/pets";
import { weaponsFile } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import { DEFAULT_CUSTOM, NO_WEAPON_IDS } from "./character";
import { derive } from "./derived";
import { InsightCache, snapshot, talentImpact, treeContribution, type InsightInputs } from "./insight";

const tree = treeFor("warrior");
const id = (name: string) => [...tree.nodes.values()].find((n) => n.talent.name === name)!.talent.nodeId;
const ch = {
  raceId: 1,
  weaponIds: { ...NO_WEAPON_IDS, mainHand: 12784 }, // Arcanite Reaper
  bonus: EMPTY_BONUS,
  buffIds: [] as string[],
  target: "boss" as const,
  custom: DEFAULT_CUSTOM,
  weapons: weaponsFile,
  pet: { family: 0, sacrifice: 0, scaling: true },
};
function inputs(ranks: Record<number, number>): InsightInputs {
  const calc = { tree, ranks, level: 60, spells: spellFile("warrior"), pets: petFile("warrior") };
  return { calc, ch, rotation: null };
}

describe("talent impact", () => {
  it("the baseline equals the panels' DPS (same rotation rule, no reference rows)", () => {
    const inp = inputs({ [id("Cruelty")]: 2 });
    const d = derive(inp.calc, ch);
    expect(snapshot(inp)!.dps).toBeCloseTo(d.ok ? d.damage!.totalDps : NaN, 10);
  });
  it("Cruelty: next point +1% crit and more DPS; last point the opposite; none past the ends", () => {
    const zero = inputs({});
    const at0 = talentImpact(zero, snapshot(zero)!, id("Cruelty"));
    expect(at0.prev).toBeNull();
    expect(at0.next!.dps).toBeGreaterThan(0);
    expect(at0.next!.stats).toEqual([
      { id: "crit", label: "crit vs target", format: "pct", delta: expect.closeTo(1, 10) },
    ]);
    const two = inputs({ [id("Cruelty")]: 2 });
    const at2 = talentImpact(two, snapshot(two)!, id("Cruelty"));
    expect(at2.prev!.dps).toBeLessThan(0);
    expect(at2.next!.pct).toBeCloseTo((at2.next!.dps / snapshot(two)!.dps) * 100, 10);
    const five = inputs({ [id("Cruelty")]: 5 });
    expect(talentImpact(five, snapshot(five)!, id("Cruelty")).next).toBeNull();
  });
  it("ignores the point rules: a locked talent shows its first point (the leading spec picks the rotation)", () => {
    const inp = inputs({});
    const x = talentImpact(inp, snapshot(inp)!, id("Mortal Strike")); // tier 7, needs 30 points
    expect(x.next!.dps).toBeGreaterThan(0); // Arms leads with 1 point: Mortal Strike enters the Arms rotation
    const bt = talentImpact(inp, snapshot(inp)!, id("Bloodthirst")).next!; // Fury leads: the Fury rotation
    expect(bt.dps).toBeCloseTo(snapshot(inp, { [id("Bloodthirst")]: 1 })!.dps - snapshot(inp)!.dps, 10);
    expect(bt.rotation).toBe(rotationsFile.rotations.find((r) => r.id === "warrior-fury")!.label);
    expect(x.next!.rotation).toBeNull();
    const arms = { ...inp, rotation: rotationsFile.rotations.find((r) => r.id === "warrior-arms")! };
    expect(talentImpact(arms, snapshot(arms)!, id("Bloodthirst")).next!.dps).toBeCloseTo(0, 10); // not in Arms
  });
  it("tree contribution = DPS minus the DPS without that tree's points", () => {
    const ranks = { [id("Cruelty")]: 5, [id("Deflection")]: 5 };
    const inp = inputs(ranks);
    const base = snapshot(inp)!;
    const c = treeContribution(inp, base);
    expect(c).toHaveLength(3);
    const fury = c[tree.nodes.get(id("Cruelty"))!.specIndex]!;
    expect(fury).toBeCloseTo(base.dps - snapshot(inp, { [id("Deflection")]: 5 })!.dps, 10);
    expect(fury).toBeGreaterThan(0);
    expect(c[tree.nodes.get(id("Deflection"))!.specIndex]).toBeCloseTo(0, 10); // Deflection is defensive
    expect(c.filter((x) => x === 0)).toHaveLength(2);
  });
  it("the cache evaluates each talent once per input set", () => {
    const cache = new InsightCache();
    const inp = inputs({});
    const a = cache.impact(inp, id("Cruelty"));
    expect(cache.impact({ ...inp, calc: { ...inp.calc } }, id("Cruelty"))).toBe(a); // same store values
    expect(cache.has(inp, id("Cruelty"))).toBe(true);
    const other = { ...inp, calc: { ...inp.calc, ranks: { [id("Cruelty")]: 1 } } };
    expect(cache.impact(other, id("Cruelty"))).not.toBe(a);
    expect(cache.has(inp, id("Impale"))).toBe(false);
  });
});
