/** Phase 7: the footer warns when the generated data is older than this (Forever ships client builds often). */
export const OUTDATED_AFTER_DAYS = 90;

/** Whole days between manifest.generatedAt (YYYY-MM-DD, UTC) and `now` (ms); 0 for a bad date. */
export function dataAgeDays(generatedAt: string, now: number): number {
  const t = Date.parse(`${generatedAt}T00:00:00Z`);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : 0;
}
