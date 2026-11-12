import { classesFile } from "@/data";
import { useCalc } from "@/state/store";
import { WowIcon } from "@/ui/common/WowIcon";
import styles from "./ClassPicker.module.css";

const sorted = [...classesFile.classes].sort((a, b) => a.name.localeCompare(b.name));

export function ClassPicker() {
  const selected = useCalc((s) => s.classToken);
  const selectClass = useCalc((s) => s.selectClass);
  return (
    <div className={styles.picker} role="group" aria-label="Class">
      {sorted.map((c) => (
        <button
          key={c.token}
          type="button"
          className={styles.btn}
          aria-pressed={selected === c.token}
          aria-label={c.name}
          title={c.name}
          onClick={() => void selectClass(c.token)}
        >
          <WowIcon name={c.icon} size={40} />
        </button>
      ))}
    </div>
  );
}
