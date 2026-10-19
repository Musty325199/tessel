import type { End, Shape } from './store';

export type Box = { x: number; y: number; w: number; h: number };
export type Cam = { x: number; y: number; z: number };

export const MIN_Z = 0.1, MAX_Z = 4;
export const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

/** Where an arrow end really sits: on the edge of the shape it is tied to, or at its free point. */
export function resolveEnd(end: End, toward: { x: number; y: number }, lookup: (id: string) => Shape | undefined) {
  const s = end.id ? lookup(end.id) : undefined;
  if (!s) return { x: end.x, y: end.y };
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const pad = 8;
  const hw = s.w / 2 + pad, hh = s.h / 2 + pad;
  let t: number;
  if (s.type === 'ellipse') t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else if (s.type === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return { x: cx + dx * t, y: cy + dy * t };
}

export function centerOf(end: End, lookup: (id: string) => Shape | undefined) {
  const s = end.id ? lookup(end.id) : undefined;
  return s ? { x: s.x + s.w / 2, y: s.y + s.h / 2 } : { x: end.x, y: end.y };
}

export function arrowPoints(a: Shape, lookup: (id: string) => Shape | undefined) {
  const f = a.from!, t = a.to!;
  const p1 = resolveEnd(f, centerOf(t, lookup), lookup);
  const p2 = resolveEnd(t, centerOf(f, lookup), lookup);
  return { p1, p2 };
}

export function boundsOf(s: Shape, lookup: (id: string) => Shape | undefined): Box {
  if (s.type === 'arrow') {
    const { p1, p2 } = arrowPoints(s, lookup);
    const x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
    return { x, y, w: Math.max(1, Math.abs(p1.x - p2.x)), h: Math.max(1, Math.abs(p1.y - p2.y)) };
  }
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

export function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  boxes.forEach((b) => { x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h); });
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const intersects = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const contains = (outer: Box, inner: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

export function normBox(x1: number, y1: number, x2: number, y2: number): Box {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function fitCamera(b: Box, vw: number, vh: number, insetTop = 72, insetBottom = 96): Cam {
  const pad = 48;
  const aw = vw - pad * 2, ah = vh - insetTop - insetBottom - pad;
  const z = clampZ(Math.min(aw / Math.max(b.w, 1), ah / Math.max(b.h, 1), 1.25));
  return { z, x: vw / 2 - (b.x + b.w / 2) * z, y: insetTop + (vh - insetTop - insetBottom) / 2 - (b.y + b.h / 2) * z };
}
