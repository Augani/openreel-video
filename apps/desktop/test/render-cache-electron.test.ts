/**
 * Real-Electron end-to-end coverage of the persistent render cache (Playwright _electron, the BUILT app):
 *
 *  1. A heavy effects stack on two clips drops frames when composited live. Render In to Out writes the frames to
 *     the scratch-disk folder (files appear under <userData>/render-cache/OpenReel Render Cache/<project>/), the
 *     render bar turns green, and playback of the rendered range is served from the cache (cache frames, no live
 *     compositing).
 *  2. The project is saved and the app quits and relaunches. After the project is reopened the range is still
 *     green (restored from the persisted index and checked against the content hash of each segment) and plays
 *     from the cache with fewer dropped frames than live compositing did.
 *  3. Editing one clip after the restart invalidates exactly that clip's range; the other clip stays rendered.
 *  4. Delete Render Files empties the scratch folder.
 *
 * The scratch folder lives under a throw-away --user-data-dir in os.tmpdir(); nothing is written elsewhere.
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * Opt in with OPENREEL_DESKTOP_RENDER_CACHE_E2E=1:  pnpm --filter @openreel/desktop test:render-cache-e2e
 * Set OPENREEL_RENDER_CACHE_E2E_OUT=<file.json> to also write the measured numbers.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = path.resolve(__dirname, "../../..");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const enabled =
  process.env.OPENREEL_DESKTOP_RENDER_CACHE_E2E === "1" &&
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

const W = 1280;
const H = 720;
const FPS = 30;
const CLIP_SECONDS = 2;
const MEDIA_SECONDS = 4;
const PLAY_SECONDS = 3;

interface Session {
  app: any;
  page: any;
}
let work = "";
let profile = "";
let media = "";
let projectFile = "";
let session: Session | null = null;
const numbers: Record<string, unknown> = {};

function makeProres(out: string): void {
  execFileSync(FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${MEDIA_SECONDS}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${MEDIA_SECONDS}`,
    "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:a", "pcm_s16le", "-shortest", out,
  ]);
}

async function launch(): Promise<Session> {
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
  session = { app, page };
  return session;
}

async function createProject(page: any): Promise<void> {
  const close = page.getByRole("button", { name: "Close dialog" });
  if (await close.waitFor({ timeout: 4_000 }).then(() => true, () => false)) {
    await close.click();
    await close.waitFor({ state: "detached", timeout: 10_000 });
  }
  await page.getByRole("button", { name: /Horizontal/ }).click({ timeout: 60_000 });
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.projectFile && (window as any).__openreelE2E?.renderCache), undefined, { timeout: 30_000 });
}

async function stubDialogs(s: Session, answers: { open?: string; save?: string }): Promise<void> {
  await s.app.evaluate(({ dialog }: any, a: typeof answers) => {
    dialog.showOpenDialog = async () => (a.open ? { canceled: false, filePaths: [a.open] } : { canceled: true, filePaths: [] });
    dialog.showSaveDialog = async () => (a.save ? { canceled: false, filePath: a.save } : { canceled: true });
  }, answers);
}

async function quit(s: Session): Promise<void> {
  const proc = s.app.process();
  const exited = new Promise<boolean>((resolve) => {
    if (proc.exitCode !== null) resolve(true);
    proc.once("exit", () => resolve(true));
  });
  await s.app.evaluate(({ dialog }: any) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => undefined);
  s.app.evaluate(({ app }: any) => app.quit()).catch(() => undefined);
  const ok = await Promise.race([exited, sleep(20_000).then(() => false)]);
  if (!ok) {
    proc.kill("SIGKILL");
    await exited;
  }
  session = null;
}

/** Frames painted while playing `seconds` from `from`: distinct frame indexes, sources, and dropped frames against the 30 fps ideal. */
async function playAndMeasure(page: any, from: number, seconds: number): Promise<{ expected: number; presented: number; dropped: number; cache: number; live: number; loadAvg: number }> {
  await page.evaluate((t: number) => {
    const h = (window as any).__openreelE2E;
    h.timeline.getState().seekTo(t);
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, from);
  await sleep(800);
  await page.evaluate(() => (window as any).__openreelE2E.renderCache.resetTelemetry());
  const startedAt: number = await page.evaluate(() => performance.now());
  await page.keyboard.press("Space");
  await sleep(seconds * 1000);
  const endedAt: number = await page.evaluate(() => performance.now());
  await page.keyboard.press("Space");
  await sleep(300);
  const telemetry = await page.evaluate(() => (window as any).__openreelE2E.renderCache.getTelemetry());
  const inWindow = telemetry.entries.filter((e: any) => e.at >= startedAt && e.at <= endedAt);
  const distinct = new Set(inWindow.map((e: any) => Math.round(e.time * FPS)));
  const windowSeconds = (endedAt - startedAt) / 1000;
  const expected = Math.round(windowSeconds * FPS);
  return {
    expected,
    presented: distinct.size,
    dropped: Math.max(0, expected - distinct.size),
    cache: inWindow.filter((e: any) => e.source === "cache").length,
    live: inWindow.filter((e: any) => e.source === "live").length,
    loadAvg: os.loadavg()[0],
  };
}

const snapshot = (page: any) => page.evaluate(() => {
  const c = (window as any).__openreelE2E.renderCache;
  const s = c.instance.getSnapshot();
  return { frameCount: s.frameCount, runs: s.cachedRuns, restored: s.restored, codec: s.codec, bytes: s.bytes, rendering: s.phase === "rendering", status: c.getStatus() };
});

beforeAll(() => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "orrc-e2e-"));
  profile = path.join(work, "profile");
  media = path.join(work, "heavy-source.mov");
  projectFile = path.join(work, "render-cache.oreel");
  makeProres(media);
});

afterAll(async () => {
  try {
    session?.app.process().kill("SIGKILL");
  } catch {
    /* already closed */
  }
  if (process.env.OPENREEL_RENDER_CACHE_E2E_OUT) fs.writeFileSync(process.env.OPENREEL_RENDER_CACHE_E2E_OUT, JSON.stringify(numbers, null, 2));
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

const scratchProjectDirs = () => {
  const base = path.join(profile, "render-cache", "OpenReel Render Cache");
  return fs.existsSync(base) ? fs.readdirSync(base).map((name) => path.join(base, name)) : [];
};
const frameFiles = (dir: string) => fs.readdirSync(dir).filter((n) => /^f\d+\.frm$/.test(n));

d("persistent render cache on the desktop", () => {
  let clipIds: string[] = [];
  let timelineEnd = 0;

  it("a heavy stack drops frames live; Render In to Out writes scratch-disk files and playback comes from the cache", async () => {
    const s = await launch();
    await createProject(s.page);
    await stubDialogs(s, { save: projectFile });
    await s.page.locator('[data-tour="assets"] input[type="file"]').setInputFiles(media);
    await s.page.getByLabel("Select media heavy-source.mov").waitFor({ timeout: 60_000 });
    await s.page.getByRole("button", { name: "Media actions for heavy-source.mov" }).click();
    await s.page.getByRole("menuitem", { name: "Add to timeline" }).click();
    await s.page.getByRole("button", { name: "Match Video" }).click({ timeout: 5_000 }).catch(() => undefined);
    await s.page.waitForFunction(() => (window as any).__openreelE2E.project.getState().project.timeline.tracks.some((t: any) => t.clips.length > 0), undefined, { timeout: 30_000 });
    // One 4 s clip split in two: two adjacent 2 s clips on the same track.
    const firstClip = await E(s.page, "h.project.getState().project.timeline.tracks.flatMap((t) => t.clips)[0]");
    await s.page.evaluate(([id, at]: [string, number]) => (window as any).__openreelE2E.project.getState().splitClip(id, at), [firstClip.id, firstClip.startTime + CLIP_SECONDS] as [string, number]);
    await s.page.waitForFunction(() => (window as any).__openreelE2E.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).length === 2, undefined, { timeout: 15_000 });
    const clips = await E(s.page, "h.project.getState().project.timeline.tracks.flatMap((t) => t.clips).map((c) => ({ id: c.id, start: c.startTime, duration: c.duration, trackId: c.trackId }))");
    clips.sort((a: any, b: any) => a.start - b.start);
    clipIds = clips.map((c: any) => c.id);
    expect(clips.length).toBe(2);
    // Back to back on one track: the second clip starts where the first ends, so the two ranges are exactly adjacent.
    expect(clips[1].start).toBeCloseTo(clips[0].start + clips[0].duration, 2);
    timelineEnd = clips[1].start + clips[1].duration;

    await s.page.evaluate(async (ids: string[]) => {
      const store = (window as any).__openreelE2E.project.getState();
      for (const id of ids) {
        await store.addVideoEffect(id, "glow", { radius: 28, intensity: 1.6, color: "#ffffff" });
        await store.addVideoEffect(id, "gaussian-blur", { radius: 4 });
        const size = 17;
        const data: number[] = [];
        for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) data.push(Math.min(1, (r / (size - 1)) * 1.04), (g / (size - 1)) * 0.96, Math.min(1, (b / (size - 1)) * 1.1));
        await store.updateColorGrading(id, { temperature: 14, lut: { data, size, intensity: 0.8 } });
      }
    }, clipIds);
    await sleep(600);

    // The bar starts red/yellow everywhere there are effects.
    const before = await snapshot(s.page);
    expect(before.frameCount).toBe(0);
    expect(before.status.segments.some((x: any) => x.level === "heavy" || x.level === "light")).toBe(true);
    expect(before.status.segments.every((x: any) => x.level !== "cached")).toBe(true);

    numbers.live = await playAndMeasure(s.page, 0.3, PLAY_SECONDS);

    const rendered = await s.page.evaluate((end: number) => (window as any).__openreelE2E.renderCache.renderInToOut({ start: 0, end }), timelineEnd);
    expect(rendered).toMatchObject({ status: "completed" });
    const after = await snapshot(s.page);
    expect(after.frameCount).toBe(Math.round(timelineEnd * FPS));
    expect(after.status.segments.every((x: any) => x.level === "cached")).toBe(true);
    numbers.render = { frames: rendered.framesRendered, elapsedMs: rendered.elapsedMs, codec: rendered.codec, bytes: after.bytes };

    // Files are on the scratch disk, in the folder the main process manages.
    const dirs = scratchProjectDirs();
    expect(dirs.length).toBe(1);
    expect(frameFiles(dirs[0]).length).toBe(after.frameCount);
    expect(fs.existsSync(path.join(dirs[0], "index.json"))).toBe(true);

    numbers.fromCacheSameSession = await playAndMeasure(s.page, 0.3, PLAY_SECONDS);
    expect((numbers.fromCacheSameSession as any).live).toBe(0);
    expect((numbers.fromCacheSameSession as any).cache).toBeGreaterThan(0);

    if (process.env.OPENREEL_RC_DEBUG_DIR) fs.writeFileSync(path.join(process.env.OPENREEL_RC_DEBUG_DIR, "p1.json"), await s.page.evaluate(() => JSON.stringify((window as any).__openreelE2E.project.getState().getFullProject())));
    await saveProject(s);
    await quit(s);
  }, 600_000);

  async function saveProject(s: Session): Promise<void> {
    await s.page.locator("body").click({ position: { x: 5, y: 5 }, force: true }).catch(() => undefined);
    await s.page.keyboard.press(SAVE_KEY);
    await vi.waitFor(() => expect(fs.existsSync(projectFile)).toBe(true), { timeout: 20_000, interval: 200 });
  }

  it("after quitting and relaunching, reopening the project finds the range still rendered and plays from the cache", async () => {
    const dirsBefore = scratchProjectDirs();
    expect(dirsBefore.length).toBe(1);
    const filesBefore = frameFiles(dirsBefore[0]).length;
    expect(filesBefore).toBe(Math.round(timelineEnd * FPS));

    const s = await launch();
    await createProject(s.page);
    await stubDialogs(s, { open: projectFile, save: projectFile });
    expect(await E(s.page, "h.projectFile.openEditorProject()")).toBe(true);
    await s.page.waitForFunction(() => {
      const items = (window as any).__openreelE2E.project.getState().project.mediaLibrary.items;
      return items.length > 0 && items.every((m: any) => !m.isPlaceholder);
    }, undefined, { timeout: 60_000 });
    await s.page.evaluate(() => (window as any).__openreelE2E.renderCache.whenReady());

    if (process.env.OPENREEL_RC_DEBUG_DIR) fs.writeFileSync(path.join(process.env.OPENREEL_RC_DEBUG_DIR, "p2.json"), await s.page.evaluate(() => JSON.stringify((window as any).__openreelE2E.project.getState().getFullProject())));
    const restored = await snapshot(s.page);
    expect(restored.restored).toMatchObject({ droppedStale: 0, droppedMissing: 0 });
    expect(restored.restored.restored).toBe(filesBefore);
    expect(restored.frameCount).toBe(filesBefore);
    expect(restored.runs).toEqual([{ start: 0, end: filesBefore - 1 }]);
    // Green: every effects segment is "cached", and nothing has been re-rendered.
    expect(restored.status.segments.every((x: any) => x.level === "cached")).toBe(true);
    expect(frameFiles(scratchProjectDirs()[0]).length).toBe(filesBefore);

    numbers.fromCacheAfterRestart = await playAndMeasure(s.page, 0.3, PLAY_SECONDS);
    const post = numbers.fromCacheAfterRestart as any;
    expect(post.live, "no frame was composited live after the restart").toBe(0);
    expect(post.cache).toBeGreaterThan(0);
    // The point of the feature: the cached range drops fewer frames than the same range composited live.
    expect(post.dropped).toBeLessThan((numbers.live as any).dropped);

    // 3. Editing the second clip afterwards invalidates exactly its range.
    await s.page.evaluate(async (id: string) => {
      await (window as any).__openreelE2E.project.getState().addVideoEffect(id, "vignette", { amount: 0.4 });
    }, clipIds[1]);
    await sleep(500);
    const edited = await snapshot(s.page);
    const firstEnd = Math.round(CLIP_SECONDS * FPS);
    expect(edited.runs).toEqual([{ start: 0, end: firstEnd - 1 }]);
    const levels = edited.status.segments.map((x: any) => ({ s: x.start, e: x.end, level: x.level }));
    expect(levels.some((x: any) => x.level === "cached" && x.e <= CLIP_SECONDS + 0.05)).toBe(true);
    expect(levels.some((x: any) => x.level !== "cached" && x.s >= CLIP_SECONDS - 0.05)).toBe(true);
    await sleep(900);
    expect(frameFiles(scratchProjectDirs()[0]).length).toBe(firstEnd);

    // 4. Delete Render Files empties the scratch folder and the bar goes back to red/yellow.
    await s.page.evaluate(() => (window as any).__openreelE2E.renderCache.deleteRenderFiles({ silent: true }));
    expect(frameFiles(scratchProjectDirs()[0] ?? work).length).toBe(0);
    expect((await snapshot(s.page)).frameCount).toBe(0);
    await quit(s);
  }, 600_000);
});
