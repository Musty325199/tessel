import { memo, useLayoutEffect, useRef } from 'react';
import { getStroke } from 'perfect-freehand';
import type { Shape } from './store';
import { updateQuiet, updateShape } from './store';
import { inkColor } from './palette';
import { arrowPoints } from './geometry';

const DARK_TEXT = '#1B2333';

function stickyFont(t = '') {
  const n = t.length;
  return n > 180 ? 13 : n > 110 ? 15 : n > 60 ? 17 : 20;
}

function Editor({ s, align = 'center', onDone }: { s: Shape; align?: 'center' | 'left'; onDone: () => void }) {
  return (
    <textarea
      data-edit={s.id}
      className={'edit ' + align}
      defaultValue={s.text || ''}
      onInput={(e) => updateShape(s.id, { text: e.currentTarget.value })}
      onBlur={onDone}
      onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.currentTarget.blur(); } e.stopPropagation(); }}
      onPointerDown={(e) => e.stopPropagation()}
      spellCheck
    />
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
  }, [s.id, s.h, s.text, s.size, s.w]);
  const fs = s.size || 24;
  return (
    <div ref={ref} data-id={s.id} className="shape text" style={{ left: s.x, top: s.y, width: s.w, fontSize: fs, color: inkColor(s.stroke), minHeight: fs * 1.3 }}>
      {editing ? <><span className="ghost">{(s.text || ' ') + ' '}</span><Editor s={s} align="left" onDone={onDone} /></> : (s.text || <span className="placeholder">Type something</span>)}
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

export const ShapeView = memo(function ShapeView({ s, editing, onDone }: { s: Shape; editing: boolean; onDone: () => void }) {
  const pos = { left: s.x, top: s.y, width: s.w, height: s.h };
  switch (s.type) {
    case 'sticky':
      return (
        <div data-id={s.id} className="shape sticky" style={{ ...pos, background: s.color, color: DARK_TEXT, fontSize: stickyFont(s.text) }}>
          {editing ? <Editor s={s} onDone={onDone} /> : <div className="label">{s.text}</div>}
        </div>
      );
    case 'text':
      return <TextBox s={s} editing={editing} onDone={onDone} />;
    case 'rect': case 'ellipse': case 'diamond':
      return (
        <div data-id={s.id} className={'shape geo-wrap ' + s.type} style={{ ...pos, color: DARK_TEXT }}>
          <Geo s={s} />
          {editing ? <Editor s={s} onDone={onDone} /> : <div className="label">{s.text}</div>}
        </div>
      );
    case 'frame':
      return (
        <div className="shape frame" style={pos}>
          <div data-id={s.id} className="frame-title">{s.text || 'Frame'}</div>
          {editing && <div className="frame-edit"><Editor s={s} align="left" onDone={onDone} /></div>}
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
