# Data sources and research findings

Last researched: 2026-11-12, WoW Forever build **1.60.1.70888** (product `wowf`).

## Where the data comes from

[wago.tools](https://wago.tools) exports every client DB2 table as CSV, per build:

```
https://wago.tools/api/builds                          # all products/builds (JSON); Forever = "wowf"
https://wago.tools/db2/<Table>/csv?build=<version>     # one table as CSV
```

`tools/research/fetch_db2.sh [BUILD] [OUT_DIR]` downloads every table we need (including the Phase 1 additions
`ItemDamageRanged`, `ItemDamageThrown`, `ItemDamageWand`, `RandPropPoints`, `SpellRadius`, `ManifestInterfaceData`,
`SpellDescriptionVariables`, `SpellXDescriptionVariables`).
`tools/pipeline/fetch_era_items.sh [ERA_BUILD]` downloads the Classic Era `ItemSparse` (build 1.15.9.70576, `wow_classic_era`)
into `data/raw/1.15.9.70576/`; it is used only as a weapon fallback (see below).
Raw CSVs go in `data/raw/<build>/`, which is git-ignored, so they are never committed.
The production pipeline (`tools/pipeline/build_data.py`) turns them into `data/generated/<build>/`, which is committed.

Wowhead blocks automated access (HTTP 403), so it is not used as a data source.
Use it only for manual spot checks.

## Key finding 1: Forever talents are NOT the Classic Era talents

Forever still ships the legacy `Talent`/`TalentTab` tables, but they are byte-for-byte
the Classic Era layout and are **not what the game uses**. The real Forever trees
live in the retail-style **Trait system**:

| Table | Meaning |
|---|---|
| `SkillLineXTraitTree` | 9 rows: one TraitTree per class (keyed by one spec's SkillLine) |
| `TraitNode` | Node with `PosX`/`PosY` (layout), `Type` (0 = normal, 1 = choice), `Flags` |
| `TraitNodeXTraitNodeEntry` → `TraitNodeEntry` | Node's entries; `MaxRanks` |
| `TraitDefinition` | `SpellID` of the talent (rank 1), optional override name/icon |
| `TraitEdge` | Prerequisite arrows (`LeftTraitNodeID` → `RightTraitNodeID`) |
| `TraitNodeGroup(XTraitNode/XTraitCond)` + `TraitCond` | Tier gating: `SpentAmountRequired` points spent **in a group** (the spec) |
| `TraitCurrency` 3820 | Talent points: max **51**, 1 per level from 10 to 60 |
| `TraitDefinitionEffectPoints` + `Curve`/`CurvePoint` | Per-rank effect values for multi-rank talents |

Layout facts we found:
- Each class tree holds its 3 specs side by side, as 3 X-position clusters. Rows are 600 units apart in Y.
- 7 tiers with gates at 0/5/10/15/20/25/30 points in that spec, so the 31-point capstone survives.
- Many new talents come from Season of Discovery or later expansions. Examples: Mage *Arcane Blast*,
  *Heating Up*, *Fingers of Frost*; Druid *Wild Growth*; Shaman *Lava Burst*, *Riptide*;
  Rogue *Mutilate*; Warlock *Pandemic*. The full list is in `docs/research/talents-summary.md`.
- Rank counts often differ from Classic. For example, Fire *Impact* has 3 ranks instead of 5, and *Fire Power* 3 instead of 5.
- `Flags = 8` nodes look disabled or hidden, and older draft trees (1081, 1083) are all flag 8.
  The pipeline excludes them by default (`--include-hidden-nodes` keeps them, marked `hidden: true`) until verified in game (Q6/Q24).
- Trees 1187–1189 are account-wide **"Legacy"** trees: non-combat perks paid with currency 4225, max 16.
  They are out of scope for v1.

### Phase 1 decisions: how the tree layout is decoded

- **One spell for all ranks.** A Forever talent has a single spell (the rank-1 ID in `TraitDefinition.SpellID`).
  Legacy rank-2+ spell IDs mostly have no `SpellEffect`/`SpellName` rows (only 102 of 925 exist), so the pipeline never
  uses the legacy `Talent` rank spells.
- **Per-rank values come from curves.** For each `SpellEffect` row of the talent spell: if `TraitDefinitionEffectPoints`
  has a row for (definition, `EffectIndex`), the value at rank r is `CurvePoint` (`Pos_0` = rank, `Pos_1` = value) of its `Curve`
  (all 663 rows are OperationType 0 = Set and Curve.Type 0); otherwise it is the spell's `EffectBasePointsF`, constant over
  ranks. `EffectBasePointsF` usually equals the **max-rank** curve value (Lightning Reflexes: base 15, curve 3..15), so it must
  not be read as a per-rank value (Mage Precision: base 6, curve 2/4/6). Where base and curve disagree the pipeline trusts the
  curve and lists the case in `report.curveBaseMismatch` (Q16); effects of multi-rank talents without a curve are listed in
  `report.multiRankWithoutCurve` (Q17).
- **Spec membership** = the three `TraitCond.TraitNodeGroupID` scope groups of conditions with `SpentAmountRequired == 30`
  (exactly 3 per tree; disjoint; they cover every node). Spec order is left to right by minimum `PosX`; names, icons and
  backgrounds come from `TalentTab` rows of the class mask sorted by `OrderIndex`.
- **Tier / requiredPoints** = the largest `SpentAmountRequired` over the conditions attached (via `TraitNodeGroupXTraitCond`)
  to any group containing the node (0, 5, ..., 30); `tier = gate/5 + 1`. Tier is never computed from `PosY`, which has typos
  (105003 PosY 39300, 104982 5740, 105865 21300). Two dummy conditions (43478, 50974) with amount 0 / group 0 are ignored.
- **Column** = `(PosX - SPEC_BASE_X[spec]) / 600` with `SPEC_BASE_X = [1020, 5020, 9080]`. Invalid values are repaired with the
  **twin rule** (a flag-8 node of the same spec with the same spell and a valid column) and then `POSITION_OVERRIDES`;
  otherwise the build fails. Node 104982 (Lightning Reflexes) has PosX 102800, a x10 typo of 10280, and is a live Survival tier-6
  col-2 talent replacing flag-8 node 110859. This was the stray Hunter "Spec 3" (Q12). Node 105865 (Holy Specialization) is fixed
  through its twin 110855.
- **Tier-gate scope.** Each gating condition's scope group is the set of nodes whose points count toward that gate.
  `spec.tierGates[]` exports those node IDs. Improved Serpent Sting (105003) and Holy Specialization (105865) are missing from
  some scopes (`report.gateScopeAnomalies`, Q21).
- **Prerequisites** come from `TraitEdge`: keep an edge only if both ends are included nodes of the same class tree; orient it
  from the lower tier to the higher (equal tier: Left to Right); deduplicate. 69 arrows; each node has at most one prerequisite;
  the prerequisite must be maxed (Classic rule). `TraitEdge.Type` and `VisualStyle` are ignored.
- **Choice nodes** (`TraitNode.Type = 1` or several entries): none exist in the 9 class trees (the only Type 1 node is in Legacy tree 1188); the
  pipeline would export `choices[]` and a warning (Q10).
- **Talent points.** Currency 3820 (max 51): levels 10..60 plus levels 5..9 granted by the account-wide Legacy "Talented" perk (Q22).
  Totals: 447 included nodes, 23 hidden (flag 8).
  The Talented perk is Legacy tree 1188, node 110298 (Type 1, 5 entries), spell 1225474 "Talented" ("You gain talent points every
  level starting at level $s1 instead of starting at level 10, but you still may not have more than 51 total talent points"). The
  five `TraitCurrencySource` rows for levels 5..9 point at its entries (entry order = rank 1..5, level = 10 - rank). The cap of 51
  is `TraitCurrency.SourcedMax`. Pipeline: `perk` object on those sources in `classes.json`.

### Spells (Phase 1)

Spell set = class **ability** spells (the 27 spec skill lines, `SkillLine.CategoryID == 7`, `Flags` 1040 or 66576, with
`AcquireMethod != 3`) + every **talent** spell + the transitive closure of spells **triggered** by them (`EffectTriggerSpell`, and
the base points of aura 332 effects). 2,300 spells. `AcquireMethod 3` rows are Season of Discovery rune spells and are excluded
(`report.excludedRuneSpells`); the Engraving line (2851) is not referenced by any talent (Q15). Only Difficulty-0 rows of
`SpellEffect`, `SpellMisc`, `SpellLevels`, `SpellCooldowns`, `SpellCategories` and `SpellAuraOptions` are used.
Tooltip text (`$s1`, `$d`, `$o2`, `${...}`, `$?...[..][..]`, plurals) is resolved per talent rank by `tooltips.py`;
unresolvable tokens stay verbatim and are listed (`report.unresolvedTokens`).

Generated references:
- `docs/research/talents/<class>.md`: every node, with tier, column, unlock requirement, ranks, prereqs and spell IDs
- `docs/research/talents-summary.md`: counts per spec and what is new
- `docs/research/class-spells.md`: class abilities and their rank chains (from `SkillLineAbility`)

## Key finding 2: spell numbers are in the client data (unlike Classic Era)

The Classic Era DB2 has `EffectBasePointsF = 0` for damage spells. Forever ships real values:

| Field (`SpellEffect`) | Use |
|---|---|
| `EffectBasePointsF`, `Variance` | Average base value; damage range = base × (1 ± Variance/2) |
| `EffectRealPointsPerLevel` + `SpellLevels` (BaseLevel/MaxLevel) | Level scaling |
| `EffectBonusCoefficient` | Spell power coefficient |
| `BonusCoefficientFromAP` | Attack power coefficient |
| `Effect`, `EffectAura`, `EffectAuraPeriod` | What it does: 2 = school damage, 6 = apply aura (3 = periodic damage), and so on |
| `EffectMiscValue_0`, `EffectSpellClassMask_*` | What a talent aura modifies (spell family masks) |

Sanity check: Fireball rank 1 (133) gives base 18, variance 0.444, so 14–22 damage. That matches Classic.
**Open question:** Fireball rank 11 (10151) gives 451 base, so about 397–505. Classic is 561–715.
Forever may have retuned it, or a scaling step is missing. Verify against the in-game tooltip
before trusting high-rank numbers (see OPEN_QUESTIONS.md).

Other spell tables: `SpellMisc` (school, cast-time index, range, duration),
`SpellCastTimes`, `SpellCooldowns`, `SpellPower` (mana cost), `SpellDuration`,
`SpellClassOptions` (spell family, class mask: this links talents to the spells they modify),
`SpellLevels`, `SpellAuraOptions` (proc chance and charges), `SpellProcsPerMinute`.

## Key finding 3: weapons can be reconstructed

`ItemSparse` has no min/max damage columns. Damage is computed from the item level and quality:

```
dps    = table[ItemLevel].Quality_<OverallQualityID>
avg    = dps x ItemDelay/1000
min    = floor(avg x (1 - DmgVariance/2))
max    = floor(avg x (1 + DmgVariance/2) + 0.5)
```

**Table selection** (by `ItemSparse.InventoryType`, `Item.SubclassID`; validated against the Classic Era client's explicit
damage for every weapon present in both builds):

| InventoryType | Subclass | Table |
|---|---|---|
| 13 one-hand, 21 main hand, 22 off hand | melee | `ItemDamageOneHand` |
| 17 two-hand | any | `ItemDamageTwoHand` |
| 15 / 26 ranged | 2 bow, 3 gun, 18 crossbow | `ItemDamageRanged` (not TwoHand) |
| 26 | 19 wand | `ItemDamageWand` |
| 25 thrown | 16 thrown | `ItemDamageThrown` |
| 24 ammo (`Item.ClassID` 6) | 2 arrow, 3 bullet | `ItemDamageAmmo` (dps rounded to 2 decimals) |

`ITEM_FLAG2_CASTER_WEAPON` (`Flags_1 & 0x200`) would switch to the `...Caster` tables; no weapon has the flag today.
`QualityModifier` is **ignored** (Atiesh, Anathema, Benediction, Thunderfury all match Era without it).
Cross-check against Era: 771 of 772 comparable weapons match exactly.

Verified: Sulfuras 17182 = 223-372 @3.7; Arcanite Reaper 12784 = 153-256 @3.8; Rhok'delar 18713 = 89-166 @2.9 (Ranged table);
**Thunderfury 19019 = 82-153 @1.9** plus 16-30 nature. The earlier "Classic 44-82" reference was wrong: the Classic Era client's
own `ItemSparse` (explicit `MinDamage_0/MaxDamage_0`) stores 82-153 plus a secondary 16-30 (`MinDamage_1/MaxDamage_1`).
The school of the secondary damage is not in the DB2 data (manual override `data/manual/weapon-overrides.json`, Q20).
Resolved as Q8: the formula was right, the reference was wrong.

**Stats** of Forever items: `value = rhu(StatPercentEditor_k x RandPropPoints[ItemLevel].<Q>F_<slot> / 10000)` where Q is
Epic (quality 4-6), Superior (3) or Good (0-2) and slot is 0 for two-hand, 3 for one-hand/main/off hand, 4 for ranged/thrown/wand
(Thunderfury: Agi 5, Sta 8, fire res 8, nature res 9; Sulfuras: Str 12, Sta 12, fire res 30).

**Coverage gap.** Forever `ItemSparse` holds only 1,785 of the 3,871 weapons in `Item`; most classic raid and dungeon weapons are
missing (Ashkandi, Felstriker, Ironfoe, ...), probably delivered by hotfixes that wago.tools does not export (Q18). The pipeline
therefore falls back to the Classic Era `ItemSparse` (default on; `--no-era-fallback` disables it): damage, speed, stats and
resistances come from Era and the weapon is marked `source: "classic_era"`. Forever reworked the stats of about 40% of weapons
present in both builds, so fallback stats are unverified (Q19). Filters: monster/test/placeholder names, misc and fishing-pole
subclasses, item level <= 1, required level > 60, zero delay, zero damage (counts in `report.weaponFilters`).

## Phase 3 findings (character and gear)
- **New tables:** `SpellEquippedItems` (28 talent spells need a weapon; masks 173555 melee, 136546 two-handed, 41105 + invType bit 22 off hand, 262156 ranged,
  524288 wand, item class 4 subclass 64 shield) and `CharBaseInfo` (race/class combos). `SpellShapeshift` marks form-only talents (mask 145 cat/bear).
- **Combos:** 6 differ from Classic: Undead Paladin, Dwarf Shaman, Human Hunter, Gnome Priest, Orc Mage, Troll Warlock (Q39).
- **Proficiencies** come from `SkillLineAbility` weapon skill lines (identical to `SkillRaceClassInfo`); differences from Classic: Rogues get one-hand axes, Druids get
  polearms (Q38). Dual wield is skill line 118: Warrior, Hunter, Rogue.
- **Buff values** are read from Forever `SpellEffect` and mostly differ from Classic (Battle Shout 139 AP, Blessing of Might 133, Mark of the Wild +16, Fortitude +70, Strength of
  Earth 53, Grace of Air 89, Curse of Recklessness 505, Expose Armor 2250 at 5 cp; Leader of the Pack, Moonkin, Mongoose and Slip'kik are all-crit aura 290; Warchief's Blessing
  haste includes spells; Juju Might, Rallying Cry and Fengus also give ranged AP / spell power). The full table is in `phase3-implementation-plan.md` 1.4; the pipeline
  re-checks every manual value (`effects[].src`).
- **World buffs** say "No effect while in a raid instance." in their aura descriptions (Q44).
- **Racials** were reworked (no weapon-skill racials remain); see `data/manual/racials.json` and Q37.
- **Rating evidence (Q35):** Core Marksman Rifle hit 10, Heartseeker/Rhok'delar crit 14, Fist of Cenarius crit 28 (Classic +2% spell crit) -> 10 hit rating = 1%, 14 crit rating = 1%.

## Icons

`ManifestInterfaceData` (`ID` = file data ID, `FileName`) maps `SpellIconFileDataID` / `IconFileDataID` to the icon file name:
lower-case, `.blp` stripped (135812 -> `spell_fire_flamebolt`, 626001 -> `classicon_mage`). ID 0, a missing row or `temp` gives
`icon: null` (`report.missingIcons`). Images are loaded from `https://render.worldofwarcraft.com/us/icons/56/{icon}.jpg`
with `https://wow.zamimg.com/images/wow/icons/large/{icon}.jpg` as fallback; both return HTTP 200 for the two examples above.
Icons are not bundled in v1; `tools/pipeline/check_icons.py` lists names missing on both CDNs (Q9, resolved).

## Targets (creature stats by level)

`ExpectedStat` (ExpansionID −2, one row per level 1–63+) has per-level `CreatureArmor`,
`CreatureHealth`, `CreatureAutoAttackDps` and `ArmorConstant`:

| Level | Armor | ArmorConstant |
|---|---|---|
| 10 | 518 | 1250 |
| 20 | 861 | 2100 |
| 30 | 1212 | 2950 |
| 40 | 1980 | 3800 |
| 50 | 3018 | 4650 |
| 60 | 3566 | 5500 |
| 63 | 3731 | 5755 |

The level-63 armor matches the Classic boss value of 3731. `ArmorConstant` matches `400 + 85 x level` (asserted by the
pipeline for levels 1..63), so the armor formula is confirmed by data. `targets.json` holds levels 1..63 and, for every
player level 1..60, the five presets (boss +3, elite +2, same level, low-armor boss = boss armor x 0.5, custom).

## Pets

Forever's client data holds most of a pet. Verified on build 70888 (details in `docs/phase6-implementation-plan.md` section 1):
- Each `CreatureFamily` (27 rows) has a skill line (`SkillLine_0`) that lists the pet's abilities and passives. `PetTalentType` 1 = exotic (Core Hound).
- The **owner** is the class whose scaling aura is in the skill line: "Hunter Pet Scaling" 415429 or "Warlock Pet Scaling" 416189 (aura base points are 0, so the numbers are server-side). A demon also needs a `Summon <name>` warlock ability. Result: 19 hunter families and 5 demons (Imp, Voidwalker, Succubus, Incubus, Felhunter). Felguard (no summon spell), Doomguard (ritual) and Remote Control are skipped (`report.petsSkipped`).
- The **family passive** ("Tamed Pet Passive (DND)", aura 79 misc 1) holds the damage modifier (Cat +10, Raptor +10, Bear -9, Boar -10 ...).
- **Owner talents modify pet passives through spell masks**: Unleashed Fury (op 3) -> 8875 aura 79; Ferocity -> 19591 aura 290 crit; Bestial Discipline -> 19589 aura 110 focus; Frenzy (op 18) -> 20784 proc -> 19615 +30% melee haste 8 s; Unholy Power -> 18727-18730; Improved Imp on Firebolt; Improved Sayaad on Lash of Pain.
- Pet abilities (Claw, Bite, Lightning Breath, Firebolt, Lash of Pain ...) are ordinary spells with no attack power coefficient.
- Demonic Sacrifice, Master Demonologist and Soul Link auras are chosen by server script, so which spell belongs to which demon is hand-entered in `data/manual/pets.json` (validated against `SpellEffect`).
- Base stats, focus regeneration and the owner scaling coefficients are not in the data: `data/manual/pets.json`, tagged `[VERIFY]` (Q5, Q69-Q74).

## Phase 4 findings (spells, 70888)
- **Rank chains:** a talent-granted ability's chain starts at rank 2 (rank 1 is the talent spell); rank = highest `levels.base <= level`; value = `base + perLevel x (min(L, levels.max) - levels.base)`.
- **Fields:** `castMs` -1000000 on instant hunter shots (= instant); `gcdMs` 0 = off the GCD; category cooldowns are shared (Aimed/Multi-Shot, Arcane Shot/Summon Hawk, Holy Strike/Hammer of the Righteous, Fire Blast); rage costs are already / 10; `pct` costs are % of base mana; `defenseType` 1 magic, 2 melee, 3 ranged; `attributes[2] & 0x20000000` is CANT_CRIT; mechanic 15 is a bleed (ignores armor); `apCoef` is never set (finisher AP scaling is server-side); every physical effect has `spCoef` 1.0 (client default).
- **Effects used:** 2 school damage; aura 3/53 periodic damage; aura 23 periodic trigger (channel missiles); aura 226 periodic dummy (not exported, not modeled: Blizzard, Volley, Consecration); 17/58 weapon damage, 121 normalized, 31 weapon percent; 30 energize (misc[0] 4 combo points, 3 energy); 64 trigger spell (Mutilate); 77 script effect (Judgement).
- **Judgements:** a Seal stores its judgement spell in a DUMMY effect's base points (Seal of Command r5 20920 -> 20968 -> 20966, 356 Holy, coef 0.429). The pipeline follows them only into spells named "Judgement of ..." (Seal of Fury's DUMMY base 707 would otherwise pull in Immolate): +40 spells.
- **SpellModOp** (aura 107/108 `misc[0]`) values are tabulated in `docs/CALC_MODEL.md` section 4; Arcane Instability has op 0 for all spells and op 22 for spells with a DoT part (op 0 does not touch periodic damage).
- **Forever changes:** Shank, Holy Strike, Arcane Wrath, Sniper Shot, Summon Hawk, Bane of Agony/Doom, Incinerate, Seal of Fury, Hammer of the Righteous, Windfury Weapon (2 extra attacks, 333 AP), Lightning Overload, Mutilate (triggered 1241586/1241590). Multi-Shot has one rank. Rogue poisons are item enchants (not in the spell data). Aura 598 = attack power from a stat percent, 580 = ranged attack power from a stat percent. Fire Vulnerability (22959) and Shadow Weaving (15258) use aura 270 (3% x 5 stacks, 2% x 5).
- **Spell values are Forever data, not Classic** (Q2): Fireball r12 483 (Classic 678 avg), Shadow Bolt r10 268 (510), Frostbolt r11 475 (535), Lightning Bolt r10 353 (452), Starfire r7 533 (588).

## Refresh procedure (when a new Forever build ships)

1. Run `curl -s https://wago.tools/api/builds` and read `.wowf[0].version`.
2. Run `tools/research/fetch_db2.sh <build>`.
3. Run `python3 tools/research/extract_research.py data/raw/<build> docs/research`, then check `git diff docs/research` to see what changed.
3b. `fetch_db2.sh` also fetches `SpellEquippedItems` and `CharBaseInfo` (Phase 3).
4. Optionally run `tools/pipeline/fetch_era_items.sh` (Classic Era `ItemSparse`, weapon fallback).
5. Run `python3 tools/pipeline/build_data.py --build <build>` and the tests
   (`python3 -m unittest discover -s tools/pipeline/tests -t tools -v`); review `data/generated/<build>/report.json`.
