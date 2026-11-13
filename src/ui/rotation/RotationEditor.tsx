import { useMemo, useState } from "react";
import { rotationsFile } from "@/data";
import type {
  ConditionType,
  RotationCondition,
  RotationEntry,
  RotationEntryKind,
  SpecRotation,
} from "@/data/types";
import { CONDITION_TYPES, describeCondition, pickRotation } from "@/engine/rotation";
import { pointsBySpec } from "@/engine/talents";
import { PROC_AURAS, catalogFor, useRotation } from "@/state/rotation";
import { useCalc } from "@/state/store";
import { WowIcon } from "@/ui/common/WowIcon";
import { slug } from "@/ui/results/slug";
import { useDerived } from "@/ui/stats/useDerived";
import { KINDS, KIND_LABEL, move, newCondition, strip } from "./editing";
import styles from "./RotationEditor.module.css";

function ConditionRow({
  c,
  abilityRefs,
  auraRefs,
  power,
  onChange,
  onRemove,
  label,
}: {
  c: RotationCondition;
  abilityRefs: string[];
  auraRefs: string[];
  power: Parameters<typeof describeCondition>[1];
  onChange(c: RotationCondition): void;
  onRemove(): void;
  label: string;
}) {
  const meta = CONDITION_TYPES.find((t) => t.type === c.type)!;
  const refs = c.type === "aura" ? auraRefs : abilityRefs;
  return (
    <li className={styles.condition} data-testid="rotation-condition">
      <select
        aria-label={`Condition type (${label})`}
        value={c.type}
        onChange={(e) => onChange(newCondition(e.target.value as ConditionType, refs))}
      >
        {CONDITION_TYPES.map((t) => (
          <option key={t.type} value={t.type}>
            {t.type === "resource" && power ? power[0]!.toUpperCase() + power.slice(1) : t.label}
          </option>
        ))}
      </select>
      {c.type === "aura" || c.type === "cooldown" ? (
        <>
          <select
            aria-label={`Condition reference (${label})`}
            value={c.ref}
            onChange={(e) => onChange({ ...c, ref: e.target.value })}
          >
            {[...new Set([c.ref, ...refs])].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            aria-label={`Condition state (${label})`}
            value={String(c.type === "aura" ? c.active : c.ready)}
            onChange={(e) =>
              onChange(
                c.type === "aura"
                  ? { ...c, active: e.target.value === "true" }
                  : { ...c, ready: e.target.value === "true" },
              )
            }
          >
            <option value="true">{c.type === "aura" ? "active" : "ready"}</option>
            <option value="false">{c.type === "aura" ? "not active" : "on cooldown"}</option>
          </select>
        </>
      ) : (
        <>
          <select
            aria-label={`Condition comparison (${label})`}
            value={c.cmp}
            onChange={(e) => onChange({ ...c, cmp: e.target.value as "gte" | "lt" })}
          >
            <option value="gte">≥</option>
            <option value="lt">&lt;</option>
          </select>
          <input
            type="number"
            aria-label={`Condition value (${label})`}
            className={styles.number}
            min={0}
            max={meta.max}
            step={c.type === "auraLeft" || c.type === "timeLeft" ? 0.5 : 1}
            value={c.value}
            onChange={(e) =>
              onChange({ ...c, value: Math.min(meta.max, Math.max(0, Number(e.target.value) || 0)) })
            }
          />
          <span className={styles.unit}>{c.type === "resource" && power === "mana" ? "%" : meta.unit}</span>
        </>
      )}
      <button
        type="button"
        className={styles.icon}
        aria-label={`Remove condition (${label})`}
        onClick={onRemove}
      >
        ×
      </button>
    </li>
  );
}

/** Priority list editor (section 6.1): reorder (drag and drop or buttons), add, remove, switch off, conditions. */
export function RotationEditor() {
  const tree = useCalc((s) => s.tree);
  const spells = useCalc((s) => s.spells);
  const ranks = useCalc((s) => s.ranks);
  const custom = useRotation((s) => s.custom);
  const setRotation = useRotation((s) => s.setRotation);
  const reset = useRotation((s) => s.reset);
  const d = useDerived();
  const [drag, setDrag] = useState<number | null>(null);
  const [adding, setAdding] = useState("");
  const catalog = useMemo(() => (spells && tree ? catalogFor(spells, tree) : []), [spells, tree]);
  if (!tree || !spells) return null;
  const auto = pickRotation(rotationsFile, tree.token, pointsBySpec(tree, ranks));
  const rotation: SpecRotation = custom && custom.class === tree.token ? custom : auto;
  const specs = rotationsFile.rotations.filter((r) => r.class === tree.token).sort((a, b) => a.spec - b.spec);
  const edit = (entries: RotationEntry[]) => setRotation({ ...structuredClone(rotation), entries });
  const update = (i: number, patch: Partial<RotationEntry>) =>
    edit(rotation.entries.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const inList = new Set(rotation.entries.map((e) => e.ability));
  const addable = catalog.filter((a) => !inList.has(a.name));
  const abilityRefs = rotation.entries.map((e) => e.ability);
  const auraRefs = [...new Set([...abilityRefs, ...PROC_AURAS])];
  const power = d.ok && d.damage ? d.damage.result.rotation.power : null;
  const skipped = new Map(
    d.ok && d.damage ? d.damage.result.rotation.skipped.map((s) => [s.ability, s.reason]) : [],
  );
  const icon = (name: string) => catalog.find((a) => a.name === name)?.icon ?? null;

  return (
    <section className={styles.panel} data-testid="rotation-editor" aria-labelledby="rotation-title">
      <div className={styles.header}>
        <h2 id="rotation-title" className={styles.title}>
          Rotation
        </h2>
        <label className={styles.base}>
          Based on{" "}
          <select
            data-testid="rotation-base"
            value={rotation.spec}
            onChange={(e) => {
              const r = specs.find((x) => x.spec === Number(e.target.value));
              if (r) setRotation(structuredClone(r));
            }}
          >
            {specs.map((r) => (
              <option key={r.id} value={r.spec}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {custom && (
          <span className={styles.badge} data-testid="rotation-edited">
            edited
          </span>
        )}
        <button type="button" data-testid="rotation-reset" disabled={!custom} onClick={reset}>
          Reset to default
        </button>
      </div>
      <p className={styles.hint}>
        Top to bottom: the first usable entry is cast. Drag an entry or use the arrow buttons to reorder.
        Entries marked “simulation only” do not count in the analytical DPS.
      </p>
      <ol className={styles.list} data-testid="rotation-list">
        {rotation.entries.map((e, i) => {
          const id = slug(e.ability);
          return (
            <li
              key={`${e.ability}-${i}`}
              className={`${styles.entry} ${drag === i ? styles.dragging : ""} ${e.off ? styles.off : ""}`}
              data-testid={`rotation-entry-${id}`}
              draggable
              onDragStart={(ev) => {
                setDrag(i);
                ev.dataTransfer.effectAllowed = "move";
                ev.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={(ev) => {
                ev.preventDefault();
                const from = drag ?? Number(ev.dataTransfer.getData("text/plain"));
                setDrag(null);
                if (Number.isInteger(from) && from !== i) edit(move(rotation.entries, from, i));
              }}
              onDragEnd={() => setDrag(null)}
            >
              <div className={styles.row}>
                <span className={styles.handle} aria-hidden>
                  ⋮⋮
                </span>
                <span className={styles.rank}>{i + 1}</span>
                <input
                  type="checkbox"
                  aria-label={`Use ${e.ability}`}
                  checked={!e.off}
                  onChange={(ev) =>
                    edit(
                      rotation.entries.map((x, k) =>
                        k === i ? (ev.target.checked ? strip(x, "off") : { ...x, off: true }) : x,
                      ),
                    )
                  }
                />
                <WowIcon name={icon(e.ability)} size={20} />
                <span className={styles.name}>{e.ability}</span>
                <select
                  aria-label={`Type of ${e.ability}`}
                  value={e.kind}
                  onChange={(ev) => update(i, { kind: ev.target.value as RotationEntryKind })}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                {e.kind === "finisher" && (
                  <label className={styles.small}>
                    CP{" "}
                    <input
                      type="number"
                      className={styles.number}
                      aria-label={`Combo points of ${e.ability}`}
                      min={1}
                      max={5}
                      value={e.cp ?? 5}
                      onChange={(ev) =>
                        update(i, { cp: Math.min(5, Math.max(1, Math.round(Number(ev.target.value) || 5))) })
                      }
                    />
                  </label>
                )}
                {e.kind === "maintain" && (
                  <label className={styles.small}>
                    every{" "}
                    <input
                      type="number"
                      className={styles.number}
                      aria-label={`Recast interval of ${e.ability}`}
                      min={1}
                      max={600}
                      value={e.everySec ?? 30}
                      onChange={(ev) =>
                        update(i, { everySec: Math.min(600, Math.max(1, Number(ev.target.value) || 30)) })
                      }
                    />{" "}
                    s
                  </label>
                )}
                <span className={styles.buttons}>
                  <button
                    type="button"
                    className={styles.icon}
                    aria-label={`Move ${e.ability} up`}
                    disabled={i === 0}
                    onClick={() => edit(move(rotation.entries, i, i - 1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.icon}
                    aria-label={`Move ${e.ability} down`}
                    disabled={i === rotation.entries.length - 1}
                    onClick={() => edit(move(rotation.entries, i, i + 1))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={styles.icon}
                    aria-label={`Add a condition to ${e.ability}`}
                    onClick={() =>
                      update(i, {
                        conditions: [...(e.conditions ?? []), newCondition("resource", abilityRefs)],
                      })
                    }
                  >
                    +if
                  </button>
                  <button
                    type="button"
                    className={styles.icon}
                    aria-label={`Remove ${e.ability}`}
                    onClick={() => edit(rotation.entries.filter((_, k) => k !== i))}
                  >
                    ×
                  </button>
                </span>
              </div>
              {skipped.has(e.ability) && <p className={styles.skip}>{skipped.get(e.ability)}</p>}
              {(e.conditions ?? []).length > 0 && (
                <ul className={styles.conditions}>
                  {e.conditions!.map((c, k) => (
                    <ConditionRow
                      key={k}
                      c={c}
                      label={`${e.ability} ${k + 1}`}
                      abilityRefs={abilityRefs.filter((x) => x !== e.ability)}
                      auraRefs={auraRefs}
                      power={power}
                      onChange={(nc) =>
                        update(i, { conditions: e.conditions!.map((x, j) => (j === k ? nc : x)) })
                      }
                      onRemove={() => {
                        const rest = e.conditions!.filter((_, j) => j !== k);
                        edit(
                          rotation.entries.map((x, j) =>
                            j === i ? (rest.length ? { ...x, conditions: rest } : strip(x, "conditions")) : x,
                          ),
                        );
                      }}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <div className={styles.add}>
        <select
          data-testid="rotation-add"
          aria-label="Ability to add"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
        >
          <option value="">Add an ability…</option>
          {addable.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
              {a.talent ? " (talent)" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="rotation-add-button"
          disabled={!adding}
          onClick={() => {
            const a = catalog.find((x) => x.name === adding);
            if (a) edit([...rotation.entries, structuredClone(a.entry)]);
            setAdding("");
          }}
        >
          Add
        </button>
      </div>
    </section>
  );
}
