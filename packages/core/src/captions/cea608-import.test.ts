import { describe, expect, it } from "vitest";
import { MCC_HELLO, SCC_POSITIONED } from "./fixtures";
import { parseScc } from "./scc";
import { parseMcc } from "./mcc";
import { Cea608Decoder, mapCea608Cue } from "./cea608-decoder";
import { withOddParity } from "./cea608-tables";

const F = 30000 / 1001;

describe("SCC import: positions, colours, channels (hand-built hex fixture)", () => {
  it("imports CC1 captions with timing, row/indent placement and colour, and reports CC2", () => {
    const r = parseScc(SCC_POSITIONED);
    expect(r.errors).toEqual([]);
    expect(r.subtitles.map((s) => s.text)).toEqual(["Left side", "Yellow"]);

    const [left, yellow] = r.subtitles;
    expect(left.startTime).toBeCloseTo(41 / F, 3);
    expect(left.endTime).toBeCloseTo(90 / F, 3);
    // Row 2, indent 8: top 10 + 1 * 80/15 = 15.3 %, left edge 10 + 8 * 80/32 = 30 %.
    expect(left.cueSettings).toEqual({
      line: 15.3,
      snapToLines: false,
      lineAlign: "start",
      position: 30,
      positionAlign: "line-left",
      size: 60,
      align: "left",
    });
    expect(left.style).toBeUndefined();

    // Bottom row, text centred (cols 13..18 around the middle): default placement, yellow text.
    expect(yellow.startTime).toBeCloseTo(130 / F, 3);
    expect(yellow.cueSettings).toBeUndefined();
    expect(yellow.style?.color).toBe("#ffff00");

    const other = r.issues.find((i) => i.code === "cc-other-channel");
    expect(other?.message).toContain("CC2");
    expect(other?.message).toMatch(/caption channel 2/);
    expect(r.issues.some((i) => i.code === "cc-positioned")).toBe(true);
  });

  it("imports CC2 when asked and then reports nothing for CC1 text it skipped silently before", () => {
    const r = parseScc(SCC_POSITIONED, { ccChannel: 2 });
    expect(r.subtitles.map((s) => s.text)).toEqual(["Channel two"]);
    expect(r.subtitles[0].startTime).toBeCloseTo(((7 * 30) + 12) / F, 3);
    expect(r.issues.find((i) => i.code === "cc-other-channel")?.message).toContain("CC1");
  });

  it("maps centred, right-heavy and mixed-indent placements", () => {
    const centred = mapCea608Cue({ text: "x", start: 0, end: 1, mode: "pop", colours: [], lines: [{ row: 3, startCol: 10, endCol: 21 }] });
    expect(centred.cueSettings).toMatchObject({ position: 50, align: "center", line: 20.7 });
    const mixed = mapCea608Cue({
      text: "x",
      start: 0,
      end: 1,
      mode: "pop",
      colours: [],
      lines: [
        { row: 14, startCol: 2, endCol: 9 },
        { row: 15, startCol: 6, endCol: 12 },
      ],
    });
    expect(mixed.mixedIndent).toBe(true);
    expect(mixed.cueSettings?.position).toBe(15);
  });

  it("reports text-service data, XDS, flashing and background codes instead of dropping them silently", () => {
    const d = new Cea608Decoder();
    const p = (a: number, b: number, t: number, f: 1 | 2 = 1) => d.feed(withOddParity(a), withOddParity(b), t, f);
    p(0x14, 0x2a, 0); // TR: text mode
    p(0x14, 0x2a, 0.03);
    p(0x41, 0x42, 0.06); // text service characters
    p(0x14, 0x20, 0.1); // RCL leaves text mode
    p(0x14, 0x20, 0.13);
    p(0x14, 0x28, 0.2); // flash on
    p(0x10, 0x23, 0.3); // background attribute
    p(0x01, 0x03, 0.4, 2); // XDS start
    p(0x41, 0x42, 0.5, 2);
    const kinds = d.issues().map((i) => i.code);
    expect(kinds).toEqual(expect.arrayContaining(["cc-text-service", "cc-flash", "cc-background", "cc-xds"]));
  });

  it("decodes colour per PAC and mid-row, with the first colour winning and a warning for mixed colours", () => {
    const d = new Cea608Decoder();
    const send = (pairs: Array<[number, number]>, t0: number) => pairs.forEach(([a, b], i) => d.feed(withOddParity(a), withOddParity(b), t0 + i * 0.033, 1));
    send([
      [0x14, 0x20], [0x14, 0x20], [0x14, 0x2e], [0x14, 0x2e],
      [0x14, 0x60 | (1 << 1)], [0x14, 0x60 | (1 << 1)], // PAC row 15, green
      [0x41, 0x42], [0x11, 0x24], [0x43, 0x44], // "AB", mid-row red (attr 4 -> 0x28? see below), "CD"
      [0x14, 0x2f], [0x14, 0x2f],
      [0x14, 0x2c], [0x14, 0x2c],
    ], 1);
    d.finish(5);
    expect(d.cues[0].colours[0]).toBe(1); // green first
    expect(d.cues[0].text).toBe("AB CD");
  });
});

describe("MCC import (hand-built CDP fixture)", () => {
  it("decodes the CEA-608 packets at 30 fps drop-frame", () => {
    const r = parseMcc(MCC_HELLO);
    expect(r.errors).toEqual([]);
    expect(r.header["Time Code Rate"]).toBe("30DF");
    expect(r.subtitles).toHaveLength(1);
    const cue = r.subtitles[0];
    expect(cue.text).toBe("Hello");
    // EOC (doubled) is on frame 9; EDM on 00:00:02;00 = frame 60.
    expect(cue.startTime).toBeCloseTo(9 / F, 3);
    expect(cue.endTime).toBeCloseTo(60 / F, 3);
    // Row 15 indent 0 is a left-aligned bottom caption.
    expect(cue.cueSettings).toMatchObject({ align: "left", position: 10 });
    const other = r.issues.find((i) => i.code === "cc-other-channel");
    expect(other?.message).toContain("CC3");
    expect(r.issues.some((i) => i.code === "mcc-checksum")).toBe(false);
  });

  it("reports a corrupted checksum and a CEA-708 service instead of ignoring them", () => {
    const bad = MCC_HELLO.replace("T49S494F43ZZ72F4FC9420FD1520OO74ZZD6AB", "T49S494F43ZZ72F4FC9420FD1520OO74ZZD7AB");
    expect(parseMcc(bad).issues.some((i) => i.code === "mcc-checksum")).toBe(true);
    // One filler triplet replaced by a valid DTVCC (708) triplet FE 21 22, checksum fixed up: that is caption service data.
    const with708 = MCC_HELLO.replace("T49S494F43Z0672F4FCC8E5ROO74Z0606AB", "T49S494F43Z0672F4FCC8E5RONFE212274Z06BFAB");
    const r = parseMcc(with708);
    expect(r.issues.find((i) => i.code === "mcc-708")?.message).toMatch(/CEA-708/);
    expect(r.issues.some((i) => i.code === "mcc-checksum")).toBe(false);
    expect(r.subtitles[0].text).toBe("Hello");
  });
});
