import { clonePlain } from "./clone-plain";
import { reconcileGraphicInstances } from "../graphic-templates/instances";
import { mediaTrimBounds } from "../media/bins";
import { prepareTrimToolEdit } from "./timeline-trim-tools";
import { withSyncLockedRipple } from "./ripple-delete";
import type { Project } from "../types/project";
import type {
  Clip,
  Keyframe,
  Marker,
  Subtitle,
  Track,
  Transition,
} from "../types/timeline";
import type {
  ResolvedTimelineItem,
  TimelineItemKind,
} from "../timeline/timeline-items";
import { getCompoundClipId } from "../timeline/timeline-items";
import { calculateProjectDuration } from "../timeline/project-duration";
import type { CompoundClipInstance } from "../timeline/nested-sequence-engine";
import type { Mask } from "../video/mask-engine";
import type { ParticleEffect } from "../effects/particle-types";

export type Item = ResolvedTimelineItem["item"] & { readonly trackId: string };
type EditData =
  | Item
  | Transition
  | CompoundClipInstance
  | Mask
  | ParticleEffect
  | Marker
  | Subtitle
  | Track;
/** Timeline-level data (not owned by a track) that a range edit can ripple. */
export const timelineLists = {
  marker: "markers",
  subtitle: "subtitles",
} as const;
export type TimelineToolMode = "ripple" | "slip" | "roll" | "slide" | "stretch";
export interface TimelineToolItemEdit {
  kind:
    | TimelineItemKind
    | "transition"
    | "nested"
    | "mask"
    | "particle"
    | "marker"
    | "subtitle"
    | "track";
  id: string;
  trackId: string;
  index: number;
  before: EditData | null;
  after: EditData | null;
}
export interface TimelineToolPlan {
  label: string;
  delta: number;
  edits: TimelineToolItemEdit[];
}
export interface TimelineToolPreview {
  startTime: number;
  duration: number;
  inPoint?: number;
  outPoint?: number;
  delta: number;
  /** New playback rate of the primary clip (rate stretch only). */
  speed?: number;
  /** Where the adjoining clip lands (roll and slide), for a second ghost. */
  neighbor?: { trackId: string; startTime: number; duration: number };
  /** Every adjoining clip the edit changes (slide adjusts two), for ghosts. */
  neighbors?: { trackId: string; startTime: number; duration: number }[];
}
export interface PreparedTimelineToolEdit {
  primary: Item;
  mode: TimelineToolMode;
  preview(delta: number): TimelineToolPreview;
  plan(delta: number): TimelineToolPlan;
}
export const collections = {
  text: "textClips",
  shape: "shapeClips",
  svg: "svgClips",
  sticker: "stickerClips",
  adjustment: "adjustmentLayers",
  motion: "motionInstances",
} as const;
export const ownedCollections = { nested: "nestedInstances", mask: "masks", particle: "particleEffects" } as const;
export const EPS = 1e-7;
export interface Entry {
  kind: TimelineItemKind;
  item: Item;
  index: number;
}
export function entries(project: Project): Entry[] {
  const result: Entry[] = [];
  for (const track of project.timeline.tracks)
    track.clips.forEach((item, index) =>
      result.push({ kind: "media", item, index }),
    );
  for (const [kind, field] of Object.entries(collections))
    (
      project[field as (typeof collections)[keyof typeof collections]] ?? []
    ).forEach(
      (item, index) =>
        typeof item.trackId === "string" &&
        result.push({
          kind: kind as TimelineItemKind,
          item: item as Item,
          index,
        }),
    );
  return result;
}
function sourceLimit(project: Project, clip: Clip): number {
  const compoundId = getCompoundClipId(clip);
  const compound = project.compoundClips?.find(
    (item) => item.id === compoundId,
  );
  const duration =
    compound?.content.duration ??
    project.mediaLibrary.items.find((item) => item.id === clip.mediaId)
      ?.metadata.duration;
  return typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration > 0
    ? duration
    : clip.outPoint;
}
function speed(clip: Clip): number {
  const value = clip.speed ?? 1;
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("The clip has an invalid playback speed.");
  return value;
}
export function resizeKeys(item: Item, duration: number): Item {
  if (!("keyframes" in item)) return { ...item, duration };
  return {
    ...item,
    duration,
    keyframes: item.keyframes.map((key: Keyframe) =>
      key.id.startsWith("kf-exit-")
        ? {
            ...key,
            time: Math.max(
              0,
              Math.min(duration, duration + key.time - item.duration),
            ),
          }
        : key,
    ),
  } as Item;
}

function captionIntervals(items: Entry[]) {
  const sorted = [...items].sort((a, b) => a.item.startTime - b.item.startTime);
  const ends: number[] = [];
  let maximum = -Infinity;
  for (const entry of sorted) {
    maximum = Math.max(maximum, entry.item.startTime + entry.item.duration);
    ends.push(maximum);
  }
  return (start: number, end: number) => {
    let low = 0,
      high = ends.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ends[middle] <= start + EPS) low = middle + 1;
      else high = middle;
    }
    const result: Entry[] = [];
    for (
      let i = low;
      i < sorted.length && sorted[i].item.startTime < end - EPS;
      i++
    ) {
      if (sorted[i].item.startTime + sorted[i].item.duration > start + EPS)
        result.push(sorted[i]);
    }
    return result;
  };
}

/** Prepare once at pointer-down; previewing a frame never walks the project or copies media. */
/** What the ripple planners need to know about the media behind a clip (shared by the single and the batched planner). */
export interface RippleContext {
  trimFloor(clip: Clip): number;
  limit(clip: Clip): number;
  isGenerated(item: Item): boolean;
}

export function createRippleContext(
  mediaById: ReadonlyMap<string, Project["mediaLibrary"]["items"][number]>,
  compoundsById: ReadonlyMap<string, { content: { duration: number } }>,
): RippleContext {
  const trimFloor = (clip: Clip) => mediaTrimBounds(mediaById.get(clip.mediaId))?.min ?? 0;
  const limit = (clip: Clip) => {
    const compoundId = getCompoundClipId(clip);
    const duration =
      (compoundId
        ? compoundsById.get(compoundId)?.content.duration
        : undefined) ?? mediaById.get(clip.mediaId)?.metadata.duration;
    const full =
      typeof duration === "number" && Number.isFinite(duration) && duration > 0
        ? duration
        : clip.outPoint;
    const bounds = mediaTrimBounds(mediaById.get(clip.mediaId));
    return bounds ? Math.min(full, bounds.max) : full;
  };
  const isGenerated = (item: Item) =>
    mediaById.get((item as Clip).mediaId)?.type === "image" ||
    Boolean((item as Clip).metadata?.motionClip);
  return { trimFloor, limit, isGenerated };
}

/** Narrows the allowed ripple delta by one edit item (the non-slip branch of the bounds loop). */
export function narrowRippleBounds(
  bounds: { minimum: number; maximum: number },
  item: Item,
  kind: TimelineItemKind,
  edge: "left" | "right",
  frame: number,
  ctx: RippleContext,
): void {
  if (edge === "left") bounds.maximum = Math.min(bounds.maximum, item.duration - frame);
  else bounds.minimum = Math.max(bounds.minimum, frame - item.duration);
  if (kind === "media" && !ctx.isGenerated(item)) {
    const clip = item as Clip,
      rate = speed(clip),
      available = Math.max(0, ctx.limit(clip) - clip.outPoint);
    if (edge === "left")
      bounds.minimum = Math.max(
        bounds.minimum,
        -(clip.reversed ? available : clip.inPoint - ctx.trimFloor(clip)) / rate,
      );
    else
      bounds.maximum = Math.min(
        bounds.maximum,
        (clip.reversed ? clip.inPoint - ctx.trimFloor(clip) : available) / rate,
      );
  }
}

/** The ripple-trimmed copy of one edit item (`item` is the current item, which is also the one the trim is read from). */
export function rippleResizeItem(
  item: Item,
  kind: TimelineItemKind,
  edge: "left" | "right",
  delta: number,
  durationDelta: number,
  ctx: RippleContext,
): Item {
  let next = resizeKeys(item, item.duration + durationDelta);
  if (kind === "media") {
    const clip = next as Clip,
      original = item as Clip,
      shift = delta * speed(original);
    if (ctx.isGenerated(next))
      next = {
        ...clip,
        outPoint: original.inPoint + clip.duration * speed(original),
      };
    else if (edge === "left")
      next = original.reversed
        ? { ...clip, outPoint: original.outPoint - shift }
        : { ...clip, inPoint: original.inPoint + shift };
    else
      next = original.reversed
        ? { ...clip, inPoint: original.inPoint - shift }
        : { ...clip, outPoint: original.outPoint + shift };
  }
  return next;
}

export function prepareTimelineToolEdit(
  project: Project,
  options: {
    mode: TimelineToolMode;
    itemId: string;
    linkedIds?: readonly string[];
    edge?: "left" | "right";
  },
): PreparedTimelineToolEdit {
  const prepared = prepareBaseToolEdit(project, options);
  if (options.mode !== "ripple") return prepared;
  // Ripple trim is a ripple-type edit: sync-locked tracks follow the cut.
  const primary = prepared.primary;
  return withSyncLockedRipple(
    project,
    prepared,
    primary.startTime + primary.duration,
    options.edge ?? "right",
  );
}

function prepareBaseToolEdit(
  project: Project,
  options: {
    mode: TimelineToolMode;
    itemId: string;
    linkedIds?: readonly string[];
    edge?: "left" | "right";
  },
): PreparedTimelineToolEdit {
  if (
    options.mode === "roll" ||
    options.mode === "slide" ||
    options.mode === "stretch"
  )
    return prepareTrimToolEdit(project, { ...options, mode: options.mode });
  const all = entries(project),
    byId = new Map(all.map((entry) => [entry.item.id, entry]));
  const tracksById = new Map(
    project.timeline.tracks.map((track) => [track.id, track]),
  );
  const mediaById = new Map(
    project.mediaLibrary.items.map((media) => [media.id, media]),
  );
  const compoundsById = new Map(
    (project.compoundClips ?? []).map((compound) => [compound.id, compound]),
  );
  const ctx = createRippleContext(mediaById, compoundsById);
  const { trimFloor, limit, isGenerated } = ctx;
  const primary = byId.get(options.itemId);
  if (!primary) throw new Error("This timeline item is no longer available.");
  const linked = [
    ...new Set([options.itemId, ...(options.linkedIds ?? [])]),
  ].map((id) => {
    const entry = byId.get(id);
    if (!entry) throw new Error("A linked item is no longer available.");
    const track = tracksById.get(entry.item.trackId);
    if (!track || track.locked)
      throw new Error("Unlock the affected tracks before editing.");
    return entry;
  });
  const edge = options.edge ?? "right";
  const selected = linked;
  for (const { item, kind } of selected) {
    if (
      !Number.isFinite(item.startTime) ||
      item.startTime < 0 ||
      !Number.isFinite(item.duration) ||
      item.duration <= 0
    )
      throw new Error("The item has invalid timeline bounds.");
    if (kind === "media") {
      const clip = item as Clip;
      speed(clip);
      if (
        !Number.isFinite(clip.inPoint) ||
        clip.inPoint < 0 ||
        !Number.isFinite(clip.outPoint) ||
        clip.outPoint < clip.inPoint
      )
        throw new Error("The clip has invalid source bounds.");
    }
  }
  const frame = selected.reduce(
    (minimum, entry) => Math.min(minimum, entry.item.duration),
    1 /
      (Number.isFinite(project.settings.frameRate) &&
      project.settings.frameRate > 0
        ? project.settings.frameRate
        : 30),
  );
  const primaryGenerated =
    primary.kind === "media" && isGenerated(primary.item);
  const primaryRate =
    primary.kind === "media" ? speed(primary.item as Clip) : 1;
  const captionsBySource = new Map<string, Entry[]>();
  const captionsByGroup = new Map<string, Entry[]>();
  for (const entry of all) {
    if (entry.kind !== "text") continue;
    const sourceId = (entry.item as import("../text/types").TextClip).metadata
      ?.captionSourceClipId;
    if (typeof sourceId === "string") {
      const source = captionsBySource.get(sourceId) ?? [];
      source.push(entry);
      captionsBySource.set(sourceId, source);
    } else {
      const groupId = tracksById.get(entry.item.trackId)?.groupId;
      if (groupId) {
        const group = captionsByGroup.get(groupId) ?? [];
        group.push(entry);
        captionsByGroup.set(groupId, group);
      }
    }
  }
  const groupCaptionRanges = new Map(
    [...captionsByGroup].map(([id, items]) => [id, captionIntervals(items)]),
  );
  const selectedIds = new Set(selected.map((entry) => entry.item.id));
  const splitRoots = new Map<string, string[]>();
  for (const entry of all) if (entry.kind === "media") {
    const root = (entry.item as Clip).metadata?.splitSourceClipId;
    if (typeof root === "string") {
      const ids = splitRoots.get(root) ?? []; ids.push(entry.item.id); splitRoots.set(root, ids);
    }
  }
  let minimum = -Infinity,
    maximum = Infinity;
  for (const entry of selected) {
    const item = entry.item;
    if (options.mode === "slip") {
      if (
        entry.kind !== "media" ||
        mediaById.get((item as Clip).mediaId)?.type === "image" ||
        (item as Clip).metadata?.motionClip
      )
        throw new Error("Slip requires a video, audio or compound source.");
      const clip = item as Clip,
        rate = speed(clip);
      minimum = Math.max(minimum, -(clip.inPoint - trimFloor(clip)) / rate);
      maximum = Math.min(maximum, (limit(clip) - clip.outPoint) / rate);
    } else {
      if (
        Math.abs(item.startTime - primary.item.startTime) > EPS ||
        Math.abs(item.duration - primary.item.duration) > EPS
      ) {
        throw new Error(
          "The linked edit points differ. Align them or turn off Linked selection before ripple trimming.",
        );
      }
      const bounds = { minimum, maximum };
      narrowRippleBounds(bounds, item, entry.kind, edge, frame, ctx);
      ({ minimum, maximum } = bounds);
    }
  }
  if (minimum > EPS || maximum < -EPS || minimum > maximum + EPS)
    throw new Error("The source bounds do not contain this clip.");
  function preview(delta: number): TimelineToolPreview {
    if (!Number.isFinite(delta))
      throw new Error("The edit distance must be finite.");
    const bounded = Math.max(
      minimum,
      Math.min(maximum, Math.round(delta / frame) * frame),
    );
    const item = primary!.item;
    const result: TimelineToolPreview = {
      startTime: item.startTime,
      duration: item.duration,
      delta: Math.abs(bounded) < EPS ? 0 : bounded,
    };
    if (options.mode === "ripple")
      result.duration += edge === "left" ? -result.delta : result.delta;
    if (primary!.kind === "media") {
      const clip = item as Clip,
        shift = result.delta * primaryRate;
      result.inPoint = clip.inPoint;
      result.outPoint = clip.outPoint;
      if (options.mode === "ripple" && primaryGenerated)
        result.outPoint = result.inPoint + result.duration * primaryRate;
      else if (options.mode === "slip") {
        result.inPoint += shift;
        result.outPoint += shift;
      } else if (edge === "left") {
        if (clip.reversed) result.outPoint -= shift;
        else result.inPoint += shift;
      } else {
        if (clip.reversed) result.inPoint -= shift;
        else result.outPoint += shift;
      }
    }
    return result;
  }
  return {
    primary: primary.item,
    mode: options.mode,
    preview,
    plan(delta: number): TimelineToolPlan {
      const value = preview(delta),
        edits: TimelineToolItemEdit[] = [];
      if (!value.delta)
        return {
          label: options.mode === "slip" ? "Slip clips" : "Ripple trim",
          delta: 0,
          edits,
        };
      const replacements = new Map<string, Item | null>();
      const put = (entry: Entry, after: Item | null) => {
        const track = tracksById.get(entry.item.trackId);
        if (track?.locked)
          throw new Error("Unlock every affected track before editing.");
        replacements.set(entry.item.id, after);
      };
      const durationDelta =
        options.mode === "ripple"
          ? edge === "left"
            ? -value.delta
            : value.delta
          : 0;
      for (const entry of selected) {
        let item = entry.item;
        if (options.mode === "ripple")
          item = rippleResizeItem(item, entry.kind, edge, value.delta, durationDelta, ctx);
        else if (entry.kind === "media") {
          const clip = item as Clip,
            original = entry.item as Clip,
            shift = value.delta * speed(original);
          item = {
            ...clip,
            inPoint: original.inPoint + shift,
            outPoint: original.outPoint + shift,
          };
        }
        put(entry, item);
      }
      const cuts = new Map(
        selected.map((entry) => [
          entry.item.trackId,
          entry.item.startTime + entry.item.duration,
        ]),
      );
      const groupCuts = new Map<string, number>();
      for (const entry of selected) {
        const groupId = tracksById.get(entry.item.trackId)?.groupId;
        if (groupId && !groupCuts.has(groupId))
          groupCuts.set(groupId, entry.item.startTime + entry.item.duration);
      }
      for (const track of project.timeline.tracks) {
        const cut = track.groupId ? groupCuts.get(track.groupId) : undefined;
        if (!cuts.has(track.id) && cut !== undefined) cuts.set(track.id, cut);
      }
      if (durationDelta)
        for (const entry of all) {
          if (
            !replacements.has(entry.item.id) &&
            cuts.has(entry.item.trackId) &&
            entry.item.startTime >= cuts.get(entry.item.trackId)! - EPS
          )
            if (
              !(
                entry.kind === "text" &&
                typeof (entry.item as import("../text/types").TextClip).metadata
                  ?.captionSourceClipId === "string" &&
                byId.get(
                  (entry.item as import("../text/types").TextClip).metadata!
                    .captionSourceClipId as string,
                )?.kind === "media" || (entry.kind === "text" && splitRoots.has(String((entry.item as import("../text/types").TextClip).metadata?.captionSourceClipId)))
              )
            )
              // Explicit caption provenance takes priority over a track group.
              put(entry, {
                ...entry.item,
                startTime: entry.item.startTime + durationDelta,
              });
        }
      // Explicit provenance is authoritative. Legacy group-only text is owned
      // by the primary/linked edit first, then by a moved overlapping source.
      const captionOwners = new Set<string>();
      const mediaEdits = new Map<string, Entry>();
      for (const entry of [...selected, ...all])
        if (
          entry.kind === "media" &&
          replacements.has(entry.item.id) &&
          !mediaEdits.has(entry.item.id)
        )
          mediaEdits.set(entry.item.id, entry);
      for (const mediaEntry of mediaEdits.values()) {
        const before = mediaEntry.item as Clip,
          after = replacements.get(before.id) as Clip;
        const groupId = tracksById.get(before.trackId)?.groupId;
        const grouped = groupId
          ? (groupCaptionRanges.get(groupId)?.(
              before.startTime,
              before.startTime + before.duration,
            ) ?? [])
          : [];
        const root = typeof before.metadata?.splitSourceClipId === "string" ? before.metadata.splitSourceClipId : before.id;
        const rooted = (splitRoots.get(root)?.length ?? 0) > 1 || root !== before.id;
        const explicit = [...new Map([...(captionsBySource.get(before.id) ?? []), ...(root !== before.id ? captionsBySource.get(root) ?? [] : [])].map(entry => [entry.item.id, entry])).values()]
          .filter(entry => !rooted || (entry.item.startTime < before.startTime + before.duration - EPS && entry.item.startTime + entry.item.duration > before.startTime + EPS));
        const captions = [
          ...explicit,
          ...grouped,
        ];
        for (const caption of captions) {
          if (captionOwners.has(caption.item.id)) continue;
          captionOwners.add(caption.item.id);
          let shift = after.startTime - before.startTime;
          if (options.mode === "slip")
            shift +=
              (before.reversed
                ? after.outPoint - before.outPoint
                : before.inPoint - after.inPoint) / speed(before);
          else if (selectedIds.has(before.id) && edge === "left")
            shift -= value.delta;
          const start = Math.max(
            after.startTime,
            caption.item.startTime + shift,
          );
          const end = Math.min(
            after.startTime + after.duration,
            caption.item.startTime + caption.item.duration + shift,
          );
          if (
            Math.abs(start - caption.item.startTime) < EPS &&
            Math.abs(end - start - caption.item.duration) < EPS
          ) {
            replacements.delete(caption.item.id);
            continue;
          }
          put(
            caption,
            end - start < Math.min(frame, caption.item.duration) - EPS
              ? null
              : { ...resizeKeys(caption.item, end - start), startTime: start },
          );
        }
      }
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
      return {
        label: options.mode === "slip" ? "Slip clips" : "Ripple trim",
        delta: value.delta,
        edits,
      };
    },
  };
}

function collection(
  project: Project,
  edit: TimelineToolItemEdit,
): readonly EditData[] {
  if (edit.kind === "nested" || edit.kind === "mask" || edit.kind === "particle")
    return project[ownedCollections[edit.kind]] ?? [];
  if (edit.kind === "marker" || edit.kind === "subtitle")
    return project.timeline[timelineLists[edit.kind]] ?? [];
  if (edit.kind === "track") return project.timeline.tracks;
  if (edit.kind === "media" || edit.kind === "transition") {
    const track = project.timeline.tracks.find(
      (track) => track.id === edit.trackId,
    );
    return edit.kind === "media"
      ? (track?.clips ?? [])
      : (track?.transitions ?? []);
  }
  return (project[collections[edit.kind]] ?? []) as Item[];
}
export function validateTimelineToolEdits(
  project: Project,
  edits: readonly TimelineToolItemEdit[],
): void {
  const seen = new Set<string>();
  const needsOwners = edits.some(edit => edit.after && (edit.kind === "mask" || edit.kind === "particle"));
  const owners = needsOwners ? new Map(entries(project).map(entry => [entry.item.id, entry.item])) : undefined;
  if (owners) for (const edit of edits) if (edit.kind === "media" || edit.kind in collections) {
    if (edit.after) owners.set(edit.id, edit.after as Item); else owners.delete(edit.id);
  }
  // Index each collection once: a linear find per edit made validating a
  // 1000-clip ripple (thousands of edits) quadratic.
  const indexes = new Map<readonly EditData[], Map<string, EditData>>();
  const lookup = (edit: TimelineToolItemEdit): EditData | null => {
    const items = collection(project, edit);
    let index = indexes.get(items);
    if (!index) {
      index = new Map();
      for (const item of items) if (!index.has(item.id)) index.set(item.id, item);
      indexes.set(items, index);
    }
    return index.get(edit.id) ?? null;
  };
  const knownTracks = [
    ...project.timeline.tracks,
    ...edits.flatMap((edit) =>
      edit.kind === "track" && !edit.before && edit.after
        ? [edit.after as Track]
        : [],
    ),
  ];
  for (const edit of edits) {
    const key = `${edit.kind}:${edit.id}`;
    if (seen.has(key)) throw new Error("An item occurs twice in this edit.");
    seen.add(key);
    if (edit.kind === "track") {
      const exists = project.timeline.tracks.some((t) => t.id === edit.id);
      if (edit.before ? !exists : exists)
        throw new Error("A track changed before the edit finished.");
      if (edit.after && edit.after.id !== edit.id)
        throw new Error("An edited item has an invalid ID.");
      continue;
    }
    const timelineLevel = edit.kind === "marker" || edit.kind === "subtitle";
    const track = knownTracks.find((track) => track.id === edit.trackId);
    if (!timelineLevel && (!track || track.locked))
      throw new Error("An affected track is locked or missing.");
    const current = lookup(edit);
    // Plans reference the project's own objects as `before`: identity needs no serialising comparison.
    if (current !== edit.before && JSON.stringify(current) !== JSON.stringify(edit.before))
      throw new Error("An affected item changed before the edit finished.");
    if (timelineLevel) {
      if (edit.after && edit.after.id !== edit.id)
        throw new Error("An edited item has an invalid ID.");
      continue;
    }
    if (edit.after && edit.after.id !== edit.id)
      throw new Error("An edited item has an invalid ID.");
    if (edit.after && (edit.kind === "mask" || edit.kind === "particle")) {
      const ownerId = (edit.after as Mask | ParticleEffect).clipId;
      const owner = owners?.get(ownerId);
      if (!owner || owner.trackId !== edit.trackId) throw new Error("An attached item has no matching owner.");
    } else if (edit.after && edit.kind !== "transition") {
      const item = edit.after as Item;
      if (
        item.trackId !== edit.trackId ||
        !Number.isFinite(item.startTime) ||
        item.startTime < 0 ||
        !Number.isFinite(item.duration) ||
        item.duration <= 0
      )
        throw new Error("An edited item has invalid timeline bounds.");
      if (edit.kind === "media") {
        const clip = item as Clip;
        if (
          !Number.isFinite(clip.inPoint) ||
          !Number.isFinite(clip.outPoint) ||
          clip.inPoint < -EPS ||
          clip.outPoint < clip.inPoint ||
          (project.mediaLibrary.items.find((media) => media.id === clip.mediaId)
            ?.type !== "image" &&
            !clip.metadata?.motionClip &&
            clip.outPoint >
              // A Replace edit swaps the footage: bound it by the NEW media.
              sourceLimit(
                project,
                edit.before && (edit.before as Clip).mediaId === clip.mediaId
                  ? (edit.before as Clip)
                  : clip,
              ) + EPS)
        )
          throw new Error("The edit exceeds the source bounds.");
      }
    }
  }
}
export function applyTimelineToolEdits(
  project: Project,
  edits: readonly TimelineToolItemEdit[],
): Project {
  const replace = <T extends EditData>(
    items: readonly T[],
    changes: readonly TimelineToolItemEdit[],
  ): T[] => {
    const map = new Map(changes.map((edit) => [edit.id, edit.after]));
    const result = items.flatMap((item) =>
      map.has(item.id)
        ? map.get(item.id)
          ? [map.get(item.id) as T]
          : []
        : [item],
    );
    for (const edit of changes
      .filter((edit) => !edit.before && edit.after)
      .sort((a, b) => a.index - b.index))
      result.splice(Math.min(result.length, edit.index), 0, edit.after as T);
    return result;
  };
  const trackEdits = edits.filter((edit) => edit.kind === "track");
  const baseTracks = trackEdits.length
    ? replace(project.timeline.tracks, trackEdits)
    : project.timeline.tracks;
  const next: Project = {
    ...project,
    modifiedAt: Date.now(),
    timeline: {
      ...project.timeline,
      tracks: baseTracks.map((track) => {
        const media = edits.filter(
          (edit) => edit.kind === "media" && edit.trackId === track.id,
        );
        const transitions = edits.filter(
          (edit) => edit.kind === "transition" && edit.trackId === track.id,
        );
        return media.length || transitions.length
          ? {
              ...track,
              clips: media.length ? replace(track.clips, media) : track.clips,
              transitions: transitions.length
                ? replace(track.transitions, transitions)
                : track.transitions,
            }
          : track;
      }),
    },
  };
  for (const [kind, field] of Object.entries(collections)) {
    const changes = edits.filter((edit) => edit.kind === kind);
    if (changes.length)
      Object.assign(next, {
        [field]: replace(
          (project[field as (typeof collections)[keyof typeof collections]] ??
            []) as Item[],
          changes,
        ),
      });
  }
  for (const [kind, field] of Object.entries(timelineLists)) {
    const changes = edits.filter((edit) => edit.kind === kind);
    if (changes.length)
      Object.assign(next.timeline, {
        [field]: replace(
          (project.timeline[field as (typeof timelineLists)[keyof typeof timelineLists]] ?? []) as EditData[],
          changes,
        ),
      });
  }
  for (const [kind, field] of Object.entries(ownedCollections)) {
    const changes = edits.filter(edit => edit.kind === kind);
    if (changes.length) Object.assign(next, { [field]: replace((project[field as (typeof ownedCollections)[keyof typeof ownedCollections]] ?? []) as EditData[], changes) });
  }
  if (next.nestedInstances) {
    const explicitInstances = new Set(edits.filter(edit => edit.kind === "nested").map(edit => edit.id));
    const clips = new Map(
      edits
        .filter((edit) => edit.kind === "media" && edit.after)
        .map((edit) => [edit.id, edit.after as Clip]),
    );
    Object.assign(next, {
      nestedInstances: next.nestedInstances.map((instance) => {
        if (explicitInstances.has(instance.id)) return instance;
        const clip = clips.get(instance.id);
        return clip
          ? {
              ...instance,
              startTime: clip.startTime,
              duration: clip.duration,
              inPoint: clip.inPoint,
              outPoint: clip.outPoint,
            }
          : instance;
      }),
    });
  }
  // Essential Graphics: sync-locked overlays shift without knowing about graphic instances;
  // re-derive the instances from their (uniformly moved) member clips. No-op without graphics.
  const reconciled = reconcileGraphicInstances(next);
  Object.assign(reconciled.timeline, { duration: calculateProjectDuration(reconciled) });
  return reconciled;
}
export function invertTimelineToolEdits(
  edits: readonly TimelineToolItemEdit[],
): TimelineToolItemEdit[] {
  return clonePlain(
    edits.map((edit) => ({ ...edit, before: edit.after, after: edit.before })),
  );
}

/**
 * Undo of a split when a collaborator has since changed the right half (for
 * example split it again). The recorded inverse no longer matches, so apply
 * the same intent to what is there now: merge the left half with the right
 * half's current extent and drop the right half. Returns null when the
 * inverse is not a split-undo or the pieces are no longer adjacent.
 */
export function rebaseSplitInverse(
  project: Project,
  edits: readonly TimelineToolItemEdit[],
): TimelineToolItemEdit[] | null {
  if (edits.length !== 2 || edits.some((edit) => edit.kind !== "media")) return null;
  const right = edits.find((edit) => edit.before && !edit.after);
  const left = edits.find((edit) => edit.before && edit.after);
  if (!left || !right || left.trackId !== right.trackId) return null;
  const find = (edit: TimelineToolItemEdit) =>
    collection(project, edit).find((item) => item.id === edit.id) as
      | (EditData & { startTime: number; duration: number; outPoint?: number })
      | undefined;
  const leftNow = find(left);
  const rightNow = find(right);
  if (!leftNow || !rightNow) return null;
  if (JSON.stringify(leftNow) !== JSON.stringify(left.before)) return null;
  // Only a right half someone else changed is rebased; an unchanged one failed validation for another reason.
  if (JSON.stringify(rightNow) === JSON.stringify(right.before)) return null;
  if (Math.abs(leftNow.startTime + leftNow.duration - rightNow.startTime) > 1e-6) return null;
  const merged = {
    ...leftNow,
    duration: rightNow.startTime + rightNow.duration - leftNow.startTime,
    ...(rightNow.outPoint !== undefined ? { outPoint: rightNow.outPoint } : {}),
  } as EditData;
  return [
    { ...left, before: leftNow, after: merged },
    { ...right, before: rightNow, after: null },
  ];
}
