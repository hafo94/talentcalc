const MINUS = "−";

const noNegZero = (s: string): string => (/^-0(\.0+)?$/.test(s) ? s.slice(1) : s);

/** Stats, AP, SP, health, mana, armor. */
export const fmtInt = (n: number): string => noNegZero(String(Math.round(n)));
/** Crit, hit, miss, dodge, haste, damage reduction. */
export const fmtPct = (n: number): string => noNegZero(n.toFixed(2)) + "%";
/** DPS and per-swing damage. */
export const fmtDec1 = (n: number): string => noNegZero(n.toFixed(1));
/** Weapon speed. */
export const fmtDec2 = (n: number): string => noNegZero(n.toFixed(2));

/** "+x" for positive values, "−x" for negative ones (U+2212), never "-0". */
export function fmtSigned(n: number, f: (n: number) => string): string {
  const abs = f(Math.abs(n));
  const zero = !/[1-9]/.test(abs);
  return (n < 0 && !zero ? MINUS : "+") + abs;
}
