export const NODE = 40; // 36 px icon + 2 px border on each side
export const ICON = 36;
export const COL_PITCH = 64;
export const ROW_PITCH = 60;
export const PAD_X = 34;
export const PAD_Y = 24;
export const TREE_W = 300; // = 2*PAD_X + 3*COL_PITCH + NODE
export const TREE_H = 448; // = 2*PAD_Y + 6*ROW_PITCH + NODE
export const HEAD_LEN = 8; // arrowhead length
export const HEAD_HALF = 7; // arrowhead half width
export const ARROW_WIDTH = 5; // shaft stroke width

export function nodeBox(tier: number, col: number) {
  return { left: PAD_X + col * COL_PITCH, top: PAD_Y + (tier - 1) * ROW_PITCH, size: NODE };
}

interface Pos {
  tier: number;
  col: number;
}

export function arrowPath(pre: Pos, dep: Pos): { shaft: string; head: string } {
  const a = nodeBox(pre.tier, pre.col);
  const b = nodeBox(dep.tier, dep.col);
  const acx = a.left + NODE / 2;
  const acy = a.top + NODE / 2;
  const bcx = b.left + NODE / 2;
  const h = HEAD_HALF;
  const hl = HEAD_LEN;
  if (pre.col === dep.col) {
    const y1 = a.top + NODE;
    const tip = b.top;
    return {
      shaft: `M ${acx} ${y1} V ${tip - hl}`,
      head: `${acx - h},${tip - hl} ${acx + h},${tip - hl} ${acx},${tip}`,
    };
  }
  if (pre.tier === dep.tier) {
    const dir = Math.sign(dep.col - pre.col);
    const y = acy;
    const x1 = dir > 0 ? a.left + NODE : a.left;
    const tip = dir > 0 ? b.left : b.left + NODE;
    const base = tip - dir * hl;
    return {
      shaft: `M ${x1} ${y} H ${base}`,
      head: `${base},${y - h} ${base},${y + h} ${tip},${y}`,
    };
  }
  const dir = Math.sign(dep.col - pre.col);
  const x1 = dir > 0 ? a.left + NODE : a.left;
  const tip = b.top;
  return {
    shaft: `M ${x1} ${acy} H ${bcx} V ${tip - hl}`,
    head: `${bcx - h},${tip - hl} ${bcx + h},${tip - hl} ${bcx},${tip}`,
  };
}
