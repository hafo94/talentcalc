import { create } from "zustand";
import { rotationsFile } from "@/data";
import type {
  ClassSpellFile,
  ClassToken,
  RotationCondition,
  RotationEntry,
  RotationEntryKind,
  SpecRotation,
} from "@/data/types";
import { CONDITION_TYPES, abilityCatalog, type CatalogAbility } from "@/engine/rotation";
import { SIM_LIMITS } from "@/engine/sim/types";
import type { ClassTree } from "@/engine/talents";
import {
  DEFAULT_SIM_CODE,
  type CharacterCode,
  type ConditionCode,
  type EntryCode,
  type RotationCode,
  type SimCode,
} from "./charCode";

/** APPEND ONLY: entry kinds by URL index. */
export const ENTRY_KINDS: readonly RotationEntryKind[] = [
  "cooldown",
  "dot",
  "maintain",
  "filler",
  "builder",
  "finisher",
  "nextSwing",
  "burst",
];
/** APPEND ONLY: aura names that are not abilities (simulator procs), by URL index. */
export const PROC_AURAS: readonly string[] = [
  "Clearcasting",
  "Flurry",
  "Shadow Trance",
  "Improved Shadow Bolt",
  "Ignite",
  "Deep Wounds",
];

export const specRotation = (token: ClassToken, spec: number): SpecRotation | undefined =>
  rotationsFile.rotations.find((r) => r.class === token && r.spec === spec);

const catalogs = new WeakMap<ClassSpellFile, CatalogAbility[]>();
/** The editor's ability list of the loaded class (memoized per spell file). */
export function catalogFor(spells: ClassSpellFile, tree: ClassTree): CatalogAbility[] {
  let c = catalogs.get(spells);
  if (!c) {
    const talents = tree.order.map((id) => tree.nodes.get(id)!.talent);
    c = abilityCatalog(spells, talents, rotationsFile, tree.token);
    catalogs.set(spells, c);
  }
  return c;
}

/** Ref key of an aura/cooldown condition: ability id x 2, or proc index x 2 + 1 (section 5.2). */
function refKey(name: string, catalog: readonly CatalogAbility[]): number | null {
  const a = catalog.find((x) => x.name === name);
  if (a) return a.id * 2;
  const i = PROC_AURAS.indexOf(name);
  return i >= 0 ? i * 2 + 1 : null;
}
function refName(key: number, catalog: readonly CatalogAbility[]): string | null {
  if (key % 2 === 1) return PROC_AURAS[(key - 1) / 2] ?? null;
  return catalog.find((x) => x.id === key / 2)?.name ?? null;
}

function conditionToCode(c: RotationCondition, catalog: readonly CatalogAbility[]): ConditionCode | null {
  const type = CONDITION_TYPES.findIndex((t) => t.type === c.type);
  if (c.type === "aura" || c.type === "cooldown") {
    const key = refKey(c.ref, catalog);
    return key === null ? null : { type, flag: c.type === "aura" ? c.active : c.ready, value: key };
  }
  return { type, flag: c.cmp === "gte", value: c.value };
}
function codeToCondition(c: ConditionCode, catalog: readonly CatalogAbility[]): RotationCondition | null {
  const t = CONDITION_TYPES[c.type];
  if (!t) return null;
  if (t.type === "aura" || t.type === "cooldown") {
    const ref = refName(c.value, catalog);
    if (!ref) return null;
    return t.type === "aura"
      ? { type: "aura", ref, active: c.flag }
      : { type: "cooldown", ref, ready: c.flag };
  }
  return { type: t.type, cmp: c.flag ? "gte" : "lt", value: Math.min(t.max, c.value) };
}

/** URL record of an entry (null when its ability is not in the catalog). Conditions with unknown refs are dropped. */
export function entryToCode(e: RotationEntry, catalog: readonly CatalogAbility[]): EntryCode | null {
  const a = catalog.find((x) => x.name === e.ability);
  if (!a) return null;
  return {
    ability: a.id,
    kind: ENTRY_KINDS.indexOf(e.kind),
    off: e.off === true,
    cp: e.cp ?? 0,
    everySec: e.everySec ?? 0,
    conditions: (e.conditions ?? []).flatMap((c) => {
      const x = conditionToCode(c, catalog);
      return x ? [x] : [];
    }),
  };
}
/** Entry of a URL record; `buff`, `requires` and `requiresTalent` come from the catalog's default entry. */
export function codeToEntry(c: EntryCode, catalog: readonly CatalogAbility[]): RotationEntry | null {
  const a = catalog.find((x) => x.id === c.ability);
  const kind = ENTRY_KINDS[c.kind];
  if (!a || !kind) return null;
  const conditions = c.conditions.map((x) => codeToCondition(x, catalog));
  if (conditions.some((x) => x === null)) return null;
  const e: RotationEntry = { ability: a.name, kind };
  const d = a.entry;
  if (d.buff) e.buff = true;
  if (d.requires) e.requires = d.requires;
  if (d.requiresTalent) e.requiresTalent = d.requiresTalent;
  if (c.cp) e.cp = Math.min(5, Math.max(1, c.cp));
  if (c.everySec) e.everySec = Math.min(600, c.everySec);
  if (conditions.length) e.conditions = conditions as RotationCondition[];
  if (c.off) e.off = true;
  return e;
}

const sameEntries = (a: readonly RotationEntry[], b: readonly RotationEntry[]) =>
  JSON.stringify(a) === JSON.stringify(b);

export function rotationToCode(r: SpecRotation, catalog: readonly CatalogAbility[]): RotationCode {
  const def = specRotation(r.class, r.spec);
  if (def && sameEntries(r.entries, def.entries)) return { spec: r.spec, entries: null };
  return {
    spec: r.spec,
    entries: r.entries.flatMap((e) => {
      const x = entryToCode(e, catalog);
      return x ? [x] : [];
    }),
  };
}
export function codeToRotation(
  code: RotationCode,
  token: ClassToken,
  catalog: readonly CatalogAbility[],
): { rotation: SpecRotation; dropped: boolean } | null {
  const def = specRotation(token, code.spec);
  if (!def) return null;
  if (code.entries === null) return { rotation: structuredClone(def), dropped: false };
  const entries = code.entries.map((e) => codeToEntry(e, catalog));
  const kept = entries.filter((e): e is RotationEntry => e !== null);
  return { rotation: { ...structuredClone(def), entries: kept }, dropped: kept.length !== entries.length };
}

export function clampSim(s: SimCode): SimCode {
  const clamp = (v: number, [lo, hi]: readonly [number, number]) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo;
  return {
    fightSec: clamp(s.fightSec, SIM_LIMITS.fightSec),
    iterations: clamp(s.iterations, SIM_LIMITS.iterations),
    seed: clamp(s.seed, SIM_LIMITS.seed),
    unlimitedMana: s.unlimitedMana,
  };
}

export interface RotationState {
  custom: SpecRotation | null; // null: the default rotation of the spec with the most points
  sim: SimCode;
  setRotation(r: SpecRotation): void;
  reset(): void;
  setSim(patch: Partial<SimCode>): void;
  clear(): void;
  toCode(catalog: readonly CatalogAbility[]): Pick<CharacterCode, "rotation" | "sim">;
  /** false if something in the link was dropped. */
  applyCode(code: CharacterCode, token: ClassToken, catalog: readonly CatalogAbility[]): boolean;
}

export const useRotation = create<RotationState>()((set, get) => ({
  custom: null,
  sim: DEFAULT_SIM_CODE,
  setRotation(r) {
    set({ custom: r });
  },
  reset() {
    set({ custom: null });
  },
  setSim(patch) {
    set({ sim: clampSim({ ...get().sim, ...patch }) });
  },
  clear() {
    set({ custom: null });
  },
  toCode(catalog) {
    const s = get();
    return {
      ...(s.custom ? { rotation: rotationToCode(s.custom, catalog) } : {}),
      ...(JSON.stringify(s.sim) !== JSON.stringify(DEFAULT_SIM_CODE) ? { sim: s.sim } : {}),
    };
  },
  applyCode(code, token, catalog) {
    const sim = code.sim ? clampSim(code.sim) : DEFAULT_SIM_CODE;
    const r = code.rotation ? codeToRotation(code.rotation, token, catalog) : null;
    set({ custom: r ? r.rotation : null, sim });
    return (
      (!code.rotation || (r !== null && !r.dropped)) &&
      JSON.stringify(sim) === JSON.stringify(code.sim ?? sim)
    );
  },
}));
