import { BASIC_OVERRIDES, COLS, EXTENDED_12, EXTENDED_13, PAC_FIRST_ROW, ROWS, SPECIAL, hasOddParity } from "./cea608-tables";
import type { CaptionFormatIssue } from "./scc";
import type { CueSettings, Subtitle, SubtitleStyle } from "../types/timeline";
import { DEFAULT_CAPTION_STYLE } from "./caption-layout";

/**
 * A CEA-608 caption decoder shared by the SCC and MCC importers. It decodes one of the four caption
 * channels (CC1/CC2 on field 1, CC3/CC4 on field 2) from byte pairs: pop-on, paint-on and roll-up
 * (RU2/3/4), special and extended characters, mid-row and PAC styles, rows, indents and colours.
 * Everything it cannot carry into the caption model is counted, and `issues()` turns the counts into
 * a readable report so nothing is dropped silently.
 */

export type Cc = 1 | 2 | 3 | 4;

export interface Cea608Line {
  /** 1..15 */
  row: number;
  /** first and last printed column, 0..31 */
  startCol: number;
  endCol: number;
}

export interface Cea608Cue {
  text: string;
  start: number;
  end: number;
  lines: Cea608Line[];
  /** CEA-608 colour codes used by text in the cue (0 white .. 6 magenta); white is omitted. */
  colours: number[];
  mode: "pop" | "roll" | "paint";
}

interface GridCell {
  ch: string;
  i: boolean;
  u: boolean;
  c: number;
}
type Grid = Array<Array<GridCell | null>>;
const newGrid = (): Grid => Array.from({ length: ROWS }, () => Array<GridCell | null>(COLS).fill(null));
const gridEmpty = (g: Grid): boolean => g.every((row) => row.every((c) => c === null || c.ch === " "));

function rowText(row: Array<GridCell | null>, keepTags: boolean): string {
  let s = "";
  let i = false;
  let u = false;
  const cells = row.map((c) => c ?? { ch: " ", i: false, u: false, c: 0 });
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

export const CEA608_COLOURS = ["#ffffff", "#00ff00", "#0000ff", "#00ffff", "#ff0000", "#ffff00", "#ff00ff"] as const;
export const CEA608_COLOUR_NAMES = ["white", "green", "blue", "cyan", "red", "yellow", "magenta"] as const;

export interface Cea608DecoderOptions {
  /** Which caption channel to decode (default CC1). */
  channel?: Cc;
  keepTags?: boolean;
}

export class Cea608Decoder {
  readonly cues: Cea608Cue[] = [];
  readonly channel: Cc;
  /** Pairs that failed the odd-parity check. */
  parityErrors = 0;
  /** Printable character pairs seen on channels that were not decoded, by CC number. */
  readonly otherChannelPairs = new Map<number, number>();
  /** Counts of things the caption model cannot carry. */
  readonly dropped = { flash: 0, background: 0, textService: 0, xds: 0, mixedColourCues: 0, rowGapCues: 0 };
  /** Whether any caption data (control or character) was decoded for the chosen channel. */
  sawData = false;

  private readonly keepTags: boolean;
  private readonly targetField: 1 | 2;
  private readonly targetCh: 1 | 2;
  private disp = newGrid();
  private hidden = newGrid();
  private mode: "none" | "pop" | "roll" | "paint" = "none";
  private depth = 2;
  private baseRow = 15;
  private row = 15;
  private col = 0;
  private curI = false;
  private curU = false;
  private curC = 0;
  private shownSince: number | null = null;
  private lastControl = "";
  private lastTime = 0;
  private textMode = false;
  private xds: Record<1 | 2, boolean> = { 1: false, 2: false };
  private active: Record<1 | 2, 1 | 2> = { 1: 1, 2: 1 };
  private shownMode: "pop" | "roll" | "paint" = "pop";

  constructor(options: Cea608DecoderOptions = {}) {
    this.channel = options.channel ?? 1;
    this.keepTags = options.keepTags === true;
    this.targetField = this.channel <= 2 ? 1 : 2;
    this.targetCh = this.channel % 2 === 1 ? 1 : 2;
  }

  /** True when the decoder has an open (displayed, not yet cleared) caption. */
  get open(): boolean {
    return this.shownSince !== null;
  }

  get time(): number {
    return this.lastTime;
  }

  /** Feed one byte pair (with parity) from `field` at time `t` seconds. */
  feed(raw1: number, raw2: number, t: number, field: 1 | 2 = 1): void {
    if (!hasOddParity(raw1) || !hasOddParity(raw2)) {
      // A pair of nulls (0x00 / 0x80 padding) is not an error; anything else with bad parity is.
      if (!((raw1 & 0x7f) === 0 && (raw2 & 0x7f) === 0)) this.parityErrors++;
    }
    const b1 = raw1 & 0x7f;
    const b2 = raw2 & 0x7f;
    this.lastTime = t;
    if (b1 === 0 && b2 === 0) return;

    const control = b1 >= 0x10 && b1 <= 0x1f;
    const isMisc = (b1 === 0x14 || b1 === 0x15 || b1 === 0x1c || b1 === 0x1d) && b2 >= 0x20 && b2 <= 0x2f;
    // Field 2 miscellaneous control codes use 0x15 / 0x1d even inside a field 1 stream (SCC).
    const pairField: 1 | 2 = isMisc && (b1 === 0x15 || b1 === 0x1d) ? 2 : field;
    const pairCh: 1 | 2 = (b1 & 0x08) !== 0 ? 2 : 1;
    if (control) this.active[pairField] = pairCh;

    // XDS (extended data service) packets: b1 0x01..0x0f starts or continues one, 0x0f ends it. Counted, never decoded.
    if (!control && b1 >= 0x01 && b1 <= 0x0f) {
      this.xds[pairField] = b1 !== 0x0f;
      this.dropped.xds++;
      return;
    }
    if (!control && this.xds[pairField]) {
      this.dropped.xds++;
      return;
    }
    if (control) this.xds[pairField] = false;

    if (pairField !== this.targetField) {
      if (!control && b1 >= 0x20) this.countOther(pairField);
      return;
    }
    if (control) {
      if (pairCh !== this.targetCh) return;
    } else if (this.active[pairField] !== this.targetCh) {
      this.countOther(pairField);
      return;
    }
    this.sawData = true;

    if (control) {
      const isTab = (b1 === 0x17 || b1 === 0x1f) && b2 >= 0x21 && b2 <= 0x23;
      const isPac = b2 >= 0x40 && b2 <= 0x7f;
      const isMid = (b1 === 0x11 || b1 === 0x19) && b2 >= 0x20 && b2 <= 0x2f;
      const isSpecial = (b1 === 0x11 || b1 === 0x19) && b2 >= 0x30 && b2 <= 0x3f;
      const isExt = (b1 === 0x12 || b1 === 0x13 || b1 === 0x1a || b1 === 0x1b) && b2 >= 0x20 && b2 <= 0x3f;
      const isBackground = (b1 === 0x10 || b1 === 0x18) && b2 >= 0x20 && b2 <= 0x2f;
      const key = `${b1}:${b2}`;
      if (isMisc || isTab || isPac || isMid || isBackground) {
        // Control codes (mid-row codes included, as in other decoders) are sent twice; the second is ignored.
        if (this.lastControl === key) {
          this.lastControl = "";
          return;
        }
        this.lastControl = key;
      } else this.lastControl = "";

      if (isMisc) this.misc(b2, t);
      else if (this.textMode) this.dropped.textService++;
      else if (isTab) this.col = Math.min(COLS - 1, this.col + (b2 - 0x20));
      else if (isPac) this.pac(b1, b2);
      else if (isMid) {
        const attr = (b2 >> 1) & 0x07;
        // The code occupies a (blank) cell that keeps the outgoing style for text extraction.
        this.put(" ", t, { i: this.curI, u: this.curU, c: this.curC });
        this.curI = attr === 7;
        this.curC = attr === 7 ? this.curC : attr;
        this.curU = (b2 & 1) === 1;
      } else if (isBackground) this.dropped.background++;
      else if (isSpecial) this.put(SPECIAL[b2 - 0x30], t);
      else if (isExt) {
        const set = b1 === 0x12 || b1 === 0x1a ? EXTENDED_12 : EXTENDED_13;
        if (this.col > 0) this.col--;
        this.put(set[b2 - 0x20], t);
      }
      return;
    }
    this.lastControl = "";
    if (this.textMode) {
      this.dropped.textService++;
      return;
    }
    for (const b of [b1, b2]) {
      if (b < 0x20) continue;
      this.put(BASIC_OVERRIDES.get(b) ?? String.fromCharCode(b), t);
    }
  }

  /** Close the stream: a caption still on screen gets `endTime`. Returns whether one was open. */
  finish(endTime: number): boolean {
    if (this.shownSince === null) return false;
    this.commit(endTime);
    return true;
  }

  private countOther(field: 1 | 2, ch: 1 | 2 = this.active[field]): void {
    const cc = (field - 1) * 2 + ch;
    this.otherChannelPairs.set(cc, (this.otherChannelPairs.get(cc) ?? 0) + 1);
  }

  private commit(end: number): void {
    if (this.shownSince === null) return;
    const body = this.gridText();
    if (body && end > this.shownSince + 1e-9) {
      const lines: Cea608Line[] = [];
      const colours: number[] = [];
      this.disp.forEach((cells, r) => {
        let first = -1;
        let last = -1;
        cells.forEach((cell, c) => {
          if (cell && cell.ch !== " ") {
            if (first < 0) first = c;
            last = c;
            if (cell.c !== 0 && !colours.includes(cell.c)) colours.push(cell.c);
          }
        });
        if (first >= 0) lines.push({ row: r + 1, startCol: first, endCol: last });
      });
      if (colours.length > 1) this.dropped.mixedColourCues++;
      if (lines.some((l, k) => k > 0 && l.row !== lines[k - 1].row + 1)) this.dropped.rowGapCues++;
      this.cues.push({ text: body, start: this.shownSince, end, lines, colours, mode: this.shownMode });
    }
    this.shownSince = null;
  }

  private gridText(): string {
    return this.disp
      .map((row) => rowText(row, this.keepTags))
      .filter((t) => t !== "")
      .join("\n");
  }

  private markShown(t: number): void {
    if (this.shownSince === null && !gridEmpty(this.disp)) {
      this.shownSince = t;
      this.shownMode = this.mode === "none" ? "pop" : this.mode;
    }
  }

  private target(): Grid {
    return this.mode === "pop" ? this.hidden : this.disp;
  }

  private put(ch: string, t: number, style?: { i: boolean; u: boolean; c: number }): void {
    const grid = this.target();
    if (this.row < 1 || this.row > ROWS) return;
    const c = Math.min(this.col, COLS - 1);
    grid[this.row - 1][c] = { ch, i: style?.i ?? this.curI, u: style?.u ?? this.curU, c: style?.c ?? this.curC };
    this.col = Math.min(this.col + 1, COLS);
    if (grid === this.disp) this.markShown(t);
  }

  private rollUp(t: number): void {
    this.commit(t);
    const top = Math.max(1, this.baseRow - this.depth + 1);
    for (let r = top; r < this.baseRow; r++) this.disp[r - 1] = this.disp[r];
    this.disp[this.baseRow - 1] = Array<GridCell | null>(COLS).fill(null);
    this.col = 0;
    this.curI = false;
    this.curU = false;
    this.curC = 0;
    if (!gridEmpty(this.disp)) {
      this.shownSince = t;
      this.shownMode = "roll";
    }
  }

  private misc(b2: number, t: number): void {
    switch (b2) {
      case 0x20: // RCL
        this.textMode = false;
        this.mode = "pop";
        break;
      case 0x21: // BS
        if (this.col > 0) {
          this.col--;
          this.target()[this.row - 1][this.col] = null;
        }
        break;
      case 0x24: // DER
        for (let c = this.col; c < COLS; c++) this.target()[this.row - 1][c] = null;
        break;
      case 0x25:
      case 0x26:
      case 0x27: {
        // RU2..RU4
        this.textMode = false;
        const d = b2 - 0x23;
        if (this.mode !== "roll") {
          this.commit(t);
          this.disp = newGrid();
          this.hidden = newGrid();
          this.baseRow = 15;
          this.row = 15;
          this.col = 0;
        }
        this.mode = "roll";
        this.depth = d;
        if (this.baseRow < this.depth) this.baseRow = this.depth;
        break;
      }
      case 0x28: // FON
        this.dropped.flash++;
        break;
      case 0x29: // RDC
        this.textMode = false;
        this.mode = "paint";
        break;
      case 0x2a: // TR
      case 0x2b: // RTD
        this.textMode = true;
        this.dropped.textService++;
        break;
      case 0x2c: // EDM
        this.commit(t);
        this.disp = newGrid();
        break;
      case 0x2d: // CR
        if (this.textMode) this.dropped.textService++;
        else if (this.mode === "roll") this.rollUp(t);
        break;
      case 0x2e: // ENM
        this.hidden = newGrid();
        break;
      case 0x2f: // EOC
        this.textMode = false;
        this.commit(t);
        [this.disp, this.hidden] = [this.hidden, this.disp];
        this.mode = "pop";
        if (!gridEmpty(this.disp)) {
          this.shownSince = t;
          this.shownMode = "pop";
        }
        break;
      default:
        break;
    }
  }

  private pac(b1: number, b2: number): void {
    const base = PAC_FIRST_ROW[b1 & 0x17];
    if (base === undefined) return;
    const pacRow = (b1 & 0x17) === 0x10 ? 11 : base + (b2 >= 0x60 ? 1 : 0);
    const attr = (b2 >> 1) & 0x0f;
    if (this.mode === "roll") {
      this.baseRow = Math.max(pacRow, this.depth);
      this.row = this.baseRow;
    } else this.row = pacRow;
    this.curU = (b2 & 1) === 1;
    this.curI = attr === 7;
    this.curC = attr < 7 ? attr : 0;
    this.col = attr >= 8 ? (attr - 8) * 4 : 0;
  }

  /** Notes about everything the chosen channel carried that the caption model cannot hold. */
  issues(label = "CEA-608"): CaptionFormatIssue[] {
    const out: CaptionFormatIssue[] = [];
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    if (this.parityErrors)
      out.push({ severity: "warning", code: "scc-parity", message: `${plural(this.parityErrors, "byte")} had wrong (non-odd) parity.` });
    for (const [cc, pairs] of [...this.otherChannelPairs].sort((a, b) => a[0] - b[0])) {
      if (cc === this.channel || pairs === 0) continue;
      out.push({
        severity: "warning",
        code: "cc-other-channel",
        message: `${label} data for CC${cc} (${plural(pairs, "byte pair")}) was not imported; this import read CC${this.channel}. Import again with caption channel ${cc} to read it.`,
      });
    }
    if (this.dropped.textService)
      out.push({ severity: "warning", code: "cc-text-service", message: `${plural(this.dropped.textService, "byte pair")} of the CEA-608 Text service (T${this.channel}) were ignored: text mode is not caption data.` });
    if (this.dropped.xds)
      out.push({ severity: "info", code: "cc-xds", message: `${plural(this.dropped.xds, "byte pair")} of XDS (extended data service) metadata were ignored.` });
    if (this.dropped.flash)
      out.push({ severity: "info", code: "cc-flash", message: `${plural(this.dropped.flash, "flash-on code")} were ignored: flashing text is shown steady.` });
    if (this.dropped.background)
      out.push({ severity: "info", code: "cc-background", message: `${plural(this.dropped.background, "background colour code")} were ignored: captions use the default caption background.` });
    if (this.dropped.mixedColourCues)
      out.push({ severity: "warning", code: "cc-colours-mixed", message: `${plural(this.dropped.mixedColourCues, "caption")} mixed text colours; each one takes its first colour for the whole caption.` });
    if (this.dropped.rowGapCues)
      out.push({ severity: "info", code: "cc-row-gaps", message: `${plural(this.dropped.rowGapCues, "caption")} had blank rows between lines; the lines were joined.` });
    return out;
  }
}

// ---------------------------------------------------------------------------
// Placement and colour -> caption model

/** The 608 grid sits inside an 80 % wide and high title-safe area (10 % margins). */
const SAFE_MARGIN = 10;
const SAFE_SPAN = 80;

export interface Cea608Mapped {
  cueSettings?: CueSettings;
  style?: SubtitleStyle;
  /** The lines had different indents and were aligned to one edge. */
  mixedIndent: boolean;
}

/** Row / indent -> WebVTT cue settings (percent of the frame), colour -> cue colour. Plain bottom-centre captions map to nothing (the track default). */
export function mapCea608Cue(cue: Cea608Cue): Cea608Mapped {
  const lines = cue.lines;
  const colour = cue.colours.length ? CEA608_COLOURS[cue.colours[0]] : undefined;
  const style: SubtitleStyle | undefined = colour ? { ...DEFAULT_CAPTION_STYLE, color: colour } : undefined;
  if (!lines.length) return { ...(style ? { style } : {}), mixedIndent: false };

  const centres = lines.map((l) => (l.startCol + l.endCol + 1) / 2);
  const centred = centres.every((c) => Math.abs(c - COLS / 2) <= 1.5);
  const sameStart = lines.every((l) => l.startCol === lines[0].startCol);
  const lastRow = lines[lines.length - 1].row;
  const bottomCentre = centred && lastRow >= 13;
  if (bottomCentre) return { ...(style ? { style } : {}), mixedIndent: false };

  const firstRow = lines[0].row;
  const lineTop = SAFE_MARGIN + ((firstRow - 1) * SAFE_SPAN) / ROWS;
  const round = (n: number) => Math.round(n * 10) / 10;
  if (centred) {
    return {
      cueSettings: { line: round(lineTop), snapToLines: false, lineAlign: "start", position: 50, positionAlign: "center", size: SAFE_SPAN, align: "center" },
      ...(style ? { style } : {}),
      mixedIndent: false,
    };
  }
  const left = Math.min(...lines.map((l) => l.startCol));
  const position = round(SAFE_MARGIN + (left * SAFE_SPAN) / COLS);
  return {
    cueSettings: {
      line: round(lineTop),
      snapToLines: false,
      lineAlign: "start",
      position,
      positionAlign: "line-left",
      size: Math.max(20, round(100 - SAFE_MARGIN - position)),
      align: "left",
    },
    ...(style ? { style } : {}),
    mixedIndent: !sameStart,
  };
}

/** Decoded cues -> Subtitles (shared by the SCC and MCC importers). */
export function cea608CuesToSubtitles(
  decoder: Cea608Decoder,
  options: { offsetSeconds?: number; language?: string; captionTrackId?: string; idPrefix: string },
  issues: CaptionFormatIssue[],
): Subtitle[] {
  const offset = options.offsetSeconds ?? 0;
  let mixedIndent = 0;
  let positioned = 0;
  const out = decoder.cues.map((cue, i): Subtitle => {
    const mapped = mapCea608Cue(cue);
    if (mapped.mixedIndent) mixedIndent++;
    if (mapped.cueSettings) positioned++;
    return {
      id: `${options.idPrefix}-${Date.now().toString(36)}-${i.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      text: cue.text,
      startTime: cue.start - offset,
      endTime: cue.end - offset,
      ...(mapped.style ? { style: mapped.style } : {}),
      ...(mapped.cueSettings ? { cueSettings: mapped.cueSettings } : {}),
      ...(options.language ? { language: options.language } : {}),
      ...(options.captionTrackId ? { captionTrackId: options.captionTrackId } : {}),
    };
  });
  if (positioned)
    issues.push({
      severity: "info",
      code: "cc-positioned",
      message: `${positioned} caption${positioned === 1 ? " was" : "s were"} placed away from the bottom centre; row and indent are mapped to an approximate position inside an 80 % safe area.`,
    });
  if (mixedIndent)
    issues.push({
      severity: "warning",
      code: "cc-line-indents",
      message: `${mixedIndent} caption${mixedIndent === 1 ? "" : "s"} had lines with different indents; all lines take the left-most indent.`,
    });
  return out;
}
