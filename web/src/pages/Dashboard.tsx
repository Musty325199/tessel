import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ago, auth, useUser, ApiError, type BoardInfo, type NotificationInfo } from '../api';
import { go, linkProps } from '../router';
import Icon from '../icons';
import { Avatar, Logo, Popover, Sheet, Spinner, ThemeSwitch } from '../ui';
import { TEMPLATES, buildTemplate } from '../../../shared/templates';
import { drawThumbnail } from '../../../shared/thumbnail';

type Tab = 'all' | 'starred' | 'shared' | 'trash';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'all', label: 'My boards', icon: 'grid' },
  { id: 'starred', label: 'Starred', icon: 'star' },
  { id: 'shared', label: 'Shared with me', icon: 'users' },
  { id: 'trash', label: 'Trash', icon: 'trash' },
];
const PEOPLE = ['#2F5BFF', '#FF5A4E', '#12B5A6', '#8B5CF6', '#E69500', '#E0457B'];

export default function Dashboard({ tab }: { tab: Tab }) {
  const user = useUser();
  const [boards, setBoards] = useState<BoardInfo[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState(false);
  const [creating, setCreating] = useState('');
  const [notes, setNotes] = useState<{ notifications: NotificationInfo[]; unread: number } | null>(null);
  const [bell, setBell] = useState(false);
  const [me, setMe] = useState(false);
  const [profile, setProfile] = useState(false);
  const [toast, setToast] = useState('');
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(async () => {
    try {
      const r = await api<{ boards: BoardInfo[] }>('/api/boards');
      setBoards(r.boards); setErr('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return go('/login?next=/boards', true);
      setErr(e instanceof ApiError ? e.message : 'Could not load your boards.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api<{ notifications: NotificationInfo[]; unread: number }>('/api/notifications').then(setNotes).catch(() => {}); }, []);

  const shown = useMemo(() => {
    if (!boards || !user) return [];
    const term = q.trim().toLowerCase();
    return boards.filter((b) => {
      if (term && !b.title.toLowerCase().includes(term)) return false;
      if (tab === 'trash') return !!b.deletedAt && b.role === 'owner';
      if (b.deletedAt) return false;
      if (tab === 'starred') return b.starred;
      if (tab === 'shared') return b.role !== 'owner';
      return b.role === 'owner';
    });
  }, [boards, tab, q, user]);

  async function create(template: string) {
    setCreating(template);
    try {
      const r = await api<{ board: BoardInfo }>('/api/boards', { method: 'POST', body: { template } });
      go(`/b/${r.board.id}`);
    } catch (e) { say(e instanceof ApiError ? e.message : 'Could not create the board.'); setCreating(''); }
  }

  async function act(b: BoardInfo, what: 'star' | 'duplicate' | 'trash' | 'restore' | 'forever' | 'leave' | 'rename', value?: string) {
    try {
      if (what === 'star') { const r = await api<{ starred: boolean }>(`/api/boards/${b.id}/star`, { method: 'POST' }); setBoards((l) => l!.map((x) => x.id === b.id ? { ...x, starred: r.starred } : x)); return; }
      if (what === 'duplicate') { await api(`/api/boards/${b.id}/duplicate`, { method: 'POST' }); say('Board duplicated.'); }
      if (what === 'trash') { await api(`/api/boards/${b.id}`, { method: 'DELETE' }); say('Moved to trash.'); }
      if (what === 'restore') { await api(`/api/boards/${b.id}/restore`, { method: 'POST' }); say('Board restored.'); }
      if (what === 'forever') { await api(`/api/boards/${b.id}?forever=1`, { method: 'DELETE' }); say('Board deleted for good.'); }
      if (what === 'leave') { await api(`/api/boards/${b.id}/members/${user!.id}`, { method: 'DELETE' }); say('You left the board.'); }
      if (what === 'rename' && value) { await api(`/api/boards/${b.id}`, { method: 'PATCH', body: { title: value } }); }
      load();
    } catch (e) { say(e instanceof ApiError ? e.message : 'That didn’t work. Try again.'); }
  }

  if (!user) { go('/login?next=/boards', true); return null; }

  return (
    <div className="dash">
      <header className="dash-top">
        <Logo to="/boards" />
        <label className="search">
          <Icon n="search" size={18} />
          <input id="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search boards" aria-label="Search boards" />
        </label>
        <div className="dash-actions">
          <div className="rel">
            <button className="ib" data-pop-trigger aria-label="Notifications" onClick={() => { setBell((b) => !b); setMe(false); if (notes?.unread) { api('/api/notifications/read', { method: 'POST', body: {} }).catch(() => {}); } }}>
              <Icon n="bell" size={21} />{!!notes?.unread && <span className="badge">{notes.unread}</span>}
            </button>
            <Popover open={bell} onClose={() => { setBell(false); if (notes) setNotes({ ...notes, unread: 0, notifications: notes.notifications.map((n) => ({ ...n, read: true })) }); }} className="notes">
              <h3>Notifications</h3>
              {!notes?.notifications.length && <p className="muted pad">When someone invites you to a board or mentions you, it shows up here.</p>}
              {notes?.notifications.map((n) => (
                <a key={n.id} className={'note-row' + (n.read ? '' : ' unread')} {...linkProps(`/b/${n.boardId}`)}>
                  {n.from && <Avatar name={n.from.name} color={n.from.color} size={28} />}
                  <span><b>{n.text}</b><small>{ago(n.createdAt)}</small></span>
                </a>
              ))}
            </Popover>
          </div>
          <div className="rel">
            <button className="me-btn" data-pop-trigger aria-label="Account" onClick={() => { setMe((m) => !m); setBell(false); }}><Avatar name={user.name} color={user.color} size={34} /></button>
            <Popover open={me} onClose={() => setMe(false)}>
              <div className="me-head"><Avatar name={user.name} color={user.color} size={40} /><span><b>{user.name}</b><small>{user.email}</small></span></div>
              <button onClick={() => { setProfile(true); setMe(false); }}><Icon n="edit" size={18} />Edit name and colour</button>
              <ThemeSwitch />
              <button onClick={() => { auth.logout(); go('/', true); }}><Icon n="logout" size={18} />Sign out</button>
            </Popover>
          </div>
        </div>
      </header>

      <div className="dash-body">
        <nav className="dash-nav" aria-label="Board lists">
          {TABS.map((t) => (
            <a key={t.id} className={tab === t.id ? 'on' : ''} {...linkProps(t.id === 'all' ? '/boards' : `/boards/${t.id}`)}>
              <Icon n={t.icon} size={19} /><span>{t.label}</span>
            </a>
          ))}
        </nav>

        <main className="dash-main">
          <div className="dash-head">
            <h1>{TABS.find((t) => t.id === tab)!.label}</h1>
            {tab !== 'trash' && <button className="btn primary" onClick={() => setPicker(true)}><Icon n="plus" size={18} />New board</button>}
          </div>
          {tab === 'all' && !q && <p className="quick-label">Start a new board</p>}
          {tab === 'all' && !q && (
            <div className="quick">
              {TEMPLATES.slice(0, 4).map((t) => (
                <button key={t.id} className="quick-tpl" onClick={() => create(t.id)} disabled={!!creating}>
                  <TemplatePreview id={t.id} />
                  <span>{creating === t.id ? 'Creating…' : t.name}</span>
                </button>
              ))}
            </div>
          )}
          {err && <div className="banner"><span>{err}</span><button className="btn" onClick={load}>Try again</button></div>}
          {!boards && !err && <div className="center-pad"><Spinner label="Loading boards" /></div>}
          {boards && !shown.length && (
            <div className="empty">
              {q ? <p>No boards match “{q}”.</p> : tab === 'trash' ? <p>Trash is empty. Deleted boards stay here until you remove them for good.</p> : tab === 'starred' ? <p>Star a board to keep it here for quick access.</p> : tab === 'shared' ? <p>Boards other people share with you will show up here.</p> : <><p>You don’t have any boards yet.</p><button className="btn primary" onClick={() => setPicker(true)}>Create your first board</button></>}
            </div>
          )}
          <div className="cards">
            {shown.map((b) => <Card key={b.id} b={b} me={user.id} onAct={act} />)}
          </div>
        </main>
      </div>

      {picker && (
        <Sheet title="Start a new board" onClose={() => setPicker(false)} wide>
          <div className="tpl-grid">
            {TEMPLATES.map((t) => (
              <button key={t.id} className="tpl" onClick={() => create(t.id)} disabled={!!creating}>
                <TemplatePreview id={t.id} />
                <b>{creating === t.id ? 'Creating…' : t.name}</b>
                <small>{t.blurb}</small>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {profile && <Profile onClose={() => setProfile(false)} onSaved={() => say('Profile saved.')} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

const previews = new Map<string, string>();
function TemplatePreview({ id }: { id: string }) {
  if (!previews.has(id)) previews.set(id, drawThumbnail(buildTemplate(id)));
  const svg = previews.get(id)!;
  return <span className="thumb" aria-hidden="true">{svg ? <span dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="plus"><Icon n="plus" size={30} /></span>}</span>;
}

function Card({ b, me, onAct }: { b: BoardInfo; me: string; onAct: (b: BoardInfo, what: 'star' | 'duplicate' | 'trash' | 'restore' | 'forever' | 'leave' | 'rename', v?: string) => void }) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(b.title);
  const [sure, setSure] = useState(false);
  const owner = b.role === 'owner';
  return (
    <article className="card">
      <a className="card-thumb" {...linkProps(`/b/${b.id}`)} aria-label={`Open ${b.title}`}>
        {b.thumbnail ? <span dangerouslySetInnerHTML={{ __html: b.thumbnail }} /> : <span className="blank">Empty board</span>}
      </a>
      <div className="card-info">
        {renaming ? (
          <form onSubmit={(e) => { e.preventDefault(); setRenaming(false); if (name.trim() && name !== b.title) onAct(b, 'rename', name.trim()); }}>
            <input id={`rename-${b.id}`} className="rename" value={name} autoFocus maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => { setRenaming(false); if (name.trim() && name !== b.title) onAct(b, 'rename', name.trim()); }} aria-label="Board name" />
          </form>
        ) : <a className="card-title" {...linkProps(`/b/${b.id}`)}>{b.title}</a>}
        <small className="muted">
          {b.deletedAt ? `Deleted ${ago(b.deletedAt)}` : `Edited ${ago(b.updatedAt)}`}
          {!owner && <> by {b.owner.id === me ? 'you' : b.owner.name.split(' ')[0]}</>}
        </small>
      </div>
      <div className="card-actions">
        {!b.deletedAt && <button className={'ib star' + (b.starred ? ' on' : '')} aria-label={b.starred ? 'Unstar' : 'Star'} aria-pressed={b.starred} onClick={() => onAct(b, 'star')}><Icon n="star" size={19} /></button>}
        <div className="rel">
          <button className="ib" data-pop-trigger aria-label="Board options" onClick={() => { setMenu((m) => !m); setSure(false); }}><Icon n="more" size={19} /></button>
          <Popover open={menu} onClose={() => setMenu(false)} className="up">
            {b.deletedAt ? (
              <>
                <button onClick={() => { setMenu(false); onAct(b, 'restore'); }}><Icon n="reset" size={18} />Restore</button>
                {sure ? <button className="danger" onClick={() => { setMenu(false); onAct(b, 'forever'); }}><Icon n="trash" size={18} />Yes, delete for good</button>
                  : <button className="danger" onClick={() => setSure(true)}><Icon n="trash" size={18} />Delete for good…</button>}
              </>
            ) : (
              <>
                {b.role !== 'viewer' && <button onClick={() => { setMenu(false); setRenaming(true); }}><Icon n="edit" size={18} />Rename</button>}
                <button onClick={() => { setMenu(false); onAct(b, 'duplicate'); }}><Icon n="copy" size={18} />Duplicate</button>
                {owner ? <button className="danger" onClick={() => { setMenu(false); onAct(b, 'trash'); }}><Icon n="trash" size={18} />Move to trash</button>
                  : <button className="danger" onClick={() => { setMenu(false); onAct(b, 'leave'); }}><Icon n="logout" size={18} />Leave board</button>}
              </>
            )}
          </Popover>
        </div>
      </div>
    </article>
  );
}

function Profile({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const u = auth.user()!;
  const [name, setName] = useState(u.name);
  const [color, setColor] = useState(u.color);
  const [err, setErr] = useState('');
  return (
    <Sheet title="Your profile" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        try { await auth.update({ name, color }); onSaved(); onClose(); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not save.'); }
      }}>
        <label className="field"><span>Name people see on your cursor</span><input id="profile-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
        <div className="field"><span>Your colour</span>
          <div className="colors">{PEOPLE.map((c) => <button type="button" key={c} className={'sw big' + (color === c ? ' on' : '')} style={{ background: c }} aria-label="Colour" aria-pressed={color === c} onClick={() => setColor(c)} />)}</div>
        </div>
        {err && <p className="form-err">{err}</p>}
        <button className="btn primary block">Save profile</button>
      </form>
    </Sheet>
  );
}
