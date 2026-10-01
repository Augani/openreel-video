import type { Context, Next } from "hono";

/**
 * Sliding-window rate limiter (STUDIO_PLAN §34.6). In-memory per isolate for
 * dev; production enforces in Redis/KV with sliding-window counters. Limits:
 * submissions 10/day, installs 1000/day, render previews 60/min, events 10/s,
 * authoring 100/s.
 */
interface Window {
  hits: number[];
}
const buckets = new Map<string, Window>();

export function rateLimit(opts: { key: string; limit: number; windowMs: number; keyFn?: (c: Context) => string }) {
  return async (c: Context, next: Next) => {
    const id = opts.keyFn ? opts.keyFn(c) : (c.req.header("x-user-id") || c.req.header("authorization") || "anon");
    const bucketKey = `${opts.key}:${id}`;
    const now = Date.now();
    const w = buckets.get(bucketKey) ?? { hits: [] };
    w.hits = w.hits.filter((t) => now - t < opts.windowMs);
    if (w.hits.length >= opts.limit) {
      const retryAfter = Math.ceil((opts.windowMs - (now - w.hits[0])) / 1000);
      c.header("Retry-After", String(Math.max(1, retryAfter)));
      return c.json({ error: "rate_limited", retry_after_s: retryAfter }, 429);
    }
    w.hits.push(now);
    buckets.set(bucketKey, w);
    await next();
  };
}

export const DAY = 86_400_000;
export const MINUTE = 60_000;
export const SECOND = 1_000;
