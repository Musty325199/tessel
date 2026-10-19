import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MSG_SYNC = 0, MSG_AWARENESS = 1;
export type Status = 'connecting' | 'online' | 'offline' | 'denied';
export type Role = 'owner' | 'editor' | 'viewer';

type Hello = () => Promise<{ token?: string; k?: string; name?: string }>;
type Events = { status?: (s: Status, detail?: string) => void; role?: (r: Role) => void; synced?: () => void; expired?: () => void };

/**
 * Keeps one board's doc and presence in sync with the server over a WebSocket.
 * Reconnects with backoff, and anything edited while offline is merged on reconnect.
 */
export class BoardConnection {
  awareness: awarenessProtocol.Awareness;
  status: Status = 'connecting';
  role: Role | null = null;
  synced = false;
  private ws: WebSocket | null = null;
  private tries = 0;
  private timer: number | undefined;
  private stopped = false;
  private pendingAwareness = new Set<number>();
  private awTimer: number | undefined;

  constructor(private url: string, private doc: Y.Doc, private hello: Hello, private on: Events = {}) {
    this.awareness = new awarenessProtocol.Awareness(doc);
    doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    window.addEventListener('online', this.retryNow);
    document.addEventListener('visibilitychange', this.onVisible);
    this.connect();
  }

  private set(s: Status, detail?: string) { this.status = s; this.on.status?.(s, detail); }

  private connect() {
    if (this.stopped) return;
    this.set('connecting');
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = async () => {
      try { ws.send(JSON.stringify(await this.hello())); } catch { ws.close(); }
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') return this.onControl(JSON.parse(ev.data));
      this.onBinary(new Uint8Array(ev.data as ArrayBuffer));
    };
    ws.onclose = (ev) => {
      this.ws = null;
      this.synced = false;
      // other people's cursors are stale once we lose the connection
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(this.awareness.getStates().keys()).filter((c) => c !== this.doc.clientID), 'connection');
      if (this.stopped) return;
      if (ev.code === 4403) return this.set('denied', ev.reason);
      if (ev.code === 4401) { this.on.expired?.(); }
      this.set('offline');
      const delay = Math.min(15000, 600 * 2 ** this.tries++) * (0.75 + Math.random() * 0.5);
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private onControl(m: { type: string; role?: Role; reason?: string }) {
    if (m.type === 'ready') {
      this.tries = 0;
      this.role = m.role!;
      this.on.role?.(m.role!);
      this.set('online');
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeSyncStep1(enc, this.doc);
      this.send(encoding.toUint8Array(enc));
      if (this.awareness.getLocalState()) this.sendAwareness([this.doc.clientID]);
    } else if (m.type === 'role') {
      this.role = m.role!; this.on.role?.(m.role!);
    } else if (m.type === 'denied') {
      this.set('denied', m.reason);
    }
  }

  private onBinary(data: Uint8Array) {
    const dec = decoding.createDecoder(data);
    const type = decoding.readVarUint(dec);
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      const sub = syncProtocol.readSyncMessage(dec, enc, this.doc, this);
      if (encoding.length(enc) > 1) this.send(encoding.toUint8Array(enc));
      if (sub === syncProtocol.messageYjsSyncStep2 && !this.synced) { this.synced = true; this.on.synced?.(); }
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), this);
    }
  }

  private send(msg: Uint8Array) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(msg as Uint8Array<ArrayBuffer>); }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    this.send(encoding.toUint8Array(enc));
  };

  /** Cursor moves happen many times a second; send at most ~20 presence updates per second. */
  private onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this || origin === 'connection') return;
    added.concat(updated, removed).forEach((c) => this.pendingAwareness.add(c));
    if (this.awTimer) return;
    this.awTimer = window.setTimeout(() => {
      this.awTimer = undefined;
      const ids = Array.from(this.pendingAwareness); this.pendingAwareness.clear();
      this.sendAwareness(ids);
    }, 50);
  };

  private sendAwareness(ids: number[]) {
    if (!ids.length) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids));
    this.send(encoding.toUint8Array(enc));
  }

  private retryNow = () => {
    if (this.ws || this.stopped || this.status === 'denied') return;
    clearTimeout(this.timer); this.tries = 0; this.connect();
  };
  private onVisible = () => { if (document.visibilityState === 'visible') this.retryNow(); };

  destroy() {
    this.stopped = true;
    clearTimeout(this.timer); clearTimeout(this.awTimer);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'local');
    try { this.sendAwareness([this.doc.clientID]); } catch { /* closing */ }
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.awareness.destroy();
    window.removeEventListener('online', this.retryNow);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.ws?.close();
  }
}
