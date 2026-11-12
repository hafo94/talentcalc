import { DATA_BUILD, manifest } from "@/data";
import { useCalc } from "@/state/store";
import { ClassPicker } from "@/ui/talents/ClassPicker";
import { TalentCalculator } from "@/ui/talents/TalentCalculator";
import styles from "./App.module.css";

export function App() {
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
      <TalentCalculator />
      <footer className={styles.footer}>
        Data: WoW Forever build {DATA_BUILD} · generated {manifest.generatedAt} · Icons and art © Blizzard
        Entertainment
      </footer>
    </div>
  );
}
