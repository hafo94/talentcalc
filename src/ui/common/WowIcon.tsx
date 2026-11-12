import { useState } from "react";
import { iconUrls } from "@/data/assets";
import styles from "./WowIcon.module.css";

interface Props {
  name: string | null;
  size: number;
  alt?: string;
  className?: string;
}

function WowIconInner({ name, size, alt = "", className }: Props) {
  const [stage, setStage] = useState<0 | 1 | 2>(name === null ? 2 : 0);
  if (name === null || stage === 2) {
    return (
      <span
        className={`${styles.placeholder} ${className ?? ""}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }}
        aria-hidden
      >
        ?
      </span>
    );
  }
  return (
    <img
      className={`${styles.icon} ${className ?? ""}`}
      src={iconUrls(name)[stage]}
      width={size}
      height={size}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setStage((s) => (s === 0 ? 1 : 2))}
    />
  );
}

/** Icon with CDN fallback chain; the stage resets when the icon name changes. */
export function WowIcon(props: Props) {
  return <WowIconInner key={props.name ?? "none"} {...props} />;
}
