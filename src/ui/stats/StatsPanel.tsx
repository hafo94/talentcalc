import type { ReactNode } from "react";
import { getRace, targetsFile } from "@/data";
import type { AttackSlot } from "@/data/types";
import { ATTACK_SLOTS, MAGIC_SCHOOLS, type MeleeOutcome, type Stat } from "@/engine/stats";
import { useCharacter } from "@/state/character";
import type { Derived } from "@/state/derived";
import { NotModeledNote } from "./NotModeledNote";
import { StatValue } from "./StatValue";
import { fmtDec1, fmtDec2, fmtInt, fmtPct } from "./format";
import { useDerived } from "./useDerived";
import styles from "./StatsPanel.module.css";

type Ok = Extract<Derived, { ok: true }>;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SLOT_LABEL: Record<AttackSlot, string> = {
  mainHand: "Main hand",
  offHand: "Off hand",
  ranged: "Ranged",
};

function Row({
  label,
  stat,
  format = fmtInt,
  testId,
}: {
  label: string;
  stat: Stat | null;
  format?: (n: number) => string;
  testId: string;
}) {
  if (!stat) return null;
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>
        <StatValue stat={stat} format={format} label={label} testId={testId} />
      </td>
    </tr>
  );
}

function PlainRow({ label, testId, children }: { label: string; testId?: string; children: ReactNode }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td data-testid={testId}>{children}</td>
    </tr>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h3 className={styles.heading}>{title}</h3>
      <table className={styles.rows}>
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}

function Groups({ d }: { d: Ok }) {
  const s = d.stats;
  const token = s.classToken;
  const hasSpell = token !== "warrior" && token !== "rogue";
  const weapons = ATTACK_SLOTS.filter((k) => s.weapons[k]);
  return (
    <div className={styles.groups}>
      <Group title="Attributes">
        <Row label="Strength" stat={s.primary.str} testId="stat-str" />
        <Row label="Agility" stat={s.primary.agi} testId="stat-agi" />
        <Row label="Stamina" stat={s.primary.sta} testId="stat-sta" />
        <Row label="Intellect" stat={s.primary.int} testId="stat-int" />
        <Row label="Spirit" stat={s.primary.spi} testId="stat-spi" />
        <Row label="Health" stat={s.health} testId="stat-health" />
        <Row label="Mana" stat={s.mana} testId="stat-mana" />
      </Group>
      <Group title="Melee">
        <Row label="Attack power" stat={s.attackPower} testId="stat-ap" />
        <Row label="Crit (main hand)" stat={s.crit.mainHand} format={fmtPct} testId="stat-crit-mh" />
        <Row label="Crit (off hand)" stat={s.crit.offHand} format={fmtPct} testId="stat-crit-oh" />
        <Row label="Hit" stat={s.hit.mainHand} format={fmtPct} testId="stat-hit-mh" />
        <Row label="Hit (off hand)" stat={s.hit.offHand} format={fmtPct} testId="stat-hit-oh" />
        <Row label="Weapon skill" stat={s.weaponSkill.mainHand} testId="stat-skill-mh" />
        <Row label="Haste" stat={s.haste.melee} format={fmtPct} testId="stat-haste-melee" />
        {s.expertise.value > 0 && (
          <Row label="Expertise" stat={s.expertise} format={fmtPct} testId="stat-expertise" />
        )}
        {s.armorPenPct.value > 0 && (
          <Row label="Armor penetration" stat={s.armorPenPct} format={fmtPct} testId="stat-armorpen" />
        )}
      </Group>
      {s.rangedAttackPower && (
        <Group title="Ranged">
          <Row label="Ranged attack power" stat={s.rangedAttackPower} testId="stat-rap" />
          <Row label="Ranged crit" stat={s.crit.ranged} format={fmtPct} testId="stat-crit-ranged" />
          <Row label="Ranged hit" stat={s.hit.ranged} format={fmtPct} testId="stat-hit-ranged" />
          <Row label="Ranged haste" stat={s.haste.ranged} format={fmtPct} testId="stat-haste-ranged" />
        </Group>
      )}
      {hasSpell && (
        <Group title="Spell">
          {MAGIC_SCHOOLS.map((sc) => (
            <Row key={sc} label={`${cap(sc)} spell power`} stat={s.spellPower[sc]} testId={`stat-sp-${sc}`} />
          ))}
          <Row label="Spell crit" stat={s.crit.spell} format={fmtPct} testId="stat-crit-spell" />
          <Row label="Spell hit" stat={s.hit.spell} format={fmtPct} testId="stat-hit-spell" />
          <Row label="Spell haste" stat={s.haste.spell} format={fmtPct} testId="stat-haste-spell" />
          {MAGIC_SCHOOLS.filter((sc) => s.spellPen[sc].value > 0).map((sc) => (
            <Row
              key={sc}
              label={`${cap(sc)} spell penetration`}
              stat={s.spellPen[sc]}
              testId={`stat-pen-${sc}`}
            />
          ))}
        </Group>
      )}
      {weapons.length > 0 && (
        <Group title="Weapons">
          {weapons.map((k) => {
            const w = s.weapons[k]!;
            return [
              <tr key={`${k}-h`}>
                <th scope="row" colSpan={2} className={styles.sub}>
                  {SLOT_LABEL[k]}: {w.name}
                </th>
              </tr>,
              <Row
                key={`${k}-s`}
                label="Damage per hit"
                stat={w.perSwing}
                format={fmtDec1}
                testId={`weapon-swing-${k}`}
              />,
              <Row
                key={`${k}-d`}
                label="DPS (no crit, no armor)"
                stat={w.dps}
                format={fmtDec1}
                testId={`weapon-dps-${k}`}
              />,
              <PlainRow key={`${k}-p`} label="Speed" testId={`weapon-speed-${k}`}>
                {fmtDec2(w.hastedSpeed)}s{w.hastedSpeed !== w.speed ? ` (base ${fmtDec2(w.speed)}s)` : ""}
              </PlainRow>,
            ];
          })}
        </Group>
      )}
      {s.damageDone.length > 0 && (
        <Group title="Damage modifiers">
          {s.damageDone.map((e, i) => (
            <PlainRow key={i} label={e.label}>
              <span className={styles.grey}>
                +{e.value}% {e.schools?.join("/") ?? "all"}
              </span>
            </PlainRow>
          ))}
          <tr>
            <td colSpan={2} className={styles.dim}>
              applied to matching attacks in the Damage panel
            </td>
          </tr>
        </Group>
      )}
    </div>
  );
}

function OutcomeRows({ slot, o }: { slot: AttackSlot; o: MeleeOutcome }) {
  const melee = slot !== "ranged";
  return (
    <>
      <tr>
        <th scope="row" colSpan={2} className={styles.sub}>
          {SLOT_LABEL[slot]}
        </th>
      </tr>
      <Row label="Special attack miss" stat={o.miss} format={fmtPct} testId={`vs-miss-${slot}`} />
      {melee && (
        <Row label="White attack miss" stat={o.whiteMiss} format={fmtPct} testId={`vs-whitemiss-${slot}`} />
      )}
      {melee && <Row label="Dodge" stat={o.dodge} format={fmtPct} testId={`vs-dodge-${slot}`} />}
      {melee && <PlainRow label="Parry">0.00% (behind)</PlainRow>}
      {melee && (
        <PlainRow label="Glancing blows" testId={`vs-glance-${slot}`}>
          {fmtPct(o.glancing)}
        </PlainRow>
      )}
      <Row label="Crit vs target" stat={o.crit} format={fmtPct} testId={`vs-crit-${slot}`} />
      {melee && (
        <PlainRow label="White crit (capped)">
          <span data-testid={`vs-whitecrit-${slot}`}>{fmtPct(o.whiteCrit)}</span>{" "}
          <span className={styles.dim}>cap {fmtPct(o.whiteCritCap)}</span>
        </PlainRow>
      )}
      <PlainRow label="Hit cap">
        <span data-testid={`vs-hitcap-${slot}`}>{fmtPct(o.hitCap)}</span>{" "}
        <span className={styles.dim}>hit removes special misses</span>
      </PlainRow>
    </>
  );
}

function VsTarget({ d }: { d: Ok }) {
  const v = d.view;
  const label = targetsFile.presets.find((p) => p.id === v.presetId)?.label ?? v.presetId;
  const taken = Object.entries(v.damageTakenPct).filter(([, pct]) => pct > 0);
  const over = ATTACK_SLOTS.some((k) => {
    const o = v[k];
    return o && k !== "ranged" && o.crit.value > o.whiteCritCap;
  });
  return (
    <section className={styles.block} data-testid="vs-target">
      <h3 className={styles.heading}>
        Vs {label} (level {v.level})
      </h3>
      <table className={styles.rows}>
        <tbody>
          {ATTACK_SLOTS.map((k) => {
            const o = v[k];
            return o ? <OutcomeRows key={k} slot={k} o={o} /> : null;
          })}
          <tr>
            <th scope="row" colSpan={2} className={styles.sub}>
              Spells
            </th>
          </tr>
          <Row label="Spell miss" stat={v.spell.miss} format={fmtPct} testId="vs-miss-spell" />
          <Row label="Spell crit vs target" stat={v.spell.crit} format={fmtPct} testId="vs-crit-spell" />
          <PlainRow label="Spell hit cap">
            <span data-testid="vs-hitcap-spell">{fmtPct(v.spell.hitCap)}</span>{" "}
            <span className={styles.dim}>hit removes spell misses</span>
          </PlainRow>
          <tr>
            <th scope="row" colSpan={2} className={styles.sub}>
              Target
            </th>
          </tr>
          <Row label="Armor" stat={v.armor} testId="vs-armor" />
          <Row label="Physical damage reduction" stat={v.armorReduction} format={fmtPct} testId="vs-dr" />
          {taken.length > 0 && (
            <PlainRow label="Magic damage taken">
              {taken.map(([sc, pct]) => `+${pct}% ${sc}`).join(", ")}
            </PlainRow>
          )}
        </tbody>
      </table>
      {over && (
        <p className={styles.warn}>
          Crit is above the white-attack cap: some crits are lost to misses, dodges and glancing blows.
        </p>
      )}
    </section>
  );
}

function ReferenceTable({ d }: { d: Ok }) {
  const s = d.stats;
  const rangedOnly = s.classToken === "hunter" && !s.weapons.mainHand && !!s.weapons.ranged;
  const showDps = d.reference.some((r) => r.dps !== undefined);
  return (
    <section className={styles.block}>
      <div className={styles.scroll}>
        <table className={styles.ref} data-testid="reference-table">
          <caption>Same build vs reference targets for level {s.level} (debuffs applied)</caption>
          <thead>
            <tr>
              <th>Target</th>
              <th>Level</th>
              <th>Armor</th>
              <th>DR</th>
              <th>Miss</th>
              <th>Dodge</th>
              <th>Glancing</th>
              <th>Crit</th>
              <th>Spell miss</th>
              {showDps && <th>DPS</th>}
            </tr>
          </thead>
          <tbody>
            {d.reference.map((r) => {
              const o = rangedOnly ? r.ranged : r.mainHand;
              return (
                <tr key={r.presetId}>
                  <td>{targetsFile.presets.find((p) => p.id === r.presetId)?.label ?? r.presetId}</td>
                  <td>{r.level}</td>
                  <td>{fmtInt(r.armor.value)}</td>
                  <td>{fmtPct(r.armorReduction.value)}</td>
                  <td>{o ? fmtPct(o.miss.value) : "–"}</td>
                  <td>{o ? fmtPct(o.dodge.value) : "–"}</td>
                  <td>{o ? fmtPct(o.glancing) : "–"}</td>
                  <td>{o ? fmtPct(o.crit.value) : "–"}</td>
                  <td>{fmtPct(r.spell.miss.value)}</td>
                  {showDps && <td>{r.dps === undefined ? "–" : fmtDec1(r.dps)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function StatsPanel() {
  const d = useDerived();
  const raceId = useCharacter((s) => s.raceId);
  if (!d.ok) {
    if (d.reason === "noClass") return null;
    return (
      <div className={styles.panel} data-testid="stats-panel">
        <h2 className={styles.title}>Stats</h2>
        <p className={styles.dim}>No base stats for this level.</p>
      </div>
    );
  }
  const race = getRace(raceId).token.toUpperCase();
  return (
    <div className={styles.panel} data-testid="stats-panel">
      <h2 className={styles.title}>Stats</h2>
      <Groups d={d} />
      <VsTarget d={d} />
      <ReferenceTable d={d} />
      <NotModeledNote d={d} race={race} />
    </div>
  );
}
