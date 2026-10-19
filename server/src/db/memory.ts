import type { Board, BoardDoc, Comment, Notification, Session, Store, User, Version } from './types.js';

const clone = <T>(v: T): T => (v === null || v === undefined ? v : structuredClone(v));

/** In-memory store with the same behaviour as the Mongo one. Used by tests and quick local runs. */
export function memoryStore(): Store {
  const users = new Map<string, User>();
  const sessions = new Map<string, Session>();
  const boards = new Map<string, Board>();
  const docs = new Map<string, BoardDoc>();
  const versions = new Map<string, Version>();
  const comments = new Map<string, Comment>();
  const notes = new Map<string, Notification>();
  const meta = ({ state: _s, ...m }: Version) => clone(m);

  return {
    users: {
      async insert(u) {
        if ([...users.values()].some((x) => x.email === u.email)) throw Object.assign(new Error('duplicate'), { code: 11000 });
        users.set(u._id, clone(u));
      },
      async byId(id) { return clone(users.get(id) ?? null); },
      async byEmail(email) { return clone([...users.values()].find((u) => u.email === email) ?? null); },
      async byIds(ids) { return ids.map((id) => users.get(id)).filter(Boolean).map((u) => clone(u!)); },
      async update(id, patch) { const u = users.get(id); if (u) users.set(id, { ...u, ...clone(patch) }); },
    },
    sessions: {
      async insert(s) { sessions.set(s._id, clone(s)); },
      async get(id) { const s = sessions.get(id); return s && s.expiresAt > new Date() ? clone(s) : null; },
      async delete(id) { sessions.delete(id); },
      async deleteForUser(userId) { for (const [k, s] of sessions) if (s.userId === userId) sessions.delete(k); },
    },
    boards: {
      async insert(b) { boards.set(b._id, clone(b)); },
      async get(id) { return clone(boards.get(id) ?? null); },
      async update(id, patch) { const b = boards.get(id); if (b) boards.set(id, { ...b, ...clone(patch) }); },
      async forUser(userId) {
        return [...boards.values()]
          .filter((b) => b.ownerId === userId || b.members.some((m) => m.userId === userId))
          .sort((a, b) => +b.updatedAt - +a.updatedAt).map(clone);
      },
      async delete(id) { boards.delete(id); },
    },
    docs: {
      async get(id) { return clone(docs.get(id) ?? null); },
      async put(id, state) { docs.set(id, { _id: id, state: new Uint8Array(state), updatedAt: new Date() }); },
      async delete(id) { docs.delete(id); },
    },
    versions: {
      async insert(v) { versions.set(v._id, clone(v)); },
      async list(boardId) { return [...versions.values()].filter((v) => v.boardId === boardId).sort((a, b) => +b.createdAt - +a.createdAt).map(meta); },
      async get(id) { return clone(versions.get(id) ?? null); },
      async latestAuto(boardId) {
        const v = [...versions.values()].filter((x) => x.boardId === boardId && x.auto).sort((a, b) => +b.createdAt - +a.createdAt)[0];
        return v ? meta(v) : null;
      },
      async prune(boardId, keep) {
        const auto = [...versions.values()].filter((x) => x.boardId === boardId && x.auto).sort((a, b) => +b.createdAt - +a.createdAt);
        auto.slice(keep).forEach((v) => versions.delete(v._id));
      },
      async deleteForBoard(boardId) { for (const [k, v] of versions) if (v.boardId === boardId) versions.delete(k); },
    },
    comments: {
      async insert(c) { comments.set(c._id, clone(c)); },
      async get(id) { return clone(comments.get(id) ?? null); },
      async list(boardId) { return [...comments.values()].filter((c) => c.boardId === boardId).sort((a, b) => +a.createdAt - +b.createdAt).map(clone); },
      async update(id, patch) { const c = comments.get(id); if (c) comments.set(id, { ...c, ...clone(patch) }); },
      async delete(id) { comments.delete(id); },
      async deleteForBoard(boardId) { for (const [k, c] of comments) if (c.boardId === boardId) comments.delete(k); },
    },
    notifications: {
      async insert(n) { notes.set(n._id, clone(n)); },
      async list(userId, limit) { return [...notes.values()].filter((n) => n.userId === userId).sort((a, b) => +b.createdAt - +a.createdAt).slice(0, limit).map(clone); },
      async markRead(userId, ids) { for (const n of notes.values()) if (n.userId === userId && (!ids || ids.includes(n._id))) n.read = true; },
    },
    async close() {},
  };
}
