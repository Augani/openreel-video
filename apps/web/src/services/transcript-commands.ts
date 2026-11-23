import { v4 as uuidv4 } from "uuid";
import {
  applySpeakerStyles,
  assignSpeaker,
  mirrorSpeakersToTranslations,
  ensureSpeakerProfiles,
  renameSpeakerProfile,
  type SpeakerProfile,
  buildTranscript,
  cutDuration,
  decodeCaptionText,
  exportCaptionFileAsync,
  exportCaptions,
  findFillerWords,
  findPauses,
  importCaptionFile,
  looksLikeTranscriptJson,
  parseCaptions,
  parseTranscriptJson,
  planTranscriptCut,
  renameSpeaker,
  translateCaptionTrack,
  type CaptionTranslationProgress,
  type CaptionTranslator,
  type CaptionExportFormat,
  type CaptionExportOptions,
  type CaptionFile,
  type CaptionFormatIssue,
  type CaptionImportOptions,
  type FillerMatch,
  type PauseMatch,
  type Subtitle,
  type TimeRange,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { commit, type CommandOutcome } from "./premiere-edit-commands";

/**
 * Transcript-based editing commands for the editor. The transcript is the
 * project's caption cues (`timeline.subtitles`, word-timed when the source
 * had word times). Every command is ONE undo step: text cuts go through the
 * sync-lock aware planner and commitTimelineToolEdit, caption changes through
 * one `subtitle/setAll` action.
 */

export interface TranscriptOutcome extends CommandOutcome {
  /** Seconds removed from the sequence. */
  removed?: number;
  cuts?: number;
}

export const getSubtitles = (): Subtitle[] =>
  useProjectStore.getState().project.timeline.subtitles;

export function getTranscript(captionTrackId?: string) {
  return buildTranscript(getSubtitles(), { captionTrackId });
}

async function setSubtitles(subtitles: Subtitle[]): Promise<CommandOutcome> {
  const result = await useProjectStore.getState().executeAction({
    type: "subtitle/setAll",
    id: uuidv4(),
    timestamp: Date.now(),
    params: { subtitles },
  });
  return result.success
    ? { success: true }
    : { success: false, message: result.error?.message ?? "The caption change failed." };
}

export type CaptionImportOutcome = CommandOutcome & {
  added?: number;
  errors?: string[];
  /** SCC / STL decoding notes (parity errors, unterminated captions, ...). */
  issues?: CaptionFormatIssue[];
  /** The detected file format. */
  format?: string;
};

/** Import SRT, WebVTT, SCC or word-timed transcript JSON as one undo step. */
export async function importCaptionText(
  content: string,
  options: CaptionImportOptions = {},
): Promise<CaptionImportOutcome> {
  const isJson = looksLikeTranscriptJson(content);
  const parsed: { subtitles: Subtitle[]; errors: string[]; issues?: CaptionFormatIssue[] } = isJson
    ? parseTranscriptJson(content, { ...options, idPrefix: `tr-${uuidv4().slice(0, 8)}` })
    : (() => {
        const r = parseCaptions(content, options);
        return {
          subtitles: r.subtitles,
          errors: r.errors.map((e) => `Line ${e.line}: ${e.message}`),
          issues: r.issues,
        };
      })();
  if (!parsed.subtitles.length)
    return {
      success: false,
      message: parsed.errors[0] ?? "No captions were found in that file.",
      errors: parsed.errors,
    };
  const outcome = await setSubtitles([...getSubtitles(), ...parsed.subtitles]);
  return {
    ...outcome,
    added: parsed.subtitles.length,
    errors: parsed.errors,
    ...(parsed.issues?.length ? { issues: parsed.issues } : {}),
  };
}

/**
 * Import caption file bytes: the format is detected from the content (EBU-STL is binary, MCC and timed
 * transcripts load their parsers on demand, JSON is a word-timed transcript). One undo step.
 */
export async function importCaptionBytes(
  bytes: Uint8Array,
  options: CaptionImportOptions & { fileName?: string } = {},
): Promise<CaptionImportOutcome> {
  if (looksLikeTranscriptJson(new TextDecoder().decode(bytes.subarray(0, 64)))) return importCaptionText(decodeCaptionText(bytes), options);
  const r = await importCaptionFile(bytes, { projectFrameRate: useProjectStore.getState().project.settings.frameRate, ...options });
  const errors = r.errors.map((e) => e.message);
  if (!r.subtitles.length)
    return { success: false, message: errors[0] ?? "No captions were found in that file.", errors, issues: r.issues, format: r.format };
  const outcome = await setSubtitles([...getSubtitles(), ...r.subtitles]);
  return { ...outcome, added: r.subtitles.length, errors, issues: r.issues, format: r.format };
}

const getProfiles = (): readonly SpeakerProfile[] => useProjectStore.getState().project.speakers ?? [];

/** Profiles of speakers that still have cues (unused ones are dropped). */
const used = (subtitles: readonly Subtitle[], profiles: SpeakerProfile[]) =>
  profiles.filter((p) => subtitles.some((cue) => cue.speaker === p.name));

/** Commit cues and speaker profiles together as one undo step. */
async function applySpeakers(subtitles: Subtitle[], profiles: SpeakerProfile[]): Promise<CommandOutcome> {
  const result = await useProjectStore.getState().executeAction({
    type: "speaker/apply",
    id: uuidv4(),
    timestamp: Date.now(),
    params: { subtitles: applySpeakerStyles(subtitles, used(subtitles, profiles)), profiles: used(subtitles, profiles) },
  });
  return result.success
    ? { success: true }
    : { success: false, message: result.error?.message ?? "The speaker change failed." };
}

/** Rename a speaker on every cue and its profile (one undo step). Renaming onto another speaker merges them. */
export async function renameTranscriptSpeaker(from: string, to: string): Promise<CommandOutcome> {
  const current = getSubtitles();
  const next = renameSpeaker(current, from, to);
  if (next === current) return { success: false, message: `No captions are labelled "${from}".` };
  const profiles = ensureSpeakerProfiles(next, renameSpeakerProfile(ensureSpeakerProfiles(current, getProfiles()), from, to));
  return applySpeakers(next, profiles);
}

/** Reassign cues to a speaker (an empty name clears it); a new name gets the next palette colour. */
export async function setCaptionSpeaker(
  subtitleIds: readonly string[],
  speaker: string,
): Promise<CommandOutcome> {
  const next = mirrorSpeakersToTranslations(
    assignSpeaker(getSubtitles(), subtitleIds, speaker),
    new Set(subtitleIds),
  );
  return applySpeakers(next, ensureSpeakerProfiles(next, getProfiles()));
}

/** Change a speaker's colour / caption position; their cues are restyled in the same undo step. */
export async function updateSpeakerProfile(
  name: string,
  patch: Partial<Pick<SpeakerProfile, "color" | "position">>,
): Promise<CommandOutcome> {
  const current = getSubtitles();
  const profiles = ensureSpeakerProfiles(current, getProfiles()).map((p) => {
    if (p.name !== name) return p;
    const { position, ...rest } = { ...p, ...patch };
    return position ? { ...rest, position } : rest;
  });
  return applySpeakers(current, profiles);
}

/** Cut time ranges out of the sequence (linked tracks together), one undo step. */
export function cutTranscriptRanges(
  ranges: readonly TimeRange[],
  label = "Delete transcript text",
): TranscriptOutcome {
  const playhead = useTimelineStore.getState().playheadPosition;
  const outcome = commit(
    (project) => planTranscriptCut(project, ranges, uuidv4(), label),
    "Nothing in that range to cut.",
  );
  if (!outcome.success) return outcome;
  // Keep the playhead on the same content: pull it back by what was cut before it.
  const before = cutDuration(ranges.filter((r) => r.end <= playhead));
  const inside = ranges
    .filter((r) => r.start < playhead && r.end > playhead)
    .reduce((sum, r) => sum + (playhead - r.start), 0);
  useTimelineStore.getState().seekTo(Math.max(0, playhead - before - inside));
  return { success: true, removed: cutDuration(ranges), cuts: ranges.length };
}

export function previewFillers(phrases?: readonly string[], captionTrackId?: string): FillerMatch[] {
  return findFillerWords(getTranscript(captionTrackId).words, phrases);
}

export function previewPauses(
  minDuration: number,
  keep?: number,
  captionTrackId?: string,
): PauseMatch[] {
  return findPauses(getTranscript(captionTrackId).words, minDuration, { keep });
}

export const exportCaptionText = (
  format: CaptionExportFormat,
  options: CaptionExportOptions = {},
): string => exportCaptions(getSubtitles(), format, options);

/** Any caption format as file bytes plus the encoder's validation report (SCC / STL). */
export const exportCaptionBytes = (
  format: CaptionExportFormat,
  options: CaptionExportOptions = {},
): Promise<CaptionFile> => exportCaptionFileAsync(getSubtitles(), format, options);

export type CaptionTranslateOutcome = CommandOutcome & { trackId?: string; added?: number; cancelled?: boolean };

/**
 * Choose which caption track is drawn in the picture (Preview and burned-in export).
 * Showing a track hides every other track so two languages never overlap; hiding
 * a track just hides it. One undo step. Transcript, sidecar and embedded captions are unaffected.
 */
export async function setCaptionTrackInPicture(trackId: string, visible: boolean): Promise<CommandOutcome> {
  const next = getSubtitles().map((cue): Subtitle => {
    const mine = (cue.captionTrackId ?? "") === trackId;
    if (mine) return visible ? omitHidden(cue) : { ...cue, hidden: true };
    return visible ? { ...cue, hidden: true } : cue;
  });
  return setSubtitles(next);
}

function omitHidden(cue: Subtitle): Subtitle {
  const { hidden: _hidden, ...rest } = cue;
  void _hidden;
  return rest;
}

/**
 * Translate a caption track into a new track (one undo step: removing the track's cues).
 * Nothing is committed unless every batch succeeded.
 */
export async function translateCaptionTrackCommand(options: {
  sourceTrackId: string;
  targetLanguage: string;
  translator: CaptionTranslator;
  signal?: AbortSignal;
  onProgress?: (progress: CaptionTranslationProgress) => void;
}): Promise<CaptionTranslateOutcome> {
  const result = await translateCaptionTrack({
    subtitles: getSubtitles(),
    sourceTrackId: options.sourceTrackId,
    targetLanguage: options.targetLanguage,
    translator: options.translator,
    signal: options.signal,
    onProgress: options.onProgress,
    idFactory: () => `tr-${uuidv4()}`,
  });
  if (!result.ok) return { success: false, message: result.message, cancelled: result.reason === "cancelled" };
  const outcome = await setSubtitles([...getSubtitles(), ...result.cues]);
  return outcome.success ? { success: true, trackId: result.trackId, added: result.cues.length } : outcome;
}
