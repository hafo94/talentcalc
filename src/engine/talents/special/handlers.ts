import type { AttackSlot, School } from "@/data/types";
import {
  evaluateAbility,
  weaponInfo,
  type AbilityDraft,
  type AbilityResult,
  type DamageContext,
  type RotationEffect,
} from "@/engine/abilities";
import { RAGE_PER_DAMAGE_FACTOR, expectedFactor, rageConversion, schoolsOf } from "@/engine/combat";
import type { RankedTalent, SourcedEffect } from "@/engine/stats";
import type { RotationResult } from "@/engine/rotation/types";
import type { ActiveHandler, HandlerArgs, SpecialHandler } from "./types";

const MINUTE = 60;
const v = (h: HandlerArgs, i: number) => h.values[i] ?? 0;
const hasSchool = (a: { schoolMask: number }, s: School) => schoolsOf(a.schoolMask).includes(s);
/** Probability that at least one event of a Poisson stream of `perMinute` happens in `seconds`. */
const uptime = (perMinute: number, seconds: number) => 1 - Math.exp((-perMinute * seconds) / MINUTE);
const landed = (a: AbilityResult) => a.hitChance / 100;
const critOfLanded = (a: AbilityResult) => a.critChance / 100;

/** Weapon subclasses (Item.SubclassID). */
const AXE = [0, 1];
const MACE = [4, 5];
const SWORD = [7, 8];
const POLEARM = [6];
const STAFF = [10];
const FIST = [13];
const DAGGER = [15];

/** Landed weapon hits per minute: white swings and melee abilities (main hand only when `mhOnly`). */
function weaponHitsPerMinute(r: RotationResult, mhOnly: boolean): number {
  let n = 0;
  for (const slot of ["mainHand", "offHand"] as AttackSlot[]) {
    const w = r.white[slot];
    if (w && (!mhOnly || slot === "mainHand")) n += (w.swingsPerMinute * w.white.hitChance) / 100;
  }
  for (const c of r.casts)
    if (c.ability.kind === "melee" && (!mhOnly || c.ability.slot === "mainHand"))
      n += c.perMinute * landed(c.ability);
  return n;
}
function meleeCritsPerMinute(r: RotationResult): number {
  let n = 0;
  for (const slot of ["mainHand", "offHand"] as AttackSlot[]) {
    const w = r.white[slot];
    if (w) n += (w.swingsPerMinute * w.white.critChance) / 100;
  }
  for (const c of r.casts)
    if (c.ability.kind === "melee") n += c.perMinute * landed(c.ability) * critOfLanded(c.ability);
  return n;
}
const castsOf = (r: RotationResult, name: string) => r.casts.filter((c) => c.ability.name === name);

const HANDLERS: SpecialHandler[] = [
  {
    spellId: 11119,
    name: "Ignite",
    modeled: "Fire crits add a burn of x% of the crit damage (no rolling, no munching).",
    ability: (h) => (d) => {
      if (d.kind !== "spell" || !hasSchool(d, "fire")) return;
      const pct = v(h, 0) / 100;
      let value = 0;
      for (const p of d.parts.filter((x) => x.kind === "direct"))
        value +=
          p.count *
          p.perHit *
          (p.chances.land / 100) *
          (Math.min(100, p.chances.crit) / 100) *
          p.critMultiplier *
          pct;
      if (value > 0) {
        d.extras.push({ label: h.label, value });
        d.sources.push({ label: h.label, kind: "talent", text: `crits burn for ${v(h, 0)}% more over 4 s` });
      }
    },
  },
  {
    spellId: 11124,
    name: "Fire Power",
    modeled:
      "+x% Fire damage per Fire effect on the target (Fireball/Pyroblast DoTs, Ignite, Fire Vulnerability), up to 4.",
    rotation: (h, r, ctx) => {
      let effects = 0;
      for (const c of r.casts)
        if (hasSchool(c.ability, "fire") && c.ability.schoolMask === 4 && c.ability.expectedPeriodic > 0)
          effects += Math.min(1, (c.perMinute * c.ability.durationSec) / MINUTE);
      if (ctx.talents.some((t) => t.talent.spellId === 11119 && t.rank > 0)) {
        const crits = r.casts
          .filter(
            (c) => c.ability.schoolMask === 4 && c.ability.kind === "spell" && c.ability.expectedDirect > 0,
          )
          .reduce((a, c) => a + c.perMinute * landed(c.ability) * critOfLanded(c.ability), 0);
        effects += uptime(crits, 4);
      }
      if (
        castsOf(r, "Scorch").some((c) => c.perMinute > 0) &&
        ctx.talents.some((t) => t.talent.spellId === 11095 && t.rank > 0)
      )
        effects += 1;
      const pct = v(h, 0) * Math.min(4, effects);
      return pct > 0 ? [{ label: h.label, damagePct: { schools: ["fire"], pct } }] : [];
    },
  },
  {
    spellId: 11095,
    name: "Improved Scorch",
    modeled:
      "Scorch keeps Fire Vulnerability (3% x 5 stacks, from spell data) on the target while it is in the rotation.",
    rotation: (h, r, ctx) => {
      if (!castsOf(r, "Scorch").some((c) => c.perMinute > 0)) return [];
      const fv = [...ctx.book.spells.values()].find((s) => s.name === "Fire Vulnerability");
      const per = fv?.effects.find((e) => e.aura === 270)?.base ?? 0;
      const pct = per * (fv?.maxStacks || 1) * (v(h, 0) / 100);
      return pct > 0 ? [{ label: h.label, damagePct: { schools: ["fire"], pct } }] : [];
    },
  },
  {
    spellId: 17793,
    name: "Improved Shadow Bolt",
    modeled: "Shadow Bolt crits: +x% Shadow damage taken for 12 s (average uptime).",
    rotation: (h, r) => {
      const crits = castsOf(r, "Shadow Bolt").reduce(
        (a, c) => a + c.perMinute * landed(c.ability) * critOfLanded(c.ability),
        0,
      );
      const pct = v(h, 0) * uptime(crits, 12);
      return pct > 0 ? [{ label: h.label, damagePct: { schools: ["shadow"], pct } }] : [];
    },
  },
  {
    spellId: 15257,
    name: "Shadow Weaving",
    modeled:
      "Shadow casts stack +2% Shadow damage taken (5 stacks, 15 s) at the talent's chance; steady-state stacks.",
    rotation: (h, r, ctx) => {
      const sw = [...ctx.book.spells.values()].find(
        (s) => s.name === "Shadow Weaving" && s.sources.includes("triggered"),
      );
      const per = sw?.effects.find((e) => e.aura === 270)?.base ?? 0;
      const max = sw?.maxStacks || 1;
      const apps = r.casts
        .filter((c) => hasSchool(c.ability, "shadow"))
        .reduce((a, c) => a + c.perMinute * landed(c.ability) * (v(h, 0) / 100), 0);
      const pct = per * Math.min(max, (apps * 15) / MINUTE);
      return pct > 0 ? [{ label: h.label, damagePct: { schools: ["shadow"], pct } }] : [];
    },
  },
  {
    spellId: 426316,
    name: "Shadow and Flame",
    modeled:
      "Conflagrate: +x% Shadow damage for 20 s (average uptime); Conflagrate does not consume Immolate.",
    rotation: (h, r) => {
      const n = castsOf(r, "Conflagrate").reduce((a, c) => a + c.perMinute * landed(c.ability), 0);
      const pct = v(h, 0) * Math.min(1, (n * 20) / MINUTE);
      return pct > 0 ? [{ label: h.label, damagePct: { schools: ["shadow"], pct } }] : [];
    },
  },
  {
    spellId: 408438,
    name: "Lightning Overload",
    modeled: "Lightning Bolt and Chain Lightning: x% chance of a second half-damage cast at no cost.",
    ability: (h) => (d) => {
      if (d.key !== "Lightning Bolt" && d.key !== "Chain Lightning") return;
      const direct = d.parts
        .filter((p) => p.kind === "direct")
        .reduce(
          (a, p) =>
            a + p.count * p.perHit * expectedFactor(p.chances, (p.critMultiplier - 1) / p.chances.critBonus),
          0,
        );
      d.extras.push({ label: h.label, value: direct * (v(h, 0) / 100) * 0.5 });
      d.sources.push({ label: h.label, kind: "talent", text: `${v(h, 0)}% chance of a half-damage copy` });
    },
  },
  {
    spellId: 1225139,
    name: "Improved Mind Flay",
    modeled: "Each Mind Flay tick deals x% more than the previous one.",
    ability: (h) => (d) => {
      if (d.key !== "Mind Flay") return;
      for (const p of d.parts.filter((x) => x.kind === "periodic")) {
        let sum = 0;
        for (let i = 0; i < p.count; i++) sum += (1 + v(h, 0) / 100) ** i;
        p.perHit *= sum / Math.max(1, p.count);
      }
      d.sources.push({ label: h.label, kind: "talent", text: `ticks ramp by ${v(h, 0)}%` });
    },
  },
  flurry(12319), // warrior
  flurry(16256), // shaman
  {
    spellId: 12322,
    name: "Unbridled Wrath",
    modeled: "x% chance per landed weapon hit to gain 1 rage.",
    rotation: (h, r) => [{ label: h.label, ragePerMinute: weaponHitsPerMinute(r, false) * (v(h, 0) / 100) }],
  },
  {
    spellId: 12296,
    name: "Anger Management",
    modeled: "1 rage every 3 s.",
    rotation: (h) => [{ label: h.label, ragePerMinute: (v(h, 1) * MINUTE) / Math.max(1, v(h, 2)) }],
  },
  {
    spellId: 23584,
    name: "Dual Wield Specialization",
    modeled: "Off-hand white hits generate x% more rage (the damage part is aura 122).",
    rotation: (h, r, ctx) => {
      const oh = r.white.offHand;
      if (!oh || r.power !== "rage") return [];
      const rage =
        (oh.swingsPerMinute * RAGE_PER_DAMAGE_FACTOR * oh.white.expectedPerSwing) / rageConversion(ctx.level);
      return [{ label: h.label, ragePerMinute: rage * (v(h, 1) / 100) }];
    },
  },
  {
    spellId: 12834,
    name: "Deep Wounds",
    modeled:
      "Melee crits bleed for x% of the average main-hand weapon damage over 12 s (uptime from crits per minute).",
    rotation: (h, r, ctx) => {
      const w = weaponInfo(ctx, "mainHand");
      if (!w) return [];
      const u = uptime(meleeCritsPerMinute(r), 12);
      const physical = ctx.stats.damageDone
        .filter((e) => !e.schools || e.schools.includes("physical"))
        .filter((e) => !e.slots || e.slots.includes("mainHand"))
        .reduce((a, e) => a * (1 + e.value / 100), 1);
      return [{ label: h.label, extraDps: (u * (v(h, 0) / 100) * w.perSwing * physical) / 12 }];
    },
  },
  {
    spellId: 1310315,
    name: "Improved Whirlwind",
    modeled: "Whirlwind deals x% more to the closest enemy (the cooldown part is a spell modifier).",
    ability: (h) => (d) => {
      if (d.key !== "Whirlwind") return;
      for (const p of d.parts) {
        const f = 1 + v(h, 1) / 100;
        p.perHit *= f;
        if (p.range) p.range = [p.range[0] * f, p.range[1] * f]; // keep the card's hit range consistent
      }
      d.sources.push({ label: h.label, kind: "talent", text: `+${v(h, 1)}% damage (closest enemy)` });
    },
  },
  weaponTalent(
    1290261,
    "Weaponmaster",
    { crit: 0, armor: 1, extra: 2 },
    {
      crit: [...AXE, ...POLEARM],
      armor: [...MACE, ...STAFF],
      extra: SWORD,
    },
  ),
  weaponTalent(
    13960,
    "Hack and Slash",
    { extra: 0, armor: 1, crit: 2 },
    {
      crit: [...DAGGER, ...FIST],
      armor: MACE,
      extra: [...AXE, ...SWORD],
    },
  ),
  {
    spellId: 14186,
    name: "Seal Fate",
    modeled: "Crits of combo point builders award an extra combo point at x% chance.",
    ability: (h) => (d: AbilityDraft) => {
      if (d.finisher || d.comboPoints <= 0) return;
      const p = d.parts[0];
      if (!p) return;
      d.comboPoints += (p.chances.land / 100) * (Math.min(100, p.chances.crit) / 100) * (v(h, 0) / 100);
      d.sources.push({ label: h.label, kind: "talent", text: "crits award an extra combo point" });
    },
  },
  {
    spellId: 14156,
    name: "Ruthlessness",
    modeled: "Finishers refund a combo point at x% chance.",
    ability: (h) => (d) => {
      if (!d.finisher) return;
      d.cpRefund += v(h, 0) / 100;
      d.sources.push({ label: h.label, kind: "talent", text: `${v(h, 0)}% chance to keep a combo point` });
    },
  },
  {
    spellId: 18094,
    name: "Nightfall",
    modeled:
      "Corruption/Drain Life/Drain Soul/Wrack ticks: x% chance of an instant Shadow Bolt (added as free casts).",
    rotation: (h, r, ctx) => {
      const ticks = r.casts
        .filter((c) => ["Corruption", "Drain Life", "Drain Soul", "Wrack"].includes(c.ability.name))
        .reduce(
          (a, c) =>
            a +
            Math.min(c.perMinute, c.ability.durationSec > 0 ? MINUTE / c.ability.durationSec : c.perMinute) *
              c.ability.ticks *
              landed(c.ability),
          0,
        );
      const sb = evaluateAbility({ ability: "Shadow Bolt", kind: "filler" }, ctx);
      if (!sb.available) return [];
      return [{ label: h.label, extraDps: (ticks * (v(h, 0) / 100) * sb.expected) / MINUTE }];
    },
  },
  {
    spellId: 16972,
    name: "Predatory Strikes",
    modeled: "Cat Form: +x% of your level as attack power.",
    stats: (h, env) =>
      env.form === "cat" || env.form === "bear"
        ? [{ key: "meleeAttackPower", value: (v(h, 0) / 100) * env.level, label: h.label, kind: "talent" }]
        : [],
  },
  {
    spellId: 415370,
    name: "Lone Wolf",
    modeled: "+20% damage (aura 79) while no pet is active; choosing a pet in the Pet panel turns it off.",
  },
];

function flurry(spellId: number): SpecialHandler {
  return {
    spellId,
    name: "Flurry",
    modeled: "After a melee crit, +x% attack speed for 3 swings: uptime 1 - (1 - white crit)^3.",
    rotation: (h, r) => {
      const w = r.white.mainHand?.white;
      if (!w) return [];
      const u = 1 - (1 - w.critChance / 100) ** 3;
      return [{ label: h.label, meleeHastePct: v(h, 0) * u }];
    },
  };
}

function weaponTalent(
  spellId: number,
  name: string,
  idx: { crit: number; armor: number; extra: number },
  kinds: { crit: number[]; armor: number[]; extra: number[] },
): SpecialHandler {
  return {
    spellId,
    name,
    modeled: "Main-hand weapon type: crit, armor penetration or extra attacks.",
    stats: (h, env) => {
      const sub = env.weapons.mainHand?.subclass;
      if (sub === undefined) return [];
      const out: SourcedEffect[] = [];
      if (kinds.crit.includes(sub)) {
        const slots = (["mainHand", "offHand"] as const).filter((s) => {
          const w = env.weapons[s];
          return w !== null && kinds.crit.includes(w.subclass);
        });
        out.push({
          key: "weaponCrit",
          value: v(h, idx.crit),
          slots: [...slots],
          label: h.label,
          kind: "talent",
        });
      }
      if (kinds.armor.includes(sub))
        out.push({ key: "armorPenPct", value: v(h, idx.armor), label: h.label, kind: "talent" });
      return out;
    },
    rotation: (h, r, ctx) => {
      const sub = ctx.weapons.mainHand?.subclass ?? null;
      const mh = r.white.mainHand;
      if (sub === null || !kinds.extra.includes(sub) || !mh) return [];
      const rate = weaponHitsPerMinute(r, true) * (v(h, idx.extra) / 100);
      return [{ label: h.label, extraDps: (rate * mh.white.expectedPerSwing) / MINUTE }];
    },
  };
}

export const SPECIAL_HANDLERS: ReadonlyMap<number, SpecialHandler> = new Map(
  HANDLERS.map((h) => [h.spellId, h]),
);

/** Handlers of the invested talents (form-only talents are skipped when the form does not match). */
export function activeHandlers(talents: readonly RankedTalent[], formMask: number): ActiveHandler[] {
  const out: ActiveHandler[] = [];
  for (const { talent, rank } of talents) {
    const handler = SPECIAL_HANDLERS.get(talent.spellId);
    if (!handler || rank <= 0) continue;
    if (talent.shapeshiftMask !== 0 && (talent.shapeshiftMask & formMask) === 0) continue;
    out.push({
      handler,
      args: {
        talent,
        rank,
        values: talent.ranks[rank - 1]?.values ?? [],
        label: `${talent.name} ${rank}/${talent.maxRank}`,
      },
    });
  }
  return out;
}

/** Union of the handlers' rotation effects for pass 2. */
export function rotationEffects(
  active: readonly ActiveHandler[],
  r: RotationResult,
  ctx: DamageContext,
): RotationEffect[] {
  return active.flatMap((a) => a.handler.rotation?.(a.args, r, ctx) ?? []);
}
