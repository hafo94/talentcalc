# talentcalc

A Classic-style talent calculator for **WoW Forever** that also calculates hit, crit and damage
per ability, weapon damage, pet damage and rotation DPS for your build.

Status: data pipeline complete (Phase 1). See [docs/PLAN.md](docs/PLAN.md).

| Doc | Contents |
|---|---|
| [PLAN](docs/PLAN.md) | Phases and progress tracker |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Stack, layout, data contracts |
| [CALC_MODEL](docs/CALC_MODEL.md) | Damage, hit and crit formulas |
| [DATA_SOURCES](docs/DATA_SOURCES.md) | Where game data comes from; research findings |
| [OPEN_QUESTIONS](docs/OPEN_QUESTIONS.md) | Assumptions to verify in game |
| [research/](docs/research/) | Generated dumps of every Forever talent tree and class spell |

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
