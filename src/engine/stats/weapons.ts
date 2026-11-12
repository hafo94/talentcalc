import type { Ammo, ClassInfo, Weapon, WeaponSlotKind } from "@/data/types";

export type PickerSlot = "mainHand" | "offHand" | "ranged";
const SLOT_KINDS: Record<PickerSlot, readonly WeaponSlotKind[]> = {
  mainHand: ["mainHand", "oneHand", "twoHand"],
  offHand: ["offHand", "oneHand"],
  ranged: ["ranged", "thrown", "wand"],
};
export const AMMO_FOR_SUBCLASS: Readonly<Record<number, number>> = { 2: 2, 18: 2, 3: 3 }; // bow/crossbow: arrows, gun: bullets

/** ItemSparse.AllowableClass: -1/0 = any class, otherwise bit (classId - 1). */
export function classAllowed(w: Weapon, cls: ClassInfo): boolean {
  return w.allowableClass === -1 || w.allowableClass === 0 || (w.allowableClass & (1 << (cls.id - 1))) !== 0;
}

export function canUse(w: Weapon, cls: ClassInfo, level: number): boolean {
  return cls.weaponSubclasses.includes(w.subclass) && classAllowed(w, cls) && w.requiredLevel <= level;
}

/** Weapons the class can put in a picker slot. The off hand needs dual wield and a one-handed main hand. */
export function weaponsForSlot(
  all: readonly Weapon[],
  cls: ClassInfo,
  level: number,
  slot: PickerSlot,
  mainHand: Weapon | null,
): Weapon[] {
  if (slot === "offHand" && (!cls.dualWield || mainHand?.slot === "twoHand")) return [];
  return all.filter((w) => SLOT_KINDS[slot].includes(w.slot) && canUse(w, cls, level));
}

export function ammoFor(all: readonly Ammo[], ranged: Weapon | null, level: number): Ammo[] {
  const sub = ranged ? AMMO_FOR_SUBCLASS[ranged.subclass] : undefined;
  if (sub === undefined) return [];
  return all.filter(
    (a) => a.subclass === sub && a.requiredLevel <= level && !/deprecated|depricated/i.test(a.name),
  );
}

/** Case-insensitive substring search, best item level first, then name; at most `limit` results. */
export function searchWeapons(list: readonly Weapon[], query: string, limit = 50): Weapon[] {
  const q = query.trim().toLowerCase();
  return list
    .filter((w) => q === "" || w.name.toLowerCase().includes(q))
    .sort((a, b) => b.itemLevel - a.itemLevel || a.name.localeCompare(b.name) || a.id - b.id)
    .slice(0, limit);
}
