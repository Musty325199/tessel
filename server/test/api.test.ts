import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { createApp } from '../src/app.js';
import { memoryStore } from '../src/db/memory.js';

const db = memoryStore();
const { app, rooms } = createApp(db);
let server: Server; let base = '';
beforeAll(async () => {
  server = createServer(app); rooms.attach(server);
  await new Promise<void>((r) => server.listen(0, r));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function signup(name: string, email: string) {
  const res = await request(app).post('/api/auth/signup').send({ name, email, password: 'correct horse 9' });
  expect(res.status).toBe(201);
  return res.body as { accessToken: string; refreshToken: string; user: { id: string } };
}

/** A tiny sync client, the same protocol the web app speaks. */
function client(boardId: string, hello: object) {
  const doc = new Y.Doc();
  const ws = new WebSocket(`${base}/ws/${boardId}`);
  const status: { ready?: { role: string }; denied?: string; closed?: number } = {};
  ws.on('open', () => ws.send(JSON.stringify(hello)));
  ws.on('close', (code) => { status.closed = code; });
  ws.on('message', (data, bin) => {
    if (!bin) {
      const m = JSON.parse(data.toString());
      if (m.type === 'ready') {
        status.ready = m;
        const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0); syncProtocol.writeSyncStep1(enc, doc); ws.send(encoding.toUint8Array(enc));
      }
      if (m.type === 'denied') status.denied = m.reason;
      return;
    }
    const dec = decoding.createDecoder(new Uint8Array(data as Buffer));
    if (decoding.readVarUint(dec) !== 0) return;
    const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0);
    syncProtocol.readSyncMessage(dec, enc, doc, 'remote');
    if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
  });
  doc.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin === 'remote' || ws.readyState !== 1) return;
    const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0); syncProtocol.writeUpdate(enc, u); ws.send(encoding.toUint8Array(enc));
  });
  return { doc, ws, status };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 3000) { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await wait(20); } }
const addNote = (doc: Y.Doc, id: string, text: string) => doc.transact(() => { const m = new Y.Map(); m.set('id', id); m.set('type', 'sticky'); m.set('text', text); m.set('x', 0); m.set('y', 0); m.set('w', 100); m.set('h', 100); m.set('z', 1); doc.getMap('shapes').set(id, m); });

describe('accounts', () => {
  it('signs up, rejects duplicates and bad passwords, signs in, and rotates refresh tokens', async () => {
    const a = await signup('Ada', 'ada@example.com');
    expect((await request(app).post('/api/auth/signup').send({ name: 'Ada', email: 'ADA@example.com', password: 'another one 1' })).status).toBe(409);
    expect((await request(app).post('/api/auth/signup').send({ name: 'X', email: 'x@example.com', password: 'short' })).body.error).toMatch(/8 characters/);
    expect((await request(app).post('/api/auth/login').send({ email: 'ada@example.com', password: 'wrong password' })).status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ email: 'ada@example.com', password: 'correct horse 9' });
    expect(login.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${a.accessToken}`);
    expect(me.body.user.name).toBe('Ada');
    const r1 = await request(app).post('/api/auth/refresh').send({ refreshToken: a.refreshToken });
    expect(r1.status).toBe(200);
    // the old refresh token is spent after one use
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: a.refreshToken })).status).toBe(401);
    expect((await request(app).get('/api/boards')).status).toBe(401);
  });
});

describe('boards and sharing', () => {
  it('creates from a template, shares by link and by email, and enforces roles', async () => {
    const owner = await signup('Owner', 'owner@example.com');
    const guest = await signup('Guest', 'guest@example.com');
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

    const created = await request(app).post('/api/boards').set(auth(owner.accessToken)).send({ template: 'retro' });
    expect(created.status).toBe(201);
    const board = created.body.board;
    expect(board.title).toBe('Team retro');
    expect(board.thumbnail).toContain('<svg');
    expect((await rooms.shapes(board.id)).length).toBeGreaterThan(3);

    // a stranger can't open it
    expect((await request(app).get(`/api/boards/${board.id}`).set(auth(guest.accessToken))).status).toBe(403);
    // view link: guest can read, not write
    await request(app).patch(`/api/boards/${board.id}`).set(auth(owner.accessToken)).send({ linkAccess: 'view' }).expect(200);
    const viaLink = await request(app).get(`/api/boards/${board.id}?k=${board.linkToken}`).set(auth(guest.accessToken));
    expect(viaLink.body.board.role).toBe('viewer');
    expect((await request(app).patch(`/api/boards/${board.id}?k=${board.linkToken}`).set(auth(guest.accessToken)).send({ title: 'Hacked' })).status).toBe(403);
    // invite by email as editor
    const inv = await request(app).post(`/api/boards/${board.id}/members`).set(auth(owner.accessToken)).send({ email: 'guest@example.com', role: 'editor' });
    expect(inv.body.board.members[0].role).toBe('editor');
    expect((await request(app).get('/api/boards').set(auth(guest.accessToken))).body.boards).toHaveLength(1);
    expect((await request(app).get('/api/notifications').set(auth(guest.accessToken))).body.unread).toBe(1);
    // only the owner changes sharing
    expect((await request(app).patch(`/api/boards/${board.id}`).set(auth(guest.accessToken)).send({ linkAccess: 'edit' })).status).toBe(403);
    // trash, then restore
    await request(app).delete(`/api/boards/${board.id}`).set(auth(owner.accessToken)).expect(200);
    expect((await request(app).get(`/api/boards/${board.id}`).set(auth(guest.accessToken))).status).toBe(403);
    await request(app).post(`/api/boards/${board.id}/restore`).set(auth(owner.accessToken)).expect(200);
  });
});

describe('live sync', () => {
  it('syncs edits between two people, ignores viewers, saves, and restores versions', async () => {
    const owner = await signup('Sync Owner', 'sync@example.com');
    const viewer = await signup('Viewer', 'viewer@example.com');
    const board = (await request(app).post('/api/boards').set({ Authorization: `Bearer ${owner.accessToken}` }).send({})).body.board;
    await request(app).patch(`/api/boards/${board.id}`).set({ Authorization: `Bearer ${owner.accessToken}` }).send({ linkAccess: 'view' });

    const a = client(board.id, { token: owner.accessToken });
    const b = client(board.id, { token: owner.accessToken });
    const v = client(board.id, { token: viewer.accessToken, k: board.linkToken });
    const stranger = client(board.id, { token: viewer.accessToken });
    await until(() => !!a.status.ready && !!b.status.ready && !!v.status.ready && !!stranger.status.denied);
    expect(v.status.ready!.role).toBe('viewer');

    addNote(a.doc, 'n1', 'hello');
    await until(() => b.doc.getMap('shapes').has('n1') && v.doc.getMap('shapes').has('n1'));

    addNote(v.doc, 'n2', 'viewer edit'); // must not reach anyone
    await wait(300);
    expect(a.doc.getMap('shapes').has('n2')).toBe(false);

    await request(app).post(`/api/boards/${board.id}/versions`).set({ Authorization: `Bearer ${owner.accessToken}` }).send({ name: 'One note' }).expect(201);
    addNote(b.doc, 'n3', 'second');
    await until(() => a.doc.getMap('shapes').size === 2);

    const versions = (await request(app).get(`/api/boards/${board.id}/versions`).set({ Authorization: `Bearer ${owner.accessToken}` })).body.versions;
    const named = versions.find((x: { name: string }) => x.name === 'One note');
    await request(app).post(`/api/boards/${board.id}/versions/${named.id}/restore`).set({ Authorization: `Bearer ${owner.accessToken}` }).expect(200);
    await until(() => a.doc.getMap('shapes').size === 1 && b.doc.getMap('shapes').size === 1);

    await wait(1800); // debounce save
    const saved = await db.docs.get(board.id);
    const d = new Y.Doc(); Y.applyUpdate(d, saved!.state);
    expect(d.getMap('shapes').size).toBe(1);
    [a, b, v].forEach((c) => c.ws.close());
  });

  it('lets anyone draw on the landing page board without an account', async () => {
    const g = client('lobby', { name: 'Visitor' });
    await until(() => !!g.status.ready && g.doc.getMap('shapes').size > 0);
    g.ws.close();
  });
});
