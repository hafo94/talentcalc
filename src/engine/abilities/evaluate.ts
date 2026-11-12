import type { AttackSlot, RotationEntry, School, Spell, SpellEffect } from "@/data/types";
import { AP_PER_DPS, describeRequirement, matchingSlots, type WeaponDamage } from "@/engine/stats";
import {
  ATTR2_CANT_CRIT,
  CAT_FORM,
  DAGGER_SUBCLASS,
  FINISHER_AP,
  JUDGEMENT_DAMAGE_FACTOR,
  MECHANIC_BLEED,
  NORMALIZED_SPEED,
  armorFactor,
  damageTakenFactor,
  expectedFactor,
  primarySchool,
  resistFactor,
  schoolsOf,
  specialChances,
  spellChances,
  whiteTable,
  type AttackKind,
  type RollChances,
} from "@/engine/combat";
import { OP, collectMods, type ModTotals } from "./mods";
import { learn } from "./spellbook";
import type {
  AbilityDraft,
  AbilityEval,
  AbilityResult,
  DamageContext,
  DamagePart,
  PowerKind,
  SourceLine,
  WhiteResult,
} from "./types";

/** SpellEffect.Effect values (modern enum, checked against 70888 class abilities, section 1.3). */
export const EFFECT = {
  SCHOOL_DAMAGE: 2,
  DUMMY: 3,
  APPLY_AURA: 6,
  WEAPON_DAMAGE_NOSCHOOL: 17, // weapon damage + base points (Heroic Strike, Cleave, Slam)
  ENERGIZE: 30, // misc[0] = power type (3 energy, 4 combo points)
  WEAPON_PERCENT_DAMAGE: 31, // weapon damage x base% (Backstab 150, Mutilate 90)
  WEAPON_DAMAGE: 58, // weapon damage + base points (Auto Shot, Raptor Strike, Shred)
  TRIGGER_SPELL: 64, // Mutilate main/off hand strikes
  NORMALIZED_WEAPON_DMG: 121, // normalized weapon damage + base points (Sinister Strike, Mortal Strike, Aimed Shot)
} as const;
export const AURA_PERIODIC_DAMAGE = 3;
export const AURA_PERIODIC_TRIGGER = 23;
export const AURA_PERIODIC_LEECH = 53;
const WEAPON_EFFECTS = new Set<number>([17, 31, 58, 121]);
const POWER: Readonly<Record<number, PowerKind>> = { 0: "mana", 1: "rage", 2: "focus", 3: "energy" };
const COMBO_POINTS = 4;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Value of an effect at a level: base + perLevel x (min(level, maxLevel) - baseLevel), then point modifiers. */
export function effectValue(spell: Spell, e: SpellEffect, level: number, mods: ModTotals | null): number {
  const lv = spell.levels;
  let v = e.base;
  if (lv && e.perLevel)
    v += e.perLevel * Math.max(0, (lv.max > 0 ? Math.min(level, lv.max) : level) - lv.base);
  if (!mods) return v;
  const idxOp = e.index === 0 ? OP.POINTS_0 : e.index === 1 ? OP.POINTS_1 : e.index === 2 ? OP.POINTS_2 : -1;
  const flat = mods.flat(OP.POINTS_ALL) + (idxOp >= 0 ? mods.flat(idxOp) : 0);
  const mult = mods.mult(OP.POINTS_ALL) * (idxOp >= 0 ? mods.mult(idxOp) : 1);
  return (v + flat) * mult;
}

function kindOf(spell: Spell): AttackKind {
  return spell.defenseType === 2 ? "melee" : spell.defenseType === 3 ? "ranged" : "spell";
}

/** Weapon numbers of a slot; Cat Form replaces the main hand with the form's claws (CAT_FORM). */
interface WeaponInfo {
  name: string;
  perSwing: number; // average damage incl. AP/14 x speed, ammo and flat weapon damage
  spread: number; // (max - min) / 2 of the weapon roll
  speed: number; // unhasted
  hastedSpeed: number;
  ap: number;
  normSpeed: number;
  factor: number; // off hand: 0.5 x (1 + off-hand %), else 1
}
export function weaponInfo(ctx: DamageContext, slot: AttackSlot): WeaponInfo | null {
  const s = ctx.stats;
  if (ctx.form === "cat" && slot === "mainHand") {
    const ap = s.attackPower.value; // includes Cat Form's Agility share (prepareDamage)
    const avg = ((CAT_FORM.minPerLevel + CAT_FORM.maxPerLevel) / 2) * ctx.level * CAT_FORM.speed;
    const hasted = CAT_FORM.speed / (1 + s.haste.melee.value / 100);
    return {
      name: "Cat Form",
      perSwing: avg + (ap / AP_PER_DPS) * CAT_FORM.speed,
      spread: ((CAT_FORM.maxPerLevel - CAT_FORM.minPerLevel) / 2) * ctx.level * CAT_FORM.speed,
      speed: CAT_FORM.speed,
      hastedSpeed: hasted,
      ap,
      normSpeed: CAT_FORM.speed,
      factor: 1,
    };
  }
  if (ctx.form === "cat") return null;
  const w: WeaponDamage | null = s.weapons[slot];
  const item = ctx.weapons[slot];
  if (!w || !item || w.isWand) return null;
  const ap = slot === "ranged" ? (s.rangedAttackPower?.value ?? 0) : s.attackPower.value;
  const normSpeed =
    slot === "ranged"
      ? NORMALIZED_SPEED.ranged
      : item.subclass === DAGGER_SUBCLASS
        ? NORMALIZED_SPEED.dagger
        : item.slot === "twoHand"
          ? NORMALIZED_SPEED.twoHand
          : NORMALIZED_SPEED.oneHand;
  const factor = slot === "offHand" ? (w.dps.value * w.hastedSpeed) / w.perSwing.value : 1;
  return {
    name: w.name,
    perSwing: w.perSwing.value,
    spread: (w.max - w.min) / 2,
    speed: w.speed,
    hastedSpeed: w.hastedSpeed,
    ap,
    normSpeed,
    factor,
  };
}

/** Damage multiplier lines shared by all parts of a spell: aura 79 (school + weapon slots), target debuffs, handlers. */
function damageMultiplier(
  ctx: DamageContext,
  key: string,
  schoolMask: number,
  slot: AttackSlot | null,
  lines: SourceLine[],
): number {
  const schools = schoolsOf(schoolMask);
  let m = 1;
  for (const e of ctx.stats.damageDone) {
    if (e.schools && !e.schools.some((s) => schools.includes(s))) continue;
    if (e.slots) {
      const melee = e.slots.includes("mainHand") || e.slots.includes("offHand");
      if (slot ? !e.slots.includes(slot) : !melee) continue;
    }
    m *= 1 + e.value / 100;
    lines.push({ label: e.label, kind: e.kind, text: `+${e.value}% damage` });
  }
  const taken = damageTakenFactor(ctx.view, schoolMask);
  if (taken !== 1) {
    m *= taken;
    lines.push({ label: "Target debuffs", kind: "debuff", text: `+${r1((taken - 1) * 100)}% damage taken` });
  }
  for (const fx of ctx.effects) {
    const d = fx.damagePct;
    if (!d || d.pct === 0 || !d.schools.some((s) => schools.includes(s))) continue;
    if (d.abilities && !d.abilities.includes(key)) continue;
    m *= 1 + d.pct / 100;
    lines.push({ label: fx.label, kind: "talent", text: `+${r1(d.pct)}% damage (average uptime)` });
  }
  return m;
}

function spellPowerOf(ctx: DamageContext, schoolMask: number): number {
  const magic = schoolsOf(schoolMask).filter((s) => s !== "physical") as Exclude<School, "physical">[];
  return magic.length ? Math.max(...magic.map((s) => ctx.stats.spellPower[s].value)) : 0;
}

interface DamageSource {
  spell: Spell; // the spell whose effects deal the damage (triggered spell for Mutilate / Judgement)
  slot: AttackSlot | null;
  factor: number;
  label: string;
}

/** Hooks for spells whose damage formula is server-scripted (section 6.4). */
interface ScriptArgs {
  ctx: DamageContext;
  spell: Spell;
  cp: number;
}
interface Script {
  slot?: AttackSlot;
  directBonus?(a: ScriptArgs): { value: number; text: string } | null;
  periodicTotalBonus?(a: ScriptArgs): { value: number; text: string } | null;
  spellPowerBonus?(a: ScriptArgs): { value: number; text: string } | null;
  multiplier?(a: ScriptArgs): { value: number; text: string } | null;
  durationMs?(a: ScriptArgs): number;
}
const dummyValue = (spell: Spell, index: number) => spell.effects.find((e) => e.index === index)?.base ?? 0;
export const SCRIPTS: Readonly<Record<string, Script>> = {
  // "damage equal to $s2% of your Attack Power plus $s1": effect 1 (DUMMY) holds the AP percent.
  Bloodthirst: {
    directBonus: ({ ctx, spell }) => {
      const pct = dummyValue(spell, 1);
      return { value: (pct / 100) * ctx.stats.attackPower.value, text: `${pct}% of attack power` };
    },
  },
  Eviscerate: {
    directBonus: ({ ctx, cp }) => ({
      value: FINISHER_AP.Eviscerate!(cp) * ctx.stats.attackPower.value,
      text: `${r1(FINISHER_AP.Eviscerate!(cp) * 100)}% of attack power [VERIFY]`,
    }),
  },
  "Ferocious Bite": {
    directBonus: ({ ctx, cp }) => ({
      value: FINISHER_AP["Ferocious Bite"]!(cp) * ctx.stats.attackPower.value,
      text: `${r1(FINISHER_AP["Ferocious Bite"]!(cp) * 100)}% of attack power [VERIFY]`,
    }),
  },
  Rip: {
    periodicTotalBonus: ({ ctx, cp }) => ({
      value: FINISHER_AP.Rip!(cp) * ctx.stats.attackPower.value,
      text: `${r1(FINISHER_AP.Rip!(cp) * 100)}% of attack power [VERIFY]`,
    }),
  },
  // "Lasts longer per combo point: 1 point: 9 seconds ... 5 points: 21 seconds"
  "Slice and Dice": { durationMs: ({ spell, cp }) => (spell.duration?.ms ?? 0) + 3000 * cp },
  // "Instantly strike with your off-hand weapon"
  Shank: { slot: "offHand" },
  // "gains additional Spell Damage equal to $s2% of your maximum Mana"
  "Arcane Wrath": {
    spellPowerBonus: ({ ctx, spell }) => {
      const pct = dummyValue(spell, 1);
      return {
        value: (pct / 100) * (ctx.stats.mana?.value ?? 0),
        text: `+${pct}% of maximum mana as spell damage`,
      };
    },
  },
  // "an additional $s2% damage if the target is afflicted by Immolate"
  Incinerate: {
    multiplier: ({ ctx, spell }) =>
      ctx.rotationAbilities.has("Immolate")
        ? {
            value: 1 + dummyValue(spell, 1) / 100,
            text: `+${dummyValue(spell, 1)}% (Immolate on the target)`,
          }
        : null,
  },
};

/** Damage sources of a cast (section 6.3): the spell itself, triggered strikes, both weapons, or the judged seal. */
function damageSources(
  ctx: DamageContext,
  spell: Spell,
  key: string,
  slot: AttackSlot | null,
): DamageSource[] | string {
  if (key === "Judgement") {
    const seal = ctx.selfBuffs.find((s) => s.name.startsWith("Seal of "));
    if (!seal) return "needs a Seal in the rotation";
    let cur: Spell | undefined = seal;
    for (let i = 0; i < 4 && cur; i++) {
      if (cur.effects.some((e) => e.effect === EFFECT.SCHOOL_DAMAGE) && cur.name.startsWith("Judgement of "))
        return [{ spell: cur, slot: null, factor: JUDGEMENT_DAMAGE_FACTOR[cur.name] ?? 1, label: cur.name }];
      const next: Spell | undefined = cur.effects
        .filter((e) => e.effect === EFFECT.DUMMY || (e.effect === EFFECT.APPLY_AURA && e.aura === 4))
        .map((e) => ctx.book.spells.get(e.base))
        .find((s) => s?.name.startsWith("Judgement of "));
      cur = next;
    }
    return `no damage spell for the judgement of ${seal.name}`;
  }
  const triggered = spell.effects
    .filter((e) => e.effect === EFFECT.TRIGGER_SPELL && e.triggerSpell)
    .map((e) => ctx.book.spells.get(e.triggerSpell!))
    .filter((s): s is Spell => !!s && s.effects.some((x) => WEAPON_EFFECTS.has(x.effect)));
  if (triggered.length > 0) {
    const slots: AttackSlot[] = ["mainHand", "offHand"];
    return triggered
      .map((s, i) => ({
        spell: s,
        slot: slots[i] ?? "mainHand",
        factor: 1,
        label: i === 0 ? "Main hand" : "Off hand",
      }))
      .filter((d) => weaponInfo(ctx, d.slot) !== null);
  }
  const out: DamageSource[] = [{ spell, slot, factor: 1, label: spell.name }];
  // Forever Whirlwind: "causing weapon damage from both melee weapons" [VERIFY]
  if (key === "Whirlwind" && weaponInfo(ctx, "offHand"))
    out.push({ spell, slot: "offHand", factor: 1, label: "Off hand" });
  return out;
}

function chancesFor(
  ctx: DamageContext,
  spell: Spell,
  slot: AttackSlot | null,
  mods: ModTotals,
): RollChances | string {
  const kind = kindOf(spell);
  const critMod = mods.flat(OP.CRIT_CHANCE);
  const hitMod = mods.flat(OP.HIT_CHANCE);
  let c: RollChances;
  if (kind === "spell") c = spellChances(ctx.view, hitMod, critMod);
  else {
    const o = ctx.view[slot ?? (kind === "ranged" ? "ranged" : "mainHand")];
    if (!o)
      return kind === "ranged" ? "requires a bow, gun, crossbow or thrown weapon" : "requires a melee weapon";
    c = specialChances(o, kind === "ranged", hitMod, critMod);
  }
  if ((spell.attributes[2] ?? 0) & ATTR2_CANT_CRIT) c = { ...c, crit: 0 };
  return c;
}

/** Damage parts of one source (weapon strike, direct effects, periodic effects, periodic missiles). */
function partsOf(
  ctx: DamageContext,
  src: DamageSource,
  key: string,
  cp: number,
  durationMs: number,
  lines: SourceLine[],
): DamagePart[] | string {
  const spell = src.spell;
  const mods = collectMods(spell, ctx.mods, ctx.book.classSet);
  lines.push(...mods.lines);
  const chances = chancesFor(ctx, spell, src.slot, mods);
  if (typeof chances === "string") return chances;
  const school = primarySchool(spell.school);
  const magic = school !== "physical";
  const sp = spellPowerOf(ctx, spell.school);
  const script = SCRIPTS[key];
  const spBonus = script?.spellPowerBonus?.({ ctx, spell, cp }) ?? null;
  if (spBonus) lines.push({ label: spell.name, kind: "rule", text: spBonus.text });
  const spTotal = sp + (spBonus?.value ?? 0);
  const critMult = 1 + chances.critBonus * mods.mult(OP.CRIT_DAMAGE);
  const common = damageMultiplier(ctx, key, spell.school, src.slot, lines) * src.factor;
  const scriptMult = script?.multiplier?.({ ctx, spell, cp }) ?? null;
  if (scriptMult) lines.push({ label: spell.name, kind: "rule", text: scriptMult.text });
  const bleed = spell.mechanic === MECHANIC_BLEED;
  const resist = resistFactor(ctx.view, spell.school, ctx.level);
  const mitigation = (b: boolean) => armorFactor(ctx.view, school, b) * resist;
  const effects = [...spell.effects].sort((a, b) => a.index - b.index);
  const parts: DamagePart[] = [];
  const directMult = common * mods.mult(OP.DAMAGE) * (scriptMult?.value ?? 1);

  // 1. weapon strike: effects applied in index order (17/58/121 add, 31 multiplies) [VERIFY Q48]
  if (effects.some((e) => WEAPON_EFFECTS.has(e.effect))) {
    const slot = src.slot ?? (kindOf(spell) === "ranged" ? "ranged" : "mainHand");
    const w = weaponInfo(ctx, slot);
    if (!w)
      return slot === "ranged" ? "requires a bow, gun, crossbow or thrown weapon" : "requires a melee weapon";
    const normalized = effects.some((e) => e.effect === EFFECT.NORMALIZED_WEAPON_DMG);
    const apPart = (w.ap / AP_PER_DPS) * w.speed;
    let dmg = (normalized ? w.perSwing - apPart + (w.ap / AP_PER_DPS) * w.normSpeed : w.perSwing) * w.factor;
    let spread = w.spread * w.factor;
    for (const e of effects) {
      if (!WEAPON_EFFECTS.has(e.effect)) continue;
      const v = effectValue(spell, e, ctx.level, mods);
      const spPart = magic && e.spCoef ? e.spCoef * spTotal : 0;
      if (e.effect === EFFECT.WEAPON_PERCENT_DAMAGE) {
        dmg = (dmg * v) / 100 + spPart;
        spread = (spread * v) / 100;
      } else dmg += v + spPart;
    }
    const k = directMult * mitigation(false);
    parts.push({
      label: `${src.label}${normalized ? " (normalized)" : ""}`,
      kind: "direct",
      perHit: dmg * k,
      count: 1,
      chances,
      critMultiplier: critMult,
      range: [(dmg - spread) * k, (dmg + spread) * k],
    });
  }

  // 2. direct school damage (effect 2), incl. combo points and spell power
  for (const e of effects.filter((x) => x.effect === EFFECT.SCHOOL_DAMAGE)) {
    const base = effectValue(spell, e, ctx.level, mods) + (e.pointsPerCombo ?? 0) * cp;
    const spPart = magic && e.spCoef ? e.spCoef * spTotal : 0;
    const bonus = script?.directBonus?.({ ctx, spell, cp }) ?? null;
    if (bonus) lines.push({ label: spell.name, kind: "rule", text: bonus.text });
    if (spPart) lines.push({ label: "Spell power", kind: "gear", text: `${r1(sp)} x ${e.spCoef}` });
    const avg = base + spPart + (bonus?.value ?? 0);
    const k = directMult * mitigation(bleed || e.mechanic === MECHANIC_BLEED);
    const v = e.variance ?? 0;
    parts.push({
      label: spell.name,
      kind: "direct",
      perHit: avg * k,
      count: 1,
      chances,
      critMultiplier: critMult,
      range: [
        (base * (1 - v / 2) + spPart + (bonus?.value ?? 0)) * k,
        (base * (1 + v / 2) + spPart + (bonus?.value ?? 0)) * k,
      ],
    });
  }

  // 3. periodic damage (aura 3 / 53) and periodic missiles (aura 23 -> triggered spell)
  for (const e of effects.filter((x) => x.effect === EFFECT.APPLY_AURA)) {
    const period = e.periodMs ?? 0;
    if (period <= 0 || durationMs <= 0) continue;
    const ticks = Math.floor(durationMs / period + 1e-9);
    if (e.aura === AURA_PERIODIC_DAMAGE || e.aura === AURA_PERIODIC_LEECH) {
      const total = script?.periodicTotalBonus?.({ ctx, spell, cp }) ?? null;
      if (total) lines.push({ label: spell.name, kind: "rule", text: total.text });
      const spPart = magic && e.spCoef ? e.spCoef * spTotal : 0;
      if (spPart)
        lines.push({ label: "Spell power", kind: "gear", text: `${r1(sp)} x ${e.spCoef} per tick` });
      const tick =
        effectValue(spell, e, ctx.level, mods) +
        (e.pointsPerCombo ?? 0) * cp +
        spPart +
        (total ? total.value / ticks : 0);
      const k =
        common *
        mods.mult(OP.PERIODIC) *
        (scriptMult?.value ?? 1) *
        mitigation(bleed || e.mechanic === MECHANIC_BLEED);
      parts.push({
        label: `${spell.name} (periodic)`,
        kind: "periodic",
        perHit: tick * k,
        count: ticks,
        chances,
        critMultiplier: critMult,
      });
    } else if (e.aura === AURA_PERIODIC_TRIGGER && e.triggerSpell) {
      const missile = ctx.book.spells.get(e.triggerSpell);
      const d = missile?.effects.find((x) => x.effect === EFFECT.SCHOOL_DAMAGE);
      if (!missile || !d) continue;
      const mm = collectMods(missile, ctx.mods, ctx.book.classSet);
      lines.push(...mm.lines);
      const mc = chancesFor(ctx, missile, null, mm);
      if (typeof mc === "string") return mc;
      const spPart = d.spCoef ? d.spCoef * spTotal : 0;
      const k = damageMultiplier(ctx, key, missile.school, null, []) * mm.mult(OP.DAMAGE) * mitigation(false);
      const v = d.variance ?? 0;
      const base = effectValue(missile, d, ctx.level, mm);
      parts.push({
        label: missile.name,
        kind: "direct",
        perHit: (base + spPart) * k,
        count: ticks,
        chances: mc,
        critMultiplier: 1 + mc.critBonus * mm.mult(OP.CRIT_DAMAGE),
        range: [(base * (1 - v / 2) + spPart) * k, (base * (1 + v / 2) + spPart) * k],
      });
    }
  }
  return parts;
}

const partExpected = (p: DamagePart) =>
  p.count * p.perHit * expectedFactor(p.chances, (p.critMultiplier - 1) / p.chances.critBonus);

/** Evaluates a rotation entry's ability (or a proc spell when `procSpell` is given) against the context's target. */
export function evaluateAbility(
  entry: Pick<RotationEntry, "ability" | "kind" | "cp">,
  ctx: DamageContext,
  procSpell?: Spell,
): AbilityEval {
  const key = entry.ability;
  let spell: Spell;
  if (procSpell) spell = procSpell;
  else {
    const l = learn(ctx.book, key, ctx.level, ctx.talents, ctx.classTalents);
    if ("reason" in l) return { key, available: false, reason: l.reason };
    spell = l.spell;
  }
  const kind = kindOf(spell);
  const script = SCRIPTS[key];
  const slot: AttackSlot | null =
    kind === "spell" ? null : (script?.slot ?? (kind === "ranged" ? "ranged" : "mainHand"));
  if (slot && ctx.form !== "cat") {
    if (!weaponInfo(ctx, slot))
      return {
        key,
        available: false,
        reason:
          slot === "offHand"
            ? "requires an off-hand weapon"
            : slot === "ranged"
              ? "requires a bow, gun, crossbow or thrown weapon"
              : "requires a melee weapon",
      };
    if (spell.equipped && !matchingSlots(spell.equipped, ctx.weapons).includes(slot))
      return { key, available: false, reason: describeRequirement(spell.equipped) };
  }
  const cp = entry.kind === "finisher" ? (entry.cp ?? 5) : 0;
  const mods = collectMods(spell, ctx.mods, ctx.book.classSet);
  const lines: SourceLine[] = [];
  const notes: string[] = [];

  // time
  const haste =
    kind === "ranged" ? ctx.stats.haste.ranged.value : kind === "spell" ? ctx.stats.haste.spell.value : 0;
  const rawCast = Math.max(
    0,
    ((Math.max(0, spell.castMs) + mods.flat(OP.CAST_TIME)) * mods.mult(OP.CAST_TIME)) / 1000,
  );
  const castTime = rawCast / (1 + haste / 100);
  const baseDurMs = script?.durationMs?.({ ctx, spell, cp }) ?? spell.duration?.ms ?? 0;
  const durationMs = Math.max(0, (Math.max(0, baseDurMs) + mods.flat(OP.DURATION)) * mods.mult(OP.DURATION));
  const channelTime = spell.channeled ? durationMs / 1000 : 0;
  const gcd = spell.gcdMs / 1000;
  const cdMod = (ms: number) =>
    ms > 0 ? Math.max(0, ((ms + mods.flat(OP.COOLDOWN)) * mods.mult(OP.COOLDOWN)) / 1000) : 0;
  const ownCd = cdMod(spell.cooldownMs);
  const catCd = cdMod(spell.categoryCooldownMs);
  const timeCost = procSpell ? 0 : Math.max(gcd, castTime, channelTime);

  // cost
  const c = spell.costs.find((x) => x.powerType in POWER);
  const power = c ? POWER[c.powerType]! : null;
  let cost = 0;
  if (c && !procSpell) {
    const raw = c.amount + (c.powerType === 0 ? (c.pct / 100) * ctx.book.baseMana : 0);
    const flat = mods.flat(OP.COST) / (c.powerType === 1 ? 10 : 1); // rage modifiers are in tenths
    cost = Math.max(0, (raw + flat) * mods.mult(OP.COST));
  }
  let energize = 0;
  let comboPoints = 0;
  for (const e of spell.effects) {
    if (e.effect !== EFFECT.ENERGIZE) continue;
    if (e.misc[0] === COMBO_POINTS) comboPoints += effectValue(spell, e, ctx.level, mods);
    else if (c && e.misc[0] === c.powerType) energize += effectValue(spell, e, ctx.level, mods);
  }

  // damage
  const sources = damageSources(ctx, spell, key, slot);
  if (typeof sources === "string") return { key, available: false, reason: sources };
  const parts: DamagePart[] = [];
  for (const src of sources) {
    const p = partsOf(ctx, src, key, cp, durationMs, lines);
    if (typeof p === "string") return { key, available: false, reason: p };
    parts.push(...p);
  }
  // combo points are awarded on a landed hit; an ability without damage (Slice and Dice) always "lands"
  const land = parts[0]?.chances.land ?? 100;
  comboPoints *= land / 100;
  const draft: AbilityDraft = {
    key,
    spell,
    kind,
    school: primarySchool(spell.school),
    schoolMask: spell.school,
    slot,
    finisher: entry.kind === "finisher",
    parts,
    extras: [],
    comboPoints,
    cpRefund: 0,
    sources: lines,
    notes,
  };
  for (const hook of ctx.abilityHooks) hook(draft, ctx);

  const direct = draft.parts.filter((p) => p.kind === "direct");
  const periodic = draft.parts.filter((p) => p.kind === "periodic");
  const expectedDirect = direct.reduce((a, p) => a + partExpected(p), 0);
  const expectedPeriodic = periodic.reduce((a, p) => a + partExpected(p), 0);
  const extra = draft.extras.reduce((a, x) => a + x.value, 0);
  const expected = expectedDirect + expectedPeriodic + extra;
  const hit =
    direct.reduce((a, p) => a + p.perHit * p.count, 0) / Math.max(1, direct.length ? direct[0]!.count : 1);
  const ref = draft.parts[0];
  const execute = timeCost > 0 ? timeCost : 1.5;
  const uniq = dedupe(lines);
  const result: AbilityResult = {
    key,
    available: true,
    spell,
    name: spell.name,
    rank: spell.rank,
    icon: spell.icon,
    school: draft.school,
    schoolMask: spell.school,
    kind,
    slot,
    castTime,
    channelTime,
    gcd,
    cooldown: Math.max(ownCd, catCd),
    category: catCd > 0 ? spell.category : 0,
    categoryCooldown: catCd,
    timeCost,
    power,
    cost,
    energize,
    comboPoints: draft.comboPoints,
    cpRefund: draft.cpRefund,
    hitChance: land,
    critChance: ref ? Math.min(100, ref.chances.crit) : 0,
    critMultiplier: ref ? ref.critMultiplier : 1,
    hit: direct.length ? hit : 0,
    hitRange: direct.length === 1 && direct[0]!.count === 1 && direct[0]!.range ? direct[0]!.range : null,
    crit: direct.length ? hit * direct[0]!.critMultiplier : 0,
    tick: periodic[0]?.perHit ?? 0,
    ticks: periodic[0]?.count ?? (direct[0] && direct[0].count > 1 ? direct[0].count : 0),
    periodSec: (spell.effects.find((e) => (e.periodMs ?? 0) > 0)?.periodMs ?? 0) / 1000,
    durationSec: durationMs / 1000,
    expectedDirect,
    expectedPeriodic,
    extras: draft.extras,
    expected,
    dpct: expected / execute,
    sources: uniq,
    notes: draft.notes,
  };
  return result;
}

function dedupe(lines: SourceLine[]): SourceLine[] {
  const seen = new Set<string>();
  return lines.filter((l) => {
    const k = `${l.label}|${l.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** White melee or Auto Shot of one slot (section 6.5). `extraAp` = Windfury attack power bonus. */
export function evaluateWhite(ctx: DamageContext, slot: AttackSlot, extraAp = 0): WhiteResult | null {
  const w = weaponInfo(ctx, slot);
  const o = ctx.view[slot];
  if (!w || !o) return null;
  const skill = ctx.stats.weaponSkill[slot]?.value ?? ctx.level * 5;
  const t = whiteTable(o, slot, skill, ctx.view.level);
  const mult = damageMultiplier(ctx, slot === "ranged" ? "Auto Shot" : "Melee", 1, slot, []);
  const normalHit =
    (w.perSwing + (extraAp / AP_PER_DPS) * w.speed) *
    w.factor *
    mult *
    armorFactor(ctx.view, "physical", false);
  const haste = ctx.effects.reduce((a, fx) => a * (1 + (fx.meleeHastePct ?? 0) / 100), 1);
  const speed = slot === "ranged" ? w.hastedSpeed : w.hastedSpeed / haste;
  const expectedPerSwing = normalHit * t.factor;
  return {
    slot,
    name: slot === "ranged" ? "Auto Shot" : slot === "offHand" ? "Off-hand melee" : "Main-hand melee",
    speed,
    normalHit,
    expectedPerSwing,
    hitChance: 100 - t.miss - t.dodge,
    critChance: t.crit,
    glancing: t.glancing,
    glancingMultiplier: t.glancingMultiplier,
    dps: expectedPerSwing / speed,
  };
}
