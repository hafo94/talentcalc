export interface TextSegment {
  text: string;
  color?: string;
}

/** Parses WoW |cAARRGGBB...|r color codes. Everything else is kept verbatim. */
export function parseWowText(input: string): TextSegment[] {
  const s = input.replace(/\r\n?/g, "\n");
  const out: TextSegment[] = [];
  const push = (text: string, color?: string) => {
    const t = text.replace(/\|r/gi, "");
    if (t) out.push(color ? { text: t, color } : { text: t });
  };
  const re = /\|c([0-9a-f]{8})([\s\S]*?)(\|r|$)/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    push(s.slice(last, m.index));
    push(m[2]!, "#" + m[1]!.slice(2).toLowerCase());
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  push(s.slice(last));
  return out;
}
