import type { Clip, Marker, MarkerKind, Track, Transition } from "../types/timeline";
import { MARKER_KINDS } from "../types/timeline";
import type { MediaBin, MediaItem, Project } from "../types/project";
import { ensureSequences, syncActiveSequence } from "../timeline/sequences";
import { getCompoundClipId } from "../timeline/timeline-items";
import { getMulticamSource, multicamTag, MULTICAM_ANGLE_COLORS, type MulticamSource } from "../multicam/source";
import type { TransitionType } from "../types/effects";
import { projectUnsupported, type ReportItem } from "./report";
import {
  resolveFrameRate,
  secondsToFrames,
  type FrameRate,
} from "./timecode";

/**
 * Format-neutral description of a sequence. Serializers (xmeml, FCPXML, EDL)
 * read it and parsers produce it, so every format shares one project mapping.
 */

export type SeqTransitionKind = "dissolve" | "dipToBlack" | "dipToWhite" | "wipe" | "push" | "slide";

export interface SeqMedia {
  readonly key: string;
  readonly name: string;
  /** file:// URL if known, otherwise undefined. */
  readonly pathUrl?: string;
  readonly kind: "video" | "audio" | "image";
  readonly durationSec: number;
  readonly rate: FrameRate;
  readonly width: number;
  readonly height: number;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
  readonly sampleRate: number;
  readonly channels: number;
  /**
   * Embedded start timecode of the file (a time of day in seconds), from its MOV timecode track or MXF timecode
   * component. Absent = the file starts at 00:00:00:00. EDL source columns, the xmeml file timecode and the FCPXML
   * asset start carry it.
   */
  readonly startSec?: number;
  /** A bin item the importer already chose (EDL reel + source timecode); relinking honours it before name matching. */
  readonly mediaItemId?: string;
  /** Project-panel bin path (outermost first) the source file lived in (.prproj master clips). */
  readonly binPath?: readonly string[];
}

/** A marker on a clip (clip + master-clip markers merged); `sec` is in the media's own (source) time. */
export interface SeqClipMarker {
  readonly sec: number;
  readonly name: string;
  readonly durationSec?: number;
  readonly comment?: string;
  readonly color?: string;
  readonly kind?: MarkerKind;
}

export interface SeqClip {
  readonly id: string;
  readonly name: string;
  readonly mediaKey: string;
  /** Sequence frames (end exclusive). */
  readonly startFrame: number;
  readonly endFrame: number;
  /** Source range in seconds of the media. */
  readonly inSec: number;
  readonly outSec: number;
  /** Positive playback speed multiplier; direction lives in `reversed`. */
  readonly speed: number;
  readonly reversed: boolean;
  /** 0..1 */
  readonly opacity: number;
  /** Linear gain, 1 = 0 dB. */
  readonly volume: number;
  /** Video clip that also plays its source audio (xmeml writes a linked audio item). */
  readonly withAudio: boolean;
  /**
   * Set when this clip is a nested sequence (a nest). `mediaKey` is then empty, the clip's
   * source range (inSec/outSec) is in the nested sequence's own time, and formats that have
   * no nesting get it flattened by `flattenNests`.
   */
  readonly nested?: Sequence;
  /**
   * Set when this clip is the cut of one multicam angle (OpenReel keeps a multicam cut as ordinary
   * clips of the active angle's media). FCPXML turns it into an `mc-clip`; the other formats ignore it.
   */
  readonly multicam?: { readonly sourceId: string; readonly angleId: string };
  /** Clip markers merged with the media's master-clip markers, in source time (XMEML writes them in the clipitem). */
  readonly markers?: readonly SeqClipMarker[];
  /** EDL import: the event's reel name and source timecodes, kept on the clip as `metadata.edl`. */
  readonly edl?: { readonly reel: string; readonly sourceIn: string; readonly sourceOut: string; readonly event: number };
  /**
   * Basic motion from the source file: `x` / `y` are pixel offsets from the frame centre of the sequence,
   * `scale` is a multiplier (1 = 100%). Absent = untouched. Only .prproj import fills it.
   */
  readonly motion?: { readonly x: number; readonly y: number; readonly scale: number; readonly rotation?: number };
  /** The source file had the clip disabled. OpenReel has no clip enable flag: it is imported muted / transparent. */
  readonly disabled?: boolean;
  /** Extra clip metadata kept as `clip.metadata.<key>` (for example the .prproj origin). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** One synchronised camera angle of a multicam source. */
export interface SeqMulticamAngle {
  readonly id: string;
  readonly name: string;
  readonly media: SeqMedia;
  /** Shared-timeline time at which this media's own time 0 plays (seconds). */
  readonly offsetSec: number;
}

export interface SeqMulticam {
  readonly id: string;
  readonly name: string;
  readonly angles: readonly SeqMulticamAngle[];
}

export interface SeqTransition {
  readonly kind: SeqTransitionKind;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly alignment: "center" | "start" | "end";
}

export interface SeqTrack {
  readonly kind: "video" | "audio";
  readonly name: string;
  readonly clips: SeqClip[];
  readonly transitions: SeqTransition[];
  /** Hidden (video) or muted (audio). */
  readonly disabled: boolean;
  readonly locked: boolean;
  /** Sync-lock state; undefined means "not stated" (treated as ON, the OpenReel default). */
  readonly syncLock?: boolean;
  /** Premiere-style track targeting. */
  readonly targeted?: boolean;
  /** Audio tracks: the track fader as linear gain (1 = 0 dB); absent means unity. Only AAF carries it. */
  readonly gain?: number;
}

export interface SeqMarker {
  readonly frame: number;
  readonly name: string;
  /** Range markers only: length in sequence frames (absent for a point marker). */
  readonly durationFrames?: number;
  readonly comment?: string;
  /** Hex colour (#rrggbb). */
  readonly color?: string;
  readonly kind?: MarkerKind;
}

export interface Sequence {
  /** Id of the OpenReel sequence this was built from (nests): lets a format share one definition between instances. */
  readonly id?: string;
  readonly name: string;
  readonly rate: FrameRate;
  readonly width: number;
  readonly height: number;
  readonly durationFrames: number;
  /** Timecode of the sequence's first frame (the project's start timecode); absent = 00:00:00:00 (EDL: 01:00:00:00). */
  readonly startTimecode?: string;
  /** Video tracks bottom (V1) to top, then audio tracks A1... */
  readonly tracks: SeqTrack[];
  readonly markers: SeqMarker[];
  readonly media: SeqMedia[];
  /** Start timecode of the sequence in frames at `rate` (AAF carries it; the other formats start at 0). */
  readonly startTimecodeFrames?: number;
  /** Multicam sources the clips of this sequence cut between (FCPXML mc-clip). */
  readonly multicam?: readonly SeqMulticam[];
}

export interface InterchangeReport {
  /** Non-fatal conversions the user should know about. */
  readonly warnings: string[];
  /** Dropped / approximated features, per clip (export side only). */
  readonly items?: ReportItem[];
  /** Interchange track name ("V1", "A1") -> the OpenReel track's own name. */
  readonly trackNames?: Record<string, string>;
}

export const TRANSITION_TO_KIND: Partial<Record<TransitionType, SeqTransitionKind>> = {
  crossfade: "dissolve",
  dipToBlack: "dipToBlack",
  dipToWhite: "dipToWhite",
  wipe: "wipe",
  push: "push",
  slide: "slide",
};

export const KIND_TO_TRANSITION: Record<SeqTransitionKind, TransitionType> = {
  dissolve: "crossfade",
  dipToBlack: "dipToBlack",
  dipToWhite: "dipToWhite",
  wipe: "wipe",
  push: "push",
  slide: "slide",
};

/** Sequence marker from an OpenReel marker. Optional fields appear only when set, so point markers stay `{ frame, name }`. */
export function markerToSeq(m: Marker, rate: FrameRate): SeqMarker {
  const frame = Math.max(0, secondsToFrames(m.time, rate));
  const durationFrames = m.duration ? secondsToFrames(m.time + m.duration, rate) - frame : 0;
  return {
    frame,
    name: m.label,
    ...(durationFrames > 0 ? { durationFrames } : {}),
    ...(m.comment ? { comment: m.comment } : {}),
    ...(m.color ? { color: m.color } : {}),
    ...(m.kind && m.kind !== "comment" ? { kind: m.kind } : {}),
  };
}

/** OpenReel marker fields from a sequence marker (time/duration in seconds at `fps`). */
export function seqToMarkerFields(
  m: SeqMarker,
  fps: number,
): Pick<Marker, "time" | "label" | "color" | "duration" | "comment" | "kind"> {
  return {
    time: m.frame / fps,
    label: m.name,
    color: m.color ?? DEFAULT_IMPORTED_MARKER_COLOR,
    ...(m.durationFrames && m.durationFrames > 0 ? { duration: m.durationFrames / fps } : {}),
    ...(m.comment ? { comment: m.comment } : {}),
    ...(m.kind && (MARKER_KINDS as readonly string[]).includes(m.kind) ? { kind: m.kind } : {}),
  };
}

export interface ProjectToSequenceOptions {
  dropFrame?: boolean;
  /** Write project markers into the sequence (default true). */
  includeMarkers?: boolean;
  /** Sequence ids currently being expanded (cycle guard for nests). Internal. */
  nestStack?: readonly string[];
  /** The whole project with its sequences synced, used to resolve nest clips. Internal. */
  nestLookup?: Project;
  /** Ids of the tracks currently targeted (editor UI state, not in the project file). */
  targetedTrackIds?: readonly string[];
}

const hasAudioStream = (media: MediaItem | undefined): boolean => {
  if (!media || media.type === "image") return false;
  if (media.type === "audio") return true;
  const m = media.metadata;
  if (m.hasAudio !== undefined) return m.hasAudio;
  return (m.audioTrackCount ?? 0) > 0 || (m.channels ?? 0) > 0;
};

function fileUrlFor(media: MediaItem): string {
  const folder = media.sourceFile?.folder?.replace(/\\/g, "/").replace(/\/+$/, "");
  const encodedName = encodeURIComponent(media.sourceFile?.name ?? media.name);
  if (folder) {
    const encodedFolder = folder
      .split("/")
      .map((part) => (part ? encodeURIComponent(part) : part))
      .join("/");
    return `file://localhost${encodedFolder.startsWith("/") ? "" : "/"}${encodedFolder}/${encodedName}`;
  }
  return `file://localhost/${encodedName}`;
}

const isVisualTrack = (track: Track): boolean => track.type === "video" || track.type === "image";

/** Build the neutral sequence from an OpenReel project. */
export function projectToSequence(
  project: Project,
  options: ProjectToSequenceOptions = {},
): { sequence: Sequence; report: InterchangeReport } {
  const warnings: string[] = [];
  const items: ReportItem[] = [];
  const rate = resolveFrameRate(project.settings.frameRate || 30, {
    dropFrame: options.dropFrame,
  });
  const mediaById = new Map(project.mediaLibrary.items.map((m) => [m.id, m]));
  const usedMedia = new Map<string, SeqMedia>();

  const buildMedia = (mediaId: string, register: boolean): SeqMedia | null => {
    const existing = usedMedia.get(mediaId);
    if (existing) return existing;
    const item = mediaById.get(mediaId);
    if (!item) return null;
    const m = item.metadata;
    const seqMedia: SeqMedia = {
      key: item.id,
      name: item.sourceFile?.name ?? item.name,
      pathUrl: fileUrlFor(item),
      kind: item.type,
      durationSec: m.duration > 0 ? m.duration : 0,
      rate: item.type === "video" && m.frameRate > 0 ? resolveFrameRate(m.frameRate) : rate,
      width: m.width > 0 ? m.width : project.settings.width,
      height: m.height > 0 ? m.height : project.settings.height,
      hasVideo: item.type !== "audio",
      hasAudio: hasAudioStream(item),
      sampleRate: m.sampleRate > 0 ? m.sampleRate : project.settings.sampleRate || 48000,
      channels: m.channels > 0 ? m.channels : 2,
      ...(typeof m.startTimecode === "number" && m.startTimecode > 0 ? { startSec: m.startTimecode } : {}),
    };
    if (register) usedMedia.set(mediaId, seqMedia);
    return seqMedia;
  };
  const mediaFor = (mediaId: string): SeqMedia | null => buildMedia(mediaId, true);

  const transitionsFor = (track: Track): SeqTransition[] => {
    const out: SeqTransition[] = [];
    for (const t of track.transitions ?? []) {
      const a = track.clips.find((c) => c.id === t.clipAId);
      if (!a) continue;
      const kind = TRANSITION_TO_KIND[t.type];
      if (!kind) {
        warnings.push(`Transition "${t.type}" has no interchange equivalent; exported as a cross dissolve.`);
        items.push({
          severity: "approximated",
          feature: "Transition",
          detail: `"${t.type}" has no interchange equivalent; exported as a cross dissolve.`,
          trackName: track.name,
        });
      }
      const durationFrames = Math.max(2, secondsToFrames(t.duration, rate));
      const cut = secondsToFrames(a.startTime + a.duration, rate);
      const start = cut - Math.floor(durationFrames / 2);
      out.push({
        kind: kind ?? "dissolve",
        startFrame: start,
        endFrame: start + durationFrames,
        alignment: "center",
      });
    }
    return out.sort((x, y) => x.startFrame - y.startFrame);
  };

  const nestStack = options.nestStack ?? [];
  const buildNest = (clip: Clip, track: Track, sequenceId: string): SeqClip | null => {
    const lookup = options.nestLookup ?? syncActiveSequence(ensureSequences(project));
    const nestedSequence = lookup.sequences?.find((candidate) => candidate.id === sequenceId);
    if (!nestedSequence || nestStack.includes(sequenceId)) {
      items.push({
        severity: "dropped",
        feature: "Nested sequence",
        detail: nestedSequence ? "The nested sequence contains itself and was skipped." : "The nested sequence no longer exists and was skipped.",
        clipId: clip.id,
        clipName: clip.id,
        trackName: track.name,
      });
      return null;
    }
    const inner = projectToSequence(
      { ...project, name: nestedSequence.name, timeline: nestedSequence.timeline, settings: nestedSequence.settings },
      { dropFrame: options.dropFrame, nestStack: [...nestStack, sequenceId], nestLookup: lookup },
    );
    warnings.push(...inner.report.warnings.map((w) => `${nestedSequence.name}: ${w}`));
    items.push(
      ...(inner.report.items ?? []).map((it) => ({
        ...it,
        trackName: [nestedSequence.name, it.trackName].filter(Boolean).join(" / "),
      })),
    );
    const startFrame = secondsToFrames(clip.startTime, rate);
    const endFrame = Math.max(startFrame + 1, secondsToFrames(clip.startTime + clip.duration, rate));
    const speedRaw = clip.speed ?? 1;
    return {
      id: clip.id,
      name: nestedSequence.name,
      mediaKey: "",
      startFrame,
      endFrame,
      inSec: clip.inPoint,
      outSec: clip.outPoint,
      speed: Math.abs(speedRaw) > 0 ? Math.abs(speedRaw) : 1,
      reversed: clip.reversed === true || speedRaw < 0,
      opacity: clip.transform?.opacity ?? 1,
      volume: clip.volume ?? 1,
      withAudio: isVisualTrack(track) && inner.sequence.tracks.some((t) => t.kind === "audio" && t.clips.length > 0),
      nested: { ...inner.sequence, id: nestedSequence.id },
    };
  };

  const usedMulticam = new Map<string, SeqMulticam>();
  /** The multicam source behind a tagged clip, with every angle's media, once per sequence. */
  const noteMulticam = (clip: Clip): { sourceId: string; angleId: string } | undefined => {
    const tag = multicamTag(clip);
    if (!tag) return undefined;
    const source = getMulticamSource(project, tag.sourceId);
    if (!source || !source.angles.some((angle) => angle.id === tag.angleId)) return undefined;
    if (!usedMulticam.has(source.id)) {
      const angles: SeqMulticamAngle[] = [];
      for (const angle of source.angles) {
        const media = buildMedia(angle.mediaId, false);
        if (media) angles.push({ id: angle.id, name: angle.name, media, offsetSec: angle.offset });
      }
      usedMulticam.set(source.id, { id: source.id, name: source.name, angles });
    }
    return { sourceId: source.id, angleId: tag.angleId };
  };

  const buildClip = (clip: Clip, track: Track): SeqClip | null => {
    const nestId = getCompoundClipId(clip);
    if (nestId) return buildNest(clip, track, nestId);
    const media = mediaFor(clip.mediaId);
    if (!media) {
      warnings.push(`Clip ${clip.id} references missing media and was skipped.`);
      items.push({
        severity: "dropped",
        feature: "Missing media",
        detail: "The clip references media that is not in the library and was skipped.",
        clipId: clip.id,
        clipName: clip.id,
        trackName: track.name,
      });
      return null;
    }
    const startFrame = secondsToFrames(clip.startTime, rate);
    const endFrame = Math.max(startFrame + 1, secondsToFrames(clip.startTime + clip.duration, rate));
    const speedRaw = clip.speed ?? 1;
    const speed = Math.abs(speedRaw) > 0 ? Math.abs(speedRaw) : 1;
    const multicam = noteMulticam(clip);
    const clipMarkers = [...(mediaById.get(clip.mediaId)?.markers ?? []), ...(clip.markers ?? [])]
      .filter((m) => options.includeMarkers !== false && m.time >= clip.inPoint - 1e-6 && m.time <= clip.outPoint + 1e-6)
      .sort((a, b) => a.time - b.time)
      .map((m) => ({
        sec: m.time,
        name: m.label,
        ...(m.duration ? { durationSec: m.duration } : {}),
        ...(m.comment ? { comment: m.comment } : {}),
        ...(m.color ? { color: m.color } : {}),
        ...(m.kind && m.kind !== "comment" ? { kind: m.kind } : {}),
      }));
    return {
      id: clip.id,
      name: media.name,
      mediaKey: media.key,
      startFrame,
      endFrame,
      inSec: clip.inPoint,
      outSec: clip.outPoint,
      speed,
      reversed: clip.reversed === true || speedRaw < 0,
      opacity: clip.transform?.opacity ?? 1,
      volume: clip.volume ?? 1,
      withAudio: isVisualTrack(track) && media.kind === "video" && media.hasAudio,
      ...(multicam ? { multicam } : {}),
      ...(clipMarkers.length ? { markers: clipMarkers } : {}),
    };
  };

  const foreignTrackIds = (): ReadonlySet<string> => {
    const lookup = options.nestLookup ?? (project.sequences ? syncActiveSequence(project) : undefined);
    const current = nestStack[nestStack.length - 1] ?? project.activeSequenceId;
    const ids = new Set<string>();
    for (const other of lookup?.sequences ?? []) {
      if (other.id !== current) for (const t of other.timeline.tracks) ids.add(t.id);
    }
    return ids;
  };

  const targeted = new Set(options.targetedTrackIds ?? []);
  const toSeqTrack = (track: Track, kind: "video" | "audio", name: string): SeqTrack => {
    const clips = [...track.clips]
      .sort((a, b) => a.startTime - b.startTime)
      .map((c) => buildClip(c, track))
      .filter((c): c is SeqClip => c !== null);
    return {
      kind,
      name,
      clips,
      transitions: kind === "video" ? transitionsFor(track) : [],
      disabled: kind === "video" ? track.hidden : track.muted,
      locked: track.locked,
      ...(track.syncLock === false ? { syncLock: false } : {}),
      ...(targeted.has(track.id) ? { targeted: true } : {}),
      ...(kind === "audio" && track.audioRack?.volume !== undefined && Math.abs(track.audioRack.volume - 1) > 1e-6
        ? { gain: track.audioRack.volume }
        : {}),
    };
  };

  const all = project.timeline.tracks;
  for (const track of all) {
    if (!isVisualTrack(track) && track.type !== "audio" && track.clips.length > 0) {
      warnings.push(
        `Track "${track.name}" (${track.type}) is not exported: text and graphics are not part of the interchange formats.`,
      );
    }
  }
  // OpenReel composites the FIRST track on top; interchange V1 is the bottom.
  const visual = all.filter(isVisualTrack).reverse();
  const audio = all.filter((t) => t.type === "audio");
  const tracks: SeqTrack[] = [
    ...visual.map((t, i) => toSeqTrack(t, "video", `V${i + 1}`)),
    ...audio.map((t, i) => toSeqTrack(t, "audio", `A${i + 1}`)),
  ];
  const trackNames: Record<string, string> = {};
  visual.forEach((t, i) => (trackNames[`V${i + 1}`] = t.name));
  audio.forEach((t, i) => (trackNames[`A${i + 1}`] = t.name));

  const durationFrames = tracks.reduce(
    (max, t) => t.clips.reduce((m, c) => Math.max(m, c.endFrame), max),
    0,
  );

  return {
    sequence: {
      name: project.name || "OpenReel Sequence",
      rate,
      width: project.settings.width,
      height: project.settings.height,
      durationFrames,
      ...(project.settings.startTimecode ? { startTimecode: project.settings.startTimecode } : {}),
      tracks,
      markers: options.includeMarkers === false ? [] : project.timeline.markers.map((m) => markerToSeq(m, rate)),
      media: [...usedMedia.values()],
      ...(usedMulticam.size ? { multicam: [...usedMulticam.values()] } : {}),
    },
    report: {
      warnings,
      trackNames,
      items: [
        ...projectUnsupported(
          project,
          (c) => mediaById.get(c.mediaId)?.sourceFile?.name ?? mediaById.get(c.mediaId)?.name ?? c.id,
          foreignTrackIds(),
        ),
        ...items,
      ],
    },
  };
}

// ── import side ─────────────────────────────────────────────────────────────

export interface UnmatchedMedia {
  readonly name: string;
  readonly pathUrl?: string;
  readonly clipCount: number;
}

export interface TimelineImportResult {
  readonly tracks: Track[];
  readonly markers: Marker[];
  /** Placeholder items (isPlaceholder) for media that was not in the bin. */
  readonly newMedia: MediaItem[];
  readonly matched: { name: string; mediaId: string }[];
  readonly unmatched: UnmatchedMedia[];
  readonly settings: { width: number; height: number; frameRate: number };
  readonly sequenceName: string;
  readonly warnings: string[];
  readonly clipCount: number;
  /** Ids (of `tracks`) the source file marked as targeted; empty when it said nothing. */
  readonly targetedTrackIds?: string[];
  /**
   * Nested sequences (compound clips) the file carried, dependencies first. Their nest clips in
   * `tracks` (and in other nests) reference them by `compound:<id>`. Absent when there are none.
   */
  readonly nests?: ImportedNest[];
  /**
   * Multicam sources the file carried (XMEML multiclip), one per distinct source with fresh ids. The clips
   * of `tracks` / `nests` that cut them carry `metadata.multicam` pointing at these. Absent when there are none.
   */
  readonly multicamSources?: MulticamSource[];
  /** Project-panel bins to create for the imported media (`newMedia[].binId` points at them). Absent when none. */
  readonly newBins?: MediaBin[];
  /** What the importer dropped or approximated, per item (.prproj import). */
  readonly importReport?: ImportReport;
}

export interface ImportReport {
  readonly items: ReportItem[];
  /** Informational lines (what was read, what is never read). */
  readonly notes: string[];
  readonly dropped: number;
  readonly approximated: number;
}

/** A compound clip from an interchange file, converted to OpenReel tracks; becomes a project sequence on commit. */
export interface ImportedNest {
  /** The id the sequence will have in the project. */
  readonly id: string;
  readonly name: string;
  readonly settings: { width: number; height: number; frameRate: number };
  readonly tracks: Track[];
  readonly markers: Marker[];
}

const NEST_IMPORT_COLOR = "#8b5cf6";

/** Every media of a sequence and of the sequences nested in it, by key. */
function collectMedia(seq: Sequence, seen: Set<Sequence> = new Set(), into: Map<string, SeqMedia> = new Map()): SeqMedia[] {
  if (seen.has(seq)) return [...into.values()];
  seen.add(seq);
  for (const media of seq.media) if (!into.has(media.key)) into.set(media.key, media);
  for (const mc of seq.multicam ?? []) for (const angle of mc.angles) if (!into.has(angle.media.key)) into.set(angle.media.key, angle.media);
  for (const track of seq.tracks) for (const clip of track.clips) if (clip.nested) collectMedia(clip.nested, seen, into);
  return [...into.values()];
}

/** Every multicam source of a sequence and of the sequences nested in it, by source id. */
function collectMulticam(seq: Sequence, seen: Set<Sequence> = new Set(), into: Map<string, SeqMulticam> = new Map()): Map<string, SeqMulticam> {
  if (seen.has(seq)) return into;
  seen.add(seq);
  for (const mc of seq.multicam ?? []) if (!into.has(mc.id)) into.set(mc.id, mc);
  for (const track of seq.tracks) for (const clip of track.clips) if (clip.nested) collectMulticam(clip.nested, seen, into);
  return into;
}

export interface SequenceToTimelineOptions {
  /** Existing media bin used to relink by filename. */
  mediaItems: readonly MediaItem[];
  /** Deterministic id factory (tests); defaults to crypto.randomUUID. */
  makeId?: () => string;
  /** Project frame rate; EDLs carry no rate of their own. */
  frameRate?: number;
}

export function basenameOfUrl(value: string): string {
  const clean = value.split(/[?#]/)[0].replace(/\\/g, "/");
  const last = clean.slice(clean.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

const stem = (filename: string): string => filename.replace(/\.[^./]+$/, "");

function defaultId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Relink imported media against the bin by filename (exact, then unique stem). */
export function relinkMedia(
  seqMedia: readonly SeqMedia[],
  bin: readonly MediaItem[],
): Map<string, MediaItem> {
  const byName = new Map<string, MediaItem[]>();
  const byStem = new Map<string, MediaItem[]>();
  const add = (map: Map<string, MediaItem[]>, key: string, item: MediaItem) => {
    const k = key.toLowerCase();
    const list = map.get(k) ?? [];
    if (!list.includes(item)) list.push(item);
    map.set(k, list);
  };
  for (const item of bin) {
    for (const name of [item.sourceFile?.name, item.name]) {
      if (!name) continue;
      add(byName, name, item);
      add(byStem, stem(name), item);
    }
  }
  const out = new Map<string, MediaItem>();
  const byId = new Map(bin.map((item) => [item.id, item]));
  for (const media of seqMedia) {
    const chosen = media.mediaItemId ? byId.get(media.mediaItemId) : undefined;
    if (chosen) {
      out.set(media.key, chosen);
      continue;
    }
    const candidates = [media.pathUrl ? basenameOfUrl(media.pathUrl) : "", media.name].filter(Boolean);
    let found: MediaItem | undefined;
    for (const candidate of candidates) {
      const hits = byName.get(candidate.toLowerCase());
      if (hits?.length) {
        found = hits[0];
        break;
      }
    }
    if (!found) {
      for (const candidate of candidates) {
        const hits = byStem.get(stem(candidate).toLowerCase());
        if (hits?.length === 1) {
          found = hits[0];
          break;
        }
      }
    }
    if (found) out.set(media.key, found);
  }
  return out;
}

const DEFAULT_TRANSFORM = (opacity: number, motion?: SeqClip["motion"]): Clip["transform"] => ({
  position: { x: motion?.x ?? 0, y: motion?.y ?? 0 },
  scale: { x: motion?.scale ?? 1, y: motion?.scale ?? 1 },
  rotation: motion?.rotation ?? 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity,
  fitMode: "contain",
});

export const DEFAULT_IMPORTED_MARKER_COLOR = "#3b82f6";

/** Turn a neutral sequence into OpenReel tracks/markers, relinking media. */
export function sequenceToTimeline(
  seq: Sequence,
  options: SequenceToTimelineOptions,
  inheritedWarnings: readonly string[] = [],
): TimelineImportResult {
  const makeId = options.makeId ?? defaultId;
  const warnings = [...inheritedWarnings];
  const allMedia = collectMedia(seq);
  const links = relinkMedia(allMedia, options.mediaItems);
  const mediaIdFor = new Map<string, string>();
  const newMedia: MediaItem[] = [];
  const clipCounts = new Map<string, number>();
  // Bins for placeholder media (.prproj): one bin per distinct path prefix, parents first.
  const newBins: MediaBin[] = [];
  const binIds = new Map<string, string>();
  const binFor = (path: readonly string[] | undefined): string | undefined => {
    if (!path?.length) return undefined;
    let parentId: string | undefined;
    for (let depth = 1; depth <= path.length; depth++) {
      const key = JSON.stringify(path.slice(0, depth));
      let id = binIds.get(key);
      if (!id) {
        id = `bin-${makeId()}`;
        binIds.set(key, id);
        newBins.push({ id, name: path[depth - 1], ...(parentId ? { parentId } : {}) });
      }
      parentId = id;
    }
    return parentId;
  };

  for (const media of allMedia) {
    const hit = links.get(media.key);
    if (hit) {
      mediaIdFor.set(media.key, hit.id);
      continue;
    }
    const id = `media-${makeId()}`;
    mediaIdFor.set(media.key, id);
    const binId = binFor(media.binPath);
    newMedia.push({
      id,
      ...(binId ? { binId } : {}),
      name: media.name,
      type: media.kind,
      fileHandle: null,
      blob: null,
      metadata: {
        duration: media.durationSec,
        width: media.width,
        height: media.height,
        frameRate: media.kind === "video" ? media.rate.num / media.rate.den : 0,
        codec: "",
        sampleRate: media.sampleRate,
        channels: media.channels,
        fileSize: 0,
        hasVideo: media.hasVideo,
        hasAudio: media.hasAudio,
        ...(media.startSec ? { startTimecode: media.startSec } : {}),
      },
      thumbnailUrl: null,
      waveformData: null,
      isPlaceholder: true,
      sourceFile: { name: media.name, size: 0, lastModified: 0 },
    });
  }

  // Multicam sources (XMEML multiclip): fresh ids, angles pointing at the relinked / placeholder media.
  const multicamSources: MulticamSource[] = [];
  const multicamIds = new Map<string, { sourceId: string; angles: Map<string, string> }>();
  const importedAt = Date.now();
  for (const mc of collectMulticam(seq).values()) {
    const sourceId = `multicam_${makeId()}`;
    const angleIds = new Map<string, string>();
    const angles = mc.angles.flatMap((angle, index) => {
      const mediaId = mediaIdFor.get(angle.media.key);
      if (!mediaId) return [];
      const id = `angle_${makeId()}`;
      angleIds.set(angle.id, id);
      return [{
        id,
        name: angle.name,
        mediaId,
        offset: angle.offsetSec,
        duration: angle.media.durationSec,
        color: MULTICAM_ANGLE_COLORS[index % MULTICAM_ANGLE_COLORS.length],
      }];
    });
    if (angles.length < 2) {
      warnings.push(`Multicam clip "${mc.name}" has fewer than two usable angles and was imported as ordinary clips.`);
      continue;
    }
    multicamIds.set(mc.id, { sourceId, angles: angleIds });
    multicamSources.push({ id: sourceId, name: mc.name, angles, syncMethod: "manual", audio: { mode: "follow" }, createdAt: importedAt });
  }

  const fps = seq.rate.num / seq.rate.den;
  const tracksOut: Track[] = [];
  const targetedTrackIds: string[] = [];
  let clipCount = 0;

  // Nested sequences (compound clips): one project sequence per distinct nested definition.
  const nests: ImportedNest[] = [];
  const nestIds = new Map<unknown, string>();
  const nestKey = (s: Sequence): unknown => s.id ?? s;
  const nestIdFor = (nested: Sequence, stack: readonly unknown[]): string | null => {
    const key = nestKey(nested);
    const known = nestIds.get(key);
    if (known) return known;
    if (stack.includes(key)) return null;
    const id = `seq_${makeId()}`;
    const nestFps = nested.rate.num / nested.rate.den;
    const built = convertTracks(nested, nestFps, [...stack, key]);
    nestIds.set(key, id);
    nests.push({
      id,
      name: nested.name,
      settings: { width: nested.width, height: nested.height, frameRate: nestFps },
      tracks: built,
      markers: nested.markers.map((m) => ({
        id: `marker-${makeId()}`,
        ...seqToMarkerFields(m, nestFps),
      })),
    });
    return id;
  };

  const multicamTagFor = (sc: SeqClip): { sourceId: string; angleId: string } | undefined => {
    if (!sc.multicam) return undefined;
    const entry = multicamIds.get(sc.multicam.sourceId);
    const angleId = entry?.angles.get(sc.multicam.angleId);
    return entry && angleId ? { sourceId: entry.sourceId, angleId } : undefined;
  };

  const buildTrack = (st: SeqTrack, trackFps: number, stack: readonly unknown[]): Track => {
    const fps = trackFps;
    const trackId = `track-${makeId()}`;
    const clips: Clip[] = [];
    const idForSeq = new Map<SeqClip, string>();
    for (const sc of st.clips) {
      if (sc.nested) {
        const nestId = nestIdFor(sc.nested, stack);
        if (!nestId) {
          warnings.push(`Compound clip "${sc.name}" contains itself and was skipped.`);
          continue;
        }
        const nestClip: Clip = {
          id: `clip-${makeId()}`,
          mediaId: `compound:${nestId}`,
          trackId,
          startTime: sc.startFrame / fps,
          duration: (sc.endFrame - sc.startFrame) / fps,
          inPoint: sc.inSec,
          outPoint: sc.outSec,
          effects: [],
          audioEffects: [],
          transform: DEFAULT_TRANSFORM(sc.disabled ? 0 : sc.opacity, sc.motion),
          volume: sc.disabled ? 0 : sc.volume,
          keyframes: [],
          metadata: { ...(sc.metadata ?? {}), ...(sc.disabled ? { importedDisabled: true } : {}), compoundClipId: nestId, compoundClipName: sc.nested.name, compoundClipColor: NEST_IMPORT_COLOR },
          ...(sc.speed !== 1 ? { speed: sc.speed } : {}),
          ...(sc.reversed ? { reversed: true } : {}),
        };
        idForSeq.set(sc, nestClip.id);
        clips.push(nestClip);
        clipCount++;
        continue;
      }
      const mediaId = mediaIdFor.get(sc.mediaKey);
      if (!mediaId) {
        warnings.push(`Clip "${sc.name}" has no media reference and was skipped.`);
        continue;
      }
      clipCounts.set(sc.mediaKey, (clipCounts.get(sc.mediaKey) ?? 0) + 1);
      const duration = (sc.endFrame - sc.startFrame) / fps;
      const clip: Clip = {
        id: `clip-${makeId()}`,
        mediaId,
        trackId,
        startTime: sc.startFrame / fps,
        duration,
        inPoint: sc.inSec,
        outPoint: sc.outSec,
        effects: [],
        audioEffects: [],
        transform: DEFAULT_TRANSFORM(sc.disabled ? 0 : sc.opacity, sc.motion),
        volume: sc.disabled ? 0 : sc.volume,
        keyframes: [],
        ...(multicamTagFor(sc) || sc.edl || sc.metadata || sc.disabled
          ? {
              metadata: {
                ...(multicamTagFor(sc) ? { multicam: multicamTagFor(sc) } : {}),
                ...(sc.edl ? { edl: sc.edl } : {}),
                ...(sc.metadata ?? {}),
                ...(sc.disabled ? { importedDisabled: true } : {}),
              },
            }
          : {}),
        ...(sc.speed !== 1 ? { speed: sc.speed } : {}),
        ...(sc.reversed ? { reversed: true } : {}),
        ...(sc.markers?.length
          ? {
              markers: sc.markers.map((m) => ({
                id: `marker-${makeId()}`,
                time: m.sec,
                label: m.name,
                color: m.color ?? DEFAULT_IMPORTED_MARKER_COLOR,
                ...(m.durationSec && m.durationSec > 0 ? { duration: m.durationSec } : {}),
                ...(m.comment ? { comment: m.comment } : {}),
                ...(m.kind ? { kind: m.kind } : {}),
              })),
            }
          : {}),
      };
      idForSeq.set(sc, clip.id);
      clips.push(clip);
      clipCount++;
    }
    const transitions: Transition[] = [];
    for (const tr of st.transitions) {
      const durationFrames = tr.endFrame - tr.startFrame;
      const cut =
        tr.alignment === "start" ? tr.startFrame
        : tr.alignment === "end" ? tr.endFrame
        : tr.startFrame + Math.floor(durationFrames / 2);
      const a = st.clips.find((c) => Math.abs(c.endFrame - cut) <= 1);
      const b = st.clips.find((c) => Math.abs(c.startFrame - cut) <= 1 && c !== a);
      const aId = a && idForSeq.get(a);
      const bId = b && idForSeq.get(b);
      if (!aId || !bId) {
        warnings.push(`A transition at frame ${cut} is not between two adjacent clips and was skipped.`);
        continue;
      }
      transitions.push({
        id: `transition-${makeId()}`,
        clipAId: aId,
        clipBId: bId,
        type: KIND_TO_TRANSITION[tr.kind],
        duration: durationFrames / fps,
        params: {},
      });
    }
    if (st.targeted) targetedTrackIds.push(trackId);
    return {
      id: trackId,
      type: st.kind,
      name: st.name,
      clips,
      transitions,
      locked: st.locked,
      hidden: st.kind === "video" && st.disabled,
      muted: st.kind === "audio" && st.disabled,
      solo: false,
      ...(st.syncLock === false ? { syncLock: false } : {}),
      ...(st.kind === "audio" && st.gain !== undefined ? { audioRack: { effects: [], volume: st.gain } } : {}),
    };
  };

  // Interchange V1 is the bottom layer; OpenReel lists the top layer first.
  function convertTracks(source: Sequence, sourceFps: number, stack: readonly unknown[]): Track[] {
    const video = source.tracks.filter((t) => t.kind === "video").map((t) => buildTrack(t, sourceFps, stack)).reverse();
    const audio = source.tracks.filter((t) => t.kind === "audio").map((t) => buildTrack(t, sourceFps, stack));
    return [...video, ...audio];
  }
  tracksOut.push(...convertTracks(seq, fps, [nestKey(seq)]));

  const unmatched: UnmatchedMedia[] = allMedia
    .filter((m) => !links.has(m.key))
    .map((m) => ({ name: m.name, pathUrl: m.pathUrl, clipCount: clipCounts.get(m.key) ?? 0 }));
  const matched = allMedia
    .filter((m) => links.has(m.key))
    .map((m) => ({ name: m.name, mediaId: links.get(m.key)!.id }));

  return {
    tracks: tracksOut,
    markers: seq.markers.map((m) => ({
      id: `marker-${makeId()}`,
      ...seqToMarkerFields(m, fps),
    })),
    newMedia,
    matched,
    unmatched,
    settings: { width: seq.width, height: seq.height, frameRate: fps },
    sequenceName: seq.name,
    warnings,
    clipCount,
    ...(targetedTrackIds.length ? { targetedTrackIds } : {}),
    ...(nests.length ? { nests } : {}),
    ...(multicamSources.length ? { multicamSources } : {}),
    ...(newBins.length ? { newBins } : {}),
  };
}
