import { describe, it, expect, afterAll } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { FileWriterRegistry } from "../src/main/ipc/fs";

const target = path.join(tmpdir(), `openreel-test-${Date.now()}.bin`);

describe("FileWriterRegistry", () => {
  afterAll(() => rm(target, { force: true }));

  it("writes positioned chunks then finalizes to disk", async () => {
    const reg = new FileWriterRegistry();
    const id = await reg.open(target);
    await reg.writeChunk(id, new TextEncoder().encode("world").buffer, 5);
    await reg.writeChunk(id, new TextEncoder().encode("hello").buffer, 0);
    await reg.close(id);
    expect(await readFile(target, "utf8")).toBe("helloworld");
  });

  it("writes Uint8Array chunks without requiring an ArrayBuffer copy", async () => {
    const reg = new FileWriterRegistry();
    const id = await reg.open(target);
    const chunk = new TextEncoder().encode("typed-array");
    await reg.writeChunk(id, chunk, 0);
    await reg.close(id);
    expect(await readFile(target, "utf8")).toBe("typed-array");
  });

  it("abort discards the partial file", async () => {
    const reg = new FileWriterRegistry();
    const id = await reg.open(target);
    await reg.writeChunk(id, new TextEncoder().encode("partial").buffer, 0);
    await reg.abort(id);
    await expect(readFile(target)).rejects.toBeDefined();
  });
});
