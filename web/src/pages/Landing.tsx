import { useEffect, useRef, useState } from 'react';
import Board from '../Board';
import { newDoc } from '../store';
import { BoardConnection, type Status } from '../sync';
import { Avatars, uniquePeople, usePeers } from '../presence';
import { WS_URL, auth, useUser } from '../api';
import { linkProps } from '../router';
import { Logo } from '../ui';

const ANIMALS = ['Kite', 'Otter', 'Heron', 'Lynx', 'Fox', 'Gecko', 'Ibis', 'Orca', 'Hare', 'Wren', 'Puffin', 'Koi'];
const COLORS = ['#2F5BFF', '#FF5A4E', '#12B5A6', '#8B5CF6', '#E69500', '#E0457B'];
export const REPO = 'https://github.com/Musty325199/tessel';

export default function Landing() {
  const user = useUser();
  const [conn, setConn] = useState<BoardConnection | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(false);
  const peers = usePeers(conn?.awareness ?? null);
  const guest = useRef({ name: `Guest ${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`, color: COLORS[Math.floor(Math.random() * COLORS.length)] });

  useEffect(() => {
    document.title = 'Tessel – a live whiteboard for teams';
    const doc = newDoc();
    const c = new BoardConnection(`${WS_URL}/ws/lobby`, doc, async () => ({ name: auth.user()?.name || guest.current.name }), {
      status: setStatus,
      synced: () => setLoaded(true),
    });
    const u = auth.user();
    c.awareness.setLocalStateField('user', { id: u?.id ?? null, name: u?.name || guest.current.name, color: u?.color || guest.current.color });
    setConn(c);
    const t = setTimeout(() => setLoaded(true), 6000);
    return () => { clearTimeout(t); c.destroy(); };
  }, []);

  const here = uniquePeople(peers).length + 1;
  const me = user ? { name: user.name, color: user.color } : guest.current;

  return (
    <div className="landing">
      <nav className="l-nav">
        <Logo />
        <div className="l-links">
          <a href="#built" className="desk">How it’s built</a>
          <a href={REPO} target="_blank" rel="noreferrer" className="desk">GitHub</a>
          {user ? <a className="btn primary" {...linkProps('/boards')}>My boards</a> : <>
            <a className="textlink" {...linkProps('/login')}>Sign in</a>
            <a className="btn primary" {...linkProps('/signup')}>Start free</a>
          </>}
        </div>
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <h1>Think it through together, on one board.</h1>
          <p className="lede">Tessel is a live whiteboard. Sticky notes, flowcharts and sketches show up for everyone the moment you add them, even on a slow connection.</p>
          <div className="row">
            <a className="btn primary big" {...linkProps(user ? '/boards' : '/signup')}>Start a free board</a>
            <a className="btn big" {...linkProps('/try')}>Try it without an account</a>
          </div>
          <p className="muted small">Free. No card. Works on your phone.</p>
        </div>

        <div className="hero-board">
          <div className="hb-bar">
            <span className={'live ' + status}><i /></span>
            <b>{status === 'online' ? `${here} ${here === 1 ? 'person' : 'people'} here right now` : status === 'connecting' ? 'Joining the live board…' : 'Live board is offline'}</b>
            <Avatars peers={peers} me={me} />
          </div>
          <div className={'hb-canvas' + (active ? ' active' : '')}>
            <Board awareness={conn?.awareness} loaded={loaded} embedded />
            {!active && (
              <button className="hb-gate" onClick={() => setActive(true)}>
                <span>Tap to draw with everyone here</span>
              </button>
            )}
            {active && <button className="hb-done" onClick={() => setActive(false)}>Done</button>}
          </div>
          <p className="hb-note">This board is shared by everyone on this page. It resets when the room empties.</p>
        </div>
      </header>

      <section className="features" aria-label="What you can do">
        <div className="feat">
          <div className="feat-art cursors-art" aria-hidden="true">
            <span className="fc a"><i />Ada</span><span className="fc b"><i />Tunde</span><span className="fc c"><i />You</span>
          </div>
          <h2>See everyone at work</h2>
          <p>Every person gets a named cursor. Watch ideas land as they’re written, or follow someone’s view to see what they see.</p>
        </div>
        <div className="feat">
          <div className="feat-art offline-art" aria-hidden="true"><span className="bar" /><span className="dot" /><span className="sync">Synced</span></div>
          <h2>Keep going offline</h2>
          <p>Lost signal on the bus? Keep editing. Your changes are saved on the phone and merge with everyone else’s the moment you reconnect.</p>
        </div>
        <div className="feat">
          <div className="feat-art history-art" aria-hidden="true"><i /><i /><i className="on" /><i /></div>
          <h2>Go back in time</h2>
          <p>Tessel saves versions as you work. Name the important ones and restore any of them for the whole team.</p>
        </div>
        <div className="feat">
          <div className="feat-art share-art" aria-hidden="true"><span>Can edit</span><span>Can view</span></div>
          <h2>Share the way you want</h2>
          <p>Invite people by email, or send one link. Choose who can edit and who can only look, and change it any time.</p>
        </div>
      </section>

      <section className="built" id="built">
        <div className="built-copy">
          <h2>How it’s built</h2>
          <p>Each board is a CRDT document (Yjs). Every browser keeps a full copy in IndexedDB and edits it locally, so the app works offline and never waits on the network. A Node.js server relays changes over WebSockets, checks who may edit, and saves boards to MongoDB with automatic version snapshots.</p>
          <ul className="chips">
            {['React', 'TypeScript', 'Yjs CRDT', 'WebSockets', 'Node.js', 'Express', 'MongoDB', 'IndexedDB', 'Vitest', 'GitHub Actions'].map((c) => <li key={c}>{c}</li>)}
          </ul>
          <a className="btn" href={REPO} target="_blank" rel="noreferrer">Read the code on GitHub</a>
        </div>
        <figure className="arch" aria-label="Architecture: browsers sync through a Node server that saves to MongoDB">
          <svg viewBox="0 0 520 300" role="img">
            <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--ink-2)" /></marker></defs>
            <g className="node"><rect x="10" y="20" width="160" height="96" rx="14" /><text x="90" y="56">Your browser</text><text x="90" y="80" className="s">React + Yjs</text><text x="90" y="98" className="s">IndexedDB copy</text></g>
            <g className="node"><rect x="10" y="184" width="160" height="96" rx="14" /><text x="90" y="220">Teammate</text><text x="90" y="244" className="s">React + Yjs</text><text x="90" y="262" className="s">IndexedDB copy</text></g>
            <g className="node hl"><rect x="230" y="100" width="150" height="100" rx="14" /><text x="305" y="138">Node server</text><text x="305" y="162" className="s">Rooms + permissions</text><text x="305" y="180" className="s">Version snapshots</text></g>
            <g className="node"><rect x="420" y="112" width="92" height="76" rx="14" /><text x="466" y="148">MongoDB</text><text x="466" y="168" className="s">Atlas</text></g>
            <path d="M170 68 C 205 68, 205 130, 228 135" className="edge" markerEnd="url(#ah)" markerStart="url(#ah)" />
            <path d="M170 232 C 205 232, 205 170, 228 165" className="edge" markerEnd="url(#ah)" markerStart="url(#ah)" />
            <path d="M380 150 L418 150" className="edge" markerEnd="url(#ah)" />
            <text x="200" y="104" className="lbl">WebSocket</text>
            <text x="200" y="208" className="lbl">WebSocket</text>
          </svg>
        </figure>
      </section>

      <footer className="l-foot">
        <span>Made by Musty in Lagos.</span>
        <a href={REPO} target="_blank" rel="noreferrer">Source on GitHub</a>
      </footer>
    </div>
  );
}
