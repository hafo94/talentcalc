# Architecture

## Product shape

A **static web app**: a Classic-style talent calculator with a damage engine attached.
It has no backend. All game data ships as versioned JSON generated offline, and the app is shareable by URL
(build encoded in the URL hash, as Wowhead does). It is hosted free on GitHub Pages.

An in-game addon is out of scope for v1. It may come later only as a companion that exports
character-sheet stats for validation (see the Phase 7 stretch goal).

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One language for engine and UI; types for game data |
| UI | React 18 + Vite | Fast dev loop, static build |
| Styling | CSS modules + CSS variables | Classic tree look without a heavy UI kit |
| State | Zustand 5 | Small; the build/character state is one store |
| Engine | Plain TS modules, no React imports | Unit-testable, runs in a Web Worker |
| Simulation | Web Worker (plain postMessage, no library) | Keeps the UI responsive during multi-iteration sims; protocol run -> progress* -> result/error, cancel = terminate |
| Tests | Vitest (engine and pipeline output), Playwright (UI smoke) | |
| Data pipeline | Python 3 (stdlib csv/json) | CSVs in, compact JSON out; already used for research |
| Data loading | `@data` alias → `data/generated/<build>` (set in `vite.config.ts` and `tsconfig.app.json`). `classes.json` and `manifest.json` are static imports, each `talents/<class>.json` and `spells/<class>.json` are lazy-loaded per class, `spells.json` is not loaded by the app; `spells/<class>.json` is lazy-loaded together with the talent file (Phase 4) | Small first load; one ~6 KB gzip chunk per class |
| Icons | Spell icon file IDs → icon names via `ManifestInterfaceData`; served from the Blizzard render CDN (Zamimg fallback), not bundled | Decided in Phase 1 (Q9) |

## Repository layout (target)

```
talentcalc/
├─ CLAUDE.md                 working agreement for AI sessions
├─ docs/                     PLAN, ARCHITECTURE, CALC_MODEL, DATA_SOURCES, OPEN_QUESTIONS, research/
├─ tools/
│  ├─ research/              fetch_db2.sh, extract_research.py (exploration dumps)
│  └─ pipeline/              build_data.py → data/generated/*.json (production)
├─ data/
│  ├─ raw/<build>/           DB2 CSVs (git-ignored)
│  ├─ manual/                hand-maintained JSON: base stats, pet families, boss presets, buffs, rotations
│  └─ generated/<build>/     pipeline output (committed, so the app builds without network access)
├─ src/
│  ├─ data/                  typed loaders for generated JSON
│  ├─ engine/
│  │  ├─ stats/              aggregation, derived stats
│  │  ├─ talents/            tree rules (points, tiers, prereqs) + effect mapping; special/ handlers
│  │  ├─ combat/             outcome tables, armor, resist, damage formulas
│  │  ├─ abilities/          per-ability evaluators (generic + class overrides)
│  │  ├─ pets/
│  │  ├─ rotation/           priority lists, analytical model
│  │  └─ sim/                event-driven simulator (worker entry)
│  ├─ state/                 Zustand store, URL (de)serialization
│  └─ ui/
│     ├─ talents/            TalentTree, TalentNode, tooltips (Classic look)
│     ├─ character/          class/race/level, gear + weapon picker, buffs, target
│     ├─ rotation/           priority list editor
│     └─ results/            DPS panel, breakdown, stat weights, talent impact
└─ tests/
```

## Generated data contracts

Pipeline output lives in `data/generated/<build>/` (committed). The authoritative schemas are in
[phase1-implementation-plan.md](phase1-implementation-plan.md) section 2.1; summary:

| File | Contents |
|---|---|
| `manifest.json` | build, era build, date, options, icon URL templates, raw table hashes, output counts |
| `classes.json` | 9 classes (id, token, name, color, spellClassSet, powerType, icon, traitTreeId, skillLineIds, 3 specs each, `raceIds` (CharBaseInfo), `weaponSubclasses`, `dualWield` (SkillLineAbility)), 8 races, talent currency sources |
| `talents/<token>.json` | one per class: 3 specs, each with `tierGates[]` and `talents[]` sorted by (tier, col) |
| `spells.json` | every class ability rank, talent spell and triggered spell (2,340) + `abilities[]` rank chains (tools and tests) |
| `spells/<token>.json` | Phase 4: the class's records of `spells.json` plus its ability chains; one lazy chunk per class (17-29 KB gzip). Seal judgements are followed through DUMMY base points ("Seal of" / "Judgement of" to "Judgement of ...") |
| `weapons.json` | weapons (min/max/speed/dps/stats; `source` is `forever` or `classic_era`) + ammo |
| `targets.json` | `ExpectedStat` levels 1..63, the five target presets, and `byPlayerLevel` 1..60 |
| `pet-families.json` | `CreatureFamily` list |
| `coverage.json` | per-talent `generic` / `special` / `unsupported` classification + summary |
| `report.json` | pipeline decisions and warnings (hidden nodes, position fixes, curve/base mismatches, filters, unresolved tokens) |

```ts
interface Talent {
  nodeId: number; entryId: number; definitionId: number; spellId: number;
  name: string; icon: string | null; iconFileId: number;
  tier: number; col: number; maxRank: number; requiredPoints: number;   // in this spec
  prereqNodeId?: number;             // must be maxed
  kind: "passive" | "ability"; hidden?: true;
  valueSources: ("curve" | "base")[];                 // parallel to spells[spellId].effects
  ranks: { rank: number; values: number[]; description: string; unresolved?: string[] }[];   // length maxRank
  choices?: Omit<Talent, "tier" | "col" | "requiredPoints" | "prereqNodeId">[];   // never present in v1 class trees
}
interface Spell {
  id: number; name: string; subtext: string | null; rank: number | null; classIds: number[];
  sources: ("ability" | "talent" | "triggered")[]; icon: string | null; school: number;
  passive: boolean; castMs: number; gcdMs: number; cooldownMs: number;
  costs: { powerType: number; amount: number; pct: number; perLevel: number; perSecond: number; optional: number }[];
  range: { min: number; max: number } | null; duration: { ms: number; perLevel: number; maxMs: number } | null;
  family: { set: number; mask: [number, number, number, number] } | null;   // talent masks match this
  effects: SpellEffect[];            // Difficulty 0, sorted by index; talent ranks[].values is parallel to this
  /* ... see the plan for the full list */
}
```

`family.mask` plus talents' `EffectSpellClassMask` lets a talent find the spells it modifies with
no hand-written mapping. `coverage.json` shows which talents are generic, special or unsupported.

`classes.json` talent-currency sources may carry `perk {nodeId, entryId, rank, spellId, name}` (the account-wide
"Talented" Legacy perk, ranks 1..5 grant the points of levels 9..5).

**Gate counting (Q28):** a tier gate counts `countedNodeIds` filtered to nodes in a lower tier than the gate, because the raw
scope of every tier-7 gate (and Discipline's tier-3 gate) contains the gated node itself. Nodes of lower tiers that are missing from
a gate's scope (Q21: Holy Specialization, Improved Serpent Sting) do not count. Rules live in `src/engine/talents` and the UI never
re-implements them.

Phase 3 additions: `Talent.effects[]` (`index, effect, aura, misc, mask, targets`, parallel to `ranks[].values`), `Talent.equipped`
(`{itemClass, subclassMask, invTypeMask}` from `SpellEquippedItems`, or null) and `Talent.shapeshiftMask` (`SpellShapeshift`); the same
`equipped`/`shapeshiftMask` fields exist on every `Spell`. The app still does not load `spells.json`.

**Manual data** (`data/manual/`, alias `@manual`, static imports): `rotations.json` (Phase 4: 27 default priority rotations, tiers 1-3), `base-stats.json` (level 60 class bases, race offsets, AP/crit/health/mana
conversions), `buffs.json` (stable URL `code`, exclusive `group`, `effects[].src` = the `SpellEffect` column the value was read from, `presets`),
`racials.json`. The pipeline checks every `src` against `SpellEffect` and reports mismatches in `report.manualValidation`.

**Data loading:** `weapons.json` (~107 KB gzip) is a lazy chunk, loaded in the background after the first class is selected and awaited only
when a link contains weapons. `targets.json` and the manual files are static imports.

**Stat engine** (`src/engine/stats`, pure): `constants`, `stat` (Stat = value + parts, so every number can explain itself), `types`, `equip`,
`talentEffects` (generic aura mapper), `assemble` (racials + buffs + talents -> input), `character` (`computeCharacter`), `target`
(`evaluateTarget`), `weapons` (proficiency, picker, ammo). State is two stores: `useCalc` (talents) and `useCharacter` (race, weapons, bonus
stats, buffs, target); `src/state/derived.ts` combines them.

**Damage engine (Phase 4, pure, import direction `stats` <- `combat` <- `abilities` <- `talents/special` <- `rotation`):** `src/engine/combat`
(constants, outcome tables), `abilities` (spellbook, spell mods, `evaluateAbility`, `evaluateWhite`, `SCRIPTS`), `talents/special` (22 handlers keyed by talent
spell id with stats / ability / rotation hooks), `rotation` (`pickRotation`, `prepareDamage`, `runRotation`, `evaluateDamage`, two passes). State: `CalcState.spells`
is loaded with the tree; `derive` returns `damage` (null while spells load), `notModeled` (minus handled talents and rotation abilities) and fills `dps` on every
reference target row. UI: `src/ui/results` (Damage panel, DPS breakdown), `src/ui/abilities` (ability cards). Per-click cost 1-2 ms for 5 targets x 2 passes.
No URL change: the rotation is chosen from the spec with the most points (the editor and its URL record are Phase 5).

## Phase 5: rotations and simulation

```
src/engine/rotation/conditions.ts   condition helpers: conditionsHold, simOnlyReason, enabledRotation, CONDITION_TYPES (append-only)
src/engine/rotation/catalog.ts      abilityCatalog: abilities the editor offers, URL ids, default entries
src/engine/sim/{types,constants,rng,queue,procs,model,engine,run,worker,index}.ts
src/state/rotation.ts               useRotation (custom rotation, sim settings), URL mapping (ENTRY_KINDS, PROC_AURAS append-only)
src/state/sim.ts                    useSim: worker client (run, progress, cancel)
src/state/derived.ts                derive(calc, ch, custom), simInputFor
src/ui/rotation/ , src/ui/sim/      RotationEditor, SimPanel (+ CSS modules)
src/testkit/sim.ts                  test-only simInput(scenario)
```
Import direction: `stats` <- `combat` <- `abilities` <- `talents/special` <- `rotation` (incl. `conditions`, `catalog`) <- `sim`. `src/state` imports `engine/*`;
`src/ui` imports `state`. `engine/sim/worker.ts` is only referenced by `state/sim.ts` through `new URL(...)`. The simulator never computes damage; it samples the
Phase 4 evaluator's parts. Seeded RNG only (`iterationSeed(seed, i)`), so results do not depend on batching.

## Build URL format

```
#v1.<classToken>.<level>.<talentedRank>[.<payload>]
```
- `v1`: format version. Any other prefix is a decode error.
- `classToken`: lowercase class token (`mage`). `level`: 1..60 (v1 writes 60). `talentedRank`: one digit 0..5 (UI writes 0 or 5).
- `payload`: omitted when no points are spent. Otherwise unpadded base64url of unsigned LEB128 varints, one per invested node sorted by
  node ID: `(nodeId - previousNodeId) * 8 + rank` (rank 1..7). Node IDs are stable `TraitNode.ID` keys, so links survive layout changes
  and regenerated data; unknown nodes are dropped on load (`sanitize`). Golden vector: Mage Fire 33 / Frost 18 is
  `#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N`. See `src/state/buildCode.ts`.

**v2** (Phase 3): `#v2.<classToken>.<level>.<talentedRank>.<talentPayload>.<charPayload>` (exactly six parts; `talentPayload` may be empty).
The encoder writes v1 whenever the character is default, so talent-only links never change. `charPayload` is unpadded base64url of
tag-length-value records, tags ascending, default records omitted, unknown tags skipped: 1 race, 2 weapons (MH, OH, ranged, ammo ids),
3 bonus stats (index + zigzag value, x100 for percent fields), 4 buff codes, 5 target (preset index, plus level/armor/resists for custom).
Golden: `#v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8` (Human Warrior, Cruelty 5/5, Arcanite Reaper, bonus stats, raid buffs
+ Sunder, Faerie Fire, CoR). See `src/state/charCode.ts` and `charCode.test.ts`.

**Phase 5 records (still v2, no v3):** tag 6 rotation (`spec [abilityId, head, [cp], [everySec x 10], [n, (type x 2 + flag, operand)...]]...`, written only after an edit
or a "Based on" choice; abilities are the first spell id of their rank chain or the talent spell id) and tag 7 simulation (`fightSec, iterations, seed, unlimitedMana`,
omitted when 180, 1000, 1, 1). Older decoders skip unknown tags; v1/v2 links decode unchanged. Goldens (independent Python encoder):
`#v2.warrior.60.0..BgEB` (rotation based on Fury) and
`#v2.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N.BhMCk16XAQEAyAF0A9gQgAEBBMgBBwasAtAPKgA` (Fire 33 / Frost 18, edited Frost rotation, 300 s x 2000, seed 42, mana on).
See `src/state/rotation.ts`.

## Tree backgrounds

Classic background art is hotlinked from `https://wow.zamimg.com/images/wow/talents/backgrounds/classic/{talentTabId}.jpg` and drawn over
a per-spec CSS gradient with a spec-icon watermark. If the image fails only the gradient shows. `REMOTE_BACKGROUNDS` in
`src/data/assets.ts` switches the remote art off in one place (Q30).

**Icons (decision, Q9):** data carries icon *names* (file data ID resolved through `ManifestInterfaceData`). The app loads
`https://render.worldofwarcraft.com/us/icons/56/{icon}.jpg` with `https://wow.zamimg.com/images/wow/icons/large/{icon}.jpg` as
fallback (`manifest.json` holds both templates). Icons are not bundled in v1; `tools/pipeline/check_icons.py` reports
names missing on both CDNs.

## Key design rules

1. **Data-driven first.** Hand-code only what the data can't express, and key it by spell ID.
2. **Engine is pure.** Same inputs give the same outputs; the RNG is injected and seeded.
3. **Every constant is cited and tagged** `[VERIFY]` until it is confirmed in Forever.
4. **The build is the URL.** Class, talent ranks, gear, buffs, rotation (Phase 5: tag 6/7) and target are serialized compactly.
5. **Build pinning.** The app shows which Forever build its data came from.
