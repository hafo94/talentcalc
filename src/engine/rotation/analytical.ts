import type { RotationEntry, SpecRotation, Spell } from "@/data/types";
import {
  evaluateAbility,
  evaluateWhite,
  type AbilityEval,
  type AbilityResult,
  type DamageContext,
  type PowerKind,
  type WhiteResult,
} from "@/engine/abilities";
import {
  ENERGY_PER_SECOND,
  RAGE_PER_DAMAGE_FACTOR,
  SEAL_OF_COMMAND_PPM,
  WINDFURY,
  rageConversion,
} from "@/engine/combat";
import { simOnlyReason } from "./conditions";
import type { CastLimit, CastLine, RotationResult, WhiteLine } from "./types";

const MINUTE = 60;

export interface RotationInput {
  rotation: SpecRotation;
  evals: { entry: RotationEntry; ability: AbilityEval }[];
  white: { mainHand: WhiteResult | null; offHand: WhiteResult | null; ranged: WhiteResult | null };
  ctx: DamageContext;
  talentRank(name: string): number;
}

/** Resource the rotation spends: rage (warrior), energy (rogue, Cat Form), else mana. */
function powerOf(input: RotationInput): PowerKind | null {
  const first = input.evals.find((e) => e.ability.available && (e.ability as AbilityResult).power);
  return first ? ((first.ability as AbilityResult).power ?? null) : null;
}

const ragePerSwing = (w: WhiteResult, level: number) =>
  (RAGE_PER_DAMAGE_FACTOR * w.expectedPerSwing) / rageConversion(level);

/**
 * Analytical priority model (section 6.6): per minute, each entry in priority order takes
 * n = min(cap, time left / time per cast, resource left / cost per cast) casts, where cap comes from the cooldown,
 * shared category cooldown, DoT/buff duration or `everySec`. Finishers are bought as cycles with their builder casts.
 * On-next-swing attacks use the resource left at the end and replace main-hand swings. Mana never limits casts.
 */
export function runRotation(input: RotationInput): RotationResult {
  const { rotation, ctx } = input;
  const power = powerOf(input);
  const limited = power === "rage" || power === "energy" || power === "focus";
  const skipped: { ability: string; reason: string }[] = [];
  const casts: CastLine[] = [];
  const effects = ctx.effects;

  const mh = rotation.melee ? input.white.mainHand : null;
  const oh = rotation.melee ? input.white.offHand : null;
  const ranged = rotation.autoShot ? input.white.ranged : null;
  let income = 0;
  if (power === "energy") income = ENERGY_PER_SECOND * MINUTE;
  if (power === "rage") {
    for (const w of [mh, oh]) if (w) income += (MINUTE / w.speed) * ragePerSwing(w, ctx.level);
    income += effects.reduce((a, fx) => a + (fx.ragePerMinute ?? 0), 0);
  }
  let resource = limited ? income : Infinity;
  let time = MINUTE;
  let spent = 0;
  const categoryTime = new Map<number, number>();
  const available = new Set(input.evals.filter((e) => e.ability.available).map((e) => e.entry.ability));

  const builders = input.evals.filter((e) => e.entry.kind === "builder" && e.ability.available);
  const builder = builders[0]?.ability as AbilityResult | undefined;
  let builderCasts = 0;

  const push = (entry: RotationEntry | null, a: AbilityResult, n: number, limit: CastLimit) => {
    const dotCap = a.durationSec > 0 ? MINUTE / a.durationSec : Infinity;
    const dmg =
      n * (a.expectedDirect + a.extras.reduce((s, x) => s + x.value, 0)) +
      Math.min(n, dotCap) * a.expectedPeriodic;
    casts.push({
      key: a.key,
      entry,
      ability: a,
      perMinute: n,
      damagePerMinute: dmg,
      dps: dmg / MINUTE,
      limit,
    });
  };

  // Resource generators (net cost < 0, e.g. Shank +25 energy for 5) go first so their resource is pooled.
  const generates = (e: RotationInput["evals"][number]) =>
    limited && e.ability.available && e.ability.power === power && e.ability.cost - e.ability.energize < 0;
  const ordered = [...input.evals.filter(generates), ...input.evals.filter((e) => !generates(e))];
  for (const { entry, ability } of ordered) {
    if (entry.kind === "nextSwing") continue;
    const simOnly = simOnlyReason(entry);
    if (simOnly) {
      skipped.push({ ability: entry.ability, reason: simOnly });
      continue;
    }
    if (!ability.available) {
      skipped.push({ ability: entry.ability, reason: ability.reason });
      continue;
    }
    if (entry.requiresTalent && input.talentRank(entry.requiresTalent) === 0) {
      skipped.push({ ability: entry.ability, reason: `needs the talent ${entry.requiresTalent}` });
      continue;
    }
    if (entry.requires && !available.has(entry.requires)) {
      skipped.push({ ability: entry.ability, reason: `needs ${entry.requires}` });
      continue;
    }
    if (entry.kind === "builder") {
      if (ability !== builder)
        skipped.push({ ability: entry.ability, reason: `${builder?.key} is the builder` });
      continue;
    }
    const a = ability;
    let t = a.timeCost;
    let cost = (a.power === power ? a.cost - a.energize : 0) * (limited ? 1 : 0);
    let k = 0;
    let cap = a.cooldown > 0 ? MINUTE / a.cooldown : Infinity;
    let limit: CastLimit = "cooldown";
    if (entry.kind === "dot" && a.durationSec > 0) {
      if (MINUTE / a.durationSec < cap) limit = "duration";
      cap = Math.min(cap, MINUTE / a.durationSec);
    }
    if (entry.kind === "maintain") {
      const every = entry.everySec ?? a.durationSec;
      if (every > 0) {
        cap = Math.min(cap, MINUTE / every);
        limit = "duration";
      }
    }
    if (entry.kind === "finisher") {
      if (!builder || builder.comboPoints <= 0) {
        skipped.push({ ability: entry.ability, reason: "no combo point builder" });
        continue;
      }
      k = Math.max(0, (entry.cp ?? 5) - a.cpRefund) / builder.comboPoints;
      t += k * builder.timeCost;
      cost += k * (builder.power === power && limited ? builder.cost - builder.energize : 0);
      if (entry.buff || a.expectedPeriodic > 0) {
        cap = a.durationSec > 0 ? MINUTE / a.durationSec : Infinity;
        limit = "duration";
      } else cap = Infinity;
    }
    if (a.category && a.categoryCooldown > 0) {
      const left = categoryTime.get(a.category) ?? MINUTE;
      cap = Math.min(cap, left / a.categoryCooldown);
    }
    let n = cap;
    if (t > 0 && time / t < n) {
      n = time / t;
      limit = "time";
    }
    if (cost > 0 && resource / cost < n) {
      n = resource / cost;
      limit = "resource";
    }
    if (!Number.isFinite(n)) {
      skipped.push({ ability: entry.ability, reason: "no cooldown, cast time or cost: not modeled" });
      continue;
    }
    n = Math.max(0, n);
    time -= n * t;
    resource -= n * cost;
    if (a.power === "mana" || (a.power === power && cost > 0)) spent += n * (a.cost - a.energize);
    if (a.category && a.categoryCooldown > 0)
      categoryTime.set(a.category, (categoryTime.get(a.category) ?? MINUTE) - n * a.categoryCooldown);
    push(entry, a, n, limit);
    if (k > 0 && builder) {
      builderCasts += n * k;
      if (builder.power === "mana") spent += n * k * builder.cost;
    }
  }
  if (builder && builderCasts > 0) {
    const entry = builders[0]!.entry;
    push(entry, builder, builderCasts, "builder");
  }

  // on-next-swing attacks (Heroic Strike): leftover resource; each replaces a main-hand swing (which gives no rage)
  let mhSwings = mh ? MINUTE / mh.speed : 0;
  for (const { entry, ability } of input.evals) {
    if (entry.kind !== "nextSwing") continue;
    const simOnly = simOnlyReason(entry);
    if (simOnly) {
      skipped.push({ ability: entry.ability, reason: simOnly });
      continue;
    }
    if (!ability.available) {
      skipped.push({ ability: entry.ability, reason: ability.reason });
      continue;
    }
    if (!mh) {
      skipped.push({ ability: entry.ability, reason: "needs white main-hand swings" });
      continue;
    }
    const a = ability;
    const lost = power === "rage" ? ragePerSwing(mh, ctx.level) : 0;
    let n = Math.min(mhSwings, a.cooldown > 0 ? MINUTE / a.cooldown : Infinity);
    let limit: CastLimit = "swings";
    const per = (a.power === power ? a.cost : 0) + lost;
    if (limited && per > 0 && resource / per < n) {
      n = Math.max(0, resource / per);
      limit = "resource";
    }
    resource -= n * per;
    if (a.power === power) spent += n * a.cost;
    if (a.power === "mana") spent += n * a.cost;
    mhSwings -= n;
    push(entry, a, n, limit);
  }

  // white damage
  const white: RotationResult["white"] = {};
  const castTime = casts.reduce((s, c) => s + c.perMinute * (c.ability.castTime + c.ability.channelTime), 0);
  if (mh) white.mainHand = line(mh, mhSwings);
  if (oh) white.offHand = line(oh, MINUTE / oh.speed);
  if (ranged) white.ranged = line(ranged, (MINUTE / ranged.speed) * Math.max(0, 1 - castTime / MINUTE));

  // self-buff procs (section 6.7): Seal of Command (melee auto attacks, 7 PPM)
  const extras: { label: string; dps: number }[] = [];

  const soc = ctx.selfBuffs.find((s) => s.name === "Seal of Command");
  if (soc && white.mainHand) procLine(soc, white.mainHand, casts, ctx);
  // Windfury Weapon: extra main-hand attacks with bonus attack power
  const wf = ctx.selfBuffs.some((s) => s.name === "Windfury Weapon");
  const wfWhite = wf && white.mainHand ? evaluateWhite(ctx, "mainHand", WINDFURY.attackPower) : null;
  if (wfWhite && white.mainHand) {
    const procs = (white.mainHand.swingsPerMinute * white.mainHand.white.hitChance * WINDFURY.chance) / 10000;
    extras.push({
      label: "Windfury Weapon",
      dps: (procs * WINDFURY.attacks * wfWhite.expectedPerSwing) / MINUTE,
    });
  }
  for (const fx of effects) if (fx.extraDps) extras.push({ label: fx.label, dps: fx.extraDps });

  const whiteDps = Object.values(white).reduce((s, w) => s + (w?.dps ?? 0), 0);
  const dps = casts.reduce((s, c) => s + c.dps, 0) + whiteDps + extras.reduce((s, x) => s + x.dps, 0);
  const manaPerSecond = power === "mana" || !limited ? spent / MINUTE : 0;
  const mana = ctx.stats.mana?.value ?? 0;
  return {
    rotation,
    power,
    casts,
    white,
    extras,
    dps,
    timeUsedPct: ((MINUTE - time) / MINUTE) * 100,
    resource: limited && power ? { power, incomePerMinute: income, spentPerMinute: income - resource } : null,
    manaPerSecond,
    oomSeconds: manaPerSecond > 0 && mana > 0 ? mana / manaPerSecond : null,
    skipped,
  };
}

function line(w: WhiteResult, swings: number): WhiteLine {
  return { white: w, swingsPerMinute: swings, dps: (swings * w.expectedPerSwing) / MINUTE };
}

/** Seal of Command: the proc spell (aura 42 trigger) on landed main-hand auto attacks at SEAL_OF_COMMAND_PPM. */
function procLine(seal: Spell, mh: WhiteLine, casts: CastLine[], ctx: DamageContext): void {
  const id = seal.effects.find((e) => e.effect === 6 && e.aura === 42)?.triggerSpell;
  const proc = id ? ctx.book.spells.get(id) : undefined;
  if (!proc) return;
  const a = evaluateAbility({ ability: "Seal of Command (proc)", kind: "cooldown" }, ctx, proc);
  if (!a.available) return;
  const speed = ctx.stats.weapons.mainHand?.speed ?? 0;
  const perMinute =
    mh.swingsPerMinute * (mh.white.hitChance / 100) * ((SEAL_OF_COMMAND_PPM * speed) / MINUTE);
  const dmg = perMinute * a.expected;
  casts.push({
    key: a.key,
    entry: null,
    ability: a,
    perMinute,
    damagePerMinute: dmg,
    dps: dmg / MINUTE,
    limit: "procs",
  });
}

/** Evaluates every entry of a rotation (unavailable entries keep their reason). */
export function evaluateEntries(rotation: SpecRotation, ctx: DamageContext): RotationInput["evals"] {
  return rotation.entries.map((entry) => ({ entry, ability: evaluateAbility(entry, ctx) }));
}
