import type { Subtitle } from "../types/timeline";
import {
  exportCaptionFile,
  exportSrt,
  exportVtt,
  CAPTION_FORMAT_INFO,
  type CaptionExportFormat,
} from "./caption-formats";
import type { CaptionFormatIssue } from "./scc";

/**
 * How a video export treats each caption track: burned into the picture, written
 * as a sidecar file, and/or embedded as a subtitle track in the container.
 * Everything here is pure; the export engine and the desktop encoder consume the
 * plans.
 *
 * Embedded kinds:
 *  - `webvtt`   WebVTT track in MP4 (browser export, MediaBunny).
 *  - `mov_text` 3GPP timed text (tx3g) in MP4 / MOV (desktop ffmpeg).
 *  - `cea608`   CEA-608 byte pairs as a `c608` track in MOV (desktop ffmpeg). MP4 cannot
 *    carry c608, so a CEA-608 request on MP4 falls back to mov_text with a warning.
 */

export type EmbeddedCaptionMode = "none" | "subtitle" | "cea608";
export type EmbeddedCaptionKind = "webvtt" | "mov_text" | "cea608";

export interface CaptionTrackExportSettings {
  /** Caption track id; "" is the default track. */
  captionTrackId: string;
  /** Draw this track's cues into the picture. Default true. */
  burnIn: boolean;
  /** Sidecar file next to the video. Default none. */
  sidecar: CaptionExportFormat | "none";
  /** Subtitle track inside the container. Default none. */
  embedded: EmbeddedCaptionMode;
}

export interface CaptionExportSettings {
  tracks: CaptionTrackExportSettings[];
}

export const DEFAULT_CAPTION_TRACK_EXPORT: Omit<CaptionTrackExportSettings, "captionTrackId"> = {
  burnIn: true,
  sidecar: "none",
  embedded: "none",
};

const trackOf = (cue: Subtitle): string => cue.captionTrackId ?? "";

export function trackExportSettings(
  captions: CaptionExportSettings | undefined,
  captionTrackId: string,
): CaptionTrackExportSettings {
  return {
    captionTrackId,
    ...DEFAULT_CAPTION_TRACK_EXPORT,
    ...(captions?.tracks.find((t) => t.captionTrackId === captionTrackId) ?? {}),
  };
}

/** Cues that must be drawn into the picture (a track with no entry is burned in unless its cues are hidden). */
export function burnedInSubtitles(
  subtitles: readonly Subtitle[],
  captions: CaptionExportSettings | undefined,
): Subtitle[] {
  const shown = subtitles.filter((cue) => !cue.hidden);
  if (!captions || !captions.tracks.length) return shown;
  return shown.filter((cue) => trackExportSettings(captions, trackOf(cue)).burnIn);
}

/** True when the settings remove cues from the picture, so cached preview frames cannot be reused. */
export function captionsChangeBurnIn(
  subtitles: readonly Subtitle[],
  captions: CaptionExportSettings | undefined,
): boolean {
  return burnedInSubtitles(subtitles, captions).length !== subtitles.length;
}

/** Project copy whose subtitles are only the burned-in cues (identity when nothing is excluded). */
export function applyCaptionBurnIn<P extends { timeline: { subtitles: Subtitle[] } }>(
  project: P,
  captions: CaptionExportSettings | undefined,
): P {
  if (!captionsChangeBurnIn(project.timeline.subtitles, captions)) return project;
  return {
    ...project,
    timeline: { ...project.timeline, subtitles: burnedInSubtitles(project.timeline.subtitles, captions) },
  };
}

const ISO_639_2: Readonly<Record<string, string>> = {
  en: "eng", fr: "fra", de: "deu", es: "spa", it: "ita", pt: "por", nl: "nld", sv: "swe", da: "dan",
  no: "nor", nb: "nob", fi: "fin", pl: "pol", cs: "ces", ru: "rus", uk: "ukr", tr: "tur", el: "ell",
  he: "heb", ar: "ara", hi: "hin", ja: "jpn", ko: "kor", zh: "zho", th: "tha", vi: "vie", id: "ind",
};

export function iso6392(language: string | undefined): string {
  if (!language) return "und";
  const primary = language.split(/[-_]/)[0].toLowerCase();
  if (/^[a-z]{3}$/.test(primary)) return primary;
  return ISO_639_2[primary] ?? "und";
}

export interface EmbeddedCaptionPayload {
  kind: EmbeddedCaptionKind;
  /** File text: WebVTT, SRT (mov_text input) or SCC (cea608 input). */
  data: string;
  /** ISO 639-2 language of the track. */
  language: string;
  captionTrackId: string;
  cueCount: number;
}

export interface EmbeddedCaptionPlan {
  payloads: EmbeddedCaptionPayload[];
  warnings: string[];
  issues: CaptionFormatIssue[];
}

export interface EmbeddedCaptionContext {
  format: "mp4" | "mov" | "webm" | "mxf" | "mkv";
  /** "native" = desktop ffmpeg; "web" = MediaBunny in the browser. */
  engine: "native" | "web";
  frameRate: number;
  /** Subtitle codecs the web container accepts (MediaBunny `getSupportedSubtitleCodecs`). */
  webSubtitleCodecs?: readonly string[];
}

const trackLabel = (id: string) => (id === "" ? "the default caption track" : `caption track "${id}"`);

export function planEmbeddedCaptions(
  subtitles: readonly Subtitle[],
  captions: CaptionExportSettings | undefined,
  context: EmbeddedCaptionContext,
): EmbeddedCaptionPlan {
  const plan: EmbeddedCaptionPlan = { payloads: [], warnings: [], issues: [] };
  if (!captions) return plan;
  const ids = [...new Set(subtitles.map(trackOf))].sort();
  for (const id of ids) {
    const settings = trackExportSettings(captions, id);
    if (settings.embedded === "none") continue;
    const cues = subtitles.filter((cue) => trackOf(cue) === id && cue.endTime > cue.startTime && cue.text.trim() !== "");
    if (!cues.length) continue;
    const language = iso6392(cues.find((c) => c.language)?.language);
    const select = { captionTrackId: id };
    const base = { language, captionTrackId: id, cueCount: cues.length };

    if (context.engine === "web") {
      const webvtt = context.webSubtitleCodecs ? context.webSubtitleCodecs.includes("webvtt") : context.format === "mp4";
      if (settings.embedded === "cea608")
        plan.warnings.push(`CEA-608 captions can only be embedded by the desktop app; ${trackLabel(id)} was not embedded.`);
      else if (!webvtt)
        plan.warnings.push(`${context.format.toUpperCase()} files cannot hold a subtitle track in the browser; ${trackLabel(id)} was not embedded. Use MP4.`);
      else plan.payloads.push({ ...base, kind: "webvtt", data: exportVtt(subtitles, select) });
      continue;
    }

    if (context.format === "mxf") {
      plan.warnings.push(`MXF files cannot hold a subtitle track here; ${trackLabel(id)} was not embedded. Export a sidecar caption file instead.`);
      continue;
    }
    if (context.format === "webm" || context.format === "mkv") {
      plan.warnings.push(`${context.format === "mkv" ? "MKV" : "WebM"} export cannot embed subtitle tracks here; ${trackLabel(id)} was not embedded.`);
      continue;
    }
    if (settings.embedded === "cea608" && context.format === "mov") {
      const file = exportCaptionFile(subtitles, "scc", { ...select, frameRate: context.frameRate });
      plan.issues.push(...file.issues);
      for (const issue of file.issues)
        if (issue.severity !== "info") plan.warnings.push(`${trackLabel(id)}: ${issue.message}`);
      plan.payloads.push({ ...base, kind: "cea608", data: new TextDecoder().decode(file.bytes) });
      continue;
    }
    if (settings.embedded === "cea608")
      plan.warnings.push(`MP4 cannot carry a CEA-608 track; ${trackLabel(id)} was embedded as a timed-text (tx3g) track instead. Choose MOV for CEA-608.`);
    plan.payloads.push({ ...base, kind: "mov_text", data: exportSrt(subtitles, select) });
  }
  return plan;
}

export interface SidecarFile {
  filename: string;
  bytes: Uint8Array;
  mimeType: string;
  captionTrackId: string;
  format: CaptionExportFormat;
  issues: CaptionFormatIssue[];
}

const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");

/** Sidecar files for every track that asks for one. `baseName` has no extension. */
export function planSidecarFiles(
  subtitles: readonly Subtitle[],
  captions: CaptionExportSettings | undefined,
  options: { baseName: string; frameRate: number; offsetSeconds?: number },
): SidecarFile[] {
  if (!captions) return [];
  const files: SidecarFile[] = [];
  const ids = [...new Set(subtitles.map(trackOf))].sort();
  for (const id of ids) {
    const settings = trackExportSettings(captions, id);
    if (settings.sidecar === "none") continue;
    const cues = subtitles.filter((cue) => trackOf(cue) === id && cue.endTime > cue.startTime && cue.text.trim() !== "");
    if (!cues.length) continue;
    const format = settings.sidecar;
    const file = exportCaptionFile(subtitles, format, {
      captionTrackId: id,
      frameRate: options.frameRate,
      includeSpeakers: format === "srt",
      ...(options.offsetSeconds ? { offsetSeconds: options.offsetSeconds } : {}),
    });
    const suffix = ids.length > 1 ? `.${safe(id) || "default"}` : "";
    files.push({
      filename: `${options.baseName}${suffix}.${CAPTION_FORMAT_INFO[format].extension}`,
      bytes: file.bytes,
      mimeType: file.mimeType,
      captionTrackId: id,
      format,
      issues: file.issues,
    });
  }
  return files;
}

/** Cues clipped and shifted to an export range (cues outside it are dropped). Identity without a range. */
export function subtitlesForRange(
  subtitles: readonly Subtitle[],
  range: { startTime: number; endTime: number } | undefined,
): Subtitle[] {
  if (!range) return subtitles.slice();
  const out: Subtitle[] = [];
  for (const cue of subtitles) {
    if (cue.endTime <= range.startTime || cue.startTime >= range.endTime) continue;
    out.push({
      ...cue,
      startTime: Math.max(cue.startTime, range.startTime) - range.startTime,
      endTime: Math.min(cue.endTime, range.endTime) - range.startTime,
    });
  }
  return out;
}
