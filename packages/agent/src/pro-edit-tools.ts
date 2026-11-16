import type { Project } from "@openreel/core/types/project";
import type { Clip, Track } from "@openreel/core/types/timeline";
import { prepareTrimToolEdit } from "@openreel/core/editing/timeline-trim-tools";
import {
  DEFAULT_SPLIT_EDIT_FRAMES,
  findLinkedPartners,
  planExtendEdit,
  planSplitEdit,
  type EdgeMovePlan,
  type TimelineSide,
} from "@openreel/core/editing/split-edit";
import type { TimelineToolPlan } from "@openreel/core/editing/timeline-tool-edit";
import {
  clipSourceTimeAt,
  createMediaClip,
  findMainTrack,
  findTopmostVisualClipAt,
  planAddEditToAllTracks,
  planExtract,
  planInsert,
  planLift,
  planOverwrite,
} from "@openreel/core/editing/premiere-edits";
import {
  planSourceEdit,
  sourceDropError,
  type SourceComponent,
} from "@openreel/core/editing/source-edit";
import { planAddEdit } from "@openreel/core/editing/premiere-edits";
import { planTrackSelect } from "@openreel/core/editing/track-select";
import { planCloseGapBeforeClip, planRemoveGaps, planRippleDelete } from "@openreel/core/editing/ripple-delete";
import { findGapAt, planDeleteGap, planEditPointTrim } from "@openreel/core/editing/edit-point";
import { resolveSourceTracks } from "@openreel/core/editing/track-targeting";
import { computeScopeStats } from "@openreel/core/video/scope-stats";
import {
  PRO_EFFECT_SPECS,
  PRO_EFFECT_TYPES,
  isProEffectType,
  type ProEffectParamSpec,
} from "@openreel/core/video/pro-effects";
import {
  QUALIFIER_FULL,
  qualifierFromSample,
  readQualifier,
  type EyedropperMode,
} from "@openreel/core/video/hsl-secondary";
import { PRO_EFFECT_DEFAULTS } from "@openreel/core/video/pro-effects";
import type { Action } from "@openreel/core/types/actions";
import { upsertMaskKeyframe } from "@openreel/core/video/mask-path";
import { MASK_COMBINE_MODES } from "@openreel/core/video/mask-engine";
import type { BezierPath, BezierPoint, Mask, MaskCombineMode } from "@openreel/core/video/mask-engine";
import type { EditingHost, ScopeKindName, TimelinePlanBuilder } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Agent-native parity for the Premiere-style tools: scene edit detection, roll
 * / slide / rate-stretch trims, insert / overwrite / lift / extract / add-edit /
 * match-frame, the Scopes panel with numeric colour read-outs, and the pro
 * effects library. Every edit is planned by the same pure core functions the UI
 * uses and committed as ONE `timeline/toolEdit` history entry.
 */

const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const bool: JSONSchema = { type: "boolean" };
const obj = (
  properties: Record<string, JSONSchema>,
  required: string[] = [],
): JSONSchema => ({ type: "object", properties, required, additionalProperties: true });

const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "ERROR"): ToolResult => ({
  ok: false,
  summary: message,
  error: { code, message },
});

const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const SCOPE_KINDS = ["waveform", "parade", "yc", "vectorscope", "hls", "histogram"] as const;
const SCOPE_SCALES = ["ire", "pq", "hlg"] as const;
const EDGES = ["left", "right"] as const;

function frameRateOf(project: Project): number {
  const fps = project.settings.frameRate;
  return Number.isFinite(fps) && fps > 0 ? fps : 30;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A time given as seconds (`name`) or frames (`nameFrames`); exactly one. */
function readTime(
  args: Record<string, unknown>,
  name: string,
  project: Project,
  label = name,
): number {
  const frames = args[`${name}Frame`] ?? args[`${name}Frames`];
  const seconds = args[name];
  if (finite(seconds) && finite(frames))
    throw new Error(`Give ${label} in seconds or in frames, not both.`);
  if (finite(frames)) return frames / frameRateOf(project);
  if (finite(seconds)) return seconds;
  throw new Error(`${label} is required (seconds as "${name}" or frames as "${name}Frame").`);
}

function findClip(project: Project, clipId: unknown): { clip: Clip; track: Track } | null {
  if (typeof clipId !== "string") return null;
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

function edgeOf(args: Record<string, unknown>, fallback: "left" | "right"): "left" | "right" {
  const edge = args.edge;
  if (edge === undefined) return fallback;
  if (edge !== "left" && edge !== "right")
    throw new Error('edge must be "left" or "right".');
  return edge;
}

function linkedIds(args: Record<string, unknown>): string[] {
  const value = args.linkedClipIds;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string"))
    throw new Error("linkedClipIds must be an array of clip ids.");
  return value as string[];
}

/** Plan and commit one edit as a single undo step. */
async function commitPlan(
  host: EditingHost,
  build: TimelinePlanBuilder,
): Promise<{ ok: true; plan: TimelineToolPlan } | { ok: false; error: ToolResult }> {
  host.requireOpenProject();
  let plan: TimelineToolPlan | undefined;
  if (host.commitTimelinePlan) {
    const result = await host.commitTimelinePlan(build);
    if (!result.success)
      return {
        ok: false,
        error: fail(result.error?.message ?? "The edit failed", result.error?.code ?? "ACTION_FAILED"),
      };
    plan = result.plan;
    if (!plan) return { ok: false, error: fail("The edit produced no plan", "ACTION_FAILED") };
    return { ok: true, plan };
  }
  plan = build(host.getProject());
  if (!plan.edits.length) return { ok: true, plan };
  const result = await host.applyAction({
    type: "timeline/toolEdit",
    id: genId(),
    timestamp: Date.now(),
    params: { edits: plan.edits, label: plan.label },
  });
  if (!result.success)
    return {
      ok: false,
      error: fail(result.error?.message ?? "The edit failed", result.error?.code ?? "ACTION_FAILED"),
    };
  return { ok: true, plan };
}

/** Wraps a handler so thrown validation errors become INVALID_PARAMS results. */
function guarded(
  run: (args: Record<string, unknown>, host: EditingHost) => Promise<ToolResult> | ToolResult,
): RegisteredTool["handler"] {
  return async (args, host) => {
    try {
      return await run(args, host);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Invalid request", "INVALID_PARAMS");
    }
  };
}

const round = (value: number, places = 4): number => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

const DELTA_DOC =
  "Positive moves later in time. Give delta in seconds or deltaFrame in project frames (snapped to the frame grid and clamped to the available source handles; the applied value is returned).";

const trimTool = (
  mode: "roll" | "slide" | "stretch",
  name: string,
  title: string,
  description: string,
  withEdge: boolean,
): RegisteredTool => ({
  name,
  domain: "clip",
  title,
  description: `${description} ${DELTA_DOC} Linked clips (separated audio/video) are edited together automatically when the editor's linked selection is on; pass linkedClipIds ([] for none) to override (they must share this clip's timing).`,
  inputSchema: obj(
    {
      clipId: str,
      ...(withEdge
        ? { edge: { type: "string", enum: [...EDGES], description: mode === "roll" ? 'Which cut to roll: "right" (default) = the cut at the clip end, "left" = the cut at its start.' : 'Which edge to drag: "right" (default) or "left".' } }
        : {}),
      delta: num,
      deltaFrame: num,
      linkedClipIds: { type: "array", items: str },
    },
    ["clipId"],
  ),
  readOnly: false,
  destructive: false,
  expensive: false,
  handler: guarded(async (args, host) => {
    host.requireOpenProject();
    const edge = withEdge ? edgeOf(args, "right") : undefined;
    const clipId = String(args.clipId);
    // Same linked-selection logic the UI uses when the caller gives no ids.
    const explicit = args.linkedClipIds !== undefined;
    const linked = explicit
      ? linkedIds(args)
      : (host.resolveLinkedClipIds?.(host.getProject(), [clipId]) ?? []).filter((id) => id !== clipId);
    const requested = readTime(args, "delta", host.getProject(), "delta");
    const outcome = await commitPlan(host, (project) =>
      prepareTrimToolEdit(project, {
        mode,
        itemId: clipId,
        linkedIds: linked,
        edge,
      }).plan(requested),
    );
    if (!outcome.ok) return outcome.error;
    const { plan } = outcome;
    if (!plan.edits.length)
      return fail(
        "Nothing changed: the requested move is zero after snapping, or blocked by the available source handles.",
        "NO_CHANGE",
      );
    const after = plan.edits.find((edit) => edit.id === clipId)?.after as Clip | null | undefined;
    const data: Record<string, unknown> = {
      clipId,
      requestedDelta: requested,
      appliedDelta: round(plan.delta),
      appliedDeltaFrames: Math.round(plan.delta * frameRateOf(host.getProject())),
      clamped: Math.abs(plan.delta - requested) > 1e-6,
      changedClipIds: plan.edits.filter((e) => e.kind === "media" && e.after).map((e) => e.id),
    };
    if (after) {
      data.startTime = round(after.startTime);
      data.duration = round(after.duration);
      if (mode === "stretch") data.speed = round(after.speed ?? 1);
    }
    return ok(`${plan.label}: moved ${round(plan.delta)}s (one undo step)`, data);
  }),
});

const SIDES = ["audio", "video"] as const;

/** Linked partner ids: the caller's override, else the editor's rule, else the project's link rules. */
function partnersOf(args: Record<string, unknown>, host: EditingHost, clipId: string): string[] {
  if (args.linkedClipIds !== undefined) return linkedIds(args);
  const project = host.getProject();
  const viaHost = host.resolveLinkedClipIds?.(project, [clipId]);
  if (viaHost) return viaHost.filter((id) => id !== clipId);
  const found = findClip(project, clipId);
  return found ? findLinkedPartners(found.clip, project.timeline.tracks).map((p) => p.clip.id) : [];
}

/** The edge of a clip that is a cut (a neighbour touches it), else the one nearest `near`. */
function cutEdgeOf(project: Project, clipId: string, near: number | null): "left" | "right" {
  const found = findClip(project, clipId);
  if (!found) return "right";
  const { clip, track } = found;
  const touches = (edge: "left" | "right") =>
    track.clips.some((o) =>
      edge === "right"
        ? Math.abs(o.startTime - (clip.startTime + clip.duration)) < 1e-4
        : Math.abs(o.startTime + o.duration - clip.startTime) < 1e-4,
    );
  const right = touches("right");
  const left = touches("left");
  if (right !== left) return right ? "right" : "left";
  if (near === null) return "right";
  return Math.abs(near - clip.startTime) < Math.abs(near - (clip.startTime + clip.duration)) ? "left" : "right";
}

function splitReport(plan: EdgeMovePlan, host: EditingHost): Record<string, unknown> {
  const fps = frameRateOf(host.getProject());
  return {
    changedClipIds: plan.edits.filter((e) => e.kind === "media" && e.after).map((e) => e.id),
    moves: plan.moves.map((m) => ({
      clipId: m.clipId,
      edge: m.edge,
      requested: round(m.requested),
      applied: round(m.applied),
      appliedFrames: Math.round(m.applied * fps),
      rolledNeighborId: m.rolledNeighborId ?? null,
      limit: m.limit ?? null,
    })),
  };
}

function mediaTrackType(type: string): Track["type"] {
  if (type === "audio") return "audio";
  if (type === "image") return "image";
  return "video";
}

function trackAcceptsMedia(track: Track, mediaType: string): boolean {
  if (mediaType === "audio") return track.type === "audio";
  return track.type === "video" || track.type === "image";
}

/** The first unlocked targeted track (timeline order) that can take the media. */
function targetedTrackFor(
  host: EditingHost,
  project: Project,
  mediaType: string,
): Track | null {
  const targeted = host.targeting?.getState().targetedTrackIds;
  if (!targeted?.length) return null;
  return (
    project.timeline.tracks.find(
      (track) =>
        targeted.includes(track.id) && !track.locked && trackAcceptsMedia(track, mediaType),
    ) ?? null
  );
}

/** Targeted tracks that still exist and are unlocked, or undefined when none. */
function targetedTrackIds(host: EditingHost, project: Project): string[] | undefined {
  const targeted = host.targeting?.getState().targetedTrackIds;
  if (!targeted?.length) return undefined;
  const live = project.timeline.tracks
    .filter((track) => !track.locked && targeted.includes(track.id))
    .map((track) => track.id);
  return live.length ? live : undefined;
}

function placementTool(mode: "insert" | "overwrite"): RegisteredTool {
  const insert = mode === "insert";
  return {
    name: insert ? "insert_media" : "overwrite_media",
    domain: "clip",
    title: insert ? "Insert media" : "Overwrite media",
    description: insert
      ? "Premiere-style Insert: place library media at a timeline time on the main track (V1/A1 unless trackId is given), splitting what is underneath and rippling every unlocked track later by the clip length. One undo step. Give `at` seconds or `atFrame`. Optional sourceIn/sourceOut select the source range."
      : "Premiere-style Overwrite: place library media at a timeline time on the main track (V1/A1 unless trackId is given), replacing whatever it covers on that track without moving anything else. One undo step. Give `at` seconds or `atFrame`. Optional sourceIn/sourceOut select the source range.",
    inputSchema: obj(
      {
        mediaId: str,
        at: num,
        atFrame: num,
        trackId: str,
        sourceIn: num,
        sourceOut: num,
      },
      ["mediaId"],
    ),
    readOnly: false,
    destructive: !insert,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const project = host.getProject();
      const at = readTime(args, "at", project, "at");
      const media = project.mediaLibrary.items.find((item) => item.id === args.mediaId);
      if (!media) return fail("Media ID was not found; use list_media", "NOT_FOUND");
      let track: Track | null;
      if (typeof args.trackId === "string") {
        track = project.timeline.tracks.find((t) => t.id === args.trackId) ?? null;
        if (!track) return fail("Track ID was not found; use list_tracks", "NOT_FOUND");
        if (track.locked) return fail("The target track is locked", "INVALID_PARAMS");
        if (!trackAcceptsMedia(track, media.type))
          return fail("The media type is incompatible with the target track", "INVALID_PARAMS");
      } else {
        track =
          targetedTrackFor(host, project, media.type) ??
          findMainTrack(project, mediaTrackType(media.type)) ??
          (media.type === "image" ? findMainTrack(project, "video") : null);
        if (!track)
          return fail(`No unlocked ${mediaTrackType(media.type)} track is available; add one first`, "INVALID_PARAMS");
      }
      const range =
        finite(args.sourceIn) || finite(args.sourceOut)
          ? {
              inPoint: finite(args.sourceIn) ? args.sourceIn : 0,
              outPoint: finite(args.sourceOut)
                ? args.sourceOut
                : media.metadata.duration > 0
                  ? media.metadata.duration
                  : 5,
            }
          : undefined;
      const clipId = genId();
      const trackId = track.id;
      let duration = 0;
      const outcome = await commitPlan(host, (current) => {
        const clip = createMediaClip(media, trackId, clipId, range);
        duration = clip.duration;
        return (insert ? planInsert : planOverwrite)(
          current,
          at,
          [{ trackId, clip }],
          genId(),
        );
      });
      if (!outcome.ok) return outcome.error;
      if (!outcome.plan.edits.length) return fail("Nothing to place.", "NO_CHANGE");
      return ok(
        `${insert ? "Inserted" : "Overwrote with"} "${media.name}" at ${round(at)}s on ${track.name} (one undo step)`,
        { clipId, trackId, startTime: round(at), duration: round(duration), endTime: round(at + duration) },
      );
    }),
  };
}

function rangeTool(mode: "lift" | "extract"): RegisteredTool {
  const extract = mode === "extract";
  return {
    name: extract ? "extract_range" : "lift_range",
    domain: "clip",
    title: extract ? "Extract range" : "Lift range",
    description: extract
      ? "Premiere-style Extract: remove everything inside [start, end] on trackIds (default: the targeted tracks, else every unlocked sync-locked track) and close the gap by rippling later content earlier. Clips straddling the range are split. With explicit/targeted tracks, every other unlocked sync-locked track must be empty in the range (it then shifts too); otherwise the edit is blocked and the error names the track. One undo step. Give start/end in seconds or startFrame/endFrame."
      : "Premiere-style Lift: remove everything inside [start, end] on the unlocked tracks (or only trackIds), leaving a gap. Clips straddling the range are split. One undo step. Give start/end in seconds or startFrame/endFrame.",
    inputSchema: obj(
      {
        start: num,
        end: num,
        startFrame: num,
        endFrame: num,
        trackIds: { type: "array", items: str },
      },
      [],
    ),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const project = host.getProject();
      const range = {
        start: readTime(args, "start", project, "start"),
        end: readTime(args, "end", project, "end"),
      };
      const trackIds = Array.isArray(args.trackIds)
        ? (args.trackIds as unknown[]).filter((id): id is string => typeof id === "string")
        : targetedTrackIds(host, project);
      const outcome = await commitPlan(host, (current) =>
        (extract ? planExtract : planLift)(current, range, genId(), trackIds),
      );
      if (!outcome.ok) return outcome.error;
      if (!outcome.plan.edits.length)
        return fail(`Nothing to ${mode} in that range.`, "NO_CHANGE");
      return ok(
        `${extract ? "Extracted" : "Lifted"} ${round(range.start)}s-${round(range.end)}s (one undo step)`,
        {
          start: round(range.start),
          end: round(range.end),
          removedLength: round(range.end - range.start),
          clipsAffected: outcome.plan.edits.length,
        },
      );
    }),
  };
}

function timecode(seconds: number, fps: number): string {
  const nominal = Math.max(1, Math.round(fps));
  const total = Math.max(0, Math.round(seconds * fps));
  const frames = total % nominal;
  const whole = Math.floor(total / nominal);
  return [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60, frames]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}

const ALLOWED_SCOPE_WAIT = "Seeks the playhead first when `time` is given.";

function scopeKind(value: unknown): ScopeKindName | undefined {
  if (value === undefined) return undefined;
  if (!(SCOPE_KINDS as readonly unknown[]).includes(value))
    throw new Error(`kind must be one of ${SCOPE_KINDS.join(", ")}.`);
  return value as ScopeKindName;
}

/** Numeric parameter limits for the pro effects, shared with add/update checks. */
export function proEffectParamError(
  type: string,
  params: Record<string, unknown>,
): string | null {
  if (!isProEffectType(type)) return null;
  const specs = new Map<string, ProEffectParamSpec>(
    PRO_EFFECT_SPECS[type].params.map((p) => [p.key, p]),
  );
  for (const [key, value] of Object.entries(params)) {
    const spec = specs.get(key);
    if (!spec)
      return `Unknown ${type} parameter "${key}". Valid: ${[...specs.keys()].join(", ")}.`;
    if (spec.kind === "number") {
      if (!finite(value)) return `${type}.${key} must be a number.`;
      if (value < (spec.min ?? -Infinity) || value > (spec.max ?? Infinity))
        return `${type}.${key} must be within ${spec.min}..${spec.max}.`;
    } else if (spec.kind === "toggle") {
      if (typeof value !== "boolean") return `${type}.${key} must be true or false.`;
    } else if (!spec.options?.some((option) => option.value === value)) {
      return `${type}.${key} must be one of ${spec.options?.map((o) => o.value).join(", ")}.`;
    }
  }
  return null;
}

function readSample(value: unknown): readonly [number, number, number] {
  const sample = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const channel = (key: string): number => {
    const v = sample[key];
    if (!finite(v) || v < 0 || v > 255) throw new Error(`sample.${key} must be a number between 0 and 255.`);
    return v / 255;
  };
  return [channel("r"), channel("g"), channel("b")];
}

function sourceEditTool(mode: "insert" | "overwrite"): RegisteredTool {
  const insert = mode === "insert";
  return {
    name: insert ? "insert_from_source" : "overwrite_from_source",
    domain: "clip",
    title: insert ? "Insert from source" : "Overwrite from source",
    description:
      `Premiere-style ${insert ? "Insert (ripples later content)" : "Overwrite (replaces what it covers)"} from the Source monitor using three-point editing. The source range is the media's In/Out marks (set_source_in_out; or pass sourceIn/sourceOut; unmarked = whole media). Placement: at \`at\` (default 0), or at the sequence In when sequenceIn/sequenceOut are given: source In-only fits the range (Out derived), source Out-only back-times, source In+Out with only sequenceOut ends at it; with all four marks the source range wins at sequenceIn. component: both (default) | video (muted) | audio. One undo step. Returns the rule applied.`,
    inputSchema: obj(
      {
        mediaId: str,
        at: num,
        atFrame: num,
        trackId: str,
        sourceIn: num,
        sourceOut: num,
        sequenceIn: num,
        sequenceOut: num,
        component: { type: "string", enum: ["both", "video", "audio"] },
      },
      ["mediaId"],
    ),
    readOnly: false,
    destructive: !insert,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const project = host.getProject();
      const media = project.mediaLibrary.items.find((item) => item.id === args.mediaId);
      if (!media) return fail("Media ID was not found; use list_media", "NOT_FOUND");
      const component = (args.component ?? "both") as SourceComponent;
      if (!["both", "video", "audio"].includes(component))
        return fail("component must be both, video or audio", "INVALID_PARAMS");
      if (component !== "both" && media.type !== "video")
        return fail("component applies to video media only", "INVALID_PARAMS");
      const marks = host.sourceMonitor?.getMarks(media.id) ?? {};
      const sourceIn = finite(args.sourceIn) ? args.sourceIn : marks.in;
      const sourceOut = finite(args.sourceOut) ? args.sourceOut : marks.out;
      const hasAt = finite(args.at) || finite(args.atFrame);
      const playhead = hasAt ? readTime(args, "at", project, "at") : 0;
      const wantsAudio = media.type === "audio" || component === "audio";
      let track: Track | null;
      let audioTrackId: string | undefined;
      if (typeof args.trackId === "string") {
        track = project.timeline.tracks.find((t) => t.id === args.trackId) ?? null;
        if (!track) return fail("Track ID was not found; use list_tracks", "NOT_FOUND");
        const refusal = sourceDropError(track, media, component);
        if (refusal) return fail(refusal, "INVALID_PARAMS");
      } else {
        const state = host.targeting?.getState();
        if (state) {
          const patched = resolveSourceTracks(project, {
            mediaType: media.type === "audio" || media.type === "image" ? media.type : "video",
            hasAudio: media.metadata.hasAudio,
            component,
            patch: state.sourcePatch,
            targetedTrackIds: state.targetedTrackIds,
          });
          if (patched.primary.kind === "existing") track = patched.primary.track;
          if (patched.audio?.kind === "existing") audioTrackId = patched.audio.track.id;
        }
        track ??= findMainTrack(project, wantsAudio ? "audio" : media.type === "image" ? "image" : "video");
        if (!track) return fail("No unlocked matching track is available; add one first", "INVALID_PARAMS");
      }
      const trackId = track.id;
      const clipId = genId();
      const audioClipId = genId();
      let resolved: ReturnType<typeof planSourceEdit>["resolved"] | undefined;
      const outcome = await commitPlan(host, (current) => {
        const planned = planSourceEdit(current, {
          mode,
          media,
          trackId,
          clipId,
          operationId: genId(),
          sourceIn,
          sourceOut,
          playhead,
          sequenceIn: finite(args.sequenceIn) ? args.sequenceIn : undefined,
          sequenceOut: finite(args.sequenceOut) ? args.sequenceOut : undefined,
          component,
          audioPatch: audioTrackId ? { trackId: audioTrackId, clipId: audioClipId } : undefined,
        });
        resolved = planned.resolved;
        return planned.plan;
      });
      if (!outcome.ok) return outcome.error;
      if (!outcome.plan.edits.length || !resolved) return fail("Nothing to place.", "NO_CHANGE");
      return ok(
        `${insert ? "Inserted" : "Overwrote with"} "${media.name}" ${round(resolved.sourceIn)}-${round(resolved.sourceOut)}s at ${round(resolved.at)}s on ${track.name} (${resolved.rule}; one undo step)`,
        {
          clipId,
          trackId,
          ...(audioTrackId ? { audioClipId, audioTrackId } : {}),
          rule: resolved.rule,
          startTime: round(resolved.at),
          duration: round(resolved.duration),
          sourceIn: round(resolved.sourceIn),
          sourceOut: round(resolved.sourceOut),
        },
      );
    }),
  };
}

const SOURCE_MONITOR_TOOLS: RegisteredTool[] = [
  {
    name: "open_in_source_monitor",
    domain: "read",
    title: "Open in Source monitor",
    description:
      "Load a library media item into the Source monitor (the Source tab beside Program), optionally parked at `time` seconds. Does not edit the project. Live editor only.",
    inputSchema: obj({ mediaId: str, time: num }, ["mediaId"]),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded((args, host) => {
      if (!host.sourceMonitor)
        return fail("The Source monitor needs the live editor.", "UNSUPPORTED");
      const media = host.getProject().mediaLibrary.items.find((item) => item.id === args.mediaId);
      if (!media) return fail("Media ID was not found; use list_media", "NOT_FOUND");
      if (args.time !== undefined && (!finite(args.time) || args.time < 0))
        return fail("time must be a non-negative number of seconds", "INVALID_PARAMS");
      host.sourceMonitor.open(media.id, finite(args.time) ? args.time : undefined);
      return ok(`Opened "${media.name}" in the Source monitor`, { mediaId: media.id });
    }),
  },
  {
    name: "set_source_in_out",
    domain: "read",
    title: "Set source In/Out",
    description:
      "Set or clear the Source monitor In and/or Out marks of a media item (seconds, or inFrame/outFrame). Pass null to clear a mark. Marks persist per media item and are used by insert_from_source / overwrite_from_source. Not a timeline edit (no undo step). Live editor only.",
    inputSchema: obj(
      { mediaId: str, in: { type: ["number", "null"] }, out: { type: ["number", "null"] }, inFrame: num, outFrame: num },
      ["mediaId"],
    ),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded((args, host) => {
      if (!host.sourceMonitor)
        return fail("The Source monitor needs the live editor.", "UNSUPPORTED");
      const project = host.getProject();
      const media = project.mediaLibrary.items.find((item) => item.id === args.mediaId);
      if (!media) return fail("Media ID was not found; use list_media", "NOT_FOUND");
      const fps = media.metadata.frameRate || frameRateOf(project);
      const read = (name: "in" | "out"): number | null | undefined => {
        const frames = args[`${name}Frame`];
        if (args[name] === null) return null;
        if (finite(args[name])) return args[name] as number;
        if (finite(frames)) return frames / fps;
        return undefined;
      };
      const marks = { in: read("in"), out: read("out") };
      if (marks.in === undefined && marks.out === undefined)
        return fail("Give in and/or out (seconds, frames, or null to clear).", "INVALID_PARAMS");
      for (const v of [marks.in, marks.out])
        if (typeof v === "number" && v < 0) return fail("Marks must be non-negative.", "INVALID_PARAMS");
      host.sourceMonitor.setMarks(media.id, marks);
      const now = host.sourceMonitor.getMarks(media.id);
      return ok(`Source marks for "${media.name}": in ${now.in ?? "unset"}, out ${now.out ?? "unset"}`, {
        mediaId: media.id,
        in: now.in ?? null,
        out: now.out ?? null,
      });
    }),
  },
  sourceEditTool("insert"),
  sourceEditTool("overwrite"),
];

const TARGETING_TOOLS: RegisteredTool[] = [
  {
    name: "ripple_delete_clip",
    domain: "clip",
    title: "Ripple delete",
    description:
      "Delete a clip (or clipIds) and close the gap. Linked clips (separated audio/video) are deleted with it when the editor's linked selection is on (linkedClipIds overrides). Sync Lock: every other unlocked sync-locked track loses the same range and shifts earlier with it if that range is empty there; otherwise the edit is blocked and the error names the track (turn its Sync Lock off with set_track_sync_lock, or move its content). Tracks with Sync Lock off are untouched. One undo step.",
    inputSchema: obj({ clipId: str, clipIds: { type: "array", items: str }, linkedClipIds: { type: "array", items: str } }, []),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const project = host.getProject();
      const base = Array.isArray(args.clipIds)
        ? (args.clipIds as unknown[]).filter((id): id is string => typeof id === "string")
        : typeof args.clipId === "string"
          ? [args.clipId]
          : [];
      if (!base.length) return fail("Give clipId or clipIds.", "INVALID_PARAMS");
      for (const id of base)
        if (!findClip(project, id)) return fail(`Clip ${id} was not found; use list_clips`, "NOT_FOUND");
      const linked =
        args.linkedClipIds !== undefined
          ? linkedIds(args)
          : (host.resolveLinkedClipIds?.(project, base) ?? []);
      const ids = [...new Set([...base, ...linked])];
      const outcome = await commitPlan(host, (current) => planRippleDelete(current, ids, genId()));
      if (!outcome.ok) return outcome.error;
      if (!outcome.plan.edits.length) return fail("Nothing was deleted.", "NO_CHANGE");
      return ok(`Ripple deleted ${ids.length} clip(s) (one undo step)`, { clipIds: ids });
    }),
  },
  {
    name: "track_select_clips",
    domain: "clip",
    title: "Track select",
    description:
      "Premiere's Track Select Forward/Backward: the clip with clipId plus every clip and overlay item after it (direction \"forward\", default) or before it (\"backward\") on all unlocked tracks, or only on its own track with trackOnly. Items on locked tracks are never included. Read-only; pass the returned ids to ripple_delete_clip, delete or move tools to act on the whole range as one undo step.",
    inputSchema: obj(
      { clipId: str, direction: { type: "string", enum: ["forward", "backward"] }, trackOnly: bool },
      ["clipId"],
    ),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const clipId = args.clipId;
      if (typeof clipId !== "string") return fail("Give clipId.", "INVALID_PARAMS");
      const direction = args.direction ?? "forward";
      if (direction !== "forward" && direction !== "backward")
        return fail('direction must be "forward" or "backward".', "INVALID_PARAMS");
      const items = planTrackSelect(host.getProject(), clipId, {
        direction,
        trackOnly: args.trackOnly === true,
      });
      if (!items.length) return fail("Clip not found, or it is on a locked track.", "NOT_FOUND");
      return ok(`${items.length} item(s) selected ${direction} from ${clipId}`, {
        clipIds: items.map((item) => item.id),
        items,
      });
    }),
  },
  {
    name: "consolidate_track",
    domain: "track",
    title: "Remove gaps",
    description:
      "Remove Gaps: close every empty stretch on a track. Sync Lock: every other unlocked sync-locked track must be empty over each closed gap and shifts with it; otherwise the edit is blocked and the error names the track. Locked tracks are never changed. One undo step.",
    inputSchema: obj({ trackId: str }, ["trackId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const trackId = args.trackId;
      if (typeof trackId !== "string") return fail("Give trackId.", "INVALID_PARAMS");
      const outcome = await commitPlan(host, (current) => planRemoveGaps(current, trackId, genId()));
      if (!outcome.ok) return outcome.error;
      if (!outcome.plan.edits.length) return ok("The track has no gaps", { trackId });
      return ok("Gaps removed (one undo step)", { trackId });
    }),
  },
  {
    name: "close_gap",
    domain: "clip",
    title: "Close gap",
    description:
      "Close the gap before a clip. Sync Lock: every other unlocked sync-locked track must be empty over the gap and shifts with it; otherwise the edit is blocked. One undo step.",
    inputSchema: obj({ clipId: str }, ["clipId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const clipId = args.clipId;
      if (typeof clipId !== "string" || !findClip(host.getProject(), clipId))
        return fail("Clip not found; use list_clips", "NOT_FOUND");
      const outcome = await commitPlan(host, (current) => planCloseGapBeforeClip(current, clipId, genId()));
      if (!outcome.ok) return outcome.error;
      if (!outcome.plan.edits.length) return ok("There is no gap before the clip", { clipId });
      return ok("Gap closed (one undo step)", { clipId });
    }),
  },
  {
    name: "trim_edit_point",
    domain: "clip",
    title: "Trim edit point",
    description:
      'Trim-mode nudge of one edit point by whole frames, like selecting it in the timeline and pressing , or . (1 frame) or Shift , / . (5). clipId + edge ("left" = the clip start, "right" = its end) name the edit point; frames > 0 moves the edge later in time, < 0 earlier. kind "roll" moves the cut between two touching clips (total length unchanged), "ripple" trims the one edge and pulls everything after it along; the default is roll at a cut and ripple at a free edge, and roll on a free edge falls back to ripple. Sync Lock, linked clips (pass linkedClipIds to override), locked tracks and source handles apply exactly as for the Ripple and Roll tools; the move is clamped to the handles and the applied frames are returned. One undo step.',
    inputSchema: obj(
      {
        clipId: str,
        edge: { type: "string", enum: [...EDGES] },
        frames: num,
        kind: { type: "string", enum: ["ripple", "roll"] },
        linkedClipIds: { type: "array", items: str },
      },
      ["clipId", "edge", "frames"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const clipId = String(args.clipId);
      if (!findClip(host.getProject(), clipId)) return fail("Clip not found; use list_clips", "NOT_FOUND");
      if (args.edge === undefined) throw new Error('edge must be "left" or "right".');
      const edge = edgeOf(args, "right");
      const frames = Number(args.frames);
      if (!Number.isInteger(frames)) throw new Error("frames must be a whole number (negative trims earlier).");
      if (args.kind !== undefined && args.kind !== "ripple" && args.kind !== "roll")
        throw new Error('kind must be "ripple" or "roll".');
      const kind = args.kind as "ripple" | "roll" | undefined;
      const explicit = args.linkedClipIds !== undefined;
      const linked = explicit
        ? linkedIds(args)
        : (host.resolveLinkedClipIds?.(host.getProject(), [clipId]) ?? []).filter((id) => id !== clipId);
      const used: { kind: "ripple" | "roll" } = { kind: "ripple" };
      const outcome = await commitPlan(host, (project) => {
        const plan = planEditPointTrim(project, { clipId, edge, frames, kind, linkedIds: linked });
        used.kind = plan.kind;
        return plan;
      });
      if (!outcome.ok) return outcome.error;
      const { plan } = outcome;
      if (!plan.edits.length)
        return fail(
          "Nothing changed: the move is zero or blocked by the available source handles.",
          "NO_CHANGE",
        );
      const applied = Math.round(plan.delta * frameRateOf(host.getProject()));
      return ok(`${used.kind === "roll" ? "Rolled" : "Rippled"} the edit point ${applied} frames (one undo step)`, {
        clipId,
        edge,
        kind: used.kind,
        requestedFrames: frames,
        appliedFrames: applied,
        changedClipIds: plan.edits.filter((e) => e.kind === "media" && e.after).map((e) => e.id),
      });
    }),
  },
  {
    name: "delete_gap",
    domain: "track",
    title: "Delete gap",
    description:
      "Ripple-delete the empty gap on a track that contains `time` (seconds, or timeFrame in frames): later clips move earlier to close it. Space after the last clip is not a gap. Sync Lock: every other unlocked sync-locked track must be empty over the gap and shifts with it; otherwise the edit is blocked and the error names the track. Locked tracks block it. One undo step.",
    inputSchema: obj({ trackId: str, time: num, timeFrame: num }, ["trackId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const trackId = args.trackId;
      if (typeof trackId !== "string") return fail("Give trackId.", "INVALID_PARAMS");
      const time = readTime(args, "time", host.getProject(), "time");
      const gap = findGapAt(host.getProject(), trackId, time);
      if (!gap) return fail("There is no gap on that track at that time.", "NOT_FOUND");
      const outcome = await commitPlan(host, (current) => planDeleteGap(current, gap, genId()));
      if (!outcome.ok) return outcome.error;
      if (!outcome.plan.edits.length) return ok("The gap was already closed", { trackId });
      return ok("Gap deleted (one undo step)", { trackId, start: round(gap.start), end: round(gap.end) });
    }),
  },
  {
    name: "set_track_target",
    domain: "track",
    title: "Set track target",
    description:
      "Turn a track's target toggle (the V1/A1 buttons) on or off. Targeted tracks are what Extract, Lift, Add Edit, Paste, Match Frame and insert/overwrite use when no trackId is given. Editor state, not part of the project (no undo step). Live editor only.",
    inputSchema: obj({ trackId: str, targeted: bool }, ["trackId", "targeted"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded((args, host) => {
      if (!host.targeting) return fail("Track targeting needs the live editor.", "UNSUPPORTED");
      if (typeof args.targeted !== "boolean") return fail("targeted must be true or false", "INVALID_PARAMS");
      const track = host.getProject().timeline.tracks.find((t) => t.id === args.trackId);
      if (!track) return fail("Track ID was not found; use list_tracks", "NOT_FOUND");
      if (track.type === "text" || track.type === "graphics")
        return fail("Only video, image and audio tracks can be targeted", "INVALID_PARAMS");
      host.targeting.setTrackTargeted(track.id, args.targeted);
      const now = host.targeting.getState();
      return ok(`${track.name} ${args.targeted ? "targeted" : "untargeted"}`, {
        trackId: track.id,
        targeted: args.targeted,
        targetedTrackIds: [...now.targetedTrackIds],
      });
    }),
  },
  {
    name: "set_source_patch",
    domain: "track",
    title: "Set source patch",
    description:
      "Patch a Source monitor component to a timeline track: kind video|audio, trackId of a video/image track (video) or an audio track (audio), or null to clear (auto). insert_from_source / overwrite_from_source then place the source's video and audio on the patched tracks (two linked clips when both are patched to different tracks). Editor state, not part of the project (no undo step). Live editor only.",
    inputSchema: obj(
      { kind: { type: "string", enum: ["video", "audio"] }, trackId: { type: ["string", "null"] } },
      ["kind", "trackId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded((args, host) => {
      if (!host.targeting) return fail("Source patch needs the live editor.", "UNSUPPORTED");
      const kind = args.kind;
      if (kind !== "video" && kind !== "audio") return fail("kind must be video or audio", "INVALID_PARAMS");
      if (args.trackId === null) {
        host.targeting.setSourcePatch(kind, null);
        return ok(`Cleared the source ${kind} patch`, { kind, trackId: null });
      }
      const track = host.getProject().timeline.tracks.find((t) => t.id === args.trackId);
      if (!track) return fail("Track ID was not found; use list_tracks", "NOT_FOUND");
      if (track.locked) return fail("The target track is locked", "INVALID_PARAMS");
      const fits = kind === "audio" ? track.type === "audio" : track.type === "video" || track.type === "image";
      if (!fits) return fail(`A ${track.type} track cannot receive source ${kind}`, "INVALID_PARAMS");
      host.targeting.setSourcePatch(kind, track.id);
      return ok(`Source ${kind} patched to ${track.name}`, { kind, trackId: track.id });
    }),
  },
  {
    name: "add_edit",
    domain: "clip",
    title: "Add edit",
    description:
      "Premiere-style Add Edit: split every clip under a timeline time on trackIds (default: the targeted tracks, else every unlocked track). One undo step. Give `time` seconds or `timeFrame`.",
    inputSchema: obj({ time: num, timeFrame: num, trackIds: { type: "array", items: str } }, []),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const project = host.getProject();
      const time = readTime(args, "time", project, "time");
      const trackIds = Array.isArray(args.trackIds)
        ? (args.trackIds as unknown[]).filter((id): id is string => typeof id === "string")
        : targetedTrackIds(host, project);
      const outcome = await commitPlan(host, (current) => planAddEdit(current, time, genId(), trackIds));
      if (!outcome.ok) return outcome.error;
      if (!outcome.plan.edits.length) return fail("No unlocked clips under that time on those tracks.", "NO_CHANGE");
      return ok(`Added an edit at ${round(time)}s (one undo step)`, {
        time: round(time),
        clipsSplit: outcome.plan.edits.filter((edit) => edit.before && edit.after).length,
      });
    }),
  },
];

export const PRO_EDIT_TOOLS: RegisteredTool[] = [
  ...TARGETING_TOOLS,
  ...SOURCE_MONITOR_TOOLS,
  // ---- roll / slide / rate stretch ----------------------------------------
  trimTool(
    "roll",
    "roll_trim",
    "Roll trim",
    "Roll the cut between a clip and its neighbour: one clip gets longer by exactly as much as the other gets shorter, so total duration and everything else stay put. Uses the clip's source handles; clamped to them. One undo step.",
    true,
  ),
  trimTool(
    "slide",
    "slide_trim",
    "Slide trim",
    "Slide a clip along the timeline between its two neighbours without changing its own content or the overall duration: the previous clip's out and the next clip's in move with it. Needs an adjacent clip on both sides. One undo step.",
    false,
  ),
  trimTool(
    "stretch",
    "rate_stretch",
    "Rate stretch",
    "Rate Stretch: change a clip's length by dragging one edge so its playback speed changes to fill the new length (source range unchanged); never ripples. Returns the new speed. Not available on clips with speed ramps, images or generated media. One undo step.",
    true,
  ),

  // ---- split edits (J-cut / L-cut) and Extend Edit ------------------------
  {
    name: "make_split_edit",
    domain: "clip",
    title: "Make split edit (J-cut / L-cut)",
    description: `Offset a linked clip pair's edit points like Premiere's J-cut and L-cut. kind "l" = L-cut: the audio cut falls \`frames\` AFTER the picture cut (audio trails over the next shot); kind "j" = J-cut: the audio cut falls \`frames\` BEFORE it (audio leads into the shot). Give a clip at the cut (video or audio) and which edge is the cut (default: the edge a neighbouring clip touches). Only the audio side moves (side "video" moves the picture instead); at a cut between two clips that track rolls across it, at a clip end it trims/extends. The linked pair stays linked. The offset is measured from the other side's cut, so repeating the call is a no-op. Clamped to the available source handles, gaps, locked tracks and one-frame minimum; the applied value and the limit hit are returned. Default ${DEFAULT_SPLIT_EDIT_FRAMES} frames. One undo step.`,
    inputSchema: obj(
      {
        clipId: str,
        kind: { type: "string", enum: ["j", "l"] },
        edge: { type: "string", enum: [...EDGES] },
        frames: num,
        side: { type: "string", enum: [...SIDES] },
        linkedClipIds: { type: "array", items: str },
      },
      ["clipId", "kind"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const clipId = String(args.clipId);
      if (args.kind !== "j" && args.kind !== "l") throw new Error('kind must be "j" (J-cut) or "l" (L-cut).');
      const kind = args.kind;
      const frames = args.frames === undefined ? DEFAULT_SPLIT_EDIT_FRAMES : Number(args.frames);
      if (!finite(frames) || frames < 0) throw new Error("frames must be zero or more.");
      if (args.side !== undefined && args.side !== "audio" && args.side !== "video")
        throw new Error('side must be "audio" or "video".');
      const side = (args.side ?? "audio") as TimelineSide;
      const project = host.getProject();
      if (!findClip(project, clipId)) throw new Error(`Clip ${clipId} was not found.`);
      const edge = args.edge === undefined ? cutEdgeOf(project, clipId, null) : edgeOf(args, "right");
      const partnerIds = partnersOf(args, host, clipId);
      const outcome = await commitPlan(host, (current) =>
        planSplitEdit(current, { clipId, edge, kind, frames, side, partnerIds }),
      );
      if (!outcome.ok) return outcome.error;
      const plan = outcome.plan as EdgeMovePlan;
      if (!plan.edits.length)
        return fail(
          "Nothing changed: the edit already has this offset, or it is blocked by the available source handles, a gap or a locked track.",
          "NO_CHANGE",
        );
      return ok(`${plan.label}: ${side} cut moved ${frames} frames ${kind === "l" ? "later" : "earlier"} (one undo step)`, {
        clipId,
        kind,
        edge,
        side,
        requestedFrames: frames,
        ...splitReport(plan, host),
      });
    }),
  },
  {
    name: "extend_edit",
    domain: "clip",
    title: "Extend edit",
    description:
      'Premiere\'s Extend Edit: move the edit point (the head or tail) of the given clips to a timeline time, on the picture, the sound or both (side). At a cut between two clips it rolls the cut; at a clip end it trims or extends into free space. Linked partners of the given clips are included. Each clip is clamped independently by its own source handles, so the sides can land at different times; the applied value per clip is returned. Give `time` seconds or `timeFrame`. One undo step.',
    inputSchema: obj(
      {
        clipIds: { type: "array", items: str },
        clipId: str,
        edge: { type: "string", enum: [...EDGES] },
        time: num,
        timeFrame: num,
        side: { type: "string", enum: ["both", ...SIDES] },
        linkedClipIds: { type: "array", items: str },
      },
      [],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const given = Array.isArray(args.clipIds) ? args.clipIds.map(String) : args.clipId !== undefined ? [String(args.clipId)] : [];
      if (!given.length) throw new Error("Give clipId or clipIds.");
      const project = host.getProject();
      for (const id of given) if (!findClip(project, id)) throw new Error(`Clip ${id} was not found.`);
      const time = readTime(args, "time", project, "time");
      if (args.side !== undefined && args.side !== "both" && args.side !== "audio" && args.side !== "video")
        throw new Error('side must be "both", "audio" or "video".');
      const side = (args.side ?? "both") as TimelineSide | "both";
      const edge = args.edge === undefined ? cutEdgeOf(project, given[0], time) : edgeOf(args, "right");
      const ids = [...new Set(given.flatMap((id) => [id, ...partnersOf(args, host, id)]))];
      const outcome = await commitPlan(host, (current) =>
        planExtendEdit(current, { clipIds: ids, edge, time, side }),
      );
      if (!outcome.ok) return outcome.error;
      const plan = outcome.plan as EdgeMovePlan;
      if (!plan.edits.length)
        return fail(
          "Nothing changed: the edit is already at that time, or blocked by the available source handles, a gap or a locked track.",
          "NO_CHANGE",
        );
      return ok(`${plan.label}: moved the ${edge} edit to ${round(time)}s (one undo step)`, {
        edge,
        side,
        time: round(time),
        ...splitReport(plan, host),
      });
    }),
  },

  // ---- Premiere-style placement and range edits ---------------------------
  placementTool("insert"),
  placementTool("overwrite"),
  rangeTool("lift"),
  rangeTool("extract"),
  {
    name: "add_edit_all_tracks",
    domain: "clip",
    title: "Add edit to all tracks",
    description:
      "Split every clip under a timeline time on all unlocked tracks at once (Premiere's Add Edit to All Tracks). One undo step. Give `time` seconds or `timeFrame`.",
    inputSchema: obj({ time: num, timeFrame: num }, []),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const time = readTime(args, "time", host.getProject(), "time");
      const outcome = await commitPlan(host, (project) =>
        planAddEditToAllTracks(project, time, genId()),
      );
      if (!outcome.ok) return outcome.error;
      if (!outcome.plan.edits.length)
        return fail("No unlocked clips under that time.", "NO_CHANGE");
      return ok(`Added an edit at ${round(time)}s on all tracks (one undo step)`, {
        time: round(time),
        clipsSplit: outcome.plan.edits.filter((edit) => edit.before && edit.after).length,
      });
    }),
  },
  {
    name: "match_frame",
    domain: "read",
    title: "Match frame",
    description:
      "Find the source media and source timecode shown at a timeline time: of clipId, or of the topmost visible video clip at `time`. Returns mediaId, source time and timecode so the same frame can be located in the library and used for insert_media/overwrite_media sourceIn. Also selects the source media in the library (as the UI does). Does not edit the project.",
    inputSchema: obj({ clipId: str, time: num, timeFrame: num }, []),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded((args, host) => {
      const project = host.getProject();
      const fps = frameRateOf(project);
      const hasTime = finite(args.time) || finite(args.timeFrame);
      let clip: Clip | null | undefined;
      let time: number;
      if (typeof args.clipId === "string") {
        clip = findClip(project, args.clipId)?.clip;
        if (!clip) return fail("Clip not found", "NOT_FOUND");
        time = hasTime
          ? readTime(args, "time", project)
          : clip.startTime;
      } else {
        time = readTime(args, "time", project, "time (or clipId)");
        clip = findTopmostVisualClipAt(project, time);
        if (!clip) return fail("No video clip at that time.", "NOT_FOUND");
      }
      const media = project.mediaLibrary.items.find((item) => item.id === clip!.mediaId);
      if (!media) return fail("Source media not found", "NOT_FOUND");
      const mediaFps = media.metadata.frameRate || fps;
      // Outside the clip the source time is clamped to its ends; report the
      // timeline time the answer really belongs to.
      time = Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, time));
      const sourceTime = clipSourceTimeAt(clip, time);
      host.selectLibraryMedia?.(media.id);
      host.sourceMonitor?.open(media.id, sourceTime);
      return ok(`${media.name} at ${timecode(sourceTime, mediaFps)}`, {
        clipId: clip.id,
        mediaId: media.id,
        mediaName: media.name,
        timelineTime: round(time),
        sourceTime: round(sourceTime),
        sourceTimecode: timecode(sourceTime, mediaFps),
        sourceFrame: Math.round(sourceTime * mediaFps),
      });
    }),
  },

  // ---- scene edit detection -----------------------------------------------
  {
    name: "detect_scenes",
    domain: "clip",
    title: "Detect scenes",
    description:
      "Scene edit detection: analyse a video clip's footage for hard cuts and return them (source and timeline times, score). Does not edit anything; follow with apply_scene_cuts using the returned analysisId. sensitivity 0..1 (default 0.5; higher finds more cuts), minSceneLength in seconds (default 1). Needs the live editor with the source media loaded; reversed clips are unsupported.",
    inputSchema: obj(
      {
        clipId: str,
        sensitivity: { type: "number", minimum: 0, maximum: 1 },
        minSceneLength: { type: "number", minimum: 0 },
      },
      ["clipId"],
    ),
    readOnly: true,
    destructive: false,
    expensive: true,
    handler: guarded(async (args, host) => {
      if (!host.sceneDetection)
        return fail("Scene detection needs the live editor (frame decoding); it is unavailable in this host.", "UNSUPPORTED");
      host.requireOpenProject();
      const sensitivity = args.sensitivity === undefined ? 0.5 : args.sensitivity;
      const minSceneLength = args.minSceneLength === undefined ? 1 : args.minSceneLength;
      if (!finite(sensitivity) || sensitivity < 0 || sensitivity > 1)
        return fail("sensitivity must be between 0 and 1", "INVALID_PARAMS");
      if (!finite(minSceneLength) || minSceneLength < 0)
        return fail("minSceneLength must be a non-negative number of seconds", "INVALID_PARAMS");
      if (!findClip(host.getProject(), args.clipId))
        return fail("Clip not found", "NOT_FOUND");
      const analysis = await host.sceneDetection.analyse({
        clipId: String(args.clipId),
        sensitivity,
        minSceneLength,
      });
      return ok(
        `Found ${analysis.cuts.length} cut${analysis.cuts.length === 1 ? "" : "s"} in clip ${analysis.clipId}`,
        analysis,
      );
    }),
  },
  {
    name: "apply_scene_cuts",
    domain: "clip",
    title: "Apply scene cuts",
    description:
      "Apply the cuts from detect_scenes as one undo step: splitClip splits the clip (and its linked clips) at every cut, addMarkers drops a timeline marker at each. At least one must be true. Clips with speed ramps or freeze frames can only get markers.",
    inputSchema: obj({ analysisId: str, splitClip: bool, addMarkers: bool }, ["analysisId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      if (!host.sceneDetection)
        return fail("Scene detection needs the live editor; it is unavailable in this host.", "UNSUPPORTED");
      host.requireOpenProject();
      const splitClip = args.splitClip === undefined ? true : args.splitClip;
      const addMarkers = args.addMarkers === undefined ? false : args.addMarkers;
      if (typeof splitClip !== "boolean" || typeof addMarkers !== "boolean")
        return fail("splitClip and addMarkers must be booleans", "INVALID_PARAMS");
      if (!splitClip && !addMarkers)
        return fail("Choose splitClip, addMarkers, or both", "INVALID_PARAMS");
      if (typeof args.analysisId !== "string" || !args.analysisId)
        return fail("analysisId is required (from detect_scenes)", "INVALID_PARAMS");
      const result = await host.sceneDetection.apply({
        analysisId: args.analysisId,
        splitClip,
        addMarkers,
      });
      return ok(
        `Applied scene cuts: ${result.splits} split${result.splits === 1 ? "" : "s"}, ${result.markers} marker${result.markers === 1 ? "" : "s"}`,
        result,
      );
    }),
  },

  // ---- scopes (colour QA) --------------------------------------------------
  {
    name: "open_scopes",
    domain: "color",
    title: "Open scopes",
    description:
      "Open the Scopes panel (waveform = luma, parade = RGB parade, yc = luma + chroma, vectorscope, hls = hue/saturation polar plot, histogram) and optionally pick the kind. scale ire|pq|hlg sets the waveform level axis (nits for HDR footage); falseColor true/false toggles the IRE-band exposure overlay on the Program monitor (preview only, never exported). Use get_scope_stats to read the numbers. Live editor only.",
    inputSchema: obj(
      {
        kind: { type: "string", enum: [...SCOPE_KINDS] },
        scale: { type: "string", enum: [...SCOPE_SCALES] },
        falseColor: { type: "boolean" },
      },
      [],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded((args, host) => {
      if (!host.scopes) return fail("Scopes need the live editor; unavailable in this host.", "UNSUPPORTED");
      if (args.scale !== undefined && !(SCOPE_SCALES as readonly unknown[]).includes(args.scale))
        return fail(`scale must be one of ${SCOPE_SCALES.join(", ")}.`, "INVALID_PARAMS");
      if (args.falseColor !== undefined && typeof args.falseColor !== "boolean")
        return fail("falseColor must be true or false.", "INVALID_PARAMS");
      const wantsView = args.scale !== undefined || args.falseColor !== undefined;
      if (wantsView && !host.scopes.setView) return fail("Scope scale and false colour need the live editor.", "UNSUPPORTED");
      let state = host.scopes.setVisible(true, scopeKind(args.kind));
      if (wantsView && host.scopes.setView) {
        state = host.scopes.setView({
          scale: args.scale as (typeof SCOPE_SCALES)[number] | undefined,
          falseColor: args.falseColor as boolean | undefined,
        });
      }
      return ok(`Scopes open (${state.kind})`, state);
    }),
  },
  {
    name: "close_scopes",
    domain: "color",
    title: "Close scopes",
    description: "Close the Scopes panel. Live editor only.",
    inputSchema: obj({}, []),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded((_args, host) => {
      if (!host.scopes) return fail("Scopes need the live editor; unavailable in this host.", "UNSUPPORTED");
      const state = host.scopes.setVisible(false);
      return ok("Scopes closed", state);
    }),
  },
  {
    name: "get_scope_stats",
    domain: "color",
    title: "Read scope statistics",
    description: `Read what the scopes show as numbers for the current program frame (the preview as rendered, effects and grade included): luma min/max/average/median and 1st/99th percentile, black and white clipping percent (overall and per RGB channel), average/max saturation, dominant hue (degrees, name, share), colour cast (vectorscope Cb/Cr) and plain-language warnings. Use it for colour QA before and after grading. ${ALLOWED_SCOPE_WAIT} Works whether or not the panel is open. Live editor only.`,
    inputSchema: obj({ time: num, timeFrame: num }, []),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      if (!host.scopes) return fail("Scopes need the live editor; unavailable in this host.", "UNSUPPORTED");
      host.requireOpenProject();
      const hasTime = finite(args.time) || finite(args.timeFrame);
      const timeSec = hasTime ? readTime(args, "time", host.getProject()) : undefined;
      const frame = await host.scopes.captureFrame(
        timeSec === undefined ? undefined : { timeSec },
      );
      if (!frame) return fail("The preview is not ready or has nothing to analyse.", "NOT_READY");
      const stats = computeScopeStats(frame);
      if (!stats) return fail("The current frame is empty (fully transparent).", "EMPTY_FRAME");
      return ok(
        stats.warnings.length
          ? `Scope stats: ${stats.warnings[0]}${stats.warnings.length > 1 ? ` (+${stats.warnings.length - 1} more)` : ""}`
          : `Scope stats: luma ${stats.luma.min}-${stats.luma.max}% (avg ${stats.luma.average}%), no clipping`,
        { time: timeSec, scopes: host.scopes.getState(), stats },
      );
    }),
  },

  // ---- pro effects ---------------------------------------------------------
  {
    name: "list_pro_effects",
    domain: "effect",
    title: "List pro effects",
    description:
      "List the pro video effects (blurs, keys, colour tools, distortions, stylize and generator effects: e.g. camera-blur, tilt-shift, luma-key, color-key, spherize, twirl, corner-pin, lens-flare, strobe-light; pass effectType to filter and see every type) with each parameter's range, default and neutral (no-op) value. Add one with add_video_effect {effectType, params}; omitted params take the defaults. Read-only.",
    inputSchema: obj({ effectType: { type: "string", enum: [...PRO_EFFECT_TYPES] } }, []),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded((args) => {
      const types =
        typeof args.effectType === "string"
          ? PRO_EFFECT_TYPES.filter((t) => t === args.effectType)
          : PRO_EFFECT_TYPES;
      if (!types.length) return fail(`Unknown pro effect "${String(args.effectType)}"`, "INVALID_PARAMS");
      return ok(
        `${types.length} pro effect${types.length === 1 ? "" : "s"}`,
        types.map((type) => {
          const spec = PRO_EFFECT_SPECS[type];
          return {
            type,
            label: spec.label,
            description: spec.description,
            category: spec.category,
            params: spec.params.map((p) => ({
              key: p.key,
              kind: p.kind,
              min: p.min,
              max: p.max,
              step: p.step,
              unit: p.unit,
              default: p.default,
              neutral: p.neutral,
              options: p.options?.map((o) => o.value),
              keyframable: p.keyframable === true,
            })),
          };
        }),
      );
    }),
  },

  // ---- HSL secondary + comparison view -------------------------------------
  {
    name: "add_hsl_secondary",
    domain: "color",
    title: "Add HSL secondary",
    description:
      "Add a Lumetri-style HSL Secondary to a clip: a qualifier (hueMin/hueMax/hueSoft in degrees, satMin/satMax/satSoft and lumMin/lumMax/lumSoft in percent, denoise 0-100, blur 0-20 px, invert) keys a matte, and the correction (temperature, tint, contrast, sharpen, saturation -100..100, wheelX/wheelY -1..1) applies only inside it. Optional maskShape none|ellipse|rectangle with maskX/maskY/maskW/maskH (percent), maskFeather (px), maskInvert limits the matte. Pass `sample` {r,g,b} (0-255) to key around a colour like the eyedropper. A clip can carry several secondaries (applied in stack order). Params are the hsl-secondary pro-effect params (see list_pro_effects); omitted params are neutral (saturation 0). One undo step. Returns effectId; refine with set_secondary_qualifier; keyframe with add_keyframe property fx:<effectId>:<param> using the returned effectId (e.g. fx:<effectId>:saturation), which animates that secondary independently of any others.",
    inputSchema: obj(
      {
        clipId: str,
        sample: obj({ r: num, g: num, b: num }, ["r", "g", "b"]),
        params: { type: "object" },
      },
      ["clipId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      if (!findClip(host.getProject(), args.clipId)) return fail("Unknown clipId.", "INVALID_PARAMS");
      const given =
        typeof args.params === "object" && args.params !== null
          ? (args.params as Record<string, unknown>)
          : {};
      const invalid = proEffectParamError("hsl-secondary", given);
      if (invalid) return fail(invalid, "INVALID_PARAMS");
      const params: Record<string, unknown> = {
        ...PRO_EFFECT_DEFAULTS["hsl-secondary"],
        saturation: 0,
      };
      if (args.sample !== undefined) {
        Object.assign(params, qualifierFromSample(QUALIFIER_FULL, readSample(args.sample), "set"));
      }
      Object.assign(params, given);
      const invalidMerged = proEffectParamError("hsl-secondary", params);
      if (invalidMerged) return fail(invalidMerged, "INVALID_PARAMS");
      const effectId = `effect-${genId()}`;
      const action: Action = {
        type: "effect/add",
        id: genId(),
        timestamp: Date.now(),
        params: { clipId: args.clipId, effectType: "hsl-secondary", params, effectId },
      } as Action;
      const result = await host.applyAction(action);
      if (!result.success)
        return fail(result.error?.message ?? "add_hsl_secondary failed", result.error?.code ?? "ACTION_FAILED");
      return ok("Added HSL secondary (one undo step)", { effectId, params });
    }),
  },
  {
    name: "set_secondary_qualifier",
    domain: "color",
    title: "Set secondary qualifier",
    description:
      "Change the qualifier / matte settings of an HSL secondary: explicit fields (hueMin, hueMax, hueSoft, satMin, satMax, satSoft, lumMin, lumMax, lumSoft, denoise, blur, invert) and/or eyedropper `sample` {r,g,b} (0-255) with mode set (default: a new range around the colour), add (widen the key to include it) or subtract (narrow the key to drop it); explicit fields win over the sample. Reads the secondary's current range first, so add/subtract compose. One undo step.",
    inputSchema: obj(
      {
        clipId: str,
        effectId: str,
        sample: obj({ r: num, g: num, b: num }, ["r", "g", "b"]),
        mode: { type: "string", enum: ["set", "add", "subtract"] },
        params: { type: "object" },
      },
      ["clipId", "effectId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const located = findClip(host.getProject(), args.clipId);
      if (!located) return fail("Unknown clipId.", "INVALID_PARAMS");
      const effect = located.clip.effects.find((e) => e.id === args.effectId);
      if (!effect || effect.type !== "hsl-secondary")
        return fail("effectId is not an HSL secondary on that clip.", "INVALID_PARAMS");
      const mode = (args.mode ?? "set") as EyedropperMode;
      if (!["set", "add", "subtract"].includes(mode))
        return fail("mode must be set, add or subtract.", "INVALID_PARAMS");
      const given =
        typeof args.params === "object" && args.params !== null
          ? (args.params as Record<string, unknown>)
          : {};
      const invalid = proEffectParamError("hsl-secondary", given);
      if (invalid) return fail(invalid, "INVALID_PARAMS");
      if (args.sample === undefined && Object.keys(given).length === 0)
        return fail("Give a sample and/or params to change.", "INVALID_PARAMS");
      const patch: Record<string, unknown> = {};
      if (args.sample !== undefined) {
        const base = readQualifier(effect.params);
        Object.assign(patch, qualifierFromSample(base, readSample(args.sample), mode));
      }
      Object.assign(patch, given);
      const action: Action = {
        type: "effect/update",
        id: genId(),
        timestamp: Date.now(),
        params: { clipId: args.clipId, effectId: args.effectId, params: patch },
      } as Action;
      const result = await host.applyAction(action);
      if (!result.success)
        return fail(result.error?.message ?? "set_secondary_qualifier failed", result.error?.code ?? "ACTION_FAILED");
      return ok("Updated secondary qualifier (one undo step)", { effectId: args.effectId, params: patch });
    }),
  },
  {
    name: "grab_still",
    domain: "color",
    title: "Grab still",
    description:
      "Grab the graded Program frame (at `time` seconds, default the playhead) as a still and make it the comparison reference. Stills live in the editor session only (not in the project). Use toggle_comparison to show it against the current frame. Live editor only.",
    inputSchema: obj({ time: num, timeFrame: num, label: str }, []),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      if (!host.colorMonitor) return fail("Stills need the live editor; unavailable in this host.", "UNSUPPORTED");
      host.requireOpenProject();
      const hasTime = finite(args.time) || finite(args.timeFrame);
      const time = hasTime ? readTime(args, "time", host.getProject()) : undefined;
      const still = await host.colorMonitor.grabStill({
        time,
        label: typeof args.label === "string" ? args.label : undefined,
      });
      if (!still)
        return fail("The preview is not ready, or playback is running (pause to grab another time).", "NOT_READY");
      return ok(`Grabbed ${still.label} at ${round(still.time)}s`, still);
    }),
  },
  {
    name: "toggle_comparison",
    domain: "color",
    title: "Toggle comparison view",
    description:
      "Show or hide the Program monitor comparison view (preview only; never affects export or scopes). With no arguments it toggles. mode: off | side (side by side) | split-v (draggable vertical wipe) | split-h (horizontal wipe); reference: bypass (the ungraded frame), still (stillId from grab_still) or playhead (a frame pinned at refTime seconds); split 0..1 positions the wipe. Live editor only.",
    inputSchema: obj(
      {
        mode: { type: "string", enum: ["off", "side", "split-v", "split-h"] },
        reference: { type: "string", enum: ["bypass", "still", "playhead"] },
        split: num,
        stillId: str,
        refTime: num,
      },
      [],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded((args, host) => {
      const monitor = host.colorMonitor;
      if (!monitor) return fail("The comparison view needs the live editor; unavailable in this host.", "UNSUPPORTED");
      const patch: Parameters<typeof monitor.setComparison>[0] = {};
      if (args.mode !== undefined) {
        if (!["off", "side", "split-v", "split-h"].includes(String(args.mode)))
          return fail("mode must be off, side, split-v or split-h.", "INVALID_PARAMS");
        patch.mode = args.mode as NonNullable<typeof patch.mode>;
      }
      if (args.reference !== undefined) {
        if (!["bypass", "still", "playhead"].includes(String(args.reference)))
          return fail("reference must be bypass, still or playhead.", "INVALID_PARAMS");
        patch.reference = args.reference as NonNullable<typeof patch.reference>;
      }
      if (args.split !== undefined) {
        if (!finite(args.split) || args.split < 0 || args.split > 1)
          return fail("split must be a number between 0 and 1.", "INVALID_PARAMS");
        patch.split = args.split;
      }
      if (typeof args.stillId === "string") {
        if (!monitor.getComparison().stills.some((s) => s.id === args.stillId))
          return fail("Unknown stillId. Run grab_still first.", "INVALID_PARAMS");
        patch.stillId = args.stillId;
        patch.reference ??= "still";
      }
      if (args.refTime !== undefined) {
        if (!finite(args.refTime) || args.refTime < 0)
          return fail("refTime must be a non-negative number of seconds.", "INVALID_PARAMS");
        patch.refTime = args.refTime;
        patch.reference ??= "playhead";
      }
      if (patch.reference === "still" && !patch.stillId && !monitor.getComparison().stillId)
        return fail("No still to compare with. Run grab_still first.", "INVALID_PARAMS");
      const current = monitor.getComparison();
      if (Object.keys(patch).length === 0) patch.mode = current.mode === "off" ? "split-v" : "off";
      else if (patch.mode === undefined && current.mode === "off") patch.mode = "split-v";
      const next = monitor.setComparison(patch);
      return ok(
        next.mode === "off" ? "Comparison view off" : `Comparison view ${next.mode} against ${next.reference}`,
        next,
      );
    }),
  },

  {
    name: "set_clip_mask_path",
    domain: "effect",
    title: "Draw / edit a clip mask path",
    description:
      "Create or edit a free-form Bezier mask on a clip (the same data the Program-monitor pen tool draws). points are in composition space 0..1 (x right, y down), at least 3; each may carry absolute handleIn / handleOut {x,y} (a point with no handles is a sharp corner). Omit maskId to add a new closed 'drawn' mask; pass maskId to edit one. With timeSeconds the path is written as a path keyframe at that timeline time (all keyframes of one mask must keep the same point count and the mask then interpolates between them); otherwise it replaces the static path. Optional feathering (0..100), expansion (-100..100), opacity (0..1), inverted. Optional combine (add|subtract|intersect|difference, default intersect) sets how this mask combines with the masks listed before it on the clip; the first mask ignores it. One undo step.",
    inputSchema: obj(
      {
        clipId: str,
        maskId: str,
        points: {
          type: "array",
          items: {
            type: "object",
            properties: {
              x: num,
              y: num,
              handleIn: obj({ x: num, y: num }, ["x", "y"]),
              handleOut: obj({ x: num, y: num }, ["x", "y"]),
            },
            required: ["x", "y"],
          },
        },
        timeSeconds: num,
        feathering: num,
        expansion: num,
        opacity: num,
        inverted: bool,
        combine: { type: "string", enum: [...MASK_COMBINE_MODES] },
      },
      ["clipId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const project = host.getProject();
      const found = findClip(project, args.clipId);
      if (!found) return fail(`Clip "${String(args.clipId)}" not found`, "INVALID_PARAMS");
      const inRange = (key: string, min: number, max: number): number | undefined => {
        const v = args[key];
        if (v === undefined) return undefined;
        if (!finite(v) || v < min || v > max)
          throw new Error(`${key} must be a number within ${min}..${max}.`);
        return v;
      };
      const feathering = inRange("feathering", 0, 100);
      const expansion = inRange("expansion", -100, 100);
      const opacity = inRange("opacity", 0, 1);
      if (args.inverted !== undefined && typeof args.inverted !== "boolean")
        throw new Error("inverted must be a boolean.");
      if (
        args.combine !== undefined &&
        !(MASK_COMBINE_MODES as readonly unknown[]).includes(args.combine)
      )
        throw new Error(`combine must be one of ${MASK_COMBINE_MODES.join(", ")}.`);
      const handle = (v: unknown, label: string): { x: number; y: number } | undefined => {
        if (v === undefined) return undefined;
        const h = v as { x?: unknown; y?: unknown } | null;
        if (!h || !finite(h.x) || !finite(h.y)) throw new Error(`${label} needs numeric x and y.`);
        return { x: h.x, y: h.y };
      };
      let path: BezierPath | undefined;
      if (args.points !== undefined) {
        if (!Array.isArray(args.points) || args.points.length < 3)
          throw new Error("points must list at least 3 vertices.");
        path = {
          closed: true,
          points: args.points.map((raw, i): BezierPoint => {
            const q = raw as {
              x?: unknown;
              y?: unknown;
              handleIn?: unknown;
              handleOut?: unknown;
            } | null;
            if (!q || !finite(q.x) || !finite(q.y))
              throw new Error(`points[${i}] needs numeric x and y.`);
            const handleIn = handle(q.handleIn, `points[${i}].handleIn`);
            const handleOut = handle(q.handleOut, `points[${i}].handleOut`);
            return {
              x: q.x,
              y: q.y,
              ...(handleIn ? { handleIn } : {}),
              ...(handleOut ? { handleOut } : {}),
            };
          }),
        };
      }
      const time = args.timeSeconds;
      if (time !== undefined && (!finite(time) || time < 0))
        throw new Error("timeSeconds must be a number >= 0.");
      const tolerance = 0.5 / frameRateOf(project);
      const all = project.masks ?? [];
      const clipId = found.clip.id;
      let next: Mask;
      let maskId: string;
      const adding = typeof args.maskId !== "string";
      if (typeof args.maskId === "string") {
        const existing = all.find((m) => m.id === args.maskId && m.clipId === clipId);
        if (!existing) return fail(`Mask "${args.maskId}" not found on clip ${clipId}`, "INVALID_PARAMS");
        maskId = existing.id;
        next = { ...existing };
        if (path) {
          const refCount = existing.keyframes[0]?.path.points.length ?? existing.path.points.length;
          if (path.points.length !== refCount && (time !== undefined || existing.keyframes.length > 0))
            throw new Error(
              `This mask's path keyframes have ${refCount} points; the new path has ${path.points.length}.`,
            );
          next =
            time !== undefined
              ? upsertMaskKeyframe(next, time, path, tolerance)
              : { ...next, path };
        }
      } else {
        if (!path) throw new Error("points is required to add a mask.");
        if (time !== undefined)
          throw new Error("timeSeconds applies to an existing mask; add it first, then keyframe it.");
        maskId = genId();
        next = {
          id: maskId,
          clipId,
          type: "drawn",
          path,
          feathering: 0,
          expansion: 0,
          opacity: 1,
          inverted: false,
          keyframes: [],
        };
      }
      if (feathering !== undefined) next.feathering = feathering;
      if (expansion !== undefined) next.expansion = expansion;
      if (opacity !== undefined) next.opacity = opacity;
      if (typeof args.inverted === "boolean") next.inverted = args.inverted;
      if (typeof args.combine === "string") next.combine = args.combine as MaskCombineMode;
      const masks = adding ? [...all, next] : all.map((m) => (m.id === maskId ? next : m));
      const result = await host.applyAction({
        type: "mask/setAll",
        id: genId(),
        timestamp: Date.now(),
        params: { masks },
      });
      if (!result.success)
        return fail(
          result.error?.message ?? "set_clip_mask_path failed",
          result.error?.code ?? "ACTION_FAILED",
        );
      return ok(`mask ${maskId} ${adding ? "added" : "updated"}`, { maskId });
    }),
  },
];
