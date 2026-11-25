import type { Subtitle, SubtitleWord } from "../types/timeline";
import {
  buildTranscript,
  searchTranscript,
  wordRange,
  type Transcript,
  type TranscriptWord,
} from "./transcript";

/**
 * Per-asset transcripts (text-based editing on source clips).
 *
 * A record holds the word-timed cues of ONE media file, in seconds of that file (not of any sequence). It is cached
 * outside the project, keyed by a hash of the media's bytes, so the same file in another project (or relinked to an
 * identical copy) reuses it and a relink to different content never shows a stale transcript. Everything here is pure:
 * storage lives in the web app.
 */

export const SOURCE_TRANSCRIPT_VERSION = 1;

export interface SourceTranscriptRecord {
  readonly version: typeof SOURCE_TRANSCRIPT_VERSION;
  /** Content hash of the media the transcript was made from (the storage key). */
  readonly mediaHash: string;
  /** Duration of that media in seconds (0 when unknown). */
  readonly duration: number;
  readonly language?: string;
  /** What produced it: "whisper-fast", "import", ... */
  readonly engine: string;
  readonly createdAt: number;
  /** Cues in source-media seconds. */
  readonly cues: Subtitle[];
}

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function cleanWord(value: unknown): SubtitleWord | null {
  if (!value || typeof value !== "object") return null;
  const { text, startTime, endTime } = value as Record<string, unknown>;
  if (typeof text !== "string" || !finiteNonNegative(startTime) || !finiteNonNegative(endTime)) return null;
  return { text, startTime, endTime };
}

function cleanCue(value: unknown, index: number): Subtitle | null {
  if (!value || typeof value !== "object") return null;
  const cue = value as Record<string, unknown>;
  if (typeof cue.text !== "string" || !finiteNonNegative(cue.startTime) || !finiteNonNegative(cue.endTime)) return null;
  if (cue.endTime <= cue.startTime) return null;
  const words = Array.isArray(cue.words)
    ? cue.words.map(cleanWord).filter((w): w is SubtitleWord => w !== null)
    : [];
  return {
    id: typeof cue.id === "string" && cue.id ? cue.id : `st-${index}`,
    text: cue.text,
    startTime: cue.startTime,
    endTime: cue.endTime,
    ...(words.length ? { words } : {}),
    ...(typeof cue.speaker === "string" && cue.speaker ? { speaker: cue.speaker } : {}),
  };
}

/** Validate whatever came out of storage; anything malformed or from another version is dropped (null). */
export function parseSourceTranscriptRecord(value: unknown): SourceTranscriptRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== SOURCE_TRANSCRIPT_VERSION) return null;
  if (typeof raw.mediaHash !== "string" || !raw.mediaHash) return null;
  if (!Array.isArray(raw.cues)) return null;
  const cues = raw.cues.map(cleanCue).filter((cue): cue is Subtitle => cue !== null);
  if (!cues.length) return null;
  return {
    version: SOURCE_TRANSCRIPT_VERSION,
    mediaHash: raw.mediaHash,
    duration: finiteNonNegative(raw.duration) ? raw.duration : 0,
    ...(typeof raw.language === "string" && raw.language ? { language: raw.language } : {}),
    engine: typeof raw.engine === "string" ? raw.engine : "unknown",
    createdAt: finiteNonNegative(raw.createdAt) ? raw.createdAt : 0,
    cues,
  };
}

export function createSourceTranscriptRecord(input: {
  mediaHash: string;
  duration: number;
  cues: readonly Subtitle[];
  engine: string;
  language?: string;
  now?: number;
}): SourceTranscriptRecord {
  return {
    version: SOURCE_TRANSCRIPT_VERSION,
    mediaHash: input.mediaHash,
    duration: Math.max(0, input.duration),
    ...(input.language ? { language: input.language } : {}),
    engine: input.engine,
    createdAt: input.now ?? Date.now(),
    cues: [...input.cues],
  };
}

export type CachedTranscriptStatus = "ready" | "missing" | "invalid" | "relinked";

/**
 * Decide whether a stored value may be used for the media currently linked: a hash that differs (the item was relinked
 * to other content) or a clearly different duration invalidates it. `currentHash` null means the media is offline, so
 * nothing can be confirmed and the stored transcript is not trusted.
 */
export function resolveCachedTranscript(
  stored: unknown,
  currentHash: string | null,
  currentDuration?: number,
): { status: CachedTranscriptStatus; record: SourceTranscriptRecord | null } {
  if (stored === undefined || stored === null) return { status: "missing", record: null };
  const record = parseSourceTranscriptRecord(stored);
  if (!record) return { status: "invalid", record: null };
  if (currentHash === null || record.mediaHash !== currentHash) return { status: "relinked", record: null };
  if (
    currentDuration !== undefined &&
    currentDuration > 0 &&
    record.duration > 0 &&
    Math.abs(record.duration - currentDuration) > Math.max(0.5, currentDuration * 0.01)
  )
    return { status: "relinked", record: null };
  return { status: "ready", record };
}

/** The word list of a record. */
export const sourceTranscriptOf = (record: Pick<SourceTranscriptRecord, "cues">): Transcript =>
  buildTranscript(record.cues);

export interface SourceMarkRange {
  in: number;
  out: number;
}

/**
 * The Source In/Out marks for a contiguous word selection (inclusive indices, either order). Optional `pad` seconds are
 * kept on each side so the cut does not clip a breath; the result is clamped to the media.
 */
export function selectionToSourceMarks(
  transcript: Transcript,
  first: number,
  last: number,
  options: { duration?: number; pad?: number } = {},
): SourceMarkRange {
  const range = wordRange(transcript, first, last);
  const pad = Math.max(0, options.pad ?? 0);
  const limit = options.duration && options.duration > 0 ? options.duration : Infinity;
  const start = Math.min(Math.max(0, range.start - pad), limit);
  const end = Math.min(range.end + pad, limit);
  if (!(end - start > 1e-6)) throw new Error("That selection has no length in the source.");
  return { in: start, out: end };
}

/* ------------------------------ project-wide search ------------------------------ */

export interface SourceTranscriptEntry {
  mediaId: string;
  mediaName: string;
  transcript: Transcript;
}

export interface SourceSearchOptions {
  /** Restrict to a speaker (case-insensitive substring). `speaker:Name` in the query does the same. */
  speaker?: string;
  /** Also accept words within a small edit distance ("transcrpt" finds "transcript"). */
  fuzzy?: boolean;
  matchCase?: boolean;
  /** Context words kept before and after a hit (default 4). */
  contextWords?: number;
  limit?: number;
}

export interface SourceSearchHit {
  mediaId: string;
  mediaName: string;
  wordStart: number;
  /** Inclusive. */
  wordEnd: number;
  /** Source time to jump to (start of the first matched word). */
  time: number;
  start: number;
  end: number;
  speaker?: string;
  before: string;
  match: string;
  after: string;
  /** 0 for an exact hit, the total edit distance for a fuzzy one. */
  score: number;
}

const SPEAKER_QUERY = /(?:^|\s)speaker:(?:"([^"]+)"|(\S+))/i;

/** Split `speaker:Ann "welcome to"` into the speaker filter and the phrase. */
export function parseSourceSearchQuery(query: string): { phrase: string; speaker?: string } {
  const match = SPEAKER_QUERY.exec(query);
  if (!match) return { phrase: query.trim() };
  const speaker = (match[1] ?? match[2] ?? "").trim();
  const phrase = (query.slice(0, match.index) + " " + query.slice(match.index + match[0].length))
    .replace(/["]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { phrase, ...(speaker ? { speaker } : {}) };
}

const normalize = (value: string, matchCase: boolean) => {
  const stripped = value.replace(/[^\p{L}\p{N}']+/gu, "");
  return matchCase ? stripped : stripped.toLowerCase();
};

/** Levenshtein distance, stopping early once it must exceed `max` (returns max + 1). */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = row[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    previous = row;
  }
  return previous[b.length];
}

/** Allowed edit distance by word length: short words must match exactly. */
const fuzzyBudget = (length: number): number => (length <= 3 ? 0 : length <= 7 ? 1 : 2);

function fuzzyMatches(
  words: readonly TranscriptWord[],
  needle: readonly string[],
  matchCase: boolean,
): Array<{ wordStart: number; wordEnd: number; score: number }> {
  const hay = words.map((word) => normalize(word.text, matchCase));
  const hits: Array<{ wordStart: number; wordEnd: number; score: number }> = [];
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let total = 0;
    let ok = true;
    for (let j = 0; j < needle.length && ok; j++) {
      const target = needle[j];
      const here = hay[i + j];
      const budget = fuzzyBudget(target.length);
      const distance = editDistance(here, target, budget);
      if (distance > budget) ok = false;
      else total += distance;
    }
    if (ok) {
      hits.push({ wordStart: i, wordEnd: i + needle.length - 1, score: total });
      i += needle.length - 1;
    }
  }
  return hits;
}

const join = (words: readonly TranscriptWord[], from: number, to: number) =>
  words
    .slice(Math.max(0, from), Math.min(words.length, to))
    .map((w) => w.text)
    .join(" ");

/**
 * Find a word, phrase and/or speaker across every transcribed asset. Exact hits (punctuation and case ignored, a lone
 * token also matches inside a word) come before fuzzy ones; ties keep the order of `entries`, then source time.
 * A query with only `speaker:` lists that speaker's sentences.
 */
export function searchSourceTranscripts(
  entries: readonly SourceTranscriptEntry[],
  query: string,
  options: SourceSearchOptions = {},
): SourceSearchHit[] {
  const parsed = parseSourceSearchQuery(query);
  const speaker = (options.speaker ?? parsed.speaker)?.trim().toLowerCase();
  const matchCase = options.matchCase ?? false;
  const context = Math.max(0, options.contextWords ?? 4);
  const limit = options.limit ?? 200;
  const needle = parsed.phrase
    .split(/\s+/)
    .map((token) => normalize(token, matchCase))
    .filter(Boolean);
  if (!needle.length && !speaker) return [];

  const hits: Array<SourceSearchHit & { order: number }> = [];
  entries.forEach((entry, order) => {
    const { words, sentences } = entry.transcript;
    const speakerOk = (index: number) => !speaker || (words[index].speaker ?? "").toLowerCase().includes(speaker);
    const push = (wordStart: number, wordEnd: number, score: number) => {
      if (!words.length) return;
      const first = words[wordStart];
      const lastWord = words[wordEnd];
      hits.push({
        order,
        mediaId: entry.mediaId,
        mediaName: entry.mediaName,
        wordStart,
        wordEnd,
        time: first.start,
        start: first.start,
        end: lastWord.end,
        ...(first.speaker ? { speaker: first.speaker } : {}),
        before: join(words, wordStart - context, wordStart),
        match: join(words, wordStart, wordEnd + 1),
        after: join(words, wordEnd + 1, wordEnd + 1 + context),
        score,
      });
    };

    if (!needle.length) {
      for (const sentence of sentences) {
        if (speakerOk(sentence.wordStart)) push(sentence.wordStart, sentence.wordEnd - 1, 0);
      }
      return;
    }
    const exact = searchTranscript(words, parsed.phrase, { matchCase });
    const seen = new Set<number>();
    for (const m of exact) {
      if (!speakerOk(m.wordStart)) continue;
      seen.add(m.wordStart);
      push(m.wordStart, m.wordEnd, 0);
    }
    if (options.fuzzy) {
      for (const m of fuzzyMatches(words, needle, matchCase)) {
        if (m.score === 0 || seen.has(m.wordStart) || !speakerOk(m.wordStart)) continue;
        push(m.wordStart, m.wordEnd, m.score);
      }
    }
  });

  hits.sort((a, b) => a.score - b.score || a.order - b.order || a.start - b.start);
  return hits.slice(0, limit).map(({ order: _order, ...hit }) => hit);
}
