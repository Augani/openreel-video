import type { Context } from "hono";

/**
 * Auth shim (STUDIO_PLAN §45.3). Cross-platform identity is cookie (web) or
 * bearer token (mobile); the marketplace API accepts either. This dev shim
 * trusts `Authorization: Bearer <userId>` / `X-Creator-Id` so the surface is
 * exercisable end-to-end; swap for real JWT/cookie verification in prod.
 */
export interface Identity {
  userId: string;
  creatorId?: string;
  handle?: string;
}

export function getIdentity(c: Context): Identity | null {
  const auth = c.req.header("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : undefined;
  const userId = bearer || c.req.header("x-user-id");
  if (!userId) return null;
  const creatorId = c.req.header("x-creator-id") || userId;
  const handle = c.req.header("x-creator-handle") || undefined;
  return { userId, creatorId, handle };
}

export function requireUser(c: Context): Identity | Response {
  const id = getIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  return id;
}

export function requireCreator(c: Context): (Identity & { creatorId: string }) | Response {
  const id = getIdentity(c);
  if (!id || !id.creatorId) return c.json({ error: "creator_required" }, 401);
  return { ...id, creatorId: id.creatorId };
}

export function isResponse(v: unknown): v is Response {
  return v instanceof Response;
}
