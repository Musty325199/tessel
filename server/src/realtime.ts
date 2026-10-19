import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { Role, Store } from './db/types.js';
import { verifyAccess, type AuthedUser } from './auth.js';
import { canEdit, roleFor } from './access.js';
import { docFromState, readShapes, shapesOf, thumbnail, writeShapes } from './ydoc.js';
import { buildTemplate } from '../../shared/templates.js';
import { id } from './util.js';

const MSG_SYNC = 0, MSG_AWARENESS = 1;
export const LOBBY = 'lobby';
const AUTO_VERSION_MS = 10 * 60 * 1000;
const KEEP_AUTO_VERSIONS = 40;
const LOBBY_MAX_SHAPES = 250;

type Conn = { ws: WebSocket; user: AuthedUser | null; guestName: string; k: string | null; role: Role; ids: Set<number>; alive: boolean };

class Room {
  doc = new Y.Doc();
  awareness: awarenessProtocol.Awareness;
  conns = new Map<WebSocket, Conn>();
  saveTimer: NodeJS.Timeout | null = null;
  firstDirty = 0;
  dirty = false;
  closeTimer: NodeJS.Timeout | null = null;
  lastEditor: string | null = null;

  constructor(public id: string, private db: Store | null) {
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null); // the server is not a participant
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      const msg = encoding.toUint8Array(enc);
      this.conns.forEach((c) => { if (c.ws !== origin) send(c.ws, msg); });
      if (origin !== 'load') this.markDirty();
    });
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = added.concat(updated, removed);
      const c = origin instanceof WebSocket ? this.conns.get(origin) : undefined;
      if (c) { added.forEach((i) => c.ids.add(i)); removed.forEach((i) => c.ids.delete(i)); }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      const msg = encoding.toUint8Array(enc);
      this.conns.forEach((x) => send(x.ws, msg));
    });
  }

  markDirty() {
    if (!this.db) return;
    this.dirty = true;
    if (!this.firstDirty) this.firstDirty = Date.now();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    // save shortly after edits stop, but never wait longer than 8 seconds during constant editing
    const wait = Date.now() - this.firstDirty > 8000 ? 0 : 1500;
    this.saveTimer = setTimeout(() => { this.save().catch((e) => console.error('save failed', this.id, e)); }, wait);
  }

  async save() {
    if (!this.db || !this.dirty) return;
    this.dirty = false; this.firstDirty = 0;
    const state = Y.encodeStateAsUpdate(this.doc);
    await this.db.docs.put(this.id, state);
    await this.db.boards.update(this.id, { thumbnail: thumbnail(this.doc), updatedAt: new Date() });
    const last = await this.db.versions.latestAuto(this.id);
    if (!last || Date.now() - +last.createdAt > AUTO_VERSION_MS) {
      await this.db.versions.insert({ _id: id(), boardId: this.id, name: null, auto: true, state, shapeCount: shapesOf(this.doc).size, createdBy: this.lastEditor, createdAt: new Date() });
      await this.db.versions.prune(this.id, KEEP_AUTO_VERSIONS);
    }
  }
}

function send(ws: WebSocket, msg: Uint8Array | string) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(msg); } catch { ws.close(); }
}
const sendJson = (ws: WebSocket, o: object) => send(ws, JSON.stringify(o));

export class Rooms {
  private rooms = new Map<string, Promise<Room>>();
  constructor(private db: Store) {}

  private load(boardId: string): Promise<Room> {
    let p = this.rooms.get(boardId);
    if (!p) {
      p = (async () => {
        const room = new Room(boardId, boardId === LOBBY ? null : this.db);
        if (boardId === LOBBY) writeShapes(room.doc, buildTemplate('lobby'), 'load');
        else {
          const saved = await this.db.docs.get(boardId);
          if (saved?.state.length) Y.applyUpdate(room.doc, saved.state, 'load');
        }
        return room;
      })();
      this.rooms.set(boardId, p);
      p.catch(() => this.rooms.delete(boardId));
    }
    return p;
  }

  /** Change a board from the server (templates, restores, AI). Works whether or not anyone has it open. */
  async edit(boardId: string, fn: (doc: Y.Doc) => void, editor: string | null = null) {
    const room = await this.load(boardId);
    room.lastEditor = editor;
    fn(room.doc);
    room.dirty = true;
    await room.save();
    if (!room.conns.size) this.scheduleClose(room);
  }

  async snapshot(boardId: string) {
    const live = this.rooms.get(boardId);
    if (live) { const r = await live; return Y.encodeStateAsUpdate(r.doc); }
    return (await this.db.docs.get(boardId))?.state ?? new Uint8Array();
  }

  async shapes(boardId: string) {
    return readShapes(docFromState(await this.snapshot(boardId)));
  }

  /** Re-check everyone's access after sharing changes; people who lost access are disconnected. */
  async recheck(boardId: string) {
    const p = this.rooms.get(boardId); if (!p) return;
    const room = await p;
    const board = await this.db.boards.get(boardId);
    room.conns.forEach((c) => {
      const role = board ? roleFor(board, c.user?.id, c.k) : null;
      if (!role) { sendJson(c.ws, { type: 'denied', reason: 'You no longer have access to this board.' }); c.ws.close(4403, 'access'); }
      else if (role !== c.role) { c.role = role; sendJson(c.ws, { type: 'role', role }); }
    });
  }

  private scheduleClose(room: Room) {
    if (room.closeTimer) clearTimeout(room.closeTimer);
    room.closeTimer = setTimeout(async () => {
      if (room.conns.size) return;
      await room.save().catch((e) => console.error('save failed', room.id, e));
      room.doc.destroy();
      this.rooms.delete(room.id);
    }, room.id === LOBBY ? 5 * 60 * 1000 : 30 * 1000);
  }

  attach(server: Server) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
    server.on('upgrade', (req: IncomingMessage, socket, head) => {
      const m = /^\/ws\/([A-Za-z0-9_-]{1,40})$/.exec((req.url || '').split('?')[0]);
      if (!m) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, m[1]));
    });
    const beat = setInterval(() => {
      wss.clients.forEach((ws) => {
        const c = (ws as WebSocket & { conn?: Conn }).conn;
        if (c && !c.alive) return ws.terminate();
        if (c) c.alive = false;
        try { ws.ping(); } catch { /* closed */ }
      });
    }, 30000);
    wss.on('close', () => clearInterval(beat));
    return wss;
  }

  /** First frame is a small JSON hello with the sign-in token, so tokens never appear in URLs or logs. */
  private accept(ws: WebSocket, boardId: string) {
    const timer = setTimeout(() => ws.close(4400, 'no hello'), 8000);
    ws.once('message', async (raw, isBinary) => {
      clearTimeout(timer);
      try {
        if (isBinary) throw new Error('expected hello');
        const hello = JSON.parse(raw.toString()) as { token?: string; k?: string; name?: string };
        const user = hello.token ? verifyAccess(hello.token) : null;
        if (hello.token && !user) { sendJson(ws, { type: 'denied', reason: 'expired' }); return ws.close(4401, 'expired'); }
        let role: Role | null;
        if (boardId === LOBBY) role = 'editor';
        else {
          const board = await this.db.boards.get(boardId);
          role = board ? roleFor(board, user?.id, hello.k ?? null) : null;
          if (!role) { sendJson(ws, { type: 'denied', reason: board ? 'You don’t have access to this board.' : 'This board doesn’t exist.' }); return ws.close(4403, 'access'); }
        }
        const guestName = (hello.name || 'Guest').toString().slice(0, 24);
        const room = await this.load(boardId);
        if (room.closeTimer) { clearTimeout(room.closeTimer); room.closeTimer = null; }
        const conn: Conn = { ws, user, guestName, k: hello.k ?? null, role, ids: new Set(), alive: true };
        (ws as WebSocket & { conn?: Conn }).conn = conn;
        room.conns.set(ws, conn);
        ws.on('pong', () => { conn.alive = true; });
        ws.on('message', (data, bin) => { if (bin) this.onMessage(room, conn, new Uint8Array(data as Buffer)); });
        ws.on('close', () => {
          room.conns.delete(ws);
          awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(conn.ids), null);
          if (!room.conns.size) this.scheduleClose(room);
        });
        sendJson(ws, { type: 'ready', role, user: user ? { id: user.id, name: user.name, color: user.color } : null });
        // start syncing: send our state vector and everyone's presence
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.writeSyncStep1(enc, room.doc);
        send(ws, encoding.toUint8Array(enc));
        const states = Array.from(room.awareness.getStates().keys());
        if (states.length) {
          const a = encoding.createEncoder();
          encoding.writeVarUint(a, MSG_AWARENESS);
          encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(room.awareness, states));
          send(ws, encoding.toUint8Array(a));
        }
      } catch {
        ws.close(4400, 'bad hello');
      }
    });
  }

  private onMessage(room: Room, conn: Conn, data: Uint8Array) {
    try {
      const dec = decoding.createDecoder(data);
      const type = decoding.readVarUint(dec);
      if (type === MSG_SYNC) {
        const sub = decoding.peekVarUint(dec);
        // viewers can ask for the board but their changes are ignored
        if (!canEdit(conn.role) && sub !== syncProtocol.messageYjsSyncStep1) return;
        if (room.id === LOBBY && sub !== syncProtocol.messageYjsSyncStep1 && shapesOf(room.doc).size > LOBBY_MAX_SHAPES) return;
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        if (sub !== syncProtocol.messageYjsSyncStep1) room.lastEditor = conn.user?.id ?? null;
        syncProtocol.readSyncMessage(dec, enc, room.doc, conn.ws);
        if (encoding.length(enc) > 1) send(conn.ws, encoding.toUint8Array(enc));
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(dec), conn.ws);
      }
    } catch (e) {
      console.error('bad message', room.id, e);
    }
  }

  async flushAll() {
    for (const p of this.rooms.values()) { const r = await p; await r.save().catch(() => {}); }
  }
}
