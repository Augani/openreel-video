import { Hono } from "hono";
import type { Context } from "hono";
import type { Bindings } from "../marketplace/types";

const crash = new Hono<{ Bindings: Bindings }>();

const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGE = 8000;
const MAX_STACK = 16000;
const MAX_SHORT = 128;
const MAX_CONTEXT = 8000;

function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function clipContext(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  try {
    const json = JSON.stringify(value);
    if (json.length <= MAX_CONTEXT) return value;
    return { truncated: true, preview: json.slice(0, MAX_CONTEXT) };
  } catch {
    return undefined;
  }
}

crash.post("/crash", async (c) => {
  const declaredLength = Number(c.req.header("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return c.json({ error: "payload too large" }, 413);
  }

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ error: "invalid payload" }, 400);
  }

  const message = clip(body.message, MAX_MESSAGE);
  if (!message) {
    return c.json({ error: "message required" }, 400);
  }

  const cf = (c.req.raw as unknown as { cf?: { country?: string } }).cf;
  const report = {
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    message,
    stack: clip(body.stack, MAX_STACK),
    type: clip(body.type, MAX_SHORT) ?? "unknown",
    source: clip(body.source, MAX_SHORT) ?? "unknown",
    appVersion: clip(body.appVersion, MAX_SHORT) ?? "unknown",
    platform: clip(body.platform, MAX_SHORT),
    arch: clip(body.arch, MAX_SHORT),
    osVersion: clip(body.osVersion, MAX_SHORT),
    electronVersion: clip(body.electronVersion, MAX_SHORT),
    context: clipContext(body.context),
    ip: c.req.header("cf-connecting-ip"),
    country: cf?.country,
    userAgent: clip(c.req.header("user-agent"), 256),
  };

  console.log(JSON.stringify({ tag: "crash", ...report, stack: undefined }));

  const bucket = c.env.CRASHES_BUCKET;
  if (bucket) {
    const day = report.receivedAt.slice(0, 10);
    const key = `crashes/${day}/${report.appVersion}/${report.id}.json`;
    try {
      await bucket.put(key, JSON.stringify(report, null, 2), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
          type: report.type,
          source: report.source,
          appVersion: report.appVersion,
          platform: report.platform ?? "",
        },
      });
    } catch (error) {
      console.error("crash store failed", error);
    }
  }

  return c.json({ ok: true, id: report.id }, 201);
});

function authorized(c: Context<{ Bindings: Bindings }>): boolean {
  const token = c.env.CRASH_ADMIN_TOKEN;
  if (!token) return false;
  return c.req.header("authorization") === `Bearer ${token}`;
}

crash.get("/crash", async (c) => {
  if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);

  const bucket = c.env.CRASHES_BUCKET;
  if (!bucket) return c.json({ crashes: [], truncated: false });

  const key = c.req.query("key");
  if (key) {
    const object = await bucket.get(key);
    if (!object) return c.json({ error: "not found" }, 404);
    return c.json(await object.json());
  }

  const listed = await bucket.list({
    prefix: c.req.query("prefix") ?? "crashes/",
    limit: 100,
    cursor: c.req.query("cursor") || undefined,
  });
  return c.json({
    crashes: listed.objects.map((o) => ({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded,
      ...o.customMetadata,
    })),
    cursor: listed.truncated ? (listed as { cursor?: string }).cursor : undefined,
    truncated: listed.truncated,
  });
});

export default crash;
