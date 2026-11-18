import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CONTENT_HASH_CHUNK_BYTES,
  CONTENT_HASH_HEADER,
  computeFingerprint,
  fingerprintBlob,
  fingerprintMismatch,
  hashBlobContent,
} from "./source-fingerprint";

const bytes = (n: number, seed = 1) => {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 31 + seed) & 0xff;
  return a;
};

/** The hash definition written out with node:crypto only, as the desktop main process computes it. */
function referenceHash(data: Uint8Array): string {
  const digests: Buffer[] = [];
  for (let from = 0; from < data.length; from += CONTENT_HASH_CHUNK_BYTES) {
    digests.push(createHash("sha256").update(data.subarray(from, from + CONTENT_HASH_CHUNK_BYTES)).digest());
  }
  return createHash("sha256").update(`${CONTENT_HASH_HEADER}\0${data.length}\0`).update(Buffer.concat(digests)).digest("hex");
}

describe("source fingerprint", () => {
  it("is the documented two-level SHA-256 for empty, small, chunk-sized and multi-chunk files", async () => {
    for (const size of [0, 1000, CONTENT_HASH_CHUNK_BYTES, CONTENT_HASH_CHUNK_BYTES + 1, 2.5 * CONTENT_HASH_CHUNK_BYTES]) {
      const data = bytes(size);
      expect(await hashBlobContent(new Blob([data])), `size ${size}`).toBe(referenceHash(data));
    }
  });

  it("detects a change at any position, including the middle that a head/tail sample cannot see", async () => {
    const data = bytes(3 * CONTENT_HASH_CHUNK_BYTES + 12345);
    const base = await computeFingerprint(new Blob([data]));
    expect(fingerprintMismatch(base, await computeFingerprint(new Blob([data])))).toBeNull();
    expect(fingerprintMismatch(base, await computeFingerprint(new Blob([data.subarray(0, data.length - 1)])))).toMatch(/size changed/);
    const positions = [
      0,
      10,
      64 * 1024 + 1, // just past the old head sample
      CONTENT_HASH_CHUNK_BYTES - 1,
      CONTENT_HASH_CHUNK_BYTES, // first byte of the second chunk
      Math.floor(data.length / 2), // the exact middle
      data.length - 64 * 1024 - 1, // just before the old tail sample
      data.length - 5,
      data.length - 1,
    ];
    for (const at of positions) {
      const edited = data.slice();
      edited[at] ^= 1;
      expect(fingerprintMismatch(base, await computeFingerprint(new Blob([edited]))), `edit at byte ${at}`).toMatch(/content changed/);
    }
  });

  it("a single flipped bit in the middle of a large file changes the hash (the old sampled hash did not)", async () => {
    const data = bytes(6 * CONTENT_HASH_CHUNK_BYTES);
    const mid = data.slice();
    mid[3 * CONTENT_HASH_CHUNK_BYTES + 777] ^= 0x10;
    // what the retired guard hashed: the first and last 64 KiB
    const sampled = (d: Uint8Array) => createHash("sha256").update(d.subarray(0, 65536)).update(d.subarray(d.length - 65536)).digest("hex");
    expect(sampled(mid)).toBe(sampled(data));
    expect(await hashBlobContent(new Blob([mid]))).not.toBe(await hashBlobContent(new Blob([data])));
  });

  it("two files whose chunk digests would concatenate to the same bytes still differ by size", async () => {
    expect(await hashBlobContent(new Blob([bytes(10)]))).not.toBe(await hashBlobContent(new Blob([bytes(11)])));
  });

  it("reports progress up to 1 and reads at most a few chunks at a time", async () => {
    const data = bytes(5 * CONTENT_HASH_CHUNK_BYTES);
    const blob = new Blob([data]);
    let live = 0;
    let peak = 0;
    const slice = blob.slice.bind(blob);
    vi.spyOn(blob, "slice").mockImplementation((...args: Parameters<Blob["slice"]>) => {
      const part = slice(...args);
      const read = part.arrayBuffer.bind(part);
      part.arrayBuffer = async () => {
        live++;
        peak = Math.max(peak, live);
        try {
          return await read();
        } finally {
          live--;
        }
      };
      return part;
    });
    const seen: number[] = [];
    await hashBlobContent(blob, { onProgress: (f) => seen.push(f) });
    expect(seen.at(-1)).toBe(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("compares modification times with a 2 s tolerance, and ignores a missing one", () => {
    const a = { size: 5, contentHash: "x", mtimeMs: 1_000_000 };
    expect(fingerprintMismatch(a, { ...a, mtimeMs: 1_001_000 })).toBeNull();
    expect(fingerprintMismatch(a, { ...a, mtimeMs: 1_003_000 })).toMatch(/modification time/);
    expect(fingerprintMismatch(a, { size: 5, contentHash: "x" })).toBeNull();
  });

  it("carries a File's last-modified time", async () => {
    const f = new File([bytes(100)], "a.bin", { lastModified: 12345 });
    expect((await computeFingerprint(f)).mtimeMs).toBe(12345);
  });

  describe("cache", () => {
    it("hashes a file once per identity (name, size, last-modified), even for a new File object", async () => {
      const data = bytes(2000);
      const a = new File([data], "clip.mp4", { lastModified: 777 });
      const b = new File([data], "clip.mp4", { lastModified: 777 });
      const spy = vi.spyOn(a, "slice");
      const first = fingerprintBlob(a);
      expect(fingerprintBlob(a)).toBe(first);
      expect(fingerprintBlob(b)).toBe(first);
      await first;
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("a different modification time, size or name is a different identity", async () => {
      const data = bytes(2000);
      const base = await fingerprintBlob(new File([data], "x.mp4", { lastModified: 1 }));
      const touched = fingerprintBlob(new File([data], "x.mp4", { lastModified: 2 }));
      expect((await touched).mtimeMs).toBe(2);
      expect((await fingerprintBlob(new File([data], "y.mp4", { lastModified: 1 }))).contentHash).toBe(base.contentHash);
      expect((await fingerprintBlob(new File([bytes(2001)], "x.mp4", { lastModified: 1 }))).size).toBe(2001);
    });

    it("keeps a plain Blob per object and does not cache a failed read", async () => {
      const blob = new Blob([bytes(100)]);
      expect(fingerprintBlob(blob)).toBe(fingerprintBlob(blob));
      const bad = new File([bytes(100)], "bad.mp4", { lastModified: 9 });
      const original = bad.slice.bind(bad);
      let fail = true;
      vi.spyOn(bad, "slice").mockImplementation((...args: Parameters<Blob["slice"]>) => {
        if (fail) throw new Error("NotReadableError");
        return original(...args);
      });
      await expect(fingerprintBlob(bad)).rejects.toThrow("NotReadableError");
      fail = false;
      expect((await fingerprintBlob(bad)).size).toBe(100);
    });
  });
});
