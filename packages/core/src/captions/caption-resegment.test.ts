import { describe, expect, it } from "vitest";
import type { Subtitle } from "../types/timeline";
import { resegmentCues, splitText } from "./caption-resegment";
import { translateCaptionTrack } from "./caption-translate";
import { checkCaptions } from "./caption-qc";

const cue = (id: string, text: string, startTime: number, endTime: number, extra: Partial<Subtitle> = {}): Subtitle => ({
  id, text, startTime, endTime, ...extra,
});
const MID = "Esta es una frase bastante larga que el traductor ha producido, y continua con otra idea. Aqui termina la tarde.";
const LONG = "Esta es una frase bastante larga que el traductor ha producido, y ademas continua con otra idea. Y aqui termina la historia completa de la tarde.";

describe("splitText", () => {
  it("prefers sentence breaks and keeps every word", () => {
    const parts = splitText("First sentence is here. Second sentence follows right after it.", 2);
    expect(parts).toEqual(["First sentence is here.", "Second sentence follows right after it."]);
  });
  it("splits unspaced scripts by character", () => {
    expect(splitText("今日は天気がいいですね", 2).join("")).toBe("今日は天気がいいですね");
  });
});

describe("resegmentCues", () => {
  it("leaves cues within every limit untouched", () => {
    const input = [cue("a", "Hello there", 0, 2), cue("b", "Fine", 3, 4)];
    const out = resegmentCues(input);
    expect(out.cues).toEqual(input);
    expect(out.split + out.extended).toBe(0);
  });

  it("borrows silence for fast text but never crosses the next cue", () => {
    const input = [cue("a", "x".repeat(40), 0, 1), cue("b", "next", 2, 3)];
    const out = resegmentCues(input);
    expect(out.extended).toBe(1);
    expect(out.cues[0].startTime).toBe(0);
    expect(out.cues[0].endTime).toBeGreaterThan(1);
    expect(out.cues[0].endTime).toBeLessThanOrEqual(2);
    expect(out.cues[1]).toEqual(input[1]);

    const tight = resegmentCues([cue("a", "x".repeat(40), 0, 1), cue("b", "next", 1, 3)]);
    expect(tight.cues[0].endTime).toBe(1);
  });

  it("splits over-long text into pieces that tile the original span", () => {
    const original = cue("a", LONG, 10, 16, { speaker: "Ann", language: "es", captionTrackId: "es", words: [{ text: "Esta", startTime: 10, endTime: 11 }] });
    const out = resegmentCues([original]);
    expect(out.split).toBe(1);
    expect(out.cues.length).toBeGreaterThan(1);
    expect(out.cues[0].id).toBe("a");
    expect(new Set(out.cues.map((c) => c.id)).size).toBe(out.cues.length);
    expect(out.cues[0].startTime).toBe(10);
    // 137 characters need 8 s at 17 cps: the cue borrows silence up to the 7 s cap.
    expect(out.cues[out.cues.length - 1].endTime).toBeGreaterThanOrEqual(16);
    expect(out.cues[out.cues.length - 1].endTime).toBeLessThanOrEqual(17);
    out.cues.forEach((c, i) => {
      if (i) expect(c.startTime).toBeCloseTo(out.cues[i - 1].endTime, 6);
      expect(c.text.length).toBeLessThanOrEqual(84);
      expect(c.speaker).toBe("Ann");
      expect(c.captionTrackId).toBe("es");
      expect(c.words).toBeUndefined();
    });
    expect(out.cues.map((c) => c.text).join(" ")).toBe(LONG);
  });

  it("never makes pieces shorter than the minimum duration", () => {
    const out = resegmentCues([cue("a", LONG, 0, 1.2)]);
    out.cues.forEach((c) => expect(c.endTime - c.startTime).toBeGreaterThanOrEqual(5 / 6 - 1e-9));
  });

  it("splits cues running past the maximum duration", () => {
    const out = resegmentCues([cue("a", "Short words only here. And a second thing to say.", 0, 12)]);
    expect(out.cues.length).toBeGreaterThan(1);
    out.cues.forEach((c) => expect(c.endTime - c.startTime).toBeLessThanOrEqual(7 + 1e-9));
  });
});

describe("translateCaptionTrack re-segmentation", () => {
  const source: Subtitle[] = [cue("s1", "Hi.", 0, 6), cue("s2", "Bye.", 8, 9)];
  const translator = { translate: async (texts: readonly string[]) => texts.map((t) => (t === "Hi." ? MID : "Adios")) };

  it("splits a long translation while keeping the passage's span and reading speed", async () => {
    const result = await translateCaptionTrack({ subtitles: source, sourceTrackId: "", targetLanguage: "es", translator });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cues.length).toBeGreaterThan(2);
    const first = result.cues.filter((c) => c.startTime < 6);
    expect(first[0].startTime).toBe(0);
    // 112 characters in 6 s is only slightly fast (18.7 cps): the passage keeps its exact span.
    expect(first[first.length - 1].endTime).toBe(6);
    expect(new Set(result.cues.map((c) => c.id)).size).toBe(result.cues.length);
    expect(result.cues.every((c) => c.hidden && c.language === "es")).toBe(true);
    expect(result.cues.every((c) => c.text.length <= 84)).toBe(true);
    expect(checkCaptions(result.cues, { captionTrackId: "es" }).worstCps).toBeLessThan(19.5);

    // A much faster passage borrows following silence, but never into the next cue.
    const fast = await translateCaptionTrack({
      subtitles: [cue("f1", "Hi.", 0, 3), cue("f2", "Bye.", 5, 6)],
      sourceTrackId: "", targetLanguage: "es", translator,
    });
    expect(fast.ok).toBe(true);
    if (!fast.ok) return;
    const last = fast.cues.filter((c) => c.startTime < 5).pop()!;
    expect(last.endTime).toBeGreaterThan(3);
    expect(last.endTime).toBeLessThanOrEqual(5);
  });

  it("never gives an uneven piece less than the minimum duration", () => {
    const text =
      "Das ist ein sehr langer übersetzter Satz, der viel mehr Platz braucht als das Original. Er hat mehrere Teile, und jeder davon muss lesbar bleiben, damit niemand überfordert wird.";
    const out = resegmentCues([cue("a", text, 2.5, 5), cue("b", "Next.", 5, 7)]).cues.filter((c) => c.id !== "b");
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.endTime - c.startTime).toBeGreaterThanOrEqual(5 / 6 - 1e-6);
    expect(out[0].startTime).toBe(2.5);
    expect(out[out.length - 1].endTime).toBeCloseTo(5, 9);
    for (let k = 1; k < out.length; k++) expect(out[k].startTime).toBeCloseTo(out[k - 1].endTime, 9);
  });

  it("can be turned off for strict one-to-one cues", async () => {
    const result = await translateCaptionTrack({ subtitles: source, sourceTrackId: "", targetLanguage: "es", translator, resegment: false });
    expect(result.ok && result.cues.length).toBe(2);
  });
});
