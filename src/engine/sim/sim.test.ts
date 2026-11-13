import { describe, expect, it } from "vitest";
import type { ClassToken, RotationEntry } from "@/data/types";
import { runDamage } from "@/testkit/damage";
import { simInput, type SimScenario } from "@/testkit/sim";
import { ammo, weapon } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import { DEFAULT_SIM_CONFIG, type SimConfig } from "./types";
import { Fight } from "./engine";
import { buildModel } from "./model";
import { createRng, iterationSeed } from "./rng";
import { runSim, summarize } from "./run";

const REAPER = { mainHand: weapon(12784) };
const DUAL = { mainHand: weapon(18832), offHand: weapon(19352) };
const cfg = (patch: Partial<SimConfig> = {}): SimConfig => ({ ...DEFAULT_SIM_CONFIG, ...patch });
/** Every talent of one spec at max rank (like rotation.test.ts). */
function maxed(token: ClassToken, spec: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of treeFor(token).nodes.values())
    if (n.specIndex === spec) out[n.talent.name] = n.talent.maxRank;
  return out;
}
const sim = (s: SimScenario, c: Partial<SimConfig> = {}) => runSim(simInput(s), cfg(c));
const source = (r: ReturnType<typeof runSim>, key: string) => {
  const s = r.sources.find((x) => x.key === key);
  if (!s) throw new Error(`no source ${key}: ${r.sources.map((x) => x.key).join(", ")}`);
  return s;
};

describe("statistics", () => {
  it("summarize: mean, sample stdev, 95% CI, min, max", () => {
    const s = summarize([1, 2, 3, 4]);
    expect(s.mean).toBe(2.5);
    expect(s.stdev).toBeCloseTo(1.2909944487358056, 12);
    expect(s.ci95[0]).toBeCloseTo(2.5 - (1.96 * 1.2909944487358056) / 2, 12);
    expect([s.min, s.max]).toEqual([1, 4]);
    expect(summarize([7]).stdev).toBe(0);
  });
});

describe("determinism", () => {
  const s: SimScenario = {
    classToken: "warrior",
    race: "HUMAN",
    weapons: DUAL,
    talents: maxed("warrior", 1),
    rotation: "warrior-fury",
  };
  it("same seed: identical result and combat log; another seed differs", () => {
    const a = sim(s, { iterations: 50, seed: 7 });
    const b = sim(s, { iterations: 50, seed: 7 });
    expect({ ...a, elapsedMs: 0 }).toEqual({ ...b, elapsedMs: 0 });
    expect(sim(s, { iterations: 50, seed: 8 }).dps.mean).not.toBe(a.dps.mean);
  });
  it("iteration i uses iterationSeed(seed, i): results do not depend on batching", () => {
    const input = simInput(s);
    const config = cfg({ iterations: 10, seed: 3 });
    const model = buildModel(input);
    const dps = Array.from({ length: 10 }, (_, i) => {
      const f = new Fight(model, config, createRng(iterationSeed(3, i)), new Map(), null);
      return f.run().damage / config.fightSec;
    });
    expect(runSim(input, config).dps).toEqual(summarize(dps));
  });
});

/**
 * Builds where the analytical model and the simulation must agree within 3% (section 8.3): no execute phase, no
 * cooldown buffs, unlimited mana, 1000 iterations of 180 s.
 */
const ENTRIES = {
  frost: [{ ability: "Frostbolt", kind: "filler" }],
  priest: [
    { ability: "Shadow Word: Pain", kind: "dot" },
    { ability: "Mind Blast", kind: "cooldown" },
    { ability: "Smite", kind: "filler" },
  ],
  ret: [
    { ability: "Holy Strike", kind: "cooldown" },
    { ability: "Judgement", kind: "cooldown" },
  ],
  destruction: [
    { ability: "Immolate", kind: "dot" },
    { ability: "Conflagrate", kind: "cooldown", requires: "Immolate" },
    { ability: "Incinerate", kind: "filler" },
  ],
  balance: [
    { ability: "Moonfire", kind: "dot" },
    { ability: "Insect Swarm", kind: "dot" },
    { ability: "Starfire", kind: "filler" },
  ],
  feral: [
    { ability: "Rip", kind: "finisher", cp: 5 },
    { ability: "Shred", kind: "builder" },
    { ability: "Ferocious Bite", kind: "finisher", cp: 5 },
  ],
  subtlety: [
    { ability: "Slice and Dice", kind: "finisher", cp: 5, buff: true },
    { ability: "Hemorrhage", kind: "builder" },
    { ability: "Eviscerate", kind: "finisher", cp: 5 },
  ],
} satisfies Record<string, RotationEntry[]>;
const CROSS_CHECK: [string, SimScenario][] = [
  [
    "C1 Frostbolt, +500 spell power (G14)",
    {
      classToken: "mage",
      race: "HUMAN",
      bonus: { spellPower: 500 },
      rotation: "mage-frost",
      entries: ENTRIES.frost,
    },
  ],
  [
    "C2 priest SW:P, Mind Blast, Smite, +300",
    {
      classToken: "priest",
      race: "HUMAN",
      bonus: { spellPower: 300 },
      rotation: "priest-discipline",
      entries: ENTRIES.priest,
    },
  ],
  [
    "C3 warrior Heroic Strike on next swing, Arcanite Reaper (G13)",
    { classToken: "warrior", race: "HUMAN", weapons: REAPER, rotation: "warrior-protection" },
  ],
  [
    "C4 Retribution: Seal of Command procs, Holy Strike, Judgement",
    {
      classToken: "paladin",
      race: "HUMAN",
      weapons: REAPER,
      talents: maxed("paladin", 2),
      rotation: "paladin-retribution",
      entries: ENTRIES.ret,
    },
  ],
  [
    "C5 Destruction 5/5 talents, +300",
    {
      classToken: "warlock",
      race: "HUMAN",
      bonus: { spellPower: 300 },
      talents: maxed("warlock", 2),
      rotation: "warlock-destruction",
      entries: ENTRIES.destruction,
    },
  ],
  [
    "C6 Balance, +300",
    {
      classToken: "druid",
      race: "TAUREN",
      bonus: { spellPower: 300 },
      talents: maxed("druid", 0),
      rotation: "druid-balance",
      entries: ENTRIES.balance,
    },
  ],
  [
    "C7 Feral cat: energy and combo points",
    {
      classToken: "druid",
      race: "TAUREN",
      talents: maxed("druid", 1),
      rotation: "druid-feral",
      entries: ENTRIES.feral,
    },
  ],
  [
    "C8 Subtlety: Slice and Dice, Hemorrhage, Eviscerate",
    {
      classToken: "rogue",
      race: "HUMAN",
      weapons: DUAL,
      talents: maxed("rogue", 2),
      rotation: "rogue-subtlety",
      entries: ENTRIES.subtlety,
    },
  ],
];

describe("cross-check: analytical vs simulation within 3%", () => {
  for (const [name, s] of CROSS_CHECK)
    it(name, () => {
      const r = sim(s, { iterations: 1000, unlimitedMana: true });
      const analytical = runDamage(s).result.rotation.dps;
      expect(Math.abs(r.dps.mean / analytical - 1)).toBeLessThan(0.03);
    });
});

const FURY: SimScenario = {
  classToken: "warrior",
  race: "HUMAN",
  weapons: DUAL,
  talents: maxed("warrior", 1),
  rotation: "warrior-fury",
};
describe("mechanics (section 4.4)", () => {
  it("execute phase: Execute and Recklessness only below 20% target health; Death Wish on cooldown", () => {
    const r = sim(FURY, { iterations: 1, logLimit: 100000 });
    const casts = (name: string) =>
      r.log.filter((l) => l.source === name && l.outcome === "cast").map((l) => l.t);
    expect(casts("Execute").length).toBeGreaterThan(0);
    expect(Math.min(...casts("Execute"))).toBeGreaterThanOrEqual(0.8 * 180);
    expect(casts("Recklessness")).toHaveLength(1);
    expect(casts("Recklessness")[0]).toBeGreaterThanOrEqual(0.8 * 180);
    const long = sim(FURY, { iterations: 1, fightSec: 400, logLimit: 100000 });
    expect(long.log.filter((l) => l.source === "Death Wish" && l.outcome === "cast")).toHaveLength(3);
  });
  it("Flurry hastes white swings beyond the weapon speed", () => {
    const r = sim(FURY, { iterations: 200 });
    const model = buildModel(simInput(FURY));
    const speed = model.state([]).white.mainHand!.speed;
    const swings = source(r, "Main-hand melee").casts;
    expect(swings).toBeGreaterThan((180 / speed) * 1.05);
  });
  it("rage stays within 0..100; energy within 0..100", () => {
    for (const s of [FURY, CROSS_CHECK[7]![1]]) {
      const r = sim(s, { iterations: 1 });
      for (const [, v] of r.timeline!.points) expect(v >= 0 && v <= 100).toBe(true);
    }
  });
  it("Seal of Command: 7 procs per minute of landed main-hand swings", () => {
    const s = CROSS_CHECK[3]![1];
    const r = sim(s, { iterations: 500 });
    const mh = source(r, "Main-hand melee");
    const procs = source(r, "Seal of Command (proc)").casts;
    const expected = (mh.hits * 7 * 3.8) / 60; // Arcanite Reaper 3.8 s
    expect(procs / expected).toBeCloseTo(1, 1);
  });
  it("Windfury Weapon: 20% of landed main-hand swings grant 2 attacks", () => {
    const r = sim(
      { classToken: "shaman", race: "ORC", weapons: REAPER, rotation: "shaman-enhancement" },
      { iterations: 500 },
    );
    const wf = source(r, "Windfury Weapon").casts;
    const mh = source(r, "Main-hand melee").hits;
    expect(wf / (mh * 0.2 * 2)).toBeCloseTo(1, 1);
  });
  it("rolling Ignite matches the Phase 4 expected burn per cast", () => {
    const s: SimScenario = {
      classToken: "mage",
      race: "HUMAN",
      bonus: { spellPower: 500, spellCrit: 20 },
      talents: { Ignite: 5 },
      rotation: "mage-fire",
      entries: [{ ability: "Fireball", kind: "filler" }],
    };
    const r = sim(s, { iterations: 500 });
    const a = runDamage(s).ability("Fireball");
    const expected = a.extras.find((x) => x.label === "Ignite 5/5")!.value * source(r, "Fireball").casts;
    const ignite = source(r, "Ignite").damage;
    expect(ignite / expected).toBeGreaterThan(0.9); // burns still ticking at the end of the fight are lost
    expect(ignite / expected).toBeLessThan(1.01);
  });
  it("Clearcasting procs and is used; Nightfall gives Shadow Trance", () => {
    const arcane = sim(
      { classToken: "mage", race: "HUMAN", talents: maxed("mage", 0), rotation: "mage-arcane" },
      { iterations: 1, logLimit: 100000 },
    );
    expect(arcane.log.some((l) => l.source === "Clearcasting" && l.outcome === "buff")).toBe(true);
    expect(arcane.log.some((l) => l.source === "Clearcasting" && l.outcome === "fade")).toBe(true);
    const aff = sim(
      { classToken: "warlock", race: "HUMAN", talents: maxed("warlock", 0), rotation: "warlock-affliction" },
      { iterations: 1, logLimit: 100000 },
    );
    expect(aff.log.some((l) => l.source === "Shadow Trance" && l.outcome === "buff")).toBe(true);
  });
  it("mana: out of mana without regeneration gear; Evocation refills; unlimited mana never waits", () => {
    const s: SimScenario = {
      classToken: "mage",
      race: "HUMAN",
      bonus: { spellPower: 300 },
      rotation: "mage-frost",
    };
    const r = sim(s, { iterations: 20, unlimitedMana: false, logLimit: 100000 });
    expect(r.oomSec).toBeGreaterThan(10);
    expect(r.log.some((l) => l.source === "Evocation" && l.outcome === "cast")).toBe(true);
    for (const [, v] of r.timeline!.points) expect(v).toBeGreaterThanOrEqual(0);
    expect(sim(s, { iterations: 20 }).oomSec).toBe(0);
    const m = buildModel(simInput(s));
    expect(m.spiritRegenPerSec).toBeCloseTo((12.5 + m.prepared.stats.primary.spi.value / 4) / 2, 10);
  });
  it("channels are clipped for a higher-priority cast (Mind Flay for Mind Blast)", () => {
    const r = sim(
      {
        classToken: "priest",
        race: "HUMAN",
        bonus: { spellPower: 300 },
        talents: maxed("priest", 2),
        rotation: "priest-shadow",
      },
      { iterations: 200 },
    );
    const mf = source(r, "Mind Flay");
    expect(mf.ticks / mf.casts).toBeLessThan(3);
    expect(mf.ticks / mf.casts).toBeGreaterThan(2);
  });
  it("a ranged cast restarts the Auto Shot timer", () => {
    const s: SimScenario = {
      classToken: "hunter",
      race: "DWARF",
      weapons: { ranged: weapon(18713), ammo: ammo(18042) },
      rotation: "hunter-marksmanship",
      entries: [{ ability: "Aimed Shot", kind: "cooldown" }],
    };
    const r = sim(s, { iterations: 50 });
    const shots = source(r, "Auto Shot").casts;
    const aimed = source(r, "Aimed Shot").casts;
    expect(shots).toBeLessThan(180 / 2.9 - aimed * 0.5);
  });
});
