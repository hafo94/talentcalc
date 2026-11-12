# Phase 4 implementation plan: Damage engine (analytical)

Audience: the agent that implements Phase 4. Follow this document literally. When it says "exactly", copy the value or
code. When something here contradicts an older doc, this document wins for Phase 4, and task T12 updates the older doc.

Everything below was checked against `data/generated/1.60.1.70888/` and `data/raw/1.60.1.70888/` on 2026-11-12. The
pipeline change (section 2), the manual rotations (section 3), the data contracts (section 4), the stat-engine changes
(section 5), the whole damage engine (sections 6-7), the state layer (section 8), the UI (section 9) and every test of
section 10 were implemented as a prototype in a scratch copy of the repo. Results: `python3 -m unittest` 50 tests OK,
`tsc` clean, `vitest run` 220 tests (147 existing + 73 new) OK, `eslint .` clean, `prettier --check src` clean,
`vite build` OK, Playwright 24 tests (21 existing + 3 new) OK on desktop and mobile. **The code blocks in this document
are that prototype; copy them.** Files marked "(diff)" are unified diffs against the current `main` of the branch;
apply them exactly (they are small). Everything else is a complete file.

---

## 0. Key decisions (summary)

| Topic | Decision |
|---|---|
| Spell data in the app | **Pipeline v3** writes `data/generated/<build>/spells/<class>.json` (the class's records of `spells.json` plus its ability chains), one lazy chunk per class (17-29 KB gzip), loaded together with the talent file. `spells.json` stays unchanged for tools and tests. |
| Seal judgements | Judgement damage spells are not `EffectTriggerSpell`s: a Seal stores its judgement in a DUMMY effect's base points (Seal of Command r5 20920 -> 20968 -> 20966, 356 Holy, coef 0.429). The pipeline follows DUMMY base points from spells named "Seal of"/"Judgement of" **only** when the target is named "Judgement of ..." (Seal of Fury's DUMMY base 707 would otherwise pull in Immolate). +40 spells (2,300 -> 2,340). |
| Outcome tables | Reuse Phase 3 `TargetView` (miss/dodge/glancing/crit per slot, spell miss/crit, armor DR, resistances, damage taken). New pure helpers in `src/engine/combat`: two-roll special (melee: miss+dodge, ranged: miss only `[VERIFY Q49]`), white single roll (glancing at the vmangos average, 65% vs boss), spell (miss, then crit; resist as an average factor). Binary spells are not special-cased: their expected damage is identical (resist chance = average resist), only proc counts would differ (Phase 5). |
| Crit damage | Spells 150%, melee and ranged attacks (incl. Arcane Shot, Holy Strike, Seal of Command) 200%. SpellModOp 15 multiplies the crit **bonus** (Ice Shards +100% -> 200%, Impale +20% -> 220%). |
| Periodic damage | `EffectBonusCoefficient` of a periodic effect is **per tick** (Immolate 0.13 x 5 ticks = 0.65, the Classic total). **Ticks can crit** with the spell's crit chance (Forever runs the modern engine; Pandemic and Shadowform raise the crit damage of DoTs and Mind Flay), except spells with `SPELL_ATTR2_CANT_CRIT` `[VERIFY Q47]`. A DoT recast before it expires is clipped: damage per minute = min(casts, 60 / duration) x full DoT. |
| Weapon specials | Effects 17 / 58 (weapon damage + points), 121 (normalized weapon damage + points), 31 (x points %) are applied **in effect index order** like the modern server (`Spell::EffectWeaponDmg`): Backstab (121 +150, then 31 150%) = 1.5 W + 225 = Classic; Mutilate tooltip `${m1*m2/100}` confirms it `[VERIFY Q48 for Holy Strike/Counterattack]`. Normalized speeds 1.7 dagger / 2.4 one-hand / 3.3 two-hand / 2.8 ranged / 1.0 Cat Form. Off-hand strikes use the Phase 3 off-hand factor (0.5 x off-hand %). `spCoef` is applied only when the spell school is not physical (every physical effect has the client default 1.0; Holy Strike 0.429 and Seal of Command 0.29 are real). |
| Spell modifiers | Aura 107/108 by family mask (same `SpellClassSet`). Ops used: 0 direct damage, 1 duration, 3/12/23 value of effect 0/1/2, 7 crit, 8 all values, 10 cast time, 11 cooldown (own and category), 14 cost (rage values in tenths), 15 crit damage bonus, 16 hit, 22 periodic damage. Others (threat, range, radius, pushback, proc chance ...) do not change damage. Percent mods multiply (modern engine) `[VERIFY Q52]`. |
| Damage done | Aura 79 by school (`stats.damageDone`); an aura 79 from a weapon-restricted talent now carries `slots` and only affects attacks of those slots (Wand Specialization no longer boosts every spell; Paladin Two-Handed Weapon Specialization still boosts Judgement). |
| Scripted spells | `SCRIPTS` keyed by ability name: Bloodthirst (45% AP from its DUMMY effect), Eviscerate / Ferocious Bite / Rip (AP per combo point, TBC values `[VERIFY Q53]`), Slice and Dice duration, Shank (off hand), Arcane Wrath (+5% max mana as SP), Incinerate (+25% with Immolate), Judgement (judges the rotation's seal), Mutilate (triggered MH/OH strikes), Forever Whirlwind (both weapons). |
| Talent handlers | 22 hand-written handlers in `src/engine/talents/special/` keyed by talent spell id, with three hooks (stats, per-ability, rotation uptime). List in section 7.2. Every other DUMMY/proc talent stays in "Talents not modeled yet". |
| Rotations | `data/manual/rotations.json`: 27 rotations (one per spec) as priority lists. **Tier 1** (fully modeled, golden or regression tested): Arms, Fury, Retribution, Marksmanship, Combat, Shadow, Elemental, Fire, Frost, Destruction, Balance. **Tier 2** (generic model, handlers missing for spec mechanics): Beast Mastery, Survival, Assassination, Subtlety, Enhancement, Arcane, Affliction, Demonology, Feral (cat). **Tier 3** (tank/healer, basic damage rotation): Protection warrior/paladin, Holy paladin, Discipline, Holy priest, Restoration shaman/druid. |
| Rotation choice | The spec with the most points; ties and no points -> the first spec with role "dps". **Not user-editable in Phase 4; no URL change.** The editor (and its URL record) is Phase 5. |
| Analytical model | Per minute, entries in priority order take `min(cooldown/duration cap, time left / time per cast, resource left / cost)` casts (finishers bought as cycles with their builder casts; resource generators such as Shank first; on-next-swing attacks use the leftover resource and replace main-hand swings). Rage from white damage (Classic `7.5 x dmg / c(L)`), energy 10/s, **mana never limits** (mana/s and time to OOM are reported). Two passes: pass 1 gives casts and crits per minute, talent handlers turn them into uptimes (Flurry, Improved Shadow Bolt, Deep Wounds, extra rage ...), pass 2 recomputes. |
| Self-buffs | Rotation `selfBuffs` (Shadowform, Aspect of the Hawk, Hunter's Mark, Seal of Command, Windfury Weapon) and `buff: true` entries (Slice and Dice) apply their caster auras to the character (100% uptime) through the Phase 3 `mapAura`; they show in the Stats panel with kind `buff`. Forms (cat, moonkin) activate form-only talents (`shapeshiftMask`). |
| UI | New full-width **Damage** panel under Character/Stats (mobile: 4th tab "Damage"): total DPS, rotation label + tier badge, resource line, DPS breakdown table, one card per ability (avg hit with range, crit, ticks, expected per cast, per second of cast time, hit/crit chance, timing, cooldown, cost, casts/min, "modified by" list), skipped abilities with reasons, rotation notes. Stat strip shows DPS. The reference table's DPS column (Phase 3 hook) is filled for every reference target. |
| Performance | `derive` (stats + 5 targets x 2 passes) measured at 0.8-1.1 ms per call in Vitest/Node with a fully talented spec and raid buffs; test asserts < 5 ms. |
| Q2 | All spell base points are Forever data, not Classic: Fireball r12 483 (Classic 678 avg), Shadow Bolt r10 268 (510), Frostbolt r11 475 (535), Lightning Bolt r10 353 (452), Starfire r7 533 (588). The engine uses the data and the golden tests say so. |

---

## 1. Verified data facts (what the code may rely on)

### 1.1 How `spells.json` represents abilities

| Field | Meaning (70888) | Example |
|---|---|---|
| `abilities[]` | rank chains per (class, name), sorted by learn level. A talent-granted ability's chain **starts at rank 2**; rank 1 is the talent spell (`Talent.spellId`) | Mortal Strike chain 21551/21552/21553 (r2-4), rank 1 = talent 12294 (level 40) |
| `levels.base` | learn level; rank selection = highest `levels.base <= level` | Fireball r11 10151 and r12 25306 are both level 60 -> r12 |
| `effects[].base`, `perLevel`, `levels.max` | value at level L = base + perLevel x (min(L, max or L) - base level) | Mind Blast r9 (58): 485 + 2.6 x 2 = 490.2; Lightning Bolt r10 (56, max 61): 353 + 2.1 x 4 = 361.4 |
| `variance` | range = base x (1 +- variance/2) | Fireball r12 483 +- 12.1% |
| `school` | SpellSchoolMask; multi-school: Frostfire Bolt 20 (fire+frost) | |
| `defenseType` | 1 magic (spell table), 2 melee, 3 ranged; 0 none | Heroic Strike 2, Aimed Shot 3, Arcane Shot 3 (arcane, ranged table) |
| `castMs` | ms; **-1000000** on instant hunter shots (Arcane Shot, Serpent Sting, Concussive ...) = instant | |
| `gcdMs` | 1500 spells/warrior, 1000 rogue/cat abilities, 0 = off the GCD (Heroic Strike, Cleave, Raptor Strike, Judgement) | |
| `cooldownMs`, `categoryCooldownMs`, `category` | category cooldowns are shared: Aimed Shot and Multi-Shot (category 2, 6 s), Arcane Shot and Summon Hawk (1173, 6 s), Flame Shock (19, 6 s), Holy Strike (2404, 10 s), Bloodthirst (971, 6 s), Fire Blast (8 s) | |
| `costs[]` | powerType 0 mana, 1 rage (**already / 10**), 3 energy, 4 combo points (finishers: amount 1, optional 4); `pct` = % of **base mana** (`base-stats.json` `mana`) | Arcane Blast 15%, Multi-Shot 13.9%, Judgement 6%, Hammer of the Righteous 6% |
| `duration.ms`, `effects[].periodMs` | DoT ticks = duration / period | Corruption 18000/3000 = 6 |
| `channeled` | channel time = duration | Mind Flay 3 s, Arcane Missiles 5 s, Drain Life 5 s |
| `family` | `{set, mask}`; talent masks match `mask` of spells with the same `set` (the class `spellClassSet`) | Triggered spells have their own masks (Arcane Missiles missile 25346, Seal of Command proc 20424, Judgement of Command 20966) |
| `attributes[2] & 0x20000000` | SPELL_ATTR2_CANT_CRIT (39 spells: Lightning Shield, Shadowguard, Seal of Light ...) | |
| `mechanic` 15 / `effects[].mechanic` 15 | bleed: ignores armor (Rend, Garrote, Rip, Rake DoT) | |
| `proc.typeMask[0]` | Seal of Command aura 42: 4 = melee auto attacks only | |
| `apCoef` | **never set** (BonusCoefficientFromAP is 0 everywhere): AP scaling of finishers is server-side | |
| `spCoef` | 1.0 on every physical effect (client default) | Heroic Strike, Sinister Strike, Bloodthirst |

### 1.2 Effect enum (class abilities, counts over `sources` "ability")

| Effect | Count | Semantics used | Examples |
|---|---|---|---|
| 2 SCHOOL_DAMAGE | 343 | direct damage (+ spCoef x SP for magic schools, + pointsPerCombo x cp) | Frostbolt, Bloodthirst (physical), Eviscerate |
| 6 + aura 3 PERIODIC_DAMAGE | 174 | DoT ticks | Corruption, Fireball DoT, Rend |
| 6 + aura 53 PERIODIC_LEECH | - | same as 3 | Drain Life, Siphon Life, Devouring Plague |
| 6 + aura 23 PERIODIC_TRIGGER_SPELL | - | channel: each tick casts the triggered spell (direct damage, own crit) | Arcane Missiles -> 25346 (209, 0.286) |
| 6 + aura 226 PERIODIC_DUMMY | 36 | server-side ticks; triggered spell mostly absent (Blizzard -> 1279949 is not exported): **not modeled** | Blizzard, Volley, Consecration, Hurricane |
| 3 DUMMY | 159 | server script; used only by `SCRIPTS` (Bloodthirst AP%, Arcane Wrath, Incinerate) | |
| 17 WEAPON_DAMAGE_NOSCHOOL | - | weapon + points (not normalized) | Heroic Strike +157, Cleave, Slam |
| 58 WEAPON_DAMAGE | 33 | weapon + points (not normalized) | Auto Shot, Raptor Strike, Shred, Claw |
| 121 NORMALIZED_WEAPON_DMG | 63 | normalized weapon + points | Sinister Strike +68, Mortal Strike +160, Aimed Shot +350, Holy Strike +93 |
| 31 WEAPON_PERCENT_DAMAGE | 53 | x points % (sequence) | Backstab 150, Shred 200, Mutilate 90, Holy Strike 50 |
| 30 ENERGIZE | 78 | misc[0] 4 = combo points, 3 = energy (Shank +25) | |
| 64 TRIGGER_SPELL | 32 | Mutilate: two weapon strikes (MH, OH) | |
| 77 SCRIPT_EFFECT | 42 | Judgement (judges the seal) | |
| 360 (enchant) | - | Windfury Weapon; values from its tooltip | |

### 1.3 SpellModOp (aura 107/108 `misc[0]`), from all 447 talents

| Op | Meaning | Evidence (talent, value) |
|---|---|---|
| 0 | direct damage (not periodic) | Improved Cone of Cold 35, Aggression 15, Arcane Power 30 |
| 1 | duration (ms / %) | Improved Shadow Word: Pain +6000, Improved Slice and Dice 45 |
| 3 / 12 / 23 | value of effect index 0 / 1 / 2 | Permafrost -10 (slow), Flash of Steel 15 (Shank energy, effect 1) |
| 7 | crit chance (flat %) | Critical Mass 6, Incineration 10, Improved Overpower 50 |
| 8 | all effect values | Clever Traps 30 |
| 10 | cast time (ms / %) | Accelerant -500, Presence of Mind -100% |
| 11 | cooldown (ms / %) | Improved Whirlwind -2000, Improved Arcane Shot -1500 (category cooldown) |
| 14 | cost (raw units: rage x10; %) | Improved Heroic Strike -30 (= 3 rage), Efficient Strikes -5 energy, Convection -10% |
| 15 | crit damage bonus % | Ice Shards 100, Impale 20, Mortal Shots 30, Shadowform 100, Pandemic 100 |
| 16 | hit chance | Divine Precision 8 |
| 22 | periodic damage | Improved Rend 35, Improved Corruption 10, Arcane Instability 3 (Fireball/Pyroblast DoT parts) |
| 2, 4, 5, 6, 9, 18, 27, 28, 32, 38 | threat, charges, range, radius, pushback, proc chance, ... | ignored |

Arcane Instability has op 0 for all spells **and** op 22 for the spells with a DoT part, which confirms the modern split:
op 0 does not touch periodic damage.

### 1.4 Forever-specific findings that shape the rotations

- New or changed abilities: Shank (rogue, OH 50% weapon, +25 energy, 10 s), Holy Strike (paladin core strike, 50% weapon + 93 Holy, coef 0.429, category 10 s), Arcane Wrath (mage talent, +5% max mana as SP, 6 s), Sniper Shot (hunter talent, 4 s cast, +590), Summon Hawk (pet-like, shares Arcane Shot's cooldown), Bane of Agony/Doom (warlock "curses"), Incinerate (warlock 31-pt talent), Seal of Fury, Hammer of the Righteous (shares Holy Strike's category), Windfury Weapon (20%: **2** extra attacks with 333 AP), Lightning Overload, Mutilate (triggered 1241586/1241590: (W + 88) x 90% each).
- Multi-Shot has a single rank (2643, 13.9% base mana, +0). Whirlwind hits with both weapons (tooltip). Victory Rush and Execute need a kill/execute phase (Phase 5).
- Rogue poisons are item enchants: no poison spells in the data (Vile Poisons masks match nothing). Not modeled.
- Aura **598** = attack power from a stat % (Mental Dexterity 150% Int, Careful Aim 100% Int), aura **580** = ranged attack power from a stat % (Careful Aim). Phase 3 listed them as unsupported; Phase 4 maps them.
- Fire Vulnerability (22959): aura 270, 3% per stack, 5 stacks. Shadow Weaving (15258): aura 270, 2% x 5. Handlers read these values from the data.
- Q2 (spell base points): see section 0. The engine uses the data; the goldens document it.

---

## 2. Pipeline (task T1)

Pipeline version 2 -> 3. Two changes, both deterministic; all other generated files stay byte-identical (checked with
`cmp`): `spells.json` gains 40 judgement spells (2,300 -> 2,340), `manifest.json` changes `pipelineVersion` and the
spell count, and `spells/<class>.json` is new (9 files).

`tools/pipeline/constants.py` (diff):

```diff
--- a/tools/pipeline/constants.py
+++ b/tools/pipeline/constants.py
@@ -3,7 +3,7 @@
 
 BUILD_DEFAULT = "1.60.1.70888"
 ERA_BUILD_DEFAULT = "1.15.9.70576"
-PIPELINE_VERSION = 2
+PIPELINE_VERSION = 3
 
 # (ChrClasses.ID, token, TraitTreeID, ClassMask). Verified against SkillLineXTraitTree + SkillLineAbility.
 CLASS_TREES = [
@@ -59,6 +59,13 @@
 ATTR0_PASSIVE = 0x40
 ATTR1_CHANNELED = 0x44  # SPELL_ATTR1_CHANNELED_1 (0x4) | _2 (0x40)  [VERIFY]
 AURA_OVERRIDE_ACTIONBAR = 332
+# Phase 4: a Seal's judgement is not an EffectTriggerSpell; the seal (and the "Judgement of X" dummy spell) store the spell id
+# in the base points of a DUMMY effect (Effect 3, or Effect 6 + Aura 4). Follow those ids only when the target spell is named
+# "Judgement of ..." (other DUMMY base points are plain numbers that can collide with spell ids, e.g. Seal of Fury -> 707).
+EFFECT_DUMMY = 3
+AURA_DUMMY = 4
+JUDGEMENT_PARENT_PREFIXES = ("Seal of ", "Judgement of ")
+JUDGEMENT_CHILD_PREFIX = "Judgement of "
 
 # ---- Coverage classification (modern aura enum; names uncertain tagged [VERIFY]) ----
 APPLY_AURA_EFFECTS = {6, 35, 65, 119, 128, 129, 143}
```

`tools/pipeline/spells.py` (diff):

```diff
--- a/tools/pipeline/spells.py
+++ b/tools/pipeline/spells.py
@@ -35,6 +35,10 @@
     return out
 
 
+def _is_dummy(e):
+    return I(e["Effect"]) == C.EFFECT_DUMMY or (I(e["Effect"]) == 6 and I(e["EffectAura"]) == C.AURA_DUMMY)
+
+
 def collect_spells(db, talent_spell_class, report):
     """talent_spell_class: spellId -> classId. Returns dict spellId -> Seed."""
     names = db.by_id("SpellName")
@@ -84,6 +88,10 @@
                 kids.append(t)
             if I(e["EffectAura"]) == C.AURA_OVERRIDE_ACTIONBAR:
                 kids.append(int(F(e["EffectBasePointsF"])))
+            if _is_dummy(e) and names[str(sid)]["Name_lang"].startswith(C.JUDGEMENT_PARENT_PREFIXES):
+                j = int(F(e["EffectBasePointsF"]))
+                if str(j) in names and names[str(j)]["Name_lang"].startswith(C.JUDGEMENT_CHILD_PREFIX):
+                    kids.append(j)
             for k in kids:
                 if k == 0 or str(k) not in names:
                     continue
```

`tools/pipeline/build_data.py` (diff):

```diff
--- a/tools/pipeline/build_data.py
+++ b/tools/pipeline/build_data.py
@@ -142,6 +142,12 @@
             n_hidden += sum(1 for t in s["talents"] if t.get("hidden"))
     write_json(os.path.join(out, "classes.json"), classes)
     write_records(os.path.join(out, "spells.json"), {"build": a.build}, {"spells": spells, "abilities": chains})
+    # Phase 4: one lazy chunk per class for the app (same records as spells.json; a spell may be in several files).
+    for cid, f in sorted(talent_files.items()):
+        hdr = {"build": a.build, "classId": cid, "token": f["token"]}
+        write_records(os.path.join(out, "spells", f["token"] + ".json"), hdr,
+                      {"spells": [s for s in spells if cid in s["classIds"]],
+                       "abilities": [c for c in chains if c["classId"] == cid]})
     write_records(os.path.join(out, "weapons.json"), {"build": a.build}, {"weapons": weapons, "ammo": ammo})
     write_json(os.path.join(out, "targets.json"), targets)
     write_json(os.path.join(out, "pet-families.json"), pets)
```

`tools/pipeline/tests/test_phase3.py` (diff):

```diff
--- a/tools/pipeline/tests/test_phase3.py
+++ b/tools/pipeline/tests/test_phase3.py
@@ -60,7 +60,7 @@
 
     def test_manual_values_match_spell_effects(self):
         self.assertEqual(load(self.d, "report.json")["manualValidation"], [])
-        self.assertEqual(load(self.d, "manifest.json")["pipelineVersion"], 2)
+        self.assertEqual(load(self.d, "manifest.json")["pipelineVersion"], 3)
 
 
 @needs_raw
```

New file `tools/pipeline/tests/test_phase4.py` (exact):

`tools/pipeline/tests/test_phase4.py` (exact):

```python
"""Phase 4 pipeline additions: per-class spell files and the seal -> judgement closure."""
import unittest

from ._fixtures import build_dir, load, needs_raw

TOKENS = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]


@needs_raw
class TestPhase4(unittest.TestCase):
    def setUp(self):
        self.d = build_dir()

    def test_class_spell_files_partition_spells_json(self):
        full = load(self.d, "spells.json")
        ids = set()
        for tok in TOKENS:
            f = load(self.d, "spells/%s.json" % tok)
            self.assertEqual(f["token"], tok)
            self.assertTrue(all(f["classId"] in s["classIds"] for s in f["spells"]), tok)
            self.assertTrue(all(c["classId"] == f["classId"] for c in f["abilities"]), tok)
            ids |= {s["id"] for s in f["spells"]}
        self.assertEqual(ids, {s["id"] for s in full["spells"]})
        self.assertEqual(len(full["spells"]), 2340)

    def test_judgement_closure(self):
        pal = {s["id"]: s for s in load(self.d, "spells/paladin.json")["spells"]}
        # Seal of Command r5 (20920) -> DUMMY 20968 "Judgement of Command" -> DUMMY 20966 (356 Holy, coef 0.429)
        self.assertIn(20968, pal)
        jc = pal[20966]
        self.assertEqual(jc["name"], "Judgement of Command")
        self.assertEqual([(e["effect"], e["base"], e["spCoef"]) for e in jc["effects"]], [(2, 356, 0.429)])
        self.assertIn(20286, pal)  # Judgement of Righteousness
        self.assertNotIn(707, pal)  # Seal of Fury DUMMY base 707 (Immolate) is a number, not a judgement
        self.assertEqual(load(self.d, "manifest.json")["pipelineVersion"], 3)


if __name__ == "__main__":
    unittest.main()
```

Regenerate: `python3 tools/pipeline/build_data.py --build 1.60.1.70888`. Expected output lines: `spells 2340`,
`abilityChains 547`; `report items: ... manualValidation 0, warnings 0`. `git status` must show only `manifest.json`,
`spells.json` and the new `spells/` directory under `data/generated/1.60.1.70888/`. Commit the generated data.

---

## 3. Manual data: `data/manual/rotations.json` (task T2, exact)

Schema (`RotationsFile`, section 4): one rotation per (class, spec). Entry kinds:

| Kind | Analytical meaning |
|---|---|
| `cooldown` | cast whenever ready: cap 60 / cooldown (category cooldowns shared) |
| `dot` | keep up: cap 60 / duration (and the cooldown) |
| `maintain` | cap 60 / `everySec` (default: duration) (Scorch for Fire Vulnerability every 30 s) |
| `filler` | everything left; the first learned filler wins, later fillers get 0 casts |
| `builder` | combo point builder; the first learned builder is used by every finisher, the others are skipped |
| `finisher` | `cp` combo points (default 5); each cast buys `(cp - refund) / builder cp` builder casts; cap 60 / duration when `buff: true` or a DoT (Slice and Dice, Rip), else uncapped |
| `nextSwing` | on-next-swing attack (Heroic Strike): processed last with the leftover resource; replaces main-hand swings |

Extra entry fields: `buff: true` (apply the ability's caster auras: Slice and Dice haste), `requires` (needs another
learned entry: Conflagrate needs Immolate), `requiresTalent` (Scorch only with Improved Scorch), `note`.

`data/manual/rotations.json` (exact):

```json
{
  "_source": "Phase 4 default priority rotations (docs/phase4-implementation-plan.md section 6). Ability names are rank-chain names in data/generated/<build>/spells/<class>.json. Entries are in priority order; an entry whose ability is not learned (talent not taken, wrong weapon) is skipped.",
  "_status": "[VERIFY] Classic-style priorities adapted to the Forever spell list; not checked against Forever logs.",
  "rotations": [
    { "id": "warrior-arms", "class": "warrior", "spec": 0, "label": "Arms: Mortal Strike, Whirlwind, Heroic Strike", "role": "dps", "tier": 1,
      "selfBuffs": [], "melee": true, "autoShot": false,
      "entries": [
        { "ability": "Mortal Strike", "kind": "cooldown" },
        { "ability": "Whirlwind", "kind": "cooldown" },
        { "ability": "Heroic Strike", "kind": "nextSwing" }
      ],
      "notes": ["Slam, Overpower, Rend and Execute are not in the Phase 4 rotation (Phase 5)."] },
    { "id": "warrior-fury", "class": "warrior", "spec": 1, "label": "Fury: Bloodthirst, Whirlwind, Heroic Strike", "role": "dps", "tier": 1,
      "selfBuffs": [], "melee": true, "autoShot": false,
      "entries": [
        { "ability": "Bloodthirst", "kind": "cooldown" },
        { "ability": "Whirlwind", "kind": "cooldown" },
        { "ability": "Heroic Strike", "kind": "nextSwing" }
      ],
      "notes": ["Execute phase, Death Wish and Recklessness are not modeled (Phase 5)."] },
    { "id": "warrior-protection", "class": "warrior", "spec": 2, "label": "Basic: Heroic Strike", "role": "tank", "tier": 3,
      "selfBuffs": [], "melee": true, "autoShot": false,
      "entries": [{ "ability": "Heroic Strike", "kind": "nextSwing" }],
      "notes": ["Tank spec: basic damage only. Shield Slam and Revenge need a shield and block/dodge procs (Q46)."] },

    { "id": "paladin-holy", "class": "paladin", "spec": 0, "label": "Basic: Holy Strike", "role": "healer", "tier": 3,
      "selfBuffs": [], "melee": true, "autoShot": false,
      "entries": [{ "ability": "Holy Strike", "kind": "cooldown" }],
      "notes": ["Healer spec: basic damage only."] },
    { "id": "paladin-protection", "class": "paladin", "spec": 1, "label": "Basic: Holy Strike", "role": "tank", "tier": 3,
      "selfBuffs": [], "melee": true, "autoShot": false,
      "entries": [{ "ability": "Holy Strike", "kind": "cooldown" }],
      "notes": ["Tank spec: basic damage only."] },
    { "id": "paladin-retribution", "class": "paladin", "spec": 2, "label": "Retribution: Seal of Command, Holy Strike, Judgement", "role": "dps", "tier": 1,
      "selfBuffs": ["Seal of Command"], "melee": true, "autoShot": false,
      "entries": [
        { "ability": "Holy Strike", "kind": "cooldown" },
        { "ability": "Judgement", "kind": "cooldown" }
      ],
      "notes": ["Seal of Righteousness, Consecration, Exorcism (Undead/Demon only) and Hammer of Wrath (execute) are not modeled."] },

    { "id": "hunter-beast-mastery", "class": "hunter", "spec": 0, "label": "Ranged: Aimed, Multi, Arcane Shot, Serpent Sting", "role": "dps", "tier": 2,
      "selfBuffs": ["Aspect of the Hawk", "Hunter's Mark"], "melee": false, "autoShot": true,
      "entries": [
        { "ability": "Aimed Shot", "kind": "cooldown" },
        { "ability": "Multi-Shot", "kind": "cooldown" },
        { "ability": "Arcane Shot", "kind": "cooldown" },
        { "ability": "Serpent Sting", "kind": "dot" }
      ],
      "notes": ["Pet damage arrives in Phase 6."] },
    { "id": "hunter-marksmanship", "class": "hunter", "spec": 1, "label": "Marksmanship: Sniper, Aimed, Multi, Arcane Shot", "role": "dps", "tier": 1,
      "selfBuffs": ["Aspect of the Hawk", "Hunter's Mark"], "melee": false, "autoShot": true,
      "entries": [
        { "ability": "Sniper Shot", "kind": "cooldown" },
        { "ability": "Aimed Shot", "kind": "cooldown" },
        { "ability": "Multi-Shot", "kind": "cooldown" },
        { "ability": "Arcane Shot", "kind": "cooldown" },
        { "ability": "Serpent Sting", "kind": "dot" }
      ],
      "notes": ["Rapid Fire and Rapid Killing are cooldowns (Phase 5). Lone Wolf assumes no pet (pets: Phase 6)."] },
    { "id": "hunter-survival", "class": "hunter", "spec": 2, "label": "Ranged: Aimed, Multi, Arcane Shot, Serpent Sting", "role": "dps", "tier": 2,
      "selfBuffs": ["Aspect of the Hawk", "Hunter's Mark"], "melee": false, "autoShot": true,
      "entries": [
        { "ability": "Aimed Shot", "kind": "cooldown" },
        { "ability": "Multi-Shot", "kind": "cooldown" },
        { "ability": "Arcane Shot", "kind": "cooldown" },
        { "ability": "Serpent Sting", "kind": "dot" }
      ],
      "notes": ["Survival melee procs (Mongoose Bite, Counterattack) and Lacerating Strikes are not modeled."] },

    { "id": "rogue-assassination", "class": "rogue", "spec": 0, "label": "Slice and Dice, Mutilate, Eviscerate", "role": "dps", "tier": 2,
      "selfBuffs": [], "melee": true, "autoShot": false,
      "entries": [
        { "ability": "Slice and Dice", "kind": "finisher", "cp": 5, "buff": true },
        { "ability": "Mutilate", "kind": "builder" },
        { "ability": "Sinister Strike", "kind": "builder" },
        { "ability": "Eviscerate", "kind": "finisher", "cp": 5 }
      ],
      "notes": ["Poisons are item enchants and are not in the spell data: not modeled."] },
    { "id": "rogue-combat", "class": "rogue", "spec": 1, "label": "Combat: Slice and Dice, Shank, Sinister Strike, Eviscerate", "role": "dps", "tier": 1,
      "selfBuffs": [], "melee": true, "autoShot": false,
      "entries": [
        { "ability": "Slice and Dice", "kind": "finisher", "cp": 5, "buff": true },
        { "ability": "Shank", "kind": "cooldown" },
        { "ability": "Sinister Strike", "kind": "builder" },
        { "ability": "Eviscerate", "kind": "finisher", "cp": 5 }
      ],
      "notes": ["Blade Flurry and Adrenaline Rush are cooldowns (Phase 5)."] },
    { "id": "rogue-subtlety", "class": "rogue", "spec": 2, "label": "Slice and Dice, Hemorrhage, Eviscerate", "role": "dps", "tier": 2,
      "selfBuffs": [], "melee": true, "autoShot": false,
      "entries": [
        { "ability": "Slice and Dice", "kind": "finisher", "cp": 5, "buff": true },
        { "ability": "Hemorrhage", "kind": "builder" },
        { "ability": "Backstab", "kind": "builder" },
        { "ability": "Sinister Strike", "kind": "builder" },
        { "ability": "Eviscerate", "kind": "finisher", "cp": 5 }
      ],
      "notes": ["Opener (Ambush, Premeditation) and Death Mark are not modeled."] },

    { "id": "priest-discipline", "class": "priest", "spec": 0, "label": "Basic: Shadow Word: Pain, Mind Blast, Smite", "role": "healer", "tier": 3,
      "selfBuffs": [], "melee": false, "autoShot": false,
      "entries": [
        { "ability": "Shadow Word: Pain", "kind": "dot" },
        { "ability": "Mind Blast", "kind": "cooldown" },
        { "ability": "Smite", "kind": "filler" }
      ],
      "notes": ["Healer spec: basic damage only."] },
    { "id": "priest-holy", "class": "priest", "spec": 1, "label": "Basic: Holy Fire, Shadow Word: Pain, Smite", "role": "healer", "tier": 3,
      "selfBuffs": [], "melee": false, "autoShot": false,
      "entries": [
        { "ability": "Shadow Word: Pain", "kind": "dot" },
        { "ability": "Holy Fire", "kind": "dot" },
        { "ability": "Mind Blast", "kind": "cooldown" },
        { "ability": "Smite", "kind": "filler" }
      ],
      "notes": ["Healer spec: basic damage only."] },
    { "id": "priest-shadow", "class": "priest", "spec": 2, "label": "Shadow: SW:P, Devouring Plague, Mind Blast, Mind Flay", "role": "dps", "tier": 1,
      "selfBuffs": ["Shadowform"], "melee": false, "autoShot": false,
      "entries": [
        { "ability": "Shadow Word: Pain", "kind": "dot" },
        { "ability": "Devouring Plague", "kind": "dot" },
        { "ability": "Mind Blast", "kind": "cooldown" },
        { "ability": "Mind Flay", "kind": "filler" }
      ],
      "notes": ["Shadow Word: Death and Vampiric Embrace are not in the Phase 4 rotation."] },

    { "id": "shaman-elemental", "class": "shaman", "spec": 0, "label": "Elemental: Flame Shock, Chain Lightning, Lightning Bolt", "role": "dps", "tier": 1,
      "selfBuffs": [], "melee": false, "autoShot": false,
      "entries": [
        { "ability": "Flame Shock", "kind": "dot" },
        { "ability": "Chain Lightning", "kind": "cooldown" },
        { "ability": "Lightning Bolt", "kind": "filler" }
      ],
      "notes": ["Single target. Clearcasting (Elemental Focus) only affects mana."] },
    { "id": "shaman-enhancement", "class": "shaman", "spec": 1, "label": "Enhancement: Windfury Weapon, Stormstrike, Flame Shock", "role": "dps", "tier": 2,
      "selfBuffs": ["Windfury Weapon"], "melee": true, "autoShot": false,
      "entries": [
        { "ability": "Stormstrike", "kind": "cooldown" },
        { "ability": "Flame Shock", "kind": "dot" }
      ],
      "notes": ["Maelstrom Weapon and the Stormstrike debuff are not modeled."] },
    { "id": "shaman-restoration", "class": "shaman", "spec": 2, "label": "Basic: Flame Shock, Lightning Bolt", "role": "healer", "tier": 3,
      "selfBuffs": [], "melee": false, "autoShot": false,
      "entries": [
        { "ability": "Flame Shock", "kind": "dot" },
        { "ability": "Lightning Bolt", "kind": "filler" }
      ],
      "notes": ["Healer spec: basic damage only."] },

    { "id": "mage-arcane", "class": "mage", "spec": 0, "label": "Arcane: Arcane Wrath, Arcane Missiles", "role": "dps", "tier": 2,
      "selfBuffs": [], "melee": false, "autoShot": false,
      "entries": [
        { "ability": "Arcane Wrath", "kind": "cooldown" },
        { "ability": "Arcane Missiles", "kind": "filler" }
      ],
      "notes": ["Arcane Blast stacks, Missile Barrage and Arcane Power are not modeled."] },
    { "id": "mage-fire", "class": "mage", "spec": 1, "label": "Fire: Scorch (Improved Scorch), Fire Blast, Fireball", "role": "dps", "tier": 1,
      "selfBuffs": [], "melee": false, "autoShot": false,
      "entries": [
        { "ability": "Scorch", "kind": "maintain", "everySec": 30, "requiresTalent": "Improved Scorch" },
        { "ability": "Fire Blast", "kind": "cooldown" },
        { "ability": "Fireball", "kind": "filler" }
      ],
      "notes": ["Combustion, Heating Up and Pyroblast procs are not modeled."] },
    { "id": "mage-frost", "class": "mage", "spec": 2, "label": "Frost: Frostbolt", "role": "dps", "tier": 1,
      "selfBuffs": [], "melee": false, "autoShot": false,
      "entries": [{ "ability": "Frostbolt", "kind": "filler" }],
      "notes": ["Shatter, Fingers of Frost and Ice Lance need frozen targets (Phase 5)."] },

    { "id": "warlock-affliction", "class": "warlock", "spec": 0, "label": "Affliction: Corruption, Bane of Agony, Siphon Life, Shadow Bolt", "role": "dps", "tier": 2,
      "selfBuffs": [], "melee": false, "autoShot": false,
      "entries": [
        { "ability": "Corruption", "kind": "dot" },
        { "ability": "Bane of Agony", "kind": "dot" },
        { "ability": "Siphon Life", "kind": "dot" },
        { "ability": "Shadow Bolt", "kind": "filler" }
      ],
      "notes": ["Wrack, Drain Soul and Soul Siphon are not modeled."] },
    { "id": "warlock-demonology", "class": "warlock", "spec": 1, "label": "Corruption, Bane of Agony, Shadow Bolt", "role": "dps", "tier": 2,
      "selfBuffs": [], "melee": false, "autoShot": false,
      "entries": [
        { "ability": "Corruption", "kind": "dot" },
        { "ability": "Bane of Agony", "kind": "dot" },
        { "ability": "Shadow Bolt", "kind": "filler" }
      ],
      "notes": ["Demon pets, Demonic Sacrifice and Master Demonologist arrive in Phase 6."] },
    { "id": "warlock-destruction", "class": "warlock", "spec": 2, "label": "Destruction: Immolate, Conflagrate, Incinerate or Shadow Bolt", "role": "dps", "tier": 1,
      "selfBuffs": [], "melee": false, "autoShot": false,
      "entries": [
        { "ability": "Immolate", "kind": "dot" },
        { "ability": "Conflagrate", "kind": "cooldown", "requires": "Immolate" },
        { "ability": "Incinerate", "kind": "filler" },
        { "ability": "Shadow Bolt", "kind": "filler" }
      ],
      "notes": ["Conflagrate is assumed not to consume Immolate (Shadow and Flame 5/5); Soul Fire is not modeled."] },

    { "id": "druid-balance", "class": "druid", "spec": 0, "label": "Balance: Moonfire, Insect Swarm, Starfire", "role": "dps", "tier": 1,
      "form": "moonkin", "selfBuffs": [], "melee": false, "autoShot": false,
      "entries": [
        { "ability": "Moonfire", "kind": "dot" },
        { "ability": "Insect Swarm", "kind": "dot" },
        { "ability": "Starfire", "kind": "filler" }
      ],
      "notes": ["Moonkin Aura crit is the 'Moonkin Aura' buff in the Character panel. Eclipse and Nature's Grace are not modeled."] },
    { "id": "druid-feral", "class": "druid", "spec": 1, "label": "Cat: Rip, Shred, Ferocious Bite", "role": "dps", "tier": 2,
      "form": "cat", "selfBuffs": [], "melee": true, "autoShot": false,
      "entries": [
        { "ability": "Rip", "kind": "finisher", "cp": 5 },
        { "ability": "Shred", "kind": "builder" },
        { "ability": "Claw", "kind": "builder" },
        { "ability": "Ferocious Bite", "kind": "finisher", "cp": 5 }
      ],
      "notes": ["Cat Form weapon damage uses the Classic formula (level x 0.85 to 1.25 per 1.0 sec swing) [VERIFY]. Bear Form is not modeled."] },
    { "id": "druid-restoration", "class": "druid", "spec": 2, "label": "Basic: Moonfire, Wrath", "role": "healer", "tier": 3,
      "selfBuffs": [], "melee": false, "autoShot": false,
      "entries": [
        { "ability": "Moonfire", "kind": "dot" },
        { "ability": "Wrath", "kind": "filler" }
      ],
      "notes": ["Healer spec: basic damage only."] }
  ]
}
```

---

## 4. Data contracts (task T3)

`src/data/types.ts` (diff):

```diff
--- a/src/data/types.ts
+++ b/src/data/types.ts
@@ -225,6 +225,7 @@
 export type EffectKey =
   | "stat" | "statPct" | "health" | "healthPct" | "mana" | "manaPct"
   | "attackPower" | "meleeAttackPower" | "rangedAttackPower" | "attackPowerPct" | "rangedAttackPowerPct"
+  | "attackPowerFromStat" | "rangedAttackPowerFromStat"
   | "spellPower" | "spellPowerFromStat"
   | "crit" | "weaponCrit" | "spellCrit"
   | "hit" | "weaponHit" | "spellHit"
@@ -235,9 +236,10 @@
 export interface StatEffect {
   key: EffectKey;
   value: number;
-  stat?: PrimaryStat | "all"; // stat, statPct, spellPowerFromStat
+  stat?: PrimaryStat | "all"; // stat, statPct, spellPowerFromStat, attackPowerFromStat, rangedAttackPowerFromStat
   schools?: School[]; // spellPower, spellPen, damageDonePct, target*: absent = all magic schools (all schools for damageDonePct)
-  slots?: AttackSlot[]; // weaponCrit, weaponHit, weaponSkill, weaponDamage: absent = every weapon slot
+  slots?: AttackSlot[]; // weaponCrit, weaponHit, weaponSkill, weaponDamage, damageDonePct: absent = every weapon slot
+  // (damageDonePct with slots: only weapon attacks from those slots, e.g. Wand Specialization)
 }
 export interface ManualEffect extends StatEffect {
   src?: { effectIndex: number; field?: "base" | "perResource"; mult?: number };
@@ -312,3 +314,126 @@
     statsWithoutBonus: number;
   };
 }
+
+// ---- Phase 4: class spells (data/generated/<build>/spells/<token>.json, same records as spells.json) ----
+/** One SpellEffect row (Difficulty 0). Optional fields are omitted by the pipeline when 0. */
+export interface SpellEffect {
+  index: number;
+  effect: number; // SpellEffect.Effect: 2 school damage, 3 dummy, 6 apply aura, 17/58 weapon damage, 31 weapon %, 121 normalized ...
+  aura: number; // EffectAura (6 only): 3 periodic damage, 4 dummy, 23 periodic trigger, 42 proc trigger, 53 leech, ...
+  base: number; // EffectBasePointsF (average value)
+  misc: [number, number];
+  mask: [number, number, number, number];
+  variance?: number; // damage range = base x (1 +- variance/2)
+  perLevel?: number; // EffectRealPointsPerLevel
+  spCoef?: number; // EffectBonusCoefficient (1 on every physical effect: a client default, not a coefficient)
+  apCoef?: number; // BonusCoefficientFromAP (never set in 70888)
+  periodMs?: number;
+  amplitude?: number;
+  chainTargets?: number;
+  pointsPerCombo?: number; // EffectPointsPerResource
+  triggerSpell?: number;
+  mechanic?: number; // 15 = bleed
+  targets?: [number, number];
+  radiusIndex?: [number, number];
+}
+export interface SpellCost {
+  powerType: number; // 0 mana, 1 rage (already / 10), 2 focus, 3 energy, 4 combo points, -2 health
+  amount: number;
+  pct: number; // % of base mana
+  perLevel: number;
+  perSecond: number;
+  optional: number;
+}
+export type SpellSource = "ability" | "talent" | "triggered";
+export interface Spell {
+  id: number;
+  name: string;
+  subtext: string | null;
+  rank: number | null;
+  classIds: number[];
+  sources: SpellSource[];
+  icon: string | null;
+  iconFileId: number;
+  school: number; // SpellSchoolMask (1 physical, 2 holy, 4 fire, 8 nature, 16 frost, 32 shadow, 64 arcane)
+  passive: boolean;
+  channeled: boolean;
+  attributes: number[]; // SpellMisc.Attributes_0..16
+  levels: { base: number; max: number; spell: number } | null;
+  castMs: number; // < 0 (-1000000) on some instant hunter shots
+  gcdMs: number;
+  gcdCategory: number;
+  cooldownMs: number;
+  categoryCooldownMs: number;
+  category: number;
+  costs: SpellCost[];
+  range: { min: number; max: number } | null;
+  duration: { ms: number; perLevel: number; maxMs: number } | null;
+  family: { set: number; mask: [number, number, number, number] } | null;
+  proc: {
+    chance: number;
+    charges: number;
+    categoryRecoveryMs: number;
+    typeMask: [number, number];
+    ppm: number | null;
+  } | null;
+  maxStacks: number;
+  defenseType: number; // SpellCategories.DefenseType: 0 none, 1 magic, 2 melee, 3 ranged
+  dispelType: number;
+  mechanic: number;
+  preventionType: number;
+  description: string;
+  auraDescription: string;
+  unresolved?: string[];
+  effects: SpellEffect[];
+  equipped: EquippedRequirement | null;
+  shapeshiftMask: number;
+}
+export interface AbilityChain {
+  classId: number;
+  name: string;
+  skillLineId: number;
+  passive: boolean;
+  ranks: number[]; // spell ids by learn level; a talent-granted ability starts at rank 2 (rank 1 is the talent spell)
+}
+export interface ClassSpellFile {
+  build: string;
+  classId: number;
+  token: ClassToken;
+  spells: Spell[];
+  abilities: AbilityChain[];
+}
+
+// ---- Phase 4: default rotations (data/manual/rotations.json) ----
+export type RotationEntryKind = "cooldown" | "dot" | "maintain" | "filler" | "builder" | "finisher" | "nextSwing";
+export interface RotationEntry {
+  ability: string; // ability name (rank chain name in spells/<class>.json)
+  kind: RotationEntryKind;
+  cp?: number; // finisher: combo points spent (1..5)
+  everySec?: number; // maintain: recast interval in seconds (default: the spell's duration)
+  buff?: true; // the ability's caster auras are applied while the rotation runs (Slice and Dice, seals)
+  requires?: string; // only cast when this other rotation entry is cast (Conflagrate requires Immolate)
+  requiresTalent?: string; // only cast when this talent has a point (Scorch for Improved Scorch)
+  note?: string;
+}
+export type RotationRole = "dps" | "tank" | "healer";
+export type ShapeshiftForm = "cat" | "bear" | "moonkin" | "shadowform" | "battle" | "berserker" | "defensive";
+export interface SpecRotation {
+  id: string; // stable id, e.g. "mage-fire"
+  class: ClassToken;
+  spec: number; // 0..2 (talent tab order)
+  label: string;
+  role: RotationRole;
+  tier: 1 | 2 | 3; // 1 fully modeled, 2 generic model, 3 basic damage rotation for a tank/healer spec
+  form?: ShapeshiftForm;
+  selfBuffs: string[]; // abilities whose caster auras are always on (Shadowform, Aspect of the Hawk, Seal of Command)
+  melee: boolean; // white melee swings (main hand + off hand)
+  autoShot: boolean; // hunter Auto Shot
+  entries: RotationEntry[];
+  notes: string[];
+}
+export interface RotationsFile {
+  _source: string;
+  _status: string;
+  rotations: SpecRotation[];
+}
```

`src/data/index.ts` (diff):

```diff
--- a/src/data/index.ts
+++ b/src/data/index.ts
@@ -2,15 +2,18 @@
 import baseStatsJson from "@manual/base-stats.json";
 import buffsJson from "@manual/buffs.json";
 import racialsJson from "@manual/racials.json";
+import rotationsJson from "@manual/rotations.json";
 import type {
   BaseStatsFile,
   BuffsFile,
   ClassesFile,
   ClassInfo,
+  ClassSpellFile,
   ClassToken,
   Manifest,
   RaceInfo,
   RacialsFile,
+  RotationsFile,
   TalentFile,
   TargetsFile,
   WeaponsFile,
@@ -52,6 +55,7 @@
 export const baseStatsFile = baseStatsJson as unknown as BaseStatsFile;
 export const buffsFile = buffsJson as unknown as BuffsFile;
 export const racialsFile = racialsJson as unknown as RacialsFile;
+export const rotationsFile = rotationsJson as unknown as RotationsFile;
 
 export function getRace(id: number): RaceInfo {
   const r = classesFile.races.find((x) => x.id === id);
@@ -66,3 +70,18 @@
   weaponsPromise.catch(() => (weaponsPromise = null));
   return weaponsPromise;
 }
+
+const spellLoaders = import.meta.glob<{ default: unknown }>("@data/spells/*.json");
+const spellCache = new Map<ClassToken, Promise<ClassSpellFile>>();
+/** spells/<class>.json (~20-30 KB gzip): one lazy chunk per class, loaded together with the talent file. */
+export function loadClassSpells(token: ClassToken): Promise<ClassSpellFile> {
+  const hit = spellCache.get(token);
+  if (hit) return hit;
+  const key = Object.keys(spellLoaders).find((k) => k.endsWith(`/spells/${token}.json`));
+  const loader = key ? spellLoaders[key] : undefined;
+  if (!loader) throw new Error(`no spell file for ${token}`);
+  const p = loader().then((m) => m.default as unknown as ClassSpellFile);
+  p.catch(() => spellCache.delete(token));
+  spellCache.set(token, p);
+  return p;
+}
```

`src/data/manual.test.ts` (diff):

```diff
--- a/src/data/manual.test.ts
+++ b/src/data/manual.test.ts
@@ -5,7 +5,7 @@
 const KEYS: EffectKey[] = [
   "stat", "statPct", "health", "healthPct", "mana", "manaPct", "attackPower", "meleeAttackPower", "rangedAttackPower",
   "attackPowerPct", "rangedAttackPowerPct", "spellPower", "spellPowerFromStat", "crit", "weaponCrit", "spellCrit", "hit",
-  "weaponHit", "spellHit", "haste", "meleeHaste", "rangedHaste", "spellHaste", "weaponSkill", "weaponDamage",
+  "weaponHit", "spellHit", "attackPowerFromStat", "rangedAttackPowerFromStat", "haste", "meleeHaste", "rangedHaste", "spellHaste", "weaponSkill", "weaponDamage",
   "offhandDamagePct", "expertise", "armorPenPct", "spellPen", "damageDonePct", "targetArmor", "targetResist",
   "targetDamageTakenPct",
 ];
```

---

## 5. Stat-engine changes (task T4)

1. Aura 598 / 580 -> new effect keys `attackPowerFromStat` / `rangedAttackPowerFromStat` (misc[0] = stat index), added
   to melee / ranged attack power before the AP% multipliers.
2. Aura 79 of a talent with a weapon `equipped` requirement gets `slots` (section 6.6 explains how slots are applied).
3. `mapTalents(list, weapons, formMask = 0)`: a form-only talent is active when `shapeshiftMask & formMask != 0`
   (Cat Form bit 1, Moonkin 1 << 30, Shadowform 1 << 27). Spell modifiers are no longer noted as "not modeled".
4. `assemble` accepts `extraEffects` (self-buffs, handler stat effects) and `formMask`.

`src/engine/stats/talentEffects.ts` (diff):

```diff
--- a/src/engine/stats/talentEffects.ts
+++ b/src/engine/stats/talentEffects.ts
@@ -1,5 +1,5 @@
 import type { AttackSlot, PrimaryStat, School, StatEffect, Talent, TalentEffect } from "@/data/types";
-import { WEAPON_SKILL_LINE_SUBCLASSES } from "./constants";
+import { ITEM_CLASS_WEAPON, WEAPON_SKILL_LINE_SUBCLASSES } from "./constants";
 import { describeRequirement, matchingSlots } from "./equip";
 import { PRIMARY_STATS, SCHOOL_BITS, type EquippedWeapons, type SourcedEffect } from "./types";
 
@@ -33,6 +33,8 @@
   MOD_CRIT_PCT: 290,
   MOD_MELEE_HASTE: 319, // [VERIFY]
   MOD_MELEE_RANGED_HASTE: 342, // [VERIFY]
+  MOD_RANGED_ATTACK_POWER_OF_STAT_PERCENT: 580, // Forever: Careful Aim (with 598) "Attack Power by 100% of your Intellect" [VERIFY]
+  MOD_ATTACK_POWER_OF_STAT_PERCENT: 598, // Forever: Mental Dexterity, Careful Aim; misc[0] = stat index (3 = Int) [VERIFY]
 } as const;
 
 /** Auras with server-side behavior (Phase 4 handlers). */
@@ -132,6 +134,18 @@
           { key: "spellPowerFromStat", stat: statOfIndex(m1), schools: schoolsOfMask(m0 & ~1), value: v },
         ],
       };
+    case AURA.MOD_ATTACK_POWER_OF_STAT_PERCENT:
+      return {
+        kind: "stat",
+        perSlot: false,
+        effects: [{ key: "attackPowerFromStat", stat: statOfIndex(m0), value: v }],
+      };
+    case AURA.MOD_RANGED_ATTACK_POWER_OF_STAT_PERCENT:
+      return {
+        kind: "stat",
+        perSlot: false,
+        effects: [{ key: "rangedAttackPowerFromStat", stat: statOfIndex(m0), value: v }],
+      };
     case AURA.MOD_OFFHAND_DAMAGE_PCT:
       return { kind: "stat", perSlot: false, effects: [{ key: "offhandDamagePct", value: v }] };
     case AURA.MOD_EXPERTISE:
@@ -184,8 +198,17 @@
   });
 }
 
-/** Generic talent mapper (Phase 3): stat-level auras of passive talents; everything else is listed. */
-export function mapTalents(list: readonly RankedTalent[], weapons: EquippedWeapons): TalentMapping {
+/**
+ * Generic talent mapper: stat-level auras of passive talents; everything else is listed.
+ * `formMask` (Phase 4): ShapeshiftMask bit of the rotation's form (1 << (form - 1)); form-only talents are active when
+ * `talent.shapeshiftMask & formMask` is non-zero. Spell modifiers (107/108) are returned in `spellMods` and applied by
+ * the damage engine, so they are no longer noted as "not modeled".
+ */
+export function mapTalents(
+  list: readonly RankedTalent[],
+  weapons: EquippedWeapons,
+  formMask = 0,
+): TalentMapping {
   const out: TalentMapping = { applied: [], damageDone: [], spellMods: [], notModeled: [] };
   for (const { talent: t, rank } of list) {
     const values = t.ranks[rank - 1]?.values ?? [];
@@ -198,8 +221,8 @@
       note("ability", "ability or cooldown (Phase 4/5)");
       continue;
     }
-    if (t.shapeshiftMask !== 0) {
-      note("inactive", "requires a shapeshift form (Phase 4)");
+    if (t.shapeshiftMask !== 0 && (t.shapeshiftMask & formMask) === 0) {
+      note("inactive", "requires a shapeshift form that the rotation does not use");
       continue;
     }
     const slots = matchingSlots(t.equipped, weapons);
@@ -226,6 +249,8 @@
             const sourced: SourcedEffect = { ...se, label, kind: "talent" };
             if (e.aura === AURA.MOD_SKILL) sourced.slots = skillSlots(e.misc[0], weapons);
             else if (m.kind === "stat" && m.perSlot && t.equipped) sourced.slots = slots;
+            else if (m.kind === "damageDone" && t.equipped && t.equipped.itemClass === ITEM_CLASS_WEAPON)
+              sourced.slots = slots; // Wand / Ranged Weapon / Two-Handed Weapon Specialization: weapon attacks only
             (m.kind === "damageDone" ? out.damageDone : out.applied).push(sourced);
           }
           break;
@@ -239,7 +264,6 @@
             pct: e.aura === AURA.ADD_PCT_MODIFIER,
             mask: e.mask,
           });
-          note("spellMod", "modifies specific spells (Phase 4)");
           break;
         case "special":
           note("special", `aura ${e.aura} needs a handler (Phase 4)`);
```

`src/engine/stats/assemble.ts` (diff):

```diff
--- a/src/engine/stats/assemble.ts
+++ b/src/engine/stats/assemble.ts
@@ -14,6 +14,10 @@
   talents: readonly RankedTalent[];
   weapons: EquippedWeapons;
   bonus: BonusStats;
+  /** Phase 4: caster auras of the rotation's self-buffs (Shadowform, Aspect of the Hawk, Slice and Dice ...). */
+  extraEffects?: readonly SourcedEffect[];
+  /** Phase 4: ShapeshiftMask bit of the rotation's form (0 = no form). */
+  formMask?: number;
 }
 export interface Assembled {
   input: CharacterInput;
@@ -45,8 +49,8 @@
       else effects.push(strip(e, b.name, "buff"));
     }
   }
-  const mapping = mapTalents(a.talents, a.weapons);
-  effects.push(...mapping.applied, ...mapping.damageDone);
+  const mapping = mapTalents(a.talents, a.weapons, a.formMask ?? 0);
+  effects.push(...mapping.applied, ...mapping.damageDone, ...(a.extraEffects ?? []));
   return {
     input: {
       classToken: a.classToken,
```

`src/engine/stats/character.ts` (diff):

```diff
--- a/src/engine/stats/character.ts
+++ b/src/engine/stats/character.ts
@@ -51,6 +51,23 @@
 const hasSchool = (e: SourcedEffect, s: School) => !e.schools || e.schools.includes(s);
 const hasSlot = (e: SourcedEffect, s: AttackSlot) => !e.slots || e.slots.includes(s);
 
+/** "X% of <stat>" parts (aura 598/580: attack power from Intellect). */
+function statShare(
+  effects: readonly SourcedEffect[],
+  key: "attackPowerFromStat" | "rangedAttackPowerFromStat",
+  P: (s: PrimaryStat) => number,
+): Part[] {
+  return effects
+    .filter((e) => e.key === key && e.stat !== undefined && e.stat !== "all")
+    .map((e) =>
+      part(
+        `${e.label} (${e.value}% of ${STAT_LABEL[e.stat as PrimaryStat]})`,
+        e.kind,
+        (P(e.stat as PrimaryStat) * e.value) / 100,
+      ),
+    );
+}
+
 /** Equipped weapons in slot order, each counted once. */
 function equipped(input: CharacterInput): { slot: AttackSlot; w: Weapon }[] {
   return ATTACK_SLOTS.flatMap((slot) => (input.weapons[slot] ? [{ slot, w: input.weapons[slot]! }] : []));
@@ -136,6 +153,7 @@
       part("Bonus stats", "gear", bonus.attackPower),
       ...itemStat(input, ITEM_STAT.attackPower),
       ...effectParts(effects, (e) => e.key === "attackPower" || e.key === "meleeAttackPower"),
+      ...statShare(effects, "attackPowerFromStat", P),
     ]),
     effects.filter((e) => e.key === "attackPowerPct"),
   );
@@ -153,6 +171,7 @@
           ...itemStat(input, ITEM_STAT.attackPower),
           ...itemStat(input, ITEM_STAT.rangedAttackPower),
           ...effectParts(effects, (e) => e.key === "attackPower" || e.key === "rangedAttackPower"),
+          ...statShare(effects, "rangedAttackPowerFromStat", P),
         ]),
         effects.filter((e) => e.key === "rangedAttackPowerPct"),
       )
```

`src/engine/stats/stats.test.ts` (diff):

```diff
--- a/src/engine/stats/stats.test.ts
+++ b/src/engine/stats/stats.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from "vitest";
-import { ammo, buffs, run, weapon } from "@/testkit/stats";
+import { NO_WEAPONS, ammo, buffs, ranked, run, weapon } from "@/testkit/stats";
 import { treeFor } from "@/testkit/talents";
 import type { ClassToken } from "@/data/types";
 import { baseMeleeMiss } from "./target";
@@ -192,8 +192,28 @@
     expect(r.mapping.notModeled).toContainEqual(
       expect.objectContaining({ name: "Sharpened Claws", reason: "inactive" }),
     );
+    const cat = mapTalents(ranked("druid", { "Sharpened Claws": 2 }), NO_WEAPONS, 1); // Cat Form bit
+    expect(cat.applied).toEqual([expect.objectContaining({ key: "crit", value: 6 })]);
   });
-  it("abilities and spell modifiers are listed, not applied", () => {
+  it("Careful Aim adds attack power from Intellect (aura 598 melee, 580 ranged)", () => {
+    const r = run({ classToken: "hunter", race: "DWARF", talents: { "Careful Aim": 5 } });
+    const int = r.stats.primary.int.value;
+    const base = run({ classToken: "hunter", race: "DWARF" });
+    expect(r.stats.attackPower.value - base.stats.attackPower.value).toBeCloseTo(int, 6);
+    expect(r.stats.rangedAttackPower!.value - base.stats.rangedAttackPower!.value).toBeCloseTo(int, 6);
+  });
+  it("Wand Specialization only applies to the wand", () => {
+    const r = run({
+      classToken: "mage",
+      race: "HUMAN",
+      weapons: { ranged: weapon(19108) },
+      talents: { "Wand Specialization": 2 },
+    });
+    expect(r.stats.damageDone).toEqual([
+      expect.objectContaining({ key: "damageDonePct", value: 25, slots: ["ranged"] }),
+    ]);
+  });
+  it("abilities are listed; spell modifiers are returned for the damage engine", () => {
     const r = run({
       classToken: "warrior",
       race: "HUMAN",
@@ -201,7 +221,7 @@
     });
     const reasons = r.mapping.notModeled.map((n) => `${n.name}:${n.reason}`);
     expect(reasons).toContain("Death Wish:ability");
-    expect(reasons).toContain("Improved Heroic Strike:spellMod");
+    expect(reasons).not.toContain("Improved Heroic Strike:spellMod");
     expect(r.mapping.spellMods[0]).toMatchObject({ name: "Improved Heroic Strike", op: expect.any(Number) });
   });
 });
@@ -210,10 +230,17 @@
   const APPLIED: Record<string, string[]> = {
     warrior: ["Cruelty"],
     paladin: ["Divine Intellect", "Precision", "Conviction", "Champion of the Light"],
-    hunter: ["Lethal Attacks", "Surefooted", "Lightning Reflexes"],
+    hunter: ["Lethal Attacks", "Careful Aim", "Surefooted", "Lightning Reflexes"],
     rogue: ["Malice", "Precision", "Weapon Expertise", "Serrated Blades"],
     priest: ["Mental Strength", "Spiritual Guidance"],
-    shaman: ["Thundering Strikes", "Ancestral Knowledge", "Toughness", "Mental Quickness", "Tidal Focus"],
+    shaman: [
+      "Thundering Strikes",
+      "Ancestral Knowledge",
+      "Mental Dexterity",
+      "Toughness",
+      "Mental Quickness",
+      "Tidal Focus",
+    ],
     mage: ["Arcane Subtlety", "Arcane Mind", "Arcane Instability", "Precision"],
     warlock: ["Suppression", "Demonic Embrace"],
     druid: ["Nature's Majesty", "Nature's Reach", "Heart of the Wild", "Living Spirit"],
```

---

## 6. Damage engine (tasks T5-T8)

### 6.1 Modules

```
src/engine/combat/          pure formulas, no data knowledge
  constants.ts              [VERIFY] crit bonuses, glancing, normalized speeds, resist, rage, energy, PPM, Cat Form, finisher AP, form masks
  outcome.ts                special/spell/white chances, expected factor, armor/resist/damage-taken factors
  index.ts
src/engine/abilities/       one ability vs one target
  types.ts                  DamageContext, AbilityResult, DamagePart, AbilityDraft (handler hook input), WhiteResult
  spellbook.ts              Spellbook, learn(): rank selection + talent gating
  mods.ts                   SpellModOp table, collectMods() by family mask, mod sources from talents and self-buffs
  evaluate.ts               evaluateAbility(), SCRIPTS, damage sources, weapon sequence, evaluateWhite()
  index.ts
src/engine/talents/special/ DUMMY/proc talent handlers keyed by talent spell id
  types.ts, handlers.ts, index.ts
src/engine/rotation/        rotation level
  types.ts                  CastLine, RotationResult
  analytical.ts             runRotation() (priority waterfall), procs (Seal of Command, Windfury), evaluateEntries()
  selfBuffs.ts              pickRotation(), selfBuffSpells(), selfBuffEffects()
  prepare.ts                prepareDamage(): stats for a rotation (form, self-buffs, handler stat effects)
  evaluate.ts               evaluateDamage(): two passes
  index.ts
```

Import direction (no cycles): `stats` <- `combat` <- `abilities` <- `talents/special` <- `rotation`. The ESLint
"engine is pure" rule already covers the new folders (no React, no `@data`/`@manual`).

### 6.2 Pipeline of one evaluation

```
derive(calc, character)
  rotation  = pickRotation(rotations.json, class, pointsBySpec)                 (section 6.9)
  prepared  = prepareDamage(...)                                                 rotation.form -> formMask; self-buff spells;
              assemble(extraEffects = Cat Form Agi share + self-buff auras + handler stat effects, formMask)
              computeCharacter -> stats                                          (Phase 3, unchanged order)
  for each target view (selected + 4 references [+ custom]):
     evaluateDamage(stats, view, book, rotation, talents, spellMods, selfBuffs, handlers)
        pass 1: ctx(effects = []) -> evaluateEntries -> white -> runRotation
        effects = handlers.rotation(pass 1)                                     (uptimes, rage, extra dps)
        pass 2: ctx(effects) -> evaluateEntries -> white -> runRotation   => DamageResult
  reference[i].dps = pass-2 dps vs that target
```

### 6.3 One ability (`evaluateAbility`)

```
spell  = learn(name)                                  highest rank with levels.base <= level; talent ability needs its talent
slot   = melee: mainHand (Shank: offHand) | ranged: ranged | spell: none; unavailable if the weapon is missing or
         spell.equipped is not met by that slot ("requires a dagger")
mods   = collectMods(spell)                           107/108 of talents + self-buffs, family mask match
time   = cast = max(0, castMs + flat10) x pct10 / 1000 / (1 + haste)   haste: spell (defenseType 0/1), ranged (3), none (2)
         channel = duration (after op 1 and SCRIPTS) for channeled spells; gcd = gcdMs/1000 (never hasted)
         timeCost = max(gcd, cast, channel); 0 for procs
         cooldown = max(own, category), each (ms + flat11) x pct11
cost   = (amount + pct x baseMana) + flat14 (/10 for rage), x pct14; energize/combo points from effect 30 (combo points x land)
sources= the spell itself | Mutilate: triggered weapon spells (MH, OH) | Whirlwind: + off hand | Judgement: seal -> DUMMY
         chain to the "Judgement of X" spell with effect 2 (x JUDGEMENT_DAMAGE_FACTOR)
parts per source (common mult = aura 79 (school, slots) x target damage taken x pass-2 damagePct):
  weapon: W = perSwing (normalized: perSwing - AP/14 x speed + AP/14 x normSpeed) x off-hand factor
          for e in effects by index: 17/58/121 -> W += value(e) (+ spCoef x SP if magic school); 31 -> W = W x value/100 (+ spCoef x SP)
          perHit = W x mult x op0 x armor
  direct (effect 2): value + ppc x cp + spCoef x SP (magic) + SCRIPT bonus -> x mult x op0 x script mult x armor/bleed x resist
  periodic (aura 3/53): ticks = floor(duration / period); tick = value + ppc x cp + spCoef x SP + script total / ticks
          x mult x op22 x armor/bleed x resist
  missiles (aura 23): ticks x direct damage of the triggered spell (its own mods and crit)
chances: spell: land = 100 - max(1, miss - hit16); melee: 100 - (miss - hit16) - dodge; ranged: 100 - (miss - hit16)
         crit = target crit + flat7 (0 with CANT_CRIT); critMult = 1 + bonus x pct15
handlers' ability hooks run on the draft (Ignite, Lightning Overload, Improved Mind Flay, Improved Whirlwind, Seal Fate, Ruthlessness)
expected per part = count x perHit x land/100 x (1 + crit/100 x (critMult - 1));  dpct = expected / max(timeCost, 1.5 if 0)
```

### 6.4 Scripted spells (`SCRIPTS`, evidence)

| Ability | Rule | Evidence |
|---|---|---|
| Bloodthirst | + effect[1].base % of AP to the effect-2 damage (48 + 45% AP) | tooltip `$s2% of your Attack Power plus $s1` |
| Eviscerate, Ferocious Bite | + 3% AP per combo point `[VERIFY Q53]` | tooltips say "increased by Attack Power"; values: TBC 2.4 |
| Rip | + 6% AP per combo point up to 4 over the whole DoT `[VERIFY Q53]` | TBC 2.4 (24% at 4-5 cp) |
| Slice and Dice | duration = 6 s + 3 s per cp (then op 1) | tooltip 9/12/15/18/21 s |
| Shank | off-hand strike | tooltip "with your off-hand weapon" |
| Arcane Wrath | + effect[1].base % of max mana as spell power | tooltip |
| Incinerate | x (1 + effect[1].base %) when Immolate is a learned rotation entry | tooltip |
| Judgement | damage of the judged seal; Judgement of Command x 0.5 (not stunned) | Seal of Command tooltip `$/2;20966s1` |
| Whirlwind | adds an off-hand strike when an off hand is equipped `[VERIFY]` | Forever tooltip "both melee weapons" |
| Mutilate | the two effect-64 triggered spells are the MH and OH strikes | effect 64 -> 1241586/1241590 |

### 6.5 White attacks (`evaluateWhite`)

Main hand / off hand: single roll from `whiteTable` (miss incl. dual-wield penalty, dodge, 40% glancing at the vmangos
average 65% vs boss, crit capped by the table). Ranged (Auto Shot): miss and crit only. Normal hit = `perSwing`
(Phase 3, incl. AP/14 x speed and ammo) x off-hand factor x aura 79 (physical, slot) x armor. Speed = Phase 3 hasted
speed / Flurry (pass 2). Cat Form replaces the main hand: speed 1.0, level x 0.85..1.25, plus AP/14; off hand ignored.

### 6.6 Analytical rotation (`runRotation`)

```
power  = power of the first learned entry with a cost (rage | energy | mana); limited = rage or energy
income = energy: 600 per minute; rage: sum over MH/OH white swings of 60/speed x 7.5 x E[swing]/c(L) + handler rage
time   = 60 s; resource = income (Infinity for mana); category time left = 60 s per category
ordered = entries with net cost < 0 (Shank) first, then the rest in priority order
for each entry (nextSwing deferred):
  skip (with reason) if unavailable, requiresTalent missing, requires not learned, or a builder other than the first
  t = timeCost; c = cost - energize (0 if not limited)
  cap: cooldown -> 60/cooldown; dot -> min(cap, 60/duration); maintain -> 60/everySec;
       finisher -> k = (cp - refund) / builder cp; t += k x builder t; c += k x builder c; cap = buff or DoT ? 60/duration : inf
       category -> min(cap, category time left / category cooldown)
  n = min(cap, time/t, resource/c); n not finite -> skipped "not modeled"
  time -= n t; resource -= n c; category time -= n x catCd; builder casts += n x k
nextSwing: lost = rage of a MH swing (HS swings give no rage); n = min(MH swings, 60/cd, resource / (cost + lost)); MH swings -= n
damage per minute of an entry = n x (direct + extras) + min(n, 60/duration) x periodic
Auto Shot swings = 60/speed x (1 - sum(n x cast/channel time)/60)
procs: Seal of Command = landed MH swings x 7 PPM x speed/60, damage = proc spell 20424 evaluated as an ability;
       Windfury Weapon = landed MH swings x 20% x 2 attacks of a white swing with +333 AP
dps = (sum casts + white + extras) / 60; mana/s = mana spent / 60; OOM = max mana / mana per second (no regeneration)
```

Approximations (document in CALC_MODEL 6): no cooldown collisions or GCD drift; DoTs, buffs and procs at their
average; stance/form switching, execute phase, movement and cooldown abilities (Death Wish, Arcane Power, Combustion,
Rapid Fire, Blade Flurry, Adrenaline Rush) are out of scope (Phase 5 sim); self-buffs have 100% uptime even when the
resource does not afford them.

### 6.7 Code: `src/engine/combat/` (exact)

`src/engine/combat/constants.ts` (exact):

```ts
// Phase 4 combat constants. Classic 1.12 values unless stated; none is confirmed in Forever ([VERIFY], Q3/Q47-Q58).

/** src: Classic 1.12: spells crit for 150% (bonus 0.5), melee and ranged attacks for 200% (bonus 1.0). [VERIFY Q3] */
export const SPELL_CRIT_BONUS = 0.5;
export const PHYSICAL_CRIT_BONUS = 1.0;

/**
 * src: vmangos Unit::CalculateGlancingDamage (Classic 1.12, recalled): a glancing blow deals a uniform random
 * fraction between low = clamp(1.3 - 0.05 d, 0.01, 0.91) and high = clamp(1.2 - 0.03 d, 0.2, 0.99) of the damage,
 * d = defense - weapon skill. 300 vs 315: 0.55..0.75 (average 0.65, i.e. -35%); 308 vs 315: -5%. [VERIFY Q34]
 */
export function glancingMultiplier(defenseMinusSkill: number): number {
  const d = defenseMinusSkill;
  const low = Math.min(0.91, Math.max(0.01, 1.3 - 0.05 * d));
  const high = Math.min(0.99, Math.max(0.2, 1.2 - 0.03 * d));
  return (low + high) / 2;
}

/** src: Classic 1.12 normalized weapon speeds for instant attacks (effect 121). Cat Form uses its own 1.0. [VERIFY] */
export const NORMALIZED_SPEED = { dagger: 1.7, oneHand: 2.4, twoHand: 3.3, ranged: 2.8 } as const;
export const DAGGER_SUBCLASS = 15;

/**
 * src: Classic 1.12 average partial resist for non-binary spells: 0.75 x R / (5 x casterLevel), cap 0.75; targets
 * above the caster's level add 8 resistance per level (boss +3: 24 -> 6.0%). Holy cannot be resisted. [VERIFY Q50]
 */
export const RESIST_PER_LEVEL = 8;
export const MAX_AVERAGE_RESIST = 0.75;
export function averageResist(resistance: number, casterLevel: number): number {
  return Math.min(MAX_AVERAGE_RESIST, (0.75 * Math.max(0, resistance)) / (5 * casterLevel));
}

/**
 * src: vmangos Player::RewardRage (Classic 1.12): rage from damage dealt = 7.5 x damage / c(L),
 * c(L) = 0.0091107836 L^2 + 3.225598133 L + 4.2652911 (230.6 at 60). A Heroic Strike swing generates no rage. [VERIFY Q51]
 */
export function rageConversion(level: number): number {
  return 0.0091107836 * level * level + 3.225598133 * level + 4.2652911;
}
export const RAGE_PER_DAMAGE_FACTOR = 7.5;
/** src: Classic: energy regenerates 20 per 2 sec tick. [VERIFY] */
export const ENERGY_PER_SECOND = 10;

/** src: SpellCastTimes Base -1000000 on instant hunter shots (Arcane Shot, Serpent Sting ...): treated as instant. */
export const INSTANT_CAST_SENTINEL = 0;

/** src: Classic 1.12 Seal of Command: 7 procs per minute (not in client data; proc chance 100 in SpellAuraOptions). [VERIFY Q54] */
export const SEAL_OF_COMMAND_PPM = 7;
/** src: Windfury Weapon rank 4 (16362) tooltip "Each hit has a 20% chance of granting you 2 extra attacks with 333 extra
 * melee attack power" (the enchant values are not exported). Main-hand white hits only. [VERIFY Q54] */
export const WINDFURY = { chance: 20, attacks: 2, attackPower: 333 } as const;
/** src: Seal of Command tooltip "$/2;20966s1 Holy damage, $20966s1 if the target is stunned": half damage. [VERIFY] */
export const JUDGEMENT_DAMAGE_FACTOR: Readonly<Record<string, number>> = { "Judgement of Command": 0.5 };

/** src: vmangos Player::UpdateDamagePhysical (Classic 1.12): Cat Form swing 1.0 sec for level x 0.85 .. level x 1.25. [VERIFY Q55] */
export const CAT_FORM = { speed: 1.0, minPerLevel: 0.85, maxPerLevel: 1.25, apPerAgi: 1 } as const;

/**
 * Finisher attack power scaling (not in client data; descriptions say "increased by Attack Power"). [VERIFY Q53]
 * src: TBC 2.4 tooltips: Eviscerate and Ferocious Bite +3% AP per combo point; Rip +6% AP per combo point up to 4.
 */
export const FINISHER_AP: Readonly<Record<string, (cp: number) => number>> = {
  Eviscerate: (cp) => 0.03 * cp,
  "Ferocious Bite": (cp) => 0.03 * cp,
  Rip: (cp) => 0.06 * Math.min(cp, 4),
};

/** Shapeshift form ids (SpellShapeshiftForm); a talent's ShapeshiftMask bit is 1 << (form - 1). */
export const FORM_ID = {
  cat: 1,
  bear: 5,
  battle: 17,
  defensive: 18,
  berserker: 19,
  shadowform: 28,
  moonkin: 31,
} as const;
export const formMask = (form: keyof typeof FORM_ID | null | undefined): number =>
  form ? 1 << (FORM_ID[form] - 1) : 0;

/** SpellMisc.Attributes_2 bit SPELL_ATTR2_CANT_CRIT (modern enum). */
export const ATTR2_CANT_CRIT = 0x20000000;
/** SpellMechanic 15 = bleed: ignores armor. */
export const MECHANIC_BLEED = 15;
```

`src/engine/combat/outcome.ts` (exact):

```ts
import type { AttackSlot, MagicSchool, School } from "@/data/types";
import {
  MAGIC_SCHOOLS,
  SCHOOL_BITS,
  SKILL_PER_LEVEL,
  type MeleeOutcome,
  type TargetView,
} from "@/engine/stats";
import {
  PHYSICAL_CRIT_BONUS,
  RESIST_PER_LEVEL,
  SPELL_CRIT_BONUS,
  averageResist,
  glancingMultiplier,
} from "./constants";

export type AttackKind = "spell" | "melee" | "ranged";

/** Schools of a SpellSchoolMask, physical first. */
export function schoolsOf(mask: number): School[] {
  return SCHOOL_BITS.filter((_, i) => (mask & (1 << i)) !== 0);
}
/** The school used for spell power, damage-done and display: the first magic school, else physical. */
export function primarySchool(mask: number): School {
  const s = schoolsOf(mask);
  return s.find((x) => x !== "physical") ?? "physical";
}

/** Two-roll special attack (melee or ranged) or spell: chance to land and crit chance, in %. */
export interface RollChances {
  land: number; // % of casts that hit (spell: 100 - miss; melee: 100 - miss - dodge - parry; ranged: 100 - miss)
  crit: number; // % of landed hits that crit
  critBonus: number; // extra damage of a crit (0.5 = 150%)
}

/** Base chances for a special attack from a slot's outcome table; `hitBonus` = SpellMod op 16 (percent points). */
export function specialChances(
  o: MeleeOutcome,
  ranged: boolean,
  hitBonus: number,
  critBonusPct: number,
): RollChances {
  const miss = Math.max(0, o.miss.value - hitBonus);
  const dodge = ranged ? 0 : o.dodge.value; // [VERIFY Q49] ranged attacks are not dodged
  return {
    land: Math.max(0, 100 - miss - dodge - o.parry - o.block),
    crit: Math.max(0, o.crit.value + critBonusPct),
    critBonus: PHYSICAL_CRIT_BONUS,
  };
}

export function spellChances(view: TargetView, hitBonus: number, critBonusPct: number): RollChances {
  const miss = Math.max(1, view.spell.miss.value - hitBonus);
  return {
    land: 100 - miss,
    crit: Math.max(0, view.spell.crit.value + critBonusPct),
    critBonus: SPELL_CRIT_BONUS,
  };
}

/** Expected damage factor of one cast: land x (1 + crit x bonus x critDamageMult). */
export function expectedFactor(c: RollChances, critDamageMult = 1): number {
  const crit = Math.min(100, c.crit) / 100;
  return (c.land / 100) * (1 + crit * c.critBonus * critDamageMult);
}

/** White melee (single roll): fractions of swings, in %, and the expected damage factor of one swing. */
export interface WhiteTable {
  miss: number;
  dodge: number;
  glancing: number;
  crit: number;
  hit: number;
  glancingMultiplier: number;
  factor: number; // expected damage of a swing / damage of a normal hit
}
export function whiteTable(
  o: MeleeOutcome,
  slot: AttackSlot,
  skill: number,
  targetLevel: number,
  critDamageMult = 1,
): WhiteTable {
  const ranged = slot === "ranged";
  const miss = ranged ? o.miss.value : o.whiteMiss.value;
  const dodge = ranged ? 0 : o.dodge.value;
  const glancing = ranged ? 0 : o.glancing;
  const cap = Math.max(0, 100 - miss - dodge - o.parry - o.block - glancing);
  const crit = Math.min(o.crit.value, cap);
  const hit = Math.max(0, cap - crit);
  const gm = glancingMultiplier(targetLevel * SKILL_PER_LEVEL - skill);
  const factor = (hit + glancing * gm + crit * (1 + PHYSICAL_CRIT_BONUS * critDamageMult)) / 100;
  return { miss, dodge, glancing, crit, hit, glancingMultiplier: gm, factor };
}

/** Physical damage that is not a bleed is reduced by armor. */
export function armorFactor(view: TargetView, school: School, bleed: boolean): number {
  return school === "physical" && !bleed ? 1 - view.armorReduction.value / 100 : 1;
}

/**
 * Average partial resist of a magic school (holy and physical: 0). A multi-school spell uses the lowest resistance
 * of its schools (Frostfire Bolt tooltip). Level-based resistance: 8 per level above the caster.
 */
export function resistFactor(view: TargetView, schoolMask: number, casterLevel: number): number {
  const magic = schoolsOf(schoolMask).filter((s): s is MagicSchool => s !== "physical" && s !== "holy");
  if (magic.length === 0) return 1;
  const r = Math.min(...magic.map((s) => view.resist[s].value));
  const levelResist = Math.max(0, view.level - casterLevel) * RESIST_PER_LEVEL;
  return 1 - averageResist(r + levelResist, casterLevel);
}

/** Target debuffs such as Curse of the Elements: +x% damage taken by school (the highest of a multi-school spell). */
export function damageTakenFactor(view: TargetView, schoolMask: number): number {
  const pcts = schoolsOf(schoolMask).map((s) => view.damageTakenPct[s] ?? 0);
  return 1 + Math.max(0, ...pcts) / 100;
}

export const isMagic = (s: School): s is MagicSchool => (MAGIC_SCHOOLS as readonly string[]).includes(s);
```

`src/engine/combat/index.ts` (exact):

```ts
export * from "./constants";
export * from "./outcome";
```

### 6.8 Code: `src/engine/abilities/` (exact)

`src/engine/abilities/types.ts` (exact):

```ts
import type { AttackSlot, RotationEntry, School, ShapeshiftForm, Spell, Talent } from "@/data/types";
import type { CharacterStats, EquippedWeapons, RankedTalent, SourceKind, TargetView } from "@/engine/stats";
import type { AttackKind, RollChances } from "@/engine/combat";
import type { Spellbook } from "./spellbook";

export type PowerKind = "mana" | "rage" | "energy" | "focus";

/** One line of an ability's "modified by" list, e.g. { label: "Critical Mass 3/3", text: "+6% crit chance" }. */
export interface SourceLine {
  label: string;
  kind: SourceKind;
  text: string;
}

/** A spell modifier source (talent aura 107/108, self-buff aura 107/108). */
export interface ModSource {
  label: string;
  kind: SourceKind;
  op: number; // SpellModOp (EffectMiscValue_0)
  value: number;
  pct: boolean; // aura 108
  mask: [number, number, number, number];
}

/** Uptime-based effects computed from the first rotation pass (talent handlers, section 7). */
export interface RotationEffect {
  label: string;
  /** Multiplies damage of the given schools (and only these abilities when `abilities` is set). */
  damagePct?: { schools: School[]; pct: number; abilities?: string[] };
  meleeHastePct?: number; // white melee swing speed (Flurry)
  ragePerMinute?: number;
  extraDps?: number; // damage not tied to a rotation entry (Deep Wounds, extra attacks, Nightfall)
}

/** Everything an ability evaluation needs. Built once per target. */
export interface DamageContext {
  level: number;
  stats: CharacterStats;
  view: TargetView;
  book: Spellbook;
  weapons: EquippedWeapons;
  form: ShapeshiftForm | null;
  talents: readonly RankedTalent[]; // invested talents
  classTalents: readonly Talent[]; // every talent of the class (ability gating)
  mods: readonly ModSource[];
  selfBuffs: readonly Spell[]; // learned self-buff spells of the rotation
  effects: readonly RotationEffect[]; // empty in pass 1
  rotationAbilities: ReadonlySet<string>; // learned abilities of the rotation (Incinerate checks Immolate)
  abilityHooks: readonly AbilityHook[]; // talent handlers (section 7)
}

/** One damage component of a cast: `count` hits (or ticks) of `perHit` (after multipliers and mitigation, no crit). */
export interface DamagePart {
  label: string;
  kind: "direct" | "periodic";
  perHit: number;
  count: number;
  chances: RollChances;
  critMultiplier: number;
  range?: [number, number]; // min/max of one normal hit (direct parts)
}
/** Mutable evaluation state passed to talent handlers before the expected damage is summed. */
export interface AbilityDraft {
  key: string;
  spell: Spell;
  kind: AttackKind;
  school: School;
  schoolMask: number;
  slot: AttackSlot | null;
  finisher: boolean;
  parts: DamagePart[];
  extras: { label: string; value: number }[];
  comboPoints: number;
  cpRefund: number;
  sources: SourceLine[];
  notes: string[];
}
export type AbilityHook = (d: AbilityDraft, ctx: DamageContext) => void;

/** A learned ability evaluated against one target (per cast, averages). */
export interface AbilityResult {
  key: string; // rotation ability name (or "Seal of Command (proc)")
  available: true;
  spell: Spell;
  name: string;
  rank: number | null;
  icon: string | null;
  school: School;
  schoolMask: number;
  kind: AttackKind;
  slot: AttackSlot | null; // weapon slot used (null: spell)
  castTime: number; // seconds after modifiers and haste (0 = instant)
  channelTime: number; // seconds (0 = not channeled)
  gcd: number; // seconds
  cooldown: number; // seconds, own or category cooldown, after modifiers (0 = none)
  category: number; // SpellCategories.Category when it has a category cooldown, else 0
  categoryCooldown: number; // seconds
  timeCost: number; // seconds of the player's time per cast: max(gcd, cast, channel); 0 when off the GCD
  power: PowerKind | null;
  cost: number; // per cast, after modifiers (rage in rage points, mana in mana)
  energize: number; // resource returned by the cast itself (Shank energy), same power
  comboPoints: number; // expected combo points awarded per cast (builders)
  cpRefund: number; // expected combo points refunded per finisher (Ruthlessness)
  hitChance: number; // % of casts that land
  critChance: number; // % of landed hits/ticks that crit
  critMultiplier: number; // damage of a crit / damage of a normal hit
  hit: number; // average non-crit damage of the direct part (weapon + direct) after mitigation, 0 if none
  hitRange: [number, number] | null;
  crit: number; // average crit damage of the direct part
  tick: number; // average non-crit periodic tick after mitigation (0 if none)
  ticks: number; // per cast (channel ticks or DoT ticks)
  periodSec: number;
  durationSec: number; // DoT/buff duration (0 if none)
  expectedDirect: number; // per cast, incl. hit/crit/mitigation
  expectedPeriodic: number; // per cast, full duration
  extras: { label: string; value: number }[]; // per cast (Ignite, Lightning Overload)
  expected: number; // expectedDirect + expectedPeriodic + extras
  dpct: number; // expected / execute time (max(timeCost, gcd), or 1.5 s for off-GCD abilities)
  sources: SourceLine[];
  notes: string[];
}
export interface UnavailableAbility {
  key: string;
  available: false;
  reason: string;
}
export type AbilityEval = AbilityResult | UnavailableAbility;

/** White attacks of one slot. */
export interface WhiteResult {
  slot: AttackSlot;
  name: string;
  speed: number; // hasted seconds per swing (before Flurry)
  normalHit: number; // damage of a normal hit after armor and multipliers
  expectedPerSwing: number; // incl. miss/dodge/glancing/crit
  hitChance: number; // % of swings that land (incl. glancing and crit)
  critChance: number; // % of swings that crit
  glancing: number; // % of swings
  glancingMultiplier: number;
  dps: number;
}

export type EntryEval = { entry: RotationEntry; ability: AbilityEval };
```

`src/engine/abilities/spellbook.ts` (exact):

```ts
import type { AbilityChain, ClassSpellFile, Spell, Talent } from "@/data/types";
import type { RankedTalent } from "@/engine/stats";

export interface Spellbook {
  classSet: number; // SpellClassOptions.SpellClassSet of the class (talent masks are relative to it)
  baseMana: number; // base mana at the character level (percent costs)
  spells: ReadonlyMap<number, Spell>;
  chains: ReadonlyMap<string, AbilityChain>;
}

export function buildSpellbook(file: ClassSpellFile, classSet: number, baseMana: number): Spellbook {
  return {
    classSet,
    baseMana,
    spells: new Map(file.spells.map((s) => [s.id, s])),
    chains: new Map(file.abilities.map((c) => [c.name, c])),
  };
}

export type Learned = { spell: Spell; talent: RankedTalent | null } | { reason: string };

/**
 * Highest rank of `name` learnable at `level` (SpellLevels.BaseLevel <= level). A talent-granted ability (a talent of
 * kind "ability" with the same name) needs a point in that talent; its rank 1 is the talent spell and the trained
 * ranks 2+ are in the ability chain.
 */
export function learn(
  book: Spellbook,
  name: string,
  level: number,
  talents: readonly RankedTalent[],
  classTalents: readonly Talent[],
): Learned {
  const gate = classTalents.find((t) => t.kind === "ability" && t.name === name);
  const taken = gate ? talents.find((r) => r.talent.nodeId === gate.nodeId && r.rank > 0) : undefined;
  if (gate && !taken) return { reason: `needs the talent ${name}` };
  const ids = [...(book.chains.get(name)?.ranks ?? []), ...(taken ? [taken.talent.spellId] : [])];
  const candidates = ids
    .map((id) => book.spells.get(id))
    .filter((s): s is Spell => s !== undefined && (s.levels?.base ?? 0) <= level)
    .sort(
      (a, b) => (a.levels?.base ?? 0) - (b.levels?.base ?? 0) || (a.rank ?? 0) - (b.rank ?? 0) || a.id - b.id,
    );
  const spell = candidates[candidates.length - 1];
  if (!spell) return { reason: ids.length ? `not learned at level ${level}` : `unknown ability ${name}` };
  return { spell, talent: taken ?? null };
}
```

`src/engine/abilities/mods.ts` (exact):

```ts
import type { Spell } from "@/data/types";
import type { RankedTalent, SpellMod } from "@/engine/stats";
import type { ModSource, SourceLine } from "./types";

/**
 * SpellModOp (EffectMiscValue_0 of aura 107 flat / 108 pct), modern enum, checked against 70888 talents (section 1.4).
 * Ops not listed here (threat 2, charges 4, range 5, radius 6, pushback 9, proc chance 18, ...) do not change damage.
 */
export const OP = {
  DAMAGE: 0, // direct (non-periodic) damage, incl. weapon strikes: Improved Cone of Cold, Aggression, Arcane Power
  DURATION: 1, // Improved Shadow Word: Pain +6000 ms, Improved Slice and Dice +45%
  POINTS_0: 3, // value of effect index 0: Permafrost, Composure
  CRIT_CHANCE: 7, // Critical Mass, Incineration, Improved Overpower
  POINTS_ALL: 8, // all effect values: Clever Traps
  CAST_TIME: 10, // Accelerant -500 ms, Presence of Mind -100%
  COOLDOWN: 11, // Improved Whirlwind -2000 ms, Purifying Power -33%
  POINTS_1: 12, // value of effect index 1: Flash of Steel (+15 energy from Shank)
  COST: 14, // Improved Heroic Strike -30 (= -3 rage, raw x10), Efficient Strikes -5 energy, Convection -10%
  CRIT_DAMAGE: 15, // crit damage bonus %: Ice Shards +100, Impale +20, Mortal Shots +30
  HIT_CHANCE: 16, // Divine Precision +8
  PERIODIC: 22, // periodic damage: Improved Rend, Improved Corruption, Arcane Instability (Fireball DoT part)
  POINTS_2: 23, // value of effect index 2
} as const;

export const OP_LABEL: Readonly<Record<number, string>> = {
  0: "damage",
  1: "duration",
  3: "effect 1",
  7: "crit chance",
  8: "effect values",
  10: "cast time",
  11: "cooldown",
  12: "effect 2",
  14: "cost",
  15: "crit damage bonus",
  16: "hit chance",
  22: "periodic damage",
  23: "effect 3",
};

/** Talent spell modifiers as mod sources (label "Name rank/max"). */
export function talentModSources(mods: readonly SpellMod[], talents: readonly RankedTalent[]): ModSource[] {
  return mods.map((m) => {
    const t = talents.find((r) => r.talent.nodeId === m.nodeId);
    const label = t ? `${m.name} ${t.rank}/${t.talent.maxRank}` : m.name;
    return { label, kind: "talent", op: m.op, value: m.value, pct: m.pct, mask: m.mask };
  });
}

/** 107/108 effects of self-buff spells (Shadowform: +100% shadow crit damage bonus). */
export function buffModSources(spells: readonly Spell[]): ModSource[] {
  return spells.flatMap((s) =>
    s.effects
      .filter((e) => e.effect === 6 && (e.aura === 107 || e.aura === 108))
      .map((e) => ({
        label: s.name,
        kind: "buff" as const,
        op: e.misc[0],
        value: e.base,
        pct: e.aura === 108,
        mask: e.mask,
      })),
  );
}

export function familyMatches(mask: readonly number[], spell: Spell, classSet: number): boolean {
  const f = spell.family;
  if (!f || f.set !== classSet) return false;
  return mask.some((m, i) => (m & f.mask[i]!) !== 0);
}

/** Flat sums and percent products per op for one spell, plus the "modified by" lines. */
export interface ModTotals {
  flat(op: number): number;
  mult(op: number): number; // product of (1 + pct/100)
  sumPct(op: number): number; // sum of pct values (crit damage bonus)
  lines: SourceLine[];
}

const fmt = (op: number, v: number, pct: boolean, rage: boolean): string => {
  const sign = v > 0 ? "+" : "−";
  const a = Math.abs(v);
  if (pct) return `${sign}${a}% ${OP_LABEL[op]}`;
  if (op === OP.CAST_TIME || op === OP.COOLDOWN || op === OP.DURATION)
    return `${sign}${a / 1000} s ${OP_LABEL[op]}`;
  if (op === OP.COST && rage) return `${sign}${a / 10} rage cost`;
  if (op === OP.CRIT_CHANCE || op === OP.HIT_CHANCE) return `${sign}${a}% ${OP_LABEL[op]}`;
  return `${sign}${a} ${OP_LABEL[op]}`;
};

export function collectMods(spell: Spell, sources: readonly ModSource[], classSet: number): ModTotals {
  const flat = new Map<number, number>();
  const mult = new Map<number, number>();
  const sum = new Map<number, number>();
  const lines: SourceLine[] = [];
  const rage = spell.costs[0]?.powerType === 1;
  for (const m of sources) {
    if (!(m.op in OP_LABEL) || m.value === 0 || !familyMatches(m.mask, spell, classSet)) continue;
    if (m.pct) {
      mult.set(m.op, (mult.get(m.op) ?? 1) * (1 + m.value / 100));
      sum.set(m.op, (sum.get(m.op) ?? 0) + m.value);
    } else flat.set(m.op, (flat.get(m.op) ?? 0) + m.value);
    lines.push({ label: m.label, kind: m.kind, text: fmt(m.op, m.value, m.pct, rage) });
  }
  return {
    flat: (op) => flat.get(op) ?? 0,
    mult: (op) => mult.get(op) ?? 1,
    sumPct: (op) => sum.get(op) ?? 0,
    lines,
  };
}
```

`src/engine/abilities/evaluate.ts` (exact):

```ts
import type { AttackSlot, RotationEntry, School, Spell, SpellEffect } from "@/data/types";
import { AP_PER_DPS, describeRequirement, matchingSlots, type WeaponDamage } from "@/engine/stats";
import {
  ATTR2_CANT_CRIT,
  CAT_FORM,
  DAGGER_SUBCLASS,
  FINISHER_AP,
  JUDGEMENT_DAMAGE_FACTOR,
  MECHANIC_BLEED,
  NORMALIZED_SPEED,
  armorFactor,
  damageTakenFactor,
  expectedFactor,
  primarySchool,
  resistFactor,
  schoolsOf,
  specialChances,
  spellChances,
  whiteTable,
  type AttackKind,
  type RollChances,
} from "@/engine/combat";
import { OP, collectMods, type ModTotals } from "./mods";
import { learn } from "./spellbook";
import type {
  AbilityDraft,
  AbilityEval,
  AbilityResult,
  DamageContext,
  DamagePart,
  PowerKind,
  SourceLine,
  WhiteResult,
} from "./types";

/** SpellEffect.Effect values (modern enum, checked against 70888 class abilities, section 1.3). */
export const EFFECT = {
  SCHOOL_DAMAGE: 2,
  DUMMY: 3,
  APPLY_AURA: 6,
  WEAPON_DAMAGE_NOSCHOOL: 17, // weapon damage + base points (Heroic Strike, Cleave, Slam)
  ENERGIZE: 30, // misc[0] = power type (3 energy, 4 combo points)
  WEAPON_PERCENT_DAMAGE: 31, // weapon damage x base% (Backstab 150, Mutilate 90)
  WEAPON_DAMAGE: 58, // weapon damage + base points (Auto Shot, Raptor Strike, Shred)
  TRIGGER_SPELL: 64, // Mutilate main/off hand strikes
  NORMALIZED_WEAPON_DMG: 121, // normalized weapon damage + base points (Sinister Strike, Mortal Strike, Aimed Shot)
} as const;
export const AURA_PERIODIC_DAMAGE = 3;
export const AURA_PERIODIC_TRIGGER = 23;
export const AURA_PERIODIC_LEECH = 53;
const WEAPON_EFFECTS = new Set<number>([17, 31, 58, 121]);
const POWER: Readonly<Record<number, PowerKind>> = { 0: "mana", 1: "rage", 2: "focus", 3: "energy" };
const COMBO_POINTS = 4;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Value of an effect at a level: base + perLevel x (min(level, maxLevel) - baseLevel), then point modifiers. */
export function effectValue(spell: Spell, e: SpellEffect, level: number, mods: ModTotals | null): number {
  const lv = spell.levels;
  let v = e.base;
  if (lv && e.perLevel)
    v += e.perLevel * Math.max(0, (lv.max > 0 ? Math.min(level, lv.max) : level) - lv.base);
  if (!mods) return v;
  const idxOp = e.index === 0 ? OP.POINTS_0 : e.index === 1 ? OP.POINTS_1 : e.index === 2 ? OP.POINTS_2 : -1;
  const flat = mods.flat(OP.POINTS_ALL) + (idxOp >= 0 ? mods.flat(idxOp) : 0);
  const mult = mods.mult(OP.POINTS_ALL) * (idxOp >= 0 ? mods.mult(idxOp) : 1);
  return (v + flat) * mult;
}

function kindOf(spell: Spell): AttackKind {
  return spell.defenseType === 2 ? "melee" : spell.defenseType === 3 ? "ranged" : "spell";
}

/** Weapon numbers of a slot; Cat Form replaces the main hand with the form's claws (CAT_FORM). */
interface WeaponInfo {
  name: string;
  perSwing: number; // average damage incl. AP/14 x speed, ammo and flat weapon damage
  spread: number; // (max - min) / 2 of the weapon roll
  speed: number; // unhasted
  hastedSpeed: number;
  ap: number;
  normSpeed: number;
  factor: number; // off hand: 0.5 x (1 + off-hand %), else 1
}
export function weaponInfo(ctx: DamageContext, slot: AttackSlot): WeaponInfo | null {
  const s = ctx.stats;
  if (ctx.form === "cat" && slot === "mainHand") {
    const ap = s.attackPower.value; // includes Cat Form's Agility share (prepareDamage)
    const avg = ((CAT_FORM.minPerLevel + CAT_FORM.maxPerLevel) / 2) * ctx.level * CAT_FORM.speed;
    const hasted = CAT_FORM.speed / (1 + s.haste.melee.value / 100);
    return {
      name: "Cat Form",
      perSwing: avg + (ap / AP_PER_DPS) * CAT_FORM.speed,
      spread: ((CAT_FORM.maxPerLevel - CAT_FORM.minPerLevel) / 2) * ctx.level * CAT_FORM.speed,
      speed: CAT_FORM.speed,
      hastedSpeed: hasted,
      ap,
      normSpeed: CAT_FORM.speed,
      factor: 1,
    };
  }
  if (ctx.form === "cat") return null;
  const w: WeaponDamage | null = s.weapons[slot];
  const item = ctx.weapons[slot];
  if (!w || !item || w.isWand) return null;
  const ap = slot === "ranged" ? (s.rangedAttackPower?.value ?? 0) : s.attackPower.value;
  const normSpeed =
    slot === "ranged"
      ? NORMALIZED_SPEED.ranged
      : item.subclass === DAGGER_SUBCLASS
        ? NORMALIZED_SPEED.dagger
        : item.slot === "twoHand"
          ? NORMALIZED_SPEED.twoHand
          : NORMALIZED_SPEED.oneHand;
  const factor = slot === "offHand" ? (w.dps.value * w.hastedSpeed) / w.perSwing.value : 1;
  return {
    name: w.name,
    perSwing: w.perSwing.value,
    spread: (w.max - w.min) / 2,
    speed: w.speed,
    hastedSpeed: w.hastedSpeed,
    ap,
    normSpeed,
    factor,
  };
}

/** Damage multiplier lines shared by all parts of a spell: aura 79 (school + weapon slots), target debuffs, handlers. */
function damageMultiplier(
  ctx: DamageContext,
  key: string,
  schoolMask: number,
  slot: AttackSlot | null,
  lines: SourceLine[],
): number {
  const schools = schoolsOf(schoolMask);
  let m = 1;
  for (const e of ctx.stats.damageDone) {
    if (e.schools && !e.schools.some((s) => schools.includes(s))) continue;
    if (e.slots) {
      const melee = e.slots.includes("mainHand") || e.slots.includes("offHand");
      if (slot ? !e.slots.includes(slot) : !melee) continue;
    }
    m *= 1 + e.value / 100;
    lines.push({ label: e.label, kind: e.kind, text: `+${e.value}% damage` });
  }
  const taken = damageTakenFactor(ctx.view, schoolMask);
  if (taken !== 1) {
    m *= taken;
    lines.push({ label: "Target debuffs", kind: "debuff", text: `+${r1((taken - 1) * 100)}% damage taken` });
  }
  for (const fx of ctx.effects) {
    const d = fx.damagePct;
    if (!d || d.pct === 0 || !d.schools.some((s) => schools.includes(s))) continue;
    if (d.abilities && !d.abilities.includes(key)) continue;
    m *= 1 + d.pct / 100;
    lines.push({ label: fx.label, kind: "talent", text: `+${r1(d.pct)}% damage (average uptime)` });
  }
  return m;
}

function spellPowerOf(ctx: DamageContext, schoolMask: number): number {
  const magic = schoolsOf(schoolMask).filter((s) => s !== "physical") as Exclude<School, "physical">[];
  return magic.length ? Math.max(...magic.map((s) => ctx.stats.spellPower[s].value)) : 0;
}

interface DamageSource {
  spell: Spell; // the spell whose effects deal the damage (triggered spell for Mutilate / Judgement)
  slot: AttackSlot | null;
  factor: number;
  label: string;
}

/** Hooks for spells whose damage formula is server-scripted (section 6.4). */
interface ScriptArgs {
  ctx: DamageContext;
  spell: Spell;
  cp: number;
}
interface Script {
  slot?: AttackSlot;
  directBonus?(a: ScriptArgs): { value: number; text: string } | null;
  periodicTotalBonus?(a: ScriptArgs): { value: number; text: string } | null;
  spellPowerBonus?(a: ScriptArgs): { value: number; text: string } | null;
  multiplier?(a: ScriptArgs): { value: number; text: string } | null;
  durationMs?(a: ScriptArgs): number;
}
const dummyValue = (spell: Spell, index: number) => spell.effects.find((e) => e.index === index)?.base ?? 0;
export const SCRIPTS: Readonly<Record<string, Script>> = {
  // "damage equal to $s2% of your Attack Power plus $s1": effect 1 (DUMMY) holds the AP percent.
  Bloodthirst: {
    directBonus: ({ ctx, spell }) => {
      const pct = dummyValue(spell, 1);
      return { value: (pct / 100) * ctx.stats.attackPower.value, text: `${pct}% of attack power` };
    },
  },
  Eviscerate: {
    directBonus: ({ ctx, cp }) => ({
      value: FINISHER_AP.Eviscerate!(cp) * ctx.stats.attackPower.value,
      text: `${r1(FINISHER_AP.Eviscerate!(cp) * 100)}% of attack power [VERIFY]`,
    }),
  },
  "Ferocious Bite": {
    directBonus: ({ ctx, cp }) => ({
      value: FINISHER_AP["Ferocious Bite"]!(cp) * ctx.stats.attackPower.value,
      text: `${r1(FINISHER_AP["Ferocious Bite"]!(cp) * 100)}% of attack power [VERIFY]`,
    }),
  },
  Rip: {
    periodicTotalBonus: ({ ctx, cp }) => ({
      value: FINISHER_AP.Rip!(cp) * ctx.stats.attackPower.value,
      text: `${r1(FINISHER_AP.Rip!(cp) * 100)}% of attack power [VERIFY]`,
    }),
  },
  // "Lasts longer per combo point: 1 point: 9 seconds ... 5 points: 21 seconds"
  "Slice and Dice": { durationMs: ({ spell, cp }) => (spell.duration?.ms ?? 0) + 3000 * cp },
  // "Instantly strike with your off-hand weapon"
  Shank: { slot: "offHand" },
  // "gains additional Spell Damage equal to $s2% of your maximum Mana"
  "Arcane Wrath": {
    spellPowerBonus: ({ ctx, spell }) => {
      const pct = dummyValue(spell, 1);
      return {
        value: (pct / 100) * (ctx.stats.mana?.value ?? 0),
        text: `+${pct}% of maximum mana as spell damage`,
      };
    },
  },
  // "an additional $s2% damage if the target is afflicted by Immolate"
  Incinerate: {
    multiplier: ({ ctx, spell }) =>
      ctx.rotationAbilities.has("Immolate")
        ? {
            value: 1 + dummyValue(spell, 1) / 100,
            text: `+${dummyValue(spell, 1)}% (Immolate on the target)`,
          }
        : null,
  },
};

/** Damage sources of a cast (section 6.3): the spell itself, triggered strikes, both weapons, or the judged seal. */
function damageSources(
  ctx: DamageContext,
  spell: Spell,
  key: string,
  slot: AttackSlot | null,
): DamageSource[] | string {
  if (key === "Judgement") {
    const seal = ctx.selfBuffs.find((s) => s.name.startsWith("Seal of "));
    if (!seal) return "needs a Seal in the rotation";
    let cur: Spell | undefined = seal;
    for (let i = 0; i < 4 && cur; i++) {
      if (cur.effects.some((e) => e.effect === EFFECT.SCHOOL_DAMAGE) && cur.name.startsWith("Judgement of "))
        return [{ spell: cur, slot: null, factor: JUDGEMENT_DAMAGE_FACTOR[cur.name] ?? 1, label: cur.name }];
      const next: Spell | undefined = cur.effects
        .filter((e) => e.effect === EFFECT.DUMMY || (e.effect === EFFECT.APPLY_AURA && e.aura === 4))
        .map((e) => ctx.book.spells.get(e.base))
        .find((s) => s?.name.startsWith("Judgement of "));
      cur = next;
    }
    return `no damage spell for the judgement of ${seal.name}`;
  }
  const triggered = spell.effects
    .filter((e) => e.effect === EFFECT.TRIGGER_SPELL && e.triggerSpell)
    .map((e) => ctx.book.spells.get(e.triggerSpell!))
    .filter((s): s is Spell => !!s && s.effects.some((x) => WEAPON_EFFECTS.has(x.effect)));
  if (triggered.length > 0) {
    const slots: AttackSlot[] = ["mainHand", "offHand"];
    return triggered
      .map((s, i) => ({
        spell: s,
        slot: slots[i] ?? "mainHand",
        factor: 1,
        label: i === 0 ? "Main hand" : "Off hand",
      }))
      .filter((d) => weaponInfo(ctx, d.slot) !== null);
  }
  const out: DamageSource[] = [{ spell, slot, factor: 1, label: spell.name }];
  // Forever Whirlwind: "causing weapon damage from both melee weapons" [VERIFY]
  if (key === "Whirlwind" && weaponInfo(ctx, "offHand"))
    out.push({ spell, slot: "offHand", factor: 1, label: "Off hand" });
  return out;
}

function chancesFor(
  ctx: DamageContext,
  spell: Spell,
  slot: AttackSlot | null,
  mods: ModTotals,
): RollChances | string {
  const kind = kindOf(spell);
  const critMod = mods.flat(OP.CRIT_CHANCE);
  const hitMod = mods.flat(OP.HIT_CHANCE);
  let c: RollChances;
  if (kind === "spell") c = spellChances(ctx.view, hitMod, critMod);
  else {
    const o = ctx.view[slot ?? (kind === "ranged" ? "ranged" : "mainHand")];
    if (!o)
      return kind === "ranged" ? "requires a bow, gun, crossbow or thrown weapon" : "requires a melee weapon";
    c = specialChances(o, kind === "ranged", hitMod, critMod);
  }
  if ((spell.attributes[2] ?? 0) & ATTR2_CANT_CRIT) c = { ...c, crit: 0 };
  return c;
}

/** Damage parts of one source (weapon strike, direct effects, periodic effects, periodic missiles). */
function partsOf(
  ctx: DamageContext,
  src: DamageSource,
  key: string,
  cp: number,
  durationMs: number,
  lines: SourceLine[],
): DamagePart[] | string {
  const spell = src.spell;
  const mods = collectMods(spell, ctx.mods, ctx.book.classSet);
  lines.push(...mods.lines);
  const chances = chancesFor(ctx, spell, src.slot, mods);
  if (typeof chances === "string") return chances;
  const school = primarySchool(spell.school);
  const magic = school !== "physical";
  const sp = spellPowerOf(ctx, spell.school);
  const script = SCRIPTS[key];
  const spBonus = script?.spellPowerBonus?.({ ctx, spell, cp }) ?? null;
  if (spBonus) lines.push({ label: spell.name, kind: "rule", text: spBonus.text });
  const spTotal = sp + (spBonus?.value ?? 0);
  const critMult = 1 + chances.critBonus * mods.mult(OP.CRIT_DAMAGE);
  const common = damageMultiplier(ctx, key, spell.school, src.slot, lines) * src.factor;
  const scriptMult = script?.multiplier?.({ ctx, spell, cp }) ?? null;
  if (scriptMult) lines.push({ label: spell.name, kind: "rule", text: scriptMult.text });
  const bleed = spell.mechanic === MECHANIC_BLEED;
  const resist = resistFactor(ctx.view, spell.school, ctx.level);
  const mitigation = (b: boolean) => armorFactor(ctx.view, school, b) * resist;
  const effects = [...spell.effects].sort((a, b) => a.index - b.index);
  const parts: DamagePart[] = [];
  const directMult = common * mods.mult(OP.DAMAGE) * (scriptMult?.value ?? 1);

  // 1. weapon strike: effects applied in index order (17/58/121 add, 31 multiplies) [VERIFY Q48]
  if (effects.some((e) => WEAPON_EFFECTS.has(e.effect))) {
    const slot = src.slot ?? (kindOf(spell) === "ranged" ? "ranged" : "mainHand");
    const w = weaponInfo(ctx, slot);
    if (!w)
      return slot === "ranged" ? "requires a bow, gun, crossbow or thrown weapon" : "requires a melee weapon";
    const normalized = effects.some((e) => e.effect === EFFECT.NORMALIZED_WEAPON_DMG);
    const apPart = (w.ap / AP_PER_DPS) * w.speed;
    let dmg = (normalized ? w.perSwing - apPart + (w.ap / AP_PER_DPS) * w.normSpeed : w.perSwing) * w.factor;
    let spread = w.spread * w.factor;
    for (const e of effects) {
      if (!WEAPON_EFFECTS.has(e.effect)) continue;
      const v = effectValue(spell, e, ctx.level, mods);
      const spPart = magic && e.spCoef ? e.spCoef * spTotal : 0;
      if (e.effect === EFFECT.WEAPON_PERCENT_DAMAGE) {
        dmg = (dmg * v) / 100 + spPart;
        spread = (spread * v) / 100;
      } else dmg += v + spPart;
    }
    const k = directMult * mitigation(false);
    parts.push({
      label: `${src.label}${normalized ? " (normalized)" : ""}`,
      kind: "direct",
      perHit: dmg * k,
      count: 1,
      chances,
      critMultiplier: critMult,
      range: [(dmg - spread) * k, (dmg + spread) * k],
    });
  }

  // 2. direct school damage (effect 2), incl. combo points and spell power
  for (const e of effects.filter((x) => x.effect === EFFECT.SCHOOL_DAMAGE)) {
    const base = effectValue(spell, e, ctx.level, mods) + (e.pointsPerCombo ?? 0) * cp;
    const spPart = magic && e.spCoef ? e.spCoef * spTotal : 0;
    const bonus = script?.directBonus?.({ ctx, spell, cp }) ?? null;
    if (bonus) lines.push({ label: spell.name, kind: "rule", text: bonus.text });
    if (spPart) lines.push({ label: "Spell power", kind: "gear", text: `${r1(sp)} x ${e.spCoef}` });
    const avg = base + spPart + (bonus?.value ?? 0);
    const k = directMult * mitigation(bleed || e.mechanic === MECHANIC_BLEED);
    const v = e.variance ?? 0;
    parts.push({
      label: spell.name,
      kind: "direct",
      perHit: avg * k,
      count: 1,
      chances,
      critMultiplier: critMult,
      range: [
        (base * (1 - v / 2) + spPart + (bonus?.value ?? 0)) * k,
        (base * (1 + v / 2) + spPart + (bonus?.value ?? 0)) * k,
      ],
    });
  }

  // 3. periodic damage (aura 3 / 53) and periodic missiles (aura 23 -> triggered spell)
  for (const e of effects.filter((x) => x.effect === EFFECT.APPLY_AURA)) {
    const period = e.periodMs ?? 0;
    if (period <= 0 || durationMs <= 0) continue;
    const ticks = Math.floor(durationMs / period + 1e-9);
    if (e.aura === AURA_PERIODIC_DAMAGE || e.aura === AURA_PERIODIC_LEECH) {
      const total = script?.periodicTotalBonus?.({ ctx, spell, cp }) ?? null;
      if (total) lines.push({ label: spell.name, kind: "rule", text: total.text });
      const spPart = magic && e.spCoef ? e.spCoef * spTotal : 0;
      if (spPart)
        lines.push({ label: "Spell power", kind: "gear", text: `${r1(sp)} x ${e.spCoef} per tick` });
      const tick =
        effectValue(spell, e, ctx.level, mods) +
        (e.pointsPerCombo ?? 0) * cp +
        spPart +
        (total ? total.value / ticks : 0);
      const k =
        common *
        mods.mult(OP.PERIODIC) *
        (scriptMult?.value ?? 1) *
        mitigation(bleed || e.mechanic === MECHANIC_BLEED);
      parts.push({
        label: `${spell.name} (periodic)`,
        kind: "periodic",
        perHit: tick * k,
        count: ticks,
        chances,
        critMultiplier: critMult,
      });
    } else if (e.aura === AURA_PERIODIC_TRIGGER && e.triggerSpell) {
      const missile = ctx.book.spells.get(e.triggerSpell);
      const d = missile?.effects.find((x) => x.effect === EFFECT.SCHOOL_DAMAGE);
      if (!missile || !d) continue;
      const mm = collectMods(missile, ctx.mods, ctx.book.classSet);
      lines.push(...mm.lines);
      const mc = chancesFor(ctx, missile, null, mm);
      if (typeof mc === "string") return mc;
      const spPart = d.spCoef ? d.spCoef * spTotal : 0;
      const k = damageMultiplier(ctx, key, missile.school, null, []) * mm.mult(OP.DAMAGE) * mitigation(false);
      const v = d.variance ?? 0;
      const base = effectValue(missile, d, ctx.level, mm);
      parts.push({
        label: missile.name,
        kind: "direct",
        perHit: (base + spPart) * k,
        count: ticks,
        chances: mc,
        critMultiplier: 1 + mc.critBonus * mm.mult(OP.CRIT_DAMAGE),
        range: [(base * (1 - v / 2) + spPart) * k, (base * (1 + v / 2) + spPart) * k],
      });
    }
  }
  return parts;
}

const partExpected = (p: DamagePart) =>
  p.count * p.perHit * expectedFactor(p.chances, (p.critMultiplier - 1) / p.chances.critBonus);

/** Evaluates a rotation entry's ability (or a proc spell when `procSpell` is given) against the context's target. */
export function evaluateAbility(
  entry: Pick<RotationEntry, "ability" | "kind" | "cp">,
  ctx: DamageContext,
  procSpell?: Spell,
): AbilityEval {
  const key = entry.ability;
  let spell: Spell;
  if (procSpell) spell = procSpell;
  else {
    const l = learn(ctx.book, key, ctx.level, ctx.talents, ctx.classTalents);
    if ("reason" in l) return { key, available: false, reason: l.reason };
    spell = l.spell;
  }
  const kind = kindOf(spell);
  const script = SCRIPTS[key];
  const slot: AttackSlot | null =
    kind === "spell" ? null : (script?.slot ?? (kind === "ranged" ? "ranged" : "mainHand"));
  if (slot && ctx.form !== "cat") {
    if (!weaponInfo(ctx, slot))
      return {
        key,
        available: false,
        reason:
          slot === "offHand"
            ? "requires an off-hand weapon"
            : slot === "ranged"
              ? "requires a bow, gun, crossbow or thrown weapon"
              : "requires a melee weapon",
      };
    if (spell.equipped && !matchingSlots(spell.equipped, ctx.weapons).includes(slot))
      return { key, available: false, reason: describeRequirement(spell.equipped) };
  }
  const cp = entry.kind === "finisher" ? (entry.cp ?? 5) : 0;
  const mods = collectMods(spell, ctx.mods, ctx.book.classSet);
  const lines: SourceLine[] = [];
  const notes: string[] = [];

  // time
  const haste =
    kind === "ranged" ? ctx.stats.haste.ranged.value : kind === "spell" ? ctx.stats.haste.spell.value : 0;
  const rawCast = Math.max(
    0,
    ((Math.max(0, spell.castMs) + mods.flat(OP.CAST_TIME)) * mods.mult(OP.CAST_TIME)) / 1000,
  );
  const castTime = rawCast / (1 + haste / 100);
  const baseDurMs = script?.durationMs?.({ ctx, spell, cp }) ?? spell.duration?.ms ?? 0;
  const durationMs = Math.max(0, (Math.max(0, baseDurMs) + mods.flat(OP.DURATION)) * mods.mult(OP.DURATION));
  const channelTime = spell.channeled ? durationMs / 1000 : 0;
  const gcd = spell.gcdMs / 1000;
  const cdMod = (ms: number) =>
    ms > 0 ? Math.max(0, ((ms + mods.flat(OP.COOLDOWN)) * mods.mult(OP.COOLDOWN)) / 1000) : 0;
  const ownCd = cdMod(spell.cooldownMs);
  const catCd = cdMod(spell.categoryCooldownMs);
  const timeCost = procSpell ? 0 : Math.max(gcd, castTime, channelTime);

  // cost
  const c = spell.costs.find((x) => x.powerType in POWER);
  const power = c ? POWER[c.powerType]! : null;
  let cost = 0;
  if (c && !procSpell) {
    const raw = c.amount + (c.powerType === 0 ? (c.pct / 100) * ctx.book.baseMana : 0);
    const flat = mods.flat(OP.COST) / (c.powerType === 1 ? 10 : 1); // rage modifiers are in tenths
    cost = Math.max(0, (raw + flat) * mods.mult(OP.COST));
  }
  let energize = 0;
  let comboPoints = 0;
  for (const e of spell.effects) {
    if (e.effect !== EFFECT.ENERGIZE) continue;
    if (e.misc[0] === COMBO_POINTS) comboPoints += effectValue(spell, e, ctx.level, mods);
    else if (c && e.misc[0] === c.powerType) energize += effectValue(spell, e, ctx.level, mods);
  }

  // damage
  const sources = damageSources(ctx, spell, key, slot);
  if (typeof sources === "string") return { key, available: false, reason: sources };
  const parts: DamagePart[] = [];
  for (const src of sources) {
    const p = partsOf(ctx, src, key, cp, durationMs, lines);
    if (typeof p === "string") return { key, available: false, reason: p };
    parts.push(...p);
  }
  // combo points are awarded on a landed hit; an ability without damage (Slice and Dice) always "lands"
  const land = parts[0]?.chances.land ?? 100;
  comboPoints *= land / 100;
  const draft: AbilityDraft = {
    key,
    spell,
    kind,
    school: primarySchool(spell.school),
    schoolMask: spell.school,
    slot,
    finisher: entry.kind === "finisher",
    parts,
    extras: [],
    comboPoints,
    cpRefund: 0,
    sources: lines,
    notes,
  };
  for (const hook of ctx.abilityHooks) hook(draft, ctx);

  const direct = draft.parts.filter((p) => p.kind === "direct");
  const periodic = draft.parts.filter((p) => p.kind === "periodic");
  const expectedDirect = direct.reduce((a, p) => a + partExpected(p), 0);
  const expectedPeriodic = periodic.reduce((a, p) => a + partExpected(p), 0);
  const extra = draft.extras.reduce((a, x) => a + x.value, 0);
  const expected = expectedDirect + expectedPeriodic + extra;
  const hit =
    direct.reduce((a, p) => a + p.perHit * p.count, 0) / Math.max(1, direct.length ? direct[0]!.count : 1);
  const ref = draft.parts[0];
  const execute = timeCost > 0 ? timeCost : 1.5;
  const uniq = dedupe(lines);
  const result: AbilityResult = {
    key,
    available: true,
    spell,
    name: spell.name,
    rank: spell.rank,
    icon: spell.icon,
    school: draft.school,
    schoolMask: spell.school,
    kind,
    slot,
    castTime,
    channelTime,
    gcd,
    cooldown: Math.max(ownCd, catCd),
    category: catCd > 0 ? spell.category : 0,
    categoryCooldown: catCd,
    timeCost,
    power,
    cost,
    energize,
    comboPoints: draft.comboPoints,
    cpRefund: draft.cpRefund,
    hitChance: land,
    critChance: ref ? Math.min(100, ref.chances.crit) : 0,
    critMultiplier: ref ? ref.critMultiplier : 1,
    hit: direct.length ? hit : 0,
    hitRange: direct.length === 1 && direct[0]!.count === 1 && direct[0]!.range ? direct[0]!.range : null,
    crit: direct.length ? hit * direct[0]!.critMultiplier : 0,
    tick: periodic[0]?.perHit ?? 0,
    ticks: periodic[0]?.count ?? (direct[0] && direct[0].count > 1 ? direct[0].count : 0),
    periodSec: (spell.effects.find((e) => (e.periodMs ?? 0) > 0)?.periodMs ?? 0) / 1000,
    durationSec: durationMs / 1000,
    expectedDirect,
    expectedPeriodic,
    extras: draft.extras,
    expected,
    dpct: expected / execute,
    sources: uniq,
    notes: draft.notes,
  };
  return result;
}

function dedupe(lines: SourceLine[]): SourceLine[] {
  const seen = new Set<string>();
  return lines.filter((l) => {
    const k = `${l.label}|${l.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** White melee or Auto Shot of one slot (section 6.5). `extraAp` = Windfury attack power bonus. */
export function evaluateWhite(ctx: DamageContext, slot: AttackSlot, extraAp = 0): WhiteResult | null {
  const w = weaponInfo(ctx, slot);
  const o = ctx.view[slot];
  if (!w || !o) return null;
  const skill = ctx.stats.weaponSkill[slot]?.value ?? ctx.level * 5;
  const t = whiteTable(o, slot, skill, ctx.view.level);
  const mult = damageMultiplier(ctx, slot === "ranged" ? "Auto Shot" : "Melee", 1, slot, []);
  const normalHit =
    (w.perSwing + (extraAp / AP_PER_DPS) * w.speed) *
    w.factor *
    mult *
    armorFactor(ctx.view, "physical", false);
  const haste = ctx.effects.reduce((a, fx) => a * (1 + (fx.meleeHastePct ?? 0) / 100), 1);
  const speed = slot === "ranged" ? w.hastedSpeed : w.hastedSpeed / haste;
  const expectedPerSwing = normalHit * t.factor;
  return {
    slot,
    name: slot === "ranged" ? "Auto Shot" : slot === "offHand" ? "Off-hand melee" : "Main-hand melee",
    speed,
    normalHit,
    expectedPerSwing,
    hitChance: 100 - t.miss - t.dodge,
    critChance: t.crit,
    glancing: t.glancing,
    glancingMultiplier: t.glancingMultiplier,
    dps: expectedPerSwing / speed,
  };
}
```

`src/engine/abilities/index.ts` (exact):

```ts
export * from "./types";
export * from "./spellbook";
export * from "./mods";
export * from "./evaluate";
```

### 6.9 Code: `src/engine/rotation/` (exact)

`src/engine/rotation/types.ts` (exact):

```ts
import type { AttackSlot, RotationEntry, SpecRotation } from "@/data/types";
import type { AbilityResult, PowerKind, WhiteResult } from "@/engine/abilities";

export type CastLimit = "cooldown" | "duration" | "time" | "resource" | "swings" | "procs" | "builder";

/** Casts per minute of one ability and its damage. */
export interface CastLine {
  key: string;
  entry: RotationEntry | null; // null for procs
  ability: AbilityResult;
  perMinute: number;
  damagePerMinute: number;
  dps: number;
  limit: CastLimit;
}
export interface WhiteLine {
  white: WhiteResult;
  swingsPerMinute: number; // white swings that happen (main hand: minus Heroic Strike swings)
  dps: number;
}
export interface RotationResult {
  rotation: SpecRotation;
  power: PowerKind | null;
  casts: CastLine[];
  white: Partial<Record<AttackSlot, WhiteLine>>;
  extras: { label: string; dps: number }[];
  dps: number;
  timeUsedPct: number; // share of the minute spent on GCDs, casts and channels
  resource: { power: PowerKind; incomePerMinute: number; spentPerMinute: number } | null;
  manaPerSecond: number; // mana spent per second (0 for rage/energy rotations)
  oomSeconds: number | null; // seconds until out of mana from full, ignoring regeneration; null if no mana is spent
  skipped: { ability: string; reason: string }[];
}
```

`src/engine/rotation/analytical.ts` (exact):

```ts
import type { RotationEntry, SpecRotation, Spell } from "@/data/types";
import {
  evaluateAbility,
  evaluateWhite,
  type AbilityEval,
  type AbilityResult,
  type DamageContext,
  type PowerKind,
  type WhiteResult,
} from "@/engine/abilities";
import {
  ENERGY_PER_SECOND,
  RAGE_PER_DAMAGE_FACTOR,
  SEAL_OF_COMMAND_PPM,
  WINDFURY,
  rageConversion,
} from "@/engine/combat";
import type { CastLimit, CastLine, RotationResult, WhiteLine } from "./types";

const MINUTE = 60;

export interface RotationInput {
  rotation: SpecRotation;
  evals: { entry: RotationEntry; ability: AbilityEval }[];
  white: { mainHand: WhiteResult | null; offHand: WhiteResult | null; ranged: WhiteResult | null };
  ctx: DamageContext;
  talentRank(name: string): number;
}

/** Resource the rotation spends: rage (warrior), energy (rogue, Cat Form), else mana. */
function powerOf(input: RotationInput): PowerKind | null {
  const first = input.evals.find((e) => e.ability.available && (e.ability as AbilityResult).power);
  return first ? ((first.ability as AbilityResult).power ?? null) : null;
}

const ragePerSwing = (w: WhiteResult, level: number) =>
  (RAGE_PER_DAMAGE_FACTOR * w.expectedPerSwing) / rageConversion(level);

/**
 * Analytical priority model (section 6.6): per minute, each entry in priority order takes
 * n = min(cap, time left / time per cast, resource left / cost per cast) casts, where cap comes from the cooldown,
 * shared category cooldown, DoT/buff duration or `everySec`. Finishers are bought as cycles with their builder casts.
 * On-next-swing attacks use the resource left at the end and replace main-hand swings. Mana never limits casts.
 */
export function runRotation(input: RotationInput): RotationResult {
  const { rotation, ctx } = input;
  const power = powerOf(input);
  const limited = power === "rage" || power === "energy" || power === "focus";
  const skipped: { ability: string; reason: string }[] = [];
  const casts: CastLine[] = [];
  const effects = ctx.effects;

  const mh = rotation.melee ? input.white.mainHand : null;
  const oh = rotation.melee ? input.white.offHand : null;
  const ranged = rotation.autoShot ? input.white.ranged : null;
  let income = 0;
  if (power === "energy") income = ENERGY_PER_SECOND * MINUTE;
  if (power === "rage") {
    for (const w of [mh, oh]) if (w) income += (MINUTE / w.speed) * ragePerSwing(w, ctx.level);
    income += effects.reduce((a, fx) => a + (fx.ragePerMinute ?? 0), 0);
  }
  let resource = limited ? income : Infinity;
  let time = MINUTE;
  let spent = 0;
  const categoryTime = new Map<number, number>();
  const available = new Set(input.evals.filter((e) => e.ability.available).map((e) => e.entry.ability));

  const builders = input.evals.filter((e) => e.entry.kind === "builder" && e.ability.available);
  const builder = builders[0]?.ability as AbilityResult | undefined;
  let builderCasts = 0;

  const push = (entry: RotationEntry | null, a: AbilityResult, n: number, limit: CastLimit) => {
    const dotCap = a.durationSec > 0 ? MINUTE / a.durationSec : Infinity;
    const dmg =
      n * (a.expectedDirect + a.extras.reduce((s, x) => s + x.value, 0)) +
      Math.min(n, dotCap) * a.expectedPeriodic;
    casts.push({
      key: a.key,
      entry,
      ability: a,
      perMinute: n,
      damagePerMinute: dmg,
      dps: dmg / MINUTE,
      limit,
    });
  };

  // Resource generators (net cost < 0, e.g. Shank +25 energy for 5) go first so their resource is pooled.
  const generates = (e: RotationInput["evals"][number]) =>
    limited && e.ability.available && e.ability.power === power && e.ability.cost - e.ability.energize < 0;
  const ordered = [...input.evals.filter(generates), ...input.evals.filter((e) => !generates(e))];
  for (const { entry, ability } of ordered) {
    if (entry.kind === "nextSwing") continue;
    if (!ability.available) {
      skipped.push({ ability: entry.ability, reason: ability.reason });
      continue;
    }
    if (entry.requiresTalent && input.talentRank(entry.requiresTalent) === 0) {
      skipped.push({ ability: entry.ability, reason: `needs the talent ${entry.requiresTalent}` });
      continue;
    }
    if (entry.requires && !available.has(entry.requires)) {
      skipped.push({ ability: entry.ability, reason: `needs ${entry.requires}` });
      continue;
    }
    if (entry.kind === "builder") {
      if (ability !== builder)
        skipped.push({ ability: entry.ability, reason: `${builder?.key} is the builder` });
      continue;
    }
    const a = ability;
    let t = a.timeCost;
    let cost = (a.power === power ? a.cost - a.energize : 0) * (limited ? 1 : 0);
    let k = 0;
    let cap = a.cooldown > 0 ? MINUTE / a.cooldown : Infinity;
    let limit: CastLimit = "cooldown";
    if (entry.kind === "dot" && a.durationSec > 0) {
      if (MINUTE / a.durationSec < cap) limit = "duration";
      cap = Math.min(cap, MINUTE / a.durationSec);
    }
    if (entry.kind === "maintain") {
      const every = entry.everySec ?? a.durationSec;
      if (every > 0) {
        cap = Math.min(cap, MINUTE / every);
        limit = "duration";
      }
    }
    if (entry.kind === "finisher") {
      if (!builder || builder.comboPoints <= 0) {
        skipped.push({ ability: entry.ability, reason: "no combo point builder" });
        continue;
      }
      k = Math.max(0, (entry.cp ?? 5) - a.cpRefund) / builder.comboPoints;
      t += k * builder.timeCost;
      cost += k * (builder.power === power && limited ? builder.cost - builder.energize : 0);
      if (entry.buff || a.expectedPeriodic > 0) {
        cap = a.durationSec > 0 ? MINUTE / a.durationSec : Infinity;
        limit = "duration";
      } else cap = Infinity;
    }
    if (a.category && a.categoryCooldown > 0) {
      const left = categoryTime.get(a.category) ?? MINUTE;
      cap = Math.min(cap, left / a.categoryCooldown);
    }
    let n = cap;
    if (t > 0 && time / t < n) {
      n = time / t;
      limit = "time";
    }
    if (cost > 0 && resource / cost < n) {
      n = resource / cost;
      limit = "resource";
    }
    if (!Number.isFinite(n)) {
      skipped.push({ ability: entry.ability, reason: "no cooldown, cast time or cost: not modeled" });
      continue;
    }
    n = Math.max(0, n);
    time -= n * t;
    resource -= n * cost;
    if (a.power === "mana" || (a.power === power && cost > 0)) spent += n * (a.cost - a.energize);
    if (a.category && a.categoryCooldown > 0)
      categoryTime.set(a.category, (categoryTime.get(a.category) ?? MINUTE) - n * a.categoryCooldown);
    push(entry, a, n, limit);
    if (k > 0 && builder) {
      builderCasts += n * k;
      if (builder.power === "mana") spent += n * k * builder.cost;
    }
  }
  if (builder && builderCasts > 0) {
    const entry = builders[0]!.entry;
    push(entry, builder, builderCasts, "builder");
  }

  // on-next-swing attacks (Heroic Strike): leftover resource; each replaces a main-hand swing (which gives no rage)
  let mhSwings = mh ? MINUTE / mh.speed : 0;
  for (const { entry, ability } of input.evals) {
    if (entry.kind !== "nextSwing") continue;
    if (!ability.available) {
      skipped.push({ ability: entry.ability, reason: ability.reason });
      continue;
    }
    if (!mh) {
      skipped.push({ ability: entry.ability, reason: "needs white main-hand swings" });
      continue;
    }
    const a = ability;
    const lost = power === "rage" ? ragePerSwing(mh, ctx.level) : 0;
    let n = Math.min(mhSwings, a.cooldown > 0 ? MINUTE / a.cooldown : Infinity);
    let limit: CastLimit = "swings";
    const per = (a.power === power ? a.cost : 0) + lost;
    if (limited && per > 0 && resource / per < n) {
      n = Math.max(0, resource / per);
      limit = "resource";
    }
    resource -= n * per;
    if (a.power === power) spent += n * a.cost;
    if (a.power === "mana") spent += n * a.cost;
    mhSwings -= n;
    push(entry, a, n, limit);
  }

  // white damage
  const white: RotationResult["white"] = {};
  const castTime = casts.reduce((s, c) => s + c.perMinute * (c.ability.castTime + c.ability.channelTime), 0);
  if (mh) white.mainHand = line(mh, mhSwings);
  if (oh) white.offHand = line(oh, MINUTE / oh.speed);
  if (ranged) white.ranged = line(ranged, (MINUTE / ranged.speed) * Math.max(0, 1 - castTime / MINUTE));

  // self-buff procs (section 6.7): Seal of Command (melee auto attacks, 7 PPM)
  const extras: { label: string; dps: number }[] = [];

  const soc = ctx.selfBuffs.find((s) => s.name === "Seal of Command");
  if (soc && white.mainHand) procLine(soc, white.mainHand, casts, ctx);
  // Windfury Weapon: extra main-hand attacks with bonus attack power
  const wf = ctx.selfBuffs.some((s) => s.name === "Windfury Weapon");
  const wfWhite = wf && white.mainHand ? evaluateWhite(ctx, "mainHand", WINDFURY.attackPower) : null;
  if (wfWhite && white.mainHand) {
    const procs = (white.mainHand.swingsPerMinute * white.mainHand.white.hitChance * WINDFURY.chance) / 10000;
    extras.push({
      label: "Windfury Weapon",
      dps: (procs * WINDFURY.attacks * wfWhite.expectedPerSwing) / MINUTE,
    });
  }
  for (const fx of effects) if (fx.extraDps) extras.push({ label: fx.label, dps: fx.extraDps });

  const whiteDps = Object.values(white).reduce((s, w) => s + (w?.dps ?? 0), 0);
  const dps = casts.reduce((s, c) => s + c.dps, 0) + whiteDps + extras.reduce((s, x) => s + x.dps, 0);
  const manaPerSecond = power === "mana" || !limited ? spent / MINUTE : 0;
  const mana = ctx.stats.mana?.value ?? 0;
  return {
    rotation,
    power,
    casts,
    white,
    extras,
    dps,
    timeUsedPct: ((MINUTE - time) / MINUTE) * 100,
    resource: limited && power ? { power, incomePerMinute: income, spentPerMinute: income - resource } : null,
    manaPerSecond,
    oomSeconds: manaPerSecond > 0 && mana > 0 ? mana / manaPerSecond : null,
    skipped,
  };
}

function line(w: WhiteResult, swings: number): WhiteLine {
  return { white: w, swingsPerMinute: swings, dps: (swings * w.expectedPerSwing) / MINUTE };
}

/** Seal of Command: the proc spell (aura 42 trigger) on landed main-hand auto attacks at SEAL_OF_COMMAND_PPM. */
function procLine(seal: Spell, mh: WhiteLine, casts: CastLine[], ctx: DamageContext): void {
  const id = seal.effects.find((e) => e.effect === 6 && e.aura === 42)?.triggerSpell;
  const proc = id ? ctx.book.spells.get(id) : undefined;
  if (!proc) return;
  const a = evaluateAbility({ ability: "Seal of Command (proc)", kind: "cooldown" }, ctx, proc);
  if (!a.available) return;
  const speed = ctx.stats.weapons.mainHand?.speed ?? 0;
  const perMinute =
    mh.swingsPerMinute * (mh.white.hitChance / 100) * ((SEAL_OF_COMMAND_PPM * speed) / MINUTE);
  const dmg = perMinute * a.expected;
  casts.push({
    key: a.key,
    entry: null,
    ability: a,
    perMinute,
    damagePerMinute: dmg,
    dps: dmg / MINUTE,
    limit: "procs",
  });
}

/** Evaluates every entry of a rotation (unavailable entries keep their reason). */
export function evaluateEntries(rotation: SpecRotation, ctx: DamageContext): RotationInput["evals"] {
  return rotation.entries.map((entry) => ({ entry, ability: evaluateAbility(entry, ctx) }));
}
```

`src/engine/rotation/selfBuffs.ts` (exact):

```ts
import type { ClassToken, RotationsFile, SpecRotation, Spell, Talent } from "@/data/types";
import { learn, type Spellbook } from "@/engine/abilities";
import { mapAura, type RankedTalent, type SourcedEffect } from "@/engine/stats";

const TARGET_CASTER = 1;
/** Hunter's Mark: "increasing the Ranged Attack Power of all attackers against that target" (target aura). [VERIFY] */
const AURA_RANGED_AP_ATTACKER_BONUS = 127;

/** Default rotation: the spec with the most points (ties and 0 points: the first "dps" spec among the tied). */
export function pickRotation(
  file: RotationsFile,
  token: ClassToken,
  specPoints: readonly number[],
): SpecRotation {
  const list = file.rotations.filter((r) => r.class === token).sort((a, b) => a.spec - b.spec);
  const max = Math.max(...specPoints);
  const top = list.filter((r) => (specPoints[r.spec] ?? 0) === max);
  const pick = top.length === 1 ? top[0] : (top.find((r) => r.role === "dps") ?? top[0]);
  if (!pick) throw new Error(`no rotation for ${token}`);
  return pick;
}

/** Learned spells of the rotation's self-buffs and `buff: true` entries (Slice and Dice). */
export function selfBuffSpells(
  book: Spellbook,
  rotation: SpecRotation,
  level: number,
  talents: readonly RankedTalent[],
  classTalents: readonly Talent[],
): Spell[] {
  const names = [...rotation.selfBuffs, ...rotation.entries.filter((e) => e.buff).map((e) => e.ability)];
  return names.flatMap((n) => {
    const l = learn(book, n, level, talents, classTalents);
    return "spell" in l ? [l.spell] : [];
  });
}

/**
 * Stat effects of self-buff spells (assumed 100% uptime): caster auras through the talent mapper's `mapAura`
 * (Aspect of the Hawk 124, Slice and Dice 319, Shadowform 79), plus Hunter's Mark (aura 127, on the target).
 */
export function selfBuffEffects(spells: readonly Spell[]): SourcedEffect[] {
  const out: SourcedEffect[] = [];
  for (const s of spells)
    for (const e of s.effects) {
      if (e.effect !== 6) continue;
      if (e.aura === AURA_RANGED_AP_ATTACKER_BONUS) {
        out.push({ key: "rangedAttackPower", value: e.base, label: s.name, kind: "buff" });
        continue;
      }
      if (e.targets && e.targets[0] !== TARGET_CASTER) continue;
      const m = mapAura(e, e.base);
      if (m.kind === "stat" || m.kind === "damageDone")
        for (const se of m.effects) out.push({ ...se, label: s.name, kind: "buff" });
    }
  return out;
}
```

`src/engine/rotation/prepare.ts` (exact):

```ts
import type { ClassSpellFile, SpecRotation, Spell, Talent } from "@/data/types";
import { buildSpellbook, type Spellbook } from "@/engine/abilities";
import { CAT_FORM, formMask } from "@/engine/combat";
import {
  assemble,
  computeCharacter,
  type AssembleArgs,
  type Assembled,
  type CharacterStats,
  type SourcedEffect,
} from "@/engine/stats";
import { activeHandlers, type ActiveHandler } from "@/engine/talents/special";
import { selfBuffEffects, selfBuffSpells } from "./selfBuffs";

export interface PrepareArgs extends Omit<AssembleArgs, "extraEffects" | "formMask"> {
  spells: ClassSpellFile;
  spellClassSet: number; // ClassInfo.spellClassSet
  classTalents: readonly Talent[];
  rotation: SpecRotation;
}
export interface Prepared {
  assembled: Assembled;
  stats: CharacterStats;
  book: Spellbook;
  selfBuffs: Spell[];
  handlers: ActiveHandler[];
}

/**
 * Character stats for a rotation (section 6.2): the rotation's form activates form-only talents, its self-buffs add
 * their caster auras, and talent handlers add static stat effects (Weaponmaster, Predatory Strikes).
 */
export function prepareDamage(a: PrepareArgs): Prepared {
  const cls = a.classToken.toUpperCase() as Uppercase<typeof a.classToken>;
  const book = buildSpellbook(a.spells, a.spellClassSet, a.baseStats.classes[cls]?.mana ?? 0);
  const form = a.rotation.form ?? null;
  const mask = formMask(form);
  const selfBuffs = selfBuffSpells(book, a.rotation, a.level, a.talents, a.classTalents);
  const handlers = activeHandlers(a.talents, mask);
  const extra: SourcedEffect[] = [
    // src: vmangos (Classic 1.12): Cat Form attack power = 2 Str + Agi - 20 (+ Predatory Strikes) [VERIFY Q55]
    ...(form === "cat"
      ? [
          {
            key: "attackPowerFromStat" as const,
            stat: "agi" as const,
            value: CAT_FORM.apPerAgi * 100,
            label: "Cat Form",
            kind: "rule" as const,
          },
        ]
      : []),
    ...selfBuffEffects(selfBuffs),
    ...handlers.flatMap((h) => h.handler.stats?.(h.args, { weapons: a.weapons, form, level: a.level }) ?? []),
  ];
  const assembled = assemble({ ...a, extraEffects: extra, formMask: mask });
  return { assembled, stats: computeCharacter(assembled.input), book, selfBuffs, handlers };
}
```

`src/engine/rotation/evaluate.ts` (exact):

```ts
import type { SpecRotation, Spell, Talent } from "@/data/types";
import {
  buffModSources,
  evaluateWhite,
  talentModSources,
  type AbilityEval,
  type DamageContext,
  type RotationEffect,
  type Spellbook,
} from "@/engine/abilities";
import type { CharacterStats, EquippedWeapons, RankedTalent, SpellMod, TargetView } from "@/engine/stats";
import { rotationEffects, type ActiveHandler } from "@/engine/talents/special";
import { evaluateEntries, runRotation } from "./analytical";
import type { RotationResult } from "./types";

export interface DamageInput {
  level: number;
  stats: CharacterStats;
  view: TargetView;
  book: Spellbook;
  weapons: EquippedWeapons;
  rotation: SpecRotation;
  talents: readonly RankedTalent[];
  classTalents: readonly Talent[];
  spellMods: readonly SpellMod[];
  selfBuffs: readonly Spell[];
  handlers: readonly ActiveHandler[];
}
export interface DamageResult {
  rotation: RotationResult;
  abilities: AbilityEval[]; // rotation entries in order (pass 2), unavailable ones with their reason
  effects: RotationEffect[]; // uptime effects applied in pass 2
}

/**
 * Two passes (section 6.8): pass 1 without uptime effects gives casts and crits per minute; the talent handlers turn
 * them into uptime effects (Flurry haste, Improved Shadow Bolt, Deep Wounds, extra rage ...); pass 2 recomputes
 * everything with those effects. Pure and deterministic.
 */
export function evaluateDamage(input: DamageInput): DamageResult {
  const base: DamageContext = {
    level: input.level,
    stats: input.stats,
    view: input.view,
    book: input.book,
    weapons: input.weapons,
    form: input.rotation.form ?? null,
    talents: input.talents,
    classTalents: input.classTalents,
    mods: [...talentModSources(input.spellMods, input.talents), ...buffModSources(input.selfBuffs)],
    selfBuffs: input.selfBuffs,
    effects: [],
    rotationAbilities: new Set(),
    abilityHooks: input.handlers.flatMap((h) => (h.handler.ability ? [h.handler.ability(h.args)] : [])),
  };
  const pass = (ctx: DamageContext) => {
    const evals = evaluateEntries(input.rotation, ctx);
    const learned = new Set(evals.filter((e) => e.ability.available).map((e) => e.entry.ability));
    const ctx2 = { ...ctx, rotationAbilities: learned };
    const evals2 =
      learned.size === ctx.rotationAbilities.size ? evals : evaluateEntries(input.rotation, ctx2);
    const white = {
      mainHand: input.rotation.melee ? evaluateWhite(ctx2, "mainHand") : null,
      offHand: input.rotation.melee && ctx2.form !== "cat" ? evaluateWhite(ctx2, "offHand") : null,
      ranged: input.rotation.autoShot ? evaluateWhite(ctx2, "ranged") : null,
    };
    const talentRank = (name: string) => input.talents.find((t) => t.talent.name === name)?.rank ?? 0;
    return {
      ctx: ctx2,
      evals: evals2,
      rotation: runRotation({ rotation: input.rotation, evals: evals2, white, ctx: ctx2, talentRank }),
    };
  };
  const p1 = pass(base);
  const effects = rotationEffects(input.handlers, p1.rotation, p1.ctx);
  const p2 = pass({ ...p1.ctx, effects });
  return { rotation: p2.rotation, abilities: p2.evals.map((e) => e.ability), effects };
}
```

`src/engine/rotation/index.ts` (exact):

```ts
export * from "./types";
export * from "./analytical";
export * from "./selfBuffs";
export * from "./evaluate";
export * from "./prepare";
```

---

## 7. Talent special handlers (task T7)

### 7.1 Interface

`stats(h, env)` returns `SourcedEffect`s added before `computeCharacter`; `ability(h)` returns a hook that edits the
`AbilityDraft` before the expected damage is summed; `rotation(h, pass1, ctx)` returns `RotationEffect`s for pass 2.
`h.values` = `ranks[rank-1].values` (never hard-code Classic values). A talent with a handler is removed from the
"not modeled" note (`derived.ts`).

### 7.2 Handlers (22)

| Talent (spell id) | Hook | Model |
|---|---|---|
| Ignite (11119) | ability | Fire spell crits: + values[0]% of the expected crit damage (no rolling/munching) |
| Fire Power (11124) | rotation | + values[0]% Fire damage x number of Fire effects (Fireball/Pyroblast DoT uptimes, Ignite uptime from crits/4 s, Fire Vulnerability), max 4 |
| Improved Scorch (11095) | rotation | Scorch in the rotation: Fire damage + 3% x 5 stacks (spell 22959) x chance |
| Improved Shadow Bolt (17793) | rotation | Shadow damage + values[0]% x uptime (Shadow Bolt crits, 12 s) |
| Shadow Weaving (15257) | rotation | Shadow damage + 2% x min(5, applications per 15 s) (spell 15258) |
| Shadow and Flame (426316) | rotation | Shadow damage + values[0]% x min(1, Conflagrates x 20 s / 60) |
| Lightning Overload (408438) | ability | LB/CL: + direct expected x values[0]% x 50% |
| Improved Mind Flay (1225139) | ability | ticks x mean of (1 + v%)^i |
| Flurry (12319 warrior, 16256 shaman) | rotation | melee haste + values[0]% x (1 - (1 - white crit)^3) |
| Unbridled Wrath (12322) | rotation | + 1 rage x values[0]% per landed weapon hit |
| Anger Management (12296) | rotation | + values[1] rage every values[2] s |
| Dual Wield Specialization (23584) | rotation | off-hand rage x values[1]% |
| Deep Wounds (12834) | rotation | extra dps = uptime(melee crits, 12 s) x values[0]% x MH perSwing / 12 x physical aura 79 |
| Improved Whirlwind (1310315) | ability | Whirlwind x (1 + values[1]%) |
| Weaponmaster (1290261) | stats + rotation | axe/polearm crit values[0], mace/staff armor pen values[1], sword extra attacks values[2]% of MH hits |
| Hack and Slash (13960) | stats + rotation | axe/sword extra attacks values[0], mace armor values[1], dagger/fist crit values[2] |
| Seal Fate (14186) | ability | builders: + land x crit x values[0]% combo points |
| Ruthlessness (14156) | ability | finishers refund values[0]% of a combo point |
| Nightfall (18094) | rotation | Corruption/Drain ticks x values[0]% free Shadow Bolts (extra dps) |
| Predatory Strikes (16972) | stats | Cat/Bear Form: + values[0]% x level melee AP |
| Lone Wolf (415370) | none | marker: its aura 79 (+20%) applies generically; no pets until Phase 6 |

Not modeled (stay in the note), with the reason: clearcasting and mana refunds (Arcane Concentration, Elemental
Focus, Master of Elements, Illumination - mana is not limiting), cooldown abilities (Combustion, Death Wish, Arcane
Power, Power Infusion, Bestial Wrath, Rapid Fire, Blade Flurry, Adrenaline Rush, Lightning Mastery, Presence of Mind,
Cold Snap), frozen-target talents (Shatter, Fingers of Frost, Winter's Chill), proc/condition talents (Heating Up,
Missile Barrage, Eclipse, Nature's Grace, Elemental Devastation, Maelstrom Weapon, Improved Stormstrike, Enrage,
Vengeance, Bloodthrill, Expose Prey, Puncturing Wounds' extra cp, Rend and Tear, Soul Siphon, Decimation, Wrack,
Death Mark, Venom), poisons, pets (Phase 6), shields (Q46).

### 7.3 Code (exact)

`src/engine/talents/special/types.ts` (exact):

```ts
import type { ShapeshiftForm, Talent } from "@/data/types";
import type { AbilityHook, DamageContext, RotationEffect } from "@/engine/abilities";
import type { EquippedWeapons, SourcedEffect } from "@/engine/stats";
import type { RotationResult } from "@/engine/rotation/types";

/** A talent rank as seen by its handler: values = ranks[rank-1].values (parallel to talent.effects). */
export interface HandlerArgs {
  talent: Talent;
  rank: number;
  values: readonly number[];
  label: string; // "Ignite 5/5"
}
export interface StatEnv {
  weapons: EquippedWeapons;
  form: ShapeshiftForm | null;
  level: number;
}

/**
 * Hand-written behavior of a DUMMY/proc talent, keyed by its talent spell id (ARCHITECTURE "special/").
 * stats: static stat effects before computeCharacter; ability: per-cast change; rotation: uptime effects from pass 1.
 */
export interface SpecialHandler {
  spellId: number;
  name: string;
  modeled: string; // one line for the UI: what the handler models
  stats?(h: HandlerArgs, env: StatEnv): SourcedEffect[];
  ability?(h: HandlerArgs): AbilityHook;
  rotation?(h: HandlerArgs, r: RotationResult, ctx: DamageContext): RotationEffect[];
}
export interface ActiveHandler {
  handler: SpecialHandler;
  args: HandlerArgs;
}
```

`src/engine/talents/special/handlers.ts` (exact):

```ts
import type { AttackSlot, School } from "@/data/types";
import {
  evaluateAbility,
  weaponInfo,
  type AbilityDraft,
  type AbilityResult,
  type DamageContext,
  type RotationEffect,
} from "@/engine/abilities";
import { RAGE_PER_DAMAGE_FACTOR, expectedFactor, rageConversion, schoolsOf } from "@/engine/combat";
import type { RankedTalent, SourcedEffect } from "@/engine/stats";
import type { RotationResult } from "@/engine/rotation/types";
import type { ActiveHandler, HandlerArgs, SpecialHandler } from "./types";

const MINUTE = 60;
const v = (h: HandlerArgs, i: number) => h.values[i] ?? 0;
const hasSchool = (a: { schoolMask: number }, s: School) => schoolsOf(a.schoolMask).includes(s);
/** Probability that at least one event of a Poisson stream of `perMinute` happens in `seconds`. */
const uptime = (perMinute: number, seconds: number) => 1 - Math.exp((-perMinute * seconds) / MINUTE);
const landed = (a: AbilityResult) => a.hitChance / 100;
const critOfLanded = (a: AbilityResult) => a.critChance / 100;

/** Weapon subclasses (Item.SubclassID). */
const AXE = [0, 1];
const MACE = [4, 5];
const SWORD = [7, 8];
const POLEARM = [6];
const STAFF = [10];
const FIST = [13];
const DAGGER = [15];

/** Landed weapon hits per minute: white swings and melee abilities (main hand only when `mhOnly`). */
function weaponHitsPerMinute(r: RotationResult, mhOnly: boolean): number {
  let n = 0;
  for (const slot of ["mainHand", "offHand"] as AttackSlot[]) {
    const w = r.white[slot];
    if (w && (!mhOnly || slot === "mainHand")) n += (w.swingsPerMinute * w.white.hitChance) / 100;
  }
  for (const c of r.casts)
    if (c.ability.kind === "melee" && (!mhOnly || c.ability.slot === "mainHand"))
      n += c.perMinute * landed(c.ability);
  return n;
}
function meleeCritsPerMinute(r: RotationResult): number {
  let n = 0;
  for (const slot of ["mainHand", "offHand"] as AttackSlot[]) {
    const w = r.white[slot];
    if (w) n += (w.swingsPerMinute * w.white.critChance) / 100;
  }
  for (const c of r.casts)
    if (c.ability.kind === "melee") n += c.perMinute * landed(c.ability) * critOfLanded(c.ability);
  return n;
}
const castsOf = (r: RotationResult, name: string) => r.casts.filter((c) => c.ability.name === name);

const HANDLERS: SpecialHandler[] = [
  {
    spellId: 11119,
    name: "Ignite",
    modeled: "Fire crits add a burn of x% of the crit damage (no rolling, no munching).",
    ability: (h) => (d) => {
      if (d.kind !== "spell" || !hasSchool(d, "fire")) return;
      const pct = v(h, 0) / 100;
      let value = 0;
      for (const p of d.parts.filter((x) => x.kind === "direct"))
        value +=
          p.count *
          p.perHit *
          (p.chances.land / 100) *
          (Math.min(100, p.chances.crit) / 100) *
          p.critMultiplier *
          pct;
      if (value > 0) {
        d.extras.push({ label: h.label, value });
        d.sources.push({ label: h.label, kind: "talent", text: `crits burn for ${v(h, 0)}% more over 4 s` });
      }
    },
  },
  {
    spellId: 11124,
    name: "Fire Power",
    modeled:
      "+x% Fire damage per Fire effect on the target (Fireball/Pyroblast DoTs, Ignite, Fire Vulnerability), up to 4.",
    rotation: (h, r, ctx) => {
      let effects = 0;
      for (const c of r.casts)
        if (hasSchool(c.ability, "fire") && c.ability.schoolMask === 4 && c.ability.expectedPeriodic > 0)
          effects += Math.min(1, (c.perMinute * c.ability.durationSec) / MINUTE);
      if (ctx.talents.some((t) => t.talent.spellId === 11119 && t.rank > 0)) {
        const crits = r.casts
          .filter(
            (c) => c.ability.schoolMask === 4 && c.ability.kind === "spell" && c.ability.expectedDirect > 0,
          )
          .reduce((a, c) => a + c.perMinute * landed(c.ability) * critOfLanded(c.ability), 0);
        effects += uptime(crits, 4);
      }
      if (
        castsOf(r, "Scorch").some((c) => c.perMinute > 0) &&
        ctx.talents.some((t) => t.talent.spellId === 11095 && t.rank > 0)
      )
        effects += 1;
      const pct = v(h, 0) * Math.min(4, effects);
      return pct > 0 ? [{ label: h.label, damagePct: { schools: ["fire"], pct } }] : [];
    },
  },
  {
    spellId: 11095,
    name: "Improved Scorch",
    modeled:
      "Scorch keeps Fire Vulnerability (3% x 5 stacks, from spell data) on the target while it is in the rotation.",
    rotation: (h, r, ctx) => {
      if (!castsOf(r, "Scorch").some((c) => c.perMinute > 0)) return [];
      const fv = [...ctx.book.spells.values()].find((s) => s.name === "Fire Vulnerability");
      const per = fv?.effects.find((e) => e.aura === 270)?.base ?? 0;
      const pct = per * (fv?.maxStacks || 1) * (v(h, 0) / 100);
      return pct > 0 ? [{ label: h.label, damagePct: { schools: ["fire"], pct } }] : [];
    },
  },
  {
    spellId: 17793,
    name: "Improved Shadow Bolt",
    modeled: "Shadow Bolt crits: +x% Shadow damage taken for 12 s (average uptime).",
    rotation: (h, r) => {
      const crits = castsOf(r, "Shadow Bolt").reduce(
        (a, c) => a + c.perMinute * landed(c.ability) * critOfLanded(c.ability),
        0,
      );
      const pct = v(h, 0) * uptime(crits, 12);
      return pct > 0 ? [{ label: h.label, damagePct: { schools: ["shadow"], pct } }] : [];
    },
  },
  {
    spellId: 15257,
    name: "Shadow Weaving",
    modeled:
      "Shadow casts stack +2% Shadow damage taken (5 stacks, 15 s) at the talent's chance; steady-state stacks.",
    rotation: (h, r, ctx) => {
      const sw = [...ctx.book.spells.values()].find(
        (s) => s.name === "Shadow Weaving" && s.sources.includes("triggered"),
      );
      const per = sw?.effects.find((e) => e.aura === 270)?.base ?? 0;
      const max = sw?.maxStacks || 1;
      const apps = r.casts
        .filter((c) => hasSchool(c.ability, "shadow"))
        .reduce((a, c) => a + c.perMinute * landed(c.ability) * (v(h, 0) / 100), 0);
      const pct = per * Math.min(max, (apps * 15) / MINUTE);
      return pct > 0 ? [{ label: h.label, damagePct: { schools: ["shadow"], pct } }] : [];
    },
  },
  {
    spellId: 426316,
    name: "Shadow and Flame",
    modeled:
      "Conflagrate: +x% Shadow damage for 20 s (average uptime); Conflagrate does not consume Immolate.",
    rotation: (h, r) => {
      const n = castsOf(r, "Conflagrate").reduce((a, c) => a + c.perMinute * landed(c.ability), 0);
      const pct = v(h, 0) * Math.min(1, (n * 20) / MINUTE);
      return pct > 0 ? [{ label: h.label, damagePct: { schools: ["shadow"], pct } }] : [];
    },
  },
  {
    spellId: 408438,
    name: "Lightning Overload",
    modeled: "Lightning Bolt and Chain Lightning: x% chance of a second half-damage cast at no cost.",
    ability: (h) => (d) => {
      if (d.key !== "Lightning Bolt" && d.key !== "Chain Lightning") return;
      const direct = d.parts
        .filter((p) => p.kind === "direct")
        .reduce(
          (a, p) =>
            a + p.count * p.perHit * expectedFactor(p.chances, (p.critMultiplier - 1) / p.chances.critBonus),
          0,
        );
      d.extras.push({ label: h.label, value: direct * (v(h, 0) / 100) * 0.5 });
      d.sources.push({ label: h.label, kind: "talent", text: `${v(h, 0)}% chance of a half-damage copy` });
    },
  },
  {
    spellId: 1225139,
    name: "Improved Mind Flay",
    modeled: "Each Mind Flay tick deals x% more than the previous one.",
    ability: (h) => (d) => {
      if (d.key !== "Mind Flay") return;
      for (const p of d.parts.filter((x) => x.kind === "periodic")) {
        let sum = 0;
        for (let i = 0; i < p.count; i++) sum += (1 + v(h, 0) / 100) ** i;
        p.perHit *= sum / Math.max(1, p.count);
      }
      d.sources.push({ label: h.label, kind: "talent", text: `ticks ramp by ${v(h, 0)}%` });
    },
  },
  flurry(12319), // warrior
  flurry(16256), // shaman
  {
    spellId: 12322,
    name: "Unbridled Wrath",
    modeled: "x% chance per landed weapon hit to gain 1 rage.",
    rotation: (h, r) => [{ label: h.label, ragePerMinute: weaponHitsPerMinute(r, false) * (v(h, 0) / 100) }],
  },
  {
    spellId: 12296,
    name: "Anger Management",
    modeled: "1 rage every 3 s.",
    rotation: (h) => [{ label: h.label, ragePerMinute: (v(h, 1) * MINUTE) / Math.max(1, v(h, 2)) }],
  },
  {
    spellId: 23584,
    name: "Dual Wield Specialization",
    modeled: "Off-hand white hits generate x% more rage (the damage part is aura 122).",
    rotation: (h, r, ctx) => {
      const oh = r.white.offHand;
      if (!oh || r.power !== "rage") return [];
      const rage =
        (oh.swingsPerMinute * RAGE_PER_DAMAGE_FACTOR * oh.white.expectedPerSwing) / rageConversion(ctx.level);
      return [{ label: h.label, ragePerMinute: rage * (v(h, 1) / 100) }];
    },
  },
  {
    spellId: 12834,
    name: "Deep Wounds",
    modeled:
      "Melee crits bleed for x% of the average main-hand weapon damage over 12 s (uptime from crits per minute).",
    rotation: (h, r, ctx) => {
      const w = weaponInfo(ctx, "mainHand");
      if (!w) return [];
      const u = uptime(meleeCritsPerMinute(r), 12);
      const physical = ctx.stats.damageDone
        .filter((e) => !e.schools || e.schools.includes("physical"))
        .filter((e) => !e.slots || e.slots.includes("mainHand"))
        .reduce((a, e) => a * (1 + e.value / 100), 1);
      return [{ label: h.label, extraDps: (u * (v(h, 0) / 100) * w.perSwing * physical) / 12 }];
    },
  },
  {
    spellId: 1310315,
    name: "Improved Whirlwind",
    modeled: "Whirlwind deals x% more to the closest enemy (the cooldown part is a spell modifier).",
    ability: (h) => (d) => {
      if (d.key !== "Whirlwind") return;
      for (const p of d.parts) p.perHit *= 1 + v(h, 1) / 100;
      d.sources.push({ label: h.label, kind: "talent", text: `+${v(h, 1)}% damage (closest enemy)` });
    },
  },
  weaponTalent(
    1290261,
    "Weaponmaster",
    { crit: 0, armor: 1, extra: 2 },
    {
      crit: [...AXE, ...POLEARM],
      armor: [...MACE, ...STAFF],
      extra: SWORD,
    },
  ),
  weaponTalent(
    13960,
    "Hack and Slash",
    { extra: 0, armor: 1, crit: 2 },
    {
      crit: [...DAGGER, ...FIST],
      armor: MACE,
      extra: [...AXE, ...SWORD],
    },
  ),
  {
    spellId: 14186,
    name: "Seal Fate",
    modeled: "Crits of combo point builders award an extra combo point at x% chance.",
    ability: (h) => (d: AbilityDraft) => {
      if (d.finisher || d.comboPoints <= 0) return;
      const p = d.parts[0];
      if (!p) return;
      d.comboPoints += (p.chances.land / 100) * (Math.min(100, p.chances.crit) / 100) * (v(h, 0) / 100);
      d.sources.push({ label: h.label, kind: "talent", text: "crits award an extra combo point" });
    },
  },
  {
    spellId: 14156,
    name: "Ruthlessness",
    modeled: "Finishers refund a combo point at x% chance.",
    ability: (h) => (d) => {
      if (!d.finisher) return;
      d.cpRefund += v(h, 0) / 100;
      d.sources.push({ label: h.label, kind: "talent", text: `${v(h, 0)}% chance to keep a combo point` });
    },
  },
  {
    spellId: 18094,
    name: "Nightfall",
    modeled:
      "Corruption/Drain Life/Drain Soul/Wrack ticks: x% chance of an instant Shadow Bolt (added as free casts).",
    rotation: (h, r, ctx) => {
      const ticks = r.casts
        .filter((c) => ["Corruption", "Drain Life", "Drain Soul", "Wrack"].includes(c.ability.name))
        .reduce(
          (a, c) =>
            a +
            Math.min(c.perMinute, c.ability.durationSec > 0 ? MINUTE / c.ability.durationSec : c.perMinute) *
              c.ability.ticks *
              landed(c.ability),
          0,
        );
      const sb = evaluateAbility({ ability: "Shadow Bolt", kind: "filler" }, ctx);
      if (!sb.available) return [];
      return [{ label: h.label, extraDps: (ticks * (v(h, 0) / 100) * sb.expected) / MINUTE }];
    },
  },
  {
    spellId: 16972,
    name: "Predatory Strikes",
    modeled: "Cat Form: +x% of your level as attack power.",
    stats: (h, env) =>
      env.form === "cat" || env.form === "bear"
        ? [{ key: "meleeAttackPower", value: (v(h, 0) / 100) * env.level, label: h.label, kind: "talent" }]
        : [],
  },
  {
    spellId: 415370,
    name: "Lone Wolf",
    modeled:
      "+20% damage applied (aura 79): pets are not modeled until Phase 6, so the hunter never has an active pet.",
  },
];

function flurry(spellId: number): SpecialHandler {
  return {
    spellId,
    name: "Flurry",
    modeled: "After a melee crit, +x% attack speed for 3 swings: uptime 1 - (1 - white crit)^3.",
    rotation: (h, r) => {
      const w = r.white.mainHand?.white;
      if (!w) return [];
      const u = 1 - (1 - w.critChance / 100) ** 3;
      return [{ label: h.label, meleeHastePct: v(h, 0) * u }];
    },
  };
}

function weaponTalent(
  spellId: number,
  name: string,
  idx: { crit: number; armor: number; extra: number },
  kinds: { crit: number[]; armor: number[]; extra: number[] },
): SpecialHandler {
  return {
    spellId,
    name,
    modeled: "Main-hand weapon type: crit, armor penetration or extra attacks.",
    stats: (h, env) => {
      const sub = env.weapons.mainHand?.subclass;
      if (sub === undefined) return [];
      const out: SourcedEffect[] = [];
      if (kinds.crit.includes(sub)) {
        const slots = (["mainHand", "offHand"] as const).filter((s) => {
          const w = env.weapons[s];
          return w !== null && kinds.crit.includes(w.subclass);
        });
        out.push({
          key: "weaponCrit",
          value: v(h, idx.crit),
          slots: [...slots],
          label: h.label,
          kind: "talent",
        });
      }
      if (kinds.armor.includes(sub))
        out.push({ key: "armorPenPct", value: v(h, idx.armor), label: h.label, kind: "talent" });
      return out;
    },
    rotation: (h, r, ctx) => {
      const sub = ctx.weapons.mainHand?.subclass ?? null;
      const mh = r.white.mainHand;
      if (sub === null || !kinds.extra.includes(sub) || !mh) return [];
      const rate = weaponHitsPerMinute(r, true) * (v(h, idx.extra) / 100);
      return [{ label: h.label, extraDps: (rate * mh.white.expectedPerSwing) / MINUTE }];
    },
  };
}

export const SPECIAL_HANDLERS: ReadonlyMap<number, SpecialHandler> = new Map(
  HANDLERS.map((h) => [h.spellId, h]),
);

/** Handlers of the invested talents (form-only talents are skipped when the form does not match). */
export function activeHandlers(talents: readonly RankedTalent[], formMask: number): ActiveHandler[] {
  const out: ActiveHandler[] = [];
  for (const { talent, rank } of talents) {
    const handler = SPECIAL_HANDLERS.get(talent.spellId);
    if (!handler || rank <= 0) continue;
    if (talent.shapeshiftMask !== 0 && (talent.shapeshiftMask & formMask) === 0) continue;
    out.push({
      handler,
      args: {
        talent,
        rank,
        values: talent.ranks[rank - 1]?.values ?? [],
        label: `${talent.name} ${rank}/${talent.maxRank}`,
      },
    });
  }
  return out;
}

/** Union of the handlers' rotation effects for pass 2. */
export function rotationEffects(
  active: readonly ActiveHandler[],
  r: RotationResult,
  ctx: DamageContext,
): RotationEffect[] {
  return active.flatMap((a) => a.handler.rotation?.(a.args, r, ctx) ?? []);
}
```

`src/engine/talents/special/index.ts` (exact):

```ts
export * from "./types";
export * from "./handlers";
```

---

## 8. State (task T9)

`useCalc` loads `spells/<class>.json` with the talent file (`spells` in the store). `derive` takes `spells` and returns
`damage` (null while spells are missing; the stats then fall back to the Phase 3 path without self-buffs),
`notModeled` (mapping notes minus talents with a handler and abilities used by the rotation) and fills `dps` on every
reference row. `useDerived` passes `spells`. No URL change.

`src/state/derived.ts` (complete file, exact):

`src/state/derived.ts` (exact):

```ts
import { baseStatsFile, buffsFile, getRace, racialsFile, rotationsFile, targetsFile } from "@/data";
import type { ClassSpellFile, MagicSchool, SpecRotation, TargetPresetId } from "@/data/types";
import { pointsBySpec, type ClassTree, type Ranks } from "@/engine/talents";
import { SPECIAL_HANDLERS, type ActiveHandler } from "@/engine/talents/special";
import { evaluateDamage, pickRotation, prepareDamage, type DamageResult } from "@/engine/rotation";
import {
  UnsupportedLevelError,
  assemble,
  computeCharacter,
  evaluateTarget,
  presetTarget,
  type Assembled,
  type CharacterStats,
  type EquippedWeapons,
  type NotModeled,
  type TalentMapping,
  type TargetView,
} from "@/engine/stats";
import type { CharacterState } from "./character";
import { RESIST_ORDER } from "./character";

export const REFERENCE_PRESETS: readonly TargetPresetId[] = ["boss", "elite", "same", "lowArmorBoss"];

/** Damage of the default rotation vs the selected target (null until spells/<class>.json is loaded). */
export interface DamageView {
  rotation: SpecRotation;
  result: DamageResult;
  handlers: ActiveHandler[];
}
export type Derived =
  | {
      ok: true;
      stats: CharacterStats;
      view: TargetView;
      reference: TargetView[]; // `dps` filled when `damage` is not null
      mapping: TalentMapping;
      notModeled: NotModeled[]; // mapping.notModeled minus what the damage engine models (section 8.4)
      damage: DamageView | null;
      weaponsLoading: boolean;
    }
  | { ok: false; reason: "noClass" | "level" };

/** Pure: everything the stats and damage UI shows, from the two stores. */
export function derive(
  calc: { tree: ClassTree | null; ranks: Ranks; level: number; spells: ClassSpellFile | null },
  ch: Pick<CharacterState, "raceId" | "weaponIds" | "bonus" | "buffIds" | "target" | "custom" | "weapons">,
): Derived {
  const tree = calc.tree;
  if (!tree || ch.raceId === 0) return { ok: false, reason: "noClass" };
  const byId = (id: number) =>
    id && ch.weapons ? (ch.weapons.weapons.find((w) => w.id === id) ?? null) : null;
  const weapons: EquippedWeapons = {
    mainHand: byId(ch.weaponIds.mainHand),
    offHand: byId(ch.weaponIds.offHand),
    ranged: byId(ch.weaponIds.ranged),
    ammo:
      ch.weaponIds.ammo && ch.weapons
        ? (ch.weapons.ammo.find((a) => a.id === ch.weaponIds.ammo) ?? null)
        : null,
  };
  const talents = tree.order
    .filter((id) => (calc.ranks[id] ?? 0) > 0)
    .map((id) => ({ talent: tree.nodes.get(id)!.talent, rank: calc.ranks[id]! }));
  const classTalents = tree.order.map((id) => tree.nodes.get(id)!.talent);
  const args = {
    classToken: tree.token,
    race: getRace(ch.raceId).token.toUpperCase(),
    level: calc.level,
    baseStats: baseStatsFile,
    racials: racialsFile,
    buffs: buffsFile,
    buffIds: ch.buffIds,
    talents,
    weapons,
    bonus: ch.bonus,
  };
  const rotation = pickRotation(rotationsFile, tree.token, pointsBySpec(tree, calc.ranks));
  let a: Assembled;
  let stats: CharacterStats;
  let prepared: ReturnType<typeof prepareDamage> | null = null;
  try {
    if (calc.spells) {
      prepared = prepareDamage({
        ...args,
        spells: calc.spells,
        spellClassSet: tree.info.spellClassSet,
        classTalents,
        rotation,
      });
      a = prepared.assembled;
      stats = prepared.stats;
    } else {
      a = assemble(args);
      stats = computeCharacter(a.input);
    }
  } catch (e) {
    if (e instanceof UnsupportedLevelError) return { ok: false, reason: "level" };
    throw e;
  }
  const dw = weapons.offHand !== null;
  const resist = Object.fromEntries(RESIST_ORDER.map((s, i) => [s, ch.custom.resist[i]!])) as Record<
    MagicSchool,
    number
  >;
  const custom = { level: ch.custom.level, armor: ch.custom.armor, resist };
  const at = (p: TargetPresetId) =>
    evaluateTarget(
      stats,
      presetTarget(targetsFile, p, calc.level, a.debuffs, custom),
      targetsFile.armorFormula,
      dw,
    );
  const damageAt = (view: TargetView): DamageResult | null =>
    prepared
      ? evaluateDamage({
          level: calc.level,
          stats,
          view,
          book: prepared.book,
          weapons: a.input.weapons,
          rotation,
          talents,
          classTalents,
          spellMods: a.mapping.spellMods,
          selfBuffs: prepared.selfBuffs,
          handlers: prepared.handlers,
        })
      : null;
  const view = at(ch.target);
  const result = damageAt(view);
  const reference = [...REFERENCE_PRESETS, ...(ch.target === "custom" ? (["custom"] as const) : [])].map(
    (p) => {
      const v = at(p);
      const d = p === ch.target && result ? result : damageAt(v);
      return d ? { ...v, dps: d.rotation.dps } : v;
    },
  );
  const damage = result && prepared ? { rotation, result, handlers: prepared.handlers } : null;
  return {
    ok: true,
    stats,
    view,
    reference,
    mapping: a.mapping,
    notModeled: notModeled(a.mapping, tree, damage),
    damage,
    weaponsLoading: ch.weapons === null,
  };
}

/** Talents the damage engine now models are dropped from the "not modeled" list. */
function notModeled(mapping: TalentMapping, tree: ClassTree, damage: DamageView | null): NotModeled[] {
  if (!damage) return mapping.notModeled;
  const used = new Set(damage.result.abilities.filter((x) => x.available).map((x) => x.key));
  for (const s of damage.rotation.selfBuffs) used.add(s);
  return mapping.notModeled.filter((n) => {
    const t = tree.nodes.get(n.nodeId)?.talent;
    if (!t) return true;
    if (n.reason === "special" && SPECIAL_HANDLERS.has(t.spellId)) return false;
    if (n.reason === "ability" && used.has(t.name)) return false;
    return true;
  });
}
```

`src/state/store.ts` (diff):

```diff
--- a/src/state/store.ts
+++ b/src/state/store.ts
@@ -1,6 +1,6 @@
 import { create } from "zustand";
-import { classesFile, getClassInfo, loadTalentFile } from "@/data";
-import type { ClassToken } from "@/data/types";
+import { classesFile, getClassInfo, loadClassSpells, loadTalentFile } from "@/data";
+import type { ClassSpellFile, ClassToken } from "@/data/types";
 import {
   addPoint as addPointRule,
   buildClassTree,
@@ -18,6 +18,7 @@
 export interface CalcState {
   classToken: ClassToken | null;
   tree: ClassTree | null;
+  spells: ClassSpellFile | null; // spells/<class>.json, loaded with the talent file (Phase 4)
   status: "idle" | "loading" | "ready" | "error";
   error: string | null;
   notice: string | null;
@@ -45,14 +46,15 @@
 
 let requestId = 0;
 
-async function loadTree(token: ClassToken): Promise<ClassTree> {
-  const file = await loadTalentFile(token);
-  return buildClassTree(file, getClassInfo(token));
+async function loadTree(token: ClassToken): Promise<{ tree: ClassTree; spells: ClassSpellFile }> {
+  const [file, spells] = await Promise.all([loadTalentFile(token), loadClassSpells(token)]);
+  return { tree: buildClassTree(file, getClassInfo(token)), spells };
 }
 
 export const useCalc = create<CalcState>()((set, get) => ({
   classToken: null,
   tree: null,
+  spells: null,
   status: "idle",
   error: null,
   notice: null,
@@ -65,13 +67,14 @@
     const id = ++requestId;
     set({ classToken: token, status: "loading", error: null });
     try {
-      const [tree, charOk] = await Promise.all([
+      const [{ tree, spells }, charOk] = await Promise.all([
         loadTree(token),
         useCharacter.getState().fitToClass(token, get().level),
       ]);
       if (id !== requestId) return;
       set({
         tree,
+        spells,
         status: "ready",
         ranks: {},
         activeSpec: 0,
@@ -79,14 +82,14 @@
       });
     } catch (e) {
       if (id !== requestId) return;
-      set({ tree: null, status: "error", error: e instanceof Error ? e.message : String(e) });
+      set({ tree: null, spells: null, status: "error", error: e instanceof Error ? e.message : String(e) });
     }
   },
   async applyBuildCode(code) {
     const id = ++requestId;
     set({ classToken: code.classToken, status: "loading", error: null });
     try {
-      const [tree, charOk] = await Promise.all([
+      const [{ tree, spells }, charOk] = await Promise.all([
         loadTree(code.classToken),
         useCharacter.getState().applyCode(code.character, code.classToken, code.level),
       ]);
@@ -95,6 +98,7 @@
       const { ranks, dropped } = sanitize(tree, code.ranks, ctx);
       set({
         tree,
+        spells,
         status: "ready",
         level: code.level,
         talentedRank: code.talentedRank,
@@ -110,12 +114,20 @@
       });
     } catch (e) {
       if (id !== requestId) return;
-      set({ tree: null, status: "error", error: e instanceof Error ? e.message : String(e) });
+      set({ tree: null, spells: null, status: "error", error: e instanceof Error ? e.message : String(e) });
     }
   },
   clearClass() {
     requestId++;
-    set({ classToken: null, tree: null, status: "idle", error: null, ranks: {}, activeSpec: 0 });
+    set({
+      classToken: null,
+      tree: null,
+      spells: null,
+      status: "idle",
+      error: null,
+      ranks: {},
+      activeSpec: 0,
+    });
   },
   addPoint(nodeId) {
     const s = get();
```

`src/ui/stats/useDerived.ts` (diff):

```diff
--- a/src/ui/stats/useDerived.ts
+++ b/src/ui/stats/useDerived.ts
@@ -6,6 +6,7 @@
 /** Derived stats for the current talents and character (pure computation, well under 1 ms). */
 export function useDerived(): Derived {
   const tree = useCalc((s) => s.tree);
+  const spells = useCalc((s) => s.spells);
   const ranks = useCalc((s) => s.ranks);
   const level = useCalc((s) => s.level);
   const raceId = useCharacter((s) => s.raceId);
@@ -16,7 +17,8 @@
   const custom = useCharacter((s) => s.custom);
   const weapons = useCharacter((s) => s.weapons);
   return useMemo(
-    () => derive({ tree, ranks, level }, { raceId, weaponIds, bonus, buffIds, target, custom, weapons }),
-    [tree, ranks, level, raceId, weaponIds, bonus, buffIds, target, custom, weapons],
+    () =>
+      derive({ tree, ranks, level, spells }, { raceId, weaponIds, bonus, buffIds, target, custom, weapons }),
+    [tree, ranks, level, spells, raceId, weaponIds, bonus, buffIds, target, custom, weapons],
   );
 }
```

`src/state/derived.test.ts` (diff):

```diff
--- a/src/state/derived.test.ts
+++ b/src/state/derived.test.ts
@@ -2,6 +2,7 @@
 import { classesFile } from "@/data";
 import { treeFor } from "@/testkit/talents";
 import { weaponsFile } from "@/testkit/stats";
+import { spellFile } from "@/testkit/damage";
 import { EMPTY_BONUS } from "@/engine/stats";
 import { DEFAULT_CUSTOM, NO_WEAPON_IDS, sanitizeWeapons } from "./character";
 import { derive } from "./derived";
@@ -17,25 +18,45 @@
 };
 describe("derive", () => {
   it("naked human warrior", () => {
-    const d = derive({ tree: treeFor("warrior"), ranks: {}, level: 60 }, ch);
+    const d = derive({ tree: treeFor("warrior"), ranks: {}, level: 60, spells: null }, ch);
     if (!d.ok) throw new Error(d.reason);
     expect(d.stats.attackPower.value).toBe(400);
+    expect(d.damage).toBeNull();
+    expect(d.reference.every((v) => v.dps === undefined)).toBe(true);
     expect(d.reference.map((v) => v.level)).toEqual([63, 62, 60, 63]);
     expect(d.reference.map((v) => v.armor.value)).toEqual([3731, 3677, 3566, 1866]);
   });
   it("works for every class and playable race", () => {
     for (const c of classesFile.classes)
       for (const raceId of c.raceIds) {
-        const d = derive({ tree: treeFor(c.token), ranks: {}, level: 60 }, { ...ch, raceId });
-        expect(d.ok, `${c.token} ${raceId}`).toBe(true);
+        const d = derive(
+          { tree: treeFor(c.token), ranks: {}, level: 60, spells: spellFile(c.token) },
+          { ...ch, raceId },
+        );
+        if (!d.ok) throw new Error(`${c.token} ${raceId}`);
+        expect(d.damage, c.token).not.toBeNull();
+        for (const v of d.reference) expect(Number.isFinite(v.dps), `${c.token} ${v.presetId}`).toBe(true);
       }
   });
   it("level below 60 has no stats", () => {
-    expect(derive({ tree: treeFor("warrior"), ranks: {}, level: 40 }, ch)).toEqual({
+    expect(
+      derive({ tree: treeFor("warrior"), ranks: {}, level: 40, spells: spellFile("warrior") }, ch),
+    ).toEqual({
       ok: false,
       reason: "level",
     });
   });
+  it("damage of the default rotation: dps per reference target, selected target reused", () => {
+    const d = derive(
+      { tree: treeFor("warrior"), ranks: {}, level: 60, spells: spellFile("warrior") },
+      { ...ch, weaponIds: { ...NO_WEAPON_IDS, mainHand: 12784 } },
+    );
+    if (!d.ok || !d.damage) throw new Error("no damage");
+    expect(d.damage.rotation.id).toBe("warrior-arms"); // no points: first dps spec
+    expect(d.reference[0]!.dps).toBe(d.damage.result.rotation.dps);
+    // same-level mob: less armor, no crit suppression -> more damage than the boss
+    expect(d.reference[2]!.dps!).toBeGreaterThan(d.reference[0]!.dps!);
+  });
   it("sanitizeWeapons drops what the class cannot use", () => {
     // mage cannot use Arcanite Reaper (2H axe) nor dual wield
     expect(
```

---

## 9. UI (task T10)

Layout: desktop keeps Character | Stats and adds the **Damage** panel full width below them; mobile gets a fourth top
tab "Damage". The stat strip shows `DPS` first (`strip-dps`). The Stats panel's reference table shows the DPS column
automatically (Phase 3 hook). "Damage modifiers" footnote and the not-modeled sections are reworded.

Test ids: `damage-panel`, `dps-total`, `dps-rotation`, `dps-tier`, `dps-resource`, `dps-breakdown`,
`dps-row-<slug>`, `dps-skipped`, `ability-<slug>` with `-hit`, `-crit`, `-tick`, `-expected`, `-dpct`, `-hitchance`,
`-critchance` (`slug("Seal of Command (proc)") = "seal-of-command-proc"`).

`src/ui/results/slug.ts` (exact):

```ts
/** "Seal of Command (proc)" -> "seal-of-command-proc" (test ids). */
export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
```

`src/ui/results/slug.test.ts` (exact):

```ts
import { describe, expect, it } from "vitest";
import { slug } from "./slug";

describe("slug", () => {
  it("makes test ids", () => {
    expect(slug("Seal of Command (proc)")).toBe("seal-of-command-proc");
    expect(slug("Shadow Word: Pain")).toBe("shadow-word-pain");
    expect(slug("Main-hand melee")).toBe("main-hand-melee");
  });
});
```

`src/ui/results/DamagePanel.tsx` (exact):

```tsx
import type { AbilityResult } from "@/engine/abilities";
import type { Derived } from "@/state/derived";
import { AbilityCard } from "@/ui/abilities/AbilityCard";
import abilityStyles from "@/ui/abilities/Abilities.module.css";
import { fmtDec1, fmtDec2, fmtInt, fmtPct } from "@/ui/stats/format";
import { useDerived } from "@/ui/stats/useDerived";
import { slug } from "./slug";
import styles from "./DamagePanel.module.css";

type Ok = Extract<Derived, { ok: true }>;
const TIER_TEXT = {
  1: "Fully modeled",
  2: "Generic model: some talents of this spec are not modeled",
  3: "Basic damage rotation for a tank or healer spec",
} as const;

function Breakdown({ d }: { d: Ok }) {
  const r = d.damage!.result.rotation;
  const rows: { key: string; perMinute: number | null; dps: number }[] = [
    ...r.casts
      .filter((c) => c.perMinute > 0)
      .map((c) => ({ key: c.key, perMinute: c.perMinute, dps: c.dps })),
    ...Object.values(r.white).map((w) => ({
      key: w!.white.name,
      perMinute: w!.swingsPerMinute,
      dps: w!.dps,
    })),
    ...r.extras.map((x) => ({ key: x.label, perMinute: null, dps: x.dps })),
  ].sort((a, b) => b.dps - a.dps);
  return (
    <table className={styles.table} data-testid="dps-breakdown">
      <caption>Damage per second by source (per minute averages)</caption>
      <thead>
        <tr>
          <th>Source</th>
          <th>Per minute</th>
          <th>DPS</th>
          <th>Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.key} data-testid={`dps-row-${slug(x.key)}`}>
            <td>{x.key}</td>
            <td>{x.perMinute === null ? "–" : fmtDec2(x.perMinute)}</td>
            <td>{fmtDec1(x.dps)}</td>
            <td>{fmtPct(r.dps > 0 ? (x.dps / r.dps) * 100 : 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Resource({ d }: { d: Ok }) {
  const r = d.damage!.result.rotation;
  let text: string;
  if (r.resource)
    text = `${r.resource.power}: ${fmtInt(r.resource.incomePerMinute)} gained per minute, all spent`;
  else if (r.manaPerSecond > 0)
    text = `Mana: ${fmtDec1(r.manaPerSecond)} per second${r.oomSeconds ? `, out of mana after ${fmtInt(r.oomSeconds)} s without regeneration` : ""}`;
  else text = "No resource cost";
  return (
    <p className={styles.line} data-testid="dps-resource">
      {text} · {fmtPct(r.timeUsedPct)} of the time casting
    </p>
  );
}

/** Damage of the default rotation vs the selected target, then one card per ability. */
export function DamagePanel() {
  const d = useDerived();
  if (!d.ok) return null;
  if (!d.damage)
    return (
      <section className={styles.panel} data-testid="damage-panel">
        <h2 className={styles.title}>Damage</h2>
        <p className={styles.line}>Loading spells…</p>
      </section>
    );
  const { rotation, result } = d.damage;
  const r = result.rotation;
  const perMinute = new Map(r.casts.map((c) => [c.key, c.perMinute]));
  const cards: AbilityResult[] = [
    ...result.abilities.filter((a): a is AbilityResult => a.available),
    ...r.casts.filter((c) => c.entry === null).map((c) => c.ability),
  ];
  return (
    <section className={styles.panel} data-testid="damage-panel">
      <h2 className={styles.title}>Damage</h2>
      <div className={styles.summary}>
        <span className={styles.dps} data-testid="dps-total">
          {fmtDec1(r.dps)}
        </span>
        <span className={styles.unit}>DPS</span>
        <span className={styles.rotation} data-testid="dps-rotation">
          {rotation.label}
          <span className={styles.badge} title={TIER_TEXT[rotation.tier]} data-testid="dps-tier">
            Tier {rotation.tier}
          </span>
        </span>
      </div>
      <p className={styles.line}>
        {TIER_TEXT[rotation.tier]}. Analytical average; procs and uptimes as expected values.
      </p>
      <Resource d={d} />
      <Breakdown d={d} />
      <div className={abilityStyles.grid}>
        {cards.map((a) => (
          <AbilityCard key={a.key} a={a} perMinute={perMinute.get(a.key) ?? null} />
        ))}
      </div>
      {r.skipped.length > 0 && (
        <ul className={abilityStyles.unavailable} data-testid="dps-skipped">
          {r.skipped.map((s) => (
            <li key={s.ability}>
              {s.ability}: {s.reason}
            </li>
          ))}
        </ul>
      )}
      {rotation.notes.map((n) => (
        <p key={n} className={styles.note}>
          {n}
        </p>
      ))}
    </section>
  );
}
```

`src/ui/results/DamagePanel.module.css` (exact):

```css
.panel {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: 4px;
}

.title {
  margin: 0 0 8px;
  color: var(--gold);
  font-size: 20px;
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

.rotation {
  color: var(--text);
}

.badge {
  margin-left: 6px;
  padding: 0 4px;
  border: 1px solid var(--gold);
  border-radius: 3px;
  color: var(--gold);
  font-size: 11px;
}

.line {
  margin: 4px 0;
  color: var(--text-dim);
  font-size: 12px;
}

.note {
  margin: 4px 0 0;
  color: var(--warn);
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
```

`src/ui/abilities/AbilityCard.tsx` (exact):

```tsx
import type { AbilityResult } from "@/engine/abilities";
import { WowIcon } from "@/ui/common/WowIcon";
import { fmtDec1, fmtDec2, fmtInt, fmtPct } from "@/ui/stats/format";
import { slug } from "@/ui/results/slug";
import styles from "./Abilities.module.css";

const POWER_LABEL = { mana: "mana", rage: "rage", energy: "energy", focus: "focus" } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td data-testid={testId}>{value}</td>
    </tr>
  );
}

/** One ability vs the selected target: per-cast numbers, chances, timing, cost and what modifies it. */
export function AbilityCard({ a, perMinute }: { a: AbilityResult; perMinute: number | null }) {
  const id = slug(a.key);
  const timing =
    a.channelTime > 0
      ? `${fmtDec2(a.channelTime)} s channel`
      : a.castTime > 0
        ? `${fmtDec2(a.castTime)} s cast`
        : a.timeCost > 0
          ? "Instant"
          : "Instant, off the GCD";
  return (
    <article className={styles.card} data-testid={`ability-${id}`} aria-label={a.key}>
      <header className={styles.head}>
        <WowIcon name={a.icon} size={32} />
        <div>
          <div className={styles.name}>{a.key}</div>
          <div className={styles.meta}>
            {a.rank !== null ? `Rank ${a.rank} · ` : ""}
            {cap(a.school)} · {a.kind === "spell" ? "spell" : `${a.kind} attack`}
          </div>
        </div>
      </header>
      <table className={styles.rows}>
        <tbody>
          {a.hit > 0 && (
            <Row
              label="Hit"
              value={`${fmtInt(a.hit)}${a.hitRange ? ` (${fmtInt(a.hitRange[0])}–${fmtInt(a.hitRange[1])})` : ""}`}
              testId={`ability-${id}-hit`}
            />
          )}
          {a.hit > 0 && <Row label="Crit" value={fmtInt(a.crit)} testId={`ability-${id}-crit`} />}
          {a.tick > 0 && (
            <Row label="Tick" value={`${fmtInt(a.tick)} x ${a.ticks}`} testId={`ability-${id}-tick`} />
          )}
          {a.extras.map((x) => (
            <Row key={x.label} label={x.label} value={`+${fmtDec1(x.value)} per cast`} />
          ))}
          <Row label="Per cast (expected)" value={fmtDec1(a.expected)} testId={`ability-${id}-expected`} />
          <Row label="Per second of cast time" value={fmtDec1(a.dpct)} testId={`ability-${id}-dpct`} />
          <Row label="Hit chance" value={fmtPct(a.hitChance)} testId={`ability-${id}-hitchance`} />
          <Row label="Crit chance" value={fmtPct(a.critChance)} testId={`ability-${id}-critchance`} />
          <Row label="Time" value={timing} />
          {a.cooldown > 0 && <Row label="Cooldown" value={`${fmtDec1(a.cooldown)} s`} />}
          {a.power && a.cost > 0 && <Row label="Cost" value={`${fmtInt(a.cost)} ${POWER_LABEL[a.power]}`} />}
          {perMinute !== null && <Row label="Casts per minute" value={fmtDec2(perMinute)} />}
        </tbody>
      </table>
      {a.sources.length > 0 && (
        <ul className={styles.sources} aria-label={`${a.key} is modified by`}>
          {a.sources.map((s, i) => (
            <li key={i} className={styles[s.kind]}>
              {s.label}: {s.text}
            </li>
          ))}
        </ul>
      )}
      {a.notes.map((n) => (
        <p key={n} className={styles.note}>
          {n}
        </p>
      ))}
    </article>
  );
}
```

`src/ui/abilities/Abilities.module.css` (exact):

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.card {
  min-width: 0;
  padding: 6px 8px;
  background: var(--field-bg);
  border: 1px solid var(--panel-border);
  border-radius: 4px;
  font-size: 12px;
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.name {
  color: var(--white);
  font-family: var(--font-serif);
  font-size: 14px;
}

.meta {
  color: var(--text-dim);
  font-size: 11px;
}

.rows {
  width: 100%;
  border-collapse: collapse;
}

.rows th {
  color: var(--text-dim);
  font-weight: normal;
  text-align: left;
}

.rows td {
  text-align: right;
  white-space: nowrap;
}

.sources {
  margin: 4px 0 0;
  padding-left: 16px;
}

.talent {
  color: var(--green);
}

.buff,
.debuff,
.racial {
  color: var(--q3);
}

.gear,
.weapon,
.rule,
.base,
.race,
.conversion {
  color: var(--text-dim);
}

.note {
  margin: 4px 0 0;
  color: var(--warn);
}

.unavailable {
  margin: 8px 0 0;
  padding-left: 16px;
  color: var(--text-dim);
  font-size: 12px;
}
```

`src/App.tsx` (diff):

```diff
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -2,14 +2,15 @@
 import { DATA_BUILD, manifest } from "@/data";
 import { useCalc } from "@/state/store";
 import { CharacterPanel } from "@/ui/character/CharacterPanel";
+import { DamagePanel } from "@/ui/results/DamagePanel";
 import { useMediaQuery } from "@/ui/common/useMediaQuery";
 import { StatsPanel } from "@/ui/stats/StatsPanel";
 import { ClassPicker } from "@/ui/talents/ClassPicker";
 import { TalentCalculator } from "@/ui/talents/TalentCalculator";
 import styles from "./App.module.css";
 
-type Section = "Talents" | "Gear" | "Stats";
-const SECTIONS: Section[] = ["Talents", "Gear", "Stats"];
+type Section = "Talents" | "Gear" | "Stats" | "Damage";
+const SECTIONS: Section[] = ["Talents", "Gear", "Stats", "Damage"];
 
 export function App() {
   const classToken = useCalc((s) => s.classToken);
@@ -48,13 +49,17 @@
       )}
       {(desktop || !classToken || section === "Talents") && <TalentCalculator />}
       {classToken && status === "ready" && desktop && (
-        <div className={styles.panels}>
-          <CharacterPanel />
-          <StatsPanel />
-        </div>
+        <>
+          <div className={styles.panels}>
+            <CharacterPanel />
+            <StatsPanel />
+          </div>
+          <DamagePanel />
+        </>
       )}
       {classToken && status === "ready" && !desktop && section === "Gear" && <CharacterPanel />}
       {classToken && status === "ready" && !desktop && section === "Stats" && <StatsPanel />}
+      {classToken && status === "ready" && !desktop && section === "Damage" && <DamagePanel />}
       <footer className={styles.footer}>
         Data: WoW Forever build {DATA_BUILD} · generated {manifest.generatedAt} · Icons and art © Blizzard
         Entertainment
```

`src/ui/stats/StatStrip.tsx` (diff):

```diff
--- a/src/ui/stats/StatStrip.tsx
+++ b/src/ui/stats/StatStrip.tsx
@@ -1,6 +1,6 @@
 import type { Stat } from "@/engine/stats";
 import { StatValue } from "./StatValue";
-import { fmtInt, fmtPct } from "./format";
+import { fmtDec1, fmtInt, fmtPct } from "./format";
 import { useDerived } from "./useDerived";
 import styles from "./StatStrip.module.css";
 
@@ -57,8 +57,15 @@
       { testId: "strip-dr", label: "Armor DR", stat: view.armorReduction, format: fmtPct },
     ];
   }
+  const dps = d.damage?.result.rotation.dps;
   return (
     <div className={styles.strip} data-testid="stat-strip" aria-label="Key stats">
+      {dps !== undefined && (
+        <span className={styles.item}>
+          <span className={styles.label}>DPS</span>
+          <span data-testid="strip-dps">{fmtDec1(dps)}</span>
+        </span>
+      )}
       {fields.map((f) => (
         <span key={f.testId} className={styles.item}>
           <span className={styles.label}>{f.label}</span>
```

`src/ui/stats/StatsPanel.tsx` (diff):

```diff
--- a/src/ui/stats/StatsPanel.tsx
+++ b/src/ui/stats/StatsPanel.tsx
@@ -159,7 +159,7 @@
           ))}
           <tr>
             <td colSpan={2} className={styles.dim}>
-              applied by the damage engine (Phase 4)
+              applied to matching attacks in the Damage panel
             </td>
           </tr>
         </Group>
```

`src/ui/stats/NotModeledNote.tsx` (diff):

```diff
--- a/src/ui/stats/NotModeledNote.tsx
+++ b/src/ui/stats/NotModeledNote.tsx
@@ -6,15 +6,14 @@
 
 const SECTIONS: { reason: NotModeledReason; title: string }[] = [
   { reason: "inactive", title: "Inactive (condition not met)" },
-  { reason: "spellMod", title: "Affect specific spells (Phase 4)" },
-  { reason: "special", title: "Special effects (Phase 4)" },
-  { reason: "ability", title: "Abilities and cooldowns (Phase 4/5)" },
+  { reason: "special", title: "Special effects not modeled yet" },
+  { reason: "ability", title: "Abilities and cooldowns outside the default rotation (Phase 5)" },
   { reason: "unsupported", title: "Not supported yet" },
 ];
 
 export function NotModeledNote({ d, race }: { d: Extract<Derived, { ok: true }>; race: string }) {
   const tree = useCalc((s) => s.tree);
-  const notes: NotModeled[] = d.mapping.notModeled;
+  const notes: NotModeled[] = d.notModeled;
   const racials = racialsFile.racials.filter((r) => r.race === race && r.kind === "active");
   const n = notes.length;
   if (n === 0 && racials.length === 0) return null;
```

---

## 10. Tests (task T11)

### 10.1 Test helpers: `src/testkit/damage.ts` (exact)

`src/testkit/damage.ts` (exact):

```ts
// TEST-ONLY helpers for the damage engine. Never import from app code.
import rotationsJson from "@manual/rotations.json";
import type { ClassSpellFile, ClassToken, RotationsFile, TargetPresetId } from "@/data/types";
import { classesFile } from "@/data";
import { evaluateDamage, pickRotation, prepareDamage } from "@/engine/rotation";
import { EMPTY_BONUS, evaluateTarget, presetTarget } from "@/engine/stats";
import { NO_WEAPONS, baseStats, buffs, racials, ranked, targets, type Scenario } from "./stats";
import { treeFor } from "./talents";

export const rotations = rotationsJson as unknown as RotationsFile;
const spellFiles = Object.values(
  import.meta.glob<{ default: unknown }>("@data/spells/*.json", { eager: true }),
).map((m) => m.default as unknown as ClassSpellFile);
export const spellFile = (token: ClassToken): ClassSpellFile => {
  const f = spellFiles.find((x) => x.token === token);
  if (!f) throw new Error(`no spell file for ${token}`);
  return f;
};

export interface DamageScenario extends Scenario {
  rotation?: string; // rotation id; default: pickRotation by spent points
}

/** Full damage evaluation of a scenario against one target preset (default boss). */
export function runDamage(s: DamageScenario, preset: TargetPresetId = s.target ?? "boss") {
  const tree = treeFor(s.classToken);
  const talents = ranked(s.classToken, s.talents ?? {});
  const points = [0, 1, 2].map((i) =>
    talents.filter((t) => tree.nodes.get(t.talent.nodeId)!.specIndex === i).reduce((a, t) => a + t.rank, 0),
  );
  const rotation = s.rotation
    ? rotations.rotations.find((r) => r.id === s.rotation)!
    : pickRotation(rotations, s.classToken, points);
  const info = classesFile.classes.find((c) => c.token === s.classToken)!;
  const p = prepareDamage({
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
    rotation,
  });
  const view = evaluateTarget(
    p.stats,
    presetTarget(targets, preset, 60, p.assembled.debuffs),
    targets.armorFormula,
    p.assembled.input.weapons.offHand !== null,
  );
  const result = evaluateDamage({
    level: 60,
    stats: p.stats,
    view,
    book: p.book,
    weapons: p.assembled.input.weapons,
    rotation,
    talents,
    classTalents: [...tree.nodes.values()].map((n) => n.talent),
    spellMods: p.assembled.mapping.spellMods,
    selfBuffs: p.selfBuffs,
    handlers: p.handlers,
  });
  const ability = (key: string) => {
    const a =
      result.abilities.find((x) => x.key === key) ??
      result.rotation.casts.find((c) => c.key === key)?.ability;
    if (!a || !a.available)
      throw new Error(`${key} not available: ${a && !a.available ? a.reason : "missing"}`);
    return a;
  };
  return { ...p, view, rotation, result, ability };
}
```

### 10.2 Golden values (independent Python check)

Computed by the script below from the generated and manual JSON with formulas re-implemented from this document (not
from the TS code). Level 60 vs boss: level 63, 3731 armor, DR = 3731 / 9231 = 40.42%, spell hit 83%, average resist
0.75 x 24 / 300 = 6%, special table 8% miss + 6.5% dodge, crit suppression -2.4%, glancing 40% at 65%.
The script is not committed; to re-run it, save it to a scratch folder and run `python3 golden.py <repo root>` (prints JSON).

| # | Case | Inputs | Expected |
|---|---|---|---|
| G1 | Frostbolt r11 25304 | Human mage, +500 SP | hit 829.08 (475 + 0.814 x 500 = 882 x 0.94), crit 1243.62, crit 3.3008%, expected 699.494, Frost DPS 233.165 (cast 3.0) |
| G2 | Fireball r12 25306 | same | hit 924.02 (483 + 500, x 0.94), tick 14.10 x 4, expected 827.179, cast 3.5 |
| G3 | Shadow Bolt r10 25307 | Human warlock, +400 SP, Bane 5/5, Ruin 5/5 | hit 574.152, crit 1148.304 (Ruin: 200%), crit 4.4327%, cast 2.5, expected 497.670 |
| G4 | Mind Blast r9 10947 | Human priest, +300 SP | base 490.2 (485 + 2.6 x 2), hit 581.766, expected 492.105, cooldown 8 |
| G5 | Lightning Bolt r10 15208 | Orc shaman, +300 SP | base 361.4 (353 + 2.1 x 4), hit 541.064, expected 459.776, cast 2.5 |
| G6 | Moonfire r10 9835 | Tauren druid, +300 SP | hit 173.524, tick 93.06 x 4, expected 460.760 |
| G7 | Heroic Strike r9 25286 | Human warrior, Arcanite Reaper (AP 462) | hit 290.104 ((204.5 + 462/14 x 3.8 + 157) x 0.5958), crit 580.208, crit 2.6%, land 85.5%, expected 254.488 |
| G8 | Mortal Strike r4 21553 | + talent | hit 282.060 (normalized 3.3, +160), expected 247.432 |
| G9 | Bloodthirst r4 23894 | + talent | hit 152.470 ((48 + 0.45 x 462) x 0.5958), expected 133.751 |
| G10 | Sinister Strike r8 11294 | Human rogue, Brutality Blade + Chromatically Tempered Sword (AP 356) | hit 153.738 (sword 2.4), crit 3.8759%, expected 136.541 |
| G11 | Aimed Shot r6 20904 | Dwarf hunter, Rhok'delar + Thorium Headed Arrow; rotation self-buffs Aspect of the Hawk +120, Hunter's Mark +143 (RAP 632) | hit 390.415 ((127.5 + 17.71 x 2.9 + 632/14 x 2.8 + 350) x 0.5958), crit 0.883%, land 92% (Dwarf +1% hit eaten by suppression), expected 362.354 |
| G12 | Holy Strike r8 10333 | Human paladin, Reaper (AP 432), +200 holy SP | hit 242.564 ((204.5 + 432/14 x 3.3 + 93 + 85.8) x 0.5, no armor), expected 212.681 |
| G13 | Warrior basic rotation | G7 setup | white expected 145.651 per swing, rage 4.737 per swing, Heroic Strike 3.7897 per minute, DPS 45.204 |

Golden script (`golden.py`):

```python
"""Independent golden numbers for docs/phase4-implementation-plan.md section 10.2 (reads the generated + manual JSON).
Formulas re-implemented from the plan text (sections 5-6), not from the TS code."""
import json, math, sys
ROOT = sys.argv[1] if len(sys.argv) > 1 else '/home/user/talentcalc'
G = ROOT + '/data/generated/1.60.1.70888/'
M = ROOT + '/data/manual/'
spells = {s['id']: s for s in json.load(open(G + 'spells.json'))['spells']}
base = json.load(open(M + 'base-stats.json'))
weapons = {w['id']: w for w in json.load(open(G + 'weapons.json'))['weapons']}
ammo = {a['id']: a for a in json.load(open(G + 'weapons.json'))['ammo']}
L, TL, ARMOR = 60, 63, 3731
DR = ARMOR / (ARMOR + 400 + 85 * L)
RESIST = 1 - 0.75 * (8 * (TL - L)) / (5 * L)          # 0.94
SPELL_LAND = 0.83                                      # 17% miss vs +3
SPECIAL_LAND = 1 - 0.08 - 0.065                        # 300 skill vs 315: miss 8, dodge 6.5
RANGED_LAND = 1 - 0.08
SUPPRESS = 0.04 * (300 - 315) - 1.8                    # -2.4
GLANCE_MULT = ((1.3 - 0.05 * 15) + (1.2 - 0.03 * 15)) / 2   # 0.65
RAGE_C = 0.0091107836 * L * L + 3.225598133 * L + 4.2652911

def val(sid, idx, level=L):
    s = spells[sid]; e = [x for x in s['effects'] if x['index'] == idx][0]
    v = e['base']; lv = s['levels']
    if lv and e.get('perLevel'):
        top = min(level, lv['max']) if lv['max'] > 0 else level
        v += e['perLevel'] * max(0, top - lv['base'])
    return v
def eff(sid, idx): return [x for x in spells[sid]['effects'] if x['index'] == idx][0]

def stat(cls, race, s, items=()):
    c = base['classes'][cls]; r = base['raceOffsets'][race]
    return c[s] + r[s] + sum(st['value'] for w in items for st in w['stats'] if st['name'] == {'str':'strength','agi':'agility','int':'intellect'}[s])
def item(items, name): return sum(st['value'] for w in items for st in w['stats'] if st['name'] == name)
def ap(cls, race, items):
    f = base['conversions']['meleeAttackPower'][cls]
    return f['perLevel'] * L + f['flat'] + f['perStr'] * stat(cls, race, 'str', items) + f['perAgi'] * stat(cls, race, 'agi', items) + item(items, 'attack_power')
def rap(cls, race, items):
    f = base['conversions']['rangedAttackPower'][cls]
    return f['perLevel'] * L + f['flat'] + f['perAgi'] * stat(cls, race, 'agi', items) + item(items, 'attack_power') + item(items, 'ranged_attack_power')
def mcrit(cls, race, items, racial=0):
    return base['classes'][cls]['baseMeleeCrit'] + stat(cls, race, 'agi', items) / base['conversions']['agiPerMeleeCrit'][cls] + racial + item(items, 'crit_rating') / 14
def scrit(cls, race, racial=0):
    return base['classes'][cls]['baseSpellCrit'] + stat(cls, race, 'int') / base['conversions']['intPerSpellCrit'][cls] + racial
def spell_expected(hit, crit_pct, bonus=0.5, land=SPELL_LAND):
    return land * hit * (1 + crit_pct / 100 * bonus)

out = {}
# G1 Mage Frostbolt r11 25304, Human, +500 spell power, no talents
c = scrit('MAGE', 'HUMAN', 1)
fb = (val(25304, 1) + eff(25304, 1)['spCoef'] * 500) * RESIST
out['G1 Frostbolt'] = dict(hit=fb, crit=fb * 1.5, critChance=c, expected=spell_expected(fb, c), dps=spell_expected(fb, c) / 3.0)
# G2 Fireball r12 25306: direct + 4 ticks of 15 (no coefficient), DoT ticks crit like the spell (section 5.6)
d = (val(25306, 0) + 1.0 * 500) * RESIST
t = val(25306, 1) * RESIST
out['G2 Fireball'] = dict(hit=d, tick=t, expected=SPELL_LAND * (d + 4 * t) * (1 + c / 100 * 0.5), castTime=3.5)
# G3 Warlock Shadow Bolt r10 25307, Human, +400, talents Bane 5/5 (-0.5 s), Ruin 5/5 (+100% crit bonus)
c3 = scrit('WARLOCK', 'HUMAN', 1)
sb = (val(25307, 0) + eff(25307, 0)['spCoef'] * 400) * RESIST
out['G3 Shadow Bolt'] = dict(hit=sb, crit=sb * 2.0, critChance=c3, castTime=2.5, expected=spell_expected(sb, c3, 1.0))
# G4 Priest Mind Blast r9 10947 (base level 58: +2.6 x 2), +300
c4 = scrit('PRIEST', 'HUMAN', 1)
mb = (val(10947, 0) + eff(10947, 0)['spCoef'] * 300) * RESIST
out['G4 Mind Blast'] = dict(base=val(10947, 0), hit=mb, expected=spell_expected(mb, c4), cooldown=8)
# G5 Shaman Lightning Bolt r10 15208 (base 56, max 61: +2.1 x 4), Orc (+1 crit), +300
c5 = scrit('SHAMAN', 'ORC', 1)
lb = (val(15208, 0) + eff(15208, 0)['spCoef'] * 300) * RESIST
out['G5 Lightning Bolt'] = dict(base=val(15208, 0), hit=lb, expected=spell_expected(lb, c5), castTime=2.5)
# G6 Druid Moonfire r10 9835 (Tauren), +300: direct 135 + 2.3 x 2 + 0.15 SP; 4 ticks of 60 + 0.13 SP
c6 = scrit('DRUID', 'TAUREN', 0)
md = (val(9835, 1) + 0.15 * 300) * RESIST
mt = (val(9835, 0) + 0.13 * 300) * RESIST
out['G6 Moonfire'] = dict(hit=md, tick=mt, expected=SPELL_LAND * (md + 4 * mt) * (1 + c6 / 100 * 0.5))
# G7 Warrior Heroic Strike r9 25286, Human, Arcanite Reaper
reaper = [weapons[12784]]
a7 = ap('WARRIOR', 'HUMAN', reaper)
w = (153 + 256) / 2 + a7 / 14 * 3.8
hs = (w + val(25286, 0)) * (1 - DR)
cr7 = mcrit('WARRIOR', 'HUMAN', reaper, 1) + SUPPRESS
out['G7 Heroic Strike'] = dict(ap=a7, hit=hs, crit=hs * 2, critChance=cr7, expected=SPECIAL_LAND * hs * (1 + cr7 / 100))
# G8 Mortal Strike r4 21553 (talent 1/1): normalized 3.3
ms = ((153 + 256) / 2 + a7 / 14 * 3.3 + val(21553, 1)) * (1 - DR)
out['G8 Mortal Strike'] = dict(hit=ms, expected=SPECIAL_LAND * ms * (1 + cr7 / 100))
# G9 Bloodthirst r4 23894 (talent 1/1): 48 + 45% AP, armor applies
bt = (val(23894, 0) + 0.45 * a7) * (1 - DR)
out['G9 Bloodthirst'] = dict(hit=bt, expected=SPECIAL_LAND * bt * (1 + cr7 / 100))
# G10 Rogue Sinister Strike r8 11294, Human, Brutality Blade MH (sword: normalized 2.4) + Chromatically Tempered Sword OH
rw = [weapons[18832], weapons[19352]]
a10 = ap('ROGUE', 'HUMAN', rw)
ss = ((90 + 168) / 2 + a10 / 14 * 2.4 + val(11294, 0)) * (1 - DR)
cr10 = mcrit('ROGUE', 'HUMAN', rw, 1) + SUPPRESS
out['G10 Sinister Strike'] = dict(ap=a10, hit=ss, expected=SPECIAL_LAND * ss * (1 + cr10 / 100), critChance=cr10)
# G11 Hunter Aimed Shot r6 20904, Dwarf, Rhok'delar + Thorium Headed Arrow: ranged 2.8 normalized, ammo dps x 2.9
hw = [weapons[18713]]
# the hunter rotations self-buff Aspect of the Hawk r7 (25296, aura 124: +120) and Hunter's Mark r4 (14325, aura 127: +143)
r11 = rap('HUNTER', 'DWARF', hw) + eff(25296, 0)['base'] + eff(14325, 1)['base']
aim = ((89 + 166) / 2 + ammo[18042]['dps'] * 2.9 + r11 / 14 * 2.8 + val(20904, 0)) * (1 - DR)
cr11 = mcrit('HUNTER', 'DWARF', hw) + SUPPRESS
land11 = 1 - (0.08 - 0.01)          # Dwarf Artisan's Precision +1% hit (below the 1% suppression gap? see note)
out['G11 Aimed Shot'] = dict(rap=r11, hit=aim, critChance=cr11, expected=RANGED_LAND * aim * (1 + cr11 / 100))
# G12 Paladin Holy Strike r8 10333, Human, Arcanite Reaper, +200 holy spell power: (W_norm(3.3) + 93 + 3.2 x 0 + 0.429 SP) x 50%, holy: no armor
a12 = ap('PALADIN', 'HUMAN', reaper)
hs12 = ((153 + 256) / 2 + a12 / 14 * 3.3 + val(10333, 0) + 0.429 * 200) * 0.5
cr12 = mcrit('PALADIN', 'HUMAN', reaper, 1) + SUPPRESS
out['G12 Holy Strike'] = dict(ap=a12, hit=hs12, expected=SPECIAL_LAND * hs12 * (1 + cr12 / 100))
# G13 Protection warrior basic rotation (Heroic Strike on next swing), Human, Reaper, no talents
white_hit = w * (1 - DR)
white_miss, dodge, glance = 8.0, 6.5, 40.0
wcrit = min(cr7, 100 - white_miss - dodge - glance)
whit = 100 - white_miss - dodge - glance - wcrit
e_white = white_hit * (whit + glance * GLANCE_MULT + wcrit * 2) / 100
swings = 60 / 3.8
rage_per_swing = 7.5 * e_white / RAGE_C
income = swings * rage_per_swing
n_hs = min(swings, income / (spells[25286]['costs'][0]['amount'] + rage_per_swing))
e_hs = out['G7 Heroic Strike']['expected']
dps13 = ((swings - n_hs) * e_white + n_hs * e_hs) / 60
out['G13 Prot HS rotation'] = dict(whiteExpected=e_white, ragePerSwing=rage_per_swing, hsPerMinute=n_hs, dps=dps13)
# G14 Frost mage rotation = G1 dps
out['G14 Frost rotation'] = dict(dps=out['G1 Frostbolt']['dps'])
json.dump(out, sys.stdout, indent=1)
```

### 10.3 Unit tests (exact files)

What they pin: combat formulas (glancing 0.65/0.85/0.95, resist 6%, rage c(60) = 230.6, form masks, white table
42.9/40/2.6, expected factors); rank selection (Fireball level 54 -> 10150, level 60 -> 25306; Mortal Strike gated,
level 40 -> talent spell 12294); weapon requirements (Backstab "requires a dagger", Shank "requires an off-hand
weapon"); spell mods (Improved Frostbolt cast 2.5 with its source line, Ice Shards crit x2, HS cost 15 - 3 - 3 = 9,
Convection 198, Improved Arcane Shot category cooldown 4.5, Flash of Steel energize 40 / cooldown 8); scripts
(Slice and Dice 21 x 1.45 s and +30% haste, Eviscerate 108 + 850 + 15% AP, Mutilate 1.71 cp, Judgement of Command
(356 + 0.429 x 200) x 0.5 x 1.15 and 6% base mana, Seal of Command proc); handlers (registry names = talent names,
22 handlers; Ignite, Lightning Overload, Improved Mind Flay tick = 180.1 x 1.331 x 0.94 x 3.64/3, Seal Fate,
Ruthlessness, Weaponmaster axe/mace, Predatory Strikes +90 AP + Agi in Cat Form, Flurry formula, Improved Scorch 15%,
Deep Wounds / rage handlers); rotations (27 well-formed rotations whose abilities exist, pickRotation, every rotation
finite and > 0 with its spec maxed, tier 1 skips nothing, shared category, DoT cap, Auto Shot loss, OOM, energy cycles).

`src/engine/combat/combat.test.ts` (exact):

```ts
import { describe, expect, it } from "vitest";
import { runDamage } from "@/testkit/damage";
import { weapon } from "@/testkit/stats";
import { averageResist, formMask, glancingMultiplier, rageConversion } from "./constants";
import { expectedFactor, resistFactor, schoolsOf, whiteTable } from "./outcome";

describe("combat constants", () => {
  it("glancing damage (vmangos low/high average)", () => {
    expect(glancingMultiplier(15)).toBeCloseTo(0.65, 10); // 300 skill vs boss
    expect(glancingMultiplier(10)).toBeCloseTo(0.85, 10);
    expect(glancingMultiplier(7)).toBeCloseTo(0.95, 10); // 308 skill
    expect(glancingMultiplier(0)).toBeCloseTo(0.95, 10);
  });
  it("partial resist, rage conversion, form masks", () => {
    expect(averageResist(24, 60)).toBeCloseTo(0.06, 10);
    expect(averageResist(5000, 60)).toBe(0.75);
    expect(rageConversion(60)).toBeCloseTo(230.6, 1);
    expect(formMask("cat")).toBe(1);
    expect(formMask("shadowform")).toBe(134217728);
    expect(formMask("moonkin")).toBe(1073741824);
    expect(formMask(null)).toBe(0);
    expect(schoolsOf(20)).toEqual(["fire", "frost"]);
  });
});

describe("outcome tables vs boss", () => {
  const r = runDamage({
    classToken: "warrior",
    race: "HUMAN",
    weapons: { mainHand: weapon(12784) },
    rotation: "warrior-protection",
  });
  it("white single roll: 8 miss, 6.5 dodge, 40 glancing at 65%, crit 2.6, rest hits", () => {
    const t = whiteTable(r.view.mainHand!, "mainHand", 300, 63);
    expect(t).toMatchObject({ miss: 8, dodge: 6.5, glancing: 40, glancingMultiplier: 0.65 });
    expect(t.crit).toBeCloseTo(2.6, 10);
    expect(t.hit).toBeCloseTo(42.9, 10);
    expect(t.factor).toBeCloseTo((42.9 + 40 * 0.65 + 2.6 * 2) / 100, 10);
  });
  it("two-roll expected factor and spell resist", () => {
    expect(expectedFactor({ land: 85.5, crit: 10, critBonus: 1 })).toBeCloseTo(0.855 * 1.1, 10);
    expect(expectedFactor({ land: 83, crit: 10, critBonus: 0.5 }, 2)).toBeCloseTo(0.83 * 1.1, 10);
    expect(resistFactor(r.view, 16, 60)).toBeCloseTo(0.94, 10); // frost vs +3 level boss
    expect(resistFactor(r.view, 2, 60)).toBe(1); // holy
    expect(resistFactor(r.view, 1, 60)).toBe(1); // physical
  });
});
```

`src/engine/abilities/abilities.test.ts` (exact):

```ts
import { describe, expect, it } from "vitest";
import { runDamage, spellFile } from "@/testkit/damage";
import { ammo, ranked, weapon } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import { buildSpellbook, learn } from "./spellbook";

const SWORDS = { mainHand: weapon(18832), offHand: weapon(19352) }; // Brutality Blade, Chromatically Tempered Sword
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 2);

describe("rank selection (learn)", () => {
  it("highest rank with BaseLevel <= level; talent abilities need the talent", () => {
    const mage = buildSpellbook(spellFile("mage"), 3, 1273);
    expect(learn(mage, "Fireball", 54, [], [])).toMatchObject({ spell: { id: 10150 } });
    expect(learn(mage, "Fireball", 60, [], [])).toMatchObject({ spell: { id: 25306 } }); // r12 (AQ book rank, also level 60)
    const tree = treeFor("warrior");
    const all = [...tree.nodes.values()].map((n) => n.talent);
    const war = buildSpellbook(spellFile("warrior"), 4, 0);
    expect(learn(war, "Mortal Strike", 60, [], all)).toEqual({ reason: "needs the talent Mortal Strike" });
    const ms = ranked("warrior", { "Mortal Strike": 1 });
    expect(learn(war, "Mortal Strike", 60, ms, all)).toMatchObject({ spell: { id: 21553 } });
    expect(learn(war, "Mortal Strike", 40, ms, all)).toMatchObject({ spell: { id: 12294 } }); // the talent spell is rank 1
  });
  it("weapon requirements make abilities unavailable", () => {
    const r = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: { mainHand: weapon(18832) },
      rotation: "rogue-subtlety",
    });
    expect(r.result.abilities.find((a) => a.key === "Backstab")).toEqual({
      key: "Backstab",
      available: false,
      reason: "requires a dagger",
    });
    const c = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: { mainHand: weapon(18832) },
      rotation: "rogue-combat",
    });
    expect(c.result.abilities.find((a) => a.key === "Shank")).toMatchObject({
      available: false,
      reason: "requires an off-hand weapon",
    });
  });
});

describe("spell modifiers (aura 107/108 by family mask)", () => {
  it("cast time, crit damage bonus and the 'modified by' lines", () => {
    const r = runDamage({
      classToken: "mage",
      race: "HUMAN",
      talents: { "Improved Frostbolt": 5, "Ice Shards": 5 },
      rotation: "mage-frost",
    });
    const a = r.ability("Frostbolt");
    expect(a.castTime).toBe(2.5);
    expect(a.critMultiplier).toBe(2);
    expect(a.sources).toEqual([
      { label: "Improved Frostbolt 5/5", kind: "talent", text: "−0.5 s cast time" },
      { label: "Ice Shards 5/5", kind: "talent", text: "+100% crit damage bonus" },
    ]);
  });
  it("rage cost modifiers are in tenths; percent cost; category cooldown", () => {
    const w = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: { mainHand: weapon(12784) },
      talents: { "Improved Heroic Strike": 3, "Focused Rage": 3 },
      rotation: "warrior-protection",
    });
    expect(w.ability("Heroic Strike").cost).toBe(9); // 15 - 3 - 3
    const s = runDamage({
      classToken: "shaman",
      race: "ORC",
      talents: { Convection: 5 },
      rotation: "shaman-elemental",
    });
    expect(s.ability("Lightning Bolt").cost).toBeCloseTo(198, 10); // 220 x 0.9
    const h = runDamage({
      classToken: "hunter",
      race: "DWARF",
      weapons: { ranged: weapon(18713), ammo: ammo(18042) },
      talents: { "Improved Arcane Shot": 5 },
      rotation: "hunter-marksmanship",
    });
    expect(h.ability("Arcane Shot")).toMatchObject({ cooldown: 4.5, category: 1173, categoryCooldown: 4.5 });
  });
  it("effect value modifier (op 12 = effect index 1): Flash of Steel adds Shank energy", () => {
    const r = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: SWORDS,
      talents: { "Flash of Steel": 5 },
      rotation: "rogue-combat",
    });
    expect(r.ability("Shank")).toMatchObject({ slot: "offHand", energize: 40, cooldown: 8, cost: 5 });
  });
});

describe("scripted abilities (section 6.4)", () => {
  it("Slice and Dice duration 6 + 3 per combo point, x Improved Slice and Dice", () => {
    const r = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: SWORDS,
      talents: { "Improved Slice and Dice": 3 },
      rotation: "rogue-combat",
    });
    near(r.ability("Slice and Dice").durationSec, 21 * 1.45);
    expect(r.stats.haste.melee.value).toBeCloseTo(30, 10); // Slice and Dice r2 aura 319 as a self-buff
  });
  it("Eviscerate 5 cp: 108 + 170 x 5 + 15% AP, armor", () => {
    const r = runDamage({ classToken: "rogue", race: "HUMAN", weapons: SWORDS, rotation: "rogue-combat" });
    near(r.ability("Eviscerate").hit, (108 + 850 + 0.15 * 356) * (1 - 3731 / 9231));
  });
  it("Mutilate: main- and off-hand strikes (W + 88) x 90%, 2 combo points per landed cast", () => {
    const r = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: { mainHand: weapon(19347), offHand: weapon(18832) },
      talents: { Mutilate: 1 },
      rotation: "rogue-assassination",
    });
    const a = r.ability("Mutilate");
    expect(a.spell.id).toBe(1241584);
    near(a.comboPoints, 2 * 0.855);
  });
  it("Judgement of Command (seal DUMMY chain -> 20966) at half damage; Seal of Command proc 70% weapon + 0.29 SP", () => {
    const r = runDamage({
      classToken: "paladin",
      race: "HUMAN",
      weapons: { mainHand: weapon(12784) },
      bonus: { holySpellPower: 200 },
      talents: { "Seal of Command": 1, "Improved Seals": 5 },
      rotation: "paladin-retribution",
    });
    const j = r.ability("Judgement");
    expect(j.spell.id).toBe(20271);
    near(j.hit, (356 + 0.429 * 200) * 0.5 * 1.15);
    near(j.cost, 0.06 * 1512);
    const soc = r.ability("Seal of Command (proc)");
    expect(soc.spell.id).toBe(20424);
    near(soc.hit, ((153 + 256) / 2 + (432 / 14) * 3.8) * 0.7 * 1.15 + 0.29 * 200 * 1.15);
  });
});
```

`src/engine/talents/special/special.test.ts` (exact):

```ts
import { describe, expect, it } from "vitest";
import { runDamage } from "@/testkit/damage";
import { weapon } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import type { ClassToken } from "@/data/types";
import { SPECIAL_HANDLERS } from "./handlers";

describe("special handler registry", () => {
  it("every handler id is a talent spell with the same name", () => {
    const talents = (
      [
        "warrior",
        "paladin",
        "hunter",
        "rogue",
        "priest",
        "shaman",
        "mage",
        "warlock",
        "druid",
      ] as ClassToken[]
    ).flatMap((t) => [...treeFor(t).nodes.values()].map((n) => n.talent));
    for (const h of SPECIAL_HANDLERS.values()) {
      const t = talents.find((x) => x.spellId === h.spellId);
      expect(t?.name, String(h.spellId)).toBe(h.name);
    }
    expect(SPECIAL_HANDLERS.size).toBe(22);
  });
});

describe("ability hooks", () => {
  it("Ignite: 40% of the expected crit damage of Fire spells", () => {
    const r = runDamage({
      classToken: "mage",
      race: "HUMAN",
      bonus: { spellPower: 500 },
      talents: { Ignite: 5 },
      rotation: "mage-fire",
    });
    const a = r.ability("Fireball");
    const ignite = a.extras.find((x) => x.label === "Ignite 5/5")!.value;
    expect(ignite).toBeCloseTo((a.hitChance / 100) * (a.critChance / 100) * a.crit * 0.4, 6);
  });
  it("Lightning Overload: +30% x 50% of the direct expected damage", () => {
    const r = runDamage({
      classToken: "shaman",
      race: "ORC",
      talents: { "Lightning Overload": 3 },
      rotation: "shaman-elemental",
    });
    const a = r.ability("Lightning Bolt");
    expect(a.extras[0]!.value).toBeCloseTo(a.expectedDirect * 0.15, 6);
  });
  it("Improved Mind Flay: ticks x (1 + 1.2 + 1.44) / 3; Shadowform doubles the crit bonus", () => {
    const r = runDamage({
      classToken: "priest",
      race: "HUMAN",
      bonus: { spellPower: 300 },
      talents: { "Mind Flay": 1, "Improved Mind Flay": 2, Shadowform: 1, Darkness: 5, "Shadow Weaving": 3 },
      rotation: "priest-shadow",
    });
    const a = r.ability("Mind Flay");
    // (130 + 0.167 x 300) x Darkness 1.1 x Shadowform 1.1 x Shadow Weaving 1.1 x resist 0.94 x ramp 1.21333
    expect(a.tick).toBeCloseTo(180.1 * 1.331 * 0.94 * (3.64 / 3), 2);
    expect(a.critMultiplier).toBe(2);
    expect(a.ticks).toBe(3);
  });
  it("Seal Fate and Ruthlessness change combo points", () => {
    const r = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: { mainHand: weapon(18832), offHand: weapon(19352) },
      talents: { "Seal Fate": 3, Ruthlessness: 3 },
      rotation: "rogue-combat",
    });
    const ss = r.ability("Sinister Strike");
    expect(ss.comboPoints).toBeCloseTo(0.855 * (1 + ss.critChance / 100), 10);
    expect(r.ability("Eviscerate").cpRefund).toBeCloseTo(0.6, 10);
  });
});

describe("stat hooks", () => {
  it("Weaponmaster: axe crit, mace armor penetration", () => {
    const axe = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: { mainHand: weapon(12784) },
      talents: { Weaponmaster: 5 },
      rotation: "warrior-arms",
    });
    expect(axe.stats.crit.mainHand.parts).toContainEqual(
      expect.objectContaining({ label: "Weaponmaster 5/5", value: 5 }),
    );
    const mace = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: { mainHand: weapon(17182) },
      talents: { Weaponmaster: 5 },
      rotation: "warrior-arms",
    });
    expect(mace.stats.armorPenPct.value).toBe(15);
  });
  it("Predatory Strikes: +150% of level as attack power in Cat Form; Cat Form adds Agility", () => {
    const base = runDamage({ classToken: "druid", race: "TAUREN", rotation: "druid-balance" });
    const cat = runDamage({
      classToken: "druid",
      race: "TAUREN",
      talents: { "Predatory Strikes": 3 },
      rotation: "druid-feral",
    });
    expect(cat.stats.attackPower.value - base.stats.attackPower.value).toBeCloseTo(
      90 + cat.stats.primary.agi.value,
      10,
    );
  });
});

describe("rotation hooks (pass 2)", () => {
  it("Flurry: +30% x (1 - (1 - white crit)^3) swing speed", () => {
    const r = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: { mainHand: weapon(12784) },
      talents: { Flurry: 3 },
      bonus: { crit: 20 },
      rotation: "warrior-fury",
    });
    const c = r.result.rotation.white.mainHand!.white.critChance / 100;
    expect(r.result.effects.find((e) => e.label === "Flurry 3/3")!.meleeHastePct).toBeCloseTo(
      30 * (1 - (1 - c) ** 3),
      10,
    );
    expect(r.result.rotation.white.mainHand!.white.speed).toBeCloseTo(
      3.8 / (1 + (30 * (1 - (1 - c) ** 3)) / 100),
      10,
    );
  });
  it("Improved Scorch: 3% x 5 stacks of Fire Vulnerability (spell 22959) when Scorch is maintained", () => {
    const r = runDamage({
      classToken: "mage",
      race: "HUMAN",
      talents: { "Improved Scorch": 3 },
      rotation: "mage-fire",
    });
    expect(r.result.effects).toContainEqual({
      label: "Improved Scorch 3/3",
      damagePct: { schools: ["fire"], pct: 15 },
    });
    const no = runDamage({ classToken: "mage", race: "HUMAN", rotation: "mage-fire" });
    expect(no.result.rotation.skipped).toContainEqual({
      ability: "Scorch",
      reason: "needs the talent Improved Scorch",
    });
  });
  it("Deep Wounds, Unbridled Wrath and Anger Management add damage and rage", () => {
    const r = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: { mainHand: weapon(12784) },
      talents: { "Deep Wounds": 3, "Unbridled Wrath": 5, "Anger Management": 1 },
      rotation: "warrior-arms",
    });
    const fx = r.result.effects;
    expect(fx.find((e) => e.label === "Deep Wounds 3/3")!.extraDps).toBeGreaterThan(0);
    expect(fx.find((e) => e.label === "Anger Management 1/1")!.ragePerMinute).toBe(20);
    expect(fx.find((e) => e.label === "Unbridled Wrath 5/5")!.ragePerMinute).toBeGreaterThan(0);
  });
});
```

`src/engine/rotation/rotation.test.ts` (exact):

```ts
import { describe, expect, it } from "vitest";
import { rotations, runDamage, spellFile } from "@/testkit/damage";
import { ammo, weapon } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import type { ClassToken } from "@/data/types";
import { pickRotation } from "./selfBuffs";

const WEAPONS: Record<ClassToken, Record<string, unknown>> = {
  warrior: { mainHand: weapon(12784) },
  paladin: { mainHand: weapon(12784) },
  hunter: { ranged: weapon(18713), ammo: ammo(18042) },
  rogue: { mainHand: weapon(18832), offHand: weapon(19352) },
  shaman: { mainHand: weapon(12784) },
  druid: {},
  priest: {},
  mage: {},
  warlock: {},
};
const RACE: Record<ClassToken, string> = {
  warrior: "HUMAN",
  paladin: "HUMAN",
  hunter: "DWARF",
  rogue: "HUMAN",
  priest: "HUMAN",
  shaman: "ORC",
  mage: "HUMAN",
  warlock: "HUMAN",
  druid: "TAUREN",
};

describe("rotations.json", () => {
  it("27 rotations, one per class and spec, abilities exist in the class spell file", () => {
    expect(rotations.rotations).toHaveLength(27);
    expect(new Set(rotations.rotations.map((r) => r.id)).size).toBe(27);
    for (const r of rotations.rotations) {
      const file = spellFile(r.class);
      const talentAbilities = [...treeFor(r.class).nodes.values()]
        .filter((n) => n.talent.kind === "ability")
        .map((n) => n.talent.name);
      for (const name of [...r.selfBuffs, ...r.entries.map((e) => e.ability)])
        expect(
          file.abilities.some((c) => c.name === name) || talentAbilities.includes(name),
          `${r.id}: ${name}`,
        ).toBe(true);
      expect([0, 1, 2]).toContain(r.spec);
      if (r.tier === 3) expect(r.role).not.toBe("dps");
    }
  });
  it("pickRotation: most points; ties and no points pick a dps spec", () => {
    const p = (t: ClassToken, pts: number[]) => pickRotation(rotations, t, pts).id;
    expect(p("warrior", [0, 0, 0])).toBe("warrior-arms");
    expect(p("paladin", [0, 0, 0])).toBe("paladin-retribution");
    expect(p("priest", [0, 0, 0])).toBe("priest-shadow");
    expect(p("mage", [10, 31, 10])).toBe("mage-fire");
    expect(p("priest", [21, 30, 0])).toBe("priest-holy");
    expect(p("druid", [0, 0, 31])).toBe("druid-restoration");
  });
});

describe("every rotation with its spec at max rank", () => {
  for (const r of rotations.rotations) {
    it(r.id, () => {
      const talents: Record<string, number> = {};
      for (const n of treeFor(r.class).nodes.values())
        if (n.specIndex === r.spec) talents[n.talent.name] = n.talent.maxRank;
      const d = runDamage({
        classToken: r.class,
        race: RACE[r.class],
        weapons: WEAPONS[r.class] as never,
        talents,
        rotation: r.id,
      });
      const rot = d.result.rotation;
      expect(Number.isFinite(rot.dps) && rot.dps > 0).toBe(true);
      for (const c of rot.casts) expect(Number.isFinite(c.dps) && c.perMinute >= 0).toBe(true);
      if (r.tier === 1) expect(rot.skipped.filter((s) => !s.reason.endsWith("is the builder"))).toEqual([]);
    });
  }
});

describe("analytical model", () => {
  const mm = runDamage({
    classToken: "hunter",
    race: "DWARF",
    weapons: WEAPONS.hunter as never,
    rotation: "hunter-marksmanship",
  });
  const casts = Object.fromEntries(mm.result.rotation.casts.map((c) => [c.key, c]));
  it("shared category cooldown: Aimed Shot uses the whole 6 s category, Multi-Shot gets none", () => {
    expect(casts["Aimed Shot"]!.perMinute).toBeCloseTo(10, 10);
    expect(casts["Multi-Shot"]!.perMinute).toBeCloseTo(0, 10);
  });
  it("DoT entries are capped by their duration; Auto Shot loses the time spent casting", () => {
    expect(casts["Serpent Sting"]).toMatchObject({ perMinute: 4, limit: "duration" });
    expect(mm.result.rotation.white.ranged!.swingsPerMinute).toBeCloseTo((60 / 2.9) * (1 - 20 / 60), 10);
  });
  it("mana is reported, never limiting", () => {
    const rot = mm.result.rotation;
    expect(rot.resource).toBeNull();
    expect(rot.oomSeconds!).toBeCloseTo(mm.stats.mana!.value / rot.manaPerSecond, 10);
  });
  it("energy: finisher cycles buy builder casts; Shank's net energy feeds them", () => {
    const r = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: WEAPONS.rogue as never,
      rotation: "rogue-combat",
    });
    const c = Object.fromEntries(r.result.rotation.casts.map((x) => [x.key, x]));
    const ss = r.ability("Sinister Strike");
    const builderPerFinisher = 5 / ss.comboPoints; // 5 / 0.855
    expect(c["Shank"]).toMatchObject({ perMinute: 6, limit: "cooldown" }); // 10 s cooldown, +25 energy for 5
    // Shank generates (net -20) so it is processed first: 600 + 6 x 20 energy buy Slice and Dice cycles
    // (25 + 5.85 x 45 each); none is left for Eviscerate
    expect(c["Slice and Dice"]).toMatchObject({ limit: "resource" });
    expect(c["Slice and Dice"]!.perMinute).toBeCloseTo(720 / (25 + builderPerFinisher * 45), 10);
    expect(c["Eviscerate"]!.perMinute).toBeCloseTo(0, 10);
    expect(c["Sinister Strike"]!.perMinute).toBeCloseTo(
      builderPerFinisher * c["Slice and Dice"]!.perMinute,
      8,
    );
    expect(r.result.rotation.resource).toMatchObject({ power: "energy", incomePerMinute: 600 });
  });
});
```

`src/engine/rotation/golden.test.ts` (exact):

```ts
// Golden values computed independently by docs/phase4-implementation-plan.md section 10.2 (Python, reads the same JSON).
// Level 60 vs boss (level 63, 3731 armor, DR 40.42%), no buffs. Q2: the spell base points are Forever data, not Classic.
import { describe, expect, it } from "vitest";
import { runDamage } from "@/testkit/damage";
import { ammo, weapon } from "@/testkit/stats";

const REAPER = { mainHand: weapon(12784) };
const near = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 2);

describe("golden: spells (Human unless noted, resist 6%, spell hit 83%)", () => {
  it("G1 Frostbolt r11, +500 spell power", () => {
    const r = runDamage({
      classToken: "mage",
      race: "HUMAN",
      bonus: { spellPower: 500 },
      rotation: "mage-frost",
    });
    const a = r.ability("Frostbolt");
    expect(a.spell.id).toBe(25304);
    near(a.hit, 829.08);
    near(a.crit, 1243.62);
    near(a.critChance, 3.300840336134454);
    near(a.expected, 699.4935419294117);
    near(a.castTime, 3);
    near(r.result.rotation.dps, 233.16451397647054); // G14: Frostbolt spam
  });
  it("G2 Fireball r12: direct + 4 ticks (DoT ticks crit)", () => {
    const r = runDamage({
      classToken: "mage",
      race: "HUMAN",
      bonus: { spellPower: 500 },
      rotation: "mage-fire",
    });
    const a = r.ability("Fireball");
    expect(a.spell.id).toBe(25306);
    near(a.hit, 924.02);
    near(a.tick, 14.1);
    expect(a.ticks).toBe(4);
    near(a.expected, 827.1788710117646);
    near(a.castTime, 3.5);
  });
  it("G3 Shadow Bolt r10 with Bane 5/5 and Ruin 5/5, +400", () => {
    const r = runDamage({
      classToken: "warlock",
      race: "HUMAN",
      bonus: { spellPower: 400 },
      talents: { Bane: 5, Ruin: 5 },
      rotation: "warlock-destruction",
    });
    const a = r.ability("Shadow Bolt");
    near(a.hit, 574.152);
    near(a.crit, 1148.304);
    near(a.critChance, 4.432673267326733);
    near(a.castTime, 2.5);
    near(a.expected, 497.66989424079196);
    expect(a.sources.map((s) => s.label)).toEqual(expect.arrayContaining(["Bane 5/5", "Ruin 5/5"]));
  });
  it("G4 Mind Blast r9: level scaling +2.6 x 2", () => {
    const r = runDamage({
      classToken: "priest",
      race: "HUMAN",
      bonus: { spellPower: 300 },
      rotation: "priest-shadow",
    });
    const a = r.ability("Mind Blast");
    near(a.hit, 581.766);
    near(a.expected, 492.10548195243246);
    near(a.cooldown, 8);
  });
  it("G5 Lightning Bolt r10 (Orc): level scaling +2.1 x 4", () => {
    const r = runDamage({
      classToken: "shaman",
      race: "ORC",
      bonus: { spellPower: 300 },
      rotation: "shaman-elemental",
    });
    const a = r.ability("Lightning Bolt");
    near(a.hit, 541.064);
    near(a.expected, 459.7762042060503);
    near(a.castTime, 2.5);
  });
  it("G6 Moonfire r10 (Tauren): hybrid direct + periodic", () => {
    const r = runDamage({
      classToken: "druid",
      race: "TAUREN",
      bonus: { spellPower: 300 },
      rotation: "druid-balance",
    });
    const a = r.ability("Moonfire");
    near(a.hit, 173.524);
    near(a.tick, 93.06);
    near(a.expected, 460.7603473933333);
  });
});

describe("golden: weapon attacks (special table: 8% miss, 6.5% dodge, crit -2.4%)", () => {
  it("G7 Heroic Strike r9, Arcanite Reaper (non-normalized 3.8)", () => {
    const r = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: REAPER,
      rotation: "warrior-protection",
    });
    const a = r.ability("Heroic Strike");
    expect(r.stats.attackPower.value).toBe(462);
    near(a.hit, 290.103997400065);
    near(a.crit, 580.20799480013);
    near(a.critChance, 2.6);
    near(a.hitChance, 85.5);
    near(a.expected, 254.48792963925902);
  });
  it("G8 Mortal Strike r4 (normalized 3.3) and G9 Bloodthirst r4 (45% AP)", () => {
    const r = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: REAPER,
      talents: { "Mortal Strike": 1, Bloodthirst: 1 },
      rotation: "warrior-arms",
    });
    near(r.ability("Mortal Strike").hit, 282.06044848878776);
    near(r.ability("Mortal Strike").expected, 247.4318872278193);
    const f = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: REAPER,
      talents: { "Mortal Strike": 1, Bloodthirst: 1 },
      rotation: "warrior-fury",
    });
    near(f.ability("Bloodthirst").hit, 152.4699382515437);
    near(f.ability("Bloodthirst").expected, 133.7512039324017);
  });
  it("G10 Sinister Strike r8, Brutality Blade (sword: normalized 2.4)", () => {
    const r = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: { mainHand: weapon(18832), offHand: weapon(19352) },
      rotation: "rogue-combat",
    });
    const a = r.ability("Sinister Strike");
    expect(r.stats.attackPower.value).toBe(356);
    near(a.hit, 153.73818035501492);
    near(a.critChance, 3.875862068965517);
    near(a.expected, 136.54081544784037);
  });
  it("G11 Aimed Shot r6 (Dwarf), Rhok'delar + Thorium Headed Arrow, Aspect of the Hawk + Hunter's Mark (normalized 2.8, ammo x 2.9, no dodge)", () => {
    const r = runDamage({
      classToken: "hunter",
      race: "DWARF",
      weapons: { ranged: weapon(18713), ammo: ammo(18042) },
      rotation: "hunter-marksmanship",
    });
    const a = r.ability("Aimed Shot");
    expect(r.stats.rangedAttackPower!.value).toBe(632); // 369 + 120 (Aspect of the Hawk) + 143 (Hunter's Mark)
    near(a.hit, 390.41539378182216);
    near(a.critChance, 0.8830188679245285);
    near(a.hitChance, 92); // Dwarf +1% hit is eaten by the 1% suppression
    near(a.expected, 362.3538085424217);
  });
  it("G12 Holy Strike r8, Arcanite Reaper, +200 holy spell power: (W + 93 + 0.429 SP) x 50%, no armor", () => {
    const r = runDamage({
      classToken: "paladin",
      race: "HUMAN",
      weapons: REAPER,
      bonus: { holySpellPower: 200 },
      rotation: "paladin-holy",
    });
    near(r.ability("Holy Strike").hit, 242.56428571428572);
    near(r.ability("Holy Strike").expected, 212.680972125);
  });
});

describe("golden: rotations", () => {
  it("G13 warrior basic: rage from white swings, Heroic Strike with the rest", () => {
    const r = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: REAPER,
      rotation: "warrior-protection",
    });
    const rot = r.result.rotation;
    near(rot.white.mainHand!.white.expectedPerSwing, 145.65133246668836);
    near(rot.casts.find((c) => c.key === "Heroic Strike")!.perMinute, 3.7896561442847965);
    near(rot.dps, 45.2035193375176);
  });
});
```

### 10.4 Performance budget: `src/state/perf.test.ts` (exact)

Measured in the prototype: warrior 1.11 ms, rogue 1.02 ms, mage 0.77 ms, hunter 0.96 ms per `derive` (every talent of
a spec at max rank, raid buffs + debuffs, custom target = 5 targets, 2 passes each). The test fails above 5 ms.

`src/state/perf.test.ts` (exact):

```ts
import { describe, expect, it } from "vitest";
import { buffsFile } from "@/data";
import { treeFor } from "@/testkit/talents";
import { weaponsFile } from "@/testkit/stats";
import { spellFile } from "@/testkit/damage";
import { EMPTY_BONUS } from "@/engine/stats";
import { DEFAULT_CUSTOM, NO_WEAPON_IDS } from "./character";
import { derive } from "./derived";
import type { ClassToken } from "@/data/types";

/** Every talent of one spec at max rank (the engine does not enforce point rules): the heaviest realistic load. */
function maxSpec(token: ClassToken, spec: number): Record<number, number> {
  const tree = treeFor(token);
  const ranks: Record<number, number> = {};
  for (const n of tree.nodes.values()) if (n.specIndex === spec) ranks[n.talent.nodeId] = n.talent.maxRank;
  return ranks;
}

describe("performance budget (section 10.4)", () => {
  it("derive with damage vs 5 targets stays under 5 ms per talent click", () => {
    const cases: [ClassToken, number, number, Partial<typeof NO_WEAPON_IDS>][] = [
      ["warrior", 1, 1, { mainHand: 18832, offHand: 19352 }],
      ["rogue", 1, 1, { mainHand: 18832, offHand: 19352 }],
      ["mage", 1, 1, {}],
      ["hunter", 1, 3, { ranged: 18713, ammo: 18042 }],
    ];
    for (const [token, spec, raceId, weapons] of cases) {
      const calc = { tree: treeFor(token), ranks: maxSpec(token, spec), level: 60, spells: spellFile(token) };
      const ch = {
        raceId,
        weaponIds: { ...NO_WEAPON_IDS, ...weapons },
        bonus: EMPTY_BONUS,
        buffIds: [...buffsFile.presets.raidBuffs, ...buffsFile.presets.raidDebuffs],
        target: "custom" as const, // 5 targets
        custom: DEFAULT_CUSTOM,
        weapons: weaponsFile,
      };
      for (let i = 0; i < 20; i++) derive(calc, ch); // warm-up (JIT)
      const n = 100;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) derive(calc, ch);
      const ms = (performance.now() - t0) / n;
      console.log(`${token}: ${ms.toFixed(3)} ms per derive`);
      expect(ms).toBeLessThan(5);
    }
  });
});
```

### 10.5 Playwright

`e2e/damage.spec.ts` (new, exact) and an extra test in `e2e/mobile.spec.ts` (diff). Both run with the existing
config; the prototype ran them with system Chrome (`channel: "chrome"`) because Playwright's Chromium download is
blocked in that sandbox; use `npm run e2e` normally.

`e2e/damage.spec.ts` (exact):

```ts
import { expect, test } from "@playwright/test";
import { blockRemoteImages, node, watchErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  await blockRemoteImages(page);
});

test("damage panel: frost mage numbers and live recompute", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Mage", exact: true }).click();
  const panel = page.getByTestId("damage-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("dps-rotation")).toContainText("Arcane"); // no points: first dps spec
  // 10 points in Frost: Frost rotation, Frostbolt cast 3.0 s -> 2.5 s with Improved Frostbolt 5/5
  const ifb = node(page, "Improved Frostbolt");
  for (let i = 0; i < 5; i++) await ifb.click();
  await expect(page.getByTestId("dps-rotation")).toContainText("Frost: Frostbolt");
  const card = page.getByTestId("ability-frostbolt");
  await expect(card).toContainText("2.50 s cast");
  await expect(card).toContainText("Improved Frostbolt 5/5: −0.5 s cast time");
  await expect(page.getByTestId("ability-frostbolt-hitchance")).toHaveText("83.00%");
  const before = Number(await page.getByTestId("dps-total").textContent());
  const ice = node(page, "Ice Shards");
  for (let i = 0; i < 5; i++) await ice.click();
  await expect(page.getByTestId("dps-total")).not.toHaveText(String(before));
  await expect(page.getByTestId("strip-dps")).toHaveText(await page.getByTestId("dps-total").innerText());
  await expect(page.getByTestId("dps-row-frostbolt")).toBeVisible();
  w.check();
});

test("damage panel: warrior heroic strike golden and reference DPS column", async ({ page }) => {
  const w = watchErrors(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Warrior", exact: true }).click();
  await page.getByTestId("weapon-mainHand").fill("Arcanite Reaper");
  await page.locator('[role=option][data-item-id="12784"]').click();
  // Protection basic rotation: 1 point in Protection (Improved Bloodrage)
  await node(page, "Improved Bloodrage").click();
  await expect(page.getByTestId("dps-rotation")).toContainText("Basic: Heroic Strike");
  await expect(page.getByTestId("dps-tier")).toHaveText("Tier 3");
  await expect(page.getByTestId("ability-heroic-strike-hit")).toHaveText("290 (259–321)"); // golden G7: (W + 157 +- 51.5) x (1 - DR)
  await expect(page.getByTestId("ability-heroic-strike-crit")).toHaveText("580");
  await expect(page.getByTestId("dps-total")).toHaveText("45.2"); // golden G13
  const ref = page.getByTestId("reference-table");
  await expect(ref.locator("thead")).toContainText("DPS");
  await expect(ref.locator("tbody tr").first().locator("td").last()).toHaveText("45.2");
  w.check();
});
```

`e2e/mobile.spec.ts` (diff):

```diff
--- a/e2e/mobile.spec.ts
+++ b/e2e/mobile.spec.ts
@@ -32,3 +32,12 @@
   await page.getByRole("tab", { name: "Talents" }).click();
   await expect(page.getByTestId("tree-0")).toBeVisible();
 });
+
+test("mobile: Damage tab shows the damage panel", async ({ page }) => {
+  await blockRemoteImages(page);
+  await page.goto("./");
+  await page.getByRole("button", { name: "Mage", exact: true }).click();
+  await page.getByRole("tab", { name: "Damage" }).click();
+  await expect(page.getByTestId("damage-panel")).toBeVisible();
+  await expect(page.getByTestId("dps-total")).not.toHaveText("");
+});
```

---

## 11. Ordered task list

Commit after each task (attribution lines per the session reminder). Keep `npm run format:check`, `npm run lint`,
`npm test`, `npm run typecheck` green from T3 on.

| Task | Work | Acceptance check |
|---|---|---|
| T1 | Section 2: pipeline diffs, `test_phase4.py`, regenerate | 50 pipeline tests OK; `spells 2340`; only `manifest.json`, `spells.json`, `spells/*.json` changed; commit data |
| T2 | Section 3: `data/manual/rotations.json` | valid JSON, 27 rotations |
| T3 | Section 4: types, `index.ts`, `manual.test.ts` | `npm run typecheck` |
| T4 | Section 5: stat-engine diffs + `stats.test.ts` diff | `npx vitest run src/engine/stats` (stats tests incl. Careful Aim, Wand Specialization, Sharpened Claws in Cat Form) |
| T5 | 6.7 combat + `combat.test.ts` | tests pass |
| T6 | 6.8 abilities + `src/testkit/damage.ts` (needs T7/T8 files to compile: add T5-T8 files, then run tests) | `abilities.test.ts` passes |
| T7 | 7.3 handlers + `special.test.ts` | passes |
| T8 | 6.9 rotation + `rotation.test.ts` + `golden.test.ts` | all goldens pass to 2 decimals |
| T9 | Section 8: store, `derived.ts`, `useDerived`, `derived.test.ts`, `perf.test.ts` | `npm test` green (220 tests); perf < 5 ms |
| T10 | Section 9: UI files + diffs | `npm run build`; manual check: Frost mage card shows "2.50 s cast", warrior HS card "290 (259-321)" |
| T11 | Section 10.5 Playwright | `npm run e2e` green (desktop + mobile, 24 tests) |
| T12 | Section 12 docs; screenshot `docs/screenshots/phase4-damage.png` (Damage panel, golden mage link) | docs updated in the same commit as the last change or a final docs commit |

---

## 12. Documentation updates (task T12)

- **PLAN.md**: Phase 4 -> ✅; tick all checkboxes, reworded: "Apply spell mods (107/108 by family mask), aura 79 by
  school and weapon slot; glancing damage"; "Outcome tables: melee white, melee/ranged special, spell (reuse
  TargetView)"; "Armor, partial resists (average), glancing"; "Spell damage: direct, DoT (per-tick coefficients,
  ticks crit), channeled, hybrid, missiles; level scaling; rank = highest learnable"; "Weapon specials (effects
  17/58/121/31 in index order, normalized speeds), scripted specials (Bloodthirst, finishers, Judgement, Mutilate,
  Shank)"; "22 special talent handlers (Ignite, Fire Power, Flurry, Deep Wounds, Unbridled Wrath, Improved Shadow Bolt,
  Shadow Weaving, Nightfall, Seal Fate, ...)"; "Damage panel: per-ability cards (hit, crit, expected, DPCT, chances,
  timing, cost, sources), DPS breakdown"; "Default rotations for 27 specs (tier 1/2/3) in data/manual/rotations.json;
  analytical DPS, live (~1 ms per click)"; "Golden tests per class (13 cases, independent Python check)". Output line:
  pipeline v3 (`spells/<class>.json`), test counts (50 pipeline, 220 Vitest, 24 Playwright), open items Q47-Q58.
  Phase 5 bullet "Rotation editor" adds "(URL record for rotation choice; Phase 4 picks the dominant spec)".
- **CALC_MODEL.md**: section 2 - add the white/special/spell expected-damage formulas (6.3/6.5), crit bonuses, ranged
  no-dodge, glancing average formula (replace "-30%" with vmangos average: 65% at 300 vs 315, 95% at 308+), resist
  average. Section 4 - replace "coefficient applies to the whole DoT" with "per tick"; add level scaling with
  `levels.max`, weapon effect sequence, normalized speeds, spCoef only for non-physical schools, SpellModOp table
  (1.3), aura 79 slots, scripted spells (6.4), aura 598/580. Section 6 - the analytical model (6.6) with its
  approximations, rage/energy/mana rules, two passes, rotation tiers. Talent table: replace "DUMMY: Ignite, Fire Power:
  need handlers" with a pointer to the handler list.
- **ARCHITECTURE.md**: generated contracts - `spells/<class>.json` (lazy, loaded with the talent file), judgement
  closure; manual - `rotations.json`; engine module list (6.1) and import direction; state - `CalcState.spells`,
  `Derived.damage/notModeled`, reference `dps` filled; UI - `src/ui/results`, `src/ui/abilities`.
- **DATA_SOURCES.md**: Phase 4 findings: section 1.1-1.4 tables (field semantics, effect enum, SpellModOp, Forever
  ability changes, judgements via DUMMY base points, castMs -1000000, apCoef never set, aura 598/580, Fire
  Vulnerability/Shadow Weaving aura 270 values).
- **OPEN_QUESTIONS.md**: add Q47-Q58 (section 13); update Q2 (Phase 4 uses the data; the five-spell comparison table
  in section 0), Q23 (598/580 identified), Q40 (wands: no Shoot spell in class data, not modeled), Q45 (unchanged).
- **README.md**: mention the Damage panel.

---

## 13. Remaining uncertainties (add as Q47-Q58 to OPEN_QUESTIONS.md, status ❓)

| # | Question | Why it matters | How to resolve |
|---|---|---|---|
| Q47 | Do DoT/channel ticks crit in Forever (modern engine default), and with which crit chance? | Warlock/priest/druid DPS (+3-10%) | Combat log of Corruption/SW:P ticks |
| Q48 | Weapon effect order: is the flat bonus of 121/17/58 multiplied by a later 31 (Backstab = 1.5 W + 225, Mutilate tooltip) also for Holy Strike (tooltip shows 81-105 unhalved) and Counterattack? | Paladin, hunter melee | Holy Strike hits vs a dummy with a known weapon |
| Q49 | Can ranged attacks be dodged? (Phase 4: no) | Hunter DPS (~6%) | Target-dummy logs |
| Q50 | Average partial resist (0.75 x R / 5L, +8 per level) and binary spells in Forever | Caster DPS (6% vs boss) | Logs: resist rate vs boss |
| Q51 | Rage from damage dealt: Classic `7.5 x dmg / c(L)` or the modern weapon-speed formula? Do Heroic Strike swings generate rage? | Warrior DPS | Rage gained per white hit at known damage |
| Q52 | Do percent spell modifiers and aura 79s multiply (modern) or add (Classic)? | Stacked talents | Two-talent test (e.g. Darkness + Shadowform) |
| Q53 | AP scaling of Eviscerate, Ferocious Bite, Rip (not in client data; TBC values used) | Rogue/feral DPS | Tooltip at two AP values |
| Q54 | Seal of Command proc rate (7 PPM assumed) and Windfury Weapon (tooltip: 20%, 2 attacks, +333 AP; white hits only?) | Ret / Enhancement | Proc counts in logs |
| Q55 | Cat Form weapon (level x 0.85-1.25 per 1.0 s, AP + Agi) and form passives (Cat Form (Passive) has 107/108 auras, not modeled) | Feral DPS | Cat Form character sheet and Claw hits |
| Q56 | Forever Whirlwind with an off hand: does it really strike with both weapons, at the off-hand penalty? | Fury DPS | Whirlwind hits in logs |
| Q57 | Spell haste on GCD (not hasted in Phase 4), ranged haste on Aimed/Sniper Shot casts, no haste on melee casts | Haste value | In-game cast bars |
| Q58 | Judgement of Command halved unless the target is stunned (tooltip) and Judgement being off the GCD (gcdMs 0) | Ret DPS | Logs |

Also still relevant: Q2 (spell base points), Q3/Q34 (outcome constants), Q16/Q17 (talent values), Q33 (base crit),
Q35 (ratings), Q40 (wands), Q46 (shields), Q5 (pets, Phase 6).
