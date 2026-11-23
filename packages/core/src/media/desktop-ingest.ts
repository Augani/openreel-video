import type {
  DesktopIngestConfig,
  DesktopProxyCodec,
  DesktopProxyProfile,
  DesktopProxySize,
  IngestChecksumAlgorithm,
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
  { id: "prores-lt", label: "ProRes 422 LT (.mov)", extension: "mov" },
  { id: "prores-422", label: "ProRes 422 (.mov)", extension: "mov" },
  { id: "dnxhr-lb", label: "DNxHR LB (.mov)", extension: "mov" },
  { id: "dnxhr-sq", label: "DNxHR SQ (.mov)", extension: "mov" },
  { id: "h264", label: "H.264 (.mp4)", extension: "mp4" },
];

export const DESKTOP_PROXY_SIZES: readonly { id: DesktopProxySize; label: string }[] = [
  { id: "full", label: "Full resolution" },
  { id: "half", label: "1/2 resolution" },
  { id: "quarter", label: "1/4 resolution" },
  { id: "720p", label: "720p" },
  { id: "1080p", label: "1080p" },
  { id: "custom", label: "Custom width" },
];

export const CUSTOM_PROXY_WIDTH_MIN = 16;
export const CUSTOM_PROXY_WIDTH_MAX = 16384;

export const INGEST_CHECKSUMS: readonly { id: IngestChecksumAlgorithm; label: string }[] = [
  { id: "sha256", label: "SHA-256" },
  { id: "md5", label: "MD5" },
  { id: "xxh64", label: "xxHash64" },
];
export const isIngestChecksum = (value: unknown): value is IngestChecksumAlgorithm => value === "sha256" || value === "md5" || value === "xxh64";

export const DEFAULT_DESKTOP_PROXY_PROFILE: DesktopProxyProfile = { codec: "h264", size: "half" };

// Plain id lists (no labels), so code that only validates a profile does not carry the UI label tables with it.
export const isDesktopProxyCodec = (value: unknown): value is DesktopProxyCodec =>
  value === "prores-proxy" || value === "prores-lt" || value === "prores-422" || value === "h264" || value === "dnxhr-lb" || value === "dnxhr-sq";
export const isDesktopProxySize = (value: unknown): value is DesktopProxySize =>
  value === "full" || value === "half" || value === "quarter" || value === "720p" || value === "1080p" || value === "custom";

export function isDesktopProxyProfile(value: unknown): value is DesktopProxyProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<DesktopProxyProfile>;
  if (!isDesktopProxyCodec(profile.codec) || !isDesktopProxySize(profile.size)) return false;
  if (profile.size === "custom") {
    const width = profile.customWidth;
    if (typeof width !== "number" || !Number.isInteger(width) || width < CUSTOM_PROXY_WIDTH_MIN || width > CUSTOM_PROXY_WIDTH_MAX) return false;
  } else if (profile.customWidth !== undefined) return false;
  if (profile.audio !== undefined && profile.audio !== "keep" && profile.audio !== "strip") return false;
  if (profile.burnIn !== undefined) {
    const burn = profile.burnIn as unknown as Record<string, unknown> | null;
    if (!burn || typeof burn !== "object") return false;
    if (burn.clipName !== undefined && typeof burn.clipName !== "boolean") return false;
    if (burn.timecode !== undefined && typeof burn.timecode !== "boolean") return false;
  }
  if (profile.destination !== undefined) {
    const dest = profile.destination as unknown as Record<string, unknown> | null;
    if (!dest || typeof dest !== "object") return false;
    if (dest.mode !== "project" && dest.mode !== "media" && dest.mode !== "custom") return false;
    if (dest.mode === "custom" && (typeof dest.folder !== "string" || !dest.folder.trim())) return false;
    if (dest.mode !== "custom" && dest.folder !== undefined) return false;
  }
  return true;
}

/** Burn-in on: a viewing copy with the clip name and / or timecode in the picture. */
export const profileHasBurnIn = (profile: DesktopProxyProfile): boolean => Boolean(profile.burnIn?.clipName || profile.burnIn?.timecode);

/** Validates the persisted per-project config (every field optional). */
export function isDesktopIngestConfig(value: unknown): value is DesktopIngestConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<Record<keyof DesktopIngestConfig, unknown>>;
  if (config.proxyProfile !== undefined && !isDesktopProxyProfile(config.proxyProfile)) return false;
  if (config.proxyFolder !== undefined && (typeof config.proxyFolder !== "string" || !config.proxyFolder.trim())) return false;
  if (config.mediaFolder !== undefined && (typeof config.mediaFolder !== "string" || !config.mediaFolder.trim())) return false;
  if (config.concurrency !== undefined && config.concurrency !== 1 && config.concurrency !== 2) return false;
  if (config.proxiesWithCopy !== undefined && typeof config.proxiesWithCopy !== "boolean") return false;
  if (config.checksum !== undefined && !isIngestChecksum(config.checksum)) return false;
  if (config.proxyPresetId !== undefined && (typeof config.proxyPresetId !== "string" || !config.proxyPresetId || config.proxyPresetId.length > 80)) return false;
  return true;
}

export const resolveDesktopProxyProfile = (project: Pick<Project, "mediaLibrary">): DesktopProxyProfile =>
  project.mediaLibrary.desktopIngest?.proxyProfile ?? DEFAULT_DESKTOP_PROXY_PROFILE;

export const resolveDesktopConcurrency = (project: Pick<Project, "mediaLibrary">): 1 | 2 =>
  project.mediaLibrary.desktopIngest?.concurrency ?? 1;

export const desktopProxyExtension = (codec: DesktopProxyCodec): "mov" | "mp4" => (codec === "h264" ? "mp4" : "mov");

export const resolveDesktopChecksum = (project: Pick<Project, "mediaLibrary">): IngestChecksumAlgorithm =>
  project.mediaLibrary.desktopIngest?.checksum ?? "sha256";

function describeSize(profile: DesktopProxyProfile): string {
  if (profile.size === "custom") return `${profile.customWidth ?? "?"} px wide`;
  return DESKTOP_PROXY_SIZES.find((entry) => entry.id === profile.size)?.label ?? profile.size;
}

export function describeDesktopProxyProfile(profile: DesktopProxyProfile): string {
  const codec = DESKTOP_PROXY_CODECS.find((entry) => entry.id === profile.codec)?.label ?? profile.codec;
  const extras = [profile.audio === "strip" ? "no audio" : "", profileHasBurnIn(profile) ? "burn-in" : ""].filter(Boolean);
  return [codec, describeSize(profile), ...extras].join(" · ");
}

const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2);

/** Output frame size of a proxy: even dimensions, aspect preserved, a fixed height never upscales. */
export function desktopProxyDimensions(srcWidth: number, srcHeight: number, size: DesktopProxySize, customWidth?: number): { width: number; height: number } {
  if (!(srcWidth > 0) || !(srcHeight > 0)) return { width: 0, height: 0 };
  if (size === "custom") {
    // A custom width never upscales; the height follows the aspect ratio.
    const width = Math.min(srcWidth, customWidth && customWidth > 0 ? customWidth : srcWidth);
    return { width: even(width), height: even((srcHeight * width) / srcWidth) };
  }
  if (size === "full") return { width: even(srcWidth), height: even(srcHeight) };
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
  return `${safeStem(item.name)}-${shortId}_${desktopProxyNameToken(profile)}_proxy.${desktopProxyExtension(profile.codec)}`;
}

/**
 * The size part of a proxy file name, plus a short tag for what else makes two proxies of one clip differ
 * (the ProRes / DNxHR flavour, burn-in, stripped audio) so presets never overwrite each other's files.
 * ProRes Proxy and H.264 keep the names they always had (an `.mp4` never collides with a `.mov`).
 */
export function desktopProxyNameToken(profile: DesktopProxyProfile): string {
  const size = profile.size === "custom" ? `w${profile.customWidth ?? 0}` : profile.size;
  const tags = [
    profile.codec === "prores-lt" ? "lt" : profile.codec === "prores-422" ? "422" : profile.codec === "dnxhr-sq" ? "sq" : profile.codec === "dnxhr-lb" ? "lb" : "",
    profile.burnIn?.clipName ? "bn" : "",
    profile.burnIn?.timecode ? "tc" : "",
    profile.audio === "strip" ? "na" : "",
  ].filter(Boolean);
  return [size, ...tags].join("-");
}

/** Matches the size token of a proxy file name (see desktopProxyNameToken). */
export const PROXY_NAME_TOKEN = "(?:half|quarter|720p|1080p|full|w\\d+)(?:-(?:lt|422|sq|lb|bn|tc|na))*";

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
    ? proxyMatchKey(fileName.replace(/\.preview(\.[a-z0-9]+)$/i, "$1")).replace(new RegExp(`-[a-z0-9]{1,8}_${PROXY_NAME_TOKEN}$`), "")
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
