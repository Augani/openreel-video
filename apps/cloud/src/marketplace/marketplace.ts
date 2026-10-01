import { Hono } from "hono";
import { listBlueprints, paletteNodes, type AbiVersion, type AssetKind } from "@openreel/fxpkg";
import type { Bindings } from "./types";
import { getStore } from "./store";
import { requireUser, isResponse } from "./auth";
import { rateLimit, DAY } from "./ratelimit";

const app = new Hono<{ Bindings: Bindings }>();

// ── Discovery + consumption (§34.1) ─────────────────────────────────────────
app.get("/assets", async (c) => {
  const q = c.req.query();
  const { items, total } = await getStore(c.env).listAssets({
    kind: q.kind as AssetKind | undefined,
    category: q.category,
    sort: (q.sort as "trending" | "new" | "installs") ?? "trending",
    q: q.q,
    page: q.page ? Number(q.page) : 1,
    pageSize: q.page_size ? Number(q.page_size) : 24,
  });
  return c.json({
    assets: items.map((a) => ({
      id: a.id,
      slug: a.slug,
      kind: a.kind,
      category: a.category,
      currentVersion: a.currentVersion,
      title: a.latest?.manifest.title,
      description: a.latest?.manifest.description,
      tags: a.latest?.manifest.tags,
      author: a.latest?.manifest.author,
    })),
    total,
  });
});

app.get("/assets/:id", async (c) => {
  const store = getStore(c.env);
  const asset = await store.getAsset(c.req.param("id"));
  if (!asset) return c.json({ error: "not_found" }, 404);
  const latest = await store.latestApproved(asset.id);
  const versions = await store.listVersions(asset.id);
  return c.json({ asset, latest, versions: versions.map((v) => ({ version: v.version, reviewState: v.reviewState, abi: v.abi })) });
});

app.get("/assets/:id/versions/:n", async (c) => {
  const v = await getStore(c.env).getVersion(c.req.param("id"), Number(c.req.param("n")));
  if (!v) return c.json({ error: "not_found" }, 404);
  return c.json(v);
});

app.get("/assets/:id/versions/:n/manifest", async (c) => {
  const v = await getStore(c.env).getVersion(c.req.param("id"), Number(c.req.param("n")));
  if (!v) return c.json({ error: "not_found" }, 404);
  return c.json(v.manifest);
});

app.get("/assets/:id/versions/:n/download", async (c) => {
  const v = await getStore(c.env).getVersion(c.req.param("id"), Number(c.req.param("n")));
  if (!v) return c.json({ error: "not_found" }, 404);
  if (v.reviewState !== "published" && v.reviewState !== "approved") return c.json({ error: "not_published" }, 403);
  // Immutable, long-cache URL (§6.4). With R2 bound this streams the artifact;
  // otherwise returns the logical uri for the consumer to resolve.
  const url = `/v1/assets/${v.assetId}/versions/${v.version}/fxpkg`;
  return c.json({ fxpkg_uri: v.fxpkgUri, url, expires_in_s: 3600 });
});

app.get("/assets/:id/versions/:n/fxpkg", async (c) => {
  const v = await getStore(c.env).getVersion(c.req.param("id"), Number(c.req.param("n")));
  if (!v) return c.json({ error: "not_found" }, 404);
  if (c.env.ASSETS_BUCKET) {
    const obj = await c.env.ASSETS_BUCKET.get(`${v.fxpkgUri}.json`);
    if (obj) return new Response(obj.body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable" } });
  }
  return c.json({ error: "artifact_unavailable" }, 404);
});

app.post("/assets/:id/install", rateLimit({ key: "install", limit: 1000, windowMs: DAY }), async (c) => {
  const id = requireUser(c);
  if (isResponse(id)) return id;
  const store = getStore(c.env);
  const asset = await store.getAsset(c.req.param("id") ?? "");
  if (!asset) return c.json({ error: "not_found" }, 404);
  await store.install(id.userId, asset.id);
  return c.json({ installed: true, asset_id: asset.id });
});

app.get("/me/library", async (c) => {
  const id = requireUser(c);
  if (isResponse(id)) return id;
  return c.json({ asset_ids: await getStore(c.env).listInstalls(id.userId) });
});

app.get("/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const { items, total } = await getStore(c.env).listAssets({ q, sort: "trending" });
  return c.json({ query: q, total, assets: items.map((a) => ({ id: a.id, slug: a.slug, kind: a.kind, title: a.latest?.manifest.title })) });
});

app.get("/creators/:handle", async (c) => {
  const handle = c.req.param("handle");
  const { items } = await getStore(c.env).listAssets({});
  const assets = items.filter((a) => a.latest?.manifest.author.handle === handle);
  return c.json({ handle, assets: assets.map((a) => ({ id: a.id, slug: a.slug, kind: a.kind, title: a.latest?.manifest.title })) });
});

// ── Authoring helpers: blueprints + node library (§9A, §12) ─────────────────
app.get("/blueprints", (c) => {
  return c.json({
    blueprints: listBlueprints().map((b) => ({
      id: b.id,
      version: b.version,
      kind: b.kind,
      label: b.label,
      difficulty: b.difficulty,
      controls: b.controls,
    })),
  });
});

app.get("/nodelib", (c) => {
  const abi = (c.req.query("abi") as AbiVersion) ?? "1.2";
  return c.json({
    abi,
    nodes: paletteNodes(abi).map((n) => ({ id: n.id, category: n.category, label: n.label, inputs: n.inputs, outputs: n.outputs, minAbi: n.minAbi })),
  });
});

export default app;
