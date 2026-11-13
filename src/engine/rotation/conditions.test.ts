import { describe, expect, it } from "vitest";
import type { RotationEntry, SpecRotation } from "@/data/types";
import { abilityCatalog } from "./catalog";
import {
  conditionHolds,
  conditionsHold,
  describeCondition,
  enabledRotation,
  simOnlyReason,
  type ConditionState,
} from "./conditions";
import { rotations, spellFile } from "@/testkit/damage";
import { treeFor } from "@/testkit/talents";

const state = (patch: Partial<ConditionState> = {}): ConditionState => ({
  power: "rage",
  resource: 40,
  maxMana: 0,
  comboPoints: 3,
  targetHpPct: 50,
  timeLeft: 90,
  auraLeft: (i) => (i === 0 ? 1.5 : 0),
  auraActive: (n) => n === "Flurry",
  cooldownReady: (a) => a === "Bloodthirst",
  ...patch,
});

describe("rotation conditions", () => {
  it("each condition type, both comparisons", () => {
    const s = state();
    expect(conditionHolds({ type: "resource", cmp: "gte", value: 40 }, s, 0)).toBe(true);
    expect(conditionHolds({ type: "resource", cmp: "lt", value: 40 }, s, 0)).toBe(false);
    expect(conditionHolds({ type: "comboPoints", cmp: "gte", value: 4 }, s, 0)).toBe(false);
    expect(conditionHolds({ type: "targetHp", cmp: "lt", value: 20 }, s, 0)).toBe(false);
    expect(conditionHolds({ type: "timeLeft", cmp: "lt", value: 100 }, s, 0)).toBe(true);
    expect(conditionHolds({ type: "auraLeft", cmp: "lt", value: 2 }, s, 0)).toBe(true);
    expect(conditionHolds({ type: "auraLeft", cmp: "gte", value: 0.1 }, s, 1)).toBe(false);
    expect(conditionHolds({ type: "aura", ref: "Flurry", active: true }, s, 0)).toBe(true);
    expect(conditionHolds({ type: "aura", ref: "Clearcasting", active: false }, s, 0)).toBe(true);
    expect(conditionHolds({ type: "cooldown", ref: "Bloodthirst", ready: true }, s, 0)).toBe(true);
    expect(conditionHolds({ type: "cooldown", ref: "Whirlwind", ready: false }, s, 0)).toBe(true);
  });
  it("mana resource conditions are in % of maximum mana", () => {
    const s = state({ power: "mana", resource: 1000, maxMana: 5000 });
    expect(conditionHolds({ type: "resource", cmp: "lt", value: 20.1 }, s, 0)).toBe(true);
    expect(conditionHolds({ type: "resource", cmp: "lt", value: 20 }, s, 0)).toBe(false);
  });
  it("all conditions must hold; execute-only abilities need target health < 20%", () => {
    const e: RotationEntry = {
      ability: "Whirlwind",
      kind: "cooldown",
      conditions: [
        { type: "resource", cmp: "gte", value: 25 },
        { type: "aura", ref: "Flurry", active: true },
      ],
    };
    expect(conditionsHold(e, state(), 2)).toBe(true);
    expect(conditionsHold(e, state({ resource: 10 }), 2)).toBe(false);
    const ex: RotationEntry = { ability: "Execute", kind: "cooldown" };
    expect(conditionsHold(ex, state(), 0)).toBe(false);
    expect(conditionsHold(ex, state({ targetHpPct: 19.9 }), 0)).toBe(true);
  });
  it("simulation-only entries for the analytical model", () => {
    expect(simOnlyReason({ ability: "Death Wish", kind: "burst" })).toBe("cooldown buff: simulation only");
    expect(simOnlyReason({ ability: "Execute", kind: "cooldown" })).toBe("execute phase: simulation only");
    expect(
      simOnlyReason({
        ability: "Fireball",
        kind: "filler",
        conditions: [{ type: "targetHp", cmp: "lt", value: 20 }],
      }),
    ).toBe('condition "Target health < 20%": simulation only');
    expect(
      simOnlyReason({
        ability: "Heroic Strike",
        kind: "nextSwing",
        conditions: [{ type: "resource", cmp: "gte", value: 50 }],
      }),
    ).toBeNull();
  });
  it("describeCondition and enabledRotation", () => {
    expect(describeCondition({ type: "resource", cmp: "gte", value: 50 }, "rage")).toBe("Rage ≥ 50");
    expect(describeCondition({ type: "resource", cmp: "lt", value: 20 }, "mana")).toBe("Mana < 20%");
    expect(describeCondition({ type: "cooldown", ref: "Mind Blast", ready: false }, null)).toBe(
      "Mind Blast on cooldown",
    );
    const r = rotations.rotations.find((x) => x.id === "warrior-fury")!;
    const off: SpecRotation = { ...r, entries: r.entries.map((e, i) => (i === 0 ? { ...e, off: true } : e)) };
    expect(enabledRotation(off).entries.map((e) => e.ability)).toEqual(
      r.entries.slice(1).map((e) => e.ability),
    );
    expect(enabledRotation(r)).toBe(r);
  });
});

describe("ability catalog", () => {
  const cat = (t: "warrior" | "mage" | "rogue") =>
    abilityCatalog(
      spellFile(t),
      [...treeFor(t).nodes.values()].map((n) => n.talent),
      rotations,
      t,
    );
  it("unique stable ids; default entries come from the default rotations", () => {
    for (const t of ["warrior", "mage", "rogue"] as const) {
      const c = cat(t);
      expect(new Set(c.map((a) => a.id)).size).toBe(c.length);
    }
    const w = cat("warrior");
    expect(w.find((a) => a.name === "Heroic Strike")!.entry).toEqual({
      ability: "Heroic Strike",
      kind: "nextSwing",
      conditions: [{ type: "resource", cmp: "gte", value: 50 }],
    });
    expect(w.find((a) => a.name === "Death Wish")).toMatchObject({ id: 12328, talent: "Death Wish" });
    expect(w.find((a) => a.name === "Rend")!.entry).toEqual({ ability: "Rend", kind: "dot" });
    expect(w.find((a) => a.name === "Execute")!.id).toBe(5308);
    expect(cat("rogue").find((a) => a.name === "Slice and Dice")!.entry).toMatchObject({ buff: true, cp: 5 });
    expect(cat("mage").find((a) => a.name === "Scorch")!.entry).toMatchObject({
      requiresTalent: "Improved Scorch",
    });
  });
});
