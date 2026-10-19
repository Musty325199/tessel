import { useEffect, useState } from 'react';
import { allShapes } from './store';
import { exportBoard, renderToCanvas, saveFile, type ExportArea } from './export';
import { Sheet } from './ui';
import Icon from './icons';

/** Export a board, a frame or the selection as PNG or PDF, with a live preview of exactly what you'll get. */
export function ExportSheet({ title, selection, onClose, onDone }: { title: string; selection: string[]; onClose: () => void; onDone: (msg: string) => void }) {
  const frames = allShapes().filter((s) => s.type === 'frame');
  const [area, setArea] = useState<'board' | 'selection' | 'frame'>(selection.length ? 'selection' : 'board');
  const [frameId, setFrameId] = useState(frames[0]?.id || '');
  const [format, setFormat] = useState<'png' | 'pdf'>('png');
  const [bg, setBg] = useState<'paper' | 'white' | 'none'>('paper');
  const [scale, setScale] = useState(2);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const pick: ExportArea = area === 'board' ? { kind: 'board' } : area === 'frame' ? { kind: 'frame', id: frameId } : { kind: 'selection', ids: selection };
  const background = format === 'pdf' && bg === 'none' ? 'white' : bg;

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try { const c = await renderToCanvas(allShapes(), { area: pick, background, scale: 0.6 }); if (alive) { setPreview(c.toDataURL('image/png')); setErr(''); } }
      catch (e) { if (alive) { setPreview(''); setErr((e as Error).message); } }
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [area, frameId, background]);

  async function go(share: boolean) {
    setBusy(true); setErr('');
    try {
      const { blob, filename } = await exportBoard(allShapes(), { area: pick, background, scale, format, name: area === 'frame' ? `${title} ${frames.find((f) => f.id === frameId)?.text || 'frame'}` : title });
      const how = await saveFile(blob, filename, share);
      if (how !== 'cancelled') { onDone(how === 'shared' ? 'Shared.' : `Saved ${filename}.`); onClose(); }
    } catch (e) { setErr((e as Error).message || 'Export failed. Try again.'); }
    setBusy(false);
  }

  return (
    <Sheet title="Export" onClose={onClose}>
      <div className="exp-preview">{preview ? <img src={preview} alt="Preview of the export" /> : <span className="muted small">{err || 'Preparing preview…'}</span>}</div>
      <div className="exp-row"><span>What</span>
        <div className="seg wide" role="group" aria-label="What to export">
          <button className={area === 'board' ? 'on' : ''} onClick={() => setArea('board')}>Whole board</button>
          <button className={area === 'selection' ? 'on' : ''} disabled={!selection.length} onClick={() => setArea('selection')}>Selection{selection.length ? ` (${selection.length})` : ''}</button>
          <button className={area === 'frame' ? 'on' : ''} disabled={!frames.length} onClick={() => setArea('frame')}>A frame</button>
        </div>
      </div>
      {area === 'frame' && (
        <select id="export-frame" className="exp-select" value={frameId} onChange={(e) => setFrameId(e.target.value)} aria-label="Frame">
          {frames.map((f) => <option key={f.id} value={f.id}>{f.text || 'Frame'}</option>)}
        </select>
      )}
      <div className="exp-row"><span>Format</span>
        <div className="seg wide" role="group" aria-label="Format">
          <button className={format === 'png' ? 'on' : ''} onClick={() => setFormat('png')}>PNG image</button>
          <button className={format === 'pdf' ? 'on' : ''} onClick={() => setFormat('pdf')}>PDF</button>
        </div>
      </div>
      <div className="exp-row"><span>Background</span>
        <div className="seg wide" role="group" aria-label="Background">
          <button className={bg === 'paper' ? 'on' : ''} onClick={() => setBg('paper')}>Dotted</button>
          <button className={bg === 'white' ? 'on' : ''} onClick={() => setBg('white')}>White</button>
          <button className={bg === 'none' ? 'on' : ''} disabled={format === 'pdf'} onClick={() => setBg('none')}>None</button>
        </div>
      </div>
      <div className="exp-row"><span>Quality</span>
        <div className="seg wide" role="group" aria-label="Quality">
          {[1, 2, 3].map((k) => <button key={k} className={scale === k ? 'on' : ''} onClick={() => setScale(k)}>{k === 1 ? 'Normal' : k === 2 ? 'Sharp' : 'Print'}</button>)}
        </div>
      </div>
      {err && preview && <p className="form-err">{err}</p>}
      <div className="row">
        {coarse && <button className="btn primary" style={{ flex: 1 }} disabled={busy || !preview} onClick={() => go(true)}><Icon n="share" size={18} />{busy ? 'Preparing…' : 'Share'}</button>}
        <button className={'btn' + (coarse ? '' : ' primary')} style={{ flex: 1 }} disabled={busy || !preview} onClick={() => go(false)}><Icon n="download" size={18} />{busy ? 'Preparing…' : 'Download'}</button>
      </div>
    </Sheet>
  );
}
