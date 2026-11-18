import type { Marker, MarkerKind } from "../types/timeline";
import type { SeqMarker } from "./model";
import {
  framesToTimecode,
  resolveFrameRate,
  secondsToFrames,
  framesToSeconds,
  timecodeToFrames,
  type FrameRate,
} from "./timecode";

/**
 * Pure marker exporters: YouTube chapters, Premiere-style marker CSV and
 * EDL `* LOC:` locator lines. They take OpenReel markers (seconds) and know
 * nothing about the editor.
 */

/** Shortest chapter YouTube accepts, and the fewest chapters it needs. */
export const MIN_CHAPTER_SECONDS = 10;
export const MIN_CHAPTERS = 3;

const kindOf = (marker: Marker): MarkerKind => marker.kind ?? "comment";

const byTime = (a: Marker, b: Marker): number => a.time - b.time;

export interface Chapter {
  readonly time: number;
  readonly title: string;
}

export interface ChaptersResult {
  readonly text: string;
  readonly chapters: readonly Chapter[];
  /** YouTube would ignore the list when any of these hold; the text is still produced. */
  readonly warnings: readonly string[];
}

export interface ChaptersOptions {
  /** Title of the chapter inserted at 0:00 when the first marker is later. */
  readonly introTitle?: string;
  /** Sequence length, used to measure the last chapter. */
  readonly totalDuration?: number;
}

/** `m:ss`, or `h:mm:ss` from an hour on (YouTube's chapter timestamp format). */
export function formatChapterTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds + 1e-6));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * YouTube chapter list. Chapter markers are used when the project has any,
 * otherwise every marker is. The first chapter is forced to 0:00 (an "Intro"
 * chapter is inserted when the first marker is later). YouTube needs at least
 * three chapters of at least ten seconds each; the text is returned either
 * way, with a warning for each rule that is not met.
 */
export function chaptersText(markers: readonly Marker[], options: ChaptersOptions = {}): ChaptersResult {
  const chapterMarkers = markers.filter((m) => kindOf(m) === "chapter");
  const source = chapterMarkers.length > 0 ? chapterMarkers : markers;
  const chapters: Chapter[] = [];
  for (const marker of [...source].sort(byTime)) {
    const time = Math.floor(marker.time + 1e-6);
    // YouTube timestamps have whole-second resolution: collapse duplicates.
    if (chapters.length > 0 && chapters[chapters.length - 1].time === time) continue;
    chapters.push({ time, title: marker.label.trim().replace(/\s+/g, " ") || `Chapter ${chapters.length + 1}` });
  }
  if (chapters.length > 0 && chapters[0].time > 0) {
    chapters.unshift({ time: 0, title: options.introTitle ?? "Intro" });
  } else if (chapters.length > 0) {
    chapters[0] = { ...chapters[0], time: 0 };
  }

  const warnings: string[] = [];
  if (chapters.length === 0) {
    warnings.push("There are no markers to export as chapters.");
  } else {
    if (chapters.length < MIN_CHAPTERS) {
      warnings.push(`YouTube needs at least ${MIN_CHAPTERS} chapters; this has ${chapters.length}.`);
    }
    const short = chapters.filter((c, i) => {
      const next = chapters[i + 1]?.time ?? options.totalDuration;
      return next !== undefined && next - c.time < MIN_CHAPTER_SECONDS;
    });
    if (short.length > 0) {
      warnings.push(
        `YouTube chapters must be at least ${MIN_CHAPTER_SECONDS} seconds long; too short: ${short
          .map((c) => `"${c.title}" at ${formatChapterTime(c.time)}`)
          .join(", ")}.`,
      );
    }
  }
  return {
    text: chapters.map((c) => `${formatChapterTime(c.time)} ${c.title}`).join("\n"),
    chapters,
    warnings,
  };
}

/** Frame rate for exports: 29.97 / 59.94 use drop-frame unless told otherwise. */
export function markerFrameRate(fps: number, dropFrame?: boolean): FrameRate {
  const base = resolveFrameRate(fps);
  const drop = dropFrame ?? (base.ntsc && (base.timebase === 30 || base.timebase === 60));
  return resolveFrameRate(fps, { dropFrame: drop });
}

export const CSV_COLUMNS = ["Marker Name", "Description", "In", "Out", "Duration", "Marker Type"] as const;

const MARKER_TYPE_NAME: Record<MarkerKind, string> = {
  comment: "Comment",
  chapter: "Chapter",
  segmentation: "Segmentation",
  web: "WebLink",
};

export interface MarkersCsvOptions {
  readonly dropFrame?: boolean;
  /** Field separator. Premiere writes tabs; the default is a comma. */
  readonly delimiter?: "," | "\t";
}

const csvField = (value: string, delimiter: string): string =>
  value.includes('"') || value.includes("\n") || value.includes("\r") || value.includes(delimiter)
    ? `"${value.replace(/"/g, '""')}"`
    : value;

/** Premiere's marker-export columns with SMPTE timecodes, ordered by time. */
export function markersCsv(markers: readonly Marker[], fps: number, options: MarkersCsvOptions = {}): string {
  const rate = markerFrameRate(fps, options.dropFrame);
  const delimiter = options.delimiter ?? ",";
  const rows = [...markers].sort(byTime).map((m) => {
    const inFrame = Math.max(0, secondsToFrames(m.time, rate));
    const outFrame = Math.max(inFrame, secondsToFrames(m.time + (m.duration ?? 0), rate));
    return [
      m.label,
      m.comment ?? "",
      framesToTimecode(inFrame, rate),
      framesToTimecode(outFrame, rate),
      framesToTimecode(outFrame - inFrame, rate),
      MARKER_TYPE_NAME[kindOf(m)],
    ];
  });
  return [CSV_COLUMNS as readonly string[], ...rows]
    .map((row) => row.map((field) => csvField(field, delimiter)).join(delimiter))
    .join("\n");
}

const EDL_COLORS: readonly { name: string; rgb: readonly [number, number, number] }[] = [
  { name: "RED", rgb: [239, 68, 68] },
  { name: "GREEN", rgb: [34, 197, 94] },
  { name: "BLUE", rgb: [59, 130, 246] },
  { name: "CYAN", rgb: [34, 211, 238] },
  { name: "MAGENTA", rgb: [217, 70, 239] },
  { name: "YELLOW", rgb: [250, 204, 21] },
  { name: "BLACK", rgb: [0, 0, 0] },
  { name: "WHITE", rgb: [255, 255, 255] },
];

const parseHex = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};

/** Nearest of the colour names EDL locators and OTIO markers share. */
export function nearestMarkerColorName(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return "RED";
  let best = EDL_COLORS[0];
  let bestDistance = Infinity;
  for (const candidate of EDL_COLORS) {
    const d = candidate.rgb.reduce((sum, channel, i) => sum + (channel - rgb[i]) ** 2, 0);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best.name;
}

const hexOf = (rgb: readonly [number, number, number]): string =>
  `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/** Colour for an EDL locator colour name (defaults to the editor's marker blue). */
export function markerColorFromName(name: string): string {
  const found = EDL_COLORS.find((c) => c.name === name.toUpperCase());
  return found ? hexOf(found.rgb) : "#3b82f6";
}

export interface EdlLocOptions {
  readonly dropFrame?: boolean;
  /** Record timecode of sequence frame 0 (default 01:00:00:00, as the EDL writer). */
  readonly startTimecode?: string;
}

const edlBase = (rate: FrameRate, startTimecode?: string): number =>
  timecodeToFrames(startTimecode ?? (rate.dropFrame ? "01:00:00;00" : "01:00:00:00"), rate);

const cleanName = (name: string): string => name.replace(/[\r\n]+/g, " ").trim();

/** `* LOC: hh:mm:ss:ff COLOR name` lines for markers already in sequence frames. */
export function edlLocLines(markers: readonly SeqMarker[], rate: FrameRate, startTimecode?: string): string[] {
  const base = edlBase(rate, startTimecode);
  return [...markers]
    .sort((a, b) => a.frame - b.frame)
    .map(
      (m) =>
        `* LOC: ${framesToTimecode(base + Math.max(0, m.frame), rate)} ${(m.color ? nearestMarkerColorName(m.color) : "RED").padEnd(8)} ${cleanName(m.name)}`,
    );
}

/** `* LOC:` lines for OpenReel markers at `fps`. */
export function markersEdlLocs(markers: readonly Marker[], fps: number, options: EdlLocOptions = {}): string[] {
  const rate = markerFrameRate(fps, options.dropFrame);
  return edlLocLines(
    [...markers].sort(byTime).map((m) => ({
      frame: Math.max(0, secondsToFrames(m.time, rate)),
      name: m.label,
      color: m.color,
    })),
    rate,
    options.startTimecode,
  );
}

export interface ParsedLoc {
  readonly frame: number;
  readonly time: number;
  readonly color: string;
  readonly name: string;
}

const LOC_LINE = /^\*\s*LOC:\s*(\d+:\d{2}:\d{2}[:;.]\d{2,3})\s+(\S+)\s*(.*)$/;

/** Read `* LOC:` lines back out of an EDL (frames and seconds are relative to the start timecode). */
export function parseEdlLocs(text: string, fps: number, options: EdlLocOptions = {}): ParsedLoc[] {
  const rate = markerFrameRate(fps, options.dropFrame);
  const base = edlBase(rate, options.startTimecode);
  const out: ParsedLoc[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LOC_LINE.exec(line.trim());
    if (!m) continue;
    const frame = Math.max(0, timecodeToFrames(m[1], rate) - base);
    out.push({ frame, time: framesToSeconds(frame, rate), color: m[2].toUpperCase(), name: m[3].trim() });
  }
  return out;
}
