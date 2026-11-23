import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Subtitle } from "../types/timeline";
import { MCC_HELLO } from "./fixtures";
import { buildCdp, compressMccBytes, encodeMcc, expandMccHex, isMccContent, parseMcc, wrapAnc } from "./mcc";
import { exportCaptionFileAsync, importCaptionFile } from "./caption-import";

const cue = (id: string, startTime: number, endTime: number, text: string): Subtitle => ({ id, text, startTime, endTime });

describe("MCC aliases", () => {
  it("expands every alias to the bytes the format defines", () => {
    expect(expandMccHex("G")).toBe("FA0000");
    expect(expandMccHex("H")).toBe("FA0000FA0000");
    expect(expandMccHex("O")).toBe("FA0000".repeat(9));
    expect(expandMccHex("P")).toBe("FB8080");
    expect(expandMccHex("Q")).toBe("FC8080");
    expect(expandMccHex("R")).toBe("FD8080");
    expect(expandMccHex("S")).toBe("9669");
    expect(expandMccHex("T")).toBe("6101");
    expect(expandMccHex("U")).toBe("E1000000");
    expect(expandMccHex("Z")).toBe("00");
    expect(expandMccHex("4g")).toBeNull();
  });

  it("compress then expand returns the original bytes for any byte string", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
        expect(expandMccHex(compressMccBytes(bytes))).toBe(hex);
      }),
    );
  });
});

describe("MCC packets", () => {
  it("builds a zero-sum CDP and an 8-bit ANC checksum", () => {
    const cdp = buildCdp(0x94, 0x20, 7, 4);
    expect(cdp[0]).toBe(0x96);
    expect(cdp[1]).toBe(0x69);
    expect(cdp[2]).toBe(cdp.length);
    expect(cdp.reduce((a, b) => a + b, 0) & 0xff).toBe(0);
    const anc = wrapAnc(cdp);
    expect([...anc.subarray(0, 3)]).toEqual([0x61, 0x01, cdp.length]);
    expect(anc.slice(0, -1).reduce((a, b) => a + b, 0) & 0xff).toBe(anc[anc.length - 1]);
  });

  it("reproduces an independently computed line byte for byte (CDP for the pair 9420 at 29.97 fps, sequence 0)", () => {
    // Computed by a separate script from SMPTE 334-2: 96 69, length 49, rate nibble 4, flags 43, seq 0000, 72 F4,
    // FC 94 20, FD 80 80, 18 filler triplets, 74 0000 and the zero-sum checksum 0B.
    expect(compressMccBytes(buildCdp(0x94, 0x20, 0, 4))).toBe("S494F43ZZ72F4FC9420ROO74ZZ0B");
  });
});

describe("MCC import errors are reported, never thrown", () => {
  it("rejects a file without the header", () => {
    const r = parseMcc("hello");
    expect(r.subtitles).toEqual([]);
    expect(r.errors[0].message).toMatch(/File Format/);
  });

  it("flags a bad line and keeps the rest", () => {
    const text = MCC_HELLO.replace("00:00:00;03\tT49S494F43Z0372F4FC94AEFD15AEOO74Z03B4AB", "00:00:00;03\t!!notcaption!!");
    const r = parseMcc(text);
    expect(r.errors.some((e) => /neither hexadecimal nor MCC aliases/.test(e.message))).toBe(true);
    expect(r.errors.every((e) => Number.isFinite(e.line))).toBe(true);
  });

  it("reports an unknown time code rate", () => {
    const r = parseMcc(MCC_HELLO.replace("30DF", "31"));
    expect(r.issues.some((i) => i.code === "mcc-rate")).toBe(true);
  });

  it("decodes every supported rate label", () => {
    for (const rate of ["24", "25", "30", "50", "60"]) {
      const text = [`File Format=MacCaption_MCC V1.0`, `Time Code Rate=${rate}`, ""].join("\n");
      expect(parseMcc(text).issues.some((i) => i.code === "mcc-rate")).toBe(false);
    }
  });
});

describe("MCC export", () => {
  const cues = [cue("a", 1, 3, "Hello\nworld"), cue("b", 4, 6, "Again")];

  it("writes a V2.0 header, the time code rate and one CDP per frame", () => {
    const { content } = encodeMcc(cues, { frameRate: 29.97, dropFrame: true });
    expect(content.startsWith("File Format=MacCaption_MCC V2.0")).toBe(true);
    expect(content).toContain("Time Code Rate=30DF");
    const lines = content.split("\n").filter((l) => /^\d\d:\d\d:\d\d[:;]\d\d\t/.test(l));
    expect(lines.length).toBeGreaterThan(20);
    for (const l of lines) {
      expect(l).toMatch(/^\d\d:\d\d:\d\d;\d\d\tT\d\dS\d\d4F43/); // ANC wrapper, CDP id, 29.97 rate nibble
      const bytes = expandMccHex(l.split("\t")[1])!;
      expect(bytes.length / 2).toBe(parseInt(bytes.slice(4, 6), 16) + 4);
    }
  });

  it("round-trips cues through the MCC parser at drop-frame and non-drop rates", () => {
    for (const opts of [{ frameRate: 29.97, dropFrame: true }, { frameRate: 29.97, dropFrame: false }, { frameRate: 25 }, { frameRate: 24 }]) {
      const { content } = encodeMcc(cues, opts);
      const r = parseMcc(content, {});
      expect(r.errors).toEqual([]);
      expect(r.subtitles.map((s) => s.text)).toEqual(["Hello\nworld", "Again"]);
      expect(r.subtitles[0].startTime).toBeCloseTo(1, 1);
      expect(r.subtitles[1].endTime).toBeCloseTo(6, 1);
    }
  });

  it("is deterministic", () => {
    expect(encodeMcc(cues).content).toBe(encodeMcc(cues).content);
  });

  it("exports through the async entry point and imports through the byte loader", async () => {
    const file = await exportCaptionFileAsync(cues, "mcc", { frameRate: 29.97 });
    expect(file.extension).toBe("mcc");
    const back = await importCaptionFile(file.bytes, { fileName: "x.mcc" });
    expect(back.format).toBe("mcc");
    expect(back.subtitles.map((s) => s.text)).toEqual(["Hello\nworld", "Again"]);
  });

  it("detects MCC content", () => {
    expect(isMccContent(MCC_HELLO)).toBe(true);
    expect(isMccContent("WEBVTT")).toBe(false);
  });
});

const FFMPEG = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].find((p) => existsSync(p));
const HAS_MCC =
  !!FFMPEG &&
  (() => {
    try {
      return /\bmcc\b/.test(execFileSync(FFMPEG, ["-hide_banner", "-formats"], { encoding: "utf8" }));
    } catch {
      return false;
    }
  })();

describe.skipIf(!HAS_MCC)("MCC cross-checked with ffmpeg's MacCaption demuxer, muxer and CEA-608 decoder", () => {
  it("ffmpeg reads the file we write and shows the same text and timing", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcc-"));
    const path = join(dir, "c.mcc");
    writeFileSync(path, encodeMcc([cue("a", 1, 3, "Cross check")], { frameRate: 29.97, dropFrame: false }).content);
    const out = execFileSync(FFMPEG!, ["-v", "error", "-i", path, "-f", "srt", "-"], { encoding: "utf8" });
    expect(out).toContain("Cross check");
    expect(out).toMatch(/00:00:0[01],\d{3} --> 00:00:0[23],\d{3}/);
  });

  it("we read the file ffmpeg's MCC muxer writes from an SCC", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcc-"));
    const scc = join(dir, "h.scc");
    const mcc = join(dir, "h.mcc");
    writeFileSync(
      scc,
      "Scenarist_SCC V1.0\n\n00:00:00:19\t9420 9420 94ae 94ae 9476 9476 97a1 97a1 c8e5 ecec ef80 942f 942f\n\n00:00:03:00\t942c 942c\n",
    );
    execFileSync(FFMPEG!, ["-v", "error", "-y", "-i", scc, "-map", "0", "-c:s", "copy", "-override_time_code_rate", "30", "-f", "mcc", mcc]);
    const r = parseMcc(readFileSync(mcc, "utf8"));
    expect(r.errors).toEqual([]);
    expect(r.issues.some((i) => i.code === "mcc-checksum")).toBe(false);
    expect(r.subtitles.map((s) => s.text)).toEqual(["Hello"]);
  });
});

describe("MCC frame rate round trip", () => {
  const cues = [cue("a", 1, 3, "Hello\nworld"), cue("b", 900, 903, "Fifteen minutes in")];
  const cases: Array<{ name: string; fps: number; drop?: boolean; label: string }> = [
    { name: "23.976", fps: 24000 / 1001, label: "24" },
    { name: "24", fps: 24, label: "24" },
    { name: "25", fps: 25, label: "25" },
    { name: "29.97 DF", fps: 30000 / 1001, drop: true, label: "30DF" },
    { name: "29.97 NDF", fps: 30000 / 1001, drop: false, label: "30" },
    { name: "59.94 DF", fps: 60000 / 1001, drop: true, label: "60DF" },
    { name: "59.94 NDF", fps: 60000 / 1001, drop: false, label: "60" },
  ];
  for (const c of cases) {
    it(`${c.name}: label ${c.label}, timing survives with the project rate and with no project rate`, () => {
      const { content } = encodeMcc(cues, { frameRate: c.fps, dropFrame: c.drop });
      expect(content).toContain(`Time Code Rate=${c.label}\n`);
      const withProject = parseMcc(content, { projectFrameRate: c.fps });
      expect(withProject.errors).toEqual([]);
      expect(withProject.subtitles.map((s) => s.text)).toEqual(["Hello\nworld", "Fifteen minutes in"]);
      expect(withProject.subtitles[1].startTime).toBeCloseTo(900, 1);
      // An OpenReel export records the exact rate, so it reads back right even with no project rate.
      const bare = parseMcc(content);
      expect(bare.subtitles[1].startTime).toBeCloseTo(900, 1);
    });
  }

  it("a 23.976 export read back as exactly 24 would drift; the project rate fixes a file with no recorded rate", () => {
    const { content } = encodeMcc(cues, { frameRate: 24000 / 1001 });
    const foreign = content.replace(/OpenReel Frame Rate=.*\n/, "");
    const literal = parseMcc(foreign);
    expect(literal.subtitles[1].startTime).toBeCloseTo(900 * (24000 / 1001 / 24), 1);
    expect(Math.abs(literal.subtitles[1].startTime - 900)).toBeGreaterThan(0.5);
    expect(literal.issues.some((i) => i.code === "mcc-rate-assumed" && i.severity === "info")).toBe(true);
    const fixed = parseMcc(foreign, { projectFrameRate: 24000 / 1001 });
    expect(fixed.subtitles[1].startTime).toBeCloseTo(900, 1);
    expect(fixed.issues.find((i) => i.code === "mcc-rate-assumed")?.message).toMatch(/project frame rate/);
  });

  it("ignores a project rate that is neither candidate for the label", () => {
    const { content } = encodeMcc(cues, { frameRate: 25 });
    const r = parseMcc(content, { projectFrameRate: 29.97 });
    expect(r.subtitles[1].startTime).toBeCloseTo(900, 1);
  });

  it("rejects an invalid dropped label without throwing", () => {
    const text = MCC_HELLO.replace("00:00:00;03", "00:01:00;01");
    const r = parseMcc(text);
    expect(r.errors.some((e) => /dropped drop-frame label/.test(e.message))).toBe(true);
  });
});
