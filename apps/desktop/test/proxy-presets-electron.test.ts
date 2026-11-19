/**
 * Real-Electron test for the proxy presets (Create Proxies dialog, Proxies panel preset selector, DNxHR LB,
 * preview twin, toggle-proxies) and for the hardware / software encoder choice on the ffmpeg sidecar.
 * Same build and opt-in as ingest-electron.test.ts (OPENREEL_DESKTOP_E2E=1, VITE_OPENREEL_E2E=1 desktop build).
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
    "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=30:duration=${seconds}`,
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
  makeClip(CLIP, 3);
}, 180_000);

afterAll(async () => {
  for (const s of sessions) await closeApp(s, false);
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

d("proxy presets and encoder choice in real Electron", () => {
  let session: Session;

  it("Create Proxies dialog builds a DNxHR LB proxy with an H.264 preview twin; the panel preset selector and toggle work", async () => {
    session = await launch();
    const { page } = session;
    await openEditor(page);
    await saveProjectAs(session, path.join(projectDir, "film.oreel"));
    const id = await importClip(page, CLIP, "clip4k.mp4");
    expect((await mediaNamed(page, "clip4k.mp4"))?.proxy ?? null).toBeNull();

    const panel = page.getByTestId("proxy-panel");
    const body = page.getByTestId("proxy-panel-body");
    if (!(await body.isVisible())) await panel.getByRole("button", { name: /^Proxies/ }).first().click();
    console.log(`[proxy-presets] panel: ${(await textOf(body)).replace(/\s+/g, " ").slice(0, 400)}`);
    await body.getByRole("button", { name: "Create proxies with a preset" }).click({ timeout: 15_000 });
    const dialog = page.getByTestId("create-proxies-dialog");
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.getByTestId("proxy-preset-dnxhr-lb").click();
    await expect(dialog.getByTestId("proxy-preset-dnxhr-lb").getAttribute("data-selected")).resolves.toBe("true");
    await dialog.getByTestId("create-proxies-confirm").click();

    const ref = await (async () => {
      const start = Date.now();
      for (;;) {
        const linked = (await mediaNamed(page, "clip4k.mp4"))?.proxy;
        if (linked?.status === "ready") return linked;
        if (Date.now() - start > 240_000) throw new Error("DNxHR proxy never linked");
        await sleep(300);
      }
    })();
    console.log(`[proxy-presets] ref: ${JSON.stringify({ path: path.basename(ref.path), codec: ref.codec, profile: ref.profile, preview: ref.previewPath ? path.basename(ref.previewPath) : null })}`);
    expect(ref.profile).toEqual({ codec: "dnxhr-lb", size: "half" });
    expect(videoOf(ref.path)).toMatchObject({ codec_name: "dnxhd", width: 640, height: 360 });
    expect(ref.previewPath).toBeTruthy();
    expect(videoOf(ref.previewPath)).toMatchObject({ codec_name: "h264", width: 640, height: 360 });
    expect(await E(page, "h.project.getState().project.mediaLibrary.desktopIngest")).toEqual({ proxyProfile: { codec: "dnxhr-lb", size: "half" } });

    // Undo restores the previous profile (one undo step for the preset change).
    // Panel preset selector reflects and changes the saved preset.
    if (!(await body.isVisible())) await panel.getByRole("button", { name: /^Proxies/ }).first().click();
    await body.getByTestId("desktop-ingest-settings").getByRole("combobox", { name: "Proxy preset" }).click();
    await page.getByRole("option", { name: "H.264 1/4 resolution" }).click();
    await until("quarter profile saved", async () => (await E(page, "h.project.getState().project.mediaLibrary.desktopIngest")).proxyProfile?.size === "quarter");
    expect(await E(page, "h.project.getState().project.mediaLibrary.desktopIngest")).toEqual({ proxyProfile: { codec: "h264", size: "quarter" } });
    await E(page, "h.project.getState().undo()");
    await until("undo restores DNxHR", async () => (await E(page, "h.project.getState().project.mediaLibrary.desktopIngest")).proxyProfile?.codec === "dnxhr-lb");

    // Toggle proxies: the preview decodes the proxy twin, then the original.
    const clip = await placeClip(page, "clip4k.mp4");
    await page.waitForFunction((mid: string) => (window as any).__openreelE2E.proxy.cache.store.getState().entries[mid]?.status === "ready", id, { timeout: 120_000 });
    await seekTo(page, clip.start + 1.2);
    await sleep(2000);
    expect((await decodeLog(page, id))?.source).toBe("proxy");
    await page.getByTestId("toggle-proxies").click();
    await seekTo(page, clip.start + 1.3);
    await seekTo(page, clip.start + 1.2);
    await sleep(2500);
    expect((await decodeLog(page, id))?.source).toBe("original");
  }, 600_000);

  const exportWith = async (page: any, extra: string): Promise<{ status: string; path?: string; error?: string }> => {
    await E(page, `h.exportQueue.getState().enqueue({ settings: { width: 1280, height: 720, frameRate: 24, format: "mp4", codec: "h264", bitrate: 6000, ${extra} }, presetLabel: "enc" })`);
    await E(page, "h.exportQueue.getState().start()");
    const done = await page.waitForFunction(() => {
      const jobs = (window as any).__openreelE2E.exportQueue.getState().queue.jobs as any[];
      const job = jobs[jobs.length - 1];
      return job && (job.status === "completed" || job.status === "failed") ? { status: job.status as string, path: job.output?.path as string | undefined, error: job.error as string | undefined } : null;
    }, undefined, { timeout: 300_000, polling: 500 });
    return (await done.jsonValue()) as { status: string; path?: string; error?: string };
  };

  it("Software and Hardware choices reach the ffmpeg sidecar: libx264 vs VideoToolbox, and Hardware + Two-pass is refused", async () => {
    const { page } = session;
    const encoders: string[] = await page.evaluate(async () => ((await (window as any).openreel.probeHardware?.())?.encoders ?? []) as string[]);
    console.log(`[encoder] sidecar reports: ${encoders.join(", ")}`);
    const encoderTag = (file: string) => (execFileSync(FFPROBE, ["-v", "error", "-show_entries", "stream_tags=encoder:format_tags=encoder", "-of", "default=nw=1", file], { encoding: "utf8" }) + execFileSync("strings", [file], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter((l) => /libx264|videotoolbox/i.test(l)).join("\n"));
    const soft = await exportWith(page, 'encoderChoice: "software"');
    expect(soft.status, soft.error).toBe("completed");
    expect(videoOf(soft.path!).codec_name).toBe("h264");
    expect(encoderTag(soft.path!)).toMatch(/libx264/);
    if (encoders.includes("h264_videotoolbox")) {
      const hard = await exportWith(page, 'encoderChoice: "hardware"');
      expect(hard.status, hard.error).toBe("completed");
      expect(videoOf(hard.path!).codec_name).toBe("h264");
      expect(encoderTag(hard.path!)).not.toMatch(/libx264/);
    }
    const twoPass = await exportWith(page, 'encoderChoice: "software", rateControl: "vbr2", maxBitrate: 9000');
    console.log(`[encoder] software + two-pass: ${twoPass.status} ${twoPass.error ?? ""}`);
    expect(twoPass.status, twoPass.error).toBe("completed");
    const refused = await exportWith(page, 'encoderChoice: "hardware", rateControl: "vbr2"');
    console.log(`[encoder] hardware + two-pass: ${refused.status} ${refused.error}`);
    expect(refused.status).toBe("failed");
    expect(refused.error ?? "").toMatch(/two-pass/i);
  }, 900_000);
});
