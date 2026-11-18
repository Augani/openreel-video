import { expect, test, type Page } from "@playwright/test";
import { settle } from "./helpers";

/**
 * Blend opacity is the project's 0-100 scale. In normal blend mode the 2D compositors (the editor preview and the
 * export renderer, VideoEngine.renderFrame) apply it themselves; a clip at 50% must be half as bright as the same
 * clip at 100% in BOTH, for shapes, SVG, stickers and text. Real Chrome, real pixels of both renderers.
 * Shared by the gpu project (blend-opacity.spec.ts) and the fallback projects (fallback-blend-opacity.spec.ts).
 */

const PROGRAM = 'canvas[aria-label^="Program frame"]';

interface Sample {
  readonly shape: number;
  readonly svg: number;
  readonly sticker: number;
  readonly text: number;
}

interface Both {
  readonly preview: Sample;
  readonly exported: Sample;
}

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

/** Creates one rectangle, one SVG, one sticker and one text clip on the Titles track, far apart. Returns their ids. */
async function createOverlays(page: Page): Promise<{ shape: string; svg: string; sticker: string; text: string }> {
  return page.evaluate(async () => {
    const e = (window as any).__openreelE2E;
    const wait = async <T,>(read: () => T | null | undefined): Promise<T> => {
      for (let i = 0; i < 100; i++) {
        const value = read();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("engine not ready");
    };
    await wait(() => e.engine.getState().getGraphicsEngine());
    await wait(() => e.engine.getState().titleEngine);
    const store = e.project.getState();
    const track = store.project.timeline.tracks.find((t: any) => t.name === "Titles") ?? store.project.timeline.tracks[0];
    const at = (x: number) => ({ position: { x, y: 0.5 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 });
    const shape = store.createShapeClip(track.id, 0, "rectangle", 5, {
      fill: { type: "solid", color: "#ff0000", opacity: 1 },
      stroke: { color: "#000000", width: 0, opacity: 1 },
    });
    store.updateShapeTransform(shape.id, { position: { x: 0.12, y: 0.5 } });
    const svg = store.importSVG(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#00ff00"/></svg>',
      track.id,
      0,
      5,
    );
    store.updateShapeTransform(svg.id, { position: { x: 0.32, y: 0.5 }, scale: { x: 0.2, y: 0.2 } });
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 200;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#0000ff";
    g.fillRect(0, 0, 200, 200);
    const sticker = store.createStickerClip({
      id: "e2e-blend-sticker",
      type: "sticker",
      imageUrl: canvas.toDataURL("image/png"),
      trackId: track.id,
      startTime: 0,
      duration: 5,
      transform: at(0.52),
      keyframes: [],
    });
    const text = store.createTextClip(track.id, 0, "HH", 5, {
      fontFamily: "Inter",
      fontSize: 420,
      fontWeight: 900,
      color: "#ffffff",
    });
    store.updateTextTransform(text.id, at(0.78));
    return { shape: shape.id, svg: svg.id, sticker: sticker.id, text: text.id };
  });
}

/** Sets every overlay's blendOpacity (engine + the project's overlay arrays, as every store update does). */
async function setBlendOpacity(page: Page, ids: Record<string, string>, value: number | undefined): Promise<void> {
  await page.evaluate(
    ([clips, opacity]) => {
      const e = (window as any).__openreelE2E;
      const graphics = e.engine.getState().getGraphicsEngine();
      const titles = e.engine.getState().titleEngine;
      const ids = clips as Record<string, string>;
      graphics.updateShapeClip(ids.shape, { blendOpacity: opacity as number });
      graphics.updateSVGClip(ids.svg, { blendOpacity: opacity as number });
      graphics.updateStickerClip(ids.sticker, { blendOpacity: opacity as number });
      titles.updateTextClip(ids.text, { blendOpacity: opacity as number });
      const state = e.project.getState();
      e.project.setState({
        project: {
          ...state.project,
          shapeClips: graphics.getAllShapeClips(),
          svgClips: graphics.getAllSVGClips(),
          stickerClips: graphics.getAllStickerClips(),
          textClips: titles.getAllTextClips(),
          modifiedAt: Date.now(),
        },
      });
    },
    [ids, value ?? 100] as const,
  );
}

/** Brightness (max channel) of each overlay in the editor preview and in the export renderer at `time`. */
async function sampleBoth(page: Page, time: number): Promise<Both> {
  await page.evaluate((t) => (window as any).__openreelE2E.timeline.getState().seekTo(t), time);
  await settle(page, 900);
  return page.evaluate(
    async ([selector, t]) => {
      const e = (window as any).__openreelE2E;
      const program = document.querySelector(selector as string) as HTMLCanvasElement;
      const read = (source: CanvasImageSource, width: number, height: number) => {
        const canvas = new OffscreenCanvas(width, height);
        const g = canvas.getContext("2d", { willReadFrequently: true })!;
        g.fillStyle = "#000";
        g.fillRect(0, 0, width, height);
        g.drawImage(source, 0, 0, width, height);
        return { data: g.getImageData(0, 0, width, height).data, width, height };
      };
      const sample = (frame: { data: Uint8ClampedArray; width: number; height: number }): Sample => {
        const box = (cx: number, cy: number, hw: number, hh: number, channel: number, mode: "mean" | "max") => {
          let sum = 0;
          let n = 0;
          let max = 0;
          for (let y = Math.floor((cy - hh) * frame.height); y < Math.ceil((cy + hh) * frame.height); y++) {
            for (let x = Math.floor((cx - hw) * frame.width); x < Math.ceil((cx + hw) * frame.width); x++) {
              const v = frame.data[(y * frame.width + x) * 4 + channel];
              sum += v;
              n++;
              max = Math.max(max, v);
            }
          }
          return mode === "mean" ? sum / Math.max(1, n) : max;
        };
        return {
          shape: box(0.12, 0.5, 0.01, 0.02, 0, "mean"),
          svg: box(0.32, 0.5, 0.01, 0.02, 1, "mean"),
          sticker: box(0.52, 0.5, 0.01, 0.02, 2, "mean"),
          // The white glyphs: the brightest pixel of the text box in the blue channel (the stage is dark blue-ish
          // grey only at the very edge; white at 50% is ~128).
          text: box(0.78, 0.5, 0.1, 0.2, 0, "max"),
        };
      };
      // Wait for the preview to stop changing (SVG layers and images rasterise asynchronously).
      let preview = read(program, program.width, program.height);
      for (let i = 0; i < 40; i++) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const next = read(program, program.width, program.height);
        let same = true;
        for (let k = 0; same && k < next.data.length; k += 7) if (next.data[k] !== preview.data[k]) same = false;
        preview = next;
        if (same && i > 2) break;
      }
      const project = e.project.getState().getFullProject();
      const width = project.settings.width as number;
      const height = project.settings.height as number;
      const fresh = await e.engine.getState().videoEngine.renderFrame(project, t as number, width, height);
      const exported = read(fresh.image, width, height);
      return { preview: sample(preview), exported: sample(exported) };
    },
    [PROGRAM, time] as const,
  );
}

export function registerBlendOpacityTests(): void {
  test("Blend opacity (0-100) fades shapes, SVG, stickers and text identically in the preview and the export render", async ({ page }) => {
    test.setTimeout(180_000);
    await openBlankEditor(page);
    const ids = await createOverlays(page);

    await setBlendOpacity(page, ids, 100);
    const full = await sampleBoth(page, 1);
    // Baselines: every overlay is plainly drawn in both renderers.
    for (const where of ["preview", "exported"] as const) {
      expect(full[where].shape, `${where} shape at 100%`).toBeGreaterThan(200);
      expect(full[where].svg, `${where} svg at 100%`).toBeGreaterThan(200);
      expect(full[where].sticker, `${where} sticker at 100%`).toBeGreaterThan(200);
      expect(full[where].text, `${where} text at 100%`).toBeGreaterThan(200);
    }

    await setBlendOpacity(page, ids, 50);
    const half = await sampleBoth(page, 1);
    for (const where of ["preview", "exported"] as const) {
      for (const kind of ["shape", "svg", "sticker", "text"] as const) {
        const ratio = half[where][kind] / full[where][kind];
        expect(ratio, `${where} ${kind}: 50% blend opacity is half the brightness (got ${half[where][kind]} of ${full[where][kind]})`).toBeGreaterThan(0.4);
        expect(ratio, `${where} ${kind}: 50% blend opacity is half the brightness`).toBeLessThan(0.62);
      }
    }
    // Preview and export agree with each other (the stage colour under the preview allows a few levels).
    for (const kind of ["shape", "svg", "sticker", "text"] as const) {
      expect(Math.abs(half.preview[kind] - half.exported[kind]), `preview and export agree on ${kind}`).toBeLessThan(24);
    }

    await setBlendOpacity(page, ids, 0);
    const none = await sampleBoth(page, 1);
    for (const where of ["preview", "exported"] as const) {
      for (const kind of ["shape", "svg", "sticker", "text"] as const) {
        expect(none[where][kind], `${where} ${kind} at 0% is not drawn`).toBeLessThan(40);
      }
    }
  });
}
