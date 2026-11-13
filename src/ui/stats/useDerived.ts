import { useMemo } from "react";
import type { SpecRotation } from "@/data/types";
import { useCalc } from "@/state/store";
import { useCharacter } from "@/state/character";
import { useRotation } from "@/state/rotation";
import { derive, type CalcInput, type CharInput, type Derived } from "@/state/derived";

type Key = readonly unknown[];
let last: { key: Key; value: Derived } | null = null;
/** Phase 7: one derive per state change, shared by every panel (each used to run its own). */
function sharedDerive(key: Key, run: () => Derived): Derived {
  if (last && last.key.length === key.length && last.key.every((v, i) => v === key[i])) return last.value;
  last = { key, value: run() };
  return last.value;
}

/** The store values derive reads (Phase 7: also the insight inputs). */
export function useDeriveInputs(): { calc: CalcInput; ch: CharInput; custom: SpecRotation | null; key: Key } {
  const tree = useCalc((s) => s.tree);
  const spells = useCalc((s) => s.spells);
  const pets = useCalc((s) => s.pets);
  const ranks = useCalc((s) => s.ranks);
  const level = useCalc((s) => s.level);
  const raceId = useCharacter((s) => s.raceId);
  const weaponIds = useCharacter((s) => s.weaponIds);
  const bonus = useCharacter((s) => s.bonus);
  const buffIds = useCharacter((s) => s.buffIds);
  const target = useCharacter((s) => s.target);
  const custom = useCharacter((s) => s.custom);
  const weapons = useCharacter((s) => s.weapons);
  const pet = useCharacter((s) => s.pet);
  const rotation = useRotation((s) => s.custom);
  return useMemo(
    () => ({
      calc: { tree, ranks, level, spells, pets },
      ch: { raceId, weaponIds, bonus, buffIds, target, custom, weapons, pet },
      custom: rotation,
      key: [
        tree,
        ranks,
        level,
        spells,
        pets,
        raceId,
        weaponIds,
        bonus,
        buffIds,
        target,
        custom,
        weapons,
        pet,
        rotation,
      ],
    }),
    [
      tree,
      ranks,
      level,
      spells,
      pets,
      raceId,
      weaponIds,
      bonus,
      buffIds,
      target,
      custom,
      weapons,
      pet,
      rotation,
    ],
  );
}

/** Derived stats for the current talents and character (pure computation, 1-3 ms, shared by all callers). */
export function useDerived(): Derived {
  const { calc, ch, custom, key } = useDeriveInputs();
  return useMemo(() => sharedDerive(key, () => derive(calc, ch, custom)), [key, calc, ch, custom]);
}
