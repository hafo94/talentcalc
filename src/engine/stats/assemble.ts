import type { BaseStatsFile, BuffsFile, ClassToken, ManualEffect, RacialsFile } from "@/data/types";
import type { SourceKind } from "./stat";
import { mapTalents, type RankedTalent, type TalentMapping } from "./talentEffects";
import type { BonusStats, CharacterInput, EquippedWeapons, SourcedEffect } from "./types";

export interface AssembleArgs {
  classToken: ClassToken;
  race: string; // uppercase
  level: number;
  baseStats: BaseStatsFile;
  racials: RacialsFile;
  buffs: BuffsFile;
  buffIds: readonly string[]; // selected buffs and debuffs
  talents: readonly RankedTalent[];
  weapons: EquippedWeapons;
  bonus: BonusStats;
  /** Phase 4: caster auras of the rotation's self-buffs (Shadowform, Aspect of the Hawk, Slice and Dice ...). */
  extraEffects?: readonly SourcedEffect[];
  /** Phase 4: ShapeshiftMask bit of the rotation's form (0 = no form). */
  formMask?: number;
}
export interface Assembled {
  input: CharacterInput;
  debuffs: SourcedEffect[];
  mapping: TalentMapping;
}

function strip(e: ManualEffect, label: string, kind: SourceKind): SourcedEffect {
  const out: SourcedEffect = { ...e, label, kind };
  delete (out as ManualEffect).src;
  return out;
}

/** Collects racial, buff, debuff and talent effects into a CharacterInput (pure). */
export function assemble(a: AssembleArgs): Assembled {
  const cls = a.classToken.toUpperCase();
  const effects: SourcedEffect[] = [];
  for (const r of a.racials.racials) {
    if (r.race !== a.race || r.kind !== "passive" || (r.classes && !r.classes.includes(cls as never)))
      continue;
    for (const e of r.effects) effects.push(strip(e, `${r.name} (racial)`, "racial"));
  }
  const debuffs: SourcedEffect[] = [];
  const selected = new Set(a.buffIds);
  for (const b of a.buffs.buffs) {
    if (!selected.has(b.id)) continue;
    for (const e of b.effects) {
      if (b.category === "debuff") debuffs.push(strip(e, b.name, "debuff"));
      else effects.push(strip(e, b.name, "buff"));
    }
  }
  const mapping = mapTalents(a.talents, a.weapons, a.formMask ?? 0);
  effects.push(...mapping.applied, ...mapping.damageDone, ...(a.extraEffects ?? []));
  return {
    input: {
      classToken: a.classToken,
      race: a.race,
      level: a.level,
      baseStats: a.baseStats,
      weapons: a.weapons,
      bonus: a.bonus,
      effects,
    },
    debuffs,
    mapping,
  };
}

export const EMPTY_BONUS: BonusStats = {
  str: 0,
  agi: 0,
  sta: 0,
  int: 0,
  spi: 0,
  attackPower: 0,
  rangedAttackPower: 0,
  spellPower: 0,
  holySpellPower: 0,
  fireSpellPower: 0,
  natureSpellPower: 0,
  frostSpellPower: 0,
  shadowSpellPower: 0,
  arcaneSpellPower: 0,
  hit: 0,
  spellHit: 0,
  crit: 0,
  spellCrit: 0,
  haste: 0,
  weaponSkill: 0,
};
