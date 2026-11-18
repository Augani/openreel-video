import { expect, test, type Page } from "@playwright/test";
import {
  clickClip,
  clipsOf,
  openEditor,
  readState,
  seek,
  settle,
  snap,
  undo,
  redo,
} from "./helpers";

/**
 * Mask pen tool on the Program monitor, in a real browser:
 * draw a 5-point mask (two smooth vertices), verify the program canvas
 * coverage matches the path's area, move a vertex, keyframe the path at two
 * times, verify the interpolated shape and undo each gesture in one step.
 */

interface PathPoint {
  x: number;
  y: number;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
}
interface MaskState {
  id: string;
  type: string;
  path: { closed: boolean; points: PathPoint[] };
  keyframes: { id: string; time: number; path: { points: PathPoint[] } }[];
  feathering: number;
  inverted: boolean;
}

const masksOf = (page: Page): Promise<MaskState[]> =>
  page.evaluate(() => {
    const e = (window as unknown as { __openreelE2E: { project: { getState(): { project: { masks?: unknown[] } } } } }).__openreelE2E;
    return JSON.parse(JSON.stringify(e.project.getState().project.masks ?? []));
  });

const overlay = (page: Page) => page.getByTestId("mask-pen-overlay");

/** Pointer position of a normalised frame coordinate. */
async function at(page: Page, nx: number, ny: number): Promise<{ x: number; y: number }> {
  const box = await overlay(page).boundingBox();
  if (!box) throw new Error("mask pen overlay is not visible");
  return { x: box.x + box.width * nx, y: box.y + box.height * ny };
}

async function click(page: Page, nx: number, ny: number): Promise<void> {
  const p = await at(page, nx, ny);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function dragFrom(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await at(page, from[0], from[1]);
  const b = await at(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

/**
 * Compares the program canvas with the snapshot taken before any mask existed,
 * sample by sample on a 96x54 grid: samples INSIDE the path must still show the
 * un-masked picture, samples OUTSIDE (that were not black before) must have
 * been removed. Returns the two agreement ratios.
 */
async function coverage(
  page: Page,
  path: unknown,
  key = "unmasked",
): Promise<{ insideKept: number; outsideRemoved: number; insideN: number; outsideN: number; shown: number }> {
  return page.evaluate(
    async ([p, snapKey]) => {
      const mp = (window as unknown as { __openreelE2E: { core: { maskPath: any } } }).__openreelE2E.core.maskPath;
      const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
      const t = document.createElement("canvas");
      t.width = c.width;
      t.height = c.height;
      const g = t.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(c, 0, 0);
      const now = g.getImageData(0, 0, c.width, c.height).data;
      const before = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps[snapKey as string];
      const poly = mp.flattenPath(p, 64) as { x: number; y: number }[];
      let inKept = 0;
      let inN = 0;
      let outGone = 0;
      let outN = 0;
      let shown = 0;
      let total = 0;
      const W = 96;
      const H = 54;
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          const nx = (i + 0.5) / W;
          const ny = (j + 0.5) / H;
          // keep away from the outline so antialiasing and feather rounding never decide
          const hit = mp.nearestOnPath(p, { x: nx, y: ny });
          if (hit && hit.distance < 0.012) continue;
          const o = (Math.floor(ny * c.height) * c.width + Math.floor(nx * c.width)) * 4;
          const same =
            Math.abs(now[o] - before[o]) + Math.abs(now[o + 1] - before[o + 1]) + Math.abs(now[o + 2] - before[o + 2]) <= 36 &&
            now[o + 3] > 200;
          const inside = mp.pathContains({ closed: true, points: p.points }, { x: nx, y: ny });
          total++;
          if (same) shown++;
          if (inside) {
            inN++;
            if (same) inKept++;
          } else if (before[o] + before[o + 1] + before[o + 2] > 90) {
            outN++;
            if (!same) outGone++;
          }
        }
      }
      void poly;
      return {
        insideKept: inN ? inKept / inN : 0,
        outsideRemoved: outN ? outGone / outN : 0,
        insideN: inN,
        outsideN: outN,
        shown: shown / total,
      };
    },
    [path, key] as const,
  );
}

/** Area of the (possibly interpolated) path as a fraction of the frame, via the core module itself. */
async function areaOf(page: Page, path: unknown): Promise<number> {
  return page.evaluate(
    async ([p]) => {
      const mp = (window as unknown as { __openreelE2E: { core: { maskPath: any } } }).__openreelE2E.core.maskPath;
      return mp.pathArea(p);
    },
    [path] as const,
  );
}

async function containsPoint(page: Page, path: unknown, nx: number, ny: number): Promise<boolean> {
  return page.evaluate(
    async ([p, x, y]) => {
      const mp = (window as unknown as { __openreelE2E: { core: { maskPath: any } } }).__openreelE2E.core.maskPath;
      return mp.pathContains(p, { x, y });
    },
    [path, nx, ny] as const,
  );
}

async function openMaskingSection(page: Page): Promise<void> {
  const effects = page.getByRole("button", { name: /^Expand Effects/ });
  if (await effects.isVisible().catch(() => false)) await effects.click();
  const masking = page.getByRole("button", { name: "Expand Masking section" });
  if (await masking.isVisible().catch(() => false)) await masking.click();
  await page.getByRole("button", { name: "Expand mask" }).first().click().catch(() => undefined);
  await settle(page, 400);
}

test("mask pen: draw 5 points with 2 smooth, verify coverage, move a vertex, keyframe, interpolate, undo", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await openEditor(page);
  const [clip] = clipsOf(await readState(page), "Main");
  await seek(page, 0.5);
  await clickClip(page, clip.id);
  await settle(page, 600);
  await snap(page, "unmasked");
  // un-masked reference frames at the keyframe times (the test card animates)
  await seek(page, 1);
  await snap(page, "t1");
  await seek(page, 1.5);
  await snap(page, "t1.5");
  await seek(page, 0.5);

  // ---- arm the pen from the Program monitor header --------------------------
  const penButton = page.getByRole("button", { name: "Mask pen tool" });
  await penButton.click();
  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page)).toHaveAttribute("data-mask-pen-mode", "draw");
  const historyBeforeDraw = (await readState(page)).historyLength;

  // ---- draw: corner, SMOOTH, corner, SMOOTH, corner, then close on the first point
  await click(page, 0.3, 0.2);
  await dragFrom(page, [0.7, 0.22], [0.8, 0.3]);
  await click(page, 0.78, 0.7);
  await dragFrom(page, [0.5, 0.82], [0.38, 0.82]);
  await click(page, 0.22, 0.62);
  await expect(page.getByTestId("mask-draft-vertex")).toHaveCount(5);
  await click(page, 0.3, 0.2); // first vertex closes the path
  await settle(page, 900);

  let masks = await masksOf(page);
  expect(masks).toHaveLength(1);
  const drawn = masks[0];
  expect(drawn.type).toBe("drawn");
  expect(drawn.path.closed).toBe(true);
  expect(drawn.path.points).toHaveLength(5);
  const smooth = drawn.path.points.map((p) => Boolean(p.handleIn && p.handleOut));
  expect(smooth).toEqual([false, true, false, true, false]);
  expect((await readState(page)).historyLength - historyBeforeDraw, "drawing the mask is one undo step").toBe(1);
  await expect(overlay(page)).toHaveAttribute("data-mask-pen-mode", "edit");
  await expect(page.getByTestId("mask-vertex")).toHaveCount(5);

  // ---- coverage: the canvas shows exactly the area inside the Bezier path ----
  const expectedArea = await areaOf(page, drawn.path);
  await page.screenshot({ path: testInfo.outputPath("01-drawn.png") });
  const cov = await coverage(page, drawn.path);
  console.log(`drawn: area=${expectedArea.toFixed(4)} ${JSON.stringify(cov)}`);
  expect(cov.insideKept, "inside the Bezier path the picture is kept").toBeGreaterThan(0.97);
  expect(cov.outsideRemoved, "outside the Bezier path the picture is removed").toBeGreaterThan(0.97);
  expect(Math.abs(cov.shown - expectedArea), "visible share equals the path area").toBeLessThan(0.03);

  // ---- move a vertex: one undo step, coverage follows -----------------------
  const histBeforeMove = (await readState(page)).historyLength;
  const v2 = drawn.path.points[2];
  await dragFrom(page, [v2.x, v2.y], [0.92, 0.9]);
  await settle(page, 900);
  masks = await masksOf(page);
  const moved = masks[0].path.points[2];
  expect(moved.x).toBeCloseTo(0.92, 1);
  expect(moved.y).toBeCloseTo(0.9, 1);
  expect(masks[0].path.points[0]).toEqual(drawn.path.points[0]);
  const movedArea = await areaOf(page, masks[0].path);
  expect(movedArea).toBeGreaterThan(expectedArea);
  const covMoved = await coverage(page, masks[0].path);
  console.log(`moved: area=${movedArea.toFixed(4)} ${JSON.stringify(covMoved)}`);
  expect(covMoved.insideKept).toBeGreaterThan(0.97);
  expect(covMoved.outsideRemoved).toBeGreaterThan(0.97);
  const histAfterMove = (await readState(page)).historyLength;
  expect(histAfterMove - histBeforeMove, "the whole drag is one undo step").toBe(1);
  await page.screenshot({ path: testInfo.outputPath("02-moved.png") });

  await undo(page);
  await settle(page, 700);
  masks = await masksOf(page);
  expect(masks[0].path.points[2].x).toBeCloseTo(v2.x, 6);
  expect(masks[0].path.points[2].y).toBeCloseTo(v2.y, 6);
  const covUndone = await coverage(page, drawn.path);
  expect(covUndone.insideKept).toBeGreaterThan(0.97);
  expect(covUndone.outsideRemoved).toBeGreaterThan(0.97);
  await redo(page);
  await settle(page, 700);
  masks = await masksOf(page);
  expect(masks[0].path.points[2].x).toBeCloseTo(0.92, 1);

  // ---- keyframe the path at two times --------------------------------------
  await openMaskingSection(page);
  const t1 = 0.5;
  const t2 = 1.5;
  await seek(page, t1);
  await page.getByRole("button", { name: "Add path keyframe at playhead" }).click();
  await settle(page, 600);
  await seek(page, t2);
  // Moving a vertex on a keyframed mask writes a keyframe at the playhead.
  await expect(overlay(page)).toBeVisible();
  const atT1 = (await masksOf(page))[0];
  expect(atT1.keyframes).toHaveLength(1);
  const base = atT1.keyframes[0].path.points[0];
  await dragFrom(page, [base.x, base.y], [0.1, 0.1]);
  await settle(page, 1000);
  masks = await masksOf(page);
  expect(masks[0].keyframes.map((k) => Math.round(k.time * 100) / 100)).toEqual([t1, t2]);
  expect(masks[0].keyframes[1].path.points[0].x).toBeCloseTo(0.1, 1);
  expect(masks[0].keyframes[0].path.points[0].x).toBeCloseTo(base.x, 6);

  // ---- interpolation at the midpoint ---------------------------------------
  const k1 = masks[0].keyframes[0].path.points;
  const k2 = masks[0].keyframes[1].path.points;
  await seek(page, (t1 + t2) / 2);
  await settle(page, 900);
  const midX = (k1[0].x + k2[0].x) / 2;
  const midY = (k1[0].y + k2[0].y) / 2;
  const midVertex = page.getByTestId("mask-vertex").first();
  const vbox = await midVertex.boundingBox();
  const obox = await overlay(page).boundingBox();
  expect(vbox && obox).toBeTruthy();
  expect(Math.abs((vbox!.x + vbox!.width / 2 - obox!.x) / obox!.width - midX)).toBeLessThan(0.01);
  expect(Math.abs((vbox!.y + vbox!.height / 2 - obox!.y) / obox!.height - midY)).toBeLessThan(0.01);
  // The rendered coverage follows the interpolated path too.
  const midPath = {
    closed: true,
    points: k1.map((p, i) => ({
      x: (p.x + k2[i].x) / 2,
      y: (p.y + k2[i].y) / 2,
      ...(p.handleIn && k2[i].handleIn
        ? { handleIn: { x: (p.handleIn.x + k2[i].handleIn!.x) / 2, y: (p.handleIn.y + k2[i].handleIn!.y) / 2 } }
        : {}),
      ...(p.handleOut && k2[i].handleOut
        ? { handleOut: { x: (p.handleOut.x + k2[i].handleOut!.x) / 2, y: (p.handleOut.y + k2[i].handleOut!.y) / 2 } }
        : {}),
    })),
  };
  const midArea = await areaOf(page, midPath);
  const covMid = await coverage(page, midPath, "t1");
  console.log(`interpolated: area=${midArea.toFixed(4)} ${JSON.stringify(covMid)}`);
  expect(covMid.insideKept).toBeGreaterThan(0.95);
  expect(covMid.outsideRemoved).toBeGreaterThan(0.95);
  expect(await containsPoint(page, midPath, 0.5, 0.5)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("03-interpolated.png") });
  // endpoints show the keyframe shapes
  await seek(page, t1);
  await settle(page, 700);
  const cov1 = await coverage(page, { closed: true, points: k1 }, "unmasked");
  expect(cov1.insideKept).toBeGreaterThan(0.95);
  expect(cov1.outsideRemoved).toBeGreaterThan(0.95);
  await seek(page, t2);
  await settle(page, 700);
  const cov2 = await coverage(page, { closed: true, points: k2 }, "t1.5");
  expect(cov2.insideKept).toBeGreaterThan(0.95);
  expect(cov2.outsideRemoved).toBeGreaterThan(0.95);

  // ---- undo the keyframing edit: one step removes the t2 keyframe ------------
  await undo(page);
  await settle(page, 700);
  masks = await masksOf(page);
  expect(masks[0].keyframes).toHaveLength(1);
  await redo(page);
  await settle(page, 700);
  expect((await masksOf(page))[0].keyframes).toHaveLength(2);
});
