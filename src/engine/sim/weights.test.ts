// Phase 7: simulation stat weights (paired iterations, common random numbers).
import { describe, expect, it } from "vitest";
import { simInput } from "@/testkit/sim";
import { weapon } from "@/testkit/stats";
import { runDpsSamples, runSim, summarize } from "./run";
import { DEFAULT_SIM_CONFIG } from "./types";
import { simWeights } from "./weights";

const config = { ...DEFAULT_SIM_CONFIG, iterations: 500, logLimit: 0 };

describe("simWeights", () => {
  it("W1 in the simulator: Frostbolt mage, spell power and crit within 3% of the analytical weights", () => {
    const input = simInput({ classToken: "mage", race: "HUMAN", rotation: "mage-frost" });
    const r = simWeights({
      input,
      patches: { base: {}, spellPower: { spellPower: 25 }, spellCrit: { spellCrit: 1 } },
      pairs: [
        { id: "spellPower", from: "base", to: "spellPower", per: 25 },
        { id: "spellCrit", from: "base", to: "spellCrit", per: 1 },
      ],
      config,
    });
    expect(r.runs).toBe(3);
    expect(r.base.mean / 125.570458 - 1).toBeLessThan(0.03);
    const sp = r.pairs.find((p) => p.id === "spellPower")!.delta;
    expect(Math.abs(sp.mean / 0.21518811 - 1)).toBeLessThan(0.03);
    expect((sp.ci95[1] - sp.ci95[0]) / 2).toBeLessThan(0.01);
    const crit = r.pairs.find((p) => p.id === "spellCrit")!.delta;
    expect(Math.abs(crit.mean / 0.61765833 - 1)).toBeLessThan(0.1);
  });
  it("is deterministic; the base equals runSim; paired CIs are narrower than independent ones", () => {
    const input = simInput({
      classToken: "warrior",
      race: "HUMAN",
      talents: { Cruelty: 5, Flurry: 5 },
      weapons: { mainHand: weapon(12784) },
    });
    const req = {
      input,
      patches: { base: {}, attackPower: { attackPower: 50 } },
      pairs: [{ id: "attackPower", from: "base", to: "attackPower", per: 50 }],
      config,
    };
    const a = simWeights(req);
    const b = simWeights(req);
    expect({ ...a, elapsedMs: 0 }).toEqual({ ...b, elapsedMs: 0 });
    expect(a.base.mean).toBeCloseTo(runSim(input, config).dps.mean, 10);
    const ap = a.pairs[0]!.delta;
    expect(ap.mean).toBeGreaterThan(0);
    const other = runDpsSamples(
      { ...input, prepare: { ...input.prepare, bonus: { ...input.prepare.bonus, attackPower: 50 } } },
      config,
    );
    const indep =
      (1.96 * Math.hypot(a.base.stdev, summarize(other).stdev)) / Math.sqrt(config.iterations) / 50;
    expect((ap.ci95[1] - ap.ci95[0]) / 2).toBeLessThan(indep);
  });
});
