import type {
  DesktopIngestConfig,
  DesktopProxyCodec,
  DesktopProxyProfile,
  DesktopProxySize,
  MediaItem,
  Project,
} from "../types/project";
import { proxyMatchKey, type ProxyDisplayState } from "./proxy-workflow";

/**
 * Pure logic for the desktop ingest workflow: native proxy profiles, output naming, relink
 * matching (name + duration + frame rate) and the proxy-state summary shown in the panel.
 * No I/O here; the Electron main process owns the files and ffmpeg.
 */

export const DESKTOP_PROXY_CODECS: readonly { id: DesktopProxyCodec; label: string; extension: "mov" | "mp4" }[] = [
  { id: "prores-proxy", label: "ProRes 422 Proxy (.mov)", extension: "mov" },
  { id: "dnxhr-lb", label: "DNxHR LB (.mov)", extension: "mov" },
  { id: "h264", label: "H.264 (.mp4)", extension: "mp4" },
];

export const DESKTOP_PROXY_SIZES: readonly { id: DesktopProxySize; label: string }[] = [
  { id: "half", label: "1/2 resolution" },
  { id: "quarter", label: "1/4 resolution" },
  { id: "720p", label: "720p" },
  { id: "1080p", label: "1080p" },
];

export const DEFAULT_DESKTOP_PROXY_PROFILE: DesktopProxyProfile = { codec: "h264", size: "half" };

export const isDesktopProxyCodec = (value: unknown): value is DesktopProxyCodec => value === "prores-proxy" || value === "h264" || value === "dnxhr-lb";
export const isDesktopProxySize = (value: unknown): value is DesktopProxySize =>
  value === "half" || value === "quarter" || value === "720p" || value === "1080p";

export function isDesktopProxyProfile(value: unknown): value is DesktopProxyProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<DesktopProxyProfile>;
  return isDesktopProxyCodec(profile.codec) && isDesktopProxySize(profile.size);
}

/** Validates the persisted per-project config (every field optional). */
export function isDesktopIngestConfig(value: unknown): value is DesktopIngestConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<Record<keyof DesktopIngestConfig, unknown>>;
  if (config.proxyProfile !== undefined && !isDesktopProxyProfile(config.proxyProfile)) return false;
  if (config.proxyFolder !== undefined && (typeof config.proxyFolder !== "string" || !config.proxyFolder.trim())) return false;
  if (config.mediaFolder !== undefined && (typeof config.mediaFolder !== "string" || !config.mediaFolder.trim())) return false;
  if (config.concurrency !== undefined && config.concurrency !== 1 && config.concurrency !== 2) return false;
  if (config.proxiesWithCopy !== undefined && typeof config.proxiesWithCopy !== "boolean") return false;
  return true;
}

export const resolveDesktopProxyProfile = (project: Pick<Project, "mediaLibrary">): DesktopProxyProfile =>
  project.mediaLibrary.desktopIngest?.proxyProfile ?? DEFAULT_DESKTOP_PROXY_PROFILE;

export const resolveDesktopConcurrency = (project: Pick<Project, "mediaLibrary">): 1 | 2 =>
  project.mediaLibrary.desktopIngest?.concurrency ?? 1;

export const desktopProxyExtension = (codec: DesktopProxyCodec): "mov" | "mp4" => (codec === "h264" ? "mp4" : "mov");

export function describeDesktopProxyProfile(profile: DesktopProxyProfile): string {
  const codec = DESKTOP_PROXY_CODECS.find((entry) => entry.id === profile.codec)?.label ?? profile.codec;
  const size = DESKTOP_PROXY_SIZES.find((entry) => entry.id === profile.size)?.label ?? profile.size;
  return `${codec} · ${size}`;
}

const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2);

/** Output frame size of a proxy: even dimensions, aspect preserved, a fixed height never upscales. */
export function desktopProxyDimensions(srcWidth: number, srcHeight: number, size: DesktopProxySize): { width: number; height: number } {
  if (!(srcWidth > 0) || !(srcHeight > 0)) return { width: 0, height: 0 };
  if (size === "half") return { width: even(srcWidth / 2), height: even(srcHeight / 2) };
  if (size === "quarter") return { width: even(srcWidth / 4), height: even(srcHeight / 4) };
  const target = size === "720p" ? 720 : 1080;
  if (srcHeight <= target) return { width: even(srcWidth), height: even(srcHeight) };
  return { width: even((srcWidth * target) / srcHeight), height: target };
}

/** A file-system safe stem: no separators or characters Windows rejects. */
function safeStem(name: string): string {
  const base = name.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_").trim().replace(/^\.+/, "");
  return stem.slice(0, 80) || "media";
}

/**
 * File name of an item's proxy inside the Proxies folder. The id keeps two clips with the same name
 * apart; the trailing `_proxy` lets Attach Proxies pair the file back to its media by name.
 */
export function desktopProxyFileName(item: Pick<MediaItem, "id" | "name">, profile: DesktopProxyProfile): string {
  const shortId = item.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "x";
  return `${safeStem(item.name)}-${shortId}_${profile.size}_proxy.${desktopProxyExtension(profile.codec)}`;
}

/** Name of the H.264 preview twin that rides along with a ProRes proxy. */
export function desktopPreviewTwinName(proxyFileName: string): string {
  const dot = proxyFileName.lastIndexOf(".");
  return `${dot > 0 ? proxyFileName.slice(0, dot) : proxyFileName}.preview.mp4`;
}

/** Name for a copy-to-project file: the original name, with a counter when it is already taken. */
export function uniqueCopyName(fileName: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map((name) => name.toLowerCase()));
  if (!lower.has(fileName.toLowerCase())) return fileName;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

// ---- Relink: match files found on disk to media by name + duration + frame rate -------------

export interface RelinkTarget {
  readonly id: string;
  readonly type: MediaItem["type"];
  /** The name the file had when it was imported (falls back to the item name). */
  readonly name: string;
  readonly duration: number;
  readonly frameRate: number;
  readonly size?: number;
}

export interface RelinkCandidate {
  readonly path: string;
  readonly name: string;
  readonly size?: number;
  /** Seconds; absent when the file could not be probed. */
  readonly duration?: number;
  readonly frameRate?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface RelinkMatch {
  readonly mediaId: string;
  readonly candidate: RelinkCandidate;
  /** Lower is closer: duration delta in seconds, minus a bonus for an identical size. */
  readonly score: number;
}

export interface RelinkResult {
  readonly matches: RelinkMatch[];
  /** Media that two or more files fit equally well: reported, never guessed. */
  readonly ambiguous: Array<{ mediaId: string; candidates: RelinkCandidate[] }>;
  readonly unmatchedMediaIds: string[];
  readonly unusedCandidates: RelinkCandidate[];
}

export const RELINK_FRAME_RATE_TOLERANCE = 0.05;

export function relinkTargetFor(item: MediaItem): RelinkTarget {
  return {
    id: item.id,
    type: item.type,
    name: item.sourceFile?.name ?? item.name,
    duration: item.metadata.duration,
    frameRate: item.metadata.frameRate,
    size: item.sourceFile?.size,
  };
}

const stemKey = (fileName: string): string => {
  const base = fileName.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).trim().toLowerCase();
};

/** Key two file names are compared by when relinking: lower-case stem (a proxy also drops `_proxy`-style suffixes). */
export const relinkNameKey = (fileName: string, proxy = false): string =>
  proxy
    ? proxyMatchKey(fileName.replace(/\.preview(\.[a-z0-9]+)$/i, "$1")).replace(/-[a-z0-9]{1,8}_(half|quarter|720p|1080p)$/, "")
    : stemKey(fileName);

/** Why a candidate does or does not fit a target; `score` is null when it does not fit. */
export function scoreRelinkCandidate(
  target: RelinkTarget,
  candidate: RelinkCandidate,
  options: { proxy?: boolean } = {},
): number | null {
  if (relinkNameKey(candidate.name, options.proxy) !== relinkNameKey(target.name, options.proxy)) return null;
  let score = 0;
  if (target.type !== "image") {
    // A candidate we could not probe cannot be verified, so it never matches silently.
    if (candidate.duration === undefined || !Number.isFinite(candidate.duration)) return null;
    const limit = Math.max(0.25, target.duration * 0.01);
    const delta = Math.abs(candidate.duration - target.duration);
    if (target.duration > 0 && delta > limit) return null;
    score += delta;
  }
  if (target.type === "video" && target.frameRate > 0 && candidate.frameRate !== undefined && candidate.frameRate > 0) {
    if (Math.abs(candidate.frameRate - target.frameRate) > RELINK_FRAME_RATE_TOLERANCE) return null;
  }
  if (target.size !== undefined && candidate.size !== undefined && !options.proxy && candidate.size === target.size) score -= 0.5;
  return score;
}

/** Match files found in a folder search to the media that need them. */
export function matchRelinkCandidates(
  targets: readonly RelinkTarget[],
  candidates: readonly RelinkCandidate[],
  options: { proxy?: boolean } = {},
): RelinkResult {
  const matches: RelinkMatch[] = [];
  const ambiguous: RelinkResult["ambiguous"] = [];
  const unmatchedMediaIds: string[] = [];
  const claimed = new Map<string, string>();
  for (const target of targets) {
    const scored = candidates
      .map((candidate) => ({ candidate, score: scoreRelinkCandidate(target, candidate, options) }))
      .filter((entry): entry is { candidate: RelinkCandidate; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score);
    if (!scored.length) {
      unmatchedMediaIds.push(target.id);
      continue;
    }
    const best = scored[0];
    const tied = scored.filter((entry) => Math.abs(entry.score - best.score) < 1e-6);
    if (tied.length > 1) {
      ambiguous.push({ mediaId: target.id, candidates: tied.map((entry) => entry.candidate) });
      continue;
    }
    if (claimed.has(best.candidate.path)) {
      // Two media items cannot share one file.
      ambiguous.push({ mediaId: target.id, candidates: [best.candidate] });
      continue;
    }
    claimed.set(best.candidate.path, target.id);
    matches.push({ mediaId: target.id, candidate: best.candidate, score: best.score });
  }
  const used = new Set(matches.map((match) => match.candidate.path));
  return { matches, ambiguous, unmatchedMediaIds, unusedCandidates: candidates.filter((c) => !used.has(c.path)) };
}

// ---- Proxy state summary for the panel -----------------------------------------------------

export interface ProxyStateCounts {
  readonly total: number;
  readonly ready: number;
  readonly building: number;
  /** Proxy file or full-resolution media not found. */
  readonly missing: number;
  readonly failed: number;
  /** Video with no proxy at all. */
  readonly none: number;
}

export function summarizeProxyStates(states: readonly ProxyDisplayState[]): ProxyStateCounts {
  const counts = { total: 0, ready: 0, building: 0, missing: 0, failed: 0, none: 0 };
  for (const state of states) {
    counts.total++;
    if (state === "ready") counts.ready++;
    else if (state === "building") counts.building++;
    else if (state === "failed") counts.failed++;
    else if (state === "missing-proxy" || state === "missing-full") counts.missing++;
    else counts.none++;
  }
  return counts;
}

export function formatProxyCounts(counts: ProxyStateCounts): string {
  return [
    counts.ready ? `${counts.ready} ready` : "",
    counts.building ? `${counts.building} building` : "",
    counts.missing ? `${counts.missing} missing` : "",
    counts.failed ? `${counts.failed} failed` : "",
  ].filter(Boolean).join(" · ");
}

/** The note the export report carries on desktop, whether or not any media is proxied. */
export function describeExportSource(report: { proxiedMedia: number; message: string }, desktop: boolean): string {
  if (!desktop) return report.proxiedMedia ? report.message : "";
  const base = "Desktop export read the full-resolution source files (not proxies).";
  return report.proxiedMedia
    ? `${base} ${report.proxiedMedia} proxied clip${report.proxiedMedia === 1 ? " was" : "s were"} not used.`
    : base;
}
