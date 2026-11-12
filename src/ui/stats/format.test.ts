import { describe, expect, it } from "vitest";
import { fmtDec1, fmtInt, fmtPct, fmtSigned } from "./format";

describe("stat formatting", () => {
  it("formats numbers", () => {
    expect(fmtPct(2.6000000000000005)).toBe("2.60%");
    expect(fmtPct(7.888125942053257)).toBe("7.89%");
    expect(fmtInt(1129.8)).toBe("1130");
    expect(fmtDec1(86.81578947)).toBe("86.8");
  });
  it("signs values and never shows negative zero", () => {
    expect(fmtSigned(-0.6, fmtPct)).toBe("−0.60%");
    expect(fmtSigned(0, fmtInt)).toBe("+0");
    expect(fmtSigned(-0.001, fmtPct)).toBe("+0.00%");
    expect(fmtInt(-0.2)).toBe("0");
    expect(fmtPct(-0)).toBe("0.00%");
  });
});
