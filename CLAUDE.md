# CLAUDE.md

WoW **Forever** (Classic Plus, product `wowf`, client 1.60.x on the modern engine) talent
calculator + DPS calculator. It is a static web app (Vite + React + TS web app; Python data pipeline).

## Read first
- `docs/PLAN.md`: phase tracker. Update it in the same commit as the work.
- `docs/DATA_SOURCES.md`: where the data comes from and how the Forever talent system is encoded.
- `docs/KNOWN_LIMITS.md`: missing features/simplifications (update when you fix or add one).
- `docs/CALC_MODEL.md`: formulas. `docs/OPEN_QUESTIONS.md`: unverified assumptions.

## Critical facts
- Forever talents live in the **Trait*** DB2 tables. The legacy `Talent`/`TalentTab` tables are stale
  Classic Era data. Do not use them at all (per-rank values come from `TraitDefinitionEffectPoints` curves).
- Talents and spells changed a lot from Classic. Never hard-code Classic talent values; read SpellEffect.
- Constants not confirmed in game are tagged `[VERIFY]` with a source comment.

## Commands
- Fetch data: `tools/research/fetch_db2.sh <build> data/raw/<build>` (latest build: wago.tools `/api/builds` → `wowf`)
- Fetch Classic Era items (weapon fallback): `tools/pipeline/fetch_era_items.sh 1.15.9.70576`
- Build data: `python3 tools/pipeline/build_data.py --build 1.60.1.70888` → `data/generated/<build>/` (commit it; never hand-edit)
- Test pipeline: `python3 -m unittest discover -s tools/pipeline/tests -t tools -v`
- Data refresh: `python3 tools/refresh_build.py [--build X] --date YYYY-MM-DD` (report only; `--switch` points the app at the build)
- Research dumps: `python3 tools/research/extract_research.py data/raw/<build> docs/research`

- Web app: `npm ci`, `npm run dev`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run e2e`, `npm run build`
  (`npm run e2e:install` once for Playwright browsers; run e2e with `--trace off`)

## Conventions
- The engine (`src/engine/`) is pure TS: no React, no DOM, seeded RNG only.
- Generated data is never hand-edited. Hand-maintained data lives in `data/manual/` with sources cited.
- `data/raw/` is git-ignored.
- Data build for the app is set in `vite.config.ts` (`DATA_BUILD`) and `tsconfig.app.json` paths.
- Talent rules live in `src/engine/talents` (pure). The UI never re-implements a rule.
- Damage rules live in `src/engine/{combat,abilities,rotation}` and `src/engine/talents/special` (22 hand-written talent handlers keyed by talent spell id). Class spells come from `data/generated/<build>/spells/<class>.json` (lazy, pipeline v4). Default rotations: `data/manual/rotations.json`; the editor's rotation and sim settings are URL tags 6/7 of the v2 payload (`ENTRY_KINDS`, `PROC_AURAS`, `CONDITION_TYPES` are append-only). The simulator (`src/engine/sim`) never computes damage: it samples `AbilityResult.parts` and `WhiteResult` from the Phase 4 evaluator; seeded RNG only (`iterationSeed`). Spell values are Forever data, never Classic: golden tests in `src/engine/rotation/golden.test.ts`.
- Stat rules live in `src/engine/stats` (pure; every number is a `Stat` with parts). Character state is `src/state/character.ts`, derived values `src/state/derived.ts`.
- Manual data is imported through the `@manual` alias. Buff/racial values carry `effects[].src`; the pipeline validates them against `SpellEffect`. Buff `code`s are never reused.
- URL: `#v1` talent-only, `#v2` with character payload (`src/state/charCode.ts`). Existing links must keep decoding.
- Pets come from `data/generated/<build>/pets/<owner>.json` (pipeline v4) and `data/manual/pets.json` ([VERIFY] base stats/scaling); the pet engine (`src/engine/pets`) reuses `computeCharacter`, `evaluateTarget`, `evaluateAbility` and `runRotation`; in the simulator a pet is a `FightModel` run by the same `Fight` with its own RNG stream; URL tag 8 (`PetChoice`).
- Insight (`src/state/insight.ts`), stat weights (`src/state/weights.ts`, simulated in `src/engine/sim/weights.ts`) and compare (`src/state/compare.ts`) are differences of `derive` with `{ reference: false }`; never re-implement a rule there. Base stats below 60 come from `base-stats.json level1` (`src/engine/stats/levels.ts`, [VERIFY]). URL: a pinned compare build follows `~` (`#<B>~<A>`); `defaultPet` is only for classes picked in the UI. Accessibility: `npm run e2e` runs axe-core; new UI must have no serious/critical violations.
