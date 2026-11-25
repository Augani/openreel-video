import { describe, expect, it } from "vitest";
import { hashMediaBlob } from "./media-hash";

describe("hashMediaBlob", () => {
  it("is stable for identical bytes and differs for different content or size", async () => {
    const a = await hashMediaBlob(new Blob([new Uint8Array(1000).fill(1)]));
    const b = await hashMediaBlob(new Blob([new Uint8Array(1000).fill(1)]));
    const c = await hashMediaBlob(new Blob([new Uint8Array(1000).fill(2)]));
    const d = await hashMediaBlob(new Blob([new Uint8Array(1001).fill(1)]));
    expect(a).toBe(b);
    expect(new Set([a, c, d]).size).toBe(3);
  });

  it("samples head, middle and tail of large files", async () => {
    const big = new Uint8Array(2 * 1024 * 1024);
    const base = await hashMediaBlob(new Blob([big]));
    const tail = big.slice();
    tail[tail.length - 1] = 9;
    expect(await hashMediaBlob(new Blob([tail]))).not.toBe(base);
  });
});
