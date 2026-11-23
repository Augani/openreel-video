import type { Subtitle } from "../types/timeline";
import {
  framesToTimecode,
  resolveCaptionFrameRate,
  secondsToFrames,
} from "./caption-timecode";
import {
  BASIC_OVERRIDES,
  EXTENDED_12,
  EXTENDED_13,
  SPECIAL,
  hasOddParity,
  withOddParity,
} from "./cea608-tables";
export { hasOddParity, withOddParity };

/**
 * SCC (Scenarist Closed Caption) export and import: CEA-608 channel 1 (CC1),
 * field 1, as hex byte pairs with odd parity.
 *
 * Encoding rules implemented here (CEA-608-E):
 *  - every byte carries an odd-parity bit (bit 7); a null pad is 0x80;
 *  - control codes (RCL, ENM, EOC, EDM, RUn, CR, PAC, tab offsets) are sent
 *    twice; mid-row codes, special and extended characters are not;
 *  - captions are POP-ON: RCL, ENM, one PAC (row + indent) per line, the text,
 *    then EOC. The EOC is scheduled on the frame the cue starts, so the loading
 *    pairs (one pair per frame) are pre-rolled before it; an EDM clears the
 *    caption at the cue end unless the next caption's EOC replaces it;
 *  - the basic character set differs from ASCII (0x2A=a-acute ... 0x7E=n-tilde):
 *    `*` `\` `^` `_` `|` `{` `}` `~` go through the extended sets (0x12/0x13),
 *    which overwrite the previous cell, so a fallback character precedes them
 *    in the second byte of the previous pair;
 *  - rows are 32 columns; italics / underline are mid-row codes (which occupy
 *    one cell), positions are PACs with indent 0..28 in steps of 4 plus a tab
 *    offset (TO1..TO3) for the remainder;
 *  - timecode is `HH:MM:SS:FF` (non-drop) or `HH:MM:SS;FF` (29.97 drop-frame).
 *
 * Import decodes pop-on, paint-on and roll-up (RU2/RU3/RU4) captions on CC1.
 */

export interface CaptionFormatIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  cueId?: string;
}

export interface SccOptions {
  /** Cues of this caption track only (undefined = all, "" = default track). */
  captionTrackId?: string;
  /** Real frame rate; default 29.97. */
  frameRate?: number;
  /** Drop-frame timecode; default true at 29.97, ignored elsewhere. */
  dropFrame?: boolean;
  /** Added to every cue time on export (e.g. 3600 for a 01:00:00;00 start); subtracted on import. */
  offsetSeconds?: number;
  /** Columns per row (max 32). */
  maxColumns?: number;
  /** Rows per caption (max 4). */
  maxRows?: number;
  /** Place captions at the top of the picture instead of the bottom. */
  position?: "top" | "bottom";
  /** Line alignment inside the safe area. */
  align?: "center" | "left";
}

export interface SccExportResult {
  content: string;
  issues: CaptionFormatIssue[];
  /** Cues written, cues dropped (empty or unencodable). */
  cueCount: number;
  droppedCount: number;
  /** Widest row written, in columns. */
  maxRowWidth: number;
  /** Total frames cues were delayed because the 608 channel was busy. */
  delayedCues: number;
}

export interface SccParseResult {
  subtitles: Subtitle[];
  errors: Array<{ line: number; message: string }>;
  issues: CaptionFormatIssue[];
  format: "scc";
}

// ---------------------------------------------------------------------------
// Parity and byte helpers

const hex4 = (a: number, b: number): string =>
  `${(withOddParity(a) << 8 | withOddParity(b)).toString(16).padStart(4, "0")}`;

// ---------------------------------------------------------------------------
// Character sets

interface CharCode {
  kind: "basic" | "special" | "extended";
  /** basic: the byte; special/extended: [byte1, byte2]. */
  bytes: readonly number[];
}

const ENCODE: Map<string, CharCode> = new Map();
for (let b = 0x20; b <= 0x7f; b++) {
  // Bytes re-purposed by the 608 basic set carry their accented letter, not the ASCII symbol;
  // those ASCII symbols (* \ ^ _ ` { | } ~) are reachable through the extended sets.
  ENCODE.set(BASIC_OVERRIDES.get(b) ?? String.fromCharCode(b), { kind: "basic", bytes: [b] });
}
SPECIAL.forEach((ch, i) => {
  if (i === 9) return; // transparent space is not text
  ENCODE.set(ch, { kind: "special", bytes: [0x11, 0x30 + i] });
});
EXTENDED_12.forEach((ch, i) => ENCODE.set(ch, { kind: "extended", bytes: [0x12, 0x20 + i] }));
EXTENDED_13.forEach((ch, i) => ENCODE.set(ch, { kind: "extended", bytes: [0x13, 0x20 + i] }));

/** Stand-ins for characters 608 cannot show. */
const SUBSTITUTES: ReadonlyMap<string, string> = new Map([
  ["`", "'"], [" ", " "], ["\t", " "], ["–", "-"], ["‐", "-"], ["‑", "-"], ["…", "..."],
  ["′", "'"], ["″", '"'], ["„", '"'], ["‚", "'"], ["´", "'"], ["€", "E"], ["œ", "oe"], ["Œ", "OE"],
  ["æ", "ae"], ["Æ", "AE"], ["ð", "d"], ["Ð", "D"], ["þ", "th"], ["Þ", "Th"], ["×", "x"],
  ["©", "(c)"], [" ", " "],
]);

/** Fallback cell shown by receivers that do not know an extended character. */
const ASCII_FALLBACK: Readonly<Record<string, string>> = {
  "*": "+", "\\": "/", "^": "'", _: "-", "|": "/", "{": "(", "}": ")", "~": "-",
};

function extendedFallback(ch: string): string {
  if (ASCII_FALLBACK[ch]) return ASCII_FALLBACK[ch];
  const base = ch.normalize("NFD").charAt(0);
  if (/[A-Za-z]/.test(base)) return base;
  if (ch === "‘" || ch === "’") return "'";
  if (ch === "“" || ch === "”") return '"';
  if (ch === "—") return "-";
  if (ch === "¡") return "!";
  if (ch === "«" || ch === "»") return '"';
  return "?";
}

/** Map one input character to what SCC can carry; null when nothing sensible exists. */
function encodeChar(ch: string): { code: CharCode; substituted: boolean }[] | null {
  const direct = ENCODE.get(ch);
  if (direct) return [{ code: direct, substituted: false }];
  const sub = SUBSTITUTES.get(ch);
  if (sub !== undefined) {
    const out: { code: CharCode; substituted: boolean }[] = [];
    for (const c of sub) {
      const d = ENCODE.get(c);
      if (!d) return null;
      out.push({ code: d, substituted: true });
    }
    return out;
  }
  // Strip diacritics the 608 sets lack (e.g. ś -> s).
  const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (base !== ch && base.length === 1) {
    const d = ENCODE.get(base);
    if (d) return [{ code: d, substituted: true }];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Control codes

const CH1 = 0x14;
const MISC = {
  RCL: [CH1, 0x20],
  BS: [CH1, 0x21],
  DER: [CH1, 0x24],
  RU2: [CH1, 0x25],
  RU3: [CH1, 0x26],
  RU4: [CH1, 0x27],
  RDC: [CH1, 0x29],
  EDM: [CH1, 0x2c],
  CR: [CH1, 0x2d],
  ENM: [CH1, 0x2e],
  EOC: [CH1, 0x2f],
} as const;

/** PAC first bytes (channel 1) for rows 1..15 and whether the row uses the upper (0x60) half. */
const PAC_ROW: ReadonlyArray<readonly [number, boolean]> = [
  [0x11, false], [0x11, true], [0x12, false], [0x12, true], [0x15, false], [0x15, true],
  [0x16, false], [0x16, true], [0x17, false], [0x17, true], [0x10, false], [0x13, false],
  [0x13, true], [0x14, false], [0x14, true],
];

function pacBytes(row: number, indent: number, underline: boolean): [number, number] {
  const [b1, upper] = PAC_ROW[row - 1];
  return [b1, (upper ? 0x60 : 0x40) | ((8 + indent / 4) << 1) | (underline ? 1 : 0)];
}

/** Mid-row code second byte (0x11 first byte). */
const midRowByte = (italic: boolean, underline: boolean): number =>
  italic ? (underline ? 0x2f : 0x2e) : underline ? 0x21 : 0x20;

// ---------------------------------------------------------------------------
// Styled text

interface Cell {
  ch: string;
  i: boolean;
  u: boolean;
}

/** `<i>`, `<u>`, `<b>` aware split of cue text into rows of styled characters. */
function parseStyledLines(text: string): Cell[][] {
  const lines: Cell[][] = [[]];
  let i = false;
  let u = false;
  const re = /<\/?(i|u|b|em|strong)\s*>|\r?\n|[^<\r\n]+|</gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const token = m[0];
    const tag = m[1]?.toLowerCase();
    if (tag) {
      const open = !token.startsWith("</");
      if (tag === "i" || tag === "em") i = open;
      else if (tag === "u") u = open;
    } else if (token === "\n" || token === "\r\n") {
      lines.push([]);
    } else {
      for (const ch of token) lines[lines.length - 1].push({ ch, i, u });
    }
  }
  return lines;
}

type Item = { t: "char"; ch: string } | { t: "mid"; i: boolean; u: boolean };

const pacCarriesFlag = (items: Item[]): boolean => items.length === 0;

function buildRowItems(cells: Cell[]): Item[] {
  const items: Item[] = [];
  let i = false;
  let u = false;
  let first = true;
  for (const cell of cells) {
    if (cell.i !== i || cell.u !== u) {
      // Underline-only at the start of a row rides the PAC; everything else is a mid-row code.
      const pacCarries = first && !cell.i && cell.u;
      if (!pacCarries) {
        const last = items[items.length - 1];
        // A mid-row code occupies a cell and displays as a space: let it replace a space.
        if (last && last.t === "char" && last.ch === " ") items.pop();
        items.push({ t: "mid", i: cell.i, u: cell.u });
      }
      i = cell.i;
      u = cell.u;
      first = false;
      // The mid-row code itself shows as the space.
      if (cell.ch === " " && !pacCarriesFlag(items)) continue;
    }
    items.push({ t: "char", ch: cell.ch });
    first = false;
  }
  return items;
}

const itemWidth = (items: Item[]): number => items.length;

function startsUnderlined(cells: Cell[]): boolean {
  return cells.length > 0 && !cells[0].i && cells[0].u;
}

/** Wrap a cell run into rows no wider than `max` columns (greedy at spaces). */
function wrapCells(cells: Cell[], max: number, flags?: { hardSplit: boolean }): Cell[][] {
  const rows: Cell[][] = [];
  let rest = cells;
  for (;;) {
    while (rest.length && rest[0].ch === " ") rest = rest.slice(1);
    if (!rest.length) break;
    if (itemWidth(buildRowItems(rest)) <= max) {
      rows.push(rest);
      break;
    }
    // Longest prefix that fits, then back up to the last space.
    let end = rest.length;
    while (end > 1 && itemWidth(buildRowItems(rest.slice(0, end))) > max) end--;
    let cut = end;
    if (end < rest.length) {
      const space = rest.slice(0, end + 1).map((c) => c.ch).lastIndexOf(" ");
      if (space > 0) cut = space;
      else if (flags) flags.hardSplit = true;
    }
    const row = rest.slice(0, cut);
    while (row.length && row[row.length - 1].ch === " ") row.pop();
    rows.push(row);
    rest = rest.slice(cut);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Byte stream

type Token =
  | { k: "ch"; b: number }
  | { k: "code"; a: number; b: number };

function pushControl(tokens: Token[], pair: readonly number[]): void {
  tokens.push({ k: "code", a: pair[0], b: pair[1] }, { k: "code", a: pair[0], b: pair[1] });
}

/**
 * Pack tokens into byte pairs, keeping every 2-byte code on a pair boundary. A lone character
 * before a code is padded with a null in the SECOND byte (a null first byte is not valid field
 * data and decoders drop the pair). An extended character's fallback cell is an ordinary
 * character here; the extended code that follows overwrites it.
 */
function packPairs(tokens: Token[]): number[][] {
  const pairs: number[][] = [];
  let pending: number | null = null;
  for (const token of tokens) {
    if (token.k === "ch") {
      if (pending === null) pending = token.b;
      else {
        pairs.push([pending, token.b]);
        pending = null;
      }
    } else {
      if (pending !== null) {
        pairs.push([pending, 0x00]);
        pending = null;
      }
      pairs.push([token.a, token.b]);
    }
  }
  if (pending !== null) pairs.push([pending, 0x00]);
  return pairs;
}

interface EncodedCaption {
  pairs: number[][];
  rows: number;
  maxWidth: number;
}

function encodeCaption(
  cue: Subtitle,
  opts: Required<Pick<SccOptions, "maxColumns" | "maxRows" | "position" | "align">>,
  issues: CaptionFormatIssue[],
): EncodedCaption | null {
  const lines = parseStyledLines(cue.text);
  const trimmed = lines.map((line) => {
    let a = 0;
    let b = line.length;
    while (a < b && (line[a].ch === " " || line[a].ch === "\t")) a++;
    while (b > a && (line[b - 1].ch === " " || line[b - 1].ch === "\t")) b--;
    return line.slice(a, b);
  }).filter((line) => line.length);
  if (!trimmed.length) return null;

  const flags = { hardSplit: false };
  let rows: Cell[][] = trimmed.flatMap((line) => wrapCells(line, opts.maxColumns, flags));
  const wrapped = rows.length > trimmed.length;
  if (rows.length > opts.maxRows && trimmed.length > 1) {
    // Re-flow the whole caption: explicit breaks may be what pushed it over.
    const joined: Cell[] = [];
    trimmed.forEach((line, n) => {
      if (n > 0) joined.push({ ch: " ", i: line[0].i, u: line[0].u });
      joined.push(...line);
    });
    rows = wrapCells(joined, opts.maxColumns, flags);
  }
  if (rows.length > opts.maxRows) {
    issues.push({
      severity: "error",
      code: "scc-too-many-lines",
      cueId: cue.id,
      message: `Caption needs ${rows.length} rows but CEA-608 allows ${opts.maxRows}; the extra ${rows.length - opts.maxRows} row(s) were dropped.`,
    });
    rows = rows.slice(0, opts.maxRows);
  } else if (wrapped) {
    issues.push({
      severity: "warning",
      code: "scc-line-wrapped",
      cueId: cue.id,
      message: `A line was longer than ${opts.maxColumns} characters and was wrapped.`,
    });
  }
  if (flags.hardSplit)
    issues.push({
      severity: "warning",
      code: "scc-word-split",
      cueId: cue.id,
      message: `A word is longer than ${opts.maxColumns} columns and was split.`,
    });

  const firstRow = opts.position === "top" ? 1 : 15 - rows.length + 1;
  const tokens: Token[] = [];
  pushControl(tokens, MISC.RCL);
  pushControl(tokens, MISC.ENM);
  let maxWidth = 0;
  const substituted = new Set<string>();
  const unsupported = new Set<string>();

  rows.forEach((row, index) => {
    const items = buildRowItems(row);
    const width = itemWidth(items);
    maxWidth = Math.max(maxWidth, width);
    const col = opts.align === "left" ? 0 : Math.max(0, Math.floor((32 - width) / 2));
    const indent = Math.floor(col / 4) * 4;
    pushControl(tokens, pacBytes(firstRow + index, indent, startsUnderlined(row)));
    if (col - indent > 0) pushControl(tokens, [0x17, 0x20 + (col - indent)]);
    for (const item of items) {
      if (item.t === "mid") {
        tokens.push({ k: "code", a: 0x11, b: midRowByte(item.i, item.u) });
        continue;
      }
      const mapped = encodeChar(item.ch);
      if (!mapped) {
        unsupported.add(item.ch);
        tokens.push({ k: "ch", b: 0x3f });
        continue;
      }
      for (const { code, substituted: wasSubstituted } of mapped) {
        if (wasSubstituted) substituted.add(item.ch);
        if (code.kind === "basic") tokens.push({ k: "ch", b: code.bytes[0] });
        else if (code.kind === "special") tokens.push({ k: "code", a: code.bytes[0], b: code.bytes[1] });
        else {
          const fallback = encodeChar(extendedFallback(item.ch))?.[0]?.code;
          tokens.push({ k: "ch", b: fallback?.kind === "basic" ? fallback.bytes[0] : 0x3f });
          tokens.push({ k: "code", a: code.bytes[0], b: code.bytes[1] });
        }
      }
    }
  });
  if (unsupported.size)
    issues.push({
      severity: "warning",
      code: "scc-unsupported-char",
      cueId: cue.id,
      message: `Characters not available in CEA-608 were replaced with "?": ${[...unsupported].join(" ")}`,
    });
  if (substituted.size)
    issues.push({
      severity: "info",
      code: "scc-substituted-char",
      cueId: cue.id,
      message: `Characters replaced by CEA-608 equivalents: ${[...substituted].join(" ")}`,
    });
  return { pairs: packPairs(tokens), rows: rows.length, maxWidth };
}

// ---------------------------------------------------------------------------
// Export

export function encodeScc(subtitles: readonly Subtitle[], options: SccOptions = {}): SccExportResult {
  const rate = resolveCaptionFrameRate(options.frameRate, options.dropFrame);
  const offset = options.offsetSeconds ?? 0;
  const opts = {
    maxColumns: Math.min(32, Math.max(8, Math.floor(options.maxColumns ?? 32))),
    maxRows: Math.min(4, Math.max(1, Math.floor(options.maxRows ?? 4))),
    position: options.position ?? "bottom",
    align: options.align ?? "center",
  } as const;
  const issues: CaptionFormatIssue[] = [];
  const cues = subtitles
    .filter((c) => options.captionTrackId === undefined || (c.captionTrackId ?? "") === options.captionTrackId)
    .filter((c) => c.endTime > c.startTime && c.text.trim() !== "")
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);

  const slots = new Map<number, number[]>();
  let prev: { start: number; end: number; eoc: number } | null = null;
  let maxRowWidth = 0;
  let written = 0;
  let dropped = 0;
  let delayedCues = 0;

  for (const cue of cues) {
    const caption = encodeCaption(cue, opts, issues);
    if (!caption) {
      dropped++;
      continue;
    }
    maxRowWidth = Math.max(maxRowWidth, caption.maxWidth);
    const n = caption.pairs.length;
    const wanted = secondsToFrames(cue.startTime + offset, rate);
    const endFrame = Math.max(wanted + 2, secondsToFrames(cue.endTime + offset, rate));
    if (prev && wanted < prev.end) issues.push({
      severity: "warning",
      code: "scc-overlap",
      cueId: cue.id,
      message: "Captions overlap; pop-on captions cannot be shown together.",
    });

    let eoc = Math.max(wanted, prev ? prev.eoc + 2 : 0);
    let edmFrame: number | null = null;
    for (;;) {
      // The previous caption's EDM, if it still fits before this EOC.
      edmFrame = null;
      if (prev && prev.end >= prev.eoc + 2 && prev.end + 1 < eoc) edmFrame = prev.end;
      const floor = prev ? prev.eoc + 2 : 0;
      let need = n;
      let f = eoc - 1;
      const loadFrames: number[] = [];
      while (need > 0 && f >= floor) {
        if (f !== edmFrame && f !== (edmFrame ?? -9) + 1) {
          loadFrames.push(f);
          need--;
        }
        f--;
      }
      if (need === 0) {
        loadFrames.reverse();
        if (edmFrame !== null) {
          const edm = hexPair(MISC.EDM);
          slots.set(edmFrame, edm);
          slots.set(edmFrame + 1, edm);
        }
        caption.pairs.forEach((pair, idx) => slots.set(loadFrames[idx], pair));
        break;
      }
      eoc++;
    }
    const eocPair = hexPair(MISC.EOC);
    slots.set(eoc, eocPair);
    slots.set(eoc + 1, eocPair);
    if (eoc !== wanted) {
      delayedCues++;
      issues.push({
        severity: "warning",
        code: "scc-delayed",
        cueId: cue.id,
        message: `Caption appears ${eoc - wanted} frame(s) late: the CEA-608 channel was still busy loading text (each byte pair takes one frame).`,
      });
    }
    prev = { start: wanted, end: endFrame, eoc };
    written++;
  }
  // Final EDM for the last caption.
  if (prev && prev.end >= prev.eoc + 2) {
    const edm = hexPair(MISC.EDM);
    let at = prev.end;
    while (slots.has(at) || slots.has(at + 1)) at++;
    slots.set(at, edm);
    slots.set(at + 1, edm);
  }

  const frames = [...slots.keys()].sort((a, b) => a - b);
  const lines: string[] = [];
  let i = 0;
  while (i < frames.length) {
    const start = frames[i];
    const words: string[] = [];
    let j = i;
    while (j < frames.length && frames[j] === start + (j - i)) {
      const [a, b] = slots.get(frames[j])!;
      words.push(hex4(a, b));
      j++;
    }
    lines.push(`${framesToTimecode(start, rate)}\t${words.join(" ")}`);
    i = j;
  }
  const content = lines.length ? `Scenarist_SCC V1.0\n\n${lines.join("\n\n")}\n` : "";
  return { content, issues, cueCount: written, droppedCount: dropped, maxRowWidth, delayedCues };
}

const hexPair = (pair: readonly number[]): number[] => [pair[0], pair[1]];

export function exportScc(subtitles: readonly Subtitle[], options: SccOptions = {}): string {
  return encodeScc(subtitles, options).content;
}

// ---------------------------------------------------------------------------
// Import lives in scc-import.ts (shared CEA-608 decoder) and is re-exported here.
export { isSccContent, parseScc } from "./scc-import";
export type { SccParseOptions } from "./scc-import";
