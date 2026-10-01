import { Hono } from "hono";
import {
  validateGraph,
  compileFilter,
  compileTemplate,
  canTransition,
  type Graph,
  type AssetKind,
  type Draft,
  type Asset,
  type AssetVersion,
  type Submission,
  type SubmissionState,
  type Manifest,
  type TemplateSource,
} from "@openreel/fxpkg";
import type { Bindings } from "./types";
import { getStore } from "./store";
import { requireCreator, isResponse } from "./auth";
import { runAutoChecks, buildArtifact } from "./autochecks";
import { rateLimit, DAY, SECOND } from "./ratelimit";

const app = new Hono<{ Bindings: Bindings }>();
const now = () => new Date().toISOString();
const slugify = (s: string) => s.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "untitled";

// ── Drafts (§34.2) ─────────────────────────────────────────────────────────
app.post("/drafts", rateLimit({ key: "authoring", limit: 100, windowMs: SECOND }), async (c) => {
  const id = requireCreator(c);
  if (isResponse(id)) return id;
  const body = await c.req.json<{ kind: AssetKind; title?: string; graph?: unknown; manifest_draft?: unknown }>();
  if (!["template", "filter", "effect"].includes(body.kind)) return c.json({ error: "invalid_kind" }, 400);
  const draft: Draft = {
    id: crypto.randomUUID(),
    creatorId: id.creatorId,
    kind: body.kind,
    title: body.title ?? "Untitled",
    graph: body.graph ?? { id: "draft", kind: body.kind, abi: "1.0", nodelibVersion: "1.0.0", nodes: [], edges: [], params: [] },
    manifestDraft: body.manifest_draft ?? {},
    updatedAt: now(),
    createdAt: now(),
  };
  await getStore(c.env).putDraft(draft);
  return c.json(draft, 201);
});

app.get("/drafts", async (c) => {
  const id = requireCreator(c);
  if (isResponse(id)) return id;
  return c.json({ drafts: await getStore(c.env).listDraftsByCreator(id.creatorId) });
});

app.get("/drafts/:id", async (c) => {
  const id = requireCreator(c);
  if (isResponse(id)) return id;
  const draft = await getStore(c.env).getDraft(c.req.param("id"));
  if (!draft || draft.creatorId !== id.creatorId) return c.json({ error: "not_found" }, 404);
  return c.json(draft);
});

app.put("/drafts/:id", rateLimit({ key: "authoring", limit: 100, windowMs: SECOND }), async (c) => {
  const id = requireCreator(c);
  if (isResponse(id)) return id;
  const store = getStore(c.env);
  const draft = await store.getDraft(c.req.param("id") ?? "");
  if (!draft || draft.creatorId !== id.creatorId) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<{ graph?: unknown; manifest_draft?: unknown; title?: string }>();
  if (body.graph !== undefined) {
    draft.graph = body.graph;
    await store.pushSnapshot(draft.id, body.graph);
  }
  if (body.manifest_draft !== undefined) draft.manifestDraft = body.manifest_draft;
  if (body.title !== undefined) draft.title = body.title;
  draft.updatedAt = now();
  await store.putDraft(draft);
  return c.json(draft);
});

// Client-side pre-flight (§37.2): compile + report without submitting.
app.post("/drafts/:id/validate", async (c) => {
  const id = requireCreator(c);
  if (isResponse(id)) return id;
  const draft = await getStore(c.env).getDraft(c.req.param("id"));
  if (!draft || draft.creatorId !== id.creatorId) return c.json({ error: "not_found" }, 404);
  const graph = draft.graph as Graph;
  if (draft.kind === "template") {
    const tpl = (draft.manifestDraft as { template?: TemplateSource })?.template;
    return c.json(tpl ? compileTemplate(tpl) : { ok: false, errors: [{ code: "no_template", message: "no template source" }] });
  }
  const validation = validateGraph(graph);
  const compile = draft.kind === "filter" && validation.ok ? compileFilter(graph) : undefined;
  return c.json({ validation, compile });
});

// Submit for review (§37.1, §38).
app.post("/drafts/:id/submit", rateLimit({ key: "submission", limit: 10, windowMs: DAY }), async (c) => {
  const id = requireCreator(c);
  if (isResponse(id)) return id;
  const store = getStore(c.env);
  const draft = await store.getDraft(c.req.param("id") ?? "");
  if (!draft || draft.creatorId !== id.creatorId) return c.json({ error: "not_found" }, 404);

  const graph = draft.graph as Graph;
  const md = draft.manifestDraft as Partial<Manifest> & { template?: TemplateSource };
  const checks = runAutoChecks(graph, draft.kind, md.template);

  const submissionId = crypto.randomUUID();
  if (!checks.ok) {
    const submission: Submission = {
      id: submissionId,
      draftId: draft.id,
      creatorId: id.creatorId,
      state: "creator_feedback",
      fxpkgUri: "",
      validatorLog: checks,
      createdAt: now(),
      updatedAt: now(),
    };
    await store.putSubmission(submission);
    return c.json({ submission, checks }, 422);
  }

  // resolve / create asset + next version
  const slug = slugify(draft.title ?? "untitled");
  let asset = await store.getAssetBySlug(id.creatorId, slug);
  if (!asset) {
    asset = { id: crypto.randomUUID(), creatorId: id.creatorId, slug, kind: draft.kind, category: md.category, createdAt: now() };
    await store.putAsset(asset);
  }
  const versions = await store.listVersions(asset.id);
  const versionNum = (versions[0]?.version ?? 0) + 1;

  const build = buildArtifact(graph, {
    schema_version: "1.0.0",
    kind: draft.kind,
    id: `${id.handle ?? id.creatorId}/${slug}`,
    version: `${versionNum}.0.0`,
    abi: graph.abi ?? "1.0",
    title: md.title ?? draft.title ?? "Untitled",
    description: md.description ?? "",
    category: md.category,
    tags: md.tags ?? [],
    author: { handle: id.handle ?? id.creatorId, creator_id: id.creatorId },
    params: graph.params ?? [],
    license: md.license ?? "MIT",
    authoring: graph.authoring
      ? { mode: graph.authoring.mode, blueprint_id: graph.authoring.blueprintId, blueprint_version: graph.authoring.blueprintVersion }
      : undefined,
  });
  if (!build.ok || !build.manifest) return c.json({ error: "build_failed", detail: build.errors }, 422);

  const fxpkgUri = `fxpkg/${asset.id}/${versionNum}/asset.fxpkg`;
  if (c.env.ASSETS_BUCKET && build.files) {
    await c.env.ASSETS_BUCKET.put(`${fxpkgUri}.json`, JSON.stringify(build.files), { httpMetadata: { contentType: "application/json" } });
  }

  const version: AssetVersion = {
    id: crypto.randomUUID(),
    assetId: asset.id,
    version: versionNum,
    abi: graph.abi ?? "1.0",
    manifest: build.manifest,
    fxpkgUri,
    reviewState: "submitted",
    submittedAt: now(),
  };
  await store.putVersion(version);

  const submission: Submission = {
    id: submissionId,
    draftId: draft.id,
    assetVersionId: version.id,
    creatorId: id.creatorId,
    state: "human_review",
    fxpkgUri,
    validatorLog: checks,
    createdAt: now(),
    updatedAt: now(),
  };
  await store.putSubmission(submission);
  return c.json({ submission, asset, version, checks }, 201);
});

// ── Creator's published assets (§34.2) ──────────────────────────────────────
app.get("/me/assets", async (c) => {
  const id = requireCreator(c);
  if (isResponse(id)) return id;
  const { items } = await getStore(c.env).listAssets({ creatorId: id.creatorId });
  return c.json({ assets: items });
});

app.post("/me/assets/:id/rollback", async (c) => {
  const id = requireCreator(c);
  if (isResponse(id)) return id;
  const store = getStore(c.env);
  const asset = await store.getAsset(c.req.param("id"));
  if (!asset || asset.creatorId !== id.creatorId) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<{ version: number }>();
  const target = await store.getVersion(asset.id, body.version);
  if (!target || (target.reviewState !== "approved" && target.reviewState !== "published")) {
    return c.json({ error: "version_not_approved" }, 400);
  }
  asset.currentVersion = body.version;
  await store.putAsset(asset);
  return c.json({ asset });
});

// ── Review tooling (§39) ────────────────────────────────────────────────────
app.get("/submissions", async (c) => {
  const id = requireCreator(c);
  if (isResponse(id)) return id;
  const state = c.req.query("state");
  return c.json({ submissions: await getStore(c.env).listSubmissions(state) });
});

app.post("/submissions/:id/review", async (c) => {
  const id = requireCreator(c);
  if (isResponse(id)) return id;
  const store = getStore(c.env);
  const submission = await store.getSubmission(c.req.param("id"));
  if (!submission) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<{ decision: "approve" | "reject" | "changes"; notes?: string }>();
  const target: SubmissionState = body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : "changes_requested";
  if (!canTransition(submission.state, target)) {
    return c.json({ error: "invalid_transition", from: submission.state, to: target }, 409);
  }
  submission.state = target;
  submission.reviewerNotes = body.notes;
  submission.reviewerId = id.creatorId;
  submission.updatedAt = now();
  await store.putSubmission(submission);

  if (target === "approved" && submission.assetVersionId) {
    const asset = await findAssetForVersion(store, submission.assetVersionId);
    if (asset) {
      const versions = await store.listVersions(asset.id);
      const v = versions.find((x) => x.id === submission.assetVersionId);
      if (v) {
        v.reviewState = "published";
        v.approvedAt = now();
        await store.putVersion(v);
        asset.currentVersion = v.version;
        await store.putAsset(asset);
        submission.state = "published";
        await store.putSubmission(submission);
      }
    }
  }
  return c.json({ submission });
});

async function findAssetForVersion(store: ReturnType<typeof getStore>, versionId: string): Promise<Asset | undefined> {
  const { items } = await store.listAssets({});
  for (const asset of items) {
    const vs = await store.listVersions(asset.id);
    if (vs.some((v) => v.id === versionId)) return asset;
  }
  return undefined;
}

export default app;
