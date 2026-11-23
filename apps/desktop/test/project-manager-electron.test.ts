/**
 * Real-Electron end-to-end coverage of File > Project Manager (Playwright _electron, the BUILT app):
 * a generated project (two ProRes sources, one used twice with a source gap, one used at 2x speed, one source
 * never used) is consolidated to ProRes 422 HQ with trimming and handles into a temp folder through the dialog,
 * then the new project is opened from that folder and checked: media online, the unused source left out, the
 * sources untouched, and the monitor showing the same frames as the original at several timeline positions.
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * Opt in with OPENREEL_DESKTOP_PM_E2E=1:  pnpm --filter @openreel/desktop test:project-manager-e2e
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const enabled =
  process.env.OPENREEL_DESKTOP_PM_E2E === "1" &&
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

const W = 640;
const H = 360;
const FPS = 24;
const TW = 128;
const TH = 72;
/** Mean abs diff (0-255) that counts as the same picture; testsrc2 frames a few frames apart differ by far more. */
const MATCH = 10;

let work = "";
const sessions = new Set<{ app: any }>();

async function launch(profile: string): Promise<{ app: any; page: any }> {
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
  sessions.add({ app });
  return { app, page };
}

async function createProject(page: any): Promise<void> {
  const close = page.getByRole("button", { name: "Close dialog" });
  if (await close.waitFor({ timeout: 4_000 }).then(() => true, () => false)) {
    await close.click();
    await close.waitFor({ state: "detached", timeout: 10_000 });
  }
  await page.getByRole("button", { name: /Horizontal/ }).click({ timeout: 60_000 });
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.projectFile), undefined, { timeout: 30_000 });
}

async function stubDialogs(app: any, answers: { open?: string; save?: string; folder?: string }): Promise<void> {
  await app.evaluate(({ dialog }: any, a: typeof answers) => {
    dialog.showOpenDialog = async (...args: any[]) => {
      const options = args.find((arg) => arg && typeof arg === "object" && Array.isArray(arg.properties));
      const wantsFolder = Boolean(options?.properties?.includes("openDirectory"));
      const chosen = wantsFolder ? a.folder : a.open;
      return chosen ? { canceled: false, filePaths: [chosen] } : { canceled: true, filePaths: [] };
    };
    dialog.showSaveDialog = async () => (a.save ? { canceled: false, filePath: a.save } : { canceled: true });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, answers);
}

function killAll(): void {
  for (const s of sessions) {
    try {
      s.app.process().kill("SIGKILL");
    } catch {
      /* closed */
    }
  }
  sessions.clear();
}
afterEach(killAll);
afterAll(() => {
  killAll();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

function makeProres(out: string, seconds: number, hue: number): void {
  execFileSync(FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${seconds},hue=h=${hue}`,
    "-f", "lavfi", "-i", `sine=frequency=${300 + hue}:sample_rate=48000:duration=${seconds}`,
    "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:a", "pcm_s16le", "-shortest", out,
  ]);
}

function referenceThumb(file: string, srcTime: number): Buffer {
  const n = Math.floor(srcTime * FPS + 1e-6);
  return execFileSync(FFMPEG, ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n}),scale=${TW}:${TH}:flags=area:in_color_matrix=bt709`, "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });
}

const meanAbsDiff = (a: Uint8Array, b: Uint8Array): number => {
  expect(a.length).toBe(b.length);
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return sum / (a.length / 4) / 3;
};

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

/** A neighbouring frame of testsrc2 differs by about 4; the same frame through a ProRes round trip by well under 1.5. */
const SAME_FRAME = 1.5;

/**
 * Seek to a timeline time and wait for the monitor to settle on the right picture, then return it.
 * With `identicalTo`, "right" means the same frame as that capture (tight, so a frame off by one fails); otherwise it is
 * the ffmpeg reference of the source frame (loose: different scaler) or, for a gap, a dark frame.
 */
async function showsFrame(page: any, time: number, reference: Buffer | null, label: string, identicalTo?: Buffer): Promise<Buffer> {
  await page.evaluate((s: number) => (window as any).__openreelE2E.timeline.getState().seekTo(s), time);
  const started = Date.now();
  let best = Infinity;
  let stable = 0;
  let previous: Buffer | null = null;
  while (Date.now() - started < 25_000) {
    const shown = await monitorThumb(page);
    if (shown) {
      best = identicalTo
        ? meanAbsDiff(shown, identicalTo)
        : reference ? meanAbsDiff(shown, reference) : meanAbsDiff(shown, Buffer.alloc(shown.length, 0));
      const right = identicalTo ? best < SAME_FRAME : reference ? best < MATCH : best < 40;
      // The picture must also stop changing: a render in progress can pass through a near neighbour.
      stable = right && previous && meanAbsDiff(shown, previous) < 0.3 ? stable + 1 : 0;
      previous = shown;
      if (stable >= 3) return shown;
    }
    await sleep(120);
  }
  throw new Error(`${label}: the monitor never settled on the expected frame at ${time}s (best mean diff ${best})`);
}

const sha = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

interface ClipInfo { id: string; mediaId: string; startTime: number; duration: number; inPoint: number; outPoint: number; speed?: number }

d("Project Manager consolidates and trims a project", () => {
  let srcA = "";
  let srcB = "";
  let srcC = "";
  let clips: ClipInfo[] = [];
  const originalHashes: Record<string, string> = {};
  const originalFrames = new Map<number, Buffer | null>();
  let probes: Array<{ time: number; mediaFile: string | null; srcTime: number }> = [];
  let destRoot = "";
  let projectFolder = "";

  beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "orpm-e2e-"));
    fs.mkdirSync(path.join(work, "media"));
    srcA = path.join(work, "media", "interview-a.mov");
    srcB = path.join(work, "media", "broll-b.mov");
    srcC = path.join(work, "media", "unused-c.mov");
    makeProres(srcA, 12, 0);
    makeProres(srcB, 8, 120);
    makeProres(srcC, 4, 240);
    for (const f of [srcA, srcB, srcC]) originalHashes[f] = sha(f);
    destRoot = path.join(work, "consolidated");
  });

  it("builds the project, consolidates it through the dialog, and the new project plays the same frames", async () => {
    const s = await launch(path.join(work, "profile"));
    const { page, app } = s;
    await createProject(page);
    await stubDialogs(app, { save: path.join(work, "original.oreel"), folder: destRoot });

    // ---- the original project ----
    for (const f of [srcA, srcB, srcC]) {
      await page.locator('[data-tour="assets"] input[type="file"]').setInputFiles(f);
      await page.getByLabel(`Select media ${path.basename(f)}`).waitFor({ timeout: 60_000 });
    }
    const ids: Record<string, string> = await E(page, `Object.fromEntries(h.project.getState().project.mediaLibrary.items.map((m) => [m.name, m.id]))`);
    const idA = ids["interview-a.mov"];
    const idB = ids["broll-b.mov"];
    const idC = ids["unused-c.mov"];
    expect(idA && idB && idC).toBeTruthy();

    const trackId: string = await E(page, `h.project.getState().project.timeline.tracks.find((t) => t.type === "video").id`);
    const add = async (mediaId: string, start: number): Promise<string> => {
      const before: string[] = await E(page, `h.project.getState().project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.id))`);
      const ok = await E(page, `(async () => { const r = await h.project.getState().addClip("${trackId}", "${mediaId}", ${start}); return r.success; })()`);
      expect(ok).toBe(true);
      const after: string[] = await E(page, `h.project.getState().project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.id))`);
      return after.find((id) => !before.includes(id))!;
    };
    const trim = async (clipId: string, inPoint: number, outPoint: number): Promise<void> => {
      expect(await E(page, `(async () => (await h.project.getState().trimClip("${clipId}", ${inPoint}, ${outPoint})).success)()`)).toBe(true);
    };
    const move = async (clipId: string, start: number): Promise<void> => {
      expect(await E(page, `(async () => (await h.project.getState().moveClip("${clipId}", ${start})).success)()`)).toBe(true);
    };
    // A used twice (source 2..4 and 8..10, a source gap of 4 s and a timeline gap of 1 s between them), B at 2x speed.
    const a1 = await add(idA, 0);
    await trim(a1, 2, 4);
    const a2 = await add(idA, 20);
    await trim(a2, 8, 10);
    await move(a2, 3);
    const b1 = await add(idB, 20);
    await trim(b1, 1, 5);
    await move(b1, 5.5);
    expect(await E(page, `h.speed.editClipSpeed(h.project.getState().project.id, "${b1}", { speed: 2 }, true)`)).toBe(true);
    clips = await E(page, `h.project.getState().project.timeline.tracks.flatMap((t) => t.clips).map((c) => ({ id: c.id, mediaId: c.mediaId, startTime: c.startTime, duration: c.duration, inPoint: c.inPoint, outPoint: c.outPoint, speed: c.speed }))`);
    const byMedia = (id: string): ClipInfo[] => clips.filter((c) => c.mediaId === id).sort((x, y) => x.startTime - y.startTime);
    expect(byMedia(idA)).toHaveLength(2);
    expect(byMedia(idB)).toHaveLength(1);
    expect(byMedia(idB)[0].speed).toBe(2);
    expect(byMedia(idB)[0].duration).toBeCloseTo(2, 3);

    // ---- probe times: inside each clip, plus the timeline gap ----
    const [ca1, ca2] = byMedia(idA);
    const [cb] = byMedia(idB);
    const at = (clip: ClipInfo, k: number, file: string) => {
      const time = clip.startTime + clip.duration * k;
      return { time, mediaFile: file, srcTime: clip.inPoint + (time - clip.startTime) * (clip.speed ?? 1) };
    };
    probes = [
      at(ca1, 0.1, srcA), at(ca1, 0.8, srcA),
      { time: (ca1.startTime + ca1.duration + ca2.startTime) / 2, mediaFile: null, srcTime: 0 },
      at(ca2, 0.2, srcA), at(ca2, 0.9, srcA),
      at(cb, 0.15, srcB), at(cb, 0.55, srcB), at(cb, 0.95, srcB),
    ];
    for (const p of probes) {
      const ref = p.mediaFile ? referenceThumb(p.mediaFile, p.srcTime) : null;
      originalFrames.set(p.time, await showsFrame(page, p.time, ref, "original"));
    }

    // ---- File > Project Manager (the menu action the native menu sends) ----
    await app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].webContents.send("openreel:menu:action", "projectManager"));
    const dialog = page.getByTestId("project-manager-dialog");
    await dialog.waitFor({ timeout: 30_000 });
    await dialog.getByRole("radio", { name: /Consolidate and Transcode/ }).check();
    await dialog.getByLabel("Transcode preset").selectOption({ label: "ProRes 422 HQ" });
    await dialog.getByLabel(/Trim media to the parts used/).check();
    await dialog.getByLabel("Handle frames").fill("6");
    await dialog.getByRole("button", { name: "Browse…" }).click();
    await page.waitForFunction((p: string) => document.querySelector('[data-testid="pm-destination"]')?.textContent === p, destRoot, { timeout: 15_000 });
    // The estimate arrives for these options and is more than zero and less than the whole sources would take.
    await page.waitForFunction(() => /MB|GB/.test(document.querySelector('[data-testid="pm-estimate-total"]')?.textContent ?? ""), undefined, { timeout: 60_000 });
    const estimateText: string = await page.getByTestId("pm-estimate").innerText();
    expect(estimateText).toMatch(/unused left out/);
    expect(estimateText).not.toMatch(/unused-c\.mov/);
    const start = dialog.getByRole("button", { name: "Consolidate" });
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('[data-testid="pm-footer"] button')].find((x) => x.textContent === "Consolidate") as HTMLButtonElement | undefined; return Boolean(b) && !b!.disabled; }, undefined, { timeout: 30_000 });
    await start.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="pm-progress"]')?.getAttribute("data-phase") === "done", undefined, { timeout: 180_000 });

    // ---- what is on disk ----
    const folders = fs.readdirSync(destRoot);
    expect(folders).toHaveLength(1);
    projectFolder = path.join(destRoot, folders[0]);
    const media = fs.readdirSync(path.join(projectFolder, "Media")).sort();
    expect(media).toEqual(["broll-b.mov", "interview-a.mov"]);
    expect(fs.existsSync(path.join(projectFolder, "Media", "unused-c.mov"))).toBe(false);
    for (const f of [srcA, srcB, srcC]) expect(sha(f), `${path.basename(f)} untouched`).toBe(originalHashes[f]);
    // Trimmed: A keeps 2 stretches (2..4 and 8..10 with 0.25 s handles) = 5 s of 12; B keeps its 4 source seconds (1..5) + handles = 4.5 s of 8.
    const probe = (f: string): number => {
      const out = (() => { try { return execFileSync(FFMPEG, ["-hide_banner", "-i", f], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }); } catch (e: any) { return String(e.stderr ?? ""); } })();
      const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(out)!;
      return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    };
    expect(probe(path.join(projectFolder, "Media", "interview-a.mov"))).toBeCloseTo(5, 1);
    expect(probe(path.join(projectFolder, "Media", "broll-b.mov"))).toBeCloseTo(4.5, 1);

    // ---- the saved project of the new folder ----
    const projectFile = fs.readdirSync(projectFolder).find((f) => f.endsWith(".oreel"))!;
    const saved = JSON.parse(fs.readFileSync(path.join(projectFolder, projectFile), "utf8"));
    expect(saved.mediaLibrary.items.map((m: any) => m.name).sort()).toEqual(["broll-b.mov", "interview-a.mov"]);
    for (const item of saved.mediaLibrary.items) {
      expect(item.sourceFile.path.startsWith(projectFolder)).toBe(true);
      expect(item.nativeSource.codec).toBe("prores");
    }
    expect(saved.id).not.toBe(await E(page, "h.project.getState().project.id"));

    // ---- open the new project through the dialog's button ----
    await stubDialogs(app, { save: path.join(work, "original.oreel"), folder: destRoot });
    await dialog.getByRole("button", { name: "Open new project" }).click();
    await page.waitForFunction((id: string) => (window as any).__openreelE2E.project.getState().project.id === id, saved.id, { timeout: 60_000 });
    await page.waitForFunction(() => {
      const items = (window as any).__openreelE2E.project.getState().project.mediaLibrary.items;
      return items.length === 2 && items.every((m: any) => !m.isPlaceholder);
    }, undefined, { timeout: 90_000 });
    const opened = await E(page, `h.project.getState().project.mediaLibrary.items.map((m) => ({ name: m.name, placeholder: Boolean(m.isPlaceholder), path: m.nativeSource?.path }))`);
    expect(opened.every((m: any) => !m.placeholder && m.path.startsWith(projectFolder))).toBe(true);

    // ---- the frames ----
    const newClips: ClipInfo[] = await E(page, `h.project.getState().project.timeline.tracks.flatMap((t) => t.clips).map((c) => ({ id: c.id, mediaId: c.mediaId, startTime: c.startTime, duration: c.duration, inPoint: c.inPoint, outPoint: c.outPoint, speed: c.speed }))`);
    expect(newClips.map((c) => [c.startTime, c.duration, c.speed]).sort()).toEqual(clips.map((c) => [c.startTime, c.duration, c.speed]).sort());
    expect(newClips.some((c) => c.inPoint !== clips.find((o) => o.id === c.id)?.inPoint)).toBe(true); // in points were rewritten
    for (const p of probes) {
      const original = originalFrames.get(p.time)!;
      const ref = p.mediaFile ? referenceThumb(p.mediaFile, p.srcTime) : null;
      const shown = await showsFrame(page, p.time, ref, "consolidated", original);
      expect(meanAbsDiff(shown, original), `timeline ${p.time}s: consolidated project vs original`).toBeLessThan(SAME_FRAME);
    }
    // Different positions show different pictures (a frozen monitor cannot pass).
    const [first, , , , , , , last] = probes.map((p) => originalFrames.get(p.time)!);
    expect(meanAbsDiff(first, last)).toBeGreaterThan(MATCH);
  }, 600_000);
});
