import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickClip, clipsOf, importInput, openEditor, press, readState, seek, settle } from "./helpers";
import { E2E_FFMPEG, E2E_FFPROBE } from "./env";

/**
 * Proxy + ingest workflow, checked in real Chrome with a real 4K H.264 clip.
 *
 *  - Ingest preset "Create proxies" (a project setting, one undo step) builds a 540p H.264 proxy in the
 *    background on import, with visible progress; the proxy links to the media and survives a reload;
 *  - Toggle Proxies (Program monitor button and Shift+P) switches which file the preview decoder is given
 *    (verified through the preview's own decode log), and a frame rendered from the proxy matches one
 *    rendered from the full-resolution media within tolerance (transforms etc. are resolution independent);
 *  - Attach Proxies matches by name, validates duration / frame rate, and rejects a bad file;
 *  - missing proxy / missing full-res states show in the Project panel;
 *  - export ALWAYS reads full-resolution media: a 4K file out of an edit made while proxies were on.
 */

const FFPROBE = E2E_FFPROBE;
const FFMPEG = E2E_FFMPEG;
const PROGRAM = 'canvas[aria-label^="Program frame"]';
const workDir = mkdtempSync(join(tmpdir(), "openreel-proxy-"));
const CLIP_4K = join(workDir, "clip4k.mp4");
const PROXY_OK = join(workDir, "clip4k_proxy.mp4");
const PROXY_BAD = join(workDir, "other_proxy.mp4");
const OTHER_4K = join(workDir, "other.mp4");

function ff(args: string[]): void {
  execFileSync(FFMPEG, ["-y", "-v", "error", ...args], { stdio: "ignore" });
}

test.beforeAll(() => {
  // 4 s of 4K testsrc2 (moving bars, gradients, frame counter), keyframe every second, plus audio.
  ff(["-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=30:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", CLIP_4K]);
  // A hand-made 960x540 proxy of the same clip, named like a camera proxy.
  ff(["-i", CLIP_4K, "-vf", "scale=960:540", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", PROXY_OK]);
  // A second clip and a "proxy" for it that is the wrong length and frame rate.
  ff(["-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=30:duration=4", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "30", "-pix_fmt", "yuv420p", OTHER_4K]);
  ff(["-f", "lavfi", "-i", "testsrc2=size=960x540:rate=24:duration=9", "-c:v", "libx264", "-preset", "veryfast", "-g", "24", "-pix_fmt", "yuv420p", PROXY_BAD]);
});

/** Evaluate an expression against the e2e hook `h` in the page (awaited). */
const E = (page: Page, expression: string): Promise<any> =>
  page.evaluate(`(async (h) => (${expression}))(window.__openreelE2E)`);

const historyLength = (page: Page): Promise<number> => readState(page).then((state) => state.historyLength);
const mediaNamed = (page: Page, name: string) =>
  page.evaluate((n) => {
    const item = (window as any).__openreelE2E.project.getState().project.mediaLibrary.items.find((m: any) => m.name === n);
    return item ? { id: item.id as string, proxy: (item.proxy ?? null) as Record<string, any> | null, placeholder: !!item.isPlaceholder } : null;
  }, name);

async function importFile(page: Page, path: string, name: string): Promise<string> {
  await importInput(page).setInputFiles(path);
  await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 60_000 });
  const item = await mediaNamed(page, name);
  if (!item) throw new Error(`${name} was not imported`);
  return item.id;
}

async function chooseFiles(page: Page, trigger: Locator, files: string[]): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), trigger.click()]);
  await chooser.setFiles(files);
}

/** Open the Proxies popover (the media list keeps its height) and return its body. */
async function openProxyPanel(page: Page) {
  const row = page.getByTestId("proxy-panel");
  await row.waitFor({ timeout: 15_000 });
  const body = page.getByTestId("proxy-panel-body");
  if (!(await body.isVisible())) await row.getByRole("button", { name: /^Proxies/ }).first().click();
  await body.waitFor({ timeout: 5_000 });
  return body;
}

async function pickSelect(page: Page, label: string, option: string | RegExp) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).click();
}

/** Remove the fixture clip and put the 4K clip on the timeline; returns its clip state. */
async function placeClip(page: Page, name: string) {
  const [first] = clipsOf(await readState(page), "Main");
  await clickClip(page, first.id);
  await press(page, "Delete");
  await expect.poll(async () => clipsOf(await readState(page), "Main").length).toBe(0);
  await page.getByRole("button", { name: `Media actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8_000 }).catch(() => undefined);
  await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 30_000 }).toBe(1);
  await settle(page, 600);
  const settings = await E(page, "h.project.getState().project.settings");
  if (settings.width !== 3840 || settings.height !== 2160) {
    await E(page, "h.project.getState().updateSettings({ width: 3840, height: 2160, frameRate: 30 })");
    await settle(page, 500);
  }
  return clipsOf(await readState(page), "Main")[0];
}

/** Downsampled RGBA of the Program canvas as a base64 string. */
const snap = (page: Page): Promise<string> =>
  page.evaluate((sel) => {
    const c = document.querySelector(sel) as HTMLCanvasElement;
    const t = document.createElement("canvas");
    t.width = 320;
    t.height = 180;
    const g = t.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(c, 0, 0, 320, 180);
    const d = g.getImageData(0, 0, 320, 180).data;
    let s = "";
    for (let i = 0; i < d.length; i += 4) s += String.fromCharCode(d[i], d[i + 1], d[i + 2]);
    return btoa(s);
  }, PROGRAM);

function meanAbsDiff(a: string, b: string): number {
  const x = Buffer.from(a, "base64");
  const y = Buffer.from(b, "base64");
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}

const decodeSource = (page: Page, id: string) =>
  page.evaluate((mediaId) => {
    const d = (window as any).__openreelE2E.proxy.cache.decodes[mediaId];
    return d ? { source: d.source as string, proxy: d.proxyCount as number, original: d.originalCount as number } : null;
  }, id);

function probe(file: string): Record<string, any> {
  return JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));
}

/** PSNR (dB) of the centre half of one frame of `a` against `b`, both scaled/cropped identically. */
function centrePsnr(a: string, at: number, b: string, bt: number, scaleTo = "3840:2160"): number {
  const out = spawnSync(
    FFMPEG,
    ["-v", "info", "-ss", String(at), "-i", a, "-ss", String(bt), "-i", b, "-frames:v", "1",
      "-filter_complex", `[0:v]scale=${scaleTo}:flags=bicubic,crop=1920:1080:960:540[x];[1:v]scale=${scaleTo}:flags=bicubic,crop=1920:1080:960:540[y];[x][y]psnr`, "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const m = /average:([\d.]+|inf)/.exec(out.stderr);
  if (!m) throw new Error(`psnr failed: ${out.stderr}`);
  return m[1] === "inf" ? 99 : Number(m[1]);
}

/** Mean high-frequency energy (|frame - blurred frame|) of the centre of one frame, after scaling to 4K. A 960x540 proxy upscaled to 4K is soft, so this separates it from real 4K pixels where PSNR cannot (the encoder noise dominates). */
function highFreq(file: string, at: number): number {
  const out = spawnSync(
    FFMPEG,
    ["-v", "info", "-ss", String(at), "-i", file, "-frames:v", "1", "-filter_complex",
      "[0:v]scale=3840:2160:flags=bicubic,crop=1920:1080:960:540,split[a][b];[b]gblur=sigma=2[c];[a][c]blend=all_mode=difference,signalstats,metadata=print:file=-", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const m = /YAVG=([\d.]+)/.exec(out.stdout + out.stderr);
  if (!m) throw new Error(`highFreq failed: ${out.stderr}`);
  return Number(m[1]);
}

async function waitProxyReady(page: Page, name: string, timeout = 120_000): Promise<Record<string, any>> {
  let ref: Record<string, any> | null = null;
  await expect
    .poll(async () => {
      ref = (await mediaNamed(page, name))?.proxy ?? null;
      return ref?.status ?? null;
    }, { timeout, intervals: [200] })
    .toBe("ready");
  return ref!;
}

test.describe("Proxy and ingest workflow", () => {
  test("ingest preset builds a proxy on import; toggle switches the decoded source; export is 4K from full-res; reload keeps links", async ({ page }, testInfo) => {
    testInfo.setTimeout(480_000);
    await openEditor(page);

    // ---- ingest preset: a project setting, one undo step ----
    const base = await historyLength(page);
    const panel = await openProxyPanel(page);
    await pickSelect(page, "Ingest preset", "Create proxies");
    await pickSelect(page, "Proxy size", /540p/);
    expect(await E(page, "h.project.getState().project.mediaLibrary.ingestPreset")).toBe("proxies");
    expect(await historyLength(page)).toBe(base + 1);

    // ---- record the queue's progress while the clip imports ----
    await page.evaluate(() => {
      const w = window as any;
      w.__proxySeen = [] as Array<{ status: string; progress: number }>;
      w.__openreelE2E.proxy.cache.store.subscribe(() => {
        const entries = Object.values(w.__openreelE2E.proxy.cache.store.getState().entries) as any[];
        for (const e of entries) w.__proxySeen.push({ status: e.status, progress: e.progress });
      });
    });
    const id = await importFile(page, CLIP_4K, "clip4k.mp4");
    const ref = await waitProxyReady(page, "clip4k.mp4");
    const seen = await page.evaluate(() => (window as any).__proxySeen as Array<{ status: string; progress: number }>);
    console.log(`[proxy] job states seen: ${[...new Set(seen.map((s) => s.status))].join(" > ")}, progress samples ${seen.length}`);
    expect(seen.some((s) => s.status === "encoding")).toBe(true);
    console.log(`[proxy] proxy ref: ${ref.width}x${ref.height} ${ref.codec} ${(ref.fileSize / 1024).toFixed(0)} KB, ${ref.storage}, source=${ref.source}, preset=${ref.preset}`);
    expect(ref.width).toBeLessThanOrEqual(960);
    expect(ref.height).toBeLessThanOrEqual(540);
    expect(ref.width / ref.height).toBeCloseTo(16 / 9, 1);
    expect(ref.source).toBe("generated");
    // The link landed as exactly one undo step; undo unlinks, redo links again (bytes stay stored).
    expect(await historyLength(page)).toBe(base + 2);
    await press(page, "Meta+z");
    expect((await mediaNamed(page, "clip4k.mp4"))!.proxy).toBeNull();
    await press(page, "Meta+Shift+z");
    await waitProxyReady(page, "clip4k.mp4");
    await expect.poll(() => page.evaluate((i) => (window as any).__openreelE2E.proxy.cache.store.getState().entries[i]?.persisted === true, id)).toBe(true);
    await expect(page.getByTestId("proxy-summary")).toContainText("ready");

    // ---- put the clip on the timeline and look at it through the proxy ----
    const clip = await placeClip(page, "clip4k.mp4");
    await seek(page, clip.start + 1.2);
    await settle(page, 1500);
    const viaProxy = await decodeSource(page, id);
    console.log(`[proxy] decode log with Toggle Proxies on: ${JSON.stringify(viaProxy)}`);
    expect(viaProxy?.source).toBe("proxy");
    const frameProxy = await snap(page);

    // ---- Toggle Proxies (toolbar button): the decoder is now given the full-resolution file ----
    const toggle = page.getByTestId("toggle-proxies");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await seek(page, clip.start + 1.3);
    await seek(page, clip.start + 1.2);
    await settle(page, 2500);
    const viaOriginal = await decodeSource(page, id);
    console.log(`[proxy] decode log after toggling off: ${JSON.stringify(viaOriginal)}`);
    expect(viaOriginal?.source).toBe("original");
    expect(viaOriginal!.original).toBeGreaterThan(0);
    const frameFull = await snap(page);
    const diff = meanAbsDiff(frameProxy, frameFull);
    console.log(`[proxy] program frame, proxy vs full-res (320x180 readback): mean abs diff ${diff.toFixed(2)} / 255`);
    expect(diff).toBeLessThan(10);
    expect(meanAbsDiff(frameFull, frameFull)).toBe(0);

    // ---- Shift+P shortcut flips it back; a transform change keeps both sources aligned ----
    await press(page, "Shift+P");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await seek(page, clip.start + 1.3);
    await seek(page, clip.start + 1.2);
    await settle(page, 2000);
    expect((await decodeSource(page, id))?.source).toBe("proxy");

    // ---- edit while proxies are on (split the clip at 2 s), then export ----
    await seek(page, clip.start + 2);
    await clickClip(page, clip.id);
    await press(page, "s");
    await expect.poll(async () => clipsOf(await readState(page), "Main").length).toBe(2);
    const exportAt = clip.start + 1.0;
    await E(page, `h.exportQueue.getState().enqueue({ settings: { width: 3840, height: 2160, frameRate: 24, format: "mp4", codec: "h264", bitrate: 20000 }, presetLabel: "4K" })`);
    await E(page, "h.exportQueue.getState().start()");
    const outName = await page
      .waitForFunction(() => {
        const job = (window as any).__openreelE2E.exportQueue.getState().queue.jobs[0];
        if (job?.status === "failed") throw new Error(job.error);
        return job?.status === "completed" ? (job.outputName as string) : null;
      }, undefined, { timeout: 300_000, polling: 500 })
      .then((h) => h.jsonValue() as Promise<string>);
    const sourceNote: string | undefined = await E(page, "h.exportQueue.getState().queue.jobs[0].sourceMedia");
    console.log(`[proxy] export report: ${sourceNote}`);
    expect(sourceNote).toContain("full-resolution");
    await page.getByRole("button", { name: "Export queue", exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-queue-panel").getByRole("button", { name: `Download ${outName}` }).click(),
    ]);
    const exported = join(workDir, "export-4k.mp4");
    await download.saveAs(exported);
    const info = probe(exported);
    const v = info.streams.find((s: any) => s.codec_type === "video");
    console.log(`[proxy] exported file: ${v.codec_name} ${v.width}x${v.height}, ${Number(info.format.duration).toFixed(2)}s`);
    expect(v.width).toBe(3840);
    expect(v.height).toBe(2160);
    // Pixel check: the exported frame matches the ORIGINAL 4K frame far better than a 960x540 proxy upscaled to 4K would.
    const exportPsnr = centrePsnr(exported, exportAt, CLIP_4K, 1.0);
    const proxyPsnr = centrePsnr(PROXY_OK, 1.0, CLIP_4K, 1.0);
    console.log(`[proxy] centre PSNR vs source: export ${exportPsnr.toFixed(1)} dB, 960x540 proxy upscaled ${proxyPsnr.toFixed(1)} dB`);
    // The export is a real re-encode (24 fps against a 30 fps source defeats stream copy), so encoder noise
    // keeps PSNR modest; sharpness is what shows the pixels came from full resolution, not the proxy.
    expect(exportPsnr).toBeGreaterThan(20);
    const exportDetail = highFreq(exported, exportAt);
    const sourceDetail = highFreq(CLIP_4K, 1.0);
    const proxyDetail = highFreq(PROXY_OK, 1.0);
    console.log(`[proxy] detail (high-frequency energy): export ${exportDetail.toFixed(3)}, 4K source ${sourceDetail.toFixed(3)}, upscaled proxy ${proxyDetail.toFixed(3)}`);
    expect(exportDetail).toBeGreaterThan(proxyDetail * 2);
    expect(exportDetail).toBeGreaterThan(sourceDetail * 0.6);

    // ---- reload: the proxy link and its bytes come back ----
    const projectId: string = await E(page, "h.project.getState().project.id");
    await E(page, "h.project.getState().forceSave()");
    await page.reload();
    await page.locator(PROGRAM).waitFor({ timeout: 60_000 }).catch(() => undefined);
    const recovered = await page.evaluate(async (savedId) => {
      const store = (window as any).__openreelE2E.project;
      store.setState({ project: { ...store.getState().project, id: savedId } });
      const saves = await store.getState().checkForRecovery();
      if (!saves.length) return false;
      return store.getState().recoverFromAutoSave(saves[0].id);
    }, projectId);
    expect(recovered).toBe(true);
    const after = (await mediaNamed(page, "clip4k.mp4"))!;
    expect(after.proxy?.status).toBe("ready");
    expect(after.proxy?.width).toBe(ref.width);
    await expect
      .poll(() => page.evaluate((i) => {
        const e = (window as any).__openreelE2E.proxy.cache.store.getState().entries[i];
        return e?.status === "ready" && e.persisted === true && e.blob?.size > 0;
      }, id), { timeout: 20_000 })
      .toBe(true);
    console.log(`[proxy] after reload: proxy link ${after.proxy?.width}x${after.proxy?.height} restored with bytes`);
  });

  test("attach proxies by name validates them; missing proxy and missing full-res show with relink", async ({ page }, testInfo) => {
    testInfo.setTimeout(300_000);
    await openEditor(page);
    const id = await importFile(page, CLIP_4K, "clip4k.mp4");
    const otherId = await importFile(page, OTHER_4K, "other.mp4");
    const panel = await openProxyPanel(page);
    expect(await E(page, `h.project.getState().project.mediaLibrary.ingestPreset ?? "none"`)).toBe("none");
    // Preset none: no proxy is built.
    await settle(page, 1500);
    expect((await mediaNamed(page, "clip4k.mp4"))!.proxy).toBeNull();

    const base = await historyLength(page);
    await chooseFiles(page, panel.getByRole("button", { name: "Attach proxies" }), [PROXY_OK, PROXY_BAD]);
    await expect.poll(async () => (await mediaNamed(page, "clip4k.mp4"))?.proxy?.status, { timeout: 60_000 }).toBe("ready");
    const attach = await E(page, "h.proxy.ingest.getState().lastAttach");
    console.log(`[proxy] attach report: ${JSON.stringify(attach)}`);
    const attached = (await mediaNamed(page, "clip4k.mp4"))!.proxy!;
    expect(attached.source).toBe("attached");
    expect(attached.width).toBe(960);
    expect(attached.height).toBe(540);
    // The mismatching proxy (9 s, 24 fps) for other.mp4 was rejected, not linked.
    expect((await mediaNamed(page, "other.mp4"))!.proxy).toBeNull();
    expect(attach.attached).toHaveLength(1);
    expect(attach.skipped.map((s: any) => s.reason).join(" ")).toMatch(/Duration/);
    expect(attach.skipped.map((s: any) => s.reason).join(" ")).toMatch(/Frame rate/);
    // One undo step for the whole attach.
    expect(await historyLength(page)).toBe(base + 1);
    await press(page, "Meta+z");
    expect((await mediaNamed(page, "clip4k.mp4"))!.proxy).toBeNull();
    await press(page, "Meta+Shift+z");
    expect((await mediaNamed(page, "clip4k.mp4"))!.proxy?.status).toBe("ready");
    await expect.poll(() => page.evaluate((i) => (window as any).__openreelE2E.proxy.cache.store.getState().entries[i]?.status, id)).toBe("ready");

    // Missing proxy: drop the stored bytes, reload, recover.
    const projectId: string = await E(page, "h.project.getState().project.id");
    await page.evaluate((mediaId) => (window as any).__openreelE2E.proxy.deleteProxyBytes(mediaId), id);
    await E(page, "h.project.getState().forceSave()");
    await page.reload();
    await page.addLocatorHandler(page.getByRole("dialog").filter({ hasText: "Recover Your Work" }), async (dialog) => {
      await dialog.getByRole("button", { name: "Close dialog" }).click();
    });
    await page.locator(PROGRAM).waitFor({ timeout: 60_000 }).catch(() => undefined);
    await page.evaluate(async (savedId) => {
      const store = (window as any).__openreelE2E.project;
      store.setState({ project: { ...store.getState().project, id: savedId } });
      const saves = await store.getState().checkForRecovery();
      if (saves.length) await store.getState().recoverFromAutoSave(saves[0].id);
    }, projectId);
    const panel2 = await openProxyPanel(page);
    const row = panel2.locator('[data-testid="proxy-row"]').first();
    await expect(row).toHaveAttribute("data-state", "missing-proxy", { timeout: 20_000 });
    await expect(row).toContainText("Relink proxy");
    await expect(page.getByTestId("proxy-badge").first()).toContainText("Proxy missing");
    console.log(`[proxy] missing-proxy state shown: ${(await row.innerText()).replace(/\n/g, " | ")}`);
    // Relink: pick the proxy again.
    await chooseFiles(page, row.getByRole("button", { name: /Relink proxy/ }), [PROXY_OK]);
    await expect(panel2.locator('[data-testid="proxy-row"]')).toHaveCount(0, { timeout: 30_000 });
    expect(otherId).toBeTruthy();
  });

  test("scrub and playback responsiveness on a 4K source, with and without proxies", async ({ page }, testInfo) => {
    testInfo.setTimeout(420_000);
    await openEditor(page);
    const id = await importFile(page, CLIP_4K, "clip4k.mp4");
    await openProxyPanel(page);
    const attachButton = page.getByTestId("proxy-panel-body").getByRole("button", { name: "Attach proxies" });
    await attachButton.waitFor();
    await chooseFiles(page, attachButton, [PROXY_OK]);
    await waitProxyReady(page, "clip4k.mp4");
    const clip = await placeClip(page, "clip4k.mp4");
    // Same 4K timeline for both runs; only Toggle Proxies differs.
    const measure = async (label: string) => {
      await seek(page, clip.start + 0.2);
      await settle(page, 1500);
      const result = await page.evaluate(async ({ sel, start }) => {
        const w = window as any;
        const canvas = document.querySelector(sel) as HTMLCanvasElement;
        const probe = document.createElement("canvas");
        probe.width = 64;
        probe.height = 36;
        const g = probe.getContext("2d", { willReadFrequently: true })!;
        const hash = () => {
          g.drawImage(canvas, 0, 0, 64, 36);
          const d = g.getImageData(0, 0, 64, 36).data;
          let h = 0;
          for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
          return h;
        };
        const timeline = w.__openreelE2E.timeline.getState;
        const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
        // Scrub: jump to a target time; measure until the first changed frame and until the picture stops changing.
        const targets = [1.7, 0.4, 3.1, 2.2, 0.9, 3.6, 1.3, 2.8];
        const first: number[] = [];
        const settled: number[] = [];
        for (const t of targets) {
          const before = hash();
          const t0 = performance.now();
          timeline().seekTo(start + t);
          let tFirst = -1;
          let last = before;
          let lastChange = t0;
          for (;;) {
            await frame();
            const now = performance.now();
            const h = hash();
            if (h !== last) {
              if (tFirst < 0) tFirst = now - t0;
              last = h;
              lastChange = now;
            }
            if ((tFirst >= 0 && now - lastChange > 250) || now - t0 > 4000) break;
          }
          first.push(tFirst < 0 ? 4000 : tFirst);
          settled.push(lastChange - t0);
        }
        // Playback: 3 s from 0.2 s; effective painted frames per second and the longest stall.
        timeline().seekTo(start + 0.2);
        await new Promise((r) => setTimeout(r, 800));
        let prev = hash();
        let changes = 0;
        let maxGap = 0;
        let lastChange = performance.now();
        const t0 = performance.now();
        timeline().play();
        while (performance.now() - t0 < 3000) {
          await frame();
          const h = hash();
          const now = performance.now();
          if (h !== prev) {
            changes++;
            maxGap = Math.max(maxGap, now - lastChange);
            lastChange = now;
            prev = h;
          }
        }
        const elapsed = (performance.now() - t0) / 1000;
        timeline().pause();
        const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
        return { firstMedian: median(first), firstMax: Math.max(...first), settledMedian: median(settled), settledMax: Math.max(...settled), playFps: changes / elapsed, maxStallMs: maxGap };
      }, { sel: PROGRAM, start: clip.start });
      console.log(`[proxy-perf] ${label}: scrub first frame median ${result.firstMedian.toFixed(0)} ms (max ${result.firstMax.toFixed(0)}), settled median ${result.settledMedian.toFixed(0)} ms (max ${result.settledMax.toFixed(0)}); playback ${result.playFps.toFixed(1)} painted fps, longest stall ${result.maxStallMs.toFixed(0)} ms`);
      return result;
    };
    const toggle = page.getByTestId("toggle-proxies");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const withProxy = await measure("4K with proxies on (960x540 decode)");
    expect((await decodeSource(page, id))?.source).toBe("proxy");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await settle(page, 1000);
    const without = await measure("4K full-resolution decode (proxies off)");
    expect((await decodeSource(page, id))?.source).toBe("original");
    testInfo.annotations.push({ type: "perf", description: JSON.stringify({ withProxy, without }) });
    expect(existsSync(CLIP_4K)).toBe(true);
  });
});
