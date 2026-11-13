# Phase 6 implementation plan: quick fixes L8–L10 and Pets

Audience: the agent that implements this phase. Follow this document literally. When it says "exactly", copy the value
or the code. When something here contradicts an older doc, this document wins, and task T12 updates the older doc.

Everything below was checked against `data/generated/1.60.1.70888/` and `data/raw/1.60.1.70888/` on 2026-11-13 and
implemented as a prototype in a scratch copy of the repo at commit `5c21d58` (branch `claude/stoic-allen-90bng2`).
Prototype results: pipeline tests **53** OK (50 + 3), `tsc -b` clean, `eslint .` clean, `prettier --check .` clean,
`vite build` OK (pet files are their own lazy chunks, 7–10 KB gzip), `vitest run` **287 tests** OK (261 + 26), Playwright
**31 tests** OK (28 + 3; pre-installed Chromium, `--trace off`).

**The code is in this document as unified diffs; copy them.** Part A (section 3) is one diff against `5c21d58`. Part B
(section 6) is eight diffs (B1–B8) against the tree *after* Part A. New files are "new file" hunks of the same diffs.
Every block was verified with `git apply --check` on a fresh clone of `5c21d58`, in the order A, B1, B2, B3, B4, B5, B8,
B6, B7; after applying them and regenerating the data (task T4) the tree is byte-identical to the prototype. Save a
block to a file and run `git apply <file>`. If a hunk does not apply because the branch moved, make the same change by
hand. Generated data is never hand-edited: `data/generated/**` comes only from the pipeline (task T4).

---

## 0. Key decisions (summary)

| Topic | Decision | Evidence |
|---|---|---|
| **L8 cause** | Not energy regeneration. Two finisher effects: (1) the analytical model gave buff/DoT finishers (Slice and Dice) a perfect refresh, but while the buff is up a lower finisher (Eviscerate) spends every 5-combo-point point, so the buff can only be renewed at the first finisher point *after* it falls off; (2) the simulator let a cheaper lower finisher (Eviscerate 20 energy, Improved Eviscerate) steal the combo points whenever Slice and Dice (25) was not yet affordable (energy at the decision was 20–30 in 98% of those cases). Without Slice and Dice both engines agree (-0.3%); without Shank (no Eviscerates) too (-0.7%). | Prototype measurements, section 2.1. |
| **L8 fix** | Analytical: a buff/DoT finisher with a lower-priority finisher below it is refreshed every `duration + cycle/2` (cycle = time to build and spend one finisher, energy- or GCD-limited) instead of every `duration`. Simulator: a finisher that is blocked **only by its resource** keeps the combo points (lower finishers are skipped until it is affordable). Both changes only touch the finisher logic; every other rotation is unchanged (section 9 table: 25 of 27 rows identical to Phase 5). | Combat analytical 123.1 → **134.4**, sim 141.8 → **134.9** (+0.4%; was +15.2%). Assassination -2.3%, Subtlety +0.8%, Feral -0.2%. Cross-check C9/C10 added. |
| **L9** | A ranged-type spell (`DefenseType` 3) needs a ranged weapon only if it deals weapon damage (effects 17/31/58/121) or has a `SpellEquippedItems` requirement (`weaponlessRanged`). Hammer of Wrath and Summon Hawk qualify: they roll on the ranged table if a ranged weapon is equipped, else on the main-hand table, with no dodge, crit bonus 100% (physical table), no weapon procs (`slot: null`). Melee-type spells are unchanged (all need a melee weapon). Hammer of Wrath is added at the top of the Retribution default (execute phase, simulation only). | G15 golden (Python): hit 583.8, land 92%, expected 550.79. Ret sim +16% in the execute phase (139.6 → 162.3). |
| **L10** | Aura effects with implicit target 21 (`TARGET_UNIT_TARGET_ALLY`) apply to the caster when the rotation casts the spell (`selfApplied`), in all three places that filtered to target 1: self-buff stats (`selfBuffEffects`), the simulator's stateful buffs (`isStateful`) and the catalog's burst detection. Only target 21 (not party/raid targets 56/153, so Battle Shout in a rotation never double-counts the raid buff). Power Infusion is added at the top of the Shadow default as a `burst` (Discipline talent: unavailable unless taken). New catalog entry: Innervate (druid). | Sim: PI cast at 0 s, +20% spell damage for 15 s (aura 79 misc 126); Shadow + PI talent +2% sim DPS. |
| **Pet data** | Forever's client data has a lot: each `CreatureFamily` skill line holds the pet's abilities, a **family passive** with the damage modifier (aura 79: Cat +10, Raptor +10, Bear -9, Boar -10 …), passives that **owner talents modify through spell masks** (Unleashed Fury op 3 → 8875 aura 79 +15%; Ferocity → 19591 aura 290 +10% crit; Bestial Discipline → 19589 aura 110 focus +20%; Frenzy op 18 → 20784 proc → 19615 +30% melee haste 8 s; Unholy Power op 8 → 18727–18730 aura 79 +10%; Improved Imp op 0 on Firebolt; Improved Sayaad on Lash of Pain) and the pet scaling auras **"Hunter Pet Scaling" 415429 / "Warlock Pet Scaling" 416189** (AP, spell damage, hit, crit, haste, resist, armor auras with base points 0: server-computed). New pipeline output `pets/<owner>.json` (pipeline v4). Base stats, focus and scaling coefficients are not in the data → `data/manual/pets.json` `[VERIFY]`. | Section 1. |
| **Which pets** | Owner = the class whose scaling aura is in the family's skill line; a demon also needs a `Summon <name>` warlock ability. Result: 19 hunter families (incl. exotic Core Hound, Fox), 5 demons (Imp, Voidwalker, Succubus, Incubus, Felhunter). **Felguard** (no summon spell; SoD rune), **Doomguard** (ritual) and Remote Control are skipped (`report.petsSkipped`). No Kill Command, Water Elemental, Feral Spirit or Treants in Forever. Searing/Magma Totem, Shadowfiend, Summon Hawk's 18 s assault and Inferno are summons outside the default rotations: **not modeled** (new KNOWN_LIMITS L22). | `report.json`, section 1. |
| **Owner scaling (Q5)** | **On by default**, toggle in the Pet panel and the URL. The scaling aura is in every pet's skill line, so Forever pets scale; its numbers are server-side, so TBC 2.4 coefficients are used `[VERIFY]`: hunter pets +22% of the hunter's ranged attack power as attack power and +12.8% as spell power; demons +57% / +15% of the warlock's max(fire, shadow) spell power; pets inherit the owner's hit chance (hunter: ranged hit, warlock: spell hit). Crit and haste are **not** inherited (TBC rule; Q70 asks whether Forever follows the modern aura). Off = Classic: base stats only. | `data/manual/pets.json` `owners.*.scaling`. |
| **Pet stats** | The Phase 3 stat engine is reused unchanged: `computeCharacter` with a pet base-stat table (class key = the owner, race `PET`): Str 136, Agi 102 …, AP = 2 Str − 20 = 252, melee 45–75 per 2.0 s (mangos `petlevel ± petlevel/4`), crit 5% melee / 5% spell, weapon skill 300. Same for all demons; the Imp has no melee (`noMelee: [23]`). `[VERIFY Q69]` | Every pet number is a `Stat` with parts, like the player's. |
| **Pet damage** | The pet is evaluated with the Phase 4 engine itself: a pet `DamageContext` (pet stats, `evaluateTarget` on the pet's own outcome tables: 8% miss, 6.5% dodge, 40% glancing at 65%, 2.6% crit vs a level-63 boss; spells 17% miss and 6% resist), `evaluateAbility`/`evaluateWhite`, and `runRotation` with a pet priority list generated from the data (cooldown and DoT abilities, longest cooldown first, then the filler: Bite > Claw, Lightning Breath, Firebolt, Lash of Pain). Focus 6/s `[VERIFY]` (+20% Bestial Discipline), max 100. Frenzy is an analytical uptime (pass 2), like Flurry. | P1/P2 goldens (Python, section 8.1). |
| **Owner ↔ pet** | Effects on the owner (`resolvePet` → `prepareDamage({ petOwnerEffects, petActive })`): Focused Fire (+2% both), Master Demonologist (data aura of the active demon at the talent's rank value, both; Imp +10% fire, Succubus/Incubus +10% shadow), Soul Link (aura 25228 +3% both), Demonic Knowledge (+100% of level as spell power, both), Demonic Sacrifice (owner only: Imp → Burning Shadow +15% shadow, Succubus/Incubus → Touch of Fire +15% fire, Voidwalker/Felhunter → regeneration, no damage). Sacrifice needs the talent and is cancelled by a summoned demon unless **Demonic Pact** is taken and the demon differs. **Lone Wolf** turns off while a pet is active. Bestial Wrath (+50% pet damage 18 s) is a pet burst: simulation only, like every burst. | Section 4.2. |
| **Simulator** | The pet is its own actor: a `FightModel` built from the pet evaluation runs in the **same `Fight` class** (swing timer, GCD, casts, focus, DoTs), one per iteration, with its own seeded stream `petIterationSeed(seed, i)` — the player's stream and results are unchanged. Pets pool focus for a higher entry that is ready (`strictPriority`: Bite is not starved by Claw). Frenzy is a sampled crit proc (`critBuff`), Bestial Wrath a stateful pet burst. Sources are keyed `"<pet>: <source>"` with `pet: true`; `SimResult.pet` holds the pet's DPS summary; `dps` is the total. | Cross-check P-C1..P-C3 within 3% (section 8.3). Perf: BM hunter + Cat 1000 × 180 s in 0.44 s. |
| **Default pet** | **None** for every class. Picking a pet is explicit, so every existing link, golden and number is unchanged, and Marksmanship builds with Lone Wolf are not silently changed. The Pet panel is shown for hunters and warlocks right under Weapons. | — |
| **URL** | No v3. New v2 record **tag 8** = `[family, sacrifice, scaling ? 0 : 1]` (CreatureFamily ids, 0 = none), omitted when it is the default (no pet, scaling on). Older decoders skip it. Goldens from an independent Python encoder: `#v2.hunter.60.0..CAMCAAA` (Cat), `#v2.warlock.60.0..CAMRFwE` (Succubus, Imp sacrificed, scaling off), `#v2.hunter.60.0..BwasAtAPKgAIAxsAAA` (tag 7 + Wind Serpent). | Section 8.4. |
| **UI** | Character panel: **Pet** section (hunter) / **Demon** section (warlock): pet select (with the family damage modifier), Demonic Sacrifice select (disabled without the talent), "Pet scales with your stats" checkbox. Damage panel: headline = total DPS, "You X · Cat Y" line, a **Pet** section (stats line, breakdown table, ability cards, skipped list) and pet notes. Simulation panel: "incl. Cat N DPS", pet rows tagged "pet" in the breakdown, pet lines in the combat log (merged by time). | e2e `pets.spec.ts`. |
| **Generated date** | The pets export is new data (pipeline v4), so `manifest.generatedAt` changes **once**: run the pipeline with `--date 2026-11-13` exactly (prototype output; reproducible). All other generated files are byte-identical; only `manifest.json`, `report.json` (new `petsSkipped`) and the new `pets/` change. | Section 5.4. |

---

## 1. Verified data facts (what the code may rely on)

| Fact | Value (70888) |
|---|---|
| Hammer of Wrath 24239 (r3) | effect 2 holy, base 498, perLevel 3.1 (levels 60–65), coef 0.429, cast 1 s (0 s with Retribution talents), category 1131 cd 6 s, 425 mana, **`DefenseType` 3**, `equipped: null`. Summon Hawk 1293527 is the only other ranged-type, weaponless, unequipped class spell |
| Power Infusion 10060 | cd 180 s, off the GCD, 15 s, aura 79 +20 misc 126 and aura 136 (healing), both **targets [21, 0]** |
| Ally-target buff auras (target 21) in class spells | Arcane Intellect, Blessings of Kings/Might, Divine Spirit, Innervate (cd), Mark of the Wild, Power Infusion (cd), Power Word: Fortitude. Party/raid targets 56/153 (Battle Shout, Gifts, Greater Blessings) are not changed |
| Slice and Dice (Combat, 5 cp) | 21 s, 25 energy, aura 319 +30% melee haste; Eviscerate 20 energy (Combat), Sinister Strike 40, Shank 5 energy / +40 energize / 8 s cd |
| `CreatureFamily` | 27 rows; `SkillLine_0` = the family skill line, `PetTalentType` 1 = exotic (Core Hound) |
| Pet scaling auras | 415429 "Hunter Pet Scaling" (19 aura effects, all base 0: 230 health, 99 AP, 13 spell damage, 22 resist ×5, 674 armor, 54/55 hit, 319/65 haste, 52/57 crit, 418, 593 ×2, 49) and 416189 "Warlock Pet Scaling" (same + 29, 85, 135): one of them is in every pet skill line |
| Family passives ("Tamed Pet Passive (DND)", aura 79 misc 1) | Wolf 17223 0, Cat 17210 +10, Spider 17219 +7, Bear 17208 −9, Boar 7000 −10, Crocolisk 17212 0, Carrion Bird 17209 0, Crab 17211 −5, Gorilla 17214 +2, Raptor 17217 +10, Tallstrider 17220 0, Scorpid 17218 −6, Turtle 17221 −10, Bat 17206 +7, Hyena 17215 0, Bird of Prey 17216 +7, Wind Serpent 17222 +7, Core Hound 444831 +1, Fox 17223 0 |
| Talent → pet passive (owner's spell masks) | Unleashed Fury 19616 (op 3, +15) → 8875 aura 79 misc 127 (also Summon Hawk); Ferocity 19598 (op 3, +10) → 19591 aura 290; Frenzy 19621 (op 18, +100) → 20784 aura 42 → 19615 aura 319 +30, 8 s; Bestial Discipline 19590 (op 8, +20) → 19589 aura 110 misc 2 (focus); Endurance Training → 19580/19581 (armor/health); Unholy Power 18769 (op 8, +10) → 18727–18730 aura 79 misc 127; Improved Imp 18694 (op 0 +30%) → Firebolt; Improved Sayaad 18754 (op 8 +30%) → Lash of Pain; Fel Vitality → 18735–18742 (health/mana) |
| Pet abilities at 60 | Claw 3009 (r8, lvl 56): school damage 51 physical, 25 focus, gcd 1.5 s, `DefenseType` 2; Bite 17261 (r8): 90, 35 focus, category cd 10 s; Lightning Breath 25012: 92 nature, 50 focus, `DefenseType` 1; Firebolt 11763 (r7, lvl 58–63): 44 + 0.6/level fire, coef 0.571, 2 s cast, gcd 1 s, 115 mana, family set 5; Lash of Pain 11780: 50 shadow, coef 0.429, 12 s cd; Savage Rend, Scorpid Poison, Tendon Rip (DoTs), Pinch, Dismember, Sonic Blast, Swipe, Thunderstomp, Mine!, Lava Breath (coef 0.429). No AP coefficient on any pet ability (`apCoef` unset) |
| Demon talent auras | Master Demonologist 23785 values `[imp, voidwalker, succubus, felhunter]` (2..10 per rank); its demon auras: 23759 aura 79 +10 fire (Imp), 23761 aura 79 +10 shadow (Succubus/Incubus), 23760/23762 damage taken (Voidwalker/Felhunter). Soul Link 25228: aura 79 +3 misc 127. Demonic Sacrifice buffs (server script picks them): 18789 **Burning Shadow** +15% shadow (Imp: "Increases your Shadow damage"), 18791 **Touch of Fire** +15% fire (Succubus/Incubus), 18790 Fel Stamina, 18792 Fel Energy. Demonic Knowledge 412732 values 33/67/100 (% of level as spell damage). Demonic Pact 425464. Focused Fire 1223755 values 1/2. Bestial Wrath 19574: aura 79 +50 misc 127 **target 5 (pet)**, 18 s, cd 120 s |
| Warlock summons | Summon Imp/Voidwalker/Succubus/Incubus/Felhunter exist; **no Summon Felguard / Doomguard**; Inferno (Infernal, 5 min) and Ritual of Doom exist |
| Other summons | Shadowfiend 401977 (priest, effect 28 summon, 15 s, 5 min cd), Searing Totem / Magma Totem (effect 28; their attack spells are not class spells), Summon Hawk 1293527 (direct 108 + RAP part, "continuing its assault for 18 sec"). None is in a default rotation; the catalog offers only Summon Hawk (direct damage) |

## 2. Part A design: quick fixes L8, L9, L10

### 2.1 L8: energy finishers

Measurements (Human rogue, Brutality Blade + Chromatically Tempered Sword, Combat talents maxed, boss, 1000 × 180 s):

| Variant | Analytical | Simulation | Delta | Slice and Dice / Eviscerate per fight (A ; S) |
|---|---|---|---|---|
| Phase 5, default | 123.1 | 141.8 | +15.2% | 8.6 / 1.9 ; 3.7 / 6.8 |
| Phase 5, no bursts | 123.1 | 137.9 | +12.0% | same ; 3.6 / 6.7 |
| Phase 5, no Slice and Dice | 148.6 | 148.1 | −0.3% | – / 10.6 ; – / 10.2 |
| Phase 5, no Shank (no Eviscerate affordable) | 94.6 | 115.4 | +22.1% | 7.2 / 0 ; 0 / 7.3 |
| sim pooling only, no bursts | 123.1 | 131.2 | +6.5% | 8.6 / 1.9 ; 5.6 / 4.7 |
| **both fixes, no bursts** | **134.4** | **131.2** | −2.4% | 6.1 / 4.4 ; 5.6 / 4.7 |
| **both fixes, default** | **134.4** | **134.9** | **+0.4%** | 6.1 / 4.4 ; 5.8 / 4.7 |

In the Phase 5 simulator 98% of the Eviscerates cast while Slice and Dice was down happened at 20–30 energy: Eviscerate
(20) became affordable before Slice and Dice (25), so the walk cast it. Note the side finding (not a bug): with Forever's
numbers Slice and Dice (+30% melee haste) is worth less than the Eviscerates its energy buys (148.6 vs 134.4 DPS); the
default rotation keeps it (Classic-style priority), CALC_MODEL section 6 records the finding.

**Analytical rule** (`runRotation`, finisher branch, buff or periodic finisher): `cycle = max(t, 60 x cost / resource)`
where `t` and `cost` are the finisher cycle's time and energy (finisher + k builders) and `resource` the energy per minute
left at that point of the walk; if a later rotation entry is an available, not simulation-only finisher and `cycle <
duration`, the cast cap is `60 / (duration + cycle / 2)` instead of `60 / duration` (renewal at a random phase of the
finisher cycle). Otherwise unchanged (Rip with Ferocious Bite: cycle 27.6 s > Rip 12 s, so no change). The aura of the
buff finisher stays a 100% uptime self-buff in the analytical stats (approximation, new KNOWN_LIMITS L25; within 3% of the sim).

**Simulator rule** (`Fight.act`): when a `finisher` entry is usable except for its resource (`usable(i, st, true)`),
later `finisher` entries are skipped in this walk ("pooling"); non-finishers (Shank) still run.

### 2.2 L9: Hammer of Wrath

`evaluateAbility`: `slot = kind === "spell" || weaponlessRanged(spell) ? null : ...` so no weapon check; `chancesFor`
with `slot === null` and a ranged kind uses `view.ranged ?? view.mainHand` with `ranged = true` in `specialChances` (no
dodge). Damage parts are the normal school-damage parts (holy: no armor, no resist). `slot: null` also means no weapon
procs in the simulator (Seal of Command, Flurry). `rotations.json`: `{ "ability": "Hammer of Wrath", "kind": "cooldown" }`
first in `paladin-retribution` (EXECUTE_ONLY already gates it to < 20% health; the analytical model lists it as
"execute phase: simulation only", so every Phase 4 golden is unchanged).

### 2.3 L10: Power Infusion

`selfApplied(e) = !e.targets || e.targets[0] === 1 || e.targets[0] === 21` (exported from `rotation/selfBuffs.ts`), used
by `selfBuffEffects`, `catalog.burst` and `sim/model.isStateful`. `rotations.json`: `{ "ability": "Power Infusion",
"kind": "burst" }` first in `priest-shadow` (simulation only; needs the Discipline talent).

No golden changes in Part A: the 13 Phase 4 goldens and the C1–C8 cross-checks pass unchanged (C8 Subtlety and C7 feral:
Slice and Dice/Rip are cheaper than Eviscerate/Ferocious Bite, so the pooling rule never triggers there). New: G15 and
quickfix tests (section 8.2).

## 3. Part A: the quick-fix diff (task T2)

Files: `data/manual/rotations.json` (Hammer of Wrath first in Retribution, Power Infusion first in Shadow, notes),
`src/engine/abilities/evaluate.ts` (`weaponlessRanged`, table choice), `src/engine/rotation/analytical.ts` (L8 refresh
gap), `catalog.ts` / `selfBuffs.ts` / `sim/model.ts` (`selfApplied`), `sim/engine.ts` (finisher pooling),
`rotation/golden.test.ts` (G15), new `sim/quickfix.test.ts`. Verified with `git apply --check` on `5c21d58`.

````diff
diff --git a/data/manual/rotations.json b/data/manual/rotations.json
index 87c7ced..960fe73 100644
--- a/data/manual/rotations.json
+++ b/data/manual/rotations.json
@@ -41,10 +41,11 @@
     { "id": "paladin-retribution", "class": "paladin", "spec": 2, "label": "Retribution: Seal of Command, Holy Strike, Judgement", "role": "dps", "tier": 1,
       "selfBuffs": ["Seal of Command"], "melee": true, "autoShot": false,
       "entries": [
+        { "ability": "Hammer of Wrath", "kind": "cooldown" },
         { "ability": "Holy Strike", "kind": "cooldown" },
         { "ability": "Judgement", "kind": "cooldown" }
       ],
-      "notes": ["Seal of Righteousness, Consecration, Exorcism (Undead/Demon only) and Hammer of Wrath (ranged attack table in the data, Q66) are not modeled."] },
+      "notes": ["Hammer of Wrath is an execute-phase (simulation only) entry; it needs no ranged weapon (Q66). Seal of Righteousness, Consecration and Exorcism (Undead/Demon only) are not modeled."] },
 
     { "id": "hunter-beast-mastery", "class": "hunter", "spec": 0, "label": "Ranged: Aimed, Multi, Arcane Shot, Serpent Sting", "role": "dps", "tier": 2,
       "selfBuffs": ["Aspect of the Hawk", "Hunter's Mark"], "melee": false, "autoShot": true,
@@ -131,12 +132,13 @@
     { "id": "priest-shadow", "class": "priest", "spec": 2, "label": "Shadow: SW:P, Devouring Plague, Mind Blast, Mind Flay", "role": "dps", "tier": 1,
       "selfBuffs": ["Shadowform"], "melee": false, "autoShot": false,
       "entries": [
+        { "ability": "Power Infusion", "kind": "burst" },
         { "ability": "Shadow Word: Pain", "kind": "dot" },
         { "ability": "Devouring Plague", "kind": "dot" },
         { "ability": "Mind Blast", "kind": "cooldown" },
         { "ability": "Mind Flay", "kind": "filler" }
       ],
-      "notes": ["Shadow Word: Death and Vampiric Embrace are not in the Phase 4 rotation."] },
+      "notes": ["Power Infusion (Discipline talent) is a simulation-only cooldown, cast on yourself (Q67). Shadow Word: Death and Vampiric Embrace are not in the rotation."] },
 
     { "id": "shaman-elemental", "class": "shaman", "spec": 0, "label": "Elemental: Flame Shock, Chain Lightning, Lightning Bolt", "role": "dps", "tier": 1,
       "selfBuffs": [], "melee": false, "autoShot": false,
diff --git a/src/engine/abilities/evaluate.ts b/src/engine/abilities/evaluate.ts
index 3b222f8..ddc0b99 100644
--- a/src/engine/abilities/evaluate.ts
+++ b/src/engine/abilities/evaluate.ts
@@ -71,6 +71,19 @@ function kindOf(spell: Spell): AttackKind {
   return spell.defenseType === 2 ? "melee" : spell.defenseType === 3 ? "ranged" : "spell";
 }
 
+/**
+ * L9: a ranged-type spell (DefenseType 3) needs a ranged weapon only when it deals weapon damage or has a
+ * SpellEquippedItems requirement. Hammer of Wrath and Summon Hawk have neither: they roll on the ranged table when a
+ * ranged weapon is equipped, else on the main-hand table, and cannot be dodged. [VERIFY Q66]
+ */
+export function weaponlessRanged(spell: Spell): boolean {
+  return (
+    kindOf(spell) === "ranged" &&
+    spell.equipped === null &&
+    !spell.effects.some((e) => WEAPON_EFFECTS.has(e.effect))
+  );
+}
+
 /** Weapon numbers of a slot; Cat Form replaces the main hand with the form's claws (CAT_FORM). */
 interface WeaponInfo {
   name: string;
@@ -298,7 +311,11 @@ function chancesFor(
   let c: RollChances;
   if (kind === "spell") c = spellChances(ctx.view, hitMod, critMod);
   else {
-    const o = ctx.view[slot ?? (kind === "ranged" ? "ranged" : "mainHand")];
+    const o = slot
+      ? ctx.view[slot]
+      : kind === "ranged"
+        ? (ctx.view.ranged ?? ctx.view.mainHand)
+        : ctx.view.mainHand;
     if (!o)
       return kind === "ranged" ? "requires a bow, gun, crossbow or thrown weapon" : "requires a melee weapon";
     c = specialChances(o, kind === "ranged", hitMod, critMod);
@@ -471,7 +488,9 @@ export function evaluateAbility(
   const kind = kindOf(spell);
   const script = SCRIPTS[key];
   const slot: AttackSlot | null =
-    kind === "spell" ? null : (script?.slot ?? (kind === "ranged" ? "ranged" : "mainHand"));
+    kind === "spell" || weaponlessRanged(spell)
+      ? null
+      : (script?.slot ?? (kind === "ranged" ? "ranged" : "mainHand"));
   if (slot && ctx.form !== "cat") {
     if (!weaponInfo(ctx, slot))
       return {
diff --git a/src/engine/rotation/analytical.ts b/src/engine/rotation/analytical.ts
index 6ec6727..5c940f1 100644
--- a/src/engine/rotation/analytical.ts
+++ b/src/engine/rotation/analytical.ts
@@ -90,7 +90,12 @@ export function runRotation(input: RotationInput): RotationResult {
   const generates = (e: RotationInput["evals"][number]) =>
     limited && e.ability.available && e.ability.power === power && e.ability.cost - e.ability.energize < 0;
   const ordered = [...input.evals.filter(generates), ...input.evals.filter((e) => !generates(e))];
-  for (const { entry, ability } of ordered) {
+  // Finishers that can spend combo points (L8: a buff/DoT finisher above one of them is refreshed late).
+  const spenders = input.evals.flatMap((e, i) =>
+    e.entry.kind === "finisher" && e.ability.available && !simOnlyReason(e.entry) ? [i] : [],
+  );
+  for (const ev of ordered) {
+    const { entry, ability } = ev;
     if (entry.kind === "nextSwing") continue;
     const simOnly = simOnlyReason(entry);
     if (simOnly) {
@@ -140,7 +145,12 @@ export function runRotation(input: RotationInput): RotationResult {
       t += k * builder.timeCost;
       cost += k * (builder.power === power && limited ? builder.cost - builder.energize : 0);
       if (entry.buff || a.expectedPeriodic > 0) {
-        cap = a.durationSec > 0 ? MINUTE / a.durationSec : Infinity;
+        // L8: while the aura is up a lower-priority finisher spends the combo points, so the aura is refreshed at
+        // the first finisher point after it has fallen off: half a finisher cycle later on average.
+        const cycle = Math.max(t, cost > 0 && resource > 0 ? (MINUTE * cost) / resource : 0);
+        const index = input.evals.indexOf(ev);
+        const late = spenders.some((j) => j > index) && cycle < a.durationSec ? cycle / 2 : 0;
+        cap = a.durationSec > 0 ? MINUTE / (a.durationSec + late) : Infinity;
         limit = "duration";
       } else cap = Infinity;
     }
diff --git a/src/engine/rotation/catalog.ts b/src/engine/rotation/catalog.ts
index e63de32..7d4146c 100644
--- a/src/engine/rotation/catalog.ts
+++ b/src/engine/rotation/catalog.ts
@@ -7,6 +7,7 @@ import type {
   Spell,
   Talent,
 } from "@/data/types";
+import { selfApplied } from "./selfBuffs";
 
 /** One ability the rotation editor offers. `id` is its stable URL key (section 5.2). */
 export interface CatalogAbility {
@@ -24,7 +25,6 @@ const PERIODIC_TRIGGER = 23;
 /** Caster auras of a cooldown that change damage or resources (same set the simulator applies, section 4.3). */
 const BUFF_AURAS = new Set([65, 79, 107, 108, 110, 134, 140, 290, 319, 342]);
 const COMBO_POINTS = 4;
-const TARGET_CASTER = 1;
 
 const directDamage = (s: Spell) => s.effects.some((e) => WEAPON_OR_SCHOOL_DAMAGE.has(e.effect));
 /** Deals damage itself, over time, or through a triggered spell (Mutilate strikes, Arcane Missiles). */
@@ -42,7 +42,7 @@ function burst(s: Spell): boolean {
   if (s.cooldownMs <= 0) return false;
   return s.effects.some(
     (e) =>
-      (e.effect === 6 && BUFF_AURAS.has(e.aura) && (!e.targets || e.targets[0] === TARGET_CASTER)) ||
+      (e.effect === 6 && BUFF_AURAS.has(e.aura) && selfApplied(e)) ||
       (e.effect === 30 && (e.misc[0] === 1 || e.misc[0] === 3)),
   );
 }
diff --git a/src/engine/rotation/golden.test.ts b/src/engine/rotation/golden.test.ts
index bccc081..e5e9b30 100644
--- a/src/engine/rotation/golden.test.ts
+++ b/src/engine/rotation/golden.test.ts
@@ -167,6 +167,27 @@ describe("golden: weapon attacks (special table: 8% miss, 6.5% dodge, crit -2.4%
     near(r.ability("Holy Strike").hit, 242.56428571428572);
     near(r.ability("Holy Strike").expected, 212.680972125);
   });
+  it("G15 Hammer of Wrath r3 (Phase 6, L9): 498 + 0.429 x 200 holy, main-hand table without dodge, no ranged weapon", () => {
+    const r = runDamage({
+      classToken: "paladin",
+      race: "HUMAN",
+      weapons: REAPER,
+      bonus: { holySpellPower: 200 },
+      rotation: "paladin-retribution",
+    });
+    const a = r.ability("Hammer of Wrath");
+    expect(a.spell.id).toBe(24239);
+    expect(a.slot).toBeNull();
+    near(a.hit, 583.8);
+    near(a.crit, 1167.6);
+    near(a.hitChance, 92);
+    near(a.critChance, 2.55);
+    near(a.expected, 550.791948);
+    expect(r.result.rotation.skipped).toContainEqual({
+      ability: "Hammer of Wrath",
+      reason: "execute phase: simulation only",
+    });
+  });
 });
 
 describe("golden: rotations", () => {
diff --git a/src/engine/rotation/selfBuffs.ts b/src/engine/rotation/selfBuffs.ts
index 2a25ab1..38880c9 100644
--- a/src/engine/rotation/selfBuffs.ts
+++ b/src/engine/rotation/selfBuffs.ts
@@ -3,6 +3,12 @@ import { learn, type Spellbook } from "@/engine/abilities";
 import { mapAura, type RankedTalent, type SourcedEffect } from "@/engine/stats";
 
 const TARGET_CASTER = 1;
+/** ImplicitTarget 21 TARGET_UNIT_TARGET_ALLY: a single-target ally buff (Power Infusion) can be cast on yourself (L10). */
+const TARGET_ALLY = 21;
+/** The caster gets this aura when it casts the spell on itself: caster auras, and ally-target auras (self-cast). */
+export function selfApplied(e: { targets?: [number, number] }): boolean {
+  return !e.targets || e.targets[0] === TARGET_CASTER || e.targets[0] === TARGET_ALLY;
+}
 /** Hunter's Mark: "increasing the Ranged Attack Power of all attackers against that target" (target aura). [VERIFY] */
 const AURA_RANGED_AP_ATTACKER_BONUS = 127;
 
@@ -48,7 +54,7 @@ export function selfBuffEffects(spells: readonly Spell[]): SourcedEffect[] {
         out.push({ key: "rangedAttackPower", value: e.base, label: s.name, kind: "buff" });
         continue;
       }
-      if (e.targets && e.targets[0] !== TARGET_CASTER) continue;
+      if (!selfApplied(e)) continue;
       const m = mapAura(e, e.base);
       if (m.kind === "stat" || m.kind === "damageDone")
         for (const se of m.effects) out.push({ ...se, label: s.name, kind: "buff" });
diff --git a/src/engine/sim/engine.ts b/src/engine/sim/engine.ts
index 7d220fc..14eae0c 100644
--- a/src/engine/sim/engine.ts
+++ b/src/engine/sim/engine.ts
@@ -405,7 +405,7 @@ export class Fight implements ConditionState {
     return a.castTime;
   }
   /** Usability of entry i now, ignoring the GCD (section 4.4 "implicit rules"). */
-  private usable(i: number, st: StateEval): AbilityResult | null {
+  private usable(i: number, st: StateEval, ignoreCost = false): AbilityResult | null {
     const se = this.model.entries[i]!;
     const e = se.entry;
     if (!se.talentOk || se.skip) return null;
@@ -437,7 +437,7 @@ export class Fight implements ConditionState {
       default:
         break;
     }
-    if (!this.affordable(a)) return null;
+    if (!ignoreCost && !this.affordable(a)) return null;
     if (!conditionsHold(e, this, i)) return null;
     return a;
   }
@@ -451,13 +451,19 @@ export class Fight implements ConditionState {
       let picked = -1;
       let pickedA: AbilityResult | null = null;
       manaBlocked = false;
+      let pooling = false;
       for (let i = 0; i < this.n; i++) {
         const raw = this.evalFor(i, st);
-        const onGcd = raw.available && raw.gcd > 0 && this.model.entries[i]!.entry.kind !== "nextSwing";
+        const kind = this.model.entries[i]!.entry.kind;
+        const onGcd = raw.available && raw.gcd > 0 && kind !== "nextSwing";
         if (onGcd && this.gcdUntil > this.t + EPS) continue;
+        // L8: a finisher that waits for its resource keeps the combo points (no cheaper finisher steals them)
+        const pools = kind === "finisher";
+        if (pooling && pools) continue;
         const a = this.usable(i, st);
         if (!a) {
           if (raw.available && this.model.power === "mana" && !this.affordable(raw)) manaBlocked = true;
+          if (pools && this.usable(i, st, true)) pooling = true;
           continue;
         }
         picked = i;
diff --git a/src/engine/sim/model.ts b/src/engine/sim/model.ts
index f05b53e..e18d9cb 100644
--- a/src/engine/sim/model.ts
+++ b/src/engine/sim/model.ts
@@ -11,7 +11,7 @@ import {
   type WhiteResult,
 } from "@/engine/abilities";
 import { WINDFURY } from "@/engine/combat";
-import { evaluateDamage, prepareDamage, type Prepared } from "@/engine/rotation";
+import { evaluateDamage, prepareDamage, selfApplied, type Prepared } from "@/engine/rotation";
 import { evaluateTarget, mapAura, type RankedTalent } from "@/engine/stats";
 import { SPIRIT_REGEN, REGEN_TICK_SEC } from "./constants";
 import { activeProcs, SIM_PROC_TALENTS, type ActiveProcs } from "./procs";
@@ -23,7 +23,6 @@ const TRIGGER_SPELL = 64;
 const AURA_PERIODIC_ENERGIZE = 24;
 const AURA_POWER_REGEN_PCT = 110;
 const AURA_REGEN_WHILE_CASTING = 134;
-const TARGET_CASTER = 1;
 const POWER: Readonly<Record<number, PowerKind>> = { 0: "mana", 1: "rage", 2: "focus", 3: "energy" };
 
 /** A player buff the simulator tracks: a burst cooldown, a buff finisher (Slice and Dice) or a proc (Clearcasting). */
@@ -93,7 +92,7 @@ export interface SimModel {
 /** Caster auras of a buff spell that change ability evaluation (same mapper as the Phase 4 self-buffs). */
 function isStateful(spell: Spell): boolean {
   return spell.effects.some((e) => {
-    if (e.effect !== APPLY_AURA || (e.targets && e.targets[0] !== TARGET_CASTER)) return false;
+    if (e.effect !== APPLY_AURA || !selfApplied(e)) return false;
     if (e.aura === 107 || e.aura === 108) return true;
     const m = mapAura(e, e.base);
     return m.kind === "stat" || m.kind === "damageDone";
diff --git a/src/engine/sim/quickfix.test.ts b/src/engine/sim/quickfix.test.ts
new file mode 100644
index 0000000..f1214f4
--- /dev/null
+++ b/src/engine/sim/quickfix.test.ts
@@ -0,0 +1,107 @@
+// Quick fixes L8-L10 (before Phase 6, plan section 8.2): energy finishers, Hammer of Wrath, Power Infusion.
+import { describe, expect, it } from "vitest";
+import type { ClassToken, RotationEntry } from "@/data/types";
+import { runDamage } from "@/testkit/damage";
+import { simInput, type SimScenario } from "@/testkit/sim";
+import { weapon } from "@/testkit/stats";
+import { treeFor } from "@/testkit/talents";
+import { runSim } from "./run";
+import { DEFAULT_SIM_CONFIG, type SimConfig } from "./types";
+
+const DUAL = { mainHand: weapon(18832), offHand: weapon(19352) };
+const cfg = (patch: Partial<SimConfig> = {}): SimConfig => ({ ...DEFAULT_SIM_CONFIG, ...patch });
+const sim = (s: SimScenario, c: Partial<SimConfig> = {}) => runSim(simInput(s), cfg(c));
+function maxed(token: ClassToken, spec: number): Record<string, number> {
+  const out: Record<string, number> = {};
+  for (const n of treeFor(token).nodes.values())
+    if (n.specIndex === spec) out[n.talent.name] = n.talent.maxRank;
+  return out;
+}
+const casts = (r: ReturnType<typeof runSim>, key: string) => r.sources.find((x) => x.key === key)?.casts ?? 0;
+
+const COMBAT: SimScenario = {
+  classToken: "rogue",
+  race: "HUMAN",
+  weapons: DUAL,
+  talents: maxed("rogue", 1),
+  rotation: "rogue-combat",
+};
+const NO_BURSTS = {
+  combat: [
+    { ability: "Slice and Dice", kind: "finisher", cp: 5, buff: true },
+    { ability: "Shank", kind: "cooldown" },
+    { ability: "Sinister Strike", kind: "builder" },
+    { ability: "Eviscerate", kind: "finisher", cp: 5 },
+  ],
+  assassination: [
+    { ability: "Slice and Dice", kind: "finisher", cp: 5, buff: true },
+    { ability: "Mutilate", kind: "builder" },
+    { ability: "Sinister Strike", kind: "builder" },
+    { ability: "Eviscerate", kind: "finisher", cp: 5 },
+  ],
+} satisfies Record<string, RotationEntry[]>;
+
+describe("L8: energy finishers (analytical vs simulation)", () => {
+  it("C9 Combat without cooldowns within 3%; the default Combat rotation within 5%", () => {
+    const s = { ...COMBAT, entries: NO_BURSTS.combat };
+    expect(Math.abs(sim(s).dps.mean / runDamage(s).result.rotation.dps - 1)).toBeLessThan(0.03);
+    expect(Math.abs(sim(COMBAT).dps.mean / runDamage(COMBAT).result.rotation.dps - 1)).toBeLessThan(0.05);
+  });
+  it("C10 Assassination without Cold Blood within 5% (-3.5%)", () => {
+    const s: SimScenario = {
+      classToken: "rogue",
+      race: "HUMAN",
+      weapons: DUAL,
+      talents: maxed("rogue", 0),
+      rotation: "rogue-assassination",
+      entries: NO_BURSTS.assassination,
+    };
+    expect(Math.abs(sim(s).dps.mean / runDamage(s).result.rotation.dps - 1)).toBeLessThan(0.05);
+  });
+  it("analytical: Slice and Dice is refreshed half a finisher cycle late when Eviscerate spends the combo points", () => {
+    const r = runDamage({ ...COMBAT, entries: NO_BURSTS.combat }).result.rotation;
+    const snd = r.casts.find((c) => c.key === "Slice and Dice")!;
+    expect(snd.ability.durationSec).toBe(21);
+    expect(snd.perMinute).toBeLessThan(60 / 21);
+    expect(snd.perMinute).toBeGreaterThan(60 / 33);
+    expect(r.casts.find((c) => c.key === "Eviscerate")!.perMinute).toBeGreaterThan(1);
+  });
+  it("simulation: a finisher that waits for energy keeps the combo points (Slice and Dice is not skipped for Eviscerate)", () => {
+    const r = sim({ ...COMBAT, entries: NO_BURSTS.combat }, { iterations: 300 });
+    expect(casts(r, "Slice and Dice")).toBeGreaterThan(5);
+  });
+});
+
+describe("L9/L10: Hammer of Wrath and Power Infusion", () => {
+  it("Hammer of Wrath needs no ranged weapon and is cast in the execute phase of the Retribution default", () => {
+    const s: SimScenario = {
+      classToken: "paladin",
+      race: "HUMAN",
+      weapons: { mainHand: weapon(12784) },
+      talents: maxed("paladin", 2),
+      rotation: "paladin-retribution",
+    };
+    const r = sim(s, { iterations: 1, logLimit: 100000 });
+    const t = r.log.filter((l) => l.source === "Hammer of Wrath" && l.outcome === "cast").map((l) => l.t);
+    expect(t.length).toBeGreaterThan(3);
+    expect(Math.min(...t)).toBeGreaterThanOrEqual(0.8 * 180);
+  });
+  it("Power Infusion is self-cast: +20% spell damage for 15 s", () => {
+    const s: SimScenario = {
+      classToken: "priest",
+      race: "HUMAN",
+      bonus: { spellPower: 300 },
+      talents: { ...maxed("priest", 2), "Power Infusion": 1 },
+      rotation: "priest-shadow",
+    };
+    const r = sim(s, { iterations: 300, logLimit: 100000 });
+    const pi = r.log.filter((l) => l.source === "Power Infusion").map((l) => [l.t, l.outcome]);
+    expect(pi).toEqual([
+      [0, "cast"],
+      [0, "buff"],
+      [15, "fade"],
+    ]);
+    const without = sim({ ...s, talents: maxed("priest", 2) }, { iterations: 300 });
+    expect(r.dps.mean).toBeGreaterThan(without.dps.mean * 1.01);
+  });
+});
````

## 4. Phase 6 design: pets

### 4.1 Module structure and import direction

```
tools/pipeline/pets.py               build_pets: pets/<owner>.json (families, demons, abilities, passives, spells)
data/manual/pets.json                rewritten: base stats, owner scaling, focus, noMelee, sacrifice / Master
                                     Demonologist / Soul Link aura references ([VERIFY], validated by the pipeline)
src/data/types.ts, index.ts          PetInfo, PetFile, PetsManualFile; loadPetFile(token), petsManual
src/engine/pets/constants.ts         PET_TALENT ids, PET_TALENT_IDS, aura/op/target constants, PET_STREAM
src/engine/pets/types.ts             PetChoice, NO_PET, PetSetup, ResolvedPet, PetDamage
src/engine/pets/setup.ts             resolvePet: active pet, owner effects, notes (sacrifice rules)
src/engine/pets/stats.ts             petAuras (passives + buffs after owner talent mods), computePetStats
src/engine/pets/rotation.ts          petBook (memoized), petRotation (priority list from the data)
src/engine/pets/evaluate.ts          petState (one evaluation per buff set), evaluatePet (analytical, 2 passes)
src/engine/sim/petModel.ts           buildPetModel: the pet as a FightModel
src/engine/sim/{model,engine,procs,run,types}.ts   FightModel, focus, critBuff, strictPriority, prefix, pet runs
src/engine/{stats,rotation}          petActive (Lone Wolf), petOwnerEffects, focusPerMinute
src/state/{character,charCode,store,derived}.ts    pet choice, URL tag 8, pets file loading, owner + pet DPS
src/ui/character/PetPanel.tsx, results/DamagePanel.tsx, sim/SimPanel.tsx
src/testkit/pets.ts                  test-only: petFile, scenarioPet; runDamage/simInput take `pet`
```

Import direction: `stats` <- `combat` <- `abilities` <- `talents/special` <- `rotation` <- **`pets`** <- `sim`.
`prepareDamage` (rotation) receives the owner effects as plain data (`petOwnerEffects`, `petActive`), computed by the
caller with `resolvePet`, so `rotation` never imports `pets`. `state` imports `engine/*`; `ui` imports `state`.

### 4.2 Data contracts

`data/generated/<build>/pets/<owner>.json` (`hunter`, `warlock`; written with `write_records`):

```ts
interface PetAbilityChain { name: string; ranks: number[] }          // ranks by SpellLevels.BaseLevel, then id
interface PetInfo {
  id: number;            // CreatureFamily.ID (URL key)
  name: string; owner: ClassToken; icon: string | null; skillLine: number;
  exotic: boolean;       // PetTalentType 1
  abilities: PetAbilityChain[];   // non-passive spells of the skill line, by name
  passives: number[];    // passive spells of the skill line (family passive, talent-modified passives, pet scaling)
}
interface PetFile { build: string; classId: number; token: ClassToken; pets: PetInfo[]; spells: Spell[] }
// spells = every ability rank + passive + EffectTriggerSpell closure (Frenzy 19615) + (warlock) every spellId in
// data/manual/pets.json; Spell records exactly like spells/<class>.json, classIds [owner], sources ["pet"]
```
`manifest.counts` gains `pets` (24) and `petSpells` (229: hunter 133, warlock 96); `pipelineVersion` 4;
`report.petsSkipped` lists Doomguard, Remote Control, Felguard with the reason.

`data/manual/pets.json` (`PetsManualFile`; full content in diff B1): `level`, `owners.{hunter,warlock}` =
`{ base: PetBaseStats, scaling: { from, attackPowerPct, spellPowerPct, inheritHit }, focus: { max, perSecond } | null,
noMelee: number[] }`, `sacrifice[]` and `masterDemonologist[]` (`{ family, name, spellId, spellName[, valueIndex] }`),
`soulLink { spellId, spellName }`. `tools/pipeline/manual.py` checks the required keys, every `spellId`/`spellName` and
every `family`/`name` against `CreatureFamily`.

State/URL: `PetChoice { family, sacrifice, scaling }` (`NO_PET = { 0, 0, true }`) in `useCharacter.pet`; URL tag 8.

### 4.3 Algorithms

**resolvePet(choice, file, manual, token, talents, level)** → `{ pet: PetSetup | null, ownerEffects, notes }`:
1. No pet file or no `owners[token]` → nothing. `info` = the pet with `id === choice.family` (else no active pet).
2. With an active pet, *shared* effects (owner and pet): Focused Fire `damageDonePct = values[0]`; Master Demonologist:
   the manual entry of the demon → its spell's aura 79 effects at value `values[valueIndex]` (mapAura → school mask);
   Soul Link: aura 79 of 25228 at its own value; Demonic Knowledge: `spellPower = values[0] x level / 100`.
3. Sacrifice (owner only): needs talent 18788 (else note); cancelled when a demon is active unless Demonic Pact (425464) is
   taken and the active demon differs from the sacrificed one (note); else the sacrifice spell's aura 79 effects (a note
   when it has none: Fel Stamina/Fel Energy).
4. `PetSetup = { info, spells: file.spells, config: manual.owners[token], scaling: choice.scaling, effects: shared }`.

**petAuras(setup, buffs, mods, classSet, level)**: for every passive of the pet and every active pet buff spell, take
the aura effects (effects 6/35/65/119/143) that land on the pet (target none/1/5); value = `effectValue(spell, e, level,
collectMods(spell, ownerTalentMods, classSet))`; aura 110 misc 2 adds to `focusRegenPct`; aura 42 with a trigger is the
Frenzy proc (`chance = proc.chance + Σ op-18 flat talent mods`); everything else through `mapAura`, non-zero values kept.
Labels: the modifying talents ("Unleashed Fury 5/5"), else "<Pet> (family)" for the family passive, else the buff name.

**computePetStats(setup, { level, owner, auras })**: `computeCharacter` with base table `classes[OWNER] = pets.json base`
(health/mana 0), `raceOffsets.PET = 0`, `meleeAttackPower[OWNER] = { perLevel 0, perStr apPerStr, perAgi 0, flat apFlat }`,
`agiPerMeleeCrit = Infinity` (crit = base), weapons `{ mainHand: synthetic Weapon (min/max/speed, subclass 13) or null
for noMelee }`, effects = shared + owner scaling (`meleeAttackPower = pct x src`, `spellPower = pct x src`, `hit` =
owner's ranged (hunter, falls back to main-hand) or spell hit; src = owner RAP or max(fire, shadow) spell power) + auras.

**petRotation**: learned pet abilities (`learn` on a book of owner class spells + pet spells, chains = pet abilities)
that deal damage (effects 2/17/31/58/121 or aura 3/53); `dot` if periodic only, `cooldown` if `max(cooldownMs,
categoryCooldownMs) > 0`, else `filler`; timed entries sorted by cooldown descending (name ascending on ties), then
fillers; owner talent abilities with an aura 79 on target 5 and a cooldown (Bestial Wrath) first as `burst`. `melee =
!noMelee`. Owner bursts evaluated for the pet get `power: null, cost: 0` (they cost the owner's mana).

**evaluatePet** (analytical): `petState` → `runRotation({ ..., focusPerMinute: focus x (1 + focusRegenPct/100) x 60 })`
(`runRotation` sets `income = focusPerMinute` for power "focus"). Pass 2 adds Frenzy: `crits/min` = white crits + landed
melee-special crits; `meleeHastePct = 30 x (1 − exp(−crits x chance/100 x 8 / 60))`. Total DPS = owner + pet.

**Simulator**: `buildPetModel` builds a `FightModel` (`power` focus or null, `focus { max, perSecond }`, `sourcePrefix
"<Pet>: "`, `strictPriority: true`, entries with a stateful BuffDef for bursts, `procs = noProcs()` + `critBuff` Frenzy,
`state(active)` memoized per active buff set via `petState(args, buffSpells)`). `Fight` changes: focus regenerates like
energy, `weaponHit` applies `critBuff` on a melee crit (one extra RNG call only when a critBuff exists), `strictPriority`
pools for any higher entry that spends the same resource, `count`/`log` prefix the source. `runSim` runs the pet Fight
after the player's in every iteration with `createRng(petIterationSeed(seed, i))`, separate accumulators; `dps[i] =
(player + pet) / T`; sources merged with `pet: true`; `SimResult.pet = { name, dps }`; logs merged by time and cut to
`logLimit`; `modeled` adds the pet proc labels.

### 4.4 UI

- `CharacterPanel` renders `<PetPanel />` after Weapons (only when `useCalc.pets` is set). Testids: `pet-panel`,
  `pet-select` (option label "Cat (+10% damage)", value = family id, "None" = 0), `pet-sacrifice` (warlock; disabled
  without the talent; choosing one clears the active demon unless Demonic Pact keeps a different one), `pet-scaling`.
- `DamagePanel`: `dps-total` = `totalDps`; `dps-split` "You X · Cat Y"; `PetSection` (`pet-damage`, `pet-dps`,
  `pet-stats`, `pet-breakdown`, rows `pet-row-<slug>`, ability cards); `pet-note` per resolvePet note.
- `SimPanel`: `sim-pet-dps` "incl. Cat N DPS"; breakdown rows `sim-row-cat-melee` etc. with a "pet" tag; analytical
  comparison uses `totalDps`.

## 5. Pipeline v4 and the regenerated data (task T4)

Diff B1 adds `tools/pipeline/pets.py` (`build_pets`), `PET_SCALING_SPELLS` and `PIPELINE_VERSION = 4` in `constants.py`,
the call and the writer in `build_data.py` (after the coverage; `report.petsSkipped`; `counts.pets`, `counts.petSpells`),
the new required keys and family checks in `manual.py`, the rewritten `data/manual/pets.json`, `tests/test_phase6.py`, and
`pipelineVersion` 4 in `test_phase3.py`/`test_phase4.py`. Then run exactly:

```
python3 tools/pipeline/build_data.py --build 1.60.1.70888 --date 2026-11-13
python3 -m unittest discover -s tools/pipeline/tests -t tools -v      # 53 tests OK
```

The console must show `pets 24`, `petSpells 229` and `manualValidation 0`. Expected diff of the two changed generated
files (do not apply it; it is what the pipeline produces; `pets/hunter.json` and `pets/warlock.json` are new):

````diff
diff --git a/data/generated/1.60.1.70888/manifest.json b/data/generated/1.60.1.70888/manifest.json
index 0362fa8..6ff35dc 100644
--- a/data/generated/1.60.1.70888/manifest.json
+++ b/data/generated/1.60.1.70888/manifest.json
@@ -1,8 +1,8 @@
 {
  "build": "1.60.1.70888",
  "eraBuild": "1.15.9.70576",
- "generatedAt": "2026-11-12",
- "pipelineVersion": 3,
+ "generatedAt": "2026-11-13",
+ "pipelineVersion": 4,
  "options": {
   "includeHiddenNodes": false,
   "eraFallback": true
@@ -259,6 +259,8 @@
   "weaponsEraFallback": 1612,
   "ammo": 27,
   "targetLevels": 63,
-  "petFamilies": 27
+  "petFamilies": 27,
+  "pets": 24,
+  "petSpells": 229
  }
 }
diff --git a/data/generated/1.60.1.70888/report.json b/data/generated/1.60.1.70888/report.json
index bc736a0..f63b28b 100644
--- a/data/generated/1.60.1.70888/report.json
+++ b/data/generated/1.60.1.70888/report.json
@@ -651,5 +651,10 @@
   132
  ],
  "manualValidation":[],
- "warnings":[]
+ "warnings":[],
+ "petsSkipped":[
+  {"id":19,"name":"Doomguard","reason":"no Summon Doomguard warlock ability"},
+  {"id":28,"name":"Remote Control","reason":"no pet scaling aura in skill line 758"},
+  {"id":310,"name":"Felguard","reason":"no Summon Felguard warlock ability"}
+ ]
 }
````

## 6. Part B: the Phase 6 diffs (tasks T4–T8)

Apply in this order, each against the tree after Part A and the previous blocks: B1, B2, B3, B4, B5, B8, B6, B7 (all
verified with `git apply --check` in that order). New files are "new file mode" hunks.

### 6.1 B1: pipeline, manual pets.json, pipeline tests (task T4)

````diff
diff --git a/data/manual/pets.json b/data/manual/pets.json
index c05a873..22d5ede 100644
--- a/data/manual/pets.json
+++ b/data/manual/pets.json
@@ -1,157 +1,34 @@
 {
- "_source": "[VERIFY] Classic 1.12 hunter family damage modifiers (from memory); demon list from CreatureFamily. Numbers are filled in Phase 6.",
- "_status": "[VERIFY]",
- "hunterFamilies": {
-  "1": {
-   "name": "Wolf",
-   "damageModifier": 1.0,
-   "attackSpeed": 2.0
-  },
-  "2": {
-   "name": "Cat",
-   "damageModifier": 1.1,
-   "attackSpeed": 2.0
-  },
-  "3": {
-   "name": "Spider",
-   "damageModifier": 1.07,
-   "attackSpeed": 2.0
-  },
-  "4": {
-   "name": "Bear",
-   "damageModifier": 0.91,
-   "attackSpeed": 2.0
-  },
-  "5": {
-   "name": "Boar",
-   "damageModifier": 0.9,
-   "attackSpeed": 2.0
-  },
-  "6": {
-   "name": "Crocolisk",
-   "damageModifier": 1.0,
-   "attackSpeed": 2.0
-  },
-  "7": {
-   "name": "Carrion Bird",
-   "damageModifier": 1.07,
-   "attackSpeed": 2.0
-  },
-  "8": {
-   "name": "Crab",
-   "damageModifier": 0.95,
-   "attackSpeed": 2.0
-  },
-  "9": {
-   "name": "Gorilla",
-   "damageModifier": 1.02,
-   "attackSpeed": 2.0
-  },
-  "11": {
-   "name": "Raptor",
-   "damageModifier": 1.1,
-   "attackSpeed": 2.0
-  },
-  "12": {
-   "name": "Tallstrider",
-   "damageModifier": 1.0,
-   "attackSpeed": 2.0
-  },
-  "20": {
-   "name": "Scorpid",
-   "damageModifier": 0.94,
-   "attackSpeed": 2.0
-  },
-  "21": {
-   "name": "Turtle",
-   "damageModifier": 0.9,
-   "attackSpeed": 2.0
-  },
-  "24": {
-   "name": "Bat",
-   "damageModifier": 1.07,
-   "attackSpeed": 2.0
-  },
-  "25": {
-   "name": "Hyena",
-   "damageModifier": 1.0,
-   "attackSpeed": 2.0
-  },
-  "26": {
-   "name": "Bird of Prey",
-   "damageModifier": 1.07,
-   "attackSpeed": 2.0
-  },
-  "27": {
-   "name": "Wind Serpent",
-   "damageModifier": 1.07,
-   "attackSpeed": 2.0
-  },
-  "312": {
-   "name": "Core Hound",
-   "damageModifier": null,
-   "attackSpeed": 2.0
-  },
-  "319": {
-   "name": "Fox",
-   "damageModifier": null,
-   "attackSpeed": 2.0
-  }
- },
- "warlockDemons": {
-  "23": {
-   "name": "Imp",
-   "model": "spell",
-   "notes": "[VERIFY] stats/abilities to be filled in Phase 6",
-   "damage": null,
-   "attackSpeed": null
-  },
-  "16": {
-   "name": "Voidwalker",
-   "model": "melee",
-   "notes": "[VERIFY] stats/abilities to be filled in Phase 6",
-   "damage": null,
-   "attackSpeed": null
-  },
-  "17": {
-   "name": "Succubus",
-   "model": "melee",
-   "notes": "[VERIFY] stats/abilities to be filled in Phase 6",
-   "damage": null,
-   "attackSpeed": null
-  },
-  "302": {
-   "name": "Incubus",
-   "model": "melee",
-   "notes": "[VERIFY] stats/abilities to be filled in Phase 6",
-   "damage": null,
-   "attackSpeed": null
-  },
-  "15": {
-   "name": "Felhunter",
-   "model": "melee",
-   "notes": "[VERIFY] stats/abilities to be filled in Phase 6",
-   "damage": null,
-   "attackSpeed": null
-  },
-  "310": {
-   "name": "Felguard",
-   "model": "melee",
-   "notes": "[VERIFY] stats/abilities to be filled in Phase 6",
-   "damage": null,
-   "attackSpeed": null
-  },
-  "19": {
-   "name": "Doomguard",
-   "model": "melee",
-   "notes": "[VERIFY] stats/abilities to be filled in Phase 6",
-   "damage": null,
-   "attackSpeed": null
+ "_source": "Phase 6 (docs/phase6-implementation-plan.md section 3). Pet base stats, focus and owner scaling are server-side (not in client data): Classic 1.12 / TBC 2.4 values recalled from CMaNGOS / vmangos Pet::InitStatsForLevel and pet_levelstats. Family damage modifiers, pet abilities, the talent effects on pets and the sacrifice / Master Demonologist / Soul Link auras come from the client data (data/generated/<build>/pets/<owner>.json).",
+ "_status": "[VERIFY] base, scaling and focus numbers (Q5, Q69-Q73)",
+ "level": 60,
+ "owners": {
+  "hunter": {
+   "base": { "str": 136, "agi": 102, "sta": 154, "int": 66, "spi": 101, "apPerStr": 2, "apFlat": -20, "minDamage": 45, "maxDamage": 75, "speedMs": 2000, "meleeCrit": 5, "spellCrit": 5 },
+   "scaling": { "from": "rangedAttackPower", "attackPowerPct": 22, "spellPowerPct": 12.8, "inheritHit": true },
+   "focus": { "max": 100, "perSecond": 6 },
+   "noMelee": []
+  },
+  "warlock": {
+   "base": { "str": 136, "agi": 102, "sta": 154, "int": 66, "spi": 101, "apPerStr": 2, "apFlat": -20, "minDamage": 45, "maxDamage": 75, "speedMs": 2000, "meleeCrit": 5, "spellCrit": 5 },
+   "scaling": { "from": "spellPower", "attackPowerPct": 57, "spellPowerPct": 15, "inheritHit": true },
+   "focus": null,
+   "noMelee": [23]
   }
  },
- "ownerScaling": {
-  "hunter": null,
-  "warlock": null,
-  "_note": "Q5: do pets scale with owner stats in Forever?"
- }
+ "sacrifice": [
+  { "family": 23, "name": "Imp", "spellId": 18789, "spellName": "Burning Shadow" },
+  { "family": 16, "name": "Voidwalker", "spellId": 18790, "spellName": "Fel Stamina" },
+  { "family": 17, "name": "Succubus", "spellId": 18791, "spellName": "Touch of Fire" },
+  { "family": 302, "name": "Incubus", "spellId": 18791, "spellName": "Touch of Fire" },
+  { "family": 15, "name": "Felhunter", "spellId": 18792, "spellName": "Fel Energy" }
+ ],
+ "masterDemonologist": [
+  { "family": 23, "name": "Imp", "valueIndex": 0, "spellId": 23759, "spellName": "Master Demonologist" },
+  { "family": 16, "name": "Voidwalker", "valueIndex": 1, "spellId": 23760, "spellName": "Master Demonologist" },
+  { "family": 17, "name": "Succubus", "valueIndex": 2, "spellId": 23761, "spellName": "Master Demonologist" },
+  { "family": 302, "name": "Incubus", "valueIndex": 2, "spellId": 23761, "spellName": "Master Demonologist" },
+  { "family": 15, "name": "Felhunter", "valueIndex": 3, "spellId": 23762, "spellName": "Master Demonologist" }
+ ],
+ "soulLink": { "spellId": 25228, "spellName": "Soul Link" }
 }
diff --git a/tools/pipeline/build_data.py b/tools/pipeline/build_data.py
index e5f5577..841dc15 100644
--- a/tools/pipeline/build_data.py
+++ b/tools/pipeline/build_data.py
@@ -17,6 +17,7 @@ from pipeline.db2 import MissingTableError, RawDB  # noqa: E402
 from pipeline.icons import IconResolver  # noqa: E402
 from pipeline.items import build_weapons  # noqa: E402
 from pipeline.manual import validate_manual  # noqa: E402
+from pipeline.pets import build_pets  # noqa: E402
 from pipeline.spells import build_ability_chains, build_spell, collect_spells  # noqa: E402
 from pipeline.talents import BuildError, attach_effects, build_talent_trees  # noqa: E402
 from pipeline.targets import build_targets  # noqa: E402
@@ -104,6 +105,7 @@ def run(a):
     weapons, ammo = build_weapons(db, era, manual.get("weapon-overrides.json", {}), icons, report)
 
     coverage = build_coverage(talent_files, spells_by_id, a.build)
+    pet_files = build_pets(db, icons, chains, manual.get("pets.json", {}), report)
 
     # report finishing
     seen = set()
@@ -128,6 +130,7 @@ def run(a):
     final["unknownStatIds"] = report["unknownStatIds"]
     final["manualValidation"] = report.get("manualValidation", [])
     final["warnings"] = report.get("warnings", [])
+    final["petsSkipped"] = report.get("petsSkipped", [])
 
     # ---- write ----
     out = a.out
@@ -151,6 +154,10 @@ def run(a):
     write_records(os.path.join(out, "weapons.json"), {"build": a.build}, {"weapons": weapons, "ammo": ammo})
     write_json(os.path.join(out, "targets.json"), targets)
     write_json(os.path.join(out, "pet-families.json"), pets)
+    # Phase 6: one lazy chunk per pet owner (hunter, warlock).
+    for tok, pf in sorted(pet_files.items()):
+        hdr = {"build": a.build, "classId": pf["classId"], "token": tok}
+        write_records(os.path.join(out, "pets", tok + ".json"), hdr, {"pets": pf["pets"], "spells": pf["spells"]})
     write_records(os.path.join(out, "coverage.json"), {"build": a.build, "summary": coverage["summary"]},
                   {"talents": coverage["talents"]})
     hdr = {k: v for k, v in final.items() if not isinstance(v, list)}
@@ -175,6 +182,8 @@ def run(a):
         "talents": n_talents, "hiddenTalents": n_hidden, "spells": len(spells), "abilityChains": len(chains),
         "weapons": len(weapons), "weaponsEraFallback": sum(1 for w in weapons if w["source"] == "classic_era"),
         "ammo": len(ammo), "targetLevels": len(targets["levels"]), "petFamilies": len(pets["families"]),
+        "pets": sum(len(pf["pets"]) for pf in pet_files.values()),
+        "petSpells": sum(len(pf["spells"]) for pf in pet_files.values()),
     }
     write_json(os.path.join(out, "manifest.json"), manifest)
 
diff --git a/tools/pipeline/constants.py b/tools/pipeline/constants.py
index 44bd3fb..89e6642 100644
--- a/tools/pipeline/constants.py
+++ b/tools/pipeline/constants.py
@@ -3,7 +3,7 @@ import re
 
 BUILD_DEFAULT = "1.60.1.70888"
 ERA_BUILD_DEFAULT = "1.15.9.70576"
-PIPELINE_VERSION = 3
+PIPELINE_VERSION = 4
 
 # (ChrClasses.ID, token, TraitTreeID, ClassMask). Verified against SkillLineXTraitTree + SkillLineAbility.
 CLASS_TREES = [
@@ -165,3 +165,8 @@ TARGET_PRESETS = [
      "note": "[tune] armor halved"},
     {"id": "custom", "label": "Custom", "levelOffset": 3, "armorMultiplier": 1.0, "editable": True},
 ]
+
+# ---- Pets (Phase 6) ----
+# Passive pet scaling auras in each family's skill line ("Hunter Pet Scaling", "Warlock Pet Scaling"; base points 0,
+# values are server-side): they mark the owner class of a CreatureFamily.
+PET_SCALING_SPELLS = {415429: "hunter", 416189: "warlock"}
diff --git a/tools/pipeline/manual.py b/tools/pipeline/manual.py
index 50944cb..bbfa37f 100644
--- a/tools/pipeline/manual.py
+++ b/tools/pipeline/manual.py
@@ -6,7 +6,7 @@ from .util import F, I, num
 
 REQUIRED = {
     "base-stats.json": ["level", "classes", "raceOffsets", "conversions"],
-    "pets.json": ["hunterFamilies", "warlockDemons", "ownerScaling"],
+    "pets.json": ["level", "owners", "sacrifice", "masterDemonologist", "soulLink"],
     "buffs.json": ["buffs", "presets"],
     "racials.json": ["racials"],
     "targets.json": ["named"],
@@ -77,8 +77,9 @@ def validate_manual(manual_dir, db, report):
             _check_effect_sources(fn, d, sid, db, mv)
     fam = {r["ID"]: r["Name_lang"] for r in db.rows("CreatureFamily")}
     pets = data.get("pets.json", {})
-    for grp in ("hunterFamilies", "warlockDemons"):
-        for fid, v in (pets.get(grp) or {}).items():
+    for grp in ("sacrifice", "masterDemonologist"):
+        for v in pets.get(grp) or []:
+            fid = str(v.get("family"))
             if fid not in fam:
                 mv.append({"file": "pets.json", "id": fid, "problem": "CreatureFamily id not found"})
             elif fam[fid].lower() != v.get("name", "").lower():
diff --git a/tools/pipeline/pets.py b/tools/pipeline/pets.py
new file mode 100644
index 0000000..56a5bbd
--- /dev/null
+++ b/tools/pipeline/pets.py
@@ -0,0 +1,99 @@
+"""Phase 6: pets/<owner>.json - hunter pet families and warlock demons with their abilities, passives and spells."""
+import collections
+
+from . import constants as C
+from .spells import Seed, build_spell
+from .util import I, u32
+
+
+def _manual_spell_ids(obj):
+    """Every spellId in a manual JSON object (sacrifice, Master Demonologist and Soul Link auras)."""
+    out = set()
+    if isinstance(obj, dict):
+        if isinstance(obj.get("spellId"), int):
+            out.add(obj["spellId"])
+        for v in obj.values():
+            out |= _manual_spell_ids(v)
+    elif isinstance(obj, list):
+        for v in obj:
+            out |= _manual_spell_ids(v)
+    return out
+
+
+def build_pets(db, icons, chains, manual_pets, report):
+    """Returns {owner token: {"classId", "pets", "spells"}}. A family belongs to the owner whose pet scaling aura
+    (C.PET_SCALING_SPELLS) is in its skill line; a demon also needs a "Summon <name>" warlock ability."""
+    names = db.by_id("SpellName")
+    misc = db.by_spell("SpellMisc")
+    levels = db.by_spell("SpellLevels")
+    effects = db.group("SpellEffect", "SpellID")
+    by_line = collections.defaultdict(set)
+    for r in db.rows("SkillLineAbility"):
+        if r["Spell"] in names:
+            by_line[I(r["SkillLine"])].add(I(r["Spell"]))
+    class_id = {tok.lower(): cid for cid, tok, _, _ in C.CLASS_TREES}
+    summons = {c["name"] for c in chains if c["classId"] == class_id["warlock"]}
+
+    def passive(sid):
+        m = misc.get(str(sid))
+        return bool(m and (u32(I(m["Attributes_0"])) & C.ATTR0_PASSIVE))
+
+    def base_level(sid):
+        lv = levels.get(str(sid))
+        return I(lv["BaseLevel"]) if lv else 0
+
+    pets = collections.defaultdict(list)
+    skipped = []
+    for r in sorted(db.rows("CreatureFamily"), key=lambda r: I(r["ID"])):
+        fid = I(r["ID"])
+        name = r["Name_lang"]
+        line = I(r["SkillLine_0"])
+        sids = sorted(by_line.get(line, ()))
+        owner = next((C.PET_SCALING_SPELLS[s] for s in sids if s in C.PET_SCALING_SPELLS), None)
+        if owner is None:
+            skipped.append({"id": fid, "name": name, "reason": "no pet scaling aura in skill line %d" % line})
+            continue
+        if owner == "warlock" and ("Summon " + name) not in summons:
+            skipped.append({"id": fid, "name": name, "reason": "no Summon %s warlock ability" % name})
+            continue
+        groups = collections.defaultdict(list)
+        for s in sids:
+            if not passive(s):
+                groups[names[str(s)]["Name_lang"]].append(s)
+        abilities = [{"name": n, "ranks": sorted(ids, key=lambda s: (base_level(s), s))}
+                     for n, ids in sorted(groups.items())]
+        pets[owner].append({
+            "id": fid, "name": name, "owner": owner,
+            "icon": icons.resolve(I(r["IconFileID"]), "petFamily", fid), "skillLine": line,
+            "exotic": I(r["PetTalentType"]) == 1, "abilities": abilities,
+            "passives": [s for s in sids if passive(s)],
+        })
+    report["petsSkipped"] = skipped
+
+    manual_ids = _manual_spell_ids(manual_pets)
+    out = {}
+    for owner in sorted(pets):
+        cid = class_id[owner]
+        ids = set(manual_ids if owner == "warlock" else ())
+        for p in pets[owner]:
+            ids |= set(p["passives"])
+            for a in p["abilities"]:
+                ids |= set(a["ranks"])
+        work = collections.deque(sorted(ids))
+        while work:      # closure over triggered spells (Frenzy 20784 -> 19615)
+            sid = work.popleft()
+            for e in effects.get(str(sid), []):
+                t = I(e["EffectTriggerSpell"])
+                if t and str(t) in names and t not in ids:
+                    ids.add(t)
+                    work.append(t)
+        spells = []
+        for sid in sorted(ids):
+            if str(sid) not in names:
+                continue
+            seed = Seed()
+            seed.classes.add(cid)
+            seed.sources.add("pet")
+            spells.append(build_spell(db, sid, seed, icons))
+        out[owner] = {"classId": cid, "pets": pets[owner], "spells": spells}
+    return out
diff --git a/tools/pipeline/tests/test_phase3.py b/tools/pipeline/tests/test_phase3.py
index 79a0f88..c85f798 100644
--- a/tools/pipeline/tests/test_phase3.py
+++ b/tools/pipeline/tests/test_phase3.py
@@ -60,7 +60,7 @@ class TestPhase3(unittest.TestCase):
 
     def test_manual_values_match_spell_effects(self):
         self.assertEqual(load(self.d, "report.json")["manualValidation"], [])
-        self.assertEqual(load(self.d, "manifest.json")["pipelineVersion"], 3)
+        self.assertEqual(load(self.d, "manifest.json")["pipelineVersion"], 4)
 
 
 @needs_raw
diff --git a/tools/pipeline/tests/test_phase4.py b/tools/pipeline/tests/test_phase4.py
index 6d792d7..ddc2093 100644
--- a/tools/pipeline/tests/test_phase4.py
+++ b/tools/pipeline/tests/test_phase4.py
@@ -32,7 +32,7 @@ class TestPhase4(unittest.TestCase):
         self.assertEqual([(e["effect"], e["base"], e["spCoef"]) for e in jc["effects"]], [(2, 356, 0.429)])
         self.assertIn(20286, pal)  # Judgement of Righteousness
         self.assertNotIn(707, pal)  # Seal of Fury DUMMY base 707 (Immolate) is a number, not a judgement
-        self.assertEqual(load(self.d, "manifest.json")["pipelineVersion"], 3)
+        self.assertEqual(load(self.d, "manifest.json")["pipelineVersion"], 4)
 
 
 if __name__ == "__main__":
diff --git a/tools/pipeline/tests/test_phase6.py b/tools/pipeline/tests/test_phase6.py
new file mode 100644
index 0000000..32c3a57
--- /dev/null
+++ b/tools/pipeline/tests/test_phase6.py
@@ -0,0 +1,62 @@
+"""Phase 6 pipeline additions: pets/<owner>.json (pet families, demons, their abilities, passives and spells)."""
+import unittest
+
+from ._fixtures import build_dir, load, needs_raw
+
+
+@needs_raw
+class TestPhase6(unittest.TestCase):
+    def setUp(self):
+        self.d = build_dir()
+        self.hunter = load(self.d, "pets/hunter.json")
+        self.warlock = load(self.d, "pets/warlock.json")
+
+    def pet(self, f, name):
+        return next(p for p in f["pets"] if p["name"] == name)
+
+    def spell(self, f, sid):
+        return next(s for s in f["spells"] if s["id"] == sid)
+
+    def test_owners_and_families(self):
+        self.assertEqual((self.hunter["token"], self.hunter["classId"]), ("hunter", 3))
+        self.assertEqual((self.warlock["token"], self.warlock["classId"]), ("warlock", 9))
+        self.assertEqual(len(self.hunter["pets"]), 19)
+        self.assertEqual([p["name"] for p in self.warlock["pets"]],
+                         ["Felhunter", "Voidwalker", "Succubus", "Imp", "Incubus"])
+        self.assertEqual([p["id"] for p in self.hunter["pets"] if p["exotic"]], [312])  # Core Hound
+        skipped = {s["name"] for s in load(self.d, "report.json")["petsSkipped"]}
+        self.assertEqual(skipped, {"Doomguard", "Remote Control", "Felguard"})
+        m = load(self.d, "manifest.json")["counts"]
+        self.assertEqual((m["pets"], m["petSpells"]), (24, len(self.hunter["spells"]) + len(self.warlock["spells"])))
+
+    def test_cat_abilities_and_passives(self):
+        cat = self.pet(self.hunter, "Cat")
+        abil = {a["name"]: a["ranks"] for a in cat["abilities"]}
+        self.assertEqual(sorted(abil), ["Bite", "Claw", "Dash", "Prowl"])
+        self.assertEqual(abil["Claw"][-1], 3009)   # rank 8, level 56: 51 physical damage (variance 0.3137)
+        self.assertEqual(abil["Bite"][-1], 17261)  # rank 8, level 56: 90, 10 s cooldown, 35 focus
+        claw = self.spell(self.hunter, 3009)
+        self.assertEqual([(e["effect"], e["base"]) for e in claw["effects"]], [(2, 51)])
+        self.assertEqual((claw["costs"][0]["powerType"], claw["costs"][0]["amount"], claw["defenseType"]), (2, 25, 2))
+        self.assertEqual(cat["passives"], [8875, 17210, 19580, 19581, 19582, 19589, 19591, 20782, 20784, 409365, 415429])
+        fam = self.spell(self.hunter, 17210)  # Cat family passive: +10% physical damage
+        self.assertEqual([(e["aura"], e["base"], e["misc"][0]) for e in fam["effects"]][0], (79, 10, 1))
+        frenzy = self.spell(self.hunter, 19615)  # triggered by 20784 (talent Frenzy): +30% melee haste, 8 s
+        self.assertEqual(([(e["aura"], e["base"]) for e in frenzy["effects"]], frenzy["duration"]["ms"]), ([(319, 30)], 8000))
+
+    def test_demons_and_owner_auras(self):
+        imp = self.pet(self.warlock, "Imp")
+        fb = next(a for a in imp["abilities"] if a["name"] == "Firebolt")["ranks"]
+        self.assertEqual(fb[-1], 11763)
+        s = self.spell(self.warlock, 11763)
+        e0 = s["effects"][0]
+        self.assertEqual((e0["effect"], e0["base"], e0["perLevel"], e0["spCoef"], s["castMs"]), (2, 44, 0.6, 0.571, 2000))
+        self.assertEqual(s["family"]["set"], 5)
+        for sid, school in ((18789, 32), (18791, 4), (23759, 4), (23761, 32), (25228, 127)):
+            e = self.spell(self.warlock, sid)["effects"][0]
+            self.assertEqual((e["aura"], e["misc"][0]), (79, school), sid)
+        self.assertEqual(self.spell(self.warlock, 18789)["effects"][0]["base"], 15)  # Burning Shadow (Imp sacrifice)
+
+
+if __name__ == "__main__":
+    unittest.main()
````

### 6.2 B2: data types and loaders (task T5)

````diff
diff --git a/src/data/index.ts b/src/data/index.ts
index e8f1ff3..b902d89 100644
--- a/src/data/index.ts
+++ b/src/data/index.ts
@@ -1,6 +1,7 @@
 import targetsJson from "@data/targets.json";
 import baseStatsJson from "@manual/base-stats.json";
 import buffsJson from "@manual/buffs.json";
+import petsJson from "@manual/pets.json";
 import racialsJson from "@manual/racials.json";
 import rotationsJson from "@manual/rotations.json";
 import type {
@@ -11,6 +12,8 @@ import type {
   ClassSpellFile,
   ClassToken,
   Manifest,
+  PetFile,
+  PetsManualFile,
   RaceInfo,
   RacialsFile,
   RotationsFile,
@@ -56,6 +59,7 @@ export const baseStatsFile = baseStatsJson as unknown as BaseStatsFile;
 export const buffsFile = buffsJson as unknown as BuffsFile;
 export const racialsFile = racialsJson as unknown as RacialsFile;
 export const rotationsFile = rotationsJson as unknown as RotationsFile;
+export const petsManual = petsJson as unknown as PetsManualFile;
 
 export function getRace(id: number): RaceInfo {
   const r = classesFile.races.find((x) => x.id === id);
@@ -85,3 +89,17 @@ export function loadClassSpells(token: ClassToken): Promise<ClassSpellFile> {
   spellCache.set(token, p);
   return p;
 }
+
+const petLoaders = import.meta.glob<{ default: unknown }>("@data/pets/*.json");
+const petCache = new Map<ClassToken, Promise<PetFile | null>>();
+/** pets/<owner>.json (Phase 6, ~10 KB gzip): hunter and warlock only; null for every other class. */
+export function loadPetFile(token: ClassToken): Promise<PetFile | null> {
+  const hit = petCache.get(token);
+  if (hit) return hit;
+  const key = Object.keys(petLoaders).find((k) => k.endsWith(`/pets/${token}.json`));
+  const loader = key ? petLoaders[key] : undefined;
+  const p = loader ? loader().then((m) => m.default as unknown as PetFile) : Promise.resolve(null);
+  p.catch(() => petCache.delete(token));
+  petCache.set(token, p);
+  return p;
+}
diff --git a/src/data/types.ts b/src/data/types.ts
index fb5c027..7de4c0e 100644
--- a/src/data/types.ts
+++ b/src/data/types.ts
@@ -345,7 +345,7 @@ export interface SpellCost {
   perSecond: number;
   optional: number;
 }
-export type SpellSource = "ability" | "talent" | "triggered";
+export type SpellSource = "ability" | "talent" | "triggered" | "pet"; // "pet": pets/<owner>.json (Phase 6)
 export interface Spell {
   id: number;
   name: string;
@@ -464,3 +464,72 @@ export interface RotationsFile {
   _status: string;
   rotations: SpecRotation[];
 }
+
+// ---- Phase 6: pets (data/generated/<build>/pets/<owner>.json, docs/phase6-implementation-plan.md section 2) ----
+/** A pet ability: one rank chain of the family's skill line, ranks by learn level. */
+export interface PetAbilityChain {
+  name: string;
+  ranks: number[];
+}
+/** A hunter pet family or a warlock demon (CreatureFamily row whose skill line has the owner's pet scaling aura). */
+export interface PetInfo {
+  id: number; // CreatureFamily.ID (stable URL key)
+  name: string;
+  owner: ClassToken;
+  icon: string | null;
+  skillLine: number;
+  exotic: boolean; // CreatureFamily.PetTalentType 1 (Core Hound)
+  abilities: PetAbilityChain[]; // active spells of the skill line
+  passives: number[]; // passive spells (family damage modifier, talent-modified passives, pet scaling)
+}
+export interface PetFile {
+  build: string;
+  classId: number;
+  token: ClassToken;
+  pets: PetInfo[];
+  spells: Spell[]; // abilities, passives, triggered spells and the auras data/manual/pets.json refers to
+}
+
+// ---- Phase 6: data/manual/pets.json ----
+/** Level-60 pet base stats (server-side, not in client data) [VERIFY Q69]. */
+export interface PetBaseStats {
+  str: number;
+  agi: number;
+  sta: number;
+  int: number;
+  spi: number;
+  apPerStr: number; // attack power = apPerStr x Str + apFlat
+  apFlat: number;
+  minDamage: number; // melee damage per swing before attack power
+  maxDamage: number;
+  speedMs: number;
+  meleeCrit: number; // % before talents and target
+  spellCrit: number;
+}
+export interface PetOwnerConfig {
+  base: PetBaseStats;
+  /** Owner scaling (Q5): % of the owner's ranged attack power (hunter) or spell power (warlock, max of fire/shadow). */
+  scaling: {
+    from: "rangedAttackPower" | "spellPower";
+    attackPowerPct: number;
+    spellPowerPct: number;
+    inheritHit: boolean;
+  };
+  focus: { max: number; perSecond: number } | null; // null: the pet's mana is not modeled (unlimited)
+  noMelee: number[]; // family ids that never melee (Imp)
+}
+export interface PetAuraRef {
+  family: number;
+  name: string;
+  spellId: number;
+  spellName: string;
+}
+export interface PetsManualFile {
+  _source: string;
+  _status: string;
+  level: number;
+  owners: Partial<Record<ClassToken, PetOwnerConfig>>;
+  sacrifice: PetAuraRef[]; // Demonic Sacrifice: buff of the sacrificed demon (server script, not in client data)
+  masterDemonologist: (PetAuraRef & { valueIndex: number })[]; // talent value index per demon
+  soulLink: { spellId: number; spellName: string };
+}
````

### 6.3 B3: owner-side hooks: Lone Wolf, `petOwnerEffects`, focus income, Lone Wolf text (task T5)

````diff
diff --git a/src/engine/rotation/analytical.ts b/src/engine/rotation/analytical.ts
index 5c940f1..74dda30 100644
--- a/src/engine/rotation/analytical.ts
+++ b/src/engine/rotation/analytical.ts
@@ -26,6 +26,7 @@ export interface RotationInput {
   white: { mainHand: WhiteResult | null; offHand: WhiteResult | null; ranged: WhiteResult | null };
   ctx: DamageContext;
   talentRank(name: string): number;
+  focusPerMinute?: number; // Phase 6: pet focus regeneration (the only focus user)
 }
 
 /** Resource the rotation spends: rage (warrior), energy (rogue, Cat Form), else mana. */
@@ -56,6 +57,7 @@ export function runRotation(input: RotationInput): RotationResult {
   const ranged = rotation.autoShot ? input.white.ranged : null;
   let income = 0;
   if (power === "energy") income = ENERGY_PER_SECOND * MINUTE;
+  if (power === "focus") income = input.focusPerMinute ?? 0;
   if (power === "rage") {
     for (const w of [mh, oh]) if (w) income += (MINUTE / w.speed) * ragePerSwing(w, ctx.level);
     income += effects.reduce((a, fx) => a + (fx.ragePerMinute ?? 0), 0);
diff --git a/src/engine/rotation/prepare.ts b/src/engine/rotation/prepare.ts
index 4d11a06..f15504d 100644
--- a/src/engine/rotation/prepare.ts
+++ b/src/engine/rotation/prepare.ts
@@ -13,6 +13,8 @@ import { activeHandlers, type ActiveHandler } from "@/engine/talents/special";
 import { selfBuffEffects, selfBuffSpells } from "./selfBuffs";
 
 export interface PrepareArgs extends Omit<AssembleArgs, "extraEffects" | "formMask"> {
+  /** Phase 6: effects of the pet choice on the owner (resolvePet: Focused Fire, Master Demonologist, sacrifice ...). */
+  petOwnerEffects?: readonly SourcedEffect[];
   spells: ClassSpellFile;
   spellClassSet: number; // ClassInfo.spellClassSet
   classTalents: readonly Talent[];
@@ -56,6 +58,7 @@ export function prepareDamage(a: PrepareArgs): Prepared {
       : []),
     ...selfBuffEffects(selfBuffs),
     ...handlers.flatMap((h) => h.handler.stats?.(h.args, { weapons: a.weapons, form, level: a.level }) ?? []),
+    ...(a.petOwnerEffects ?? []),
   ];
   const assembled = assemble({ ...a, extraEffects: extra, formMask: mask });
   return { assembled, stats: computeCharacter(assembled.input), book, selfBuffs, handlers };
diff --git a/src/engine/stats/assemble.ts b/src/engine/stats/assemble.ts
index 62264cb..d35d4d2 100644
--- a/src/engine/stats/assemble.ts
+++ b/src/engine/stats/assemble.ts
@@ -18,6 +18,8 @@ export interface AssembleArgs {
   extraEffects?: readonly SourcedEffect[];
   /** Phase 4: ShapeshiftMask bit of the rotation's form (0 = no form). */
   formMask?: number;
+  /** Phase 6: a pet is active (Lone Wolf turns off). */
+  petActive?: boolean;
 }
 export interface Assembled {
   input: CharacterInput;
@@ -49,7 +51,7 @@ export function assemble(a: AssembleArgs): Assembled {
       else effects.push(strip(e, b.name, "buff"));
     }
   }
-  const mapping = mapTalents(a.talents, a.weapons, a.formMask ?? 0);
+  const mapping = mapTalents(a.talents, a.weapons, a.formMask ?? 0, a.petActive ?? false);
   effects.push(...mapping.applied, ...mapping.damageDone, ...(a.extraEffects ?? []));
   return {
     input: {
diff --git a/src/engine/stats/talentEffects.ts b/src/engine/stats/talentEffects.ts
index 93d8e4f..c2aa197 100644
--- a/src/engine/stats/talentEffects.ts
+++ b/src/engine/stats/talentEffects.ts
@@ -46,6 +46,8 @@ const IGNORED_AURAS = new Set([
   142, 154, 172, 175, 178, 185, 186, 232, 268, 271, 466,
 ]);
 const WEAPON_SKILL_LINES = new Set(Object.keys(WEAPON_SKILL_LINE_SUBCLASSES).map(Number));
+/** Phase 6: talents active only without a pet. Lone Wolf (415370): "while you do not have an active pet". */
+export const NO_PET_TALENTS: ReadonlySet<number> = new Set([415370]);
 
 export type NotModeledReason = "spellMod" | "special" | "unsupported" | "ability" | "inactive";
 export interface NotModeled {
@@ -211,6 +213,7 @@ export function mapTalents(
   list: readonly RankedTalent[],
   weapons: EquippedWeapons,
   formMask = 0,
+  petActive = false,
 ): TalentMapping {
   const out: TalentMapping = { applied: [], damageDone: [], spellMods: [], notModeled: [] };
   for (const { talent: t, rank } of list) {
@@ -228,6 +231,10 @@ export function mapTalents(
       note("inactive", "requires a shapeshift form that the rotation does not use");
       continue;
     }
+    if (petActive && NO_PET_TALENTS.has(t.spellId)) {
+      note("inactive", "only without an active pet");
+      continue;
+    }
     const slots = matchingSlots(t.equipped, weapons);
     const inactive = t.equipped !== null && slots.length === 0;
     for (const [pos, e] of t.effects.entries()) {
diff --git a/src/engine/talents/special/handlers.ts b/src/engine/talents/special/handlers.ts
index e1e652e..fcb788d 100644
--- a/src/engine/talents/special/handlers.ts
+++ b/src/engine/talents/special/handlers.ts
@@ -320,8 +320,7 @@ const HANDLERS: SpecialHandler[] = [
   {
     spellId: 415370,
     name: "Lone Wolf",
-    modeled:
-      "+20% damage applied (aura 79): pets are not modeled until Phase 6, so the hunter never has an active pet.",
+    modeled: "+20% damage (aura 79) while no pet is active; choosing a pet in the Pet panel turns it off.",
   },
 ];
 
````

### 6.4 B4: `src/engine/pets/` incl. `pets.test.ts` (task T6)

````diff
diff --git a/src/engine/pets/constants.ts b/src/engine/pets/constants.ts
new file mode 100644
index 0000000..ad3e25e
--- /dev/null
+++ b/src/engine/pets/constants.ts
@@ -0,0 +1,40 @@
+// Phase 6 pet constants. Talent and spell ids are Forever data (talents/<class>.json, pets/<owner>.json); the
+// server-side numbers (base stats, owner scaling, focus) are in data/manual/pets.json ([VERIFY], Q5, Q69-Q73).
+
+/** Owner talents the pet engine models (ids of talents/<class>.json). */
+export const PET_TALENT = {
+  /** Hunter BM, DUMMY: "Increases all damage you and your pet deal by x% while your pet is active" (values[0]). */
+  FOCUSED_FIRE: 1223755,
+  /** Hunter BM ability: auras on the pet (target 5), aura 79 +50% damage for 18 s (a pet burst in the simulator). */
+  BESTIAL_WRATH: 19574,
+  /** Warlock Demonology, DUMMY values [imp, voidwalker, succubus, felhunter]: the demon's aura in pets.json. */
+  MASTER_DEMONOLOGIST: 23785,
+  /** Warlock ability: Soul Link aura (pets.json soulLink) "both the Demon and the master inflict 3% more damage". */
+  SOUL_LINK: 19028,
+  /** Warlock, DUMMY: "spell damage ... by up to x% of your level while you have a summoned Demon" (values[0]). */
+  DEMONIC_KNOWLEDGE: 412732,
+  /** Warlock ability: sacrifice the demon for its buff (pets.json sacrifice). */
+  DEMONIC_SACRIFICE: 18788,
+  /** Warlock: "Your Demonic Sacrifice effect is no longer cancelled by summoning a different Demon pet". */
+  DEMONIC_PACT: 425464,
+} as const;
+export const PET_TALENT_IDS: ReadonlySet<number> = new Set(Object.values(PET_TALENT));
+
+/** Race key of the pet's own base-stat table (computeCharacter input; the class key is the owner's). */
+export const PET_RACE = "PET";
+/** Item subclass of the pet's synthetic weapon (13 fist weapon: no normalized-speed rule applies). */
+export const PET_WEAPON_SUBCLASS = 13;
+/** Effects that apply an aura to the pet: 6 apply aura, 35 party aura, 65 raid aura, 119 pet area aura, 143 owner area aura. */
+export const PET_AURA_EFFECTS: ReadonlySet<number> = new Set([6, 35, 65, 119, 143]);
+export const TARGET_CASTER = 1;
+export const TARGET_PET = 5;
+/** Aura 110 MOD_POWER_REGEN_PERCENT; misc[0] 2 = focus (passive 19589, modified by Bestial Discipline). */
+export const AURA_POWER_REGEN_PCT = 110;
+export const POWER_FOCUS = 2;
+/** Aura 42 PROC_TRIGGER_SPELL (passive 20784 -> Frenzy 19615); SpellModOp 18 = proc chance (talent Frenzy). */
+export const AURA_PROC_TRIGGER = 42;
+export const OP_PROC_CHANCE = 18;
+/** Aura 79 MOD_DAMAGE_PERCENT_DONE. */
+export const AURA_DAMAGE_DONE = 79;
+/** RNG stream of the pet: iteration seeds are mixed with this value, so the player's stream is unchanged. */
+export const PET_STREAM = 0x50455431;
diff --git a/src/engine/pets/evaluate.ts b/src/engine/pets/evaluate.ts
new file mode 100644
index 0000000..3d0ba6a
--- /dev/null
+++ b/src/engine/pets/evaluate.ts
@@ -0,0 +1,143 @@
+import type { SpecRotation, Spell, Talent, TargetsFile } from "@/data/types";
+import {
+  evaluateAbility,
+  evaluateWhite,
+  talentModSources,
+  type AbilityEval,
+  type AbilityResult,
+  type DamageContext,
+  type RotationEffect,
+  type WhiteResult,
+} from "@/engine/abilities";
+import { runRotation, type RotationResult } from "@/engine/rotation";
+import {
+  evaluateTarget,
+  type CharacterStats,
+  type RankedTalent,
+  type SpellMod,
+  type TargetInput,
+} from "@/engine/stats";
+import { petBook, petRotation } from "./rotation";
+import { computePetStats, petAuras, type PetAuras } from "./stats";
+import type { PetDamage, PetSetup } from "./types";
+
+const MINUTE = 60;
+const AURA_MELEE_HASTE = 319;
+
+/** Everything the pet engine needs besides the pet: the owner's evaluated character and the target. */
+export interface PetEvalArgs {
+  setup: PetSetup;
+  level: number;
+  owner: CharacterStats; // the owner's stats (scaling)
+  ownerSpells: readonly Spell[]; // spells/<class>.json (Bestial Wrath)
+  classSet: number;
+  talents: readonly RankedTalent[];
+  classTalents: readonly Talent[];
+  spellMods: readonly SpellMod[]; // the owner's talent spell modifiers (they modify pet spells and passives)
+  target: TargetInput;
+  armorFormula: TargetsFile["armorFormula"];
+}
+
+/** One evaluation of the pet with a set of active pet buffs (the simulator memoizes one per buff set). */
+export interface PetState {
+  ctx: DamageContext;
+  rotation: SpecRotation;
+  abilities: AbilityEval[]; // per rotation entry
+  white: WhiteResult | null; // named "Melee"
+  auras: PetAuras;
+  focusPerSecond: number | null; // null: the pet has no focus (demons: mana is not modeled)
+}
+
+export function petState(
+  a: PetEvalArgs,
+  buffs: readonly Spell[] = [],
+  effects: readonly RotationEffect[] = [],
+): PetState {
+  const mods = talentModSources(a.spellMods, a.talents);
+  const auras = petAuras(a.setup, buffs, mods, a.classSet, a.level);
+  const { stats, weapons } = computePetStats(a.setup, { level: a.level, owner: a.owner, auras });
+  const view = evaluateTarget(stats, a.target, a.armorFormula, false);
+  const book = petBook(a.setup, a.ownerSpells, a.classSet);
+  const rotation = petRotation(a.setup, book, a.level, a.talents, a.classTalents);
+  const ctx: DamageContext = {
+    level: a.level,
+    stats,
+    view,
+    book,
+    weapons,
+    form: null,
+    talents: a.talents,
+    classTalents: a.classTalents,
+    mods,
+    selfBuffs: [],
+    effects,
+    rotationAbilities: new Set(rotation.entries.map((e) => e.ability)),
+    abilityHooks: [],
+  };
+  // Owner abilities in the pet's list (Bestial Wrath) cost the owner's mana, not the pet's resource.
+  const abilities = rotation.entries.map((entry) => {
+    const x = evaluateAbility(entry, ctx);
+    return entry.kind === "burst" && x.available ? { ...x, power: null, cost: 0 } : x;
+  });
+  const w = rotation.melee ? evaluateWhite(ctx, "mainHand") : null;
+  const focus = a.setup.config.focus;
+  return {
+    ctx,
+    rotation,
+    abilities,
+    white: w ? { ...w, name: "Melee" } : null,
+    auras,
+    focusPerSecond: focus ? focus.perSecond * (1 + auras.focusRegenPct / 100) : null,
+  };
+}
+
+/** Frenzy (analytical): +x% melee haste for d seconds after a crit at the talent's chance; Poisson uptime. */
+function frenzyEffect(auras: PetAuras, r: RotationResult): RotationEffect | null {
+  const f = auras.frenzy;
+  if (!f) return null;
+  const w = r.white.mainHand;
+  let crits = w ? (w.swingsPerMinute * w.white.critChance) / 100 : 0;
+  for (const c of r.casts)
+    if (c.ability.kind === "melee")
+      crits += (c.perMinute * c.ability.hitChance * Math.min(100, c.ability.critChance)) / 10000;
+  const haste = f.spell.effects.find((e) => e.aura === AURA_MELEE_HASTE)?.base ?? 0;
+  const sec = (f.spell.duration?.ms ?? 0) / 1000;
+  const uptime = 1 - Math.exp((-crits * (f.chance / 100) * sec) / MINUTE);
+  return haste > 0 && uptime > 0 ? { label: `${f.label}: Frenzy`, meleeHastePct: haste * uptime } : null;
+}
+
+/**
+ * Analytical pet damage (section 4.5): the pet's priority list through the Phase 4 rotation model (focus income from
+ * pets.json and Bestial Discipline), two passes for the Frenzy uptime. Bursts (Bestial Wrath) are simulation only.
+ */
+export function evaluatePet(a: PetEvalArgs): PetDamage {
+  const pass = (effects: RotationEffect[]) => {
+    const st = petState(a, [], effects);
+    const rotation = runRotation({
+      rotation: st.rotation,
+      evals: st.rotation.entries.map((entry, i) => ({ entry, ability: st.abilities[i]! })),
+      white: { mainHand: st.white, offHand: null, ranged: null },
+      ctx: st.ctx,
+      talentRank: () => 0,
+      focusPerMinute: (st.focusPerSecond ?? 0) * MINUTE,
+    });
+    return { st, rotation };
+  };
+  const p1 = pass([]);
+  const fx = frenzyEffect(p1.st.auras, p1.rotation);
+  const p2 = fx ? pass([fx]) : p1;
+  return {
+    name: a.setup.info.name,
+    icon: a.setup.info.icon,
+    stats: p2.st.ctx.stats,
+    view: p2.st.ctx.view,
+    ctx: p2.st.ctx,
+    rotation: p2.rotation,
+    abilities: p2.st.abilities,
+    effects: fx ? [fx] : [],
+    focusPerSecond: p2.st.focusPerSecond,
+  };
+}
+
+export const availablePetAbilities = (p: PetDamage): AbilityResult[] =>
+  p.abilities.filter((x): x is AbilityResult => x.available);
diff --git a/src/engine/pets/index.ts b/src/engine/pets/index.ts
new file mode 100644
index 0000000..66011f4
--- /dev/null
+++ b/src/engine/pets/index.ts
@@ -0,0 +1,6 @@
+export * from "./constants";
+export * from "./types";
+export * from "./setup";
+export * from "./stats";
+export * from "./rotation";
+export * from "./evaluate";
diff --git a/src/engine/pets/pets.test.ts b/src/engine/pets/pets.test.ts
new file mode 100644
index 0000000..65e787e
--- /dev/null
+++ b/src/engine/pets/pets.test.ts
@@ -0,0 +1,185 @@
+// Phase 6 pet engine: goldens verified by the independent Python script in docs/phase6-implementation-plan.md 8.1.
+import { describe, expect, it } from "vitest";
+import type { ClassToken } from "@/data/types";
+import { runDamage } from "@/testkit/damage";
+import { petFile, scenarioPet } from "@/testkit/pets";
+import { ranked } from "@/testkit/stats";
+import { treeFor } from "@/testkit/talents";
+import { PET_TALENT } from "./constants";
+
+const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);
+function maxed(token: ClassToken, spec: number): Record<string, number> {
+  const out: Record<string, number> = {};
+  for (const n of treeFor(token).nodes.values())
+    if (n.specIndex === spec) out[n.talent.name] = n.talent.maxRank;
+  return out;
+}
+
+describe("pet data", () => {
+  it("pet files: 19 hunter families, 5 summonable demons; Felguard and Doomguard are not pets", () => {
+    expect(petFile("hunter")!.pets).toHaveLength(19);
+    expect(
+      petFile("warlock")!
+        .pets.map((p) => p.name)
+        .sort(),
+    ).toEqual(["Felhunter", "Imp", "Incubus", "Succubus", "Voidwalker"]);
+    expect(petFile("mage")).toBeNull();
+  });
+});
+
+describe("golden: pets vs boss (level 63, 3731 armor, DR 40.42%)", () => {
+  it("P1 Dwarf hunter, Cat, owner scaling: AP 252 + 22% of 615 RAP, family +10%", () => {
+    const r = runDamage({
+      classToken: "hunter",
+      race: "DWARF",
+      rotation: "hunter-beast-mastery",
+      pet: { family: "Cat" },
+    });
+    const p = r.pet!;
+    near(p.stats.attackPower.value, 387.3);
+    const w = p.rotation.white.mainHand!;
+    near(w.white.normalHit, 75.586378);
+    near(w.white.expectedPerSwing, 56.009506);
+    expect(w.white.speed).toBe(2);
+    expect([p.view.mainHand!.miss.value, p.view.mainHand!.dodge.value, p.view.mainHand!.glancing]).toEqual([
+      8, 6.5, 40,
+    ]);
+    near(r.petAbility("Claw").hit, 33.425414);
+    near(r.petAbility("Claw").expected, 29.321776);
+    near(r.petAbility("Bite").hit, 58.986025);
+    near(r.petAbility("Bite").expected, 51.744311);
+    expect(p.focusPerSecond).toBe(6);
+    expect(p.rotation.casts.map((c) => [c.key, c.perMinute])).toEqual([
+      ["Bite", 6],
+      ["Claw", 6],
+    ]);
+    near(p.rotation.dps, 36.111362);
+    near(r.totalDps, r.result.rotation.dps + 36.111362);
+  });
+  it("P2 warlock +300 SP, Improved Imp 3/3, Master Demonologist 5/5, Imp: Firebolt (45.2 + 0.571 x 45) x 1.3 x 1.1 x 0.94", () => {
+    const s = {
+      classToken: "warlock" as const,
+      race: "HUMAN",
+      bonus: { spellPower: 300 },
+      talents: { "Improved Imp": 3, "Master Demonologist": 5 },
+      rotation: "warlock-destruction",
+    };
+    const r = runDamage({ ...s, pet: { family: "Imp" } });
+    expect(r.pet!.stats.spellPower.fire.value).toBe(45);
+    expect(r.pet!.view.spell.miss.value).toBe(17);
+    const fb = r.petAbility("Firebolt");
+    near(fb.hit, 95.297059);
+    near(fb.crit, 142.945589);
+    near(fb.expected, 81.073973);
+    near(r.pet!.rotation.dps, 40.536986);
+    expect(r.pet!.rotation.white).toEqual({}); // the Imp does not melee
+    // Master Demonologist (Imp): +10% fire damage for the warlock too
+    const alone = runDamage(s);
+    expect(r.result.rotation.dps).toBeGreaterThan(alone.result.rotation.dps);
+    expect(r.resolved.ownerEffects.map((e) => [e.label, e.value, e.schools])).toEqual([
+      ["Master Demonologist 5/5", 10, ["fire"]],
+    ]);
+  });
+});
+
+describe("talents and choices", () => {
+  it("BM talents modify the pet passives: Unleashed Fury +15%, Ferocity +10% crit, Bestial Discipline +20% focus, Frenzy uptime", () => {
+    const r = runDamage({
+      classToken: "hunter",
+      race: "DWARF",
+      talents: maxed("hunter", 0),
+      rotation: "hunter-beast-mastery",
+      pet: { family: "Cat" },
+    });
+    const p = r.pet!;
+    const labels = p.stats.damageDone.map((e) => [e.label, e.value]);
+    expect(labels).toEqual(
+      expect.arrayContaining([
+        ["Unleashed Fury 5/5", 15],
+        ["Cat (family)", 10],
+        ["Focused Fire 2/2", 2],
+      ]),
+    );
+    near(p.stats.crit.mainHand.value, 15); // 5 base + Ferocity 10
+    near(p.focusPerSecond!, 7.2);
+    expect(p.effects[0]!.label).toBe("Frenzy 5/5: Frenzy");
+    expect(p.effects[0]!.meleeHastePct!).toBeGreaterThan(10);
+    expect(p.rotation.skipped).toEqual([
+      { ability: "Bestial Wrath", reason: "cooldown buff: simulation only" },
+    ]);
+  });
+  it("Lone Wolf turns off with an active pet", () => {
+    const s = {
+      classToken: "hunter" as const,
+      race: "DWARF",
+      talents: { "Lone Wolf": 1 },
+      rotation: "hunter-marksmanship",
+    };
+    expect(runDamage(s).stats.damageDone.map((e) => e.label)).toEqual(["Lone Wolf 1/1"]);
+    const withPet = runDamage({ ...s, pet: { family: "Cat" } });
+    expect(withPet.stats.damageDone).toEqual([]);
+    expect(withPet.assembled.mapping.notModeled.find((n) => n.name === "Lone Wolf")?.reason).toBe("inactive");
+  });
+  it("Demonic Sacrifice: needs the talent; a summoned demon cancels it unless Demonic Pact keeps it", () => {
+    const talents = (names: Record<string, number>) => ranked("warlock", names);
+    const sac = scenarioPet("warlock", { sacrifice: "Imp" }, talents({ "Demonic Sacrifice": 1 }));
+    expect(sac.pet).toBeNull();
+    expect(sac.ownerEffects.map((e) => [e.label, e.value, e.schools])).toEqual([
+      ["Demonic Sacrifice (Imp): Burning Shadow", 15, ["shadow"]],
+    ]);
+    expect(scenarioPet("warlock", { sacrifice: "Imp" }, talents({})).notes).toEqual([
+      "Demonic Sacrifice needs the talent Demonic Sacrifice.",
+    ]);
+    const both = scenarioPet(
+      "warlock",
+      { family: "Succubus", sacrifice: "Imp" },
+      talents({ "Demonic Sacrifice": 1 }),
+    );
+    expect(both.ownerEffects).toEqual([]);
+    expect(both.notes[0]).toMatch(/cancels Demonic Sacrifice/);
+    const pact = scenarioPet(
+      "warlock",
+      { family: "Succubus", sacrifice: "Imp" },
+      talents({ "Demonic Sacrifice": 1, "Demonic Pact": 1 }),
+    );
+    expect(pact.pet!.info.name).toBe("Succubus");
+    expect(pact.ownerEffects.map((e) => e.label)).toEqual(["Demonic Sacrifice (Imp): Burning Shadow"]);
+    const fh = scenarioPet("warlock", { sacrifice: "Felhunter" }, talents({ "Demonic Sacrifice": 1 }));
+    expect(fh.notes).toEqual(["Fel Energy (Felhunter) restores health or mana: no damage effect."]);
+    expect(PET_TALENT.DEMONIC_PACT).toBe(425464);
+  });
+  it("Soul Link and Demonic Knowledge apply to warlock and demon", () => {
+    const r = scenarioPet(
+      "warlock",
+      { family: "Felhunter" },
+      ranked("warlock", { "Soul Link": 1, "Demonic Knowledge": 3 }),
+    );
+    expect(r.pet!.effects.map((e) => [e.label, e.key, e.value])).toEqual([
+      ["Soul Link", "damageDonePct", 3],
+      ["Demonic Knowledge 3/3 (100% of level 60)", "spellPower", 60],
+    ]);
+    expect(r.ownerEffects).toEqual(r.pet!.effects);
+  });
+  it("scaling off: base attack power only, no inherited hit; pet rotations come from the data", () => {
+    const r = runDamage({
+      classToken: "hunter",
+      race: "DWARF",
+      rotation: "hunter-beast-mastery",
+      pet: { family: "Wind Serpent", scaling: false },
+    });
+    expect(r.pet!.stats.attackPower.value).toBe(252);
+    expect(r.pet!.rotation.rotation.entries.map((e) => [e.ability, e.kind])).toEqual([
+      ["Bite", "cooldown"],
+      ["Lightning Breath", "filler"],
+    ]);
+    const raptor = runDamage({
+      ...{ classToken: "hunter" as const, race: "DWARF", rotation: "hunter-beast-mastery" },
+      pet: { family: "Raptor" },
+    });
+    expect(raptor.pet!.rotation.rotation.entries.map((e) => e.ability)).toEqual([
+      "Savage Rend",
+      "Bite",
+      "Claw",
+    ]);
+  });
+});
diff --git a/src/engine/pets/rotation.ts b/src/engine/pets/rotation.ts
new file mode 100644
index 0000000..db35921
--- /dev/null
+++ b/src/engine/pets/rotation.ts
@@ -0,0 +1,88 @@
+import type { PetInfo, RotationEntry, SpecRotation, Spell, Talent } from "@/data/types";
+import { buildSpellbook, learn, type Spellbook } from "@/engine/abilities";
+import type { RankedTalent } from "@/engine/stats";
+import { AURA_DAMAGE_DONE, TARGET_PET } from "./constants";
+import type { PetSetup } from "./types";
+
+const DIRECT = new Set([2, 17, 31, 58, 121]); // school damage, weapon damage
+const PERIODIC = new Set([3, 53]); // periodic damage, leech
+
+const books = new WeakMap<PetInfo, { owner: readonly Spell[]; book: Spellbook }>();
+/**
+ * The pet's spellbook: the owner's class spells (Bestial Wrath) plus the pet file's spells; chains = pet abilities.
+ * Memoized per pet (data objects are immutable): derive evaluates the pet up to 10 times per click.
+ */
+export function petBook(setup: PetSetup, ownerSpells: readonly Spell[], classSet: number): Spellbook {
+  const hit = books.get(setup.info);
+  if (hit && hit.owner === ownerSpells && hit.book.classSet === classSet) return hit.book;
+  const book = buildSpellbook(
+    {
+      build: "",
+      classId: 0,
+      token: setup.info.owner,
+      spells: [...ownerSpells, ...setup.spells],
+      abilities: setup.info.abilities.map((c) => ({
+        classId: 0,
+        name: c.name,
+        skillLineId: setup.info.skillLine,
+        passive: false,
+        ranks: c.ranks,
+      })),
+    },
+    classSet,
+    0,
+  );
+  books.set(setup.info, { owner: ownerSpells, book });
+  return book;
+}
+
+/**
+ * The pet's priority list (section 4.4), from the data: every learned pet ability that deals damage. Cooldown and
+ * DoT abilities first (longest cooldown first), then the abilities without a cooldown (Claw, Firebolt, Lightning
+ * Breath). Owner talent abilities that put a damage aura on the pet (Bestial Wrath) are pet "burst" entries
+ * (simulation only, like the owner's bursts). Imp-like pets (pets.json noMelee) have no white attacks.
+ */
+export function petRotation(
+  setup: PetSetup,
+  book: Spellbook,
+  level: number,
+  talents: readonly RankedTalent[],
+  classTalents: readonly Talent[],
+): SpecRotation {
+  const timed: { entry: RotationEntry; cd: number }[] = [];
+  const fillers: RotationEntry[] = [];
+  for (const c of setup.info.abilities) {
+    const l = learn(book, c.name, level, talents, classTalents);
+    if (!("spell" in l)) continue;
+    const s = l.spell;
+    const direct = s.effects.some((e) => DIRECT.has(e.effect));
+    const periodic = s.effects.some((e) => e.effect === 6 && PERIODIC.has(e.aura));
+    if (s.passive || (!direct && !periodic)) continue;
+    const cd = Math.max(s.cooldownMs, s.categoryCooldownMs);
+    if (periodic && !direct) timed.push({ entry: { ability: c.name, kind: "dot" }, cd });
+    else if (cd > 0) timed.push({ entry: { ability: c.name, kind: "cooldown" }, cd });
+    else fillers.push({ ability: c.name, kind: "filler" });
+  }
+  timed.sort((a, b) => b.cd - a.cd || a.entry.ability.localeCompare(b.entry.ability));
+  const bursts: RotationEntry[] = [];
+  for (const t of classTalents) {
+    if (t.kind !== "ability") continue;
+    const l = learn(book, t.name, level, talents, classTalents);
+    if (!("spell" in l)) continue;
+    const onPet = l.spell.effects.some((e) => e.aura === AURA_DAMAGE_DONE && e.targets?.[0] === TARGET_PET);
+    if (onPet && l.spell.cooldownMs > 0) bursts.push({ ability: t.name, kind: "burst" });
+  }
+  return {
+    id: `pet-${setup.info.id}`,
+    class: setup.info.owner,
+    spec: 0,
+    label: setup.info.name,
+    role: "dps",
+    tier: 2,
+    selfBuffs: [],
+    melee: !setup.config.noMelee.includes(setup.info.id),
+    autoShot: false,
+    entries: [...bursts, ...timed.map((t) => t.entry), ...fillers],
+    notes: [],
+  };
+}
diff --git a/src/engine/pets/setup.ts b/src/engine/pets/setup.ts
new file mode 100644
index 0000000..b9e8a79
--- /dev/null
+++ b/src/engine/pets/setup.ts
@@ -0,0 +1,85 @@
+import type { ClassToken, PetFile, PetsManualFile, Spell } from "@/data/types";
+import { mapAura, type RankedTalent, type SourcedEffect } from "@/engine/stats";
+import { AURA_DAMAGE_DONE, PET_TALENT } from "./constants";
+import type { PetChoice, ResolvedPet } from "./types";
+
+const ranked = (talents: readonly RankedTalent[], spellId: number) =>
+  talents.find((t) => t.talent.spellId === spellId && t.rank > 0);
+const valueOf = (t: RankedTalent, i: number) => t.talent.ranks[t.rank - 1]?.values[i] ?? 0;
+const labelOf = (t: RankedTalent) => `${t.talent.name} ${t.rank}/${t.talent.maxRank}`;
+
+/** Aura 79 effects of a spell as damage-done effects (value: the talent's rank value, else the spell's own). */
+function damageAuras(spell: Spell | undefined, label: string, value?: number): SourcedEffect[] {
+  if (!spell) return [];
+  return spell.effects
+    .filter((e) => e.aura === AURA_DAMAGE_DONE)
+    .flatMap((e) => {
+      const m = mapAura(e, value ?? e.base);
+      return m.kind === "damageDone" ? m.effects.map((x) => ({ ...x, label, kind: "talent" as const })) : [];
+    });
+}
+
+/**
+ * What a pet choice does with the current talents (section 4.2): the active pet (null: none or not a pet of this
+ * class), the effects on the owner, and notes for choices that do nothing. Demonic Sacrifice needs the talent and is
+ * cancelled by summoning a demon, unless Demonic Pact is taken and the demon is a different one. Pure.
+ */
+export function resolvePet(a: {
+  choice: PetChoice;
+  file: PetFile | null;
+  manual: PetsManualFile;
+  token: ClassToken;
+  talents: readonly RankedTalent[];
+  level: number;
+}): ResolvedPet {
+  const { choice, file, manual, talents, level } = a;
+  const config = manual.owners[a.token];
+  if (!file || !config) return { pet: null, ownerEffects: [], notes: [] };
+  const spells = new Map(file.spells.map((s) => [s.id, s]));
+  const info = file.pets.find((p) => p.id === choice.family) ?? null;
+  const notes: string[] = [];
+  const shared: SourcedEffect[] = [];
+  if (info) {
+    const ff = ranked(talents, PET_TALENT.FOCUSED_FIRE);
+    if (ff && valueOf(ff, 0) !== 0)
+      shared.push({ key: "damageDonePct", value: valueOf(ff, 0), label: labelOf(ff), kind: "talent" });
+    const md = ranked(talents, PET_TALENT.MASTER_DEMONOLOGIST);
+    const mdRef = manual.masterDemonologist.find((m) => m.family === info.id);
+    if (md && mdRef)
+      shared.push(...damageAuras(spells.get(mdRef.spellId), labelOf(md), valueOf(md, mdRef.valueIndex)));
+    if (ranked(talents, PET_TALENT.SOUL_LINK))
+      shared.push(...damageAuras(spells.get(manual.soulLink.spellId), "Soul Link"));
+    const dk = ranked(talents, PET_TALENT.DEMONIC_KNOWLEDGE);
+    if (dk && valueOf(dk, 0) !== 0)
+      shared.push({
+        key: "spellPower",
+        value: (valueOf(dk, 0) * level) / 100,
+        label: `${labelOf(dk)} (${valueOf(dk, 0)}% of level ${level})`,
+        kind: "talent",
+      });
+  }
+  const ownerOnly: SourcedEffect[] = [];
+  const ref = choice.sacrifice ? manual.sacrifice.find((s) => s.family === choice.sacrifice) : undefined;
+  if (ref) {
+    const pact = ranked(talents, PET_TALENT.DEMONIC_PACT);
+    if (!ranked(talents, PET_TALENT.DEMONIC_SACRIFICE))
+      notes.push("Demonic Sacrifice needs the talent Demonic Sacrifice.");
+    else if (info && (!pact || info.id === ref.family))
+      notes.push(
+        pact
+          ? `Summoning the sacrificed ${ref.name} cancels Demonic Sacrifice.`
+          : "Summoning a demon cancels Demonic Sacrifice (Demonic Pact keeps it for a different demon).",
+      );
+    else {
+      const fx = damageAuras(spells.get(ref.spellId), `Demonic Sacrifice (${ref.name}): ${ref.spellName}`);
+      if (fx.length === 0)
+        notes.push(`${ref.spellName} (${ref.name}) restores health or mana: no damage effect.`);
+      ownerOnly.push(...fx);
+    }
+  }
+  return {
+    pet: info ? { info, spells: file.spells, config, scaling: choice.scaling, effects: shared } : null,
+    ownerEffects: [...shared, ...ownerOnly],
+    notes,
+  };
+}
diff --git a/src/engine/pets/stats.ts b/src/engine/pets/stats.ts
new file mode 100644
index 0000000..82d541e
--- /dev/null
+++ b/src/engine/pets/stats.ts
@@ -0,0 +1,191 @@
+import type { BaseStatsFile, ManualClassToken, Spell, Weapon } from "@/data/types";
+import { collectMods, effectValue, familyMatches, type ModSource } from "@/engine/abilities";
+import {
+  EMPTY_BONUS,
+  computeCharacter,
+  mapAura,
+  type CharacterStats,
+  type EquippedWeapons,
+  type SourcedEffect,
+} from "@/engine/stats";
+import {
+  AURA_POWER_REGEN_PCT,
+  AURA_PROC_TRIGGER,
+  OP_PROC_CHANCE,
+  PET_AURA_EFFECTS,
+  PET_RACE,
+  PET_WEAPON_SUBCLASS,
+  POWER_FOCUS,
+  TARGET_CASTER,
+  TARGET_PET,
+} from "./constants";
+import type { PetSetup } from "./types";
+
+const FAMILY_PASSIVE = "Tamed Pet Passive (DND)";
+const r1 = (n: number) => Math.round(n * 10) / 10;
+const onPet = (e: { targets?: [number, number] }) =>
+  !e.targets || e.targets[0] === TARGET_CASTER || e.targets[0] === TARGET_PET;
+
+/** Stat effects of the pet's passives and active pet buffs, plus the focus regeneration bonus and the Frenzy proc. */
+export interface PetAuras {
+  effects: SourcedEffect[];
+  focusRegenPct: number; // aura 110 focus (Bestial Discipline)
+  frenzy: { chance: number; spell: Spell; label: string } | null; // aura 42 proc on crits (talent Frenzy)
+}
+
+/**
+ * The pet's passives (family damage modifier, talent-modified passives) and `buffs` (Frenzy, Bestial Wrath) after the
+ * owner's spell modifiers: Unleashed Fury/Ferocity add to effect 0 of a passive (op 3), Unholy Power/Bestial
+ * Discipline to all values (op 8), Frenzy to the proc chance (op 18). Effects go through the talent mapper (mapAura).
+ */
+export function petAuras(
+  setup: PetSetup,
+  buffs: readonly Spell[],
+  mods: readonly ModSource[],
+  classSet: number,
+  level: number,
+): PetAuras {
+  const byId = new Map(setup.spells.map((s) => [s.id, s]));
+  const passives = setup.info.passives.map((id) => byId.get(id)).filter((s): s is Spell => s !== undefined);
+  const out: PetAuras = { effects: [], focusRegenPct: 0, frenzy: null };
+  for (const spell of [...passives, ...buffs]) {
+    const m = collectMods(spell, mods, classSet);
+    const talents = [...new Set(m.lines.map((l) => l.label))].join(", ");
+    const buff = buffs.includes(spell);
+    const label =
+      talents ||
+      (buff ? spell.name : spell.name === FAMILY_PASSIVE ? `${setup.info.name} (family)` : spell.name);
+    const kind = talents ? "talent" : buff ? "buff" : "base";
+    for (const e of spell.effects) {
+      if (!PET_AURA_EFFECTS.has(e.effect) || !onPet(e)) continue;
+      const v = effectValue(spell, e, level, m);
+      if (e.aura === AURA_POWER_REGEN_PCT && e.misc[0] === POWER_FOCUS) {
+        out.focusRegenPct += v;
+        continue;
+      }
+      if (e.aura === AURA_PROC_TRIGGER && e.triggerSpell) {
+        const proc = byId.get(e.triggerSpell);
+        const chanceMods = mods.filter(
+          (x) => x.op === OP_PROC_CHANCE && !x.pct && familyMatches(x.mask, spell, classSet),
+        );
+        const chance = (spell.proc?.chance ?? 0) + chanceMods.reduce((a, x) => a + x.value, 0);
+        if (proc && chance > 0)
+          out.frenzy = { chance, spell: proc, label: chanceMods.map((x) => x.label).join(", ") || proc.name };
+        continue;
+      }
+      const mapped = mapAura(e, v);
+      if (mapped.kind !== "stat" && mapped.kind !== "damageDone") continue;
+      for (const x of mapped.effects) if (x.value !== 0) out.effects.push({ ...x, label, kind });
+    }
+  }
+  return out;
+}
+
+/** Owner scaling (Q5, data/manual/pets.json): attack power and spell power from the owner, and the owner's hit. */
+function ownerScaling(setup: PetSetup, owner: CharacterStats): SourcedEffect[] {
+  if (!setup.scaling) return [];
+  const s = setup.config.scaling;
+  const ranged = s.from === "rangedAttackPower";
+  const src = ranged
+    ? (owner.rangedAttackPower?.value ?? 0)
+    : Math.max(owner.spellPower.fire.value, owner.spellPower.shadow.value);
+  const what = ranged ? "ranged attack power" : "fire/shadow spell power";
+  const out: SourcedEffect[] = [
+    {
+      key: "meleeAttackPower",
+      value: (src * s.attackPowerPct) / 100,
+      label: `Owner scaling: ${s.attackPowerPct}% of ${r1(src)} ${what}`,
+      kind: "rule",
+    },
+    {
+      key: "spellPower",
+      value: (src * s.spellPowerPct) / 100,
+      label: `Owner scaling: ${s.spellPowerPct}% of ${r1(src)} ${what}`,
+      kind: "rule",
+    },
+  ];
+  if (s.inheritHit) {
+    const hit = ranged ? (owner.hit.ranged?.value ?? owner.hit.mainHand.value) : owner.hit.spell.value;
+    out.push({ key: "hit", value: hit, label: "Owner scaling: owner's hit chance", kind: "rule" });
+  }
+  return out.filter((e) => e.value !== 0);
+}
+
+/**
+ * The pet's character sheet (section 4.3): the Phase 3 stat engine (computeCharacter) with the pet's own base-stat
+ * table (class key = the owner, race PET), a synthetic weapon for its melee attack, owner scaling, the shared owner
+ * talents and the passive auras. Returns the stats and the weapons the damage engine uses.
+ */
+export function computePetStats(
+  setup: PetSetup,
+  a: { level: number; owner: CharacterStats; auras: PetAuras },
+): { stats: CharacterStats; weapons: EquippedWeapons } {
+  const b = setup.config.base;
+  const cls = setup.info.owner.toUpperCase() as ManualClassToken;
+  const baseStats = {
+    _source: "data/manual/pets.json",
+    _status: "[VERIFY]",
+    level: a.level,
+    baseCritUnit: "percent",
+    classes: {
+      [cls]: {
+        str: b.str,
+        agi: b.agi,
+        sta: b.sta,
+        int: b.int,
+        spi: b.spi,
+        health: 0,
+        mana: 0,
+        baseMeleeCrit: b.meleeCrit,
+        baseSpellCrit: b.spellCrit,
+      },
+    },
+    raceOffsets: { [PET_RACE]: { str: 0, agi: 0, sta: 0, int: 0, spi: 0 } },
+    conversions: {
+      meleeAttackPower: { [cls]: { perLevel: 0, perStr: b.apPerStr, perAgi: 0, flat: b.apFlat } },
+      rangedAttackPower: {},
+      agiPerMeleeCrit: { [cls]: Infinity }, // the pet's crit is its base value (pets.json), not from Agility
+      intPerSpellCrit: {},
+      healthPerSta: 10,
+      manaPerInt: 15,
+      statsWithoutBonus: 20,
+    },
+  } as unknown as BaseStatsFile;
+  const melee = !setup.config.noMelee.includes(setup.info.id);
+  const weapon: Weapon | null = melee
+    ? {
+        id: 0,
+        name: `${setup.info.name} attack`,
+        quality: 1,
+        itemLevel: 0,
+        requiredLevel: 0,
+        inventoryType: 13,
+        slot: "mainHand",
+        subclass: PET_WEAPON_SUBCLASS,
+        weaponType: "Pet",
+        speedMs: b.speedMs,
+        min: b.minDamage,
+        max: b.maxDamage,
+        dps: (b.minDamage + b.maxDamage) / 2 / (b.speedMs / 1000),
+        damageTable: null,
+        stats: [],
+        allowableClass: 0,
+        allowableRace: [0, 0],
+        bonding: 0,
+        icon: null,
+        iconFileId: 0,
+        source: "forever",
+      }
+    : null;
+  const weapons: EquippedWeapons = { mainHand: weapon, offHand: null, ranged: null, ammo: null };
+  const stats = computeCharacter({
+    classToken: setup.info.owner,
+    race: PET_RACE,
+    level: a.level,
+    baseStats,
+    weapons,
+    bonus: EMPTY_BONUS,
+    effects: [...setup.effects, ...ownerScaling(setup, a.owner), ...a.auras.effects],
+  });
+  return { stats, weapons };
+}
diff --git a/src/engine/pets/types.ts b/src/engine/pets/types.ts
new file mode 100644
index 0000000..442df5a
--- /dev/null
+++ b/src/engine/pets/types.ts
@@ -0,0 +1,41 @@
+import type { PetInfo, PetOwnerConfig, Spell } from "@/data/types";
+import type { AbilityEval, DamageContext, RotationEffect } from "@/engine/abilities";
+import type { RotationResult } from "@/engine/rotation";
+import type { CharacterStats, SourcedEffect, TargetView } from "@/engine/stats";
+
+/** The user's pet choice (URL tag 8). family/sacrifice: CreatureFamily ids, 0 = none. */
+export interface PetChoice {
+  family: number; // active pet
+  sacrifice: number; // warlock: sacrificed demon (Demonic Sacrifice)
+  scaling: boolean; // pets scale with the owner's stats (Q5)
+}
+export const NO_PET: PetChoice = { family: 0, sacrifice: 0, scaling: true };
+
+/** The active pet, as plain data (SimInput carries it to the worker). */
+export interface PetSetup {
+  info: PetInfo;
+  spells: Spell[]; // pets/<owner>.json spells
+  config: PetOwnerConfig; // data/manual/pets.json owners[owner]
+  scaling: boolean;
+  effects: SourcedEffect[]; // owner talents that also apply to the pet (Focused Fire, Master Demonologist, Soul Link ...)
+}
+
+/** resolvePet: what a pet choice does with the current talents. */
+export interface ResolvedPet {
+  pet: PetSetup | null;
+  ownerEffects: SourcedEffect[]; // effects on the owner (shared talents and Demonic Sacrifice)
+  notes: string[]; // parts of the choice that do nothing (missing talent, sacrifice cancelled ...)
+}
+
+/** Analytical pet damage vs one target (the pet's own stats and outcome tables). */
+export interface PetDamage {
+  name: string;
+  icon: string | null;
+  stats: CharacterStats;
+  view: TargetView;
+  ctx: DamageContext;
+  rotation: RotationResult;
+  abilities: AbilityEval[]; // pet rotation entries in order
+  effects: RotationEffect[]; // uptime effects of pass 2 (Frenzy)
+  focusPerSecond: number | null;
+}
````

### 6.5 B5: simulator (FightModel, focus, critBuff, strictPriority, prefix, pet model, runSim, tests) (task T6)

````diff
diff --git a/src/engine/sim/engine.ts b/src/engine/sim/engine.ts
index 14eae0c..eefebfc 100644
--- a/src/engine/sim/engine.ts
+++ b/src/engine/sim/engine.ts
@@ -33,7 +33,7 @@ import {
   START_RAGE,
   TIMELINE_STEP_SEC,
 } from "./constants";
-import type { ActiveBuffKey, BuffDef, SimModel, StateEval } from "./model";
+import type { ActiveBuffKey, BuffDef, FightModel, StateEval } from "./model";
 import { EventQueue } from "./queue";
 import type { Rng } from "./rng";
 import type { SimConfig, SimLogLine } from "./types";
@@ -150,6 +150,7 @@ export class Fight implements ConditionState {
   private readonly dots: Dot[];
   private readonly igniteSlot: number;
   private readonly deepWoundsSlot: number;
+  private readonly prefix: string;
   private flurryCharges = 0;
   private shadowTranceUntil = -1;
   private isbUntil = -1;
@@ -162,7 +163,7 @@ export class Fight implements ConditionState {
   private lastSample = -Infinity;
 
   constructor(
-    private readonly model: SimModel,
+    private readonly model: FightModel,
     private readonly config: SimConfig,
     private readonly rng: Rng,
     private readonly acc: Accumulator,
@@ -170,6 +171,7 @@ export class Fight implements ConditionState {
   ) {
     this.T = config.fightSec;
     this.n = model.entries.length;
+    this.prefix = model.sourcePrefix;
     this.cdReady = new Float64Array(this.n);
     this.lastCast = new Float64Array(this.n).fill(-Infinity);
     this.buffs = model.buffs.map(() => null);
@@ -195,7 +197,15 @@ export class Fight implements ConditionState {
     this.dots.push(dot("Deep Wounds"));
     const p = model.power;
     this.maxResource =
-      p === "mana" ? model.maxMana : p === "rage" ? MAX_RAGE : p === "energy" ? MAX_ENERGY : 0;
+      p === "mana"
+        ? model.maxMana
+        : p === "rage"
+          ? MAX_RAGE
+          : p === "energy"
+            ? MAX_ENERGY
+            : p === "focus"
+              ? (model.focus?.max ?? 0)
+              : 0;
     this.resource = p === "rage" ? START_RAGE : this.maxResource;
   }
 
@@ -324,6 +334,8 @@ export class Fight implements ConditionState {
     if (dt > 0) {
       const p = this.model.power;
       if (p === "energy") this.resource = Math.min(this.maxResource, this.resource + this.energyRate() * dt);
+      else if (p === "focus")
+        this.resource = Math.min(this.maxResource, this.resource + (this.model.focus?.perSecond ?? 0) * dt);
       else if (p === "rage" && this.current.ragePerSec > 0)
         this.resource = Math.min(this.maxResource, this.resource + this.current.ragePerSec * dt);
       else if (p === "mana" && this.resource < this.maxResource) {
@@ -385,7 +397,7 @@ export class Fight implements ConditionState {
   }
   /** Charge buffs (Clearcasting, Presence of Mind, Cold Blood) are used by a matching cast. */
   private useCharges(a: AbilityResult): void {
-    const set = this.model.prepared.book.classSet;
+    const set = this.model.classSet;
     for (const b of this.buffs) {
       if (!b || b.def.charges <= 0 || b.charges <= 0) continue;
       if (!b.def.masks.some((m) => familyMatches(m, a.spell, set))) continue;
@@ -457,8 +469,10 @@ export class Fight implements ConditionState {
         const kind = this.model.entries[i]!.entry.kind;
         const onGcd = raw.available && raw.gcd > 0 && kind !== "nextSwing";
         if (onGcd && this.gcdUntil > this.t + EPS) continue;
-        // L8: a finisher that waits for its resource keeps the combo points (no cheaper finisher steals them)
-        const pools = kind === "finisher";
+        // L8: a finisher that waits for its resource keeps the combo points; a pet pools for any higher entry
+        const pools =
+          kind === "finisher" ||
+          (this.model.strictPriority && raw.available && raw.power === this.model.power && raw.cost > 0);
         if (pooling && pools) continue;
         const a = this.usable(i, st);
         if (!a) {
@@ -502,7 +516,9 @@ export class Fight implements ConditionState {
         ? this.energyRate()
         : p === "mana"
           ? this.manaRate(t < this.lastManaSpend + FIVE_SECOND_RULE_SEC)
-          : 0;
+          : p === "focus"
+            ? (this.model.focus?.perSecond ?? 0)
+            : 0;
     if (p === "mana") at(this.lastManaSpend + FIVE_SECOND_RULE_SEC);
     let timed = false;
     for (let i = 0; i < this.n; i++) {
@@ -815,6 +831,7 @@ export class Fight implements ConditionState {
     if (crit && pr.flurryPct > 0) this.flurryCharges = FLURRY_SWINGS;
     if (crit && pr.deepWoundsPct > 0) this.deepWounds();
     if (pr.unbridledWrathPct > 0 && this.rng() * 100 < pr.unbridledWrathPct) this.gain(1, "Unbridled Wrath");
+    if (crit && pr.critBuff && this.rng() * 100 < pr.critBuff.chance) this.applyBuff(pr.critBuff.buff);
     if (slot !== "mainHand" || extra) return;
     const st = this.state();
     if (pr.extraAttackPct > 0 && this.rng() * 100 < pr.extraAttackPct) this.whiteSwing(0, st, true, false);
@@ -896,7 +913,8 @@ export class Fight implements ConditionState {
   private targetMult(mask: number): number {
     return this.isbUntil > this.t && hasSchool(mask, "shadow") ? 1 + this.model.procs.isbPct / 100 : 1;
   }
-  private count(source: string, mask: number): SourceAcc {
+  private count(name: string, mask: number): SourceAcc {
+    const source = this.prefix + name;
     let a = this.acc.get(source);
     if (!a) {
       a = {
@@ -940,7 +958,7 @@ export class Fight implements ConditionState {
     if (!tr || tr.log.length >= tr.logLimit || source === "") return;
     tr.log.push({
       t: Math.round(this.t * 1000) / 1000,
-      source,
+      source: this.prefix + source,
       outcome,
       damage: Math.round(damage),
       resource: this.model.power ? Math.round(this.resource) : null,
diff --git a/src/engine/sim/index.ts b/src/engine/sim/index.ts
index 59eccf3..283d262 100644
--- a/src/engine/sim/index.ts
+++ b/src/engine/sim/index.ts
@@ -2,5 +2,6 @@ export * from "./types";
 export * from "./rng";
 export * from "./queue";
 export * from "./model";
+export * from "./petModel";
 export * from "./engine";
 export * from "./run";
diff --git a/src/engine/sim/model.ts b/src/engine/sim/model.ts
index e18d9cb..2f0e4c2 100644
--- a/src/engine/sim/model.ts
+++ b/src/engine/sim/model.ts
@@ -70,8 +70,8 @@ export interface ActiveBuffKey {
   stacks: number;
 }
 
-export interface SimModel {
-  input: SimInput;
+/** What one Fight needs: the player's SimModel or a pet's (Phase 6, src/engine/sim/petModel.ts). */
+export interface FightModel {
   token: ClassToken;
   level: number;
   rotation: SpecRotation;
@@ -79,13 +79,21 @@ export interface SimModel {
   entries: SimEntry[];
   buffs: BuffDef[];
   procs: ActiveProcs;
-  prepared: Prepared; // base state
   maxMana: number;
   spiritRegenPerSec: number; // outside the five-second rule
   castRegenPct: number; // talents (aura 134): % of Spirit regeneration while casting
+  classSet: number; // spell family set (charge buffs match casts by family mask)
+  focus: { max: number; perSecond: number } | null; // Phase 6: pet focus (null for the player)
+  sourcePrefix: string; // Phase 6: "" for the player, "<pet name>: " for a pet's damage sources and log lines
+  /** Phase 6: an entry that waits only for its resource blocks every lower entry that spends it (pets pool focus). */
+  strictPriority: boolean;
+  state(active: readonly ActiveBuffKey[]): StateEval;
+}
+export interface SimModel extends FightModel {
+  input: SimInput;
+  prepared: Prepared; // base state
   averaged: string[];
   modeled: string[];
-  state(active: readonly ActiveBuffKey[]): StateEval;
   stateCount(): number;
 }
 
@@ -302,6 +310,10 @@ export function buildModel(input: SimInput): SimModel {
     maxMana: prepared.stats.mana?.value ?? 0,
     spiritRegenPerSec: (spirit.flat + spirit.perSpirit * prepared.stats.primary.spi.value) / REGEN_TICK_SEC,
     castRegenPct,
+    classSet: book.classSet,
+    focus: null,
+    sourcePrefix: "",
+    strictPriority: false,
     averaged,
     modeled: procs.labels,
     state(active) {
diff --git a/src/engine/sim/perf.test.ts b/src/engine/sim/perf.test.ts
index fce18dd..968129a 100644
--- a/src/engine/sim/perf.test.ts
+++ b/src/engine/sim/perf.test.ts
@@ -1,7 +1,7 @@
 import { describe, expect, it } from "vitest";
 import type { ClassToken } from "@/data/types";
 import { simInput, type SimScenario } from "@/testkit/sim";
-import { buffs, weapon } from "@/testkit/stats";
+import { ammo, buffs, weapon } from "@/testkit/stats";
 import { treeFor } from "@/testkit/talents";
 import { runSim } from "./run";
 import { DEFAULT_SIM_CONFIG } from "./types";
@@ -46,6 +46,17 @@ const CASES: [string, SimScenario][] = [
       rotation: "mage-fire",
     },
   ],
+  [
+    "hunter-beast-mastery + Cat (Phase 6)",
+    {
+      classToken: "hunter",
+      race: "DWARF",
+      weapons: { ranged: weapon(18713), ammo: ammo(18042) },
+      talents: maxed("hunter", 0),
+      rotation: "hunter-beast-mastery",
+      pet: { family: "Cat" },
+    },
+  ],
 ];
 
 describe("simulation performance budget (section 8.5)", () => {
diff --git a/src/engine/sim/petModel.ts b/src/engine/sim/petModel.ts
new file mode 100644
index 0000000..53b9df3
--- /dev/null
+++ b/src/engine/sim/petModel.ts
@@ -0,0 +1,113 @@
+import type { Spell } from "@/data/types";
+import { weaponInfo, type AbilityEval } from "@/engine/abilities";
+import { petState, type PetEvalArgs, type PetState } from "@/engine/pets";
+import {
+  buffDef,
+  type ActiveBuffKey,
+  type BuffDef,
+  type FightModel,
+  type SimEntry,
+  type SimModel,
+  type StateEval,
+} from "./model";
+import { noProcs } from "./procs";
+import type { SimInput } from "./types";
+
+/** The pet's evaluation as a simulator state (white attacks, abilities per entry, no player-only procs). */
+function toStateEval(st: PetState, key: string): StateEval {
+  const w = st.white;
+  const info = weaponInfo(st.ctx, "mainHand");
+  const spread = w && info && info.perSwing > 0 ? (info.spread * w.normalHit) / info.perSwing : 0;
+  return {
+    key,
+    ctx: st.ctx,
+    abilities: st.abilities,
+    finisherAt: (i: number): AbilityEval => st.abilities[i]!,
+    white: { mainHand: w, offHand: null, ranged: null },
+    whiteSpread: { mainHand: spread, offHand: 0, ranged: 0 },
+    windfury: null,
+    sealOfCommand: null,
+    extraDps: [],
+    ragePerSec: 0,
+  };
+}
+
+/**
+ * The pet as its own actor (section 4.6): a FightModel built from petState, so the same Fight class runs it (swing
+ * timer, GCD, casts, focus, DoTs). Pet bursts (Bestial Wrath) and Frenzy are buffs whose auras land on the pet; the
+ * state is re-evaluated (and memoized) per set of active pet buffs. Null when the input has no pet.
+ */
+export function buildPetModel(input: SimInput, owner: SimModel): FightModel | null {
+  const pet = input.pet;
+  if (!pet) return null;
+  const args: PetEvalArgs = {
+    setup: pet,
+    level: owner.level,
+    owner: owner.prepared.stats,
+    ownerSpells: input.prepare.spells.spells,
+    classSet: owner.classSet,
+    talents: input.prepare.talents,
+    classTalents: input.prepare.classTalents,
+    spellMods: owner.prepared.assembled.mapping.spellMods,
+    target: input.target,
+    armorFormula: input.armorFormula,
+  };
+  const base = petState(args);
+  const book = base.ctx.book;
+  const buffs: BuffDef[] = [];
+  const addBuff = (spell: Spell, name?: string): BuffDef => {
+    const b = buffDef(buffs.length, spell, book, name);
+    b.stateful = true; // its auras land on the pet (target 5) or on the pet itself (Frenzy)
+    buffs.push(b);
+    return b;
+  };
+  const entries: SimEntry[] = base.rotation.entries.map((entry, index) => {
+    const a = base.abilities[index]!;
+    return {
+      index,
+      entry,
+      buff: entry.kind === "burst" && a.available ? addBuff(a.spell) : null,
+      requires: -1,
+      talentOk: true,
+      explicitAuraLeft: false,
+      skip: false,
+    };
+  });
+  const procs = noProcs();
+  const f = base.auras.frenzy;
+  if (f) {
+    procs.critBuff = { chance: f.chance, buff: addBuff(f.spell, "Frenzy") };
+    procs.labels.push(`${f.label}: Frenzy on ${f.chance}% of melee crits`);
+  }
+  const cache = new Map<string, StateEval>([["", toStateEval(base, "")]]);
+  return {
+    token: owner.token,
+    level: owner.level,
+    rotation: base.rotation,
+    power: base.focusPerSecond !== null ? "focus" : null,
+    entries,
+    buffs,
+    procs,
+    maxMana: 0,
+    spiritRegenPerSec: 0,
+    castRegenPct: 0,
+    classSet: owner.classSet,
+    focus: pet.config.focus ? { max: pet.config.focus.max, perSecond: base.focusPerSecond ?? 0 } : null,
+    sourcePrefix: `${pet.info.name}: `,
+    strictPriority: true,
+    state(active: readonly ActiveBuffKey[]): StateEval {
+      const on = active.filter((x) => x.def.stateful && x.def.spell);
+      const key = on
+        .map((x) => `${x.def.index}x${x.stacks}`)
+        .sort()
+        .join(",");
+      let s = cache.get(key);
+      if (!s) {
+        const spells = on.flatMap((x) => Array.from({ length: x.stacks }, () => x.def.spell!));
+        s = toStateEval(petState(args, spells), key);
+        cache.set(key, s);
+      }
+      return s;
+    },
+  };
+}
diff --git a/src/engine/sim/pets.test.ts b/src/engine/sim/pets.test.ts
new file mode 100644
index 0000000..6fd4ce2
--- /dev/null
+++ b/src/engine/sim/pets.test.ts
@@ -0,0 +1,74 @@
+// Phase 6: pets as their own actors in the simulator (plan section 8.3).
+import { describe, expect, it } from "vitest";
+import type { ClassToken } from "@/data/types";
+import { runDamage } from "@/testkit/damage";
+import { simInput, type SimScenario } from "@/testkit/sim";
+import { ammo, weapon } from "@/testkit/stats";
+import { treeFor } from "@/testkit/talents";
+import { runSim } from "./run";
+import { DEFAULT_SIM_CONFIG, type SimConfig } from "./types";
+
+const BOW = { ranged: weapon(18713), ammo: ammo(18042) };
+const cfg = (patch: Partial<SimConfig> = {}): SimConfig => ({ ...DEFAULT_SIM_CONFIG, ...patch });
+const sim = (s: SimScenario, c: Partial<SimConfig> = {}) => runSim(simInput(s), cfg(c));
+function maxed(token: ClassToken, spec: number): Record<string, number> {
+  const out: Record<string, number> = {};
+  for (const n of treeFor(token).nodes.values())
+    if (n.specIndex === spec) out[n.talent.name] = n.talent.maxRank;
+  return out;
+}
+const casts = (r: ReturnType<typeof runSim>, key: string) => r.sources.find((x) => x.key === key)?.casts ?? 0;
+
+const CAT: SimScenario = {
+  classToken: "hunter",
+  race: "DWARF",
+  weapons: BOW,
+  rotation: "hunter-beast-mastery",
+  pet: { family: "Cat" },
+};
+const LOCK = {
+  classToken: "warlock" as const,
+  race: "HUMAN",
+  bonus: { spellPower: 300 },
+  rotation: "warlock-demonology",
+};
+describe("pets in the simulator", () => {
+  for (const [name, s] of [
+    ["P-C1 hunter, Cat, no talents", CAT],
+    [
+      "P-C2 warlock, Imp, Demonology 5/5 talents",
+      { ...LOCK, talents: maxed("warlock", 1), pet: { family: "Imp" } },
+    ],
+    [
+      "P-C3 warlock, Succubus, Demonology 5/5 talents",
+      { ...LOCK, talents: maxed("warlock", 1), pet: { family: "Succubus" } },
+    ],
+  ] as [string, SimScenario][])
+    it(`cross-check pet DPS within 3%: ${name}`, () => {
+      const r = sim(s);
+      const a = runDamage(s).pet!.rotation.dps;
+      expect(Math.abs(r.pet!.dps.mean / a - 1)).toBeLessThan(0.03);
+      expect(r.sources.filter((x) => x.pet).every((x) => x.key.startsWith(`${r.pet!.name}: `))).toBe(true);
+    });
+  it("deterministic; the pet has its own RNG stream (the player's damage is unchanged)", () => {
+    const a = sim(CAT, { iterations: 50, seed: 9 });
+    expect({ ...a, elapsedMs: 0 }).toEqual({ ...sim(CAT, { iterations: 50, seed: 9 }), elapsedMs: 0 });
+    const alone = sim({ ...CAT, pet: undefined }, { iterations: 50, seed: 9 });
+    const owner = (r: typeof a) => r.sources.filter((x) => !x.pet).map((x) => [x.key, x.damage]);
+    expect(owner(a)).toEqual(owner(alone));
+    expect(a.dps.mean).toBeCloseTo(alone.dps.mean + a.pet!.dps.mean, 6);
+    expect(alone.pet).toBeNull();
+  });
+  it("focus: the pet pools for Bite when it is ready (13 of 18 possible), Claw spends the rest", () => {
+    const r = sim(CAT, { iterations: 200 });
+    expect(casts(r, "Cat: Bite")).toBeGreaterThan(12);
+    expect(casts(r, "Cat: Bite")).toBeLessThanOrEqual(18);
+    expect(casts(r, "Cat: Claw")).toBeGreaterThan(20);
+  });
+  it("Bestial Wrath (pet burst) and Frenzy (crit proc) are sampled", () => {
+    const r = sim({ ...CAT, talents: maxed("hunter", 0) }, { iterations: 1, logLimit: 100000 });
+    expect(r.log.some((l) => l.source === "Cat: Bestial Wrath" && l.outcome === "buff")).toBe(true);
+    expect(r.log.some((l) => l.source === "Cat: Frenzy" && l.outcome === "buff")).toBe(true);
+    expect(r.modeled).toContain("Frenzy 5/5: Frenzy on 100% of melee crits");
+  });
+});
diff --git a/src/engine/sim/procs.ts b/src/engine/sim/procs.ts
index b42a935..861c743 100644
--- a/src/engine/sim/procs.ts
+++ b/src/engine/sim/procs.ts
@@ -51,9 +51,33 @@ export interface ActiveProcs {
   combustion: { spell: Spell; buff: BuffDef | null } | null;
   sealOfCommand: Spell | null; // the proc spell of the rotation's Seal of Command
   windfury: boolean;
+  critBuff: { chance: number; buff: BuffDef } | null; // Phase 6: pet Frenzy (a buff on melee crits)
   labels: string[]; // what the simulator samples, for the results panel
 }
 
+/** No procs at all (Phase 6: the base of a pet's procs). */
+export function noProcs(): ActiveProcs {
+  return {
+    ignitePct: 0,
+    flurryPct: 0,
+    isbPct: 0,
+    nightfallPct: 0,
+    nightfallSpells: new Set(),
+    deepWoundsPct: 0,
+    unbridledWrathPct: 0,
+    angerManagement: null,
+    sealFatePct: 0,
+    ruthlessnessPct: 0,
+    extraAttackPct: 0,
+    clearcasting: null,
+    combustion: null,
+    sealOfCommand: null,
+    windfury: false,
+    critBuff: null,
+    labels: [],
+  };
+}
+
 const value = (t: RankedTalent | undefined, i: number) =>
   t ? (t.talent.ranks[t.rank - 1]?.values[i] ?? 0) : 0;
 const triggerOf = (spell: Spell | undefined, book: Prepared["book"]) => {
@@ -123,6 +147,7 @@ export function activeProcs(
     combustion: comb ? { spell: comb, buff: null } : null,
     sealOfCommand,
     windfury,
+    critBuff: null,
     labels,
   };
 }
diff --git a/src/engine/sim/run.ts b/src/engine/sim/run.ts
index a2e7adb..a921013 100644
--- a/src/engine/sim/run.ts
+++ b/src/engine/sim/run.ts
@@ -1,6 +1,8 @@
+import { PET_STREAM } from "@/engine/pets";
 import { Fight, type Accumulator, type FightTrace } from "./engine";
 import { buildModel } from "./model";
-import { createRng, iterationSeed } from "./rng";
+import { buildPetModel } from "./petModel";
+import { createRng, iterationSeed, splitmix32 } from "./rng";
 import type { SimConfig, SimInput, SimResult, SimSource, Summary } from "./types";
 
 const Z95 = 1.96;
@@ -35,13 +37,21 @@ export interface RunOptions {
  * Runs `config.iterations` fights (section 4.6). Iteration i uses its own seeded stream, so the result is identical for
  * the same input, config and seed, whatever the batching.
  */
+/** Seed of the pet's stream in iteration i (independent of the player's stream, which stays unchanged). */
+export const petIterationSeed = (seed: number, i: number): number =>
+  splitmix32((iterationSeed(seed, i) ^ PET_STREAM) >>> 0)();
+
 export function runSim(input: SimInput, config: SimConfig, opts: RunOptions = {}): SimResult {
   const t0 = globalThis.performance.now();
   const model = buildModel(input);
+  const petModel = buildPetModel(input, model);
   const n = Math.max(1, Math.floor(config.iterations));
   const acc: Accumulator = new Map();
+  const petAcc: Accumulator = new Map();
   const dps = new Float64Array(n);
+  const petDps = new Float64Array(n);
   const trace: FightTrace = { log: [], logLimit: config.logLimit, timeline: [] };
+  const petTrace: FightTrace = { log: [], logLimit: config.logLimit, timeline: [] };
   let idle = 0;
   let oom = 0;
   const every = opts.progressEvery ?? 50;
@@ -54,14 +64,27 @@ export function runSim(input: SimInput, config: SimConfig, opts: RunOptions = {}
       i === 0 ? trace : null,
     );
     const r = fight.run();
-    dps[i] = r.damage / config.fightSec;
+    const pet = petModel
+      ? new Fight(
+          petModel,
+          config,
+          createRng(petIterationSeed(config.seed, i)),
+          petAcc,
+          i === 0 ? petTrace : null,
+        ).run().damage
+      : 0;
+    dps[i] = (r.damage + pet) / config.fightSec;
+    petDps[i] = pet / config.fightSec;
     idle += r.idleSec;
     oom += r.oomSec;
     if (opts.onProgress && ((i + 1) % every === 0 || i + 1 === n)) opts.onProgress(i + 1, n);
   }
-  const total = [...acc.values()].reduce((a, s) => a + s.damage, 0);
-  const sources: SimSource[] = [...acc.entries()]
-    .map(([key, s]) => ({
+  const total = [...acc.values(), ...petAcc.values()].reduce((a, s) => a + s.damage, 0);
+  const sources: SimSource[] = [
+    ...[...acc.entries()].map(([key, s]) => ({ key, s, pet: false })),
+    ...[...petAcc.entries()].map(([key, s]) => ({ key, s, pet: true })),
+  ]
+    .map(({ key, s, pet }) => ({
       key,
       school: s.school,
       damage: s.damage / n,
@@ -73,6 +96,7 @@ export function runSim(input: SimInput, config: SimConfig, opts: RunOptions = {}
       misses: s.misses / n,
       ticks: s.ticks / n,
       averaged: s.averaged,
+      pet,
     }))
     .filter((s) => s.damage > 0 || s.casts > 0)
     .sort((a, b) => b.damage - a.damage || a.key.localeCompare(b.key));
@@ -82,6 +106,7 @@ export function runSim(input: SimInput, config: SimConfig, opts: RunOptions = {}
     rotationLabel: input.rotation.label,
     power,
     dps: summarize(dps),
+    pet: petModel && input.pet ? { name: input.pet.info.name, dps: summarize(petDps) } : null,
     sources,
     idleSec: idle / n,
     oomSec: oom / n,
@@ -92,9 +117,11 @@ export function runSim(input: SimInput, config: SimConfig, opts: RunOptions = {}
             points: trace.timeline,
           }
         : null,
-    log: trace.log,
+    log: petModel
+      ? [...trace.log, ...petTrace.log].sort((a, b) => a.t - b.t).slice(0, config.logLimit)
+      : trace.log,
     averaged: model.averaged,
-    modeled: model.modeled,
+    modeled: [...model.modeled, ...(petModel?.procs.labels ?? [])],
     elapsedMs: globalThis.performance.now() - t0,
   };
 }
diff --git a/src/engine/sim/types.ts b/src/engine/sim/types.ts
index 4a53905..ec52970 100644
--- a/src/engine/sim/types.ts
+++ b/src/engine/sim/types.ts
@@ -1,5 +1,6 @@
 import type { School, SpecRotation, TargetsFile } from "@/data/types";
 import type { PowerKind } from "@/engine/abilities";
+import type { PetSetup } from "@/engine/pets";
 import type { PrepareArgs } from "@/engine/rotation";
 import type { TargetInput } from "@/engine/stats";
 
@@ -9,6 +10,7 @@ export interface SimInput {
   rotation: SpecRotation; // the user's rotation (with conditions)
   target: TargetInput; // presetTarget(...) incl. debuffs
   armorFormula: TargetsFile["armorFormula"];
+  pet?: PetSetup | null; // Phase 6: the active pet (resolvePet), simulated as its own actor
 }
 
 export interface SimConfig {
@@ -48,6 +50,7 @@ export interface SimSource {
   misses: number; // missed, dodged or resisted casts/swings per fight
   ticks: number; // periodic ticks per fight
   averaged: boolean; // expected-value damage from the analytical model (not sampled)
+  pet: boolean; // Phase 6: a damage source of the pet (key "<pet name>: <source>")
 }
 
 export interface SimLogLine {
@@ -62,7 +65,8 @@ export interface SimResult {
   config: SimConfig;
   rotationLabel: string;
   power: PowerKind | null;
-  dps: Summary;
+  dps: Summary; // player + pet
+  pet: { name: string; dps: Summary } | null; // Phase 6: the pet's share
   sources: SimSource[]; // sorted by damage
   idleSec: number; // mean seconds per fight with nothing to do (out of resource, waiting for cooldowns)
   oomSec: number; // mean seconds per fight waiting for mana
````

### 6.6 B8: test helpers and Playwright (task T7)

````diff
diff --git a/e2e/pets.spec.ts b/e2e/pets.spec.ts
new file mode 100644
index 0000000..7a16d48
--- /dev/null
+++ b/e2e/pets.spec.ts
@@ -0,0 +1,66 @@
+import { expect, test } from "@playwright/test";
+import { blockRemoteImages, node, watchErrors } from "./helpers";
+
+test.beforeEach(async ({ page }) => {
+  await blockRemoteImages(page);
+});
+
+test("hunter pet: picking a pet adds its DPS; the pet is in the link", async ({ page }) => {
+  const w = watchErrors(page);
+  await page.goto("./");
+  await page.getByRole("button", { name: "Hunter", exact: true }).click();
+  const total = page.getByTestId("dps-total");
+  await expect(total).not.toHaveText("");
+  const before = Number(await total.textContent());
+  await expect(page.getByTestId("pet-damage")).toHaveCount(0);
+  await page.getByTestId("pet-select").selectOption({ label: "Cat (+10% damage)" });
+  await expect(page.getByTestId("pet-damage")).toBeVisible();
+  await expect(page.getByTestId("pet-row-melee")).toBeVisible();
+  await expect.poll(async () => Number(await total.textContent())).toBeGreaterThan(before);
+  await expect(page.getByTestId("dps-split")).toContainText("Cat");
+  await expect.poll(() => new URL(page.url()).hash).toBe("#v2.hunter.60.0..CAMCAAA");
+  const url = page.url();
+  await page.goto("about:blank");
+  await page.goto(url);
+  await expect(page.getByTestId("pet-select")).toHaveValue("2");
+  await expect(page.getByTestId("pet-dps")).toBeVisible();
+  await page.getByTestId("pet-scaling").uncheck();
+  await expect.poll(() => new URL(page.url()).hash).toBe("#v2.hunter.60.0..CAMCAAE");
+  await page.getByTestId("pet-select").selectOption("0");
+  await page.getByTestId("pet-scaling").check();
+  await expect.poll(() => new URL(page.url()).hash).toBe("#v1.hunter.60.0");
+  w.check();
+});
+
+test("warlock: Demonic Sacrifice needs the talent and is cancelled by a summoned demon", async ({ page }) => {
+  const w = watchErrors(page);
+  await page.goto("./");
+  await page.getByRole("button", { name: "Warlock", exact: true }).click();
+  await expect(page.getByTestId("pet-sacrifice")).toBeDisabled();
+  for (let i = 0; i < 5; i++) await node(page, "Demonic Embrace").click();
+  for (let i = 0; i < 5; i++) await node(page, "Unholy Power").click();
+  await node(page, "Demonic Sacrifice").click();
+  await expect(page.getByTestId("pet-sacrifice")).toBeEnabled();
+  const total = page.getByTestId("dps-total");
+  await expect(total).not.toHaveText("");
+  const before = Number(await total.textContent());
+  await page.getByTestId("pet-sacrifice").selectOption("23"); // Imp: Burning Shadow, +15% shadow
+  await expect.poll(async () => Number(await total.textContent())).toBeGreaterThan(before);
+  await page.getByTestId("pet-select").selectOption({ label: "Succubus" });
+  await expect(page.getByTestId("pet-note")).toContainText("cancels Demonic Sacrifice");
+  await expect(page.getByTestId("pet-damage")).toBeVisible();
+  w.check();
+});
+
+test("simulation includes the pet as its own actor", async ({ page }) => {
+  const w = watchErrors(page);
+  await page.goto("./#v2.hunter.60.0..CAMCAAA");
+  await expect(page.getByTestId("pet-dps")).toBeVisible();
+  await page.getByTestId("sim-iterations").fill("100");
+  await page.getByTestId("sim-run").click();
+  await expect(page.getByTestId("sim-results")).toBeVisible();
+  await expect(page.getByTestId("sim-pet-dps")).toContainText("Cat");
+  await expect(page.getByTestId("sim-row-cat-melee")).toBeVisible();
+  await expect(page.getByTestId("sim-row-cat-claw")).toBeVisible();
+  w.check();
+});
diff --git a/src/testkit/damage.ts b/src/testkit/damage.ts
index 282c918..03b7c46 100644
--- a/src/testkit/damage.ts
+++ b/src/testkit/damage.ts
@@ -2,8 +2,10 @@
 import rotationsJson from "@manual/rotations.json";
 import type { ClassSpellFile, ClassToken, RotationEntry, RotationsFile, TargetPresetId } from "@/data/types";
 import { classesFile } from "@/data";
+import { evaluatePet } from "@/engine/pets";
 import { evaluateDamage, pickRotation, prepareDamage } from "@/engine/rotation";
 import { EMPTY_BONUS, evaluateTarget, presetTarget } from "@/engine/stats";
+import { scenarioPet, type PetScenario } from "./pets";
 import { NO_WEAPONS, baseStats, buffs, racials, ranked, targets, type Scenario } from "./stats";
 import { treeFor } from "./talents";
 
@@ -20,6 +22,7 @@ export const spellFile = (token: ClassToken): ClassSpellFile => {
 export interface DamageScenario extends Scenario {
   rotation?: string; // rotation id; default: pickRotation by spent points
   entries?: RotationEntry[]; // Phase 5: replaces the rotation's entries
+  pet?: PetScenario; // Phase 6
 }
 
 /** Full damage evaluation of a scenario against one target preset (default boss). */
@@ -34,6 +37,8 @@ export function runDamage(s: DamageScenario, preset: TargetPresetId = s.target ?
     : pickRotation(rotations, s.classToken, points);
   const rotation = s.entries ? { ...base, entries: s.entries } : base;
   const info = classesFile.classes.find((c) => c.token === s.classToken)!;
+  const resolved = scenarioPet(s.classToken, s.pet, talents);
+  const classTalents = [...tree.nodes.values()].map((n) => n.talent);
   const p = prepareDamage({
     classToken: s.classToken,
     race: s.race,
@@ -47,12 +52,15 @@ export function runDamage(s: DamageScenario, preset: TargetPresetId = s.target ?
     bonus: { ...EMPTY_BONUS, ...s.bonus },
     spells: spellFile(s.classToken),
     spellClassSet: info.spellClassSet,
-    classTalents: [...tree.nodes.values()].map((n) => n.talent),
+    classTalents,
     rotation,
+    petActive: resolved.pet !== null,
+    petOwnerEffects: resolved.ownerEffects,
   });
+  const target = presetTarget(targets, preset, 60, p.assembled.debuffs);
   const view = evaluateTarget(
     p.stats,
-    presetTarget(targets, preset, 60, p.assembled.debuffs),
+    target,
     targets.armorFormula,
     p.assembled.input.weapons.offHand !== null,
   );
@@ -77,5 +85,26 @@ export function runDamage(s: DamageScenario, preset: TargetPresetId = s.target ?
       throw new Error(`${key} not available: ${a && !a.available ? a.reason : "missing"}`);
     return a;
   };
-  return { ...p, view, rotation, result, ability };
+  const pet = resolved.pet
+    ? evaluatePet({
+        setup: resolved.pet,
+        level: 60,
+        owner: p.stats,
+        ownerSpells: spellFile(s.classToken).spells,
+        classSet: info.spellClassSet,
+        talents,
+        classTalents,
+        spellMods: p.assembled.mapping.spellMods,
+        target,
+        armorFormula: targets.armorFormula,
+      })
+    : null;
+  const petAbility = (key: string) => {
+    const a = pet?.abilities.find((x) => x.key === key);
+    if (!a || !a.available)
+      throw new Error(`pet ${key} not available: ${a && !a.available ? a.reason : "missing"}`);
+    return a;
+  };
+  const totalDps = result.rotation.dps + (pet?.rotation.dps ?? 0);
+  return { ...p, view, rotation, result, ability, pet, resolved, petAbility, totalDps };
 }
diff --git a/src/testkit/pets.ts b/src/testkit/pets.ts
new file mode 100644
index 0000000..bce6098
--- /dev/null
+++ b/src/testkit/pets.ts
@@ -0,0 +1,42 @@
+// TEST-ONLY helpers for pets. Never import from app code.
+import petsJson from "@manual/pets.json";
+import type { ClassToken, PetFile, PetsManualFile } from "@/data/types";
+import { NO_PET, resolvePet, type PetChoice, type ResolvedPet } from "@/engine/pets";
+import type { RankedTalent } from "@/engine/stats";
+
+export const petsManualFile = petsJson as unknown as PetsManualFile;
+const files = Object.values(import.meta.glob<{ default: unknown }>("@data/pets/*.json", { eager: true })).map(
+  (m) => m.default as unknown as PetFile,
+);
+export const petFile = (token: ClassToken): PetFile | null => files.find((f) => f.token === token) ?? null;
+
+/** A pet by name ("Cat", "Imp"); sacrifice by demon name. */
+export interface PetScenario {
+  family?: string;
+  sacrifice?: string;
+  scaling?: boolean;
+}
+export function petChoice(token: ClassToken, s: PetScenario | undefined): PetChoice {
+  if (!s) return NO_PET;
+  const id = (name: string | undefined) => {
+    if (!name) return 0;
+    const p = petFile(token)?.pets.find((x) => x.name === name);
+    if (!p) throw new Error(`no pet ${name} for ${token}`);
+    return p.id;
+  };
+  return { family: id(s.family), sacrifice: id(s.sacrifice), scaling: s.scaling ?? true };
+}
+export function scenarioPet(
+  token: ClassToken,
+  s: PetScenario | undefined,
+  talents: readonly RankedTalent[],
+): ResolvedPet {
+  return resolvePet({
+    choice: petChoice(token, s),
+    file: petFile(token),
+    manual: petsManualFile,
+    token,
+    talents,
+    level: 60,
+  });
+}
diff --git a/src/testkit/sim.ts b/src/testkit/sim.ts
index ff786f2..780bd70 100644
--- a/src/testkit/sim.ts
+++ b/src/testkit/sim.ts
@@ -4,6 +4,7 @@ import { classesFile } from "@/data";
 import { pickRotation } from "@/engine/rotation";
 import type { SimInput } from "@/engine/sim";
 import { EMPTY_BONUS, assemble, presetTarget } from "@/engine/stats";
+import { scenarioPet } from "./pets";
 import { NO_WEAPONS, baseStats, buffs, racials, ranked, targets } from "./stats";
 import { treeFor } from "./talents";
 import { rotations, spellFile, type DamageScenario } from "./damage";
@@ -28,6 +29,7 @@ export function simInput(s: SimScenario, preset: TargetPresetId = s.target ?? "b
   const tree = treeFor(s.classToken);
   const talents = ranked(s.classToken, s.talents ?? {});
   const info = classesFile.classes.find((c) => c.token === s.classToken)!;
+  const resolved = scenarioPet(s.classToken, s.pet, talents);
   const prepare = {
     classToken: s.classToken,
     race: s.race,
@@ -42,6 +44,8 @@ export function simInput(s: SimScenario, preset: TargetPresetId = s.target ?? "b
     spells: spellFile(s.classToken),
     spellClassSet: info.spellClassSet,
     classTalents: [...tree.nodes.values()].map((n) => n.talent),
+    petActive: resolved.pet !== null,
+    petOwnerEffects: resolved.ownerEffects,
   };
   const debuffs = assemble(prepare).debuffs;
   return {
@@ -49,5 +53,6 @@ export function simInput(s: SimScenario, preset: TargetPresetId = s.target ?? "b
     rotation: scenarioRotation(s),
     target: presetTarget(targets, preset, 60, debuffs),
     armorFormula: targets.armorFormula,
+    pet: resolved.pet,
   };
 }
````

### 6.7 B6: rotation notes, state (character, URL tag 8, store, derive), state tests, perf tests (task T8)

````diff
diff --git a/data/manual/rotations.json b/data/manual/rotations.json
index 960fe73..6421968 100644
--- a/data/manual/rotations.json
+++ b/data/manual/rotations.json
@@ -56,7 +56,7 @@
         { "ability": "Arcane Shot", "kind": "cooldown" },
         { "ability": "Serpent Sting", "kind": "dot" }
       ],
-      "notes": ["Pet damage arrives in Phase 6."] },
+      "notes": ["Choose a pet in the Pet panel: its damage (and Bestial Wrath in the simulation) is added to the DPS."] },
     { "id": "hunter-marksmanship", "class": "hunter", "spec": 1, "label": "Marksmanship: Sniper, Aimed, Multi, Arcane Shot", "role": "dps", "tier": 1,
       "selfBuffs": ["Aspect of the Hawk", "Hunter's Mark"], "melee": false, "autoShot": true,
       "entries": [
@@ -67,7 +67,7 @@
         { "ability": "Arcane Shot", "kind": "cooldown" },
         { "ability": "Serpent Sting", "kind": "dot" }
       ],
-      "notes": ["Rapid Fire is a simulation-only cooldown; Rapid Killing is not modeled. Lone Wolf assumes no pet (pets: Phase 6)."] },
+      "notes": ["Rapid Fire is a simulation-only cooldown; Rapid Killing is not modeled. Lone Wolf is active only while no pet is chosen in the Pet panel."] },
     { "id": "hunter-survival", "class": "hunter", "spec": 2, "label": "Ranged: Aimed, Multi, Arcane Shot, Serpent Sting", "role": "dps", "tier": 2,
       "selfBuffs": ["Aspect of the Hawk", "Hunter's Mark"], "melee": false, "autoShot": true,
       "entries": [
@@ -208,7 +208,7 @@
         { "ability": "Bane of Agony", "kind": "dot" },
         { "ability": "Shadow Bolt", "kind": "filler" }
       ],
-      "notes": ["Demon pets, Demonic Sacrifice and Master Demonologist arrive in Phase 6."] },
+      "notes": ["Choose a demon or a Demonic Sacrifice in the Pet panel (Master Demonologist, Soul Link and Demonic Knowledge follow the demon)."] },
     { "id": "warlock-destruction", "class": "warlock", "spec": 2, "label": "Destruction: Immolate, Conflagrate, Incinerate or Shadow Bolt", "role": "dps", "tier": 1,
       "selfBuffs": [], "melee": false, "autoShot": false,
       "entries": [
diff --git a/src/state/charCode.ts b/src/state/charCode.ts
index 2b04bdd..0ebb1d3 100644
--- a/src/state/charCode.ts
+++ b/src/state/charCode.ts
@@ -1,4 +1,5 @@
 import type { TargetPresetId } from "@/data/types";
+import { NO_PET, type PetChoice } from "@/engine/pets/types";
 import { CONDITION_TYPES } from "@/engine/rotation/conditions";
 
 /** Condition type indices whose operand is a number (stored in tenths); the others carry a ref key. */
@@ -80,9 +81,19 @@ export interface CharacterCode {
   target: { preset: TargetPresetId; custom?: CustomTarget }; // custom only with preset "custom"
   rotation?: RotationCode; // Phase 5; absent = default rotation (spec with the most points)
   sim?: SimCode; // Phase 5; absent = DEFAULT_SIM_CODE
+  pet?: PetChoice; // Phase 6; absent = NO_PET (no pet, scaling on)
 }
 
-export const TAG = { race: 1, weapons: 2, bonus: 3, buffs: 4, target: 5, rotation: 6, sim: 7 } as const;
+export const TAG = {
+  race: 1,
+  weapons: 2,
+  bonus: 3,
+  buffs: 4,
+  target: 5,
+  rotation: 6,
+  sim: 7,
+  pet: 8,
+} as const;
 export const DEFAULT_SIM_CODE: SimCode = { fightSec: 180, iterations: 1000, seed: 1, unlimitedMana: true };
 /** Entry head bits above the kind (kind < 16). */
 const ENTRY_OFF = 16;
@@ -175,6 +186,9 @@ export function encodeCharacterBytes(c: CharacterCode): number[] {
   const s = c.sim;
   if (s && JSON.stringify(s) !== JSON.stringify(DEFAULT_SIM_CODE))
     record(TAG.sim, [s.fightSec, s.iterations, s.seed, s.unlimitedMana ? 1 : 0].flatMap(varint));
+  const p = c.pet;
+  if (p && (p.family !== NO_PET.family || p.sacrifice !== NO_PET.sacrifice || p.scaling !== NO_PET.scaling))
+    record(TAG.pet, [p.family, p.sacrifice, p.scaling ? 0 : 1].flatMap(varint));
   return out;
 }
 
@@ -313,6 +327,10 @@ export function decodeCharacterBytes(bytes: Uint8Array): CharacterCode | null {
         if (v.length !== 4 || v[3]! > 1) return null;
         c.sim = { fightSec: v[0]!, iterations: v[1]!, seed: v[2]!, unlimitedMana: v[3] === 1 };
         break;
+      case TAG.pet:
+        if (v.length !== 3 || v[2]! > 1) return null;
+        c.pet = { family: v[0]!, sacrifice: v[1]!, scaling: v[2] === 0 };
+        break;
       default:
         break; // unknown tag from a newer version: ignore
     }
diff --git a/src/state/character.ts b/src/state/character.ts
index e650dee..9d36eca 100644
--- a/src/state/character.ts
+++ b/src/state/character.ts
@@ -1,6 +1,7 @@
 import { create } from "zustand";
-import { buffsFile, getClassInfo, loadWeapons } from "@/data";
-import type { ClassToken, MagicSchool, TargetPresetId, WeaponsFile } from "@/data/types";
+import { buffsFile, getClassInfo, loadWeapons, petsManual } from "@/data";
+import type { ClassToken, MagicSchool, PetFile, TargetPresetId, WeaponsFile } from "@/data/types";
+import { NO_PET, type PetChoice } from "@/engine/pets";
 import { EMPTY_BONUS, ammoFor, weaponsForSlot, type BonusStats } from "@/engine/stats";
 import { BONUS_SCALE, type CharacterCode, type CustomTarget } from "./charCode";
 
@@ -55,7 +56,11 @@ export interface CharacterState {
   target: TargetPresetId;
   custom: CustomTarget;
   weapons: WeaponsFile | null; // lazy weapons.json
+  pet: PetChoice; // Phase 6: active pet, sacrificed demon, owner scaling (URL tag 8)
   setRace(id: number): void;
+  setPet(patch: Partial<PetChoice>): void;
+  /** Phase 6: the pet of a link, checked against pets/<class>.json (false if something was dropped). */
+  applyPet(code: PetChoice | undefined, file: PetFile | null): boolean;
   setWeapon(slot: WeaponSlotKey, id: number, classToken: ClassToken, level: number): void;
   setBonus(key: keyof BonusStats, value: number): void;
   resetBonus(): void;
@@ -135,9 +140,23 @@ export const useCharacter = create<CharacterState>()((set, get) => ({
   target: "boss",
   custom: DEFAULT_CUSTOM,
   weapons: null,
+  pet: NO_PET,
   setRace(id) {
     set({ raceId: id });
   },
+  setPet(patch) {
+    set({ pet: { ...get().pet, ...patch } });
+  },
+  applyPet(code, file) {
+    const c = code ?? NO_PET;
+    const family = file?.pets.some((p) => p.id === c.family) ? c.family : 0;
+    const sacrifice =
+      file?.token === "warlock" && petsManual.sacrifice.some((s) => s.family === c.sacrifice)
+        ? c.sacrifice
+        : 0;
+    set({ pet: { family, sacrifice, scaling: c.scaling } });
+    return family === c.family && sacrifice === c.sacrifice;
+  },
   setWeapon(slot, id, token, level) {
     const file = get().weapons;
     if (!file) return;
@@ -171,7 +190,7 @@ export const useCharacter = create<CharacterState>()((set, get) => ({
     const file = await weaponsFor(get().weaponIds);
     const weaponIds = file ? sanitizeWeapons(get().weaponIds, file, token, level) : NO_WEAPON_IDS;
     const kept = JSON.stringify(weaponIds) === JSON.stringify(get().weaponIds);
-    set({ raceId, weaponIds, ...(file ? { weapons: file } : {}) });
+    set({ raceId, weaponIds, pet: NO_PET, ...(file ? { weapons: file } : {}) });
     return kept;
   },
   async applyCode(code, token, level) {
@@ -218,6 +237,11 @@ export const useCharacter = create<CharacterState>()((set, get) => ({
       bonus,
       buffCodes: buffsFile.buffs.filter((b) => s.buffIds.includes(b.id)).map((b) => b.code),
       target: s.target === "custom" ? { preset: "custom", custom: s.custom } : { preset: s.target },
+      ...(s.pet.family !== NO_PET.family ||
+      s.pet.sacrifice !== NO_PET.sacrifice ||
+      s.pet.scaling !== NO_PET.scaling
+        ? { pet: s.pet }
+        : {}),
     };
   },
 }));
diff --git a/src/state/derived.ts b/src/state/derived.ts
index c244e21..c3d022e 100644
--- a/src/state/derived.ts
+++ b/src/state/derived.ts
@@ -1,5 +1,14 @@
-import { baseStatsFile, buffsFile, getRace, racialsFile, rotationsFile, targetsFile } from "@/data";
-import type { ClassSpellFile, MagicSchool, SpecRotation, TargetPresetId } from "@/data/types";
+import {
+  baseStatsFile,
+  buffsFile,
+  getRace,
+  petsManual,
+  racialsFile,
+  rotationsFile,
+  targetsFile,
+} from "@/data";
+import type { ClassSpellFile, MagicSchool, PetFile, SpecRotation, TargetPresetId } from "@/data/types";
+import { PET_TALENT_IDS, evaluatePet, resolvePet, type PetDamage, type ResolvedPet } from "@/engine/pets";
 import { pointsBySpec, type ClassTree, type Ranks } from "@/engine/talents";
 import { SPECIAL_HANDLERS, type ActiveHandler } from "@/engine/talents/special";
 import {
@@ -21,6 +30,7 @@ import {
   type EquippedWeapons,
   type NotModeled,
   type TalentMapping,
+  type TargetInput,
   type TargetView,
 } from "@/engine/stats";
 import type { CharacterState } from "./character";
@@ -33,13 +43,16 @@ export interface DamageView {
   rotation: SpecRotation;
   result: DamageResult;
   handlers: ActiveHandler[];
+  pet: PetDamage | null; // Phase 6: the active pet vs the selected target
+  totalDps: number; // owner + pet
+  petNotes: string[]; // parts of the pet choice that do nothing (resolvePet)
 }
 export type Derived =
   | {
       ok: true;
       stats: CharacterStats;
       view: TargetView;
-      reference: TargetView[]; // `dps` filled when `damage` is not null
+      reference: TargetView[]; // `dps` (owner + pet) filled when `damage` is not null
       mapping: TalentMapping;
       notModeled: NotModeled[]; // mapping.notModeled minus what the damage engine models (section 8.4)
       damage: DamageView | null;
@@ -47,11 +60,18 @@ export type Derived =
     }
   | { ok: false; reason: "noClass" | "level" };
 
-type CalcInput = { tree: ClassTree | null; ranks: Ranks; level: number; spells: ClassSpellFile | null };
+type CalcInput = {
+  tree: ClassTree | null;
+  ranks: Ranks;
+  level: number;
+  spells: ClassSpellFile | null;
+  pets?: PetFile | null; // Phase 6
+};
 type CharInput = Pick<
   CharacterState,
   "raceId" | "weaponIds" | "bonus" | "buffIds" | "target" | "custom" | "weapons"
->;
+> &
+  Partial<Pick<CharacterState, "pet">>;
 
 /** Phase 5: the inputs derive and simInputFor share (weapons, talents, assemble arguments, rotation, custom target). */
 function inputsOf(calc: CalcInput & { tree: ClassTree }, ch: CharInput, custom: SpecRotation | null) {
@@ -71,6 +91,16 @@ function inputsOf(calc: CalcInput & { tree: ClassTree }, ch: CharInput, custom:
     .filter((id) => (calc.ranks[id] ?? 0) > 0)
     .map((id) => ({ talent: tree.nodes.get(id)!.talent, rank: calc.ranks[id]! }));
   const classTalents = tree.order.map((id) => tree.nodes.get(id)!.talent);
+  const pet: ResolvedPet | null = ch.pet
+    ? resolvePet({
+        choice: ch.pet,
+        file: calc.pets ?? null,
+        manual: petsManual,
+        token: tree.token,
+        talents,
+        level: calc.level,
+      })
+    : null;
   const args = {
     classToken: tree.token,
     race: getRace(ch.raceId).token.toUpperCase(),
@@ -82,6 +112,8 @@ function inputsOf(calc: CalcInput & { tree: ClassTree }, ch: CharInput, custom:
     talents,
     weapons,
     bonus: ch.bonus,
+    petActive: pet?.pet != null,
+    petOwnerEffects: pet?.ownerEffects ?? [],
   };
   // The editor's rotation (Phase 5) when it belongs to this class, else the spec with the most points.
   const chosen =
@@ -93,14 +125,14 @@ function inputsOf(calc: CalcInput & { tree: ClassTree }, ch: CharInput, custom:
     number
   >;
   const customTarget = { level: ch.custom.level, armor: ch.custom.armor, resist };
-  return { weapons, talents, classTalents, args, rotation: enabledRotation(chosen), customTarget };
+  return { weapons, talents, classTalents, args, rotation: enabledRotation(chosen), customTarget, pet };
 }
 
 /** Pure: everything the stats and damage UI shows, from the stores (`custom`: the rotation editor's rotation). */
 export function derive(calc: CalcInput, ch: CharInput, custom: SpecRotation | null = null): Derived {
   const tree = calc.tree;
   if (!tree || ch.raceId === 0) return { ok: false, reason: "noClass" };
-  const { weapons, talents, classTalents, args, rotation, customTarget } = inputsOf(
+  const { weapons, talents, classTalents, args, rotation, customTarget, pet } = inputsOf(
     { ...calc, tree },
     ch,
     custom,
@@ -128,13 +160,23 @@ export function derive(calc: CalcInput, ch: CharInput, custom: SpecRotation | nu
     throw e;
   }
   const dw = weapons.offHand !== null;
-  const at = (p: TargetPresetId) =>
-    evaluateTarget(
-      stats,
-      presetTarget(targetsFile, p, calc.level, a.debuffs, customTarget),
-      targetsFile.armorFormula,
-      dw,
-    );
+  const targetOf = (p: TargetPresetId) => presetTarget(targetsFile, p, calc.level, a.debuffs, customTarget);
+  const at = (p: TargetPresetId) => evaluateTarget(stats, targetOf(p), targetsFile.armorFormula, dw);
+  const petAt = (target: TargetInput): PetDamage | null =>
+    prepared && pet?.pet && calc.spells
+      ? evaluatePet({
+          setup: pet.pet,
+          level: calc.level,
+          owner: stats,
+          ownerSpells: calc.spells.spells,
+          classSet: tree.info.spellClassSet,
+          talents,
+          classTalents,
+          spellMods: a.mapping.spellMods,
+          target,
+          armorFormula: targetsFile.armorFormula,
+        })
+      : null;
   const damageAt = (view: TargetView): DamageResult | null =>
     prepared
       ? evaluateDamage({
@@ -153,14 +195,26 @@ export function derive(calc: CalcInput, ch: CharInput, custom: SpecRotation | nu
       : null;
   const view = at(ch.target);
   const result = damageAt(view);
+  const petResult = result ? petAt(targetOf(ch.target)) : null;
   const reference = [...REFERENCE_PRESETS, ...(ch.target === "custom" ? (["custom"] as const) : [])].map(
     (p) => {
       const v = at(p);
       const d = p === ch.target && result ? result : damageAt(v);
-      return d ? { ...v, dps: d.rotation.dps } : v;
+      const pd = p === ch.target ? petResult : d ? petAt(targetOf(p)) : null;
+      return d ? { ...v, dps: d.rotation.dps + (pd?.rotation.dps ?? 0) } : v;
     },
   );
-  const damage = result && prepared ? { rotation, result, handlers: prepared.handlers } : null;
+  const damage =
+    result && prepared
+      ? {
+          rotation,
+          result,
+          handlers: prepared.handlers,
+          pet: petResult,
+          totalDps: result.rotation.dps + (petResult?.rotation.dps ?? 0),
+          petNotes: pet?.notes ?? [],
+        }
+      : null;
   return {
     ok: true,
     stats,
@@ -190,6 +244,7 @@ export function simInputFor(calc: CalcInput, ch: CharInput, custom: SpecRotation
       rotation: x.rotation,
       target: presetTarget(targetsFile, ch.target, calc.level, debuffs, x.customTarget),
       armorFormula: targetsFile.armorFormula,
+      pet: x.pet?.pet ?? null,
     };
   } catch (e) {
     if (e instanceof UnsupportedLevelError) return null;
@@ -206,6 +261,7 @@ function notModeled(mapping: TalentMapping, tree: ClassTree, damage: DamageView
     const t = tree.nodes.get(n.nodeId)?.talent;
     if (!t) return true;
     if (n.reason === "special" && SPECIAL_HANDLERS.has(t.spellId)) return false;
+    if (PET_TALENT_IDS.has(t.spellId)) return false; // Phase 6: modeled with the pet choice (Pet panel)
     if (n.reason === "ability" && used.has(t.name)) return false;
     return true;
   });
diff --git a/src/state/perf.test.ts b/src/state/perf.test.ts
index e4973f4..2058de0 100644
--- a/src/state/perf.test.ts
+++ b/src/state/perf.test.ts
@@ -3,6 +3,7 @@ import { buffsFile } from "@/data";
 import { treeFor } from "@/testkit/talents";
 import { weaponsFile } from "@/testkit/stats";
 import { spellFile } from "@/testkit/damage";
+import { petFile } from "@/testkit/pets";
 import { EMPTY_BONUS } from "@/engine/stats";
 import { DEFAULT_CUSTOM, NO_WEAPON_IDS } from "./character";
 import { derive } from "./derived";
@@ -18,14 +19,22 @@ function maxSpec(token: ClassToken, spec: number): Record<number, number> {
 
 describe("performance budget (section 10.4)", () => {
   it("derive with damage vs 5 targets stays under 5 ms per talent click", () => {
-    const cases: [ClassToken, number, number, Partial<typeof NO_WEAPON_IDS>][] = [
-      ["warrior", 1, 1, { mainHand: 18832, offHand: 19352 }],
-      ["rogue", 1, 1, { mainHand: 18832, offHand: 19352 }],
-      ["mage", 1, 1, {}],
-      ["hunter", 1, 3, { ranged: 18713, ammo: 18042 }],
+    const cases: [ClassToken, number, number, Partial<typeof NO_WEAPON_IDS>, number][] = [
+      ["warrior", 1, 1, { mainHand: 18832, offHand: 19352 }, 0],
+      ["rogue", 1, 1, { mainHand: 18832, offHand: 19352 }, 0],
+      ["mage", 1, 1, {}, 0],
+      ["hunter", 1, 3, { ranged: 18713, ammo: 18042 }, 0],
+      ["hunter", 0, 3, { ranged: 18713, ammo: 18042 }, 2], // Phase 6: BM with a Cat
+      ["warlock", 1, 1, {}, 17], // Phase 6: Demonology with a Succubus
     ];
-    for (const [token, spec, raceId, weapons] of cases) {
-      const calc = { tree: treeFor(token), ranks: maxSpec(token, spec), level: 60, spells: spellFile(token) };
+    for (const [token, spec, raceId, weapons, family] of cases) {
+      const calc = {
+        tree: treeFor(token),
+        ranks: maxSpec(token, spec),
+        level: 60,
+        spells: spellFile(token),
+        pets: petFile(token),
+      };
       const ch = {
         raceId,
         weaponIds: { ...NO_WEAPON_IDS, ...weapons },
@@ -34,6 +43,7 @@ describe("performance budget (section 10.4)", () => {
         target: "custom" as const, // 5 targets
         custom: DEFAULT_CUSTOM,
         weapons: weaponsFile,
+        pet: { family, sacrifice: 0, scaling: true },
       };
       for (let i = 0; i < 20; i++) derive(calc, ch); // warm-up (JIT)
       const n = 100;
diff --git a/src/state/pets.test.ts b/src/state/pets.test.ts
new file mode 100644
index 0000000..a7715ea
--- /dev/null
+++ b/src/state/pets.test.ts
@@ -0,0 +1,96 @@
+// Phase 6 state: URL tag 8 (goldens from the independent Python encoder, plan section 8.4), store and derive.
+import { describe, expect, it } from "vitest";
+import { isClassToken } from "@/data";
+import { NO_PET } from "@/engine/pets";
+import { EMPTY_BONUS } from "@/engine/stats";
+import { spellFile } from "@/testkit/damage";
+import { petFile } from "@/testkit/pets";
+import { weaponsFile } from "@/testkit/stats";
+import { treeFor } from "@/testkit/talents";
+import { decodeBuild, encodeBuild } from "./buildCode";
+import { DEFAULT_CUSTOM, NO_WEAPON_IDS, useCharacter } from "./character";
+import { DEFAULT_CHARACTER, decodeCharacterBytes, encodeCharacterBytes } from "./charCode";
+import { derive, simInputFor } from "./derived";
+
+const dec = (s: string) => decodeBuild(s, isClassToken);
+const build = (classToken: "hunter" | "warlock", character = DEFAULT_CHARACTER) => ({
+  classToken,
+  level: 60,
+  talentedRank: 0,
+  ranks: {},
+  character,
+});
+
+describe("URL tag 8 (pet)", () => {
+  it("golden vectors (independent Python encoder)", () => {
+    const cat = { ...DEFAULT_CHARACTER, pet: { family: 2, sacrifice: 0, scaling: true } };
+    const lock = { ...DEFAULT_CHARACTER, pet: { family: 17, sacrifice: 23, scaling: false } };
+    const serpent = {
+      ...DEFAULT_CHARACTER,
+      sim: { fightSec: 300, iterations: 2000, seed: 42, unlimitedMana: false },
+      pet: { family: 27, sacrifice: 0, scaling: true },
+    };
+    expect(encodeBuild(build("hunter", cat))).toBe("#v2.hunter.60.0..CAMCAAA");
+    expect(encodeBuild(build("warlock", lock))).toBe("#v2.warlock.60.0..CAMRFwE");
+    expect(encodeBuild(build("hunter", serpent))).toBe("#v2.hunter.60.0..BwasAtAPKgAIAxsAAA");
+    expect(dec("#v2.hunter.60.0..CAMCAAA")).toEqual({ ok: true, build: build("hunter", cat) });
+    expect(dec("#v2.warlock.60.0..CAMRFwE")).toEqual({ ok: true, build: build("warlock", lock) });
+    expect(dec("#v2.hunter.60.0..BwasAtAPKgAIAxsAAA")).toEqual({ ok: true, build: build("hunter", serpent) });
+  });
+  it("no pet is the default (no record, v1 links unchanged); bad records are rejected", () => {
+    expect(encodeCharacterBytes({ ...DEFAULT_CHARACTER, pet: NO_PET })).toEqual([]);
+    expect(encodeBuild(build("hunter", { ...DEFAULT_CHARACTER, pet: NO_PET }))).toBe("#v1.hunter.60.0");
+    expect(decodeCharacterBytes(Uint8Array.from([8, 3, 2, 0, 2]))).toBeNull(); // flag > 1
+    expect(decodeCharacterBytes(Uint8Array.from([8, 2, 2, 0]))).toBeNull(); // 3 varints
+    expect(decodeCharacterBytes(Uint8Array.from([8, 3, 2, 0, 0, 9, 1, 0]))?.pet).toEqual({
+      family: 2,
+      sacrifice: 0,
+      scaling: true,
+    }); // later unknown tags still skipped
+  });
+  it("applyPet keeps valid choices and drops pets of another class", () => {
+    const s = useCharacter.getState();
+    expect(s.applyPet({ family: 2, sacrifice: 0, scaling: false }, petFile("hunter"))).toBe(true);
+    expect(useCharacter.getState().pet).toEqual({ family: 2, sacrifice: 0, scaling: false });
+    expect(s.applyPet({ family: 23, sacrifice: 23, scaling: true }, petFile("hunter"))).toBe(false);
+    expect(useCharacter.getState().pet).toEqual(NO_PET);
+    expect(s.applyPet({ family: 17, sacrifice: 23, scaling: true }, petFile("warlock"))).toBe(true);
+    expect(s.applyPet(undefined, null)).toBe(true);
+    expect(useCharacter.getState().pet).toEqual(NO_PET);
+  });
+});
+
+describe("derive with a pet", () => {
+  const ch = {
+    raceId: 3,
+    weaponIds: NO_WEAPON_IDS,
+    bonus: EMPTY_BONUS,
+    buffIds: [],
+    target: "custom" as const,
+    custom: DEFAULT_CUSTOM,
+    weapons: weaponsFile,
+  };
+  const calc = {
+    tree: treeFor("hunter"),
+    ranks: {},
+    level: 60,
+    spells: spellFile("hunter"),
+    pets: petFile("hunter"),
+  };
+  it("total and reference DPS include the pet; the sim input carries it", () => {
+    const none = derive(calc, { ...ch, pet: NO_PET });
+    const cat = derive(calc, { ...ch, pet: { family: 2, sacrifice: 0, scaling: true } });
+    if (!none.ok || !cat.ok) throw new Error("not ok");
+    expect(none.damage!.pet).toBeNull();
+    const p = cat.damage!.pet!;
+    expect(p.name).toBe("Cat");
+    expect(cat.damage!.totalDps).toBeCloseTo(cat.damage!.result.rotation.dps + p.rotation.dps, 10);
+    expect(cat.damage!.totalDps).toBeGreaterThan(none.damage!.totalDps);
+    for (let i = 0; i < cat.reference.length; i++)
+      expect(cat.reference[i]!.dps!).toBeGreaterThan(none.reference[i]!.dps!);
+    expect(cat.reference.find((v) => v.presetId === "custom")!.dps).toBeCloseTo(cat.damage!.totalDps, 10);
+    const input = simInputFor(calc, { ...ch, pet: { family: 2, sacrifice: 0, scaling: true } }, null)!;
+    expect(input.pet!.info.name).toBe("Cat");
+    expect(input.prepare.petActive).toBe(true);
+  });
+});
diff --git a/src/state/store.ts b/src/state/store.ts
index 7d92065..42eda4d 100644
--- a/src/state/store.ts
+++ b/src/state/store.ts
@@ -1,6 +1,6 @@
 import { create } from "zustand";
-import { classesFile, getClassInfo, loadClassSpells, loadTalentFile } from "@/data";
-import type { ClassSpellFile, ClassToken } from "@/data/types";
+import { classesFile, getClassInfo, loadClassSpells, loadPetFile, loadTalentFile } from "@/data";
+import type { ClassSpellFile, ClassToken, PetFile } from "@/data/types";
 import {
   addPoint as addPointRule,
   buildClassTree,
@@ -20,6 +20,7 @@ export interface CalcState {
   classToken: ClassToken | null;
   tree: ClassTree | null;
   spells: ClassSpellFile | null; // spells/<class>.json, loaded with the talent file (Phase 4)
+  pets: PetFile | null; // pets/<class>.json (Phase 6): hunter and warlock, null for the other classes
   status: "idle" | "loading" | "ready" | "error";
   error: string | null;
   notice: string | null;
@@ -47,15 +48,22 @@ export const pointsContext = (s: Pick<CalcState, "level" | "talentedRank">): Poi
 
 let requestId = 0;
 
-async function loadTree(token: ClassToken): Promise<{ tree: ClassTree; spells: ClassSpellFile }> {
-  const [file, spells] = await Promise.all([loadTalentFile(token), loadClassSpells(token)]);
-  return { tree: buildClassTree(file, getClassInfo(token)), spells };
+async function loadTree(
+  token: ClassToken,
+): Promise<{ tree: ClassTree; spells: ClassSpellFile; pets: PetFile | null }> {
+  const [file, spells, pets] = await Promise.all([
+    loadTalentFile(token),
+    loadClassSpells(token),
+    loadPetFile(token),
+  ]);
+  return { tree: buildClassTree(file, getClassInfo(token)), spells, pets };
 }
 
 export const useCalc = create<CalcState>()((set, get) => ({
   classToken: null,
   tree: null,
   spells: null,
+  pets: null,
   status: "idle",
   error: null,
   notice: null,
@@ -68,7 +76,7 @@ export const useCalc = create<CalcState>()((set, get) => ({
     const id = ++requestId;
     set({ classToken: token, status: "loading", error: null });
     try {
-      const [{ tree, spells }, charOk] = await Promise.all([
+      const [{ tree, spells, pets }, charOk] = await Promise.all([
         loadTree(token),
         useCharacter.getState().fitToClass(token, get().level),
       ]);
@@ -77,6 +85,7 @@ export const useCalc = create<CalcState>()((set, get) => ({
       set({
         tree,
         spells,
+        pets,
         status: "ready",
         ranks: {},
         activeSpec: 0,
@@ -84,14 +93,20 @@ export const useCalc = create<CalcState>()((set, get) => ({
       });
     } catch (e) {
       if (id !== requestId) return;
-      set({ tree: null, spells: null, status: "error", error: e instanceof Error ? e.message : String(e) });
+      set({
+        tree: null,
+        spells: null,
+        pets: null,
+        status: "error",
+        error: e instanceof Error ? e.message : String(e),
+      });
     }
   },
   async applyBuildCode(code) {
     const id = ++requestId;
     set({ classToken: code.classToken, status: "loading", error: null });
     try {
-      const [{ tree, spells }, charOk] = await Promise.all([
+      const [{ tree, spells, pets }, charOk] = await Promise.all([
         loadTree(code.classToken),
         useCharacter.getState().applyCode(code.character, code.classToken, code.level),
       ]);
@@ -101,9 +116,11 @@ export const useCalc = create<CalcState>()((set, get) => ({
       const rotationOk = useRotation
         .getState()
         .applyCode(code.character, code.classToken, catalogFor(spells, tree));
+      const petOk = useCharacter.getState().applyPet(code.character.pet, pets);
       set({
         tree,
         spells,
+        pets,
         status: "ready",
         level: code.level,
         talentedRank: code.talentedRank,
@@ -114,13 +131,20 @@ export const useCalc = create<CalcState>()((set, get) => ({
             dropped ? "Some talents in this link were not valid and were removed." : "",
             charOk ? "" : "Some character settings in this link were not valid and were removed.",
             rotationOk ? "" : "Some rotation settings in this link were not valid and were removed.",
+            petOk ? "" : "The pet in this link is not valid for this class and was removed.",
           ]
             .filter(Boolean)
             .join(" ") || null,
       });
     } catch (e) {
       if (id !== requestId) return;
-      set({ tree: null, spells: null, status: "error", error: e instanceof Error ? e.message : String(e) });
+      set({
+        tree: null,
+        spells: null,
+        pets: null,
+        status: "error",
+        error: e instanceof Error ? e.message : String(e),
+      });
     }
   },
   clearClass() {
@@ -130,6 +154,7 @@ export const useCalc = create<CalcState>()((set, get) => ({
       classToken: null,
       tree: null,
       spells: null,
+      pets: null,
       status: "idle",
       error: null,
       ranks: {},
````

### 6.8 B7: UI (Pet panel, Damage panel pet section, Simulation panel pet rows) (task T8)

````diff
diff --git a/src/ui/character/CharacterPanel.tsx b/src/ui/character/CharacterPanel.tsx
index 516f5fd..1aa9fe9 100644
--- a/src/ui/character/CharacterPanel.tsx
+++ b/src/ui/character/CharacterPanel.tsx
@@ -6,6 +6,7 @@ import { useCharacter } from "@/state/character";
 import { useCalc } from "@/state/store";
 import { BonusStats } from "./BonusStats";
 import { BuffsPanel } from "./BuffsPanel";
+import { PetPanel } from "./PetPanel";
 import { TargetPanel } from "./TargetPanel";
 import { WeaponPicker } from "./WeaponPicker";
 import styles from "./CharacterPanel.module.css";
@@ -144,6 +145,7 @@ export function CharacterPanel() {
         </div>
       </section>
       <WeaponsSection />
+      <PetPanel />
       <BonusStats hasSpell={hasSpell} hasRap={hasRap} />
       <BuffsPanel />
       <TargetPanel />
diff --git a/src/ui/character/PetPanel.tsx b/src/ui/character/PetPanel.tsx
new file mode 100644
index 0000000..3f24ad1
--- /dev/null
+++ b/src/ui/character/PetPanel.tsx
@@ -0,0 +1,107 @@
+import { petsManual } from "@/data";
+import type { PetFile, PetInfo } from "@/data/types";
+import { PET_TALENT } from "@/engine/pets";
+import { useCharacter } from "@/state/character";
+import { useCalc } from "@/state/store";
+import styles from "./CharacterPanel.module.css";
+
+/** Family damage modifier of a pet from its family passive (aura 79 on physical, e.g. Cat +10%). */
+function familyText(p: PetInfo, file: PetFile): string {
+  for (const id of p.passives) {
+    const s = file.spells.find((x) => x.id === id);
+    const e =
+      s?.name === "Tamed Pet Passive (DND)" ? s.effects.find((x) => x.aura === 79 && x.misc[0] === 1) : null;
+    if (e && e.base !== 0) return ` (${e.base > 0 ? "+" : ""}${e.base}% damage)`;
+  }
+  return "";
+}
+
+/** Phase 6: active pet, sacrificed demon (warlock) and owner scaling (Q5). Hunters and warlocks only. */
+export function PetPanel() {
+  const file = useCalc((s) => s.pets);
+  const tree = useCalc((s) => s.tree);
+  const ranks = useCalc((s) => s.ranks);
+  const pet = useCharacter((s) => s.pet);
+  const setPet = useCharacter((s) => s.setPet);
+  if (!file || !tree) return null;
+  const hasTalent = (spellId: number) =>
+    tree.order.some((id) => tree.nodes.get(id)!.talent.spellId === spellId && (ranks[id] ?? 0) > 0);
+  const pets = [...file.pets].sort((a, b) => a.name.localeCompare(b.name));
+  const warlock = file.token === "warlock";
+  const canSacrifice = hasTalent(PET_TALENT.DEMONIC_SACRIFICE);
+  const pact = hasTalent(PET_TALENT.DEMONIC_PACT);
+  const scaling = petsManual.owners[file.token]?.scaling;
+  return (
+    <section className={styles.section} aria-labelledby="pet-h" data-testid="pet-panel">
+      <h2 className={styles.heading} id="pet-h">
+        {warlock ? "Demon" : "Pet"}
+      </h2>
+      <div className={styles.field}>
+        <select
+          className={styles.select}
+          data-testid="pet-select"
+          aria-label={warlock ? "Demon" : "Pet"}
+          value={pet.family}
+          onChange={(e) => setPet({ family: Number(e.target.value) })}
+        >
+          <option value={0}>None</option>
+          {pets.map((p) => (
+            <option key={p.id} value={p.id}>
+              {p.name}
+              {p.exotic ? " (exotic)" : ""}
+              {familyText(p, file)}
+            </option>
+          ))}
+        </select>
+      </div>
+      {warlock && (
+        <div className={styles.field}>
+          <label htmlFor="pet-sacrifice" className={styles.dim}>
+            Demonic Sacrifice
+          </label>
+          <select
+            id="pet-sacrifice"
+            className={styles.select}
+            data-testid="pet-sacrifice"
+            disabled={!canSacrifice}
+            title={canSacrifice ? undefined : "Needs the talent Demonic Sacrifice"}
+            value={pet.sacrifice}
+            onChange={(e) => {
+              const sacrifice = Number(e.target.value);
+              // Summoning a demon cancels the sacrifice unless Demonic Pact keeps it for a different demon.
+              const family = sacrifice && (!pact || pet.family === sacrifice) ? 0 : pet.family;
+              setPet({ sacrifice, family });
+            }}
+          >
+            <option value={0}>None</option>
+            {petsManual.sacrifice.map((s) => (
+              <option key={s.family} value={s.family}>
+                {s.name} ({s.spellName})
+              </option>
+            ))}
+          </select>
+        </div>
+      )}
+      <label className={styles.buff}>
+        <input
+          type="checkbox"
+          data-testid="pet-scaling"
+          checked={pet.scaling}
+          onChange={(e) => setPet({ scaling: e.target.checked })}
+        />
+        <span>
+          Pet scales with your stats{" "}
+          <span className={styles.dim}>
+            {scaling
+              ? `(${scaling.attackPowerPct}% of your ${warlock ? "spell power" : "ranged attack power"} as attack power, ${scaling.spellPowerPct}% as spell power${scaling.inheritHit ? ", your hit" : ""})`
+              : ""}
+          </span>
+        </span>
+      </label>
+      <p className={styles.hint}>
+        Pet stats are unverified Classic/TBC values (Q5). Pet damage is added to the DPS in the Damage and
+        Simulation panels.
+      </p>
+    </section>
+  );
+}
diff --git a/src/ui/results/DamagePanel.module.css b/src/ui/results/DamagePanel.module.css
index c1211ee..85bc5ad 100644
--- a/src/ui/results/DamagePanel.module.css
+++ b/src/ui/results/DamagePanel.module.css
@@ -83,3 +83,21 @@
   color: var(--text-dim);
   font-weight: normal;
 }
+
+.pet {
+  margin-top: 12px;
+  padding-top: 8px;
+  border-top: 1px solid var(--panel-border);
+}
+
+.petTitle {
+  margin: 0 0 4px;
+  color: var(--gold);
+  font-size: 16px;
+}
+
+.dpsSmall {
+  color: var(--white);
+  font-size: 20px;
+  font-weight: bold;
+}
diff --git a/src/ui/results/DamagePanel.tsx b/src/ui/results/DamagePanel.tsx
index 0f2df08..88230f3 100644
--- a/src/ui/results/DamagePanel.tsx
+++ b/src/ui/results/DamagePanel.tsx
@@ -1,4 +1,5 @@
 import type { AbilityResult } from "@/engine/abilities";
+import type { PetDamage } from "@/engine/pets";
 import type { Derived } from "@/state/derived";
 import { AbilityCard } from "@/ui/abilities/AbilityCard";
 import abilityStyles from "@/ui/abilities/Abilities.module.css";
@@ -67,6 +68,75 @@ function Resource({ d }: { d: Ok }) {
   );
 }
 
+/** Phase 6: the pet's damage (its own stats and outcome tables) with a breakdown and one card per ability. */
+function PetSection({ p, total }: { p: PetDamage; total: number }) {
+  const r = p.rotation;
+  const perMinute = new Map(r.casts.map((c) => [c.key, c.perMinute]));
+  const rows = [
+    ...r.casts
+      .filter((c) => c.perMinute > 0)
+      .map((c) => ({ key: c.key, perMinute: c.perMinute, dps: c.dps })),
+    ...Object.values(r.white).map((w) => ({
+      key: w!.white.name,
+      perMinute: w!.swingsPerMinute,
+      dps: w!.dps,
+    })),
+  ].sort((a, b) => b.dps - a.dps);
+  const cards = p.abilities.filter((a): a is AbilityResult => a.available && a.expected > 0);
+  return (
+    <section className={styles.pet} data-testid="pet-damage" aria-label={`Pet: ${p.name}`}>
+      <h3 className={styles.petTitle}>
+        Pet: {p.name}{" "}
+        <span className={styles.dpsSmall} data-testid="pet-dps">
+          {fmtDec1(r.dps)}
+        </span>{" "}
+        <span className={styles.unit}>
+          DPS ({fmtPct(total > 0 ? (r.dps / total) * 100 : 0)} of the total)
+        </span>
+      </h3>
+      <p className={styles.line} data-testid="pet-stats">
+        Attack power {fmtInt(p.stats.attackPower.value)} · spell power {fmtInt(p.stats.spellPower.fire.value)}{" "}
+        · melee crit vs target {fmtPct(p.view.mainHand?.crit.value ?? 0)} · hit chance{" "}
+        {fmtPct(100 - (p.view.mainHand?.miss.value ?? p.view.spell.miss.value))}
+        {p.focusPerSecond !== null ? ` · focus ${fmtDec1(p.focusPerSecond)} per second` : ""}
+      </p>
+      <table className={styles.table} data-testid="pet-breakdown">
+        <caption>Pet damage per second by source</caption>
+        <thead>
+          <tr>
+            <th>Source</th>
+            <th>Per minute</th>
+            <th>DPS</th>
+          </tr>
+        </thead>
+        <tbody>
+          {rows.map((x) => (
+            <tr key={x.key} data-testid={`pet-row-${slug(x.key)}`}>
+              <td>{x.key}</td>
+              <td>{fmtDec2(x.perMinute)}</td>
+              <td>{fmtDec1(x.dps)}</td>
+            </tr>
+          ))}
+        </tbody>
+      </table>
+      <div className={abilityStyles.grid}>
+        {cards.map((a) => (
+          <AbilityCard key={a.key} a={a} perMinute={perMinute.get(a.key) ?? null} />
+        ))}
+      </div>
+      {r.skipped.length > 0 && (
+        <ul className={abilityStyles.unavailable}>
+          {r.skipped.map((s) => (
+            <li key={s.ability}>
+              {s.ability}: {s.reason}
+            </li>
+          ))}
+        </ul>
+      )}
+    </section>
+  );
+}
+
 /** Damage of the default rotation vs the selected target, then one card per ability. */
 export function DamagePanel() {
   const d = useDerived();
@@ -78,7 +148,7 @@ export function DamagePanel() {
         <p className={styles.line}>Loading spells…</p>
       </section>
     );
-  const { rotation, result } = d.damage;
+  const { rotation, result, pet, totalDps, petNotes } = d.damage;
   const r = result.rotation;
   const perMinute = new Map(r.casts.map((c) => [c.key, c.perMinute]));
   const cards: AbilityResult[] = [
@@ -90,7 +160,7 @@ export function DamagePanel() {
       <h2 className={styles.title}>Damage</h2>
       <div className={styles.summary}>
         <span className={styles.dps} data-testid="dps-total">
-          {fmtDec1(r.dps)}
+          {fmtDec1(totalDps)}
         </span>
         <span className={styles.unit}>DPS</span>
         <span className={styles.rotation} data-testid="dps-rotation">
@@ -100,6 +170,11 @@ export function DamagePanel() {
           </span>
         </span>
       </div>
+      {pet && (
+        <p className={styles.line} data-testid="dps-split">
+          You {fmtDec1(r.dps)} · {pet.name} {fmtDec1(pet.rotation.dps)}
+        </p>
+      )}
       <p className={styles.line}>
         {TIER_TEXT[rotation.tier]}. Analytical average; procs and uptimes as expected values.
       </p>
@@ -119,6 +194,12 @@ export function DamagePanel() {
           ))}
         </ul>
       )}
+      {pet && <PetSection p={pet} total={totalDps} />}
+      {petNotes.map((n) => (
+        <p key={n} className={styles.note} data-testid="pet-note">
+          {n}
+        </p>
+      ))}
       {rotation.notes.map((n) => (
         <p key={n} className={styles.note}>
           {n}
diff --git a/src/ui/sim/SimPanel.module.css b/src/ui/sim/SimPanel.module.css
index 4f2baa2..a71ac18 100644
--- a/src/ui/sim/SimPanel.module.css
+++ b/src/ui/sim/SimPanel.module.css
@@ -121,6 +121,12 @@
   font-size: 10px;
 }
 
+.pet {
+  color: var(--gold);
+  font-size: 10px;
+  text-transform: uppercase;
+}
+
 .shareCell {
   white-space: nowrap;
 }
diff --git a/src/ui/sim/SimPanel.tsx b/src/ui/sim/SimPanel.tsx
index 678360e..60567d0 100644
--- a/src/ui/sim/SimPanel.tsx
+++ b/src/ui/sim/SimPanel.tsx
@@ -16,17 +16,18 @@ const LOG_LIMIT = DEFAULT_SIM_CONFIG.logLimit;
 function useSimInput() {
   const tree = useCalc((s) => s.tree);
   const spells = useCalc((s) => s.spells);
+  const pets = useCalc((s) => s.pets);
   const ranks = useCalc((s) => s.ranks);
   const level = useCalc((s) => s.level);
   const ch = useCharacter();
   const custom = useRotation((s) => s.custom);
   const sim = useRotation((s) => s.sim);
-  const { raceId, weaponIds, bonus, buffIds, target, weapons } = ch;
+  const { raceId, weaponIds, bonus, buffIds, target, weapons, pet } = ch;
   const customTarget = ch.custom;
   return useMemo(() => {
     const input = simInputFor(
-      { tree, ranks, level, spells },
-      { raceId, weaponIds, bonus, buffIds, target, custom: customTarget, weapons },
+      { tree, ranks, level, spells, pets },
+      { raceId, weaponIds, bonus, buffIds, target, custom: customTarget, weapons, pet },
       custom,
     );
     const key = JSON.stringify([
@@ -41,11 +42,13 @@ function useSimInput() {
       customTarget,
       custom,
       sim,
+      pet,
     ]);
     return { input, key, sim };
   }, [
     tree,
     spells,
+    pets,
     ranks,
     level,
     raceId,
@@ -55,6 +58,7 @@ function useSimInput() {
     target,
     customTarget,
     weapons,
+    pet,
     custom,
     sim,
   ]);
@@ -116,6 +120,11 @@ function Sources({ r }: { r: SimResult }) {
           return (
             <tr key={s.key} data-testid={`sim-row-${slug(s.key)}`}>
               <td>
+                {s.pet && (
+                  <span className={styles.pet} title="Damage of your pet">
+                    pet{" "}
+                  </span>
+                )}
                 {s.key}
                 {s.averaged && (
                   <span className={styles.avg} title="Expected value from the analytical model">
@@ -245,7 +254,7 @@ export function SimPanel() {
   const s = useSim();
   const running = s.status === "running";
   const r = s.result;
-  const analytical = d.ok && d.damage ? d.damage.result.rotation.dps : null;
+  const analytical = d.ok && d.damage ? d.damage.totalDps : null;
   return (
     <section className={styles.panel} data-testid="sim-panel" aria-labelledby="sim-title">
       <h2 id="sim-title" className={styles.title}>
@@ -287,6 +296,11 @@ export function SimPanel() {
               {fmtDec1(r.dps.mean)}
             </span>
             <span className={styles.unit}>DPS ± {fmtDec1(r.dps.stdev)}</span>
+            {r.pet && (
+              <span className={styles.meta} data-testid="sim-pet-dps">
+                incl. {r.pet.name} {fmtDec1(r.pet.dps.mean)} DPS ·{" "}
+              </span>
+            )}
             <span className={styles.meta} data-testid="sim-ci">
               95% CI {fmtDec1(r.dps.ci95[0])}–{fmtDec1(r.dps.ci95[1])} · min {fmtDec1(r.dps.min)} · max{" "}
               {fmtDec1(r.dps.max)}
diff --git a/src/ui/stats/useDerived.ts b/src/ui/stats/useDerived.ts
index 4196290..770e757 100644
--- a/src/ui/stats/useDerived.ts
+++ b/src/ui/stats/useDerived.ts
@@ -8,6 +8,7 @@ import { derive, type Derived } from "@/state/derived";
 export function useDerived(): Derived {
   const tree = useCalc((s) => s.tree);
   const spells = useCalc((s) => s.spells);
+  const pets = useCalc((s) => s.pets);
   const ranks = useCalc((s) => s.ranks);
   const level = useCalc((s) => s.level);
   const raceId = useCharacter((s) => s.raceId);
@@ -17,14 +18,30 @@ export function useDerived(): Derived {
   const target = useCharacter((s) => s.target);
   const custom = useCharacter((s) => s.custom);
   const weapons = useCharacter((s) => s.weapons);
+  const pet = useCharacter((s) => s.pet);
   const rotation = useRotation((s) => s.custom);
   return useMemo(
     () =>
       derive(
-        { tree, ranks, level, spells },
-        { raceId, weaponIds, bonus, buffIds, target, custom, weapons },
+        { tree, ranks, level, spells, pets },
+        { raceId, weaponIds, bonus, buffIds, target, custom, weapons, pet },
         rotation,
       ),
-    [tree, ranks, level, spells, raceId, weaponIds, bonus, buffIds, target, custom, weapons, rotation],
+    [
+      tree,
+      ranks,
+      level,
+      spells,
+      pets,
+      raceId,
+      weaponIds,
+      bonus,
+      buffIds,
+      target,
+      custom,
+      weapons,
+      pet,
+      rotation,
+    ],
   );
 }
````

## 7. Notes for the implementer

- `src/testkit/damage.ts`'s `runDamage` returns `pet`, `resolved`, `petAbility(key)` and `totalDps`; `DamageScenario`
  and `SimScenario` take `pet: { family?, sacrifice?, scaling? }` by name ("Cat", "Imp").
- Do not change `ENTRY_KINDS`, `PROC_AURAS` or `CONDITION_TYPES`; tag 8 is new and append-only like the others.
- `PET_STREAM` (0x50455431) must stay fixed: changing it changes every simulated pet result.
- The pet panel option labels come from the data ("Cat (+10% damage)"); the e2e test selects by that label.
- If the regenerated `manifest.json` differs from section 5 in anything but `generatedAt`, stop: the raw data differs.

## 8. Tests (all in the diffs; numbers re-derived independently)

### 8.1 Goldens and the independent Python check

Pet goldens (`src/engine/pets/pets.test.ts`, boss: level 63, 3731 armor, DR 40.4182%, factor 0.595818):

| # | Scenario | Values |
|---|---|---|
| P1 | Dwarf hunter, no talents, no weapons (RAP 615 from Aspect of the Hawk + Hunter's Mark), Cat, scaling on | pet AP 252 + 0.22 × 615 = **387.3**; white normal hit (60 + 387.3/14 × 2) × 1.10 × 0.595818 = **75.586378**, per swing (42.9 + 40 × 0.65 + 2.6 × 2)/100 × hit = **56.009506**; table 8 / 6.5 / 40; Claw 51 × 1.1 × 0.5958 = **33.425414**, expected × 0.855 × 1.026 = **29.321776**; Bite **58.986025 / 51.744311**; focus 6/s: Bite 6/min, Claw (360 − 210)/25 = 6/min; pet DPS **36.111362** |
| P2 | Human warlock +300 SP, Improved Imp 3/3, Master Demonologist 5/5, Imp | pet SP 0.15 × 300 = **45**; spell miss 17%; Firebolt (44 + 0.6 × 2 + 0.571 × 45) × 1.3 × 1.1 × 0.94 = **95.297059**, crit **142.945589**, expected × 0.83 × 1.025 = **81.073973**; 30 casts/min → **40.536986** DPS; owner gets "Master Demonologist 5/5" +10% fire |
| G15 | Hammer of Wrath (Part A), Human paladin, Arcanite Reaper, +200 holy | 498 + 0.429 × 200 = **583.8**, crit **1167.6**, land **92** (8% miss, no dodge), crit 2.55%, expected **550.791948** |

`docs/phase6-implementation-plan.md` section 8.1 script (run once in T9 with `python3 -I golden6.py .`; it reads only the
JSON files; output must be the three lines below):

```python
"""Independent check of the Phase 6 goldens: reads the generated/manual JSON, no app code."""
import json, os, sys
root = sys.argv[1]
G = os.path.join(root, "data/generated/1.60.1.70888")
M = os.path.join(root, "data/manual")
pets = {o: json.load(open(f"{G}/pets/{o}.json")) for o in ("hunter", "warlock")}
manual = json.load(open(f"{M}/pets.json"))
sp = lambda o, i: next(s for s in pets[o]["spells"] if s["id"] == i)
DR = 3731 / (3731 + 400 + 85 * 60)                       # boss armor reduction, level 60 attacker
armor = 1 - DR
# P1: Dwarf hunter, no talents, no weapons, Cat, scaling on; owner RAP 615 (Phase 3 stat engine, G11-style)
b = manual["owners"]["hunter"]["base"]
rap = 615
ap = b["apPerStr"] * b["str"] + b["apFlat"] + rap * manual["owners"]["hunter"]["scaling"]["attackPowerPct"] / 100
fam = next(e["base"] for e in sp("hunter", 17210)["effects"] if e["aura"] == 79)   # Cat +10%
swing = ((b["minDamage"] + b["maxDamage"]) / 2 + ap / 14 * b["speedMs"] / 1000) * (1 + fam / 100) * armor
miss, dodge, glance, gm, crit = 8, 6.5, 40, 0.65, b["meleeCrit"] - 0.6 - 1.8     # 300 skill vs 315 defense
white = swing * ((100 - miss - dodge - glance - crit) + glance * gm + crit * 2) / 100
land = 100 - miss - dodge
claw = sp("hunter", 3009)["effects"][0]["base"] * (1 + fam / 100) * armor
bite = sp("hunter", 17261)["effects"][0]["base"] * (1 + fam / 100) * armor
exp = lambda h: h * land / 100 * (1 + crit / 100)
focus = manual["owners"]["hunter"]["focus"]["perSecond"] * 60
bites = 60 / (max(sp("hunter", 17261)["cooldownMs"], sp("hunter", 17261)["categoryCooldownMs"]) / 1000)
claws = (focus - bites * 35) / 25
dps = white / 2 + (bites * exp(bite) + claws * exp(claw)) / 60
print("P1 AP %.4f normalHit %.6f perSwing %.6f claw %.6f/%.6f bite %.6f/%.6f dps %.6f" % (ap, swing, white, claw, exp(claw), bite, exp(bite), dps))
# P2: Human warlock +300 SP, Improved Imp 3/3, Master Demonologist 5/5, Imp
fb = sp("warlock", 11763)
e = fb["effects"][0]
spp = 300 * manual["owners"]["warlock"]["scaling"]["spellPowerPct"] / 100
base = e["base"] + e["perLevel"] * (60 - fb["levels"]["base"])
hit = (base + e["spCoef"] * spp) * 1.30 * 1.10 * (1 - 0.75 * 24 / 300)   # Improved Imp +30%, MD +10% fire, resist 6%
expd = hit * 0.83 * (1 + 0.05 * 0.5)
print("P2 SP %.1f Firebolt hit %.6f crit %.6f expected %.6f dps %.6f" % (spp, hit, hit * 1.5, expd, expd * 30 / 60))
# G15: Hammer of Wrath r3 (paladin, Arcanite Reaper, +200 holy SP): main-hand table, no dodge, holy (no resist/armor)
pal = json.load(open(f"{G}/spells/paladin.json"))
how = next(s for s in pal["spells"] if s["id"] == 24239)["effects"][0]
h = how["base"] + how["spCoef"] * 200
print("G15 HoW hit %.4f crit %.4f expected(crit 2.55) %.6f" % (h, 2 * h, h * 0.92 * (1 + 0.0255)))
```
```
P1 AP 387.3000 normalHit 75.586378 perSwing 56.009506 claw 33.425414/29.321776 bite 58.986025/51.744311 dps 36.111362
P2 SP 45.0 Firebolt hit 95.297059 crit 142.945589 expected 81.073973 dps 40.536986
G15 HoW hit 583.8000 crit 1167.6000 expected(crit 2.55) 550.791948
```
(Do not commit the script; it is reproduced here.) No existing golden changes: G1–G14, C1–C8 and the URL goldens of
Phases 2–5 are unchanged, because no pet is the default and the quick fixes do not touch those builds.

### 8.2 Quick fixes: `src/engine/sim/quickfix.test.ts` (Part A, 6 tests) and G15

- C9 Combat without Blade Flurry/Adrenaline Rush: |sim/analytical − 1| < 3% (prototype −2.4%); default Combat < 5% (+0.4%).
- C10 Assassination without Cold Blood: < 5% (−3.5%).
- Analytical Combat (no bursts): Slice and Dice 21 s, `60/33 < casts/min < 60/21` (prototype 2.03/min), Eviscerate > 1/min (1.47).
- Simulation: Slice and Dice > 5 casts per fight (5.6; Phase 5: 3.6).
- Retribution maxed: Hammer of Wrath cast > 3 times in one fight, first cast ≥ 144 s (80% of 180 s).
- Shadow + Power Infusion talent: log `[0, cast], [0, buff], [15, fade]`; DPS > 1.01 × without the talent.

### 8.3 Pets in the simulator: `src/engine/sim/pets.test.ts` (6 tests)

- Cross-check pet DPS (sim vs analytical) < 3%, no bursts: P-C1 hunter Cat no talents (36.2 / 36.4), P-C2 Demonology
  + Imp (71.5 / 70.8), P-C3 Demonology + Succubus (40.8 / 40.9); pet sources start with "<pet>: ".
- Determinism: same seed → identical result; the player's sources are identical with and without the pet; total =
  player + pet; `pet` null without a pet.
- Focus pooling: Cat Bite 12 < casts ≤ 18 per fight (13; strictPriority waits for Bite only when it is ready), Claw > 20.
- BM talents: log has "Cat: Bestial Wrath" buff and "Cat: Frenzy" buff; `modeled` contains "Frenzy 5/5: Frenzy on 100% of melee crits".

### 8.4 State: `src/state/pets.test.ts` (4 tests) and the Python URL encoder

- Goldens: Cat → `#v2.hunter.60.0..CAMCAAA`; Succubus + Imp sacrificed + scaling off → `#v2.warlock.60.0..CAMRFwE`;
  sim 300 s × 2000 seed 42 mana on + Wind Serpent → `#v2.hunter.60.0..BwasAtAPKgAIAxsAAA`; decode back to the same build.
- `NO_PET` writes no record (v1 link stays `#v1.hunter.60.0`); flag > 1 or a record of 2 varints → null; a later unknown tag 9 is still skipped.
- `applyPet`: keeps a hunter Cat; drops an Imp on a hunter (returns false); warlock Succubus + Imp sacrifice kept.
- `derive` (hunter, custom target, 5 reference rows): total = owner + pet; every reference row higher with the Cat; the
  custom row equals the total; `simInputFor` carries `pet` and `prepare.petActive`.

Independent encoder (run once in T9; prints the three goldens):
```python
import base64
def varint(v):
    out = []
    while v >= 0x80:
        out.append(v & 0x7F | 0x80); v >>= 7
    return out + [v]
def record(tag, values):
    body = [b for v in values for b in varint(v)]
    return varint(tag) + varint(len(body)) + body
b64 = lambda bs: base64.urlsafe_b64encode(bytes(bs)).decode().rstrip("=")
print("#v2.hunter.60.0.." + b64(record(8, [2, 0, 0])))
print("#v2.warlock.60.0.." + b64(record(8, [17, 23, 1])))
print("#v2.hunter.60.0.." + b64(record(7, [300, 2000, 42, 0]) + record(8, [27, 0, 0])))
```

### 8.5 Engine unit tests: `src/engine/pets/pets.test.ts` (8 tests)

Pet files (19 hunter families, 5 demons, mage null); P1; P2; BM talents (damage done "Unleashed Fury 5/5" 15, "Cat
(family)" 10, "Focused Fire 2/2" 2; crit 15; focus 7.2/s; Frenzy effect label "Frenzy 5/5: Frenzy" > 10% haste; Bestial
Wrath skipped "cooldown buff: simulation only"); Lone Wolf off with a pet (reason "inactive"); Demonic Sacrifice rules
(talent, cancel, Pact, Felhunter note); Soul Link + Demonic Knowledge on both (3% and 60 SP); scaling off (AP 252),
Wind Serpent rotation `[Bite cooldown, Lightning Breath filler]`, Raptor `[Savage Rend, Bite, Claw]`.

### 8.6 Pipeline: `tools/pipeline/tests/test_phase6.py` (3 tests)

Owners and families (hunter 19, warlock `[Felhunter, Voidwalker, Succubus, Imp, Incubus]`, exotic `[312]`, skipped
`{Doomguard, Remote Control, Felguard}`, manifest counts); Cat abilities/passives (Claw 3009 = 51, Bite 17261, family
17210 = aura 79 +10, Frenzy 19615 = 319 +30, 8 s); demons (Firebolt 11763 = 44 / 0.6 / 0.571 / 2 s / set 5, auras
18789/18791/23759/23761/25228 schools, Burning Shadow 15). `test_phase3.py`/`test_phase4.py`: `pipelineVersion` 4.

### 8.7 Performance (budgets unchanged)

`src/state/perf.test.ts` adds BM hunter + Cat and Demonology + Succubus: prototype 3.5 ms and 1.6 ms per derive (budget
5 ms; the pet adds ~0.13 ms per target evaluation; `petBook` is memoized). `src/engine/sim/perf.test.ts` adds BM + Cat:
0.44 s per 1000 × 180 s (budget 2 s).

### 8.8 Playwright: `e2e/pets.spec.ts` (3 desktop tests)

1. Hunter: no pet section in Damage; pick "Cat (+10% damage)" → `pet-damage`, `pet-row-melee`, total rises, `dps-split`
   contains "Cat"; URL `#v2.hunter.60.0..CAMCAAA`; reload → select value 2; uncheck scaling → `..CAMCAAE`; None + check →
   `#v1.hunter.60.0`.
2. Warlock: `pet-sacrifice` disabled; Demonic Embrace 5, Unholy Power 5, Demonic Sacrifice 1 → enabled; sacrifice Imp →
   total rises; pick Succubus → `pet-note` "cancels Demonic Sacrifice", `pet-damage` visible.
3. Open `#v2.hunter.60.0..CAMCAAA`, run 100 iterations → `sim-pet-dps` contains "Cat", rows `sim-row-cat-melee`, `sim-row-cat-claw`.

## 9. Expected divergences: simulation vs analytical (every default rotation, with pets)

Same setup as Phase 5 section 9 (every spec's talents maxed, +300 spell power, the Phase 4 test weapons, boss, unlimited
mana, 1000 × 180 s). "Total" includes the pet. Rows not listed are identical to Phase 5.

| Rotation | Analytical total | Simulation | Delta | Pet A / S | Why |
|---|---|---|---|---|---|
| paladin-retribution | 137.8 | 162.3 ± 10.7 | +17.8% | – | Hammer of Wrath in the execute phase (L9, simulation only) |
| hunter-beast-mastery + Cat | 238.8 | 231.7 ± 6.2 | −3.0% | 55.5 / 62.2 | Auto Shot reset (Q63) −; Bestial Wrath (pet burst, +12% pet) + |
| hunter-beast-mastery + Wind Serpent | 237.9 | 230.5 ± 6.1 | −3.1% | 54.6 / 61.0 | same |
| hunter-marksmanship + Cat | 273.9 | 251.7 ± 9.1 | −8.1% | 36.7 / 36.9 | Lone Wolf turns off with a pet (MM without pet: 284.6) |
| hunter-survival + Cat | 225.9 | 210.8 ± 4.2 | −6.7% | 38.0 / 38.2 | Auto Shot reset |
| rogue-assassination | 94.9 | 92.7 ± 6.4 | −2.3% | – | L8 (Phase 5: 90.2, +2.8%) |
| rogue-combat | 134.4 | 134.9 ± 7.2 | +0.4% | – | L8 (Phase 5: 123.1 / 141.8, +15.2%) |
| warlock-affliction + Succubus | 278.5 | 275.0 ± 8.5 | −1.3% | 32.9 / 32.9 | — |
| warlock-demonology + Imp | 288.0 | 288.6 ± 10.7 | +0.2% | 71.5 / 70.8 | Master Demonologist +10% fire, Soul Link, Demonic Knowledge |
| warlock-demonology + Succubus | 279.0 | 280.5 ± 11.3 | +0.5% | 40.8 / 40.9 | — |
| warlock-demonology + Felhunter / Voidwalker | 247.9 | 249.1 ± 10.4 | +0.5% | 31.3 / 31.3 | melee only |
| warlock-destruction + Imp | 302.7 | 301.8 ± 13.9 | −0.3% | 28.3 / 28.1 | — |

Rules of thumb (CALC_MODEL section 6): pet DPS agrees within ~1% except Bestial Wrath (simulation only, +10–12% pet DPS
in a 180 s fight). Demonology without a pet is 191.9; Demonic Sacrifice of the Imp (+15% shadow) gives 220.7, an active
Imp 288.0 (Forever's Master Demonologist, Soul Link and Demonic Knowledge favor an active demon).

## 10. Ordered task list

Commit after each task (attribution lines per the session reminder). Keep `npm run format:check`, `npm run lint`,
`npm test`, `npm run typecheck` green from T2 on, except where noted.

| Task | Work | Acceptance check |
|---|---|---|
| T1 | Read this document | — |
| T2 | **Part A** (section 3): `git apply` diff A (L8 analytical + sim pooling, L9 `weaponlessRanged`, L10 `selfApplied`, Retribution/Shadow defaults, G15, `quickfix.test.ts`) | typecheck, lint, format; `npm test` **268** green (261 + G15 + 6) |
| T3 | Part A docs: KNOWN_LIMITS L8/L9/L10 → ✅ "quick fix (pre-Phase 6)"; OPEN_QUESTIONS Q66/Q67 notes (section 11); CALC_MODEL section 6 Combat row | docs only |
| T4 | **B1** (pipeline + manual pets.json), then regenerate: `python3 tools/pipeline/build_data.py --build 1.60.1.70888 --date 2026-11-13` (exactly this date) | pipeline tests **53** OK; `git status data/generated` = `manifest.json`, `report.json` modified (section 5 expected diff) and new `pets/hunter.json` (≈146 KB), `pets/warlock.json` (≈93 KB); no other generated file changes |
| T5 | **B2** (data types, loaders) and **B3** (stats/rotation/talents hooks) | typecheck |
| T6 | **B4** (`src/engine/pets/`, incl. `pets.test.ts`) and **B5** (simulator) | typecheck fails only on `@/testkit/pets` until T7 |
| T7 | **B8** (testkit + `e2e/pets.spec.ts`) | typecheck; `npm test` green |
| T8 | **B6** (rotation notes, state, `src/state/pets.test.ts`, perf tests) and **B7** (UI) | typecheck, lint, format; `npm test` **287** green; `npm run build` shows `pets/hunter`/`warlock` chunks |
| T9 | Run the two Python scripts of section 8 once | outputs equal section 8.1 / 8.4 |
| T10 | `npm run e2e` (no `playwright install`) | **31** green (desktop + mobile) |
| T11 | Manual check: hunter, Beast Mastery points, pick Cat → Damage panel shows "Pet: Cat"; Sim panel shows pet rows | — |
| T12 | Docs (section 11); screenshot `docs/screenshots/phase6-pets.png` (desktop, BM hunter with Rhok'delar, Cat, sim of 300 iterations visible) | docs updated in the same commit as the last change or a final docs commit |

## 11. Documentation updates (tasks T3, T12)

- **KNOWN_LIMITS.md**: L8 ✅ "Quick fix (pre-Phase 6): buff finishers refreshed half a finisher cycle late; the sim keeps
  combo points for a finisher waiting for energy. Combat +0.4%, Assassination −2.3%"; L9 ✅ "Quick fix: ranged-type spells
  without weapon damage or equip requirement need no ranged weapon; Hammer of Wrath in the Retribution default (execute)";
  L10 ✅ "Quick fix: ally-target (21) auras apply when self-cast; Power Infusion in the Shadow default"; L19 ✅ "Phase 6".
  Add rows: **L22** (Pets) "Other summons not modeled: Searing/Magma Totem, Shadowfiend, Summon Hawk's 18 s assault,
  Inferno, Doomguard; Felguard has no summon spell in Forever" ⬜; **L23** "Pet base stats, focus regeneration and owner
  scaling are Classic/TBC values (Q5, Q69–Q71)" ⬜; **L24** "Pets get no raid buffs or consumables; pet mana is
  unlimited; pet buffs to the owner (Furious Howl, Blood Pact) and Intimidation are not applied; pet abilities have no
  attack power scaling (Q72)" ⬜; **L25** (Damage engine) "Analytical buff finishers keep 100% aura uptime although their
  casts include the refresh gap (Combat Slice and Dice ~70% uptime); within 3%" ⬜.
- **PLAN.md**: Phase 6 → ✅; checkboxes: "Quick fixes L8–L10 (energy finishers, Hammer of Wrath, Power Infusion)";
  "Hunter pets: 19 families from the data (family passives, BM talents through pet passives: Unleashed Fury, Ferocity,
  Frenzy, Bestial Discipline, Focused Fire, Bestial Wrath), focus model"; "Warlock demons: Imp, Voidwalker, Succubus,
  Incubus, Felhunter; Master Demonologist, Soul Link, Demonic Knowledge, Demonic Sacrifice + Demonic Pact; Felguard/
  Doomguard not summonable"; "Other summons listed as not modeled (KNOWN_LIMITS L22)"; "Pet damage in the total DPS,
  breakdown, reference table and simulator (pet as its own actor); owner scaling toggle (Q5); URL tag 8". Output line:
  "pipeline v4 (`pets/<owner>.json`), `src/engine/pets`, `src/engine/sim/petModel.ts`, Pet panel, URL tag 8. 53 pipeline
  tests, 287 Vitest tests, 31 Playwright tests. Open items: Q69–Q75."
- **CALC_MODEL.md** section 5: replace the table and paragraph with section 4.3 (stats via `computeCharacter`, owner scaling
  coefficients and the toggle, outcome tables, pet rotation rule, focus, Frenzy uptime, owner effects, sacrifice rules,
  Lone Wolf) and the `[VERIFY]` numbers of `pets.json`. Section 6: analytical paragraph add the L8 refresh rule; simulation
  bullets add "finisher pooling (L8)", "pets: own actor, own RNG stream, strict priority (focus pooling), Frenzy/Bestial
  Wrath sampled"; replace the divergence paragraph with section 9 (Combat now +0.4%, Ret +17.8% from Hammer of Wrath).
- **ARCHITECTURE.md**: generated-data table row `pets/<owner>.json` (section 4.2); manual data: `pets.json` structure;
  "Phase 6: pets" subsection with section 4.1 and the import direction; URL: tag 8 with the three goldens; layout tree
  `src/engine/pets/` is no longer a placeholder.
- **DATA_SOURCES.md** "Pets": replace with the section 1 facts (skill lines, family passives, talent → passive masks,
  scaling auras, owner detection, skipped families, sacrifice/Master Demonologist auras chosen by server script → manual).
- **OPEN_QUESTIONS.md**: Q5 → 🔬 "Phase 6: scaling auras 415429/416189 exist in every pet skill line (values server-side);
  default on with TBC coefficients, toggle"; Q66 → 🔬 "Phase 6: ranged table if a ranged weapon, else main-hand table,
  no dodge, physical crit bonus"; Q67 → ✅ "self-cast applies target-21 auras (L10)"; add Q69–Q75 (section 12).
- **README.md**: mention the Pet panel (hunters and warlocks: pet, Demonic Sacrifice, scaling toggle; pet damage in the
  Damage and Simulation panels; the pet is part of the shareable link).
- **CLAUDE.md** conventions: add "Pets come from `data/generated/<build>/pets/<owner>.json` (pipeline v4) and
  `data/manual/pets.json` ([VERIFY] base stats/scaling); the pet engine (`src/engine/pets`) reuses `computeCharacter`,
  `evaluateTarget`, `evaluateAbility` and `runRotation`; in the simulator a pet is a `FightModel` run by the same `Fight`
  with its own RNG stream; URL tag 8 (`PetChoice`)". Change "pipeline v3" to "pipeline v4".

## 12. Remaining uncertainties (add as Q69–Q75 to OPEN_QUESTIONS.md, status ❓)

| # | Question | Why it matters | How to resolve |
|---|---|---|---|
| Q69 | Pet base stats at 60 (Str 136, AP = 2 Str − 20, 45–75 damage per 2.0 s, 5% crit) for hunter pets and demons; do families or demons differ (Voidwalker lower damage, creature-specific attack speeds: "Faster Attack I–VII" spells exist in Pet - Generic)? | Every pet number | Pet character sheet / tooltips, swing timer |
| Q70 | Owner scaling: TBC 22%/12.8% (hunter RAP), 57%/15% (warlock spell power) and hit inheritance? Does Forever's scaling aura also pass the owner's crit and haste (auras 52/57/319/65 present)? | Pet DPS ±30% | Pet AP/SP at two owner gear levels; pet crit with/without owner crit gear |
| Q71 | Focus regeneration 6/s (24 per 4 s?), max 100; does the pet AI pool for Bite (the simulator pools for a ready higher entry) or spam Claw? | Hunter pet DPS ~5% | Focus bar over time; pet combat log |
| Q72 | Pet abilities have no AP coefficient in the data (Claw 51, Bite 90 flat): server-side AP scaling (WotLK 7%)? | Claw/Bite damage | Claw hits at two pet AP values |
| Q73 | Which Demonic Sacrifice buff belongs to which demon (Burning Shadow 18789 for the Imp, Touch of Fire 18791 for Succubus/Incubus, from the talent text), and does Demonic Pact keep it with a different demon summoned? | Sacrifice builds | Sacrifice each demon, read the buff |
| Q74 | Pets vs a boss: 8% miss / 6.5% dodge / 40% glancing at 65% / crit suppression like players; pet spells 17% miss and 6% resist; attacking from behind (no parry) | Pet hit/crit | Pet combat log vs a boss dummy |
| Q75 | Hammer of Wrath / Summon Hawk on the main-hand table: crit chance and crit bonus (physical 200% assumed), and is Hammer of Wrath on a 1 s cast in Forever (talents make it 0)? | Ret execute, hawk | Combat log |

Also still relevant: Q5 (pet scaling, now 🔬), Q63 (Auto Shot reset dominates the hunter sim), Q66, Q47/Q50 (pet spell
ticks/resists like the player's).
