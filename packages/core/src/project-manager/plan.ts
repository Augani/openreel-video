/**
 * Project Manager plan: from a project, the chosen sequences and the options to what happens to every media file
 * (copy, transcode to a preset, trim to the used ranges plus handles, or leave alone because it is offline), where
 * it lands in the new folder, and how much disk it will take. Pure: the desktop process reports what it found on
 * disk (`DiskInfo`) and runs the plan; `applyPlan` writes the result into a project.
 */
import type { MediaItem, Project } from "../types/project";
import {
  type ConcretePresetId,
  type ConsolidatePresetId,
  audioBytesPerSecond,
  presetInfo,
  resolvePreset,
  videoBytesPerSecond,
} from "./presets";
import {
  type Segment,
  type TimeRange,
  buildSegments,
  capSegmentCount,
  exactFrameRate,
  mergeRanges,
  segmentsDuration,
  snapRangeToFrames,
  withHandles,
} from "./segments";
import { collectMediaUsage } from "./usage";

export type ProjectManagerMode = "collect" | "consolidate";

export interface ProjectManagerOptions {
  readonly mode: ProjectManagerMode;
  /** Sequences to keep (nested sequences come with them). */
  readonly sequenceIds: readonly string[];
  /** Consolidate: the transcode preset. */
  readonly preset: ConsolidatePresetId;
  /** Leave out media no kept sequence plays. */
  readonly excludeUnused: boolean;
  /** Consolidate: keep only the used ranges (plus handles) of each file. */
  readonly trim: boolean;
  /** Handle length on each side of every used range, in frames. */
  readonly handleFrames: number;
  readonly includeProxies: boolean;
  /** Copy the render cache (only valid for an untrimmed copy: trimming moves every frame). */
  readonly includeRenderFiles: boolean;
  /** Consolidate: write audio as 48 kHz 24-bit PCM, the project's working format. */
  readonly includeAudioConform: boolean;
  /** Name files after the media's name in the Project panel instead of the file on disk. */
  readonly renameToClipNames: boolean;
}

export const DEFAULT_PROJECT_MANAGER_OPTIONS: Omit<ProjectManagerOptions, "sequenceIds"> = {
  mode: "collect",
  preset: "match-source",
  excludeUnused: true,
  trim: false,
  handleFrames: 12,
  includeProxies: true,
  includeRenderFiles: false,
  includeAudioConform: false,
  renameToClipNames: false,
};

/** What the desktop process found on disk for one media item. */
export interface DiskInfo {
  readonly exists: boolean;
  readonly size?: number;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly duration?: number;
  readonly hasVideo?: boolean;
  readonly hasAudio?: boolean;
  readonly videoCodec?: string;
  readonly audioChannels?: number;
  readonly sampleRate?: number;
  /** The item's proxy file (and its H.264 preview twin), when the project has one and it exists. */
  readonly proxySize?: number;
  readonly previewSize?: number;
}

export type PlannedAction = "copy" | "transcode" | "offline";

export interface PlannedProxy {
  readonly srcPath: string;
  readonly previewSrcPath?: string;
  readonly outRel: string;
  readonly previewOutRel?: string;
  readonly action: "copy" | "transcode";
  readonly size: number;
  readonly previewSize: number;
  /** Codec of the proxy file, to re-encode a trimmed copy in kind. */
  readonly codec: import("../types/project").DesktopProxyCodec;
}

export interface PlannedItem {
  readonly mediaId: string;
  readonly name: string;
  readonly kind: MediaItem["type"];
  readonly srcPath: string | null;
  readonly action: PlannedAction;
  /** Why an item is left offline. */
  readonly note?: string;
  /** Path of the new file inside the project folder (forward slashes). */
  readonly outRel: string;
  /** Set when the file is transcoded. */
  readonly preset?: ConcretePresetId;
  /** Output holds only audio (an audio file, or the audio of a video written as WAV). */
  readonly audioOnly: boolean;
  /** Kept stretches of the source, laid end to end; null keeps the whole file. */
  readonly segments: Segment[] | null;
  readonly fps: number;
  readonly sourceDuration: number;
  readonly keptSeconds: number;
  readonly conformAudio: boolean;
  /** Facts for the estimate. */
  readonly info: DiskInfo;
  readonly proxy?: PlannedProxy;
}

export interface ProjectManagerPlan {
  readonly options: ProjectManagerOptions;
  readonly sequenceIds: string[];
  readonly items: PlannedItem[];
  /** Media items left out of the copy (unused, with exclude-unused on). */
  readonly droppedMediaIds: string[];
  /** Multicam sources the kept sequences play (all of them when unused media is kept). */
  readonly multicamSourceIds: string[];
  readonly warnings: string[];
}

/** Gaps between used ranges shorter than this are kept rather than cut: a cut costs more than a second of footage. */
export const MERGE_GAP_SECONDS = 1;
/** An ffmpeg command takes one input per kept stretch. */
export const MAX_SEGMENTS_PER_FILE = 48;
/** A trim that keeps this much of a file is not worth a cut. */
const NEARLY_WHOLE = 0.98;

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || "media";
}

const stripExt = (name: string): string => name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
const extOf = (p: string): string => /\.([A-Za-z0-9]{1,5})$/.exec(p)?.[0] ?? "";
const baseNameOf = (p: string): string => p.split(/[\\/]/).pop() ?? p;

export const pathOfItem = (item: MediaItem): string | null => item.nativeSource?.path || item.sourceFile?.path || null;

function uniqueRel(dir: string, base: string, ext: string, taken: Set<string>): string {
  let n = 0;
  for (;;) {
    const name = `${dir}/${base}${n ? `_${n + 1}` : ""}${ext}`;
    const key = name.toLowerCase();
    if (!taken.has(key)) {
      taken.add(key);
      return name;
    }
    n++;
  }
}

function proxyCodecOf(item: MediaItem): PlannedProxy["codec"] {
  const profile = item.proxy?.profile?.codec;
  if (profile) return profile;
  const codec = item.proxy?.codec?.toLowerCase() ?? "";
  return codec.includes("prores") ? "prores-proxy" : codec.includes("dnx") ? "dnxhr-lb" : "h264";
}

export function planProjectManager(
  input: Project,
  options: ProjectManagerOptions,
  disk: Readonly<Record<string, DiskInfo>>,
): ProjectManagerPlan {
  const { project, sequenceIds, usage, usedItemIds, multicamSourceIds } = collectMediaUsage(input, options.sequenceIds);
  const warnings: string[] = [];
  if (sequenceIds.length === 0) throw new Error("Choose at least one sequence.");
  const sequenceFps = exactFrameRate(project.settings.frameRate) || 24;
  const trimming = options.mode === "consolidate" && options.trim;
  const taken = new Set<string>();
  const items: PlannedItem[] = [];
  const dropped: string[] = [];

  for (const item of project.mediaLibrary.items) {
    if (item.subclip) {
      // A window onto its parent's file: it has no file of its own.
      if (options.excludeUnused && !usedItemIds.has(item.id)) dropped.push(item.id);
      continue;
    }
    const referenced = usedItemIds.has(item.id) || [...project.mediaLibrary.items].some((m) => m.subclip?.parentId === item.id && usedItemIds.has(m.id));
    if (options.excludeUnused && !referenced) {
      dropped.push(item.id);
      continue;
    }
    const used = usage.get(item.id);
    const srcPath = pathOfItem(item);
    const info = disk[item.id] ?? { exists: false };
    const fileExt = extOf(srcPath ?? "") || "";
    const stem = sanitizeFileName(options.renameToClipNames ? stripExt(item.name) : stripExt(baseNameOf(srcPath ?? item.name)));
    const offline = (note: string): PlannedItem => ({
      mediaId: item.id, name: item.name, kind: item.type, srcPath, action: "offline", note, outRel: "", audioOnly: false,
      segments: null, fps: 0, sourceDuration: item.metadata.duration, keptSeconds: 0, conformAudio: false, info,
    });
    if (!srcPath) {
      warnings.push(`${item.name} has no file on disk (it only exists inside the app), so it is not copied.`);
      items.push(offline("No file on disk"));
      continue;
    }
    if (!info.exists) {
      warnings.push(`${item.name} is offline (${baseNameOf(srcPath)} not found), so it is not copied.`);
      items.push(offline("File not found"));
      continue;
    }

    const hasVideo = item.type === "video" && info.hasVideo !== false;
    const fps = hasVideo ? exactFrameRate(info.fps ?? item.metadata.frameRate) : 0;
    const duration = info.duration ?? item.metadata.duration ?? 0;

    // ---- which stretches of the file are kept ----
    let segments: Segment[] | null = null;
    if (trimming && used && !used.whole && item.type !== "image" && duration > 0 && used.ranges.length > 0) {
      const handleSeconds = Math.max(0, options.handleFrames) / (fps || sequenceFps);
      let ranges: TimeRange[] = used.ranges.map((r) => snapRangeToFrames(withHandles(r, handleSeconds, duration), fps, duration));
      ranges = mergeRanges(ranges, MERGE_GAP_SECONDS);
      if (used.single && ranges.length > 1) ranges = [{ start: ranges[0].start, end: ranges[ranges.length - 1].end }];
      ranges = capSegmentCount(ranges, MAX_SEGMENTS_PER_FILE);
      const kept = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
      if (kept < duration * NEARLY_WHOLE) segments = buildSegments(ranges);
    }
    const keptSeconds = segments ? segmentsDuration(segments) : duration;

    // ---- what happens to the file ----
    let action: PlannedAction = "copy";
    let preset: ConcretePresetId | undefined;
    let audioOnly = item.type === "audio";
    if (options.mode === "consolidate" && item.type !== "image") {
      if (hasVideo) {
        if (options.preset !== "match-source" || segments) {
          action = "transcode";
          preset = resolvePreset(options.preset, info.videoCodec ?? item.metadata.codec);
        }
      } else if (segments || options.includeAudioConform) {
        action = "transcode";
        audioOnly = true;
      }
    }
    const ext = action === "copy" ? fileExt : audioOnly ? ".wav" : `.${presetInfo(preset as ConcretePresetId).container}`;
    const outRel = uniqueRel("Media", stem, ext, taken);

    // ---- its proxy ----
    let proxy: PlannedProxy | undefined;
    const ref = item.proxy;
    if (options.includeProxies && ref && ref.storage === "path" && info.proxySize !== undefined) {
      const trimmedProxy = Boolean(segments);
      const codec = proxyCodecOf(item);
      const proxyExt = trimmedProxy ? (codec === "h264" ? ".mp4" : ".mov") : extOf(ref.path) || ".mov";
      const proxyRel = uniqueRel("Proxies", `${stripExt(baseNameOf(outRel))}_proxy`, proxyExt, taken);
      proxy = {
        srcPath: ref.path,
        ...(ref.previewPath && info.previewSize !== undefined ? { previewSrcPath: ref.previewPath, previewOutRel: proxyRel.replace(/\.[A-Za-z0-9]+$/, ".preview.mp4") } : {}),
        outRel: proxyRel,
        action: trimmedProxy ? "transcode" : "copy",
        size: info.proxySize,
        previewSize: info.previewSize ?? 0,
        codec,
      };
      if (proxy.previewOutRel) taken.add(proxy.previewOutRel.toLowerCase());
    }
    items.push({
      mediaId: item.id, name: item.name, kind: item.type, srcPath, action, outRel, ...(preset ? { preset } : {}), audioOnly,
      segments, fps, sourceDuration: duration, keptSeconds, conformAudio: options.mode === "consolidate" && options.includeAudioConform, info,
      ...(proxy ? { proxy } : {}),
    });
  }
  if (options.includeRenderFiles && trimming) warnings.push("Render files are not copied from a trimmed project: trimming moves every frame, so they could not be reused.");
  const sources = (project.multicamSources ?? []).map((m) => m.id).filter((id) => !options.excludeUnused || multicamSourceIds.has(id));
  return { options, sequenceIds, items, droppedMediaIds: dropped, multicamSourceIds: sources, warnings };
}

export interface ProjectManagerEstimate {
  readonly mediaBytes: number;
  readonly proxyBytes: number;
  readonly renderBytes: number;
  readonly totalBytes: number;
  readonly perItem: Array<{ mediaId: string; bytes: number }>;
}

/** Bytes the audio of an item takes in the output (PCM in a MOV or WAV, AAC in an MP4). */
function audioBytes(item: PlannedItem, seconds: number): number {
  const channels = item.info.audioChannels ?? 2;
  if (item.preset === "h264") return (256_000 / 8) * seconds;
  const conformed = item.conformAudio;
  return audioBytesPerSecond(channels, conformed ? 48_000 : item.info.sampleRate ?? 48_000, conformed ? 3 : 2) * seconds;
}

export function estimateItemBytes(item: PlannedItem): number {
  if (item.action === "offline") return 0;
  if (item.action === "copy") return item.info.size ?? 0;
  const seconds = item.keptSeconds;
  if (item.audioOnly) return item.info.hasAudio === false ? 0 : audioBytes(item, seconds);
  const picture = videoBytesPerSecond(item.preset as ConcretePresetId, item.info.width ?? 1920, item.info.height ?? 1080, item.fps || 24) * seconds;
  return picture + (item.info.hasAudio === false ? 0 : audioBytes(item, seconds));
}

function estimateProxyBytes(item: PlannedItem): number {
  const proxy = item.proxy;
  if (!proxy) return 0;
  const total = proxy.size + proxy.previewSize;
  if (proxy.action === "copy" || item.sourceDuration <= 0) return total;
  return total * Math.min(1, item.keptSeconds / item.sourceDuration);
}

/** `renderBytes`: size of the render cache folder when it is to be copied. */
export function estimatePlan(plan: ProjectManagerPlan, renderBytes = 0): ProjectManagerEstimate {
  const perItem = plan.items.map((item) => ({ mediaId: item.mediaId, bytes: estimateItemBytes(item) }));
  const mediaBytes = perItem.reduce((sum, p) => sum + p.bytes, 0);
  const proxyBytes = plan.items.reduce((sum, item) => sum + estimateProxyBytes(item), 0);
  const render = plan.options.includeRenderFiles && !(plan.options.mode === "consolidate" && plan.options.trim) ? renderBytes : 0;
  return { mediaBytes, proxyBytes, renderBytes: render, totalBytes: Math.round(mediaBytes + proxyBytes + render), perItem };
}
