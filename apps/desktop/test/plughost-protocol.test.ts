import { describe, expect, it } from "vitest";
import { FRAME_HEADER_BYTES, FRAME_MAGIC, FrameDecoder, FrameError, MAX_JSON_BYTES, encodeFrame, fromFloat32, isValidPluginId, toFloat32 } from "../src/shared/plughost-protocol";

describe("plughost protocol framing", () => {
  it("round-trips json and binary payloads", () => {
    const audio = Float32Array.from([0.25, -0.5, 1, 0]);
    const wire = encodeFrame({ type: "block", reqId: 7, frames: 2, params: { "0": 0.5 } }, fromFloat32(audio));
    expect(wire.readUInt32LE(0)).toBe(FRAME_MAGIC);
    const [frame] = new FrameDecoder().push(wire);
    expect(frame.json).toEqual({ type: "block", reqId: 7, frames: 2, params: { "0": 0.5 } });
    expect(Array.from(toFloat32(frame.binary))).toEqual(Array.from(audio));
  });

  it("reassembles frames split at every byte boundary and several frames in one chunk", () => {
    const a = encodeFrame({ type: "a", n: 1 }, new Uint8Array([1, 2, 3, 4]));
    const b = encodeFrame({ type: "b", n: 2 });
    const both = Buffer.concat([a, b]);
    for (let split = 1; split < both.length; split += 1) {
      const decoder = new FrameDecoder();
      const frames = [...decoder.push(both.subarray(0, split)), ...decoder.push(both.subarray(split))];
      expect(frames.map((f) => f.json.type)).toEqual(["a", "b"]);
      expect(Array.from(frames[0].binary)).toEqual([1, 2, 3, 4]);
      expect(decoder.buffered).toBe(0);
    }
    expect(new FrameDecoder().push(both).map((f) => f.json.n)).toEqual([1, 2]);
  });

  it("rejects desynchronised, oversized and malformed frames", () => {
    expect(() => new FrameDecoder().push(Buffer.from("not a frame, definitely not"))).toThrow(FrameError);
    const huge = Buffer.alloc(FRAME_HEADER_BYTES);
    huge.writeUInt32LE(FRAME_MAGIC, 0);
    huge.writeUInt32LE(MAX_JSON_BYTES + 1, 4);
    expect(() => new FrameDecoder().push(huge)).toThrow(/too large/);
    const badJson = Buffer.alloc(FRAME_HEADER_BYTES + 3);
    badJson.writeUInt32LE(FRAME_MAGIC, 0);
    badJson.writeUInt32LE(3, 4);
    badJson.write("{x}", FRAME_HEADER_BYTES);
    expect(() => new FrameDecoder().push(badJson)).toThrow(/not valid/);
    const notObject = Buffer.alloc(FRAME_HEADER_BYTES + 5);
    notObject.writeUInt32LE(FRAME_MAGIC, 0);
    notObject.writeUInt32LE(5, 4);
    notObject.write("[1,2]", FRAME_HEADER_BYTES);
    expect(() => new FrameDecoder().push(notObject)).toThrow(/not an object/);
    expect(() => encodeFrame({ big: "x".repeat(MAX_JSON_BYTES) })).toThrow(FrameError);
    expect(() => toFloat32(new Uint8Array(3))).toThrow(FrameError);
  });

  it("validates plugin ids", () => {
    expect(isValidPluginId("au:aufx:dely:appl")).toBe(true);
    expect(isValidPluginId("vst3:0123456789ABCDEF0123456789ABCDEF")).toBe(true);
    for (const bad of ["", "au:aufx:dely", "au:aufx:dely:appl:x", "vst3:xyz", "../etc/passwd", 7, null]) expect(isValidPluginId(bad)).toBe(false);
  });
});
