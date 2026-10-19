import { useState, type CSSProperties, type ReactNode } from 'react';
import type { Shape } from './store';
import { FILLS, INKS, STICKY, inkColor } from './palette';
import Icon from './icons';

/** Text formatting that applies to a whole note, shape or text box. */
export type TextFormat = Pick<Shape, 'font' | 'size' | 'bold' | 'italic' | 'underline' | 'strike' | 'align' | 'textColor'>;

export const FONTS = [
  { id: 'sans', label: 'Sans', css: 'var(--font)' },
  { id: 'serif', label: 'Serif', css: "'Fraunces', Georgia, 'Times New Roman', serif" },
  { id: 'mono', label: 'Mono', css: "'JetBrains Mono', ui-monospace, Menlo, monospace" },
  { id: 'hand', label: 'Handwriting', css: "'Caveat', 'Segoe Print', 'Bradley Hand', cursive" },
] as const;
export const SIZE_STEPS = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96, 128];
const HIGHLIGHTS = ['none', '#FFE47A', '#B6EBC6', '#B9DCFF', '#FFC3A0', '#D8C8FF'];

export const FORMATTABLE = new Set(['sticky', 'text', 'rect', 'ellipse', 'diamond']);

/** The note's auto size shrinks long notes so they still fit. */
export const stickyAutoSize = (t = '') => { const n = t.length; return n > 180 ? 13 : n > 110 ? 15 : n > 60 ? 17 : 20; };

export function defaultSize(s: Shape) {
  if (s.type === 'text') return 24;
  if (s.type === 'sticky') return stickyAutoSize(s.text);
  return 17;
}
export const sizeOf = (s: Shape) => s.size || defaultSize(s);

export function textStyle(s: Shape): CSSProperties {
  const font = FONTS.find((f) => f.id === s.font) ?? FONTS[0];
  const deco = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ');
  // handwriting reads small, so it gets a little more size
  const size = sizeOf(s) * (s.font === 'hand' ? 1.18 : 1);
  return {
    fontFamily: font.css,
    fontSize: size,
    fontWeight: s.bold ? 700 : s.type === 'text' ? 600 : 500,
    fontStyle: s.italic ? 'italic' : 'normal',
    textDecoration: deco || 'none',
    textAlign: s.align || (s.type === 'text' ? 'left' : 'center'),
    ...(s.textColor && s.type !== 'text' ? { color: inkColor(s.textColor) } : {}),
  };
}

// ---- lists are real characters in the text, so they sync and edit like any other text
const PREFIX = /^(• |\d+\. )/;
export function listKind(text = ''): 'none' | 'bullet' | 'number' {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return 'none';
  if (lines.every((l) => l.startsWith('• '))) return 'bullet';
  if (lines.every((l) => /^\d+\. /.test(l))) return 'number';
  return 'none';
}
export function applyList(text = '', kind: 'none' | 'bullet' | 'number') {
  let n = 0;
  return text.split('\n').map((l) => {
    const bare = l.replace(PREFIX, '');
    if (kind === 'none') return bare;
    if (!bare.trim() && text.includes('\n')) return bare;
    return kind === 'bullet' ? `• ${bare}` : `${++n}. ${bare}`;
  }).join('\n');
}
/** Pressing Enter inside a list starts the next item; Enter on an empty item ends the list. */
export function continueList(value: string, caret: number): { value: string; caret: number } | null {
  const start = value.lastIndexOf('\n', caret - 1) + 1;
  const line = value.slice(start, caret);
  const m = /^(• |(\d+)\. )(.*)$/.exec(line);
  if (!m) return null;
  if (!m[3].trim() && caret === start + line.length) {
    const v = value.slice(0, start) + value.slice(caret);
    return { value: v, caret: start };
  }
  const next = m[2] ? `${Number(m[2]) + 1}. ` : '• ';
  const v = value.slice(0, caret) + '\n' + next + value.slice(caret);
  return { value: v, caret: caret + 1 + next.length };
}

type Pop = null | 'font' | 'size' | 'align' | 'list' | 'fill' | 'ink';

/** Keeps the text box focused while you press buttons, so you can format as you type. */
const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();

export function FormatBar({ shapes, editing, onPatch, onListChange, tail }: {
  shapes: Shape[];
  editing: boolean;
  onPatch: (p: Partial<Shape>) => void;
  onListChange: (kind: 'none' | 'bullet' | 'number') => void;
  tail?: ReactNode;
}) {
  const [pop, setPop] = useState<Pop>(null);
  const text = shapes.filter((s) => FORMATTABLE.has(s.type));
  const first = text[0];
  const toggle = (p: Pop) => setPop((x) => (x === p ? null : p));
  const all = (k: keyof Shape) => text.length > 0 && text.every((s) => !!s[k]);

  const types = new Set(shapes.map((s) => s.type));
  const only = (...t: string[]) => shapes.length > 0 && Array.from(types).every((x) => t.includes(x));
  const fill = only('sticky') ? { list: STICKY, key: 'color' as const, label: 'Note colour' }
    : only('rect', 'ellipse', 'diamond') ? { list: FILLS, key: 'color' as const, label: 'Fill' }
    : only('text') ? { list: HIGHLIGHTS, key: 'color' as const, label: 'Highlight' }
    : null;
  const lineOnly = only('pen', 'arrow');
  const inkKey: 'stroke' | 'textColor' = only('text', 'pen', 'arrow') ? 'stroke' : 'textColor';
  const curInk = first ? (inkKey === 'stroke' ? first.stroke : first.textColor) : shapes[0]?.stroke;
  const curFill = shapes[0]?.color;

  const size = first ? sizeOf(first) : 0;
  const autoSize = first?.type === 'sticky' && !first.size;
  const step = (dir: 1 | -1) => {
    const i = SIZE_STEPS.findIndex((v) => v >= size);
    const cur = i === -1 ? SIZE_STEPS.length - 1 : SIZE_STEPS[i] === size ? i : dir > 0 ? i - 1 : i;
    const next = SIZE_STEPS[Math.min(SIZE_STEPS.length - 1, Math.max(0, cur + dir))];
    onPatch({ size: next });
  };
  const font = FONTS.find((f) => f.id === (first?.font || 'sans')) ?? FONTS[0];
  const align = first?.align || (first?.type === 'text' ? 'left' : 'center');
  const list = listKind(first?.text);

  return (
    <div className="fmt-wrap" onPointerDown={keep} onMouseDown={keep}>
    <div className="fmt">
      {first && <>
        <div className="fmt-group">
          <button className={'fmt-btn font' + (pop === 'font' ? ' on' : '')} onClick={() => toggle('font')} aria-haspopup="true" aria-expanded={pop === 'font'} title="Font">
            <span style={{ fontFamily: font.css }}>{font.label}</span><Icon n="chev" size={14} />
          </button>
          <div className="stepper" role="group" aria-label="Text size">
            <button className="fmt-btn sq" onClick={() => step(-1)} aria-label="Smaller text" title="Smaller (Ctrl Shift <)"><Icon n="minus" size={16} /></button>
            <button className={'fmt-btn size' + (pop === 'size' ? ' on' : '')} onClick={() => toggle('size')} aria-label="Choose text size" title="Text size">{autoSize ? 'Auto' : size}</button>
            <button className="fmt-btn sq" onClick={() => step(1)} aria-label="Bigger text" title="Bigger (Ctrl Shift >)"><Icon n="plus" size={16} /></button>
          </div>
        </div>
        <div className="fmt-group">
          <button className={'fmt-btn sq' + (all('bold') ? ' act' : '')} aria-pressed={all('bold')} onClick={() => onPatch({ bold: !all('bold') })} title="Bold (Ctrl B)" aria-label="Bold"><b>B</b></button>
          <button className={'fmt-btn sq' + (all('italic') ? ' act' : '')} aria-pressed={all('italic')} onClick={() => onPatch({ italic: !all('italic') })} title="Italic (Ctrl I)" aria-label="Italic"><i className="serif-i">I</i></button>
          <button className={'fmt-btn sq' + (all('underline') ? ' act' : '')} aria-pressed={all('underline')} onClick={() => onPatch({ underline: !all('underline') })} title="Underline (Ctrl U)" aria-label="Underline"><u>U</u></button>
          <button className={'fmt-btn sq' + (all('strike') ? ' act' : '')} aria-pressed={all('strike')} onClick={() => onPatch({ strike: !all('strike') })} title="Strikethrough (Ctrl Shift X)" aria-label="Strikethrough"><s>S</s></button>
        </div>
        <div className="fmt-group">
          <button className={'fmt-btn sq' + (pop === 'align' ? ' on' : '')} onClick={() => toggle('align')} aria-label="Alignment" title="Alignment"><Icon n={`align-${align}`} size={19} /></button>
          <button className={'fmt-btn sq' + (pop === 'list' || list !== 'none' ? ' act' : '')} onClick={() => toggle('list')} aria-label="List" title="List"><Icon n={list === 'number' ? 'list-num' : 'list'} size={19} /></button>
        </div>
      </>}
      <div className="fmt-group">
        {fill && <button className={'fmt-btn sq' + (pop === 'fill' ? ' on' : '')} onClick={() => toggle('fill')} aria-label={fill.label} title={fill.label}>
          <span className={'chip' + (!curFill || curFill === 'none' ? ' none' : '')} style={{ background: curFill && curFill !== 'none' ? curFill : undefined }} />
        </button>}
        {(first || lineOnly) && <button className={'fmt-btn sq' + (pop === 'ink' ? ' on' : '')} onClick={() => toggle('ink')} aria-label={lineOnly ? 'Line colour' : 'Text colour'} title={lineOnly ? 'Line colour' : 'Text colour'}>
          <span className="ink-a" style={{ ['--ink-c' as string]: inkColor(curInk || 'ink') }}>{lineOnly ? <Icon n="pen" size={17} /> : 'A'}</span>
        </button>}
      </div>
      {tail && <div className="fmt-group">{tail}</div>}
    </div>

      {pop && (
        <div className="fmt-pop" role="menu">
          {pop === 'font' && FONTS.map((f) => (
            <button key={f.id} className={'pop-row' + (font.id === f.id ? ' on' : '')} onClick={() => { onPatch({ font: f.id === 'sans' ? undefined : f.id }); setPop(null); }}>
              <span style={{ fontFamily: f.css, fontSize: f.id === 'hand' ? 22 : 17 }}>{f.label}</span>{font.id === f.id && <Icon n="check" size={17} />}
            </button>
          ))}
          {pop === 'size' && (
            <div className="size-grid">
              {first?.type === 'sticky' && <button className={'pop-chip' + (autoSize ? ' on' : '')} onClick={() => { onPatch({ size: undefined }); setPop(null); }}>Auto</button>}
              {SIZE_STEPS.map((v) => <button key={v} className={'pop-chip' + (!autoSize && v === size ? ' on' : '')} onClick={() => { onPatch({ size: v }); setPop(null); }}>{v}</button>)}
            </div>
          )}
          {pop === 'align' && (['left', 'center', 'right'] as const).map((a) => (
            <button key={a} className={'pop-row' + (align === a ? ' on' : '')} onClick={() => { onPatch({ align: a }); setPop(null); }}>
              <span className="row-ic"><Icon n={`align-${a}`} size={18} />{a === 'left' ? 'Left' : a === 'center' ? 'Centre' : 'Right'}</span>{align === a && <Icon n="check" size={17} />}
            </button>
          ))}
          {pop === 'list' && (['none', 'bullet', 'number'] as const).map((k) => (
            <button key={k} className={'pop-row' + (list === k ? ' on' : '')} onClick={() => { onListChange(k); setPop(null); }}>
              <span className="row-ic"><Icon n={k === 'number' ? 'list-num' : k === 'bullet' ? 'list' : 'text'} size={18} />{k === 'none' ? 'No list' : k === 'bullet' ? 'Bullet list' : 'Numbered list'}</span>{list === k && <Icon n="check" size={17} />}
            </button>
          ))}
          {pop === 'fill' && fill && (
            <div className="swatches pop-sw">
              {fill.list.map((c) => <button key={c} aria-label={c === 'none' ? 'No highlight' : 'Colour'} className={'sw big' + (c === 'none' ? ' none' : '') + ((curFill || 'none') === c ? ' on' : '')} style={{ background: c === 'none' ? undefined : c }} onClick={() => { onPatch({ color: c === 'none' ? undefined : c }); setPop(null); }} />)}
            </div>
          )}
          {pop === 'ink' && (
            <div className="swatches pop-sw">
              {INKS.map((c) => <button key={c} aria-label="Colour" className={'sw big' + ((curInk || 'ink') === c ? ' on' : '')} style={{ background: inkColor(c) }} onClick={() => { onPatch(lineOnly ? { stroke: c } : { [inkKey]: c } as Partial<Shape>); setPop(null); }} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
