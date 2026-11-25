import { looksLikeTranscriptJson, parseCaptions, parseTranscriptJson, type Subtitle } from "@openreel/core";

/** Cues from a transcript file (word-timed JSON, SRT, WebVTT...) for a clip, in the clip's own seconds. */
export function cuesFromTranscriptText(content: string, idPrefix = "imp"): { cues: Subtitle[]; errors: string[] } {
  if (looksLikeTranscriptJson(content)) {
    const parsed = parseTranscriptJson(content, { idPrefix });
    return { cues: parsed.subtitles, errors: parsed.errors };
  }
  const parsed = parseCaptions(content);
  return { cues: parsed.subtitles, errors: parsed.errors.map((e) => `Line ${e.line}: ${e.message}`) };
}
