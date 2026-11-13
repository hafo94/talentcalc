# Phase 7 implementation plan: Insight, levels & polish

Audience: the agent that implements this phase. Follow this document literally. When it says "exactly", copy the value
or the code. When something here contradicts an older doc, this document wins, and task T11 updates the older doc.

Everything below was checked against `data/generated/1.60.1.70888/`, `data/raw/1.60.1.70888/` and wago.tools on
2026-11-13 and implemented as a prototype in a scratch copy of the repo at commit `2ed74b2` (branch
`claude/stoic-allen-90bng2`). Prototype results: pipeline tests **59** OK (53 + 6), `tsc -b` clean, `eslint .` clean,
`prettier --check .` clean, `vite build` OK (main chunk 124 KB gzip, unchanged ±0.1 KB), `vitest run` **315 tests** OK
(287 + 28), Playwright **39 tests** OK (31 + 8; pre-installed Chromium, `--trace off`).

**The code is in this document as unified diffs; copy them.** Section 6 holds seven diffs, A–G, each against the tree
after the previous one (A against `2ed74b2`). New files are "new file" hunks of the same diffs. Every block was verified
with `git apply --check` on a fresh clone of `2ed74b2` in the order A, B, C, D, E, F, G; after applying them (and the
one `npm install` command of task T7) the tree is byte-identical to the prototype. Save a block to a file and run
`git apply <file>`. If a hunk does not apply because the branch moved, make the same change by hand. No generated data
changes in this phase: `data/generated/**` stays byte-identical (task T3 proves it by rebuilding with `--date 2026-11-13`).

---

## 0. Key decisions (summary)

| Topic | Decision | Evidence |
|---|---|---|
| **Default pet (owner decision)** | A class picked **in the UI** starts with a pet: hunter **Cat** (CreatureFamily 2), warlock **Imp** (23), everyone else none (`DEFAULT_PET_FAMILY`, `defaultPet(token)` in `src/engine/pets/types.ts`, used only by `useCharacter.fitToClass`). Links never use it: the decoder's implied default stays `NO_PET`, a v2 link without tag 8 is still "None", and the encoder still writes tag 8 whenever the pet differs from `NO_PET`. So a fresh hunter's URL is `#v2.hunter.60.0..CAMCAAA` (it was `#v1.hunter.60.0`), a fresh warlock's is `#v2.warlock.60.0..CAMXAAA`, and choosing None gives `#v1.hunter.60.0` again. No existing golden changes (all Phase 2–6 goldens are encoded from explicit state). | Python encoder (section 8.6): `record(8,[23,0,0])` = `CAMXAAA`. |
| **"Choose a pet" note** | New optional `SpecRotation.noPetNotes` (rotations.json): BM's "Choose a pet…" and Demonology's "Choose a demon or a Demonic Sacrifice…" move there. `DamageView.notes` = `notes` + `noPetNotes` while neither a pet nor a sacrifice is chosen; the Damage panel renders `DamageView.notes` (`data-testid="rotation-note"`). | KNOWN cosmetic issue fixed. |
| **Stat strip DPS** | The strip under the talent bar shows `totalDps` (owner + pet) like the Damage panel headline (it showed the owner's DPS; hunters and warlocks now always have a pet). | e2e asserts both are equal. |
| **Level data source** | Forever's client data has **no player level-stat table**: `ExpectedStat.PlayerPrimaryStat` (expansion −2) is a retail item-budget curve (20 at level 1, 3212 at 60, Classic Warrior has 120 Str), gt tables are gone, `CharBaseInfo` has only race/class combos. So base stats below 60 are a **documented approximation** `[VERIFY Q76]`: new `base-stats.json` `level1` table (Classic 1.12 level-1 stats of a Human of each class: Human 20/20/20/20/21 + class modifiers; health/mana from vmangos `player_classlevelstats` level 1, recalled) and **linear interpolation** to the level-60 table, rounded; race offsets and base crit constant; Agility/Intellect per 1% crit scale with the class's base Agility/Intellect (a naked character keeps the same crit from base stats at every level: Warrior 60/15 = 80/20 = 4%). | Section 1; golden L1–L4 (Python). |
| **Level rules** | Talent points = level − 9 (+ Talented, unchanged `availablePoints`); spell ranks = highest learnable (`learn`, unchanged); weapon skill 5 × level (unchanged); reference mobs from `targets.json byPlayerLevel` (unchanged, now visible); weapons and ammo filtered by `requiredLevel` (unchanged pickers; `fitToLevel` drops equipped ones that no longer fit); **pet level = player level** (`petBaseAt`: primary stats interpolated from new `pets.json owners.*.level1`, melee damage level ± floor(level/4), CMaNGOS formula, `[VERIFY Q77]`); **buffs**: new `buffs.json minLevel` (+ `itemId`), a buff selected below its `minLevel` stays in the build/URL but does nothing (`assemble` skips it; the checkbox shows "(level N)" in red). `minLevel` = `SpellLevels.BaseLevel` of the modeled rank for class buffs/debuffs, the tier level for talent auras (Leader of the Pack, Moonkin Aura 40), `ItemSparse.RequiredLevel` for consumables/weapon buffs; the pipeline validates it (`report.manualValidation`, 0 problems). | Section 1 tables; `test_phase7.py`. |
| **Level selector + URL** | The level was already in the v1/v2 header (`#v1.<class>.<level>.<rank>`; decoder accepts 1–60, `decodeBuild`): **no format change**. New `useCalc.setLevel(level)` (clamped 1–60): sanitizes ranks like Talented/links (greedy in tree order) and drops weapons above the level, with a notice ("Talent points above level 30 were removed."). Raising the level keeps the build. UI: `<select data-testid="level-select">` (60 … 1) in the points bar; the Character panel shows "Level N". | `levels.test.ts`, `levels.spec.ts`. |
| **Talent impact: rotation rule** | Each delta is the difference of two analytical evaluations with the **same rotation rule as the panels** (the editor's rotation, else the spec with the most points), so the tooltip predicts exactly what the Damage panel shows after the click. When the extra point changes the leading spec, the tooltip says "Rotation becomes: <label>" (e.g. the first Bloodthirst point of a talentless warrior: −2.6 DPS, Arms → Fury rotation). Point rules are ignored (a locked talent shows what its first point would add). | `insight.test.ts`. |
| **Talent impact: what is shown** | Under the description, a separator and: `Next point: +12.3 DPS (+1.40%)` (green > 0, red < 0, grey ±0.0) with a grey line of up to 4 changed key stats (`+1.00% crit vs target · +20 attack power`), and `Last point: −11.0 DPS (−1.25%)` likewise; "Rotation becomes: …" when it switches; grey "Not modeled: its DPS is not counted." for talents in `notModeled`. Key stats (`IMPACT_STATS`): attack power, ranged AP, spell power (best school), hit, ranged hit, spell hit, crit/ranged crit/spell crit vs target, melee/ranged/spell haste, weapon skill, Str, Agi, Int; a delta is shown when ≥ 0.5 (points) or ≥ 0.005 (%). | Screenshot check, e2e. |
| **Talent impact: performance** | `derive(…, { reference: false })` skips the four/five reference rows (light derive 0.3–0.75 ms vs 1.0–2.2 ms full, Node). One tooltip = 2 light derives (0.75 ms BM hunter + Cat). `InsightCache` memoizes per input set (store references), so a second hover is free. **Per-tree DPS** ("+60.4 DPS" in each tree header with points: current DPS minus DPS without that tree's points) is computed in `requestIdleCallback` after each change (3 light derives). **Heat map** (checkbox "Show the DPS of the next point on every talent"): every talent's next-point DPS in idle batches of 6 talents, a small badge top-left of each icon; 33 ms per class in Node. `useDerived` now shares one `derive` per state change across all panels (each panel ran its own before). | `perf.test.ts` budgets: tooltip < 4 ms, heat map < 150 ms, weights < 60 ms. |
| **Stat weights (EP)** | Paired evaluations of the build with more of one bonus stat: AP/RAP +50, SP (+ each school) +25, Str/Agi/Int +25, crit/spell crit/haste +1%, weapon skill +5. **Reference stat** = the power stat (AP, ranged AP, spell power) with the most DPS per point; ties go to the more specific one (a hunter's +AP also adds ranged AP → ranged AP). EP = DPS per point / reference DPS per point. **Hit cap**: hit and spell hit are measured as the **average DPS per 1% from your hit up to the cap** (this handles the suppressed first 1% vs a boss) and **above the cap** (+1% from the cap); at or above the cap only "above the cap" is shown. School rows only when more than one school deals damage. Computed only while the collapsible "Stat weights" panel is open (≈ 20 light derives, 15 ms). | W1 golden (Python) matches to 1e-8. |
| **Simulated weights** | "Simulate weights" runs every needed patch (7–11 runs) in a worker with the Simulation panel's settings (fight, iterations, seed, mana). **Common random numbers**: every variant uses the same seed, iteration i of every variant the same streams, and a pair's 95% CI comes from per-iteration differences (+50 AP warrior: ±0.38 vs ±0.57 independent; +25 SP mage: ±0.024 vs ±0.71). Columns "Sim DPS (95% CI)" and "Sim EP". | `src/engine/sim/weights.test.ts`. |
| **Compare builds** | Pin the current build as **A**, keep editing **B**. The page URL carries both: `#<B>~<A without '#'>`. "~" is in no build hash (base64url, tokens, digits), so every existing link decodes unchanged, and a compare link opens with both builds. Panel "Compare builds" (desktop under Stat weights; mobile Damage tab): buttons Pin (again) / Swap A and B / Stop comparing, a table A / B / B − A (build, rotation, DPS, pet DPS, every non-zero key stat) and the talent differences ("Ignite: 5 → 4"; "Different classes: talents are not compared."). A is rebuilt from its hash with the same rules as a link (`loadBuild`, pure helpers `characterFromCode` / `petFromCode` extracted from the stores). | `compare.test.ts`: loadBuild equals applying the link to the stores for 4 links. |
| **Mobile + accessibility** | Reference table (L20): below 600 px each target is a card (CSS grid, `td::before { content: attr(data-label) }`, visually hidden thead; explicit `role` attributes keep the table semantics). axe-core in Playwright: **`@axe-core/playwright` 4.10.2 exact** (axe-core 4.10.3 via its `~4.10.2` range in the lock file), WCAG 2.0/2.1 A+AA tags; serious/critical violations fail. The existing app had none; found and fixed: new buttons without the panel style (contrast 1.14), and the mobile talent tabs' `aria-controls` pointing at a missing id (critical) → each tree section gets `id="tree-panel-<i>"` and `role="tabpanel"` in the tabbed layout. Keyboard: every new control is a native select/checkbox/button/summary (e2e drives them with the keyboard). | `a11y.spec.ts`, `mobile.spec.ts`. |
| **Data refresh** | New `tools/refresh_build.py` (stdlib): latest wowf build from wago.tools `/api/builds` (needs a `User-Agent` header: Python's default gets HTTP 403), fetch, build with `--date`, a Markdown diff summary against the app's build (counts, files with the build string/date blanked, talents, spell values, weapons, targets, manual-data checks, warnings), pipeline tests against the new build (`TALENTCALC_BUILD`), `--switch` rewrites the 7 places that name the build. Exit 0/1/2. Footer already shows the build and date (verified); new warning after **90 days** ("The data is N days old…"). | Run against the new build 1.60.1.70938 (section 1.4). |
| **New build 1.60.1.70938** | wago.tools lists **1.60.1.70938** (2026-11-13 01:36) after 70888. The script's report: 2 new spells, 10 changed (Imp Firebolt ranks 1–4, Wild Growth 1–3, Wrack, Poised ×2), talent Wrack values `[36,10]` → `[25.2,100]`, 1 weapon changed, targets unchanged, 0 manual-data problems; one pipeline test fails only on the spell count (2340 → 2342). **Not switched in Phase 7** (keeps every golden stable); switching is the first "Next idea" in PLAN.md, done with the script. | Section 1.4. |
| **Addon (stretch)** | Design sketch only (section 12): `TalentCalcExport` for the Mainline 12.x client (`## Interface: 16001`, `_Forever.toc`), exports the character sheet out of combat to SavedVariables and prints a `#v2…` link. Not prototyped, cannot be tested here. | — |
| **Generated date** | No pipeline output changes (manifest, report and every file byte-identical with `--date 2026-11-13`); the manual-data additions only add validation that passes. | Task T3. |

---

## 1. Verified data facts (what the code may rely on)

### 1.1 Level data in the client (70888)

| Table | What it has | Usable for base stats? |
|---|---|---|
| `ExpectedStat` (ExpansionID −2, levels 1–133) | `PlayerHealth` 36 → 2603 at 60, `PlayerMana` 260 → 50000, `PlayerPrimaryStat` 20 → **3211.8** at 60, `PlayerSecondaryStat` 0 → 3734 | No: retail item-budget scaling (a Classic level-60 Warrior has 120 Str). `CreatureArmor`/`CreatureHealth` are already used for targets. |
| `CharBaseInfo` | race/class combos only | No |
| gt tables (`gtChanceToMeleeCrit`, …) | not in the client since 7.x / not on wago for wowf | No |
| `SpellLevels` | `BaseLevel` / `SpellLevel` per spell rank | Yes: spell ranks (already), buff `minLevel` |
| `ItemSparse.RequiredLevel` | items | Yes: weapons (already), consumable `minLevel` |

### 1.2 Buff `minLevel` (data/manual/buffs.json, validated by the pipeline)

| Buff | minLevel | Source |
|---|---|---|
| Battle Shout 25289, Blessing of Might 25291, Mark of the Wild 9885, Power Word: Fortitude 10938, Divine Spirit 27841, Trueshot Aura 20906, Grace of Air Totem 25360, Strength of Earth Totem 25362 | 60 | SpellLevels.BaseLevel |
| Arcane Intellect 10157 | 56 | SpellLevels |
| Blessing of Kings 20217 | 20 | SpellLevels |
| Leader of the Pack 24932 (no SpellLevels row), Moonkin Aura 24907 | 40 | talent tier 7 (31st point at 40); SpellLevels 40 for Moonkin Aura |
| Sunder Armor 11597 / Expose Armor 11198 / Faerie Fire 9907 / Curse of Recklessness 11717 / Curse of the Elements 1311680 | 58 / 56 / 54 / 56 / 50 | SpellLevels |
| Elixir of the Mongoose (item 13452) 46, Greater Agility (9187) 38, Winterfall Firewater (12820) 45, Flask of Supreme Power (13512) 50, Flask of the Titans (13510) 50, Greater Arcane Elixir (13454) 47, Shadow Power (9264) 40, Grilled Squid (13928) 35, Smoked Desert Dumplings (20452) 45, Brilliant Wizard Oil (20749) 45, Elemental Sharpening Stone (18262) 50, Dense Sharpening Stone (12404) 35 | as listed | ItemSparse.RequiredLevel |
| Elixir of Giants 38, Elixir of Greater Firepower 40 | as listed | not in Forever's ItemSparse (only the recipes): Classic 1.12 values, no `itemId` |
| Juju Power, Juju Might, world buffs | 1 (absent) | RequiredLevel 0 in ItemSparse |

### 1.3 Level goldens (independent Python, section 8.1)

| # | Case | Values |
|---|---|---|
| L1 | Human Warrior level 40 | Str 87, Agi 60, Sta 80, Int 27, Spi 38, health 1123; Agi per 1% crit 15 (= 20 × 60 / 80); AP 3 × 40 − 20 + 2 × 87 = **274**; crit from Agility 4.00% (same as at 60) |
| L2 | Human Mage level 1 | the `level1` row (20/20/20/23/23, health 32, mana 100); Int per 1% spell crit 59.5 × 23 / 125 = **10.9480** |
| L3 | targets at player level 40 | boss 43 / 2414 armor, elite 42 / 2262, same 40 / 1980, low-armor boss 43 / 1207 |
| L4 | hunter pet level 40 | Str round(22 + 114 × 39/59) = **97**, AP 2 × 97 − 20 = **174** (scaling off), melee **30–50** |

### 1.4 The new build 1.60.1.70938 (refresh script report, 2026-11-13; not applied)

`python3 tools/refresh_build.py --date 2026-11-13` (exit 1: one count test): counts unchanged except spells 2340 → 2342;
files changed (build string/date ignored): coverage, manifest, pets/warlock, spells.json, spells/{druid,hunter,mage,priest,rogue,warlock},
talents/{druid,warlock}, weapons.json; 15 identical. Talents: Wrack (warlock 105909) values `[[36, 10]]` → `[[25.2, 100]]`.
Spells changed: Firebolt 3110/7799/7800/7801 (Imp ranks 1–4; rank 7 11763 used at 60 unchanged), Wild Growth 408120/1238214/1238215,
Wrack 1316697, Poised 1328825/1328829. Targets unchanged; manual-data checks 0 problems; pipeline warnings 0.

---

## 2. Module structure and import direction

```
src/engine/pets/types.ts           DEFAULT_PET_FAMILY, defaultPet(token)                                    (A)
src/engine/stats/errors.ts         UnsupportedLevelError (moved; character.ts re-exports it)                (B)
src/engine/stats/levels.ts         baseStatsAt(file, cls, level): LevelBase                                 (B)
src/engine/pets/stats.ts           petBaseAt(config, level); computePetStats uses it                        (B)
src/engine/stats/assemble.ts       buffs below minLevel are skipped                                          (B)
src/engine/sim/run.ts              runDpsSamples(input, config): Float64Array                                (D)
src/engine/sim/weights.ts          simWeights(request, onProgress): paired stat weights                      (D)
src/engine/sim/worker.ts, types.ts request/response type "weights"                                           (D)
src/state/store.ts                 setLevel                                                                  (B)
src/state/character.ts            fitToLevel; petFromCode / characterFromCode (pure, from applyPet/applyCode) (B, E)
src/state/derived.ts               DeriveOptions { reference }, exported CalcInput/CharInput, DamageView.notes (A, C)
src/state/insight.ts               IMPACT_STATS, snapshot, compare, talentImpact, treeContribution, InsightCache (C)
src/state/weights.ts               WEIGHT_STATS, weightJobs, usedJobs, weightRows, statWeights                (D)
src/state/weightsSim.ts            useWeightsSim (worker client, message type "weights")                    (D)
src/state/sim.ts                   createSimWorker()                                                         (D)
src/state/compare.ts               COMPARE_SEPARATOR, splitHash, joinHash, useCompare, loadBuild, talentDiff  (E)
src/state/urlSync.ts               "#B~A", applying guard                                                    (E)
src/ui/stats/useDerived.ts         useDeriveInputs, shared derive memo                                       (C)
src/ui/talents/useInsight.ts       insightCache, useInsightInputs, onIdle, useTreeContribution, useHeatmap   (C)
src/ui/talents/{TalentTooltip,TalentTree,TalentNode,TalentCalculator,PointsSummary}.tsx                       (B, C, F)
src/ui/results/WeightsPanel.tsx    collapsible stat weights (+ simulation)                                   (D)
src/ui/results/ComparePanel.tsx    compare A/B                                                               (E)
src/ui/stats/StatsPanel.tsx        reference cards                                                           (F)
src/ui/common/dataAge.ts           footer "data may be outdated"                                             (G)
tools/refresh_build.py             data refresh                                                              (G)
e2e/a11y.ts                        expectNoSeriousA11yIssues (axe)                                           (F)
```

Import direction is unchanged: `stats` <- `combat` <- `abilities` <- `talents/special` <- `rotation` <- `pets` <- `sim`;
`src/state` imports `engine/*` (`insight`, `weights` and `compare` import `derived`; `compare` imports the data loaders);
`src/ui` imports `state`. `engine/sim/weights.ts` only imports `engine/sim/run` and types. Insight and weights are in
`src/state` because they are differences of `derive` (which lives there); they stay pure (no React, no store reads).

## 3. Data contracts

```ts
// data/manual/base-stats.json (B) — BaseStatsFile
level1?: { _source: string; classes: Record<ManualClassToken, LevelOneStats> };   // LevelOneStats = ClassBaseStats minus base crits
// data/manual/pets.json (B) — PetOwnerConfig, plus a top-level "_levels" note
level1?: { str; agi; sta; int; spi };     // hunter and warlock: 22/20/22/20/20 [VERIFY Q77]
// data/manual/buffs.json (B) — BuffDef, plus a top-level "_minLevel" note
minLevel?: number;   // absent = 1
itemId?: number;     // consumables/weapon buffs: ItemSparse id whose RequiredLevel is minLevel
// data/manual/rotations.json (A) — SpecRotation
noPetNotes?: string[];                    // hunter-beast-mastery, warlock-demonology

// src/state/derived.ts
interface DeriveOptions { reference?: boolean }              // false: Derived.reference = []
interface DamageView { …; notes: string[] }                  // rotation notes + noPetNotes while no pet/sacrifice

// src/state/insight.ts
interface InsightInputs { calc: CalcInput; ch: CharInput; rotation: SpecRotation | null }   // = derive's arguments
interface Snapshot { dps: number; stats: Record<string, number>; rotation: { id: string; label: string } }
interface Impact { dps: number; pct: number; stats: StatDelta[]; rotation: string | null }
interface TalentImpact { next: Impact | null; prev: Impact | null }

// src/state/weights.ts
interface WeightJobs { patches: Record<string, Partial<BonusStats>>; pairs: WeightPair[]; hits: { melee?: HitState; spell?: HitState } }
interface WeightPair { id: string; from: string; to: string; per: number }   // id "<key>" or "<key>:above"
interface WeightRow { def: WeightDef; perPoint: number | null; ep: number | null; cap?: { current; cap; above; aboveEp } }

// src/engine/sim/types.ts (worker protocol, additive)
SimRequest  |= { type: "weights"; id; request: SimWeightsRequest }      // { input, patches, pairs, config }
SimResponse |= { type: "weights"; id; result: SimWeightsResult }        // { base: Summary, pairs: {id, delta: Summary}[], iterations, runs, elapsedMs }

// URL (E): location.hash = "#" + B + ("~" + A)?  — B and A are complete v1/v2 build strings; A is optional.
```

## 4. Algorithms

### 4.1 Default pet (A)
`fitToClass(token)` (a class clicked in the class picker) sets `pet = defaultPet(token)`. `applyBuildCode` (links) calls
`applyCode` (does not touch the pet) and `applyPet(code.character.pet)` (absent → `NO_PET`). `toCode` writes the pet
when it differs from `NO_PET`. Switching class in the UI always resets to that class's default pet (Phase 6 reset to None).

### 4.2 Base stats by level (B)
```
baseStatsAt(file, cls, level):
  level == file.level (60): classes[cls], agiPerMeleeCrit[cls], intPerSpellCrit[cls]
  1 <= level < 60 (integer), level1 present:
     t = (level − 1) / 59;  s(L) = round(s1 + (s60 − s1) × t) for str, agi, sta, int, spi, health, mana
     agiPerMeleeCrit(L) = agiPer60 × agi(L) / agi60;  intPerSpellCrit(L) = intPer60 × int(L) / int60 (undefined stays undefined)
  else: UnsupportedLevelError
petBaseAt(config, L) (L < 60 and level1 present): primary stats like above; min = base.min × (L − ⌊L/4⌋) / 45, max = base.max × (L + ⌊L/4⌋) / 75
```
Unchanged level rules (already in the engine): AP `perLevel × L`, weapon skill 5 × L, rage conversion c(L), spell ranks
`learn(level)`, spell `perLevel` scaling, outcome tables vs `targets.byPlayerLevel[L]`, pet ability ranks, Demonic
Knowledge (% of level). Rating conversions (10/14/10 per 1%) stay level-60 values (new limit L26).

### 4.3 Talent impact (C)
```
snapshot(inp, ranks, bonus) = derive({...calc, ranks}, {...ch, bonus}, inp.rotation, {reference: false})
                             → { dps: damage.totalDps, stats: IMPACT_STATS values, rotation {id,label} }   (null without damage)
talentImpact(inp, base, node): rank r, max m
   next = r < m ? compare(base, snapshot(ranks with node = r + 1)) : null
   prev = r > 0 ? compare(base, snapshot(ranks with node = r − 1)) : null          (no point-rule checks)
compare(base, x) = { dps: x.dps − base.dps, pct: dps / base.dps × 100, stats: deltas ≥ 0.5 (int) / 0.005 (%), rotation: label if id changed }
treeContribution(inp, base)[i] = 0 if no points in tree i, else base.dps − snapshot(ranks without tree i).dps
InsightCache: one input set (all derive arguments compared by reference) → baseline + impacts by node + trees; a new set clears it.
```
UI timing: tooltip = synchronous `useMemo` (≤ 2 light derives); tree totals and heat map in `onIdle` (requestIdleCallback,
timeout 500 ms; Safari: `setTimeout(0)`), heat map batches of 6 talents, effects cancelled on every input change.

### 4.4 Stat weights (D)
```
weightJobs(inp): patches {base: {}}; for each WEIGHT_STATS def:
   normal: patch k = {k: bonus[k] + step}; pair {id k, base → k, per step}
   hit / spellHit: h = {current, cap} (hunter: ranged hit vs view.ranged.hitCap; else main hand; spell: hit.spell vs view.spell.hitCap)
      gap = round2(cap − current)
      gap > 0: patches k:cap = bonus + gap, k:cap+1 = bonus + gap + 1; pairs {k: base → k:cap per gap}, {k:above: k:cap → k:cap+1 per 1}
      else:    patch k:cap+1 = bonus + 1; pair {k:above: base → k:cap+1 per 1}
statWeights: DPS of every patch (light derive) → pair value = (dps(to) − dps(from)) / per → weightRows:
   rows: stats with |per| > 1e-6 or |above| > 1e-6; drop school rows unless ≥ 2 schools deal damage
   reference = power stat (AP, RAP, SP) with the largest per > 0 (ties → the later one); ep = per / ref.per
simWeights: runDpsSamples per patch (same config, same seed) → pair samples d_i = (b_i − a_i) / per → summarize (mean, 95% CI)
```

### 4.5 Compare (E)
`splitHash("#B~A") = { build: "#B", pinned: "#A" }`; `joinHash(B, A) = B + "~" + A.slice(1)` (B alone when A is null or
B is empty). `initUrlSync.apply`: set `useCompare.pinned` (if A decodes; else notice "The pinned build (A) in this link
could not be read.") **while `applying` is true** (so the store subscription does not write the previous state back),
then apply B as before. `write` appends the pinned build. Pin = `splitHash(location.hash).build`; Swap = set
`location.hash = joinHash(A, B)` (the hashchange listener applies it); Stop = `clear()`. `loadBuild(hash)`: decode, load
the class files (cached loaders), `buildClassTree`, `sanitize` ranks with the link's level and Talented rank, weapons.json
only if the link has weapons, `characterFromCode`, `petFromCode`, `codeToRotation(catalogFor(spells, tree))`.

### 4.6 Data refresh (G)
See the module docstring of `tools/refresh_build.py` (diff G). The diff summary is informational; exit 1 means "review"
(manual-data problems or failing pipeline tests), 2 means the fetch or the pipeline failed.

## 5. UI summary

| Where | What | test ids |
|---|---|---|
| Points bar | `Level [60 ▾]` select (60 … 1) | `level-select` |
| Under the stat strip | checkbox "Show the DPS of the next point on every talent" (+ "(computing…)") | `heatmap-toggle` |
| Tree header | "+60.4 DPS" (grey, 11 px) left of the points, only with points, tooltip explains | `spec-dps-<i>` |
| Talent node | heat-map badge top-left, green/red/grey | `node-impact` (`data-sign`) |
| Talent tooltip | impact block (section 0) | `talent-impact`, `impact-next`, `impact-prev` |
| Character panel | "Level N"; buffs below their level show red "(level N)" and a title | `character-level` |
| Target panel | preset texts at the selected level ("Boss (33, 1317 armor)") | — |
| Under the Damage panel | collapsible **Stat weights** (summary `weights-toggle`): table Stat / DPS / EP (+ Sim DPS (95% CI) / Sim EP), "Simulate weights", progress, cancel | `weights-panel`, `weights-table`, `weight-<key>`, `weight-<key>-above`, `weight-ep`, `weights-sim-run`, `weights-sim-cancel`, `weights-sim-progress` |
| Under Stat weights | **Compare builds** | `compare-panel`, `compare-pin`, `compare-swap`, `compare-clear`, `compare-table`, `compare-dps(-a/-b/-delta)`, `compare-<statId>`, `compare-talents` |
| Damage panel | rotation notes | `rotation-note` |
| Stats panel (< 600 px) | reference target cards | `ref-row-<preset>` |
| Footer | build/date; "The data is N days old…" after 90 days | `data-build`, `data-outdated` |
| Mobile | Damage tab = Damage + Stat weights + Compare | — |

---

## 6. The diffs

Apply in order A, B, C, D, E, F, G (`git apply <file>`). Every block was checked with `git apply --check` on a fresh clone of `2ed74b2` after the previous blocks.

### 6.1 A: default pet, `noPetNotes`, strip DPS (task T2)

Files: `data/manual/rotations.json`, `src/data/types.ts` (`noPetNotes`), `src/engine/pets/types.ts` (`DEFAULT_PET_FAMILY`, `defaultPet`), `src/state/character.ts` (`fitToClass`), `src/state/derived.ts` (`DamageView.notes`), `src/ui/results/DamagePanel.tsx`, `src/ui/stats/StatStrip.tsx` (total DPS), tests `src/state/pets.test.ts` (+2), `e2e/pets.spec.ts` (tests 1 and 2 rewritten for the default pet).

````diff
diff --git a/data/manual/rotations.json b/data/manual/rotations.json
index 6421968..435bfcf 100644
--- a/data/manual/rotations.json
+++ b/data/manual/rotations.json
@@ -56,7 +56,7 @@
         { "ability": "Arcane Shot", "kind": "cooldown" },
         { "ability": "Serpent Sting", "kind": "dot" }
       ],
-      "notes": ["Choose a pet in the Pet panel: its damage (and Bestial Wrath in the simulation) is added to the DPS."] },
+      "notes": [], "noPetNotes": ["Choose a pet in the Pet panel: its damage (and Bestial Wrath in the simulation) is added to the DPS."] },
     { "id": "hunter-marksmanship", "class": "hunter", "spec": 1, "label": "Marksmanship: Sniper, Aimed, Multi, Arcane Shot", "role": "dps", "tier": 1,
       "selfBuffs": ["Aspect of the Hawk", "Hunter's Mark"], "melee": false, "autoShot": true,
       "entries": [
@@ -208,7 +208,7 @@
         { "ability": "Bane of Agony", "kind": "dot" },
         { "ability": "Shadow Bolt", "kind": "filler" }
       ],
-      "notes": ["Choose a demon or a Demonic Sacrifice in the Pet panel (Master Demonologist, Soul Link and Demonic Knowledge follow the demon)."] },
+      "notes": [], "noPetNotes": ["Choose a demon or a Demonic Sacrifice in the Pet panel (Master Demonologist, Soul Link and Demonic Knowledge follow the demon)."] },
     { "id": "warlock-destruction", "class": "warlock", "spec": 2, "label": "Destruction: Immolate, Conflagrate, Incinerate or Shadow Bolt", "role": "dps", "tier": 1,
       "selfBuffs": [], "melee": false, "autoShot": false,
       "entries": [
diff --git a/e2e/pets.spec.ts b/e2e/pets.spec.ts
index 7a16d48..b0f8c08 100644
--- a/e2e/pets.spec.ts
+++ b/e2e/pets.spec.ts
@@ -5,30 +5,40 @@ test.beforeEach(async ({ page }) => {
   await blockRemoteImages(page);
 });
 
-test("hunter pet: picking a pet adds its DPS; the pet is in the link", async ({ page }) => {
+test("hunter: a new hunter starts with a Cat; None shows the pet note; the pet is in the link", async ({
+  page,
+}) => {
   const w = watchErrors(page);
   await page.goto("./");
   await page.getByRole("button", { name: "Hunter", exact: true }).click();
   const total = page.getByTestId("dps-total");
-  await expect(total).not.toHaveText("");
-  const before = Number(await total.textContent());
-  await expect(page.getByTestId("pet-damage")).toHaveCount(0);
-  await page.getByTestId("pet-select").selectOption({ label: "Cat (+10% damage)" });
+  await expect(page.getByTestId("pet-select")).toHaveValue("2");
   await expect(page.getByTestId("pet-damage")).toBeVisible();
   await expect(page.getByTestId("pet-row-melee")).toBeVisible();
-  await expect.poll(async () => Number(await total.textContent())).toBeGreaterThan(before);
   await expect(page.getByTestId("dps-split")).toContainText("Cat");
+  await expect(page.getByTestId("rotation-note")).toHaveCount(0);
+  await expect(page.getByTestId("strip-dps")).toHaveText(await page.getByTestId("dps-total").innerText());
   await expect.poll(() => new URL(page.url()).hash).toBe("#v2.hunter.60.0..CAMCAAA");
+  const withCat = Number(await total.textContent());
+  await page.getByTestId("pet-select").selectOption("0");
+  await expect(page.getByTestId("pet-damage")).toHaveCount(0);
+  await expect(page.getByTestId("rotation-note")).toContainText("Choose a pet");
+  await expect.poll(async () => Number(await total.textContent())).toBeLessThan(withCat);
+  await expect.poll(() => new URL(page.url()).hash).toBe("#v1.hunter.60.0");
+  // A link without a pet record keeps "None" (existing links decode unchanged).
+  await page.goto("about:blank");
+  await page.goto("./#v1.hunter.60.0");
+  await expect(page.getByTestId("pet-select")).toHaveValue("0");
+  await page.getByTestId("pet-select").selectOption({ label: "Cat (+10% damage)" });
+  await expect.poll(() => new URL(page.url()).hash).toBe("#v2.hunter.60.0..CAMCAAA");
+  await page.getByTestId("pet-scaling").uncheck();
+  await expect.poll(() => new URL(page.url()).hash).toBe("#v2.hunter.60.0..CAMCAAE");
   const url = page.url();
   await page.goto("about:blank");
   await page.goto(url);
   await expect(page.getByTestId("pet-select")).toHaveValue("2");
+  await expect(page.getByTestId("pet-scaling")).not.toBeChecked();
   await expect(page.getByTestId("pet-dps")).toBeVisible();
-  await page.getByTestId("pet-scaling").uncheck();
-  await expect.poll(() => new URL(page.url()).hash).toBe("#v2.hunter.60.0..CAMCAAE");
-  await page.getByTestId("pet-select").selectOption("0");
-  await page.getByTestId("pet-scaling").check();
-  await expect.poll(() => new URL(page.url()).hash).toBe("#v1.hunter.60.0");
   w.check();
 });
 
@@ -36,6 +46,9 @@ test("warlock: Demonic Sacrifice needs the talent and is cancelled by a summoned
   const w = watchErrors(page);
   await page.goto("./");
   await page.getByRole("button", { name: "Warlock", exact: true }).click();
+  await expect(page.getByTestId("pet-select")).toHaveValue("23"); // a new warlock starts with an Imp
+  await expect.poll(() => new URL(page.url()).hash).toBe("#v2.warlock.60.0..CAMXAAA");
+  await page.getByTestId("pet-select").selectOption("0");
   await expect(page.getByTestId("pet-sacrifice")).toBeDisabled();
   for (let i = 0; i < 5; i++) await node(page, "Demonic Embrace").click();
   for (let i = 0; i < 5; i++) await node(page, "Unholy Power").click();
diff --git a/src/data/types.ts b/src/data/types.ts
index 7de4c0e..a18f94c 100644
--- a/src/data/types.ts
+++ b/src/data/types.ts
@@ -458,6 +458,7 @@ export interface SpecRotation {
   autoShot: boolean; // hunter Auto Shot
   entries: RotationEntry[];
   notes: string[];
+  noPetNotes?: string[]; // Phase 7: shown only while no pet (and no Demonic Sacrifice) is chosen
 }
 export interface RotationsFile {
   _source: string;
diff --git a/src/engine/pets/types.ts b/src/engine/pets/types.ts
index 442df5a..3efb27f 100644
--- a/src/engine/pets/types.ts
+++ b/src/engine/pets/types.ts
@@ -1,4 +1,4 @@
-import type { PetInfo, PetOwnerConfig, Spell } from "@/data/types";
+import type { ClassToken, PetInfo, PetOwnerConfig, Spell } from "@/data/types";
 import type { AbilityEval, DamageContext, RotationEffect } from "@/engine/abilities";
 import type { RotationResult } from "@/engine/rotation";
 import type { CharacterStats, SourcedEffect, TargetView } from "@/engine/stats";
@@ -10,6 +10,15 @@ export interface PetChoice {
   scaling: boolean; // pets scale with the owner's stats (Q5)
 }
 export const NO_PET: PetChoice = { family: 0, sacrifice: 0, scaling: true };
+/**
+ * Phase 7 (owner decision): the pet a new build starts with when the class is picked in the UI (Cat 2, Imp 23,
+ * CreatureFamily ids). Links never use it: a link without a pet record (tag 8) is NO_PET, the URL default.
+ */
+export const DEFAULT_PET_FAMILY: Partial<Record<ClassToken, number>> = { hunter: 2, warlock: 23 };
+export const defaultPet = (token: ClassToken): PetChoice => ({
+  ...NO_PET,
+  family: DEFAULT_PET_FAMILY[token] ?? 0,
+});
 
 /** The active pet, as plain data (SimInput carries it to the worker). */
 export interface PetSetup {
diff --git a/src/state/character.ts b/src/state/character.ts
index 9d36eca..56a069d 100644
--- a/src/state/character.ts
+++ b/src/state/character.ts
@@ -1,7 +1,7 @@
 import { create } from "zustand";
 import { buffsFile, getClassInfo, loadWeapons, petsManual } from "@/data";
 import type { ClassToken, MagicSchool, PetFile, TargetPresetId, WeaponsFile } from "@/data/types";
-import { NO_PET, type PetChoice } from "@/engine/pets";
+import { NO_PET, defaultPet, type PetChoice } from "@/engine/pets";
 import { EMPTY_BONUS, ammoFor, weaponsForSlot, type BonusStats } from "@/engine/stats";
 import { BONUS_SCALE, type CharacterCode, type CustomTarget } from "./charCode";
 
@@ -68,6 +68,7 @@ export interface CharacterState {
   setPreset(name: "raidBuffs" | "raidDebuffs", on: boolean): void;
   setTarget(preset: TargetPresetId): void;
   setCustom(patch: Partial<CustomTarget>): void;
+  /** A class picked in the UI: keeps what fits, starts with the class's default pet (Phase 7). */
   fitToClass(token: ClassToken, level: number): Promise<boolean>; // false if something was dropped
   applyCode(code: CharacterCode, token: ClassToken, level: number): Promise<boolean>;
   toCode(token: ClassToken): CharacterCode;
@@ -190,7 +191,7 @@ export const useCharacter = create<CharacterState>()((set, get) => ({
     const file = await weaponsFor(get().weaponIds);
     const weaponIds = file ? sanitizeWeapons(get().weaponIds, file, token, level) : NO_WEAPON_IDS;
     const kept = JSON.stringify(weaponIds) === JSON.stringify(get().weaponIds);
-    set({ raceId, weaponIds, pet: NO_PET, ...(file ? { weapons: file } : {}) });
+    set({ raceId, weaponIds, pet: defaultPet(token), ...(file ? { weapons: file } : {}) });
     return kept;
   },
   async applyCode(code, token, level) {
diff --git a/src/state/derived.ts b/src/state/derived.ts
index c3d022e..9dc4041 100644
--- a/src/state/derived.ts
+++ b/src/state/derived.ts
@@ -46,6 +46,7 @@ export interface DamageView {
   pet: PetDamage | null; // Phase 6: the active pet vs the selected target
   totalDps: number; // owner + pet
   petNotes: string[]; // parts of the pet choice that do nothing (resolvePet)
+  notes: string[]; // Phase 7: rotation notes, plus noPetNotes while no pet or sacrifice is chosen
 }
 export type Derived =
   | {
@@ -213,6 +214,10 @@ export function derive(calc: CalcInput, ch: CharInput, custom: SpecRotation | nu
           pet: petResult,
           totalDps: result.rotation.dps + (petResult?.rotation.dps ?? 0),
           petNotes: pet?.notes ?? [],
+          notes: [
+            ...rotation.notes,
+            ...(ch.pet && (ch.pet.family !== 0 || ch.pet.sacrifice !== 0) ? [] : (rotation.noPetNotes ?? [])),
+          ],
         }
       : null;
   return {
diff --git a/src/state/pets.test.ts b/src/state/pets.test.ts
index a7715ea..0beb5ae 100644
--- a/src/state/pets.test.ts
+++ b/src/state/pets.test.ts
@@ -1,7 +1,7 @@
 // Phase 6 state: URL tag 8 (goldens from the independent Python encoder, plan section 8.4), store and derive.
 import { describe, expect, it } from "vitest";
 import { isClassToken } from "@/data";
-import { NO_PET } from "@/engine/pets";
+import { NO_PET, defaultPet } from "@/engine/pets";
 import { EMPTY_BONUS } from "@/engine/stats";
 import { spellFile } from "@/testkit/damage";
 import { petFile } from "@/testkit/pets";
@@ -11,6 +11,7 @@ import { decodeBuild, encodeBuild } from "./buildCode";
 import { DEFAULT_CUSTOM, NO_WEAPON_IDS, useCharacter } from "./character";
 import { DEFAULT_CHARACTER, decodeCharacterBytes, encodeCharacterBytes } from "./charCode";
 import { derive, simInputFor } from "./derived";
+import { specRotation } from "./rotation";
 
 const dec = (s: string) => decodeBuild(s, isClassToken);
 const build = (classToken: "hunter" | "warlock", character = DEFAULT_CHARACTER) => ({
@@ -94,3 +95,58 @@ describe("derive with a pet", () => {
     expect(input.prepare.petActive).toBe(true);
   });
 });
+
+describe("default pet (Phase 7 owner decision)", () => {
+  it("a class picked in the UI starts with a Cat / an Imp; links keep exactly what they encode", async () => {
+    expect(defaultPet("hunter")).toEqual({ family: 2, sacrifice: 0, scaling: true });
+    expect(defaultPet("warlock")).toEqual({ family: 23, sacrifice: 0, scaling: true });
+    expect(defaultPet("mage")).toEqual(NO_PET);
+    expect(petFile("hunter")!.pets.find((p) => p.id === 2)?.name).toBe("Cat");
+    expect(petFile("warlock")!.pets.find((p) => p.id === 23)?.name).toBe("Imp");
+    const st = useCharacter.getState();
+    await st.applyCode(DEFAULT_CHARACTER, "hunter", 60);
+    await useCharacter.getState().fitToClass("hunter", 60);
+    expect(useCharacter.getState().pet).toEqual(defaultPet("hunter"));
+    expect(encodeBuild(build("hunter", useCharacter.getState().toCode("hunter")))).toBe(
+      "#v2.hunter.60.0..CAMCAAA",
+    );
+    await useCharacter.getState().fitToClass("warlock", 60);
+    expect(encodeBuild(build("warlock", useCharacter.getState().toCode("warlock")))).toBe(
+      "#v2.warlock.60.0..CAMXAAA",
+    );
+    await useCharacter.getState().fitToClass("mage", 60);
+    expect(useCharacter.getState().pet).toEqual(NO_PET);
+    // A link without a pet record is "no pet", also for hunters and warlocks.
+    const r = dec("#v1.hunter.60.0");
+    expect(r.ok && r.build.character.pet).toBeUndefined();
+    expect(
+      useCharacter.getState().applyPet(r.ok ? r.build.character.pet : undefined, petFile("hunter")),
+    ).toBe(true);
+    expect(useCharacter.getState().pet).toEqual(NO_PET);
+  });
+  it("the 'Choose a pet' rotation note shows only while no pet or sacrifice is chosen", () => {
+    const ch = {
+      raceId: 3,
+      weaponIds: NO_WEAPON_IDS,
+      bonus: EMPTY_BONUS,
+      buffIds: [],
+      target: "boss" as const,
+      custom: DEFAULT_CUSTOM,
+      weapons: weaponsFile,
+    };
+    const notes = (token: "hunter" | "warlock", pet: typeof NO_PET) => {
+      const d = derive(
+        { tree: treeFor(token), ranks: {}, level: 60, spells: spellFile(token), pets: petFile(token) },
+        { ...ch, raceId: token === "hunter" ? 3 : 1, pet },
+        specRotation(token, token === "hunter" ? 0 : 1)!, // Beast Mastery / Demonology
+      );
+      if (!d.ok || !d.damage) throw new Error("not ok");
+      return d.damage.notes.join(" ");
+    };
+    expect(notes("hunter", NO_PET)).toContain("Choose a pet");
+    expect(notes("hunter", defaultPet("hunter"))).not.toContain("Choose a pet");
+    expect(notes("warlock", NO_PET)).toContain("Choose a demon");
+    expect(notes("warlock", defaultPet("warlock"))).not.toContain("Choose a demon");
+    expect(notes("warlock", { ...NO_PET, sacrifice: 23 })).not.toContain("Choose a demon");
+  });
+});
diff --git a/src/ui/results/DamagePanel.tsx b/src/ui/results/DamagePanel.tsx
index 88230f3..adc2ddd 100644
--- a/src/ui/results/DamagePanel.tsx
+++ b/src/ui/results/DamagePanel.tsx
@@ -148,7 +148,7 @@ export function DamagePanel() {
         <p className={styles.line}>Loading spells…</p>
       </section>
     );
-  const { rotation, result, pet, totalDps, petNotes } = d.damage;
+  const { rotation, result, pet, totalDps, petNotes, notes } = d.damage;
   const r = result.rotation;
   const perMinute = new Map(r.casts.map((c) => [c.key, c.perMinute]));
   const cards: AbilityResult[] = [
@@ -200,8 +200,8 @@ export function DamagePanel() {
           {n}
         </p>
       ))}
-      {rotation.notes.map((n) => (
-        <p key={n} className={styles.note}>
+      {notes.map((n) => (
+        <p key={n} className={styles.note} data-testid="rotation-note">
           {n}
         </p>
       ))}
diff --git a/src/ui/stats/StatStrip.tsx b/src/ui/stats/StatStrip.tsx
index 22f881a..45238b1 100644
--- a/src/ui/stats/StatStrip.tsx
+++ b/src/ui/stats/StatStrip.tsx
@@ -57,7 +57,7 @@ export function StatStrip() {
       { testId: "strip-dr", label: "Armor DR", stat: view.armorReduction, format: fmtPct },
     ];
   }
-  const dps = d.damage?.result.rotation.dps;
+  const dps = d.damage?.totalDps; // Phase 7: incl. the pet (hunters and warlocks now start with one)
   return (
     <div className={styles.strip} data-testid="stat-strip" aria-label="Key stats">
       {dps !== undefined && (
````

### 6.2 B: level selector (task T3)

Files: manual data (`base-stats.json` `level1`, `pets.json` `level1` + `_levels`, `buffs.json` `minLevel`/`itemId` + `_minLevel`), pipeline (`manual.py` `_check_min_level`, new `tests/test_phase7.py`), types, `src/engine/stats/{errors,levels}.ts` (new), `character.ts`, `assemble.ts`, `index.ts`, `src/engine/pets/{constants,stats}.ts` (`petBaseAt`), stores (`setLevel`, `fitToLevel`), UI (points bar select, Character/Target/Buffs/Stats panels, strip), tests `src/engine/stats/levels.test.ts`, `src/state/levels.test.ts`, `derived.test.ts` (level 61), `e2e/levels.spec.ts`.

````diff
diff --git a/data/manual/base-stats.json b/data/manual/base-stats.json
index ef9470a..62c8182 100644
--- a/data/manual/base-stats.json
+++ b/data/manual/base-stats.json
@@ -14,6 +14,20 @@
   "WARLOCK": {"str": 50, "agi": 55, "sta": 70, "int": 105, "spi": 110, "health": 1414, "mana": 1373, "baseMeleeCrit": 2, "baseSpellCrit": 1.7},
   "DRUID": {"str": 65, "agi": 55, "sta": 65, "int": 100, "spi": 110, "health": 1483, "mana": 1244, "baseMeleeCrit": 0.9, "baseSpellCrit": 1.85}
  },
+ "level1": {
+  "_source": "[VERIFY] Phase 7: Classic 1.12 level-1 base stats of a Human of each class (Human base 20/20/20/20/21 plus the Classic class modifiers; health and mana from vmangos player_classlevelstats level 1, recalled). Levels 2..59 are a linear interpolation between this table and 'classes' (level 60), rounded; race offsets and base crit do not change with level; agiPerMeleeCrit / intPerSpellCrit scale with the class's base Agility / Intellect at that level. Forever's client data has no player level-stat table (ExpectedStat.PlayerPrimaryStat is a retail item-budget curve: 20 at level 1, 3212 at 60). Confirm with naked character sheets at levels 10/30/50 (OPEN_QUESTIONS Q76).",
+  "classes": {
+   "WARRIOR": {"str": 23, "agi": 20, "sta": 22, "int": 20, "spi": 21, "health": 20, "mana": 0},
+   "PALADIN": {"str": 22, "agi": 20, "sta": 22, "int": 20, "spi": 22, "health": 28, "mana": 60},
+   "HUNTER": {"str": 20, "agi": 23, "sta": 21, "int": 20, "spi": 22, "health": 46, "mana": 65},
+   "ROGUE": {"str": 21, "agi": 23, "sta": 21, "int": 20, "spi": 21, "health": 45, "mana": 0},
+   "PRIEST": {"str": 20, "agi": 20, "sta": 20, "int": 22, "spi": 24, "health": 52, "mana": 73},
+   "SHAMAN": {"str": 21, "agi": 20, "sta": 21, "int": 21, "spi": 23, "health": 37, "mana": 55},
+   "MAGE": {"str": 20, "agi": 20, "sta": 20, "int": 23, "spi": 23, "health": 32, "mana": 100},
+   "WARLOCK": {"str": 20, "agi": 20, "sta": 21, "int": 22, "spi": 23, "health": 23, "mana": 90},
+   "DRUID": {"str": 21, "agi": 20, "sta": 20, "int": 22, "spi": 23, "health": 44, "mana": 60}
+  }
+ },
  "raceOffsets": {
   "HUMAN": {"str": 0, "agi": 0, "sta": 0, "int": 0, "spi": 0},
   "ORC": {"str": 3, "agi": -3, "sta": 2, "int": -3, "spi": 2},
diff --git a/data/manual/buffs.json b/data/manual/buffs.json
index 7efe271..7196a2e 100644
--- a/data/manual/buffs.json
+++ b/data/manual/buffs.json
@@ -1,19 +1,20 @@
 {
  "_source": "Forever build 1.60.1.70888 SpellEffect values (read 2026-11-12, Phase 3 plan); effect meaning of DUMMY auras from the spell tooltip. Every value [VERIFY] in game. 'classic' = Classic 1.12 value for comparison.",
  "_status": "[VERIFY]",
+ "_minLevel": "Phase 7: player level from which the buff's value applies (the modeled rank). Class buffs and debuffs: SpellLevels.BaseLevel of the spell (players of your level cast them; lower ranks are not modeled); talent auras: the level of the talent's tier (Leader of the Pack, Moonkin Aura: 40); consumables and weapon buffs: the item's ItemSparse.RequiredLevel (itemId; Elixir of Giants and Elixir of Greater Firepower are not in Forever's ItemSparse: Classic 1.12 values). Absent = 1. The pipeline checks minLevel against SpellLevels and ItemSparse (report.manualValidation).",
  "buffs": [
-  {"id": "battle_shout", "code": 1, "name": "Battle Shout", "category": "raid", "spellId": 25289, "effects": [{"key": "meleeAttackPower", "value": 139, "src": {"effectIndex": 0}}], "notes": "Rank 7. SpellEffect base 139, +0.6/level above spell level 60 (0 at 60). Improved Battle Shout not modeled.", "classic": "232 AP", "_status": "[VERIFY]"},
-  {"id": "blessing_of_might", "code": 2, "name": "Blessing of Might", "category": "raid", "spellId": 25291, "group": "blessing_might", "effects": [{"key": "meleeAttackPower", "value": 133, "src": {"effectIndex": 0}}], "notes": "Rank 7; Greater Blessing of Might rank 2 (25916) has the same value.", "classic": "185 AP", "_status": "[VERIFY]"},
-  {"id": "blessing_of_kings", "code": 3, "name": "Blessing of Kings", "category": "raid", "spellId": 20217, "effects": [{"key": "statPct", "stat": "all", "value": 10, "src": {"effectIndex": 0}}], "notes": "Greater Blessing of Kings (25898) has the same value.", "_status": "[VERIFY]"},
-  {"id": "mark_of_the_wild", "code": 4, "name": "Mark of the Wild", "category": "raid", "spellId": 9885, "effects": [{"key": "stat", "stat": "all", "value": 16, "src": {"effectIndex": 1}}], "notes": "Rank 7; Gift of the Wild (21850) has the same values. Armor +385 and resistances +27 are not DPS stats.", "classic": "12 all stats", "_status": "[VERIFY]"},
-  {"id": "arcane_intellect", "code": 5, "name": "Arcane Intellect", "category": "raid", "spellId": 10157, "effects": [{"key": "stat", "stat": "int", "value": 31, "src": {"effectIndex": 0}}], "notes": "Arcane Brilliance (23028) has the same value.", "_status": "[VERIFY]"},
-  {"id": "power_word_fortitude", "code": 6, "name": "Power Word: Fortitude", "category": "raid", "spellId": 10938, "effects": [{"key": "stat", "stat": "sta", "value": 70, "src": {"effectIndex": 0}}], "notes": "Rank 6; Prayer of Fortitude (21564) has the same value.", "classic": "54 Sta", "_status": "[VERIFY]"},
-  {"id": "divine_spirit", "code": 7, "name": "Divine Spirit", "category": "raid", "spellId": 27841, "effects": [{"key": "stat", "stat": "spi", "value": 40, "src": {"effectIndex": 0}}], "notes": "Prayer of Spirit (27681) has the same value.", "_status": "[VERIFY]"},
-  {"id": "leader_of_the_pack", "code": 8, "name": "Leader of the Pack", "category": "raid", "spellId": 24932, "effects": [{"key": "crit", "value": 3, "src": {"effectIndex": 0}}], "notes": "Aura 290 (all crit) in Forever data.", "classic": "3% melee/ranged crit", "_status": "[VERIFY]"},
-  {"id": "moonkin_aura", "code": 9, "name": "Moonkin Aura", "category": "raid", "spellId": 24907, "effects": [{"key": "crit", "value": 3, "src": {"effectIndex": 0}}], "notes": "Aura 290 (all crit) in Forever data.", "classic": "3% spell crit", "_status": "[VERIFY]"},
-  {"id": "trueshot_aura", "code": 10, "name": "Trueshot Aura", "category": "raid", "spellId": 20906, "effects": [{"key": "rangedAttackPower", "value": 100, "src": {"effectIndex": 0}}], "notes": "Rank 5 (talent 1299346 grants rank 1).", "_status": "[VERIFY]"},
-  {"id": "grace_of_air_totem", "code": 11, "name": "Grace of Air Totem", "category": "raid", "spellId": 25360, "spellName": "Grace of Air", "effects": [{"key": "stat", "stat": "agi", "value": 89, "src": {"effectIndex": 0}}], "notes": "Rank 3 aura spell (totem 25359).", "classic": "77 Agi", "_status": "[VERIFY]"},
-  {"id": "strength_of_earth_totem", "code": 12, "name": "Strength of Earth Totem", "category": "raid", "spellId": 25362, "spellName": "Strength of Earth", "effects": [{"key": "stat", "stat": "str", "value": 53, "src": {"effectIndex": 0}}], "notes": "Rank 5 aura spell (totem 25361).", "classic": "77 Str", "_status": "[VERIFY]"},
+  {"id": "battle_shout", "code": 1, "name": "Battle Shout", "category": "raid", "minLevel": 60, "spellId": 25289, "effects": [{"key": "meleeAttackPower", "value": 139, "src": {"effectIndex": 0}}], "notes": "Rank 7. SpellEffect base 139, +0.6/level above spell level 60 (0 at 60). Improved Battle Shout not modeled.", "classic": "232 AP", "_status": "[VERIFY]"},
+  {"id": "blessing_of_might", "code": 2, "name": "Blessing of Might", "category": "raid", "minLevel": 60, "spellId": 25291, "group": "blessing_might", "effects": [{"key": "meleeAttackPower", "value": 133, "src": {"effectIndex": 0}}], "notes": "Rank 7; Greater Blessing of Might rank 2 (25916) has the same value.", "classic": "185 AP", "_status": "[VERIFY]"},
+  {"id": "blessing_of_kings", "code": 3, "name": "Blessing of Kings", "category": "raid", "minLevel": 20, "spellId": 20217, "effects": [{"key": "statPct", "stat": "all", "value": 10, "src": {"effectIndex": 0}}], "notes": "Greater Blessing of Kings (25898) has the same value.", "_status": "[VERIFY]"},
+  {"id": "mark_of_the_wild", "code": 4, "name": "Mark of the Wild", "category": "raid", "minLevel": 60, "spellId": 9885, "effects": [{"key": "stat", "stat": "all", "value": 16, "src": {"effectIndex": 1}}], "notes": "Rank 7; Gift of the Wild (21850) has the same values. Armor +385 and resistances +27 are not DPS stats.", "classic": "12 all stats", "_status": "[VERIFY]"},
+  {"id": "arcane_intellect", "code": 5, "name": "Arcane Intellect", "category": "raid", "minLevel": 56, "spellId": 10157, "effects": [{"key": "stat", "stat": "int", "value": 31, "src": {"effectIndex": 0}}], "notes": "Arcane Brilliance (23028) has the same value.", "_status": "[VERIFY]"},
+  {"id": "power_word_fortitude", "code": 6, "name": "Power Word: Fortitude", "category": "raid", "minLevel": 60, "spellId": 10938, "effects": [{"key": "stat", "stat": "sta", "value": 70, "src": {"effectIndex": 0}}], "notes": "Rank 6; Prayer of Fortitude (21564) has the same value.", "classic": "54 Sta", "_status": "[VERIFY]"},
+  {"id": "divine_spirit", "code": 7, "name": "Divine Spirit", "category": "raid", "minLevel": 60, "spellId": 27841, "effects": [{"key": "stat", "stat": "spi", "value": 40, "src": {"effectIndex": 0}}], "notes": "Prayer of Spirit (27681) has the same value.", "_status": "[VERIFY]"},
+  {"id": "leader_of_the_pack", "code": 8, "name": "Leader of the Pack", "category": "raid", "minLevel": 40, "spellId": 24932, "effects": [{"key": "crit", "value": 3, "src": {"effectIndex": 0}}], "notes": "Aura 290 (all crit) in Forever data.", "classic": "3% melee/ranged crit", "_status": "[VERIFY]"},
+  {"id": "moonkin_aura", "code": 9, "name": "Moonkin Aura", "category": "raid", "minLevel": 40, "spellId": 24907, "effects": [{"key": "crit", "value": 3, "src": {"effectIndex": 0}}], "notes": "Aura 290 (all crit) in Forever data.", "classic": "3% spell crit", "_status": "[VERIFY]"},
+  {"id": "trueshot_aura", "code": 10, "name": "Trueshot Aura", "category": "raid", "minLevel": 60, "spellId": 20906, "effects": [{"key": "rangedAttackPower", "value": 100, "src": {"effectIndex": 0}}], "notes": "Rank 5 (talent 1299346 grants rank 1).", "_status": "[VERIFY]"},
+  {"id": "grace_of_air_totem", "code": 11, "name": "Grace of Air Totem", "category": "raid", "minLevel": 60, "spellId": 25360, "spellName": "Grace of Air", "effects": [{"key": "stat", "stat": "agi", "value": 89, "src": {"effectIndex": 0}}], "notes": "Rank 3 aura spell (totem 25359).", "classic": "77 Agi", "_status": "[VERIFY]"},
+  {"id": "strength_of_earth_totem", "code": 12, "name": "Strength of Earth Totem", "category": "raid", "minLevel": 60, "spellId": 25362, "spellName": "Strength of Earth", "effects": [{"key": "stat", "stat": "str", "value": 53, "src": {"effectIndex": 0}}], "notes": "Rank 5 aura spell (totem 25361).", "classic": "77 Str", "_status": "[VERIFY]"},
   {"id": "rallying_cry", "code": 20, "name": "Rallying Cry of the Dragonslayer", "category": "world", "spellId": 22888, "effects": [{"key": "crit", "value": 10, "src": {"effectIndex": 0}}, {"key": "meleeAttackPower", "value": 140, "src": {"effectIndex": 1}}, {"key": "rangedAttackPower", "value": 140, "src": {"effectIndex": 2}}, {"key": "spellPower", "value": 80, "src": {"effectIndex": 3}}], "notes": "Dummy auras (server-scripted); meaning from the tooltip: $s1% crit of spells and attacks, $s2 Attack Power, $s4 spell damage. Forever: 'No effect while in a raid instance' (aura description).", "classic": "5% melee/ranged crit, 10% spell crit, 140 AP", "_status": "[VERIFY]"},
   {"id": "songflower", "code": 21, "name": "Songflower Serenade", "category": "world", "spellId": 15366, "effects": [{"key": "crit", "value": 5, "src": {"effectIndex": 0}}, {"key": "stat", "stat": "all", "value": 15, "src": {"effectIndex": 1}}], "notes": "Dummy auras; tooltip: $s1% melee/ranged/spell crit, $s2 all attributes. Forever: 'No effect while in a raid instance' (aura description).", "_status": "[VERIFY]"},
   {"id": "spirit_of_zandalar", "code": 22, "name": "Spirit of Zandalar", "category": "world", "spellId": 24425, "effects": [{"key": "statPct", "stat": "all", "value": 15, "src": {"effectIndex": 2}}], "notes": "Forever: 'No effect while in a raid instance' (aura description).", "_status": "[VERIFY]"},
@@ -21,27 +22,27 @@
   {"id": "fengus_ferocity", "code": 24, "name": "Fengus' Ferocity", "category": "world", "spellId": 22817, "effects": [{"key": "meleeAttackPower", "value": 200, "src": {"effectIndex": 0}}, {"key": "rangedAttackPower", "value": 200, "src": {"effectIndex": 1}}, {"key": "spellPower", "value": 230, "src": {"effectIndex": 2}}], "notes": "Dummy auras; tooltip: $s1 Attack Power, $s3 spell damage. Forever: 'No effect while in a raid instance' (aura description).", "classic": "200 AP only", "_status": "[VERIFY]"},
   {"id": "moldars_moxie", "code": 25, "name": "Mol'dar's Moxie", "category": "world", "spellId": 22818, "effects": [{"key": "statPct", "stat": "sta", "value": 15, "src": {"effectIndex": 0}}], "notes": "Forever: 'No effect while in a raid instance' (aura description).", "_status": "[VERIFY]"},
   {"id": "slipkiks_savvy", "code": 26, "name": "Slip'kik's Savvy", "category": "world", "spellId": 22820, "effects": [{"key": "crit", "value": 3, "src": {"effectIndex": 0}}], "notes": "Tooltip: crit with all spells and attacks. Forever: 'No effect while in a raid instance' (aura description).", "classic": "3% spell crit", "_status": "[VERIFY]"},
-  {"id": "elixir_of_the_mongoose", "code": 30, "name": "Elixir of the Mongoose", "category": "consumable", "spellId": 17538, "group": "elixir_agility", "effects": [{"key": "stat", "stat": "agi", "value": 25, "src": {"effectIndex": 0}}, {"key": "crit", "value": 2, "src": {"effectIndex": 1}}], "classic": "2% melee/ranged crit", "_status": "[VERIFY]"},
-  {"id": "elixir_of_greater_agility", "code": 31, "name": "Elixir of Greater Agility", "category": "consumable", "spellId": 11334, "spellName": "Greater Agility", "group": "elixir_agility", "effects": [{"key": "stat", "stat": "agi", "value": 25, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
-  {"id": "elixir_of_giants", "code": 32, "name": "Elixir of Giants", "category": "consumable", "spellId": 11405, "spellName": "Greater Strength", "group": "elixir_strength", "effects": [{"key": "stat", "stat": "str", "value": 25, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
+  {"id": "elixir_of_the_mongoose", "code": 30, "name": "Elixir of the Mongoose", "category": "consumable", "minLevel": 46, "itemId": 13452, "spellId": 17538, "group": "elixir_agility", "effects": [{"key": "stat", "stat": "agi", "value": 25, "src": {"effectIndex": 0}}, {"key": "crit", "value": 2, "src": {"effectIndex": 1}}], "classic": "2% melee/ranged crit", "_status": "[VERIFY]"},
+  {"id": "elixir_of_greater_agility", "code": 31, "name": "Elixir of Greater Agility", "category": "consumable", "minLevel": 38, "itemId": 9187, "spellId": 11334, "spellName": "Greater Agility", "group": "elixir_agility", "effects": [{"key": "stat", "stat": "agi", "value": 25, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
+  {"id": "elixir_of_giants", "code": 32, "name": "Elixir of Giants", "category": "consumable", "minLevel": 38, "spellId": 11405, "spellName": "Greater Strength", "group": "elixir_strength", "effects": [{"key": "stat", "stat": "str", "value": 25, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
   {"id": "juju_power", "code": 33, "name": "Juju Power", "category": "consumable", "spellId": 16323, "group": "elixir_strength", "effects": [{"key": "stat", "stat": "str", "value": 30, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
   {"id": "juju_might", "code": 34, "name": "Juju Might", "category": "consumable", "spellId": 16329, "group": "elixir_ap", "effects": [{"key": "meleeAttackPower", "value": 40, "src": {"effectIndex": 0}}, {"key": "rangedAttackPower", "value": 40, "src": {"effectIndex": 1}}], "_status": "[VERIFY]"},
-  {"id": "winterfall_firewater", "code": 35, "name": "Winterfall Firewater", "category": "consumable", "spellId": 17038, "group": "elixir_ap", "effects": [{"key": "meleeAttackPower", "value": 35, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
-  {"id": "flask_of_supreme_power", "code": 36, "name": "Flask of Supreme Power", "category": "consumable", "spellId": 17628, "spellName": "Supreme Power", "group": "flask", "effects": [{"key": "spellPower", "value": 150, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
-  {"id": "flask_of_the_titans", "code": 37, "name": "Flask of the Titans", "category": "consumable", "spellId": 17626, "group": "flask", "effects": [{"key": "health", "value": 1200, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
-  {"id": "greater_arcane_elixir", "code": 38, "name": "Greater Arcane Elixir", "category": "consumable", "spellId": 17539, "effects": [{"key": "spellPower", "value": 35, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
-  {"id": "elixir_of_shadow_power", "code": 39, "name": "Elixir of Shadow Power", "category": "consumable", "spellId": 11474, "spellName": "Shadow Power", "effects": [{"key": "spellPower", "schools": ["shadow"], "value": 40, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
-  {"id": "elixir_of_greater_firepower", "code": 40, "name": "Elixir of Greater Firepower", "category": "consumable", "spellId": 26276, "spellName": "Greater Firepower", "effects": [{"key": "spellPower", "schools": ["fire"], "value": 40, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
-  {"id": "grilled_squid", "code": 41, "name": "Grilled Squid", "category": "consumable", "spellId": 18192, "spellName": "Increased Agility", "group": "food", "effects": [{"key": "stat", "stat": "agi", "value": 10, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
-  {"id": "smoked_desert_dumplings", "code": 42, "name": "Smoked Desert Dumplings", "category": "consumable", "spellId": 24799, "spellName": "Well Fed", "group": "food", "effects": [{"key": "stat", "stat": "str", "value": 20, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
-  {"id": "brilliant_wizard_oil", "code": 50, "name": "Brilliant Wizard Oil", "category": "weapon", "spellId": 25113, "spellName": "Increase Spell Dam 36 and 1% Crit", "group": "mainHandEnchant", "effects": [{"key": "spellPower", "value": 36, "src": {"effectIndex": 0}}, {"key": "spellCrit", "value": 1, "src": {"effectIndex": 2}}], "notes": "Enchant 2628 -> spell 25113.", "_status": "[VERIFY]"},
-  {"id": "elemental_sharpening_stone", "code": 51, "name": "Elemental Sharpening Stone", "category": "weapon", "spellId": 22755, "spellName": "Critical Weapon +2", "group": "mainHandEnchant", "effects": [{"key": "weaponCrit", "slots": ["mainHand"], "value": 2, "src": {"effectIndex": 0}}], "notes": "Enchant 2506 -> spell 22755 (aura 52, melee weapons). Applied to the main hand.", "_status": "[VERIFY]"},
-  {"id": "dense_sharpening_stone", "code": 52, "name": "Dense Sharpening Stone", "category": "weapon", "spellId": null, "group": "mainHandEnchant", "effects": [{"key": "weaponDamage", "slots": ["mainHand"], "value": 8}], "notes": "Enchant 1643 'Sharpened +8' (SpellItemEnchantment EffectPointsMin 8; no aura spell). Applied to the main hand.", "_status": "[VERIFY]"},
-  {"id": "sunder_armor", "code": 60, "name": "Sunder Armor (5)", "category": "debuff", "spellId": 11597, "spellName": "Sunder Armor", "group": "armor_major", "effects": [{"key": "targetArmor", "value": -2250, "src": {"effectIndex": 0, "mult": 5}}], "notes": "Rank 5, 450 per stack x 5 stacks. Sunder and Expose Armor do not stack.", "_status": "[VERIFY]"},
-  {"id": "expose_armor", "code": 61, "name": "Expose Armor (5 cp)", "category": "debuff", "spellId": 11198, "spellName": "Expose Armor", "group": "armor_major", "effects": [{"key": "targetArmor", "value": -2250, "src": {"effectIndex": 0, "field": "perResource", "mult": 5}}], "notes": "Rank 5: EffectPointsPerResource -450 per combo point x 5. Improved Expose Armor not modeled.", "classic": "1700 armor", "_status": "[VERIFY]"},
-  {"id": "faerie_fire", "code": 62, "name": "Faerie Fire", "category": "debuff", "spellId": 9907, "effects": [{"key": "targetArmor", "value": -505, "src": {"effectIndex": 0}}], "notes": "Rank 4; Faerie Fire (Feral) not checked.", "_status": "[VERIFY]"},
-  {"id": "curse_of_recklessness", "code": 63, "name": "Curse of Recklessness", "category": "debuff", "spellId": 11717, "effects": [{"key": "targetArmor", "value": -505, "src": {"effectIndex": 1}}], "notes": "Rank 4 (ability chain).", "classic": "640 armor", "_status": "[VERIFY]"},
-  {"id": "curse_of_the_elements", "code": 64, "name": "Curse of the Elements", "category": "debuff", "spellId": 1311680, "effects": [{"key": "targetResist", "schools": ["holy", "fire", "nature", "frost", "shadow", "arcane"], "value": -75, "src": {"effectIndex": 0}}, {"key": "targetDamageTakenPct", "schools": ["holy", "fire", "nature", "frost", "shadow", "arcane"], "value": 10, "src": {"effectIndex": 1}}], "notes": "Rank 4 (Forever spell). All magic schools (misc 126).", "classic": "fire and frost only", "_status": "[VERIFY]"}
+  {"id": "winterfall_firewater", "code": 35, "name": "Winterfall Firewater", "category": "consumable", "minLevel": 45, "itemId": 12820, "spellId": 17038, "group": "elixir_ap", "effects": [{"key": "meleeAttackPower", "value": 35, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
+  {"id": "flask_of_supreme_power", "code": 36, "name": "Flask of Supreme Power", "category": "consumable", "minLevel": 50, "itemId": 13512, "spellId": 17628, "spellName": "Supreme Power", "group": "flask", "effects": [{"key": "spellPower", "value": 150, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
+  {"id": "flask_of_the_titans", "code": 37, "name": "Flask of the Titans", "category": "consumable", "minLevel": 50, "itemId": 13510, "spellId": 17626, "group": "flask", "effects": [{"key": "health", "value": 1200, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
+  {"id": "greater_arcane_elixir", "code": 38, "name": "Greater Arcane Elixir", "category": "consumable", "minLevel": 47, "itemId": 13454, "spellId": 17539, "effects": [{"key": "spellPower", "value": 35, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
+  {"id": "elixir_of_shadow_power", "code": 39, "name": "Elixir of Shadow Power", "category": "consumable", "minLevel": 40, "itemId": 9264, "spellId": 11474, "spellName": "Shadow Power", "effects": [{"key": "spellPower", "schools": ["shadow"], "value": 40, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
+  {"id": "elixir_of_greater_firepower", "code": 40, "name": "Elixir of Greater Firepower", "category": "consumable", "minLevel": 40, "spellId": 26276, "spellName": "Greater Firepower", "effects": [{"key": "spellPower", "schools": ["fire"], "value": 40, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
+  {"id": "grilled_squid", "code": 41, "name": "Grilled Squid", "category": "consumable", "minLevel": 35, "itemId": 13928, "spellId": 18192, "spellName": "Increased Agility", "group": "food", "effects": [{"key": "stat", "stat": "agi", "value": 10, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
+  {"id": "smoked_desert_dumplings", "code": 42, "name": "Smoked Desert Dumplings", "category": "consumable", "minLevel": 45, "itemId": 20452, "spellId": 24799, "spellName": "Well Fed", "group": "food", "effects": [{"key": "stat", "stat": "str", "value": 20, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
+  {"id": "brilliant_wizard_oil", "code": 50, "name": "Brilliant Wizard Oil", "category": "weapon", "minLevel": 45, "itemId": 20749, "spellId": 25113, "spellName": "Increase Spell Dam 36 and 1% Crit", "group": "mainHandEnchant", "effects": [{"key": "spellPower", "value": 36, "src": {"effectIndex": 0}}, {"key": "spellCrit", "value": 1, "src": {"effectIndex": 2}}], "notes": "Enchant 2628 -> spell 25113.", "_status": "[VERIFY]"},
+  {"id": "elemental_sharpening_stone", "code": 51, "name": "Elemental Sharpening Stone", "category": "weapon", "minLevel": 50, "itemId": 18262, "spellId": 22755, "spellName": "Critical Weapon +2", "group": "mainHandEnchant", "effects": [{"key": "weaponCrit", "slots": ["mainHand"], "value": 2, "src": {"effectIndex": 0}}], "notes": "Enchant 2506 -> spell 22755 (aura 52, melee weapons). Applied to the main hand.", "_status": "[VERIFY]"},
+  {"id": "dense_sharpening_stone", "code": 52, "name": "Dense Sharpening Stone", "category": "weapon", "minLevel": 35, "itemId": 12404, "spellId": null, "group": "mainHandEnchant", "effects": [{"key": "weaponDamage", "slots": ["mainHand"], "value": 8}], "notes": "Enchant 1643 'Sharpened +8' (SpellItemEnchantment EffectPointsMin 8; no aura spell). Applied to the main hand.", "_status": "[VERIFY]"},
+  {"id": "sunder_armor", "code": 60, "name": "Sunder Armor (5)", "category": "debuff", "minLevel": 58, "spellId": 11597, "spellName": "Sunder Armor", "group": "armor_major", "effects": [{"key": "targetArmor", "value": -2250, "src": {"effectIndex": 0, "mult": 5}}], "notes": "Rank 5, 450 per stack x 5 stacks. Sunder and Expose Armor do not stack.", "_status": "[VERIFY]"},
+  {"id": "expose_armor", "code": 61, "name": "Expose Armor (5 cp)", "category": "debuff", "minLevel": 56, "spellId": 11198, "spellName": "Expose Armor", "group": "armor_major", "effects": [{"key": "targetArmor", "value": -2250, "src": {"effectIndex": 0, "field": "perResource", "mult": 5}}], "notes": "Rank 5: EffectPointsPerResource -450 per combo point x 5. Improved Expose Armor not modeled.", "classic": "1700 armor", "_status": "[VERIFY]"},
+  {"id": "faerie_fire", "code": 62, "name": "Faerie Fire", "category": "debuff", "minLevel": 54, "spellId": 9907, "effects": [{"key": "targetArmor", "value": -505, "src": {"effectIndex": 0}}], "notes": "Rank 4; Faerie Fire (Feral) not checked.", "_status": "[VERIFY]"},
+  {"id": "curse_of_recklessness", "code": 63, "name": "Curse of Recklessness", "category": "debuff", "minLevel": 56, "spellId": 11717, "effects": [{"key": "targetArmor", "value": -505, "src": {"effectIndex": 1}}], "notes": "Rank 4 (ability chain).", "classic": "640 armor", "_status": "[VERIFY]"},
+  {"id": "curse_of_the_elements", "code": 64, "name": "Curse of the Elements", "category": "debuff", "minLevel": 50, "spellId": 1311680, "effects": [{"key": "targetResist", "schools": ["holy", "fire", "nature", "frost", "shadow", "arcane"], "value": -75, "src": {"effectIndex": 0}}, {"key": "targetDamageTakenPct", "schools": ["holy", "fire", "nature", "frost", "shadow", "arcane"], "value": 10, "src": {"effectIndex": 1}}], "notes": "Rank 4 (Forever spell). All magic schools (misc 126).", "classic": "fire and frost only", "_status": "[VERIFY]"}
  ],
  "presets": {
   "raidBuffs": ["battle_shout", "blessing_of_might", "blessing_of_kings", "mark_of_the_wild", "arcane_intellect", "power_word_fortitude", "divine_spirit", "leader_of_the_pack", "moonkin_aura", "trueshot_aura", "grace_of_air_totem", "strength_of_earth_totem"],
diff --git a/data/manual/pets.json b/data/manual/pets.json
index 22d5ede..26ada58 100644
--- a/data/manual/pets.json
+++ b/data/manual/pets.json
@@ -2,15 +2,18 @@
  "_source": "Phase 6 (docs/phase6-implementation-plan.md section 3). Pet base stats, focus and owner scaling are server-side (not in client data): Classic 1.12 / TBC 2.4 values recalled from CMaNGOS / vmangos Pet::InitStatsForLevel and pet_levelstats. Family damage modifiers, pet abilities, the talent effects on pets and the sacrifice / Master Demonologist / Soul Link auras come from the client data (data/generated/<build>/pets/<owner>.json).",
  "_status": "[VERIFY] base, scaling and focus numbers (Q5, Q69-Q73)",
  "level": 60,
+ "_levels": "[VERIFY Q77] Phase 7: below level 60 the pet's primary stats are interpolated linearly between owners.*.level1 and owners.*.base (pet level = player level); melee damage is level -/+ floor(level / 4) per swing (CMaNGOS Pet::InitStatsForLevel), scaled so level 60 gives base.minDamage/maxDamage.",
  "owners": {
   "hunter": {
    "base": { "str": 136, "agi": 102, "sta": 154, "int": 66, "spi": 101, "apPerStr": 2, "apFlat": -20, "minDamage": 45, "maxDamage": 75, "speedMs": 2000, "meleeCrit": 5, "spellCrit": 5 },
+   "level1": { "str": 22, "agi": 20, "sta": 22, "int": 20, "spi": 20 },
    "scaling": { "from": "rangedAttackPower", "attackPowerPct": 22, "spellPowerPct": 12.8, "inheritHit": true },
    "focus": { "max": 100, "perSecond": 6 },
    "noMelee": []
   },
   "warlock": {
    "base": { "str": 136, "agi": 102, "sta": 154, "int": 66, "spi": 101, "apPerStr": 2, "apFlat": -20, "minDamage": 45, "maxDamage": 75, "speedMs": 2000, "meleeCrit": 5, "spellCrit": 5 },
+   "level1": { "str": 22, "agi": 20, "sta": 22, "int": 20, "spi": 20 },
    "scaling": { "from": "spellPower", "attackPowerPct": 57, "spellPowerPct": 15, "inheritHit": true },
    "focus": null,
    "noMelee": [23]
diff --git a/e2e/levels.spec.ts b/e2e/levels.spec.ts
new file mode 100644
index 0000000..bf43483
--- /dev/null
+++ b/e2e/levels.spec.ts
@@ -0,0 +1,29 @@
+import { expect, test } from "@playwright/test";
+import { GOLDEN, blockRemoteImages, watchErrors } from "./helpers";
+
+test.beforeEach(async ({ page }) => {
+  await blockRemoteImages(page);
+});
+
+test("level selector: fewer points, level-based targets and buffs, level in the link", async ({ page }) => {
+  const w = watchErrors(page);
+  await page.goto(`./${GOLDEN}`);
+  await expect(page.getByTestId("points-by-spec")).toHaveText("0/33/18");
+  await page.getByTestId("level-select").selectOption("30");
+  await expect(page.getByTestId("notice")).toContainText("Talent points above level 30 were removed.");
+  await expect(page.getByTestId("points-left")).toHaveText("Points left: 0");
+  await expect(page.getByTestId("points-by-spec")).toHaveText("0/21/0");
+  await expect(page.getByTestId("character-level")).toHaveText("Level 30");
+  await expect(page.getByTestId("target-panel")).toContainText("Boss (33, 1317 armor)");
+  await expect(page.locator("label", { has: page.getByTestId("buff-arcane_intellect") })).toContainText(
+    "(level 56)",
+  );
+  await expect(page.getByTestId("dps-total")).not.toHaveText("");
+  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#v1\.mage\.30\.0\./);
+  const url = page.url();
+  await page.goto("about:blank");
+  await page.goto(url);
+  await expect(page.getByTestId("level-select")).toHaveValue("30");
+  await expect(page.getByTestId("points-by-spec")).toHaveText("0/21/0");
+  w.check();
+});
diff --git a/src/data/types.ts b/src/data/types.ts
index a18f94c..d17f3b7 100644
--- a/src/data/types.ts
+++ b/src/data/types.ts
@@ -253,6 +253,8 @@ export interface BuffDef {
   spellId: number | null;
   spellName?: string;
   group?: string; // at most one buff per group
+  minLevel?: number; // Phase 7: lowest player level the buff applies at (absent = 1); checked by the pipeline
+  itemId?: number; // Phase 7: consumable item whose RequiredLevel is minLevel
   effects: ManualEffect[];
   notes?: string;
   classic?: string;
@@ -297,12 +299,15 @@ export interface ApFormula {
   perAgi: number;
   flat: number;
 }
+/** Phase 7: level-1 values of a class (Human); levels 2..59 are interpolated (src/engine/stats/levels.ts). */
+export type LevelOneStats = Omit<ClassBaseStats, "baseMeleeCrit" | "baseSpellCrit">;
 export interface BaseStatsFile {
   _source: string;
   _status: string;
   level: number;
   baseCritUnit: "percent";
   classes: Record<ManualClassToken, ClassBaseStats>;
+  level1?: { _source: string; classes: Record<ManualClassToken, LevelOneStats> }; // Phase 7 [VERIFY Q76]
   raceOffsets: Record<string, Record<PrimaryStat, number>>;
   conversions: {
     meleeAttackPower: Record<ManualClassToken, ApFormula>;
@@ -509,6 +514,7 @@ export interface PetBaseStats {
 }
 export interface PetOwnerConfig {
   base: PetBaseStats;
+  level1?: Pick<PetBaseStats, "str" | "agi" | "sta" | "int" | "spi">; // Phase 7: level-1 values [VERIFY Q77]
   /** Owner scaling (Q5): % of the owner's ranged attack power (hunter) or spell power (warlock, max of fire/shadow). */
   scaling: {
     from: "rangedAttackPower" | "spellPower";
diff --git a/src/engine/pets/constants.ts b/src/engine/pets/constants.ts
index ad3e25e..142f6d7 100644
--- a/src/engine/pets/constants.ts
+++ b/src/engine/pets/constants.ts
@@ -22,6 +22,8 @@ export const PET_TALENT_IDS: ReadonlySet<number> = new Set(Object.values(PET_TAL
 
 /** Race key of the pet's own base-stat table (computeCharacter input; the class key is the owner's). */
 export const PET_RACE = "PET";
+/** Level of data/manual/pets.json owners.*.base (the file's `level`); below it petBaseAt interpolates (Phase 7). */
+export const PET_BASE_LEVEL = 60;
 /** Item subclass of the pet's synthetic weapon (13 fist weapon: no normalized-speed rule applies). */
 export const PET_WEAPON_SUBCLASS = 13;
 /** Effects that apply an aura to the pet: 6 apply aura, 35 party aura, 65 raid aura, 119 pet area aura, 143 owner area aura. */
diff --git a/src/engine/pets/stats.ts b/src/engine/pets/stats.ts
index 82d541e..8e452a2 100644
--- a/src/engine/pets/stats.ts
+++ b/src/engine/pets/stats.ts
@@ -1,4 +1,11 @@
-import type { BaseStatsFile, ManualClassToken, Spell, Weapon } from "@/data/types";
+import type {
+  BaseStatsFile,
+  ManualClassToken,
+  PetBaseStats,
+  PetOwnerConfig,
+  Spell,
+  Weapon,
+} from "@/data/types";
 import { collectMods, effectValue, familyMatches, type ModSource } from "@/engine/abilities";
 import {
   EMPTY_BONUS,
@@ -13,6 +20,7 @@ import {
   AURA_PROC_TRIGGER,
   OP_PROC_CHANCE,
   PET_AURA_EFFECTS,
+  PET_BASE_LEVEL,
   PET_RACE,
   PET_WEAPON_SUBCLASS,
   POWER_FOCUS,
@@ -111,6 +119,31 @@ function ownerScaling(setup: PetSetup, owner: CharacterStats): SourcedEffect[] {
   return out.filter((e) => e.value !== 0);
 }
 
+/**
+ * Phase 7: the pet's base stats at `level` (pet level = player level). Primary stats are interpolated linearly between
+ * `level1` and `base` (level 60); melee damage per swing is level -/+ floor(level / 4) (CMaNGOS Pet::InitStatsForLevel),
+ * scaled so that level 60 gives base.minDamage / maxDamage. Crit, attack speed and the AP formula do not change. [VERIFY Q77]
+ */
+export function petBaseAt(config: PetOwnerConfig, level: number): PetBaseStats {
+  const b = config.base;
+  if (level >= PET_BASE_LEVEL || !config.level1) return b;
+  const one = config.level1;
+  const t = (Math.max(1, level) - 1) / (PET_BASE_LEVEL - 1);
+  const lerp = (k: keyof typeof one) => Math.round(one[k] + (b[k] - one[k]) * t);
+  const q = Math.floor(level / 4);
+  const top = Math.floor(PET_BASE_LEVEL / 4);
+  return {
+    ...b,
+    str: lerp("str"),
+    agi: lerp("agi"),
+    sta: lerp("sta"),
+    int: lerp("int"),
+    spi: lerp("spi"),
+    minDamage: (b.minDamage * (level - q)) / (PET_BASE_LEVEL - top),
+    maxDamage: (b.maxDamage * (level + q)) / (PET_BASE_LEVEL + top),
+  };
+}
+
 /**
  * The pet's character sheet (section 4.3): the Phase 3 stat engine (computeCharacter) with the pet's own base-stat
  * table (class key = the owner, race PET), a synthetic weapon for its melee attack, owner scaling, the shared owner
@@ -120,7 +153,7 @@ export function computePetStats(
   setup: PetSetup,
   a: { level: number; owner: CharacterStats; auras: PetAuras },
 ): { stats: CharacterStats; weapons: EquippedWeapons } {
-  const b = setup.config.base;
+  const b = petBaseAt(setup.config, a.level);
   const cls = setup.info.owner.toUpperCase() as ManualClassToken;
   const baseStats = {
     _source: "data/manual/pets.json",
diff --git a/src/engine/stats/assemble.ts b/src/engine/stats/assemble.ts
index d35d4d2..1e4745d 100644
--- a/src/engine/stats/assemble.ts
+++ b/src/engine/stats/assemble.ts
@@ -45,7 +45,7 @@ export function assemble(a: AssembleArgs): Assembled {
   const debuffs: SourcedEffect[] = [];
   const selected = new Set(a.buffIds);
   for (const b of a.buffs.buffs) {
-    if (!selected.has(b.id)) continue;
+    if (!selected.has(b.id) || (b.minLevel ?? 1) > a.level) continue; // Phase 7: buffs above the level do nothing
     for (const e of b.effects) {
       if (b.category === "debuff") debuffs.push(strip(e, b.name, "debuff"));
       else effects.push(strip(e, b.name, "buff"));
diff --git a/src/engine/stats/character.ts b/src/engine/stats/character.ts
index b002809..60ae9f7 100644
--- a/src/engine/stats/character.ts
+++ b/src/engine/stats/character.ts
@@ -8,6 +8,8 @@ import {
   OFFHAND_DAMAGE_MULT,
   SKILL_PER_LEVEL,
 } from "./constants";
+import { UnsupportedLevelError } from "./errors";
+import { baseStatsAt } from "./levels";
 import { applyPct, makeStat, type Part, type SourceKind, type Stat } from "./stat";
 import {
   ATTACK_SLOTS,
@@ -21,7 +23,7 @@ import {
 
 const WAND_SUBCLASS = 19;
 
-export class UnsupportedLevelError extends Error {}
+export { UnsupportedLevelError };
 
 const STAT_LABEL: Record<PrimaryStat, string> = {
   str: "Strength",
@@ -94,11 +96,10 @@ function effectParts(
 export function computeCharacter(input: CharacterInput): CharacterStats {
   const { baseStats: bs, bonus, effects, level } = input;
   const cls = input.classToken.toUpperCase() as Uppercase<typeof input.classToken>;
-  if (bs.level !== level)
-    throw new UnsupportedLevelError(`base stats exist for level ${bs.level} only (Q14)`);
-  const base = bs.classes[cls];
   const race = bs.raceOffsets[input.race];
-  if (!base || !race) throw new Error(`no base stats for ${input.race} ${cls}`);
+  if (!bs.classes[cls] || !race) throw new Error(`no base stats for ${input.race} ${cls}`);
+  const lv = baseStatsAt(bs, cls, level); // Phase 7: interpolated below level 60 [VERIFY Q76]
+  const base = lv.base;
   const conv = bs.conversions;
 
   // 1. primary stats
@@ -212,19 +213,23 @@ export function computeCharacter(input: CharacterInput): CharacterStats {
     label: `${p.label} (${p.value} hit rating)`,
     value: p.value / HIT_RATING_PER_PCT,
   }));
-  const agiPer = conv.agiPerMeleeCrit[cls];
+  const agiPer = lv.agiPerMeleeCrit;
   const weaponCrit = (slot: AttackSlot): Stat =>
     makeStat([
       part("Base", "base", base.baseMeleeCrit),
-      part(`Agility ${r2(P("agi"))} / ${agiPer}`, "conversion", P("agi") / agiPer),
+      part(`Agility ${r2(P("agi"))} / ${r2(agiPer)}`, "conversion", P("agi") / agiPer),
       part("Bonus stats", "gear", bonus.crit),
       ...critRating,
       ...effectParts(effects, (e) => e.key === "crit" || (e.key === "weaponCrit" && hasSlot(e, slot))),
     ]);
-  const intPer = conv.intPerSpellCrit[cls];
+  const intPer = lv.intPerSpellCrit;
   const spellCrit = makeStat([
     part("Base", "base", base.baseSpellCrit),
-    part(`Intellect ${r2(P("int"))} / ${intPer ?? "-"}`, "conversion", intPer ? P("int") / intPer : 0),
+    part(
+      `Intellect ${r2(P("int"))} / ${intPer === undefined ? "-" : r2(intPer)}`,
+      "conversion",
+      intPer ? P("int") / intPer : 0,
+    ),
     part("Bonus stats", "gear", bonus.spellCrit),
     ...critRating,
     ...effectParts(effects, (e) => e.key === "crit" || e.key === "spellCrit"),
diff --git a/src/engine/stats/errors.ts b/src/engine/stats/errors.ts
new file mode 100644
index 0000000..8982f2a
--- /dev/null
+++ b/src/engine/stats/errors.ts
@@ -0,0 +1,2 @@
+/** The stat engine has no base stats for the requested level. */
+export class UnsupportedLevelError extends Error {}
diff --git a/src/engine/stats/index.ts b/src/engine/stats/index.ts
index b734d14..c08dec5 100644
--- a/src/engine/stats/index.ts
+++ b/src/engine/stats/index.ts
@@ -4,6 +4,7 @@ export * from "./types";
 export * from "./equip";
 export * from "./talentEffects";
 export * from "./character";
+export * from "./levels";
 export * from "./target";
 export * from "./assemble";
 export * from "./weapons";
diff --git a/src/engine/stats/levels.test.ts b/src/engine/stats/levels.test.ts
new file mode 100644
index 0000000..e59acb9
--- /dev/null
+++ b/src/engine/stats/levels.test.ts
@@ -0,0 +1,44 @@
+// Phase 7 level goldens (independent Python check: docs/phase7-implementation-plan.md section 9.1, L1-L4).
+import { describe, expect, it } from "vitest";
+import { petsManualFile } from "@/testkit/pets";
+import { baseStats } from "@/testkit/stats";
+import { petBaseAt } from "@/engine/pets";
+import { UnsupportedLevelError, baseStatsAt } from "./index";
+
+describe("base stats by level (Phase 7, [VERIFY Q76])", () => {
+  it("level 60 is the classes table; level 1 is level1", () => {
+    expect(baseStatsAt(baseStats, "WARRIOR", 60).base).toEqual(baseStats.classes.WARRIOR);
+    expect(baseStatsAt(baseStats, "WARRIOR", 60).agiPerMeleeCrit).toBe(20);
+    const one = baseStatsAt(baseStats, "MAGE", 1);
+    expect(one.base).toMatchObject(baseStats.level1!.classes.MAGE);
+    expect(one.base.baseSpellCrit).toBe(0.2); // base crit does not change with level
+    expect(one.intPerSpellCrit).toBeCloseTo(10.948, 3); // L2: 59.5 x 23 / 125
+  });
+  it("L1: Human warrior level 40 is interpolated and keeps 4% crit from base Agility", () => {
+    const w = baseStatsAt(baseStats, "WARRIOR", 40);
+    expect(w.base).toMatchObject({ str: 87, agi: 60, sta: 80, int: 27, spi: 38, health: 1123, mana: 0 });
+    expect(w.agiPerMeleeCrit).toBe(15);
+    expect(w.base.agi / w.agiPerMeleeCrit).toBe(4);
+    expect(baseStatsAt(baseStats, "ROGUE", 60).intPerSpellCrit).toBeUndefined();
+  });
+  it("levels outside 1..60 throw UnsupportedLevelError", () => {
+    expect(() => baseStatsAt(baseStats, "WARRIOR", 0)).toThrow(UnsupportedLevelError);
+    expect(() => baseStatsAt(baseStats, "WARRIOR", 61)).toThrow(UnsupportedLevelError);
+    expect(() => baseStatsAt(baseStats, "WARRIOR", 40.5)).toThrow(UnsupportedLevelError);
+    expect(() => baseStatsAt({ ...baseStats, level1: undefined }, "WARRIOR", 40)).toThrow(
+      UnsupportedLevelError,
+    );
+  });
+  it("L4: pet base stats follow the pet level (= player level)", () => {
+    const h = petsManualFile.owners.hunter!;
+    expect(petBaseAt(h, 60)).toBe(h.base);
+    expect(petBaseAt(h, 40)).toMatchObject({
+      str: 97,
+      minDamage: 30,
+      maxDamage: 50,
+      speedMs: 2000,
+      meleeCrit: 5,
+    });
+    expect(petBaseAt(h, 1)).toMatchObject({ str: 22, agi: 20, minDamage: 1, maxDamage: 1 });
+  });
+});
diff --git a/src/engine/stats/levels.ts b/src/engine/stats/levels.ts
new file mode 100644
index 0000000..2bef11d
--- /dev/null
+++ b/src/engine/stats/levels.ts
@@ -0,0 +1,41 @@
+import type { BaseStatsFile, ClassBaseStats, ManualClassToken } from "@/data/types";
+import { UnsupportedLevelError } from "./errors";
+
+/** Base stats and stat conversions of a class at one level (Phase 7). */
+export interface LevelBase {
+  base: ClassBaseStats;
+  agiPerMeleeCrit: number; // Agility per 1% melee crit at this level
+  intPerSpellCrit: number | undefined; // Intellect per 1% spell crit (undefined: the class gets no spell crit from Int)
+}
+
+const LEVEL_STATS = ["str", "agi", "sta", "int", "spi", "health", "mana"] as const;
+
+/**
+ * Class base stats at `level` (1..file.level). Level `file.level` (60) is the `classes` table itself. Below it the
+ * values are a linear interpolation between `level1` and `classes`, rounded to whole points; base crit and race offsets
+ * do not change with level. Agility/Intellect per 1% crit scale with the class's base Agility/Intellect, so a naked
+ * character keeps the same crit from its base stats at every level. [VERIFY Q76]
+ */
+export function baseStatsAt(file: BaseStatsFile, cls: ManualClassToken, level: number): LevelBase {
+  const top = file.classes[cls];
+  const conv = file.conversions;
+  if (!top) throw new Error(`no base stats for ${cls}`);
+  if (level === file.level)
+    return {
+      base: top,
+      agiPerMeleeCrit: conv.agiPerMeleeCrit[cls],
+      intPerSpellCrit: conv.intPerSpellCrit[cls],
+    };
+  const one = file.level1?.classes[cls];
+  if (!one || !Number.isInteger(level) || level < 1 || level > file.level)
+    throw new UnsupportedLevelError(`no base stats for level ${level} (1..${file.level})`);
+  const t = (level - 1) / (file.level - 1);
+  const base: ClassBaseStats = { ...top };
+  for (const k of LEVEL_STATS) base[k] = Math.round(one[k] + (top[k] - one[k]) * t);
+  const intPer = conv.intPerSpellCrit[cls];
+  return {
+    base,
+    agiPerMeleeCrit: (conv.agiPerMeleeCrit[cls] * base.agi) / top.agi,
+    intPerSpellCrit: intPer === undefined ? undefined : (intPer * base.int) / top.int,
+  };
+}
diff --git a/src/state/character.ts b/src/state/character.ts
index 56a069d..902e958 100644
--- a/src/state/character.ts
+++ b/src/state/character.ts
@@ -71,6 +71,8 @@ export interface CharacterState {
   /** A class picked in the UI: keeps what fits, starts with the class's default pet (Phase 7). */
   fitToClass(token: ClassToken, level: number): Promise<boolean>; // false if something was dropped
   applyCode(code: CharacterCode, token: ClassToken, level: number): Promise<boolean>;
+  /** Phase 7: drops weapons and ammo above `level` (false if something was dropped). */
+  fitToLevel(token: ClassToken, level: number): boolean;
   toCode(token: ClassToken): CharacterCode;
 }
 
@@ -194,6 +196,14 @@ export const useCharacter = create<CharacterState>()((set, get) => ({
     set({ raceId, weaponIds, pet: defaultPet(token), ...(file ? { weapons: file } : {}) });
     return kept;
   },
+  fitToLevel(token, level) {
+    const file = get().weapons;
+    if (!file) return true;
+    const weaponIds = sanitizeWeapons(get().weaponIds, file, token, level);
+    const kept = JSON.stringify(weaponIds) === JSON.stringify(get().weaponIds);
+    if (!kept) set({ weaponIds });
+    return kept;
+  },
   async applyCode(code, token, level) {
     const cls = getClassInfo(token);
     let ok = code.raceId === null || cls.raceIds.includes(code.raceId);
diff --git a/src/state/derived.test.ts b/src/state/derived.test.ts
index c297fb3..882bcf0 100644
--- a/src/state/derived.test.ts
+++ b/src/state/derived.test.ts
@@ -39,9 +39,9 @@ describe("derive", () => {
         for (const v of d.reference) expect(Number.isFinite(v.dps), `${c.token} ${v.presetId}`).toBe(true);
       }
   });
-  it("level below 60 has no stats", () => {
+  it("a level outside 1..60 has no stats (Phase 7: levels 1..59 are supported)", () => {
     expect(
-      derive({ tree: treeFor("warrior"), ranks: {}, level: 40, spells: spellFile("warrior") }, ch),
+      derive({ tree: treeFor("warrior"), ranks: {}, level: 61, spells: spellFile("warrior") }, ch),
     ).toEqual({
       ok: false,
       reason: "level",
diff --git a/src/state/levels.test.ts b/src/state/levels.test.ts
new file mode 100644
index 0000000..445e53f
--- /dev/null
+++ b/src/state/levels.test.ts
@@ -0,0 +1,130 @@
+// Phase 7: the level selector (derive at levels below 60, buffs by level, store rules, URL).
+import { beforeEach, describe, expect, it } from "vitest";
+import { isClassToken } from "@/data";
+import { EMPTY_BONUS } from "@/engine/stats";
+import { spellFile } from "@/testkit/damage";
+import { petFile } from "@/testkit/pets";
+import { weaponsFile } from "@/testkit/stats";
+import { treeFor } from "@/testkit/talents";
+import { decodeBuild, encodeBuild } from "./buildCode";
+import { DEFAULT_CUSTOM, NO_WEAPON_IDS, useCharacter } from "./character";
+import { derive } from "./derived";
+import { useCalc } from "./store";
+
+const ch = {
+  raceId: 1,
+  weaponIds: NO_WEAPON_IDS,
+  bonus: EMPTY_BONUS,
+  buffIds: [] as string[],
+  target: "boss" as const,
+  custom: DEFAULT_CUSTOM,
+  weapons: weaponsFile,
+};
+const warrior = (level: number) => ({
+  tree: treeFor("warrior"),
+  ranks: {},
+  level,
+  spells: spellFile("warrior"),
+});
+
+describe("derive below level 60 (Phase 7)", () => {
+  it("L1/L3: Human warrior level 40: base stats, attack power, level-40 reference targets, rank by level", () => {
+    const d = derive(warrior(40), { ...ch, weaponIds: { ...NO_WEAPON_IDS, mainHand: 2531 } }); // Great Axe, level 39, no stats
+    if (!d.ok) throw new Error(d.reason);
+    expect(d.stats.primary.str.value).toBe(87);
+    expect(d.stats.attackPower.value).toBe(274);
+    const d60 = derive(warrior(60), { ...ch, weaponIds: { ...NO_WEAPON_IDS, mainHand: 2531 } });
+    if (!d60.ok) throw new Error(d60.reason);
+    expect(d.stats.crit.mainHand.parts.find((p) => p.label.startsWith("Agility"))?.value).toBeCloseTo(4, 10);
+    expect(d.stats.crit.mainHand.value).toBeCloseTo(d60.stats.crit.mainHand.value, 10); // 60 / 15 = 80 / 20
+    expect(d.stats.weaponSkill.mainHand.value).toBe(200);
+    expect(d.reference.map((v) => [v.level, v.armor.value])).toEqual([
+      [43, 2414],
+      [42, 2262],
+      [40, 1980],
+      [43, 1207],
+    ]);
+    const hs = d.damage!.result.abilities.find((a) => a.key === "Heroic Strike");
+    expect(hs?.available && hs.spell.id).toBe(11565); // rank 6 (level 40), not 25286 (level 60)
+    expect(Number.isFinite(d.damage!.totalDps)).toBe(true);
+  });
+  it("every class works at levels 1, 10, 25 and 59", () => {
+    for (const token of [
+      "warrior",
+      "paladin",
+      "hunter",
+      "rogue",
+      "priest",
+      "shaman",
+      "mage",
+      "warlock",
+      "druid",
+    ] as const)
+      for (const level of [1, 10, 25, 59]) {
+        const d = derive(
+          { tree: treeFor(token), ranks: {}, level, spells: spellFile(token), pets: petFile(token) },
+          {
+            ...ch,
+            raceId: token === "hunter" ? 3 : token === "druid" ? 4 : 1,
+            pet: { family: 0, sacrifice: 0, scaling: true },
+          },
+        );
+        if (!d.ok) throw new Error(`${token} ${level}: ${d.reason}`);
+        expect(d.stats.level).toBe(level);
+        for (const v of d.reference)
+          expect(Number.isFinite(v.dps), `${token} ${level} ${v.presetId}`).toBe(true);
+      }
+  });
+  it("a buff does nothing below its minLevel (Battle Shout rank 7: level 60)", () => {
+    const ap = (level: number, buffIds: string[]) => {
+      const d = derive(warrior(level), { ...ch, buffIds });
+      if (!d.ok) throw new Error(d.reason);
+      return d.stats.attackPower.value;
+    };
+    expect(ap(60, ["battle_shout"]) - ap(60, [])).toBe(139);
+    expect(ap(59, ["battle_shout"]) - ap(59, [])).toBe(0);
+    expect(ap(20, ["blessing_of_kings"])).toBeGreaterThan(ap(20, []));
+  });
+  it("the pet has the player's level", () => {
+    const d = derive(
+      { tree: treeFor("hunter"), ranks: {}, level: 40, spells: spellFile("hunter"), pets: petFile("hunter") },
+      { ...ch, raceId: 3, pet: { family: 2, sacrifice: 0, scaling: false } },
+    );
+    if (!d.ok) throw new Error(d.reason);
+    const p = d.damage!.pet!;
+    expect(p.stats.level).toBe(40);
+    expect(p.stats.attackPower.value).toBe(174); // L4: 2 x 97 - 20, no owner scaling
+    expect(p.stats.weapons.mainHand).toMatchObject({ min: 30, max: 50 });
+  });
+});
+
+describe("level selector (store, URL)", () => {
+  beforeEach(async () => {
+    const r = decodeBuild("#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N", isClassToken); // Fire 33 / Frost 18
+    if (!r.ok) throw new Error(r.reason);
+    await useCalc.getState().applyBuildCode(r.build);
+  });
+  it("lowering the level removes the points above it, with a notice; the link carries the level", () => {
+    const s = useCalc.getState();
+    expect(Object.values(s.ranks).reduce((a, b) => a + b, 0)).toBe(51);
+    s.setLevel(30);
+    const t = useCalc.getState();
+    expect(t.level).toBe(30);
+    expect(Object.values(t.ranks).reduce((a, b) => a + b, 0)).toBe(21);
+    expect(t.notice).toBe("Talent points above level 30 were removed.");
+    const hash = encodeBuild({ classToken: "mage", level: 30, talentedRank: 0, ranks: t.ranks });
+    expect(hash.startsWith("#v1.mage.30.0.")).toBe(true);
+    const r = decodeBuild(hash, isClassToken);
+    expect(r.ok && r.build.level).toBe(30);
+    t.setLevel(60); // raising the level keeps the build
+    expect(Object.values(useCalc.getState().ranks).reduce((a, b) => a + b, 0)).toBe(21);
+    t.setLevel(99); // clamped
+    expect(useCalc.getState().level).toBe(60);
+  });
+  it("weapons above the level are removed", async () => {
+    useCharacter.setState({ weapons: weaponsFile, weaponIds: { ...NO_WEAPON_IDS, mainHand: 19356 } }); // Staff of the Shadow Flame, level 60
+    useCalc.getState().setLevel(50);
+    expect(useCharacter.getState().weaponIds.mainHand).toBe(0);
+    expect(useCalc.getState().notice).toContain("Weapons that need a higher level than 50 were removed.");
+  });
+});
diff --git a/src/state/store.ts b/src/state/store.ts
index 42eda4d..9275a96 100644
--- a/src/state/store.ts
+++ b/src/state/store.ts
@@ -2,6 +2,8 @@ import { create } from "zustand";
 import { classesFile, getClassInfo, loadClassSpells, loadPetFile, loadTalentFile } from "@/data";
 import type { ClassSpellFile, ClassToken, PetFile } from "@/data/types";
 import {
+  MAX_LEVEL,
+  MIN_LEVEL,
   addPoint as addPointRule,
   buildClassTree,
   removePoint as removePointRule,
@@ -36,6 +38,8 @@ export interface CalcState {
   resetSpec(specIndex: number): void;
   resetAll(): void;
   setTalented(on: boolean): void;
+  /** Phase 7: 1..60. Talent points above the new level and weapons it cannot use are removed (with a notice). */
+  setLevel(level: number): void;
   setActiveSpec(i: number): void;
   dismissNotice(): void;
 }
@@ -187,6 +191,23 @@ export const useCalc = create<CalcState>()((set, get) => ({
     const { ranks } = sanitize(s.tree, s.ranks, pointsContext({ level: s.level, talentedRank }));
     set({ talentedRank, ranks });
   },
+  setLevel(level) {
+    const s = get();
+    const lv = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)));
+    if (!Number.isFinite(lv) || lv === s.level) return;
+    const { ranks, dropped } = s.tree
+      ? sanitize(s.tree, s.ranks, pointsContext({ level: lv, talentedRank: s.talentedRank }))
+      : { ranks: s.ranks, dropped: false };
+    const weaponsOk = s.classToken ? useCharacter.getState().fitToLevel(s.classToken, lv) : true;
+    const notice =
+      [
+        dropped ? `Talent points above level ${lv} were removed.` : "",
+        weaponsOk ? "" : `Weapons that need a higher level than ${lv} were removed.`,
+      ]
+        .filter(Boolean)
+        .join(" ") || null;
+    set({ level: lv, ranks, ...(notice ? { notice } : {}) });
+  },
   setActiveSpec(i) {
     set({ activeSpec: Math.max(0, Math.min(2, i)) });
   },
diff --git a/src/ui/character/BuffsPanel.tsx b/src/ui/character/BuffsPanel.tsx
index be6a1b2..9317aa8 100644
--- a/src/ui/character/BuffsPanel.tsx
+++ b/src/ui/character/BuffsPanel.tsx
@@ -1,13 +1,19 @@
 import { buffsFile } from "@/data";
 import type { BuffCategory, BuffDef } from "@/data/types";
 import { useCharacter } from "@/state/character";
+import { useCalc } from "@/state/store";
 import { effectsSummary } from "./effectText";
 import styles from "./CharacterPanel.module.css";
 
 export function BuffCheck({ buff }: { buff: BuffDef }) {
   const checked = useCharacter((s) => s.buffIds.includes(buff.id));
   const toggle = useCharacter((s) => s.toggleBuff);
-  const title = (buff.notes ?? "") + (buff.classic ? ` Classic 1.12: ${buff.classic}.` : "");
+  const level = useCalc((s) => s.level);
+  const tooLow = (buff.minLevel ?? 1) > level; // Phase 7: kept in the build, but it does nothing at this level
+  const title =
+    (tooLow ? `Requires level ${buff.minLevel}: no effect at level ${level}. ` : "") +
+    (buff.notes ?? "") +
+    (buff.classic ? ` Classic 1.12: ${buff.classic}.` : "");
   return (
     <label className={styles.buff} title={title.trim() || undefined}>
       <input
@@ -18,6 +24,7 @@ export function BuffCheck({ buff }: { buff: BuffDef }) {
       />
       <span>
         {buff.name} <span className={styles.dim}>{effectsSummary(buff.effects)}</span>
+        {tooLow && <span className={styles.levelReq}> (level {buff.minLevel})</span>}
       </span>
     </label>
   );
diff --git a/src/ui/character/CharacterPanel.module.css b/src/ui/character/CharacterPanel.module.css
index 8e69160..900b82c 100644
--- a/src/ui/character/CharacterPanel.module.css
+++ b/src/ui/character/CharacterPanel.module.css
@@ -181,3 +181,7 @@
 .result {
   margin-top: 8px;
 }
+
+.levelReq {
+  color: var(--red);
+}
diff --git a/src/ui/character/CharacterPanel.tsx b/src/ui/character/CharacterPanel.tsx
index 1aa9fe9..b651c84 100644
--- a/src/ui/character/CharacterPanel.tsx
+++ b/src/ui/character/CharacterPanel.tsx
@@ -114,6 +114,7 @@ export function CharacterPanel() {
   const classToken = useCalc((s) => s.classToken);
   const raceId = useCharacter((s) => s.raceId);
   const setRace = useCharacter((s) => s.setRace);
+  const level = useCalc((s) => s.level);
   if (!classToken) return null;
   const cls = getClassInfo(classToken);
   const races = cls.raceIds.map((id) => classesFile.races.find((r) => r.id === id)!);
@@ -141,7 +142,9 @@ export function CharacterPanel() {
               </option>
             ))}
           </select>
-          <span className={styles.dim}>Level 60</span>
+          <span className={styles.dim} data-testid="character-level">
+            Level {level}
+          </span>
         </div>
       </section>
       <WeaponsSection />
diff --git a/src/ui/character/TargetPanel.tsx b/src/ui/character/TargetPanel.tsx
index a2e2d72..c207c6c 100644
--- a/src/ui/character/TargetPanel.tsx
+++ b/src/ui/character/TargetPanel.tsx
@@ -1,6 +1,7 @@
 import { buffsFile, targetsFile } from "@/data";
 import type { MagicSchool } from "@/data/types";
 import { CUSTOM_LIMITS, RESIST_ORDER, useCharacter } from "@/state/character";
+import { useCalc } from "@/state/store";
 import { StatValue } from "@/ui/stats/StatValue";
 import { fmtInt, fmtPct } from "@/ui/stats/format";
 import { useDerived } from "@/ui/stats/useDerived";
@@ -15,7 +16,8 @@ export function TargetPanel() {
   const setTarget = useCharacter((s) => s.setTarget);
   const setCustom = useCharacter((s) => s.setCustom);
   const d = useDerived();
-  const rows = targetsFile.byPlayerLevel["60"] ?? [];
+  const level = useCalc((s) => s.level);
+  const rows = targetsFile.byPlayerLevel[String(level)] ?? [];
   const num = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
 
   return (
diff --git a/src/ui/stats/StatStrip.tsx b/src/ui/stats/StatStrip.tsx
index 45238b1..312c764 100644
--- a/src/ui/stats/StatStrip.tsx
+++ b/src/ui/stats/StatStrip.tsx
@@ -17,7 +17,7 @@ export function StatStrip() {
   if (!d.ok) {
     return d.reason === "level" ? (
       <div className={styles.strip} data-testid="stat-strip">
-        <span className={styles.note}>Stats: level 60 only</span>
+        <span className={styles.note}>Stats: no base stats for this level</span>
       </div>
     ) : null;
   }
diff --git a/src/ui/stats/StatsPanel.tsx b/src/ui/stats/StatsPanel.tsx
index 143ab22..00682d8 100644
--- a/src/ui/stats/StatsPanel.tsx
+++ b/src/ui/stats/StatsPanel.tsx
@@ -264,7 +264,7 @@ function ReferenceTable({ d }: { d: Ok }) {
     <section className={styles.block}>
       <div className={styles.scroll}>
         <table className={styles.ref} data-testid="reference-table">
-          <caption>Same build vs reference targets for level 60 (debuffs applied)</caption>
+          <caption>Same build vs reference targets for level {s.level} (debuffs applied)</caption>
           <thead>
             <tr>
               <th>Target</th>
@@ -312,7 +312,7 @@ export function StatsPanel() {
     return (
       <div className={styles.panel} data-testid="stats-panel">
         <h2 className={styles.title}>Stats</h2>
-        <p className={styles.dim}>Stats are computed for level 60 only (level selector: Phase 7).</p>
+        <p className={styles.dim}>No base stats for this level.</p>
       </div>
     );
   }
diff --git a/src/ui/talents/PointsSummary.module.css b/src/ui/talents/PointsSummary.module.css
index 991a695..64de5ab 100644
--- a/src/ui/talents/PointsSummary.module.css
+++ b/src/ui/talents/PointsSummary.module.css
@@ -19,6 +19,20 @@
   white-space: nowrap;
 }
 
+.level {
+  padding: 2px 4px;
+  background: var(--field-bg);
+  border: 1px solid var(--panel-border);
+  border-radius: 3px;
+  color: var(--text);
+  font: inherit;
+}
+
+.level:focus-visible {
+  outline: 2px solid var(--focus);
+  outline-offset: 1px;
+}
+
 .neg {
   color: var(--red);
 }
diff --git a/src/ui/talents/PointsSummary.tsx b/src/ui/talents/PointsSummary.tsx
index 6023296..f1a47e2 100644
--- a/src/ui/talents/PointsSummary.tsx
+++ b/src/ui/talents/PointsSummary.tsx
@@ -1,9 +1,18 @@
 import { useEffect, useMemo, useRef, useState } from "react";
-import { availablePoints, pointsBySpec, pointsSpent, requiredLevel } from "@/engine/talents";
+import {
+  MAX_LEVEL,
+  MIN_LEVEL,
+  availablePoints,
+  pointsBySpec,
+  pointsSpent,
+  requiredLevel,
+} from "@/engine/talents";
 import { classesFile } from "@/data";
 import { pointsContext, useCalc } from "@/state/store";
 import styles from "./PointsSummary.module.css";
 
+const LEVELS = Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => MAX_LEVEL - i);
+
 async function copyText(text: string): Promise<void> {
   try {
     await navigator.clipboard.writeText(text);
@@ -28,6 +37,7 @@ export function PointsSummary() {
   const level = useCalc((s) => s.level);
   const talentedRank = useCalc((s) => s.talentedRank);
   const setTalented = useCalc((s) => s.setTalented);
+  const setLevel = useCalc((s) => s.setLevel);
   const resetAll = useCalc((s) => s.resetAll);
   const [copied, setCopied] = useState(false);
   const [announce, setAnnounce] = useState("");
@@ -74,7 +84,21 @@ export function PointsSummary() {
       <span className={styles.item} data-testid="required-level">
         Required level: {req ?? "–"}
       </span>
-      <span className={styles.item}>Level {level}</span>
+      <label className={styles.item}>
+        Level{" "}
+        <select
+          className={styles.level}
+          data-testid="level-select"
+          value={level}
+          onChange={(e) => setLevel(Number(e.target.value))}
+        >
+          {LEVELS.map((l) => (
+            <option key={l} value={l}>
+              {l}
+            </option>
+          ))}
+        </select>
+      </label>
       <label
         className={styles.item}
         title="Account perk: talent points start at level 5 instead of 10 (max 51). At level 60 it only lowers the required level."
diff --git a/tools/pipeline/manual.py b/tools/pipeline/manual.py
index bbfa37f..21f66e9 100644
--- a/tools/pipeline/manual.py
+++ b/tools/pipeline/manual.py
@@ -45,6 +45,26 @@ def _check_effect_sources(fn, d, sid, db, mv):
                                   (e["key"], src, e["value"], r[col], src.get("mult", 1), num(want))})
 
 
+def _check_min_level(d, db, mv):
+    """Phase 7: buffs.json minLevel (absent = 1) must equal SpellLevels.BaseLevel of the buff's spell (class buffs and
+    debuffs: the modeled rank) and, with an itemId, max(1, ItemSparse.RequiredLevel) of the item."""
+    want = d.get("minLevel", 1)
+    bid = str(d.get("id"))
+    if d.get("category") in ("raid", "debuff") and d.get("spellId") is not None:
+        row = db.by_spell("SpellLevels").get(str(d["spellId"]))
+        base = I(row["BaseLevel"]) if row else 0
+        if base > 0 and base != want:
+            mv.append({"file": "buffs.json", "id": bid,
+                       "problem": "minLevel %s != SpellLevels.BaseLevel %s" % (want, base)})
+    if d.get("itemId") is not None:
+        item = db.by_id("ItemSparse").get(str(d["itemId"]))
+        if item is None:
+            mv.append({"file": "buffs.json", "id": bid, "problem": "itemId %s not in ItemSparse" % d["itemId"]})
+        elif max(1, I(item["RequiredLevel"])) != want:
+            mv.append({"file": "buffs.json", "id": bid,
+                       "problem": "minLevel %s != ItemSparse.RequiredLevel %s" % (want, item["RequiredLevel"])})
+
+
 def validate_manual(manual_dir, db, report):
     """Returns {filename: parsed JSON}. Problems go to report['manualValidation'] (warnings)."""
     mv = report.setdefault("manualValidation", [])
@@ -75,6 +95,8 @@ def validate_manual(manual_dir, db, report):
                            "problem": "spellId %s is '%s', expected name containing '%s'" %
                                       (sid, row["Name_lang"], expect)})
             _check_effect_sources(fn, d, sid, db, mv)
+    for d in data.get("buffs.json", {}).get("buffs") or []:
+        _check_min_level(d, db, mv)
     fam = {r["ID"]: r["Name_lang"] for r in db.rows("CreatureFamily")}
     pets = data.get("pets.json", {})
     for grp in ("sacrifice", "masterDemonologist"):
diff --git a/tools/pipeline/tests/test_phase7.py b/tools/pipeline/tests/test_phase7.py
new file mode 100644
index 0000000..7198ec4
--- /dev/null
+++ b/tools/pipeline/tests/test_phase7.py
@@ -0,0 +1,54 @@
+"""Phase 7: level data in data/manual (buff minLevel checked against SpellLevels / ItemSparse, level-1 base stats)."""
+import copy
+import json
+import os
+import unittest
+
+from ._fixtures import MANUAL, RAW, needs_raw
+
+
+def _manual(name):
+    with open(os.path.join(MANUAL, name), encoding="utf-8") as f:
+        return json.load(f)
+
+
+@needs_raw
+class TestPhase7(unittest.TestCase):
+    def setUp(self):
+        from pipeline.db2 import RawDB
+        self.db = RawDB(RAW)
+
+    def problems(self, buffs):
+        from pipeline.manual import _check_min_level
+        mv = []
+        for d in buffs:
+            _check_min_level(d, self.db, mv)
+        return mv
+
+    def test_buff_min_levels_match_the_data(self):
+        buffs = _manual("buffs.json")["buffs"]
+        self.assertEqual(self.problems(buffs), [])
+        lv = {b["id"]: b.get("minLevel", 1) for b in buffs}
+        self.assertEqual((lv["battle_shout"], lv["arcane_intellect"], lv["blessing_of_kings"]), (60, 56, 20))
+        self.assertEqual((lv["sunder_armor"], lv["faerie_fire"], lv["curse_of_the_elements"]), (58, 54, 50))
+        self.assertEqual((lv["elixir_of_the_mongoose"], lv["flask_of_the_titans"], lv["songflower"]), (46, 50, 1))
+
+    def test_wrong_min_level_is_reported(self):
+        buffs = copy.deepcopy([b for b in _manual("buffs.json")["buffs"]
+                               if b["id"] in ("battle_shout", "elixir_of_the_mongoose")])
+        for b in buffs:
+            b["minLevel"] = 1
+        self.assertEqual([p["problem"] for p in self.problems(buffs)],
+                         ["minLevel 1 != SpellLevels.BaseLevel 60", "minLevel 1 != ItemSparse.RequiredLevel 46"])
+
+    def test_level_one_base_stats_below_level_60(self):
+        bs = _manual("base-stats.json")
+        self.assertEqual(sorted(bs["level1"]["classes"]), sorted(bs["classes"]))
+        for cls, one in bs["level1"]["classes"].items():
+            for k, v in one.items():
+                self.assertLessEqual(v, bs["classes"][cls][k], (cls, k))
+        pets = _manual("pets.json")
+        for owner in ("hunter", "warlock"):
+            o = pets["owners"][owner]
+            for k, v in o["level1"].items():
+                self.assertLess(v, o["base"][k], (owner, k))
````

### 6.3 C: talent impact, tree DPS, heat map (task T4)

Files: `src/state/derived.ts` (`DeriveOptions`, exported input types), new `src/state/insight.ts` + `insight.test.ts`, `src/ui/stats/useDerived.ts` (shared derive, `useDeriveInputs`), new `src/ui/talents/useInsight.ts`, tooltip/tree/node/calculator components and CSS, `e2e/insight.spec.ts`.

````diff
diff --git a/e2e/insight.spec.ts b/e2e/insight.spec.ts
new file mode 100644
index 0000000..2546e3b
--- /dev/null
+++ b/e2e/insight.spec.ts
@@ -0,0 +1,40 @@
+import { expect, test } from "@playwright/test";
+import { blockRemoteImages, node, watchErrors } from "./helpers";
+
+const WARRIOR_V2 = "#v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8"; // Phase 3 golden
+
+test.beforeEach(async ({ page }) => {
+  await blockRemoteImages(page);
+});
+
+test("talent tooltip shows the DPS of the next and last point; trees show their DPS", async ({ page }) => {
+  const w = watchErrors(page);
+  await page.goto(`./${WARRIOR_V2}`); // Human, Arcanite Reaper, Cruelty 5/5, raid buffs
+  await expect(page.getByTestId("dps-total")).toBeVisible();
+  await node(page, "Cruelty").hover();
+  const tip = page.locator("#talent-tooltip");
+  await expect(tip.getByTestId("impact-prev")).toContainText(/Last point: −\d+\.\d DPS/);
+  await expect(tip.getByTestId("impact-prev")).toContainText("−1.00% crit vs target");
+  await expect(tip.getByTestId("impact-next")).toHaveCount(0); // maxed
+  await node(page, "Deflection").hover(); // Arms, defensive
+  await expect(tip.getByTestId("impact-next")).toContainText("Next point: +0.0 DPS (+0.00%)");
+  await expect(tip.getByTestId("impact-prev")).toHaveCount(0);
+  await expect(page.getByTestId("spec-dps-1")).toContainText(/^\+\d+\.\d DPS$/); // Fury points
+  await expect(page.getByTestId("spec-dps-0")).toHaveCount(0); // no points in Arms
+  w.check();
+});
+
+test("keyboard focus shows the impact; the heat map labels every talent", async ({ page }) => {
+  const w = watchErrors(page);
+  await page.goto("./#v1.warrior.60.0");
+  await expect(page.getByTestId("dps-total")).toBeVisible();
+  await node(page, "Cruelty").focus();
+  await expect(page.locator("#talent-tooltip").getByTestId("impact-next")).toBeVisible();
+  await page.keyboard.press("+");
+  await expect(page.locator("#talent-tooltip").getByTestId("impact-prev")).toBeVisible();
+  await page.getByTestId("heatmap-toggle").check();
+  await expect.poll(() => page.getByTestId("node-impact").count()).toBeGreaterThan(20);
+  await page.getByTestId("heatmap-toggle").uncheck();
+  await expect(page.getByTestId("node-impact")).toHaveCount(0);
+  w.check();
+});
diff --git a/src/state/derived.ts b/src/state/derived.ts
index 9dc4041..95b7b6e 100644
--- a/src/state/derived.ts
+++ b/src/state/derived.ts
@@ -61,14 +61,14 @@ export type Derived =
     }
   | { ok: false; reason: "noClass" | "level" };
 
-type CalcInput = {
+export type CalcInput = {
   tree: ClassTree | null;
   ranks: Ranks;
   level: number;
   spells: ClassSpellFile | null;
   pets?: PetFile | null; // Phase 6
 };
-type CharInput = Pick<
+export type CharInput = Pick<
   CharacterState,
   "raceId" | "weaponIds" | "bonus" | "buffIds" | "target" | "custom" | "weapons"
 > &
@@ -129,8 +129,18 @@ function inputsOf(calc: CalcInput & { tree: ClassTree }, ch: CharInput, custom:
   return { weapons, talents, classTalents, args, rotation: enabledRotation(chosen), customTarget, pet };
 }
 
+/** Phase 7: `reference: false` skips the reference-target rows (insight and stat weights need only the selected target). */
+export interface DeriveOptions {
+  reference?: boolean;
+}
+
 /** Pure: everything the stats and damage UI shows, from the stores (`custom`: the rotation editor's rotation). */
-export function derive(calc: CalcInput, ch: CharInput, custom: SpecRotation | null = null): Derived {
+export function derive(
+  calc: CalcInput,
+  ch: CharInput,
+  custom: SpecRotation | null = null,
+  opts: DeriveOptions = {},
+): Derived {
   const tree = calc.tree;
   if (!tree || ch.raceId === 0) return { ok: false, reason: "noClass" };
   const { weapons, talents, classTalents, args, rotation, customTarget, pet } = inputsOf(
@@ -197,14 +207,16 @@ export function derive(calc: CalcInput, ch: CharInput, custom: SpecRotation | nu
   const view = at(ch.target);
   const result = damageAt(view);
   const petResult = result ? petAt(targetOf(ch.target)) : null;
-  const reference = [...REFERENCE_PRESETS, ...(ch.target === "custom" ? (["custom"] as const) : [])].map(
-    (p) => {
-      const v = at(p);
-      const d = p === ch.target && result ? result : damageAt(v);
-      const pd = p === ch.target ? petResult : d ? petAt(targetOf(p)) : null;
-      return d ? { ...v, dps: d.rotation.dps + (pd?.rotation.dps ?? 0) } : v;
-    },
-  );
+  const presets = opts.reference === false ? [] : REFERENCE_PRESETS;
+  const reference = [
+    ...presets,
+    ...(ch.target === "custom" && presets.length ? (["custom"] as const) : []),
+  ].map((p) => {
+    const v = at(p);
+    const d = p === ch.target && result ? result : damageAt(v);
+    const pd = p === ch.target ? petResult : d ? petAt(targetOf(p)) : null;
+    return d ? { ...v, dps: d.rotation.dps + (pd?.rotation.dps ?? 0) } : v;
+  });
   const damage =
     result && prepared
       ? {
diff --git a/src/state/insight.test.ts b/src/state/insight.test.ts
new file mode 100644
index 0000000..662f878
--- /dev/null
+++ b/src/state/insight.test.ts
@@ -0,0 +1,84 @@
+// Phase 7: talent impact (next/last point), tree contribution, insight cache.
+import { describe, expect, it } from "vitest";
+import { rotationsFile } from "@/data";
+import { EMPTY_BONUS } from "@/engine/stats";
+import { spellFile } from "@/testkit/damage";
+import { petFile } from "@/testkit/pets";
+import { weaponsFile } from "@/testkit/stats";
+import { treeFor } from "@/testkit/talents";
+import { DEFAULT_CUSTOM, NO_WEAPON_IDS } from "./character";
+import { derive } from "./derived";
+import { InsightCache, snapshot, talentImpact, treeContribution, type InsightInputs } from "./insight";
+
+const tree = treeFor("warrior");
+const id = (name: string) => [...tree.nodes.values()].find((n) => n.talent.name === name)!.talent.nodeId;
+const ch = {
+  raceId: 1,
+  weaponIds: { ...NO_WEAPON_IDS, mainHand: 12784 }, // Arcanite Reaper
+  bonus: EMPTY_BONUS,
+  buffIds: [] as string[],
+  target: "boss" as const,
+  custom: DEFAULT_CUSTOM,
+  weapons: weaponsFile,
+  pet: { family: 0, sacrifice: 0, scaling: true },
+};
+function inputs(ranks: Record<number, number>): InsightInputs {
+  const calc = { tree, ranks, level: 60, spells: spellFile("warrior"), pets: petFile("warrior") };
+  return { calc, ch, rotation: null };
+}
+
+describe("talent impact", () => {
+  it("the baseline equals the panels' DPS (same rotation rule, no reference rows)", () => {
+    const inp = inputs({ [id("Cruelty")]: 2 });
+    const d = derive(inp.calc, ch);
+    expect(snapshot(inp)!.dps).toBeCloseTo(d.ok ? d.damage!.totalDps : NaN, 10);
+  });
+  it("Cruelty: next point +1% crit and more DPS; last point the opposite; none past the ends", () => {
+    const zero = inputs({});
+    const at0 = talentImpact(zero, snapshot(zero)!, id("Cruelty"));
+    expect(at0.prev).toBeNull();
+    expect(at0.next!.dps).toBeGreaterThan(0);
+    expect(at0.next!.stats).toEqual([
+      { id: "crit", label: "crit vs target", format: "pct", delta: expect.closeTo(1, 10) },
+    ]);
+    const two = inputs({ [id("Cruelty")]: 2 });
+    const at2 = talentImpact(two, snapshot(two)!, id("Cruelty"));
+    expect(at2.prev!.dps).toBeLessThan(0);
+    expect(at2.next!.pct).toBeCloseTo((at2.next!.dps / snapshot(two)!.dps) * 100, 10);
+    const five = inputs({ [id("Cruelty")]: 5 });
+    expect(talentImpact(five, snapshot(five)!, id("Cruelty")).next).toBeNull();
+  });
+  it("ignores the point rules: a locked talent shows its first point (the leading spec picks the rotation)", () => {
+    const inp = inputs({});
+    const x = talentImpact(inp, snapshot(inp)!, id("Mortal Strike")); // tier 7, needs 30 points
+    expect(x.next!.dps).toBeGreaterThan(0); // Arms leads with 1 point: Mortal Strike enters the Arms rotation
+    const bt = talentImpact(inp, snapshot(inp)!, id("Bloodthirst")).next!; // Fury leads: the Fury rotation
+    expect(bt.dps).toBeCloseTo(snapshot(inp, { [id("Bloodthirst")]: 1 })!.dps - snapshot(inp)!.dps, 10);
+    expect(bt.rotation).toBe(rotationsFile.rotations.find((r) => r.id === "warrior-fury")!.label);
+    expect(x.next!.rotation).toBeNull();
+    const arms = { ...inp, rotation: rotationsFile.rotations.find((r) => r.id === "warrior-arms")! };
+    expect(talentImpact(arms, snapshot(arms)!, id("Bloodthirst")).next!.dps).toBeCloseTo(0, 10); // not in Arms
+  });
+  it("tree contribution = DPS minus the DPS without that tree's points", () => {
+    const ranks = { [id("Cruelty")]: 5, [id("Deflection")]: 5 };
+    const inp = inputs(ranks);
+    const base = snapshot(inp)!;
+    const c = treeContribution(inp, base);
+    expect(c).toHaveLength(3);
+    const fury = c[tree.nodes.get(id("Cruelty"))!.specIndex]!;
+    expect(fury).toBeCloseTo(base.dps - snapshot(inp, { [id("Deflection")]: 5 })!.dps, 10);
+    expect(fury).toBeGreaterThan(0);
+    expect(c[tree.nodes.get(id("Deflection"))!.specIndex]).toBeCloseTo(0, 10); // Deflection is defensive
+    expect(c.filter((x) => x === 0)).toHaveLength(2);
+  });
+  it("the cache evaluates each talent once per input set", () => {
+    const cache = new InsightCache();
+    const inp = inputs({});
+    const a = cache.impact(inp, id("Cruelty"));
+    expect(cache.impact({ ...inp, calc: { ...inp.calc } }, id("Cruelty"))).toBe(a); // same store values
+    expect(cache.has(inp, id("Cruelty"))).toBe(true);
+    const other = { ...inp, calc: { ...inp.calc, ranks: { [id("Cruelty")]: 1 } } };
+    expect(cache.impact(other, id("Cruelty"))).not.toBe(a);
+    expect(cache.has(inp, id("Impale"))).toBe(false);
+  });
+});
diff --git a/src/state/insight.ts b/src/state/insight.ts
new file mode 100644
index 0000000..addf924
--- /dev/null
+++ b/src/state/insight.ts
@@ -0,0 +1,191 @@
+import type { SpecRotation } from "@/data/types";
+import type { CharacterStats, TargetView } from "@/engine/stats";
+import type { Ranks } from "@/engine/talents";
+import { derive, type CalcInput, type CharInput } from "./derived";
+
+/**
+ * Phase 7 insight: what one talent point, one talent tree or one stat is worth. Every number is a difference of two
+ * analytical evaluations (`derive` without the reference rows) against the selected target, with the same rotation
+ * rule as the panels: the editor's rotation, else the default rotation of the spec with the most points. So a delta
+ * is exactly the change the Damage panel shows after the click (a point that changes the leading spec also changes
+ * the rotation).
+ */
+export interface InsightInputs {
+  calc: CalcInput;
+  ch: CharInput;
+  rotation: SpecRotation | null; // the rotation editor's rotation (useRotation.custom)
+}
+
+export type ImpactFormat = "int" | "pct";
+export interface ImpactStatDef {
+  id: string;
+  label: string;
+  format: ImpactFormat;
+  get(stats: CharacterStats, view: TargetView): number;
+}
+const bestSpellPower = (s: CharacterStats) => Math.max(...Object.values(s.spellPower).map((x) => x.value));
+/** The stats a talent tooltip and the compare view report, in display order. */
+export const IMPACT_STATS: readonly ImpactStatDef[] = [
+  { id: "ap", label: "attack power", format: "int", get: (s) => s.attackPower.value },
+  { id: "rap", label: "ranged attack power", format: "int", get: (s) => s.rangedAttackPower?.value ?? 0 },
+  { id: "sp", label: "spell power", format: "int", get: bestSpellPower },
+  { id: "hit", label: "hit", format: "pct", get: (s) => s.hit.mainHand.value },
+  { id: "rangedHit", label: "ranged hit", format: "pct", get: (s) => s.hit.ranged?.value ?? 0 },
+  { id: "spellHit", label: "spell hit", format: "pct", get: (s) => s.hit.spell.value },
+  { id: "crit", label: "crit vs target", format: "pct", get: (_, v) => v.mainHand?.crit.value ?? 0 },
+  {
+    id: "rangedCrit",
+    label: "ranged crit vs target",
+    format: "pct",
+    get: (_, v) => v.ranged?.crit.value ?? 0,
+  },
+  { id: "spellCrit", label: "spell crit vs target", format: "pct", get: (_, v) => v.spell.crit.value },
+  { id: "haste", label: "melee haste", format: "pct", get: (s) => s.haste.melee.value },
+  { id: "rangedHaste", label: "ranged haste", format: "pct", get: (s) => s.haste.ranged.value },
+  { id: "spellHaste", label: "spell haste", format: "pct", get: (s) => s.haste.spell.value },
+  { id: "skill", label: "weapon skill", format: "int", get: (s) => s.weaponSkill.mainHand.value },
+  { id: "str", label: "Strength", format: "int", get: (s) => s.primary.str.value },
+  { id: "agi", label: "Agility", format: "int", get: (s) => s.primary.agi.value },
+  { id: "int", label: "Intellect", format: "int", get: (s) => s.primary.int.value },
+];
+/** Deltas below these are rounding noise and are not shown. */
+const SHOW_MIN: Record<ImpactFormat, number> = { int: 0.5, pct: 0.005 };
+
+export interface Snapshot {
+  dps: number; // owner + pet vs the selected target
+  stats: Record<string, number>; // IMPACT_STATS values by id
+  rotation: { id: string; label: string }; // the rotation evaluated
+}
+export interface StatDelta {
+  id: string;
+  label: string;
+  format: ImpactFormat;
+  delta: number;
+}
+export interface Impact {
+  dps: number; // variant - current
+  pct: number; // dps / current DPS x 100 (0 when the current DPS is 0)
+  stats: StatDelta[]; // only visible changes, IMPACT_STATS order
+  rotation: string | null; // label of the other rotation when the change switches it (leading spec changed)
+}
+export interface TalentImpact {
+  next: Impact | null; // one more point (null at max rank)
+  prev: Impact | null; // one point less (null at rank 0)
+}
+
+/** DPS and key stats of one evaluation (null without damage: spells loading or an unsupported level). */
+export function snapshot(
+  inp: InsightInputs,
+  ranks: Ranks = inp.calc.ranks,
+  bonus = inp.ch.bonus,
+): Snapshot | null {
+  const d = derive({ ...inp.calc, ranks }, { ...inp.ch, bonus }, inp.rotation, { reference: false });
+  if (!d.ok || !d.damage) return null;
+  const stats: Record<string, number> = {};
+  for (const s of IMPACT_STATS) stats[s.id] = s.get(d.stats, d.view);
+  const r = d.damage.rotation;
+  return { dps: d.damage.totalDps, stats, rotation: { id: r.id, label: r.label } };
+}
+
+export function compare(base: Snapshot, other: Snapshot): Impact {
+  const dps = other.dps - base.dps;
+  return {
+    dps,
+    pct: base.dps > 0 ? (dps / base.dps) * 100 : 0,
+    stats: IMPACT_STATS.flatMap((s) => {
+      const delta = (other.stats[s.id] ?? 0) - (base.stats[s.id] ?? 0);
+      return Math.abs(delta) >= SHOW_MIN[s.format]
+        ? [{ id: s.id, label: s.label, format: s.format, delta }]
+        : [];
+    }),
+    rotation: other.rotation.id !== base.rotation.id ? other.rotation.label : null,
+  };
+}
+
+const withRank = (ranks: Ranks, nodeId: number, rank: number): Ranks => {
+  const out: Record<number, number> = { ...ranks };
+  if (rank > 0) out[nodeId] = rank;
+  else delete out[nodeId];
+  return out;
+};
+
+/**
+ * One point more and one point less in a talent. The point rules are not checked: the tooltip of a locked talent
+ * shows what its first point would add.
+ */
+export function talentImpact(inp: InsightInputs, base: Snapshot, nodeId: number): TalentImpact {
+  const node = inp.calc.tree?.nodes.get(nodeId);
+  if (!node) return { next: null, prev: null };
+  const rank = inp.calc.ranks[nodeId] ?? 0;
+  const at = (r: number) => {
+    const s = snapshot(inp, withRank(inp.calc.ranks, nodeId, r));
+    return s ? compare(base, s) : null;
+  };
+  return {
+    next: rank < node.talent.maxRank ? at(rank + 1) : null,
+    prev: rank > 0 ? at(rank - 1) : null,
+  };
+}
+
+/** DPS of each tree's points: current DPS minus the DPS without that tree's points (rotation pinned). */
+export function treeContribution(inp: InsightInputs, base: Snapshot): number[] {
+  const tree = inp.calc.tree;
+  if (!tree) return [];
+  return tree.specNodeIds.map((ids) => {
+    if (!ids.some((id) => (inp.calc.ranks[id] ?? 0) > 0)) return 0;
+    const ranks: Record<number, number> = { ...inp.calc.ranks };
+    for (const id of ids) delete ranks[id];
+    const s = snapshot(inp, ranks);
+    return s ? base.dps - s.dps : 0;
+  });
+}
+
+const sameInputs = (a: InsightInputs, b: InsightInputs): boolean =>
+  a.rotation === b.rotation &&
+  (Object.keys(a.calc) as (keyof CalcInput)[]).every((k) => a.calc[k] === b.calc[k]) &&
+  (Object.keys(a.ch) as (keyof CharInput)[]).every((k) => a.ch[k] === b.ch[k]) &&
+  Object.keys(a.calc).length === Object.keys(b.calc).length &&
+  Object.keys(a.ch).length === Object.keys(b.ch).length;
+
+/**
+ * Memo of the insight numbers for one set of inputs (store references). A new set clears it, so hovering the same
+ * talent twice, or the heat map and the tooltip, evaluate each variant once.
+ */
+export class InsightCache {
+  private inp: InsightInputs | null = null;
+  private base: Snapshot | null = null;
+  private impacts = new Map<number, TalentImpact>();
+  private trees: number[] | null = null;
+
+  private reset(inp: InsightInputs): void {
+    if (this.inp && sameInputs(this.inp, inp)) return;
+    this.inp = inp;
+    this.base = snapshot(inp);
+    this.impacts.clear();
+    this.trees = null;
+  }
+  baseline(inp: InsightInputs): Snapshot | null {
+    this.reset(inp);
+    return this.base;
+  }
+  impact(inp: InsightInputs, nodeId: number): TalentImpact | null {
+    this.reset(inp);
+    if (!this.base) return null;
+    let x = this.impacts.get(nodeId);
+    if (!x) {
+      x = talentImpact(inp, this.base, nodeId);
+      this.impacts.set(nodeId, x);
+    }
+    return x;
+  }
+  has(inp: InsightInputs, nodeId: number): boolean {
+    this.reset(inp);
+    return this.impacts.has(nodeId);
+  }
+  contribution(inp: InsightInputs): number[] | null {
+    this.reset(inp);
+    if (!this.base) return null;
+    this.trees ??= treeContribution(inp, this.base);
+    return this.trees;
+  }
+}
diff --git a/src/ui/stats/useDerived.ts b/src/ui/stats/useDerived.ts
index 770e757..2dd296c 100644
--- a/src/ui/stats/useDerived.ts
+++ b/src/ui/stats/useDerived.ts
@@ -1,11 +1,21 @@
 import { useMemo } from "react";
+import type { SpecRotation } from "@/data/types";
 import { useCalc } from "@/state/store";
 import { useCharacter } from "@/state/character";
 import { useRotation } from "@/state/rotation";
-import { derive, type Derived } from "@/state/derived";
+import { derive, type CalcInput, type CharInput, type Derived } from "@/state/derived";
 
-/** Derived stats for the current talents and character (pure computation, well under 1 ms). */
-export function useDerived(): Derived {
+type Key = readonly unknown[];
+let last: { key: Key; value: Derived } | null = null;
+/** Phase 7: one derive per state change, shared by every panel (each used to run its own). */
+function sharedDerive(key: Key, run: () => Derived): Derived {
+  if (last && last.key.length === key.length && last.key.every((v, i) => v === key[i])) return last.value;
+  last = { key, value: run() };
+  return last.value;
+}
+
+/** The store values derive reads (Phase 7: also the insight inputs). */
+export function useDeriveInputs(): { calc: CalcInput; ch: CharInput; custom: SpecRotation | null; key: Key } {
   const tree = useCalc((s) => s.tree);
   const spells = useCalc((s) => s.spells);
   const pets = useCalc((s) => s.pets);
@@ -21,12 +31,27 @@ export function useDerived(): Derived {
   const pet = useCharacter((s) => s.pet);
   const rotation = useRotation((s) => s.custom);
   return useMemo(
-    () =>
-      derive(
-        { tree, ranks, level, spells, pets },
-        { raceId, weaponIds, bonus, buffIds, target, custom, weapons, pet },
+    () => ({
+      calc: { tree, ranks, level, spells, pets },
+      ch: { raceId, weaponIds, bonus, buffIds, target, custom, weapons, pet },
+      custom: rotation,
+      key: [
+        tree,
+        ranks,
+        level,
+        spells,
+        pets,
+        raceId,
+        weaponIds,
+        bonus,
+        buffIds,
+        target,
+        custom,
+        weapons,
+        pet,
         rotation,
-      ),
+      ],
+    }),
     [
       tree,
       ranks,
@@ -45,3 +70,9 @@ export function useDerived(): Derived {
     ],
   );
 }
+
+/** Derived stats for the current talents and character (pure computation, 1-3 ms, shared by all callers). */
+export function useDerived(): Derived {
+  const { calc, ch, custom, key } = useDeriveInputs();
+  return useMemo(() => sharedDerive(key, () => derive(calc, ch, custom)), [key, calc, ch, custom]);
+}
diff --git a/src/ui/talents/TalentCalculator.module.css b/src/ui/talents/TalentCalculator.module.css
index 11b5b66..f8d019a 100644
--- a/src/ui/talents/TalentCalculator.module.css
+++ b/src/ui/talents/TalentCalculator.module.css
@@ -59,3 +59,14 @@
   text-overflow: ellipsis;
   white-space: nowrap;
 }
+
+.heatToggle {
+  display: block;
+  margin-top: 8px;
+  font-size: 12px;
+  color: var(--text-dim);
+}
+
+.busy {
+  color: var(--grey);
+}
diff --git a/src/ui/talents/TalentCalculator.tsx b/src/ui/talents/TalentCalculator.tsx
index 0ed66b8..43aafb7 100644
--- a/src/ui/talents/TalentCalculator.tsx
+++ b/src/ui/talents/TalentCalculator.tsx
@@ -1,4 +1,4 @@
-import { useEffect } from "react";
+import { useEffect, useState } from "react";
 import { useCalc } from "@/state/store";
 import { WowIcon } from "@/ui/common/WowIcon";
 import { useMediaQuery } from "@/ui/common/useMediaQuery";
@@ -7,6 +7,7 @@ import { PointsSummary } from "./PointsSummary";
 import { TalentTooltip } from "./TalentTooltip";
 import { TalentTree } from "./TalentTree";
 import { useTooltip } from "./tooltipStore";
+import { useHeatmap, useTreeContribution } from "./useInsight";
 import { pointsInSpec } from "@/engine/talents";
 import styles from "./TalentCalculator.module.css";
 
@@ -20,6 +21,9 @@ export function TalentCalculator() {
   const setActiveSpec = useCalc((s) => s.setActiveSpec);
   const desktop = useMediaQuery("(min-width: 980px)");
   const closeTooltip = useTooltip((s) => s.close);
+  const [heat, setHeat] = useState(false);
+  const contribution = useTreeContribution();
+  const heatmap = useHeatmap(heat);
 
   useEffect(() => {
     closeTooltip();
@@ -43,6 +47,16 @@ export function TalentCalculator() {
     <div>
       <PointsSummary />
       <StatStrip />
+      <label className={styles.heatToggle}>
+        <input
+          type="checkbox"
+          data-testid="heatmap-toggle"
+          checked={heat}
+          onChange={(e) => setHeat(e.target.checked)}
+        />{" "}
+        Show the DPS of the next point on every talent
+        {heat && !heatmap && <span className={styles.busy}> (computing…)</span>}
+      </label>
       {!desktop && (
         <div className={styles.tabs} role="tablist" aria-label="Talent trees">
           {specs.map((s, i) => (
@@ -65,7 +79,13 @@ export function TalentCalculator() {
       )}
       <div className={desktop ? styles.row : styles.single}>
         {specs.map((s, i) => (
-          <TalentTree key={s.index} specIndex={i} hidden={!desktop && activeSpec !== i} />
+          <TalentTree
+            key={s.index}
+            specIndex={i}
+            hidden={!desktop && activeSpec !== i}
+            contribution={contribution?.[i] ?? null}
+            heatmap={heatmap}
+          />
         ))}
       </div>
       <TalentTooltip />
diff --git a/src/ui/talents/TalentNode.module.css b/src/ui/talents/TalentNode.module.css
index 12c6d78..f81c7aa 100644
--- a/src/ui/talents/TalentNode.module.css
+++ b/src/ui/talents/TalentNode.module.css
@@ -72,3 +72,30 @@
 .node[data-state="maxed"] .badge {
   color: var(--gold);
 }
+
+/* Phase 7 heat map: DPS of the next point, top left of the icon */
+.impact {
+  position: absolute;
+  left: -10px;
+  top: -9px;
+  height: 15px;
+  padding: 0 3px;
+  line-height: 13px;
+  background: var(--badge-bg);
+  border: 1px solid #4a4a4a;
+  border-radius: 3px;
+  font-family: var(--font-sans);
+  font-size: 10px;
+  font-weight: bold;
+  color: var(--grey);
+  pointer-events: none;
+  white-space: nowrap;
+}
+
+.impact[data-sign="pos"] {
+  color: var(--green);
+}
+
+.impact[data-sign="neg"] {
+  color: var(--red);
+}
diff --git a/src/ui/talents/TalentNode.tsx b/src/ui/talents/TalentNode.tsx
index 40c68b3..4c41ec1 100644
--- a/src/ui/talents/TalentNode.tsx
+++ b/src/ui/talents/TalentNode.tsx
@@ -3,6 +3,7 @@ import type { Talent } from "@/data/types";
 import type { NodeState } from "@/engine/talents";
 import { useCalc } from "@/state/store";
 import { WowIcon } from "@/ui/common/WowIcon";
+import { fmtDec1, fmtSigned } from "@/ui/stats/format";
 import { ICON, nodeBox } from "./geometry";
 import { useTooltip } from "./tooltipStore";
 import styles from "./TalentNode.module.css";
@@ -12,6 +13,7 @@ interface Props {
   rank: number;
   state: NodeState;
   canAddNow: boolean;
+  impactDps?: number; // Phase 7 heat map: DPS of the next point
 }
 
 const LONG_PRESS_MS = 500;
@@ -61,7 +63,7 @@ function focusNeighbor(el: HTMLElement, dir: Dir) {
   best?.focus();
 }
 
-export function TalentNode({ talent, rank, state, canAddNow }: Props) {
+export function TalentNode({ talent, rank, state, canAddNow, impactDps }: Props) {
   const addPoint = useCalc((s) => s.addPoint);
   const removePoint = useCalc((s) => s.removePoint);
   const tooltipOpen = useTooltip((s) => s.nodeId === talent.nodeId);
@@ -146,6 +148,16 @@ export function TalentNode({ talent, rank, state, canAddNow }: Props) {
       <span className={styles.iconWrap}>
         <WowIcon name={talent.icon} size={ICON} />
       </span>
+      {impactDps !== undefined && (
+        <span
+          className={styles.impact}
+          data-testid="node-impact"
+          data-sign={Math.abs(impactDps) < 0.05 ? "zero" : impactDps > 0 ? "pos" : "neg"}
+          aria-hidden="true"
+        >
+          {fmtSigned(impactDps, fmtDec1)}
+        </span>
+      )}
       <span className={styles.badge} data-testid="rank">
         {rank}/{talent.maxRank}
       </span>
diff --git a/src/ui/talents/TalentTooltip.module.css b/src/ui/talents/TalentTooltip.module.css
index a48db70..6ba8250 100644
--- a/src/ui/talents/TalentTooltip.module.css
+++ b/src/ui/talents/TalentTooltip.module.css
@@ -43,3 +43,9 @@
 .gap {
   height: 0.8em;
 }
+
+.impact {
+  margin-top: 0.6em;
+  padding-top: 0.4em;
+  border-top: 1px solid #333;
+}
diff --git a/src/ui/talents/TalentTooltip.tsx b/src/ui/talents/TalentTooltip.tsx
index 5782f41..00392a3 100644
--- a/src/ui/talents/TalentTooltip.tsx
+++ b/src/ui/talents/TalentTooltip.tsx
@@ -1,8 +1,12 @@
 import { useLayoutEffect, useMemo, useRef, useState } from "react";
 import { createPortal } from "react-dom";
+import type { Impact } from "@/state/insight";
 import { pointsContext, useCalc } from "@/state/store";
+import { fmtDec1, fmtDec2, fmtInt, fmtSigned } from "@/ui/stats/format";
+import { useDerived } from "@/ui/stats/useDerived";
 import { buildTooltipModel } from "./tooltipModel";
 import { useTooltip } from "./tooltipStore";
+import { insightCache, useInsightInputs } from "./useInsight";
 import { parseWowText } from "./wowText";
 import styles from "./TalentTooltip.module.css";
 
@@ -18,6 +22,30 @@ function WowText({ text }: { text: string }) {
   );
 }
 
+const pctText = (n: number) => fmtSigned(n, fmtDec2) + "%";
+
+/** Phase 7: "Next point: +12.3 DPS (+1.4%)" and the visible stat changes under it. */
+function ImpactLine({ label, x, testId }: { label: string; x: Impact; testId: string }) {
+  const tone = Math.abs(x.dps) < 0.05 ? styles.grey : x.dps > 0 ? styles.green : styles.red;
+  return (
+    <div data-testid={testId}>
+      <span className={styles.white}>{label}: </span>
+      <span className={tone}>
+        {fmtSigned(x.dps, fmtDec1)} DPS ({pctText(x.pct)})
+      </span>
+      {x.stats.length > 0 && (
+        <div className={styles.grey}>
+          {x.stats
+            .slice(0, 4)
+            .map((s) => `${s.format === "pct" ? pctText(s.delta) : fmtSigned(s.delta, fmtInt)} ${s.label}`)
+            .join(" · ")}
+        </div>
+      )}
+      {x.rotation && <div className={styles.grey}>Rotation becomes: {x.rotation}</div>}
+    </div>
+  );
+}
+
 export function TalentTooltip() {
   const nodeId = useTooltip((s) => s.nodeId);
   const anchor = useTooltip((s) => s.anchor);
@@ -26,6 +54,13 @@ export function TalentTooltip() {
   const level = useCalc((s) => s.level);
   const talentedRank = useCalc((s) => s.talentedRank);
   const ref = useRef<HTMLDivElement>(null);
+  const inp = useInsightInputs();
+  const d = useDerived();
+  const impact = useMemo(
+    () => (inp && nodeId !== null ? insightCache.impact(inp, nodeId) : null),
+    [inp, nodeId],
+  );
+  const notModeled = d.ok && nodeId !== null && d.notModeled.some((n) => n.nodeId === nodeId);
   const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
 
   const model = useMemo(() => {
@@ -52,7 +87,7 @@ export function TalentTooltip() {
     }
     top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
     setPos({ left, top });
-  }, [anchor, model]);
+  }, [anchor, model, impact]);
 
   if (!model || !anchor || !anchor.isConnected) return null;
   return createPortal(
@@ -85,6 +120,13 @@ export function TalentTooltip() {
           </div>
         </>
       )}
+      {impact && (impact.next || impact.prev) && (
+        <div className={styles.impact} data-testid="talent-impact">
+          {impact.next && <ImpactLine label="Next point" x={impact.next} testId="impact-next" />}
+          {impact.prev && <ImpactLine label="Last point" x={impact.prev} testId="impact-prev" />}
+          {notModeled && <div className={styles.grey}>Not modeled: its DPS is not counted.</div>}
+        </div>
+      )}
       {model.learnHint && <div className={styles.green}>Click to learn</div>}
     </div>,
     document.body,
diff --git a/src/ui/talents/TalentTree.module.css b/src/ui/talents/TalentTree.module.css
index da0b697..e32521f 100644
--- a/src/ui/talents/TalentTree.module.css
+++ b/src/ui/talents/TalentTree.module.css
@@ -33,6 +33,13 @@
   text-overflow: ellipsis;
 }
 
+.dps {
+  flex: none;
+  color: var(--text-dim);
+  font-size: 11px;
+  white-space: nowrap;
+}
+
 .points {
   color: var(--white);
   font-weight: bold;
diff --git a/src/ui/talents/TalentTree.tsx b/src/ui/talents/TalentTree.tsx
index 80403f0..90719b9 100644
--- a/src/ui/talents/TalentTree.tsx
+++ b/src/ui/talents/TalentTree.tsx
@@ -3,6 +3,7 @@ import { REMOTE_BACKGROUNDS, SPEC_TINTS, specBackgroundUrl } from "@/data/assets
 import { canAdd, nodeState, pointsInSpec } from "@/engine/talents";
 import { pointsContext, useCalc } from "@/state/store";
 import { WowIcon } from "@/ui/common/WowIcon";
+import { fmtDec1, fmtSigned } from "@/ui/stats/format";
 import { PrereqArrows } from "./PrereqArrows";
 import { TREE_H, TREE_W } from "./geometry";
 import { TalentNode } from "./TalentNode";
@@ -11,9 +12,11 @@ import styles from "./TalentTree.module.css";
 interface Props {
   specIndex: number;
   hidden?: boolean;
+  contribution?: number | null; // Phase 7: DPS of this tree's points (null while computing)
+  heatmap?: ReadonlyMap<number, number> | null; // Phase 7: next-point DPS per node
 }
 
-export function TalentTree({ specIndex, hidden }: Props) {
+export function TalentTree({ specIndex, hidden, contribution, heatmap }: Props) {
   const tree = useCalc((s) => s.tree);
   const ranks = useCalc((s) => s.ranks);
   const level = useCalc((s) => s.level);
@@ -49,6 +52,15 @@ export function TalentTree({ specIndex, hidden }: Props) {
       <header className={styles.header}>
         <WowIcon name={info?.icon ?? null} size={20} />
         <span className={styles.specName}>{spec.name}</span>
+        {points > 0 && contribution != null && (
+          <span
+            className={styles.dps}
+            data-testid={`spec-dps-${specIndex}`}
+            title={`DPS from the ${spec.name} points: current DPS minus the DPS without them (same rotation)`}
+          >
+            {fmtSigned(contribution, fmtDec1)} DPS
+          </span>
+        )}
         <span className={styles.points} data-testid={`spec-points-${specIndex}`}>
           {points}
         </span>
@@ -106,7 +118,7 @@ export function TalentTree({ specIndex, hidden }: Props) {
         <div className={styles.shade} />
         <PrereqArrows spec={spec} ranks={ranks} />
         {nodes.map((n) => (
-          <TalentNode key={n.talent.nodeId} {...n} />
+          <TalentNode key={n.talent.nodeId} {...n} impactDps={heatmap?.get(n.talent.nodeId)} />
         ))}
       </div>
     </section>
diff --git a/src/ui/talents/useInsight.ts b/src/ui/talents/useInsight.ts
new file mode 100644
index 0000000..a8043be
--- /dev/null
+++ b/src/ui/talents/useInsight.ts
@@ -0,0 +1,65 @@
+import { useEffect, useMemo, useState } from "react";
+import { InsightCache, type InsightInputs } from "@/state/insight";
+import { useDeriveInputs } from "@/ui/stats/useDerived";
+
+/** One cache for the tooltip, the tree totals and the heat map (cleared when any input changes). */
+export const insightCache = new InsightCache();
+
+/** The current inputs of derive (null until the damage engine can run: class spells loaded, a race chosen). */
+export function useInsightInputs(): InsightInputs | null {
+  const { calc, ch, custom } = useDeriveInputs();
+  const ready = calc.tree !== null && calc.spells !== null && ch.raceId !== 0;
+  return useMemo(() => (ready ? { calc, ch, rotation: custom } : null), [ready, calc, ch, custom]);
+}
+
+type IdleHandle = { cancel(): void };
+/** requestIdleCallback when the browser has it (not Safari), else a 0 ms timeout. */
+export function onIdle(fn: () => void): IdleHandle {
+  const w = window as Window & {
+    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
+    cancelIdleCallback?: (id: number) => void;
+  };
+  if (w.requestIdleCallback && w.cancelIdleCallback) {
+    const id = w.requestIdleCallback(fn, { timeout: 500 });
+    return { cancel: () => w.cancelIdleCallback!(id) };
+  }
+  const id = window.setTimeout(fn, 0);
+  return { cancel: () => window.clearTimeout(id) };
+}
+
+/** DPS of each tree's points, computed when the browser is idle after a change (3 evaluations). */
+export function useTreeContribution(): number[] | null {
+  const inp = useInsightInputs();
+  const [value, setValue] = useState<{ inp: InsightInputs; trees: number[] | null } | null>(null);
+  useEffect(() => {
+    if (!inp) return;
+    const h = onIdle(() => setValue({ inp, trees: insightCache.contribution(inp) }));
+    return () => h.cancel();
+  }, [inp]);
+  return value && value.inp === inp ? value.trees : null;
+}
+
+const BATCH = 6; // talents per idle callback (~6 x 2 evaluations, under 10 ms)
+
+/** Heat map: next-point DPS of every talent, computed in idle batches; null while off or not ready. */
+export function useHeatmap(on: boolean): ReadonlyMap<number, number> | null {
+  const inp = useInsightInputs();
+  const [value, setValue] = useState<{ inp: InsightInputs; map: Map<number, number> } | null>(null);
+  useEffect(() => {
+    if (!on || !inp || !inp.calc.tree) return;
+    const ids = [...inp.calc.tree.order];
+    const map = new Map<number, number>();
+    let h: IdleHandle | null = null;
+    const step = () => {
+      for (const id of ids.splice(0, BATCH)) {
+        const x = insightCache.impact(inp, id);
+        if (x?.next) map.set(id, x.next.dps);
+      }
+      if (ids.length) h = onIdle(step);
+      else setValue({ inp, map });
+    };
+    h = onIdle(step);
+    return () => h?.cancel();
+  }, [on, inp]);
+  return on && value && value.inp === inp ? value.map : null;
+}
````

### 6.4 D: stat weights (task T5)

Files: `src/engine/sim/{run,types,worker,index}.ts`, new `src/engine/sim/weights.ts` + test, `src/state/sim.ts` (`createSimWorker`), new `src/state/{weights,weightsSim}.ts` + `weights.test.ts`, `src/state/perf.test.ts` (Phase 7 budgets), new `src/ui/results/WeightsPanel.tsx`, `DamagePanel.module.css`, `src/App.tsx`, `e2e/weights.spec.ts`.

````diff
diff --git a/e2e/weights.spec.ts b/e2e/weights.spec.ts
new file mode 100644
index 0000000..6763295
--- /dev/null
+++ b/e2e/weights.spec.ts
@@ -0,0 +1,23 @@
+import { expect, test } from "@playwright/test";
+import { GOLDEN, blockRemoteImages, watchErrors } from "./helpers";
+
+test.beforeEach(async ({ page }) => {
+  await blockRemoteImages(page);
+});
+
+test("stat weights: analytical EP when opened, simulated weights on demand", async ({ page }) => {
+  const w = watchErrors(page);
+  await page.goto(`./${GOLDEN}`);
+  await expect(page.getByTestId("dps-total")).toBeVisible();
+  await expect(page.getByTestId("weights-table")).toHaveCount(0); // nothing computed while closed
+  await page.getByText("Stat weights", { exact: true }).click();
+  const table = page.getByTestId("weights-table");
+  await expect(table).toBeVisible();
+  await expect(page.getByTestId("weight-spellPower").getByTestId("weight-ep")).toHaveText("1.00");
+  await expect(page.getByTestId("weight-spellHit")).toContainText("up to the cap");
+  await page.getByTestId("sim-iterations").fill("50");
+  await page.getByTestId("weights-sim-run").click();
+  await expect(table.getByRole("columnheader", { name: "Sim EP" })).toBeVisible({ timeout: 30_000 });
+  await expect(page.getByTestId("weight-spellPower")).toContainText("±");
+  w.check();
+});
diff --git a/src/App.tsx b/src/App.tsx
index 7af1182..529301b 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -3,6 +3,7 @@ import { DATA_BUILD, manifest } from "@/data";
 import { useCalc } from "@/state/store";
 import { CharacterPanel } from "@/ui/character/CharacterPanel";
 import { DamagePanel } from "@/ui/results/DamagePanel";
+import { WeightsPanel } from "@/ui/results/WeightsPanel";
 import { useMediaQuery } from "@/ui/common/useMediaQuery";
 import { RotationEditor } from "@/ui/rotation/RotationEditor";
 import { SimPanel } from "@/ui/sim/SimPanel";
@@ -57,6 +58,7 @@ export function App() {
             <StatsPanel />
           </div>
           <DamagePanel />
+          <WeightsPanel />
           <div className={styles.panels}>
             <RotationEditor />
             <SimPanel />
@@ -65,7 +67,12 @@ export function App() {
       )}
       {classToken && status === "ready" && !desktop && section === "Gear" && <CharacterPanel />}
       {classToken && status === "ready" && !desktop && section === "Stats" && <StatsPanel />}
-      {classToken && status === "ready" && !desktop && section === "Damage" && <DamagePanel />}
+      {classToken && status === "ready" && !desktop && section === "Damage" && (
+        <>
+          <DamagePanel />
+          <WeightsPanel />
+        </>
+      )}
       {classToken && status === "ready" && !desktop && section === "Sim" && (
         <>
           <RotationEditor />
diff --git a/src/engine/sim/index.ts b/src/engine/sim/index.ts
index 283d262..3d50c38 100644
--- a/src/engine/sim/index.ts
+++ b/src/engine/sim/index.ts
@@ -5,3 +5,4 @@ export * from "./model";
 export * from "./petModel";
 export * from "./engine";
 export * from "./run";
+export * from "./weights";
diff --git a/src/engine/sim/run.ts b/src/engine/sim/run.ts
index a921013..44fc064 100644
--- a/src/engine/sim/run.ts
+++ b/src/engine/sim/run.ts
@@ -41,6 +41,27 @@ export interface RunOptions {
 export const petIterationSeed = (seed: number, i: number): number =>
   splitmix32((iterationSeed(seed, i) ^ PET_STREAM) >>> 0)();
 
+/**
+ * Phase 7: total DPS (player + pet) of every iteration, nothing else (stat weights). Iteration i uses the same seeded
+ * streams as runSim, so `runDpsSamples(x, c)` has the mean of `runSim(x, c).dps` and two inputs with the same seed
+ * share their random numbers (paired differences).
+ */
+export function runDpsSamples(input: SimInput, config: SimConfig): Float64Array {
+  const model = buildModel(input);
+  const petModel = buildPetModel(input, model);
+  const n = Math.max(1, Math.floor(config.iterations));
+  const acc: Accumulator = new Map();
+  const out = new Float64Array(n);
+  for (let i = 0; i < n; i++) {
+    const r = new Fight(model, config, createRng(iterationSeed(config.seed, i)), acc, null).run();
+    const pet = petModel
+      ? new Fight(petModel, config, createRng(petIterationSeed(config.seed, i)), acc, null).run().damage
+      : 0;
+    out[i] = (r.damage + pet) / config.fightSec;
+  }
+  return out;
+}
+
 export function runSim(input: SimInput, config: SimConfig, opts: RunOptions = {}): SimResult {
   const t0 = globalThis.performance.now();
   const model = buildModel(input);
diff --git a/src/engine/sim/types.ts b/src/engine/sim/types.ts
index ec52970..411a8bb 100644
--- a/src/engine/sim/types.ts
+++ b/src/engine/sim/types.ts
@@ -3,6 +3,7 @@ import type { PowerKind } from "@/engine/abilities";
 import type { PetSetup } from "@/engine/pets";
 import type { PrepareArgs } from "@/engine/rotation";
 import type { TargetInput } from "@/engine/stats";
+import type { SimWeightsRequest, SimWeightsResult } from "./weights";
 
 /** Everything one simulation needs; plain data, so it can be posted to the worker (structured clone). */
 export interface SimInput {
@@ -77,8 +78,11 @@ export interface SimResult {
   elapsedMs: number;
 }
 
-export type SimRequest = { type: "run"; id: number; input: SimInput; config: SimConfig };
+export type SimRequest =
+  | { type: "run"; id: number; input: SimInput; config: SimConfig }
+  | { type: "weights"; id: number; request: SimWeightsRequest }; // Phase 7
 export type SimResponse =
   | { type: "progress"; id: number; done: number; total: number }
   | { type: "result"; id: number; result: SimResult }
+  | { type: "weights"; id: number; result: SimWeightsResult } // Phase 7
   | { type: "error"; id: number; message: string };
diff --git a/src/engine/sim/weights.test.ts b/src/engine/sim/weights.test.ts
new file mode 100644
index 0000000..5ccc96d
--- /dev/null
+++ b/src/engine/sim/weights.test.ts
@@ -0,0 +1,58 @@
+// Phase 7: simulation stat weights (paired iterations, common random numbers).
+import { describe, expect, it } from "vitest";
+import { simInput } from "@/testkit/sim";
+import { weapon } from "@/testkit/stats";
+import { runDpsSamples, runSim, summarize } from "./run";
+import { DEFAULT_SIM_CONFIG } from "./types";
+import { simWeights } from "./weights";
+
+const config = { ...DEFAULT_SIM_CONFIG, iterations: 500, logLimit: 0 };
+
+describe("simWeights", () => {
+  it("W1 in the simulator: Frostbolt mage, spell power and crit within 3% of the analytical weights", () => {
+    const input = simInput({ classToken: "mage", race: "HUMAN", rotation: "mage-frost" });
+    const r = simWeights({
+      input,
+      patches: { base: {}, spellPower: { spellPower: 25 }, spellCrit: { spellCrit: 1 } },
+      pairs: [
+        { id: "spellPower", from: "base", to: "spellPower", per: 25 },
+        { id: "spellCrit", from: "base", to: "spellCrit", per: 1 },
+      ],
+      config,
+    });
+    expect(r.runs).toBe(3);
+    expect(r.base.mean / 125.570458 - 1).toBeLessThan(0.03);
+    const sp = r.pairs.find((p) => p.id === "spellPower")!.delta;
+    expect(Math.abs(sp.mean / 0.21518811 - 1)).toBeLessThan(0.03);
+    expect((sp.ci95[1] - sp.ci95[0]) / 2).toBeLessThan(0.01);
+    const crit = r.pairs.find((p) => p.id === "spellCrit")!.delta;
+    expect(Math.abs(crit.mean / 0.61765833 - 1)).toBeLessThan(0.1);
+  });
+  it("is deterministic; the base equals runSim; paired CIs are narrower than independent ones", () => {
+    const input = simInput({
+      classToken: "warrior",
+      race: "HUMAN",
+      talents: { Cruelty: 5, Flurry: 5 },
+      weapons: { mainHand: weapon(12784) },
+    });
+    const req = {
+      input,
+      patches: { base: {}, attackPower: { attackPower: 50 } },
+      pairs: [{ id: "attackPower", from: "base", to: "attackPower", per: 50 }],
+      config,
+    };
+    const a = simWeights(req);
+    const b = simWeights(req);
+    expect({ ...a, elapsedMs: 0 }).toEqual({ ...b, elapsedMs: 0 });
+    expect(a.base.mean).toBeCloseTo(runSim(input, config).dps.mean, 10);
+    const ap = a.pairs[0]!.delta;
+    expect(ap.mean).toBeGreaterThan(0);
+    const other = runDpsSamples(
+      { ...input, prepare: { ...input.prepare, bonus: { ...input.prepare.bonus, attackPower: 50 } } },
+      config,
+    );
+    const indep =
+      (1.96 * Math.hypot(a.base.stdev, summarize(other).stdev)) / Math.sqrt(config.iterations) / 50;
+    expect((ap.ci95[1] - ap.ci95[0]) / 2).toBeLessThan(indep);
+  });
+});
diff --git a/src/engine/sim/weights.ts b/src/engine/sim/weights.ts
new file mode 100644
index 0000000..3ab673a
--- /dev/null
+++ b/src/engine/sim/weights.ts
@@ -0,0 +1,61 @@
+import type { BonusStats } from "@/engine/stats";
+import { runDpsSamples, summarize } from "./run";
+import type { SimConfig, SimInput, Summary } from "./types";
+
+/** One stat-weight measurement: (DPS(to) - DPS(from)) / per, paired per iteration (same seed, same streams). */
+export interface SimWeightPair {
+  id: string;
+  from: string;
+  to: string;
+  per: number;
+}
+export interface SimWeightsRequest {
+  input: SimInput;
+  patches: Record<string, Partial<BonusStats>>; // absolute bonus values per variant; {} = the build itself
+  pairs: SimWeightPair[];
+  config: SimConfig;
+}
+export interface SimWeightsResult {
+  base: Summary; // DPS of the "base" patch (or the first patch)
+  pairs: { id: string; delta: Summary }[]; // per-iteration differences / per: mean and 95% CI
+  iterations: number;
+  runs: number;
+  elapsedMs: number;
+}
+
+/**
+ * Phase 7 simulation weights: every patch is simulated with the same seed, so iteration i of every variant uses the
+ * same random streams (common random numbers). A pair's CI comes from the per-iteration differences, which is far
+ * narrower than comparing two independent means (+50 AP warrior: +-0.38 vs +-0.57 DPS at 1000 iterations).
+ */
+export function simWeights(
+  req: SimWeightsRequest,
+  onProgress?: (done: number, total: number) => void,
+): SimWeightsResult {
+  const t0 = globalThis.performance.now();
+  const keys = Object.keys(req.patches);
+  const samples = new Map<string, Float64Array>();
+  keys.forEach((k, i) => {
+    const input: SimInput = {
+      ...req.input,
+      prepare: { ...req.input.prepare, bonus: { ...req.input.prepare.bonus, ...req.patches[k] } },
+    };
+    samples.set(k, runDpsSamples(input, req.config));
+    onProgress?.(i + 1, keys.length);
+  });
+  const pairs = req.pairs.flatMap((p) => {
+    const a = samples.get(p.from);
+    const b = samples.get(p.to);
+    if (!a || !b) return [];
+    const d = new Float64Array(a.length);
+    for (let i = 0; i < a.length; i++) d[i] = (b[i]! - a[i]!) / p.per;
+    return [{ id: p.id, delta: summarize(d) }];
+  });
+  return {
+    base: summarize(samples.get("base") ?? samples.get(keys[0]!) ?? new Float64Array(0)),
+    pairs,
+    iterations: Math.max(1, Math.floor(req.config.iterations)),
+    runs: keys.length,
+    elapsedMs: globalThis.performance.now() - t0,
+  };
+}
diff --git a/src/engine/sim/worker.ts b/src/engine/sim/worker.ts
index cd4585e..73ce806 100644
--- a/src/engine/sim/worker.ts
+++ b/src/engine/sim/worker.ts
@@ -1,6 +1,7 @@
 // Web Worker entry (section 4.7): plain postMessage, no library. One request at a time; the client cancels a run by
 // terminating the worker.
 import { runSim } from "./run";
+import { simWeights } from "./weights";
 import type { SimRequest, SimResponse } from "./types";
 
 const port = self as unknown as {
@@ -10,11 +11,15 @@ const port = self as unknown as {
 
 port.onmessage = (e) => {
   const req = e.data;
-  if (req.type !== "run") return;
+  const onProgress = (done: number, total: number) =>
+    port.postMessage({ type: "progress", id: req.id, done, total });
   try {
-    const result = runSim(req.input, req.config, {
-      onProgress: (done, total) => port.postMessage({ type: "progress", id: req.id, done, total }),
-    });
+    if (req.type === "weights") {
+      port.postMessage({ type: "weights", id: req.id, result: simWeights(req.request, onProgress) });
+      return;
+    }
+    if (req.type !== "run") return;
+    const result = runSim(req.input, req.config, { onProgress });
     port.postMessage({ type: "result", id: req.id, result });
   } catch (err) {
     port.postMessage({
diff --git a/src/state/perf.test.ts b/src/state/perf.test.ts
index 2058de0..0a82593 100644
--- a/src/state/perf.test.ts
+++ b/src/state/perf.test.ts
@@ -7,6 +7,8 @@ import { petFile } from "@/testkit/pets";
 import { EMPTY_BONUS } from "@/engine/stats";
 import { DEFAULT_CUSTOM, NO_WEAPON_IDS } from "./character";
 import { derive } from "./derived";
+import { InsightCache, snapshot, talentImpact } from "./insight";
+import { statWeights } from "./weights";
 import type { ClassToken } from "@/data/types";
 
 /** Every talent of one spec at max rank (the engine does not enforce point rules): the heaviest realistic load. */
@@ -55,3 +57,46 @@ describe("performance budget (section 10.4)", () => {
     }
   });
 });
+
+describe("Phase 7 insight budgets (Node, after warm-up)", () => {
+  const calc = {
+    tree: treeFor("hunter"),
+    ranks: maxSpec("hunter", 0),
+    level: 60,
+    spells: spellFile("hunter"),
+    pets: petFile("hunter"),
+  };
+  const ch = {
+    raceId: 3,
+    weaponIds: { ...NO_WEAPON_IDS, ranged: 18713, ammo: 18042 },
+    bonus: EMPTY_BONUS,
+    buffIds: [...buffsFile.presets.raidBuffs, ...buffsFile.presets.raidDebuffs],
+    target: "boss" as const,
+    custom: DEFAULT_CUSTOM,
+    weapons: weaponsFile,
+    pet: { family: 2, sacrifice: 0, scaling: true },
+  };
+  const inp = { calc, ch, rotation: null };
+  const time = (n: number, f: () => void) => {
+    for (let i = 0; i < 5; i++) f();
+    const t0 = performance.now();
+    for (let i = 0; i < n; i++) f();
+    return (performance.now() - t0) / n;
+  };
+  it("BM hunter + Cat: one talent tooltip < 4 ms, stat weights < 60 ms, heat map of 3 trees < 150 ms", () => {
+    const base = snapshot(inp)!;
+    const id = calc.tree.order[0]!;
+    const tooltip = time(20, () => talentImpact(inp, base, id));
+    const weights = time(5, () => statWeights(inp));
+    const heat = time(2, () => {
+      const cache = new InsightCache();
+      for (const n of calc.tree.order) cache.impact({ ...inp, calc: { ...calc } }, n);
+    });
+    console.log(
+      `tooltip ${tooltip.toFixed(2)} ms, weights ${weights.toFixed(1)} ms, heat map ${heat.toFixed(0)} ms`,
+    );
+    expect(tooltip).toBeLessThan(4);
+    expect(weights).toBeLessThan(60);
+    expect(heat).toBeLessThan(150);
+  });
+});
diff --git a/src/state/sim.ts b/src/state/sim.ts
index d683284..8034afe 100644
--- a/src/state/sim.ts
+++ b/src/state/sim.ts
@@ -10,6 +10,8 @@ export interface SimWorker {
 }
 let factory = (): SimWorker =>
   new Worker(new URL("../engine/sim/worker.ts", import.meta.url), { type: "module" }) as unknown as SimWorker;
+/** A new simulation worker (Phase 7: also used by the stat-weights store). */
+export const createSimWorker = (): SimWorker => factory();
 /** TEST-ONLY: replaces the worker factory. */
 export function setSimWorkerFactory(f: () => SimWorker): void {
   factory = f;
@@ -51,7 +53,7 @@ export const useSim = create<SimState>()((set) => ({
         set({ status: "done", result: m.result, key, done: m.result.config.iterations });
         w.terminate();
         if (worker === w) worker = null;
-      } else {
+      } else if (m.type === "error") {
         set({ status: "error", error: m.message });
         w.terminate();
         if (worker === w) worker = null;
diff --git a/src/state/weights.test.ts b/src/state/weights.test.ts
new file mode 100644
index 0000000..5bc4419
--- /dev/null
+++ b/src/state/weights.test.ts
@@ -0,0 +1,86 @@
+// Phase 7 stat weights. W1 is re-derived by an independent Python script (plan section 9.2).
+import { describe, expect, it } from "vitest";
+import { EMPTY_BONUS } from "@/engine/stats";
+import { spellFile } from "@/testkit/damage";
+import { petFile } from "@/testkit/pets";
+import { weaponsFile } from "@/testkit/stats";
+import { treeFor } from "@/testkit/talents";
+import type { ClassToken } from "@/data/types";
+import { DEFAULT_CUSTOM, NO_WEAPON_IDS } from "./character";
+import type { InsightInputs } from "./insight";
+import { snapshot } from "./insight";
+import { specRotation } from "./rotation";
+import { statWeights, usedJobs, weightJobs } from "./weights";
+
+function inputs(
+  token: ClassToken,
+  raceId: number,
+  weapons = {},
+  rotation = specRotation(token, 0)!,
+): InsightInputs {
+  return {
+    calc: { tree: treeFor(token), ranks: {}, level: 60, spells: spellFile(token), pets: petFile(token) },
+    ch: {
+      raceId,
+      weaponIds: { ...NO_WEAPON_IDS, ...weapons },
+      bonus: EMPTY_BONUS,
+      buffIds: [],
+      target: "boss",
+      custom: DEFAULT_CUSTOM,
+      weapons: weaponsFile,
+      pet: { family: 0, sacrifice: 0, scaling: true },
+    },
+    rotation,
+  };
+}
+
+describe("analytical stat weights", () => {
+  it("W1: Human mage, no talents, Frostbolt only (independent Python check)", () => {
+    const w = statWeights(inputs("mage", 1, {}, specRotation("mage", 2)!))!;
+    expect(w.dps).toBeCloseTo(125.570458, 5);
+    expect(w.reference?.key).toBe("spellPower");
+    const row = (k: string) => w.rows.find((r) => r.def.key === k)!;
+    expect(w.rows.map((r) => r.def.key)).toEqual(["spellPower", "int", "spellHit", "spellCrit", "haste"]);
+    expect(row("spellPower").perPoint).toBeCloseTo(0.21518811, 7);
+    expect(row("spellCrit").perPoint).toBeCloseTo(0.61765833, 7);
+    expect(row("spellCrit").ep).toBeCloseTo(2.870318, 5);
+    expect(row("spellHit").perPoint).toBeCloseTo(1.51289709, 7); // average from 0% to the 16% cap
+    expect(row("spellHit").ep).toBeCloseTo(7.030579, 5);
+    expect(row("spellHit").cap).toMatchObject({ current: 0, cap: 16, above: 0 });
+    expect(row("haste").ep).toBeCloseTo(5.835381, 5);
+    expect(row("int").ep).toBeCloseTo(0.048241, 5);
+  });
+  it("melee hit: the first 1% is suppressed vs a boss, so the weight is the average up to the cap", () => {
+    const inp = inputs("warrior", 1, { mainHand: 12784 });
+    const w = statWeights(inp)!;
+    const hit = w.rows.find((r) => r.def.key === "hit")!;
+    expect(hit.cap).toMatchObject({ current: 0, cap: 9 });
+    const at = (hitBonus: number) => snapshot(inp, inp.calc.ranks, { ...EMPTY_BONUS, hit: hitBonus })!.dps;
+    expect(at(1)).toBeCloseTo(at(0), 10); // suppressed
+    expect(hit.perPoint).toBeCloseTo((at(9) - at(0)) / 9, 10);
+    expect(hit.perPoint!).toBeGreaterThan(0);
+    expect(w.reference?.key).toBe("attackPower");
+    expect(w.rows.find((r) => r.def.key === "str")!.ep).toBeCloseTo(2, 6); // 1 Str = 2 AP for warriors
+  });
+  it("hunters: +AP also adds ranged AP, so ranged AP is the reference (tie goes to the specific stat)", () => {
+    const w = statWeights(inputs("hunter", 3, { ranged: 18713, ammo: 18042 }))!;
+    expect(w.reference?.key).toBe("rangedAttackPower");
+    expect(w.rows.find((r) => r.def.key === "rangedAttackPower")!.ep).toBe(1);
+  });
+  it("jobs: every stat measured; the weights keep the patches their rows use", () => {
+    const inp = inputs("mage", 1, {}, specRotation("mage", 2)!);
+    const all = weightJobs(inp);
+    expect(all.pairs.find((p) => p.id === "spellHit")).toEqual({
+      id: "spellHit",
+      from: "base",
+      to: "spellHit:cap",
+      per: 16,
+    });
+    expect(all.patches["spellHit:cap+1"]).toEqual({ spellHit: 17 });
+    const w = statWeights(inp)!;
+    expect(Object.keys(w.jobs.patches).sort()).toEqual(
+      ["base", "haste", "int", "spellCrit", "spellHit:cap", "spellHit:cap+1", "spellPower"].sort(),
+    );
+    expect(usedJobs(all, new Set(["haste"])).patches).toEqual({ base: {}, haste: { haste: 1 } });
+  });
+});
diff --git a/src/state/weights.ts b/src/state/weights.ts
new file mode 100644
index 0000000..d71d991
--- /dev/null
+++ b/src/state/weights.ts
@@ -0,0 +1,185 @@
+import type { MagicSchool } from "@/data/types";
+import type { BonusStats } from "@/engine/stats";
+import { derive } from "./derived";
+import type { InsightInputs } from "./insight";
+
+/**
+ * Phase 7 stat weights (EP): DPS per point of each stat, from paired evaluations of the same build with more of one
+ * bonus stat. Analytical by default; the same jobs (bonus patches and pairs) drive the simulation weights in the worker.
+ */
+export type WeightKey = keyof BonusStats;
+export interface WeightDef {
+  key: WeightKey;
+  label: string;
+  step: number; // points (percent points for pct stats) added for the measurement
+  pct: boolean;
+  school?: MagicSchool;
+  hitOf?: "melee" | "spell"; // hit stats: measured below and above the hit cap
+}
+const school = (s: MagicSchool, label: string): WeightDef => ({
+  key: `${s}SpellPower` as WeightKey,
+  label: `${label} spell power`,
+  step: 25,
+  pct: false,
+  school: s,
+});
+/** Stats in display order. Power stats first: the reference stat is one of them. */
+export const WEIGHT_STATS: readonly WeightDef[] = [
+  { key: "attackPower", label: "Attack power", step: 50, pct: false },
+  { key: "rangedAttackPower", label: "Ranged attack power", step: 50, pct: false },
+  { key: "spellPower", label: "Spell power", step: 25, pct: false },
+  school("holy", "Holy"),
+  school("fire", "Fire"),
+  school("nature", "Nature"),
+  school("frost", "Frost"),
+  school("shadow", "Shadow"),
+  school("arcane", "Arcane"),
+  { key: "str", label: "Strength", step: 25, pct: false },
+  { key: "agi", label: "Agility", step: 25, pct: false },
+  { key: "int", label: "Intellect", step: 25, pct: false },
+  { key: "hit", label: "Hit", step: 1, pct: true, hitOf: "melee" },
+  { key: "spellHit", label: "Spell hit", step: 1, pct: true, hitOf: "spell" },
+  { key: "crit", label: "Crit", step: 1, pct: true },
+  { key: "spellCrit", label: "Spell crit", step: 1, pct: true },
+  { key: "haste", label: "Haste", step: 1, pct: true },
+  { key: "weaponSkill", label: "Weapon skill", step: 5, pct: false },
+];
+const POWER: readonly WeightKey[] = ["attackPower", "rangedAttackPower", "spellPower"];
+
+/** A measurement: (DPS(to) - DPS(from)) / per. Patches are absolute bonus values; "base" is the build itself. */
+export interface WeightPair {
+  id: string; // stat key, or "<key>:above" for hit above the cap
+  from: string;
+  to: string;
+  per: number;
+}
+export interface HitState {
+  current: number; // hit on the character sheet (hunters: ranged hit)
+  cap: number; // hit needed vs the selected target (TargetView hitCap)
+}
+export interface WeightJobs {
+  patches: Record<string, Partial<BonusStats>>;
+  pairs: WeightPair[];
+  hits: Partial<Record<"melee" | "spell", HitState>>;
+}
+
+export interface WeightRow {
+  def: WeightDef;
+  perPoint: number | null; // DPS per point (per 1%); hit: average per 1% from your hit to the cap (null at the cap)
+  ep: number | null; // perPoint / reference perPoint
+  cap?: { current: number; cap: number; above: number; aboveEp: number | null }; // hit stats
+}
+export interface Weights {
+  dps: number;
+  reference: WeightDef | null; // the power stat with the most DPS per point
+  rows: WeightRow[]; // stats that change the DPS
+  jobs: WeightJobs; // the measurements of `rows` (for the simulation)
+}
+
+/** Hit now and the hit caps vs the selected target. */
+function hitStates(inp: InsightInputs): WeightJobs["hits"] {
+  const d = derive(inp.calc, inp.ch, inp.rotation, { reference: false });
+  if (!d.ok) return {};
+  const ranged = d.stats.classToken === "hunter" && d.stats.hit.ranged !== null && d.view.ranged !== null;
+  const o = ranged ? d.view.ranged : d.view.mainHand;
+  return {
+    spell: { current: d.stats.hit.spell.value, cap: d.view.spell.hitCap },
+    ...(o
+      ? { melee: { current: ranged ? d.stats.hit.ranged!.value : d.stats.hit.mainHand.value, cap: o.hitCap } }
+      : {}),
+  };
+}
+
+/** All measurements for the current build (every stat; statWeights keeps those that change the DPS). */
+export function weightJobs(inp: InsightInputs): WeightJobs {
+  const b = inp.ch.bonus;
+  const patches: Record<string, Partial<BonusStats>> = { base: {} };
+  const pairs: WeightPair[] = [];
+  const hits = hitStates(inp);
+  for (const def of WEIGHT_STATS) {
+    const k = def.key;
+    if (!def.hitOf) {
+      patches[k] = { [k]: b[k] + def.step };
+      pairs.push({ id: k, from: "base", to: k, per: def.step });
+      continue;
+    }
+    const h = hits[def.hitOf];
+    if (!h) continue;
+    const gap = Math.round((h.cap - h.current) * 100) / 100;
+    if (gap > 0) {
+      patches[`${k}:cap`] = { [k]: b[k] + gap };
+      patches[`${k}:cap+1`] = { [k]: b[k] + gap + 1 };
+      pairs.push({ id: k, from: "base", to: `${k}:cap`, per: gap });
+      pairs.push({ id: `${k}:above`, from: `${k}:cap`, to: `${k}:cap+1`, per: 1 });
+    } else {
+      patches[`${k}:cap+1`] = { [k]: b[k] + 1 };
+      pairs.push({ id: `${k}:above`, from: "base", to: `${k}:cap+1`, per: 1 });
+    }
+  }
+  return { patches, pairs, hits };
+}
+
+/** Keeps the patches the pairs use. */
+export function usedJobs(jobs: WeightJobs, ids: ReadonlySet<string>): WeightJobs {
+  const pairs = jobs.pairs.filter((p) => ids.has(p.id));
+  const keys = new Set(pairs.flatMap((p) => [p.from, p.to]));
+  return {
+    pairs,
+    patches: Object.fromEntries(Object.entries(jobs.patches).filter(([k]) => keys.has(k))),
+    hits: jobs.hits,
+  };
+}
+
+/**
+ * Rows from measured pair values (analytical, or simulated means): stats that change the DPS, EP relative to the
+ * power stat with the most DPS per point. One school's spell power alone is the same as Spell power and is dropped.
+ */
+export function weightRows(
+  jobs: WeightJobs,
+  value: (pairId: string) => number | undefined,
+  eps = 1e-6,
+): { reference: WeightDef | null; rows: WeightRow[] } {
+  const raw = WEIGHT_STATS.map((def) => ({
+    def,
+    per: value(def.key) ?? null,
+    above: value(`${def.key}:above`) ?? null,
+  })).filter((r) => r.per !== null || r.above !== null);
+  const powers = raw.filter((r) => POWER.includes(r.def.key) && (r.per ?? 0) > eps);
+  // Ties go to the later, more specific stat (a hunter's +AP also adds ranged AP: the reference is ranged AP).
+  const reference = powers.reduce<(typeof raw)[number] | null>(
+    (a, r) => (!a || r.per! >= a.per! ? r : a),
+    null,
+  );
+  const refPer = reference?.per ?? null;
+  const epOf = (v: number | null) => (v === null || refPer === null ? null : v / refPer);
+  const schools = raw.filter((r) => r.def.school && Math.abs(r.per ?? 0) > eps);
+  const rows: WeightRow[] = raw
+    .filter((r) => Math.abs(r.per ?? 0) > eps || Math.abs(r.above ?? 0) > eps)
+    .filter((r) => !r.def.school || schools.length > 1) // one school: the same as Spell power
+    .map((r) => ({
+      def: r.def,
+      perPoint: r.per,
+      ep: epOf(r.per),
+      ...(r.def.hitOf && jobs.hits[r.def.hitOf]
+        ? { cap: { ...jobs.hits[r.def.hitOf]!, above: r.above ?? 0, aboveEp: epOf(r.above ?? 0) } }
+        : {}),
+    }));
+  return { reference: reference?.def ?? null, rows };
+}
+
+/** Analytical stat weights (one light derive per patch: about 20 x 0.3-0.8 ms). Null without damage. */
+export function statWeights(inp: InsightInputs): Weights | null {
+  const jobs = weightJobs(inp);
+  const dps: Record<string, number> = {};
+  for (const [k, patch] of Object.entries(jobs.patches)) {
+    const d = derive(inp.calc, { ...inp.ch, bonus: { ...inp.ch.bonus, ...patch } }, inp.rotation, {
+      reference: false,
+    });
+    if (!d.ok || !d.damage) return null;
+    dps[k] = d.damage.totalDps;
+  }
+  const pairValue = new Map(jobs.pairs.map((p) => [p.id, (dps[p.to]! - dps[p.from]!) / p.per]));
+  const { reference, rows } = weightRows(jobs, (id) => pairValue.get(id));
+  const ids = new Set(rows.flatMap((r) => [r.def.key, `${r.def.key}:above`]));
+  return { dps: dps.base!, reference, rows, jobs: usedJobs(jobs, ids) };
+}
diff --git a/src/state/weightsSim.ts b/src/state/weightsSim.ts
new file mode 100644
index 0000000..ccfdd27
--- /dev/null
+++ b/src/state/weightsSim.ts
@@ -0,0 +1,61 @@
+import { create } from "zustand";
+import type { SimWeightsRequest, SimWeightsResult } from "@/engine/sim/weights";
+import { createSimWorker, type SimWorker } from "./sim";
+
+export interface WeightsSimState {
+  status: "idle" | "running" | "done" | "cancelled" | "error";
+  done: number; // simulated variants
+  total: number;
+  result: SimWeightsResult | null;
+  error: string | null;
+  key: string | null; // inputs of `result` (the panel hides a result whose inputs changed)
+  run(request: SimWeightsRequest, key: string): void;
+  cancel(): void;
+}
+
+let worker: SimWorker | null = null;
+let requestId = 0;
+
+/** Phase 7: simulation stat weights in their own worker (same protocol as useSim, message type "weights"). */
+export const useWeightsSim = create<WeightsSimState>()((set) => ({
+  status: "idle",
+  done: 0,
+  total: 0,
+  result: null,
+  error: null,
+  key: null,
+  run(request, key) {
+    worker?.terminate();
+    const id = ++requestId;
+    const w = createSimWorker();
+    worker = w;
+    set({ status: "running", done: 0, total: Object.keys(request.patches).length, error: null });
+    const finish = () => {
+      w.terminate();
+      if (worker === w) worker = null;
+    };
+    w.onmessage = (e) => {
+      const m = e.data;
+      if (m.id !== id || id !== requestId) return;
+      if (m.type === "progress") set({ done: m.done, total: m.total });
+      else if (m.type === "weights") {
+        set({ status: "done", result: m.result, key });
+        finish();
+      } else if (m.type === "error") {
+        set({ status: "error", error: m.message });
+        finish();
+      }
+    };
+    w.onerror = (e) => {
+      if (id !== requestId) return;
+      set({ status: "error", error: e.message || "The simulation worker failed." });
+    };
+    w.postMessage({ type: "weights", id, request });
+  },
+  cancel() {
+    requestId++;
+    worker?.terminate();
+    worker = null;
+    set({ status: "cancelled" });
+  },
+}));
diff --git a/src/ui/results/DamagePanel.module.css b/src/ui/results/DamagePanel.module.css
index 85bc5ad..1273c2e 100644
--- a/src/ui/results/DamagePanel.module.css
+++ b/src/ui/results/DamagePanel.module.css
@@ -101,3 +101,29 @@
   font-size: 20px;
   font-weight: bold;
 }
+
+/* Phase 7: collapsible panels (stat weights, compare) */
+.summaryToggle {
+  cursor: pointer;
+  color: var(--gold);
+}
+
+.summaryToggle:focus-visible {
+  outline: 2px solid var(--focus);
+  outline-offset: 2px;
+}
+
+.titleInline {
+  display: inline;
+  margin: 0;
+  color: var(--gold);
+  font-size: 20px;
+}
+
+.actionsRow {
+  display: flex;
+  flex-wrap: wrap;
+  align-items: center;
+  gap: 8px;
+  margin-top: 8px;
+}
diff --git a/src/ui/results/WeightsPanel.tsx b/src/ui/results/WeightsPanel.tsx
new file mode 100644
index 0000000..2a5e557
--- /dev/null
+++ b/src/ui/results/WeightsPanel.tsx
@@ -0,0 +1,173 @@
+import { useEffect, useMemo, useState } from "react";
+import { targetsFile } from "@/data";
+import { DEFAULT_SIM_CONFIG } from "@/engine/sim/types";
+import { simInputFor } from "@/state/derived";
+import type { InsightInputs } from "@/state/insight";
+import { useRotation } from "@/state/rotation";
+import { statWeights, type WeightRow, type Weights } from "@/state/weights";
+import { useWeightsSim } from "@/state/weightsSim";
+import { fmtDec2, fmtPct } from "@/ui/stats/format";
+import { onIdle, useInsightInputs } from "@/ui/talents/useInsight";
+import styles from "./DamagePanel.module.css";
+
+const fmt3 = (n: number) => n.toFixed(3);
+
+/** Everything the weights depend on, as text (a simulated result whose key differs is stale). */
+function inputKey(inp: InsightInputs | null, sim: object): string {
+  if (!inp) return "";
+  const { calc, ch } = inp;
+  return JSON.stringify([
+    calc.tree?.token,
+    calc.ranks,
+    calc.level,
+    ch.raceId,
+    ch.weaponIds,
+    ch.bonus,
+    ch.buffIds,
+    ch.target,
+    ch.custom,
+    ch.pet,
+    inp.rotation,
+    sim,
+  ]);
+}
+
+interface Line {
+  id: string; // pair id
+  label: string;
+  per: number;
+  ep: number | null;
+  unit: string;
+}
+function lines(rows: readonly WeightRow[]): Line[] {
+  return rows.flatMap((r) => {
+    const unit = r.def.pct ? "per 1%" : "per point";
+    const out: Line[] = [];
+    if (r.perPoint !== null)
+      out.push({
+        id: r.def.key,
+        label: r.cap
+          ? `${r.def.label} up to the cap (${fmtPct(r.cap.current)} of ${fmtPct(r.cap.cap)})`
+          : r.def.label,
+        per: r.perPoint,
+        ep: r.ep,
+        unit,
+      });
+    if (r.cap && (r.cap.above !== 0 || r.perPoint === null))
+      out.push({
+        id: `${r.def.key}:above`,
+        label: `${r.def.label} above the cap`,
+        per: r.cap.above,
+        ep: r.cap.aboveEp,
+        unit,
+      });
+    return out;
+  });
+}
+
+/**
+ * Phase 7: stat weights (EP) of the current build vs the selected target. Computed only while the section is open:
+ * analytical at once (about 20 evaluations), simulated on demand in a worker with the Simulation panel's settings.
+ */
+export function WeightsPanel() {
+  const inp = useInsightInputs();
+  const sim = useRotation((s) => s.sim);
+  const ws = useWeightsSim();
+  const [open, setOpen] = useState(false);
+  const [state, setState] = useState<{ inp: InsightInputs; w: Weights | null } | null>(null);
+  useEffect(() => {
+    if (!open || !inp) return;
+    const h = onIdle(() => setState({ inp, w: statWeights(inp) }));
+    return () => h.cancel();
+  }, [open, inp]);
+  const w = state && state.inp === inp ? state.w : null;
+  const key = useMemo(() => inputKey(inp, sim), [inp, sim]);
+  const target = targetsFile.presets.find((p) => p.id === inp?.ch.target)?.label ?? "the target";
+  const simResult = ws.result && ws.key === key ? ws.result : null;
+  const simPair = new Map(simResult?.pairs.map((p) => [p.id, p.delta]) ?? []);
+  const refSim = w?.reference ? simPair.get(w.reference.key)?.mean : undefined;
+  const running = ws.status === "running";
+
+  const runSim = () => {
+    if (!inp || !w) return;
+    const input = simInputFor(inp.calc, inp.ch, inp.rotation);
+    if (!input) return;
+    ws.run({ input, ...w.jobs, config: { ...DEFAULT_SIM_CONFIG, ...sim, logLimit: 0 } }, key);
+  };
+
+  return (
+    <section className={styles.panel} data-testid="weights-panel" aria-labelledby="weights-title">
+      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
+        <summary className={styles.summaryToggle}>
+          <h2 id="weights-title" className={styles.titleInline}>
+            Stat weights
+          </h2>
+        </summary>
+        {!w && <p className={styles.line}>Computing…</p>}
+        {w && (
+          <>
+            <p className={styles.line}>
+              DPS gained per point of each stat (per 1% for percentages) vs {target}, from the analytical
+              model.
+              {w.reference ? ` EP: relative to ${w.reference.label} = 1.` : ""} Hit is measured up to the hit
+              cap and above it.
+            </p>
+            <table className={styles.table} data-testid="weights-table">
+              <caption>Stat weights (EP)</caption>
+              <thead>
+                <tr>
+                  <th>Stat</th>
+                  <th>DPS</th>
+                  <th>EP</th>
+                  {simResult && <th>Sim DPS (95% CI)</th>}
+                  {simResult && <th>Sim EP</th>}
+                </tr>
+              </thead>
+              <tbody>
+                {lines(w.rows).map((l) => {
+                  const s = simPair.get(l.id);
+                  return (
+                    <tr key={l.id} data-testid={`weight-${l.id.replace(":", "-")}`}>
+                      <td>
+                        {l.label} <span className={styles.unit}>{l.unit}</span>
+                      </td>
+                      <td>{fmt3(l.per)}</td>
+                      <td data-testid="weight-ep">{l.ep === null ? "–" : fmtDec2(l.ep)}</td>
+                      {simResult && (
+                        <td>{s ? `${fmt3(s.mean)} ± ${fmt3((s.ci95[1] - s.ci95[0]) / 2)}` : "–"}</td>
+                      )}
+                      {simResult && <td>{s && refSim ? fmtDec2(s.mean / refSim) : "–"}</td>}
+                    </tr>
+                  );
+                })}
+              </tbody>
+            </table>
+            <div className={styles.actionsRow}>
+              {running ? (
+                <button type="button" data-testid="weights-sim-cancel" onClick={ws.cancel}>
+                  Cancel
+                </button>
+              ) : (
+                <button type="button" data-testid="weights-sim-run" onClick={runSim}>
+                  Simulate weights
+                </button>
+              )}
+              <span className={styles.line}>
+                {Object.keys(w.jobs.patches).length} simulations of {sim.iterations} iterations ×{" "}
+                {sim.fightSec} s, seed {sim.seed}, the same random numbers for every stat (Simulation panel
+                settings)
+              </span>
+              {running && (
+                <span className={styles.line} data-testid="weights-sim-progress">
+                  <progress max={ws.total} value={ws.done} aria-label="Stat weight simulation progress" />{" "}
+                  {ws.done} / {ws.total}
+                </span>
+              )}
+              {ws.status === "error" && <span className={styles.note}>Simulation failed: {ws.error}</span>}
+            </div>
+          </>
+        )}
+      </details>
+    </section>
+  );
+}
````

### 6.5 E: compare builds (task T6)

Files: `src/state/character.ts` (`petFromCode`, `characterFromCode`; `applyPet`/`applyCode` use them), new `src/state/compare.ts` + `compare.test.ts`, `src/state/urlSync.ts`, new `src/ui/results/ComparePanel.tsx`, `DamagePanel.module.css`, `src/App.tsx`, `e2e/compare.spec.ts`.

````diff
diff --git a/e2e/compare.spec.ts b/e2e/compare.spec.ts
new file mode 100644
index 0000000..62f7254
--- /dev/null
+++ b/e2e/compare.spec.ts
@@ -0,0 +1,33 @@
+import { expect, test } from "@playwright/test";
+import { GOLDEN, blockRemoteImages, node, watchErrors } from "./helpers";
+
+test.beforeEach(async ({ page }) => {
+  await blockRemoteImages(page);
+});
+
+test("compare: pin A, edit B, the link carries both, swap and stop", async ({ page }) => {
+  const w = watchErrors(page);
+  await page.goto(`./${GOLDEN}`);
+  await expect(page.getByTestId("dps-total")).toBeVisible();
+  await page.getByTestId("compare-pin").click();
+  await expect.poll(() => new URL(page.url()).hash).toBe(`${GOLDEN}~${GOLDEN.slice(1)}`);
+  await expect(page.getByTestId("compare-dps-delta")).toHaveText("+0.0");
+  await expect(page.getByTestId("compare-talents")).toHaveText("Same talents.");
+  await node(page, "Ignite").click({ button: "right" });
+  await expect(page.getByTestId("compare-dps-delta")).toHaveText(/^−\d+\.\d$/);
+  await expect(page.getByTestId("compare-talents")).toContainText("Ignite: 5 → 4");
+  const hash = new URL(page.url()).hash;
+  expect(hash.split("~")).toHaveLength(2);
+  expect(hash.endsWith(`~${GOLDEN.slice(1)}`)).toBe(true);
+  // The link opens with both builds.
+  await page.goto("about:blank");
+  await page.goto(`./${hash}`);
+  await expect(page.getByTestId("compare-talents")).toContainText("Ignite: 5 → 4");
+  await page.getByTestId("compare-swap").click();
+  await expect(page.getByTestId("compare-talents")).toContainText("Ignite: 4 → 5");
+  await expect(page.getByTestId("compare-dps-delta")).toHaveText(/^\+\d+\.\d$/);
+  await page.getByTestId("compare-clear").click();
+  await expect.poll(() => new URL(page.url()).hash).toBe(GOLDEN);
+  await expect(page.getByTestId("compare-table")).toHaveCount(0);
+  w.check();
+});
diff --git a/src/App.tsx b/src/App.tsx
index 529301b..b03a25a 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -3,6 +3,7 @@ import { DATA_BUILD, manifest } from "@/data";
 import { useCalc } from "@/state/store";
 import { CharacterPanel } from "@/ui/character/CharacterPanel";
 import { DamagePanel } from "@/ui/results/DamagePanel";
+import { ComparePanel } from "@/ui/results/ComparePanel";
 import { WeightsPanel } from "@/ui/results/WeightsPanel";
 import { useMediaQuery } from "@/ui/common/useMediaQuery";
 import { RotationEditor } from "@/ui/rotation/RotationEditor";
@@ -59,6 +60,7 @@ export function App() {
           </div>
           <DamagePanel />
           <WeightsPanel />
+          <ComparePanel />
           <div className={styles.panels}>
             <RotationEditor />
             <SimPanel />
@@ -71,6 +73,7 @@ export function App() {
         <>
           <DamagePanel />
           <WeightsPanel />
+          <ComparePanel />
         </>
       )}
       {classToken && status === "ready" && !desktop && section === "Sim" && (
diff --git a/src/state/character.ts b/src/state/character.ts
index 902e958..4fd8de1 100644
--- a/src/state/character.ts
+++ b/src/state/character.ts
@@ -135,6 +135,58 @@ async function weaponsFor(ids: WeaponIds): Promise<WeaponsFile | null> {
   return null;
 }
 
+/** Phase 7: the pet of a link, checked against pets/<class>.json (pure; applyPet and the compare view use it). */
+export function petFromCode(
+  code: PetChoice | undefined,
+  file: PetFile | null,
+): { pet: PetChoice; ok: boolean } {
+  const c = code ?? NO_PET;
+  const family = file?.pets.some((p) => p.id === c.family) ? c.family : 0;
+  const sacrifice =
+    file?.token === "warlock" && petsManual.sacrifice.some((s) => s.family === c.sacrifice) ? c.sacrifice : 0;
+  return {
+    pet: { family, sacrifice, scaling: c.scaling },
+    ok: family === c.family && sacrifice === c.sacrifice,
+  };
+}
+
+export type CharacterValues = Pick<
+  CharacterState,
+  "raceId" | "bonus" | "buffIds" | "weaponIds" | "target" | "custom"
+>;
+/**
+ * Phase 7: the character of a link (pure; applyCode and the compare view use it). Weapons are checked only when
+ * weapons.json is given (else they are dropped). `ok` is false if something was invalid.
+ */
+export function characterFromCode(
+  code: CharacterCode,
+  token: ClassToken,
+  level: number,
+  file: WeaponsFile | null,
+): { value: CharacterValues; ok: boolean } {
+  const cls = getClassInfo(token);
+  let ok = code.raceId === null || cls.raceIds.includes(code.raceId);
+  const raceId = code.raceId !== null && ok ? code.raceId : cls.raceIds[0]!;
+  const bonus = { ...EMPTY_BONUS };
+  for (const [k, v] of Object.entries(code.bonus))
+    bonus[k as keyof BonusStats] = clampBonus(k as keyof BonusStats, v);
+  const known = buffsFile.buffs.filter((b) => code.buffCodes.includes(b.code));
+  if (known.length !== code.buffCodes.length) ok = false;
+  let buffIds: string[] = [];
+  for (const b of known) buffIds = withBuff(buffIds, b.id);
+  const weaponIds = file ? sanitizeWeapons(code.weapons, file, token, level) : NO_WEAPON_IDS;
+  if (JSON.stringify(weaponIds) !== JSON.stringify(code.weapons)) ok = false;
+  const c = code.target.custom;
+  const custom: CustomTarget = c
+    ? {
+        level: Math.min(63, Math.max(1, c.level)),
+        armor: Math.min(20000, c.armor),
+        resist: c.resist.map((r) => Math.min(1000, r)) as CustomTarget["resist"],
+      }
+    : DEFAULT_CUSTOM;
+  return { value: { raceId, bonus, buffIds, weaponIds, target: code.target.preset, custom }, ok };
+}
+
 export const useCharacter = create<CharacterState>()((set, get) => ({
   raceId: 0,
   weaponIds: NO_WEAPON_IDS,
@@ -151,14 +203,9 @@ export const useCharacter = create<CharacterState>()((set, get) => ({
     set({ pet: { ...get().pet, ...patch } });
   },
   applyPet(code, file) {
-    const c = code ?? NO_PET;
-    const family = file?.pets.some((p) => p.id === c.family) ? c.family : 0;
-    const sacrifice =
-      file?.token === "warlock" && petsManual.sacrifice.some((s) => s.family === c.sacrifice)
-        ? c.sacrifice
-        : 0;
-    set({ pet: { family, sacrifice, scaling: c.scaling } });
-    return family === c.family && sacrifice === c.sacrifice;
+    const { pet, ok } = petFromCode(code, file);
+    set({ pet });
+    return ok;
   },
   setWeapon(slot, id, token, level) {
     const file = get().weapons;
@@ -205,36 +252,9 @@ export const useCharacter = create<CharacterState>()((set, get) => ({
     return kept;
   },
   async applyCode(code, token, level) {
-    const cls = getClassInfo(token);
-    let ok = code.raceId === null || cls.raceIds.includes(code.raceId);
-    const raceId = code.raceId !== null && ok ? code.raceId : cls.raceIds[0]!;
-    const bonus = { ...EMPTY_BONUS };
-    for (const [k, v] of Object.entries(code.bonus))
-      bonus[k as keyof BonusStats] = clampBonus(k as keyof BonusStats, v);
-    const known = buffsFile.buffs.filter((b) => code.buffCodes.includes(b.code));
-    if (known.length !== code.buffCodes.length) ok = false;
-    let buffIds: string[] = [];
-    for (const b of known) buffIds = withBuff(buffIds, b.id);
     const file = await weaponsFor(code.weapons);
-    const weaponIds = file ? sanitizeWeapons(code.weapons, file, token, level) : NO_WEAPON_IDS;
-    if (JSON.stringify(weaponIds) !== JSON.stringify(code.weapons)) ok = false;
-    const c = code.target.custom;
-    const custom: CustomTarget = c
-      ? {
-          level: Math.min(63, Math.max(1, c.level)),
-          armor: Math.min(20000, c.armor),
-          resist: c.resist.map((r) => Math.min(1000, r)) as CustomTarget["resist"],
-        }
-      : DEFAULT_CUSTOM;
-    set({
-      raceId,
-      bonus,
-      buffIds,
-      weaponIds,
-      target: code.target.preset,
-      custom,
-      ...(file ? { weapons: file } : {}),
-    });
+    const { value, ok } = characterFromCode(code, token, level, file);
+    set({ ...value, ...(file ? { weapons: file } : {}) });
     return ok;
   },
   toCode(token) {
diff --git a/src/state/compare.test.ts b/src/state/compare.test.ts
new file mode 100644
index 0000000..5eab344
--- /dev/null
+++ b/src/state/compare.test.ts
@@ -0,0 +1,63 @@
+// Phase 7 compare: the "#B~A" link format, loading a pinned build, talent differences.
+import { describe, expect, it } from "vitest";
+import { isClassToken } from "@/data";
+import { decodeBuild } from "./buildCode";
+import { joinHash, loadBuild, splitHash, talentDiff } from "./compare";
+import { derive } from "./derived";
+import { useCalc } from "./store";
+import { useCharacter } from "./character";
+import { useRotation } from "./rotation";
+
+const MAGE = "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N"; // Fire 33 / Frost 18 (Phase 2 golden)
+const WARRIOR_V2 = "#v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8"; // Phase 3 golden
+
+describe("compare link format", () => {
+  it("joins and splits '#B~A'; links without '~' are unchanged", () => {
+    const h = joinHash(MAGE, WARRIOR_V2);
+    expect(h).toBe(
+      "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N~v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8",
+    );
+    expect(splitHash(h)).toEqual({ build: MAGE, pinned: WARRIOR_V2 });
+    expect(splitHash(MAGE)).toEqual({ build: MAGE, pinned: null });
+    expect(splitHash("")).toEqual({ build: "", pinned: null });
+    expect(joinHash(MAGE, null)).toBe(MAGE);
+    expect(joinHash("", MAGE)).toBe("");
+    for (const part of [splitHash(h).build, splitHash(h).pinned!])
+      expect(decodeBuild(part, isClassToken).ok).toBe(true);
+    expect(decodeBuild(h, isClassToken).ok).toBe(false); // the whole hash is not one build
+  });
+});
+
+describe("loadBuild", () => {
+  it("rebuilds a link's inputs exactly like applying the link to the stores", async () => {
+    for (const hash of [MAGE, WARRIOR_V2, "#v2.hunter.60.0..CAMCAAA", "#v1.mage.30.0"]) {
+      const a = await loadBuild(hash);
+      if (!a) throw new Error(hash);
+      const r = decodeBuild(hash, isClassToken);
+      if (!r.ok) throw new Error(hash);
+      await useCalc.getState().applyBuildCode(r.build);
+      const s = useCalc.getState();
+      const c = useCharacter.getState();
+      const viaStores = derive(
+        { tree: s.tree, ranks: s.ranks, level: s.level, spells: s.spells, pets: s.pets },
+        c,
+        useRotation.getState().custom,
+      );
+      const viaLoad = derive(a.inputs.calc, a.inputs.ch, a.inputs.rotation);
+      if (!viaStores.ok || !viaLoad.ok) throw new Error(hash);
+      expect(viaLoad.damage!.totalDps, hash).toBeCloseTo(viaStores.damage!.totalDps, 10);
+      expect(a.inputs.calc.ranks).toEqual(s.ranks);
+    }
+    expect(await loadBuild("#v9.mage.60.0")).toBeNull();
+  });
+  it("talent differences in tree order; null for different classes", async () => {
+    const a = (await loadBuild(MAGE))!;
+    const b = (await loadBuild("#v1.mage.60.0"))!;
+    const diff = talentDiff(a.tree, a.inputs.calc.ranks, b.tree, b.inputs.calc.ranks)!;
+    expect(diff.reduce((n, c) => n + c.a - c.b, 0)).toBe(51);
+    expect(diff.every((c) => c.b === 0)).toBe(true);
+    expect(diff.map((c) => c.specIndex)).toEqual([...diff.map((c) => c.specIndex)].sort());
+    const w = (await loadBuild(WARRIOR_V2))!;
+    expect(talentDiff(a.tree, a.inputs.calc.ranks, w.tree, w.inputs.calc.ranks)).toBeNull();
+  });
+});
diff --git a/src/state/compare.ts b/src/state/compare.ts
new file mode 100644
index 0000000..87bad67
--- /dev/null
+++ b/src/state/compare.ts
@@ -0,0 +1,103 @@
+import { create } from "zustand";
+import {
+  classesFile,
+  getClassInfo,
+  isClassToken,
+  loadClassSpells,
+  loadPetFile,
+  loadTalentFile,
+  loadWeapons,
+} from "@/data";
+import { buildClassTree, sanitize, type ClassTree, type Ranks } from "@/engine/talents";
+import { decodeBuild, type BuildCode } from "./buildCode";
+import { characterFromCode, petFromCode } from "./character";
+import type { CalcInput, CharInput } from "./derived";
+import type { InsightInputs } from "./insight";
+import { catalogFor, codeToRotation } from "./rotation";
+
+/**
+ * Phase 7 compare: build A is pinned (a build hash), build B is the editor. The URL carries both:
+ * `#<build B>~<build A without '#'>` ("~" is not in any build hash, so older links never contain it).
+ */
+export const COMPARE_SEPARATOR = "~";
+
+/** Splits a location hash into the editor's build and the pinned build (both with "#", pinned null if absent). */
+export function splitHash(hash: string): { build: string; pinned: string | null } {
+  const h = hash.startsWith("#") ? hash.slice(1) : hash;
+  const i = h.indexOf(COMPARE_SEPARATOR);
+  if (i < 0) return { build: hash ? `#${h}` : "", pinned: null };
+  return { build: `#${h.slice(0, i)}`, pinned: `#${h.slice(i + 1)}` };
+}
+/** The location hash for the editor's build and the pinned build. */
+export function joinHash(build: string, pinned: string | null): string {
+  if (!pinned || !build) return build;
+  return build + COMPARE_SEPARATOR + pinned.slice(1);
+}
+
+export interface CompareState {
+  pinned: string | null; // build A as a hash ("#v1..." / "#v2...")
+  pin(hash: string): void;
+  clear(): void;
+}
+export const useCompare = create<CompareState>()((set) => ({
+  pinned: null,
+  pin(hash) {
+    set({ pinned: hash || null });
+  },
+  clear() {
+    set({ pinned: null });
+  },
+}));
+
+/** Build A ready for derive: the stores' inputs, rebuilt from its hash the way a link is applied. */
+export interface LoadedBuild {
+  hash: string;
+  code: BuildCode;
+  tree: ClassTree;
+  inputs: InsightInputs;
+}
+
+/** Loads the class files of a build hash and rebuilds its inputs (null when the hash is not a build). */
+export async function loadBuild(hash: string): Promise<LoadedBuild | null> {
+  const r = decodeBuild(hash, isClassToken);
+  if (!r.ok) return null;
+  const code = r.build;
+  const token = code.classToken;
+  const [file, spells, pets] = await Promise.all([
+    loadTalentFile(token),
+    loadClassSpells(token),
+    loadPetFile(token),
+  ]);
+  const tree = buildClassTree(file, getClassInfo(token));
+  const ctx = { level: code.level, talentedRank: code.talentedRank, currency: classesFile.talentCurrency };
+  const { ranks } = sanitize(tree, code.ranks, ctx);
+  const w = code.character.weapons;
+  const weapons = w.mainHand || w.offHand || w.ranged || w.ammo ? await loadWeapons() : null;
+  const { value } = characterFromCode(code.character, token, code.level, weapons);
+  const { pet } = petFromCode(code.character.pet, pets);
+  const rotation = code.character.rotation
+    ? (codeToRotation(code.character.rotation, token, catalogFor(spells, tree))?.rotation ?? null)
+    : null;
+  const calc: CalcInput = { tree, ranks, level: code.level, spells, pets };
+  const ch: CharInput = { ...value, weapons, pet };
+  return { hash, code, tree, inputs: { calc, ch, rotation } };
+}
+
+export interface TalentChange {
+  nodeId: number;
+  name: string;
+  specIndex: number;
+  a: number;
+  b: number;
+}
+/** Talents whose rank differs between A and B, in tree order (null when the classes differ). */
+export function talentDiff(tree: ClassTree, a: Ranks, otherTree: ClassTree, b: Ranks): TalentChange[] | null {
+  if (tree.token !== otherTree.token) return null;
+  return tree.order.flatMap((id) => {
+    const ra = a[id] ?? 0;
+    const rb = b[id] ?? 0;
+    if (ra === rb) return [];
+    const n = tree.nodes.get(id)!;
+    return [{ nodeId: id, name: n.talent.name, specIndex: n.specIndex, a: ra, b: rb }];
+  });
+}
diff --git a/src/state/urlSync.ts b/src/state/urlSync.ts
index 74144a5..37633b0 100644
--- a/src/state/urlSync.ts
+++ b/src/state/urlSync.ts
@@ -1,17 +1,26 @@
 import { isClassToken } from "@/data";
 import { decodeBuild, encodeBuild } from "./buildCode";
 import { useCharacter } from "./character";
+import { joinHash, splitHash, useCompare } from "./compare";
 import { catalogFor, useRotation } from "./rotation";
 import { useCalc } from "./store";
 
 /** Keeps location.hash and the store in sync. Call once before the first render. */
 export function initUrlSync(): void {
   let lastHash = "";
+  let applying = false; // a link being applied must not write the previous state back to the URL
 
   const apply = (hash: string) => {
-    const r = decodeBuild(hash, isClassToken);
+    // Phase 7: "#<build>~<pinned build>" (compare); links without "~" are unchanged.
+    const { build, pinned } = splitHash(hash);
+    const pinOk = pinned === null || decodeBuild(pinned, isClassToken).ok;
+    applying = true;
+    useCompare.setState({ pinned: pinOk ? pinned : null });
+    applying = false;
+    const r = decodeBuild(build, isClassToken);
     if (r.ok) void useCalc.getState().applyBuildCode(r.build);
     else if (r.reason !== "empty") useCalc.setState({ notice: `This link could not be read (${r.reason}).` });
+    if (!pinOk) useCalc.setState({ notice: "The pinned build (A) in this link could not be read." });
   };
 
   lastHash = location.hash;
@@ -25,8 +34,8 @@ export function initUrlSync(): void {
 
   const write = () => {
     const s = useCalc.getState();
-    if (s.status === "loading") return;
-    const next = s.classToken
+    if (applying || s.status === "loading") return;
+    const build = s.classToken
       ? encodeBuild({
           classToken: s.classToken,
           level: s.level,
@@ -38,6 +47,7 @@ export function initUrlSync(): void {
           },
         })
       : "";
+    const next = joinHash(build, useCompare.getState().pinned);
     if (next === lastHash) return;
     lastHash = next;
     history.replaceState(null, "", next || location.pathname + location.search);
@@ -45,4 +55,5 @@ export function initUrlSync(): void {
   useCalc.subscribe(write);
   useCharacter.subscribe(write);
   useRotation.subscribe(write);
+  useCompare.subscribe(write);
 }
diff --git a/src/ui/results/ComparePanel.tsx b/src/ui/results/ComparePanel.tsx
new file mode 100644
index 0000000..7424d1e
--- /dev/null
+++ b/src/ui/results/ComparePanel.tsx
@@ -0,0 +1,189 @@
+import { useEffect, useState } from "react";
+import { getClassInfo } from "@/data";
+import { pointsBySpec } from "@/engine/talents";
+import { joinHash, loadBuild, splitHash, talentDiff, useCompare, type LoadedBuild } from "@/state/compare";
+import { derive, type Derived } from "@/state/derived";
+import { IMPACT_STATS } from "@/state/insight";
+import { useCalc } from "@/state/store";
+import { fmtDec1, fmtDec2, fmtInt, fmtSigned } from "@/ui/stats/format";
+import { useDerived } from "@/ui/stats/useDerived";
+import styles from "./DamagePanel.module.css";
+
+type Ok = Extract<Derived, { ok: true }>;
+type Pinned = { hash: string; build: LoadedBuild | null; d: Derived | null };
+
+/** Build A: loaded from its hash (class files are cached) and derived once per pin. */
+function usePinned(pinned: string | null): Pinned | null {
+  const [state, setState] = useState<Pinned | null>(null);
+  useEffect(() => {
+    if (!pinned) return;
+    let live = true;
+    void loadBuild(pinned).then((build) => {
+      if (!live) return;
+      const d = build ? derive(build.inputs.calc, build.inputs.ch, build.inputs.rotation) : null;
+      setState({ hash: pinned, build, d });
+    });
+    return () => {
+      live = false;
+    };
+  }, [pinned]);
+  return state && state.hash === pinned ? state : null;
+}
+
+const fmtStat = (format: "int" | "pct", v: number) => (format === "pct" ? fmtDec2(v) + "%" : fmtInt(v));
+const signed = (format: "int" | "pct" | "dps", v: number) =>
+  format === "dps"
+    ? fmtSigned(v, fmtDec1)
+    : format === "pct"
+      ? fmtSigned(v, fmtDec2) + "%"
+      : fmtSigned(v, fmtInt);
+
+function Row(props: {
+  label: string;
+  a: string;
+  b: string;
+  delta?: { v: number; format: "int" | "pct" | "dps" };
+  testId?: string;
+}) {
+  const { label, a, b, delta, testId } = props;
+  const tone = !delta || Math.abs(delta.v) < 1e-9 ? undefined : delta.v > 0 ? "var(--green)" : "var(--red)";
+  return (
+    <tr data-testid={testId}>
+      <th scope="row">{label}</th>
+      <td data-testid={testId && `${testId}-a`}>{a}</td>
+      <td data-testid={testId && `${testId}-b`}>{b}</td>
+      <td data-testid={testId && `${testId}-delta`} style={tone ? { color: tone } : undefined}>
+        {delta ? signed(delta.format, delta.v) : ""}
+      </td>
+    </tr>
+  );
+}
+
+function Table({ a, b, build }: { a: Ok; b: Ok; build: LoadedBuild }) {
+  const calcTree = useCalc((s) => s.tree)!;
+  const ranks = useCalc((s) => s.ranks);
+  const level = useCalc((s) => s.level);
+  const dpsA = a.damage?.totalDps ?? 0;
+  const dpsB = b.damage?.totalDps ?? 0;
+  const head = (d: Ok, points: number[], lv: number) =>
+    `${getClassInfo(d.stats.classToken).name} ${lv} · ${points.join("/")}`;
+  const stats = IMPACT_STATS.map((s) => ({
+    s,
+    va: s.get(a.stats, a.view),
+    vb: s.get(b.stats, b.view),
+  })).filter((x) => Math.abs(x.va) > 1e-9 || Math.abs(x.vb) > 1e-9);
+  const changes = talentDiff(build.tree, build.inputs.calc.ranks, calcTree, ranks);
+  return (
+    <>
+      <table className={styles.table} data-testid="compare-table">
+        <caption>Build A (pinned) and build B (the one you edit), vs the selected target</caption>
+        <thead>
+          <tr>
+            <th scope="col">Value</th>
+            <th scope="col">A</th>
+            <th scope="col">B</th>
+            <th scope="col">B − A</th>
+          </tr>
+        </thead>
+        <tbody>
+          <Row
+            label="Build"
+            a={head(a, pointsBySpec(build.tree, build.inputs.calc.ranks), build.code.level)}
+            b={head(b, pointsBySpec(calcTree, ranks), level)}
+          />
+          <Row label="Rotation" a={a.damage?.rotation.label ?? "–"} b={b.damage?.rotation.label ?? "–"} />
+          <Row
+            label="DPS"
+            a={fmtDec1(dpsA)}
+            b={fmtDec1(dpsB)}
+            delta={{ v: dpsB - dpsA, format: "dps" }}
+            testId="compare-dps"
+          />
+          {(a.damage?.pet || b.damage?.pet) && (
+            <Row
+              label="Pet DPS"
+              a={a.damage?.pet ? `${a.damage.pet.name} ${fmtDec1(a.damage.pet.rotation.dps)}` : "–"}
+              b={b.damage?.pet ? `${b.damage.pet.name} ${fmtDec1(b.damage.pet.rotation.dps)}` : "–"}
+              delta={{
+                v: (b.damage?.pet?.rotation.dps ?? 0) - (a.damage?.pet?.rotation.dps ?? 0),
+                format: "dps",
+              }}
+            />
+          )}
+          {stats.map(({ s, va, vb }) => (
+            <Row
+              key={s.id}
+              label={s.label.charAt(0).toUpperCase() + s.label.slice(1)}
+              a={fmtStat(s.format, va)}
+              b={fmtStat(s.format, vb)}
+              delta={{ v: vb - va, format: s.format }}
+              testId={`compare-${s.id}`}
+            />
+          ))}
+        </tbody>
+      </table>
+      <h3 className={styles.petTitle}>Talent differences</h3>
+      <ul className={styles.changes} data-testid="compare-talents">
+        {changes === null && <li>Different classes: talents are not compared.</li>}
+        {changes?.length === 0 && <li>Same talents.</li>}
+        {changes?.map((c) => (
+          <li key={c.nodeId}>
+            {c.name}: {c.a} → {c.b}
+          </li>
+        ))}
+      </ul>
+    </>
+  );
+}
+
+/**
+ * Phase 7: compare a pinned build (A) with the build being edited (B): DPS, key stats and talent differences.
+ * The page link carries both builds (`#B~A`).
+ */
+export function ComparePanel() {
+  const pinned = useCompare((s) => s.pinned);
+  const pin = useCompare((s) => s.pin);
+  const clear = useCompare((s) => s.clear);
+  const b = useDerived();
+  const a = usePinned(pinned);
+  const current = () => splitHash(location.hash).build;
+  return (
+    <section className={styles.panel} data-testid="compare-panel" aria-labelledby="compare-title">
+      <h2 id="compare-title" className={styles.title}>
+        Compare builds
+      </h2>
+      {!pinned && (
+        <p className={styles.line}>
+          Pin this build as A, then change talents, gear or settings: the table compares A with the build you
+          edit (B). The page link then shares both builds.
+        </p>
+      )}
+      <div className={styles.actionsRow}>
+        <button type="button" data-testid="compare-pin" onClick={() => pin(current())}>
+          {pinned ? "Pin this build as A again" : "Pin this build as A"}
+        </button>
+        {pinned && (
+          <>
+            <button
+              type="button"
+              data-testid="compare-swap"
+              onClick={() => {
+                location.hash = joinHash(pinned, current());
+              }}
+            >
+              Swap A and B
+            </button>
+            <button type="button" data-testid="compare-clear" onClick={clear}>
+              Stop comparing
+            </button>
+          </>
+        )}
+      </div>
+      {pinned && !a && <p className={styles.line}>Loading build A…</p>}
+      {pinned && a && (!a.build || !a.d?.ok) && (
+        <p className={styles.note}>Build A could not be evaluated.</p>
+      )}
+      {pinned && a?.build && a.d?.ok && b.ok && <Table a={a.d} b={b} build={a.build} />}
+    </section>
+  );
+}
diff --git a/src/ui/results/DamagePanel.module.css b/src/ui/results/DamagePanel.module.css
index 1273c2e..b19033d 100644
--- a/src/ui/results/DamagePanel.module.css
+++ b/src/ui/results/DamagePanel.module.css
@@ -127,3 +127,15 @@
   gap: 8px;
   margin-top: 8px;
 }
+
+.changes {
+  margin: 4px 0 0;
+  padding-left: 18px;
+  font-size: 12px;
+}
+
+.table tbody th {
+  color: var(--text);
+  font-weight: normal;
+  text-align: left;
+}
````

### 6.6 F: mobile cards and accessibility (task T7)

**First run** `npm install --save-dev --save-exact @axe-core/playwright@4.10.2` (adds `"@axe-core/playwright": "4.10.2"` to `devDependencies` and its lock entries; axe-core resolves to 4.10.3). `package.json`/`package-lock.json` are not in the diff. Files: `src/ui/stats/StatsPanel.{tsx,module.css}` (cards, roles), `src/ui/talents/{TalentTree,TalentCalculator}.tsx` (tab panels), `src/ui/results/{WeightsPanel.tsx,DamagePanel.module.css}` (button style, `weights-toggle`), new `e2e/a11y.ts`, `e2e/a11y.spec.ts`, `e2e/mobile.spec.ts` (+1), `e2e/weights.spec.ts`.

````diff
diff --git a/e2e/a11y.spec.ts b/e2e/a11y.spec.ts
new file mode 100644
index 0000000..e3f3982
--- /dev/null
+++ b/e2e/a11y.spec.ts
@@ -0,0 +1,47 @@
+import { expect, test } from "@playwright/test";
+import { expectNoSeriousA11yIssues } from "./a11y";
+import { GOLDEN, blockRemoteImages, node } from "./helpers";
+
+test.beforeEach(async ({ page }) => {
+  await blockRemoteImages(page);
+});
+
+test("accessibility: start page, full build with every panel, talent tooltip, simulation", async ({
+  page,
+}) => {
+  await page.goto("./");
+  await expectNoSeriousA11yIssues(page, "start");
+  await page.goto(`./${GOLDEN}`);
+  await expect(page.getByTestId("dps-total")).toBeVisible();
+  await page.getByTestId("weights-toggle").click();
+  await expect(page.getByTestId("weights-table")).toBeVisible();
+  await page.getByTestId("compare-pin").click();
+  await expect(page.getByTestId("compare-table")).toBeVisible();
+  await page.getByTestId("heatmap-toggle").check();
+  await expect.poll(() => page.getByTestId("node-impact").count()).toBeGreaterThan(0);
+  await expectNoSeriousA11yIssues(page, "build");
+  await node(page, "Ignite").hover();
+  await expect(page.locator("#talent-tooltip").getByTestId("talent-impact")).toBeVisible();
+  await expectNoSeriousA11yIssues(page, "tooltip");
+  await page.getByTestId("sim-iterations").fill("50");
+  await page.getByTestId("sim-run").click();
+  await expect(page.getByTestId("sim-results")).toBeVisible();
+  await expectNoSeriousA11yIssues(page, "simulation");
+});
+
+test("keyboard: level, heat map, stat weights and compare work without a mouse", async ({ page }) => {
+  await page.goto(`./${GOLDEN}`);
+  await expect(page.getByTestId("dps-total")).toBeVisible();
+  await page.getByTestId("level-select").focus();
+  await page.keyboard.press("ArrowDown"); // 60 -> 59 (options are listed from 60 down)
+  await expect(page.getByTestId("level-select")).toHaveValue("59");
+  await page.getByTestId("heatmap-toggle").focus();
+  await page.keyboard.press("Space");
+  await expect(page.getByTestId("heatmap-toggle")).toBeChecked();
+  await page.getByTestId("weights-toggle").focus();
+  await page.keyboard.press("Enter");
+  await expect(page.getByTestId("weights-table")).toBeVisible();
+  await page.getByTestId("compare-pin").focus();
+  await page.keyboard.press("Enter");
+  await expect(page.getByTestId("compare-table")).toBeVisible();
+});
diff --git a/e2e/a11y.ts b/e2e/a11y.ts
new file mode 100644
index 0000000..765832a
--- /dev/null
+++ b/e2e/a11y.ts
@@ -0,0 +1,11 @@
+import AxeBuilder from "@axe-core/playwright";
+import { expect, type Page } from "@playwright/test";
+
+/** Phase 7: axe-core (WCAG 2.1 A/AA rules); serious and critical violations fail the test. */
+export async function expectNoSeriousA11yIssues(page: Page, label: string) {
+  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
+  const bad = r.violations
+    .filter((v) => v.impact === "serious" || v.impact === "critical")
+    .map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
+  expect(bad).toEqual([]);
+}
diff --git a/e2e/mobile.spec.ts b/e2e/mobile.spec.ts
index caf9f21..33d6305 100644
--- a/e2e/mobile.spec.ts
+++ b/e2e/mobile.spec.ts
@@ -1,5 +1,6 @@
 import { expect, test } from "@playwright/test";
-import { blockRemoteImages, node } from "./helpers";
+import { expectNoSeriousA11yIssues } from "./a11y";
+import { GOLDEN, blockRemoteImages, node } from "./helpers";
 
 test("mobile tabs and long press", async ({ page }) => {
   await blockRemoteImages(page);
@@ -53,3 +54,24 @@ test("mobile: Sim tab shows the rotation editor and runs the simulation", async
   await expect(page.getByTestId("sim-dps")).not.toHaveText("");
   expect(await page.evaluate<number>("document.documentElement.scrollWidth")).toBeLessThanOrEqual(393);
 });
+
+test("mobile: reference targets are cards (no sideways scroll); no serious accessibility issues", async ({
+  page,
+}) => {
+  await blockRemoteImages(page);
+  await page.goto(`./${GOLDEN}`);
+  await expectNoSeriousA11yIssues(page, "mobile talents");
+  await page.getByRole("tab", { name: "Stats" }).click();
+  const boss = page.getByTestId("ref-row-boss");
+  await expect(boss).toBeVisible();
+  await expect(boss.locator('[data-label="DPS"]')).toBeVisible();
+  const head = await page.getByTestId("reference-table").locator("thead").boundingBox();
+  expect(head!.height).toBeLessThanOrEqual(1); // visually hidden, still read by screen readers
+  const box = await page.getByTestId("reference-table").boundingBox();
+  expect(box!.x + box!.width).toBeLessThanOrEqual(393);
+  expect(await page.evaluate<number>("document.documentElement.scrollWidth")).toBeLessThanOrEqual(393);
+  await expectNoSeriousA11yIssues(page, "mobile stats");
+  await page.getByRole("tab", { name: "Damage" }).click();
+  await expect(page.getByTestId("compare-panel")).toBeVisible();
+  await expectNoSeriousA11yIssues(page, "mobile damage");
+});
diff --git a/e2e/weights.spec.ts b/e2e/weights.spec.ts
index 6763295..7edbae7 100644
--- a/e2e/weights.spec.ts
+++ b/e2e/weights.spec.ts
@@ -10,14 +10,14 @@ test("stat weights: analytical EP when opened, simulated weights on demand", asy
   await page.goto(`./${GOLDEN}`);
   await expect(page.getByTestId("dps-total")).toBeVisible();
   await expect(page.getByTestId("weights-table")).toHaveCount(0); // nothing computed while closed
-  await page.getByText("Stat weights", { exact: true }).click();
+  await page.getByTestId("weights-toggle").click();
   const table = page.getByTestId("weights-table");
   await expect(table).toBeVisible();
   await expect(page.getByTestId("weight-spellPower").getByTestId("weight-ep")).toHaveText("1.00");
   await expect(page.getByTestId("weight-spellHit")).toContainText("up to the cap");
   await page.getByTestId("sim-iterations").fill("50");
   await page.getByTestId("weights-sim-run").click();
-  await expect(table.getByRole("columnheader", { name: "Sim EP" })).toBeVisible({ timeout: 30_000 });
+  await expect(table.locator("thead")).toContainText("Sim EP", { timeout: 30_000 });
   await expect(page.getByTestId("weight-spellPower")).toContainText("±");
   w.check();
 });
diff --git a/src/ui/results/DamagePanel.module.css b/src/ui/results/DamagePanel.module.css
index b19033d..2bd5e8d 100644
--- a/src/ui/results/DamagePanel.module.css
+++ b/src/ui/results/DamagePanel.module.css
@@ -139,3 +139,18 @@
   font-weight: normal;
   text-align: left;
 }
+
+/* Same button look as the Simulation panel and the talent summary bar. */
+.actionsRow button {
+  padding: 3px 8px;
+  background: var(--field-bg);
+  border: 1px solid var(--panel-border);
+  border-radius: 3px;
+  color: var(--gold);
+  cursor: pointer;
+}
+
+.actionsRow button:focus-visible {
+  outline: 2px solid var(--focus);
+  outline-offset: 1px;
+}
diff --git a/src/ui/results/WeightsPanel.tsx b/src/ui/results/WeightsPanel.tsx
index 2a5e557..17fccec 100644
--- a/src/ui/results/WeightsPanel.tsx
+++ b/src/ui/results/WeightsPanel.tsx
@@ -98,7 +98,7 @@ export function WeightsPanel() {
   return (
     <section className={styles.panel} data-testid="weights-panel" aria-labelledby="weights-title">
       <details onToggle={(e) => setOpen(e.currentTarget.open)}>
-        <summary className={styles.summaryToggle}>
+        <summary className={styles.summaryToggle} data-testid="weights-toggle">
           <h2 id="weights-title" className={styles.titleInline}>
             Stat weights
           </h2>
diff --git a/src/ui/stats/StatsPanel.module.css b/src/ui/stats/StatsPanel.module.css
index ebb7892..5d8ac2d 100644
--- a/src/ui/stats/StatsPanel.module.css
+++ b/src/ui/stats/StatsPanel.module.css
@@ -107,6 +107,57 @@
   font-weight: normal;
 }
 
+/* Phase 7 (KNOWN_LIMITS L20): on narrow screens every reference target is a card, no sideways scrolling. */
+@media (max-width: 600px) {
+  .scroll {
+    overflow-x: visible;
+  }
+
+  .ref thead {
+    position: absolute;
+    width: 1px;
+    height: 1px;
+    overflow: hidden;
+    clip: rect(0 0 0 0);
+  }
+
+  .ref,
+  .ref tbody {
+    display: block;
+  }
+
+  .ref tr {
+    display: grid;
+    grid-template-columns: repeat(3, minmax(0, 1fr));
+    gap: 2px 8px;
+    margin-bottom: 6px;
+    padding: 4px 6px;
+    border: 1px solid var(--panel-border);
+    border-radius: 4px;
+  }
+
+  .ref td {
+    padding: 0;
+    border: 0;
+    text-align: left;
+    white-space: normal;
+  }
+
+  .ref td::before {
+    content: attr(data-label) " ";
+    color: var(--text-dim);
+  }
+
+  .ref td:first-child {
+    grid-column: 1 / -1;
+    color: var(--gold);
+  }
+
+  .ref td:first-child::before {
+    content: none;
+  }
+}
+
 .details {
   margin-top: 14px;
   font-size: 12px;
diff --git a/src/ui/stats/StatsPanel.tsx b/src/ui/stats/StatsPanel.tsx
index 00682d8..bc88f7f 100644
--- a/src/ui/stats/StatsPanel.tsx
+++ b/src/ui/stats/StatsPanel.tsx
@@ -256,6 +256,19 @@ function VsTarget({ d }: { d: Ok }) {
   );
 }
 
+const REF_COLUMNS = [
+  "Target",
+  "Level",
+  "Armor",
+  "DR",
+  "Miss",
+  "Dodge",
+  "Glancing",
+  "Crit",
+  "Spell miss",
+  "DPS",
+] as const;
+
 function ReferenceTable({ d }: { d: Ok }) {
   const s = d.stats;
   const rangedOnly = s.classToken === "hunter" && !s.weapons.mainHand && !!s.weapons.ranged;
@@ -263,37 +276,40 @@ function ReferenceTable({ d }: { d: Ok }) {
   return (
     <section className={styles.block}>
       <div className={styles.scroll}>
-        <table className={styles.ref} data-testid="reference-table">
+        {/* Phase 7: explicit roles keep the table semantics when narrow screens show each row as a card */}
+        <table className={styles.ref} data-testid="reference-table" role="table">
           <caption>Same build vs reference targets for level {s.level} (debuffs applied)</caption>
-          <thead>
-            <tr>
-              <th>Target</th>
-              <th>Level</th>
-              <th>Armor</th>
-              <th>DR</th>
-              <th>Miss</th>
-              <th>Dodge</th>
-              <th>Glancing</th>
-              <th>Crit</th>
-              <th>Spell miss</th>
-              {showDps && <th>DPS</th>}
+          <thead role="rowgroup">
+            <tr role="row">
+              {REF_COLUMNS.filter((c) => showDps || c !== "DPS").map((c) => (
+                <th key={c} role="columnheader" scope="col">
+                  {c}
+                </th>
+              ))}
             </tr>
           </thead>
-          <tbody>
+          <tbody role="rowgroup">
             {d.reference.map((r) => {
               const o = rangedOnly ? r.ranged : r.mainHand;
+              const cells: [string, string][] = [
+                ["Target", targetsFile.presets.find((p) => p.id === r.presetId)?.label ?? r.presetId],
+                ["Level", String(r.level)],
+                ["Armor", fmtInt(r.armor.value)],
+                ["DR", fmtPct(r.armorReduction.value)],
+                ["Miss", o ? fmtPct(o.miss.value) : "–"],
+                ["Dodge", o ? fmtPct(o.dodge.value) : "–"],
+                ["Glancing", o ? fmtPct(o.glancing) : "–"],
+                ["Crit", o ? fmtPct(o.crit.value) : "–"],
+                ["Spell miss", fmtPct(r.spell.miss.value)],
+                ...(showDps ? [["DPS", r.dps === undefined ? "–" : fmtDec1(r.dps)] as [string, string]] : []),
+              ];
               return (
-                <tr key={r.presetId}>
-                  <td>{targetsFile.presets.find((p) => p.id === r.presetId)?.label ?? r.presetId}</td>
-                  <td>{r.level}</td>
-                  <td>{fmtInt(r.armor.value)}</td>
-                  <td>{fmtPct(r.armorReduction.value)}</td>
-                  <td>{o ? fmtPct(o.miss.value) : "–"}</td>
-                  <td>{o ? fmtPct(o.dodge.value) : "–"}</td>
-                  <td>{o ? fmtPct(o.glancing) : "–"}</td>
-                  <td>{o ? fmtPct(o.crit.value) : "–"}</td>
-                  <td>{fmtPct(r.spell.miss.value)}</td>
-                  {showDps && <td>{r.dps === undefined ? "–" : fmtDec1(r.dps)}</td>}
+                <tr key={r.presetId} role="row" data-testid={`ref-row-${r.presetId}`}>
+                  {cells.map(([label, value]) => (
+                    <td key={label} role="cell" data-label={label}>
+                      {value}
+                    </td>
+                  ))}
                 </tr>
               );
             })}
diff --git a/src/ui/talents/TalentCalculator.tsx b/src/ui/talents/TalentCalculator.tsx
index 43aafb7..ca6262d 100644
--- a/src/ui/talents/TalentCalculator.tsx
+++ b/src/ui/talents/TalentCalculator.tsx
@@ -84,6 +84,7 @@ export function TalentCalculator() {
             specIndex={i}
             hidden={!desktop && activeSpec !== i}
             contribution={contribution?.[i] ?? null}
+            tabbed={!desktop}
             heatmap={heatmap}
           />
         ))}
diff --git a/src/ui/talents/TalentTree.tsx b/src/ui/talents/TalentTree.tsx
index 90719b9..b3d45da 100644
--- a/src/ui/talents/TalentTree.tsx
+++ b/src/ui/talents/TalentTree.tsx
@@ -14,9 +14,10 @@ interface Props {
   hidden?: boolean;
   contribution?: number | null; // Phase 7: DPS of this tree's points (null while computing)
   heatmap?: ReadonlyMap<number, number> | null; // Phase 7: next-point DPS per node
+  tabbed?: boolean; // Phase 7: narrow layout, the tree is the panel of tab `tab-<specIndex>`
 }
 
-export function TalentTree({ specIndex, hidden, contribution, heatmap }: Props) {
+export function TalentTree({ specIndex, hidden, contribution, heatmap, tabbed }: Props) {
   const tree = useCalc((s) => s.tree);
   const ranks = useCalc((s) => s.ranks);
   const level = useCalc((s) => s.level);
@@ -45,9 +46,11 @@ export function TalentTree({ specIndex, hidden, contribution, heatmap }: Props)
   return (
     <section
       className={`${styles.tree} ${hidden ? styles.hidden : ""}`}
+      id={`tree-panel-${specIndex}`}
       data-testid={`tree-${specIndex}`}
       data-tree
       aria-label={`${spec.name} talents, ${points} points`}
+      {...(tabbed ? { role: "tabpanel" } : {})}
     >
       <header className={styles.header}>
         <WowIcon name={info?.icon ?? null} size={20} />
````

### 6.7 G: data refresh script and footer (task T8)

Files: new `tools/refresh_build.py`, `tools/pipeline/tests/_fixtures.py` (`TALENTCALC_BUILD`), new `tools/pipeline/tests/test_refresh.py`, `e2e/helpers.ts` (`DATA_DIR`), new `src/ui/common/dataAge.{ts,test.ts}`, `src/App.{tsx,module.css}` (footer), `e2e/a11y.spec.ts` (footer check).

````diff
diff --git a/e2e/a11y.spec.ts b/e2e/a11y.spec.ts
index e3f3982..34fea90 100644
--- a/e2e/a11y.spec.ts
+++ b/e2e/a11y.spec.ts
@@ -10,6 +10,9 @@ test("accessibility: start page, full build with every panel, talent tooltip, si
   page,
 }) => {
   await page.goto("./");
+  await expect(page.getByTestId("data-build")).toContainText(
+    /WoW Forever build \d+\.\d+\.\d+\.\d+ · generated/,
+  );
   await expectNoSeriousA11yIssues(page, "start");
   await page.goto(`./${GOLDEN}`);
   await expect(page.getByTestId("dps-total")).toBeVisible();
diff --git a/e2e/helpers.ts b/e2e/helpers.ts
index 09edf23..08a6343 100644
--- a/e2e/helpers.ts
+++ b/e2e/helpers.ts
@@ -1,7 +1,8 @@
 import { expect, type Locator, type Page } from "@playwright/test";
 import { readFileSync, readdirSync } from "node:fs";
 
-const TALENTS_DIR = "data/generated/1.60.1.70888/talents";
+const DATA_DIR = "data/generated/1.60.1.70888"; // tools/refresh_build.py --switch rewrites this
+const TALENTS_DIR = `${DATA_DIR}/talents`;
 
 export const GOLDEN = "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N";
 
@@ -23,7 +24,7 @@ export interface ClassCounts {
 
 /** Expected node counts per class/spec, read from the generated data. */
 export function expectedCounts(): ClassCounts[] {
-  const classes = JSON.parse(readFileSync("data/generated/1.60.1.70888/classes.json", "utf8")).classes as {
+  const classes = JSON.parse(readFileSync(`${DATA_DIR}/classes.json`, "utf8")).classes as {
     token: string;
     name: string;
   }[];
diff --git a/src/App.module.css b/src/App.module.css
index 6fe9f80..6c9c91b 100644
--- a/src/App.module.css
+++ b/src/App.module.css
@@ -73,3 +73,7 @@
   gap: 16px;
   margin-top: 16px;
 }
+
+.outdated {
+  color: var(--warn);
+}
diff --git a/src/App.tsx b/src/App.tsx
index b03a25a..9ab51f9 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -5,6 +5,7 @@ import { CharacterPanel } from "@/ui/character/CharacterPanel";
 import { DamagePanel } from "@/ui/results/DamagePanel";
 import { ComparePanel } from "@/ui/results/ComparePanel";
 import { WeightsPanel } from "@/ui/results/WeightsPanel";
+import { OUTDATED_AFTER_DAYS, dataAgeDays } from "@/ui/common/dataAge";
 import { useMediaQuery } from "@/ui/common/useMediaQuery";
 import { RotationEditor } from "@/ui/rotation/RotationEditor";
 import { SimPanel } from "@/ui/sim/SimPanel";
@@ -16,6 +17,8 @@ import styles from "./App.module.css";
 type Section = "Talents" | "Gear" | "Stats" | "Damage" | "Sim";
 const SECTIONS: Section[] = ["Talents", "Gear", "Stats", "Damage", "Sim"];
 
+const DATA_AGE = dataAgeDays(manifest.generatedAt, Date.now());
+
 export function App() {
   const classToken = useCalc((s) => s.classToken);
   const status = useCalc((s) => s.status);
@@ -83,8 +86,16 @@ export function App() {
         </>
       )}
       <footer className={styles.footer}>
-        Data: WoW Forever build {DATA_BUILD} · generated {manifest.generatedAt} · Icons and art © Blizzard
-        Entertainment
+        <span data-testid="data-build">
+          Data: WoW Forever build {DATA_BUILD} · generated {manifest.generatedAt}
+        </span>
+        {DATA_AGE > OUTDATED_AFTER_DAYS && (
+          <span className={styles.outdated} data-testid="data-outdated">
+            {" "}
+            · The data is {DATA_AGE} days old: a newer Forever build may change some numbers
+          </span>
+        )}{" "}
+        · Icons and art © Blizzard Entertainment
       </footer>
     </div>
   );
diff --git a/src/ui/common/dataAge.test.ts b/src/ui/common/dataAge.test.ts
new file mode 100644
index 0000000..6bb20e3
--- /dev/null
+++ b/src/ui/common/dataAge.test.ts
@@ -0,0 +1,11 @@
+import { describe, expect, it } from "vitest";
+import { OUTDATED_AFTER_DAYS, dataAgeDays } from "./dataAge";
+
+describe("data age (footer notice)", () => {
+  it("counts whole UTC days since generatedAt", () => {
+    expect(dataAgeDays("2026-11-13", Date.parse("2026-11-13T23:59:00Z"))).toBe(0);
+    expect(dataAgeDays("2026-11-13", Date.parse("2027-02-11T00:00:00Z"))).toBe(OUTDATED_AFTER_DAYS);
+    expect(dataAgeDays("2026-11-13", Date.parse("2026-11-01T00:00:00Z"))).toBe(0);
+    expect(dataAgeDays("not a date", Date.now())).toBe(0);
+  });
+});
diff --git a/src/ui/common/dataAge.ts b/src/ui/common/dataAge.ts
new file mode 100644
index 0000000..858e349
--- /dev/null
+++ b/src/ui/common/dataAge.ts
@@ -0,0 +1,8 @@
+/** Phase 7: the footer warns when the generated data is older than this (Forever ships client builds often). */
+export const OUTDATED_AFTER_DAYS = 90;
+
+/** Whole days between manifest.generatedAt (YYYY-MM-DD, UTC) and `now` (ms); 0 for a bad date. */
+export function dataAgeDays(generatedAt: string, now: number): number {
+  const t = Date.parse(`${generatedAt}T00:00:00Z`);
+  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : 0;
+}
diff --git a/tools/pipeline/tests/_fixtures.py b/tools/pipeline/tests/_fixtures.py
index 2ed9d1c..4c4bdf2 100644
--- a/tools/pipeline/tests/_fixtures.py
+++ b/tools/pipeline/tests/_fixtures.py
@@ -5,7 +5,7 @@ import tempfile
 import unittest
 
 ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
-BUILD = "1.60.1.70888"
+BUILD = os.environ.get("TALENTCALC_BUILD", "1.60.1.70888")  # tools/refresh_build.py tests a new build
 ERA_BUILD = "1.15.9.70576"
 RAW = os.path.join(ROOT, "data", "raw", BUILD)
 ERA_RAW = os.path.join(ROOT, "data", "raw", ERA_BUILD)
diff --git a/tools/pipeline/tests/test_refresh.py b/tools/pipeline/tests/test_refresh.py
new file mode 100644
index 0000000..e00f761
--- /dev/null
+++ b/tools/pipeline/tests/test_refresh.py
@@ -0,0 +1,32 @@
+"""Phase 7: tools/refresh_build.py (no network: the diff of a build with itself, the --switch patterns)."""
+import importlib.util
+import os
+import re
+import unittest
+
+from ._fixtures import BUILD, ROOT
+
+_spec = importlib.util.spec_from_file_location("refresh_build", os.path.join(ROOT, "tools", "refresh_build.py"))
+refresh = importlib.util.module_from_spec(_spec)
+_spec.loader.exec_module(refresh)
+GEN = os.path.join(ROOT, "data", "generated", BUILD)
+
+
+class TestRefresh(unittest.TestCase):
+    def test_current_build_matches_vite_config(self):
+        self.assertEqual(refresh.current_build(), "1.60.1.70888")
+
+    def test_every_switch_pattern_matches_once(self):
+        for rel, pat in refresh.SWITCH:
+            with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
+                self.assertEqual(len(re.findall(pat, f.read())), 1, rel)
+
+    @unittest.skipUnless(os.path.isdir(GEN), "generated data missing")
+    def test_diff_of_a_build_with_itself_is_empty(self):
+        lines, problems = refresh.diff_summary(GEN, GEN)
+        text = "\n".join(lines)
+        self.assertEqual(problems, 0)
+        self.assertIn("identical, 0 changed, 0 new, 0 removed", text)
+        self.assertIn("## Talents: 0 added, 0 removed, 0 changed", text)
+        self.assertIn("## Spells (class and pet files): 0 added, 0 removed, 0 changed", text)
+        self.assertIn("## Targets: unchanged", text)
diff --git a/tools/refresh_build.py b/tools/refresh_build.py
new file mode 100644
index 0000000..28a3623
--- /dev/null
+++ b/tools/refresh_build.py
@@ -0,0 +1,229 @@
+#!/usr/bin/env python3
+"""Data refresh for a new WoW Forever build (Phase 7, docs/DATA_SOURCES.md "Refreshing the data").
+
+  python3 tools/refresh_build.py                       # latest wowf build: fetch, build, compare, test (report only)
+  python3 tools/refresh_build.py --build 1.60.1.70938 --date 2026-11-13 --report /tmp/refresh.md
+  python3 tools/refresh_build.py --build X --skip-fetch --switch   # point the app at build X (then run npm test/e2e)
+
+Steps: 1. latest build from wago.tools /api/builds (product wowf), 2. tools/research/fetch_db2.sh into data/raw/<build>,
+3. tools/pipeline/build_data.py into data/generated/<build>, 4. a diff summary against the app's current build
+(manifest counts, talents, spell values, weapons, targets, manual-data validation), 5. the pipeline tests against the
+new build (TALENTCALC_BUILD). Nothing in the app changes unless --switch is given. Exit code 0 = no blocking problem
+(pipeline built, no manual-data mismatches), 1 = review needed, 2 = error.
+"""
+import argparse
+import datetime
+import hashlib
+import json
+import os
+import re
+import subprocess
+import sys
+import urllib.request
+
+ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
+BUILDS_URL = "https://wago.tools/api/builds"
+PRODUCT = "wowf"
+# Files that name the app's data build (--switch rewrites the first match of each pattern).
+SWITCH = [
+    ("vite.config.ts", r'(const DATA_BUILD = ")([0-9.]+)(")'),
+    ("tsconfig.app.json", r'("@data/\*": \["data/generated/)([0-9.]+)(/\*"\])'),
+    ("e2e/helpers.ts", r'(const DATA_DIR = "data/generated/)([0-9.]+)(")'),
+    ("tools/pipeline/constants.py", r'(?m)^(BUILD_DEFAULT = ")([0-9.]+)(")'),
+    ("tools/pipeline/tests/_fixtures.py", r'(os.environ.get\("TALENTCALC_BUILD", ")([0-9.]+)("\))'),
+    ("tools/research/fetch_db2.sh", r'(BUILD="\$\{1:-)([0-9.]+)(\}")'),
+    ("tools/pipeline/check_icons.py", r'(os.path.join\("data", "generated", ")([0-9.]+)("\))'),
+]
+
+
+def log(msg):
+    print(msg, flush=True)
+
+
+def current_build():
+    with open(os.path.join(ROOT, "vite.config.ts"), encoding="utf-8") as f:
+        m = re.search(SWITCH[0][1], f.read())
+    if not m:
+        raise SystemExit("DATA_BUILD not found in vite.config.ts")
+    return m.group(2)
+
+
+def latest_build():
+    """Newest wowf version on wago.tools (the API lists the newest first)."""
+    req = urllib.request.Request(BUILDS_URL, headers={"User-Agent": "talentcalc-refresh/1.0", "Accept": "application/json"})
+    with urllib.request.urlopen(req, timeout=60) as r:
+        builds = json.load(r).get(PRODUCT) or []
+    if not builds:
+        raise SystemExit("no %s builds in %s" % (PRODUCT, BUILDS_URL))
+    return builds[0]["version"]
+
+
+def load(d, rel):
+    p = os.path.join(d, rel)
+    if not os.path.isfile(p):
+        return None
+    with open(p, encoding="utf-8") as f:
+        return json.load(f)
+
+
+def file_hashes(d, build):
+    """Relative path -> hash of the file with its build string and generation date blanked (real changes only)."""
+    out = {}
+    for base, _, files in os.walk(d):
+        for fn in files:
+            p = os.path.join(base, fn)
+            with open(p, encoding="utf-8") as f:
+                text = f.read().replace(build, "<build>")
+            text = re.sub(r'"generatedAt": "[0-9-]+"', '"generatedAt": ""', text)
+            out[os.path.relpath(p, d)] = hashlib.sha256(text.encode("utf-8")).hexdigest()
+    return out
+
+
+def talent_index(d):
+    """(class, node id) -> (name, max rank, tier, col, rank values) of every talent."""
+    out = {}
+    for fn in sorted(os.listdir(os.path.join(d, "talents"))):
+        f = load(d, os.path.join("talents", fn))
+        for spec in f["specs"]:
+            for t in spec["talents"]:
+                out[(f["token"], t["nodeId"])] = (
+                    t["name"], t["maxRank"], t["tier"], t["col"], [r["values"] for r in t["ranks"]])
+    return out
+
+
+def spell_index(d):
+    """Spell id -> (name, rank, effect values) over spells/<class>.json and pets/<owner>.json."""
+    out = {}
+    for sub in ("spells", "pets"):
+        p = os.path.join(d, sub)
+        if not os.path.isdir(p):
+            continue
+        for fn in sorted(os.listdir(p)):
+            for s in load(d, os.path.join(sub, fn))["spells"]:
+                eff = [(e["effect"], e.get("aura", 0), e["base"], e.get("perLevel", 0), e.get("spCoef", 0)) for e in s["effects"]]
+                out[s["id"]] = (s["name"], s.get("rank"), eff, s.get("castMs"), s.get("cooldownMs"))
+    return out
+
+
+def diff_summary(old_dir, new_dir, limit=25):
+    """Markdown lines describing what changed between two generated builds."""
+    lines = []
+    om, nm = load(old_dir, "manifest.json"), load(new_dir, "manifest.json")
+    lines.append("## Counts (manifest)")
+    for k in sorted(set(om["counts"]) | set(nm["counts"])):
+        a, b = om["counts"].get(k), nm["counts"].get(k)
+        lines.append("- %s: %s -> %s%s" % (k, a, b, "" if a == b else "  **changed**"))
+    oh, nh = file_hashes(old_dir, om["build"]), file_hashes(new_dir, nm["build"])
+    same = sorted(k for k in oh if nh.get(k) == oh[k])
+    changed = sorted(k for k in oh if k in nh and nh[k] != oh[k])
+    lines.append("## Files (build string and date ignored): %d identical, %d changed, %d new, %d removed" % (
+        len(same), len(changed), len(set(nh) - set(oh)), len(set(oh) - set(nh))))
+    lines += ["- changed: %s" % k for k in changed]
+    lines += ["- new: %s" % k for k in sorted(set(nh) - set(oh))]
+    lines += ["- removed: %s" % k for k in sorted(set(oh) - set(nh))]
+    ot, nt = talent_index(old_dir), talent_index(new_dir)
+    lines.append("## Talents: %d added, %d removed, %d changed" % (
+        len(set(nt) - set(ot)), len(set(ot) - set(nt)), sum(1 for k in ot if k in nt and ot[k] != nt[k])))
+    for k in sorted(set(nt) - set(ot))[:limit]:
+        lines.append("- added %s %s %s" % (k[0], k[1], nt[k][0]))
+    for k in sorted(set(ot) - set(nt))[:limit]:
+        lines.append("- removed %s %s %s" % (k[0], k[1], ot[k][0]))
+    for k in [k for k in sorted(ot) if k in nt and ot[k] != nt[k]][:limit]:
+        lines.append("- changed %s %s %s: %s -> %s" % (k[0], k[1], ot[k][0], ot[k][1:], nt[k][1:]))
+    os_, ns = spell_index(old_dir), spell_index(new_dir)
+    changed_spells = [k for k in sorted(os_) if k in ns and os_[k] != ns[k]]
+    lines.append("## Spells (class and pet files): %d added, %d removed, %d changed" % (
+        len(set(ns) - set(os_)), len(set(os_) - set(ns)), len(changed_spells)))
+    for k in changed_spells[:limit]:
+        lines.append("- changed %s %s (rank %s)" % (k, ns[k][0], ns[k][1]))
+    ow, nw = load(old_dir, "weapons.json"), load(new_dir, "weapons.json")
+    wo = {w["id"]: w for w in ow["weapons"]}
+    wn = {w["id"]: w for w in nw["weapons"]}
+    wchg = [i for i in wo if i in wn and wo[i] != wn[i]]
+    lines.append("## Weapons: %d added, %d removed, %d changed" % (len(set(wn) - set(wo)), len(set(wo) - set(wn)), len(wchg)))
+    ott, ntt = load(old_dir, "targets.json"), load(new_dir, "targets.json")
+    lines.append("## Targets: %s" % ("unchanged" if ott["byPlayerLevel"] == ntt["byPlayerLevel"] else "**changed**"))
+    rep = load(new_dir, "report.json")
+    mv = rep.get("manualValidation", [])
+    lines.append("## Manual data checks (data/manual vs the new SpellEffect / SpellLevels / ItemSparse): %d problem(s)" % len(mv))
+    lines += ["- %s %s: %s" % (m["file"], m["id"], m["problem"]) for m in mv]
+    lines.append("## Pipeline warnings: %d" % len(rep.get("warnings", [])))
+    lines += ["- %s" % w for w in rep.get("warnings", [])[:limit]]
+    return lines, len(mv)
+
+
+def switch_app(build):
+    for rel, pat in SWITCH:
+        p = os.path.join(ROOT, rel)
+        with open(p, encoding="utf-8") as f:
+            s = f.read()
+        s2, n = re.subn(pat, lambda m: m.group(1) + build + m.group(3), s, count=1)
+        if n != 1:
+            raise SystemExit("--switch: pattern not found in %s" % rel)
+        with open(p, "w", encoding="utf-8") as f:
+            f.write(s2)
+        log("switched %s -> %s" % (rel, build))
+
+
+def run(cmd, env=None):
+    log("$ " + " ".join(cmd))
+    return subprocess.run(cmd, cwd=ROOT, env=env).returncode
+
+
+def main(argv):
+    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
+    ap.add_argument("--build", help="wowf build version (default: the latest on wago.tools)")
+    ap.add_argument("--date", default=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"),
+                    help="manifest generatedAt (pass it explicitly for reproducible output)")
+    ap.add_argument("--skip-fetch", action="store_true", help="use data/raw/<build> as it is")
+    ap.add_argument("--no-tests", action="store_true", help="skip the pipeline tests")
+    ap.add_argument("--force", action="store_true", help="rebuild even when the build is the app's current one")
+    ap.add_argument("--switch", action="store_true", help="point the app (vite, tsconfig, tests, tools) at the build")
+    ap.add_argument("--report", help="also write the summary to this Markdown file")
+    a = ap.parse_args(argv)
+
+    cur = current_build()
+    build = a.build or latest_build()
+    log("app data build: %s, target build: %s" % (cur, build))
+    if build == cur and not a.force:
+        log("Up to date: the app already uses %s." % build)
+        return 0
+    raw = os.path.join(ROOT, "data", "raw", build)
+    if not a.skip_fetch:
+        if run(["bash", "tools/research/fetch_db2.sh", build, raw]) != 0:
+            return 2
+    if run([sys.executable, "tools/pipeline/build_data.py", "--build", build, "--date", a.date]) != 0:
+        log("The pipeline failed: read the error above (a renamed table or column needs a pipeline fix).")
+        return 2
+    new_dir = os.path.join(ROOT, "data", "generated", build)
+    old_dir = os.path.join(ROOT, "data", "generated", cur)
+    problems = 0
+    lines = ["# Data refresh %s -> %s (%s)" % (cur, build, a.date)]
+    if os.path.isdir(old_dir) and old_dir != new_dir:
+        body, problems = diff_summary(old_dir, new_dir)
+        lines += body
+    tests = None
+    if not a.no_tests:
+        env = dict(os.environ, TALENTCALC_BUILD=build)
+        tests = run([sys.executable, "-m", "unittest", "discover", "-s", "tools/pipeline/tests", "-t", "tools"], env)
+        lines.append("## Pipeline tests against %s: %s" % (
+            build, "OK" if tests == 0 else "FAILED (expected values changed: review each failure)"))
+    lines.append("## Next steps")
+    lines += [
+        "- Review the changes above; update data/manual for every manual-data problem (values are [VERIFY] copies).",
+        "- python3 tools/refresh_build.py --build %s --skip-fetch --switch, then npm test and npm run e2e;" % build,
+        "  goldens that move are re-derived with the plan's independent Python scripts, never copied from the app.",
+        "- Commit data/generated/%s (never hand-edit it) and remove the old build directory in the same commit." % build,
+    ]
+    if a.switch:
+        switch_app(build)
+    text = "\n".join(lines)
+    log("\n" + text)
+    if a.report:
+        with open(a.report, "w", encoding="utf-8") as f:
+            f.write(text + "\n")
+    return 1 if problems or (tests not in (None, 0)) else 0
+
+
+if __name__ == "__main__":
+    sys.exit(main(sys.argv[1:]))
````

---

## 7. Notes for the implementer

- Do not change `ENTRY_KINDS`, `PROC_AURAS`, `CONDITION_TYPES`, `BONUS_KEYS`, `TARGET_PRESETS`, the tag numbers or
  `PET_STREAM`. Phase 7 adds no URL tag: the level was always in the header, and compare uses the `~` separator.
- `defaultPet` is for `fitToClass` only. Never use it in `applyPet`, `applyCode`, `decodeCharacterBytes` or `toCode`.
- The insight/weights functions call `derive` with `{ reference: false }`; never use that option for the panels.
- `useDerived` now memoizes one result for all callers (`sharedDerive`); keep its key list in the same order as
  `useDeriveInputs` returns it.
- The heat map, tree totals and analytical weights run in `onIdle`; their effects must cancel the pending callback in
  the cleanup (already in the code) or a stale input set will reset `insightCache`.
- `urlSync.apply` sets the pinned build inside `applying = true`; removing that guard erases a bad link before its
  notice shows (the Phase 2 e2e test "bad link" catches it).
- `@axe-core/playwright` must be the exact version 4.10.2 (task T7). Do not run `playwright install` here; Chromium is
  pre-installed. Run e2e with `--trace off` (the `npm run e2e` script does).
- `data/generated/**` must not change. If task T3's rebuild changes any file, stop: the raw data or the pipeline differs.
- Leave `data/generated/1.60.1.70938` out of the repository (the refresh script writes it when you try it; delete it).

## 8. Tests (all in the diffs; numbers re-derived independently)

### 8.1 Level goldens: `src/engine/stats/levels.test.ts` (4) and `src/state/levels.test.ts` (6)

Engine: level 60 = `classes`; level 1 = `level1` (Mage, base spell crit still 0.2, Int per crit **10.948**); L1 warrior
level 40 `{str 87, agi 60, sta 80, int 27, spi 38, health 1123, mana 0}`, Agi per crit **15**, 60/15 = 4; levels 0, 61,
40.5 and a file without `level1` throw `UnsupportedLevelError`; L4 hunter pet level 40 `{str 97, min 30, max 50}`, level
1 `{str 22, agi 20, min 1, max 1}`, level 60 returns `base` itself.
State: warrior level 40 with Great Axe (2531, level 39, no stats): Str 87, AP **274**, Agility crit part 4.00 and total
crit equal to level 60, weapon skill 200, reference rows `[[43,2414],[42,2262],[40,1980],[43,1207]]`, Heroic Strike
rank id **11565**; every class at levels 1, 10, 25, 59 derives with finite DPS on every reference row; Battle Shout
+139 AP at 60 and 0 at 59, Blessing of Kings works at 20; Cat at level 40 (scaling off): pet level 40, AP **174**,
weapon 30–50; store: the mage golden at level 30 keeps 21 points with the notice "Talent points above level 30 were
removed.", the link starts `#v1.mage.30.0.` and decodes to level 30, raising to 60 keeps 21 points, 99 clamps to 60;
Staff of the Shadow Flame (19356, level 60) is removed at 50 with "Weapons that need a higher level than 50 were removed."

Independent check (task T9, `python3 -I golden7_levels.py .`; do not commit):
```python
"""Independent check of the Phase 7 level goldens: reads only the JSON files, no app code."""
import json, os, sys
root = sys.argv[1]
G = os.path.join(root, "data/generated/1.60.1.70888")
M = os.path.join(root, "data/manual")
bs = json.load(open(f"{M}/base-stats.json"))
tg = json.load(open(f"{G}/targets.json"))
pets = json.load(open(f"{M}/pets.json"))
def at(cls, level):
    top, one = bs["classes"][cls], bs["level1"]["classes"][cls]
    t = (level - 1) / (bs["level"] - 1)
    out = {k: (top[k] if level == 60 else int(one[k] + (top[k] - one[k]) * t + 0.5)) for k in one}
    agi = bs["conversions"]["agiPerMeleeCrit"][cls] * out["agi"] / top["agi"]
    ip = bs["conversions"]["intPerSpellCrit"].get(cls)
    return out, agi, (ip * out["int"] / top["int"] if ip else None)
w40, agi40, _ = at("WARRIOR", 40)
f = bs["conversions"]["meleeAttackPower"]["WARRIOR"]
ap = f["perLevel"] * 40 + f["flat"] + f["perStr"] * w40["str"]
crit = bs["classes"]["WARRIOR"]["baseMeleeCrit"] + w40["agi"] / agi40
print("L1 warrior Human level 40:", w40, "agiPerCrit %.4f" % agi40, "AP", ap, "crit %.4f" % crit)
m1, _, ip1 = at("MAGE", 1)
print("L2 mage level 1:", m1, "intPerCrit %.4f" % ip1, "spell crit %.4f" % (bs["classes"]["MAGE"]["baseSpellCrit"] + m1["int"] / ip1))
rows = tg["byPlayerLevel"]["40"]
print("L3 targets level 40:", [(r["preset"], r["level"], r["armor"]) for r in rows])
h = pets["owners"]["hunter"]
t = 39 / 59
print("L4 hunter pet level 40: str", int(h["level1"]["str"] + (h["base"]["str"] - h["level1"]["str"]) * t + 0.5),
      "AP", 2 * int(h["level1"]["str"] + (h["base"]["str"] - h["level1"]["str"]) * t + 0.5) - 20,
      "damage", 45 * (40 - 10) / 45, 75 * (40 + 10) / 75)
```
Expected output:
```
L1 warrior Human level 40: {'str': 87, 'agi': 60, 'sta': 80, 'int': 27, 'spi': 38, 'health': 1123, 'mana': 0} agiPerCrit 15.0000 AP 274 crit 4.0000
L2 mage level 1: {'str': 20, 'agi': 20, 'sta': 20, 'int': 23, 'spi': 23, 'health': 32, 'mana': 100} intPerCrit 10.9480 spell crit 2.3008
L3 targets level 40: [('boss', 43, 2414), ('elite', 42, 2262), ('same', 40, 1980), ('lowArmorBoss', 43, 1207), ('custom', 43, 2414)]
L4 hunter pet level 40: str 97 AP 174 damage 30.0 50.0
```

### 8.2 Stat weights: `src/state/weights.test.ts` (4) and `src/engine/sim/weights.test.ts` (2)

W1 (Human mage level 60, no talents, no gear, boss, Frost rotation = Frostbolt rank 11 only): DPS **125.570458**;
reference Spell power; rows exactly `[spellPower, int, spellHit, spellCrit, haste]` (one school: no school rows);
SP **0.21518811**/point, spell crit **0.61765833** (EP **2.870318**), spell hit up to the cap **1.51289709** per 1%
(EP **7.030579**, cap `{current 0, cap 16, above 0}`), haste EP **5.835381**, Int EP **0.048241**. Warrior (Human,
Arcanite Reaper): hit cap `{0, 9}`, DPS at +1% hit equals +0% (suppression), hit per point = (DPS(9%) − DPS(0)) / 9 > 0,
Str EP **2** (1 Str = 2 AP). Hunter (race 3, ranged 18713 + ammo 18042, as in `perf.test.ts`): reference ranged AP, its EP 1. Jobs:
`spellHit` pair `{base → spellHit:cap, per 16}`, patch `spellHit:cap+1 = {spellHit: 17}`, the W1 weights keep exactly 7
patches. Simulation (500 iterations): W1 base within 3% of 125.57, SP within 3% of 0.2152 with CI half-width < 0.01, crit
within 10%; deterministic; base equals `runSim`'s mean; the paired AP CI is narrower than the independent one.

```python
"""Independent check of the Phase 7 stat-weight golden W1 (reads only the JSON files, no app code)."""
import json, os, sys
root = sys.argv[1]
G = os.path.join(root, "data/generated/1.60.1.70888")
M = os.path.join(root, "data/manual")
bs = json.load(open(f"{M}/base-stats.json"))
mage = json.load(open(f"{G}/spells/mage.json"))
fb = next(s for s in mage["spells"] if s["id"] == 25304)          # Frostbolt rank 11 (level 60)
e = next(x for x in fb["effects"] if x["effect"] == 2)
casts = 60 / (fb["castMs"] / 1000)                                 # 20 per minute, filler
hit = 1 - (6 + 11 * (3 - 2)) / 100                                 # 17% miss vs level 63
resist = 1 - 0.75 * (8 * 3) / (5 * 60)                             # 6% average partial resist
racials = json.load(open(f"{M}/racials.json"))["racials"]
ruthless = sum(e["value"] for r in racials if r["race"] == "HUMAN" and r["kind"] == "passive"
               for e in r["effects"] if e["key"] == "crit")                      # Human "Ruthless" +1% crit
crit = bs["classes"]["MAGE"]["baseSpellCrit"] + bs["classes"]["MAGE"]["int"] / bs["conversions"]["intPerSpellCrit"]["MAGE"] + ruthless
def dps(sp=0, c=crit, h=hit, haste=0):
    return casts / 60 * h * (e["base"] + e["spCoef"] * sp) * (1 + c / 100 * 0.5) * resist * (1 + haste / 100)
d = dps()
per_sp = (dps(25) - d) / 25
per_crit = dps(c=crit + 1) - d
per_hit = (dps(h=0.99) - d) / 16
per_haste = dps(haste=1) - d
per_int = (dps(c=crit + 25 / bs["conversions"]["intPerSpellCrit"]["MAGE"]) - d) / 25
print("W1 dps %.6f perSP %.8f crit %.8f (EP %.6f) hit %.8f (EP %.6f) haste %.8f (EP %.6f) int %.8f (EP %.6f)" % (
    d, per_sp, per_crit, per_crit / per_sp, per_hit, per_hit / per_sp, per_haste, per_haste / per_sp, per_int, per_int / per_sp))
```
Expected output:
```
W1 dps 125.570458 perSP 0.21518811 crit 0.61765833 (EP 2.870318) hit 1.51289709 (EP 7.030579) haste 1.25570458 (EP 5.835381) int 0.01038081 (EP 0.048241)
```

### 8.3 Talent impact: `src/state/insight.test.ts` (5)

Warrior, Human, Arcanite Reaper, no buffs, rotation rule of the panels (`rotation: null`): the snapshot equals the full
derive's `totalDps`; Cruelty at 0: `prev` null, `next.dps > 0`, `next.stats` exactly
`[{id: "crit", label: "crit vs target", format: "pct", delta ≈ 1}]`; at 2: `prev.dps < 0`, `pct = dps / base × 100`; at 5:
`next` null. Locked Mortal Strike (tier 7): `next.dps > 0`, no rotation change; Bloodthirst: delta equals the snapshot
difference and `rotation` = the Fury rotation's label; with the Arms rotation pinned, Bloodthirst adds 0. Tree contribution
(Cruelty 5 + Deflection 5): Fury = base − DPS without Fury > 0, Arms ≈ 0, Protection 0. Cache: same values → same object;
a new ranks object → a new result.

### 8.4 Compare: `src/state/compare.test.ts` (3)

`joinHash(MAGE, WARRIOR_V2)` = `#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N~v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8`;
`splitHash` inverts it; no `~` → pinned null; both parts decode; the whole hash does not. `loadBuild` equals applying the
link to the stores (total DPS to 1e-10, same ranks) for the mage golden, the warrior v2 golden, `#v2.hunter.60.0..CAMCAAA`
and `#v1.mage.30.0`; `#v9…` → null. `talentDiff(golden, empty)`: 51 points, all to 0, tree order; mage vs warrior → null.

### 8.5 Default pet: `src/state/pets.test.ts` (+2)

`defaultPet` hunter `{2,0,true}`, warlock `{23,0,true}`, mage `NO_PET`; ids 2 and 23 are "Cat"/"Imp" in the pet files;
`fitToClass` hunter → `#v2.hunter.60.0..CAMCAAA`, warlock → `#v2.warlock.60.0..CAMXAAA`, mage → `NO_PET`;
`#v1.hunter.60.0` decodes without a pet and `applyPet` gives `NO_PET`. Notes (BM / Demonology rotations): "Choose a pet"
/ "Choose a demon" only with `NO_PET` (a sacrifice alone hides it).

### 8.6 URL goldens (independent encoder, task T9)

```python
import base64
def varint(v):
    out = []
    while v >= 0x80:
        out.append(v & 0x7F | 0x80); v >>= 7
    return out + [v]
def record(tag, values):
    body = [b for v in values for b in varint(v)]
    return varint(tag) + varint(len(body)) + body
b64 = lambda bs: base64.urlsafe_b64encode(bytes(bs)).decode().rstrip("=")
print("#v2.hunter.60.0.." + b64(record(8, [2, 0, 0])))     # new hunter: Cat
print("#v2.warlock.60.0.." + b64(record(8, [23, 0, 0])))   # new warlock: Imp
mage = "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N"
print(mage + "~" + mage[1:])                               # compare link: B = A = the Phase 2 golden
```
Expected output:
```
#v2.hunter.60.0..CAMCAAA
#v2.warlock.60.0..CAMXAAA
#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N~v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N
```
Every Phase 2–6 URL golden is unchanged (they encode explicit state; none uses `fitToClass`).

### 8.7 Pipeline: `tools/pipeline/tests/test_phase7.py` (3) and `test_refresh.py` (3)

`buffs.json` has no `minLevel` problem; Battle Shout 60, Arcane Intellect 56, Blessing of Kings 20, Sunder 58, Faerie Fire
54, Curse of the Elements 50, Mongoose 46, Titans 50, Songflower 1; setting Battle Shout and Mongoose to 1 reports exactly
`minLevel 1 != SpellLevels.BaseLevel 60` and `minLevel 1 != ItemSparse.RequiredLevel 46`; every `level1` value ≤ the
level-60 value (pets: <). Refresh: `current_build()` = `1.60.1.70888`; each of the 7 `--switch` patterns matches exactly
once; the diff of 70888 with itself reports 0 changes and 0 problems.

### 8.8 Other unit tests

`src/ui/common/dataAge.test.ts` (1): same day 0; 2027-02-11 = 90 days; future dates and bad dates 0.
`src/state/derived.test.ts`: "level below 60 has no stats" becomes "a level outside 1..60 has no stats" (level 61).

### 8.9 Playwright (8 new desktop/mobile tests; 31 → 39)

| Spec | Test |
|---|---|
| `pets.spec.ts` (changed) | new hunter: pet select 2, pet section, no rotation note, strip DPS = total, URL `CAMCAAA`; None → note "Choose a pet", lower DPS, `#v1.hunter.60.0`; that link opens with None; Cat → `CAMCAAA`; scaling off → `CAMCAAE`; reload keeps it. Warlock: select 23, URL `CAMXAAA`, then None before the sacrifice checks |
| `levels.spec.ts` | golden mage → level 30: notice, "Points left: 0", `0/21/0`, "Level 30", "Boss (33, 1317 armor)", Arcane Intellect "(level 56)", DPS shown, URL `#v1.mage.30.0.…`, reload keeps 30 |
| `insight.spec.ts` (2) | warrior v2 golden: Cruelty tooltip "Last point: −x.x DPS" and "−1.00% crit vs target", no next; Deflection "Next point: +0.0 DPS (+0.00%)"; `spec-dps-1` "+x.x DPS", no `spec-dps-0`. Keyboard: focus Cruelty → next, "+" → last; heat map > 20 badges, off → 0 |
| `weights.spec.ts` | closed → no table; open → spell power EP "1.00", spell hit "up to the cap"; 50 iterations → "Sim EP" header and "±" |
| `compare.spec.ts` | pin → URL `GOLDEN~GOLDEN`, delta "+0.0", "Same talents."; right-click Ignite → "−x.x", "Ignite: 5 → 4"; the link reopens both; swap → "Ignite: 4 → 5", "+x.x"; stop → URL = GOLDEN, no table |
| `a11y.spec.ts` (2) | axe: start page (+ footer build text), golden with weights, compare and heat map, talent tooltip, simulation results — no serious/critical; keyboard: level select ArrowDown → 59, heat map Space, weights summary Enter, compare pin Enter |
| `mobile.spec.ts` (+1) | Pixel 5: axe on talents, Stats (reference cards: `ref-row-boss` with a DPS cell, thead ≤ 1 px high, table and page within 393 px) and Damage (compare panel) |

## 9. Performance budgets

| What | Budget (Node test) | Prototype | Browser rule |
|---|---|---|---|
| Panels per state change (`derive` with reference rows) | < 5 ms (unchanged test) | 1.1–3.0 ms; now **once** per change for all panels | — |
| Light derive (`reference: false`) | — | 0.28–0.74 ms | — |
| Talent tooltip (2 light derives) | < 4 ms | 0.75 ms (BM hunter + Cat, raid buffed) | synchronous on hover/focus, memoized |
| Tree totals (3 light derives) | — | ≈ 2 ms | `requestIdleCallback` after each change |
| Heat map, whole class | < 150 ms | 33 ms | idle batches of 6 talents (≤ ~10 ms each), only while the checkbox is on |
| Analytical stat weights (≈ 20 light derives) | < 60 ms | 15 ms | idle, only while the panel is open |
| Simulated weights | — | 85–175 ms per 1000 × 180 s run (Node, mage/warrior): 7–11 runs ≈ 0.6–2 s | worker, progress per run, cancel |
| Compare (build A) | — | 1 full derive per pin + class files (cached) | on pin / link load |

## 10. Ordered task list

Commit after each task (attribution lines per the session reminder). Keep `npm run format:check`, `npm run lint`,
`npm test`, `npm run typecheck` green after every task.

| Task | Work | Acceptance check |
|---|---|---|
| T1 | Read this document | — |
| T2 | Apply **A** | typecheck, lint, format; `npm test` **289** (287 + 2) |
| T3 | Apply **B**; then `python3 tools/pipeline/build_data.py --build 1.60.1.70888 --date 2026-11-13` | pipeline tests **56** OK; report line "manualValidation 0"; `git status data/generated` clean; `npm test` **299** |
| T4 | Apply **C** | `npm test` **304** |
| T5 | Apply **D** | `npm test` **311**; `npm run build` OK |
| T6 | Apply **E** | `npm test` **314** |
| T7 | `npm install --save-dev --save-exact @axe-core/playwright@4.10.2`, then apply **F** | `package.json` devDependency `"@axe-core/playwright": "4.10.2"`; typecheck (e2e types) OK |
| T8 | Apply **G** | pipeline tests **59**; `npm test` **315**; `python3 tools/refresh_build.py --help` prints the usage |
| T9 | Run the three Python scripts of section 8 once (`python3 -I <script> .`) | outputs equal sections 8.1, 8.2, 8.6 |
| T10 | `npm run e2e` (no `playwright install`) | **39** green (desktop + mobile) |
| T11 | Docs (section 11) | docs only |
| T12 | Manual check + screenshots: `docs/screenshots/phase7-insight.png` (desktop, golden mage, heat map on, Ignite tooltip), `phase7-weights-compare.png` (weights open + compare after removing an Ignite point), `phase7-mobile-stats.png` (Pixel 5 Stats tab, reference cards) | screenshots committed with T11 |
| T13 (optional, only on the owner's request) | Try the refresh script: `python3 tools/refresh_build.py --date <today> --report /tmp/refresh.md`; delete `data/generated/<new build>` afterwards unless the owner decides to switch | report like section 1.4 |

## 11. Documentation updates (task T11)

- **KNOWN_LIMITS.md**: L5 → ✅ "Phase 7: level selector 1–60 (base stats interpolated from level 1, `[VERIFY Q76]`)";
  L20 → ✅ "Phase 7: card layout below 600 px". Add rows: **L26** (Gear and stats) "Below 60, base stats are a linear
  interpolation between Classic level-1 and level-60 values (no level-stat table in Forever's client data, Q76); rating
  conversions (hit 10, crit 14, haste 10 per 1%) stay level-60 values; only the highest rank of a buff is modeled, so a
  buff does nothing below its `minLevel`" ⬜; **L27** (Pets) "Pet stats below 60 are interpolated (Q77)" ⬜; **L28**
  (Insight) "Talent impact, tree DPS and stat weights are analytical (simulation-only entries, bursts and the execute
  phase do not count); the simulation weights are on demand and sample the same simulator; the white-attack crit cap
  is not reported as a cap" ⬜; **L29** (UI) "Compare holds one pinned build (A); the URL grows by one build string" ⬜.
- **PLAN.md**: Phase 7 → ✅; tracker row exit criteria unchanged; Phase 7 checkboxes (all [x]): "Default pet for new
  builds (Cat / Imp); links keep what they encode; 'Choose a pet' note only without a pet"; "Talent impact: tooltip
  ΔDPS and key stat changes for the next and last point; per-tree DPS; heat map (idle batches)"; "Stat weights (EP):
  analytical with hit measured to and above the cap; simulated on demand with paired iterations and 95% CI"; "Compare
  two builds: pin A, edit B, `#B~A` links"; "Level selector 1–60: talent points, spell ranks, base stats by level
  (approximation, Q76), weapons and buffs by level, reference mobs, pet level"; "Mobile reference cards (L20); axe-core
  accessibility checks (no serious/critical issues); keyboard access"; "Data refresh script `tools/refresh_build.py`,
  footer build + outdated notice"; "Stretch: companion addon — design sketch in the Phase 7 plan, not built". Output
  line: "manual `level1`/`minLevel` data, `src/state/{insight,weights,compare}.ts`, `src/engine/sim/weights.ts`,
  `src/engine/stats/levels.ts`, Stat weights and Compare panels, `tools/refresh_build.py`. 59 pipeline tests, 315 Vitest
  tests, 39 Playwright tests. Open items: Q76–Q82." Then a new section **"Planned phases complete"**: "Phases 0–7 are
  done. Further work is driven by KNOWN_LIMITS." and **"Next ideas"**: (1) switch to Forever build 1.60.1.70938 (or the
  newest) with `tools/refresh_build.py --switch` and re-derive the moved goldens; (2) L1 full item slots (armor export);
  (3) L2 mana/MP5/spirit gear, then unlimited mana off by default; (4) L11/L12 promote tier-2 specs and add the next
  talent handlers; (5) L15 more procs as simulator events; (6) L22 totems, Shadowfiend, Infernal as timed pets; (7) the
  companion addon (section 12 of the Phase 7 plan) to verify Q4/Q25/Q33/Q69/Q76 with character-sheet exports.
- **CALC_MODEL.md**: section 3 title "Stat conversions" (drop "(level 60)") + paragraph "Levels below 60 (Phase 7)"
  with section 4.2's formulas and `[VERIFY Q76]`; section 5 add "Pet level = player level; `petBaseAt` (Q77)"; new
  section **8 "Insight (Phase 7)"** with sections 4.3 and 4.4 (talent impact = difference of two analytical
  evaluations with the panels' rotation rule; tree contribution; EP definition, reference stat, hit to/above the cap,
  common random numbers for the simulated weights) and the compare definition (A and B evaluated against each one's
  own selected target).
- **ARCHITECTURE.md**: layout tree: `src/ui/results/` "DPS panel, breakdown, stat weights, compare"; new subsection
  "Phase 7: insight, levels, compare" with section 2's module list, the import rule (state-level insight on top of
  `derive`), the shared `useDerived` memo and the idle scheduling; Build URL format: "`level`: 1..60 (the level
  selector writes it)", remove "(v1 writes 60)"; add "**Compare (Phase 7, no new version):** `#<build B>~<build A>`;
  `~` never occurs in a build string, so older links are unchanged; golden
  `#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N~v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N`"; pet record: "new UI builds start with
  a Cat/Imp (`fitToClass`), written as tag 8 like any pet: `#v2.hunter.60.0..CAMCAAA`, `#v2.warlock.60.0..CAMXAAA`";
  manual data: `base-stats.json level1`, `pets.json owners.*.level1`, `buffs.json minLevel/itemId`; worker protocol
  "run | weights"; tests: axe-core via `@axe-core/playwright` 4.10.2.
- **DATA_SOURCES.md** "Refresh procedure": replace steps 1–5 by "Run `python3 tools/refresh_build.py [--build X]
  --date YYYY-MM-DD --report /tmp/refresh.md`" + what the report contains + `--switch` + "run `npm test` and `npm run
  e2e`; re-derive moved goldens with the plans' Python scripts", keep step 3 (research dumps) as optional; add
  "wago.tools rejects Python's default user agent (HTTP 403): the script sends `talentcalc-refresh/1.0`". Add a short
  "Level data (Phase 7)" section with section 1.1's table.
- **OPEN_QUESTIONS.md**: Q14 note "Phase 7: level selector shipped"; add Q76–Q82 (section 13).
- **README.md**: status line adds "insight, levels and polish (Phase 7: talent DPS tooltips and heat map, stat weights,
  compare builds, level selector, mobile cards, accessibility checks, data refresh script)"; usage paragraph: hover a
  talent for its DPS, "Show the DPS of the next point", Level select, Stat weights (Simulate weights), Compare builds
  (the link shares both builds: `#<B>~<A>`); "Data refresh: `python3 tools/refresh_build.py`".
- **CLAUDE.md**: Commands: add "Data refresh: `python3 tools/refresh_build.py [--build X] --date YYYY-MM-DD`
  (report only; `--switch` points the app at the build)". Conventions: add "Insight (`src/state/insight.ts`), stat
  weights (`src/state/weights.ts`, simulated in `src/engine/sim/weights.ts`) and compare (`src/state/compare.ts`) are
  differences of `derive` with `{ reference: false }`; never re-implement a rule there. Base stats below 60 come from
  `base-stats.json level1` (`src/engine/stats/levels.ts`, [VERIFY]). URL: a pinned compare build follows `~`
  (`#<B>~<A>`); `defaultPet` is only for classes picked in the UI. Accessibility: `npm run e2e` runs axe-core; new UI
  must have no serious/critical violations."

## 12. Stretch: companion addon `TalentCalcExport` (design sketch only — not built, cannot be tested here)

Goal: export the in-game character sheet so the calculator's `[VERIFY]` numbers (Q4, Q25, Q33, Q69, Q76) can be checked,
and open the same build in the calculator. Separate repository folder `addon/TalentCalcExport/` (not in the web build,
ignored by eslint/prettier via their ignore lists).

| File | Content |
|---|---|
| `TalentCalcExport_Forever.toc` | `## Interface: 16001` (confirm with `/dump select(4, GetBuildInfo())`), `## Title`, `## Version`, `## SavedVariables: TalentCalcExportDB`, file list |
| `TalentCalcExport.toc` | same, fallback for clients that ignore the `_Forever` suffix |
| `Core.lua` | `local addonName, ns = ...`; event frame (`ADDON_LOADED`, `PLAYER_REGEN_ENABLED`); `ns.db` schema + `MigrateDB()`; slash `/tcexport` (`export`, `link`, `debug`, `about`) |
| `Snapshot.lua` | reads the sheet **out of combat only** (`if InCombatLockdown() then queue for PLAYER_REGEN_ENABLED`); every value goes through `ns.safe(v)` = nil if `issecretvalue and issecretvalue(v)` |
| `Link.lua` | builds the calculator's `#v2.<class>.<level>.0.<talents>.<char>` string from the snapshot (same varint/base64url encoding as `src/state/buildCode.ts`), shown in an edit box to copy |
| `FOREVER_API_NOTES.md` | the verified-API log (one line per API: build, result, date) |
| `.luacheckrc` | Lua 5.1, WoW globals, `TalentCalcExportDB` |

Data to export (each API **must be verified in game** with `/dump` before use; Mainline 12.x names, feature-detected):
`UnitLevel/UnitRace/UnitClass("player")`; `UnitStat("player", 1..5)` (base, effective, pos, neg); `UnitAttackPower`,
`UnitRangedAttackPower`; `GetSpellBonusDamage(2..7)`; `GetCritChance`, `GetRangedCritChance`, `GetSpellCritChance(2..7)`;
`GetHitModifier`, `GetSpellHitModifier` (or the `GetCombatRatingBonus(CR_HIT_*)` family if those are absent);
`GetHaste`/`GetMeleeHaste`, `UnitAttackSpeed`, `UnitDamage`, `UnitRangedDamage`; weapon skill (`GetSkillLineInfo` is
Classic-era — check `C_TradeSkillUI`/`GetWeaponSkill`-style replacements; may be absent: then skip); equipped items
`GetInventoryItemID("player", 16/17/18)`; talents from the Trait API (`C_ClassTalents.GetActiveConfigID()`,
`C_Traits.GetConfigInfo/GetTreeNodes/GetNodeInfo` → node id + `activeRank`; the calculator keys talents by
`TraitNode.ID`, so the export maps 1:1); pet: `UnitExists("pet")`, `UnitCreatureFamily("pet")`, `UnitStat("pet", …)`,
`UnitAttackPower("pet")`. Restrictions: Midnight secret values apply (player stats are expected to be readable out of
combat, but treat every value as possibly secret: never compare or concatenate before `issecretvalue`), the combat log
is closed to addons (no damage logging: DPS validation stays manual), nothing protected is touched. Test checklist for
the owner: `/reload`, `/tcexport export` out of combat (SavedVariables written on logout), `/tcexport link` → paste in
the calculator, compare the Stats panel; repeat in combat (must defer), in an instance, with and without a pet.

## 13. Remaining uncertainties (add as Q76–Q82 to OPEN_QUESTIONS.md, status ❓)

| # | Question | Why it matters | How to resolve |
|---|---|---|---|
| Q76 | Base stats below 60: are Forever's level-1 values the Classic ones (Human 20/20/20/20/21 + class modifiers; health/mana of `player_classlevelstats`) and is the growth close to linear? Does Agility/Intellect per crit scale with the base stat? | Leveling builds: crit, AP, mana | Naked character sheets at 10/30/50 (or the addon) |
| Q77 | Pet stats below 60 (level-1 22/20/22/20/20, linear; damage level ± level/4) | Leveling hunters/warlocks | Pet sheet at two levels |
| Q78 | Buffs below their rank level: does Forever down-rank buffs cast on a lower-level player (Classic 1.12 rule: rank level ≤ target level + 10), or apply the full rank? (The calculator applies nothing below `minLevel`.) | Leveling buffs | Buff a level-40 character with max-rank buffs |
| Q79 | Rating conversions below 60 (hit 10 / crit 14 / haste 10 rating per 1% at 60): level-scaled like TBC? | Low-level weapons with rating | Tooltip % at two levels |
| Q80 | Stat weights use the special-attack hit cap (`hitCap`, 9% vs a boss incl. suppression); for dual wielders white attacks keep missing above it (`whiteHitCap`), which the "above the cap" row measures. Are both caps right in Forever (Q3)? | Hit EP | Q3 tests |
| Q81 | Talent impact on talents the analytical model treats as simulation-only (bursts, execute phase) shows 0 DPS: should the tooltip use the simulator for them (on demand)? | Tooltip completeness | Owner preference |
| Q82 | Does Forever keep releasing builds that change talent values (70938 changed Wrack)? How often should the data be refreshed (footer warns after 90 days)? | Data freshness | Watch wago.tools |
