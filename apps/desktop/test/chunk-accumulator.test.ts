import { describe, expect, it } from "vitest";
import { ChunkAccumulator } from "../src/aurora-host/chunk-accumulator";

describe("ChunkAccumulator", () => {
  it("reads a length prefix split across chunks and takes frames spanning many chunks", () => {
    const payload = Buffer.alloc(100_000);
    for (let i = 0; i < payload.length; i += 1) payload[i] = i % 251;
    const framed = Buffer.concat([Buffer.from([0xa0, 0x86, 0x01, 0x00]), payload]); // 100000 LE
    const acc = new ChunkAccumulator();
    acc.push(framed.subarray(0, 2));
    expect(acc.peekUInt32LE()).toBeNull();
    acc.push(framed.subarray(2, 7));
    expect(acc.peekUInt32LE()).toBe(100_000);
    for (let offset = 7; offset < framed.length; offset += 65_536) {
      acc.push(framed.subarray(offset, Math.min(framed.length, offset + 65_536)));
    }
    expect(acc.byteLength).toBe(framed.length);
    const frame = acc.take(4 + 100_000);
    expect(frame.subarray(4).equals(payload)).toBe(true);
    expect(acc.byteLength).toBe(0);
  });

  it("keeps the bytes of the next frame after taking one", () => {
    const acc = new ChunkAccumulator();
    acc.push(Buffer.from([1, 2, 3]));
    acc.push(Buffer.from([4, 5, 6, 7]));
    expect([...acc.take(5)]).toEqual([1, 2, 3, 4, 5]);
    expect(acc.byteLength).toBe(2);
    expect([...acc.take(2)]).toEqual([6, 7]);
    expect(() => acc.take(1)).toThrow();
  });

  it("copies each byte once instead of re-concatenating per chunk", () => {
    const acc = new ChunkAccumulator();
    const chunk = Buffer.alloc(65_536, 7);
    const start = performance.now();
    for (let i = 0; i < 128; i += 1) acc.push(chunk); // 8 MiB frame
    const out = acc.take(128 * 65_536);
    expect(out.byteLength).toBe(8 * 1024 * 1024);
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
