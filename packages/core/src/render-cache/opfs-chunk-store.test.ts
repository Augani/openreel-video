import { describe, expect, it } from "vitest";
import { OpfsChunkStore, type OpfsDirectoryLike, type OpfsFileLike } from "./opfs-chunk-store";

/** In-memory stand-in for an OPFS directory handle. */
class FakeDir implements OpfsDirectoryLike {
  readonly files = new Map<string, ArrayBuffer>();
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileLike> {
    if (!this.files.has(name)) {
      if (!options?.create) throw new DOMException("not found", "NotFoundError");
      this.files.set(name, new ArrayBuffer(0));
    }
    return {
      getFile: async () => {
        const data = this.files.get(name) as ArrayBuffer;
        return { size: data.byteLength, arrayBuffer: async () => data };
      },
      createWritable: async () => ({
        write: async (data: ArrayBuffer) => void this.files.set(name, data),
        close: async () => undefined,
      }),
    };
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) throw new DOMException("not found", "NotFoundError");
  }
  async *entries(): AsyncIterable<[string, { kind: string }]> {
    for (const name of Array.from(this.files.keys())) yield [name, { kind: "file" }];
  }
}

describe("OpfsChunkStore", () => {
  it("stores, lists, reads back and deletes entries", async () => {
    const dir = new FakeDir();
    const store = new OpfsChunkStore(dir);
    await store.put("f1", new Uint8Array([1, 2, 3]).buffer as ArrayBuffer);
    await store.put("p:f2", new Uint8Array([4]).buffer as ArrayBuffer);
    expect(new Uint8Array((await store.get("f1")) as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store.get("missing")).toBeUndefined();
    expect((await store.list()).sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: "f1", bytes: 3 },
      { key: "p:f2", bytes: 1 },
    ]);
    expect(await store.size()).toBe(4);
    await store.delete(["f1", "nope"]);
    expect(await store.purge((k) => k === "keep")).toBe(1);
    expect(await store.list()).toEqual([]);
  });
});
