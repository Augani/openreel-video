import { expect, test } from "@playwright/test";
import { openEditor } from "./helpers";

/**
 * Deflicker through the real VideoEngine. The footage's second scene (2 s - 4 s) is a solid colour, so the only
 * brightness change in it is the flicker this spec injects: a keyframed Exposure effect above Deflicker that
 * alternates every frame. Checked here:
 *  - preview == export: every frame of the window renders to the identical bytes in preview mode and export mode,
 *    and in a different render order;
 *  - the flicker is removed: the luma variance of the rendered frames drops by more than 80%;
 *  - no lag across the scene cut at 2 s: the first frames of the solid scene land on their own level, not between
 *    the picture before the cut and the solid colour.
 */
interface Hook {
  project: { getState(): { project: any } };
  video: { getVideoEngine(): { exportMode: boolean; clearCache(): void; renderFrame(project: unknown, t: number, w: number, h: number): Promise<{ image: ImageBitmap }> } };
}

test("Deflicker renders the identical frame in preview and export, removes flicker, and keeps the scene cut", async ({ page }) => {
  test.setTimeout(300_000);
  await openEditor(page);
  const result = await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const engine = h.video.getVideoEngine();
    const project = h.project.getState().project;
    const W = 320;
    const H = 180;
    const FPS = 30;
    const keyframes: unknown[] = [];
    for (let i = Math.round(1.5 * FPS); i <= Math.round(4 * FPS); i++) {
      keyframes.push({ id: `kf-${i}`, time: i / FPS, property: "fx:e2e-exposure:exposure", value: i % 2 === 0 ? 0.35 : -0.35, easing: "linear" });
    }
    const exposure = { id: "e2e-exposure", type: "exposure", enabled: true, params: { exposure: 0, offset: 0, gamma: 1 } };
    const deflicker = { id: "e2e-deflicker", type: "deflicker", enabled: true, params: { window: 9, luma: 100, color: 0, sensitivity: 50, limit: 50 } };
    const withEffects = (effects: unknown[], kfs: unknown[]) => ({
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((track: any) => ({
          ...track,
          clips: track.clips.map((clip: any) => ({ ...clip, effects, keyframes: kfs })),
        })),
      },
    });
    const flickering = withEffects([exposure], keyframes);
    const deflickered = withEffects([exposure, deflicker], keyframes);
    const plain = withEffects([], []);
    const pixels = async (p: unknown, t: number): Promise<Uint8ClampedArray> => {
      const frame = await engine.renderFrame(p, t, W, H);
      const c = new OffscreenCanvas(frame.image.width, frame.image.height);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(frame.image, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const meanLuma = (d: Uint8ClampedArray): number => {
      let acc = 0;
      for (let i = 0; i < d.length; i += 4) acc += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      return acc / (d.length / 4) / 255;
    };
    const variance = (v: number[]): number => {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length;
    };

    // 20 consecutive frames well inside the solid scene (2.5 s - 3.1 s)
    const times = [...Array(20)].map((_, i) => (75 + i) / FPS);
    const run = async (p: unknown, exportMode: boolean, order: number[]): Promise<Map<number, Uint8ClampedArray>> => {
      engine.exportMode = exportMode;
      engine.clearCache();
      const out = new Map<number, Uint8ClampedArray>();
      for (const i of order) out.set(i, await pixels(p, times[i]));
      engine.exportMode = false;
      return out;
    };
    const forward = times.map((_, i) => i);
    const shuffled = [...forward].reverse().map((v, i) => (i % 2 ? v : forward[(v * 7) % forward.length]));
    const orderB = [...new Set([...shuffled, ...forward])];
    const preview = await run(deflickered, false, forward);
    const exported = await run(deflickered, true, orderB);
    let previewVsExport = 0;
    for (const i of forward) {
      const a = preview.get(i)!;
      const b = exported.get(i)!;
      for (let k = 0; k < a.length; k++) previewVsExport = Math.max(previewVsExport, Math.abs(a[k] - b[k]));
    }
    const rawFlicker = await run(flickering, false, forward);
    const rawLuma = forward.map((i) => meanLuma(rawFlicker.get(i)!));
    const fixedLuma = forward.map((i) => meanLuma(preview.get(i)!));

    // The cut at 2 s: frames 60 (first of the solid scene), 61, 62 against the clean solid colour.
    const cleanSolid = meanLuma(await pixels(plain, 2.5));
    const cutFrames: number[] = [];
    for (const f of [60, 61, 62, 63]) {
      engine.clearCache();
      cutFrames.push(meanLuma(await pixels(deflickered, f / FPS)));
    }
    const beforeCut = meanLuma(await pixels(plain, 1.9));
    return { previewVsExport, rawVariance: variance(rawLuma), fixedVariance: variance(fixedLuma), cleanSolid, cutFrames, beforeCut, rawMean: rawLuma.reduce((a, b) => a + b, 0) / rawLuma.length };
  });
  console.log(`[deflicker] ${JSON.stringify(result)}`);
  expect(result.previewVsExport, "preview == export, any render order").toBe(0);
  expect(result.rawVariance, "the injected flicker is real").toBeGreaterThan(1e-4);
  expect(1 - result.fixedVariance / result.rawVariance, "flicker variance reduction").toBeGreaterThan(0.8);
  // The solid scene keeps its brightness (the correction is a trend, not a flatten to the picture before the cut).
  for (const [i, luma] of result.cutFrames.entries()) {
    expect(Math.abs(luma - result.cleanSolid) / result.cleanSolid, `frame ${60 + i} stays near the solid scene level`).toBeLessThan(0.35);
  }
  expect(Math.abs(result.beforeCut - result.cleanSolid), "the two shots differ, so the check above is meaningful").toBeGreaterThan(0.02);
});
