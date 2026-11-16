import { describe, expect, it } from "vitest";
import type { Subtitle } from "../types/timeline";
import { exportCaptions, exportSrt, exportTtml, exportVtt, listCaptionTracks, parseCaptions } from "./caption-formats";
import { buildTranscript, parseTranscriptJson, renameSpeaker, searchTranscript } from "./transcript";

const cues: Subtitle[] = [
  { id: "1", text: "Hello & <welcome>", startTime: 1, endTime: 2.5, speaker: "Ann" },
  {
    id: "2",
    text: "Second line\nwraps",
    startTime: 3.0015,
    endTime: 5,
    speaker: "Bob O'Neil",
    language: "fr",
    captionTrackId: "fr",
  },
  { id: "3", text: "No speaker", startTime: 3600.5, endTime: 3601 },
];

describe("caption formats", () => {
  it("exports WebVTT with voice tags and escaping", () => {
    const vtt = exportVtt(cues);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:01.000 --> 00:00:02.500\n<v Ann>Hello &amp; &lt;welcome&gt;</v>");
    expect(vtt).toContain("00:00:03.002 --> 00:00:05.000\n<v Bob O'Neil>Second line\nwraps</v>");
    expect(vtt).toContain("01:00:00.500 --> 01:00:01.000\nNo speaker");
  });

  it("round-trips WebVTT and SRT through the parser", () => {
    const back = parseCaptions(exportVtt(cues));
    expect(back.format).toBe("vtt");
    expect(back.errors).toEqual([]);
    expect(back.subtitles.map((c) => [c.text, c.speaker, c.startTime, c.endTime])).toEqual([
      ["Hello & <welcome>", "Ann", 1, 2.5],
      ["Second line\nwraps", "Bob O'Neil", 3.002, 5],
      ["No speaker", undefined, 3600.5, 3601],
    ]);
    const srt = parseCaptions(exportCaptions(cues, "srt"));
    expect(srt.format).toBe("srt");
    expect(srt.subtitles).toHaveLength(3);
    expect(exportCaptions(cues, "srt", { includeSpeakers: true })).toContain("Ann: Hello");
  });

  it("filters by caption track", () => {
    expect(exportVtt(cues, { captionTrackId: "fr" })).not.toContain("Hello");
    expect(exportVtt(cues, { captionTrackId: "" })).toContain("Hello");
    expect(listCaptionTracks(cues)).toEqual([
      { id: "", cueCount: 2 },
      { id: "fr", language: "fr", cueCount: 1 },
    ]);
  });

  it("exports TTML / IMSC1 with speaker agents", () => {
    const xml = exportTtml(cues, { language: "en" });
    expect(xml).toContain('ttp:profile="http://www.w3.org/ns/ttml/profile/imsc1/text"');
    expect(xml).toContain(
      '<ttm:agent xml:id="spk1" type="person"><ttm:name type="alias">Ann</ttm:name></ttm:agent>',
    );
    expect(xml).toContain('begin="00:00:01.000" end="00:00:02.500"');
    expect(xml).toContain("Hello &amp; &lt;welcome&gt;");
    expect(xml).toContain("Second line<br/>wraps");
  });

  it("reports malformed cues", () => {
    const r = parseCaptions("WEBVTT\n\nNOTE x\n\n00:01.000 --> 00:00.500\nbad\n\n1\nnonsense\n");
    expect(r.subtitles).toHaveLength(0);
    expect(r.errors).toHaveLength(2);
  });

  it("parses word-timed transcript JSON", () => {
    const { subtitles, errors } = parseTranscriptJson(
      JSON.stringify({
        language: "en",
        segments: [
          { speaker: "Ann", words: [{ word: " Hi", start: 0, end: 0.4 }, { word: "you.", start: 0.4, end: 1 }] },
          { text: "x" },
        ],
      }),
    );
    expect(errors).toHaveLength(1);
    expect(subtitles[0]).toMatchObject({ text: "Hi you.", startTime: 0, endTime: 1, speaker: "Ann", language: "en" });
  });
});

describe("blank lines in cue text", () => {
  const multi = [{ id: "m", text: "one\n\ntwo", startTime: 0, endTime: 1 }];

  it("never ends an SRT or VTT block early, and re-imports as a single cue", () => {
    for (const out of [exportSrt(multi), exportVtt(multi)]) {
      expect(out).not.toMatch(/one\n\s*\n\s*two/);
      const parsed = parseCaptions(out);
      expect(parsed.errors).toHaveLength(0);
      expect(parsed.subtitles.map((c) => c.text)).toEqual(["one\ntwo"]);
    }
  });
});

describe("speakers and search", () => {
  it("renames a speaker everywhere and merges", () => {
    const renamed = renameSpeaker(cues, "Ann", "Bob O'Neil");
    expect(renamed.map((c) => c.speaker)).toEqual(["Bob O'Neil", "Bob O'Neil", undefined]);
    expect(renameSpeaker(cues, "Nobody", "X")).toBe(cues);
  });

  it("searches phrases ignoring case and punctuation", () => {
    const t = buildTranscript([{ id: "a", text: "The quick, brown fox. The end", startTime: 0, endTime: 6 }]);
    expect(searchTranscript(t.words, "quick brown")).toEqual([{ wordStart: 1, wordEnd: 2 }]);
    expect(searchTranscript(t.words, "the")).toHaveLength(2);
  });
});
