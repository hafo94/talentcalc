import type { AttackSlot, ClassToken, RotationEntry, SpecRotation, Spell } from "@/data/types";
import {
  evaluateAbility,
  evaluateWhite,
  learn,
  weaponInfo,
  type AbilityEval,
  type AbilityResult,
  type DamageContext,
  type PowerKind,
  type WhiteResult,
} from "@/engine/abilities";
import { WINDFURY } from "@/engine/combat";
import { evaluateDamage, prepareDamage, type Prepared } from "@/engine/rotation";
import { evaluateTarget, mapAura, type RankedTalent } from "@/engine/stats";
import { SPIRIT_REGEN, REGEN_TICK_SEC } from "./constants";
import { activeProcs, SIM_PROC_TALENTS, type ActiveProcs } from "./procs";
import type { SimInput } from "./types";

const APPLY_AURA = 6;
const ENERGIZE = 30;
const TRIGGER_SPELL = 64;
const AURA_PERIODIC_ENERGIZE = 24;
const AURA_POWER_REGEN_PCT = 110;
const AURA_REGEN_WHILE_CASTING = 134;
const TARGET_CASTER = 1;
const POWER: Readonly<Record<number, PowerKind>> = { 0: "mana", 1: "rage", 2: "focus", 3: "energy" };

/** A player buff the simulator tracks: a burst cooldown, a buff finisher (Slice and Dice) or a proc (Clearcasting). */
export interface BuffDef {
  index: number;
  name: string;
  spell: Spell | null; // passed to prepareDamage while active (null: the simulator applies the effect itself)
  stateful: boolean; // changes ability evaluation (stat, damage-done or spell-modifier auras)
  durationSec: number; // Infinity: until its charges are used
  charges: number; // 0: none; a cast whose spell matches one of `masks` uses a charge
  masks: [number, number, number, number][];
  maxStacks: number;
  regenPct: Partial<Record<PowerKind, number>>; // aura 110: +% regeneration of a power
  castRegenPct: number; // aura 134: % of mana regeneration that continues while casting
  energize: { power: PowerKind; amount: number } | null; // effect 30 on use (Bloodrage: +10 rage)
  periodicEnergize: { power: PowerKind; amount: number; periodSec: number; ticks: number } | null; // aura 24
}

export interface SimEntry {
  index: number;
  entry: RotationEntry;
  buff: BuffDef | null; // burst cooldowns and buff finishers
  requires: number; // index of the entry whose DoT must be active (-1: none)
  talentOk: boolean; // requiresTalent satisfied
  explicitAuraLeft: boolean; // the entry has its own auraLeft condition (replaces the implicit refresh rule)
  skip: boolean; // a builder that is not the rotation's builder (like the analytical model: the first learned one)
}

/** Abilities and white attacks evaluated with one set of active buffs (memoized per set). */
export interface StateEval {
  key: string;
  ctx: DamageContext;
  abilities: AbilityEval[]; // per entry (finishers at entry.cp)
  finisherAt(entryIndex: number, cp: number): AbilityEval;
  white: Record<AttackSlot, WhiteResult | null>;
  whiteSpread: Record<AttackSlot, number>; // half range of a normal white hit (uniform weapon roll)
  windfury: WhiteResult | null;
  sealOfCommand: AbilityResult | null;
  extraDps: { label: string; dps: number }[]; // averaged handlers (expected values)
  ragePerSec: number; // averaged handlers (Dual Wield Specialization)
}

export interface ActiveBuffKey {
  def: BuffDef;
  stacks: number;
}

export interface SimModel {
  input: SimInput;
  token: ClassToken;
  level: number;
  rotation: SpecRotation;
  power: PowerKind | null;
  entries: SimEntry[];
  buffs: BuffDef[];
  procs: ActiveProcs;
  prepared: Prepared; // base state
  maxMana: number;
  spiritRegenPerSec: number; // outside the five-second rule
  castRegenPct: number; // talents (aura 134): % of Spirit regeneration while casting
  averaged: string[];
  modeled: string[];
  state(active: readonly ActiveBuffKey[]): StateEval;
  stateCount(): number;
}

/** Caster auras of a buff spell that change ability evaluation (same mapper as the Phase 4 self-buffs). */
function isStateful(spell: Spell): boolean {
  return spell.effects.some((e) => {
    if (e.effect !== APPLY_AURA || (e.targets && e.targets[0] !== TARGET_CASTER)) return false;
    if (e.aura === 107 || e.aura === 108) return true;
    const m = mapAura(e, e.base);
    return m.kind === "stat" || m.kind === "damageDone";
  });
}

export function buffDef(index: number, spell: Spell, book: Prepared["book"], name = spell.name): BuffDef {
  const regenPct: Partial<Record<PowerKind, number>> = {};
  let castRegenPct = 0;
  let energize: BuffDef["energize"] = null;
  let periodicEnergize: BuffDef["periodicEnergize"] = null;
  const amount = (power: PowerKind, base: number) => (power === "rage" ? base / 10 : base);
  for (const e of spell.effects) {
    if (e.effect === APPLY_AURA && e.aura === AURA_POWER_REGEN_PCT && e.base !== 0) {
      const p = POWER[e.misc[0]];
      if (p) regenPct[p] = (regenPct[p] ?? 0) + e.base;
    }
    if (e.effect === APPLY_AURA && e.aura === AURA_REGEN_WHILE_CASTING) castRegenPct += e.base;
    if (e.effect === ENERGIZE && POWER[e.misc[0]])
      energize = { power: POWER[e.misc[0]]!, amount: amount(POWER[e.misc[0]]!, e.base) };
    if (e.effect === TRIGGER_SPELL && e.triggerSpell) {
      const t = book.spells.get(e.triggerSpell);
      const pe = t?.effects.find((x) => x.effect === APPLY_AURA && x.aura === AURA_PERIODIC_ENERGIZE);
      const p = pe ? POWER[pe.misc[0]] : undefined;
      if (t && pe && p && pe.periodMs && t.duration && t.duration.ms > 0)
        periodicEnergize = {
          power: p,
          amount: amount(p, pe.base),
          periodSec: pe.periodMs / 1000,
          ticks: Math.floor(t.duration.ms / pe.periodMs),
        };
    }
  }
  const dur = spell.duration?.ms ?? 0;
  const charges = spell.proc?.charges ?? 0;
  return {
    index,
    name,
    spell,
    stateful: isStateful(spell),
    durationSec: dur > 0 ? dur / 1000 : charges > 0 ? Infinity : 0,
    charges,
    masks: spell.effects
      .filter((e) => e.effect === APPLY_AURA && (e.aura === 107 || e.aura === 108))
      .map((e) => e.mask),
    maxStacks: Math.max(1, spell.maxStacks),
    regenPct,
    castRegenPct,
    energize,
    periodicEnergize,
  };
}

const noBuffFlags = (r: SpecRotation): SpecRotation => ({
  ...r,
  entries: r.entries.map((e) => {
    const rest = { ...e };
    delete rest.buff;
    return rest;
  }),
});

/**
 * Builds the simulator's view of a character (section 4.3): the base Phase 4 preparation, one BuffDef per burst
 * cooldown / buff finisher / proc buff, and a memoized evaluation per set of active buffs. Every damage number comes
 * from evaluateDamage/evaluateAbility/evaluateWhite (the sim never re-implements a formula).
 */
export function buildModel(input: SimInput): SimModel {
  const { prepare, rotation } = input;
  const level = prepare.level;
  // Buff finishers (Slice and Dice) are dynamic in the simulator: prepareDamage must not apply them permanently.
  const prepRotation = noBuffFlags(rotation);
  const prepared = prepareDamage({ ...prepare, rotation: prepRotation });
  const book = prepared.book;
  const talents: readonly RankedTalent[] = prepare.talents;
  const rank = (name: string) => talents.find((t) => t.talent.name === name)?.rank ?? 0;
  const procs = activeProcs(prepared, talents, prepare.weapons, rotation);

  const buffs: BuffDef[] = [];
  const addBuff = (spell: Spell, name?: string) => {
    const existing = buffs.find((b) => b.name === (name ?? spell.name));
    if (existing) return existing;
    const b = buffDef(buffs.length, spell, book, name);
    buffs.push(b);
    return b;
  };
  const learned = (name: string) => {
    const l = learn(book, name, level, talents, prepare.classTalents);
    return "spell" in l ? l.spell : null;
  };
  // Combustion (talent 11129) stacks its trigger spell 28682 (+10% Fire crit per stack) until 3 Fire crits.
  const combustion = procs.combustion ? addBuff(procs.combustion.spell, "Combustion") : null;
  if (combustion && procs.combustion) {
    combustion.durationSec = Infinity;
    procs.combustion.buff = combustion;
  }
  const entries: SimEntry[] = rotation.entries.map((entry, index) => {
    const spell = entry.kind === "burst" || entry.buff ? learned(entry.ability) : null;
    return {
      index,
      entry,
      buff: entry.ability === "Combustion" && combustion ? combustion : spell ? addBuff(spell) : null,
      requires: entry.requires ? rotation.entries.findIndex((e) => e.ability === entry.requires) : -1,
      talentOk: !entry.requiresTalent || rank(entry.requiresTalent) > 0,
      explicitAuraLeft: (entry.conditions ?? []).some((c) => c.type === "auraLeft"),
      skip: false,
    };
  });
  if (procs.clearcasting) procs.clearcasting.buff = addBuff(procs.clearcasting.spell);

  const cache = new Map<string, StateEval>();
  const dualWield = prepared.assembled.input.weapons.offHand !== null;
  const simHandled = (id: number) => SIM_PROC_TALENTS.has(id);

  const build = (active: readonly ActiveBuffKey[], key: string): StateEval => {
    const extra: Spell[] = [];
    for (const a of active)
      if (a.def.stateful && a.def.spell) for (let i = 0; i < a.stacks; i++) extra.push(a.def.spell);
    const p = extra.length
      ? prepareDamage({ ...prepare, rotation: prepRotation, extraBuffs: extra })
      : prepared;
    const view = evaluateTarget(p.stats, input.target, input.armorFormula, dualWield);
    const r = evaluateDamage({
      level,
      stats: p.stats,
      view,
      book: p.book,
      weapons: p.assembled.input.weapons,
      rotation,
      talents,
      classTalents: prepare.classTalents,
      spellMods: p.assembled.mapping.spellMods,
      selfBuffs: p.selfBuffs,
      handlers: p.handlers.filter((h) => !simHandled(h.handler.spellId)),
    });
    const ctx = r.ctx;
    const melee = rotation.melee;
    const white: StateEval["white"] = {
      mainHand: melee ? evaluateWhite(ctx, "mainHand") : null,
      offHand: melee && ctx.form !== "cat" ? evaluateWhite(ctx, "offHand") : null,
      ranged: rotation.autoShot ? evaluateWhite(ctx, "ranged") : null,
    };
    const spread = (slot: AttackSlot): number => {
      const w = weaponInfo(ctx, slot);
      const res = white[slot];
      return w && res && w.perSwing > 0 ? (w.spread * res.normalHit) / w.perSwing : 0;
    };
    const finishers = new Map<string, AbilityEval>();
    const soc = procs.sealOfCommand
      ? evaluateAbility({ ability: "Seal of Command (proc)", kind: "cooldown" }, ctx, procs.sealOfCommand)
      : null;
    return {
      key,
      ctx,
      abilities: r.abilities,
      finisherAt(i, cp) {
        const k = `${i}:${cp}`;
        let a = finishers.get(k);
        if (!a) {
          a = evaluateAbility({ ...rotation.entries[i]!, cp }, ctx);
          finishers.set(k, a);
        }
        return a;
      },
      white,
      whiteSpread: { mainHand: spread("mainHand"), offHand: spread("offHand"), ranged: spread("ranged") },
      windfury:
        procs.windfury && white.mainHand ? evaluateWhite(ctx, "mainHand", WINDFURY.attackPower) : null,
      sealOfCommand: soc && soc.available ? soc : null,
      extraDps: r.effects.filter((e) => e.extraDps).map((e) => ({ label: e.label, dps: e.extraDps! })),
      ragePerSec: r.effects.reduce((a, e) => a + (e.ragePerMinute ?? 0), 0) / 60,
    };
  };

  const base = build([], "");
  cache.set("", base);
  const builder = entries.find((e) => e.entry.kind === "builder" && base.abilities[e.index]!.available);
  for (const e of entries) e.skip = e.entry.kind === "builder" && e !== builder;
  const first = base.abilities.find((a): a is AbilityResult => a.available && a.power !== null);
  const power: PowerKind | null =
    first?.power ?? (prepared.stats.mana && prepared.stats.mana.value > 0 ? "mana" : null);
  const spirit = SPIRIT_REGEN[prepare.classToken];
  const castRegenPct = prepare.talents.reduce((sum, t) => {
    const vals = t.talent.ranks[t.rank - 1]?.values ?? [];
    return (
      sum +
      t.talent.effects.reduce(
        (s, e, pos) =>
          s + (e.effect === APPLY_AURA && e.aura === AURA_REGEN_WHILE_CASTING ? (vals[pos] ?? 0) : 0),
        0,
      )
    );
  }, 0);
  const averaged = prepared.handlers
    .filter((h) => !simHandled(h.handler.spellId) && (h.handler.rotation || h.handler.ability))
    .map((h) => `${h.args.label}: ${h.handler.modeled}`);
  return {
    input,
    token: prepare.classToken,
    level,
    rotation,
    power,
    entries,
    buffs,
    procs,
    prepared,
    maxMana: prepared.stats.mana?.value ?? 0,
    spiritRegenPerSec: (spirit.flat + spirit.perSpirit * prepared.stats.primary.spi.value) / REGEN_TICK_SEC,
    castRegenPct,
    averaged,
    modeled: procs.labels,
    state(active) {
      if (active.length === 0) return base;
      const key = active
        .filter((a) => a.def.stateful)
        .map((a) => `${a.def.index}x${a.stacks}`)
        .sort()
        .join(",");
      let s = cache.get(key);
      if (!s) {
        s = build(active, key);
        cache.set(key, s);
      }
      return s;
    },
    stateCount: () => cache.size,
  };
}
