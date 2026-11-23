/**
 * Write a finished Project Manager run into a project: keep the chosen sequences, point every media item at its new
 * file, and rewrite each clip's in/out (and the source-time markers) through the trimmed file's segment map so the
 * edit plays the same pictures at the same timeline times.
 */
import type { Marker, Clip, Timeline } from "../types/timeline";
import type { MediaItem, MediaProxyRef, Project, Sequence } from "../types/project";
import { ensureSequences, isNestClip, syncActiveSequence, withNestProjection } from "../timeline/sequences";
import type { ProjectManagerPlan, PlannedItem } from "./plan";
import { type Segment, mapRange, mapSourceTime } from "./segments";

export interface ItemResult {
  /** Absolute path of the new file. */
  readonly outPath: string;
  readonly size: number;
  /** Duration of the new file, seconds. */
  readonly duration: number;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  /** Codec of the new file as ffmpeg names it (`prores`, `dnxhd`, `h264`, ...). */
  readonly codec?: string;
  readonly proxyPath?: string;
  readonly proxyPreviewPath?: string;
  readonly proxySize?: number;
}

export interface ApplyContext {
  readonly projectId: string;
  readonly projectName?: string;
  readonly now: number;
}

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

interface TimeMap {
  readonly segments: readonly Segment[];
  readonly fps: number;
}

/** Nearest kept time when `t` falls in a cut (a subclip window that spans a gap). */
function mapLoose(segments: readonly Segment[], t: number, fps: number, side: "start" | "end"): number {
  const exact = mapSourceTime(segments, t, fps);
  if (exact !== null) return exact;
  for (const s of segments) {
    if (t < s.srcStart) return side === "start" ? s.outStart : (segments[segments.indexOf(s) - 1] ? mapEnd(segments[segments.indexOf(s) - 1]) : 0);
  }
  const last = segments[segments.length - 1];
  return last ? mapEnd(last) : 0;
}
const mapEnd = (s: Segment): number => s.outStart + (s.srcEnd - s.srcStart);

function mapMarkers(markers: readonly Marker[] | undefined, map: TimeMap, loose: boolean): Marker[] | undefined {
  if (!markers?.length) return markers as Marker[] | undefined;
  const out: Marker[] = [];
  for (const marker of markers) {
    const mapped = mapSourceTime(map.segments, marker.time, map.fps);
    if (mapped !== null) out.push({ ...marker, time: mapped });
    else if (loose) continue;
  }
  return out;
}

function protoItem(planned: PlannedItem, item: MediaItem, result: ItemResult, now: number, map: TimeMap | null): MediaItem {
  const transcoded = planned.action === "transcode";
  const codec = (result.codec ?? "").toLowerCase();
  const native = codec === "prores" || codec === "dnxhd" ? codec : null;
  const sourceFile = { ...(item.sourceFile ?? { name: basename(result.outPath), size: result.size, lastModified: now }), name: basename(result.outPath), size: result.size, lastModified: now, path: result.outPath };
  const next: Record<string, unknown> = { ...item, sourceFile };
  const metadata: Record<string, unknown> = { ...item.metadata, fileSize: result.size };
  if (transcoded) {
    metadata.duration = result.duration;
    if (result.codec) metadata.codec = result.codec;
    if (result.frameRate) metadata.frameRate = result.frameRate;
    if (planned.audioOnly) metadata.hasVideo = false;
    if (planned.conformAudio) {
      metadata.sampleRate = 48000;
    }
    if (native && result.width && result.height) {
      next.nativeSource = { path: result.outPath, codec: native, width: result.width, height: result.height, frameRate: result.frameRate ?? item.metadata.frameRate };
    } else {
      delete next.nativeSource;
    }
  } else if (item.nativeSource) {
    next.nativeSource = { ...item.nativeSource, path: result.outPath };
  }
  if (map) {
    metadata.duration = result.duration;
    const mapped = mapMarkers(item.markers, map, true);
    if (mapped) next.markers = mapped;
  }
  next.metadata = metadata;
  return next as unknown as MediaItem;
}

function proxyOf(planned: PlannedItem, item: MediaItem, result: ItemResult | undefined): MediaProxyRef | undefined {
  if (!planned.proxy || !item.proxy || !result?.proxyPath) return undefined;
  return {
    ...item.proxy,
    path: result.proxyPath,
    ...(result.proxyPreviewPath ? { previewPath: result.proxyPreviewPath } : (() => { const { previewPath: _p, ...rest } = item.proxy as MediaProxyRef; void rest; return {}; })()),
    ...(planned.proxy.action === "transcode" ? { duration: result.duration } : {}),
    ...(result.proxySize !== undefined ? { fileSize: result.proxySize } : {}),
  } as MediaProxyRef;
}

export function applyPlan(
  input: Project,
  plan: ProjectManagerPlan,
  results: Readonly<Record<string, ItemResult>>,
  ctx: ApplyContext,
): Project {
  const base = ensureSequences(syncActiveSequence(input));
  const keepSequence = new Set(plan.sequenceIds);
  const dropped = new Set(plan.droppedMediaIds);
  const plannedById = new Map(plan.items.map((p) => [p.mediaId, p]));
  const libraryById = new Map(base.mediaLibrary.items.map((item) => [item.id, item]));

  const mapOf = (mediaId: string): TimeMap | null => {
    const parent = libraryById.get(mediaId)?.subclip?.parentId ?? mediaId;
    const planned = plannedById.get(parent);
    return planned?.segments && results[parent] ? { segments: planned.segments, fps: planned.fps } : null;
  };

  const rewriteClip = (clip: Clip): Clip => {
    if (isNestClip(clip)) return clip;
    const map = mapOf(clip.mediaId);
    if (!map) return clip;
    const range = mapRange(map.segments, clip.inPoint, clip.outPoint, map.fps);
    if (!range) throw new Error(`Clip ${clip.id} plays media outside the ranges that were kept.`);
    const markers = mapMarkers(clip.markers, map, true);
    return { ...clip, inPoint: range.start, outPoint: range.end, ...(markers ? { markers } : {}) };
  };
  const rewriteTimeline = (timeline: Timeline): Timeline => ({
    ...timeline,
    tracks: timeline.tracks.map((track) => ({ ...track, clips: track.clips.map(rewriteClip) })),
  });

  const sequences: Sequence[] = (base.sequences ?? [])
    .filter((s) => keepSequence.has(s.id))
    .map((s) => ({ ...s, timeline: rewriteTimeline(s.timeline) }));
  const activeId = base.activeSequenceId && keepSequence.has(base.activeSequenceId) ? base.activeSequenceId : plan.sequenceIds[0];
  const active = sequences.find((s) => s.id === activeId) ?? sequences[0];

  const items: MediaItem[] = [];
  for (const item of base.mediaLibrary.items) {
    if (dropped.has(item.id)) continue;
    if (item.subclip) {
      const map = mapOf(item.subclip.parentId);
      const parent = results[item.subclip.parentId];
      if (!map || !parent) {
        items.push(item);
        continue;
      }
      items.push({
        ...item,
        metadata: { ...item.metadata, duration: parent.duration },
        subclip: {
          ...item.subclip,
          inPoint: mapLoose(map.segments, item.subclip.inPoint, map.fps, "start"),
          outPoint: mapLoose(map.segments, item.subclip.outPoint, map.fps, "end"),
        },
      });
      continue;
    }
    const planned = plannedById.get(item.id);
    const result = results[item.id];
    if (!planned || planned.action === "offline" || !result) {
      // Left where it was (offline); its proxy would point at the old place, so it goes too.
      const { proxy: _proxy, ...rest } = item;
      void _proxy;
      items.push(planned?.action === "offline" ? (rest as MediaItem) : item);
      continue;
    }
    const map = planned.segments ? { segments: planned.segments, fps: planned.fps } : null;
    const next = protoItem(planned, item, result, ctx.now, map);
    const proxy = proxyOf(planned, item, result);
    const { proxy: _old, ...withoutProxy } = next;
    void _old;
    items.push(proxy ? { ...withoutProxy, proxy } : (withoutProxy as MediaItem));
  }

  const keepSources = new Set(plan.multicamSourceIds);
  const multicamSources = base.multicamSources
    ?.filter((source) => keepSources.has(source.id))
    .map((source) => ({
      ...source,
      angles: source.angles.map((angle) => {
        const planned = plannedById.get(libraryById.get(angle.mediaId)?.subclip?.parentId ?? angle.mediaId);
        const result = planned && results[planned.mediaId];
        if (!planned || !result) return angle;
        const first = planned.segments?.[0];
        return { ...angle, offset: angle.offset + (first ? first.srcStart - first.outStart : 0), ...(planned.action === "transcode" || planned.segments ? { duration: result.duration } : {}) };
      }),
    }));

  const openSequenceIds = base.openSequenceIds?.filter((id) => keepSequence.has(id));
  const next: Project = {
    ...base,
    id: ctx.projectId,
    name: ctx.projectName ?? base.name,
    modifiedAt: ctx.now,
    sequences,
    activeSequenceId: active.id,
    openSequenceIds: openSequenceIds?.length ? openSequenceIds : [active.id],
    timeline: active.timeline,
    settings: active.settings,
    mediaLibrary: { ...base.mediaLibrary, items },
    compoundClips: [],
    ...(multicamSources ? { multicamSources } : {}),
  };
  return withNestProjection(next);
}
