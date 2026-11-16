import { describe, expect, it } from "vitest";
import { decodeDng, decodeLosslessJpeg, developRaw, defaultRawSettings, encodeLosslessJpeg, RawDecodeError, writeDng } from "./index";

/**
 * Memory-safety checks for the RAW parser: every hostile input must end in a RawDecodeError (or a successful
 * decode), never a RangeError/TypeError, a hang, or an allocation far larger than the file justifies.
 */

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function ramp(n: number, max: number): Uint16Array {
  const a = new Uint16Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 37) % max;
  return a;
}

const variants: Array<[string, () => Uint8Array]> = [
  ["plain 12-bit strips", () => writeDng({ width: 16, height: 12, samples: ramp(16 * 12, 4096), bitsPerSample: 12, rowsPerStrip: 5 })],
  ["plain 16-bit tiles", () => writeDng({ width: 20, height: 20, samples: ramp(400, 65535), bitsPerSample: 16, tile: { width: 16, height: 16 } })],
  ["lossless jpeg", () => writeDng({ width: 16, height: 12, samples: ramp(16 * 12, 4096), bitsPerSample: 12, compression: "lossless-jpeg" })],
  ["lossless jpeg tiles", () => writeDng({ width: 32, height: 32, samples: ramp(1024, 4096), bitsPerSample: 12, compression: "lossless-jpeg", tile: { width: 16, height: 16 } })],
  ["linear raw", () => writeDng({ width: 8, height: 8, samples: ramp(8 * 8 * 3, 4096), bitsPerSample: 12, linearRaw: true })],
];

function setTag(file: Uint8Array, wanted: number, value: number): void {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const count = view.getUint16(8, true);
  for (let i = 0; i < count; i++) {
    const at = 10 + i * 12;
    if (view.getUint16(at, true) !== wanted) continue;
    if (view.getUint16(at + 2, true) === 3) view.setUint16(at + 8, value, true);
    else view.setUint32(at + 8, value, true);
  }
}

describe("RAW parser fuzzing", () => {
  for (const [name, make] of variants) {
    it(`survives random byte corruption: ${name}`, () => {
      const base = make();
      const random = rng(0xc0ffee);
      for (let iter = 0; iter < 400; iter++) {
        const copy = new Uint8Array(base);
        const flips = 1 + Math.floor(random() * 6);
        for (let f = 0; f < flips; f++) copy[Math.floor(random() * copy.length)] = Math.floor(random() * 256);
        try {
          const raw = decodeDng(copy);
          developRaw(raw, defaultRawSettings(raw), { maxLongEdge: 64 });
        } catch (error) {
          const tooSmall = error instanceof Error && error.message === "The raw image is too small to develop.";
          if (!(error instanceof RawDecodeError) && !tooSmall) {
            throw new Error(`iteration ${iter}: ${(error as Error).name}: ${(error as Error).message}`);
          }
        }
      }
    });

    it(`survives every truncation point: ${name}`, () => {
      const base = make();
      for (let len = 0; len < base.length; len += 3) {
        try {
          decodeDng(base.subarray(0, len));
        } catch (error) {
          expect(error).toBeInstanceOf(RawDecodeError);
        }
      }
    });
  }

  it("does not allocate a huge image for a tiny file that merely claims one", () => {
    const base = writeDng({ width: 16, height: 16, samples: ramp(256, 4096), bitsPerSample: 12 });
    setTag(base, 256, 20000);
    setTag(base, 257, 20000);
    const before = process.memoryUsage().arrayBuffers;
    expect(() => decodeDng(base)).toThrow(RawDecodeError);
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(64 * 1024 * 1024);
  });

  it("rejects absurd tile sizes before allocating a block", () => {
    const base = writeDng({ width: 32, height: 32, samples: ramp(1024, 4096), bitsPerSample: 12, tile: { width: 16, height: 16 } });
    setTag(base, 322, 65535);
    setTag(base, 323, 65535);
    const before = process.memoryUsage().arrayBuffers;
    expect(() => decodeDng(base)).toThrow(RawDecodeError);
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(64 * 1024 * 1024);
  });

  it("rejects a lossless JPEG whose header claims far more samples than its data can code", () => {
    const good = encodeLosslessJpeg(ramp(64, 4096), 8, 8, 1, 12);
    const bad = new Uint8Array(good);
    for (let i = 0; i + 8 < bad.length; i++) {
      if (bad[i] === 0xff && bad[i + 1] === 0xc3) {
        // SOF3: marker, length(2), precision(1), height(2), width(2)
        bad[i + 5] = 0x40; bad[i + 6] = 0x00; bad[i + 7] = 0x40; bad[i + 8] = 0x00;
        break;
      }
    }
    const before = process.memoryUsage().arrayBuffers;
    expect(() => decodeLosslessJpeg(bad)).toThrow(RawDecodeError);
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(64 * 1024 * 1024);
  });

  it("rejects a Huffman symbol that is not a valid lossless difference category", () => {
    const good = encodeLosslessJpeg(ramp(64, 4096), 8, 8, 1, 12);
    const bad = new Uint8Array(good);
    for (let i = 0; i + 24 < bad.length; i++) {
      if (bad[i] === 0xff && bad[i + 1] === 0xc4) {
        // marker(2) length(2) class/id(1) counts(16), then the symbols
        const countsAt = i + 2 + 2 + 1;
        let total = 0;
        for (let c = 0; c < 16; c++) total += bad[countsAt + c];
        for (let c = 0; c < total; c++) bad[countsAt + 16 + c] = 200;
        break;
      }
    }
    expect(() => decodeLosslessJpeg(bad)).toThrow(RawDecodeError);
  });
});
