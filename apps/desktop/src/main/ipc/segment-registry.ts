import type { WebContents } from "electron";
import type { SegmentSession } from "../sidecar/segment-session";

/**
 * What the single-export code (ipc/export.ts) needs to know about a parallel export: which session a segment
 * belongs to, and where to report its frames, completion and failure. Kept apart from segment-export.ts so the
 * two modules do not import each other.
 */
export interface SegmentRun {
  readonly id: string;
  readonly editor: WebContents;
  readonly session: SegmentSession;
  /** Export jobs (one per segment) started for this session. */
  readonly jobIds: Set<string>;
  /** Frames the segment's encoder has written so far. */
  progress(index: number, frame: number): void;
  /** The segment's encode ended; throws when it did not hold exactly its frames. */
  finished(index: number, frames: number): void;
  fail(message: string): void;
}

export const segmentRuns = new Map<string, SegmentRun>();
