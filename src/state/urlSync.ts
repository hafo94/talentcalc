import { isClassToken } from "@/data";
import { decodeBuild, encodeBuild } from "./buildCode";
import { useCharacter } from "./character";
import { joinHash, splitHash, useCompare } from "./compare";
import { catalogFor, useRotation } from "./rotation";
import { useCalc } from "./store";

/** Keeps location.hash and the store in sync. Call once before the first render. */
export function initUrlSync(): void {
  let lastHash = "";
  let applying = false; // a link being applied must not write the previous state back to the URL

  const apply = (hash: string) => {
    // Phase 7: "#<build>~<pinned build>" (compare); links without "~" are unchanged.
    const { build, pinned } = splitHash(hash);
    const pinOk = pinned === null || decodeBuild(pinned, isClassToken).ok;
    applying = true;
    useCompare.setState({ pinned: pinOk ? pinned : null });
    applying = false;
    const r = decodeBuild(build, isClassToken);
    if (r.ok) void useCalc.getState().applyBuildCode(r.build);
    else if (r.reason !== "empty") useCalc.setState({ notice: `This link could not be read (${r.reason}).` });
    if (!pinOk) useCalc.setState({ notice: "The pinned build (A) in this link could not be read." });
  };

  lastHash = location.hash;
  apply(location.hash);
  window.addEventListener("hashchange", () => {
    if (location.hash !== lastHash) {
      lastHash = location.hash;
      apply(location.hash);
    }
  });

  const write = () => {
    const s = useCalc.getState();
    if (applying || s.status === "loading") return;
    const build = s.classToken
      ? encodeBuild({
          classToken: s.classToken,
          level: s.level,
          talentedRank: s.talentedRank,
          ranks: s.ranks,
          character: {
            ...useCharacter.getState().toCode(s.classToken),
            ...(s.spells && s.tree ? useRotation.getState().toCode(catalogFor(s.spells, s.tree)) : {}),
          },
        })
      : "";
    const next = joinHash(build, useCompare.getState().pinned);
    if (next === lastHash) return;
    lastHash = next;
    history.replaceState(null, "", next || location.pathname + location.search);
  };
  useCalc.subscribe(write);
  useCharacter.subscribe(write);
  useRotation.subscribe(write);
  useCompare.subscribe(write);
}
