# talentcalc

A Classic-style talent calculator for **WoW Forever** that also calculates hit, crit and damage
per ability, weapon damage, pet damage and rotation DPS for your build.

Status: data pipeline (Phase 1), talent calculator (Phase 2), character, gear, buffs, target and derived stats (Phase 3) and the analytical damage engine (Phase 4: Damage panel with per-ability cards, DPS breakdown, DPS per reference target) complete. See [docs/PLAN.md](docs/PLAN.md).

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

## Web app (Phases 2-4)
```
npm ci
npm run dev                       # open http://localhost:5173/talentcalc/
npm test                          # Vitest: data invariants, rules engine, URL codec, UI models
npm run e2e:install && npm run e2e   # Playwright smoke tests (desktop + mobile)
npm run build && npm run preview  # production build, served at http://localhost:4173/talentcalc/
```
Builds are shareable by URL hash (`#v1.mage.60.0.<payload>` for talents only, `#v2...` when the character has race, weapons, bonus stats, buffs or a target set; see ARCHITECTURE). Screenshots: `docs/screenshots/`.

Deploy: `.github/workflows/deploy.yml` runs only on pushes to `main` (or manually). The repository currently has only the
`claude/...` branch, so create `main` / merge into it. Enable Pages once: *Settings -> Pages -> Build and deployment -> Source:
GitHub Actions*. The site is then served at `https://<owner>.github.io/talentcalc/`. If the repository is renamed, change `base`
in `vite.config.ts`.
