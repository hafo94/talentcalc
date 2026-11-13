// Phase 6 pet constants. Talent and spell ids are Forever data (talents/<class>.json, pets/<owner>.json); the
// server-side numbers (base stats, owner scaling, focus) are in data/manual/pets.json ([VERIFY], Q5, Q69-Q73).

/** Owner talents the pet engine models (ids of talents/<class>.json). */
export const PET_TALENT = {
  /** Hunter BM, DUMMY: "Increases all damage you and your pet deal by x% while your pet is active" (values[0]). */
  FOCUSED_FIRE: 1223755,
  /** Hunter BM ability: auras on the pet (target 5), aura 79 +50% damage for 18 s (a pet burst in the simulator). */
  BESTIAL_WRATH: 19574,
  /** Warlock Demonology, DUMMY values [imp, voidwalker, succubus, felhunter]: the demon's aura in pets.json. */
  MASTER_DEMONOLOGIST: 23785,
  /** Warlock ability: Soul Link aura (pets.json soulLink) "both the Demon and the master inflict 3% more damage". */
  SOUL_LINK: 19028,
  /** Warlock, DUMMY: "spell damage ... by up to x% of your level while you have a summoned Demon" (values[0]). */
  DEMONIC_KNOWLEDGE: 412732,
  /** Warlock ability: sacrifice the demon for its buff (pets.json sacrifice). */
  DEMONIC_SACRIFICE: 18788,
  /** Warlock: "Your Demonic Sacrifice effect is no longer cancelled by summoning a different Demon pet". */
  DEMONIC_PACT: 425464,
} as const;
export const PET_TALENT_IDS: ReadonlySet<number> = new Set(Object.values(PET_TALENT));

/** Race key of the pet's own base-stat table (computeCharacter input; the class key is the owner's). */
export const PET_RACE = "PET";
/** Level of data/manual/pets.json owners.*.base (the file's `level`); below it petBaseAt interpolates (Phase 7). */
export const PET_BASE_LEVEL = 60;
/** Item subclass of the pet's synthetic weapon (13 fist weapon: no normalized-speed rule applies). */
export const PET_WEAPON_SUBCLASS = 13;
/** Effects that apply an aura to the pet: 6 apply aura, 35 party aura, 65 raid aura, 119 pet area aura, 143 owner area aura. */
export const PET_AURA_EFFECTS: ReadonlySet<number> = new Set([6, 35, 65, 119, 143]);
export const TARGET_CASTER = 1;
export const TARGET_PET = 5;
/** Aura 110 MOD_POWER_REGEN_PERCENT; misc[0] 2 = focus (passive 19589, modified by Bestial Discipline). */
export const AURA_POWER_REGEN_PCT = 110;
export const POWER_FOCUS = 2;
/** Aura 42 PROC_TRIGGER_SPELL (passive 20784 -> Frenzy 19615); SpellModOp 18 = proc chance (talent Frenzy). */
export const AURA_PROC_TRIGGER = 42;
export const OP_PROC_CHANCE = 18;
/** Aura 79 MOD_DAMAGE_PERCENT_DONE. */
export const AURA_DAMAGE_DONE = 79;
/** RNG stream of the pet: iteration seeds are mixed with this value, so the player's stream is unchanged. */
export const PET_STREAM = 0x50455431;
