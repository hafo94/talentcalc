export type ClassToken =
  | "warrior"
  | "paladin"
  | "hunter"
  | "rogue"
  | "priest"
  | "shaman"
  | "mage"
  | "warlock"
  | "druid";

export interface Manifest {
  build: string;
  eraBuild: string | null;
  generatedAt: string;
  pipelineVersion: number;
  options: { includeHiddenNodes: boolean; eraFallback: boolean };
  iconUrlTemplate: string; // contains "{icon}"
  iconUrlFallback: string; // contains "{icon}"
  rawTables: { name: string; rows: number; sha256: string }[];
  eraRawTables?: { name: string; rows: number; sha256: string }[];
  counts: Record<string, number>;
}

export interface TalentCurrencyPerk {
  nodeId: number;
  entryId: number;
  rank: number;
  spellId: number;
  name: string;
}
export interface TalentCurrencySource {
  level: number;
  amount: number;
  requirement: string;
  perk?: TalentCurrencyPerk;
}
export interface TalentCurrency {
  id: number;
  max: number;
  sources: TalentCurrencySource[];
}

export interface ClassSpecInfo {
  index: number;
  name: string;
  talentTabId: number;
  background: string;
  icon: string | null;
  iconFileId: number;
}
export interface ClassInfo {
  id: number;
  token: ClassToken;
  name: string;
  color: string;
  spellClassSet: number;
  powerType: number;
  icon: string | null;
  iconFileId: number;
  traitTreeId: number;
  skillLineIds: number[];
  specs: ClassSpecInfo[];
}
export interface RaceInfo {
  id: number;
  token: string;
  name: string;
  faction: "alliance" | "horde";
}
export interface ClassesFile {
  build: string;
  talentCurrency: TalentCurrency;
  classes: ClassInfo[];
  races: RaceInfo[];
}

export interface TalentRank {
  rank: number;
  values: number[];
  description: string;
  unresolved?: string[];
}
export interface Talent {
  nodeId: number;
  entryId: number;
  definitionId: number;
  spellId: number;
  name: string;
  icon: string | null;
  iconFileId: number;
  tier: number;
  col: number;
  maxRank: number;
  requiredPoints: number;
  prereqNodeId?: number;
  kind: "passive" | "ability";
  hidden?: true;
  valueSources: ("curve" | "base")[];
  ranks: TalentRank[];
  choices?: Omit<Talent, "tier" | "col" | "requiredPoints" | "prereqNodeId">[];
}
export interface TierGate {
  tier: number;
  requiredPoints: number;
  countedNodeIds: number[];
}
export interface Spec {
  index: number;
  name: string;
  talentTabId: number;
  specGroupId: number;
  nodeCount: number;
  maxPoints: number;
  tierGates: TierGate[];
  talents: Talent[];
}
export interface TalentFile {
  build: string;
  classId: number;
  token: ClassToken;
  traitTreeId: number;
  maxPoints: number;
  specs: Spec[];
}
