import { create } from "zustand";
import { classesFile, getClassInfo, loadClassSpells, loadTalentFile } from "@/data";
import type { ClassSpellFile, ClassToken } from "@/data/types";
import {
  addPoint as addPointRule,
  buildClassTree,
  removePoint as removePointRule,
  resetAll as resetAllRule,
  resetSpec as resetSpecRule,
  sanitize,
  type ClassTree,
  type PointsContext,
  type Ranks,
} from "@/engine/talents";
import type { BuildCode } from "./buildCode";
import { useCharacter } from "./character";

export interface CalcState {
  classToken: ClassToken | null;
  tree: ClassTree | null;
  spells: ClassSpellFile | null; // spells/<class>.json, loaded with the talent file (Phase 4)
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  notice: string | null;
  level: number;
  talentedRank: number;
  ranks: Ranks;
  activeSpec: number;
  selectClass(token: ClassToken): Promise<void>;
  applyBuildCode(code: BuildCode): Promise<void>;
  clearClass(): void;
  addPoint(nodeId: number): void;
  removePoint(nodeId: number): void;
  resetSpec(specIndex: number): void;
  resetAll(): void;
  setTalented(on: boolean): void;
  setActiveSpec(i: number): void;
  dismissNotice(): void;
}

export const pointsContext = (s: Pick<CalcState, "level" | "talentedRank">): PointsContext => ({
  level: s.level,
  talentedRank: s.talentedRank,
  currency: classesFile.talentCurrency,
});

let requestId = 0;

async function loadTree(token: ClassToken): Promise<{ tree: ClassTree; spells: ClassSpellFile }> {
  const [file, spells] = await Promise.all([loadTalentFile(token), loadClassSpells(token)]);
  return { tree: buildClassTree(file, getClassInfo(token)), spells };
}

export const useCalc = create<CalcState>()((set, get) => ({
  classToken: null,
  tree: null,
  spells: null,
  status: "idle",
  error: null,
  notice: null,
  level: 60,
  talentedRank: 0,
  ranks: {},
  activeSpec: 0,
  async selectClass(token) {
    if (get().classToken === token && get().status !== "error") return;
    const id = ++requestId;
    set({ classToken: token, status: "loading", error: null });
    try {
      const [{ tree, spells }, charOk] = await Promise.all([
        loadTree(token),
        useCharacter.getState().fitToClass(token, get().level),
      ]);
      if (id !== requestId) return;
      set({
        tree,
        spells,
        status: "ready",
        ranks: {},
        activeSpec: 0,
        notice: charOk ? null : "Some equipped weapons cannot be used by this class and were removed.",
      });
    } catch (e) {
      if (id !== requestId) return;
      set({ tree: null, spells: null, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },
  async applyBuildCode(code) {
    const id = ++requestId;
    set({ classToken: code.classToken, status: "loading", error: null });
    try {
      const [{ tree, spells }, charOk] = await Promise.all([
        loadTree(code.classToken),
        useCharacter.getState().applyCode(code.character, code.classToken, code.level),
      ]);
      if (id !== requestId) return;
      const ctx = pointsContext({ level: code.level, talentedRank: code.talentedRank });
      const { ranks, dropped } = sanitize(tree, code.ranks, ctx);
      set({
        tree,
        spells,
        status: "ready",
        level: code.level,
        talentedRank: code.talentedRank,
        ranks,
        activeSpec: 0,
        notice:
          [
            dropped ? "Some talents in this link were not valid and were removed." : "",
            charOk ? "" : "Some character settings in this link were not valid and were removed.",
          ]
            .filter(Boolean)
            .join(" ") || null,
      });
    } catch (e) {
      if (id !== requestId) return;
      set({ tree: null, spells: null, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },
  clearClass() {
    requestId++;
    set({
      classToken: null,
      tree: null,
      spells: null,
      status: "idle",
      error: null,
      ranks: {},
      activeSpec: 0,
    });
  },
  addPoint(nodeId) {
    const s = get();
    if (!s.tree) return;
    const next = addPointRule(s.tree, s.ranks, nodeId, pointsContext(s));
    if (next !== s.ranks) set({ ranks: next });
  },
  removePoint(nodeId) {
    const s = get();
    if (!s.tree) return;
    const next = removePointRule(s.tree, s.ranks, nodeId);
    if (next !== s.ranks) set({ ranks: next });
  },
  resetSpec(specIndex) {
    const s = get();
    if (s.tree) set({ ranks: resetSpecRule(s.tree, s.ranks, specIndex) });
  },
  resetAll() {
    set({ ranks: resetAllRule() });
  },
  setTalented(on) {
    const s = get();
    const talentedRank = on ? 5 : 0;
    if (!s.tree) return set({ talentedRank });
    const { ranks } = sanitize(s.tree, s.ranks, pointsContext({ level: s.level, talentedRank }));
    set({ talentedRank, ranks });
  },
  setActiveSpec(i) {
    set({ activeSpec: Math.max(0, Math.min(2, i)) });
  },
  dismissNotice() {
    set({ notice: null });
  },
}));
