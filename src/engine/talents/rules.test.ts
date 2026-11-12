import { describe, expect, it } from "vitest";
import { classesFile } from "@/data";
import type { ClassToken } from "@/data/types";
import {
  addPoint,
  canAdd,
  canRemove,
  nodeState,
  pointsBySpec,
  pointsSpent,
  rankOf,
  removePoint,
  resetAll,
  resetSpec,
  sanitize,
  unmetRequirements,
  validate,
  type Ranks,
} from "./index";
import { MAGE_51, MAGE_51_STEPS, ctx60, spend, treeFor } from "@/testkit/talents";

const mage = treeFor("mage");
const ctx = ctx60();
const INCINERATION = 105796;
const ACCELERANT = 105795;
const IGNITE = 105794;
const IMPACT = 105792;
const BURNING_SOUL = 105789;
const PYROBLAST = 105790;
const IMPROVED_SCORCH = 105788;
const HEATING_UP = 105786;
const CRITICAL_MASS = 105784;
const FIRE_POWER = 105782;
const COMBUSTION = 105781;
const FROSTBITE = 105774;
const WAND_SPEC = 105815;

const sp = (r: Ranks, steps: [number, number][], c = ctx) => spend(mage, r, steps, c);

describe("mage fire rules", () => {
  it("1. empty build", () => {
    expect(canAdd(mage, {}, INCINERATION, ctx)).toBe(true);
    expect(canAdd(mage, {}, IGNITE, ctx)).toBe(false);
    expect(nodeState(mage, {}, IGNITE, ctx)).toBe("locked");
    const u = unmetRequirements(mage, {}, IGNITE);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ kind: "gate", points: 5, counted: 0 });
  });

  it("2. gate opens with the fifth point, maxed node cannot be added", () => {
    const r4 = sp({}, [[INCINERATION, 4]]);
    expect(canAdd(mage, r4, IGNITE, ctx)).toBe(false);
    const r5 = sp(r4, [[INCINERATION, 1]]);
    expect(canAdd(mage, r5, IGNITE, ctx)).toBe(true);
    expect(nodeState(mage, r5, INCINERATION, ctx)).toBe("maxed");
    expect(canAdd(mage, r5, INCINERATION, ctx)).toBe(false);
  });

  it("3. addPoint on a maxed node returns the same object", () => {
    const r = sp({}, [[INCINERATION, 5]]);
    expect(addPoint(mage, r, INCINERATION, ctx)).toBe(r);
  });

  it("4. Heating Up needs gate 15 and Pyroblast", () => {
    // Plan 9.3 test 4 spends Pyroblast here, which would satisfy the prerequisite (max rank 1), so the
    // 11th point goes into Burning Soul instead.
    const r = sp({}, [
      [INCINERATION, 5],
      [IGNITE, 5],
      [BURNING_SOUL, 1],
    ]);
    expect(pointsSpent(mage, r)).toBe(11);
    expect(canAdd(mage, r, HEATING_UP, ctx)).toBe(false);
    const u = unmetRequirements(mage, r, HEATING_UP);
    expect(u).toHaveLength(2);
    expect(u[0]).toMatchObject({ kind: "gate", points: 15, counted: 11 });
    expect(u[1]).toMatchObject({ kind: "prereq", nodeId: PYROBLAST, points: 1 });
  });

  it("5/6. removal rules", () => {
    let r = sp({}, [
      [INCINERATION, 5],
      [IGNITE, 5],
      [PYROBLAST, 1],
      [ACCELERANT, 4],
    ]);
    expect(canAdd(mage, r, HEATING_UP, ctx)).toBe(true);
    r = sp(r, [[HEATING_UP, 1]]);
    expect(canRemove(mage, r, PYROBLAST)).toBe(false);
    expect(canRemove(mage, r, INCINERATION)).toBe(false);
    expect(canRemove(mage, r, HEATING_UP)).toBe(true);
    r = sp(r, [[BURNING_SOUL, 1]]);
    expect(canRemove(mage, r, INCINERATION)).toBe(true);
  });

  const to30: [number, number][] = [
    [INCINERATION, 5],
    [ACCELERANT, 5],
    [IGNITE, 5],
    [IMPACT, 3],
    [BURNING_SOUL, 3],
    [PYROBLAST, 1],
    [IMPROVED_SCORCH, 3],
    [HEATING_UP, 1],
    [CRITICAL_MASS, 3],
    [FIRE_POWER, 1],
  ];

  it("7/8/9. Combustion path and the Q28 rule", () => {
    let r = sp({}, to30);
    expect(pointsSpent(mage, r)).toBe(30);
    expect(canAdd(mage, r, COMBUSTION, ctx)).toBe(true);
    r = sp(r, [[COMBUSTION, 1]]);
    expect(canRemove(mage, r, INCINERATION)).toBe(false);
    expect(canRemove(mage, r, CRITICAL_MASS)).toBe(false);
    expect(canRemove(mage, r, FIRE_POWER)).toBe(false);
    expect(canRemove(mage, r, COMBUSTION)).toBe(true);
    r = sp(r, [[FIRE_POWER, 2]]);
    expect(pointsSpent(mage, r)).toBe(33);
    expect(canRemove(mage, r, INCINERATION)).toBe(true);
  });

  it("10. Combustion needs Critical Mass maxed", () => {
    const steps = to30.map(([id, n]): [number, number] =>
      id === CRITICAL_MASS ? [id, 2] : id === FIRE_POWER ? [id, 2] : [id, n],
    );
    const r = sp({}, steps);
    expect(pointsSpent(mage, r)).toBe(30);
    expect(canAdd(mage, r, COMBUSTION, ctx)).toBe(false);
    expect(unmetRequirements(mage, r, COMBUSTION)).toEqual([
      { kind: "prereq", nodeId: CRITICAL_MASS, points: 3 },
    ]);
  });

  it("11. full MAGE_51", () => {
    const r = sp({}, MAGE_51_STEPS);
    expect(r).toEqual(MAGE_51);
    expect(pointsSpent(mage, r)).toBe(51);
    expect(pointsBySpec(mage, r)).toEqual([0, 33, 18]);
    for (const id of mage.order) expect(canAdd(mage, r, id, ctx)).toBe(false);
    expect(nodeState(mage, r, WAND_SPEC, ctx)).toBe("locked");
    expect(nodeState(mage, r, FROSTBITE, ctx)).toBe("maxed");
    expect(validate(mage, r, ctx)).toEqual([]);
  });

  it("12. resets", () => {
    expect(pointsBySpec(mage, resetSpec(mage, MAGE_51, 1))).toEqual([0, 0, 18]);
    expect(resetAll()).toEqual({});
  });

  it("13. partial removal deletes the key at zero", () => {
    let r = sp({}, [[INCINERATION, 3]]);
    r = removePoint(mage, r, INCINERATION);
    expect(r[INCINERATION]).toBe(2);
    r = removePoint(mage, removePoint(mage, r, INCINERATION), INCINERATION);
    expect(INCINERATION in r).toBe(false);
  });
});

describe("Q21 anomalies", () => {
  const priest = treeFor("priest");
  const HOLY_SPEC = 105865;
  const SPELL_WARDING = 105864;
  const TWILIGHT_FOCUS = 105867;
  const IMPROVED_RENEW = 105866;

  it("14/15. Priest Holy: Holy Specialization does not count", () => {
    let r = spend(priest, {}, [[HOLY_SPEC, 5]]);
    expect(canAdd(priest, r, SPELL_WARDING, ctx)).toBe(false);
    const u = unmetRequirements(priest, r, SPELL_WARDING);
    expect(u[0]).toMatchObject({ kind: "gate", counted: 0, excludedInvested: [HOLY_SPEC] });
    r = spend(priest, r, [
      [TWILIGHT_FOCUS, 3],
      [IMPROVED_RENEW, 2],
    ]);
    expect(canAdd(priest, r, SPELL_WARDING, ctx)).toBe(true);
    r = spend(priest, r, [[SPELL_WARDING, 1]]);
    expect(canRemove(priest, r, HOLY_SPEC)).toBe(true);
    expect(canRemove(priest, r, IMPROVED_RENEW)).toBe(false);
  });

  it("16/17. Hunter MM: Improved Serpent Sting does not count for tiers 5-6", () => {
    const hunter = treeFor("hunter");
    let r = spend(hunter, {}, [
      [105013, 3],
      [105012, 5],
      [105011, 5],
      [105009, 2],
    ]);
    expect(canAdd(hunter, r, 105003, ctx)).toBe(true);
    r = spend(hunter, r, [[105003, 5]]);
    expect(pointsSpent(hunter, r)).toBe(20);
    expect(canAdd(hunter, r, 105001, ctx)).toBe(false);
    r = spend(hunter, r, [
      [105009, 3],
      [105008, 1],
    ]);
    expect(pointsSpent(hunter, r)).toBe(24);
    expect(canAdd(hunter, r, 105001, ctx)).toBe(false);
    r = spend(hunter, r, [[105008, 1]]);
    expect(pointsSpent(hunter, r)).toBe(25);
    expect(canAdd(hunter, r, 105001, ctx)).toBe(true);
  });
});

describe("Q28 and horizontal prerequisites", () => {
  it("18. Discipline: same-tier points do not count for the tier-3 gate", () => {
    const priest = treeFor("priest");
    let r = spend(priest, {}, [
      [105850, 2],
      [105849, 5],
      [105848, 3],
    ]);
    expect(canAdd(priest, r, 105846, ctx)).toBe(true);
    r = spend(priest, r, [[105846, 3]]);
    expect(canRemove(priest, r, 105848)).toBe(false);
  });

  it("19. Shadow Mind Flay -> Improved Mind Flay", () => {
    const priest = treeFor("priest");
    let r = spend(priest, {}, [
      [105832, 5],
      [105833, 5],
    ]);
    expect(canAdd(priest, r, 105825, ctx)).toBe(false);
    expect(unmetRequirements(priest, r, 105825)).toEqual([{ kind: "prereq", nodeId: 105826, points: 1 }]);
    r = spend(priest, r, [[105826, 1]]);
    expect(canAdd(priest, r, 105825, ctx)).toBe(true);
    r = spend(priest, r, [[105825, 1]]);
    expect(canRemove(priest, r, 105826)).toBe(false);
  });
});

describe("validate and sanitize", () => {
  it("20. level 59 is over budget", () => {
    const c59 = ctx60(0, 59);
    expect(validate(mage, MAGE_51, c59)).toEqual([{ kind: "overBudget", spent: 51, available: 50 }]);
    for (const id of mage.order) expect(canAdd(mage, MAGE_51, id, c59)).toBe(false);
    expect(canRemove(mage, MAGE_51, FROSTBITE)).toBe(true);
  });

  it("21. lone Heating Up violates gate and prereq", () => {
    const v = validate(mage, { [HEATING_UP]: 1 }, ctx);
    expect(v).toContainEqual({ kind: "gate", nodeId: HEATING_UP, required: 15, counted: 0 });
    expect(v).toContainEqual({ kind: "prereq", nodeId: HEATING_UP, prereqNodeId: PYROBLAST });
  });

  it("22. unknown node and rank out of range", () => {
    expect(validate(mage, { 999999: 1 }, ctx)).toEqual([{ kind: "unknownNode", nodeId: 999999 }]);
    expect(validate(mage, { [INCINERATION]: 6 }, ctx)).toEqual([
      { kind: "rankOutOfRange", nodeId: INCINERATION, rank: 6 },
    ]);
  });

  it("23. sanitize", () => {
    expect(sanitize(mage, MAGE_51, ctx)).toEqual({ ranks: MAGE_51, dropped: false });
    const s = sanitize(mage, { ...MAGE_51, [INCINERATION]: 9 }, ctx);
    expect(s.ranks[INCINERATION]).toBe(5);
    expect(s.dropped).toBe(true);
  });

  it("24. sanitize drops invalid builds", () => {
    expect(sanitize(mage, { [HEATING_UP]: 1, 999999: 2 }, ctx)).toEqual({ ranks: {}, dropped: true });
  });

  it("25. sanitize trims an over-budget build, earlier specs win", () => {
    const wanted: Ranks = { ...MAGE_51, 105820: 0 };
    // Arcane (spec 0) tier 1/2 nodes: Wand Specialization, Improved Arcane Missiles-like nodes
    const arcane = mage.specNodeIds[0]!.map((id) => id);
    const extra: Record<number, number> = {};
    let n = 0;
    for (const id of arcane) {
      const t = mage.nodes.get(id)!.talent;
      if (t.tier === 1 && n < 9) {
        const take = Math.min(t.maxRank, 9 - n);
        extra[id] = take;
        n += take;
      }
    }
    expect(n).toBe(9);
    const s = sanitize(mage, { ...wanted, ...extra }, ctx);
    expect(pointsSpent(mage, s.ranks)).toBe(51);
    expect(pointsBySpec(mage, s.ranks)[0]).toBe(9);
    expect(s.dropped).toBe(true);
    expect(validate(mage, s.ranks, ctx)).toEqual([]);
  });
});

describe("property: random play stays valid", () => {
  const tokens = classesFile.classes.map((c) => c.token);
  function lcg(seed: number) {
    let x = seed;
    return (n: number) => {
      x = (x * 1103515245 + 12345) % 2 ** 31;
      return Math.floor((x / 2 ** 31) * n);
    };
  }
  it.each(tokens)("%s", (token: ClassToken) => {
    const tree = treeFor(token);
    const rnd = lcg(42);
    let ranks: Ranks = {};
    for (let i = 0; i < 500; i++) {
      const id = tree.order[rnd(tree.order.length)]!;
      ranks = addPoint(tree, ranks, id, ctx);
      expect(validate(tree, ranks, ctx)).toEqual([]);
    }
    expect(pointsSpent(tree, ranks)).toBeLessThanOrEqual(51);
    expect(sanitize(tree, ranks, ctx).ranks).toEqual(ranks);
    for (let i = 0; i < 300; i++) {
      const id = tree.order[rnd(tree.order.length)]!;
      const before = rankOf(ranks, id);
      ranks = removePoint(tree, ranks, id);
      expect(rankOf(ranks, id)).toBeGreaterThanOrEqual(before - 1);
      expect(validate(tree, ranks, ctx)).toEqual([]);
    }
  });
});
