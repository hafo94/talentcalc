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

## 3. Stat conversions [VERIFY all]

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

**Levels below 60 (Phase 7, `[VERIFY Q76]`):** Forever's client data has no player level-stat table, so `baseStatsAt` (`src/engine/stats/levels.ts`)
interpolates linearly between the Classic level-1 values (`base-stats.json level1`) and the level-60 table: with `t = (L - 1) / 59`,
`s(L) = round(s1 + (s60 - s1) x t)` for Str, Agi, Sta, Int, Spi, health and mana. Agility and Intellect per 1% crit scale with the class's base stat
(`agiPer60 x agi(L) / agi60`), so a naked character keeps the same crit from base stats at every level. Race offsets and the base crit constant are unchanged.
Talent points = level - 9, spell ranks = highest learnable, weapon skill 5 x L, reference mobs from `targets.json byPlayerLevel`; weapons, ammo and buffs
(`minLevel`) are filtered by level. Rating conversions stay level-60 values (L26).

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

Data: `pets/<owner>.json` (pipeline v4: abilities, family passives, passives modified by owner talents) and `data/manual/pets.json`
(`[VERIFY]`: base stats, owner scaling, focus, sacrifice / Master Demonologist / Soul Link spell references).

- **Stats** (`src/engine/pets/stats.ts`): the Phase 3 `computeCharacter` with a pet base-stat table (class key = the owner, race `PET`): Str 136, Agi 102 ...,
  AP = 2 Str - 20 = 252, melee 45-75 per 2.0 s, crit 5% melee and spell, weapon skill 300; the Imp has no melee (`noMelee`). Every number is a `Stat` with parts.
- **Owner scaling (Q5, toggle, on by default)**: hunter pets get 22% of the hunter's ranged attack power as AP and 12.8% as spell power; demons 57% / 15% of the
  warlock's max(fire, shadow) spell power; pets inherit the owner's hit (hunter: ranged hit, warlock: spell hit). Crit and haste are not inherited
  (TBC rule, Q70). Off = base stats only. All `[VERIFY]` (Q69-Q71).
- **Auras**: the family passive (aura 79, e.g. Cat +10%), the passives that owner talents modify through spell masks (Unleashed Fury, Ferocity, Bestial
  Discipline, Unholy Power, Improved Imp, Improved Sayaad) and active pet buffs, valued with the owner's talent mods.
- **Outcome tables**: the pet is evaluated with the Phase 4 engine on its own tables (8% miss, 6.5% dodge, 40% glancing at 65%, 2.6% crit vs a level-63 boss;
  spells 17% miss, 6% resist).
- **Rotation** (`petRotation`): from the data, cooldown and DoT abilities longest cooldown first, then the filler (Bite > Claw, Lightning Breath, Firebolt,
  Lash of Pain). Focus 6/s (+20% Bestial Discipline), max 100. Frenzy is an analytical uptime in pass 2 (`30 x (1 - exp(-crits x chance x 8 / 60))` melee haste).
- **Owner effects** (`resolvePet`): Focused Fire (+2% both), Master Demonologist (the active demon's aura at the talent rank value, both), Soul Link (+3% both),
  Demonic Knowledge (spell power from the level, both). Demonic Sacrifice (owner only) needs the talent and is cancelled by a summoned demon unless Demonic Pact
  is taken and the demon differs. Lone Wolf turns off with a pet. Bestial Wrath (+50% pet damage, 18 s) is a pet burst: simulation only.
- **Pet level = player level (Phase 7, Q77)**: `petBaseAt` interpolates the primary stats from `pets.json owners.*.level1` (22/20/22/20/20) to the level-60 base; melee damage is `min x (L - floor(L/4)) / 45` to `max x (L + floor(L/4)) / 75` (CMaNGOS formula).
- Not modeled: other summons (L22), pet raid buffs (L24), Doomguard, Felguard.

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
white damage (`7.5 x dmg / c(L)`, Q51), energy is 10/s, mana never limits (mana/s and time to OOM are reported). A buff or DoT finisher with a lower-priority finisher below it (Slice and Dice above Eviscerate) is refreshed every `duration + cycle/2` instead of `duration` (L8: the lower finisher spends the combo points while the aura is up). A DoT recast before it expires is clipped
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
- *Finisher pooling (L8)*: a finisher blocked only by its resource keeps the combo points; lower finishers are skipped until it is affordable.
- *Pets*: the pet is its own actor (a `FightModel` run by the same `Fight` class with its own seeded RNG stream `petIterationSeed`), focus like energy, strict priority (it waits for a ready higher focus entry), Frenzy and Bestial Wrath sampled.
- *Execute phase*: target health falls linearly 100% to 0%; Execute/Hammer of Wrath usable below 20%; Execute adds 15 damage per extra rage and spends all rage (Q60).
- *Auto Shot*: waits for casts; a ranged cast (Aimed Shot) restarts its timer (Q63).
- Constants in `src/engine/sim/constants.ts` are tagged `[VERIFY]` (Q59-Q65).

Divergences simulation vs analytical (1000 x 180 s, max talents, +300 spell power, boss; "total" includes the pet): within about 3% for filler casters, DoT rotations,
Subtlety/Assassination (-2.3%), Combat rogue (+0.4% after the L8 fix), feral, basic warrior and Demonology/Destruction/Affliction warlocks with a pet (-1.3% to +0.5%);
simulation higher for burst cooldowns and the execute phase (warriors +27% / +59%, arcane +4%, Retribution +17.8% from Hammer of Wrath); simulation lower for hunters
(-3% Beast Mastery, -6.7% Survival, -8.1% Marksmanship whose Lone Wolf turns off with a pet; Aimed Shot restarts Auto Shot, Q63), cooldowns drifting behind long casts
and the unfinished last cast. Pet DPS agrees within about 1% except Bestial Wrath (simulation only, +10-12% pet DPS in 180 s). Demonology without a pet is 191.9, with
Demonic Sacrifice of the Imp 220.7, with an active Imp 288.0. Cross-check builds C1-C10 and pet builds P-C1..P-C3 agree within 3%.
With mana modeled every caster without gear mana goes out of mana (gear v2 is Phase 7). The finding that Slice and Dice (+30% haste) is worth less than the Eviscerates its
energy buys (148.6 vs 134.4 DPS) is real with Forever's numbers; the default keeps the Classic-style priority.

**Stat weights:** rerun with +X of each stat. DPS per stat point shows the "crit/hit increase" value of talents and gear.

**Talent impact view:** for each talent point, compute DPS with and without it, giving a "this talent = +x% DPS" tooltip.

## 7. Validation strategy

- Unit tests per formula against hand-computed examples.
- Golden tests: known Classic builds vs published sim values (expect drift where Forever differs).
- In-game ground truth: character-sheet values (AP, crit, hit, spell power) for a few captured
  gear sets, plus target-dummy damage logs. A tiny companion addon (stretch, Phase 7) can export these.

## 8. Insight (Phase 7)

All insight numbers are differences of the analytical `derive` (`reference: false`, no reference rows), never a second implementation of a rule.

- **Talent impact** (`src/state/insight.ts`): `snapshot` = total DPS (owner + pet) and the key stats of one evaluation. The next point is the snapshot with the node at
  `rank + 1` minus the baseline, the last point the baseline minus the node at `rank - 1` (point rules are ignored: a locked talent shows what its first point adds).
  Both use the panels' rotation rule (the editor's rotation, else the spec with the most points), so the tooltip predicts the Damage panel after the click; when the point
  changes the leading spec the tooltip says "Rotation becomes: ...". Percent = delta / baseline x 100. Key stats shown when the delta is >= 0.5 (points) or >= 0.005 (%).
- **Tree contribution**: baseline DPS minus DPS without that tree's points (0 for a tree without points). **Heat map**: the next-point DPS of every talent.
- **Stat weights** (`src/state/weights.ts`): paired evaluations with more of one bonus stat (AP/RAP +50, spell power +25, Str/Agi/Int +25, crit/spell crit/haste +1%,
  weapon skill +5). The reference stat is the power stat (AP, ranged AP, spell power) with the most DPS per point (ties go to the more specific one); EP = DPS per point /
  reference DPS per point. Hit is measured as the average DPS per 1% from the current hit up to the cap (this handles the suppressed first 1% vs a boss) and, separately, above
  the cap (+1% from the cap); at or above the cap only "above the cap" is shown.
- **Simulated weights** (`src/engine/sim/weights.ts`): every variant runs with the same seed (common random numbers), and a pair's 95% CI comes from the per-iteration
  differences, which is far narrower than two independent runs.
- **Compare**: build A (pinned) and B (current) are each evaluated against their own selected target with the same code as the panels; the table shows B - A.
