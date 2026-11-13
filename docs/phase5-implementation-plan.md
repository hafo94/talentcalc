# Phase 5 implementation plan: Rotations & simulation

Audience: the agent that implements Phase 5. Follow this document literally. When it says "exactly", copy the value or
code. When something here contradicts an older doc, this document wins for Phase 5, and task T12 updates the older doc.

Everything below was checked against `data/generated/1.60.1.70888/` on 2026-11-13 and implemented as a prototype in a
scratch copy of the repo at commit `84897c4` (branch `claude/stoic-allen-90bng2`). Results of the prototype:
`tsc -b` clean, `eslint .` clean, `prettier --check src e2e` clean, `vite build` OK (the worker is its own 79 KB chunk),
`vitest run` **261 tests** (220 existing + 41 new) OK, Playwright **28 tests** (24 existing + 4 new) OK on desktop and
mobile (pre-installed Chromium, `--trace off`). **The code blocks in this document are that prototype; copy them.**
Blocks marked "(diff)" are unified diffs against `84897c4`; every one of them was verified with `git apply --check`
on the branch. Save a diff block to a file and run `git apply <file>`; if a hunk does not apply because the branch
moved, make the same change by hand. Every other code block is a complete new file.

---

## 0. Key decisions (summary)

| Topic | Decision | Evidence |
|---|---|---|
| Sim / analytical boundary | The simulator **never computes damage**. Phase 4 `evaluateAbility` now also returns its `parts` (`AbilityResult.parts`: per-hit damage after every multiplier and mitigation, the two-roll chances and the crit multiplier); the simulator only **samples** them (land roll, crit roll, uniform weapon/spell range). White swings are sampled from `WhiteResult` (single roll). | 1-line diffs in `abilities/types.ts` and `evaluate.ts` (section 4.2). The cross-check builds agree within 3% (section 8.3). |
| Dynamic buffs | A burst cooldown (Death Wish, Arcane Power, Recklessness, Blade Flurry, Adrenaline Rush, Rapid Fire, Cold Blood, Presence of Mind, Inner Focus, Amplify Curse, Combustion stacks), a buff finisher (Slice and Dice) or a proc buff (Clearcasting) changes the evaluation: the model calls `prepareDamage(..., extraBuffs)` + `evaluateTarget` + `evaluateDamage` **once per set of active buffs** and memoizes it (2-30 sets per run). Stat/damage-done/spell-modifier auras therefore go through the exact Phase 3/4 code (mapAura, buffModSources). | New optional `PrepareArgs.extraBuffs` (section 4.2). `stateCount()` stays small; 1000 x 180 s runs in 0.1-0.5 s (section 8.5). |
| Talent handlers | 15 talent spell ids are **sampled as events** (`SIM_PROC_TALENTS`: Ignite rolling, Flurry charges, Improved Shadow Bolt, Nightfall/Shadow Trance, Deep Wounds, Unbridled Wrath, Anger Management, Seal Fate, Ruthlessness, Weaponmaster/Hack and Slash extra attacks, Arcane Concentration and Elemental Focus Clearcasting, Combustion). Their Phase 4 handlers keep the `stats` hook but are **not passed** to `evaluateDamage`, so nothing counts twice. All other handlers (Fire Power, Improved Scorch, Shadow Weaving, Shadow and Flame, Lightning Overload, Improved Mind Flay, Dual Wield Specialization, Improved Whirlwind, Predatory Strikes, Lone Wolf) stay **analytical averages** and are listed as such in the results. Seal of Command (7 PPM) and Windfury Weapon (20%, 2 attacks, +333 AP) are sampled from the same constants as Phase 4. | `model.ts` filters `p.handlers`; `SimResult.averaged/modeled` (section 4.5). |
| Event engine | Discrete events in a binary heap ordered by (time, insertion sequence); the player acts after every event (walk the priority list top-down, first usable entry is cast; off-GCD casts continue the walk). Resources regenerate continuously between events. Busy = a pending cast/channel object, **not** a time comparison. | A time comparison let a DoT tick at the exact cast-end time start a new cast and drop the old one (found and fixed in the prototype). |
| RNG | sfc32 seeded through splitmix32; iteration `i` uses `createRng(iterationSeed(seed, i))`, so results do not depend on batching or worker count. Same seed = identical result and combat log. | Golden outputs reproduced by an independent Python implementation (section 8.1). |
| Worker | **Plain `postMessage`, no Comlink** (zero new dependencies). Protocol: `run` -> `progress`* -> `result` or `error`. Cancel = `worker.terminate()`; a new run terminates the previous worker. Messages of a cancelled or replaced run are ignored. | 3 message types do not justify a library; `ARCHITECTURE.md` "Web Worker (Comlink)" is updated in T12. Vite bundles `new Worker(new URL(...), { type: "module" })` without config changes. |
| URL | **No v3.** Two new TLV records in the v2 character payload: tag 6 rotation, tag 7 simulation settings. The Phase 3 decoder already skips unknown tags, so v1/v2 links decode unchanged and older app versions ignore the records. A link with a rotation but a default character is written as v2 with only tag 6/7. | `charCode.test.ts` "skips unknown tags"; goldens cross-checked with an independent Python encoder (section 8.4). |
| Ability keys | An ability in the URL is the **first spell id of its rank chain** (`AbilityChain.ranks[0]`), or the **talent spell id** for talent-only abilities (Death Wish 12328). Unique per class (tested). Unknown ids are dropped with a notice. | Same idea as talent node ids in v1 (stable game ids). |
| Rotation schema | `RotationEntry` gains `conditions?: RotationCondition[]` (all must hold) and `off?: true` (switched off in the editor; both engines drop it). New kind **`burst`** (cooldown buff, "use on cooldown" unless conditions say otherwise). Conditions: resource (mana in %), combo points, target health %, fight time left, own DoT/buff time left, aura active/not active (player buff, proc or target DoT by name), another ability's cooldown ready/not ready. | Section 4.1. |
| Analytical model | Unchanged numbers. It ignores `resource`, `comboPoints` and `auraLeft` conditions and **skips** (listed under "skipped" with the reason ending in "simulation only") `burst` entries, execute-only abilities (Execute, Hammer of Wrath) and entries with a `targetHp`, `aura`, `cooldown` or `timeLeft` condition. | All 13 Phase 4 goldens pass unchanged with the migrated `rotations.json`. |
| Implicit sim rules per kind | `dot`: cast when its DoT has <= its cast time left; `maintain`: every `everySec`; `finisher`: needs `cp` combo points, and a buff/periodic finisher (Slice and Dice, Rip) waits until its aura is gone; `builder`: only the **first learned builder** is used (same rule as Phase 4) and not at 5 combo points; `burst`: not while its buff is active; `nextSwing`: queued off the GCD, paid at the swing (cancelled if the resource is short). An explicit `auraLeft` condition replaces the implicit DoT/finisher refresh rule. | Without the builder rule Feral cast Claw instead of Shred (Shred costs more energy); with it the cross-check C7 agrees to -0.2%. |
| Execute phase | Target health falls linearly from 100% to 0% over the fight. Execute and Hammer of Wrath are only usable below 20% (tooltip rule, `EXECUTE_ONLY`). Execute is a Phase 4 script (`dummyDamage`: the DUMMY effect's 600 is direct damage); the simulator adds `15 x extra rage` scaled by the same multipliers and spends all rage. | Execute rank 5 = DUMMY base 600 (data); 15 per rage is Classic `[VERIFY Q60]`. |
| Mana | Spirit regeneration per 2 s tick from the Classic class formulas, a five-second rule after spending mana (talents with aura 134, e.g. Arcane Meditation, and Evocation keep a % of regeneration), aura 110 regen buffs (Evocation +1500%, Adrenaline Rush +100% energy). **Default "Unlimited mana" is ON**: gear v1 has no MP5 or mana-pool items, and a naked caster goes out of mana after 40-60 s (sim DPS -66% to -83% vs analytical). The toggle is in the panel and the URL; with mana on, the results show the seconds spent out of mana and Evocation works as a rotation entry (`resource < 20%`). | Section 9 table, "mana" column of the prototype run. |
| Other mechanics | Channels are **clipped** after a tick when a higher-priority entry is usable (Mind Flay for Mind Blast). A ranged cast (Aimed Shot) **restarts the Auto Shot timer**; Auto Shot waits for a cast to finish. Haste changes apply from the next swing. Rage starts at 0, energy and mana full. DoTs snapshot at application; Improved Shadow Bolt applies at damage time. | `[VERIFY Q61-Q65]`. |
| UI | New **Rotation** editor (drag-and-drop + up/down buttons, add/remove, type, CP, recast interval, on/off checkbox, conditions, "Based on" spec select, Reset to default) and **Simulation** panel (fight length, iterations, seed, unlimited mana, Run/Cancel with progress, DPS mean ± stdev, 95% CI, min/max, delta to analytical, idle/OOM seconds, breakdown table with inline share bars, resource-over-time SVG chart with hover readout and execute marker, combat log of iteration 1, lists of simulated vs averaged effects, stale-result note). Desktop: a second two-column row under the Damage panel. Mobile: 5th tab "Sim". The analytical DPS stays live; the sim is on demand. | Screenshots checked at 1200 px and 393 px (no horizontal scroll). |
| Default rotations | Migrated (section 3): cooldowns and execute entries added as `burst`/execute entries, Heroic Strike gets `rage >= 50`. **Not added**: Hammer of Wrath (its `DefenseType` is 3 = ranged, so Phase 4 requires a ranged weapon, Q66) and Power Infusion (its auras target an ally, `targets [21, 0]`, so the self-buff mapper ignores them, Q67). | Section 1. |
| Spec coverage | Every one of the 27 rotations runs in the simulator. Fully sampled: all melee, energy, rage and caster mechanics above. Analytical averages inside the sim: the non-sampled handlers listed above. Tier badges (1/2/3) stay as in Phase 4. | Section 9. |

---

## 1. Verified data facts (what the code may rely on)

| Fact | Value in `spells/<class>.json` / `talents/<class>.json` |
|---|---|
| Death Wish 12328 (talent ability, no chain) | 30 s, cd 180 s, gcd 1.5 s, 10 rage; aura 79 +20% physical (misc 1), auras 77/87 ignored |
| Recklessness 1719 (chain) | 15 s, cd 1800 s, aura 290 +100% crit, `DefenseType` 2 (needs a melee weapon in Phase 4) |
| Bloodrage 2687 | effect 30 energize rage 100 (= 10 rage, tenths), effect 64 -> 29131: aura 24 periodic energize 10/1 s for 10 s (= +1 rage/s) |
| Arcane Power 12042, Presence of Mind 12043, Cold Blood 14177, Inner Focus 14751, Amplify Curse 18288 | 107/108 caster auras; PoM / Cold Blood / Inner Focus have duration -1 and `proc.charges` 1 (consumed by the next matching cast) |
| Combustion 11129 (talent) | `proc.charges` 3, effect 64 -> 28682: aura 107 op 7 +10 crit, `maxStacks` 10, duration -1 |
| Blade Flurry 13877 / Adrenaline Rush 13750 | aura 319 +20% melee haste / aura 110 misc 3 +100% energy regeneration |
| Rapid Fire 3045 | aura 140 +40 (ranged haste, now mapped), aura 319 +40, aura 110 0, aura 134 0 |
| Evocation 12051 | channel 8 s, cd 480 s, gcd 1.5 s; aura 110 +1500 (mana), aura 134 100 |
| Clearcasting 12536 (mage) / 16246 (shaman) | 15 s, charges 1, aura 108 op 14 cost -1000% / -100% (cost becomes 0) |
| Arcane Concentration 11213 / Elemental Focus 16164 | aura 42 -> Clearcasting; chance = `ranks[r].values[0]` (10% at max rank) |
| Ignite / Flurry / Nightfall / Deep Wounds / ISB / Seal Fate / Ruthlessness / Unbridled Wrath | `values[0]` = 40 / 30 / 4 / 60 / 20 / 100 / 60 / 60 at max rank; Anger Management values `[15, 1, 3, 30]` (1 rage per 3 s) |
| Flurry buff, Shadow Trance | **not in the data** (only the talents): the simulator applies them itself (3 swings; 10 s, next Shadow Bolt instant) |
| Execute 20662 (rank 5, chain 5308...) | effect 3 DUMMY base 600, effect 64 -> 26651, 15 rage; description "converting each extra point of rage into $*10;F1 additional damage" (unresolved) |
| Hammer of Wrath 24275 | effect 2, base 498, coef 0.429, **`DefenseType` 3** (ranged) |
| Power Infusion 10060 | auras 79/136 with `targets [21, 0]` (ally) |
| Talents with aura 134 (mana regeneration while casting) | Arcane Meditation, Meditation, Reflection, Reverence, Mindfulness, Bestial Discipline (values from the ranks) |
| Ability catalog ids | unique per class; e.g. Execute 5308, Frostbolt 116, Fire Blast 2136, Evocation 12051 |

---

## 2. Module structure

```
src/engine/rotation/conditions.ts   condition schema helpers: conditionsHold, simOnlyReason, enabledRotation, CONDITION_TYPES (pure)
src/engine/rotation/catalog.ts      abilityCatalog: abilities the editor offers, their URL ids and default entries (pure)
src/engine/sim/types.ts             SimInput, SimConfig, SimResult, worker messages
src/engine/sim/constants.ts         regeneration, execute, proc durations ([VERIFY])
src/engine/sim/rng.ts               splitmix32, sfc32, iterationSeed
src/engine/sim/queue.ts             EventQueue (binary heap by time, then insertion)
src/engine/sim/procs.ts             SIM_PROC_TALENTS, activeProcs
src/engine/sim/model.ts             buildModel: BuffDefs, SimEntries, memoized StateEval per buff set (calls Phase 4)
src/engine/sim/engine.ts            Fight: one iteration (event loop, resources, casting, procs, bookkeeping)
src/engine/sim/run.ts               runSim (N iterations, aggregation), summarize
src/engine/sim/worker.ts            Web Worker entry (postMessage)
src/engine/sim/index.ts             re-exports (not worker.ts)
src/state/rotation.ts               useRotation store (custom rotation, sim settings), URL mapping, catalogFor
src/state/sim.ts                    useSim store: worker client (run, progress, cancel)
src/state/derived.ts (diff)         derive(calc, ch, custom) + simInputFor
src/ui/rotation/                    RotationEditor.tsx, editing.ts, RotationEditor.module.css
src/ui/sim/                         SimPanel.tsx, SimPanel.module.css
src/testkit/sim.ts                  test-only: simInput(scenario)
```

Import direction (engine stays pure, ESLint rule unchanged): `stats` <- `combat` <- `abilities` <- `talents/special` <-
`rotation` (incl. `conditions`, `catalog`) <- `sim`. `src/state` imports `engine/*`; `src/ui` imports `state` and
`engine` types. `engine/sim/worker.ts` is only referenced by `state/sim.ts` through `new URL(...)`.

---

## 3. Manual data: `data/manual/rotations.json` migration (task T2)

Apply the diff exactly (the file is hand-formatted; do not re-serialize it). It adds cooldown buffs and execute entries
(simulation-only), gives Heroic Strike a `rage >= 50` condition (ignored by the analytical model) and rewrites the notes.
The analytical DPS of every rotation is unchanged (all Phase 4 goldens pass).

`data/manual/rotations.json` (diff):

```diff
diff --git a/data/manual/rotations.json b/data/manual/rotations.json
index 8614212..87c7ced 100644
--- a/data/manual/rotations.json
+++ b/data/manual/rotations.json
@@ -1,23 +1,30 @@
 {
-  "_source": "Phase 4 default priority rotations (docs/phase4-implementation-plan.md section 6). Ability names are rank-chain names in data/generated/<build>/spells/<class>.json. Entries are in priority order; an entry whose ability is not learned (talent not taken, wrong weapon) is skipped.",
+  "_source": "Phase 4 default priority rotations (docs/phase4-implementation-plan.md section 6), Phase 5 cooldowns and conditions (docs/phase5-implementation-plan.md section 3). Ability names are rank-chain names in data/generated/<build>/spells/<class>.json. Entries are in priority order; an entry whose ability is not learned (talent not taken, wrong weapon) is skipped.",
   "_status": "[VERIFY] Classic-style priorities adapted to the Forever spell list; not checked against Forever logs.",
   "rotations": [
     { "id": "warrior-arms", "class": "warrior", "spec": 0, "label": "Arms: Mortal Strike, Whirlwind, Heroic Strike", "role": "dps", "tier": 1,
       "selfBuffs": [], "melee": true, "autoShot": false,
       "entries": [
+        { "ability": "Recklessness", "kind": "burst", "conditions": [{ "type": "targetHp", "cmp": "lt", "value": 20 }] },
+        { "ability": "Execute", "kind": "cooldown" },
         { "ability": "Mortal Strike", "kind": "cooldown" },
         { "ability": "Whirlwind", "kind": "cooldown" },
-        { "ability": "Heroic Strike", "kind": "nextSwing" }
+        { "ability": "Bloodrage", "kind": "burst" },
+        { "ability": "Heroic Strike", "kind": "nextSwing", "conditions": [{ "type": "resource", "cmp": "gte", "value": 50 }] }
       ],
-      "notes": ["Slam, Overpower, Rend and Execute are not in the Phase 4 rotation (Phase 5)."] },
+      "notes": ["Recklessness, Execute and Bloodrage are simulation-only entries. Slam, Overpower and Rend are not in the default rotation."] },
     { "id": "warrior-fury", "class": "warrior", "spec": 1, "label": "Fury: Bloodthirst, Whirlwind, Heroic Strike", "role": "dps", "tier": 1,
       "selfBuffs": [], "melee": true, "autoShot": false,
       "entries": [
+        { "ability": "Death Wish", "kind": "burst" },
+        { "ability": "Recklessness", "kind": "burst", "conditions": [{ "type": "targetHp", "cmp": "lt", "value": 20 }] },
+        { "ability": "Execute", "kind": "cooldown" },
         { "ability": "Bloodthirst", "kind": "cooldown" },
         { "ability": "Whirlwind", "kind": "cooldown" },
-        { "ability": "Heroic Strike", "kind": "nextSwing" }
+        { "ability": "Bloodrage", "kind": "burst" },
+        { "ability": "Heroic Strike", "kind": "nextSwing", "conditions": [{ "type": "resource", "cmp": "gte", "value": 50 }] }
       ],
-      "notes": ["Execute phase, Death Wish and Recklessness are not modeled (Phase 5)."] },
+      "notes": ["Death Wish, Recklessness, Execute and Bloodrage are simulation-only entries."] },
     { "id": "warrior-protection", "class": "warrior", "spec": 2, "label": "Basic: Heroic Strike", "role": "tank", "tier": 3,
       "selfBuffs": [], "melee": true, "autoShot": false,
       "entries": [{ "ability": "Heroic Strike", "kind": "nextSwing" }],
@@ -37,11 +44,12 @@
         { "ability": "Holy Strike", "kind": "cooldown" },
         { "ability": "Judgement", "kind": "cooldown" }
       ],
-      "notes": ["Seal of Righteousness, Consecration, Exorcism (Undead/Demon only) and Hammer of Wrath (execute) are not modeled."] },
+      "notes": ["Seal of Righteousness, Consecration, Exorcism (Undead/Demon only) and Hammer of Wrath (ranged attack table in the data, Q66) are not modeled."] },
 
     { "id": "hunter-beast-mastery", "class": "hunter", "spec": 0, "label": "Ranged: Aimed, Multi, Arcane Shot, Serpent Sting", "role": "dps", "tier": 2,
       "selfBuffs": ["Aspect of the Hawk", "Hunter's Mark"], "melee": false, "autoShot": true,
       "entries": [
+        { "ability": "Rapid Fire", "kind": "burst" },
         { "ability": "Aimed Shot", "kind": "cooldown" },
         { "ability": "Multi-Shot", "kind": "cooldown" },
         { "ability": "Arcane Shot", "kind": "cooldown" },
@@ -51,16 +59,18 @@
     { "id": "hunter-marksmanship", "class": "hunter", "spec": 1, "label": "Marksmanship: Sniper, Aimed, Multi, Arcane Shot", "role": "dps", "tier": 1,
       "selfBuffs": ["Aspect of the Hawk", "Hunter's Mark"], "melee": false, "autoShot": true,
       "entries": [
+        { "ability": "Rapid Fire", "kind": "burst" },
         { "ability": "Sniper Shot", "kind": "cooldown" },
         { "ability": "Aimed Shot", "kind": "cooldown" },
         { "ability": "Multi-Shot", "kind": "cooldown" },
         { "ability": "Arcane Shot", "kind": "cooldown" },
         { "ability": "Serpent Sting", "kind": "dot" }
       ],
-      "notes": ["Rapid Fire and Rapid Killing are cooldowns (Phase 5). Lone Wolf assumes no pet (pets: Phase 6)."] },
+      "notes": ["Rapid Fire is a simulation-only cooldown; Rapid Killing is not modeled. Lone Wolf assumes no pet (pets: Phase 6)."] },
     { "id": "hunter-survival", "class": "hunter", "spec": 2, "label": "Ranged: Aimed, Multi, Arcane Shot, Serpent Sting", "role": "dps", "tier": 2,
       "selfBuffs": ["Aspect of the Hawk", "Hunter's Mark"], "melee": false, "autoShot": true,
       "entries": [
+        { "ability": "Rapid Fire", "kind": "burst" },
         { "ability": "Aimed Shot", "kind": "cooldown" },
         { "ability": "Multi-Shot", "kind": "cooldown" },
         { "ability": "Arcane Shot", "kind": "cooldown" },
@@ -71,6 +81,7 @@
     { "id": "rogue-assassination", "class": "rogue", "spec": 0, "label": "Slice and Dice, Mutilate, Eviscerate", "role": "dps", "tier": 2,
       "selfBuffs": [], "melee": true, "autoShot": false,
       "entries": [
+        { "ability": "Cold Blood", "kind": "burst" },
         { "ability": "Slice and Dice", "kind": "finisher", "cp": 5, "buff": true },
         { "ability": "Mutilate", "kind": "builder" },
         { "ability": "Sinister Strike", "kind": "builder" },
@@ -80,12 +91,14 @@
     { "id": "rogue-combat", "class": "rogue", "spec": 1, "label": "Combat: Slice and Dice, Shank, Sinister Strike, Eviscerate", "role": "dps", "tier": 1,
       "selfBuffs": [], "melee": true, "autoShot": false,
       "entries": [
+        { "ability": "Blade Flurry", "kind": "burst" },
+        { "ability": "Adrenaline Rush", "kind": "burst" },
         { "ability": "Slice and Dice", "kind": "finisher", "cp": 5, "buff": true },
         { "ability": "Shank", "kind": "cooldown" },
         { "ability": "Sinister Strike", "kind": "builder" },
         { "ability": "Eviscerate", "kind": "finisher", "cp": 5 }
       ],
-      "notes": ["Blade Flurry and Adrenaline Rush are cooldowns (Phase 5)."] },
+      "notes": ["Blade Flurry and Adrenaline Rush are simulation-only cooldowns (single target: Blade Flurry adds only its attack speed)."] },
     { "id": "rogue-subtlety", "class": "rogue", "spec": 2, "label": "Slice and Dice, Hemorrhage, Eviscerate", "role": "dps", "tier": 2,
       "selfBuffs": [], "melee": true, "autoShot": false,
       "entries": [
@@ -100,6 +113,7 @@
     { "id": "priest-discipline", "class": "priest", "spec": 0, "label": "Basic: Shadow Word: Pain, Mind Blast, Smite", "role": "healer", "tier": 3,
       "selfBuffs": [], "melee": false, "autoShot": false,
       "entries": [
+        { "ability": "Inner Focus", "kind": "burst" },
         { "ability": "Shadow Word: Pain", "kind": "dot" },
         { "ability": "Mind Blast", "kind": "cooldown" },
         { "ability": "Smite", "kind": "filler" }
@@ -150,27 +164,36 @@
     { "id": "mage-arcane", "class": "mage", "spec": 0, "label": "Arcane: Arcane Wrath, Arcane Missiles", "role": "dps", "tier": 2,
       "selfBuffs": [], "melee": false, "autoShot": false,
       "entries": [
+        { "ability": "Evocation", "kind": "burst", "conditions": [{ "type": "resource", "cmp": "lt", "value": 20 }] },
+        { "ability": "Arcane Power", "kind": "burst" },
+        { "ability": "Presence of Mind", "kind": "burst" },
         { "ability": "Arcane Wrath", "kind": "cooldown" },
         { "ability": "Arcane Missiles", "kind": "filler" }
       ],
-      "notes": ["Arcane Blast stacks, Missile Barrage and Arcane Power are not modeled."] },
+      "notes": ["Evocation, Arcane Power and Presence of Mind are simulation-only. Arcane Blast stacks and Missile Barrage are not modeled."] },
     { "id": "mage-fire", "class": "mage", "spec": 1, "label": "Fire: Scorch (Improved Scorch), Fire Blast, Fireball", "role": "dps", "tier": 1,
       "selfBuffs": [], "melee": false, "autoShot": false,
       "entries": [
+        { "ability": "Evocation", "kind": "burst", "conditions": [{ "type": "resource", "cmp": "lt", "value": 20 }] },
+        { "ability": "Combustion", "kind": "burst" },
         { "ability": "Scorch", "kind": "maintain", "everySec": 30, "requiresTalent": "Improved Scorch" },
         { "ability": "Fire Blast", "kind": "cooldown" },
         { "ability": "Fireball", "kind": "filler" }
       ],
-      "notes": ["Combustion, Heating Up and Pyroblast procs are not modeled."] },
+      "notes": ["Evocation and Combustion are simulation-only. Heating Up and Pyroblast procs are not modeled."] },
     { "id": "mage-frost", "class": "mage", "spec": 2, "label": "Frost: Frostbolt", "role": "dps", "tier": 1,
       "selfBuffs": [], "melee": false, "autoShot": false,
-      "entries": [{ "ability": "Frostbolt", "kind": "filler" }],
-      "notes": ["Shatter, Fingers of Frost and Ice Lance need frozen targets (Phase 5)."] },
+      "entries": [
+        { "ability": "Evocation", "kind": "burst", "conditions": [{ "type": "resource", "cmp": "lt", "value": 20 }] },
+        { "ability": "Frostbolt", "kind": "filler" }
+      ],
+      "notes": ["Shatter, Fingers of Frost and Ice Lance need frozen targets: not modeled."] },
 
     { "id": "warlock-affliction", "class": "warlock", "spec": 0, "label": "Affliction: Corruption, Bane of Agony, Siphon Life, Shadow Bolt", "role": "dps", "tier": 2,
       "selfBuffs": [], "melee": false, "autoShot": false,
       "entries": [
         { "ability": "Corruption", "kind": "dot" },
+        { "ability": "Amplify Curse", "kind": "burst" },
         { "ability": "Bane of Agony", "kind": "dot" },
         { "ability": "Siphon Life", "kind": "dot" },
         { "ability": "Shadow Bolt", "kind": "filler" }
```

---

## 4. Engine (tasks T3-T6)

### 4.1 Data contracts: `src/data/types.ts` (diff, task T3)

`src/data/types.ts` (diff):

```diff
diff --git a/src/data/types.ts b/src/data/types.ts
index 1dc7784..fb5c027 100644
--- a/src/data/types.ts
+++ b/src/data/types.ts
@@ -405,7 +405,32 @@ export interface ClassSpellFile {
 }
 
 // ---- Phase 4: default rotations (data/manual/rotations.json) ----
-export type RotationEntryKind = "cooldown" | "dot" | "maintain" | "filler" | "builder" | "finisher" | "nextSwing";
+// "burst" (Phase 5): a cooldown whose caster auras apply while it lasts (Death Wish, Arcane Power, Cold Blood, Evocation).
+// The analytical model skips it; the simulator casts it when its conditions hold.
+export type RotationEntryKind =
+  | "cooldown"
+  | "dot"
+  | "maintain"
+  | "filler"
+  | "builder"
+  | "finisher"
+  | "nextSwing"
+  | "burst";
+/** Comparison of a condition: value >= x ("gte") or value < x ("lt"). */
+export type ConditionCmp = "gte" | "lt";
+/**
+ * Phase 5 rotation condition (all must hold). Evaluated by the simulator (src/engine/rotation/conditions.ts); the
+ * analytical model skips entries with sim-only conditions (targetHp, aura, cooldown, timeLeft).
+ */
+export type RotationCondition =
+  | { type: "resource"; cmp: ConditionCmp; value: number } // rage/energy points; mana: % of maximum mana
+  | { type: "comboPoints"; cmp: ConditionCmp; value: number }
+  | { type: "targetHp"; cmp: ConditionCmp; value: number } // % of target health (execute: lt 20)
+  | { type: "timeLeft"; cmp: ConditionCmp; value: number } // seconds of fight left
+  | { type: "auraLeft"; cmp: ConditionCmp; value: number } // seconds left of this entry's own DoT/buff (0 = missing)
+  | { type: "aura"; ref: string; active: boolean } // a player buff/proc or target debuff by name (Clearcasting, Flurry)
+  | { type: "cooldown"; ref: string; ready: boolean }; // another ability's cooldown (by ability name)
+export type ConditionType = RotationCondition["type"];
 export interface RotationEntry {
   ability: string; // ability name (rank chain name in spells/<class>.json)
   kind: RotationEntryKind;
@@ -414,6 +439,8 @@ export interface RotationEntry {
   buff?: true; // the ability's caster auras are applied while the rotation runs (Slice and Dice, seals)
   requires?: string; // only cast when this other rotation entry is cast (Conflagrate requires Immolate)
   requiresTalent?: string; // only cast when this talent has a point (Scorch for Improved Scorch)
+  conditions?: RotationCondition[]; // Phase 5: extra conditions (all must hold)
+  off?: true; // Phase 5: switched off in the editor (both engines ignore the entry)
   note?: string;
 }
 export type RotationRole = "dps" | "tank" | "healer";
```

`SimInput`, `SimConfig`, `SimResult` and the worker messages are in `src/engine/sim/types.ts` (section 4.6).

### 4.2 Phase 4 hooks (diffs, task T3)

- `AbilityResult.parts`: the parts the expected values are summed from (after the ability hooks).
- `SCRIPTS.Execute = { dummyDamage: true }`: the DUMMY effect's base points become a direct part (only Execute).
- `DamageResult.ctx`: the pass-2 `DamageContext` (the simulator evaluates finishers at any combo point count, the Seal
  of Command proc and Windfury white hits with it).
- `PrepareArgs.extraBuffs`: active simulator buffs, applied exactly like the rotation's self-buffs.
- `analytical.ts`: skips simulation-only entries (`simOnlyReason`), both in the priority loop and for on-next-swing
  entries.
- `talentEffects.ts`: aura 140 (Rapid Fire) maps to ranged haste.
- `rotation.test.ts`: tier-1 rotations may skip entries whose reason ends with "simulation only".

`src/engine/abilities/types.ts` (diff):

```diff
diff --git a/src/engine/abilities/types.ts b/src/engine/abilities/types.ts
index 6ace2f7..71145eb 100644
--- a/src/engine/abilities/types.ts
+++ b/src/engine/abilities/types.ts
@@ -114,6 +114,7 @@ export interface AbilityResult {
   expectedDirect: number; // per cast, incl. hit/crit/mitigation
   expectedPeriodic: number; // per cast, full duration
   extras: { label: string; value: number }[]; // per cast (Ignite, Lightning Overload)
+  parts: DamagePart[]; // Phase 5: the damage parts the expected values are summed from (the simulator samples them)
   expected: number; // expectedDirect + expectedPeriodic + extras
   dpct: number; // expected / execute time (max(timeCost, gcd), or 1.5 s for off-GCD abilities)
   sources: SourceLine[];
```

`src/engine/abilities/evaluate.ts` (diff):

```diff
diff --git a/src/engine/abilities/evaluate.ts b/src/engine/abilities/evaluate.ts
index 3f08635..3b222f8 100644
--- a/src/engine/abilities/evaluate.ts
+++ b/src/engine/abilities/evaluate.ts
@@ -184,6 +184,7 @@ interface Script {
   spellPowerBonus?(a: ScriptArgs): { value: number; text: string } | null;
   multiplier?(a: ScriptArgs): { value: number; text: string } | null;
   durationMs?(a: ScriptArgs): number;
+  dummyDamage?: true; // Phase 5: the DUMMY effect's base points are direct damage (Execute)
 }
 const dummyValue = (spell: Spell, index: number) => spell.effects.find((e) => e.index === index)?.base ?? 0;
 export const SCRIPTS: Readonly<Record<string, Script>> = {
@@ -216,6 +217,9 @@ export const SCRIPTS: Readonly<Record<string, Script>> = {
   "Slice and Dice": { durationMs: ({ spell, cp }) => (spell.duration?.ms ?? 0) + 3000 * cp },
   // "Instantly strike with your off-hand weapon"
   Shank: { slot: "offHand" },
+  // "causing 600 damage and converting each extra point of rage into ... additional damage" (the simulator adds the
+  // extra rage part, EXECUTE_DAMAGE_PER_RAGE; the analytical model skips execute-phase abilities)
+  Execute: { dummyDamage: true },
   // "gains additional Spell Damage equal to $s2% of your maximum Mana"
   "Arcane Wrath": {
     spellPowerBonus: ({ ctx, spell }) => {
@@ -367,7 +371,9 @@ function partsOf(
   }
 
   // 2. direct school damage (effect 2), incl. combo points and spell power
-  for (const e of effects.filter((x) => x.effect === EFFECT.SCHOOL_DAMAGE)) {
+  const directEffect = (x: SpellEffect) =>
+    x.effect === EFFECT.SCHOOL_DAMAGE || (x.effect === EFFECT.DUMMY && script?.dummyDamage === true);
+  for (const e of effects.filter(directEffect)) {
     const base = effectValue(spell, e, ctx.level, mods) + (e.pointsPerCombo ?? 0) * cp;
     const spPart = magic && e.spCoef ? e.spCoef * spTotal : 0;
     const bonus = script?.directBonus?.({ ctx, spell, cp }) ?? null;
@@ -597,6 +603,7 @@ export function evaluateAbility(
     expectedDirect,
     expectedPeriodic,
     extras: draft.extras,
+    parts: draft.parts,
     expected,
     dpct: expected / execute,
     sources: uniq,
```

`src/engine/rotation/evaluate.ts` (diff):

```diff
diff --git a/src/engine/rotation/evaluate.ts b/src/engine/rotation/evaluate.ts
index 20a5705..83daa84 100644
--- a/src/engine/rotation/evaluate.ts
+++ b/src/engine/rotation/evaluate.ts
@@ -30,6 +30,7 @@ export interface DamageResult {
   rotation: RotationResult;
   abilities: AbilityEval[]; // rotation entries in order (pass 2), unavailable ones with their reason
   effects: RotationEffect[]; // uptime effects applied in pass 2
+  ctx: DamageContext; // Phase 5: the pass-2 context (the simulator evaluates proc spells and extra white hits with it)
 }
 
 /**
@@ -74,5 +75,5 @@ export function evaluateDamage(input: DamageInput): DamageResult {
   const p1 = pass(base);
   const effects = rotationEffects(input.handlers, p1.rotation, p1.ctx);
   const p2 = pass({ ...p1.ctx, effects });
-  return { rotation: p2.rotation, abilities: p2.evals.map((e) => e.ability), effects };
+  return { rotation: p2.rotation, abilities: p2.evals.map((e) => e.ability), effects, ctx: p2.ctx };
 }
```

`src/engine/rotation/prepare.ts` (diff):

```diff
diff --git a/src/engine/rotation/prepare.ts b/src/engine/rotation/prepare.ts
index feaca88..4d11a06 100644
--- a/src/engine/rotation/prepare.ts
+++ b/src/engine/rotation/prepare.ts
@@ -17,6 +17,7 @@ export interface PrepareArgs extends Omit<AssembleArgs, "extraEffects" | "formMa
   spellClassSet: number; // ClassInfo.spellClassSet
   classTalents: readonly Talent[];
   rotation: SpecRotation;
+  extraBuffs?: readonly Spell[]; // Phase 5: active simulator buffs (Death Wish, Arcane Power ...), applied like self-buffs
 }
 export interface Prepared {
   assembled: Assembled;
@@ -35,7 +36,10 @@ export function prepareDamage(a: PrepareArgs): Prepared {
   const book = buildSpellbook(a.spells, a.spellClassSet, a.baseStats.classes[cls]?.mana ?? 0);
   const form = a.rotation.form ?? null;
   const mask = formMask(form);
-  const selfBuffs = selfBuffSpells(book, a.rotation, a.level, a.talents, a.classTalents);
+  const selfBuffs = [
+    ...selfBuffSpells(book, a.rotation, a.level, a.talents, a.classTalents),
+    ...(a.extraBuffs ?? []),
+  ];
   const handlers = activeHandlers(a.talents, mask);
   const extra: SourcedEffect[] = [
     // src: vmangos (Classic 1.12): Cat Form attack power = 2 Str + Agi - 20 (+ Predatory Strikes) [VERIFY Q55]
```

`src/engine/rotation/analytical.ts` (diff):

```diff
diff --git a/src/engine/rotation/analytical.ts b/src/engine/rotation/analytical.ts
index e929d00..6ec6727 100644
--- a/src/engine/rotation/analytical.ts
+++ b/src/engine/rotation/analytical.ts
@@ -15,6 +15,7 @@ import {
   WINDFURY,
   rageConversion,
 } from "@/engine/combat";
+import { simOnlyReason } from "./conditions";
 import type { CastLimit, CastLine, RotationResult, WhiteLine } from "./types";
 
 const MINUTE = 60;
@@ -91,6 +92,11 @@ export function runRotation(input: RotationInput): RotationResult {
   const ordered = [...input.evals.filter(generates), ...input.evals.filter((e) => !generates(e))];
   for (const { entry, ability } of ordered) {
     if (entry.kind === "nextSwing") continue;
+    const simOnly = simOnlyReason(entry);
+    if (simOnly) {
+      skipped.push({ ability: entry.ability, reason: simOnly });
+      continue;
+    }
     if (!ability.available) {
       skipped.push({ ability: entry.ability, reason: ability.reason });
       continue;
@@ -176,6 +182,11 @@ export function runRotation(input: RotationInput): RotationResult {
   let mhSwings = mh ? MINUTE / mh.speed : 0;
   for (const { entry, ability } of input.evals) {
     if (entry.kind !== "nextSwing") continue;
+    const simOnly = simOnlyReason(entry);
+    if (simOnly) {
+      skipped.push({ ability: entry.ability, reason: simOnly });
+      continue;
+    }
     if (!ability.available) {
       skipped.push({ ability: entry.ability, reason: ability.reason });
       continue;
```

`src/engine/rotation/index.ts` (diff):

```diff
diff --git a/src/engine/rotation/index.ts b/src/engine/rotation/index.ts
index aab8602..5eec38b 100644
--- a/src/engine/rotation/index.ts
+++ b/src/engine/rotation/index.ts
@@ -3,3 +3,5 @@ export * from "./analytical";
 export * from "./selfBuffs";
 export * from "./evaluate";
 export * from "./prepare";
+export * from "./conditions";
+export * from "./catalog";
```

`src/engine/stats/talentEffects.ts` (diff):

```diff
diff --git a/src/engine/stats/talentEffects.ts b/src/engine/stats/talentEffects.ts
index 2839e6e..93d8e4f 100644
--- a/src/engine/stats/talentEffects.ts
+++ b/src/engine/stats/talentEffects.ts
@@ -25,6 +25,7 @@ export const AURA = {
   MOD_TARGET_RESISTANCE: 123,
   MOD_RANGED_ATTACK_POWER: 124,
   MOD_TOTAL_STAT_PERCENTAGE: 137,
+  MOD_RANGED_HASTE: 140, // Phase 5: Rapid Fire "+40% ranged attack speed" [VERIFY]
   MOD_ATTACK_POWER_PCT: 166,
   MOD_RANGED_ATTACK_POWER_PCT: 167,
   MOD_SPELL_DAMAGE_OF_STAT_PERCENT: 174,
@@ -160,6 +161,8 @@ export function mapAura(e: TalentEffect, v: number): Mapped {
       };
     case AURA.MOD_MELEE_HASTE:
       return { kind: "stat", perSlot: false, effects: [{ key: "meleeHaste", value: v }] };
+    case AURA.MOD_RANGED_HASTE:
+      return { kind: "stat", perSlot: false, effects: [{ key: "rangedHaste", value: v }] };
     case AURA.MOD_MELEE_RANGED_HASTE:
       return {
         kind: "stat",
```

`src/engine/rotation/rotation.test.ts` (diff):

```diff
diff --git a/src/engine/rotation/rotation.test.ts b/src/engine/rotation/rotation.test.ts
index 10e20c4..edc2527 100644
--- a/src/engine/rotation/rotation.test.ts
+++ b/src/engine/rotation/rotation.test.ts
@@ -73,7 +73,9 @@ describe("every rotation with its spec at max rank", () => {
       const rot = d.result.rotation;
       expect(Number.isFinite(rot.dps) && rot.dps > 0).toBe(true);
       for (const c of rot.casts) expect(Number.isFinite(c.dps) && c.perMinute >= 0).toBe(true);
-      if (r.tier === 1) expect(rot.skipped.filter((s) => !s.reason.endsWith("is the builder"))).toEqual([]);
+      const expected = (reason: string) =>
+        reason.endsWith("is the builder") || reason.endsWith("simulation only");
+      if (r.tier === 1) expect(rot.skipped.filter((s) => !expected(s.reason))).toEqual([]);
     });
   }
 });
```

### 4.3 Conditions and the ability catalog (task T4)

`CONDITION_TYPES` order is part of the URL format: **append only**.

`src/engine/rotation/conditions.ts` (exact):

```ts
import type {
  ConditionCmp,
  ConditionType,
  RotationCondition,
  RotationEntry,
  SpecRotation,
} from "@/data/types";
import type { PowerKind } from "@/engine/abilities";

/** src: tooltips "Only usable on enemies that have 20% or less health" (Execute, Hammer of Wrath). */
export const EXECUTE_PHASE_PCT = 20;
export const EXECUTE_ONLY: ReadonlySet<string> = new Set(["Execute", "Hammer of Wrath"]);

/** What a condition can read from the simulator at decision time. */
export interface ConditionState {
  power: PowerKind | null; // the rotation's resource
  resource: number; // rage/energy/focus points, or mana
  maxMana: number;
  comboPoints: number;
  targetHpPct: number; // 0..100
  timeLeft: number; // seconds
  auraLeft(entryIndex: number): number; // seconds left of the entry's own DoT/buff (0 = missing)
  auraActive(name: string): boolean; // player buff/proc or target debuff
  cooldownReady(ability: string): boolean;
}

const cmp = (op: ConditionCmp, a: number, b: number) => (op === "gte" ? a >= b : a < b);

export function conditionHolds(c: RotationCondition, s: ConditionState, entryIndex: number): boolean {
  switch (c.type) {
    case "resource": {
      const v = s.power === "mana" ? (s.maxMana > 0 ? (s.resource / s.maxMana) * 100 : 0) : s.resource;
      return cmp(c.cmp, v, c.value);
    }
    case "comboPoints":
      return cmp(c.cmp, s.comboPoints, c.value);
    case "targetHp":
      return cmp(c.cmp, s.targetHpPct, c.value);
    case "timeLeft":
      return cmp(c.cmp, s.timeLeft, c.value);
    case "auraLeft":
      return cmp(c.cmp, s.auraLeft(entryIndex), c.value);
    case "aura":
      return s.auraActive(c.ref) === c.active;
    case "cooldown":
      return s.cooldownReady(c.ref) === c.ready;
  }
}

export function conditionsHold(entry: RotationEntry, s: ConditionState, entryIndex: number): boolean {
  if (EXECUTE_ONLY.has(entry.ability) && s.targetHpPct >= EXECUTE_PHASE_PCT) return false;
  for (const c of entry.conditions ?? []) if (!conditionHolds(c, s, entryIndex)) return false;
  return true;
}

/** The rotation both engines run: entries switched off in the editor are dropped. */
export function enabledRotation(r: SpecRotation): SpecRotation {
  return r.entries.some((e) => e.off) ? { ...r, entries: r.entries.filter((e) => !e.off) } : r;
}

/** Condition types the analytical model cannot average: entries carrying them are simulation-only. */
const SIM_ONLY: ReadonlySet<ConditionType> = new Set(["targetHp", "aura", "cooldown", "timeLeft"]);

/** Why the analytical model skips an entry (null: it models the entry and ignores resource/cp/auraLeft conditions). */
export function simOnlyReason(entry: RotationEntry): string | null {
  if (entry.kind === "burst") return "cooldown buff: simulation only";
  if (EXECUTE_ONLY.has(entry.ability)) return "execute phase: simulation only";
  const c = (entry.conditions ?? []).find((x) => SIM_ONLY.has(x.type));
  return c ? `condition "${describeCondition(c, null)}": simulation only` : null;
}

/** Metadata for the editor: label, unit and which operands a condition type has. APPEND ONLY (URL index). */
export const CONDITION_TYPES: readonly {
  type: ConditionType;
  label: string;
  operand: "value" | "ref";
  unit: string;
  max: number;
}[] = [
  { type: "resource", label: "Resource", operand: "value", unit: "", max: 10000 },
  { type: "comboPoints", label: "Combo points", operand: "value", unit: "", max: 5 },
  { type: "targetHp", label: "Target health", operand: "value", unit: "%", max: 100 },
  { type: "timeLeft", label: "Fight time left", operand: "value", unit: "s", max: 3600 },
  { type: "auraLeft", label: "Own DoT/buff left", operand: "value", unit: "s", max: 600 },
  { type: "aura", label: "Aura", operand: "ref", unit: "", max: 0 },
  { type: "cooldown", label: "Cooldown", operand: "ref", unit: "", max: 0 },
];

const r1 = (n: number) => String(Math.round(n * 10) / 10);

/** One-line text, e.g. "Rage ≥ 50", "Target health < 20%", "Clearcasting active". */
export function describeCondition(c: RotationCondition, power: PowerKind | null): string {
  const op = (x: ConditionCmp) => (x === "gte" ? "≥" : "<");
  switch (c.type) {
    case "resource": {
      const name = power ? power[0]!.toUpperCase() + power.slice(1) : "Resource";
      return `${name} ${op(c.cmp)} ${r1(c.value)}${power === "mana" ? "%" : ""}`;
    }
    case "comboPoints":
      return `Combo points ${op(c.cmp)} ${r1(c.value)}`;
    case "targetHp":
      return `Target health ${op(c.cmp)} ${r1(c.value)}%`;
    case "timeLeft":
      return `Fight time left ${op(c.cmp)} ${r1(c.value)} s`;
    case "auraLeft":
      return `Own DoT/buff left ${op(c.cmp)} ${r1(c.value)} s`;
    case "aura":
      return `${c.ref} ${c.active ? "active" : "not active"}`;
    case "cooldown":
      return `${c.ref} ${c.ready ? "ready" : "on cooldown"}`;
  }
}
```

The editor offers rank chains and talent abilities that deal damage
(directly, periodically or through a triggered spell), buff cooldowns (cooldown > 0 with a damage/resource caster aura
or an energize), and everything used by a default rotation. A new entry copies the ability's entry from the first default
rotation that uses it (kind, cp, everySec, buff, requires, requiresTalent, conditions), else `suggestKind`.

`src/engine/rotation/catalog.ts` (exact):

```ts
import type {
  ClassSpellFile,
  ClassToken,
  RotationEntry,
  RotationEntryKind,
  RotationsFile,
  Spell,
  Talent,
} from "@/data/types";

/** One ability the rotation editor offers. `id` is its stable URL key (section 5.2). */
export interface CatalogAbility {
  name: string;
  id: number; // first spell id of the rank chain, or the talent spell id for a talent-only ability
  icon: string | null;
  talent: string | null; // the talent that grants it
  entry: RotationEntry; // default entry when added (kind, cp, everySec, requires ... from the default rotations)
}

const WEAPON_OR_SCHOOL_DAMAGE = new Set([2, 17, 31, 58, 121]);
const PERIODIC_DAMAGE = new Set([3, 53]);
const TRIGGER_SPELL = 64;
const PERIODIC_TRIGGER = 23;
/** Caster auras of a cooldown that change damage or resources (same set the simulator applies, section 4.3). */
const BUFF_AURAS = new Set([65, 79, 107, 108, 110, 134, 140, 290, 319, 342]);
const COMBO_POINTS = 4;
const TARGET_CASTER = 1;

const directDamage = (s: Spell) => s.effects.some((e) => WEAPON_OR_SCHOOL_DAMAGE.has(e.effect));
/** Deals damage itself, over time, or through a triggered spell (Mutilate strikes, Arcane Missiles). */
function damaging(s: Spell, spells: ReadonlyMap<number, Spell>): boolean {
  if (directDamage(s)) return true;
  return s.effects.some((e) => {
    if (e.effect === 6 && PERIODIC_DAMAGE.has(e.aura)) return true;
    const triggers = e.effect === TRIGGER_SPELL || (e.effect === 6 && e.aura === PERIODIC_TRIGGER);
    const t = triggers && e.triggerSpell ? spells.get(e.triggerSpell) : undefined;
    return t !== undefined && directDamage(t);
  });
}
/** A cooldown whose caster auras or energize change damage or resources (Death Wish, Evocation, Bloodrage). */
function burst(s: Spell): boolean {
  if (s.cooldownMs <= 0) return false;
  return s.effects.some(
    (e) =>
      (e.effect === 6 && BUFF_AURAS.has(e.aura) && (!e.targets || e.targets[0] === TARGET_CASTER)) ||
      (e.effect === 30 && (e.misc[0] === 1 || e.misc[0] === 3)),
  );
}

/** Kind of a new entry when no default rotation uses the ability (section 5.1). */
export function suggestKind(s: Spell): RotationEntryKind {
  const direct = directDamage(s) || s.effects.some((e) => e.effect === TRIGGER_SPELL);
  const periodic = s.effects.some(
    (e) => e.effect === 6 && (PERIODIC_DAMAGE.has(e.aura) || e.aura === PERIODIC_TRIGGER),
  );
  if (s.effects.some((e) => (e.pointsPerCombo ?? 0) !== 0)) return "finisher";
  if (s.effects.some((e) => e.effect === 30 && e.misc[0] === COMBO_POINTS)) return "builder";
  if (!direct && !periodic) return "burst";
  if (periodic && !direct && !s.channeled) return "dot";
  if (s.gcdMs === 0 && s.effects.some((e) => e.effect === 17) && s.cooldownMs === 0) return "nextSwing";
  if (s.cooldownMs > 0 || s.categoryCooldownMs > 0) return "cooldown";
  return "filler";
}

/**
 * Abilities of a class for the rotation editor: rank chains and talent abilities that deal damage, are buff cooldowns,
 * or appear in a default rotation. Sorted by name. Pure.
 */
export function abilityCatalog(
  file: ClassSpellFile,
  classTalents: readonly Talent[],
  rotations: RotationsFile,
  token: ClassToken,
): CatalogAbility[] {
  const spells = new Map(file.spells.map((s) => [s.id, s]));
  const defaults = new Map<string, RotationEntry>();
  for (const r of rotations.rotations.filter((x) => x.class === token))
    for (const e of r.entries) if (!defaults.has(e.ability)) defaults.set(e.ability, e);
  const out = new Map<string, CatalogAbility>();
  const add = (name: string, id: number, top: Spell | undefined, talent: string | null) => {
    if (!top || out.has(name)) return;
    if (!defaults.has(name) && (top.passive || (!damaging(top, spells) && !burst(top)))) return;
    const entry = defaults.get(name) ?? { ability: name, kind: suggestKind(top) };
    out.set(name, { name, id, icon: top.icon, talent, entry: structuredClone(entry) });
  };
  for (const c of file.abilities) {
    if (c.passive || c.ranks.length === 0) continue;
    const talent = classTalents.find((t) => t.kind === "ability" && t.name === c.name);
    add(c.name, c.ranks[0]!, spells.get(c.ranks[c.ranks.length - 1]!), talent?.name ?? null);
  }
  for (const t of classTalents)
    if (t.kind === "ability") add(t.name, t.spellId, spells.get(t.spellId), t.name);
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
```

### 4.4 The fight (event loop) — algorithm

```
Fight.run():
  push SWING(mainHand/offHand) at 0 if the rotation melees and the slot has a weapon; SWING(ranged) at 0 for Auto Shot
  push RAGE_TICK every Anger Management period
  act()
  loop: e = pop(); stop when the queue is empty or e.t >= fightSec
        advance(e.t)            # continuous regeneration: energy 10/s x (1 + aura 110 %), rage from averaged handlers,
                                # mana: Spirit regen, x castRegen% inside the five-second rule (split at the boundary)
        handle e                # SWING, CAST_END(gen), TICK(dot, gen), CHANNEL_TICK(gen), BUFF_EXPIRE(buff, gen), WAKE,
                                # RAGE_TICK, ENERGIZE_TICK
        act(); sample resource for the timeline (iteration 0, every >= 0.5 s)
  add the averaged handlers' extraDps x fightSec; close idle/OOM intervals

act():
  if a cast or channel is pending: return
  repeat up to 16 times:
    for i in entries (priority order):
      a = evaluation of entry i in the current buff state (finishers: at min(5, combo points))
      skip if a is on the GCD and the GCD is running
      if usable(i): endIdle(); cast(i); if now casting/channeling: return; restart the walk
    if nothing was cast: break
  if the GCD is free: start the idle (and, when an entry is blocked by mana, the OOM) interval
  scheduleWake(): earliest of GCD end, cooldown/category ends, time to afford each entry at the current regen rate,
                  five-second-rule end, DoT/buff refresh times, execute start (0.8 T), targetHp/timeLeft crossings,
                  now + 0.5 s when an entry has an auraLeft/aura/cooldown condition

usable(i):  talent ok, not a skipped builder, learned, cooldown and category ready, `requires` DoT active,
            kind rule (section 0), affordable (mana: unless unlimited), conditionsHold (incl. execute-only)

cast(i):    nextSwing -> queue it, return
            pay cost (Execute: also all extra rage), energize, start cooldown/category/GCD, use charge buffs whose
            107/108 masks match the spell (Clearcasting, Presence of Mind, Cold Blood), Shadow Trance makes Shadow Bolt
            instant; burst/buff finisher -> apply its BuffDef (finisher: duration from the evaluation at that cp;
            Combustion: 0 stacks), energize / periodic energize of the buff
            cast time > 0 -> CAST_END; channel -> CHANNEL_TICKs (count = part.count, or one tick without damage)
            else resolve(i)

resolve(i): count the cast; for each direct part, count times: land roll (part.chances.land), crit roll, damage =
            uniform(range) or perHit, x critMultiplier; Execute x (1 + 15 x extra rage / 600)
            periodic part: if the first direct roll landed (or its own land roll for pure DoTs) -> (re)apply the DoT
            (snapshot perTick, crit, critMult; ticks every periodSec; a recast replaces the old one)
            extras of averaged hooks (Lightning Overload) added as expected values
            builder: + combo points per landed hit (+1 at Seal Fate chance on a crit); finisher: spend, Ruthlessness
            spell landed: Clearcasting chance; spell crits: Ignite (rolling), Improved Shadow Bolt; Combustion stacks
            melee/ranged ability: weaponHit procs

white swing (MH): a queued nextSwing replaces it when affordable and its conditions still hold (yellow roll, no rage)
            else single roll: miss/dodge, glancing (x glancingMultiplier), crit (x2), hit; uniform weapon roll
            rage = 7.5 x damage / c(L); weaponHit: Flurry (crit -> 3 charges), Deep Wounds (crit), Unbridled Wrath,
            extra attacks (main hand, not from extra attacks), Windfury (white MH), Seal of Command (white MH, 7 PPM)
            next swing at speed / (1 + Flurry%) while charges last (each hasted swing uses a charge)
Auto Shot:  waits while casting; a ranged cast restarts its timer
```

### 4.5 Code: `src/engine/sim/` (exact, tasks T5-T6)

`src/engine/sim/types.ts` (exact):

```ts
import type { School, SpecRotation, TargetsFile } from "@/data/types";
import type { PowerKind } from "@/engine/abilities";
import type { PrepareArgs } from "@/engine/rotation";
import type { TargetInput } from "@/engine/stats";

/** Everything one simulation needs; plain data, so it can be posted to the worker (structured clone). */
export interface SimInput {
  prepare: Omit<PrepareArgs, "rotation" | "extraBuffs">;
  rotation: SpecRotation; // the user's rotation (with conditions)
  target: TargetInput; // presetTarget(...) incl. debuffs
  armorFormula: TargetsFile["armorFormula"];
}

export interface SimConfig {
  fightSec: number; // fight length; the target's health falls linearly from 100% to 0% over it
  iterations: number;
  seed: number; // uint32
  unlimitedMana: boolean; // mana never limits casts (cross-check with the analytical model)
  logLimit: number; // combat log lines of iteration 0
}
export const DEFAULT_SIM_CONFIG: SimConfig = {
  fightSec: 180,
  iterations: 1000,
  seed: 1,
  unlimitedMana: true, // gear v1 has no mana items (no MP5, no mana pool from gear): section 0 "Mana"
  logLimit: 300,
};
export const SIM_LIMITS = { fightSec: [30, 900], iterations: [10, 10000], seed: [0, 4294967295] } as const;

export interface Summary {
  mean: number;
  stdev: number; // sample standard deviation of the per-iteration DPS
  ci95: [number, number]; // mean +- 1.96 stdev / sqrt(n)
  min: number;
  max: number;
}

/** One damage source over all iterations (means per fight). */
export interface SimSource {
  key: string; // ability, "Main-hand melee", proc or talent label
  school: School;
  damage: number; // mean damage per fight
  dps: number;
  share: number; // % of the total damage
  casts: number; // casts, swings or procs per fight
  hits: number; // landed hits/ticks per fight (incl. crits and glancing blows)
  crits: number;
  misses: number; // missed, dodged or resisted casts/swings per fight
  ticks: number; // periodic ticks per fight
  averaged: boolean; // expected-value damage from the analytical model (not sampled)
}

export interface SimLogLine {
  t: number;
  source: string;
  outcome: "hit" | "crit" | "glance" | "miss" | "tick" | "tickCrit" | "cast" | "buff" | "fade" | "gain";
  damage: number;
  resource: number | null;
}

export interface SimResult {
  config: SimConfig;
  rotationLabel: string;
  power: PowerKind | null;
  dps: Summary;
  sources: SimSource[]; // sorted by damage
  idleSec: number; // mean seconds per fight with nothing to do (out of resource, waiting for cooldowns)
  oomSec: number; // mean seconds per fight waiting for mana
  timeline: { max: number; points: [number, number][] } | null; // iteration 0: resource over time
  log: SimLogLine[]; // iteration 0: the first `logLimit` events
  averaged: string[]; // talent handlers kept as analytical averages
  modeled: string[]; // procs and buffs sampled by the simulator
  elapsedMs: number;
}

export type SimRequest = { type: "run"; id: number; input: SimInput; config: SimConfig };
export type SimResponse =
  | { type: "progress"; id: number; done: number; total: number }
  | { type: "result"; id: number; result: SimResult }
  | { type: "error"; id: number; message: string };
```

`src/engine/sim/constants.ts` (exact):

```ts
// Phase 5 simulator constants. Classic 1.12 values unless stated; none is confirmed in Forever ([VERIFY], Q59-Q66).
import type { ClassToken } from "@/data/types";

/**
 * src: vmangos Player::OCTRegenMPPerSpirit (Classic 1.12): mana per 2 s regeneration tick = Spirit x perSpirit + flat.
 * Warriors and rogues have no mana. [VERIFY Q59]
 */
export const SPIRIT_REGEN: Readonly<Record<ClassToken, { perSpirit: number; flat: number }>> = {
  druid: { perSpirit: 1 / 5, flat: 15 },
  hunter: { perSpirit: 1 / 5, flat: 15 },
  mage: { perSpirit: 1 / 4, flat: 12.5 },
  paladin: { perSpirit: 1 / 5, flat: 15 },
  priest: { perSpirit: 1 / 4, flat: 12.5 },
  shaman: { perSpirit: 1 / 5, flat: 17 },
  warlock: { perSpirit: 1 / 5, flat: 15 },
  warrior: { perSpirit: 0, flat: 0 },
  rogue: { perSpirit: 0, flat: 0 },
};
export const REGEN_TICK_SEC = 2;
/** src: Classic "five-second rule": no Spirit regeneration for 5 s after spending mana (aura 134 talents allow a %). [VERIFY Q59] */
export const FIVE_SECOND_RULE_SEC = 5;

export const MAX_RAGE = 100;
export const MAX_ENERGY = 100;
export const MAX_COMBO_POINTS = 5;
/** Rotations start with full energy and mana and with 0 rage (no pre-pull Bloodrage). */
export const START_RAGE = 0;

/** src: Classic Execute rank 5 tooltip "converting each extra point of rage into 15 additional damage"; the Forever
 * tooltip token ($*10;F1) is not resolved. [VERIFY Q60] */
export const EXECUTE_DAMAGE_PER_RAGE = 15;

/** Talent procs (values from the talent ranks; durations from Classic tooltips where the data has no spell). [VERIFY Q61] */
export const IGNITE = { durationSec: 4, periodSec: 2 } as const; // rolling: a new crit adds to the unticked damage and refreshes
export const DEEP_WOUNDS = { durationSec: 12, periodSec: 3 } as const; // "over 12 sec"; a crit restarts the bleed
export const IMPROVED_SHADOW_BOLT_SEC = 12; // "for 12 sec" (no charges, like the Phase 4 handler)
export const SHADOW_TRANCE_SEC = 10; // Classic Shadow Trance (17941) lasts 10 s; not in the Forever data
export const FLURRY_SWINGS = 3; // "for your next 3 swings"
export const COMBUSTION_CRITS = 3; // "until you have caused 3 non-periodic critical strikes"

/** Seconds between decisions while waiting for a time-based condition (target health, fight time left). */
export const POLL_SEC = 0.5;
/** Resource timeline of iteration 0: one point per this many seconds at most. */
export const TIMELINE_STEP_SEC = 0.5;
```

`src/engine/sim/rng.ts` (exact):

```ts
/**
 * Seeded PRNG (ARCHITECTURE rule 2: the engine never calls Math.random). sfc32 (Chris Doty-Humphrey, PractRand-clean,
 * period >= 2^32) seeded through splitmix32. Each iteration gets its own stream `iterationSeed(seed, i)`, so a result
 * does not depend on how iterations are batched.
 */
export type Rng = () => number; // uniform in [0, 1)

export function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const init = splitmix32(seed);
  let a = init();
  let b = init();
  let c = init();
  let d = init();
  const next: Rng = () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 12; i++) next(); // discard the warm-up outputs
  return next;
}

/** Seed of iteration i: independent of the batch size and of the worker count. */
export function iterationSeed(seed: number, i: number): number {
  return splitmix32((seed >>> 0) ^ Math.imul(i + 1, 0x9e3779b1))();
}
```

`src/engine/sim/queue.ts` (exact):

```ts
/** One scheduled event. `a`/`b` carry indices or generations; their meaning depends on `type` (engine.ts EV). */
export interface SimEvent {
  t: number;
  seq: number;
  type: number;
  a: number;
  b: number;
}

/**
 * Binary min-heap ordered by (time, insertion sequence): events at the same time fire in the order they were scheduled,
 * which keeps runs deterministic.
 */
export class EventQueue {
  private heap: SimEvent[] = [];
  private seq = 0;

  get size(): number {
    return this.heap.length;
  }

  push(t: number, type: number, a = 0, b = 0): void {
    const e: SimEvent = { t, seq: this.seq++, type, a, b };
    const h = this.heap;
    h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(e, h[p]!)) break;
      h[i] = h[p]!;
      i = p;
    }
    h[i] = e;
  }

  pop(): SimEvent | undefined {
    const h = this.heap;
    const top = h[0];
    const last = h.pop();
    if (!top || !last || h.length === 0) return top;
    let i = 0;
    const n = h.length;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && before(h[r]!, h[l]!) ? r : l;
      if (!before(h[c]!, last)) break;
      h[i] = h[c]!;
      i = c;
    }
    h[i] = last;
    return top;
  }

  peekTime(): number {
    return this.heap[0]?.t ?? Infinity;
  }

  clear(): void {
    this.heap.length = 0;
    this.seq = 0;
  }
}

const before = (x: SimEvent, y: SimEvent) => x.t < y.t || (x.t === y.t && x.seq < y.seq);
```

`src/engine/sim/procs.ts` (exact):

```ts
import type { School, SpecRotation, Spell } from "@/data/types";
import type { Prepared } from "@/engine/rotation";
import type { EquippedWeapons, RankedTalent } from "@/engine/stats";
import type { BuffDef } from "./model";

/**
 * Talent spell ids whose behavior the simulator samples as real events (section 4.5). Their Phase 4 handlers keep
 * their `stats` hook (applied by prepareDamage) but their `ability`/`rotation` hooks are not passed to evaluateDamage,
 * so nothing is counted twice. Every other handler stays an analytical average (SimResult.averaged).
 */
export const TALENT = {
  IGNITE: 11119,
  FLURRY_WARRIOR: 12319,
  FLURRY_SHAMAN: 16256,
  IMPROVED_SHADOW_BOLT: 17793,
  NIGHTFALL: 18094,
  DEEP_WOUNDS: 12834,
  UNBRIDLED_WRATH: 12322,
  ANGER_MANAGEMENT: 12296,
  SEAL_FATE: 14186,
  RUTHLESSNESS: 14156,
  WEAPONMASTER: 1290261,
  HACK_AND_SLASH: 13960,
  ARCANE_CONCENTRATION: 11213, // no Phase 4 handler (mana only)
  ELEMENTAL_FOCUS: 16164, // no Phase 4 handler (mana only)
  COMBUSTION: 11129,
} as const;
export const SIM_PROC_TALENTS: ReadonlySet<number> = new Set(Object.values(TALENT));

/** Extra-attack part of the weapon talents: same value index and weapon subclasses as handlers.ts weaponTalent(). */
const EXTRA_ATTACK: Readonly<Record<number, { valueIndex: number; subclasses: number[] }>> = {
  [TALENT.WEAPONMASTER]: { valueIndex: 2, subclasses: [7, 8] }, // swords
  [TALENT.HACK_AND_SLASH]: { valueIndex: 0, subclasses: [0, 1, 7, 8] }, // axes and swords
};
const NIGHTFALL_SPELLS: ReadonlySet<string> = new Set(["Corruption", "Drain Life", "Drain Soul", "Wrack"]);
const ELEMENTAL_FOCUS_SCHOOLS: School[] = ["fire", "frost", "nature"];

export interface ActiveProcs {
  ignitePct: number;
  flurryPct: number;
  isbPct: number;
  nightfallPct: number;
  nightfallSpells: ReadonlySet<string>;
  deepWoundsPct: number;
  unbridledWrathPct: number;
  angerManagement: { amount: number; periodSec: number } | null;
  sealFatePct: number;
  ruthlessnessPct: number;
  extraAttackPct: number; // main-hand weapon hits
  clearcasting: { chance: number; schools: School[] | null; spell: Spell; buff: BuffDef | null } | null;
  combustion: { spell: Spell; buff: BuffDef | null } | null;
  sealOfCommand: Spell | null; // the proc spell of the rotation's Seal of Command
  windfury: boolean;
  labels: string[]; // what the simulator samples, for the results panel
}

const value = (t: RankedTalent | undefined, i: number) =>
  t ? (t.talent.ranks[t.rank - 1]?.values[i] ?? 0) : 0;
const triggerOf = (spell: Spell | undefined, book: Prepared["book"]) => {
  const id = spell?.effects.find((e) => e.triggerSpell)?.triggerSpell;
  return id ? book.spells.get(id) : undefined;
};

export function activeProcs(
  prepared: Prepared,
  talents: readonly RankedTalent[],
  weapons: EquippedWeapons,
  rotation: SpecRotation,
): ActiveProcs {
  const ranked = (id: number) => talents.find((t) => t.talent.spellId === id && t.rank > 0);
  const labels: string[] = [];
  const pct = (id: number, i: number, text: string) => {
    const t = ranked(id);
    const v = value(t, i);
    if (t && v > 0) labels.push(`${t.talent.name} ${t.rank}/${t.talent.maxRank}: ${text}`);
    return v;
  };
  const book = prepared.book;
  const mh = weapons.mainHand?.subclass;
  let extraAttackPct = 0;
  for (const [id, x] of Object.entries(EXTRA_ATTACK))
    if (mh !== undefined && x.subclasses.includes(mh))
      extraAttackPct += pct(Number(id), x.valueIndex, "extra main-hand attacks");
  const am = ranked(TALENT.ANGER_MANAGEMENT);
  if (am) labels.push(`${am.talent.name}: 1 rage every ${value(am, 2)} s`);

  let clearcasting: ActiveProcs["clearcasting"] = null;
  for (const [id, schools] of [
    [TALENT.ARCANE_CONCENTRATION, null],
    [TALENT.ELEMENTAL_FOCUS, ELEMENTAL_FOCUS_SCHOOLS],
  ] as const) {
    const t = ranked(id);
    const spell = triggerOf(book.spells.get(id), book);
    if (t && spell && value(t, 0) > 0) {
      clearcasting = { chance: value(t, 0), schools: schools ? [...schools] : null, spell, buff: null };
      labels.push(`${t.talent.name} ${t.rank}/${t.talent.maxRank}: Clearcasting procs`);
    }
  }
  const comb = ranked(TALENT.COMBUSTION) ? triggerOf(book.spells.get(TALENT.COMBUSTION), book) : undefined;
  if (comb) labels.push("Combustion: +10% Fire crit per Fire hit, removed after 3 crits");

  const seal = prepared.selfBuffs.find((s) => s.name === "Seal of Command");
  const sealOfCommand = triggerOf(seal, book) ?? null;
  if (sealOfCommand) labels.push("Seal of Command: 7 procs per minute on main-hand swings");
  const windfury = rotation.melee && prepared.selfBuffs.some((s) => s.name === "Windfury Weapon");
  if (windfury) labels.push("Windfury Weapon: 20% chance of 2 extra attacks");

  return {
    ignitePct: pct(TALENT.IGNITE, 0, "rolling Ignite"),
    flurryPct:
      pct(TALENT.FLURRY_WARRIOR, 0, "Flurry charges on crits") +
      pct(TALENT.FLURRY_SHAMAN, 0, "Flurry charges on crits"),
    isbPct: pct(TALENT.IMPROVED_SHADOW_BOLT, 0, "Shadow Bolt crits apply the debuff"),
    nightfallPct: pct(TALENT.NIGHTFALL, 0, "Shadow Trance procs"),
    nightfallSpells: NIGHTFALL_SPELLS,
    deepWoundsPct: pct(TALENT.DEEP_WOUNDS, 0, "bleed on crits"),
    unbridledWrathPct: pct(TALENT.UNBRIDLED_WRATH, 0, "rage procs"),
    angerManagement: am ? { amount: value(am, 1), periodSec: Math.max(1, value(am, 2)) } : null,
    sealFatePct: pct(TALENT.SEAL_FATE, 0, "extra combo points on crits"),
    ruthlessnessPct: pct(TALENT.RUTHLESSNESS, 0, "combo point refunds"),
    extraAttackPct,
    clearcasting,
    combustion: comb ? { spell: comb, buff: null } : null,
    sealOfCommand,
    windfury,
    labels,
  };
}
```

`src/engine/sim/model.ts` (exact):

```ts
import type { AttackSlot, ClassToken, RotationEntry, SpecRotation, Spell } from "@/data/types";
import {
  evaluateAbility,
  evaluateWhite,
  learn,
  weaponInfo,
  type AbilityEval,
  type AbilityResult,
  type DamageContext,
  type PowerKind,
  type WhiteResult,
} from "@/engine/abilities";
import { WINDFURY } from "@/engine/combat";
import { evaluateDamage, prepareDamage, type Prepared } from "@/engine/rotation";
import { evaluateTarget, mapAura, type RankedTalent } from "@/engine/stats";
import { SPIRIT_REGEN, REGEN_TICK_SEC } from "./constants";
import { activeProcs, SIM_PROC_TALENTS, type ActiveProcs } from "./procs";
import type { SimInput } from "./types";

const APPLY_AURA = 6;
const ENERGIZE = 30;
const TRIGGER_SPELL = 64;
const AURA_PERIODIC_ENERGIZE = 24;
const AURA_POWER_REGEN_PCT = 110;
const AURA_REGEN_WHILE_CASTING = 134;
const TARGET_CASTER = 1;
const POWER: Readonly<Record<number, PowerKind>> = { 0: "mana", 1: "rage", 2: "focus", 3: "energy" };

/** A player buff the simulator tracks: a burst cooldown, a buff finisher (Slice and Dice) or a proc (Clearcasting). */
export interface BuffDef {
  index: number;
  name: string;
  spell: Spell | null; // passed to prepareDamage while active (null: the simulator applies the effect itself)
  stateful: boolean; // changes ability evaluation (stat, damage-done or spell-modifier auras)
  durationSec: number; // Infinity: until its charges are used
  charges: number; // 0: none; a cast whose spell matches one of `masks` uses a charge
  masks: [number, number, number, number][];
  maxStacks: number;
  regenPct: Partial<Record<PowerKind, number>>; // aura 110: +% regeneration of a power
  castRegenPct: number; // aura 134: % of mana regeneration that continues while casting
  energize: { power: PowerKind; amount: number } | null; // effect 30 on use (Bloodrage: +10 rage)
  periodicEnergize: { power: PowerKind; amount: number; periodSec: number; ticks: number } | null; // aura 24
}

export interface SimEntry {
  index: number;
  entry: RotationEntry;
  buff: BuffDef | null; // burst cooldowns and buff finishers
  requires: number; // index of the entry whose DoT must be active (-1: none)
  talentOk: boolean; // requiresTalent satisfied
  explicitAuraLeft: boolean; // the entry has its own auraLeft condition (replaces the implicit refresh rule)
  skip: boolean; // a builder that is not the rotation's builder (like the analytical model: the first learned one)
}

/** Abilities and white attacks evaluated with one set of active buffs (memoized per set). */
export interface StateEval {
  key: string;
  ctx: DamageContext;
  abilities: AbilityEval[]; // per entry (finishers at entry.cp)
  finisherAt(entryIndex: number, cp: number): AbilityEval;
  white: Record<AttackSlot, WhiteResult | null>;
  whiteSpread: Record<AttackSlot, number>; // half range of a normal white hit (uniform weapon roll)
  windfury: WhiteResult | null;
  sealOfCommand: AbilityResult | null;
  extraDps: { label: string; dps: number }[]; // averaged handlers (expected values)
  ragePerSec: number; // averaged handlers (Dual Wield Specialization)
}

export interface ActiveBuffKey {
  def: BuffDef;
  stacks: number;
}

export interface SimModel {
  input: SimInput;
  token: ClassToken;
  level: number;
  rotation: SpecRotation;
  power: PowerKind | null;
  entries: SimEntry[];
  buffs: BuffDef[];
  procs: ActiveProcs;
  prepared: Prepared; // base state
  maxMana: number;
  spiritRegenPerSec: number; // outside the five-second rule
  castRegenPct: number; // talents (aura 134): % of Spirit regeneration while casting
  averaged: string[];
  modeled: string[];
  state(active: readonly ActiveBuffKey[]): StateEval;
  stateCount(): number;
}

/** Caster auras of a buff spell that change ability evaluation (same mapper as the Phase 4 self-buffs). */
function isStateful(spell: Spell): boolean {
  return spell.effects.some((e) => {
    if (e.effect !== APPLY_AURA || (e.targets && e.targets[0] !== TARGET_CASTER)) return false;
    if (e.aura === 107 || e.aura === 108) return true;
    const m = mapAura(e, e.base);
    return m.kind === "stat" || m.kind === "damageDone";
  });
}

export function buffDef(index: number, spell: Spell, book: Prepared["book"], name = spell.name): BuffDef {
  const regenPct: Partial<Record<PowerKind, number>> = {};
  let castRegenPct = 0;
  let energize: BuffDef["energize"] = null;
  let periodicEnergize: BuffDef["periodicEnergize"] = null;
  const amount = (power: PowerKind, base: number) => (power === "rage" ? base / 10 : base);
  for (const e of spell.effects) {
    if (e.effect === APPLY_AURA && e.aura === AURA_POWER_REGEN_PCT && e.base !== 0) {
      const p = POWER[e.misc[0]];
      if (p) regenPct[p] = (regenPct[p] ?? 0) + e.base;
    }
    if (e.effect === APPLY_AURA && e.aura === AURA_REGEN_WHILE_CASTING) castRegenPct += e.base;
    if (e.effect === ENERGIZE && POWER[e.misc[0]])
      energize = { power: POWER[e.misc[0]]!, amount: amount(POWER[e.misc[0]]!, e.base) };
    if (e.effect === TRIGGER_SPELL && e.triggerSpell) {
      const t = book.spells.get(e.triggerSpell);
      const pe = t?.effects.find((x) => x.effect === APPLY_AURA && x.aura === AURA_PERIODIC_ENERGIZE);
      const p = pe ? POWER[pe.misc[0]] : undefined;
      if (t && pe && p && pe.periodMs && t.duration && t.duration.ms > 0)
        periodicEnergize = {
          power: p,
          amount: amount(p, pe.base),
          periodSec: pe.periodMs / 1000,
          ticks: Math.floor(t.duration.ms / pe.periodMs),
        };
    }
  }
  const dur = spell.duration?.ms ?? 0;
  const charges = spell.proc?.charges ?? 0;
  return {
    index,
    name,
    spell,
    stateful: isStateful(spell),
    durationSec: dur > 0 ? dur / 1000 : charges > 0 ? Infinity : 0,
    charges,
    masks: spell.effects
      .filter((e) => e.effect === APPLY_AURA && (e.aura === 107 || e.aura === 108))
      .map((e) => e.mask),
    maxStacks: Math.max(1, spell.maxStacks),
    regenPct,
    castRegenPct,
    energize,
    periodicEnergize,
  };
}

const noBuffFlags = (r: SpecRotation): SpecRotation => ({
  ...r,
  entries: r.entries.map((e) => {
    const rest = { ...e };
    delete rest.buff;
    return rest;
  }),
});

/**
 * Builds the simulator's view of a character (section 4.3): the base Phase 4 preparation, one BuffDef per burst
 * cooldown / buff finisher / proc buff, and a memoized evaluation per set of active buffs. Every damage number comes
 * from evaluateDamage/evaluateAbility/evaluateWhite (the sim never re-implements a formula).
 */
export function buildModel(input: SimInput): SimModel {
  const { prepare, rotation } = input;
  const level = prepare.level;
  // Buff finishers (Slice and Dice) are dynamic in the simulator: prepareDamage must not apply them permanently.
  const prepRotation = noBuffFlags(rotation);
  const prepared = prepareDamage({ ...prepare, rotation: prepRotation });
  const book = prepared.book;
  const talents: readonly RankedTalent[] = prepare.talents;
  const rank = (name: string) => talents.find((t) => t.talent.name === name)?.rank ?? 0;
  const procs = activeProcs(prepared, talents, prepare.weapons, rotation);

  const buffs: BuffDef[] = [];
  const addBuff = (spell: Spell, name?: string) => {
    const existing = buffs.find((b) => b.name === (name ?? spell.name));
    if (existing) return existing;
    const b = buffDef(buffs.length, spell, book, name);
    buffs.push(b);
    return b;
  };
  const learned = (name: string) => {
    const l = learn(book, name, level, talents, prepare.classTalents);
    return "spell" in l ? l.spell : null;
  };
  // Combustion (talent 11129) stacks its trigger spell 28682 (+10% Fire crit per stack) until 3 Fire crits.
  const combustion = procs.combustion ? addBuff(procs.combustion.spell, "Combustion") : null;
  if (combustion && procs.combustion) {
    combustion.durationSec = Infinity;
    procs.combustion.buff = combustion;
  }
  const entries: SimEntry[] = rotation.entries.map((entry, index) => {
    const spell = entry.kind === "burst" || entry.buff ? learned(entry.ability) : null;
    return {
      index,
      entry,
      buff: entry.ability === "Combustion" && combustion ? combustion : spell ? addBuff(spell) : null,
      requires: entry.requires ? rotation.entries.findIndex((e) => e.ability === entry.requires) : -1,
      talentOk: !entry.requiresTalent || rank(entry.requiresTalent) > 0,
      explicitAuraLeft: (entry.conditions ?? []).some((c) => c.type === "auraLeft"),
      skip: false,
    };
  });
  if (procs.clearcasting) procs.clearcasting.buff = addBuff(procs.clearcasting.spell);

  const cache = new Map<string, StateEval>();
  const dualWield = prepared.assembled.input.weapons.offHand !== null;
  const simHandled = (id: number) => SIM_PROC_TALENTS.has(id);

  const build = (active: readonly ActiveBuffKey[], key: string): StateEval => {
    const extra: Spell[] = [];
    for (const a of active)
      if (a.def.stateful && a.def.spell) for (let i = 0; i < a.stacks; i++) extra.push(a.def.spell);
    const p = extra.length
      ? prepareDamage({ ...prepare, rotation: prepRotation, extraBuffs: extra })
      : prepared;
    const view = evaluateTarget(p.stats, input.target, input.armorFormula, dualWield);
    const r = evaluateDamage({
      level,
      stats: p.stats,
      view,
      book: p.book,
      weapons: p.assembled.input.weapons,
      rotation,
      talents,
      classTalents: prepare.classTalents,
      spellMods: p.assembled.mapping.spellMods,
      selfBuffs: p.selfBuffs,
      handlers: p.handlers.filter((h) => !simHandled(h.handler.spellId)),
    });
    const ctx = r.ctx;
    const melee = rotation.melee;
    const white: StateEval["white"] = {
      mainHand: melee ? evaluateWhite(ctx, "mainHand") : null,
      offHand: melee && ctx.form !== "cat" ? evaluateWhite(ctx, "offHand") : null,
      ranged: rotation.autoShot ? evaluateWhite(ctx, "ranged") : null,
    };
    const spread = (slot: AttackSlot): number => {
      const w = weaponInfo(ctx, slot);
      const res = white[slot];
      return w && res && w.perSwing > 0 ? (w.spread * res.normalHit) / w.perSwing : 0;
    };
    const finishers = new Map<string, AbilityEval>();
    const soc = procs.sealOfCommand
      ? evaluateAbility({ ability: "Seal of Command (proc)", kind: "cooldown" }, ctx, procs.sealOfCommand)
      : null;
    return {
      key,
      ctx,
      abilities: r.abilities,
      finisherAt(i, cp) {
        const k = `${i}:${cp}`;
        let a = finishers.get(k);
        if (!a) {
          a = evaluateAbility({ ...rotation.entries[i]!, cp }, ctx);
          finishers.set(k, a);
        }
        return a;
      },
      white,
      whiteSpread: { mainHand: spread("mainHand"), offHand: spread("offHand"), ranged: spread("ranged") },
      windfury:
        procs.windfury && white.mainHand ? evaluateWhite(ctx, "mainHand", WINDFURY.attackPower) : null,
      sealOfCommand: soc && soc.available ? soc : null,
      extraDps: r.effects.filter((e) => e.extraDps).map((e) => ({ label: e.label, dps: e.extraDps! })),
      ragePerSec: r.effects.reduce((a, e) => a + (e.ragePerMinute ?? 0), 0) / 60,
    };
  };

  const base = build([], "");
  cache.set("", base);
  const builder = entries.find((e) => e.entry.kind === "builder" && base.abilities[e.index]!.available);
  for (const e of entries) e.skip = e.entry.kind === "builder" && e !== builder;
  const first = base.abilities.find((a): a is AbilityResult => a.available && a.power !== null);
  const power: PowerKind | null =
    first?.power ?? (prepared.stats.mana && prepared.stats.mana.value > 0 ? "mana" : null);
  const spirit = SPIRIT_REGEN[prepare.classToken];
  const castRegenPct = prepare.talents.reduce((sum, t) => {
    const vals = t.talent.ranks[t.rank - 1]?.values ?? [];
    return (
      sum +
      t.talent.effects.reduce(
        (s, e, pos) =>
          s + (e.effect === APPLY_AURA && e.aura === AURA_REGEN_WHILE_CASTING ? (vals[pos] ?? 0) : 0),
        0,
      )
    );
  }, 0);
  const averaged = prepared.handlers
    .filter((h) => !simHandled(h.handler.spellId) && (h.handler.rotation || h.handler.ability))
    .map((h) => `${h.args.label}: ${h.handler.modeled}`);
  return {
    input,
    token: prepare.classToken,
    level,
    rotation,
    power,
    entries,
    buffs,
    procs,
    prepared,
    maxMana: prepared.stats.mana?.value ?? 0,
    spiritRegenPerSec: (spirit.flat + spirit.perSpirit * prepared.stats.primary.spi.value) / REGEN_TICK_SEC,
    castRegenPct,
    averaged,
    modeled: procs.labels,
    state(active) {
      if (active.length === 0) return base;
      const key = active
        .filter((a) => a.def.stateful)
        .map((a) => `${a.def.index}x${a.stacks}`)
        .sort()
        .join(",");
      let s = cache.get(key);
      if (!s) {
        s = build(active, key);
        cache.set(key, s);
      }
      return s;
    },
    stateCount: () => cache.size,
  };
}
```

`src/engine/sim/engine.ts` (exact):

```ts
import type { AttackSlot, School } from "@/data/types";
import {
  familyMatches,
  weaponInfo,
  type AbilityEval,
  type AbilityResult,
  type DamagePart,
  type WhiteResult,
} from "@/engine/abilities";
import {
  ENERGY_PER_SECOND,
  RAGE_PER_DAMAGE_FACTOR,
  SEAL_OF_COMMAND_PPM,
  WINDFURY,
  primarySchool,
  rageConversion,
  schoolsOf,
} from "@/engine/combat";
import { EXECUTE_ONLY, EXECUTE_PHASE_PCT, conditionsHold, type ConditionState } from "@/engine/rotation";
import {
  COMBUSTION_CRITS,
  DEEP_WOUNDS,
  EXECUTE_DAMAGE_PER_RAGE,
  FIVE_SECOND_RULE_SEC,
  FLURRY_SWINGS,
  IGNITE,
  IMPROVED_SHADOW_BOLT_SEC,
  MAX_COMBO_POINTS,
  MAX_ENERGY,
  MAX_RAGE,
  POLL_SEC,
  SHADOW_TRANCE_SEC,
  START_RAGE,
  TIMELINE_STEP_SEC,
} from "./constants";
import type { ActiveBuffKey, BuffDef, SimModel, StateEval } from "./model";
import { EventQueue } from "./queue";
import type { Rng } from "./rng";
import type { SimConfig, SimLogLine } from "./types";

/** Event types (SimEvent.type). a/b: SWING slot; CAST_END -; TICK dot slot + generation; BUFF_EXPIRE buff + generation. */
export const EV = {
  SWING: 1,
  CAST_END: 2,
  TICK: 3,
  CHANNEL_TICK: 4,
  BUFF_EXPIRE: 5,
  WAKE: 6,
  RAGE_TICK: 7,
  ENERGIZE_TICK: 8,
} as const;
const SLOTS: readonly AttackSlot[] = ["mainHand", "offHand", "ranged"];
const EPS = 1e-9;

/** Per-source sums over all iterations (run.ts divides by the iteration count). */
export interface SourceAcc {
  school: School;
  damage: number;
  casts: number;
  hits: number;
  crits: number;
  misses: number;
  ticks: number;
  averaged: boolean;
}
export type Accumulator = Map<string, SourceAcc>;

export interface FightTrace {
  log: SimLogLine[];
  logLimit: number;
  timeline: [number, number][];
}
export interface FightTotals {
  damage: number;
  idleSec: number;
  oomSec: number;
}

interface Dot {
  name: string;
  source: string;
  active: boolean;
  gen: number;
  expires: number;
  ticksLeft: number;
  periodSec: number;
  perTick: number;
  crit: number; // % per tick
  critMult: number;
  schoolMask: number;
  pool: number; // Ignite: unticked damage
}
interface BuffInstance {
  def: BuffDef;
  expires: number;
  charges: number;
  stacks: number;
  crits: number; // Combustion
  gen: number;
}
interface Channel {
  entry: number;
  a: AbilityResult;
  part: DamagePart | null;
  landed: boolean; // periodic channels roll once (Mind Flay); missiles roll per hit
  ticksLeft: number;
  source: string;
}
interface Casting {
  gen: number;
  entry: number;
  a: AbilityResult; // evaluated with the buffs active when the cast started
}

const hasSchool = (mask: number, s: School) => schoolsOf(mask).includes(s);

/**
 * One fight (section 4.4). Time is in seconds; events at or after `fightSec` are not processed. The player acts after
 * every event: the first entry (top to bottom) that is usable is cast; off-GCD casts let the walk continue.
 */
export class Fight implements ConditionState {
  private q = new EventQueue();
  private t = 0;
  private readonly T: number;
  private readonly n: number;
  // player
  private busyUntil = 0;
  private gcdUntil = 0;
  private casting: Casting | null = null;
  private castGen = 0;
  private channel: Channel | null = null;
  private channelGen = 0;
  private readonly cdReady: Float64Array;
  private readonly categoryReady = new Map<number, number>();
  private readonly lastCast: Float64Array;
  private queuedSwing = -1;
  private rangedGen = 0;
  private pendingWake = Infinity;
  // resources
  resource = 0;
  comboPoints = 0;
  private readonly maxResource: number;
  private lastManaSpend = -Infinity;
  private lastAdvance = 0;
  // auras
  private readonly buffs: (BuffInstance | null)[];
  private buffGen = 0;
  private stateDirty = true;
  private current: StateEval;
  private readonly dots: Dot[];
  private readonly igniteSlot: number;
  private readonly deepWoundsSlot: number;
  private flurryCharges = 0;
  private shadowTranceUntil = -1;
  private isbUntil = -1;
  // stats
  private total = 0;
  private idleSince = -1;
  private oomSince = -1;
  private idleSec = 0;
  private oomSec = 0;
  private lastSample = -Infinity;

  constructor(
    private readonly model: SimModel,
    private readonly config: SimConfig,
    private readonly rng: Rng,
    private readonly acc: Accumulator,
    private readonly trace: FightTrace | null,
  ) {
    this.T = config.fightSec;
    this.n = model.entries.length;
    this.cdReady = new Float64Array(this.n);
    this.lastCast = new Float64Array(this.n).fill(-Infinity);
    this.buffs = model.buffs.map(() => null);
    this.current = model.state([]);
    const dot = (name: string): Dot => ({
      name,
      source: name,
      active: false,
      gen: 0,
      expires: 0,
      ticksLeft: 0,
      periodSec: 0,
      perTick: 0,
      crit: 0,
      critMult: 1,
      schoolMask: 1,
      pool: 0,
    });
    this.dots = model.entries.map((e) => dot(e.entry.ability));
    this.igniteSlot = this.dots.length;
    this.dots.push(dot("Ignite"));
    this.deepWoundsSlot = this.dots.length;
    this.dots.push(dot("Deep Wounds"));
    const p = model.power;
    this.maxResource =
      p === "mana" ? model.maxMana : p === "rage" ? MAX_RAGE : p === "energy" ? MAX_ENERGY : 0;
    this.resource = p === "rage" ? START_RAGE : this.maxResource;
  }

  // ---- ConditionState ----
  get power() {
    return this.model.power;
  }
  get maxMana() {
    return this.model.maxMana;
  }
  get targetHpPct() {
    return Math.max(0, 100 * (1 - this.t / this.T));
  }
  get timeLeft() {
    return Math.max(0, this.T - this.t);
  }
  auraLeft(i: number): number {
    const se = this.model.entries[i];
    if (!se) return 0;
    if (se.buff) {
      const b = this.buffs[se.buff.index];
      return b ? Math.max(0, b.expires - this.t) : 0;
    }
    if (se.entry.kind === "maintain") {
      const every = se.entry.everySec ?? 0;
      return Math.max(0, this.lastCast[i]! + every - this.t);
    }
    const d = this.dots[i]!;
    return d.active ? Math.max(0, d.expires - this.t) : 0;
  }
  auraActive(name: string): boolean {
    if (name === "Flurry") return this.flurryCharges > 0;
    if (name === "Shadow Trance") return this.shadowTranceUntil > this.t;
    if (name === "Improved Shadow Bolt") return this.isbUntil > this.t;
    for (const b of this.buffs) if (b && b.def.name === name) return true;
    for (const d of this.dots) if (d.active && d.name === name) return true;
    return false;
  }
  cooldownReady(ability: string): boolean {
    const i = this.model.entries.findIndex((e) => e.entry.ability === ability);
    return i < 0 || this.cdReady[i]! <= this.t + EPS;
  }

  // ---- main loop ----
  run(): FightTotals {
    const m = this.model;
    const st = this.current;
    if (m.rotation.melee && st.white.mainHand) this.q.push(0, EV.SWING, 0);
    if (m.rotation.melee && st.white.offHand) this.q.push(0, EV.SWING, 1);
    if (m.rotation.autoShot && st.white.ranged) this.q.push(0, EV.SWING, 2);
    if (m.procs.angerManagement && m.power === "rage")
      this.q.push(m.procs.angerManagement.periodSec, EV.RAGE_TICK);
    this.sample();
    this.act();
    for (;;) {
      const e = this.q.pop();
      if (!e || e.t >= this.T) break;
      this.advance(e.t);
      switch (e.type) {
        case EV.SWING:
          if (e.a !== 2 || e.b === this.rangedGen) this.swing(e.a);
          break;
        case EV.CAST_END:
          this.castEnd(e.a);
          break;
        case EV.TICK:
          this.tick(e.a, e.b);
          break;
        case EV.CHANNEL_TICK:
          this.channelTick(e.b);
          break;
        case EV.BUFF_EXPIRE: {
          const b = this.buffs[e.a];
          if (b && b.gen === e.b) this.removeBuff(e.a);
          break;
        }
        case EV.WAKE:
          if (e.t >= this.pendingWake - EPS) this.pendingWake = Infinity;
          break;
        case EV.RAGE_TICK: {
          const am = m.procs.angerManagement!;
          this.gain(am.amount, "Anger Management");
          this.q.push(e.t + am.periodSec, EV.RAGE_TICK);
          break;
        }
        case EV.ENERGIZE_TICK: {
          const def = m.buffs[e.a]!;
          const pe = def.periodicEnergize!;
          this.gain(pe.amount, def.name);
          if (e.b > 1) this.q.push(e.t + pe.periodSec, EV.ENERGIZE_TICK, e.a, e.b - 1);
          break;
        }
      }
      this.act();
      this.sample();
    }
    this.advance(this.T);
    this.t = this.T;
    if (this.idleSince >= 0) this.idleSec += this.T - this.idleSince;
    if (this.oomSince >= 0) this.oomSec += this.T - this.oomSince;
    for (const x of this.current.extraDps) this.deal(x.label, 1, x.dps * this.T, "hit", true);
    return { damage: this.total, idleSec: this.idleSec, oomSec: this.oomSec };
  }

  // ---- resources ----
  private regenPct(power: "mana" | "energy"): number {
    let p = 0;
    for (const b of this.buffs) if (b) p += b.def.regenPct[power] ?? 0;
    return p;
  }
  private castRegenPct(): number {
    let p = this.model.castRegenPct;
    for (const b of this.buffs) if (b) p += b.def.castRegenPct;
    return Math.min(100, p);
  }
  private manaRate(atFsr: boolean): number {
    const base = this.model.spiritRegenPerSec * (1 + this.regenPct("mana") / 100);
    return atFsr ? (base * this.castRegenPct()) / 100 : base;
  }
  private energyRate(): number {
    return ENERGY_PER_SECOND * (1 + this.regenPct("energy") / 100);
  }
  /** Continuous regeneration from the last advance to `to` (mana: five-second rule boundary inside). */
  private advance(to: number): void {
    const dt = to - this.lastAdvance;
    if (dt > 0) {
      const p = this.model.power;
      if (p === "energy") this.resource = Math.min(this.maxResource, this.resource + this.energyRate() * dt);
      else if (p === "rage" && this.current.ragePerSec > 0)
        this.resource = Math.min(this.maxResource, this.resource + this.current.ragePerSec * dt);
      else if (p === "mana" && this.resource < this.maxResource) {
        const fsrEnd = this.lastManaSpend + FIVE_SECOND_RULE_SEC;
        const from = this.lastAdvance;
        const inFsr = Math.max(0, Math.min(to, fsrEnd) - from);
        const gain = this.manaRate(true) * inFsr + this.manaRate(false) * (dt - inFsr);
        this.resource = Math.min(this.maxResource, this.resource + gain);
      }
    }
    this.lastAdvance = to;
    this.t = to;
  }
  private gain(amount: number, source: string): void {
    if (amount <= 0 || !this.model.power) return;
    this.resource = Math.min(this.maxResource, this.resource + amount);
    this.log(source, "gain", 0);
  }
  private pay(a: AbilityResult): boolean {
    const p = this.model.power;
    if (a.power !== p || a.cost <= 0) return true;
    if (p === "mana" && this.config.unlimitedMana) return true;
    if (this.resource + EPS < a.cost) return false;
    this.resource -= a.cost;
    if (p === "mana") this.lastManaSpend = this.t;
    return true;
  }
  private affordable(a: AbilityResult): boolean {
    const p = this.model.power;
    if (a.power !== p || a.cost <= 0) return true;
    if (p === "mana" && this.config.unlimitedMana) return true;
    return this.resource + EPS >= a.cost;
  }

  // ---- buffs ----
  private state(): StateEval {
    if (this.stateDirty) {
      const active: ActiveBuffKey[] = [];
      for (const b of this.buffs) if (b && b.def.stateful) active.push({ def: b.def, stacks: b.stacks });
      this.current = this.model.state(active);
      this.stateDirty = false;
    }
    return this.current;
  }
  private applyBuff(def: BuffDef, durationSec = def.durationSec, stacks = 1): void {
    const gen = ++this.buffGen;
    const expires = this.t + durationSec;
    this.buffs[def.index] = { def, expires, charges: def.charges, stacks, crits: 0, gen };
    if (Number.isFinite(expires)) this.q.push(expires, EV.BUFF_EXPIRE, def.index, gen);
    if (def.stateful) this.stateDirty = true;
    this.log(def.name, "buff", 0);
  }
  private removeBuff(index: number): void {
    const b = this.buffs[index];
    if (!b) return;
    this.buffs[index] = null;
    if (b.def.stateful) this.stateDirty = true;
    this.log(b.def.name, "fade", 0);
  }
  /** Charge buffs (Clearcasting, Presence of Mind, Cold Blood) are used by a matching cast. */
  private useCharges(a: AbilityResult): void {
    const set = this.model.prepared.book.classSet;
    for (const b of this.buffs) {
      if (!b || b.def.charges <= 0 || b.charges <= 0) continue;
      if (!b.def.masks.some((m) => familyMatches(m, a.spell, set))) continue;
      b.charges--;
      if (b.charges <= 0) this.removeBuff(b.def.index);
    }
  }

  // ---- decisions ----
  private evalFor(i: number, st: StateEval): AbilityEval {
    const e = this.model.entries[i]!.entry;
    if (e.kind !== "finisher") return st.abilities[i]!;
    return st.finisherAt(i, Math.max(1, Math.min(MAX_COMBO_POINTS, this.comboPoints)));
  }
  private castTimeOf(a: AbilityResult): number {
    if (a.key === "Shadow Bolt" && this.shadowTranceUntil > this.t) return 0;
    return a.castTime;
  }
  /** Usability of entry i now, ignoring the GCD (section 4.4 "implicit rules"). */
  private usable(i: number, st: StateEval): AbilityResult | null {
    const se = this.model.entries[i]!;
    const e = se.entry;
    if (!se.talentOk || se.skip) return null;
    const a = this.evalFor(i, st);
    if (!a.available) return null;
    if (this.cdReady[i]! > this.t + EPS) return null;
    if (a.category && (this.categoryReady.get(a.category) ?? 0) > this.t + EPS) return null;
    if (se.requires >= 0 && !this.dots[se.requires]!.active) return null;
    switch (e.kind) {
      case "nextSwing":
        if (this.queuedSwing >= 0 || !this.current.white.mainHand) return null;
        break;
      case "dot":
        if (!se.explicitAuraLeft && this.auraLeft(i) > this.castTimeOf(a) + EPS) return null;
        break;
      case "maintain":
        if (this.auraLeft(i) > EPS) return null;
        break;
      case "builder":
        if (this.comboPoints >= MAX_COMBO_POINTS) return null;
        break;
      case "finisher":
        if (this.comboPoints < (e.cp ?? MAX_COMBO_POINTS)) return null;
        if ((e.buff || a.expectedPeriodic > 0) && !se.explicitAuraLeft && this.auraLeft(i) > EPS) return null;
        break;
      case "burst":
        if (se.buff && this.buffs[se.buff.index]) return null;
        break;
      default:
        break;
    }
    if (!this.affordable(a)) return null;
    if (!conditionsHold(e, this, i)) return null;
    return a;
  }

  private act(): void {
    // Busy = a cast or channel is pending (not a time test: another event can fire at the exact cast-end time first).
    if (this.t >= this.T || this.casting || this.channel) return;
    let manaBlocked = false;
    for (let guard = 0; guard < 16; guard++) {
      const st = this.state();
      let picked = -1;
      let pickedA: AbilityResult | null = null;
      manaBlocked = false;
      for (let i = 0; i < this.n; i++) {
        const raw = this.evalFor(i, st);
        const onGcd = raw.available && raw.gcd > 0 && this.model.entries[i]!.entry.kind !== "nextSwing";
        if (onGcd && this.gcdUntil > this.t + EPS) continue;
        const a = this.usable(i, st);
        if (!a) {
          if (raw.available && this.model.power === "mana" && !this.affordable(raw)) manaBlocked = true;
          continue;
        }
        picked = i;
        pickedA = a;
        break;
      }
      if (picked < 0 || !pickedA) break;
      this.endIdle();
      this.cast(picked, pickedA);
      if (this.casting || this.channel) return;
    }
    if (this.gcdUntil <= this.t + EPS) {
      if (this.idleSince < 0) this.idleSince = this.t;
      if (manaBlocked && this.oomSince < 0) this.oomSince = this.t;
    }
    this.scheduleWake();
  }
  private endIdle(): void {
    if (this.idleSince >= 0) this.idleSec += this.t - this.idleSince;
    if (this.oomSince >= 0) this.oomSec += this.t - this.oomSince;
    this.idleSince = -1;
    this.oomSince = -1;
  }

  /** Earliest time something can become usable without another event (cooldowns, GCD, regeneration, timers). */
  private scheduleWake(): void {
    const t = this.t;
    let w = Infinity;
    const at = (x: number) => {
      if (x > t + EPS && x < w) w = x;
    };
    at(this.gcdUntil);
    const p = this.model.power;
    const rate =
      p === "energy"
        ? this.energyRate()
        : p === "mana"
          ? this.manaRate(t < this.lastManaSpend + FIVE_SECOND_RULE_SEC)
          : 0;
    if (p === "mana") at(this.lastManaSpend + FIVE_SECOND_RULE_SEC);
    let timed = false;
    for (let i = 0; i < this.n; i++) {
      const se = this.model.entries[i]!;
      at(this.cdReady[i]!);
      const a = this.evalFor(i, this.current);
      if (a.available && a.category) at(this.categoryReady.get(a.category) ?? 0);
      if (a.available && rate > 0 && a.power === p && a.cost > this.resource)
        at(t + (a.cost - this.resource) / rate);
      if (se.entry.kind === "dot" || se.entry.kind === "maintain" || se.buff) {
        const left = this.auraLeft(i);
        if (left > 0) at(t + left - (a.available && se.entry.kind === "dot" ? this.castTimeOf(a) : 0));
      }
      if (EXECUTE_ONLY.has(se.entry.ability)) at(this.T * (1 - EXECUTE_PHASE_PCT / 100) + EPS);
      for (const c of se.entry.conditions ?? []) {
        if (c.type === "targetHp") at(this.T * (1 - c.value / 100) + EPS);
        else if (c.type === "timeLeft") at(this.T - c.value + EPS);
        else if (c.type === "auraLeft" || c.type === "aura" || c.type === "cooldown") timed = true;
      }
    }
    if (timed) at(t + POLL_SEC);
    if (w < this.pendingWake && w < this.T) {
      this.pendingWake = w;
      this.q.push(w, EV.WAKE);
    }
  }

  // ---- casting ----
  private cast(i: number, a: AbilityResult): void {
    const se = this.model.entries[i]!;
    const e = se.entry;
    if (e.kind === "nextSwing") {
      this.queuedSwing = i; // cost is paid when the swing happens
      return;
    }
    const execRage = e.ability === "Execute" ? this.resource - a.cost : 0;
    this.pay(a);
    if (execRage > 0) this.resource -= execRage;
    if (a.energize > 0) this.gain(a.energize, a.key);
    if (a.cooldown > 0) this.cdReady[i] = this.t + a.cooldown;
    if (a.category && a.categoryCooldown > 0) this.categoryReady.set(a.category, this.t + a.categoryCooldown);
    if (a.gcd > 0) this.gcdUntil = this.t + a.gcd;
    this.lastCast[i] = this.t;
    const castTime = this.castTimeOf(a);
    if (a.key === "Shadow Bolt" && this.shadowTranceUntil > this.t) this.shadowTranceUntil = -1;
    this.useCharges(a);
    this.log(a.key, "cast", 0);
    if (se.buff) {
      const def = se.buff;
      const dur = e.kind === "finisher" ? a.durationSec : def.durationSec;
      this.applyBuff(def, dur, def === this.model.procs.combustion?.buff ? 0 : 1);
      if (def.energize && def.energize.power === this.model.power) this.gain(def.energize.amount, def.name);
      const pe = def.periodicEnergize;
      if (pe && pe.power === this.model.power)
        this.q.push(this.t + pe.periodSec, EV.ENERGIZE_TICK, def.index, pe.ticks);
    }
    if (castTime > EPS) {
      this.busyUntil = this.t + castTime;
      const gen = ++this.castGen;
      this.casting = { gen, entry: i, a };
      this.q.push(this.busyUntil, EV.CAST_END, gen);
      return;
    }
    if (a.channelTime > EPS) {
      this.startChannel(i, a);
      return;
    }
    this.resolve(i, a, execRage);
  }
  private castEnd(gen: number): void {
    const c = this.casting;
    if (!c || c.gen !== gen) return;
    this.casting = null;
    this.busyUntil = this.t;
    // src: Classic 1.12: a ranged cast (Aimed Shot) restarts the Auto Shot timer [VERIFY Q63]
    const ranged = this.current.white.ranged;
    if (c.a.kind === "ranged" && ranged && this.model.rotation.autoShot)
      this.q.push(this.t + ranged.speed, EV.SWING, 2, ++this.rangedGen);
    this.resolve(c.entry, c.a, 0);
  }

  private startChannel(i: number, a: AbilityResult): void {
    this.busyUntil = this.t + a.channelTime;
    const part =
      a.parts.find((p) => p.kind === "periodic") ?? a.parts.find((p) => p.count > 1) ?? a.parts[0] ?? null;
    const periodic = part?.kind === "periodic";
    const landed = part && periodic ? this.rng() * 100 < part.chances.land : true;
    if (!landed) this.miss(a.key, a.schoolMask);
    const ticks = part && part.count > 0 ? part.count : 1; // a channel without damage (Evocation) ends with one tick
    this.channel = { entry: i, a, part, landed, ticksLeft: ticks, source: a.key };
    const gen = ++this.channelGen;
    const period = a.channelTime / ticks;
    for (let k = 1; k <= ticks; k++) this.q.push(this.t + k * period, EV.CHANNEL_TICK, i, gen);
    this.count(a.key, a.schoolMask).casts++;
  }
  private channelTick(gen: number): void {
    const c = this.channel;
    if (!c || gen !== this.channelGen) return;
    c.ticksLeft--;
    if (c.ticksLeft <= 0) this.endChannel();
    const p = c.part;
    if (!p) return;
    if (p.kind === "periodic") {
      if (c.landed) {
        const crit = this.rng() * 100 < p.chances.crit;
        const dmg = p.perHit * (crit ? p.critMultiplier : 1);
        this.deal(c.source, c.a.schoolMask, dmg, crit ? "tickCrit" : "tick");
        this.afterPeriodic(c.source);
      }
    } else this.direct(c.a, p, c.source);
    if (this.channel === c && this.higherPriorityReady(c.entry)) this.endChannel(); // clip after a tick
  }
  private endChannel(): void {
    this.channel = null;
    this.channelGen++;
    this.busyUntil = this.t;
  }
  /** An entry above `entry` can be cast now (channel clipping, e.g. Mind Flay for Mind Blast). */
  private higherPriorityReady(entry: number): boolean {
    const st = this.state();
    for (let i = 0; i < entry; i++) {
      const raw = this.evalFor(i, st);
      if (!raw.available || this.model.entries[i]!.entry.kind === "nextSwing") continue;
      if (raw.gcd > 0 && this.gcdUntil > this.t + EPS) continue;
      if (this.usable(i, st)) return true;
    }
    return false;
  }

  /** Samples one direct hit of a part (two rolls: land, then crit). */
  private direct(
    a: AbilityResult,
    p: DamagePart,
    source: string,
    extraFactor = 1,
  ): { landed: boolean; crit: boolean } {
    if (this.rng() * 100 >= p.chances.land) {
      this.miss(source, a.schoolMask);
      return { landed: false, crit: false };
    }
    const crit = this.rng() * 100 < p.chances.crit;
    const base = p.range ? p.range[0] + this.rng() * (p.range[1] - p.range[0]) : p.perHit;
    const dmg = base * extraFactor * (crit ? p.critMultiplier : 1);
    const dealt = this.deal(source, a.schoolMask, dmg, crit ? "crit" : "hit");
    this.afterSpellHit(a, crit, dealt);
    if (a.kind !== "spell" && a.slot) this.weaponHit(a.slot, crit, false, false);
    return { landed: true, crit };
  }

  /** Resolves a cast's damage (instant or at cast end), combo points, DoTs and procs. */
  private resolve(i: number, a: AbilityResult, execRage: number): void {
    const se = this.model.entries[i]!;
    const e = se.entry;
    const src = a.key;
    this.count(src, a.schoolMask).casts++;
    const parts = a.parts;
    if (parts.length === 0) {
      if (e.kind === "finisher") this.spendCombo();
      return;
    }
    const execFactor =
      e.ability === "Execute" && execRage > 0
        ? 1 +
          (EXECUTE_DAMAGE_PER_RAGE * execRage) /
            Math.max(1, a.spell.effects.find((x) => x.effect === 3)?.base ?? 1)
        : 1;
    let landed = false;
    let firstCrit = false;
    let sawDirect = false;
    for (const p of parts) {
      if (p.kind !== "direct") continue;
      for (let k = 0; k < p.count; k++) {
        const r = this.direct(a, p, src, execFactor);
        if (!sawDirect) {
          landed = r.landed;
          firstCrit = r.crit;
          sawDirect = true;
        }
      }
    }
    const periodic = parts.find((p) => p.kind === "periodic");
    if (periodic) {
      if (!sawDirect) {
        landed = this.rng() * 100 < periodic.chances.land;
        if (!landed) this.miss(src, a.schoolMask);
      }
      if (landed) this.applyDot(i, a, periodic);
    }
    for (const x of a.extras) this.deal(x.label, a.schoolMask, x.value, "hit", true);
    if (e.kind === "builder" && landed && a.hitChance > 0) {
      const perHit = a.comboPoints / (a.hitChance / 100);
      let gain = Math.round(perHit);
      if (firstCrit && this.rng() * 100 < this.model.procs.sealFatePct) gain++;
      this.comboPoints = Math.min(MAX_COMBO_POINTS, this.comboPoints + gain);
    }
    if (e.kind === "finisher") this.spendCombo();
    if (a.kind === "spell" && landed) this.clearcasting(a);
  }
  private spendCombo(): void {
    this.comboPoints = 0;
    if (this.rng() * 100 < this.model.procs.ruthlessnessPct) this.comboPoints = 1;
  }
  private clearcasting(a: AbilityResult): void {
    const cc = this.model.procs.clearcasting;
    if (!cc || !cc.buff || a.expected <= 0) return;
    if (cc.schools && !cc.schools.some((s) => hasSchool(a.schoolMask, s))) return;
    if (this.rng() * 100 < cc.chance) this.applyBuff(cc.buff);
  }

  // ---- periodic damage ----
  private applyDot(i: number, a: AbilityResult, p: DamagePart): void {
    const d = this.dots[i]!;
    const period = a.periodSec > 0 ? a.periodSec : a.durationSec / Math.max(1, p.count);
    d.active = true;
    d.gen++;
    d.ticksLeft = p.count;
    d.periodSec = period;
    d.perTick = p.perHit;
    d.crit = p.chances.crit;
    d.critMult = p.critMultiplier;
    d.schoolMask = a.schoolMask;
    d.source = a.key;
    d.expires = this.t + period * p.count;
    this.q.push(this.t + period, EV.TICK, i, d.gen);
  }
  private tick(slot: number, gen: number): void {
    const d = this.dots[slot]!;
    if (!d.active || d.gen !== gen) return;
    d.ticksLeft--;
    if (slot === this.igniteSlot) {
      const dmg = d.pool / Math.max(1, d.ticksLeft + 1);
      d.pool -= dmg;
      this.deal("Ignite", 4, dmg, "tick");
    } else if (slot === this.deepWoundsSlot) {
      this.deal("Deep Wounds", 1, d.perTick, "tick");
    } else {
      const crit = this.rng() * 100 < d.crit;
      this.deal(d.source, d.schoolMask, d.perTick * (crit ? d.critMult : 1), crit ? "tickCrit" : "tick");
      this.afterPeriodic(d.source);
    }
    if (d.ticksLeft > 0) this.q.push(this.t + d.periodSec, EV.TICK, slot, gen);
    else d.active = false;
  }
  private afterPeriodic(source: string): void {
    const pr = this.model.procs;
    if (pr.nightfallPct > 0 && pr.nightfallSpells.has(source) && this.rng() * 100 < pr.nightfallPct) {
      this.shadowTranceUntil = this.t + SHADOW_TRANCE_SEC;
      this.log("Shadow Trance", "buff", 0);
    }
  }
  /** Rolling Ignite: the unticked damage plus the new burn, over two fresh ticks. */
  private ignite(amount: number): void {
    const d = this.dots[this.igniteSlot]!;
    if (!d.active) d.pool = 0;
    d.pool += amount;
    d.active = true;
    d.gen++;
    d.periodSec = IGNITE.periodSec;
    d.ticksLeft = Math.round(IGNITE.durationSec / IGNITE.periodSec);
    d.expires = this.t + IGNITE.durationSec;
    this.q.push(this.t + d.periodSec, EV.TICK, this.igniteSlot, d.gen);
  }
  private deepWounds(): void {
    const pct = this.model.procs.deepWoundsPct;
    const st = this.state();
    const w = weaponInfo(st.ctx, "mainHand");
    if (!w || pct <= 0) return;
    // same total as the Phase 4 handler: x% of the average main-hand swing, physical damage-done auras
    const physical = st.ctx.stats.damageDone
      .filter((e) => !e.schools || e.schools.includes("physical"))
      .filter((e) => !e.slots || e.slots.includes("mainHand"))
      .reduce((a, e) => a * (1 + e.value / 100), 1);
    const d = this.dots[this.deepWoundsSlot]!;
    const ticks = Math.round(DEEP_WOUNDS.durationSec / DEEP_WOUNDS.periodSec);
    d.active = true;
    d.gen++;
    d.ticksLeft = ticks;
    d.periodSec = DEEP_WOUNDS.periodSec;
    d.perTick = ((pct / 100) * w.perSwing * physical) / ticks;
    d.expires = this.t + DEEP_WOUNDS.durationSec;
    this.q.push(this.t + d.periodSec, EV.TICK, this.deepWoundsSlot, d.gen);
  }

  // ---- procs of landed hits ----
  private afterSpellHit(a: AbilityResult, crit: boolean, dealt: number): void {
    const pr = this.model.procs;
    if (a.kind !== "spell") return;
    const fire = hasSchool(a.schoolMask, "fire");
    if (crit && fire && pr.ignitePct > 0) this.ignite((dealt * pr.ignitePct) / 100);
    if (crit && a.key === "Shadow Bolt" && pr.isbPct > 0) {
      this.isbUntil = this.t + IMPROVED_SHADOW_BOLT_SEC;
      this.log("Improved Shadow Bolt", "buff", 0);
    }
    const comb = pr.combustion?.buff;
    if (fire && comb) {
      const b = this.buffs[comb.index];
      if (b) {
        if (crit && ++b.crits >= COMBUSTION_CRITS) this.removeBuff(comb.index);
        else if (b.stacks < comb.maxStacks) {
          b.stacks++;
          this.stateDirty = true;
        }
      }
    }
  }
  /** Melee weapon hit procs (white swings and melee abilities). `extra`: Windfury/extra attacks cannot chain. */
  private weaponHit(slot: AttackSlot, crit: boolean, white: boolean, extra: boolean): void {
    const pr = this.model.procs;
    if (slot === "ranged") return;
    if (crit && pr.flurryPct > 0) this.flurryCharges = FLURRY_SWINGS;
    if (crit && pr.deepWoundsPct > 0) this.deepWounds();
    if (pr.unbridledWrathPct > 0 && this.rng() * 100 < pr.unbridledWrathPct) this.gain(1, "Unbridled Wrath");
    if (slot !== "mainHand" || extra) return;
    const st = this.state();
    if (pr.extraAttackPct > 0 && this.rng() * 100 < pr.extraAttackPct) this.whiteSwing(0, st, true, false);
    if (!white) return;
    if (st.windfury && this.rng() * 100 < WINDFURY.chance)
      for (let k = 0; k < WINDFURY.attacks; k++) this.whiteSwing(0, st, true, true);
    if (st.sealOfCommand) {
      const speed = st.ctx.stats.weapons.mainHand?.speed ?? 0;
      if (this.rng() * 60 < SEAL_OF_COMMAND_PPM * speed) {
        const soc = st.sealOfCommand;
        this.count(soc.key, soc.schoolMask).casts++;
        for (const p of soc.parts) if (p.kind === "direct") this.direct(soc, p, soc.key);
      }
    }
  }

  // ---- white attacks ----
  private swing(slotIndex: number): void {
    const st = this.state();
    const slot = SLOTS[slotIndex]!;
    const w = st.white[slot];
    if (!w) return;
    if (slot === "ranged" && this.busyUntil > this.t + EPS) {
      this.q.push(this.busyUntil, EV.SWING, slotIndex, this.rangedGen); // Auto Shot waits for the cast to finish
      return;
    }
    let done = false;
    if (slot === "mainHand" && this.queuedSwing >= 0) {
      const i = this.queuedSwing;
      this.queuedSwing = -1;
      const a = st.abilities[i]!;
      if (a.available && this.affordable(a) && conditionsHold(this.model.entries[i]!.entry, this, i)) {
        this.pay(a);
        this.cdReady[i] = this.t + a.cooldown;
        this.resolve(i, a, 0);
        done = true;
      }
    }
    if (!done) this.whiteSwing(slotIndex, st, false, false);
    let speed = w.speed;
    if (slot !== "ranged" && this.flurryCharges > 0) {
      speed /= 1 + this.model.procs.flurryPct / 100;
      this.flurryCharges--;
    }
    this.q.push(this.t + speed, EV.SWING, slotIndex, slot === "ranged" ? this.rangedGen : 0);
  }
  /** One white attack from the single-roll table; extra attacks (Windfury, sword talents) use `extra`. */
  private whiteSwing(slotIndex: number, st: StateEval, extra: boolean, windfury: boolean): void {
    const slot = SLOTS[slotIndex]!;
    const w: WhiteResult | null = windfury ? st.windfury : st.white[slot];
    if (!w) return;
    const source = windfury ? "Windfury Weapon" : extra ? `${w.name} (extra)` : w.name;
    const acc = this.count(source, 1);
    acc.casts++;
    const r = this.rng() * 100;
    const miss = 100 - w.hitChance;
    if (r < miss) {
      this.miss(source, 1);
      return;
    }
    const spread = windfury ? 0 : st.whiteSpread[slot];
    const base = w.normalHit + (spread > 0 ? (this.rng() * 2 - 1) * spread : 0);
    let dmg = base;
    let outcome: "hit" | "crit" | "glance" = "hit";
    if (r < miss + w.glancing) {
      dmg = base * w.glancingMultiplier;
      outcome = "glance";
    } else if (r < miss + w.glancing + w.critChance) {
      dmg = base * 2; // PHYSICAL_CRIT_BONUS 1.0 (whiteTable with critDamageMult 1)
      outcome = "crit";
    }
    const dealt = this.deal(source, 1, dmg, outcome);
    if (this.model.power === "rage" && slot !== "ranged")
      this.gain((RAGE_PER_DAMAGE_FACTOR * dealt) / rageConversion(this.model.level), "");
    this.weaponHit(slot, outcome === "crit", true, extra);
  }

  // ---- bookkeeping ----
  private targetMult(mask: number): number {
    return this.isbUntil > this.t && hasSchool(mask, "shadow") ? 1 + this.model.procs.isbPct / 100 : 1;
  }
  private count(source: string, mask: number): SourceAcc {
    let a = this.acc.get(source);
    if (!a) {
      a = {
        school: primarySchool(mask),
        damage: 0,
        casts: 0,
        hits: 0,
        crits: 0,
        misses: 0,
        ticks: 0,
        averaged: false,
      };
      this.acc.set(source, a);
    }
    return a;
  }
  private deal(
    source: string,
    mask: number,
    raw: number,
    outcome: SimLogLine["outcome"],
    averaged = false,
  ): number {
    const dmg = averaged ? raw : raw * this.targetMult(mask);
    const a = this.count(source, mask);
    a.damage += dmg;
    if (averaged) a.averaged = true;
    else if (outcome === "tick" || outcome === "tickCrit") a.ticks++;
    else a.hits++;
    if (outcome === "crit" || outcome === "tickCrit") a.crits++;
    this.total += dmg;
    this.log(source, outcome, dmg);
    return dmg;
  }
  private miss(source: string, mask: number): void {
    this.count(source, mask).misses++;
    this.log(source, "miss", 0);
  }
  private log(source: string, outcome: SimLogLine["outcome"], damage: number): void {
    const tr = this.trace;
    if (!tr || tr.log.length >= tr.logLimit || source === "") return;
    tr.log.push({
      t: Math.round(this.t * 1000) / 1000,
      source,
      outcome,
      damage: Math.round(damage),
      resource: this.model.power ? Math.round(this.resource) : null,
    });
  }
  private sample(): void {
    const tr = this.trace;
    if (!tr || !this.model.power || this.t - this.lastSample < TIMELINE_STEP_SEC) return;
    this.lastSample = this.t;
    tr.timeline.push([Math.round(this.t * 100) / 100, Math.round(this.resource * 10) / 10]);
  }
}
```

### 4.6 Runner, worker, index (exact)

`src/engine/sim/run.ts` (exact):

```ts
import { Fight, type Accumulator, type FightTrace } from "./engine";
import { buildModel } from "./model";
import { createRng, iterationSeed } from "./rng";
import type { SimConfig, SimInput, SimResult, SimSource, Summary } from "./types";

const Z95 = 1.96;

/** Mean, sample standard deviation, 95% confidence interval of the mean, min and max. */
export function summarize(values: ArrayLike<number>): Summary {
  const n = values.length;
  if (n === 0) return { mean: 0, stdev: 0, ci95: [0, 0], min: 0, max: 0 };
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (values[i]! - mean) ** 2;
  const stdev = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;
  const half = (Z95 * stdev) / Math.sqrt(n);
  return { mean, stdev, ci95: [mean - half, mean + half], min, max };
}

export interface RunOptions {
  onProgress?(done: number, total: number): void;
  progressEvery?: number; // iterations between progress callbacks (default 50)
}

/**
 * Runs `config.iterations` fights (section 4.6). Iteration i uses its own seeded stream, so the result is identical for
 * the same input, config and seed, whatever the batching.
 */
export function runSim(input: SimInput, config: SimConfig, opts: RunOptions = {}): SimResult {
  const t0 = globalThis.performance.now();
  const model = buildModel(input);
  const n = Math.max(1, Math.floor(config.iterations));
  const acc: Accumulator = new Map();
  const dps = new Float64Array(n);
  const trace: FightTrace = { log: [], logLimit: config.logLimit, timeline: [] };
  let idle = 0;
  let oom = 0;
  const every = opts.progressEvery ?? 50;
  for (let i = 0; i < n; i++) {
    const fight = new Fight(
      model,
      config,
      createRng(iterationSeed(config.seed, i)),
      acc,
      i === 0 ? trace : null,
    );
    const r = fight.run();
    dps[i] = r.damage / config.fightSec;
    idle += r.idleSec;
    oom += r.oomSec;
    if (opts.onProgress && ((i + 1) % every === 0 || i + 1 === n)) opts.onProgress(i + 1, n);
  }
  const total = [...acc.values()].reduce((a, s) => a + s.damage, 0);
  const sources: SimSource[] = [...acc.entries()]
    .map(([key, s]) => ({
      key,
      school: s.school,
      damage: s.damage / n,
      dps: s.damage / n / config.fightSec,
      share: total > 0 ? (s.damage / total) * 100 : 0,
      casts: s.casts / n,
      hits: s.hits / n,
      crits: s.crits / n,
      misses: s.misses / n,
      ticks: s.ticks / n,
      averaged: s.averaged,
    }))
    .filter((s) => s.damage > 0 || s.casts > 0)
    .sort((a, b) => b.damage - a.damage || a.key.localeCompare(b.key));
  const power = model.power;
  return {
    config,
    rotationLabel: input.rotation.label,
    power,
    dps: summarize(dps),
    sources,
    idleSec: idle / n,
    oomSec: oom / n,
    timeline:
      power && trace.timeline.length
        ? {
            max: power === "mana" ? model.maxMana : Math.max(100, ...trace.timeline.map((p) => p[1])),
            points: trace.timeline,
          }
        : null,
    log: trace.log,
    averaged: model.averaged,
    modeled: model.modeled,
    elapsedMs: globalThis.performance.now() - t0,
  };
}
```

`src/engine/sim/worker.ts` (exact):

```ts
// Web Worker entry (section 4.7): plain postMessage, no library. One request at a time; the client cancels a run by
// terminating the worker.
import { runSim } from "./run";
import type { SimRequest, SimResponse } from "./types";

const port = self as unknown as {
  postMessage(message: SimResponse): void;
  onmessage: ((e: MessageEvent<SimRequest>) => void) | null;
};

port.onmessage = (e) => {
  const req = e.data;
  if (req.type !== "run") return;
  try {
    const result = runSim(req.input, req.config, {
      onProgress: (done, total) => port.postMessage({ type: "progress", id: req.id, done, total }),
    });
    port.postMessage({ type: "result", id: req.id, result });
  } catch (err) {
    port.postMessage({
      type: "error",
      id: req.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
```

`src/engine/sim/index.ts` (exact):

```ts
export * from "./types";
export * from "./rng";
export * from "./queue";
export * from "./model";
export * from "./engine";
export * from "./run";
```

---

## 5. State (task T7)

### 5.1 Rotation store and URL mapping: `src/state/rotation.ts` (exact)

`ENTRY_KINDS` and `PROC_AURAS` are part of the URL format: **append only**. The custom rotation is cleared when a
class is selected or cleared; sim settings persist.

`src/state/rotation.ts` (exact):

```ts
import { create } from "zustand";
import { rotationsFile } from "@/data";
import type {
  ClassSpellFile,
  ClassToken,
  RotationCondition,
  RotationEntry,
  RotationEntryKind,
  SpecRotation,
} from "@/data/types";
import { CONDITION_TYPES, abilityCatalog, type CatalogAbility } from "@/engine/rotation";
import { SIM_LIMITS } from "@/engine/sim/types";
import type { ClassTree } from "@/engine/talents";
import {
  DEFAULT_SIM_CODE,
  type CharacterCode,
  type ConditionCode,
  type EntryCode,
  type RotationCode,
  type SimCode,
} from "./charCode";

/** APPEND ONLY: entry kinds by URL index. */
export const ENTRY_KINDS: readonly RotationEntryKind[] = [
  "cooldown",
  "dot",
  "maintain",
  "filler",
  "builder",
  "finisher",
  "nextSwing",
  "burst",
];
/** APPEND ONLY: aura names that are not abilities (simulator procs), by URL index. */
export const PROC_AURAS: readonly string[] = [
  "Clearcasting",
  "Flurry",
  "Shadow Trance",
  "Improved Shadow Bolt",
  "Ignite",
  "Deep Wounds",
];

export const specRotation = (token: ClassToken, spec: number): SpecRotation | undefined =>
  rotationsFile.rotations.find((r) => r.class === token && r.spec === spec);

const catalogs = new WeakMap<ClassSpellFile, CatalogAbility[]>();
/** The editor's ability list of the loaded class (memoized per spell file). */
export function catalogFor(spells: ClassSpellFile, tree: ClassTree): CatalogAbility[] {
  let c = catalogs.get(spells);
  if (!c) {
    const talents = tree.order.map((id) => tree.nodes.get(id)!.talent);
    c = abilityCatalog(spells, talents, rotationsFile, tree.token);
    catalogs.set(spells, c);
  }
  return c;
}

/** Ref key of an aura/cooldown condition: ability id x 2, or proc index x 2 + 1 (section 5.2). */
function refKey(name: string, catalog: readonly CatalogAbility[]): number | null {
  const a = catalog.find((x) => x.name === name);
  if (a) return a.id * 2;
  const i = PROC_AURAS.indexOf(name);
  return i >= 0 ? i * 2 + 1 : null;
}
function refName(key: number, catalog: readonly CatalogAbility[]): string | null {
  if (key % 2 === 1) return PROC_AURAS[(key - 1) / 2] ?? null;
  return catalog.find((x) => x.id === key / 2)?.name ?? null;
}

function conditionToCode(c: RotationCondition, catalog: readonly CatalogAbility[]): ConditionCode | null {
  const type = CONDITION_TYPES.findIndex((t) => t.type === c.type);
  if (c.type === "aura" || c.type === "cooldown") {
    const key = refKey(c.ref, catalog);
    return key === null ? null : { type, flag: c.type === "aura" ? c.active : c.ready, value: key };
  }
  return { type, flag: c.cmp === "gte", value: c.value };
}
function codeToCondition(c: ConditionCode, catalog: readonly CatalogAbility[]): RotationCondition | null {
  const t = CONDITION_TYPES[c.type];
  if (!t) return null;
  if (t.type === "aura" || t.type === "cooldown") {
    const ref = refName(c.value, catalog);
    if (!ref) return null;
    return t.type === "aura"
      ? { type: "aura", ref, active: c.flag }
      : { type: "cooldown", ref, ready: c.flag };
  }
  return { type: t.type, cmp: c.flag ? "gte" : "lt", value: Math.min(t.max, c.value) };
}

/** URL record of an entry (null when its ability is not in the catalog). Conditions with unknown refs are dropped. */
export function entryToCode(e: RotationEntry, catalog: readonly CatalogAbility[]): EntryCode | null {
  const a = catalog.find((x) => x.name === e.ability);
  if (!a) return null;
  return {
    ability: a.id,
    kind: ENTRY_KINDS.indexOf(e.kind),
    off: e.off === true,
    cp: e.cp ?? 0,
    everySec: e.everySec ?? 0,
    conditions: (e.conditions ?? []).flatMap((c) => {
      const x = conditionToCode(c, catalog);
      return x ? [x] : [];
    }),
  };
}
/** Entry of a URL record; `buff`, `requires` and `requiresTalent` come from the catalog's default entry. */
export function codeToEntry(c: EntryCode, catalog: readonly CatalogAbility[]): RotationEntry | null {
  const a = catalog.find((x) => x.id === c.ability);
  const kind = ENTRY_KINDS[c.kind];
  if (!a || !kind) return null;
  const conditions = c.conditions.map((x) => codeToCondition(x, catalog));
  if (conditions.some((x) => x === null)) return null;
  const e: RotationEntry = { ability: a.name, kind };
  const d = a.entry;
  if (d.buff) e.buff = true;
  if (d.requires) e.requires = d.requires;
  if (d.requiresTalent) e.requiresTalent = d.requiresTalent;
  if (c.cp) e.cp = Math.min(5, Math.max(1, c.cp));
  if (c.everySec) e.everySec = Math.min(600, c.everySec);
  if (conditions.length) e.conditions = conditions as RotationCondition[];
  if (c.off) e.off = true;
  return e;
}

const sameEntries = (a: readonly RotationEntry[], b: readonly RotationEntry[]) =>
  JSON.stringify(a) === JSON.stringify(b);

export function rotationToCode(r: SpecRotation, catalog: readonly CatalogAbility[]): RotationCode {
  const def = specRotation(r.class, r.spec);
  if (def && sameEntries(r.entries, def.entries)) return { spec: r.spec, entries: null };
  return {
    spec: r.spec,
    entries: r.entries.flatMap((e) => {
      const x = entryToCode(e, catalog);
      return x ? [x] : [];
    }),
  };
}
export function codeToRotation(
  code: RotationCode,
  token: ClassToken,
  catalog: readonly CatalogAbility[],
): { rotation: SpecRotation; dropped: boolean } | null {
  const def = specRotation(token, code.spec);
  if (!def) return null;
  if (code.entries === null) return { rotation: structuredClone(def), dropped: false };
  const entries = code.entries.map((e) => codeToEntry(e, catalog));
  const kept = entries.filter((e): e is RotationEntry => e !== null);
  return { rotation: { ...structuredClone(def), entries: kept }, dropped: kept.length !== entries.length };
}

export function clampSim(s: SimCode): SimCode {
  const clamp = (v: number, [lo, hi]: readonly [number, number]) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo;
  return {
    fightSec: clamp(s.fightSec, SIM_LIMITS.fightSec),
    iterations: clamp(s.iterations, SIM_LIMITS.iterations),
    seed: clamp(s.seed, SIM_LIMITS.seed),
    unlimitedMana: s.unlimitedMana,
  };
}

export interface RotationState {
  custom: SpecRotation | null; // null: the default rotation of the spec with the most points
  sim: SimCode;
  setRotation(r: SpecRotation): void;
  reset(): void;
  setSim(patch: Partial<SimCode>): void;
  clear(): void;
  toCode(catalog: readonly CatalogAbility[]): Pick<CharacterCode, "rotation" | "sim">;
  /** false if something in the link was dropped. */
  applyCode(code: CharacterCode, token: ClassToken, catalog: readonly CatalogAbility[]): boolean;
}

export const useRotation = create<RotationState>()((set, get) => ({
  custom: null,
  sim: DEFAULT_SIM_CODE,
  setRotation(r) {
    set({ custom: r });
  },
  reset() {
    set({ custom: null });
  },
  setSim(patch) {
    set({ sim: clampSim({ ...get().sim, ...patch }) });
  },
  clear() {
    set({ custom: null });
  },
  toCode(catalog) {
    const s = get();
    return {
      ...(s.custom ? { rotation: rotationToCode(s.custom, catalog) } : {}),
      ...(JSON.stringify(s.sim) !== JSON.stringify(DEFAULT_SIM_CODE) ? { sim: s.sim } : {}),
    };
  },
  applyCode(code, token, catalog) {
    const sim = code.sim ? clampSim(code.sim) : DEFAULT_SIM_CODE;
    const r = code.rotation ? codeToRotation(code.rotation, token, catalog) : null;
    set({ custom: r ? r.rotation : null, sim });
    return (
      (!code.rotation || (r !== null && !r.dropped)) &&
      JSON.stringify(sim) === JSON.stringify(code.sim ?? sim)
    );
  },
}));
```

### 5.2 URL format: tags 6 and 7 (`src/state/charCode.ts` diff)

Both records live in the v2 character payload (`#v2.<class>.<level>.<perk>.<talents>.<charPayload>`), after tag 5,
tags ascending, all values unsigned LEB128 varints:

```
tag 6 rotation   body = spec (0..2) [entry ...]                       spec alone: the spec's default entries
                 entry = abilityId, head, [cp], [everySec x 10], [n, (type x 2 + flag, operand) x n]
                 head  = kindIndex + 16 (off) + 32 (cp present) + 64 (everySec present) + 128 (conditions present)
                 flag  = 1 for cmp "gte" (value types) or active/ready (ref types)
                 operand = round(value x 10) for value types (resource, comboPoints, targetHp, timeLeft, auraLeft);
                           ref key for aura/cooldown: abilityId x 2, or PROC_AURAS index x 2 + 1
                 an explicit empty list is written as spec, 0
tag 7 sim        body = fightSec, iterations, seed, unlimitedMana (0/1); omitted when 180, 1000, 1, 1
```

The record is written only when the user changed the rotation (any edit or a "Based on" choice). Decoding rejects (the
whole link, reason `character`) a spec > 2, an entry without a head, a condition list of length 0 and a tag 7 with a
wrong length; ability ids that are not in the class catalog are dropped with the notice "Some rotation settings in this
link were not valid and were removed."

`src/state/charCode.ts` (diff):

```diff
diff --git a/src/state/charCode.ts b/src/state/charCode.ts
index 50c89e7..2b04bdd 100644
--- a/src/state/charCode.ts
+++ b/src/state/charCode.ts
@@ -1,4 +1,10 @@
 import type { TargetPresetId } from "@/data/types";
+import { CONDITION_TYPES } from "@/engine/rotation/conditions";
+
+/** Condition type indices whose operand is a number (stored in tenths); the others carry a ref key. */
+const VALUE_CONDITION_TYPES: ReadonlySet<number> = new Set(
+  CONDITION_TYPES.flatMap((c, i) => (c.operand === "value" ? [i] : [])),
+);
 
 /** Bonus-stat fields in URL order. APPEND ONLY: the index is part of the URL format. */
 export const BONUS_KEYS = [
@@ -40,15 +46,49 @@ export interface CustomTarget {
   armor: number;
   resist: [number, number, number, number, number, number]; // holy, fire, nature, frost, shadow, arcane
 }
+/** Phase 5 condition record: `flag` is cmp "gte" (value types) or active/ready (ref types). */
+export interface ConditionCode {
+  type: number; // CONDITION_TYPES index (src/engine/rotation/conditions.ts, append only)
+  flag: boolean;
+  value: number; // value types: display units, one decimal; ref types: ref key (section 5.2)
+}
+export interface EntryCode {
+  ability: number; // CatalogAbility.id
+  kind: number; // ENTRY_KINDS index (src/state/rotation.ts, append only)
+  off: boolean;
+  cp: number; // 0 = absent
+  everySec: number; // 0 = absent; one decimal
+  conditions: ConditionCode[];
+}
+/** Phase 5: the rotation record (tag 6). `entries` null = the spec's default entries. */
+export interface RotationCode {
+  spec: number; // base rotation: talent tab 0..2
+  entries: EntryCode[] | null;
+}
+/** Phase 5: simulation settings (tag 7), omitted when they are the defaults. */
+export interface SimCode {
+  fightSec: number;
+  iterations: number;
+  seed: number;
+  unlimitedMana: boolean;
+}
 export interface CharacterCode {
   raceId: number | null; // null = the class's default race
   weapons: { mainHand: number; offHand: number; ranged: number; ammo: number }; // item ids, 0 = empty
   bonus: Partial<Record<BonusKey, number>>; // display units (percent points for % fields); zeros omitted
   buffCodes: number[]; // buffs.json codes, ascending
   target: { preset: TargetPresetId; custom?: CustomTarget }; // custom only with preset "custom"
+  rotation?: RotationCode; // Phase 5; absent = default rotation (spec with the most points)
+  sim?: SimCode; // Phase 5; absent = DEFAULT_SIM_CODE
 }
 
-export const TAG = { race: 1, weapons: 2, bonus: 3, buffs: 4, target: 5 } as const;
+export const TAG = { race: 1, weapons: 2, bonus: 3, buffs: 4, target: 5, rotation: 6, sim: 7 } as const;
+export const DEFAULT_SIM_CODE: SimCode = { fightSec: 180, iterations: 1000, seed: 1, unlimitedMana: true };
+/** Entry head bits above the kind (kind < 16). */
+const ENTRY_OFF = 16;
+const ENTRY_CP = 32;
+const ENTRY_EVERY = 64;
+const ENTRY_CONDITIONS = 128;
 
 export const DEFAULT_CHARACTER: CharacterCode = {
   raceId: null,
@@ -131,9 +171,86 @@ export function encodeCharacterBytes(c: CharacterCode): number[] {
     }
   }
   record(TAG.target, target);
+  if (c.rotation) record(TAG.rotation, encodeRotation(c.rotation));
+  const s = c.sim;
+  if (s && JSON.stringify(s) !== JSON.stringify(DEFAULT_SIM_CODE))
+    record(TAG.sim, [s.fightSec, s.iterations, s.seed, s.unlimitedMana ? 1 : 0].flatMap(varint));
+  return out;
+}
+
+const varint = (v: number) => {
+  const b: number[] = [];
+  writeVarint(b, v);
+  return b;
+};
+const tenths = (v: number) => Math.max(0, Math.round(v * 10));
+
+function encodeRotation(r: RotationCode): number[] {
+  const out: number[] = [];
+  writeVarint(out, r.spec);
+  for (const e of r.entries ?? []) {
+    writeVarint(out, e.ability);
+    const head =
+      e.kind +
+      (e.off ? ENTRY_OFF : 0) +
+      (e.cp ? ENTRY_CP : 0) +
+      (e.everySec ? ENTRY_EVERY : 0) +
+      (e.conditions.length ? ENTRY_CONDITIONS : 0);
+    writeVarint(out, head);
+    if (e.cp) writeVarint(out, e.cp);
+    if (e.everySec) writeVarint(out, tenths(e.everySec));
+    if (e.conditions.length) {
+      writeVarint(out, e.conditions.length);
+      for (const c of e.conditions) {
+        writeVarint(out, c.type * 2 + (c.flag ? 1 : 0));
+        writeVarint(out, VALUE_CONDITION_TYPES.has(c.type) ? tenths(c.value) : c.value);
+      }
+    }
+  }
+  if (r.entries && r.entries.length === 0) writeVarint(out, 0); // an explicit empty list: ability id 0
   return out;
 }
 
+/** `v` = the record's varints; null when malformed. Value-type condition values are stored in tenths. */
+function decodeRotation(v: number[], valueType: (type: number) => boolean): RotationCode | null {
+  const spec = v[0];
+  if (spec === undefined || spec > 2) return null;
+  if (v.length === 1) return { spec, entries: null };
+  if (v.length === 2 && v[1] === 0) return { spec, entries: [] };
+  const entries: EntryCode[] = [];
+  let i = 1;
+  const next = () => (i < v.length ? v[i++]! : null);
+  while (i < v.length) {
+    const ability = next();
+    const head = next();
+    if (ability === null || head === null || ability === 0) return null;
+    const e: EntryCode = {
+      ability,
+      kind: head % ENTRY_OFF,
+      off: (head & ENTRY_OFF) !== 0,
+      cp: 0,
+      everySec: 0,
+      conditions: [],
+    };
+    if (head & ENTRY_CP) e.cp = next() ?? -1;
+    if (head & ENTRY_EVERY) e.everySec = (next() ?? -1) / 10;
+    if (head & ENTRY_CONDITIONS) {
+      const n = next() ?? 0;
+      for (let k = 0; k < n; k++) {
+        const t = next();
+        const value = next();
+        if (t === null || value === null) return null;
+        const type = Math.floor(t / 2);
+        e.conditions.push({ type, flag: t % 2 === 1, value: valueType(type) ? value / 10 : value });
+      }
+      if (n === 0) return null;
+    }
+    if (e.cp < 0 || e.everySec < 0) return null;
+    entries.push(e);
+  }
+  return { spec, entries };
+}
+
 /** null when the payload is malformed. Unknown tags are skipped (forward compatibility). */
 export function decodeCharacterBytes(bytes: Uint8Array): CharacterCode | null {
   const c: CharacterCode = structuredClone(DEFAULT_CHARACTER);
@@ -186,6 +303,16 @@ export function decodeCharacterBytes(bytes: Uint8Array): CharacterCode | null {
         }
         break;
       }
+      case TAG.rotation: {
+        const r = decodeRotation(v, (type) => VALUE_CONDITION_TYPES.has(type));
+        if (!r) return null;
+        c.rotation = r;
+        break;
+      }
+      case TAG.sim:
+        if (v.length !== 4 || v[3]! > 1) return null;
+        c.sim = { fightSec: v[0]!, iterations: v[1]!, seed: v[2]!, unlimitedMana: v[3] === 1 };
+        break;
       default:
         break; // unknown tag from a newer version: ignore
     }
```

### 5.3 `derive`, `simInputFor`, stores, URL sync (diffs)

`derive(calc, ch, custom)` uses the editor's rotation when it belongs to the class (else the Phase 4 pick), always
through `enabledRotation`. `simInputFor` builds the `SimInput` from exactly the same inputs.

`src/state/derived.ts` (diff):

```diff
diff --git a/src/state/derived.ts b/src/state/derived.ts
index d4f1051..c244e21 100644
--- a/src/state/derived.ts
+++ b/src/state/derived.ts
@@ -2,7 +2,14 @@ import { baseStatsFile, buffsFile, getRace, racialsFile, rotationsFile, targetsF
 import type { ClassSpellFile, MagicSchool, SpecRotation, TargetPresetId } from "@/data/types";
 import { pointsBySpec, type ClassTree, type Ranks } from "@/engine/talents";
 import { SPECIAL_HANDLERS, type ActiveHandler } from "@/engine/talents/special";
-import { evaluateDamage, pickRotation, prepareDamage, type DamageResult } from "@/engine/rotation";
+import {
+  enabledRotation,
+  evaluateDamage,
+  pickRotation,
+  prepareDamage,
+  type DamageResult,
+} from "@/engine/rotation";
+import type { SimInput } from "@/engine/sim/types";
 import {
   UnsupportedLevelError,
   assemble,
@@ -40,13 +47,15 @@ export type Derived =
     }
   | { ok: false; reason: "noClass" | "level" };
 
-/** Pure: everything the stats and damage UI shows, from the two stores. */
-export function derive(
-  calc: { tree: ClassTree | null; ranks: Ranks; level: number; spells: ClassSpellFile | null },
-  ch: Pick<CharacterState, "raceId" | "weaponIds" | "bonus" | "buffIds" | "target" | "custom" | "weapons">,
-): Derived {
+type CalcInput = { tree: ClassTree | null; ranks: Ranks; level: number; spells: ClassSpellFile | null };
+type CharInput = Pick<
+  CharacterState,
+  "raceId" | "weaponIds" | "bonus" | "buffIds" | "target" | "custom" | "weapons"
+>;
+
+/** Phase 5: the inputs derive and simInputFor share (weapons, talents, assemble arguments, rotation, custom target). */
+function inputsOf(calc: CalcInput & { tree: ClassTree }, ch: CharInput, custom: SpecRotation | null) {
   const tree = calc.tree;
-  if (!tree || ch.raceId === 0) return { ok: false, reason: "noClass" };
   const byId = (id: number) =>
     id && ch.weapons ? (ch.weapons.weapons.find((w) => w.id === id) ?? null) : null;
   const weapons: EquippedWeapons = {
@@ -74,7 +83,28 @@ export function derive(
     weapons,
     bonus: ch.bonus,
   };
-  const rotation = pickRotation(rotationsFile, tree.token, pointsBySpec(tree, calc.ranks));
+  // The editor's rotation (Phase 5) when it belongs to this class, else the spec with the most points.
+  const chosen =
+    custom && custom.class === tree.token
+      ? custom
+      : pickRotation(rotationsFile, tree.token, pointsBySpec(tree, calc.ranks));
+  const resist = Object.fromEntries(RESIST_ORDER.map((s, i) => [s, ch.custom.resist[i]!])) as Record<
+    MagicSchool,
+    number
+  >;
+  const customTarget = { level: ch.custom.level, armor: ch.custom.armor, resist };
+  return { weapons, talents, classTalents, args, rotation: enabledRotation(chosen), customTarget };
+}
+
+/** Pure: everything the stats and damage UI shows, from the stores (`custom`: the rotation editor's rotation). */
+export function derive(calc: CalcInput, ch: CharInput, custom: SpecRotation | null = null): Derived {
+  const tree = calc.tree;
+  if (!tree || ch.raceId === 0) return { ok: false, reason: "noClass" };
+  const { weapons, talents, classTalents, args, rotation, customTarget } = inputsOf(
+    { ...calc, tree },
+    ch,
+    custom,
+  );
   let a: Assembled;
   let stats: CharacterStats;
   let prepared: ReturnType<typeof prepareDamage> | null = null;
@@ -98,15 +128,10 @@ export function derive(
     throw e;
   }
   const dw = weapons.offHand !== null;
-  const resist = Object.fromEntries(RESIST_ORDER.map((s, i) => [s, ch.custom.resist[i]!])) as Record<
-    MagicSchool,
-    number
-  >;
-  const custom = { level: ch.custom.level, armor: ch.custom.armor, resist };
   const at = (p: TargetPresetId) =>
     evaluateTarget(
       stats,
-      presetTarget(targetsFile, p, calc.level, a.debuffs, custom),
+      presetTarget(targetsFile, p, calc.level, a.debuffs, customTarget),
       targetsFile.armorFormula,
       dw,
     );
@@ -148,6 +173,30 @@ export function derive(
   };
 }
 
+/** Phase 5: the simulator's input for the current state (null until the class spells are loaded). */
+export function simInputFor(calc: CalcInput, ch: CharInput, custom: SpecRotation | null): SimInput | null {
+  const tree = calc.tree;
+  if (!tree || !calc.spells || ch.raceId === 0) return null;
+  const x = inputsOf({ ...calc, tree }, ch, custom);
+  try {
+    const debuffs = assemble(x.args).debuffs;
+    return {
+      prepare: {
+        ...x.args,
+        spells: calc.spells,
+        spellClassSet: tree.info.spellClassSet,
+        classTalents: x.classTalents,
+      },
+      rotation: x.rotation,
+      target: presetTarget(targetsFile, ch.target, calc.level, debuffs, x.customTarget),
+      armorFormula: targetsFile.armorFormula,
+    };
+  } catch (e) {
+    if (e instanceof UnsupportedLevelError) return null;
+    throw e;
+  }
+}
+
 /** Talents the damage engine now models are dropped from the "not modeled" list. */
 function notModeled(mapping: TalentMapping, tree: ClassTree, damage: DamageView | null): NotModeled[] {
   if (!damage) return mapping.notModeled;
```

`src/state/store.ts` (diff):

```diff
diff --git a/src/state/store.ts b/src/state/store.ts
index 53586f5..7d92065 100644
--- a/src/state/store.ts
+++ b/src/state/store.ts
@@ -14,6 +14,7 @@ import {
 } from "@/engine/talents";
 import type { BuildCode } from "./buildCode";
 import { useCharacter } from "./character";
+import { catalogFor, useRotation } from "./rotation";
 
 export interface CalcState {
   classToken: ClassToken | null;
@@ -72,6 +73,7 @@ export const useCalc = create<CalcState>()((set, get) => ({
         useCharacter.getState().fitToClass(token, get().level),
       ]);
       if (id !== requestId) return;
+      useRotation.getState().clear();
       set({
         tree,
         spells,
@@ -96,6 +98,9 @@ export const useCalc = create<CalcState>()((set, get) => ({
       if (id !== requestId) return;
       const ctx = pointsContext({ level: code.level, talentedRank: code.talentedRank });
       const { ranks, dropped } = sanitize(tree, code.ranks, ctx);
+      const rotationOk = useRotation
+        .getState()
+        .applyCode(code.character, code.classToken, catalogFor(spells, tree));
       set({
         tree,
         spells,
@@ -108,6 +113,7 @@ export const useCalc = create<CalcState>()((set, get) => ({
           [
             dropped ? "Some talents in this link were not valid and were removed." : "",
             charOk ? "" : "Some character settings in this link were not valid and were removed.",
+            rotationOk ? "" : "Some rotation settings in this link were not valid and were removed.",
           ]
             .filter(Boolean)
             .join(" ") || null,
@@ -119,6 +125,7 @@ export const useCalc = create<CalcState>()((set, get) => ({
   },
   clearClass() {
     requestId++;
+    useRotation.getState().clear();
     set({
       classToken: null,
       tree: null,
```

`src/state/urlSync.ts` (diff):

```diff
diff --git a/src/state/urlSync.ts b/src/state/urlSync.ts
index 06d9d90..74144a5 100644
--- a/src/state/urlSync.ts
+++ b/src/state/urlSync.ts
@@ -1,6 +1,7 @@
 import { isClassToken } from "@/data";
 import { decodeBuild, encodeBuild } from "./buildCode";
 import { useCharacter } from "./character";
+import { catalogFor, useRotation } from "./rotation";
 import { useCalc } from "./store";
 
 /** Keeps location.hash and the store in sync. Call once before the first render. */
@@ -31,7 +32,10 @@ export function initUrlSync(): void {
           level: s.level,
           talentedRank: s.talentedRank,
           ranks: s.ranks,
-          character: useCharacter.getState().toCode(s.classToken),
+          character: {
+            ...useCharacter.getState().toCode(s.classToken),
+            ...(s.spells && s.tree ? useRotation.getState().toCode(catalogFor(s.spells, s.tree)) : {}),
+          },
         })
       : "";
     if (next === lastHash) return;
@@ -40,4 +44,5 @@ export function initUrlSync(): void {
   };
   useCalc.subscribe(write);
   useCharacter.subscribe(write);
+  useRotation.subscribe(write);
 }
```

`src/ui/stats/useDerived.ts` (diff):

```diff
diff --git a/src/ui/stats/useDerived.ts b/src/ui/stats/useDerived.ts
index ea4ac2d..4196290 100644
--- a/src/ui/stats/useDerived.ts
+++ b/src/ui/stats/useDerived.ts
@@ -1,6 +1,7 @@
 import { useMemo } from "react";
 import { useCalc } from "@/state/store";
 import { useCharacter } from "@/state/character";
+import { useRotation } from "@/state/rotation";
 import { derive, type Derived } from "@/state/derived";
 
 /** Derived stats for the current talents and character (pure computation, well under 1 ms). */
@@ -16,9 +17,14 @@ export function useDerived(): Derived {
   const target = useCharacter((s) => s.target);
   const custom = useCharacter((s) => s.custom);
   const weapons = useCharacter((s) => s.weapons);
+  const rotation = useRotation((s) => s.custom);
   return useMemo(
     () =>
-      derive({ tree, ranks, level, spells }, { raceId, weaponIds, bonus, buffIds, target, custom, weapons }),
-    [tree, ranks, level, spells, raceId, weaponIds, bonus, buffIds, target, custom, weapons],
+      derive(
+        { tree, ranks, level, spells },
+        { raceId, weaponIds, bonus, buffIds, target, custom, weapons },
+        rotation,
+      ),
+    [tree, ranks, level, spells, raceId, weaponIds, bonus, buffIds, target, custom, weapons, rotation],
   );
 }
```

### 5.4 Worker client: `src/state/sim.ts` (exact)

`src/state/sim.ts` (exact):

```ts
import { create } from "zustand";
import type { SimConfig, SimInput, SimRequest, SimResponse, SimResult } from "@/engine/sim/types";

/** The part of a Worker the client uses (tests inject a fake). */
export interface SimWorker {
  postMessage(message: SimRequest): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<SimResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}
let factory = (): SimWorker =>
  new Worker(new URL("../engine/sim/worker.ts", import.meta.url), { type: "module" }) as unknown as SimWorker;
/** TEST-ONLY: replaces the worker factory. */
export function setSimWorkerFactory(f: () => SimWorker): void {
  factory = f;
}

export interface SimState {
  status: "idle" | "running" | "done" | "cancelled" | "error";
  done: number;
  total: number;
  result: SimResult | null;
  error: string | null;
  key: string | null; // inputs of `result` (the UI marks a result stale when its inputs changed)
  run(input: SimInput, config: SimConfig, key: string): void;
  cancel(): void;
}

let worker: SimWorker | null = null;
let requestId = 0;

/** Runs the simulator in a Web Worker; a new run or cancel terminates the previous worker (section 4.7). */
export const useSim = create<SimState>()((set) => ({
  status: "idle",
  done: 0,
  total: 0,
  result: null,
  error: null,
  key: null,
  run(input, config, key) {
    worker?.terminate();
    const id = ++requestId;
    const w = factory();
    worker = w;
    set({ status: "running", done: 0, total: config.iterations, error: null });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.id !== id || id !== requestId) return; // a cancelled or replaced run
      if (m.type === "progress") set({ done: m.done, total: m.total });
      else if (m.type === "result") {
        set({ status: "done", result: m.result, key, done: m.result.config.iterations });
        w.terminate();
        if (worker === w) worker = null;
      } else {
        set({ status: "error", error: m.message });
        w.terminate();
        if (worker === w) worker = null;
      }
    };
    w.onerror = (e) => {
      if (id !== requestId) return;
      set({ status: "error", error: e.message || "The simulation worker failed." });
    };
    w.postMessage({ type: "run", id, input, config });
  },
  cancel() {
    requestId++;
    worker?.terminate();
    worker = null;
    set({ status: "cancelled" });
  },
}));
```

---

## 6. UI (task T8)

### 6.1 Rotation editor

Accessibility: every control has an accessible name ("Move Fire Blast up", "Type of Fire Blast", "Use Fire Blast",
"Condition type (Fire Blast 1)" ...); reordering works with the arrow buttons only (keyboard), drag-and-drop is an extra
(HTML5 DnD on the `<li>`). Unavailable entries show the analytical model's skip reason under the entry.

`src/ui/rotation/editing.ts` (exact):

```ts
import type { ConditionType, RotationCondition, RotationEntry, RotationEntryKind } from "@/data/types";
import { PROC_AURAS } from "@/state/rotation";

export const KIND_LABEL: Record<RotationEntryKind, string> = {
  cooldown: "On cooldown",
  dot: "Keep DoT up",
  maintain: "Recast every …",
  filler: "Filler",
  builder: "Combo builder",
  finisher: "Finisher",
  nextSwing: "On next swing",
  burst: "Cooldown buff",
};
export const KINDS = Object.keys(KIND_LABEL) as RotationEntryKind[];

/** A new condition of a type with its default operands. */
export function newCondition(type: ConditionType, refs: readonly string[]): RotationCondition {
  switch (type) {
    case "aura":
      return { type, ref: refs[0] ?? PROC_AURAS[0]!, active: true };
    case "cooldown":
      return { type, ref: refs[0] ?? "", ready: true };
    case "targetHp":
      return { type, cmp: "lt", value: 20 };
    case "auraLeft":
      return { type, cmp: "lt", value: 2 };
    default:
      return { type, cmp: "gte", value: type === "comboPoints" ? 5 : 50 };
  }
}

export function move<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

/** A copy of an entry without one optional field. */
export function strip(e: RotationEntry, key: "off" | "conditions"): RotationEntry {
  const out = { ...e };
  delete out[key];
  return out;
}
```

`src/ui/rotation/RotationEditor.tsx` (exact):

```tsx
import { useMemo, useState } from "react";
import { rotationsFile } from "@/data";
import type {
  ConditionType,
  RotationCondition,
  RotationEntry,
  RotationEntryKind,
  SpecRotation,
} from "@/data/types";
import { CONDITION_TYPES, describeCondition, pickRotation } from "@/engine/rotation";
import { pointsBySpec } from "@/engine/talents";
import { PROC_AURAS, catalogFor, useRotation } from "@/state/rotation";
import { useCalc } from "@/state/store";
import { WowIcon } from "@/ui/common/WowIcon";
import { slug } from "@/ui/results/slug";
import { useDerived } from "@/ui/stats/useDerived";
import { KINDS, KIND_LABEL, move, newCondition, strip } from "./editing";
import styles from "./RotationEditor.module.css";

function ConditionRow({
  c,
  abilityRefs,
  auraRefs,
  power,
  onChange,
  onRemove,
  label,
}: {
  c: RotationCondition;
  abilityRefs: string[];
  auraRefs: string[];
  power: Parameters<typeof describeCondition>[1];
  onChange(c: RotationCondition): void;
  onRemove(): void;
  label: string;
}) {
  const meta = CONDITION_TYPES.find((t) => t.type === c.type)!;
  const refs = c.type === "aura" ? auraRefs : abilityRefs;
  return (
    <li className={styles.condition} data-testid="rotation-condition">
      <select
        aria-label={`Condition type (${label})`}
        value={c.type}
        onChange={(e) => onChange(newCondition(e.target.value as ConditionType, refs))}
      >
        {CONDITION_TYPES.map((t) => (
          <option key={t.type} value={t.type}>
            {t.type === "resource" && power ? power[0]!.toUpperCase() + power.slice(1) : t.label}
          </option>
        ))}
      </select>
      {c.type === "aura" || c.type === "cooldown" ? (
        <>
          <select
            aria-label={`Condition reference (${label})`}
            value={c.ref}
            onChange={(e) => onChange({ ...c, ref: e.target.value })}
          >
            {[...new Set([c.ref, ...refs])].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            aria-label={`Condition state (${label})`}
            value={String(c.type === "aura" ? c.active : c.ready)}
            onChange={(e) =>
              onChange(
                c.type === "aura"
                  ? { ...c, active: e.target.value === "true" }
                  : { ...c, ready: e.target.value === "true" },
              )
            }
          >
            <option value="true">{c.type === "aura" ? "active" : "ready"}</option>
            <option value="false">{c.type === "aura" ? "not active" : "on cooldown"}</option>
          </select>
        </>
      ) : (
        <>
          <select
            aria-label={`Condition comparison (${label})`}
            value={c.cmp}
            onChange={(e) => onChange({ ...c, cmp: e.target.value as "gte" | "lt" })}
          >
            <option value="gte">≥</option>
            <option value="lt">&lt;</option>
          </select>
          <input
            type="number"
            aria-label={`Condition value (${label})`}
            className={styles.number}
            min={0}
            max={meta.max}
            step={c.type === "auraLeft" || c.type === "timeLeft" ? 0.5 : 1}
            value={c.value}
            onChange={(e) =>
              onChange({ ...c, value: Math.min(meta.max, Math.max(0, Number(e.target.value) || 0)) })
            }
          />
          <span className={styles.unit}>{c.type === "resource" && power === "mana" ? "%" : meta.unit}</span>
        </>
      )}
      <button
        type="button"
        className={styles.icon}
        aria-label={`Remove condition (${label})`}
        onClick={onRemove}
      >
        ×
      </button>
    </li>
  );
}

/** Priority list editor (section 6.1): reorder (drag and drop or buttons), add, remove, switch off, conditions. */
export function RotationEditor() {
  const tree = useCalc((s) => s.tree);
  const spells = useCalc((s) => s.spells);
  const ranks = useCalc((s) => s.ranks);
  const custom = useRotation((s) => s.custom);
  const setRotation = useRotation((s) => s.setRotation);
  const reset = useRotation((s) => s.reset);
  const d = useDerived();
  const [drag, setDrag] = useState<number | null>(null);
  const [adding, setAdding] = useState("");
  const catalog = useMemo(() => (spells && tree ? catalogFor(spells, tree) : []), [spells, tree]);
  if (!tree || !spells) return null;
  const auto = pickRotation(rotationsFile, tree.token, pointsBySpec(tree, ranks));
  const rotation: SpecRotation = custom && custom.class === tree.token ? custom : auto;
  const specs = rotationsFile.rotations.filter((r) => r.class === tree.token).sort((a, b) => a.spec - b.spec);
  const edit = (entries: RotationEntry[]) => setRotation({ ...structuredClone(rotation), entries });
  const update = (i: number, patch: Partial<RotationEntry>) =>
    edit(rotation.entries.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const inList = new Set(rotation.entries.map((e) => e.ability));
  const addable = catalog.filter((a) => !inList.has(a.name));
  const abilityRefs = rotation.entries.map((e) => e.ability);
  const auraRefs = [...new Set([...abilityRefs, ...PROC_AURAS])];
  const power = d.ok && d.damage ? d.damage.result.rotation.power : null;
  const skipped = new Map(
    d.ok && d.damage ? d.damage.result.rotation.skipped.map((s) => [s.ability, s.reason]) : [],
  );
  const icon = (name: string) => catalog.find((a) => a.name === name)?.icon ?? null;

  return (
    <section className={styles.panel} data-testid="rotation-editor" aria-labelledby="rotation-title">
      <div className={styles.header}>
        <h2 id="rotation-title" className={styles.title}>
          Rotation
        </h2>
        <label className={styles.base}>
          Based on{" "}
          <select
            data-testid="rotation-base"
            value={rotation.spec}
            onChange={(e) => {
              const r = specs.find((x) => x.spec === Number(e.target.value));
              if (r) setRotation(structuredClone(r));
            }}
          >
            {specs.map((r) => (
              <option key={r.id} value={r.spec}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {custom && (
          <span className={styles.badge} data-testid="rotation-edited">
            edited
          </span>
        )}
        <button type="button" data-testid="rotation-reset" disabled={!custom} onClick={reset}>
          Reset to default
        </button>
      </div>
      <p className={styles.hint}>
        Top to bottom: the first usable entry is cast. Drag an entry or use the arrow buttons to reorder.
        Entries marked “simulation only” do not count in the analytical DPS.
      </p>
      <ol className={styles.list} data-testid="rotation-list">
        {rotation.entries.map((e, i) => {
          const id = slug(e.ability);
          return (
            <li
              key={`${e.ability}-${i}`}
              className={`${styles.entry} ${drag === i ? styles.dragging : ""} ${e.off ? styles.off : ""}`}
              data-testid={`rotation-entry-${id}`}
              draggable
              onDragStart={(ev) => {
                setDrag(i);
                ev.dataTransfer.effectAllowed = "move";
                ev.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={(ev) => {
                ev.preventDefault();
                const from = drag ?? Number(ev.dataTransfer.getData("text/plain"));
                setDrag(null);
                if (Number.isInteger(from) && from !== i) edit(move(rotation.entries, from, i));
              }}
              onDragEnd={() => setDrag(null)}
            >
              <div className={styles.row}>
                <span className={styles.handle} aria-hidden>
                  ⋮⋮
                </span>
                <span className={styles.rank}>{i + 1}</span>
                <input
                  type="checkbox"
                  aria-label={`Use ${e.ability}`}
                  checked={!e.off}
                  onChange={(ev) =>
                    edit(
                      rotation.entries.map((x, k) =>
                        k === i ? (ev.target.checked ? strip(x, "off") : { ...x, off: true }) : x,
                      ),
                    )
                  }
                />
                <WowIcon name={icon(e.ability)} size={20} />
                <span className={styles.name}>{e.ability}</span>
                <select
                  aria-label={`Type of ${e.ability}`}
                  value={e.kind}
                  onChange={(ev) => update(i, { kind: ev.target.value as RotationEntryKind })}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                {e.kind === "finisher" && (
                  <label className={styles.small}>
                    CP{" "}
                    <input
                      type="number"
                      className={styles.number}
                      aria-label={`Combo points of ${e.ability}`}
                      min={1}
                      max={5}
                      value={e.cp ?? 5}
                      onChange={(ev) =>
                        update(i, { cp: Math.min(5, Math.max(1, Math.round(Number(ev.target.value) || 5))) })
                      }
                    />
                  </label>
                )}
                {e.kind === "maintain" && (
                  <label className={styles.small}>
                    every{" "}
                    <input
                      type="number"
                      className={styles.number}
                      aria-label={`Recast interval of ${e.ability}`}
                      min={1}
                      max={600}
                      value={e.everySec ?? 30}
                      onChange={(ev) =>
                        update(i, { everySec: Math.min(600, Math.max(1, Number(ev.target.value) || 30)) })
                      }
                    />{" "}
                    s
                  </label>
                )}
                <span className={styles.buttons}>
                  <button
                    type="button"
                    className={styles.icon}
                    aria-label={`Move ${e.ability} up`}
                    disabled={i === 0}
                    onClick={() => edit(move(rotation.entries, i, i - 1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.icon}
                    aria-label={`Move ${e.ability} down`}
                    disabled={i === rotation.entries.length - 1}
                    onClick={() => edit(move(rotation.entries, i, i + 1))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={styles.icon}
                    aria-label={`Add a condition to ${e.ability}`}
                    onClick={() =>
                      update(i, {
                        conditions: [...(e.conditions ?? []), newCondition("resource", abilityRefs)],
                      })
                    }
                  >
                    +if
                  </button>
                  <button
                    type="button"
                    className={styles.icon}
                    aria-label={`Remove ${e.ability}`}
                    onClick={() => edit(rotation.entries.filter((_, k) => k !== i))}
                  >
                    ×
                  </button>
                </span>
              </div>
              {skipped.has(e.ability) && <p className={styles.skip}>{skipped.get(e.ability)}</p>}
              {(e.conditions ?? []).length > 0 && (
                <ul className={styles.conditions}>
                  {e.conditions!.map((c, k) => (
                    <ConditionRow
                      key={k}
                      c={c}
                      label={`${e.ability} ${k + 1}`}
                      abilityRefs={abilityRefs.filter((x) => x !== e.ability)}
                      auraRefs={auraRefs}
                      power={power}
                      onChange={(nc) =>
                        update(i, { conditions: e.conditions!.map((x, j) => (j === k ? nc : x)) })
                      }
                      onRemove={() => {
                        const rest = e.conditions!.filter((_, j) => j !== k);
                        edit(
                          rotation.entries.map((x, j) =>
                            j === i ? (rest.length ? { ...x, conditions: rest } : strip(x, "conditions")) : x,
                          ),
                        );
                      }}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <div className={styles.add}>
        <select
          data-testid="rotation-add"
          aria-label="Ability to add"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
        >
          <option value="">Add an ability…</option>
          {addable.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
              {a.talent ? " (talent)" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="rotation-add-button"
          disabled={!adding}
          onClick={() => {
            const a = catalog.find((x) => x.name === adding);
            if (a) edit([...rotation.entries, structuredClone(a.entry)]);
            setAdding("");
          }}
        >
          Add
        </button>
      </div>
    </section>
  );
}
```

`src/ui/rotation/RotationEditor.module.css` (exact):

```css
.panel {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: 4px;
  min-width: 0;
}

.header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}

.title {
  margin: 0;
  color: var(--gold);
  font-size: 20px;
}

.base {
  color: var(--text-dim);
  font-size: 12px;
}

.badge {
  padding: 0 4px;
  border: 1px solid var(--gold);
  border-radius: 3px;
  color: var(--gold);
  font-size: 11px;
}

.hint {
  margin: 6px 0;
  color: var(--text-dim);
  font-size: 12px;
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.entry {
  margin: 4px 0;
  padding: 4px 6px;
  background: var(--field-bg);
  border: 1px solid var(--panel-border);
  border-radius: 3px;
}

.dragging {
  opacity: 0.5;
}

.off .name {
  color: var(--grey);
  text-decoration: line-through;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
}

.handle {
  color: var(--grey);
  cursor: grab;
}

.rank {
  min-width: 1.5em;
  color: var(--text-dim);
  font-size: 12px;
  text-align: right;
}

.name {
  flex: 1 1 120px;
  min-width: 0;
  color: var(--text);
}

.small {
  color: var(--text-dim);
  font-size: 12px;
}

.number {
  width: 4.5em;
}

.unit {
  color: var(--text-dim);
  font-size: 12px;
}

.buttons {
  display: inline-flex;
  gap: 2px;
}

.icon {
  min-width: 26px;
  padding: 1px 4px;
}

.skip {
  margin: 2px 0 0 2.5em;
  color: var(--warn);
  font-size: 11px;
}

.conditions {
  margin: 4px 0 0 2.5em;
  padding: 0;
  list-style: none;
}

.condition {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin: 2px 0;
  font-size: 12px;
}

.condition::before {
  content: "if";
  color: var(--text-dim);
}

.add {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.add select {
  flex: 1;
  min-width: 0;
}

/* Fields and buttons: same look as the Character panel and the talent summary bar (.btn). */
.panel select,
.panel input[type="number"] {
  padding: 2px 4px;
  background: var(--field-bg);
  border: 1px solid var(--panel-border);
  border-radius: 3px;
  color: var(--text);
}

.panel button {
  padding: 3px 8px;
  background: #1d1b16;
  border: 1px solid var(--panel-border);
  border-radius: 3px;
  color: var(--gold);
  cursor: pointer;
}

.panel button:disabled {
  color: var(--grey);
  cursor: default;
  opacity: 0.6;
}

.panel button:focus-visible,
.panel select:focus-visible,
.panel input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
```

### 6.2 Simulation panel

Dataviz: both charts are single-series (no legend; the title names the series), drawn as inline SVG with tokens from
`tokens.css` (`--gold` bars, `--focus` line, `--panel-border` grid, `--text-dim` axis text), 2 px line, 4 px end radius on
bars, hover readout + crosshair on the line, native `<title>` tooltips on the bars; the breakdown table is the table
view. No chart library.

`src/ui/sim/SimPanel.tsx` (exact):

```tsx
import { useMemo, useState } from "react";
import { DEFAULT_SIM_CONFIG, type SimResult } from "@/engine/sim/types";
import { useCharacter } from "@/state/character";
import { simInputFor } from "@/state/derived";
import { useRotation } from "@/state/rotation";
import { useSim } from "@/state/sim";
import { useCalc } from "@/state/store";
import { slug } from "@/ui/results/slug";
import { fmtDec1, fmtInt, fmtPct } from "@/ui/stats/format";
import { useDerived } from "@/ui/stats/useDerived";
import styles from "./SimPanel.module.css";

const LOG_LIMIT = DEFAULT_SIM_CONFIG.logLimit;

/** The simulator input of the current state and a key that changes whenever it does (stale results). */
function useSimInput() {
  const tree = useCalc((s) => s.tree);
  const spells = useCalc((s) => s.spells);
  const ranks = useCalc((s) => s.ranks);
  const level = useCalc((s) => s.level);
  const ch = useCharacter();
  const custom = useRotation((s) => s.custom);
  const sim = useRotation((s) => s.sim);
  const { raceId, weaponIds, bonus, buffIds, target, weapons } = ch;
  const customTarget = ch.custom;
  return useMemo(() => {
    const input = simInputFor(
      { tree, ranks, level, spells },
      { raceId, weaponIds, bonus, buffIds, target, custom: customTarget, weapons },
      custom,
    );
    const key = JSON.stringify([
      tree?.token,
      ranks,
      level,
      raceId,
      weaponIds,
      bonus,
      buffIds,
      target,
      customTarget,
      custom,
      sim,
    ]);
    return { input, key, sim };
  }, [
    tree,
    spells,
    ranks,
    level,
    raceId,
    weaponIds,
    bonus,
    buffIds,
    target,
    customTarget,
    weapons,
    custom,
    sim,
  ]);
}

function Settings({ running }: { running: boolean }) {
  const sim = useRotation((s) => s.sim);
  const setSim = useRotation((s) => s.setSim);
  const num = (key: "fightSec" | "iterations" | "seed", label: string, testId: string) => (
    <label className={styles.field}>
      {label}
      <input
        type="number"
        data-testid={testId}
        disabled={running}
        value={sim[key]}
        onChange={(e) => setSim({ [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <div className={styles.settings}>
      {num("fightSec", "Fight length (s)", "sim-fight")}
      {num("iterations", "Iterations", "sim-iterations")}
      {num("seed", "Seed", "sim-seed")}
      <label className={styles.check}>
        <input
          type="checkbox"
          data-testid="sim-unlimited-mana"
          disabled={running}
          checked={sim.unlimitedMana}
          onChange={(e) => setSim({ unlimitedMana: e.target.checked })}
        />
        Unlimited mana
      </label>
    </div>
  );
}

/** Damage sources with an inline share bar (one series: no legend; the table is the table view). */
function Sources({ r }: { r: SimResult }) {
  const max = Math.max(...r.sources.map((s) => s.share), 1);
  return (
    <table className={styles.table} data-testid="sim-breakdown">
      <caption>Damage by source (mean per fight)</caption>
      <thead>
        <tr>
          <th>Source</th>
          <th>DPS</th>
          <th>Share</th>
          <th>Casts</th>
          <th>Crit</th>
          <th>Avg hit</th>
        </tr>
      </thead>
      <tbody>
        {r.sources.map((s) => {
          const landed = s.hits + s.ticks;
          return (
            <tr key={s.key} data-testid={`sim-row-${slug(s.key)}`}>
              <td>
                {s.key}
                {s.averaged && (
                  <span className={styles.avg} title="Expected value from the analytical model">
                    {" "}
                    avg
                  </span>
                )}
              </td>
              <td>{fmtDec1(s.dps)}</td>
              <td className={styles.shareCell}>
                <svg className={styles.bar} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
                  <title>{`${s.key}: ${fmtPct(s.share)}`}</title>
                  <rect x="0" y="1" width={(s.share / max) * 100} height="8" rx="2" />
                </svg>
                {fmtPct(s.share)}
              </td>
              <td>{s.casts > 0 ? fmtDec1(s.casts) : "–"}</td>
              <td>{landed > 0 ? fmtPct((s.crits / landed) * 100) : "–"}</td>
              <td>{landed > 0 ? fmtInt(s.damage / landed) : "–"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const W = 600;
const H = 140;
const PAD = { l: 40, r: 8, t: 8, b: 20 };

/** Resource over time of iteration 1 (one series, hover readout, execute-phase marker). */
function ResourceChart({ r }: { r: SimResult }) {
  const [hover, setHover] = useState<number | null>(null);
  const tl = r.timeline;
  if (!tl || tl.points.length < 2 || !r.power) return null;
  const T = r.config.fightSec;
  const x = (t: number) => PAD.l + (t / T) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / Math.max(1, tl.max)) * (H - PAD.t - PAD.b);
  const pts = tl.points.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: Math.floor(T / 30) + 1 }, (_, i) => i * 30);
  const p = hover !== null ? tl.points[hover] : undefined;
  const name = r.power[0]!.toUpperCase() + r.power.slice(1);
  return (
    <figure className={styles.figure} data-testid="sim-resource-chart">
      <figcaption>{name} over time (iteration 1)</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.chart}
        role="img"
        aria-label={`${name} over the fight, one sample iteration`}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const t = ((((e.clientX - box.left) / box.width) * W - PAD.l) / (W - PAD.l - PAD.r)) * T;
          let best = 0;
          for (let i = 1; i < tl.points.length; i++)
            if (Math.abs(tl.points[i]![0] - t) < Math.abs(tl.points[best]![0] - t)) best = i;
          setHover(best);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className={styles.grid} x1={PAD.l} x2={W - PAD.r} y1={y(f * tl.max)} y2={y(f * tl.max)} />
            <text className={styles.axis} x={PAD.l - 4} y={y(f * tl.max) + 4} textAnchor="end">
              {fmtInt(f * tl.max)}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} className={styles.axis} x={x(t)} y={H - 4} textAnchor="middle">
            {t}s
          </text>
        ))}
        <line className={styles.execute} x1={x(T * 0.8)} x2={x(T * 0.8)} y1={PAD.t} y2={H - PAD.b} />
        <polyline className={styles.line} points={pts} />
        {p && (
          <g>
            <line className={styles.cross} x1={x(p[0])} x2={x(p[0])} y1={PAD.t} y2={H - PAD.b} />
            <circle className={styles.dot} cx={x(p[0])} cy={y(p[1])} r={4} />
          </g>
        )}
      </svg>
      <p className={styles.readout} data-testid="sim-resource-readout">
        {p
          ? `${fmtDec1(p[0])} s: ${fmtInt(p[1])} ${r.power}`
          : "Hover the chart for values. Dashed line: execute phase (20% health)."}
      </p>
    </figure>
  );
}

function Log({ r }: { r: SimResult }) {
  return (
    <details className={styles.log} data-testid="sim-log">
      <summary>Combat log (first {r.log.length} events of iteration 1)</summary>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Source</th>
            <th>Event</th>
            <th>Damage</th>
            {r.power && <th>{r.power}</th>}
          </tr>
        </thead>
        <tbody>
          {r.log.map((l, i) => (
            <tr key={i}>
              <td>{l.t.toFixed(2)}</td>
              <td>{l.source}</td>
              <td>{l.outcome}</td>
              <td>{l.damage ? fmtInt(l.damage) : ""}</td>
              {r.power && <td>{l.resource === null ? "" : fmtInt(l.resource)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** "Run simulation" with progress and cancel; results of the last run (section 6.2). The analytical DPS stays live. */
export function SimPanel() {
  const d = useDerived();
  const { input, key, sim } = useSimInput();
  const s = useSim();
  const running = s.status === "running";
  const r = s.result;
  const analytical = d.ok && d.damage ? d.damage.result.rotation.dps : null;
  return (
    <section className={styles.panel} data-testid="sim-panel" aria-labelledby="sim-title">
      <h2 id="sim-title" className={styles.title}>
        Simulation
      </h2>
      <Settings running={running} />
      <div className={styles.actions}>
        {running ? (
          <button type="button" data-testid="sim-cancel" onClick={s.cancel}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            data-testid="sim-run"
            disabled={!input}
            onClick={() => input && s.run(input, { ...DEFAULT_SIM_CONFIG, ...sim, logLimit: LOG_LIMIT }, key)}
          >
            Run simulation
          </button>
        )}
        {running && (
          <span className={styles.progress} data-testid="sim-progress">
            <progress max={s.total} value={s.done} aria-label="Simulation progress" /> {s.done} / {s.total}
          </span>
        )}
        {s.status === "cancelled" && <span data-testid="sim-cancelled">Cancelled.</span>}
        {s.status === "error" && <span className={styles.error}>Simulation failed: {s.error}</span>}
      </div>
      {r && (
        <div data-testid="sim-results">
          {s.key !== key && (
            <p className={styles.stale} data-testid="sim-stale">
              These results are for an earlier setup. Run the simulation again.
            </p>
          )}
          <div className={styles.summary}>
            <span className={styles.dps} data-testid="sim-dps">
              {fmtDec1(r.dps.mean)}
            </span>
            <span className={styles.unit}>DPS ± {fmtDec1(r.dps.stdev)}</span>
            <span className={styles.meta} data-testid="sim-ci">
              95% CI {fmtDec1(r.dps.ci95[0])}–{fmtDec1(r.dps.ci95[1])} · min {fmtDec1(r.dps.min)} · max{" "}
              {fmtDec1(r.dps.max)}
            </span>
          </div>
          <p className={styles.meta}>
            {r.config.iterations} iterations of {r.config.fightSec} s, seed {r.config.seed} ·{" "}
            {fmtInt(r.elapsedMs)} ms
            {analytical !== null && s.key === key && (
              <span data-testid="sim-vs-analytical">
                {" "}
                · analytical {fmtDec1(analytical)} ({r.dps.mean >= analytical ? "+" : "−"}
                {fmtPct((Math.abs(r.dps.mean - analytical) / Math.max(1, analytical)) * 100)})
              </span>
            )}
          </p>
          <p className={styles.meta} data-testid="sim-idle">
            Idle {fmtDec1(r.idleSec)} s per fight
            {r.oomSec > 0.05 ? ` · out of mana ${fmtDec1(r.oomSec)} s (gear enters only as bonus stats)` : ""}
          </p>
          <Sources r={r} />
          <ResourceChart r={r} />
          <Log r={r} />
          {(r.modeled.length > 0 || r.averaged.length > 0) && (
            <ul className={styles.notes}>
              {r.modeled.map((m) => (
                <li key={m}>Simulated: {m}</li>
              ))}
              {r.averaged.map((m) => (
                <li key={m}>Average (analytical): {m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
```

`src/ui/sim/SimPanel.module.css` (exact):

```css
.panel {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: 4px;
  min-width: 0;
}

.title {
  margin: 0 0 8px;
  color: var(--gold);
  font-size: 20px;
}

.settings {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  font-size: 12px;
  color: var(--text-dim);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.field input {
  width: 7em;
}

.check {
  display: flex;
  align-items: center;
  gap: 4px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}

.progress {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-dim);
  font-size: 12px;
}

.error {
  color: var(--red);
}

.stale {
  margin: 4px 0;
  color: var(--warn);
  font-size: 12px;
}

.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 10px;
}

.dps {
  color: var(--white);
  font-size: 28px;
  font-weight: bold;
}

.unit {
  color: var(--text-dim);
}

.meta {
  margin: 2px 0;
  color: var(--text-dim);
  font-size: 12px;
}

.table {
  width: 100%;
  margin-top: 6px;
  border-collapse: collapse;
  font-size: 12px;
}

.table caption {
  padding-bottom: 4px;
  color: var(--text-dim);
  text-align: left;
}

.table th,
.table td {
  padding: 2px 4px;
  border-bottom: 1px solid var(--panel-border);
  text-align: right;
}

.table th:first-child,
.table td:first-child {
  text-align: left;
}

.table thead th {
  color: var(--text-dim);
  font-weight: normal;
}

.avg {
  color: var(--text-dim);
  font-size: 10px;
}

.shareCell {
  white-space: nowrap;
}

.bar {
  width: 60px;
  height: 10px;
  margin-right: 4px;
  vertical-align: middle;
}

.bar rect {
  fill: var(--gold);
}

.figure {
  margin: 10px 0 0;
}

.figure figcaption {
  color: var(--text-dim);
  font-size: 12px;
}

.chart {
  display: block;
  width: 100%;
  height: auto;
}

.grid {
  stroke: var(--panel-border);
  stroke-width: 1;
}

.axis {
  fill: var(--text-dim);
  font-size: 10px;
}

.execute {
  stroke: var(--grey);
  stroke-dasharray: 4 3;
}

.line {
  fill: none;
  stroke: var(--focus);
  stroke-width: 2;
  stroke-linejoin: round;
}

.cross {
  stroke: var(--text-dim);
  stroke-width: 1;
}

.dot {
  fill: var(--focus);
  stroke: var(--panel);
  stroke-width: 2;
}

.readout {
  margin: 2px 0;
  color: var(--text-dim);
  font-size: 12px;
}

.log {
  margin-top: 8px;
  font-size: 12px;
}

.log summary {
  cursor: pointer;
  color: var(--text);
}

.log table {
  display: block;
  max-height: 300px;
  overflow: auto;
}

.notes {
  margin: 8px 0 0;
  padding-left: 18px;
  color: var(--text-dim);
  font-size: 11px;
}

/* Fields and buttons: same look as the Character panel and the talent summary bar (.btn). */
.panel select,
.panel input[type="number"] {
  padding: 2px 4px;
  background: var(--field-bg);
  border: 1px solid var(--panel-border);
  border-radius: 3px;
  color: var(--text);
}

.panel button {
  padding: 3px 8px;
  background: #1d1b16;
  border: 1px solid var(--panel-border);
  border-radius: 3px;
  color: var(--gold);
  cursor: pointer;
}

.panel button:disabled {
  color: var(--grey);
  cursor: default;
  opacity: 0.6;
}

.panel button:focus-visible,
.panel select:focus-visible,
.panel input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
```

### 6.3 Layout: `src/App.tsx` (diff)

Desktop: a second `.panels` row (Rotation | Simulation) under the Damage panel. Mobile: 5th tab "Sim" with both panels.

`src/App.tsx` (diff):

```diff
diff --git a/src/App.tsx b/src/App.tsx
index a55ffd4..7af1182 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -4,13 +4,15 @@ import { useCalc } from "@/state/store";
 import { CharacterPanel } from "@/ui/character/CharacterPanel";
 import { DamagePanel } from "@/ui/results/DamagePanel";
 import { useMediaQuery } from "@/ui/common/useMediaQuery";
+import { RotationEditor } from "@/ui/rotation/RotationEditor";
+import { SimPanel } from "@/ui/sim/SimPanel";
 import { StatsPanel } from "@/ui/stats/StatsPanel";
 import { ClassPicker } from "@/ui/talents/ClassPicker";
 import { TalentCalculator } from "@/ui/talents/TalentCalculator";
 import styles from "./App.module.css";
 
-type Section = "Talents" | "Gear" | "Stats" | "Damage";
-const SECTIONS: Section[] = ["Talents", "Gear", "Stats", "Damage"];
+type Section = "Talents" | "Gear" | "Stats" | "Damage" | "Sim";
+const SECTIONS: Section[] = ["Talents", "Gear", "Stats", "Damage", "Sim"];
 
 export function App() {
   const classToken = useCalc((s) => s.classToken);
@@ -55,11 +57,21 @@ export function App() {
             <StatsPanel />
           </div>
           <DamagePanel />
+          <div className={styles.panels}>
+            <RotationEditor />
+            <SimPanel />
+          </div>
         </>
       )}
       {classToken && status === "ready" && !desktop && section === "Gear" && <CharacterPanel />}
       {classToken && status === "ready" && !desktop && section === "Stats" && <StatsPanel />}
       {classToken && status === "ready" && !desktop && section === "Damage" && <DamagePanel />}
+      {classToken && status === "ready" && !desktop && section === "Sim" && (
+        <>
+          <RotationEditor />
+          <SimPanel />
+        </>
+      )}
       <footer className={styles.footer}>
         Data: WoW Forever build {DATA_BUILD} · generated {manifest.generatedAt} · Icons and art © Blizzard
         Entertainment
```

---

## 7. Test helpers (task T9)

`src/testkit/damage.ts` (diff: `DamageScenario.entries` replaces the rotation's entries, so the analytical side of a
cross-check runs the same list):

`src/testkit/damage.ts` (diff):

```diff
diff --git a/src/testkit/damage.ts b/src/testkit/damage.ts
index 43a33bd..282c918 100644
--- a/src/testkit/damage.ts
+++ b/src/testkit/damage.ts
@@ -1,6 +1,6 @@
 // TEST-ONLY helpers for the damage engine. Never import from app code.
 import rotationsJson from "@manual/rotations.json";
-import type { ClassSpellFile, ClassToken, RotationsFile, TargetPresetId } from "@/data/types";
+import type { ClassSpellFile, ClassToken, RotationEntry, RotationsFile, TargetPresetId } from "@/data/types";
 import { classesFile } from "@/data";
 import { evaluateDamage, pickRotation, prepareDamage } from "@/engine/rotation";
 import { EMPTY_BONUS, evaluateTarget, presetTarget } from "@/engine/stats";
@@ -19,6 +19,7 @@ export const spellFile = (token: ClassToken): ClassSpellFile => {
 
 export interface DamageScenario extends Scenario {
   rotation?: string; // rotation id; default: pickRotation by spent points
+  entries?: RotationEntry[]; // Phase 5: replaces the rotation's entries
 }
 
 /** Full damage evaluation of a scenario against one target preset (default boss). */
@@ -28,9 +29,10 @@ export function runDamage(s: DamageScenario, preset: TargetPresetId = s.target ?
   const points = [0, 1, 2].map((i) =>
     talents.filter((t) => tree.nodes.get(t.talent.nodeId)!.specIndex === i).reduce((a, t) => a + t.rank, 0),
   );
-  const rotation = s.rotation
+  const base = s.rotation
     ? rotations.rotations.find((r) => r.id === s.rotation)!
     : pickRotation(rotations, s.classToken, points);
+  const rotation = s.entries ? { ...base, entries: s.entries } : base;
   const info = classesFile.classes.find((c) => c.token === s.classToken)!;
   const p = prepareDamage({
     classToken: s.classToken,
```

`src/testkit/sim.ts` (exact):

```ts
// TEST-ONLY helpers for the simulator. Never import from app code.
import type { SpecRotation, TargetPresetId } from "@/data/types";
import { classesFile } from "@/data";
import { pickRotation } from "@/engine/rotation";
import type { SimInput } from "@/engine/sim";
import { EMPTY_BONUS, assemble, presetTarget } from "@/engine/stats";
import { NO_WEAPONS, baseStats, buffs, racials, ranked, targets } from "./stats";
import { treeFor } from "./talents";
import { rotations, spellFile, type DamageScenario } from "./damage";

export type SimScenario = DamageScenario;

/** The rotation of a scenario (by id, else picked by points), with `entries` replaced when given. */
export function scenarioRotation(s: SimScenario): SpecRotation {
  const tree = treeFor(s.classToken);
  const talents = ranked(s.classToken, s.talents ?? {});
  const points = [0, 1, 2].map((i) =>
    talents.filter((t) => tree.nodes.get(t.talent.nodeId)!.specIndex === i).reduce((a, t) => a + t.rank, 0),
  );
  const base = s.rotation
    ? rotations.rotations.find((r) => r.id === s.rotation)!
    : pickRotation(rotations, s.classToken, points);
  return s.entries ? { ...base, entries: s.entries } : base;
}

/** SimInput of a scenario vs a target preset (same inputs as runDamage). */
export function simInput(s: SimScenario, preset: TargetPresetId = s.target ?? "boss"): SimInput {
  const tree = treeFor(s.classToken);
  const talents = ranked(s.classToken, s.talents ?? {});
  const info = classesFile.classes.find((c) => c.token === s.classToken)!;
  const prepare = {
    classToken: s.classToken,
    race: s.race,
    level: 60,
    baseStats,
    racials,
    buffs,
    buffIds: s.buffIds ?? [],
    talents,
    weapons: { ...NO_WEAPONS, ...s.weapons },
    bonus: { ...EMPTY_BONUS, ...s.bonus },
    spells: spellFile(s.classToken),
    spellClassSet: info.spellClassSet,
    classTalents: [...tree.nodes.values()].map((n) => n.talent),
  };
  const debuffs = assemble(prepare).debuffs;
  return {
    prepare,
    rotation: scenarioRotation(s),
    target: presetTarget(targets, preset, 60, debuffs),
    armorFormula: targets.armorFormula,
  };
}
```

---

## 8. Tests (task T9-T10)

New Vitest files: 41 tests (`rng.test.ts` 4, `conditions.test.ts` 6, `sim.test.ts` 21, `perf.test.ts` 3,
`state/rotation.test.ts` 4, `state/sim.test.ts` 2, `derived.test.ts` +1). Total 261.

### 8.1 RNG and event queue: `src/engine/sim/rng.test.ts` (exact)

The golden outputs were reproduced by this independent Python implementation (`python3 -I rng_check.py`):

```python
M = 0xFFFFFFFF
def splitmix32(seed):
    s = [seed & M]
    def f():
        s[0] = (s[0] + 0x9E3779B9) & M
        z = s[0]
        z = ((z ^ (z >> 16)) * 0x85EBCA6B) & M
        z = ((z ^ (z >> 13)) * 0xC2B2AE35) & M
        return (z ^ (z >> 16)) & M
    return f
def rng(seed):
    i = splitmix32(seed); st = [i(), i(), i(), i()]
    def nxt():
        a, b, c, d = st
        t = (((a + b) & M) + d) & M
        d = (d + 1) & M; a = b ^ (b >> 9); b = (c + ((c << 3) & M)) & M
        c = ((c << 21) & M) | (c >> 11); c = (c + t) & M
        st[:] = [a, b, c, d]
        return t / 4294967296
    for _ in range(12): nxt()
    return nxt
r = rng(1); print([r(), r(), r()])                       # [0.4256499295588583, 0.79042171058245, 0.6910148127935827]
iseed = lambda seed, i: splitmix32((seed & M) ^ (((i + 1) * 0x9E3779B1) & M))()
print(iseed(1, 0), iseed(1, 1), iseed(42, 7))            # 3356300964 31759070 3155100672
```

`src/engine/sim/rng.test.ts` (exact):

```ts
import { describe, expect, it } from "vitest";
import { createRng, iterationSeed, splitmix32 } from "./rng";
import { EventQueue } from "./queue";

describe("seeded RNG (sfc32 + splitmix32)", () => {
  it("golden outputs (cross-checked with an independent Python implementation, section 8.1)", () => {
    const r = createRng(1);
    expect([r(), r(), r()]).toEqual([0.4256499295588583, 0.79042171058245, 0.6910148127935827]);
    const s = splitmix32(0);
    expect([s(), s()]).toEqual([2462723854, 1020716019]);
    expect([iterationSeed(1, 0), iterationSeed(1, 1), iterationSeed(42, 7)]).toEqual([
      3356300964, 31759070, 3155100672,
    ]);
  });
  it("same seed, same stream; values in [0, 1) with mean 0.5", () => {
    const a = createRng(123);
    const b = createRng(123);
    let sum = 0;
    for (let i = 0; i < 100000; i++) {
      const x = a();
      expect(x).toBe(b());
      if (x < 0 || x >= 1) throw new Error(`out of range: ${x}`);
      sum += x;
    }
    expect(sum / 100000).toBeCloseTo(0.5, 2);
    expect(createRng(124)()).not.toBe(createRng(123)());
  });
});

describe("event queue", () => {
  it("pops by time, then by insertion order", () => {
    const q = new EventQueue();
    q.push(2, 1, 10);
    q.push(1, 1, 20);
    q.push(2, 1, 30);
    q.push(0.5, 1, 40);
    q.push(1, 1, 50);
    expect(q.peekTime()).toBe(0.5);
    const out: number[] = [];
    for (let e = q.pop(); e; e = q.pop()) out.push(e.a);
    expect(out).toEqual([40, 20, 50, 10, 30]);
    expect(q.size).toBe(0);
    expect(q.peekTime()).toBe(Infinity);
  });
  it("1000 random events come out sorted", () => {
    const q = new EventQueue();
    const r = createRng(9);
    for (let i = 0; i < 1000; i++) q.push(Math.floor(r() * 100), 0, i);
    let last = { t: -1, a: -1 };
    for (let e = q.pop(); e; e = q.pop()) {
      expect(e.t > last.t || (e.t === last.t && e.a > last.a)).toBe(true);
      last = e;
    }
  });
});
```

### 8.2 Conditions and catalog: `src/engine/rotation/conditions.test.ts` (exact)

`src/engine/rotation/conditions.test.ts` (exact):

```ts
import { describe, expect, it } from "vitest";
import type { RotationEntry, SpecRotation } from "@/data/types";
import { abilityCatalog } from "./catalog";
import {
  conditionHolds,
  conditionsHold,
  describeCondition,
  enabledRotation,
  simOnlyReason,
  type ConditionState,
} from "./conditions";
import { rotations, spellFile } from "@/testkit/damage";
import { treeFor } from "@/testkit/talents";

const state = (patch: Partial<ConditionState> = {}): ConditionState => ({
  power: "rage",
  resource: 40,
  maxMana: 0,
  comboPoints: 3,
  targetHpPct: 50,
  timeLeft: 90,
  auraLeft: (i) => (i === 0 ? 1.5 : 0),
  auraActive: (n) => n === "Flurry",
  cooldownReady: (a) => a === "Bloodthirst",
  ...patch,
});

describe("rotation conditions", () => {
  it("each condition type, both comparisons", () => {
    const s = state();
    expect(conditionHolds({ type: "resource", cmp: "gte", value: 40 }, s, 0)).toBe(true);
    expect(conditionHolds({ type: "resource", cmp: "lt", value: 40 }, s, 0)).toBe(false);
    expect(conditionHolds({ type: "comboPoints", cmp: "gte", value: 4 }, s, 0)).toBe(false);
    expect(conditionHolds({ type: "targetHp", cmp: "lt", value: 20 }, s, 0)).toBe(false);
    expect(conditionHolds({ type: "timeLeft", cmp: "lt", value: 100 }, s, 0)).toBe(true);
    expect(conditionHolds({ type: "auraLeft", cmp: "lt", value: 2 }, s, 0)).toBe(true);
    expect(conditionHolds({ type: "auraLeft", cmp: "gte", value: 0.1 }, s, 1)).toBe(false);
    expect(conditionHolds({ type: "aura", ref: "Flurry", active: true }, s, 0)).toBe(true);
    expect(conditionHolds({ type: "aura", ref: "Clearcasting", active: false }, s, 0)).toBe(true);
    expect(conditionHolds({ type: "cooldown", ref: "Bloodthirst", ready: true }, s, 0)).toBe(true);
    expect(conditionHolds({ type: "cooldown", ref: "Whirlwind", ready: false }, s, 0)).toBe(true);
  });
  it("mana resource conditions are in % of maximum mana", () => {
    const s = state({ power: "mana", resource: 1000, maxMana: 5000 });
    expect(conditionHolds({ type: "resource", cmp: "lt", value: 20.1 }, s, 0)).toBe(true);
    expect(conditionHolds({ type: "resource", cmp: "lt", value: 20 }, s, 0)).toBe(false);
  });
  it("all conditions must hold; execute-only abilities need target health < 20%", () => {
    const e: RotationEntry = {
      ability: "Whirlwind",
      kind: "cooldown",
      conditions: [
        { type: "resource", cmp: "gte", value: 25 },
        { type: "aura", ref: "Flurry", active: true },
      ],
    };
    expect(conditionsHold(e, state(), 2)).toBe(true);
    expect(conditionsHold(e, state({ resource: 10 }), 2)).toBe(false);
    const ex: RotationEntry = { ability: "Execute", kind: "cooldown" };
    expect(conditionsHold(ex, state(), 0)).toBe(false);
    expect(conditionsHold(ex, state({ targetHpPct: 19.9 }), 0)).toBe(true);
  });
  it("simulation-only entries for the analytical model", () => {
    expect(simOnlyReason({ ability: "Death Wish", kind: "burst" })).toBe("cooldown buff: simulation only");
    expect(simOnlyReason({ ability: "Execute", kind: "cooldown" })).toBe("execute phase: simulation only");
    expect(
      simOnlyReason({
        ability: "Fireball",
        kind: "filler",
        conditions: [{ type: "targetHp", cmp: "lt", value: 20 }],
      }),
    ).toBe('condition "Target health < 20%": simulation only');
    expect(
      simOnlyReason({
        ability: "Heroic Strike",
        kind: "nextSwing",
        conditions: [{ type: "resource", cmp: "gte", value: 50 }],
      }),
    ).toBeNull();
  });
  it("describeCondition and enabledRotation", () => {
    expect(describeCondition({ type: "resource", cmp: "gte", value: 50 }, "rage")).toBe("Rage ≥ 50");
    expect(describeCondition({ type: "resource", cmp: "lt", value: 20 }, "mana")).toBe("Mana < 20%");
    expect(describeCondition({ type: "cooldown", ref: "Mind Blast", ready: false }, null)).toBe(
      "Mind Blast on cooldown",
    );
    const r = rotations.rotations.find((x) => x.id === "warrior-fury")!;
    const off: SpecRotation = { ...r, entries: r.entries.map((e, i) => (i === 0 ? { ...e, off: true } : e)) };
    expect(enabledRotation(off).entries.map((e) => e.ability)).toEqual(
      r.entries.slice(1).map((e) => e.ability),
    );
    expect(enabledRotation(r)).toBe(r);
  });
});

describe("ability catalog", () => {
  const cat = (t: "warrior" | "mage" | "rogue") =>
    abilityCatalog(
      spellFile(t),
      [...treeFor(t).nodes.values()].map((n) => n.talent),
      rotations,
      t,
    );
  it("unique stable ids; default entries come from the default rotations", () => {
    for (const t of ["warrior", "mage", "rogue"] as const) {
      const c = cat(t);
      expect(new Set(c.map((a) => a.id)).size).toBe(c.length);
    }
    const w = cat("warrior");
    expect(w.find((a) => a.name === "Heroic Strike")!.entry).toEqual({
      ability: "Heroic Strike",
      kind: "nextSwing",
      conditions: [{ type: "resource", cmp: "gte", value: 50 }],
    });
    expect(w.find((a) => a.name === "Death Wish")).toMatchObject({ id: 12328, talent: "Death Wish" });
    expect(w.find((a) => a.name === "Rend")!.entry).toEqual({ ability: "Rend", kind: "dot" });
    expect(w.find((a) => a.name === "Execute")!.id).toBe(5308);
    expect(cat("rogue").find((a) => a.name === "Slice and Dice")!.entry).toMatchObject({ buff: true, cp: 5 });
    expect(cat("mage").find((a) => a.name === "Scorch")!.entry).toMatchObject({
      requiresTalent: "Improved Scorch",
    });
  });
});
```

### 8.3 Simulator: determinism, cross-check, mechanics: `src/engine/sim/sim.test.ts` (exact)

Cross-check builds (unlimited mana, 1000 iterations x 180 s, seed 1, boss target). Measured in the prototype:

| Case | Analytical | Simulation | Delta |
|---|---|---|---|
| C1 Frostbolt, +500 SP (G14) | 233.16 | 229.67 | -1.50% (the last 3 s cast of the fight does not finish) |
| C2 SW:P, Mind Blast, Smite, +300 | 207.47 | 201.72 | -2.77% (Mind Blast drifts behind 2-2.5 s casts) |
| C3 Heroic Strike on next swing, Reaper (G13) | 45.20 | 45.42 | +0.49% |
| C4 Retribution 31 points: SoC procs, Holy Strike, Judgement | 113.74 | 115.28 | +1.36% |
| C5 Destruction maxed, +300 | 274.40 | 273.69 | -0.26% |
| C6 Balance maxed, +300 | 310.92 | 308.99 | -0.62% |
| C7 Feral cat maxed (energy, combo points, Rip) | 117.91 | 117.70 | -0.18% |
| C8 Subtlety maxed (SnD, Hemorrhage, Eviscerate) | 80.48 | 81.15 | +0.83% |

Mechanics measured: Flurry raises Fury main-hand swings from 72 (weapon speed) to 78.5 per fight; Seal of Command
18.13 procs vs 18.16 expected; Windfury 16.49 extra attacks vs 16.45; rolling Ignite 1353 vs 1394 expected (-2.9%: burns
still ticking at the end are lost); Mind Flay 2.31 ticks per cast (clipped); MM Auto Shot 48 shots with 13 Aimed Shots.

`src/engine/sim/sim.test.ts` (exact):

```ts
import { describe, expect, it } from "vitest";
import type { ClassToken, RotationEntry } from "@/data/types";
import { runDamage } from "@/testkit/damage";
import { simInput, type SimScenario } from "@/testkit/sim";
import { ammo, weapon } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import { DEFAULT_SIM_CONFIG, type SimConfig } from "./types";
import { Fight } from "./engine";
import { buildModel } from "./model";
import { createRng, iterationSeed } from "./rng";
import { runSim, summarize } from "./run";

const REAPER = { mainHand: weapon(12784) };
const DUAL = { mainHand: weapon(18832), offHand: weapon(19352) };
const cfg = (patch: Partial<SimConfig> = {}): SimConfig => ({ ...DEFAULT_SIM_CONFIG, ...patch });
/** Every talent of one spec at max rank (like rotation.test.ts). */
function maxed(token: ClassToken, spec: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of treeFor(token).nodes.values())
    if (n.specIndex === spec) out[n.talent.name] = n.talent.maxRank;
  return out;
}
const sim = (s: SimScenario, c: Partial<SimConfig> = {}) => runSim(simInput(s), cfg(c));
const source = (r: ReturnType<typeof runSim>, key: string) => {
  const s = r.sources.find((x) => x.key === key);
  if (!s) throw new Error(`no source ${key}: ${r.sources.map((x) => x.key).join(", ")}`);
  return s;
};

describe("statistics", () => {
  it("summarize: mean, sample stdev, 95% CI, min, max", () => {
    const s = summarize([1, 2, 3, 4]);
    expect(s.mean).toBe(2.5);
    expect(s.stdev).toBeCloseTo(1.2909944487358056, 12);
    expect(s.ci95[0]).toBeCloseTo(2.5 - (1.96 * 1.2909944487358056) / 2, 12);
    expect([s.min, s.max]).toEqual([1, 4]);
    expect(summarize([7]).stdev).toBe(0);
  });
});

describe("determinism", () => {
  const s: SimScenario = {
    classToken: "warrior",
    race: "HUMAN",
    weapons: DUAL,
    talents: maxed("warrior", 1),
    rotation: "warrior-fury",
  };
  it("same seed: identical result and combat log; another seed differs", () => {
    const a = sim(s, { iterations: 50, seed: 7 });
    const b = sim(s, { iterations: 50, seed: 7 });
    expect({ ...a, elapsedMs: 0 }).toEqual({ ...b, elapsedMs: 0 });
    expect(sim(s, { iterations: 50, seed: 8 }).dps.mean).not.toBe(a.dps.mean);
  });
  it("iteration i uses iterationSeed(seed, i): results do not depend on batching", () => {
    const input = simInput(s);
    const config = cfg({ iterations: 10, seed: 3 });
    const model = buildModel(input);
    const dps = Array.from({ length: 10 }, (_, i) => {
      const f = new Fight(model, config, createRng(iterationSeed(3, i)), new Map(), null);
      return f.run().damage / config.fightSec;
    });
    expect(runSim(input, config).dps).toEqual(summarize(dps));
  });
});

/**
 * Builds where the analytical model and the simulation must agree within 3% (section 8.3): no execute phase, no
 * cooldown buffs, unlimited mana, 1000 iterations of 180 s.
 */
const ENTRIES = {
  frost: [{ ability: "Frostbolt", kind: "filler" }],
  priest: [
    { ability: "Shadow Word: Pain", kind: "dot" },
    { ability: "Mind Blast", kind: "cooldown" },
    { ability: "Smite", kind: "filler" },
  ],
  ret: [
    { ability: "Holy Strike", kind: "cooldown" },
    { ability: "Judgement", kind: "cooldown" },
  ],
  destruction: [
    { ability: "Immolate", kind: "dot" },
    { ability: "Conflagrate", kind: "cooldown", requires: "Immolate" },
    { ability: "Incinerate", kind: "filler" },
  ],
  balance: [
    { ability: "Moonfire", kind: "dot" },
    { ability: "Insect Swarm", kind: "dot" },
    { ability: "Starfire", kind: "filler" },
  ],
  feral: [
    { ability: "Rip", kind: "finisher", cp: 5 },
    { ability: "Shred", kind: "builder" },
    { ability: "Ferocious Bite", kind: "finisher", cp: 5 },
  ],
  subtlety: [
    { ability: "Slice and Dice", kind: "finisher", cp: 5, buff: true },
    { ability: "Hemorrhage", kind: "builder" },
    { ability: "Eviscerate", kind: "finisher", cp: 5 },
  ],
} satisfies Record<string, RotationEntry[]>;
const CROSS_CHECK: [string, SimScenario][] = [
  [
    "C1 Frostbolt, +500 spell power (G14)",
    {
      classToken: "mage",
      race: "HUMAN",
      bonus: { spellPower: 500 },
      rotation: "mage-frost",
      entries: ENTRIES.frost,
    },
  ],
  [
    "C2 priest SW:P, Mind Blast, Smite, +300",
    {
      classToken: "priest",
      race: "HUMAN",
      bonus: { spellPower: 300 },
      rotation: "priest-discipline",
      entries: ENTRIES.priest,
    },
  ],
  [
    "C3 warrior Heroic Strike on next swing, Arcanite Reaper (G13)",
    { classToken: "warrior", race: "HUMAN", weapons: REAPER, rotation: "warrior-protection" },
  ],
  [
    "C4 Retribution: Seal of Command procs, Holy Strike, Judgement",
    {
      classToken: "paladin",
      race: "HUMAN",
      weapons: REAPER,
      talents: maxed("paladin", 2),
      rotation: "paladin-retribution",
      entries: ENTRIES.ret,
    },
  ],
  [
    "C5 Destruction 5/5 talents, +300",
    {
      classToken: "warlock",
      race: "HUMAN",
      bonus: { spellPower: 300 },
      talents: maxed("warlock", 2),
      rotation: "warlock-destruction",
      entries: ENTRIES.destruction,
    },
  ],
  [
    "C6 Balance, +300",
    {
      classToken: "druid",
      race: "TAUREN",
      bonus: { spellPower: 300 },
      talents: maxed("druid", 0),
      rotation: "druid-balance",
      entries: ENTRIES.balance,
    },
  ],
  [
    "C7 Feral cat: energy and combo points",
    {
      classToken: "druid",
      race: "TAUREN",
      talents: maxed("druid", 1),
      rotation: "druid-feral",
      entries: ENTRIES.feral,
    },
  ],
  [
    "C8 Subtlety: Slice and Dice, Hemorrhage, Eviscerate",
    {
      classToken: "rogue",
      race: "HUMAN",
      weapons: DUAL,
      talents: maxed("rogue", 2),
      rotation: "rogue-subtlety",
      entries: ENTRIES.subtlety,
    },
  ],
];

describe("cross-check: analytical vs simulation within 3%", () => {
  for (const [name, s] of CROSS_CHECK)
    it(name, () => {
      const r = sim(s, { iterations: 1000, unlimitedMana: true });
      const analytical = runDamage(s).result.rotation.dps;
      expect(Math.abs(r.dps.mean / analytical - 1)).toBeLessThan(0.03);
    });
});

const FURY: SimScenario = {
  classToken: "warrior",
  race: "HUMAN",
  weapons: DUAL,
  talents: maxed("warrior", 1),
  rotation: "warrior-fury",
};
describe("mechanics (section 4.4)", () => {
  it("execute phase: Execute and Recklessness only below 20% target health; Death Wish on cooldown", () => {
    const r = sim(FURY, { iterations: 1, logLimit: 100000 });
    const casts = (name: string) =>
      r.log.filter((l) => l.source === name && l.outcome === "cast").map((l) => l.t);
    expect(casts("Execute").length).toBeGreaterThan(0);
    expect(Math.min(...casts("Execute"))).toBeGreaterThanOrEqual(0.8 * 180);
    expect(casts("Recklessness")).toHaveLength(1);
    expect(casts("Recklessness")[0]).toBeGreaterThanOrEqual(0.8 * 180);
    const long = sim(FURY, { iterations: 1, fightSec: 400, logLimit: 100000 });
    expect(long.log.filter((l) => l.source === "Death Wish" && l.outcome === "cast")).toHaveLength(3);
  });
  it("Flurry hastes white swings beyond the weapon speed", () => {
    const r = sim(FURY, { iterations: 200 });
    const model = buildModel(simInput(FURY));
    const speed = model.state([]).white.mainHand!.speed;
    const swings = source(r, "Main-hand melee").casts;
    expect(swings).toBeGreaterThan((180 / speed) * 1.05);
  });
  it("rage stays within 0..100; energy within 0..100", () => {
    for (const s of [FURY, CROSS_CHECK[7]![1]]) {
      const r = sim(s, { iterations: 1 });
      for (const [, v] of r.timeline!.points) expect(v >= 0 && v <= 100).toBe(true);
    }
  });
  it("Seal of Command: 7 procs per minute of landed main-hand swings", () => {
    const s = CROSS_CHECK[3]![1];
    const r = sim(s, { iterations: 500 });
    const mh = source(r, "Main-hand melee");
    const procs = source(r, "Seal of Command (proc)").casts;
    const expected = (mh.hits * 7 * 3.8) / 60; // Arcanite Reaper 3.8 s
    expect(procs / expected).toBeCloseTo(1, 1);
  });
  it("Windfury Weapon: 20% of landed main-hand swings grant 2 attacks", () => {
    const r = sim(
      { classToken: "shaman", race: "ORC", weapons: REAPER, rotation: "shaman-enhancement" },
      { iterations: 500 },
    );
    const wf = source(r, "Windfury Weapon").casts;
    const mh = source(r, "Main-hand melee").hits;
    expect(wf / (mh * 0.2 * 2)).toBeCloseTo(1, 1);
  });
  it("rolling Ignite matches the Phase 4 expected burn per cast", () => {
    const s: SimScenario = {
      classToken: "mage",
      race: "HUMAN",
      bonus: { spellPower: 500, spellCrit: 20 },
      talents: { Ignite: 5 },
      rotation: "mage-fire",
      entries: [{ ability: "Fireball", kind: "filler" }],
    };
    const r = sim(s, { iterations: 500 });
    const a = runDamage(s).ability("Fireball");
    const expected = a.extras.find((x) => x.label === "Ignite 5/5")!.value * source(r, "Fireball").casts;
    const ignite = source(r, "Ignite").damage;
    expect(ignite / expected).toBeGreaterThan(0.9); // burns still ticking at the end of the fight are lost
    expect(ignite / expected).toBeLessThan(1.01);
  });
  it("Clearcasting procs and is used; Nightfall gives Shadow Trance", () => {
    const arcane = sim(
      { classToken: "mage", race: "HUMAN", talents: maxed("mage", 0), rotation: "mage-arcane" },
      { iterations: 1, logLimit: 100000 },
    );
    expect(arcane.log.some((l) => l.source === "Clearcasting" && l.outcome === "buff")).toBe(true);
    expect(arcane.log.some((l) => l.source === "Clearcasting" && l.outcome === "fade")).toBe(true);
    const aff = sim(
      { classToken: "warlock", race: "HUMAN", talents: maxed("warlock", 0), rotation: "warlock-affliction" },
      { iterations: 1, logLimit: 100000 },
    );
    expect(aff.log.some((l) => l.source === "Shadow Trance" && l.outcome === "buff")).toBe(true);
  });
  it("mana: out of mana without regeneration gear; Evocation refills; unlimited mana never waits", () => {
    const s: SimScenario = {
      classToken: "mage",
      race: "HUMAN",
      bonus: { spellPower: 300 },
      rotation: "mage-frost",
    };
    const r = sim(s, { iterations: 20, unlimitedMana: false, logLimit: 100000 });
    expect(r.oomSec).toBeGreaterThan(10);
    expect(r.log.some((l) => l.source === "Evocation" && l.outcome === "cast")).toBe(true);
    for (const [, v] of r.timeline!.points) expect(v).toBeGreaterThanOrEqual(0);
    expect(sim(s, { iterations: 20 }).oomSec).toBe(0);
    const m = buildModel(simInput(s));
    expect(m.spiritRegenPerSec).toBeCloseTo((12.5 + m.prepared.stats.primary.spi.value / 4) / 2, 10);
  });
  it("channels are clipped for a higher-priority cast (Mind Flay for Mind Blast)", () => {
    const r = sim(
      {
        classToken: "priest",
        race: "HUMAN",
        bonus: { spellPower: 300 },
        talents: maxed("priest", 2),
        rotation: "priest-shadow",
      },
      { iterations: 200 },
    );
    const mf = source(r, "Mind Flay");
    expect(mf.ticks / mf.casts).toBeLessThan(3);
    expect(mf.ticks / mf.casts).toBeGreaterThan(2);
  });
  it("a ranged cast restarts the Auto Shot timer", () => {
    const s: SimScenario = {
      classToken: "hunter",
      race: "DWARF",
      weapons: { ranged: weapon(18713), ammo: ammo(18042) },
      rotation: "hunter-marksmanship",
      entries: [{ ability: "Aimed Shot", kind: "cooldown" }],
    };
    const r = sim(s, { iterations: 50 });
    const shots = source(r, "Auto Shot").casts;
    const aimed = source(r, "Aimed Shot").casts;
    expect(shots).toBeLessThan(180 / 2.9 - aimed * 0.5);
  });
});
```

### 8.4 URL: `src/state/rotation.test.ts` (exact) and the independent Python encoder

Golden vectors:

- `#v2.warrior.60.0..BgEB` — warrior, no talents, rotation "based on Fury" with its default entries.
- `#v2.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N.BhMCk16XAQEAyAF0A9gQgAEBBMgBBwasAtAPKgA` — Mage Fire 33 / Frost 18 (the
  Phase 2 golden talents), Frost rotation edited (Evocation switched off, Fire Blast with "target health < 20%"
  appended), simulation 300 s x 2000, seed 42, mana modeled.

Both strings were produced by this script, which reads ability ids from the data files and shares no code with
`src/state` (`python3 -I url_golden.py <repo root>`):

```python
"""Independent encoder for the Phase 5 URL records (docs/phase5-implementation-plan.md section 5.2).
Reads ability ids from data/generated/<build>/spells/<class>.json; shares no code with src/state."""
import json, sys
ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
GEN = f"{ROOT}/data/generated/1.60.1.70888"
A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

def b64(bs):
    out, i = "", 0
    while i < len(bs):
        chunk = bs[i:i + 3]; n = len(chunk)
        v = int.from_bytes(bytes(chunk) + b"\0" * (3 - n), "big")
        out += "".join(A[(v >> s) & 63] for s in (18, 12, 6, 0))[: n + 1]
        i += 3
    return out

def varint(v):
    out = []
    while v >= 0x80:
        out.append((v & 0x7F) | 0x80); v >>= 7
    out.append(v)
    return out

def chain_id(token, name):
    d = json.load(open(f"{GEN}/spells/{token}.json"))
    c = [x for x in d["abilities"] if x["name"] == name]
    if c: return c[0]["ranks"][0]
    t = json.load(open(f"{GEN}/talents/{token}.json"))
    return [x["spellId"] for s in t["specs"] for x in s["talents"] if x["name"] == name][0]

KINDS = ["cooldown", "dot", "maintain", "filler", "builder", "finisher", "nextSwing", "burst"]
CTYPES = ["resource", "comboPoints", "targetHp", "timeLeft", "auraLeft", "aura", "cooldown"]

def entry(token, ability, kind, off=False, conds=()):
    head = KINDS.index(kind) + (16 if off else 0) + (128 if conds else 0)
    out = varint(chain_id(token, ability)) + varint(head)
    if conds:
        out += varint(len(conds))
        for ctype, gte, value in conds:  # value types: tenths
            out += varint(CTYPES.index(ctype) * 2 + (1 if gte else 0)) + varint(round(value * 10))
    return out

def record(tag, body): return varint(tag) + varint(len(body)) + body

# G1: warrior, no talents, default character, base rotation = Fury (spec 1), default entries
g1 = "#v2.warrior.60.0.." + b64(record(6, varint(1)))
# G2: mage Fire 33 / Frost 18 (MAGE_51 talent payload from Phase 2), Frost rotation edited, sim 300 s x 2000, seed 42, mana on
rot = varint(2) + entry("mage", "Evocation", "burst", off=True, conds=[("resource", False, 20)]) \
    + entry("mage", "Frostbolt", "filler") + entry("mage", "Fire Blast", "cooldown", conds=[("targetHp", False, 20)])
sim = varint(300) + varint(2000) + varint(42) + varint(0)
g2 = "#v2.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N." + b64(record(6, rot) + record(7, sim))
print(g1); print(g2)
```

`src/state/rotation.test.ts` (exact):

```ts
import { describe, expect, it } from "vitest";
import { isClassToken } from "@/data";
import type { SpecRotation } from "@/data/types";
import { spellFile } from "@/testkit/damage";
import { MAGE_51, treeFor } from "@/testkit/talents";
import { decodeBuild, encodeBuild } from "./buildCode";
import { DEFAULT_CHARACTER, decodeCharacterBytes, encodeCharacterBytes } from "./charCode";
import { catalogFor, codeToRotation, rotationToCode, specRotation, useRotation } from "./rotation";

const mageCatalog = catalogFor(spellFile("mage"), treeFor("mage"));
const frost = specRotation("mage", 2)!;
/** Frost edited: Evocation switched off, Fire Blast below 20% target health added after Frostbolt. */
const EDITED: SpecRotation = {
  ...frost,
  entries: [
    { ...frost.entries[0]!, off: true },
    frost.entries[1]!,
    { ability: "Fire Blast", kind: "cooldown", conditions: [{ type: "targetHp", cmp: "lt", value: 20 }] },
  ],
};
const SIM = { fightSec: 300, iterations: 2000, seed: 42, unlimitedMana: false };

describe("rotation URL record (tag 6) and sim settings (tag 7)", () => {
  it("golden vectors (verified with an independent Python encoder, section 8.4)", () => {
    const g1 = "#v2.warrior.60.0..BgEB";
    const g2 = "#v2.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N.BhMCk16XAQEAyAF0A9gQgAEBBMgBBwasAtAPKgA";
    const b1 = {
      classToken: "warrior" as const,
      level: 60,
      talentedRank: 0,
      ranks: {},
      character: { ...DEFAULT_CHARACTER, rotation: { spec: 1, entries: null } },
    };
    const code = rotationToCode(EDITED, mageCatalog);
    const b2 = {
      classToken: "mage" as const,
      level: 60,
      talentedRank: 0,
      ranks: MAGE_51,
      character: { ...DEFAULT_CHARACTER, rotation: code, sim: SIM },
    };
    expect(encodeBuild(b1)).toBe(g1);
    expect(encodeBuild(b2)).toBe(g2);
    expect(code).toEqual({
      spec: 2,
      entries: [
        {
          ability: 12051,
          kind: 7,
          off: true,
          cp: 0,
          everySec: 0,
          conditions: [{ type: 0, flag: false, value: 20 }],
        },
        { ability: 116, kind: 3, off: false, cp: 0, everySec: 0, conditions: [] },
        {
          ability: 2136,
          kind: 0,
          off: false,
          cp: 0,
          everySec: 0,
          conditions: [{ type: 2, flag: false, value: 20 }],
        },
      ],
    });
    const d = decodeBuild(g2, isClassToken);
    expect(d.ok && d.build.character.rotation).toEqual(code);
    expect(d.ok && d.build.character.sim).toEqual(SIM);
    expect(codeToRotation(code, "mage", mageCatalog)).toEqual({ rotation: EDITED, dropped: false });
  });
  it("old links decode unchanged; a default rotation and sim settings write nothing", () => {
    const v1 = "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N";
    const r = decodeBuild(v1, isClassToken);
    expect(r.ok && r.build.character).toEqual(DEFAULT_CHARACTER);
    expect(
      encodeCharacterBytes({
        ...DEFAULT_CHARACTER,
        sim: { ...SIM, fightSec: 180, iterations: 1000, seed: 1, unlimitedMana: true },
      }),
    ).toEqual([]);
    const g2 = "#v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8";
    const w = decodeBuild(g2, isClassToken);
    expect(w.ok && w.build.character.rotation).toBeUndefined();
  });
  it("round-trips options; rejects malformed records; drops unknown abilities", () => {
    const rogue = specRotation("rogue", 1)!;
    const cat = catalogFor(spellFile("rogue"), treeFor("rogue"));
    const edited: SpecRotation = {
      ...rogue,
      entries: [
        ...rogue.entries,
        {
          ability: "Rupture",
          kind: "finisher",
          cp: 4,
          conditions: [{ type: "aura", ref: "Slice and Dice", active: true }],
        },
        {
          ability: "Hemorrhage",
          kind: "maintain",
          everySec: 12.5,
          conditions: [
            { type: "cooldown", ref: "Shank", ready: false },
            { type: "aura", ref: "Flurry", active: false },
          ],
        },
      ],
    };
    const code = rotationToCode(edited, cat);
    const bytes = encodeCharacterBytes({ ...DEFAULT_CHARACTER, rotation: code });
    const back = decodeCharacterBytes(Uint8Array.from(bytes))!;
    expect(codeToRotation(back.rotation!, "rogue", cat)).toEqual({ rotation: edited, dropped: false });
    expect(decodeCharacterBytes(Uint8Array.from([6, 1, 3]))).toBeNull(); // spec 3
    expect(decodeCharacterBytes(Uint8Array.from([6, 2, 0, 116]))).toBeNull(); // entry without a head
    expect(decodeCharacterBytes(Uint8Array.from([7, 3, 1, 2, 3]))).toBeNull(); // sim needs 4 values
    const unknown = codeToRotation(
      { spec: 1, entries: [...code.entries!, { ...code.entries![0]!, ability: 999999 }] },
      "rogue",
      cat,
    );
    expect(unknown?.dropped).toBe(true);
    expect(unknown?.rotation.entries).toHaveLength(edited.entries.length);
  });
  it("store: applyCode, toCode, clamped sim settings", () => {
    const st = useRotation.getState();
    expect(
      st.applyCode(
        { ...DEFAULT_CHARACTER, rotation: rotationToCode(EDITED, mageCatalog), sim: SIM },
        "mage",
        mageCatalog,
      ),
    ).toBe(true);
    expect(useRotation.getState().custom).toEqual(EDITED);
    expect(useRotation.getState().toCode(mageCatalog)).toEqual({
      rotation: rotationToCode(EDITED, mageCatalog),
      sim: SIM,
    });
    useRotation.getState().setSim({ iterations: 1e9, fightSec: 1 });
    expect(useRotation.getState().sim).toMatchObject({ iterations: 10000, fightSec: 30 });
    useRotation.getState().reset();
    expect(useRotation.getState().custom).toBeNull();
    expect(st.applyCode({ ...DEFAULT_CHARACTER, sim: { ...SIM, fightSec: 5 } }, "mage", mageCatalog)).toBe(
      false,
    );
  });
});
```

### 8.5 Performance: `src/engine/sim/perf.test.ts` (exact)

Measured in Node (Vitest, single thread, after a 50-iteration warm-up): rogue-combat 466 ms, warrior-fury 271 ms,
mage-fire 105 ms for 1000 iterations x 180 s with raid buffs and a maxed spec. The budget is 2000 ms (4x headroom for
CI). The panel shows the elapsed time of every run (`SimResult.elapsedMs`).

`src/engine/sim/perf.test.ts` (exact):

```ts
import { describe, expect, it } from "vitest";
import type { ClassToken } from "@/data/types";
import { simInput, type SimScenario } from "@/testkit/sim";
import { buffs, weapon } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import { runSim } from "./run";
import { DEFAULT_SIM_CONFIG } from "./types";

function maxed(token: ClassToken, spec: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of treeFor(token).nodes.values())
    if (n.specIndex === spec) out[n.talent.name] = n.talent.maxRank;
  return out;
}
const RAID = [...buffs.presets.raidBuffs, ...buffs.presets.raidDebuffs];
const DUAL = { mainHand: weapon(18832), offHand: weapon(19352) };
/** The heaviest event loads: dual-wield melee with procs, energy, a caster with procs and DoTs. */
const CASES: [string, SimScenario][] = [
  [
    "rogue-combat",
    {
      classToken: "rogue",
      race: "HUMAN",
      weapons: DUAL,
      talents: maxed("rogue", 1),
      rotation: "rogue-combat",
    },
  ],
  [
    "warrior-fury",
    {
      classToken: "warrior",
      race: "HUMAN",
      weapons: DUAL,
      talents: maxed("warrior", 1),
      rotation: "warrior-fury",
    },
  ],
  [
    "mage-fire",
    {
      classToken: "mage",
      race: "HUMAN",
      bonus: { spellPower: 300 },
      talents: maxed("mage", 1),
      rotation: "mage-fire",
    },
  ],
];

describe("simulation performance budget (section 8.5)", () => {
  for (const [name, s] of CASES)
    it(`${name}: 1000 iterations x 180 s under 2 s (Node, single thread)`, () => {
      const input = simInput({ ...s, buffIds: RAID });
      runSim(input, { ...DEFAULT_SIM_CONFIG, iterations: 50 }); // warm-up (JIT)
      const t0 = performance.now();
      const r = runSim(input, { ...DEFAULT_SIM_CONFIG, iterations: 1000 });
      const ms = performance.now() - t0;
      console.log(`${name}: ${ms.toFixed(0)} ms for 1000 x 180 s (${r.dps.mean.toFixed(1)} DPS)`);
      expect(ms).toBeLessThan(2000);
    });
});
```

### 8.6 State: worker client and derive

`src/state/sim.test.ts` (exact):

```ts
import { describe, expect, it } from "vitest";
import type { SimRequest, SimResponse, SimResult } from "@/engine/sim/types";
import { DEFAULT_SIM_CONFIG } from "@/engine/sim/types";
import { simInput } from "@/testkit/sim";
import { setSimWorkerFactory, useSim, type SimWorker } from "./sim";

class FakeWorker implements SimWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<SimResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: SimRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(m: SimRequest) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(m: SimResponse) {
    this.onmessage?.({ data: m } as MessageEvent<SimResponse>);
  }
}

describe("simulation client (worker protocol, section 4.7)", () => {
  setSimWorkerFactory(() => new FakeWorker());
  const input = simInput({ classToken: "mage", race: "HUMAN", rotation: "mage-frost" });
  const config = { ...DEFAULT_SIM_CONFIG, iterations: 100 };
  it("progress, then result; the worker is terminated", () => {
    useSim.getState().run(input, config, "k1");
    const w = FakeWorker.all.at(-1)!;
    const id = w.sent[0]!.id;
    expect(useSim.getState()).toMatchObject({ status: "running", done: 0, total: 100 });
    w.reply({ type: "progress", id, done: 50, total: 100 });
    expect(useSim.getState().done).toBe(50);
    const result = { config } as SimResult;
    w.reply({ type: "result", id, result });
    expect(useSim.getState()).toMatchObject({ status: "done", result, key: "k1" });
    expect(w.terminated).toBe(true);
  });
  it("cancel terminates the worker and ignores late messages; a new run replaces the old one", () => {
    useSim.getState().run(input, config, "k2");
    const w = FakeWorker.all.at(-1)!;
    useSim.getState().cancel();
    expect(w.terminated).toBe(true);
    w.reply({ type: "result", id: w.sent[0]!.id, result: { config } as SimResult });
    expect(useSim.getState()).toMatchObject({ status: "cancelled", key: "k1" });
    useSim.getState().run(input, config, "k3");
    const a = FakeWorker.all.at(-1)!;
    useSim.getState().run(input, config, "k4");
    expect(a.terminated).toBe(true);
    const b = FakeWorker.all.at(-1)!;
    b.reply({ type: "error", id: b.sent[0]!.id, message: "boom" });
    expect(useSim.getState()).toMatchObject({ status: "error", error: "boom" });
  });
});
```

`src/state/derived.test.ts` (diff):

```diff
diff --git a/src/state/derived.test.ts b/src/state/derived.test.ts
index fd98449..c297fb3 100644
--- a/src/state/derived.test.ts
+++ b/src/state/derived.test.ts
@@ -5,7 +5,8 @@ import { weaponsFile } from "@/testkit/stats";
 import { spellFile } from "@/testkit/damage";
 import { EMPTY_BONUS } from "@/engine/stats";
 import { DEFAULT_CUSTOM, NO_WEAPON_IDS, sanitizeWeapons } from "./character";
-import { derive } from "./derived";
+import { derive, simInputFor } from "./derived";
+import { specRotation } from "./rotation";
 
 const ch = {
   raceId: 1,
@@ -81,4 +82,20 @@ describe("derive", () => {
       ammo: 0,
     });
   });
+  it("Phase 5: the editor's rotation drives the analytical DPS; simInputFor uses the same rotation", () => {
+    const calc = { tree: treeFor("mage"), ranks: {}, level: 60, spells: spellFile("mage") };
+    const frost = specRotation("mage", 2)!;
+    const d = derive(calc, ch, frost);
+    if (!d.ok || !d.damage) throw new Error("no damage");
+    expect(d.damage.rotation.id).toBe("mage-frost"); // no points: the default would be Arcane
+    const off = { ...frost, entries: frost.entries.map((e) => ({ ...e, off: true as const })) };
+    const none = derive(calc, ch, off);
+    expect(none.ok && none.damage?.result.rotation.dps).toBe(0);
+    const input = simInputFor(calc, ch, frost)!;
+    expect(input.rotation).toBe(frost);
+    expect(input.target).toMatchObject({ presetId: "boss", level: 63, armor: 3731 });
+    expect(simInputFor({ ...calc, spells: null }, ch, frost)).toBeNull();
+    const other = derive(calc, ch, specRotation("warrior", 1)!); // another class: ignored
+    expect(other.ok && other.damage?.rotation.class).toBe("mage");
+  });
 });
```

### 8.7 Playwright

`e2e/sim.spec.ts` (exact): editor add / reorder with buttons and drag-and-drop / condition / URL round-trip / reset;
run shows DPS within 3% of the analytical value for Frostbolt spam, breakdown, chart, log, determinism and the stale
note; cancel stops a 10000 x 900 s run.

`e2e/sim.spec.ts` (exact):

```ts
import { expect, test, type Page } from "@playwright/test";
import { blockRemoteImages, node, watchErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  await blockRemoteImages(page);
});

const entries = (page: Page) => page.getByTestId("rotation-list").locator(":scope > li");
const names = async (page: Page) =>
  (await entries(page).allInnerTexts()).map((t) => t.split("\n").find((l) => /[A-Za-z]{3}/.test(l)) ?? t);

async function frostMage(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  const ifb = node(page, "Improved Frostbolt");
  for (let i = 0; i < 5; i++) await ifb.click();
  await expect(page.getByTestId("dps-rotation")).toContainText("Frost: Frostbolt");
}

test("rotation editor: add, reorder (buttons and drag), condition, URL round-trip, reset", async ({
  page,
}) => {
  const w = watchErrors(page);
  await frostMage(page);
  await expect(page.getByTestId("rotation-entry-evocation")).toBeVisible();
  await expect(page.getByTestId("rotation-entry-frostbolt")).toBeVisible();
  await page.getByTestId("rotation-add").selectOption("Fire Blast");
  await page.getByTestId("rotation-add-button").click();
  await expect(page.getByTestId("rotation-edited")).toBeVisible();
  expect(await names(page)).toEqual(["Evocation", "Frostbolt", "Fire Blast"]);
  await page.getByRole("button", { name: "Move Fire Blast up" }).click();
  expect(await names(page)).toEqual(["Evocation", "Fire Blast", "Frostbolt"]);
  await page.getByTestId("rotation-entry-frostbolt").dragTo(page.getByTestId("rotation-entry-evocation"));
  expect(await names(page)).toEqual(["Frostbolt", "Evocation", "Fire Blast"]);
  await page.getByRole("button", { name: "Add a condition to Fire Blast" }).click();
  await page.getByRole("combobox", { name: "Condition type (Fire Blast 1)" }).selectOption("targetHp");
  await expect(page.getByTestId("dps-skipped")).toContainText("Fire Blast");
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#v2\.mage\.60\.0\./);
  const url = page.url();
  await page.goto("about:blank");
  await page.goto(url);
  await expect(page.getByTestId("rotation-edited")).toBeVisible();
  expect(await names(page)).toEqual(["Frostbolt", "Evocation", "Fire Blast"]);
  await expect(page.getByRole("combobox", { name: "Condition type (Fire Blast 1)" })).toHaveValue("targetHp");
  await page.getByTestId("rotation-reset").click();
  expect(await names(page)).toEqual(["Evocation", "Frostbolt"]);
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#v1\./);
  w.check();
});

test("simulation: run shows DPS, breakdown, resource chart and combat log", async ({ page }) => {
  const w = watchErrors(page);
  await frostMage(page);
  await page.getByTestId("sim-iterations").fill("200");
  await page.getByTestId("sim-run").click();
  await expect(page.getByTestId("sim-results")).toBeVisible();
  const dps = Number(await page.getByTestId("sim-dps").textContent());
  const analytical = Number(await page.getByTestId("dps-total").textContent());
  expect(Math.abs(dps / analytical - 1)).toBeLessThan(0.03); // Frostbolt spam, unlimited mana: section 8.3
  await expect(page.getByTestId("sim-row-frostbolt")).toBeVisible();
  await expect(page.getByTestId("sim-ci")).toContainText("95% CI");
  await expect(page.getByTestId("sim-resource-chart")).toBeVisible();
  await page.getByTestId("sim-log").locator("summary").click();
  await expect(page.getByTestId("sim-log")).toContainText("Frostbolt");
  // the same seed gives the same result
  await page.getByTestId("sim-run").click();
  await expect(page.getByTestId("sim-dps")).toHaveText(String(dps.toFixed(1)));
  // a talent change marks the result stale; the analytical DPS stays live
  await node(page, "Ice Shards").click();
  await expect(page.getByTestId("sim-stale")).toBeVisible();
  w.check();
});

test("simulation: cancel stops a long run", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Warrior", exact: true }).click();
  await page.getByTestId("weapon-mainHand").fill("Arcanite Reaper");
  await page.locator('[role=option][data-item-id="12784"]').click();
  await page.getByTestId("sim-fight").fill("900");
  await page.getByTestId("sim-iterations").fill("10000");
  await page.getByTestId("sim-run").click();
  await expect(page.getByTestId("sim-progress")).toBeVisible();
  await page.getByTestId("sim-cancel").click();
  await expect(page.getByTestId("sim-cancelled")).toBeVisible();
  await expect(page.getByTestId("sim-run")).toBeEnabled();
  await expect(page.getByTestId("sim-results")).toHaveCount(0);
  w.check();
});
```

`e2e/mobile.spec.ts` (diff):

```diff
diff --git a/e2e/mobile.spec.ts b/e2e/mobile.spec.ts
index 4532d7e..caf9f21 100644
--- a/e2e/mobile.spec.ts
+++ b/e2e/mobile.spec.ts
@@ -41,3 +41,15 @@ test("mobile: Damage tab shows the damage panel", async ({ page }) => {
   await expect(page.getByTestId("damage-panel")).toBeVisible();
   await expect(page.getByTestId("dps-total")).not.toHaveText("");
 });
+
+test("mobile: Sim tab shows the rotation editor and runs the simulation", async ({ page }) => {
+  await blockRemoteImages(page);
+  await page.goto("./");
+  await page.getByRole("button", { name: "Mage", exact: true }).click();
+  await page.getByRole("tab", { name: "Sim" }).click();
+  await expect(page.getByTestId("rotation-editor")).toBeVisible();
+  await page.getByTestId("sim-iterations").fill("100");
+  await page.getByTestId("sim-run").click();
+  await expect(page.getByTestId("sim-dps")).not.toHaveText("");
+  expect(await page.evaluate<number>("document.documentElement.scrollWidth")).toBeLessThanOrEqual(393);
+});
```

---

## 9. Expected divergences: simulation vs analytical (every default rotation)

Prototype run: every spec's talents at max rank, +300 spell power, the Phase 4 test weapons (Brutality Blade + Chromatically
Tempered Sword for warriors/rogues, Arcanite Reaper for paladins/shamans, Rhok'delar + Thorium Headed Arrow for
hunters), boss, unlimited mana, 1000 iterations x 180 s.

| Rotation | Analytical | Simulation | Delta | Why |
|---|---|---|---|---|
| warrior-arms | 58.7 | 74.4 ± 6.8 | +26.7% | Execute, Recklessness, Bloodrage (simulation only); rage-limited priority |
| warrior-fury | 70.1 | 111.7 ± 9.9 | +59.4% | Death Wish, Recklessness, Execute, Bloodrage (simulation only) |
| warrior-protection | 55.2 | 55.3 ± 4.2 | +0.2% | — |
| paladin-holy | 62.7 | 63.1 ± 3.6 | +0.7% | — |
| paladin-protection | 77.9 | 79.5 ± 4.2 | +2.1% | — |
| paladin-retribution | 137.8 | 139.6 ± 9.9 | +1.3% | — |
| hunter-beast-mastery | 179.8 | 166.2 ± 4.4 | −7.5% | Aimed Shot restarts Auto Shot (Q63); Rapid Fire partly offsets |
| hunter-marksmanship | 284.6 | 257.7 ± 10.8 | −9.4% | same; shared category cooldown drift |
| hunter-survival | 187.9 | 172.6 ± 3.9 | −8.2% | same |
| rogue-assassination | 90.2 | 92.7 ± 6.4 | +2.8% | Cold Blood |
| rogue-combat | 123.1 | 141.8 ± 8.5 | +15.2% | analytical buys no Eviscerate (Phase 4 energy model); Blade Flurry, Adrenaline Rush |
| rogue-subtlety | 80.5 | 81.1 ± 4.9 | +0.8% | — |
| priest-discipline | 210.2 | 204.6 ± 8.4 | −2.6% | Mind Blast drifts behind Smite casts; Inner Focus |
| priest-holy | 244.0 | 235.5 ± 11.0 | −3.5% | cooldown drift behind 3.5 s Holy Fire / Smite casts |
| priest-shadow | 379.3 | 369.7 ± 17.1 | −2.5% | Mind Blast drift (Mind Flay is clipped after a tick) |
| shaman-elemental | 354.6 | 352.3 ± 16.7 | −0.7% | — |
| shaman-enhancement | 163.0 | 169.9 ± 11.0 | +4.2% | Flurry and Windfury sampled (Flurry chains with Windfury crits) |
| shaman-restoration | 226.8 | 222.0 ± 9.3 | −2.1% | — |
| mage-arcane | 247.2 | 257.8 ± 15.9 | +4.3% | Arcane Power, Presence of Mind (simulation only) |
| mage-fire | 324.4 | 321.3 ± 19.8 | −0.9% | Fire Blast drift −, Combustion + |
| mage-frost | 248.6 | 245.3 ± 11.4 | −1.3% | last cast unfinished |
| warlock-affliction | 245.6 | 242.0 ± 8.5 | −1.5% | — |
| warlock-demonology | 191.9 | 193.0 ± 9.0 | +0.6% | — |
| warlock-destruction | 274.4 | 273.7 ± 13.8 | −0.3% | — |
| druid-balance | 310.9 | 309.0 ± 16.1 | −0.6% | — |
| druid-feral | 117.9 | 117.7 ± 8.1 | −0.2% | — |
| druid-restoration | 144.8 | 145.0 ± 5.8 | +0.1% | — |

Rules of thumb for users and testers (also in CALC_MODEL section 6):
- Within ~3%: filler casters, DoT rotations, rogue Subtlety/Assassination, feral, ret, basic warrior.
- Simulation higher: burst cooldowns and the execute phase (warriors +27%/+59%, arcane +4%), Combat rogue (+15%: the
  analytical energy model spends all energy on Slice and Dice cycles and buys no Eviscerate).
- Simulation lower: hunters (-8% to -9%: Aimed Shot restarts the Auto Shot timer; the analytical model only removes the
  cast time), cooldowns that drift behind long casts (Mind Blast, Fire Blast), the unfinished last cast.
- With mana modeled (toggle off), every caster without gear mana goes out of mana (expected; gear v2 is Phase 7).

---

## 10. Ordered task list

Commit after each task (attribution lines per the session reminder). Keep `npm run format:check`, `npm run lint`,
`npm test`, `npm run typecheck` green from T3 on.

| Task | Work | Acceptance check |
|---|---|---|
| T1 | Read this document; create the branch work tree | — |
| T2 | Section 3: `rotations.json` diff | valid JSON; 27 rotations |
| T3 | Sections 4.1-4.2: types and Phase 4 hook diffs (incl. `rotation.test.ts`) | (compiles after T4: `analytical.ts` and `rotation/index.ts` import the new files) |
| T4 | Section 4.3: `conditions.ts`, `catalog.ts` | `npm run typecheck`; `npm test` 220 tests green (goldens unchanged) |
| T5 | Section 4.5: `types.ts`, `constants.ts`, `rng.ts`, `queue.ts`, `procs.ts`, `model.ts`, `engine.ts` | typecheck |
| T6 | Section 4.6: `run.ts`, `worker.ts`, `index.ts` | typecheck; `npm run build` shows a separate `worker-*.js` chunk |
| T7 | Section 5: `rotation.ts`, `charCode.ts`, `derived.ts`, `store.ts`, `urlSync.ts`, `useDerived.ts`, `sim.ts` | typecheck; `npm test` still 220 green; `charCode.ts` imports `engine/rotation/conditions` and `state/rotation.ts` imports `engine/sim/types` (both exist after T4/T5) |
| T8 | Section 6: editor, sim panel, CSS, `App.tsx` | `npm run build`; manual: Mage, 5 points in Improved Frostbolt, Run simulation shows ~229 DPS |
| T9 | Sections 7, 8.1-8.6: testkit diffs and new test files; run the two Python scripts once | `npm test`: 261 tests green; Python prints the goldens of 8.1/8.4 |
| T10 | Section 8.7: Playwright | `npm run e2e`: 28 tests green (desktop + mobile) |
| T11 | Lint/format sweep: `npm run lint`, `npm run format:check` | clean |
| T12 | Section 11 docs; screenshot `docs/screenshots/phase5-sim.png` (desktop, warrior with Arcanite Reaper, default Arms rotation, 300 iterations, results visible) | docs updated in the same commit as the last change or a final docs commit |

---

## 11. Documentation updates (task T12)

- **PLAN.md**: Phase 4 row status -> ✅ (the table still says ⬜); Phase 5 -> ✅ with these checkboxes ticked and reworded:
  "Rotation editor: priority list per spec with drag-and-drop and keyboard reorder, add/remove, on/off, type, conditions
  (resource, combo points, target health, time left, own DoT/buff left, aura, cooldown), Based on / Reset; URL tags 6/7
  in the v2 payload"; "Event-driven simulator in a Web Worker (plain postMessage): GCD, casts, channels (clipping), swing
  timers (MH/OH, Auto Shot reset), cooldown buffs, rage/energy/mana (five-second rule, Evocation), procs as RNG events
  (15 talents + Seal of Command + Windfury), DoT ticks, execute phase"; "Seeded RNG (sfc32), N iterations, fight length,
  execute phase (linear health)"; "Results: DPS mean ± stdev, 95% CI, min/max, breakdown table with share bars, casts
  per fight, resource graph, combat log"; "Cross-check analytical vs sim within 3% on 8 builds (C1-C8); divergences
  documented". Output line: "`src/engine/sim`, `src/engine/rotation/{conditions,catalog}`, `src/state/{rotation,sim}`,
  `src/ui/{rotation,sim}`, migrated `rotations.json`. 50 pipeline tests, 261 Vitest tests, 28 Playwright tests. Open
  items: Q59-Q68."
- **CALC_MODEL.md** section 6: replace the "Simulation (accurate)" paragraph and the Phase 4 approximations list with
  the section 4.4 summary (event loop, implicit kind rules, resources, procs sampled vs averaged, execute phase, Auto
  Shot reset, channel clipping, default unlimited mana and why) and the section 9 divergence rules of thumb; in the
  analytical paragraph add "entries with sim-only conditions, burst cooldowns and execute-only abilities are skipped
  ('simulation only')". Add the `[VERIFY]` constants of `sim/constants.ts` to section 3 or a new 6b table.
- **ARCHITECTURE.md**: Stack row "Simulation | Web Worker (plain postMessage, no library) | ..."; engine module list
  (section 2 of this document) and import direction; state: `useRotation`, `useSim`, `derive(..., custom)`,
  `simInputFor`; UI: `src/ui/rotation`, `src/ui/sim`; URL section: tags 6 and 7 with both golden vectors of 8.4;
  "Build URL format" rule 4 now holds (rotation in the URL).
- **OPEN_QUESTIONS.md**: add Q59-Q68 (section 12), status ❓; Q51 note "Phase 5 simulator uses the same formula per hit";
  Q54 note "sampled in Phase 5"; Q57 note "the simulator does not haste the GCD either".
- **README.md**: mention the Rotation editor and the Simulation panel (Run simulation, shareable rotation in the link).
- **CLAUDE.md** conventions: replace "Default rotations: `data/manual/rotations.json` (not user-editable until Phase 5;
  no URL change)" with "Default rotations: `data/manual/rotations.json`; the editor's rotation and sim settings are URL
  tags 6/7 of the v2 payload (`ENTRY_KINDS`, `PROC_AURAS`, `CONDITION_TYPES` are append-only)"; add "The simulator
  (`src/engine/sim`) never computes damage: it samples `AbilityResult.parts` and `WhiteResult` from the Phase 4
  evaluator; seeded RNG only (`iterationSeed`)."

---

## 12. Remaining uncertainties (add as Q59-Q68 to OPEN_QUESTIONS.md, status ❓)

| # | Question | Why it matters | How to resolve |
|---|---|---|---|
| Q59 | Mana regeneration in Forever: Classic Spirit formulas per class (`SPIRIT_REGEN`), 2 s ticks, five-second rule? Modern engines regenerate continuously and some have no five-second rule. No MP5 in gear v1 | Every caster's sim DPS with mana modeled | Mana bar over time while idle and after a cast |
| Q60 | Execute: extra rage converted at 15 damage per rage (Classic rank 5; Forever token `$*10;F1` unresolved)? Does Execute consume all rage? | Fury/Arms execute phase | Execute hits at known rage |
| Q61 | Proc details: rolling Ignite (4 s, 2 ticks, refresh adds), Deep Wounds refresh, Improved Shadow Bolt charges (Classic: 4 charges; sim: 12 s only), Shadow Trance 10 s, Flurry charges used by both hands | Fire, Fury, Affliction | Combat logs |
| Q62 | Clearcasting rules: Arcane Concentration on every landed damage spell, Elemental Focus on fire/frost/nature casts; charge buffs used by any cast matching their 107/108 masks (Presence of Mind is also used by an instant) | Arcane, Elemental, Cold Blood | Logs / tooltips |
| Q63 | Does a ranged cast (Aimed Shot) restart the Auto Shot timer, and does Auto Shot wait during casts? | Hunter DPS (-8% vs the analytical model) | Swing timer addon |
| Q64 | Haste changes mid-swing (sim: from the next swing), energy as continuous 10/s (Classic ticks 20 per 2 s), GCD not hasted (Q57) | Rogue/feral variance, haste value | In-game swing/energy timers |
| Q65 | Combustion: +10% Fire crit per Fire hit (every hit, crits included) until 3 crits; up to 10 stacks (`maxStacks` of 28682) | Fire burst | Logs |
| Q66 | Hammer of Wrath has `DefenseType` 3 (ranged): which attack table and crit bonus does it use without a ranged weapon? (Phase 4 requires a ranged weapon, so it is not in the Retribution default) | Ret execute phase | Hammer of Wrath hits in logs |
| Q67 | Power Infusion and other ally-target buffs (`targets [21, 0]`) are not applied when self-cast | Discipline/raid cooldowns | Self-cast test |
| Q68 | Simplifications to confirm: fights start at 0 rage with full energy/mana and no pre-pull; partial resists use the average factor (no 0/25/50/75% sampling); glancing blows use the average multiplier; target health falls linearly | Variance (stdev) more than mean | Logs; owner decision for a "pre-pull" option |

Also still relevant: Q47 (DoT ticks crit), Q51 (rage formula), Q53 (finisher AP), Q54 (SoC / Windfury), Q57 (haste on
GCD), Q5 (pets, Phase 6).
