import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { clickClip, clipsOf, openEditor, readState, seek, settle } from "./helpers";

/**
 * Timecode and Clip Name burn-ins, on real pixels, in the three places a frame is drawn:
 *  - the Program monitor (the preview pipeline),
 *  - VideoEngine.renderFrame (what export calls for every frame),
 *  - a real exported MP4 (the "Burn in timecode" switch in the Export dialog), decoded with ffmpeg.
 * The fixture's second scene (2 s to 4 s) is solid red, so any near-white pixel there is burn-in text.
 * Shared by the gpu project (burn-in.spec.ts) and the fallback projects (fallback-burn-in.spec.ts).
 */

const PROGRAM = 'canvas[aria-label^="Program frame"]';
/** 29.97 fps drop-frame, starting at the broadcast hour. */
const START_TIMECODE = "01:00:00;00";
/** Red scene instants: frame 74 and frame 90 of 29.97 fps. */
const T1 = 2.5;
const T2 = 3.003;
const TEXT_T1 = "01:00:02;14";
const TEXT_T2 = "01:00:03;00";

interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Stats {
  width: number;
  height: number;
  /** Near-white pixels inside each named region. */
  white: Record<string, number>;
  /** Near-white pixels outside every named region. */
  whiteElsewhere: number;
}

/** Regions as fractions of the frame: the timecode band (bottom centre) and the name band (top left). */
const REGIONS = {
  timecode: { x0: 0.3, y0: 0.82, x1: 0.7, y1: 1 },
  name: { x0: 0, y0: 0, x1: 0.45, y1: 0.16 },
} as const;

async function useBroadcastSequence(page: Page): Promise<string> {
  await page.evaluate(async (startTimecode) => {
    const e = (window as any).__openreelE2E;
    await e.project.getState().updateSettings({ frameRate: 29.97, startTimecode });
  }, START_TIMECODE);
  const settings = await page.evaluate(() => (window as any).__openreelE2E.project.getState().project.settings);
  expect(settings.frameRate).toBeCloseTo(29.97, 2);
  expect(settings.startTimecode).toBe(START_TIMECODE);
  const [clip] = clipsOf(await readState(page), "Main");
  return clip.id;
}

async function addEffectFromInspector(page: Page, clipId: string, label: string): Promise<void> {
  await page.evaluate(
    (id) => (window as any).__openreelE2E.inspectorNav.getState().requestSection("video-effects", id),
    clipId,
  );
  await settle(page, 1000);
  await page.getByRole("button", { name: "Add Effect", exact: true }).first().click();
  await page.getByRole("searchbox", { name: "Search visual effects" }).fill(label);
  await page.getByRole("button", { name: `Preview and add ${label}`, exact: true }).click();
  await settle(page, 900);
}

/** Renders `time` through the real VideoEngine and measures near-white pixels per region. */
async function engineStats(page: Page, time: number, options?: Record<string, unknown>, withoutEffects = false): Promise<Stats> {
  return page.evaluate(
    async ([t, opts, strip, regions]) => {
      const e = (window as any).__openreelE2E;
      let project = e.project.getState().project;
      if (strip) {
        project = {
          ...project,
          timeline: {
            ...project.timeline,
            tracks: project.timeline.tracks.map((track: any) => ({
              ...track,
              clips: track.clips.map((clip: any) => ({ ...clip, effects: [] })),
            })),
          },
        };
      }
      const W = 960;
      const H = 540;
      const frame = await e.video.getVideoEngine().renderFrame(project, t, W, H, opts ?? undefined);
      const canvas = new OffscreenCanvas(W, H);
      const g = canvas.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(frame.image, 0, 0, W, H);
      frame.image.close?.();
      const data = g.getImageData(0, 0, W, H).data;
      const white: Record<string, number> = {};
      for (const name of Object.keys(regions)) white[name] = 0;
      let elsewhere = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (data[i] < 215 || data[i + 1] < 215 || data[i + 2] < 215) continue;
          let inside = false;
          for (const [name, r] of Object.entries(regions as Record<string, any>)) {
            if (x >= r.x0 * W && x < r.x1 * W && y >= r.y0 * H && y < r.y1 * H) {
              white[name]++;
              inside = true;
            }
          }
          if (!inside) elsewhere++;
        }
      }
      return { width: W, height: H, white, whiteElsewhere: elsewhere };
    },
    [time, options ?? null, withoutEffects, REGIONS] as const,
  );
}

/** A 960x540 render of `time` as raw RGBA, to compare two renders pixel by pixel. */
async function engineBytes(page: Page, time: number, options?: Record<string, unknown>, withoutEffects = false): Promise<number[]> {
  return page.evaluate(
    async ([t, opts, strip]) => {
      const e = (window as any).__openreelE2E;
      let project = e.project.getState().project;
      if (strip) {
        project = {
          ...project,
          timeline: {
            ...project.timeline,
            tracks: project.timeline.tracks.map((track: any) => ({
              ...track,
              clips: track.clips.map((clip: any) => ({ ...clip, effects: [] })),
            })),
          },
        };
      }
      const W = 960;
      const H = 540;
      const frame = await e.video.getVideoEngine().renderFrame(project, t, W, H, opts ?? undefined);
      const canvas = new OffscreenCanvas(W, H);
      const g = canvas.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(frame.image, 0, 0, W, H);
      frame.image.close?.();
      return Array.from(g.getImageData(0, 0, W, H).data);
    },
    [time, options ?? null, withoutEffects] as const,
  );
}

/** What the burn-in draws for `text` at 960x540 over the effect-free render of `time`: the reference for the overlay. */
async function expectedOverlayBytes(page: Page, time: number, text: string, params: Record<string, unknown>): Promise<number[]> {
  return page.evaluate(
    async ([t, label, p]) => {
      const e = (window as any).__openreelE2E;
      const project = e.project.getState().project;
      const stripped = {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((track: any) => ({
            ...track,
            clips: track.clips.map((clip: any) => ({ ...clip, effects: [] })),
          })),
        },
      };
      const W = 960;
      const H = 540;
      const frame = await e.video.getVideoEngine().renderFrame(stripped, t, W, H);
      const canvas = new OffscreenCanvas(W, H);
      const g = canvas.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(frame.image, 0, 0, W, H);
      frame.image.close?.();
      e.core.burnIn.drawBurnIn(g, "burn-in-timecode", { ...(p as object), __text: label }, W, H);
      return Array.from(g.getImageData(0, 0, W, H).data);
    },
    [time, text, params] as const,
  );
}

const maxDiff = (a: number[], b: number[]): number => {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
  }
  return max;
};

const changedPixels = (a: number[], b: number[], threshold = 60): number => {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > threshold) n++;
  }
  return n;
};

async function programWhite(page: Page, regions: typeof REGIONS): Promise<Stats> {
  return page.evaluate(
    ([selector, rs]) => {
      const c = document.querySelector(selector as string) as HTMLCanvasElement;
      const probe = document.createElement("canvas");
      probe.width = c.width;
      probe.height = c.height;
      const g = probe.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(c, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height).data;
      const white: Record<string, number> = {};
      for (const name of Object.keys(rs as object)) white[name] = 0;
      let elsewhere = 0;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if (data[i] < 215 || data[i + 1] < 215 || data[i + 2] < 215) continue;
          let inside = false;
          for (const [name, r] of Object.entries(rs as Record<string, any>)) {
            if (x >= r.x0 * c.width && x < r.x1 * c.width && y >= r.y0 * c.height && y < r.y1 * c.height) {
              white[name]++;
              inside = true;
            }
          }
          if (!inside) elsewhere++;
        }
      }
      return { width: c.width, height: c.height, white, whiteElsewhere: elsewhere };
    },
    [PROGRAM, regions] as const,
  );
}

export function registerBurnInTests(): void {
  test.describe.configure({ mode: "serial" });

  test("Timecode and Clip Name effects: added in the inspector, drawn in the monitor and in export frames, drop-frame text, deterministic", async ({ page }) => {
    test.setTimeout(480_000);
    await openEditor(page);
    const clipId = await useBroadcastSequence(page);
    await clickClip(page, clipId);

    // Premiere-like authoring: both effects come from the Add Effect picker and have their own controls.
    await addEffectFromInspector(page, clipId, "Timecode");
    await expect(page.locator('[data-testid="burn-in-controls-burn-in-timecode"]')).toBeVisible();
    await addEffectFromInspector(page, clipId, "Clip Name");
    await expect(page.locator('[data-testid="burn-in-controls-burn-in-name"]')).toBeVisible();
    const effects = await page.evaluate((id) => {
      const project = (window as any).__openreelE2E.project.getState().project;
      for (const track of project.timeline.tracks) for (const clip of track.clips) if (clip.id === id) return clip.effects.map((x: any) => ({ type: x.type, params: x.params }));
      return [];
    }, clipId);
    expect(effects.map((x: any) => x.type)).toEqual(["burn-in-timecode", "burn-in-name"]);
    expect(effects[0].params).toMatchObject({ source: "sequence", position: "bottom-center", opacity: 100 });
    expect(effects[1].params).toMatchObject({ nameSource: "clip", position: "top-left" });

    // The controls write the effect: change the position in the inspector, then put it back.
    const timecodeControls = page.locator('[data-testid="burn-in-controls-burn-in-timecode"]');
    await timecodeControls.getByRole("combobox", { name: "Position" }).click();
    await page.getByRole("option", { name: "Top right" }).click();
    await expect
      .poll(() => page.evaluate((id) => {
        const project = (window as any).__openreelE2E.project.getState().project;
        for (const track of project.timeline.tracks) for (const clip of track.clips) if (clip.id === id) return clip.effects[0].params.position;
        return null;
      }, clipId))
      .toBe("top-right");
    await timecodeControls.getByRole("combobox", { name: "Position" }).click();
    await page.getByRole("option", { name: "Bottom center" }).click();
    await expect
      .poll(() => page.evaluate((id) => {
        const project = (window as any).__openreelE2E.project.getState().project;
        for (const track of project.timeline.tracks) for (const clip of track.clips) if (clip.id === id) return clip.effects[0].params.position;
        return null;
      }, clipId))
      .toBe("bottom-center");

    // Export-frame path: text lands in its two bands and nowhere else on the solid red scene.
    const baseline = await engineStats(page, T1, undefined, true);
    expect(baseline.white.timecode + baseline.white.name + baseline.whiteElsewhere).toBe(0);
    const first = await engineStats(page, T1);
    expect(first.white.timecode).toBeGreaterThan(150);
    expect(first.white.name).toBeGreaterThan(100);
    expect(first.whiteElsewhere).toBe(0);

    // Dynamic and deterministic: the digits change with the frame, and the same frame renders to the same bytes.
    const bytes1 = await engineBytes(page, T1);
    const bytes1Again = await engineBytes(page, T1);
    const bytes2 = await engineBytes(page, T2);
    expect(maxDiff(bytes1, bytes1Again)).toBe(0);
    expect(changedPixels(bytes1, bytes2)).toBeGreaterThan(20);
    // Only the timecode changes between the two frames; the clip name is the same, so the top-left band is identical.
    const topRows = 960 * 4 * Math.floor(540 * 0.16);
    expect(maxDiff(bytes1.slice(0, topRows), bytes2.slice(0, topRows))).toBe(0);

    // Program monitor: the same text appears on the preview canvas.
    await seek(page, T1);
    await settle(page, 1200);
    const monitor = await programWhite(page, REGIONS);
    expect(monitor.white.timecode).toBeGreaterThan(40);
    expect(monitor.white.name).toBeGreaterThan(25);
    expect(monitor.whiteElsewhere).toBe(0);
    await seek(page, T2);
    await settle(page, 1200);
    const monitor2 = await programWhite(page, REGIONS);
    expect(monitor2.white.timecode).toBeGreaterThan(40);
    expect(monitor2.white.timecode).not.toBe(monitor.white.timecode);
  });

  test("export Timecode burn-in overlay: the exact drop-frame text, position and scale, above everything, in every frame render", async ({ page }) => {
    test.setTimeout(480_000);
    await openEditor(page);
    await useBroadcastSequence(page);

    // The overlay is drawn by export for the frame time alone: compare with the reference drawing of the expected text.
    for (const [time, text] of [[T1, TEXT_T1], [T2, TEXT_T2]] as const) {
      const overlay = await engineBytes(page, time, { timecodeBurnIn: { enabled: true } });
      const expected = await expectedOverlayBytes(page, time, text, { position: "bottom-center", size: 5, opacity: 100, box: true });
      // Same drawing routine on a GPU-backed and a CPU-backed canvas: glyph edges may differ by anti-aliasing, glyphs
      // may not. A wrong digit changes hundreds of pixels.
      const wrong = await expectedOverlayBytes(page, time, text === TEXT_T1 ? TEXT_T2 : TEXT_T1, { position: "bottom-center", size: 5, opacity: 100, box: true });
      const right = changedPixels(overlay, expected, 90);
      const other = changedPixels(overlay, wrong, 90);
      expect(other, "a different timecode must look different").toBeGreaterThan(100);
      expect(right, `overlay at ${time}s must draw ${text}`).toBeLessThan(other / 10);
    }

    // It is a setting of the export, not of the project: no option, no text.
    const plain = await engineStats(page, T1);
    expect(plain.white.timecode + plain.whiteElsewhere).toBe(0);

    // Position, size, opacity and the box are honoured; a gap-free source timecode counts from the file's start.
    const moved = await engineStats(page, T1, { timecodeBurnIn: { enabled: true, position: "top-left", size: 8, box: false } });
    expect(moved.white.name).toBeGreaterThan(100);
    expect(moved.white.timecode).toBe(0);
    const faded = await engineBytes(page, T1, { timecodeBurnIn: { enabled: true, opacity: 0 } });
    expect(maxDiff(faded, await engineBytes(page, T1))).toBe(0);
    const source = await engineBytes(page, T1, { timecodeBurnIn: { enabled: true, source: "source" } });
    const expectedSequence = await expectedOverlayBytes(page, T1, TEXT_T1, { position: "bottom-center", size: 5, opacity: 100, box: true });
    const sourceExpected = await expectedOverlayBytes(page, T1, "00:00:02:15", { position: "bottom-center", size: 5, opacity: 100, box: true });
    expect(changedPixels(source, sourceExpected, 90), "source timecode 00:00:02:15").toBe(0);
    expect(changedPixels(source, expectedSequence, 90), "source mode differs from the sequence timecode").toBeGreaterThan(100);
  });

  test("Export dialog: one switch burns the sequence timecode into the exported MP4", async ({ page }, testInfo) => {
    test.setTimeout(600_000);
    await openEditor(page);
    await useBroadcastSequence(page);
    // 640x360 keeps the encode small; the burn-in scales with the frame.
    await page.evaluate(async () => {
      await (window as any).__openreelE2E.project.getState().updateSettings({ width: 640, height: 360 });
    });
    await seek(page, 0);
    await page.getByRole("button", { name: "Export", exact: true }).first().click();
    await settle(page, 1500);

    const burnIn = page.getByRole("switch", { name: "Burn in timecode" });
    await expect(burnIn).toBeVisible();
    await expect(burnIn).not.toBeChecked();
    await burnIn.click();
    await expect(burnIn).toBeChecked();
    // Position and source are one click away once it is on.
    await expect(page.getByRole("combobox", { name: "Burn-in position" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Burn-in timecode source" })).toBeVisible();

    const download = page.waitForEvent("download", { timeout: 540_000 });
    await page.getByRole("button", { name: "Export Video" }).last().click();
    const file = testInfo.outputPath("burn-in.mp4");
    await (await download).saveAs(file);

    const W = 640;
    const H = 360;
    const frameAt = (t: number): Buffer =>
      execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {
        maxBuffer: 64 * 1024 * 1024,
      });
    const white = (buf: Buffer): { band: number; elsewhere: number; mask: Uint8Array } => {
      const mask = new Uint8Array(W * H);
      let band = 0;
      let elsewhere = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 3;
          if (buf[i] < 200 || buf[i + 1] < 200 || buf[i + 2] < 200) continue;
          mask[y * W + x] = 1;
          if (x >= W * 0.3 && x < W * 0.7 && y >= H * 0.82) band++;
          else elsewhere++;
        }
      }
      return { band, elsewhere, mask };
    };
    const f1 = frameAt(T1);
    const f2 = frameAt(3.0);
    expect(f1.length).toBe(W * H * 3);
    const m1 = white(f1);
    const m2 = white(f2);
    expect(m1.band).toBeGreaterThan(60);
    expect(m1.elsewhere).toBe(0);
    expect(m2.band).toBeGreaterThan(60);
    expect(m2.elsewhere).toBe(0);
    let differing = 0;
    for (let i = 0; i < m1.mask.length; i++) if (m1.mask[i] !== m2.mask[i]) differing++;
    expect(differing, "the digits change from frame to frame").toBeGreaterThan(10);

    // The exported text is the reference drawing of the right digits: high overlap of the white glyph pixels.
    const reference = await page.evaluate(
      async ([w, h, text]) => {
        const e = (window as any).__openreelE2E;
        const canvas = new OffscreenCanvas(w as number, h as number);
        const g = canvas.getContext("2d", { willReadFrequently: true })!;
        g.fillStyle = "#ff0000";
        g.fillRect(0, 0, w as number, h as number);
        e.core.burnIn.drawBurnIn(g, "burn-in-timecode", { position: "bottom-center", size: 5, opacity: 100, box: true, __text: text }, w, h);
        const data = g.getImageData(0, 0, w as number, h as number).data;
        const out: number[] = [];
        for (let i = 0; i < data.length; i += 4) out.push(data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200 ? 1 : 0);
        return out;
      },
      [W, H, "01:00:02;14"] as const,
    );
    let inter = 0;
    let union = 0;
    for (let i = 0; i < reference.length; i++) {
      const a = reference[i] === 1;
      const b = m1.mask[i] === 1;
      if (a && b) inter++;
      if (a || b) union++;
    }
    expect(union).toBeGreaterThan(0);
    expect(inter / union, "exported glyphs overlap the reference rendering of 01:00:02;14").toBeGreaterThan(0.5);
  });
}
