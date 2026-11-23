import type { Subtitle } from "../types/timeline";
import type { CaptionFormatIssue } from "./scc";

/**
 * Timed plain-text transcripts (a `.txt` from a meeting recorder or an editor's notes): a time stamp, then the
 * words. Recognised layouts, per line:
 *
 *   [00:01:02.500] Hello there            (brackets or parentheses, optional fraction)
 *   00:01:02 Speaker: Hello there          (hh:mm:ss or mm:ss, optional " - " / ":" after it)
 *   Speaker Name  00:01:02                 (a header line ending in the time, text on the lines below)
 *
 * A transcript only gives start times. Each cue ends when the next one starts, or after a reading-speed
 * estimate when the next one is far away; that is reported as an `info` note so it is never a surprise.
 */

const TIME = String.raw`(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)(?:[.,](\d{1,3}))?`;
const LEADING = new RegExp(String.raw`^\s*[\[(]?${TIME}[\])]?\s*(?:[-–—:]\s+|\s+|$)(.*)$`);
const TRAILING = new RegExp(String.raw`^(.{1,60}?)\s+[\[(]?${TIME}[\])]?\s*$`);

const seconds = (h: string | undefined, m: string, s: string, ms?: string) =>
  (h ? Number(h) * 3600 : 0) + Number(m) * 60 + Number(s) + (ms ? Number(ms.padEnd(3, "0")) / 1000 : 0);

export function isTimedTranscript(content: string): boolean {
  const lines = content.replace(/^﻿/, "").split(/\r\n?|\n/).filter((l) => l.trim());
  if (!lines.length) return false;
  const hits = lines.slice(0, 20).filter((l) => LEADING.test(l) || TRAILING.test(l)).length;
  return hits >= 1 && hits >= Math.min(2, lines.length) && !/-->/.test(content.slice(0, 2000));
}

export interface TimedTranscriptOptions {
  language?: string;
  captionTrackId?: string;
  offsetSeconds?: number;
  /** Seconds a cue may last at most when the next time stamp is far away (default 7). */
  maxSeconds?: number;
}

export interface TimedTranscriptResult {
  subtitles: Subtitle[];
  errors: Array<{ line: number; message: string }>;
  issues: CaptionFormatIssue[];
  format: "txt";
}

let counter = 0;

export function parseTimedTranscript(content: string, options: TimedTranscriptOptions = {}): TimedTranscriptResult {
  const errors: TimedTranscriptResult["errors"] = [];
  const issues: CaptionFormatIssue[] = [];
  const lines = content.replace(/^﻿/, "").split(/\r\n?|\n/);
  interface Entry { start: number; text: string[]; speaker?: string; line: number }
  const entries: Entry[] = [];
  let open: Entry | undefined;
  const lead = (l: string) => LEADING.exec(l);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) {
      open = undefined;
      continue;
    }
    const l = lead(raw);
    const t = l ? undefined : TRAILING.exec(raw);
    if (l) {
      open = { start: seconds(l[1], l[2], l[3], l[4]), text: [], line: i + 1 };
      if (l[5].trim()) open.text.push(l[5].trim());
      entries.push(open);
    } else if (t) {
      open = { start: seconds(t[2], t[3], t[4], t[5]), text: [], speaker: t[1].trim().replace(/[:\-–—]\s*$/, "").trim(), line: i + 1 };
      entries.push(open);
    } else if (open) open.text.push(raw.trim());
    else errors.push({ line: i + 1, message: "Line before the first time stamp was skipped." });
  }
  if (!entries.length) {
    errors.push({ line: 1, message: "No time stamps were found. A plain transcript needs times such as [00:01:02] to be placed on the timeline; use SRT or WebVTT for untimed text." });
    return { subtitles: [], errors, issues, format: "txt" };
  }
  const offset = options.offsetSeconds ?? 0;
  const max = options.maxSeconds ?? 7;
  const subtitles: Subtitle[] = [];
  let estimated = 0;
  entries.forEach((e, i) => {
    let text = e.text.join("\n").trim();
    let speaker = e.speaker;
    if (!speaker) {
      const sp = /^([\p{L}][\p{L}\p{N} .'_-]{0,30}):\s+(.+)$/su.exec(text);
      if (sp && !/^\d/.test(sp[1])) {
        speaker = sp[1].trim();
        text = sp[2].trim();
      }
    }
    if (!text) {
      errors.push({ line: e.line, message: "Time stamp has no text." });
      return;
    }
    const start = e.start - offset;
    const next = entries[i + 1] ? entries[i + 1].start - offset : undefined;
    const guess = Math.min(max, Math.max(1.5, text.replace(/\s+/g, " ").length / 17));
    let end: number;
    if (next !== undefined && next > start && next - start <= max) end = next;
    else {
      end = start + guess;
      estimated++;
    }
    if (!(end > start) || start < 0) {
      errors.push({ line: e.line, message: "Time stamp is not later than the offset or the next one." });
      return;
    }
    subtitles.push({
      id: `txt-${Date.now().toString(36)}-${(counter++).toString(36)}`,
      text,
      startTime: start,
      endTime: end,
      ...(speaker ? { speaker } : {}),
      ...(options.language ? { language: options.language } : {}),
      ...(options.captionTrackId ? { captionTrackId: options.captionTrackId } : {}),
    });
  });
  if (subtitles.length)
    issues.push({
      severity: "info",
      code: "txt-end-times",
      message: `A transcript has only start times: each caption ends when the next one starts${estimated ? `; ${estimated} had no close next time stamp and ${estimated === 1 ? "was" : "were"} given a length estimated from the reading speed (at most ${max} s)` : ""}.`,
    });
  return { subtitles, errors, issues, format: "txt" };
}
