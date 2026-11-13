import type { ClassToken, RotationsFile, SpecRotation, Spell, Talent } from "@/data/types";
import { learn, type Spellbook } from "@/engine/abilities";
import { mapAura, type RankedTalent, type SourcedEffect } from "@/engine/stats";

const TARGET_CASTER = 1;
/** ImplicitTarget 21 TARGET_UNIT_TARGET_ALLY: a single-target ally buff (Power Infusion) can be cast on yourself (L10). */
const TARGET_ALLY = 21;
/** The caster gets this aura when it casts the spell on itself: caster auras, and ally-target auras (self-cast). */
export function selfApplied(e: { targets?: [number, number] }): boolean {
  return !e.targets || e.targets[0] === TARGET_CASTER || e.targets[0] === TARGET_ALLY;
}
/** Hunter's Mark: "increasing the Ranged Attack Power of all attackers against that target" (target aura). [VERIFY] */
const AURA_RANGED_AP_ATTACKER_BONUS = 127;

/** Default rotation: the spec with the most points (ties and 0 points: the first "dps" spec among the tied). */
export function pickRotation(
  file: RotationsFile,
  token: ClassToken,
  specPoints: readonly number[],
): SpecRotation {
  const list = file.rotations.filter((r) => r.class === token).sort((a, b) => a.spec - b.spec);
  const max = Math.max(...specPoints);
  const top = list.filter((r) => (specPoints[r.spec] ?? 0) === max);
  const pick = top.length === 1 ? top[0] : (top.find((r) => r.role === "dps") ?? top[0]);
  if (!pick) throw new Error(`no rotation for ${token}`);
  return pick;
}

/** Learned spells of the rotation's self-buffs and `buff: true` entries (Slice and Dice). */
export function selfBuffSpells(
  book: Spellbook,
  rotation: SpecRotation,
  level: number,
  talents: readonly RankedTalent[],
  classTalents: readonly Talent[],
): Spell[] {
  const names = [...rotation.selfBuffs, ...rotation.entries.filter((e) => e.buff).map((e) => e.ability)];
  return names.flatMap((n) => {
    const l = learn(book, n, level, talents, classTalents);
    return "spell" in l ? [l.spell] : [];
  });
}

/**
 * Stat effects of self-buff spells (assumed 100% uptime): caster auras through the talent mapper's `mapAura`
 * (Aspect of the Hawk 124, Slice and Dice 319, Shadowform 79), plus Hunter's Mark (aura 127, on the target).
 */
export function selfBuffEffects(spells: readonly Spell[]): SourcedEffect[] {
  const out: SourcedEffect[] = [];
  for (const s of spells)
    for (const e of s.effects) {
      if (e.effect !== 6) continue;
      if (e.aura === AURA_RANGED_AP_ATTACKER_BONUS) {
        out.push({ key: "rangedAttackPower", value: e.base, label: s.name, kind: "buff" });
        continue;
      }
      if (!selfApplied(e)) continue;
      const m = mapAura(e, e.base);
      if (m.kind === "stat" || m.kind === "damageDone")
        for (const se of m.effects) out.push({ ...se, label: s.name, kind: "buff" });
    }
  return out;
}
