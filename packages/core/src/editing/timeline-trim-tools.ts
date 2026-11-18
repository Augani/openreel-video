import { mediaTrimBounds } from "../media/bins";
import type { Project } from "../types/project";
import type { Clip } from "../types/timeline";
import type { TextClip } from "../text/types";
import { getCompoundClipId } from "../timeline/timeline-items";
import { SPEED_MAX, SPEED_MIN } from "../video/speed-engine";
import {
  EPS,
  entries,
  resizeKeys,
  type Entry,
  type Item,
  type PreparedTimelineToolEdit,
  type TimelineToolItemEdit,
  type TimelineToolMode,
  type TimelineToolPlan,
  type TimelineToolPreview,
} from "./timeline-tool-edit";

type TrimMode = Extract<TimelineToolMode, "roll" | "slide" | "stretch">;
type Edge = "left" | "right";
const ADJACENT = 1e-4;
const LABELS: Record<TrimMode, string> = {
  roll: "Rolling edit",
  slide: "Slide clip",
  stretch: "Rate stretch",
};

interface Range {
  min: number;
  max: number;
}
/** One clip taking part in an edit, with the neighbours it is bound to. */
interface Member {
  entry: Entry;
  clip: Clip;
  prev?: Clip;
  next?: Clip;
}

/**
 * Roll, Slide and Rate Stretch share one prepared-edit contract with ripple and
 * slip: prepare once at pointer-down, preview per frame without touching
 * project data, and plan one atomic `timeline/toolEdit` payload at commit.
 *
 * Delta convention (timeline seconds, positive is later in time):
 * - roll: movement of the cut
 * - slide: movement of the clip
 * - stretch: movement of the dragged edge
 */
export function prepareTrimToolEdit(
  project: Project,
  options: {
    mode: TrimMode;
    itemId: string;
    linkedIds?: readonly string[];
    edge?: Edge;
  },
): PreparedTimelineToolEdit {
  const { mode } = options;
  const edge: Edge = options.edge ?? "right";
  const all = entries(project);
  const byId = new Map(all.map((entry) => [entry.item.id, entry]));
  const tracksById = new Map(project.timeline.tracks.map((t) => [t.id, t]));
  const mediaById = new Map(project.mediaLibrary.items.map((m) => [m.id, m]));
  const compoundsById = new Map(
    (project.compoundClips ?? []).map((c) => [c.id, c]),
  );
  const fps =
    Number.isFinite(project.settings.frameRate) && project.settings.frameRate > 0
      ? project.settings.frameRate
      : 30;
  const frame = 1 / fps;

  // Restricted subclips keep trims inside their window.
  const trimFloor = (clip: Clip) => mediaTrimBounds(mediaById.get(clip.mediaId))?.min ?? 0;
  const sourceLimit = (clip: Clip) => {
    const compoundId = getCompoundClipId(clip);
    const duration =
      (compoundId ? compoundsById.get(compoundId)?.content.duration : undefined) ??
      mediaById.get(clip.mediaId)?.metadata.duration;
    const full =
      typeof duration === "number" && Number.isFinite(duration) && duration > 0
        ? duration
        : clip.outPoint;
    const bounds = mediaTrimBounds(mediaById.get(clip.mediaId));
    return bounds ? Math.min(full, bounds.max) : full;
  };
  const isGenerated = (clip: Clip) =>
    mediaById.get(clip.mediaId)?.type === "image" ||
    Boolean(clip.metadata?.motionClip);
  const rateOf = (clip: Clip) => {
    const value = clip.speed ?? 1;
    if (!Number.isFinite(value) || value <= 0)
      throw new Error("The clip has an invalid playback speed.");
    return value;
  };

  const primaryEntry = byId.get(options.itemId);
  if (!primaryEntry) throw new Error("This timeline item is no longer available.");
  if (primaryEntry.kind !== "media")
    throw new Error(`${LABELS[mode]} works on video, audio and image clips.`);
  const primary = primaryEntry.item as Clip;

  const ids = [...new Set([options.itemId, ...(options.linkedIds ?? [])])];
  const members: Member[] = ids.map((id) => {
    const entry = byId.get(id);
    if (!entry) throw new Error("A linked item is no longer available.");
    if (entry.kind !== "media")
      throw new Error(`${LABELS[mode]} works on video, audio and image clips.`);
    const clip = entry.item as Clip;
    const track = tracksById.get(clip.trackId);
    if (!track || track.locked)
      throw new Error("Unlock the affected tracks before editing.");
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
    if (
      Math.abs(clip.startTime - primary.startTime) > EPS ||
      Math.abs(clip.duration - primary.duration) > EPS
    )
      throw new Error(
        `The linked edit points differ. Align them or turn off Linked selection before using ${LABELS[mode].toLowerCase()}.`,
      );
    const others = track.clips.filter((other) => other.id !== clip.id);
    const prev = others.find(
      (o) => Math.abs(o.startTime + o.duration - clip.startTime) < ADJACENT,
    );
    const next = others.find(
      (o) => Math.abs(o.startTime - (clip.startTime + clip.duration)) < ADJACENT,
    );
    return { entry, clip, prev, next };
  });

  /**
   * Roll and slide trim a neighbour's source window by `delta * speed`, which
   * only holds for a constant rate. Ramps and freeze frames use the nonlinear
   * speed-engine mapping (and the clip duration no longer equals the source
   * span), so refuse with an explanation instead of silently mis-trimming.
   */
  const assertLinearSource = (clip: Clip) => {
    if (clip.speedKeyframes?.length || clip.freezeFrames?.length)
      throw new Error(
        `${LABELS[mode]} can't trim a clip with speed ramps or freeze frames, because its source time isn't linear. Remove them or use the Selection tool.`,
      );
  };
  /** Movement range of one clip edge, bounded by source handles and one frame. */
  const edgeRange = (clip: Clip, side: Edge): Range => {
    assertLinearSource(clip);
    const minimum = Math.min(frame, clip.duration);
    const rate = rateOf(clip);
    const available = Math.max(0, sourceLimit(clip) - clip.outPoint);
    const generated = isGenerated(clip);
    if (side === "right")
      return {
        min: minimum - clip.duration,
        max: generated
          ? Infinity
          : (clip.reversed ? clip.inPoint - trimFloor(clip) : available) / rate,
      };
    return {
      min: generated
        ? -Infinity
        : -(clip.reversed ? available : clip.inPoint - trimFloor(clip)) / rate,
      max: clip.duration - minimum,
    };
  };
  /** The clip with one edge moved by `e`, source window following the edge. */
  const moveEdge = (clip: Clip, side: Edge, e: number): Clip => {
    const rate = rateOf(clip);
    const shift = e * rate;
    const duration = clip.duration + (side === "right" ? e : -e);
    const startTime = side === "left" ? clip.startTime + e : clip.startTime;
    let { inPoint, outPoint } = clip;
    if (isGenerated(clip)) outPoint = inPoint + duration * rate;
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
  };

  // Per-mode legal delta range, intersected over every linked member.
  let minimum = -Infinity;
  let maximum = Infinity;
  const intersect = (range: Range) => {
    minimum = Math.max(minimum, range.min);
    maximum = Math.min(maximum, range.max);
  };
  if (mode === "stretch") {
    for (const { clip } of members) {
      if (isGenerated(clip))
        throw new Error("Rate stretch requires a video or audio source.");
      if (clip.speedKeyframes?.length || clip.freezeFrames?.length)
        throw new Error("Remove speed ramps and freeze frames before rate stretching.");
      const span = clip.outPoint - clip.inPoint;
      if (!(span > EPS)) throw new Error("The clip has no source range to stretch.");
      const shortest = Math.max(Math.min(frame, clip.duration), span / SPEED_MAX);
      const longest = span / SPEED_MIN;
      if (edge === "right") {
        intersect({
          min: shortest - clip.duration,
          max: longest - clip.duration,
        });
      } else {
        intersect({
          min: Math.max(clip.duration - longest, -clip.startTime),
          max: clip.duration - shortest,
        });
      }
      // Rate stretch never ripples: it may grow only into free space.
      const track = tracksById.get(clip.trackId)!;
      if (edge === "right") {
        const end = clip.startTime + clip.duration;
        const wall = Math.min(
          Infinity,
          ...track.clips
            .filter((o) => o.id !== clip.id && o.startTime >= end - ADJACENT)
            .map((o) => o.startTime - end),
        );
        intersect({ min: -Infinity, max: Math.max(0, wall) });
      } else {
        const wall = Math.max(
          -Infinity,
          ...track.clips
            .filter(
              (o) => o.id !== clip.id && o.startTime + o.duration <= clip.startTime + ADJACENT,
            )
            .map((o) => o.startTime + o.duration - clip.startTime),
        );
        intersect({ min: Math.min(0, wall), max: Infinity });
      }
    }
  } else {
    for (const member of members) {
      const { clip, prev, next } = member;
      if (mode === "roll") {
        const left = edge === "right" ? clip : prev;
        const right = edge === "right" ? next : clip;
        if (!left || !right)
          throw new Error("Rolling edit needs an adjacent clip at this cut.");
        intersect(edgeRange(left, "right"));
        intersect(edgeRange(right, "left"));
      } else {
        if (!prev || !next)
          throw new Error("Slide needs an adjacent clip on both sides.");
        intersect(edgeRange(prev, "right"));
        intersect(edgeRange(next, "left"));
      }
    }
  }
  if (minimum > EPS || maximum < -EPS || minimum > maximum + EPS)
    throw new Error("The source bounds do not contain this clip.");

  const bound = (delta: number) => {
    if (!Number.isFinite(delta)) throw new Error("The edit distance must be finite.");
    const value = Math.max(
      minimum,
      Math.min(maximum, Math.round(delta / frame) * frame),
    );
    return Math.abs(value) < EPS ? 0 : value;
  };

  /** New clip values for one member given the bounded delta. */
  const resolve = (member: Member, d: number) => {
    const { clip, prev, next } = member;
    const changed = new Map<string, Clip>();
    if (mode === "roll") {
      const left = edge === "right" ? clip : prev!;
      const right = edge === "right" ? next! : clip;
      changed.set(left.id, moveEdge(left, "right", d));
      changed.set(right.id, moveEdge(right, "left", d));
    } else if (mode === "slide") {
      changed.set(prev!.id, moveEdge(prev!, "right", d));
      changed.set(next!.id, moveEdge(next!, "left", d));
      changed.set(clip.id, { ...clip, startTime: clip.startTime + d });
    } else {
      const duration = clip.duration + (edge === "right" ? d : -d);
      changed.set(clip.id, {
        ...(resizeKeys(clip as Item, duration) as Clip),
        startTime: edge === "left" ? clip.startTime + d : clip.startTime,
        speed: Math.min(
          SPEED_MAX,
          Math.max(SPEED_MIN, (clip.outPoint - clip.inPoint) / duration),
        ),
      });
    }
    return changed;
  };

  const preview = (delta: number): TimelineToolPreview => {
    const d = bound(delta);
    const member = members.find((m) => m.clip.id === primary.id)!;
    const changed = resolve(member, d);
    const next = changed.get(primary.id)!;
    const result: TimelineToolPreview = {
      startTime: next.startTime,
      duration: next.duration,
      inPoint: next.inPoint,
      outPoint: next.outPoint,
      delta: d,
    };
    if (mode === "stretch") result.speed = next.speed;
    else {
      const others = [...changed.values()]
        .filter((c) => c.id !== primary.id)
        .map((c) => ({
          trackId: c.trackId,
          startTime: c.startTime,
          duration: c.duration,
        }));
      if (others.length) {
        result.neighbor = others[0];
        result.neighbors = others;
      }
    }
    return result;
  };

  const plan = (delta: number): TimelineToolPlan => {
    const d = bound(delta);
    const label = LABELS[mode];
    if (!d) return { label, delta: 0, edits: [] };
    const replacements = new Map<string, Item | null>();
    const put = (entry: Entry, after: Item | null) => {
      if (tracksById.get(entry.item.trackId)?.locked)
        throw new Error("Unlock every affected track before editing.");
      replacements.set(entry.item.id, after);
    };
    // Explicit caption provenance follows its source clip.
    const captionsBySource = new Map<string, Entry[]>();
    for (const entry of all) {
      if (entry.kind !== "text") continue;
      const source = (entry.item as TextClip).metadata?.captionSourceClipId;
      if (typeof source !== "string") continue;
      const list = captionsBySource.get(source) ?? [];
      list.push(entry);
      captionsBySource.set(source, list);
    }
    const memberIds = new Set(members.map((m) => m.clip.id));
    const mapCaption = (before: Clip, after: Clip, caption: Entry) => {
      const start = caption.item.startTime;
      const end = start + caption.item.duration;
      let a = start;
      let b = end;
      if (mode === "slide" && memberIds.has(before.id)) {
        a += d;
        b += d;
      } else if (mode === "stretch") {
        const anchor = edge === "right" ? before.startTime : before.startTime + before.duration;
        const scale = after.duration / before.duration;
        a = anchor + (a - anchor) * scale;
        b = anchor + (b - anchor) * scale;
      }
      a = Math.max(after.startTime, a);
      b = Math.min(after.startTime + after.duration, b);
      if (Math.abs(a - start) < EPS && Math.abs(b - end) < EPS) return;
      put(
        caption,
        b - a < Math.min(frame, caption.item.duration) - EPS
          ? null
          : { ...resizeKeys(caption.item, b - a), startTime: a },
      );
    };

    // Captions attached only through a track group (no captionSourceClipId)
    // follow the clip they overlap, like they do for ripple.
    const groupCaptions = new Map<string, Entry[]>();
    for (const entry of all) {
      if (entry.kind !== "text") continue;
      if (typeof (entry.item as TextClip).metadata?.captionSourceClipId === "string")
        continue;
      const groupId = tracksById.get(entry.item.trackId)?.groupId;
      if (!groupId) continue;
      const list = groupCaptions.get(groupId) ?? [];
      list.push(entry);
      groupCaptions.set(groupId, list);
    }

    const clipChanges = new Map<string, Clip>();
    for (const member of members)
      for (const [id, clip] of resolve(member, d)) clipChanges.set(id, clip);
    for (const [id, clip] of clipChanges) {
      const entry = byId.get(id)!;
      put(entry, clip);
    }
    // Selected clips own overlapping caption text before their neighbours do.
    const ordered = [...clipChanges].sort(
      ([a], [b]) => Number(memberIds.has(b)) - Number(memberIds.has(a)),
    );
    for (const [id, clip] of ordered) {
      const before = byId.get(id)!.item as Clip;
      for (const caption of captionsBySource.get(id) ?? [])
        if (!replacements.has(caption.item.id)) mapCaption(before, clip, caption);
    }
    for (const [id, clip] of ordered) {
      const before = byId.get(id)!.item as Clip;
      const groupId = tracksById.get(before.trackId)?.groupId;
      if (!groupId) continue;
      for (const caption of groupCaptions.get(groupId) ?? []) {
        if (replacements.has(caption.item.id)) continue;
        const start = caption.item.startTime;
        const end = start + caption.item.duration;
        if (end <= before.startTime + EPS || start >= before.startTime + before.duration - EPS)
          continue;
        mapCaption(before, clip, caption);
      }
    }

    const edits: TimelineToolItemEdit[] = [];
    for (const entry of all)
      if (replacements.has(entry.item.id))
        edits.push({
          kind: entry.kind,
          id: entry.item.id,
          trackId: entry.item.trackId,
          index: entry.index,
          before: entry.item,
          after: replacements.get(entry.item.id)!,
        });
    for (const track of project.timeline.tracks)
      track.transitions.forEach((transition, index) => {
        if (
          !replacements.has(transition.clipAId) &&
          !replacements.has(transition.clipBId ?? "")
        )
          return;
        const a = (replacements.get(transition.clipAId) ??
          byId.get(transition.clipAId)?.item) as Clip | undefined;
        const b = (replacements.get(transition.clipBId ?? "") ??
          byId.get(transition.clipBId ?? "")?.item) as Clip | undefined;
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
    return { label, delta: d, edits };
  };

  return { primary, mode, preview, plan };
}
