import { v4 as uuidv4 } from "uuid";
import {
  assignSpeaker,
  buildTranscript,
  cutDuration,
  exportCaptionFile,
  exportCaptions,
  findFillerWords,
  findPauses,
  isStlContent,
  parseCaptionBytes,
  parseCaptions,
  parseTranscriptJson,
  planTranscriptCut,
  renameSpeaker,
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
};

/** Import SRT, WebVTT, SCC or word-timed transcript JSON as one undo step. */
export async function importCaptionText(
  content: string,
  options: CaptionImportOptions = {},
): Promise<CaptionImportOutcome> {
  const trimmed = content.trimStart();
  const isJson = trimmed.startsWith("{") || trimmed.startsWith("[");
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

/** Import caption file bytes: EBU-STL is binary; everything else is decoded as text. */
export async function importCaptionBytes(
  bytes: Uint8Array,
  options: CaptionImportOptions = {},
): Promise<CaptionImportOutcome> {
  if (!isStlContent(bytes)) return importCaptionText(new TextDecoder("utf-8").decode(bytes), options);
  const r = parseCaptionBytes(bytes, options);
  const errors = r.errors.map((e) => e.message);
  if (!r.subtitles.length)
    return { success: false, message: errors[0] ?? "No captions were found in that file.", errors, issues: r.issues };
  const outcome = await setSubtitles([...getSubtitles(), ...r.subtitles]);
  return { ...outcome, added: r.subtitles.length, errors, issues: r.issues };
}

/** Rename a speaker on every cue (one undo step). */
export async function renameTranscriptSpeaker(from: string, to: string): Promise<CommandOutcome> {
  const current = getSubtitles();
  const next = renameSpeaker(current, from, to);
  if (next === current) return { success: false, message: `No captions are labelled "${from}".` };
  return setSubtitles(next);
}

export async function setCaptionSpeaker(
  subtitleIds: readonly string[],
  speaker: string,
): Promise<CommandOutcome> {
  return setSubtitles(assignSpeaker(getSubtitles(), subtitleIds, speaker));
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
): CaptionFile => exportCaptionFile(getSubtitles(), format, options);
