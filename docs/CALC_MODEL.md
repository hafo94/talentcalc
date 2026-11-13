# Calculation model

This is the math the engine implements. Every constant must have a source note in code
(`// src: ...`). Constants marked **[VERIFY]** are Classic 1.12 values. Forever runs on the
modern engine and may differ, so each one needs an in-game check before it is trusted
(OPEN_QUESTIONS.md).

## 1. Pipeline overview

```
Character (class, race, level, gear incl. weapon(s), buffs, target)
  + Talent build (node -> rank)
  → Stat aggregation        base stats(race,class,level) + gear + buffs
  → Talent modifiers        flat/percent stat mods, spell mods (by spell family mask), procs
  → Derived stats           AP, RAP, spell power per school, hit, crit, haste, expertise/skill, armor pen
  → Per-ability evaluation  avg hit, crit, outcome table → expected damage per cast
  → Rotation                priority list or fixed sequence → cast timeline (simulated)
  → Results                 DPS, damage breakdown per ability, pet DPS, stat weights
```

The engine is **pure TypeScript with no UI dependencies**, so it can be unit-tested headless.

## 2. Attack outcome tables (level-60 player vs level-63 boss)

### Melee (single roll)
| Outcome | Value [VERIFY] |
|---|---|
| Miss | 8% base (+19% dual-wield white hits) at 300 weapon skill; hit reduces it (−1% per 1% hit, with skill-based suppression) |
| Dodge | 6.5% (5% + 0.1% × skill diff 15) |
| Parry | 14% from the front; 0 when behind (default: behind) |
| Glancing | 40% of white hits; damage factor = average of vmangos low/high: 65% at 300 vs 315, 95% at 308+ (`glancingMultiplier`, Q34) |
| Block | 0 from behind |
| Crit | crit% − 1.8% boss suppression (−3% with level-based suppression), capped by the remaining table |
| Hit | remainder |

Phase 3 implements these rules (`src/engine/stats/target.ts`, all `[VERIFY]`, Q3/Q34), with `diff = 5 x targetLevel - weaponSkill`:
base miss = `diff < 0 ? max(0, 5 + 0.04 diff) : 5 + diff x (diff > 10 ? 0.2 : 0.1)` (8% at 300 vs 315); +hit removes miss one for one, but the
first 1% is ignored when `diff > 10` (special hit cap 9%); dual-wield white attacks add 19% miss (cap 28%); dodge = `max(0, 5 + 0.1 diff)` minus
expertise (6.5%); parry and block 0 (from behind); glancing = `min(40, max(0, 10 + 2 (defense - min(skill, 5 L))))`, melee white only, 0 vs lower-level
targets (40% boss, 10% same level); crit vs target = sheet crit + 0.04 (skill - defense) - (level gap >= 3 ? 1.8 : 0), floored at 0
(sheet 5% -> 2.6% vs boss; Q34 asks 1.8% + 0.04/point versus 3%); white crit is capped by `100 - miss - dodge - glancing`.
Spell miss = `clamp(base - spellHit, 1, 99)` with base 4/5/6/17/28% for +0..+4 levels (hit cap 16% vs boss).

Yellow (special) attacks use a two-roll system: miss/dodge/parry first, then crit separately, with no glancing.

**Expected damage (Phase 4, `src/engine/combat/outcome.ts`):**
```
white swing  = normalHit x (hit% + glancing% x glancingMult + crit% x (1 + critBonus)) / 100        single roll from the white table
special/spell = count x perHit x land/100 x (1 + crit/100 x critBonus x critDamageMult)              two rolls: land, then crit
land: spell 100 - max(1, miss - hit);  melee 100 - miss - dodge;  ranged 100 - miss (no dodge, Q49)
critBonus: spells 0.5, melee and ranged attacks 1.0 (SpellModOp 15 multiplies the bonus: Ice Shards +100% -> 1.0, Impale +20%)
```

### Ranged
Same as melee, but no glancing and no parry from behind. Hunter crit from Agi.

### Spells
| | Value [VERIFY] |
|---|---|
| Hit vs +3 | 83%; +hit adds up to a 99% cap (16% hit) |
| Crit | base + Int / ratio + gear crit; crit = 150% damage (200% with talents such as Ice Shards) |
| Resistance | Phase 4: average partial resist for every school except holy: `0.75 x R / (5 L)`, R = resistance + 8 per target level above the caster (boss 24 -> 6%), cap 75%. Binary spells have the same expected damage (Q50) |

## 2b. Targets

Owner decision: the default target is a **boss at player level + 3** (at 60, that's level 63 with 3731 armor). Next to it,
there are **reference mobs scaled to the selected player level L**:

| Preset | Level | Armor | Notes |
|---|---|---|---|
| Boss (default) | L+3 | ExpectedStat[L+3] | Crit suppression, glancing, 8–9% miss |
| Elite | L+2 | ExpectedStat[L+2] | |
| Same-level mob | L | ExpectedStat[L] | No glancing penalty; 5% miss |
| Low-armor boss | L+3 | ExpectedStat[L+3] × 0.5 | Reference for caster/low-armor fights [tune] |
| Custom | any | any | Level, armor and resistances editable |

Custom accepts level 1-63, armor 0-20000 and six resistances 0-1000. Debuffs reduce armor first (floored at 0), then talent armor penetration applies. Until the level selector exists (Phase 7), L = 60. ExpectedStat armor is an average
creature value [VERIFY against a few real mobs]. Named raid-boss presets can be added later in
`data/manual/targets.json`.

## 3. Stat conversions (level 60) [VERIFY all]

| Stat | Effect |
|---|---|
| Strength | 2 AP (Warrior, Paladin, Shaman, Druid); 1 AP (Rogue, Hunter) |
| Agility | 1 AP (Rogue, Hunter, cat Druid); 2 RAP (Hunter); crit per Agi: Warrior/Paladin/Shaman/Druid 1/20, Rogue 1/29, Hunter 1/53; 2 armor |
| Intellect | mana 15/Int; spell crit per Int: Mage 1/59.5, Warlock 1/60.6, Priest 1/59.2, Druid 1/60, Shaman 1/59.5, Paladin 1/54 |
| AP → DPS | 14 AP = 1 weapon DPS; normalized for instant attacks (Forever: confirm normalization exists) |
| Armor DR | `armor / (armor + 400 + 85 × attackerLevel)`, capped at 75%; target armor from presets (below), editable, with debuff toggles (Sunder ×5, Faerie Fire, Curse of Recklessness, Expose Armor) |

Attack power (Classic 1.12 formulas, `conversions` in `base-stats.json`): melee AP = `perLevel x L + perStr x Str + perAgi x Agi + flat` per class
(Warrior/Paladin 3L + 2 Str - 20, Shaman 2L + 2 Str - 20, Rogue/Hunter 2L + Str + Agi - 20, Druid 2 Str - 20, casters Str - 10); ranged AP: Hunter 2L + 2 Agi - 10,
Warrior/Rogue L + Agi - 10 (a naked Human Warrior has 400 AP, 130 RAP). Mage, Priest and Warlock get Agi -> crit 1/20 `[VERIFY]`. Health = base + min(Sta, 20) +
10 x (Sta - 20); mana = base + min(Int, 20) + 15 x (Int - 20). Rating conversion at 60 (Q35): 10 hit rating = 1%, 14 crit rating = 1%, 10 haste rating = 1%,
for melee, ranged and spells alike (Forever turned Classic "+1% hit/crit" equip effects into ratings).

### 3b. Stat aggregation order (`computeCharacter`)
```
for each primary stat s:
  flat[s]  = classBase[s] + raceOffset[s] + bonus[s] + sum(weapon item stat s) + sum(effects{stat})
  final[s] = flat[s] x product(1 + pct/100) over effects{statPct}              (talents, racials, buffs; in that order)
health   = (baseHealth + f(Sta, 10) + sum(health)) x product(1 + healthPct);  mana likewise with 15 per Int (null when baseMana = 0)
AP       = (perLevel L + flat + perStr Str + perAgi Agi + bonus + item AP + effects) x product(1 + AP%)
SP[sch]  = bonus + item SP + effects + stat-derived spell power (aura 174)
crit     = baseCrit + Agi or Int / ratio + bonus + critRating/14 + effects (+ weaponCrit per slot)
hit      = bonus + hitRating/10 + effects;   haste = (product(1 + h/100) - 1) x 100 (multiplicative)
weapon   : perSwing = (min+max)/2 + weaponDamage + ammo dps x speed + AP/14 x speed (not wands); dps = perSwing / (speed / (1 + haste/100)); off hand x 0.5
```
Flat sources add, each % effect multiplies the running total. Every number is a `Stat {value, parts[]}`; the UI tooltips list the parts.

Base stats per race, class and level come from a manual table (`data/manual/base-stats.json`),
because client DB2 no longer ships the `gtChanceTo*` tables used in Classic.

## 4. Damage formulas

### Weapon (white and weapon-based specials)
```
weaponDmg = rand(min,max) + AP/14 × speed          (normalized: AP/14 × normSpeed for instant attacks)
specialDmg = weaponDmg × weaponPct + flatBonus
```
Use averages throughout, apart from proc modeling (see Simulation).

### Spells
```
avgBase = basePoints (+ realPointsPerLevel × (min(level, maxLevel) − baseLevel))
hitDmg  = (avgBase + coeff × spellPower(school)) × Π(talent/buff % mods)
dot     = per-tick likewise, × ticks; the coefficient of a periodic effect is PER TICK (Immolate 0.13 x 5 = 0.65); ticks can crit (Q47)
expected = P(hit) × [ (1 − crit) × hitDmg + crit × hitDmg × critMult ] × (1 − avgResist)
```
Phase 4 details: level scaling uses `effects[].perLevel` and `levels.max`; the rank is the highest with `levels.base <= level`; `spCoef` applies
only to non-physical schools (every physical effect carries the client default 1.0); weapon effects 17/58/121 add and 31 multiplies, in effect index
order (Backstab 1.5 W + 225, Q48); normalized speeds 1.7 dagger / 2.4 one-hand / 3.3 two-hand / 2.8 ranged / 1.0 Cat Form; off-hand strikes use the
Phase 3 off-hand factor. SpellModOp table (checked against all 447 talents): 0 direct damage, 1 duration, 3/12/23 value of effect 0/1/2, 7 crit,
8 all values, 10 cast time, 11 cooldown (own and category), 14 cost (rage in tenths), 15 crit damage bonus, 16 hit, 22 periodic damage; percent mods
multiply (Q52). Aura 79 applies by school; one from a weapon-restricted talent carries `slots` (Wand Specialization affects only the wand). Aura
598/580 are attack power from a stat percent (Mental Dexterity, Careful Aim). Scripted spells (`SCRIPTS`): Bloodthirst 45% AP, Eviscerate/Ferocious Bite
3% AP per combo point and Rip 6% (TBC values, Q53), Slice and Dice 6 s + 3 s per cp, Shank off hand, Arcane Wrath +5% max mana as spell power, Incinerate
+25% with Immolate, Judgement (judges the rotation's seal; Judgement of Command halved, Q58), Whirlwind with both weapons (Q56), Mutilate (two triggered
strikes). Crit rule: `SPELL_ATTR2_CANT_CRIT` spells never crit.

Coefficients come from `SpellEffect.EffectBonusCoefficient`. Classic's "spell cast below level 20" penalty
appears to be baked into the low-rank coefficients (Fireball r1 = 0.429), so do not apply it twice.

### Talent effects
Talents are data: each talent rank is a spell whose `SpellEffect` rows are aura effects.
The engine maps aura types to modifiers:

Checked in build 70888 (aura IDs follow the modern enum):

| Aura (EffectAura) | Meaning | Forever example |
|---|---|---|
| 107 ADD_FLAT_MODIFIER | Flat mod to spells matching `EffectSpellClassMask_*`; the op is `EffectMiscValue_0` (7 = crit chance, 10 = cast time ms, 14 = cost…) | Critical Mass: +2% crit/rank (op 7); Accelerant: −500 ms cast (op 10) |
| 108 ADD_PCT_MODIFIER | Percent mod, same masks and ops | Convection: −2% cost/rank (op 14) |
| 79 MOD_DAMAGE_PERCENT_DONE | % damage by school mask | — |
| 52 / 57 | Melee / spell crit chance | — |
| 54 / 55 | Melee / spell hit chance | Precision: aura 55, rank values 2/4/6 from a `TraitDefinitionEffectPoints` curve; the base points (6) hold the max-rank value |
| 42 PROC_TRIGGER_SPELL | Proc → triggered spell | — |
| 137 MOD_TOTAL_STAT_PERCENTAGE | % of a stat | Arcane Mind: +10% (plus a 108 effect) |
| 290 MOD_CRIT_PCT | Crit for melee, ranged **and** spells (Forever: Leader of the Pack, Moonkin Aura, Mongoose, Ruthless, Savage) | Phase 3 |
| 137 misc | `misc[1]` is a stat **bitmask** (8 = Int; Kings uses -1/31), fall back to `misc[0]` (0 Str .. 4 Spi, -1 all) | Phase 3 |
| 174 / 280 / 240 / 123 / 122 | Spell power from a stat % / armor penetration % (Serrated Blades) / expertise (unit unconfirmed, Q42) / spell penetration / off-hand damage % | Phase 3 |
| 13 / 319 / 342 / 65 / 30 | School spell power (misc[0] school mask) / melee haste / melee+ranged haste / spell haste / weapon skill | Phase 3 |
| 268 | Armor from a stat in Forever (Arcane Resilience), **not** attack power as labelled in `constants.py` (Q45) | ignored |
| **4 DUMMY** | Server-scripted, no data meaning | 22 talents have hand-written handlers (`src/engine/talents/special/handlers.ts`: Ignite, Fire Power, Flurry, Deep Wounds, Nightfall, ...); the rest stay in "not modeled" |

**Requirements (Phase 3):** a talent with `equipped` is active only while a matching weapon is equipped (weapon-specific auras 52/54/30 apply only to the
matching slots: Cruelty main/off hand, Furious Precision off hand only); shields are not modeled (Bastion always inactive, Q46); a non-zero `shapeshiftMask`
(cat/bear forms) is active only when the rotation's form matches (Phase 4). Abilities outside the rotation, unhandled DUMMY/proc auras and inactive
talents are listed under "Talents not modeled yet". Aura 79 and 107/108 effects are applied by the damage engine (Phase 4).

Forever changed many talent values (Precision 2/4/6% over its 3 ranks, Arcane Mind changed from Classic). So
**never hard-code Classic talent values**; read them from the generated data and only hand-code DUMMY behavior.
Rank values come from `TraitDefinitionEffectPoints` curves (`ranks[r].values` in `talents/<class>.json`);
`EffectBasePointsF` holds the **max-rank** value, so it is not a per-rank value (Mage Precision: base 6, curve 2/4/6).
Effects with no curve keep the base value for every rank (flagged in `report.multiRankWithoutCurve`, Q17).

Talents the generic mapper can't express (Ignite, Fire Power, Flurry, Nightfall, ...)
get **hand-written effect handlers** (22 in Phase 4, see the table in `docs/phase4-implementation-plan.md` section 7.2) keyed by talent spell ID in `src/engine/talents/special/`.
A coverage report lists every talent as `generic`, `special` or `unsupported`, so gaps are visible.

## 5. Pets

| Pet | Model [VERIFY Forever scaling] |
|---|---|
| Hunter pets | Level-60 base AP and damage by family; family damage modifier (manual table); talents (Unleashed Fury, Ferocity, Bestial Discipline…); pet crit/hit vs boss; Focus-limited specials (Claw/Bite) |
| Warlock demons | Imp (Firebolt spell model), Succubus (melee + Lash), Felhunter, Felguard if present; Demonic Sacrifice/Master Demonologist modifiers |
| Shaman totems, Mage Water Elemental (if present in Forever) | spell model, fixed duration |

Classic pets do not scale with owner stats, but Season of Discovery and later systems do. Whether Forever's do is
an **open question**, so the scaling factor is a single configurable constant per pet type.

## 6. Rotation and DPS

Two modes, sharing one evaluator:

1. **Analytical (instant, Phase 4)**: casts per minute per ability from a simple priority model, using
   averages. It recomputes on every click (~1-2 ms, test budget 5 ms), so the UI stays live.
2. **Simulation (Phase 5)**: event-driven combat sim over N iterations of a fight length T, in a Web Worker (`src/engine/sim`).
   It never computes damage: it samples `AbilityResult.parts` and `WhiteResult` from the Phase 4 evaluator (land roll, crit roll, uniform
   weapon/spell range). Output: mean DPS ± stdev, 95% CI, breakdown, resource timeline, combat log.

A rotation is a user-ordered **priority list** of `{ability, conditions}` (resource ≥ X, cooldown ready,
debuff missing, target HP < 20%…). Each class/spec ships default rotations.

**Analytical model (`src/engine/rotation`, Phase 4):** one rotation per spec (`data/manual/rotations.json`), the spec with the most points (ties: the first
dps spec). Per minute, entries in priority order take `n = min(cooldown/duration cap, time left / time per cast, resource left / cost)` casts; finishers
are bought as cycles with their builder casts; on-next-swing attacks (Heroic Strike) use the leftover resource and replace main-hand swings. Rage comes from
white damage (`7.5 x dmg / c(L)`, Q51), energy is 10/s, mana never limits (mana/s and time to OOM are reported). A DoT recast before it expires is clipped
(`min(casts, 60 / duration) x full DoT`). Procs: Seal of Command 7 PPM, Windfury Weapon (Q54). Two passes: pass 1 gives casts and crits per minute, the talent
handlers turn them into uptimes (Flurry, Improved Shadow Bolt, Deep Wounds, extra rage), pass 2 recomputes. Self-buffs (Shadowform, Aspect of the Hawk,
Hunter's Mark, Seal of Command, Slice and Dice) have 100% uptime. Tiers: 1 fully modeled, 2 generic model (some spec mechanics missing), 3 basic rotation for
tank/healer specs. Approximations: no cooldown collisions or GCD drift, averages for DoTs/buffs/procs; stance switching, execute phase, movement and cooldown
abilities (Death Wish, Arcane Power, Combustion, Rapid Fire, Blade Flurry, Adrenaline Rush) are out of scope for the analytical model (simulated in Phase 5). Entries with sim-only conditions (target health, aura, cooldown, time left), `burst` cooldowns and execute-only abilities are skipped ("simulation only").

**Simulation model (`src/engine/sim`, Phase 5):**
- *Event loop*: binary heap by (time, insertion). The player acts after every event: the priority list is walked top-down, the first usable entry is cast
  (off-GCD casts continue the walk). Busy means a pending cast/channel object. Channels are clipped after a tick when a higher entry is usable.
  Haste applies from the next swing; the GCD is not hasted (Q57).
- *Implicit rules per kind*: `dot` recast when <= its cast time is left; `maintain` every `everySec`; `finisher` needs `cp` combo points (buff/periodic
  finishers wait until the aura is gone); `builder` only the first learned builder, not at 5 CP; `burst` not while its buff is active; `nextSwing` is queued
  off the GCD and paid at the swing. An explicit `auraLeft` condition replaces the implicit refresh rule.
- *Dynamic buffs*: bursts, buff finishers and proc buffs re-run `prepareDamage(..., extraBuffs)` + `evaluateTarget` + `evaluateDamage` once per buff set
  (memoized), so stat/damage auras use the exact Phase 3/4 code.
- *Resources*: rage from damage (`7.5 x dmg / c(L)`, starts at 0), energy 10/s (full), mana from Spirit per 2 s tick with a five-second rule (talents with aura
  134, Evocation). Default **Unlimited mana is on**: gear v1 has no mana items, so a naked caster is out of mana after 40-60 s (-66% to -83% DPS).
- *Procs sampled* (15 talents: Ignite rolling, Flurry, Improved Shadow Bolt, Nightfall, Deep Wounds, Unbridled Wrath, Anger Management, Seal Fate, Ruthlessness,
  Weaponmaster/Hack and Slash, Arcane Concentration, Elemental Focus, Combustion) plus Seal of Command (7 PPM) and Windfury Weapon. Other handlers stay analytical
  averages and are listed as such in the results.
- *Execute phase*: target health falls linearly 100% to 0%; Execute/Hammer of Wrath usable below 20%; Execute adds 15 damage per extra rage and spends all rage (Q60).
- *Auto Shot*: waits for casts; a ranged cast (Aimed Shot) restarts its timer (Q63).
- Constants in `src/engine/sim/constants.ts` are tagged `[VERIFY]` (Q59-Q65).

Divergences simulation vs analytical (1000 x 180 s, max talents, boss): within about 3% for filler casters, DoT rotations, Subtlety/Assassination, feral, Retribution and
basic warrior; simulation higher for burst cooldowns and the execute phase (warriors +27% / +59%, arcane +4%) and Combat rogue (+15%: the analytical energy model buys no
Eviscerate); simulation lower for hunters (-8% to -9%: Aimed Shot restarts Auto Shot), cooldowns drifting behind long casts (Mind Blast, Fire Blast) and the unfinished last
cast. Cross-check builds C1-C8 (Frostbolt, SW:P/Mind Blast/Smite, Heroic Strike, Retribution, Destruction, Balance, feral cat, Subtlety) agree within 3%.
With mana modeled every caster without gear mana goes out of mana (gear v2 is Phase 7).

**Stat weights:** rerun with +X of each stat. DPS per stat point shows the "crit/hit increase" value of talents and gear.

**Talent impact view:** for each talent point, compute DPS with and without it, giving a "this talent = +x% DPS" tooltip.

## 7. Validation strategy

- Unit tests per formula against hand-computed examples.
- Golden tests: known Classic builds vs published sim values (expect drift where Forever differs).
- In-game ground truth: character-sheet values (AP, crit, hit, spell power) for a few captured
  gear sets, plus target-dummy damage logs. A tiny companion addon (stretch, Phase 7) can export these.
