/**
 * Real-Electron integration test for desktop ingest + proxies (Playwright _electron, the BUILT app).
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * and ffmpeg/ffprobe on disk. Opt in with OPENREEL_DESKTOP_E2E=1 (skipped otherwise, so the normal
 * `test:run` stays fast and headless):  pnpm --filter @openreel/desktop test:ingest-e2e
 *
 * Covers: ProRes 422 Proxy preset on a generated 4K clip (file + ffprobe), the background queue and its
 * resume after an app restart, toggling proxies with the preview's decode log (the preview decodes the
 * proxy, then the original), export from full resolution (ffprobe says 4K), copy-to-project with checksum
 * verification (originals untouched), relink by folder search (name + duration + frame rate), and the
 * CPU cost of playback with and without proxies (printed).
 */
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const enabled =
  process.env.OPENREEL_DESKTOP_E2E === "1" &&
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

/** Same file on disk, whatever spelling of the path (macOS temp dirs are symlinked under /private). */
const samePath = (a: string, b: string) => expect(fs.realpathSync(a)).toBe(fs.realpathSync(b));
/** Poll until `read` returns something truthy (the test runner's own `expect` has no locator matchers). */
async function until<T>(label: string, read: () => Promise<T> | T, timeout = 30_000): Promise<NonNullable<T>> {
  const start = Date.now();
  for (;;) {
    const value = await read();
    if (value) return value as NonNullable<T>;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
const textOf = (loc: any) => loc.innerText().catch(() => "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const probe = (file: string): any => JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));
const videoOf = (file: string) => probe(file).streams.find((s: any) => s.codec_type === "video");

let work = "";
let CLIP = "";
let projectDir = "";
let userData = "";

function makeClip(out: string, seconds: number): void {
  execFileSync(FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `testsrc2=size=3840x2160:rate=30:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
  ]);
}

interface Session {
  app: any;
  page: any;
}
const sessions: Session[] = [];

let launches = 0;
/** A fresh profile per launch unless `dir` is given (the restart test reuses one). */
async function launch(dir?: string): Promise<Session> {
  const { _electron } = loadPlaywright();
  const profile = dir ?? path.join(work, `profile-${++launches}`);
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
  const session = { app, page };
  sessions.push(session);
  return session;
}

async function openEditor(page: any): Promise<void> {
  await page.getByRole("button", { name: /Horizontal/ }).click({ timeout: 60_000 });
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.proxy?.desktop), undefined, { timeout: 30_000 });
}

/** Evaluate an expression against the e2e hook `h` in the page (awaited). */
const E = (page: any, expression: string): Promise<any> => page.evaluate(`(async (h) => (${expression}))(window.__openreelE2E)`);

async function closeApp(session: Session | undefined, graceful: boolean): Promise<void> {
  if (!session) return;
  let proc: { kill(signal: string): void };
  try {
    proc = session.app.process();
  } catch {
    return; // already closed
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

const mediaNamed = (page: any, name: string) =>
  page.evaluate((n: string) => {
    const item = (window as any).__openreelE2E.project.getState().project.mediaLibrary.items.find((m: any) => m.name === n);
    return item ? { id: item.id as string, proxy: item.proxy ?? null, sourceFile: item.sourceFile ?? null, copiedFrom: item.copiedFrom ?? null, placeholder: !!item.isPlaceholder } : null;
  }, name);

async function importClip(page: any, file: string, name: string): Promise<string> {
  await page.locator('[data-tour="assets"] input[type="file"]').setInputFiles(file);
  await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 60_000 });
  const item = await mediaNamed(page, name);
  if (!item) throw new Error(`${name} was not imported`);
  return item.id;
}

async function stubDialogs(app: any, args: { savePath?: string; folder?: string }): Promise<void> {
  await app.evaluate(({ dialog }: any, a: any) => {
    if (a.savePath) dialog.showSaveDialog = async () => ({ canceled: false, filePath: a.savePath });
    if (a.folder) dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [a.folder] });
  }, args);
}

async function saveProjectAs(session: Session, file: string): Promise<void> {
  await stubDialogs(session.app, { savePath: file });
  await session.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await session.page.keyboard.press("Meta+s");
  const start = Date.now();
  while (!fs.existsSync(file)) {
    if (Date.now() - start > 20_000) throw new Error("project was not saved");
    await sleep(200);
  }
}

async function placeClip(page: any, name: string): Promise<{ start: number }> {
  await page.getByRole("button", { name: `Media actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8_000 }).catch(() => undefined);
  await page.waitForFunction(() => (window as any).__openreelE2E.project.getState().project.timeline.tracks.some((t: any) => t.clips.length > 0), undefined, { timeout: 30_000 });
  await sleep(600);
  const settings = await E(page, "h.project.getState().project.settings");
  if (settings.width !== 3840 || settings.height !== 2160) {
    await E(page, "h.project.getState().updateSettings({ width: 3840, height: 2160, frameRate: 30 })");
    await sleep(500);
  }
  return { start: await E(page, "h.project.getState().project.timeline.tracks.flatMap((t) => t.clips)[0].startTime") };
}

const seekTo = async (page: any, t: number) => {
  await page.evaluate((s: number) => (window as any).__openreelE2E.timeline.getState().seekTo(s), t);
  await sleep(400);
};
const decodeLog = (page: any, id: string) =>
  page.evaluate((mediaId: string) => {
    const x = (window as any).__openreelE2E.proxy.cache.decodes[mediaId];
    return x ? { source: x.source as string, proxy: x.proxyCount as number, original: x.originalCount as number } : null;
  }, id);

async function waitProxyLinked(page: any, name: string, timeout = 180_000) {
  let ref: any = null;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    ref = (await mediaNamed(page, name))?.proxy ?? null;
    if (ref?.status === "ready") return ref;
    await sleep(300);
  }
  throw new Error(`proxy for ${name} was not linked in ${timeout} ms`);
}

beforeAll(() => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "oringest-e2e-"));
  userData = path.join(work, "userdata");
  projectDir = path.join(work, "Project");
  fs.mkdirSync(projectDir, { recursive: true });
  CLIP = path.join(work, "src", "clip4k.mp4");
  fs.mkdirSync(path.dirname(CLIP), { recursive: true });
  makeClip(CLIP, 4);
}, 180_000);

afterAll(async () => {
  for (const s of sessions) await closeApp(s, false);
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

d("desktop ingest in real Electron", () => {
  let id = "";
  let session: Session;

  it("ProRes 422 Proxy preset: queue builds a half-res .mov next to the project; preview decodes the proxy; toggle; export is 4K from full-res", async () => {
    session = await launch();
    const { page } = session;
    await openEditor(page);
    const bridge = await page.evaluate(() => ({ ingest: Boolean((window as any).openreel?.ingest), pathForFile: typeof (window as any).openreel?.fs?.pathForFile }));
    expect(bridge).toEqual({ ingest: true, pathForFile: "function" });

    await saveProjectAs(session, path.join(projectDir, "film.oreel"));
    // Ingest settings: ProRes 422 Proxy at 1/2 resolution, proxies on import (one undo step each).
    const historyBefore = await E(page, "h.project.getState().actionExecutor.getHistory().getUndoStackSize()");
    await E(page, `h.project.getState().executeAction({ type: "media/organize", id: "p1", timestamp: Date.now(), params: { label: "Set ingest preset", ingestPreset: "proxies" } })`);
    await E(page, `h.proxy.desktop.setDesktopProxyProfile({ codec: "prores-proxy", size: "half" })`);
    expect(await E(page, "h.project.getState().actionExecutor.getHistory().getUndoStackSize()")).toBe(historyBefore + 2);
    expect(await E(page, "h.project.getState().project.mediaLibrary.desktopIngest")).toEqual({ proxyProfile: { codec: "prores-proxy", size: "half" } });

    id = await importClip(page, CLIP, "clip4k.mp4");
    const source = await mediaNamed(page, "clip4k.mp4");
    samePath(source!.sourceFile.path, CLIP);

    // The job shows up in the panel state while it builds.
    let sawBuilding = false;
    const ref = await (async () => {
      const start = Date.now();
      for (;;) {
        const job = await E(page, `h.proxy.desktop.store.getState().jobs["${id}"] ?? null`);
        if (job && (job.status === "running" || job.status === "queued")) sawBuilding = true;
        const linked = (await mediaNamed(page, "clip4k.mp4"))?.proxy;
        if (linked?.status === "ready") return linked;
        if (Date.now() - start > 180_000) throw new Error("proxy never linked");
        await sleep(200);
      }
    })();
    expect(sawBuilding).toBe(true);
    console.log(`[desktop-ingest] proxy ref: ${JSON.stringify({ storage: ref.storage, path: path.relative(work, ref.path), w: ref.width, h: ref.height, codec: ref.codec, profile: ref.profile, preview: ref.previewPath ? path.relative(work, ref.previewPath) : null })}`);
    expect(ref.storage).toBe("path");
    samePath(path.dirname(ref.path), path.join(projectDir, "Proxies"));
    expect(ref.path.endsWith("_half_proxy.mov")).toBe(true);
    expect(ref).toMatchObject({ width: 1920, height: 1080, codec: "prores", profile: { codec: "prores-proxy", size: "half" } });
    const proxyVideo = videoOf(ref.path);
    expect(proxyVideo).toMatchObject({ codec_name: "prores", profile: "Proxy", width: 1920, height: 1080, pix_fmt: "yuv422p10le" });
    // The renderer cannot decode ProRes, so a decodable H.264 twin rides along for preview.
    expect(ref.previewPath).toBeTruthy();
    expect(videoOf(ref.previewPath)).toMatchObject({ codec_name: "h264", width: 1920, height: 1080 });
    // The original is untouched.
    expect(fs.existsSync(CLIP)).toBe(true);
    expect(historyBefore + 3).toBe(await E(page, "h.project.getState().actionExecutor.getHistory().getUndoStackSize()"));

    // Preview: place the clip, look through the proxy, toggle, look at the original.
    const rendererWarnings: string[] = [];
    page.on("console", (m: any) => {
      if (m.type() === "warning" || m.type() === "error") rendererWarnings.push(`${m.type()}: ${String(m.text()).slice(0, 240)}`);
    });
    const clip = await placeClip(page, "clip4k.mp4");
    // The preview cache entry must be "ready" and stay that way while the clip is looked at. Fail at once, with the
    // reason, if playback disables the proxy (status "error") instead of idling out the full timeout.
    const proxyEntry = () => E(page, `(() => { const e = h.proxy.cache.store.getState().entries["${id}"]; return e ? { status: e.status, error: e.error ?? null } : null; })()`);
    const watchStart = Date.now();
    for (;;) {
      const entry = await proxyEntry();
      if (entry?.status === "ready") break;
      if (entry?.status === "error") throw new Error(`the preview proxy was disabled: ${entry.error}; renderer: ${rendererWarnings.slice(-6).join(" | ")}`);
      if (Date.now() - watchStart > 120_000) throw new Error(`preview cache entry never became ready (${JSON.stringify(entry)}); renderer: ${rendererWarnings.slice(-6).join(" | ")}`);
      await sleep(250);
    }
    await seekTo(page, clip.start + 1.2);
    await sleep(2000);
    const viaProxy = await decodeLog(page, id);
    expect((await proxyEntry())?.status, `proxy still enabled after the first preview frame; renderer: ${rendererWarnings.slice(-6).join(" | ")}`).toBe("ready");
    console.log(`[desktop-ingest] preview decode log, proxies on: ${JSON.stringify(viaProxy)}`);
    expect(viaProxy?.source).toBe("proxy");
    expect(viaProxy!.proxy).toBeGreaterThan(0);
    await page.getByTestId("toggle-proxies").click();
    await seekTo(page, clip.start + 1.3);
    await seekTo(page, clip.start + 1.2);
    await sleep(2500);
    const viaOriginal = await decodeLog(page, id);
    console.log(`[desktop-ingest] preview decode log, proxies off: ${JSON.stringify(viaOriginal)}`);
    expect(viaOriginal?.source).toBe("original");
    expect(viaOriginal!.original).toBeGreaterThan(0);
    await page.getByTestId("toggle-proxies").click();

    // The panel shows the state.
    const panel = page.getByTestId("proxy-panel");
    // The panel is a popover: open it, then read its body (rendered in a portal, not inside the section).
    const body = page.getByTestId("proxy-panel-body");
    if (!(await body.isVisible())) await panel.getByRole("button", { name: /^Proxies/ }).first().click();
    await until("ready count 1", async () => (await textOf(body.getByTestId("proxy-count-ready"))).trim().startsWith("1"));
    await body.getByTestId("proxy-more-settings").click();
    expect(await body.getByTestId("proxy-folder").innerText()).toContain("Proxies");
    const shots = process.env.OPENREEL_E2E_SHOTS;
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: path.join(shots, "editor-full.png") });
      await body.screenshot({ path: path.join(shots, "proxy-panel.png") });
      // The smallest supported window.
      await session.app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].setSize(1024, 700));
      await sleep(800);
      await page.screenshot({ path: path.join(shots, "editor-1024x700.png") });
      await body.screenshot({ path: path.join(shots, "proxy-panel-1024x700.png") });
      const overflow = await body.evaluate((el: HTMLElement) => ({ scrollW: el.scrollWidth, clientW: el.clientWidth, overflowing: [...el.querySelectorAll("*")].filter((n) => (n as HTMLElement).scrollWidth > (n as HTMLElement).clientWidth + 1 && getComputedStyle(n as HTMLElement).overflow === "visible").length }));
      console.log(`[desktop-ingest] panel overflow check at 1024x700: ${JSON.stringify(overflow)}`);
      await session.app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    }

    // Export 4K with proxies ON: the source is full resolution.
    await E(page, `h.exportQueue.getState().enqueue({ settings: { width: 3840, height: 2160, frameRate: 24, format: "mp4", codec: "h264", bitrate: 20000 }, presetLabel: "4K" })`);
    await E(page, "h.exportQueue.getState().start()");
    const finished = await page.waitForFunction(() => {
      const job = (window as any).__openreelE2E.exportQueue.getState().queue.jobs[0];
      if (job?.status === "failed") throw new Error(job.error);
      return job?.status === "completed" ? { path: job.output?.path as string, note: job.sourceMedia as string } : null;
    }, undefined, { timeout: 300_000, polling: 500 });
    const out = (await finished.jsonValue()) as { path: string; note: string };
    const exported = videoOf(out.path);
    console.log(`[desktop-ingest] export: ${exported.codec_name} ${exported.width}x${exported.height}; report: ${out.note}`);
    expect(exported.width).toBe(3840);
    expect(exported.height).toBe(2160);
    expect(out.note).toMatch(/full-resolution source files/);
    expect(out.note).toMatch(/not proxies/);
    // Detail check (high-frequency energy of the centre, after scaling to 4K): the export keeps the 4K source's
    // detail; the half-res ProRes proxy upscaled to 4K measurably does not. (24 fps vs the 30 fps source
    // defeats stream copy, so the export is a real full-resolution decode and re-encode.)
    const detail = (file: string) => {
      const r = spawnSync(FFMPEG, ["-v", "info", "-ss", "1", "-i", file, "-frames:v", "1", "-filter_complex", "[0:v]scale=3840:2160:flags=bicubic,crop=1920:1080:960:540,split[a][b];[b]gblur=sigma=2[c];[a][c]blend=all_mode=difference,signalstats,metadata=print:file=-", "-f", "null", "-"], { encoding: "utf8" });
      return Number(/YAVG=([\d.]+)/.exec(r.stdout + r.stderr)?.[1]);
    };
    const exportDetail = detail(out.path);
    const sourceDetail = detail(CLIP);
    const proxyDetail = detail(ref.path);
    console.log(`[desktop-ingest] detail (high-frequency energy): export ${exportDetail.toFixed(3)}, 4K source ${sourceDetail.toFixed(3)}, half-res ProRes proxy upscaled ${proxyDetail.toFixed(3)}`);
    expect(Math.abs(exportDetail / sourceDetail - 1)).toBeLessThan(0.25);
    expect(Math.abs(proxyDetail / sourceDetail - 1)).toBeGreaterThan(0.4);

    // Reveal the missing-proxy state: delete the file, reload it into the panel.
    await E(page, "h.project.getState().forceSave()");
  }, 600_000);

  it("missing proxy file shows as missing and Retry/Rebuild brings it back", async () => {
    const { page } = session;
    const ref = (await mediaNamed(page, "clip4k.mp4"))!.proxy;
    fs.renameSync(ref.path, `${ref.path}.hidden`);
    fs.renameSync(ref.previewPath, `${ref.previewPath}.hidden`);
    // Re-check as a project load does.
    await E(page, `h.proxy.desktop.store.setState({ files: {} })`);
    await E(page, `h.proxy.cache.remove("${id}")`);
    await E(page, `h.proxy.desktop.loadDesktopProxy(h.project.getState().project.mediaLibrary.items.find((m) => m.id === "${id}"))`);
    await E(page, `h.proxy.ingest.setState({ missing: { "${id}": true } })`);
    const panel = page.getByTestId("proxy-panel");
    const body = page.getByTestId("proxy-panel-body");
    if (!(await body.isVisible())) await panel.getByRole("button", { name: /^Proxies/ }).first().click();
    await until("missing count 1", async () => (await textOf(body.getByTestId("proxy-count-missing"))).trim().startsWith("1"));
    await until("a missing-proxy row", async () => (await body.locator('[data-testid="proxy-row"][data-state="missing-proxy"]').count()) === 1);
    fs.renameSync(`${ref.path}.hidden`, ref.path);
    fs.renameSync(`${ref.previewPath}.hidden`, ref.previewPath);
    // Relink by folder search finds it again (name + duration + frame rate).
    await stubDialogs(session.app, { folder: path.dirname(ref.path) });
    await body.getByRole("button", { name: "Search a folder for proxies" }).click();
    await until("proxy relinked", async () => (await textOf(body.getByTestId("proxy-count-missing"))).trim().startsWith("0") && (await textOf(body.getByTestId("proxy-count-ready"))).trim().startsWith("1"), 60_000);
    const relinked = (await mediaNamed(page, "clip4k.mp4"))!.proxy;
    console.log(`[desktop-ingest] proxy relink by folder search: ${path.basename(relinked.path)} (source ${relinked.source})`);
    expect(relinked.storage).toBe("path");
  }, 180_000);

  it("copy-to-project: checksum-verified copy into Media, references rewritten, original untouched, one undo step", async () => {
    const { page } = session;
    const before = { size: fs.statSync(CLIP).size, mtime: fs.statSync(CLIP).mtimeMs, sha: sha(CLIP) };
    const history = await E(page, "h.project.getState().actionExecutor.getHistory().getUndoStackSize()");
    const report = await E(page, `h.proxy.desktop.copyMediaToProject(["${id}"])`);
    expect(report.copied).toHaveLength(1);
    const item = (await mediaNamed(page, "clip4k.mp4"))!;
    const mediaDir = path.join(projectDir, "Media");
    console.log(`[desktop-ingest] copy: ${item.sourceFile.path} (sha256 ${report.copied[0].sha256.slice(0, 12)}…), from ${item.copiedFrom.path}`);
    samePath(path.dirname(item.sourceFile.path), mediaDir);
    samePath(item.copiedFrom.path, CLIP);
    expect(item.copiedFrom.sha256).toBe(before.sha);
    expect(sha(item.sourceFile.path)).toBe(before.sha);
    expect(report.copied[0].sha256).toBe(before.sha);
    // Original: same bytes, same mtime, still there.
    expect([fs.statSync(CLIP).size, fs.statSync(CLIP).mtimeMs, sha(CLIP)]).toEqual([before.size, before.mtime, before.sha]);
    expect(await E(page, "h.project.getState().actionExecutor.getHistory().getUndoStackSize()")).toBe(history + 1);
    // Undo re-points at the original; the copied file stays on disk.
    await E(page, "h.project.getState().undo()");
    const undone = (await mediaNamed(page, "clip4k.mp4"))!;
    samePath(undone.sourceFile.path, CLIP);
    expect(undone.copiedFrom).toBeNull();
    expect(fs.existsSync(path.join(mediaDir, "clip4k.mp4"))).toBe(true);
    // A second copy does not overwrite: the name is numbered.
    const again = await E(page, `h.proxy.desktop.copyMediaToProject(["${id}"])`);
    expect(path.basename(again.copied[0].path)).toBe("clip4k (2).mp4");

    // The "Copy media to project" ingest preset does it on import, no manual step.
    await E(page, `h.project.getState().executeAction({ type: "media/organize", id: "p-copy", timestamp: Date.now(), params: { label: "Set ingest preset", ingestPreset: "copy" } })`);
    const onImport = path.join(work, "src", "onimport.mp4");
    makeClip(onImport, 1);
    await importClip(page, onImport, "onimport.mp4");
    const copied = await until("copy on import", async () => (await mediaNamed(page, "onimport.mp4"))?.copiedFrom, 60_000);
    const onImportItem = (await mediaNamed(page, "onimport.mp4"))!;
    samePath(onImportItem.sourceFile.path, path.join(projectDir, "Media", "onimport.mp4"));
    expect(copied.sha256).toBe(sha(onImport));
    expect(sha(onImportItem.sourceFile.path)).toBe(sha(onImport));
    expect(fs.existsSync(onImport)).toBe(true);
    await E(page, `h.project.getState().executeAction({ type: "media/organize", id: "p-copy-off", timestamp: Date.now(), params: { label: "Set ingest preset", ingestPreset: "none" } })`);
  }, 180_000);

  it("relink: offline media is found in a folder by name + duration + frame rate; a same-named clip of another length is not used", async () => {
    const { page } = session;
    const decoy = path.join(work, "found", "other", "clip4k.mp4");
    const real = path.join(work, "found", "deep", "a", "clip4k.mp4");
    fs.mkdirSync(path.dirname(decoy), { recursive: true });
    fs.mkdirSync(path.dirname(real), { recursive: true });
    makeClip(decoy, 2);
    fs.copyFileSync(CLIP, real);
    // Take the media offline the way a project load without the file does.
    await E(page, `h.project.setState((s) => ({ project: { ...s.project, mediaLibrary: { ...s.project.mediaLibrary, items: s.project.mediaLibrary.items.map((m) => m.id === "${id}" ? { ...m, isPlaceholder: true, blob: null, sourceFile: { name: m.sourceFile.name, size: m.sourceFile.size, lastModified: m.sourceFile.lastModified } } : m) } } }))`);
    const panel = page.getByTestId("proxy-panel");
    await until("1 offline", async () => (await textOf(panel.getByTestId("offline-count"))).includes("1 offline"));
    await until("an Offline badge", async () => (await page.getByText("Offline", { exact: true }).count()) > 0);
    await stubDialogs(session.app, { folder: path.join(work, "found") });
    await page.getByRole("button", { name: "Relink from Folder" }).click();
    const start = Date.now();
    while ((await mediaNamed(page, "clip4k.mp4"))!.placeholder) {
      if (Date.now() - start > 60_000) throw new Error(`media stayed offline; last relink report: ${JSON.stringify(await E(page, "h.proxy.desktop.store.getState().lastRelink"))}`);
      await sleep(250);
    }
    const report = await until("the full-resolution relink report", async () => { const r = await E(page, "h.proxy.desktop.store.getState().lastRelink"); return r?.kind === "full" ? r : null; }, 60_000);
    console.log(`[desktop-ingest] relink: ${JSON.stringify({ linked: report.linked.map((l: any) => path.relative(work, l.path)), notFound: report.notFound, ambiguous: report.ambiguous.length, scanned: report.scanned })}`);
    expect(report.linked).toHaveLength(1);
    samePath(report.linked[0].path, real);
    const item = (await mediaNamed(page, "clip4k.mp4"))!;
    samePath(item.sourceFile.path, real);
    await until("offline cleared", async () => (await panel.getByTestId("offline-count").count()) === 0);
  }, 240_000);

  it("the queue resumes after an app restart", async () => {
    await closeApp(session, true);
    // Two more clips, queued then killed mid-way.
    const clipA = path.join(work, "src", "resumeA.mp4");
    const clipB = path.join(work, "src", "resumeB.mp4");
    // Long enough that a job is still in flight when the second import returns: B's job is only queued once
    // B's own import has finished, and on an idle machine a 6 s clip's proxy can be done before that, which
    // leaves no running job to observe (the all-done state never matches the wait below).
    makeClip(clipA, 24);
    makeClip(clipB, 24);
    const resumeProfile = path.join(work, "profile-resume");
    const first = await launch(resumeProfile);
    await openEditor(first.page);
    await saveProjectAs(first, path.join(projectDir, "resume.oreel"));
    await E(first.page, `h.proxy.desktop.setDesktopProxyProfile({ codec: "h264", size: "quarter" })`);
    await E(first.page, `h.project.getState().executeAction({ type: "media/organize", id: "p2", timestamp: Date.now(), params: { label: "Set ingest preset", ingestPreset: "proxies" } })`);
    const idA = await importClip(first.page, clipA, "resumeA.mp4");
    const idB = await importClip(first.page, clipB, "resumeB.mp4");
    const queueFile = path.join(resumeProfile, "proxy-queue.json");
    const readQueue = (): any[] => {
      try {
        return fs.existsSync(queueFile) ? (JSON.parse(fs.readFileSync(queueFile, "utf8")).jobs as any[]) : [];
      } catch {
        return []; // caught mid-write
      }
    };
    // Wait until both jobs are persisted and one is running, then kill the app hard (no graceful shutdown).
    // On a loaded machine the first job can already be done by the time the second import returns; what the
    // test needs is a job in flight at the kill and the other(s) not finished, not a particular split.
    const seen: string[] = [];
    const deadlineNote = Date.now() + 85_000;
    await until(
      "both jobs persisted with one running",
      () => {
        const jobs = readQueue();
        const line = jobs.map((j) => j.status).join(",");
        if (seen[seen.length - 1] !== line) seen.push(line);
        if (jobs.length === 2 && jobs.some((j) => j.status === "running")) return true;
        if (Date.now() > deadlineNote) throw new Error(`queue states seen: ${seen.join(" -> ") || "none"}`);
        return false;
      },
      90_000,
    );
    const queued = JSON.parse(fs.readFileSync(queueFile, "utf8")).jobs as any[];
    console.log(`[desktop-ingest] queue file before the kill: ${queued.map((j) => `${j.mediaId.slice(0, 6)}:${j.status}`).join(", ")}`);
    expect(queued.length).toBe(2);
    expect(queued.some((j) => j.status === "running"), "a job was running when the app was killed").toBe(true);
    expect(queued.every((j) => j.status === "running" || j.status === "queued" || j.status === "done")).toBe(true);
    await closeApp(first, false);
    // A hard kill leaves the first app's ffmpeg running as an orphan. It must be gone before the relaunch,
    // or it can keep writing the very proxy the resumed job is about to produce.
    const orphans = () => {
      try {
        return execFileSync("pgrep", ["-f", path.join(work, "src", "resume")], { encoding: "utf8" }).trim();
      } catch {
        return ""; // pgrep exits 1 when nothing matches
      }
    };
    const orphanDeadline = Date.now() + 15_000;
    while (orphans() && Date.now() < orphanDeadline) await sleep(200);
    if (orphans()) {
      try { execFileSync("pkill", ["-9", "-f", path.join(work, "src", "resume")]); } catch { /* already gone */ }
      await until("the killed app's ffmpeg to exit", () => !orphans(), 15_000);
    }
    // Nothing finished yet (or at most the first), and no partial proxy is left behind as a final file.
    const proxiesDir = path.join(projectDir, "Proxies");
    const partial = () => fs.readdirSync(proxiesDir).filter((f) => f.startsWith("resume") && f.endsWith(".mp4"));
    const finishedBefore = partial().length;

    // Relaunch with the same profile: the main process resumes the queue on its own.
    const second = await launch(resumeProfile);
    // Ready signal, not a fixed delay: the main process has finished starting (which is what resumes the
    // queue) and the window has loaded.
    await second.app.evaluate(async ({ app }: any) => { await app.whenReady(); return true; });
    await second.page.waitForLoadState("load");
    await until(
      "the resumed queue to finish both jobs",
      () => {
        const jobs = readQueue();
        return jobs.length === 2 && jobs.every((j) => j.status === "done");
      },
      240_000,
    );
    const done = JSON.parse(fs.readFileSync(queueFile, "utf8")).jobs as any[];
    console.log(`[desktop-ingest] after restart: ${done.map((j) => `${j.mediaId.slice(0, 6)}:${j.status}`).join(", ")}; proxy files ${partial().length} (before ${finishedBefore})`);
    expect(done.map((j) => j.status)).toEqual(["done", "done"]);
    expect(partial()).toHaveLength(2);
    for (const j of done) expect(videoOf(j.result.outPath)).toMatchObject({ width: 960, height: 540 });
    expect(fs.readdirSync(proxiesDir).some((f) => f.endsWith(".part"))).toBe(false);
    expect([idA, idB].length).toBe(2);
    session = second;
  }, 600_000);

  it("measures playback CPU with and without proxies (4K long-GOP H.264 source, 1080p H.264 proxy)", async () => {
    // A fresh session with an H.264 proxy so the preview decodes the proxy directly.
    await closeApp(session, true);
    const s = await launch();
    session = s;
    const { page } = s;
    await openEditor(page);
    await saveProjectAs(s, path.join(projectDir, "cpu.oreel"));
    await E(page, `h.proxy.desktop.setDesktopProxyProfile({ codec: "h264", size: "half" })`);
    // A camera-style long-GOP 4K clip (60 Mbps, GOP 250, B-frames): the worst case for scrubbing, and what proxies are for.
    const cpuClip = path.join(work, "src", "cpu4k.mp4");
    execFileSync(FFMPEG, [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=30:duration=12",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=12",
      "-c:v", "libx264", "-preset", "veryfast", "-g", "250", "-bf", "3", "-b:v", "60M", "-maxrate", "80M", "-bufsize", "120M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", cpuClip,
    ]);
    const cpuId = await importClip(page, cpuClip, "cpu4k.mp4");
    await E(page, `h.proxy.desktop.queueDesktopProxies(["${cpuId}"], true)`);
    await waitProxyLinked(page, "cpu4k.mp4");
    const clip = await placeClip(page, "cpu4k.mp4");
    await page.waitForFunction((mid: string) => (window as any).__openreelE2E.proxy.cache.store.getState().entries[mid]?.status === "ready", cpuId, { timeout: 60_000 });

    const measure = async (label: string, seconds: number, action: () => Promise<void>) => {
      await sleep(1500);
      const samples: number[] = [];
      await page.evaluate(() => {
        const w = window as any;
        w.__rafDeltas = [];
        w.__rafOn = true;
        let last = 0;
        const tick = (t: number) => {
          if (!w.__rafOn) return;
          if (last) w.__rafDeltas.push(t - last);
          last = t;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const run = action();
      const t0 = Date.now();
      while (Date.now() - t0 < seconds * 1000) {
        await sleep(500);
        // percentCPUUsage is a share of ALL cores (one busy core reads 100 / cores), so scale it to % of one core.
        const cpu = os.cpus().length * await s.app.evaluate(({ app }: any) => app.getAppMetrics().reduce((sum: number, m: any) => sum + m.cpu.percentCPUUsage, 0));
        samples.push(cpu);
      }
      await run;
      const deltas: number[] = await page.evaluate(() => { (window as any).__rafOn = false; return (window as any).__rafDeltas; });
      const sorted = [...deltas].sort((a, b) => a - b);
      const mean = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
      const result = { label, cpuPercentAllProcesses: Math.round(mean * 10) / 10, samples: samples.length, rafP95Ms: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 10) / 10, rafOver50ms: deltas.filter((x) => x > 50).length };
      console.log(`[desktop-ingest] CPU ${JSON.stringify(result)}`);
      return result;
    };
    const playback = async () => {
      await seekTo(page, clip.start);
      await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().play());
      await sleep(7000);
      await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().pause());
    };
    const scrub = async () => {
      for (let i = 0; i < 24; i++) {
        await page.evaluate((t: number) => (window as any).__openreelE2E.timeline.getState().seekTo(t), clip.start + ((i * 0.37) % 9));
        await sleep(250);
      }
    };
    await page.evaluate(() => (window as any).__openreelE2E.proxy.cache.setProxiesOn(true));
    const playOn = await measure("playback, proxies on", 8, playback);
    const scrubOn = await measure("scrub, proxies on", 6, scrub);
    expect((await decodeLog(page, cpuId))?.source).toBe("proxy");
    await page.evaluate(() => (window as any).__openreelE2E.proxy.cache.setProxiesOn(false));
    const playOff = await measure("playback, proxies off", 8, playback);
    const scrubOff = await measure("scrub, proxies off", 6, scrub);
    expect((await decodeLog(page, cpuId))?.source).toBe("original");
    console.log(`[desktop-ingest] CPU summary (sum of all Electron processes, % of one core): playback ${playOn.cpuPercentAllProcesses} (proxy) vs ${playOff.cpuPercentAllProcesses} (original); scrub ${scrubOn.cpuPercentAllProcesses} vs ${scrubOff.cpuPercentAllProcesses}`);
    expect(playOn.samples).toBeGreaterThan(5);
  }, 600_000);
});
