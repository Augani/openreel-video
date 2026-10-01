import type {
  Asset,
  AssetVersion,
  Draft,
  Submission,
  EarningsEntry,
  CreatorBalance,
  Attribution,
} from "@openreel/fxpkg";

export type Bindings = {
  TEMPLATES_BUCKET: R2Bucket;
  SHARES_BUCKET: R2Bucket;
  /** optional: durable marketplace storage; when absent an in-memory store is used */
  ASSETS_BUCKET?: R2Bucket;
  AI: Ai;
  ENVIRONMENT: string;
  /** secret used to verify HMAC-sealed marketplace events (§41.5) */
  EVENT_HMAC_SECRET?: string;
  /** durable storage for desktop/app crash + error reports (POST /crash) */
  CRASHES_BUCKET?: R2Bucket;
  /** bearer token guarding the crash list/read endpoints (GET /crash) */
  CRASH_ADMIN_TOKEN?: string;
};

export interface AssetListFilter {
  kind?: Asset["kind"];
  category?: string;
  creatorId?: string;
  sort?: "trending" | "new" | "installs";
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface Store {
  // assets
  putAsset(a: Asset): Promise<void>;
  getAsset(id: string): Promise<Asset | undefined>;
  getAssetBySlug(creatorId: string, slug: string): Promise<Asset | undefined>;
  listAssets(filter: AssetListFilter): Promise<{ items: Array<Asset & { latest?: AssetVersion }>; total: number }>;
  // versions
  putVersion(v: AssetVersion): Promise<void>;
  getVersion(assetId: string, version: number): Promise<AssetVersion | undefined>;
  listVersions(assetId: string): Promise<AssetVersion[]>;
  latestApproved(assetId: string): Promise<AssetVersion | undefined>;
  // drafts
  putDraft(d: Draft): Promise<void>;
  getDraft(id: string): Promise<Draft | undefined>;
  listDraftsByCreator(creatorId: string): Promise<Draft[]>;
  deleteDraft(id: string): Promise<void>;
  pushSnapshot(draftId: string, graph: unknown): Promise<void>;
  // submissions
  putSubmission(s: Submission): Promise<void>;
  getSubmission(id: string): Promise<Submission | undefined>;
  listSubmissions(state?: string): Promise<Submission[]>;
  // installs
  install(userId: string, assetId: string): Promise<void>;
  isInstalled(userId: string, assetId: string): Promise<boolean>;
  listInstalls(userId: string): Promise<string[]>;
  // money
  addEarning(e: EarningsEntry): Promise<void>;
  listEarnings(creatorId: string): Promise<EarningsEntry[]>;
  getBalance(creatorId: string): Promise<CreatorBalance>;
  setBalance(b: CreatorBalance): Promise<void>;
  // attribution
  addAttributions(a: Attribution[]): Promise<void>;
  // events dedupe
  seenExport(dedupeKey: string): Promise<boolean>;
  markExport(dedupeKey: string): Promise<void>;
}
