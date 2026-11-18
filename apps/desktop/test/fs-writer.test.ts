import { describe, it, expect, afterAll } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile, rm, mkdtemp, writeFile, symlink, lstat, stat, chmod, readdir, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { utimes } from "node:fs/promises";
import { FileWriterRegistry, PART_SUFFIX, sweepPartFiles, writeTextFile } from "../src/main/ipc/fs";

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

  it("abort discards the partial file and leaves an existing target alone", async () => {
    const fresh = target + ".fresh";
    const reg = new FileWriterRegistry();
    const id = await reg.open(fresh);
    await reg.writeChunk(id, new TextEncoder().encode("partial").buffer, 0);
    await reg.abort(id);
    await expect(readFile(fresh)).rejects.toBeDefined();
    await expect(readFile(fresh + PART_SUFFIX)).rejects.toBeDefined();
    const id2 = await reg.open(target);
    await reg.writeChunk(id2, new TextEncoder().encode("half").buffer, 0);
    await reg.abort(id2);
    expect(await readFile(target, "utf8")).toBe("typed-array");
  });
});

describe.skipIf(process.platform === "win32")("writeTextFile", () => {
  async function scratch(): Promise<string> {
    return mkdtemp(path.join(tmpdir(), "openreel-wtf-"));
  }

  it("keeps a symlinked project file a symlink and updates its target", async () => {
    const dir = await scratch();
    const real = path.join(dir, "real.json");
    const link = path.join(dir, "link.json");
    await writeFile(real, "old");
    await symlink(real, link);
    await writeTextFile({ path: link, data: "new" });
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(real, "utf8")).toBe("new");
    await rm(dir, { recursive: true, force: true });
  });

  it("preserves the existing file mode", async () => {
    const dir = await scratch();
    const file = path.join(dir, "p.json");
    await writeFile(file, "old");
    await chmod(file, 0o640);
    await writeTextFile({ path: file, data: "new" });
    expect((await stat(file)).mode & 0o777).toBe(0o640);
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a missing file", async () => {
    const dir = await scratch();
    const file = path.join(dir, "fresh.json");
    await writeTextFile({ path: file, data: "x" });
    expect(await readFile(file, "utf8")).toBe("x");
    await rm(dir, { recursive: true, force: true });
  });

  it.skipIf(process.getuid?.() === 0)("writes in place when the directory is read-only", async () => {
    const dir = await scratch();
    const file = path.join(dir, "p.json");
    await writeFile(file, "old");
    await chmod(dir, 0o555);
    try {
      await writeTextFile({ path: file, data: "new" });
      expect(await readFile(file, "utf8")).toBe("new");
    } finally {
      await chmod(dir, 0o755);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("removes the tmp file when the rename fails", async () => {
    const dir = await scratch();
    const target = path.join(dir, "target");
    await mkdir(target);
    await expect(writeTextFile({ path: target, data: "x" })).rejects.toBeDefined();
    expect(await readdir(dir)).toEqual(["target"]);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("crash safety of writes", () => {
  it("export writer: the target appears only on close; the old file survives until then", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openreel-part-"));
    const file = path.join(dir, "out.mp4");
    await writeFile(file, "previous good export");
    const reg = new FileWriterRegistry();
    const id = await reg.open(file);
    await reg.writeChunk(id, new TextEncoder().encode("half of the new").buffer, 0);
    // Mid-write (the app could be killed right here): old file intact, partial bytes live in .part.
    expect(await readFile(file, "utf8")).toBe("previous good export");
    expect(await readdir(dir)).toContain("out.mp4" + PART_SUFFIX);
    await reg.close(id);
    expect(await readFile(file, "utf8")).toBe("half of the new");
    expect(await readdir(dir)).toEqual(["out.mp4"]);
    await rm(dir, { recursive: true, force: true });
  });

  it("sweeps stale .part and orphaned temp files but not young ones or other files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openreel-sweep-"));
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const stalePart = path.join(dir, "openreel-export-x.mp4" + PART_SUFFIX);
    const staleTmp = path.join(dir, `project.json.${uuid}.tmp`);
    const young = path.join(dir, "openreel-export-y.mp4" + PART_SUFFIX);
    const keep = path.join(dir, "finished.mp4");
    for (const f of [stalePart, staleTmp, young, keep]) await writeFile(f, "x");
    const old = new Date(Date.now() - 3_600_000);
    await utimes(stalePart, old, old);
    await utimes(staleTmp, old, old);
    const removed = await sweepPartFiles(dir, 60_000);
    expect(removed.sort()).toEqual([stalePart, staleTmp].sort());
    expect((await readdir(dir)).sort()).toEqual(["finished.mp4", "openreel-export-y.mp4" + PART_SUFFIX]);
    await rm(dir, { recursive: true, force: true });
  });

  it("writeTextFile never deletes someone else's old .part file in the user's folder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openreel-foreign-"));
    const foreign = path.join(dir, "movie.mkv" + PART_SUFFIX);
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const orphan = path.join(dir, `project.json.${uuid}.tmp`);
    for (const f of [foreign, orphan]) await writeFile(f, "x");
    const old = new Date(Date.now() - 3_600_000);
    await utimes(foreign, old, old);
    await utimes(orphan, old, old);
    await writeTextFile({ path: path.join(dir, "project.json"), data: "{}" });
    await new Promise((r) => setTimeout(r, 300));
    expect((await readdir(dir)).sort()).toEqual(["movie.mkv" + PART_SUFFIX, "project.json"]);
    await rm(dir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")("SIGKILL while a writer loops: the project file is always whole (old or new), never truncated", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openreel-kill-"));
    const file = path.join(dir, "project.json");
    const valid = (n: number) => JSON.stringify({ n, pad: "x".repeat(2_000_000) });
    await writeFile(file, valid(0));
    // A child that rewrites the file as fast as it can with the same temp+fsync+rename sequence.
    const script = `
      const fs = require("node:fs/promises");
      const { randomUUID } = require("node:crypto");
      (async () => { for (let n = 1; ; n++) {
        const tmp = process.argv[1] + "." + randomUUID() + ".tmp";
        const fh = await fs.open(tmp, "w");
        await fh.writeFile(JSON.stringify({ n, pad: "x".repeat(2000000) }), "utf8");
        await fh.sync(); await fh.close();
        await fs.rename(tmp, process.argv[1]);
      } })();`;
    for (let round = 0; round < 12; round++) {
      const child = spawn(process.execPath, ["-e", script, file], { stdio: "ignore" });
      await new Promise((r) => setTimeout(r, 40 + round * 23));
      child.kill("SIGKILL");
      await new Promise((r) => child.once("exit", r));
      const parsed = JSON.parse(await readFile(file, "utf8")) as { n: number; pad: string };
      expect(parsed.pad.length).toBe(2_000_000);
    }
    expect(valid(1).length).toBeGreaterThan(0);
    await rm(dir, { recursive: true, force: true });
  });
});
