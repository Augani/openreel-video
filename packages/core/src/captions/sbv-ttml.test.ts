import { describe, expect, it } from "vitest";
import {
  decodeCaptionText,
  exportCaptionFile,
  exportCaptions,
  parseCaptionBytes,
  parseCaptions,
} from "./caption-formats";
import { parseTtml } from "./ttml";
import { captionFont, DEFAULT_CAPTION_FONT_SIZE, DEFAULT_CAPTION_STYLE } from "./caption-layout";
import { parseSbv } from "./sbv";
import type { Subtitle } from "../types/timeline";

const SBV = `0:00:01.500,0:00:04.000
Hello there.
Second line.

0:00:05.000,0:00:07.250
General Kenobi!

bad block without timing

0:00:08.000,0:00:08.000
Zero length
`;

const TTML_IMSC = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="fr" ttp:timeBase="media">
  <head>
    <metadata><ttm:agent xml:id="a1" type="person"><ttm:name type="alias">Alice</ttm:name></ttm:agent></metadata>
    <styling>
      <style xml:id="base" tts:color="#FFFF00" tts:fontFamily="monospaceSansSerif" tts:backgroundColor="#000000CC"/>
      <style xml:id="it" style="base" tts:fontStyle="italic"/>
    </styling>
    <layout>
      <region xml:id="top" tts:origin="10% 5%" tts:extent="80% 15%" tts:displayAlign="before" tts:textAlign="center"/>
      <region xml:id="bot" tts:origin="10% 80%" tts:extent="80% 15%" tts:displayAlign="after"/>
    </layout>
  </head>
  <body>
    <!-- a comment -->
    <div style="base">
      <p xml:id="p1" begin="00:00:01.000" end="00:00:03.500" region="top" ttm:agent="a1">Bonjour &amp; salut<br/>le monde</p>
      <p begin="4s" dur="1.5s" region="bot"><span style="it">Italic</span> <span>plain</span></p>
      <p begin="6000ms" end="7000ms">   Spaced
        out   text </p>
      <p end="9s">No begin is fine</p>
      <p>No timing at all</p>
      <p begin="1:2:3:4:5" end="9s">Bad time</p>
    </div>
  </body>
</tt>`;

describe("SBV", () => {
  it("parses cues, multi-line text and reports bad blocks with line numbers", () => {
    const r = parseSbv(SBV);
    expect(r.subtitles.map((c) => [c.startTime, c.endTime, c.text])).toEqual([
      [1.5, 4, "Hello there.\nSecond line."],
      [5, 7.25, "General Kenobi!"],
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([8, 10]);
  });

  it("is auto-detected by parseCaptions, with CRLF and BOM", () => {
    const r = parseCaptions(`\uFEFF${SBV.replace(/\n/g, "\r\n")}`, { language: "en", captionTrackId: "en" });
    expect(r.format).toBe("sbv");
    expect(r.subtitles).toHaveLength(2);
    expect(r.subtitles[0].captionTrackId).toBe("en");
  });

  it("round-trips through export", () => {
    const cues = parseSbv(SBV).subtitles;
    const out = exportCaptions(cues, "sbv");
    expect(out).toBe("0:00:01.500,0:00:04.000\nHello there.\nSecond line.\n\n0:00:05.000,0:00:07.250\nGeneral Kenobi!\n");
    expect(parseSbv(out).subtitles.map((c) => c.text)).toEqual(cues.map((c) => c.text));
  });

  it("notes that styling is dropped on export", () => {
    const cue: Subtitle = { id: "a", text: "x", startTime: 0, endTime: 1, cueSettings: { line: 10 } };
    expect(exportCaptionFile([cue], "sbv").issues[0]?.code).toBe("sbv-style");
  });
});

describe("TTML / DFXP import", () => {
  const r = parseTtml(TTML_IMSC);

  it("reads clock, offset and ms times, parent-relative end, and skips bad paragraphs with line numbers", () => {
    expect(r.subtitles.map((c) => [c.startTime, c.endTime])).toEqual([
      [1, 3.5],
      [4, 5.5],
      [6, 7],
      [0, 9],
    ]);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0].message).toMatch(/no timing/i);
    expect(r.errors[1].message).toMatch(/begin time/i);
    expect(r.errors[0].line).toBeGreaterThan(10);
  });

  it("decodes entities, br and whitespace", () => {
    expect(r.subtitles[0].text).toBe("Bonjour & salut\nle monde");
    expect(r.subtitles[1].text).toBe("Italic plain");
    expect(r.subtitles[2].text).toBe("Spaced out text");
  });

  it("maps agents, language, colours, fonts, region layout", () => {
    const c = r.subtitles[0];
    expect(c.speaker).toBe("Alice");
    expect(c.language).toBe("fr");
    expect(c.style).toMatchObject({ color: "#FFFF00", fontFamily: "monospace", backgroundColor: "rgba(0,0,0,0.8)", position: "top" });
    expect(c.cueSettings).toMatchObject({ align: "center", snapToLines: false, size: 80, position: 50, lineAlign: "start" });
    expect(r.subtitles[1].style?.position).toBe("bottom");
    expect(r.subtitles[1].cueSettings?.line).toBe(95);
  });

  it("keeps italic runs as tags on request", () => {
    expect(parseTtml(TTML_IMSC, { styleTags: "keep" }).subtitles[1].text).toBe("<i>Italic</i> plain");
  });

  it("is auto-detected by parseCaptions and bytes (UTF-16 with BOM)", () => {
    expect(parseCaptions(TTML_IMSC).format).toBe("ttml");
    const u16 = new Uint8Array(2 + TTML_IMSC.length * 2);
    u16[0] = 0xff;
    u16[1] = 0xfe;
    for (let i = 0; i < TTML_IMSC.length; i++) {
      u16[2 + i * 2] = TTML_IMSC.charCodeAt(i) & 0xff;
      u16[3 + i * 2] = TTML_IMSC.charCodeAt(i) >> 8;
    }
    expect(parseCaptionBytes(u16).subtitles).toHaveLength(4);
  });

  it("handles DFXP with namespace prefixes, frame / tick times and offsets", () => {
    const dfxp = `<?xml version="1.0"?>
<tt:tt xmlns:tt="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="25" ttp:tickRate="10000000" ttp:timeBase="smpte">
<tt:body><tt:div>
<tt:p begin="01:00:01:12" end="01:00:03:00">One</tt:p>
<tt:p begin="20000000t" end="30000000t">Two</tt:p>
<tt:p begin="50f" end="75f">Three</tt:p>
</tt:div></tt:body></tt:tt>`;
    expect(parseTtml(dfxp).subtitles.map((c) => [c.startTime, c.endTime]).slice(1)).toEqual([
      [2, 3],
      [2, 3],
    ]);
    const d = parseTtml(dfxp, { offsetSeconds: 3600 });
    expect(d.subtitles.map((c) => [c.startTime, c.endTime])).toEqual([[1.48, 3]]);
  });

  it("derives paragraph time from timed spans and honours div offsets", () => {
    const d = parseTtml(`<tt xmlns="http://www.w3.org/ns/ttml"><body><div begin="10s"><p><span begin="1s" end="2s">a</span><span begin="2s" end="4s">b</span></p></div></body></tt>`);
    expect(d.subtitles[0]).toMatchObject({ startTime: 11, endTime: 14, text: "ab" });
  });

  it("tolerates unterminated and stray markup", () => {
    const d = parseTtml(`<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="0s" end="1s">ok</p></b><p begin="1s" end="2s">cut off`);
    expect(d.subtitles.map((c) => c.text)).toEqual(["ok", "cut off"]);
  });

  it("surfaces a clear error for non-TTML XML and for a missing body", () => {
    expect(parseTtml("<html><body/></html>").errors[0].message).toMatch(/Not a TTML/);
    expect(parseTtml(`<tt xmlns="http://www.w3.org/ns/ttml"><head/></tt>`).errors[0].message).toMatch(/no <body>/);
  });

  it("rejects other XML / HTML with a clear message", () => {
    const r = parseCaptions("<html><body>hi</body></html>");
    expect(r.subtitles).toEqual([]);
    expect(r.errors[0].message).toMatch(/Not a TTML/);
  });

  it("resolves a region that references a <style> and maps origin to position", () => {
    const xml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><head><styling>
<style xml:id="s1" tts:color="#FF0000" tts:textAlign="right" tts:displayAlign="after"/></styling>
<layout><region xml:id="r1" style="s1" tts:origin="10% 70%" tts:extent="80% 20%"/></layout></head>
<body><div><p begin="0s" end="2s" region="r1">Hi</p></div></body></tt>`;
    const r = parseTtml(xml);
    expect(r.errors).toEqual([]);
    expect(r.subtitles[0].style?.color).toBe("#FF0000");
    expect(r.subtitles[0].cueSettings?.align).toBe("right");
    expect(r.subtitles[0].style?.position).toBe("bottom");
    const low = parseTtml(xml.replace("10% 70%", "10% 5%").replace("80% 20%", "80% 10%"));
    expect(low.subtitles[0].style?.position).toBe("top");
  });

  it("round-trips cue vertical position through TTML regions", () => {
    const back = parseTtml(exportCaptions([
      { id: "1", text: "a", startTime: 0, endTime: 1, cueSettings: { line: 60, snapToLines: false } },
      { id: "2", text: "b", startTime: 1, endTime: 2 },
    ] as Subtitle[], "ttml"));
    expect(back.subtitles[0].cueSettings?.line).toBe(60);
    expect(back.subtitles[0].style?.position).toBe("center");
    expect(back.subtitles[1].cueSettings?.line).toBe(96);
  });

  it("round-trips our own TTML export", () => {
    const cues: Subtitle[] = [
      { id: "1", text: "A & B\nline", startTime: 1, endTime: 2.5, speaker: "Bob" },
      { id: "2", text: "C", startTime: 3, endTime: 4 },
    ];
    const back = parseTtml(exportCaptions(cues, "ttml"));
    expect(back.errors).toEqual([]);
    expect(back.subtitles.map((c) => [c.text, c.startTime, c.endTime, c.speaker])).toEqual([
      ["A & B\nline", 1, 2.5, "Bob"],
      ["C", 3, 4, undefined],
    ]);
  });
});

describe("decodeCaptionText", () => {
  it("falls back to Windows-1252 for legacy files", () => {
    expect(decodeCaptionText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
  });
});

describe("TTML fidelity", () => {
  const doc = (body: string, head = "") =>
    `<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:lang="en"><head>${head}</head><body><div>${body}</div></body></tt>`;

  it("uses the shared caption defaults, not a hardcoded size or quoted generic family", () => {
    const r = parseTtml(doc(`<p begin="0s" end="2s" tts:color="#FFFF00">Hi</p>`));
    expect(r.subtitles[0].style?.fontSize).toBe(DEFAULT_CAPTION_FONT_SIZE);
    expect(r.subtitles[0].style?.fontFamily).toBe(DEFAULT_CAPTION_STYLE.fontFamily);
    expect(r.subtitles[0].style?.color).toBe("#FFFF00");
  });

  it("promotes a uniform span colour to the cue and reports mixed colours", () => {
    const one = parseTtml(doc(`<p begin="0s" end="2s"><span tts:color="red">Hi</span> <span tts:color="red">there</span></p>`));
    expect(one.subtitles[0].style?.color).toBe("red");
    const mixed = parseTtml(doc(`<p begin="0s" end="2s"><span tts:color="red">Hi</span> <span tts:color="blue">there</span></p>`));
    expect(mixed.subtitles[0].style?.color).toBe("red");
    expect(mixed.issues.some((i) => /multi-colour/.test(i.message))).toBe(true);
  });

  it("keeps per-cue colour through TTML export and re-import", () => {
    const cues: Subtitle[] = [
      { id: "1", text: "A", startTime: 0, endTime: 1, style: { ...DEFAULT_CAPTION_STYLE, color: "#ffff00" } },
      { id: "2", text: "B", startTime: 2, endTime: 3, style: { ...DEFAULT_CAPTION_STYLE, color: "#00ff00" } },
    ];
    const back = parseTtml(exportCaptions(cues, "ttml"));
    expect(back.subtitles.map((c) => c.style?.color?.toLowerCase())).toEqual(["#ffff00", "#00ff00"]);
  });

  it("does not treat SRT with inline tags as TTML", () => {
    const srt = "<i>1</i>\n00:00:01,000 --> 00:00:02,000\n<i>Hello</i> <tt>mono</tt>\n";
    const r = parseCaptions(srt);
    expect(r.format).toBe("srt");
    const plain = parseCaptions("1\n00:00:01,000 --> 00:00:02,000\n<tt>mono</tt>\n");
    expect(plain.format).toBe("srt");
    expect(plain.subtitles).toHaveLength(1);
  });

  it("writes generic families unquoted for canvas", () => {
    expect(captionFont(24, "sans-serif")).toBe("bold 24px sans-serif, sans-serif");
    expect(captionFont(24, "Inter")).toBe('bold 24px "Inter", sans-serif');
  });
});
