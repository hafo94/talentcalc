# Open questions / things to verify

Status: ❓ open · 🔬 investigating · ✅ resolved (record the answer and source)

| # | Question | Why it matters | How to resolve | Status |
|---|---|---|---|---|
| Q1 | Platform: web app or in-game addon? | Shapes the whole stack | Owner decision | ✅ Website (owner, 2026-11-12) |
| Q2 | Are high-rank spell base points retuned in Forever? Fireball r11 data gives ~397–505 (Classic 561–715) | Every damage number | Compare in-game tooltips for 3–5 spells | ❓ |
| Q3 | Melee/spell outcome-table constants (miss, glancing, crit suppression, spell hit cap) in Forever | Hit/crit math | Target-dummy testing, Blizzard notes, community testing | ❓ |
| Q4 | Stat conversion ratios (AP per Str/Agi, crit per Agi/Int) at 60 | Derived stats | Character-sheet deltas while swapping gear | ❓ |
| Q5 | Do pets scale with owner stats in Forever? | Pet DPS | Pet tooltip/attack values at different owner AP/SP | ❓ |
| Q6 | What does node `Flags = 8` mean? Are those talents live? | Tree correctness | Compare with in-game talent UI | ❓ |
| Q7 | Per-rank values for talents whose rank count changed (e.g. Impact 3 ranks) | Talent effects | Decode `TraitDefinitionEffectPoints` → `Curve` | ❓ |
| Q8 | Weapon damage modifiers (Thunderfury computes 82–153; Classic 44–82) | Weapon picker | Check `QualityModifier`, caster tables, in-game tooltip | ❓ |
| Q9 | Icon source: which CDN or listfile maps `SpellIconFileDataID` → image | Classic look | Test the wago.tools / Wowhead icon CDN; else bundle the icons | ❓ |
| Q10 | Choice nodes (`Type = 1`): any in class trees? | Tree UI | Grep the generated data | ❓ |
| Q11 | Data shows 7 tiers (gates 0–30) where fan sites claim "a new 16-point talent". Which is right? | Tree UI | Compare with the in-game UI; the data wins unless proven otherwise | ❓ |
| Q12 | Hunter tree clustering produced a stray one-node "Spec 3" | Data pipeline | Inspect the node (likely flag 8 or a pet talent) | ❓ |
| Q13 | Default target and reference mobs | Default DPS numbers | Owner decision | ✅ Default is a boss at player level + 3 (63 / 3731 armor at 60), plus reference mobs for the selected level; armor from `ExpectedStat` (owner, 2026-11-12). Raid buffs default still open |
| Q14 | Level selector (1–60) or level 60 only for v1? | Scope | Owner decision | ✅ Level 60 first; the level selector comes later and brings the level-based reference mobs with it (owner, 2026-11-12) |
| Q15 | Class spell data includes "Engraving"/"Runes" skill lines (Season of Discovery runes). Are runes live in Forever, or leftover shared data? | Spell list / gear model | Check in game; exclude from v1 unless live | ❓ |
