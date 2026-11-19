import { describe, expect, it, vi } from "vitest";
import type { Subtitle } from "../types/timeline";
import {
  buildTranslationPrompt,
  parseTranslationReply,
  translateCaptionTrack,
  uniqueCaptionTrackId,
  type CaptionTranslator,
} from "./caption-translate";

const cue = (id: string, text: string, startTime: number, endTime: number, extra: Partial<Subtitle> = {}): Subtitle => ({
  id, text, startTime, endTime, ...extra,
});

const SUBS: Subtitle[] = [
  cue("a", "Hello", 0, 1, { speaker: "Ann", language: "en", words: [{ text: "Hello", startTime: 0, endTime: 1 }] }),
  cue("b", "World", 2, 3, { language: "en" }),
  cue("c", "Other track", 5, 6, { captionTrackId: "fr" }),
];

const upper: CaptionTranslator = {
  translate: async (texts) => texts.map((t) => `[es] ${t}`),
};

describe("translateCaptionTrack", () => {
  it("creates a new track preserving timing, speaker and style", async () => {
    const result = await translateCaptionTrack({ subtitles: SUBS, sourceTrackId: "", targetLanguage: "es", translator: upper });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trackId).toBe("es");
    expect(result.cues.map((c) => [c.text, c.startTime, c.endTime])).toEqual([
      ["[es] Hello", 0, 1],
      ["[es] World", 2, 3],
    ]);
    expect(result.cues[0].speaker).toBe("Ann");
    expect(result.cues.every((c) => c.captionTrackId === "es" && c.language === "es")).toBe(true);
    expect(result.cues[0].words).toBeUndefined();
    // Kept out of the picture so it never draws over the original at the same time and place.
    expect(result.cues.every((c) => c.hidden === true)).toBe(true);
    expect(new Set(result.cues.map((c) => c.id)).size).toBe(2);
    expect(SUBS[0].text).toBe("Hello");
  });

  it("batches and reports progress; passes the source language", async () => {
    const translate = vi.fn(upper.translate);
    const progress: number[] = [];
    const result = await translateCaptionTrack({
      subtitles: SUBS, sourceTrackId: "", targetLanguage: "es", batchSize: 1,
      translator: { translate }, onProgress: (p) => progress.push(p.done),
    });
    expect(result.ok).toBe(true);
    expect(translate).toHaveBeenCalledTimes(2);
    expect(translate.mock.calls[0][1]).toMatchObject({ sourceLanguage: "en", targetLanguage: "es" });
    expect(progress).toEqual([0, 1, 2]);
  });

  it("reports several progress steps even for a short track", async () => {
    const many = Array.from({ length: 10 }, (_, i) => cue(`m${i}`, `t${i}`, i, i + 1));
    const progress: number[] = [];
    const result = await translateCaptionTrack({ subtitles: many, sourceTrackId: "", targetLanguage: "es", translator: upper, onProgress: (p) => progress.push(p.done) });
    expect(result.ok).toBe(true);
    expect(progress.length).toBeGreaterThanOrEqual(5);
  });

  it("avoids clashing with an existing track id", async () => {
    const result = await translateCaptionTrack({ subtitles: SUBS, sourceTrackId: "", targetLanguage: "fr", translator: upper });
    expect(result.ok && result.trackId).toBe("fr-2");
    expect(uniqueCaptionTrackId(SUBS, "")).toBe("captions-2");
  });

  it("cancels between batches and returns no cues", async () => {
    const controller = new AbortController();
    const translate = vi.fn(async (texts: readonly string[]) => {
      controller.abort();
      return texts.map((t) => t);
    });
    const result = await translateCaptionTrack({
      subtitles: SUBS, sourceTrackId: "", targetLanguage: "es", batchSize: 1,
      translator: { translate }, signal: controller.signal,
    });
    expect(result).toMatchObject({ ok: false, reason: "cancelled" });
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it("treats an AbortError from the translator as cancellation", async () => {
    const result = await translateCaptionTrack({
      subtitles: SUBS, sourceTrackId: "", targetLanguage: "es",
      translator: { translate: async () => { throw new DOMException("x", "AbortError"); } },
    });
    expect(result).toMatchObject({ ok: false, reason: "cancelled" });
  });

  it("fails without output when the translator returns the wrong count or throws", async () => {
    const short = await translateCaptionTrack({
      subtitles: SUBS, sourceTrackId: "", targetLanguage: "es", translator: { translate: async (texts) => texts.slice(1) },
    });
    expect(short).toMatchObject({ ok: false, reason: "failed" });
    const boom = await translateCaptionTrack({
      subtitles: SUBS, sourceTrackId: "", targetLanguage: "es", translator: { translate: async () => { throw new Error("offline"); } },
    });
    expect(boom).toMatchObject({ ok: false, reason: "failed", message: "offline" });
  });

  it("reports an empty track", async () => {
    const result = await translateCaptionTrack({ subtitles: SUBS, sourceTrackId: "zz", targetLanguage: "es", translator: upper });
    expect(result).toMatchObject({ ok: false, reason: "empty" });
  });
});

describe("translation prompt and reply parsing", () => {
  it("round-trips a JSON array and tolerates code fences", () => {
    expect(parseTranslationReply('```json\n["a","b"]\n```', 2)).toEqual(["a", "b"]);
    expect(parseTranslationReply('Sure: ["a\\nb"]', 1)).toEqual(["a\nb"]);
  });
  it("rejects wrong length and non-arrays", () => {
    expect(() => parseTranslationReply('["a"]', 2)).toThrow(/1 lines for 2/);
    expect(() => parseTranslationReply("nope", 1)).toThrow();
    expect(() => parseTranslationReply("[1]", 1)).toThrow();
  });
  it("puts the cues in the user message", () => {
    const p = buildTranslationPrompt(["Hi"], { targetLanguage: "es", targetName: "Spanish" });
    expect(p.user).toContain("Spanish (es)");
    expect(p.user).toContain('["Hi"]');
  });
});
