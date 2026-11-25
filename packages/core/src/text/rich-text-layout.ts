import { resolveRunStyle, type ResolvedRunStyle } from "./rich-text";
import type { TextRun, TextStyle } from "./types";

/**
 * Pure line layout for styled runs. Text is measured through an injected
 * callback so the same code decides line breaks in preview, export and tests.
 */

export interface SegmentMetrics {
  readonly width: number;
  /** Font ascent / descent above and below the alphabetic baseline, in pixels. */
  readonly ascent: number;
  readonly descent: number;
}

export type RunMeasurer = (text: string, style: ResolvedRunStyle) => SegmentMetrics;

export interface LaidSegment {
  readonly text: string;
  readonly style: ResolvedRunStyle;
  /** Offset from the line start, in pixels. */
  readonly x: number;
  readonly width: number;
  /** Index of the first character in the laid-out text (for per-character animation). */
  readonly start: number;
}

export interface LaidLine {
  readonly segments: LaidSegment[];
  readonly width: number;
  /** Top of the line box, from the top of the block. */
  readonly top: number;
  readonly height: number;
  /** Baseline, from the top of the line box (before each segment's baseline shift). */
  readonly baseline: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface RichLayout {
  readonly lines: LaidLine[];
  readonly width: number;
  readonly height: number;
}

interface Piece { readonly text: string; readonly runIndex: number; readonly start: number }
interface Token { readonly pieces: Piece[]; readonly space: boolean }

function tokenize(runs: readonly TextRun[]): Token[][] {
  // One token list per hard line (split on "\n"); tokens alternate words and single spaces.
  const paragraphs: Token[][] = [[]];
  let offset = 0;
  const push = (piece: Piece, space: boolean) => {
    const tokens = paragraphs[paragraphs.length - 1];
    const last = tokens[tokens.length - 1];
    if (last && last.space === space && !space) last.pieces.push(piece);
    else tokens.push({ pieces: [piece], space });
  };
  runs.forEach((run, runIndex) => {
    let buffer = "";
    let bufferStart = offset;
    const flush = () => {
      if (buffer) push({ text: buffer, runIndex, start: bufferStart }, false);
      buffer = "";
    };
    for (const character of run.text) {
      if (character === "\n") {
        flush();
        paragraphs.push([]);
        offset += 1;
        bufferStart = offset;
      } else if (character === " ") {
        flush();
        push({ text: " ", runIndex, start: offset }, true);
        offset += 1;
        bufferStart = offset;
      } else {
        if (!buffer) bufferStart = offset;
        buffer += character;
        offset += character.length;
      }
    }
    flush();
  });
  return paragraphs;
}

export function layoutRichText(
  runs: readonly TextRun[],
  base: TextStyle,
  measure: RunMeasurer,
  maxWidth?: number,
): RichLayout {
  const styles = runs.map((run) => resolveRunStyle(base, run.style));
  const baseResolved = resolveRunStyle(base, {});
  const widthOf = (piece: Piece) => measure(piece.text, styles[piece.runIndex]).width;
  const tokenWidth = (token: Token) => token.pieces.reduce((sum, piece) => sum + widthOf(piece), 0);

  // Group into lines of pieces first (breaking), then merge pieces into segments.
  const rawLines: Piece[][] = [];
  for (const tokens of tokenize(runs)) {
    let line: Piece[] = [];
    let lineWidth = 0;
    const commit = () => {
      rawLines.push(line);
      line = [];
      lineWidth = 0;
    };
    const splitLong = (token: Token) => {
      for (const piece of token.pieces) {
        let chunk = "";
        let chunkStart = piece.start;
        let consumed = 0;
        for (const character of Array.from(piece.text)) {
          const next = chunk + character;
          const nextWidth = widthOf({ ...piece, text: next });
          if (chunk && lineWidth + nextWidth > (maxWidth ?? Infinity)) {
            line.push({ text: chunk, runIndex: piece.runIndex, start: chunkStart });
            commit();
            chunk = character;
            chunkStart = piece.start + consumed;
          } else chunk = next;
          consumed += character.length;
        }
        if (chunk) {
          line.push({ text: chunk, runIndex: piece.runIndex, start: chunkStart });
          lineWidth += widthOf({ text: chunk, runIndex: piece.runIndex, start: chunkStart });
        }
      }
    };
    for (const token of tokens) {
      const width = tokenWidth(token);
      if (maxWidth === undefined) {
        line.push(...token.pieces);
        lineWidth += width;
        continue;
      }
      if (token.space) {
        // A space that would overflow is the break itself and is dropped; the next word starts the new line.
        if (line.length && lineWidth + width <= maxWidth) { line.push(...token.pieces); lineWidth += width; }
        continue;
      }
      if (line.length && lineWidth + width > maxWidth) {
        // Trailing space does not belong to the finished line.
        const last = line[line.length - 1];
        if (last.text === " ") line.pop();
        commit();
      }
      if (width > maxWidth) splitLong(token);
      else { line.push(...token.pieces); lineWidth += width; }
    }
    rawLines.push(line);
  }

  const lines: LaidLine[] = [];
  let top = 0;
  let blockWidth = 0;
  for (const pieces of rawLines) {
    const segments: LaidSegment[] = [];
    let x = 0;
    let ascent = 0;
    let descent = 0;
    let size = 0;
    for (const piece of pieces) {
      const last = segments[segments.length - 1];
      const style = styles[piece.runIndex];
      const metrics = measure(piece.text, style);
      ascent = Math.max(ascent, metrics.ascent + style.baselineShift);
      descent = Math.max(descent, metrics.descent - style.baselineShift);
      size = Math.max(size, style.fontSize);
      if (last && last.style === style && last.start + last.text.length === piece.start) {
        const text = last.text + piece.text;
        const width = measure(text, style).width;
        segments[segments.length - 1] = { ...last, text, width };
        x = last.x + width;
      } else {
        segments.push({ text: piece.text, style, x, width: metrics.width, start: piece.start });
        x += metrics.width;
      }
    }
    const empty = pieces.length === 0;
    const effectiveSize = empty ? baseResolved.fontSize : size;
    const height = effectiveSize * base.lineHeight;
    const emptyMetrics = empty ? measure("M", baseResolved) : undefined;
    const a = empty ? emptyMetrics!.ascent : ascent;
    const d = empty ? emptyMetrics!.descent : Math.max(descent, 0);
    const baseline = (height - (a + d)) / 2 + a;
    const first = pieces[0];
    const lastPiece = pieces[pieces.length - 1];
    lines.push({
      segments,
      width: x,
      top,
      height,
      baseline,
      start: first?.start ?? 0,
      end: lastPiece ? lastPiece.start + lastPiece.text.length : 0,
      text: segments.map((segment) => segment.text).join(""),
    });
    top += height;
    blockWidth = Math.max(blockWidth, x);
  }
  return { lines, width: blockWidth, height: top };
}
