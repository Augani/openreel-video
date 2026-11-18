import type { Subtitle, SubtitleWord } from "../types/timeline";

/**
 * Transcript model: a flat, time-ordered list of words (with speakers) derived
 * from caption cues, plus sentences, search, filler-word and pause detection.
 * Everything here is pure; cutting the timeline lives in transcript-edit.ts.
 *
 * Cues without word timings get estimated ones (the cue's time split in
 * proportion to word length) and their words are flagged `estimated`.
 */

export interface TranscriptWord {
  /** Stable within one build: `${subtitleId}#${position}`. */
  id: string;
  subtitleId: string;
  /** Position in `Transcript.words`. */
  index: number;
  text: string;
  start: number;
  end: number;
  speaker?: string;
  estimated: boolean;
}

export interface TranscriptSentence {
  index: number;
  /** Word indices, `wordEnd` exclusive. */
  wordStart: number;
  wordEnd: number;
  start: number;
  end: number;
  speaker?: string;
}

export interface Transcript {
  words: TranscriptWord[];
  sentences: TranscriptSentence[];
}

export interface TimeRange {
  start: number;
  end: number;
}

const MIN_CUT = 0.001;
const TERMINAL = /[.!?…]["')\]”’]*$/;
const LONG_PAUSE_BREAK = 1.0;

function wordsOf(cue: Subtitle): Array<SubtitleWord & { estimated: boolean }> {
  const timed = (cue.words ?? []).filter((w) => w.text.trim() !== "");
  if (timed.length) {
    return timed.map((w) => ({
      text: w.text.trim(),
      startTime: w.startTime,
      endTime: w.endTime,
      estimated: false,
    }));
  }
  const tokens = cue.text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const weights = tokens.map((token) => token.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = cue.endTime - cue.startTime;
  let at = cue.startTime;
  return tokens.map((text, i) => {
    const length = (weights[i] / total) * span;
    const word = { text, startTime: at, endTime: i === tokens.length - 1 ? cue.endTime : at + length, estimated: true };
    at += length;
    return word;
  });
}

/** Build the transcript for one caption track (`undefined` = every cue). */
export function buildTranscript(
  subtitles: readonly Subtitle[],
  options: { captionTrackId?: string } = {},
): Transcript {
  const cues = subtitles
    .filter(
      (cue) =>
        options.captionTrackId === undefined ||
        (cue.captionTrackId ?? "") === options.captionTrackId,
    )
    .filter((cue) => cue.endTime > cue.startTime)
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);

  const words: TranscriptWord[] = [];
  const cueEndsOf: number[] = []; // index of the last word of each cue
  for (const cue of cues) {
    wordsOf(cue).forEach((word, position) => {
      words.push({
        id: `${cue.id}#${position}`,
        subtitleId: cue.id,
        index: words.length,
        text: word.text,
        start: word.startTime,
        end: Math.max(word.endTime, word.startTime),
        ...(cue.speaker ? { speaker: cue.speaker } : {}),
        estimated: word.estimated,
      });
    });
    if (words.length && cueEndsOf[cueEndsOf.length - 1] !== words.length - 1)
      cueEndsOf.push(words.length - 1);
  }

  // Unpunctuated transcripts (typical caption cues) are split per cue instead.
  const punctuated = words.some((word) => TERMINAL.test(word.text));
  const cueEnd = new Set(cueEndsOf);
  const sentences: TranscriptSentence[] = [];
  let from = 0;
  const close = (to: number) => {
    if (to <= from) return;
    sentences.push({
      index: sentences.length,
      wordStart: from,
      wordEnd: to,
      start: words[from].start,
      end: words[to - 1].end,
      ...(words[from].speaker ? { speaker: words[from].speaker } : {}),
    });
    from = to;
  };
  words.forEach((word, i) => {
    const next = words[i + 1];
    const breaks =
      !next ||
      (punctuated ? TERMINAL.test(word.text) : cueEnd.has(i)) ||
      next.speaker !== word.speaker ||
      next.start - word.end > LONG_PAUSE_BREAK;
    if (breaks) close(i + 1);
  });
  return { words, sentences };
}

/** Time range of a contiguous word selection (inclusive indices). */
export function wordRange(transcript: Transcript, first: number, last: number): TimeRange {
  const a = Math.max(0, Math.min(first, last));
  const b = Math.min(transcript.words.length - 1, Math.max(first, last));
  if (!transcript.words.length || a > b) throw new Error("There is no transcript text in that range.");
  return { start: transcript.words[a].start, end: transcript.words[b].end };
}

/** The word being spoken at `time`, or the nearest preceding one; -1 before the first. */
export function wordIndexAt(words: readonly TranscriptWord[], time: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

const normalize = (value: string, matchCase: boolean) => {
  const stripped = value.replace(/[^\p{L}\p{N}']+/gu, "");
  return matchCase ? stripped : stripped.toLowerCase();
};

export interface TranscriptMatch {
  wordStart: number;
  /** Inclusive. */
  wordEnd: number;
}

/** Find a word or phrase; punctuation and case are ignored unless `matchCase`. */
export function searchTranscript(
  words: readonly TranscriptWord[],
  query: string,
  options: { matchCase?: boolean } = {},
): TranscriptMatch[] {
  const matchCase = options.matchCase ?? false;
  const needle = query
    .split(/\s+/)
    .map((token) => normalize(token, matchCase))
    .filter(Boolean);
  if (!needle.length) return [];
  const hay = words.map((word) => normalize(word.text, matchCase));
  const matches: TranscriptMatch[] = [];
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      const target = needle[j];
      const here = hay[i + j];
      // A lone token also matches inside a word ("tran" finds "transcript").
      if (needle.length === 1 ? !here.includes(target) : here !== target) {
        hit = false;
        break;
      }
    }
    if (hit) {
      matches.push({ wordStart: i, wordEnd: i + needle.length - 1 });
      i += needle.length - 1;
    }
  }
  return matches;
}

export const DEFAULT_FILLER_PHRASES: readonly string[] = [
  "um",
  "umm",
  "uh",
  "uhh",
  "uhm",
  "er",
  "erm",
  "hmm",
  "like",
  "you know",
];

export interface FillerMatch extends TranscriptMatch, TimeRange {
  /** The phrase that matched, as spoken. */
  text: string;
  /** The entry of the filler list it matched. */
  phrase: string;
}

/**
 * Find filler words/phrases. Matching ignores case and punctuation; a
 * multi-word phrase ("you know") must be spoken contiguously (no pause over
 * `maxGap` seconds inside it).
 */
export function findFillerWords(
  words: readonly TranscriptWord[],
  phrases: readonly string[] = DEFAULT_FILLER_PHRASES,
  options: { maxGap?: number } = {},
): FillerMatch[] {
  const maxGap = options.maxGap ?? 0.6;
  const list = phrases
    .map((phrase) => ({
      phrase,
      tokens: phrase
        .split(/\s+/)
        .map((token) => normalize(token, false))
        .filter(Boolean),
    }))
    .filter((entry) => entry.tokens.length)
    .sort((a, b) => b.tokens.length - a.tokens.length);
  const hay = words.map((word) => normalize(word.text, false));
  const matches: FillerMatch[] = [];
  for (let i = 0; i < words.length; ) {
    let matched: FillerMatch | undefined;
    for (const { phrase, tokens } of list) {
      if (i + tokens.length > words.length) continue;
      let hit = true;
      for (let j = 0; j < tokens.length && hit; j++) {
        if (hay[i + j] !== tokens[j]) hit = false;
        if (j > 0 && words[i + j].start - words[i + j - 1].end > maxGap) hit = false;
      }
      if (hit) {
        const last = i + tokens.length - 1;
        matched = {
          wordStart: i,
          wordEnd: last,
          start: words[i].start,
          end: words[last].end,
          text: words
            .slice(i, last + 1)
            .map((word) => word.text)
            .join(" "),
          phrase,
        };
        break;
      }
    }
    if (matched) {
      matches.push(matched);
      i = matched.wordEnd + 1;
    } else i++;
  }
  return matches;
}

export interface PauseMatch extends TimeRange {
  /** Gap between the two words, in seconds. */
  gap: number;
  afterWord: number;
  /** Portion actually removed (the gap minus the breathing room kept). */
  cut: TimeRange;
}

/**
 * Pauses longer than `minDuration` seconds between consecutive words. Each is
 * cut down to `keep` seconds (half of it kept on each side), so speech never
 * butts up against itself. `keep` is clamped to `minDuration`.
 */
export function findPauses(
  words: readonly TranscriptWord[],
  minDuration: number,
  options: { keep?: number } = {},
): PauseMatch[] {
  if (!(minDuration >= 0)) throw new Error("The pause length must be zero or more seconds.");
  const keep = Math.min(Math.max(options.keep ?? 0.2, 0), minDuration);
  const pauses: PauseMatch[] = [];
  for (let i = 0; i + 1 < words.length; i++) {
    const start = words[i].end;
    const end = words[i + 1].start;
    const gap = end - start;
    if (gap <= minDuration + 1e-9) continue;
    const cut = { start: start + keep / 2, end: end - keep / 2 };
    if (cut.end - cut.start < MIN_CUT) continue;
    pauses.push({ start, end, gap, afterWord: i, cut });
  }
  return pauses;
}

/** Disjoint, sorted union of ranges; ranges shorter than 1 ms are dropped. */
export function mergeTimeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end - r.start >= MIN_CUT)
    .map((r) => ({ start: Math.max(0, r.start), end: r.end }))
    .sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1e-9) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** Distinct speakers in first-appearance order. */
export function listSpeakers(subtitles: readonly Subtitle[]): string[] {
  const seen: string[] = [];
  for (const cue of [...subtitles].sort((a, b) => a.startTime - b.startTime))
    if (cue.speaker && !seen.includes(cue.speaker)) seen.push(cue.speaker);
  return seen;
}

/**
 * Rename a speaker on every cue (case-sensitive match). Renaming onto an
 * existing speaker merges them. An empty `to` clears the label. Returns the
 * same array reference when nothing changed.
 */
export function renameSpeaker(
  subtitles: readonly Subtitle[],
  from: string,
  to: string,
): Subtitle[] {
  const name = to.trim();
  let changed = false;
  const next = subtitles.map((cue) => {
    if (cue.speaker !== from) return cue;
    changed = true;
    const { speaker: _old, ...rest } = cue;
    return name ? { ...rest, speaker: name } : rest;
  });
  return changed ? next : (subtitles as Subtitle[]);
}

/** Set (or clear, with an empty name) the speaker of specific cues. */
export function assignSpeaker(
  subtitles: readonly Subtitle[],
  subtitleIds: readonly string[],
  speaker: string,
): Subtitle[] {
  const ids = new Set(subtitleIds);
  const name = speaker.trim();
  return subtitles.map((cue) => {
    if (!ids.has(cue.id)) return cue;
    const { speaker: _old, ...rest } = cue;
    return name ? { ...rest, speaker: name } : rest;
  });
}

interface JsonWord {
  word?: unknown;
  text?: unknown;
  start?: unknown;
  end?: unknown;
}
interface JsonSegment {
  start?: unknown;
  end?: unknown;
  text?: unknown;
  speaker?: unknown;
  words?: unknown;
}

const isNum = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Parse a word-timed transcript JSON: `{ language?, segments: [{ start, end,
 * text?, speaker?, words?: [{ word|text, start, end }] }] }` (the common shape
 * of Whisper-style transcribers). Segments without usable times are skipped
 * and reported.
 */
export function parseTranscriptJson(
  content: string,
  options: { captionTrackId?: string; language?: string; idPrefix?: string } = {},
): { subtitles: Subtitle[]; errors: string[] } {
  const errors: string[] = [];
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch {
    return { subtitles: [], errors: ["The transcript is not valid JSON."] };
  }
  const record = root as { segments?: unknown; language?: unknown };
  const segments = Array.isArray(root) ? root : record?.segments;
  if (!Array.isArray(segments)) return { subtitles: [], errors: ['Expected a "segments" array.'] };
  const language =
    options.language ?? (typeof record?.language === "string" ? record.language : undefined);
  const prefix = options.idPrefix ?? "tr";
  const subtitles: Subtitle[] = [];
  (segments as JsonSegment[]).forEach((segment, index) => {
    const words: SubtitleWord[] = (Array.isArray(segment.words) ? (segment.words as JsonWord[]) : [])
      .map((w) => ({
        text: String(w.word ?? w.text ?? "").trim(),
        startTime: w.start as number,
        endTime: w.end as number,
      }))
      .filter((w) => w.text && isNum(w.startTime) && isNum(w.endTime) && w.endTime >= w.startTime);
    const start = isNum(segment.start) ? segment.start : words[0]?.startTime;
    const end = isNum(segment.end) ? segment.end : words[words.length - 1]?.endTime;
    const text = words.length
      ? words.map((w) => w.text).join(" ")
      : typeof segment.text === "string"
        ? segment.text.trim()
        : "";
    if (!isNum(start) || !isNum(end) || end <= start || !text) {
      errors.push(`Segment ${index + 1} has no usable text or times.`);
      return;
    }
    subtitles.push({
      id: `${prefix}-${index + 1}`,
      text,
      startTime: start,
      endTime: end,
      ...(words.length ? { words } : {}),
      ...(typeof segment.speaker === "string" && segment.speaker ? { speaker: segment.speaker } : {}),
      ...(language ? { language } : {}),
      ...(options.captionTrackId ? { captionTrackId: options.captionTrackId } : {}),
    });
  });
  return { subtitles, errors };
}
