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
| Icons | Spell icon file IDs → icon names via a listfile; served from a public icon CDN or bundled | Decided in Phase 1 (OPEN_QUESTIONS Q9) |

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

## Generated data contracts (summary)

```ts
// talents.json (per class)
interface ClassTree { classId: number; specs: Spec[] }
interface Spec { name: string; icon: string; talents: Talent[] }
interface Talent {
  nodeId: number; tier: number; col: number; maxRank: number;
  requiredPoints: number;            // in this spec
  prereqNodeId?: number;             // must be maxed
  ranks: { spellId: number; description: string }[];
  effects: EffectRef[][];            // per rank, decoded SpellEffect rows
  choice?: Talent[];                 // Type 1 nodes
}
// spells.json (only spells reachable from class abilities + talents + procs)
interface Spell { id; name; rank?; school; castMs; gcdMs; cooldownMs; cost: {type; amount|pct};
  rangeYd; durationMs; family: { set: number; mask: [n,n,n,n] }; effects: SpellEffect[] }
// items.json: weapons (+ later armor), already resolved to min/max/speed/stats
```

`family.mask` plus talents' `EffectSpellClassMask` lets a talent find the spells it modifies with
no hand-written mapping. The pipeline also writes `coverage.json` (which talents are generic, special or unsupported).

## Key design rules

1. **Data-driven first.** Hand-code only what the data can't express, and key it by spell ID.
2. **Engine is pure.** Same inputs give the same outputs; the RNG is injected and seeded.
3. **Every constant is cited and tagged** `[VERIFY]` until it is confirmed in Forever.
4. **The build is the URL.** Class, talent ranks, gear, buffs, rotation and target are serialized compactly.
5. **Build pinning.** The app shows which Forever build its data came from.
