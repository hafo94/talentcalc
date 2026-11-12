import type { AttackSlot, EquippedRequirement, Weapon } from "@/data/types";
import { INVTYPE_OFFHAND_BIT, ITEM_CLASS_ARMOR, ITEM_CLASS_WEAPON, SUBCLASS_MASK } from "./constants";
import { ATTACK_SLOTS, type EquippedWeapons } from "./types";

function fits(req: EquippedRequirement, w: Weapon): boolean {
  return req.subclassMask === 0 || (req.subclassMask & (1 << w.subclass)) !== 0;
}

/** Attack slots whose equipped weapon satisfies the requirement (empty: the aura is inactive). */
export function matchingSlots(req: EquippedRequirement | null, weapons: EquippedWeapons): AttackSlot[] {
  if (!req) return [...ATTACK_SLOTS];
  if (req.itemClass !== ITEM_CLASS_WEAPON) return []; // shields (class 4) are not modeled in Phase 3
  const offOnly = (req.invTypeMask & INVTYPE_OFFHAND_BIT) !== 0;
  return ATTACK_SLOTS.filter((slot) => {
    const w = weapons[slot];
    if (!w || (offOnly && slot !== "offHand")) return false;
    return fits(req, w);
  });
}

export function describeRequirement(req: EquippedRequirement): string {
  if (req.itemClass === ITEM_CLASS_ARMOR) return "requires a shield";
  if (req.invTypeMask & INVTYPE_OFFHAND_BIT) return "requires an off-hand weapon";
  switch (req.subclassMask) {
    case SUBCLASS_MASK.melee:
      return "requires a melee weapon";
    case SUBCLASS_MASK.twoHand:
      return "requires a two-handed melee weapon";
    case SUBCLASS_MASK.ranged:
      return "requires a bow, gun or crossbow";
    case SUBCLASS_MASK.wand:
      return "requires a wand";
    case SUBCLASS_MASK.dagger:
      return "requires a dagger";
    default:
      return "requires a matching weapon";
  }
}
