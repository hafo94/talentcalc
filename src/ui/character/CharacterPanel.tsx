import { useMemo } from "react";
import { classesFile, getClassInfo } from "@/data";
import type { Weapon } from "@/data/types";
import { ammoFor, weaponsForSlot } from "@/engine/stats";
import { useCharacter } from "@/state/character";
import { useCalc } from "@/state/store";
import { BonusStats } from "./BonusStats";
import { BuffsPanel } from "./BuffsPanel";
import { PetPanel } from "./PetPanel";
import { TargetPanel } from "./TargetPanel";
import { WeaponPicker } from "./WeaponPicker";
import styles from "./CharacterPanel.module.css";

const RANGED_SUBCLASSES = [2, 3, 16, 18, 19];
const AMMO_SUBCLASSES = [2, 3, 18];
const CASTERS = ["priest", "mage", "warlock"];

function WeaponsSection() {
  const classToken = useCalc((s) => s.classToken)!;
  const level = useCalc((s) => s.level);
  const file = useCharacter((s) => s.weapons);
  const ids = useCharacter((s) => s.weaponIds);
  const setWeapon = useCharacter((s) => s.setWeapon);
  const cls = getClassInfo(classToken);
  const all = file?.weapons;

  const byId = (id: number): Weapon | null => (id && all ? (all.find((w) => w.id === id) ?? null) : null);
  const mh = byId(ids.mainHand);
  const oh = byId(ids.offHand);
  const rw = byId(ids.ranged);

  const mhList = useMemo(
    () => (all ? weaponsForSlot(all, cls, level, "mainHand", null) : []),
    [all, cls, level],
  );
  const ohList = useMemo(
    () => (all ? weaponsForSlot(all, cls, level, "offHand", mh) : []),
    [all, cls, level, mh],
  );
  const rwList = useMemo(
    () => (all ? weaponsForSlot(all, cls, level, "ranged", null) : []),
    [all, cls, level],
  );
  const ammoList = useMemo(() => (file ? ammoFor(file.ammo, rw, level) : []), [file, rw, level]);

  const hasRanged = cls.weaponSubclasses.some((s) => RANGED_SUBCLASSES.includes(s));
  const loading = file === null;
  const set = (slot: "mainHand" | "offHand" | "ranged") => (id: number) =>
    setWeapon(slot, id, classToken, level);

  return (
    <section className={styles.section} aria-labelledby="weapons-h">
      <h2 className={styles.heading} id="weapons-h">
        Weapons
      </h2>
      <WeaponPicker
        slot="mainHand"
        label="Main hand"
        removeLabel="Remove main hand"
        candidates={mhList}
        selected={mh}
        loading={loading}
        onSelect={set("mainHand")}
      />
      {cls.dualWield && (
        <WeaponPicker
          slot="offHand"
          label="Off hand"
          removeLabel="Remove off hand"
          candidates={ohList}
          selected={oh}
          loading={loading}
          disabledReason={mh?.slot === "twoHand" ? "Two-handed weapon equipped" : undefined}
          onSelect={set("offHand")}
        />
      )}
      {hasRanged && (
        <WeaponPicker
          slot="ranged"
          label={CASTERS.includes(classToken) ? "Wand" : "Ranged"}
          removeLabel="Remove ranged weapon"
          candidates={rwList}
          selected={rw}
          loading={loading}
          onSelect={set("ranged")}
        />
      )}
      {rw && AMMO_SUBCLASSES.includes(rw.subclass) && (
        <div className={styles.field}>
          <label htmlFor="weapon-ammo" className={styles.dim}>
            Ammo
          </label>
          <select
            id="weapon-ammo"
            className={styles.select}
            data-testid="weapon-ammo"
            value={ids.ammo}
            onChange={(e) => useCharacter.setState({ weaponIds: { ...ids, ammo: Number(e.target.value) } })}
          >
            <option value={0}>None</option>
            {ammoList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.dps} dps)
              </option>
            ))}
          </select>
        </div>
      )}
    </section>
  );
}

export function CharacterPanel() {
  const classToken = useCalc((s) => s.classToken);
  const raceId = useCharacter((s) => s.raceId);
  const setRace = useCharacter((s) => s.setRace);
  const level = useCalc((s) => s.level);
  if (!classToken) return null;
  const cls = getClassInfo(classToken);
  const races = cls.raceIds.map((id) => classesFile.races.find((r) => r.id === id)!);
  const hasSpell = classToken !== "warrior" && classToken !== "rogue";
  const hasRap = classToken === "hunter" || classToken === "warrior" || classToken === "rogue";

  return (
    <div className={styles.panel} data-testid="character-panel">
      <h2 className={styles.title}>Character</h2>
      <section className={styles.section} aria-labelledby="race-h">
        <h2 className={styles.heading} id="race-h">
          Race
        </h2>
        <div className={styles.field}>
          <select
            className={styles.select}
            data-testid="race-select"
            aria-label="Race"
            value={raceId}
            onChange={(e) => setRace(Number(e.target.value))}
          >
            {races.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <span className={styles.dim} data-testid="character-level">
            Level {level}
          </span>
        </div>
      </section>
      <WeaponsSection />
      <PetPanel />
      <BonusStats hasSpell={hasSpell} hasRap={hasRap} />
      <BuffsPanel />
      <TargetPanel />
    </div>
  );
}
