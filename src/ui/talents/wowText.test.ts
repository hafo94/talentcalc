import { describe, expect, it } from "vitest";
import { parseWowText } from "./wowText";

describe("parseWowText", () => {
  it("parses color codes and normalizes newlines", () => {
    expect(parseWowText("|CFFFF2020Requires Bear Form|R\r\nCharge")).toEqual([
      { text: "Requires Bear Form", color: "#ff2020" },
      { text: "\nCharge" },
    ]);
  });
  it("keeps plain text as one segment", () => {
    expect(parseWowText("Hello world")).toEqual([{ text: "Hello world" }]);
  });
  it("handles unterminated codes", () => {
    expect(parseWowText("|cffffffffABC")).toEqual([{ text: "ABC", color: "#ffffff" }]);
  });
  it("removes stray |r", () => {
    expect(parseWowText("A|rB")).toEqual([{ text: "AB" }]);
  });
  it("keeps unresolved tokens", () => {
    expect(parseWowText("Deals $s1 damage")).toEqual([{ text: "Deals $s1 damage" }]);
  });
});
