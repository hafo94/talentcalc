import type { AttackSlot, School } from "@/data/types";
import {
  familyMatches,
  weaponInfo,
  type AbilityEval,
  type AbilityResult,
  type DamagePart,
  type WhiteResult,
} from "@/engine/abilities";
import {
  ENERGY_PER_SECOND,
  RAGE_PER_DAMAGE_FACTOR,
  SEAL_OF_COMMAND_PPM,
  WINDFURY,
  primarySchool,
  rageConversion,
  schoolsOf,
} from "@/engine/combat";
import { EXECUTE_ONLY, EXECUTE_PHASE_PCT, conditionsHold, type ConditionState } from "@/engine/rotation";
import {
  COMBUSTION_CRITS,
  DEEP_WOUNDS,
  EXECUTE_DAMAGE_PER_RAGE,
  FIVE_SECOND_RULE_SEC,
  FLURRY_SWINGS,
  IGNITE,
  IMPROVED_SHADOW_BOLT_SEC,
  MAX_COMBO_POINTS,
  MAX_ENERGY,
  MAX_RAGE,
  POLL_SEC,
  SHADOW_TRANCE_SEC,
  START_RAGE,
  TIMELINE_STEP_SEC,
} from "./constants";
import type { ActiveBuffKey, BuffDef, SimModel, StateEval } from "./model";
import { EventQueue } from "./queue";
import type { Rng } from "./rng";
import type { SimConfig, SimLogLine } from "./types";

/** Event types (SimEvent.type). a/b: SWING slot; CAST_END -; TICK dot slot + generation; BUFF_EXPIRE buff + generation. */
export const EV = {
  SWING: 1,
  CAST_END: 2,
  TICK: 3,
  CHANNEL_TICK: 4,
  BUFF_EXPIRE: 5,
  WAKE: 6,
  RAGE_TICK: 7,
  ENERGIZE_TICK: 8,
} as const;
const SLOTS: readonly AttackSlot[] = ["mainHand", "offHand", "ranged"];
const EPS = 1e-9;

/** Per-source sums over all iterations (run.ts divides by the iteration count). */
export interface SourceAcc {
  school: School;
  damage: number;
  casts: number;
  hits: number;
  crits: number;
  misses: number;
  ticks: number;
  averaged: boolean;
}
export type Accumulator = Map<string, SourceAcc>;

export interface FightTrace {
  log: SimLogLine[];
  logLimit: number;
  timeline: [number, number][];
}
export interface FightTotals {
  damage: number;
  idleSec: number;
  oomSec: number;
}

interface Dot {
  name: string;
  source: string;
  active: boolean;
  gen: number;
  expires: number;
  ticksLeft: number;
  periodSec: number;
  perTick: number;
  crit: number; // % per tick
  critMult: number;
  schoolMask: number;
  pool: number; // Ignite: unticked damage
}
interface BuffInstance {
  def: BuffDef;
  expires: number;
  charges: number;
  stacks: number;
  crits: number; // Combustion
  gen: number;
}
interface Channel {
  entry: number;
  a: AbilityResult;
  part: DamagePart | null;
  landed: boolean; // periodic channels roll once (Mind Flay); missiles roll per hit
  ticksLeft: number;
  source: string;
}
interface Casting {
  gen: number;
  entry: number;
  a: AbilityResult; // evaluated with the buffs active when the cast started
}

const hasSchool = (mask: number, s: School) => schoolsOf(mask).includes(s);

/**
 * One fight (section 4.4). Time is in seconds; events at or after `fightSec` are not processed. The player acts after
 * every event: the first entry (top to bottom) that is usable is cast; off-GCD casts let the walk continue.
 */
export class Fight implements ConditionState {
  private q = new EventQueue();
  private t = 0;
  private readonly T: number;
  private readonly n: number;
  // player
  private busyUntil = 0;
  private gcdUntil = 0;
  private casting: Casting | null = null;
  private castGen = 0;
  private channel: Channel | null = null;
  private channelGen = 0;
  private readonly cdReady: Float64Array;
  private readonly categoryReady = new Map<number, number>();
  private readonly lastCast: Float64Array;
  private queuedSwing = -1;
  private rangedGen = 0;
  private pendingWake = Infinity;
  // resources
  resource = 0;
  comboPoints = 0;
  private readonly maxResource: number;
  private lastManaSpend = -Infinity;
  private lastAdvance = 0;
  // auras
  private readonly buffs: (BuffInstance | null)[];
  private buffGen = 0;
  private stateDirty = true;
  private current: StateEval;
  private readonly dots: Dot[];
  private readonly igniteSlot: number;
  private readonly deepWoundsSlot: number;
  private flurryCharges = 0;
  private shadowTranceUntil = -1;
  private isbUntil = -1;
  // stats
  private total = 0;
  private idleSince = -1;
  private oomSince = -1;
  private idleSec = 0;
  private oomSec = 0;
  private lastSample = -Infinity;

  constructor(
    private readonly model: SimModel,
    private readonly config: SimConfig,
    private readonly rng: Rng,
    private readonly acc: Accumulator,
    private readonly trace: FightTrace | null,
  ) {
    this.T = config.fightSec;
    this.n = model.entries.length;
    this.cdReady = new Float64Array(this.n);
    this.lastCast = new Float64Array(this.n).fill(-Infinity);
    this.buffs = model.buffs.map(() => null);
    this.current = model.state([]);
    const dot = (name: string): Dot => ({
      name,
      source: name,
      active: false,
      gen: 0,
      expires: 0,
      ticksLeft: 0,
      periodSec: 0,
      perTick: 0,
      crit: 0,
      critMult: 1,
      schoolMask: 1,
      pool: 0,
    });
    this.dots = model.entries.map((e) => dot(e.entry.ability));
    this.igniteSlot = this.dots.length;
    this.dots.push(dot("Ignite"));
    this.deepWoundsSlot = this.dots.length;
    this.dots.push(dot("Deep Wounds"));
    const p = model.power;
    this.maxResource =
      p === "mana" ? model.maxMana : p === "rage" ? MAX_RAGE : p === "energy" ? MAX_ENERGY : 0;
    this.resource = p === "rage" ? START_RAGE : this.maxResource;
  }

  // ---- ConditionState ----
  get power() {
    return this.model.power;
  }
  get maxMana() {
    return this.model.maxMana;
  }
  get targetHpPct() {
    return Math.max(0, 100 * (1 - this.t / this.T));
  }
  get timeLeft() {
    return Math.max(0, this.T - this.t);
  }
  auraLeft(i: number): number {
    const se = this.model.entries[i];
    if (!se) return 0;
    if (se.buff) {
      const b = this.buffs[se.buff.index];
      return b ? Math.max(0, b.expires - this.t) : 0;
    }
    if (se.entry.kind === "maintain") {
      const every = se.entry.everySec ?? 0;
      return Math.max(0, this.lastCast[i]! + every - this.t);
    }
    const d = this.dots[i]!;
    return d.active ? Math.max(0, d.expires - this.t) : 0;
  }
  auraActive(name: string): boolean {
    if (name === "Flurry") return this.flurryCharges > 0;
    if (name === "Shadow Trance") return this.shadowTranceUntil > this.t;
    if (name === "Improved Shadow Bolt") return this.isbUntil > this.t;
    for (const b of this.buffs) if (b && b.def.name === name) return true;
    for (const d of this.dots) if (d.active && d.name === name) return true;
    return false;
  }
  cooldownReady(ability: string): boolean {
    const i = this.model.entries.findIndex((e) => e.entry.ability === ability);
    return i < 0 || this.cdReady[i]! <= this.t + EPS;
  }

  // ---- main loop ----
  run(): FightTotals {
    const m = this.model;
    const st = this.current;
    if (m.rotation.melee && st.white.mainHand) this.q.push(0, EV.SWING, 0);
    if (m.rotation.melee && st.white.offHand) this.q.push(0, EV.SWING, 1);
    if (m.rotation.autoShot && st.white.ranged) this.q.push(0, EV.SWING, 2);
    if (m.procs.angerManagement && m.power === "rage")
      this.q.push(m.procs.angerManagement.periodSec, EV.RAGE_TICK);
    this.sample();
    this.act();
    for (;;) {
      const e = this.q.pop();
      if (!e || e.t >= this.T) break;
      this.advance(e.t);
      switch (e.type) {
        case EV.SWING:
          if (e.a !== 2 || e.b === this.rangedGen) this.swing(e.a);
          break;
        case EV.CAST_END:
          this.castEnd(e.a);
          break;
        case EV.TICK:
          this.tick(e.a, e.b);
          break;
        case EV.CHANNEL_TICK:
          this.channelTick(e.b);
          break;
        case EV.BUFF_EXPIRE: {
          const b = this.buffs[e.a];
          if (b && b.gen === e.b) this.removeBuff(e.a);
          break;
        }
        case EV.WAKE:
          if (e.t >= this.pendingWake - EPS) this.pendingWake = Infinity;
          break;
        case EV.RAGE_TICK: {
          const am = m.procs.angerManagement!;
          this.gain(am.amount, "Anger Management");
          this.q.push(e.t + am.periodSec, EV.RAGE_TICK);
          break;
        }
        case EV.ENERGIZE_TICK: {
          const def = m.buffs[e.a]!;
          const pe = def.periodicEnergize!;
          this.gain(pe.amount, def.name);
          if (e.b > 1) this.q.push(e.t + pe.periodSec, EV.ENERGIZE_TICK, e.a, e.b - 1);
          break;
        }
      }
      this.act();
      this.sample();
    }
    this.advance(this.T);
    this.t = this.T;
    if (this.idleSince >= 0) this.idleSec += this.T - this.idleSince;
    if (this.oomSince >= 0) this.oomSec += this.T - this.oomSince;
    for (const x of this.current.extraDps) this.deal(x.label, 1, x.dps * this.T, "hit", true);
    return { damage: this.total, idleSec: this.idleSec, oomSec: this.oomSec };
  }

  // ---- resources ----
  private regenPct(power: "mana" | "energy"): number {
    let p = 0;
    for (const b of this.buffs) if (b) p += b.def.regenPct[power] ?? 0;
    return p;
  }
  private castRegenPct(): number {
    let p = this.model.castRegenPct;
    for (const b of this.buffs) if (b) p += b.def.castRegenPct;
    return Math.min(100, p);
  }
  private manaRate(atFsr: boolean): number {
    const base = this.model.spiritRegenPerSec * (1 + this.regenPct("mana") / 100);
    return atFsr ? (base * this.castRegenPct()) / 100 : base;
  }
  private energyRate(): number {
    return ENERGY_PER_SECOND * (1 + this.regenPct("energy") / 100);
  }
  /** Continuous regeneration from the last advance to `to` (mana: five-second rule boundary inside). */
  private advance(to: number): void {
    const dt = to - this.lastAdvance;
    if (dt > 0) {
      const p = this.model.power;
      if (p === "energy") this.resource = Math.min(this.maxResource, this.resource + this.energyRate() * dt);
      else if (p === "rage" && this.current.ragePerSec > 0)
        this.resource = Math.min(this.maxResource, this.resource + this.current.ragePerSec * dt);
      else if (p === "mana" && this.resource < this.maxResource) {
        const fsrEnd = this.lastManaSpend + FIVE_SECOND_RULE_SEC;
        const from = this.lastAdvance;
        const inFsr = Math.max(0, Math.min(to, fsrEnd) - from);
        const gain = this.manaRate(true) * inFsr + this.manaRate(false) * (dt - inFsr);
        this.resource = Math.min(this.maxResource, this.resource + gain);
      }
    }
    this.lastAdvance = to;
    this.t = to;
  }
  private gain(amount: number, source: string): void {
    if (amount <= 0 || !this.model.power) return;
    this.resource = Math.min(this.maxResource, this.resource + amount);
    this.log(source, "gain", 0);
  }
  private pay(a: AbilityResult): boolean {
    const p = this.model.power;
    if (a.power !== p || a.cost <= 0) return true;
    if (p === "mana" && this.config.unlimitedMana) return true;
    if (this.resource + EPS < a.cost) return false;
    this.resource -= a.cost;
    if (p === "mana") this.lastManaSpend = this.t;
    return true;
  }
  private affordable(a: AbilityResult): boolean {
    const p = this.model.power;
    if (a.power !== p || a.cost <= 0) return true;
    if (p === "mana" && this.config.unlimitedMana) return true;
    return this.resource + EPS >= a.cost;
  }

  // ---- buffs ----
  private state(): StateEval {
    if (this.stateDirty) {
      const active: ActiveBuffKey[] = [];
      for (const b of this.buffs) if (b && b.def.stateful) active.push({ def: b.def, stacks: b.stacks });
      this.current = this.model.state(active);
      this.stateDirty = false;
    }
    return this.current;
  }
  private applyBuff(def: BuffDef, durationSec = def.durationSec, stacks = 1): void {
    const gen = ++this.buffGen;
    const expires = this.t + durationSec;
    this.buffs[def.index] = { def, expires, charges: def.charges, stacks, crits: 0, gen };
    if (Number.isFinite(expires)) this.q.push(expires, EV.BUFF_EXPIRE, def.index, gen);
    if (def.stateful) this.stateDirty = true;
    this.log(def.name, "buff", 0);
  }
  private removeBuff(index: number): void {
    const b = this.buffs[index];
    if (!b) return;
    this.buffs[index] = null;
    if (b.def.stateful) this.stateDirty = true;
    this.log(b.def.name, "fade", 0);
  }
  /** Charge buffs (Clearcasting, Presence of Mind, Cold Blood) are used by a matching cast. */
  private useCharges(a: AbilityResult): void {
    const set = this.model.prepared.book.classSet;
    for (const b of this.buffs) {
      if (!b || b.def.charges <= 0 || b.charges <= 0) continue;
      if (!b.def.masks.some((m) => familyMatches(m, a.spell, set))) continue;
      b.charges--;
      if (b.charges <= 0) this.removeBuff(b.def.index);
    }
  }

  // ---- decisions ----
  private evalFor(i: number, st: StateEval): AbilityEval {
    const e = this.model.entries[i]!.entry;
    if (e.kind !== "finisher") return st.abilities[i]!;
    return st.finisherAt(i, Math.max(1, Math.min(MAX_COMBO_POINTS, this.comboPoints)));
  }
  private castTimeOf(a: AbilityResult): number {
    if (a.key === "Shadow Bolt" && this.shadowTranceUntil > this.t) return 0;
    return a.castTime;
  }
  /** Usability of entry i now, ignoring the GCD (section 4.4 "implicit rules"). */
  private usable(i: number, st: StateEval, ignoreCost = false): AbilityResult | null {
    const se = this.model.entries[i]!;
    const e = se.entry;
    if (!se.talentOk || se.skip) return null;
    const a = this.evalFor(i, st);
    if (!a.available) return null;
    if (this.cdReady[i]! > this.t + EPS) return null;
    if (a.category && (this.categoryReady.get(a.category) ?? 0) > this.t + EPS) return null;
    if (se.requires >= 0 && !this.dots[se.requires]!.active) return null;
    switch (e.kind) {
      case "nextSwing":
        if (this.queuedSwing >= 0 || !this.current.white.mainHand) return null;
        break;
      case "dot":
        if (!se.explicitAuraLeft && this.auraLeft(i) > this.castTimeOf(a) + EPS) return null;
        break;
      case "maintain":
        if (this.auraLeft(i) > EPS) return null;
        break;
      case "builder":
        if (this.comboPoints >= MAX_COMBO_POINTS) return null;
        break;
      case "finisher":
        if (this.comboPoints < (e.cp ?? MAX_COMBO_POINTS)) return null;
        if ((e.buff || a.expectedPeriodic > 0) && !se.explicitAuraLeft && this.auraLeft(i) > EPS) return null;
        break;
      case "burst":
        if (se.buff && this.buffs[se.buff.index]) return null;
        break;
      default:
        break;
    }
    if (!ignoreCost && !this.affordable(a)) return null;
    if (!conditionsHold(e, this, i)) return null;
    return a;
  }

  private act(): void {
    // Busy = a cast or channel is pending (not a time test: another event can fire at the exact cast-end time first).
    if (this.t >= this.T || this.casting || this.channel) return;
    let manaBlocked = false;
    for (let guard = 0; guard < 16; guard++) {
      const st = this.state();
      let picked = -1;
      let pickedA: AbilityResult | null = null;
      manaBlocked = false;
      let pooling = false;
      for (let i = 0; i < this.n; i++) {
        const raw = this.evalFor(i, st);
        const kind = this.model.entries[i]!.entry.kind;
        const onGcd = raw.available && raw.gcd > 0 && kind !== "nextSwing";
        if (onGcd && this.gcdUntil > this.t + EPS) continue;
        // L8: a finisher that waits for its resource keeps the combo points (no cheaper finisher steals them)
        const pools = kind === "finisher";
        if (pooling && pools) continue;
        const a = this.usable(i, st);
        if (!a) {
          if (raw.available && this.model.power === "mana" && !this.affordable(raw)) manaBlocked = true;
          if (pools && this.usable(i, st, true)) pooling = true;
          continue;
        }
        picked = i;
        pickedA = a;
        break;
      }
      if (picked < 0 || !pickedA) break;
      this.endIdle();
      this.cast(picked, pickedA);
      if (this.casting || this.channel) return;
    }
    if (this.gcdUntil <= this.t + EPS) {
      if (this.idleSince < 0) this.idleSince = this.t;
      if (manaBlocked && this.oomSince < 0) this.oomSince = this.t;
    }
    this.scheduleWake();
  }
  private endIdle(): void {
    if (this.idleSince >= 0) this.idleSec += this.t - this.idleSince;
    if (this.oomSince >= 0) this.oomSec += this.t - this.oomSince;
    this.idleSince = -1;
    this.oomSince = -1;
  }

  /** Earliest time something can become usable without another event (cooldowns, GCD, regeneration, timers). */
  private scheduleWake(): void {
    const t = this.t;
    let w = Infinity;
    const at = (x: number) => {
      if (x > t + EPS && x < w) w = x;
    };
    at(this.gcdUntil);
    const p = this.model.power;
    const rate =
      p === "energy"
        ? this.energyRate()
        : p === "mana"
          ? this.manaRate(t < this.lastManaSpend + FIVE_SECOND_RULE_SEC)
          : 0;
    if (p === "mana") at(this.lastManaSpend + FIVE_SECOND_RULE_SEC);
    let timed = false;
    for (let i = 0; i < this.n; i++) {
      const se = this.model.entries[i]!;
      at(this.cdReady[i]!);
      const a = this.evalFor(i, this.current);
      if (a.available && a.category) at(this.categoryReady.get(a.category) ?? 0);
      if (a.available && rate > 0 && a.power === p && a.cost > this.resource)
        at(t + (a.cost - this.resource) / rate);
      if (se.entry.kind === "dot" || se.entry.kind === "maintain" || se.buff) {
        const left = this.auraLeft(i);
        if (left > 0) at(t + left - (a.available && se.entry.kind === "dot" ? this.castTimeOf(a) : 0));
      }
      if (EXECUTE_ONLY.has(se.entry.ability)) at(this.T * (1 - EXECUTE_PHASE_PCT / 100) + EPS);
      for (const c of se.entry.conditions ?? []) {
        if (c.type === "targetHp") at(this.T * (1 - c.value / 100) + EPS);
        else if (c.type === "timeLeft") at(this.T - c.value + EPS);
        else if (c.type === "auraLeft" || c.type === "aura" || c.type === "cooldown") timed = true;
      }
    }
    if (timed) at(t + POLL_SEC);
    if (w < this.pendingWake && w < this.T) {
      this.pendingWake = w;
      this.q.push(w, EV.WAKE);
    }
  }

  // ---- casting ----
  private cast(i: number, a: AbilityResult): void {
    const se = this.model.entries[i]!;
    const e = se.entry;
    if (e.kind === "nextSwing") {
      this.queuedSwing = i; // cost is paid when the swing happens
      return;
    }
    const execRage = e.ability === "Execute" ? this.resource - a.cost : 0;
    this.pay(a);
    if (execRage > 0) this.resource -= execRage;
    if (a.energize > 0) this.gain(a.energize, a.key);
    if (a.cooldown > 0) this.cdReady[i] = this.t + a.cooldown;
    if (a.category && a.categoryCooldown > 0) this.categoryReady.set(a.category, this.t + a.categoryCooldown);
    if (a.gcd > 0) this.gcdUntil = this.t + a.gcd;
    this.lastCast[i] = this.t;
    const castTime = this.castTimeOf(a);
    if (a.key === "Shadow Bolt" && this.shadowTranceUntil > this.t) this.shadowTranceUntil = -1;
    this.useCharges(a);
    this.log(a.key, "cast", 0);
    if (se.buff) {
      const def = se.buff;
      const dur = e.kind === "finisher" ? a.durationSec : def.durationSec;
      this.applyBuff(def, dur, def === this.model.procs.combustion?.buff ? 0 : 1);
      if (def.energize && def.energize.power === this.model.power) this.gain(def.energize.amount, def.name);
      const pe = def.periodicEnergize;
      if (pe && pe.power === this.model.power)
        this.q.push(this.t + pe.periodSec, EV.ENERGIZE_TICK, def.index, pe.ticks);
    }
    if (castTime > EPS) {
      this.busyUntil = this.t + castTime;
      const gen = ++this.castGen;
      this.casting = { gen, entry: i, a };
      this.q.push(this.busyUntil, EV.CAST_END, gen);
      return;
    }
    if (a.channelTime > EPS) {
      this.startChannel(i, a);
      return;
    }
    this.resolve(i, a, execRage);
  }
  private castEnd(gen: number): void {
    const c = this.casting;
    if (!c || c.gen !== gen) return;
    this.casting = null;
    this.busyUntil = this.t;
    // src: Classic 1.12: a ranged cast (Aimed Shot) restarts the Auto Shot timer [VERIFY Q63]
    const ranged = this.current.white.ranged;
    if (c.a.kind === "ranged" && ranged && this.model.rotation.autoShot)
      this.q.push(this.t + ranged.speed, EV.SWING, 2, ++this.rangedGen);
    this.resolve(c.entry, c.a, 0);
  }

  private startChannel(i: number, a: AbilityResult): void {
    this.busyUntil = this.t + a.channelTime;
    const part =
      a.parts.find((p) => p.kind === "periodic") ?? a.parts.find((p) => p.count > 1) ?? a.parts[0] ?? null;
    const periodic = part?.kind === "periodic";
    const landed = part && periodic ? this.rng() * 100 < part.chances.land : true;
    if (!landed) this.miss(a.key, a.schoolMask);
    const ticks = part && part.count > 0 ? part.count : 1; // a channel without damage (Evocation) ends with one tick
    this.channel = { entry: i, a, part, landed, ticksLeft: ticks, source: a.key };
    const gen = ++this.channelGen;
    const period = a.channelTime / ticks;
    for (let k = 1; k <= ticks; k++) this.q.push(this.t + k * period, EV.CHANNEL_TICK, i, gen);
    this.count(a.key, a.schoolMask).casts++;
  }
  private channelTick(gen: number): void {
    const c = this.channel;
    if (!c || gen !== this.channelGen) return;
    c.ticksLeft--;
    if (c.ticksLeft <= 0) this.endChannel();
    const p = c.part;
    if (!p) return;
    if (p.kind === "periodic") {
      if (c.landed) {
        const crit = this.rng() * 100 < p.chances.crit;
        const dmg = p.perHit * (crit ? p.critMultiplier : 1);
        this.deal(c.source, c.a.schoolMask, dmg, crit ? "tickCrit" : "tick");
        this.afterPeriodic(c.source);
      }
    } else this.direct(c.a, p, c.source);
    if (this.channel === c && this.higherPriorityReady(c.entry)) this.endChannel(); // clip after a tick
  }
  private endChannel(): void {
    this.channel = null;
    this.channelGen++;
    this.busyUntil = this.t;
  }
  /** An entry above `entry` can be cast now (channel clipping, e.g. Mind Flay for Mind Blast). */
  private higherPriorityReady(entry: number): boolean {
    const st = this.state();
    for (let i = 0; i < entry; i++) {
      const raw = this.evalFor(i, st);
      if (!raw.available || this.model.entries[i]!.entry.kind === "nextSwing") continue;
      if (raw.gcd > 0 && this.gcdUntil > this.t + EPS) continue;
      if (this.usable(i, st)) return true;
    }
    return false;
  }

  /** Samples one direct hit of a part (two rolls: land, then crit). */
  private direct(
    a: AbilityResult,
    p: DamagePart,
    source: string,
    extraFactor = 1,
  ): { landed: boolean; crit: boolean } {
    if (this.rng() * 100 >= p.chances.land) {
      this.miss(source, a.schoolMask);
      return { landed: false, crit: false };
    }
    const crit = this.rng() * 100 < p.chances.crit;
    const base = p.range ? p.range[0] + this.rng() * (p.range[1] - p.range[0]) : p.perHit;
    const dmg = base * extraFactor * (crit ? p.critMultiplier : 1);
    const dealt = this.deal(source, a.schoolMask, dmg, crit ? "crit" : "hit");
    this.afterSpellHit(a, crit, dealt);
    if (a.kind !== "spell" && a.slot) this.weaponHit(a.slot, crit, false, false);
    return { landed: true, crit };
  }

  /** Resolves a cast's damage (instant or at cast end), combo points, DoTs and procs. */
  private resolve(i: number, a: AbilityResult, execRage: number): void {
    const se = this.model.entries[i]!;
    const e = se.entry;
    const src = a.key;
    this.count(src, a.schoolMask).casts++;
    const parts = a.parts;
    if (parts.length === 0) {
      if (e.kind === "finisher") this.spendCombo();
      return;
    }
    const execFactor =
      e.ability === "Execute" && execRage > 0
        ? 1 +
          (EXECUTE_DAMAGE_PER_RAGE * execRage) /
            Math.max(1, a.spell.effects.find((x) => x.effect === 3)?.base ?? 1)
        : 1;
    let landed = false;
    let firstCrit = false;
    let sawDirect = false;
    for (const p of parts) {
      if (p.kind !== "direct") continue;
      for (let k = 0; k < p.count; k++) {
        const r = this.direct(a, p, src, execFactor);
        if (!sawDirect) {
          landed = r.landed;
          firstCrit = r.crit;
          sawDirect = true;
        }
      }
    }
    const periodic = parts.find((p) => p.kind === "periodic");
    if (periodic) {
      if (!sawDirect) {
        landed = this.rng() * 100 < periodic.chances.land;
        if (!landed) this.miss(src, a.schoolMask);
      }
      if (landed) this.applyDot(i, a, periodic);
    }
    for (const x of a.extras) this.deal(x.label, a.schoolMask, x.value, "hit", true);
    if (e.kind === "builder" && landed && a.hitChance > 0) {
      const perHit = a.comboPoints / (a.hitChance / 100);
      let gain = Math.round(perHit);
      if (firstCrit && this.rng() * 100 < this.model.procs.sealFatePct) gain++;
      this.comboPoints = Math.min(MAX_COMBO_POINTS, this.comboPoints + gain);
    }
    if (e.kind === "finisher") this.spendCombo();
    if (a.kind === "spell" && landed) this.clearcasting(a);
  }
  private spendCombo(): void {
    this.comboPoints = 0;
    if (this.rng() * 100 < this.model.procs.ruthlessnessPct) this.comboPoints = 1;
  }
  private clearcasting(a: AbilityResult): void {
    const cc = this.model.procs.clearcasting;
    if (!cc || !cc.buff || a.expected <= 0) return;
    if (cc.schools && !cc.schools.some((s) => hasSchool(a.schoolMask, s))) return;
    if (this.rng() * 100 < cc.chance) this.applyBuff(cc.buff);
  }

  // ---- periodic damage ----
  private applyDot(i: number, a: AbilityResult, p: DamagePart): void {
    const d = this.dots[i]!;
    const period = a.periodSec > 0 ? a.periodSec : a.durationSec / Math.max(1, p.count);
    d.active = true;
    d.gen++;
    d.ticksLeft = p.count;
    d.periodSec = period;
    d.perTick = p.perHit;
    d.crit = p.chances.crit;
    d.critMult = p.critMultiplier;
    d.schoolMask = a.schoolMask;
    d.source = a.key;
    d.expires = this.t + period * p.count;
    this.q.push(this.t + period, EV.TICK, i, d.gen);
  }
  private tick(slot: number, gen: number): void {
    const d = this.dots[slot]!;
    if (!d.active || d.gen !== gen) return;
    d.ticksLeft--;
    if (slot === this.igniteSlot) {
      const dmg = d.pool / Math.max(1, d.ticksLeft + 1);
      d.pool -= dmg;
      this.deal("Ignite", 4, dmg, "tick");
    } else if (slot === this.deepWoundsSlot) {
      this.deal("Deep Wounds", 1, d.perTick, "tick");
    } else {
      const crit = this.rng() * 100 < d.crit;
      this.deal(d.source, d.schoolMask, d.perTick * (crit ? d.critMult : 1), crit ? "tickCrit" : "tick");
      this.afterPeriodic(d.source);
    }
    if (d.ticksLeft > 0) this.q.push(this.t + d.periodSec, EV.TICK, slot, gen);
    else d.active = false;
  }
  private afterPeriodic(source: string): void {
    const pr = this.model.procs;
    if (pr.nightfallPct > 0 && pr.nightfallSpells.has(source) && this.rng() * 100 < pr.nightfallPct) {
      this.shadowTranceUntil = this.t + SHADOW_TRANCE_SEC;
      this.log("Shadow Trance", "buff", 0);
    }
  }
  /** Rolling Ignite: the unticked damage plus the new burn, over two fresh ticks. */
  private ignite(amount: number): void {
    const d = this.dots[this.igniteSlot]!;
    if (!d.active) d.pool = 0;
    d.pool += amount;
    d.active = true;
    d.gen++;
    d.periodSec = IGNITE.periodSec;
    d.ticksLeft = Math.round(IGNITE.durationSec / IGNITE.periodSec);
    d.expires = this.t + IGNITE.durationSec;
    this.q.push(this.t + d.periodSec, EV.TICK, this.igniteSlot, d.gen);
  }
  private deepWounds(): void {
    const pct = this.model.procs.deepWoundsPct;
    const st = this.state();
    const w = weaponInfo(st.ctx, "mainHand");
    if (!w || pct <= 0) return;
    // same total as the Phase 4 handler: x% of the average main-hand swing, physical damage-done auras
    const physical = st.ctx.stats.damageDone
      .filter((e) => !e.schools || e.schools.includes("physical"))
      .filter((e) => !e.slots || e.slots.includes("mainHand"))
      .reduce((a, e) => a * (1 + e.value / 100), 1);
    const d = this.dots[this.deepWoundsSlot]!;
    const ticks = Math.round(DEEP_WOUNDS.durationSec / DEEP_WOUNDS.periodSec);
    d.active = true;
    d.gen++;
    d.ticksLeft = ticks;
    d.periodSec = DEEP_WOUNDS.periodSec;
    d.perTick = ((pct / 100) * w.perSwing * physical) / ticks;
    d.expires = this.t + DEEP_WOUNDS.durationSec;
    this.q.push(this.t + d.periodSec, EV.TICK, this.deepWoundsSlot, d.gen);
  }

  // ---- procs of landed hits ----
  private afterSpellHit(a: AbilityResult, crit: boolean, dealt: number): void {
    const pr = this.model.procs;
    if (a.kind !== "spell") return;
    const fire = hasSchool(a.schoolMask, "fire");
    if (crit && fire && pr.ignitePct > 0) this.ignite((dealt * pr.ignitePct) / 100);
    if (crit && a.key === "Shadow Bolt" && pr.isbPct > 0) {
      this.isbUntil = this.t + IMPROVED_SHADOW_BOLT_SEC;
      this.log("Improved Shadow Bolt", "buff", 0);
    }
    const comb = pr.combustion?.buff;
    if (fire && comb) {
      const b = this.buffs[comb.index];
      if (b) {
        if (crit && ++b.crits >= COMBUSTION_CRITS) this.removeBuff(comb.index);
        else if (b.stacks < comb.maxStacks) {
          b.stacks++;
          this.stateDirty = true;
        }
      }
    }
  }
  /** Melee weapon hit procs (white swings and melee abilities). `extra`: Windfury/extra attacks cannot chain. */
  private weaponHit(slot: AttackSlot, crit: boolean, white: boolean, extra: boolean): void {
    const pr = this.model.procs;
    if (slot === "ranged") return;
    if (crit && pr.flurryPct > 0) this.flurryCharges = FLURRY_SWINGS;
    if (crit && pr.deepWoundsPct > 0) this.deepWounds();
    if (pr.unbridledWrathPct > 0 && this.rng() * 100 < pr.unbridledWrathPct) this.gain(1, "Unbridled Wrath");
    if (slot !== "mainHand" || extra) return;
    const st = this.state();
    if (pr.extraAttackPct > 0 && this.rng() * 100 < pr.extraAttackPct) this.whiteSwing(0, st, true, false);
    if (!white) return;
    if (st.windfury && this.rng() * 100 < WINDFURY.chance)
      for (let k = 0; k < WINDFURY.attacks; k++) this.whiteSwing(0, st, true, true);
    if (st.sealOfCommand) {
      const speed = st.ctx.stats.weapons.mainHand?.speed ?? 0;
      if (this.rng() * 60 < SEAL_OF_COMMAND_PPM * speed) {
        const soc = st.sealOfCommand;
        this.count(soc.key, soc.schoolMask).casts++;
        for (const p of soc.parts) if (p.kind === "direct") this.direct(soc, p, soc.key);
      }
    }
  }

  // ---- white attacks ----
  private swing(slotIndex: number): void {
    const st = this.state();
    const slot = SLOTS[slotIndex]!;
    const w = st.white[slot];
    if (!w) return;
    if (slot === "ranged" && this.busyUntil > this.t + EPS) {
      this.q.push(this.busyUntil, EV.SWING, slotIndex, this.rangedGen); // Auto Shot waits for the cast to finish
      return;
    }
    let done = false;
    if (slot === "mainHand" && this.queuedSwing >= 0) {
      const i = this.queuedSwing;
      this.queuedSwing = -1;
      const a = st.abilities[i]!;
      if (a.available && this.affordable(a) && conditionsHold(this.model.entries[i]!.entry, this, i)) {
        this.pay(a);
        this.cdReady[i] = this.t + a.cooldown;
        this.resolve(i, a, 0);
        done = true;
      }
    }
    if (!done) this.whiteSwing(slotIndex, st, false, false);
    let speed = w.speed;
    if (slot !== "ranged" && this.flurryCharges > 0) {
      speed /= 1 + this.model.procs.flurryPct / 100;
      this.flurryCharges--;
    }
    this.q.push(this.t + speed, EV.SWING, slotIndex, slot === "ranged" ? this.rangedGen : 0);
  }
  /** One white attack from the single-roll table; extra attacks (Windfury, sword talents) use `extra`. */
  private whiteSwing(slotIndex: number, st: StateEval, extra: boolean, windfury: boolean): void {
    const slot = SLOTS[slotIndex]!;
    const w: WhiteResult | null = windfury ? st.windfury : st.white[slot];
    if (!w) return;
    const source = windfury ? "Windfury Weapon" : extra ? `${w.name} (extra)` : w.name;
    const acc = this.count(source, 1);
    acc.casts++;
    const r = this.rng() * 100;
    const miss = 100 - w.hitChance;
    if (r < miss) {
      this.miss(source, 1);
      return;
    }
    const spread = windfury ? 0 : st.whiteSpread[slot];
    const base = w.normalHit + (spread > 0 ? (this.rng() * 2 - 1) * spread : 0);
    let dmg = base;
    let outcome: "hit" | "crit" | "glance" = "hit";
    if (r < miss + w.glancing) {
      dmg = base * w.glancingMultiplier;
      outcome = "glance";
    } else if (r < miss + w.glancing + w.critChance) {
      dmg = base * 2; // PHYSICAL_CRIT_BONUS 1.0 (whiteTable with critDamageMult 1)
      outcome = "crit";
    }
    const dealt = this.deal(source, 1, dmg, outcome);
    if (this.model.power === "rage" && slot !== "ranged")
      this.gain((RAGE_PER_DAMAGE_FACTOR * dealt) / rageConversion(this.model.level), "");
    this.weaponHit(slot, outcome === "crit", true, extra);
  }

  // ---- bookkeeping ----
  private targetMult(mask: number): number {
    return this.isbUntil > this.t && hasSchool(mask, "shadow") ? 1 + this.model.procs.isbPct / 100 : 1;
  }
  private count(source: string, mask: number): SourceAcc {
    let a = this.acc.get(source);
    if (!a) {
      a = {
        school: primarySchool(mask),
        damage: 0,
        casts: 0,
        hits: 0,
        crits: 0,
        misses: 0,
        ticks: 0,
        averaged: false,
      };
      this.acc.set(source, a);
    }
    return a;
  }
  private deal(
    source: string,
    mask: number,
    raw: number,
    outcome: SimLogLine["outcome"],
    averaged = false,
  ): number {
    const dmg = averaged ? raw : raw * this.targetMult(mask);
    const a = this.count(source, mask);
    a.damage += dmg;
    if (averaged) a.averaged = true;
    else if (outcome === "tick" || outcome === "tickCrit") a.ticks++;
    else a.hits++;
    if (outcome === "crit" || outcome === "tickCrit") a.crits++;
    this.total += dmg;
    this.log(source, outcome, dmg);
    return dmg;
  }
  private miss(source: string, mask: number): void {
    this.count(source, mask).misses++;
    this.log(source, "miss", 0);
  }
  private log(source: string, outcome: SimLogLine["outcome"], damage: number): void {
    const tr = this.trace;
    if (!tr || tr.log.length >= tr.logLimit || source === "") return;
    tr.log.push({
      t: Math.round(this.t * 1000) / 1000,
      source,
      outcome,
      damage: Math.round(damage),
      resource: this.model.power ? Math.round(this.resource) : null,
    });
  }
  private sample(): void {
    const tr = this.trace;
    if (!tr || !this.model.power || this.t - this.lastSample < TIMELINE_STEP_SEC) return;
    this.lastSample = this.t;
    tr.timeline.push([Math.round(this.t * 100) / 100, Math.round(this.resource * 10) / 10]);
  }
}
