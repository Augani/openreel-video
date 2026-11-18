import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Subtitle } from "../types/timeline";
import {
  framesToTimecode,
  resolveCaptionFrameRate,
  timecodeToFrames,
} from "./caption-timecode";
import { encodeScc, exportScc, hasOddParity, parseScc, withOddParity } from "./scc";

const cue = (id: string, startTime: number, endTime: number, text: string): Subtitle => ({
  id,
  text,
  startTime,
  endTime,
});

const NDF = { frameRate: 29.97, dropFrame: false } as const;

describe("odd parity", () => {
  it("adds bit 7 only when the 7-bit value has an even number of ones", () => {
    expect(withOddParity(0x14)).toBe(0x94);
    expect(withOddParity(0x20)).toBe(0x20);
    expect(withOddParity(0x2f)).toBe(0x2f);
    expect(withOddParity(0x2c)).toBe(0x2c);
    expect(withOddParity(0x48)).toBe(0xc8);
    expect(withOddParity(0x00)).toBe(0x80);
    for (let b = 0; b < 128; b++) expect(hasOddParity(withOddParity(b))).toBe(true);
  });
});

describe("timecode", () => {
  const df = resolveCaptionFrameRate(29.97, true);
  const ndf = resolveCaptionFrameRate(29.97, false);
  it("drops labels 00 and 01 at each minute except every tenth", () => {
    expect(framesToTimecode(1799, df)).toBe("00:00:59;29");
    expect(framesToTimecode(1800, df)).toBe("00:01:00;02");
    expect(framesToTimecode(17982, df)).toBe("00:10:00;00");
    expect(framesToTimecode(107892, df)).toBe("01:00:00;00");
  });
  it("round-trips every frame of the first ten minutes", () => {
    for (let f = 0; f < 18000; f += 7) expect(timecodeToFrames(framesToTimecode(f, df), df)).toBe(f);
  });
  it("counts non-drop frames at the nominal 30 base", () => {
    expect(framesToTimecode(1800, ndf)).toBe("00:01:00:00");
    expect(timecodeToFrames("00:00:03:00", ndf)).toBe(90);
  });
  it("rejects malformed and out-of-range timecodes", () => {
    expect(timecodeToFrames("00:00:00:30", ndf)).toBeNull();
    expect(timecodeToFrames("nope", ndf)).toBeNull();
  });
});

describe("SCC export, hand-checked fixture", () => {
  // "Hello" shown 1.00 s - 3.00 s at 29.97 non-drop (frames 30 and 90).
  //   RCL RCL  ENM ENM  PAC(row 15, indent 12) x2  TO1 x2  He ll o<null>  EOC EOC
  //   9420 9420 94ae 94ae 9476 9476 97a1 97a1 c8e5 ecec ef80 942f 942f
  // Width 5 centres at column 13 = indent 12 + tab offset 1. 11 loading pairs
  // put the first at frame 30 - 11 = 19; the EOC lands exactly on frame 30.
  it("encodes a pop-on caption with the EOC on the cue start frame", () => {
    const { content, issues } = encodeScc([cue("a", 1, 3, "Hello")], NDF);
    expect(issues).toEqual([]);
    expect(content).toBe(
      [
        "Scenarist_SCC V1.0",
        "",
        "00:00:00:19\t9420 9420 94ae 94ae 9476 9476 97a1 97a1 c8e5 ecec ef80 942f 942f",
        "",
        "00:00:03:00\t942c 942c",
        "",
      ].join("\n"),
    );
  });

  it("uses the semicolon separator in drop-frame", () => {
    const { content } = encodeScc([cue("a", 61, 63, "Hi")], { frameRate: 29.97 });
    expect(content).toMatch(/^\d\d:\d\d:\d\d;\d\d\t/m);
  });

  it("places two lines on rows 14 and 15 with their own PACs", () => {
    const { content } = encodeScc([cue("a", 5, 7, "AB\nCD")], NDF);
    // row 14: first byte 0x14, 0x40|(8+indent/4)<<1 ; "AB" width 2 -> col 15 = indent 12 + TO3.
    expect(content).toContain("9476 9476 9723 9723"); // not row 14 -> row 15 for 2nd line below
    const lines = content.split("\n")[2].split("\t")[1].split(" ");
    // 9440+... row 14 PAC: 0x14 0x40|0x16 = 0x56 -> parity: 0101 0110 = four ones -> 0xd6
    expect(lines).toContain("94d6");
  });

  it("writes italics as a mid-row code that replaces the space before it", () => {
    const { content } = encodeScc([cue("a", 2, 4, "a <i>b</i>")], NDF);
    // a<null> | mid-row italics (0x11 0x2e) | b<null>
    expect(content).toContain("6180 91ae 6280");
  });

  it("writes underline at the start of a line in the PAC and later changes as mid-row", () => {
    const { content } = encodeScc([cue("a", 2, 4, "<u>ab</u> c")], NDF);
    // PAC row 15, indent 12, underline: 0x14, 0x60|(11<<1)|1 = 0x77 -> parity: seven bits 1110111 six ones -> 0xf7
    expect(content).toContain("94f7 94f7");
    // mid-row white (0x11 0x20) replaces the gap... the space stays: "ab" then 0x11 0x20 then "c"
    expect(content).toContain("9120");
  });

  it("sends extended characters after a fallback cell, never starting a pair with a null", () => {
    const { content } = encodeScc([cue("a", 2, 4, "\u00c1")], NDF);
    // fallback 'A' (0x41 -> parity 0xc1) then a null pad, then 0x12 0x20 (0x92 0x20); not doubled
    expect(content).toContain("c180 9220");
    expect(content).not.toContain("9220 9220");
    expect(content).not.toMatch(/ 80[0-9a-f]{2}\b/);
  });

  it("encodes ASCII symbols re-purposed by CEA-608 through the extended set", () => {
    const { content } = encodeScc([cue("a", 2, 4, "a*b")], NDF);
    // '*' is 0x12 0x28 with a fallback cell: the basic byte 0x2a would show an a-acute
    expect(content).toContain("92a8");
    expect(content).not.toMatch(/\b2a/i);
  });

  it("sends special characters as a standalone 0x11 pair", () => {
    const { content } = encodeScc([cue("a", 2, 4, "\u266a ok")], NDF);
    expect(content).toContain("9137"); // 0x11 0x37 (0x37 already has odd parity)
  });

  it("sends the 608 basic-set letters (n-tilde) as plain bytes", () => {
    const { content } = encodeScc([cue("a", 2, 4, "ni\u00f1o")], NDF);
    // 0x7e with odd parity: 1111110 six ones -> 0xfe
    expect(content).toContain("fe");
  });

  it("reports characters CEA-608 cannot carry", () => {
    const { issues } = encodeScc([cue("a", 2, 4, "x \u4e2d")], NDF);
    expect(issues.some((i) => i.code === "scc-unsupported-char")).toBe(true);
  });
});

describe("SCC export layout, timing and validation", () => {
  it("wraps lines over 32 columns and reports it", () => {
    const text = "This line is clearly longer than thirty two characters wide";
    const result = encodeScc([cue("a", 2, 6, text)], NDF);
    expect(result.maxRowWidth).toBeLessThanOrEqual(32);
    expect(result.issues.some((i) => i.code === "scc-line-wrapped")).toBe(true);
    const back = parseScc(result.content, { frameRate: 29.97 });
    expect(back.subtitles[0].text.split("\n").every((l) => l.length <= 32)).toBe(true);
    expect(back.subtitles[0].text.replace(/\n/g, " ")).toBe(text);
  });

  it("drops rows beyond four and flags an error", () => {
    const text = Array.from({ length: 6 }, (_, i) => `abcdefghij abcdefghij ${i}`).join("\n");
    const result = encodeScc([cue("a", 2, 6, text)], NDF);
    expect(result.issues.some((i) => i.code === "scc-too-many-lines" && i.severity === "error")).toBe(true);
  });

  it("delays a caption that cannot be pre-rolled and says so", () => {
    const result = encodeScc([cue("a", 0.2, 2, "Hello there")], NDF);
    expect(result.delayedCues).toBe(1);
    expect(result.issues.some((i) => i.code === "scc-delayed")).toBe(true);
  });

  it("does not delay when there is room (offset)", () => {
    const result = encodeScc([cue("a", 0.2, 2, "Hello there")], { ...NDF, offsetSeconds: 3600 });
    expect(result.delayedCues).toBe(0);
  });

  it("skips the EDM when the next caption replaces the previous one", () => {
    const { content } = encodeScc([cue("a", 5, 7, "one"), cue("b", 7, 9, "two")], NDF);
    const edms = content.match(/942c 942c/g) ?? [];
    expect(edms.length).toBe(1); // only after the last caption
  });

  it("interleaves the EDM with the next caption's loading when they are close", () => {
    const { content, issues } = encodeScc(
      [cue("a", 5, 7, "one"), cue("b", 7.2, 9, "two two two two")],
      NDF,
    );
    expect(issues.filter((i) => i.code === "scc-delayed")).toEqual([]);
    const back = parseScc(content, { frameRate: 29.97 });
    expect(back.subtitles.map((s) => s.text)).toEqual(["one", "two two two two"]);
    expect(back.subtitles[0].endTime).toBeCloseTo(7, 1);
  });

  it("emits chronological, non-overlapping lines", () => {
    const cues = Array.from({ length: 12 }, (_, i) => cue(`c${i}`, 5 + i * 2, 6.5 + i * 2, `Caption number ${i}`));
    const { content } = encodeScc(cues, NDF);
    const frames = content
      .split("\n")
      .filter((l) => /^\d\d:/.test(l))
      .map((l) => ({ tc: l.split("\t")[0], n: l.split("\t")[1].split(" ").length }));
    const rate = resolveCaptionFrameRate(29.97, false);
    let end = -1;
    for (const f of frames) {
      const start = timecodeToFrames(f.tc, rate)!;
      expect(start).toBeGreaterThanOrEqual(end);
      end = start + f.n;
    }
  });
});

describe("SCC import", () => {
  const FIXTURE = [
    "Scenarist_SCC V1.0",
    "",
    "00:00:00:19\t9420 9420 94ae 94ae 9476 9476 97a1 97a1 c8e5 ecec ef80 942f 942f",
    "",
    "00:00:03:00\t942c 942c",
    "",
  ].join("\n");

  it("decodes the hand-checked pop-on fixture", () => {
    const { subtitles, errors } = parseScc(FIXTURE, NDF);
    expect(errors).toEqual([]);
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0].text).toBe("Hello");
    expect(subtitles[0].startTime).toBeCloseTo(30 / 29.97, 3);
    expect(subtitles[0].endTime).toBeCloseTo(90 / 29.97, 3);
  });

  it("ignores the doubled control codes (no duplicate cues)", () => {
    const { subtitles } = parseScc(FIXTURE, NDF);
    expect(subtitles).toHaveLength(1);
  });

  it("decodes roll-up captions (RU2): one cue per carriage return window", () => {
    const scc = [
      "Scenarist_SCC V1.0",
      "",
      // RU2 x2, CR x2, PAC row 15 indent 0 x2, "AB"
      "00:00:01:00\t9425 9425 94ad 94ad 9470 9470 c142",
      "",
      // CR x2 then PAC again + "CD"
      "00:00:02:00\t94ad 94ad 9470 9470 4344",
      "",
      "00:00:03:00\t94ad 94ad",
      "",
      "00:00:04:00\t942c 942c",
      "",
    ].join("\n");
    const { subtitles, errors } = parseScc(scc, NDF);
    expect(errors).toEqual([]);
    expect(subtitles.map((s) => s.text)).toEqual(["AB", "AB\nCD", "CD"]);
  });

  it("decodes paint-on captions (RDC)", () => {
    const scc = [
      "Scenarist_SCC V1.0",
      "",
      "00:00:01:00\t9429 9429 9470 9470 c1c2",
      "",
      "00:00:02:00\t942c 942c",
      "",
    ].join("\n");
    const { subtitles } = parseScc(scc, NDF);
    expect(subtitles.map((s) => s.text)).toEqual(["AB"]);
    // RDC x2, PAC x2 are four pairs; the text arrives on pair 5 (frame 34).
    expect(subtitles[0].startTime).toBeCloseTo(34 / 29.97, 3);
    expect(subtitles[0].endTime).toBeCloseTo(60 / 29.97, 3);
  });

  it("reads PAC rows into separate lines and keeps style tags on request", () => {
    const { content } = encodeScc([cue("a", 5, 8, "<i>Whisper</i> plain\nsecond <u>line</u>")], NDF);
    const kept = parseScc(content, { ...NDF, styleTags: "keep" });
    expect(kept.subtitles[0].text).toBe("<i>Whisper</i> plain\nsecond <u>line</u>");
    const stripped = parseScc(content, NDF);
    expect(stripped.subtitles[0].text).toBe("Whisper plain\nsecond line");
  });

  it("flags bad parity and reports unparseable lines", () => {
    const bad = "Scenarist_SCC V1.0\n\n00:00:00:00\t1420 1420\n\nnot a line\n";
    const r = parseScc(bad, NDF);
    expect(r.issues.some((i) => i.code === "scc-parity")).toBe(true);
    expect(r.errors).toHaveLength(1);
  });

  it("requires the Scenarist header", () => {
    expect(parseScc("hello", NDF).errors[0].message).toMatch(/header/i);
  });

  it("applies the offset in reverse", () => {
    const out = encodeScc([cue("a", 5, 8, "Hello")], { ...NDF, offsetSeconds: 3600 }).content;
    const back = parseScc(out, { ...NDF, offsetSeconds: 3600 });
    expect(back.subtitles[0].startTime).toBeCloseTo(5, 1);
  });
});

describe("SCC round trips", () => {
  const frame = 1 / 29.97;
  const texts = [
    "Welcome to the show.",
    "Um, this is like great.",
    "Caf\u00e9 \u00bfqu\u00e9 tal? ni\u00f1o \u266a",
    "Two lines\nof text here",
    "50% off * today \\ yes | no ~",
    "\u00c1\u00c9\u00d3\u00da \u00dc\u00fc \u00c0\u00c2\u00c7 \u00ab quoted \u00bb",
    "\u00dfeta \u00e4\u00f6\u00c5\u00f8 \u2014 \u201cdash\u201d",
  ];
  for (const drop of [false, true]) {
    it(`round-trips text and times within one frame (${drop ? "drop-frame" : "non-drop"})`, () => {
      const cues = texts.map((t, i) => cue(`c${i}`, 20 + i * 4.3, 20 + i * 4.3 + 2.9, t));
      const options = { frameRate: 29.97, dropFrame: drop, offsetSeconds: 3600 } as const;
      const exported = encodeScc(cues, options);
      expect(exported.delayedCues).toBe(0);
      const back = parseScc(exported.content, options);
      expect(back.errors).toEqual([]);
      expect(back.subtitles).toHaveLength(cues.length);
      back.subtitles.forEach((s, i) => {
        expect(s.text).toBe(cues[i].text);
        expect(Math.abs(s.startTime - cues[i].startTime)).toBeLessThanOrEqual(frame);
        expect(Math.abs(s.endTime - cues[i].endTime)).toBeLessThanOrEqual(frame);
      });
    });
  }

  it("exportScc returns the same file as encodeScc", () => {
    const cues = [cue("a", 2, 4, "x")];
    expect(exportScc(cues, NDF)).toBe(encodeScc(cues, NDF).content);
  });

  it("selects one caption track", () => {
    const cues: Subtitle[] = [
      { ...cue("a", 5, 7, "english"), captionTrackId: "en" },
      { ...cue("b", 5, 7, "espa\u00f1ol"), captionTrackId: "es" },
    ];
    const es = parseScc(encodeScc(cues, { ...NDF, captionTrackId: "es" }).content, NDF);
    expect(es.subtitles.map((s) => s.text)).toEqual(["espa\u00f1ol"]);
  });
});

const FFMPEG = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].find((p) => existsSync(p));

describe.skipIf(!FFMPEG)("SCC decoded by ffmpeg's CEA-608 decoder (independent cross-check)", () => {
  it("shows the same text our importer reads", () => {
    const cues = [
      cue("a", 20, 23, "Welcome to the show."),
      cue("b", 24, 27, "Two lines\nof text here"),
      cue("c", 28, 31, "Caf\u00e9 \u00bfqu\u00e9 tal? ni\u00f1o \u266a"),
      cue("d", 32, 35, "\u00c1\u00c9 \u00dc\u00fc \u00ab q \u00bb 50% a*b"),
      cue("e", 36, 39, "x \\ y | z ~ ^ _ { }"),
    ];
    const dir = mkdtempSync(join(tmpdir(), "scc-xcheck-"));
    const file = join(dir, "captions.scc");
    writeFileSync(file, encodeScc(cues, { frameRate: 29.97, dropFrame: true, offsetSeconds: 3600 }).content);
    const srt = execFileSync(FFMPEG!, ["-v", "error", "-i", file, "-f", "srt", "-"], { encoding: "utf8" });
    const texts = srt
      .split(/\n\n/)
      .map((block) => block.split("\n").slice(2).join("\n").replace(/<[^>]+>|\{\\[^}]*\}|\\h/g, "").trim())
      .filter(Boolean);
    expect(texts).toEqual(cues.map((c) => c.text));
  });
});
