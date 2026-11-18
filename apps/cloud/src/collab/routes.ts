import { Hono } from 'hono';
import type { Bindings } from '../marketplace/types';
import { getIdentity, isResponse, requireUser } from '../marketplace/auth';
import { rateLimit, MINUTE } from '../marketplace/ratelimit';
import { isAllowedOrigin } from './origin';

/**
 * Collaboration rooms. A room is a capability: whoever holds the editor or
 * viewer key may join. Keys are returned once at creation and only their
 * SHA-256 is stored; they travel in the first WebSocket message (never in a
 * URL) and in the invite link's fragment (never sent to any server).
 */
const collab = new Hono<{ Bindings: Bindings }>();

const ROOM_ID = /^r_[0-9a-f]{32}$/;

function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomKey(): string {
  const buf = crypto.getRandomValues(new Uint8Array(24));
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

collab.post('/collab/rooms', rateLimit({ key: 'collab-create', limit: 20, windowMs: 60 * MINUTE }), async (c) => {
  const identity = requireUser(c);
  if (isResponse(identity)) return identity;
  const ns = c.env.COLLAB_ROOMS;
  if (!ns) return c.json({ error: 'collaboration_unavailable' }, 503);

  const roomId = `r_${randomHex(16)}`;
  const editorKey = randomKey();
  const viewerKey = randomKey();
  const stub = ns.get(ns.idFromName(roomId));
  const res = await stub.fetch('https://room/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ editorHash: await sha256Hex(editorKey), viewerHash: await sha256Hex(viewerKey), owner: identity.userId }),
  });
  if (!res.ok) return c.json({ error: 'room_create_failed' }, 500);
  return c.json({ roomId, editorKey, viewerKey, ws: `/v1/collab/rooms/${roomId}/ws` }, 201);
});

collab.get('/collab/rooms/:id/ws', async (c) => {
  const id = c.req.param('id');
  if (!ROOM_ID.test(id)) return c.json({ error: 'not_found' }, 404);
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.json({ error: 'expected_websocket' }, 426);
  // Browsers always send Origin on a WebSocket handshake; refuse foreign pages (cross-site socket hijacking).
  const origin = c.req.header('origin');
  if (origin && !isAllowedOrigin(origin)) return c.json({ error: 'origin_not_allowed' }, 403);
  const ns = c.env.COLLAB_ROOMS;
  if (!ns) return c.json({ error: 'collaboration_unavailable' }, 503);

  // Forward only what the room needs. The user id comes from our own auth shim, never from a client-supplied collab header.
  const headers = new Headers();
  for (const name of ['upgrade', 'connection', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions']) {
    const value = c.req.header(name);
    if (value) headers.set(name, value);
  }
  const identity = getIdentity(c);
  if (identity) headers.set('x-collab-user', identity.userId);
  return ns.get(ns.idFromName(id)).fetch(new Request('https://room/ws', { headers }));
});

export default collab;
