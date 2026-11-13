import type { AttackSlot, MagicSchool, PrimaryStat, School, Weapon } from "@/data/types";
import {
  AP_PER_DPS,
  CRIT_RATING_PER_PCT,
  HASTE_RATING_PER_PCT,
  HIT_RATING_PER_PCT,
  ITEM_STAT,
  OFFHAND_DAMAGE_MULT,
  SKILL_PER_LEVEL,
} from "./constants";
import { UnsupportedLevelError } from "./errors";
import { baseStatsAt } from "./levels";
import { applyPct, makeStat, type Part, type SourceKind, type Stat } from "./stat";
import {
  ATTACK_SLOTS,
  MAGIC_SCHOOLS,
  PRIMARY_STATS,
  type CharacterInput,
  type CharacterStats,
  type SourcedEffect,
  type WeaponDamage,
} from "./types";

const WAND_SUBCLASS = 19;

export { UnsupportedLevelError };

const STAT_LABEL: Record<PrimaryStat, string> = {
  str: "Strength",
  agi: "Agility",
  sta: "Stamina",
  int: "Intellect",
  spi: "Spirit",
};
const STAT_ITEM_ID: Record<PrimaryStat, number> = {
  str: ITEM_STAT.str,
  agi: ITEM_STAT.agi,
  sta: ITEM_STAT.sta,
  int: ITEM_STAT.int,
  spi: ITEM_STAT.spi,
};
const SCHOOL_BONUS_KEY = {
  holy: "holySpellPower",
  fire: "fireSpellPower",
  nature: "natureSpellPower",
  frost: "frostSpellPower",
  shadow: "shadowSpellPower",
  arcane: "arcaneSpellPower",
} as const;

const part = (label: string, kind: SourceKind, value: number): Part => ({ label, kind, value });
const r2 = (n: number) => Math.round(n * 100) / 100;
const hasSchool = (e: SourcedEffect, s: School) => !e.schools || e.schools.includes(s);
const hasSlot = (e: SourcedEffect, s: AttackSlot) => !e.slots || e.slots.includes(s);

/** "X% of <stat>" parts (aura 598/580: attack power from Intellect). */
function statShare(
  effects: readonly SourcedEffect[],
  key: "attackPowerFromStat" | "rangedAttackPowerFromStat",
  P: (s: PrimaryStat) => number,
): Part[] {
  return effects
    .filter((e) => e.key === key && e.stat !== undefined && e.stat !== "all")
    .map((e) =>
      part(
        `${e.label} (${e.value}% of ${STAT_LABEL[e.stat as PrimaryStat]})`,
        e.kind,
        (P(e.stat as PrimaryStat) * e.value) / 100,
      ),
    );
}

/** Equipped weapons in slot order, each counted once. */
function equipped(input: CharacterInput): { slot: AttackSlot; w: Weapon }[] {
  return ATTACK_SLOTS.flatMap((slot) => (input.weapons[slot] ? [{ slot, w: input.weapons[slot]! }] : []));
}
function itemStat(input: CharacterInput, statId: number): Part[] {
  return equipped(input).flatMap(({ w }) =>
    w.stats.filter((s) => s.stat === statId).map((s) => part(w.name, "weapon", s.value)),
  );
}
function effectParts(
  effects: readonly SourcedEffect[],
  pred: (e: SourcedEffect) => boolean,
  scale = 1,
): Part[] {
  return effects.filter(pred).map((e) => part(e.label, e.kind, e.value * scale));
}

/**
 * Character sheet numbers (target-independent). Order of operations (section 5.2 of the Phase 3 plan):
 * 1. primary stats: class base + race + gear + weapons + flat effects, then each % effect multiplicatively
 * 2. health/mana from final Sta/Int, 3. AP/RAP from final Str/Agi + flat AP, then AP %, 4. spell power,
 * 5. crit/hit per attack slot and for spells, 6. haste (multiplicative), 7. weapon damage.
 */
export function computeCharacter(input: CharacterInput): CharacterStats {
  const { baseStats: bs, bonus, effects, level } = input;
  const cls = input.classToken.toUpperCase() as Uppercase<typeof input.classToken>;
  const race = bs.raceOffsets[input.race];
  if (!bs.classes[cls] || !race) throw new Error(`no base stats for ${input.race} ${cls}`);
  const lv = baseStatsAt(bs, cls, level); // Phase 7: interpolated below level 60 [VERIFY Q76]
  const base = lv.base;
  const conv = bs.conversions;

  // 1. primary stats
  const primary = {} as Record<PrimaryStat, Stat>;
  for (const s of PRIMARY_STATS) {
    const flat = makeStat([
      part(`Base (${input.classToken})`, "base", base[s]),
      part("Race", "race", race[s]),
      part("Bonus stats", "gear", bonus[s]),
      ...itemStat(input, STAT_ITEM_ID[s]),
      ...effectParts(effects, (e) => e.key === "stat" && (e.stat === s || e.stat === "all")),
    ]);
    const pcts = effects.filter((e) => e.key === "statPct" && (e.stat === s || e.stat === "all"));
    primary[s] = applyPct(flat, pcts);
  }
  const P = (s: PrimaryStat) => primary[s].value;
  const firstN = conv.statsWithoutBonus;
  const fromStat = (v: number, per: number) => (v <= firstN ? v : firstN + (v - firstN) * per);

  // 2. health and mana
  const health = applyPct(
    makeStat([
      part("Base health", "base", base.health),
      part(`Stamina ${r2(P("sta"))}`, "conversion", fromStat(P("sta"), conv.healthPerSta)),
      ...effectParts(effects, (e) => e.key === "health"),
    ]),
    effects.filter((e) => e.key === "healthPct"),
  );
  const mana =
    base.mana > 0
      ? applyPct(
          makeStat([
            part("Base mana", "base", base.mana),
            part(`Intellect ${r2(P("int"))}`, "conversion", fromStat(P("int"), conv.manaPerInt)),
            ...effectParts(effects, (e) => e.key === "mana"),
          ]),
          effects.filter((e) => e.key === "manaPct"),
        )
      : null;

  // 3. attack power
  const f = conv.meleeAttackPower[cls];
  const attackPower = applyPct(
    makeStat([
      part(
        `Level ${level} x ${f.perLevel} ${f.flat < 0 ? "-" : "+"} ${Math.abs(f.flat)}`,
        "base",
        f.perLevel * level + f.flat,
      ),
      part(`Strength x ${f.perStr}`, "conversion", P("str") * f.perStr),
      part(`Agility x ${f.perAgi}`, "conversion", P("agi") * f.perAgi),
      part("Bonus stats", "gear", bonus.attackPower),
      ...itemStat(input, ITEM_STAT.attackPower),
      ...effectParts(effects, (e) => e.key === "attackPower" || e.key === "meleeAttackPower"),
      ...statShare(effects, "attackPowerFromStat", P),
    ]),
    effects.filter((e) => e.key === "attackPowerPct"),
  );
  const rf = conv.rangedAttackPower[cls];
  const rangedAttackPower = rf
    ? applyPct(
        makeStat([
          part(
            `Level ${level} x ${rf.perLevel} ${rf.flat < 0 ? "-" : "+"} ${Math.abs(rf.flat)}`,
            "base",
            rf.perLevel * level + rf.flat,
          ),
          part(`Agility x ${rf.perAgi}`, "conversion", P("agi") * rf.perAgi),
          part("Bonus stats", "gear", bonus.attackPower + bonus.rangedAttackPower),
          ...itemStat(input, ITEM_STAT.attackPower),
          ...itemStat(input, ITEM_STAT.rangedAttackPower),
          ...effectParts(effects, (e) => e.key === "attackPower" || e.key === "rangedAttackPower"),
          ...statShare(effects, "rangedAttackPowerFromStat", P),
        ]),
        effects.filter((e) => e.key === "rangedAttackPowerPct"),
      )
    : null;

  // 4. spell power per school
  const spellPower = {} as Record<MagicSchool, Stat>;
  for (const sc of MAGIC_SCHOOLS) {
    spellPower[sc] = makeStat([
      part("Bonus stats", "gear", bonus.spellPower),
      part(`Bonus stats (${sc})`, "gear", bonus[SCHOOL_BONUS_KEY[sc]]),
      ...itemStat(input, ITEM_STAT.spellPower),
      ...itemStat(input, ITEM_STAT.spellDamage),
      ...effectParts(effects, (e) => e.key === "spellPower" && hasSchool(e, sc)),
      ...effects
        .filter(
          (e) =>
            e.key === "spellPowerFromStat" && hasSchool(e, sc) && e.stat !== undefined && e.stat !== "all",
        )
        .map((e) =>
          part(
            `${e.label} (${e.value}% of ${STAT_LABEL[e.stat as PrimaryStat]})`,
            e.kind,
            (P(e.stat as PrimaryStat) * e.value) / 100,
          ),
        ),
    ]);
  }

  // 5. crit and hit (character sheet; target effects are applied in evaluateTarget)
  const critRating = itemStat(input, ITEM_STAT.critRating).map((p) => ({
    ...p,
    label: `${p.label} (${p.value} crit rating)`,
    value: p.value / CRIT_RATING_PER_PCT,
  }));
  const hitRating = itemStat(input, ITEM_STAT.hitRating).map((p) => ({
    ...p,
    label: `${p.label} (${p.value} hit rating)`,
    value: p.value / HIT_RATING_PER_PCT,
  }));
  const agiPer = lv.agiPerMeleeCrit;
  const weaponCrit = (slot: AttackSlot): Stat =>
    makeStat([
      part("Base", "base", base.baseMeleeCrit),
      part(`Agility ${r2(P("agi"))} / ${r2(agiPer)}`, "conversion", P("agi") / agiPer),
      part("Bonus stats", "gear", bonus.crit),
      ...critRating,
      ...effectParts(effects, (e) => e.key === "crit" || (e.key === "weaponCrit" && hasSlot(e, slot))),
    ]);
  const intPer = lv.intPerSpellCrit;
  const spellCrit = makeStat([
    part("Base", "base", base.baseSpellCrit),
    part(
      `Intellect ${r2(P("int"))} / ${intPer === undefined ? "-" : r2(intPer)}`,
      "conversion",
      intPer ? P("int") / intPer : 0,
    ),
    part("Bonus stats", "gear", bonus.spellCrit),
    ...critRating,
    ...effectParts(effects, (e) => e.key === "crit" || e.key === "spellCrit"),
  ]);
  const weaponHit = (slot: AttackSlot): Stat =>
    makeStat([
      part("Bonus stats", "gear", bonus.hit),
      ...hitRating,
      ...effectParts(effects, (e) => e.key === "hit" || (e.key === "weaponHit" && hasSlot(e, slot))),
    ]);
  const spellHit = makeStat([
    part("Bonus stats", "gear", bonus.spellHit),
    ...hitRating,
    ...effectParts(effects, (e) => e.key === "hit" || e.key === "spellHit"),
  ]);
  const off = input.weapons.offHand !== null;
  const rng = input.weapons.ranged !== null && input.weapons.ranged.subclass !== WAND_SUBCLASS; // wands use the spell table [VERIFY]

  // 6. haste: (1 + a)(1 + b)... - 1, recorded as increments
  const hasteRating = itemStat(input, ITEM_STAT.hasteRating).map((p) => ({
    ...p,
    value: p.value / HASTE_RATING_PER_PCT,
  }));
  const haste = (key: "meleeHaste" | "rangedHaste" | "spellHaste"): Stat => {
    const mods = [
      { label: "Bonus stats", kind: "gear" as const, value: bonus.haste },
      ...hasteRating,
      ...effects.filter((e) => e.key === "haste" || e.key === key),
    ].filter((m) => m.value !== 0);
    let mult = 1;
    const parts: Part[] = [part("Base", "base", 0)];
    for (const m of mods) {
      parts.push(part(m.label, m.kind, mult * m.value)); // increment in % points of the running total
      mult *= 1 + m.value / 100;
    }
    return { value: (mult - 1) * 100, parts };
  };
  const hasteStat = { melee: haste("meleeHaste"), ranged: haste("rangedHaste"), spell: haste("spellHaste") };

  // weapon skill
  const skill = (slot: AttackSlot): Stat =>
    makeStat([
      part(`Level ${level} x ${SKILL_PER_LEVEL}`, "base", level * SKILL_PER_LEVEL),
      part("Bonus stats", "gear", bonus.weaponSkill),
      ...effectParts(effects, (e) => e.key === "weaponSkill" && hasSlot(e, slot)),
    ]);

  // 7. weapon damage
  const ohPct = effects.filter((e) => e.key === "offhandDamagePct");
  const weaponDamage = (slot: AttackSlot): WeaponDamage | null => {
    const w = input.weapons[slot];
    if (!w) return null;
    const isWand = w.subclass === 19;
    const speed = w.speedMs / 1000;
    const h = slot === "ranged" ? hasteStat.ranged.value : hasteStat.melee.value;
    const hastedSpeed = speed / (1 + (isWand ? hasteStat.spell.value : h) / 100);
    const ap = slot === "ranged" ? (rangedAttackPower?.value ?? 0) : attackPower.value;
    const ammo = slot === "ranged" && !isWand && w.subclass !== 16 ? input.weapons.ammo : null;
    const perSwing = makeStat([
      part(`${w.name} ${w.min}-${w.max}`, "weapon", (w.min + w.max) / 2),
      ...effectParts(effects, (e) => e.key === "weaponDamage" && hasSlot(e, slot)),
      part(ammo ? `${ammo.name} ${ammo.dps} dps x ${speed}` : "Ammo", "gear", ammo ? ammo.dps * speed : 0),
      part(
        `Attack power ${r2(ap)} / ${AP_PER_DPS} x ${speed}`,
        "conversion",
        isWand ? 0 : (ap / AP_PER_DPS) * speed,
      ),
    ]);
    let dps = makeStat(perSwing.parts.map((p) => ({ ...p, value: p.value / hastedSpeed })));
    if (slot === "offHand") {
      dps = applyPct(
        {
          value: dps.value * OFFHAND_DAMAGE_MULT,
          parts: dps.parts.map((p) => ({ ...p, value: p.value * OFFHAND_DAMAGE_MULT })),
        },
        ohPct,
      );
    }
    return {
      slot,
      weaponId: w.id,
      name: w.name,
      min: w.min,
      max: w.max,
      speed,
      hastedSpeed,
      perSwing,
      dps,
      isWand,
    };
  };

  const spellPen = {} as Record<MagicSchool, Stat>;
  for (const sc of MAGIC_SCHOOLS)
    spellPen[sc] = makeStat([
      part("Base", "base", 0),
      ...effectParts(effects, (e) => e.key === "spellPen" && hasSchool(e, sc)),
    ]);

  return {
    classToken: input.classToken,
    level,
    primary,
    health,
    mana,
    attackPower,
    rangedAttackPower,
    spellPower,
    crit: {
      mainHand: weaponCrit("mainHand"),
      offHand: off ? weaponCrit("offHand") : null,
      ranged: rng ? weaponCrit("ranged") : null,
      spell: spellCrit,
    },
    hit: {
      mainHand: weaponHit("mainHand"),
      offHand: off ? weaponHit("offHand") : null,
      ranged: rng ? weaponHit("ranged") : null,
      spell: spellHit,
    },
    haste: hasteStat,
    weaponSkill: {
      mainHand: skill("mainHand"),
      offHand: off ? skill("offHand") : null,
      ranged: rng ? skill("ranged") : null,
    },
    expertise: makeStat([part("Base", "base", 0), ...effectParts(effects, (e) => e.key === "expertise")]),
    armorPenPct: makeStat([part("Base", "base", 0), ...effectParts(effects, (e) => e.key === "armorPenPct")]),
    spellPen,
    weapons: {
      mainHand: weaponDamage("mainHand"),
      offHand: weaponDamage("offHand"),
      ranged: weaponDamage("ranged"),
    },
    damageDone: effects.filter((e) => e.key === "damageDonePct"),
    hasSpellCrit: intPer !== undefined,
  };
}
