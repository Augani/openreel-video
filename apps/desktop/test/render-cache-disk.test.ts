import { mkdtempSync, rmSync, readdirSync, writeFileSync, utimesSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RenderCacheDisk } from "../src/main/render-cache/disk-store";
import {
  DEFAULT_RENDER_CACHE_SETTINGS,
  isAcceptableScratchDir,
  loadRenderCacheSettings,
  probeWritable,
  saveRenderCacheSettings,
} from "../src/main/render-cache/settings";
import { RENDER_CACHE_FOLDER, renderCachePutArgsSchema } from "../src/shared/render-cache";

let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(path.join(os.tmpdir(), "openreel-rc-test-"));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const bytes = (n: number, v = 1) => new Uint8Array(n).fill(v);

describe("RenderCacheDisk", () => {
  it("stores frames atomically under the scratch folder and reads them back", async () => {
    const disk = new RenderCacheDisk(scratch);
    await disk.put("pAbc", "f12", bytes(10, 7));
    await disk.put("pAbc", "__index__", new TextEncoder().encode("{}"));
    expect(Array.from((await disk.get("pAbc", "f12")) as Uint8Array)).toEqual(Array(10).fill(7));
    expect(await disk.get("pAbc", "f99")).toBeUndefined();
    expect((await disk.list("pAbc")).sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: "__index__", bytes: 2 },
      { key: "f12", bytes: 10 },
    ]);
    expect(readdirSync(path.join(scratch, RENDER_CACHE_FOLDER, "pAbc")).some((n) => n.endsWith(".tmp"))).toBe(false);
  });

  it("rejects keys that could escape the project folder", async () => {
    const disk = new RenderCacheDisk(scratch);
    await expect(disk.put("../evil", "f1", bytes(1))).rejects.toThrow();
    await expect(disk.put("pAbc", "../../x", bytes(1))).rejects.toThrow();
    await expect(disk.get("p/abc", "f1")).rejects.toThrow();
    expect(renderCachePutArgsSchema.safeParse({ project: "a/b", key: "f1", data: bytes(1) }).success).toBe(false);
    expect(renderCachePutArgsSchema.safeParse({ project: "ab", key: "f1.frm", data: bytes(1) }).success).toBe(false);
    expect(readdirSync(scratch)).toEqual([]);
  });

  it("deletes frames, clears a project, and clearAll leaves the scratch folder itself alone", async () => {
    const disk = new RenderCacheDisk(scratch);
    writeFileSync(path.join(scratch, "keep-me.txt"), "x");
    await disk.put("pA", "f1", bytes(5));
    await disk.put("pA", "f2", bytes(5));
    await disk.put("pB", "f1", bytes(5));
    await disk.delete("pA", ["f1", "f404"]);
    expect((await disk.list("pA")).map((e) => e.key)).toEqual(["f2"]);
    await disk.clearProject("pA");
    expect(await disk.list("pA")).toEqual([]);
    await disk.clearAll();
    expect(existsSync(path.join(scratch, RENDER_CACHE_FOLDER))).toBe(false);
    expect(existsSync(path.join(scratch, "keep-me.txt"))).toBe(true);
  });

  it("removes crash-leftover temp files when listing", async () => {
    const disk = new RenderCacheDisk(scratch);
    await disk.put("pA", "f1", bytes(5));
    writeFileSync(path.join(scratch, RENDER_CACHE_FOLDER, "pA", "f2.frm.123.tmp"), "torn");
    expect((await disk.list("pA")).map((e) => e.key)).toEqual(["f1"]);
    expect(readdirSync(path.join(scratch, RENDER_CACHE_FOLDER, "pA"))).toEqual(["f1.frm"]);
  });

  it("trims the least recently touched projects first when over the cap, never the open one", async () => {
    const disk = new RenderCacheDisk(scratch);
    for (const [name, age] of [["pOld", 3000], ["pMid", 2000], ["pNew", 1000]] as const) {
      await disk.put(name, "f1", bytes(100));
      const t = (Date.now() - age * 1000) / 1000;
      utimesSync(path.join(scratch, RENDER_CACHE_FOLDER, name, "f1.frm"), t, t);
    }
    expect((await disk.usage()).bytes).toBe(300);
    expect(await disk.trim(250, null)).toEqual(["pOld"]);
    // the open project is exempt even though it is the oldest
    await disk.put("pOld", "f1", bytes(100));
    const t = (Date.now() - 9_000_000) / 1000;
    utimesSync(path.join(scratch, RENDER_CACHE_FOLDER, "pOld", "f1.frm"), t, t);
    expect(await disk.trim(150, "pOld")).toEqual(["pMid", "pNew"]);
    expect((await disk.usage()).projects.map((p) => p.key)).toEqual(["pOld"]);
  });

  it("sweeps projects untouched for longer than the limit", async () => {
    const disk = new RenderCacheDisk(scratch);
    await disk.put("pStale", "f1", bytes(10));
    await disk.put("pFresh", "f1", bytes(10));
    const old = (Date.now() - 40 * 86400_000) / 1000;
    utimesSync(path.join(scratch, RENDER_CACHE_FOLDER, "pStale", "f1.frm"), old, old);
    expect(await disk.sweepStale(30 * 86400_000, null)).toEqual(["pStale"]);
  });
});

describe("render cache settings", () => {
  it("persists, clamps and falls back safely", () => {
    const file = path.join(scratch, "s.json");
    expect(loadRenderCacheSettings(file)).toEqual(DEFAULT_RENDER_CACHE_SETTINGS);
    const dir = path.join(scratch, "fast-ssd");
    saveRenderCacheSettings(file, { scratchDir: dir, capBytes: 5 * 1024 ** 3 });
    expect(loadRenderCacheSettings(file)).toEqual({ scratchDir: dir, capBytes: 5 * 1024 ** 3 });
    writeFileSync(file, JSON.stringify({ scratchDir: "relative/dir", capBytes: 1 }));
    expect(loadRenderCacheSettings(file)).toEqual({ scratchDir: null, capBytes: 512 * 1024 * 1024 });
    writeFileSync(file, "{broken");
    expect(loadRenderCacheSettings(file)).toEqual(DEFAULT_RENDER_CACHE_SETTINGS);
  });

  it("refuses the file-system root and the home folder as scratch disk", () => {
    expect(isAcceptableScratchDir("/")).toBe(false);
    expect(isAcceptableScratchDir(os.homedir())).toBe(false);
    expect(isAcceptableScratchDir("relative")).toBe(false);
    expect(isAcceptableScratchDir(scratch)).toBe(true);
  });

  it("probes writability", async () => {
    expect(await probeWritable(path.join(scratch, "new", "nested"))).toBe(true);
    const file = path.join(scratch, "a-file");
    writeFileSync(file, "x");
    expect(await probeWritable(path.join(file, "sub"))).toBe(false);
    mkdirSync(path.join(scratch, "ro"));
  });
});
