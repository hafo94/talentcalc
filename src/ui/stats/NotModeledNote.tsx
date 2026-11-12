import { racialsFile } from "@/data";
import type { NotModeled, NotModeledReason } from "@/engine/stats";
import { useCalc } from "@/state/store";
import type { Derived } from "@/state/derived";
import styles from "./StatsPanel.module.css";

const SECTIONS: { reason: NotModeledReason; title: string }[] = [
  { reason: "inactive", title: "Inactive (condition not met)" },
  { reason: "spellMod", title: "Affect specific spells (Phase 4)" },
  { reason: "special", title: "Special effects (Phase 4)" },
  { reason: "ability", title: "Abilities and cooldowns (Phase 4/5)" },
  { reason: "unsupported", title: "Not supported yet" },
];

export function NotModeledNote({ d, race }: { d: Extract<Derived, { ok: true }>; race: string }) {
  const tree = useCalc((s) => s.tree);
  const notes: NotModeled[] = d.mapping.notModeled;
  const racials = racialsFile.racials.filter((r) => r.race === race && r.kind === "active");
  const n = notes.length;
  if (n === 0 && racials.length === 0) return null;
  return (
    <details className={styles.details} data-testid="not-modeled">
      <summary>Talents not modeled yet ({n})</summary>
      {SECTIONS.map(({ reason, title }) => {
        const list = notes.filter((x) => x.reason === reason);
        if (list.length === 0) return null;
        return (
          <div key={reason}>
            <h3>{title}</h3>
            <ul>
              {list.map((x, i) => (
                <li key={`${x.nodeId}-${i}`}>
                  {x.name} {x.rank}/{tree?.nodes.get(x.nodeId)?.talent.maxRank ?? "?"} — {x.detail}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {racials.length > 0 && (
        <div>
          <h3>Racial abilities (Phase 5)</h3>
          <ul>
            {racials.map((r) => (
              <li key={r.spellId}>
                {r.name}
                {r.notes ? ` — ${r.notes}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}
