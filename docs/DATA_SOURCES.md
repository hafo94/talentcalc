# Data sources and research findings

Last researched: 2026-11-12, WoW Forever build **1.60.1.70888** (product `wowf`).

## Where the data comes from

[wago.tools](https://wago.tools) exports every client DB2 table as CSV, per build:

```
https://wago.tools/api/builds                          # all products/builds (JSON); Forever = "wowf"
https://wago.tools/db2/<Table>/csv?build=<version>     # one table as CSV
```

`tools/research/fetch_db2.sh [BUILD] [OUT_DIR]` downloads every table we need.
Raw CSVs go in `data/raw/<build>/`, which is git-ignored, so they are never committed.

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
  Per-rank values therefore can't come from the old rank spells. They come from
  `TraitDefinitionEffectPoints` curves, or from scaling the rank-1 spell.
- `Flags = 8` nodes look disabled or hidden, and older draft trees (1081, 1083) are all flag 8.
  Exclude them until verified in game.
- Trees 1187–1189 are account-wide **"Legacy"** trees: non-combat perks paid with currency 4225, max 16.
  They are out of scope for v1.

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

`ItemSparse` has no min/max damage columns. Damage is computed:

```
dps    = ItemDamage{OneHand,TwoHand,...}[ItemLevel].Quality_<quality>
avg    = dps × ItemDelay/1000
min/max = avg × (1 ∓ DmgVariance/2)
```

Verified: Sulfuras (17182) gives 223–372 @ 3.7, which matches the in-game numbers. Some items carry
extra modifiers. Thunderfury (19019) computes as 82–153, but Classic shows 44–82.
Check `QualityModifier` and the caster tables (`ItemDamageOneHandCaster`) before trusting every weapon.
Stats come from `StatModifier_bonusStat_N` + `StatPercentEditor_N`.

## Pets

`CreatureFamily` (27 rows) has the families. Hunter pet damage modifiers and pet stat formulas
are not in client data. They will be hand-entered constants in `data/manual/pets.json`,
with sources cited.

## Refresh procedure (when a new Forever build ships)

1. Run `curl -s https://wago.tools/api/builds` and read `.wowf[0].version`.
2. Run `tools/research/fetch_db2.sh <build>`.
3. Run `python3 tools/research/extract_research.py data/raw/<build> docs/research`, then check `git diff docs/research` to see what changed.
4. Run the production pipeline (Phase 1) and its tests.
