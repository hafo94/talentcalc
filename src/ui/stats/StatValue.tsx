import { useId, useRef, useState } from "react";
import type { Stat } from "@/engine/stats";
import { fmtSigned } from "./format";
import styles from "./StatValue.module.css";

interface Props {
  stat: Stat;
  format: (n: number) => string;
  label: string;
  testId: string;
}

/** A derived number; hover, focus or tap shows where it comes from (the parts of the Stat). */
export function StatValue({ stat, format, label, testId }: Props) {
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(300, window.innerWidth - 16);
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: r.bottom + 4,
    });
  };
  const close = () => setPos(null);

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={styles.value}
        data-testid={testId}
        aria-describedby={pos ? id : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      >
        {format(stat.value)}
      </button>
      {pos && (
        <div role="tooltip" id={id} className={styles.tooltip} style={{ left: pos.left, top: pos.top }}>
          <div className={styles.title}>
            {label} {format(stat.value)}
          </div>
          {stat.parts.map((p, i) => (
            <div key={i} className={styles[p.kind]}>
              {p.label}: {fmtSigned(p.value, format)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
