# CLAUDE.md

WoW **Forever** (Classic Plus, product `wowf`, client 1.60.x on the modern engine) talent
calculator + DPS calculator. It is a static web app (Vite + React + TS web app; Python data pipeline).

## Read first
- `docs/PLAN.md`: phase tracker. Update it in the same commit as the work.
- `docs/DATA_SOURCES.md`: where the data comes from and how the Forever talent system is encoded.
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
- Research dumps: `python3 tools/research/extract_research.py data/raw/<build> docs/research`

- Web app: `npm ci`, `npm run dev`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run e2e`, `npm run build`
  (`npm run e2e:install` once for Playwright browsers; run e2e with `--trace off`)

## Conventions
- The engine (`src/engine/`) is pure TS: no React, no DOM, seeded RNG only.
- Generated data is never hand-edited. Hand-maintained data lives in `data/manual/` with sources cited.
- `data/raw/` is git-ignored.
- Data build for the app is set in `vite.config.ts` (`DATA_BUILD`) and `tsconfig.app.json` paths.
- Talent rules live in `src/engine/talents` (pure). The UI never re-implements a rule.
