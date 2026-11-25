import { describe, expect, it } from "vitest";
import {
  applyBwfMetadata,
  buildBextChunk,
  buildIxmlChunk,
  embedBwfChunks,
  parseBextChunk,
  parseBwf,
  parseIxmlChunk,
  planWavLayout,
  RF64_PREAMBLE_SIZE,
  readWavChunks,
  startTimecodeToSamples,
} from "./bwf";
import { encodeMultichannelWav } from "./surround-export";

/** 16-bit PCM stereo WAV with a known ramp. */
function pcmWav(frames = 480, rate = 48000): Uint8Array {
  const data = new Uint8Array(frames * 4);
  const dv = new DataView(data.buffer);
  for (let i = 0; i < frames; i++) {
    dv.setInt16(i * 4, i, true);
    dv.setInt16(i * 4 + 2, -i, true);
  }
  const out = new Uint8Array(44 + data.length);
  const v = new DataView(out.buffer);
  const tag = (o: number, t: string) => [...t].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + data.length, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, data.length, true);
  out.set(data, 44);
  return out;
}

describe("bext chunk", () => {
  it("is the 602-byte EBU Tech 3285 v1 layout and parses back field for field", () => {
    const chunk = buildBextChunk({
      description: "Reel 3 final mix",
      originator: "OpenReel",
      originatorReference: "OR123",
      originationDate: "2026-11-23",
      originationTime: "09:15:42",
      timeReference: 3600 * 48000 + 17,
      codingHistory: "A=PCM,F=48000,W=24,M=stereo,T=OpenReel\r\n",
    });
    expect(chunk.length).toBe(602 + "A=PCM,F=48000,W=24,M=stereo,T=OpenReel\r\n".length);
    const parsed = parseBextChunk(chunk);
    expect(parsed).toMatchObject({
      description: "Reel 3 final mix",
      originator: "OpenReel",
      originatorReference: "OR123",
      originationDate: "2026-11-23",
      originationTime: "09:15:42",
      timeReference: 172800017,
      version: 1,
    });
    expect(parsed.codingHistory).toContain("A=PCM,F=48000");
  });

  it("splits a time reference past 32 bits into low and high words", () => {
    const big = 2 ** 32 + 5;
    const parsed = parseBextChunk(buildBextChunk({ description: "", originator: "", originationDate: "", originationTime: "", timeReference: big }));
    expect(parsed.timeReference).toBe(big);
  });

  it("truncates over-long text and replaces non-ASCII", () => {
    const parsed = parseBextChunk(buildBextChunk({ description: "x".repeat(300) + "é", originator: "Ünï", originationDate: "", originationTime: "", timeReference: 0 }));
    expect(parsed.description).toHaveLength(256);
    expect(parsed.originator).toBe("?n?");
  });
});

describe("iXML chunk", () => {
  it("carries track names, project and the time reference, escaped, and parses back", () => {
    const chunk = buildIxmlChunk({
      project: "Tom & <Jerry>",
      tracks: [{ channelIndex: 1, name: "Mix L" }, { channelIndex: 2, name: "Mix R" }],
      sampleRate: 48000,
      timeReference: 2 ** 32 + 9,
      sourceTracks: ["Dialogue \"A\"", "Music"],
      startTimecode: "01:00:00:00",
      frameRate: 24,
    });
    const xml = new TextDecoder().decode(chunk);
    expect(xml).toContain("<BWFXML>");
    expect(xml).toContain("<TRACK_COUNT>2</TRACK_COUNT>");
    expect(xml).not.toContain("<Jerry>");
    const parsed = parseIxmlChunk(chunk);
    expect(parsed.project).toBe("Tom & <Jerry>");
    expect(parsed.tracks).toEqual([{ channelIndex: 1, name: "Mix L" }, { channelIndex: 2, name: "Mix R" }]);
    expect(parsed.timeReference).toBe(2 ** 32 + 9);
    expect(parsed.sampleRate).toBe(48000);
    expect(parsed.sourceTracks).toEqual(['Dialogue "A"', "Music"]);
  });
});

describe("embedding into a WAV", () => {
  it("puts bext before the audio and iXML after it, keeps the samples and a valid RIFF size", () => {
    const wav = pcmWav();
    const bwf = embedBwfChunks(wav, buildBextChunk({ description: "d", originator: "o", originationDate: "2026-01-01", originationTime: "00:00:00", timeReference: 0 }), buildIxmlChunk({ project: "p", tracks: [], sampleRate: 48000, timeReference: 0 }));
    const dv = new DataView(bwf.buffer);
    expect(dv.getUint32(4, true)).toBe(bwf.length - 8);
    expect(bwf.length % 2).toBe(0);
    const parsed = parseBwf(bwf);
    expect(parsed.chunkOrder).toEqual(["fmt ", "bext", "data", "iXML"]);
    const original = readWavChunks(wav).find((c) => c.id === "data")!;
    const kept = readWavChunks(bwf).find((c) => c.id === "data")!;
    expect(Array.from(kept.data)).toEqual(Array.from(original.data));
    expect(Array.from(readWavChunks(bwf)[0].data)).toEqual(Array.from(readWavChunks(wav)[0].data));
  });

  it("replaces chunks of a file that already has them and pads odd-sized chunks", () => {
    const wav = pcmWav();
    const once = embedBwfChunks(wav, buildBextChunk({ description: "first", originator: "", originationDate: "", originationTime: "", timeReference: 1, codingHistory: "abc" }));
    const twice = embedBwfChunks(once, buildBextChunk({ description: "second", originator: "", originationDate: "", originationTime: "", timeReference: 2 }));
    expect(parseBwf(twice).chunkOrder.filter((c) => c === "bext")).toHaveLength(1);
    expect(parseBwf(twice).bext?.description).toBe("second");
    expect(new DataView(once.buffer).getUint32(4, true)).toBe(once.length - 8);
  });

  it("rejects bytes that are not a WAV", () => {
    expect(() => readWavChunks(new Uint8Array(20))).toThrow(/RIFF/);
  });

  it("works on the multichannel (WAVE_FORMAT_EXTENSIBLE) writer too", () => {
    const planes = Array.from({ length: 6 }, () => new Float32Array(100).fill(0.25));
    const wav = encodeMultichannelWav(planes, 48000, 24);
    const bwf = embedBwfChunks(wav, buildBextChunk({ description: "5.1", originator: "", originationDate: "", originationTime: "", timeReference: 0 }));
    expect(parseBwf(bwf).chunkOrder).toEqual(["fmt ", "bext", "data"]);
  });
});

describe("time reference from the sequence start timecode", () => {
  it("is the start timecode in samples", () => {
    expect(startTimecodeToSamples(undefined, 24, 48000)).toBe(0);
    expect(startTimecodeToSamples("00:00:00:00", 24, 48000)).toBe(0);
    expect(startTimecodeToSamples("01:00:00:00", 24, 48000)).toBe(3600 * 48000);
    expect(startTimecodeToSamples("00:00:01:12", 24, 48000)).toBe(Math.round(1.5 * 48000));
    expect(startTimecodeToSamples("not a timecode", 24, 48000)).toBe(0);
  });

  it("counts drop-frame and NTSC rates by real time", () => {
    // 29.97 DF: 01:00:00;00 is 107892 frames = 3599.9964 s
    expect(startTimecodeToSamples("01:00:00;00", 29.97, 48000)).toBe(Math.round((107892 * 1001) / 30000 * 48000));
  });

  it("applyBwfMetadata writes it, the project name, the originator and the track names", () => {
    const out = applyBwfMetadata(pcmWav(), {
      projectName: "Feature Film",
      sampleRate: 48000,
      startTimecode: "01:00:00:00",
      frameRate: 25,
      sourceTrackNames: ["Dialogue", "Music", "FX"],
      channelNames: ["Mix L", "Mix R"],
      bitDepth: 24,
      now: new Date(2026, 10, 23, 9, 5, 7),
    });
    const parsed = parseBwf(out);
    expect(parsed.bext).toMatchObject({
      description: "Feature Film",
      originator: "OpenReel",
      originationDate: "2026-11-23",
      originationTime: "09:05:07",
      timeReference: 3600 * 48000,
    });
    expect(parsed.bext?.codingHistory).toContain("F=48000,W=24");
    expect(parsed.ixml?.tracks.map((t) => t.name)).toEqual(["Mix L", "Mix R"]);
    expect(parsed.ixml?.sourceTracks).toEqual(["Dialogue", "Music", "FX"]);
    expect(parsed.ixml?.timeReference).toBe(3600 * 48000);
  });
});

describe("RF64 over 4 GB", () => {
  const GB = 1024 ** 3;

  it("plans a plain RIFF header while everything fits 32 bits", () => {
    const layout = planWavLayout([{ id: "fmt ", size: 16 }, { id: "bext", size: 602 }, { id: "data", size: 4 * GB - 4096 }], 4);
    expect(layout.rf64).toBe(false);
    expect(new TextDecoder().decode(layout.preamble.subarray(0, 4))).toBe("RIFF");
    expect(layout.sizeFields).toEqual([16, 602, 4 * GB - 4096]);
  });

  it("switches to RF64 with a ds64 chunk when the data exceeds 4 GB (header only, nothing is allocated)", () => {
    const dataSize = 5 * GB + 104; // even, so no pad byte
    const chunks = [{ id: "fmt ", size: 16 }, { id: "bext", size: 602 }, { id: "data", size: dataSize }, { id: "iXML", size: 300 }];
    const layout = planWavLayout(chunks, 8);
    expect(layout.rf64).toBe(true);
    const view = new DataView(layout.preamble.buffer);
    const tag = (o: number) => new TextDecoder().decode(layout.preamble.subarray(o, o + 4));
    expect([tag(0), tag(8), tag(12)]).toEqual(["RF64", "WAVE", "ds64"]);
    expect(view.getUint32(4, true)).toBe(0xffffffff);
    expect(view.getUint32(16, true)).toBe(28);
    // ds64: riffSize, dataSize, sampleCount, table length.
    expect(Number(view.getBigUint64(20, true))).toBe(layout.totalSize - 8);
    expect(Number(view.getBigUint64(28, true))).toBe(dataSize);
    expect(Number(view.getBigUint64(36, true))).toBe(dataSize / 8);
    expect(view.getUint32(44, true)).toBe(0);
    // The data chunk's own size field is 0xFFFFFFFF, small chunks keep theirs.
    expect(layout.sizeFields).toEqual([16, 602, 0xffffffff, 300]);
    expect(layout.totalSize).toBe(RF64_PREAMBLE_SIZE + 3 * 8 + 8 + 16 + 602 + dataSize + 300);
  });

  it("refuses an oversize chunk other than data", () => {
    expect(() => planWavLayout([{ id: "iXML", size: 5 * GB }, { id: "data", size: 4 }], 4)).toThrow(/data chunk/);
  });

  it("embeds into a real RF64 file (threshold lowered) and reads it back with the audio untouched", () => {
    const wav = pcmWav(480);
    const bext = buildBextChunk({ description: "d", originator: "o", originationDate: "2026-11-23", originationTime: "01:02:03", timeReference: 0 });
    const out = embedBwfChunks(wav, bext, buildIxmlChunk({ project: "P", tracks: [{ channelIndex: 1, name: "L" }], sampleRate: 48000, timeReference: 0 }), { rf64Threshold: 1000 });
    expect(new TextDecoder().decode(out.subarray(0, 4))).toBe("RF64");
    const chunks = readWavChunks(out);
    expect(chunks.map((c) => c.id)).toEqual(["ds64", "fmt ", "bext", "data", "iXML"]);
    const original = readWavChunks(wav).find((c) => c.id === "data")!.data;
    expect(Array.from(chunks.find((c) => c.id === "data")!.data)).toEqual(Array.from(original));
    const parsed = parseBwf(out);
    expect(parsed.bext?.description).toBe("d");
    expect(parsed.ixml?.project).toBe("P");
    // Re-embedding an RF64 file keeps a single ds64.
    const again = embedBwfChunks(out, bext, undefined, { rf64Threshold: 1000 });
    expect(readWavChunks(again).filter((c) => c.id === "ds64")).toHaveLength(1);
    // And a normal threshold turns it back into plain RIFF.
    expect(new TextDecoder().decode(embedBwfChunks(out, bext).subarray(0, 4))).toBe("RIFF");
  });
});
