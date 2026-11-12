import { manifest } from "./index";

export function iconUrls(name: string): [string, string] {
  return [manifest.iconUrlTemplate.replace("{icon}", name), manifest.iconUrlFallback.replace("{icon}", name)];
}

/** Classic talent-tree background art, hotlinked from Wowhead's CDN, keyed by TalentTab ID (Q30). */
export const REMOTE_BACKGROUNDS = true;
export function specBackgroundUrl(talentTabId: number): string {
  return `https://wow.zamimg.com/images/wow/talents/backgrounds/classic/${talentTabId}.jpg`;
}

/** Fallback gradient tint per talentTabId (used under the image, and alone if it fails). */
export const SPEC_TINTS: Readonly<Record<number, string>> = {
  161: "#5a3a1e",
  164: "#6b1f12",
  163: "#3b4250", // Warrior Arms, Fury, Protection
  382: "#6b5a2a",
  383: "#3a4a6b",
  381: "#6b4a1e", // Paladin Holy, Protection, Retribution
  361: "#3f4a22",
  363: "#4a3a26",
  362: "#2e4a3a", // Hunter BM, MM, Survival
  182: "#2e4a22",
  181: "#5a2a1e",
  183: "#2a2a4a", // Rogue Assassination, Combat, Subtlety
  201: "#4a4a5a",
  202: "#6b6040",
  203: "#3a1f4a", // Priest Discipline, Holy, Shadow
  261: "#1f3a6b",
  263: "#3a4a5a",
  262: "#1f4a4a", // Shaman Elemental, Enhancement, Restoration
  81: "#3a2a6b",
  41: "#6b2a10",
  61: "#1f3a6b", // Mage Arcane, Fire, Frost
  302: "#2a4a1f",
  303: "#4a1f4a",
  301: "#6b2a1f", // Warlock Affliction, Demonology, Destruction
  283: "#2a3a5a",
  281: "#5a3a1a",
  282: "#2a4a2a", // Druid Balance, Feral Combat, Restoration
};
