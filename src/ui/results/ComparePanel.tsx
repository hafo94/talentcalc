import { useEffect, useState } from "react";
import { getClassInfo } from "@/data";
import { pointsBySpec } from "@/engine/talents";
import { joinHash, loadBuild, splitHash, talentDiff, useCompare, type LoadedBuild } from "@/state/compare";
import { derive, type Derived } from "@/state/derived";
import { IMPACT_STATS } from "@/state/insight";
import { useCalc } from "@/state/store";
import { fmtDec1, fmtDec2, fmtInt, fmtSigned } from "@/ui/stats/format";
import { useDerived } from "@/ui/stats/useDerived";
import styles from "./DamagePanel.module.css";

type Ok = Extract<Derived, { ok: true }>;
type Pinned = { hash: string; build: LoadedBuild | null; d: Derived | null };

/** Build A: loaded from its hash (class files are cached) and derived once per pin. */
function usePinned(pinned: string | null): Pinned | null {
  const [state, setState] = useState<Pinned | null>(null);
  useEffect(() => {
    if (!pinned) return;
    let live = true;
    void loadBuild(pinned).then((build) => {
      if (!live) return;
      const d = build ? derive(build.inputs.calc, build.inputs.ch, build.inputs.rotation) : null;
      setState({ hash: pinned, build, d });
    });
    return () => {
      live = false;
    };
  }, [pinned]);
  return state && state.hash === pinned ? state : null;
}

const fmtStat = (format: "int" | "pct", v: number) => (format === "pct" ? fmtDec2(v) + "%" : fmtInt(v));
const signed = (format: "int" | "pct" | "dps", v: number) =>
  format === "dps"
    ? fmtSigned(v, fmtDec1)
    : format === "pct"
      ? fmtSigned(v, fmtDec2) + "%"
      : fmtSigned(v, fmtInt);

function Row(props: {
  label: string;
  a: string;
  b: string;
  delta?: { v: number; format: "int" | "pct" | "dps" };
  testId?: string;
}) {
  const { label, a, b, delta, testId } = props;
  const tone = !delta || Math.abs(delta.v) < 1e-9 ? undefined : delta.v > 0 ? "var(--green)" : "var(--red)";
  return (
    <tr data-testid={testId}>
      <th scope="row">{label}</th>
      <td data-testid={testId && `${testId}-a`}>{a}</td>
      <td data-testid={testId && `${testId}-b`}>{b}</td>
      <td data-testid={testId && `${testId}-delta`} style={tone ? { color: tone } : undefined}>
        {delta ? signed(delta.format, delta.v) : ""}
      </td>
    </tr>
  );
}

function Table({ a, b, build }: { a: Ok; b: Ok; build: LoadedBuild }) {
  const calcTree = useCalc((s) => s.tree)!;
  const ranks = useCalc((s) => s.ranks);
  const level = useCalc((s) => s.level);
  const dpsA = a.damage?.totalDps ?? 0;
  const dpsB = b.damage?.totalDps ?? 0;
  const head = (d: Ok, points: number[], lv: number) =>
    `${getClassInfo(d.stats.classToken).name} ${lv} · ${points.join("/")}`;
  const stats = IMPACT_STATS.map((s) => ({
    s,
    va: s.get(a.stats, a.view),
    vb: s.get(b.stats, b.view),
  })).filter((x) => Math.abs(x.va) > 1e-9 || Math.abs(x.vb) > 1e-9);
  const changes = talentDiff(build.tree, build.inputs.calc.ranks, calcTree, ranks);
  return (
    <>
      <table className={styles.table} data-testid="compare-table">
        <caption>Build A (pinned) and build B (the one you edit), vs the selected target</caption>
        <thead>
          <tr>
            <th scope="col">Value</th>
            <th scope="col">A</th>
            <th scope="col">B</th>
            <th scope="col">B − A</th>
          </tr>
        </thead>
        <tbody>
          <Row
            label="Build"
            a={head(a, pointsBySpec(build.tree, build.inputs.calc.ranks), build.code.level)}
            b={head(b, pointsBySpec(calcTree, ranks), level)}
          />
          <Row label="Rotation" a={a.damage?.rotation.label ?? "–"} b={b.damage?.rotation.label ?? "–"} />
          <Row
            label="DPS"
            a={fmtDec1(dpsA)}
            b={fmtDec1(dpsB)}
            delta={{ v: dpsB - dpsA, format: "dps" }}
            testId="compare-dps"
          />
          {(a.damage?.pet || b.damage?.pet) && (
            <Row
              label="Pet DPS"
              a={a.damage?.pet ? `${a.damage.pet.name} ${fmtDec1(a.damage.pet.rotation.dps)}` : "–"}
              b={b.damage?.pet ? `${b.damage.pet.name} ${fmtDec1(b.damage.pet.rotation.dps)}` : "–"}
              delta={{
                v: (b.damage?.pet?.rotation.dps ?? 0) - (a.damage?.pet?.rotation.dps ?? 0),
                format: "dps",
              }}
            />
          )}
          {stats.map(({ s, va, vb }) => (
            <Row
              key={s.id}
              label={s.label.charAt(0).toUpperCase() + s.label.slice(1)}
              a={fmtStat(s.format, va)}
              b={fmtStat(s.format, vb)}
              delta={{ v: vb - va, format: s.format }}
              testId={`compare-${s.id}`}
            />
          ))}
        </tbody>
      </table>
      <h3 className={styles.petTitle}>Talent differences</h3>
      <ul className={styles.changes} data-testid="compare-talents">
        {changes === null && <li>Different classes: talents are not compared.</li>}
        {changes?.length === 0 && <li>Same talents.</li>}
        {changes?.map((c) => (
          <li key={c.nodeId}>
            {c.name}: {c.a} → {c.b}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Phase 7: compare a pinned build (A) with the build being edited (B): DPS, key stats and talent differences.
 * The page link carries both builds (`#B~A`).
 */
export function ComparePanel() {
  const pinned = useCompare((s) => s.pinned);
  const pin = useCompare((s) => s.pin);
  const clear = useCompare((s) => s.clear);
  const b = useDerived();
  const a = usePinned(pinned);
  const current = () => splitHash(location.hash).build;
  return (
    <section className={styles.panel} data-testid="compare-panel" aria-labelledby="compare-title">
      <h2 id="compare-title" className={styles.title}>
        Compare builds
      </h2>
      {!pinned && (
        <p className={styles.line}>
          Pin this build as A, then change talents, gear or settings: the table compares A with the build you
          edit (B). The page link then shares both builds.
        </p>
      )}
      <div className={styles.actionsRow}>
        <button type="button" data-testid="compare-pin" onClick={() => pin(current())}>
          {pinned ? "Pin this build as A again" : "Pin this build as A"}
        </button>
        {pinned && (
          <>
            <button
              type="button"
              data-testid="compare-swap"
              onClick={() => {
                location.hash = joinHash(pinned, current());
              }}
            >
              Swap A and B
            </button>
            <button type="button" data-testid="compare-clear" onClick={clear}>
              Stop comparing
            </button>
          </>
        )}
      </div>
      {pinned && !a && <p className={styles.line}>Loading build A…</p>}
      {pinned && a && (!a.build || !a.d?.ok) && (
        <p className={styles.note}>Build A could not be evaluated.</p>
      )}
      {pinned && a?.build && a.d?.ok && b.ok && <Table a={a.d} b={b} build={a.build} />}
    </section>
  );
}
