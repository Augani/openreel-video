import { expect, test, type Page } from "@playwright/test";
import { clipsOf, openEditor, readState, settle, undo, redo, clickClip } from "./helpers";

/**
 * Premiere-class keyframe graph, end to end in real Chrome: Continuous Bezier on the position keys of a clip
 * (spatial path), dragging one path handle on the Program monitor, then the rendered position of the clip at
 * sampled frames must match the core evaluator in BOTH the editor preview (the Program canvas) and an exported
 * frame (VideoEngine.renderFrame, the export renderer). The clip is the fixture's solid red scene, scaled down so
 * its bounding box gives the rendered position.
 */
declare function E(): { project: { getState(): Record<string, any> } };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
  });
});

const keysOf = (page: Page, clipId: string) =>
  page.evaluate((id) => (E().project.getState().getClip(id).keyframes ?? []) as Array<Record<string, any>>, clipId);
const historyDepth = (page: Page) =>
  page.evaluate(() => E().project.getState().actionExecutor.getHistory().getUndoStackSize() as number);

interface Sampled {
  t: number;
  expected: { x: number; y: number };
  independent: { x: number; y: number };
  preview: { cx: number; cy: number; w: number; px: number };
  exported: { cx: number; cy: number; w: number; px: number };
  canvasW: number;
  canvasH: number;
  projectW: number;
  projectH: number;
}

async function sampleAt(page: Page, clipId: string, t: number): Promise<Sampled> {
  await page.evaluate((time) => (window as any).__openreelE2E.timeline.getState().seekTo(time), t);
  await settle(page, 1200);
  return page.evaluate(
    async ([id, time]) => {
      const e = (window as any).__openreelE2E;
      const program = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
      const box = (source: CanvasImageSource, width: number, height: number) => {
        const canvas = new OffscreenCanvas(width, height);
        const g = canvas.getContext("2d", { willReadFrequently: true })!;
        g.fillStyle = "#000";
        g.fillRect(0, 0, width, height);
        g.drawImage(source, 0, 0, width, height);
        const data = g.getImageData(0, 0, width, height).data;
        let x0 = width, y0 = height, x1 = -1, y1 = -1, n = 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            if (data[o] > 150 && data[o + 1] < 90 && data[o + 2] < 90) {
              n++;
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        return { cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2, w: x1 - x0 + 1, px: n };
      };
      // The preview settles asynchronously (decode, present): wait for two identical reads.
      let preview = box(program, program.width, program.height);
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const next = box(program, program.width, program.height);
        const same = Math.abs(next.cx - preview.cx) < 0.01 && Math.abs(next.cy - preview.cy) < 0.01 && next.px === preview.px;
        preview = next;
        if (same && i > 1 && next.px > 0) break;
      }
      const project = e.project.getState().getFullProject();
      const width = project.settings.width as number;
      const height = project.settings.height as number;
      const clip = e.project.getState().getClip(id);
      const local = (time as number) - clip.startTime;
      const evaluate = e.core.evaluateKeyframes.evaluateKeyframesAt;
      const here = evaluate(clip.keyframes, local) as Map<string, number>;
      const stripped = clip.keyframes.map((k: any) => {
        const { spatialMode: _m, spatialIn: _i, spatialOut: _o, ...rest } = k;
        return rest;
      });
      const flat = evaluate(stripped, local) as Map<string, number>;
      const fresh = await e.engine.getState().videoEngine.renderFrame(project, time as number, width, height);
      return {
        t: time as number,
        expected: { x: here.get("position.x") as number, y: here.get("position.y") as number },
        independent: { x: flat.get("position.x") as number, y: flat.get("position.y") as number },
        preview,
        exported: box(fresh.image, width, height),
        canvasW: program.width,
        canvasH: program.height,
        projectW: width,
        projectH: height,
      };
    },
    [clipId, t] as const,
  );
}

test("Continuous Bezier position path: dragging a monitor handle moves the clip identically in preview, export and the evaluator", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1700, height: 1300 });
  await openEditor(page);
  const [clip] = clipsOf(await readState(page), "Main");
  // The solid red scene is source 2s-4s; the clip is placed at 0, so clip-local time equals source time. The project
  // matches the fixture video (640x360), so position values are pixels of that frame.
  await page.evaluate(({ id }) => {
    const mk = (kid: string, property: string, time: number, value: number) => ({ id: kid, property, time, value, easing: "linear" });
    E().project.getState().updateClipKeyframes(id, [
      mk("px0", "position.x", 2, -200), mk("py0", "position.y", 2, -100),
      mk("px1", "position.x", 3, 40), mk("py1", "position.y", 3, 70),
      mk("px2", "position.x", 4, 200), mk("py2", "position.y", 4, -60),
      mk("sx0", "scale.x", 2, 0.25), mk("sx1", "scale.x", 4, 0.25),
      mk("sy0", "scale.y", 2, 0.25), mk("sy1", "scale.y", 4, 0.25),
    ]);
  }, { id: clip.id });
  await clickClip(page, clip.id);
  await page.evaluate(() => E().project.getState().getClip && (window as any).__openreelE2E.ui.getState().setKeyframeEditorOpen(true));
  const panel = page.getByRole("region", { name: "Keyframe editor" });
  await panel.waitFor({ timeout: 20_000 });
  await panel.getByRole("combobox", { name: "Property" }).click();
  await page.getByRole("option", { name: "position.x" }).click();

  // Spatial Interpolation > Continuous Bezier on all three position keys, from the right-click menu.
  await panel.getByRole("button", { name: /^Keyframe at 2.000s/ }).click();
  await panel.getByRole("button", { name: /^Keyframe at 3.000s/ }).click({ modifiers: ["Shift"] });
  await panel.getByRole("button", { name: /^Keyframe at 4.000s/ }).click({ modifiers: ["Shift"] });
  const depth0 = await historyDepth(page);
  await panel.getByRole("button", { name: /^Keyframe at 3.000s/ }).click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "Spatial Continuous Bezier" }).click();
  await expect.poll(async () => (await keysOf(page, clip.id)).find((x) => x.id === "px1")?.spatialMode).toBe("continuous-bezier");
  expect(await historyDepth(page)).toBe(depth0 + 1);
  for (const id of ["px0", "px1", "px2"]) expect((await keysOf(page, clip.id)).find((x) => x.id === id)?.spatialMode).toBe("continuous-bezier");

  // Drag the middle key's outgoing handle on the Program monitor.
  await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().seekTo(3));
  await settle(page, 800);
  const handle = page.getByTestId("spatial-handle-1-out");
  await handle.waitFor({ timeout: 20_000 });
  const before = (await keysOf(page, clip.id)).find((x) => x.id === "px1")!;
  const canvas = page.locator('canvas[aria-label^="Program frame"]');
  const cbox = (await canvas.boundingBox())!;
  const projectW = await page.evaluate(() => (window as any).__openreelE2E.project.getState().getFullProject().settings.width as number);
  const displayScale = Math.min(cbox.width, (cbox.height * 16) / 9) / projectW;
  const hb = (await handle.boundingBox())!;
  const depth1 = await historyDepth(page);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2 - 90, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await keysOf(page, clip.id)).find((x) => x.id === "px1")?.spatialOut?.x).not.toBe(before.spatialOut.x);
  const dragged = (await keysOf(page, clip.id)).find((x) => x.id === "px1")!;
  expect(await historyDepth(page)).toBe(depth1 + 1);
  expect(dragged.spatialMode).toBe("continuous-bezier");
  expect(dragged.spatialOut.x - before.spatialOut.x).toBeCloseTo(60 / displayScale, -1);
  expect(dragged.spatialOut.y - before.spatialOut.y).toBeCloseTo(-90 / displayScale, -1);
  // Continuous: the handles stay collinear and opposite.
  const cross = dragged.spatialOut.x * dragged.spatialIn.y - dragged.spatialOut.y * dragged.spatialIn.x;
  expect(Math.abs(cross)).toBeLessThan(1e-6 * Math.hypot(dragged.spatialOut.x, dragged.spatialOut.y) * Math.hypot(dragged.spatialIn.x, dragged.spatialIn.y) + 1e-6);
  expect(dragged.spatialOut.x * dragged.spatialIn.x + dragged.spatialOut.y * dragged.spatialIn.y).toBeLessThan(0);

  // Rendered position at sampled frames == the core evaluator, in the preview and in an exported frame.
  let curvature = 0;
  for (const t of [2.2, 2.6, 3, 3.4, 3.8]) {
    const s = await sampleAt(page, clip.id, t);
    const expPreview = { x: s.canvasW / 2 + (s.expected.x * s.canvasW) / s.projectW, y: s.canvasH / 2 + (s.expected.y * s.canvasH) / s.projectH };
    const expExport = { x: s.projectW / 2 + s.expected.x, y: s.projectH / 2 + s.expected.y };
    console.log(`[spatial e2e] t=${t} expected ${JSON.stringify(expPreview)} preview ${JSON.stringify(s.preview)} export ${JSON.stringify(s.exported)} expExport ${JSON.stringify(expExport)} canvas ${s.canvasW}x${s.canvasH}`);
    expect(s.preview.px, `preview draws the clip at ${t}s`).toBeGreaterThan(50);
    expect(s.exported.px, `export draws the clip at ${t}s`).toBeGreaterThan(50);
    expect(Math.abs(s.preview.cx - expPreview.x), `preview x at ${t}s`).toBeLessThan(3);
    expect(Math.abs(s.preview.cy - expPreview.y), `preview y at ${t}s`).toBeLessThan(3);
    expect(Math.abs(s.exported.cx - expExport.x), `export x at ${t}s`).toBeLessThan(2);
    expect(Math.abs(s.exported.cy - expExport.y), `export y at ${t}s`).toBeLessThan(2);
    curvature = Math.max(curvature, Math.hypot(s.expected.x - s.independent.x, s.expected.y - s.independent.y));
  }
  expect(curvature, "the path is curved, not the straight per-axis interpolation").toBeGreaterThan(8);

  // Undo and redo the drag: the evaluator and stored handles follow.
  await undo(page);
  await expect.poll(async () => (await keysOf(page, clip.id)).find((x) => x.id === "px1")?.spatialOut?.x).toBeCloseTo(before.spatialOut.x, 6);
  await redo(page);
  await expect.poll(async () => (await keysOf(page, clip.id)).find((x) => x.id === "px1")?.spatialOut?.x).toBeCloseTo(dragged.spatialOut.x, 6);
});
