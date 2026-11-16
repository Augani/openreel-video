import type { Clip, Project, Transition } from "../types";
import { frameConformFor } from "../media/interpretation";
import { getCompoundClipId, getMediaItemCapabilities, getTimelineItems } from "../timeline/timeline-items";
import type { VideoExportSettings } from "./types";

/**
 * Smart rendering: an export segment that is an untouched, contiguous run of
 * one source whose stream already matches the export format is stream-copied
 * (GOP-aligned) instead of decoded and re-encoded. This file is pure planning;
 * `smart-render-scan.ts` measures the sources; `webcodecs-backend.ts` (browser,
 * H.264) and the desktop native ffmpeg backend (H.264 / HEVC / ProRes) mux.
 */

/** Which muxer will splice the runs; the native one supports more codecs but needs matching parameters. */
export type SmartRenderEngine = "webcodecs" | "native";
export type SmartRenderCodec = "avc" | "hevc" | "prores";

const EPS = 1e-4;

const NTSC_RATES = [24000 / 1001, 30000 / 1001, 48000 / 1001, 60000 / 1001, 120000 / 1001] as const;

/**
 * The exact frame rate behind a rounded one: 29.97 is 30000/1001, and the
 * 0.003% difference is 1 ms after 30 s, enough to move a key frame to the
 * wrong output frame on a long timeline.
 */
export function snapFrameRate(fps: number): number {
  return NTSC_RATES.find((rate) => Math.abs(fps - rate) < 0.005) ?? fps;
}
/** Copy runs shorter than this are not worth two extra keyframes and parameter-set swaps. */
export const MIN_COPY_FRAMES = 12;

/** What the planner needs to know about one source stream (from `scanSourceForSmartRender`). */
export interface SmartRenderSourceInfo {
  readonly mediaId: string;
  readonly codec: SmartRenderCodec;
  readonly width: number;
  readonly height: number;
  /** Constant frame rate of the stream (frames per second). */
  readonly frameRate: number;
  /** Presentation time of the first frame; every frame sits on firstPts + k / frameRate. */
  readonly firstPts: number;
  /** End of the last frame (lastPts + frame duration). */
  readonly endTime: number;
  /** Presentation times of every key frame, ascending. */
  readonly keyframeTimes: readonly number[];
  /** No frame references across a key frame (required to cut at it). */
  readonly closedGops: boolean;
  /** Frame pts all sit on the constant-frame-rate grid. */
  readonly constantFrameRate: boolean;
  /** NAL length-prefix size of the stream (4 for every browser encoder). */
  readonly nalLengthSize: number;
  readonly rotation: number;
  /** H.264 profile_idc / HEVC general_profile_idc (absent when unknown). */
  readonly profile?: number;
  /** H.264 level_idc / HEVC general_level_idc. */
  readonly level?: number;
  /** Every frame is a key frame (ProRes, intra-only streams): any frame is a cut point. */
  readonly allIntra?: boolean;
  /** ProRes profile name of the stream; a track cannot mix ProRes profiles. */
  readonly proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
  /**
   * Colour description of the stream (absent fields mean "unspecified"). The
   * re-encoded runs are tagged BT.709 limited range, so a source in another
   * matrix or in full range would change colour at every copy/encode boundary.
   */
  readonly color?: {
    readonly matrix?: string | null;
    readonly transfer?: string | null;
    readonly primaries?: string | null;
    readonly fullRange?: boolean | null;
  };
}

export type SmartRenderSegment =
  | { readonly kind: "encode"; readonly startFrame: number; readonly endFrame: number }
  | {
      readonly kind: "copy";
      readonly startFrame: number;
      readonly endFrame: number;
      readonly mediaId: string;
      /** Source time of the first copied frame (a key frame) and the end of the last. */
      readonly sourceStart: number;
      readonly sourceEnd: number;
    };

/** Stream parameters the re-encoded runs must reproduce so they join the copied runs seamlessly. */
export type SmartRenderEncodeMatch = Pick<
  SmartRenderSourceInfo,
  "codec" | "profile" | "level" | "color" | "proresProfile" | "allIntra" | "frameRate"
>;

export interface SmartRenderPlan {
  readonly eligible: boolean;
  /** Native engine only: parameters the encode runs adopt from the copied sources. */
  readonly encodeMatch?: SmartRenderEncodeMatch;
  readonly segments: readonly SmartRenderSegment[];
  readonly totalFrames: number;
  readonly copiedFrames: number;
  readonly reencodedFrames: number;
  /** Share of output frames that are stream-copied, 0..100. */
  readonly copiedPercent: number;
  /** Why nothing (or less) was copied; for the export report. */
  readonly reasons: readonly string[];
}

export interface SmartRenderPlanInput {
  readonly project: Project;
  readonly settings: Pick<
    VideoExportSettings,
    "format" | "codec" | "width" | "height" | "frameRate" | "pixelFormat" | "colorDepth" | "upscaling"
  > &
    Partial<Pick<VideoExportSettings, "proresProfile">>;
  /** Defaults to "webcodecs" (H.264 only). */
  readonly engine?: SmartRenderEngine;
  readonly sources: ReadonlyMap<string, SmartRenderSourceInfo>;
  readonly exportStart: number;
  readonly totalFrames: number;
}

const noPlan = (totalFrames: number, reasons: readonly string[]): SmartRenderPlan => ({
  eligible: false,
  segments: totalFrames > 0 ? [{ kind: "encode", startFrame: 0, endFrame: totalFrames }] : [],
  totalFrames,
  copiedFrames: 0,
  reencodedFrames: totalFrames,
  copiedPercent: 0,
  reasons,
});

/** The plan for an export that turned out not to be smart-renderable after all: everything is re-encoded. */
export function declineSmartRender(plan: SmartRenderPlan, reason: string): SmartRenderPlan {
  return noPlan(plan.totalFrames, [...plan.reasons, reason]);
}

const isNeutralTransform = (clip: Clip): boolean => {
  const t = clip.transform;
  return (
    t.position.x === 0 &&
    t.position.y === 0 &&
    t.scale.x === 1 &&
    t.scale.y === 1 &&
    t.rotation === 0 &&
    t.opacity === 1 &&
    !t.borderRadius &&
    !t.crop &&
    !t.rotate3d &&
    !t.perspective
  );
};

/** Why this clip cannot be stream-copied, or null when it is untouched. */
export function clipTouchedReason(project: Project, clip: Clip): string | null {
  if (getCompoundClipId(clip)) return "nested sequence";
  if (clip.effects.some((effect) => effect.enabled)) return "effects";
  if (clip.colorGrading && Object.keys(clip.colorGrading).length > 0) return "color grading";
  if (!isNeutralTransform(clip)) return "transform or opacity";
  if (clip.blendMode && clip.blendMode !== "normal") return "blend mode";
  if (clip.blendOpacity !== undefined && clip.blendOpacity !== 1) return "blend opacity";
  if (clip.keyframes.length > 0) return "keyframes";
  if ((clip.speed ?? 1) !== 1 || clip.reversed) return "speed";
  if (clip.speedKeyframes && clip.speedKeyframes.length > 0) return "speed ramp";
  if (clip.freezeFrames && clip.freezeFrames.length > 0) return "freeze frame";
  if (clip.stabilization?.enabled) return "stabilization";
  if (clip.chromaKey?.enabled) return "chroma key";
  if (clip.emphasisAnimation) return "emphasis animation";
  if (clip.smoothSlowMo) return "slow motion";
  const media = project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
  if (media && media.type === "video" && frameConformFor(media)) return "pixel aspect ratio / field order";
  if (project.settings.pixelAspectRatio !== undefined && project.settings.pixelAspectRatio !== 1) return "sequence pixel aspect ratio";
  if (project.masks?.some((mask) => mask.clipId === clip.id)) return "mask";
  if (project.particleEffects?.some((effect) => effect.clipId === clip.id)) return "particles";
  return null;
}

const clipHasTransition = (transitions: readonly Transition[], clipId: string): boolean =>
  transitions.some((transition) => transition.clipAId === clipId || transition.clipBId === clipId);

interface Interval {
  readonly a: number;
  readonly b: number;
}

function subtract(base: Interval, cuts: readonly Interval[]): Interval[] {
  let pieces: Interval[] = [base];
  for (const cut of cuts) {
    const next: Interval[] = [];
    for (const piece of pieces) {
      if (cut.b <= piece.a + EPS || cut.a >= piece.b - EPS) {
        next.push(piece);
        continue;
      }
      if (cut.a > piece.a + EPS) next.push({ a: piece.a, b: cut.a });
      if (cut.b < piece.b - EPS) next.push({ a: cut.b, b: piece.b });
    }
    pieces = next;
  }
  return pieces;
}

/**
 * How far a source's frame times may sit from the output frame grid and still be copied in place.
 * Container start times are quantised (an mp4 edit list is in 1 ms ticks, so a 1.4014 s start is stored as
 * 1.401 s), and a source that starts at a nonzero time (edit-list or timecode offset, MPEG-TS) is rarely
 * exactly on the grid. The tolerance is 0.02 of a frame (the constant-frame-rate tolerance of the source
 * scan) or 0.6 ms, whichever is larger, so high frame rates keep the same absolute slack.
 */
const gridToleranceFrames = (fps: number): number => Math.max(0.02, 0.0006 * fps);

/** The frame decoder's tolerance when it picks "the last frame at or before t" (see ExportFrameDecoder). */
const RENDER_PICK_TOLERANCE_S = 1e-8;

/** True when the source time `sourceTime`, shifted by `offset`, lands on an output frame time (within the grid tolerance). */
const onOutputGrid = (sourceTime: number, offset: number, fps: number): boolean => {
  const n = (sourceTime - offset) * fps;
  return Math.abs(n - Math.round(n)) < gridToleranceFrames(fps);
};

const NATIVE_CODEC: Record<string, SmartRenderCodec | undefined> = {
  h264: "avc",
  h265: "hevc",
  hevc: "hevc",
  prores: "prores",
};
const NATIVE_COLOR_MATRIX = new Set(["bt709", "smpte170m", "bt470bg"]);
const NATIVE_COLOR_TRANSFER = new Set(["bt709", "smpte170m", "iec61966-2-1"]);
const NATIVE_COLOR_PRIMARIES = new Set(["bt709", "smpte170m", "bt470bg"]);
/** H.264 profile_idc values that are 8-bit 4:2:0 (Baseline, Main, Extended, High). */
const AVC_8BIT_420_PROFILES = new Set([66, 77, 88, 100]);

const SMART_COPY_SCOPE = "smart render copies 8-bit 4:2:0 SDR sources only";
const HDR_TRANSFERS = new Set(["pq", "hlg", "smpte2084", "arib-std-b67"]);
const WIDE_GAMUT = new Set(["bt2020", "bt2020nc", "bt2020-ncl", "bt2020c", "bt2020-cl", "2020_ncl", "2020_cl"]);

/** "HDR (PQ)" / "HDR (HLG)" / "BT.2020 wide gamut" when the colour tags say the source is not plain SDR; else null. */
export function hdrDescription(color: { matrix?: string | null; transfer?: string | null; primaries?: string | null } | undefined): string | null {
  const transfer = color?.transfer ?? undefined;
  if (transfer && HDR_TRANSFERS.has(transfer)) return transfer === "pq" || transfer === "smpte2084" ? "HDR (PQ)" : "HDR (HLG)";
  if ((color?.primaries && WIDE_GAMUT.has(color.primaries)) || (color?.matrix && WIDE_GAMUT.has(color.matrix))) return "BT.2020 wide gamut";
  return null;
}

/**
 * The bit depth / chroma format the stream profile implies, as a decline
 * reason, or null for 8-bit 4:2:0 (and unknown). H.264: High 10 (110), High
 * 4:2:2 (122), High 4:4:4 (244, 44). HEVC: Main 10 (2), range extensions (4).
 */
export function profileFormatReason(codec: "avc" | "hevc", profile: number | undefined): string | null {
  if (profile === undefined) return null;
  if (codec === "avc") {
    if (profile === 110) return `source is 10-bit (H.264 High 10); ${SMART_COPY_SCOPE}`;
    if (profile === 122) return `source is 4:2:2 (H.264 High 4:2:2, usually 10-bit); ${SMART_COPY_SCOPE}`;
    if (profile === 244 || profile === 44) return `source is 4:4:4 (H.264 High 4:4:4); ${SMART_COPY_SCOPE}`;
    return null;
  }
  if (profile === 2) return `source is 10-bit (HEVC Main 10); ${SMART_COPY_SCOPE}`;
  if (profile === 4) return `source uses HEVC range extensions (4:2:2, 4:4:4 or more than 10 bits); ${SMART_COPY_SCOPE}`;
  if (profile === 3) return `source is an HEVC still-picture profile; ${SMART_COPY_SCOPE}`;
  return null;
}

/** Settings-level gate: the export must look like the source stream. */
export function settingsMatchSource(
  settings: SmartRenderPlanInput["settings"],
  source: SmartRenderSourceInfo,
  engine: SmartRenderEngine = "webcodecs",
): string | null {
  if (engine === "native") return nativeSettingsMismatch(settings, source);
  if (settings.codec !== "h264" || source.codec !== "avc") return "codec differs from the source";
  if (settings.format !== "mp4" && settings.format !== "mov") return "container cannot carry stream-copied H.264";
  if (settings.width !== source.width || settings.height !== source.height) return "resolution differs from the source";
  if (Math.abs(settings.frameRate - source.frameRate) > 0.01) return "frame rate differs from the source";
  if (settings.pixelFormat && settings.pixelFormat !== "yuv420") return "pixel format differs from the source";
  if (settings.colorDepth && settings.colorDepth !== 8) return "bit depth differs from the source";
  if (settings.upscaling?.enabled) return "upscaling is on";
  if (source.rotation !== 0) return "source is rotated";
  const color = source.color;
  if (color?.fullRange === true) return "source is full-range";
  if (color?.matrix && color.matrix !== "bt709") return "source color matrix differs";
  if (color?.transfer && color.transfer !== "bt709" && color.transfer !== "iec61966-2-1") return "source transfer function differs";
  if (source.nalLengthSize !== 4) return "unsupported NAL length size";
  if (!source.closedGops) return "source uses open GOPs";
  if (!source.constantFrameRate) return "source is variable frame rate";
  return null;
}

/**
 * Native ffmpeg engine gate. The re-encoded runs are produced by a different
 * encoder than the camera's, so beyond the picture format the stream
 * parameters the encoder can reproduce (profile, 8-bit 4:2:0, colour tags)
 * have to match; otherwise the whole export is re-encoded and the reason is
 * reported.
 */
function nativeSettingsMismatch(settings: SmartRenderPlanInput["settings"], source: SmartRenderSourceInfo): string | null {
  const wanted = NATIVE_CODEC[settings.codec];
  if (!wanted || wanted !== source.codec) return "codec differs from the source";
  if (source.codec === "prores") {
    if (settings.format !== "mov") return "container cannot carry stream-copied ProRes";
  } else if (settings.format !== "mp4" && settings.format !== "mov") {
    return `container cannot carry stream-copied ${source.codec === "avc" ? "H.264" : "HEVC"}`;
  }
  if (settings.width !== source.width || settings.height !== source.height) return "resolution differs from the source";
  if (Math.abs(settings.frameRate - source.frameRate) > 0.01) return "frame rate differs from the source";
  if (settings.upscaling?.enabled) return "upscaling is on";
  if (source.rotation !== 0) return "source is rotated";
  if (source.codec === "prores") {
    if (source.proresProfile === "4444" || source.proresProfile === "4444xq") {
      return "source is ProRes 4444 (4:4:4, alpha-capable); the encoder writes 4:2:2, so smart render copies ProRes 422 sources only";
    }
    if ((settings.proresProfile ?? "hq") !== source.proresProfile) return "ProRes profile differs from the source";
    const hdr = hdrDescription(source.color);
    if (hdr) return `source is ${hdr}; ${SMART_COPY_SCOPE}`;
  } else {
    if (settings.pixelFormat && settings.pixelFormat !== "yuv420") return "pixel format differs from the source";
    if (settings.colorDepth && settings.colorDepth !== 8) return "bit depth differs from the source";
    const format = profileFormatReason(source.codec, source.profile);
    if (format) return format;
    const hdr = hdrDescription(source.color);
    if (hdr) return `source is ${hdr}; ${SMART_COPY_SCOPE}`;
    if (source.codec === "avc" && (source.profile === undefined || !AVC_8BIT_420_PROFILES.has(source.profile))) {
      return "source H.264 profile is not 8-bit 4:2:0 (the encoder cannot match its parameters)";
    }
    if (source.codec === "hevc" && source.profile !== 1) {
      return "source HEVC profile is not Main 8-bit 4:2:0 (the encoder cannot match its parameters)";
    }
    if (source.level === undefined) return "source stream level is unknown";
    const color = source.color;
    if (color?.fullRange === true) return "source is full-range";
    if (color?.matrix && !NATIVE_COLOR_MATRIX.has(color.matrix)) return "source color matrix differs";
    if (color?.transfer && !NATIVE_COLOR_TRANSFER.has(color.transfer)) return "source transfer function differs";
    if (color?.primaries && !NATIVE_COLOR_PRIMARIES.has(color.primaries)) return "source color primaries differ";
  }
  if (!source.closedGops && !source.allIntra) return "source uses open GOPs";
  if (!source.constantFrameRate) return "source is variable frame rate";
  return null;
}

/** How ffmpeg decodes a source's video: the ground truth the native muxer checks the plan against. */
export interface SmartRenderSourceProbe {
  /** ffmpeg codec name ("h264", "hevc"). */
  readonly codec: string;
  /** Decoder pixel format ("yuv420p", "yuv420p10le", "yuvj420p"). */
  readonly pixelFormat: string;
  /** Colour tags as ffmpeg names them; absent when the stream does not say. */
  readonly color: { readonly range?: string; readonly matrix?: string; readonly primaries?: string; readonly transfer?: string };
}

/**
 * Why a source cannot be stream-copied next to re-encoded runs, judged from
 * what ffmpeg actually decodes (container and SPS/VUI colour tags both count),
 * or null. The scan in the renderer cannot see SPS colour tags.
 */
export function nativeProbeMismatch(probe: SmartRenderSourceProbe, codec: "avc" | "hevc" | "prores"): string | null {
  const expected = codec === "avc" ? "h264" : codec;
  if (probe.codec !== expected) return "ffmpeg reads a different codec than the scan did";
  const { range, matrix, primaries, transfer } = probe.color;
  const hdr = hdrDescription({ matrix, primaries, transfer });
  if (codec === "prores") {
    if (probe.pixelFormat !== "yuv422p10le") return `source pixel format ${probe.pixelFormat} is not ProRes 4:2:2 10-bit; ${SMART_COPY_SCOPE.replace("8-bit 4:2:0 SDR sources", "ProRes 422 SDR sources")}`;
    return hdr ? `source is ${hdr}; ${SMART_COPY_SCOPE}` : null;
  }
  if (probe.pixelFormat !== "yuv420p") return `source pixel format ${probe.pixelFormat} (${describePixelFormat(probe.pixelFormat)}); ${SMART_COPY_SCOPE}`;
  if (hdr) return `source is ${hdr}; ${SMART_COPY_SCOPE}`;
  if (range === "pc") return "source is full-range";
  if (matrix && !NATIVE_COLOR_MATRIX.has(matrix)) return "source color matrix differs";
  if (transfer && !NATIVE_COLOR_TRANSFER.has(transfer)) return "source transfer function differs";
  if (primaries && !NATIVE_COLOR_PRIMARIES.has(primaries)) return "source color primaries differ";
  return null;
}

/** "10-bit 4:2:2" for an ffmpeg pixel format name (yuv422p10le, yuvj420p, nv12...). */
export function describePixelFormat(pixelFormat: string): string {
  // Semi-planar high bit depth formats (p010le = 10-bit 4:2:0, p210le = 4:2:2, p410le = 4:4:4).
  const semiPlanar = /^p([024])(\d)(\d)(?:le|be)$/.exec(pixelFormat);
  if (semiPlanar) {
    const chroma = semiPlanar[1] === "0" ? "4:2:0" : semiPlanar[1] === "2" ? "4:2:2" : "4:4:4";
    return `${Number(semiPlanar[2] + semiPlanar[3])}-bit ${chroma}`;
  }
  const bits = /p(\d{2})(?:le|be)?$/.exec(pixelFormat)?.[1];
  const chroma = /^yuvj?a?(420|422|444|440|411)/.exec(pixelFormat)?.[1] ?? (/^(nv12|nv21)$/.test(pixelFormat) ? "420" : undefined);
  const depth = bits ? `${Number(bits)}-bit` : "8-bit";
  const subsampling = chroma ? `4:${chroma[1]}:${chroma[2]}` : undefined;
  if (pixelFormat.startsWith("yuvj")) return `${depth} full-range ${subsampling ?? "YUV"}`;
  return [depth, subsampling].filter(Boolean).join(" ");
}

/** Sources can share one output track only when these stream parameters agree. */
export function smartRenderCompatKey(source: SmartRenderSourceInfo): string {
  const c = source.color;
  return [source.codec, source.profile ?? "", source.level ?? "", source.proresProfile ?? "", c?.matrix ?? "", c?.transfer ?? "", c?.primaries ?? ""].join("|");
}

/**
 * Split the export into copy and encode segments. Copy segments are runs of
 * whole GOPs of one source; everything else (partial GOPs at the edges of a
 * run, edited clips, gaps, overlays) is encoded. Frame indices are output
 * frames at `settings.frameRate`.
 */
export function planSmartRender(input: SmartRenderPlanInput): SmartRenderPlan {
  const { project, settings, sources, exportStart, totalFrames } = input;
  const engine = input.engine ?? "webcodecs";
  const fps = snapFrameRate(settings.frameRate);
  if (totalFrames <= 0) return noPlan(0, ["empty export"]);
  if (settings.upscaling?.enabled) return noPlan(totalFrames, ["upscaling is on"]);
  if (project.settings.width !== settings.width || project.settings.height !== settings.height) {
    return noPlan(totalFrames, ["export resolution differs from the project canvas"]);
  }

  const items = getTimelineItems(project);
  const hiddenTracks = new Set(project.timeline.tracks.filter((track) => track.hidden).map((track) => track.id));
  const visualItems = items.filter((item) => {
    if (hiddenTracks.has(item.trackId)) return false;
    if (item.kind !== "media") return true;
    if (getCompoundClipId(item.item)) return true;
    return !item.mediaItem || getMediaItemCapabilities(item.mediaItem).visual;
  });

  const reasons: string[] = [];
  const copies: Extract<SmartRenderSegment, { kind: "copy" }>[] = [];

  for (const item of items) {
    if (item.kind !== "media" || hiddenTracks.has(item.trackId)) continue;
    const clip = item.item;
    const media = item.mediaItem;
    if (!media || media.type !== "video" || !media.blob || !getMediaItemCapabilities(media).visual) continue;
    const source = sources.get(media.id);
    if (!source) {
      reasons.push(`${media.name}: not scanned or its codec cannot be stream-copied`);
      continue;
    }
    const mismatch = settingsMatchSource(settings, source, engine);
    if (mismatch) {
      reasons.push(`${media.name}: ${mismatch}`);
      continue;
    }
    const track = project.timeline.tracks.find((candidate) => candidate.id === item.trackId);
    const touched =
      clipTouchedReason(project, clip) ?? (track && clipHasTransition(track.transitions, clip.id) ? "transition" : null);
    if (touched) {
      reasons.push(`${media.name}: ${touched}`);
      continue;
    }
    // The source's frames must line up with the output frame grid: a clip placed or
    // trimmed off-grid is resampled by the renderer, which a copy cannot do. Source
    // times are the file's own presentation times (the renderer decodes at those), so
    // a stream that starts at firstPts > 0 is aligned when its frames fall on the grid
    // shifted by `offset`; firstPts itself need not be a whole number of frames.
    const offset = clip.inPoint - clip.startTime + exportStart; // source time = output time + offset
    if (!onOutputGrid(source.firstPts, offset, fps)) {
      reasons.push(`${media.name}: clip is not aligned to the frame grid`);
      continue;
    }
    // Output frame that shows the source's first frame: the renderer shows, at output frame n, the last source
    // frame at or before n / fps + offset, so source frame k is first shown at n0 + k. Copied frames must land
    // exactly there or the seam against the re-encoded frames next to them repeats or drops a frame.
    const firstOutputFrame = Math.ceil((source.firstPts - offset) * fps - RENDER_PICK_TOLERANCE_S * fps);
    const outputFrameOf = (sourceTime: number): number => firstOutputFrame + Math.round((sourceTime - source.firstPts) * fps);

    const exportEnd = exportStart + totalFrames / fps;
    // A clip (or the source) that ends a hair before the grid still shows its last frame: a container-quantised
    // end (1 ms ticks) sits up to the grid tolerance early, so allow it or the final key frame interval is re-encoded.
    const gridSlack = gridToleranceFrames(fps) / fps;
    const span: Interval = {
      a: Math.max(clip.startTime, exportStart),
      b: Math.min(clip.startTime + clip.duration + gridSlack, exportEnd, clip.startTime + (source.endTime - clip.inPoint) + gridSlack),
    };
    if (span.b - span.a < EPS) continue;
    const covers: Interval[] = [
      ...visualItems
        .filter((other) => other.id !== clip.id && other.startTime < span.b - EPS && other.startTime + other.duration > span.a + EPS)
        .map((other) => ({ a: other.startTime, b: other.startTime + other.duration })),
      // Burned-in captions are drawn over the picture while they are on screen.
      ...(project.timeline.subtitles ?? [])
        .filter((subtitle) => subtitle.startTime < span.b - EPS && subtitle.endTime > span.a + EPS)
        .map((subtitle) => ({ a: subtitle.startTime, b: subtitle.endTime })),
    ];
    for (const free of subtract(span, covers)) {
      // Whole output frames inside the free interval.
      const firstFrame = Math.ceil((free.a - exportStart) * fps - 1e-3);
      const lastFrame = Math.floor((free.b - exportStart) * fps + 1e-3);
      if (lastFrame - firstFrame < MIN_COPY_FRAMES) continue;
      // First key frame shown at or after the first free output frame; last cut point shown at or before the last.
      const keyA = source.keyframeTimes.find((time) => outputFrameOf(time) >= firstFrame);
      let keyB: number | undefined;
      if (lastFrame >= outputFrameOf(source.endTime)) keyB = source.endTime;
      else for (const time of source.keyframeTimes) if (outputFrameOf(time) <= lastFrame) keyB = time;
      if (keyA === undefined || keyB === undefined || keyB <= keyA + EPS) continue;
      const startFrame = outputFrameOf(keyA);
      const endFrame = outputFrameOf(keyB);
      if (endFrame - startFrame < MIN_COPY_FRAMES) continue;
      copies.push({ kind: "copy", startFrame, endFrame, mediaId: media.id, sourceStart: keyA, sourceEnd: keyB });
    }
  }

  let keptCopies = copies;
  let encodeMatch: SmartRenderEncodeMatch | undefined;
  if (engine === "native" && copies.length > 0) {
    // One output track carries one set of stream parameters: keep the
    // compatible group that saves the most frames, re-encode the rest.
    const framesByKey = new Map<string, number>();
    for (const copy of copies) {
      const key = smartRenderCompatKey(sources.get(copy.mediaId)!);
      framesByKey.set(key, (framesByKey.get(key) ?? 0) + copy.endFrame - copy.startFrame);
    }
    const [bestKey] = [...framesByKey.entries()].sort((a, b) => b[1] - a[1])[0];
    keptCopies = copies.filter((copy) => smartRenderCompatKey(sources.get(copy.mediaId)!) === bestKey);
    if (keptCopies.length < copies.length) {
      reasons.push("some sources have different stream parameters (profile, level or colour) and are re-encoded");
    }
    const first = sources.get(keptCopies[0].mediaId)!;
    encodeMatch = {
      codec: first.codec,
      profile: first.profile,
      level: first.level,
      color: first.color,
      proresProfile: first.proresProfile,
      allIntra: first.allIntra,
      frameRate: first.frameRate,
    };
  }

  keptCopies.sort((x, y) => x.startFrame - y.startFrame);
  const segments: SmartRenderSegment[] = [];
  let cursor = 0;
  let copiedFrames = 0;
  for (const copy of keptCopies) {
    if (copy.startFrame < cursor || copy.endFrame > totalFrames) continue;
    if (copy.startFrame > cursor) segments.push({ kind: "encode", startFrame: cursor, endFrame: copy.startFrame });
    segments.push(copy);
    copiedFrames += copy.endFrame - copy.startFrame;
    cursor = copy.endFrame;
  }
  if (cursor < totalFrames) segments.push({ kind: "encode", startFrame: cursor, endFrame: totalFrames });
  // One reason per distinct message: a clip split into many pieces would otherwise repeat it.
  const uniqueReasons = [...new Set(reasons)];
  if (copiedFrames === 0) {
    return noPlan(totalFrames, uniqueReasons.length ? uniqueReasons : ["no untouched run long enough to copy"]);
  }
  return {
    eligible: true,
    ...(encodeMatch ? { encodeMatch } : {}),
    segments,
    totalFrames,
    copiedFrames,
    reencodedFrames: totalFrames - copiedFrames,
    copiedPercent: (copiedFrames / totalFrames) * 100,
    reasons: uniqueReasons,
  };
}

/** "Smart render: 62% copied" for the export report and queue jobs. */
export function formatSmartRenderSummary(copiedFrames: number, totalFrames: number): string {
  const percent = totalFrames > 0 ? Math.round((copiedFrames / totalFrames) * 100) : 0;
  return `Smart render: ${percent}% copied`;
}
