import { describe, expect, it } from "vitest";
import { encodeStl, parseStl } from "./ebu-stl";
import { parseMcc } from "./mcc";
import { parseScc } from "./scc-import";
import { isTimedTranscript } from "./plain-transcript";

const par = (b: number) => {
  let n = 0;
  for (let i = 0; i < 7; i++) if ((b >> i) & 1) n++;
  return n % 2 === 0 ? b | 0x80 : b;
};
const hex = (b1: number, b2: number) => ((par(b1) << 8) | par(b2)).toString(16).padStart(4, "0");
const word = (s: string) => hex(s.charCodeAt(0), s.charCodeAt(1));

// Independent byte-level EBU-STL builder (different text, code table and frame base from the shipped fixtures).
const ascii = (s: string, n: number) => {
  const o = new Uint8Array(n).fill(0x20);
  for (let i = 0; i < Math.min(n, s.length); i++) o[i] = s.charCodeAt(i);
  return o;
};
interface Blk { ebn: number; cs?: number; tci: number[]; tco: number[]; vp: number; jc: number; cf?: number; tf: number[] }
function stl(dsc: string, blocks: Blk[], tcp = "00000000", dfc = "STL25.01"): Uint8Array {
  const out = new Uint8Array(1024 + blocks.length * 128);
  out.fill(0x20, 0, 1024);
  const put = (at: number, s: string) => out.set(ascii(s, s.length), at);
  put(0, "850"); put(3, dfc); put(11, dsc); put(12, "00"); put(14, "09");
  put(238, String(blocks.length).padStart(5, "0")); put(251, "40"); put(253, "23"); put(255, "1"); put(256, tcp);
  blocks.forEach((b, i) => {
    const t = out.subarray(1024 + i * 128, 1024 + (i + 1) * 128);
    t.fill(0);
    t[1] = i + 1; t[3] = b.ebn; t[4] = b.cs ?? 0; t.set(b.tci, 5); t.set(b.tco, 9); t[13] = b.vp; t[14] = b.jc; t[15] = b.cf ?? 0;
    t.fill(0x8f, 16, 128); t.set(b.tf, 16);
  });
  return out;
}
const bytes = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe("caption import regressions", () => {
  it("SCC: a doubled mid-row code is one space, not two", () => {
    const yellow = hex(0x11, 0x2a);
    const scc = [
      "Scenarist_SCC V1.0", "",
      `00:00:01;00\t${[hex(0x14, 0x20), hex(0x14, 0x20), hex(0x14, 0x70), hex(0x14, 0x70), word("ab"), yellow, yellow, word("cd"), hex(0x14, 0x2f), hex(0x14, 0x2f)].join(" ")}`,
      `00:00:03;00\t${hex(0x14, 0x2c)} ${hex(0x14, 0x2c)}`,
    ].join("\n");
    expect(parseScc(scc).subtitles[0].text).toBe("ab cd");
  });

  it("MCC: a packet with no length byte is reported without 'undefined'", () => {
    const r = parseMcc("File Format=MacCaption_MCC V1.0\nTime Code Rate=30DF\n\n00:00:01;00\t9669\n");
    expect(r.errors.map((e) => e.message).join()).not.toContain("undefined");
    expect(r.errors).toHaveLength(1);
  });

  it("transcript: impossible time stamps are not time stamps", () => {
    expect(isTimedTranscript("[99:99:99] x\n[00:99:99] y")).toBe(false);
    expect(isTimedTranscript("[00:00:07] x\n[00:00:09] y")).toBe(true);
  });

  it("STL: comment and user-data blocks are not subtitles; white after a colour counts as a change", () => {
    const f = stl("1", [
      { ebn: 0xff, tci: [0, 0, 1, 0], tco: [0, 0, 2, 0], vp: 20, jc: 2, tf: [0x03, ...bytes("Yellow row"), 0x8a, 0x07, ...bytes("White row")] },
      { ebn: 0xff, tci: [0, 0, 3, 0], tco: [0, 0, 4, 0], vp: 20, jc: 2, cf: 1, tf: bytes("NOTE TO SELF") },
      { ebn: 0xfe, tci: [0, 0, 5, 0], tco: [0, 0, 6, 0], vp: 20, jc: 2, tf: bytes("USERDATA") },
      { ebn: 0xff, tci: [0, 0, 7, 0], tco: [0, 0, 8, 0], vp: 20, jc: 2, tf: [0x06, ...bytes("Cyan"), 0x8a, ...bytes("no code on row two")] },
    ]);
    const r = parseStl(f);
    expect(r.subtitles.map((s) => s.text)).toEqual(["Yellow row\nWhite row", "Cyan\nno code on row two"]);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain("stl-comments");
    expect(codes).toContain("stl-user-data");
    expect(codes).toContain("stl-colours-mixed");
    expect(r.issues.find((i) => i.code === "stl-colours-mixed")?.message).toMatch(/^2 subtitles/);
  });

  it("STL: typographic quotes, arrows and a long dash decode and round-trip", () => {
    const f = stl("0", [{ ebn: 0xff, tci: [0, 0, 1, 0], tco: [0, 0, 2, 0], vp: 20, jc: 2, tf: [0xaa, ...bytes("Don"), 0xb9, ...bytes("t"), 0xba, 0x20, 0xae] }]);
    expect(parseStl(f).subtitles[0].text).toBe("“Don’t” →");
    const enc = encodeStl([{ id: "a", text: "‘hi’ →", startTime: 1, endTime: 2 }]);
    expect(parseStl(enc.bytes).subtitles[0].text).toBe("‘hi’ →");
  });

  it("STL: a file whose timecode starts at 10:00:00:00 says so", () => {
    const f = stl("0", [{ ebn: 0xff, tci: [10, 0, 5, 0], tco: [10, 0, 6, 0], vp: 20, jc: 2, tf: bytes("late") }], "10000000", "STL30.01");
    const r = parseStl(f);
    expect(r.subtitles[0].startTime).toBe(36005);
    expect(r.issues.map((i) => i.code)).toContain("stl-programme-start");
    expect(parseStl(f, { offsetSeconds: 36000 }).issues.map((i) => i.code)).not.toContain("stl-programme-start");
  });
});
