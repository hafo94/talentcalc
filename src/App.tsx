import { useState } from "react";
import { DATA_BUILD, manifest } from "@/data";
import { useCalc } from "@/state/store";
import { CharacterPanel } from "@/ui/character/CharacterPanel";
import { DamagePanel } from "@/ui/results/DamagePanel";
import { WeightsPanel } from "@/ui/results/WeightsPanel";
import { useMediaQuery } from "@/ui/common/useMediaQuery";
import { RotationEditor } from "@/ui/rotation/RotationEditor";
import { SimPanel } from "@/ui/sim/SimPanel";
import { StatsPanel } from "@/ui/stats/StatsPanel";
import { ClassPicker } from "@/ui/talents/ClassPicker";
import { TalentCalculator } from "@/ui/talents/TalentCalculator";
import styles from "./App.module.css";

type Section = "Talents" | "Gear" | "Stats" | "Damage" | "Sim";
const SECTIONS: Section[] = ["Talents", "Gear", "Stats", "Damage", "Sim"];

export function App() {
  const classToken = useCalc((s) => s.classToken);
  const status = useCalc((s) => s.status);
  const desktop = useMediaQuery("(min-width: 980px)");
  const [section, setSection] = useState<Section>("Talents");
  const notice = useCalc((s) => s.notice);
  const dismissNotice = useCalc((s) => s.dismissNotice);
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>WoW Forever Talent Calculator</h1>
      <ClassPicker />
      {notice && (
        <div className={styles.notice} role="status" data-testid="notice">
          <span>{notice}</span>
          <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={dismissNotice}>
            ×
          </button>
        </div>
      )}
      {!desktop && classToken && (
        <div className={styles.sections} role="tablist" aria-label="Sections">
          {SECTIONS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={section === name}
              className={styles.section}
              onClick={() => setSection(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {(desktop || !classToken || section === "Talents") && <TalentCalculator />}
      {classToken && status === "ready" && desktop && (
        <>
          <div className={styles.panels}>
            <CharacterPanel />
            <StatsPanel />
          </div>
          <DamagePanel />
          <WeightsPanel />
          <div className={styles.panels}>
            <RotationEditor />
            <SimPanel />
          </div>
        </>
      )}
      {classToken && status === "ready" && !desktop && section === "Gear" && <CharacterPanel />}
      {classToken && status === "ready" && !desktop && section === "Stats" && <StatsPanel />}
      {classToken && status === "ready" && !desktop && section === "Damage" && (
        <>
          <DamagePanel />
          <WeightsPanel />
        </>
      )}
      {classToken && status === "ready" && !desktop && section === "Sim" && (
        <>
          <RotationEditor />
          <SimPanel />
        </>
      )}
      <footer className={styles.footer}>
        Data: WoW Forever build {DATA_BUILD} · generated {manifest.generatedAt} · Icons and art © Blizzard
        Entertainment
      </footer>
    </div>
  );
}
