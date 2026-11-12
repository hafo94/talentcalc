import type { ClassToken } from "@/data/types";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const RANK_BITS = 3;
const RANK_MAX = (1 << RANK_BITS) - 1;

export interface BuildCode {
  classToken: ClassToken;
  level: number;
  talentedRank: number;
  ranks: Record<number, number>;
}
export type DecodeResult =
  | { ok: true; build: BuildCode }
  | { ok: false; reason: "empty" | "version" | "class" | "level" | "perk" | "payload" };

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) out += ALPHABET[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 !== undefined) out += ALPHABET[b2 & 63];
  }
  return out;
}

export function base64UrlToBytes(s: string): Uint8Array | null {
  if (s.length % 4 === 1) return null;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
      acc &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}

function writeVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push(v % 0x80 | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

export function encodeBuild(b: BuildCode): string {
  const ids = Object.keys(b.ranks)
    .map(Number)
    .filter((id) => (b.ranks[id] ?? 0) > 0)
    .sort((a, c) => a - c);
  const bytes: number[] = [];
  let prev = 0;
  for (const id of ids) {
    const rank = b.ranks[id]!;
    if (!Number.isInteger(rank) || rank > RANK_MAX)
      throw new Error(`rank ${rank} of node ${id} does not fit`);
    writeVarint(bytes, (id - prev) * (RANK_MAX + 1) + rank);
    prev = id;
  }
  const head = `#v1.${b.classToken}.${b.level}.${b.talentedRank}`;
  return bytes.length ? `${head}.${bytesToBase64Url(Uint8Array.from(bytes))}` : head;
}

function decodePayload(payload: string): Record<number, number> | null {
  const bytes = base64UrlToBytes(payload);
  if (!bytes) return null;
  const ranks: Record<number, number> = {};
  let prev = 0;
  let i = 0;
  while (i < bytes.length) {
    let value = 0;
    let mul = 1;
    for (;;) {
      if (i >= bytes.length) return null; // truncated varint
      const byte = bytes[i++]!;
      value += (byte & 0x7f) * mul;
      if (!(byte & 0x80)) break;
      mul *= 0x80;
      if (mul > 2 ** 35) return null;
    }
    const rank = value % (RANK_MAX + 1);
    const delta = (value - rank) / (RANK_MAX + 1);
    if (rank < 1 || delta < 1) return null;
    prev += delta;
    ranks[prev] = rank;
  }
  return ranks;
}

export function decodeBuild(hash: string, isClassToken: (s: string) => s is ClassToken): DecodeResult {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (h === "") return { ok: false, reason: "empty" };
  const parts = h.split(".");
  if (parts[0] !== "v1") return { ok: false, reason: "version" };
  if (parts.length < 4 || parts.length > 5) return { ok: false, reason: "payload" };
  const token = parts[1]!;
  if (!isClassToken(token)) return { ok: false, reason: "class" };
  if (!/^\d{1,2}$/.test(parts[2]!)) return { ok: false, reason: "level" };
  const level = Number(parts[2]);
  if (level < 1 || level > 60) return { ok: false, reason: "level" };
  if (!/^[0-5]$/.test(parts[3]!)) return { ok: false, reason: "perk" };
  let ranks: Record<number, number> = {};
  const payload = parts[4];
  if (payload) {
    const r = decodePayload(payload);
    if (!r) return { ok: false, reason: "payload" };
    ranks = r;
  }
  return { ok: true, build: { classToken: token, level, talentedRank: Number(parts[3]), ranks } };
}
