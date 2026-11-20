/**
 * Real-Electron e2e for watch folders (Playwright _electron, the BUILT app).
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * and ffmpeg/ffprobe on disk. Opt in with OPENREEL_DESKTOP_WATCH_E2E=1 (skipped otherwise):
 *   pnpm --filter @openreel/desktop test:watch-e2e
 *
 * Covers, with a seeded folder list (the folder dialog is native, so it is not driven here):
 *  - ingest: a file still being written is NOT imported; once it stops growing it is imported into the
 *    configured bin of the open project, as an undoable action; the task shows in the background task list;
 *    the original stays in place
 *  - a copy of the same content under another name is reported as a duplicate and not imported
 *  - export: a media file dropped in is rendered with the 1080p preset into the output folder (ffprobe
 *    checks the result), the source moves to done/, a duplicate is not rendered twice, a broken file moves
 *    to failed/ with its error
 *  - restart: a file dropped while the app was closed is imported after relaunch, and a file that was
 *    already imported is not imported again
 *  - the Settings > Watch folders tab lists the folders and pauses one, and a paused folder ignores drops
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const root = path.resolve(__dirname, "../../..");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const enabled =
  process.env.OPENREEL_DESKTOP_WATCH_E2E === "1" &&
  fs.existsSync(FFMPEG) &&
  fs.existsSync(FFPROBE) &&
  fs.existsSync(path.join(root, "apps/desktop/dist/main/index.js")) &&
  fs.existsSync(path.join(root, "apps/web/dist/index.html"));
const d = enabled ? describe : describe.skip;

const require = createRequire(path.join(root, "package.json"));
function loadPlaywright(): { _electron: any } {
  const pnpmDir = path.join(root, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((name) => name.startsWith("playwright@"));
  return require(path.join(pnpmDir, dir!, "node_modules/playwright"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(label: string, read: () => Promise<T> | T, timeout = 45_000): Promise<NonNullable<T>> {
  const start = Date.now();
  for (;;) {
    const value = await read();
    if (value) return value as NonNullable<T>;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(150);
  }
}
const probe = (file: string): any => JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));

let work = "";
let ingestDir = "";
let exportDir = "";
let outputDir = "";
let CLIP = "";
let profile = "";
let launches = 0;

function makeClip(out: string, seconds: number, size = "320x240"): void {
  execFileSync(FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=25:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
  ]);
}

interface Session {
  app: any;
  page: any;
}
const sessions: Session[] = [];

async function launch(): Promise<Session> {
  const { _electron } = loadPlaywright();
  const app = await _electron.launch({
    args: [path.join(root, "apps/desktop"), `--user-data-dir=${profile}`],
    env: { ...process.env, OPENREEL_FFMPEG_PATH: FFMPEG, OPENREEL_SKIP_ONBOARDING: "1", OPENREEL_WATCH_SETTLE_MS: "600" },
    timeout: 120_000,
  });
  const page = await app.firstWindow();
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable */
    }
  });
  await page.reload();
  const session = { app, page };
  sessions.push(session);
  launches++;
  return session;
}

async function openEditor(page: any): Promise<void> {
  await page.getByRole("button", { name: /Horizontal/ }).click({ timeout: 60_000 });
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.project), undefined, { timeout: 30_000 });
}

async function closeApp(session: Session | undefined, graceful: boolean): Promise<void> {
  if (!session) return;
  let proc: { kill(signal: string): void };
  try {
    proc = session.app.process();
  } catch {
    return;
  }
  if (graceful) await Promise.race([session.app.evaluate(({ app }: any) => app.quit()).catch(() => undefined), sleep(8000)]);
  else await Promise.race([session.app.evaluate(({ app }: any) => app.exit(0)).catch(() => undefined), sleep(4000)]);
  await sleep(300);
  try {
    proc.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

const snapshot = (page: any): Promise<any> => page.evaluate(() => (window as any).openreel.watchFolders.list());
const library = (page: any): Promise<Array<{ id: string; name: string; binName: string | null }>> =>
  page.evaluate(() => {
    const project = (window as any).__openreelE2E.project.getState().project;
    const bins = project.bins ?? [];
    return project.mediaLibrary.items.map((m: any) => ({ id: m.id, name: m.name, binName: bins.find((b: any) => b.id === m.binId)?.name ?? null }));
  });
const itemsNamed = async (page: any, name: string) => (await snapshot(page)).items.filter((i: any) => i.name === name);

/** Write a file the way a slow copy does: in chunks, with pauses, so its size keeps changing. */
async function slowCopy(src: string, dest: string, chunks = 5, pauseMs = 350): Promise<void> {
  const data = fs.readFileSync(src);
  const size = Math.ceil(data.length / chunks);
  fs.writeFileSync(dest, "");
  for (let i = 0; i < chunks; i++) {
    fs.appendFileSync(dest, data.subarray(i * size, (i + 1) * size));
    await sleep(pauseMs);
  }
}

beforeAll(() => {
  if (!enabled) return;
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "openreel-watch-e2e-")));
  profile = path.join(work, "profile");
  ingestDir = path.join(work, "ingest");
  exportDir = path.join(work, "export-in");
  outputDir = path.join(work, "export-out");
  for (const dir of [ingestDir, exportDir, profile]) fs.mkdirSync(dir, { recursive: true });
  CLIP = path.join(work, "source.mp4");
  makeClip(CLIP, 2);
  // The folder list the Settings tab would have written; the paths are what the native dialog returns.
  fs.writeFileSync(
    path.join(profile, "watch-folders.json"),
    JSON.stringify({
      version: 1,
      folders: [
        { id: "ingest-1", kind: "ingest", path: ingestDir, paused: false, bin: "Dropped", createProxies: false },
        { id: "export-1", kind: "export", path: exportDir, paused: false, presetId: "1080p-high", outputDir, includeProjects: false },
      ],
    }),
  );
});

afterAll(async () => {
  for (const session of sessions) await closeApp(session, false);
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

d("watch folders in the real app", () => {
  let session: Session;

  it("starts watching the saved folders", async () => {
    session = await launch();
    await openEditor(session.page);
    const snap = await until("both folders watching", async () => {
      const s = await snapshot(session.page);
      return s.folders.length === 2 && s.folders.every((f: any) => f.status.state === "watching" && f.config.baselined) ? s : null;
    });
    expect(snap.folders.map((f: any) => f.config.kind).sort()).toEqual(["export", "ingest"]);
  });

  it("does not import a file that is still being written, then imports it into the bin once complete", async () => {
    const dest = path.join(ingestDir, "card-001.mp4");
    const copying = slowCopy(CLIP, dest, 5, 400);
    await sleep(1200);
    // Still growing: seen, but not imported.
    expect((await library(session.page)).some((m) => m.name === "card-001.mp4")).toBe(false);
    expect((await itemsNamed(session.page, "card-001.mp4"))[0]?.state).toBe("detecting");
    await copying;
    const imported = await until("imported", async () => (await library(session.page)).find((m) => m.name === "card-001.mp4" && m.binName === "Dropped"), 60_000);
    expect(imported.binName).toBe("Dropped");
    expect(fs.existsSync(dest)).toBe(true); // the original stays where it was dropped
    // The editor actually decoded it (not a placeholder), and it is a real clip with the right duration.
    const item = await session.page.evaluate((id: string) => {
      const m = (window as any).__openreelE2E.project.getState().project.mediaLibrary.items.find((x: any) => x.id === id);
      return { type: m.type, duration: m.metadata?.duration, path: m.sourceFile?.path ?? null };
    }, imported.id);
    expect(item.type).toBe("video");
    expect(item.duration).toBeGreaterThan(1.5);
    expect(fs.realpathSync(item.path)).toBe(fs.realpathSync(dest));
    const done = await until("item done", async () => (await itemsNamed(session.page, "card-001.mp4")).find((i: any) => i.state === "done"));
    expect(done.detail).toContain('Imported into "Dropped"');
  });

  it("shows watch-folder work in the background task list", async () => {
    const task = await until("completed import task", () =>
      session.page.evaluate(() => {
        const tasks = (window as any).__openreelE2E.backgroundTasks.getSnapshot();
        return tasks.find((t: any) => t.source === "watch-folders" && /card-001/.test(t.title) && t.status === "completed") ?? null;
      }),
    );
    expect(task).toMatchObject({ kind: "import", status: "completed", title: expect.stringContaining("Import card-001.mp4") });
  });

  it("files the media through undoable actions: undo takes it out of the bin, redo puts it back", async () => {
    // Importing a file is not an undo step in OpenReel (same as dragging a file in; Delete removes it). Creating the
    // bin and filing the media in it are, because they run as project actions.
    const binOf = async () => (await library(session.page)).find((m) => m.name === "card-001.mp4")?.binName ?? null;
    expect(await binOf()).toBe("Dropped");
    let undos = 0;
    while ((await binOf()) === "Dropped" && undos < 6) {
      await session.page.evaluate(() => (window as any).__openreelE2E.project.getState().undo());
      undos++;
    }
    expect(await binOf()).toBeNull();
    expect((await library(session.page)).some((m) => m.name === "card-001.mp4")).toBe(true); // the media itself stays
    for (let i = 0; i < undos; i++) await session.page.evaluate(() => (window as any).__openreelE2E.project.getState().redo());
    expect(await binOf()).toBe("Dropped");
  });

  it("reports the same content under another name as a duplicate and does not import it", async () => {
    const before = (await library(session.page)).length;
    fs.copyFileSync(path.join(ingestDir, "card-001.mp4"), path.join(ingestDir, "card-001-copy.mp4"));
    const dup = await until("duplicate", async () => (await itemsNamed(session.page, "card-001-copy.mp4")).find((i: any) => i.state === "duplicate"));
    expect(dup.detail).toMatch(/Same content/);
    expect((await library(session.page)).length).toBe(before);
  });

  it("renders a media file dropped into the export folder with the preset, then moves the source to done/", async () => {
    const dest = path.join(exportDir, "interview.mp4");
    await slowCopy(CLIP, dest, 3, 300);
    const out = path.join(outputDir, "interview.mp4");
    await until("rendered file", () => (fs.existsSync(out) && fs.statSync(out).size > 0 ? out : null), 90_000);
    const info = probe(out);
    const video = info.streams.find((s: any) => s.codec_type === "video");
    expect(video).toMatchObject({ codec_name: "h264", width: 1920, height: 1080 });
    expect(Number(video.avg_frame_rate.split("/")[0]) / Number(video.avg_frame_rate.split("/")[1])).toBeCloseTo(30, 0);
    expect(info.streams.some((s: any) => s.codec_type === "audio")).toBe(true);
    expect(Number(info.format.duration)).toBeGreaterThan(1.5);
    await until("source moved to done", () => fs.existsSync(path.join(exportDir, "done", "interview.mp4")));
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.readdirSync(outputDir).filter((n) => n.startsWith("."))).toEqual([]); // no partial files
    const done = await until("export item done", async () => (await itemsNamed(session.page, "interview.mp4")).find((i: any) => i.state === "done"));
    expect(done.outputPath).toBe(out);
    const task = await until("completed export task", () =>
      session.page.evaluate(() => (window as any).__openreelE2E.backgroundTasks.getSnapshot().find((t: any) => t.source === "watch-folders" && /interview/.test(t.title) && t.status === "completed") ?? null),
    );
    expect(task).toMatchObject({ kind: "export", status: "completed" });
  });

  it("does not render a duplicate drop twice, and moves a file ffmpeg cannot read to failed/ with the reason", async () => {
    fs.copyFileSync(CLIP, path.join(exportDir, "interview-again.mp4"));
    await until("duplicate noted", async () => (await itemsNamed(session.page, "interview-again.mp4")).find((i: any) => i.state === "duplicate"));
    expect(fs.readdirSync(outputDir)).toEqual(["interview.mp4"]);
    expect(fs.existsSync(path.join(exportDir, "done", "interview-again.mp4"))).toBe(true);

    fs.writeFileSync(path.join(exportDir, "broken.mov"), "this is not a video file at all");
    await until("failed item", async () => (await itemsNamed(session.page, "broken.mov")).find((i: any) => i.state === "failed"));
    expect(fs.existsSync(path.join(exportDir, "failed", "broken.mov"))).toBe(true);
    expect(fs.readFileSync(path.join(exportDir, "failed", "broken.mov.error.txt"), "utf8").length).toBeGreaterThan(5);
    expect(fs.readdirSync(outputDir)).toEqual(["interview.mp4"]);
  });

  it("lists the folders in Settings, pauses one, and a paused folder ignores a drop until resumed", async () => {
    const page = session.page;
    await page.evaluate(() => (window as any).__openreelE2E.ui?.getState?.().setSettingsOpen?.(true));
    // Open the dialog through the settings store the UI uses.
    await page.evaluate(() => (window as any).__openreelE2E.settings.getState().openSettings("watch-folders"));
    await page.getByTestId("watch-folders-panel").waitFor({ timeout: 15_000 });
    expect(await page.getByTestId("watch-folder").count()).toBe(2);
    await page.getByLabel(`Pause ${ingestDir}`).click();
    await until("paused state", async () => (await snapshot(page)).folders.find((f: any) => f.config.id === "ingest-1")?.status.state === "paused");
    await until("paused label", async () => (await page.getByTestId("watch-folder-state").first().textContent()) === "Paused");
    const before = (await library(page)).length;
    fs.copyFileSync(CLIP, path.join(ingestDir, "while-paused.mp4"));
    // Different content (so it is not a duplicate): append nothing, just rename trick is unnecessary: make a fresh clip.
    await sleep(2500);
    expect((await library(page)).length).toBe(before);
    expect(await itemsNamed(page, "while-paused.mp4")).toHaveLength(0);
    await page.getByLabel(`Resume ${ingestDir}`).click();
    await until("while-paused handled after resume", async () => (await itemsNamed(page, "while-paused.mp4")).length > 0);
  });

  it("survives a restart: imports a file dropped while the app was closed, and does not import old files again", async () => {
    const lib = (await library(session.page)).map((m) => m.name);
    expect(lib).toContain("card-001.mp4");
    await closeApp(session, true);
    const second = path.join(work, "second.mp4");
    makeClip(second, 3);
    fs.copyFileSync(second, path.join(ingestDir, "card-002.mp4"));
    session = await launch();
    // No project is open yet: the file waits (it is not failed) until one is.
    const early = await until("picked up at startup", async () => (await itemsNamed(session.page, "card-002.mp4")).find((i: any) => ["detecting", "queued", "running", "waiting"].includes(i.state)), 60_000);
    expect(early).toBeTruthy();
    expect((await itemsNamed(session.page, "card-002.mp4")).some((i: any) => i.state === "failed")).toBe(false);
    await openEditor(session.page);
    const imported = await until("imported after the project opened", async () => (await library(session.page)).find((m) => m.name === "card-002.mp4" && m.binName === "Dropped"), 60_000);
    expect(imported.binName).toBe("Dropped");
    await sleep(2500);
    // Earlier files were not imported again: the watcher did not touch card-001 this session, and no media is in the project twice
    // (the project itself came back from the autosave, which is why card-001 is in it at all).
    expect(await itemsNamed(session.page, "card-001.mp4")).toHaveLength(0);
    const names = (await library(session.page)).map((m) => m.name);
    expect(names.filter((n) => n === "card-001.mp4").length).toBeLessThanOrEqual(1);
    expect(names.filter((n) => n === "card-002.mp4")).toHaveLength(1);
    expect(launches).toBe(2);
  });
});
