import type { Marker, ReviewReply, ReviewStatus } from "../types/timeline";
import { framesToTimecode, secondsToFrames, timecodeToFrames, framesToSeconds } from "../interchange/timecode";
import { markerFrameRate } from "../interchange/marker-export";

/**
 * Review comments are timeline markers that carry an author and a status.
 * They reuse the marker model (ruler drawing, navigation, ripple, undo) and
 * add a Frame.io-style thread. Everything here is pure.
 */

const EPS = 1e-6;

/** A marker is a review comment when somebody wrote it (author) or triaged it (status). */
export function isReviewComment(marker: Marker): boolean {
  return marker.author !== undefined || marker.status !== undefined;
}

export const statusOf = (marker: Marker): ReviewStatus => marker.status ?? "open";

export function reviewComments(markers: readonly Marker[]): Marker[] {
  return markers.filter(isReviewComment).sort((a, b) => a.time - b.time);
}

export interface ReviewSummary {
  readonly total: number;
  readonly open: number;
  readonly resolved: number;
  readonly replies: number;
}

export function reviewSummary(markers: readonly Marker[]): ReviewSummary {
  const comments = markers.filter(isReviewComment);
  const resolved = comments.filter((m) => statusOf(m) === "resolved").length;
  return {
    total: comments.length,
    open: comments.length - resolved,
    resolved,
    replies: comments.reduce((sum, m) => sum + (m.replies?.length ?? 0), 0),
  };
}

/** Next review comment strictly after `t`; `openOnly` skips resolved ones. */
export function nextReviewComment(markers: readonly Marker[], t: number, openOnly = false): Marker | null {
  let best: Marker | null = null;
  for (const m of reviewComments(markers)) {
    if (openOnly && statusOf(m) === "resolved") continue;
    if (m.time > t + EPS && (best === null || m.time < best.time)) best = m;
  }
  return best;
}

export function prevReviewComment(markers: readonly Marker[], t: number, openOnly = false): Marker | null {
  let best: Marker | null = null;
  for (const m of reviewComments(markers)) {
    if (openOnly && statusOf(m) === "resolved") continue;
    if (m.time < t - EPS && (best === null || m.time > best.time)) best = m;
  }
  return best;
}

/** The replies list of `marker` with one more reply appended (a new array, ready for marker/update). */
export function appendReply(
  marker: Marker,
  reply: Omit<ReviewReply, "id" | "createdAt"> & { id?: string; createdAt?: number },
  newId: () => string,
  now: number = Date.now(),
): ReviewReply[] {
  return [
    ...(marker.replies ?? []),
    { id: reply.id ?? newId(), author: reply.author, text: reply.text, createdAt: reply.createdAt ?? now },
  ];
}

// ---------------------------------------------------------------------------
// CSV

export const REVIEW_CSV_COLUMNS = ["Timecode", "Author", "Comment", "Status", "Created", "Replies"] as const;

const REPLY_SEPARATOR = " | ";

const csvField = (value: string, delimiter: string): string =>
  /["\r\n]/.test(value) || value.includes(delimiter) ? `"${value.replace(/"/g, '""')}"` : value;

const isoDate = (ms: number | undefined): string => (ms === undefined || !Number.isFinite(ms) ? "" : new Date(ms).toISOString());

export interface ReviewCsvOptions {
  readonly delimiter?: "," | "\t";
  readonly dropFrame?: boolean;
  /** Include plain markers too (they export with no author and status "open"). */
  readonly includeMarkers?: boolean;
}

/**
 * Frame.io-style comment export: Timecode, Author, Comment, Status, Created
 * and the reply thread flattened to `author: text` entries. The comment text
 * is the marker's comment, falling back to its name.
 */
export function reviewCommentsCsv(markers: readonly Marker[], fps: number, options: ReviewCsvOptions = {}): string {
  const rate = markerFrameRate(fps, options.dropFrame);
  const delimiter = options.delimiter ?? ",";
  const source = options.includeMarkers ? [...markers].sort((a, b) => a.time - b.time) : reviewComments(markers);
  const rows = source.map((m) => [
    framesToTimecode(Math.max(0, secondsToFrames(m.time, rate)), rate),
    m.author ?? "",
    m.comment?.trim() ? m.comment : m.label,
    statusOf(m),
    isoDate(m.createdAt),
    (m.replies ?? []).map((r) => `${r.author}: ${r.text}`).join(REPLY_SEPARATOR),
  ]);
  return [REVIEW_CSV_COLUMNS as readonly string[], ...rows]
    .map((row) => row.map((field) => csvField(field, delimiter)).join(delimiter))
    .join("\n");
}

/** Quote-aware delimited text to rows (handles escaped quotes and newlines inside quotes). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", "\t", ";"].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

const HEADER_ALIASES: Record<string, readonly string[]> = {
  timecode: ["timecode", "time code", "timecode in", "time", "in", "start", "position", "marker in"],
  author: ["author", "commenter", "name", "user", "created by", "owner", "reviewer"],
  comment: ["comment", "comments", "text", "body", "note", "notes", "description", "message", "marker name"],
  status: ["status", "state", "resolved", "completed"],
  created: ["created", "created at", "date", "timestamp"],
  replies: ["replies", "reply", "thread"],
};

type Column = keyof typeof HEADER_ALIASES;

function columnFor(header: string): Column | null {
  const key = header.trim().toLowerCase();
  for (const column of Object.keys(HEADER_ALIASES) as Column[]) {
    if (HEADER_ALIASES[column].includes(key)) return column;
  }
  return null;
}

/** Seconds for HH:MM:SS:FF (also `;`, `.ms`), MM:SS, H:MM:SS or plain seconds; null when unreadable. */
export function parseReviewTime(value: string, fps: number): number | null {
  const text = value.trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const rate = markerFrameRate(fps);
  if (/^\d+:\d{1,2}:\d{1,2}[:;.]\d+$/.test(text)) {
    try {
      const frames = timecodeToFrames(text.replace(/\.(\d+)$/, ":$1"), rate);
      return Math.max(0, framesToSeconds(frames, rate));
    } catch {
      // A frame field past the timebase is a millisecond fraction (HH:MM:SS.mmm); fall through.
      const m = /^(\d+):(\d{1,2}):(\d{1,2})\.(\d+)$/.exec(text);
      if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`);
      return null;
    }
  }
  const parts = /^(?:(\d+):)?(\d{1,3}):(\d{1,2})(?:\.(\d+))?$/.exec(text);
  if (parts) {
    const [, h, m, s, frac] = parts;
    return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + (frac ? Number(`0.${frac}`) : 0);
  }
  return null;
}

const RESOLVED_WORDS = new Set(["resolved", "done", "complete", "completed", "closed", "true", "yes", "1", "approved"]);

export function parseReviewStatus(value: string | undefined): ReviewStatus {
  return value && RESOLVED_WORDS.has(value.trim().toLowerCase()) ? "resolved" : "open";
}

export interface ImportedReviewComment {
  readonly time: number;
  readonly author: string;
  readonly text: string;
  readonly status: ReviewStatus;
  readonly createdAt?: number;
  readonly replies: readonly { author: string; text: string }[];
}

export interface ReviewImportResult {
  readonly comments: ImportedReviewComment[];
  readonly skipped: { readonly row: number; readonly reason: string }[];
}

function parseReplies(value: string | undefined): { author: string; text: string }[] {
  if (!value || !value.trim()) return [];
  return value
    .split(REPLY_SEPARATOR)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const colon = entry.indexOf(": ");
      return colon > 0 ? { author: entry.slice(0, colon).trim(), text: entry.slice(colon + 2).trim() } : { author: "", text: entry };
    });
}

/**
 * Read a Frame.io-style comment CSV (Timecode, Author, Comment, plus optional
 * Status / Created / Replies). Headers are matched by common names; without a
 * header row the first three columns are Timecode, Author, Comment. Comma, tab
 * and semicolon separated files are accepted. Unreadable rows are reported in
 * `skipped` (1-based row numbers, header included) rather than thrown.
 */
export function parseReviewCsv(text: string, fps: number): ReviewImportResult {
  const comments: ImportedReviewComment[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const rows = parseDelimited(text, detectDelimiter(text));
  if (rows.length === 0) return { comments, skipped };

  const headerColumns = rows[0].map(columnFor);
  const hasHeader = headerColumns.includes("timecode") || headerColumns.includes("comment");
  const index: Partial<Record<Column, number>> = {};
  if (hasHeader) {
    headerColumns.forEach((column, i) => {
      if (column && index[column] === undefined) index[column] = i;
    });
  } else {
    index.timecode = 0;
    index.author = 1;
    index.comment = 2;
    index.status = 3;
  }
  const at = (row: string[], column: Column): string | undefined => {
    const i = index[column];
    return i === undefined ? undefined : row[i]?.trim();
  };

  rows.forEach((row, rowIndex) => {
    if (hasHeader && rowIndex === 0) return;
    const number = rowIndex + 1;
    const timecode = at(row, "timecode");
    const time = timecode === undefined ? null : parseReviewTime(timecode, fps);
    if (time === null) {
      skipped.push({ row: number, reason: `Unreadable timecode "${timecode ?? ""}"` });
      return;
    }
    const body = at(row, "comment") ?? "";
    if (!body) {
      skipped.push({ row: number, reason: "Empty comment" });
      return;
    }
    const created = at(row, "created");
    const createdAt = created ? Date.parse(created) : NaN;
    comments.push({
      time,
      author: at(row, "author") || "Reviewer",
      text: body,
      status: parseReviewStatus(at(row, "status")),
      ...(Number.isFinite(createdAt) ? { createdAt } : {}),
      replies: parseReplies(at(row, "replies")),
    });
  });
  return { comments, skipped };
}

/** Short marker name for a comment body (first line, trimmed to 40 chars). */
export function commentTitle(text: string): string {
  const line = text.split(/\r?\n/, 1)[0].trim();
  return line.length > 40 ? `${line.slice(0, 39)}…` : line || "Comment";
}
