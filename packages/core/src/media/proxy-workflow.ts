import type { IngestPreset, MediaItem, MediaMetadata, MediaProxyRef, Project } from "../types/project";

/**
 * Pure logic for the proxy / ingest workflow (Premiere's ingest settings + Toggle Proxies).
 * Proxies are preview-only: every export path resolves media through `fullResolutionSource`.
 */

export const INGEST_PRESETS: readonly { id: IngestPreset; label: string; description: string }[] = [
  { id: "none", label: "None", description: "Import the media as it is." },
  { id: "proxies", label: "Create proxies", description: "Build a low-resolution H.264 copy in the background for smooth editing." },
  { id: "copy", label: "Copy media to project", description: "Copy the media into the project folder (desktop only)." },
];

export function isIngestPreset(value: unknown): value is IngestPreset {
  return value === "none" || value === "proxies" || value === "copy";
}

/** The preset an import uses: a per-import override wins over the project default. */
export function effectiveIngestPreset(project: Pick<Project, "mediaLibrary">, override?: IngestPreset | null): IngestPreset {
  return override ?? project.mediaLibrary.ingestPreset ?? "none";
}

/** Items the ingest preset should process: real video, not a subclip, with no proxy yet. */
export function itemNeedsIngestProxy(item: MediaItem): boolean {
  return item.type === "video" && !item.isPlaceholder && !item.isPending && !item.subclip && !item.proxy && (item.metadata.hasVideo ?? true);
}

export interface ProxyValidationIssue {
  readonly code: "duration" | "frame-rate" | "aspect" | "no-video";
  readonly message: string;
}

export interface ProxyProbe {
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly hasVideo?: boolean;
}

/** Duration slack: a proxy may be a couple of frames off, never more than 0.25 s / 1 %. */
export function durationTolerance(full: MediaMetadata): number {
  return Math.max(0.25, full.duration * 0.01);
}

/** Validate a candidate proxy file against its full-resolution item. Empty array = acceptable. */
export function validateProxy(full: MediaMetadata, proxy: ProxyProbe): ProxyValidationIssue[] {
  const issues: ProxyValidationIssue[] = [];
  if (proxy.hasVideo === false || !(proxy.width > 0) || !(proxy.height > 0))
    return [{ code: "no-video", message: "The proxy has no video stream." }];
  // NaN would pass every `Math.abs(a - b) > limit` test below, so an unreadable duration is rejected outright.
  if (!Number.isFinite(proxy.duration) || proxy.duration <= 0)
    return [{ code: "duration", message: "The proxy has no readable duration." }];
  if (Math.abs(proxy.duration - full.duration) > durationTolerance(full))
    issues.push({
      code: "duration",
      message: `Duration ${proxy.duration.toFixed(2)}s does not match the original ${full.duration.toFixed(2)}s.`,
    });
  if (full.frameRate > 0 && proxy.frameRate > 0 && Math.abs(proxy.frameRate - full.frameRate) > 0.5)
    issues.push({
      code: "frame-rate",
      message: `Frame rate ${proxy.frameRate.toFixed(2)} fps does not match the original ${full.frameRate.toFixed(2)} fps.`,
    });
  if (full.width > 0 && full.height > 0) {
    const a = full.width / full.height;
    const b = proxy.width / proxy.height;
    if (Math.abs(a - b) / a > 0.02)
      issues.push({ code: "aspect", message: `Aspect ratio ${b.toFixed(3)} does not match the original ${a.toFixed(3)}.` });
  }
  return issues;
}

/** Scale from proxy pixels to full-resolution pixels (>= 1). Layout uses fractions, so this is for pixel-space work only. */
export function proxyScaleFactor(full: Pick<MediaMetadata, "width" | "height">, proxy: { width: number; height: number }): number {
  if (!(proxy.width > 0) || !(proxy.height > 0)) return 1;
  return Math.max(full.width / proxy.width, full.height / proxy.height) || 1;
}

const PROXY_SUFFIX = /[\s._-]*(proxy|prx|lowres|low-res|lr)$/i;

/** Name used to pair files: lower-case, no extension, no `_proxy`-style suffix. */
export function proxyMatchKey(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.replace(PROXY_SUFFIX, "").trim().toLowerCase();
}

export interface ProxyFileMatch<F> {
  readonly mediaId: string;
  readonly file: F;
}
export interface ProxyMatchResult<F> {
  readonly matches: ProxyFileMatch<F>[];
  readonly unmatchedFiles: F[];
  readonly unmatchedMediaIds: string[];
  readonly ambiguousMediaIds: string[];
}

/** Match proxy files to video items by name. A media name that two files claim is reported ambiguous, never guessed. */
export function matchProxyFiles<F extends { name: string }>(items: readonly MediaItem[], files: readonly F[]): ProxyMatchResult<F> {
  const byKey = new Map<string, F[]>();
  for (const file of files) {
    const key = proxyMatchKey(file.name);
    byKey.set(key, [...(byKey.get(key) ?? []), file]);
  }
  const matches: ProxyFileMatch<F>[] = [];
  const used = new Set<F>();
  const unmatchedMediaIds: string[] = [];
  const ambiguousMediaIds: string[] = [];
  for (const item of items) {
    if (item.type !== "video" || item.isPending || item.subclip) continue;
    const candidates = byKey.get(proxyMatchKey(item.name)) ?? [];
    if (candidates.length === 1) {
      matches.push({ mediaId: item.id, file: candidates[0] });
      used.add(candidates[0]);
    } else if (candidates.length > 1) ambiguousMediaIds.push(item.id);
    else unmatchedMediaIds.push(item.id);
  }
  return { matches, unmatchedFiles: files.filter((f) => !used.has(f)), unmatchedMediaIds, ambiguousMediaIds };
}

export type ProxyDisplayState = "none" | "ready" | "building" | "failed" | "missing-proxy" | "missing-full";

export interface ProxyRuntime {
  /** The item's full-resolution media is loaded. */
  readonly fullAvailable: boolean;
  /** The proxy's bytes were found (a ready cache entry or an existing file). */
  readonly proxyAvailable: boolean;
  readonly job?: "queued" | "encoding" | "error";
}

/** Project-panel state for an item. Missing full-res wins: that is what export needs. */
export function proxyDisplayState(item: MediaItem, runtime: ProxyRuntime): ProxyDisplayState {
  if (item.type !== "video") return "none";
  if (item.isPlaceholder || !runtime.fullAvailable) return item.proxy ? "missing-full" : "none";
  if (runtime.job === "queued" || runtime.job === "encoding") return "building";
  if (item.proxy) return runtime.proxyAvailable ? "ready" : "missing-proxy";
  return runtime.job === "error" ? "failed" : "none";
}

export const PROXY_STATE_LABEL: Record<ProxyDisplayState, string> = {
  none: "No proxy",
  ready: "Proxy ready",
  building: "Building proxy",
  failed: "Proxy failed",
  "missing-proxy": "Proxy missing",
  "missing-full": "Full-res missing",
};

/** Build a persisted reference from a probed proxy. */
export function createProxyRef(input: {
  storage: MediaProxyRef["storage"];
  path: string;
  probe: ProxyProbe & { codec?: string };
  fileSize: number;
  source: MediaProxyRef["source"];
  preset?: MediaProxyRef["preset"];
  now?: number;
}): MediaProxyRef {
  return {
    storage: input.storage,
    path: input.path,
    width: input.probe.width,
    height: input.probe.height,
    codec: input.probe.codec ?? "h264",
    frameRate: input.probe.frameRate,
    duration: input.probe.duration,
    fileSize: input.fileSize,
    status: "ready",
    ...(input.preset ? { preset: input.preset } : {}),
    source: input.source,
    createdAt: input.now ?? Date.now(),
  };
}

/** IndexedDB key of an item's proxy bytes. */
export const proxyRecordId = (mediaId: string): string => `proxy:${mediaId}`;
export const isProxyRecordId = (id: string): boolean => id.startsWith("proxy:");

/**
 * Export/interchange source. Always the library item itself with any proxy reference ignored;
 * callers must pass the library item, never a proxy-substituted copy.
 */
export function fullResolutionSource(item: MediaItem): MediaItem {
  return item;
}

export interface ProxyExportReport {
  readonly source: "full-resolution";
  readonly proxiedMedia: number;
  readonly usedProxy: false;
  readonly message: string;
}

/** The statement the export report carries. */
export function proxyExportReport(project: Pick<Project, "mediaLibrary"> & Partial<Pick<Project, "timeline" | "sequences">>, usedMediaIds?: ReadonlySet<string>): ProxyExportReport {
  const used = usedMediaIds ?? (project.timeline ? timelineMediaIds(project) : undefined);
  const proxied = project.mediaLibrary.items.filter((item) => item.proxy && (!used || used.has(item.id))).length;
  return {
    source: "full-resolution",
    proxiedMedia: proxied,
    usedProxy: false,
    message: proxied
      ? `Exported from full-resolution media. ${proxied} proxied clip${proxied === 1 ? " was" : "s were"} not used.`
      : "Exported from full-resolution media.",
  };
}

/** Media ids the active timeline and every sequence (nests read their inner timelines) reference. */
export function timelineMediaIds(project: Partial<Pick<Project, "timeline" | "sequences">>): Set<string> {
  const ids = new Set<string>();
  const timelines = [project.timeline, ...(project.sequences ?? []).map((sequence) => sequence.timeline)];
  for (const timeline of timelines)
    for (const track of timeline?.tracks ?? []) for (const clip of track.clips) if (clip.mediaId) ids.add(clip.mediaId);
  return ids;
}
