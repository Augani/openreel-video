import type {
  Asset,
  AssetVersion,
  Draft,
  Submission,
  EarningsEntry,
  CreatorBalance,
  Attribution,
} from "@openreel/fxpkg";
import type { AssetListFilter, Bindings, Store } from "./types";

function sortAssets(items: Array<Asset & { latest?: AssetVersion }>, sort: AssetListFilter["sort"]): void {
  if (sort === "new") {
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  // trending/installs ranking is computed by the search-indexer in prod (§36.2);
  // default order is recency here.
}

function matchesFilter(asset: Asset, latest: AssetVersion | undefined, f: AssetListFilter): boolean {
  if (f.kind && asset.kind !== f.kind) return false;
  if (f.category && asset.category !== f.category) return false;
  if (f.creatorId && asset.creatorId !== f.creatorId) return false;
  if (f.q) {
    const hay = `${asset.slug} ${latest?.manifest.title ?? ""} ${latest?.manifest.description ?? ""} ${(latest?.manifest.tags ?? []).join(" ")}`.toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  return true;
}

/** In-memory store: default when no durable binding is configured. Persists per isolate. */
export class InMemoryStore implements Store {
  private assets = new Map<string, Asset>();
  private versions = new Map<string, AssetVersion[]>();
  private drafts = new Map<string, Draft>();
  private snapshots = new Map<string, unknown[]>();
  private submissions = new Map<string, Submission>();
  private installs = new Map<string, Set<string>>();
  private earnings = new Map<string, EarningsEntry[]>();
  private balances = new Map<string, CreatorBalance>();
  private attributions: Attribution[] = [];
  private exportsSeen = new Set<string>();

  async putAsset(a: Asset) { this.assets.set(a.id, a); }
  async getAsset(id: string) { return this.assets.get(id); }
  async getAssetBySlug(creatorId: string, slug: string) {
    return [...this.assets.values()].find((a) => a.creatorId === creatorId && a.slug === slug);
  }
  async listAssets(filter: AssetListFilter) {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 24;
    const all: Array<Asset & { latest?: AssetVersion }> = [];
    for (const asset of this.assets.values()) {
      const latest = await this.latestApproved(asset.id);
      if (!latest && filter.sort !== undefined) continue; // only published in discovery
      if (matchesFilter(asset, latest, filter)) all.push({ ...asset, latest });
    }
    sortAssets(all, filter.sort);
    const start = (page - 1) * pageSize;
    return { items: all.slice(start, start + pageSize), total: all.length };
  }

  async putVersion(v: AssetVersion) {
    const list = this.versions.get(v.assetId) ?? [];
    const idx = list.findIndex((x) => x.version === v.version);
    if (idx >= 0) list[idx] = v; else list.push(v);
    this.versions.set(v.assetId, list);
  }
  async getVersion(assetId: string, version: number) {
    return (this.versions.get(assetId) ?? []).find((v) => v.version === version);
  }
  async listVersions(assetId: string) {
    return [...(this.versions.get(assetId) ?? [])].sort((a, b) => b.version - a.version);
  }
  async latestApproved(assetId: string) {
    return (this.versions.get(assetId) ?? [])
      .filter((v) => v.reviewState === "published" || v.reviewState === "approved")
      .sort((a, b) => b.version - a.version)[0];
  }

  async putDraft(d: Draft) { this.drafts.set(d.id, d); }
  async getDraft(id: string) { return this.drafts.get(id); }
  async listDraftsByCreator(creatorId: string) {
    return [...this.drafts.values()].filter((d) => d.creatorId === creatorId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async deleteDraft(id: string) { this.drafts.delete(id); }
  async pushSnapshot(draftId: string, graph: unknown) {
    const list = this.snapshots.get(draftId) ?? [];
    list.unshift(graph);
    this.snapshots.set(draftId, list.slice(0, 50)); // last 50 (§14.6)
  }

  async putSubmission(s: Submission) { this.submissions.set(s.id, s); }
  async getSubmission(id: string) { return this.submissions.get(id); }
  async listSubmissions(state?: string) {
    const all = [...this.submissions.values()];
    return state ? all.filter((s) => s.state === state) : all;
  }

  async install(userId: string, assetId: string) {
    const set = this.installs.get(userId) ?? new Set();
    set.add(assetId);
    this.installs.set(userId, set);
  }
  async isInstalled(userId: string, assetId: string) { return this.installs.get(userId)?.has(assetId) ?? false; }
  async listInstalls(userId: string) { return [...(this.installs.get(userId) ?? [])]; }

  async addEarning(e: EarningsEntry) {
    const list = this.earnings.get(e.creatorId) ?? [];
    list.push(e);
    this.earnings.set(e.creatorId, list);
  }
  async listEarnings(creatorId: string) { return [...(this.earnings.get(creatorId) ?? [])]; }
  async getBalance(creatorId: string) {
    return this.balances.get(creatorId) ?? { creatorId, pendingCents: 0, payableCents: 0, paidCents: 0, currency: "USD" };
  }
  async setBalance(b: CreatorBalance) { this.balances.set(b.creatorId, b); }

  async addAttributions(a: Attribution[]) { this.attributions.push(...a); }

  async seenExport(key: string) { return this.exportsSeen.has(key); }
  async markExport(key: string) { this.exportsSeen.add(key); }
}

/** R2-backed store: durable across isolates. Keys are JSON objects; a maintained
 *  index doc supports listing/search at v1 scale (Meilisearch takes over per §36). */
export class R2Store implements Store {
  constructor(private bucket: R2Bucket) {}

  private async readJson<T>(key: string): Promise<T | undefined> {
    const obj = await this.bucket.get(key);
    if (!obj) return undefined;
    return (await obj.json()) as T;
  }
  private async writeJson(key: string, value: unknown): Promise<void> {
    await this.bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json" } });
  }

  async putAsset(a: Asset) {
    await this.writeJson(`assets/${a.id}.json`, a);
    const idx = (await this.readJson<string[]>("index/assets.json")) ?? [];
    if (!idx.includes(a.id)) { idx.push(a.id); await this.writeJson("index/assets.json", idx); }
    await this.writeJson(`index/slug/${a.creatorId}/${a.slug}.json`, { id: a.id });
  }
  async getAsset(id: string) { return this.readJson<Asset>(`assets/${id}.json`); }
  async getAssetBySlug(creatorId: string, slug: string) {
    const ref = await this.readJson<{ id: string }>(`index/slug/${creatorId}/${slug}.json`);
    return ref ? this.getAsset(ref.id) : undefined;
  }
  async listAssets(filter: AssetListFilter) {
    const ids = (await this.readJson<string[]>("index/assets.json")) ?? [];
    const items: Array<Asset & { latest?: AssetVersion }> = [];
    for (const id of ids) {
      const asset = await this.getAsset(id);
      if (!asset) continue;
      const latest = await this.latestApproved(id);
      if (!latest && filter.sort !== undefined) continue;
      if (matchesFilter(asset, latest, filter)) items.push({ ...asset, latest });
    }
    sortAssets(items, filter.sort);
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 24;
    const start = (page - 1) * pageSize;
    return { items: items.slice(start, start + pageSize), total: items.length };
  }

  async putVersion(v: AssetVersion) {
    await this.writeJson(`versions/${v.assetId}/${v.version}.json`, v);
    const list = (await this.readJson<number[]>(`index/versions/${v.assetId}.json`)) ?? [];
    if (!list.includes(v.version)) { list.push(v.version); await this.writeJson(`index/versions/${v.assetId}.json`, list); }
  }
  async getVersion(assetId: string, version: number) { return this.readJson<AssetVersion>(`versions/${assetId}/${version}.json`); }
  async listVersions(assetId: string) {
    const nums = (await this.readJson<number[]>(`index/versions/${assetId}.json`)) ?? [];
    const out: AssetVersion[] = [];
    for (const n of nums.sort((a, b) => b - a)) { const v = await this.getVersion(assetId, n); if (v) out.push(v); }
    return out;
  }
  async latestApproved(assetId: string) {
    return (await this.listVersions(assetId)).find((v) => v.reviewState === "published" || v.reviewState === "approved");
  }

  async putDraft(d: Draft) {
    await this.writeJson(`drafts/${d.id}.json`, d);
    const idx = (await this.readJson<string[]>(`index/drafts/${d.creatorId}.json`)) ?? [];
    if (!idx.includes(d.id)) { idx.push(d.id); await this.writeJson(`index/drafts/${d.creatorId}.json`, idx); }
  }
  async getDraft(id: string) { return this.readJson<Draft>(`drafts/${id}.json`); }
  async listDraftsByCreator(creatorId: string) {
    const ids = (await this.readJson<string[]>(`index/drafts/${creatorId}.json`)) ?? [];
    const out: Draft[] = [];
    for (const id of ids) { const d = await this.getDraft(id); if (d) out.push(d); }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async deleteDraft(id: string) { await this.bucket.delete(`drafts/${id}.json`); }
  async pushSnapshot(draftId: string, graph: unknown) {
    const key = `snapshots/${draftId}.json`;
    const list = (await this.readJson<unknown[]>(key)) ?? [];
    list.unshift(graph);
    await this.writeJson(key, list.slice(0, 50));
  }

  async putSubmission(s: Submission) {
    await this.writeJson(`submissions/${s.id}.json`, s);
    const idx = (await this.readJson<string[]>("index/submissions.json")) ?? [];
    if (!idx.includes(s.id)) { idx.push(s.id); await this.writeJson("index/submissions.json", idx); }
  }
  async getSubmission(id: string) { return this.readJson<Submission>(`submissions/${id}.json`); }
  async listSubmissions(state?: string) {
    const ids = (await this.readJson<string[]>("index/submissions.json")) ?? [];
    const out: Submission[] = [];
    for (const id of ids) { const s = await this.getSubmission(id); if (s && (!state || s.state === state)) out.push(s); }
    return out;
  }

  async install(userId: string, assetId: string) {
    const list = (await this.readJson<string[]>(`installs/${userId}.json`)) ?? [];
    if (!list.includes(assetId)) { list.push(assetId); await this.writeJson(`installs/${userId}.json`, list); }
  }
  async isInstalled(userId: string, assetId: string) {
    const list = (await this.readJson<string[]>(`installs/${userId}.json`)) ?? [];
    return list.includes(assetId);
  }
  async listInstalls(userId: string) { return (await this.readJson<string[]>(`installs/${userId}.json`)) ?? []; }

  async addEarning(e: EarningsEntry) {
    const key = `earnings/${e.creatorId}.json`;
    const list = (await this.readJson<EarningsEntry[]>(key)) ?? [];
    list.push(e);
    await this.writeJson(key, list);
  }
  async listEarnings(creatorId: string) { return (await this.readJson<EarningsEntry[]>(`earnings/${creatorId}.json`)) ?? []; }
  async getBalance(creatorId: string) {
    return (await this.readJson<CreatorBalance>(`balances/${creatorId}.json`)) ?? { creatorId, pendingCents: 0, payableCents: 0, paidCents: 0, currency: "USD" };
  }
  async setBalance(b: CreatorBalance) { await this.writeJson(`balances/${b.creatorId}.json`, b); }

  async addAttributions(a: Attribution[]) {
    if (!a.length) return;
    const key = `attributions/${a[0].exportId}.json`;
    await this.writeJson(key, a);
  }

  async seenExport(key: string) { return (await this.bucket.head(`exports-seen/${key}`)) !== null; }
  async markExport(key: string) { await this.bucket.put(`exports-seen/${key}`, "1"); }
}

let memo: InMemoryStore | undefined;

export function getStore(env: Bindings): Store {
  if (env.ASSETS_BUCKET) return new R2Store(env.ASSETS_BUCKET);
  if (!memo) memo = new InMemoryStore();
  return memo;
}
