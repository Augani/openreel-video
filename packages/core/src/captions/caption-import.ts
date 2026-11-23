import type { Subtitle } from "../types/timeline";
import {
  decodeCaptionText,
  exportCaptionFile,
  parseCaptionBytes,
  parseCaptions,
  type CaptionExportFormat,
  type CaptionExportOptions,
  type CaptionFile,
  type CaptionImportOptions,
  type CaptionParseResult,
} from "./caption-formats";
import { isStlContent } from "./ebu-stl";
import type { CaptionFormatIssue } from "./scc";

/**
 * One entry point for caption files as bytes: the format is detected from the content (and the file name
 * only as a hint for plain transcripts). Parsers that are not needed by most projects (MCC, timed text
 * transcripts) are loaded on demand so they stay out of the editor's first load.
 */

export type CaptionFileFormat = CaptionParseResult["format"];

export interface CaptionFileImport {
  subtitles: Subtitle[];
  errors: Array<{ line: number; message: string }>;
  issues: CaptionFormatIssue[];
  format: CaptionFileFormat | "unknown";
}

/** Extensions the importers accept. `.xml` is TTML only when it has a `<tt>` root. */
export const CAPTION_IMPORT_EXTENSIONS = [".srt", ".vtt", ".sbv", ".ttml", ".dfxp", ".itt", ".xml", ".scc", ".mcc", ".stl", ".txt"] as const;

export const isCaptionFileName = (name: string): boolean => {
  const n = name.toLowerCase();
  // .xml / .txt are also used by other imports (XMEML timelines, notes): captions only when asked for explicitly.
  return [".srt", ".vtt", ".sbv", ".ttml", ".dfxp", ".itt", ".scc", ".mcc", ".stl"].some((e) => n.endsWith(e));
};

export async function importCaptionFile(
  bytes: Uint8Array,
  options: CaptionImportOptions & { fileName?: string } = {},
): Promise<CaptionFileImport> {
  const done = (r: { subtitles: Subtitle[]; errors: Array<{ line: number; message: string }>; issues?: CaptionFormatIssue[]; format: CaptionFileFormat }): CaptionFileImport => ({
    subtitles: r.subtitles,
    errors: r.errors,
    issues: r.issues ?? [],
    format: r.format,
  });
  if (isStlContent(bytes)) return done(parseCaptionBytes(bytes, options));
  const text = decodeCaptionText(bytes);
  if (/^\uFEFF?\s*File Format\s*=\s*MacCaption_MCC/i.test(text)) {
    const { parseMcc } = await import("./mcc");
    return done(parseMcc(text, options));
  }
  const parsed = parseCaptions(text, options);
  if (parsed.subtitles.length === 0 && (parsed.format === "srt" || parsed.format === "vtt")) {
    const { isTimedTranscript, parseTimedTranscript } = await import("./plain-transcript");
    if (isTimedTranscript(text)) return done(parseTimedTranscript(text, options));
  }
  return done(parsed);
}

/** Like `exportCaptionFile`, plus formats whose encoder loads on demand (MCC). */
export async function exportCaptionFileAsync(
  subtitles: readonly Subtitle[],
  format: CaptionExportFormat,
  options: CaptionExportOptions = {},
): Promise<CaptionFile> {
  if (format !== "mcc") return exportCaptionFile(subtitles, format, options);
  const { encodeMcc } = await import("./mcc");
  const r = encodeMcc(subtitles, options);
  return { bytes: new TextEncoder().encode(r.content), mimeType: "text/plain", extension: "mcc", issues: r.issues };
}

/** Word-timed transcript JSON (`{...}` or `[...]`), as opposed to a timed text transcript that starts with `[00:01:02]`. */
export function looksLikeTranscriptJson(text: string): boolean {
  const t = text.replace(/^\uFEFF/, "").trimStart();
  if (t.startsWith("{")) return true;
  return t.startsWith("[") && !/^\[\s*(?:\d{1,2}:)?\d{1,2}:\d{2}/.test(t);
}
