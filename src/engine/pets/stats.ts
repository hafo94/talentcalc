import type { BaseStatsFile, ManualClassToken, Spell, Weapon } from "@/data/types";
import { collectMods, effectValue, familyMatches, type ModSource } from "@/engine/abilities";
import {
  EMPTY_BONUS,
  computeCharacter,
  mapAura,
  type CharacterStats,
  type EquippedWeapons,
  type SourcedEffect,
} from "@/engine/stats";
import {
  AURA_POWER_REGEN_PCT,
  AURA_PROC_TRIGGER,
  OP_PROC_CHANCE,
  PET_AURA_EFFECTS,
  PET_RACE,
  PET_WEAPON_SUBCLASS,
  POWER_FOCUS,
  TARGET_CASTER,
  TARGET_PET,
} from "./constants";
import type { PetSetup } from "./types";

const FAMILY_PASSIVE = "Tamed Pet Passive (DND)";
const r1 = (n: number) => Math.round(n * 10) / 10;
const onPet = (e: { targets?: [number, number] }) =>
  !e.targets || e.targets[0] === TARGET_CASTER || e.targets[0] === TARGET_PET;

/** Stat effects of the pet's passives and active pet buffs, plus the focus regeneration bonus and the Frenzy proc. */
export interface PetAuras {
  effects: SourcedEffect[];
  focusRegenPct: number; // aura 110 focus (Bestial Discipline)
  frenzy: { chance: number; spell: Spell; label: string } | null; // aura 42 proc on crits (talent Frenzy)
}

/**
 * The pet's passives (family damage modifier, talent-modified passives) and `buffs` (Frenzy, Bestial Wrath) after the
 * owner's spell modifiers: Unleashed Fury/Ferocity add to effect 0 of a passive (op 3), Unholy Power/Bestial
 * Discipline to all values (op 8), Frenzy to the proc chance (op 18). Effects go through the talent mapper (mapAura).
 */
export function petAuras(
  setup: PetSetup,
  buffs: readonly Spell[],
  mods: readonly ModSource[],
  classSet: number,
  level: number,
): PetAuras {
  const byId = new Map(setup.spells.map((s) => [s.id, s]));
  const passives = setup.info.passives.map((id) => byId.get(id)).filter((s): s is Spell => s !== undefined);
  const out: PetAuras = { effects: [], focusRegenPct: 0, frenzy: null };
  for (const spell of [...passives, ...buffs]) {
    const m = collectMods(spell, mods, classSet);
    const talents = [...new Set(m.lines.map((l) => l.label))].join(", ");
    const buff = buffs.includes(spell);
    const label =
      talents ||
      (buff ? spell.name : spell.name === FAMILY_PASSIVE ? `${setup.info.name} (family)` : spell.name);
    const kind = talents ? "talent" : buff ? "buff" : "base";
    for (const e of spell.effects) {
      if (!PET_AURA_EFFECTS.has(e.effect) || !onPet(e)) continue;
      const v = effectValue(spell, e, level, m);
      if (e.aura === AURA_POWER_REGEN_PCT && e.misc[0] === POWER_FOCUS) {
        out.focusRegenPct += v;
        continue;
      }
      if (e.aura === AURA_PROC_TRIGGER && e.triggerSpell) {
        const proc = byId.get(e.triggerSpell);
        const chanceMods = mods.filter(
          (x) => x.op === OP_PROC_CHANCE && !x.pct && familyMatches(x.mask, spell, classSet),
        );
        const chance = (spell.proc?.chance ?? 0) + chanceMods.reduce((a, x) => a + x.value, 0);
        if (proc && chance > 0)
          out.frenzy = { chance, spell: proc, label: chanceMods.map((x) => x.label).join(", ") || proc.name };
        continue;
      }
      const mapped = mapAura(e, v);
      if (mapped.kind !== "stat" && mapped.kind !== "damageDone") continue;
      for (const x of mapped.effects) if (x.value !== 0) out.effects.push({ ...x, label, kind });
    }
  }
  return out;
}

/** Owner scaling (Q5, data/manual/pets.json): attack power and spell power from the owner, and the owner's hit. */
function ownerScaling(setup: PetSetup, owner: CharacterStats): SourcedEffect[] {
  if (!setup.scaling) return [];
  const s = setup.config.scaling;
  const ranged = s.from === "rangedAttackPower";
  const src = ranged
    ? (owner.rangedAttackPower?.value ?? 0)
    : Math.max(owner.spellPower.fire.value, owner.spellPower.shadow.value);
  const what = ranged ? "ranged attack power" : "fire/shadow spell power";
  const out: SourcedEffect[] = [
    {
      key: "meleeAttackPower",
      value: (src * s.attackPowerPct) / 100,
      label: `Owner scaling: ${s.attackPowerPct}% of ${r1(src)} ${what}`,
      kind: "rule",
    },
    {
      key: "spellPower",
      value: (src * s.spellPowerPct) / 100,
      label: `Owner scaling: ${s.spellPowerPct}% of ${r1(src)} ${what}`,
      kind: "rule",
    },
  ];
  if (s.inheritHit) {
    const hit = ranged ? (owner.hit.ranged?.value ?? owner.hit.mainHand.value) : owner.hit.spell.value;
    out.push({ key: "hit", value: hit, label: "Owner scaling: owner's hit chance", kind: "rule" });
  }
  return out.filter((e) => e.value !== 0);
}

/**
 * The pet's character sheet (section 4.3): the Phase 3 stat engine (computeCharacter) with the pet's own base-stat
 * table (class key = the owner, race PET), a synthetic weapon for its melee attack, owner scaling, the shared owner
 * talents and the passive auras. Returns the stats and the weapons the damage engine uses.
 */
export function computePetStats(
  setup: PetSetup,
  a: { level: number; owner: CharacterStats; auras: PetAuras },
): { stats: CharacterStats; weapons: EquippedWeapons } {
  const b = setup.config.base;
  const cls = setup.info.owner.toUpperCase() as ManualClassToken;
  const baseStats = {
    _source: "data/manual/pets.json",
    _status: "[VERIFY]",
    level: a.level,
    baseCritUnit: "percent",
    classes: {
      [cls]: {
        str: b.str,
        agi: b.agi,
        sta: b.sta,
        int: b.int,
        spi: b.spi,
        health: 0,
        mana: 0,
        baseMeleeCrit: b.meleeCrit,
        baseSpellCrit: b.spellCrit,
      },
    },
    raceOffsets: { [PET_RACE]: { str: 0, agi: 0, sta: 0, int: 0, spi: 0 } },
    conversions: {
      meleeAttackPower: { [cls]: { perLevel: 0, perStr: b.apPerStr, perAgi: 0, flat: b.apFlat } },
      rangedAttackPower: {},
      agiPerMeleeCrit: { [cls]: Infinity }, // the pet's crit is its base value (pets.json), not from Agility
      intPerSpellCrit: {},
      healthPerSta: 10,
      manaPerInt: 15,
      statsWithoutBonus: 20,
    },
  } as unknown as BaseStatsFile;
  const melee = !setup.config.noMelee.includes(setup.info.id);
  const weapon: Weapon | null = melee
    ? {
        id: 0,
        name: `${setup.info.name} attack`,
        quality: 1,
        itemLevel: 0,
        requiredLevel: 0,
        inventoryType: 13,
        slot: "mainHand",
        subclass: PET_WEAPON_SUBCLASS,
        weaponType: "Pet",
        speedMs: b.speedMs,
        min: b.minDamage,
        max: b.maxDamage,
        dps: (b.minDamage + b.maxDamage) / 2 / (b.speedMs / 1000),
        damageTable: null,
        stats: [],
        allowableClass: 0,
        allowableRace: [0, 0],
        bonding: 0,
        icon: null,
        iconFileId: 0,
        source: "forever",
      }
    : null;
  const weapons: EquippedWeapons = { mainHand: weapon, offHand: null, ranged: null, ammo: null };
  const stats = computeCharacter({
    classToken: setup.info.owner,
    race: PET_RACE,
    level: a.level,
    baseStats,
    weapons,
    bonus: EMPTY_BONUS,
    effects: [...setup.effects, ...ownerScaling(setup, a.owner), ...a.auras.effects],
  });
  return { stats, weapons };
}
