import { create } from "zustand";
import type { SimWeightsRequest, SimWeightsResult } from "@/engine/sim/weights";
import { createSimWorker, type SimWorker } from "./sim";

export interface WeightsSimState {
  status: "idle" | "running" | "done" | "cancelled" | "error";
  done: number; // simulated variants
  total: number;
  result: SimWeightsResult | null;
  error: string | null;
  key: string | null; // inputs of `result` (the panel hides a result whose inputs changed)
  run(request: SimWeightsRequest, key: string): void;
  cancel(): void;
}

let worker: SimWorker | null = null;
let requestId = 0;

/** Phase 7: simulation stat weights in their own worker (same protocol as useSim, message type "weights"). */
export const useWeightsSim = create<WeightsSimState>()((set) => ({
  status: "idle",
  done: 0,
  total: 0,
  result: null,
  error: null,
  key: null,
  run(request, key) {
    worker?.terminate();
    const id = ++requestId;
    const w = createSimWorker();
    worker = w;
    set({ status: "running", done: 0, total: Object.keys(request.patches).length, error: null });
    const finish = () => {
      w.terminate();
      if (worker === w) worker = null;
    };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.id !== id || id !== requestId) return;
      if (m.type === "progress") set({ done: m.done, total: m.total });
      else if (m.type === "weights") {
        set({ status: "done", result: m.result, key });
        finish();
      } else if (m.type === "error") {
        set({ status: "error", error: m.message });
        finish();
      }
    };
    w.onerror = (e) => {
      if (id !== requestId) return;
      set({ status: "error", error: e.message || "The simulation worker failed." });
    };
    w.postMessage({ type: "weights", id, request });
  },
  cancel() {
    requestId++;
    worker?.terminate();
    worker = null;
    set({ status: "cancelled" });
  },
}));
