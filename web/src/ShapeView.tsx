import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SIZE_STEPS, continueList, sizeOf, textStyle } from './format';
import { getStroke } from 'perfect-freehand';
import { flushSync } from 'react-dom';
import type { Shape } from './store';
import { updateQuiet, updateShape } from './store';
import { inkColor } from './palette';
import { arrowPoints } from './geometry';

const DARK_TEXT = '#1B2333';

/**
 * Edits a shape's text in place. A hidden copy of the text sits under the textarea and sets its size,
 * so the box grows exactly like the finished text and wraps in the same places.
 */
function Editor({ s, onDone }: { s: Shape; onDone: () => void }) {
  const [value, setValue] = useState(s.text || '');
  const ref = useRef<HTMLTextAreaElement>(null);
  // someone else (or a list toggle) changed the text while I'm editing
  useEffect(() => {
    const ta = ref.current; const t = s.text || '';
    if (!ta || t === ta.value) return;
    const pos = ta.selectionStart, delta = t.length - ta.value.length;
    pending.current = Math.max(0, pos + delta);
    setValue(t);
  }, [s.text]);
  const pending = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pending.current === null || !ref.current) return;
    ref.current.setSelectionRange(pending.current, pending.current); pending.current = null;
  }, [value]);
  const commit = (v: string) => { setValue(v); updateShape(s.id, { text: v }); };
  return (
    <div className="edit-wrap">
      <span className="ghost" aria-hidden="true">{value + '\u200b'}</span>
      <textarea
        ref={ref}
        data-edit={s.id}
        className="edit"
        value={value}
        rows={1}
        onChange={(e) => commit(e.currentTarget.value)}
        onBlur={onDone}
        onKeyDown={(e) => {
          const ta = e.currentTarget;
          const mod = e.metaKey || e.ctrlKey;
          if (e.key === 'Escape' || (e.key === 'Enter' && mod)) { e.preventDefault(); ta.blur(); }
          else if (e.key === 'Enter' && !e.shiftKey) {
            const next = continueList(ta.value, ta.selectionStart);
            if (next) { e.preventDefault(); flushSync(() => commit(next.value)); ta.setSelectionRange(next.caret, next.caret); }
          } else if (mod && !e.altKey) {
            const k = e.key.toLowerCase();
            const toggle = (key: 'bold' | 'italic' | 'underline' | 'strike') => { e.preventDefault(); updateShape(s.id, { [key]: !s[key] }); };
            if (k === 'b') toggle('bold'); else if (k === 'i') toggle('italic'); else if (k === 'u') toggle('underline');
            else if (k === 'x' && e.shiftKey) toggle('strike');
            else if (e.shiftKey && (e.key === '>' || e.key === '.' || e.key === '<' || e.key === ',')) {
              e.preventDefault();
              const cur = sizeOf(s); const up = e.key === '>' || e.key === '.';
              const i = SIZE_STEPS.findIndex((v) => v >= cur);
              const at = i === -1 ? SIZE_STEPS.length - 1 : i;
              updateShape(s.id, { size: SIZE_STEPS[Math.min(SIZE_STEPS.length - 1, Math.max(0, at + (up ? (SIZE_STEPS[at] === cur ? 1 : 0) : -1)))] });
            }
          }
          e.stopPropagation();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        spellCheck
        autoCapitalize="sentences"
      />
    </div>
  );
}

export function strokePath(points: number[], size: number) {
  const pts: number[][] = [];
  for (let i = 0; i < points.length; i += 3) pts.push([points[i], points[i + 1], points[i + 2] ?? 0.5]);
  const outline = getStroke(pts, { size, thinning: 0.55, smoothing: 0.6, streamline: 0.45, simulatePressure: pts.every((p) => p[2] === 0.5) });
  if (!outline.length) return '';
  const d = outline.reduce((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length];
    acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    return acc;
  }, ['M', ...outline[0], 'Q'] as (string | number)[]);
  d.push('Z');
  return d.map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)).join(' ');
}

function TextBox({ s, editing, onDone }: { s: Shape; editing: boolean; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => { const h = Math.ceil(el.offsetHeight); if (Math.abs(h - s.h) > 1) updateQuiet(s.id, { h }); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [s.id, s.h, s.text, s.size, s.w, s.font, s.bold]);
  const st = textStyle(s);
  const hl = s.color && s.color !== 'none' ? s.color : undefined;
  return (
    <div ref={ref} data-id={s.id} className={'shape text' + (hl ? ' hl' : '')} style={{ left: s.x, top: s.y, width: s.w, ...st, color: inkColor(s.stroke), minHeight: (st.fontSize as number) * 1.3, background: hl, ...(hl ? { color: DARK_TEXT } : {}) }}>
      {editing ? <Editor s={s} onDone={onDone} /> : (s.text || <span className="placeholder">Type something</span>)}
    </div>
  );
}

function Geo({ s }: { s: Shape }) {
  const { w, h } = s;
  const fill = s.color || '#FFFFFF';
  const st = { fill, stroke: 'var(--shape-line)', strokeWidth: 2, vectorEffect: 'non-scaling-stroke' as const };
  return (
    <svg className="geo" width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {s.type === 'rect' && <rect x={1} y={1} width={Math.max(0, w - 2)} height={Math.max(0, h - 2)} rx={Math.min(14, w / 6, h / 6)} {...st} />}
      {s.type === 'ellipse' && <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - 1)} ry={Math.max(0, h / 2 - 1)} {...st} />}
      {s.type === 'diamond' && <path d={`M${w / 2} 1 L${w - 1} ${h / 2} L${w / 2} ${h - 1} L1 ${h / 2}Z`} strokeLinejoin="round" {...st} />}
    </svg>
  );
}

/** Notes and shapes grow taller when their text needs more room, so nothing is ever cut off. */
function useGrow(s: Shape, editing: boolean, pad: number) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const inner = el.querySelector<HTMLElement>('.label, .edit-wrap'); if (!inner) return;
    const check = () => {
      const need = Math.ceil(inner.scrollHeight + pad);
      if (need > s.h + 1) updateQuiet(s.id, { h: need });
    };
    check();
    const ro = new ResizeObserver(check); ro.observe(inner);
    return () => ro.disconnect();
  }, [s.id, s.h, s.w, s.text, s.size, s.font, s.bold, s.italic, editing, pad]);
  return ref;
}

function Sticky({ s, editing, onDone }: { s: Shape; editing: boolean; onDone: () => void }) {
  const ref = useGrow(s, editing, 36);
  return (
    <div ref={ref} data-id={s.id} className={'shape sticky' + (editing ? ' editing' : '')} style={{ left: s.x, top: s.y, width: s.w, height: s.h, background: s.color, color: DARK_TEXT, ...textStyle(s) }}>
      {editing ? <Editor s={s} onDone={onDone} /> : <div className="label">{s.text}</div>}
    </div>
  );
}

function GeoShape({ s, editing, onDone }: { s: Shape; editing: boolean; onDone: () => void }) {
  // a diamond only has room for text in its middle, about half its height
  const ref = useGrow(s, editing, s.type === 'diamond' ? s.h * 0.44 + 4 : s.type === 'ellipse' ? 36 : 22);
  return (
    <div ref={ref} data-id={s.id} className={'shape geo-wrap ' + s.type} style={{ left: s.x, top: s.y, width: s.w, height: s.h, color: DARK_TEXT, ...textStyle(s) }}>
      <Geo s={s} />
      {editing ? <Editor s={s} onDone={onDone} /> : <div className="label">{s.text}</div>}
    </div>
  );
}

export const ShapeView = memo(function ShapeView({ s, editing, onDone }: { s: Shape; editing: boolean; onDone: () => void }) {
  const pos = { left: s.x, top: s.y, width: s.w, height: s.h };
  switch (s.type) {
    case 'sticky':
      return <Sticky s={s} editing={editing} onDone={onDone} />;
    case 'text':
      return <TextBox s={s} editing={editing} onDone={onDone} />;
    case 'rect': case 'ellipse': case 'diamond':
      return <GeoShape s={s} editing={editing} onDone={onDone} />;
    case 'frame':
      return (
        <div className="shape frame" style={pos}>
          <div data-id={s.id} className="frame-title">{s.text || 'Frame'}</div>
          {editing && <div className="frame-edit"><Editor s={s} onDone={onDone} /></div>}
        </div>
      );
    case 'image':
      return (
        <div data-id={s.id} className="shape image" style={pos}>
          <img src={s.src} alt="" draggable={false} />
        </div>
      );
    case 'pen':
      return (
        <svg className="shape pen" style={{ left: s.x, top: s.y, overflow: 'visible' }} width={Math.max(1, s.w)} height={Math.max(1, s.h)}>
          <path data-id={s.id} d={strokePath(s.points || [], s.size || 5)} fill={inkColor(s.stroke)} />
        </svg>
      );
    default:
      return null;
  }
});

/** Arrows are drawn together because they follow whatever they are tied to. */
export function ArrowLayer({ arrows, lookup, selected }: { arrows: Shape[]; lookup: (id: string) => Shape | undefined; selected: Set<string> }) {
  return (
    <svg className="arrows" width={1} height={1}>
      {arrows.map((a) => {
        const { p1, p2 } = arrowPoints(a, lookup);
        const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const L = 14, spread = 0.45;
        const head = `M${p2.x - L * Math.cos(ang - spread)} ${p2.y - L * Math.sin(ang - spread)} L${p2.x} ${p2.y} L${p2.x - L * Math.cos(ang + spread)} ${p2.y - L * Math.sin(ang + spread)}`;
        const col = inkColor(a.stroke);
        const line = `M${p1.x} ${p1.y} L${p2.x} ${p2.y}`;
        return (
          <g key={a.id} className={selected.has(a.id) ? 'sel' : ''}>
            <path d={line} stroke={col} strokeWidth={2.2} fill="none" strokeLinecap="round" />
            <path d={head} stroke={col} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path data-id={a.id} d={line} stroke="transparent" strokeWidth={18} fill="none" className="hit" />
          </g>
        );
      })}
    </svg>
  );
}
