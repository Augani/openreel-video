import { describe, expect, it } from "vitest";
import { XxHash64, xxh64 } from "../src/main/ingest/xxhash64";
import { xxh64Reference } from "./xxhash64-reference";

const text = (s: string) => new TextEncoder().encode(s);

describe("xxHash64", () => {
  // Reference values from the xxHash project (seed 0).
  it("matches the reference vectors", () => {
    expect(xxh64(text(""))).toBe("ef46db3751d8e999");
    expect(xxh64(text("a"))).toBe("d24ec4f1a98c6e5b");
    expect(xxh64(text("abc"))).toBe("44bc2cf5ad770999");
  });
  it("agrees with a BigInt reference implementation at every length from 0 to 130 and on random data", () => {
    let seed = 12345;
    const next = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) & 0xff;
    const data = new Uint8Array(5000).map(next);
    for (let n = 0; n <= 130; n++) expect(xxh64(data.subarray(0, n))).toBe(xxh64Reference(data.subarray(0, n)));
    for (const n of [255, 256, 1000, 4999, 5000]) expect(xxh64(data.subarray(0, n))).toBe(xxh64Reference(data.subarray(0, n)));
    expect(xxh64(new Uint8Array(100).fill(255))).toBe(xxh64Reference(new Uint8Array(100).fill(255)));
  });
  it("gives the same digest however the input is chunked (short, 32-byte and long inputs)", () => {
    const data = new Uint8Array(1000).map((_, i) => (i * 31 + 7) & 0xff);
    const whole = xxh64(data);
    for (const step of [1, 7, 31, 32, 33, 100, 999]) {
      const h = new XxHash64();
      for (let i = 0; i < data.length; i += step) h.update(data.subarray(i, i + step));
      expect(h.digest()).toBe(whole);
    }
  });
  it("changes when a single bit changes", () => {
    const a = new Uint8Array(64).fill(3);
    const b = a.slice();
    b[40] ^= 1;
    expect(xxh64(a)).not.toBe(xxh64(b));
  });
});
