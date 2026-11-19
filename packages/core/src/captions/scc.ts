import type { Subtitle } from "../types/timeline";
import {
  framesToSeconds,
  framesToTimecode,
  resolveCaptionFrameRate,
  secondsToFrames,
  timecodeToFrames,
  type CaptionFrameRate,
} from "./caption-timecode";

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

export function withOddParity(byte: number): number {
  const b = byte & 0x7f;
  let p = b;
  p ^= p >> 4;
  p ^= p >> 2;
  p ^= p >> 1;
  return p & 1 ? b : b | 0x80;
}

export const hasOddParity = (byte: number): boolean => {
  let p = byte & 0xff;
  p ^= p >> 4;
  p ^= p >> 2;
  p ^= p >> 1;
  return (p & 1) === 1;
};

const hex4 = (a: number, b: number): string =>
  `${(withOddParity(a) << 8 | withOddParity(b)).toString(16).padStart(4, "0")}`;

// ---------------------------------------------------------------------------
// Character sets

/** Basic set bytes that are not ASCII: byte -> character. */
const BASIC_OVERRIDES: ReadonlyMap<number, string> = new Map([
  [0x2a, "á"], [0x5c, "é"], [0x5e, "í"], [0x5f, "ó"], [0x60, "ú"],
  [0x7b, "ç"], [0x7c, "÷"], [0x7d, "Ñ"], [0x7e, "ñ"], [0x7f, "█"],
]);

/** Special characters: 0x11, 0x30..0x3F. (0x39 is the transparent space.) */
const SPECIAL = ["®", "°", "½", "¿", "™", "¢", "£", "♪", "à", " ", "è", "â", "ê", "î", "ô", "û"];

/** Extended sets: 0x12 (Spanish/French/misc) and 0x13 (Portuguese/German), 0x20..0x3F. */
const EXTENDED_12 = [
  "Á", "É", "Ó", "Ú", "Ü", "ü", "‘", "¡", "*", "’", "—", "©", "℠", "•", "“", "”",
  "À", "Â", "Ç", "È", "Ê", "Ë", "ë", "Î", "Ï", "ï", "Ô", "Ù", "ù", "Û", "«", "»",
];
const EXTENDED_13 = [
  "Ã", "ã", "Í", "Ì", "ì", "Ò", "ò", "Õ", "õ", "{", "}", "\\", "^", "_", "|", "~",
  "Ä", "ä", "Ö", "ö", "ß", "¥", "¤", "│", "Å", "å", "Ø", "ø", "┌", "┐", "└", "┘",
];

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
// Import: a CEA-608 CC1 decoder

const ROWS = 15;
const COLS = 32;

interface GridCell {
  ch: string;
  i: boolean;
  u: boolean;
}
type Grid = Array<Array<GridCell | null>>;
const newGrid = (): Grid => Array.from({ length: ROWS }, () => Array<GridCell | null>(COLS).fill(null));
const gridEmpty = (g: Grid): boolean => g.every((row) => row.every((c) => c === null || c.ch === " "));

function rowText(row: Array<GridCell | null>, keepTags: boolean): string {
  let s = "";
  let i = false;
  let u = false;
  const cells = row.map((c) => c ?? { ch: " ", i: false, u: false });
  for (const c of cells) {
    const isSpace = c.ch === " ";
    // Spaces never open a run; they stay in the run that is open.
    const ni: boolean = isSpace ? i : c.i;
    const nu: boolean = isSpace ? u : c.u;
    if (keepTags && (ni !== i || nu !== u)) {
      if (u) s += "</u>";
      if (i) s += "</i>";
      if (ni) s += "<i>";
      if (nu) s += "<u>";
      i = ni;
      u = nu;
    }
    s += c.ch;
  }
  if (keepTags) {
    if (u) s += "</u>";
    if (i) s += "</i>";
    s = s.replace(/(\s+)<\/(u|i)>/g, "</$2>$1").replace(/<(i|u)>(\s+)/g, "$2<$1>");
  }
  return s.trim();
}

function gridText(g: Grid, keepTags: boolean): string {
  return g.map((row) => rowText(row, keepTags)).filter((t) => t !== "").join("\n");
}

const PAC_FIRST_ROW: Record<number, number> = { 0x11: 1, 0x12: 3, 0x15: 5, 0x16: 7, 0x17: 9, 0x10: 11, 0x13: 12, 0x14: 14 };

let sccCounter = 0;

export interface SccParseOptions {
  captionTrackId?: string;
  language?: string;
  /** Real frame rate; default 29.97. */
  frameRate?: number;
  /** Subtracted from every time (the inverse of the export offset). */
  offsetSeconds?: number;
  /** Keep `<i>` / `<u>` tags for italic / underlined runs (default: strip). */
  styleTags?: "keep" | "strip";
  /** Seconds a still-visible last caption is shown for. */
  trailingSeconds?: number;
}

export function isSccContent(content: string): boolean {
  return /^\uFEFF?\s*Scenarist_SCC/i.test(content);
}

export function parseScc(content: string, options: SccParseOptions = {}): SccParseResult {
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const errors: SccParseResult["errors"] = [];
  const issues: CaptionFormatIssue[] = [];
  const keepTags = options.styleTags === "keep";
  const offset = options.offsetSeconds ?? 0;
  const lines = text.split("\n");
  if (!/^\s*Scenarist_SCC/i.test(lines[0] ?? "")) {
    errors.push({ line: 1, message: 'Missing "Scenarist_SCC V1.0" header.' });
    return { subtitles: [], errors, issues, format: "scc" };
  }

  // Frame rate: explicit option, else drop-frame separator implies 29.97 DF.
  const hasDrop = lines.some((l) => /^\d{1,2}:\d{2}:\d{2};\d{2}\s/.test(l));
  const rate: CaptionFrameRate = resolveCaptionFrameRate(options.frameRate, hasDrop);

  const subtitles: Subtitle[] = [];
  let disp = newGrid();
  let hidden = newGrid();
  let mode: "none" | "pop" | "roll" | "paint" = "none";
  let depth = 2;
  let baseRow = 15;
  let row = 15;
  let col = 0;
  let curI = false;
  let curU = false;
  let channel: 1 | 2 | 3 = 1;
  let shownSince: number | null = null;
  let lastControl = "";
  let parityErrors = 0;
  let lastTime = 0;

  const commit = (end: number) => {
    if (shownSince === null) return;
    const body = gridText(disp, keepTags);
    if (body && end > shownSince + 1e-9) {
      subtitles.push({
        id: `scc-${Date.now().toString(36)}-${(sccCounter++).toString(36)}`,
        text: body,
        startTime: shownSince - offset,
        endTime: end - offset,
        ...(options.language ? { language: options.language } : {}),
        ...(options.captionTrackId ? { captionTrackId: options.captionTrackId } : {}),
      });
    }
    shownSince = null;
  };
  const markShown = (t: number) => {
    if (shownSince === null && !gridEmpty(disp)) shownSince = t;
  };
  const target = (): Grid => (mode === "pop" ? hidden : disp);
  const put = (ch: string, t: number, style?: { i: boolean; u: boolean }) => {
    if (channel !== 1) return;
    const grid = target();
    if (row < 1 || row > ROWS) return;
    const c = Math.min(col, COLS - 1);
    grid[row - 1][c] = { ch, i: style?.i ?? curI, u: style?.u ?? curU };
    col = Math.min(col + 1, COLS);
    if (grid === disp) markShown(t);
  };
  const rollUp = (t: number) => {
    commit(t);
    const top = Math.max(1, baseRow - depth + 1);
    for (let r = top; r < baseRow; r++) disp[r - 1] = disp[r];
    disp[baseRow - 1] = Array<GridCell | null>(COLS).fill(null);
    col = 0;
    curI = false;
    curU = false;
    if (!gridEmpty(disp)) shownSince = t;
  };

  for (let ln = 1; ln < lines.length; ln++) {
    const line = lines[ln];
    if (!line.trim()) continue;
    const m = /^(\d{1,2}:\d{2}:\d{2}[:;.,]\d{2})\s+(.*)$/.exec(line.trim());
    if (!m) {
      errors.push({ line: ln + 1, message: "Line has no timecode followed by byte pairs." });
      continue;
    }
    const startFrame = timecodeToFrames(m[1], rate);
    if (startFrame === null) {
      errors.push({ line: ln + 1, message: `Invalid timecode "${m[1]}".` });
      continue;
    }
    const words = m[2].trim().split(/\s+/).filter(Boolean);
    for (let w = 0; w < words.length; w++) {
      if (!/^[0-9a-fA-F]{4}$/.test(words[w])) {
        errors.push({ line: ln + 1, message: `Invalid byte pair "${words[w]}".` });
        continue;
      }
      const raw = parseInt(words[w], 16);
      let b1 = raw >> 8;
      let b2 = raw & 0xff;
      if (!hasOddParity(b1) || !hasOddParity(b2)) parityErrors++;
      b1 &= 0x7f;
      b2 &= 0x7f;
      const t = framesToSeconds(startFrame + w, rate);
      lastTime = t;
      if (b1 === 0 && b2 === 0) continue;

      if (b1 >= 0x10 && b1 <= 0x1f) {
        const isMisc = (b1 === 0x14 || b1 === 0x15 || b1 === 0x1c || b1 === 0x1d) && b2 >= 0x20 && b2 <= 0x2f;
        const isTab = (b1 === 0x17 || b1 === 0x1f) && b2 >= 0x21 && b2 <= 0x23;
        const isPac = b2 >= 0x40 && b2 <= 0x7f;
        const isMid = (b1 === 0x11 || b1 === 0x19) && b2 >= 0x20 && b2 <= 0x2f;
        const isSpecial = (b1 === 0x11 || b1 === 0x19) && b2 >= 0x30 && b2 <= 0x3f;
        const isExt = (b1 === 0x12 || b1 === 0x13 || b1 === 0x1a || b1 === 0x1b) && b2 >= 0x20 && b2 <= 0x3f;
        const key = `${b1}:${b2}`;
        if (isMisc || isTab || isPac) {
          // Control codes are sent twice; the second is ignored.
          if (lastControl === key) {
            lastControl = "";
            continue;
          }
          lastControl = key;
        } else lastControl = "";

        const dataChannel: 1 | 2 | 3 = b1 === 0x15 || b1 === 0x1d ? 3 : b1 & 0x08 ? 2 : 1;
        if (isMisc) channel = dataChannel;
        else if (isPac || isTab || isMid || isSpecial || isExt) channel = b1 & 0x08 ? 2 : channel === 2 ? 1 : channel;
        if (channel !== 1) continue;

        if (isMisc) {
          switch (b2) {
            case 0x20: mode = "pop"; break; // RCL
            case 0x21: // BS
              if (col > 0) {
                col--;
                target()[row - 1][col] = null;
              }
              break;
            case 0x24: // DER
              for (let c = col; c < COLS; c++) target()[row - 1][c] = null;
              break;
            case 0x25: case 0x26: case 0x27: { // RU2..RU4
              const d = b2 - 0x23;
              if (mode !== "roll") {
                commit(t);
                disp = newGrid();
                hidden = newGrid();
                baseRow = 15;
                row = 15;
                col = 0;
              }
              mode = "roll";
              depth = d;
              if (baseRow < depth) baseRow = depth;
              break;
            }
            case 0x29: mode = "paint"; break; // RDC
            case 0x2c: // EDM
              commit(t);
              disp = newGrid();
              break;
            case 0x2d: // CR
              if (mode === "roll") rollUp(t);
              break;
            case 0x2e: hidden = newGrid(); break; // ENM
            case 0x2f: // EOC
              commit(t);
              [disp, hidden] = [hidden, disp];
              mode = "pop";
              if (!gridEmpty(disp)) shownSince = t;
              break;
            default: break;
          }
        } else if (isTab) {
          col = Math.min(COLS - 1, col + (b2 - 0x20));
        } else if (isPac) {
          const base = PAC_FIRST_ROW[b1 & 0x17];
          if (base === undefined) continue;
          const pacRow = (b1 & 0x17) === 0x10 ? 11 : base + (b2 >= 0x60 ? 1 : 0);
          const attr = (b2 >> 1) & 0x0f;
          const underline = (b2 & 1) === 1;
          if (mode === "roll") {
            baseRow = Math.max(pacRow, depth);
            row = baseRow;
          } else row = pacRow;
          curU = underline;
          curI = attr === 7;
          col = attr >= 8 ? (attr - 8) * 4 : 0;
        } else if (isMid) {
          const attr = (b2 >> 1) & 0x07;
          const ni = attr === 7;
          const nu = (b2 & 1) === 1;
          // The code occupies a (blank) cell that keeps the outgoing style for text extraction.
          put(" ", t, { i: curI, u: curU });
          curI = ni;
          curU = nu;
        } else if (isSpecial) {
          put(SPECIAL[b2 - 0x30], t);
        } else if (isExt) {
          const set = b1 === 0x12 || b1 === 0x1a ? EXTENDED_12 : EXTENDED_13;
          if (col > 0) col--;
          put(set[b2 - 0x20], t);
        }
        continue;
      }
      lastControl = "";
      // Text: two characters.
      for (const b of [b1, b2]) {
        if (b < 0x20) continue;
        put(BASIC_OVERRIDES.get(b) ?? String.fromCharCode(b), t);
      }
    }
  }
  if (shownSince !== null) {
    const end = lastTime + (options.trailingSeconds ?? 2);
    issues.push({
      severity: "warning",
      code: "scc-unterminated",
      message: "The last caption was never cleared; it was given a default duration.",
    });
    commit(end);
  }
  if (parityErrors)
    issues.push({
      severity: "warning",
      code: "scc-parity",
      message: `${parityErrors} byte(s) had wrong (non-odd) parity.`,
    });
  subtitles.sort((a, b) => a.startTime - b.startTime);
  return { subtitles, errors, issues, format: "scc" };
}
