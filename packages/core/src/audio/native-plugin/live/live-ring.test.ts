import { describe, expect, it } from "vitest";
import { LiveRing, liveRingByteLength } from "./live-ring";

const ramp = (n: number, start = 0): Float32Array => Float32Array.from({ length: n }, (_, i) => start + i);

describe("LiveRing", () => {
  it("round-trips planar frames in order, including across the wrap point", () => {
    const ring = LiveRing.create({ channels: 2, capacityFrames: 8 }, false);
    expect(ring.write([ramp(5), ramp(5, 100)], 5)).toBe(5);
    const out = [new Float32Array(3), new Float32Array(3)];
    expect(ring.read(out, 3)).toBe(3);
    expect(Array.from(out[0])).toEqual([0, 1, 2]);
    expect(Array.from(out[1])).toEqual([100, 101, 102]);
    expect(ring.write([ramp(5, 5), ramp(5, 105)], 5)).toBe(5); // wraps: write position 10 % 8
    expect(ring.available()).toBe(7);
    const rest = [new Float32Array(7), new Float32Array(7)];
    expect(ring.read(rest, 7)).toBe(7);
    expect(Array.from(rest[0])).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(Array.from(rest[1])).toEqual([103, 104, 105, 106, 107, 108, 109]);
  });

  it("never overwrites unread audio: a full ring drops the excess and counts it", () => {
    const ring = LiveRing.create({ channels: 1, capacityFrames: 4 }, false);
    expect(ring.write([ramp(6)], 6)).toBe(4);
    expect(ring.dropped()).toBe(2);
    expect(ring.space()).toBe(0);
    const out = [new Float32Array(4)];
    ring.read(out, 4);
    expect(Array.from(out[0])).toEqual([0, 1, 2, 3]);
  });

  it("reads only what is there and peek does not consume", () => {
    const ring = LiveRing.create({ channels: 1, capacityFrames: 16 }, false);
    ring.write([ramp(6)], 6);
    const out = [new Float32Array(10)];
    expect(ring.peek(out, 10, 2)).toBe(4);
    expect(Array.from(out[0].slice(0, 4))).toEqual([2, 3, 4, 5]);
    expect(ring.available()).toBe(6);
    expect(ring.read(out, 10)).toBe(6);
    expect(ring.read(out, 10)).toBe(0);
  });

  it("is a delay line when it is pre-filled", () => {
    const ring = LiveRing.create({ channels: 1, capacityFrames: 64 }, false);
    ring.write([new Float32Array(10)], 10);
    const got: number[] = [];
    for (let block = 0; block < 4; block += 1) {
      ring.write([ramp(8, block * 8 + 1)], 8);
      const out = [new Float32Array(8)];
      ring.read(out, 8);
      got.push(...out[0]);
    }
    expect(got.slice(0, 10)).toEqual(new Array(10).fill(0));
    expect(got.slice(10, 14)).toEqual([1, 2, 3, 4]);
  });

  it("two views of one shared buffer see each other's writes (the cross-thread contract)", () => {
    const producer = LiveRing.create({ channels: 2, capacityFrames: 32 });
    expect(producer.buffer.byteLength).toBe(liveRingByteLength({ channels: 2, capacityFrames: 32 }));
    const consumer = LiveRing.attach(producer.buffer, { channels: 2, capacityFrames: 32 });
    producer.write([ramp(10), ramp(10, 50)], 10);
    expect(consumer.available()).toBe(10);
    const out = [new Float32Array(10), new Float32Array(10)];
    consumer.read(out, 10);
    expect(out[1][9]).toBe(59);
    expect(producer.available()).toBe(0);
  });

  it("keeps working when the 32 bit counters wrap", () => {
    const ring = LiveRing.create({ channels: 1, capacityFrames: 8 }, false);
    const header = new Int32Array(ring.buffer, 0, 4);
    header[0] = 2147483640;
    header[1] = 2147483640;
    for (let i = 0; i < 6; i += 1) {
      ring.write([ramp(5, i * 5)], 5);
      const out = [new Float32Array(5)];
      expect(ring.read(out, 5)).toBe(5);
      expect(out[0][4]).toBe(i * 5 + 4);
    }
    expect(ring.available()).toBe(0);
  });

  it("rejects nonsense sizes", () => {
    expect(() => LiveRing.create({ channels: 0, capacityFrames: 8 })).toThrow();
    expect(() => LiveRing.create({ channels: 1, capacityFrames: 1 })).toThrow();
    expect(() => LiveRing.attach(new ArrayBuffer(8), { channels: 1, capacityFrames: 8 })).toThrow();
  });
});
