import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  allShapes, createShape, deleteShapes, doc, getShape, shapeById, topZ, updateQuiet,
  undo, updateMany, updateShape, useShapes, LOCAL,
} from './store';
import type { Awareness } from 'y-protocols/awareness';
import { Cursors, RemoteSelections, Reactions, usePeers, type Peer } from './presence';
import { FORMATTABLE, FormatBar, applyList } from './format';
import { AiPanel, type AiRequest, type AiResult } from './AiPanel';
import type { End, Shape } from './store';
import { ArrowLayer, ShapeView } from './ShapeView';
import { arrowPoints, boundsOf, clampZ, contains, fitCamera, intersects, normBox, union } from './geometry';
import type { Box, Cam } from './geometry';
import Icon from './icons';
import { FILLS, INKS, PEOPLE, STICKY, inkColor } from './palette';

type Tool = 'select' | 'hand' | 'sticky' | 'text' | 'rect' | 'ellipse' | 'diamond' | 'frame' | 'arrow' | 'pen' | 'eraser' | 'comment';
type Pt = { x: number; y: number };
type Gesture =
  | { kind: 'pan'; start: Pt; cam: Cam; moved: boolean; clearOnTap?: boolean }
  | { kind: 'pinch'; dist: number; mid: Pt; cam: Cam }
  | { kind: 'move'; start: Pt; screen: Pt; ids: string[]; orig: Record<string, Shape>; moved: boolean; hit: string }
  | { kind: 'resize'; id: string; handle: string; start: Pt; box: Box; ratio: number }
  | { kind: 'arrowEnd'; id: string; which: 'from' | 'to' }
  | { kind: 'marquee'; start: Pt; base: string[] }
  | { kind: 'place'; screen: Pt; world: Pt; tool: 'sticky' | 'text' | 'comment'; hit?: string }
  | { kind: 'create'; id: string; start: Pt }
  | { kind: 'arrow'; id: string; start: Pt }
  | { kind: 'pen'; id: string; abs: number[] }
  | { kind: 'erase' };

const TEXTUAL = new Set(['sticky', 'text', 'rect', 'ellipse', 'diamond', 'frame']);
const BINDABLE = new Set(['sticky', 'text', 'rect', 'ellipse', 'diamond', 'image']);

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

const localMe = (() => {
  let c = store.get('tessel:color');
  if (!c || !PEOPLE.includes(c)) { c = PEOPLE[Math.floor(Math.random() * PEOPLE.length)]; store.set('tessel:color', c); }
  return { name: 'You', color: c };
})();

export type BoardApi = {
  fit: (animate?: boolean, only?: string[]) => void;
  say: (t: string) => void;
  follow: (clientId: number | null) => void;
  center: () => { x: number; y: number };
  panTo: (x: number, y: number) => void;
  startComment: () => void;
  selection: () => string[];
};
type BoardProps = {
  awareness?: Awareness | null;
  readOnly?: boolean;
  embedded?: boolean;
  loaded: boolean;
  top?: React.ReactNode;
  onApi?: (api: BoardApi) => void;
  onFollowChange?: (clientId: number | null) => void;
  /** return true to take over a tap on a shape (used for voting) */
  tapOverride?: (s: Shape) => boolean;
  /** drawn on top of the board in screen space, e.g. comment pins */
  overlay?: (cam: Cam, lookup: (id: string) => Shape | undefined) => React.ReactNode;
  /** comment tool tapped the board here (on a shape, if there was one) */
  onCommentAt?: (p: { x: number; y: number }, shape: Shape | null) => void;
  /** runs an AI action on the server; the board shows the result when it syncs */
  onAi?: (r: AiRequest) => Promise<AiResult>;
  /** uploads a photo and returns its link; without it photos are stored inside the board */
  uploadImage?: (b: Blob) => Promise<string>;
  /** what to show instead of the toolbar when the board is view only */
  viewOnlyBar?: React.ReactNode;
};

export default function Board({ awareness = null, readOnly = false, embedded = false, loaded, top, onApi, onFollowChange, viewOnlyBar, onAi, overlay, onCommentAt, tapOverride, uploadImage }: BoardProps) {
  const uploadImageRef = useRef(uploadImage); uploadImageRef.current = uploadImage;
  const tapRef = useRef(tapOverride); tapRef.current = tapOverride;
  const [aiOpen, setAiOpen] = useState(false);
  const [multi, setMultiState] = useState(false);
  const multiRef = useRef(false);
  const setMulti = (v: boolean) => { multiRef.current = v; setMultiState(v); };
  const shapes = useShapes();
  const rootRef = useRef<HTMLDivElement>(null);
  const [cam, setCamState] = useState<Cam>({ x: 0, y: 0, z: 1 });
  const camRef = useRef(cam);
  const setCam = (c: Cam) => { camRef.current = c; setCamState(c); };
  const [tool, setToolState] = useState<Tool>('select');
  const toolRef = useRef<Tool>('select');
  const setTool = (t: Tool) => { toolRef.current = t; setToolState(t); setTray(null); };
  const [sel, setSelState] = useState<string[]>([]);
  const selRef = useRef<string[]>([]);
  const setSel = (s: string[]) => { selRef.current = s; setSelState(s); };
  const [editing, setEditingState] = useState<string | null>(null);
  const editingRef = useRef<string | null>(null);
  const setEditing = (id: string | null) => { editingRef.current = id; setEditingState(id); };
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [busy, setBusy] = useState(false);
  const [tray, setTray] = useState<null | 'sticky' | 'shapes' | 'pen' | 'react' | 'more'>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState('');
  const [stickyColor, setStickyColor] = useState(STICKY[0]);
  const [penColor, setPenColor] = useState('ink');
  const [shapeKind, setShapeKind] = useState<'rect' | 'ellipse' | 'diamond' | 'frame'>('rect');
  const [toast, setToast] = useState('');
  const [following, setFollowingState] = useState<number | null>(null);
  const followRef = useRef<number | null>(null);
  const setFollowing = (c: number | null) => { followRef.current = c; setFollowingState(c); onFollowChange?.(c); };
  const peers = usePeers(awareness);
  const self = (awareness?.getLocalState() as { user?: { name: string; color: string } } | null)?.user;
  const me = self ? { name: 'You', color: self.color } : localMe;
  const readOnlyRef = useRef(readOnly); readOnlyRef.current = readOnly;
  const [space, setSpace] = useState(false);
  const spaceRef = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const lastTap = useRef({ t: 0, id: '' });
  const fileRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  // keep the style bar fully on screen
  useLayoutEffect(() => {
    const el = barRef.current; if (!el) return;
    el.style.marginLeft = '0px';
    const r = el.getBoundingClientRect(), vw = window.innerWidth;
    const dx = r.left < 8 ? 8 - r.left : r.right > vw - 8 ? vw - 8 - r.right : 0;
    if (dx) el.style.marginLeft = dx + 'px';
  });

  const lookup = useCallback((id: string) => shapeById(id), []);
  const [toastAction, setToastAction] = useState<{ label: string; run: () => void } | null>(null);
  const say = (t: string, action?: { label: string; run: () => void }) => { setToast(t); setToastAction(action ?? null); window.clearTimeout((say as any).t); (say as any).t = window.setTimeout(() => { setToast(''); setToastAction(null); }, action ? 7000 : 2600); };

  const fit = useCallback((animate = false, only?: string[]) => {
    const list = only ? allShapes().filter((s) => only.includes(s.id)) : allShapes();
    const b = union(list.map((s) => boundsOf(s, lookup)).map((b) => ({ ...b, y: b.y - 30, h: b.h + 30 })));
    const el = rootRef.current; if (!el) return;
    const mobile = el.clientWidth < 640;
    const next = b ? fitCamera(b, el.clientWidth, el.clientHeight, mobile ? 64 : 72, mobile ? 92 : 96) : { x: el.clientWidth / 2, y: el.clientHeight / 2, z: 1 };
    if (!animate) return setCam(next);
    const from = camRef.current, t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 320), e = 1 - Math.pow(1 - k, 3);
      setCam({ x: from.x + (next.x - from.x) * e, y: from.y + (next.y - from.y) * e, z: from.z + (next.z - from.z) * e });
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [lookup]);

  // phones: keep the note you're typing in above the keyboard
  useEffect(() => {
    if (!editing) return;
    const vv = window.visualViewport; if (!vv) return;
    const keepVisible = () => {
      const el = document.querySelector(`[data-id="${editing}"]`); const root = rootRef.current;
      if (!el || !root) return;
      const r = el.getBoundingClientRect();
      const bottomLimit = vv.offsetTop + vv.height - 16, topLimit = vv.offsetTop + 130;
      let dy = 0;
      if (r.bottom > bottomLimit) dy = bottomLimit - r.bottom;
      if (r.top + dy < topLimit) dy = topLimit - r.top;
      if (Math.abs(dy) > 2) { const c = camRef.current; setCam({ ...c, y: c.y + dy }); }
    };
    const t = setTimeout(keepVisible, 350);
    vv.addEventListener('resize', keepVisible);
    return () => { clearTimeout(t); vv.removeEventListener('resize', keepVisible); };
  }, [editing]);

  // fit the board into view once its content has arrived
  useEffect(() => {
    if (!loaded) return;
    requestAnimationFrame(() => { fit(); setReady(true); });
  }, [loaded, fit]);

  // share where I am and what I'm looking at, for cursors and "follow"
  const publishView = useCallback(() => {
    const el = rootRef.current; if (!awareness || !el) return;
    const c = camRef.current;
    awareness.setLocalStateField('view', { x: (el.clientWidth / 2 - c.x) / c.z, y: (el.clientHeight / 2 - c.y) / c.z, w: el.clientWidth / c.z, h: el.clientHeight / c.z });
  }, [awareness]);
  useEffect(() => { const t = setTimeout(publishView, 120); return () => clearTimeout(t); }, [cam, publishView]);
  useEffect(() => { awareness?.setLocalStateField('selection', sel); }, [sel, awareness]);

  // following someone: keep my camera on theirs
  useEffect(() => {
    if (following === null) return;
    const p = peers.find((x) => x.clientId === following);
    if (!p) { setFollowing(null); say('They left the board.'); return; }
    const el = rootRef.current; if (!el || !p.view) return;
    const z = clampZ(Math.min(el.clientWidth / p.view.w, el.clientHeight / p.view.h));
    setCam({ z, x: el.clientWidth / 2 - p.view.x * z, y: el.clientHeight / 2 - p.view.y * z });
  }, [peers, following]);

  useEffect(() => {
    onApi?.({
      fit, say,
      follow: (c) => { setFollowing(c); if (c !== null) { const p = peers.find((x) => x.clientId === c); if (p) say(`Following ${p.name}. Move the board to stop.`); } },
      center: () => viewCenter(),
      selection: () => selRef.current,
      startComment: () => { setTool('comment'); say('Tap where you want to leave a comment.'); },
      panTo: (x, y) => { const el = rootRef.current; if (!el) return; const c = camRef.current; setCam({ ...c, x: el.clientWidth / 2 - x * c.z, y: el.clientHeight * 0.4 - y * c.z }); },
    });
  });

  // drop selections that no longer exist (after undo, erase, clear)
  useEffect(() => {
    const live = selRef.current.filter((id) => shapeById(id));
    if (live.length !== selRef.current.length) setSel(live);
    if (editingRef.current && !shapeById(editingRef.current)) setEditing(null);
  }, [shapes]);

  // ---- helpers
  const toWorld = (cx: number, cy: number): Pt => {
    const r = rootRef.current!.getBoundingClientRect(), c = camRef.current;
    return { x: (cx - r.left - c.x) / c.z, y: (cy - r.top - c.y) / c.z };
  };
  const zoomAt = (factor: number, sx?: number, sy?: number) => {
    const el = rootRef.current!; const c = camRef.current;
    const px = sx ?? el.clientWidth / 2, py = sy ?? el.clientHeight / 2;
    const z = clampZ(c.z * factor);
    const wx = (px - c.x) / c.z, wy = (py - c.y) / c.z;
    setCam({ z, x: px - wx * z, y: py - wy * z });
  };
  const bindTarget = (cx: number, cy: number, skip: string) => {
    for (const el of document.elementsFromPoint(cx, cy)) {
      const id = (el as Element).closest?.('[data-id]')?.getAttribute('data-id');
      if (id && id !== skip) { const s = shapeById(id); if (s && BINDABLE.has(s.type)) return s; }
    }
    return undefined;
  };
  const viewCenter = (): Pt => { const el = rootRef.current!; return toWorld(el.getBoundingClientRect().left + el.clientWidth / 2, el.getBoundingClientRect().top + el.clientHeight / 2); };

  const startEdit = (id: string) => {
    const s = shapeById(id); if (!s || !TEXTUAL.has(s.type)) return;
    flushSync(() => { setEditing(id); setSel([id]); });
    const ta = document.querySelector<HTMLTextAreaElement>(`[data-edit="${id}"]`);
    if (ta) { ta.focus({ preventScroll: true }); const n = ta.value.length; ta.setSelectionRange(n, n); }
  };
  const finishEdit = () => {
    const id = editingRef.current; if (!id) return;
    setEditing(null);
    const s = getShape(id);
    if (s && s.type === 'text' && !(s.text || '').trim()) deleteShapes([id]);
    undo.stopCapturing();
  };

  // ---- pointer input
  function onPointerDown(e: React.PointerEvent) {
    if (e.button === 2) return;
    setTray(null);
    if (followRef.current !== null) setFollowing(null);
    const root = rootRef.current!;
    try { root.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      // second finger: whatever the first finger started becomes a pinch
      const g = gesture.current;
      if (g?.kind === 'pen' || g?.kind === 'create' || g?.kind === 'arrow') { deleteShapes([g.id]); undo.stopCapturing(); }
      const [a, b] = Array.from(pointers.current.values());
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam: camRef.current };
      return;
    }
    if (pointers.current.size > 2) return;

    const target = e.target as Element;
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle');
    const hitId = target.closest('[data-id]')?.getAttribute('data-id') || '';
    const w = toWorld(e.clientX, e.clientY);
    if (editingRef.current && hitId !== editingRef.current) { (document.activeElement as HTMLElement)?.blur?.(); finishEdit(); }
    undo.stopCapturing();

    const t = toolRef.current;
    if (readOnlyRef.current && t === 'comment') {
      gesture.current = { kind: 'place', screen: { x: e.clientX, y: e.clientY }, world: w, tool: 'comment', hit: hitId };
      return;
    }
    if (readOnlyRef.current) {
      if (e.pointerType !== 'touch' && hitId) { setSel([hitId]); return; }
      gesture.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, cam: camRef.current, moved: false, clearOnTap: true };
      return;
    }
    if (spaceRef.current || t === 'hand' || e.button === 1) {
      gesture.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, cam: camRef.current, moved: false };
      return;
    }
    if (handle) {
      const id = selRef.current[0];
      const s = shapeById(id); if (!s) return;
      if (handle === 'from' || handle === 'to') { gesture.current = { kind: 'arrowEnd', id, which: handle }; return; }
      gesture.current = { kind: 'resize', id, handle, start: w, box: { x: s.x, y: s.y, w: s.w, h: s.h }, ratio: s.w / Math.max(1, s.h) };
      setBusy(true); return;
    }

    switch (t) {
      case 'select': {
        if (hitId && tapRef.current) { const hs = shapeById(hitId); if (hs && tapRef.current(hs)) return; }
        const adding = e.shiftKey || multiRef.current; // phones: "Select several" mode works like holding Shift
        if (hitId) {
          let next = selRef.current;
          if (adding) next = next.includes(hitId) ? next.filter((x) => x !== hitId) : [...next, hitId];
          else if (!next.includes(hitId)) next = [hitId];
          setSel(next);
          if (!next.includes(hitId)) return;
          // moving a frame carries everything inside it
          const ids = new Set(next);
          next.forEach((id) => {
            const f = shapeById(id);
            if (f?.type === 'frame') allShapes().forEach((s) => { if (s.id !== id && s.type !== 'frame' && contains(f, boundsOf(s, lookup))) ids.add(s.id); });
          });
          const orig: Record<string, Shape> = {};
          ids.forEach((id) => { const s = shapeById(id); if (s) orig[id] = s; });
          gesture.current = { kind: 'move', start: w, screen: { x: e.clientX, y: e.clientY }, ids: Array.from(ids), orig, moved: false, hit: hitId };
        } else if (e.pointerType === 'touch' && !multiRef.current) {
          gesture.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, cam: camRef.current, moved: false, clearOnTap: true };
        } else {
          const base = adding ? selRef.current : [];
          if (!adding) setSel([]);
          gesture.current = { kind: 'marquee', start: w, base };
        }
        return;
      }
      case 'sticky': case 'text': case 'comment':
        gesture.current = { kind: 'place', screen: { x: e.clientX, y: e.clientY }, world: w, tool: t, hit: hitId };
        return;
      case 'rect': case 'ellipse': case 'diamond': case 'frame': {
        const id = createShape({ type: t, x: w.x, y: w.y, w: 1, h: 1, color: t === 'frame' ? undefined : '#FFFFFF', text: t === 'frame' ? 'Frame' : '' });
        gesture.current = { kind: 'create', id, start: w }; setSel([id]); setBusy(true);
        return;
      }
      case 'arrow': {
        const from = bindTarget(e.clientX, e.clientY, '');
        const id = createShape({ type: 'arrow', x: 0, y: 0, w: 0, h: 0, from: { id: from?.id, x: w.x, y: w.y }, to: { x: w.x, y: w.y }, stroke: penColor });
        gesture.current = { kind: 'arrow', id, start: w }; setBusy(true);
        return;
      }
      case 'pen': {
        const p = e.pressure || 0.5;
        const id = createShape({ type: 'pen', x: w.x, y: w.y, w: 1, h: 1, points: [0, 0, p], size: 5, stroke: penColor });
        gesture.current = { kind: 'pen', id, abs: [w.x, w.y, p] };
        return;
      }
      case 'eraser':
        gesture.current = { kind: 'erase' };
        eraseAt(e.clientX, e.clientY);
        return;
    }
  }

  function eraseAt(cx: number, cy: number) {
    const hits = new Set<string>();
    document.elementsFromPoint(cx, cy).forEach((el) => {
      const id = (el as Element).closest?.('[data-id]')?.getAttribute('data-id'); if (id) hits.add(id);
    });
    if (hits.size) deleteShapes(Array.from(hits).slice(0, 1));
  }

  function onPointerMove(e: React.PointerEvent) {
    if (awareness && (e.pointerType === 'mouse' || pointers.current.has(e.pointerId))) {
      const w = toWorld(e.clientX, e.clientY);
      awareness.setLocalStateField('cursor', { x: Math.round(w.x), y: Math.round(w.y) });
    }
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current; if (!g) return;
    const w = toWorld(e.clientX, e.clientY);
    switch (g.kind) {
      case 'pinch': {
        if (pointers.current.size < 2) return;
        const [a, b] = Array.from(pointers.current.values());
        const dist = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const r = rootRef.current!.getBoundingClientRect();
        const z = clampZ(g.cam.z * (dist / g.dist));
        const wx = (g.mid.x - r.left - g.cam.x) / g.cam.z, wy = (g.mid.y - r.top - g.cam.y) / g.cam.z;
        setCam({ z, x: mid.x - r.left - wx * z, y: mid.y - r.top - wy * z });
        return;
      }
      case 'pan': {
        const dx = e.clientX - g.start.x, dy = e.clientY - g.start.y;
        if (Math.hypot(dx, dy) > 4) g.moved = true;
        setCam({ ...g.cam, x: g.cam.x + dx, y: g.cam.y + dy });
        return;
      }
      case 'place': {
        if (e.pointerType === 'touch' && Math.hypot(e.clientX - g.screen.x, e.clientY - g.screen.y) > 8) {
          gesture.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, cam: camRef.current, moved: true };
        }
        return;
      }
      case 'move': {
        if (!g.moved && Math.hypot(e.clientX - g.screen.x, e.clientY - g.screen.y) < 4) return;
        if (!g.moved) { g.moved = true; setBusy(true); }
        const dx = w.x - g.start.x, dy = w.y - g.start.y;
        const patches: Record<string, Partial<Shape>> = {};
        g.ids.forEach((id) => {
          const o = g.orig[id];
          if (o.type === 'arrow') {
            const shift = (end?: End) => end && (end.id && g.ids.includes(end.id) ? end : end.id ? end : { x: end.x + dx, y: end.y + dy });
            patches[id] = { from: shift(o.from), to: shift(o.to) };
          } else patches[id] = { x: o.x + dx, y: o.y + dy };
        });
        updateMany(patches);
        return;
      }
      case 'resize': {
        const b = g.box; const dx = w.x - g.start.x, dy = w.y - g.start.y;
        let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
        if (g.handle.includes('w')) x1 += dx; else x2 += dx;
        if (g.handle.includes('n')) y1 += dy; else y2 += dy;
        const s = shapeById(g.id); if (!s) return;
        let box = normBox(x1, y1, x2, y2);
        const min = 24;
        if (box.w < min) box = { ...box, w: min, x: g.handle.includes('w') ? b.x + b.w - min : b.x };
        if (s.type === 'image') { const h = box.w / g.ratio; box = { ...box, h, y: g.handle.includes('n') ? b.y + b.h - h : b.y }; }
        if (s.type === 'text') { updateShape(g.id, { x: box.x, w: box.w }); return; }
        if (box.h < min) box = { ...box, h: min, y: g.handle.includes('n') ? b.y + b.h - min : b.y };
        updateShape(g.id, box);
        return;
      }
      case 'arrowEnd': {
        const t = bindTarget(e.clientX, e.clientY, g.id);
        updateShape(g.id, { [g.which]: { id: t?.id, x: w.x, y: w.y } } as Partial<Shape>);
        setBusy(true);
        return;
      }
      case 'marquee': {
        const box = normBox(g.start.x, g.start.y, w.x, w.y);
        setMarquee(box);
        const hit = allShapes().filter((s) => { const b = boundsOf(s, lookup); return s.type === 'frame' ? contains(box, b) : intersects(box, b); }).map((s) => s.id);
        setSel(Array.from(new Set([...g.base, ...hit])));
        return;
      }
      case 'create': {
        const box = normBox(g.start.x, g.start.y, w.x, w.y);
        updateShape(g.id, e.shiftKey ? { ...box, h: box.w } : box);
        return;
      }
      case 'arrow': {
        const t = bindTarget(e.clientX, e.clientY, g.id);
        updateShape(g.id, { to: { id: t?.id, x: w.x, y: w.y } });
        return;
      }
      case 'pen': {
        const p = e.pressure || 0.5;
        const ev = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() || [];
        const list = ev.length ? ev.map((c) => toWorld(c.clientX, c.clientY)) : [w];
        list.forEach((q) => g.abs.push(q.x, q.y, p));
        let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
        for (let i = 0; i < g.abs.length; i += 3) { mx = Math.min(mx, g.abs[i]); my = Math.min(my, g.abs[i + 1]); Mx = Math.max(Mx, g.abs[i]); My = Math.max(My, g.abs[i + 1]); }
        const rel: number[] = [];
        for (let i = 0; i < g.abs.length; i += 3) rel.push(g.abs[i] - mx, g.abs[i + 1] - my, g.abs[i + 2]);
        updateShape(g.id, { x: mx, y: my, w: Math.max(1, Mx - mx), h: Math.max(1, My - my), points: rel });
        return;
      }
      case 'erase':
        eraseAt(e.clientX, e.clientY);
        return;
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (e.pointerType === 'touch' && awareness && pointers.current.size === 0) awareness.setLocalStateField('cursor', null);
    const g = gesture.current;
    if (g?.kind === 'pinch') { if (pointers.current.size === 0) gesture.current = null; return; }
    gesture.current = null;
    setBusy(false); setMarquee(null);
    if (!g || e.type === 'pointercancel' && g.kind !== 'pan') { if (g && (g.kind === 'create' || g.kind === 'arrow')) deleteShapes([g.id]); return; }
    const w = toWorld(e.clientX, e.clientY);
    switch (g.kind) {
      case 'pan':
        if (!g.moved && g.clearOnTap) { setSel([]); }
        break;
      case 'move': {
        if (!g.moved) {
          const now = performance.now();
          if (lastTap.current.id === g.hit && now - lastTap.current.t < 380) { startEdit(g.hit); lastTap.current = { t: 0, id: '' }; }
          else lastTap.current = { t: now, id: g.hit };
          if (!e.shiftKey && !multiRef.current && selRef.current.length > 1) setSel([g.hit]);
        }
        break;
      }
      case 'place': {
        if (g.tool === 'comment') {
          setTool('select');
          onCommentAt?.(g.world, g.hit ? shapeById(g.hit) ?? null : null);
        } else if (g.tool === 'sticky') {
          const id = createShape({ type: 'sticky', x: g.world.x - 90, y: g.world.y - 85, w: 180, h: 170, text: '', color: stickyColor });
          setTool('select'); startEdit(id);
        } else {
          const id = createShape({ type: 'text', x: g.world.x, y: g.world.y - 16, w: 280, h: 32, text: '', size: 24, stroke: 'ink' });
          setTool('select'); startEdit(id);
        }
        break;
      }
      case 'create': {
        const s = shapeById(g.id);
        if (s && s.w < 12 && s.h < 12) {
          const [dw, dh] = s.type === 'frame' ? [480, 320] : s.type === 'diamond' ? [140, 140] : [180, 100];
          updateShape(g.id, { x: w.x - dw / 2, y: w.y - dh / 2, w: dw, h: dh });
        }
        if (s?.type === 'frame') { const f = shapeById(g.id)!; updateShape(g.id, { z: -1000 + topZ() / 1000, w: f.w, h: f.h }); }
        setSel([g.id]); setTool('select');
        break;
      }
      case 'arrow': {
        const s = shapeById(g.id);
        if (s) {
          const { p1, p2 } = arrowPoints(s, lookup);
          if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 12 && !(s.to?.id && s.to.id !== s.from?.id)) {
            // a tap: drop a ready-made arrow instead of an invisible one
            updateShape(g.id, { from: { x: g.start.x, y: g.start.y }, to: { x: g.start.x + 140, y: g.start.y } });
          }
          if (s.to?.id && s.to.id === s.from?.id) updateShape(g.id, { to: { x: w.x, y: w.y } });
        }
        setSel([g.id]); setTool('select');
        break;
      }
      case 'pen': {
        const s = shapeById(g.id);
        if (s && (s.points?.length || 0) <= 3) updateShape(g.id, { points: [0, 0, 0.5, 0.5, 0.5, 0.5], w: 1, h: 1 });
        break;
      }
    }
    undo.stopCapturing();
  }

  // ---- wheel and trackpad
  useEffect(() => {
    const el = rootRef.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest?.('[data-ui]')) return; // let comment threads scroll
      e.preventDefault();
      if (followRef.current !== null) setFollowing(null);
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else { const c = camRef.current; setCam({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }); }
    };
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('gesturestart', stop);
    return () => { el.removeEventListener('wheel', onWheel); document.removeEventListener('gesturestart', stop); };
  }, []);

  // ---- actions
  const duplicate = () => {
    const ids = selRef.current; if (!ids.length) return;
    const map: Record<string, string> = {};
    const out: string[] = [];
    doc.transact(() => {
      ids.forEach((id) => { const s = getShape(id); if (s && s.type !== 'arrow') { const { id: _old, z: _z, ...rest } = s; map[id] = createShape({ ...rest, x: s.x + 28, y: s.y + 28 }); out.push(map[id]); } });
      ids.forEach((id) => {
        const s = getShape(id); if (!s || s.type !== 'arrow') return;
        const end = (e?: End) => e && (e.id && map[e.id] ? { ...e, id: map[e.id] } : e.id ? e : { x: e.x + 28, y: e.y + 28 });
        const { id: _old, z: _z, ...rest } = s;
        out.push(createShape({ ...rest, from: end(s.from), to: end(s.to) }));
      });
    }, LOCAL);
    setSel(out);
  };
  const remove = () => { if (selRef.current.length) { deleteShapes(selRef.current); setSel([]); } };
  const toFront = () => {
    const patches: Record<string, Partial<Shape>> = {};
    let z = topZ();
    selRef.current.forEach((id) => { const s = shapeById(id); if (s && s.type !== 'frame') patches[id] = { z: z++ }; });
    updateMany(patches);
  };
  const restyle = (patch: Partial<Shape>) => {
    const patches: Record<string, Partial<Shape>> = {};
    selRef.current.forEach((id) => {
      const s = shapeById(id); if (!s) return;
      const p: Partial<Shape> = { ...patch };
      // a text box's colour is its stroke; other shapes keep fill and text colour apart
      if ('textColor' in p && s.type === 'text') { p.stroke = p.textColor; delete p.textColor; }
      if (!FORMATTABLE.has(s.type)) { (['font', 'size', 'bold', 'italic', 'underline', 'strike', 'align', 'textColor'] as const).forEach((k) => delete p[k]); }
      if (s.type === 'text' && 'color' in p) { /* highlight */ }
      patches[id] = p;
    });
    updateMany(patches);
  };
  const doUndo = () => { finishEdit(); undo.undo(); };
  const doRedo = () => { finishEdit(); undo.redo(); };

  /** Shrinks a photo in the browser before it goes anywhere, so uploads are fast on mobile data. */
  function shrink(img: HTMLImageElement, max: number, quality: number) {
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  async function addImage(file: File, at?: Pt) {
    if (!file.type.startsWith('image/')) return say('That file is not an image.');
    if (file.size > 25 * 1024 * 1024) return say('That image is too large. Use one under 25 MB.');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      // show a small preview straight away, then swap in the full photo when it's uploaded
      const small = shrink(img, 480, 0.7);
      const ctr = at ?? viewCenter(); const w = Math.min(360, img.width), h = w * (img.height / img.width);
      const id = createShape({ type: 'image', x: ctr.x - w / 2, y: ctr.y - h / 2, w, h, src: small.toDataURL('image/jpeg', 0.7) });
      setSel([id]); setTool('select');
      const fallback = () => updateQuiet(id, { src: shrink(img, 1400, 0.84).toDataURL('image/jpeg', 0.84) });
      if (!uploadImageRef.current) return fallback();
      try {
        const big = shrink(img, 2400, 0.9);
        const blob = await new Promise<Blob | null>((r) => big.toBlob(r, 'image/jpeg', 0.9));
        if (!blob) throw new Error('resize failed');
        const link = await uploadImageRef.current(blob);
        if (shapeById(id)) updateQuiet(id, { src: link });
      } catch {
        fallback();
        say('The photo is saved in the board instead, because the upload didn’t go through.');
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); say('This image could not be opened.'); };
    img.src = url;
  }

  // paste or drop images straight onto the board
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (readOnlyRef.current) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      const f = Array.from(e.clipboardData?.files || []).find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); addImage(f); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  // ---- keyboard
  useEffect(() => {
    const keys: Record<string, Tool> = { c: 'comment', v: 'select', h: 'hand', s: 'sticky', t: 'text', r: 'rect', o: 'ellipse', d: 'diamond', f: 'frame', a: 'arrow', p: 'pen', e: 'eraser' };
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (!rootRef.current?.isConnected) return;
      const mod = e.metaKey || e.ctrlKey;
      if (readOnlyRef.current) { if (e.shiftKey && e.key === '!') fit(true); return; }
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
      if (mod && k === 'y') { e.preventDefault(); doRedo(); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicate(); return; }
      if (mod && k === 'a') { e.preventDefault(); setSel(allShapes().map((s) => s.id)); return; }
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomAt(1.2); return; }
      if (mod && k === '-') { e.preventDefault(); zoomAt(1 / 1.2); return; }
      if (mod) return;
      if (e.key === ' ' && !spaceRef.current) { spaceRef.current = true; setSpace(true); e.preventDefault(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); return; }
      if (e.key === 'Escape') { setSel([]); setTool('select'); return; }
      if (e.key === '/' && awareness) { e.preventDefault(); setChat(''); setChatOpen(true); return; }
      if (e.key === 'Enter' && selRef.current.length === 1) { e.preventDefault(); startEdit(selRef.current[0]); return; }
      if (e.shiftKey && k === '1') { fit(true); return; }
      if (keys[k]) setTool(keys[k]);
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') { spaceRef.current = false; setSpace(false); } };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [fit]);

  // ---- derived view data
  const selSet = useMemo(() => new Set(sel), [sel]);
  const arrows = shapes.filter((s) => s.type === 'arrow');
  const frames = shapes.filter((s) => s.type === 'frame');
  const rest = shapes.filter((s) => s.type !== 'arrow' && s.type !== 'frame');
  const selShapes = sel.map((id) => shapeById(id)).filter(Boolean) as Shape[];
  const selBox = union(selShapes.map((s) => boundsOf(s, lookup)));
  const toScreen = (b: Box) => ({ left: b.x * cam.z + cam.x, top: b.y * cam.z + cam.y, width: b.w * cam.z, height: b.h * cam.z });
  const single = selShapes.length === 1 ? selShapes[0] : null;
  const types = new Set(selShapes.map((s) => s.type));
  const only = (...t: string[]) => selShapes.length > 0 && Array.from(types).every((x) => t.includes(x));

  const cursor = space || tool === 'hand' ? (gesture.current?.kind === 'pan' ? 'grabbing' : 'grab') : tool === 'select' ? 'default' : tool === 'eraser' ? 'cell' : tool === 'comment' ? 'copy' : 'crosshair';

  return (
    <div className={'app' + (embedded ? ' embedded' : '') + (readOnly ? ' readonly' : '')}>
      <div
        ref={rootRef}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') awareness?.setLocalStateField('cursor', null); }}
        className={'board' + (ready ? ' ready' : '')}
        style={{
          cursor,
          backgroundSize: `${24 * cam.z}px ${24 * cam.z}px`,
          backgroundPosition: `${cam.x}px ${cam.y}px`,
          ['--dot-size' as string]: `${Math.max(0.6, Math.min(1.4, cam.z * 1.1))}px`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          if (readOnlyRef.current) return;
          const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id');
          if (id) startEdit(id);
          else if (toolRef.current === 'select') { const w = toWorld(e.clientX, e.clientY); const nid = createShape({ type: 'sticky', x: w.x - 90, y: w.y - 85, w: 180, h: 170, text: '', color: stickyColor }); startEdit(nid); }
        }}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => { if (!readOnly && Array.from(e.dataTransfer.items).some((i) => i.type.startsWith('image/'))) e.preventDefault(); }}
        onDrop={(e) => { const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/')); if (f && !readOnly) { e.preventDefault(); addImage(f, toWorld(e.clientX, e.clientY)); } }}
      >
        <div className="world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
          {frames.map((s) => <ShapeView key={s.id} s={s} editing={editing === s.id} onDone={finishEdit} />)}
          {rest.map((s) => <ShapeView key={s.id} s={s} editing={editing === s.id} onDone={finishEdit} />)}
          <ArrowLayer arrows={arrows} lookup={lookup} selected={selSet} />
        </div>

        {selBox && !editing && single?.type !== 'arrow' && (
          <div className="selection" style={{ ...toScreen(selBox), ['--me' as string]: me.color }}>
            <span className="flag">{me.name}</span>
            {single && single.type !== 'pen' && !busy && selBox.w * cam.z > 36 && selBox.h * cam.z > 20 && ['nw', 'ne', 'sw', 'se'].map((h) => <i key={h} data-handle={h} className={'handle h-' + h} />)}
          </div>
        )}
        {single?.type === 'arrow' && !editing && (() => {
          const { p1, p2 } = arrowPoints(single, lookup);
          return (['from', 'to'] as const).map((k) => {
            const p = k === 'from' ? p1 : p2;
            return <i key={k} data-handle={k} className="handle dot" style={{ left: p.x * cam.z + cam.x, top: p.y * cam.z + cam.y, ['--me' as string]: me.color }} />;
          });
        })()}
        {marquee && <div className="marquee" style={{ ...toScreen(marquee), ['--me' as string]: me.color }} />}
        {awareness && <RemoteSelections peers={peers} cam={cam} lookup={lookup} />}
        {overlay?.(cam, lookup)}
        {awareness && <Reactions peers={peers} cam={cam} />}
        {awareness && <Cursors peers={peers} cam={cam} />}
      </div>

      {top && <header className="top">{top}</header>}
      {following !== null && (() => { const p = peers.find((x) => x.clientId === following); return p ? <div className="following" style={{ ['--me' as string]: p.color }}>Following {p.name}<button onClick={() => setFollowing(null)}>Stop</button></div> : null; })()}

      {/* ---- formatting bar for the selection (stays while you type) */}
      {selBox && !busy && selShapes.length > 0 && !readOnly && (() => {
        const r = toScreen(selBox);
        const el = rootRef.current;
        const vw = el?.clientWidth || 400, vh = el?.clientHeight || 800;
        const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
        // on phones the keyboard covers the bottom, so while typing the bar sits under the top bar
        const pinned = !!editing && coarse;
        const above = r.top - 62;
        const top = pinned ? 72 : above > 70 ? above : Math.min(r.top + r.height + 14, vh - 150);
        const left = pinned ? vw / 2 : Math.min(Math.max(12, r.left + r.width / 2), vw - 12);
        return (
          <div ref={barRef} className={'stylebar' + (pinned ? ' pinned' : '')} style={{ top, left }}>
            <FormatBar
              shapes={selShapes}
              editing={!!editing}
              onPatch={restyle}
              onListChange={(kind) => { const patches: Record<string, Partial<Shape>> = {}; selShapes.forEach((x) => { if (FORMATTABLE.has(x.type)) patches[x.id] = { text: applyList(x.text, kind) }; }); updateMany(patches); }}
              tail={editing ? <button className="fmt-btn done" onClick={() => { (document.activeElement as HTMLElement)?.blur?.(); }}>Done</button> : <>
                {single && TEXTUAL.has(single.type) && <button className="ib" title="Edit text (Enter)" aria-label="Edit text" onClick={() => startEdit(single.id)}><Icon n="edit" size={18} /></button>}
                <button className="ib" title="Duplicate (Ctrl D)" aria-label="Duplicate" onClick={duplicate}><Icon n="copy" size={18} /></button>
                {!only('frame') && <button className="ib" title="Bring to front" aria-label="Bring to front" onClick={toFront}><Icon n="front" size={18} /></button>}
                <button className="ib" title="Delete" aria-label="Delete" onClick={remove}><Icon n="trash" size={18} /></button>
              </>}
            />
          </div>
        );
      })()}

      {/* ---- trays above the toolbar */}
      {tray === 'sticky' && (
        <div className="tray">{STICKY.map((c) => <button key={c} aria-label="Note colour" className={'sw big' + (stickyColor === c ? ' on' : '')} style={{ background: c }} onClick={() => { setStickyColor(c); setTray(null); }} />)}</div>
      )}
      {tray === 'pen' && (
        <div className="tray">{INKS.map((c) => <button key={c} aria-label="Ink colour" className={'sw big' + (penColor === c ? ' on' : '')} style={{ background: inkColor(c) }} onClick={() => { setPenColor(c); setTray(null); }} />)}</div>
      )}
      {tray === 'shapes' && (
        <div className="tray">
          {(['rect', 'ellipse', 'diamond', 'frame'] as const).map((k) => (
            <button key={k} className={'tool' + (shapeKind === k && tool === k ? ' on' : '')} aria-label={k} onClick={() => { setShapeKind(k); setTool(k); }}>
              <Icon n={k} />
            </button>
          ))}
        </div>
      )}

      {/* ---- toolbar */}
      {readOnly ? (viewOnlyBar ?? <div className="viewonly pill">View only</div>) : <nav className="toolbar" aria-label="Tools">
        <ToolBtn n="select" short="Select" label="Select (V)" on={tool === 'select'} onClick={() => setTool('select')} />
        <ToolBtn n="hand" label="Move around (H)" on={tool === 'hand'} onClick={() => setTool('hand')} className="desk" />
        <ToolBtn n="sticky" short="Note" label="Sticky note (S)" on={tool === 'sticky'} onClick={() => { if (tool === 'sticky') setTray(tray === 'sticky' ? null : 'sticky'); else { setTool('sticky'); say('Tap anywhere on the board to add a note. Tap Note again for colours.'); } }} dot={stickyColor} />
        <ToolBtn n="text" short="Text" label="Text (T)" on={tool === 'text'} onClick={() => { setTool('text'); say('Tap where you want to type.'); }} />
        <ToolBtn n={shapeKind} short="Shape" label="Shapes and frames" on={['rect', 'ellipse', 'diamond', 'frame'].includes(tool)} onClick={() => { if (!['rect', 'ellipse', 'diamond', 'frame'].includes(tool)) setTool(shapeKind); setTray(tray === 'shapes' ? null : 'shapes'); }} caret />
        <ToolBtn n="arrow" short="Arrow" label="Arrow (A)" on={tool === 'arrow'} onClick={() => setTool('arrow')} />
        <ToolBtn n="pen" short="Pen" label="Pen (P)" on={tool === 'pen'} onClick={() => { if (tool === 'pen') setTray(tray === 'pen' ? null : 'pen'); else setTool('pen'); }} dot={inkColor(penColor)} />
        <ToolBtn n="eraser" label="Eraser (E)" on={tool === 'eraser'} onClick={() => setTool('eraser')} className="desk" />
        <ToolBtn n="image" label="Add an image" on={false} onClick={() => fileRef.current?.click()} className="desk" />
        {awareness && <ToolBtn n="react" label="React or say something" on={tray === 'react'} onClick={() => setTray(tray === 'react' ? null : 'react')} className="desk" />}
        {onCommentAt && <ToolBtn n="comment" label="Comment (C)" on={tool === 'comment'} onClick={() => setTool(tool === 'comment' ? 'select' : 'comment')} className="desk" />}
        <ToolBtn n="more" short="More" label="More tools" on={tray === 'more' || tool === 'eraser' || tool === 'comment'} onClick={() => setTray(tray === 'more' ? null : 'more')} className="mob" />
        {onAi && <ToolBtn n="sparkle" short="AI" label="AI" on={aiOpen} onClick={() => { setTray(null); setAiOpen((o) => !o); }} className="ai-tool" />}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) addImage(f); e.target.value = ''; }} />
      </nav>}
      {aiOpen && onAi && (
        <AiPanel selected={selShapes} onClose={() => setAiOpen(false)} onRun={async (r) => {
          const res = await onAi({ ...r, at: r.action === 'diagram' ? viewCenter() : undefined });
          // apply the AI's changes as one edit of mine: it syncs to everyone and Undo takes it back in one step
          const ops = res.ops || {};
          undo.stopCapturing();
          doc.transact(() => {
            (ops.remove || []).forEach((id) => { if (shapeById(id)) deleteShapes([id]); });
            Object.entries(ops.update || {}).forEach(([id, p]) => { if (shapeById(id)) updateShape(id, p); });
            (ops.create || []).forEach((sh) => { const { z: _z, ...rest } = sh as Shape; createShape(rest); });
          }, LOCAL);
          undo.stopCapturing();
          const have = res.ids.filter((id) => shapeById(id));
          setSel(have.filter((id) => shapeById(id)?.type !== 'arrow' && shapeById(id)?.type !== 'frame'));
          fit(true, have);
          say(res.message, { label: 'Undo', run: () => { undo.undo(); say('Undone. Use Redo to bring it back.'); } });
        }} />
      )}
      {multi && (
        <div className="multibar" role="status">
          <span><b>{sel.length} selected</b><small>Tap items to add or remove. Drag on empty space to box-select.</small></span>
          <button className="textbtn" onClick={() => setSel(allShapes().map((x) => x.id))}>All</button>
          <button className="btn primary" onClick={() => setMulti(false)}>Done</button>
        </div>
      )}
      {tray === 'more' && (
        <div className="tray">
          <button className={'tool' + (multi ? ' on' : '')} aria-label="Select several" title="Select several" onClick={() => { setTray(null); setTool('select'); setMulti(!multi); }}><Icon n="multi" /></button>
          <button className={'tool' + (tool === 'eraser' ? ' on' : '')} aria-label="Eraser" onClick={() => setTool('eraser')}><Icon n="eraser" /></button>
          <button className="tool" aria-label="Add an image" onClick={() => { setTray(null); fileRef.current?.click(); }}><Icon n="image" /></button>
          {awareness && <button className="tool" aria-label="React or say something" onClick={() => setTray('react')}><Icon n="react" /></button>}
          {onCommentAt && <button className={'tool' + (tool === 'comment' ? ' on' : '')} aria-label="Comment" onClick={() => setTool('comment')}><Icon n="comment" /></button>}
          {!awareness && <button className="tool" aria-label="Hand tool" onClick={() => setTool('hand')}><Icon n="hand" /></button>}
        </div>
      )}
      {tray === 'react' && awareness && (
        <div className="tray react">
          {['👍', '❤️', '🎉', '😂', '🔥', '👀'].map((em) => <button key={em} className="emoji" onClick={() => { const c = viewCenter(); const cur = (awareness.getLocalState() as { cursor?: Pt } | null)?.cursor; awareness.setLocalStateField('reaction', { e: em, x: cur?.x ?? c.x, y: cur?.y ?? c.y, t: Date.now() }); }}>{em}</button>)}
          <button className="saybtn" onClick={() => { setTray(null); setChat(''); setChatOpen(true); }}>Say…</button>
        </div>
      )}
      {chatOpen && awareness && (
        <form className="chatbox" onSubmit={(e) => { e.preventDefault(); awareness.setLocalStateField('chat', { text: chat.trim().slice(0, 120), t: Date.now() }); setChatOpen(false); }}>
          <input autoFocus value={chat} maxLength={120} onChange={(e) => { setChat(e.target.value); awareness.setLocalStateField('chat', { text: e.target.value.slice(0, 120), t: Date.now() }); }} onKeyDown={(e) => { if (e.key === 'Escape') { setChatOpen(false); awareness.setLocalStateField('chat', null); } }} placeholder="Say something to everyone here" aria-label="Message" />
          <button type="submit">Send</button>
        </form>
      )}

      <div className="zoom pill desk">
        <button className="ib" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25)}><Icon n="minus" size={18} /></button>
        <button className="pct" onClick={() => fit(true)} title="Fit board (Shift 1)">{Math.round(cam.z * 100)}%</button>
        <button className="ib" aria-label="Zoom in" onClick={() => zoomAt(1.25)}><Icon n="plus" size={18} /></button>
      </div>
      <button className="fitbtn pill mob" aria-label="Fit board to screen" onClick={() => fit(true)}><Icon n="fit" size={20} /></button>

      {toast && <div className={'toast' + (toastAction ? ' with-action' : '')} role="status"><span>{toast}</span>{toastAction && <button onClick={() => { const a = toastAction; setToast(''); setToastAction(null); a.run(); }}>{toastAction.label}</button>}</div>}
    </div>
  );
}

function ToolBtn({ n, label, short, on, onClick, dot, caret, className = '' }: { n: string; label: string; short?: string; on: boolean; onClick: () => void; dot?: string; caret?: boolean; className?: string }) {
  return (
    <button className={'tool ' + className + (on ? ' on' : '') + (short ? ' labelled' : '')} aria-label={label} aria-pressed={on} title={label} onClick={onClick}>
      <Icon n={n} />
      {short && <span className="tlabel">{short}</span>}
      {dot && on && <span className="tdot" style={{ background: dot }} />}
      {caret && <span className="caret" />}
    </button>
  );
}
