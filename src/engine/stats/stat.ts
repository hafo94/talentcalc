export type SourceKind =
  | "base"
  | "race"
  | "racial"
  | "gear"
  | "weapon"
  | "buff"
  | "debuff"
  | "talent"
  | "conversion"
  | "rule";
export interface Part {
  label: string;
  kind: SourceKind;
  value: number;
}
/** A derived number and where it comes from. Invariant: value === sum of parts.value. */
export interface Stat {
  value: number;
  parts: Part[];
}

export function makeStat(parts: Part[]): Stat {
  const kept = parts.filter((p, i) => i === 0 || p.value !== 0);
  return { value: kept.reduce((a, p) => a + p.value, 0), parts: kept };
}

/** Multiplies by (1 + pct/100) for each modifier in order; each step is recorded as its own part. */
export function applyPct(s: Stat, mods: readonly { label: string; kind: SourceKind; value: number }[]): Stat {
  let value = s.value;
  const parts = [...s.parts];
  for (const m of mods) {
    const inc = (value * m.value) / 100;
    if (inc === 0) continue;
    parts.push({ label: `${m.label} ${m.value > 0 ? "+" : ""}${m.value}%`, kind: m.kind, value: inc });
    value += inc;
  }
  return { value, parts };
}

export const ZERO: Stat = { value: 0, parts: [] };
