import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FolderScanner, isIgnoredName, type ScanFile } from "../src/main/watch/folder-scanner";

const FAST = { settleMs: 160, pollMs: 40, rescanMs: 250, debounceMs: 20 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(label: string, check: () => boolean, timeout = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(15);
  }
}

let dir = "";
let scanner: FolderScanner | null = null;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "watch-scan-"));
});
afterEach(() => {
  scanner?.stop();
  scanner = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

function startScanner(extra: Partial<ConstructorParameters<typeof FolderScanner>[1]> = {}) {
  const ready: ScanFile[] = [];
  const seen: string[] = [];
  scanner = new FolderScanner(dir, { onReady: (file) => ready.push(file), onSeen: (file) => seen.push(file.name), ...extra }, FAST);
  scanner.start();
  return { ready, seen };
}

describe("isIgnoredName", () => {
  it("ignores hidden files, OS droppings and unfinished-download names", () => {
    for (const name of [".DS_Store", ".hidden.mov", "clip.mov.part", "movie.crdownload", "x.tmp", "~$doc.mov", "Thumbs.db", "a.mp4.download", "b.mov~", "c.partial"]) {
      expect(isIgnoredName(name), name).toBe(true);
    }
    for (const name of ["clip.mov", "My Movie.mp4", "take 1.wav"]) expect(isIgnoredName(name), name).toBe(false);
  });
});

describe("FolderScanner", () => {
  it("reports a finished file once its size stops changing", async () => {
    const { ready } = startScanner();
    fs.writeFileSync(path.join(dir, "clip.mp4"), "hello world");
    await until("ready", () => ready.length === 1);
    expect(ready[0]).toMatchObject({ name: "clip.mp4", size: 11 });
    // And only once.
    await sleep(500);
    expect(ready).toHaveLength(1);
  });

  it("does not report a file that is still being written, then reports it once the writes stop", async () => {
    const { ready } = startScanner();
    const file = path.join(dir, "big.mov");
    fs.writeFileSync(file, "a");
    // Keep appending for longer than the settle window.
    const startedAt = Date.now();
    while (Date.now() - startedAt < 600) {
      fs.appendFileSync(file, "more bytes");
      await sleep(40);
      expect(ready).toHaveLength(0);
    }
    const finalSize = fs.statSync(file).size;
    await until("ready after the writes stop", () => ready.length === 1);
    expect(ready[0].size).toBe(finalSize);
  });

  it("ignores partial-download names and reports the file after it is renamed to its final name", async () => {
    const { ready, seen } = startScanner();
    fs.writeFileSync(path.join(dir, "movie.mp4.part"), "partial");
    fs.writeFileSync(path.join(dir, ".hidden.mp4"), "hidden");
    await sleep(500);
    expect(ready).toHaveLength(0);
    expect(seen).toHaveLength(0);
    fs.renameSync(path.join(dir, "movie.mp4.part"), path.join(dir, "movie.mp4"));
    await until("renamed file ready", () => ready.length === 1);
    expect(ready[0].name).toBe("movie.mp4");
  });

  it("never reports an empty file", async () => {
    const { ready } = startScanner();
    fs.writeFileSync(path.join(dir, "empty.mp4"), "");
    await sleep(600);
    expect(ready).toHaveLength(0);
    fs.writeFileSync(path.join(dir, "empty.mp4"), "now it has bytes");
    await until("ready", () => ready.length === 1);
  });

  it("reports a changed file again as a new version, and skips baselined files", async () => {
    const baseline = path.join(dir, "old.mp4");
    fs.writeFileSync(baseline, "already here");
    const stat = fs.statSync(baseline);
    const { ready } = (() => {
      const collected: ScanFile[] = [];
      scanner = new FolderScanner(dir, { onReady: (file) => collected.push(file) }, FAST);
      scanner.markReported({ path: baseline, name: "old.mp4", size: stat.size, mtimeMs: stat.mtimeMs });
      scanner.start();
      return { ready: collected };
    })();
    await sleep(600);
    expect(ready).toHaveLength(0);
    fs.writeFileSync(baseline, "already here, but edited later");
    await until("changed version", () => ready.length === 1);
    expect(ready[0].size).toBe("already here, but edited later".length);
  });

  it("ignores subfolders (done/ and failed/ are never rescanned)", async () => {
    const { ready } = startScanner();
    fs.mkdirSync(path.join(dir, "done"));
    fs.writeFileSync(path.join(dir, "done", "clip.mp4"), "moved earlier");
    await sleep(600);
    expect(ready).toHaveLength(0);
  });

  it("reports a missing folder, then recovers when it comes back", async () => {
    const events: string[] = [];
    scanner = new FolderScanner(
      dir,
      { onReady: (file) => events.push(`ready:${file.name}`), onUnreadable: () => events.push("unreadable"), onReadable: () => events.push("readable") },
      FAST,
    );
    scanner.start();
    await sleep(100);
    fs.rmSync(dir, { recursive: true, force: true });
    await until("unreadable", () => events.includes("unreadable"));
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "back.mp4"), "after remount");
    await until("recovered file", () => events.includes("ready:back.mp4"));
    expect(events).toContain("readable");
  });
});
