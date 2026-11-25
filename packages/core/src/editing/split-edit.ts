import type { Project } from "../types/project";
import type { Clip, Track } from "../types/timeline";
import type { TextClip } from "../text/types";
import { getCompoundClipId } from "../timeline/timeline-items";
import {
  EPS,
  resizeKeys,
  type Item,
  type TimelineToolItemEdit,
  type TimelineToolPlan,
  type TimelineToolPreview,
} from "./timeline-tool-edit";

/**
 * Split edits and unlinked edge trims (Premiere's J-cut, L-cut, Extend Edit and
 * Alt-trim).
 *
 * Everything reduces to one primitive: move ONE clip's edge, on ITS track only.
 * The clip's linked partners are never touched, so the pair stays linked (a
 * link is "same source origin on another track", which a head/tail trim keeps)
 * while its video and audio edit points drift apart. When the edge is a cut
 * (another clip on the same track starts exactly where this one ends) the
 * neighbour's facing edge moves with it, i.e. a rolling edit of just that
 * track; otherwise the edge trims or extends into free space. Moves are
 * clamped to the source handles, one frame minimum length, the gap walls and
 * the timeline start, and committed as ONE `timeline/toolEdit` action.
 *
 * Composition with a future sync lock: callers pass `isTrackEditable`; it is
 * the single place that decides which tracks may change, so sync-locked tracks
 * can be excluded (or, in a ripple-aware variant, shifted) without touching the
 * planners.
 */

export const DEFAULT_SPLIT_EDIT_FRAMES = 12;
export type SplitEditKind = "j" | "l";
export type TimelineSide = "video" | "audio";
export type EdgeName = "left" | "right";
export type MoveLimit =
  | "source-handle"
  | "neighbor-handle"
  | "minimum-length"
  | "gap"
  | "timeline-start";

const ADJACENT = 1e-4;

export interface EdgeMove {
  clipId: string;
  edge: EdgeName;
  /** Seconds the edge moves; positive is later in time. */
  delta: number;
  /**
   * Land exactly `delta` away instead of rounding it to whole frames. Used when
   * the delta is already the distance to a target time (playhead, other side's
   * cut), so an edge that sits off the frame grid still lands on the target.
   */
  exact?: boolean;
}
export interface AppliedEdgeMove {
  clipId: string;
  edge: EdgeName;
  requested: number;
  /** Seconds actually applied after frame snapping and clamping. */
  applied: number;
  /** The neighbour at the cut that moved with it, if the edge was a cut. */
  rolledNeighborId?: string;
  /** What stopped the move short of the (frame-snapped) request, if anything. */
  limit?: MoveLimit;
}
export interface EdgeMovePlan extends TimelineToolPlan {
  moves: AppliedEdgeMove[];
}
export interface EdgeMoveOptions {
  /** Which tracks may change. Defaults to unlocked tracks. */
  isTrackEditable?: (track: Track) => boolean;
  label?: string;
}

export const sideOfTrack = (track: Pick<Track, "type">): TimelineSide =>
  track.type === "audio" ? "audio" : "video";

interface Range {
  min: number;
  max: number;
  minLimit?: MoveLimit;
  maxLimit?: MoveLimit;
}

const frameRateOf = (project: Project): number =>
  Number.isFinite(project.settings.frameRate) && project.settings.frameRate > 0
    ? project.settings.frameRate
    : 30;

const edgeTime = (clip: Clip, edge: EdgeName): number =>
  edge === "left" ? clip.startTime : clip.startTime + clip.duration;

/** Working state shared by every move of one plan. */
class Workspace {
  readonly changed = new Map<string, Clip>();
  private readonly byId = new Map<string, { clip: Clip; track: Track }>();
  readonly frame: number;
  constructor(
    readonly project: Project,
    readonly editable: (track: Track) => boolean,
  ) {
    for (const track of project.timeline.tracks)
      for (const clip of track.clips) this.byId.set(clip.id, { clip, track });
    this.frame = 1 / frameRateOf(project);
  }
  clip(id: string): Clip | undefined {
    return this.changed.get(id) ?? this.byId.get(id)?.clip;
  }
  original(id: string): Clip | undefined {
    return this.byId.get(id)?.clip;
  }
  trackOf(id: string): Track | undefined {
    return this.byId.get(id)?.track;
  }
  /** The track's clips as they currently stand in this plan. */
  siblings(track: Track, except: string): Clip[] {
    return track.clips
      .filter((c) => c.id !== except)
      .map((c) => this.changed.get(c.id) ?? c);
  }
  sourceLimit(clip: Clip): number {
    const compoundId = getCompoundClipId(clip);
    const duration =
      (compoundId
        ? this.project.compoundClips?.find((c) => c.id === compoundId)?.content
            .duration
        : undefined) ??
      this.project.mediaLibrary.items.find((m) => m.id === clip.mediaId)
        ?.metadata.duration;
    return typeof duration === "number" && Number.isFinite(duration) && duration > 0
      ? duration
      : clip.outPoint;
  }
  isGenerated(clip: Clip): boolean {
    return (
      this.project.mediaLibrary.items.find((m) => m.id === clip.mediaId)?.type ===
        "image" || Boolean(clip.metadata?.motionClip)
    );
  }
}

function rateOf(clip: Clip): number {
  const value = clip.speed ?? 1;
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("The clip has an invalid playback speed.");
  return value;
}

function assertTrimmable(clip: Clip, track: Track, ws: Workspace): void {
  if (!ws.editable(track))
    throw new Error("Unlock the affected tracks before editing.");
  if (clip.speedKeyframes?.length || clip.freezeFrames?.length)
    throw new Error(
      "A clip with speed ramps or freeze frames can't be trimmed this way, because its source time isn't linear.",
    );
  if (
    !Number.isFinite(clip.startTime) ||
    clip.startTime < 0 ||
    !Number.isFinite(clip.duration) ||
    clip.duration <= 0 ||
    !Number.isFinite(clip.inPoint) ||
    clip.inPoint < 0 ||
    !Number.isFinite(clip.outPoint) ||
    clip.outPoint < clip.inPoint
  )
    throw new Error("The clip has invalid timeline or source bounds.");
  rateOf(clip);
}

/** How far one clip edge may move, from its source handles and min length. */
function handleRange(clip: Clip, side: EdgeName, ws: Workspace): Range {
  const minimum = Math.min(ws.frame, clip.duration);
  const rate = rateOf(clip);
  const available = Math.max(0, ws.sourceLimit(clip) - clip.outPoint);
  const generated = ws.isGenerated(clip);
  if (side === "right")
    return {
      min: minimum - clip.duration,
      minLimit: "minimum-length",
      max: generated
        ? Infinity
        : (clip.reversed ? clip.inPoint : available) / rate,
      maxLimit: "source-handle",
    };
  return {
    min: generated ? -Infinity : -(clip.reversed ? available : clip.inPoint) / rate,
    minLimit: "source-handle",
    max: clip.duration - minimum,
    maxLimit: "minimum-length",
  };
}

/** The clip with one edge moved by `e`, the source window following the edge. */
function moveEdge(clip: Clip, side: EdgeName, e: number, ws: Workspace): Clip {
  const rate = rateOf(clip);
  const shift = e * rate;
  const duration = clip.duration + (side === "right" ? e : -e);
  const startTime = side === "left" ? clip.startTime + e : clip.startTime;
  let { inPoint, outPoint } = clip;
  if (ws.isGenerated(clip)) outPoint = inPoint + duration * rate;
  else if (side === "right") {
    if (clip.reversed) inPoint -= shift;
    else outPoint += shift;
  } else if (clip.reversed) outPoint -= shift;
  else inPoint += shift;
  return {
    ...(resizeKeys(clip as Item, duration) as Clip),
    startTime,
    inPoint,
    outPoint,
  };
}

interface Resolved {
  applied: AppliedEdgeMove;
  clips: Clip[];
}

function resolveMove(ws: Workspace, move: EdgeMove): Resolved {
  if (!Number.isFinite(move.delta))
    throw new Error("The edit distance must be finite.");
  const clip = ws.clip(move.clipId);
  const track = ws.trackOf(move.clipId);
  if (!clip || !track) throw new Error("This timeline item is no longer available.");
  assertTrimmable(clip, track, ws);
  const { edge } = move;
  const others = ws.siblings(track, clip.id);
  const here = edgeTime(clip, edge);
  const neighbor = others.find((o) =>
    edge === "right"
      ? Math.abs(o.startTime - here) < ADJACENT
      : Math.abs(o.startTime + o.duration - here) < ADJACENT,
  );

  let range = handleRange(clip, edge, ws);
  const intersect = (other: Range) => {
    if (other.min > range.min) range = { ...range, min: other.min, minLimit: other.minLimit };
    if (other.max < range.max) range = { ...range, max: other.max, maxLimit: other.maxLimit };
  };
  if (neighbor) {
    assertTrimmable(neighbor, track, ws);
    const facing = handleRange(neighbor, edge === "right" ? "left" : "right", ws);
    // A neighbour's limits are the same limit seen from the other clip.
    intersect({
      ...facing,
      minLimit: facing.minLimit === "source-handle" ? "neighbor-handle" : facing.minLimit,
      maxLimit: facing.maxLimit === "source-handle" ? "neighbor-handle" : facing.maxLimit,
    });
  } else if (edge === "right") {
    const wall = Math.min(
      Infinity,
      ...others.filter((o) => o.startTime >= here - ADJACENT).map((o) => o.startTime - here),
    );
    intersect({ min: -Infinity, max: Math.max(0, wall), maxLimit: "gap" });
  } else {
    const wall = Math.max(
      -clip.startTime,
      ...others
        .filter((o) => o.startTime + o.duration <= clip.startTime + ADJACENT)
        .map((o) => o.startTime + o.duration - clip.startTime),
    );
    const toStart = wall === -clip.startTime;
    intersect({
      min: Math.min(0, wall),
      minLimit: toStart ? "timeline-start" : "gap",
      max: Infinity,
    });
  }

  const snapped = move.exact ? move.delta : Math.round(move.delta / ws.frame) * ws.frame;
  let applied = snapped;
  let limit: MoveLimit | undefined;
  if (snapped < range.min - EPS) {
    applied = range.min;
    limit = range.minLimit;
  } else if (snapped > range.max + EPS) {
    applied = range.max;
    limit = range.maxLimit;
  }
  if (Math.abs(applied) < EPS) applied = 0;
  const result: Resolved = {
    applied: {
      clipId: clip.id,
      edge,
      requested: move.delta,
      applied,
      ...(neighbor ? { rolledNeighborId: neighbor.id } : {}),
      ...(limit && Math.abs(applied - snapped) > EPS ? { limit } : {}),
    },
    clips: [],
  };
  if (applied !== 0) {
    result.clips.push(moveEdge(clip, edge, applied, ws));
    if (neighbor)
      result.clips.push(moveEdge(neighbor, edge === "right" ? "left" : "right", applied, ws));
  }
  return result;
}

/** Captions follow their source clip: shrink them to the clip's new bounds. */
function captionEdits(
  project: Project,
  before: ReadonlyMap<string, Clip>,
  after: ReadonlyMap<string, Clip>,
  frame: number,
): TimelineToolItemEdit[] {
  const edits: TimelineToolItemEdit[] = [];
  (project.textClips ?? []).forEach((caption: TextClip, index) => {
    const source = caption.metadata?.captionSourceClipId;
    if (typeof source !== "string") return;
    const clip = after.get(source);
    if (!clip || !before.has(source)) return;
    const a = Math.max(clip.startTime, caption.startTime);
    const b = Math.min(clip.startTime + clip.duration, caption.startTime + caption.duration);
    if (Math.abs(a - caption.startTime) < EPS && Math.abs(b - (caption.startTime + caption.duration)) < EPS)
      return;
    edits.push({
      kind: "text",
      id: caption.id,
      trackId: caption.trackId,
      index,
      before: caption as unknown as Item,
      after:
        b - a < Math.min(frame, caption.duration) - EPS
          ? null
          : ({ ...resizeKeys(caption as unknown as Item, b - a), startTime: a } as Item),
    });
  });
  return edits;
}

function toEdits(
  project: Project,
  ws: Workspace,
  frame: number,
): TimelineToolItemEdit[] {
  const edits: TimelineToolItemEdit[] = [];
  for (const track of project.timeline.tracks)
    track.clips.forEach((clip, index) => {
      const after = ws.changed.get(clip.id);
      if (after)
        edits.push({ kind: "media", id: clip.id, trackId: track.id, index, before: clip, after });
    });
  const before = new Map<string, Clip>();
  for (const id of ws.changed.keys()) before.set(id, ws.original(id)!);
  edits.push(...captionEdits(project, before, ws.changed, frame));
  for (const track of project.timeline.tracks)
    track.transitions.forEach((transition, index) => {
      const a = ws.changed.get(transition.clipAId) ?? ws.original(transition.clipAId);
      const b = transition.clipBId
        ? (ws.changed.get(transition.clipBId) ?? ws.original(transition.clipBId))
        : undefined;
      if (!ws.changed.has(transition.clipAId) && !ws.changed.has(transition.clipBId ?? ""))
        return;
      const duration = Math.min(
        transition.duration,
        a?.duration ?? 0,
        b?.duration ?? Infinity,
      );
      if (duration < transition.duration)
        edits.push({
          kind: "transition",
          id: transition.id,
          trackId: track.id,
          index,
          before: transition,
          after: duration > 0 ? { ...transition, duration } : null,
        });
    });
  return edits;
}

/**
 * Apply several single-track edge moves as one plan. Moves run in order against
 * the evolving state, so two moves that meet at one cut compose (the second
 * finds its edge already in place) instead of conflicting.
 */
export function planEdgeMoves(
  project: Project,
  moves: readonly EdgeMove[],
  options: EdgeMoveOptions = {},
): EdgeMovePlan {
  const label = options.label ?? "Trim edit";
  const ws = new Workspace(project, options.isTrackEditable ?? ((t) => !t.locked));
  const applied: AppliedEdgeMove[] = [];
  for (const move of moves) {
    const resolved = resolveMove(ws, move);
    applied.push(resolved.applied);
    for (const clip of resolved.clips) ws.changed.set(clip.id, clip);
  }
  const edits = toEdits(project, ws, ws.frame);
  const delta = applied.find((m) => m.applied !== 0)?.applied ?? 0;
  return { label, delta, edits, moves: applied };
}

export interface PreparedEdgeMove {
  primary: Clip;
  edge: EdgeName;
  /** Where the edit lands, without touching project data (drag feedback). */
  preview(delta: number): TimelineToolPreview;
  plan(delta: number): EdgeMovePlan;
}

/** Prepare once at pointer-down; preview per frame; plan once at commit. */
export function prepareEdgeMove(
  project: Project,
  options: { clipId: string; edge: EdgeName; label?: string } & EdgeMoveOptions,
): PreparedEdgeMove {
  const ws = new Workspace(project, options.isTrackEditable ?? ((t) => !t.locked));
  const primary = ws.clip(options.clipId);
  if (!primary) throw new Error("This timeline item is no longer available.");
  // Fail at pointer-down, not at commit, when the edge can't move at all.
  resolveMove(ws, { clipId: options.clipId, edge: options.edge, delta: 0 });
  const move = (delta: number) => ({
    clipId: options.clipId,
    edge: options.edge,
    delta,
  });
  return {
    primary,
    edge: options.edge,
    preview(delta) {
      const resolved = resolveMove(new Workspace(project, ws.editable), move(delta));
      const clips = resolved.clips;
      const next = clips[0] ?? primary;
      const neighbors = clips.slice(1).map((c) => ({
        trackId: c.trackId,
        startTime: c.startTime,
        duration: c.duration,
      }));
      const result: TimelineToolPreview = {
        startTime: next.startTime,
        duration: next.duration,
        inPoint: next.inPoint,
        outPoint: next.outPoint,
        delta: resolved.applied.applied,
      };
      if (neighbors.length) {
        result.neighbor = neighbors[0];
        result.neighbors = neighbors;
      }
      return result;
    },
    plan(delta) {
      return planEdgeMoves(project, [move(delta)], {
        isTrackEditable: options.isTrackEditable,
        label: options.label ?? "Trim edit (unlinked)",
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Split edits (J-cut / L-cut) and Extend Edit
// ---------------------------------------------------------------------------

export interface SplitEditOptions extends EdgeMoveOptions {
  /** Any clip at the cut, on either side, and which of its edges is the cut. */
  clipId: string;
  edge: EdgeName;
  /** The clip's linked partners; found from the project's link rules when omitted. */
  partnerIds?: readonly string[];
  /** "j": the audio cut moves earlier (audio leads); "l": later (audio trails). */
  kind: SplitEditKind;
  frames?: number;
  /** Which side moves. Defaults to audio; "video" makes the picture lead/trail. */
  side?: TimelineSide;
}

/**
 * A J-cut or L-cut: put the moving side's cut `frames` before (J) or after (L)
 * the other side's cut. Idempotent: the offset is measured from the reference
 * side's cut, not accumulated. Where the cut is between two clips, the
 * moving side rolls across it; at a clip end it trims/extends.
 */
export function planSplitEdit(project: Project, options: SplitEditOptions): EdgeMovePlan {
  const frames = options.frames ?? DEFAULT_SPLIT_EDIT_FRAMES;
  if (!Number.isFinite(frames) || frames < 0)
    throw new Error("The split edit length must be zero or more frames.");
  const side = options.side ?? "audio";
  const ws = new Workspace(project, options.isTrackEditable ?? ((t) => !t.locked));
  const own = ws.clip(options.clipId);
  const partners =
    options.partnerIds ??
    (own ? findLinkedPartners(own, project.timeline.tracks).map((p) => p.clip.id) : []);
  const ids = [...new Set([options.clipId, ...partners])];
  const members = ids.map((id) => {
    const clip = ws.clip(id);
    const track = ws.trackOf(id);
    if (!clip || !track) throw new Error("A linked clip is no longer available.");
    return { clip, side: sideOfTrack(track) };
  });
  const moving = members.filter((m) => m.side === side);
  const reference = members.find((m) => m.side !== side);
  if (!moving.length || !reference)
    throw new Error(
      "A split edit needs linked video and audio clips. Separate the audio first.",
    );
  const target =
    edgeTime(reference.clip, options.edge) +
    (options.kind === "l" ? 1 : -1) * (frames / frameRateOf(project));
  const plan = planEdgeMoves(
    project,
    moving.map((m) => ({
      clipId: m.clip.id,
      edge: options.edge,
      delta: target - edgeTime(m.clip, options.edge),
      exact: true,
    })),
    { ...options, label: options.kind === "l" ? "L-cut" : "J-cut" },
  );
  return plan;
}

export interface ExtendEditOptions extends EdgeMoveOptions {
  /** The clips whose edit point extends (already expanded to linked partners). */
  clipIds: readonly string[];
  edge: EdgeName;
  /** The playhead, in timeline seconds. */
  time: number;
  /** Restrict to one side; otherwise every given clip extends. */
  side?: TimelineSide | "both";
}

/**
 * Extend Edit: move the selected edit point to the playhead, on the chosen
 * side(s). Each clip is clamped independently by its own handles; the result
 * reports what each side really did.
 */
export function planExtendEdit(project: Project, options: ExtendEditOptions): EdgeMovePlan {
  if (!Number.isFinite(options.time) || options.time < 0)
    throw new Error("The playhead position is invalid.");
  const ws = new Workspace(project, options.isTrackEditable ?? ((t) => !t.locked));
  const side = options.side ?? "both";
  const moves: EdgeMove[] = [];
  for (const id of options.clipIds) {
    const clip = ws.clip(id);
    const track = ws.trackOf(id);
    if (!clip || !track) throw new Error("A selected clip is no longer available.");
    if (side !== "both" && sideOfTrack(track) !== side) continue;
    const delta = options.time - edgeTime(clip, options.edge);
    if (Math.abs(delta) > ADJACENT) moves.push({ clipId: id, edge: options.edge, delta, exact: true });
  }
  return planEdgeMoves(project, moves, {
    ...options,
    label: side === "video" ? "Extend video edit" : side === "audio" ? "Extend audio edit" : "Extend edit",
  });
}

const LINK_EPS = 0.01;
const rootId = (clip: Clip): string =>
  String(clip.metadata?.splitSourceClipId ?? clip.id);
const separatedFrom = (clip: Clip): string | undefined =>
  typeof clip.metadata?.separatedFromClipId === "string"
    ? clip.metadata.separatedFromClipId
    : undefined;

const overlapOf = (a: Clip, b: Clip): number =>
  Math.min(a.startTime + a.duration, b.startTime + b.duration) -
  Math.max(a.startTime, b.startTime);

/** The link rule alone: could these two clips be one A/V pair? */
function couldBeLinked(
  clip: Clip,
  own: Track,
  other: Clip,
  track: Track,
): boolean {
  const speed = clip.speed ?? 1;
  const otherSpeed = other.speed ?? 1;
  const aSource = separatedFrom(clip);
  const bSource = separatedFrom(other);
  const explicit =
    aSource === other.id ||
    bSource === clip.id ||
    aSource === rootId(other) ||
    bSource === rootId(clip) ||
    (aSource !== undefined && aSource === bSource);
  const legacy =
    clip.mediaId !== undefined &&
    clip.mediaId === other.mediaId &&
    (own.type === "audio") !== (track.type === "audio");
  // Merge Clips pairs two different files: they stay linked by group, not by a shared origin.
  const group = clip.metadata?.mergeGroupId;
  if (typeof group === "string" && group === other.metadata?.mergeGroupId) return overlapOf(clip, other) > LINK_EPS;
  if (!explicit && !legacy) return false;
  if (
    Math.abs(speed - otherSpeed) > LINK_EPS ||
    Boolean(clip.reversed) !== Boolean(other.reversed)
  )
    return false;
  const origin = clip.startTime - clip.inPoint / speed;
  if (Math.abs(origin - (other.startTime - other.inPoint / otherSpeed)) >= LINK_EPS)
    return false;
  return overlapOf(clip, other) > LINK_EPS;
}

/**
 * Clips on other tracks that are this clip's linked video/audio counterparts:
 * separated streams (explicit link) or same-media across audio and non-audio
 * tracks, with the same speed, direction and source origin, overlapping in
 * time. A head/tail trim of one side keeps the origin, so it never breaks the
 * link. A split edit, though, makes a clip overlap its neighbour's partner too
 * (every fragment of one source shares an origin), so a candidate is rejected
 * when another clip on this clip's track is a better-overlapping match for it.
 */
export function findLinkedPartners(
  clip: Clip,
  tracks: readonly Track[],
  index?: LinkIndex,
): Array<{ clip: Clip; track: Track }> {
  const own = tracks.find((t) => t.id === clip.trackId);
  if (!own) return [];
  const result: Array<{ clip: Clip; track: Track }> = [];
  const lanes = index ?? buildLinkIndex(tracks);
  const ownLane = lanes.get(own.id)!;
  for (const track of tracks) {
    if (track.id === clip.trackId) continue;
    for (const other of overlapping(lanes.get(track.id)!, clip)) {
      if (!couldBeLinked(clip, own, other, track)) continue;
      const mine = overlapOf(clip, other);
      // A rival must overlap `other` by more than `mine`, so it overlaps it.
      const rival = overlapping(ownLane, other).some(
        (c) =>
          c.id !== clip.id &&
          overlapOf(other, c) > mine + EPS &&
          couldBeLinked(other, track, c, own),
      );
      if (!rival) result.push({ clip: other, track });
    }
  }
  return result;
}

export interface LinkLane {
  /** Clips by start time. */
  sorted: Clip[];
  /** Original position of each sorted clip, to keep results in track order. */
  order: number[];
  /** Running maximum of the clip ends: nothing before the first index whose value exceeds t can overlap t. */
  maxEnd: number[];
}
/** Per-track time index so partner lookups for many clips are not O(n) each. */
export type LinkIndex = Map<string, LinkLane>;

/**
 * A lane's index is a pure function of its clip list. The same lane is indexed again by every
 * findLinkedPartners / splitEditOffsets call that is not handed an index (one per visible clip
 * per commit in the timeline), so keep the last one per clip array. A hit is validated against the
 * clips themselves (same length, same objects in the same slots), so an array edited in place is
 * simply rebuilt.
 */
const laneCache = new WeakMap<readonly Clip[], { source: Clip[]; lane: LinkLane }>();

function buildLane(clips: readonly Clip[]): LinkLane {
  const cached = laneCache.get(clips);
  if (cached && cached.source.length === clips.length && cached.source.every((clip, i) => clip === clips[i])) {
    return cached.lane;
  }
  const order = clips.map((_, i) => i).sort((a, b) => clips[a].startTime - clips[b].startTime || a - b);
  const sorted = order.map((i) => clips[i]);
  const maxEnd: number[] = [];
  let run = -Infinity;
  for (const c of sorted) maxEnd.push((run = Math.max(run, c.startTime + c.duration)));
  const lane = { sorted, order, maxEnd };
  laneCache.set(clips, { source: [...clips], lane });
  return lane;
}

export function buildLinkIndex(tracks: readonly Track[]): LinkIndex {
  const index: LinkIndex = new Map();
  for (const track of tracks) index.set(track.id, buildLane(track.clips));
  return index;
}

/** Clips of a lane that may overlap `clip` by more than LINK_EPS, in track order. */
function overlapping(lane: LinkLane, clip: Clip): Clip[] {
  const from = clip.startTime + LINK_EPS;
  const to = clip.startTime + clip.duration - LINK_EPS;
  let lo = 0,
    hi = lane.maxEnd.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lane.maxEnd[mid] > from) hi = mid;
    else lo = mid + 1;
  }
  const hits: number[] = [];
  for (let i = lo; i < lane.sorted.length && lane.sorted[i].startTime < to; i++) hits.push(i);
  return hits.sort((a, b) => lane.order[a] - lane.order[b]).map((i) => lane.sorted[i]);
}

/**
 * How far this clip's edit points sit from its linked partner's, for the
 * on-clip offset badge. A positive `end` means this clip runs past the
 * partner's tail (an L-cut when this is the audio); a negative `start` means
 * it begins before the partner (a J-cut). Null when nothing is offset.
 */
export function splitEditOffsets(
  clip: Clip,
  tracks: readonly Track[],
  frameRate: number,
): { start: number; end: number; partnerId: string } | null {
  const half = 0.5 / (frameRate > 0 ? frameRate : 30);
  const own = tracks.find((t) => t.id === clip.trackId);
  if (!own) return null;
  let best: { start: number; end: number; partnerId: string } | null = null;
  for (const { clip: other, track } of findLinkedPartners(clip, tracks)) {
    if (sideOfTrack(track) === sideOfTrack(own)) continue;
    const start = clip.startTime - other.startTime;
    const end = clip.startTime + clip.duration - (other.startTime + other.duration);
    if (Math.abs(start) < half && Math.abs(end) < half) continue;
    if (!best || Math.abs(start) + Math.abs(end) > Math.abs(best.start) + Math.abs(best.end))
      best = { start, end, partnerId: other.id };
  }
  return best;
}
