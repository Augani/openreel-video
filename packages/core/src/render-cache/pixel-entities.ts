import type { Project, MediaItem } from "../types/project";
import type { Clip, Track, Transition, Effect } from "../types/timeline";
import { mediaImageVersion } from "../raw/raw-media";
import { normalizeRanges, type TimeRange } from "./time-ranges";

/**
 * A thing that can change pixels over a span of the timeline. The render cache
 * diffs two projects entity-by-entity: an entity whose fingerprint or span
 * differs invalidates the union of its old and new spans, and nothing else.
 */
export interface PixelEntity {
  readonly key: string;
  readonly fingerprint: string;
  readonly spans: readonly TimeRange[];
}

export interface PixelModel {
  readonly projectId: string;
  /** Anything that affects every frame (canvas size, frame rate, fill mode, ...). */
  readonly globalFingerprint: string;
  readonly entities: ReadonlyMap<string, PixelEntity>;
}

let nextBlobId = 1;
const blobIds = new WeakMap<object, number>();
function identityOf(value: object | null | undefined): number {
  if (!value) return 0;
  let id = blobIds.get(value);
  if (id === undefined) {
    id = nextBlobId++;
    blobIds.set(value, id);
  }
  return id;
}

/** Deterministic JSON: sorted keys, undefined dropped, typed arrays as arrays. */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const kind = typeof value;
  if (kind === "number") return Number.isFinite(value as number) ? String(value) : "null";
  if (kind === "string") return JSON.stringify(value);
  if (kind === "boolean") return value ? "true" : "false";
  if (kind === "bigint") return String(value);
  if (kind === "function" || kind === "symbol") return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (ArrayBuffer.isView(value)) {
    return `[${Array.from(value as unknown as ArrayLike<number>).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function pixelEffects(effects: readonly Effect[] | undefined): unknown[] {
  return (effects ?? []).map((effect) => ({
    type: effect.type,
    params: effect.params,
    enabled: effect.enabled,
  }));
}

/** Clip fields that only feed the audio mixer; they never change a frame. */
function clipPixelBody(clip: Clip): string {
  {
    const {
      volume: _volume,
      audioEffects: _audioEffects,
      fade: _fade,
      automation: _automation,
      pitchCorrection: _pitch,
      audioTrackIndex: _audioTrack,
      metadata,
      effects,
      ...rest
    } = clip;
    return stableStringify({
      ...rest,
      effects: pixelEffects(effects),
      compound: metadata?.compoundClipId,
    });
  }
}

function mediaFingerprint(item: MediaItem | undefined): string {
  if (!item) return "missing";
  return stableStringify({
    type: item.type,
    blob: identityOf(item.blob),
    handle: identityOf(item.fileHandle),
    placeholder: item.isPlaceholder === true,
    duration: item.metadata?.duration,
    width: item.metadata?.width,
    height: item.metadata?.height,
    frameRate: item.metadata?.frameRate,
    url: item.originalUrl,
    // RAW Source Settings change the developed pixels of a camera RAW still without touching its blob.
    raw: mediaImageVersion(item) || undefined,
    // Interpret Footage changes the displayed pixels. Only emitted when defined, so legacy keys are byte-identical.
    interpretation: item.interpretation
      ? {
          pixelAspectRatio: item.interpretation.pixelAspectRatio,
          fieldOrder: item.interpretation.fieldOrder,
          deinterlace: item.interpretation.deinterlace,
        }
      : undefined,
    metaPixelAspectRatio: item.metadata?.pixelAspectRatio,
    metaFieldOrder: item.metadata?.fieldOrder,
  });
}

function compoundIdOf(clip: Clip): string | null {
  const fromMeta = clip.metadata?.compoundClipId;
  if (typeof fromMeta === "string") return fromMeta;
  return clip.mediaId.startsWith("compound:") ? clip.mediaId.slice("compound:".length) : null;
}

function span(start: number, end: number): TimeRange[] {
  return normalizeRanges([{ start, end }]);
}

function transitionSpans(transition: Transition, track: Track): TimeRange[] {
  const clipA = track.clips.find((clip) => clip.id === transition.clipAId);
  const clipB = transition.clipBId
    ? track.clips.find((clip) => clip.id === transition.clipBId)
    : undefined;
  const d = Math.max(0, transition.duration);
  const out: TimeRange[] = [];
  if (clipA) {
    const aEnd = clipA.startTime + clipA.duration;
    if (transition.edge === "in") out.push({ start: clipA.startTime - d, end: clipA.startTime + d });
    else out.push({ start: aEnd - d, end: aEnd + d });
  }
  if (clipB) out.push({ start: clipB.startTime - d, end: clipB.startTime + d });
  return normalizeRanges(out);
}

type TimedItem = { id: string; startTime: number; duration: number; trackId?: string };

const TIMED_COLLECTIONS = [
  "textClips",
  "shapeClips",
  "svgClips",
  "stickerClips",
  "adjustmentLayers",
  "particleEffects",
  "motionInstances",
  "nestedInstances",
] as const;

/** Top-level project fields that never affect a rendered frame. */
const NON_PIXEL_PROJECT_KEYS = new Set([
  "id",
  "name",
  "createdAt",
  "modifiedAt",
  "capabilities",
  "minimumReaderVersion",
]);
const MODELED_PROJECT_KEYS = new Set([
  "settings",
  "mediaLibrary",
  "timeline",
  "masks",
  "compoundClips",
  "motionCompositions",
  // Graphic instances render through their member text/shape/svg clips, which are
  // fingerprinted individually: the record itself must not invalidate every frame.
  "graphicInstances",
  // Master records: their pixels reach frames through the linked instances' member clips.
  "linkedCompositions",
  ...TIMED_COLLECTIONS,
]);
const NON_PIXEL_TIMELINE_KEYS = new Set([
  "duration",
  "markers",
  "beatMarkers",
  "beatAnalysis",
  "masterAudioRack",
  // Submix buses never affect a rendered frame.
  "audioBuses",
  "tracks",
  "subtitles",
]);

function globalFingerprint(project: Project): string {
  const projectRest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(project)) {
    if (NON_PIXEL_PROJECT_KEYS.has(key) || MODELED_PROJECT_KEYS.has(key)) continue;
    projectRest[key] = value;
  }
  const timelineRest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(project.timeline)) {
    if (NON_PIXEL_TIMELINE_KEYS.has(key)) continue;
    timelineRest[key] = value;
  }
  return stableStringify({
    width: project.settings.width,
    height: project.settings.height,
    frameRate: project.settings.frameRate,
    // Undefined (the Rec.709 / 203 nit defaults) is dropped by stableStringify, so default projects keep their keys.
    workingColorSpace: project.settings.workingColorSpace,
    graphicsWhiteNits: project.settings.graphicsWhiteNits,
    // ACES mode changes every pixel; absent (display-referred) keys are dropped so legacy caches stay valid.
    colorManagement: project.settings.colorManagement === "aces" ? "aces" : undefined,
    acesOutput: project.settings.colorManagement === "aces" ? project.settings.acesOutput : undefined,
    // Sequence PAR / field order; undefined (square, progressive) is dropped so legacy keys are unchanged.
    pixelAspectRatio: project.settings.pixelAspectRatio,
    fieldOrder: project.settings.fieldOrder,
    projectRest,
    timelineRest,
  });
}

/**
 * Snapshot every pixel-affecting entity of a project as plain strings and
 * spans. Deliberately not memoized by object identity: the editor's action
 * handlers mutate project objects in place, so only a snapshot taken at the
 * moment of the change can be diffed against the next one.
 */
export function buildPixelModel(project: Project): PixelModel {
  const entities = new Map<string, PixelEntity>();
  const mediaById = new Map(project.mediaLibrary.items.map((item) => [item.id, item]));
  const compoundById = new Map((project.compoundClips ?? []).map((c) => [c.id, c]));
  const compositionById = new Map((project.motionCompositions ?? []).map((c) => [c.id, c]));
  const masksByClip = new Map<string, unknown[]>();
  for (const mask of project.masks ?? []) {
    const list = masksByClip.get(mask.clipId) ?? [];
    list.push(mask);
    masksByClip.set(mask.clipId, list);
  }

  const clipById = new Map<string, Clip>();
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) clipById.set(clip.id, clip);
  }
  const maskFingerprint = (clipId: string): string => {
    const masks = masksByClip.get(clipId) ?? [];
    return stableStringify(
      masks.map((mask) => {
        const sourceId = (mask as { sourceClipId?: string }).sourceClipId;
        const source = sourceId ? clipById.get(sourceId) : undefined;
        return { mask, source: source ? clipPixelBody(source) : null };
      }),
    );
  };

  // Masks are keyed by clip id project-wide, so a pen mask on a clip inside a nest is not
  // part of the nest's own content: fold it into the nest clip's fingerprint (recursively).
  const nestedMaskFingerprint = (compoundId: string, seen: Set<string>): string => {
    if (seen.has(compoundId)) return "";
    seen.add(compoundId);
    const compound = compoundById.get(compoundId);
    if (!compound) return "";
    const parts: string[] = [];
    for (const inner of compound.content.clips) {
      const innerNest = compoundIdOf(inner);
      parts.push(maskFingerprint(inner.id), innerNest ? nestedMaskFingerprint(innerNest, seen) : "");
    }
    return parts.join("~");
  };

  const trackState = new Map<string, string>();
  const trackHidden = new Map<string, boolean>();
  let visibleIndex = 0;
  for (const track of project.timeline.tracks) {
    trackHidden.set(track.id, track.hidden);
    trackState.set(track.id, track.hidden ? "hidden" : `v${visibleIndex}`);
    if (!track.hidden) visibleIndex++;
  }

  for (const track of project.timeline.tracks) {
    const state = trackState.get(track.id) ?? "";
    for (const clip of track.clips) {
      const media = mediaById.get(clip.mediaId);
      const compoundId = compoundIdOf(clip);
      if (media?.type === "audio" && !compoundId) continue;
      const spans = track.hidden ? [] : span(clip.startTime, clip.startTime + clip.duration);
      const fingerprint = track.hidden
        ? "hidden"
        : [
            clipPixelBody(clip),
            state,
            mediaFingerprint(media),
            compoundId ? stableStringify(compoundById.get(compoundId) ?? null) : "",
            compoundId ? nestedMaskFingerprint(compoundId, new Set()) : "",
            maskFingerprint(clip.id),
          ].join("|");
      entities.set(`clip:${clip.id}`, { key: `clip:${clip.id}`, fingerprint, spans });
    }
    for (const transition of track.transitions ?? []) {
      const spans = track.hidden ? [] : transitionSpans(transition, track);
      const fingerprint = track.hidden
        ? "hidden"
        : stableStringify({
            type: transition.type,
            duration: transition.duration,
            params: transition.params,
            edge: transition.edge,
            a: transition.clipAId,
            b: transition.clipBId,
          }) + `|${state}`;
      const key = `transition:${track.id}:${transition.id}`;
      entities.set(key, { key, fingerprint, spans });
    }
  }

  for (const collection of TIMED_COLLECTIONS) {
    const items = (project[collection] ?? []) as unknown as TimedItem[];
    for (const item of items) {
      const state = item.trackId ? trackState.get(item.trackId) ?? "" : "";
      let extra = "";
      if (collection === "motionInstances") {
        const compositionId = (item as unknown as { compositionId: string }).compositionId;
        extra = stableStringify(compositionById.get(compositionId) ?? null);
      } else if (collection === "nestedInstances") {
        const compoundClipId = (item as unknown as { compoundClipId: string }).compoundClipId;
        extra = stableStringify(compoundById.get(compoundClipId) ?? null);
      }
      const hidden = item.trackId ? trackHidden.get(item.trackId) === true : false;
      const key = `${collection}:${item.id}`;
      entities.set(key, {
        key,
        fingerprint: hidden ? "hidden" : `${stableStringify(item)}|${state}|${extra}`,
        spans: hidden ? [] : span(item.startTime, item.startTime + item.duration),
      });
    }
  }

  for (const subtitle of project.timeline.subtitles ?? []) {
    const key = `subtitle:${subtitle.id}`;
    entities.set(key, {
      key,
      fingerprint: stableStringify(subtitle),
      spans: span(subtitle.startTime, subtitle.endTime),
    });
  }

  return { projectId: project.id, globalFingerprint: globalFingerprint(project), entities };
}
