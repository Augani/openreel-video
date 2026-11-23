import type { Subtitle } from "../types/timeline";
import { resegmentCues, type ResegmentOptions } from "./caption-resegment";

/**
 * Caption translation: turns one caption track into a new track in another language.
 * The translator is injected (an AI provider or the browser's on-device Translator),
 * so this stays pure and testable. Timing, style, speaker and cue settings of every
 * cue are preserved; only the text changes. Word timings are dropped because the
 * translated words no longer line up with the spoken ones.
 */

export interface CaptionTranslator {
  /**
   * Translate `texts` (one cue each) and return exactly one string per input, in order.
   * Must reject with an AbortError when `signal` aborts.
   */
  translate(
    texts: readonly string[],
    options: { sourceLanguage?: string; targetLanguage: string; signal?: AbortSignal },
  ): Promise<string[]>;
}

export interface CaptionTranslationProgress {
  readonly done: number;
  readonly total: number;
}

export interface TranslateCaptionTrackOptions {
  readonly subtitles: readonly Subtitle[];
  /** Source track id; "" is the default track. */
  readonly sourceTrackId: string;
  readonly targetLanguage: string;
  readonly translator: CaptionTranslator;
  /** Id for the new track; defaults to the target language, made unique among existing tracks. */
  readonly targetTrackId?: string;
  /** Cues per translator call. Default 20. */
  readonly batchSize?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: CaptionTranslationProgress) => void;
  readonly idFactory?: (index: number) => string;
  /**
   * Keep reading speed sane: borrow following silence or split cues that became too long.
   * Default on; pass `false` for strictly one translated cue per source cue.
   */
  readonly resegment?: ResegmentOptions | false;
}

export type CaptionTranslationResult =
  | {
      readonly ok: true;
      readonly trackId: string;
      /** The new cues only. Append them to the project's subtitles to create the track. */
      readonly cues: Subtitle[];
    }
  | { readonly ok: false; readonly reason: "empty" | "cancelled" | "failed"; readonly message: string };

const DEFAULT_BATCH = 20;

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** A track id that no existing cue uses. */
export function uniqueCaptionTrackId(subtitles: readonly Subtitle[], wanted: string): string {
  const used = new Set(subtitles.map((s) => s.captionTrackId ?? ""));
  if (wanted && !used.has(wanted)) return wanted;
  const base = wanted || "captions";
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export async function translateCaptionTrack(
  options: TranslateCaptionTrackOptions,
): Promise<CaptionTranslationResult> {
  const { subtitles, sourceTrackId, targetLanguage, translator, signal } = options;
  const source = subtitles
    .filter((s) => (s.captionTrackId ?? "") === sourceTrackId && s.text.trim() !== "")
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
  if (!source.length) {
    return { ok: false, reason: "empty", message: "That caption track has no text to translate." };
  }
  const sourceLanguage = source.find((s) => s.language)?.language;
  // Short tracks still report several progress steps instead of jumping from 0 to done.
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? Math.min(DEFAULT_BATCH, Math.ceil(source.length / 5))));
  const trackId = uniqueCaptionTrackId(subtitles, options.targetTrackId?.trim() || targetLanguage);
  const makeId = options.idFactory ?? ((i: number) => `tx-${trackId}-${i}`);

  const translated: string[] = [];
  options.onProgress?.({ done: 0, total: source.length });
  try {
    for (let from = 0; from < source.length; from += batchSize) {
      if (signal?.aborted) return cancelled();
      const batch = source.slice(from, from + batchSize);
      const out = await translator.translate(
        batch.map((s) => s.text),
        { sourceLanguage, targetLanguage, signal },
      );
      if (signal?.aborted) return cancelled();
      if (!Array.isArray(out) || out.length !== batch.length) {
        return {
          ok: false,
          reason: "failed",
          message: `The translator returned ${Array.isArray(out) ? out.length : 0} lines for ${batch.length} captions. Nothing was added.`,
        };
      }
      translated.push(...out.map((t) => String(t)));
      options.onProgress?.({ done: translated.length, total: source.length });
    }
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) return cancelled();
    return {
      ok: false,
      reason: "failed",
      message: error instanceof Error ? error.message : "Translation failed.",
    };
  }

  const cues = source.map((cue, i): Subtitle => {
    const { words: _words, ...rest } = cue;
    void _words;
    return {
      ...rest,
      id: makeId(i),
      text: translated[i].trim() || cue.text,
      language: targetLanguage,
      captionTrackId: trackId,
      // Drawn over the same time range and position as the original, so it stays out of the
      // picture until the editor chooses which language to show.
      hidden: true,
    };
  });
  if (options.resegment === false) return { ok: true, trackId, cues };
  const fitted = resegmentCues(cues, { pieceId: (cue, n) => `${cue.id}-p${n}`, ...(options.resegment ?? {}) });
  return { ok: true, trackId, cues: fitted.cues };
}

function cancelled(): CaptionTranslationResult {
  return { ok: false, reason: "cancelled", message: "Translation cancelled. Nothing was added." };
}

/**
 * Prompt + parser for LLM-backed translators. Cues travel as a JSON array of strings and
 * must come back as a JSON array of the same length, so line breaks inside a cue survive.
 */
export function buildTranslationPrompt(
  texts: readonly string[],
  languages: { sourceLanguage?: string; targetLanguage: string; targetName?: string },
): { system: string; user: string } {
  const target = languages.targetName ? `${languages.targetName} (${languages.targetLanguage})` : languages.targetLanguage;
  return {
    system:
      "You translate video captions. Translate each caption faithfully and concisely into the target language, keeping line breaks, speaker names, music notes and sound cues in brackets. " +
      "Reply with ONLY a JSON array of strings, one per input caption, in the same order and with exactly the same length. No commentary, no code fences.",
    user:
      `Source language: ${languages.sourceLanguage ?? "auto-detect"}\nTarget language: ${target}\n\n` +
      JSON.stringify(texts),
  };
}

export function parseTranslationReply(reply: string, expected: number): string[] {
  let body = reply.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fenced) body = fenced[1];
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("The model did not return a translation.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error("The model's translation could not be read.");
  }
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
    throw new Error("The model's translation could not be read.");
  }
  if (parsed.length !== expected) {
    throw new Error(`The model returned ${parsed.length} lines for ${expected} captions.`);
  }
  return parsed as string[];
}
