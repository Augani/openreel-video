import { RoomCore, type ClientMessage, type CollabRole, type CollabUser, type Outgoing, type RoomState, type SequencedOp } from '@openreel/collab';
import type { Bindings } from '../marketplace/types';

/** Minimal socket surface the room uses (a hibernatable WebSocket in production, a fake in tests). */
export interface RoomSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

interface Attachment {
  clientId: string | null;
  role: CollabRole | null;
  userId: string | null;
  /** Kept so a hibernated object can re-register this socket's member without a new hello. */
  user?: CollabUser | null;
}

interface RoomMeta {
  editorHash: string;
  viewerHash: string;
  owner: string;
  head: number;
  floor: number;
  snapshotSeq: number | null;
  snapshotChunks: number;
  locks: RoomState['locks'];
}

const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
/** A stored op is one storage value (2 MB limit on SQLite-backed objects); refuse bigger ones instead of failing mid-sequence. */
const MAX_OP_CHARS = 900_000;
const SNAPSHOT_CHUNK = 100_000;
const TICK_MS = 30_000;
const opKey = (seq: number) => `op:${String(seq).padStart(10, '0')}`;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * One Durable Object per shared project. All sequencing lives in RoomCore;
 * this class is the transport (hibernatable WebSockets), the capability check
 * and the storage mapping. State is persisted after every mutation so an
 * evicted object resumes exactly where it stopped.
 */
export class ProjectRoom {
  private core: RoomCore | null = null;
  private meta: RoomMeta | null = null;
  private sockets = new Map<string, RoomSocket>();

  constructor(
    private readonly state: DurableObjectState,
    _env: Bindings,
  ) {
    void this.state.blockConcurrencyWhile(() => this.load());
  }

  // ------------------------------------------------------------------- HTTP

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/init' && request.method === 'POST') {
      if (this.meta) return new Response('exists', { status: 409 });
      const body = (await request.json()) as { editorHash: string; viewerHash: string; owner: string };
      this.meta = { editorHash: body.editorHash, viewerHash: body.viewerHash, owner: body.owner, head: 0, floor: 0, snapshotSeq: null, snapshotChunks: 0, locks: [] };
      this.core = new RoomCore();
      await this.state.storage.put('meta', this.meta);
      return new Response('ok', { status: 201 });
    }
    if (url.pathname === '/ws') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      if (!this.meta) return new Response('Room not found', { status: 404 });
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.state.acceptWebSocket(server);
      const user = request.headers.get('x-collab-user');
      server.serializeAttachment({ clientId: null, role: null, userId: user } satisfies Attachment);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not found', { status: 404 });
  }

  // -------------------------------------------------------------- WebSockets

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.onMessage(ws, message);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onClose(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onClose(ws);
  }

  /** Transport-independent entry points (also what the tests drive). */
  async onMessage(ws: RoomSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.core || !this.meta) await this.state.blockConcurrencyWhile(() => this.load());
    const core = this.core;
    const meta = this.meta;
    if (!core || !meta) {
      ws.close(1011, 'room unavailable');
      return;
    }
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    if (text.length > MAX_MESSAGE_BYTES) {
      ws.send(JSON.stringify({ type: 'error', code: 'too-large', message: 'Message too large.' }));
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      ws.send(JSON.stringify({ type: 'error', code: 'bad-json', message: 'Malformed message.' }));
      return;
    }
    const attachment = (ws.deserializeAttachment() as Attachment | null) ?? { clientId: null, role: null, userId: null };

    let out: Outgoing[];
    if (msg.type === 'hello') {
      const role = await this.roleFor(msg.key, meta);
      if (!role || typeof msg.clientId !== 'string' || msg.clientId.length === 0 || msg.clientId.length > 64) {
        ws.send(JSON.stringify({ type: 'error', code: 'forbidden', message: 'Invalid invite.' }));
        ws.close(4403, 'forbidden');
        return;
      }
      // A client id belongs to the socket that claimed it; a newer socket for the same id replaces the older.
      const known = core.clientInfo(msg.clientId);
      if (known && known.role !== role) {
        // Ids are visible to every member: a viewer must not evict or impersonate an editor by reusing one.
        ws.send(JSON.stringify({ type: 'error', code: 'client-id-in-use', message: 'That client id belongs to another member.' }));
        ws.close(4409, 'client id in use');
        return;
      }
      const previous = this.liveSockets().get(msg.clientId);
      if (previous && previous !== ws) {
        try {
          previous.serializeAttachment({ clientId: null, role: null, userId: null } satisfies Attachment);
          previous.close(4409, 'replaced');
        } catch {
          /* already closed */
        }
      }
      const userId = attachment.userId ?? `guest:${msg.clientId}`;
      this.sockets.set(msg.clientId, ws);
      out = core.hello(msg, role, userId);
      const next: Attachment = { clientId: msg.clientId, role, userId, user: core.clientInfo(msg.clientId)?.user ?? null };
      ws.serializeAttachment(next);
    } else {
      if (!attachment.clientId) {
        ws.send(JSON.stringify({ type: 'error', code: 'not-joined', message: 'Send hello first.' }));
        return;
      }
      if (attachment.role && attachment.user) core.adopt(attachment.clientId, attachment.user, attachment.role);
      if (msg.type === 'op' && text.length > MAX_OP_CHARS) {
        ws.send(JSON.stringify({ type: 'reject', opId: String((msg as { op?: { opId?: unknown } }).op?.opId ?? ''), reason: 'invalid', detail: 'This edit is too large to share (for example a whole-project replacement).' }));
        return;
      }
      this.sockets.set(attachment.clientId, ws);
      out = core.handle(attachment.clientId, msg);
    }
    await this.persist();
    this.dispatch(out);
    await this.scheduleTick();
  }

  async onClose(ws: RoomSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    const clientId = attachment?.clientId;
    if (!clientId) return;
    if (!this.core) await this.state.blockConcurrencyWhile(() => this.load());
    if (!this.core) return;
    if (attachment?.role && attachment.user) this.core.adopt(clientId, attachment.user, attachment.role);
    this.sockets.delete(clientId);
    const out = this.core.leave(clientId);
    await this.persist();
    this.dispatch(out);
  }

  async alarm(): Promise<void> {
    if (!this.core) await this.state.blockConcurrencyWhile(() => this.load());
    if (!this.core) return;
    const out = this.core.tick();
    if (out.length > 0) {
      await this.persist();
      this.dispatch(out);
    }
    await this.scheduleTick();
  }

  // ------------------------------------------------------------------ helpers

  private async roleFor(key: unknown, meta: RoomMeta): Promise<CollabRole | null> {
    if (typeof key !== 'string' || key.length === 0 || key.length > 128) return null;
    const hash = await sha256Hex(key);
    if (timingSafeEqual(hash, meta.editorHash)) return 'editor';
    if (timingSafeEqual(hash, meta.viewerHash)) return 'viewer';
    return null;
  }

  private liveSockets(): Map<string, RoomSocket> {
    // After hibernation the in-memory map is gone: the platform's socket list plus each socket's attachment is the truth.
    if (typeof this.state.getWebSockets === 'function') {
      const rebuilt = new Map<string, RoomSocket>();
      for (const ws of this.state.getWebSockets()) {
        const attachment = ws.deserializeAttachment() as Attachment | null;
        if (attachment?.clientId) rebuilt.set(attachment.clientId, ws as unknown as RoomSocket);
      }
      this.sockets = rebuilt;
    }
    return this.sockets;
  }

  private dispatch(out: readonly Outgoing[]): void {
    const sockets = this.liveSockets();
    for (const item of out) {
      const data = JSON.stringify(item.msg);
      if (item.to === '*') {
        for (const [clientId, ws] of sockets) {
          if (clientId === item.except) continue;
          this.safeSend(ws, data);
        }
      } else {
        const ws = sockets.get(item.to);
        if (ws) this.safeSend(ws, data);
      }
    }
  }

  private safeSend(ws: RoomSocket, data: string): void {
    try {
      ws.send(data);
    } catch {
      /* the close handler will clean up */
    }
  }

  private async scheduleTick(): Promise<void> {
    const storage = this.state.storage;
    if (typeof storage.getAlarm !== 'function') return;
    if ((await storage.getAlarm()) === null && this.liveSockets().size > 0) await storage.setAlarm(Date.now() + TICK_MS);
  }

  // ------------------------------------------------------------------ storage

  private async load(): Promise<void> {
    const meta = await this.state.storage.get<RoomMeta>('meta');
    if (!meta) return;
    this.meta = meta;
    let snapshot: RoomState['snapshot'] = null;
    if (meta.snapshotSeq !== null) {
      const parts: string[] = [];
      for (let i = 0; i < meta.snapshotChunks; i++) parts.push((await this.state.storage.get<string>(`snap:${i}`)) ?? '');
      snapshot = { seq: meta.snapshotSeq, project: JSON.parse(parts.join('')) };
    }
    const stored = await this.state.storage.list<SequencedOp>({ prefix: 'op:' });
    const log = [...stored.values()].sort((a, b) => a.seq - b.seq);
    this.core = RoomCore.restore({ snapshot, log, head: meta.head, floor: meta.floor, locks: meta.locks });
    this.rehydrateMembers(this.core);
  }

  /** Sockets that survived hibernation still carry their member in the attachment: put them back in the room. */
  private rehydrateMembers(core: RoomCore): void {
    if (typeof this.state.getWebSockets !== 'function') return;
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.clientId && a.role && a.user) core.adopt(a.clientId, a.user, a.role);
    }
  }

  private async persist(): Promise<void> {
    const core = this.core;
    const meta = this.meta;
    if (!core || !meta) return;
    const changes = core.drainChanges();
    const state = core.serialize();
    const writes: Record<string, unknown> = {};
    for (const op of changes.appended) writes[opKey(op.seq)] = op;
    if (changes.snapshotChanged && state.snapshot) {
      const json = JSON.stringify(state.snapshot.project);
      const chunks = Math.max(1, Math.ceil(json.length / SNAPSHOT_CHUNK));
      for (let i = 0; i < chunks; i++) writes[`snap:${i}`] = json.slice(i * SNAPSHOT_CHUNK, (i + 1) * SNAPSHOT_CHUNK);
      for (let i = chunks; i < meta.snapshotChunks; i++) await this.state.storage.delete(`snap:${i}`);
      meta.snapshotChunks = chunks;
      meta.snapshotSeq = state.snapshot.seq;
    }
    meta.head = state.head;
    meta.floor = state.floor;
    meta.locks = state.locks;
    writes.meta = meta;
    if (changes.droppedThrough !== null) {
      const stale = await this.state.storage.list({ prefix: 'op:', end: opKey(changes.droppedThrough + 1) });
      const keys = [...stale.keys()];
      if (keys.length > 0) await this.state.storage.delete(keys);
    }
    await this.state.storage.put(writes);
  }
}
