/**
 * Real-Electron test for ingest presets (user-editable presets in the Manage presets dialog, a burn-in preset used
 * for one batch, "Copy and create proxies" with a checksum, attaching proxies by name pattern) and for file
 * associations (a project and caption files opened with the app: first launch and second launch).
 * Same build and opt-in as ingest-electron.test.ts (OPENREEL_DESKTOP_E2E=1, VITE_OPENREEL_E2E=1 desktop build).
 * Burn-in needs a drawtext build: the bundled sidecar (resources/bin/<platform>-<arch>/ffmpeg) is used when present.
 */
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const bundled = path.join(root, `apps/desktop/resources/bin/${process.platform}-${process.arch}/${process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"}`);
const SIDECAR = process.env.OPENREEL_FFMPEG_PATH ?? (fs.existsSync(bundled) ? bundled : FFMPEG);
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
const samePath = (a: string, b: string) => expect(fs.realpathSync(a)).toBe(fs.realpathSync(b));
async function until<T>(label: string, read: () => Promise<T> | T, timeout = 30_000): Promise<NonNullable<T>> {
  const start = Date.now();
  for (;;) {
    const value = await read();
    if (value) return value as NonNullable<T>;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hashOf = (file: string, alg: string) => createHash(alg).update(fs.readFileSync(file)).digest("hex");
const probe = (file: string): any => JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));
const videoOf = (file: string) => probe(file).streams.find((s: any) => s.codec_type === "video");
const frameMd5 = (file: string) => execFileSync(SIDECAR, ["-v", "error", "-ss", "0.5", "-i", file, "-frames:v", "1", "-f", "md5", "-"], { encoding: "utf8" }).trim();

let work = "";
let projectDir = "";
let projectFile = "";
let CLIP = "";

function makeClip(out: string, seconds: number, fps = 30): void {
  execFileSync(FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=${fps}:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
  ]);
}

interface Session { app: any; page: any }
const sessions: Session[] = [];
let launches = 0;
/** `args` are command-line files (what the OS passes on a double-click). `dir` reuses a profile (restart, second launch). */
async function launch(options: { dir?: string; args?: string[]; confirm?: boolean } = {}): Promise<Session & { profile: string }> {
  const { _electron } = loadPlaywright();
  const profile = options.dir ?? path.join(work, `profile-${++launches}`);
  const app = await _electron.launch({
    args: [path.join(root, "apps/desktop"), `--user-data-dir=${profile}`, ...(options.args ?? [])],
    env: { ...process.env, OPENREEL_FFMPEG_PATH: SIDECAR, OPENREEL_SKIP_ONBOARDING: "1" },
    timeout: 120_000,
  });
  const page = await app.firstWindow();
  // A profile reused after the app was killed offers to recover the last session: close it.
  await page.addLocatorHandler(page.getByRole("dialog").filter({ hasText: "Recover Your Work" }), async (dialog: any) => {
    await dialog.getByRole("button", { name: "Close dialog" }).click();
  });
  if (options.confirm !== undefined) page.on("dialog", (dialog: any) => void (options.confirm ? dialog.accept() : dialog.dismiss()));
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable */
    }
  });
  if (!options.args?.length) await page.reload();
  const session = { app, page, profile };
  sessions.push(session);
  return session;
}

async function openEditor(page: any): Promise<void> {
  await page.getByRole("button", { name: /Horizontal/ }).click({ timeout: 60_000 });
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.proxy?.desktop), undefined, { timeout: 30_000 });
}
const E = (page: any, expression: string): Promise<any> => page.evaluate(`(async (h) => (${expression}))(window.__openreelE2E)`);

async function closeApp(session: Session | undefined): Promise<void> {
  if (!session) return;
  let proc: { kill(signal: string): void };
  try {
    proc = session.app.process();
  } catch {
    return;
  }
  await Promise.race([session.app.evaluate(({ app }: any) => app.exit(0)).catch(() => undefined), sleep(4000)]);
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
    return item ? { id: item.id as string, proxy: item.proxy ?? null, sourceFile: item.sourceFile ?? null, copiedFrom: item.copiedFrom ?? null } : null;
  }, name);

async function importClip(page: any, file: string, name: string): Promise<string> {
  await page.locator('[data-tour="assets"] input[type="file"]').setInputFiles(file);
  await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 60_000 });
  const item = await mediaNamed(page, name);
  if (!item) throw new Error(`${name} was not imported`);
  return item.id;
}

async function stubDialogs(app: any, args: { savePath?: string; openPath?: string }): Promise<void> {
  await app.evaluate(({ dialog }: any, a: any) => {
    if (a.savePath) dialog.showSaveDialog = async () => ({ canceled: false, filePath: a.savePath });
    if (a.openPath) dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [a.openPath] });
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
async function openPanel(page: any) {
  const panel = page.getByTestId("proxy-panel");
  const body = page.getByTestId("proxy-panel-body");
  if (!(await body.isVisible())) await panel.getByRole("button", { name: /^Proxies/ }).first().click();
  return body;
}
async function waitProxyLinked(page: any, name: string, timeout = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ref = (await mediaNamed(page, name))?.proxy;
    if (ref?.status === "ready") return ref;
    await sleep(300);
  }
  throw new Error(`proxy for ${name} was not linked in ${timeout} ms`);
}

beforeAll(() => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "oringest-presets-"));
  projectDir = path.join(work, "Project");
  projectFile = path.join(projectDir, "film.oreel");
  fs.mkdirSync(projectDir, { recursive: true });
  CLIP = path.join(work, "src", "clip720.mp4");
  fs.mkdirSync(path.dirname(CLIP), { recursive: true });
  makeClip(CLIP, 3);
}, 180_000);

afterAll(async () => {
  for (const s of sessions) await closeApp(s);
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

d("ingest presets in real Electron", () => {
  let profileDir = "";

  it("a user preset made in the dialog (ProRes LT, burn-in, next to the media) is kept across a restart and builds a proxy for one batch", async () => {
    const first = await launch();
    profileDir = first.profile;
    const { page } = first;
    await openEditor(page);
    await saveProjectAs(first, path.join(projectDir, "presets.oreel"));
    await importClip(page, CLIP, "clip720.mp4");

    let body = await openPanel(page);
    await body.getByRole("button", { name: "Manage proxy presets" }).click({ timeout: 15_000 });
    const dialog = page.getByTestId("proxy-presets-dialog");
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.getByTestId("preset-row-prores-proxy").click();
    await dialog.getByRole("button", { name: "Duplicate" }).click();
    await dialog.getByLabel("Preset name").fill("Dailies burn-in");
    await dialog.getByLabel("Burn in clip name").check();
    await dialog.getByLabel("Burn in timecode").check();
    await dialog.getByRole("combobox", { name: "Preset format" }).click();
    await page.getByRole("option", { name: "ProRes 422 LT (.mov)" }).click();
    await dialog.getByRole("combobox", { name: "Preset destination" }).click();
    await page.getByRole("option", { name: /Next to the media/ }).click();
    await dialog.getByTestId("preset-save").click();
    await dialog.getByTestId("preset-message").waitFor();
    await dialog.getByRole("button", { name: "Done" }).click();

    // Persisted in app settings: a fresh launch of the same profile still has it.
    await closeApp(first);
    const second = await launch({ dir: profileDir });
    await openEditor(second.page);
    const stored = await second.page.evaluate(() => JSON.parse(localStorage.getItem("openreel:ingest-presets") ?? "null"));
    expect(stored.presets.map((p: any) => p.name)).toEqual(["Dailies burn-in"]);
    expect(stored.presets[0].profile).toMatchObject({ codec: "prores-lt", size: "half", burnIn: { clipName: true, timecode: true }, destination: { mode: "media" } });

    // Open the project again, import, and build one batch with the user preset (not the project's preset).
    await saveProjectAs(second, path.join(projectDir, "batch.oreel"));
    const clip = path.join(work, "src", "batch.mp4");
    makeClip(clip, 2);
    await importClip(second.page, clip, "batch.mp4");
    body = await openPanel(second.page);
    await body.getByRole("button", { name: "Create proxies with a preset" }).click({ timeout: 15_000 });
    const create = second.page.getByTestId("create-proxies-dialog");
    await create.waitFor({ timeout: 10_000 });
    await create.getByText("Dailies burn-in").click();
    await create.getByLabel("Use as the project's preset").uncheck();
    await create.getByTestId("create-proxies-confirm").click();

    const ref = await waitProxyLinked(second.page, "batch.mp4");
    // Written next to the media (a Proxies folder beside batch.mp4), named for the preset, ProRes LT at half size.
    samePath(path.dirname(ref.path), path.join(work, "src", "Proxies"));
    expect(path.basename(ref.path)).toMatch(/_half-lt-bn-tc_proxy\.mov$/);
    expect(videoOf(ref.path)).toMatchObject({ codec_name: "prores", profile: "LT", width: 640, height: 360 });
    expect(ref.profile).toMatchObject({ codec: "prores-lt", burnIn: { clipName: true, timecode: true } });
    // A batch-only choice leaves the project's own preset alone.
    expect((await E(second.page, "h.project.getState().project.mediaLibrary.desktopIngest")) ?? {}).not.toHaveProperty("proxyProfile.burnIn");
    // The burn-in is in the picture: the same clip without it looks different.
    const plain = path.join(work, "plain-half.mp4");
    execFileSync(SIDECAR, ["-y", "-v", "error", "-i", clip, "-vf", "scale=640:360", "-c:v", "prores_ks", "-profile:v", "1", "-f", "mov", plain.replace(/\.mp4$/, ".mov")]);
    expect(frameMd5(ref.path)).not.toBe(frameMd5(plain.replace(/\.mp4$/, ".mov")));
  }, 600_000);

  it("Copy and create proxies: the copy is verified with MD5 in the background, the project points at it, the proxy is built from it", async () => {
    const session = await launch();
    const { page } = session;
    await openEditor(page);
    const file = path.join(projectDir, "copyproxy.oreel");
    await saveProjectAs(session, file);
    // The panel appears once the project has a video; this clip is imported with ingest off.
    const first = path.join(work, "src", "before.mp4");
    makeClip(first, 1);
    await importClip(page, first, "before.mp4");
    const body = await openPanel(page);
    await body.getByRole("combobox", { name: "Ingest preset" }).click();
    await page.getByRole("option", { name: "Copy and create proxies" }).click();
    await until("ingest setting saved", async () => (await E(page, "h.project.getState().project.mediaLibrary.ingestPreset")) === "copy");
    expect(await E(page, "h.project.getState().project.mediaLibrary.desktopIngest.proxiesWithCopy")).toBe(true);
    await body.getByRole("button", { name: /Jobs and folders/ }).click().catch(() => undefined);
    // Checksum choice: it is a plain select in the desktop settings.
    await body.getByRole("combobox", { name: "Copy checksum" }).click();
    await page.getByRole("option", { name: "MD5" }).click();
    await until("checksum saved", async () => (await E(page, "h.project.getState().project.mediaLibrary.desktopIngest.checksum")) === "md5");

    const src = path.join(work, "src", "ingest-me.mp4");
    makeClip(src, 2);
    await importClip(page, src, "ingest-me.mp4");
    const copied = await until("copy linked", async () => (await mediaNamed(page, "ingest-me.mp4"))?.copiedFrom, 90_000);
    const item = (await mediaNamed(page, "ingest-me.mp4"))!;
    samePath(path.dirname(item.sourceFile.path), path.join(projectDir, "Media"));
    expect(copied.checksum).toEqual({ algorithm: "md5", value: hashOf(src, "md5") });
    expect(copied.sha256).toBe("");
    expect(hashOf(item.sourceFile.path, "md5")).toBe(hashOf(src, "md5"));
    expect(fs.existsSync(src)).toBe(true);
    // The proxy is made from the verified copy and lands in the project's Proxies folder.
    const ref = await waitProxyLinked(page, "ingest-me.mp4");
    samePath(path.dirname(ref.path), path.join(projectDir, "Proxies"));
    expect(videoOf(ref.path)).toMatchObject({ codec_name: "h264", height: 360 });
    // The panel reports what was copied and how it was verified.
    await openPanel(page);
    await until("copy report", async () => (await page.getByTestId("copy-report").innerText().catch(() => "")).includes("MD5"), 15_000);
    expect(await page.getByTestId("copy-report").innerText()).toContain(hashOf(src, "md5").slice(0, 16));
  }, 600_000);

  it("attach by name pattern: a fitting proxy is attached; one with the wrong duration is reported as a mismatch", async () => {
    const session = await launch();
    const { page } = session;
    await openEditor(page);
    await importClip(page, CLIP, "clip720.mp4");
    const proxies = path.join(work, "camera-proxies");
    fs.mkdirSync(proxies, { recursive: true });
    const good = path.join(proxies, "clip720_LR.mp4");
    execFileSync(FFMPEG, ["-y", "-v", "error", "-i", CLIP, "-vf", "scale=640:360", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", good]);
    const report = await E(page, `h.proxy.desktop.relinkFromFolder("proxy", ${JSON.stringify(proxies)}, { pattern: "{name}_LR" })`);
    expect(report.linked.map((l: any) => l.name)).toEqual(["clip720.mp4"]);
    expect((await mediaNamed(page, "clip720.mp4"))?.proxy).toMatchObject({ source: "attached" });
    // Replace it with a proxy of another length: reported, not attached.
    await E(page, `h.project.getState().undo()`);
    fs.rmSync(good);
    execFileSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=6", "-c:v", "libx264", good]);
    const bad = await E(page, `h.proxy.desktop.relinkFromFolder("proxy", ${JSON.stringify(proxies)}, { pattern: "{name}_LR" })`);
    expect(bad.linked).toEqual([]);
    expect(bad.mismatched).toHaveLength(1);
    expect(bad.mismatched[0].reasons[0]).toMatch(/Duration 6\.0\ds does not match the original 3\.0\ds/);
  }, 300_000);
});

d("file associations in real Electron", () => {
  const srt = () => path.join(work, "captions.srt");
  beforeAll(() => {
    if (!enabled) return;
    fs.writeFileSync(srt(), "1\n00:00:00,500 --> 00:00:01,500\nHello from the OS\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond cue\n");
  });
  /** A saved, empty project to open (made once). */
  const ensureProjectFile = async (): Promise<void> => {
    if (fs.existsSync(projectFile)) return;
    const seed = await launch();
    await openEditor(seed.page);
    await saveProjectAs(seed, projectFile);
    await closeApp(seed);
  };
  const subtitleCount = (page: any) => E(page, "(h.project.getState().project.timeline.subtitles ?? []).length");

  it("a project file on the command line opens as the project; a caption file from a second launch is imported into it", async () => {
    await ensureProjectFile();
    const first = await launch({ args: [projectFile] });
    const { page } = first;
    await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.project?.getState().hasOpenProject), undefined, { timeout: 60_000 });
    expect(page.url()).toContain("#/editor");
    const named = await E(page, "h.project.getState().project.name");
    expect(named).toBeTruthy();
    expect(await subtitleCount(page)).toBe(0);

    // A second launch (the OS double-clicking a .srt while the app runs): the first instance gets the file.
    const electronBinary = require("electron") as string;
    const second = spawn(electronBinary, [path.join(root, "apps/desktop"), `--user-data-dir=${first.profile}`, srt()], { stdio: "ignore", env: { ...process.env, OPENREEL_FFMPEG_PATH: SIDECAR } });
    const exited = new Promise<number | null>((resolve) => second.on("exit", resolve));
    await until("captions imported by the running app", async () => (await subtitleCount(page)) === 2, 60_000);
    expect(await E(page, "h.project.getState().project.timeline.subtitles.map((s) => s.text)")).toEqual(["Hello from the OS", "Second cue"]);
    await Promise.race([exited, sleep(10_000)]);
    second.kill("SIGKILL");
    // Release the project's lock: the next test opens the same file.
    await closeApp(first);
  }, 240_000);

  it("a caption file with no project open asks which project, then imports into the one chosen", async () => {
    await ensureProjectFile();
    // The app is running at the start screen (no project); its project picker is stubbed to answer with the saved project.
    const running = await launch();
    // The question is an in-app dialog now: a native confirm box must never appear.
    const nativeDialogs: string[] = [];
    running.page.on("dialog", (dialog: any) => {
      nativeDialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await stubDialogs(running.app, { openPath: projectFile });
    const { page } = running;
    expect(await page.evaluate(() => Boolean((window as any).__openreelE2E?.project?.getState().hasOpenProject))).toBe(false);
    const electronBinary = require("electron") as string;
    const second = spawn(electronBinary, [path.join(root, "apps/desktop"), `--user-data-dir=${running.profile}`, srt()], { stdio: "ignore", env: { ...process.env, OPENREEL_FFMPEG_PATH: SIDECAR } });
    await page.getByTestId("which-project-dialog").waitFor({ timeout: 60_000 });
    expect(await page.getByTestId("which-project-dialog").innerText()).toMatch(/Which project\?[\s\S]*this caption file/);
    await page.getByTestId("which-project-choose").click();
    await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.project?.getState().hasOpenProject), undefined, { timeout: 60_000 });
    expect(nativeDialogs).toEqual([]);
    try {
      await until("captions imported into the chosen project", async () => (await subtitleCount(page)) >= 2, 60_000);
    } catch (error) {
      console.log(`[open-files] page text: ${(await page.evaluate(() => document.body.innerText)).split("\n").filter((l: string) => /caption|import|could|project/i.test(l)).slice(0, 12).join(" | ")}`);
      throw error;
    } finally {
      second.kill("SIGKILL");
    }
  }, 240_000);
});
