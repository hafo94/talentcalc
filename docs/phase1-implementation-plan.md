# Phase 1 — Data pipeline: implementation plan

Status: ready for implementation · Build: **1.60.1.70888** (`wowf`) · Era fallback build: **1.15.9.70576** (`wow_classic_era`)
Python 3.13, **stdlib only**. Every field name below was checked against the raw CSV headers.
Implement the tasks in section 8 **in order**. Do not research alternatives: when something here conflicts with your intuition, follow this document and record the conflict in the report.

---

## 0. Conventions used in this plan

- "raw" = `data/raw/<build>/`, "era raw" = `data/raw/era/<eraBuild>/`, "out" = `data/generated/<build>/`.
- All raw CSV values are strings. Use the helpers `I(v)` (int, `""`→0) and `F(v)` (float, `""`→0.0).
- **Difficulty filter:** these tables have `DifficultyID`; only use rows where it is `"0"`: SpellEffect, SpellMisc, SpellLevels, SpellCooldowns, SpellCategories, SpellAuraOptions. SpellPower has no difficulty column, so use all rows sorted by `OrderIndex`.
- `rhu(x)` = round-half-up away from zero: `math.copysign(math.floor(abs(x) + 0.5), x)`, returned as int. **Never use Python's `round()` for game numbers** (it does banker's rounding).
- `num(x)`: if `abs(x - round(x)) < 1e-9` return int, else `round(x, 6)`. Use it for every float written to JSON (deterministic output).
- `u32(v)` = `int(v) & 0xFFFFFFFF`. SpellClassOptions and SpellEffect masks contain negative values (246 and 142 rows respectively).
- The 9 class trees (`SkillLineXTraitTree`):

| Class (ChrClasses.ID / token) | TraitTreeID | ClassMask |
|---|---|---|
| 1 WARRIOR | 1117 | 1 |
| 2 PALADIN | 1100 | 2 |
| 3 HUNTER | 1091 | 4 |
| 4 ROGUE | 1111 | 8 |
| 5 PRIEST | 1114 | 16 |
| 7 SHAMAN | 1082 | 64 |
| 8 MAGE | 1112 | 128 |
| 9 WARLOCK | 1116 | 256 |
| 11 DRUID | 1089 | 1024 |

  Derive the tree→class mapping from data: `SkillLineXTraitTree.SkillLineID` → that skill line's majority non-zero `SkillLineAbility.ClassMask` → class. Assert the result equals the table above. Ignore trees 1058, 1066, 1081, 1083 (drafts) and 1118, 1187–1189 (Legacy, out of scope).
- Talent point currency: `TraitCurrency` 3820 (`SourcedMax` = 51).

---

## 1. Decisions with evidence

### 1.1 Talent trees

**Spec membership.** For each class tree, collect all `TraitCond` rows reachable via `TraitNodeGroupXTraitCond` from groups that contain the tree's nodes. The **spec groups** are the distinct `TraitCond.TraitNodeGroupID` values of conditions with `SpentAmountRequired == 30` (exactly 3 per tree).
- Verified: in all 9 trees these 3 groups are disjoint and cover every node, including flag-8 nodes.
- Spec order is by the minimum PosX of the group's nodes (left to right), which gives spec index 0, 1, 2.
- Spec names and icons come from `TalentTab` rows where `ClassMask` equals the class mask, sorted by `OrderIndex`. Index i matches spec index i; verified via capstones (see tests).

**Tier / requiredPoints.**
- The node's gate = the max `SpentAmountRequired` over all conditions attached (via `TraitNodeGroupXTraitCond`) to any group containing the node. No such condition means a gate of 0.
- Ignore conditions with `SpentAmountRequired == 0` or `TraitNodeGroupID == 0`. Two such dummy rows exist: 43478 (tree 1114) and 50974 (tree 1089).
- `tier = gate / 5 + 1`, giving tiers 1..7. Assert gate ∈ {0, 5, 10, 15, 20, 25, 30}. `requiredPoints = gate`.
- **Never compute the tier from PosY.** PosY has typos: node 105003 Improved Serpent Sting has PosY 39300, node 104982 Lightning Reflexes 5740, node 105865 Holy Specialization 21300, plus small offsets on 105921 (2120) and 105916 (3320).
- PosY is only used for a consistency warning: `ytier = rhu((PosY - 2130)/600) + 1`; report when `ytier != tier`.

**Tier-gate scope (export as data).** Each gating condition's scope group (`TraitCond.TraitNodeGroupID`) is the set of nodes whose points count toward that gate. Normally this is "the spec's nodes in lower tiers" (for 30 points, the whole spec).
- Anomalies found: 105003 Improved Serpent Sting is missing from the MM 20/25 scopes; 105865 Holy Specialization is missing from the Holy 5..25 scopes.
- Export `spec.tierGates[]` with the counted node IDs, and report the anomalies. Phase 2 decides which rule to apply; this is open question Q21.

**Column.**
- `SPEC_BASE_X = [1020, 5020, 9080]` (verified for all 27 specs). `col = (PosX - SPEC_BASE_X[specIndex]) / 600`.
- Valid only if it is an integer in 0..3. Otherwise resolve in this order:
  1. **Twin rule:** a flag-8 node in the same spec group whose entry's `TraitDefinition.SpellID` equals this node's spell, and whose own col is valid. Use the twin's col.
     - 104982 Lightning Reflexes → twin 110859 (10280, 5130) → col 2.
     - 105865 Holy Specialization → twin 110855 (6220, 2130) → col 2.
  2. `POSITION_OVERRIDES = {104982: {"col": 2}, 105865: {"col": 2}}` in constants.py, with comments citing the twins. This is a safety net if a twin disappears.
  3. Otherwise **raise** (fail the build).
- Record every resolution in `report.positionFixes`.
- **Q12 answer:** the stray Hunter "Spec 3" is node 104982. Its PosX of 102800 is a ×10 typo for 10280. It is a live Survival tier-6 col-2 talent (gate 25) that replaces the flag-8 node 110859.

**Collision check.** No two included nodes may share (spec, tier, col). Raise if they do. Verified: there are no collisions with flag-8 nodes excluded.

**Flags = 8.**
- Excluded by default. CLI flag `--include-hidden-nodes` includes them with `"hidden": true`. When included, a collision is a warning, not an error.
- Every flag-8 node of the 9 trees goes into `report.hiddenNodes`: 23 nodes (1089: 2, 1091: 4, 1100: 3, 1111: 2, 1114: 5, 1116: 1, 1117: 6).
- Node `Flags` values seen in class trees are only 0 and 8. Any other value raises an error.

**Choice nodes (Q10).** `TraitNode.Type` is 0 for every node of the 9 class trees, and every node has exactly 1 entry. The only Type=1 node is in Legacy tree 1188.
- Implement: if `Type == 1` or a node has more than 1 entry, export `choices: [...]` (same shape as a talent, minus layout) and add a warning.
- Unit test: no class-tree talent has `choices`.

**Prerequisites (TraitEdge).**
- Raw edges include bidirectional pairs: Bestial Wrath ↔ Intimidation (both Type 2), Nature's Splendor ↔ Nature's Majesty (Type 0 and Type 3), and draft-tree pairs.
- Rule:
  1. Keep an edge only if both nodes are included and in the same class tree.
  2. Orient it from lower tier to higher tier. If the tiers are equal, keep Left→Right (only Mind Flay → Improved Mind Flay, Shadow tier 3).
  3. Deduplicate.
- Result: 69 arrows (per tree: 1089: 9; 1114, 1111, 1091, 1116: 8 each; 1112, 1100, 1117, 1082: 7 each). Edges dropped because an end is excluded: 3, e.g. Holy Shock → Boundless Light (flag 8).
- Assert each node has at most 1 prerequisite (verified: 0 nodes have 2). Export `prereqNodeId?: number`, following ARCHITECTURE.md.
- The prerequisite must be maxed (Classic rule, Phase 2). Ignore `TraitEdge.Type` (0, 2 or 3) and `VisualStyle` (always 1); record raw types in the report.

**Talent identity.**
- `TraitNodeXTraitNodeEntry` (order by `_Index`) → `TraitNodeEntry` (`MaxRanks`, `TraitDefinitionID`) → `TraitDefinition` (`SpellID`, `OverrideName_lang`, `OverrideIcon`, `OverrideDescription_lang`).
- Name = `OverrideName_lang` or `SpellName.Name_lang` of SpellID.
- Icon file ID = `OverrideIcon` if non-zero, else `SpellMisc.SpellIconFileDataID`.
- Description = `OverrideDescription_lang` or `Spell.Description_lang`.

**Talent point sources.**
- `TraitCurrencySource` rows for currency 3820: levels 10..60 (`Requirement_lang` "Level N"), plus levels 5..9 ("Talented Rank k (Level n)").
- The level 5–9 rows are granted by the account-wide Legacy "Talented" perk (tree 1188). Export all rows; default UI rule is points = level − 9. This is open question Q22.

Per-spec counts (flag-8 excluded) are fixed test expectations. Format is `nodes / sum of MaxRanks`.

| Class | Spec 0 | Spec 1 | Spec 2 |
|---|---|---|---|
| Mage | Arcane 18/45 | Fire 17/46 | Frost 18/48 |
| Druid | Balance 15/44 | Feral Combat 19/49 | Restoration 16/51 |
| Hunter | Beast Mastery 16/44 | Marksmanship 16/54 | Survival 16/45 |
| Paladin | Holy 15/39 | Protection 17/49 | Retribution 16/42 |
| Priest | Discipline 16/43 | Holy 17/48 | Shadow 15/42 |
| Rogue | Assassination 16/41 | Combat 18/46 | Subtlety 18/43 |
| Shaman | Elemental 16/46 | Enhancement 18/51 | Restoration 16/51 |
| Warlock | Affliction 16/41 | Demonology 19/50 | Destruction 16/50 |
| Warrior | Arms 16/40 | Fury 15/45 | Protection 16/42 |

Capstones (the single tier-7 node per spec):

| Class | Spec 0 | Spec 1 | Spec 2 |
|---|---|---|---|
| Mage | Arcane Power | Combustion | Ice Barrier |
| Druid | Moonkin Form | Primal Bite | Wild Growth |
| Hunter | Bestial Wrath | Sniper Shot | Lacerating Strikes |
| Paladin | Light's Vigil | Shieldsworn | Unsealed Wrath |
| Priest | Power Infusion | Prayer of Mending | Shadowform |
| Rogue | Mutilate | Adrenaline Rush | Death Mark |
| Shaman | Lightning Mastery | Rage of the Farseer | Riptide |
| Warlock | Wrack | Demonic Pact | Incinerate |
| Warrior | Mortal Strike | Bloodthirst | Shield Slam |

Totals: 447 included nodes, 23 hidden.

### 1.2 Per-rank talent values (Q7)

Evidence:
- `TraitDefinitionEffectPoints`: 663 rows. All have `OperationType = 0` (Set). `EffectIndex` is 0..4. All referenced curves have `Curve.Type = 0`.
- `CurvePoint` (`CurveID`, `OrderIndex`, `Pos_0` = x = rank, `Pos_1` = y = value). Examples:
  - Impact (def 135322): (1,3) (2,7) (3,10).
  - Fire Power: 1, 2, 3.
  - Ignite: 8, 16, 24, 32, 40.
  - Magic Absorption: effect 0 = 1, 2; effect 1 = 5, 10.
  - Improved Fire Blast: effect 0 = −1000, −2000; effect 1 = 8, 15.
  - Mage Precision (29438): 2, 4, 6.
- Forever talents use **one spell for all ranks** (the rank-1 ID). Legacy rank-2+ spell IDs mostly have no SpellEffect and no SpellName rows: only 102 of 925 exist. **Do not use legacy `Talent` rank spells at all.**
- The talent spell's `EffectBasePointsF` usually equals the **max-rank** value, e.g. Lightning Reflexes base 15 with curve 3..15.
- Base and curve sometimes disagree: Savage Strikes base 20 vs curve 2/4; Ferocity 16 vs curve(5) = 10; Bestial Discipline effect 0 100 vs 10/20; Survival Tactics 17 vs 5/10; Spirit Bond effect 1 5 vs curve 10/5.

**Rule** (for talent with definition D, spell S, rank r in 1..MaxRanks, and each SpellEffect row e of S, ordered by `EffectIndex`):
1. If a `TraitDefinitionEffectPoints` row exists with `TraitDefinitionID == D` and `EffectIndex == e.EffectIndex`: `value = curve(CurveID, r)` with `valueSource = "curve"`. The curve is evaluated by exact x match; otherwise linear interpolation between neighbours, clamped to the first and last points.
2. Otherwise `value = e.EffectBasePointsF` (constant for all ranks) with `valueSource = "base"`.
3. Report items (do not change values):
   - `report.curveBaseMismatch`: rule 1 applied and `curve(MaxRanks) != EffectBasePointsF` (abs diff > 0.01).
   - `report.multiRankWithoutCurve`: MaxRanks > 1, rule 2 applied, `EffectBasePointsF != 0`, and the effect is an apply-aura with aura in GENERIC_AURAS (section 1.8). There are 25 talents with partial curves, e.g. Barrage effect 1 (aura 108, base 15, no curve) and Improved Serpent Sting effect 1. These are possibly server-scaled; open question Q17.
4. Fallback "rank-1 × rank" is **not** used. The data shows base = max-rank value, so linear scaling would be `base × r / MaxRanks`, but it is unverified. Leave constant and flag.

Correction for CALC_MODEL.md: "Precision: aura 55, 6 per rank" is wrong. Base 6 is the max-rank value; the curve gives 2/4/6 for Mage Precision.

### 1.3 Spells

**Spec skill lines:** `SkillLine.CategoryID == 7` and `Flags ∈ {1040, 66576}`. That is 27 lines; e.g. 6 Frost, 8 Fire, 237 Arcane, 26 Arms, 594 Holy (Paladin), 56 Holy (Priest). Owning class = the single non-zero `SkillLineAbility.ClassMask` among the line's rows; assert exactly one distinct non-zero mask.
- Excluded: Engraving 2851 (Flags 146, Season of Discovery runes; 0 of its spells are referenced by any TraitDefinition), Runes 2853, Pet - * lines (Flags 0), Beast Training 261, Mounts, Companions, Meditation, Explorer Imp.

**Seed set "ability":** `SkillLineAbility` rows with `SkillLine` in the spec lines, `AcquireMethod != 3`, and Spell present in `SpellName`.
- AcquireMethod 3 = SoD rune-granted spells, e.g. Living Flame 401556, Living Bomb 400613, the 400616–400623 Fire Blast variants, Balefire Bolt 428878. List them in `report.excludedRuneSpells`.
- Unnamed rows are legacy talent rank spells (e.g. 12338) and are dropped.

**Seed set "talent":** the SpellID of every included talent's definition.

**Closure "triggered":** BFS from both seed sets. For each Difficulty-0 SpellEffect of a spell:
- add `EffectTriggerSpell` if non-zero and present in SpellName;
- if `EffectAura == 332`, add `int(EffectBasePointsF)` if present in SpellName.

This is transitive. Expected size: about 2,176 seeds and about 2,300 total (tests use a range).

**classIds:** abilities take the skill line's class; talent spells take the tree's class; triggered spells take the union of their parents' classes. Store sorted.

**Ability chains (`abilities`):**
- Group "ability" seed spells that are not talent spells by (classId, SpellName).
- Order by `SpellLevels.BaseLevel`, then spell ID.
- Example: Fireball = [133, 143, 145, 3140, 8400, 8401, 8402, 10148, 10149, 10150, 10151, 25306].

**rank:** parse `Spell.NameSubtext_lang` with `^Rank (\d+)$`, else null.

**Fields per spell:**

| Field | Source |
|---|---|
| name | `SpellName.Name_lang` |
| subtext | `Spell.NameSubtext_lang` (null if empty) |
| description, auraDescription | `Spell.Description_lang`, `Spell.AuraDescription_lang` (resolved, section 1.4) |
| school | `SpellMisc.SchoolMask` (1 phys, 2 holy, 4 fire, 8 nature, 16 frost, 32 shadow, 64 arcane) |
| attributes | `SpellMisc.Attributes_0..16` as u32 list (17 ints) |
| passive | `Attributes_0 & 0x40` |
| channeled | `Attributes_1 & 0x44` (SPELL_ATTR1_CHANNELED_1 = 0x4, _2 = 0x40) `[VERIFY]` |
| castMs | `SpellCastTimes[SpellMisc.CastingTimeIndex].Base` (index 0 → 0) |
| duration | `SpellDuration[SpellMisc.DurationIndex]` → `{ms: Duration, perLevel: DurationPerLevel, maxMs: MaxDuration}`; index 0 → null |
| range | `SpellRange[SpellMisc.RangeIndex]` → `{min: RangeMin_0, max: RangeMax_0}` |
| iconFileId, icon | `SpellMisc.SpellIconFileDataID` → icon name (section 1.6) |
| levels | `SpellLevels`: `{base: BaseLevel, max: MaxLevel, spell: SpellLevel}` or null |
| gcdMs, cooldownMs, categoryCooldownMs | `SpellCooldowns`: `StartRecoveryTime`, `RecoveryTime`, `CategoryRecoveryTime` |
| category, gcdCategory, defenseType, dispelType, mechanic, preventionType | `SpellCategories`: `Category`, `StartRecoveryCategory`, `DefenseType`, `DispelType`, `Mechanic`, `PreventionType` |
| proc | `SpellAuraOptions` → `{chance: ProcChance, charges: ProcCharges, categoryRecoveryMs: ProcCategoryRecovery, typeMask: [u32 ProcTypeMask_0, u32 ProcTypeMask_1], ppm: SpellProcsPerMinute[SpellProcsPerMinuteID].BaseProcRate or null}`; null if no row |
| maxStacks | `SpellAuraOptions.CumulativeAura` |
| costs | `SpellPower` rows by `OrderIndex` → `{powerType: PowerType, amount: ManaCost (÷10 if PowerType == 1 rage), pct: PowerCostPct, perLevel: ManaCostPerLevel, perSecond: ManaPerSecond, optional: OptionalCost}` |
| family | `SpellClassOptions` → `{set: SpellClassSet, mask: [u32 SpellClassMask_0..3]}`; null if no row |

- Power types: 0 mana, 1 rage, 2 focus, 3 energy, 4 combo points, −2 health. Example: Heroic Strike 78 has raw 150 → 15 rage.
- Fireball r1 (133): cast index 16 → 1500 ms, duration index 35 → 4000 ms, range index 35 → 35 yd, GCD 1500, mana 30, family set 3 mask0 1073741825, school 4.

**Effects** (SpellEffect, Difficulty 0, sorted by `EffectIndex`; (SpellID, EffectIndex) is unique):
- Always present: `index` (EffectIndex), `effect` (Effect), `aura` (EffectAura), `base` (EffectBasePointsF), `misc` [EffectMiscValue_0, EffectMiscValue_1], `mask` [u32 EffectSpellClassMask_0..3].
- Present only when non-zero:

| JSON field | Source |
|---|---|
| variance | Variance |
| perLevel | EffectRealPointsPerLevel |
| spCoef | EffectBonusCoefficient |
| apCoef | BonusCoefficientFromAP |
| periodMs | EffectAuraPeriod |
| amplitude | EffectAmplitude |
| chainTargets | EffectChainTargets |
| pointsPerCombo | EffectPointsPerResource |
| triggerSpell | EffectTriggerSpell |
| mechanic | EffectMechanic |
| targets | [ImplicitTarget_0, ImplicitTarget_1] |
| radiusIndex | [EffectRadiusIndex_0, EffectRadiusIndex_1] |

### 1.4 Description tokens (tooltips)

Resolve `Description_lang` and `AuraDescription_lang`. Output the resolved string plus `unresolved: string[]` (sorted unique raw tokens; the key is omitted when empty). **Unresolved tokens stay verbatim in the text.**

**Context.**
- For a plain spell: effect values = `base`.
- For a talent rank: effect values = that rank's values (section 1.2).
- Cross-spell tokens `$<id><letter><n>` (e.g. `$12355d`, `$14748s1`) use that spell's raw data with base values. The spell need not be exported; look it up in the raw tables.

**Token grammar** (regex-driven; apply in this order):
1. **Conditionals** `$?<cond>[A][B]` (cond like `a14748`, `s17245`, `$p456322`, possibly chained `?x[..]?y[..][..]`): replace the whole construct with the **last** bracket content, i.e. the "without that aura" branch. Then continue processing that content.
2. **Expressions** `${ expr }` with an optional decimals suffix `.N`:
   - Substitute `$`-tokens inside expr with **signed** numbers.
   - If anything other than numbers, `+ - * / ( )`, `.` and spaces remains (e.g. `$<mult>`, `$SPI`, `$AP`), the whole `${...}` is unresolved.
   - Otherwise evaluate with a safe AST evaluator (`ast.parse(mode="eval")`; allow only BinOp/UnaryOp/Constant/Add/Sub/Mult/Div/USub/UAdd).
   - Format with N decimals if a suffix is given, else `fmt()`.
   - Also tolerate the stray form `$m2$*$<frostdamage>`: an unknown token makes it unresolved.
3. **Simple tokens** `$[id]<letter>[n]`, where letter ∈ the table below. **Absolute** value outside expressions.

| Token | Value |
|---|---|
| `sN`, `wN` | effect N value; if variance > 0 → `"{rhu(v·(1−var/2))} to {rhu(v·(1+var/2))}"` |
| `mN` | rhu(v·(1−var/2)) (= v when no variance) |
| `MN` | rhu(v·(1+var/2)) |
| `oN` | v × (durationMs / periodMs) of effect N (periodMs 0 → unresolved) |
| `tN` | periodMs / 1000 |
| `aN` | SpellRadius[EffectRadiusIndex_0].Radius (needs the SpellRadius table) |
| `xN` | chainTargets |
| `bN` | pointsPerCombo |
| `qN` | misc[0] |
| `eN` | amplitude |
| `d` | duration formatted: `-1` → "until cancelled"; < 60 000 ms → "{s} sec"; < 3 600 000 → "{m} min"; else "{h} hr" (use fmt for fractions) |
| `h` | proc chance |
| `n` | proc charges |
| `u` | maxStacks |
| `r` | range max |
| anything else (`i`, `v`, `z`, `c`, `p`, `N`, `<var>`, `SPI`, `AP`, `PL`, …) | unresolved |

   - N is 1-based (`$s1` = EffectIndex 0).
4. **Plurals** `$l<sing>:<plur>;` and `$L…;`: pick plural unless the last resolved number before the token equals 1.
5. **Gender** `$g<male>:<female>;`: pick male.
6. `$/N;sM` and `$*N;sM`: value of sM divided or multiplied by N.

`fmt(x)`: integer if integral; else up to 1 decimal with trailing zeros stripped.

Verified examples (they are tests):
- 133 → "Hurls a fiery ball that causes 14 to 22 Fire damage and an additional 2 Fire damage over 4 sec."
- Impact rank 2 → "Gives your Fire spells a 7% chance to stun the target for 2 sec." (`$12355d` = SpellDuration 39 = 2000 ms)
- Fire Power rank 3 → "Increases the damage done by your Fire spells by 3% per your Fire effects on the target, up to a maximum increase of 12%. Effects which mix multiple schools of magic do not qualify."
- Improved Fire Blast rank 1 → "Reduces the cooldown of your Fire Blast spell by 1 sec and increases its range by 8 yards."

### 1.5 Weapons (Q8)

**The formula is correct.** The "Classic 44–82" Thunderfury reference was wrong: the Classic Era client's own ItemSparse (build 1.15.9.70576, which has explicit `MinDamage_0..4`/`MaxDamage_0..4`) stores Thunderfury 19019 as 82–153 physical plus 16–30 secondary (nature).

**Table selection** (by `ItemSparse.InventoryType`, `Item.SubclassID`). Validated against the Era explicit damage for every Forever weapon present in both builds.

| InventoryType | Subclass | Table | Slot |
|---|---|---|---|
| 13 (one-hand) | any melee | ItemDamageOneHand | oneHand |
| 21 (main hand) | any melee | ItemDamageOneHand | mainHand |
| 22 (off hand) | any melee | ItemDamageOneHand | offHand |
| 17 (two-hand) | any | ItemDamageTwoHand | twoHand |
| 15 / 26 (ranged / ranged-right) | 2 Bow, 3 Gun, 18 Crossbow | **ItemDamageRanged** | ranged |
| 26 | 19 Wand | **ItemDamageWand** | wand |
| 25 (thrown) | 16 Thrown | **ItemDamageThrown** | thrown |
| 24 (ammo, Item.ClassID 6) | 2 Arrow, 3 Bullet | ItemDamageAmmo | (ammo list) |

- Caster variants: if `ItemSparse.Flags_1 & 0x200` (ITEM_FLAG2_CASTER_WEAPON), use OneHandCaster/TwoHandCaster. Currently no weapon has the flag and the caster tables are identical, but implement it.
- Validation results (Era match, ±0): one-hand/two-hand melee is near 100% excluding test/monster items. Bows: 72/72 with Ranged (TwoHand fails: Rhok'delar 149–277). Guns: 69/71. Wands: 64/65. Thrown: all with Thrown.

```
dps   = table[ItemLevel].Quality_<OverallQualityID>
avg   = dps × ItemDelay/1000
min   = floor(avg × (1 − DmgVariance/2))
max   = floor(avg × (1 + DmgVariance/2) + 0.5)
dpsOut = num(round((min+max)/2 / (ItemDelay/1000), 1))
```

- `min` uses floor: Hammer of the Gathering Storm gives 86 (not 87) and Arcanite Reaper 153, matching Era.
- `QualityModifier` is **ignored**. Evidence: Atiesh (−32.7), Anathema/Benediction (−14) and Thunderfury (−20) all match Era without it.
- Verified: Sulfuras 17182 = 223–372 @3.7 (TwoHand il80 q5); Arcanite Reaper 12784 = 153–256 @3.8; Thunderfury 19019 = 82–153 @1.9; Rhok'delar 18713 = 89–166 @2.9 (Ranged il75 q4).

**Stats** (Forever items):
```
value = rhu(StatPercentEditor_k × RandPropPoints[ItemLevel].<Q>F_<slotIdx> / 10000)
Q: quality 4, 5, 6 → "Epic"; 3 → "Superior"; 0, 1, 2 → "Good"
slotIdx: InventoryType 17 → 0; 13, 21, 22 → 3; 15, 25, 26 → 4
```
- Iterate k = 0..9 where `StatModifier_bonusStat_k > 0` and the alloc is ≠ 0.
- Verified:
  - Thunderfury: Agi(3) 5, Sta(7) 8, fire res(51) 8, nature res(55) 9.
  - Sulfuras: Str(4) 12, Sta 12, fire res 30.
  - Arcanite Reaper: Sta 13.
  - Rhok'delar: crit rating(32) 14, RAP(39) 17. These are Forever values; Era has no stats.
- Needs `RandPropPoints`, which is not fetched yet.

**Coverage gap (Q18).**
- Forever ItemSparse has only 1,785 of 3,871 `Item.ClassID == 2` items, and is missing most classic raid and dungeon weapons: Ashkandi 19364, Chromatically Tempered Sword 19352, Felstriker 12590, Ironfoe 11684, Spinal Reaper 17104, Perdition's Blade 18816, Brutality Blade 18832 and others. They are probably hotfix-delivered; wago has no hotfix export (`&hotfixes=1` makes no difference, `/api/hotfixes` returns 404).
- Forever also contains new items (IDs above 200000).
- **Decision: Era fallback ON by default** (`--no-era-fallback` disables it):
  - For each `Item.csv` ClassID 2 id not in Forever ItemSparse but present in Era ItemSparse with `MaxDamage_0 > 0`, export with `source: "classic_era"`.
  - Damage = Era `MinDamage_0`/`MaxDamage_0`; speed = Era `ItemDelay`.
  - Stats = Era `StatModifier_bonusStat_k`/`StatModifier_bonusAmount_k`, plus resistances from `Resistances_1..6` (1 holy→53, 2 fire→51, 3 nature→55, 4 frost→52, 5 shadow→54, 6 arcane→56).
  - Verified: Ashkandi 229–344 @3.5, Chromatically Tempered Sword 106–198 @2.6.
- Caveat: Forever reworked stats on about 40% of weapons present in both builds (139 of 363 melee and 100 of 121 ranged with stats differ), so fallback stats are unverified (Q19).
- **Secondary damage:** if the Era row has `MaxDamage_1 > 0`, set `bonusDamage = {min: MinDamage_1, max: MaxDamage_1, school: null, source: "classic_era"}` (applies to both Forever and fallback weapons). Then apply `data/manual/weapon-overrides.json`; Thunderfury sets school "nature" `[VERIFY]` (Q20).

**Filters** (applied to both sources):
- Exclude by name regex `(?i)(^monster - |\btest\b|deprecated|\[ph\]|\(old\)|^jeff |^twain )`.
- Exclude subclass 14 (misc) and 20 (fishing pole); `ItemLevel <= 1`; `RequiredLevel > 60`; `ItemDelay == 0`; computed `max == 0`.
- Counts per reason go to `report.weaponFilters`.

**Ammo** (Item.ClassID 6, InventoryType 24, Forever ItemSparse only): `dps = num(round(table value, 2))`. Example: Thorium Headed Arrow 18042 = 17.71 (Classic tooltip 17.5, Q26).

### 1.6 Icons (Q9): resolved

- New raw table `ManifestInterfaceData` (`ID`, `FilePath`, `FileName`) maps file data IDs to file names. 134,284 rows, about 30.5k under `Interface\ICONS\`.
- `icon = FileName` lowercased with the `.blp` extension stripped. Example: 135812 → `spell_fire_flamebolt`, 626001 → `classicon_mage`.
- File ID 0, a missing row, or the name `temp` → `icon: null`; count them in `report.missingIcons`.
- `manifest.json` carries:
  - `iconUrlTemplate: "https://render.worldofwarcraft.com/us/icons/56/{icon}.jpg"`
  - `iconUrlFallback: "https://wow.zamimg.com/images/wow/icons/large/{icon}.jpg"`
  - Both returned HTTP 200 for `spell_fire_flamebolt` and `classicon_mage`.
- Icons are not bundled in v1. Forever-only icons may be missing on the CDNs; the optional `check_icons.py` (task 15) reports them.
- Spec backgrounds: export `TalentTab.BackgroundFile` (e.g. "MageFire") only. The talent-frame artwork source is deferred to Phase 2.

### 1.7 Targets

- `ExpectedStat`: 133 rows, all `ExpansionID = -2`, `Lvl` 1..133.
- Use levels 1..63: `CreatureArmor` (round with rhu), `CreatureHealth`, `ArmorConstant`, `CreatureAutoAttackDps`, `CreatureSpellDamage`.
- Assert `ArmorConstant == 400 + 85 × Lvl` for 1..63 (verified, e.g. L1 485, L63 5755).

Presets (CALC_MODEL section 2b), for player level L in 1..60:

| id | label | levelOffset | armorMultiplier | notes |
|---|---|---|---|---|
| boss | Boss | +3 | 1.0 | default |
| elite | Elite | +2 | 1.0 | |
| same | Same-level mob | 0 | 1.0 | |
| lowArmorBoss | Low-armor boss | +3 | 0.5 | `[tune]` |
| custom | Custom | +3 | 1.0 | `editable: true` |

- armor = rhu(ExpectedStat[L + offset].CreatureArmor × mult).
- At L = 60: boss 63 → 3731, elite 62 → 3677, same 60 → 3566, lowArmorBoss → rhu(1865.5) = 1866.

### 1.8 Coverage classification

Effect categorisation for each effect (Effect E, aura A) of the talent spell:
- `E == 0` → ignored.
- E ∈ APPLY_AURA_EFFECTS = {6, 35, 65, 119, 128, 129, 143} → classify by A:
  - A ∈ GENERIC_AURAS → generic.
  - A ∈ IGNORED_AURAS or A == 0 → ignored.
  - A ∈ SPECIAL_AURAS → special.
  - else → unsupported.
- otherwise classify by E:
  - E ∈ DAMAGE_EFFECTS = {2, 17, 31, 58, 121} → generic.
  - E ∈ IGNORED_EFFECTS = {10, 30, 28, 32, 36, 38, 96, 1} → ignored (heal, energize, summon, learn, dispel, charge, instakill).
  - E ∈ SPECIAL_EFFECTS = {3, 64, 77} → special (dummy, trigger spell, script).
  - else → unsupported.

Aura sets (modern aura enum; names in constants.py, uncertain names tagged `[VERIFY]`):
- **GENERIC_AURAS** = {13 MOD_DAMAGE_DONE, 29 MOD_STAT, 52 MOD_WEAPON_CRIT_PERCENT, 54 MOD_HIT_CHANCE, 55 MOD_SPELL_HIT_CHANCE, 57 MOD_SPELL_CRIT_CHANCE, 65 MOD_CASTING_SPEED_NOT_STACK, 79 MOD_DAMAGE_PERCENT_DONE, 85 MOD_POWER_REGEN, 99 MOD_ATTACK_POWER, 107 ADD_FLAT_MODIFIER, 108 ADD_PCT_MODIFIER, 110 MOD_POWER_REGEN_PERCENT, 122 MOD_OFFHAND_DAMAGE_PCT, 123 MOD_TARGET_RESISTANCE, 124 MOD_RANGED_ATTACK_POWER, 134 MOD_MANA_REGEN_INTERRUPT, 137 MOD_TOTAL_STAT_PERCENTAGE, 166 MOD_ATTACK_POWER_PCT, 174 MOD_SPELL_DAMAGE_OF_STAT_PERCENT, 240 MOD_EXPERTISE, 268 MOD_ATTACK_POWER_OF_STAT_PERCENT, 271 MOD_DAMAGE_PERCENT_TAKEN_FROM_CASTER, 290 MOD_CRIT_PCT, 3 PERIODIC_DAMAGE, 53 PERIODIC_LEECH}
- **IGNORED_AURAS** (not DPS-relevant) = {5, 8, 10, 12, 17, 22, 26, 27, 31, 33, 34, 39, 43, 47, 49, 51, 61, 69, 77, 87, 118, 133, 136, 142, 154, 172, 175, 178, 185, 186, 232, 466}
- **SPECIAL_AURAS** = {4 DUMMY, 42 PROC_TRIGGER_SPELL, 231 PROC_TRIGGER_SPELL_WITH_VALUE, 226 PERIODIC_DUMMY, 332 OVERRIDE_ACTIONBAR_SPELLS, 109 ADD_TARGET_TRIGGER, 36 MOD_SHAPESHIFT}
- Everything else (e.g. 280, 319, 342, 560, 580, 598, 30, 50, 67, 72, 86, 272) → unsupported, so it shows up for Phase 3/4 review.

**Talent class:**
- `special` if any effect is special;
- else `unsupported` if any effect is unsupported;
- else `generic`.
- `dpsRelevant = any effect in {generic, special, unsupported}`.
- `kind = "passive"` if the spell is passive, else `"ability"`.

Talent aura frequencies seen (for orientation): 108 ×161, 4 ×150, 107 ×126, 42 ×36, Effect 3 ×26, 79 ×15, 77 ×13, Effect 2 ×12, 232 ×10, 137 ×9.

### 1.9 Races and classes

- Classes: `ChrClasses` (9 rows): `ID`, `Name_lang`, `Filename` (token), `SpellClassSet`, `DisplayPower`, `IconFileDataID`, `ClassColorR/G/B` → `"#rrggbb"`.
- Races: v1 = IDs 1–8 (Human, Orc, Dwarf, Night Elf, Undead, Tauren, Gnome, Troll). Name from `Name_lang`, token from `ClientFileString`, faction from `Alliance` (0 = alliance, 1 = horde). `[VERIFY]` whether Forever adds races.
- Valid class/race combos come from `data/manual/base-stats.json`.

---

## 2. Output layout (`data/generated/1.60.1.70888/`)

```
manifest.json        build, date, options, raw table sha256 + row counts, output counts, icon URL templates
classes.json         classes (+specs), races, talent currency sources
talents/<token>.json one per class: warrior.json, paladin.json, hunter.json, rogue.json, priest.json,
                     shaman.json, mage.json, warlock.json, druid.json
spells.json          all exported spells + ability chains
weapons.json         weapons + ammo
targets.json         ExpectedStat levels 1..63 + presets + byPlayerLevel 1..60
pet-families.json    CreatureFamily list (id, name, icon, skillLine, petTalentType)
coverage.json        per-talent classification + summary
report.json          pipeline decisions/warnings (hidden nodes, position fixes, mismatches, filters…)
```

**Formatting (deterministic and diff-friendly):**
- Small files (manifest, classes, targets, pet-families) use `json.dumps(obj, indent=1, ensure_ascii=False)` plus `"\n"`.
- Record files (talents, spells, weapons, coverage, report) use **one record per line**: the header keys on their own lines, and each array element as a compact JSON object (`separators=(",", ":")`) on its own line. Implement this in `writer.write_records()`.
- Key order = the insertion order defined in the builders, never `sort_keys`.
- Arrays are sorted as specified (ids ascending; talents by (tier, col)).
- `manifest.generatedAt` comes from `--date` (default: today's UTC date `YYYY-MM-DD`). No timestamps anywhere else.

### 2.1 Schemas (TypeScript-style)

```ts
interface Manifest {
  build: string; eraBuild: string | null; generatedAt: string; pipelineVersion: 1;
  options: { includeHiddenNodes: boolean; eraFallback: boolean };
  iconUrlTemplate: string; iconUrlFallback: string;
  rawTables: { name: string; rows: number; sha256: string }[];   // sorted by name; only tables actually read
  counts: { classes: number; specs: number; talents: number; hiddenTalents: number; spells: number;
            abilityChains: number; weapons: number; weaponsEraFallback: number; ammo: number;
            targetLevels: number; petFamilies: number };
}

interface ClassesFile {
  build: string;
  talentCurrency: { id: 3820; max: 51; sources: { level: number; amount: number; requirement: string }[] };
  classes: {
    id: number; token: string; name: string; color: string; spellClassSet: number; powerType: number;
    icon: string | null; iconFileId: number; traitTreeId: number; skillLineIds: number[];
    specs: { index: 0|1|2; name: string; talentTabId: number; background: string; icon: string | null; iconFileId: number }[];
  }[];
  races: { id: number; token: string; name: string; faction: "alliance" | "horde" }[];
}

interface ClassTalentsFile {             // talents/<token>.json
  build: string; classId: number; token: string; traitTreeId: number; maxPoints: 51;
  specs: Spec[];
}
interface Spec {
  index: 0|1|2; name: string; talentTabId: number; specGroupId: number;
  nodeCount: number; maxPoints: number;            // sum of maxRank of included talents
  tierGates: { tier: number; requiredPoints: number; countedNodeIds: number[] }[];   // tiers 2..7, from TraitCond scope groups, filtered to included nodes
  talents: Talent[];                               // sorted by (tier, col)
}
interface Talent {
  nodeId: number; entryId: number; definitionId: number; spellId: number;
  name: string; icon: string | null; iconFileId: number;
  tier: number; col: number; maxRank: number; requiredPoints: number;
  prereqNodeId?: number;
  kind: "passive" | "ability";
  hidden?: true;                                   // only with --include-hidden-nodes
  valueSources: ("curve" | "base")[];              // parallel to spells[spellId].effects
  ranks: TalentRank[];                             // length maxRank
  choices?: Omit<Talent, "tier"|"col"|"requiredPoints"|"prereqNodeId">[];  // never present in v1 class trees
}
interface TalentRank {
  rank: number;                                    // 1-based
  values: number[];                                // parallel to spells[spellId].effects
  description: string;
  unresolved?: string[];
}

interface SpellsFile { build: string; spells: Spell[]; abilities: AbilityChain[] }
interface Spell {
  id: number; name: string; subtext: string | null; rank: number | null;
  classIds: number[]; sources: ("ability" | "talent" | "triggered")[];    // sorted, unique
  icon: string | null; iconFileId: number; school: number;
  passive: boolean; channeled: boolean; attributes: number[];             // 17 u32
  levels: { base: number; max: number; spell: number } | null;
  castMs: number; gcdMs: number; gcdCategory: number; cooldownMs: number; categoryCooldownMs: number; category: number;
  costs: { powerType: number; amount: number; pct: number; perLevel: number; perSecond: number; optional: number }[];
  range: { min: number; max: number } | null;
  duration: { ms: number; perLevel: number; maxMs: number } | null;
  family: { set: number; mask: [number, number, number, number] } | null;
  proc: { chance: number; charges: number; categoryRecoveryMs: number; typeMask: [number, number]; ppm: number | null } | null;
  maxStacks: number; defenseType: number; dispelType: number; mechanic: number; preventionType: number;
  description: string; auraDescription: string; unresolved?: string[];
  effects: SpellEffect[];                                                 // sorted by index
}
interface SpellEffect {
  index: number; effect: number; aura: number; base: number;
  misc: [number, number]; mask: [number, number, number, number];
  variance?: number; perLevel?: number; spCoef?: number; apCoef?: number; periodMs?: number; amplitude?: number;
  chainTargets?: number; pointsPerCombo?: number; triggerSpell?: number; mechanic?: number;
  targets?: [number, number]; radiusIndex?: [number, number];
}
interface AbilityChain { classId: number; name: string; skillLineId: number; passive: boolean; ranks: number[] }  // sorted by (classId, name)

interface WeaponsFile { build: string; weapons: Weapon[]; ammo: Ammo[] }
interface Weapon {
  id: number; name: string; quality: number; itemLevel: number; requiredLevel: number;
  inventoryType: number; slot: "oneHand"|"mainHand"|"offHand"|"twoHand"|"ranged"|"wand"|"thrown";
  subclass: number; weaponType: string;            // e.g. "sword1h","bow"
  speedMs: number; min: number; max: number; dps: number; damageTable: string | null;   // null for classic_era
  bonusDamage?: { min: number; max: number; school: string | null; source: "classic_era" | "manual" };
  stats: { stat: number; name: string; value: number }[];   // sorted by stat id
  allowableClass: number; allowableRace: [number, number]; bonding: number;
  icon: string | null; iconFileId: number; source: "forever" | "classic_era";
}
interface Ammo { id: number; name: string; quality: number; itemLevel: number; requiredLevel: number; subclass: 2|3; dps: number; icon: string | null }

interface TargetsFile {
  build: string;
  armorFormula: { base: 400; perLevel: 85; cap: 0.75 };
  levels: { level: number; armor: number; health: number; armorConstant: number; autoAttackDps: number; spellDamage: number }[];  // 1..63
  presets: { id: string; label: string; levelOffset: number; armorMultiplier: number; default?: true; editable?: true; note?: string }[];
  byPlayerLevel: Record<string, { preset: string; level: number; armor: number; health: number }[]>;  // "1".."60"
}

interface CoverageFile {
  build: string;
  summary: { generic: number; special: number; unsupported: number; dpsRelevant: number; total: number;
             byClass: Record<string, { generic: number; special: number; unsupported: number }> };
  talents: { classId: number; spec: number; nodeId: number; spellId: number; name: string;
             class: "generic"|"special"|"unsupported"; kind: "passive"|"ability"; dpsRelevant: boolean;
             effects: { index: number; effect: number; aura: number; category: "generic"|"special"|"unsupported"|"ignored" }[] }[];
}

interface ReportFile {  // free-form but stable keys
  build: string;
  hiddenNodes: { classId: number; nodeId: number; name: string; posX: number; posY: number; twinOf?: number }[];
  positionFixes: { nodeId: number; name: string; field: "col"; value: number; method: "twin"|"override"; posX: number; posY: number }[];
  posYInconsistent: { nodeId: number; name: string; posY: number; tier: number }[];
  gateScopeAnomalies: { nodeId: number; name: string; missingFromGates: number[] }[];
  edges: { kept: number; reoriented: { from: number; to: number }[]; droppedExcluded: number; duplicates: number };
  curveBaseMismatch: { nodeId: number; name: string; effectIndex: number; base: number; curveMax: number }[];
  multiRankWithoutCurve: { nodeId: number; name: string; effectIndex: number; aura: number; base: number }[];
  excludedRuneSpells: number[];
  missingIcons: { kind: string; id: number; fileId: number }[];
  unresolvedTokens: Record<string, number>;          // token kind → count
  weaponFilters: Record<string, number>;
  unknownStatIds: number[];
  manualValidation: { file: string; id: string; problem: string }[];
}
```

Stat names (constants.py `STAT_NAMES`): 0 mana, 1 health, 3 agility, 4 strength, 5 intellect, 6 spirit, 7 stamina, 12 defense_rating, 13 dodge_rating, 14 parry_rating, 15 block_rating, 31 hit_rating, 32 crit_rating, 36 haste_rating, 37 expertise_rating, 38 attack_power, 39 ranged_attack_power, 41 spell_healing, 42 spell_damage, 43 mana_regen, 45 spell_power, 46 health_regen, 47 spell_penetration, 48 block_value, 50 bonus_armor, 51 fire_resistance, 52 frost_resistance, 53 holy_resistance, 54 shadow_resistance, 55 nature_resistance, 56 arcane_resistance. Unknown ids (e.g. 84–89, 117, 124, 127, 131) → `"stat_<id>"` and listed in `report.unknownStatIds`.

Weapon type names by subclass: 0 axe1h, 1 axe2h, 2 bow, 3 gun, 4 mace1h, 5 mace2h, 6 polearm, 7 sword1h, 8 sword2h, 10 staff, 13 fist, 15 dagger, 16 thrown, 17 spear, 18 crossbow, 19 wand.

---

## 3. Module structure: `tools/pipeline/`

```
tools/pipeline/
  __init__.py
  build_data.py      CLI entry (adds tools/ to sys.path, then `from pipeline import ...`)
  db2.py             RawDB: lazy CSV loading, indexes, sha256, required-table check
  constants.py       class/tree map, SPEC_BASE_X, POSITION_OVERRIDES, aura/effect sets, stat names,
                     inventory/slot/subclass maps, power types, races v1, name filter regex, presets
  util.py            I, F, rhu, num, u32, fmt
  curves.py          curve_value(db, curve_id, x) -> float
  icons.py           IconResolver(db).name(file_id) -> str|None ; .missing list
  tooltips.py        render(text, ctx: SpellTextContext) -> (str, list[str]); SpellTextContext.from_db(db, spell_id, values=None)
  talents.py         build_talent_trees(db, opts, icons, report) -> dict[class_id, ClassTalentsFile]
  spells.py          collect_spells(db, talent_spell_ids, class_of_talent, report) -> dict[id, Seed]
                     build_spell(db, sid, seed, icons) -> dict ; build_ability_chains(db, seeds) -> list
  items.py           weapon_damage(db, sparse_row, item_row) -> (min, max, table)
                     item_stats(db, sparse_row) -> list ; build_weapons(db, era_db|None, overrides, icons, report)
  targets.py         build_targets(db) -> dict
  classes.py         build_classes(db, icons) -> dict ; build_pet_families(db, icons) -> dict
  coverage.py        classify_effect(effect, aura) -> str ; build_coverage(talent_files, spells_by_id) -> dict
  manual.py          validate_manual(manual_dir, db, report) (structure + spellId-name checks)
  writer.py          write_json(path, obj) ; write_records(path, header: dict, arrays: dict[str, list])
  check_icons.py     OPTIONAL network script (task 15), not used by build or tests
  fetch_era_items.sh downloads Era ItemSparse to data/raw/era/<eraBuild>/
  README.md          short usage (copy of the README section)
  tests/__init__.py
  tests/_fixtures.py shared: RAW/ERA paths, build-once helper (builds into a TemporaryDirectory, cached per process)
  tests/test_util_tooltips.py   synthetic tooltip tests (no raw data needed)
  tests/test_talents.py
  tests/test_values.py
  tests/test_spells.py
  tests/test_items.py
  tests/test_targets.py
  tests/test_output.py          manifest counts, determinism, schema spot checks, coverage
```

**db2.RawDB API:**
```python
class RawDB:
    def __init__(self, raw_dir: str): ...
    def rows(self, table: str) -> list[dict]          # cached; raises MissingTableError("...run tools/research/fetch_db2.sh")
    def by_id(self, table: str, key="ID") -> dict[str, dict]
    def by_spell(self, table: str) -> dict[str, dict]  # SpellID → row, DifficultyID=="0" filter if column exists; asserts unique
    def group(self, table: str, key: str, diff0=True) -> dict[str, list[dict]]
    def sha256(self, table) -> str ; def row_count(self, table) -> int ; tables_read: set[str]
```

**CLI:**
```
python3 tools/pipeline/build_data.py --build 1.60.1.70888 \
    [--raw data/raw/<build>] [--out data/generated/<build>] \
    [--era-raw data/raw/era/1.15.9.70576] [--no-era-fallback] \
    [--include-hidden-nodes] [--manual data/manual] [--date YYYY-MM-DD]
```
- If the era raw dir is missing and the fallback is on: print a WARNING, continue without fallback, and set manifest `eraBuild: null`.
- Exit code 1 on any assertion failure, with a clear message.
- Prints a summary of counts and the number of report items.

**Tests:**
```
python3 -m unittest discover -s tools/pipeline/tests -t tools -v
```
- Data-dependent tests use `@unittest.skipUnless(os.path.isdir(RAW), "raw data not fetched")`; era tests skip if the era raw dir is missing.
- The full build runs once per test process into a `tempfile.TemporaryDirectory` with `--date 2000-01-01`.

---

## 4. Algorithms (pseudo-code)

### 4.1 Talents
```
for tree_id, class in CLASS_TREES:
  nodes = TraitNode where TraitTreeID == tree_id
  groups_of(node), nodes_of(group)        # TraitNodeGroupXTraitNode
  conds_of(group)                         # TraitNodeGroupXTraitCond → TraitCond, keep SpentAmountRequired>0 and TraitNodeGroupID != 0
  spec_groups = unique [c.TraitNodeGroupID for all conds if SpentAmountRequired == 30] ; assert len == 3
  sort spec_groups by min PosX of members ; assert disjoint and union == all nodes
  for each node: gate = max(c.SpentAmountRequired for g in groups_of(node) for c in conds_of(g)) or 0
                 assert gate in {0,5,...,30}; tier = gate//5 + 1
                 assert Flags in {0, 8}; hidden = Flags & 8
                 entries = TraitNodeXTraitNodeEntry by _Index; assert len ≥ 1
  included = not hidden or opts.include_hidden
  col: section 1.1 (twin rule → POSITION_OVERRIDES → raise)
  collisions (included only) → raise
  tierGates: for each gating cond (amount A, scope S) of spec: countedNodeIds = sorted(nodes_of(S) ∩ included); dedupe by tier
  gateScopeAnomalies: included node n with tier t is missing from countedNodeIds of some gate with requiredPoints > gate(n) (A < 30 gates only)
  prereqs: section 1.1
  values: section 1.2 ; descriptions: tooltips.render(Spell.Description_lang or override, ctx with rank values)
```

### 4.2 Spells
Section 1.3. Per-spell builders read only Difficulty-0 rows. `sources` comes from seed membership.

### 4.3 Weapons
Section 1.5. Order: Forever weapons, then Era fallback; sort the output by id. Apply manual overrides last (match by id; unknown ids → `report.manualValidation`).

### 4.4 Coverage
Section 1.8. `spells_by_id[talent.spellId].effects` provides (effect, aura).

---

## 5. Manual data scaffolding (`data/manual/`)

Every file has a top-level `"_source"` string and `"_status": "[VERIFY]"`. `manual.validate_manual` checks:
- the files parse;
- the required keys exist;
- every non-null `spellId` exists in SpellName and its name contains the entry's `name` (case-insensitive). On mismatch, add a `report.manualValidation` entry (a warning, not an error).

### 5.1 `base-stats.json`
`_source`: "[VERIFY] Classic 1.12 level-60 base stats, best-effort reconstruction of vmangos player_levelstats/player_classlevelstats (from memory, not copied). Confirm each value with a naked level-60 character sheet in Forever (OPEN_QUESTIONS Q4/Q25)."

Class base values (human-equivalent), level 60. Unit for base crit columns is percent.

| token | str | agi | sta | int | spi | health | mana | baseMeleeCrit | baseSpellCrit |
|---|---|---|---|---|---|---|---|---|---|
| WARRIOR | 120 | 80 | 110 | 30 | 47 | 1689 | 0 | 0 | 0 |
| PALADIN | 105 | 65 | 100 | 70 | 75 | 1381 | 1512 | 0.7 | 0 |
| HUNTER | 55 | 125 | 85 | 65 | 70 | 1467 | 1720 | 0 | 0 |
| ROGUE | 80 | 130 | 75 | 35 | 52 | 1523 | 0 | 0 | 0 |
| PRIEST | 35 | 40 | 50 | 120 | 125 | 1397 | 1376 | 3 | 0.8 |
| SHAMAN | 85 | 55 | 95 | 90 | 105 | 1423 | 1520 | 1.7 | 2.3 |
| MAGE | 35 | 40 | 45 | 125 | 120 | 1360 | 1273 | 3.2 | 0.2 |
| WARLOCK | 50 | 55 | 70 | 105 | 110 | 1414 | 1373 | 2 | 1.7 |
| DRUID | 65 | 55 | 65 | 100 | 110 | 1483 | 1244 | 0.9 | 1.85 |

Race offsets (added to the class base; from Classic level-1 race bases relative to Human 20/20/20/20/21):

| race | str | agi | sta | int | spi |
|---|---|---|---|---|---|
| HUMAN | 0 | 0 | 0 | 0 | 0 |
| ORC | +3 | −3 | +2 | −3 | +2 |
| DWARF | +2 | −4 | +3 | −1 | −2 |
| NIGHTELF | −3 | +5 | −1 | 0 | −1 |
| SCOURGE (Undead) | −1 | −2 | +1 | −2 | +4 |
| TAUREN | +5 | −5 | +2 | −5 | +1 |
| GNOME | −5 | +3 | −1 | +3 | −1 |
| TROLL | +1 | +2 | +1 | −4 | 0 |

`validCombos` (Classic 1.12, `[VERIFY]` Forever):

| Class | Races |
|---|---|
| WARRIOR | all 8 |
| PALADIN | HUMAN, DWARF |
| HUNTER | DWARF, NIGHTELF, ORC, TAUREN, TROLL |
| ROGUE | HUMAN, DWARF, NIGHTELF, GNOME, ORC, SCOURGE, TROLL |
| PRIEST | HUMAN, DWARF, NIGHTELF, SCOURGE, TROLL |
| SHAMAN | ORC, TAUREN, TROLL |
| MAGE | HUMAN, GNOME, SCOURGE, TROLL |
| WARLOCK | HUMAN, GNOME, ORC, SCOURGE |
| DRUID | NIGHTELF, TAUREN |

Also include `conversions` copied from CALC_MODEL section 3 (AP per Str/Agi, crit per Agi, spell crit per Int), each tagged `[VERIFY]`.

### 5.2 `pets.json`
- `hunterFamilies`: keyed by CreatureFamily ID, with `{name, damageModifier, attackSpeed}` and `_source` "[VERIFY] Classic 1.12 family damage modifiers".

| ID | Family | damageModifier |
|---|---|---|
| 1 | Wolf | 1.00 |
| 2 | Cat | 1.10 |
| 3 | Spider | 1.07 |
| 4 | Bear | 0.91 |
| 5 | Boar | 0.90 |
| 6 | Crocolisk | 1.00 |
| 7 | Carrion Bird | 1.07 |
| 8 | Crab | 0.95 |
| 9 | Gorilla | 1.02 |
| 11 | Raptor | 1.10 |
| 12 | Tallstrider | 1.00 |
| 20 | Scorpid | 0.94 |
| 21 | Turtle | 0.90 |
| 24 | Bat | 1.07 |
| 25 | Hyena | 1.00 |
| 26 | Bird of Prey | 1.07 |
| 27 | Wind Serpent | 1.07 |
| 312 | Core Hound | null |
| 319 | Fox | null |

  `attackSpeed` is 2.0 for all families `[VERIFY]`.
- `warlockDemons`: Imp 23, Voidwalker 16, Succubus 17, Incubus 302, Felhunter 15, Felguard 310, Doomguard 19, each `{name, model: "spell"|"melee", notes}` with numbers null.
- `ownerScaling`: `{hunter: null, warlock: null}` (Q5).

### 5.3 `buffs.json`
Array of `{id, name, category: "raid"|"world"|"consumable"|"weaponEnhancement"|"food"|"debuff", spellId|null, effects: [{stat, value, unit}], notes, "_status": "[VERIFY]"}`. The spell IDs below were checked to exist with these names in this build.

- **Raid:**
  - battle_shout 25289 (AP 232)
  - blessing_of_might 25291 (AP 185)
  - blessing_of_kings 20217 (all stats +10%)
  - blessing_of_wisdom 19854? (null; resolve in Phase 3)
  - mark_of_the_wild 9885 (all stats +12, armor +285)
  - gift_of_the_wild 21850
  - arcane_intellect 10157 (int +31)
  - arcane_brilliance 23028
  - power_word_fortitude 10938 (sta +54)
  - prayer_of_fortitude 21564
  - divine_spirit 27841 (spi +40)
  - prayer_of_spirit 27681
  - leader_of_the_pack 24932 (melee/ranged crit +3%)
  - moonkin_aura 24907 (spell crit +3%)
  - windfury_totem 10614 (AP 315, 20% proc)
  - grace_of_air_totem 25359 (agi +77)
  - strength_of_earth_totem 25361 (str +77)
  - trueshot_aura 1299346 (Forever talent version; value from data in Phase 3)
- **World:**
  - rallying_cry 22888 (AP 140, melee crit +5%, spell crit +10%)
  - songflower 15366 (crit +5%, all stats +15)
  - spirit_of_zandalar 24425 (stats +15%)
  - warchiefs_blessing 16609 (melee haste +15%, HP 300, mp5 10)
  - fengus_ferocity 22817 (AP 200)
  - moldars_moxie 22818 (sta +15%)
  - slipkiks_savvy 22820 (spell crit +3%)
- **Consumable:**
  - elixir_of_the_mongoose 17538 (agi +25, crit +2%)
  - juju_power 16323 (str +30)
  - juju_might 16329 (AP 40)
  - flask_of_supreme_power 17628 (SP 150)
  - flask_of_the_titans 17626 (HP 400)
  - greater_arcane_elixir 17539 (SP 35)
  - elixir_of_shadow_power 11476 (shadow SP 40)
  - greater_firepower 26276 (fire SP 40)
- **Weapon enhancement:**
  - brilliant_wizard_oil 25122 (SP 36, spell crit +1%)
  - elemental_sharpening_stone 22757 (crit +2%)
  - dense_sharpening_stone 16641 (weapon damage +8)
- **Food:** grilled_squid (agi +10, null), smoked_desert_dumplings (str +20, null), nightfin_soup (mp5 8, null).
- **Debuff:**
  - sunder_armor 11597 (armor −450/stack, 5 stacks)
  - faerie_fire 9907 (armor −505)
  - curse_of_recklessness 11717 (armor −640)
  - expose_armor 11198 (armor −1700)
  - curse_of_the_elements (null; Forever ranks 1311676+, resolve in Phase 3)
  - curse_of_shadow (null; 402791 candidate)
  - shadow_weaving 15258 (shadow +15% at 5 stacks)
  - fire_vulnerability 22959 (fire +15% at 5 stacks)
  - winters_chill 12579 (frost crit +10% at 5 stacks)

### 5.4 `weapon-overrides.json`
`{ "_source": "...", "_status": "[VERIFY]", "weapons": { "19019": { "bonusDamage": { "min": 16, "max": 30, "school": "nature" } } } }`

### 5.5 `targets.json` (named bosses, for later)
`{ "_source": "...", "named": [] }`

---

## 6. Tests (concrete assertions, all verified against the data)

`test_util_tooltips.py` (synthetic, no raw data needed):
- `rhu(2.5) == 3`, `rhu(-2.5) == -3`, `rhu(1865.5) == 1866`.
- Render with a fake context for effects `[{base:18, variance:0.4444444}, {base:1, periodMs:2000}]` and duration 4000. The Fireball template gives the exact Fireball string from section 1.4.
- `$lpoint:points;` after "1" → "point"; after "2" → "points".
- `${$s1*4}` with s1=3 → "12".
- `${$s1/-1000}` with s1=-2000 → "2" (signed inside the expression).
- `$s1` with -40 → "40".
- `$?a123[X][Y]` → "Y".
- An unknown `$<mult>` stays verbatim and is listed in `unresolved`.
- `${$m2*$<mult>}` stays verbatim.

`test_talents.py`:
- 9 class files; each has 3 specs; names and capstones match section 1.1; per-spec (nodeCount, maxPoints) equal the table in section 1.1; total included talents 447.
- With default options no talent has `hidden`; 23 hidden nodes in the report; nodes 110859, 110855, 110870 are absent.
- Specific placements (nodeId → spec, tier, col, maxRank, requiredPoints):

| nodeId | Talent | spec | tier | col | maxRank | requiredPoints |
|---|---|---|---|---|---|---|
| 105792 | Impact | Fire | 2 | 2 | 3 | 5 |
| 105794 | Ignite | Fire | 2 | 0 | 5 | |
| 105790 | Pyroblast | Fire | 3 | 2 | 1 | |
| 105797 | Improved Fire Blast | Fire | 3 | 3 | 2 | |
| 105784 | Critical Mass | Fire | 5 | 1 | 3 | |
| 105782 | Fire Power | Fire | 6 | 2 | 3 | |
| 105798 | Arcane Power | Arcane | 7 | 1 | | 30 |
| 105778 | Precision | Frost | 1 | 2 | 3 | |
| 104982 | Lightning Reflexes | Hunter Survival (spec 2) | 6 | 2 | 5 | 25 |
| 105003 | Improved Serpent Sting | Marksmanship | 4 | 3 | | |
| 105865 | Holy Specialization | Priest Holy | 1 | 2 | 5 | |

  - Arcane Power: prereqNodeId 105801 (Presence of Mind, tier 5 col 1).
  - Hunter: exactly 3 specs, i.e. no "Spec 3".
- Prereqs:
  - 104961 Bestial Wrath ← 104964 Intimidation
  - 104964 ← 104970 Bestial Swiftness (not 104961)
  - 104928 Nature's Splendor ← 104927 Nature's Majesty
  - 105825 Improved Mind Flay ← 105826 Mind Flay
  - 104989 Counterattack ← 104986 Deterrence
  - Total prereq count across all classes is 69. No prereq points to a higher tier.
- `report.positionFixes` contains 104982 and 105865 with method "twin".
- No talent has `choices`.
- Every spec's talents are sorted by (tier, col) and have unique (tier, col).
- Every tier 1..7 has at least 1 talent per spec.

`test_values.py`:
- 105792 Impact ranks[*].values[0] == [3, 7, 10]; valueSources[0] == "curve".
- 104982 Lightning Reflexes values[0] == [3, 6, 9, 12, 15].
- Critical Mass 105784 == [2, 4, 6]; Mage Precision 105778 == [2, 4, 6]; Ignite 105794 == [8, 16, 24, 32, 40]; Fire Power 105782 values[0] == [1, 2, 3].
- Improved Fire Blast 105797: values[0] == [-1000, -2000]; values[1] == [8, 15].
- Barrage (Hunter, spellId 19461): valueSources[1] == "base", values[1] == [15, 15, 15], and the node appears in `report.multiRankWithoutCurve`.
- Descriptions:
  - Impact rank 2 == "Gives your Fire spells a 7% chance to stun the target for 2 sec."
  - Fire Power rank 3 matches the section 1.4 string.
  - Improved Fire Blast rank 1 matches the section 1.4 string.
  - Lightning Reflexes rank 5 == "Increases your Agility by 15%."

`test_spells.py`:
- 2,200 ≤ len(spells) ≤ 2,600; all talent spellIds present; every `triggerSpell` of an exported spell is itself exported.
- 133: rank 1, castMs 1500, gcdMs 1500, duration.ms 4000, range.max 35, school 4, family {set: 3, mask[0]: 1073741825}, costs[0] {powerType 0, amount 30}, effects[0] {effect 2, base 18, spCoef≈0.429 (abs diff < 1e-3), perLevel≈0.2}; computed `rhu(18*(1-var/2)) == 14` and `rhu(18*(1+var/2)) == 22`; description equals the Fireball string.
- 10151: rank 11, castMs 3500, effects[0].base 451, levels.base 60.
- 78 Heroic Strike costs[0] == {powerType 1, amount 15}; 1752 Sinister Strike costs[0] {powerType 3, amount 45}.
- Ability chain (classId 8, "Fireball").ranks == [133, 143, 145, 3140, 8400, 8401, 8402, 10148, 10149, 10150, 10151, 25306].
- No ability chain contains 401556 or 400613 (acq 3), and none comes from skill line 2851.
- All mask values in [0, 2³²); all `attributes` length 17.
- 11366 Pyroblast `passive == False`; 11115 Critical Mass `passive == True`.

`test_items.py`:
- 17182: min 223, max 372, speedMs 3700, damageTable "ItemDamageTwoHand", slot "twoHand", stats {4:12, 7:12, 51:30}, source "forever".
- 19019: 82–153, speedMs 1900, slot "oneHand", stats {3:5, 7:8, 51:8, 55:9}; bonusDamage == {16, 30, school "nature"} (school from the manual override; min/max from Era if available, else manual).
- 18713: 89–166, damageTable "ItemDamageRanged", slot "ranged", stats {32:14, 39:17}.
- 12784: 153–256, stats {7:13}.
- 18042 is in ammo with dps 17.71.
- No weapon name matches the filter regex. len(weapons where source == "forever") ≥ 1,000.
- (Skip without era raw.) 19364 Ashkandi 229–344 speed 3500 source "classic_era"; 19352 106–198 speed 2600.
- (Skip without era raw.) Cross-validation: for Forever weapons present in Era with equal ItemLevel, OverallQualityID, ItemDelay and DmgVariance and not filtered, computed (min, max) == Era (MinDamage_0, MaxDamage_0) for ≥ 97%.

`test_targets.py`:
- levels has 63 entries; level 63 armor 3731; level 60 armor 3566; level 10 armor 518; armorConstant == 400+85·L for all.
- byPlayerLevel["60"]: boss {63, 3731}, elite {62, 3677}, same {60, 3566}, lowArmorBoss {63, 1866}, custom {63, 3731}.
- Keys "1".."60" all present.

`test_output.py`:
- All files listed in section 2 exist; manifest counts equal the actual array lengths; manifest.rawTables sorted by name.
- Building twice with the same `--date` gives byte-identical outputs (compare all files).
- coverage: total == 447; every class ∈ {generic, special, unsupported}.
  - Ignite (11119) is "special" (aura 4 / 42).
  - Critical Mass (11115) is "generic".
  - Arcane Power (12042) kind "ability".
- classes.json: 9 classes, 8 races, talentCurrency.max 51, 56 sources.

---

## 7. README section (append to repo `README.md`; also save as `tools/pipeline/README.md`)

```
## Data pipeline (Phase 1)
1. Fetch client tables:  tools/research/fetch_db2.sh 1.60.1.70888
2. (Optional, recommended) Fetch Classic Era items for the weapon fallback:
   tools/pipeline/fetch_era_items.sh 1.15.9.70576
3. Build:  python3 tools/pipeline/build_data.py --build 1.60.1.70888
   → data/generated/1.60.1.70888/ (committed). Never hand-edit generated files.
4. Test:   python3 -m unittest discover -s tools/pipeline/tests -t tools -v
Options: --include-hidden-nodes (flag-8 talents), --no-era-fallback, --date YYYY-MM-DD.
Hand-maintained inputs live in data/manual/ (every value tagged [VERIFY] until confirmed in game).
Review data/generated/<build>/report.json after every new build.
```

---

## 8. Ordered task list (do these in order; each needs its acceptance check to pass)

1. **Extend the fetch script.**
   - Add to `TABLES` in `tools/research/fetch_db2.sh`: `ItemDamageRanged ItemDamageThrown ItemDamageWand RandPropPoints SpellRadius ManifestInterfaceData`, plus (for future use) `SpellDescriptionVariables SpellXDescriptionVariables`.
   - Create `tools/pipeline/fetch_era_items.sh [ERA_BUILD=1.15.9.70576] [OUT=data/raw/era/$ERA_BUILD]`, which downloads only `ItemSparse` from `https://wago.tools/db2/ItemSparse/csv?build=$ERA_BUILD`.
   - Run both.
   - *Accept:* `data/raw/1.60.1.70888/ItemDamageRanged.csv` has 100+ rows; `ManifestInterfaceData.csv` has about 134k rows; `data/raw/era/1.15.9.70576/ItemSparse.csv` has about 24k rows and contains id 19364. `git status` shows no files under data/raw.
2. **Skeleton.** Create `util.py`, `constants.py`, `db2.py` and `writer.py`, plus `tests/test_util_tooltips.py` (rhu cases only).
   - *Accept:* unittest discover runs green; `RawDB('data/raw/1.60.1.70888').rows('Nope')` raises with the fetch hint.
3. **Icons.** Write `icons.py`.
   - *Accept:* in a REPL, name(135812) == "spell_fire_flamebolt", name(136235) is None, name(0) is None.
4. **Tooltips.** Write `tooltips.py` (section 1.4) with a synthetic-context API.
   - *Accept:* all synthetic tests in section 6 pass.
5. **Talents.** Write `curves.py` and `talents.py` (sections 1.1–1.2, 4.1), but only produce in-memory structures plus report entries.
   - *Accept:* `test_talents.py` and `test_values.py` pass (write them now).
6. **Spells.** Write `spells.py` (section 1.3).
   - *Accept:* `test_spells.py` passes.
7. **Classes and pets.** Write `classes.py` (classes, specs, races, currency sources, pet families).
   - *Accept:* the classes.json assertions in `test_output.py` pass once wired.
8. **Weapons.** Write `items.py` (section 1.5) and `data/manual/weapon-overrides.json`.
   - *Accept:* `test_items.py` passes, including the era tests.
9. **Targets.** Write `targets.py`.
   - *Accept:* `test_targets.py` passes.
10. **Coverage.** Write `coverage.py`.
    - *Accept:* the coverage assertions pass. Print the summary and paste it into the PR description.
11. **Manual data.** Create `data/manual/base-stats.json`, `pets.json`, `buffs.json`, `targets.json` exactly as in section 5, and write `manual.py`.
    - *Accept:* the build reports no manual-validation errors other than the null spellIds.
12. **CLI and writer.** Wire everything into `build_data.py`, write all outputs, manifest and report, and generate `data/generated/1.60.1.70888/`.
    - *Accept:*
      - `test_output.py` passes, including determinism;
      - the full test suite is green;
      - the generated directory is under 10 MB;
      - `report.json` lists 23 hidden nodes, 2 position fixes, 3 posY inconsistencies (105003, 104982, 105865) and the gate anomalies for 105003 and 105865.
13. **Docs.**
    - `docs/PLAN.md`: Phase 1 checkboxes ticked; status ✅ when everything is done.
    - `docs/DATA_SOURCES.md`:
      - a weapons section with the table-selection rule;
      - the corrected Thunderfury note;
      - ItemSparse coverage and the Era fallback;
      - icons via ManifestInterfaceData;
      - talents = one spell plus curves;
      - layout decoding (spec groups, gates, SPEC_BASE_X, twin rule);
      - the new tables in the refresh procedure, adding step "run tools/pipeline/build_data.py and tests".
    - `docs/CALC_MODEL.md`: fix "Precision 6 per rank" → "rank values come from TraitDefinitionEffectPoints curves (Mage Precision 2/4/6); base points hold the max-rank value".
    - `docs/ARCHITECTURE.md`: replace the "Generated data contracts" block with the section 2.1 schemas (or a link to this plan), and state the icon decision.
    - `CLAUDE.md`: add the pipeline build and test commands.
    - *Accept:* the docs mention every decision in section 1.
14. **OPEN_QUESTIONS.md.**
    - Mark resolved, each with its source: Q7 (curves), Q8 (formula and tables, premise wrong), Q9 (ManifestInterfaceData plus render CDN), Q10 (no choice nodes in class trees), Q12 (node 104982 PosX typo). Mark Q15 partially resolved (Engraving not referenced by talents; AcquireMethod 3 excluded).
    - Add Q16–Q26 from section 9.
    - *Accept:* the table renders and every new row has "How to resolve".
15. **(Optional) `check_icons.py`.** HEAD-request each unique icon name against the render CDN (with fallback) and print the missing ones. Not part of the tests; do not commit its output.
16. **README** section 7. Commit with PLAN.md updated in the same commit.

---

## 9. Still uncertain (add to OPEN_QUESTIONS.md)

| # | Question | How to resolve |
|---|---|---|
| Q16 | Curve vs base mismatch (Savage Strikes base 20 vs curve 2/4; Ferocity 16 vs 10; Bestial Discipline 100 vs 20; Survival Tactics 17 vs 10; Spirit Bond 5 vs 10/5). Pipeline trusts curves. | Compare in-game talent tooltips per rank |
| Q17 | 25 multi-rank talents have effects without curves (e.g. Barrage effect 1 aura 108 = 15 constant, Improved Serpent Sting effect 1). Constant or server-scaled? | In-game tooltip/damage test at rank 1 vs max |
| Q18 | Most classic raid and dungeon weapons are absent from Forever ItemSparse (hotfix-delivered). Era fallback is used. Do Forever versions differ? | Compare in-game tooltips (Ashkandi, Felstriker, …) |
| Q19 | Forever reworked item stats (about 40% of shared weapons differ from Era). Equip/use effects (ItemEffect/ItemXItemEffect) are not exported yet. | Fetch ItemEffect tables in Phase 3; spot-check items |
| Q20 | Thunderfury secondary nature damage (16–30) is not in Forever DB2; manual override used. | In-game tooltip |
| Q21 | Tier-gate scope anomalies: Holy Specialization (105865) and Improved Serpent Sting (105003) are not in the groups whose points count toward later gates. Do their points unlock later tiers in game? | Spend 5 points only in Holy Specialization, check whether tier 2 unlocks |
| Q22 | Talent points at levels 5–9 come from the account-wide "Talented" Legacy perk. How should the UI expose this? | Owner decision plus in-game check |
| Q23 | Aura enum names above 270 and some unknown stat IDs (37, 84–89, 117, 124, 127, 131) are unconfirmed for Forever. | Engine work in Phase 3/4; in-game tests |
| Q24 | Flag-8 meaning (Q6) remains open. Live nodes 104982 and 105865 have flag-8 twins at the correct positions, which suggests flag 8 = superseded or hidden. | In-game talent UI |
| Q25 | Base stats per race/class/level and valid race/class combos in Forever (manual table from Classic recall). | Naked character sheets |
| Q26 | Ammo DPS: data gives Thorium Headed Arrow 17.71 dps vs Classic tooltip 17.5. | In-game tooltip |

Also keep Q2 open: Fireball rank 11 base 451 (397–505), coefficient 1.0. The pipeline exports raw values unchanged.
