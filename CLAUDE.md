# CLAUDE.md

WoW **Forever** (Classic Plus, product `wowf`, client 1.60.x on the modern engine) talent
calculator + DPS calculator. It is a static web app (planned stack: Vite + React + TS; Python data pipeline).

## Read first
- `docs/PLAN.md`: phase tracker. Update it in the same commit as the work.
- `docs/DATA_SOURCES.md`: where the data comes from and how the Forever talent system is encoded.
- `docs/CALC_MODEL.md`: formulas. `docs/OPEN_QUESTIONS.md`: unverified assumptions.

## Critical facts
- Forever talents live in the **Trait*** DB2 tables. The legacy `Talent`/`TalentTab` tables are stale
  Classic Era data. Do not use them for trees (only as a rank-spell lookup where rank counts match).
- Talents and spells changed a lot from Classic. Never hard-code Classic talent values; read SpellEffect.
- Constants not confirmed in game are tagged `[VERIFY]` with a source comment.

## Commands
- Fetch data: `tools/research/fetch_db2.sh <build> data/raw/<build>` (latest build: wago.tools `/api/builds` → `wowf`)
- Research dumps: `python3 tools/research/extract_research.py data/raw/<build> docs/research`

## Conventions
- The engine (`src/engine/`) is pure TS: no React, no DOM, seeded RNG only.
- Generated data is never hand-edited. Hand-maintained data lives in `data/manual/` with sources cited.
- `data/raw/` is git-ignored.
