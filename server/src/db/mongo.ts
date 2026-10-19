import { Binary, MongoClient } from 'mongodb';
import type { Board, BoardDoc, Comment, Notification, Session, Store, User, Version, VersionMeta } from './types.js';

const bin = (u: Uint8Array) => new Binary(Buffer.from(u));
const unbin = (b: unknown): Uint8Array => (b instanceof Binary ? new Uint8Array(b.buffer) : new Uint8Array(b as ArrayBuffer));

export async function mongoStore(uri: string, dbName = 'tessel'): Promise<Store> {
  const client = new MongoClient(uri, { maxPoolSize: 10 });
  await client.connect();
  const db = client.db(dbName);
  const users = db.collection<User>('users');
  const sessions = db.collection<Session>('sessions');
  const boards = db.collection<Board>('boards');
  const docs = db.collection<BoardDoc>('docs');
  const versions = db.collection<Version>('versions');
  const comments = db.collection<Comment>('comments');
  const notes = db.collection<Notification>('notifications');

  await Promise.all([
    users.createIndex({ email: 1 }, { unique: true }),
    sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    sessions.createIndex({ userId: 1 }),
    boards.createIndex({ ownerId: 1, updatedAt: -1 }),
    boards.createIndex({ 'members.userId': 1 }),
    versions.createIndex({ boardId: 1, createdAt: -1 }),
    comments.createIndex({ boardId: 1, createdAt: 1 }),
    notes.createIndex({ userId: 1, createdAt: -1 }),
  ]);

  const noState = { projection: { state: 0 } } as const;

  return {
    users: {
      async insert(u) { await users.insertOne(u); },
      byId: (id) => users.findOne({ _id: id }),
      byEmail: (email) => users.findOne({ email }),
      byIds: (ids) => users.find({ _id: { $in: ids } }).toArray(),
      async update(id, patch) { await users.updateOne({ _id: id }, { $set: patch }); },
    },
    sessions: {
      async insert(s) { await sessions.insertOne(s); },
      get: (id) => sessions.findOne({ _id: id, expiresAt: { $gt: new Date() } }),
      async delete(id) { await sessions.deleteOne({ _id: id }); },
      async deleteForUser(userId) { await sessions.deleteMany({ userId }); },
    },
    boards: {
      async insert(b) { await boards.insertOne(b); },
      get: (id) => boards.findOne({ _id: id }),
      async update(id, patch) { await boards.updateOne({ _id: id }, { $set: patch }); },
      forUser: (userId) => boards.find({ $or: [{ ownerId: userId }, { 'members.userId': userId }] }).sort({ updatedAt: -1 }).limit(500).toArray(),
      async delete(id) { await boards.deleteOne({ _id: id }); },
    },
    docs: {
      async get(id) { const d = await docs.findOne({ _id: id }); return d ? { ...d, state: unbin(d.state) } : null; },
      async put(id, state) { await docs.updateOne({ _id: id }, { $set: { state: bin(state) as unknown as Uint8Array, updatedAt: new Date() } }, { upsert: true }); },
      async delete(id) { await docs.deleteOne({ _id: id }); },
    },
    versions: {
      async insert(v) { await versions.insertOne({ ...v, state: bin(v.state) as unknown as Uint8Array }); },
      list: (boardId) => versions.find({ boardId }, noState).sort({ createdAt: -1 }).limit(200).toArray() as Promise<VersionMeta[]>,
      async get(id) { const v = await versions.findOne({ _id: id }); return v ? { ...v, state: unbin(v.state) } : null; },
      latestAuto: (boardId) => versions.findOne({ boardId, auto: true }, { ...noState, sort: { createdAt: -1 } }) as Promise<VersionMeta | null>,
      async prune(boardId, keep) {
        const old = await versions.find({ boardId, auto: true }, { projection: { _id: 1 } }).sort({ createdAt: -1 }).skip(keep).toArray();
        if (old.length) await versions.deleteMany({ _id: { $in: old.map((o) => o._id) } });
      },
      async deleteForBoard(boardId) { await versions.deleteMany({ boardId }); },
    },
    comments: {
      async insert(c) { await comments.insertOne(c); },
      get: (id) => comments.findOne({ _id: id }),
      list: (boardId) => comments.find({ boardId }).sort({ createdAt: 1 }).limit(1000).toArray(),
      async update(id, patch) { await comments.updateOne({ _id: id }, { $set: patch }); },
      async delete(id) { await comments.deleteOne({ _id: id }); },
      async deleteForBoard(boardId) { await comments.deleteMany({ boardId }); },
    },
    notifications: {
      async insert(n) { await notes.insertOne(n); },
      list: (userId, limit) => notes.find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray(),
      async markRead(userId, ids) { await notes.updateMany(ids ? { userId, _id: { $in: ids } } : { userId }, { $set: { read: true } }); },
    },
    close: () => client.close(),
  };
}
