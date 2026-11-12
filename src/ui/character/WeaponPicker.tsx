import { useId, useMemo, useState } from "react";
import type { Weapon } from "@/data/types";
import { searchWeapons } from "@/engine/stats";
import { WowIcon } from "@/ui/common/WowIcon";
import { fmtDec1, fmtDec2 } from "@/ui/stats/format";
import { itemStatLine } from "./itemStats";
import styles from "./WeaponPicker.module.css";

interface Props {
  slot: "mainHand" | "offHand" | "ranged";
  label: string;
  removeLabel: string;
  candidates: readonly Weapon[];
  selected: Weapon | null;
  loading: boolean;
  disabledReason?: string;
  onSelect(id: number): void;
}

const qualityColor = (q: number) => `var(--q${Math.min(6, Math.max(0, q))})`;

export function WeaponCard({
  w,
  onRemove,
  removeLabel,
}: {
  w: Weapon;
  onRemove(): void;
  removeLabel: string;
}) {
  const stats = w.stats.map(itemStatLine);
  return (
    <div className={styles.card} data-testid={`weapon-card-${w.slot}`}>
      <WowIcon name={w.icon} size={24} />
      <span className={styles.cardName} style={{ color: qualityColor(w.quality) }}>
        {w.name}
      </span>
      <button type="button" className={styles.remove} aria-label={removeLabel} onClick={onRemove}>
        ×
      </button>
      <div className={styles.cardBody}>
        <div className={styles.line}>
          {w.min}–{w.max} damage · Speed {fmtDec2(w.speedMs / 1000)} · {fmtDec1(w.dps)} DPS
        </div>
        {w.bonusDamage && (
          <div className={styles.bonus}>
            +{w.bonusDamage.min}–{w.bonusDamage.max}{" "}
            {w.bonusDamage.school
              ? w.bonusDamage.school.charAt(0).toUpperCase() + w.bonusDamage.school.slice(1) + " "
              : ""}
            damage
          </div>
        )}
        {stats.map((s, i) => (
          <div key={i} className={s.modeled ? styles.statLine : styles.unmodeled}>
            {s.text}
          </div>
        ))}
        <div>
          {w.source === "classic_era" ? (
            <span
              className={styles.unverified}
              title="Not in the Forever client data; values from the Classic Era client (Q18/Q19)"
            >
              Classic Era data · unverified
            </span>
          ) : (
            <span className={styles.muted}>Forever</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Searchable weapon combobox (WAI-ARIA combobox with listbox popup). */
export function WeaponPicker({
  slot,
  label,
  removeLabel,
  candidates,
  selected,
  loading,
  disabledReason,
  onSelect,
}: Props) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [query, setQuery] = useState<string | null>(null); // null: show the selected name
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(
    () => (open ? searchWeapons(candidates, query ?? "", 50) : []),
    [open, candidates, query],
  );
  const disabled = loading || disabledReason !== undefined;
  const placeholder = loading ? "Loading weapons…" : (disabledReason ?? "Search weapons…");
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  const choose = (id: number) => {
    onSelect(id);
    setQuery(null);
    setOpen(false);
  };

  return (
    <div className={styles.row}>
      <label className={styles.label} htmlFor={`${uid}-input`}>
        {label}
      </label>
      <div className={styles.picker}>
        <input
          id={`${uid}-input`}
          type="text"
          role="combobox"
          className={styles.input}
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && results[activeIndex] ? `${uid}-${results[activeIndex].id}` : undefined
          }
          data-testid={`weapon-${slot}`}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={placeholder}
          value={query ?? selected?.name ?? ""}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setQuery(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!open) setOpen(true);
              else setActive(Math.min(results.length - 1, activeIndex + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive(Math.max(0, activeIndex - 1));
            } else if (e.key === "Enter") {
              if (open && results[activeIndex]) {
                e.preventDefault();
                choose(results[activeIndex].id);
              }
            } else if (e.key === "Escape") {
              if (open) {
                e.preventDefault();
                setOpen(false);
                setQuery(null);
              }
            }
          }}
        />
        {open && (
          <ul id={listId} role="listbox" aria-label={`${label} results`} className={styles.list}>
            {results.length === 0 && <li className={styles.empty}>No matching weapons</li>}
            {results.map((w, i) => (
              <li
                key={w.id}
                id={`${uid}-${w.id}`}
                role="option"
                data-item-id={w.id}
                aria-selected={i === activeIndex}
                className={styles.option}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(w.id);
                }}
                onMouseMove={() => setActive(i)}
              >
                <span className={styles.optIcon}>
                  <WowIcon name={w.icon} size={18} />
                </span>
                <span className={styles.name} style={{ color: qualityColor(w.quality) }}>
                  {w.name}
                  {w.source === "classic_era" && <span className={styles.badge}>Era</span>}
                </span>
                <span className={styles.meta}>
                  ilvl {w.itemLevel} · {fmtDec1(w.dps)} dps
                </span>
                <span className={styles.sub}>
                  {w.weaponType} · {w.min}–{w.max} · {fmtDec2(w.speedMs / 1000)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected && <WeaponCard w={selected} removeLabel={removeLabel} onRemove={() => choose(0)} />}
    </div>
  );
}
