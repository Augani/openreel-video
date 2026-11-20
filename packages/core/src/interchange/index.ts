import type { MediaItem, Project } from "../types/project";
import type { Timeline, Track } from "../types/timeline";
import { calculateProjectDuration } from "../timeline/project-duration";
import { ensureSequences, getSequence, projectForSequence, sequenceContentDuration, syncActiveSequence, withNestProjection } from "../timeline/sequences";
import type { CompoundClipInstance } from "../timeline/nested-sequence-engine";
import { getMulticamSource, multicamTag } from "../multicam/source";
import { flattenNests, hasNests } from "./nest-flatten";
import { AAF_LIMITS, aafNote } from "./aaf-decision";
import { looksLikeCompoundFile, parseAaf } from "./aaf/aaf-reader";
import { serializeAaf, type AafWriteOptions } from "./aaf/aaf-writer";
import { serializeEdls, type EdlFile, type EdlOptions } from "./edl";
import { looksLikeEdl, parseEdl } from "./edl-import";
import { parseFcpxml, serializeFcpxml } from "./fcpxml";
import {
  projectToSequence,
  sequenceToTimeline,
  type InterchangeReport,
  type Sequence,
  type SequenceToTimelineOptions,
  type TimelineImportResult,
} from "./model";
import { parseXmeml, serializeXmeml } from "./xmeml";
import { parseOtio, serializeOtio } from "./otio";
import { buildExportReport, formatItems, type ExportReport, type ReportItem } from "./report";

export * from "./timecode";
export { parseXml, XmlParseError } from "./xml";
export type { XmlElement } from "./xml";
export { serializeXmeml, parseXmeml } from "./xmeml";
export { serializeFcpxml, parseFcpxml, FCPXML_VERSION } from "./fcpxml";
export { validateXmeml } from "./xmeml-validate";
export { serializeOtio, parseOtio, validateOtio, OTIO_NAMESPACE } from "./otio";
export { buildExportReport, formatItems, projectUnsupported, clipUnsupported } from "./report";
export type { ExportReport, ReportItem, ReportSeverity, ExportFormatId } from "./report";
export { serializeEdl, serializeEdls } from "./edl";
export { parseEdl, looksLikeEdl, matchReelItems } from "./edl-import";
export type { EdlParseOptions, EdlClipInfo } from "./edl-import";
export { flattenNests, hasNests } from "./nest-flatten";
export {
  TICKS_PER_SECOND,
  defaultPrprojSequence,
  frameRateFromTicksPerFrame,
  gunzip,
  importPrproj,
  importPrprojDocument,
  listPrprojSequences,
  looksLikeGzip,
  looksLikePrproj,
  parsePrprojXml,
  parseTicks,
  prprojToSequence,
  readPrproj,
  resolveRef,
  ticksToFrames,
  ticksToSeconds,
} from "./prproj";
export type { PrprojDocument, PrprojImportResult, PrprojOptions, PrprojParse, PrprojSequenceInfo } from "./prproj";
export { AAF_DECISION, AAF_LIMITS, aafNote } from "./aaf-decision";
export { looksLikeCompoundFile } from "./aaf/aaf-reader";
export type { EdlFile, EdlOptions } from "./edl";
export { projectToSequence, sequenceToTimeline, relinkMedia } from "./model";
export type {
  ImportReport,
  InterchangeReport,
  Sequence,
  SeqClip,
  SeqMarker,
  SeqMedia,
  SeqTrack,
  SeqTransition,
  TimelineImportResult,
  UnmatchedMedia,
} from "./model";

export type InterchangeFormat = "xmeml" | "fcpxml" | "edl" | "otio" | "aaf";
export type ImportableFormat = "xmeml" | "fcpxml" | "otio" | "aaf" | "edl" | "prproj";

export interface InterchangeFile {
  readonly filename: string;
  readonly mimeType: string;
  /** Text content; empty for binary formats (AAF), which set `bytes` instead. */
  readonly content: string;
  readonly bytes?: Uint8Array;
}

export interface ExportTimelineOptions {
  /** Use drop-frame timecode for 29.97 / 59.94 projects. */
  dropFrame?: boolean;
  /** Write the project's markers (default true). */
  includeMarkers?: boolean;
  edl?: EdlOptions;
  /** Tracks currently targeted in the editor (UI state); carried where the format can. */
  targetedTrackIds?: readonly string[];
  /** Export this sequence instead of the active one (it does not have to be open). */
  sequenceId?: string;
  /** AAF only: writer options (start timecode, deterministic ids and clock for tests). */
  aaf?: AafWriteOptions;
}

export interface ExportTimelineResult {
  readonly format: InterchangeFormat;
  readonly files: InterchangeFile[];
  readonly warnings: string[];
  /** Everything the export dropped or approximated, per clip. */
  readonly report: ExportReport;
}

const safeName = (name: string): string =>
  name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "sequence";

/**
 * XMEML's multiclip has no slot in the neutral sequence, so a multicam cut
 * leaves as plain clips of each cut's active angle. Say so, once per clip.
 */
function multicamReportItems(project: Project): ReportItem[] {
  const tracks = [...project.timeline.tracks, ...(project.compoundClips ?? []).flatMap((compound) => compound.content?.tracks ?? [])];
  const items: ReportItem[] = [];
  for (const track of tracks) {
    for (const clip of track.clips) {
      const tag = multicamTag(clip);
      if (!tag) continue;
      const source = getMulticamSource(project, tag.sourceId);
      const angle = source?.angles.find((a) => a.id === tag.angleId);
      const media = project.mediaLibrary.items.find((m) => m.id === clip.mediaId);
      items.push({
        severity: "approximated",
        feature: "Multicam clip",
        detail: `Exported flattened to its active angle${angle ? ` "${angle.name}"` : ""}; the multi-camera source${source ? ` "${source.name}"` : ""} and its other angles are not carried.`,
        clipId: clip.id,
        clipName: media?.name ?? clip.mediaId,
        trackName: track.name,
      });
    }
  }
  return items;
}

const FCPXML_MULTICAM_NOTE =
  "Multicam cuts are written as multicam clips (mc-clip) over a multicam resource holding every synchronised angle; Final Cut re-creates the angles and the active angle of each cut. Angle audio routing beyond video / video+audio is not carried.";

const XMEML_MULTICAM_NOTE =
  "Multicam cuts are written as ordinary clips of the active angle plus a multiclip element listing every synchronised angle (offsets and the active angle). Premiere Pro and Resolve play the active angle; OpenReel rebuilds the multicam source on import. The multiclip layout follows Final Cut Pro 7's, with an extra exact-offset field, and was not verified in Premiere Pro.";

const hasMulticam = (seq: Sequence): boolean =>
  (seq.multicam?.length ?? 0) > 0 || seq.tracks.some((t) => t.clips.some((c) => c.nested && hasMulticam(c.nested)));

/** Per-format report items for the nested sequences an FCPXML export carries (the top sequence is reported by the caller). */
function nestedFormatItems(seq: Sequence, seen: Set<unknown> = new Set()): ReportItem[] {
  const out: ReportItem[] = [];
  for (const track of seq.tracks) {
    for (const clip of track.clips) {
      const nested = clip.nested;
      if (!nested || seen.has(nested.id ?? nested)) continue;
      seen.add(nested.id ?? nested);
      out.push(
        ...formatItems("fcpxml", nested).map((item) => ({ ...item, trackName: [nested.name, item.trackName].filter(Boolean).join(" / ") })),
        ...nestedFormatItems(nested, seen),
      );
    }
  }
  return out;
}

/** Serialize a sequence's video/audio timeline (the active one unless `sequenceId` is given) to an interchange format. */
export function exportTimeline(
  input: Project,
  format: InterchangeFormat,
  options: ExportTimelineOptions = {},
): ExportTimelineResult {
  let project = input;
  let sequenceName: string | undefined;
  if (options.sequenceId) {
    const chosen = getSequence(ensureSequences(input), options.sequenceId);
    if (!chosen) throw new Error("That sequence no longer exists.");
    const swapped = projectForSequence(input, options.sequenceId);
    if (!swapped) throw new Error("That sequence could not be opened for export.");
    project = swapped;
    sequenceName = chosen.name;
  }
  const projected = projectToSequence(project, {
    dropFrame: options.dropFrame,
    includeMarkers: options.includeMarkers,
    targetedTrackIds: options.targetedTrackIds,
  });
  const { report } = projected;
  let sequence = sequenceName ? { ...projected.sequence, name: sequenceName } : projected.sequence;
  // FCPXML carries multicam as mc-clip; the other formats leave as plain clips of each cut's active angle.
  const extraItems: ReportItem[] = format === "fcpxml" || format === "xmeml" ? [] : multicamReportItems(project);
  // XMEML, OTIO and FCPXML carry nested sequences; EDL gets them expanded in place, with a report entry each.
  if ((format === "edl" || format === "aaf") && hasNests(sequence)) {
    const flat = flattenNests(sequence);
    sequence = flat.sequence;
    extraItems.push(...flat.items);
    report.warnings.push(...flat.items.map((i) => i.detail));
  }
  const base = safeName(sequence.name);
  const exportReport = (writerNotes: readonly string[] = []): ExportReport =>
    buildExportReport(format, [
      ...(report.items ?? []),
      ...extraItems,
      ...formatItems(format, sequence, report.trackNames),
      ...(format === "fcpxml" ? nestedFormatItems(sequence) : []),
      ...writerNotes.map((detail): ReportItem => ({ severity: "approximated", feature: "AAF writer", detail })),
    ], [...(format === "aaf" ? AAF_LIMITS : [aafNote()]), ...(format === "fcpxml" && hasMulticam(sequence) ? [FCPXML_MULTICAM_NOTE] : []), ...(format === "xmeml" && hasMulticam(sequence) ? [XMEML_MULTICAM_NOTE] : []), ...(project.mediaLibrary.items.some((item) => item.proxy) ? ["Media references point at the full-resolution files; proxies are never exported."] : [])]);
  if (format === "aaf") {
    const written = serializeAaf(sequence, options.aaf);
    return {
      format,
      warnings: [...report.warnings, ...written.notes],
      report: exportReport(written.notes),
      files: [{ filename: `${base}.aaf`, mimeType: "application/octet-stream", content: "", bytes: written.bytes }],
    };
  }
  if (format === "otio") {
    return {
      format,
      warnings: report.warnings,
      report: exportReport(),
      files: [{ filename: `${base}.otio`, mimeType: "application/json", content: serializeOtio(sequence) }],
    };
  }
  if (format === "xmeml") {
    return {
      format,
      warnings: report.warnings,
      report: exportReport(),
      files: [{ filename: `${base}.xml`, mimeType: "application/xml", content: serializeXmeml(sequence) }],
    };
  }
  if (format === "fcpxml") {
    const content = serializeFcpxml(sequence, report);
    return {
      format,
      warnings: report.warnings,
      report: exportReport(),
      files: [{ filename: `${base}.fcpxml`, mimeType: "application/xml", content }],
    };
  }
  const edls: EdlFile[] = serializeEdls(sequence, options.edl);
  if (edls.length === 0) throw new Error("There are no video clips to export as an EDL.");
  return {
    format,
    warnings: report.warnings,
    report: exportReport(),
    files: edls.map((f) => ({ filename: f.filename, mimeType: "text/plain", content: f.content })),
  };
}

export function detectInterchangeFormat(text: string): ImportableFormat | null {
  const head = text.slice(0, 4096);
  if (/^\s*\{/.test(head) && /"OTIO_SCHEMA"\s*:\s*"(Timeline|Stack)\./.test(text.slice(0, 65536))) return "otio";
  if (/<xmeml[\s>]/.test(head)) return "xmeml";
  if (/<fcpxml[\s>]/.test(head)) return "fcpxml";
  if (looksLikeEdl(text)) return "edl";
  return null;
}

export function parseInterchangeSequence(text: string): {
  format: ImportableFormat;
  sequence: Sequence;
  report: InterchangeReport;
} {
  const format = detectInterchangeFormat(text);
  if (!format) throw new Error("This file is not a Final Cut Pro XML (xmeml), FCPXML or OpenTimelineIO timeline.");
  const parsed =
    format === "xmeml" ? parseXmeml(text) : format === "fcpxml" ? parseFcpxml(text) : format === "edl" ? parseEdl(text) : parseOtio(text);
  return { format, ...parsed };
}

/** Parse a timeline file and relink it against the media bin. */
export function importTimeline(
  text: string,
  options: SequenceToTimelineOptions,
): TimelineImportResult & { format: ImportableFormat } {
  const { format, sequence, report } =
    detectInterchangeFormat(text) === "edl"
      ? { format: "edl" as const, ...parseEdl(text, { frameRate: options.frameRate, mediaItems: options.mediaItems }) }
      : parseInterchangeSequence(text);
  return { format, ...sequenceToTimeline(sequence, options, report.warnings) };
}

/** Parse an AAF file (bytes) into the neutral sequence. */
export function parseAafSequence(bytes: Uint8Array): { format: "aaf"; sequence: Sequence; report: InterchangeReport } {
  return { format: "aaf", ...parseAaf(bytes) };
}

/** Parse an AAF file and relink it against the media bin. */
export function importAaf(
  bytes: Uint8Array,
  options: SequenceToTimelineOptions,
): TimelineImportResult & { format: ImportableFormat } {
  const { sequence, report } = parseAafSequence(bytes);
  return { format: "aaf", ...sequenceToTimeline(sequence, options, report.warnings) };
}

/** Import either kind of timeline file: AAF (binary) or xmeml / FCPXML / OTIO (text). */
export function importTimelineFile(
  bytes: Uint8Array,
  options: SequenceToTimelineOptions,
): TimelineImportResult & { format: ImportableFormat } {
  if (looksLikeCompoundFile(bytes)) return importAaf(bytes, options);
  return importTimeline(new TextDecoder("utf-8").decode(bytes), options);
}

export type TimelineImportMode = "replace" | "append";

const isInterchangeTrack = (t: Track): boolean =>
  t.type === "video" || t.type === "image" || t.type === "audio";

/**
 * Compute the project's next timeline + media library for an import. "replace"
 * swaps the unlocked video/audio/image tracks and markers (locked, text and
 * graphics tracks are kept); "append" adds the imported tracks next to the existing ones. Commit the
 * result as ONE `project/applyEditSnapshot` action to get a single undo step.
 */
export function planTimelineImport(
  project: Project,
  result: TimelineImportResult,
  mode: TimelineImportMode = "replace",
): { timeline: Timeline; mediaItems: MediaItem[] } {
  const existing = project.timeline.tracks;
  const importedVideo = result.tracks.filter((t) => t.type !== "audio");
  const importedAudio = result.tracks.filter((t) => t.type === "audio");
  // Locked tracks are protected from edits, so "replace" never removes them.
  const lockedVisual = existing.filter((t) => t.locked && t.type !== "audio" && isInterchangeTrack(t));
  const lockedAudio = existing.filter((t) => t.locked && t.type === "audio");
  const tracks =
    mode === "replace"
      ? [
          ...importedVideo,
          ...lockedVisual,
          ...existing.filter((t) => !isInterchangeTrack(t)),
          ...lockedAudio,
          ...importedAudio,
        ]
      : [...importedVideo, ...existing, ...importedAudio];
  const markers =
    mode === "replace" ? result.markers : [...project.timeline.markers, ...result.markers];
  const mediaItems = [...project.mediaLibrary.items, ...result.newMedia];
  const draft: Timeline = { ...project.timeline, tracks, markers };
  const duration = calculateProjectDuration({ ...project, timeline: draft });
  return { timeline: { ...draft, duration }, mediaItems };
}

/**
 * Add the bins an import carries (.prproj master-clip bins) to the project. A bin that already exists (same name
 * under the same parent) is reused, so importing twice does not duplicate the folder tree; the new media is
 * re-pointed at the surviving bin ids.
 */
function mergeImportedBins(project: Project, result: TimelineImportResult): { project: Project; result: TimelineImportResult } {
  if (!result.newBins?.length) return { project, result };
  const bins = [...(project.bins ?? [])];
  const remap = new Map<string, string>();
  for (const bin of result.newBins) {
    const parentId = bin.parentId ? remap.get(bin.parentId) ?? bin.parentId : undefined;
    const existing = bins.find((b) => b.name === bin.name && b.parentId === parentId);
    if (existing) {
      remap.set(bin.id, existing.id);
    } else {
      remap.set(bin.id, bin.id);
      bins.push({ ...bin, ...(parentId ? { parentId } : {}) });
    }
  }
  const newMedia = result.newMedia.map((item) => (item.binId && remap.has(item.binId) ? { ...item, binId: remap.get(item.binId) } : item));
  return { project: { ...project, bins }, result: { ...result, newMedia } };
}

/**
 * The project after an import commit: the planned timeline and media, plus, when the file carried
 * compound clips (FCPXML media + ref-clip), one project sequence per compound clip and an instance
 * record per imported nest clip. Commit the result through `editSnapshot` as ONE undo step.
 */
export function applyTimelineImport(
  input: Project,
  result: TimelineImportResult,
  mode: TimelineImportMode = "replace",
): Project {
  const binned = mergeImportedBins(input, result);
  const project = binned.project;
  const plan = planTimelineImport(project, binned.result, mode);
  result = binned.result;
  const mediaLibrary = { ...project.mediaLibrary, items: plan.mediaItems };
  const multicamSources = result.multicamSources?.length
    ? { multicamSources: [...(project.multicamSources ?? []), ...result.multicamSources] }
    : {};
  if (!result.nests?.length) return { ...project, ...multicamSources, timeline: plan.timeline, mediaLibrary };

  const ensured = syncActiveSequence(ensureSequences(project));
  const taken = new Set((ensured.sequences ?? []).map((sequence) => sequence.name));
  const uniqueName = (base: string): string => {
    let name = base || "Compound Clip";
    for (let n = 2; taken.has(name); n += 1) name = `${base || "Compound Clip"} ${n}`;
    taken.add(name);
    return name;
  };
  const now = Date.now();
  const imported = result.nests.map((nest) => ({
    id: nest.id,
    name: uniqueName(nest.name),
    settings: { ...ensured.settings, ...nest.settings },
    timeline: {
      tracks: nest.tracks,
      subtitles: [],
      markers: nest.markers,
      duration: sequenceContentDuration({ tracks: nest.tracks }),
    },
    createdAt: now,
    modifiedAt: now,
  }));
  const importedNames = new Map(imported.map((sequence) => [sequence.id, sequence.name]));
  // The nest clips keep the (possibly de-duplicated) sequence name on their badge.
  const renameClips = (tracks: Track[]): Track[] =>
    tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        const id = clip.metadata?.compoundClipId;
        const name = typeof id === "string" ? importedNames.get(id) : undefined;
        return name ? { ...clip, metadata: { ...clip.metadata, compoundClipName: name } } : clip;
      }),
    }));
  const timeline: Timeline = { ...plan.timeline, tracks: renameClips(plan.timeline.tracks) };
  const sequences = [
    ...(ensured.sequences ?? []),
    ...imported.map((sequence) => ({ ...sequence, timeline: { ...sequence.timeline, tracks: renameClips(sequence.timeline.tracks) } })),
  ];
  const liveClipIds = new Set(timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  const importedIds = new Set(result.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  const instances: CompoundClipInstance[] = timeline.tracks.flatMap((track) =>
    track.clips
      .filter((clip) => importedIds.has(clip.id) && typeof clip.metadata?.compoundClipId === "string")
      .map((clip) => ({
        id: clip.id,
        compoundClipId: clip.metadata?.compoundClipId as string,
        trackId: track.id,
        startTime: clip.startTime,
        duration: clip.duration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        transform: clip.transform,
        volume: clip.volume,
      })),
  );
  return withNestProjection({
    ...ensured,
    ...multicamSources,
    timeline,
    mediaLibrary,
    sequences,
    nestedInstances: [...(ensured.nestedInstances ?? []).filter((instance) => liveClipIds.has(instance.id)), ...instances],
  });
}
