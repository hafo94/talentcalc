import { describe, expect, it } from "vitest";
import { MAGE_51_STEPS, ctx60, spend, treeFor } from "@/testkit/talents";
import { buildTooltipModel } from "./tooltipModel";

const mage = treeFor("mage");
const ctx = ctx60();

describe("tooltip model", () => {
  it("fresh Ignite", () => {
    const m = buildTooltipModel(mage, {}, 105794, ctx);
    expect(m.name).toBe("Ignite");
    expect(m.rankLine).toBe("Rank 0/5");
    expect(m.requirements).toEqual(["Requires 5 points in Fire Talents"]);
    expect(m.current).toContain("additional 8% of your spell's damage over 4 sec.");
    expect(m.next).toBeNull();
    expect(m.learnHint).toBe(false);
  });

  it("partially ranked Ignite", () => {
    const r = spend(mage, {}, [
      [105796, 5],
      [105794, 2],
    ]);
    const m = buildTooltipModel(mage, r, 105794, ctx);
    expect(m.rankLine).toBe("Rank 2/5");
    expect(m.requirements).toEqual([]);
    expect(m.current).toContain("16%");
    expect(m.next).toContain("24%");
    expect(m.learnHint).toBe(true);
  });

  it("maxed talent has no next rank", () => {
    const r = spend(mage, {}, MAGE_51_STEPS);
    const m = buildTooltipModel(mage, r, 105796, ctx);
    expect(m.rankLine).toBe("Rank 5/5");
    expect(m.next).toBeNull();
    expect(m.learnHint).toBe(false);
  });

  it("Heating Up lists gate and prerequisite", () => {
    const r = spend(mage, {}, [
      [105796, 5],
      [105794, 5],
      [105789, 1],
    ]);
    expect(buildTooltipModel(mage, r, 105786, ctx).requirements).toEqual([
      "Requires 15 points in Fire Talents",
      "Requires 1 point in Pyroblast",
    ]);
  });

  it("explains Q21 gate anomalies", () => {
    const priest = treeFor("priest");
    const r = spend(priest, {}, [[105865, 5]]);
    expect(buildTooltipModel(priest, r, 105864, ctx).gateNote).toBe(
      "Points in Holy Specialization do not count toward this requirement.",
    );
  });
});
