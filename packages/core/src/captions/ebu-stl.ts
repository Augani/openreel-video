import type { CueSettings, Subtitle, SubtitleStyle } from "../types/timeline";
import { DEFAULT_CAPTION_STYLE } from "./caption-layout";
import type { CaptionFormatIssue } from "./scc";

/**
 * EBU-STL (EBU Tech 3264) subtitle export and import.
 *
 * A file is one 1024-byte GSI (General Subtitle Information) block followed by
 * 128-byte TTI (Text and Timing Information) blocks:
 *
 *   TTI: SGN(1) SN(2, little endian) EBN(1) CS(1) TCI(4) TCO(4) VP(1) JC(1) CF(1) TF(112)
 *
 * - GSI text fields use the code page named in `CPN` (850 by default; 437, 860,
 *   863 and 865 are also valid). Text fields (TF) use the character code table in
 *   `CCT` (00 = Latin, ISO 6937/2: accents are a diacritic byte 0xC1..0xCF followed
 *   by the base letter, `$` is 0xA4). Control bytes: 0x80/0x81 italics on/off,
 *   0x82/0x83 underline on/off, 0x84/0x85 boxing, 0x8A new row, 0x8F unused fill.
 * - Timecodes are four binary bytes HH MM SS FF. The frame base comes from the
 *   disk format code (STL25.01 or STL30.01); STL has no drop-frame.
 * - Text longer than 112 bytes continues in extension blocks (EBN 0,1,.. and the
 *   last block of a subtitle carries EBN 0xFF).
 *
 * Open subtitling (DSC "0") is written; teletext control codes are skipped on import.
 */

export type StlCodePage = "437" | "850" | "860" | "863" | "865";

export interface StlOptions {
  captionTrackId?: string;
  /** Real frame rate: 25 writes STL25.01, anything else STL30.01. Default 25. */
  frameRate?: number;
  /** Added to every time on export (the programme start), subtracted on import. */
  offsetSeconds?: number;
  /** Code page for the GSI text fields. Default 850. */
  codePage?: StlCodePage;
  /** Characters per row (MNC, max 40). */
  maxColumns?: number;
  /** Rows per subtitle. */
  maxRows?: number;
  /** Programme title (OPT). */
  title?: string;
  /** BCP-47 / ISO language ("en", "fr", ...) for the LC field. */
  language?: string;
  /** Creation date (CD/RD). */
  date?: Date;
}

export interface StlExportResult {
  bytes: Uint8Array;
  issues: CaptionFormatIssue[];
  cueCount: number;
  droppedCount: number;
  /** TTI blocks written (extension blocks included). */
  ttiBlocks: number;
}

export interface StlHeader {
  codePage: string;
  diskFormatCode: string;
  displayStandard: string;
  characterCodeTable: string;
  languageCode: string;
  programmeTitle: string;
  totalTtiBlocks: number;
  totalSubtitles: number;
  maxCharsPerRow: number;
  maxRows: number;
  frameBase: number;
}

export interface StlParseOptions {
  captionTrackId?: string;
  language?: string;
  /** Real frame rate; defaults to the file's frame base (25 or 30). */
  frameRate?: number;
  offsetSeconds?: number;
  styleTags?: "keep" | "strip";
}

export interface StlParseResult {
  subtitles: Subtitle[];
  errors: Array<{ line: number; message: string }>;
  issues: CaptionFormatIssue[];
  header: StlHeader | null;
  format: "stl";
}

const GSI_SIZE = 1024;
const TTI_SIZE = 128;
const TF_SIZE = 112;

// ---------------------------------------------------------------------------
// Code pages (GSI text) and ISO 6937 (TTI text)

/** High half (0x80..0xFF) of code page 850. */
const CP850_HIGH =
  "ÇüéâäàåçêëèïîìÄÅ" +
  "ÉæÆôöòûùÿÖÜø£Ø×ƒ" +
  "áíóúñÑªº¿®¬½¼¡«»" +
  "░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐" +
  "└┴┬├─┼ãÃ╚╔╩╦╠═╬¤" +
  "ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀" +
  "ÓßÔÒõÕµþÞÚÛÙýÝ¯´" +
  "­±‗¾¶§÷¸°¨·¹³²■ ";

/** High half of code page 437. */
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅ" +
  "ÉæÆôöòûùÿÖÜ¢£¥₧ƒ" +
  "áíóúñÑªº¿⌐¬½¼¡«»" +
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧" +
  "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "αßΓπΣσµτΦΘΩδ∞φε∩" +
  "≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

function codePageHigh(page: StlCodePage): string {
  // 860, 863 and 865 differ from 850/437 in a few positions only; GSI text is mostly ASCII, so
  // they are written with the 437 table (which they derive from) and decoded likewise.
  return page === "850" ? CP850_HIGH : CP437_HIGH;
}

function encodeGsiText(value: string, length: number, page: StlCodePage): Uint8Array {
  const high = codePageHigh(page);
  const out = new Uint8Array(length).fill(0x20);
  let i = 0;
  for (const ch of value) {
    if (i >= length) break;
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code < 0x7f) out[i++] = code;
    else {
      const at = high.indexOf(ch);
      out[i++] = at >= 0 ? 0x80 + at : 0x3f;
    }
  }
  return out;
}

function decodeGsiText(bytes: Uint8Array, page: string): string {
  const high = codePageHigh(page === "850" ? "850" : "437");
  let s = "";
  for (const b of bytes) s += b >= 0x80 ? high.charAt(b - 0x80) : b >= 0x20 ? String.fromCharCode(b) : " ";
  return s.replace(/\s+$/, "");
}

/** ISO 6937 upper half, byte -> character (diacritic prefixes are handled separately). */
const ISO6937_HIGH: ReadonlyMap<number, string> = new Map([
  [0xa1, "¡"], [0xa2, "¢"], [0xa3, "£"], [0xa4, "$"], [0xa5, "¥"], [0xa6, "#"], [0xa7, "§"], [0xa8, "¤"],
  [0xa9, "\u2018"], [0xaa, "\u201c"], [0xab, "«"], [0xac, "←"], [0xad, "↑"], [0xae, "→"], [0xaf, "↓"], [0xb0, "°"], [0xb1, "±"], [0xb2, "²"], [0xb3, "³"], [0xb4, "×"], [0xb5, "µ"], [0xb6, "¶"],
  [0xb7, "·"], [0xb8, "÷"], [0xb9, "\u2019"], [0xba, "\u201d"], [0xbb, "»"], [0xbc, "¼"], [0xbd, "½"], [0xbe, "¾"], [0xbf, "¿"],
  [0xd0, "\u2015"], [0xdc, "⅛"], [0xdd, "⅜"], [0xde, "⅝"], [0xdf, "⅞"],
  [0xe0, "Ω"], [0xe1, "Æ"], [0xe2, "Đ"], [0xe3, "ª"], [0xe4, "Ħ"], [0xe6, "Ĳ"], [0xe7, "Ŀ"], [0xe8, "Ł"],
  [0xe9, "Ø"], [0xea, "Œ"], [0xeb, "º"], [0xec, "Þ"], [0xed, "Ŧ"], [0xee, "Ŋ"], [0xef, "ŉ"], [0xf0, "ĸ"],
  [0xf1, "æ"], [0xf2, "đ"], [0xf3, "ð"], [0xf4, "ħ"], [0xf5, "ı"], [0xf6, "ĳ"], [0xf7, "ŀ"], [0xf8, "ł"],
  [0xf9, "ø"], [0xfa, "œ"], [0xfb, "ß"], [0xfc, "þ"], [0xfd, "ŧ"], [0xfe, "ŋ"],
]);

/** ISO 6937 diacritic prefix byte -> Unicode combining mark. */
const DIACRITICS: ReadonlyMap<number, string> = new Map([
  [0xc1, "̀"], [0xc2, "́"], [0xc3, "̂"], [0xc4, "̃"], [0xc5, "̄"], [0xc6, "̆"],
  [0xc7, "̇"], [0xc8, "̈"], [0xca, "̊"], [0xcb, "̧"], [0xcd, "̋"], [0xce, "̨"],
  [0xcf, "̌"],
]);
const MARK_TO_PREFIX: ReadonlyMap<string, number> = new Map([...DIACRITICS].map(([b, m]) => [m, b]));
const CHAR_TO_6937: ReadonlyMap<string, number> = new Map([...ISO6937_HIGH].map(([b, c]) => [c, b]));

/** Characters with a direct code that differ from their ASCII position. */
function encode6937(text: string, unsupported: Set<string>): number[] {
  const out: number[] = [];
  for (const ch of text) {
    if (ch === "$") out.push(0xa4);
    else if (ch === "¤") out.push(0x24);
    else if (ch === "#") out.push(0x23);
    else if (ch === " ") out.push(0x20);
    else if (ch === "­") out.push(0xff);
    else if (ch.length === 1 && ch >= " " && ch <= "~") out.push(ch.charCodeAt(0));
    else if (CHAR_TO_6937.has(ch)) out.push(CHAR_TO_6937.get(ch)!);
    else {
      const parts = ch.normalize("NFD");
      const base = parts.charAt(0);
      const mark = parts.slice(1);
      const prefix = mark.length === 1 ? MARK_TO_PREFIX.get(mark) : undefined;
      if (prefix !== undefined && /[A-Za-z]/.test(base)) out.push(prefix, base.charCodeAt(0));
      else {
        unsupported.add(ch);
        out.push(0x3f);
      }
    }
  }
  return out;
}

function decode6937(bytes: number[]): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (DIACRITICS.has(b) && i + 1 < bytes.length && bytes[i + 1] >= 0x20 && bytes[i + 1] < 0x7f) {
      s += (String.fromCharCode(bytes[i + 1]) + DIACRITICS.get(b)).normalize("NFC");
      i++;
    } else if (b === 0xa4) s += "$";
    else if (b === 0x24) s += "¤";
    else if (b === 0xff) s += "";
    else if (b >= 0x20 && b < 0x7f) s += String.fromCharCode(b);
    else if (ISO6937_HIGH.has(b)) s += ISO6937_HIGH.get(b);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Styled text

interface StyledCell {
  ch: string;
  i: boolean;
  u: boolean;
}

function parseStyledLines(text: string): StyledCell[][] {
  const lines: StyledCell[][] = [[]];
  let i = false;
  let u = false;
  const re = /<\/?(i|u|b|em|strong)\s*>|\r?\n|[^<\r\n]+|</gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tag = m[1]?.toLowerCase();
    if (tag) {
      const open = !m[0].startsWith("</");
      if (tag === "i" || tag === "em") i = open;
      else if (tag === "u") u = open;
    } else if (m[0] === "\n" || m[0] === "\r\n") lines.push([]);
    else for (const ch of m[0]) lines[lines.length - 1].push({ ch, i, u });
  }
  return lines;
}

function wrapRow(cells: StyledCell[], max: number): StyledCell[][] {
  const rows: StyledCell[][] = [];
  let rest = cells;
  while (rest.length) {
    while (rest.length && rest[0].ch === " ") rest = rest.slice(1);
    if (!rest.length) break;
    if (rest.length <= max) {
      rows.push(rest);
      break;
    }
    const space = rest.slice(0, max + 1).map((c) => c.ch).lastIndexOf(" ");
    const cut = space > 0 ? space : max;
    const row = rest.slice(0, cut);
    while (row.length && row[row.length - 1].ch === " ") row.pop();
    rows.push(row);
    rest = rest.slice(cut);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Time

/**
 * STL timecode labels are 25 or 30 frames per second. Seconds map to labels at the file's own base
 * so wall time is preserved (24, 50 and 60 fps timelines included); only NTSC 29.97 keeps its real
 * rate (non-drop labels drift against wall time, like any NDF timecode).
 */
export function stlTimecodeRate(fps: number | undefined, base: number): number {
  if (base === 30 && fps && Math.abs(fps - 30000 / 1001) < 0.01) return 30000 / 1001;
  return base;
}

function secondsToTci(seconds: number, fps: number, base: number): [number, number, number, number] {
  const frames = Math.max(0, Math.round(seconds * fps));
  const f = frames % base;
  const total = Math.floor(frames / base);
  return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60, f];
}

const tciToSeconds = (tc: ArrayLike<number>, fps: number, base: number): number =>
  ((tc[0] * 3600 + tc[1] * 60 + tc[2]) * base + tc[3]) / fps;

const LANGUAGE_CODES: Readonly<Record<string, string>> = {
  en: "09", fr: "0F", de: "08", es: "0A", it: "15",
};
const LANGUAGE_NAMES = Object.fromEntries(Object.entries(LANGUAGE_CODES).map(([k, v]) => [v, k]));

const pad = (n: number, width: number) => String(n).padStart(width, "0");

function ascii(value: string, length: number): Uint8Array {
  const out = new Uint8Array(length).fill(0x20);
  for (let i = 0; i < Math.min(length, value.length); i++) out[i] = value.charCodeAt(i) & 0x7f;
  return out;
}

// ---------------------------------------------------------------------------
// Export

export function encodeStl(subtitles: readonly Subtitle[], options: StlOptions = {}): StlExportResult {
  const issues: CaptionFormatIssue[] = [];
  const requestedFps = options.frameRate && options.frameRate > 0 ? options.frameRate : 25;
  const base = Math.round(requestedFps) === 25 || Math.round(requestedFps) === 50 ? 25 : 30;
  const fps = stlTimecodeRate(requestedFps, base);
  const maxColumns = Math.min(40, Math.max(8, Math.floor(options.maxColumns ?? 40)));
  const maxRows = Math.min(23, Math.max(1, Math.floor(options.maxRows ?? 4)));
  const offset = options.offsetSeconds ?? 0;
  const page = options.codePage ?? "850";

  const cues = subtitles
    .filter((c) => options.captionTrackId === undefined || (c.captionTrackId ?? "") === options.captionTrackId)
    .filter((c) => c.endTime > c.startTime && c.text.trim() !== "")
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);

  const tti: Uint8Array[] = [];
  let subtitleNumber = 0;
  let dropped = 0;
  let firstTci: [number, number, number, number] | null = null;

  for (const cue of cues) {
    const lines = parseStyledLines(cue.text)
      .map((line) => {
        let a = 0;
        let b = line.length;
        while (a < b && line[a].ch === " ") a++;
        while (b > a && line[b - 1].ch === " ") b--;
        return line.slice(a, b);
      })
      .filter((line) => line.length);
    if (!lines.length) {
      dropped++;
      continue;
    }
    let rows = lines.flatMap((line) => wrapRow(line, maxColumns));
    if (rows.length > lines.length)
      issues.push({ severity: "warning", code: "stl-line-wrapped", cueId: cue.id, message: `A line was longer than ${maxColumns} characters and was wrapped.` });
    if (rows.length > maxRows) {
      issues.push({ severity: "error", code: "stl-too-many-lines", cueId: cue.id, message: `Subtitle has ${rows.length} rows; only ${maxRows} were written.` });
      rows = rows.slice(0, maxRows);
    }

    const unsupported = new Set<string>();
    const bytes: number[] = [];
    let italic = false;
    let underline = false;
    rows.forEach((row, index) => {
      if (index > 0) bytes.push(0x8a);
      for (const cell of row) {
        if (cell.i !== italic) bytes.push(cell.i ? 0x80 : 0x81);
        if (cell.u !== underline) bytes.push(cell.u ? 0x82 : 0x83);
        italic = cell.i;
        underline = cell.u;
        bytes.push(...encode6937(cell.ch, unsupported));
      }
      // Attributes end with the row.
      if (italic) bytes.push(0x81);
      if (underline) bytes.push(0x83);
      italic = false;
      underline = false;
    });
    if (unsupported.size)
      issues.push({ severity: "warning", code: "stl-unsupported-char", cueId: cue.id, message: `Characters not available in ISO 6937 were replaced with "?": ${[...unsupported].join(" ")}` });

    const tci = secondsToTci(cue.startTime + offset, fps, base);
    const tco = secondsToTci(cue.endTime + offset, fps, base);
    firstTci ??= tci;
    const verticalPosition = Math.max(1, 23 - rows.length);
    const blocks = Math.max(1, Math.ceil(bytes.length / TF_SIZE));
    if (blocks > 1) issues.push({ severity: "info", code: "stl-extension-blocks", cueId: cue.id, message: `Subtitle needs ${blocks} TTI blocks (extension blocks).` });
    for (let b = 0; b < blocks; b++) {
      const block = new Uint8Array(TTI_SIZE);
      block[0] = 0; // SGN
      block[1] = subtitleNumber & 0xff;
      block[2] = (subtitleNumber >> 8) & 0xff;
      block[3] = b === blocks - 1 ? 0xff : b; // EBN
      block[4] = 0; // CS: not cumulative
      block.set(tci, 5);
      block.set(tco, 9);
      block[13] = verticalPosition;
      block[14] = 2; // JC: centred
      block[15] = 0; // CF: subtitle data
      block.fill(0x8f, 16);
      block.set(bytes.slice(b * TF_SIZE, (b + 1) * TF_SIZE), 16);
      tti.push(block);
    }
    subtitleNumber++;
  }

  const gsi = new Uint8Array(GSI_SIZE).fill(0x20);
  const put = (offsetBytes: number, data: Uint8Array) => gsi.set(data, offsetBytes);
  const date = options.date ?? new Date();
  const yymmdd = `${pad(date.getFullYear() % 100, 2)}${pad(date.getMonth() + 1, 2)}${pad(date.getDate(), 2)}`;
  const tcp = (t: number[] | [number, number, number, number]) => t.map((n) => pad(n, 2)).join("");
  put(0, ascii(page, 3));
  put(3, ascii(`STL${base}.01`, 8));
  put(11, ascii("0", 1)); // DSC: open subtitling
  put(12, ascii("00", 2)); // CCT: Latin
  put(14, ascii(LANGUAGE_CODES[(options.language ?? "en").slice(0, 2).toLowerCase()] ?? "00", 2));
  put(16, encodeGsiText(options.title ?? "", 32, page));
  put(224, ascii(yymmdd, 6));
  put(230, ascii(yymmdd, 6));
  put(236, ascii("01", 2));
  put(238, ascii(pad(tti.length, 5), 5));
  put(243, ascii(pad(subtitleNumber, 5), 5));
  put(248, ascii("001", 3));
  put(251, ascii(pad(maxColumns, 2), 2));
  put(253, ascii("23", 2));
  put(255, ascii("1", 1)); // TCS
  put(256, ascii(tcp(secondsToTci(offset, fps, base)), 8));
  put(264, ascii(firstTci ? tcp(firstTci) : "00000000", 8));
  put(272, ascii("1", 1));
  put(273, ascii("1", 1));

  const bytes = new Uint8Array(GSI_SIZE + tti.length * TTI_SIZE);
  bytes.set(gsi, 0);
  tti.forEach((block, index) => bytes.set(block, GSI_SIZE + index * TTI_SIZE));
  return { bytes, issues, cueCount: subtitleNumber, droppedCount: dropped, ttiBlocks: tti.length };
}

export const exportStl = (subtitles: readonly Subtitle[], options: StlOptions = {}): Uint8Array =>
  encodeStl(subtitles, options).bytes;

// ---------------------------------------------------------------------------
// Import

export function isStlContent(bytes: Uint8Array): boolean {
  if (bytes.length < GSI_SIZE) return false;
  const dfc = String.fromCharCode(...bytes.slice(3, 11));
  return /^STL\d\d\.\d\d$/.test(dfc);
}

let stlCounter = 0;

export function parseStl(bytes: Uint8Array, options: StlParseOptions = {}): StlParseResult {
  const errors: StlParseResult["errors"] = [];
  const issues: CaptionFormatIssue[] = [];
  if (!isStlContent(bytes)) {
    errors.push({ line: 0, message: "Not an EBU-STL file (the GSI block is missing or the disk format code is not STLnn.01)." });
    return { subtitles: [], errors, issues, header: null, format: "stl" };
  }
  const field = (at: number, len: number) => String.fromCharCode(...bytes.slice(at, at + len));
  const codePage = field(0, 3).trim();
  const dfc = field(3, 8);
  const frameBase = Number(dfc.slice(3, 5)) || 25;
  const header: StlHeader = {
    codePage,
    diskFormatCode: dfc,
    displayStandard: field(11, 1),
    characterCodeTable: field(12, 2),
    languageCode: field(14, 2),
    programmeTitle: decodeGsiText(bytes.slice(16, 48), codePage),
    totalTtiBlocks: Number(field(238, 5)) || 0,
    totalSubtitles: Number(field(243, 5)) || 0,
    maxCharsPerRow: Number(field(251, 2)) || 0,
    maxRows: Number(field(253, 2)) || 0,
    frameBase,
  };
  if (!["00", "01", "02", "03", "04"].includes(header.characterCodeTable))
    issues.push({ severity: "warning", code: "stl-cct", message: `Character code table ${header.characterCodeTable} is not one of 00 (Latin) to 04 (Hebrew); text was read as ISO 6937.` });
  if (frameBase !== 25 && frameBase !== 30)
    issues.push({ severity: "warning", code: "stl-frame-base", message: `Unusual frame base ${frameBase}.` });
  const fps = stlTimecodeRate(options.frameRate, frameBase);
  const offset = options.offsetSeconds ?? 0;
  const keepTags = options.styleTags === "keep";

  const available = Math.floor((bytes.length - GSI_SIZE) / TTI_SIZE);
  if ((bytes.length - GSI_SIZE) % TTI_SIZE !== 0)
    issues.push({ severity: "warning", code: "stl-trailing", message: "The file has trailing bytes after the last whole TTI block; they were ignored." });
  if (header.totalTtiBlocks && header.totalTtiBlocks !== available)
    issues.push({ severity: "warning", code: "stl-block-count", message: `GSI says ${header.totalTtiBlocks} TTI blocks but the file holds ${available}.` });

  const subtitles: Subtitle[] = [];
  let pendingBytes: number[] = [];
  let startTc: number[] | null = null;
  let endTc: number[] | null = null;
  let cumulative: string[] = [];
  let pendingCs = 0;
  let pendingVp = 0;
  let pendingJc = 0;
  let userBlocks = 0;
  let commentBlocks = 0;
  const tally = { colouredCues: 0, mixedColourCues: 0, doubleHeight: 0, boxing: 0, mosaic: 0, positioned: 0, justified: 0 };
  // Rows the vertical positions are relative to: teletext displays have 23 usable rows; open subtitling uses the GSI's maximum.
  const teletext = header.displayStandard === "1" || header.displayStandard === "2";
  const maxVp = (() => {
    let m = 0;
    for (let n = 0; n < available; n++) m = Math.max(m, bytes[GSI_SIZE + n * TTI_SIZE + 13] || 0);
    return m;
  })();
  const gridRows = teletext ? 23 : Math.max(header.maxRows, maxVp, 1);

  const flush = () => {
    if (!startTc || !endTc) return;
    const info: TextInfo = { colours: [], distinct: new Set(), doubleHeight: false, boxing: false, mosaic: false };
    const raw = decodeText(pendingBytes, keepTags, header.characterCodeTable, info, teletext);
    pendingBytes = [];
    if (!raw) return;
    const text = pendingCs === 2 || pendingCs === 3 ? [...cumulative, raw].join("\n") : raw;
    if (pendingCs === 1) cumulative = [raw];
    else if (pendingCs === 2) cumulative = [...cumulative, raw];
    else if (pendingCs === 3) cumulative = [];
    const start = tciToSeconds(startTc, fps, frameBase) - offset;
    const end = tciToSeconds(endTc, fps, frameBase) - offset;
    if (!(end > start)) {
      issues.push({ severity: "warning", code: "stl-empty-duration", message: `A subtitle at ${startTc.join(":")} ends before it starts and was skipped.` });
      return;
    }
    if (info.doubleHeight) tally.doubleHeight++;
    if (info.boxing) tally.boxing++;
    if (info.mosaic) tally.mosaic++;
    let style: SubtitleStyle | undefined;
    if (info.colours.length) {
      tally.colouredCues++;
      if (info.distinct.size > 1) tally.mixedColourCues++;
      style = { ...DEFAULT_CAPTION_STYLE, color: STL_TELETEXT_COLOURS[info.colours[0]] };
    }
    const cueSettings = stlCueSettings(pendingVp, pendingJc, text.split("\n").length, gridRows);
    if (cueSettings) {
      if (cueSettings.line !== undefined) tally.positioned++;
      if (cueSettings.align && cueSettings.align !== "center") tally.justified++;
    }
    subtitles.push({
      id: `stl-${Date.now().toString(36)}-${(stlCounter++).toString(36)}`,
      text,
      startTime: start,
      endTime: end,
      ...(style ? { style } : {}),
      ...(cueSettings ? { cueSettings } : {}),
      ...(options.language ? { language: options.language } : {}),
      ...(options.captionTrackId ? { captionTrackId: options.captionTrackId } : {}),
    });
  };

  for (let n = 0; n < available; n++) {
    const at = GSI_SIZE + n * TTI_SIZE;
    const ebn = bytes[at + 3];
    const cf = bytes[at + 15];
    if (ebn >= 0xf0 && ebn !== 0xff) {
      // EBN 0xF0..0xFE: reserved and user-data blocks carry no subtitle text.
      userBlocks++;
      continue;
    }
    if (cf !== 0) {
      // CF 00h is subtitle data; 01h..FFh marks a comment that is not meant for transmission.
      commentBlocks++;
      if (ebn === 0xff) pendingBytes = [];
      continue;
    }
    if (pendingBytes.length === 0) {
      startTc = [bytes[at + 5], bytes[at + 6], bytes[at + 7], bytes[at + 8]];
      endTc = [bytes[at + 9], bytes[at + 10], bytes[at + 11], bytes[at + 12]];
      pendingCs = bytes[at + 4];
      pendingVp = bytes[at + 13];
      pendingJc = bytes[at + 14];
    }
    for (let k = 0; k < TF_SIZE; k++) pendingBytes.push(bytes[at + 16 + k]);
    if (ebn === 0xff || ebn > 0xef) flush();
  }
  if (pendingBytes.length) flush();
  const n = (count: number, what: string) => `${count} subtitle${count === 1 ? "" : "s"} ${what}`;
  if (tally.mixedColourCues)
    issues.push({ severity: "warning", code: "stl-colours-mixed", message: `${n(tally.mixedColourCues, "changed teletext colour inside the subtitle")}; each takes its first colour for all of its text.` });
  if (tally.doubleHeight)
    issues.push({ severity: "info", code: "stl-double-height", message: `${n(tally.doubleHeight, "used double-height or double-width teletext characters")}; they are shown at normal size.` });
  if (tally.boxing)
    issues.push({ severity: "info", code: "stl-boxing", message: `${n(tally.boxing, "used teletext boxes or background colour codes")}; the caption background is the default one.` });
  if (tally.mosaic)
    issues.push({ severity: "warning", code: "stl-mosaic", message: `${n(tally.mosaic, "contained teletext mosaic graphics")}; the graphics were dropped.` });
  if (tally.positioned)
    issues.push({ severity: "info", code: "stl-positioned", message: `${n(tally.positioned, "sat away from the bottom of the picture")}; the EBU row number is mapped to an approximate vertical position (${gridRows} rows).` });
  if (commentBlocks)
    issues.push({ severity: "info", code: "stl-comments", message: `${commentBlocks} comment block${commentBlocks === 1 ? " was" : "s were"} not imported (the comment flag marks text that is not meant for transmission).` });
  if (userBlocks)
    issues.push({ severity: "info", code: "stl-user-data", message: `${userBlocks} user-data block${userBlocks === 1 ? " was" : "s were"} ignored.` });
  subtitles.sort((a, b) => a.startTime - b.startTime);
  if (options.offsetSeconds === undefined && subtitles.length && subtitles[0].startTime >= 3600)
    issues.push({
      severity: "warning",
      code: "stl-programme-start",
      message: `The first subtitle starts at ${Math.floor(subtitles[0].startTime / 3600)} h of file time (the file's programme start is ${field(256, 8).replace(/(..)(..)(..)(..)/, "$1:$2:$3:$4")}); it was imported at that time. Import it with a programme start offset to move it to the start of the project.`,
    });
  return { subtitles, errors, issues, header, format: "stl" };
}


/** EBU vertical position (row, 1 = top) and justification code -> WebVTT cue settings. Bottom, centred subtitles map to nothing. */
function stlCueSettings(vp: number, jc: number, lineCount: number, rows: number): CueSettings | undefined {
  const bottomRow = vp + Math.max(1, lineCount) - 1;
  const atBottom = vp === 0 || bottomRow >= rows - 3;
  const out: { -readonly [K in keyof CueSettings]: CueSettings[K] } = {};
  if (!atBottom) {
    out.line = Math.round((Math.max(0, vp - 1) / rows) * 1000) / 10;
    out.snapToLines = false;
    out.lineAlign = "start";
  }
  if (jc === 1) Object.assign(out, { position: 10, positionAlign: "line-left", size: 80, align: "left" });
  else if (jc === 3) Object.assign(out, { position: 90, positionAlign: "line-right", size: 80, align: "right" });
  else if (out.line !== undefined) Object.assign(out, { position: 50, positionAlign: "center", size: 80, align: "center" });
  return Object.keys(out).length ? out : undefined;
}

interface TextInfo {
  /** Teletext alpha colours used by text (0 black .. 7 white); white is omitted. */
  colours: number[];
  /** Every colour (white included) that visible text was set in. */
  distinct: Set<number>;
  doubleHeight: boolean;
  boxing: boolean;
  mosaic: boolean;
}

const CCT_CHARSETS: Record<string, string> = { "01": "iso-8859-5", "02": "iso-8859-6", "03": "iso-8859-7", "04": "iso-8859-8" };

/** Text bytes -> string through ISO 6937 (code table 00) or the ISO 8859 part the GSI selects (01..04). */
function decodeBytes(bytes: number[], cct: string): string {
  const charset = CCT_CHARSETS[cct];
  if (charset && bytes.some((b) => b >= 0xa0)) {
    try {
      return new TextDecoder(charset).decode(Uint8Array.from(bytes.filter((b) => b !== 0xff)));
    } catch {
      /* the runtime lacks this charset: fall through */
    }
  }
  return decode6937(bytes);
}

export const STL_TELETEXT_COLOURS = ["#000000", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff"] as const;

function decodeText(field: number[], keepTags: boolean, cct: string, info: TextInfo, teletext = false): string {
  let result = "";
  let current: number[] = [];
  let colour = 7;
  const flush = () => {
    const piece = decodeBytes(current, cct);
    if (piece.trim()) info.distinct.add(colour);
    if (piece.trim() && colour !== 7 && !info.colours.includes(colour)) info.colours.push(colour);
    result += piece;
    current = [];
  };
  const mark = (tag: string) => {
    if (!keepTags) return;
    flush();
    result += tag;
  };
  let italic = false;
  let underline = false;
  for (const b of field) {
    if (b === 0x8f) break;
    if (b === 0x8a) {
      flush();
      result += "\n";
      // Teletext rows start white again.
      if (teletext) colour = 7;
    } else if (b === 0x80) {
      if (!italic) mark("<i>");
      italic = true;
    } else if (b === 0x81) {
      if (italic) mark("</i>");
      italic = false;
    } else if (b === 0x82) {
      if (!underline) mark("<u>");
      underline = true;
    } else if (b === 0x83) {
      if (underline) mark("</u>");
      underline = false;
    } else if (b < 0x20 || (b >= 0x84 && b <= 0x9f)) {
      // Teletext colour / size / box controls: colours map to the cue colour, the rest is reported.
      flush();
      if (b <= 0x07) colour = b;
      else if (b >= 0x10 && b <= 0x17) info.mosaic = true;
      else if (b === 0x0d || b === 0x0e || b === 0x0f) info.doubleHeight = true;
      else if (b === 0x0a || b === 0x0b || b === 0x1c || b === 0x1d || b === 0x84 || b === 0x85) info.boxing = true;
    } else current.push(b);
  }
  flush();
  return result
    .split("\n")
    .map((line) =>
      line
        .replace(/(\s+)<\/(i|u)>/g, "</$2>$1")
        .replace(/<(i|u)>(\s+)/g, "$2<$1>")
        .trim(),
    )
    .filter((line) => line.replace(/<\/?[iu]>/g, "") !== "")
    .join("\n");
}

export const stlLanguageOf = (header: StlHeader): string | undefined => LANGUAGE_NAMES[header.languageCode];
