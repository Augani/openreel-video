import { describe, it, expect } from 'vitest';
import app from '../index';
import { ProjectRoom, type RoomSocket } from './room-do';
import { sha256Hex } from './routes';
import type { ServerMessage } from '@openreel/collab';

class FakeSocket implements RoomSocket {
  inbox: ServerMessage[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private attachment: unknown = null;
  send(data: string) {
    this.inbox.push(JSON.parse(data) as ServerMessage);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  serializeAttachment(value: unknown) {
    this.attachment = JSON.parse(JSON.stringify(value));
  }
  deserializeAttachment() {
    return this.attachment;
  }
  ofType<T extends ServerMessage['type']>(type: T) {
    return this.inbox.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
}

/** Durable Object state with in-memory storage; `restart()` simulates eviction (storage survives). */
class FakeState {
  readonly data = new Map<string, unknown>();
  readonly sockets: FakeSocket[] = [];
  alarm: number | null = null;
  storage = {
    get: async (key: string) => structuredClone(this.data.get(key)),
    put: async (entries: string | Record<string, unknown>, value?: unknown) => {
      if (typeof entries === 'string') this.data.set(entries, structuredClone(value));
      else for (const [k, v] of Object.entries(entries)) this.data.set(k, structuredClone(v));
    },
    delete: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) this.data.delete(k);
    },
    list: async (opts: { prefix?: string; end?: string }) => {
      const out = new Map<string, unknown>();
      for (const k of [...this.data.keys()].sort()) {
        if (opts.prefix && !k.startsWith(opts.prefix)) continue;
        if (opts.end && k >= opts.end) continue;
        out.set(k, structuredClone(this.data.get(k)));
      }
      return out;
    },
    getAlarm: async () => this.alarm,
    setAlarm: async (t: number) => {
      this.alarm = t;
    },
  };
  async blockConcurrencyWhile<T>(fn: () => Promise<T>) {
    return fn();
  }
  acceptWebSocket(ws: FakeSocket) {
    this.sockets.push(ws);
  }
  getWebSockets() {
    return this.sockets.filter((s) => !s.closed);
  }
}

const EDITOR = 'editor-secret';
const VIEWER = 'viewer-secret';

async function makeRoom(state = new FakeState()) {
  const room = new ProjectRoom(state as unknown as DurableObjectState, {} as never);
  if (!state.data.has('meta')) {
    const res = await room.fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ editorHash: await sha256Hex(EDITOR), viewerHash: await sha256Hex(VIEWER), owner: 'owner' }) }));
    expect(res.status).toBe(201);
  }
  return { room, state };
}

function connect(state: FakeState): FakeSocket {
  const ws = new FakeSocket();
  ws.serializeAttachment({ clientId: null, role: null, userId: null });
  state.acceptWebSocket(ws);
  return ws;
}

const send = (room: ProjectRoom, ws: FakeSocket, msg: unknown) => room.onMessage(ws, JSON.stringify(msg));
const hello = (clientId: string, key = EDITOR, lastSeq: number | null = null) => ({ type: 'hello', clientId, name: clientId, key, lastSeq });
const op = (opId: string, baseSeq: number, touches: string[], locks: string[] = []) => ({ type: 'op', op: { opId, baseSeq, touches, locks, actions: [{ type: 'clip/move', id: opId, timestamp: 1, params: {} }] } });

describe('ProjectRoom durable object', () => {
  it('rejects a bad invite key and closes the socket', async () => {
    const { room, state } = await makeRoom();
    const ws = connect(state);
    await send(room, ws, hello('a', 'wrong'));
    expect(ws.ofType('error')[0]).toMatchObject({ code: 'forbidden' });
    expect(ws.closed?.code).toBe(4403);
  });

  it('lets the owner seed the room, then fans ops out to other members with a total order', async () => {
    const { room, state } = await makeRoom();
    const a = connect(state);
    const b = connect(state);
    await send(room, a, hello('a'));
    expect(a.ofType('welcome')[0].needsInit).toBe(true);
    await send(room, a, { type: 'init', project: { name: 'P' } });
    await send(room, b, hello('b'));
    expect(b.ofType('welcome')[0].snapshot).toEqual({ seq: 0, project: { name: 'P' } });
    await send(room, a, op('o1', 0, ['clip:c1']));
    await send(room, b, op('o2', 0, ['clip:c2']));
    expect(a.ofType('op').map((m) => [m.op.seq, m.op.opId])).toEqual([[1, 'o1'], [2, 'o2']]);
    expect(b.ofType('op').map((m) => [m.op.seq, m.op.opId])).toEqual([[1, 'o1'], [2, 'o2']]);
  });

  it('rejects a conflicting op only to its author', async () => {
    const { room, state } = await makeRoom();
    const a = connect(state);
    const b = connect(state);
    await send(room, a, hello('a'));
    await send(room, a, { type: 'init', project: {} });
    await send(room, b, hello('b'));
    await send(room, a, op('o1', 0, ['clip:c1']));
    await send(room, b, op('o2', 0, ['clip:c1']));
    expect(b.ofType('reject')[0]).toMatchObject({ opId: 'o2', reason: 'conflict' });
    expect(a.ofType('reject')).toEqual([]);
  });

  it('keeps viewers read-only on the server, whatever the client sends', async () => {
    const { room, state } = await makeRoom();
    const a = connect(state);
    const v = connect(state);
    await send(room, a, hello('a'));
    await send(room, a, { type: 'init', project: {} });
    await send(room, v, hello('v', VIEWER));
    expect(v.ofType('welcome')[0].role).toBe('viewer');
    await send(room, v, op('vo', 0, []));
    expect(v.ofType('reject')[0]).toMatchObject({ reason: 'readonly' });
    await send(room, v, { type: 'lock', resource: 'bin:b1', acquire: true });
    expect(v.ofType('error').some((m) => m.code === 'readonly')).toBe(true);
  });

  it('refuses ops before hello and malformed frames', async () => {
    const { room, state } = await makeRoom();
    const ws = connect(state);
    await send(room, ws, op('x', 0, []));
    expect(ws.ofType('error')[0]).toMatchObject({ code: 'not-joined' });
    await room.onMessage(ws, '{nope');
    expect(ws.ofType('error')[1]).toMatchObject({ code: 'bad-json' });
  });

  it('survives eviction: a new object instance resumes sequencing, conflict checks, locks and snapshots from storage', async () => {
    const { room, state } = await makeRoom();
    const a = connect(state);
    await send(room, a, hello('a'));
    await send(room, a, { type: 'init', project: { big: 'x'.repeat(250_000) } }); // spans several storage chunks
    await send(room, a, op('o1', 0, ['clip:c1']));
    await send(room, a, { type: 'lock', resource: 'bin:b1', acquire: true });

    // Evict: the object is rebuilt over the same storage; sockets reconnect.
    state.sockets.length = 0;
    const revived = await makeRoom(state);
    const b = connect(state);
    await send(revived.room, b, hello('b', EDITOR, null));
    const welcome = b.ofType('welcome')[0];
    expect(welcome.seq).toBe(1);
    expect((welcome.snapshot!.project as { big: string }).big).toHaveLength(250_000);
    expect(welcome.ops.map((o) => o.opId)).toEqual(['o1']);
    expect(welcome.locks.map((l) => l.resource)).toEqual(['bin:b1']);
    await send(revived.room, b, op('o2', 0, ['clip:c1']));
    expect(b.ofType('reject')[0]).toMatchObject({ reason: 'conflict' });
    await send(revived.room, b, op('o3', 0, ['media:m'], ['bin:b1']));
    expect(b.ofType('reject')[1]).toMatchObject({ reason: 'locked' });
  });

  it('tells others when a member leaves and frees a replaced socket without dropping the member', async () => {
    const { room, state } = await makeRoom();
    const a = connect(state);
    const b = connect(state);
    await send(room, a, hello('a'));
    await send(room, a, { type: 'init', project: {} });
    await send(room, b, hello('b'));
    expect(a.ofType('peers').at(-1)!.peers.map((p) => p.clientId).sort()).toEqual(['a', 'b']);
    b.closed = { code: 1000 };
    await room.onClose(b);
    expect(a.ofType('peers').at(-1)!.peers.map((p) => p.clientId)).toEqual(['a']);

    // 'a' reconnects on a fresh socket while the old one lingers: the old one is retired, 'a' stays present.
    const a2 = connect(state);
    await send(room, a2, hello('a', EDITOR, 0));
    expect(a.closed?.code).toBe(4409);
    await room.onClose(a);
    expect(a2.ofType('peers').length + a2.ofType('welcome').length).toBeGreaterThan(0);
    await send(room, a2, op('o9', 0, ['clip:z']));
    expect(a2.ofType('op').at(-1)!.op.opId).toBe('o9');
  });

  it('keeps serving sockets that outlive a hibernated object (the member table is rebuilt from attachments)', async () => {
    const { room, state } = await makeRoom();
    const a = connect(state);
    const b = connect(state);
    await send(room, a, hello('a'));
    await send(room, a, { type: 'init', project: {} });
    await send(room, b, hello('b'));
    await send(room, a, op('o1', 0, ['clip:c1']));

    // Hibernation: the object is rebuilt over the same storage, but the sockets stay open.
    const woken = await makeRoom(state);
    const c = connect(state);
    await send(woken.room, c, hello('c'));
    // The newcomer sees the members whose sockets survived.
    expect(c.ofType('welcome')[0].peers.map((p) => p.clientId).sort()).toEqual(['a', 'b', 'c']);

    // A survivor keeps working without a new hello, as itself.
    await send(woken.room, a, op('o2', 1, ['clip:c2']));
    expect(a.ofType('error')).toEqual([]);
    expect(b.ofType('op').map((m) => m.op.opId)).toEqual(['o1', 'o2']);
    await send(woken.room, b, { type: 'presence', presence: { playhead: 3, selection: ['x'] } });
    expect(b.ofType('error')).toEqual([]);
    expect(c.ofType('peers').at(-1)!.peers.find((p) => p.clientId === 'b')!.presence.playhead).toBe(3);

    // Closing a survivor after wake-up is still announced.
    b.closed = { code: 1000 };
    await woken.room.onClose(b);
    expect(c.ofType('peers').at(-1)!.peers.map((p) => p.clientId).sort()).toEqual(['a', 'c']);
  });

  it('does not let a viewer take over an editor client id', async () => {
    const { room, state } = await makeRoom();
    const a = connect(state);
    const v = connect(state);
    await send(room, a, hello('a'));
    await send(room, a, { type: 'init', project: {} });
    await send(room, v, hello('a', VIEWER));
    expect(v.ofType('error')[0]).toMatchObject({ code: 'client-id-in-use' });
    expect(v.closed?.code).toBe(4409);
    expect(a.closed).toBeNull();
    await send(room, a, op('o1', 0, ['clip:c1']));
    expect(a.ofType('reject')).toEqual([]);
    expect(a.ofType('op').map((m) => m.op.opId)).toEqual(['o1']);
  });

  it('rejects an op too large to store instead of failing mid-sequence', async () => {
    const { room, state } = await makeRoom();
    const a = connect(state);
    await send(room, a, hello('a'));
    await send(room, a, { type: 'init', project: {} });
    await send(room, a, { type: 'op', op: { opId: 'big', baseSeq: 0, touches: ['*'], locks: [], actions: [{ type: 'x', id: 'big', timestamp: 1, params: { blob: 'y'.repeat(1_000_000) } }] } });
    expect(a.ofType('reject')[0]).toMatchObject({ opId: 'big', reason: 'invalid' });
    await send(room, a, op('o1', 0, ['clip:c1']));
    expect(a.ofType('op').map((m) => m.op.seq)).toEqual([1]);
  });

  it('schedules an alarm so abandoned locks expire', async () => {
    const { room, state } = await makeRoom();
    const a = connect(state);
    await send(room, a, hello('a'));
    expect(state.alarm).not.toBeNull();
  });
});

describe('collaboration HTTP routes', () => {
  const env = { ENVIRONMENT: 'test' } as never;

  it('requires an identity to create a room, and reports when collaboration is not configured', async () => {
    const anon = await app.request('/v1/collab/rooms', { method: 'POST' }, env);
    expect(anon.status).toBe(401);
    const noDo = await app.request('/v1/collab/rooms', { method: 'POST', headers: { Authorization: 'Bearer u1' } }, env);
    expect(noDo.status).toBe(503);
  });

  it('creates a room through the namespace and hands back one-time keys', async () => {
    const inits: unknown[] = [];
    const ns = {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (_url: string, init: { body: string }) => {
          inits.push(JSON.parse(init.body));
          return new Response('ok', { status: 201 });
        },
      }),
    };
    const res = await app.request('/v1/collab/rooms', { method: 'POST', headers: { Authorization: 'Bearer u1' } }, { COLLAB_ROOMS: ns } as never);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { roomId: string; editorKey: string; viewerKey: string; ws: string };
    expect(body.roomId).toMatch(/^r_[0-9a-f]{32}$/);
    expect(body.editorKey).not.toBe(body.viewerKey);
    expect(body.ws).toBe(`/v1/collab/rooms/${body.roomId}/ws`);
    const stored = inits[0] as { editorHash: string; viewerHash: string; owner: string };
    // Only hashes are stored, never the keys.
    expect(stored.editorHash).toBe(await sha256Hex(body.editorKey));
    expect(JSON.stringify(stored)).not.toContain(body.editorKey);
    expect(stored.owner).toBe('u1');
  });

  it('refuses sockets from foreign origins, non-upgrade requests and malformed room ids', async () => {
    const ns = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('x') }) };
    const room = 'r_' + 'a'.repeat(32);
    const ws = (path: string, headers: Record<string, string>) => app.request(path, { headers }, { COLLAB_ROOMS: ns } as never);
    expect((await ws(`/v1/collab/rooms/${room}/ws`, { Upgrade: 'websocket', Origin: 'https://evil.example' })).status).toBe(403);
    expect((await ws(`/v1/collab/rooms/${room}/ws`, {})).status).toBe(426);
    expect((await ws(`/v1/collab/rooms/nope/ws`, { Upgrade: 'websocket' })).status).toBe(404);
    expect((await ws(`/v1/collab/rooms/${room}/ws`, { Upgrade: 'websocket', Origin: 'https://app.openreel.video' })).status).toBe(200);
  });

  it('does not forward a client-supplied identity header to the room', async () => {
    let forwarded: Request | null = null;
    const ns = { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => ((forwarded = r), new Response('x')) }) };
    const room = 'r_' + 'b'.repeat(32);
    await app.request(`/v1/collab/rooms/${room}/ws`, { headers: { Upgrade: 'websocket', 'x-collab-user': 'admin' } }, { COLLAB_ROOMS: ns } as never);
    expect(forwarded!.headers.get('x-collab-user')).toBeNull();
    await app.request(`/v1/collab/rooms/${room}/ws`, { headers: { Upgrade: 'websocket', 'x-collab-user': 'admin', Authorization: 'Bearer real' } }, { COLLAB_ROOMS: ns } as never);
    expect(forwarded!.headers.get('x-collab-user')).toBe('real');
  });
});
