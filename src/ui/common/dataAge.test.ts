import { describe, expect, it } from "vitest";
import { OUTDATED_AFTER_DAYS, dataAgeDays } from "./dataAge";

describe("data age (footer notice)", () => {
  it("counts whole UTC days since generatedAt", () => {
    expect(dataAgeDays("2026-11-13", Date.parse("2026-11-13T23:59:00Z"))).toBe(0);
    expect(dataAgeDays("2026-11-13", Date.parse("2027-02-11T00:00:00Z"))).toBe(OUTDATED_AFTER_DAYS);
    expect(dataAgeDays("2026-11-13", Date.parse("2026-11-01T00:00:00Z"))).toBe(0);
    expect(dataAgeDays("not a date", Date.now())).toBe(0);
  });
});
