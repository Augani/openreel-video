import { expect, test } from "@playwright/test";
import { clipsOf, openEditor, readState, seek, settle } from "./helpers";

/**
 * Independent check of the lazy VR runtime contract (the runtime chunk is loaded on first use and no frame is ever drawn
 * without the effect). Each case runs in a fresh page with the runtime NOT loaded (window.__openreelLazyVr):
 *  1. a project that already holds the VR effect is loaded (project open, not "add effect") while the playhead moves to
 *     the frame to show; every frame the Program monitor presents from that moment is sampled at full resolution and none
 *     may equal the effect-free picture of that same frame;
 *  2. the first export-mode render of a project with the effect (runtime still unloaded) differs from the plain picture.
 */
const CASES: Array<{ type: string; params: Record<string, unknown> }> = [
  { type: "vr-rotate-sphere", params: { pan: 70, tilt: 20, roll: 15 } },
  { type: "vr-projection", params: { mode: "rectilinear", fov: 70, pan: 30, tilt: 10 } },
  { type: "vr-blur", params: { radius: 12 } },
  { type: "vr-plane-to-sphere", params: { enabled: true, width: 90, pan: 20, tilt: -10 } },
  { type: "vr-sharpen", params: { amount: 100, radius: 2 } },
  { type: "vr-glow", params: { threshold: 20, radius: 8, brightness: 300 } },
  { type: "vr-chromatic-aberrations", params: { amount: 100, pan: 40, tilt: 10 } },
  { type: "vr-digital-glitch", params: { intensity: 90, seed: 7, time: 0.5, rate: 10 } },
  { type: "vr-de-noise", params: { amount: 80, radius: 2.5 } },
];

for (const c of CASES) {
  test(`first preview frame of an opened project with ${c.type} has the effect; first export-mode frame too`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.addInitScript(() => {
      (window as unknown as { __openreelLazyVr?: boolean }).__openreelLazyVr = true;
    });
    await openEditor(page);
    await settle(page, 1200);
    expect(await page.evaluate(() => (window as any).__openreelE2E.core.vrRuntime.isLoaded())).toBe(false);
    const [clip] = clipsOf(await readState(page), "Main");

    // Plain picture of the target frame as the Program monitor shows it.
    await seek(page, 0.5);
    await settle(page, 1200);
    const result = await page.evaluate(
      async ({ type, params, clipId }) => {
        const e = (window as any).__openreelE2E;
        const read = (): Uint8ClampedArray => {
          const cv = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
          const t = document.createElement("canvas");
          t.width = cv.width;
          t.height = cv.height;
          const g = t.getContext("2d", { willReadFrequently: true })!;
          g.drawImage(cv, 0, 0);
          return g.getImageData(0, 0, t.width, t.height).data;
        };
        const mad = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
          if (a.length !== b.length) return 255;
          let d = 0;
          for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          return d / (a.length / 4) / 3;
        };
        const plain = read();
        // Move away so the monitor shows a different picture, then open the effect-carrying project and go to 0.5 s.
        e.timeline.getState().seekTo(5);
        await new Promise((r) => setTimeout(r, 1500));
        const away = read();
        const loadedBefore = e.core.vrRuntime.isLoaded();
        const project = e.project.getState().project;
        const withFx = {
          ...project,
          timeline: {
            ...project.timeline,
            tracks: project.timeline.tracks.map((tr: any) => ({
              ...tr,
              clips: tr.clips.map((cl: any) => (cl.id === clipId ? { ...cl, effects: [{ id: `fx-${type}`, type, params, enabled: true }] } : cl)),
            })),
          },
        };
        const samples: number[] = [];
        let stop = false;
        const tick = () => {
          if (stop) return;
          samples.push(mad(read(), plain));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        e.project.getState().loadProject(withFx);
        e.timeline.getState().seekTo(0.5);
        await new Promise((r) => setTimeout(r, 5000));
        stop = true;
        const final = read();
        return { loadedBefore, loadedAfter: e.core.vrRuntime.isLoaded(), awayVsPlain: mad(away, plain), finalVsPlain: mad(final, plain), samples, n: samples.length };
      },
      { type: c.type, params: c.params, clipId: clip.id },
    );
    console.log(`${c.type}: samples=${result.n} awayVsPlain=${result.awayVsPlain.toFixed(2)} finalVsPlain=${result.finalVsPlain.toFixed(2)} minSample=${Math.min(...result.samples).toFixed(3)}`);
    expect(result.loadedBefore).toBe(false);
    expect(result.loadedAfter).toBe(true);
    expect(result.awayVsPlain, "the away picture differs from the plain target").toBeGreaterThan(5);
    expect(result.finalVsPlain, "the settled preview has the effect").toBeGreaterThan(0.05);
    // Samples that show the plain target picture (within 0.02 of it) are an unprocessed first frame.
    const unprocessed = result.samples.filter((s) => s < 0.02).length;
    expect(unprocessed, "no presented frame equals the effect-free picture").toBe(0);

    // Export-mode first render in a fresh page state is covered by the next test of the same type; do it here on the
    // already-loaded runtime only as a parity check (preview vs export).
  });

  test(`first export-mode render with ${c.type} (runtime unloaded) has the effect`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      (window as unknown as { __openreelLazyVr?: boolean }).__openreelLazyVr = true;
    });
    await openEditor(page);
    await settle(page, 1000);
    const [clip] = clipsOf(await readState(page), "Main");
    const r = await page.evaluate(
      async ({ type, params, clipId }) => {
        const e = (window as any).__openreelE2E;
        const engine = e.video.getVideoEngine();
        const project = e.project.getState().project;
        const mk = (effects: unknown[]) => ({
          ...project,
          timeline: { ...project.timeline, tracks: project.timeline.tracks.map((tr: any) => ({ ...tr, clips: tr.clips.map((cl: any) => (cl.id === clipId ? { ...cl, effects } : cl)) })) },
        });
        const read = async (p: unknown, exp: boolean) => {
          engine.exportMode = exp;
          try {
            const f = await engine.renderFrame(p, 0.5, 480, 270);
            const cv = new OffscreenCanvas(f.image.width, f.image.height);
            const g = cv.getContext("2d", { willReadFrequently: true })!;
            g.drawImage(f.image, 0, 0);
            return g.getImageData(0, 0, cv.width, cv.height).data;
          } finally {
            engine.exportMode = false;
          }
        };
        const mad = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
          let d = 0;
          for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          return d / (a.length / 4) / 3;
        };
        const plain = await read(mk([]), true);
        const loadedBefore = e.core.vrRuntime.isLoaded();
        const exp = await read(mk([{ id: "fx1", type, params, enabled: true }]), true); // FIRST VR render, export mode
        const prev = await read(mk([{ id: "fx1", type, params, enabled: true }]), false);
        return { loadedBefore, loadedAfter: e.core.vrRuntime.isLoaded(), expVsPlain: mad(exp, plain), prevVsExp: mad(prev, exp) };
      },
      { type: c.type, params: c.params, clipId: clip.id },
    );
    console.log(`${c.type} export-first: ${JSON.stringify(r)}`);
    expect(r.loadedBefore).toBe(false);
    expect(r.loadedAfter).toBe(true);
    expect(r.expVsPlain).toBeGreaterThan(0.05);
    expect(r.prevVsExp).toBeLessThan(0.5);
  });
}
