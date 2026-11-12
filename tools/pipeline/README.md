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

Manual-value check (Phase 3): `effects[].src = {effectIndex, field?, mult?}` in `data/manual/buffs.json` and `racials.json` names the `SpellEffect` column a value
was read from; the pipeline recomputes it and lists mismatches in `report.manualValidation` (must stay empty; a unit test enforces it).
