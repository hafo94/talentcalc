# WoW Forever Talent & DPS Calculator — Project Plan

**Goal:** A talent calculator identical in look and feel to the Classic WoW calculator. It also
computes, for the chosen build, hit, crit and damage per ability, weapon-based damage, pet damage,
and rotation DPS. Every talent point shows the DPS, hit and crit it adds.

**Data:** WoW Forever client build data (DB2 via wago.tools). See DATA_SOURCES.md.
**Math:** CALC_MODEL.md. **Structure:** ARCHITECTURE.md. **Unknowns:** OPEN_QUESTIONS.md.

Status legend: ⬜ not started · 🟨 in progress · ✅ done · ⛔ blocked

## Phase tracker

| Phase | Name | Status | Exit criteria |
|---|---|---|---|
| 0 | Research & planning | ✅ | Data source found, talent system decoded, docs written |
| 1 | Data pipeline | ⬜ | `data/generated/<build>/` JSON for all 9 classes, with tests and a coverage report |
| 2 | Talent calculator (UI parity) | ⬜ | All 27 specs render; point rules exactly like Classic; URL sharing |
| 3 | Character & gear model | ⬜ | Class/race/level, weapon picker, gear stats, buffs, target → derived stats panel |
| 4 | Damage engine (analytical) | ⬜ | Per-ability hit/crit/avg damage; talent effects applied; live DPS for default rotations |
| 5 | Rotations & simulation | ⬜ | Rotation editor, Web Worker sim, DPS ± stdev, damage breakdown |
| 6 | Pets | ⬜ | Hunter + Warlock pet damage included in total DPS |
| 7 | Insight, levels & polish | ⬜ | Talent-impact tooltips, stat weights, level selector with level-based targets, compare builds, mobile, deploy |

---

## Phase 0 — Research & planning ✅
- [x] Find a machine-readable data source for Forever (wago.tools, product `wowf`)
- [x] Discover that Forever uses `Trait*` tables (the legacy `Talent` table is stale Classic data)
- [x] Decode tree layout: spec columns, tiers, gates, prereqs, the 51-point currency
- [x] Dump all 27 spec trees → `docs/research/talents/`
- [x] Dump class spells and rank chains → `docs/research/class-spells.md`
- [x] Confirm spell base points and coefficients exist in client data
- [x] Confirm weapon damage reconstruction (ItemDamage tables)
- [x] Write PLAN, ARCHITECTURE, CALC_MODEL, DATA_SOURCES, OPEN_QUESTIONS, CLAUDE.md
- [x] Owner decisions: website; default boss target + level-based reference mobs; level 60 first

## Phase 1 — Data pipeline ⬜
- [ ] `tools/pipeline/build_data.py`: raw CSV → `data/generated/<build>/`
- [ ] Talent trees: specs, tiers, cols, gates, prereqs, choice nodes; exclude flag-8 nodes (configurable)
- [ ] Per-rank talent values (legacy rank spells where counts match; `TraitDefinitionEffectPoints` curves otherwise) — Q7
- [ ] Spells: every class ability rank + talent-granted spells + triggered/proc spells (follow `EffectTriggerSpell`)
- [ ] Spell descriptions with `$s1`/`$d`/`$o1` tokens resolved per rank (tooltips)
- [ ] Spell family masks for talent → spell matching
- [ ] Weapons: min/max/speed/type/stats from ItemSparse + ItemDamage tables — Q8
- [ ] Icons: resolve the icon source — Q9
- [ ] Target presets from `ExpectedStat` (armor/HP per level) → `targets.json`
- [ ] Manual data scaffolding: `data/manual/` (base stats, pet families, named targets, raid buffs)
- [ ] Pipeline tests (node counts per spec, known talents present, Fireball r1 = 14–22, Sulfuras = 223–372)
- [ ] `coverage.json`: each talent marked generic / special / unsupported

## Phase 2 — Talent calculator (Classic UI parity) ⬜
- [ ] Vite + React + TS scaffold, lint, Vitest, Playwright, GitHub Pages deploy workflow
- [ ] Class picker (9 class icons) → three trees side by side with Classic backgrounds
- [ ] Talent node: icon, rank badge `x/y`, grey/green/yellow states, prerequisite arrows
- [ ] Rules: 51 points (level-based: points = level − 9), 5 points per tier per spec, prereqs maxed,
      can't remove a point that would invalidate a dependent talent or a higher tier
- [ ] Left-click add / right-click remove; per-tree reset; reset all; points spent per tree, e.g. "31/20/0"
- [ ] Tooltips identical in style to Classic: name, rank, next rank, requirements, description
- [ ] URL hash encoding of build and level; copy-link button
- [ ] Engine unit tests for every point rule

## Phase 3 — Character & gear model ⬜
- [ ] Class, race, level (60 first; Q14) → base stats (manual table)
- [ ] Weapon picker: searchable MH / OH / ranged / wand, filtered by class proficiency
- [ ] Gear stat input: v1 manual "bonus stats" panel (AP, SP, hit, crit, stats); v2 full item slots
- [ ] Buffs and consumables toggles (raid buffs, world buffs, flasks, elixirs, weapon oils/stones)
- [ ] Target picker: Boss (L+3, default), Elite (L+2), Same-level, Low-armor boss, Custom; debuffs (Sunder, FF, CoR, Curse of Elements…)
- [ ] DPS shown against the selected target, plus a small table of the same build vs every reference mob
- [ ] Talent stat modifiers applied (generic mapper, aura 107/108/137/52/57/54/55/79)
- [ ] Derived stats panel: AP, RAP, SP per school, melee/ranged/spell hit and crit, haste, weapon DPS

## Phase 4 — Damage engine (analytical) ⬜
- [ ] Outcome tables: melee white, melee special, ranged, spell
- [ ] Armor mitigation, partial resists, glancing
- [ ] Spell damage (direct, DoT, channeled) with coefficients and talent mods
- [ ] Weapon specials (Heroic Strike, Sinister Strike, Aimed Shot, Stormstrike…)
- [ ] Special-case talent handlers (DUMMY auras: Ignite, Fire Power, Seals, Nightfall, Clearcasting, …)
- [ ] Per-ability card: avg hit, crit, expected per cast, DPCT, hit/crit chance, and their talent sources
- [ ] Default priority rotations for every DPS spec; analytical DPS (live on every click)
- [ ] Golden tests per class

## Phase 5 — Rotations & simulation ⬜
- [ ] Rotation editor: drag-and-drop priority list with conditions
- [ ] Event-driven simulator in a Web Worker (GCD, casts, swings, resources, procs, DoTs, cooldowns)
- [ ] Seeded RNG, N iterations, fight-length setting, execute phase
- [ ] Results: DPS mean ± stdev, damage breakdown table/pie, casts per fight, resource graph
- [ ] Cross-check analytical vs sim (within 3% on simple rotations)

## Phase 6 — Pets ⬜
- [ ] Hunter pets: family picker, family modifiers, BM talents, pet abilities, focus model
- [ ] Warlock demons: Imp, Succubus, Felhunter (+ others found in data); Demonology talents; Demonic Sacrifice
- [ ] Other summons in Forever (totems, Water Elemental, Feral Spirit-like if present)
- [ ] Pet damage included in total DPS and the breakdown — Q5 scaling

## Phase 7 — Insight & polish ⬜
- [ ] Talent impact: hover shows ΔDPS, Δhit and Δcrit of the next and previous point
- [ ] Stat weights (EP values)
- [ ] Compare two builds side by side
- [ ] Level selector (1–60): talent points = level − 9, spell ranks by level, reference mobs rescale to the chosen level
- [ ] Mobile layout; accessibility pass
- [ ] Data refresh doc + script for new Forever builds; build version shown in the footer
- [ ] Stretch: companion addon that exports character-sheet stats for validation

---

## Working agreements
- One phase at a time; update this tracker (status emoji + checkboxes) in the same commit as the work.
- New unknowns go in OPEN_QUESTIONS.md. Resolved answers are recorded there with their source.
- Every `[VERIFY]` constant stays tagged until it is confirmed in game.
