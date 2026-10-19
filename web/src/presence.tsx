import { useEffect, useRef, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { Cam } from './geometry';
import { boundsOf, union } from './geometry';
import type { Shape } from './store';

export type Peer = {
  clientId: number;
  id: string | null;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selection: string[];
  view: { x: number; y: number; w: number; h: number } | null;
  chat: { text: string; t: number } | null;
  reaction: { e: string; x: number; y: number; t: number } | null;
};

type State = Partial<Omit<Peer, 'clientId' | 'name' | 'color' | 'id'>> & { user?: { id?: string | null; name: string; color: string } };

/** Everyone else on the board right now, updated live. */
export function usePeers(awareness: Awareness | null): Peer[] {
  const [peers, set] = useState<Peer[]>([]);
  useEffect(() => {
    if (!awareness) { set([]); return; }
    const read = () => {
      const out: Peer[] = [];
      awareness.getStates().forEach((raw, clientId) => {
        const s = raw as State;
        if (clientId === awareness.clientID || !s?.user) return;
        out.push({
          clientId, id: s.user.id ?? null, name: s.user.name || 'Guest', color: s.user.color || '#5B6578',
          cursor: s.cursor ?? null, selection: Array.isArray(s.selection) ? s.selection : [], view: s.view ?? null,
          chat: s.chat ?? null, reaction: s.reaction ?? null,
        });
      });
      set(out);
    };
    read();
    awareness.on('change', read);
    return () => awareness.off('change', read);
  }, [awareness]);
  return peers;
}

/** One avatar per person, even if they have the board open in two tabs. */
export function uniquePeople(peers: Peer[]) {
  const seen = new Map<string, Peer>();
  peers.forEach((p) => { const key = p.id || `c${p.clientId}`; if (!seen.has(key)) seen.set(key, p); });
  return Array.from(seen.values());
}

const CHAT_MS = 6000;

export function Cursors({ peers, cam }: { peers: Peer[]; cam: Cam }) {
  const [, tick] = useState(0);
  // re-render once a second so chat bubbles disappear on time
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="cursors" aria-hidden="true">
      {peers.filter((p) => p.cursor).map((p) => {
        const x = p.cursor!.x * cam.z + cam.x, y = p.cursor!.y * cam.z + cam.y;
        const talking = p.chat && p.chat.text && Date.now() - p.chat.t < CHAT_MS;
        return (
          <div key={p.clientId} className="cursor" style={{ transform: `translate(${x}px, ${y}px)`, ['--c' as string]: p.color }}>
            <svg width="20" height="22" viewBox="0 0 20 22"><path d="M2 2l15 7.2-6.5 1.9L7 18z" fill="var(--c)" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" /></svg>
            <span className={'tag' + (talking ? ' talk' : '')}>{talking ? p.chat!.text : p.name}</span>
          </div>
        );
      })}
    </div>
  );
}

export function RemoteSelections({ peers, cam, lookup }: { peers: Peer[]; cam: Cam; lookup: (id: string) => Shape | undefined }) {
  return (
    <>
      {peers.map((p) => {
        const shapes = p.selection.map(lookup).filter(Boolean) as Shape[];
        const b = union(shapes.map((s) => boundsOf(s, lookup)));
        if (!b) return null;
        return (
          <div key={p.clientId} className="rsel" style={{ left: b.x * cam.z + cam.x, top: b.y * cam.z + cam.y, width: b.w * cam.z, height: b.h * cam.z, ['--c' as string]: p.color }}>
            <span>{p.name}</span>
          </div>
        );
      })}
    </>
  );
}

type Burst = { key: string; e: string; x: number; y: number; dx: number };

/** Emoji reactions float up from where they were sent. */
export function Reactions({ peers, cam }: { peers: Peer[]; cam: Cam }) {
  const seen = useRef(new Map<number, number>());
  const [bursts, setBursts] = useState<Burst[]>([]);
  useEffect(() => {
    const fresh: Burst[] = [];
    peers.forEach((p) => {
      const r = p.reaction; if (!r) return;
      const last = seen.current.get(p.clientId);
      seen.current.set(p.clientId, r.t);
      if (last === undefined && Date.now() - r.t > 3000) return; // old reaction from before I arrived
      if (last !== r.t && Date.now() - r.t < 5000) fresh.push({ key: `${p.clientId}-${r.t}`, e: r.e, x: r.x, y: r.y, dx: Math.random() * 40 - 20 });
    });
    if (!fresh.length) return;
    setBursts((b) => [...b, ...fresh]);
    const t = setTimeout(() => setBursts((b) => b.filter((x) => !fresh.includes(x))), 1800);
    return () => clearTimeout(t);
  }, [peers]);
  return (
    <div className="bursts" aria-hidden="true">
      {bursts.map((b) => <span key={b.key} className="burst" style={{ left: b.x * cam.z + cam.x, top: b.y * cam.z + cam.y, ['--dx' as string]: `${b.dx}px` }}>{b.e}</span>)}
    </div>
  );
}

export function Avatars({ peers, me, onPick, following }: { peers: Peer[]; me?: { name: string; color: string } | null; onPick?: (p: Peer) => void; following?: number | null }) {
  const people = uniquePeople(peers);
  const shown = people.slice(0, 4);
  const initial = (n: string) => (n.trim()[0] || '?').toUpperCase();
  return (
    <div className="avatars">
      {shown.map((p) => (
        <button key={p.clientId} className={'av' + (following === p.clientId ? ' on' : '')} style={{ background: p.color }} title={`${p.name}: tap to follow`} aria-label={`Follow ${p.name}`} onClick={() => onPick?.(p)}>
          {initial(p.name)}
        </button>
      ))}
      {people.length > 4 && <span className="av more">+{people.length - 4}</span>}
      {me && <span className="av me" style={{ background: me.color }} title="You">{initial(me.name)}</span>}
    </div>
  );
}
