import { useMemo } from "react";
import { useCalc } from "@/state/store";
import { useCharacter } from "@/state/character";
import { useRotation } from "@/state/rotation";
import { derive, type Derived } from "@/state/derived";

/** Derived stats for the current talents and character (pure computation, well under 1 ms). */
export function useDerived(): Derived {
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
    () =>
      derive(
        { tree, ranks, level, spells, pets },
        { raceId, weaponIds, bonus, buffIds, target, custom, weapons, pet },
        rotation,
      ),
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
