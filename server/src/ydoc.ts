import * as Y from 'yjs';
import type { TShape } from '../../shared/templates.js';
import { drawThumbnail } from '../../shared/thumbnail.js';

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

export const thumbnail = (doc: Y.Doc) => drawThumbnail(readShapes(doc));
