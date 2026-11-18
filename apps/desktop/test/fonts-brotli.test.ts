import { describe, it, expect } from "vitest";
import { brotliCompressSync } from "node:zlib";
import { brotliDecompressBounded } from "../src/main/ipc/fonts";

describe("fonts brotliDecompressBounded (WOFF2 licence check, main process)", () => {
  it("round-trips a Brotli stream", async () => {
    const original = new Uint8Array(5000).map((_, i) => (i * 7) % 251);
    const out = await brotliDecompressBounded(new Uint8Array(brotliCompressSync(original)));
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual(Array.from(original));
  });

  it("returns null for data that is not Brotli", async () => {
    expect(await brotliDecompressBounded(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 1, 2, 3]))).toBeNull();
  });
});
