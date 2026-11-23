import type { Subtitle } from "../types/timeline";

/**
 * Reading-speed-aware re-segmentation. Translation often changes text length
 * (German and Spanish run 20-30% longer than English), so a translated cue can
 * end up too long to read in the time the spoken passage lasted. This keeps
 * the passage's time span and fixes the cue in two ways, in order:
 *
 *  1. If the text reads much too fast (over `tolerance` x the limit), borrow silence after the cue (never past the
 *     next cue's start, never beyond `maxDuration`).
 *  2. If the text is too long for the screen (`maxLines` rows of
 *     `maxCharsPerLine`) or the cue runs past `maxDuration`, split it at
 *     sentence, then clause, then word boundaries into several cues that share
 *     the original time span in proportion to their text.
 *
 * Cues already inside every limit are returned untouched. Pure and
 * deterministic; defaults match the caption QC panel.
 */

export interface ResegmentOptions {
  /** Maximum characters per second. Default 17. */
  readonly maxCps?: number;
  readonly maxCharsPerLine?: number;
  readonly maxLines?: number;
  /** Cues are never made shorter than this when splitting. Default 5/6 s. */
  readonly minDuration?: number;
  readonly maxDuration?: number;
  /**
   * A cue is only lengthened into following silence when it reads faster than
   * `maxCps * tolerance`; a small overshoot keeps the spoken passage's exact
   * timing (the caption QC panel still flags it). Default 1.15.
   */
  readonly tolerance?: number;
  /** Id for the n-th (n >= 2) piece of a split cue. */
  readonly pieceId?: (cue: Subtitle, piece: number) => string;
}

export const DEFAULT_RESEGMENT: Required<Omit<ResegmentOptions, "pieceId">> = {
  tolerance: 1.15,
  maxCps: 17,
  maxCharsPerLine: 42,
  maxLines: 2,
  minDuration: 5 / 6,
  maxDuration: 7,
};

const flat = (text: string) => text.replace(/<[^>]+>/g, "").replace(/\s*\r?\n\s*/g, " ").replace(/\s+/g, " ").trim();
const SENTENCE_END = /[.!?。！？…]["')\]]*$/;
const CLAUSE_END = /[,;:、，；：]["')\]]*$/;
const CJK = /[぀-ヿ㐀-鿿가-힯]/;

/** Break `text` into `parts` pieces of similar length, preferring punctuation. */
export function splitText(text: string, parts: number): string[] {
  const clean = flat(text);
  if (parts <= 1 || !clean) return [clean];
  // Words (space separated); unspaced scripts fall back to one token per character.
  const unspaced = CJK.test(clean) && !clean.includes(" ");
  const tokens = unspaced ? Array.from(clean) : clean.split(" ");
  const joiner = unspaced ? "" : " ";
  if (tokens.length <= parts) return tokens;
  const total = clean.length;
  const cuts: number[] = []; // token index where a new piece starts
  let consumed = 0;
  const prefix = tokens.map((t) => (consumed += t.length + joiner.length));
  for (let k = 1; k < parts; k++) {
    const target = (total * k) / parts;
    let best = -1;
    let bestScore = Infinity;
    const lo = (cuts[cuts.length - 1] ?? 0) + 1;
    for (let i = lo; i <= tokens.length - (parts - k); i++) {
      const dist = Math.abs(prefix[i - 1] - target);
      const prev = tokens[i - 1];
      // A sentence break is worth up to half a piece of text, a clause break a quarter.
      const bonus = SENTENCE_END.test(prev) ? 0.5 : CLAUSE_END.test(prev) ? 0.25 : 0;
      const score = dist - bonus * (total / parts);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    cuts.push(best);
  }
  const out: string[] = [];
  let from = 0;
  for (const cut of [...cuts, tokens.length]) {
    out.push(tokens.slice(from, cut).join(joiner));
    from = cut;
  }
  return out.filter(Boolean);
}

export interface ResegmentResult {
  readonly cues: Subtitle[];
  /** Cues that were split into pieces. */
  readonly split: number;
  /** Cues whose end moved into following silence. */
  readonly extended: number;
}

/**
 * Re-segment `cues` (one track, any order). Output is sorted by start time.
 * The first piece of a split keeps the cue's id.
 */
export function resegmentCues(cues: readonly Subtitle[], options: ResegmentOptions = {}): ResegmentResult {
  const o = { ...DEFAULT_RESEGMENT };
  for (const key of Object.keys(DEFAULT_RESEGMENT) as Array<keyof typeof DEFAULT_RESEGMENT>) {
    const v = options[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) o[key] = v;
  }
  const pieceId = options.pieceId ?? ((cue: Subtitle, n: number) => `${cue.id}-${n}`);
  const sorted = [...cues].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
  const capacity = o.maxCharsPerLine * o.maxLines;
  const out: Subtitle[] = [];
  let split = 0;
  let extended = 0;

  sorted.forEach((cue, index) => {
    const text = flat(cue.text);
    let end = cue.endTime;
    const duration = () => end - cue.startTime;
    if (!text || duration() <= 0) {
      out.push(cue);
      return;
    }
    // 1. Borrow silence when the text reads too fast.
    if (text.length / duration() > o.maxCps * o.tolerance) {
      const wanted = cue.startTime + text.length / o.maxCps;
      const next = sorted[index + 1]?.startTime ?? Infinity;
      const room = Math.min(next, cue.startTime + o.maxDuration);
      const newEnd = Math.min(wanted, Math.max(room, end));
      if (newEnd > end + 1e-6) {
        end = newEnd;
        extended++;
      }
    }
    // 2. Split what cannot fit on screen or runs too long.
    let parts = Math.max(Math.ceil(text.length / capacity), Math.ceil(duration() / o.maxDuration));
    parts = Math.max(1, Math.min(parts, Math.floor(duration() / o.minDuration) || 1, text.length));
    const base = end === cue.endTime ? cue : { ...cue, endTime: end };
    if (parts <= 1) {
      out.push(base);
      return;
    }
    let pieces = splitText(text, parts);
    // Uneven breaks can leave one piece over the screen limit: use more pieces while time allows.
    const maxParts = Math.max(parts, Math.min(Math.floor(duration() / o.minDuration) || 1, text.length));
    while (pieces.some((p) => p.length > capacity) && parts < maxParts) pieces = splitText(text, ++parts);
    if (pieces.length <= 1) {
      out.push(base);
      return;
    }
    split++;
    const weight = pieces.reduce((sum, p) => sum + p.length, 0);
    let t = cue.startTime;
    let used = 0;
    const { words: _words, ...rest } = base;
    void _words;
    // Share the span in proportion to text, but never give a piece less than `minDuration`:
    // short pieces are lifted to the minimum and the others give up the difference.
    const span = duration();
    const lengths = pieces.map((p) => p.length);
    const share = lengths.map((n) => (span * n) / weight);
    if (share.some((d) => d < o.minDuration - 1e-9) && o.minDuration * pieces.length <= span + 1e-9) {
      const fixed = new Array<boolean>(pieces.length).fill(false);
      for (let guard = 0; guard < pieces.length; guard++) {
        const free = share.map((_, i) => i).filter((i) => !fixed[i]);
        const left = span - fixed.reduce((sum, f, i) => sum + (f ? share[i] : 0), 0);
        const freeWeight = free.reduce((sum, i) => sum + lengths[i], 0);
        let changed = false;
        for (const i of free) {
          share[i] = (left * lengths[i]) / freeWeight;
          if (share[i] < o.minDuration - 1e-9) {
            share[i] = o.minDuration;
            fixed[i] = true;
            changed = true;
          }
        }
        if (!changed) break;
      }
    }
    pieces.forEach((piece, i) => {
      used += share[i];
      const pieceEnd = i === pieces.length - 1 ? end : cue.startTime + used;
      out.push({ ...rest, id: i === 0 ? cue.id : pieceId(cue, i + 1), text: piece, startTime: t, endTime: pieceEnd });
      t = pieceEnd;
    });
  });
  return { cues: out, split, extended };
}
