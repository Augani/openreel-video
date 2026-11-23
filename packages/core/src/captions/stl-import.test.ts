import { describe, expect, it } from "vitest";
import { STL_CYRILLIC, STL_TELETEXT, buildStlFixture } from "./fixtures";
import { isStlContent, parseStl } from "./ebu-stl";

describe("EBU-STL import (byte-exact hand-built fixtures)", () => {
  it("builds a file the detector accepts: 1024-byte GSI + 128-byte TTI blocks", () => {
    expect(STL_TELETEXT.length).toBe(1024 + 4 * 128);
    expect(new TextDecoder().decode(STL_TELETEXT.subarray(3, 11))).toBe("STL25.01");
    expect(isStlContent(STL_TELETEXT)).toBe(true);
  });

  it("reads the header, timecodes at 25 fps and text of every subtitle", () => {
    const r = parseStl(STL_TELETEXT);
    expect(r.errors).toEqual([]);
    expect(r.header).toMatchObject({ codePage: "850", displayStandard: "1", characterCodeTable: "00", frameBase: 25, totalSubtitles: 4, maxRows: 23 });
    expect(r.subtitles.map((s) => s.text)).toEqual(["Top left", "Line one\nLine two", "Right aligned", "Red then green"]);
    expect(r.subtitles[1].startTime).toBe(4);
    expect(r.subtitles[1].endTime).toBeCloseTo(6 + 12 / 25, 6);
  });

  it("maps teletext colour, vertical position (row of 23) and justification into the caption model", () => {
    const [top, bottom, right, mixed] = parseStl(STL_TELETEXT).subtitles;
    // yellow (0x03) text, row 2 of 23 -> top at (2-1)/23 = 4.3 %, left justified.
    expect(top.style?.color).toBe("#ffff00");
    expect(top.cueSettings).toEqual({ line: 4.3, snapToLines: false, lineAlign: "start", position: 10, positionAlign: "line-left", size: 80, align: "left" });
    // Two lines starting at row 20 reach row 21 of 23: the default bottom, centred -> no settings.
    expect(bottom.cueSettings).toBeUndefined();
    expect(bottom.style).toBeUndefined();
    // Bottom row, justified right: horizontal only.
    expect(right.cueSettings).toEqual({ position: 90, positionAlign: "line-right", size: 80, align: "right" });
    // Red then green inside one subtitle: first colour (red) wins, and it is reported.
    expect(mixed.style?.color).toBe("#ff0000");
  });

  it("reports everything it cannot carry", () => {
    const codes = parseStl(STL_TELETEXT).issues.map((i) => i.code);
    expect(codes).toContain("stl-double-height");
    expect(codes).toContain("stl-colours-mixed");
    expect(codes).toContain("stl-positioned");
  });

  it("keeps italics as tags on request", () => {
    const r = parseStl(STL_TELETEXT, { styleTags: "keep" });
    expect(r.subtitles[2].text).toBe("Right <i>aligned</i>");
    expect(parseStl(STL_TELETEXT).subtitles[2].text).toBe("Right aligned");
  });

  it("decodes the Cyrillic code table (ISO 8859-5)", () => {
    const r = parseStl(STL_CYRILLIC);
    expect(r.header?.characterCodeTable).toBe("01");
    expect(r.subtitles[0].text).toBe("Привет");
    expect(r.issues.some((i) => i.code === "stl-cct")).toBe(false);
  });

  it("reads 30 fps files at the 30 frame base", () => {
    const bytes = buildStlFixture({ frameBase: 30, dsc: " ", mnr: 11, cues: [{ start: [0, 0, 1, 15], end: [0, 0, 2, 0], vp: 1, jc: 2, tf: [72, 105] }] });
    const r = parseStl(bytes);
    expect(r.subtitles[0].startTime).toBeCloseTo(1.5, 6);
    expect(r.subtitles[0].endTime).toBe(2);
    // Open subtitling, row 1 of 11: top of the picture.
    expect(r.subtitles[0].cueSettings?.line).toBe(0);
  });

  it("never throws on a truncated or garbage file and says what was wrong", () => {
    for (const bytes of [STL_TELETEXT.subarray(0, 1024), STL_TELETEXT.subarray(0, 1100), STL_TELETEXT.subarray(0, 900), new Uint8Array(0)]) {
      const r = parseStl(bytes);
      expect(Array.isArray(r.subtitles)).toBe(true);
      expect(r.errors.length + r.issues.length + r.subtitles.length).toBeGreaterThan(0);
    }
  });
});
