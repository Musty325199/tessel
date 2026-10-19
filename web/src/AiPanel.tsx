import { useState } from 'react';
import type { Shape } from './store';
import Icon from './icons';

export type AiAction = 'organise' | 'summarise' | 'diagram' | 'expand';
export type AiRequest = { action: AiAction; ids?: string[]; prompt?: string; at?: { x: number; y: number } };
export type AiResult = { ids: string[]; message: string };

const IDEAS = ['How a food delivery order works', 'Signing up for a new app', 'Planning a product launch', 'Fixing a customer complaint'];

/** The AI menu. What it offers depends on what's selected. */
export function AiPanel({ selected, onRun, onClose }: { selected: Shape[]; onRun: (r: AiRequest) => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState<AiAction | null>(null);
  const [err, setErr] = useState('');
  const [prompt, setPrompt] = useState('');
  const notes = selected.filter((s) => s.type === 'sticky' && (s.text || '').trim());
  const one = selected.length === 1 && ['sticky', 'text', 'rect', 'ellipse', 'diamond'].includes(selected[0].type) && (selected[0].text || '').trim() ? selected[0] : null;

  async function run(r: AiRequest) {
    setErr(''); setBusy(r.action);
    try { await onRun(r); onClose(); } catch (e) { setErr((e as Error).message || 'The AI couldn’t do that. Try again.'); }
    setBusy(null);
  }

  return (
    <div className="ai-panel" role="dialog" aria-label="AI">
      <div className="ai-head">
        <span className="ai-badge"><Icon n="sparkle" size={18} /></span>
        <b>AI</b>
        <button className="ib" onClick={onClose} aria-label="Close"><Icon n="close" size={18} /></button>
      </div>
      {busy ? (
        <div className="ai-busy" role="status"><span className="ai-dots"><i /><i /><i /></span>{busy === 'diagram' ? 'Drawing your flowchart…' : busy === 'organise' ? 'Sorting your notes into themes…' : busy === 'expand' ? 'Growing new ideas…' : 'Reading the board…'}</div>
      ) : <>
        <button className="ai-opt" disabled={notes.length < 3} onClick={() => run({ action: 'organise', ids: selected.map((n) => n.id) })}>
          <Icon n="grid" size={20} />
          <span><b>Organise into groups</b><small>{notes.length >= 3 ? `Sort ${notes.length} selected notes into themes` : 'Select 3 or more sticky notes first'}</small></span>
        </button>
        <button className="ai-opt" disabled={!one} onClick={() => one && run({ action: 'expand', ids: [one.id] })}>
          <Icon n="branch" size={20} />
          <span><b>Grow ideas from this note</b><small>{one ? `5 new ideas around “${(one.text || '').slice(0, 28)}${(one.text || '').length > 28 ? '…' : ''}”` : 'Select one note first'}</small></span>
        </button>
        <button className="ai-opt" onClick={() => run({ action: 'summarise', ids: selected.length ? selected.map((s) => s.id) : undefined })}>
          <Icon n="text" size={20} />
          <span><b>Summarise</b><small>{selected.length ? 'What the selected items say, in a few points' : 'The whole board, in a few points'}</small></span>
        </button>
        <form className="ai-draw" onSubmit={(e) => { e.preventDefault(); if (prompt.trim().length >= 3) run({ action: 'diagram', prompt: prompt.trim() }); }}>
          <label htmlFor="ai-prompt"><b>Draw it for me</b><small>Describe a process and get a flowchart</small></label>
          <div className="ai-row">
            <input id="ai-prompt" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. how a customer returns an order" />
            <button className="btn primary" disabled={prompt.trim().length < 3}>Draw</button>
          </div>
          <div className="ai-chips">{IDEAS.map((t) => <button type="button" key={t} onClick={() => setPrompt(t)}>{t}</button>)}</div>
        </form>
      </>}
      {err && <p className="form-err" role="alert">{err}</p>}
      <p className="ai-foot">AI can make mistakes. Changes can be undone from Version history.</p>
    </div>
  );
}
