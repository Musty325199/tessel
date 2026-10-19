import { useCallback, useEffect, useRef, useState } from 'react';
import { useLock } from '../ui';
import Board, { type BoardApi } from '../Board';
import { api, auth, ago, freshToken, useUser, ApiError, WS_URL, type BoardInfo, type VersionInfo } from '../api';
import { metaMap, newDoc, openLocalBoard, undo, useUndoState, doc as currentDoc } from '../store';
import { BoardConnection, type Status } from '../sync';
import { Avatars, usePeers } from '../presence';
import { CommentLayer, CommentsList, pinPos, useComments, type Draft, type Person } from '../comments';
import { shapeById } from '../store';
import { PresentBar, TimerPicker, TimerPill, VoteBar, VoteMarks, slides, timer, useMeta, useVotes, voting, type TimerState, type VoteState } from '../session';
import { go, href, linkProps } from '../router';
import Icon, { Mark } from '../icons';
import { Avatar, Popover, Sheet, Spinner, ThemeSwitch, copyText } from '../ui';
import { drawThumbnail } from '../../../shared/thumbnail';
import type { TShape } from '../../../shared/templates';

export default function BoardPage({ id, k }: { id: string; k: string | null }) {
  const user = useUser();
  const [info, setInfo] = useState<BoardInfo | null>(null);
  const [error, setError] = useState<{ msg: string; signin?: boolean } | null>(null);
  const [conn, setConn] = useState<BoardConnection | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [role, setRole] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState('');
  const [panel, setPanel] = useState<null | 'share' | 'versions' | 'comments' | 'timer' | 'vote'>(null);
  const [votesPer, setVotesPer] = useState(3);
  const [presenting, setPresenting] = useState<number | null>(null);
  const [followPresenter, setFollowPresenter] = useState(true);
  const [openThread, setOpenThread] = useState<string | null>(() => new URLSearchParams(location.search).get('c'));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [menu, setMenu] = useState(false);
  const [following, setFollowing] = useState<number | null>(null);
  const boardApi = useRef<BoardApi | null>(null);
  useLock();
  const peers = usePeers(conn?.awareness ?? null);
  const comments = useComments(id, k, conn, !!user && !!info);
  // everyone who can be @mentioned: the owner, members, and anyone who just joined through the link
  const people: Person[] = (() => {
    const map = new Map<string, Person>();
    if (info) [info.owner, ...info.members].forEach((p) => map.set(p.id, { id: p.id, name: p.name, color: p.color }));
    peers.forEach((p) => { if (p.id && !map.has(p.id)) map.set(p.id, { id: p.id, name: p.name, color: p.color }); });
    return Array.from(map.values());
  })();
  const me: Person | null = user ? { id: user.id, name: user.name, color: user.color } : null;
  const openCount = comments.threads.filter((t) => !t.resolved).length;
  const timerState = useMeta<TimerState>('timer', conn);
  const voteState = useMeta<VoteState>('vote', conn);
  const votes = useVotes(conn);
  const now = () => conn?.now() ?? Date.now();
  const voterId = user?.id || '';

  // presenting: walk through frames; everyone following sees the same frame
  const deck = presenting !== null ? slides() : [];
  const presenter = peers.find((p) => !!conn?.awareness.getStates().get(p.clientId)?.presenting);
  const remoteSlide = presenter ? (conn?.awareness.getStates().get(presenter.clientId)?.presenting as { frameId: string } | undefined)?.frameId : undefined;
  useEffect(() => {
    if (!conn) return;
    conn.awareness.setLocalStateField('presenting', presenting !== null && deck[presenting] ? { frameId: deck[presenting].id } : null);
    if (presenting !== null && deck[presenting]) boardApi.current?.fit(true, [deck[presenting].id]);
  }, [presenting, conn]);
  useEffect(() => { if (remoteSlide && followPresenter && presenting === null) boardApi.current?.fit(true, [remoteSlide]); }, [remoteSlide, followPresenter, presenting]);
  useEffect(() => {
    if (presenting === null) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); setPresenting((i) => Math.min(slides().length - 1, (i ?? 0) + 1)); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); setPresenting((i) => Math.max(0, (i ?? 0) - 1)); }
      if (e.key === 'Escape') setPresenting(null);
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [presenting]);
  const { canUndo, canRedo } = useUndoState(conn);

  // load the board's details; joining through a share link adds it to your dashboard
  const loadInfo = useCallback(async () => {
    try {
      const q = k ? `?k=${encodeURIComponent(k)}` : '';
      let r = await api<{ board: BoardInfo }>(`/api/boards/${id}${q}`);
      const isMember = r.board.role === 'owner' || r.board.members.some((m) => m.id === auth.user()?.id);
      if (k && auth.signedIn() && !isMember) r = await api<{ board: BoardInfo }>(`/api/boards/${id}/join`, { method: 'POST', body: { k } });
      setInfo(r.board); setTitle(r.board.title);
      document.title = `${r.board.title} – Tessel`;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError({ msg: 'Sign in to open this board.', signin: true });
      else if (e instanceof ApiError && e.status !== 0) setError({ msg: e.message });
      // network errors: carry on with the copy saved on this device
    }
  }, [id, k]);
  useEffect(() => { loadInfo(); }, [loadInfo]);
  // a new face on the board means the member list changed: refresh it
  const knownIds = info ? new Set([info.owner.id, ...info.members.map((m) => m.id)]) : null;
  const unknownPeer = peers.some((p) => p.id && knownIds && !knownIds.has(p.id));
  useEffect(() => { if (unknownPeer) loadInfo(); }, [unknownPeer, loadInfo]);

  // open the doc: first the copy saved on this device, then live sync with the server
  useEffect(() => {
    const doc = newDoc();
    setLoaded(false);
    let local = false, remote = false;
    const done = () => { if (local && (remote || !navigator.onLine)) setLoaded(true); };
    const persistence = openLocalBoard(`board:${id}`, () => { local = true; done(); });
    const c = new BoardConnection(`${WS_URL}/ws/${id}`, doc, async () => ({ token: (await freshToken()) || undefined, k: k || undefined }), {
      status: (s) => { setStatus(s); if (s === 'offline') { remote = true; done(); } },
      role: (r) => setRole(r),
      synced: () => { remote = true; done(); },
    });
    const u = auth.user();
    c.awareness.setLocalStateField('user', { id: u?.id ?? null, name: u?.name || 'Guest', color: u?.color || '#5B6578' });
    setConn(c);
    // waking a sleeping server can take a while: show what's saved here in the meantime
    const t = setTimeout(() => { remote = true; done(); }, 4000);
    const onTitle = () => { const t = metaMap.get('title') as string | undefined; if (t) { setTitle(t); document.title = `${t} – Tessel`; } };
    metaMap.observe(onTitle);
    return () => { clearTimeout(t); metaMap.unobserve(onTitle); c.destroy(); persistence?.destroy(); setConn(null); };
  }, [id, k]);

  useEffect(() => {
    if (!conn || !user) return;
    conn.awareness.setLocalStateField('user', { id: user.id, name: user.name, color: user.color });
  }, [user, conn]);

  const canEdit = (role || info?.role) === 'owner' || (role || info?.role) === 'editor';
  const isOwner = (role || info?.role) === 'owner';

  async function rename(t: string) {
    const next = t.trim() || 'Untitled board';
    setTitle(next);
    currentDoc.transact(() => metaMap.set('title', next), 'quiet');
    try { const r = await api<{ board: BoardInfo }>(`/api/boards/${id}${k ? `?k=${k}` : ''}`, { method: 'PATCH', body: { title: next } }); setInfo(r.board); } catch { /* saved with the board and retried later */ }
  }

  if (error && status === 'denied' || (error && !info)) {
    return (
      <div className="gate">
        <Mark size={40} />
        <h1>{error!.signin ? 'Sign in to see this board' : 'You can’t open this board'}</h1>
        <p className="muted">{error!.msg}</p>
        <div className="row">
          {error!.signin ? <a className="btn primary" {...linkProps(`/login?next=${encodeURIComponent(location.pathname.replace(href(''), '') + location.search)}`)}>Sign in</a> : null}
          <a className="btn" {...linkProps(auth.signedIn() ? '/boards' : '/')}>{auth.signedIn() ? 'Back to my boards' : 'Go to Tessel'}</a>
        </div>
      </div>
    );
  }

  const statusLabel = status === 'online' ? 'Live' : status === 'connecting' ? 'Connecting…' : status === 'offline' ? 'Offline. Changes are saved here and sync when you’re back.' : 'No access';

  const top = (
    <>
      <div className="pill brand">
        <a className="logo" {...linkProps(auth.signedIn() ? '/boards' : '/')} aria-label="Back to my boards"><Mark size={24} /></a>
        <input id="board-title" className="title" aria-label="Board name" value={title} readOnly={!canEdit}
          onChange={(e) => setTitle(e.target.value)} onBlur={(e) => { if (canEdit && e.target.value !== info?.title) rename(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        <span className={'live ' + status} title={statusLabel} aria-label={statusLabel}><i /></span>
        {canEdit && <>
          <span className="sep" />
          <button className="ib" onClick={() => undo.undo()} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl Z)"><Icon n="undo" size={20} /></button>
          <button className="ib desk" onClick={() => undo.redo()} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl Shift Z)"><Icon n="redo" size={20} /></button>
        </>}
      </div>
      <div className="pill people">
        <Avatars peers={peers} me={user} following={following} onPick={(p) => boardApi.current?.follow(following === p.clientId ? null : p.clientId)} />
        {(canEdit || info?.linkAccess !== 'none') && info && <button className="share" onClick={() => setPanel('share')}><Icon n="share" size={18} /><span>Share</span></button>}
        <div className="rel">
          <button className="ib" data-pop-trigger aria-label="Board menu" onClick={() => setMenu((m) => !m)}><Icon n="more" size={20} /></button>
          <Popover open={menu} onClose={() => setMenu(false)}>
            <button onClick={() => { boardApi.current?.fit(true); setMenu(false); }}><Icon n="fit" size={18} />Fit board to screen</button>
            {canEdit && <button onClick={() => { setPanel('timer'); setMenu(false); }}><Icon n="timer" size={18} />{timerState ? 'Change the timer' : 'Start a timer'}</button>}
            {canEdit && user && !voteState && <button onClick={() => { setPanel('vote'); setMenu(false); }}><Icon n="vote" size={18} />Start voting</button>}
            <button onClick={() => { setMenu(false); if (!slides().length) boardApi.current?.say('Add frames to present. Each frame becomes a slide.'); else setPresenting(0); }}><Icon n="present" size={18} />Present frames</button>
            {info && user && <button onClick={() => { setPanel('comments'); setMenu(false); }}><Icon n="comment" size={18} />Comments{openCount ? ` (${openCount})` : ''}</button>}
            {info && <button onClick={() => { setPanel('versions'); setMenu(false); }}><Icon n="history" size={18} />Version history</button>}
            {auth.signedIn() && info && <button onClick={async () => { setMenu(false); try { const r = await api<{ board: BoardInfo }>(`/api/boards/${id}/duplicate${k ? `?k=${k}` : ''}`, { method: 'POST' }); go(`/b/${r.board.id}`); } catch (e) { boardApi.current?.say(e instanceof ApiError ? e.message : 'Could not duplicate.'); } }}><Icon n="copy" size={18} />Make a copy</button>}
            <ThemeSwitch />
            {auth.signedIn() ? <a className="menu-link" {...linkProps('/boards')}><Icon n="grid" size={18} />All my boards</a> : <a className="menu-link" {...linkProps(`/login?next=/b/${id}${k ? `?k=${k}` : ''}`)}><Icon n="logout" size={18} />Sign in</a>}
          </Popover>
        </div>
      </div>
    </>
  );

  return (
    <div className="board-page">
      <Board awareness={conn?.awareness} readOnly={!canEdit && !!(role || info)} loaded={loaded} top={top} onApi={(a) => { boardApi.current = a; }} onFollowChange={setFollowing}
        onAi={canEdit && user ? async (r) => api<{ ids: string[]; message: string }>(`/api/boards/${id}/ai${k ? `?k=${encodeURIComponent(k)}` : ''}`, { method: 'POST', body: r }) : undefined}
        tapOverride={voteState?.active ? (sh) => {
          if (sh.type !== 'sticky') return false;
          if (!canEdit || !voterId) { boardApi.current?.say('Only people who can edit the board can vote.'); return true; }
          if (!voting.toggle(voterId, sh.id, voteState.per)) boardApi.current?.say(`You’ve used all ${voteState.per} votes. Tap a voted note to take one back.`);
          return true;
        } : undefined}
        overlay={user && info ? (cam, lookup) => <>{voteState && <VoteMarks cam={cam} lookup={lookup} votes={votes} me={voterId} state={voteState} />}<CommentLayer threads={comments.threads} cam={cam} lookup={lookup} openId={openThread} setOpenId={setOpenThread} draft={draft} setDraft={setDraft} people={people} me={me} canModerate={canEdit} api={comments} showResolved={showResolved} /></> : undefined}
        onCommentAt={user && info ? (p, shape) => { setOpenThread(null); setDraft(shape ? { x: p.x, y: p.y, shapeId: shape.id, ox: p.x - shape.x, oy: p.y - shape.y } : { x: p.x, y: p.y, shapeId: null, ox: 0, oy: 0 }); } : undefined}
        viewOnlyBar={<ViewOnlyBar signedIn={!!user} linkEdit={info?.linkAccess === 'edit'} next={`/b/${id}${k ? `?k=${k}` : ''}`} onComment={() => boardApi.current?.startComment()} />} />
      {!loaded && <div className="board-loading"><Spinner label="Opening board" /><p>{status === 'connecting' ? 'Opening the board… a sleeping server can take up to a minute to wake.' : 'Opening the board…'}</p></div>}
      {timerState && <TimerPill t={timerState} now={now} canEdit={canEdit} />}
      {voteState && presenting === null && <VoteBar state={voteState} votes={votes} me={voterId} isHost={voteState.byId === voterId || isOwner} onFocus={(sid) => boardApi.current?.fit(true, [sid])} />}
      {presenting !== null && deck.length > 0 && <PresentBar index={presenting} total={deck.length} title={deck[presenting]?.text || ''} onPrev={() => setPresenting((i) => Math.max(0, (i ?? 0) - 1))} onNext={() => setPresenting((i) => Math.min(deck.length - 1, (i ?? 0) + 1))} onStop={() => setPresenting(null)} />}
      {presenter && presenting === null && <div className="presenting-note" role="status" style={{ ['--c' as string]: presenter.color }}><span>{presenter.name} is presenting</span><button onClick={() => { setFollowPresenter((f) => !f); if (!followPresenter && remoteSlide) boardApi.current?.fit(true, [remoteSlide]); }}>{followPresenter ? 'Stop following' : 'Follow'}</button></div>}
      {panel === 'timer' && <Sheet title="Timer" onClose={() => setPanel(null)}><TimerPicker onPick={(m) => { timer.start(m, user?.name || 'Someone', now()); setPanel(null); }} />{timerState && <button className="btn" onClick={() => { timer.stop(); setPanel(null); }}>Stop the current timer</button>}</Sheet>}
      {panel === 'vote' && <Sheet title="Start voting" onClose={() => setPanel(null)}>
        <p className="muted small">Everyone who can edit gets the same number of votes to put on sticky notes. Votes stay hidden until you show the results.</p>
        <div className="stepper big" role="group" aria-label="Votes per person">
          <button className="fmt-btn sq" onClick={() => setVotesPer((v) => Math.max(1, v - 1))} aria-label="Fewer votes"><Icon n="minus" size={18} /></button>
          <b>{votesPer} {votesPer === 1 ? 'vote' : 'votes'} each</b>
          <button className="fmt-btn sq" onClick={() => setVotesPer((v) => Math.min(10, v + 1))} aria-label="More votes"><Icon n="plus" size={18} /></button>
        </div>
        <button className="btn primary block" onClick={() => { voting.start(votesPer, user?.name || 'Someone', voterId); setPanel(null); }}>Start voting</button>
      </Sheet>}
      {status === 'offline' && loaded && <div className="offline-pill" role="status">Offline · your changes are saved on this device</div>}
      {panel === 'share' && info && <ShareSheet info={info} isOwner={isOwner} canEdit={canEdit} onChange={setInfo} onClose={() => setPanel(null)} />}
      {panel === 'comments' && <Sheet title="Comments" onClose={() => setPanel(null)}>
        <CommentsList threads={comments.threads} showResolved={showResolved} setShowResolved={setShowResolved} onPick={(t) => { setPanel(null); setDraft(null); setOpenThread(t.id); const p = pinPos(t, shapeById); boardApi.current?.panTo(p.x, p.y); }} />
      </Sheet>}
      {panel === 'versions' && info && <VersionsPanel id={id} k={k} canEdit={canEdit} onClose={() => setPanel(null)} onRestored={() => boardApi.current?.say('Version restored for everyone.')} />}
    </div>
  );
}

function ShareSheet({ info, isOwner, canEdit, onChange, onClose }: { info: BoardInfo; isOwner: boolean; canEdit: boolean; onChange: (b: BoardInfo) => void; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const link = info.linkToken ? `${location.origin}${href(`/b/${info.id}`)}?k=${info.linkToken}` : `${location.origin}${href(`/b/${info.id}`)}`;
  const run = async (fn: () => Promise<{ board?: BoardInfo }>, done?: string) => {
    setErr(''); setNote(''); setBusy(true);
    try { const r = await fn(); if (r.board) onChange(r.board); if (done) setNote(done); } catch (e) { setErr(e instanceof ApiError ? e.message : 'That didn’t work. Try again.'); }
    setBusy(false);
  };
  return (
    <Sheet title="Share this board" onClose={onClose}>
      {isOwner && (
        <form className="invite" onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/boards/${info.id}/members`, { method: 'POST', body: { email, role: inviteRole } }), `Invited ${email}.`).then(() => setEmail('')); }}>
          <input id="invite-email" type="email" inputMode="email" placeholder="Invite by email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email to invite" />
          <select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'editor')} aria-label="Their access">
            <option value="editor">Can edit</option><option value="viewer">Can view</option>
          </select>
          <button className="btn primary" disabled={busy || !email}>Invite</button>
        </form>
      )}
      {err && <p className="form-err" role="alert">{err}</p>}
      {note && <p className="form-ok" role="status">{note}</p>}

      <h3 className="sub">People on this board</h3>
      <ul className="people-list">
        <li><Avatar name={info.owner.name} color={info.owner.color} /><span><b>{info.owner.name}</b><small>{info.owner.email}</small></span><em>Owner</em></li>
        {info.members.map((m) => (
          <li key={m.id}>
            <Avatar name={m.name} color={m.color} />
            <span><b>{m.name}</b><small>{m.email}</small></span>
            {isOwner ? (
              <select id={`role-${m.id}`} value={m.role} aria-label={`${m.name}’s access`} onChange={(e) => {
                if (e.target.value === 'remove') run(async () => { await api(`/api/boards/${info.id}/members/${m.id}`, { method: 'DELETE' }); return api(`/api/boards/${info.id}`); }, `${m.name} was removed.`);
                else run(() => api(`/api/boards/${info.id}/members/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }));
              }}>
                <option value="editor">Can edit</option><option value="viewer">Can view</option><option value="remove">Remove</option>
              </select>
            ) : <em>{m.role === 'editor' ? 'Can edit' : 'Can view'}</em>}
          </li>
        ))}
      </ul>

      <h3 className="sub">Anyone with the link</h3>
      <div className="link-row">
        <Icon n="link" size={20} />
        {isOwner ? (
          <select id="link-access" value={info.linkAccess} aria-label="Link access" onChange={(e) => run(() => api(`/api/boards/${info.id}`, { method: 'PATCH', body: { linkAccess: e.target.value } }))}>
            <option value="none">No access</option><option value="view">Can view</option><option value="edit">Can edit (signed-in people)</option>
          </select>
        ) : <span>{info.linkAccess === 'none' ? 'Only invited people' : info.linkAccess === 'view' ? 'Can view' : 'Can edit'}</span>}
      </div>
      {(info.linkAccess !== 'none' || canEdit) && (
        <div className="copy-row">
          <input id="share-link" readOnly value={info.linkAccess === 'none' ? `${location.origin}${href(`/b/${info.id}`)}` : link} onFocus={(e) => e.currentTarget.select()} aria-label="Board link" />
          <button className="btn" onClick={async () => setNote((await copyText(info.linkAccess === 'none' ? `${location.origin}${href(`/b/${info.id}`)}` : link)) ? 'Link copied.' : 'Select the link and copy it.')}>Copy link</button>
        </div>
      )}
      {info.linkAccess === 'none' && <p className="muted small">The link only works for people you’ve invited. Turn on link access to share it more widely.</p>}
      {isOwner && info.linkAccess !== 'none' && <button className="textbtn small" onClick={() => run(() => api(`/api/boards/${info.id}/link/reset`, { method: 'POST' }), 'New link made. The old one no longer works.')}>Make a new link (stops the old one working)</button>}
    </Sheet>
  );
}

function VersionsPanel({ id, k, canEdit, onClose, onRestored }: { id: string; k: string | null; canEdit: boolean; onClose: () => void; onRestored: () => void }) {
  const [list, setList] = useState<VersionInfo[] | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  const q = k ? `?k=${encodeURIComponent(k)}` : '';
  const load = useCallback(() => api<{ versions: VersionInfo[] }>(`/api/boards/${id}/versions${q}`).then((r) => setList(r.versions)).catch((e) => setErr(e.message)), [id, q]);
  useEffect(() => { load(); }, [load]);

  async function show(v: VersionInfo) {
    setOpen(open === v.id ? null : v.id); setConfirm(null);
    if (preview[v.id] !== undefined) return;
    try { const r = await api<{ shapes: TShape[] }>(`/api/boards/${id}/versions/${v.id}${q}`); setPreview((p) => ({ ...p, [v.id]: drawThumbnail(r.shapes) })); } catch { setPreview((p) => ({ ...p, [v.id]: '' })); }
  }

  return (
    <Sheet title="Version history" onClose={onClose}>
      <p className="muted small">Tessel saves a version every 10 minutes while people edit. Save one yourself before big changes.</p>
      {canEdit && (
        <form className="invite" onSubmit={async (e) => {
          e.preventDefault(); setErr('');
          try { await api(`/api/boards/${id}/versions${q}`, { method: 'POST', body: { name: name || `Saved ${new Date().toLocaleString()}` } }); setName(''); load(); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not save.'); }
        }}>
          <input id="version-name" placeholder="Name this version, e.g. Before the review" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Version name" />
          <button className="btn primary">Save version</button>
        </form>
      )}
      {err && <p className="form-err">{err}</p>}
      {!list && !err && <div className="center-pad"><Spinner /></div>}
      {list && !list.length && <p className="muted">No versions yet. The first one is saved after your first edits.</p>}
      <ul className="versions">
        {list?.map((v) => (
          <li key={v.id} className={open === v.id ? 'open' : ''}>
            <button className="v-row" onClick={() => show(v)} aria-expanded={open === v.id}>
              <span className={'v-dot' + (v.auto ? '' : ' named')} />
              <span className="v-main"><b>{v.name || 'Auto-save'}</b><small>{ago(v.createdAt)}{v.by ? ` by ${v.by.name}` : ''} · {v.shapeCount} {v.shapeCount === 1 ? 'item' : 'items'}</small></span>
            </button>
            {open === v.id && (
              <div className="v-detail">
                <div className="thumb wide">{preview[v.id] === undefined ? <Spinner /> : preview[v.id] ? <span dangerouslySetInnerHTML={{ __html: preview[v.id] }} /> : <span className="blank">Empty board</span>}</div>
                {canEdit && (confirm === v.id
                  ? <div className="row"><span className="small">Everyone will see the board change.</span><button className="btn primary" onClick={async () => { try { await api(`/api/boards/${id}/versions/${v.id}/restore${q}`, { method: 'POST' }); onRestored(); onClose(); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not restore.'); } }}>Restore</button><button className="btn" onClick={() => setConfirm(null)}>Cancel</button></div>
                  : <button className="btn" onClick={() => setConfirm(v.id)}>Restore this version</button>)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** Tells view-only visitors why they can't edit, and how to change that. */
function ViewOnlyBar({ signedIn, linkEdit, next, onComment }: { signedIn: boolean; linkEdit: boolean; next: string; onComment: () => void }) {
  const q = `?next=${encodeURIComponent(next)}`;
  if (signedIn) return <div className="viewonly pill cta"><span>View only. You can still leave comments.</span><button className="btn" onClick={onComment}><Icon n="comment" size={17} />Comment</button></div>;
  return (
    <div className="viewonly pill cta">
      <span>{linkEdit ? 'You can view this board. Sign in to edit.' : 'You can view this board. Sign in to save it to your boards.'}</span>
      <a className="btn primary" {...linkProps(`/login${q}`)}>{linkEdit ? 'Sign in to edit' : 'Sign in'}</a>
      <a className="textbtn" {...linkProps(`/signup${q}`)}>Create account</a>
    </div>
  );
}
