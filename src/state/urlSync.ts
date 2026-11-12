import { isClassToken } from "@/data";
import { decodeBuild, encodeBuild } from "./buildCode";
import { useCalc } from "./store";

/** Keeps location.hash and the store in sync. Call once before the first render. */
export function initUrlSync(): void {
  let lastHash = "";

  const apply = (hash: string) => {
    const r = decodeBuild(hash, isClassToken);
    if (r.ok) void useCalc.getState().applyBuildCode(r.build);
    else if (r.reason !== "empty") useCalc.setState({ notice: `This link could not be read (${r.reason}).` });
  };

  lastHash = location.hash;
  apply(location.hash);
  window.addEventListener("hashchange", () => {
    if (location.hash !== lastHash) {
      lastHash = location.hash;
      apply(location.hash);
    }
  });

  useCalc.subscribe((s) => {
    if (s.status === "loading") return;
    const next = s.classToken
      ? encodeBuild({
          classToken: s.classToken,
          level: s.level,
          talentedRank: s.talentedRank,
          ranks: s.ranks,
        })
      : "";
    if (next === lastHash) return;
    lastHash = next;
    history.replaceState(null, "", next || location.pathname + location.search);
  });
}
