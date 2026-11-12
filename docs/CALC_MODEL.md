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
| Glancing | 40% of white hits, −30% damage at 300 skill (−5% at 308+) |
| Block | 0 from behind |
| Crit | crit% − 1.8% boss suppression (−3% with level-based suppression), capped by the remaining table |
| Hit | remainder |

Yellow (special) attacks use a two-roll system: miss/dodge/parry first, then crit separately, with no glancing.

### Ranged
Same as melee, but no glancing and no parry from behind. Hunter crit from Agi.

### Spells
| | Value [VERIFY] |
|---|---|
| Hit vs +3 | 83%; +hit adds up to a 99% cap (16% hit) |
| Crit | base + Int / ratio + gear crit; crit = 150% damage (200% with talents such as Ice Shards) |
| Resistance | binary spells: full resist only; non-binary: average partial resist from target resistance (bosses 0 + level 24 → ~6%) |

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

Until the level selector exists (Phase 7), L = 60. ExpectedStat armor is an average
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
dot     = per-tick likewise, × ticks; coefficient applies to the whole DoT
expected = P(hit) × [ (1 − crit) × hitDmg + crit × hitDmg × critMult ] × (1 − avgResist)
```
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
| **4 DUMMY** | Server-scripted, no data meaning | **Ignite, Fire Power**: these need hand-written handlers |

Forever changed many talent values (Precision 2/4/6% over its 3 ranks, Arcane Mind changed from Classic). So
**never hard-code Classic talent values**; read them from the generated data and only hand-code DUMMY behavior.
Rank values come from `TraitDefinitionEffectPoints` curves (`ranks[r].values` in `talents/<class>.json`);
`EffectBasePointsF` holds the **max-rank** value, so it is not a per-rank value (Mage Precision: base 6, curve 2/4/6).
Effects with no curve keep the base value for every rank (flagged in `report.multiRankWithoutCurve`, Q17).

Talents the generic mapper can't express (Ignite rolling, Seal twisting, Nightfall procs…)
get **hand-written effect handlers** keyed by talent spell ID in `src/engine/talents/special/`.
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

1. **Analytical (instant)**: casts per minute per ability from a simple priority model, using
   averages. It recomputes on every click (<5 ms), so the UI stays live.
2. **Simulation (accurate)**: event-driven combat sim over N iterations of a fight length T, in a Web Worker.
   It models GCD, cast times, swing timers, cooldowns, resources (mana, rage, energy, focus),
   procs, DoT ticks and crit/hit RNG with a seeded PRNG.
   Output: mean DPS ± stdev, a damage breakdown, and timelines.

A rotation is a user-ordered **priority list** of `{ability, conditions}` (resource ≥ X, cooldown ready,
debuff missing, target HP < 20%…). Each class/spec ships default rotations.

**Stat weights:** rerun with +X of each stat. DPS per stat point shows the "crit/hit increase" value of talents and gear.

**Talent impact view:** for each talent point, compute DPS with and without it, giving a "this talent = +x% DPS" tooltip.

## 7. Validation strategy

- Unit tests per formula against hand-computed examples.
- Golden tests: known Classic builds vs published sim values (expect drift where Forever differs).
- In-game ground truth: character-sheet values (AP, crit, hit, spell power) for a few captured
  gear sets, plus target-dummy damage logs. A tiny companion addon (stretch, Phase 7) can export these.
