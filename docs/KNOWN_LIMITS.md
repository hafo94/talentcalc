# Known limits

These are things the calculator does not do yet, or does in a simplified way. This file
lists *missing features and simplifications*. Unverified game facts are in
[OPEN_QUESTIONS.md](OPEN_QUESTIONS.md), and some rows link to an open question for the facts
behind them.

Status: ⬜ open · 🟨 planned (phase noted) · ✅ fixed (note the commit or phase)

## Gear and stats

| # | Limit | Effect | Fix idea | Status |
|---|---|---|---|---|
| L1 | No full item slots. Gear is a "bonus stats" panel; only weapons are real items | Users type gear totals by hand | v2 gear: item slots with the full item DB (armor needs Phase-1-style item export) | ⬜ |
| L2 | No mana, MP5 or spirit-regen gear, so casters have no regen from gear. **Unlimited mana is on by default** in the sim | A caster with no gear runs dry in 40–60 s; sim DPS with real mana is 66–83% lower | Add Int/Spirit/MP5 inputs and buffs, then turn unlimited mana off by default | ⬜ |
| L3 | Weapons missing from Forever's client data come from Classic Era, with unverified stats (Q18/Q19); equip/use effects not exported | Some weapon stats may differ from Forever | Export ItemEffect; verify a sample in game | ⬜ |
| L4 | Shields not modeled (Q46) | Bastion/shield talents inactive | Off-hand shield slot | ⬜ |
| L5 | Level fixed at 60 in the UI (the engine takes a level) | No leveling builds | Phase 7 level selector | 🟨 Phase 7 |
| L6 | Base stats, base crit and stat conversions are Classic values (Q4, Q25, Q33) | Crit can be off by up to 5 points if Forever uses a flat 5% | In-game checks with no gear on | ⬜ |

## Damage engine (Phase 4, analytical)

| # | Limit | Effect | Fix idea | Status |
|---|---|---|---|---|
| L7 | Mana is reported, not enforced, in the analytical DPS | Instant DPS ignores going out of mana | Use sim DPS, or add a mana-limited analytical mode | ⬜ |
| L8 | Analytical energy model is too simple: Combat Rogue sims about +15% above analytical | The instant Rogue DPS is too low | Model energy regen + talents/procs like the sim does | ✅ Quick fix (pre-Phase 6): buff finishers refreshed half a finisher cycle late; the sim keeps combo points for a finisher waiting for energy. Combat +0.4%, Assassination -2.3% |
| L9 | Hammer of Wrath is a ranged-type spell in the data, so the engine requires a ranged weapon; it is left out of the default rotations | Retribution execute damage missing | Treat it as a spell that doesn't need a ranged weapon | ✅ Quick fix (pre-Phase 6): ranged-type spells without weapon damage or equip requirement need no ranged weapon; Hammer of Wrath in the Retribution default (execute) |
| L10 | Power Infusion targets an ally, so its buff isn't applied when self-cast; left out of the default rotations | Shadow Priest burst missing | Self-target option for ally buffs | ✅ Quick fix (pre-Phase 6): ally-target (21) auras apply when self-cast; Power Infusion in the Shadow default |
| L11 | Tier-2 specs (BM, Survival, Assassination, Subtlety, Enhancement, Arcane, Affliction, Demonology, Feral) use a generic model; tier-3 (tanks/healers) only a basic damage rotation | Less accurate DPS for those specs | Promote specs to tier 1 one at a time | ⬜ |
| L12 | Only 22 scripted talents have hand-written handlers; other DUMMY-aura talents are listed as "not modeled" (e.g. Heating Up, Pyroblast procs) | Some talents show no DPS value | Add handlers by priority (most-picked talents first) | ⬜ |
| L13 | Several formulas are Classic/TBC assumptions: rage formula, finisher AP coefficients, Seal of Command PPM, Cat Form weapon, DoT crits (Q47–Q58) | Numbers may drift from Forever | In-game target-dummy tests | ⬜ |
| L14 | Spell base points are well below Classic in Forever's data (Q2); the calculator uses the data | Looks low vs Classic sims, but should match Forever | Confirm with tooltips | ⬜ |

## Simulation (Phase 5)

| # | Limit | Effect | Fix idea | Status |
|---|---|---|---|---|
| L15 | Only 15 talents (plus Seal of Command and Windfury) are real random procs in the sim; the rest are averages | Variance slightly understated | Convert more handlers to sim events | ⬜ |
| L16 | Hunters sim 8–9% below analytical because Aimed Shot resets Auto Shot (Q-list); behaviour unverified | Hunter DPS uncertainty | Verify in game | ⬜ |
| L17 | Mana-regen model (spirit, five-second rule) and Execute rage scaling unverified (Q59–Q68) | Caster and Warrior sim drift | In-game checks | ⬜ |
| L18 | No movement, no multi-target, single boss only | Raid-like fights not modeled | Out of scope for v1 | ⬜ |

## Pets (Phase 6)

| # | Limit | Effect | Fix idea | Status |
|---|---|---|---|---|
| L19 | Pet damage is not included in DPS | Hunter/Warlock DPS too low | Phase 6 | ✅ Phase 6 |
| L22 | Other summons are not modeled: Searing/Magma Totem, Shadowfiend, Summon Hawk's 18 s assault, Inferno, Doomguard; Felguard has no summon spell in Forever | Totem, Shadowfiend and Infernal damage missing | Model summons as timed pet actors | ⬜ |
| L23 | Pet base stats, focus regeneration and owner scaling are Classic/TBC values (Q5, Q69-Q71) | Pet DPS may be off by up to about 30% | Pet character sheet checks in game | ⬜ |
| L24 | Pets get no raid buffs or consumables; pet mana is unlimited; pet buffs to the owner (Furious Howl, Blood Pact) and Intimidation are not applied; pet abilities have no attack power scaling (Q72) | Pet DPS slightly low | Pet buff list, AP coefficient test | ⬜ |

## Damage engine, later findings

| # | Limit | Effect | Fix idea | Status |
|---|---|---|---|---|
| L25 | Analytical buff finishers keep 100% aura uptime although their casts include the refresh gap (Combat Slice and Dice has about 70% uptime) | Within 3% of the simulation | Model uptime from the refresh gap | ⬜ |

## UI

| # | Limit | Effect | Fix idea | Status |
|---|---|---|---|---|
| L20 | The reference-target table scrolls sideways on phones | Minor | Card layout on narrow screens | ⬜ |
| L21 | Tree background art is hotlinked from Wowhead's CDN (Q30) | Could break or be disallowed | Can be switched off; consider gradients only | ⬜ |

When a limit is fixed, set ✅ with the phase or commit, and keep the row for history.
