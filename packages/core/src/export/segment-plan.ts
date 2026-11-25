import type { Project } from "../types/project";
import type { VideoExportSettings } from "./types";

/**
 * Parallel segment export (desktop). The timeline is cut at frame boundaries into segments that separate workers
 * render and encode on their own, and the pieces are joined with a lossless stream copy.
 *
 * Everything here is pure. The boundaries depend only on the project and the export settings, never on the machine
 * (the worker count only decides how many segments run at once), so the same export produces the same file on a
 * 4-core laptop and a 16-core desktop, and running the same plan one segment at a time is the serial reference.
 */
export interface ExportSegment {
  readonly index: number;
  /** First export frame of the segment (relative to the export start). */
  readonly startFrame: number;
  /** One past the last export frame. */
  readonly endFrame: number;
}

export interface SegmentSpan {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly reason: string;
}

export interface SegmentPlanInput {
  readonly totalFrames: number;
  /** Frames at which a clip starts or ends: preferred places to cut, since the picture changes there anyway. */
  readonly cutFrames: readonly number[];
  /** Frame spans a boundary must not fall inside (a render that depends on the frames before it). */
  readonly forbiddenSpans?: readonly SegmentSpan[];
  /** Wanted segment length. */
  readonly targetSegmentFrames: number;
  /** A segment is never shorter than this. */
  readonly minSegmentFrames?: number;
}

export interface SegmentPlan {
  readonly segments: readonly ExportSegment[];
  /** Why the whole export has to stay one stream (empty when `segments` has at least two). */
  readonly reasons: readonly string[];
}

const frameInSpan = (frame: number, spans: readonly SegmentSpan[]): SegmentSpan | undefined =>
  spans.find((span) => frame > span.startFrame && frame < span.endFrame);

/**
 * Cut `[0, totalFrames)` into segments of about `targetSegmentFrames`. Each boundary is the clip edge nearest to the
 * ideal position (within a third of the target), else the ideal frame itself, moved out of any forbidden span.
 * Fewer than two segments means "do not split".
 */
export function planSegments(input: SegmentPlanInput): SegmentPlan {
  const total = Math.max(0, Math.floor(input.totalFrames));
  const target = Math.max(1, Math.floor(input.targetSegmentFrames));
  const minLength = Math.max(1, Math.floor(input.minSegmentFrames ?? Math.floor(target / 2)));
  const spans = input.forbiddenSpans ?? [];
  const reasons: string[] = [];
  if (total < target + minLength) {
    return { segments: [{ index: 0, startFrame: 0, endFrame: total }], reasons: ["The export is too short to be worth splitting."] };
  }
  const cuts = [...new Set(input.cutFrames.map((frame) => Math.round(frame)))].filter((frame) => frame > 0 && frame < total).sort((a, b) => a - b);
  const boundaries: number[] = [];
  let previous = 0;
  let blocked = false;
  for (let ideal = target; ideal < total; ideal += target) {
    const window = Math.floor(target / 3);
    let best = cuts
      .filter((frame) => Math.abs(frame - ideal) <= window && frame - previous >= minLength && !frameInSpan(frame, spans))
      .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal) || a - b)[0];
    if (best === undefined) {
      let candidate = Math.max(ideal, previous + minLength);
      const span = frameInSpan(candidate, spans);
      if (span) {
        blocked = true;
        candidate = span.endFrame;
      }
      best = candidate;
    }
    if (best <= previous || best >= total || total - best < minLength) continue;
    if (frameInSpan(best, spans)) continue;
    boundaries.push(best);
    previous = best;
    ideal = Math.max(ideal, best);
  }
  if (blocked) reasons.push("Some cuts were moved because a clip renders from the frames before it.");
  if (boundaries.length === 0) {
    return { segments: [{ index: 0, startFrame: 0, endFrame: total }], reasons: reasons.length ? reasons : ["No safe place to cut the timeline."] };
  }
  const edges = [0, ...boundaries, total];
  const segments = edges.slice(0, -1).map((startFrame, index): ExportSegment => ({ index, startFrame, endFrame: edges[index + 1] }));
  return { segments, reasons: [] };
}

/** Effects that read the frames rendered before them, so a frame cannot be rendered without its predecessors. */
const HISTORY_EFFECT = /feedback|trail|accumul|recursive|temporal-?denoise|frame-?blend-?history/i;

export interface SegmentEligibilityInput {
  readonly project: Project;
  readonly settings: VideoExportSettings;
}

export interface SegmentInputs {
  readonly totalFrames: number;
  readonly cutFrames: number[];
  readonly forbiddenSpans: SegmentSpan[];
}

/** Why this export must not be split, or null when it may be. */
export function segmentExportBlocker(settings: VideoExportSettings): string | null {
  if (settings.parallelSegments === "off") return "Parallel segments are turned off.";
  if (settings.segmentWindow) return "This is already a segment of a parallel export.";
  const codec = settings.codec as string;
  if (codec !== "h264" && codec !== "h265" && codec !== "hevc" && codec !== "prores") {
    return `${codec.toUpperCase()} is encoded as one stream.`;
  }
  if (codec === "prores" && (settings.proresProfile === "4444" || settings.proresProfile === "4444xq")) return "ProRes 4444 is encoded as one stream.";
  if (settings.rateControl === "vbr2") return "Two-pass VBR needs the whole timeline in one encode.";
  if (settings.hdr && settings.hdr !== "none") return "HDR output is encoded as one stream.";
  if (settings.colorDepth && settings.colorDepth > 8) return "10-bit output is encoded as one stream.";
  if (settings.upscaling?.enabled) return "AI upscaling keeps state between frames.";
  if (settings.captions) {
    const embedded = (settings.captions as { tracks?: Array<{ embed?: unknown }> }).tracks;
    if (Array.isArray(embedded) && embedded.some((track) => track.embed)) return "Embedded captions are written by one encode.";
  }
  if (settings.broadcast) return "Broadcast delivery is written by one encode.";
  if (settings.format !== "mp4" && settings.format !== "mov") return `${settings.format.toUpperCase()} is written by one encode.`;
  // Smart render copies untouched source runs on the desktop (always for ProRes, with the "smallest" encode mode for H.264 / HEVC).
  const smartMayApply = settings.smartRender !== false && (codec === "prores" || settings.encodeMode === "smallest");
  if (smartMayApply) return "Smart render may copy parts of the sources; turn it off to render in parallel segments.";
  return null;
}

/**
 * The length the export engine renders for `project`: the end of the last clip, of an overlay (text, shape, SVG,
 * sticker) on this timeline's own tracks, or of a subtitle. This is the engine's own rule, not `timeline.duration`
 * (which also counts adjustment layers, nests and motion instances), so the segments tile exactly the frames the
 * workers produce.
 */
export function exportTimelineDuration(project: Project): number {
  let end = 0;
  const trackIds = new Set(project.timeline.tracks.map((track) => track.id));
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.startTime + clip.duration);
  }
  const overlays: ReadonlyArray<ReadonlyArray<{ trackId: string; startTime: number; duration: number }> | undefined> = [
    project.textClips,
    project.shapeClips,
    project.svgClips,
    project.stickerClips,
  ];
  for (const list of overlays) {
    for (const overlay of list ?? []) {
      if (trackIds.has(overlay.trackId)) end = Math.max(end, overlay.startTime + overlay.duration);
    }
  }
  for (const subtitle of project.timeline.subtitles ?? []) end = Math.max(end, subtitle.endTime);
  return end;
}

/** Cut candidates and no-cut spans of a project for `settings`, in export frames. */
export function segmentInputsFor(project: Project, settings: VideoExportSettings): SegmentInputs {
  const fps = settings.frameRate;
  const rangeStart = settings.range?.startTime ?? 0;
  const timelineEnd = exportTimelineDuration(project);
  const rangeEnd = Math.min(settings.range?.endTime ?? timelineEnd, timelineEnd);
  const totalFrames = Math.max(1, Math.ceil((rangeEnd - rangeStart) * fps - 1e-7));
  const toFrame = (time: number): number => Math.round((time - rangeStart) * fps);
  const cutFrames: number[] = [];
  const forbiddenSpans: SegmentSpan[] = [];
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      cutFrames.push(toFrame(clip.startTime), toFrame(clip.startTime + clip.duration));
      const history = clip.effects.find((effect) => effect.enabled && HISTORY_EFFECT.test(effect.type));
      if (history) {
        forbiddenSpans.push({
          startFrame: toFrame(clip.startTime),
          endFrame: toFrame(clip.startTime + clip.duration),
          reason: `${history.type} renders from the frames before it`,
        });
      }
    }
  }
  return { totalFrames, cutFrames, forbiddenSpans };
}

/** Seconds of video per segment: long enough that the per-segment start-up (decoder seek, encoder spin-up) stays small. */
export const TARGET_SEGMENT_SECONDS = 6;
export const MIN_PARALLEL_SECONDS = 12;

export interface SegmentDecision {
  readonly parallel: boolean;
  readonly segments: readonly ExportSegment[];
  readonly reasons: readonly string[];
}

/** Whether and how to split an export. `parallel` is false whenever the export must stay one stream. */
export function decideSegments(project: Project, settings: VideoExportSettings): SegmentDecision {
  const blocker = segmentExportBlocker(settings);
  if (blocker) return { parallel: false, segments: [], reasons: [blocker] };
  const inputs = segmentInputsFor(project, settings);
  const fps = settings.frameRate;
  if (inputs.totalFrames < MIN_PARALLEL_SECONDS * fps) {
    return { parallel: false, segments: [], reasons: ["The export is too short to be worth splitting."] };
  }
  const plan = planSegments({
    totalFrames: inputs.totalFrames,
    cutFrames: inputs.cutFrames,
    forbiddenSpans: inputs.forbiddenSpans,
    targetSegmentFrames: Math.round(TARGET_SEGMENT_SECONDS * fps),
  });
  if (plan.segments.length < 2) return { parallel: false, segments: [], reasons: plan.reasons };
  return { parallel: true, segments: plan.segments, reasons: plan.reasons };
}

export interface SegmentWorkerInput {
  readonly logicalCores: number;
  readonly systemMemoryBytes: number;
  readonly width: number;
  readonly height: number;
  /** The encoder is a hardware one: its engines are shared, so more than two sessions stop helping. */
  readonly hardwareEncoder?: boolean;
  /** Memory governor pressure of the editor window. */
  readonly pressure?: "normal" | "elevated" | "critical";
  readonly segmentCount: number;
}

const MB = 1024 * 1024;
const MAX_SEGMENT_WORKERS = 4;
/** Resident cost of one worker window: renderer, GPU context, decoders, caches and the ffmpeg pipe's credit window. */
export function segmentWorkerBytes(width: number, height: number): number {
  return 700 * MB + width * height * 4 * 40;
}

/**
 * How many segments to render at once: at most a third of the cores (each worker also feeds an ffmpeg that uses
 * several), at most what fits in 60 % of RAM next to the editor, fewer under memory pressure, and never more
 * than there are segments. 1 runs the plan one segment at a time (the same output as any other count, so the file
 * does not depend on the machine). 0 means there is no room even for that and the export stays one stream.
 */
export function chooseSegmentWorkers(input: SegmentWorkerInput): number {
  const byCores = Math.max(1, Math.floor(Math.max(1, input.logicalCores) / 3));
  const byMemory = Math.floor((input.systemMemoryBytes * 0.6) / segmentWorkerBytes(input.width, input.height));
  if (byMemory < 1 || input.pressure === "critical") return 0;
  let workers = Math.min(MAX_SEGMENT_WORKERS, byCores, byMemory, input.segmentCount);
  if (input.hardwareEncoder) workers = Math.min(workers, 2);
  if (input.pressure === "elevated") workers = Math.min(workers, 2);
  return Math.max(1, workers);
}

/** Frames written by the segments of a plan: the sum must be the export's frame count, with no gap or overlap. */
export function validateSegments(segments: readonly ExportSegment[], totalFrames: number): string | null {
  let expected = 0;
  for (const segment of segments) {
    if (segment.startFrame !== expected) return `Segment ${segment.index} starts at frame ${segment.startFrame}, expected ${expected}.`;
    if (!(segment.endFrame > segment.startFrame)) return `Segment ${segment.index} is empty.`;
    expected = segment.endFrame;
  }
  return expected === totalFrames ? null : `The segments cover ${expected} of ${totalFrames} frames.`;
}
