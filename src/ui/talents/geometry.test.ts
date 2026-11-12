import { describe, expect, it } from "vitest";
import { arrowPath, nodeBox } from "./geometry";

describe("geometry", () => {
  it("nodeBox", () => {
    expect(nodeBox(1, 0)).toMatchObject({ left: 34, top: 24 });
    expect(nodeBox(7, 3)).toMatchObject({ left: 226, top: 384 });
  });
  it("vertical arrow", () => {
    expect(arrowPath({ tier: 5, col: 1 }, { tier: 7, col: 1 })).toEqual({
      shaft: "M 118 304 V 376",
      head: "111,376 125,376 118,384",
    });
  });
  it("horizontal arrow", () => {
    expect(arrowPath({ tier: 3, col: 2 }, { tier: 3, col: 3 })).toEqual({
      shaft: "M 202 164 H 218",
      head: "218,157 218,171 226,164",
    });
  });
  it("L-shaped arrow", () => {
    expect(arrowPath({ tier: 1, col: 0 }, { tier: 2, col: 1 })).toEqual({
      shaft: "M 74 44 H 118 V 76",
      head: "111,76 125,76 118,84",
    });
  });
});
