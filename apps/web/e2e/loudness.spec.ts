import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { clickClip, clipsOf, openEditor, readState, settle } from "./helpers";
import { FIXTURE_PATH } from "./global-setup";
import { E2E_FFMPEG } from "./env";

/**
 * Loudness (ITU-R BS.1770-4 / EBU R128), checked in real Chrome against an
 * independent implementation (ffmpeg's ebur128 filter, libavfilter):
 *  - the mixer's "Analyze timeline" readout equals ffmpeg on the same source;
 *  - the live momentary / short-term readouts move while audio plays;
 *  - Clip "Normalize loudness" measures the clip, sets its gain in ONE undo
 *    step, and the clip then re-measures at the target;
 *  - Export "Normalize to target loudness" (-16 LUFS, -1 dBTP) lands the
 *    exported MP4 within +-0.5 LU, verified by ffmpeg on the downloaded file.
 */

interface Hook {
  project: { getState(): Record<string, any> };
  timeline: { getState(): Record<string, any> };
  ui: { getState(): Record<string, any> };
  audio: Record<string, any>;
  loudness: { getState(): Record<string, any> };
}

interface Ebur128 {
  integrated: number;
  lra: number;
  truePeak: number;
}

/** Run ffmpeg's EBU R128 meter and parse the summary block. */
function ebur128(file: string, preFilter = ""): Ebur128 {
  const filter = `${preFilter}ebur128=peak=true`;
  const run = spawnSync(E2E_FFMPEG, ["-nostats", "-i", file, "-vn", "-af", filter, "-f", "null", "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const summary = run.stderr.slice(run.stderr.lastIndexOf("Summary:"));
  const num = (re: RegExp): number => {
    const m = summary.match(re);
    if (!m) throw new Error(`ffmpeg ebur128 summary missing ${re}:\n${summary}`);
    return m[1] === "-inf" ? -Infinity : Number(m[1]);
  };
  return {
    integrated: num(/I:\s+(-?[\d.]+|-inf) LUFS/),
    lra: num(/LRA:\s+([\d.]+) LU/),
    truePeak: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/),
  };
}

// The fixture's audio is a mono sine. The editor's mixdown pans a mono clip to
// stereo through a centred StereoPannerNode, i.e. equal-power (-3 dB per side).
const DUAL_MONO = "pan=stereo|c0=0.70710678*c0|c1=0.70710678*c0,";

const parseReadout = (text: string | null): number => {
  const t = (text ?? "").replace("−", "-").trim();
  return t === "-∞" ? -Infinity : Number(t);
};

const openMixer = async (page: Page) => {
  await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.ui.getState().togglePanel("audioMixer"));
  await page.getByTestId("loudness-panel").waitFor({ timeout: 15_000 });
};

const runAnalysis = async (page: Page) => {
  await page.getByTestId("loudness-analyze").click();
  await expect(page.getByTestId("loudness-analysis")).toBeVisible({ timeout: 60_000 });
  const read = async (id: string) => parseReadout(await page.getByTestId(id).textContent());
  return {
    integrated: await read("loudness-integrated"),
    lra: await read("loudness-lra"),
    truePeak: await read("loudness-truepeak"),
    duration: await read("loudness-duration"),
  };
};

const undoDepth = (page: Page) =>
  page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().actionExecutor.getHistory().getUndoStackSize() as number);

test("Analyze timeline: the mixer readout matches ffmpeg ebur128 on the same source", async ({ page }, testInfo) => {
  await openEditor(page);
  await openMixer(page);
  const reference = ebur128(FIXTURE_PATH, DUAL_MONO);
  expect(Number.isFinite(reference.integrated), "fixture must have audio").toBe(true);

  const result = await runAnalysis(page);
  const progress = await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.loudness.getState().progress as number);
  expect(progress).toBe(1);

  const summary = { editor: result, ffmpeg: reference };
  console.log(`[loudness] analyze: ${JSON.stringify(summary)}`);
  testInfo.annotations.push({ type: "analyze", description: JSON.stringify(summary) });
  await page.getByTestId("loudness-panel").screenshot({ path: testInfo.outputPath("loudness-panel.png") });

  expect(Math.abs(result.integrated - reference.integrated)).toBeLessThanOrEqual(0.3);
  expect(Math.abs(result.truePeak - reference.truePeak)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(result.lra - reference.lra)).toBeLessThanOrEqual(1);
  expect(result.duration).toBeGreaterThan(5.5);
  await expect(page.getByTestId("loudness-delta")).toContainText("LU vs -14 LUFS target");
});

test("live meter: momentary and short-term readouts follow playback", async ({ page }) => {
  await openEditor(page);
  await openMixer(page);
  const momentary = page.getByTestId("loudness-live-momentary");
  const shortTerm = page.getByTestId("loudness-live-shortterm");
  expect(parseReadout(await momentary.textContent())).toBe(-Infinity);

  await page.evaluate(() => {
    const t = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.timeline.getState();
    t.pause();
    t.seekTo(0);
    t.play();
  });
  await expect.poll(async () => parseReadout(await momentary.textContent()), { timeout: 15_000 }).toBeGreaterThan(-60);
  // Short-term needs 3 s of audio; the fixture is 6 s.
  await expect.poll(async () => parseReadout(await shortTerm.textContent()), { timeout: 15_000 }).toBeGreaterThan(-60);

  const m = parseReadout(await momentary.textContent());
  const reference = ebur128(FIXTURE_PATH, DUAL_MONO).integrated;
  console.log(`[loudness] live momentary=${m} LUFS, ffmpeg integrated=${reference} LUFS`);
  // A steady tone: momentary equals integrated up to the playback tap's jitter.
  expect(Math.abs(m - reference)).toBeLessThanOrEqual(1.5);
  await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.timeline.getState().pause());
});

test("clip Normalize loudness: measures, sets gain in one undo step, re-measures at target", async ({ page }, testInfo) => {
  await openEditor(page);
  const [clip] = clipsOf(await readState(page), "Main");
  await clickClip(page, clip.id);
  await page.getByRole("tab", { name: "Audio" }).first().click();
  const normalize = page.getByRole("button", { name: "Normalize loudness" });
  await normalize.waitFor({ timeout: 15_000 });

  const volumeOf = () =>
    page.evaluate(
      (id) => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().getClip(id)?.volume as number,
      clip.id,
    );
  expect(await volumeOf()).toBe(1);
  const before = await undoDepth(page);

  // Target -23 LUFS (EBU R128 broadcast) from the preset dropdown.
  await page.getByRole("combobox", { name: "Loudness target" }).click();
  await page.getByRole("option", { name: /−23 LUFS/ }).click();
  await normalize.click();
  await expect(page.getByTestId("normalize-loudness-status")).toContainText("→", { timeout: 60_000 });

  expect(await undoDepth(page), "exactly one undo step").toBe(before + 1);
  const volume = await volumeOf();
  const reference = ebur128(FIXTURE_PATH, DUAL_MONO);
  const expectedVolume = Math.pow(10, (-23 - reference.integrated) / 20);
  console.log(
    `[loudness] clip normalize: ffmpeg ${reference.integrated} LUFS -> volume ${volume.toFixed(4)} (expected ${expectedVolume.toFixed(4)}); status="${await page.getByTestId("normalize-loudness-status").textContent()}"`,
  );
  expect(Math.abs(20 * Math.log10(volume / expectedVolume))).toBeLessThanOrEqual(0.3);

  // Independent check: re-measure the whole timeline mix with the new gain.
  await openMixer(page);
  const after = await runAnalysis(page);
  testInfo.annotations.push({ type: "normalized", description: JSON.stringify(after) });
  expect(Math.abs(after.integrated - -23)).toBeLessThanOrEqual(0.3);

  // Undo restores the original gain in one step.
  await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().undo());
  expect(await volumeOf()).toBe(1);
  expect(await undoDepth(page)).toBe(before);
});

test("export 'Normalize to target loudness' -16 LUFS / -1 dBTP: the exported MP4 measures within +-0.5 LU (ffmpeg)", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await openEditor(page);
  const before = ebur128(FIXTURE_PATH, DUAL_MONO);

  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await settle(page, 1500);
  await page.getByRole("tab", { name: "Custom Settings" }).click();
  const toggle =page.getByRole("switch", { name: "Normalize to target loudness" });
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await page.getByRole("combobox", { name: "Loudness target preset" }).click();
  await page.getByRole("option", { name: /Apple Podcasts \(-16 LUFS\)/ }).click();
  await expect(page.locator("#export-loudness-lufs")).toHaveValue("-16");
  await expect(page.locator("#export-loudness-ceiling")).toHaveValue("-1");

  const download = page.waitForEvent("download", { timeout: 200_000 });
  await page.getByRole("button", { name: "Export Video" }).last().click();
  const out = testInfo.outputPath("normalized-16.mp4");
  await (await download).saveAs(out);

  const exported = ebur128(out);
  console.log(`[loudness] export -16 LUFS: source ${before.integrated} LUFS / ${before.truePeak} dBTP -> exported ${JSON.stringify(exported)}`);
  testInfo.annotations.push({ type: "export-16", description: JSON.stringify({ before, exported }) });
  expect(Math.abs(exported.integrated - -16)).toBeLessThanOrEqual(0.5);
  expect(exported.truePeak).toBeLessThanOrEqual(-1 + 0.25);
});

test("export with the EBU R128 delivery spec: exported MP4 lands within +-0.5 LU of -23 and the compliance readout passes", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await openEditor(page);

  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await settle(page, 1500);
  await page.getByRole("tab", { name: "Custom Settings" }).click();
  const toggle = page.getByRole("switch", { name: "Normalize to target loudness" });
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await page.getByRole("combobox", { name: "Loudness target preset" }).click();
  await page.getByRole("option", { name: /EBU R128 \(-23 LUFS\)/ }).click();
  await expect(page.locator("#export-loudness-lufs")).toHaveValue("-23");
  await expect(page.getByTestId("export-loudness-spec-note")).toContainText("±0.5 LU");

  const download = page.waitForEvent("download", { timeout: 200_000 });
  await page.getByRole("button", { name: "Export Video" }).last().click();
  const out = testInfo.outputPath("ebu-r128.mp4");
  await (await download).saveAs(out);

  const exported = ebur128(out);
  console.log(`[loudness] export EBU R128: ${JSON.stringify(exported)}`);
  expect(Math.abs(exported.integrated - -23)).toBeLessThanOrEqual(0.5);
  expect(exported.truePeak).toBeLessThanOrEqual(-1 + 0.25);

  // Post-export compliance readout: pass per target, as stored for the mixer panel.
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.loudness.getState().exportReport?.compliance ?? null,
        ),
      { timeout: 30_000 },
    )
    .not.toBeNull();
  const compliance = await page.evaluate(
    () => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.loudness.getState().exportReport.compliance,
  );
  console.log(`[loudness] compliance: ${JSON.stringify(compliance)}`);
  expect(compliance.specId).toBe("broadcast");
  expect(compliance.pass).toBe(true);
  expect(compliance.checks.map((c: { id: string; pass: boolean }) => `${c.id}:${c.pass}`)).toEqual(["loudness:true", "truePeak:true"]);

  await openMixer(page);
  await expect(page.getByTestId("loudness-export-compliance-verdict")).toContainText("compliant");
});

test("export engine: loudness target hits the number, and a tight true-peak ceiling is enforced by the limiter", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await settle(page);

  const run = (targetLufs: number, truePeakCeilingDb: number) =>
    page.evaluate(
      async ([target, ceiling]) => {
        const engine = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.audio.getExportEngine();
        await engine.initialize?.();
        const project = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().getFullProject();
        const gen = engine.exportAudio(project, {
          format: "wav",
          sampleRate: 48000,
          bitDepth: 16,
          channels: 2,
          loudness: { enabled: true, targetLufs: target, truePeakCeilingDb: ceiling },
        });
        let step = await gen.next();
        while (!step.done) step = await gen.next();
        const result = step.value;
        if (!result.success) return { error: result.error?.message as string };
        const bytes = new Uint8Array(await result.blob.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { base64: btoa(binary), report: result.stats.loudness };
      },
      [targetLufs, truePeakCeilingDb] as const,
    );

  const { writeFileSync } = await import("node:fs");
  // Quiet-to-loud: -23 LUFS broadcast target, ceiling comfortably above the peaks.
  const a = await run(-23, -1);
  if ("error" in a) throw new Error(a.error);
  const fileA = testInfo.outputPath("normalized-23.wav");
  writeFileSync(fileA, Buffer.from(a.base64, "base64"));
  const mA = ebur128(fileA);
  console.log(`[loudness] engine -23: report=${JSON.stringify(a.report)} ffmpeg=${JSON.stringify(mA)}`);
  expect(Math.abs(mA.integrated - -23)).toBeLessThanOrEqual(0.5);
  expect(a.report.limiterEngaged).toBe(false);

  // -12 LUFS needs +6 dB of gain; a -18 dBTP ceiling forces the limiter on.
  const b = await run(-12, -18);
  if ("error" in b) throw new Error(b.error);
  const fileB = testInfo.outputPath("limited-12.wav");
  writeFileSync(fileB, Buffer.from(b.base64, "base64"));
  const mB = ebur128(fileB);
  console.log(`[loudness] engine -12/-18 dBTP: report=${JSON.stringify(b.report)} ffmpeg=${JSON.stringify(mB)}`);
  expect(b.report.limiterEngaged).toBe(true);
  expect(mB.truePeak).toBeLessThanOrEqual(-18 + 0.25);
  // The ceiling wins over the target: the file is quieter than -12 LUFS.
  expect(mB.integrated).toBeLessThan(-12 - 1);
});

// Keeps the helper referenced for tooling that checks unused imports.
void execFileSync;
