import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import {
  createProxyRef,
  getMediaEngine,
  isIntermediateProxyCodec,
  compileProxyPattern,
  matchProxiesByPattern,
  matchRelinkCandidates,
  relinkTargetFor,
  resolveBatchProfile,
  resolveDesktopChecksum,
  validateProxy,
  type DesktopIngestConfig,
  type DesktopProxyProfile,
  type MediaItem,
  type MediaOrganizeParams,
  type RelinkCandidate,
  type RelinkResult,
} from "@openreel/core";
import type { OpenReelIngestBridge, OpenReelIngestProject, OpenReelProxyJob } from "../types/global";
import { previewProxyCache } from "../stores/preview-proxy-store";
import { useProjectStore } from "../stores/project-store";
import { toast } from "../stores/notification-store";
import { rememberNativePath } from "./native-decode";
import { projectManager } from "./project-manager";

/**
 * Desktop (Electron) side of ingest: native-ffmpeg proxies built by the main process's background queue,
 * copy-to-project with checksum verification, and relinking offline media and proxies by folder search.
 * The web build never reaches any of this (everything is gated on `desktopIngestAvailable()`); web keeps
 * its WebCodecs / ffmpeg.wasm proxy path in proxy-ingest.ts. Every project change is one `media/organize`
 * action; job progress never enters undo history.
 */

export function desktopIngestAvailable(): boolean {
  return typeof window !== "undefined" && window.openreel?.platform === "desktop" && Boolean(window.openreel.ingest);
}
const bridge = (): OpenReelIngestBridge | null => (desktopIngestAvailable() ? (window.openreel!.ingest as OpenReelIngestBridge) : null);

export { nativePathForFile } from "./native-path";

export interface DesktopFileState {
  /** The proxy file exists on disk. */
  exists: boolean;
  /** The renderer can decode what it would be given for preview. */
  previewable: boolean;
  /** Path the state was computed for (a different path invalidates it). */
  path: string;
}

export interface DesktopRelinkReport {
  kind: "full" | "proxy";
  folder: string;
  scanned: number;
  truncated: boolean;
  linked: Array<{ mediaId: string; name: string; path: string }>;
  ambiguous: Array<{ name: string; candidates: string[] }>;
  notFound: string[];
  failed: Array<{ name: string; reason: string }>;
  /** Proxy attach: files with the right name but the wrong duration or frame rate (never attached). */
  mismatched: Array<{ name: string; file: string; reasons: string[] }>;
  /** The name pattern used, when the user gave one. */
  pattern?: string;
}

export interface DesktopCopyReport {
  copied: Array<{ mediaId: string; name: string; path: string; sha256: string; algorithm: string; checksum: string }>;
  skipped: Array<{ name: string; reason: string }>;
}

interface DesktopIngestState {
  /** Native proxy jobs by media id (queued, running, failed). Finished jobs are linked and dropped. */
  jobs: Record<string, OpenReelProxyJob>;
  /** Background copy jobs by media id (queued, running, failed). A verified copy is linked into the project and dropped. */
  copyJobs: Record<string, OpenReelProxyJob>;
  files: Record<string, DesktopFileState>;
  /** Copy-to-project progress by media id. */
  copying: Record<string, number>;
  lastRelink: DesktopRelinkReport | null;
  lastCopy: DesktopCopyReport | null;
  /** Folders the project's proxies and media go to (resolved by the main process). */
  folders: { proxyDir: string; mediaDir: string; projectSaved: boolean } | null;
}

export const useDesktopIngestStore = create<DesktopIngestState>(() => ({
  jobs: {},
  copyJobs: {},
  files: {},
  copying: {},
  lastRelink: null,
  lastCopy: null,
  folders: null,
}));
const patchState = (partial: Partial<DesktopIngestState> | ((s: DesktopIngestState) => Partial<DesktopIngestState>)): void => useDesktopIngestStore.setState(partial as never);

const project = () => useProjectStore.getState().project;
const fileBaseName = (path: string): string => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
const parentFolderName = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "";
};

async function organize(params: MediaOrganizeParams): Promise<boolean> {
  const result = await useProjectStore.getState().executeAction({
    type: "media/organize",
    id: uuidv4(),
    timestamp: Date.now(),
    params: params as unknown as Record<string, unknown>,
  });
  return result.success;
}

// ---- Project settings ------------------------------------------------------------------------

export function currentProjectPath(): string | null {
  const handle = projectManager.getCurrentFileHandle() as { kind?: string; path?: string } | null;
  return handle?.kind === "native" && handle.path ? handle.path : null;
}

function ingestProject(): OpenReelIngestProject {
  const current = project();
  return { projectId: current.id, projectPath: currentProjectPath(), config: current.mediaLibrary.desktopIngest ?? null };
}

export async function refreshFolders(): Promise<void> {
  const api = bridge();
  if (!api) return;
  try {
    const folders = await api.resolveFolders(ingestProject());
    patchState({ folders: { proxyDir: folders.proxyDir, mediaDir: folders.mediaDir, projectSaved: folders.projectSaved } });
  } catch {
    patchState({ folders: null });
  }
}

/** One undo step: replace the project's desktop ingest settings with `{ ...current, ...patch }`. */
export async function updateDesktopIngestConfig(patch: Partial<DesktopIngestConfig>, label = "Change ingest settings"): Promise<boolean> {
  const next: Record<string, unknown> = { ...project().mediaLibrary.desktopIngest, ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  const ok = await organize({ label, desktopIngest: next as DesktopIngestConfig });
  if (ok) {
    if (patch.concurrency) void bridge()?.setProxyConcurrency(patch.concurrency);
    void refreshFolders();
  }
  return ok;
}
/** Save a proxy profile with the project; `presetId` remembers which preset it was taken from. */
export const setDesktopProxyProfile = (profile: DesktopProxyProfile, presetId?: string): Promise<boolean> =>
  updateDesktopIngestConfig({ proxyProfile: profile, proxyPresetId: presetId }, "Set proxy format");

/** System folder picker for a preset's custom destination; null when cancelled. */
export async function pickPresetFolder(): Promise<string | null> {
  return (await bridge()?.pickFolder({ title: "Choose where these proxies are written" })) ?? null;
}

/** Choose the Proxies (or Media) folder with the system picker. */
export async function chooseIngestFolder(kind: "proxy" | "media"): Promise<boolean> {
  const api = bridge();
  if (!api) return false;
  const picked = await api.pickFolder({ title: kind === "proxy" ? "Choose the Proxies folder" : "Choose the Media folder" });
  if (!picked) return false;
  return updateDesktopIngestConfig(kind === "proxy" ? { proxyFolder: picked } : { mediaFolder: picked }, kind === "proxy" ? "Set proxies folder" : "Set media folder");
}

export function revealIngestFolder(kind: "proxy" | "media"): void {
  const folders = useDesktopIngestStore.getState().folders;
  const dir = folders ? (kind === "proxy" ? folders.proxyDir : folders.mediaDir) : null;
  if (dir) void window.openreel?.fs.revealInFolder(dir);
}

// ---- Decode capability ------------------------------------------------------------------------

let proresDecodable: Promise<boolean> | null = null;
/** Chromium cannot decode ProRes (no platform decoder); asked once per session. */
export function rendererDecodesProres(): Promise<boolean> {
  proresDecodable ??= (async () => {
    try {
      if (typeof VideoDecoder === "undefined") return false;
      for (const codec of ["apcn", "apco", "apch"]) {
        const support = await VideoDecoder.isConfigSupported({ codec, codedWidth: 1920, codedHeight: 1080 });
        if (support.supported) return true;
      }
      return false;
    } catch {
      return false;
    }
  })();
  return proresDecodable;
}

// ---- Proxy jobs ----------------------------------------------------------------------------------

export interface DesktopQueueResult {
  queued: string[];
  skipped: Array<{ id: string; reason: string }>;
}

/** Items the native queue can build a proxy for: video with a known file on disk. */
export function nativeProxySource(item: MediaItem): string | null {
  return item.type === "video" && !item.isPlaceholder && !item.isPending && !item.subclip && item.sourceFile?.path ? item.sourceFile.path : null;
}

/**
 * Queue native proxy builds for the given media. Items with no known path on disk (recordings,
 * generated media) are reported back as `legacy` so the caller can use the in-app encoder instead.
 */
export function queueDesktopProxies(mediaIds: readonly string[], force = false, batchProfile?: DesktopProxyProfile | null): DesktopQueueResult & { legacy: string[] } {
  const result: DesktopQueueResult & { legacy: string[] } = { queued: [], skipped: [], legacy: [] };
  const items = project().mediaLibrary.items;
  // One batch can use a preset other than the project's (Create Proxies > this batch only).
  const profile = resolveBatchProfile(project(), batchProfile);
  const batch: Array<{ mediaId: string; name: string; srcPath: string; profile: DesktopProxyProfile }> = [];
  for (const id of mediaIds) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) result.skipped.push({ id, reason: "Media not found." });
    else if (item.type !== "video") result.skipped.push({ id, reason: "Only video can be proxied." });
    else if (item.isPlaceholder || item.isPending) result.skipped.push({ id, reason: "The full-resolution media is offline. Relink it first." });
    else if (item.subclip) result.skipped.push({ id, reason: "Subclips share their parent's proxy." });
    else if (item.proxy && !force && useDesktopIngestStore.getState().files[id]?.exists) result.skipped.push({ id, reason: "Already has a proxy." });
    else if (useDesktopIngestStore.getState().jobs[id] && !force) result.skipped.push({ id, reason: "Already queued." });
    else {
      const srcPath = nativeProxySource(item);
      if (!srcPath) result.legacy.push(id);
      else {
        batch.push({ mediaId: id, name: item.name, srcPath, profile });
        result.queued.push(id);
      }
    }
  }
  if (batch.length) {
    // Visible at once (panel, and the auto-4K preview proxy hook that must not start a second build).
    const projectId = project().id;
    patchState((s) => ({
      jobs: {
        ...s.jobs,
        ...Object.fromEntries(
          batch.map((entry) => [
            entry.mediaId,
            { id: `${projectId}:${entry.mediaId}`, projectKey: projectId, mediaId: entry.mediaId, srcPath: entry.srcPath, outDir: "", fileName: "", profile: entry.profile, previewTwin: false, status: "queued", progress: 0, attempts: 0 } satisfies OpenReelProxyJob,
          ]),
        ),
      },
    }));
    void submitBatch(batch, force);
  }
  return result;
}

async function submitBatch(batch: Array<{ mediaId: string; name: string; srcPath: string; profile: DesktopProxyProfile }>, force: boolean): Promise<void> {
  const api = bridge();
  if (!api) return;
  const previewTwin = batch.some((entry) => isIntermediateProxyCodec(entry.profile.codec)) && !(await rendererDecodesProres());
  try {
    const jobs = await api.enqueueProxies({
      ...ingestProject(),
      items: batch.map((entry) => ({ ...entry, previewTwin: isIntermediateProxyCodec(entry.profile.codec) && previewTwin })),
      force,
    });
    patchState((s) => ({ jobs: { ...s.jobs, ...Object.fromEntries(jobs.map((job) => [job.mediaId, job])) } }));
  } catch (error) {
    patchState((s) => ({ jobs: Object.fromEntries(Object.entries(s.jobs).filter(([id]) => !batch.some((entry) => entry.mediaId === id))) }));
    toast.error("Could not queue proxies", error instanceof Error ? error.message : undefined);
  }
}

export function cancelDesktopJob(mediaId: string): void {
  const job = useDesktopIngestStore.getState().jobs[mediaId];
  if (!job) return;
  patchState((s) => ({ jobs: Object.fromEntries(Object.entries(s.jobs).filter(([id]) => id !== mediaId)) }));
  void bridge()?.cancelProxyJobs([job.id]);
}

/** Cancel a queued or running background copy (the partial file is removed; the original was never touched). */
export function cancelDesktopCopy(mediaId: string): void {
  const job = useDesktopIngestStore.getState().copyJobs[mediaId];
  if (!job) return;
  patchState((s) => ({ copyJobs: Object.fromEntries(Object.entries(s.copyJobs).filter(([id]) => id !== mediaId)) }));
  void bridge()?.cancelProxyJobs([job.id]);
}

/** Media a copy job can be made for: a file on disk that is not already a project copy. */
export function nativeCopySource(item: MediaItem): string | null {
  return !item.isPlaceholder && !item.isPending && !item.copiedFrom && item.sourceFile?.path ? item.sourceFile.path : null;
}

export interface DesktopCopyQueueResult {
  queued: string[];
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Queue verified copies into the project's Media folder as background jobs (one at a time, cancellable,
 * resumed after a restart). With `thenProxies` each copy is followed by a proxy built from it with the
 * given (or the project's) preset. The project is pointed at the copies as they finish.
 */
export async function queueDesktopCopies(mediaIds: readonly string[], options: { thenProxies?: boolean; proxyProfile?: DesktopProxyProfile | null } = {}): Promise<DesktopCopyQueueResult> {
  const api = bridge();
  const out: DesktopCopyQueueResult = { queued: [], skipped: [] };
  if (!api) return out;
  const items = project().mediaLibrary.items;
  const batch: Array<{ mediaId: string; name: string; srcPath: string }> = [];
  for (const id of mediaIds) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) continue;
    if (item.isPlaceholder || item.isPending) out.skipped.push({ name: item.name, reason: "The media is offline." });
    else if (item.copiedFrom) out.skipped.push({ name: item.name, reason: "Already copied to the project." });
    else if (useDesktopIngestStore.getState().copyJobs[id]) out.skipped.push({ name: item.name, reason: "Already queued." });
    else if (!nativeCopySource(item)) out.skipped.push({ name: item.name, reason: "It was not imported from a file on disk." });
    else batch.push({ mediaId: id, name: item.name, srcPath: item.sourceFile!.path! });
  }
  if (!batch.length) return out;
  if (!useDesktopIngestStore.getState().folders?.projectSaved) await refreshFolders();
  const proxyProfile = options.thenProxies ? resolveBatchProfile(project(), options.proxyProfile) : null;
  const previewTwin = proxyProfile ? isIntermediateProxyCodec(proxyProfile.codec) && !(await rendererDecodesProres()) : false;
  const projectId = project().id;
  patchState((s) => ({
    lastCopy: Object.keys(s.copyJobs).length ? s.lastCopy : null,
    copyJobs: {
      ...s.copyJobs,
      ...Object.fromEntries(batch.map((entry) => [entry.mediaId, { id: `${projectId}:copy:${entry.mediaId}`, kind: "copy", projectKey: projectId, mediaId: entry.mediaId, srcPath: entry.srcPath, outDir: "", fileName: "", profile: proxyProfile ?? DEFAULT_COPY_PROFILE, previewTwin: false, status: "queued", progress: 0, attempts: 0 } satisfies OpenReelProxyJob])),
    },
  }));
  try {
    const jobs = await api.enqueueCopies({
      ...ingestProject(),
      items: batch,
      algorithm: resolveDesktopChecksum(project()),
      ...(proxyProfile ? { thenProxies: { profile: proxyProfile, previewTwin } } : {}),
    });
    out.queued = batch.map((entry) => entry.mediaId);
    patchState((s) => ({ copyJobs: { ...s.copyJobs, ...Object.fromEntries(jobs.map((job) => [job.mediaId, job])) } }));
    if (proxyProfile) {
      // The follow-up proxies are queued in the main process when each copy is verified; show them as waiting now.
      patchState((s) => ({
        jobs: { ...s.jobs, ...Object.fromEntries(batch.filter((entry) => !s.jobs[entry.mediaId]).map((entry) => [entry.mediaId, { id: `${projectId}:${entry.mediaId}`, projectKey: projectId, mediaId: entry.mediaId, srcPath: entry.srcPath, outDir: "", fileName: "", profile: proxyProfile, previewTwin: false, status: "queued", progress: 0, attempts: 0 } satisfies OpenReelProxyJob])) },
      }));
    }
  } catch (error) {
    patchState((s) => ({ copyJobs: Object.fromEntries(Object.entries(s.copyJobs).filter(([id]) => !batch.some((entry) => entry.mediaId === id))) }));
    toast.error("Could not queue the copy", error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : undefined);
    out.skipped.push(...batch.map((entry) => ({ name: entry.name, reason: "Could not be queued." })));
  }
  return out;
}

const DEFAULT_COPY_PROFILE: DesktopProxyProfile = { codec: "h264", size: "half" };

export async function retryFailedDesktopProxies(): Promise<number> {
  const api = bridge();
  if (!api) return 0;
  const retried = await api.retryFailedProxyJobs(project().id);
  patchState((s) => ({
    jobs: { ...s.jobs, ...Object.fromEntries(retried.filter((job) => job.kind !== "copy").map((job) => [job.mediaId, job])) },
    copyJobs: { ...s.copyJobs, ...Object.fromEntries(retried.filter((job) => job.kind === "copy").map((job) => [job.mediaId, job])) },
  }));
  return retried.length;
}

const isCurrentProject = (job: OpenReelProxyJob): boolean => job.projectKey === project().id;

function sameRef(item: MediaItem, job: OpenReelProxyJob): boolean {
  return item.proxy?.storage === "path" && item.proxy.path === job.result?.outPath;
}

/** A native proxy finished: link it to its media (one undo step), load it for preview, tell the queue. */
async function finalizeJob(job: OpenReelProxyJob): Promise<void> {
  const api = bridge();
  const result = job.result;
  if (!api || !result || !isCurrentProject(job)) return;
  const item = project().mediaLibrary.items.find((candidate) => candidate.id === job.mediaId);
  if (!item || item.isPlaceholder) {
    // The media was removed while the proxy was building: the file is of no use to this project.
    patchState((s) => ({ jobs: Object.fromEntries(Object.entries(s.jobs).filter(([id]) => id !== job.mediaId)) }));
    void api.ackProxyJobs([job.id]);
    return;
  }
  if (!sameRef(item, job)) {
    const ref = {
      ...createProxyRef({
        storage: "path",
        path: result.outPath,
        probe: { duration: result.duration, width: result.width, height: result.height, frameRate: result.frameRate, codec: result.codec },
        fileSize: result.fileSize,
        source: "generated",
      }),
      profile: job.profile,
      ...(result.previewPath ? { previewPath: result.previewPath } : {}),
    };
    if (!(await organize({ label: "Create proxy", itemPatches: { [item.id]: { proxy: ref } } }))) {
      toast.warning("Proxy not linked", `${item.name}: the project rejected the change.`);
      return;
    }
  }
  patchState((s) => ({ jobs: Object.fromEntries(Object.entries(s.jobs).filter(([id]) => id !== job.mediaId)) }));
  void api.ackProxyJobs([job.id]);
  const live = project().mediaLibrary.items.find((candidate) => candidate.id === job.mediaId);
  if (live) await loadDesktopProxy(live);
}

/** A background copy finished and verified: point the project at the copy (one undo step) and tell the queue. */
async function finalizeCopyJob(job: OpenReelProxyJob): Promise<void> {
  const api = bridge();
  const result = job.copyResult;
  if (!api || !result || !isCurrentProject(job)) return;
  const drop = (): void => {
    patchState((s) => ({ copyJobs: Object.fromEntries(Object.entries(s.copyJobs).filter(([id]) => id !== job.mediaId)) }));
    void api.ackProxyJobs([job.id]);
  };
  const item = project().mediaLibrary.items.find((candidate) => candidate.id === job.mediaId);
  if (!item || item.isPlaceholder) {
    // The media was removed while it was copying: the copy is of no use to this project (the file stays in the Media folder).
    drop();
    return;
  }
  const entry = { mediaId: item.id, name: item.name, path: result.destPath, sha256: result.checksum.algorithm === "sha256" ? result.checksum.value : "", algorithm: result.checksum.algorithm, checksum: result.checksum.value };
  if (item.sourceFile?.path !== result.destPath) {
    const patch = {
      sourceFile: { ...item.sourceFile!, path: result.destPath, folder: parentFolderName(result.destPath) },
      copiedFrom: { path: job.srcPath, sha256: entry.sha256, copiedAt: Date.now(), checksum: result.checksum },
    };
    if (!(await organize({ label: "Copy media to project", itemPatches: { [item.id]: patch } }))) {
      patchState((s) => ({ lastCopy: { copied: s.lastCopy?.copied ?? [], skipped: [...(s.lastCopy?.skipped ?? []), { name: item.name, reason: "The project rejected the change." }] } }));
      drop();
      return;
    }
  }
  patchState((s) => ({ lastCopy: { copied: [...(s.lastCopy?.copied ?? []), entry], skipped: s.lastCopy?.skipped ?? [] } }));
  drop();
  if (Object.keys(useDesktopIngestStore.getState().copyJobs).length === 0) {
    const report = useDesktopIngestStore.getState().lastCopy;
    if (report?.copied.length) toast.success("Media copied to the project", `${report.copied.length} file${report.copied.length === 1 ? "" : "s"} verified by ${describeChecksum(report.copied[0].algorithm)}. The originals were not touched.`);
  }
}

export const describeChecksum = (algorithm: string): string => (algorithm === "xxh64" ? "xxHash64" : algorithm === "md5" ? "MD5" : "SHA-256");

function onProxyEvent(event: { type: "update"; job: OpenReelProxyJob } | { type: "removed"; id: string; projectKey: string }): void {
  if (event.type === "removed") {
    patchState((s) => ({
      jobs: Object.fromEntries(Object.entries(s.jobs).filter(([, job]) => job.id !== event.id)),
      copyJobs: Object.fromEntries(Object.entries(s.copyJobs).filter(([, job]) => job.id !== event.id)),
    }));
    return;
  }
  const job = event.job;
  if (!isCurrentProject(job)) return;
  if (job.kind === "copy") {
    if (job.status === "done") void finalizeCopyJob(job);
    else {
      patchState((s) => ({ copyJobs: { ...s.copyJobs, [job.mediaId]: job } }));
      if (job.status === "failed") patchState((s) => ({ lastCopy: { copied: s.lastCopy?.copied ?? [], skipped: [...(s.lastCopy?.skipped ?? []).filter((entry) => entry.name !== (job.name ?? job.mediaId)), { name: job.name ?? job.mediaId, reason: job.error ?? "Copy failed." }] } }));
    }
    return;
  }
  if (job.status === "done") void finalizeJob(job);
  else patchState((s) => ({ jobs: { ...s.jobs, [job.mediaId]: job } }));
}

// ---- Loading a proxy file for preview ----------------------------------------------------------------

const MIME: Record<string, string> = { mov: "video/quicktime", mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mkv: "video/x-matroska" };
const mimeFor = (path: string): string => MIME[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "video/mp4";
const isProresRef = (item: MediaItem): boolean => /prores|apc[nohs]|ap4[hx]/i.test(item.proxy?.codec ?? "");

/**
 * Register an item's desktop proxy with the preview cache. Returns "ready" (preview decodes it),
 * "external" (the file is fine but the renderer cannot decode it, e.g. ProRes without a preview twin)
 * or "missing" (no file at the recorded path).
 */
export async function loadDesktopProxy(item: MediaItem): Promise<"ready" | "external" | "missing"> {
  const api = bridge();
  const ref = item.proxy;
  if (!api || !ref || ref.storage !== "path") return "missing";
  const known = useDesktopIngestStore.getState().files[item.id];
  try {
    const stat = (await api.stat([ref.path, ...(ref.previewPath ? [ref.previewPath] : [])]));
    if (!stat[ref.path]?.exists) {
      patchState((s) => ({ files: { ...s.files, [item.id]: { exists: false, previewable: false, path: ref.path } } }));
      return "missing";
    }
    const previewPath = ref.previewPath && stat[ref.previewPath]?.exists ? ref.previewPath : null;
    const playPath = previewPath ?? ref.path;
    if (!previewPath && isProresRef(item) && !(await rendererDecodesProres())) {
      patchState((s) => ({ files: { ...s.files, [item.id]: { exists: true, previewable: false, path: ref.path } } }));
      return "external";
    }
    if (known?.exists && known.previewable && known.path === ref.path && previewProxyCache.store.getState().entries[item.id]?.status === "ready") return "ready";
    const bytes = await api.readProxy(playPath);
    const blob = new Blob([bytes], { type: mimeFor(playPath) });
    const meta = await getMediaEngine().extractMetadata(blob);
    if (!meta.hasVideo || !(meta.canDecodeVideo ?? meta.canDecode)) {
      patchState((s) => ({ files: { ...s.files, [item.id]: { exists: true, previewable: false, path: ref.path } } }));
      return "external";
    }
    // Hydrate against the live item: the project may have changed while the bytes loaded.
    const live = project().mediaLibrary.items.find((candidate) => candidate.id === item.id);
    if (!live?.proxy || live.proxy.path !== ref.path) return "missing";
    previewProxyCache.hydrate(live, blob, { width: meta.width, height: meta.height });
    patchState((s) => ({ files: { ...s.files, [item.id]: { exists: true, previewable: true, path: ref.path } } }));
    return "ready";
  } catch (error) {
    console.warn("[desktop-ingest] Could not load the proxy:", error);
    patchState((s) => ({ files: { ...s.files, [item.id]: { exists: false, previewable: false, path: ref.path } } }));
    return "missing";
  }
}

// ---- Copy to project ---------------------------------------------------------------------------------

/** Copy media into the project's Media folder (checksum-verified) and point the project at the copies. */
export async function copyMediaToProject(mediaIds: readonly string[]): Promise<DesktopCopyReport> {
  const api = bridge();
  const report: DesktopCopyReport = { copied: [], skipped: [] };
  if (!api) return report;
  const origin = project();
  const items = origin.mediaLibrary.items;
  const patches: Record<string, { sourceFile: NonNullable<MediaItem["sourceFile"]>; copiedFrom: NonNullable<MediaItem["copiedFrom"]> }> = {};
  const requests = new Map<string, string>();
  const off = api.onCopyProgress(({ requestId, progress }) => {
    const mediaId = requests.get(requestId);
    if (mediaId) patchState((s) => ({ copying: { ...s.copying, [mediaId]: progress } }));
  });
  try {
    for (const id of mediaIds) {
      const item = items.find((candidate) => candidate.id === id);
      if (!item) continue;
      const src = item.sourceFile?.path;
      if (item.isPlaceholder || item.isPending) report.skipped.push({ name: item.name, reason: "The media is offline." });
      else if (!src) report.skipped.push({ name: item.name, reason: "It was not imported from a file on disk." });
      else if (item.copiedFrom) report.skipped.push({ name: item.name, reason: "Already copied to the project." });
      else {
        const requestId = uuidv4();
        requests.set(requestId, id);
        patchState((s) => ({ copying: { ...s.copying, [id]: 0 } }));
        try {
          const copy = await api.copyToProject({ ...ingestProject(), requestId, srcPath: src, algorithm: resolveDesktopChecksum(project()) } as Parameters<typeof api.copyToProject>[0]);
          if (project().id !== origin.id) return report;
          if (copy.alreadyInPlace) report.skipped.push({ name: item.name, reason: "Already in the project's Media folder." });
          else {
            patches[id] = {
              sourceFile: { ...item.sourceFile!, path: copy.destPath, folder: parentFolderName(copy.destPath) },
              copiedFrom: { path: src, sha256: copy.sha256, copiedAt: Date.now(), checksum: copy.checksum },
            };
            report.copied.push({ mediaId: id, name: item.name, path: copy.destPath, sha256: copy.sha256, algorithm: copy.checksum.algorithm, checksum: copy.checksum.value });
          }
        } catch (error) {
          report.skipped.push({ name: item.name, reason: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "Copy failed." });
        } finally {
          patchState((s) => ({ copying: Object.fromEntries(Object.entries(s.copying).filter(([key]) => key !== id)) }));
        }
      }
    }
  } finally {
    off();
  }
  if (Object.keys(patches).length && project().id === origin.id) {
    if (!(await organize({ label: "Copy media to project", itemPatches: patches }))) {
      report.skipped.push(...report.copied.map((entry) => ({ name: entry.name, reason: "The project rejected the change." })));
      report.copied = [];
    }
  }
  patchState({ lastCopy: report });
  if (report.copied.length) toast.success("Media copied to the project", `${report.copied.length} file${report.copied.length === 1 ? "" : "s"} verified by ${describeChecksum(report.copied[0].algorithm)}. The originals were not touched.`);
  else if (report.skipped.length) toast.warning("Nothing copied", report.skipped[0].reason);
  return report;
}

// ---- Relink -----------------------------------------------------------------------------------------------

const MEDIA_MIME: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo", mpg: "video/mpeg", mpeg: "video/mpeg",
  mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac", m4a: "audio/mp4", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg", aif: "audio/aiff", aiff: "audio/aiff",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", avif: "image/avif",
};
/** A File built from bytes has no type; the importer expects one, as it gets from a picked file. */
const mediaMimeFor = (name: string): string => MEDIA_MIME[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? "";

/** Files over this are not loaded through the main process (they would be read into memory); pick them with the file chooser. */
const MAX_RELINK_BYTES = 1.5 * 1024 ** 3;

async function fileFromPath(path: string, item: MediaItem): Promise<File> {
  const api = bridge()!;
  const stat = await api.stat([path]);
  if (!stat[path]?.exists) throw new Error("The file is gone.");
  if (stat[path].size > MAX_RELINK_BYTES) throw new Error("The file is too large to reconnect from here. Use Replace asset and pick it with the file chooser.");
  const bytes = await window.openreel!.fs.readFileBytes(path);
  const name = item.sourceFile?.name ?? fileBaseName(path);
  const file = new File([bytes], name, { type: mediaMimeFor(name), lastModified: item.sourceFile?.lastModified ?? Date.now() });
  // A File built from bytes has no path of its own: tell the native decoder where it came from.
  rememberNativePath(file, path);
  return file;
}

async function reconnectOne(item: MediaItem, path: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const file = await fileFromPath(path, item);
    // The path rides along with the replacement, so reconnecting is one change (no extra undo step).
    const result = await useProjectStore.getState().replaceMediaAsset(item.id, file, undefined, { restorePlaceholder: item.isPlaceholder, sourcePath: path });
    if (!result.success) return { ok: false, reason: result.error?.message ?? "The file could not be decoded." };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Could not read the file." };
  }
}

/** The `Media` folder beside the open project file, for a project folder that was moved (Project Manager output). */
function siblingMediaPath(item: MediaItem): string | null {
  const file = currentProjectPath();
  const recorded = item.sourceFile?.path;
  if (!file || !recorded) return null;
  const sep = file.includes("\\") && !file.includes("/") ? "\\" : "/";
  const dir = file.slice(0, file.lastIndexOf(sep));
  const name = recorded.split(/[\\/]/).pop();
  return name ? `${dir}${sep}Media${sep}${name}` : null;
}

/** Offline media that remember where they came from: reconnect the ones whose file is back (or sits in the project's own Media folder). */
export async function reconnectKnownPaths(): Promise<number> {
  const api = bridge();
  if (!api) return 0;
  const offline = project().mediaLibrary.items.filter((item) => item.isPlaceholder && item.sourceFile?.path);
  if (!offline.length) return 0;
  const alternates = new Map(offline.map((item) => [item.id, siblingMediaPath(item)]));
  const stat = await api.stat([...offline.map((item) => item.sourceFile!.path!), ...[...alternates.values()].filter((p): p is string => Boolean(p))]);
  let linked = 0;
  for (const item of offline) {
    const recorded = item.sourceFile!.path!;
    const alternate = alternates.get(item.id);
    const found = stat[recorded]?.exists ? recorded : alternate && stat[alternate]?.exists ? alternate : null;
    if (!found) continue;
    if ((await reconnectOne(item, found)).ok) linked++;
  }
  return linked;
}

function describeScan(result: Pick<RelinkResult, "ambiguous" | "unmatchedMediaIds">, byId: Map<string, MediaItem>) {
  return {
    ambiguous: result.ambiguous.map((entry) => ({ name: byId.get(entry.mediaId)?.name ?? entry.mediaId, candidates: entry.candidates.map((c) => c.path) })),
    notFound: result.unmatchedMediaIds.map((id) => byId.get(id)?.name ?? id),
  };
}

/** Choose a folder, search it (recursively) for offline media / missing proxies and relink the matches by name + duration + frame rate. */
export async function relinkFromFolder(kind: "full" | "proxy", presetFolder?: string, options: { pattern?: string } = {}): Promise<DesktopRelinkReport | null> {
  const api = bridge();
  if (!api) return null;
  const origin = project();
  const targets = origin.mediaLibrary.items.filter((item) =>
    kind === "full"
      ? item.isPlaceholder && !item.isPending
      : item.type === "video" && !item.isPlaceholder && !item.subclip && (!item.proxy || useDesktopIngestStore.getState().files[item.id]?.exists === false),
  );
  if (!targets.length) {
    toast.info(kind === "full" ? "No offline media" : "No missing proxies", kind === "full" ? "Every media file is online." : "Every proxy was found.");
    return null;
  }
  const folder = presetFolder ?? (await api.pickFolder({ title: kind === "full" ? "Search this folder for the offline media" : "Search this folder for the proxies" }));
  if (!folder) return null;
  const pattern = kind === "proxy" && options.pattern?.trim() ? options.pattern.trim() : undefined;
  let compiled: ReturnType<typeof compileProxyPattern> | null = null;
  try {
    compiled = pattern ? compileProxyPattern(pattern) : null;
  } catch (error) {
    toast.error("Check the proxy name pattern", error instanceof Error ? error.message : undefined);
    return null;
  }
  const scan = await api.scanFolder({ root: folder, names: targets.map((item) => item.sourceFile?.name ?? item.name), mode: kind === "full" ? "media" : "proxy", ...(pattern ? { proxyPattern: pattern } : {}) });
  if (project().id !== origin.id) return null;
  const byId = new Map(targets.map((item) => [item.id, item]));
  // Proxies are paired by name (and pattern), duration and frame rate; a file with the right name and the wrong duration
  // or frame rate is reported as a mismatch instead of being attached.
  const match: { matches: Array<{ mediaId: string; candidate: RelinkCandidate }>; ambiguous: Array<{ mediaId: string; candidates: RelinkCandidate[] }>; unmatchedMediaIds: string[] } & { mismatches?: ReturnType<typeof matchProxiesByPattern>["mismatches"] } =
    kind === "proxy"
      ? matchProxiesByPattern(targets.map(relinkTargetFor), scan.candidates as RelinkCandidate[], compiled)
      : matchRelinkCandidates(targets.map(relinkTargetFor), scan.candidates as RelinkCandidate[], { proxy: false });
  const report: DesktopRelinkReport = {
    kind,
    folder,
    scanned: scan.visited,
    truncated: scan.truncated,
    linked: [],
    failed: [],
    mismatched: (match.mismatches ?? []).map((entry) => ({ name: byId.get(entry.mediaId)?.name ?? entry.mediaId, file: fileBaseName(entry.candidate.path), reasons: entry.reasons })),
    ...(pattern ? { pattern } : {}),
    ...describeScan(match, byId),
  };

  if (kind === "full") {
    for (const found of match.matches) {
      const item = byId.get(found.mediaId)!;
      const outcome = await reconnectOne(item, found.candidate.path);
      if (outcome.ok) report.linked.push({ mediaId: item.id, name: item.name, path: found.candidate.path });
      else report.failed.push({ name: item.name, reason: outcome.reason ?? "Failed." });
    }
  } else {
    const patches: Record<string, { proxy: NonNullable<MediaItem["proxy"]> }> = {};
    // A ProRes proxy found on disk may have its H.264 preview twin beside it (our own naming).
    const twinOf = (path: string): string => path.replace(/\.[^./\\]+$/, "") + ".preview.mp4";
    const twins = await api.stat(match.matches.map((found) => twinOf(found.candidate.path)));
    for (const found of match.matches) {
      const item = byId.get(found.mediaId)!;
      const c = found.candidate;
      const probe = { duration: c.duration ?? item.metadata.duration, width: c.width ?? 0, height: c.height ?? 0, frameRate: c.frameRate ?? item.metadata.frameRate, hasVideo: true };
      const issues = validateProxy(item.metadata, probe);
      if (issues.length) {
        report.failed.push({ name: item.name, reason: issues.map((issue) => issue.message).join(" ") });
        continue;
      }
      const twin = twinOf(c.path);
      const hasTwin = Boolean(twins[twin]?.exists) && twin !== c.path;
      patches[item.id] = {
        proxy: {
          ...createProxyRef({ storage: "path", path: c.path, probe: { ...probe, codec: hasTwin ? "prores" : "unknown" }, fileSize: c.size ?? 0, source: "attached" }),
          ...(hasTwin ? { previewPath: twin } : {}),
        },
      };
      report.linked.push({ mediaId: item.id, name: item.name, path: c.path });
    }
    if (Object.keys(patches).length && project().id === origin.id) {
      if (await organize({ label: "Relink proxies", itemPatches: patches })) {
        for (const id of Object.keys(patches)) {
          const live = project().mediaLibrary.items.find((candidate) => candidate.id === id);
          if (live) await loadDesktopProxy(live);
        }
      } else {
        report.failed.push(...report.linked.map((entry) => ({ name: entry.name, reason: "The project rejected the change." })));
        report.linked = [];
      }
    }
  }
  patchState({ lastRelink: report });
  const summary = [`${report.linked.length} ${kind === "proxy" ? "attached" : "relinked"}`, report.mismatched.length ? `${report.mismatched.length} mismatched` : "", report.ambiguous.length ? `${report.ambiguous.length} ambiguous` : "", report.notFound.length ? `${report.notFound.length} not found` : "", report.failed.length ? `${report.failed.length} failed` : ""].filter(Boolean).join(" · ");
  if (report.linked.length) toast.success(kind === "full" ? "Media relinked" : "Proxies relinked", summary);
  else toast.warning("Nothing relinked", `${summary}${scan.truncated ? " · search stopped at its limit" : ""}`);
  return report;
}

// ---- Project open: restore state ----------------------------------------------------------------------------

let currentProjectId = "";
let started = false;

async function onProjectOpened(): Promise<void> {
  const api = bridge();
  const { project: current, hasOpenProject } = useProjectStore.getState();
  if (!api || !hasOpenProject || currentProjectId === current.id) return;
  currentProjectId = current.id;
  patchState({ jobs: {}, copyJobs: {}, files: {}, copying: {}, lastRelink: null, lastCopy: null });
  void refreshFolders();
  void api.setProxyConcurrency(current.mediaLibrary.desktopIngest?.concurrency ?? 1);
  try {
    // Jobs that ran (or finished) while this project was closed.
    const jobs = await api.listProxyJobs(current.id);
    if (project().id !== current.id) return;
    const pending = jobs.filter((job) => job.status !== "done");
    patchState({
      jobs: Object.fromEntries(pending.filter((job) => job.kind !== "copy").map((job) => [job.mediaId, job])),
      copyJobs: Object.fromEntries(pending.filter((job) => job.kind === "copy").map((job) => [job.mediaId, job])),
    });
    // Copies first: the project must point at the copy before its proxy is linked.
    for (const job of jobs.filter((entry) => entry.status === "done" && entry.kind === "copy")) await finalizeCopyJob(job);
    for (const job of jobs.filter((entry) => entry.status === "done" && entry.kind !== "copy")) await finalizeJob(job);
  } catch {
    /* the queue is unavailable: nothing to restore */
  }
  void reconnectKnownPaths();
}

/** Install the desktop ingest wiring once (idempotent; a no-op on the web). */
export function startDesktopIngest(): void {
  const api = bridge();
  if (started || !api) return;
  started = true;
  api.onProxyEvent(onProxyEvent);
  void onProjectOpened();
  useProjectStore.subscribe((state, previous) => {
    if (state.hasOpenProject && (state.project.id !== previous.project.id || state.hasOpenProject !== previous.hasOpenProject)) void onProjectOpened();
  });
}

