import { describe, expect, it } from "vitest";
import {
  CHAN_TAG_MPEG_5_1_A,
  WAV_MASK_5_1,
  encodeMultichannelWav,
  isSurroundDelivery,
  resolveSequenceAudioSettings,
  surroundFormatProblem,
} from "./surround-export";
import { applyMovChannelLayout, channelLayoutAtom } from "./mp4-audio-timing";
import type { AudioExportSettings } from "./types";

const audio: AudioExportSettings = { format: "aac", sampleRate: 48000, bitDepth: 16, bitrate: 192, channels: 2 };
const stereoProject = { settings: { width: 1, height: 1, frameRate: 30, sampleRate: 48000, channels: 2 } };
const surroundProject = { settings: { ...stereoProject.settings, channels: 6, channelLayout: "5.1" as const } };

describe("export audio settings follow the sequence layout", () => {
  it("leaves a stereo sequence's settings untouched (same object)", () => {
    expect(resolveSequenceAudioSettings(stereoProject, audio)).toBe(audio);
    expect(isSurroundDelivery(audio)).toBe(false);
  });

  it("delivers six channels from a 5.1 sequence, at a 5.1 bitrate", () => {
    const resolved = resolveSequenceAudioSettings(surroundProject, audio);
    expect(resolved.channels).toBe(6);
    expect(resolved.bitrate).toBe(384);
    expect(isSurroundDelivery(resolved)).toBe(true);
    expect(resolveSequenceAudioSettings(surroundProject, { ...audio, bitrate: 512 }).bitrate).toBe(512);
  });

  it("downmixes to stereo when the export asks for it", () => {
    const resolved = resolveSequenceAudioSettings(surroundProject, { ...audio, channelLayout: "stereo" });
    expect(resolved.channels).toBe(2);
    expect(resolved.bitrate).toBe(192);
  });

  it("explains that WebM cannot carry 5.1", () => {
    expect(surroundFormatProblem("webm")).toMatch(/MP4 or MOV/);
    expect(surroundFormatProblem("mp4")).toBeNull();
    expect(surroundFormatProblem("mov")).toBeNull();
  });
});

describe("multichannel WAV", () => {
  const six = Array.from({ length: 6 }, (_, c) => new Float32Array([0.5 * (c + 1) / 6, -0.25]));

  it("writes WAVE_FORMAT_EXTENSIBLE with the L R C LFE Ls Rs mask for six channels", () => {
    const wav = encodeMultichannelWav(six, 48000, 24);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(view.getUint16(20, true)).toBe(0xfffe);
    expect(view.getUint16(22, true)).toBe(6);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(24);
    expect(view.getUint32(40, true)).toBe(WAV_MASK_5_1);
    expect(view.getUint16(44, true)).toBe(1); // PCM sub-format
    expect(String.fromCharCode(...wav.subarray(60, 64))).toBe("data");
    expect(view.getUint32(64, true)).toBe(2 * 6 * 3);
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
  });

  it("interleaves in channel order and round-trips 16-bit samples", () => {
    const wav = encodeMultichannelWav(six, 48000, 16);
    const view = new DataView(wav.buffer);
    const first = 68;
    for (let c = 0; c < 6; c++) expect(view.getInt16(first + c * 2, true) / 32767).toBeCloseTo((0.5 * (c + 1)) / 6, 3);
    expect(view.getInt16(first + 12, true) / 32768).toBeCloseTo(-0.25, 3);
  });

  it("uses the IEEE float sub-format for 32-bit", () => {
    const wav = encodeMultichannelWav(six, 48000, 32);
    const view = new DataView(wav.buffer);
    expect(view.getUint16(44, true)).toBe(3);
    expect(view.getFloat32(68 + 4 * 4, true)).toBeCloseTo((0.5 * 5) / 6, 6);
  });
});

/** A minimal moov > trak > mdia > (hdlr, minf > stbl > stsd > mp4a). */
const box = (type: string, ...payloads: Uint8Array[]): Uint8Array => {
  const size = 8 + payloads.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(new TextEncoder().encode(type), 4);
  let offset = 8;
  for (const p of payloads) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

function movie(handler: string): Uint8Array {
  const hdlr = new Uint8Array(24);
  hdlr.set(new TextEncoder().encode(handler), 8);
  const entry = box("mp4a", new Uint8Array(28), box("esds", new Uint8Array(4)));
  const stsd = box("stsd", new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]), entry);
  const minf = box("minf", box("stbl", stsd));
  return box("moov", box("mvhd", new Uint8Array(100)), box("trak", box("tkhd", new Uint8Array(84)), box("mdia", box("hdlr", hdlr), minf)));
}

const find = (bytes: Uint8Array, type: string): number => {
  const text = new TextDecoder("latin1").decode(bytes);
  return text.indexOf(type);
};

describe("QuickTime channel layout atom", () => {
  it("is the 24-byte chan atom carrying the MPEG 5.1 (L R C LFE Ls Rs) tag", () => {
    const atom = channelLayoutAtom(CHAN_TAG_MPEG_5_1_A);
    const view = new DataView(atom.buffer);
    expect(atom.length).toBe(24);
    expect(String.fromCharCode(...atom.subarray(4, 8))).toBe("chan");
    expect(view.getUint32(12)).toBe((121 << 16) | 6);
  });

  it("is added to the audio sample entry, growing every parent box consistently", () => {
    const before = movie("soun");
    const after = applyMovChannelLayout(before, CHAN_TAG_MPEG_5_1_A);
    expect(after.length).toBe(before.length + 24);
    expect(new DataView(after.buffer).getUint32(0)).toBe(after.length);
    const at = find(after, "chan");
    expect(at).toBeGreaterThan(0);
    // the atom sits at the end of the mp4a entry, after the esds
    expect(find(after, "esds")).toBeLessThan(at);
    // every container declares a size that ends exactly where the next sibling or the file ends
    const walk = (bytes: Uint8Array, start: number, end: number) => {
      for (let o = start; o < end;) {
        const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(o);
        expect(size).toBeGreaterThanOrEqual(8);
        expect(o + size).toBeLessThanOrEqual(end);
        const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
        if (["moov", "trak", "mdia", "minf", "stbl"].includes(type)) walk(bytes, o + 8, o + size);
        if (type === "stsd") walk(bytes, o + 16, o + size);
        o += size;
      }
    };
    walk(after, 0, after.length);
  });

  it("refuses a movie with no audio track rather than silently writing nothing", () => {
    expect(() => applyMovChannelLayout(movie("vide"), CHAN_TAG_MPEG_5_1_A)).toThrow(/audio sample description/);
  });
});
