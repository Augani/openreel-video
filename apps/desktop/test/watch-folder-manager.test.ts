import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WatchFolderConfig, WatchFoldersSnapshot } from "../src/shared/watch-folders";
import { Ledger, fingerprintFile, type LedgerStore } from "../src/main/watch/ledger";
import { WatchFolderManager, type ConfigStore, type FolderContext, type IngestOutcome, type WatchHandlers } from "../src/main/watch/manager";
import { createFileConfigStore } from "../src/main/watch/ipc";

// These tests wait on real timers and folders; a loaded machine (the full parallel suite) needs more than 5 s.
vi.setConfig({ testTimeout: 30_000 });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(label: string, check: () => boolean, timeout = 15000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(15);
  }
}

const OPTIONS = {
  scanner: { settleMs: 150, pollMs: 40, rescanMs: 250, debounceMs: 20 },
  retryWaitMs: 150,
  emitThrottleMs: 10,
};

let root = "";
let managers: WatchFolderManager[] = [];
beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "watch-mgr-")));
});
afterEach(() => {
  for (const manager of managers) manager.stop();
  managers = [];
  fs.rmSync(root, { recursive: true, force: true });
});

function memoryConfig(initial: WatchFolderConfig[] = []): ConfigStore & { saved: WatchFolderConfig[] } {
  const store = { saved: initial, load: () => store.saved.map((f) => ({ ...f })), save: (folders: WatchFolderConfig[]) => void (store.saved = folders.map((f) => ({ ...f }))) };
  return store;
}
function memoryLedger(shared?: { data: unknown }): Ledger {
  const box = shared ?? { data: {} };
  const store: LedgerStore = { load: () => box.data as never, save: (data) => void (box.data = JSON.parse(JSON.stringify(data))) };
  return new Ledger(store);
}

interface Harness {
  manager: WatchFolderManager;
  config: ReturnType<typeof memoryConfig>;
  snapshots: WatchFoldersSnapshot[];
  ingested: string[];
  rendered: string[];
  roots: string[][];
}

function build(options: {
  handlers?: Partial<WatchHandlers>;
  config?: ReturnType<typeof memoryConfig>;
  ledger?: Ledger;
}): Harness {
  const ingested: string[] = [];
  const rendered: string[] = [];
  const snapshots: WatchFoldersSnapshot[] = [];
  const roots: string[][] = [];
  const config = options.config ?? memoryConfig();
  const handlers: WatchHandlers = {
    ingest: async ({ file }: FolderContext): Promise<IngestOutcome> => {
      ingested.push(file.name);
      return { outcome: "imported" };
    },
    renderMedia: async ({ file, folder }) => {
      rendered.push(file.name);
      fs.mkdirSync(folder.outputDir, { recursive: true });
      const out = path.join(folder.outputDir, `${path.basename(file.name, path.extname(file.name))}.mp4`);
      fs.writeFileSync(out, `rendered ${file.name}`);
      return { outputPath: out };
    },
    renderProject: async ({ file, folder }) => {
      rendered.push(file.name);
      const out = path.join(folder.outputDir, "project.mp4");
      fs.mkdirSync(folder.outputDir, { recursive: true });
      fs.writeFileSync(out, "project render");
      return { outputPath: out };
    },
    ...options.handlers,
  };
  const manager = new WatchFolderManager({ configStore: config, ledger: options.ledger ?? memoryLedger(), handlers, emit: (s) => snapshots.push(s), onRoots: (r) => roots.push(r), options: OPTIONS });
  managers.push(manager);
  manager.start();
  return { manager, config, snapshots, ingested, rendered, roots };
}

const itemsOf = (h: Harness) => h.manager.snapshot().items;
const makeDir = (name: string): string => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

describe("ingest watch folders", () => {
  it("imports a file dropped into the folder, once it has finished copying", async () => {
    const dir = makeDir("in");
    const h = build({});
    await h.manager.add("ingest", dir, { bin: "Dailies" });
    fs.writeFileSync(path.join(dir, "a.mp4"), "video bytes");
    await until("imported", () => h.ingested.length === 1);
    await until("item done", () => itemsOf(h).some((i) => i.state === "done"));
    expect(h.ingested).toEqual(["a.mp4"]);
    expect(fs.existsSync(path.join(dir, "a.mp4"))).toBe(true); // ingest never moves originals
    const snapshot = h.manager.snapshot();
    expect(snapshot.folders[0].status).toMatchObject({ state: "watching", done: 1, failed: 0 });
    expect(h.roots.at(-1)).toContain(dir);
  });

  it("skips files that were already in the folder when it was added (baseline) unless processExisting is set", async () => {
    const plain = makeDir("plain");
    const eager = makeDir("eager");
    fs.writeFileSync(path.join(plain, "existing.mp4"), "old");
    fs.writeFileSync(path.join(eager, "existing2.mp4"), "old too");
    const h = build({});
    await h.manager.add("ingest", plain);
    await h.manager.add("ingest", eager, { processExisting: true });
    await until("existing2 imported", () => h.ingested.includes("existing2.mp4"));
    await sleep(500);
    expect(h.ingested).toEqual(["existing2.mp4"]);
    fs.writeFileSync(path.join(plain, "new.mp4"), "new");
    await until("new imported", () => h.ingested.includes("new.mp4"));
  });

  it("ignores files that are not media", async () => {
    const dir = makeDir("in");
    const h = build({});
    await h.manager.add("ingest", dir);
    fs.writeFileSync(path.join(dir, "notes.txt"), "text");
    fs.writeFileSync(path.join(dir, "real.mov"), "movie");
    await until("movie imported", () => h.ingested.length === 1);
    await sleep(400);
    expect(h.ingested).toEqual(["real.mov"]);
    expect(itemsOf(h).map((i) => i.name)).toEqual(["real.mov"]);
  });

  it("keeps a file waiting while no project is open and imports it when one is", async () => {
    const dir = makeDir("in");
    let projectOpen = false;
    const attempts: boolean[] = [];
    const h = build({
      handlers: {
        ingest: async ({ file }) => {
          attempts.push(projectOpen);
          if (!projectOpen) return { outcome: "waiting", detail: "Waiting for a project to be open" };
          return { outcome: "imported" };
        },
      },
    });
    await h.manager.add("ingest", dir);
    fs.writeFileSync(path.join(dir, "late.mp4"), "bytes");
    await until("waiting", () => itemsOf(h).some((i) => i.state === "waiting"));
    expect(itemsOf(h)[0].detail).toMatch(/project/);
    await sleep(400);
    expect(attempts.filter(Boolean)).toHaveLength(0);
    expect(attempts.length).toBeGreaterThan(1); // it keeps retrying
    projectOpen = true;
    await until("done", () => itemsOf(h).some((i) => i.state === "done"));
  });

  it("marks an ingest failure and lets the user retry it", async () => {
    const dir = makeDir("in");
    let fail = true;
    const h = build({
      handlers: {
        ingest: async () => {
          if (fail) throw new Error("The editor could not decode this file.");
          return { outcome: "imported" };
        },
      },
    });
    await h.manager.add("ingest", dir);
    fs.writeFileSync(path.join(dir, "bad.mp4"), "bytes");
    await until("failed", () => itemsOf(h).some((i) => i.state === "failed"));
    expect(itemsOf(h)[0].error).toMatch(/decode/);
    await sleep(500);
    expect(itemsOf(h)).toHaveLength(1); // not retried in a loop
    fail = false;
    await h.manager.retry(itemsOf(h)[0].id);
    await until("done after retry", () => itemsOf(h).some((i) => i.state === "done"));
  });

  it("does not import the same file twice: re-seen after a restart is silent, a renamed copy is a visible duplicate", async () => {
    const dir = makeDir("in");
    const ledgerBox = { data: {} as unknown };
    const config = memoryConfig();
    const first = build({ config, ledger: memoryLedger(ledgerBox) });
    await first.manager.add("ingest", dir);
    fs.writeFileSync(path.join(dir, "take1.mp4"), "identical content");
    await until("imported", () => first.ingested.length === 1);
    first.manager.stop();

    // "Restart": a new manager over the same persisted config and ledger.
    const second = build({ config, ledger: memoryLedger(ledgerBox) });
    await sleep(700);
    expect(second.ingested).toEqual([]); // take1.mp4 is not imported again
    expect(itemsOf(second)).toHaveLength(0);

    fs.copyFileSync(path.join(dir, "take1.mp4"), path.join(dir, "take1-copy.mp4"));
    await until("duplicate item", () => itemsOf(second).some((i) => i.state === "duplicate"));
    expect(second.ingested).toEqual([]);
    expect(itemsOf(second)[0]).toMatchObject({ name: "take1-copy.mp4", state: "duplicate" });
  });

  it("picks up files that arrived while the app was closed", async () => {
    const dir = makeDir("in");
    const config = memoryConfig();
    const first = build({ config });
    await first.manager.add("ingest", dir);
    first.manager.stop();
    fs.writeFileSync(path.join(dir, "while-closed.mp4"), "dropped while closed");
    const second = build({ config });
    await until("imported at startup", () => second.ingested.includes("while-closed.mp4"));
  });

  it("pauses and resumes a folder", async () => {
    const dir = makeDir("in");
    const h = build({});
    const folder = await h.manager.add("ingest", dir);
    await h.manager.update(folder.id, { paused: true });
    fs.writeFileSync(path.join(dir, "while-paused.mp4"), "bytes");
    await sleep(600);
    expect(h.ingested).toEqual([]);
    expect(h.manager.snapshot().folders[0].status.state).toBe("paused");
    expect(h.config.saved[0].paused).toBe(true);
    await h.manager.update(folder.id, { paused: false });
    await until("imported after resume", () => h.ingested.length === 1);
    expect(h.manager.snapshot().folders[0].status.state).toBe("watching");
  });

  it("reports a folder that disappears as missing", async () => {
    const dir = makeDir("in");
    const h = build({});
    await h.manager.add("ingest", dir);
    fs.rmSync(dir, { recursive: true, force: true });
    await until("missing", () => h.manager.snapshot().folders[0].status.state === "missing");
    expect(h.manager.snapshot().folders[0].status.message).toMatch(/missing|mounted/);
  });
});

describe("export watch folders", () => {
  it("renders a dropped file, writes to the output folder and moves the source to done/", async () => {
    const dir = makeDir("export");
    const out = makeDir("rendered");
    const h = build({});
    await h.manager.add("export", dir, { outputDir: out, presetId: "1080p-high" });
    fs.writeFileSync(path.join(dir, "interview.mov"), "raw camera file");
    await until("done", () => itemsOf(h).some((i) => i.state === "done"));
    expect(h.rendered).toEqual(["interview.mov"]);
    expect(fs.readFileSync(path.join(out, "interview.mp4"), "utf8")).toBe("rendered interview.mov");
    expect(fs.existsSync(path.join(dir, "interview.mov"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "done", "interview.mov"))).toBe(true);
    expect(itemsOf(h)[0].outputPath).toBe(path.join(out, "interview.mp4"));
  });

  it("moves a source whose render failed to failed/ with the reason, and does not retry it in a loop", async () => {
    const dir = makeDir("export");
    const h = build({
      handlers: {
        renderMedia: async () => {
          throw new Error("ffmpeg exited with code 1: Invalid data found");
        },
      },
    });
    await h.manager.add("export", dir, { outputDir: path.join(root, "out") });
    fs.writeFileSync(path.join(dir, "broken.mov"), "garbage");
    await until("failed", () => itemsOf(h).some((i) => i.state === "failed"));
    expect(fs.existsSync(path.join(dir, "failed", "broken.mov"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "failed", "broken.mov.error.txt"), "utf8")).toMatch(/Invalid data/);
    expect(fs.existsSync(path.join(dir, "broken.mov"))).toBe(false);
    await sleep(500);
    expect(itemsOf(h)).toHaveLength(1);
  });

  it("treats a second drop of the same content as a duplicate: no second render, moved to done/", async () => {
    const dir = makeDir("export");
    const h = build({});
    await h.manager.add("export", dir, { outputDir: path.join(root, "out") });
    fs.writeFileSync(path.join(dir, "a.mov"), "same bytes in both");
    await until("first done", () => itemsOf(h).some((i) => i.state === "done"));
    fs.writeFileSync(path.join(dir, "b.mov"), "same bytes in both");
    await until("duplicate", () => itemsOf(h).some((i) => i.state === "duplicate"));
    expect(h.rendered).toEqual(["a.mov"]);
    expect(fs.readdirSync(path.join(dir, "done")).sort()).toEqual(["a.mov", "b.mov"]);
  });

  it("renders one file at a time and keeps the output of each", async () => {
    const dir = makeDir("export");
    const out = makeDir("out");
    let active = 0;
    let peak = 0;
    const h = build({
      handlers: {
        renderMedia: async ({ file, folder }) => {
          active++;
          peak = Math.max(peak, active);
          await sleep(120);
          active--;
          const target = path.join(folder.outputDir, `${path.basename(file.name, ".mov")}.mp4`);
          fs.writeFileSync(target, "x");
          return { outputPath: target };
        },
      },
    });
    await h.manager.add("export", dir, { outputDir: out });
    for (const name of ["one.mov", "two.mov", "three.mov"]) fs.writeFileSync(path.join(dir, name), `bytes of ${name}`);
    await until("all done", () => itemsOf(h).filter((i) => i.state === "done").length === 3, 10000);
    expect(peak).toBe(1);
    expect(fs.readdirSync(out).sort()).toEqual(["one.mp4", "three.mp4", "two.mp4"]);
  });

  it("only renders project files when the folder opts in", async () => {
    const dir = makeDir("export");
    const out = makeDir("out");
    const h = build({});
    const folder = await h.manager.add("export", dir, { outputDir: out });
    fs.writeFileSync(path.join(dir, "cut.oreel"), "{}");
    await sleep(600);
    expect(h.rendered).toEqual([]);
    expect(fs.existsSync(path.join(dir, "cut.oreel"))).toBe(true);
    await h.manager.update(folder.id, { includeProjects: true });
    fs.writeFileSync(path.join(dir, "cut2.oreel"), "{ \"v\": 2 }");
    await until("project rendered", () => h.rendered.includes("cut2.oreel"));
  });

  it("ignores files that are not video or audio", async () => {
    const dir = makeDir("export");
    const h = build({});
    await h.manager.add("export", dir, { outputDir: path.join(root, "out") });
    fs.writeFileSync(path.join(dir, "readme.txt"), "text");
    fs.writeFileSync(path.join(dir, "still.png"), "image");
    await sleep(700);
    expect(h.rendered).toEqual([]);
    expect(itemsOf(h)).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, "readme.txt"))).toBe(true);
  });

  it("keeps queued jobs of a paused folder until it is resumed, and drops a removed folder's jobs", async () => {
    const dir = makeDir("export");
    const gate: { release: () => void } = { release: () => undefined };
    const h = build({
      handlers: {
        renderMedia: async ({ file, folder }) => {
          await new Promise<void>((resolve) => (gate.release = resolve));
          const out = path.join(folder.outputDir, `${file.name}.mp4`);
          fs.mkdirSync(folder.outputDir, { recursive: true });
          fs.writeFileSync(out, "x");
          return { outputPath: out };
        },
      },
    });
    const folder = await h.manager.add("export", dir, { outputDir: path.join(root, "out") });
    fs.writeFileSync(path.join(dir, "a.mov"), "aaa");
    fs.writeFileSync(path.join(dir, "b.mov"), "bbb");
    await until("a running", () => itemsOf(h).some((i) => i.state === "running"));
    await h.manager.update(folder.id, { paused: true });
    gate.release();
    await until("a done", () => itemsOf(h).some((i) => i.state === "done"));
    await sleep(500);
    // b was detected before the pause or not at all; either way it must not be rendered while paused.
    expect(itemsOf(h).filter((i) => i.state === "running")).toHaveLength(0);
    h.manager.remove(folder.id);
    expect(h.manager.snapshot().folders).toHaveLength(0);
    expect(itemsOf(h)).toHaveLength(0);
    expect(h.config.saved).toHaveLength(0);
  });
});

describe("validation and persistence", () => {
  it("refuses folders that would loop or overlap", async () => {
    const a = makeDir("a");
    const b = makeDir("b");
    const h = build({});
    await h.manager.add("export", a, { outputDir: b });
    await expect(h.manager.add("ingest", b)).rejects.toThrow(/output of an export watch folder/);
    await expect(h.manager.add("ingest", a)).rejects.toThrow(/already being watched/);
    await expect(h.manager.add("export", makeDir("c"), { outputDir: a })).rejects.toThrow(/picked up again/);
    await expect(h.manager.add("export", makeDir("d"), { outputDir: path.join(root, "d") })).rejects.toThrow(/watched folder itself/);
    await expect(h.manager.add("ingest", path.join(root, "nope"))).rejects.toThrow(/does not exist/);
  });

  it("persists the folder list and survives a restart", async () => {
    const dir = makeDir("in");
    const file = path.join(root, "cfg", "watch-folders.json");
    const store = createFileConfigStore(file);
    const first = build({ config: store as ReturnType<typeof memoryConfig> });
    const added = await first.manager.add("ingest", dir, { bin: "Cards" });
    await first.manager.update(added.id, { createProxies: true, paused: true });
    first.manager.stop();
    const second = build({ config: createFileConfigStore(file) as ReturnType<typeof memoryConfig> });
    const [loaded] = second.manager.snapshot().folders;
    expect(loaded.config).toMatchObject({ id: added.id, kind: "ingest", path: dir, bin: "Cards", createProxies: true, paused: true, baselined: true });
    expect(loaded.status.state).toBe("paused");
  });

  it("drops corrupt entries from the config file instead of failing", () => {
    const file = path.join(root, "watch-folders.json");
    fs.writeFileSync(file, JSON.stringify({ version: 1, folders: [{ id: "x", kind: "bogus", path: "/tmp" }, { id: "ok", kind: "ingest", path: root }, "junk", { id: "rel", kind: "ingest", path: "relative/path" }] }));
    expect(createFileConfigStore(file).load().map((f) => f.id)).toEqual(["ok"]);
    fs.writeFileSync(file, "not json");
    expect(createFileConfigStore(file).load()).toEqual([]);
  });

  it("fingerprints by content, not by name or time", async () => {
    const a = path.join(root, "a.bin");
    const b = path.join(root, "b.bin");
    const c = path.join(root, "c.bin");
    fs.writeFileSync(a, Buffer.alloc(600 * 1024, 7));
    fs.writeFileSync(b, Buffer.alloc(600 * 1024, 7));
    const big = Buffer.alloc(600 * 1024, 7);
    big[big.length - 1] = 9;
    fs.writeFileSync(c, big);
    expect(await fingerprintFile(a)).toBe(await fingerprintFile(b));
    expect(await fingerprintFile(a)).not.toBe(await fingerprintFile(c));
  });
});
