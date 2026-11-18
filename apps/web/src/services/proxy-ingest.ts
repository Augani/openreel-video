import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import {
  createProxyRef,
  effectiveIngestPreset,
  getMediaEngine,
  isProxyRecordId,
  itemNeedsIngestProxy,
  matchProxyFiles,
  proxyRecordId,
  validateProxy,
  type IngestPreset,
  type MediaItem,
  type MediaOrganizeParams,
  type MediaProxyRef,
} from "@openreel/core";
import { previewProxyCache } from "../stores/preview-proxy-store";
import type { PreviewProxyPreset } from "./preview-proxy-cache";
import { useProjectStore } from "../stores/project-store";
import { deleteMediaBlob, loadMediaRecord, saveMediaBlob } from "./media-storage";
import { toast } from "../stores/notification-store";
import {
  cancelDesktopJob,
  copyMediaToProject,
  desktopIngestAvailable,
  loadDesktopProxy,
  queueDesktopProxies,
  startDesktopIngest,
  useDesktopIngestStore,
} from "./desktop-ingest";

/**
 * Proxy / ingest workflow on the web side: the ingest preset, the background proxy job queue
 * (progress, cancel, resume after reload), proxy persistence in the project's IndexedDB store,
 * Attach Proxies and Toggle Proxies. The pure rules live in @openreel/core (media/proxy-workflow).
 * Every project change is one `media/organize` action; job progress never enters undo history.
 */

const QUALITY_KEY = "openreel.proxyQuality";
const PROXIES_ON_KEY = "openreel.proxiesOn";
const JOBS_KEY = (projectId: string) => `openreel.proxyJobs.${projectId}`;
/** An item imported longer ago than this is a project load, not an import. */
const FRESH_IMPORT_MS = 30_000;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode / blocked storage: the queue just will not resume */
  }
}

const isQuality = (value: unknown): value is PreviewProxyPreset => value === "low" || value === "medium" || value === "high";

export interface AttachReport {
  attached: Array<{ mediaId: string; name: string; file: string }>;
  skipped: Array<{ name: string; reason: string }>;
  unmatchedFiles: string[];
  ambiguous: string[];
}

interface ProxyIngestState {
  /** Size of proxies the queue builds. */
  quality: PreviewProxyPreset;
  /** Per-import choice; null follows the project default. */
  importOverride: IngestPreset | null;
  /** Persisted proxy refs whose bytes were not found (media id -> true). */
  missing: Record<string, true>;
  lastAttach: AttachReport | null;
}

export const useProxyIngestStore = create<ProxyIngestState>(() => {
  const stored = readStorage(QUALITY_KEY);
  return { quality: isQuality(stored) ? stored : "medium", importOverride: null, missing: {}, lastAttach: null };
});

export const setProxyQuality = (quality: PreviewProxyPreset): void => {
  writeStorage(QUALITY_KEY, quality);
  useProxyIngestStore.setState({ quality });
};
export const setImportOverride = (importOverride: IngestPreset | null): void => useProxyIngestStore.setState({ importOverride });

const project = () => useProjectStore.getState().project;

async function organize(params: MediaOrganizeParams): Promise<boolean> {
  const result = await useProjectStore.getState().executeAction({
    type: "media/organize",
    id: uuidv4(),
    timestamp: Date.now(),
    params: params as unknown as Record<string, unknown>,
  });
  return result.success;
}

/** Project default ingest preset: one undo step. */
export const setProjectIngestPreset = (preset: IngestPreset): Promise<boolean> =>
  organize({ label: "Set ingest preset", ingestPreset: preset });

// ---- Toggle Proxies ------------------------------------------------------------------------

export function proxiesOn(): boolean {
  return previewProxyCache.store.getState().proxiesOn;
}
export function setProxiesOn(on: boolean): void {
  previewProxyCache.setProxiesOn(on);
  writeStorage(PROXIES_ON_KEY, on ? "1" : "0");
}
export const toggleProxies = (): boolean => {
  setProxiesOn(!proxiesOn());
  return proxiesOn();
};

// ---- Background proxy jobs -----------------------------------------------------------------

let pendingResume: string[] = [];
let resumeQuality: PreviewProxyPreset = "medium";
let jobsInitialised = "";

function readJobs(projectId: string): { ids: string[]; quality: PreviewProxyPreset } {
  try {
    const parsed = JSON.parse(readStorage(JOBS_KEY(projectId)) ?? "null") as { ids?: unknown; quality?: unknown } | null;
    const ids = Array.isArray(parsed?.ids) ? parsed.ids.filter((id): id is string => typeof id === "string") : [];
    return { ids, quality: isQuality(parsed?.quality) ? parsed.quality : "medium" };
  } catch {
    return { ids: [], quality: "medium" };
  }
}

/** Mirror the live queue (plus jobs not yet resumed) to storage so a reload can continue it. */
function writeJobs(): void {
  const { projectId, entries } = previewProxyCache.store.getState();
  if (!projectId || jobsInitialised !== projectId) return;
  const live = Object.entries(entries).filter(([, e]) => e.status === "queued" || e.status === "encoding").map(([id]) => id);
  const ids = [...new Set([...live, ...pendingResume])];
  writeStorage(JOBS_KEY(projectId), ids.length ? JSON.stringify({ ids, quality: resumeQuality }) : null);
}

export interface QueueResult {
  queued: string[];
  skipped: Array<{ id: string; reason: string }>;
}

/**
 * Queue background proxy builds. `force` rebuilds items that already have one. On desktop, media with a
 * known file on disk goes to the native ffmpeg queue in the main process (project proxy format, Proxies
 * folder); anything else, and the whole web build, uses the in-app encoder below.
 */
export function queueProxies(mediaIds: readonly string[], quality: PreviewProxyPreset = useProxyIngestStore.getState().quality, force = false): QueueResult {
  if (!desktopIngestAvailable()) return queueInApp(mediaIds, quality, force);
  const native = queueDesktopProxies(mediaIds, force);
  if (!native.legacy.length) return { queued: native.queued, skipped: native.skipped };
  const rest = queueInApp(native.legacy, quality, force);
  return { queued: [...native.queued, ...rest.queued], skipped: [...native.skipped, ...rest.skipped] };
}

function queueInApp(mediaIds: readonly string[], quality: PreviewProxyPreset, force: boolean): QueueResult {
  const result: QueueResult = { queued: [], skipped: [] };
  const items = project().mediaLibrary.items;
  for (const id of mediaIds) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) result.skipped.push({ id, reason: "Media not found." });
    else if (item.type !== "video") result.skipped.push({ id, reason: "Only video can be proxied." });
    else if (item.isPlaceholder || item.isPending || (!item.blob && !item.fileHandle)) result.skipped.push({ id, reason: "The full-resolution media is offline. Relink it first." });
    else if (item.subclip) result.skipped.push({ id, reason: "Subclips share their parent's proxy." });
    else if (item.proxy && !force && previewProxyCache.store.getState().entries[id]?.status === "ready") result.skipped.push({ id, reason: "Already has a proxy." });
    else {
      resumeQuality = quality;
      previewProxyCache.request(item, quality);
      result.queued.push(id);
    }
  }
  writeJobs();
  return result;
}

export function cancelProxyJob(mediaId: string): void {
  cancelDesktopJob(mediaId);
  previewProxyCache.remove(mediaId);
  pendingResume = pendingResume.filter((id) => id !== mediaId);
  writeJobs();
}

/** A deleted media item takes its stored proxy bytes with it (its full-resolution blob is deleted at the same time). */
export async function discardProxyBytes(mediaId: string): Promise<void> {
  cancelDesktopJob(mediaId);
  previewProxyCache.remove(mediaId);
  useProxyIngestStore.setState((s) => ({ missing: Object.fromEntries(Object.entries(s.missing).filter(([id]) => id !== mediaId)) as Record<string, true> }));
  await deleteMediaBlob(proxyRecordId(mediaId));
}

/** Drop the proxy link (one undo step). The bytes stay in storage, so Undo brings the proxy back. */
export async function detachProxies(mediaIds: readonly string[]): Promise<boolean> {
  const itemPatches: Record<string, { proxy: null }> = {};
  for (const id of mediaIds) if (project().mediaLibrary.items.find((i) => i.id === id)?.proxy) itemPatches[id] = { proxy: null };
  if (!Object.keys(itemPatches).length) return false;
  return organize({ label: "Remove proxy", itemPatches });
}

// ---- Persisting, attaching, hydrating -------------------------------------------------------

async function persistProxyBytes(projectId: string, mediaId: string, blob: Blob, info: { width: number; height: number; duration: number; frameRate: number; codec: string }): Promise<void> {
  await saveMediaBlob(projectId, proxyRecordId(mediaId), blob, {
    duration: info.duration,
    width: info.width,
    height: info.height,
    frameRate: info.frameRate,
    codec: info.codec,
    sampleRate: 0,
    channels: 0,
    fileSize: blob.size,
  });
}

const finalizing = new Set<string>();
/** Proxies whose bytes could not be stored; not retried on every cache change. */
const finalizeFailed = new WeakSet<Blob>();

/** A generated proxy finished: store its bytes, link it to the item (one undo step), keep it cached. */
async function finalizeGenerated(mediaId: string): Promise<void> {
  const state = previewProxyCache.store.getState();
  const entry = state.entries[mediaId];
  const projectId = state.projectId;
  if (!entry?.blob || !projectId || finalizing.has(mediaId) || finalizeFailed.has(entry.blob)) return;
  finalizing.add(mediaId);
  const blob = entry.blob;
  try {
    const info = {
      width: entry.width ?? 0,
      height: entry.height ?? 0,
      duration: entry.duration ?? entry.source.metadata.duration,
      frameRate: entry.frameRate ?? entry.source.metadata.frameRate,
      codec: entry.codec ?? "h264",
    };
    await persistProxyBytes(projectId, mediaId, blob, info);
    const item = project().mediaLibrary.items.find((i) => i.id === mediaId);
    if (project().id !== projectId || !item || previewProxyCache.store.getState().entries[mediaId]?.blob !== blob) return;
    const ref = createProxyRef({
      storage: "idb",
      path: proxyRecordId(mediaId),
      probe: info,
      fileSize: blob.size,
      source: "generated",
      preset: entry.preset,
    });
    if (await organize({ label: "Create proxy", itemPatches: { [mediaId]: { proxy: ref } } })) previewProxyCache.markPersisted(mediaId, blob);
  } catch (error) {
    finalizeFailed.add(blob);
    console.warn("[proxy-ingest] Could not store the proxy:", error);
    toast.warning("Proxy kept for this session only", "It could not be saved with the project. It will be rebuilt after a reload.");
  } finally {
    finalizing.delete(mediaId);
  }
}

export interface ProxySource {
  mediaId: string;
  blob: Blob;
  name: string;
}

/** Validate and attach existing proxy files/blobs. One undo step for everything attached. */
export async function attachProxyBlobs(sources: readonly ProxySource[]): Promise<AttachReport> {
  const report: AttachReport = { attached: [], skipped: [], unmatchedFiles: [], ambiguous: [] };
  const state = project();
  const patches: Record<string, { proxy: MediaProxyRef }> = {};
  const hydrate: Array<{ item: MediaItem; blob: Blob; width: number; height: number }> = [];
  for (const source of sources) {
    const item = state.mediaLibrary.items.find((candidate) => candidate.id === source.mediaId);
    if (!item || item.type !== "video") {
      report.skipped.push({ name: source.name, reason: "No matching video in the project." });
      continue;
    }
    try {
      const meta = await getMediaEngine().extractMetadata(source.blob);
      if (!meta.hasVideo || !(meta.canDecodeVideo ?? meta.canDecode)) {
        report.skipped.push({ name: source.name, reason: "This browser cannot decode the proxy file." });
        continue;
      }
      const probe = { duration: meta.duration, width: meta.width, height: meta.height, frameRate: meta.frameRate, hasVideo: true };
      const issues = validateProxy(item.metadata, probe);
      if (issues.length) {
        report.skipped.push({ name: source.name, reason: issues.map((issue) => issue.message).join(" ") });
        continue;
      }
      await persistProxyBytes(state.id, item.id, source.blob, { ...probe, codec: meta.codec ?? "h264" });
      patches[item.id] = {
        proxy: createProxyRef({ storage: "idb", path: proxyRecordId(item.id), probe: { ...probe, codec: meta.codec }, fileSize: source.blob.size, source: "attached" }),
      };
      report.attached.push({ mediaId: item.id, name: item.name, file: source.name });
      if (!item.isPlaceholder) hydrate.push({ item, blob: source.blob, width: meta.width, height: meta.height });
    } catch (error) {
      report.skipped.push({ name: source.name, reason: error instanceof Error ? error.message : "Could not read the proxy file." });
    }
  }
  if (Object.keys(patches).length && project().id === state.id) {
    if (await organize({ label: "Attach proxies", itemPatches: patches })) {
      for (const entry of hydrate) {
        const current = project().mediaLibrary.items.find((i) => i.id === entry.item.id);
        if (current) previewProxyCache.hydrate(current, entry.blob, { width: entry.width, height: entry.height });
      }
      useProxyIngestStore.setState((s) => ({ missing: Object.fromEntries(Object.entries(s.missing).filter(([id]) => !(id in patches))) as Record<string, true> }));
    } else {
      report.skipped.push(...report.attached.map((a) => ({ name: a.file, reason: "The project rejected the change." })));
      report.attached = [];
    }
  }
  useProxyIngestStore.setState({ lastAttach: report });
  return report;
}

/** Attach Proxies from picked files, matched to project media by name. */
export async function attachProxyFiles(files: readonly File[]): Promise<AttachReport> {
  const items = project().mediaLibrary.items;
  const match = matchProxyFiles(items, files);
  const report = await attachProxyBlobs(match.matches.map((m) => ({ mediaId: m.mediaId, blob: m.file, name: m.file.name })));
  const named = new Map(items.map((item) => [item.id, item.name]));
  report.unmatchedFiles = match.unmatchedFiles.map((file) => file.name);
  report.ambiguous = match.ambiguousMediaIds.map((id) => named.get(id) ?? id);
  useProxyIngestStore.setState({ lastAttach: report });
  const parts = [`${report.attached.length} attached`];
  if (report.skipped.length) parts.push(`${report.skipped.length} rejected`);
  if (report.unmatchedFiles.length) parts.push(`${report.unmatchedFiles.length} with no matching media`);
  if (report.ambiguous.length) parts.push(`${report.ambiguous.length} ambiguous`);
  const text = parts.join(" · ");
  if (report.attached.length) toast.success("Proxies attached", text);
  else toast.warning("No proxies attached", [text, report.skipped[0]?.reason].filter(Boolean).join(" — "));
  return report;
}

/** Re-register persisted proxies after a load, and flag the ones whose bytes are gone. */
const hydrating = new Set<string>();
function hydratePersisted(): void {
  const { project: current, hasOpenProject } = useProjectStore.getState();
  if (!hasOpenProject) return;
  const entries = previewProxyCache.store.getState().entries;
  for (const item of current.mediaLibrary.items) {
    const ref = item.proxy;
    if (!ref || item.isPlaceholder || entries[item.id] || hydrating.has(item.id) || useProxyIngestStore.getState().missing[item.id]) continue;
    if (ref.storage === "path") {
      // A native proxy on disk. Skip the ones already checked (an "external" proxy has no cache entry).
      if (!desktopIngestAvailable() || useDesktopIngestStore.getState().files[item.id]?.path === ref.path) continue;
      hydrating.add(item.id);
      void loadDesktopProxy(item)
        .then((state) => {
          if (state === "missing") useProxyIngestStore.setState((s) => ({ missing: { ...s.missing, [item.id]: true } }));
        })
        .finally(() => hydrating.delete(item.id));
      continue;
    }
    hydrating.add(item.id);
    void (async () => {
      try {
        // A project file is untrusted: only this app's own proxy records may be read back as a proxy.
        const record = ref.storage === "idb" && isProxyRecordId(ref.path) ? await loadMediaRecord(ref.path) : null;
        const latest = useProjectStore.getState().project;
        const live = latest.id === current.id ? latest.mediaLibrary.items.find((i) => i.id === item.id) : undefined;
        if (!live?.proxy || live.isPlaceholder) return;
        if (record?.blob) previewProxyCache.hydrate(live, record.blob, { width: live.proxy.width, height: live.proxy.height, preset: live.proxy.preset });
        else useProxyIngestStore.setState((s) => ({ missing: { ...s.missing, [item.id]: true } }));
      } catch {
        useProxyIngestStore.setState((s) => ({ missing: { ...s.missing, [item.id]: true } }));
      } finally {
        hydrating.delete(item.id);
      }
    })();
  }
}

// ---- Wiring: ingest on import, resume after reload, finalise jobs ----------------------------

let seen = new Set<string>();
let seenProject = "";

function onProjectChange(): void {
  const { project: current, hasOpenProject } = useProjectStore.getState();
  if (!hasOpenProject) return;
  const items = current.mediaLibrary.items;
  if (seenProject !== current.id) {
    seenProject = current.id;
    seen = new Set(items.map((item) => item.id));
    useProxyIngestStore.setState({ missing: {}, lastAttach: null });
    const stored = readJobs(current.id);
    pendingResume = stored.ids;
    resumeQuality = stored.quality;
    jobsInitialised = current.id;
  } else {
    const preset = effectiveIngestPreset(current, useProxyIngestStore.getState().importOverride);
    const fresh = items.filter((item) => !seen.has(item.id));
    for (const item of items) seen.add(item.id);
    if (preset === "copy" && desktopIngestAvailable()) {
      const copyIds = fresh
        .filter((item) => item.sourceFile?.path && !item.copiedFrom && !item.isPlaceholder && Date.now() - (item.importedAt ?? 0) < FRESH_IMPORT_MS)
        .map((item) => item.id);
      if (copyIds.length) {
        void copyMediaToProject(copyIds).then(() => {
          if (!project().mediaLibrary.desktopIngest?.proxiesWithCopy) return;
          const ids = copyIds.filter((id) => {
            const item = project().mediaLibrary.items.find((candidate) => candidate.id === id);
            return item && itemNeedsIngestProxy(item);
          });
          if (ids.length) queueProxies(ids);
        });
      }
    }
    if (preset === "proxies") {
      const ids = fresh
        .filter((item) => itemNeedsIngestProxy(item) && !item.isPlaceholder && Date.now() - (item.importedAt ?? 0) < FRESH_IMPORT_MS)
        .map((item) => item.id);
      if (ids.length) queueProxies(ids);
    }
  }
  // Jobs that were running when the page closed continue once their media is back.
  if (pendingResume.length) {
    const still: string[] = [];
    const resume: string[] = [];
    for (const id of pendingResume) {
      const item = items.find((candidate) => candidate.id === id);
      if (!item || item.proxy) continue;
      if (item.isPlaceholder || (!item.blob && !item.fileHandle)) still.push(id);
      else resume.push(id);
    }
    pendingResume = still;
    if (resume.length) queueProxies(resume, resumeQuality);
  }
  // An undone proxy link releases its cached bytes; a redone one is loaded again below.
  const cache = previewProxyCache.store.getState();
  for (const [id, entry] of Object.entries(cache.entries)) {
    if (entry.persisted && !items.find((item) => item.id === id)?.proxy) previewProxyCache.remove(id);
  }
  hydratePersisted();
  writeJobs();
}

function onCacheChange(): void {
  const { entries } = previewProxyCache.store.getState();
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.status === "ready" && !entry.persisted && entry.blob) void finalizeGenerated(id);
  }
  writeJobs();
}

let started = false;
/** Install the ingest wiring once (idempotent). */
export function startProxyIngest(): void {
  if (started) return;
  started = true;
  const stored = readStorage(PROXIES_ON_KEY);
  if (stored === "0") previewProxyCache.setProxiesOn(false);
  onProjectChange();
  useProjectStore.subscribe((state, previous) => {
    if (state.project !== previous.project || state.hasOpenProject !== previous.hasOpenProject) onProjectChange();
  });
  previewProxyCache.store.subscribe(onCacheChange);
  startDesktopIngest();
  // A native proxy that turned up on disk again (relinked, or its folder came back) is no longer missing.
  useDesktopIngestStore.subscribe((state) => {
    const { missing } = useProxyIngestStore.getState();
    const found = Object.keys(missing).filter((id) => state.files[id]?.exists === true);
    if (found.length) {
      useProxyIngestStore.setState((s) => ({ missing: Object.fromEntries(Object.entries(s.missing).filter(([id]) => !found.includes(id))) as Record<string, true> }));
    }
  });
}
