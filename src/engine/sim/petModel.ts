import type { Spell } from "@/data/types";
import { weaponInfo, type AbilityEval } from "@/engine/abilities";
import { petState, type PetEvalArgs, type PetState } from "@/engine/pets";
import {
  buffDef,
  type ActiveBuffKey,
  type BuffDef,
  type FightModel,
  type SimEntry,
  type SimModel,
  type StateEval,
} from "./model";
import { noProcs } from "./procs";
import type { SimInput } from "./types";

/** The pet's evaluation as a simulator state (white attacks, abilities per entry, no player-only procs). */
function toStateEval(st: PetState, key: string): StateEval {
  const w = st.white;
  const info = weaponInfo(st.ctx, "mainHand");
  const spread = w && info && info.perSwing > 0 ? (info.spread * w.normalHit) / info.perSwing : 0;
  return {
    key,
    ctx: st.ctx,
    abilities: st.abilities,
    finisherAt: (i: number): AbilityEval => st.abilities[i]!,
    white: { mainHand: w, offHand: null, ranged: null },
    whiteSpread: { mainHand: spread, offHand: 0, ranged: 0 },
    windfury: null,
    sealOfCommand: null,
    extraDps: [],
    ragePerSec: 0,
  };
}

/**
 * The pet as its own actor (section 4.6): a FightModel built from petState, so the same Fight class runs it (swing
 * timer, GCD, casts, focus, DoTs). Pet bursts (Bestial Wrath) and Frenzy are buffs whose auras land on the pet; the
 * state is re-evaluated (and memoized) per set of active pet buffs. Null when the input has no pet.
 */
export function buildPetModel(input: SimInput, owner: SimModel): FightModel | null {
  const pet = input.pet;
  if (!pet) return null;
  const args: PetEvalArgs = {
    setup: pet,
    level: owner.level,
    owner: owner.prepared.stats,
    ownerSpells: input.prepare.spells.spells,
    classSet: owner.classSet,
    talents: input.prepare.talents,
    classTalents: input.prepare.classTalents,
    spellMods: owner.prepared.assembled.mapping.spellMods,
    target: input.target,
    armorFormula: input.armorFormula,
  };
  const base = petState(args);
  const book = base.ctx.book;
  const buffs: BuffDef[] = [];
  const addBuff = (spell: Spell, name?: string): BuffDef => {
    const b = buffDef(buffs.length, spell, book, name);
    b.stateful = true; // its auras land on the pet (target 5) or on the pet itself (Frenzy)
    buffs.push(b);
    return b;
  };
  const entries: SimEntry[] = base.rotation.entries.map((entry, index) => {
    const a = base.abilities[index]!;
    return {
      index,
      entry,
      buff: entry.kind === "burst" && a.available ? addBuff(a.spell) : null,
      requires: -1,
      talentOk: true,
      explicitAuraLeft: false,
      skip: false,
    };
  });
  const procs = noProcs();
  const f = base.auras.frenzy;
  if (f) {
    procs.critBuff = { chance: f.chance, buff: addBuff(f.spell, "Frenzy") };
    procs.labels.push(`${f.label}: Frenzy on ${f.chance}% of melee crits`);
  }
  const cache = new Map<string, StateEval>([["", toStateEval(base, "")]]);
  return {
    token: owner.token,
    level: owner.level,
    rotation: base.rotation,
    power: base.focusPerSecond !== null ? "focus" : null,
    entries,
    buffs,
    procs,
    maxMana: 0,
    spiritRegenPerSec: 0,
    castRegenPct: 0,
    classSet: owner.classSet,
    focus: pet.config.focus ? { max: pet.config.focus.max, perSecond: base.focusPerSecond ?? 0 } : null,
    sourcePrefix: `${pet.info.name}: `,
    strictPriority: true,
    state(active: readonly ActiveBuffKey[]): StateEval {
      const on = active.filter((x) => x.def.stateful && x.def.spell);
      const key = on
        .map((x) => `${x.def.index}x${x.stacks}`)
        .sort()
        .join(",");
      let s = cache.get(key);
      if (!s) {
        const spells = on.flatMap((x) => Array.from({ length: x.stacks }, () => x.def.spell!));
        s = toStateEval(petState(args, spells), key);
        cache.set(key, s);
      }
      return s;
    },
  };
}
