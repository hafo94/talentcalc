import { describe, expect, it } from "vitest";
import { buffsFile } from "@/data";
import { treeFor } from "@/testkit/talents";
import { weaponsFile } from "@/testkit/stats";
import { spellFile } from "@/testkit/damage";
import { petFile } from "@/testkit/pets";
import { EMPTY_BONUS } from "@/engine/stats";
import { DEFAULT_CUSTOM, NO_WEAPON_IDS } from "./character";
import { derive } from "./derived";
import type { ClassToken } from "@/data/types";

/** Every talent of one spec at max rank (the engine does not enforce point rules): the heaviest realistic load. */
function maxSpec(token: ClassToken, spec: number): Record<number, number> {
  const tree = treeFor(token);
  const ranks: Record<number, number> = {};
  for (const n of tree.nodes.values()) if (n.specIndex === spec) ranks[n.talent.nodeId] = n.talent.maxRank;
  return ranks;
}

describe("performance budget (section 10.4)", () => {
  it("derive with damage vs 5 targets stays under 5 ms per talent click", () => {
    const cases: [ClassToken, number, number, Partial<typeof NO_WEAPON_IDS>, number][] = [
      ["warrior", 1, 1, { mainHand: 18832, offHand: 19352 }, 0],
      ["rogue", 1, 1, { mainHand: 18832, offHand: 19352 }, 0],
      ["mage", 1, 1, {}, 0],
      ["hunter", 1, 3, { ranged: 18713, ammo: 18042 }, 0],
      ["hunter", 0, 3, { ranged: 18713, ammo: 18042 }, 2], // Phase 6: BM with a Cat
      ["warlock", 1, 1, {}, 17], // Phase 6: Demonology with a Succubus
    ];
    for (const [token, spec, raceId, weapons, family] of cases) {
      const calc = {
        tree: treeFor(token),
        ranks: maxSpec(token, spec),
        level: 60,
        spells: spellFile(token),
        pets: petFile(token),
      };
      const ch = {
        raceId,
        weaponIds: { ...NO_WEAPON_IDS, ...weapons },
        bonus: EMPTY_BONUS,
        buffIds: [...buffsFile.presets.raidBuffs, ...buffsFile.presets.raidDebuffs],
        target: "custom" as const, // 5 targets
        custom: DEFAULT_CUSTOM,
        weapons: weaponsFile,
        pet: { family, sacrifice: 0, scaling: true },
      };
      for (let i = 0; i < 20; i++) derive(calc, ch); // warm-up (JIT)
      const n = 100;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) derive(calc, ch);
      const ms = (performance.now() - t0) / n;
      console.log(`${token}: ${ms.toFixed(3)} ms per derive`);
      expect(ms).toBeLessThan(5);
    }
  });
});
