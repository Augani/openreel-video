import { test, type Page } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { clipsOf, openEditor, readState, settle } from "./helpers";

/**
 * Export timing on the e2e fixture (3 x 2 s scenes, 640x360 @ 30 fps, 180
 * frames), measured through the real export queue. Not an assertion suite: it
 * prints one line per run so before/after numbers can be compared on the same
 * machine load. Run once per project:
 *
 *   OPENREEL_E2E_BENCH=3 OPENREEL_E2E_PORT=6xxx pnpm exec playwright test e2e/export-bench.spec.ts --project gpu
 *
 * and with `--project fallback-nowebgpu` / `--project fallback-software` for the fallback renderers
 * (fallback-export-bench.spec.ts).
 *
 * With `OPENREEL_E2E_BENCH_OUT=<file>` every result line is appended there too.
 */

const RUNS = Number(process.env.OPENREEL_E2E_BENCH ?? 0);
const OUT = process.env.OPENREEL_E2E_BENCH_OUT;
const [SIZE_W, SIZE_H] = (process.env.OPENREEL_E2E_BENCH_SIZE ?? "640x360").split("x").map(Number);
const SETTINGS = { width: SIZE_W, height: SIZE_H, frameRate: 30, format: "mp4", codec: "h264", bitrate: SIZE_W >= 1920 ? 8000 : 2000 };

interface Hook {
  project: { getState(): Record<string, any> };
  exportQueue: { getState(): Record<string, any> };
}

async function runOnce(page: Page, label: string, settings: Record<string, unknown>): Promise<{ ms: number; smart?: string }> {
  const id = await page.evaluate((payload) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const job = h.exportQueue.getState().enqueue(payload);
    h.exportQueue.getState().start();
    return job.id as string;
  }, { settings, presetLabel: label });
  const deadline = Date.now() + 600_000;
  for (;;) {
    const j = await page.evaluate((jobId) => {
      const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
      const x = h.exportQueue.getState().queue.jobs.find((y: Record<string, any>) => y.id === jobId);
      return { status: x.status as string, ms: x.elapsedMs as number, smart: x.smartRender?.summary as string | undefined, error: x.error as string | undefined };
    }, id);
    if (j.status === "completed") return { ms: j.ms, smart: j.smart };
    if (j.status === "failed" || j.status === "cancelled") throw new Error(`${label}: ${j.status} ${j.error}`);
    if (Date.now() > deadline) throw new Error(`${label}: timed out`);
    await page.waitForTimeout(250);
  }
}

export function registerExportBench(): void {
  test.skip(RUNS === 0, "set OPENREEL_E2E_BENCH=<runs> to run the export benchmark");

  test("export timing on the fixture", async ({ page }, testInfo) => {
  testInfo.setTimeout(3_600_000);
  const renderLines: string[] = [];
  page.on("console", (msg) => {
    if (msg.text().startsWith("[export] render=")) renderLines.push(msg.text());
  });
  await openEditor(page);
  await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const s = h.project.getState().project.settings;
    if (s.width !== 640 || s.height !== 360) await h.project.getState().updateSettings({ width: 640, height: 360 });
  });
  expectClip(await readState(page));
  await settle(page, 500);
  const gpu = await page.evaluate(async () => {
    const g = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return g ? Boolean(await g.requestAdapter()) : false;
  });
  const lines: string[] = [];
  for (let run = 1; run <= RUNS; run++) {
    for (const [label, extra] of [["full-reencode", { smartRender: false }], ["smart-eligible-untouched", {}]] as const) {
      const r = await runOnce(page, `${label} #${run}`, { ...SETTINGS, ...extra });
      const line = `[bench] project=${testInfo.project.name} size=${SIZE_W}x${SIZE_H} webgpu=${gpu} ${label} run=${run} ms=${r.ms}${r.smart ? ` (${r.smart})` : ""}`;
      lines.push(line);
      console.log(line);
      if (OUT) appendFileSync(OUT, `${line}\n`);
    }
  }
  for (const l of renderLines) {
    console.log(l);
    if (OUT) appendFileSync(OUT, `${l}\n`);
  }
});
}

function expectClip(state: Awaited<ReturnType<typeof readState>>): void {
  if (clipsOf(state, "Main").length !== 1) throw new Error("expected one clip on Main");
}
