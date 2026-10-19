import type { Shape } from './store';
import { arrowPoints, boundsOf, contains, union, type Box } from './geometry';
import { sizeOf } from './format';
import { strokePath } from './ShapeView';

/* Draws a board onto a canvas without the browser's DOM, so exports look the same on every device. */

const FAMILY: Record<string, string> = {
  sans: "'Bricolage Grotesque Variable', system-ui, sans-serif",
  serif: "'Fraunces Variable', Georgia, serif",
  mono: "'JetBrains Mono Variable', Menlo, monospace",
  hand: "'Caveat', 'Segoe Print', cursive",
};
const DARK = '#1B2333';
const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const ink = (c?: string) => (!c || c === 'ink' ? css('--ink', DARK) : c);

export type ExportArea = { kind: 'board' } | { kind: 'selection'; ids: string[] } | { kind: 'frame'; id: string };
export type ExportOptions = { area: ExportArea; background: 'paper' | 'white' | 'none'; scale: number };

/** Which shapes an export includes: a frame takes everything inside it. */
export function pick(all: Shape[], area: ExportArea) {
  const lookup = (id: string) => all.find((s) => s.id === id);
  if (area.kind === 'board') return all;
  if (area.kind === 'frame') {
    const f = lookup(area.id); if (!f) return [];
    return all.filter((s) => s.id === f.id || contains(f, boundsOf(s, lookup)));
  }
  const ids = new Set(area.ids);
  // arrows between selected shapes come along too
  all.forEach((s) => { if (s.type === 'arrow' && s.from?.id && s.to?.id && ids.has(s.from.id) && ids.has(s.to.id)) ids.add(s.id); });
  return all.filter((s) => ids.has(s.id));
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const out: string[] = [];
  text.split('\n').forEach((para) => {
    const words = para.split(/(\s+)/);
    let line = '';
    words.forEach((w) => {
      const test = line + w;
      if (ctx.measureText(test).width <= width || !line.trim()) {
        // a single word longer than the box is broken by characters
        if (ctx.measureText(test).width > width && !line.trim()) {
          let chunk = '';
          for (const ch of test) { if (ctx.measureText(chunk + ch).width > width && chunk) { out.push(chunk); chunk = ch; } else chunk += ch; }
          line = chunk;
        } else line = test;
      } else { out.push(line.trimEnd()); line = w.trimStart(); }
    });
    out.push(line.trimEnd());
  });
  return out;
}

function drawText(ctx: CanvasRenderingContext2D, s: Shape, box: Box, opts: { color: string; valign: 'middle' | 'top'; lh: number; pad: number }) {
  if (!s.text) return;
  const size = sizeOf(s) * (s.font === 'hand' ? 1.18 : 1);
  const weight = s.bold ? 700 : s.type === 'text' ? 600 : 500;
  ctx.font = `${s.italic ? 'italic ' : ''}${weight} ${size}px ${FAMILY[s.font || 'sans'] || FAMILY.sans}`;
  ctx.fillStyle = opts.color;
  ctx.textBaseline = 'alphabetic';
  const width = Math.max(10, box.w - opts.pad * 2);
  const lines = wrap(ctx, s.text, width);
  const lh = size * opts.lh;
  const total = lines.length * lh;
  let y = opts.valign === 'middle' ? box.y + (box.h - total) / 2 : box.y + opts.pad;
  const align = s.align || (s.type === 'text' ? 'left' : 'center');
  lines.forEach((ln) => {
    const w = ctx.measureText(ln).width;
    const x = align === 'left' ? box.x + opts.pad : align === 'right' ? box.x + box.w - opts.pad - w : box.x + (box.w - w) / 2;
    const base = y + lh * 0.78;
    ctx.fillText(ln, x, base);
    if (s.underline || s.strike) {
      ctx.fillRect(x, s.strike ? base - size * 0.3 : base + size * 0.12, w, Math.max(1, size / 14));
    }
    y += lh;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | [number, number, number, number]) {
  const [a, b, c, d] = typeof r === 'number' ? [r, r, r, r] : r;
  ctx.beginPath();
  ctx.moveTo(x + a, y); ctx.lineTo(x + w - b, y); ctx.quadraticCurveTo(x + w, y, x + w, y + b);
  ctx.lineTo(x + w, y + h - c); ctx.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
  ctx.lineTo(x + d, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - d);
  ctx.lineTo(x, y + a); ctx.quadraticCurveTo(x, y, x + a, y); ctx.closePath();
}

const loadImage = (src: string) => new Promise<HTMLImageElement | null>((res) => {
  const img = new Image(); img.crossOrigin = 'anonymous';
  img.onload = () => res(img); img.onerror = () => res(null); img.src = src;
});

export async function renderToCanvas(all: Shape[], opts: ExportOptions) {
  const shapes = pick(all, opts.area);
  const lookup = (id: string) => all.find((s) => s.id === id);
  const b = union(shapes.map((s) => boundsOf(s, lookup)).map((x) => ({ ...x, y: x.y - 30, h: x.h + 30 })));
  if (!b) throw new Error('There’s nothing to export yet.');
  const pad = 48;
  const box = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  // keep the image under ~16 million pixels so phones can handle it
  const scale = Math.min(opts.scale, Math.sqrt(16e6 / (box.w * box.h)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(box.w * scale); canvas.height = Math.ceil(box.h * scale);
  const ctx = canvas.getContext('2d')!;
  await document.fonts?.ready;
  ctx.scale(scale, scale); ctx.translate(-box.x, -box.y);

  if (opts.background !== 'none') {
    ctx.fillStyle = opts.background === 'white' ? '#FFFFFF' : css('--paper', '#ECEFF3');
    ctx.fillRect(box.x, box.y, box.w, box.h);
    if (opts.background === 'paper') {
      ctx.fillStyle = css('--dot', '#BDC5D0');
      for (let x = Math.ceil(box.x / 24) * 24; x < box.x + box.w; x += 24) for (let y = Math.ceil(box.y / 24) * 24; y < box.y + box.h; y += 24) { ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  const images = new Map<string, HTMLImageElement | null>();
  await Promise.all(shapes.filter((s) => s.type === 'image' && s.src).map(async (s) => images.set(s.id, await loadImage(s.src!))));

  const order = [...shapes.filter((s) => s.type === 'frame'), ...shapes.filter((s) => s.type !== 'frame' && s.type !== 'arrow'), ...shapes.filter((s) => s.type === 'arrow')];
  for (const s of order) {
    ctx.save();
    switch (s.type) {
      case 'frame': {
        roundRect(ctx, s.x, s.y, s.w, s.h, 18);
        ctx.fillStyle = css('--frame-bg', 'rgba(255,255,255,.55)'); ctx.fill();
        ctx.strokeStyle = css('--frame-line', '#CDD4DD'); ctx.lineWidth = 1; ctx.stroke();
        ctx.font = `600 15px ${FAMILY.sans}`; ctx.fillStyle = css('--ink-2', '#5B6578');
        ctx.fillText(s.text || 'Frame', s.x + 8, s.y - 12);
        break;
      }
      case 'sticky': {
        ctx.shadowColor = 'rgba(27,35,51,.18)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
        roundRect(ctx, s.x, s.y, s.w, s.h, [3, 3, 18, 3]); ctx.fillStyle = s.color || '#FFE47A'; ctx.fill();
        ctx.shadowColor = 'transparent';
        drawText(ctx, s, s, { color: s.textColor ? ink(s.textColor) : DARK, valign: 'middle', lh: 1.22, pad: 18 });
        break;
      }
      case 'rect': case 'ellipse': case 'diamond': {
        ctx.beginPath();
        if (s.type === 'rect') roundRect(ctx, s.x + 1, s.y + 1, s.w - 2, s.h - 2, Math.min(14, s.w / 6, s.h / 6));
        else if (s.type === 'ellipse') ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2 - 1, s.h / 2 - 1, 0, 0, Math.PI * 2);
        else { ctx.moveTo(s.x + s.w / 2, s.y + 1); ctx.lineTo(s.x + s.w - 1, s.y + s.h / 2); ctx.lineTo(s.x + s.w / 2, s.y + s.h - 1); ctx.lineTo(s.x + 1, s.y + s.h / 2); ctx.closePath(); }
        ctx.fillStyle = s.color || '#FFFFFF'; ctx.fill();
        ctx.strokeStyle = css('--shape-line', DARK); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
        const inner = s.type === 'diamond' ? { x: s.x + s.w * 0.2, y: s.y + s.h * 0.22, w: s.w * 0.6, h: s.h * 0.56 } : { x: s.x, y: s.y, w: s.w, h: s.h };
        drawText(ctx, s, inner, { color: s.textColor ? ink(s.textColor) : DARK, valign: 'middle', lh: 1.2, pad: s.type === 'diamond' ? 0 : 16 });
        break;
      }
      case 'text': {
        const hl = s.color && s.color !== 'none' ? s.color : null;
        if (hl) { roundRect(ctx, s.x, s.y, s.w, s.h, 8); ctx.fillStyle = hl; ctx.fill(); }
        drawText(ctx, s, { x: s.x, y: s.y, w: s.w, h: s.h }, { color: hl ? DARK : ink(s.stroke), valign: 'top', lh: 1.18, pad: hl ? 6 : 2 });
        break;
      }
      case 'image': {
        const img = images.get(s.id);
        roundRect(ctx, s.x, s.y, s.w, s.h, 10); ctx.clip();
        if (img) {
          // same as object-fit: cover
          const k = Math.max(s.w / img.width, s.h / img.height);
          const w = img.width * k, h = img.height * k;
          ctx.drawImage(img, s.x + (s.w - w) / 2, s.y + (s.h - h) / 2, w, h);
        } else { ctx.fillStyle = '#9AA5B4'; ctx.fillRect(s.x, s.y, s.w, s.h); }
        break;
      }
      case 'pen': {
        ctx.translate(s.x, s.y);
        ctx.fillStyle = ink(s.stroke);
        ctx.fill(new Path2D(strokePath(s.points || [], s.size || 5)));
        break;
      }
      case 'arrow': {
        const { p1, p2 } = arrowPoints(s, lookup);
        const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x), L = 14, sp = 0.45;
        ctx.strokeStyle = ink(s.stroke); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p2.x - L * Math.cos(ang - sp), p2.y - L * Math.sin(ang - sp)); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p2.x - L * Math.cos(ang + sp), p2.y - L * Math.sin(ang + sp)); ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }
  return canvas;
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the image.'))), 'image/png'));

export async function exportBoard(all: Shape[], opts: ExportOptions & { format: 'png' | 'pdf'; name: string }) {
  const canvas = await renderToCanvas(all, opts);
  const safe = (opts.name || 'board').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'board';
  if (opts.format === 'png') return { blob: await toBlob(canvas), filename: `${safe}.png` };
  const { jsPDF } = await import('jspdf');
  const w = canvas.width, h = canvas.height;
  const pdf = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'px', format: [w, h], hotfixes: ['px_scaling'] });
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, h);
  return { blob: pdf.output('blob'), filename: `${safe}.pdf` };
}

/** Saves a file: the share sheet on phones (so it can go straight to WhatsApp), a download elsewhere. */
export async function saveFile(blob: Blob, filename: string, preferShare: boolean) {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (preferShare && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: filename }); return 'shared'; } catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}
