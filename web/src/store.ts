import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { useEffect, useState } from 'react';

export type ShapeType = 'sticky' | 'text' | 'rect' | 'ellipse' | 'diamond' | 'arrow' | 'pen' | 'image' | 'frame';
export type End = { id?: string; x: number; y: number };
export type Shape = {
  id: string;
  type: ShapeType;
  x: number; y: number; w: number; h: number;
  z: number;
  color?: string;   // sticky / shape fill
  stroke?: string;  // line colour for arrows, pen, text
  text?: string;
  size?: number;    // font size for text, brush size for pen
  points?: number[]; // pen: flat [x, y, pressure, ...] relative to x/y
  from?: End; to?: End;
  src?: string;
  // text formatting (whole shape)
  font?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean;
  align?: 'left' | 'center' | 'right'; textColor?: string;
};

export const LOCAL = 'local';
const QUIET = 'quiet'; // changes that should not land in undo history (e.g. measured heights)

/* One board is open at a time. These are live bindings: opening another board swaps them, and every
   importer sees the new doc. */
export let doc = new Y.Doc();
export let shapesMap = doc.getMap<Y.Map<unknown>>('shapes');
export let metaMap = doc.getMap<unknown>('meta');
export let undo = new Y.UndoManager([shapesMap, metaMap], { trackedOrigins: new Set([LOCAL]), captureTimeout: 500 });

const toPlain = (m: Y.Map<unknown>) => Object.fromEntries(m.entries()) as Shape;

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function topZ() {
  let z = 0;
  shapesMap.forEach((m) => { const v = m.get('z') as number; if (v > z) z = v; });
  return z + 1;
}

export function createShape(s: Omit<Shape, 'id' | 'z'> & { id?: string; z?: number }, origin: string = LOCAL) {
  const id = s.id || uid();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    const full = { ...s, id, z: s.z ?? (s.type === 'frame' ? -1000 + topZ() / 1000 : topZ()) };
    Object.entries(full).forEach(([k, v]) => { if (v !== undefined) m.set(k, v); });
    shapesMap.set(id, m);
  }, origin);
  return id;
}

export function updateShape(id: string, patch: Partial<Shape>, origin: string = LOCAL) {
  const m = shapesMap.get(id); if (!m) return;
  doc.transact(() => {
    Object.entries(patch).forEach(([k, v]) => { if (v === undefined) m.delete(k); else if (m.get(k) !== v) m.set(k, v); });
  }, origin);
}
export const updateQuiet = (id: string, patch: Partial<Shape>) => updateShape(id, patch, QUIET);

export function updateMany(patches: Record<string, Partial<Shape>>) {
  doc.transact(() => { Object.entries(patches).forEach(([id, p]) => updateShape(id, p)); }, LOCAL);
}

export function getShape(id: string): Shape | undefined {
  const m = shapesMap.get(id); return m ? toPlain(m) : undefined;
}

export function deleteShapes(ids: string[]) {
  const gone = new Set(ids);
  doc.transact(() => {
    // arrows pointing at deleted shapes keep their last position instead of vanishing
    shapesMap.forEach((m, id) => {
      if (gone.has(id) || m.get('type') !== 'arrow') return;
      (['from', 'to'] as const).forEach((k) => {
        const e = m.get(k) as End | undefined;
        if (e?.id && gone.has(e.id)) m.set(k, { x: e.x, y: e.y });
      });
    });
    ids.forEach((id) => shapesMap.delete(id));
  }, LOCAL);
}

export function clearBoard() {
  doc.transact(() => { Array.from(shapesMap.keys()).forEach((k) => shapesMap.delete(k)); }, LOCAL);
}

/** Live, sorted list of shapes. Unchanged shapes keep the same object so memoised views skip re-rendering. */
const cache = new Map<string, Shape>();
function rebuild(ids?: Set<string>) {
  if (!ids) { cache.clear(); shapesMap.forEach((m, id) => cache.set(id, toPlain(m))); return; }
  ids.forEach((id) => { const m = shapesMap.get(id); if (m) cache.set(id, toPlain(m)); else cache.delete(id); });
}
let snapshot: Shape[] = [];
const listeners = new Set<() => void>();
function publish() {
  snapshot = Array.from(cache.values()).sort((a, b) => a.z - b.z);
  listeners.forEach((l) => l());
}
function observe() {
  rebuild(); publish();
  shapesMap.observeDeep((events) => {
    const ids = new Set<string>();
    events.forEach((ev) => {
      if (ev.target === shapesMap) ev.changes.keys.forEach((_, k) => ids.add(k));
      else { const id = (ev.target as Y.Map<unknown>).get('id') as string; if (id) ids.add(id); }
    });
    rebuild(ids); publish();
  });
}
observe();

/** Start a fresh, empty doc for the next board. */
export function newDoc() {
  undo.destroy();
  doc.destroy();
  doc = new Y.Doc();
  shapesMap = doc.getMap<Y.Map<unknown>>('shapes');
  metaMap = doc.getMap<unknown>('meta');
  undo = new Y.UndoManager([shapesMap, metaMap], { trackedOrigins: new Set([LOCAL]), captureTimeout: 500 });
  observe();
  return doc;
}

export function useShapes() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return snapshot;
}
export const allShapes = () => snapshot;
export const shapeById = (id: string) => cache.get(id);

export function useUndoState(dep?: unknown) {
  const [s, set] = useState({ canUndo: false, canRedo: false });
  useEffect(() => {
    const undo = currentUndo();
    const f = () => set({ canUndo: undo.undoStack.length > 0, canRedo: undo.redoStack.length > 0 });
    undo.on('stack-item-added', f); undo.on('stack-item-popped', f); undo.on('stack-cleared', f);
    f();
    return () => { undo.off('stack-item-added', f); undo.off('stack-item-popped', f); undo.off('stack-cleared', f); };
  }, [dep]);
  return s;
}

export const currentUndo = () => undo;

/** Saves the board on this device so it survives refreshes and works offline. */
export function openLocalBoard(name: string, onReady: (isEmpty: boolean) => void) {
  let p: IndexeddbPersistence;
  try { p = new IndexeddbPersistence('tessel:' + name, doc); } catch { setTimeout(() => onReady(shapesMap.size === 0)); return null; }
  let done = false;
  const ready = () => { if (done) return; done = true; onReady(shapesMap.size === 0); };
  p.once('synced', ready);
  setTimeout(ready, 1500); // private mode can block storage; carry on without it
  return p;
}
