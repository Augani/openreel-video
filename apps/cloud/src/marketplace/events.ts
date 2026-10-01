import { Hono } from "hono";
import {
  verifyEvent,
  checkExportPayable,
  exportDedupeKey,
  computeAttribution,
  payableValue,
  creatorPayableCents,
  payableAfter,
  type AppliedAsset,
  type EventType,
  type EarningsEntry,
} from "@openreel/fxpkg";
import type { Bindings } from "./types";
import { getStore } from "./store";
import { rateLimit, SECOND } from "./ratelimit";

const app = new Hono<{ Bindings: Bindings }>();
const now = () => new Date().toISOString();

interface IncomingEvent {
  event_id: string;
  type: EventType;
  user_id: string;
  session_nonce: string;
  signature: string;
  payload: {
    asset_id?: string;
    export?: {
      gross_cents: number;
      duration_ms: number;
      contains_user_media: boolean;
      content_hash: string;
      applied: AppliedAsset[];
      day: string;
    };
  };
}

// Batched event upload (§34.5, §41.2). Edge worker validates session token,
// dedupes, rate-limits, then writes payable balances for EXPORT_COMPLETED.
app.post("/events", rateLimit({ key: "events", limit: 10, windowMs: SECOND }), async (c) => {
  const secret = c.env.EVENT_HMAC_SECRET;
  const body = await c.req.json<{ events: IncomingEvent[] }>();
  const store = getStore(c.env);
  const results: Array<{ event_id: string; status: string; detail?: unknown }> = [];

  for (const ev of body.events ?? []) {
    // fraud-safe event sealing (§41.5): verify HMAC when a secret is configured
    if (secret) {
      const ok = verifyEvent(JSON.stringify(ev.payload), ev.session_nonce, secret, ev.signature);
      if (!ok) {
        results.push({ event_id: ev.event_id, status: "rejected", detail: "bad_signature" });
        continue;
      }
    }

    if (ev.type !== "EXPORT_COMPLETED" || !ev.payload.export) {
      results.push({ event_id: ev.event_id, status: "accepted" });
      continue;
    }

    const exp = ev.payload.export;
    const check = checkExportPayable({
      userId: ev.user_id,
      assetId: ev.payload.asset_id ?? "",
      day: exp.day,
      durationMs: exp.duration_ms,
      containsUserMedia: exp.contains_user_media,
      contentHash: exp.content_hash,
    });
    if (!check.payable) {
      results.push({ event_id: ev.event_id, status: "not_payable", detail: check.reasons });
      continue;
    }

    const dedupe = exportDedupeKey({
      userId: ev.user_id,
      assetId: ev.payload.asset_id ?? "",
      day: exp.day,
      durationMs: exp.duration_ms,
      containsUserMedia: exp.contains_user_media,
      contentHash: exp.content_hash,
    });
    if (await store.seenExport(dedupe)) {
      results.push({ event_id: ev.event_id, status: "duplicate" });
      continue;
    }
    await store.markExport(dedupe);

    const exportId = ev.event_id;
    const attributions = computeAttribution(exportId, exp.applied);
    await store.addAttributions(attributions);

    const split = payableValue(exp.gross_cents);
    for (const attr of attributions) {
      const version = await findVersion(store, attr.assetVersionId);
      if (!version) continue;
      const creatorId = version.manifest.author.creator_id;
      const creatorCents = creatorPayableCents(split.creatorPoolCents, attr.share);
      const earnedAt = now();
      const entry: EarningsEntry = {
        id: crypto.randomUUID(),
        creatorId,
        exportId,
        assetVersionId: attr.assetVersionId,
        grossCents: exp.gross_cents,
        creatorCents,
        state: "pending",
        earnedAt,
        payableAt: payableAfter(earnedAt),
      };
      await store.addEarning(entry);
      const bal = await store.getBalance(creatorId);
      bal.pendingCents += creatorCents;
      await store.setBalance({ ...bal });
    }
    results.push({ event_id: ev.event_id, status: "payable", detail: { gross_cents: exp.gross_cents, creator_pool_cents: split.creatorPoolCents } });
  }

  return c.json({ results });
});

async function findVersion(store: ReturnType<typeof getStore>, versionId: string) {
  const { items } = await store.listAssets({});
  for (const asset of items) {
    const vs = await store.listVersions(asset.id);
    const v = vs.find((x) => x.id === versionId);
    if (v) return v;
  }
  return undefined;
}

export default app;
