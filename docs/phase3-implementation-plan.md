# Phase 3 implementation plan: Character & gear model

Audience: the agent that implements Phase 3. Follow this document literally. When it says "exactly", copy
the value or code. When something here contradicts an older doc, this document wins for Phase 3, and task T12
updates the older doc.

Everything below was checked against `data/generated/1.60.1.70888/`, `data/raw/1.60.1.70888/` and four extra
DB2 tables fetched from wago.tools (`SpellEquippedItems`, `CharBaseInfo`, `SkillRaceClassInfo`, `ChrClassRaceSex`)
on 2026-11-12. The pipeline changes (section 2), manual data (section 3), the stat engine (section 5), the URL
codec (section 6) and the state layer (section 7) were implemented as a prototype in a scratch copy of the repo:
`python3 -m unittest` (48 tests), `tsc -b`, `vitest run` (144 tests), `eslint .`, `prettier --check src` and
`vite build` all passed. The code blocks in this document **are** that prototype; copy them. The UI (section 8)
and the Playwright tests (section 9.6) were not prototyped and are specified in prose.

---

## 0. Key decisions (summary)

| Topic | Decision |
|---|---|
| Base stats | Keep `data/manual/base-stats.json` (level 60 only, 9 classes, 8 race offsets, all `[VERIFY]`). Add attack power formulas and numeric crit ratios. Remove `validCombos`: race/class combos now come from the client (`CharBaseInfo`). The engine takes `level` as input and throws `UnsupportedLevelError` for any level other than the file's `level` (60). |
| Race/class combos | **Generated**: `classes.json` `classes[].raceIds` from `CharBaseInfo`. Forever has 6 combos Classic does not: Undead Paladin, Dwarf Shaman, Human Hunter, Gnome Priest, Orc Mage, Troll Warlock (Q39). Base stats for those are class base + race offset. |
| Weapon proficiency | **Generated**: `classes[].weaponSubclasses` from `SkillLineAbility` weapon skill lines (`AcquireMethod != 3`), identical to `SkillRaceClassInfo` for every weapon skill. Differences from Classic: Rogues get one-hand axes, Druids get polearms (Q38). `classes[].dualWield` from skill line 118: Warrior, Hunter, Rogue (the Shaman row is a SoD rune, excluded like every rune). Weapons also honor `ItemSparse.AllowableClass` (Rhok'delar is Hunter-only). |
| Talent effects in the app | **Generated**: each talent in `talents/<class>.json` gets `effects[]` (aura, misc, mask, targets), `equipped` (from the new `SpellEquippedItems` table) and `shapeshiftMask` (from `SpellShapeshift`). The app still does not load `spells.json`. |
| Generic talent mapper | Applies stat-level auras of **passive** talents whose effects target the caster: 29, 137, 52, 290, 57, 54, 55, 99, 124, 166, 167, 13, 174, 122, 240, 280, 123, 319, 342, 65, 30 (weapon skills). Records aura 79 (damage done %) and 107/108 (spell modifiers) for Phase 4 without applying them. Abilities, DUMMY/proc auras, form-restricted talents and talents whose weapon requirement is not met are listed in a "not modeled yet" note. Rank values are read from `ranks[r-1].values[position]`. |
| Equip requirements | A talent with `equipped` is active only while a matching weapon is equipped. For weapon-specific auras (52 crit, 54 hit, 30 skill) the effect applies only to the matching slots (Cruelty: main/off hand, not ranged; Furious Precision: off hand only). Shields (item class 4) are not modeled: Bastion is always inactive (Q46). |
| Buffs | `data/manual/buffs.json` rewritten with values **read from Forever `SpellEffect`** (most differ from Classic, see 1.4), a stable URL `code` per buff, exclusive `group`s and two presets. The pipeline now checks every buff/racial value against `SpellEffect` (`effects[].src`) and reports mismatches in `report.manualValidation`. Raid buffs are **off by default**; "Raid buffed" turns the 12-buff `presets.raidBuffs` set on or off; "Raid debuffs" does the same for Sunder ×5, Faerie Fire, Curse of Recklessness, Curse of the Elements. |
| Racials | New `data/manual/racials.json`. Forever reworked racials (no weapon-skill racials remain). Passive DPS racials applied: Human Ruthless (+1% crit) and The Human Spirit (+10% Spirit), Orc Savage (+1% crit, Q37), Dwarf Artisan's Precision (+1% hit), Gnome Expansive Mind (+5% mana, casters), Tauren Endurance (+5% health). Active racials are listed, not applied. Base weapon skill is 300 for everyone. |
| Gear v1 | Manual bonus-stat panel (20 fields) + up to 3 weapons + ammo. Weapon stats are added automatically (Str/Agi/Sta/Int/Spi, AP, RAP, spell power, hit/crit rating). Rating conversion at 60: 10 hit rating = 1% hit, 14 crit rating = 1% crit, melee/ranged and spell alike (Q35). |
| Stacking | Flat sources add up; each % stat effect multiplies the running total in a fixed order (talents, racials, buffs). Health/mana/AP/spell power are derived from the final stats; AP % applies after flat AP. Haste stacks multiplicatively. Crit/hit/% skill bonuses add. Every number is a `Stat { value, parts[] }` whose parts sum to the value: the UI tooltips show the parts. |
| Target | Presets from `targets.json` (`byPlayerLevel[L]`) + Custom (level 1..63, armor, 6 resistances). Debuffs reduce armor (floored at 0), then talent armor penetration applies. DR = armor / (armor + 400 + 85 × playerLevel), cap 75%. Outcome tables vs the selected target with Classic 1.12 rules (section 5.3, all `[VERIFY]`). Attacks are assumed from behind (no parry, no block). |
| "DPS vs reference mobs" | Phase 3 shows a reference table (boss, elite, same level, low-armor boss, + custom when selected) with armor, DR, miss/dodge/glancing/crit and spell miss. `TargetView.dps` is the Phase 4 hook (always `undefined` now; the DPS column is hidden while every row's `dps` is undefined). |
| URL | Talent-only builds keep the exact v1 string. Any non-default character state writes `#v2.<class>.<level>.<talentedRank>.<talentPayload>.<charPayload>` where `charPayload` is base64url of tag-length-value records (race, weapons, bonus stats, buff codes, target). Unknown tags are skipped (forward compatible). Golden vectors in 6.4. |
| Layout | Desktop (≥ 980 px): talent calculator unchanged, a compact stat strip under the points bar, then two panels side by side: **Character** (race, weapons, bonus stats, buffs, target) and **Stats** (derived stats, vs-target table, reference table, not-modeled note). Mobile: top-level tabs Talents / Gear / Stats. |
| Data loading | `weapons.json` (110 KB gzip) is a lazy chunk, loaded in the background after the first class is selected (awaited only when a link contains weapons). `targets.json` and the manual JSON files are static imports (new alias `@manual` → `data/manual`). |

---

## 1. Verified data facts (what the code may rely on)

### 1.1 `base-stats.json` (before this phase)

- `level: 60` only; `classes` has all 9 classes (str/agi/sta/int/spi/health/mana/baseMeleeCrit/baseSpellCrit);
  `raceOffsets` has all 8 races, relative to Human; `conversions` holds Classic ratios as strings (`"1/20"`).
- **Missing:** attack power formulas (level and stat terms), ranged AP, Agi→crit for Mage/Priest/Warlock, health/mana
  per Sta/Int rules. Section 3.1 adds them.
- `validCombos` lists only the Classic combos. `CharBaseInfo` (build 70888) has 6 more (decision table). It is removed.
- All values are Classic recollections (Q4/Q25). The `baseMeleeCrit` values are class-specific (Warrior 0, Mage 3.2, ...);
  whether Forever adds a flat 5% base melee crit is unknown (new Q33). The engine uses the file as is.

### 1.2 `buffs.json` (before this phase) and what was wrong

The old file had Classic values typed from memory, inconsistent stat names (`crit`, `meleeRangedCrit`, `meleeCrit`),
empty effects for 9 buffs, wrong spell ids (Elixir of Shadow Power 11476, both sharpening stones and Brilliant
Wizard Oil point at the item "create" spells), a proc buff modeled as flat AP (Windfury), and three debuffs that only
help the caster in Forever (Shadow Weaving, Fire Vulnerability "from the Mage", Winter's Chill). Curse of Shadow is not a
Warlock ability in Forever (no ability chain), so it is dropped.

### 1.3 `weapons.json`

2,721 weapons + 27 ammo. Fields used: `id, name, quality, itemLevel, requiredLevel, inventoryType, slot
(mainHand|oneHand|twoHand|offHand|ranged|thrown|wand), subclass, weaponType, speedMs, min, max, dps, stats[{stat,name,value}],
allowableClass, icon, source (forever|classic_era), bonusDamage?`. `subclass` (Item.SubclassID) is enough for proficiency filtering.
`allowableClass` is `-1` (any) or a class bitmask (`1 << (classId-1)`), e.g. 4 = Hunter; one item has `-3840` (bitwise AND still works).
330 names are duplicated (different item levels/sources), so the picker shows item level and source.
Item stats seen: 3/4/5/6/7 primary, 31 hit rating, 32 crit rating, 36 haste rating, 37 expertise rating, 38 AP, 39 RAP, 41/42/45 healing/spell
damage/spell power, 43 mp5, 50 armor, 51–56 resistances, and unknown ids 85–92, 96, 114, 124, 127, 131, 132 (Q23; shown as "not modeled").

**Rating evidence (Q35):** Forever turned Classic "+1% hit"/"+1% crit" equip effects into ratings: Core Marksman Rifle hit 10,
Heartseeker / Rhok'delar / PvP weapons crit 14, Fist of Cenarius crit 28 (Classic +2% spell crit), Lok'delar/Ironbark Staff crit 28.
So at level 60: 10 hit rating = 1%, 14 crit rating = 1%, for melee, ranged and spells (stat 31/32 are the modern "all" ratings;
caster weapons such as Jin'do's Judgement carry stat 31).

### 1.4 Buff values: Forever `SpellEffect` vs Classic

All values below were read from `SpellEffect` (Difficulty 0) and are machine-checked by the new pipeline validation.
DUMMY (aura 4) effects are server-scripted; their meaning comes from the spell tooltip (`$s1` = effect 0, ...).

| Buff (spell) | Forever data | Classic 1.12 |
|---|---|---|
| Battle Shout r7 (25289) | +139 melee AP (aura 99; +0.6/level above 60) | 232 |
| Blessing of Might r7 (25291) / Greater r2 (25916) | +133 melee AP | 185 |
| Blessing of Kings (20217) / Greater (25898) | +10% all stats (aura 137, misc −1/31) | 10% |
| Mark of the Wild r7 (9885) / Gift of the Wild (21850) | +16 all stats, +385 armor, +27 resistances | 12 |
| Arcane Intellect (10157) / Brilliance (23028) | +31 Int | 31 |
| Power Word: Fortitude r6 (10938) / Prayer (21564) | +70 Sta | 54 |
| Divine Spirit (27841) / Prayer of Spirit (27681) | +40 Spi | 40 |
| Leader of the Pack (24932) | +3% crit, aura **290 (all crit)** | 3% melee/ranged |
| Moonkin Aura (24907) | +3% crit, aura **290 (all crit)** | 3% spell |
| Trueshot Aura r5 (20906) | +100 RAP | 100 |
| Grace of Air r3 (25360) | +89 Agi | 77 |
| Strength of Earth r5 (25362) | +53 Str | 77 |
| Windfury Totem r3 (10610) | proc: +246 AP extra attack | 315 (proc) — **not in Phase 3** (proc, Phase 4) |
| Rallying Cry (22888) | 10% crit (all), 140 AP, 140 RAP, 80 spell power | 5% melee / 10% spell crit, 140 AP |
| Songflower Serenade (15366) | 5% crit (all), +15 all stats | same |
| Spirit of Zandalar (24425) | +15% all stats | same |
| Warchief's Blessing (16609) | 15% haste **spells and attacks**, +300 health, 10 mp5 | 15% melee haste |
| Fengus' Ferocity (22817) | 200 AP, 200 RAP, 230 spell power | 200 AP |
| Mol'dar's Moxie (22818) | +15% Sta | same |
| Slip'kik's Savvy (22820) | 3% crit **all** | 3% spell crit |
| Elixir of the Mongoose (17538) | +25 Agi, +2% crit (290) | 2% melee/ranged |
| Juju Might (16329) | +40 AP **and** +40 RAP | 40 AP |
| Flask of the Titans (17626) | +1200 health | 1200 (old file said 400) |
| Curse of Recklessness r4 (11717) | −505 armor | 640 |
| Expose Armor r5 (11198) | −450 armor per combo point (EffectPointsPerResource) → 2250 at 5 cp | 1700 |
| Sunder Armor r5 (11597) | −450 per stack → 2250 at 5 | 2250 |
| Faerie Fire r4 (9907) | −505 | 505 |
| Curse of the Elements r4 (1311680) | −75 resistance and +10% damage taken, **all magic schools** (misc 126) | fire/frost |

Every world buff's aura description says **"No effect while in a raid instance."** (Forever). The UI says so (Q44).

### 1.5 Racials (Forever reworked them)

`SkillLineAbility` racial skill lines (754 Human, 125 Orc, 101 Dwarf, 126 Night Elf, 753 Gnome, 124 Tauren, 733 Troll, 220 Undead):
Human Ruthless 20597 (+1% crit, aura 290; same id as Classic Sword Specialization), The Human Spirit 20598 (+10% Spirit);
Orc Blood Fury 20572 (active +10% AP/SP), Hardiness, Command; Dwarf Artisan's Precision 1259719 (+1% hit melee and spell), Big Game Hunter,
Stoneform; Night Elf Quickness (+1% dodge), Elune's Light 1259799 (active +10% crit); Gnome Expansive Mind 20591 (+5% mana; rage/energy
variants for Warrior/Rogue), Eureka! (active); Tauren Endurance 20550 (+5% health); Troll Berserking 20554 (active, +10% speed),
Regeneration, Beast Slaying; Undead Touch of the Grave. "Savage" 20574 (+1% crit, all spells and abilities) is not in any skill line;
its id is the Classic Orc Axe Specialization, so it is assigned to Orc `[VERIFY]` (Q37). No racial changes weapon skill.

### 1.6 Talent effects (inventory, max rank, with a 2H axe and a bow equipped)

- 447 talents. Effects per talent come in the same order as `ranks[].values`. **Use the array position, not
  `effect.index`**: Paladin Seal of Command has indices `[0, 2]`.
- Every passive talent's stat-level aura targets the caster (`targets[0] == 1`); ability talents may target others.
- `SpellEquippedItems` covers 28 talent spells. Masks: 173555 melee (axes, maces, swords, polearm, staff, fist, dagger, spear),
  136546 two-handed melee, 41105 + invType bit 22 = off-hand weapon, 262156 bow/gun/crossbow, 524288 wand, 32768 dagger,
  item class 4 subclass 64 = shield. Examples: Cruelty (melee), Two-Handed Weapon Specialization (2H), Furious Precision and Dual
  Wield Specialization (off hand), Bastion (shield), Precision (Rogue; melee), Conviction and Thundering Strikes (melee), Ranged Weapon
  Specialization (ranged), Wand Specialization (wand).
- `SpellShapeshift.ShapeshiftMask_0` = 145 (cat/bear/dire bear) on Feral Instinct, Sharpened Claws, Predatory Strikes, Blood Frenzy:
  inactive in Phase 3.
- Applied stat talents (prototype count at max rank): Warrior Cruelty; Paladin Divine Intellect, Precision, Conviction, Champion of
  the Light; Hunter Lethal Attacks, Surefooted, Lightning Reflexes; Rogue Malice, Precision, Weapon Expertise, Serrated Blades; Priest
  Mental Strength, Spiritual Guidance; Shaman Thundering Strikes, Ancestral Knowledge, Toughness, Mental Quickness, Tidal Focus; Mage
  Arcane Subtlety, Arcane Mind, Arcane Instability, Precision; Warlock Suppression, Demonic Embrace; Druid Nature's Majesty, Nature's
  Reach, Heart of the Wild, Living Spirit. Plus Furious Precision (needs an off hand). Recorded for Phase 4: 15 aura-79 effects (some on abilities)
  and the spell-modifier effects (aura 107/108) of 194 passive talents.
- `misc` semantics: aura 29 `misc[0]` = stat index (0 Str .. 4 Spi, −1 all); aura 137 `misc[1]` = stat **bitmask** (8 = Int; BoK
  uses −1/31; The Human Spirit 4/16), fall back to `misc[0]` when `misc[1]` is 0; auras 13/79/123/174 `misc[0]` = school mask
  (1 physical, 2 holy, 4 fire, 8 nature, 16 frost, 32 shadow, 64 arcane; 126 = all magic, 127 = all); aura 174 `misc[1]` = stat index.
- Aura 268 is used by Arcane Resilience ("armor equal to 75% of Intellect"), so in Forever 268 is an armor aura, not
  `MOD_ATTACK_POWER_OF_STAT_PERCENT` as `tools/pipeline/constants.py` labels it (Q45). Phase 3 ignores it.

### 1.7 Targets

`targets.json`: `armorFormula {base 400, perLevel 85, cap 0.75}`; `byPlayerLevel["60"]` = boss 63/3731, elite 62/3677,
same 60/3566, lowArmorBoss 63/1866, custom 63/3731 (resistances are not in the data: 0 for presets).

---
## 2. Pipeline additions (task T1)

### 2.1 Raw tables

Add `SpellEquippedItems` and `CharBaseInfo` to `TABLES` in `tools/research/fetch_db2.sh` (new comment line
`# Phase 3: talent weapon requirements, race/class combos`). Fetch them into the existing raw folder (the other tables are
already there; re-running the whole script also works):

```bash
for t in SpellEquippedItems CharBaseInfo; do
  curl -sS --max-time 300 -o data/raw/1.60.1.70888/$t.csv "https://wago.tools/db2/$t/csv?build=1.60.1.70888"
done
wc -l data/raw/1.60.1.70888/SpellEquippedItems.csv data/raw/1.60.1.70888/CharBaseInfo.csv   # 1902 and 57 lines (with header)
```

`SpellShapeshift.csv` and `SkillLineAbility.csv` are already fetched.

### 2.2 `tools/pipeline/constants.py`

Change `PIPELINE_VERSION = 1` to `PIPELINE_VERSION = 2`. After the line `ACQUIRE_RUNE = 3  # SoD rune-granted spells` insert:

```python
# ---- Weapon proficiencies (Phase 3) ----
# Weapon skill lines (SkillLine.CategoryID 6) -> Item.SubclassID of class-2 weapons. Which classes can learn a
# line comes from SkillLineAbility.ClassMask (AcquireMethod != 3); it agrees with SkillRaceClassInfo for 70888.
WEAPON_SKILL_SUBCLASSES = {
    44: [0], 172: [1], 45: [2], 46: [3], 54: [4], 160: [5], 229: [6], 43: [7], 55: [8],
    136: [10], 473: [13], 173: [15], 176: [16], 226: [18], 228: [19],
}
DUAL_WIELD_SKILL_LINE = 118
```

### 2.3 `tools/pipeline/classes.py`

In `build_classes`, insert before `classes = []`:

```python
    prof = collections.defaultdict(set)   # class mask bit -> weapon subclasses
    dual = set()
    for r in db.rows("SkillLineAbility"):
        if I(r["AcquireMethod"]) == C.ACQUIRE_RUNE:
            continue
        sl, cm = I(r["SkillLine"]), I(r["ClassMask"])
        if sl in C.WEAPON_SKILL_SUBCLASSES:
            for _, _, _, mask in C.CLASS_TREES:
                if cm & mask:
                    prof[mask].update(C.WEAPON_SKILL_SUBCLASSES[sl])
        elif sl == C.DUAL_WIELD_SKILL_LINE:
            for _, _, _, mask in C.CLASS_TREES:
                if cm & mask:
                    dual.add(mask)
    combos = collections.defaultdict(set)
    for r in db.rows("CharBaseInfo"):
        combos[I(r["ClassID"])].add(I(r["RaceID"]))
```

and extend the class record (after `"skillLineIds": sorted(lines_of[cid]), "specs": specs,`):

```python
            "raceIds": [rid for rid in C.RACES_V1 if rid in combos[cid]],
            "weaponSubclasses": sorted(prof[mask]), "dualWield": mask in dual,
```

Result (exact):

| class | raceIds | weaponSubclasses | dualWield |
|---|---|---|---|
| warrior | [1, 2, 3, 4, 5, 6, 7, 8] | [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 15, 16, 18] | true |
| paladin | [1, 3, 5] | [0, 1, 4, 5, 6, 7, 8] | false |
| hunter | [1, 2, 3, 4, 6, 8] | [0, 1, 2, 3, 6, 7, 8, 10, 13, 15, 16, 18] | true |
| rogue | [1, 2, 3, 4, 5, 7, 8] | [0, 2, 3, 4, 7, 13, 15, 16, 18] | true |
| priest | [1, 3, 4, 5, 7, 8] | [4, 10, 15, 19] | false |
| shaman | [2, 3, 6, 8] | [0, 1, 4, 5, 10, 13, 15] | false |
| mage | [1, 2, 5, 7, 8] | [7, 10, 15, 19] | false |
| warlock | [1, 2, 5, 7, 8] | [7, 10, 15, 19] | false |
| druid | [4, 6] | [4, 5, 6, 10, 13, 15] | false |

### 2.4 `tools/pipeline/spells.py`

At the end of `build_spell`, replace `rec["effects"] = _effects(db, sid)` / `return rec` with:

```python
    rec["effects"] = _effects(db, sid)
    eq = db.by_spell("SpellEquippedItems").get(s)
    rec["equipped"] = ({"itemClass": I(eq["EquippedItemClass"]), "subclassMask": u32(I(eq["EquippedItemSubclass"])),
                        "invTypeMask": u32(I(eq["EquippedItemInvTypes"]))}
                       if eq and I(eq["EquippedItemClass"]) >= 0 else None)
    ss = db.by_spell("SpellShapeshift").get(s)
    rec["shapeshiftMask"] = u32(I(ss["ShapeshiftMask_0"])) if ss else 0
    return rec
```

### 2.5 `tools/pipeline/talents.py` and `build_data.py`

Append to `talents.py`:

```python
EFFECT_KEYS = ("index", "effect", "aura", "misc", "mask", "targets")


def attach_effects(talent_files, spells_by_id):
    """Copies the stat-relevant part of each talent spell's effects (parallel to ranks[].values) and its
    equipped-item requirement onto the talent records (Phase 3: the app does not load spells.json)."""
    def attach(t):
        sp = spells_by_id[t["spellId"]]
        t["effects"] = [{k: e[k] for k in EFFECT_KEYS if k in e} for e in sp["effects"]]
        t["equipped"] = sp["equipped"]
        t["shapeshiftMask"] = sp["shapeshiftMask"]
    for f in talent_files.values():
        for s in f["specs"]:
            for t in s["talents"]:
                attach(t)
                for c in t.get("choices", []):
                    attach(c)
```

In `build_data.py`: import it (`from pipeline.talents import BuildError, attach_effects, build_talent_trees  # noqa: E402`) and
call `attach_effects(talent_files, spells_by_id)` on the line right after `spells_by_id = {s["id"]: s for s in spells}`.

### 2.6 `tools/pipeline/manual.py` (manual data checks)

Replace the file's `REQUIRED` dict and name check as follows (full diff of the prototype):

```diff
diff --git a/tools/pipeline/manual.py b/tools/pipeline/manual.py
--- a/tools/pipeline/manual.py
+++ b/tools/pipeline/manual.py
@@ -2,10 +2,13 @@
 import json
 import os
 
+from .util import F, I, num
+
 REQUIRED = {
-    "base-stats.json": ["classes", "raceOffsets", "validCombos", "conversions"],
+    "base-stats.json": ["level", "classes", "raceOffsets", "conversions"],
     "pets.json": ["hunterFamilies", "warlockDemons", "ownerScaling"],
-    "buffs.json": ["buffs"],
+    "buffs.json": ["buffs", "presets"],
+    "racials.json": ["racials"],
     "targets.json": ["named"],
     "weapon-overrides.json": ["weapons"],
 }
@@ -21,6 +24,27 @@ def _walk(obj):
             yield from _walk(v)
 
 
+def _check_effect_sources(fn, d, sid, db, mv):
+    """effects[].src = {effectIndex, field?: "base" | "perResource", mult?}: value must equal the SpellEffect
+    (Difficulty 0) column x mult. Phase 3: catches stale hand-copied buff values."""
+    rows = {I(r["EffectIndex"]): r for r in db.group("SpellEffect", "SpellID").get(str(sid), [])}
+    for e in d.get("effects") or []:
+        src = e.get("src")
+        if not isinstance(src, dict):
+            continue
+        r = rows.get(src.get("effectIndex"))
+        col = {"base": "EffectBasePointsF", "perResource": "EffectPointsPerResource"}[src.get("field", "base")]
+        if r is None:
+            mv.append({"file": fn, "id": str(d.get("id", sid)),
+                       "problem": "spell %s has no effect index %s" % (sid, src.get("effectIndex"))})
+            continue
+        want = F(r[col]) * src.get("mult", 1)
+        if abs(want - e["value"]) > 1e-6:
+            mv.append({"file": fn, "id": str(d.get("id", sid)),
+                       "problem": "%s %s: value %s != SpellEffect %s x %s = %s" %
+                                  (e["key"], src, e["value"], r[col], src.get("mult", 1), num(want))})
+
+
 def validate_manual(manual_dir, db, report):
     """Returns {filename: parsed JSON}. Problems go to report['manualValidation'] (warnings)."""
     mv = report.setdefault("manualValidation", [])
@@ -42,14 +66,15 @@ def validate_manual(manual_dir, db, report):
             sid = d.get("spellId")
             if sid is None:
                 continue
-            nm = d.get("name") or d.get("id") or ""
+            expect = str(d.get("spellName") or d.get("name") or "")
             row = names.get(str(sid))
             if row is None:
                 mv.append({"file": fn, "id": str(d.get("id", sid)), "problem": "spellId %s not in SpellName" % sid})
-            elif str(d.get("name", "")).lower() not in row["Name_lang"].lower():
+            elif expect.lower() not in row["Name_lang"].lower():
                 mv.append({"file": fn, "id": str(d.get("id", sid)),
                            "problem": "spellId %s is '%s', expected name containing '%s'" %
-                                      (sid, row["Name_lang"], d.get("name"))})
+                                      (sid, row["Name_lang"], expect)})
+            _check_effect_sources(fn, d, sid, db, mv)
     fam = {r["ID"]: r["Name_lang"] for r in db.rows("CreatureFamily")}
     pets = data.get("pets.json", {})
     for grp in ("hunterFamilies", "warlockDemons"):
```

`effects[].src = {effectIndex, field?, mult?}` says which `SpellEffect` column the value was read from; the pipeline recomputes it and
reports any mismatch in `report.manualValidation`. `spellName` is used when the aura spell's name differs from the display name
(e.g. "Elixir of Giants" → spell "Greater Strength").

### 2.7 Pipeline tests: new file `tools/pipeline/tests/test_phase3.py` (exact)

```python
"""Phase 3 pipeline additions: proficiencies, race/class combos, talent effects, equip/form requirements, manual checks."""
import json
import os
import shutil
import tempfile
import unittest

from ._fixtures import MANUAL, RAW, build_dir, load, needs_raw

TOKENS = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]


def talent(out, token, name):
    for s in load(out, "talents/%s.json" % token)["specs"]:
        for t in s["talents"]:
            if t["name"] == name:
                return t
    raise KeyError(name)


@needs_raw
class TestPhase3(unittest.TestCase):
    def setUp(self):
        self.d = build_dir()

    def test_classes_combos_and_proficiencies(self):
        c = {k["token"]: k for k in load(self.d, "classes.json")["classes"]}
        self.assertEqual(c["warrior"]["raceIds"], [1, 2, 3, 4, 5, 6, 7, 8])
        self.assertEqual(c["paladin"]["raceIds"], [1, 3, 5])
        self.assertEqual(c["shaman"]["raceIds"], [2, 3, 6, 8])
        self.assertEqual(c["druid"]["raceIds"], [4, 6])
        self.assertEqual(c["priest"]["weaponSubclasses"], [4, 10, 15, 19])
        self.assertEqual(c["rogue"]["weaponSubclasses"], [0, 2, 3, 4, 7, 13, 15, 16, 18])
        self.assertEqual(c["druid"]["weaponSubclasses"], [4, 5, 6, 10, 13, 15])
        self.assertEqual([t for t in TOKENS if c[t]["dualWield"]], ["warrior", "hunter", "rogue"])

    def test_talent_effects_parallel_to_values(self):
        for tok in TOKENS:
            for s in load(self.d, "talents/%s.json" % tok)["specs"]:
                for t in s["talents"]:
                    self.assertEqual(len(t["effects"]), len(t["valueSources"]), t["name"])
                    for r in t["ranks"]:
                        self.assertEqual(len(r["values"]), len(t["effects"]), t["name"])
                    self.assertIn("equipped", t)
                    self.assertIn("shapeshiftMask", t)

    def test_requirements(self):
        self.assertEqual(talent(self.d, "warrior", "Furious Precision")["equipped"],
                         {"itemClass": 2, "subclassMask": 41105, "invTypeMask": 4194304})
        self.assertEqual(talent(self.d, "warrior", "Cruelty")["equipped"]["subclassMask"], 173555)
        self.assertEqual(talent(self.d, "warrior", "Bastion")["equipped"]["itemClass"], 4)
        self.assertEqual(talent(self.d, "druid", "Sharpened Claws")["shapeshiftMask"], 145)
        am = talent(self.d, "mage", "Arcane Mind")
        self.assertIsNone(am["equipped"])
        self.assertEqual(am["shapeshiftMask"], 0)
        self.assertEqual(am["effects"][0], {"index": 0, "effect": 6, "aura": 137, "misc": [0, 8],
                                            "mask": [0, 0, 0, 0], "targets": [1, 0]})
        spells = load(self.d, "spells.json")["spells"]
        self.assertTrue(all("equipped" in s and "shapeshiftMask" in s for s in spells))

    def test_manual_values_match_spell_effects(self):
        self.assertEqual(load(self.d, "report.json")["manualValidation"], [])
        self.assertEqual(load(self.d, "manifest.json")["pipelineVersion"], 2)


@needs_raw
class TestManualValidation(unittest.TestCase):
    def test_wrong_buff_value_is_reported(self):
        from pipeline.db2 import RawDB
        from pipeline.manual import validate_manual
        with tempfile.TemporaryDirectory() as td:
            for fn in os.listdir(MANUAL):
                shutil.copy(os.path.join(MANUAL, fn), td)
            p = os.path.join(td, "buffs.json")
            with open(p, encoding="utf-8") as f:
                b = json.load(f)
            bs = next(x for x in b["buffs"] if x["id"] == "battle_shout")
            bs["effects"][0]["value"] = 232
            with open(p, "w", encoding="utf-8") as f:
                json.dump(b, f)
            report = {}
            validate_manual(td, RawDB(RAW), report)
            probs = report["manualValidation"]
            self.assertEqual(len(probs), 1)
            self.assertEqual(probs[0]["id"], "battle_shout")
            self.assertIn("!= SpellEffect 139", probs[0]["problem"])
```

### 2.8 Regenerate and check

```bash
python3 tools/pipeline/build_data.py --build 1.60.1.70888 --date 2026-11-12
python3 -m unittest discover -s tools/pipeline/tests -t tools -v     # 48 tests, OK
git diff --stat data/generated                                        # classes, manifest, spells, 9 talent files
```

Expected: `manualValidation 0, warnings 0` in the summary line, coverage counts unchanged (generic 276, special 161, unsupported 10),
`manifest.pipelineVersion == 2`, and `manifest.rawTables` now lists `CharBaseInfo`, `SpellEquippedItems`, `SpellShapeshift`.
Every line of `spells.json` changes (two new keys per spell); that is expected. Regenerate again after task T2 (section 3):
the new `manual.py` requires `racials.json` and `buffs.json` `presets`.

---

## 3. Hand-maintained data (task T2)

`data/` is excluded from Prettier, so keep the formatting below (one record per line). Write the three files exactly.

### 3.1 `data/manual/base-stats.json` (replaces the file; `validCombos` removed, `conversions` rewritten)

```json
{
 "_source": "[VERIFY] Classic 1.12 level-60 base stats (best-effort reconstruction of vmangos player_levelstats/player_classlevelstats, from memory) and Classic 1.12 conversions (CALC_MODEL section 3; attack power formulas from the Classic 1.12 character-sheet formulas). Race/class combos are generated (classes.json raceIds from CharBaseInfo). Confirm with naked level-60 character sheets (OPEN_QUESTIONS Q4/Q25/Q33).",
 "_status": "[VERIFY]",
 "level": 60,
 "baseCritUnit": "percent",
 "classes": {
  "WARRIOR": {"str": 120, "agi": 80, "sta": 110, "int": 30, "spi": 47, "health": 1689, "mana": 0, "baseMeleeCrit": 0, "baseSpellCrit": 0},
  "PALADIN": {"str": 105, "agi": 65, "sta": 100, "int": 70, "spi": 75, "health": 1381, "mana": 1512, "baseMeleeCrit": 0.7, "baseSpellCrit": 0},
  "HUNTER": {"str": 55, "agi": 125, "sta": 85, "int": 65, "spi": 70, "health": 1467, "mana": 1720, "baseMeleeCrit": 0, "baseSpellCrit": 0},
  "ROGUE": {"str": 80, "agi": 130, "sta": 75, "int": 35, "spi": 52, "health": 1523, "mana": 0, "baseMeleeCrit": 0, "baseSpellCrit": 0},
  "PRIEST": {"str": 35, "agi": 40, "sta": 50, "int": 120, "spi": 125, "health": 1397, "mana": 1376, "baseMeleeCrit": 3, "baseSpellCrit": 0.8},
  "SHAMAN": {"str": 85, "agi": 55, "sta": 95, "int": 90, "spi": 105, "health": 1423, "mana": 1520, "baseMeleeCrit": 1.7, "baseSpellCrit": 2.3},
  "MAGE": {"str": 35, "agi": 40, "sta": 45, "int": 125, "spi": 120, "health": 1360, "mana": 1273, "baseMeleeCrit": 3.2, "baseSpellCrit": 0.2},
  "WARLOCK": {"str": 50, "agi": 55, "sta": 70, "int": 105, "spi": 110, "health": 1414, "mana": 1373, "baseMeleeCrit": 2, "baseSpellCrit": 1.7},
  "DRUID": {"str": 65, "agi": 55, "sta": 65, "int": 100, "spi": 110, "health": 1483, "mana": 1244, "baseMeleeCrit": 0.9, "baseSpellCrit": 1.85}
 },
 "raceOffsets": {
  "HUMAN": {"str": 0, "agi": 0, "sta": 0, "int": 0, "spi": 0},
  "ORC": {"str": 3, "agi": -3, "sta": 2, "int": -3, "spi": 2},
  "DWARF": {"str": 2, "agi": -4, "sta": 3, "int": -1, "spi": -2},
  "NIGHTELF": {"str": -3, "agi": 5, "sta": -1, "int": 0, "spi": -1},
  "SCOURGE": {"str": -1, "agi": -2, "sta": 1, "int": -2, "spi": 4},
  "TAUREN": {"str": 5, "agi": -5, "sta": 2, "int": -5, "spi": 1},
  "GNOME": {"str": -5, "agi": 3, "sta": -1, "int": 3, "spi": -1},
  "TROLL": {"str": 1, "agi": 2, "sta": 1, "int": -4, "spi": 0}
 },
 "conversions": {
  "_source": "[VERIFY] Classic 1.12 values (CALC_MODEL section 3, Q4). meleeAttackPower = perLevel*level + perStr*Str + perAgi*Agi + flat; rangedAttackPower likewise (classes without an entry have no ranged attack power). agiPerMeleeCrit / intPerSpellCrit = points per 1% crit at level 60 (classes without an entry get no crit from that stat). The first 'statsWithoutBonus' points of Sta/Int give 1 health/mana each.",
  "_status": "[VERIFY]",
  "meleeAttackPower": {"WARRIOR": {"perLevel": 3, "perStr": 2, "perAgi": 0, "flat": -20}, "PALADIN": {"perLevel": 3, "perStr": 2, "perAgi": 0, "flat": -20}, "SHAMAN": {"perLevel": 2, "perStr": 2, "perAgi": 0, "flat": -20}, "ROGUE": {"perLevel": 2, "perStr": 1, "perAgi": 1, "flat": -20}, "HUNTER": {"perLevel": 2, "perStr": 1, "perAgi": 1, "flat": -20}, "DRUID": {"perLevel": 0, "perStr": 2, "perAgi": 0, "flat": -20}, "MAGE": {"perLevel": 0, "perStr": 1, "perAgi": 0, "flat": -10}, "PRIEST": {"perLevel": 0, "perStr": 1, "perAgi": 0, "flat": -10}, "WARLOCK": {"perLevel": 0, "perStr": 1, "perAgi": 0, "flat": -10}},
  "rangedAttackPower": {"HUNTER": {"perLevel": 2, "perStr": 0, "perAgi": 2, "flat": -10}, "WARRIOR": {"perLevel": 1, "perStr": 0, "perAgi": 1, "flat": -10}, "ROGUE": {"perLevel": 1, "perStr": 0, "perAgi": 1, "flat": -10}},
  "agiPerMeleeCrit": {"WARRIOR": 20, "PALADIN": 20, "SHAMAN": 20, "DRUID": 20, "ROGUE": 29, "HUNTER": 53, "MAGE": 20, "PRIEST": 20, "WARLOCK": 20},
  "intPerSpellCrit": {"MAGE": 59.5, "WARLOCK": 60.6, "PRIEST": 59.2, "DRUID": 60, "SHAMAN": 59.5, "PALADIN": 54},
  "healthPerSta": 10,
  "manaPerInt": 15,
  "statsWithoutBonus": 20
 }
}
```

Notes: `agiPerMeleeCrit` and `intPerSpellCrit` are "points per 1%" at level 60 (Classic 1.12, CALC_MODEL section 3). Mage, Priest
and Warlock get Agi→crit 1/20 `[VERIFY]` (not in CALC_MODEL before). Classes without an `intPerSpellCrit` entry (Warrior, Rogue,
Hunter) get no Int→spell crit; classes without a `rangedAttackPower` entry have no RAP (the stats panel hides the ranged block).
Health = base + min(Sta, 20) + 10 × (Sta − 20); mana likewise with 15 per Int (Classic).

### 3.2 `data/manual/buffs.json` (replaces the file)

```json
{
 "_source": "Forever build 1.60.1.70888 SpellEffect values (read 2026-11-12, Phase 3 plan); effect meaning of DUMMY auras from the spell tooltip. Every value [VERIFY] in game. 'classic' = Classic 1.12 value for comparison.",
 "_status": "[VERIFY]",
 "buffs": [
  {"id": "battle_shout", "code": 1, "name": "Battle Shout", "category": "raid", "spellId": 25289, "effects": [{"key": "meleeAttackPower", "value": 139, "src": {"effectIndex": 0}}], "notes": "Rank 7. SpellEffect base 139, +0.6/level above spell level 60 (0 at 60). Improved Battle Shout not modeled.", "classic": "232 AP", "_status": "[VERIFY]"},
  {"id": "blessing_of_might", "code": 2, "name": "Blessing of Might", "category": "raid", "spellId": 25291, "group": "blessing_might", "effects": [{"key": "meleeAttackPower", "value": 133, "src": {"effectIndex": 0}}], "notes": "Rank 7; Greater Blessing of Might rank 2 (25916) has the same value.", "classic": "185 AP", "_status": "[VERIFY]"},
  {"id": "blessing_of_kings", "code": 3, "name": "Blessing of Kings", "category": "raid", "spellId": 20217, "effects": [{"key": "statPct", "stat": "all", "value": 10, "src": {"effectIndex": 0}}], "notes": "Greater Blessing of Kings (25898) has the same value.", "_status": "[VERIFY]"},
  {"id": "mark_of_the_wild", "code": 4, "name": "Mark of the Wild", "category": "raid", "spellId": 9885, "effects": [{"key": "stat", "stat": "all", "value": 16, "src": {"effectIndex": 1}}], "notes": "Rank 7; Gift of the Wild (21850) has the same values. Armor +385 and resistances +27 are not DPS stats.", "classic": "12 all stats", "_status": "[VERIFY]"},
  {"id": "arcane_intellect", "code": 5, "name": "Arcane Intellect", "category": "raid", "spellId": 10157, "effects": [{"key": "stat", "stat": "int", "value": 31, "src": {"effectIndex": 0}}], "notes": "Arcane Brilliance (23028) has the same value.", "_status": "[VERIFY]"},
  {"id": "power_word_fortitude", "code": 6, "name": "Power Word: Fortitude", "category": "raid", "spellId": 10938, "effects": [{"key": "stat", "stat": "sta", "value": 70, "src": {"effectIndex": 0}}], "notes": "Rank 6; Prayer of Fortitude (21564) has the same value.", "classic": "54 Sta", "_status": "[VERIFY]"},
  {"id": "divine_spirit", "code": 7, "name": "Divine Spirit", "category": "raid", "spellId": 27841, "effects": [{"key": "stat", "stat": "spi", "value": 40, "src": {"effectIndex": 0}}], "notes": "Prayer of Spirit (27681) has the same value.", "_status": "[VERIFY]"},
  {"id": "leader_of_the_pack", "code": 8, "name": "Leader of the Pack", "category": "raid", "spellId": 24932, "effects": [{"key": "crit", "value": 3, "src": {"effectIndex": 0}}], "notes": "Aura 290 (all crit) in Forever data.", "classic": "3% melee/ranged crit", "_status": "[VERIFY]"},
  {"id": "moonkin_aura", "code": 9, "name": "Moonkin Aura", "category": "raid", "spellId": 24907, "effects": [{"key": "crit", "value": 3, "src": {"effectIndex": 0}}], "notes": "Aura 290 (all crit) in Forever data.", "classic": "3% spell crit", "_status": "[VERIFY]"},
  {"id": "trueshot_aura", "code": 10, "name": "Trueshot Aura", "category": "raid", "spellId": 20906, "effects": [{"key": "rangedAttackPower", "value": 100, "src": {"effectIndex": 0}}], "notes": "Rank 5 (talent 1299346 grants rank 1).", "_status": "[VERIFY]"},
  {"id": "grace_of_air_totem", "code": 11, "name": "Grace of Air Totem", "category": "raid", "spellId": 25360, "spellName": "Grace of Air", "effects": [{"key": "stat", "stat": "agi", "value": 89, "src": {"effectIndex": 0}}], "notes": "Rank 3 aura spell (totem 25359).", "classic": "77 Agi", "_status": "[VERIFY]"},
  {"id": "strength_of_earth_totem", "code": 12, "name": "Strength of Earth Totem", "category": "raid", "spellId": 25362, "spellName": "Strength of Earth", "effects": [{"key": "stat", "stat": "str", "value": 53, "src": {"effectIndex": 0}}], "notes": "Rank 5 aura spell (totem 25361).", "classic": "77 Str", "_status": "[VERIFY]"},
  {"id": "rallying_cry", "code": 20, "name": "Rallying Cry of the Dragonslayer", "category": "world", "spellId": 22888, "effects": [{"key": "crit", "value": 10, "src": {"effectIndex": 0}}, {"key": "meleeAttackPower", "value": 140, "src": {"effectIndex": 1}}, {"key": "rangedAttackPower", "value": 140, "src": {"effectIndex": 2}}, {"key": "spellPower", "value": 80, "src": {"effectIndex": 3}}], "notes": "Dummy auras (server-scripted); meaning from the tooltip: $s1% crit of spells and attacks, $s2 Attack Power, $s4 spell damage. Forever: 'No effect while in a raid instance' (aura description).", "classic": "5% melee/ranged crit, 10% spell crit, 140 AP", "_status": "[VERIFY]"},
  {"id": "songflower", "code": 21, "name": "Songflower Serenade", "category": "world", "spellId": 15366, "effects": [{"key": "crit", "value": 5, "src": {"effectIndex": 0}}, {"key": "stat", "stat": "all", "value": 15, "src": {"effectIndex": 1}}], "notes": "Dummy auras; tooltip: $s1% melee/ranged/spell crit, $s2 all attributes. Forever: 'No effect while in a raid instance' (aura description).", "_status": "[VERIFY]"},
  {"id": "spirit_of_zandalar", "code": 22, "name": "Spirit of Zandalar", "category": "world", "spellId": 24425, "effects": [{"key": "statPct", "stat": "all", "value": 15, "src": {"effectIndex": 2}}], "notes": "Forever: 'No effect while in a raid instance' (aura description).", "_status": "[VERIFY]"},
  {"id": "warchiefs_blessing", "code": 23, "name": "Warchief's Blessing", "category": "world", "spellId": 16609, "effects": [{"key": "haste", "value": 15, "src": {"effectIndex": 1}}, {"key": "health", "value": 300, "src": {"effectIndex": 0}}], "notes": "Dummy auras; tooltip: 300 hit points, 15% haste to all spells and attacks, 10 mp5. Forever: 'No effect while in a raid instance' (aura description).", "classic": "15% melee haste only", "_status": "[VERIFY]"},
  {"id": "fengus_ferocity", "code": 24, "name": "Fengus' Ferocity", "category": "world", "spellId": 22817, "effects": [{"key": "meleeAttackPower", "value": 200, "src": {"effectIndex": 0}}, {"key": "rangedAttackPower", "value": 200, "src": {"effectIndex": 1}}, {"key": "spellPower", "value": 230, "src": {"effectIndex": 2}}], "notes": "Dummy auras; tooltip: $s1 Attack Power, $s3 spell damage. Forever: 'No effect while in a raid instance' (aura description).", "classic": "200 AP only", "_status": "[VERIFY]"},
  {"id": "moldars_moxie", "code": 25, "name": "Mol'dar's Moxie", "category": "world", "spellId": 22818, "effects": [{"key": "statPct", "stat": "sta", "value": 15, "src": {"effectIndex": 0}}], "notes": "Forever: 'No effect while in a raid instance' (aura description).", "_status": "[VERIFY]"},
  {"id": "slipkiks_savvy", "code": 26, "name": "Slip'kik's Savvy", "category": "world", "spellId": 22820, "effects": [{"key": "crit", "value": 3, "src": {"effectIndex": 0}}], "notes": "Tooltip: crit with all spells and attacks. Forever: 'No effect while in a raid instance' (aura description).", "classic": "3% spell crit", "_status": "[VERIFY]"},
  {"id": "elixir_of_the_mongoose", "code": 30, "name": "Elixir of the Mongoose", "category": "consumable", "spellId": 17538, "group": "elixir_agility", "effects": [{"key": "stat", "stat": "agi", "value": 25, "src": {"effectIndex": 0}}, {"key": "crit", "value": 2, "src": {"effectIndex": 1}}], "classic": "2% melee/ranged crit", "_status": "[VERIFY]"},
  {"id": "elixir_of_greater_agility", "code": 31, "name": "Elixir of Greater Agility", "category": "consumable", "spellId": 11334, "spellName": "Greater Agility", "group": "elixir_agility", "effects": [{"key": "stat", "stat": "agi", "value": 25, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
  {"id": "elixir_of_giants", "code": 32, "name": "Elixir of Giants", "category": "consumable", "spellId": 11405, "spellName": "Greater Strength", "group": "elixir_strength", "effects": [{"key": "stat", "stat": "str", "value": 25, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
  {"id": "juju_power", "code": 33, "name": "Juju Power", "category": "consumable", "spellId": 16323, "group": "elixir_strength", "effects": [{"key": "stat", "stat": "str", "value": 30, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
  {"id": "juju_might", "code": 34, "name": "Juju Might", "category": "consumable", "spellId": 16329, "group": "elixir_ap", "effects": [{"key": "meleeAttackPower", "value": 40, "src": {"effectIndex": 0}}, {"key": "rangedAttackPower", "value": 40, "src": {"effectIndex": 1}}], "_status": "[VERIFY]"},
  {"id": "winterfall_firewater", "code": 35, "name": "Winterfall Firewater", "category": "consumable", "spellId": 17038, "group": "elixir_ap", "effects": [{"key": "meleeAttackPower", "value": 35, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
  {"id": "flask_of_supreme_power", "code": 36, "name": "Flask of Supreme Power", "category": "consumable", "spellId": 17628, "spellName": "Supreme Power", "group": "flask", "effects": [{"key": "spellPower", "value": 150, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
  {"id": "flask_of_the_titans", "code": 37, "name": "Flask of the Titans", "category": "consumable", "spellId": 17626, "group": "flask", "effects": [{"key": "health", "value": 1200, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
  {"id": "greater_arcane_elixir", "code": 38, "name": "Greater Arcane Elixir", "category": "consumable", "spellId": 17539, "effects": [{"key": "spellPower", "value": 35, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
  {"id": "elixir_of_shadow_power", "code": 39, "name": "Elixir of Shadow Power", "category": "consumable", "spellId": 11474, "spellName": "Shadow Power", "effects": [{"key": "spellPower", "schools": ["shadow"], "value": 40, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
  {"id": "elixir_of_greater_firepower", "code": 40, "name": "Elixir of Greater Firepower", "category": "consumable", "spellId": 26276, "spellName": "Greater Firepower", "effects": [{"key": "spellPower", "schools": ["fire"], "value": 40, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
  {"id": "grilled_squid", "code": 41, "name": "Grilled Squid", "category": "consumable", "spellId": 18192, "spellName": "Increased Agility", "group": "food", "effects": [{"key": "stat", "stat": "agi", "value": 10, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
  {"id": "smoked_desert_dumplings", "code": 42, "name": "Smoked Desert Dumplings", "category": "consumable", "spellId": 24799, "spellName": "Well Fed", "group": "food", "effects": [{"key": "stat", "stat": "str", "value": 20, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
  {"id": "brilliant_wizard_oil", "code": 50, "name": "Brilliant Wizard Oil", "category": "weapon", "spellId": 25113, "spellName": "Increase Spell Dam 36 and 1% Crit", "group": "mainHandEnchant", "effects": [{"key": "spellPower", "value": 36, "src": {"effectIndex": 0}}, {"key": "spellCrit", "value": 1, "src": {"effectIndex": 2}}], "notes": "Enchant 2628 -> spell 25113.", "_status": "[VERIFY]"},
  {"id": "elemental_sharpening_stone", "code": 51, "name": "Elemental Sharpening Stone", "category": "weapon", "spellId": 22755, "spellName": "Critical Weapon +2", "group": "mainHandEnchant", "effects": [{"key": "weaponCrit", "slots": ["mainHand"], "value": 2, "src": {"effectIndex": 0}}], "notes": "Enchant 2506 -> spell 22755 (aura 52, melee weapons). Applied to the main hand.", "_status": "[VERIFY]"},
  {"id": "dense_sharpening_stone", "code": 52, "name": "Dense Sharpening Stone", "category": "weapon", "spellId": null, "group": "mainHandEnchant", "effects": [{"key": "weaponDamage", "slots": ["mainHand"], "value": 8}], "notes": "Enchant 1643 'Sharpened +8' (SpellItemEnchantment EffectPointsMin 8; no aura spell). Applied to the main hand.", "_status": "[VERIFY]"},
  {"id": "sunder_armor", "code": 60, "name": "Sunder Armor (5)", "category": "debuff", "spellId": 11597, "spellName": "Sunder Armor", "group": "armor_major", "effects": [{"key": "targetArmor", "value": -2250, "src": {"effectIndex": 0, "mult": 5}}], "notes": "Rank 5, 450 per stack x 5 stacks. Sunder and Expose Armor do not stack.", "_status": "[VERIFY]"},
  {"id": "expose_armor", "code": 61, "name": "Expose Armor (5 cp)", "category": "debuff", "spellId": 11198, "spellName": "Expose Armor", "group": "armor_major", "effects": [{"key": "targetArmor", "value": -2250, "src": {"effectIndex": 0, "field": "perResource", "mult": 5}}], "notes": "Rank 5: EffectPointsPerResource -450 per combo point x 5. Improved Expose Armor not modeled.", "classic": "1700 armor", "_status": "[VERIFY]"},
  {"id": "faerie_fire", "code": 62, "name": "Faerie Fire", "category": "debuff", "spellId": 9907, "effects": [{"key": "targetArmor", "value": -505, "src": {"effectIndex": 0}}], "notes": "Rank 4; Faerie Fire (Feral) not checked.", "_status": "[VERIFY]"},
  {"id": "curse_of_recklessness", "code": 63, "name": "Curse of Recklessness", "category": "debuff", "spellId": 11717, "effects": [{"key": "targetArmor", "value": -505, "src": {"effectIndex": 1}}], "notes": "Rank 4 (ability chain).", "classic": "640 armor", "_status": "[VERIFY]"},
  {"id": "curse_of_the_elements", "code": 64, "name": "Curse of the Elements", "category": "debuff", "spellId": 1311680, "effects": [{"key": "targetResist", "schools": ["holy", "fire", "nature", "frost", "shadow", "arcane"], "value": -75, "src": {"effectIndex": 0}}, {"key": "targetDamageTakenPct", "schools": ["holy", "fire", "nature", "frost", "shadow", "arcane"], "value": 10, "src": {"effectIndex": 1}}], "notes": "Rank 4 (Forever spell). All magic schools (misc 126).", "classic": "fire and frost only", "_status": "[VERIFY]"}
 ],
 "presets": {
  "raidBuffs": ["battle_shout", "blessing_of_might", "blessing_of_kings", "mark_of_the_wild", "arcane_intellect", "power_word_fortitude", "divine_spirit", "leader_of_the_pack", "moonkin_aura", "trueshot_aura", "grace_of_air_totem", "strength_of_earth_totem"],
  "raidDebuffs": ["sunder_armor", "faerie_fire", "curse_of_recklessness", "curse_of_the_elements"]
 }
}
```

Rules: `code` is the URL code (1..127, unique, **never reused or renumbered**; new buffs get new codes). `group`: at most one
buff of a group is active (`armor_major`: Sunder and Expose Armor do not stack; `blessing_might`, `flask`, `food`,
`elixir_agility`, `elixir_strength`, `elixir_ap`, `mainHandEnchant`). Debuff effects use only `target*` keys and vice versa.
`classic` is informational (shown in the tooltip).

### 3.3 `data/manual/racials.json` (new)

```json
{
 "_source": "Forever build 1.60.1.70888: racial spells from SkillLineAbility skill lines 754 (Human), 125 (Orc), 101 (Dwarf), 126 (Night Elf), 753 (Gnome), 124 (Tauren), 733 (Troll), 220 (Undead); values from SpellEffect (read 2026-11-12, Phase 3 plan). Forever reworked the racials: no weapon-skill racials remain. Only DPS-relevant or stat racials are listed. [VERIFY] in game.",
 "_status": "[VERIFY]",
 "racials": [
  {"race": "HUMAN", "spellId": 20597, "name": "Ruthless", "kind": "passive", "effects": [{"key": "crit", "value": 1, "src": {"effectIndex": 0}}], "notes": "Aura 290. Replaces Classic Sword Specialization (same spell id).", "_status": "[VERIFY]"},
  {"race": "HUMAN", "spellId": 20598, "name": "The Human Spirit", "kind": "passive", "effects": [{"key": "statPct", "stat": "spi", "value": 10, "src": {"effectIndex": 0}}], "notes": "Classic: +5% Spirit.", "_status": "[VERIFY]"},
  {"race": "ORC", "spellId": 20574, "name": "Savage", "kind": "passive", "effects": [{"key": "crit", "value": 1, "src": {"effectIndex": 0}}], "notes": "Aura 290. Not listed in SkillLineAbility; the id was the Classic Orc Axe Specialization, so it is assumed to be Orc [VERIFY].", "_status": "[VERIFY]"},
  {"race": "ORC", "spellId": 20572, "name": "Blood Fury", "kind": "active", "effects": [], "notes": "+10% AP and spell power for a duration (cooldown, Phase 5).", "_status": "[VERIFY]"},
  {"race": "DWARF", "spellId": 1259719, "name": "Artisan's Precision", "kind": "passive", "effects": [{"key": "weaponHit", "value": 1, "src": {"effectIndex": 0}}, {"key": "spellHit", "value": 1, "src": {"effectIndex": 1}}], "notes": "Aura 54 + 55. Replaces Classic Gun Specialization.", "_status": "[VERIFY]"},
  {"race": "DWARF", "spellId": 1259721, "name": "Big Game Hunter", "kind": "passive", "effects": [], "notes": "+5% damage vs Beasts (target type, not modeled).", "_status": "[VERIFY]"},
  {"race": "NIGHTELF", "spellId": 1259799, "name": "Elune's Light", "kind": "active", "effects": [], "notes": "+10% crit for a duration (cooldown, Phase 5).", "_status": "[VERIFY]"},
  {"race": "GNOME", "spellId": 20591, "name": "Expansive Mind", "kind": "passive", "classes": ["PRIEST", "MAGE", "WARLOCK"], "effects": [{"key": "manaPct", "value": 5, "src": {"effectIndex": 0}}], "notes": "Rogue (1259803, energy) and Warrior (1259802, rage) variants are not DPS stats.", "_status": "[VERIFY]"},
  {"race": "GNOME", "spellId": 1259817, "name": "Eureka!", "kind": "active", "effects": [], "notes": "Class variants 1259812/1259813/1259817/1259821/1259823 (cooldown, Phase 5).", "_status": "[VERIFY]"},
  {"race": "TAUREN", "spellId": 20550, "name": "Endurance", "kind": "passive", "effects": [{"key": "healthPct", "value": 5, "src": {"effectIndex": 0}}], "_status": "[VERIFY]"},
  {"race": "TROLL", "spellId": 20554, "name": "Berserking", "kind": "active", "effects": [], "notes": "+10% attack and casting speed for a duration (cooldown, Phase 5). Classic: up to 30%.", "_status": "[VERIFY]"},
  {"race": "TROLL", "spellId": 20557, "name": "Beast Slaying", "kind": "passive", "effects": [], "notes": "+5% damage vs Beasts (target type, not modeled).", "_status": "[VERIFY]"},
  {"race": "SCOURGE", "spellId": 1260189, "name": "Touch of the Grave", "kind": "passive", "effects": [], "notes": "Health drain proc, not a DPS stat.", "_status": "[VERIFY]"}
 ]
}
```

Only `kind: "passive"` entries with non-empty `effects` are applied; `classes` limits an entry to some classes.

---

## 4. Data contracts (`src/data/types.ts`, task T3)

Add the three fields to `ClassInfo`, the effect/requirement fields to `Talent`, and append the rest. This is the exact diff:

```diff
diff --git a/src/data/types.ts b/src/data/types.ts
--- a/src/data/types.ts
+++ b/src/data/types.ts
@@ -61,6 +61,9 @@ export interface ClassInfo {
   traitTreeId: number;
   skillLineIds: number[];
   specs: ClassSpecInfo[];
+  raceIds: number[]; // CharBaseInfo: playable races, in classes.json race order
+  weaponSubclasses: number[]; // Item.SubclassID of class-2 weapons the class can learn (SkillLineAbility)
+  dualWield: boolean; // SkillLineAbility skill line 118 (rune-granted rows excluded)
 }
 export interface RaceInfo {
   id: number;
@@ -81,6 +84,21 @@ export interface TalentRank {
   description: string;
   unresolved?: string[];
 }
+/** A talent spell effect (Difficulty 0), parallel to `ranks[].values`. */
+export interface TalentEffect {
+  index: number;
+  effect: number; // SpellEffect.Effect (6 = APPLY_AURA)
+  aura: number; // SpellEffect.EffectAura (modern enum)
+  misc: [number, number];
+  mask: [number, number, number, number];
+  targets?: [number, number];
+}
+/** SpellEquippedItems: the aura is active only while a matching item is equipped. */
+export interface EquippedRequirement {
+  itemClass: number; // 2 = weapon, 4 = armor
+  subclassMask: number; // bit = Item.SubclassID; 0 = any subclass
+  invTypeMask: number; // bit = InventoryType; 0 = any slot (1 << 22 = off hand)
+}
 export interface Talent {
   nodeId: number;
   entryId: number;
@@ -98,6 +116,9 @@ export interface Talent {
   hidden?: true;
   valueSources: ("curve" | "base")[];
   ranks: TalentRank[];
+  effects: TalentEffect[];
+  equipped: EquippedRequirement | null;
+  shapeshiftMask: number; // SpellShapeshift.ShapeshiftMask_0; 0 = usable in any form
   choices?: Omit<Talent, "tier" | "col" | "requiredPoints" | "prereqNodeId">[];
 }
 export interface TierGate {
@@ -123,3 +144,171 @@ export interface TalentFile {
   maxPoints: number;
   specs: Spec[];
 }
+
+export type WeaponSlotKind = "mainHand" | "oneHand" | "twoHand" | "offHand" | "ranged" | "thrown" | "wand";
+export interface ItemStat {
+  stat: number; // ItemSparse stat id (STAT_NAMES in tools/pipeline/constants.py)
+  name: string;
+  value: number;
+}
+export interface Weapon {
+  id: number;
+  name: string;
+  quality: number;
+  itemLevel: number;
+  requiredLevel: number;
+  inventoryType: number;
+  slot: WeaponSlotKind;
+  subclass: number;
+  weaponType: string;
+  speedMs: number;
+  min: number;
+  max: number;
+  dps: number;
+  damageTable: string | null;
+  stats: ItemStat[];
+  allowableClass: number;
+  allowableRace: [number, number];
+  bonding: number;
+  icon: string | null;
+  iconFileId: number;
+  source: "forever" | "classic_era";
+  bonusDamage?: { min: number; max: number; school: string; source?: string };
+}
+export interface Ammo {
+  id: number;
+  name: string;
+  quality: number;
+  itemLevel: number;
+  requiredLevel: number;
+  subclass: number; // 2 arrow, 3 bullet
+  dps: number;
+  icon: string | null;
+}
+export interface WeaponsFile {
+  build: string;
+  weapons: Weapon[];
+  ammo: Ammo[];
+}
+
+export type TargetPresetId = "boss" | "elite" | "same" | "lowArmorBoss" | "custom";
+export interface TargetLevelRow {
+  level: number;
+  armor: number;
+  health: number;
+  armorConstant: number;
+  autoAttackDps: number;
+  spellDamage: number;
+}
+export interface TargetPreset {
+  id: TargetPresetId;
+  label: string;
+  levelOffset: number;
+  armorMultiplier: number;
+  default?: boolean;
+  editable?: boolean;
+  note?: string;
+}
+export interface TargetsFile {
+  build: string;
+  armorFormula: { base: number; perLevel: number; cap: number };
+  levels: TargetLevelRow[];
+  presets: TargetPreset[];
+  byPlayerLevel: Record<string, { preset: TargetPresetId; level: number; armor: number; health: number }[]>;
+}
+
+// ---- Hand-maintained data (data/manual/*.json), see docs/phase3-implementation-plan.md section 3 ----
+export type PrimaryStat = "str" | "agi" | "sta" | "int" | "spi";
+export type MagicSchool = "holy" | "fire" | "nature" | "frost" | "shadow" | "arcane";
+export type School = "physical" | MagicSchool;
+export type AttackSlot = "mainHand" | "offHand" | "ranged";
+export type EffectKey =
+  | "stat" | "statPct" | "health" | "healthPct" | "mana" | "manaPct"
+  | "attackPower" | "meleeAttackPower" | "rangedAttackPower" | "attackPowerPct" | "rangedAttackPowerPct"
+  | "spellPower" | "spellPowerFromStat"
+  | "crit" | "weaponCrit" | "spellCrit"
+  | "hit" | "weaponHit" | "spellHit"
+  | "haste" | "meleeHaste" | "rangedHaste" | "spellHaste"
+  | "weaponSkill" | "weaponDamage" | "offhandDamagePct" | "expertise"
+  | "armorPenPct" | "spellPen" | "damageDonePct"
+  | "targetArmor" | "targetResist" | "targetDamageTakenPct";
+export interface StatEffect {
+  key: EffectKey;
+  value: number;
+  stat?: PrimaryStat | "all"; // stat, statPct, spellPowerFromStat
+  schools?: School[]; // spellPower, spellPen, damageDonePct, target*: absent = all magic schools (all schools for damageDonePct)
+  slots?: AttackSlot[]; // weaponCrit, weaponHit, weaponSkill, weaponDamage: absent = every weapon slot
+}
+export interface ManualEffect extends StatEffect {
+  src?: { effectIndex: number; field?: "base" | "perResource"; mult?: number };
+}
+export type BuffCategory = "raid" | "world" | "consumable" | "weapon" | "debuff";
+export interface BuffDef {
+  id: string;
+  code: number; // stable URL code, never reused
+  name: string;
+  category: BuffCategory;
+  spellId: number | null;
+  spellName?: string;
+  group?: string; // at most one buff per group
+  effects: ManualEffect[];
+  notes?: string;
+  classic?: string;
+  _status: string;
+}
+export interface BuffsFile {
+  _source: string;
+  _status: string;
+  buffs: BuffDef[];
+  presets: { raidBuffs: string[]; raidDebuffs: string[] };
+}
+export type ManualClassToken = Uppercase<ClassToken>;
+export interface RacialDef {
+  race: string; // uppercase race token (HUMAN, SCOURGE, ...)
+  spellId: number;
+  name: string;
+  kind: "passive" | "active";
+  classes?: ManualClassToken[];
+  effects: ManualEffect[];
+  notes?: string;
+  _status: string;
+}
+export interface RacialsFile {
+  _source: string;
+  _status: string;
+  racials: RacialDef[];
+}
+export interface ClassBaseStats {
+  str: number;
+  agi: number;
+  sta: number;
+  int: number;
+  spi: number;
+  health: number;
+  mana: number;
+  baseMeleeCrit: number;
+  baseSpellCrit: number;
+}
+export interface ApFormula {
+  perLevel: number;
+  perStr: number;
+  perAgi: number;
+  flat: number;
+}
+export interface BaseStatsFile {
+  _source: string;
+  _status: string;
+  level: number;
+  baseCritUnit: "percent";
+  classes: Record<ManualClassToken, ClassBaseStats>;
+  raceOffsets: Record<string, Record<PrimaryStat, number>>;
+  conversions: {
+    meleeAttackPower: Record<ManualClassToken, ApFormula>;
+    rangedAttackPower: Partial<Record<ManualClassToken, ApFormula>>;
+    agiPerMeleeCrit: Record<ManualClassToken, number>;
+    intPerSpellCrit: Partial<Record<ManualClassToken, number>>;
+    healthPerSta: number;
+    manaPerInt: number;
+    statsWithoutBonus: number;
+  };
+}
```

`src/data/index.ts`: add these imports at the **top** of the file and the code at the end (the prototype appended both; move the
imports up):

```ts
import targetsJson from "@data/targets.json";
import baseStatsJson from "@manual/base-stats.json";
import buffsJson from "@manual/buffs.json";
import racialsJson from "@manual/racials.json";
import type { BaseStatsFile, BuffsFile, RaceInfo, RacialsFile, TargetsFile, WeaponsFile } from "./types";

export const targetsFile = targetsJson as unknown as TargetsFile;
export const baseStatsFile = baseStatsJson as unknown as BaseStatsFile;
export const buffsFile = buffsJson as unknown as BuffsFile;
export const racialsFile = racialsJson as unknown as RacialsFile;

export function getRace(id: number): RaceInfo {
  const r = classesFile.races.find((x) => x.id === id);
  if (!r) throw new Error(`unknown race ${id}`);
  return r;
}

let weaponsPromise: Promise<WeaponsFile> | null = null;
/** weapons.json (~110 KB gzip) is a lazy chunk, loaded once. */
export function loadWeapons(): Promise<WeaponsFile> {
  weaponsPromise ??= import("@data/weapons.json").then((m) => m.default as unknown as WeaponsFile);
  weaponsPromise.catch(() => (weaponsPromise = null));
  return weaponsPromise;
}
```

Toolchain: add the `@manual` alias.

- `vite.config.ts` → `resolve.alias`: `"@manual": fileURLToPath(new URL("./data/manual", import.meta.url)),` (after `@data`).
- `tsconfig.app.json` → `paths`: `"@manual/*": ["data/manual/*"]`.
- `eslint.config.js` → engine `no-restricted-imports` patterns: add `"@manual/*"` after `"@data/*"`.
- `vite.config.ts` → `build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1100 }`: the lazy `weapons` chunk is
  976 KB minified / 107 KB gzip and is expected (otherwise `vite build` prints a chunk-size warning).

Manual data invariants: new file `src/data/manual.test.ts` (exact):

```ts
import { describe, expect, it } from "vitest";
import { baseStatsFile, buffsFile, classesFile, racialsFile } from "./index";
import type { EffectKey } from "./types";

const KEYS: EffectKey[] = [
  "stat", "statPct", "health", "healthPct", "mana", "manaPct", "attackPower", "meleeAttackPower", "rangedAttackPower",
  "attackPowerPct", "rangedAttackPowerPct", "spellPower", "spellPowerFromStat", "crit", "weaponCrit", "spellCrit", "hit",
  "weaponHit", "spellHit", "haste", "meleeHaste", "rangedHaste", "spellHaste", "weaponSkill", "weaponDamage",
  "offhandDamagePct", "expertise", "armorPenPct", "spellPen", "damageDonePct", "targetArmor", "targetResist",
  "targetDamageTakenPct",
];

describe("manual data", () => {
  it("buffs: unique ids and codes, valid keys, presets exist", () => {
    const ids = buffsFile.buffs.map((b) => b.id);
    const codes = buffsFile.buffs.map((b) => b.code);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c >= 1 && c <= 127).toBe(true);
    for (const b of buffsFile.buffs) for (const e of b.effects) expect(KEYS).toContain(e.key);
    for (const b of buffsFile.buffs)
      for (const e of b.effects) expect(e.key.startsWith("target")).toBe(b.category === "debuff");
    for (const id of [...buffsFile.presets.raidBuffs, ...buffsFile.presets.raidDebuffs]) expect(ids).toContain(id);
  });
  it("base stats cover every class and race", () => {
    for (const c of classesFile.classes) {
      expect(baseStatsFile.classes[c.token.toUpperCase() as "WARRIOR"]).toBeDefined();
      expect(baseStatsFile.conversions.meleeAttackPower[c.token.toUpperCase() as "WARRIOR"]).toBeDefined();
      expect(baseStatsFile.conversions.agiPerMeleeCrit[c.token.toUpperCase() as "WARRIOR"]).toBeGreaterThan(0);
      expect(c.raceIds.length).toBeGreaterThan(0);
    }
    for (const r of classesFile.races) expect(baseStatsFile.raceOffsets[r.token.toUpperCase()]).toBeDefined();
  });
  it("racials reference known races and keys", () => {
    const races = classesFile.races.map((r) => r.token.toUpperCase());
    for (const r of racialsFile.racials) {
      expect(races).toContain(r.race);
      for (const e of r.effects) expect(KEYS).toContain(e.key);
    }
  });
});
```

Also extend `src/data/data.test.ts` "has 447 well-formed talents" with: `expect(t.effects).toHaveLength(t.ranks[0]!.values.length)`,
`expect(t).toHaveProperty("equipped")`, `expect(typeof t.shapeshiftMask).toBe("number")`.

---
## 5. Stat engine (`src/engine/stats`, tasks T4–T5)

Pure TypeScript: imports only `@/data/types` (types) and its own files. No React, no store, no JSON. Every constant that is not
confirmed in Forever is in `constants.ts` with a `src:` comment and `[VERIFY]`.

### 5.1 Modules

```
src/engine/stats/
  constants.ts      [VERIFY] Classic 1.12 rules (outcome tables, AP→DPS, ratings), item stat ids, requirement masks
  stat.ts           Stat { value, parts[] } + makeStat / applyPct (breakdowns)
  types.ts          engine types: EquippedWeapons, BonusStats, SourcedEffect, CharacterInput/Stats, TargetInput/View, outcomes
  equip.ts          matchingSlots(requirement, weapons), describeRequirement
  talentEffects.ts  generic talent mapper: AURA enum, mapAura, mapTalents → applied / damageDone / spellMods / notModeled
  assemble.ts       racials + buffs/debuffs + talents → CharacterInput (pure), EMPTY_BONUS
  character.ts      computeCharacter(input) → CharacterStats (target independent)
  target.ts         presetTarget, baseMeleeMiss, evaluateTarget(stats, target, armorFormula, dualWield) → TargetView
  weapons.ts        proficiency filter, picker slots, ammo, search
  index.ts          re-exports
  stats.test.ts     numeric tests (section 9.1)
src/testkit/stats.ts  test-only loader + run(scenario) helper
```

### 5.2 Order of operations (`computeCharacter`)

```
for each primary stat s:
  flat[s]  = classBase[s] + raceOffset[s] + bonus[s] + Σ weapon item stat s + Σ effects{key:"stat", stat:s|"all"}
  final[s] = flat[s] × Π (1 + pct/100) over effects{key:"statPct", stat:s|"all"}     (talents, racials, buffs; in that order)
health   = (baseHealth + f(Sta, 10) + Σ health) × Π(1 + healthPct)       f(x,k) = x ≤ 20 ? x : 20 + (x − 20)·k
mana     = (baseMana + f(Int, 15) + Σ mana) × Π(1 + manaPct)             null when baseMana = 0
AP       = (perLevel·L + flat + perStr·Str + perAgi·Agi + bonus.AP + item AP + Σ attackPower + Σ meleeAttackPower) × Π(1 + AP%)
RAP      = (perLevel·L + flat + perAgi·Agi + bonus.AP + bonus.RAP + item AP + item RAP + Σ attackPower + Σ rangedAttackPower) × Π(1 + RAP%)
           null when the class has no rangedAttackPower formula
SP[sch]  = bonus.SP + bonus.SP[sch] + item SP (45, 42) + Σ spellPower(sch) + Σ spellPowerFromStat(sch): pct × final[stat]
crit[slot]  = baseMeleeCrit + Agi/agiPerMeleeCrit + bonus.crit + critRating/14 + Σ crit + Σ weaponCrit(slot)   slot ∈ MH, OH, ranged
crit.spell  = baseSpellCrit + Int/intPerSpellCrit + bonus.spellCrit + critRating/14 + Σ crit + Σ spellCrit
hit[slot]   = bonus.hit + hitRating/10 + Σ hit + Σ weaponHit(slot);  hit.spell = bonus.spellHit + hitRating/10 + Σ hit + Σ spellHit
haste(kind) = (Π (1 + h/100) − 1) × 100 over bonus.haste, hasteRating/10, Σ haste, Σ <kind>Haste
skill[slot] = 5·L + bonus.weaponSkill + Σ weaponSkill(slot)
weapon[slot]: perSwing = (min+max)/2 + Σ weaponDamage(slot) + ammo.dps·speed (bow/gun/crossbow) + AP/14·speed (not wands)
              dps = perSwing / (speed / (1 + haste/100));  off hand: × 0.5 × Π(1 + offhandDamagePct)
```

Off-hand and ranged crit/hit/skill are `null` when nothing is equipped there; a wand in the ranged slot has damage but no ranged
outcome (wands use the spell table, Q40). Primary-stat order matters only for the breakdown (the product is the same).

### 5.3 Outcome rules vs a target (`evaluateTarget`, all `[VERIFY]` Q3/Q34)

```
defense = 5 × targetLevel;  diff = defense − skill
baseMiss(diff) = diff < 0 ? max(0, 5 + 0.04·diff) : 5 + diff·(diff > 10 ? 0.2 : 0.1)        300 vs 315 → 8%
effective hit  = max(0, hit − (diff > 10 ? 1 : 0))                                            first 1% ignored
special miss   = baseMiss − min(baseMiss, effHit);  hitCap = baseMiss + (diff > 10 ? 1 : 0)   → 9% vs boss
white miss     = baseMiss + 19 (dual wield, melee only) − min(that, effHit); whiteHitCap likewise (→ 28%)
dodge          = max(0, 5 + 0.1·diff) − min(that, expertise)                                  → 6.5%
parry = block = 0 (attacking from behind)
glancing       = ranged or targetLevel < L ? 0 : min(40, max(0, 10 + 2·(defense − min(skill, 5L))))   → 40% boss, 10% same level
crit vs target = sheet crit + 0.04·(skill − defense) − (targetLevel − L ≥ 3 ? 1.8 : 0), floored at 0   → −2.4 vs boss
whiteCritCap   = 100 − whiteMiss − dodge − parry − block − glancing;  whiteCrit = min(crit, cap)
spell miss     = clamp(baseSpellMiss(targetLevel − L) − spellHit, 1, 99); baseSpellMiss = d ≤ 2 ? max(1, 4 + d) : 6 + 11(d − 2)
                 → 4/5/6/17/28% for +0..+4; spell hitCap = baseSpellMiss − 1 (16% vs boss)
armor          = max(0, targetArmor + Σ targetArmor debuffs) × (1 − armorPen/100)
DR             = min(cap, armor / (armor + base + perLevel·L)) × 100        (targets.json armorFormula; 3731 → 40.42%)
resist[sch]    = max(0, target + Σ targetResist − spellPen)
damageTaken[sch] = Σ targetDamageTakenPct  (shown; applied in Phase 4)
```

### 5.4 Generic talent mapper rules (`mapTalents`)

For each invested talent (rank r ≥ 1, value of effect at array position p = `ranks[r−1].values[p]`):

1. `kind === "ability"` → note `ability` (Phase 4/5). Nothing applied.
2. `shapeshiftMask !== 0` → note `inactive` ("requires a shapeshift form (Phase 4)").
3. `slots = matchingSlots(equipped, weapons)`; `inactive = equipped !== null && slots.length === 0`.
4. Per effect: non-aura effect (≠ 0) → `special`; aura on a non-caster target → `special`; otherwise `mapAura`:

| Aura | Mapped to | Per slot |
|---|---|---|
| 29 MOD_STAT | `stat` (misc[0]: 0..4, −1 all) | |
| 137 MOD_TOTAL_STAT_PERCENTAGE | `statPct` per stat in misc[1] bitmask (or misc[0]) | |
| 52 MOD_WEAPON_CRIT_PERCENT | `weaponCrit` | yes |
| 290 MOD_CRIT_PCT | `crit` (melee, ranged, spell) | |
| 57 MOD_SPELL_CRIT_CHANCE | `spellCrit` | |
| 54 MOD_HIT_CHANCE | `weaponHit` | yes |
| 55 MOD_SPELL_HIT_CHANCE | `spellHit` | |
| 99 / 124 | `meleeAttackPower` / `rangedAttackPower` | |
| 166 / 167 | `attackPowerPct` / `rangedAttackPowerPct` | |
| 13 MOD_DAMAGE_DONE | `spellPower`, schools from misc[0] (physical bit dropped) | |
| 174 MOD_SPELL_DAMAGE_OF_STAT_PERCENT | `spellPowerFromStat` (schools misc[0], stat misc[1]) | |
| 122 | `offhandDamagePct` | |
| 240 | `expertise` (% dodge reduction, Q42) | |
| 280 | `armorPenPct` | |
| 123 MOD_TARGET_RESISTANCE | `spellPen` = −value | |
| 319 / 342 / 65 | `meleeHaste` / melee+ranged haste / `spellHaste` | |
| 30 MOD_SKILL (weapon skill lines) | `weaponSkill`, slots whose weapon subclass belongs to the line | yes |
| 79 MOD_DAMAGE_PERCENT_DONE | `damageDonePct` (schools misc[0]) → recorded only | |
| 107 / 108 | `SpellMod {op: misc[0], value, pct, mask}` → note `spellMod` | |
| 4, 42, 231, 226, 332, 109, 36 | note `special` | |
| ignored list (defense, armor, health, regen, threat, immunities, 268, 271, ...) | nothing | |
| anything else | note `unsupported` | |

Stat/damage effects of an `inactive` talent are not applied; the talent is noted `inactive` with `describeRequirement()`.
Each note is deduplicated per (talent, reason).

### 5.5 Code (exact; validated)

`constants.ts`:

```ts
// Phase 3 stat-engine constants. Every value is a Classic 1.12 assumption until confirmed in Forever ([VERIFY], Q3/Q4/Q34).

/** src: Classic 1.12, max weapon skill and defense = 5 x level (CALC_MODEL section 2). [VERIFY] */
export const SKILL_PER_LEVEL = 5;

/** src: vmangos Unit::MeleeMissChanceCalc (Classic 1.12, recalled): 5% base miss. [VERIFY Q3] */
export const BASE_MELEE_MISS = 5;
/** src: same; defense - skill <= 10: +0.1% miss per point. [VERIFY Q3] */
export const MISS_PER_SKILL_LOW = 0.1;
/** src: same; defense - skill > 10: +0.2% miss per point for the whole difference (300 vs 315 = 8%). [VERIFY Q3] */
export const MISS_PER_SKILL_HIGH = 0.2;
/** src: same; skill above defense: -0.04% miss per point. [VERIFY Q3] */
export const MISS_PER_SKILL_ABOVE = 0.04;
/** src: Classic community testing (Magey): when defense - skill > 10 the first 1% of +hit is ignored. [VERIFY Q3] */
export const HIT_SUPPRESSION = 1;
export const HIT_SUPPRESSION_SKILL_GAP = 10;
/** src: vmangos: dual wield white attacks get +19% miss. [VERIFY Q3] */
export const DUAL_WIELD_MISS = 19;
/** src: vmangos: dodge = 5% + 0.1% per defense-skill point. [VERIFY Q3] */
export const BASE_DODGE = 5;
export const DODGE_PER_SKILL = 0.1;
/** src: vmangos: glancing = 10% + 2% per (defense - min(skill, 5 x level)), white melee only, cap 40%. [VERIFY Q3] */
export const BASE_GLANCE = 10;
export const GLANCE_PER_SKILL = 2;
export const MAX_GLANCE = 40;
/** src: vmangos: crit changes by 0.04% per point of (skill - defense). [VERIFY Q3] */
export const CRIT_PER_SKILL = 0.04;
/** src: Classic community testing (Magey): extra -1.8% crit vs targets 3+ levels higher. CALC_MODEL also mentions -3% (Q34). [VERIFY] */
export const BOSS_CRIT_SUPPRESSION = 1.8;
export const BOSS_LEVEL_GAP = 3;

/** src: vmangos Unit::MagicSpellHitResult: hit = 96 - diff (diff <= 2), 94 - 11 x (diff - 2) beyond; 1%..99%. [VERIFY Q3] */
export function baseSpellMiss(levelDiff: number): number {
  const miss = levelDiff <= 2 ? 4 + levelDiff : 6 + 11 * (levelDiff - 2);
  return Math.min(99, Math.max(MIN_SPELL_MISS, miss));
}
export const MIN_SPELL_MISS = 1;

/** src: CALC_MODEL section 3: 14 AP = 1 weapon DPS. [VERIFY Q4] */
export const AP_PER_DPS = 14;
/** src: Classic 1.12: off-hand white damage is halved. [VERIFY] */
export const OFFHAND_DAMAGE_MULT = 0.5;

/** src: Forever weapons carry Classic "+1% hit"/"+1% crit" as rating: Core Marksman Rifle hit 10, Heartseeker crit 14,
 * Fist of Cenarius crit 28 (+2% spell crit). Level-60 rating per 1%, applied to melee, ranged and spells. [VERIFY Q35] */
export const HIT_RATING_PER_PCT = 10;
export const CRIT_RATING_PER_PCT = 14;
export const HASTE_RATING_PER_PCT = 10;

/** ItemSparse stat ids used from weapons (tools/pipeline/constants.py STAT_NAMES). Others are listed as not modeled. */
export const ITEM_STAT = {
  agi: 3,
  str: 4,
  int: 5,
  spi: 6,
  sta: 7,
  hitRating: 31,
  critRating: 32,
  hasteRating: 36,
  attackPower: 38,
  rangedAttackPower: 39,
  spellDamage: 42,
  spellPower: 45,
} as const;

/** Weapon proficiency skill lines -> Item.SubclassID (same table as the pipeline). */
export const WEAPON_SKILL_LINE_SUBCLASSES: Readonly<Record<number, readonly number[]>> = {
  44: [0],
  172: [1],
  45: [2],
  46: [3],
  54: [4],
  160: [5],
  229: [6],
  43: [7],
  55: [8],
  136: [10],
  473: [13],
  173: [15],
  176: [16],
  226: [18],
  228: [19],
};
/** InventoryType 22 = INVTYPE_WEAPONOFFHAND; a requirement with this bit only matches the off-hand slot. */
export const INVTYPE_OFFHAND_BIT = 1 << 22;
export const ITEM_CLASS_WEAPON = 2;
export const ITEM_CLASS_ARMOR = 4;
/** Subclass masks seen in SpellEquippedItems (70888). */
export const SUBCLASS_MASK = {
  melee: 173555,
  twoHand: 136546,
  oneHandOffhand: 41105,
  ranged: 262156,
  wand: 524288,
  dagger: 32768,
} as const;
```

`stat.ts`:

```ts
export type SourceKind =
  | "base"
  | "race"
  | "racial"
  | "gear"
  | "weapon"
  | "buff"
  | "debuff"
  | "talent"
  | "conversion"
  | "rule";
export interface Part {
  label: string;
  kind: SourceKind;
  value: number;
}
/** A derived number and where it comes from. Invariant: value === sum of parts.value. */
export interface Stat {
  value: number;
  parts: Part[];
}

export function makeStat(parts: Part[]): Stat {
  const kept = parts.filter((p, i) => i === 0 || p.value !== 0);
  return { value: kept.reduce((a, p) => a + p.value, 0), parts: kept };
}

/** Multiplies by (1 + pct/100) for each modifier in order; each step is recorded as its own part. */
export function applyPct(s: Stat, mods: readonly { label: string; kind: SourceKind; value: number }[]): Stat {
  let value = s.value;
  const parts = [...s.parts];
  for (const m of mods) {
    const inc = (value * m.value) / 100;
    if (inc === 0) continue;
    parts.push({ label: `${m.label} ${m.value > 0 ? "+" : ""}${m.value}%`, kind: m.kind, value: inc });
    value += inc;
  }
  return { value, parts };
}

export const ZERO: Stat = { value: 0, parts: [] };
```

`types.ts`:

```ts
import type {
  Ammo,
  AttackSlot,
  BaseStatsFile,
  ClassToken,
  MagicSchool,
  PrimaryStat,
  School,
  StatEffect,
  TargetPresetId,
  Weapon,
} from "@/data/types";
import type { SourceKind, Stat } from "./stat";

export const PRIMARY_STATS: readonly PrimaryStat[] = ["str", "agi", "sta", "int", "spi"];
export const MAGIC_SCHOOLS: readonly MagicSchool[] = ["holy", "fire", "nature", "frost", "shadow", "arcane"];
/** SpellSchoolMask bit order: physical 1, holy 2, fire 4, nature 8, frost 16, shadow 32, arcane 64. */
export const SCHOOL_BITS: readonly School[] = ["physical", ...MAGIC_SCHOOLS];
export const ATTACK_SLOTS: readonly AttackSlot[] = ["mainHand", "offHand", "ranged"];

export interface EquippedWeapons {
  mainHand: Weapon | null;
  offHand: Weapon | null;
  ranged: Weapon | null; // bow, gun, crossbow, thrown or wand
  ammo: Ammo | null;
}

/** Manual "bonus stats" (gear v1). Percent fields are percentage points. */
export interface BonusStats {
  str: number;
  agi: number;
  sta: number;
  int: number;
  spi: number;
  attackPower: number; // melee and ranged, like "+X Attack Power" gear
  rangedAttackPower: number;
  spellPower: number; // all magic schools
  holySpellPower: number;
  fireSpellPower: number;
  natureSpellPower: number;
  frostSpellPower: number;
  shadowSpellPower: number;
  arcaneSpellPower: number;
  hit: number; // melee + ranged
  spellHit: number;
  crit: number; // melee + ranged
  spellCrit: number;
  haste: number; // melee, ranged and spell
  weaponSkill: number; // every weapon slot
}

export interface SourcedEffect extends StatEffect {
  label: string;
  kind: SourceKind;
}

export interface CharacterInput {
  classToken: ClassToken;
  race: string; // uppercase race token (HUMAN, SCOURGE, ...)
  level: number;
  baseStats: BaseStatsFile;
  weapons: EquippedWeapons;
  bonus: BonusStats;
  effects: readonly SourcedEffect[]; // racials, buffs/debuffs and applied talent effects
}

export interface WeaponDamage {
  slot: AttackSlot;
  weaponId: number;
  name: string;
  min: number;
  max: number;
  speed: number; // seconds, unhasted
  hastedSpeed: number;
  perSwing: Stat; // average damage of one swing/shot (no crit, no armor)
  dps: Stat; // perSwing / hastedSpeed (off hand: x 0.5 x off-hand bonus)
  isWand: boolean;
}

export interface CharacterStats {
  classToken: ClassToken;
  level: number;
  primary: Record<PrimaryStat, Stat>;
  health: Stat;
  mana: Stat | null; // null for rage/energy classes
  attackPower: Stat;
  rangedAttackPower: Stat | null; // null if the class has no ranged attack power formula
  spellPower: Record<MagicSchool, Stat>;
  crit: { mainHand: Stat; offHand: Stat | null; ranged: Stat | null; spell: Stat }; // character sheet, % points
  hit: { mainHand: Stat; offHand: Stat | null; ranged: Stat | null; spell: Stat };
  haste: { melee: Stat; ranged: Stat; spell: Stat }; // % (multiplicative stacking)
  weaponSkill: { mainHand: Stat; offHand: Stat | null; ranged: Stat | null };
  expertise: Stat; // % dodge/parry reduction [VERIFY unit]
  armorPenPct: Stat;
  spellPen: Record<MagicSchool, Stat>;
  weapons: Record<AttackSlot, WeaponDamage | null>;
  damageDone: SourcedEffect[]; // recorded aura-79 modifiers, applied in Phase 4
  hasSpellCrit: boolean; // class has an Int -> spell crit ratio
}

export interface TargetInput {
  presetId: TargetPresetId;
  level: number;
  armor: number; // before debuffs
  resist: Record<MagicSchool, number>;
  debuffs: readonly SourcedEffect[]; // targetArmor / targetResist / targetDamageTakenPct
}

export interface MeleeOutcome {
  /** Special (yellow) attacks: two-roll, no glancing. Percent points. */
  miss: Stat;
  dodge: Stat;
  parry: number; // 0: attacking from behind
  block: number; // 0: attacking from behind
  crit: Stat; // vs target, after suppression
  /** White attacks (single roll). Ranged has glancing 0. */
  whiteMiss: Stat;
  glancing: number;
  whiteCrit: number; // min(crit, whiteCritCap)
  whiteCritCap: number;
  hitCap: number; // +hit needed to remove special misses (incl. suppression)
  whiteHitCap: number;
}
export interface SpellOutcome {
  miss: Stat;
  crit: Stat;
  hitCap: number;
}
export interface TargetView {
  presetId: TargetPresetId;
  level: number;
  armor: Stat; // after debuffs and armor penetration (physical)
  armorReduction: Stat; // percent of physical damage removed
  resist: Record<MagicSchool, Stat>;
  damageTakenPct: Record<School, number>;
  mainHand: MeleeOutcome | null;
  offHand: MeleeOutcome | null;
  ranged: MeleeOutcome | null;
  spell: SpellOutcome;
  /** Phase 4 hook: analytical DPS of the build vs this target. Always undefined in Phase 3. */
  dps?: number;
}
```

`equip.ts`:

```ts
import type { AttackSlot, EquippedRequirement, Weapon } from "@/data/types";
import { INVTYPE_OFFHAND_BIT, ITEM_CLASS_ARMOR, ITEM_CLASS_WEAPON, SUBCLASS_MASK } from "./constants";
import { ATTACK_SLOTS, type EquippedWeapons } from "./types";

function fits(req: EquippedRequirement, w: Weapon): boolean {
  return req.subclassMask === 0 || (req.subclassMask & (1 << w.subclass)) !== 0;
}

/** Attack slots whose equipped weapon satisfies the requirement (empty: the aura is inactive). */
export function matchingSlots(req: EquippedRequirement | null, weapons: EquippedWeapons): AttackSlot[] {
  if (!req) return [...ATTACK_SLOTS];
  if (req.itemClass !== ITEM_CLASS_WEAPON) return []; // shields (class 4) are not modeled in Phase 3
  const offOnly = (req.invTypeMask & INVTYPE_OFFHAND_BIT) !== 0;
  return ATTACK_SLOTS.filter((slot) => {
    const w = weapons[slot];
    if (!w || (offOnly && slot !== "offHand")) return false;
    return fits(req, w);
  });
}

export function describeRequirement(req: EquippedRequirement): string {
  if (req.itemClass === ITEM_CLASS_ARMOR) return "requires a shield";
  if (req.invTypeMask & INVTYPE_OFFHAND_BIT) return "requires an off-hand weapon";
  switch (req.subclassMask) {
    case SUBCLASS_MASK.melee:
      return "requires a melee weapon";
    case SUBCLASS_MASK.twoHand:
      return "requires a two-handed melee weapon";
    case SUBCLASS_MASK.ranged:
      return "requires a bow, gun or crossbow";
    case SUBCLASS_MASK.wand:
      return "requires a wand";
    case SUBCLASS_MASK.dagger:
      return "requires a dagger";
    default:
      return "requires a matching weapon";
  }
}
```

`talentEffects.ts`:

```ts
import type { AttackSlot, PrimaryStat, School, StatEffect, Talent, TalentEffect } from "@/data/types";
import { WEAPON_SKILL_LINE_SUBCLASSES } from "./constants";
import { describeRequirement, matchingSlots } from "./equip";
import { PRIMARY_STATS, SCHOOL_BITS, type EquippedWeapons, type SourcedEffect } from "./types";

/** SpellEffect.Effect values that apply an aura (same set as tools/pipeline/constants.py APPLY_AURA_EFFECTS). */
const APPLY_AURA_EFFECTS = new Set([6, 35, 65, 119, 128, 129, 143]);
const TARGET_CASTER = 1;

/** Modern aura enum (Q23). Names follow TrinityCore master; [VERIFY] where Forever behavior is unconfirmed. */
export const AURA = {
  MOD_DAMAGE_DONE: 13,
  MOD_STAT: 29,
  MOD_SKILL: 30,
  MOD_WEAPON_CRIT_PERCENT: 52,
  MOD_HIT_CHANCE: 54,
  MOD_SPELL_HIT_CHANCE: 55,
  MOD_SPELL_CRIT_CHANCE: 57,
  MOD_CASTING_SPEED_NOT_STACK: 65,
  MOD_DAMAGE_PERCENT_DONE: 79,
  MOD_ATTACK_POWER: 99,
  ADD_FLAT_MODIFIER: 107,
  ADD_PCT_MODIFIER: 108,
  MOD_OFFHAND_DAMAGE_PCT: 122,
  MOD_TARGET_RESISTANCE: 123,
  MOD_RANGED_ATTACK_POWER: 124,
  MOD_TOTAL_STAT_PERCENTAGE: 137,
  MOD_ATTACK_POWER_PCT: 166,
  MOD_RANGED_ATTACK_POWER_PCT: 167,
  MOD_SPELL_DAMAGE_OF_STAT_PERCENT: 174,
  MOD_EXPERTISE: 240,
  MOD_ARMOR_PENETRATION_PCT: 280, // Serrated Blades "ignore X% armor" [VERIFY]
  MOD_CRIT_PCT: 290,
  MOD_MELEE_HASTE: 319, // [VERIFY]
  MOD_MELEE_RANGED_HASTE: 342, // [VERIFY]
} as const;

/** Auras with server-side behavior (Phase 4 handlers). */
const SPECIAL_AURAS = new Set([4, 42, 231, 226, 332, 109, 36]);
/** Auras that are not DPS stats (defense, health, armor, regen, threat, immunities, ...). */
const IGNORED_AURAS = new Set([
  5, 8, 10, 12, 17, 22, 26, 27, 31, 33, 34, 39, 43, 47, 49, 51, 61, 69, 77, 85, 87, 110, 118, 133, 134, 136,
  142, 154, 172, 175, 178, 185, 186, 232, 268, 271, 466,
]);
const WEAPON_SKILL_LINES = new Set(Object.keys(WEAPON_SKILL_LINE_SUBCLASSES).map(Number));

export type NotModeledReason = "spellMod" | "special" | "unsupported" | "ability" | "inactive";
export interface NotModeled {
  nodeId: number;
  name: string;
  rank: number;
  reason: NotModeledReason;
  detail: string;
}
/** ADD_FLAT_MODIFIER / ADD_PCT_MODIFIER: applied to spells whose family mask matches (Phase 4). */
export interface SpellMod {
  nodeId: number;
  name: string;
  effectIndex: number;
  op: number; // SpellModOp (EffectMiscValue_0): 0 damage, 7 crit chance, 10 cast time, 14 cost, ...
  value: number;
  pct: boolean; // aura 108
  mask: [number, number, number, number];
}
export interface TalentMapping {
  applied: SourcedEffect[]; // stat effects active for the current weapons
  damageDone: SourcedEffect[]; // aura 79, active only (recorded for Phase 4)
  spellMods: SpellMod[];
  notModeled: NotModeled[];
}
export interface RankedTalent {
  talent: Talent;
  rank: number; // 1..maxRank
}

const statsOfMask = (mask: number): PrimaryStat[] => PRIMARY_STATS.filter((_, i) => mask & (1 << i));
const statOfIndex = (i: number): PrimaryStat | "all" => (i < 0 ? "all" : PRIMARY_STATS[i]!);
export const schoolsOfMask = (mask: number): School[] => SCHOOL_BITS.filter((_, i) => mask & (1 << i));

type Mapped =
  | { kind: "stat"; effects: StatEffect[]; perSlot: boolean } // perSlot: restrict to matching weapon slots
  | { kind: "damageDone"; effects: StatEffect[] }
  | { kind: "spellMod" }
  | { kind: "special" }
  | { kind: "unsupported" }
  | { kind: "ignored" };

/** Maps one aura effect to the stat vocabulary. `v` is the per-rank value from ranks[r-1].values. */
export function mapAura(e: TalentEffect, v: number): Mapped {
  const [m0, m1] = e.misc;
  switch (e.aura) {
    case AURA.MOD_STAT:
      return { kind: "stat", perSlot: false, effects: [{ key: "stat", stat: statOfIndex(m0), value: v }] };
    case AURA.MOD_TOTAL_STAT_PERCENTAGE: {
      const mask = m1 !== 0 ? m1 : m0 < 0 ? 31 : 1 << m0;
      const stats = statsOfMask(mask);
      const effects: StatEffect[] =
        stats.length === 5
          ? [{ key: "statPct", stat: "all", value: v }]
          : stats.map((s) => ({ key: "statPct", stat: s, value: v }));
      return { kind: "stat", perSlot: false, effects };
    }
    case AURA.MOD_WEAPON_CRIT_PERCENT:
      return { kind: "stat", perSlot: true, effects: [{ key: "weaponCrit", value: v }] };
    case AURA.MOD_CRIT_PCT:
      return { kind: "stat", perSlot: false, effects: [{ key: "crit", value: v }] };
    case AURA.MOD_SPELL_CRIT_CHANCE:
      return { kind: "stat", perSlot: false, effects: [{ key: "spellCrit", value: v }] };
    case AURA.MOD_HIT_CHANCE:
      return { kind: "stat", perSlot: true, effects: [{ key: "weaponHit", value: v }] };
    case AURA.MOD_SPELL_HIT_CHANCE:
      return { kind: "stat", perSlot: false, effects: [{ key: "spellHit", value: v }] };
    case AURA.MOD_ATTACK_POWER:
      return { kind: "stat", perSlot: false, effects: [{ key: "meleeAttackPower", value: v }] };
    case AURA.MOD_RANGED_ATTACK_POWER:
      return { kind: "stat", perSlot: false, effects: [{ key: "rangedAttackPower", value: v }] };
    case AURA.MOD_ATTACK_POWER_PCT:
      return { kind: "stat", perSlot: false, effects: [{ key: "attackPowerPct", value: v }] };
    case AURA.MOD_RANGED_ATTACK_POWER_PCT:
      return { kind: "stat", perSlot: false, effects: [{ key: "rangedAttackPowerPct", value: v }] };
    case AURA.MOD_DAMAGE_DONE:
      return {
        kind: "stat",
        perSlot: false,
        effects: [{ key: "spellPower", schools: schoolsOfMask(m0 & ~1), value: v }],
      };
    case AURA.MOD_SPELL_DAMAGE_OF_STAT_PERCENT:
      return {
        kind: "stat",
        perSlot: false,
        effects: [
          { key: "spellPowerFromStat", stat: statOfIndex(m1), schools: schoolsOfMask(m0 & ~1), value: v },
        ],
      };
    case AURA.MOD_OFFHAND_DAMAGE_PCT:
      return { kind: "stat", perSlot: false, effects: [{ key: "offhandDamagePct", value: v }] };
    case AURA.MOD_EXPERTISE:
      return { kind: "stat", perSlot: false, effects: [{ key: "expertise", value: v }] };
    case AURA.MOD_ARMOR_PENETRATION_PCT:
      return { kind: "stat", perSlot: false, effects: [{ key: "armorPenPct", value: v }] };
    case AURA.MOD_TARGET_RESISTANCE:
      return {
        kind: "stat",
        perSlot: false,
        effects: [{ key: "spellPen", schools: schoolsOfMask(m0 & ~1), value: -v }],
      };
    case AURA.MOD_MELEE_HASTE:
      return { kind: "stat", perSlot: false, effects: [{ key: "meleeHaste", value: v }] };
    case AURA.MOD_MELEE_RANGED_HASTE:
      return {
        kind: "stat",
        perSlot: false,
        effects: [
          { key: "meleeHaste", value: v },
          { key: "rangedHaste", value: v },
        ],
      };
    case AURA.MOD_CASTING_SPEED_NOT_STACK:
      return { kind: "stat", perSlot: false, effects: [{ key: "spellHaste", value: v }] };
    case AURA.MOD_SKILL:
      if (WEAPON_SKILL_LINES.has(m0))
        return { kind: "stat", perSlot: true, effects: [{ key: "weaponSkill", value: v }] };
      return { kind: "ignored" };
    case AURA.MOD_DAMAGE_PERCENT_DONE:
      return {
        kind: "damageDone",
        effects: [{ key: "damageDonePct", schools: schoolsOfMask(m0), value: v }],
      };
    case AURA.ADD_FLAT_MODIFIER:
    case AURA.ADD_PCT_MODIFIER:
      return { kind: "spellMod" };
    default:
      if (SPECIAL_AURAS.has(e.aura)) return { kind: "special" };
      if (IGNORED_AURAS.has(e.aura)) return { kind: "ignored" };
      return { kind: "unsupported" };
  }
}

function skillSlots(skillLine: number, weapons: EquippedWeapons): AttackSlot[] {
  const subs = WEAPON_SKILL_LINE_SUBCLASSES[skillLine] ?? [];
  return (["mainHand", "offHand", "ranged"] as const).filter((s) => {
    const w = weapons[s];
    return w !== null && subs.includes(w.subclass);
  });
}

/** Generic talent mapper (Phase 3): stat-level auras of passive talents; everything else is listed. */
export function mapTalents(list: readonly RankedTalent[], weapons: EquippedWeapons): TalentMapping {
  const out: TalentMapping = { applied: [], damageDone: [], spellMods: [], notModeled: [] };
  for (const { talent: t, rank } of list) {
    const values = t.ranks[rank - 1]?.values ?? [];
    const label = `${t.name} ${rank}/${t.maxRank}`;
    const note = (reason: NotModeledReason, detail: string) => {
      if (!out.notModeled.some((n) => n.nodeId === t.nodeId && n.reason === reason))
        out.notModeled.push({ nodeId: t.nodeId, name: t.name, rank, reason, detail });
    };
    if (t.kind === "ability") {
      note("ability", "ability or cooldown (Phase 4/5)");
      continue;
    }
    if (t.shapeshiftMask !== 0) {
      note("inactive", "requires a shapeshift form (Phase 4)");
      continue;
    }
    const slots = matchingSlots(t.equipped, weapons);
    const inactive = t.equipped !== null && slots.length === 0;
    for (const [pos, e] of t.effects.entries()) {
      const v = values[pos] ?? 0; // ranks[].values is parallel to effects[] (position, not effect index)
      if (!APPLY_AURA_EFFECTS.has(e.effect)) {
        if (e.effect !== 0) note("special", `effect ${e.effect}`);
        continue;
      }
      if (e.targets && e.targets[0] !== TARGET_CASTER) {
        note("special", `aura ${e.aura} on target ${e.targets[0]}`);
        continue;
      }
      const m = mapAura(e, v);
      switch (m.kind) {
        case "stat":
        case "damageDone":
          if (inactive) {
            note("inactive", describeRequirement(t.equipped!));
            break;
          }
          for (const se of m.effects) {
            const sourced: SourcedEffect = { ...se, label, kind: "talent" };
            if (e.aura === AURA.MOD_SKILL) sourced.slots = skillSlots(e.misc[0], weapons);
            else if (m.kind === "stat" && m.perSlot && t.equipped) sourced.slots = slots;
            (m.kind === "damageDone" ? out.damageDone : out.applied).push(sourced);
          }
          break;
        case "spellMod":
          out.spellMods.push({
            nodeId: t.nodeId,
            name: t.name,
            effectIndex: e.index,
            op: e.misc[0],
            value: v,
            pct: e.aura === AURA.ADD_PCT_MODIFIER,
            mask: e.mask,
          });
          note("spellMod", "modifies specific spells (Phase 4)");
          break;
        case "special":
          note("special", `aura ${e.aura} needs a handler (Phase 4)`);
          break;
        case "unsupported":
          note("unsupported", `aura ${e.aura} is not supported yet`);
          break;
        case "ignored":
          break;
      }
    }
  }
  return out;
}
```

`character.ts`:

```ts
import type { AttackSlot, MagicSchool, PrimaryStat, School, Weapon } from "@/data/types";
import {
  AP_PER_DPS,
  CRIT_RATING_PER_PCT,
  HASTE_RATING_PER_PCT,
  HIT_RATING_PER_PCT,
  ITEM_STAT,
  OFFHAND_DAMAGE_MULT,
  SKILL_PER_LEVEL,
} from "./constants";
import { applyPct, makeStat, type Part, type SourceKind, type Stat } from "./stat";
import {
  ATTACK_SLOTS,
  MAGIC_SCHOOLS,
  PRIMARY_STATS,
  type CharacterInput,
  type CharacterStats,
  type SourcedEffect,
  type WeaponDamage,
} from "./types";

const WAND_SUBCLASS = 19;

export class UnsupportedLevelError extends Error {}

const STAT_LABEL: Record<PrimaryStat, string> = {
  str: "Strength",
  agi: "Agility",
  sta: "Stamina",
  int: "Intellect",
  spi: "Spirit",
};
const STAT_ITEM_ID: Record<PrimaryStat, number> = {
  str: ITEM_STAT.str,
  agi: ITEM_STAT.agi,
  sta: ITEM_STAT.sta,
  int: ITEM_STAT.int,
  spi: ITEM_STAT.spi,
};
const SCHOOL_BONUS_KEY = {
  holy: "holySpellPower",
  fire: "fireSpellPower",
  nature: "natureSpellPower",
  frost: "frostSpellPower",
  shadow: "shadowSpellPower",
  arcane: "arcaneSpellPower",
} as const;

const part = (label: string, kind: SourceKind, value: number): Part => ({ label, kind, value });
const r2 = (n: number) => Math.round(n * 100) / 100;
const hasSchool = (e: SourcedEffect, s: School) => !e.schools || e.schools.includes(s);
const hasSlot = (e: SourcedEffect, s: AttackSlot) => !e.slots || e.slots.includes(s);

/** Equipped weapons in slot order, each counted once. */
function equipped(input: CharacterInput): { slot: AttackSlot; w: Weapon }[] {
  return ATTACK_SLOTS.flatMap((slot) => (input.weapons[slot] ? [{ slot, w: input.weapons[slot]! }] : []));
}
function itemStat(input: CharacterInput, statId: number): Part[] {
  return equipped(input).flatMap(({ w }) =>
    w.stats.filter((s) => s.stat === statId).map((s) => part(w.name, "weapon", s.value)),
  );
}
function effectParts(
  effects: readonly SourcedEffect[],
  pred: (e: SourcedEffect) => boolean,
  scale = 1,
): Part[] {
  return effects.filter(pred).map((e) => part(e.label, e.kind, e.value * scale));
}

/**
 * Character sheet numbers (target-independent). Order of operations (section 5.2 of the Phase 3 plan):
 * 1. primary stats: class base + race + gear + weapons + flat effects, then each % effect multiplicatively
 * 2. health/mana from final Sta/Int, 3. AP/RAP from final Str/Agi + flat AP, then AP %, 4. spell power,
 * 5. crit/hit per attack slot and for spells, 6. haste (multiplicative), 7. weapon damage.
 */
export function computeCharacter(input: CharacterInput): CharacterStats {
  const { baseStats: bs, bonus, effects, level } = input;
  const cls = input.classToken.toUpperCase() as Uppercase<typeof input.classToken>;
  if (bs.level !== level)
    throw new UnsupportedLevelError(`base stats exist for level ${bs.level} only (Q14)`);
  const base = bs.classes[cls];
  const race = bs.raceOffsets[input.race];
  if (!base || !race) throw new Error(`no base stats for ${input.race} ${cls}`);
  const conv = bs.conversions;

  // 1. primary stats
  const primary = {} as Record<PrimaryStat, Stat>;
  for (const s of PRIMARY_STATS) {
    const flat = makeStat([
      part(`Base (${input.classToken})`, "base", base[s]),
      part("Race", "race", race[s]),
      part("Bonus stats", "gear", bonus[s]),
      ...itemStat(input, STAT_ITEM_ID[s]),
      ...effectParts(effects, (e) => e.key === "stat" && (e.stat === s || e.stat === "all")),
    ]);
    const pcts = effects.filter((e) => e.key === "statPct" && (e.stat === s || e.stat === "all"));
    primary[s] = applyPct(flat, pcts);
  }
  const P = (s: PrimaryStat) => primary[s].value;
  const firstN = conv.statsWithoutBonus;
  const fromStat = (v: number, per: number) => (v <= firstN ? v : firstN + (v - firstN) * per);

  // 2. health and mana
  const health = applyPct(
    makeStat([
      part("Base health", "base", base.health),
      part(`Stamina ${r2(P("sta"))}`, "conversion", fromStat(P("sta"), conv.healthPerSta)),
      ...effectParts(effects, (e) => e.key === "health"),
    ]),
    effects.filter((e) => e.key === "healthPct"),
  );
  const mana =
    base.mana > 0
      ? applyPct(
          makeStat([
            part("Base mana", "base", base.mana),
            part(`Intellect ${r2(P("int"))}`, "conversion", fromStat(P("int"), conv.manaPerInt)),
            ...effectParts(effects, (e) => e.key === "mana"),
          ]),
          effects.filter((e) => e.key === "manaPct"),
        )
      : null;

  // 3. attack power
  const f = conv.meleeAttackPower[cls];
  const attackPower = applyPct(
    makeStat([
      part(
        `Level ${level} x ${f.perLevel} ${f.flat < 0 ? "-" : "+"} ${Math.abs(f.flat)}`,
        "base",
        f.perLevel * level + f.flat,
      ),
      part(`Strength x ${f.perStr}`, "conversion", P("str") * f.perStr),
      part(`Agility x ${f.perAgi}`, "conversion", P("agi") * f.perAgi),
      part("Bonus stats", "gear", bonus.attackPower),
      ...itemStat(input, ITEM_STAT.attackPower),
      ...effectParts(effects, (e) => e.key === "attackPower" || e.key === "meleeAttackPower"),
    ]),
    effects.filter((e) => e.key === "attackPowerPct"),
  );
  const rf = conv.rangedAttackPower[cls];
  const rangedAttackPower = rf
    ? applyPct(
        makeStat([
          part(
            `Level ${level} x ${rf.perLevel} ${rf.flat < 0 ? "-" : "+"} ${Math.abs(rf.flat)}`,
            "base",
            rf.perLevel * level + rf.flat,
          ),
          part(`Agility x ${rf.perAgi}`, "conversion", P("agi") * rf.perAgi),
          part("Bonus stats", "gear", bonus.attackPower + bonus.rangedAttackPower),
          ...itemStat(input, ITEM_STAT.attackPower),
          ...itemStat(input, ITEM_STAT.rangedAttackPower),
          ...effectParts(effects, (e) => e.key === "attackPower" || e.key === "rangedAttackPower"),
        ]),
        effects.filter((e) => e.key === "rangedAttackPowerPct"),
      )
    : null;

  // 4. spell power per school
  const spellPower = {} as Record<MagicSchool, Stat>;
  for (const sc of MAGIC_SCHOOLS) {
    spellPower[sc] = makeStat([
      part("Bonus stats", "gear", bonus.spellPower),
      part(`Bonus stats (${sc})`, "gear", bonus[SCHOOL_BONUS_KEY[sc]]),
      ...itemStat(input, ITEM_STAT.spellPower),
      ...itemStat(input, ITEM_STAT.spellDamage),
      ...effectParts(effects, (e) => e.key === "spellPower" && hasSchool(e, sc)),
      ...effects
        .filter(
          (e) =>
            e.key === "spellPowerFromStat" && hasSchool(e, sc) && e.stat !== undefined && e.stat !== "all",
        )
        .map((e) =>
          part(
            `${e.label} (${e.value}% of ${STAT_LABEL[e.stat as PrimaryStat]})`,
            e.kind,
            (P(e.stat as PrimaryStat) * e.value) / 100,
          ),
        ),
    ]);
  }

  // 5. crit and hit (character sheet; target effects are applied in evaluateTarget)
  const critRating = itemStat(input, ITEM_STAT.critRating).map((p) => ({
    ...p,
    label: `${p.label} (${p.value} crit rating)`,
    value: p.value / CRIT_RATING_PER_PCT,
  }));
  const hitRating = itemStat(input, ITEM_STAT.hitRating).map((p) => ({
    ...p,
    label: `${p.label} (${p.value} hit rating)`,
    value: p.value / HIT_RATING_PER_PCT,
  }));
  const agiPer = conv.agiPerMeleeCrit[cls];
  const weaponCrit = (slot: AttackSlot): Stat =>
    makeStat([
      part("Base", "base", base.baseMeleeCrit),
      part(`Agility ${r2(P("agi"))} / ${agiPer}`, "conversion", P("agi") / agiPer),
      part("Bonus stats", "gear", bonus.crit),
      ...critRating,
      ...effectParts(effects, (e) => e.key === "crit" || (e.key === "weaponCrit" && hasSlot(e, slot))),
    ]);
  const intPer = conv.intPerSpellCrit[cls];
  const spellCrit = makeStat([
    part("Base", "base", base.baseSpellCrit),
    part(`Intellect ${r2(P("int"))} / ${intPer ?? "-"}`, "conversion", intPer ? P("int") / intPer : 0),
    part("Bonus stats", "gear", bonus.spellCrit),
    ...critRating,
    ...effectParts(effects, (e) => e.key === "crit" || e.key === "spellCrit"),
  ]);
  const weaponHit = (slot: AttackSlot): Stat =>
    makeStat([
      part("Bonus stats", "gear", bonus.hit),
      ...hitRating,
      ...effectParts(effects, (e) => e.key === "hit" || (e.key === "weaponHit" && hasSlot(e, slot))),
    ]);
  const spellHit = makeStat([
    part("Bonus stats", "gear", bonus.spellHit),
    ...hitRating,
    ...effectParts(effects, (e) => e.key === "hit" || e.key === "spellHit"),
  ]);
  const off = input.weapons.offHand !== null;
  const rng = input.weapons.ranged !== null && input.weapons.ranged.subclass !== WAND_SUBCLASS; // wands use the spell table [VERIFY]

  // 6. haste: (1 + a)(1 + b)... - 1, recorded as increments
  const hasteRating = itemStat(input, ITEM_STAT.hasteRating).map((p) => ({
    ...p,
    value: p.value / HASTE_RATING_PER_PCT,
  }));
  const haste = (key: "meleeHaste" | "rangedHaste" | "spellHaste"): Stat => {
    const mods = [
      { label: "Bonus stats", kind: "gear" as const, value: bonus.haste },
      ...hasteRating,
      ...effects.filter((e) => e.key === "haste" || e.key === key),
    ].filter((m) => m.value !== 0);
    let mult = 1;
    const parts: Part[] = [part("Base", "base", 0)];
    for (const m of mods) {
      parts.push(part(m.label, m.kind, mult * m.value)); // increment in % points of the running total
      mult *= 1 + m.value / 100;
    }
    return { value: (mult - 1) * 100, parts };
  };
  const hasteStat = { melee: haste("meleeHaste"), ranged: haste("rangedHaste"), spell: haste("spellHaste") };

  // weapon skill
  const skill = (slot: AttackSlot): Stat =>
    makeStat([
      part(`Level ${level} x ${SKILL_PER_LEVEL}`, "base", level * SKILL_PER_LEVEL),
      part("Bonus stats", "gear", bonus.weaponSkill),
      ...effectParts(effects, (e) => e.key === "weaponSkill" && hasSlot(e, slot)),
    ]);

  // 7. weapon damage
  const ohPct = effects.filter((e) => e.key === "offhandDamagePct");
  const weaponDamage = (slot: AttackSlot): WeaponDamage | null => {
    const w = input.weapons[slot];
    if (!w) return null;
    const isWand = w.subclass === 19;
    const speed = w.speedMs / 1000;
    const h = slot === "ranged" ? hasteStat.ranged.value : hasteStat.melee.value;
    const hastedSpeed = speed / (1 + (isWand ? hasteStat.spell.value : h) / 100);
    const ap = slot === "ranged" ? (rangedAttackPower?.value ?? 0) : attackPower.value;
    const ammo = slot === "ranged" && !isWand && w.subclass !== 16 ? input.weapons.ammo : null;
    const perSwing = makeStat([
      part(`${w.name} ${w.min}-${w.max}`, "weapon", (w.min + w.max) / 2),
      ...effectParts(effects, (e) => e.key === "weaponDamage" && hasSlot(e, slot)),
      part(ammo ? `${ammo.name} ${ammo.dps} dps x ${speed}` : "Ammo", "gear", ammo ? ammo.dps * speed : 0),
      part(
        `Attack power ${r2(ap)} / ${AP_PER_DPS} x ${speed}`,
        "conversion",
        isWand ? 0 : (ap / AP_PER_DPS) * speed,
      ),
    ]);
    let dps = makeStat(perSwing.parts.map((p) => ({ ...p, value: p.value / hastedSpeed })));
    if (slot === "offHand") {
      dps = applyPct(
        {
          value: dps.value * OFFHAND_DAMAGE_MULT,
          parts: dps.parts.map((p) => ({ ...p, value: p.value * OFFHAND_DAMAGE_MULT })),
        },
        ohPct,
      );
    }
    return {
      slot,
      weaponId: w.id,
      name: w.name,
      min: w.min,
      max: w.max,
      speed,
      hastedSpeed,
      perSwing,
      dps,
      isWand,
    };
  };

  const spellPen = {} as Record<MagicSchool, Stat>;
  for (const sc of MAGIC_SCHOOLS)
    spellPen[sc] = makeStat([
      part("Base", "base", 0),
      ...effectParts(effects, (e) => e.key === "spellPen" && hasSchool(e, sc)),
    ]);

  return {
    classToken: input.classToken,
    level,
    primary,
    health,
    mana,
    attackPower,
    rangedAttackPower,
    spellPower,
    crit: {
      mainHand: weaponCrit("mainHand"),
      offHand: off ? weaponCrit("offHand") : null,
      ranged: rng ? weaponCrit("ranged") : null,
      spell: spellCrit,
    },
    hit: {
      mainHand: weaponHit("mainHand"),
      offHand: off ? weaponHit("offHand") : null,
      ranged: rng ? weaponHit("ranged") : null,
      spell: spellHit,
    },
    haste: hasteStat,
    weaponSkill: {
      mainHand: skill("mainHand"),
      offHand: off ? skill("offHand") : null,
      ranged: rng ? skill("ranged") : null,
    },
    expertise: makeStat([part("Base", "base", 0), ...effectParts(effects, (e) => e.key === "expertise")]),
    armorPenPct: makeStat([part("Base", "base", 0), ...effectParts(effects, (e) => e.key === "armorPenPct")]),
    spellPen,
    weapons: {
      mainHand: weaponDamage("mainHand"),
      offHand: weaponDamage("offHand"),
      ranged: weaponDamage("ranged"),
    },
    damageDone: effects.filter((e) => e.key === "damageDonePct"),
    hasSpellCrit: intPer !== undefined,
  };
}
```

`target.ts`:

```ts
import type { AttackSlot, MagicSchool, School, TargetPresetId, TargetsFile } from "@/data/types";
import {
  BASE_DODGE,
  BASE_GLANCE,
  BASE_MELEE_MISS,
  BOSS_CRIT_SUPPRESSION,
  BOSS_LEVEL_GAP,
  CRIT_PER_SKILL,
  DODGE_PER_SKILL,
  DUAL_WIELD_MISS,
  GLANCE_PER_SKILL,
  HIT_SUPPRESSION,
  HIT_SUPPRESSION_SKILL_GAP,
  MAX_GLANCE,
  MIN_SPELL_MISS,
  MISS_PER_SKILL_ABOVE,
  MISS_PER_SKILL_HIGH,
  MISS_PER_SKILL_LOW,
  SKILL_PER_LEVEL,
  baseSpellMiss,
} from "./constants";
import { makeStat, type Stat } from "./stat";
import {
  MAGIC_SCHOOLS,
  SCHOOL_BITS,
  type CharacterStats,
  type MeleeOutcome,
  type SourcedEffect,
  type SpellOutcome,
  type TargetInput,
  type TargetView,
} from "./types";

const ZERO_RESIST: Record<MagicSchool, number> = {
  holy: 0,
  fire: 0,
  nature: 0,
  frost: 0,
  shadow: 0,
  arcane: 0,
};

/** Preset target for player level L (targets.json byPlayerLevel); custom keeps the user's numbers. */
export function presetTarget(
  file: TargetsFile,
  presetId: TargetPresetId,
  playerLevel: number,
  debuffs: readonly SourcedEffect[],
  custom?: { level: number; armor: number; resist: Record<MagicSchool, number> },
): TargetInput {
  if (presetId === "custom" && custom)
    return { presetId, level: custom.level, armor: custom.armor, resist: custom.resist, debuffs };
  const row = file.byPlayerLevel[String(playerLevel)]?.find((r) => r.preset === presetId);
  if (!row) throw new Error(`no ${presetId} target for level ${playerLevel}`);
  return { presetId, level: row.level, armor: row.armor, resist: { ...ZERO_RESIST }, debuffs };
}

/** Base miss chance in % for a skill vs defense difference (white single-wield and special attacks). */
export function baseMeleeMiss(defenseMinusSkill: number): number {
  const d = defenseMinusSkill;
  if (d < 0) return Math.max(0, BASE_MELEE_MISS + d * MISS_PER_SKILL_ABOVE);
  return BASE_MELEE_MISS + d * (d > HIT_SUPPRESSION_SKILL_GAP ? MISS_PER_SKILL_HIGH : MISS_PER_SKILL_LOW);
}

function meleeOutcome(
  stats: CharacterStats,
  slot: AttackSlot,
  t: TargetInput,
  dualWield: boolean,
): MeleeOutcome | null {
  const skillStat = stats.weaponSkill[slot];
  const critStat = stats.crit[slot];
  const hitStat = stats.hit[slot];
  if (!skillStat || !critStat || !hitStat) return null;
  const skill = skillStat.value;
  const defense = t.level * SKILL_PER_LEVEL;
  const diff = defense - skill;
  const ranged = slot === "ranged";
  const suppressed = diff > HIT_SUPPRESSION_SKILL_GAP;
  const effHit = Math.max(0, hitStat.value - (suppressed ? HIT_SUPPRESSION : 0));
  const base = baseMeleeMiss(diff);
  const miss = makeStat([
    { label: `Base vs level ${t.level} (skill ${skill} vs defense ${defense})`, kind: "rule", value: base },
    {
      label: suppressed
        ? `Hit ${hitStat.value}% (first ${HIT_SUPPRESSION}% ignored)`
        : `Hit ${hitStat.value}%`,
      kind: "gear",
      value: -Math.min(base, effHit),
    },
  ]);
  const dwPenalty = dualWield && !ranged ? DUAL_WIELD_MISS : 0;
  const whiteMiss = makeStat([
    { label: `Base vs level ${t.level}`, kind: "rule", value: base },
    { label: "Dual wield", kind: "rule", value: dwPenalty },
    { label: `Hit ${hitStat.value}%`, kind: "gear", value: -Math.min(base + dwPenalty, effHit) },
  ]);
  const dodge = makeStat([
    {
      label: `Base vs level ${t.level}`,
      kind: "rule",
      value: Math.max(0, BASE_DODGE + diff * DODGE_PER_SKILL),
    },
    {
      label: "Expertise",
      kind: "talent",
      value: -Math.min(Math.max(0, BASE_DODGE + diff * DODGE_PER_SKILL), stats.expertise.value),
    },
  ]);
  const levelGap = t.level - stats.level;
  const crit = makeStat([
    ...critStat.parts,
    {
      label: `Weapon skill ${skill} vs defense ${defense}`,
      kind: "rule",
      value: (skill - defense) * CRIT_PER_SKILL,
    },
    {
      label: `Crit suppression vs level ${t.level}`,
      kind: "rule",
      value: levelGap >= BOSS_LEVEL_GAP ? -BOSS_CRIT_SUPPRESSION : 0,
    },
  ]);
  const cappedSkill = Math.min(skill, stats.level * SKILL_PER_LEVEL);
  const glancing =
    ranged || t.level < stats.level
      ? 0
      : Math.min(MAX_GLANCE, Math.max(0, BASE_GLANCE + (defense - cappedSkill) * GLANCE_PER_SKILL));
  const parry = 0;
  const block = 0;
  const whiteCritCap = Math.max(0, 100 - whiteMiss.value - dodge.value - parry - block - glancing);
  return {
    miss,
    dodge,
    parry,
    block,
    crit: { value: Math.max(0, crit.value), parts: crit.parts },
    whiteMiss,
    glancing,
    whiteCrit: Math.min(Math.max(0, crit.value), whiteCritCap),
    whiteCritCap,
    hitCap: base + (suppressed ? HIT_SUPPRESSION : 0),
    whiteHitCap: base + dwPenalty + (suppressed ? HIT_SUPPRESSION : 0),
  };
}

function spellOutcome(stats: CharacterStats, t: TargetInput): SpellOutcome {
  const base = baseSpellMiss(t.level - stats.level);
  const hit = stats.hit.spell.value;
  const miss = makeStat([
    { label: `Base vs level ${t.level}`, kind: "rule", value: base },
    { label: `Spell hit ${hit}%`, kind: "gear", value: -Math.min(hit, base - MIN_SPELL_MISS) },
  ]);
  return { miss, crit: stats.crit.spell, hitCap: base - MIN_SPELL_MISS };
}

const hasSchool = (e: SourcedEffect, s: School) => !e.schools || e.schools.includes(s);

/** Everything that depends on the target: armor after debuffs, armor reduction, resistances, outcome tables. */
export function evaluateTarget(
  stats: CharacterStats,
  t: TargetInput,
  armorFormula: TargetsFile["armorFormula"],
  dualWield: boolean,
): TargetView {
  const debuffArmor = t.debuffs.filter((e) => e.key === "targetArmor");
  const armorAfterDebuffs = Math.max(0, t.armor + debuffArmor.reduce((a, e) => a + e.value, 0));
  const pen = Math.min(100, stats.armorPenPct.value);
  const armor = makeStat([
    { label: `Level ${t.level} armor`, kind: "base", value: t.armor },
    ...debuffArmor.map((e) => ({ label: e.label, kind: e.kind, value: e.value })),
    {
      label: "Armor cannot go below 0",
      kind: "rule" as const,
      value: armorAfterDebuffs - (t.armor + debuffArmor.reduce((a, e) => a + e.value, 0)),
    },
    { label: `Armor penetration ${pen}%`, kind: "talent" as const, value: (-armorAfterDebuffs * pen) / 100 },
  ]);
  const k = armorFormula.base + armorFormula.perLevel * stats.level;
  const dr = Math.min(armorFormula.cap, armor.value / (armor.value + k)) * 100;
  const armorReduction: Stat = {
    value: dr,
    parts: [
      {
        label: `${Math.round(armor.value)} / (${Math.round(armor.value)} + ${armorFormula.base} + ${armorFormula.perLevel} x ${stats.level})`,
        kind: "rule",
        value: dr,
      },
    ],
  };
  const resist = {} as Record<MagicSchool, Stat>;
  for (const sc of MAGIC_SCHOOLS) {
    const parts = [
      { label: "Target", kind: "base" as const, value: t.resist[sc] },
      ...t.debuffs
        .filter((e) => e.key === "targetResist" && hasSchool(e, sc))
        .map((e) => ({ label: e.label, kind: e.kind, value: e.value })),
      ...stats.spellPen[sc].parts.filter((p) => p.value !== 0).map((p) => ({ ...p, value: -p.value })),
    ];
    const raw = parts.reduce((a, p) => a + p.value, 0);
    resist[sc] = makeStat([
      ...parts,
      { label: "Resistance cannot go below 0", kind: "rule", value: Math.max(0, raw) - raw },
    ]);
  }
  const damageTakenPct = {} as Record<School, number>;
  for (const sc of SCHOOL_BITS)
    damageTakenPct[sc] = t.debuffs
      .filter((e) => e.key === "targetDamageTakenPct" && hasSchool(e, sc))
      .reduce((a, e) => a + e.value, 0);
  return {
    presetId: t.presetId,
    level: t.level,
    armor,
    armorReduction,
    resist,
    damageTakenPct,
    mainHand: meleeOutcome(stats, "mainHand", t, dualWield),
    offHand: meleeOutcome(stats, "offHand", t, dualWield),
    ranged: meleeOutcome(stats, "ranged", t, false),
    spell: spellOutcome(stats, t),
  };
}
```

`assemble.ts`:

```ts
import type { BaseStatsFile, BuffsFile, ClassToken, ManualEffect, RacialsFile } from "@/data/types";
import type { SourceKind } from "./stat";
import { mapTalents, type RankedTalent, type TalentMapping } from "./talentEffects";
import type { BonusStats, CharacterInput, EquippedWeapons, SourcedEffect } from "./types";

export interface AssembleArgs {
  classToken: ClassToken;
  race: string; // uppercase
  level: number;
  baseStats: BaseStatsFile;
  racials: RacialsFile;
  buffs: BuffsFile;
  buffIds: readonly string[]; // selected buffs and debuffs
  talents: readonly RankedTalent[];
  weapons: EquippedWeapons;
  bonus: BonusStats;
}
export interface Assembled {
  input: CharacterInput;
  debuffs: SourcedEffect[];
  mapping: TalentMapping;
}

function strip(e: ManualEffect, label: string, kind: SourceKind): SourcedEffect {
  const out: SourcedEffect = { ...e, label, kind };
  delete (out as ManualEffect).src;
  return out;
}

/** Collects racial, buff, debuff and talent effects into a CharacterInput (pure). */
export function assemble(a: AssembleArgs): Assembled {
  const cls = a.classToken.toUpperCase();
  const effects: SourcedEffect[] = [];
  for (const r of a.racials.racials) {
    if (r.race !== a.race || r.kind !== "passive" || (r.classes && !r.classes.includes(cls as never)))
      continue;
    for (const e of r.effects) effects.push(strip(e, `${r.name} (racial)`, "racial"));
  }
  const debuffs: SourcedEffect[] = [];
  const selected = new Set(a.buffIds);
  for (const b of a.buffs.buffs) {
    if (!selected.has(b.id)) continue;
    for (const e of b.effects) {
      if (b.category === "debuff") debuffs.push(strip(e, b.name, "debuff"));
      else effects.push(strip(e, b.name, "buff"));
    }
  }
  const mapping = mapTalents(a.talents, a.weapons);
  effects.push(...mapping.applied, ...mapping.damageDone);
  return {
    input: {
      classToken: a.classToken,
      race: a.race,
      level: a.level,
      baseStats: a.baseStats,
      weapons: a.weapons,
      bonus: a.bonus,
      effects,
    },
    debuffs,
    mapping,
  };
}

export const EMPTY_BONUS: BonusStats = {
  str: 0,
  agi: 0,
  sta: 0,
  int: 0,
  spi: 0,
  attackPower: 0,
  rangedAttackPower: 0,
  spellPower: 0,
  holySpellPower: 0,
  fireSpellPower: 0,
  natureSpellPower: 0,
  frostSpellPower: 0,
  shadowSpellPower: 0,
  arcaneSpellPower: 0,
  hit: 0,
  spellHit: 0,
  crit: 0,
  spellCrit: 0,
  haste: 0,
  weaponSkill: 0,
};
```

`weapons.ts`:

```ts
import type { Ammo, ClassInfo, Weapon, WeaponSlotKind } from "@/data/types";

export type PickerSlot = "mainHand" | "offHand" | "ranged";
const SLOT_KINDS: Record<PickerSlot, readonly WeaponSlotKind[]> = {
  mainHand: ["mainHand", "oneHand", "twoHand"],
  offHand: ["offHand", "oneHand"],
  ranged: ["ranged", "thrown", "wand"],
};
export const AMMO_FOR_SUBCLASS: Readonly<Record<number, number>> = { 2: 2, 18: 2, 3: 3 }; // bow/crossbow: arrows, gun: bullets

/** ItemSparse.AllowableClass: -1/0 = any class, otherwise bit (classId - 1). */
export function classAllowed(w: Weapon, cls: ClassInfo): boolean {
  return w.allowableClass === -1 || w.allowableClass === 0 || (w.allowableClass & (1 << (cls.id - 1))) !== 0;
}

export function canUse(w: Weapon, cls: ClassInfo, level: number): boolean {
  return cls.weaponSubclasses.includes(w.subclass) && classAllowed(w, cls) && w.requiredLevel <= level;
}

/** Weapons the class can put in a picker slot. The off hand needs dual wield and a one-handed main hand. */
export function weaponsForSlot(
  all: readonly Weapon[],
  cls: ClassInfo,
  level: number,
  slot: PickerSlot,
  mainHand: Weapon | null,
): Weapon[] {
  if (slot === "offHand" && (!cls.dualWield || mainHand?.slot === "twoHand")) return [];
  return all.filter((w) => SLOT_KINDS[slot].includes(w.slot) && canUse(w, cls, level));
}

export function ammoFor(all: readonly Ammo[], ranged: Weapon | null, level: number): Ammo[] {
  const sub = ranged ? AMMO_FOR_SUBCLASS[ranged.subclass] : undefined;
  if (sub === undefined) return [];
  return all.filter(
    (a) => a.subclass === sub && a.requiredLevel <= level && !/deprecated|depricated/i.test(a.name),
  );
}

/** Case-insensitive substring search, best item level first, then name; at most `limit` results. */
export function searchWeapons(list: readonly Weapon[], query: string, limit = 50): Weapon[] {
  const q = query.trim().toLowerCase();
  return list
    .filter((w) => q === "" || w.name.toLowerCase().includes(q))
    .sort((a, b) => b.itemLevel - a.itemLevel || a.name.localeCompare(b.name) || a.id - b.id)
    .slice(0, limit);
}
```

`index.ts`:

```ts
export * from "./constants";
export * from "./stat";
export * from "./types";
export * from "./equip";
export * from "./talentEffects";
export * from "./character";
export * from "./target";
export * from "./assemble";
export * from "./weapons";
```

### 5.6 Phase 4 hooks (do not implement now)

- `TargetView.dps?: number` — Phase 4 fills it per reference row; the UI column appears when any row has it.
- `TalentMapping.spellMods` (op, value, pct, family mask) and `CharacterStats.damageDone` (aura 79 by school) are the inputs of the
  per-ability evaluator. `TargetView.damageTakenPct` and `resist` feed spell damage.
- `MeleeOutcome` (special and white) is the attack table the damage engine consumes; glancing damage penalty is Phase 4.
- New handlers for `special` notes go to `src/engine/talents/special/` (ARCHITECTURE).

---

## 6. URL format v2 (`src/state/charCode.ts`, `buildCode.ts`, task T6)

### 6.1 Format

```
#v1.<classToken>.<level>.<talentedRank>[.<talentPayload>]                       character = defaults (unchanged Phase 2 form)
#v2.<classToken>.<level>.<talentedRank>.<talentPayload>.<charPayload>           exactly 6 parts; talentPayload may be ""
```

The encoder writes v1 whenever the character payload is empty (all defaults), so every Phase 2 link, golden vector and talent-only
URL is byte-identical. The decoder accepts both. `charPayload` = unpadded base64url (same alphabet as v1) of records
`tag (varint) · length (varint) · body (length bytes)`, tags strictly ascending, records equal to the default omitted, empty
records forbidden, unknown tags skipped:

| Tag | Body (LEB128 varints) | Default (omitted) |
|---|---|---|
| 1 race | `raceId` (ChrRaces id, `classes.json` races) | the class's first `raceIds` entry |
| 2 weapons | `mainHandId offHandId rangedId ammoId` (item ids, 0 = empty) | all 0 |
| 3 bonus | pairs `index, zigzag(round(value × scale))` for non-zero fields; index = position in `BONUS_KEYS`; scale 100 for `hit, spellHit, crit, spellCrit, haste`, else 1 | all 0 |
| 4 buffs | ascending `code`s from `buffs.json` (player buffs and target debuffs) | none |
| 5 target | `presetIndex` (`boss, elite, same, lowArmorBoss, custom`); for custom also `level armor holy fire nature frost shadow arcane` | boss |

`BONUS_KEYS`, `TARGET_PRESETS` and buff `code`s are append-only. Decoding never validates against data: the store sanitizes
(unknown race/weapon/buff → dropped with a notice).

### 6.2 `src/state/charCode.ts` (exact)

```ts
import type { TargetPresetId } from "@/data/types";

/** Bonus-stat fields in URL order. APPEND ONLY: the index is part of the URL format. */
export const BONUS_KEYS = [
  "str",
  "agi",
  "sta",
  "int",
  "spi",
  "attackPower",
  "rangedAttackPower",
  "spellPower",
  "holySpellPower",
  "fireSpellPower",
  "natureSpellPower",
  "frostSpellPower",
  "shadowSpellPower",
  "arcaneSpellPower",
  "hit",
  "spellHit",
  "crit",
  "spellCrit",
  "haste",
  "weaponSkill",
] as const;
export type BonusKey = (typeof BONUS_KEYS)[number];
/** Percent fields keep two decimals in the URL (value x 100). */
export const BONUS_SCALE: Partial<Record<BonusKey, number>> = {
  hit: 100,
  spellHit: 100,
  crit: 100,
  spellCrit: 100,
  haste: 100,
};
/** APPEND ONLY. */
export const TARGET_PRESETS: readonly TargetPresetId[] = ["boss", "elite", "same", "lowArmorBoss", "custom"];

export interface CustomTarget {
  level: number;
  armor: number;
  resist: [number, number, number, number, number, number]; // holy, fire, nature, frost, shadow, arcane
}
export interface CharacterCode {
  raceId: number | null; // null = the class's default race
  weapons: { mainHand: number; offHand: number; ranged: number; ammo: number }; // item ids, 0 = empty
  bonus: Partial<Record<BonusKey, number>>; // display units (percent points for % fields); zeros omitted
  buffCodes: number[]; // buffs.json codes, ascending
  target: { preset: TargetPresetId; custom?: CustomTarget }; // custom only with preset "custom"
}

export const TAG = { race: 1, weapons: 2, bonus: 3, buffs: 4, target: 5 } as const;

export const DEFAULT_CHARACTER: CharacterCode = {
  raceId: null,
  weapons: { mainHand: 0, offHand: 0, ranged: 0, ammo: 0 },
  bonus: {},
  buffCodes: [],
  target: { preset: "boss" },
};

export function writeVarint(out: number[], value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`varint out of range: ${value}`);
  let v = value;
  while (v >= 0x80) {
    out.push(v % 0x80 | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}
const zigzag = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzigzag = (n: number) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

/** Reads varints from bytes[start, end); null on a truncated or oversized varint. */
function readVarints(bytes: Uint8Array, start: number, end: number): number[] | null {
  const out: number[] = [];
  let i = start;
  while (i < end) {
    let value = 0;
    let mul = 1;
    for (;;) {
      if (i >= end) return null;
      const b = bytes[i++]!;
      value += (b & 0x7f) * mul;
      if (!(b & 0x80)) break;
      mul *= 0x80;
      if (mul > 2 ** 35) return null;
    }
    out.push(value);
  }
  return out;
}

export function isDefaultCharacter(c: CharacterCode): boolean {
  return encodeCharacterBytes(c).length === 0;
}

/** TLV records (tag varint, length varint, body) in ascending tag order; records equal to the default are omitted. */
export function encodeCharacterBytes(c: CharacterCode): number[] {
  const out: number[] = [];
  const record = (tag: number, body: number[]) => {
    if (!body.length) return;
    writeVarint(out, tag);
    writeVarint(out, body.length);
    out.push(...body);
  };
  const race: number[] = [];
  if (c.raceId !== null) writeVarint(race, c.raceId);
  record(TAG.race, race);
  const w = c.weapons;
  const weapons: number[] = [];
  if (w.mainHand || w.offHand || w.ranged || w.ammo)
    for (const id of [w.mainHand, w.offHand, w.ranged, w.ammo]) writeVarint(weapons, id);
  record(TAG.weapons, weapons);
  const bonus: number[] = [];
  BONUS_KEYS.forEach((k, i) => {
    const v = Math.round((c.bonus[k] ?? 0) * (BONUS_SCALE[k] ?? 1));
    if (v === 0) return;
    writeVarint(bonus, i);
    writeVarint(bonus, zigzag(v));
  });
  record(TAG.bonus, bonus);
  const buffs: number[] = [];
  for (const code of [...new Set(c.buffCodes)].sort((a, b) => a - b)) writeVarint(buffs, code);
  record(TAG.buffs, buffs);
  const target: number[] = [];
  if (c.target.preset !== "boss") {
    writeVarint(target, TARGET_PRESETS.indexOf(c.target.preset));
    if (c.target.preset === "custom" && c.target.custom) {
      const t = c.target.custom;
      for (const v of [t.level, t.armor, ...t.resist]) writeVarint(target, v);
    }
  }
  record(TAG.target, target);
  return out;
}

/** null when the payload is malformed. Unknown tags are skipped (forward compatibility). */
export function decodeCharacterBytes(bytes: Uint8Array): CharacterCode | null {
  const c: CharacterCode = structuredClone(DEFAULT_CHARACTER);
  let i = 0;
  let lastTag = 0;
  while (i < bytes.length) {
    const head = readVarintAt(bytes, i);
    if (!head) return null;
    const len = readVarintAt(bytes, head.next);
    if (!len) return null;
    const tag = head.value;
    const start = len.next;
    const end = start + len.value;
    if (tag <= lastTag || end > bytes.length || len.value === 0) return null;
    lastTag = tag;
    i = end;
    const v = readVarints(bytes, start, end);
    if (!v) return null;
    switch (tag) {
      case TAG.race:
        if (v.length !== 1) return null;
        c.raceId = v[0]!;
        break;
      case TAG.weapons:
        if (v.length !== 4) return null;
        c.weapons = { mainHand: v[0]!, offHand: v[1]!, ranged: v[2]!, ammo: v[3]! };
        break;
      case TAG.bonus:
        if (v.length % 2) return null;
        for (let j = 0; j < v.length; j += 2) {
          const key = BONUS_KEYS[v[j]!];
          if (key) c.bonus[key] = unzigzag(v[j + 1]!) / (BONUS_SCALE[key] ?? 1);
        }
        break;
      case TAG.buffs:
        c.buffCodes = [...new Set(v)].sort((a, b) => a - b);
        break;
      case TAG.target: {
        const preset = TARGET_PRESETS[v[0]!];
        if (!preset) return null;
        if (preset === "custom") {
          if (v.length !== 9) return null;
          c.target = {
            preset,
            custom: { level: v[1]!, armor: v[2]!, resist: v.slice(3, 9) as CustomTarget["resist"] },
          };
        } else {
          if (v.length !== 1) return null;
          c.target = { preset };
        }
        break;
      }
      default:
        break; // unknown tag from a newer version: ignore
    }
  }
  return c;
}

function readVarintAt(bytes: Uint8Array, start: number): { value: number; next: number } | null {
  let value = 0;
  let mul = 1;
  let i = start;
  for (;;) {
    if (i >= bytes.length) return null;
    const b = bytes[i++]!;
    value += (b & 0x7f) * mul;
    if (!(b & 0x80)) return { value, next: i };
    mul *= 0x80;
    if (mul > 2 ** 35) return null;
  }
}
```

### 6.3 `src/state/buildCode.ts` changes (exact diff)

```diff
diff --git a/src/state/buildCode.ts b/src/state/buildCode.ts
--- a/src/state/buildCode.ts
+++ b/src/state/buildCode.ts
@@ -1,4 +1,10 @@
 import type { ClassToken } from "@/data/types";
+import {
+  DEFAULT_CHARACTER,
+  decodeCharacterBytes,
+  encodeCharacterBytes,
+  type CharacterCode,
+} from "./charCode";
 
 const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
 const RANK_BITS = 3;
@@ -9,10 +15,11 @@ export interface BuildCode {
   level: number;
   talentedRank: number;
   ranks: Record<number, number>;
+  character: CharacterCode; // DEFAULT_CHARACTER for v1 links
 }
 export type DecodeResult =
   | { ok: true; build: BuildCode }
-  | { ok: false; reason: "empty" | "version" | "class" | "level" | "perk" | "payload" };
+  | { ok: false; reason: "empty" | "version" | "class" | "level" | "perk" | "payload" | "character" };
 
 export function bytesToBase64Url(bytes: Uint8Array): string {
   let out = "";
@@ -56,7 +63,7 @@ function writeVarint(out: number[], value: number): void {
   out.push(v);
 }
 
-export function encodeBuild(b: BuildCode): string {
+export function encodeBuild(b: Omit<BuildCode, "character"> & { character?: CharacterCode }): string {
   const ids = Object.keys(b.ranks)
     .map(Number)
     .filter((id) => (b.ranks[id] ?? 0) > 0)
@@ -70,8 +77,14 @@ export function encodeBuild(b: BuildCode): string {
     writeVarint(bytes, (id - prev) * (RANK_MAX + 1) + rank);
     prev = id;
   }
-  const head = `#v1.${b.classToken}.${b.level}.${b.talentedRank}`;
-  return bytes.length ? `${head}.${bytesToBase64Url(Uint8Array.from(bytes))}` : head;
+  const talents = bytesToBase64Url(Uint8Array.from(bytes));
+  const char = encodeCharacterBytes(b.character ?? DEFAULT_CHARACTER);
+  if (char.length === 0) {
+    // Talent-only builds keep the exact Phase 2 (v1) form.
+    const head = `#v1.${b.classToken}.${b.level}.${b.talentedRank}`;
+    return bytes.length ? `${head}.${talents}` : head;
+  }
+  return `#v2.${b.classToken}.${b.level}.${b.talentedRank}.${talents}.${bytesToBase64Url(Uint8Array.from(char))}`;
 }
 
 function decodePayload(payload: string): Record<number, number> | null {
@@ -104,8 +117,9 @@ export function decodeBuild(hash: string, isClassToken: (s: string) => s is Clas
   const h = hash.startsWith("#") ? hash.slice(1) : hash;
   if (h === "") return { ok: false, reason: "empty" };
   const parts = h.split(".");
-  if (parts[0] !== "v1") return { ok: false, reason: "version" };
-  if (parts.length < 4 || parts.length > 5) return { ok: false, reason: "payload" };
+  const v2 = parts[0] === "v2";
+  if (parts[0] !== "v1" && !v2) return { ok: false, reason: "version" };
+  if (v2 ? parts.length !== 6 : parts.length < 4 || parts.length > 5) return { ok: false, reason: "payload" };
   const token = parts[1]!;
   if (!isClassToken(token)) return { ok: false, reason: "class" };
   if (!/^\d{1,2}$/.test(parts[2]!)) return { ok: false, reason: "level" };
@@ -119,5 +133,12 @@ export function decodeBuild(hash: string, isClassToken: (s: string) => s is Clas
     if (!r) return { ok: false, reason: "payload" };
     ranks = r;
   }
-  return { ok: true, build: { classToken: token, level, talentedRank: Number(parts[3]), ranks } };
+  let character = structuredClone(DEFAULT_CHARACTER);
+  if (v2 && parts[5]) {
+    const bytes = base64UrlToBytes(parts[5]);
+    const c = bytes && decodeCharacterBytes(bytes);
+    if (!c) return { ok: false, reason: "character" };
+    character = c;
+  }
+  return { ok: true, build: { classToken: token, level, talentedRank: Number(parts[3]), ranks, character } };
 }
```

Existing tests change minimally: `buildCode.test.ts` "decodes the golden vector" expects `character: DEFAULT_CHARACTER`; the
"reports errors" case `#v2.mage.60.0` becomes `#v3.mage.60.0` (version) and `#v2.mage.60.0` is now `payload`; `store.test.ts`
passes `character: DEFAULT_CHARACTER` to `applyBuildCode`:

```diff
diff --git a/src/state/buildCode.test.ts b/src/state/buildCode.test.ts
--- a/src/state/buildCode.test.ts
+++ b/src/state/buildCode.test.ts
@@ -3,6 +3,7 @@ import { isClassToken } from "@/data";
 import { addPoint } from "@/engine/talents";
 import { MAGE_51, ctx60, treeFor } from "@/testkit/talents";
 import type { ClassToken } from "@/data/types";
+import { DEFAULT_CHARACTER } from "./charCode";
 import { base64UrlToBytes, bytesToBase64Url, decodeBuild, encodeBuild } from "./buildCode";
 
 const GOLDEN = "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N";
@@ -21,7 +22,7 @@ describe("buildCode", () => {
     const r = dec(GOLDEN);
     expect(r).toEqual({
       ok: true,
-      build: { classToken: "mage", level: 60, talentedRank: 0, ranks: MAGE_51 },
+      build: { classToken: "mage", level: 60, talentedRank: 0, ranks: MAGE_51, character: DEFAULT_CHARACTER },
     });
   });
 
@@ -44,7 +45,8 @@ describe("buildCode", () => {
   it("reports errors", () => {
     expect(reason("")).toBe("empty");
     expect(reason("#")).toBe("empty");
-    expect(reason("#v2.mage.60.0")).toBe("version");
+    expect(reason("#v3.mage.60.0")).toBe("version");
+    expect(reason("#v2.mage.60.0")).toBe("payload");
     expect(reason("#v1.foo.60.0")).toBe("class");
     expect(reason("#v1.mage.0.0")).toBe("level");
     expect(reason("#v1.mage.61.0")).toBe("level");
diff --git a/src/state/store.test.ts b/src/state/store.test.ts
--- a/src/state/store.test.ts
+++ b/src/state/store.test.ts
@@ -2,6 +2,7 @@ import { beforeEach, describe, expect, it } from "vitest";
 import { isClassToken } from "@/data";
 import { pointsBySpec } from "@/engine/talents";
 import { decodeBuild } from "./buildCode";
+import { DEFAULT_CHARACTER } from "./charCode";
 import { useCalc } from "./store";
 
 const GOLDEN = "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N";
@@ -29,9 +30,13 @@ describe("store", () => {
   });
 
   it("sets a notice when a build had invalid talents", async () => {
-    await useCalc
-      .getState()
-      .applyBuildCode({ classToken: "mage", level: 60, talentedRank: 0, ranks: { 105786: 1 } });
+    await useCalc.getState().applyBuildCode({
+      classToken: "mage",
+      level: 60,
+      talentedRank: 0,
+      ranks: { 105786: 1 },
+      character: DEFAULT_CHARACTER,
+    });
     const s = useCalc.getState();
     expect(s.ranks).toEqual({});
     expect(s.notice).toContain("were not valid and were removed");
```

### 6.4 Golden vectors (`src/state/charCode.test.ts`, exact; verified with an independent Python encoder)

```ts
import { describe, expect, it } from "vitest";
import { isClassToken } from "@/data";
import { MAGE_51 } from "@/testkit/talents";
import { decodeBuild, encodeBuild, base64UrlToBytes, bytesToBase64Url } from "./buildCode";
import {
  DEFAULT_CHARACTER,
  decodeCharacterBytes,
  encodeCharacterBytes,
  type CharacterCode,
} from "./charCode";

const dec = (s: string) => decodeBuild(s, isClassToken);
const WARRIOR_B: CharacterCode = {
  raceId: null,
  weapons: { mainHand: 12784, offHand: 0, ranged: 0, ammo: 0 },
  bonus: { str: 100, hit: 5, crit: 3 },
  buffCodes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 60, 62, 63],
  target: { preset: "boss" },
};
const ROGUE_D: CharacterCode = {
  raceId: 2,
  weapons: { mainHand: 18832, offHand: 19352, ranged: 0, ammo: 0 },
  bonus: { agi: -5, haste: 1.25 },
  buffCodes: [],
  target: { preset: "custom", custom: { level: 62, armor: 3000, resist: [0, 10, 0, 0, 0, 0] } },
};

describe("character payload", () => {
  it("golden vectors (verified with an independent Python encoder)", () => {
    const g2 = "#v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8";
    const g3 = "#v2.rogue.60.0..AQECAgiQkwGYlwEAAAMFAQkS-gEFCgQ-uBcACgAAAAA";
    const g4 = "#v2.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N.BQEB";
    const b2 = {
      classToken: "warrior" as const,
      level: 60,
      talentedRank: 0,
      ranks: { 105939: 5 },
      character: WARRIOR_B,
    };
    const b3 = { classToken: "rogue" as const, level: 60, talentedRank: 0, ranks: {}, character: ROGUE_D };
    const elite: CharacterCode = { ...DEFAULT_CHARACTER, target: { preset: "elite" } };
    const b4 = { classToken: "mage" as const, level: 60, talentedRank: 0, ranks: MAGE_51, character: elite };
    expect(encodeBuild(b2)).toBe(g2);
    expect(encodeBuild(b3)).toBe(g3);
    expect(encodeBuild(b4)).toBe(g4);
    expect(dec(g2)).toEqual({ ok: true, build: b2 });
    expect(dec(g3)).toEqual({ ok: true, build: b3 });
    expect(dec(g4)).toEqual({ ok: true, build: b4 });
    expect(encodeCharacterBytes(WARRIOR_B)).toEqual([
      2, 5, 240, 99, 0, 0, 0, 3, 9, 0, 200, 1, 14, 232, 7, 16, 216, 4, 4, 15, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      11, 12, 60, 62, 63,
    ]);
  });
  it("round-trips", () => {
    for (const c of [WARRIOR_B, ROGUE_D])
      expect(decodeCharacterBytes(Uint8Array.from(encodeCharacterBytes(c)))).toEqual(c);
  });
  it("v1 still decodes; default character keeps v1", () => {
    const g = "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N";
    const r = dec(g);
    expect(r.ok && r.build.character).toEqual(DEFAULT_CHARACTER);
    expect(
      encodeBuild({
        classToken: "mage",
        level: 60,
        talentedRank: 0,
        ranks: MAGE_51,
        character: DEFAULT_CHARACTER,
      }),
    ).toBe(g);
  });
  it("skips unknown tags, rejects bad ones", () => {
    const known = encodeCharacterBytes(WARRIOR_B);
    const withUnknown = Uint8Array.from([...known, 9, 2, 1, 2]);
    expect(decodeCharacterBytes(withUnknown)).toEqual(WARRIOR_B);
    expect(decodeCharacterBytes(Uint8Array.from([2, 1, 5]))).toBeNull(); // weapons need 4 varints
    expect(decodeCharacterBytes(Uint8Array.from([4, 1, 1, 1, 1, 2]))).toBeNull(); // tag order
    expect(decodeCharacterBytes(Uint8Array.from([1, 5, 2]))).toBeNull(); // truncated
    expect(dec("#v2.mage.60.0..***").ok).toBe(false);
    expect(bytesToBase64Url(base64UrlToBytes("AQEC")!)).toBe("AQEC");
  });
});
```

| Vector | Meaning |
|---|---|
| `#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N` | Phase 2 golden (Mage Fire 33 / Frost 18), default character: still v1 |
| `#v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8` | Human Warrior, Cruelty 5/5, Arcanite Reaper, bonus Str 100 / hit 5% / crit 3%, raid buffs + Sunder, Faerie Fire, CoR, boss |
| `#v2.rogue.60.0..AQECAgiQkwGYlwEAAAMFAQkS-gEFCgQ-uBcACgAAAAA` | Orc Rogue, no talents, Brutality Blade + Chromatically Tempered Sword, Agi −5, haste 1.25%, custom target 62 / 3000 armor / 10 fire resist |
| `#v2.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N.BQEB` | Phase 2 golden build vs Elite |

---

## 7. State (`src/state`, task T7)

### 7.1 Character store `src/state/character.ts` (exact)

A second Zustand store; `useCalc` stays the talent store. Race 0 means "no class yet". Buff ids are kept in `buffs.json`
order. `fitToClass` keeps a valid race (else the class default) and drops weapons the class cannot use; `applyCode` sanitizes a
decoded payload and returns `false` if anything was dropped. `weapons.json` is awaited only when weapon ids must be validated.

```ts
import { create } from "zustand";
import { buffsFile, getClassInfo, loadWeapons } from "@/data";
import type { ClassToken, MagicSchool, TargetPresetId, WeaponsFile } from "@/data/types";
import { EMPTY_BONUS, ammoFor, weaponsForSlot, type BonusStats } from "@/engine/stats";
import { BONUS_SCALE, type CharacterCode, type CustomTarget } from "./charCode";

export type WeaponSlotKey = "mainHand" | "offHand" | "ranged" | "ammo";
export interface WeaponIds {
  mainHand: number;
  offHand: number;
  ranged: number;
  ammo: number;
}
export const NO_WEAPON_IDS: WeaponIds = { mainHand: 0, offHand: 0, ranged: 0, ammo: 0 };
export const DEFAULT_CUSTOM: CustomTarget = { level: 63, armor: 3731, resist: [0, 0, 0, 0, 0, 0] };
export const RESIST_ORDER: readonly MagicSchool[] = ["holy", "fire", "nature", "frost", "shadow", "arcane"];

/** Input limits (also applied to URL values). Percent fields allow two decimals. */
export const BONUS_LIMITS: Record<keyof BonusStats, [number, number]> = {
  str: [0, 2000],
  agi: [0, 2000],
  sta: [0, 2000],
  int: [0, 2000],
  spi: [0, 2000],
  attackPower: [0, 5000],
  rangedAttackPower: [0, 5000],
  spellPower: [0, 3000],
  holySpellPower: [0, 3000],
  fireSpellPower: [0, 3000],
  natureSpellPower: [0, 3000],
  frostSpellPower: [0, 3000],
  shadowSpellPower: [0, 3000],
  arcaneSpellPower: [0, 3000],
  hit: [0, 100],
  spellHit: [0, 100],
  crit: [0, 100],
  spellCrit: [0, 100],
  haste: [0, 100],
  weaponSkill: [0, 100],
};
export const CUSTOM_LIMITS = { level: [1, 63], armor: [0, 20000], resist: [0, 1000] } as const;

export function clampBonus(key: keyof BonusStats, v: number): number {
  if (!Number.isFinite(v)) return 0;
  const [lo, hi] = BONUS_LIMITS[key];
  const scale = BONUS_SCALE[key as keyof typeof BONUS_SCALE] ?? 1;
  return Math.min(hi, Math.max(lo, Math.round(v * scale) / scale));
}

export interface CharacterState {
  raceId: number; // 0 until a class is chosen
  weaponIds: WeaponIds;
  bonus: BonusStats;
  buffIds: string[]; // buffs and debuffs, in buffs.json order
  target: TargetPresetId;
  custom: CustomTarget;
  weapons: WeaponsFile | null; // lazy weapons.json
  setRace(id: number): void;
  setWeapon(slot: WeaponSlotKey, id: number, classToken: ClassToken, level: number): void;
  setBonus(key: keyof BonusStats, value: number): void;
  resetBonus(): void;
  toggleBuff(id: string): void;
  setPreset(name: "raidBuffs" | "raidDebuffs", on: boolean): void;
  setTarget(preset: TargetPresetId): void;
  setCustom(patch: Partial<CustomTarget>): void;
  fitToClass(token: ClassToken, level: number): Promise<boolean>; // false if something was dropped
  applyCode(code: CharacterCode, token: ClassToken, level: number): Promise<boolean>;
  toCode(token: ClassToken): CharacterCode;
}

const orderBuffs = (ids: Iterable<string>) => {
  const set = new Set(ids);
  return buffsFile.buffs.filter((b) => set.has(b.id)).map((b) => b.id);
};
/** Turns `id` on and drops other members of its group. */
function withBuff(ids: string[], id: string): string[] {
  const def = buffsFile.buffs.find((b) => b.id === id);
  if (!def) return ids;
  const rest = ids.filter((x) => {
    const other = buffsFile.buffs.find((b) => b.id === x);
    return x !== id && !(def.group && other?.group === def.group);
  });
  return orderBuffs([...rest, id]);
}

/** Drops weapons the class cannot use in that slot (and ammo that does not fit the ranged weapon). */
export function sanitizeWeapons(
  ids: WeaponIds,
  file: WeaponsFile,
  token: ClassToken,
  level: number,
): WeaponIds {
  const cls = getClassInfo(token);
  const byId = (id: number) => file.weapons.find((w) => w.id === id) ?? null;
  const pick = (slot: "mainHand" | "offHand" | "ranged", id: number, mh: ReturnType<typeof byId>) =>
    id &&
    weaponsForSlot(
      [byId(id)].filter((w) => w !== null),
      cls,
      level,
      slot,
      mh,
    ).length
      ? id
      : 0;
  const mainHand = pick("mainHand", ids.mainHand, null);
  const mh = byId(mainHand);
  const offHand = pick("offHand", ids.offHand, mh);
  const ranged = pick("ranged", ids.ranged, null);
  const ammo =
    ids.ammo && ammoFor(file.ammo, byId(ranged), level).some((a) => a.id === ids.ammo) ? ids.ammo : 0;
  return { mainHand, offHand, ranged, ammo };
}

/**
 * weapons.json is only awaited when weapon ids must be validated; otherwise it loads in the background so the
 * talent tree never waits for it.
 */
async function weaponsFor(ids: WeaponIds): Promise<WeaponsFile | null> {
  const loaded = useCharacter.getState().weapons;
  if (loaded) return loaded;
  if (Object.values(ids).some((id) => id !== 0)) return loadWeapons();
  void loadWeapons().then(
    (f) => useCharacter.setState({ weapons: f }),
    () => undefined,
  );
  return null;
}

export const useCharacter = create<CharacterState>()((set, get) => ({
  raceId: 0,
  weaponIds: NO_WEAPON_IDS,
  bonus: EMPTY_BONUS,
  buffIds: [],
  target: "boss",
  custom: DEFAULT_CUSTOM,
  weapons: null,
  setRace(id) {
    set({ raceId: id });
  },
  setWeapon(slot, id, token, level) {
    const file = get().weapons;
    if (!file) return;
    set({ weaponIds: sanitizeWeapons({ ...get().weaponIds, [slot]: id }, file, token, level) });
  },
  setBonus(key, value) {
    set({ bonus: { ...get().bonus, [key]: clampBonus(key, value) } });
  },
  resetBonus() {
    set({ bonus: EMPTY_BONUS });
  },
  toggleBuff(id) {
    const ids = get().buffIds;
    set({ buffIds: ids.includes(id) ? ids.filter((x) => x !== id) : withBuff(ids, id) });
  },
  setPreset(name, on) {
    const preset = buffsFile.presets[name];
    let ids = get().buffIds.filter((x) => !preset.includes(x));
    if (on) for (const id of preset) ids = withBuff(ids, id);
    set({ buffIds: orderBuffs(ids) });
  },
  setTarget(preset) {
    set({ target: preset });
  },
  setCustom(patch) {
    set({ custom: { ...get().custom, ...patch } });
  },
  async fitToClass(token, level) {
    const cls = getClassInfo(token);
    const raceId = cls.raceIds.includes(get().raceId) ? get().raceId : cls.raceIds[0]!;
    const file = await weaponsFor(get().weaponIds);
    const weaponIds = file ? sanitizeWeapons(get().weaponIds, file, token, level) : NO_WEAPON_IDS;
    const kept = JSON.stringify(weaponIds) === JSON.stringify(get().weaponIds);
    set({ raceId, weaponIds, ...(file ? { weapons: file } : {}) });
    return kept;
  },
  async applyCode(code, token, level) {
    const cls = getClassInfo(token);
    let ok = code.raceId === null || cls.raceIds.includes(code.raceId);
    const raceId = code.raceId !== null && ok ? code.raceId : cls.raceIds[0]!;
    const bonus = { ...EMPTY_BONUS };
    for (const [k, v] of Object.entries(code.bonus))
      bonus[k as keyof BonusStats] = clampBonus(k as keyof BonusStats, v);
    const known = buffsFile.buffs.filter((b) => code.buffCodes.includes(b.code));
    if (known.length !== code.buffCodes.length) ok = false;
    let buffIds: string[] = [];
    for (const b of known) buffIds = withBuff(buffIds, b.id);
    const file = await weaponsFor(code.weapons);
    const weaponIds = file ? sanitizeWeapons(code.weapons, file, token, level) : NO_WEAPON_IDS;
    if (JSON.stringify(weaponIds) !== JSON.stringify(code.weapons)) ok = false;
    const c = code.target.custom;
    const custom: CustomTarget = c
      ? {
          level: Math.min(63, Math.max(1, c.level)),
          armor: Math.min(20000, c.armor),
          resist: c.resist.map((r) => Math.min(1000, r)) as CustomTarget["resist"],
        }
      : DEFAULT_CUSTOM;
    set({
      raceId,
      bonus,
      buffIds,
      weaponIds,
      target: code.target.preset,
      custom,
      ...(file ? { weapons: file } : {}),
    });
    return ok;
  },
  toCode(token) {
    const s = get();
    const cls = getClassInfo(token);
    const bonus: CharacterCode["bonus"] = {};
    for (const [k, v] of Object.entries(s.bonus)) if (v !== 0) bonus[k as keyof BonusStats] = v;
    return {
      raceId: s.raceId === cls.raceIds[0] || s.raceId === 0 ? null : s.raceId,
      weapons: s.weaponIds,
      bonus,
      buffCodes: buffsFile.buffs.filter((b) => s.buffIds.includes(b.id)).map((b) => b.code),
      target: s.target === "custom" ? { preset: "custom", custom: s.custom } : { preset: s.target },
    };
  },
}));
```

### 7.2 Talent store and URL sync (exact diff)

`selectClass` and `applyBuildCode` run the character step in parallel with the tree load, **before** `status` becomes `ready`
(the URL writer skips `loading`, so a v2 link is never overwritten by a half-applied state). URL writes are triggered by either store.

```diff
diff --git a/src/state/store.ts b/src/state/store.ts
--- a/src/state/store.ts
+++ b/src/state/store.ts
@@ -13,6 +13,7 @@ import {
   type Ranks,
 } from "@/engine/talents";
 import type { BuildCode } from "./buildCode";
+import { useCharacter } from "./character";
 
 export interface CalcState {
   classToken: ClassToken | null;
@@ -64,9 +65,18 @@ export const useCalc = create<CalcState>()((set, get) => ({
     const id = ++requestId;
     set({ classToken: token, status: "loading", error: null });
     try {
-      const tree = await loadTree(token);
+      const [tree, charOk] = await Promise.all([
+        loadTree(token),
+        useCharacter.getState().fitToClass(token, get().level),
+      ]);
       if (id !== requestId) return;
-      set({ tree, status: "ready", ranks: {}, activeSpec: 0, notice: null });
+      set({
+        tree,
+        status: "ready",
+        ranks: {},
+        activeSpec: 0,
+        notice: charOk ? null : "Some equipped weapons cannot be used by this class and were removed.",
+      });
     } catch (e) {
       if (id !== requestId) return;
       set({ tree: null, status: "error", error: e instanceof Error ? e.message : String(e) });
@@ -76,7 +86,10 @@ export const useCalc = create<CalcState>()((set, get) => ({
     const id = ++requestId;
     set({ classToken: code.classToken, status: "loading", error: null });
     try {
-      const tree = await loadTree(code.classToken);
+      const [tree, charOk] = await Promise.all([
+        loadTree(code.classToken),
+        useCharacter.getState().applyCode(code.character, code.classToken, code.level),
+      ]);
       if (id !== requestId) return;
       const ctx = pointsContext({ level: code.level, talentedRank: code.talentedRank });
       const { ranks, dropped } = sanitize(tree, code.ranks, ctx);
@@ -87,7 +100,13 @@ export const useCalc = create<CalcState>()((set, get) => ({
         talentedRank: code.talentedRank,
         ranks,
         activeSpec: 0,
-        notice: dropped ? "Some talents in this link were not valid and were removed." : null,
+        notice:
+          [
+            dropped ? "Some talents in this link were not valid and were removed." : "",
+            charOk ? "" : "Some character settings in this link were not valid and were removed.",
+          ]
+            .filter(Boolean)
+            .join(" ") || null,
       });
     } catch (e) {
       if (id !== requestId) return;
diff --git a/src/state/urlSync.ts b/src/state/urlSync.ts
--- a/src/state/urlSync.ts
+++ b/src/state/urlSync.ts
@@ -1,5 +1,6 @@
 import { isClassToken } from "@/data";
 import { decodeBuild, encodeBuild } from "./buildCode";
+import { useCharacter } from "./character";
 import { useCalc } from "./store";
 
 /** Keeps location.hash and the store in sync. Call once before the first render. */
@@ -21,7 +22,8 @@ export function initUrlSync(): void {
     }
   });
 
-  useCalc.subscribe((s) => {
+  const write = () => {
+    const s = useCalc.getState();
     if (s.status === "loading") return;
     const next = s.classToken
       ? encodeBuild({
@@ -29,10 +31,13 @@ export function initUrlSync(): void {
           level: s.level,
           talentedRank: s.talentedRank,
           ranks: s.ranks,
+          character: useCharacter.getState().toCode(s.classToken),
         })
       : "";
     if (next === lastHash) return;
     lastHash = next;
     history.replaceState(null, "", next || location.pathname + location.search);
-  });
+  };
+  useCalc.subscribe(write);
+  useCharacter.subscribe(write);
 }
```

### 7.3 Derived stats `src/state/derived.ts` (exact)

`derive()` is pure (testable without React). In components use
`const d = useMemo(() => derive({ tree, ranks, level }, ch), [tree, ranks, level, ch.raceId, ch.weaponIds, ch.bonus, ch.buffIds, ch.target, ch.custom, ch.weapons])`
inside one hook `useDerived()` in `src/ui/stats/useDerived.ts` (select each field with its own `useCharacter((s) => s.x)` call). The
computation takes well under 1 ms.

```ts
import { baseStatsFile, buffsFile, getRace, racialsFile, targetsFile } from "@/data";
import type { MagicSchool, TargetPresetId } from "@/data/types";
import type { ClassTree, Ranks } from "@/engine/talents";
import {
  UnsupportedLevelError,
  assemble,
  computeCharacter,
  evaluateTarget,
  presetTarget,
  type CharacterStats,
  type EquippedWeapons,
  type TalentMapping,
  type TargetView,
} from "@/engine/stats";
import type { CharacterState } from "./character";
import { RESIST_ORDER } from "./character";

export const REFERENCE_PRESETS: readonly TargetPresetId[] = ["boss", "elite", "same", "lowArmorBoss"];

export type Derived =
  | {
      ok: true;
      stats: CharacterStats;
      view: TargetView;
      reference: TargetView[];
      mapping: TalentMapping;
      weaponsLoading: boolean;
    }
  | { ok: false; reason: "noClass" | "level" };

/** Pure: everything the stats UI shows, from the two stores. */
export function derive(
  calc: { tree: ClassTree | null; ranks: Ranks; level: number },
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
  const a = assemble({
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
  });
  let stats: CharacterStats;
  try {
    stats = computeCharacter(a.input);
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
  const view = at(ch.target);
  const reference = [...REFERENCE_PRESETS, ...(ch.target === "custom" ? (["custom"] as const) : [])].map(at);
  return { ok: true, stats, view, reference, mapping: a.mapping, weaponsLoading: ch.weapons === null };
}
```

---
## 8. UI (tasks T8–T10)

Match the Phase 2 style: dark panels (`var(--panel)`, 1px `var(--panel-border)`, radius 4), gold serif headings, Verdana 12–13px
text, native form controls styled dark (`background: #1d1b16; border: 1px solid var(--panel-border); color: var(--text)`), focus ring
`2px solid var(--focus)`. CSS modules per component. No new dependencies.

Add to `src/styles/tokens.css` (item quality colors, Classic): `--q0: #9d9d9d; --q1: #ffffff; --q2: #1eff00; --q3: #0070dd;
--q4: #a335ee; --q5: #ff8000; --q6: #e6cc80; --warn: #ff9933;`.

### 8.1 Page layout (`App.tsx`, `App.module.css`)

```
<h1> · ClassPicker · notice
[mobile only, when a class is selected] SectionTabs: role="tablist" aria-label="Sections", tabs "Talents" | "Gear" | "Stats"
Talents section: <TalentCalculator/>  (PointsSummary, then NEW <StatStrip/>, then the trees)
desktop (≥ 980 px, useMediaQuery("(min-width: 980px)")) and status === "ready":
   <div class="panels"> <CharacterPanel/> <StatsPanel/> </div>      grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap 16px; margin-top 16px
mobile: only the selected section is rendered (Talents | CharacterPanel | StatsPanel); section state is React state in App (default "Talents"), not in the URL
footer
```

The Phase 2 mobile e2e test uses `page.getByRole("tablist")`; with two tablists it must use
`page.getByRole("tablist", { name: "Talent trees" })` and `getByRole("tab")` scoped to it (task T11).

### 8.2 Formatting (`src/ui/stats/format.ts`)

`fmtInt(n) = String(Math.round(n))` (stats, AP, SP, health, mana, armor); `fmtPct(n) = n.toFixed(2) + "%"` (crit, hit, miss, dodge,
haste, DR); `fmtDec1(n) = n.toFixed(1)` (DPS, per-swing damage, weapon speed with 2 decimals: `toFixed(2)`); `fmtSigned(n, f)` adds
"+" to positive values and uses "−" (U+2212) for negatives. Never show `-0`.

### 8.3 `StatValue` (`src/ui/stats/StatValue.tsx`) — every derived number

Props `{ stat: Stat; format: (n: number) => string; label: string; testId: string }`. Renders
`<button type="button" class="value" data-testid={testId} aria-describedby={id}>{format(stat.value)}</button>`.
Hover, focus or click (touch) shows a tooltip (`role="tooltip"`, id, same look as the talent tooltip: `var(--tooltip-bg)`, 1px
`var(--tooltip-border)`): first line `{label} {format(value)}`, then one line per part `{part.label}: {fmtSigned(part.value, format)}`,
colored by `part.kind` (base/race white, gear/weapon green, buff/debuff `var(--focus)`, talent/racial gold, rule/conversion grey).
Escape and blur close it. Example for a Human Warrior with Arcanite Reaper and Cruelty 5/5 (main-hand crit):
`Crit 10.00%` / `Base: +0.00%` / `Agility 80 / 20: +4.00%` / `Ruthless (racial): +1.00%` / `Cruelty 5/5: +5.00%`.

### 8.4 `StatStrip` (`src/ui/stats/StatStrip.tsx`)

`data-testid="stat-strip"`, one row of 4 `StatValue`s with small labels, rendered by `TalentCalculator` right under `PointsSummary`
(both layouts), so every talent click shows its effect. Fields by class:

| Classes | Fields (testIds) |
|---|---|
| warrior, rogue, paladin, shaman, druid | AP (`strip-ap`), main-hand crit vs target (`strip-crit`), special miss vs target (`strip-miss`), armor DR (`strip-dr`) |
| hunter | RAP (`strip-ap`), ranged crit vs target (`strip-crit`; main hand if no ranged weapon), ranged miss (`strip-miss`), DR (`strip-dr`) |
| mage, priest, warlock | highest-school spell power (`strip-sp`), spell crit (`strip-crit`), spell miss vs target (`strip-miss`), mana (`strip-mana`) |

When `derive()` returns `level`, the strip shows "Stats: level 60 only".

### 8.5 `CharacterPanel` (`src/ui/character/`)

Sections (each an `<section>` with an `<h2>`; panel `data-testid="character-panel"`):

1. **Race** — `<select data-testid="race-select" aria-label="Race">` with `classInfo.raceIds` (names from `classes.json`), plus
   "Level 60" text (level is not editable in Phase 3).
2. **Weapons** — rows: Main hand, Off hand (only if `classInfo.dualWield`; disabled with text "Two-handed weapon equipped" when
   the main hand is `twoHand`), Ranged (only if the class has any of subclasses 2, 3, 16, 18, 19; label "Wand" for Priest/Mage/Warlock),
   Ammo (only when the ranged weapon is a bow, crossbow or gun; `<select data-testid="weapon-ammo">` with "None" + `ammoFor()`).
   Each weapon row is a `WeaponPicker`:
   - `<input role="combobox" aria-label="Main hand" data-testid="weapon-mainHand" aria-expanded aria-controls aria-autocomplete="list">`
     (`weapon-offHand`, `weapon-ranged`), placeholder "Search weapons…", disabled with "Loading weapons…" until `weapons` is loaded.
   - Candidates: `weaponsForSlot(file.weapons, classInfo, 60, slot, mainHandWeapon)`, filtered and sorted by `searchWeapons(list, query, 50)`.
   - Listbox `role="listbox"`; options `role="option" data-item-id={id} aria-selected`. Option content: 18px icon, name in quality
     color (`var(--q{quality})`), right side `ilvl {itemLevel} · {dps} dps`, second line `{weaponType} · {min}–{max} · {speed}`, and
     an "Era" badge for `source === "classic_era"`.
   - Keyboard: ArrowDown/ArrowUp move `aria-activedescendant`, Enter selects, Escape closes, typing filters; mouse: `onMouseDown`
     preventDefault + select. Selecting calls `setWeapon(slot, id, classToken, level)`; the input then shows the item name.
   - Below the input, when equipped, a `WeaponCard`: icon 24, name (quality color), `{min}–{max} damage · Speed {speed} · {dps} DPS`,
     bonus damage line `+16–30 Nature damage` (from `bonusDamage`), stat lines (labels below), source badge — Forever: muted "Forever";
     Classic Era: `<span class="unverified" title="Not in the Forever client data; values from the Classic Era client (Q18/Q19)">Classic Era data · unverified</span>`
     (`var(--warn)` border/text) — and a remove button `aria-label="Remove main hand"` (sets id 0).
   - Item stat labels: 3 Agility, 4 Strength, 5 Intellect, 6 Spirit, 7 Stamina, 31 Hit rating (`= x.xx%`), 32 Crit rating (`= x.xx%`),
     36 Haste rating, 38 Attack Power, 39 Ranged Attack Power, 41 Healing, 42/45 Spell Power, 43 Mana per 5 sec, 50 Armor,
     51 Fire / 52 Frost / 53 Holy / 54 Shadow / 55 Nature / 56 Arcane Resistance; any other id: `Unknown stat {id} (not modeled)` in grey.
     Only 3–7, 31, 32, 36, 38, 39, 42, 45 affect stats.
3. **Bonus stats** — heading + hint "Totals from gear other than weapons (weapons are added automatically)." and a "Reset" button.
   Three fieldsets (Attributes: str agi sta int spi; Physical: attackPower "Attack power", rangedAttackPower "Ranged attack power",
   hit "Hit %", crit "Crit %", haste "Haste %", weaponSkill "Weapon skill"; Spell: spellPower "Spell power (all schools)", six
   "{School} spell power", spellHit "Spell hit %", spellCrit "Spell crit %"). Each `<input type="number" id="bonus-{key}"
   data-testid="bonus-{key}" min max step>` (step 1, or 0.01 for % fields; min/max from `BONUS_LIMITS`), `onChange` →
   `setBonus(key, Number(value) || 0)`. Hide the Spell fieldset for Warrior and Rogue; hide `rangedAttackPower` when the class has no RAP.
4. **Buffs and consumables** — `BuffsPanel`: groups by `category`: Raid buffs (with a toggle button "Raid buffed", `aria-pressed` =
   every `presets.raidBuffs` id selected, `data-testid="preset-raidBuffs"`, `onClick` → `setPreset("raidBuffs", !pressed)`), World
   buffs (note: "Forever: world buffs have no effect inside raid instances."), Consumables, Weapon (main hand). Each buff:
   `<label title={notes + (classic ? " Classic 1.12: " + classic : "")}><input type="checkbox" data-testid="buff-{id}" checked onChange={() => toggleBuff(id)}/> {name} <span class="dim">{summary}</span></label>`.
   `summary` = effects joined with ", " via `effectSummary(e)` in `src/ui/character/effectText.ts`:
   `stat` "+16 all stats" / "+31 Intellect"; `statPct` "+10% all stats" / "+15% Stamina"; `meleeAttackPower` "+139 melee AP";
   `rangedAttackPower` "+100 ranged AP"; `attackPower` "+X AP"; `spellPower` "+40 shadow spell power" (no schools: "+150 spell power");
   `crit` "+3% crit"; `weaponCrit` "+2% weapon crit"; `spellCrit` "+1% spell crit"; `hit`/`weaponHit`/`spellHit` likewise;
   `haste` "+15% haste"; `health` "+1200 health"; `weaponDamage` "+8 weapon damage"; `targetArmor` "−2250 armor";
   `targetResist` "−75 magic resistance"; `targetDamageTakenPct` "+10% magic damage taken"; other keys: "{key} {value}".
5. **Target** — `TargetPanel` (`data-testid="target-panel"`): `role="radiogroup" aria-label="Target"` with one radio per preset in
   `targets.json` order, label `{label} ({level}, {armor} armor)` from `byPlayerLevel["60"]` (Custom: "Custom"). Custom fields
   (enabled only for Custom): level 1–63, armor 0–20000, six resistances 0–1000 (`setCustom`). Debuffs: the `debuff` buffs as
   checkboxes (same component as buffs) and a "Raid debuffs" toggle (`data-testid="preset-raidDebuffs"`). Result line:
   `Armor <StatValue testId="target-armor"/> · Physical damage reduction <StatValue testId="target-dr"/>` for the selected target.

### 8.6 `StatsPanel` (`src/ui/stats/`, `data-testid="stats-panel"`)

If `derive()` is not ok: `noClass` → render nothing; `level` → "Stats are computed for level 60 only (level selector: Phase 7)."
Otherwise, a two-column table per group (label | `StatValue`); a row is omitted when its stat is `null`:

| Group | Rows (testIds) |
|---|---|
| Attributes | Strength `stat-str`, Agility `stat-agi`, Stamina `stat-sta`, Intellect `stat-int`, Spirit `stat-spi`, Health `stat-health`, Mana `stat-mana` |
| Melee | Attack power `stat-ap`, Crit (main hand) `stat-crit-mh`, Crit (off hand) `stat-crit-oh`, Hit `stat-hit-mh`, Hit (off hand) `stat-hit-oh`, Weapon skill `stat-skill-mh`, Haste `stat-haste-melee`, Expertise `stat-expertise` (if > 0), Armor penetration `stat-armorpen` (if > 0) |
| Ranged (RAP not null) | Ranged attack power `stat-rap`, Ranged crit `stat-crit-ranged`, Ranged hit `stat-hit-ranged`, Ranged haste `stat-haste-ranged` |
| Spell (hidden for Warrior and Rogue) | Spell power per school `stat-sp-{school}` (6 rows), Spell crit `stat-crit-spell`, Spell hit `stat-hit-spell`, Spell haste `stat-haste-spell`, Spell penetration (if > 0) |
| Weapons | per equipped slot: `{slot}: {name}` then `StatValue` per swing (`weapon-swing-{slot}`, fmtDec1) and DPS (`weapon-dps-{slot}`, fmtDec1, tooltip shows weapon/ammo/AP parts) and the hasted speed |
| Damage modifiers (Phase 4) | `stats.damageDone`: "{label}: +{value}% {schools}" in grey with the note "applied by the damage engine (Phase 4)" |

Then **Vs {target label} (level {level})** (`data-testid="vs-target"`): rows for the main hand (and off hand / ranged when present):
special miss `vs-miss-{slot}`, white miss `vs-whitemiss-{slot}` (melee), dodge `vs-dodge-{slot}`, parry "0.00% (behind)",
glancing `vs-glance-{slot}` (melee), crit vs target `vs-crit-{slot}`, white crit (capped) `vs-whitecrit-{slot}` with "cap X%",
hit cap `vs-hitcap-{slot}` ("+9.00% hit removes special misses"); spell miss `vs-miss-spell`, spell hit cap `vs-hitcap-spell`;
armor `vs-armor`, DR `vs-dr`, magic damage taken (if any). A warning line in `var(--warn)` when white crit > cap.

Then the **reference table** (`data-testid="reference-table"`): columns Target, Level, Armor, DR, Miss, Dodge, Glancing, Crit, Spell
miss (melee columns use the main hand; ranged for Hunters without a melee weapon). One `<tr>` per `derive().reference` row
(boss, elite, same, low-armor boss, + custom when selected). A "DPS" column is rendered only if some row has `dps !== undefined`
(Phase 4). Caption: "Same build vs reference targets for level 60 (debuffs applied)".

Finally `NotModeledNote`: `<details data-testid="not-modeled"><summary>Talents not modeled yet ({n})</summary>` with sub-lists in
this order and headings: "Inactive (condition not met)" (`inactive`), "Affect specific spells (Phase 4)" (`spellMod`), "Special
effects (Phase 4)" (`special`), "Abilities and cooldowns (Phase 4/5)" (`ability`), "Not supported yet" (`unsupported`). Each item
`{name} {rank}/{maxRank} — {detail}` (`maxRank` from `tree.nodes.get(nodeId)!.talent`). A talent can appear under several headings. Not rendered when n = 0. Also list active
racials of the selected race under "Racial abilities (Phase 5)" (from `racials.json`, `kind === "active"`).

---

## 9. Tests

### 9.1 Engine (`src/engine/stats/stats.test.ts` + `src/testkit/stats.ts`, exact)

Hand-computed expectations (Python cross-check in the prototype). Scenario summary:

| Scenario | Inputs | Key expected values |
|---|---|---|
| A | Human Warrior, naked, boss | Str 120, Agi 80, Spi 51.7, AP 400, RAP 130, health 2609, crit 5% sheet / 2.6% vs boss, miss 8%, dodge 6.5%, glancing 40%, hit cap 9%, DR 40.418% |
| A' | same vs same-level mob | miss 5%, crit 5%, glancing 10% |
| B | Human Warrior, Arcanite Reaper, bonus Str 100 / crit 3% / hit 5%, 12 raid buffs, Sunder+FF+CoR, Cruelty 5, 2H Spec 3 | Str 317.9, Agi 203.5, Sta 229.9, Spi 124.63, health 3808, AP 1129.8, RAP 415.5, crit 25.175% / 22.775% vs boss, miss 4%, white crit cap 49.5%, spell crit 7%, per swing 511.16, DPS 134.5158, damageDone [+6% physical], armor 471, DR 7.888% |
| C | Gnome Mage, bonus SP 300, AI + BoK + Greater Firepower, Arcane Mind 5, Precision 3 | Int 192.39, mana 4072.7925, spell crit 3.4334%, spell miss 11%, hit cap 16%, fire SP 340, frost SP 300 |
| D | Orc Rogue, Brutality Blade + Chromatically Tempered Sword, Precision 3, Malice 5, Weapon Expertise 2 | AP 356, crit 11.1724% / 8.7724%, miss 6%, white miss 25%, dodge 4.5%, white crit cap 30.5%, white hit cap 28%, MH DPS 77.0286, OH DPS 41.9451 |
| E | Dwarf Hunter, Rhok'delar + Thorium Headed Arrow, TSA, Lethal Attacks 5, Surefooted 3, Ranged Weapon Spec 5 | RAP 469, AP 278, ranged crit 8.2830% / 5.8830%, ranged miss 5%, glancing 0, per shot 276.009, DPS 95.1755 |
| Mapper coverage | all 447 talents at max rank | applied names per class = list in 1.6 |
| Conditions | Cruelty without weapon; Furious Precision with DW; Sharpened Claws; Death Wish + Improved Heroic Strike | inactive note "requires a melee weapon"; OH hit 10, MH hit 0; inactive (form); `ability` and `spellMod` notes |

```ts
// TEST-ONLY helpers for the stat engine. Never import from app code.
import baseStatsJson from "@manual/base-stats.json";
import buffsJson from "@manual/buffs.json";
import racialsJson from "@manual/racials.json";
import targetsJson from "@data/targets.json";
import weaponsJson from "@data/weapons.json";
import type {
  BaseStatsFile,
  BuffsFile,
  ClassToken,
  RacialsFile,
  TargetPresetId,
  TargetsFile,
  WeaponsFile,
} from "@/data/types";
import {
  EMPTY_BONUS,
  assemble,
  computeCharacter,
  evaluateTarget,
  presetTarget,
  type BonusStats,
  type EquippedWeapons,
  type RankedTalent,
} from "@/engine/stats";
import { treeFor } from "./talents";

export const baseStats = baseStatsJson as unknown as BaseStatsFile;
export const buffs = buffsJson as unknown as BuffsFile;
export const racials = racialsJson as unknown as RacialsFile;
export const targets = targetsJson as unknown as TargetsFile;
export const weaponsFile = weaponsJson as unknown as WeaponsFile;

export const weapon = (id: number) => {
  const w = weaponsFile.weapons.find((x) => x.id === id);
  if (!w) throw new Error(`no weapon ${id}`);
  return w;
};
export const ammo = (id: number) => {
  const a = weaponsFile.ammo.find((x) => x.id === id);
  if (!a) throw new Error(`no ammo ${id}`);
  return a;
};
export const NO_WEAPONS: EquippedWeapons = { mainHand: null, offHand: null, ranged: null, ammo: null };

/** Talents by name with a rank, e.g. { Cruelty: 5 }. */
export function ranked(token: ClassToken, byName: Record<string, number>): RankedTalent[] {
  const tree = treeFor(token);
  return Object.entries(byName).map(([name, rank]) => {
    const t = [...tree.nodes.values()].find((n) => n.talent.name === name);
    if (!t) throw new Error(`no talent ${name} for ${token}`);
    return { talent: t.talent, rank };
  });
}

export interface Scenario {
  classToken: ClassToken;
  race: string;
  weapons?: Partial<EquippedWeapons>;
  bonus?: Partial<BonusStats>;
  buffIds?: string[];
  talents?: Record<string, number>;
  target?: TargetPresetId;
}

export function run(s: Scenario) {
  const a = assemble({
    classToken: s.classToken,
    race: s.race,
    level: 60,
    baseStats,
    racials,
    buffs,
    buffIds: s.buffIds ?? [],
    talents: ranked(s.classToken, s.talents ?? {}),
    weapons: { ...NO_WEAPONS, ...s.weapons },
    bonus: { ...EMPTY_BONUS, ...s.bonus },
  });
  const stats = computeCharacter(a.input);
  const dw = a.input.weapons.offHand !== null;
  const view = evaluateTarget(
    stats,
    presetTarget(targets, s.target ?? "boss", 60, a.debuffs),
    targets.armorFormula,
    dw,
  );
  return { ...a, stats, view };
}
```

```ts
import { describe, expect, it } from "vitest";
import { ammo, buffs, run, weapon } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import type { ClassToken } from "@/data/types";
import { baseMeleeMiss } from "./target";
import { mapTalents } from "./talentEffects";
import { baseSpellMiss } from "./constants";
import type { Stat } from "./stat";

const RAID = buffs.presets.raidBuffs;
const sumOk = (s: Stat) => expect(s.parts.reduce((a, p) => a + p.value, 0)).toBeCloseTo(s.value, 9);

describe("outcome rules", () => {
  it("melee base miss", () => {
    expect(baseMeleeMiss(0)).toBe(5);
    expect(baseMeleeMiss(10)).toBeCloseTo(6, 9);
    expect(baseMeleeMiss(15)).toBeCloseTo(8, 9);
    expect(baseMeleeMiss(-5)).toBeCloseTo(4.8, 9);
  });
  it("spell base miss", () => {
    expect([-3, 0, 1, 2, 3, 4].map(baseSpellMiss)).toEqual([1, 4, 5, 6, 17, 28]);
  });
});

describe("A: naked Human Warrior vs boss", () => {
  const r = run({ classToken: "warrior", race: "HUMAN" });
  it("primary stats", () => {
    expect(r.stats.primary.str.value).toBe(120);
    expect(r.stats.primary.agi.value).toBe(80);
    expect(r.stats.primary.spi.value).toBeCloseTo(51.7, 9); // The Human Spirit +10%
  });
  it("AP, RAP, health, no mana", () => {
    expect(r.stats.attackPower.value).toBe(400);
    expect(r.stats.rangedAttackPower!.value).toBe(130);
    expect(r.stats.health.value).toBe(2609);
    expect(r.stats.mana).toBeNull();
  });
  it("crit 5% sheet, 2.6% vs boss", () => {
    expect(r.stats.crit.mainHand.value).toBeCloseTo(5, 9);
    expect(r.view.mainHand!.crit.value).toBeCloseTo(2.6, 9);
    expect(r.view.mainHand!.miss.value).toBeCloseTo(8, 9);
    expect(r.view.mainHand!.dodge.value).toBeCloseTo(6.5, 9);
    expect(r.view.mainHand!.glancing).toBe(40);
    expect(r.view.mainHand!.hitCap).toBeCloseTo(9, 9);
  });
  it("armor reduction vs boss", () => {
    expect(r.view.armor.value).toBe(3731);
    expect(r.view.armorReduction.value).toBeCloseTo(40.418156, 5);
  });
  it("same-level mob: no suppression, 5% miss, 10% glancing", () => {
    const s = run({ classToken: "warrior", race: "HUMAN", target: "same" });
    expect(s.view.mainHand!.miss.value).toBe(5);
    expect(s.view.mainHand!.crit.value).toBeCloseTo(5, 9);
    expect(s.view.mainHand!.glancing).toBe(10);
  });
});

describe("B: geared, raid-buffed Human Warrior vs debuffed boss", () => {
  const r = run({
    classToken: "warrior",
    race: "HUMAN",
    weapons: { mainHand: weapon(12784) }, // Arcanite Reaper 153-256 @3.8, Sta 13, AP 62
    bonus: { str: 100, crit: 3, hit: 5 },
    buffIds: [...RAID, "sunder_armor", "faerie_fire", "curse_of_recklessness"],
    talents: { Cruelty: 5, "Two-Handed Weapon Specialization": 3 },
  });
  it("stats with BoK applied last", () => {
    expect(r.stats.primary.str.value).toBeCloseTo(317.9, 9);
    expect(r.stats.primary.agi.value).toBeCloseTo(203.5, 9);
    expect(r.stats.primary.sta.value).toBeCloseTo(229.9, 9);
    expect(r.stats.primary.spi.value).toBeCloseTo(124.63, 9);
    expect(r.stats.health.value).toBeCloseTo(3808, 9);
  });
  it("AP 1129.8, RAP 415.5", () => {
    expect(r.stats.attackPower.value).toBeCloseTo(1129.8, 9);
    expect(r.stats.rangedAttackPower!.value).toBeCloseTo(415.5, 9);
    sumOk(r.stats.attackPower);
  });
  it("crit 25.175% sheet, 22.775% vs boss; hit 5% -> 4% miss", () => {
    expect(r.stats.crit.mainHand.value).toBeCloseTo(25.175, 9);
    expect(r.view.mainHand!.crit.value).toBeCloseTo(22.775, 9);
    expect(r.view.mainHand!.miss.value).toBeCloseTo(4, 9);
    expect(r.view.mainHand!.whiteCritCap).toBeCloseTo(49.5, 9);
    expect(r.stats.crit.spell.value).toBeCloseTo(7, 9);
    sumOk(r.view.mainHand!.crit);
  });
  it("weapon damage", () => {
    const w = r.stats.weapons.mainHand!;
    expect(w.perSwing.value).toBeCloseTo(511.16, 9);
    expect(w.dps.value).toBeCloseTo(134.515789, 5);
    sumOk(w.dps);
  });
  it("2H spec recorded for Phase 4, not applied", () => {
    expect(r.stats.damageDone).toEqual([
      expect.objectContaining({ key: "damageDonePct", value: 6, schools: ["physical"], kind: "talent" }),
    ]);
  });
  it("debuffed armor 471 -> 7.89% reduction", () => {
    expect(r.view.armor.value).toBe(471);
    expect(r.view.armorReduction.value).toBeCloseTo(7.888126, 5);
  });
});

describe("C: Gnome Mage", () => {
  const r = run({
    classToken: "mage",
    race: "GNOME",
    bonus: { spellPower: 300 },
    buffIds: ["arcane_intellect", "blessing_of_kings", "elixir_of_greater_firepower"],
    talents: { "Arcane Mind": 5, Precision: 3 },
  });
  it("Int and mana (Expansive Mind)", () => {
    expect(r.stats.primary.int.value).toBeCloseTo(192.39, 9);
    expect(r.stats.mana!.value).toBeCloseTo(4072.7925, 6);
  });
  it("spell crit, hit, spell power", () => {
    expect(r.stats.crit.spell.value).toBeCloseTo(3.433445, 5);
    expect(r.view.spell.miss.value).toBeCloseTo(11, 9);
    expect(r.view.spell.hitCap).toBe(16);
    expect(r.stats.spellPower.fire.value).toBe(340);
    expect(r.stats.spellPower.frost.value).toBe(300);
  });
});

describe("D: Orc Rogue dual wield", () => {
  const r = run({
    classToken: "rogue",
    race: "ORC",
    weapons: { mainHand: weapon(18832), offHand: weapon(19352) },
    talents: { Precision: 3, Malice: 5, "Weapon Expertise": 2 },
  });
  it("AP and crit", () => {
    expect(r.stats.attackPower.value).toBe(356);
    expect(r.stats.crit.mainHand.value).toBeCloseTo(11.172414, 5);
    expect(r.view.mainHand!.crit.value).toBeCloseTo(8.772414, 5);
  });
  it("hit, dodge, dual-wield white miss", () => {
    expect(r.view.mainHand!.miss.value).toBeCloseTo(6, 9);
    expect(r.view.mainHand!.whiteMiss.value).toBeCloseTo(25, 9);
    expect(r.view.mainHand!.dodge.value).toBeCloseTo(4.5, 9);
    expect(r.view.mainHand!.whiteCritCap).toBeCloseTo(30.5, 9);
    expect(r.view.mainHand!.whiteHitCap).toBeCloseTo(28, 9);
  });
  it("weapon dps, off hand halved", () => {
    expect(r.stats.weapons.mainHand!.dps.value).toBeCloseTo(77.028571, 5);
    expect(r.stats.weapons.offHand!.dps.value).toBeCloseTo(41.945055, 5);
  });
});

describe("E: Dwarf Hunter, Rhok'delar + Thorium Headed Arrow", () => {
  const r = run({
    classToken: "hunter",
    race: "DWARF",
    weapons: { ranged: weapon(18713), ammo: ammo(18042) },
    buffIds: ["trueshot_aura"],
    talents: { "Lethal Attacks": 5, Surefooted: 3, "Ranged Weapon Specialization": 5 },
  });
  it("RAP, ranged crit (crit rating 14 = 1%), hit", () => {
    expect(r.stats.rangedAttackPower!.value).toBe(469);
    expect(r.stats.attackPower.value).toBe(278);
    expect(r.stats.crit.ranged!.value).toBeCloseTo(8.283019, 5);
    expect(r.view.ranged!.crit.value).toBeCloseTo(5.883019, 5);
    expect(r.view.ranged!.miss.value).toBeCloseTo(5, 9);
    expect(r.view.ranged!.glancing).toBe(0);
  });
  it("ranged dps with ammo", () => {
    expect(r.stats.weapons.ranged!.perSwing.value).toBeCloseTo(276.009, 6);
    expect(r.stats.weapons.ranged!.dps.value).toBeCloseTo(95.175517, 5);
  });
});

describe("talent conditions", () => {
  it("Cruelty is inactive without a melee weapon", () => {
    const r = run({ classToken: "warrior", race: "HUMAN", talents: { Cruelty: 5 } });
    expect(r.stats.crit.mainHand.value).toBeCloseTo(5, 9);
    expect(r.mapping.notModeled).toContainEqual(
      expect.objectContaining({ name: "Cruelty", reason: "inactive", detail: "requires a melee weapon" }),
    );
  });
  it("Furious Precision adds hit to the off hand only", () => {
    const r = run({
      classToken: "warrior",
      race: "HUMAN",
      weapons: { mainHand: weapon(18832), offHand: weapon(19352) },
      talents: { "Furious Precision": 3 },
    });
    expect(r.stats.hit.mainHand.value).toBe(0);
    expect(r.stats.hit.offHand!.value).toBe(10);
  });
  it("Sharpened Claws needs a form", () => {
    const r = run({ classToken: "druid", race: "TAUREN", talents: { "Sharpened Claws": 2 } });
    expect(r.mapping.notModeled).toContainEqual(
      expect.objectContaining({ name: "Sharpened Claws", reason: "inactive" }),
    );
  });
  it("abilities and spell modifiers are listed, not applied", () => {
    const r = run({
      classToken: "warrior",
      race: "HUMAN",
      talents: { "Death Wish": 1, "Improved Heroic Strike": 3 },
    });
    const reasons = r.mapping.notModeled.map((n) => `${n.name}:${n.reason}`);
    expect(reasons).toContain("Death Wish:ability");
    expect(reasons).toContain("Improved Heroic Strike:spellMod");
    expect(r.mapping.spellMods[0]).toMatchObject({ name: "Improved Heroic Strike", op: expect.any(Number) });
  });
});

describe("generic mapper over every talent (max rank, Arcanite Reaper + Rhok'delar)", () => {
  const APPLIED: Record<string, string[]> = {
    warrior: ["Cruelty"],
    paladin: ["Divine Intellect", "Precision", "Conviction", "Champion of the Light"],
    hunter: ["Lethal Attacks", "Surefooted", "Lightning Reflexes"],
    rogue: ["Malice", "Precision", "Weapon Expertise", "Serrated Blades"],
    priest: ["Mental Strength", "Spiritual Guidance"],
    shaman: ["Thundering Strikes", "Ancestral Knowledge", "Toughness", "Mental Quickness", "Tidal Focus"],
    mage: ["Arcane Subtlety", "Arcane Mind", "Arcane Instability", "Precision"],
    warlock: ["Suppression", "Demonic Embrace"],
    druid: ["Nature's Majesty", "Nature's Reach", "Heart of the Wild", "Living Spirit"],
  };
  for (const [token, names] of Object.entries(APPLIED)) {
    it(token, () => {
      const tree = treeFor(token as ClassToken);
      const list = [...tree.nodes.values()].map((n) => ({ talent: n.talent, rank: n.talent.maxRank }));
      const m = mapTalents(list, {
        mainHand: weapon(12784),
        offHand: null,
        ranged: weapon(18713),
        ammo: null,
      });
      for (const e of m.applied) expect(Number.isFinite(e.value)).toBe(true);
      expect([...new Set(m.applied.map((e) => e.label.replace(/ \d+\/\d+$/, "")))]).toEqual(names);
    });
  }
});
```

### 9.2 State tests (exact)

`src/state/character.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { buffsFile } from "@/data";
import { DEFAULT_CHARACTER } from "./charCode";
import { useCharacter } from "./character";

beforeEach(async () => {
  await useCharacter.getState().applyCode(DEFAULT_CHARACTER, "warrior", 60);
});

describe("character store", () => {
  it("defaults: first playable race, nothing equipped, boss", () => {
    const s = useCharacter.getState();
    expect(s.raceId).toBe(1);
    expect(s.toCode("warrior")).toEqual(DEFAULT_CHARACTER);
  });
  it("buff groups are exclusive", () => {
    const st = useCharacter.getState();
    st.toggleBuff("sunder_armor");
    st.toggleBuff("expose_armor");
    expect(useCharacter.getState().buffIds).toEqual(["expose_armor"]);
  });
  it("raid presets turn on and off", () => {
    const st = useCharacter.getState();
    st.setPreset("raidBuffs", true);
    expect(useCharacter.getState().buffIds).toEqual(buffsFile.presets.raidBuffs);
    st.toggleBuff("songflower");
    st.setPreset("raidBuffs", false);
    expect(useCharacter.getState().buffIds).toEqual(["songflower"]);
  });
  it("clamps bonus stats", () => {
    const st = useCharacter.getState();
    st.setBonus("crit", 3.456);
    st.setBonus("str", -5);
    st.setBonus("attackPower", 99999);
    expect(useCharacter.getState().bonus).toMatchObject({ crit: 3.46, str: 0, attackPower: 5000 });
  });
  it("applyCode drops invalid race, buffs and weapons", async () => {
    const ok = await useCharacter.getState().applyCode(
      {
        ...DEFAULT_CHARACTER,
        raceId: 4,
        buffCodes: [1, 99],
        weapons: { mainHand: 12784, offHand: 0, ranged: 0, ammo: 0 },
      },
      "mage",
      60,
    );
    const s = useCharacter.getState();
    expect(ok).toBe(false);
    expect(s.raceId).toBe(1); // Night Elf mage is not a CharBaseInfo combo
    expect(s.buffIds).toEqual(["battle_shout"]);
    expect(s.weaponIds.mainHand).toBe(0); // mages cannot use two-handed axes
  });
  it("fitToClass keeps a valid race and resets an invalid one", async () => {
    const st = useCharacter.getState();
    st.setRace(6); // Tauren
    expect(await st.fitToClass("druid", 60)).toBe(true);
    expect(useCharacter.getState().raceId).toBe(6);
    await useCharacter.getState().fitToClass("mage", 60);
    expect(useCharacter.getState().raceId).toBe(1);
  });
});
```

`src/state/derived.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classesFile } from "@/data";
import { treeFor } from "@/testkit/talents";
import { weaponsFile } from "@/testkit/stats";
import { EMPTY_BONUS } from "@/engine/stats";
import { DEFAULT_CUSTOM, NO_WEAPON_IDS, sanitizeWeapons } from "./character";
import { derive } from "./derived";

const ch = {
  raceId: 1,
  weaponIds: NO_WEAPON_IDS,
  bonus: EMPTY_BONUS,
  buffIds: [],
  target: "boss" as const,
  custom: DEFAULT_CUSTOM,
  weapons: weaponsFile,
};
describe("derive", () => {
  it("naked human warrior", () => {
    const d = derive({ tree: treeFor("warrior"), ranks: {}, level: 60 }, ch);
    if (!d.ok) throw new Error(d.reason);
    expect(d.stats.attackPower.value).toBe(400);
    expect(d.reference.map((v) => v.level)).toEqual([63, 62, 60, 63]);
    expect(d.reference.map((v) => v.armor.value)).toEqual([3731, 3677, 3566, 1866]);
  });
  it("works for every class and playable race", () => {
    for (const c of classesFile.classes)
      for (const raceId of c.raceIds) {
        const d = derive({ tree: treeFor(c.token), ranks: {}, level: 60 }, { ...ch, raceId });
        expect(d.ok, `${c.token} ${raceId}`).toBe(true);
      }
  });
  it("level below 60 has no stats", () => {
    expect(derive({ tree: treeFor("warrior"), ranks: {}, level: 40 }, ch)).toEqual({
      ok: false,
      reason: "level",
    });
  });
  it("sanitizeWeapons drops what the class cannot use", () => {
    // mage cannot use Arcanite Reaper (2H axe) nor dual wield
    expect(
      sanitizeWeapons({ mainHand: 12784, offHand: 19352, ranged: 0, ammo: 0 }, weaponsFile, "mage", 60),
    ).toEqual(NO_WEAPON_IDS);
    // rogue: main + off hand swords, bow + arrows
    expect(
      sanitizeWeapons(
        { mainHand: 18832, offHand: 19352, ranged: 18713, ammo: 18042 },
        weaponsFile,
        "rogue",
        60,
      ),
    ).toEqual({ mainHand: 18832, offHand: 19352, ranged: 0, ammo: 0 }); // Rhok'delar is Hunter-only (allowableClass 4)
    // two-hander in main hand: no off hand
    expect(
      sanitizeWeapons({ mainHand: 12784, offHand: 19352, ranged: 0, ammo: 0 }, weaponsFile, "warrior", 60),
    ).toEqual({
      mainHand: 12784,
      offHand: 0,
      ranged: 0,
      ammo: 0,
    });
  });
});
```

### 9.3 Codec tests

Section 6.4 (`charCode.test.ts`) plus the `buildCode.test.ts` / `store.test.ts` edits in 6.3.

### 9.4 Data tests

Section 4 (`manual.test.ts`, `data.test.ts` additions) and 2.7 (pipeline).

### 9.5 UI unit tests (Vitest, node environment)

`src/ui/stats/format.test.ts`: `fmtPct(2.6000000000000005) === "2.60%"`, `fmtPct(7.888125942053257) === "7.89%"`,
`fmtInt(1129.8) === "1130"`, `fmtDec1(86.81578947) === "86.8"`, `fmtSigned(-0.6, fmtPct) === "−0.60%"`, `fmtSigned(0, fmtInt) === "+0"`.
`src/ui/character/effectText.test.ts`: summaries of Battle Shout ("+139 melee AP"), Blessing of Kings ("+10% all stats"),
Elixir of Shadow Power ("+40 shadow spell power"), Sunder Armor ("−2250 armor"), Curse of the Elements ("−75 magic resistance, +10% magic damage taken").

### 9.6 Playwright (`e2e/character.spec.ts`, desktop project; `blockRemoteImages` + `watchErrors` in every test)

Values below follow from section 9.1 and the formatting rules.

1. **stats update with talents and weapons** — open `./`, click Warrior. Expect `stat-ap` "400", `stat-crit-mh` "5.00%",
   `vs-crit-mainHand` "2.60%", `strip-ap` "400". Click `node(page, "Cruelty")` 5 times: `stat-crit-mh` still "5.00%", and
   `not-modeled` (open it) contains "Cruelty 5/5 — requires a melee weapon". Fill `weapon-mainHand` with "Arcanite Reaper", click
   `[role=option][data-item-id="12784"]`. Expect `stat-ap` "462", `stat-crit-mh` "10.00%", `vs-crit-mainHand` "7.60%",
   `weapon-dps-mainHand` "86.8", and the not-modeled note no longer mentions Cruelty. Hover `stat-crit-mh`: the tooltip contains
   "Cruelty 5/5" and "Ruthless (racial)".
2. **raid buffs preset and URL round trip** — continue from (1) in a fresh page (repeat the steps), click `preset-raidBuffs`:
   `aria-pressed="true"`, `buff-battle_shout` checked, `stat-ap` "910". URL matches `/#v2\.warrior\.60\.0\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/`.
   Open the URL in a new browser context: `stat-ap` "910", `race-select` has value "1", `weapon-mainHand` has value "Arcanite Reaper",
   Cruelty rank "5/5". Click `preset-raidBuffs` again: `stat-ap` "462".
3. **v2 golden link** — `page.goto("./#v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8")`: no notice,
   `stat-ap` "1130", `target-armor` "471", `target-dr` "7.89%", `buff-sunder_armor` checked, `bonus-str` value "100".
4. **v1 links still work** — `page.goto("./" + GOLDEN)`: `points-by-spec` "0/33/18", URL stays exactly GOLDEN after load
   (`await expect(page).toHaveURL(new RegExp(escape(GOLDEN) + "$"))`), no notice.
5. **targets** — Warrior, click the "Same-level mob" radio: `target-armor` "3566", `target-dr` "39.33%", `vs-glance-mainHand` "10.00%";
   `reference-table` has 4 body rows; select Custom, set armor 0: `target-dr` "0.00%", reference table has 5 body rows.
6. **race and proficiency** — Mage: `race-select` options are exactly Human, Orc, Undead, Gnome, Troll; there is no `weapon-offHand`;
   `weapon-ranged` label is "Wand". Rogue: searching "Arcanite Reaper" in `weapon-mainHand` shows no option with `data-item-id="12784"`.

`e2e/mobile.spec.ts`: scope the Phase 2 test to `getByRole("tablist", { name: "Talent trees" })`; add **mobile sections**: Mage,
`getByRole("tab", { name: "Stats" })` click → `stat-crit-spell` visible; "Gear" → `race-select` visible; "Talents" → `tree-0` visible.

---

## 10. Ordered task list

Commit after each task (attribution lines per the session reminder). Keep `npm run format:check`, `npm run lint`, `npm test`,
`npm run typecheck` green from T3 on.

| Task | Work | Acceptance check |
|---|---|---|
| T1 | Section 2.1–2.5: fetch 2 tables, pipeline code; regenerate | build succeeds; `classes.json` matches the table in 2.3; talents have `effects/equipped/shapeshiftMask`; the existing 43 pipeline tests pass |
| T2 | Section 3 manual files + 2.6 `manual.py` + 2.7 tests; regenerate (2.8) | 48 pipeline tests OK; `manualValidation 0`; class table of 2.3 matches `classes.json`; commit generated data |
| T3 | Section 4: types, `data/index.ts`, alias in vite/tsconfig/eslint, `manual.test.ts`, `data.test.ts` additions | `npm run typecheck`, `npm test` green |
| T4 | Section 5 engine files + `src/testkit/stats.ts` + `stats.test.ts` | all scenario tests pass; `npx eslint src/engine` clean (no forbidden imports) |
| T5 | Coverage sanity (already in `stats.test.ts`, last `describe`): every talent of every class at max rank with Arcanite Reaper + Rhok'delar → applied talent names per class equal the list in 1.6 | test passes; if generated data changes later, update the list consciously |
| T6 | Section 6: `charCode.ts`, `buildCode.ts`, test edits, golden vectors | `npm test` green; the 4 vectors pass |
| T7 | Section 7: character store, store/urlSync changes, `derived.ts`, tests | `npm test` green; manual check: `npm run dev`, the old golden link still loads |
| T8 | 8.1–8.4: layout, tokens, format, `StatValue`, `StatStrip`, `useDerived` | strip shows "400" for a Human Warrior; tooltip lists parts |
| T9 | 8.5 `CharacterPanel` (race, weapon picker, bonus, buffs, target) | manual check on desktop and a 390 px viewport; keyboard-only weapon selection works |
| T10 | 8.6 `StatsPanel` (groups, vs-target, reference table, not-modeled note) + 9.5 UI unit tests | values match 9.6 by hand |
| T11 | 9.6 Playwright (`character.spec.ts`, mobile changes) | `npm run e2e` green (desktop + mobile) |
| T12 | Section 11 docs | docs updated in the same commit as the last code change or a final docs commit |

---

## 11. Documentation updates (task T12)

- **PLAN.md**: Phase 2 status cell → ✅ (the table still says ⬜). Phase 3 → ✅ with these checkboxes ticked and reworded:
  "Class, race (Forever combos from CharBaseInfo), level 60 (engine takes level) → base stats (manual table)";
  "Weapon picker: searchable MH / OH / ranged-wand + ammo, proficiency and dual wield from SkillLineAbility";
  "Gear v1: manual bonus stats panel (v2 full item slots → Phase 7 backlog)"; "Buffs and consumables from Forever SpellEffect values,
  validated by the pipeline; Raid buffed / Raid debuffs presets (off by default)"; "Target picker + debuffs, effective armor and DR";
  replace "DPS shown against the selected target, plus a small table…" with "Per-target table (armor, DR, miss, dodge, glancing, crit,
  spell miss) vs every reference mob; DPS column is the Phase 4 hook"; "Talent stat modifiers (generic mapper over aura effects; equip
  and form requirements from SpellEquippedItems/SpellShapeshift); spell modifiers and aura 79 recorded for Phase 4";
  "Derived stats panel with breakdown tooltips; stat strip under the talent bar". Add an Output line (tests count, new data fields).
  Phase 4 gets a first checkbox "Apply recorded spell mods (107/108) and damage-done (79) modifiers; glancing damage".
- **CALC_MODEL.md**: section 2 — replace the melee/spell tables' prose with the exact formulas of 5.3 (keep [VERIFY]); note the
  crit-suppression choice (1.8% + 0.04%/skill point, Q34) and glancing 10% vs same level. Section 3 — add the AP/RAP formulas,
  Agi→crit for casters, health/mana rules, rating conversions (Q35), and the new **3b Stat aggregation order** (copy 5.2). Section 4
  talent table — add 290 (all crit), 137 misc semantics, 174, 280, 240, 123, 122, the equip/form requirement rule, and that aura 268 is
  armor-from-stat in Forever. Section 2b — custom target ranges and debuff floor at 0.
- **ARCHITECTURE.md**: generated contracts — `classes[].raceIds/weaponSubclasses/dualWield`, `Talent.effects/equipped/shapeshiftMask`,
  `Spell.equipped/shapeshiftMask`; manual files (`buffs.json` codes/groups/presets/src, `racials.json`); `@manual` alias; data loading
  (weapons lazy); `src/engine/stats` module list; the **v2 URL format** (6.1) next to v1, with golden vectors; state = two stores.
- **DATA_SOURCES.md**: new tables `SpellEquippedItems`, `CharBaseInfo` (and the refresh procedure step); findings 1.4 (buff values),
  1.5 (racials), proficiency differences, new combos, rating evidence; "world buffs have no effect in raid instances".
- **tools/pipeline/README.md**: mention the manual-value check (`effects[].src`) and `report.manualValidation`.
- **OPEN_QUESTIONS.md**: add Q33–Q46 (section 12); update Q4 (now also covers AP formulas and caster Agi→crit), Q13 (raid buffs
  default resolved: off, owner 2026-11-12), Q19 (item stats are used for weapons; unknown stat ids shown as not modeled), Q23 (aura 268
  and 674 observations), Q25 (combos resolved by CharBaseInfo; base stats still open).

---

## 12. Remaining uncertainties (add as Q33–Q46 to OPEN_QUESTIONS.md, status ❓)

| # | Question | Why it matters | How to resolve |
|---|---|---|---|
| Q33 | Base melee/ranged crit: class values from `base-stats.json` (Warrior 0, Rogue 0, Hunter 0, …) or a flat 5% for everyone (TBC-style)? | Every physical crit number (±5%) | Naked level-60 character sheet per class: crit − Agi/ratio |
| Q34 | Crit suppression vs +3 bosses: 1.8% + 0.04%/skill point (2.4% at 300 skill, implemented) or 3% (old CALC_MODEL text)? Glancing 10% vs same-level mobs? | Crit vs boss, white crit cap | Target-dummy logs (Forever has level-63 dummies?) |
| Q35 | Rating conversion at 60: 10 hit rating = 1% (also for spells?), 14 crit rating = 1%, haste 10? | Gear stats | Character sheet with/without a rating weapon |
| Q36 | Forever buff values differ from Classic (BS 139, BoM 133, SoE 53, GoA 89, PW:F 70, MotW 16, CoR 505, Expose Armor 2250; LotP/Moonkin/Slip'kik/Mongoose = all-crit aura 290; WB haste includes spells; Juju Might/RCotD/Fengus give RAP and spell power). Are client values what the server uses? | Raid-buffed numbers | In-game buff tooltips and character sheet deltas |
| Q37 | "Savage" (20574, +1% crit) is in no racial skill line; assumed Orc | Orc crit | Orc character sheet |
| Q38 | Proficiencies from data differ from Classic: Rogue one-hand axes, Druid polearms. Live? | Weapon picker | Trainer / skill sheet |
| Q39 | New race/class combos in `CharBaseInfo` (Undead Paladin, Dwarf Shaman, Human Hunter, Gnome Priest, Orc Mage, Troll Warlock): playable? Base stats = class + race offset? | Race picker, base stats | Character creation screen |
| Q40 | Wands: spell or ranged hit/crit table? Phase 3 shows wand DPS only | Caster wand DPS (Phase 4) | Wand vs target dummy |
| Q41 | Equip-restricted all-crit talents (Conviction, Thundering Strikes need a melee weapon): do they also raise spell crit, and only while the weapon is equipped? | Hybrid spell crit | Character sheet with/without a weapon |
| Q42 | Unit of `MOD_EXPERTISE` (Weapon Expertise values 1/2 = "2%"): % dodge reduction or expertise points? | Dodge vs target | In-game tooltip / testing |
| Q43 | Aura 280 (Serrated Blades "ignore 9% armor") applied as % of target armor after debuffs | Physical DR | Damage logs |
| Q44 | World buffs say "No effect while in a raid instance". Should "Raid buffed" ever include them? (Phase 3: no) | Default buff sets | Owner decision |
| Q45 | Aura enum drift: 268 is armor-from-Int (Arcane Resilience), 674 is the armor aura of Sunder/FF/MotW. `tools/pipeline/constants.py` labels 268 as attack power | Coverage report labels | Pipeline follow-up: relabel 268, add 674 to IGNORED/target handling |
| Q46 | Shields are not modeled (Bastion, Shield Slam conditions, Holy Shield) | Protection specs | Gear v2 (off-hand shield slot) |

Also still relevant from earlier phases: Q2 (spell base points), Q3/Q4 (outcome and conversion constants), Q16/Q17 (talent values),
Q18/Q19 (weapon data from the Era fallback).
