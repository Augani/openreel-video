import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import {
  createProxyRef,
  getMediaEngine,
  matchRelinkCandidates,
  relinkTargetFor,
  resolveDesktopProxyProfile,
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
}

export interface DesktopCopyReport {
  copied: Array<{ mediaId: string; name: string; path: string; sha256: string }>;
  skipped: Array<{ name: string; reason: string }>;
}

interface DesktopIngestState {
  /** Native proxy jobs by media id (queued, running, failed). Finished jobs are linked and dropped. */
  jobs: Record<string, OpenReelProxyJob>;
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
export const setDesktopProxyProfile = (profile: DesktopProxyProfile): Promise<boolean> =>
  updateDesktopIngestConfig({ proxyProfile: profile }, "Set proxy format");

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
export function queueDesktopProxies(mediaIds: readonly string[], force = false): DesktopQueueResult & { legacy: string[] } {
  const result: DesktopQueueResult & { legacy: string[] } = { queued: [], skipped: [], legacy: [] };
  const items = project().mediaLibrary.items;
  const profile = resolveDesktopProxyProfile(project());
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
  const previewTwin = batch.some((entry) => entry.profile.codec === "prores-proxy") && !(await rendererDecodesProres());
  try {
    const jobs = await api.enqueueProxies({
      ...ingestProject(),
      items: batch.map((entry) => ({ ...entry, previewTwin: entry.profile.codec === "prores-proxy" && previewTwin })),
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

export async function retryFailedDesktopProxies(): Promise<number> {
  const api = bridge();
  if (!api) return 0;
  const retried = await api.retryFailedProxyJobs(project().id);
  patchState((s) => ({ jobs: { ...s.jobs, ...Object.fromEntries(retried.map((job) => [job.mediaId, job])) } }));
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

function onProxyEvent(event: { type: "update"; job: OpenReelProxyJob } | { type: "removed"; id: string; projectKey: string }): void {
  if (event.type === "removed") {
    patchState((s) => ({ jobs: Object.fromEntries(Object.entries(s.jobs).filter(([, job]) => job.id !== event.id)) }));
    return;
  }
  const job = event.job;
  if (!isCurrentProject(job)) return;
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
          const copy = await api.copyToProject({ ...ingestProject(), requestId, srcPath: src });
          if (project().id !== origin.id) return report;
          if (copy.alreadyInPlace) report.skipped.push({ name: item.name, reason: "Already in the project's Media folder." });
          else {
            patches[id] = {
              sourceFile: { ...item.sourceFile!, path: copy.destPath, folder: parentFolderName(copy.destPath) },
              copiedFrom: { path: src, sha256: copy.sha256, copiedAt: Date.now() },
            };
            report.copied.push({ mediaId: id, name: item.name, path: copy.destPath, sha256: copy.sha256 });
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
  if (report.copied.length) toast.success("Media copied to the project", `${report.copied.length} file${report.copied.length === 1 ? "" : "s"} verified by checksum. The originals were not touched.`);
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

/** Offline media that remember where they came from: reconnect the ones whose file is back. */
export async function reconnectKnownPaths(): Promise<number> {
  const api = bridge();
  if (!api) return 0;
  const offline = project().mediaLibrary.items.filter((item) => item.isPlaceholder && item.sourceFile?.path);
  if (!offline.length) return 0;
  const stat = await api.stat(offline.map((item) => item.sourceFile!.path!));
  let linked = 0;
  for (const item of offline) {
    if (!stat[item.sourceFile!.path!]?.exists) continue;
    if ((await reconnectOne(item, item.sourceFile!.path!)).ok) linked++;
  }
  return linked;
}

function describeScan(result: RelinkResult, byId: Map<string, MediaItem>) {
  return {
    ambiguous: result.ambiguous.map((entry) => ({ name: byId.get(entry.mediaId)?.name ?? entry.mediaId, candidates: entry.candidates.map((c) => c.path) })),
    notFound: result.unmatchedMediaIds.map((id) => byId.get(id)?.name ?? id),
  };
}

/** Choose a folder, search it (recursively) for offline media / missing proxies and relink the matches by name + duration + frame rate. */
export async function relinkFromFolder(kind: "full" | "proxy", presetFolder?: string): Promise<DesktopRelinkReport | null> {
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
  const scan = await api.scanFolder({ root: folder, names: targets.map((item) => item.sourceFile?.name ?? item.name), mode: kind === "full" ? "media" : "proxy" });
  if (project().id !== origin.id) return null;
  const byId = new Map(targets.map((item) => [item.id, item]));
  const match = matchRelinkCandidates(targets.map(relinkTargetFor), scan.candidates as RelinkCandidate[], { proxy: kind === "proxy" });
  const report: DesktopRelinkReport = { kind, folder, scanned: scan.visited, truncated: scan.truncated, linked: [], failed: [], ...describeScan(match, byId) };

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
  const summary = [`${report.linked.length} relinked`, report.ambiguous.length ? `${report.ambiguous.length} ambiguous` : "", report.notFound.length ? `${report.notFound.length} not found` : "", report.failed.length ? `${report.failed.length} failed` : ""].filter(Boolean).join(" · ");
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
  patchState({ jobs: {}, files: {}, copying: {}, lastRelink: null, lastCopy: null });
  void refreshFolders();
  void api.setProxyConcurrency(current.mediaLibrary.desktopIngest?.concurrency ?? 1);
  try {
    // Jobs that ran (or finished) while this project was closed.
    const jobs = await api.listProxyJobs(current.id);
    if (project().id !== current.id) return;
    const pending = jobs.filter((job) => job.status !== "done");
    patchState({ jobs: Object.fromEntries(pending.map((job) => [job.mediaId, job])) });
    for (const job of jobs.filter((entry) => entry.status === "done")) await finalizeJob(job);
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

