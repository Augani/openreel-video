import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { clickClip, clipsOf, diffSnaps, openEditor, openHookPage, readState, seek, settle, snapStable } from "./helpers";

/**
 * Echo and Posterize Time (Premiere "Time" effects), in a real browser:
 *  - the Effects panel lists both under the Time filter and previews them on real footage;
 *  - Posterize Time holds the program frame: the monitor shows exactly the frame the unprocessed clip shows at the
 *    start of the held interval;
 *  - Echo through the real VideoEngine equals the reference composite of the plain frames at t - k * echoTime for
 *    all six operators, in preview mode and in export mode, whatever order the frames are rendered in;
 *  - the Canvas2D echo compositor matches the pure per-pixel definition.
 * Shared by the gpu project (time-effects.spec.ts) and the fallback projects (fallback-time-effects.spec.ts).
 */

interface Hook {
  project: { getState(): { project: any } };
  video: { getVideoEngine(): { exportMode: boolean; renderFrame(project: unknown, t: number, w: number, h: number): Promise<{ image: ImageBitmap }> } };
  effectPreviews: () => { render(def: unknown, index: number, priority: string): Promise<ImageBitmap | null> } | null;
  core: { temporalEffects: any; echoCompositor: any };
}

const cardCanvas = (label: string) => `button[aria-label^="${label}. Drag"] canvas`;

async function waitForPoster(page: Page, label: string): Promise<void> {
  await page.locator(cardCanvas(label)).first().scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.locator(cardCanvas(label)).first().getAttribute("data-preview-state"), { timeout: 40_000, message: `poster for ${label}` })
    .toBe("poster");
}

export function registerTimeEffectTests(): void {
  test("the echo compositor draws the six operators exactly like the per-pixel definition", async ({ page }) => {
    test.setTimeout(120_000);
    await openHookPage(page);
    const result = await page.evaluate(async () => {
      const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
      const { temporalEffects: te, echoCompositor: ec } = h.core;
      const W = 48;
      const H = 32;
      // Frames with full-range, spatially varying colour and (optionally) partly translucent content.
      const frame = (seed: number, alphaAt: (x: number, y: number) => number) => {
        const canvas = new OffscreenCanvas(W, H);
        const g = canvas.getContext("2d", { willReadFrequently: true })!;
        const img = g.createImageData(W, H);
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            img.data[i] = (x * 5 + seed * 70) % 256;
            img.data[i + 1] = (y * 8 + seed * 40) % 256;
            img.data[i + 2] = ((x + y) * 3 + seed * 110) % 256;
            img.data[i + 3] = alphaAt(x, y);
          }
        g.putImageData(img, 0, 0);
        return { canvas, pixels: img.data };
      };
      const bases = {
        opaque: frame(0, () => 255),
        translucent: frame(0, (x) => (x < 12 ? 0 : x < 24 ? 128 : 255)),
      };
      const echoFrames = [frame(1, () => 255), frame(2, (_x, y) => (y < 10 ? 160 : 255))];
      const compositor = new ec.EchoCompositor();
      const out: Array<{ operator: string; frame: string; maxDiff: number; changed: boolean }> = [];
      for (const operator of te.ECHO_OPERATORS as string[]) {
        for (const [name, source] of Object.entries(bases)) {
          const echo = { operator, startIntensity: 0.8 };
          const ordered = te.echoCompositeOrder(
            [
              { k: 1, weight: 0.5 },
              { k: 2, weight: 0.25 },
            ],
            operator,
          ) as Array<{ k: number; weight: number }>;
          const bitmap = await createImageBitmap(source.canvas);
          const drawn = compositor.draw(
            bitmap,
            ordered.map((s) => ({ image: echoFrames[s.k - 1].canvas, weight: s.weight })),
            echo,
          ) as OffscreenCanvas;
          const got = drawn.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
          const expected = te.compositeEchoReference(
            source.pixels,
            ordered.map((s) => ({ data: echoFrames[s.k - 1].pixels, weight: s.weight })),
            echo,
          ) as Uint8ClampedArray;
          let maxDiff = 0;
          let changed = false;
          for (let i = 0; i < expected.length; i += 4) {
            // Where the result is transparent its colour is undefined: weigh colour error by alpha.
            const weight = Math.max(got[i + 3], expected[i + 3]) / 255;
            maxDiff = Math.max(maxDiff, Math.abs(got[i + 3] - expected[i + 3]));
            for (let c = 0; c < 3; c++) maxDiff = Math.max(maxDiff, Math.abs(got[i + c] - expected[i + c]) * weight);
            if (expected[i] !== source.pixels[i] || expected[i + 1] !== source.pixels[i + 1]) changed = true;
          }
          out.push({ operator, frame: name, maxDiff, changed });
        }
      }
      return out;
    });
    for (const r of result) {
      console.log(`[time-effects] ${r.operator}/${r.frame}: max diff ${r.maxDiff}`);
      expect(r.maxDiff, `${r.operator} on ${r.frame} frame vs reference`).toBeLessThanOrEqual(3);
    }
    // the references are not trivially the identity
    expect(result.filter((r) => r.frame === "opaque" && r.operator !== "composite-back").every((r) => r.changed)).toBe(true);
  });

  test("Posterize Time holds the frame the unprocessed clip shows at the start of the held interval", async ({ page }) => {
    test.setTimeout(240_000);
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);

    // Plain frames of the moving testsrc2 scene (0-2 s) before the effect exists.
    const plain: Record<string, number> = { 0: 0, 1: 1 };
    for (const t of Object.values(plain)) {
      await seek(page, t);
      await snapStable(page, `plain-${t}`);
    }
    expect((await diffSnaps(page, "plain-0", "plain-1")).changed, "the footage moves between 0 s and 1 s").toBeGreaterThan(2000);

    // Add it from the Effects panel Time filter like a user does.
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await settle(page, 500);
    await page.getByRole("group", { name: "Effect categories" }).getByRole("button", { name: "Time", exact: true }).click();
    await expect(page.locator('button[aria-label^="Echo. Drag"]')).toBeVisible();
    const card = page.locator('button[aria-label^="Posterize Time. Drag"]');
    await expect(card).toBeVisible();
    await card.dblclick();
    await expect.poll(async () => clipsOf(await readState(page), "Main")[0].effects, { timeout: 15_000 }).toBe(1);
    const params = await page.evaluate(() => {
      const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
      return h.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).flatMap((c: any) => c.effects);
    });
    expect(params).toEqual([expect.objectContaining({ type: "posterize-time", enabled: true, params: { frameRate: 1 } })]);

    // 1 fps: 0.2 s and 0.9 s are both the frame at 0 s; 1.2 s is the frame at 1 s.
    const shown = async (t: number, key: string) => {
      await seek(page, t);
      await snapStable(page, key);
    };
    await shown(0.2, "held-0.2");
    await shown(0.9, "held-0.9");
    await shown(1.2, "held-1.2");
    for (const [a, b] of [["held-0.2", "held-0.9"], ["held-0.2", "plain-0"], ["held-0.2", "plain-1"], ["held-1.2", "plain-1"], ["held-1.2", "plain-0"]])
      console.log(`[time-effects] ${a} vs ${b}: ${(await diffSnaps(page, a, b)).changed} px`);
    const tolerance = 150; // pixels of 230400 (colour pipeline rounding of an identical source frame)
    expect((await diffSnaps(page, "held-0.2", "plain-0")).changed, "0.2 s shows the 0 s frame").toBeLessThanOrEqual(tolerance);
    expect((await diffSnaps(page, "held-0.9", "plain-0")).changed, "0.9 s shows the 0 s frame").toBeLessThanOrEqual(tolerance);
    expect((await diffSnaps(page, "held-1.2", "plain-1")).changed, "1.2 s shows the 1 s frame").toBeLessThanOrEqual(tolerance);
    expect((await diffSnaps(page, "held-0.9", "held-1.2")).changed, "the held frame changes at the next boundary").toBeGreaterThan(2000);
  });

  test("Echo applied from the Effects panel shows in the program monitor exactly as the engine renders it", async ({ page }) => {
    test.setTimeout(240_000);
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);
    await seek(page, 1);
    await snapStable(page, "plain");
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await settle(page, 500);
    await page.getByRole("group", { name: "Effect categories" }).getByRole("button", { name: "Time", exact: true }).click();
    await page.locator('button[aria-label^="Echo. Drag"]').dblclick();
    await expect.poll(async () => clipsOf(await readState(page), "Main")[0].effects, { timeout: 15_000 }).toBe(1);
    const stored = await page.evaluate(() => {
      const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
      return h.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).flatMap((c: any) => c.effects);
    });
    expect(stored).toEqual([
      expect.objectContaining({ type: "echo", enabled: true, params: { echoTime: 0.033, echoes: 2, startIntensity: 1, decay: 0.5, operator: "add" } }),
    ]);
    await seek(page, 1);
    await snapStable(page, "echo");
    expect((await diffSnaps(page, "plain", "echo")).changed, "the monitor shows the echo").toBeGreaterThan(2000);

    // The monitor frame is the engine frame: compare pixel by pixel.
    const maxDiff = await page.evaluate(async () => {
      const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
      const canvas = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
      const frame = await h.video.getVideoEngine().renderFrame(h.project.getState().project, 1, canvas.width, canvas.height);
      const read = (source: CanvasImageSource) => {
        const c = new OffscreenCanvas(canvas.width, canvas.height);
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(source, 0, 0, canvas.width, canvas.height);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      const a = read(canvas);
      const b = read(frame.image);
      let worst = 0;
      for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(a[i + c] - b[i + c]));
      return worst;
    });
    console.log(`[time-effects] monitor vs engine frame: max channel diff ${maxDiff}`);
    expect(maxDiff).toBeLessThanOrEqual(3);
  });

  test("an exported file holds the posterized frames", async ({ page }) => {
    test.setTimeout(600_000);
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await settle(page, 500);
    await page.getByRole("group", { name: "Effect categories" }).getByRole("button", { name: "Time", exact: true }).click();
    await page.locator('button[aria-label^="Posterize Time. Drag"]').dblclick();
    await expect.poll(async () => clipsOf(await readState(page), "Main")[0].effects, { timeout: 15_000 }).toBe(1);
    await seek(page, 0);
    await page.getByRole("button", { name: "Export", exact: true }).first().click();
    await settle(page, 1500);
    const download = page.waitForEvent("download", { timeout: 540_000 });
    await page.getByRole("button", { name: "Export Video" }).last().click();
    const out = join(tmpdir(), `openreel-posterize-time-${Date.now()}.mp4`);
    await (await download).saveAs(out);

    const W = 160;
    const H = 90;
    const frameAt = (t: number): Buffer =>
      execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", out, "-frames:v", "1", "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {
        maxBuffer: 64 * 1024 * 1024,
      });
    const meanDiff = (a: Buffer, b: Buffer): number => {
      let total = 0;
      for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
      return total / a.length;
    };
    // 1 fps: 0.1 s, 0.5 s and 0.9 s are the frame at 0 s; 1.1 s and 1.6 s are the frame at 1 s.
    const f01 = frameAt(0.1);
    const f05 = frameAt(0.5);
    const f09 = frameAt(0.9);
    const f11 = frameAt(1.1);
    const f16 = frameAt(1.6);
    console.log(`[time-effects] export held diffs: ${[meanDiff(f01, f05), meanDiff(f05, f09), meanDiff(f11, f16)].map((v) => v.toFixed(2))}, across ${meanDiff(f09, f11).toFixed(2)}`);
    for (const held of [meanDiff(f01, f05), meanDiff(f05, f09), meanDiff(f11, f16)]) expect(held, "frames inside a posterized frame are the same picture").toBeLessThan(1.5);
    expect(meanDiff(f09, f11), "the picture changes at the next posterized frame").toBeGreaterThan(6);
  });

  test("Echo and Posterize Time cards preview real footage frames", async ({ page }) => {
    test.setTimeout(240_000);
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);
    await seek(page, 0.5);
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await settle(page, 600);
    await page.getByRole("group", { name: "Effect categories" }).getByRole("button", { name: "Time", exact: true }).click();
    await waitForPoster(page, "Echo");
    await waitForPoster(page, "Posterize Time");
    for (const label of ["Echo", "Posterize Time"]) {
      expect(await page.locator(cardCanvas(label)).first().getAttribute("data-preview-source"), `${label} card shows decoded footage`).toBe("footage");
    }
    await expect(page.locator('button[aria-label^="Posterize Time. Drag"]')).toContainText("Hover to play");
    await expect(page.locator('button[aria-label^="Echo. Drag"]')).not.toContainText("Hover to play");

    // The frames the engine renders for the cards, compared pixel by pixel.
    const read = await page.evaluate(async () => {
      const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
      const engine = h.effectPreviews();
      if (!engine) throw new Error("no preview engine");
      const grab = async (def: unknown, index: number) => {
        const bmp = await engine.render(def, index, "hover");
        if (!bmp) throw new Error("no bitmap");
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(bmp, 0, 0);
        return Array.from(g.getImageData(0, 0, c.width, c.height).data.filter((_, i) => i % 4 !== 3));
      };
      const frames: Record<string, number[]> = {};
      for (let i = 0; i < 7; i++) frames[`held${i}`] = await grab({ id: "e2e-posterize-time", type: "posterize-time" }, i);
      frames.plain9 = await grab({ id: "e2e-neutral-echo", type: "echo", params: { echoes: 0 } }, 9);
      frames.echo9 = await grab({ id: "e2e-echo", type: "echo" }, 9);
      frames.echo0 = await grab({ id: "e2e-echo", type: "echo" }, 0);
      frames.plain0 = await grab({ id: "e2e-neutral-echo", type: "echo", params: { echoes: 0 } }, 0);
      const diff = (a: number[], b: number[]) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0) / a.length;
      return {
        heldPairs: [diff(frames.held0, frames.held1), diff(frames.held1, frames.held2), diff(frames.held2, frames.held3), diff(frames.held3, frames.held4), diff(frames.held5, frames.held6)],
        echoVsPlain: diff(frames.echo9, frames.plain9),
        firstFrameEcho: diff(frames.echo0, frames.plain0),
      };
    });
    // 3 window frames per held frame: 0-2 identical, 3-5 identical, 6 new.
    expect(read.heldPairs[0]).toBe(0);
    expect(read.heldPairs[1]).toBe(0);
    expect(read.heldPairs[2], "held frame changes after three window frames").toBeGreaterThan(0.01);
    expect(read.heldPairs[3]).toBe(0);
    expect(read.heldPairs[4], "second held frame ends at window frame 6").toBeGreaterThan(0.01);
    expect(read.echoVsPlain, "Echo trails earlier window frames behind the current one").toBeGreaterThan(0.05);
    expect(read.firstFrameEcho, "nothing is behind the first frame of the window").toBe(0);
  });

  test("Echo through the VideoEngine equals the reference composite of t - k * echoTime for every operator, in preview and export", async ({ page }) => {
    test.setTimeout(300_000);
    await openEditor(page);
    const result = await page.evaluate(async () => {
      const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
      const te = h.core.temporalEffects;
      const engine = h.video.getVideoEngine();
      const project = h.project.getState().project;
      const W = 640;
      const H = 360;
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
      const pixels = async (p: unknown, t: number): Promise<Uint8ClampedArray> => {
        const frame = await engine.renderFrame(p, t, W, H);
        const c = new OffscreenCanvas(frame.image.width, frame.image.height);
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(frame.image, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      const plainProject = withEffects([]);
      const plain = async (t: number) => pixels(plainProject, t);
      const out: Array<Record<string, unknown>> = [];
      for (const operator of te.ECHO_OPERATORS as string[]) {
        const params = { echoTime: 0.1, echoes: 2, startIntensity: 0.8, decay: 0.5, operator };
        const echoProject = withEffects([{ id: "e2e-echo", type: "echo", enabled: true, params }]);
        const t = 1.2;
        const echo = te.resolveEcho(params);
        const plan = te.planEcho(t, 2, echo) as Array<{ k: number; localTime: number; weight: number }>;
        const expected = te.compositeEchoReference(
          await plain(t),
          await Promise.all(plan.map(async (s) => ({ data: await plain(s.localTime), weight: s.weight }))),
          echo,
        ) as Uint8ClampedArray;
        const runs: Uint8ClampedArray[] = [];
        for (const exportMode of [false, true]) {
          engine.exportMode = exportMode;
          // other positions first: the result must not depend on what was rendered before
          await pixels(echoProject, 0.4);
          await pixels(echoProject, 1.9);
          runs.push(await pixels(echoProject, t));
        }
        engine.exportMode = false;
        let maxDiff = 0;
        let previewVsExport = 0;
        let differsFromPlain = 0;
        const base = await plain(t);
        for (let i = 0; i < expected.length; i += 4) {
          for (let c = 0; c < 3; c++) {
            maxDiff = Math.max(maxDiff, Math.abs(runs[0][i + c] - expected[i + c]));
            previewVsExport = Math.max(previewVsExport, Math.abs(runs[0][i + c] - runs[1][i + c]));
          }
          if (Math.abs(runs[0][i] - base[i]) > 6 || Math.abs(runs[0][i + 1] - base[i + 1]) > 6) differsFromPlain++;
        }
        out.push({ operator, planned: plan.map((s) => s.localTime), maxDiff, previewVsExport, differsFromPlain: differsFromPlain / (expected.length / 4) });
      }
      return out;
    });
    for (const r of result as Array<{ operator: string; planned: number[]; maxDiff: number; previewVsExport: number; differsFromPlain: number }>) {
      console.log(`[time-effects] engine echo ${r.operator}: reference diff ${r.maxDiff}, preview vs export ${r.previewVsExport}, changed ${(r.differsFromPlain * 100).toFixed(1)}%`);
      expect(r.planned.map((v) => Number(v.toFixed(3)))).toEqual(r.operator === "composite-front" ? [1, 1.1] : [1.1, 1]);
      expect(r.maxDiff, `${r.operator} engine frame vs reference composite`).toBeLessThanOrEqual(4);
      expect(r.previewVsExport, `${r.operator} preview == export`).toBe(0);
      // Composite in Back of an opaque frame is invisible by definition; every other operator changes the picture
      if (r.operator !== "composite-back") expect(r.differsFromPlain, `${r.operator} changes the picture`).toBeGreaterThan(0.01);
    }
  });
}
