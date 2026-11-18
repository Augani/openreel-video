import { chromium, type Browser, type LaunchOptions } from "@playwright/test";

/**
 * Browser channel for the whole suite. Local default is the installed Google
 * Chrome, and CI installs Chrome too (H.264/AAC codecs are needed for exports).
 * OPENREEL_E2E_CHANNEL=chromium selects Playwright's bundled Chromium instead
 * (`playwright install --with-deps chromium`).
 */
export const E2E_CHANNEL = process.env.OPENREEL_E2E_CHANNEL || "chrome";

/** Space separated override for the GPU-enabled launch flags. */
const GPU_OVERRIDE = process.env.OPENREEL_E2E_GPU_ARGS?.split(/\s+/).filter(Boolean);

const IS_MAC = process.platform === "darwin";

/**
 * Flags for a Chrome that should expose a WebGPU adapter. macOS has a real GPU
 * (ANGLE/Metal). Anywhere else (Linux CI runners have no GPU) use the
 * SwiftShader software Vulkan/GL stack, which may or may not yield a WebGPU
 * adapter; specs that need one probe for it and skip only that comparison.
 */
export const GPU_ARGS: string[] =
  GPU_OVERRIDE ??
  (IS_MAC
    ? ["--enable-gpu", "--use-angle=metal", "--enable-unsafe-webgpu"]
    : [
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan",
        "--use-angle=swiftshader",
        "--use-webgpu-adapter=swiftshader",
        "--ignore-gpu-blocklist",
        "--no-sandbox",
      ]);

/**
 * True when the "gpu" project runs on the SwiftShader software stack (Linux CI
 * runners have no GPU; OPENREEL_E2E_SOFTWARE_GPU=1 forces it when emulating that stack with
 * OPENREEL_E2E_GPU_ARGS on a Mac). Pixel-parity checks still apply there; real-time frame
 * budgets and anti-aliasing tolerances tuned on hardware GPUs do not.
 */
export const SOFTWARE_GPU =
  process.env.OPENREEL_E2E_SOFTWARE_GPU !== undefined
    ? process.env.OPENREEL_E2E_SOFTWARE_GPU === "1"
    : !GPU_OVERRIDE && !IS_MAC;

/** Flags for the "WebGPU switched off, WebGL still available" project. */
export const NOWEBGPU_ARGS: string[] = IS_MAC
  ? ["--enable-gpu", "--use-angle=metal", "--disable-features=WebGPU,WebGPUService"]
  : ["--use-angle=swiftshader", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-features=WebGPU,WebGPUService"];

/** Flags for the "no GPU at all" project. */
export const SOFTWARE_ARGS: string[] = [
  "--disable-gpu",
  "--disable-features=WebGPU,WebGPUService",
  ...(process.platform === "linux" ? ["--no-sandbox"] : []),
];

export const GPU_LAUNCH: LaunchOptions = { channel: E2E_CHANNEL, headless: true, args: GPU_ARGS };

/**
 * Launch a WebGPU-enabled browser for the GPU-vs-fallback comparisons, or
 * return null (after closing it) when this machine exposes no WebGPU adapter,
 * e.g. a GPU-less Linux CI runner. Only the comparison half of a spec may be
 * skipped on null; the fallback assertions always run.
 */
export async function launchGpuBrowserIfAvailable(baseURL: string | undefined): Promise<Browser | null> {
  const browser = await chromium.launch({ ...GPU_LAUNCH, timeout: 60_000 });
  try {
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    await page.goto("/", { timeout: 60_000 });
    // requestAdapter() can return null for a moment while many GPU clients start at once, and can also
    // never settle when the GPU process is starved: ask a few times, each bounded, before concluding
    // there is no adapter (an unbounded await here used to hold a test for its whole 15 minute timeout).
    let ok = false;
    for (let attempt = 0; attempt < 6 && !ok; attempt++) {
      ok = await page.evaluate(async () => {
        const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
        if (!gpu) return false;
        const adapter = await Promise.race([
          gpu.requestAdapter().catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
        ]);
        return adapter !== null;
      });
      if (!ok) await page.waitForTimeout(500);
    }
    await ctx.close();
    if (ok) return browser;
  } catch {
    /* fall through: treat a failed probe as "no adapter" */
  }
  await browser.close();
  return null;
}

/**
 * ffmpeg / ffprobe used by specs to generate fixtures and inspect exports.
 * Resolved from PATH (Homebrew on macOS, apt on Linux CI); override with
 * OPENREEL_FFMPEG / OPENREEL_FFPROBE.
 */
export const E2E_FFMPEG = process.env.OPENREEL_FFMPEG || "ffmpeg";
export const E2E_FFPROBE = process.env.OPENREEL_FFPROBE || "ffprobe";
