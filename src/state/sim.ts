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
