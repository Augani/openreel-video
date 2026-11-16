import { expect, test } from "@playwright/test";
import { press, readState, settle, snap, diffSnaps } from "./helpers";
import {
  addSecondaryViaUi,
  chromaOfSnap,
  meanChroma,
  openBarsClip,
  runPickFlow,
  secondaries,
  snapOverlay,
  updateSecondary,
} from "./color-secondary-lib";

// Real-browser coverage of the Lumetri-style HSL Secondary and the Program
// monitor comparison view (GPU project; the software path runs the same flow in
// fallback-color-secondary.spec.ts).

test("eyedropper keys a bar: matte coverage, correction only inside, undo exact", async ({ page }) => {
  test.setTimeout(240_000);
  const r = await runPickFlow(page);
  console.log(
    `[color-secondary] picked ${JSON.stringify(r.qualifier)} coverage=${r.coverage.toFixed(4)} expected=${r.expected.toFixed(4)} ` +
      `inside=${r.io.insideCount} insideChromatic=${r.io.insideChromatic} outside=${r.io.outsideCount} outsideChanged=${r.io.outsideChanged} ` +
      `undoResidual=${r.undoResidual} historyGrade=${r.historyDeltaForGrade} historyMatte=${r.historyDeltaForMatteToggles}`,
  );
  // The green bar spans 1/7 of the width over the top two thirds of the frame.
  expect(r.expected).toBeGreaterThan(0.07);
  expect(r.expected).toBeLessThan(0.12);
  expect(Math.abs(r.coverage - r.expected)).toBeLessThan(0.015);
  // A narrow hue key, centred on green, from the eyedropper sample.
  expect(r.qualifier.hueMin).toBeGreaterThan(95);
  expect(r.qualifier.hueMax).toBeLessThan(145);
  // Saturation through the matte: inside is gray, outside is byte-identical (+-1).
  expect(r.io.insideCount).toBeGreaterThan(5000);
  expect(r.io.insideChromatic).toBe(0);
  expect(r.io.outsideCount).toBeGreaterThan(50_000);
  expect(r.io.outsideChanged).toBe(0);
  expect(r.gradedVsUngraded).toBeGreaterThan(0.05);
  expect(r.gradedVsUngraded).toBeLessThan(0.14);
  // One undo step per edit; the matte view and eyedropper arming are not edits.
  expect(r.historyDeltaForMatteToggles).toBe(0);
  expect(r.historyDeltaForGrade).toBe(1);
  expect(r.undoResidual).toBe(0);
  expect(r.paramsHaveMatteView).toBe(false);
});

test("matte view colour / gray / bypass render and never touch the project", async ({ page }) => {
  test.setTimeout(180_000);
  const clipId = await openBarsClip(page);
  await addSecondaryViaUi(page);
  const [sec] = await secondaries(page, clipId);
  await updateSecondary(page, clipId, sec.id, { hueMin: 100, hueMax: 140, satMin: 40, lumMin: 10, lumMax: 90 });
  await snap(page, "plain");
  const before = JSON.stringify((await secondaries(page, clipId))[0]);
  const history = (await readState(page)).historyLength;

  await page.getByRole("button", { name: "Show mask Gray 1", exact: true }).click();
  await settle(page, 900);
  await snap(page, "gray");
  const grayChroma = await meanChroma(page, "gray", { x0: 0, y0: 0, x1: 1, y1: 1 });
  expect(grayChroma).toBeLessThan(1.5);

  await page.getByRole("button", { name: "Show mask Color 1", exact: true }).click();
  await settle(page, 900);
  await snap(page, "color");
  const diff = await diffSnaps(page, "plain", "color");
  expect(diff.changed / diff.total).toBeGreaterThan(0.5);

  await page.getByRole("button", { name: "Show mask Off 1", exact: true }).click();
  await settle(page, 900);
  await snap(page, "off");
  expect((await diffSnaps(page, "plain", "off")).changed).toBe(0);
  expect(JSON.stringify((await secondaries(page, clipId))[0])).toBe(before);
  expect((await readState(page)).historyLength).toBe(history);
});

test("a stack of secondaries: two cards, each corrects its own matte, keyframes drive the first", async ({ page }) => {
  test.setTimeout(240_000);
  const clipId = await openBarsClip(page);
  await addSecondaryViaUi(page);
  await addSecondaryViaUi(page);
  const both = await secondaries(page, clipId);
  expect(both).toHaveLength(2);
  expect(await page.getByTestId("hsl-secondary-0").count()).toBe(1);
  expect(await page.getByTestId("hsl-secondary-1").count()).toBe(1);

  // Secondary 1 desaturates the reds, secondary 2 the blues (hue ranges disjoint).
  await updateSecondary(page, clipId, both[0].id, { hueMin: 345, hueMax: 15, satMin: 40, saturation: -100 });
  await updateSecondary(page, clipId, both[1].id, { hueMin: 225, hueMax: 255, satMin: 40, saturation: -100 });
  await snap(page, "stack");
  const w = 1 / 7;
  const red = await meanChroma(page, "stack", { x0: 5 * w + 0.01, y0: 0.05, x1: 6 * w - 0.01, y1: 0.55 });
  const blue = await meanChroma(page, "stack", { x0: 6 * w + 0.01, y0: 0.05, x1: 1 - 0.01, y1: 0.55 });
  const green = await meanChroma(page, "stack", { x0: 3 * w + 0.01, y0: 0.05, x1: 4 * w - 0.01, y1: 0.55 });
  expect(red).toBeLessThan(3);
  expect(blue).toBeLessThan(3);
  expect(green).toBeGreaterThan(100);

  // Keyframes drive the first secondary: a keyframe added from its diamond is stored on the clip.
  await page.getByRole("button", { name: "Keyframe saturation" }).first().click();
  await settle(page, 400);
  const keyframes = await page.evaluate(
    (id) => {
      const state = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E.project.getState();
      return (state.getClip(id)?.keyframes ?? []).map((k: { property: string }) => k.property);
    },
    clipId,
  );
  // Keyframes are keyed by effect instance (fx:<effectId>:<param>), so the first card owns this one.
  expect(keyframes).toContain(`fx:${both[0].id}:saturation`);
});

test("comparison view: side by side and draggable split show both frames; Shift+C toggles; Program canvas untouched", async ({ page }) => {
  test.setTimeout(240_000);
  const clipId = await openBarsClip(page);
  await addSecondaryViaUi(page);
  const [sec] = await secondaries(page, clipId);
  // Whole-frame desaturation so the graded and ungraded halves are unmistakable.
  await updateSecondary(page, clipId, sec.id, { saturation: -100, satSoft: 0 });
  await snap(page, "graded-program");
  const gradedChroma = await meanChroma(page, "graded-program", { x0: 0, y0: 0.05, x1: 1, y1: 0.55 });
  expect(gradedChroma).toBeLessThan(1.5);

  // Keyboard toggle (Shift+C) opens the comparison against the ungraded frame.
  await press(page, "Shift+c");
  const overlay = page.getByTestId("comparison-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute("data-mode", "split-v");
  await expect(overlay).toHaveAttribute("data-reference", "bypass");
  await settle(page, 1800);

  // Split at 50%: left half = ungraded reference (colourful), right half = graded current (gray).
  let size = await snapOverlay(page, "split");
  const leftHalf = await chromaOfSnap(page, "split", size, { x0: 0.02, y0: 0.05, x1: 0.48, y1: 0.55 });
  const rightHalf = await chromaOfSnap(page, "split", size, { x0: 0.52, y0: 0.05, x1: 0.98, y1: 0.55 });
  console.log(`[color-secondary] split 50%: left chroma=${leftHalf.toFixed(1)} right chroma=${rightHalf.toFixed(1)}`);
  expect(leftHalf).toBeGreaterThan(60);
  expect(rightHalf).toBeLessThan(1.5);

  // The Program canvas itself (what scopes and export read) is still the graded frame.
  await snap(page, "program-during-compare");
  expect((await diffSnaps(page, "graded-program", "program-during-compare")).changed).toBe(0);

  // Drag the wipe to ~25% with the mouse.
  const box = await overlay.boundingBox();
  const divider = page.getByTestId("comparison-divider");
  const dBox = await divider.boundingBox();
  if (!box || !dBox) throw new Error("no overlay geometry");
  await page.mouse.move(dBox.x + dBox.width / 2, dBox.y + dBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, dBox.y + dBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await settle(page, 500);
  expect(Number(await divider.getAttribute("aria-valuenow"))).toBeGreaterThan(20);
  expect(Number(await divider.getAttribute("aria-valuenow"))).toBeLessThan(30);
  size = await snapOverlay(page, "split25");
  const left25 = await chromaOfSnap(page, "split25", size, { x0: 0.02, y0: 0.05, x1: 0.22, y1: 0.55 });
  const right25 = await chromaOfSnap(page, "split25", size, { x0: 0.3, y0: 0.05, x1: 0.98, y1: 0.55 });
  expect(left25).toBeGreaterThan(60);
  expect(right25).toBeLessThan(1.5);

  // Horizontal wipe: reference on top, current below.
  await page.getByRole("button", { name: /Comparison View/ }).first().click();
  await settle(page, 300);
  await page.getByRole("button", { name: "Split —" }).click();
  await settle(page, 700);
  size = await snapOverlay(page, "splitH");
  await page.evaluate(() => (window as unknown as { __openreelE2E: { colorMonitor: { getState(): Record<string, any> } } }).__openreelE2E.colorMonitor.getState().setComparison({ split: 0.5 }));
  await settle(page, 500);
  size = await snapOverlay(page, "splitH");
  const top = await chromaOfSnap(page, "splitH", size, { x0: 0.05, y0: 0.05, x1: 0.95, y1: 0.4 });
  const bottom = await chromaOfSnap(page, "splitH", size, { x0: 0.05, y0: 0.6, x1: 0.95, y1: 0.66 });
  expect(top).toBeGreaterThan(60);
  expect(bottom).toBeLessThan(40);

  // Side by side: two full frames, ungraded left, graded right.
  await page.getByRole("button", { name: "Side by side" }).click();
  await settle(page, 700);
  size = await snapOverlay(page, "side");
  expect(size.width / size.height).toBeCloseTo(2 * (16 / 9), 1);
  const sideLeft = await chromaOfSnap(page, "side", size, { x0: 0.02, y0: 0.05, x1: 0.48, y1: 0.55 });
  const sideRight = await chromaOfSnap(page, "side", size, { x0: 0.52, y0: 0.05, x1: 0.98, y1: 0.55 });
  expect(sideLeft).toBeGreaterThan(60);
  expect(sideRight).toBeLessThan(1.5);

  // Toggle off; nothing about the project changed.
  await press(page, "Shift+c");
  await expect(overlay).toHaveCount(0);
  await settle(page, 700);
  await snap(page, "program-after");
  expect((await diffSnaps(page, "graded-program", "program-after")).changed).toBe(0);
});

test("comparison view: a grabbed still and a pinned playhead frame are valid references", async ({ page }) => {
  test.setTimeout(240_000);
  const clipId = await openBarsClip(page);
  await addSecondaryViaUi(page);
  const [sec] = await secondaries(page, clipId);
  // Grab the ungraded still first, then grade the whole frame.
  await page.getByRole("button", { name: /Comparison View/ }).first().click();
  await settle(page, 300);
  await page.getByRole("button", { name: "Grab still" }).click();
  await expect(page.getByRole("button", { name: /Use Still 1 as the reference/ })).toBeVisible();
  await updateSecondary(page, clipId, sec.id, { saturation: -100, satSoft: 0 });
  await page.getByRole("button", { name: "Split |" }).click();
  await settle(page, 1200);
  const overlay = page.getByTestId("comparison-overlay");
  await expect(overlay).toHaveAttribute("data-reference", "still");
  const size = await snapOverlay(page, "still-split");
  expect(await chromaOfSnap(page, "still-split", size, { x0: 0.02, y0: 0.05, x1: 0.48, y1: 0.55 })).toBeGreaterThan(60);
  expect(await chromaOfSnap(page, "still-split", size, { x0: 0.52, y0: 0.05, x1: 0.98, y1: 0.55 })).toBeLessThan(1.5);

  // Pin another playhead position (the red scene at 3s): the reference changes with it.
  await updateSecondary(page, clipId, sec.id, { saturation: 0 });
  await page.evaluate(() => (window as unknown as { __openreelE2E: { timeline: { getState(): Record<string, any> } } }).__openreelE2E.timeline.getState().seekTo(3));
  await settle(page, 900);
  await page.getByRole("button", { name: "Playhead", exact: true }).click();
  await page.evaluate(() => (window as unknown as { __openreelE2E: { timeline: { getState(): Record<string, any> } } }).__openreelE2E.timeline.getState().seekTo(5));
  await settle(page, 2200);
  await expect(overlay).toHaveAttribute("data-reference", "playhead");
  const pinned = await snapOverlay(page, "pinned");
  // Left (reference): solid red scene => strong red channel, little blue.
  const left = await page.evaluate(
    ([k, w, h]) => {
      const d = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps[k as string];
      let r = 0;
      let b = 0;
      let n = 0;
      for (let y = Math.floor((h as number) * 0.1); y < (h as number) * 0.5; y++)
        for (let x = Math.floor((w as number) * 0.05); x < (w as number) * 0.45; x++) {
          const i = (y * (w as number) + x) * 4;
          r += d[i];
          b += d[i + 2];
          n++;
        }
      return [r / n, b / n];
    },
    ["pinned", pinned.width, pinned.height] as const,
  );
  expect(left[0]).toBeGreaterThan(150);
  expect(left[1]).toBeLessThan(60);
  // The playhead really is back on the bars.
  expect((await readState(page)).playhead).toBeCloseTo(5, 1);
});

test("shader and CPU reference agree on synthetic gradients (WebGL2 path vs software path)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { __openreelE2E?: unknown }).__openreelE2E));
  const report = await page.evaluate(() => {
    const e = (window as unknown as { __openreelE2E: { secondary: Record<string, any> } }).__openreelE2E.secondary;
    const W = 192;
    const H = 108;
    // Hue sweeps left to right, luma falls top to bottom, saturation ramps over the bottom third.
    const src = new Uint8ClampedArray(W * H * 4);
    const hsl = (h: number, s: number, l: number): [number, number, number] => {
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const m = l - c / 2;
      const sector = Math.floor(h / 60) % 6;
      const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector];
      return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
    };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const s = y > (H * 2) / 3 ? 0.2 + 0.8 * ((x % 24) / 24) : 1;
        const [r, g, b] = hsl((x / W) * 359, s, 0.2 + 0.6 * (1 - y / H));
        src.set([Math.round(r), Math.round(g), Math.round(b), 255], (y * W + x) * 4);
      }
    const base = {
      hueMin: 90, hueMax: 200, hueSoft: 20, satMin: 30, satMax: 100, satSoft: 15, lumMin: 15, lumMax: 85, lumSoft: 15,
    };
    const cases: Record<string, Record<string, unknown>> = {
      saturation: { ...base, saturation: -80 },
      "temp+tint+contrast": { ...base, temperature: 60, tint: -40, contrast: 35, saturation: 0 },
      wheel: { ...base, wheelX: 0.7, wheelY: -0.4, saturation: 0 },
      sharpen: { ...base, sharpen: 80, saturation: 0 },
      "blur+denoise": { ...base, blur: 6, denoise: 40, saturation: -100 },
      invert: { ...base, invert: true, saturation: -100 },
      "wrap hue": { ...base, hueMin: 300, hueMax: 40, saturation: -100 },
      "ellipse limit": { ...base, hueMin: 0, hueMax: 360, maskShape: "ellipse", maskFeather: 18, saturation: -100 },
      "rectangle limit inverted": { ...base, hueMin: 0, hueMax: 360, maskShape: "rectangle", maskInvert: true, maskFeather: 8, saturation: -100 },
      "matte b/w": { ...base, matteView: 3 },
      "matte gray blur": { ...base, matteView: 2, blur: 4 },
    };
    const supported = Boolean(e.MotionShaderRenderer.isSupported());
    const rows: Array<Record<string, number | string>> = [];
    const renderer = supported ? new e.MotionShaderRenderer() : null;
    for (const [name, params] of Object.entries(cases)) {
      const cpu = new Uint8ClampedArray(src);
      e.applyProEffect("hsl-secondary", params, cpu, W, H);
      if (!renderer) {
        rows.push({ name, gpu: "unsupported" });
        continue;
      }
      const input = document.createElement("canvas");
      input.width = W;
      input.height = H;
      const ictx = input.getContext("2d", { willReadFrequently: true })!;
      ictx.putImageData(new ImageData(new Uint8ClampedArray(src), W, H), 0, 0);
      const out = renderer.render(e.PRO_EFFECT_SHADER_DEFS["hsl-secondary"], {
        width: W,
        height: H,
        time: 0,
        params: e.proEffectGpuUniforms("hsl-secondary", params, H),
        inputCanvas: input,
        strict: true,
      });
      if (!out) {
        rows.push({ name, gpu: "render-failed" });
        continue;
      }
      const c2 = document.createElement("canvas");
      c2.width = W;
      c2.height = H;
      const g2 = c2.getContext("2d", { willReadFrequently: true })!;
      g2.drawImage(out, 0, 0, W, H);
      const gpu = g2.getImageData(0, 0, W, H).data;
      let sum = 0;
      let max = 0;
      let over = 0;
      let moved = 0;
      for (let i = 0; i < gpu.length; i += 4)
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(gpu[i + k] - cpu[i + k]);
          sum += d;
          if (d > max) max = d;
          if (d > 3) over++;
          if (Math.abs(cpu[i + k] - src[i + k]) > 8) moved++;
        }
      rows.push({ name, mean: sum / (W * H * 3), max, overFraction: over / (W * H * 3), movedFraction: moved / (W * H * 3), gpu: "ok" });
    }
    return { supported, rows };
  });
  console.log(`[color-secondary] shader parity (WebGL2 supported=${report.supported})\n` + report.rows.map((r) => JSON.stringify(r)).join("\n"));
  test.skip(!report.supported, "WebGL2 unavailable in this browser: the CPU reference is the only path here");
  for (const row of report.rows) {
    expect(row.gpu, String(row.name)).toBe("ok");
    expect(row.mean as number, `${row.name} mean abs diff`).toBeLessThan(0.6);
    expect(row.overFraction as number, `${row.name} share of channels off by more than 3`).toBeLessThan(0.001);
    // The B/W view thresholds the matte at 0.5, so a pixel sitting exactly on the
    // threshold may flip between the paths (a handful of pixels); everything else is +-1.
    if (row.name !== "matte b/w") expect(row.max as number, `${row.name} max diff`).toBeLessThanOrEqual(2);
    else expect(row.overFraction as number, "matte b/w flipped pixels").toBeLessThan(0.001);
    // The case must actually do something (guards against comparing two no-ops).
    expect(row.movedFraction as number, `${row.name} moved`).toBeGreaterThan(0.002);
  }
});

test("scopes read the secondary result: program saturation stats drop", async ({ page }) => {
  test.setTimeout(180_000);
  const clipId = await openBarsClip(page);
  await addSecondaryViaUi(page);
  const [sec] = await secondaries(page, clipId);
  const stats = () =>
    page.evaluate(() => {
      const e = (window as unknown as { __openreelE2E: { secondary: Record<string, any> } }).__openreelE2E.secondary;
      const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
      const w = 320;
      const h = Math.round((c.height / c.width) * w);
      const t = document.createElement("canvas");
      t.width = w;
      t.height = h;
      const g = t.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(c, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h);
      return e.computeScopeStats({ data: d.data, width: w, height: h }).saturation;
    });
  const before = await stats();
  await updateSecondary(page, clipId, sec.id, { saturation: -100, satSoft: 0 });
  const after = await stats();
  console.log(`[color-secondary] scope saturation avg ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  expect(after.average).toBeLessThan(before.average * 0.5);
});
