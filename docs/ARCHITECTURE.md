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
| State | Zustand | Small; the build/character state is one store |
| Engine | Plain TS modules, no React imports | Unit-testable, runs in a Web Worker |
| Simulation | Web Worker (Comlink) | Keeps the UI responsive during multi-iteration sims |
| Tests | Vitest (engine and pipeline output), Playwright (UI smoke) | |
| Data pipeline | Python 3 (stdlib csv/json) | CSVs in, compact JSON out; already used for research |
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
| `classes.json` | 9 classes (id, token, name, color, spellClassSet, powerType, icon, traitTreeId, skillLineIds, 3 specs each), 8 races, talent currency sources |
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
