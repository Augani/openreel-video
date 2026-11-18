import { expect, test } from "@playwright/test";
import { hideMain } from "./essential-graphics-lib";
import { openEditor, seek, settle } from "./helpers";

/**
 * Real-browser check that a circle authored on a non-square-PAR sequence is a circle where people look at it:
 *  - the Program monitor (the primary preview): the green lit area on the program canvas, scaled by the CSS size the
 *    monitor shows the frame at, is round;
 *  - export: VideoEngine.renderFrame (what the exporter calls per frame) yields stored pixels that are round once
 *    re-stretched by the PAR, which is what every player does with a non-square-pixel file;
 *  - the two agree on the circle's stored-pixel width and height.
 * Nothing here is mocked: the shape is rastered by the real graphics engine and measured on real pixels.
 */
const PROGRAM = 'canvas[aria-label^="Program frame"]';

const CASES = [
  { name: "DV NTSC 0.9091", par: 10 / 11 },
  { name: "HDV 1.3333", par: 4 / 3 },
  { name: "anamorphic 2.0", par: 2 },
  { name: "square 1.0", par: 1 },
];

interface Bounds {
  width: number;
  height: number;
  count: number;
}

for (const { name, par } of CASES) {
  test(`a circle is round in the monitor and in export at PAR ${name}`, async ({ page }) => {
    test.setTimeout(180_000);
    await openEditor(page);
    await hideMain(page);
    await page.evaluate(async (pixelAspectRatio) => {
      const e = (window as any).__openreelE2E;
      const state = e.project.getState();
      await state.updateSettings({ pixelAspectRatio });
      const titles = e.project.getState().project.timeline.tracks.find((t: any) => t.name === "Titles");
      const circle = e.project.getState().createShapeClip(titles.id, 0.5, "circle", 4);
      e.project.getState().updateShapeStyle(circle.id, {
        fill: { type: "solid", color: "#00ff00", opacity: 1 },
        stroke: { color: "#00ff00", width: 0, opacity: 0 },
      });
    }, par);
    await seek(page, 1.5);
    await settle(page, 900);

    const measured = await page.evaluate(
      async ([sel, time]) => {
        const e = (window as any).__openreelE2E;
        const bounds = (data: Uint8ClampedArray, w: number, h: number) => {
          let minX = w;
          let minY = h;
          let maxX = -1;
          let maxY = -1;
          let count = 0;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4;
              if (data[i + 1] > 200 && data[i] < 90 && data[i + 2] < 90) {
                count++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          return { width: maxX - minX + 1, height: maxY - minY + 1, count } as Bounds;
        };
        const read = (source: HTMLCanvasElement | ImageBitmap | OffscreenCanvas, w: number, h: number) => {
          const c = new OffscreenCanvas(w, h);
          const g = c.getContext("2d", { willReadFrequently: true })!;
          g.fillStyle = "#000";
          g.fillRect(0, 0, w, h);
          g.drawImage(source, 0, 0, w, h);
          return g.getImageData(0, 0, w, h).data;
        };
        const canvas = document.querySelector(sel as string) as HTMLCanvasElement;
        const css = canvas.getBoundingClientRect();
        const monitor = bounds(read(canvas, canvas.width, canvas.height), canvas.width, canvas.height);
        const project = e.project.getState().getFullProject();
        const { width, height } = project.settings;
        const engine = e.engine.getState().videoEngine;
        const frame = await engine.renderFrame(project, time as number, width, height);
        const exported = bounds(read(frame.image, width, height), width, height);
        return {
          monitor,
          exported,
          canvas: { width: canvas.width, height: canvas.height },
          css: { width: css.width, height: css.height },
          stored: { width, height },
          par: project.settings.pixelAspectRatio ?? 1,
        };
      },
      [PROGRAM, 1.5] as const,
    );

    expect(measured.par).toBeCloseTo(par, 4);
    expect(measured.exported.count, "the circle renders in export").toBeGreaterThan(500);
    expect(measured.monitor.count, "the circle renders in the monitor").toBeGreaterThan(500);

    // Export: stored pixels re-stretched by the PAR must be round.
    const exportRoundness = (measured.exported.width * par) / measured.exported.height;
    // Tolerance: 3% plus the one-pixel anti-aliasing quantisation of the bounding box, which is coarsest in x at high PAR.
    const exportTol = 0.03 + (2 * par) / measured.exported.height;
    expect(Math.abs(exportRoundness - 1), `export circle roundness ${exportRoundness.toFixed(3)} (display width / display height)`).toBeLessThan(exportTol);

    // Monitor: what is on screen (canvas pixels scaled to the CSS box the frame is shown in) must be round.
    const onScreenW = (measured.monitor.width / measured.canvas.width) * measured.css.width;
    const onScreenH = (measured.monitor.height / measured.canvas.height) * measured.css.height;
    const monitorRoundness = onScreenW / onScreenH;
    const monitorTol = 0.03 + 2 / Math.min(onScreenW, onScreenH) + (2 * par) / measured.monitor.height;
    expect(Math.abs(monitorRoundness - 1), `monitor circle roundness ${monitorRoundness.toFixed(3)} on screen`).toBeLessThan(monitorTol);

    // The frame itself is shown at the display aspect.
    const expectedAspect = (measured.stored.width * par) / measured.stored.height;
    expect(measured.css.width / measured.css.height).toBeCloseTo(expectedAspect, 1);

    // Preview and export agree: same stored-pixel proportions (scale-free).
    const monitorStoredW = measured.monitor.width / measured.canvas.width;
    const exportStoredW = measured.exported.width / measured.stored.width;
    expect(Math.abs(monitorStoredW - exportStoredW) / exportStoredW, "circle width fraction, monitor vs export").toBeLessThan(0.04);
    const monitorStoredH = measured.monitor.height / measured.canvas.height;
    const exportStoredH = measured.exported.height / measured.stored.height;
    expect(Math.abs(monitorStoredH - exportStoredH) / exportStoredH, "circle height fraction, monitor vs export").toBeLessThan(0.04);
  });
}
