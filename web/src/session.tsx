import { useEffect, useRef, useState } from 'react';
import { doc, metaMap, allShapes, type Shape } from './store';
import type { Cam } from './geometry';
import Icon from './icons';

/* Timers, votes and presenting live in the board's shared doc, so they sync, survive refreshes and work for late joiners. */

export type TimerState = { endsAt: number; total: number; paused: boolean; remaining: number; by: string };
export type VoteState = { active: boolean; revealed: boolean; per: number; by: string; byId: string; startedAt: number };

/** Re-reads a value from the board's shared settings whenever anyone changes it. */
export function useMeta<T>(key: string, dep: unknown): T | null {
  const [v, set] = useState<T | null>(() => (metaMap.get(key) as T) ?? null);
  useEffect(() => {
    const m = metaMap;
    const read = () => set((m.get(key) as T) ?? null);
    read(); m.observe(read);
    return () => m.unobserve(read);
  }, [key, dep]);
  return v;
}
const setMeta = (key: string, value: unknown) => doc.transact(() => { if (value === null) metaMap.delete(key); else metaMap.set(key, value); }, 'session');

// ---------- timer
export const timer = {
  start(minutes: number, by: string, now: number) { setMeta('timer', { endsAt: now + minutes * 60000, total: minutes * 60000, paused: false, remaining: minutes * 60000, by }); },
  pause(t: TimerState, now: number) { setMeta('timer', { ...t, paused: true, remaining: Math.max(0, t.endsAt - now) }); },
  resume(t: TimerState, now: number) { setMeta('timer', { ...t, paused: false, endsAt: now + t.remaining }); },
  add(t: TimerState, ms: number, now: number) {
    if (t.paused) setMeta('timer', { ...t, remaining: t.remaining + ms, total: t.total + ms });
    else setMeta('timer', { ...t, endsAt: Math.max(now, t.endsAt) + ms, total: t.total + ms });
  },
  stop() { setMeta('timer', null); },
};

function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx(); const t0 = ctx.currentTime;
    [880, 1175, 1568].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t0 + i * 0.16); g.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.16 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.16 + 0.5);
      o.connect(g).connect(ctx.destination); o.start(t0 + i * 0.16); o.stop(t0 + i * 0.16 + 0.55);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* sound not allowed yet */ }
}

const fmt = (ms: number) => { const s = Math.ceil(Math.max(0, ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function TimerPill({ t, now, canEdit }: { t: TimerState; now: () => number; canEdit: boolean }) {
  const [, tick] = useState(0);
  const rang = useRef(false);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(i); }, []);
  const left = t.paused ? t.remaining : t.endsAt - now();
  const done = left <= 0;
  useEffect(() => { if (done && !rang.current && !t.paused) { rang.current = true; chime(); } if (!done) rang.current = false; }, [done, t.paused]);
  const pct = Math.max(0, Math.min(1, 1 - left / t.total));
  return (
    <div className={'timer' + (done ? ' done' : '') + (t.paused ? ' paused' : '')} role="timer" aria-live="polite">
      <svg className="timer-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" className="fg" style={{ strokeDashoffset: 94.25 * pct }} /></svg>
      <b>{done ? 'Time’s up' : fmt(left)}</b>
      {canEdit && <span className="timer-acts">
        {!done && (t.paused
          ? <button className="ib" aria-label="Resume timer" onClick={() => timer.resume(t, now())}><Icon n="play" size={17} /></button>
          : <button className="ib" aria-label="Pause timer" onClick={() => timer.pause(t, now())}><Icon n="pause" size={17} /></button>)}
        <button className="tbtn" aria-label="Add one minute" onClick={() => timer.add(t, 60000, now())}>+1 min</button>
        <button className="ib" aria-label="Stop timer" onClick={() => timer.stop()}><Icon n="close" size={17} /></button>
      </span>}
    </div>
  );
}

export function TimerPicker({ onPick }: { onPick: (min: number) => void }) {
  const [custom, setCustom] = useState('');
  return (
    <div className="stack">
      <p className="muted small">Everyone on the board sees the same countdown, and hears a chime when it ends.</p>
      <div className="tgrid">{[1, 2, 3, 5, 10, 15].map((m) => <button key={m} className="btn" onClick={() => onPick(m)}>{m} min</button>)}</div>
      <form className="invite" onSubmit={(e) => { e.preventDefault(); const m = Number(custom); if (m > 0 && m <= 180) onPick(m); }}>
        <input id="timer-min" inputMode="numeric" placeholder="Other length, in minutes" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="Minutes" />
        <button className="btn primary" disabled={!(Number(custom) > 0 && Number(custom) <= 180)}>Start</button>
      </form>
    </div>
  );
}

// ---------- voting
const votesMap = () => doc.getMap<string[]>('votes');

export function useVotes(dep: unknown) {
  const [v, set] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    const m = votesMap();
    const read = () => set(new Map(Array.from(m.entries())));
    read(); m.observe(read);
    return () => m.unobserve(read);
  }, [dep]);
  return v;
}

export const voting = {
  start(per: number, by: string, byId: string) {
    doc.transact(() => { votesMap().clear(); metaMap.set('vote', { active: true, revealed: false, per, by, byId, startedAt: Date.now() } satisfies VoteState); }, 'session');
  },
  /** Tapping a note gives it one of your votes; tapping again takes it back. */
  toggle(userId: string, shapeId: string, per: number) {
    const m = votesMap();
    const mine = m.get(userId) || [];
    const next = mine.includes(shapeId) ? mine.filter((x) => x !== shapeId) : mine.length < per ? [...mine, shapeId] : null;
    if (next) doc.transact(() => m.set(userId, next), 'session');
    return next !== null;
  },
  reveal(v: VoteState) { setMeta('vote', { ...v, active: false, revealed: true }); },
  close() { doc.transact(() => { metaMap.delete('vote'); votesMap().clear(); }, 'session'); },
};

export function tally(votes: Map<string, string[]>) {
  const count = new Map<string, number>();
  votes.forEach((ids) => ids.forEach((id) => count.set(id, (count.get(id) || 0) + 1)));
  return count;
}

/** Your own votes as dots while voting; everyone's totals once results are shown. */
export function VoteMarks({ cam, lookup, votes, me, state }: { cam: Cam; lookup: (id: string) => Shape | undefined; votes: Map<string, string[]>; me: string; state: VoteState }) {
  const counts = state.revealed ? tally(votes) : new Map((votes.get(me) || []).map((id) => [id, 1]));
  return (
    <div className="vote-marks">
      {Array.from(counts.entries()).map(([id, n]) => {
        const s = lookup(id); if (!s) return null;
        const left = (s.x + s.w) * cam.z + cam.x, top = s.y * cam.z + cam.y;
        return <span key={id} className={'vmark' + (state.revealed ? ' total' : '')} style={{ left, top }}>{state.revealed ? n : <Icon n="check" size={14} />}</span>;
      })}
    </div>
  );
}

export function VoteBar({ state, votes, me, isHost, onFocus }: { state: VoteState; votes: Map<string, string[]>; me: string; isHost: boolean; onFocus: (id: string) => void }) {
  const used = (votes.get(me) || []).length;
  if (state.revealed) {
    const ranked = Array.from(tally(votes).entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const label = (id: string) => (allShapes().find((s) => s.id === id)?.text || 'Note').split('\n')[0].slice(0, 48);
    return (
      <div className="votebar results" role="region" aria-label="Voting results">
        <div className="vb-head"><b>Results</b><small>{votes.size} {votes.size === 1 ? 'person' : 'people'} voted</small>{isHost && <button className="btn" onClick={() => voting.close()}>Done</button>}</div>
        {!ranked.length && <p className="muted small">No votes were cast.</p>}
        <ol>{ranked.map(([id, n], i) => <li key={id}><button onClick={() => onFocus(id)}><span className="rank">{i + 1}</span><span className="vt">{label(id)}</span><b>{n} {n === 1 ? 'vote' : 'votes'}</b></button></li>)}</ol>
      </div>
    );
  }
  return (
    <div className="votebar" role="region" aria-label="Voting">
      <span className="vb-dots" aria-hidden="true">{Array.from({ length: state.per }, (_, i) => <i key={i} className={i < state.per - used ? 'on' : ''} />)}</span>
      <span className="vb-text"><b>{state.per - used} of {state.per} votes left</b><small>Tap sticky notes to vote. Tap again to take a vote back.</small></span>
      {isHost && <button className="btn primary" onClick={() => voting.reveal(state)}>Show results</button>}
    </div>
  );
}

// ---------- presenting
/** Frames in reading order: rows from top to bottom, left to right within a row. */
export function slides(): Shape[] {
  const frames = allShapes().filter((s) => s.type === 'frame');
  return frames.sort((a, b) => (Math.abs(a.y - b.y) < 160 ? a.x - b.x : a.y - b.y));
}

export function PresentBar({ index, total, title, onPrev, onNext, onStop }: { index: number; total: number; title: string; onPrev: () => void; onNext: () => void; onStop: () => void }) {
  return (
    <div className="presentbar" role="region" aria-label="Presenting">
      <button className="ib" onClick={onPrev} disabled={index <= 0} aria-label="Previous frame"><Icon n="back" size={20} /></button>
      <span className="pb-title"><b>{title || 'Frame'}</b><small>{index + 1} of {total}</small></span>
      <button className="ib" onClick={onNext} disabled={index >= total - 1} aria-label="Next frame"><Icon n="next" size={20} /></button>
      <button className="btn" onClick={onStop}>Stop</button>
    </div>
  );
}

