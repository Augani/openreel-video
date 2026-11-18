import type { Project } from "../types";
import type { Subtitle } from "../types/timeline";
import { diffPlan, planExtract } from "../editing/premiere-edits";
import { findLinkedPartners } from "../editing/split-edit";
import { isSyncLocked } from "../editing/sync-lock";
import {
  applyTimelineToolEdits,
  type TimelineToolPlan,
} from "../editing/timeline-tool-edit";
import { mergeTimeRanges, type TimeRange } from "./transcript";

/**
 * Transcript-based editing. Cutting text out of the transcript removes the
 * words' time range from the sequence exactly like Premiere's Extract: every
 * unlocked, sync-locked track is cut and closed up together (so linked picture
 * and sound stay in sync), markers and captions ripple, and the result is ONE
 * TimelineToolPlan, i.e. one undo step however many ranges are cut.
 *
 * A linked partner that Extract would leave behind (its track is locked or has
 * Sync Lock off) would drift out of sync, so that case is refused with a
 * message naming the track.
 */

const EPS = 1e-6;

function assertLinkedPartnersCut(project: Project, ranges: readonly TimeRange[]): void {
  const tracks = project.timeline.tracks;
  const cut = new Set(
    tracks.filter((track) => !track.locked && isSyncLocked(track)).map((track) => track.id),
  );
  for (const track of tracks) {
    if (!cut.has(track.id)) continue;
    for (const clip of track.clips) {
      const touched = ranges.some(
        (r) => clip.startTime < r.end - EPS && clip.startTime + clip.duration > r.start + EPS,
      );
      if (!touched) continue;
      for (const partner of findLinkedPartners({ ...clip, trackId: track.id }, tracks)) {
        const overlaps = ranges.some(
          (r) =>
            partner.clip.startTime < r.end - EPS &&
            partner.clip.startTime + partner.clip.duration > r.start + EPS,
        );
        if (overlaps && !cut.has(partner.track.id))
          throw new Error(
            `"${partner.track.name}" holds the linked sound or picture of a clip in this range but is ${
              partner.track.locked ? "locked" : "not sync-locked"
            }, so cutting would desync it. ${
              partner.track.locked ? "Unlock" : "Turn on Sync Lock for"
            } "${partner.track.name}" and try again.`,
          );
      }
    }
  }
}

/**
 * Cut `ranges` (seconds, any order, overlaps merged) out of the sequence as
 * one plan. Ranges are processed latest first so earlier ones keep their times.
 */
export function planTranscriptCut(
  project: Project,
  ranges: readonly TimeRange[],
  operationId: string,
  label = "Delete transcript text",
): TimelineToolPlan {
  const merged = mergeTimeRanges(ranges);
  if (!merged.length) throw new Error("There is nothing to cut.");
  assertLinkedPartnersCut(project, merged);
  let work = project;
  for (let i = merged.length - 1; i >= 0; i--) {
    const step = planExtract(work, merged[i], `${operationId}-${i}`);
    if (step.edits.length) work = applyTimelineToolEdits(work, step.edits);
  }
  return diffPlan(project, work, label);
}

/** Total seconds removed by a set of cuts. */
export const cutDuration = (ranges: readonly TimeRange[]): number =>
  mergeTimeRanges(ranges).reduce((sum, r) => sum + (r.end - r.start), 0);

/** Pluggable transcription: anything that turns media into word-timed cues. */
export interface TranscriptionRequest {
  /** Media item or clip the provider should transcribe. */
  sourceId: string;
  language?: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number, message?: string) => void;
}

export interface TranscriptionProvider {
  readonly id: string;
  readonly label: string;
  /** Runs fully on this device. Providers that call a service must say false. */
  readonly local: boolean;
  available(): Promise<boolean> | boolean;
  /** Word-timed cues on the source's own timeline (seconds from its start). */
  transcribe(request: TranscriptionRequest): Promise<Subtitle[]>;
}

const providers = new Map<string, TranscriptionProvider>();

export function registerTranscriptionProvider(provider: TranscriptionProvider): () => void {
  providers.set(provider.id, provider);
  return () => {
    if (providers.get(provider.id) === provider) providers.delete(provider.id);
  };
}

export const getTranscriptionProviders = (): TranscriptionProvider[] => [...providers.values()];
