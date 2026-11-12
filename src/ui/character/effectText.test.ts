import { describe, expect, it } from "vitest";
import { buffsFile } from "@/data";
import { effectsSummary } from "./effectText";

const summary = (id: string) => effectsSummary(buffsFile.buffs.find((b) => b.id === id)!.effects);

describe("effect summaries", () => {
  it("describes buffs", () => {
    expect(summary("battle_shout")).toBe("+139 melee AP");
    expect(summary("blessing_of_kings")).toBe("+10% all stats");
    expect(summary("elixir_of_shadow_power")).toBe("+40 shadow spell power");
    expect(summary("sunder_armor")).toBe("−2250 armor");
    expect(summary("curse_of_the_elements")).toBe("−75 magic resistance, +10% magic damage taken");
  });
});
