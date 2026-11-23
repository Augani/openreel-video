import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { importCaptionFile } from "./caption-import";
import { parseCaptionBytes, parseCaptions } from "./caption-formats";
import { parseStl } from "./ebu-stl";
import { MCC_HELLO, SCC_POSITIONED, STL_CYRILLIC, STL_TELETEXT } from "./fixtures";
import { parseMcc } from "./mcc";
import { parseTimedTranscript } from "./plain-transcript";
import { parseSbv } from "./sbv";
import { parseScc } from "./scc";
import { parseTtml } from "./ttml";
import type { Subtitle } from "../types/timeline";

/**
 * Parsers face files from anywhere: they must never throw, and what they return must be usable
 * (finite times, end after start, text present) with problems reported as errors or issues.
 */

const valid = (subs: readonly Subtitle[]) => {
  for (const s of subs) {
    expect(Number.isFinite(s.startTime)).toBe(true);
    expect(Number.isFinite(s.endTime)).toBe(true);
    expect(s.endTime).toBeGreaterThan(s.startTime);
    expect(typeof s.text).toBe("string");
    expect(s.text.trim().length).toBeGreaterThan(0);
    if (s.cueSettings) for (const v of [s.cueSettings.line, s.cueSettings.position, s.cueSettings.size]) if (v !== undefined) expect(Number.isFinite(v)).toBe(true);
  }
};
const shape = (r: { subtitles: readonly Subtitle[]; errors: ReadonlyArray<{ line: number; message: string }>; issues?: ReadonlyArray<{ code: string; message: string }> }) => {
  valid(r.subtitles);
  for (const e of r.errors) {
    expect(Number.isFinite(e.line)).toBe(true);
    expect(e.message.length).toBeGreaterThan(0);
  }
  for (const i of r.issues ?? []) expect(i.message.length).toBeGreaterThan(0);
};

const RUNS = { numRuns: 300 };
const enc = (s: string) => new TextEncoder().encode(s);

/** Text that looks like the format, so the fuzz gets past the header check. */
const hexish = fc.array(fc.oneof(fc.constantFrom("9420", "94ae", "942f", "942c", "9429", "9425", "94ad", "9470", "c8e5", "ffff", "0000", "zz", "12"), fc.string({ unit: fc.constantFrom(..."0123456789abcdef".split("")), maxLength: 6 })), { maxLength: 40 }).map((a) => a.join(" "));
const tc = fc.constantFrom("00:00:01;00", "00:00:01:15", "99:99:99:99", "1:2:3", "00:59:59;29", "");

describe("importers never throw on garbage", () => {
  it("SCC", () => {
    fc.assert(fc.property(fc.array(fc.tuple(tc, hexish), { maxLength: 12 }), (rows) => {
      shape(parseScc(["Scenarist_SCC V1.0", "", ...rows.map(([t, h]) => `${t}\t${h}`)].join("\n")));
    }), RUNS);
    fc.assert(fc.property(fc.string({ maxLength: 300 }), (s) => shape(parseScc(s))), RUNS);
    fc.assert(fc.property(fc.string({ maxLength: 300 }), fc.constantFrom(1, 2, 3, 4), (s, ch) => shape(parseScc(`Scenarist_SCC V1.0\n\n${s}`, { ccChannel: ch as 1 | 2 | 3 | 4 })), ), RUNS);
  });

  it("MCC", () => {
    const alias = fc.constantFrom(..."GHIJKLMNOPQRSTUZ".split(""), "9669", "61", "01", "72", "F4", "FC", "94", "20", "74", "00", "5", "!");
    fc.assert(fc.property(fc.array(fc.tuple(tc, fc.array(alias, { maxLength: 40 }).map((a) => a.join(""))), { maxLength: 12 }), fc.constantFrom("30DF", "30", "24", "25", "50", "60", "60DF", "nope"), (rows, rate) => {
      shape(parseMcc([`File Format=MacCaption_MCC V2.0`, `Time Code Rate=${rate}`, "", ...rows.map(([t, h]) => `${t}\t${h}`)].join("\n")));
    }), RUNS);
    fc.assert(fc.property(fc.string({ maxLength: 300 }), (s) => shape(parseMcc(s))), RUNS);
  });

  it("EBU-STL (random bytes after a valid GSI, and fully random)", () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 700 }), (tail) => {
      const bytes = new Uint8Array(1024 + tail.length);
      bytes.set(STL_TELETEXT.subarray(0, 1024));
      bytes.set(tail, 1024);
      shape(parseStl(bytes));
    }), RUNS);
    fc.assert(fc.property(fc.uint8Array({ maxLength: 1400 }), (b) => shape(parseStl(b))), RUNS);
  });

  it("TTML, SBV, SRT/VTT, timed transcripts", () => {
    fc.assert(fc.property(fc.string({ maxLength: 400 }), (s) => {
      shape(parseTtml(s));
      shape(parseTtml(`<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${s}</div></body></tt>`));
      shape(parseSbv(s));
      shape(parseCaptions(s));
      shape(parseCaptions(`WEBVTT\n\n${s}`));
      shape(parseTimedTranscript(s));
    }), RUNS);
  });

  it("the byte loader, for any bytes", async () => {
    await fc.assert(fc.asyncProperty(fc.uint8Array({ maxLength: 600 }), async (b) => {
      shape(await importCaptionFile(b));
      shape(parseCaptionBytes(b));
    }), RUNS);
  });
});

describe("importers survive damaged real files", () => {
  const seeds: Array<[string, Uint8Array]> = [
    ["scc", enc(SCC_POSITIONED)],
    ["mcc", enc(MCC_HELLO)],
    ["stl", STL_TELETEXT],
    ["stl-cyrillic", STL_CYRILLIC],
  ];
  it.each(seeds)("%s: truncation and byte flips", async (_name, seed) => {
    await fc.assert(
      fc.asyncProperty(fc.nat(seed.length), fc.array(fc.tuple(fc.nat(seed.length - 1), fc.nat(255)), { maxLength: 8 }), async (cut, flips) => {
        const bytes = seed.slice(0, cut);
        for (const [at, v] of flips) if (at < bytes.length) bytes[at] = v;
        shape(await importCaptionFile(bytes));
      }),
      { numRuns: 200 },
    );
  });

  it("an undamaged file reports no errors", async () => {
    for (const [, seed] of seeds) expect((await importCaptionFile(seed)).errors).toEqual([]);
  });
});
