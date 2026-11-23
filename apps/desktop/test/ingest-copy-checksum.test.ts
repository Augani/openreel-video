import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { afterAll, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyIntoFolder, createDigester, hashFile } from "../src/main/ingest/copy-ingest";
import { runCopyJob } from "../src/main/ingest/copy-runner";
import { xxh64 } from "../src/main/ingest/xxhash64";
import type { ProxyJob } from "../src/main/ingest/proxy-queue";

let work = "";
beforeAll(() => {
  work = mkdtempSync(path.join(os.tmpdir(), "oringest-copy-"));
});
afterAll(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

const make = async (name: string, bytes = 300_000): Promise<{ file: string; data: Buffer }> => {
  const file = path.join(work, name);
  const data = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) data[i] = (i * 7 + 3) & 0xff;
  await fs.writeFile(file, data);
  return { file, data };
};

describe("copy with checksum verification", () => {
  for (const algorithm of ["sha256", "md5", "xxh64"] as const) {
    it(`${algorithm}: reports the digest of the verified copy and leaves the original alone`, async () => {
      const { file, data } = await make(`src-${algorithm}.mov`);
      const dest = path.join(work, `dest-${algorithm}`);
      const result = await copyIntoFolder({ srcPath: file, destDir: dest, algorithm });
      const expected = algorithm === "xxh64" ? xxh64(data) : createHash(algorithm).update(data).digest("hex");
      expect(result.checksum).toEqual({ algorithm, value: expected });
      expect(result.sha256).toBe(algorithm === "sha256" ? expected : "");
      expect(await fs.readFile(result.destPath)).toEqual(data);
      expect(await fs.readFile(file)).toEqual(data);
      expect(await hashFile(result.destPath, undefined, undefined, algorithm)).toBe(expected);
    });
  }
  it("defaults to SHA-256", async () => {
    const { file } = await make("src-default.mov", 1000);
    const result = await copyIntoFolder({ srcPath: file, destDir: path.join(work, "dest-default") });
    expect(result.checksum.algorithm).toBe("sha256");
    expect(result.sha256).toBe(result.checksum.value);
  });
  it("digesters agree with the reference implementations", () => {
    const data = Buffer.from("hello world");
    const md5 = createDigester("md5");
    md5.update(data);
    expect(md5.digest()).toBe(createHash("md5").update(data).digest("hex"));
  });

  for (const algorithm of ["sha256", "md5", "xxh64"] as const) {
    it(`${algorithm}: a corrupted copy is caught, reported, and nothing is kept`, async () => {
      const { file, data } = await make(`src-bad-${algorithm}.mov`);
      const dest = path.join(work, `dest-bad-${algorithm}`);
      await expect(
        copyIntoFolder({
          srcPath: file,
          destDir: dest,
          algorithm,
          // A flipped bit in the middle of the written file: same size, different content.
          afterWrite: async (part) => {
            const fd = await fs.open(part, "r+");
            await fd.write(Buffer.from([data[150_000] ^ 0xff]), 0, 1, 150_000);
            await fd.close();
          },
        }),
      ).rejects.toThrow(new RegExp(`failed ${algorithm} verification`, "i"));
      expect(await fs.readdir(dest)).toEqual([]);
      expect(await fs.readFile(file)).toEqual(data);
    });
  }
});

describe("resuming a copy after a restart", () => {
  it("removes the stale .part of a killed run and copies again", async () => {
    const { file, data } = await make("src-resume.mov");
    const dest = path.join(work, "dest-resume");
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, "src-resume.mov.part"), "half a file");
    const result = await copyIntoFolder({ srcPath: file, destDir: dest, algorithm: "md5", reuseIdentical: true });
    expect(path.basename(result.destPath)).toBe("src-resume.mov");
    expect(await fs.readFile(result.destPath)).toEqual(data);
    expect((await fs.readdir(dest)).sort()).toEqual(["src-resume.mov"]);
  });
  it("keeps an identical copy a finished-but-unrecorded run left, instead of making a (2)", async () => {
    const { file } = await make("src-reuse.mov");
    const dest = path.join(work, "dest-reuse");
    const first = await copyIntoFolder({ srcPath: file, destDir: dest, algorithm: "xxh64" });
    const again = await copyIntoFolder({ srcPath: file, destDir: dest, algorithm: "xxh64", reuseIdentical: true });
    expect(again.destPath).toBe(first.destPath);
    expect(again.reused).toBe(true);
    expect(await fs.readdir(dest)).toEqual(["src-reuse.mov"]);
  });
  it("does not reuse a different file with the same name", async () => {
    const { file } = await make("src-diff.mov");
    const dest = path.join(work, "dest-diff");
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, "src-diff.mov"), Buffer.alloc(300_000, 1));
    const result = await copyIntoFolder({ srcPath: file, destDir: dest, algorithm: "md5", reuseIdentical: true });
    expect(path.basename(result.destPath)).toBe("src-diff (2).mov");
  });
  it("the queue's copy worker returns the verified result", async () => {
    const { file } = await make("src-worker.mov", 5000);
    const dest = path.join(work, "dest-worker");
    const job = { kind: "copy", copy: { algorithm: "md5" }, srcPath: file, outDir: dest } as ProxyJob;
    const result = await runCopyJob(job, () => undefined, new AbortController().signal);
    expect(result.checksum.algorithm).toBe("md5");
    expect(result.reused).toBe(false);
    expect(path.dirname(result.destPath)).toBe(dest);
  });
  it("a cancelled copy leaves no file behind", async () => {
    const { file } = await make("src-cancel.mov", 2_000_000);
    const dest = path.join(work, "dest-cancel");
    const controller = new AbortController();
    const run = copyIntoFolder({ srcPath: file, destDir: dest, algorithm: "xxh64", signal: controller.signal, onProgress: (f) => f > 0 && controller.abort() });
    await expect(run).rejects.toBeTruthy();
    expect(await fs.readdir(dest).catch(() => [])).toEqual([]);
  });
});
