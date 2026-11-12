import { describe, expect, it } from "vitest";
import { runDamage } from "@/testkit/damage";
import { weapon } from "@/testkit/stats";
import { averageResist, formMask, glancingMultiplier, rageConversion } from "./constants";
import { expectedFactor, resistFactor, schoolsOf, whiteTable } from "./outcome";

describe("combat constants", () => {
  it("glancing damage (vmangos low/high average)", () => {
    expect(glancingMultiplier(15)).toBeCloseTo(0.65, 10); // 300 skill vs boss
    expect(glancingMultiplier(10)).toBeCloseTo(0.85, 10);
    expect(glancingMultiplier(7)).toBeCloseTo(0.95, 10); // 308 skill
    expect(glancingMultiplier(0)).toBeCloseTo(0.95, 10);
  });
  it("partial resist, rage conversion, form masks", () => {
    expect(averageResist(24, 60)).toBeCloseTo(0.06, 10);
    expect(averageResist(5000, 60)).toBe(0.75);
    expect(rageConversion(60)).toBeCloseTo(230.6, 1);
    expect(formMask("cat")).toBe(1);
    expect(formMask("shadowform")).toBe(134217728);
    expect(formMask("moonkin")).toBe(1073741824);
    expect(formMask(null)).toBe(0);
    expect(schoolsOf(20)).toEqual(["fire", "frost"]);
  });
});

describe("outcome tables vs boss", () => {
  const r = runDamage({
    classToken: "warrior",
    race: "HUMAN",
    weapons: { mainHand: weapon(12784) },
    rotation: "warrior-protection",
  });
  it("white single roll: 8 miss, 6.5 dodge, 40 glancing at 65%, crit 2.6, rest hits", () => {
    const t = whiteTable(r.view.mainHand!, "mainHand", 300, 63);
    expect(t).toMatchObject({ miss: 8, dodge: 6.5, glancing: 40, glancingMultiplier: 0.65 });
    expect(t.crit).toBeCloseTo(2.6, 10);
    expect(t.hit).toBeCloseTo(42.9, 10);
    expect(t.factor).toBeCloseTo((42.9 + 40 * 0.65 + 2.6 * 2) / 100, 10);
  });
  it("two-roll expected factor and spell resist", () => {
    expect(expectedFactor({ land: 85.5, crit: 10, critBonus: 1 })).toBeCloseTo(0.855 * 1.1, 10);
    expect(expectedFactor({ land: 83, crit: 10, critBonus: 0.5 }, 2)).toBeCloseTo(0.83 * 1.1, 10);
    expect(resistFactor(r.view, 16, 60)).toBeCloseTo(0.94, 10); // frost vs +3 level boss
    expect(resistFactor(r.view, 2, 60)).toBe(1); // holy
    expect(resistFactor(r.view, 1, 60)).toBe(1); // physical
  });
});
