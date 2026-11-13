import { describe, expect, it } from "vitest";
import type { SimRequest, SimResponse, SimResult } from "@/engine/sim/types";
import { DEFAULT_SIM_CONFIG } from "@/engine/sim/types";
import { simInput } from "@/testkit/sim";
import { setSimWorkerFactory, useSim, type SimWorker } from "./sim";

class FakeWorker implements SimWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<SimResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: SimRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(m: SimRequest) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(m: SimResponse) {
    this.onmessage?.({ data: m } as MessageEvent<SimResponse>);
  }
}

describe("simulation client (worker protocol, section 4.7)", () => {
  setSimWorkerFactory(() => new FakeWorker());
  const input = simInput({ classToken: "mage", race: "HUMAN", rotation: "mage-frost" });
  const config = { ...DEFAULT_SIM_CONFIG, iterations: 100 };
  it("progress, then result; the worker is terminated", () => {
    useSim.getState().run(input, config, "k1");
    const w = FakeWorker.all.at(-1)!;
    const id = w.sent[0]!.id;
    expect(useSim.getState()).toMatchObject({ status: "running", done: 0, total: 100 });
    w.reply({ type: "progress", id, done: 50, total: 100 });
    expect(useSim.getState().done).toBe(50);
    const result = { config } as SimResult;
    w.reply({ type: "result", id, result });
    expect(useSim.getState()).toMatchObject({ status: "done", result, key: "k1" });
    expect(w.terminated).toBe(true);
  });
  it("cancel terminates the worker and ignores late messages; a new run replaces the old one", () => {
    useSim.getState().run(input, config, "k2");
    const w = FakeWorker.all.at(-1)!;
    useSim.getState().cancel();
    expect(w.terminated).toBe(true);
    w.reply({ type: "result", id: w.sent[0]!.id, result: { config } as SimResult });
    expect(useSim.getState()).toMatchObject({ status: "cancelled", key: "k1" });
    useSim.getState().run(input, config, "k3");
    const a = FakeWorker.all.at(-1)!;
    useSim.getState().run(input, config, "k4");
    expect(a.terminated).toBe(true);
    const b = FakeWorker.all.at(-1)!;
    b.reply({ type: "error", id: b.sent[0]!.id, message: "boom" });
    expect(useSim.getState()).toMatchObject({ status: "error", error: "boom" });
  });
});
