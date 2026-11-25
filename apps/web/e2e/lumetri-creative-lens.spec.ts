import { expect, test } from "@playwright/test";
import { openEditor } from "./helpers";

/**
 * Lumetri Creative and Lens Correction through the real VideoEngine: the frame rendered in preview mode and in export
 * mode (cold cache, different order) is byte-identical, and each effect visibly changes the picture.
 */
interface Hook {
  project: { getState(): { project: any } };
  video: { getVideoEngine(): { exportMode: boolean; clearCache(): void; renderFrame(project: unknown, t: number, w: number, h: number): Promise<{ image: ImageBitmap }> } };
}

test("Lumetri Creative and Lens Correction render the identical frame in preview and export", async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  const result = await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const engine = h.video.getVideoEngine();
    const project = h.project.getState().project;
    const W = 320;
    const H = 180;
    const withEffects = (effects: unknown[]) => ({
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((track: any) => ({
          ...track,
          clips: track.clips.map((clip: any) => ({ ...clip, effects, keyframes: [] })),
        })),
      },
    });
    const creative = { id: "e2e-creative", type: "lumetri-creative", enabled: true, params: { fadedFilm: 35, sharpen: 50, vibrance: 60, shadowTintHue: 210, shadowTintAmount: 60, highlightTintHue: 35, highlightTintAmount: 50, tintBalance: 10 } };
    const lens = { id: "e2e-lens", type: "lens-correction", enabled: true, params: { profile: "gopro-wide", strength: 100, caRed: 40, caBlue: -40, vignette: 30 } };
    const pixels = async (p: unknown, t: number, exportMode: boolean): Promise<Uint8ClampedArray> => {
      engine.exportMode = exportMode;
      engine.clearCache();
      const frame = await engine.renderFrame(p, t, W, H);
      engine.exportMode = false;
      const c = new OffscreenCanvas(frame.image.width, frame.image.height);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(frame.image, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
      let m = 0;
      for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
      return m;
    };
    const out: Record<string, { previewVsExport: number; vsPlain: number }> = {};
    for (const [name, effect] of [["creative", creative], ["lens", lens]] as const) {
      const p = withEffects([effect]);
      const plain = await pixels(withEffects([]), 1, false);
      const preview = await pixels(p, 1, false);
      const exported = await pixels(p, 1, true);
      out[name] = { previewVsExport: diff(preview, exported), vsPlain: diff(preview, plain) };
    }
    return out;
  });
  console.log(`[lumetri-creative-lens] ${JSON.stringify(result)}`);
  for (const [name, r] of Object.entries(result)) {
    expect(r.previewVsExport, `${name}: preview == export`).toBe(0);
    expect(r.vsPlain, `${name}: changes the picture`).toBeGreaterThan(8);
  }
});
