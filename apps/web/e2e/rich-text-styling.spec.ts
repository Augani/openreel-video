import { expect, test, type Page } from "@playwright/test";
import { settle } from "./helpers";

/**
 * Rich title styling (Premiere Essential Graphics style): type a title in the inspector, bold and colour one word
 * through the selection controls, add a gradient fill and a second stroke, then compare the editor preview with the
 * export renderer (VideoEngine.renderFrame) pixel for pixel. gpu project.
 */

const PROGRAM = 'canvas[aria-label^="Program frame"]';

async function openBlankEditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable */
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator(PROGRAM).waitFor({ timeout: 60_000 });
}

interface Frames {
  readonly preview: { data: number[]; width: number; height: number };
  readonly exported: { data: number[]; width: number; height: number };
}

/** The preview canvas and a fresh export-renderer frame at `time`, downscaled to the same size and returned as RGBA. */
async function bothFrames(page: Page, time: number): Promise<Frames> {
  await page.evaluate((t) => (window as any).__openreelE2E.timeline.getState().seekTo(t), time);
  await settle(page, 900);
  return page.evaluate(
    async ([selector, t]) => {
      const e = (window as any).__openreelE2E;
      const program = document.querySelector(selector as string) as HTMLCanvasElement;
      const W = 640;
      const H = 360;
      const read = (source: CanvasImageSource) => {
        const canvas = new OffscreenCanvas(W, H);
        const g = canvas.getContext("2d", { willReadFrequently: true })!;
        g.fillStyle = "#000";
        g.fillRect(0, 0, W, H);
        g.drawImage(source, 0, 0, W, H);
        return { data: Array.from(g.getImageData(0, 0, W, H).data), width: W, height: H };
      };
      const project = e.project.getState().getFullProject();
      const width = project.settings.width as number;
      const height = project.settings.height as number;
      const fresh = await e.engine.getState().videoEngine.renderFrame(project, t as number, width, height);
      return { preview: read(program), exported: read(fresh.image) };
    },
    [PROGRAM, time] as const,
  );
}

type Frame = Frames["preview"];

function pixel(frame: Frame, nx: number, ny: number): [number, number, number] {
  const x = Math.round(nx * (frame.width - 1));
  const y = Math.round(ny * (frame.height - 1));
  const i = (y * frame.width + x) * 4;
  return [frame.data[i], frame.data[i + 1], frame.data[i + 2]];
}

/** Bounding box of pixels brighter than the dark stage, as fractions of the frame. */
function inkBox(frame: Frame, predicate: (r: number, g: number, b: number) => boolean) {
  let minX = frame.width, maxX = -1, minY = frame.height, maxY = -1, count = 0;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const i = (y * frame.width + x) * 4;
      if (predicate(frame.data[i], frame.data[i + 1], frame.data[i + 2])) {
        count++;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  return { count, minX: minX / frame.width, maxX: maxX / frame.width, minY: minY / frame.height, maxY: maxY / frame.height };
}

function diffRatio(a: Frame, b: Frame, tolerance = 40): number {
  let bad = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    if (d > tolerance) bad++;
  }
  return bad / (a.data.length / 4);
}

test("Rich title: bold and colour one word, gradient fill and a second stroke render the same in the preview and the export", async ({ page }) => {
  test.setTimeout(180_000);
  await openBlankEditor(page);

  const id = await page.evaluate(async () => {
    const e = (window as any).__openreelE2E;
    for (let i = 0; i < 100 && !e.engine.getState().titleEngine; i++) await new Promise((r) => setTimeout(r, 100));
    const store = e.project.getState();
    const track = store.project.timeline.tracks.find((t: any) => t.name === "Titles") ?? store.project.timeline.tracks[0];
    const clip = store.createTextClip(track.id, 0, "x", 5, {
      fontFamily: "Inter", fontSize: 200, fontWeight: 400, color: "#ffffff", strokeColor: "#000000", strokeWidth: 0,
    });
    e.ui.getState().selectMultiple([{ type: "text-clip", id: clip.id, trackId: track.id }]);
    return clip.id as string;
  });
  await settle(page, 600);

  // Type the title in the inspector.
  const content = page.getByRole("textbox", { name: "Text content" }).first();
  await content.fill("Big Win");
  await settle(page, 300);
  expect(await page.evaluate((cid) => (window as any).__openreelE2E.project.getState().getTextClip(cid).text, id)).toBe("Big Win");

  // Select the word "Win" in the field, as a user dragging over it would.
  await content.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  const bold = page.getByRole("button", { name: "Bold selection" });
  if (!(await bold.isVisible().catch(() => false))) {
    await page.getByText("Advanced text properties").first().click();
  }
  await expect(page.getByTestId("rich-text-range")).toHaveText(/Selected 5–7 \(3\)/);
  await bold.click();
  await settle(page, 300);

  // Colour that word red (the same store call the colour control makes) and add a gradient fill and strokes.
  await page.evaluate((cid) => {
    const store = (window as any).__openreelE2E.project.getState();
    const clip = store.getTextClip(cid);
    const runs = clip.runs.map((r: any) => (r.style.fontWeight === 700 ? { ...r, style: { ...r.style, color: "#ff2a2a" } } : r));
    store.updateTextRuns(cid, runs);
    store.updateTextStyle(cid, {
      fill: { type: "linear", angle: 0, stops: [{ offset: 0, color: "#2ad4ff" }, { offset: 1, color: "#2aff6b" }] },
    });
  }, id);
  await page.getByRole("button", { name: "Add stroke" }).click();
  await page.getByRole("button", { name: "Add stroke" }).click();
  await settle(page, 400);

  const state = await page.evaluate((cid) => {
    const clip = (window as any).__openreelE2E.project.getState().getTextClip(cid);
    return { runs: clip.runs, strokes: clip.style.strokes, fill: clip.style.fill, text: clip.text };
  }, id);
  expect(state.runs.map((r: any) => r.text)).toEqual(["Big ", "Win"]);
  expect(state.runs[1].style).toMatchObject({ fontWeight: 700, color: "#ff2a2a" });
  expect(state.strokes).toHaveLength(2);
  expect(state.fill.type).toBe("linear");

  // Widen the strokes so the colours are easy to sample: inner black, outer orange.
  await page.evaluate((cid) => {
    const store = (window as any).__openreelE2E.project.getState();
    store.updateTextStyle(cid, { strokes: [{ color: "#101010", width: 6 }, { color: "#ff9900", width: 22 }] });
  }, id);
  await settle(page, 600);

  const { preview, exported } = await bothFrames(page, 1);

  // The glyphs exist and the gradient runs left to right: "Big" is cyan-to-green; the word "Win" is the run's own red.
  const orange = (r: number, g: number, b: number) => r > 200 && g > 110 && g < 200 && b < 80;
  for (const [name, frame] of [["preview", preview], ["export", exported]] as const) {
    const ink = inkBox(frame, (r, g, b) => r > 150 || g > 150 || b > 150);
    expect(ink.count, `${name} draws the title`).toBeGreaterThan(500);
    const strokeInk = inkBox(frame, orange);
    expect(strokeInk.count, `${name} draws the second (orange) stroke`).toBeGreaterThan(200);
    const red = inkBox(frame, (r, g, b) => r > 200 && g < 90 && b < 90);
    const cyanGreen = inkBox(frame, (r, g, b) => r < 90 && g > 170 && b > 100);
    expect(red.count, `${name} colours the word red`).toBeGreaterThan(150);
    expect(cyanGreen.count, `${name} fills the first word with the gradient`).toBeGreaterThan(150);
    // "Win" sits right of "Big".
    expect(red.minX, `${name}: the red word is right of the gradient word`).toBeGreaterThan(cyanGreen.minX);
  }

  // Preview == export: the same pixels outside antialiasing noise, and the same extents.
  const previewInk = inkBox(preview, (r, g, b) => r > 150 || g > 150 || b > 150);
  const exportInk = inkBox(exported, (r, g, b) => r > 150 || g > 150 || b > 150);
  expect(Math.abs(previewInk.minX - exportInk.minX)).toBeLessThan(0.01);
  expect(Math.abs(previewInk.maxX - exportInk.maxX)).toBeLessThan(0.01);
  expect(Math.abs(previewInk.minY - exportInk.minY)).toBeLessThan(0.015);
  expect(Math.abs(previewInk.maxY - exportInk.maxY)).toBeLessThan(0.015);
  expect(diffRatio(preview, exported), "preview and export frames match").toBeLessThan(0.01);
  for (const [nx, ny] of [[0.4, 0.5], [0.6, 0.5]] as const) {
    const a = pixel(preview, nx, ny);
    const b = pixel(exported, nx, ny);
    expect(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))).toBeLessThan(48);
  }

  // Every edit is undoable: undo steps back through the stroke width change, then the second stroke itself.
  const strokes = () => page.evaluate((cid) => (window as any).__openreelE2E.project.getState().getTextClip(cid).style.strokes?.map((s: any) => s.width), id);
  expect(await strokes()).toEqual([6, 22]);
  await page.evaluate(() => (window as any).__openreelE2E.project.getState().undo());
  await settle(page, 300);
  expect(await strokes()).toEqual([4, 10]);
  await page.evaluate(() => (window as any).__openreelE2E.project.getState().undo());
  await settle(page, 300);
  expect(await strokes()).toEqual([4]);
  await page.evaluate(() => (window as any).__openreelE2E.project.getState().redo());
  await settle(page, 300);
  expect(await strokes()).toEqual([4, 10]);
});
