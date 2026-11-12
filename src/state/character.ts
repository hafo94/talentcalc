import { create } from "zustand";
import { buffsFile, getClassInfo, loadWeapons } from "@/data";
import type { ClassToken, MagicSchool, TargetPresetId, WeaponsFile } from "@/data/types";
import { EMPTY_BONUS, ammoFor, weaponsForSlot, type BonusStats } from "@/engine/stats";
import { BONUS_SCALE, type CharacterCode, type CustomTarget } from "./charCode";

export type WeaponSlotKey = "mainHand" | "offHand" | "ranged" | "ammo";
export interface WeaponIds {
  mainHand: number;
  offHand: number;
  ranged: number;
  ammo: number;
}
export const NO_WEAPON_IDS: WeaponIds = { mainHand: 0, offHand: 0, ranged: 0, ammo: 0 };
export const DEFAULT_CUSTOM: CustomTarget = { level: 63, armor: 3731, resist: [0, 0, 0, 0, 0, 0] };
export const RESIST_ORDER: readonly MagicSchool[] = ["holy", "fire", "nature", "frost", "shadow", "arcane"];

/** Input limits (also applied to URL values). Percent fields allow two decimals. */
export const BONUS_LIMITS: Record<keyof BonusStats, [number, number]> = {
  str: [0, 2000],
  agi: [0, 2000],
  sta: [0, 2000],
  int: [0, 2000],
  spi: [0, 2000],
  attackPower: [0, 5000],
  rangedAttackPower: [0, 5000],
  spellPower: [0, 3000],
  holySpellPower: [0, 3000],
  fireSpellPower: [0, 3000],
  natureSpellPower: [0, 3000],
  frostSpellPower: [0, 3000],
  shadowSpellPower: [0, 3000],
  arcaneSpellPower: [0, 3000],
  hit: [0, 100],
  spellHit: [0, 100],
  crit: [0, 100],
  spellCrit: [0, 100],
  haste: [0, 100],
  weaponSkill: [0, 100],
};
export const CUSTOM_LIMITS = { level: [1, 63], armor: [0, 20000], resist: [0, 1000] } as const;

export function clampBonus(key: keyof BonusStats, v: number): number {
  if (!Number.isFinite(v)) return 0;
  const [lo, hi] = BONUS_LIMITS[key];
  const scale = BONUS_SCALE[key as keyof typeof BONUS_SCALE] ?? 1;
  return Math.min(hi, Math.max(lo, Math.round(v * scale) / scale));
}

export interface CharacterState {
  raceId: number; // 0 until a class is chosen
  weaponIds: WeaponIds;
  bonus: BonusStats;
  buffIds: string[]; // buffs and debuffs, in buffs.json order
  target: TargetPresetId;
  custom: CustomTarget;
  weapons: WeaponsFile | null; // lazy weapons.json
  setRace(id: number): void;
  setWeapon(slot: WeaponSlotKey, id: number, classToken: ClassToken, level: number): void;
  setBonus(key: keyof BonusStats, value: number): void;
  resetBonus(): void;
  toggleBuff(id: string): void;
  setPreset(name: "raidBuffs" | "raidDebuffs", on: boolean): void;
  setTarget(preset: TargetPresetId): void;
  setCustom(patch: Partial<CustomTarget>): void;
  fitToClass(token: ClassToken, level: number): Promise<boolean>; // false if something was dropped
  applyCode(code: CharacterCode, token: ClassToken, level: number): Promise<boolean>;
  toCode(token: ClassToken): CharacterCode;
}

const orderBuffs = (ids: Iterable<string>) => {
  const set = new Set(ids);
  return buffsFile.buffs.filter((b) => set.has(b.id)).map((b) => b.id);
};
/** Turns `id` on and drops other members of its group. */
function withBuff(ids: string[], id: string): string[] {
  const def = buffsFile.buffs.find((b) => b.id === id);
  if (!def) return ids;
  const rest = ids.filter((x) => {
    const other = buffsFile.buffs.find((b) => b.id === x);
    return x !== id && !(def.group && other?.group === def.group);
  });
  return orderBuffs([...rest, id]);
}

/** Drops weapons the class cannot use in that slot (and ammo that does not fit the ranged weapon). */
export function sanitizeWeapons(
  ids: WeaponIds,
  file: WeaponsFile,
  token: ClassToken,
  level: number,
): WeaponIds {
  const cls = getClassInfo(token);
  const byId = (id: number) => file.weapons.find((w) => w.id === id) ?? null;
  const pick = (slot: "mainHand" | "offHand" | "ranged", id: number, mh: ReturnType<typeof byId>) =>
    id &&
    weaponsForSlot(
      [byId(id)].filter((w) => w !== null),
      cls,
      level,
      slot,
      mh,
    ).length
      ? id
      : 0;
  const mainHand = pick("mainHand", ids.mainHand, null);
  const mh = byId(mainHand);
  const offHand = pick("offHand", ids.offHand, mh);
  const ranged = pick("ranged", ids.ranged, null);
  const ammo =
    ids.ammo && ammoFor(file.ammo, byId(ranged), level).some((a) => a.id === ids.ammo) ? ids.ammo : 0;
  return { mainHand, offHand, ranged, ammo };
}

/**
 * weapons.json is only awaited when weapon ids must be validated; otherwise it loads in the background so the
 * talent tree never waits for it.
 */
async function weaponsFor(ids: WeaponIds): Promise<WeaponsFile | null> {
  const loaded = useCharacter.getState().weapons;
  if (loaded) return loaded;
  if (Object.values(ids).some((id) => id !== 0)) return loadWeapons();
  void loadWeapons().then(
    (f) => useCharacter.setState({ weapons: f }),
    () => undefined,
  );
  return null;
}

export const useCharacter = create<CharacterState>()((set, get) => ({
  raceId: 0,
  weaponIds: NO_WEAPON_IDS,
  bonus: EMPTY_BONUS,
  buffIds: [],
  target: "boss",
  custom: DEFAULT_CUSTOM,
  weapons: null,
  setRace(id) {
    set({ raceId: id });
  },
  setWeapon(slot, id, token, level) {
    const file = get().weapons;
    if (!file) return;
    set({ weaponIds: sanitizeWeapons({ ...get().weaponIds, [slot]: id }, file, token, level) });
  },
  setBonus(key, value) {
    set({ bonus: { ...get().bonus, [key]: clampBonus(key, value) } });
  },
  resetBonus() {
    set({ bonus: EMPTY_BONUS });
  },
  toggleBuff(id) {
    const ids = get().buffIds;
    set({ buffIds: ids.includes(id) ? ids.filter((x) => x !== id) : withBuff(ids, id) });
  },
  setPreset(name, on) {
    const preset = buffsFile.presets[name];
    let ids = get().buffIds.filter((x) => !preset.includes(x));
    if (on) for (const id of preset) ids = withBuff(ids, id);
    set({ buffIds: orderBuffs(ids) });
  },
  setTarget(preset) {
    set({ target: preset });
  },
  setCustom(patch) {
    set({ custom: { ...get().custom, ...patch } });
  },
  async fitToClass(token, level) {
    const cls = getClassInfo(token);
    const raceId = cls.raceIds.includes(get().raceId) ? get().raceId : cls.raceIds[0]!;
    const file = await weaponsFor(get().weaponIds);
    const weaponIds = file ? sanitizeWeapons(get().weaponIds, file, token, level) : NO_WEAPON_IDS;
    const kept = JSON.stringify(weaponIds) === JSON.stringify(get().weaponIds);
    set({ raceId, weaponIds, ...(file ? { weapons: file } : {}) });
    return kept;
  },
  async applyCode(code, token, level) {
    const cls = getClassInfo(token);
    let ok = code.raceId === null || cls.raceIds.includes(code.raceId);
    const raceId = code.raceId !== null && ok ? code.raceId : cls.raceIds[0]!;
    const bonus = { ...EMPTY_BONUS };
    for (const [k, v] of Object.entries(code.bonus))
      bonus[k as keyof BonusStats] = clampBonus(k as keyof BonusStats, v);
    const known = buffsFile.buffs.filter((b) => code.buffCodes.includes(b.code));
    if (known.length !== code.buffCodes.length) ok = false;
    let buffIds: string[] = [];
    for (const b of known) buffIds = withBuff(buffIds, b.id);
    const file = await weaponsFor(code.weapons);
    const weaponIds = file ? sanitizeWeapons(code.weapons, file, token, level) : NO_WEAPON_IDS;
    if (JSON.stringify(weaponIds) !== JSON.stringify(code.weapons)) ok = false;
    const c = code.target.custom;
    const custom: CustomTarget = c
      ? {
          level: Math.min(63, Math.max(1, c.level)),
          armor: Math.min(20000, c.armor),
          resist: c.resist.map((r) => Math.min(1000, r)) as CustomTarget["resist"],
        }
      : DEFAULT_CUSTOM;
    set({
      raceId,
      bonus,
      buffIds,
      weaponIds,
      target: code.target.preset,
      custom,
      ...(file ? { weapons: file } : {}),
    });
    return ok;
  },
  toCode(token) {
    const s = get();
    const cls = getClassInfo(token);
    const bonus: CharacterCode["bonus"] = {};
    for (const [k, v] of Object.entries(s.bonus)) if (v !== 0) bonus[k as keyof BonusStats] = v;
    return {
      raceId: s.raceId === cls.raceIds[0] || s.raceId === 0 ? null : s.raceId,
      weapons: s.weaponIds,
      bonus,
      buffCodes: buffsFile.buffs.filter((b) => s.buffIds.includes(b.id)).map((b) => b.code),
      target: s.target === "custom" ? { preset: "custom", custom: s.custom } : { preset: s.target },
    };
  },
}));
