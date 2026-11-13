/** One scheduled event. `a`/`b` carry indices or generations; their meaning depends on `type` (engine.ts EV). */
export interface SimEvent {
  t: number;
  seq: number;
  type: number;
  a: number;
  b: number;
}

/**
 * Binary min-heap ordered by (time, insertion sequence): events at the same time fire in the order they were scheduled,
 * which keeps runs deterministic.
 */
export class EventQueue {
  private heap: SimEvent[] = [];
  private seq = 0;

  get size(): number {
    return this.heap.length;
  }

  push(t: number, type: number, a = 0, b = 0): void {
    const e: SimEvent = { t, seq: this.seq++, type, a, b };
    const h = this.heap;
    h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(e, h[p]!)) break;
      h[i] = h[p]!;
      i = p;
    }
    h[i] = e;
  }

  pop(): SimEvent | undefined {
    const h = this.heap;
    const top = h[0];
    const last = h.pop();
    if (!top || !last || h.length === 0) return top;
    let i = 0;
    const n = h.length;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && before(h[r]!, h[l]!) ? r : l;
      if (!before(h[c]!, last)) break;
      h[i] = h[c]!;
      i = c;
    }
    h[i] = last;
    return top;
  }

  peekTime(): number {
    return this.heap[0]?.t ?? Infinity;
  }

  clear(): void {
    this.heap.length = 0;
    this.seq = 0;
  }
}

const before = (x: SimEvent, y: SimEvent) => x.t < y.t || (x.t === y.t && x.seq < y.seq);
