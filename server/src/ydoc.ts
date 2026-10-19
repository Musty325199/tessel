import * as Y from 'yjs';
import type { TShape } from '../../shared/templates.js';

export const shapesOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('shapes');

export function readShapes(doc: Y.Doc): TShape[] {
  const out: TShape[] = [];
  shapesOf(doc).forEach((m) => out.push(Object.fromEntries(m.entries()) as TShape));
  return out.sort((a, b) => a.z - b.z);
}

export function writeShapes(doc: Y.Doc, shapes: TShape[], origin: unknown = 'server') {
  const map = shapesOf(doc);
  doc.transact(() => {
    shapes.forEach((s) => {
      const m = new Y.Map<unknown>();
      Object.entries(s).forEach(([k, v]) => { if (v !== undefined) m.set(k, v); });
      map.set(s.id, m);
    });
  }, origin);
}

/** Replace everything on a board with another set of shapes in one change (used to restore a version). */
export function replaceShapes(doc: Y.Doc, shapes: TShape[], origin: unknown = 'server') {
  const map = shapesOf(doc);
  doc.transact(() => {
    Array.from(map.keys()).forEach((k) => map.delete(k));
    writeShapes(doc, shapes, origin);
  }, origin);
}

export function docFromState(state?: Uint8Array | null) {
  const d = new Y.Doc();
  if (state?.length) Y.applyUpdate(d, state);
  return d;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** A small picture of the board for the dashboard. Built from the shapes, so it needs no browser. */
export function thumbnail(doc: Y.Doc): string {
  const shapes = readShapes(doc).filter((s) => s.type !== 'arrow').slice(0, 400);
  if (!shapes.length) return '';
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  shapes.forEach((s) => { x1 = Math.min(x1, s.x); y1 = Math.min(y1, s.y); x2 = Math.max(x2, s.x + s.w); y2 = Math.max(y2, s.y + s.h); });
  const pad = Math.max(40, (x2 - x1) * 0.06);
  x1 -= pad; y1 -= pad; x2 += pad; y2 += pad;
  // match the 16:10 card so nothing is stretched
  const w = x2 - x1, h = y2 - y1, want = 1.6;
  if (w / h > want) { const nh = w / want; y1 -= (nh - h) / 2; y2 = y1 + nh; } else { const nw = h * want; x1 -= (nw - w) / 2; x2 = x1 + nw; }
  const r = (n: number) => Math.round(n);
  const parts = shapes.map((s) => {
    const fill = s.color && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#FFFFFF';
    switch (s.type) {
      case 'frame': return `<rect x="${r(s.x)}" y="${r(s.y)}" width="${r(s.w)}" height="${r(s.h)}" rx="18" fill="var(--t-frame,#fff)" fill-opacity=".6" stroke="var(--t-line,#CDD4DD)" stroke-width="3"/>`;
      case 'sticky': return `<rect x="${r(s.x)}" y="${r(s.y)}" width="${r(s.w)}" height="${r(s.h)}" rx="6" fill="${fill}"/>`;
      case 'rect': return `<rect x="${r(s.x)}" y="${r(s.y)}" width="${r(s.w)}" height="${r(s.h)}" rx="12" fill="${fill}" stroke="#1B2333" stroke-width="3"/>`;
      case 'ellipse': return `<ellipse cx="${r(s.x + s.w / 2)}" cy="${r(s.y + s.h / 2)}" rx="${r(s.w / 2)}" ry="${r(s.h / 2)}" fill="${fill}" stroke="#1B2333" stroke-width="3"/>`;
      case 'diamond': return `<path d="M${r(s.x + s.w / 2)} ${r(s.y)}L${r(s.x + s.w)} ${r(s.y + s.h / 2)}L${r(s.x + s.w / 2)} ${r(s.y + s.h)}L${r(s.x)} ${r(s.y + s.h / 2)}Z" fill="${fill}" stroke="#1B2333" stroke-width="3"/>`;
      case 'text': return `<rect x="${r(s.x)}" y="${r(s.y + s.h * 0.2)}" width="${r(Math.min(s.w, (s.text || '').length * (s.size || 24) * 0.52))}" height="${r(s.h * 0.55)}" rx="${r(s.h * 0.2)}" fill="var(--t-ink,#1B2333)" fill-opacity=".85"/>`;
      case 'image': return `<rect x="${r(s.x)}" y="${r(s.y)}" width="${r(s.w)}" height="${r(s.h)}" rx="8" fill="#9AA5B4"/>`;
      case 'pen': return `<rect x="${r(s.x)}" y="${r(s.y + s.h / 2 - 3)}" width="${r(s.w)}" height="6" rx="3" fill="${esc(s.stroke && s.stroke !== 'ink' ? s.stroke : '#5B6578')}"/>`;
      default: return '';
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(x1)} ${r(y1)} ${r(x2 - x1)} ${r(y2 - y1)}">${parts.join('')}</svg>`;
}
