import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { openEditor, seek, settle } from "./helpers";

/**
 * Wave 18: more of an HDR project stays in float. Browser half.
 *
 *   1. The WebGL2 half-float compositor matches the Float32 CPU reference for the new stages: LUT (three spaces),
 *      HSL bands, vignette, blur / sharpen / glow, crossfade and dip draws, and graphics white.
 *   2. The real VideoEngine sends graded + effected clips, crossfades and dips to the float compositor in a Rec.2020
 *      project (spying on the compositor), and its GPU and forced-CPU renders of that frame agree.
 *   3. SDR projects are byte-identical: pixel hashes of a set of Rec.709 frames (plain, graded with LUT / HSL /
 *      vignette, with effects, with a crossfade and a dip) are written to SDR_HASH_OUT and compared with
 *      SDR_BASELINE_HASHES (hashes produced by the same spec on commit 971b5a8b, before this wave).
 *
 * Runs in the "gpu" project only.
 */

interface Hooks {
  hdrWorking: Record<string, any>;
  hdrGpu: Record<string, any>;
  colorOutput: Record<string, any>;
}

async function openHook(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { __openreelE2E?: unknown }).__openreelE2E, undefined, { timeout: 60_000 });
}

test("half-float GPU compositor matches the CPU reference for LUT, HSL, vignette, effects, dips and graphics white", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await openHook(page);
  const result = await page.evaluate(async () => {
    const core = (window as unknown as { __openreelE2E: { core: Hooks } }).__openreelE2E.core;
    const hw = core.hdrWorking;
    if (!core.hdrGpu.isGpuHdrAvailable()) return { skipped: "no WebGL2 with EXT_color_buffer_float" };

    const W = 192;
    const H = 108;
    const SW = 160;
    const SH = 90;
    const pq = core.colorOutput.pqEncodeNits as (n: number) => number;
    // 16-bit PQ layer: luma 20..1500 nits left to right with a few hard bright dots and edges for the effects.
    const codes = new Uint16Array(SW * SH * 4);
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        let nits = 20 + (1480 * x) / (SW - 1);
        if ((x + y * 3) % 37 === 0) nits = 4000;
        if (x > 60 && x < 70) nits = 900;
        const r = pq(nits * (0.6 + 0.4 * (y / (SH - 1))));
        const g = pq(nits * 0.8);
        const b = pq(nits * (1 - 0.5 * (y / (SH - 1))));
        const o = (y * SW + x) * 4;
        codes[o] = Math.round(r * 65535);
        codes[o + 1] = Math.round(g * 65535);
        codes[o + 2] = Math.round(b * 65535);
        codes[o + 3] = 65535;
      }
    }
    const codes2 = new Uint16Array(SW * SH * 4);
    for (let i = 0; i < SW * SH; i++) {
      const v = Math.round(pq(300 + 700 * ((i % SW) / SW)) * 65535);
      codes2.set([v, Math.round(v * 0.9), Math.round(v * 0.7), 65535], i * 4);
    }

    const overlayCanvas = new OffscreenCanvas(W, H);
    const octx = overlayCanvas.getContext("2d")!;
    octx.fillStyle = "rgba(20,120,220,0.5)";
    octx.fillRect(10, 10, 80, 30);
    octx.fillStyle = "#ffffff";
    octx.fillRect(10, 90, 150, 8);

    // A non-trivial 9^3 LUT (teal / orange push plus a gamma lift), 0..255.
    const N = 9;
    const lutData: number[] = [];
    for (let b = 0; b < N; b++)
      for (let g = 0; g < N; g++)
        for (let r = 0; r < N; r++) {
          const R = r / (N - 1);
          const G = g / (N - 1);
          const B = b / (N - 1);
          lutData.push(
            Math.round(255 * Math.min(1, Math.pow(R, 0.9) * 1.05)),
            Math.round(255 * Math.pow(G, 0.95)),
            Math.round(255 * Math.min(1, Math.pow(B, 1.1) + 0.04 * (1 - R))),
          );
        }

    const decode = hw.hdrSourceDecode({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false });
    const transform = {
      position: { x: 6, y: -3 },
      scale: { x: 0.85, y: 0.85 },
      rotation: 8,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
      fitMode: "contain",
    };
    const geometry = hw.computeLayerGeometry(transform, SW, SH, W, H);
    const identityGeometry = hw.computeLayerGeometry({ ...transform, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, fitMode: "stretch" }, SW, SH, W, H);
    const spec = core.colorOutput.resolveOutputColorSpec("rec2020", "pq");

    const hsl = { hue: [10, 0, -20, 0, 15, 0, 0, 0], saturation: [-0.3, 0.2, 0, 0, 0.25, 0, -0.2, 0], luminance: [0, 0.05, 0, 0, -0.05, 0, 0, 0.04] };
    const vignette = { amount: -0.6, midpoint: 0.35, roundness: 0.3, feather: 0.5 };
    const scenarios: Record<string, (comp: any) => void> = {};
    for (const space of ["srgb", "linear", "pq"]) {
      scenarios[`lut-${space}`] = (comp) => {
        const grade = hw.prepareHdrGrade({ lut: { data: lutData, size: N, intensity: 0.8, space } });
        comp.drawCodes({ depth: 16, width: SW, height: SH, data: codes }, decode, { geometry, opacity: 1, grade });
      };
    }
    scenarios["hsl-vignette"] = (comp) => {
      const grade = hw.prepareHdrGrade({ hsl, vignette, tone: { exposure: 0.1, contrast: 0.1, highlights: 0, shadows: 0, whites: 0, blacks: 0 } });
      comp.drawCodes({ depth: 16, width: SW, height: SH, data: codes }, decode, { geometry, opacity: 0.9, grade });
    };
    scenarios["effects"] = (comp) => {
      comp.drawCodes({ depth: 16, width: SW, height: SH, data: codes }, decode, {
        geometry,
        opacity: 1,
        grade: null,
        effects: [
          { type: "blur", radius: 2.5 },
          { type: "sharpen", amount: 60 },
          { type: "glow", radius: 4, intensity: 1.2, tint: [1, 0.8, 0.5] },
        ],
      });
    };
    scenarios["crossfade-dip-graphics"] = (comp) => {
      comp.setGraphicsWhite(400);
      comp.drawCodes({ depth: 16, width: SW, height: SH, data: codes }, decode, { geometry: identityGeometry, opacity: 1, grade: null });
      comp.drawCodes({ depth: 16, width: SW, height: SH, data: codes2 }, decode, { geometry: identityGeometry, opacity: 0.4, grade: null });
      comp.drawSolid([0, 0, 0], 0.25);
      comp.drawSolid([400 / 203, 400 / 203, 400 / 203], 0.1);
      comp.drawOverlay(overlayCanvas);
    };

    const cpu = new hw.CpuHdrCompositor();
    const gpu = new core.hdrGpu.GpuHdrCompositor();
    const out: Record<string, { frameMaxRel: number; overFraction: number; encMean: number; peak: number }> = {};
    for (const [name, run] of Object.entries(scenarios)) {
      const render = (comp: any) => {
        comp.begin(W, H);
        run(comp);
        return { frame: comp.readFrame(), enc: comp.readEncodedRgb(spec) };
      };
      const a = render(cpu);
      const b = render(gpu);
      let maxRel = 0;
      let over = 0;
      let peak = 0;
      for (let i = 0; i < a.frame.data.length; i++) {
        const diff = Math.abs(a.frame.data[i] - b.frame.data[i]);
        const rel = diff / Math.max(0.05, Math.abs(a.frame.data[i]));
        if (rel > maxRel) maxRel = rel;
        if (rel > 0.02) over++;
        if (i % 4 < 3) peak = Math.max(peak, b.frame.data[i]);
      }
      let encSum = 0;
      for (let i = 0; i < a.enc.length; i++) encSum += Math.abs(a.enc[i] - b.enc[i]);
      out[name] = { frameMaxRel: maxRel, overFraction: over / a.frame.data.length, encMean: encSum / a.enc.length, peak };
    }
    gpu.dispose();
    cpu.dispose();
    return out;
  });
  console.log(`[${testInfo.project.name}] hdr float effects parity: ${JSON.stringify(result)}`);
  if ("skipped" in result) test.skip(true, String((result as { skipped: string }).skipped));
  const r = result as Record<string, { frameMaxRel: number; overFraction: number; encMean: number; peak: number }>;
  for (const [name, m] of Object.entries(r)) {
    expect(m.overFraction, `${name} pixels off by more than 2 %`).toBeLessThan(0.01);
    expect(m.encMean, `${name} mean PQ encode difference`).toBeLessThan(0.003);
  }
  // Highlights above SDR white survive every stage in the half-float image.
  expect(r["effects"].peak).toBeGreaterThan(3);
  expect(r["lut-srgb"].peak).toBeGreaterThan(3);
});

/** Two adjacent clips of the fixture with a transition between them, effects and grading on the first. */
const BUILD_PROJECT = `
  (project, variant) => {
    const settings = { ...project.settings, width: 640, height: 360 };
    const track = project.timeline.tracks.find((t) => t.clips.length > 0 && (t.type === "video" || t.type === "image"));
    const base = track.clips[0];
    const N = 9;
    const lut = [];
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      lut.push(Math.round(255 * Math.min(1, Math.pow(r / 8, 0.9) * 1.05)), Math.round(255 * Math.pow(g / 8, 0.95)), Math.round(255 * Math.min(1, Math.pow(b / 8, 1.1) + 0.03)));
    }
    const grading = variant.graded ? {
      pipelineVersion: 2,
      tone: { exposure: 0.1, contrast: 0.15, highlights: -0.1, shadows: 0.1, whites: 0, blacks: 0 },
      lut: { data: lut, size: N, intensity: 0.7, space: "srgb" },
      hsl: { hue: [8, 0, -10, 0, 0, 0, 0, 0], saturation: [-0.2, 0.15, 0, 0, 0, 0, 0, 0], luminance: [0, 0, 0, 0, 0, 0, 0, 0] },
      vignette: { amount: -0.5, midpoint: 0.4, roundness: 0.2, feather: 0.5 },
    } : undefined;
    const effects = variant.effects ? [
      { id: "fx-blur", type: "blur", enabled: true, params: { radius: 3 } },
      { id: "fx-sharpen", type: "sharpen", enabled: true, params: { amount: 40 } },
      { id: "fx-glow", type: "glow", enabled: true, params: { radius: 5, intensity: 1, color: "#ffffff" } },
    ] : [];
    const clipA = { ...base, id: "wave18-a", startTime: 0, duration: 1.5, inPoint: 0, outPoint: 1.5, effects, colorGrading: grading };
    const clipB = { ...base, id: "wave18-b", startTime: 1.5, duration: 1.5, inPoint: 1.5, outPoint: 3, effects: [], colorGrading: undefined };
    const transitions = variant.transition ? [{ id: "wave18-t", clipAId: "wave18-a", clipBId: "wave18-b", type: variant.transition, duration: 0.6, params: {} }] : [];
    const tracks = project.timeline.tracks.map((t) => (t.id === track.id ? { ...t, clips: [clipA, clipB], transitions } : t));
    return { ...project, settings: { ...settings, ...(variant.settings ?? {}) }, timeline: { ...project.timeline, tracks, duration: 3 } };
  }
`;

test("VideoEngine: a Rec.2020 project keeps graded, effected clips, crossfades and dips on the float path; GPU and CPU renders agree", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await openEditor(page);
  await seek(page, 0.5);
  await settle(page);
  const result = await page.evaluate(async (buildSource) => {
    const h = (window as unknown as { __openreelE2E: any }).__openreelE2E;
    const engine = h.video.getVideoEngine();
    const build = (0, eval)(buildSource) as (p: any, v: any) => any;
    const base = h.project.getState().project;
    const readRgba = async (bitmap: ImageBitmap) => {
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const W = 320;
    const H = 180;
    engine.setHdrExportTarget(null);

    const calls: Array<{ type: string; effects?: number; lut?: boolean; hsl?: boolean; vignette?: boolean; opacity?: number; alpha?: number }> = [];
    const spy = () => {
      const comp = engine.hdrCompositor;
      if (!comp || comp.__spied) return;
      comp.__spied = true;
      const drawCodes = comp.drawCodes.bind(comp);
      comp.drawCodes = (codes: any, decode: any, draw: any) => {
        calls.push({ type: "codes", effects: draw.effects?.length ?? 0, lut: !!draw.grade?.lut, hsl: !!draw.grade?.hsl, vignette: !!draw.grade?.vignette, opacity: draw.opacity });
        return drawCodes(codes, decode, draw);
      };
      const drawSolid = comp.drawSolid.bind(comp);
      comp.drawSolid = (rgb: number[], alpha: number) => {
        calls.push({ type: "solid", alpha });
        return drawSolid(rgb, alpha);
      };
    };

    const hdrVariant = { graded: true, effects: true, settings: { workingColorSpace: "rec2020" } };
    const frames: Record<string, number[]> = {};
    const projectPlain = build(base, hdrVariant);
    // First render creates the compositor; the spy attaches after it.
    await (await engine.renderFrame(projectPlain, 0.5, W, H)).image.close();
    spy();

    calls.length = 0;
    const clipFrame = await engine.renderFrame(projectPlain, 0.5, W, H);
    const clipCalls = [...calls];
    const gpuClipPixels = await readRgba(clipFrame.image);
    const kind = engine.hdrCompositor.kind;

    calls.length = 0;
    const cross = build(base, { ...hdrVariant, transition: "crossfade" });
    const crossFrame = await engine.renderFrame(cross, 1.5, W, H);
    const crossCalls = [...calls];
    const crossPixels = await readRgba(crossFrame.image);

    calls.length = 0;
    const dip = build(base, { ...hdrVariant, transition: "dipToWhite" });
    await engine.renderFrame(dip, 1.35, W, H);
    const dipCalls = [...calls];

    calls.length = 0;
    const wipe = build(base, { ...hdrVariant, transition: "wipe" });
    await engine.renderFrame(wipe, 1.5, W, H);
    const wipeCalls = [...calls];

    // Same frame on the CPU reference.
    engine.hdrGpuFailed = true;
    engine.hdrCompositor.dispose();
    engine.hdrCompositor = null;
    const cpuClipPixels = await readRgba((await engine.renderFrame(projectPlain, 0.5, W, H)).image);
    const cpuCrossPixels = await readRgba((await engine.renderFrame(cross, 1.5, W, H)).image);
    const cpuKind = engine.hdrCompositor.kind;
    const meanAbs = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
      return s / a.length;
    };
    void frames;
    return {
      kind,
      cpuKind,
      clipCalls,
      crossCalls,
      dipCalls,
      wipeCalls,
      clipMeanAbs: meanAbs(gpuClipPixels, cpuClipPixels),
      crossMeanAbs: meanAbs(crossPixels, cpuCrossPixels),
    };
  }, BUILD_PROJECT);
  console.log(`[${testInfo.project.name}] engine float routing: ${JSON.stringify(result)}`);

  // A graded + effected clip is one float draw with its effects, LUT, HSL and vignette (not an 8-bit render).
  expect(result.clipCalls.filter((c) => c.type === "codes")).toHaveLength(1);
  expect(result.clipCalls[0]).toMatchObject({ type: "codes", effects: 3, lut: true, hsl: true, vignette: true });
  // Crossfade: outgoing at full strength, incoming at the eased progress (0.5 in the middle of the window).
  const cross = result.crossCalls.filter((c) => c.type === "codes");
  expect(cross).toHaveLength(2);
  expect(cross[0].opacity).toBeCloseTo(1, 3);
  expect(cross[1].opacity).toBeGreaterThan(0.3);
  expect(cross[1].opacity).toBeLessThan(0.7);
  // Dip to white: a solid layer is laid over the float image.
  expect(result.dipCalls.some((c) => c.type === "solid")).toBe(true);
  // A wipe is not a float transition: both clips go through the 8-bit transition engine, nothing is drawn as codes for them.
  expect(result.wipeCalls.filter((c) => c.type === "codes")).toHaveLength(0);
  expect(result.kind).toBe("gpu");
  expect(result.cpuKind).toBe("cpu");
  expect(result.clipMeanAbs).toBeLessThan(2);
  expect(result.crossMeanAbs).toBeLessThan(2);
});

test("SDR projects render byte-identically to the renderer before this wave", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await seek(page, 0.5);
  await settle(page);
  const result = await page.evaluate(async (buildSource) => {
    const h = (window as unknown as { __openreelE2E: any }).__openreelE2E;
    const engine = h.video.getVideoEngine();
    const build = (0, eval)(buildSource) as (p: any, v: any) => any;
    const base = h.project.getState().project;
    const W = 480;
    const H = 270;
    engine.setHdrExportTarget(null);
    const hash = async (bitmap: ImageBitmap): Promise<string> => {
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const digest = await crypto.subtle.digest("SHA-256", px);
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    };
    const cases: Array<{ name: string; variant: any; time: number }> = [
      { name: "plain@0.5", variant: {}, time: 0.5 },
      { name: "plain@2.2", variant: {}, time: 2.2 },
      { name: "graded@0.5", variant: { graded: true }, time: 0.5 },
      { name: "effects@0.5", variant: { effects: true }, time: 0.5 },
      { name: "graded+effects@1.0", variant: { graded: true, effects: true }, time: 1.0 },
      { name: "crossfade@1.5", variant: { graded: true, effects: true, transition: "crossfade" }, time: 1.5 },
      { name: "crossfade@1.3", variant: { transition: "crossfade" }, time: 1.3 },
      { name: "dipToWhite@1.35", variant: { transition: "dipToWhite" }, time: 1.35 },
      { name: "dipToBlack@1.65", variant: { transition: "dipToBlack" }, time: 1.65 },
      { name: "wipe@1.5", variant: { transition: "wipe" }, time: 1.5 },
    ];
    const hashes: Record<string, string> = {};
    for (const c of cases) {
      const frame = await engine.renderFrame(build(base, c.variant), c.time, W, H);
      hashes[c.name] = await hash(frame.image);
      frame.image.close();
    }
    // Rendering twice gives the same bytes (the comparison below would be meaningless otherwise).
    const again = await engine.renderFrame(build(base, cases[4].variant), cases[4].time, W, H);
    const repeat = await hash(again.image);
    again.image.close();
    return { hashes, repeatStable: repeat === hashes[cases[4].name], floatTouched: engine.hdrCompositor != null };
  }, BUILD_PROJECT);

  const out = process.env.SDR_HASH_OUT;
  if (out) writeFileSync(out, JSON.stringify(result.hashes, null, 2));
  await testInfo.attach("sdr-frame-hashes.json", { body: JSON.stringify(result.hashes, null, 2), contentType: "application/json" });
  console.log(`[${testInfo.project.name}] SDR frame hashes: ${JSON.stringify(result.hashes)}`);
  expect(result.floatTouched).toBe(false);
  expect(result.repeatStable).toBe(true);

  const baselinePath = process.env.SDR_BASELINE_HASHES;
  if (baselinePath && existsSync(baselinePath)) {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, string>;
    for (const [name, hash] of Object.entries(result.hashes)) {
      expect(hash, `${name} differs from the 971b5a8b renderer`).toBe(baseline[name]);
    }
  } else {
    testInfo.annotations.push({ type: "note", description: "SDR_BASELINE_HASHES not set: byte comparison against the pre-wave renderer not made" });
  }
});

test("user flow: Rec.2020 then HDR graphics white from Preview options, and the LUT colour space is offered", async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  const settings = () => page.evaluate(() => (window as unknown as { __openreelE2E: any }).__openreelE2E.project.getState().project.settings);
  await page.getByRole("button", { name: "Preview options" }).click();
  // Graphics white is an HDR setting: it is disabled while the project works in Rec.709.
  await expect(page.getByRole("menuitem", { name: "HDR graphics white" })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("menuitem", { name: "Working color space" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Rec.2020" }).click();
  await expect.poll(async () => (await settings()).workingColorSpace).toBe("rec2020");

  await page.getByRole("button", { name: "Preview options" }).click();
  await page.getByRole("menuitem", { name: "HDR graphics white" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: /203 nits/ })).toBeChecked();
  await page.getByRole("menuitemcheckbox", { name: "300 nits" }).click();
  await expect.poll(async () => (await settings()).graphicsWhiteNits).toBe(300);

  // Back to the default: the setting is cleared rather than stored as 203.
  await page.getByRole("button", { name: "Preview options" }).click();
  await page.getByRole("menuitem", { name: "HDR graphics white" }).click();
  await page.getByRole("menuitemcheckbox", { name: /203 nits/ }).click();
  await expect.poll(async () => (await settings()).graphicsWhiteNits).toBeUndefined();
});
