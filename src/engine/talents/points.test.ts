import { describe, expect, it } from "vitest";
import { classesFile } from "@/data";
import { availablePoints, requiredLevel } from "./points";

const currency = classesFile.talentCurrency;

describe("availablePoints", () => {
  const cases: [number, number, number][] = [
    [60, 0, 51],
    [60, 5, 51],
    [55, 0, 46],
    [55, 5, 51],
    [54, 5, 50],
    [30, 0, 21],
    [30, 5, 26],
    [10, 0, 1],
    [9, 0, 0],
    [9, 5, 5],
    [5, 5, 1],
    [4, 5, 0],
    [7, 2, 0],
    [7, 3, 1],
    [1, 0, 0],
  ];
  it.each(cases)("level %i, talentedRank %i -> %i", (level, talentedRank, expected) => {
    expect(availablePoints({ level, talentedRank, currency })).toBe(expected);
  });
});

describe("requiredLevel", () => {
  const cases: [number, number, number | null][] = [
    [0, 0, null],
    [1, 0, 10],
    [31, 0, 40],
    [51, 0, 60],
    [52, 0, null],
    [1, 5, 5],
    [5, 5, 9],
    [6, 5, 10],
    [51, 5, 55],
    [1, 2, 8],
    [2, 2, 9],
    [3, 2, 10],
  ];
  it.each(cases)("spent %i, talentedRank %i -> %s", (spent, rank, expected) => {
    expect(requiredLevel(spent, rank, currency)).toBe(expected);
  });
  it("is 9 + spent without the perk", () => {
    for (let s = 1; s <= 51; s++) expect(requiredLevel(s, 0, currency)).toBe(9 + s);
  });
});
