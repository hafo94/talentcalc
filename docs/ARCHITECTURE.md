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
| Simulation | Web Worker (Comlink) | Keeps the UI responsive during multi-iteration sims |
| Tests | Vitest (engine and pipeline output), Playwright (UI smoke) | |
| Data pipeline | Python 3 (stdlib csv/json) | CSVs in, compact JSON out; already used for research |
| Data loading | `@data` alias → `data/generated/<build>` (set in `vite.config.ts` and `tsconfig.app.json`). `classes.json` and `manifest.json` are static imports, each `talents/<class>.json` is lazy-loaded per class, `spells.json` is not loaded by the talent UI | Small first load; one ~6 KB gzip chunk per class |
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
| `spells.json` | every class ability rank, talent spell and triggered spell (2,300) + `abilities[]` rank chains |
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

**Manual data** (`data/manual/`, alias `@manual`, static imports): `base-stats.json` (level 60 class bases, race offsets, AP/crit/health/mana
conversions), `buffs.json` (stable URL `code`, exclusive `group`, `effects[].src` = the `SpellEffect` column the value was read from, `presets`),
`racials.json`. The pipeline checks every `src` against `SpellEffect` and reports mismatches in `report.manualValidation`.

**Data loading:** `weapons.json` (~107 KB gzip) is a lazy chunk, loaded in the background after the first class is selected and awaited only
when a link contains weapons. `targets.json` and the manual files are static imports.

**Stat engine** (`src/engine/stats`, pure): `constants`, `stat` (Stat = value + parts, so every number can explain itself), `types`, `equip`,
`talentEffects` (generic aura mapper), `assemble` (racials + buffs + talents -> input), `character` (`computeCharacter`), `target`
(`evaluateTarget`), `weapons` (proficiency, picker, ammo). State is two stores: `useCalc` (talents) and `useCharacter` (race, weapons, bonus
stats, buffs, target); `src/state/derived.ts` combines them.

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
4. **The build is the URL.** Class, talent ranks, gear, buffs, rotation and target are serialized compactly.
5. **Build pinning.** The app shows which Forever build its data came from.
