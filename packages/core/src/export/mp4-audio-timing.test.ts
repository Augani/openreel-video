import { describe, expect, it } from "vitest";
import { applyMp4AudioTiming } from "./mp4-audio-timing";

const ascii = (value: string) => new TextEncoder().encode(value);
function box(type: string, ...parts: Uint8Array[]) {
  const result = new Uint8Array(8 + parts.reduce((size, part) => size + part.length, 0));
  new DataView(result.buffer).setUint32(0, result.length);
  result.set(ascii(type), 4);
  let offset = 8;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function header(type: string, scale: number, duration: number, version = 0) {
  const data = new Uint8Array(version === 1 ? 48 : 40);
  const view = new DataView(data.buffer);
  data[0] = version;
  if (type !== "tkhd") view.setUint32(version === 1 ? 20 : 12, scale);
  const offset = type === "tkhd" ? (version === 1 ? 28 : 20) : (version === 1 ? 24 : 16);
  if (version === 1) view.setBigUint64(offset, BigInt(duration)); else view.setUint32(offset, duration);
  return box(type, data);
}
function track(handler: string, trackDuration: number, version = 0) {
  const handlerData = new Uint8Array(20); handlerData.set(ascii(handler), 8);
  return box("trak", header("tkhd", 0, trackDuration, version), box("mdia", header("mdhd", 48000, 98400, version), box("hdlr", handlerData), box("stco", new Uint8Array([0, 0, 0, 1, 0, 0, 1, 23]))));
}
function find(bytes: Uint8Array, type: string) {
  const text = new TextDecoder().decode(bytes);
  return text.indexOf(type) - 4;
}

describe("MP4 AAC timing", () => {
  it.each([0, 1])("records priming and removes end padding with version %i headers", (version) => {
    const input = box("moov", header("mvhd", 1000, 2050, version), track("vide", 2000, version), track("soun", 2050, version));
    const original = input.slice();
    const result = applyMp4AudioTiming(input, 2112, 48000, 96000);
    const v = new DataView(result.buffer);
    const edit = find(result, "elst");
    expect(v.getBigUint64(edit + 16)).toBe(2000n);
    expect(v.getBigInt64(edit + 24)).toBe(2112n);
    expect(v.getInt16(edit + 32)).toBe(1);
    const mvhd = find(result, "mvhd");
    expect(version === 1 ? Number(v.getBigUint64(mvhd + 32)) : v.getUint32(mvhd + 24)).toBe(2000);
    expect(input).toEqual(original);
    expect(new TextDecoder().decode(result)).toContain(new TextDecoder().decode(box("stco", new Uint8Array([0, 0, 0, 1, 0, 0, 1, 23]))));
    expect(result.length).toBe(input.length + 44);
  });
  it("does not shift a silent video-only export or apply timing twice", () => {
    const video = box("moov", header("mvhd", 1000, 2000), track("vide", 2000));
    expect(() => applyMp4AudioTiming(video, 2112, 48000, 96000)).toThrow("one mixed audio track");
    const movie = box("moov", header("mvhd", 1000, 2050), track("soun", 2050));
    const corrected = applyMp4AudioTiming(movie, 2112, 48000, 96000);
    expect(() => applyMp4AudioTiming(corrected, 2112, 48000, 96000)).toThrow("already contains");
  });
  it("rejects corrupt metadata and invalid timing", () => {
    expect(() => applyMp4AudioTiming(new Uint8Array(9), 2112, 48000, 96000)).toThrow("Incomplete");
    expect(() => applyMp4AudioTiming(new Uint8Array(8), -1, 48000, 96000)).toThrow("Invalid audio timing");
  });
});
