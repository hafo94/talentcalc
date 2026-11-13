"""Pipeline constants. Anything not confirmed in game is tagged [VERIFY] with its source."""
import re

BUILD_DEFAULT = "1.60.1.70888"
ERA_BUILD_DEFAULT = "1.15.9.70576"
PIPELINE_VERSION = 4

# (ChrClasses.ID, token, TraitTreeID, ClassMask). Verified against SkillLineXTraitTree + SkillLineAbility.
CLASS_TREES = [
    (1, "WARRIOR", 1117, 1),
    (2, "PALADIN", 1100, 2),
    (3, "HUNTER", 1091, 4),
    (4, "ROGUE", 1111, 8),
    (5, "PRIEST", 1114, 16),
    (7, "SHAMAN", 1082, 64),
    (8, "MAGE", 1112, 128),
    (9, "WARLOCK", 1116, 256),
    (11, "DRUID", 1089, 1024),
]
# Trees to ignore: drafts and Legacy (account-wide perks)
IGNORED_TREES = {1058, 1066, 1081, 1083, 1118, 1187, 1188, 1189}

TALENT_CURRENCY_ID = 3820
TALENT_CURRENCY_MAX = 51

# PosX of column 0 per spec index (verified for all 27 specs); columns are 600 units apart.
SPEC_BASE_X = [1020, 5020, 9080]
COL_STEP = 600
# PosY of tier 1 is 2130; rows are 600 apart. Only used for a consistency warning.
ROW_BASE_Y = 2130
ROW_STEP = 600

# Safety net if the twin rule can no longer resolve a typo'd PosX.
# 104982 Lightning Reflexes: PosX 102800 is a x10 typo of 10280; flag-8 twin 110859 sits at (10280, 5130) -> col 2.
# 105865 Holy Specialization: bad PosX; flag-8 twin 110855 sits at (6220, 2130) -> col 2.
POSITION_OVERRIDES = {
    104982: {"col": 2},
    105865: {"col": 2},
}

SPEC_GATE_POINTS = 30
VALID_GATES = {0, 5, 10, 15, 20, 25, 30}
NODE_FLAG_HIDDEN = 8

# ---- Spell constants ----
SPEC_SKILL_LINE_CATEGORY = 7
SPEC_SKILL_LINE_FLAGS = {1040, 66576}
ACQUIRE_RUNE = 3  # SoD rune-granted spells
# ---- Weapon proficiencies (Phase 3) ----
# Weapon skill lines (SkillLine.CategoryID 6) -> Item.SubclassID of class-2 weapons. Which classes can learn a
# line comes from SkillLineAbility.ClassMask (AcquireMethod != 3); it agrees with SkillRaceClassInfo for 70888.
WEAPON_SKILL_SUBCLASSES = {
    44: [0], 172: [1], 45: [2], 46: [3], 54: [4], 160: [5], 229: [6], 43: [7], 55: [8],
    136: [10], 473: [13], 173: [15], 176: [16], 226: [18], 228: [19],
}
DUAL_WIELD_SKILL_LINE = 118

POWER_RAGE = 1
ATTR0_PASSIVE = 0x40
ATTR1_CHANNELED = 0x44  # SPELL_ATTR1_CHANNELED_1 (0x4) | _2 (0x40)  [VERIFY]
AURA_OVERRIDE_ACTIONBAR = 332
# Phase 4: a Seal's judgement is not an EffectTriggerSpell; the seal (and the "Judgement of X" dummy spell) store the spell id
# in the base points of a DUMMY effect (Effect 3, or Effect 6 + Aura 4). Follow those ids only when the target spell is named
# "Judgement of ..." (other DUMMY base points are plain numbers that can collide with spell ids, e.g. Seal of Fury -> 707).
EFFECT_DUMMY = 3
AURA_DUMMY = 4
JUDGEMENT_PARENT_PREFIXES = ("Seal of ", "Judgement of ")
JUDGEMENT_CHILD_PREFIX = "Judgement of "

# ---- Coverage classification (modern aura enum; names uncertain tagged [VERIFY]) ----
APPLY_AURA_EFFECTS = {6, 35, 65, 119, 128, 129, 143}
GENERIC_AURAS = {
    13,   # MOD_DAMAGE_DONE
    29,   # MOD_STAT
    52,   # MOD_WEAPON_CRIT_PERCENT
    54,   # MOD_HIT_CHANCE
    55,   # MOD_SPELL_HIT_CHANCE
    57,   # MOD_SPELL_CRIT_CHANCE
    65,   # MOD_CASTING_SPEED_NOT_STACK
    79,   # MOD_DAMAGE_PERCENT_DONE
    85,   # MOD_POWER_REGEN
    99,   # MOD_ATTACK_POWER
    107,  # ADD_FLAT_MODIFIER
    108,  # ADD_PCT_MODIFIER
    110,  # MOD_POWER_REGEN_PERCENT
    122,  # MOD_OFFHAND_DAMAGE_PCT  [VERIFY]
    123,  # MOD_TARGET_RESISTANCE
    124,  # MOD_RANGED_ATTACK_POWER
    134,  # MOD_MANA_REGEN_INTERRUPT
    137,  # MOD_TOTAL_STAT_PERCENTAGE
    166,  # MOD_ATTACK_POWER_PCT
    174,  # MOD_SPELL_DAMAGE_OF_STAT_PERCENT
    240,  # MOD_EXPERTISE  [VERIFY]
    268,  # MOD_ATTACK_POWER_OF_STAT_PERCENT
    271,  # MOD_DAMAGE_PERCENT_TAKEN_FROM_CASTER  [VERIFY]
    290,  # MOD_CRIT_PCT  [VERIFY]
    3,    # PERIODIC_DAMAGE
    53,   # PERIODIC_LEECH
}
IGNORED_AURAS = {5, 8, 10, 12, 17, 22, 26, 27, 31, 33, 34, 39, 43, 47, 49, 51, 61, 69, 77, 87,
                 118, 133, 136, 142, 154, 172, 175, 178, 185, 186, 232, 466}
SPECIAL_AURAS = {
    4,    # DUMMY
    42,   # PROC_TRIGGER_SPELL
    231,  # PROC_TRIGGER_SPELL_WITH_VALUE
    226,  # PERIODIC_DUMMY
    332,  # OVERRIDE_ACTIONBAR_SPELLS  [VERIFY]
    109,  # ADD_TARGET_TRIGGER
    36,   # MOD_SHAPESHIFT
}
DAMAGE_EFFECTS = {2, 17, 31, 58, 121}
IGNORED_EFFECTS = {10, 30, 28, 32, 36, 38, 96, 1}  # heal, energize, summon, learn, dispel, charge, instakill
SPECIAL_EFFECTS = {3, 64, 77}  # dummy, trigger spell, script

# ---- Items ----
STAT_NAMES = {
    0: "mana", 1: "health", 3: "agility", 4: "strength", 5: "intellect", 6: "spirit", 7: "stamina",
    12: "defense_rating", 13: "dodge_rating", 14: "parry_rating", 15: "block_rating",
    31: "hit_rating", 32: "crit_rating", 36: "haste_rating", 37: "expertise_rating",
    38: "attack_power", 39: "ranged_attack_power", 41: "spell_healing", 42: "spell_damage",
    43: "mana_regen", 45: "spell_power", 46: "health_regen", 47: "spell_penetration",
    48: "block_value", 50: "bonus_armor", 51: "fire_resistance", 52: "frost_resistance",
    53: "holy_resistance", 54: "shadow_resistance", 55: "nature_resistance", 56: "arcane_resistance",
}
# Era Resistances_1..6 -> stat id
ERA_RESISTANCE_STAT = {1: 53, 2: 51, 3: 55, 4: 52, 5: 54, 6: 56}

WEAPON_TYPE_NAMES = {
    0: "axe1h", 1: "axe2h", 2: "bow", 3: "gun", 4: "mace1h", 5: "mace2h", 6: "polearm",
    7: "sword1h", 8: "sword2h", 10: "staff", 13: "fist", 15: "dagger", 16: "thrown",
    17: "spear", 18: "crossbow", 19: "wand",
}
EXCLUDED_WEAPON_SUBCLASSES = {14, 20}  # misc, fishing pole
WEAPON_NAME_FILTER = re.compile(r"(?i)(^monster - |\btest\b|deprecated|\[ph\]|\(old\)|^jeff |^twain )")
ITEM_FLAG2_CASTER_WEAPON = 0x200

# InventoryType values
INV_RANGED = 15
INV_ONE_HAND = 13
INV_TWO_HAND = 17
INV_MAIN_HAND = 21
INV_OFF_HAND = 22
INV_THROWN = 25
INV_RANGED_RIGHT = 26
INV_AMMO = 24
# RandPropPoints slot index by inventory type
RPP_SLOT = {17: 0, 13: 3, 21: 3, 22: 3, 15: 4, 25: 4, 26: 4}

# ---- Icons ----
ICON_URL_TEMPLATE = "https://render.worldofwarcraft.com/us/icons/56/{icon}.jpg"
ICON_URL_FALLBACK = "https://wow.zamimg.com/images/wow/icons/large/{icon}.jpg"

# ---- Races (v1: IDs 1-8). Alliance column: 0 = alliance, 1 = horde ----
RACES_V1 = [1, 2, 3, 4, 5, 6, 7, 8]

# ---- Targets ----
ARMOR_FORMULA = {"base": 400, "perLevel": 85, "cap": 0.75}
TARGET_MAX_LEVEL = 63
PLAYER_MAX_LEVEL = 60
TARGET_PRESETS = [
    {"id": "boss", "label": "Boss", "levelOffset": 3, "armorMultiplier": 1.0, "default": True},
    {"id": "elite", "label": "Elite", "levelOffset": 2, "armorMultiplier": 1.0},
    {"id": "same", "label": "Same-level mob", "levelOffset": 0, "armorMultiplier": 1.0},
    {"id": "lowArmorBoss", "label": "Low-armor boss", "levelOffset": 3, "armorMultiplier": 0.5,
     "note": "[tune] armor halved"},
    {"id": "custom", "label": "Custom", "levelOffset": 3, "armorMultiplier": 1.0, "editable": True},
]

# ---- Pets (Phase 6) ----
# Passive pet scaling auras in each family's skill line ("Hunter Pet Scaling", "Warlock Pet Scaling"; base points 0,
# values are server-side): they mark the owner class of a CreatureFamily.
PET_SCALING_SPELLS = {415429: "hunter", 416189: "warlock"}
