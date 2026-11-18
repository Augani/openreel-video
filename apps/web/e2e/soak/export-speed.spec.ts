import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { SOAK, installProbes, readManifest, writeOut } from "./soak-lib";
import { buildFeatureTimeline, importSources } from "./build-timeline";
import { SOFTWARE_GPU } from "../env";

/**
 * Export throughput on the long-GOP feature timeline: output-seconds per wall-second for a range
 * export, once from the editor and once as a retry-from-snapshot on a fresh welcome page after a
 * renderer crash. Both must be real-time-ish (generous floor, hardware gated) and the retry may not
 * be much slower than the normal path. Opt-in: OPENREEL_SOAK=1. EXPORT_SECS sets the range (60).
 */
test.skip(!SOAK, "set OPENREEL_SOAK=1");

const SECS = Number(process.env.EXPORT_SECS ?? 60);
const DEADLINE_MS = Number(process.env.EXPORT_DEADLINE_S ?? 720) * 1000;
/** Audio mixes beside the frames, so output starts within seconds (it was ~20-25 s behind the mixdown). */
const FIRST_FRAME_MAX_S = Number(process.env.EXPORT_FIRST_FRAME_MAX_S ?? 8);
const INIT = () => {
  try {
    localStorage.setItem("openreel-onboarding-complete", "true");
    localStorage.setItem("openreel-mograph-tour-complete", "true");
  } catch {
    /* storage unavailable */
  }
};

interface Segment {
  wall: number;
  progress: number;
}

async function jobState(page: Page, id: string) {
  return page.evaluate((jid) => {
    const j = (window as any).__openreelE2E.exportQueue.getState().queue.jobs.find((x: any) => x.id === jid);
    return { status: j?.status as string, progress: (j?.progress ?? 0) as number, error: j?.error as string | undefined };
  }, id);
}

/** Poll until the job ends, returning (wall seconds, progress) samples about once a second. */
async function watch(page: Page, id: string, label: string, deadlineMs: number): Promise<{ samples: Segment[]; status: string; seconds: number; error?: string }> {
  const t0 = Date.now();
  const samples: Segment[] = [];
  let last = "";
  for (;;) {
    const j = await jobState(page, id);
    const wall = (Date.now() - t0) / 1000;
    samples.push({ wall, progress: j.progress });
    const line = `${(j.progress * SECS).toFixed(0)}s`;
    if (line !== last) {
      const c = await page.evaluate(() => { const k = (window as any).__soak ?? {}; return `dec ${k.decodersOpen}/${k.decodersClosed} frames ${k.videoFrameOut} ctor ${k.videoFrameCtor} bmp ${k.bitmapCreated} workers ${k.workersCreated}`; }).catch(() => "");
      console.log(`[export-speed ${label}] +${wall.toFixed(0)}s out ${line} ${j.status} ${c}`);
    }
    last = line;
    if (j.status === "completed" || j.status === "failed") return { samples, status: j.status, seconds: wall, error: j.error };
    if (Date.now() - t0 > deadlineMs) return { samples, status: "timeout", seconds: wall };
    await page.waitForTimeout(1000);
  }
}

/** EXPORT_SAVE_DIR: keep the finished file (for frame-by-frame comparison between builds). */
async function saveOutput(page: Page, id: string, name: string): Promise<void> {
  const dir = process.env.EXPORT_SAVE_DIR;
  if (!dir) return;
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.evaluate((jid) => (window as any).__openreelE2E.exportQueue.getState().download(jid), id)]);
  await dl.saveAs(`${dir}/${name}`);
}

function enqueue(page: Page): Promise<string> {
  return page.evaluate((secs) => {
    const q = (window as any).__openreelE2E.exportQueue.getState();
    const job = q.enqueue({ settings: { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000, range: { startTime: 0, endTime: secs } }, presetLabel: "Speed" });
    q.start();
    return job.id as string;
  }, SECS);
}

/** Forward the engine's phase timings so a slow start is attributable from the test log. */
function logPhases(page: Page, label: string): void {
  page.on("console", (m) => {
    if (m.text().startsWith("[export-phase]")) console.log(`[export-speed ${label}] ${m.text()}`);
  });
}

/** Wall seconds until the first output frame (progress leaves 0). */
function timeToFirstFrame(samples: Segment[]): number {
  return samples.find((s) => s.progress > 0)?.wall ?? Infinity;
}

async function setup(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 90_000 });
  const sources = readManifest().filter((s) => /hd-h264-longgop|odd-h264/.test(s.name));
  const ids = await importSources(page, sources);
  return buildFeatureTimeline(page, ids, sources, { clips: 120, minutes: 12 });
}

/** The slowest 10 s window after the first frame lands (startup is audio + decoder setup), in output seconds per wall second. */
function worstWindow(samples: Segment[]): number {
  let worst = Infinity;
  const first = Math.max(0, samples.findIndex((s) => s.progress > 0));
  for (let i = first; i < samples.length; i++) {
    const j = samples.findIndex((s, k) => k > i && s.wall - samples[i].wall >= 10);
    if (j < 0) break;
    worst = Math.min(worst, ((samples[j].progress - samples[i].progress) * SECS) / (samples[j].wall - samples[i].wall));
  }
  return worst;
}

test.describe.configure({ mode: "serial", timeout: 30 * 60_000 });

let editorSpeed = 0;

test("editor export of the feature timeline runs at least near real time", async ({ context }) => {
  await context.addInitScript(INIT);
  await context.addInitScript(installProbes);
  const page = await context.newPage();
  logPhases(page, "editor");
  const build = await setup(page);
  expect(build.stageErrors).toEqual([]);
  const id = await enqueue(page);
  const r = await watch(page, id, "editor", DEADLINE_MS);
  editorSpeed = (r.status === "completed" ? SECS : (r.samples.at(-1)?.progress ?? 0) * SECS) / r.seconds;
  console.log(`[export-speed editor] ${r.status} in ${r.seconds.toFixed(1)}s = ${editorSpeed.toFixed(2)}x, worst 10 s window ${worstWindow(r.samples).toFixed(2)}x, first frame at ${timeToFirstFrame(r.samples).toFixed(1)}s`);
  writeOut("export-speed-editor.json", { status: r.status, seconds: r.seconds, speed: editorSpeed, worst10: worstWindow(r.samples), samples: r.samples });
  expect(r.status, r.error).toBe("completed");
  await saveOutput(page, id, "editor.mp4");
  if (!SOFTWARE_GPU) {
    expect(editorSpeed).toBeGreaterThan(1);
    expect(timeToFirstFrame(r.samples), "time to the first output frame").toBeLessThan(FIRST_FRAME_MAX_S);
  }
});

async function crash(context: BrowserContext, page: Page): Promise<void> {
  const gone = new Promise<void>((resolve) => {
    page.once("crash", () => resolve());
    page.once("close", () => resolve());
  });
  const cdp = await context.newCDPSession(page);
  void cdp.send("Page.crash").catch(() => undefined);
  await gone;
  await page.close({ runBeforeUnload: false }).catch(() => undefined);
}

test("retry-from-snapshot on a fresh welcome page is no slower than the editor", async ({ context }) => {
  await context.addInitScript(INIT);
  await context.addInitScript(installProbes);
  const first = await context.newPage();
  await setup(first);
  const id = await enqueue(first);
  await expect.poll(async () => (await jobState(first, id)).progress, { timeout: 600_000, intervals: [500] }).toBeGreaterThan(0.05);
  await first.waitForTimeout(1500);
  expect((await jobState(first, id)).status).toBe("running");
  await crash(context, first);
  const p2 = await context.newPage();
  logPhases(p2, "retry");
  await p2.goto("/");
  await p2.getByRole("button", { name: /Horizontal/ }).waitFor({ timeout: 90_000 });
  await p2.waitForFunction(() => Boolean((window as any).__openreelE2E?.autoSave), undefined, { timeout: 60_000 });
  await p2.evaluate(() => (window as any).__openreelE2E.exportQueue.getState().hydrate());
  await p2.evaluate((jid) => {
    const q = (window as any).__openreelE2E.exportQueue.getState();
    q.retry(jid);
    q.start();
  }, id);
  const r = await watch(p2, id, "retry", DEADLINE_MS);
  const speed = (r.status === "completed" ? SECS : (r.samples.at(-1)?.progress ?? 0) * SECS) / r.seconds;
  console.log(`[export-speed retry] ${r.status} in ${r.seconds.toFixed(1)}s = ${speed.toFixed(2)}x (editor ${editorSpeed.toFixed(2)}x), worst 10 s window ${worstWindow(r.samples).toFixed(2)}x, first frame at ${timeToFirstFrame(r.samples).toFixed(1)}s`);
  writeOut("export-speed-retry.json", { status: r.status, seconds: r.seconds, speed, worst10: worstWindow(r.samples), samples: r.samples });
  expect(r.status, r.error).toBe("completed");
  await saveOutput(p2, id, "retry.mp4");
  if (!SOFTWARE_GPU) {
    expect(speed).toBeGreaterThan(1);
    expect(timeToFirstFrame(r.samples), "time to the first output frame").toBeLessThan(FIRST_FRAME_MAX_S);
    if (editorSpeed > 0) expect(speed).toBeGreaterThan(editorSpeed * 0.5);
  }
});
