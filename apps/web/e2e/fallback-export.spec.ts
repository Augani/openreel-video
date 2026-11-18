import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  clickClip,
  clipsOf,
  openEditor,
  readState,
  seek,
  settle,
} from "./helpers";
import { launchGpuBrowserIfAvailable } from "./env";
import { meanAbsDiff } from "./sweep-lib";

// Export without WebGPU: the four effects that used to be missing from the
// fallback look (Glow, Vignette, Sharpen, Film grain) plus Drop Shadow must be
// baked into the exported file. A frame is pulled out of every exported MP4
// with ffmpeg and compared with an un-effected export and with the same export
// from a WebGPU-enabled Chrome.

const CARD_SUFFIX = ". Drag onto a clip to apply, or double-click to apply to selected clip.";
const EFFECTS = ["Glow", "Vignette", "Sharpen", "Film grain", "Drop Shadow"] as const;
const W = 320;
const H = 180;

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name !== "fallback-nowebgpu") return;
  await page.addInitScript(() => {
    try {
      delete (Navigator.prototype as unknown as { gpu?: unknown }).gpu;
    } catch {
      /* requestAdapter() is still null */
    }
  });
});

/** Open a fresh editor, optionally apply one effect card, export, return the mp4 path. */
async function exportWith(
  newPage: () => Promise<Page>,
  effect: string | null,
  outPath: string,
): Promise<void> {
  const page = await newPage(); // fresh context: one project per export
  try {
    await exportInPage(page, effect, outPath);
  } finally {
    await page.context().close();
  }
}

async function exportInPage(page: Page, effect: string | null, outPath: string): Promise<void> {
  await openEditor(page);
  // Export at the fixture's own 640x360 rather than the 1080p project default: the frame under test is
  // scaled to 320x180 anyway, and a CPU-only runner rasterises and encodes 9x fewer pixels (12 exports
  // per project took ~20 minutes at 1080p).
  await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E;
    const st = h.project.getState().project.settings;
    if (st.width !== 640 || st.height !== 360) await h.project.getState().updateSettings({ width: 640, height: 360 });
  });
  if (effect) {
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await settle(page, 800);
    const card = page.locator(`button[aria-label="${effect}${CARD_SUFFIX}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.dblclick();
    await settle(page, 1200);
    expect(clipsOf(await readState(page), "Main")[0].effects).toBe(1);
  }
  await seek(page, 0);
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await settle(page, 1500);
  const download = page.waitForEvent("download", { timeout: 480_000 });
  await page.getByRole("button", { name: "Export Video" }).last().click();
  await (await download).saveAs(outPath);
}

/** RGB of one frame (t seconds in) scaled to W x H. */
function frameOf(mp4: string, t: number): number[] {
  const buf = execFileSync(
    "ffmpeg",
    ["-v", "error", "-ss", String(t), "-i", mp4, "-frames:v", "1", "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  expect(buf.length, `frame decoded from ${mp4}`).toBe(W * H * 3);
  return Array.from(buf);
}

test("export without WebGPU bakes Glow, Vignette, Sharpen, Film grain and Drop Shadow into the file", async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(1_500_000);
  const probe = await page.goto("/").then(() =>
    page.evaluate(async () => {
      const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      return gpu ? await gpu.requestAdapter() : null;
    }),
  );
  expect(probe, "no WebGPU adapter in the fallback browser").toBeNull();

  const t = 1.0; // testsrc2 scene, plenty of detail for sharpen / grain / glow
  const removeGpu = testInfo.project.name === "fallback-nowebgpu";
  const newFallbackPage = async (): Promise<Page> => {
    const ctx = await page.context().browser()!.newContext({
      baseURL: baseURL ?? undefined,
      viewport: { width: 1600, height: 900 },
      acceptDownloads: true,
    });
    const p = await ctx.newPage();
    if (removeGpu) {
      await p.addInitScript(() => {
        try {
          delete (Navigator.prototype as unknown as { gpu?: unknown }).gpu;
        } catch {
          /* requestAdapter() is still null */
        }
      });
    }
    return p;
  };
  const baseFile = testInfo.outputPath("fb-baseline.mp4");
  await exportWith(newFallbackPage, null, baseFile);
  const base = frameOf(baseFile, t);

  const fb: Record<string, number[]> = {};
  for (const effect of EFFECTS) {
    const file = testInfo.outputPath(`fb-${effect.replace(/\W+/g, "_")}.mp4`);
    await exportWith(newFallbackPage, effect, file);
    fb[effect] = frameOf(file, t);
  }

  // GPU-vs-fallback comparison is informational; skipped (annotated) on
  // machines without a WebGPU adapter such as GPU-less CI runners.
  const gpu: Record<string, number[]> = {};
  let gpuBase: number[] | null = null;
  const gpuBrowser = await launchGpuBrowserIfAvailable(baseURL ?? undefined);
  if (!gpuBrowser) {
    testInfo.annotations.push({
      type: "skipped-comparison",
      description: "no WebGPU adapter on this machine: GPU-vs-fallback export comparison not run",
    });
  } else {
    const browser = gpuBrowser;
    try {
      const newGpuPage = async (): Promise<Page> => {
        const ctx = await browser.newContext({
          baseURL: baseURL ?? undefined,
          viewport: { width: 1600, height: 900 },
          acceptDownloads: true,
        });
        return ctx.newPage();
      };
      const baseG = testInfo.outputPath("gpu-baseline.mp4");
      await exportWith(newGpuPage, null, baseG);
      gpuBase = frameOf(baseG, t);
      for (const effect of EFFECTS) {
        const file = testInfo.outputPath(`gpu-${effect.replace(/\W+/g, "_")}.mp4`);
        await exportWith(newGpuPage, effect, file);
        gpu[effect] = frameOf(file, t);
      }
    } finally {
      await browser.close();
    }
  }

  const lines: string[] = [`baselineGpuVsFallback MAD=${gpuBase ? meanAbsDiff(base, gpuBase).toFixed(3) : "n/a"}`];
  const failures: string[] = [];
  const out: Record<string, { vsBaseline: number; gpuVsFallback: number }> = {};
  for (const effect of EFFECTS) {
    const vsBase = meanAbsDiff(fb[effect], base);
    const vsGpu = gpu[effect] ? meanAbsDiff(fb[effect], gpu[effect]) : NaN;
    out[effect] = { vsBaseline: vsBase, gpuVsFallback: vsGpu };
    lines.push(`${effect.padEnd(14)} fallbackVsUnaffectedExport MAD=${vsBase.toFixed(3)} gpuVsFallbackExport MAD=${vsGpu.toFixed(3)}`);
    if (vsBase < 0.2) failures.push(`${effect}: exported frame is not visibly different from the un-effected export (MAD ${vsBase.toFixed(3)})`);
  }
  writeFileSync(testInfo.outputPath("export-compare.json"), JSON.stringify(out, null, 2));
  console.log(`\n[${testInfo.project.name}] export\n${lines.join("\n")}`);
  expect(failures, failures.join("\n")).toEqual([]);
});
