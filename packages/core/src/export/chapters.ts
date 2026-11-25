import type { Marker } from "../types/timeline";

/**
 * Markers to chapters for delivery: MP4 chapter atoms (through an ffmpeg metadata file), WebVTT chapters and the
 * YouTube description text (see `chaptersText` in interchange/marker-export for the text form). Only markers of
 * kind "chapter" become chapters here, so review comments never leak into a delivered file.
 */

export interface DeliveryChapter {
  /** Seconds from the start of the exported file. */
  readonly start: number;
  readonly end: number;
  readonly title: string;
}

export interface ChapterRange {
  readonly startTime: number;
  readonly endTime: number;
}

export function chapterMarkers(markers: readonly Marker[]): Marker[] {
  return markers.filter((m) => m.kind === "chapter").sort((a, b) => a.time - b.time);
}

/**
 * Chapter list for a file of `totalDuration` seconds. With a `range` only the markers inside it are kept and times
 * are relative to the range start. Each chapter ends where the next begins; the last ends at the file end.
 */
export function deliveryChapters(markers: readonly Marker[], totalDuration: number, range?: ChapterRange): DeliveryChapter[] {
  const offset = range?.startTime ?? 0;
  const fileEnd = range ? Math.min(totalDuration, range.endTime) - offset : totalDuration;
  const picked = chapterMarkers(markers)
    .filter((m) => m.time >= offset - 1e-6 && m.time < offset + fileEnd)
    .map((m) => ({ time: Math.max(0, m.time - offset), title: m.label.trim().replace(/\s+/g, " ") }));
  const unique: { time: number; title: string }[] = [];
  for (const c of picked) {
    if (unique.length && Math.abs(unique[unique.length - 1].time - c.time) < 0.001) continue;
    unique.push(c);
  }
  return unique.map((c, i) => ({
    start: c.time,
    end: Math.max(c.time + 0.001, unique[i + 1]?.time ?? fileEnd),
    title: c.title || `Chapter ${i + 1}`,
  }));
}

const escapeFfMeta = (text: string): string => text.replace(/[=;#\\\n]/g, (c) => (c === "\n" ? "\\\n" : `\\${c}`));

/** ffmpeg `;FFMETADATA1` text; passing it as an input with `-map_chapters` writes MP4 / MOV chapter atoms. */
export function chaptersToFfMetadata(chapters: readonly DeliveryChapter[]): string {
  const lines = [";FFMETADATA1"];
  for (const c of chapters) {
    lines.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${Math.round(c.start * 1000)}`, `END=${Math.max(Math.round(c.end * 1000), Math.round(c.start * 1000) + 1)}`, `title=${escapeFfMeta(c.title)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Reads the chapters back from `chaptersToFfMetadata` text (seconds). */
export function parseFfMetadataChapters(text: string): DeliveryChapter[] {
  const out: DeliveryChapter[] = [];
  let cur: { start?: number; end?: number; title?: string; base: number } | null = null;
  const flush = () => {
    if (cur && cur.start !== undefined && cur.end !== undefined) out.push({ start: cur.start, end: cur.end, title: cur.title ?? "" });
  };
  for (const raw of text.split(/\n/)) {
    const line = raw.trimEnd();
    if (line === "[CHAPTER]") {
      flush();
      cur = { base: 1 };
      continue;
    }
    if (!cur) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    if (key === "TIMEBASE") {
      const [n, d] = value.split("/").map(Number);
      cur.base = n / d;
    } else if (key === "START") cur.start = Number(value) * cur.base;
    else if (key === "END") cur.end = Number(value) * cur.base;
    else if (key === "title") cur.title = value.replace(/\\([=;#\\])/g, "$1");
  }
  flush();
  return out;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function vttTimestamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}.${pad(ms % 1000, 3)}`;
}

/** WebVTT chapters file (`<track kind="chapters">`). */
export function chaptersToWebVtt(chapters: readonly DeliveryChapter[]): string {
  const cues = chapters.map(
    (c, i) =>
      `${i + 1}\n${vttTimestamp(c.start)} --> ${vttTimestamp(c.end)}\n${c.title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/-->/g, "--&gt;")}`,
  );
  return `WEBVTT\n\n${cues.join("\n\n")}${cues.length ? "\n" : ""}`;
}

/** YouTube description text: `m:ss Title`, first chapter at 0:00 (see YouTube's chapter rules). */
export function chaptersToYouTubeText(chapters: readonly DeliveryChapter[]): string {
  const stamp = (s: number) => {
    const t = Math.floor(s + 1e-6);
    const h = Math.floor(t / 3600);
    return h > 0 ? `${h}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}` : `${Math.floor(t / 60)}:${pad(t % 60)}`;
  };
  const list = chapters.length && chapters[0].start > 0 ? [{ start: 0, end: chapters[0].start, title: "Intro" }, ...chapters] : chapters;
  return list.map((c, i) => `${stamp(i === 0 ? 0 : c.start)} ${c.title}`).join("\n");
}
