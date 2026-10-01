import { describe, it, expect, beforeEach } from "vitest";
import app from "../index";
import { sealEvent, getBlueprint } from "@openreel/fxpkg";

// In-memory store is module-global; reset between suites by using fresh ids.
const env = { ENVIRONMENT: "test", EVENT_HMAC_SECRET: "test-secret" } as unknown as Record<string, unknown>;
const creatorHeaders = { "Content-Type": "application/json", "X-User-Id": "u-creator", "X-Creator-Id": "c-1", "X-Creator-Handle": "augani" };
const userHeaders = { "Content-Type": "application/json", "X-User-Id": "u-viewer" };

async function req(path: string, init?: RequestInit) {
  return app.request(path, init, env as never);
}

describe("marketplace + studio API", () => {
  let draftId = "";
  let assetId = "";
  let versionId = "";
  let submissionId = "";

  beforeEach(() => {
    /* shared state across ordered tests */
  });

  it("lists blueprints and node library", async () => {
    const bp = await req("/v1/blueprints");
    expect(bp.status).toBe(200);
    const bpJson = (await bp.json()) as { blueprints: Array<{ id: string }> };
    expect(bpJson.blueprints.map((b) => b.id)).toContain("fire-aura.v1");

    const nl = await req("/v1/nodelib?abi=1.0");
    const nlJson = (await nl.json()) as { nodes: Array<{ id: string }> };
    expect(nlJson.nodes.some((n) => n.id === "Source")).toBe(true);
    expect(nlJson.nodes.some((n) => n.id === "Depth")).toBe(false); // 1.2 node
  });

  it("requires a creator for drafts", async () => {
    const r = await req("/v1/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "filter" }) });
    expect(r.status).toBe(401);
  });

  it("creates and autosaves a draft from the passthrough blueprint", async () => {
    const graph = getBlueprint("passthrough.v1")!.build({});
    const create = await req("/v1/drafts", {
      method: "POST",
      headers: creatorHeaders,
      body: JSON.stringify({ kind: "filter", title: "My Filter", graph, manifest_draft: { title: "My Filter", description: "test" } }),
    });
    expect(create.status).toBe(201);
    draftId = ((await create.json()) as { id: string }).id;

    const save = await req(`/v1/drafts/${draftId}`, { method: "PUT", headers: creatorHeaders, body: JSON.stringify({ title: "My Filter v2" }) });
    expect(save.status).toBe(200);
  });

  it("validates the draft (pre-flight)", async () => {
    const r = await req(`/v1/drafts/${draftId}/validate`, { method: "POST", headers: creatorHeaders });
    const j = (await r.json()) as { validation: { ok: boolean }; compile?: { ok: boolean } };
    expect(j.validation.ok).toBe(true);
    expect(j.compile?.ok).toBe(true);
  });

  it("submits, passes auto-checks, and enters human review", async () => {
    const r = await req(`/v1/drafts/${draftId}/submit`, { method: "POST", headers: creatorHeaders });
    expect(r.status).toBe(201);
    const j = (await r.json()) as { submission: { id: string; state: string }; asset: { id: string }; version: { id: string } };
    expect(j.submission.state).toBe("human_review");
    submissionId = j.submission.id;
    assetId = j.asset.id;
    versionId = j.version.id;
  });

  it("rejects a submission with a bad graph (no output)", async () => {
    const bad = await req("/v1/drafts", {
      method: "POST", headers: creatorHeaders,
      body: JSON.stringify({ kind: "filter", title: "Broken", graph: { id: "b", kind: "filter", abi: "1.0", nodelibVersion: "1.0.0", nodes: [{ id: "s", type: "Source" }], edges: [], params: [] } }),
    });
    const badId = ((await bad.json()) as { id: string }).id;
    const sub = await req(`/v1/drafts/${badId}/submit`, { method: "POST", headers: creatorHeaders });
    expect(sub.status).toBe(422);
    const j = (await sub.json()) as { submission: { state: string } };
    expect(j.submission.state).toBe("creator_feedback");
  });

  it("reviewer approves → published; asset appears in discovery", async () => {
    const review = await req(`/v1/submissions/${submissionId}/review`, { method: "POST", headers: creatorHeaders, body: JSON.stringify({ decision: "approve" }) });
    expect(review.status).toBe(200);
    const j = (await review.json()) as { submission: { state: string } };
    expect(j.submission.state).toBe("published");

    const list = await req("/v1/assets?sort=new");
    const lj = (await list.json()) as { assets: Array<{ id: string }> };
    expect(lj.assets.some((a) => a.id === assetId)).toBe(true);
  });

  it("downloads the published manifest + fxpkg uri", async () => {
    const man = await req(`/v1/assets/${assetId}/versions/1/manifest`);
    expect(man.status).toBe(200);
    const dl = await req(`/v1/assets/${assetId}/versions/1/download`);
    expect(dl.status).toBe(200);
    expect(((await dl.json()) as { fxpkg_uri: string }).fxpkg_uri).toContain("fxpkg/");
  });

  it("installs into a user library", async () => {
    const r = await req(`/v1/assets/${assetId}/install`, { method: "POST", headers: userHeaders });
    expect(r.status).toBe(200);
    const lib = await req("/v1/me/library", { headers: userHeaders });
    expect(((await lib.json()) as { asset_ids: string[] }).asset_ids).toContain(assetId);
  });

  it("records a payable EXPORT_COMPLETED event and credits the creator", async () => {
    const payload = {
      asset_id: assetId,
      export: {
        gross_cents: 1000,
        duration_ms: 8000,
        contains_user_media: true,
        content_hash: "hash-1",
        day: "2026-05-26",
        applied: [{ assetVersionId: versionId, kind: "filter", clipCount: 1, totalDurationMs: 8000 }],
      },
    };
    const nonce = "nonce-1";
    const signature = sealEvent(JSON.stringify(payload), nonce, "test-secret");
    const r = await req("/v1/events", {
      method: "POST", headers: userHeaders,
      body: JSON.stringify({ events: [{ event_id: "exp-1", type: "EXPORT_COMPLETED", user_id: "u-viewer", session_nonce: nonce, signature, payload }] }),
    });
    const j = (await r.json()) as { results: Array<{ status: string }> };
    expect(j.results[0].status).toBe("payable");

    // duplicate is ignored
    const dup = await req("/v1/events", {
      method: "POST", headers: userHeaders,
      body: JSON.stringify({ events: [{ event_id: "exp-1", type: "EXPORT_COMPLETED", user_id: "u-viewer", session_nonce: nonce, signature, payload }] }),
    });
    expect(((await dup.json()) as { results: Array<{ status: string }> }).results[0].status).toBe("duplicate");
  });
});
