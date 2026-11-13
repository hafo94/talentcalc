import { describe, expect, it } from "vitest";
import { createRng, iterationSeed, splitmix32 } from "./rng";
import { EventQueue } from "./queue";

describe("seeded RNG (sfc32 + splitmix32)", () => {
  it("golden outputs (cross-checked with an independent Python implementation, section 8.1)", () => {
    const r = createRng(1);
    expect([r(), r(), r()]).toEqual([0.4256499295588583, 0.79042171058245, 0.6910148127935827]);
    const s = splitmix32(0);
    expect([s(), s()]).toEqual([2462723854, 1020716019]);
    expect([iterationSeed(1, 0), iterationSeed(1, 1), iterationSeed(42, 7)]).toEqual([
      3356300964, 31759070, 3155100672,
    ]);
  });
  it("same seed, same stream; values in [0, 1) with mean 0.5", () => {
    const a = createRng(123);
    const b = createRng(123);
    let sum = 0;
    for (let i = 0; i < 100000; i++) {
      const x = a();
      expect(x).toBe(b());
      if (x < 0 || x >= 1) throw new Error(`out of range: ${x}`);
      sum += x;
    }
    expect(sum / 100000).toBeCloseTo(0.5, 2);
    expect(createRng(124)()).not.toBe(createRng(123)());
  });
});

describe("event queue", () => {
  it("pops by time, then by insertion order", () => {
    const q = new EventQueue();
    q.push(2, 1, 10);
    q.push(1, 1, 20);
    q.push(2, 1, 30);
    q.push(0.5, 1, 40);
    q.push(1, 1, 50);
    expect(q.peekTime()).toBe(0.5);
    const out: number[] = [];
    for (let e = q.pop(); e; e = q.pop()) out.push(e.a);
    expect(out).toEqual([40, 20, 50, 10, 30]);
    expect(q.size).toBe(0);
    expect(q.peekTime()).toBe(Infinity);
  });
  it("1000 random events come out sorted", () => {
    const q = new EventQueue();
    const r = createRng(9);
    for (let i = 0; i < 1000; i++) q.push(Math.floor(r() * 100), 0, i);
    let last = { t: -1, a: -1 };
    for (let e = q.pop(); e; e = q.pop()) {
      expect(e.t > last.t || (e.t === last.t && e.a > last.a)).toBe(true);
      last = e;
    }
  });
});
