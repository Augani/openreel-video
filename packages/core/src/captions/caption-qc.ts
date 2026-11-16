import type { Subtitle } from "../types/timeline";

/**
 * Caption quality control: reading speed (characters and words per second /
 * minute), row length, row count, minimum and maximum duration, gaps shorter
 * than a couple of frames, and overlaps. Pure; the editor turns issues into
 * click-to-jump rows and agents read the same report.
 */

export interface CaptionQcOptions {
  /** Only cues of this caption track (undefined = all, "" = default). */
  captionTrackId?: string;
  /** Frame rate used for the minimum gap. Default 25. */
  frameRate?: number;
  /** Maximum characters per second (incl. spaces). Default 17 (adult content). */
  maxCps?: number;
  /** Maximum words per minute. Default 180. */
  maxWpm?: number;
  /** Maximum rows per cue. Default 2. */
  maxLines?: number;
  /** Maximum characters per row. Default 42. */
  maxCharsPerLine?: number;
  /** Minimum cue duration in seconds. Default 5/6 s (20 frames at 24). */
  minDuration?: number;
  /** Maximum cue duration in seconds. Default 7. */
  maxDuration?: number;
  /** Cues closer than this many frames (but not overlapping) are flagged. Default 2. */
  minGapFrames?: number;
}

export type CaptionQcCode =
  | "empty"
  | "cps"
  | "wpm"
  | "max-lines"
  | "max-chars"
  | "min-duration"
  | "max-duration"
  | "gap"
  | "overlap";

export interface CaptionQcIssue {
  code: CaptionQcCode;
  severity: "error" | "warning";
  cueId: string;
  /** 1-based position in time order. */
  cueIndex: number;
  /** Where to jump: the cue start, seconds. */
  time: number;
  message: string;
  value?: number;
  limit?: number;
}

export interface CaptionQcReport {
  issues: CaptionQcIssue[];
  cueCount: number;
  counts: Partial<Record<CaptionQcCode, number>>;
  errorCount: number;
  warningCount: number;
  averageCps: number;
  worstCps: number;
  options: Required<Omit<CaptionQcOptions, "captionTrackId">>;
}

export const DEFAULT_CAPTION_QC: Required<Omit<CaptionQcOptions, "captionTrackId">> = {
  frameRate: 25,
  maxCps: 17,
  maxWpm: 180,
  maxLines: 2,
  maxCharsPerLine: 42,
  minDuration: 5 / 6,
  maxDuration: 7,
  minGapFrames: 2,
};

const round = (n: number, places = 2) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** Visible text of a cue: tags removed, rows trimmed, blank rows dropped. */
export function visibleRows(text: string): string[] {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
}

export function checkCaptions(
  subtitles: readonly Subtitle[],
  options: CaptionQcOptions = {},
): CaptionQcReport {
  const o = { ...DEFAULT_CAPTION_QC };
  for (const key of Object.keys(DEFAULT_CAPTION_QC) as Array<keyof typeof DEFAULT_CAPTION_QC>) {
    const value = options[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) o[key] = value;
  }
  const cues = subtitles
    .filter((c) => options.captionTrackId === undefined || (c.captionTrackId ?? "") === options.captionTrackId)
    .slice()
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);

  const issues: CaptionQcIssue[] = [];
  let cpsSum = 0;
  let cpsCount = 0;
  let worstCps = 0;
  const frame = 1 / o.frameRate;
  // Latest end among earlier cues: a long cue can overlap more than its immediate successor.
  let latestEnd = -Infinity;
  let latestEndIndex = 0;

  cues.forEach((cue, index) => {
    const n = index + 1;
    const base = { cueId: cue.id, cueIndex: n, time: cue.startTime };
    const rows = visibleRows(cue.text);
    const duration = cue.endTime - cue.startTime;
    if (!rows.length) {
      issues.push({ ...base, code: "empty", severity: "error", message: `Cue ${n} has no text.` });
      return;
    }
    const chars = rows.reduce((sum, row) => sum + [...row].length, 0);
    const words = rows.join(" ").split(/\s+/).filter(Boolean).length;
    if (duration > 0) {
      const cps = chars / duration;
      const wpm = (words / duration) * 60;
      cpsSum += cps;
      cpsCount++;
      worstCps = Math.max(worstCps, cps);
      if (cps > o.maxCps)
        issues.push({
          ...base,
          code: "cps",
          severity: cps > o.maxCps * 1.3 ? "error" : "warning",
          message: `Cue ${n} reads at ${round(cps, 1)} characters/second (limit ${o.maxCps}).`,
          value: round(cps, 1),
          limit: o.maxCps,
        });
      if (wpm > o.maxWpm)
        issues.push({
          ...base,
          code: "wpm",
          severity: wpm > o.maxWpm * 1.3 ? "error" : "warning",
          message: `Cue ${n} reads at ${Math.round(wpm)} words/minute (limit ${o.maxWpm}).`,
          value: Math.round(wpm),
          limit: o.maxWpm,
        });
    }
    if (rows.length > o.maxLines)
      issues.push({
        ...base,
        code: "max-lines",
        severity: "error",
        message: `Cue ${n} has ${rows.length} rows (limit ${o.maxLines}).`,
        value: rows.length,
        limit: o.maxLines,
      });
    const longest = Math.max(...rows.map((row) => [...row].length));
    if (longest > o.maxCharsPerLine)
      issues.push({
        ...base,
        code: "max-chars",
        severity: "error",
        message: `Cue ${n} has a row of ${longest} characters (limit ${o.maxCharsPerLine}).`,
        value: longest,
        limit: o.maxCharsPerLine,
      });
    if (duration < o.minDuration - 1e-9)
      issues.push({
        ...base,
        code: "min-duration",
        severity: "warning",
        message: `Cue ${n} is on screen for ${round(duration)}s (minimum ${round(o.minDuration)}s).`,
        value: round(duration),
        limit: round(o.minDuration),
      });
    if (duration > o.maxDuration + 1e-9)
      issues.push({
        ...base,
        code: "max-duration",
        severity: "warning",
        message: `Cue ${n} is on screen for ${round(duration)}s (maximum ${round(o.maxDuration)}s).`,
        value: round(duration),
        limit: round(o.maxDuration),
      });
    const hasPrevious = index > 0;
    const previousIndex = latestEndIndex;
    const previousEnd = latestEnd;
    if (cue.endTime > latestEnd) {
      latestEnd = cue.endTime;
      latestEndIndex = n;
    }
    if (hasPrevious) {
      const gap = cue.startTime - previousEnd;
      if (gap < -1e-9)
        issues.push({
          ...base,
          code: "overlap",
          severity: "error",
          message: `Cue ${n} starts ${round(-gap)}s before cue ${previousIndex} ends.`,
          value: round(-gap),
        });
      else if (gap < o.minGapFrames * frame - 1e-9)
        issues.push({
          ...base,
          code: "gap",
          severity: "warning",
          message: `Only ${Math.round(gap / frame)} frame(s) between cue ${previousIndex} and cue ${n} (minimum ${o.minGapFrames}).`,
          value: Math.round(gap / frame),
          limit: o.minGapFrames,
        });
    }
  });

  issues.sort((a, b) => a.time - b.time || a.cueIndex - b.cueIndex);
  const counts: CaptionQcReport["counts"] = {};
  for (const issue of issues) counts[issue.code] = (counts[issue.code] ?? 0) + 1;
  return {
    issues,
    cueCount: cues.length,
    counts,
    errorCount: issues.filter((i) => i.severity === "error").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
    averageCps: cpsCount ? round(cpsSum / cpsCount, 1) : 0,
    worstCps: round(worstCps, 1),
    options: o,
  };
}
