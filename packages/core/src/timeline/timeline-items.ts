import type {
  Clip,
  MediaItem,
  Project,
  Track,
} from "../types";
import type { TextClip } from "../text/types";
import type { ShapeClip, StickerClip, SVGClip } from "../graphics/types";
import type { AdjustmentLayer } from "../video/adjustment-layer-engine";
import type { MotionCompositionInstance } from "../motion/types";

export const UNIVERSAL_TRACKS_CAPABILITY = "universal-tracks-v1";
export const UNIVERSAL_TRACKS_MIN_READER_VERSION = "1.2.0";

export type TimelineItemKind =
  | "media"
  | "text"
  | "shape"
  | "svg"
  | "sticker"
  | "adjustment"
  | "motion";

interface TimelineItemBase<TKind extends TimelineItemKind, TItem> {
  readonly id: string;
  readonly trackId: string;
  readonly kind: TKind;
  readonly startTime: number;
  readonly duration: number;
  readonly item: TItem;
}

export type ResolvedTimelineItem =
  | (TimelineItemBase<"media", Clip> & { readonly mediaItem?: MediaItem; readonly compoundCapabilities?: Pick<TimelineItemCapabilities, "visual" | "audio"> })
  | TimelineItemBase<"text", TextClip>
  | TimelineItemBase<"shape", ShapeClip>
  | TimelineItemBase<"svg", SVGClip>
  | TimelineItemBase<"sticker", StickerClip>
  | TimelineItemBase<"adjustment", AdjustmentLayer>
  | TimelineItemBase<"motion", MotionCompositionInstance>;

export interface TimelineItemCapabilities {
  readonly visual: boolean;
  readonly audio: boolean;
  readonly transformable: boolean;
  readonly trimSource: boolean;
  readonly transitionSource: boolean;
  readonly textEditable: boolean;
  readonly graphicEditable: boolean;
}

interface TimelineTrackRenderEntry {
  readonly track: Track;
  readonly originalIndex: number;
}

/**
 * Returns visible tracks in canvas painter order. The timeline stores the
 * front-most track at index 0, so rendering must walk from the last visible
 * track to the first.
 */
export function getVisibleTrackRenderOrder(
  tracks: readonly Track[],
): TimelineTrackRenderEntry[] {
  return tracks
    .map((track, originalIndex) => ({ track, originalIndex }))
    .filter(({ track }) => !track.hidden)
    .reverse();
}

const VISUAL_ONLY_CAPABILITIES: TimelineItemCapabilities = {
  visual: true,
  audio: false,
  transformable: true,
  trimSource: false,
  transitionSource: false,
  textEditable: false,
  graphicEditable: false,
};

function mediaHasVideo(mediaItem: MediaItem | undefined): boolean {
  if (!mediaItem) return false;
  // Static images are visual timeline items even though importers correctly
  // describe them as having no encoded video stream.
  if (mediaItem.type === "image") return true;
  if (typeof mediaItem.metadata.hasVideo === "boolean") {
    return mediaItem.metadata.hasVideo;
  }
  return mediaItem.type === "video";
}

function mediaHasAudio(mediaItem: MediaItem | undefined): boolean {
  if (!mediaItem) return false;
  if (typeof mediaItem.metadata.hasAudio === "boolean") {
    return mediaItem.metadata.hasAudio;
  }
  if (mediaItem.type === "audio") return true;
  if (mediaItem.type !== "video") return false;
  return mediaItem.metadata.channels > 0 || mediaItem.metadata.sampleRate > 0;
}

export function getMediaItemCapabilities(
  mediaItem: MediaItem | undefined,
): Pick<TimelineItemCapabilities, "visual" | "audio"> {
  return {
    visual: mediaHasVideo(mediaItem),
    audio: mediaHasAudio(mediaItem),
  };
}

export function getCompoundClipId(clip: Pick<Clip, "mediaId" | "metadata">): string | null {
  return typeof clip.metadata?.compoundClipId === "string"
    ? clip.metadata.compoundClipId
    : clip.mediaId.startsWith("compound:") ? clip.mediaId.slice("compound:".length) : null;
}

/** Resolve real source capabilities, including nested definitions, once per project revision. */
export function createTimelineClipCapabilityResolver(
  mediaLibrary: Project["mediaLibrary"],
  definitions: Project["compoundClips"],
): (clip: Pick<Clip, "mediaId" | "metadata">) => Pick<TimelineItemCapabilities, "visual" | "audio"> {
  const media = new Map(mediaLibrary.items.map((item) => [item.id, getMediaItemCapabilities(item)]));
  const compounds = new Map((definitions ?? []).map((definition) => [definition.id, definition]));
  const memo = new Map<string, Pick<TimelineItemCapabilities, "visual" | "audio">>();
  const missing = { visual: false, audio: false };
  const resolve = (clip: Pick<Clip, "mediaId" | "metadata">, ancestors: Set<string>): Pick<TimelineItemCapabilities, "visual" | "audio"> => {
    const id = getCompoundClipId(clip);
    if (!id) return media.get(clip.mediaId) ?? missing;
    if (ancestors.has(id) || ancestors.size >= 32) return missing;
    const cached = memo.get(id);
    if (cached) return cached;
    const definition = compounds.get(id);
    if (!definition) return missing;
    const path = new Set(ancestors).add(id);
    let visual = false, audio = false;
    for (const track of definition.content.tracks) {
      for (const child of track.clips) {
        const capability = resolve(child, path);
        visual ||= capability.visual;
        audio ||= capability.audio;
      }
    }
    const result = { visual, audio };
    // A cyclic result can depend on its path; do not reuse it in another branch.
    if (ancestors.size === 0) memo.set(id, result);
    return result;
  };
  return (clip) => resolve(clip, new Set());
}

const projectClipCapabilities = new WeakMap<Project, {
  media: Project["mediaLibrary"]["items"]; mediaCount: number;
  definitions: Project["compoundClips"]; definitionCount: number; modifiedAt: number;
  resolve: ReturnType<typeof createTimelineClipCapabilityResolver>;
}>();
export function getProjectClipCapabilities(project: Project, clip: Pick<Clip, "mediaId" | "metadata">) {
  let cached = projectClipCapabilities.get(project);
  if (!cached || cached.media !== project.mediaLibrary.items || cached.mediaCount !== project.mediaLibrary.items.length
    || cached.definitions !== project.compoundClips || cached.definitionCount !== (project.compoundClips?.length ?? 0)
    || cached.modifiedAt !== project.modifiedAt) {
    cached = { media: project.mediaLibrary.items, mediaCount: project.mediaLibrary.items.length,
      definitions: project.compoundClips, definitionCount: project.compoundClips?.length ?? 0, modifiedAt: project.modifiedAt,
      resolve: createTimelineClipCapabilityResolver(project.mediaLibrary, project.compoundClips) };
    projectClipCapabilities.set(project, cached);
  }
  return cached.resolve(clip);
}

type MediaIndexEntry = { item: Project["mediaLibrary"]["items"][number]; index: number };
const mediaIndexes = new WeakMap<Project["mediaLibrary"]["items"], Map<string, MediaIndexEntry>>();

/**
 * Media lookup by id in O(1) per call instead of a linear scan per clip (400 clips x
 * 400 media items was ~160k comparisons per getTimelineItems call, and the editor calls
 * it per track on every render). Each hit is verified against the live array, so an
 * in-place replacement or reorder falls back to a scan; a miss always scans.
 */
function findMediaItem(project: Project, mediaId: string): Project["mediaLibrary"]["items"][number] | undefined {
  const items = project.mediaLibrary.items;
  let index = mediaIndexes.get(items);
  if (!index || index.size !== items.length) {
    index = new Map();
    items.forEach((item, i) => { if (!index!.has(item.id)) index!.set(item.id, { item, index: i }); });
    mediaIndexes.set(items, index);
  }
  const hit = index.get(mediaId);
  if (hit && items[hit.index] === hit.item) return hit.item;
  return items.find((candidate) => candidate.id === mediaId);
}

function mediaItemRef(
  project: Project,
  trackId: string,
  clip: Clip,
): ResolvedTimelineItem {
  return {
    id: clip.id,
    trackId,
    kind: "media",
    startTime: clip.startTime,
    duration: clip.duration,
    item: clip,
    ...(getCompoundClipId(clip) ? { compoundCapabilities: getProjectClipCapabilities(project, clip) } : {}),
    mediaItem: findMediaItem(project, clip.mediaId),
  };
}

export function getTimelineItems(project: Project): ResolvedTimelineItem[] {
  return collectTimelineItems(project);
}

/** All items (or just those on `onlyTrackId`), sorted by start time then id. */
function collectTimelineItems(project: Project, onlyTrackId?: string): ResolvedTimelineItem[] {
  const items: ResolvedTimelineItem[] = [];
  const wanted = (trackId: string | undefined): boolean => onlyTrackId === undefined || trackId === onlyTrackId;

  for (const track of project.timeline.tracks) {
    if (!wanted(track.id)) continue;
    for (const clip of track.clips) {
      items.push(mediaItemRef(project, track.id, clip));
    }
  }

  for (const clip of project.textClips ?? []) {
    if (!wanted(clip.trackId)) continue;
    items.push({
      id: clip.id,
      trackId: clip.trackId,
      kind: "text",
      startTime: clip.startTime,
      duration: clip.duration,
      item: clip,
    });
  }

  for (const clip of project.shapeClips ?? []) {
    if (!wanted(clip.trackId)) continue;
    items.push({
      id: clip.id,
      trackId: clip.trackId,
      kind: "shape",
      startTime: clip.startTime,
      duration: clip.duration,
      item: clip,
    });
  }

  for (const clip of project.svgClips ?? []) {
    if (!wanted(clip.trackId)) continue;
    items.push({
      id: clip.id,
      trackId: clip.trackId,
      kind: "svg",
      startTime: clip.startTime,
      duration: clip.duration,
      item: clip,
    });
  }

  for (const clip of project.stickerClips ?? []) {
    if (!wanted(clip.trackId)) continue;
    items.push({
      id: clip.id,
      trackId: clip.trackId,
      kind: "sticker",
      startTime: clip.startTime,
      duration: clip.duration,
      item: clip,
    });
  }

  for (const layer of project.adjustmentLayers ?? []) {
    if (!wanted(layer.trackId)) continue;
    items.push({
      id: layer.id,
      trackId: layer.trackId,
      kind: "adjustment",
      startTime: layer.startTime,
      duration: layer.duration,
      item: layer,
    });
  }

  for (const instance of project.motionInstances ?? []) {
    if (!instance.trackId || !wanted(instance.trackId)) continue;
    items.push({
      id: instance.id,
      trackId: instance.trackId,
      kind: "motion",
      startTime: instance.startTime,
      duration: instance.duration,
      item: instance,
    });
  }

  return items.sort(
    (left, right) =>
      left.startTime - right.startTime || left.id.localeCompare(right.id),
  );
}

export function getTrackItems(
  project: Project,
  trackId: string,
): ResolvedTimelineItem[] {
  return collectTimelineItems(project, trackId);
}

export function resolveTimelineItem(
  project: Project,
  itemId: string,
): ResolvedTimelineItem | null {
  return getTimelineItems(project).find((item) => item.id === itemId) ?? null;
}

export function getTimelineItemCapabilities(
  item: ResolvedTimelineItem,
): TimelineItemCapabilities {
  if (item.kind === "media") {
    const { visual, audio } = item.compoundCapabilities ?? getMediaItemCapabilities(item.mediaItem);
    return {
      visual,
      audio,
      transformable: visual,
      trimSource: true,
      transitionSource:
        visual &&
        (item.mediaItem?.type === "video" || item.mediaItem?.type === "image"),
      textEditable: false,
      graphicEditable: false,
    };
  }

  if (item.kind === "text") {
    return { ...VISUAL_ONLY_CAPABILITIES, textEditable: true };
  }
  if (
    item.kind === "shape" ||
    item.kind === "svg" ||
    item.kind === "sticker"
  ) {
    return { ...VISUAL_ONLY_CAPABILITIES, graphicEditable: true };
  }
  if (item.kind === "motion") {
    return { ...VISUAL_ONLY_CAPABILITIES, trimSource: true };
  }
  return {
    ...VISUAL_ONLY_CAPABILITIES,
    transformable: false,
    trimSource: true,
  };
}

export function trackHasVisualItems(project: Project, trackId: string): boolean {
  return getTrackItems(project, trackId).some(
    (item) => getTimelineItemCapabilities(item).visual,
  );
}

export function trackHasAudioItems(project: Project, trackId: string): boolean {
  return getTrackItems(project, trackId).some(
    (item) => getTimelineItemCapabilities(item).audio,
  );
}

export function isStandardTrack(_track: Track): boolean {
  return true;
}

export function projectUsesUniversalTracks(project: Project): boolean {
  return (project.capabilities ?? []).includes(UNIVERSAL_TRACKS_CAPABILITY);
}

export function withUniversalTracksCapability(project: Project): Project {
  if (projectUsesUniversalTracks(project)) return project;
  return {
    ...project,
    capabilities: [
      ...(project.capabilities ?? []),
      UNIVERSAL_TRACKS_CAPABILITY,
    ],
    minimumReaderVersion: UNIVERSAL_TRACKS_MIN_READER_VERSION,
  };
}
