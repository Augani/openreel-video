import { expect, test, type Page } from "@playwright/test";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEditor } from "./helpers";
import { runParity } from "./essential-graphics-parity";
import { runPickFlow } from "./color-secondary-lib";
import { CAMERAS, generateCameras, historyLength, openCreateDialog, openMulticamEditor, readCuts } from "./multicam-lib";

/**
 * Cold-start smoke subset for the PRODUCTION bundle (`pnpm --filter @openreel/web test:e2e:prod`).
 *
 * The dev server keeps modules that the production build tree-shakes or splits (package.json
 * "sideEffects", lazy engine chunks), so a feature can pass every dev-server spec and still be
 * missing in the shipped bundle. Each test here opens a fresh page (cold: no engine chunk is warm)
 * and exercises one lazily loaded feature end to end: the repair AudioWorklet, a graphics template
 * with its export frame, SCC caption export, multicam creation, the proxy toggle, the audio mixer and
 * HSL secondary colour. They also run against the dev server, so a failure that appears only with
 * OPENREEL_E2E_DIST set is a bundling bug.
 */

interface Hook {
  project: { getState(): Record<string, any> };
  ui: { getState(): Record<string, any> };
  audio: Record<string, any>;
}
declare function E(): Hook;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
  });
});

test("repair worklet: DeHum, rendered offline, removes the 60 Hz hum and keeps the voice band", async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    const audio = E().audio;
    const rate = 48000;
    const length = rate * 2;
    const input = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      input[i] = 0.3 * Math.sin((2 * Math.PI * 1000 * i) / rate) + 0.25 * Math.sin((2 * Math.PI * 60 * i) / rate);
    }
    const ctx = new OfflineAudioContext(2, length + 4096, rate);
    await audio.ensureRepairWorklet(ctx);
    const buffer = ctx.createBuffer(2, length + 4096, rate);
    buffer.getChannelData(0).set(input);
    buffer.getChannelData(1).set(input);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const bus = new audio.AudioRackBus(ctx, { effects: [audio.createRackEffect("deHum", { params: { frequency: 60, harmonics: 3, q: 30 } })] }, { live: false });
    src.connect(bus.input);
    bus.output.connect(ctx.destination);
    src.start(0);
    const out = (await ctx.startRendering()).getChannelData(0);
    const amp = (x: Float32Array, f: number, from: number, to: number) => {
      let re = 0;
      let im = 0;
      for (let i = from; i < to; i++) {
        re += x[i] * Math.cos((2 * Math.PI * f * i) / rate);
        im -= x[i] * Math.sin((2 * Math.PI * f * i) / rate);
      }
      return (2 * Math.hypot(re, im)) / (to - from);
    };
    // Measure after the notch has settled; the worklet adds a small fixed latency, so compare amplitudes.
    const from = rate;
    const to = rate + rate / 2;
    return {
      humBefore: amp(input, 60, from, to),
      humAfter: amp(out, 60, from, to),
      voiceBefore: amp(input, 1000, from, to),
      voiceAfter: amp(out, 1000, from, to),
    };
  });
  expect(result.humBefore).toBeGreaterThan(0.2);
  expect(result.humAfter, "the 60 Hz hum is at least 20 dB down").toBeLessThan(result.humBefore / 10);
  expect(result.voiceAfter / result.voiceBefore, "the 1 kHz content is preserved").toBeGreaterThan(0.9);
});

test("graphics template: insert Classic Bar, the export render matches the preview frame", async ({ page }) => {
  test.setTimeout(240_000);
  const rows = await runParity(page, ["Classic Bar"]);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect(row.within, `${row.label}: graphic pixels within 40/255`).toBeGreaterThan(0.985);
});

test("caption export: a transcript exports as SCC (CEA-608)", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Text & captions", exact: true }).click();
  await page.getByRole("tab", { name: "Transcript" }).click();
  await page.getByTestId("transcript-panel").waitFor();
  const transcript = {
    language: "en",
    segments: [
      { speaker: "Ann", words: [{ word: "Welcome", start: 0.5, end: 0.9 }, { word: "to", start: 0.9, end: 1.0 }, { word: "the", start: 1.0, end: 1.1 }, { word: "show.", start: 1.1, end: 1.5 }] },
      { speaker: "Bob", words: [{ word: "Thanks", start: 2.5, end: 3.0 }, { word: "all.", start: 3.0, end: 3.5 }] },
    ],
  };
  await page.getByTestId("transcript-import-input").setInputFiles({ name: "interview.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(transcript)) });
  await expect.poll(() => page.evaluate(() => E().project.getState().project.timeline.subtitles.length as number)).toBe(2);
  await page.getByRole("combobox", { name: "Caption export format" }).click();
  await page.getByRole("option", { name: "SCC (CEA-608)" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export captions" }).click()]);
  const path = join(mkdtempSync(join(tmpdir(), "openreel-prod-smoke-")), "interview.scc");
  await download.saveAs(path);
  const text = readFileSync(path, "utf8");
  expect(text.startsWith("Scenarist_SCC V1.0")).toBe(true);
  expect(text).toMatch(/9420 9420 94ae 94ae /);
  expect(text).toMatch(/942f 942f/);
});

test("multicam: create a multi-camera source from three angles", async ({ page }) => {
  test.setTimeout(300_000);
  generateCameras();
  await openMulticamEditor(page);
  const before = await historyLength(page);
  await openCreateDialog(page);
  for (const cam of CAMERAS) await page.getByRole("checkbox", { name: `Use ${cam.file} as an angle` }).click();
  await page.getByTestId("multicam-analyze").click();
  await expect(page.getByTestId("multicam-offsets")).toBeVisible({ timeout: 180_000 });
  await page.getByTestId("multicam-create").click();
  await expect(page.getByTestId("multicam-monitor")).toBeVisible({ timeout: 30_000 });
  expect(await historyLength(page)).toBe(before + 1);
  const cuts = await readCuts(page);
  expect(cuts).toHaveLength(1);
  expect(cuts[0].tagged).toBe(true);
  await expect(page.getByTestId("multicam-angle")).toHaveCount(3);
});

test("proxy: the Program monitor's Toggle Proxies switch flips and the proxy panel opens", async ({ page }) => {
  await openEditor(page);
  const toggle = page.getByTestId("toggle-proxies");
  await expect(toggle).toBeVisible();
  const first = await toggle.getAttribute("aria-pressed");
  await toggle.click();
  await expect(toggle).not.toHaveAttribute("aria-pressed", first ?? "");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", first ?? "");
  await expect(page.getByTestId("proxy-panel")).toBeVisible({ timeout: 15_000 });
});

async function openMixer(page: Page): Promise<void> {
  await page.evaluate(() => E().ui.getState().togglePanel("audioMixer"));
  await page.getByTestId("audio-mixer").waitFor({ timeout: 20_000 });
}

test("mixer: the master strip is pinned and fully on screen", async ({ page }) => {
  await openEditor(page);
  await openMixer(page);
  const master = page.getByTestId("master-channel");
  const box = await master.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 0.5);
  await expect(page.getByTestId("mixer-strips-scroll")).toBeVisible();
});

test("color: HSL secondary keys the green bar through the eyedropper; the grade is one undo step", async ({ page }) => {
  test.setTimeout(240_000);
  const r = await runPickFlow(page);
  expect(Math.abs(r.coverage - r.expected)).toBeLessThan(0.015);
  expect(r.io.insideChromatic).toBe(0);
  expect(r.io.outsideChanged).toBe(0);
  expect(r.historyDeltaForGrade).toBe(1);
  expect(r.undoResidual).toBe(0);
});
