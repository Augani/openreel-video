/**
 * Real-Electron end-to-end coverage of the desktop project features (Playwright _electron, the BUILT app):
 *
 *  1. Project file locking: a second app instance that opens a project already open elsewhere gets the
 *     read-only banner, its edits and its save are refused, and closing the first instance releases the lock.
 *  2. Native-decode persistence: a ProRes file imported natively, saved and reopened after a full quit and
 *     relaunch is decoded by the sidecar again (no re-import, no proxy) and its frames render.
 *  3. Moved files: the ProRes file moved on disk turns into an offline placeholder on reopen, and the
 *     "Search folder & relink" flow brings it (and its frames) back at the new path.
 *
 * Native file dialogs cannot be driven, so the main process `dialog` functions are stubbed with the paths
 * the test wants to choose; everything else (the shared Open flow, Cmd+S, IPC, lock files, ffmpeg) is real.
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * Opt in with OPENREEL_DESKTOP_E2E_PROJECT=1:  pnpm --filter @openreel/desktop test:desktop-e2e
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const root = path.resolve(__dirname, "../../..");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const enabled =
  process.env.OPENREEL_DESKTOP_E2E_PROJECT === "1" &&
  fs.existsSync(FFMPEG) &&
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
const E = (page: any, expression: string): Promise<any> => page.evaluate(`(async (h) => (${expression}))(window.__openreelE2E)`);
const SAVE_KEY = process.platform === "darwin" ? "Meta+s" : "Control+s";

interface Session {
  app: any;
  page: any;
  profile: string;
}
const sessions = new Set<Session>();
let work = "";

async function launch(profile: string): Promise<Session> {
  const { _electron } = loadPlaywright();
  const app = await _electron.launch({
    args: [path.join(root, "apps/desktop"), `--user-data-dir=${profile}`],
    env: { ...process.env, OPENREEL_FFMPEG_PATH: FFMPEG, OPENREEL_SKIP_ONBOARDING: "1" },
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
  const session = { app, page, profile };
  sessions.add(session);
  return session;
}

async function createProject(page: any): Promise<void> {
  // After a quit the previous auto-save is offered for recovery; the test wants a clean new project instead.
  const close = page.getByRole("button", { name: "Close dialog" });
  if (await close.waitFor({ timeout: 4_000 }).then(() => true, () => false)) {
    await close.click();
    await close.waitFor({ state: "detached", timeout: 10_000 });
  }
  await page.getByRole("button", { name: /Horizontal/ }).click({ timeout: 60_000 });
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.projectFile && (window as any).__openreelE2E?.proxy?.desktop), undefined, { timeout: 30_000 });
}

/** The next native Open / Save / pick-folder dialogs answer with these paths (the real dialogs cannot be clicked). */
async function stubDialogs(session: Session, answers: { open?: string; save?: string; folder?: string }): Promise<void> {
  await session.app.evaluate(({ dialog }: any, a: typeof answers) => {
    dialog.showOpenDialog = async (...args: any[]) => {
      const options = args.find((arg) => arg && typeof arg === "object" && Array.isArray(arg.properties));
      const wantsFolder = Boolean(options?.properties?.includes("openDirectory"));
      const chosen = wantsFolder ? a.folder : a.open;
      return chosen ? { canceled: false, filePaths: [chosen] } : { canceled: true, filePaths: [] };
    };
    dialog.showSaveDialog = async () => (a.save ? { canceled: false, filePath: a.save } : { canceled: true });
  }, answers);
}

/** Graceful quit (window close handlers, `will-quit`, lock release). Falls back to a kill only if it hangs. */
async function quit(session: Session): Promise<void> {
  const proc = session.app.process();
  const exited = new Promise<boolean>((resolve) => {
    if (proc.exitCode !== null) resolve(true);
    proc.once("exit", () => resolve(true));
  });
  // The unsaved-changes guard is a native message box nobody can click here: answer "Don't Save".
  await session.app.evaluate(({ dialog }: any) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => undefined);
  session.app.evaluate(({ app }: any) => app.quit()).catch(() => undefined);
  const ok = await Promise.race([exited, sleep(20_000).then(() => false)]);
  if (!ok) {
    proc.kill("SIGKILL");
    await exited;
  }
  sessions.delete(session);
}

async function saveWithShortcut(page: any): Promise<void> {
  await page.locator("body").click({ position: { x: 5, y: 5 }, force: true }).catch(() => undefined);
  await page.keyboard.press(SAVE_KEY);
}

const trackCount = (page: any): Promise<number> => E(page, "h.project.getState().project.timeline.tracks.length");

beforeAll(() => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "ordesktop-e2e-"));
});

/** A failed test must not leave an app running: the next launch on the same profile would hit the single-instance lock. */
function killOpenSessions(): void {
  for (const session of [...sessions]) {
    try {
      session.app.process().kill("SIGKILL");
    } catch {
      /* already closed */
    }
  }
  sessions.clear();
}
afterEach(killOpenSessions);

afterAll(() => {
  killOpenSessions();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

d("project file locking across app instances", () => {
  it("opens read-only while another instance holds the project, refuses edits and saves, and unlocks when it closes", async () => {
    const projectsDir = path.join(work, "projects");
    fs.mkdirSync(projectsDir);
    const file = path.join(projectsDir, "locked.oreel");
    const lockFile = path.join(projectsDir, ".locked.oreel.lock");

    // Instance A creates the project and saves it to disk: it now owns the lock.
    const a = await launch(path.join(work, "profile-a"));
    await createProject(a.page);
    await stubDialogs(a, { save: file });
    await saveWithShortcut(a.page);
    await a.page.waitForFunction(() => (window as any).__openreelE2E.projectFile.lock.getState().path !== null, undefined, { timeout: 20_000 });
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(lockFile)).toBe(true);
    expect(await E(a.page, "h.projectFile.lock.getState().readOnly")).toBe(false);
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    const pidA = a.app.process().pid;
    expect(lock.pid).toBe(pidA);
    const onDisk = fs.readFileSync(file, "utf8");

    // Instance B (its own profile, so a genuine second instance) opens the same file.
    const b = await launch(path.join(work, "profile-b"));
    await createProject(b.page);
    await stubDialogs(b, { open: file, save: file });
    expect(await E(b.page, "h.projectFile.openEditorProject()")).toBe(true);
    const banner = b.page.getByTestId("project-lock-banner");
    await banner.waitFor({ timeout: 20_000 });
    expect(await banner.innerText()).toMatch(/Read-only/);
    expect(await E(b.page, "h.projectFile.lock.getState().readOnly")).toBe(true);
    expect(await E(b.page, "h.projectFile.lock.getState().holder.pid")).toBe(pidA);
    // The holder's lock was not stolen.
    expect(JSON.parse(fs.readFileSync(lockFile, "utf8")).pid).toBe(pidA);

    // Edits are refused through the action system, and nothing changes.
    const before = await trackCount(b.page);
    await E(b.page, 'h.project.getState().addTrack("audio")');
    await sleep(500);
    expect(await trackCount(b.page)).toBe(before);

    // Saving over the file is refused too: the file keeps instance A's bytes.
    await saveWithShortcut(b.page);
    await sleep(1500);
    expect(fs.readFileSync(file, "utf8")).toBe(onDisk);

    // Retry while A still holds it: still read-only.
    expect(await E(b.page, "h.projectFile.retryProjectLock()")).toBe(false);
    expect(await banner.isVisible()).toBe(true);

    // Closing A releases the lock.
    await quit(a);
    await vi.waitFor(() => expect(fs.existsSync(lockFile)).toBe(false), { timeout: 15_000, interval: 200 });

    // B retries from the banner: it can edit, and its edit sticks.
    await b.page.getByRole("button", { name: "Retry" }).click();
    await banner.waitFor({ state: "detached", timeout: 15_000 });
    expect(await E(b.page, "h.projectFile.lock.getState().readOnly")).toBe(false);
    expect(fs.existsSync(lockFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(lockFile, "utf8")).pid).toBe(b.app.process().pid);
    const editable = await trackCount(b.page);
    await E(b.page, 'h.project.getState().addTrack("audio")');
    await vi.waitFor(async () => expect(await trackCount(b.page)).toBe(editable + 1), { timeout: 10_000, interval: 200 });
    // Its save now goes through (the file is B's), which also lets the window close without the unsaved-changes guard.
    await saveWithShortcut(b.page);
    await vi.waitFor(() => expect(JSON.parse(fs.readFileSync(file, "utf8")).timeline.tracks.length).toBe(editable + 1), { timeout: 15_000, interval: 200 });
    await quit(b);
    expect(fs.existsSync(lockFile)).toBe(false);
  }, 360_000);
});

// ---------------------------------------------------------------------------------------------------------------------

const W = 640;
const H = 360;
const FPS = 24;
const SECONDS = 3;
const TW = 128;
const TH = 72;
/** Mean abs diff (0-255) that counts as "the monitor shows this frame"; different testsrc2 frames differ by far more. */
const MATCH = 12;

function makeProres(out: string): void {
  execFileSync(FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${SECONDS}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${SECONDS}`,
    "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:a", "pcm_s16le", "-shortest", out,
  ]);
}

function referenceThumb(file: string, t: number): Buffer {
  const n = Math.floor(t * FPS + 1e-6);
  return execFileSync(FFMPEG, ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n}),scale=${TW}:${TH}:flags=area:in_color_matrix=bt709`, "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });
}

const meanAbsDiff = (a: Uint8Array, b: Uint8Array): number => {
  expect(a.length).toBe(b.length);
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return sum / (a.length / 4) / 3;
};

/** The monitor canvas as a thumbnail, or null while it is not on screen (offline media shows a placeholder instead). */
async function monitorThumb(page: any): Promise<Buffer | null> {
  const data: number[] | null = await page.evaluate(
    ([w, h]: number[]) => {
      const source = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement | null;
      if (!source) return null;
      const probe = document.createElement("canvas");
      probe.width = w;
      probe.height = h;
      const ctx = probe.getContext("2d")!;
      ctx.drawImage(source, 0, 0, w, h);
      return Array.from(ctx.getImageData(0, 0, w, h).data);
    },
    [TW, TH],
  );
  return data ? Buffer.from(data) : null;
}

/** Seek to `clipStart + t` and wait until the monitor shows the source frame for `t`. */
async function expectFrame(page: any, source: string, clipStart: number, t: number): Promise<void> {
  const reference = referenceThumb(source, t);
  await page.evaluate((s: number) => (window as any).__openreelE2E.timeline.getState().seekTo(s), clipStart + t);
  const started = Date.now();
  let diff = Infinity;
  while (Date.now() - started < 15_000) {
    const shown = await monitorThumb(page);
    diff = shown ? meanAbsDiff(shown, reference) : Infinity;
    if (shown && diff < MATCH) {
      // It is that frame and not a neighbouring second's.
      const other = referenceThumb(source, t < 1 ? t + 1.5 : t - 1);
      expect(meanAbsDiff((await monitorThumb(page))!, other), `monitor at ${t}s is not another frame`).toBeGreaterThan(diff * 2);
      return;
    }
    await sleep(50);
  }
  expect(diff, `monitor at ${t}s shows the source frame`).toBeLessThan(MATCH);
}

/** Distinct frames (testsrc2 has a frame counter), so a frozen or black monitor cannot pass them all. */
// On both the 24 fps source grid and the 30 fps project grid: the monitor now shows the frame the export renders for the playhead
// (the project frame's start instant), so a time inside a project frame (0.25 s = frame 7.5 at 30 fps) would show the source frame before it.
const PROBE_TIMES = [0.2, 1.5, 2.5];

d("native-decode path persistence and moved-file relink", () => {
  let profile = "";
  let projectsDir = "";
  let movedDir = "";
  let projectFile = "";
  let prores = "";
  let clipStart = 0;
  let mediaId = "";

  beforeAll(() => {
    profile = path.join(work, "profile-prores");
    projectsDir = path.join(work, "prores-project");
    movedDir = path.join(work, "moved-media");
    fs.mkdirSync(projectsDir);
    fs.mkdirSync(path.join(work, "media"));
    fs.mkdirSync(movedDir);
    prores = path.join(work, "media", "persist-prores.mov");
    projectFile = path.join(projectsDir, "native.oreel");
    makeProres(prores);
  });

  async function openSaved(session: Session): Promise<void> {
    await stubDialogs(session, { open: projectFile, save: projectFile });
    expect(await E(session.page, "h.projectFile.openEditorProject()")).toBe(true);
  }

  it("imports ProRes natively, saves the project and quits", async () => {
    const s = await launch(profile);
    await createProject(s.page);
    await stubDialogs(s, { save: projectFile });
    await s.page.locator('[data-tour="assets"] input[type="file"]').setInputFiles(prores);
    await s.page.getByLabel("Select media persist-prores.mov").waitFor({ timeout: 60_000 });
    const item = await E(s.page, `h.project.getState().project.mediaLibrary.items.find((m) => m.name === "persist-prores.mov")`);
    mediaId = item.id;
    expect(item.nativeSource?.path).toBe(prores);
    expect(item.proxy ?? null).toBeNull();

    await s.page.getByRole("button", { name: "Media actions for persist-prores.mov" }).click();
    await s.page.getByRole("menuitem", { name: "Add to timeline" }).click();
    await s.page.getByRole("button", { name: "Match Video" }).click({ timeout: 8_000 }).catch(() => undefined);
    await s.page.waitForFunction(() => (window as any).__openreelE2E.project.getState().project.timeline.tracks.some((t: any) => t.clips.length > 0), undefined, { timeout: 30_000 });
    clipStart = await E(s.page, "h.project.getState().project.timeline.tracks.flatMap((t) => t.clips)[0].startTime");
    await expectFrame(s.page, prores, clipStart, 1.5);

    await saveWithShortcut(s.page);
    await vi.waitFor(() => expect(fs.existsSync(projectFile)).toBe(true), { timeout: 20_000, interval: 200 });
    // The saved project file itself carries the native path (that is what survives the quit).
    const saved = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    const savedItem = saved.mediaLibrary.items.find((m: any) => m.id === mediaId);
    expect(savedItem.nativeSource.path).toBe(prores);
    await quit(s);
  }, 240_000);

  it("after a relaunch, reopening the project decodes the ProRes natively again and the frames render", async () => {
    const s = await launch(profile);
    await createProject(s.page);
    await openSaved(s);
    // The project file holds no media bytes: the item comes back offline and reconnects from its saved path.
    await s.page.waitForFunction((id: string) => { const m = (window as any).__openreelE2E.project.getState().project.mediaLibrary.items.find((x: any) => x.id === id); return Boolean(m) && !m.isPlaceholder; }, mediaId, { timeout: 60_000 });
    const item = await E(s.page, `h.project.getState().project.mediaLibrary.items.find((m) => m.id === "${mediaId}")`);
    expect(item.isPlaceholder ?? false).toBe(false);
    expect(item.nativeSource.path).toBe(prores);
    for (const t of PROBE_TIMES) await expectFrame(s.page, prores, clipStart, t);
    const stats = await s.page.evaluate(() => (window as any).openreel.media.nativeStats());
    expect(stats.framesDecoded, "frames came from the sidecar decoder").toBeGreaterThan(0);
    expect(await E(s.page, `h.proxy.cache.store.getState().entries["${mediaId}"] ?? null`)).toBeNull();
    expect(await E(s.page, "Object.keys(h.proxy.desktop.store.getState().jobs).length")).toBe(0);
    await quit(s);
  }, 240_000);

  it("a moved file reopens as an offline placeholder, and Search folder & relink brings the frames back", async () => {
    const moved = path.join(movedDir, "persist-prores.mov");
    fs.renameSync(prores, moved);

    const s = await launch(profile);
    await createProject(s.page);
    await openSaved(s);
    await s.page.waitForFunction((id: string) => (window as any).__openreelE2E.project.getState().project.mediaLibrary.items.find((m: any) => m.id === id)?.isPlaceholder === true, mediaId, { timeout: 30_000 });
    // The saved project keeps the old path; only the runtime item is offline.
    expect(JSON.parse(fs.readFileSync(projectFile, "utf8")).mediaLibrary.items.find((m: any) => m.id === mediaId).nativeSource.path).toBe(prores);

    // The UI flow: Media panel -> "Search folder & relink…" -> pick the folder the file moved to.
    await stubDialogs(s, { open: projectFile, save: projectFile, folder: movedDir });
    await s.page.getByRole("button", { name: "Relink from Folder" }).click({ timeout: 15_000 });
    await s.page.waitForFunction((id: string) => {
      const item = (window as any).__openreelE2E.project.getState().project.mediaLibrary.items.find((m: any) => m.id === id);
      return item && !item.isPlaceholder;
    }, mediaId, { timeout: 60_000 });
    const relinked = await E(s.page, `h.project.getState().project.mediaLibrary.items.find((m) => m.id === "${mediaId}")`);
    expect(relinked.nativeSource.path).toBe(moved);

    for (const t of PROBE_TIMES) await expectFrame(s.page, moved, clipStart, t);
    const stats = await s.page.evaluate(() => (window as any).openreel.media.nativeStats());
    expect(stats.framesDecoded).toBeGreaterThan(0);

    // The relink is persisted: save, relaunch, reopen with the file at its new place.
    await saveWithShortcut(s.page);
    await vi.waitFor(() => expect(JSON.parse(fs.readFileSync(projectFile, "utf8")).mediaLibrary.items.find((m: any) => m.id === mediaId).nativeSource.path).toBe(moved), { timeout: 20_000, interval: 200 });
    await quit(s);

    const again = await launch(profile);
    await createProject(again.page);
    await openSaved(again);
    await again.page.waitForFunction((id: string) => { const m = (window as any).__openreelE2E.project.getState().project.mediaLibrary.items.find((x: any) => x.id === id); return Boolean(m) && !m.isPlaceholder; }, mediaId, { timeout: 60_000 });
    await expectFrame(again.page, moved, clipStart, 1.5);
    await quit(again);
  }, 360_000);
});
