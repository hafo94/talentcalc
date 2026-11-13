import type { TargetPresetId } from "@/data/types";
import { CONDITION_TYPES } from "@/engine/rotation/conditions";

/** Condition type indices whose operand is a number (stored in tenths); the others carry a ref key. */
const VALUE_CONDITION_TYPES: ReadonlySet<number> = new Set(
  CONDITION_TYPES.flatMap((c, i) => (c.operand === "value" ? [i] : [])),
);

/** Bonus-stat fields in URL order. APPEND ONLY: the index is part of the URL format. */
export const BONUS_KEYS = [
  "str",
  "agi",
  "sta",
  "int",
  "spi",
  "attackPower",
  "rangedAttackPower",
  "spellPower",
  "holySpellPower",
  "fireSpellPower",
  "natureSpellPower",
  "frostSpellPower",
  "shadowSpellPower",
  "arcaneSpellPower",
  "hit",
  "spellHit",
  "crit",
  "spellCrit",
  "haste",
  "weaponSkill",
] as const;
export type BonusKey = (typeof BONUS_KEYS)[number];
/** Percent fields keep two decimals in the URL (value x 100). */
export const BONUS_SCALE: Partial<Record<BonusKey, number>> = {
  hit: 100,
  spellHit: 100,
  crit: 100,
  spellCrit: 100,
  haste: 100,
};
/** APPEND ONLY. */
export const TARGET_PRESETS: readonly TargetPresetId[] = ["boss", "elite", "same", "lowArmorBoss", "custom"];

export interface CustomTarget {
  level: number;
  armor: number;
  resist: [number, number, number, number, number, number]; // holy, fire, nature, frost, shadow, arcane
}
/** Phase 5 condition record: `flag` is cmp "gte" (value types) or active/ready (ref types). */
export interface ConditionCode {
  type: number; // CONDITION_TYPES index (src/engine/rotation/conditions.ts, append only)
  flag: boolean;
  value: number; // value types: display units, one decimal; ref types: ref key (section 5.2)
}
export interface EntryCode {
  ability: number; // CatalogAbility.id
  kind: number; // ENTRY_KINDS index (src/state/rotation.ts, append only)
  off: boolean;
  cp: number; // 0 = absent
  everySec: number; // 0 = absent; one decimal
  conditions: ConditionCode[];
}
/** Phase 5: the rotation record (tag 6). `entries` null = the spec's default entries. */
export interface RotationCode {
  spec: number; // base rotation: talent tab 0..2
  entries: EntryCode[] | null;
}
/** Phase 5: simulation settings (tag 7), omitted when they are the defaults. */
export interface SimCode {
  fightSec: number;
  iterations: number;
  seed: number;
  unlimitedMana: boolean;
}
export interface CharacterCode {
  raceId: number | null; // null = the class's default race
  weapons: { mainHand: number; offHand: number; ranged: number; ammo: number }; // item ids, 0 = empty
  bonus: Partial<Record<BonusKey, number>>; // display units (percent points for % fields); zeros omitted
  buffCodes: number[]; // buffs.json codes, ascending
  target: { preset: TargetPresetId; custom?: CustomTarget }; // custom only with preset "custom"
  rotation?: RotationCode; // Phase 5; absent = default rotation (spec with the most points)
  sim?: SimCode; // Phase 5; absent = DEFAULT_SIM_CODE
}

export const TAG = { race: 1, weapons: 2, bonus: 3, buffs: 4, target: 5, rotation: 6, sim: 7 } as const;
export const DEFAULT_SIM_CODE: SimCode = { fightSec: 180, iterations: 1000, seed: 1, unlimitedMana: true };
/** Entry head bits above the kind (kind < 16). */
const ENTRY_OFF = 16;
const ENTRY_CP = 32;
const ENTRY_EVERY = 64;
const ENTRY_CONDITIONS = 128;

export const DEFAULT_CHARACTER: CharacterCode = {
  raceId: null,
  weapons: { mainHand: 0, offHand: 0, ranged: 0, ammo: 0 },
  bonus: {},
  buffCodes: [],
  target: { preset: "boss" },
};

export function writeVarint(out: number[], value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`varint out of range: ${value}`);
  let v = value;
  while (v >= 0x80) {
    out.push(v % 0x80 | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}
const zigzag = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzigzag = (n: number) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

/** Reads varints from bytes[start, end); null on a truncated or oversized varint. */
function readVarints(bytes: Uint8Array, start: number, end: number): number[] | null {
  const out: number[] = [];
  let i = start;
  while (i < end) {
    let value = 0;
    let mul = 1;
    for (;;) {
      if (i >= end) return null;
      const b = bytes[i++]!;
      value += (b & 0x7f) * mul;
      if (!(b & 0x80)) break;
      mul *= 0x80;
      if (mul > 2 ** 35) return null;
    }
    out.push(value);
  }
  return out;
}

export function isDefaultCharacter(c: CharacterCode): boolean {
  return encodeCharacterBytes(c).length === 0;
}

/** TLV records (tag varint, length varint, body) in ascending tag order; records equal to the default are omitted. */
export function encodeCharacterBytes(c: CharacterCode): number[] {
  const out: number[] = [];
  const record = (tag: number, body: number[]) => {
    if (!body.length) return;
    writeVarint(out, tag);
    writeVarint(out, body.length);
    out.push(...body);
  };
  const race: number[] = [];
  if (c.raceId !== null) writeVarint(race, c.raceId);
  record(TAG.race, race);
  const w = c.weapons;
  const weapons: number[] = [];
  if (w.mainHand || w.offHand || w.ranged || w.ammo)
    for (const id of [w.mainHand, w.offHand, w.ranged, w.ammo]) writeVarint(weapons, id);
  record(TAG.weapons, weapons);
  const bonus: number[] = [];
  BONUS_KEYS.forEach((k, i) => {
    const v = Math.round((c.bonus[k] ?? 0) * (BONUS_SCALE[k] ?? 1));
    if (v === 0) return;
    writeVarint(bonus, i);
    writeVarint(bonus, zigzag(v));
  });
  record(TAG.bonus, bonus);
  const buffs: number[] = [];
  for (const code of [...new Set(c.buffCodes)].sort((a, b) => a - b)) writeVarint(buffs, code);
  record(TAG.buffs, buffs);
  const target: number[] = [];
  if (c.target.preset !== "boss") {
    writeVarint(target, TARGET_PRESETS.indexOf(c.target.preset));
    if (c.target.preset === "custom" && c.target.custom) {
      const t = c.target.custom;
      for (const v of [t.level, t.armor, ...t.resist]) writeVarint(target, v);
    }
  }
  record(TAG.target, target);
  if (c.rotation) record(TAG.rotation, encodeRotation(c.rotation));
  const s = c.sim;
  if (s && JSON.stringify(s) !== JSON.stringify(DEFAULT_SIM_CODE))
    record(TAG.sim, [s.fightSec, s.iterations, s.seed, s.unlimitedMana ? 1 : 0].flatMap(varint));
  return out;
}

const varint = (v: number) => {
  const b: number[] = [];
  writeVarint(b, v);
  return b;
};
const tenths = (v: number) => Math.max(0, Math.round(v * 10));

function encodeRotation(r: RotationCode): number[] {
  const out: number[] = [];
  writeVarint(out, r.spec);
  for (const e of r.entries ?? []) {
    writeVarint(out, e.ability);
    const head =
      e.kind +
      (e.off ? ENTRY_OFF : 0) +
      (e.cp ? ENTRY_CP : 0) +
      (e.everySec ? ENTRY_EVERY : 0) +
      (e.conditions.length ? ENTRY_CONDITIONS : 0);
    writeVarint(out, head);
    if (e.cp) writeVarint(out, e.cp);
    if (e.everySec) writeVarint(out, tenths(e.everySec));
    if (e.conditions.length) {
      writeVarint(out, e.conditions.length);
      for (const c of e.conditions) {
        writeVarint(out, c.type * 2 + (c.flag ? 1 : 0));
        writeVarint(out, VALUE_CONDITION_TYPES.has(c.type) ? tenths(c.value) : c.value);
      }
    }
  }
  if (r.entries && r.entries.length === 0) writeVarint(out, 0); // an explicit empty list: ability id 0
  return out;
}

/** `v` = the record's varints; null when malformed. Value-type condition values are stored in tenths. */
function decodeRotation(v: number[], valueType: (type: number) => boolean): RotationCode | null {
  const spec = v[0];
  if (spec === undefined || spec > 2) return null;
  if (v.length === 1) return { spec, entries: null };
  if (v.length === 2 && v[1] === 0) return { spec, entries: [] };
  const entries: EntryCode[] = [];
  let i = 1;
  const next = () => (i < v.length ? v[i++]! : null);
  while (i < v.length) {
    const ability = next();
    const head = next();
    if (ability === null || head === null || ability === 0) return null;
    const e: EntryCode = {
      ability,
      kind: head % ENTRY_OFF,
      off: (head & ENTRY_OFF) !== 0,
      cp: 0,
      everySec: 0,
      conditions: [],
    };
    if (head & ENTRY_CP) e.cp = next() ?? -1;
    if (head & ENTRY_EVERY) e.everySec = (next() ?? -1) / 10;
    if (head & ENTRY_CONDITIONS) {
      const n = next() ?? 0;
      for (let k = 0; k < n; k++) {
        const t = next();
        const value = next();
        if (t === null || value === null) return null;
        const type = Math.floor(t / 2);
        e.conditions.push({ type, flag: t % 2 === 1, value: valueType(type) ? value / 10 : value });
      }
      if (n === 0) return null;
    }
    if (e.cp < 0 || e.everySec < 0) return null;
    entries.push(e);
  }
  return { spec, entries };
}

/** null when the payload is malformed. Unknown tags are skipped (forward compatibility). */
export function decodeCharacterBytes(bytes: Uint8Array): CharacterCode | null {
  const c: CharacterCode = structuredClone(DEFAULT_CHARACTER);
  let i = 0;
  let lastTag = 0;
  while (i < bytes.length) {
    const head = readVarintAt(bytes, i);
    if (!head) return null;
    const len = readVarintAt(bytes, head.next);
    if (!len) return null;
    const tag = head.value;
    const start = len.next;
    const end = start + len.value;
    if (tag <= lastTag || end > bytes.length || len.value === 0) return null;
    lastTag = tag;
    i = end;
    const v = readVarints(bytes, start, end);
    if (!v) return null;
    switch (tag) {
      case TAG.race:
        if (v.length !== 1) return null;
        c.raceId = v[0]!;
        break;
      case TAG.weapons:
        if (v.length !== 4) return null;
        c.weapons = { mainHand: v[0]!, offHand: v[1]!, ranged: v[2]!, ammo: v[3]! };
        break;
      case TAG.bonus:
        if (v.length % 2) return null;
        for (let j = 0; j < v.length; j += 2) {
          const key = BONUS_KEYS[v[j]!];
          if (key) c.bonus[key] = unzigzag(v[j + 1]!) / (BONUS_SCALE[key] ?? 1);
        }
        break;
      case TAG.buffs:
        c.buffCodes = [...new Set(v)].sort((a, b) => a - b);
        break;
      case TAG.target: {
        const preset = TARGET_PRESETS[v[0]!];
        if (!preset) return null;
        if (preset === "custom") {
          if (v.length !== 9) return null;
          c.target = {
            preset,
            custom: { level: v[1]!, armor: v[2]!, resist: v.slice(3, 9) as CustomTarget["resist"] },
          };
        } else {
          if (v.length !== 1) return null;
          c.target = { preset };
        }
        break;
      }
      case TAG.rotation: {
        const r = decodeRotation(v, (type) => VALUE_CONDITION_TYPES.has(type));
        if (!r) return null;
        c.rotation = r;
        break;
      }
      case TAG.sim:
        if (v.length !== 4 || v[3]! > 1) return null;
        c.sim = { fightSec: v[0]!, iterations: v[1]!, seed: v[2]!, unlimitedMana: v[3] === 1 };
        break;
      default:
        break; // unknown tag from a newer version: ignore
    }
  }
  return c;
}

function readVarintAt(bytes: Uint8Array, start: number): { value: number; next: number } | null {
  let value = 0;
  let mul = 1;
  let i = start;
  for (;;) {
    if (i >= bytes.length) return null;
    const b = bytes[i++]!;
    value += (b & 0x7f) * mul;
    if (!(b & 0x80)) return { value, next: i };
    mul *= 0x80;
    if (mul > 2 ** 35) return null;
  }
}
