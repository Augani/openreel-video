import { describe, expect, it } from "vitest";
import type { Subtitle } from "../types/timeline";
import { encodeStl, exportStl, isStlContent, parseStl } from "./ebu-stl";

const cue = (id: string, startTime: number, endTime: number, text: string): Subtitle => ({
  id,
  text,
  startTime,
  endTime,
});

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
const GSI = 1024;

describe("EBU-STL export, hand-checked fixture", () => {
  const { bytes, issues, ttiBlocks } = encodeStl([cue("a", 1, 3, "Hi")], { frameRate: 25, title: "Café" , date: new Date(2026, 10, 12) });

  it("writes a 1024-byte GSI block and one 128-byte TTI block", () => {
    expect(issues).toEqual([]);
    expect(ttiBlocks).toBe(1);
    expect(bytes.length).toBe(GSI + 128);
  });

  it("fills the GSI fields at their EBU Tech 3264 offsets", () => {
    expect(ascii(bytes, 0, 3)).toBe("850"); // CPN
    expect(ascii(bytes, 3, 11)).toBe("STL25.01"); // DFC
    expect(ascii(bytes, 11, 12)).toBe("0"); // DSC: open subtitling
    expect(ascii(bytes, 12, 14)).toBe("00"); // CCT: Latin
    expect(ascii(bytes, 14, 16)).toBe("09"); // LC: English
    expect(bytes[16]).toBe(0x43); // OPT "Caf" + e-acute in code page 850 = 0x82
    expect(bytes[19]).toBe(0x82);
    expect(ascii(bytes, 224, 230)).toBe("261112"); // CD
    expect(ascii(bytes, 236, 238)).toBe("01"); // RN
    expect(ascii(bytes, 238, 243)).toBe("00001"); // TNB
    expect(ascii(bytes, 243, 248)).toBe("00001"); // TNS
    expect(ascii(bytes, 248, 251)).toBe("001"); // TNG
    expect(ascii(bytes, 251, 253)).toBe("40"); // MNC
    expect(ascii(bytes, 255, 256)).toBe("1"); // TCS
    expect(ascii(bytes, 256, 264)).toBe("00000000"); // TCP
    expect(ascii(bytes, 264, 272)).toBe("00000100"); // TCF = first in-cue 00:00:01:00
  });

  it("writes the TTI block field by field", () => {
    const tti = bytes.slice(GSI, GSI + 128);
    expect([...tti.slice(0, 5)]).toEqual([0x00, 0x00, 0x00, 0xff, 0x00]); // SGN, SN(le), EBN, CS
    expect([...tti.slice(5, 9)]).toEqual([0, 0, 1, 0]); // TCI 00:00:01:00
    expect([...tti.slice(9, 13)]).toEqual([0, 0, 3, 0]); // TCO 00:00:03:00
    expect(tti[13]).toBe(22); // VP: bottom, one row
    expect(tti[14]).toBe(2); // JC: centred
    expect(tti[15]).toBe(0); // CF: subtitle data
    expect([...tti.slice(16, 19)]).toEqual([0x48, 0x69, 0x8f]); // "Hi" then unused-space fill
    expect(tti.slice(18).every((b) => b === 0x8f)).toBe(true);
  });

  it("numbers subtitles in little-endian and links extension blocks", () => {
    const long = "x".repeat(40) + "\n" + "y".repeat(40) + "\n" + "z".repeat(40);
    const out = encodeStl([cue("a", 1, 3, "one"), cue("b", 4, 6, long)], { frameRate: 25, maxRows: 4 });
    expect(out.ttiBlocks).toBe(3); // 1 + two blocks (122 bytes)
    const b1 = out.bytes.slice(GSI + 128, GSI + 256);
    const b2 = out.bytes.slice(GSI + 256, GSI + 384);
    expect([b1[1], b1[2], b1[3]]).toEqual([1, 0, 0]); // SN 1, EBN 0 (more follows)
    expect([b2[1], b2[2], b2[3]]).toEqual([1, 0, 0xff]); // same SN, last block
    expect(ascii(out.bytes, 238, 243)).toBe("00003");
    expect(ascii(out.bytes, 243, 248)).toBe("00002");
  });
});

describe("ISO 6937 text", () => {
  const textBytes = (text: string) => {
    const out = encodeStl([cue("a", 1, 2, text)], { frameRate: 25 }).bytes;
    const tf = [...out.slice(GSI + 16, GSI + 128)];
    return tf.slice(0, tf.indexOf(0x8f));
  };
  it("writes diacritics as a prefix byte before the base letter", () => {
    expect(textBytes("é")).toEqual([0xc2, 0x65]); // acute + e
    expect(textBytes("ñ")).toEqual([0xc4, 0x6e]); // tilde + n
    expect(textBytes("Ç")).toEqual([0xcb, 0x43]); // cedilla + C
    expect(textBytes("ü")).toEqual([0xc8, 0x75]); // diaeresis + u
  });
  it("maps the characters that have their own code", () => {
    expect(textBytes("ß")).toEqual([0xfb]);
    expect(textBytes("Æ")).toEqual([0xe1]);
    expect(textBytes("£")).toEqual([0xa3]);
    expect(textBytes("$")).toEqual([0xa4]);
    expect(textBytes("¿")).toEqual([0xbf]);
  });
  it("marks characters it cannot encode", () => {
    const { issues } = encodeStl([cue("a", 1, 2, "中")], { frameRate: 25 });
    expect(issues.some((i) => i.code === "stl-unsupported-char")).toBe(true);
  });
  it("uses 0x80/0x81 for italics and 0x8A for a new row", () => {
    expect(textBytes("<i>a</i>\nb")).toEqual([0x80, 0x61, 0x81, 0x8a, 0x62]);
  });
});

describe("EBU-STL import", () => {
  it("round-trips the hand-checked cue", () => {
    const { subtitles, errors, header } = parseStl(exportStl([cue("a", 1, 3, "Hi")], { frameRate: 25 }));
    expect(errors).toEqual([]);
    expect(header?.diskFormatCode).toBe("STL25.01");
    expect(subtitles.map((s) => [s.text, s.startTime, s.endTime])).toEqual([["Hi", 1, 3]]);
  });

  it("rejects non-STL data", () => {
    expect(isStlContent(new Uint8Array(10))).toBe(false);
    expect(parseStl(new Uint8Array(2000)).errors).toHaveLength(1);
  });

  it("ignores comment blocks and reports a wrong block count", () => {
    const out = exportStl([cue("a", 1, 3, "Hi")], { frameRate: 25 });
    const withComment = new Uint8Array(out.length + 128);
    withComment.set(out);
    withComment[out.length + 15] = 0xff;
    withComment.fill(0x41, out.length + 16);
    const r = parseStl(withComment);
    expect(r.subtitles).toHaveLength(1);
    expect(r.issues.some((i) => i.code === "stl-block-count")).toBe(true);
  });

  it("skips teletext colour / box control codes", () => {
    const out = exportStl([cue("a", 1, 3, "Hi")], { frameRate: 25 });
    out.set([0x07, 0x0b, 0x0b, 0x48, 0x69, 0x0a, 0x0a], GSI + 16);
    expect(parseStl(out).subtitles[0].text).toBe("Hi");
  });

  it("reads cumulative subtitle sets as growing text", () => {
    const out = exportStl([cue("a", 1, 3, "one"), cue("b", 2, 3, "two")], { frameRate: 25 });
    out[GSI + 4] = 1;
    out[GSI + 128 + 4] = 3;
    expect(parseStl(out).subtitles.map((s) => s.text)).toEqual(["one", "one\ntwo"]);
  });

  it("applies the offset in reverse", () => {
    const out = exportStl([cue("a", 5, 8, "Hi")], { frameRate: 25, offsetSeconds: 36000 });
    expect(parseStl(out, { offsetSeconds: 36000 }).subtitles[0].startTime).toBe(5);
    expect(ascii(out, 256, 264)).toBe("10000000");
  });
});

describe("EBU-STL round trips", () => {
  const texts = [
    "Welcome to the show.",
    "Um, this is like great.",
    "Café ¿qué tal? ñandú",
    "<i>Italic</i> then plain\nsecond <u>underlined</u> row",
    "ÀÉÎÕÜ çãö ß Æ ø œ $5 £5 50%",
    "A very long line that must wrap because it is much longer than forty characters wide.",
    "x".repeat(40) + "\n" + "y".repeat(40) + "\n" + "z".repeat(30),
  ];
  for (const [label, frameRate] of [["25 fps", 25], ["29.97 fps", 29.97], ["30 fps", 30]] as const) {
    it(`round-trips text and times within one frame (${label})`, () => {
      const cues = texts.map((t, i) => cue(`c${i}`, 10 + i * 5.37, 10 + i * 5.37 + 3.21, t));
      const exported = encodeStl(cues, { frameRate, offsetSeconds: 36000, maxRows: 4 });
      const back = parseStl(exported.bytes, { frameRate, offsetSeconds: 36000, styleTags: "keep" });
      expect(back.errors).toEqual([]);
      expect(back.subtitles).toHaveLength(cues.length);
      back.subtitles.forEach((s, i) => {
        const expected = i === 5
          ? s.text // wrapped; compared below
          : cues[i].text;
        expect(s.text).toBe(expected);
        expect(Math.abs(s.startTime - cues[i].startTime)).toBeLessThanOrEqual(1 / frameRate);
        expect(Math.abs(s.endTime - cues[i].endTime)).toBeLessThanOrEqual(1 / frameRate);
      });
      expect(back.subtitles[5].text.replace(/\n/g, " ")).toBe(texts[5]);
      expect(back.subtitles[5].text.split("\n").every((l) => l.length <= 40)).toBe(true);
    });
  }

  it("strips style tags by default", () => {
    const out = exportStl([cue("a", 1, 3, "<i>x</i> y")], { frameRate: 25 });
    expect(parseStl(out).subtitles[0].text).toBe("x y");
  });

  it("selects one caption track", () => {
    const cues: Subtitle[] = [
      { ...cue("a", 1, 3, "english"), captionTrackId: "en" },
      { ...cue("b", 1, 3, "français"), captionTrackId: "fr" },
    ];
    const r = parseStl(exportStl(cues, { frameRate: 25, captionTrackId: "fr", language: "fr" }));
    expect(r.subtitles.map((s) => s.text)).toEqual(["français"]);
    expect(r.header?.languageCode).toBe("0F");
  });

  it("decodes the programme title through the GSI code page", () => {
    const out = exportStl([cue("a", 1, 3, "Hi")], { frameRate: 25, title: "Café Ñ" });
    expect(parseStl(out).header?.programmeTitle).toBe("Café Ñ");
  });
});
