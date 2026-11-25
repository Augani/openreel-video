import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickClip, clipsOf, openEditor, press, readState, seek, settle } from "./helpers";
import { selectTransition, transitionsOf } from "./custom-transitions-lib";
import { E2E_FFMPEG } from "./env";

/**
 * Morph Cut end to end in the real editor: cut a clip (a jump cut inside one shot), apply the Morph Cut card to
 * the cut, wait for the background analysis, scrub through the transition and export it. Shared by the gpu
 * project (WebGPU compute when the machine has an adapter) and the fallback projects (CPU reference).
 *  - the card is in the transitions panel and applies to the selected cut;
 *  - the status shows "Analysing in background" and then the finished analysis on the transition's inspector;
 *  - the preview engine and the export-mode engine render the SAME pixels at every frame of the span;
 *  - the morph differs from the cross dissolve it replaces, and the exported file matches the preview;
 *  - a cut between unrelated scenes reports "could not align" and stays a cross dissolve.
 */
const MP4_SMALL = { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 4000 };
const workDir = mkdtempSync(join(tmpdir(), "openreel-morph-cut-"));
const FRAMES = 20;

interface Hook {
  project: { getState(): Record<string, any> };
  exportQueue: { getState(): Record<string, any> };
  video: { getVideoEngine(): { exportMode: boolean; renderFrame(project: unknown, t: number, w: number, h: number): Promise<{ image: ImageBitmap }> } };
  core: { morphCutRegistry: { getMorphCutRegistry(): Registry }; morphCutRender: { morphRenderStats: Record<string, number> } };
}
interface Registry {
  getState(id: string): { status: string; progress: number; message: string; key?: string; analysisMs?: number; backend?: string; confidence?: number };
  deactivate(id: string): void;
  activate(id: string, key: string): void;
}

const hook = (page: Page) => page;

async function splitAt(page: Page, seconds: number): Promise<void> {
  await seek(page, seconds);
  const s = await readState(page);
  const clip = clipsOf(s, "Main").find((c) => c.start <= s.playhead + 1e-6 && s.playhead < c.start + c.duration - 1e-6);
  if (!clip) throw new Error("no clip under the playhead");
  await clickClip(page, clip.id);
  await press(page, "s");
}

/** Cut a jump out of the first scene: keep [0, from] and [to, end], so the cut joins two moments of one shot. */
export async function makeJumpCut(page: Page, from: number, to: number): Promise<{ clipAId: string; clipBId: string; cut: number }> {
  await splitAt(page, from);
  await splitAt(page, to);
  await expect.poll(async () => clipsOf(await readState(page), "Main").length).toBe(3);
  const clips = clipsOf(await readState(page), "Main").sort((a, b) => a.start - b.start);
  const middle = clips[1]!;
  const ok = await page.evaluate(async (id) => (await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().rippleDeleteClips([id])).success as boolean, middle.id);
  expect(ok).toBe(true);
  await expect.poll(async () => clipsOf(await readState(page), "Main").length).toBe(2);
  const [a, b] = clipsOf(await readState(page), "Main").sort((x, y) => x.start - y.start);
  return { clipAId: a!.id, clipBId: b!.id, cut: a!.start + a!.duration };
}

export async function applyMorphCutCard(page: Page, clipAId: string): Promise<string> {
  await clickClip(page, clipAId);
  await page.getByRole("button", { name: "Transitions", exact: true }).first().click();
  await settle(page, 600);
  await page.getByRole("group", { name: "Transition categories" }).getByRole("button", { name: "Dissolve", exact: true }).click();
  const card = page.locator('button[aria-label^="Morph Cut. Drag"]').first();
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  // an honest card: it says it needs analysis rather than pretending a morph is previewable
  await expect(card).toContainText(/Needs analysis/);
  await card.dblclick();
  await expect.poll(async () => (await transitionsOf(page)).length, { timeout: 15_000 }).toBe(1);
  const [transition] = await transitionsOf(page);
  expect(transition).toMatchObject({ type: "morphCut", clipAId });
  return transition!.id;
}

async function stateOf(page: Page, id: string) {
  return page.evaluate((transitionId) => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.core.morphCutRegistry.getMorphCutRegistry().getState(transitionId), id);
}

export async function waitForAnalysis(page: Page, id: string, timeout = 240_000) {
  const seen = new Set<string>();
  const deadline = Date.now() + timeout;
  for (;;) {
    const state = await stateOf(page, id);
    seen.add(state.status);
    if (state.status === "ready" || state.status === "failed") return { state, seen };
    if (Date.now() > deadline) throw new Error(`analysis of ${id} did not finish: ${JSON.stringify(state)}`);
    await page.waitForTimeout(100);
  }
}

type Matrix = "bt709" | "bt601";
export function lumaOf(rgba: ArrayLike<number>, matrix: Matrix = "bt709", fullRange = false): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  const [kr, kg, kb] = matrix === "bt709" ? [0.2126, 0.7152, 0.0722] : [0.299, 0.587, 0.114];
  for (let i = 0; i < out.length; i++) {
    const y = kr * rgba[i * 4] + kg * rgba[i * 4 + 1] + kb * rgba[i * 4 + 2];
    out[i] = Math.round(fullRange ? y : 16 + (219 * y) / 255);
  }
  return out;
}
export function psnr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let se = 0;
  for (let i = 0; i < a.length; i++) se += (a[i] - b[i]) ** 2;
  return se === 0 ? Infinity : 10 * Math.log10((255 * 255) / (se / a.length));
}

async function waitDone(page: Page, id: string, timeout = 600_000): Promise<string> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const j = await page.evaluate((jobId) => {
      const x = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.exportQueue.getState().queue.jobs.find((y: Record<string, any>) => y.id === jobId);
      return x ? { status: x.status as string, outputName: x.outputName as string, error: x.error as string | undefined } : null;
    }, id);
    if (!j) throw new Error(`no job ${id}`);
    if (j.status === "completed") return j.outputName;
    if (j.status === "failed" || j.status === "cancelled") throw new Error(`job ${id} ${j.status}: ${j.error}`);
    if (Date.now() > deadline) throw new Error(`job ${id} did not finish`);
    await page.waitForTimeout(300);
  }
}

/** Frames at `times`, rendered by the preview engine and by the export-mode engine (same renderer, two modes). */
export async function renderBoth(page: Page, times: number[]) {
  return captureFrames(page, times, false);
}

/** Send packed RGBA bytes across Playwright, which otherwise serializes every channel as a separate JS number. */
async function captureFrames(page: Page, times: number[], dissolve: boolean) {
  const frames = await page.evaluate(async ({ list, dissolve }) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const engine = h.video.getVideoEngine();
    const current = h.project.getState().project;
    const project = dissolve ? {
      ...current,
      timeline: {
        ...current.timeline,
        tracks: current.timeline.tracks.map((track: any) => ({
          ...track,
          transitions: track.transitions.map((transition: any) => ({
            ...transition, type: "crossfade", params: { ...transition.params, curve: "linear" },
          })),
        })),
      },
    } : current;
    const canvas = new OffscreenCanvas(640, 360);
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    async function render(t: number, exporting: boolean) {
      engine.exportMode = exporting;
      try {
        const { image } = await engine.renderFrame(project, t, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      } finally {
        engine.exportMode = false;
      }
    }
    const result = [];
    for (const t of list) {
      const preview = await render(t, false);
      const exported = dissolve ? preview : await render(t, true);
      const identical = preview.every((value, i) => value === exported[i]);
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]!);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob([preview]));
      });
      result.push({ t, encoded, identical });
    }
    return result;
  }, { list: times, dissolve });
  return frames.map(({ t, encoded, identical }) => ({ t, preview: Buffer.from(encoded, "base64"), identical }));
}

/** Names every navigation, crash and page error in the log: a reload under the test must be visible, not a mystery. */
function watchPage(page: Page): void {
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) console.log(`[morph-cut e2e] navigated: ${frame.url()}`);
  });
  page.on("crash", () => console.log("[morph-cut e2e] PAGE CRASHED"));
  page.on("pageerror", (e) => console.log(`[morph-cut e2e] pageerror: ${e.message.slice(0, 300)}`));
  page.on("console", (m) => {
    if (m.type() === "error" || /MorphCut|Morph Cut|optimized/i.test(m.text())) console.log(`[morph-cut e2e] console.${m.type()}: ${m.text().slice(0, 300)}`);
  });
}

/** The same frames with the transition swapped for a plain cross dissolve (same duration and alignment). */
async function renderDissolveFrames(page: Page, times: number[]) {
  return (await captureFrames(page, times, true)).map((frame) => frame.preview);
}

export function registerMorphCutTests(expectCpu: boolean): void {
  test("Morph Cut: jump cut, analysis in the background, scrub, preview/export parity and export", async ({ page }, testInfo) => {
    testInfo.setTimeout(1_200_000);
    watchPage(page);
    await openEditor(page);
    const cut = await makeJumpCut(page, 0.9, 1.3);
    const id = await applyMorphCutCard(page, cut.clipAId);
    const [transition] = await transitionsOf(page);
    console.log(`[morph-cut e2e] transition ${transition!.type} duration ${transition!.duration}s at cut ${cut.cut.toFixed(3)}s`);

    // Inspector: status wording while it analyses, then the result
    await selectTransition(page, id);
    const statusLine = page.getByTestId("morph-cut-status");
    await expect(statusLine).toBeVisible();
    const { state, seen } = await waitForAnalysis(page, id);
    console.log(`[morph-cut e2e] ${testInfo.project.name}: analysis ${JSON.stringify(state)} states seen ${[...seen].join(",")}`);
    expect(state.status, `analysis finished as ${JSON.stringify(state)}`).toBe("ready");
    expect(state.backend).toBe(expectCpu ? "cpu" : state.backend);
    await expect(statusLine).toHaveAttribute("data-status", "ready");
    await expect(statusLine).toContainText("Analysed");

    // Scrub through the span; preview engine == export-mode engine at every frame
    const half = transition!.duration / 2;
    const start = Math.max(0, Math.round((cut.cut - half) * 30) / 30 - 0.1);
    const times = Array.from({ length: FRAMES }, (_, k) => start + k / 30);
    const frames = await renderBoth(page, times);
    const mismatched = frames.filter((f) => !f.identical).map((f) => f.t.toFixed(3));
    console.log(`[morph-cut e2e] preview vs export-mode engine: ${frames.length - mismatched.length}/${frames.length} frames bit-identical`);
    expect(mismatched, "preview and export-mode renders agree at every frame of the span").toEqual([]);
    const stats = await page.evaluate(() => ({ ...(window as unknown as { __openreelE2E: Hook }).__openreelE2E.core.morphCutRender.morphRenderStats }));
    console.log(`[morph-cut e2e] ${testInfo.project.name}: morph frames ${JSON.stringify(stats)}`);
    expect(stats.gpuFrames + stats.cpuFrames, "frames inside the span were rendered by the morph").toBeGreaterThan(0);
    if (expectCpu) expect(stats.gpuFrames).toBe(0);

    // The morph is not the dissolve it replaces: the same frames with a plain cross dissolve differ
    const dissolveAll = await renderDissolveFrames(page, times);
    const diffs = frames.map((f, k) => psnr(lumaOf(dissolveAll[k]!), lumaOf(f.preview)));
    console.log(`[morph-cut e2e] preview morph vs preview cross dissolve per-frame PSNR: ${diffs.map((v) => v.toFixed(1)).join(" ")}`);
    expect(Math.min(...diffs), "inside the span the morph is a different picture from the cross dissolve").toBeLessThan(35);

    // Export the span through the queue and compare with the preview frames
    const exportId = await page.evaluate(([settings, from, count]) => {
      const q = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.exportQueue.getState();
      const job = q.enqueue({ settings: { ...settings, range: { startTime: from, endTime: (from as number) + (count as number) / 30 } }, presetLabel: "Morph Cut" });
      if (!job) throw new Error("enqueue returned null");
      q.start();
      return job.id as string;
    }, [MP4_SMALL, start, FRAMES] as const);
    const outputName = await waitDone(page, exportId);
    const panel = page.getByTestId("export-queue-panel");
    if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: `Download ${outputName}` }).click()]);
    const file = join(workDir, `morph-cut-${testInfo.project.name}.mp4`);
    await download.saveAs(file);
    const W = 640;
    const H = 360;
    const raw = execFileSync(E2E_FFMPEG, ["-v", "error", "-i", file, "-an", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"], { maxBuffer: 256 * 1024 * 1024 });
    const frameBytes = (W * H * 3) / 2;
    const exported: Buffer[] = [];
    for (let off = 0; off + frameBytes <= raw.length; off += frameBytes) exported.push(raw.subarray(off, off + W * H));
    expect(exported.length).toBeGreaterThanOrEqual(FRAMES - 1);
    const variants = [["bt709", false], ["bt601", false], ["bt709", true], ["bt601", true]] as const;
    const scores = variants.map(([m, full]) => {
      const own = [];
      for (let k = 0; k < Math.min(FRAMES, exported.length); k++) own.push(psnr(exported[k]!, lumaOf(frames[k]!.preview, m, full)));
      return own;
    });
    const best = scores.reduce((bi, s, i) => (s.reduce((a, b) => a + b, 0) > scores[bi]!.reduce((a, b) => a + b, 0) ? i : bi), 0);
    const own = scores[best]!;
    console.log(`[morph-cut e2e] export vs preview per-frame PSNR: ${own.map((v) => v.toFixed(1)).join(" ")} (min ${Math.min(...own).toFixed(2)} dB)`);
    const dissolveFrames = await renderDissolveFrames(page, times);
    const vsDissolve = dissolveFrames.map((f, k) => psnr(exported[k]!, lumaOf(f, variants[best]![0], variants[best]![1])));
    console.log(`[morph-cut e2e] export vs cross-dissolve render per-frame PSNR: ${vsDissolve.map((v) => v.toFixed(1)).join(" ")}`);
    const previewVsDissolve = dissolveFrames.map((f, k) => psnr(lumaOf(f), lumaOf(frames[k]!.preview)));
    console.log(`[morph-cut e2e] preview morph vs preview dissolve per-frame PSNR: ${previewVsDissolve.map((v) => v.toFixed(1)).join(" ")} (times ${times.map((t) => t.toFixed(3)).join(" ")})`);
    expect(Math.min(...own), "every exported frame of the span matches the preview frame at the same time").toBeGreaterThan(28);
  });

  test("Morph Cut: shots that are too different report it and stay a cross dissolve", async ({ page }, testInfo) => {
    testInfo.setTimeout(600_000);
    watchPage(page);
    await openEditor(page);
    // a cut from the test pattern (scene 1) to the solid red scene (scene 2): two unrelated pictures
    const jump = await makeJumpCut(page, 1.0, 3.0);
    const a = { id: jump.clipAId };
    const id = await applyMorphCutCard(page, a.id);
    await selectTransition(page, id);
    const { state } = await waitForAnalysis(page, id);
    console.log(`[morph-cut e2e] ${testInfo.project.name}: unrelated shots -> ${JSON.stringify(state)}`);
    expect(state.status).toBe("failed");
    expect(state.message).toBe("Morph Cut could not align these shots");
    const statusLine = page.getByTestId("morph-cut-status");
    await expect(statusLine).toHaveAttribute("data-status", "failed");
    await expect(statusLine).toContainText("Morph Cut could not align these shots");
    await expect(statusLine).toContainText("cross dissolve");
    await seek(page, jump.cut);
    await settle(page, 800);
    const [transition] = await transitionsOf(page);
    const frames = await renderBoth(page, [jump.cut - transition!.duration / 4, jump.cut, jump.cut + transition!.duration / 4]);
    expect(frames.every((f) => f.identical)).toBe(true);
    const stats = await page.evaluate(() => ({ ...(window as unknown as { __openreelE2E: Hook }).__openreelE2E.core.morphCutRender.morphRenderStats }));
    expect(stats.gpuFrames + stats.cpuFrames, "a failed analysis never renders a warp").toBe(0);
    void hook;
  });
}
