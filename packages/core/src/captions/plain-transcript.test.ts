import { describe, expect, it } from "vitest";
import { importCaptionFile } from "./caption-import";
import { isTimedTranscript, parseTimedTranscript } from "./plain-transcript";

describe("timed plain-text transcripts", () => {
  it("reads bracketed, bare and header-style time stamps with speakers", () => {
    const text = [
      "[00:00:01.500] Welcome back everyone",
      "00:00:04 Host: Today we talk about captions",
      "Guest  00:00:09",
      "Thanks for having me.",
      "It is great to be here.",
      "",
      "1:02:03 - Last line",
    ].join("\n");
    expect(isTimedTranscript(text)).toBe(true);
    const r = parseTimedTranscript(text);
    expect(r.errors).toEqual([]);
    expect(r.subtitles.map((s) => [s.startTime, s.endTime, s.speaker, s.text])).toEqual([
      [1.5, 4, undefined, "Welcome back everyone"],
      [4, 9, "Host", "Today we talk about captions"],
      [9, expect.closeTo(9 + 45 / 17, 5), "Guest", "Thanks for having me.\nIt is great to be here."],
      [3723, expect.any(Number), undefined, "Last line"],
    ]);
    expect(r.issues[0].code).toBe("txt-end-times");
    expect(r.issues[0].message).toMatch(/estimated from the reading speed/);
  });

  it("refuses untimed text with a clear reason", () => {
    const r = parseTimedTranscript("Just some words\nwithout any times");
    expect(r.subtitles).toEqual([]);
    expect(r.errors.some((e) => /No time stamps/.test(e.message))).toBe(true);
    expect(isTimedTranscript("Just some words\nwithout any times")).toBe(false);
  });

  it("is picked up by the byte loader when SRT parsing finds nothing", async () => {
    const r = await importCaptionFile(new TextEncoder().encode("[00:00:01] one\n[00:00:03] two\n"), { fileName: "t.txt" });
    expect(r.format).toBe("txt");
    expect(r.subtitles.map((s) => s.text)).toEqual(["one", "two"]);
    expect(r.issues.length).toBe(1);
  });

  it("does not hijack real SRT", async () => {
    const r = await importCaptionFile(new TextEncoder().encode("1\n00:00:01,000 --> 00:00:02,000\nHi\n"));
    expect(r.format).toBe("srt");
  });
});
