import { beforeEach, describe, expect, it } from "vitest";
import { isClassToken } from "@/data";
import { pointsBySpec } from "@/engine/talents";
import { decodeBuild } from "./buildCode";
import { useCalc } from "./store";

const GOLDEN = "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N";

beforeEach(() => {
  useCalc.getState().clearClass();
  useCalc.setState({ notice: null, talentedRank: 0 });
});

describe("store", () => {
  it("selectClass loads a ready tree", async () => {
    await useCalc.getState().selectClass("mage");
    const s = useCalc.getState();
    expect(s.status).toBe("ready");
    expect(s.tree!.file.specs).toHaveLength(3);
  });

  it("applyBuildCode restores the golden build", async () => {
    const r = decodeBuild(GOLDEN, isClassToken);
    if (!r.ok) throw new Error("decode");
    await useCalc.getState().applyBuildCode(r.build);
    const s = useCalc.getState();
    expect(pointsBySpec(s.tree!, s.ranks)).toEqual([0, 33, 18]);
    expect(s.notice).toBeNull();
  });

  it("sets a notice when a build had invalid talents", async () => {
    await useCalc
      .getState()
      .applyBuildCode({ classToken: "mage", level: 60, talentedRank: 0, ranks: { 105786: 1 } });
    const s = useCalc.getState();
    expect(s.ranks).toEqual({});
    expect(s.notice).toContain("were not valid and were removed");
  });

  it("adds, removes and resets points", async () => {
    const st = useCalc.getState();
    await st.selectClass("mage");
    st.addPoint(105796);
    st.addPoint(105796);
    expect(useCalc.getState().ranks).toEqual({ 105796: 2 });
    st.removePoint(105796);
    expect(useCalc.getState().ranks).toEqual({ 105796: 1 });
    st.resetAll();
    expect(useCalc.getState().ranks).toEqual({});
  });

  it("ignores stale class loads", async () => {
    const st = useCalc.getState();
    const a = st.selectClass("mage");
    const b = st.selectClass("priest");
    await Promise.all([a, b]);
    expect(useCalc.getState().tree!.token).toBe("priest");
  });

  it("selecting another class resets ranks", async () => {
    const st = useCalc.getState();
    await st.selectClass("mage");
    st.addPoint(105796);
    await st.selectClass("priest");
    expect(useCalc.getState().ranks).toEqual({});
  });
});
