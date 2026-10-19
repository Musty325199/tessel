import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ago, ApiError } from './api';
import type { BoardConnection } from './sync';
import type { Cam } from './geometry';
import type { Shape } from './store';
import Icon from './icons';

export type Person = { id: string; name: string; color: string };
export type CMsg = { id: string; text: string; mentions: string[]; createdAt: string; editedAt?: string; author: Person };
export type CThread = { id: string; x: number; y: number; shapeId: string | null; ox: number; oy: number; resolved: boolean; createdAt: string; updatedAt: string; messages: CMsg[] };
export type Draft = { x: number; y: number; shapeId: string | null; ox: number; oy: number };

/** Loads a board's comments and refreshes them whenever someone else changes one. */
export function useComments(boardId: string, k: string | null, conn: BoardConnection | null, enabled: boolean) {
  const [threads, setThreads] = useState<CThread[]>([]);
  const q = k ? `?k=${encodeURIComponent(k)}` : '';
  const base = `/api/boards/${boardId}/comments`;
  const reload = useCallback(async () => {
    if (!enabled) return;
    try { setThreads((await api<{ comments: CThread[] }>(base + q)).comments); } catch { /* keep what we have */ }
  }, [base, q, enabled]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => conn?.listen((m) => { if (m.type === 'comments' || m.type === 'ready') reload(); }), [conn, reload]);
  const upsert = (c: CThread) => setThreads((l) => (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [...l, c]));
  return {
    threads, reload,
    create: async (d: Draft, text: string, mentions: string[]) => { const r = await api<{ comment: CThread }>(base + q, { method: 'POST', body: { ...d, text, mentions } }); upsert(r.comment); return r.comment; },
    reply: async (id: string, text: string, mentions: string[]) => upsert((await api<{ comment: CThread }>(`${base}/${id}/replies${q}`, { method: 'POST', body: { text, mentions } })).comment),
    resolve: async (id: string, resolved: boolean) => upsert((await api<{ comment: CThread }>(`${base}/${id}${q}`, { method: 'PATCH', body: { resolved } })).comment),
    edit: async (id: string, mid: string, text: string) => upsert((await api<{ comment: CThread }>(`${base}/${id}/replies/${mid}${q}`, { method: 'PATCH', body: { text } })).comment),
    removeThread: async (id: string) => { await api(`${base}/${id}${q}`, { method: 'DELETE' }); setThreads((l) => l.filter((x) => x.id !== id)); },
    removeReply: async (id: string, mid: string) => { await api(`${base}/${id}/replies/${mid}${q}`, { method: 'DELETE' }); reload(); },
  };
}
export type CommentsApi = ReturnType<typeof useComments>;

/** Where a pin sits: on its shape if it has one (so it follows the shape), otherwise where it was dropped. */
export function pinPos(t: { x: number; y: number; shapeId: string | null; ox: number; oy: number }, lookup: (id: string) => Shape | undefined) {
  const s = t.shapeId ? lookup(t.shapeId) : undefined;
  return s ? { x: s.x + t.ox, y: s.y + t.oy } : { x: t.x, y: t.y };
}

const initial = (n: string) => (n.trim()[0] || '?').toUpperCase();
const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onDoubleClick: (e: React.MouseEvent) => e.stopPropagation() };

/** Shows @Name in bold colour for people who were mentioned. */
function Rich({ text, people }: { text: string; people: Person[] }) {
  const parts = useMemo(() => {
    const names = people.map((p) => p.name).filter(Boolean).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!names.length) return [text];
    return text.split(new RegExp(`(@(?:${names.join('|')}))`, 'g'));
  }, [text, people]);
  return <>{parts.map((p, i) => (p.startsWith('@') && i % 2 === 1 ? <b key={i} className="mention">{p}</b> : <span key={i}>{p}</span>))}</>;
}

/** A text box that suggests people when you type @, and remembers who you picked. */
function MentionBox({ people, placeholder, onSend, busy, autoFocus, initialText = '', sendLabel = 'Send' }: { people: Person[]; placeholder: string; onSend: (text: string, mentions: string[]) => Promise<void>; busy?: boolean; autoFocus?: boolean; initialText?: string; sendLabel?: string }) {
  const [text, setText] = useState(initialText);
  const [picked, setPicked] = useState<Person[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const matches = query === null ? [] : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  useEffect(() => { if (autoFocus) ref.current?.focus({ preventScroll: true }); }, [autoFocus]);
  const grow = () => { const t = ref.current; if (t) { t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; } };
  const detect = (v: string, caret: number) => { const m = /(?:^|\s)@([^\s@]{0,20})$/.exec(v.slice(0, caret)); setQuery(m ? m[1] : null); setHi(0); };
  const choose = (p: Person) => {
    const t = ref.current!; const caret = t.selectionStart;
    const start = text.slice(0, caret).lastIndexOf('@');
    const next = text.slice(0, start) + '@' + p.name + ' ' + text.slice(caret);
    setText(next); setPicked((l) => (l.some((x) => x.id === p.id) ? l : [...l, p])); setQuery(null);
    requestAnimationFrame(() => { const c = start + p.name.length + 2; t.focus(); t.setSelectionRange(c, c); grow(); });
  };
  const send = async () => {
    const v = text.trim(); if (!v || busy) return;
    const ids = picked.filter((p) => v.includes('@' + p.name)).map((p) => p.id);
    await onSend(v, ids); setText(''); setPicked([]); requestAnimationFrame(grow);
  };
  return (
    <div className="mbox">
      {matches.length > 0 && (
        <ul className="mlist" role="listbox">
          {matches.map((p, i) => (
            <li key={p.id}><button type="button" className={i === hi ? 'on' : ''} onPointerDown={(e) => { e.preventDefault(); choose(p); }}>
              <span className="av sm" style={{ background: p.color }}>{initial(p.name)}</span>{p.name}
            </button></li>
          ))}
        </ul>
      )}
      <textarea ref={ref} rows={1} value={text} placeholder={placeholder} maxLength={2000} aria-label={placeholder}
        onChange={(e) => { setText(e.target.value); detect(e.target.value, e.target.selectionStart); grow(); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (matches.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % matches.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(matches[hi]); return; }
            if (e.key === 'Escape') { e.preventDefault(); setQuery(null); return; }
          }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        }}
      />
      <button type="button" className="msend" disabled={!text.trim() || busy} onClick={send} aria-label={sendLabel}><Icon n="send" size={18} /></button>
    </div>
  );
}

function Thread({ t, me, people, canModerate, api: c, onClose }: { t: CThread; me: Person | null; people: Person[]; canModerate: boolean; api: CommentsApi; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: 1e6 }); }, [t.messages.length]);
  const run = async (f: () => Promise<unknown>) => { setErr(''); setBusy(true); try { await f(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'That didn’t work. Try again.'); } setBusy(false); };
  const starter = t.messages[0]?.author.id === me?.id;
  return (
    <div className="thread">
      <div className="thread-head">
        <b>{t.resolved ? 'Resolved' : 'Comment'}</b>
        <button className="ib" title={t.resolved ? 'Reopen' : 'Resolve'} aria-label={t.resolved ? 'Reopen thread' : 'Resolve thread'} onClick={() => run(async () => { await c.resolve(t.id, !t.resolved); if (!t.resolved) onClose(); })}><Icon n={t.resolved ? 'reset' : 'check'} size={18} /></button>
        {(starter || canModerate) && (confirm
          ? <button className="textbtn danger-t" onClick={() => run(async () => { await c.removeThread(t.id); onClose(); })}>Delete thread</button>
          : <button className="ib" aria-label="Delete thread" title="Delete thread" onClick={() => setConfirm(true)}><Icon n="trash" size={18} /></button>)}
        <button className="ib" aria-label="Close" onClick={onClose}><Icon n="close" size={18} /></button>
      </div>
      <div className="thread-list" ref={listRef}>
        {t.messages.map((m) => (
          <div key={m.id} className="msg">
            <span className="av sm" style={{ background: m.author.color }}>{initial(m.author.name)}</span>
            <div className="msg-body">
              <div className="msg-meta"><b>{m.author.name}</b><small>{ago(m.createdAt)}{m.editedAt ? ' · edited' : ''}</small>
                {m.author.id === me?.id && editing !== m.id && <span className="msg-acts">
                  <button className="textbtn small" onClick={() => setEditing(m.id)}>Edit</button>
                  {t.messages.length > 1 && <button className="textbtn small" onClick={() => run(() => c.removeReply(t.id, m.id))}>Delete</button>}
                </span>}
              </div>
              {editing === m.id
                ? <MentionBox people={people} placeholder="Edit your comment" autoFocus initialText={m.text} sendLabel="Save" busy={busy} onSend={async (text) => { await run(() => c.edit(t.id, m.id, text)); setEditing(null); }} />
                : <p><Rich text={m.text} people={people} /></p>}
            </div>
          </div>
        ))}
      </div>
      {err && <p className="form-err small">{err}</p>}
      {me && <MentionBox people={people.filter((p) => p.id !== me.id)} placeholder="Reply, or @mention someone" busy={busy} onSend={(text, ids) => run(() => c.reply(t.id, text, ids))} />}
    </div>
  );
}

/** Comment pins, the open thread, and the box for a new comment, drawn on top of the board. */
export function CommentLayer({ threads, cam, lookup, openId, setOpenId, draft, setDraft, people, me, canModerate, api: c, showResolved }: {
  threads: CThread[]; cam: Cam; lookup: (id: string) => Shape | undefined; openId: string | null; setOpenId: (id: string | null) => void;
  draft: Draft | null; setDraft: (d: Draft | null) => void; people: Person[]; me: Person | null; canModerate: boolean; api: CommentsApi; showResolved: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toScreen = (p: { x: number; y: number }) => ({ left: p.x * cam.z + cam.x, top: p.y * cam.z + cam.y });
  const open = threads.find((t) => t.id === openId) || null;
  const card = (p: { x: number; y: number }, node: ReactNode) => {
    const s = toScreen(p);
    return <div className="cpop" data-ui style={{ ['--px' as string]: `${s.left}px`, ['--py' as string]: `${s.top}px` }} {...stop}>{node}</div>;
  };
  return (
    <div className="comments-layer">
      {threads.filter((t) => showResolved || !t.resolved || t.id === openId).map((t) => {
        const p = toScreen(pinPos(t, lookup));
        const a = t.messages[0]?.author;
        return (
          <button key={t.id} data-ui className={'pin' + (t.resolved ? ' resolved' : '') + (t.id === openId ? ' on' : '')} style={{ left: p.left, top: p.top, ['--c' as string]: a?.color || '#5B6578' }}
            aria-label={`Comment by ${a?.name || 'someone'}`} {...stop} onClick={() => { setDraft(null); setOpenId(t.id === openId ? null : t.id); }}>
            <span>{initial(a?.name || '?')}</span>
            {t.messages.length > 1 && <i>{t.messages.length}</i>}
          </button>
        );
      })}
      {draft && (
        <>
          <span className="pin draft" style={{ ...toScreen(draft), ['--c' as string]: me?.color || '#2F5BFF' }}><span>{initial(me?.name || '?')}</span></span>
          {card(draft, (
            <div className="thread">
              <div className="thread-head"><b>New comment</b><button className="ib" aria-label="Cancel" onClick={() => setDraft(null)}><Icon n="close" size={18} /></button></div>
              {err && <p className="form-err small">{err}</p>}
              <MentionBox people={people.filter((p) => p.id !== me?.id)} placeholder="Add a comment, @mention someone" autoFocus busy={busy}
                onSend={async (text, ids) => {
                  setErr(''); setBusy(true);
                  try { const t = await c.create(draft, text, ids); setDraft(null); setOpenId(t.id); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Couldn’t post. Try again.'); }
                  setBusy(false);
                }} />
            </div>
          ))}
        </>
      )}
      {open && !draft && card(pinPos(open, lookup), <Thread t={open} me={me} people={people} canModerate={canModerate} api={c} onClose={() => setOpenId(null)} />)}
    </div>
  );
}

/** Every thread on the board in one list, to find and jump to comments. */
export function CommentsList({ threads, onPick, showResolved, setShowResolved }: { threads: CThread[]; onPick: (t: CThread) => void; showResolved: boolean; setShowResolved: (v: boolean) => void }) {
  const list = threads.filter((t) => showResolved || !t.resolved).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  return (
    <div className="clist">
      <label className="check"><input id="show-resolved" type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved</label>
      {!list.length && <p className="muted">{threads.length ? 'No open comments. Everything is resolved.' : 'No comments yet. Pick the comment tool, then tap anywhere on the board.'}</p>}
      {list.map((t) => {
        const last = t.messages[t.messages.length - 1];
        return (
          <button key={t.id} className={'crow' + (t.resolved ? ' resolved' : '')} onClick={() => onPick(t)}>
            <span className="av sm" style={{ background: t.messages[0]?.author.color }}>{initial(t.messages[0]?.author.name || '?')}</span>
            <span className="crow-main"><b>{t.messages[0]?.author.name}</b><span className="crow-text">{t.messages[0]?.text}</span>
              <small>{t.messages.length > 1 ? `${t.messages.length - 1} ${t.messages.length === 2 ? 'reply' : 'replies'} · ` : ''}{ago(last?.createdAt || t.createdAt)}{t.resolved ? ' · resolved' : ''}</small></span>
          </button>
        );
      })}
    </div>
  );
}
