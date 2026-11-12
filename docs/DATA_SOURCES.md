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

`CreatureFamily` (27 rows) has the families. Hunter pet damage modifiers and pet stat formulas
are not in client data. They will be hand-entered constants in `data/manual/pets.json`,
with sources cited.

## Refresh procedure (when a new Forever build ships)

1. Run `curl -s https://wago.tools/api/builds` and read `.wowf[0].version`.
2. Run `tools/research/fetch_db2.sh <build>`.
3. Run `python3 tools/research/extract_research.py data/raw/<build> docs/research`, then check `git diff docs/research` to see what changed.
4. Optionally run `tools/pipeline/fetch_era_items.sh` (Classic Era `ItemSparse`, weapon fallback).
5. Run `python3 tools/pipeline/build_data.py --build <build>` and the tests
   (`python3 -m unittest discover -s tools/pipeline/tests -t tools -v`); review `data/generated/<build>/report.json`.
