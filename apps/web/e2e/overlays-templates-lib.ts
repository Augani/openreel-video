import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickClip, clipsOf, importInput, openEditor, readState, seek, settle, waitForPresentedPlayhead } from "./helpers";
import { FIXTURE_PATH } from "./global-setup";
import { SOFTWARE_GPU } from "./env";

/**
 * Graphics > Overlays cards and the template gallery render the real thing on real pixels:
 *  - each overlay card is the overlay (resolved from its editing template, drawn by the title / graphics engines)
 *    composited over the footage frame under the playhead, with its own hover animation;
 *  - every built-in template has a real rendered thumbnail on every surface (no icon on a gradient), equal-height
 *    cards, no empty platform tabs.
 * Shared by the gpu project (overlays-templates.spec.ts) and the fallback projects (fallback-overlays-templates.spec.ts).
 */
const SHOTS = process.env.OPENREEL_OVERLAY_SHOTS ?? join(tmpdir(), "polish-b", "overlays-templates", "e2e");

interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface CardPixels {
  state: string | undefined;
  source: string | undefined;
  frame: string | undefined;
  width: number;
  height: number;
  meanRed: number;
  stats: Record<string, number>;
}


/**
 * A real, large H.264 source for the cards. testsrc2 carries colour bars, a gradient, a moving marker and a frame
 * counter (every region and every time looks different, so a crop or a wrong frame time cannot pass); with
 * OPENREEL_REAL_FOOTAGE=<dir> the clip is the real promo footage instead (4K: Mountain_Drone upscaled).
 * Generated into the tmp dir, never committed.
 */
function ensureFootage(label: string, width: number, height: number): string {
  const dir = join(tmpdir(), "openreel-e2e-overlay-footage");
  mkdirSync(dir, { recursive: true });
  const real = process.env.OPENREEL_REAL_FOOTAGE;
  const source = real ? join(real, width >= 3840 ? "Mountain_Drone.mp4" : "Interview_Office.mp4") : undefined;
  const name = `${source ? "real" : "synth"}-${label}-${width}x${height}.mp4`;
  const out = join(dir, name);
  if (existsSync(out)) return out;
  // Per-process partial name: parallel workers (one per project) generate the same clip, and a shared partial path
  // made one worker's rename fail with ENOENT after the other had already moved it into place.
  const partial = `${out}.${process.pid}.partial.mp4`;
  const encode = ["-c:v", "libx264", "-preset", "veryfast", "-g", "30", "-pix_fmt", "yuv420p", "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv", "-movflags", "+write_colr", "-an", partial];
  if (source && existsSync(source)) {
    execFileSync("ffmpeg", ["-y", "-i", source, "-t", "6", "-vf", `scale=${width}:${height}:flags=lanczos`, ...encode], { stdio: "ignore" });
  } else {
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=30:duration=6`, ...encode], { stdio: "ignore" });
  }
  renameSync(partial, out); // atomic; the last writer wins with identical content
  return out;
}

/** Fresh editor with `file` on the timeline of a blank project of the given orientation; project settings set to `project`. */
async function openProjectWithFootage(
  page: Page,
  orientation: "Horizontal" | "Vertical",
  file: string,
  project: { width: number; height: number },
): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("openreel-onboarding-complete", "true");
    localStorage.setItem("openreel-mograph-tour-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(orientation) }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await importInput(page).setInputFiles(file);
  const name = file.split("/").pop() as string;
  await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: `Media actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  // The project keeps the size the test chose, whatever the footage is.
  await page.getByRole("button", { name: /Keep Current/ }).click({ timeout: 8_000 }).catch(() => undefined);
  await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 30_000 }).toBe(1);
  await page.evaluate(async ([w, h]) => {
    await (window as any).__openreelE2E.project.getState().updateSettings({ width: w, height: h });
  }, [project.width, project.height]);
  expect(await page.evaluate(() => { const s = (window as any).__openreelE2E.project.getState().project.settings; return [s.width, s.height]; })).toEqual([project.width, project.height]);
}

interface Signature {
  readonly width: number;
  readonly height: number;
  readonly luma: number[];
}

/** Downscaled luma signature (32 columns) of the first `rows` fraction of a canvas, read in the page. */
async function canvasSignature(page: Page, selector: string, rows: number): Promise<Signature> {
  return page.evaluate(
    ([sel, keep]) => {
      const canvas = document.querySelector(sel as string) as HTMLCanvasElement;
      const columns = 32;
      const total = Math.max(2, Math.round((columns * canvas.height) / canvas.width));
      const probe = document.createElement("canvas");
      probe.width = columns;
      probe.height = total;
      const ctx = probe.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(canvas, 0, 0, columns, total);
      const data = ctx.getImageData(0, 0, columns, total).data;
      const luma: number[] = [];
      const limit = Math.floor(total * (keep as number));
      for (let y = 0; y < limit; y++) {
        for (let x = 0; x < columns; x++) {
          const i = (y * columns + x) * 4;
          luma.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
        }
      }
      return { width: columns, height: limit, luma };
    },
    [selector, rows] as const,
  );
}

const meanAbsDiff = (a: Signature, b: Signature): number => {
  expect(a.luma.length, "signatures have the same shape").toBe(b.luma.length);
  let sum = 0;
  for (let i = 0; i < a.luma.length; i++) sum += Math.abs(a.luma[i] - b.luma[i]);
  return sum / Math.max(1, a.luma.length);
};

const PROGRAM_CANVAS = 'canvas[aria-label^="Program frame"]';
/** The card's first lower-third template canvas (a lower third sits in the bottom of the frame, so the top 70% is footage only). */
const LOWER_THIRD_CARD = '[data-graphic-template].col-span-2 canvas';

const card = (id: string) => `[data-overlay-card="${id}"] canvas`;

/** Counts pixels in fractions of the card canvas that satisfy `test` (evaluated in the page). */
async function readOverlay(page: Page, id: string): Promise<CardPixels> {
  return page.evaluate((selector) => {
    const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
    if (!canvas) throw new Error(`no overlay canvas ${selector}`);
    const probe = document.createElement("canvas");
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.drawImage(canvas, 0, 0);
    const { width, height } = probe;
    const data = ctx.getImageData(0, 0, width, height).data;
    const px = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return [data[i], data[i + 1], data[i + 2]] as const;
    };
    const count = (region: Region, test: (r: number, g: number, b: number) => boolean): number => {
      let n = 0;
      for (let y = Math.floor(region.y0 * height); y < Math.ceil(region.y1 * height); y++) {
        for (let x = Math.floor(region.x0 * width); x < Math.ceil(region.x1 * width); x++) {
          const [r, g, b] = px(x, y);
          if (test(r, g, b)) n++;
        }
      }
      return n;
    };
    const area = (region: Region) => Math.max(1, Math.ceil((region.x1 - region.x0) * width) * Math.ceil((region.y1 - region.y0) * height));
    const dark = (r: number, g: number, b: number) => r + g + b < 60;
    const green = (r: number, g: number, b: number) => g > 120 && g > r + 25 && b > 60 && b < 200;
    const white = (r: number, g: number, b: number) => r > 215 && g > 215 && b > 215;
    const warm = (r: number, g: number, b: number) => r > 215 && g > 160 && g < 225 && b > 110 && b < 190;
    // The frame at its default 22% opacity over red footage: red lifted toward the warm tint (g, b well above 0,
    // far below the full-opacity warm line).
    const tinted = (r: number, g: number, b: number) => r > 200 && g > 28 && g < 110 && b > 18 && b < 90;
    const red = (r: number, g: number, b: number) => r > 150 && g < 70 && b < 70;
    // Share of the columns in [x0, x1) with a green pixel anywhere in the bottom 8% of the card (the bar is a few pixels tall).
    const greenColumns = (x0: number, x1: number): number => {
      let columns = 0;
      let lit = 0;
      for (let x = Math.floor(x0 * width); x < Math.ceil(x1 * width); x++) {
        columns++;
        for (let y = Math.floor(0.92 * height); y < height; y++) {
          const [r, g, b] = px(x, y);
          if (green(r, g, b)) {
            lit++;
            break;
          }
        }
      }
      return lit / Math.max(1, columns);
    };
    const top: Region = { x0: 0, y0: 0, x1: 1, y1: 0.06 };
    const bottom: Region = { x0: 0, y0: 0.94, x1: 1, y1: 1 };
    const middle: Region = { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 };
    const strip: Region = { x0: 0, y0: 0.98, x1: 1, y1: 1 };
    const corner: Region = { x0: 0.55, y0: 0.7, x1: 1, y1: 1 };
    const edge = { l: { x0: 0, y0: 0, x1: 0.1, y1: 1 }, t: { x0: 0, y0: 0, x1: 1, y1: 0.1 } };
    let r = 0;
    for (let i = 0; i < data.length; i += 4) r += data[i];
    return {
      state: canvas.dataset.previewState,
      source: canvas.dataset.previewSource,
      frame: canvas.dataset.previewFrame,
      width,
      height,
      meanRed: r / (data.length / 4),
      stats: {
        topDark: count(top, dark) / area(top),
        bottomDark: count(bottom, dark) / area(bottom),
        middleRed: count(middle, red) / area(middle),
        stripGreen: greenColumns(0, 1),
        stripGreenLeft: greenColumns(0, 0.5),
        stripGreenRight: greenColumns(0.5, 1),
        cornerWhite: count(corner, white),
        warmEdgeLeft: count(edge.l, warm),
        warmEdgeTop: count(edge.t, warm),
        tintedEdgeLeft: count(edge.l, tinted),
        tintedEdgeTop: count(edge.t, tinted),
        middleWarm: count(middle, warm),
      },
    };
  }, card(id));
}

async function waitForOverlay(page: Page, id: string, state = "poster"): Promise<CardPixels> {
  await page.locator(card(id)).scrollIntoViewIfNeeded();
  await expect.poll(async () => (await readOverlay(page, id)).state, { timeout: 40_000, message: `${state} for ${id}` }).toBe(state);
  return readOverlay(page, id);
}

export function registerOverlayTemplateTests(): void {
  test.describe.configure({ mode: "serial" });

  test("Overlay cards draw the real overlay over the footage; hover plays; reduced motion keeps the poster", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);
    // three-scenes.mp4: 2-4 s is solid red, so the footage under every card is unmistakably red.
    await seek(page, 2.5);
    await page.getByRole("button", { name: /^Graphics/ }).first().click();
    await page.getByRole("tab", { name: "Overlays" }).click();
    await settle(page, 800);
    const project = testInfo.project.name;

    const progress = await waitForOverlay(page, "overlay-progress-bar");
    const letterbox = await waitForOverlay(page, "cinema-letterbox");
    const follow = await waitForOverlay(page, "overlay-follow-callout");
    const frame = await waitForOverlay(page, "cinema-light-frame");
    await page.screenshot({ path: `${SHOTS}/${project}-overlays-red.png` });

    for (const [name, c] of Object.entries({ progress, letterbox, follow, frame })) {
      expect(c.source, `${name} card sits on decoded footage`).toBe("footage");
      expect(c.width, `${name} card is rendered at card size`).toBeGreaterThanOrEqual(192);
    }
    // The old cards were flat brown boxes (#3A2E26) with a CSS sliver: red footage must dominate the middle.
    for (const [name, c] of Object.entries({ progress, follow, frame })) {
      expect(c.stats.middleRed, `${name}: footage fills the card`).toBeGreaterThan(0.5);
    }
    // Progress bar: the bar spans the left ~60% at rest (green on the footage), not the right.
    expect(progress.stats.stripGreenLeft, "progress bar is drawn along the bottom edge, a visible few pixels tall").toBeGreaterThan(0.9);
    expect(progress.stats.stripGreenRight, "bar (60% at rest) has not reached past the right half").toBeLessThan(0.3);
    // Letterbox: full-width bars top and bottom, footage between them.
    expect(letterbox.stats.topDark, "top letterbox bar").toBeGreaterThan(0.85);
    expect(letterbox.stats.bottomDark, "bottom letterbox bar").toBeGreaterThan(0.85);
    expect(letterbox.stats.middleRed, "footage between the bars").toBeGreaterThan(0.4);
    expect(frame.stats.topDark).toBeLessThan(0.05);
    // Follow callout: the white "Follow +" label sits bottom right.
    expect(follow.stats.cornerWhite, "callout label text is drawn").toBeGreaterThan(4);
    expect(progress.stats.cornerWhite).toBeLessThan(2);
    // Frame border: a thin line along the edges at the template's Frame Opacity (22%): it tints the red footage
    // but is not the full-opacity warm line it used to be (the opacity control was dead), nothing in the middle.
    expect(frame.stats.tintedEdgeLeft, "frame left edge is a 22% tint").toBeGreaterThan(15);
    expect(frame.stats.tintedEdgeTop, "frame top edge is a 22% tint").toBeGreaterThan(30);
    expect(frame.stats.warmEdgeLeft, "frame is not drawn at full opacity").toBe(0);
    expect(frame.stats.warmEdgeTop, "frame is not drawn at full opacity").toBe(0);
    expect(frame.stats.middleWarm).toBe(0);

    // Hover plays the overlay's own animation: the bar grows across the window.
    const target = page.locator('[data-overlay-card="overlay-progress-bar"]');
    await target.hover();
    await expect.poll(async () => (await readOverlay(page, "overlay-progress-bar")).state, { timeout: 30_000 }).toBe("playing");
    const widths = new Set<number>();
    const frames = new Set<string | undefined>();
    for (let i = 0; i < 16; i++) {
      const read = await readOverlay(page, "overlay-progress-bar");
      widths.add(Math.round((read.stats.stripGreenLeft + read.stats.stripGreenRight) * 10));
      frames.add(read.frame);
      await page.waitForTimeout(110);
    }
    expect(frames.size, `distinct hover frames: ${[...frames]}`).toBeGreaterThanOrEqual(3);
    expect(widths.size, "the bar width changes while hovering").toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: `${SHOTS}/${project}-overlays-hover.png` });

    await page.mouse.move(5, 5);
    await expect.poll(async () => (await readOverlay(page, "overlay-progress-bar")).state, { timeout: 5_000 }).toBe("poster");

    // Reduced motion keeps the poster.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await target.hover();
    await page.waitForTimeout(900);
    expect((await readOverlay(page, "overlay-progress-bar")).state).toBe("poster");
    await page.mouse.move(5, 5);
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // Keyboard focus plays too; the card keeps its accessible name and clicking still adds the overlay.
    await target.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect.poll(async () => (await readOverlay(page, "overlay-progress-bar")).state, { timeout: 30_000 }).toBe("playing");
    await expect(target).toHaveAttribute("aria-label", /^Progress bar\./);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // The cards follow the footage: at 0.5 s (testsrc2) the middle is no longer solid red.
    await seek(page, 0.5);
    await expect
      .poll(async () => (await readOverlay(page, "cinema-letterbox")).stats.middleRed, { timeout: 30_000, message: "cards retarget to the new frame" })
      .toBeLessThan(0.2);
    expect((await readOverlay(page, "cinema-letterbox")).stats.topDark, "letterbox bars persist on the new frame").toBeGreaterThan(0.85);
    await page.screenshot({ path: `${SHOTS}/${project}-overlays-testsrc.png` });
  });

  test("Overlay cards fall back to the bundled sample scene when the project has no footage", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    mkdirSync(SHOTS, { recursive: true });
    await page.addInitScript(() => {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Horizontal/ }).click();
    await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: /^Graphics/ }).first().click();
    await page.getByRole("tab", { name: "Overlays" }).click();
    const letterbox = await waitForOverlay(page, "cinema-letterbox");
    expect(letterbox.source, "no visual media: honest sample scene").toBe("sample");
    expect(letterbox.stats.topDark).toBeGreaterThan(0.85);
    await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-overlays-sample.png` });
  });

  test("Overlay cards in a vertical project show the whole 9:16 frame (bars, edge strip), not a centre crop", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    mkdirSync(SHOTS, { recursive: true });
    await page.addInitScript(() => {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Vertical/ }).click();
    await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: /^Graphics/ }).first().click();
    await page.getByRole("tab", { name: "Overlays" }).click();
    const letterbox = await waitForOverlay(page, "cinema-letterbox");
    await waitForOverlay(page, "overlay-progress-bar");
    await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-overlays-vertical.png` });
    // The card is 9:16 like the project; the whole frame fills it with its own top and bottom bars visible.
    const read = (id: string) =>
      page.evaluate((selector) => {
        const canvas = document.querySelector(selector) as HTMLCanvasElement;
        const probe = document.createElement("canvas");
        probe.width = canvas.width;
        probe.height = canvas.height;
        const ctx = probe.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
        ctx.drawImage(canvas, 0, 0);
        const { width, height } = probe;
        const data = ctx.getImageData(0, 0, width, height).data;
        const frac = (x0: number, y0: number, x1: number, y1: number, test: (r: number, g: number, b: number) => boolean) => {
          let n = 0;
          let total = 0;
          for (let y = Math.floor(y0 * height); y < Math.ceil(y1 * height); y++) {
            for (let x = Math.floor(x0 * width); x < Math.ceil(x1 * width); x++) {
              const i = (y * width + x) * 4;
              total++;
              if (test(data[i], data[i + 1], data[i + 2])) n++;
            }
          }
          return n / Math.max(1, total);
        };
        const white = (r: number, g: number, b: number) => r > 215 && g > 215 && b > 215;
        const dark = (r: number, g: number, b: number) => r + g + b < 60;
        return {
          aspect: width / height,
          topBar: frac(0.4, 0.025, 0.6, 0.05, dark),
          bottomBar: frac(0.4, 0.95, 0.6, 0.975, dark),
          midDark: frac(0.4, 0.3, 0.6, 0.7, dark),
          label: frac(0.45, 0.8, 0.97, 0.97, white),
        };
      }, card(id));
    const bars = await read("cinema-letterbox");
    expect(bars.aspect, "card canvas is tall (5:8) for the 9:16 project").toBeCloseTo(5 / 8, 2);
    const box = await page.locator('[data-overlay-card="cinema-letterbox"] canvas').boundingBox();
    expect(box!.height / box!.width, "card is tall, not a 16:9 strip").toBeGreaterThan(1.5);
    expect(bars.topBar, "top letterbox bar of the 9:16 frame is inside the card").toBeGreaterThan(0.85);
    expect(bars.bottomBar, "bottom letterbox bar of the 9:16 frame is inside the card").toBeGreaterThan(0.85);
    expect(bars.midDark, "scene between the bars").toBeLessThan(0.3);
    // The follow label sits at the bottom right of the 9:16 frame (a centre crop of the 16:9 card would lose it);
    // the progress-bar card over the same scene is the control.
    const control = await read("overlay-progress-bar");
    await waitForOverlay(page, "overlay-follow-callout");
    const follow = await read("overlay-follow-callout");
    await page.locator('[data-overlay-card="overlay-follow-callout"]').screenshot({ path: `${SHOTS}/${testInfo.project.name}-overlay-follow-vertical.png` });
    expect(follow.label - control.label, "follow label is drawn inside the 9:16 frame").toBeGreaterThan(0.002);
    expect(letterbox.source).toBe("sample");
  });

  test("Template gallery shows a real rendered thumbnail on every card, equal heights, no empty platforms", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    mkdirSync(SHOTS, { recursive: true });
    await page.addInitScript(() => {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Browse templates" }).click();
    const thumbs = page.locator("[data-template-thumb]");
    await expect(thumbs.first()).toBeVisible({ timeout: 30_000 });
    expect(await thumbs.count(), "every built-in template has a card").toBeGreaterThanOrEqual(9);
    await settle(page, 1500);

    const reads = await page.evaluate(async () => {
      const results: Array<{ id: string; w: number; h: number; boxW: number; boxH: number; cardW: number; cardH: number; std: number; sig: number[]; icon: boolean }> = [];
      for (const host of Array.from(document.querySelectorAll("[data-template-thumb]"))) {
        const img = host.querySelector("img");
        if (!img) {
          results.push({ id: host.getAttribute("data-template-thumb") ?? "", w: 0, h: 0, boxW: 0, boxH: 0, cardW: 0, cardH: 0, std: 0, sig: [], icon: false });
          continue;
        }
        await img.decode().catch(() => undefined);
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 36;
        const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
        ctx.drawImage(img, 0, 0, 64, 36);
        const data = ctx.getImageData(0, 0, 64, 36).data;
        const sig: number[] = [];
        let sum = 0;
        let sq = 0;
        for (let i = 0; i < data.length; i += 4) {
          sig.push(data[i], data[i + 1], data[i + 2]);
          const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
          sum += l;
          sq += l * l;
        }
        const n = data.length / 4;
        const box = host.getBoundingClientRect();
        const cardEl = host.closest("button");
        const cardBox = cardEl?.getBoundingClientRect();
        results.push({
          id: host.getAttribute("data-template-thumb") ?? "",
          w: img.naturalWidth,
          h: img.naturalHeight,
          boxW: box.width,
          boxH: box.height,
          cardW: cardBox?.width ?? 0,
          cardH: cardBox?.height ?? 0,
          std: Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)),
          sig,
          icon: !!host.querySelector("svg"),
        });
      }
      return results;
    });
    expect(reads.length).toBeGreaterThanOrEqual(9);
    for (const read of reads) {
      expect(read.w, `${read.id} is a real image`).toBeGreaterThanOrEqual(600);
      expect(read.h).toBeGreaterThanOrEqual(330);
      expect(read.std, `${read.id} has photographic structure, not a flat gradient`).toBeGreaterThan(18);
      expect(read.icon, `${read.id} shows no placeholder icon`).toBe(false);
      // The old welcome cards collapsed the thumbnail to a ~20 px chip.
      expect(read.boxW, `${read.id} fills the card width`).toBeGreaterThanOrEqual(read.cardW * 0.95);
      expect(read.boxH, `${read.id} is a full 16:9 area`).toBeGreaterThan(read.boxW * 0.5);
    }
    const heights = new Set(reads.map((r) => Math.round(r.cardH)));
    expect(heights.size, `card heights: ${[...heights]}`).toBeLessThanOrEqual(2);
    // Distinct art per template.
    for (let i = 0; i < reads.length; i++) {
      for (let j = i + 1; j < reads.length; j++) {
        let diff = 0;
        for (let k = 0; k < reads[i].sig.length; k++) diff += Math.abs(reads[i].sig[k] - reads[j].sig[k]);
        diff /= reads[i].sig.length;
        expect(diff, `${reads[i].id} differs from ${reads[j].id}`).toBeGreaterThan(0.4);
      }
    }
    for (const empty of ["Facebook", "Twitter/X", "LinkedIn", "Pinterest"]) {
      await expect(page.getByRole("tab", { name: new RegExp(empty) })).toHaveCount(0);
    }
    await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-template-gallery.png` });

    await page.getByRole("button", { name: "TikTok Promo" }).first().click();
    const hero = page.locator('[role="dialog"] [data-template-thumb] img');
    await expect(hero).toBeVisible({ timeout: 20_000 });
    expect(await hero.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThanOrEqual(600);
    await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-template-modal.png` });
  });

  test("Overlay cards in a vertical project show 16:9 footage letterboxed exactly as the Program monitor does", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    mkdirSync(SHOTS, { recursive: true });
    await page.addInitScript(() => {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Vertical/ }).click();
    await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
    await importInput(page).setInputFiles(FIXTURE_PATH);
    await page.getByLabel("Select media three-scenes.mp4").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Media actions for three-scenes.mp4" }).click();
    await page.getByRole("menuitem", { name: "Add to timeline" }).click();
    // The project is 9:16 on purpose: keep it.
    await page.getByRole("button", { name: "Keep Current" }).click({ timeout: 8_000 }).catch(() => undefined);
    await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 20_000 }).toBe(1);
    await seek(page, 2.5);
    await page.getByRole("button", { name: /^Graphics/ }).first().click();
    await page.getByRole("tab", { name: "Overlays" }).click();
    const progress = await waitForOverlay(page, "overlay-progress-bar");
    await waitForOverlay(page, "cinema-letterbox");
    await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-overlays-vertical-footage.png` });
    expect(progress.source).toBe("footage");
    const rows = await page.evaluate((selector) => {
      const canvas = document.querySelector(selector) as HTMLCanvasElement;
      const probe = document.createElement("canvas");
      probe.width = canvas.width;
      probe.height = canvas.height;
      const ctx = probe.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
      ctx.drawImage(canvas, 0, 0);
      const { width, height } = probe;
      const data = ctx.getImageData(0, 0, width, height).data;
      // The 9:16 frame is centred; its middle column crosses [black bar | red footage | black bar].
      const x = Math.floor(width / 2);
      const column: number[] = [];
      for (let y = 0; y < height; y++) {
        const i = (y * width + x) * 4;
        column.push(data[i] > 150 && data[i + 1] < 80 && data[i + 2] < 80 ? 1 : 0);
      }
      const red = column.reduce((a, b) => a + b, 0) / height;
      const first = column.indexOf(1);
      const last = column.lastIndexOf(1);
      const y = Math.floor(height / 2);
      let across = 0;
      for (let xx = 0; xx < width; xx++) {
        const i = (y * width + xx) * 4;
        if (data[i] > 150 && data[i + 1] < 80 && data[i + 2] < 80) across++;
      }
      return { red, first: first / height, last: (last + 1) / height, rowRed: across / width };
    }, card("overlay-progress-bar"));
    // 16:9 footage in a 9:16 frame fitted to the card height is ~32% of the card height, centred; a cover crop
    // would be red from top to bottom.
    expect(rows.red, "footage is a letterboxed band, not the whole frame").toBeGreaterThan(0.2);
    expect(rows.red).toBeLessThan(0.45);
    expect(rows.rowRed, "footage band spans the card width (large footage, not a small band in a 16:9 card)").toBeGreaterThan(0.8);
    expect(rows.first).toBeGreaterThan(0.25);
    expect(rows.last).toBeLessThan(0.75);
  });


  test.describe("Templates tab cards compose like the Program monitor", () => {
    test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const cases = [
      { label: "vertical", orientation: "Vertical", clip: [1920, 1080], project: [1080, 1920] },
      { label: "4K", orientation: "Horizontal", clip: [3840, 2160], project: [3840, 2160] },
    ] as const;
    for (const c of cases) {
      test(`Template card backdrop matches the Program frame at the playhead (${c.label} project)`, async ({ page }, testInfo) => {
        test.setTimeout(240_000);
        mkdirSync(SHOTS, { recursive: true });
        const file = ensureFootage(c.label, c.clip[0], c.clip[1]);
        await openProjectWithFootage(page, c.orientation, file, { width: c.project[0], height: c.project[1] });
        await seek(page, 3);
        await page.getByRole("button", { name: /^Graphics/ }).first().click();
        await page.getByRole("tab", { name: "Templates" }).click();
        const thumb = page.locator(LOWER_THIRD_CARD).first();
        await thumb.scrollIntoViewIfNeeded();
        await expect(thumb, "card shows the decoded playhead frame, not a thumbnail stand-in").toHaveAttribute("data-rendered", "frame", { timeout: 60_000 });
        await waitForPresentedPlayhead(page);
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-templates-${c.label}.png` });
        const program = await canvasSignature(page, PROGRAM_CANVAS, 0.7);
        const tile = await canvasSignature(page, LOWER_THIRD_CARD, 0.7);
        const dims = await page.evaluate((sel) => { const el = document.querySelector(sel) as HTMLCanvasElement; return [el.width, el.height]; }, LOWER_THIRD_CARD);
        // Same stage aspect as the project, not a fixed 16:9 or a cropped region.
        expect(dims[0] / dims[1], "card canvas has the project's aspect").toBeCloseTo(c.project[0] / c.project[1], 1);
        const diff = meanAbsDiff(program, tile);
        console.log(`template card vs program ${c.label}: mean luma diff ${diff.toFixed(2)}`);
        expect(diff, `${c.label}: card footage matches the Program frame (mean luma diff ${diff.toFixed(2)} of 255)`).toBeLessThan(12);
      });
    }
  });


  test("Templates tab on a real 3840x2160 clip produces no long task over 50 ms", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
    const file = ensureFootage("longtask", 3840, 2160);
    await openProjectWithFootage(page, "Horizontal", file, { width: 3840, height: 2160 });
    await seek(page, 3);
    await page.getByRole("button", { name: /^Graphics/ }).first().click();
    // Start from a quiet tab so the trace holds only the Templates work.
    await page.getByRole("tab", { name: "Shapes" }).click();
    await settle(page, 1500);
    expect(await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes("longtask")), "long-task trace is available").toBe(true);
    await page.evaluate(() => {
      const w = window as any;
      w.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__longTasks.push(entry.duration);
      }).observe({ entryTypes: ["longtask"] });
      w.__loaf = [];
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as any[]) w.__loaf.push(JSON.stringify({ d: Math.round(e.duration), scripts: e.scripts.map((x: any) => `${x.invoker}|${x.sourceFunctionName}|${x.sourceURL.split("/").pop()}:${x.sourceCharPosition}|${Math.round(x.duration)}`) }));
        }).observe({ type: "long-animation-frame", buffered: false });
      } catch { /* not available */ }
    });
    await page.getByRole("tab", { name: "Templates" }).click();
    const thumbs = page.locator('[data-graphic-template] canvas');
    await expect(thumbs.first()).toBeVisible();
    // Every card in view has the decoded playhead frame (the heavy 4K decode has landed and been drawn)...
    await expect.poll(async () => thumbs.evaluateAll((nodes) => nodes.filter((n) => (n as HTMLCanvasElement).dataset.rendered === "frame").length), { timeout: 90_000 }).toBeGreaterThan(0);
    // ...then hovering one plays its entry animation, which re-renders the card every frame.
    await page.locator("[data-graphic-template] button").first().hover();
    await settle(page, 2500);
    await page.mouse.move(5, 5);
    await settle(page, 500);
    const tasks = await page.evaluate(() => (window as any).__longTasks as number[]);
    const max = Math.max(0, ...tasks);
    console.log(`templates long tasks 4K ${JSON.stringify(tasks)} ${JSON.stringify(await page.evaluate(() => (window as any).__loaf))}`);
    await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-templates-4k-longtask.png` });
    // Hardware: no task over 50 ms. On SwiftShader (no GPU) the card canvases rasterize on the CPU and a single hover
    // frame can spike past 90 ms on a loaded runner (one 98 ms task on CI; steady frames cost ~10 ms), so allow 3x:
    // still far below the multi-hundred-ms stall of decoding or resampling the 4K frame on the main thread.
    const budget = SOFTWARE_GPU ? 150 : 50;
    expect(max, `longest Templates-tab task ${max} ms on 4K (all: ${tasks.join(", ")}), budget ${budget} ms`).toBeLessThan(budget);
  });

  const traces: Record<string, { settled: number; count: number; max: number; total: number }> = {};
  for (const [label, width, height] of [["1080p", 1920, 1080], ["4K", 3840, 2160]] as const) {
  test(`Overlay card cost, long-task trace of a ${label} project`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
    const run = async () => {
      await openEditor(page);
      await page.evaluate(
        async ([w, h]) => {
          await (window as any).__openreelE2E.project.getState().updateSettings({ width: w, height: h });
        },
        [width, height],
      );
      const [clip] = clipsOf(await readState(page), "Main");
      await clickClip(page, clip.id);
      await seek(page, 2.5);
      await page.getByRole("button", { name: /^Graphics/ }).first().click();
      expect(await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes("longtask")), "long-task trace is available").toBe(true);
      expect(await page.evaluate(() => (window as any).__openreelE2E.project.getState().project.settings.width), "project is the traced size").toBe(width);
      await page.evaluate(() => {
        const w = window as any;
        w.__longTasks = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) w.__longTasks.push(entry.duration);
        }).observe({ entryTypes: ["longtask"] });
      });
      const started = Date.now();
      await page.getByRole("tab", { name: "Overlays" }).click();
      for (const id of ["overlay-progress-bar", "cinema-letterbox", "overlay-follow-callout", "cinema-light-frame"]) await waitForOverlay(page, id);
      const settled = Date.now() - started;
      await page.locator('[data-overlay-card="overlay-progress-bar"]').hover();
      await page.waitForTimeout(2500);
      await page.mouse.move(5, 5);
      const tasks = await page.evaluate(() => (window as any).__longTasks as number[]);
      return { settled, count: tasks.length, max: Math.max(0, ...tasks), total: tasks.reduce((a, b) => a + b, 0) };
    };
    const trace = await run();
    traces[label] = trace;
    console.log(`overlay long tasks ${label} ${JSON.stringify(trace)}`);
    // Cards render at card size, so no single task blocks the main thread for long, at any sequence size...
    expect(trace.max, `${label} longest task ${trace.max} ms`).toBeLessThan(250);
    // ...and a 4K project costs about what a 1080p one does (a 4K canvas per card would cost several times more).
    if (label === "4K" && traces["1080p"]) {
      expect(trace.total, `4K long-task time ${trace.total} ms vs 1080p ${traces["1080p"].total} ms`).toBeLessThan(traces["1080p"].total * 2 + 300);
    }
  });
  }

  // A production build registers a service worker, and page.route cannot see requests it makes (the mocked cloud list would hit the real API
  // and 404). Blocking it keeps the route in charge; the dev server has no worker, which is why this only failed against a built bundle.
  test.describe("cloud list mocked by route", () => {
    test.use({ serviceWorkers: "block" });
    test("Saved and cloud templates get a lazily rendered thumbnail; the modal hero plays the template on hover and focus", async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      mkdirSync(SHOTS, { recursive: true });
      await page.addInitScript(() => {
        localStorage.setItem("openreel-onboarding-complete", "true");
        localStorage.setItem("openreel-mograph-tour-complete", "true");
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.getByRole("button", { name: "Browse templates" }).waitFor({ timeout: 30_000 });
      await page.waitForFunction(() => !!(window as any).__openreelE2E, undefined, { timeout: 30_000 });
      // A saved (IndexedDB) and a cloud (network) template built from real built-ins, with no thumbnail of their own.
      const made = await page.evaluate(async () => {
        const e = (window as any).__openreelE2E;
        const engine = await e.engine.getState().getTemplateEngine();
        await engine.initialize();
        const source = engine.getBuiltinTemplates().find((t: any) => t.id === "builtin-quote-card") ?? engine.getBuiltinTemplates()[0];
        const clone = (id: string, name: string) => ({ ...JSON.parse(JSON.stringify(source)), id, name, thumbnailUrl: null, previewUrl: null });
        const saved = clone("saved-e2e-1", "Saved E2E");
        await engine.saveTemplate(saved);
        return { saved: saved.id, cloud: clone("cloud-e2e-1", "Cloud E2E") };
      });
      await page.route("**/templates/scriptable", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ templates: [{ ...made.cloud, socialCategory: "promo", placeholders: made.cloud.placeholders ?? [] }] }),
        }),
      );
      await page.getByRole("button", { name: "Browse templates" }).click();
      for (const id of ["saved-e2e-1", "cloud-e2e-1"]) {
        const host = page.locator(`[data-template-thumb="${id}"]`);
        await host.scrollIntoViewIfNeeded({ timeout: 30_000 });
        const img = host.locator("img");
        await expect(img, `${id} gets a rendered thumbnail`).toHaveAttribute("src", /^blob:/, { timeout: 40_000 });
        const read = await img.evaluate(async (node: HTMLImageElement) => {
          await node.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 36;
          const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
          ctx.drawImage(node, 0, 0, 64, 36);
          const data = ctx.getImageData(0, 0, 64, 36).data;
          let sum = 0;
          let sq = 0;
          for (let i = 0; i < data.length; i += 4) {
            const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
            sum += l;
            sq += l * l;
          }
          const n = data.length / 4;
          return { w: node.naturalWidth, h: node.naturalHeight, std: Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) };
        });
        expect(read.w, `${id} is a real 640 px render`).toBeGreaterThanOrEqual(600);
        expect(read.std, `${id} has structure, not a flat placeholder`).toBeGreaterThan(18);
        expect(await host.locator("svg").count(), `${id} shows no placeholder icon`).toBe(0);
      }
      await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-template-lazy.png` });

      // Modal hero: still at rest, the template's own animation on hover, back to the still on leave, still on reduced motion.
      await page.getByRole("button", { name: "Cloud E2E" }).first().click();
      const hero = page.locator("[data-template-hero]");
      await expect(hero).toBeVisible({ timeout: 20_000 });
      await expect(hero).toHaveAttribute("data-hero-state", "still");
      const readHero = async () =>
        page.evaluate(() => {
          const canvas = document.querySelector("[data-template-hero] canvas") as HTMLCanvasElement;
          const probe = document.createElement("canvas");
          probe.width = 64;
          probe.height = 36;
          const ctx = probe.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
          ctx.drawImage(canvas, 0, 0, 64, 36);
          return { frame: canvas.dataset.heroFrame, data: Array.from(ctx.getImageData(0, 0, 64, 36).data) };
        });
      await hero.hover();
      await expect(hero).toHaveAttribute("data-hero-state", "playing", { timeout: 60_000 });
      const seen = new Map<string | undefined, number[]>();
      for (let i = 0; i < 30; i++) {
        const frame = await readHero();
        seen.set(frame.frame, frame.data);
        await page.waitForTimeout(120);
      }
      expect(seen.size, `distinct hero frames: ${[...seen.keys()]}`).toBeGreaterThanOrEqual(4);
      const frames = [...seen.values()];
      let maxDiff = 0;
      for (const other of frames) {
        let diff = 0;
        for (let k = 0; k < other.length; k++) diff += Math.abs(other[k] - frames[0][k]);
        maxDiff = Math.max(maxDiff, diff / other.length);
      }
      expect(maxDiff, "the template layers actually move between frames").toBeGreaterThan(0.05);
      await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-template-hero-playing.png` });
      await page.mouse.move(5, 5);
      await expect(hero).toHaveAttribute("data-hero-state", "still", { timeout: 5_000 });
      await hero.focus();
      await expect(hero).toHaveAttribute("data-hero-state", "playing", { timeout: 30_000 });
      await hero.blur();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await hero.hover();
      await page.waitForTimeout(1500);
      await expect(hero).toHaveAttribute("data-hero-state", "still");
    });
  });
}
