import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clickClip, clipsOf, importInput, openEditor, programMean, readState, seek, settle, splitIntoThree, track } from "./helpers";

/**
 * Effects panel live previews: every card renders its effect on real pixels of the footage under the
 * playhead (not the decorative artwork), at rest as a poster and on hover as a looping 2 s window.
 * Shared by the gpu project (effect-previews.spec.ts) and the fallback projects (fallback-effect-previews.spec.ts).
 */

const SHOTS = process.env.OPENREEL_PREVIEW_SHOTS ?? join(tmpdir(), "effect-previews-shots");
const GRAYSCALE = "Black & white";
const SOURCE_CARD = "Stabilize"; // footage with the stabilization crop: still the unaffected colours

interface CardRead {
  state: string | undefined;
  source: string | undefined;
  frame: string | undefined;
  width: number;
  height: number;
  mean: [number, number, number];
  saturation: number;
  /** Standard deviation of the red channel: 0 on a flat colour, large on grain / structure. */
  std: number;
  /** Fraction of pixels that are strongly red (r > 150, g,b < 90). */
  redShare: number;
  /** Fraction of pixels that are not strongly red. */
  otherShare: number;
  /** 32x18 RGB signature for comparing frames. */
  signature: number[];
}

const cardCanvas = (label: string) => `button[aria-label^="${label}. Drag"] canvas`;

async function readCard(page: Page, label: string): Promise<CardRead> {
  return page.evaluate((selector) => {
    const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
    if (!canvas) throw new Error(`no preview canvas for ${selector}`);
    const probe = document.createElement("canvas");
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let sat = 0;
    let rr = 0;
    let red = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      rr += data[i] * data[i];
      if (data[i] > 150 && data[i + 1] < 90 && data[i + 2] < 90) red++;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      sat += max === 0 ? 0 : (max - min) / max;
    }
    const sig = document.createElement("canvas");
    sig.width = 32;
    sig.height = 18;
    const sctx = sig.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    sctx.drawImage(probe, 0, 0, 32, 18);
    const small = sctx.getImageData(0, 0, 32, 18).data;
    const signature: number[] = [];
    for (let i = 0; i < small.length; i += 4) signature.push(small[i], small[i + 1], small[i + 2]);
    return {
      state: canvas.dataset.previewState,
      source: canvas.dataset.previewSource,
      frame: canvas.dataset.previewFrame,
      width: canvas.width,
      height: canvas.height,
      mean: [r / n, g / n, b / n] as [number, number, number],
      saturation: sat / n,
      std: Math.sqrt(Math.max(0, rr / n - (r / n) ** 2)),
      redShare: red / n,
      otherShare: 1 - red / n,
      signature,
    };
  }, cardCanvas(label));
}

const cardNote = async (page: Page, label: string): Promise<string | null> =>
  page.locator(`button[aria-label^="${label}. Drag"] [aria-hidden="true"] span`).first().textContent({ timeout: 2_000 }).catch(() => null);

const signatureDiff = (a: number[], b: number[]): number => {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
};

async function waitForPoster(page: Page, label: string): Promise<CardRead> {
  const card = page.locator(cardCanvas(label)).first();
  await card.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => (await readCard(page, label)).state, { timeout: 40_000, message: `poster for ${label}` })
    .toBe("poster");
  return readCard(page, label);
}

type PreviewStats = {
  windowsLoaded: number;
  rendersStarted: number;
  cacheHits: number;
  cachedFrames: number;
  cachedBytes: number;
  cachedPosters: number;
  peakConcurrency: number;
  poster: number | null;
  clipId: string | null;
};

const readStats = (page: Page): Promise<PreviewStats> =>
  page.evaluate(() => {
    const engine = (window as unknown as { __openreelE2E: { effectPreviews: () => any } }).__openreelE2E.effectPreviews();
    if (!engine) throw new Error("effects panel preview engine is not mounted");
    return {
      ...engine.stats,
      cachedFrames: engine.cachedFrames,
      cachedBytes: engine.cachedBytes,
      cachedPosters: engine.cachedPosters,
      peakConcurrency: engine.peakConcurrency,
      poster: engine.currentSource?.posterSourceTime ?? null,
      clipId: engine.currentSource?.clipId ?? null,
    } as PreviewStats;
  });

async function seekAndSettle(page: Page, seconds: number): Promise<void> {
  await seek(page, seconds);
  // The preview source re-targets 300 ms after the playhead stops.
  await expect
    .poll(async () => Math.abs(((await readStats(page)).poster ?? -99) - seconds) < 0.5, { timeout: 10_000 })
    .toBe(true);
}

/** Scrubs the playhead for ~2 s and returns the main-thread long tasks (> 50 ms) seen meanwhile. */
async function scrubLongTasks(page: Page): Promise<number[]> {
  await page.evaluate(() => {
    const w = window as unknown as { __longTasks?: number[]; __ltObserver?: PerformanceObserver };
    w.__longTasks = [];
    w.__ltObserver?.disconnect();
    w.__ltObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__longTasks?.push(entry.duration);
    });
    w.__ltObserver.observe({ entryTypes: ["longtask"] });
  });
  for (let i = 0; i < 40; i++) {
    await page.evaluate((t) => {
      (window as unknown as { __openreelE2E: { timeline: { getState(): { seekTo(t: number): void } } } }).__openreelE2E.timeline
        .getState()
        .seekTo(t);
    }, 0.2 + i * 0.06);
    await page.waitForTimeout(40);
  }
  return page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
}

const describeTasks = (tasks: number[]): string =>
  `${tasks.length} long tasks (longest ${Math.round(tasks.length ? Math.max(...tasks) : 0)} ms, ${tasks.filter((t) => t > 100).length} over 100 ms)`;

const REAL_FOOTAGE = process.env.OPENREEL_REAL_FOOTAGE ?? "/Users/augustusotu/Projects/openreel/promo/teaser/footage";

/** Fraction of pixels of a card that are near black (the empty corners / sides a spin or flip leaves). */
const darkShare = (page: Page, label: string): Promise<number> =>
  page.evaluate((selector) => {
    const canvas = document.querySelector(selector) as HTMLCanvasElement;
    const probe = document.createElement("canvas");
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 36) dark++;
    return dark / (data.length / 4);
  }, cardCanvas(label));

/** Imports real files and places each at the end of the previous one on the Main track. */
async function placeRealFootage(page: Page, names: string[]): Promise<void> {
  for (const [i, name] of names.entries()) {
    await importInput(page).setInputFiles(`${REAL_FOOTAGE}/${name}`);
    await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 30_000 });
    if (i > 0) {
      const clips = clipsOf(await readState(page), "Main");
      const end = Math.max(...clips.map((c) => c.start + c.duration));
      await seek(page, end);
    }
    await page.getByRole("button", { name: `Media actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Add to timeline" }).click();
    await page.getByRole("button", { name: "Match Video" }).click({ timeout: 3_000 }).catch(() => undefined);
    await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 20_000 }).toBe(i + 1);
    await settle(page, 800);
  }
}

export function registerEffectPreviewTests(): void {
  test.describe.configure({ mode: "serial" });

  test("Effects cards preview real footage: posters, scrub retarget, hover plays, leave stops", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);
    // three-scenes.mp4: 0-2 s testsrc2 (moving), 2-4 s solid red, 4-6 s SMPTE bars.
    await seek(page, 2.5);
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await settle(page, 600);

    // ── rest state: each card shows the footage with its effect applied ─────────────────────────────────────
    const source = await waitForPoster(page, SOURCE_CARD);
    const gray = await waitForPoster(page, GRAYSCALE);
    const programRgb = await programMean(page);
    const project = testInfo.project.name;
    await page.screenshot({ path: `${SHOTS}/${project}-panel-red.png` });

    expect(source.source, "poster comes from the decoded footage, not the artwork or the sample").toBe("footage");
    expect(source.width).toBeGreaterThanOrEqual(192);
    expect(source.height).toBeGreaterThanOrEqual(108);
    // Solid red footage: the unaffected card is red and saturated, the old artwork was brown (#3A2E26 / #D3AE78).
    expect(source.mean[0]).toBeGreaterThan(150);
    expect(source.mean[1]).toBeLessThan(60);
    expect(source.mean[2]).toBeLessThan(60);
    expect(source.saturation).toBeGreaterThan(0.8);
    // ... and it is the same footage the program monitor shows.
    expect(Math.abs(source.mean[0] - programRgb[0])).toBeLessThan(40);
    expect(Math.abs(source.mean[1] - programRgb[1])).toBeLessThan(40);

    // Black & white: the same frame with the effect applied, saturation ~0.
    expect(gray.source).toBe("footage");
    expect(gray.saturation).toBeLessThan(0.03);
    expect(signatureDiff(gray.signature, source.signature), "effect visibly changes the footage").toBeGreaterThan(20);

    // A saturating effect really renders on top of footage too (not a recoloured placeholder).
    const lut = await waitForPoster(page, "LUT · Warm");
    expect(lut.source).toBe("footage");
    expect(lut.mean[0], "warm LUT keeps the red footage red").toBeGreaterThan(120);

    // Grain survives the card downscale: flat red footage + grain has real pixel variance (std 0 without it).
    const grain = await waitForPoster(page, "Film grain");
    expect(grain.source).toBe("footage");
    expect(grain.std, "film grain is visibly grainy on the card").toBeGreaterThan(3);
    expect(source.std, "the unaffected card is flat red").toBeLessThan(1);

    // Chroma key: the footage has no green, so the card keys the footage's own dominant colour over a
    // transparency checkerboard and says so; stabilize shows the stabilization crop and says so.
    const keyed = await waitForPoster(page, "Chroma key");
    expect(keyed.saturation, "red footage keyed out: only the checkerboard remains").toBeLessThan(0.1);
    expect(keyed.std, "checkerboard has structure").toBeGreaterThan(8);
    expect(await cardNote(page, "Chroma key")).toBe("Sample key");
    expect(await cardNote(page, SOURCE_CARD)).toBe("Needs analysis");
    expect(await cardNote(page, GRAYSCALE)).toBeNull();

    // Many cards, ONE decode: the window is shared, work is bounded and the cache stays within its budget.
    for (const label of ["Glow", "Vignette", "Sharpen"]) await waitForPoster(page, label);
    const stats = await readStats(page);
    expect(stats.windowsLoaded, "footage window decoded once and shared").toBe(1);
    expect(stats.peakConcurrency, "render concurrency limit").toBeLessThanOrEqual(2);
    expect(stats.cachedBytes).toBeLessThanOrEqual(48 * 1024 * 1024);
    expect(stats.cachedFrames).toBeGreaterThanOrEqual(5);

    // ── scrubbing never re-renders per tick; the window retargets once it settles ──────────────────────────
    const before = await readStats(page);
    for (let i = 0; i < 30; i++) {
      await page.evaluate((t) => {
        (window as unknown as { __openreelE2E: { timeline: { getState(): { seekTo(t: number): void } } } }).__openreelE2E.timeline
          .getState()
          .seekTo(t);
      }, 0.1 + i * 0.05);
      await page.waitForTimeout(15);
    }
    const duringScrub = await readStats(page);
    // 30 playhead ticks: at most the one retarget a >300 ms pause in the burst may legitimately trigger (never per tick).
    expect(duringScrub.windowsLoaded - before.windowsLoaded, "no window decode per scrub tick").toBeLessThanOrEqual(1);
    // Preview work is held while the playhead moves: only renders already past their idle gap may finish.
    expect(
      duringScrub.rendersStarted - before.rendersStarted,
      "no new card render starts while scrubbing",
    ).toBeLessThanOrEqual(2);
    await seekAndSettle(page, 0.5);

    // ── hover: the 2 s window plays with the effect applied, successive frames differ ──────────────────────
    const grayAfterScrub = await waitForPoster(page, GRAYSCALE);
    await page.screenshot({ path: `${SHOTS}/${project}-panel-testsrc.png` });
    const card = page.locator(`button[aria-label^="${GRAYSCALE}. Drag"]`).first();
    const beforeHover = await readStats(page);
    await card.hover();
    await expect
      .poll(async () => (await readCard(page, GRAYSCALE)).state, { timeout: 30_000, message: "hover starts playback" })
      .toBe("playing");
    const played: CardRead[] = [];
    for (let i = 0; i < 14; i++) {
      played.push(await readCard(page, GRAYSCALE));
      await page.waitForTimeout(120);
    }
    await page.screenshot({ path: `${SHOTS}/${project}-panel-hover.png` });
    const frames = new Set(played.map((p) => p.frame));
    expect(frames.size, `distinct frames shown while hovering: ${[...frames]}`).toBeGreaterThanOrEqual(3);
    let changes = 0;
    for (let i = 1; i < played.length; i++) {
      if (signatureDiff(played[i].signature, played[i - 1].signature) > 0.5) changes++;
    }
    expect(changes, "successive hover frames differ in pixels").toBeGreaterThanOrEqual(2);
    for (const p of played) expect(p.saturation, "every played frame has the effect applied").toBeLessThan(0.03);
    // Hover renders on demand and caches: more frames, still the one shared window (one after the retarget).
    expect((await readStats(page)).windowsLoaded, "hover reuses the shared window").toBe(beforeHover.windowsLoaded);

    // ── leave: playback stops on the poster ────────────────────────────────────────────────────────────────
    await page.mouse.move(5, 5);
    await expect
      .poll(async () => (await readCard(page, GRAYSCALE)).state, { timeout: 5_000, message: "leave stops playback" })
      .toBe("poster");
    const stopped = await readCard(page, GRAYSCALE);
    await page.waitForTimeout(600);
    const later = await readCard(page, GRAYSCALE);
    expect(signatureDiff(stopped.signature, later.signature), "poster is static after leaving").toBe(0);
    expect(signatureDiff(later.signature, grayAfterScrub.signature), "back on the poster frame").toBeLessThan(0.5);

    // ── reduced motion keeps the poster ────────────────────────────────────────────────────────────────────
    await page.emulateMedia({ reducedMotion: "reduce" });
    await card.hover();
    await page.waitForTimeout(900);
    expect((await readCard(page, GRAYSCALE)).state, "reduced motion: poster only").toBe("poster");
    await page.mouse.move(5, 5);
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // ── keyboard focus plays too ───────────────────────────────────────────────────────────────────────────
    await card.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect
      .poll(async () => (await readCard(page, GRAYSCALE)).state, { timeout: 30_000, message: "keyboard focus starts playback" })
      .toBe("playing");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect.poll(async () => (await readCard(page, GRAYSCALE)).state, { timeout: 5_000 }).toBe("poster");
  });

  test("Transition cards blend real footage (no artwork); sweeping the pointer keeps posters cached; scrubbing is held", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);
    // three-scenes.mp4: 0-2 s testsrc2 (moving), 2-4 s solid red, 4-6 s SMPTE bars. At 1.0 s the 2 s window
    // reaches from testsrc2 into the red scene, so a transition between two moments shows both.
    // Baseline for the scrub measurement below: the same scrub with no preview panel mounted.
    const closedTasks = await scrubLongTasks(page);
    await seek(page, 1.0);
    await page.getByRole("button", { name: "Transitions", exact: true }).first().click();
    await settle(page, 600);
    const project = testInfo.project.name;

    for (const label of ["Iris", "Cross dissolve", "Push"]) {
      const card = await waitForPoster(page, label);
      expect(card.source, `${label} transition card is real footage`).toBe("footage");
      // One clip on the timeline: the incoming shot is the bundled sample scene, not another moment of the same
      // clip (which was the red scene here and made every wipe / slide look alike on a talking head).
      expect(card.redShare, `${label}: the incoming shot is not a second moment of the same clip`).toBeLessThan(0.25);
      expect(card.otherShare, `${label}: footage and sample scene are visible`).toBeGreaterThan(0.75);
      expect(card.std, `${label}: has image structure`).toBeGreaterThan(10);
    }
    const iris = await readCard(page, "Iris");
    const dissolve = await readCard(page, "Cross dissolve");
    expect(signatureDiff(iris.signature, dissolve.signature), "different transitions look different").toBeGreaterThan(3);
    await page.screenshot({ path: `${SHOTS}/${project}-transitions.png` });

    // Hover plays the transition from first moment to second: frames differ, leave returns to the poster.
    const irisCard = page.locator('button[aria-label^="Iris. Drag"]').first();
    await irisCard.hover();
    await expect.poll(async () => (await readCard(page, "Iris")).state, { timeout: 30_000 }).toBe("playing");
    const seen: CardRead[] = [];
    for (let i = 0; i < 12; i++) {
      seen.push(await readCard(page, "Iris"));
      await page.waitForTimeout(150);
    }
    expect(new Set(seen.map((f) => f.frame)).size, "transition hover shows several frames").toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: `${SHOTS}/${project}-transition-hover.png` });
    await page.mouse.move(5, 5);
    await expect.poll(async () => (await readCard(page, "Iris")).state, { timeout: 5_000 }).toBe("poster");

    // ── effects: sweep the pointer across many cards; posters must stay cached, memory bounded ─────────────
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await settle(page, 600);
    const labels = ["Black & white", "Glow", "Vignette", "Sharpen", "Film grain", "Chroma key", "Stabilize", "LUT · Warm"];
    for (const label of labels) await waitForPoster(page, label);
    const quiet = await readStats(page);
    // How long the pointer actually stays on each card: a nominal 90 ms visit takes several hundred ms (up to seconds)
    // on a slow software-GL runner, and playback legitimately renders more frames the longer the card is hovered.
    // The bound below therefore scales with the measured dwell instead of assuming a fast machine.
    const hoverStarts: number[] = [];
    for (const label of labels) {
      hoverStarts.push(Date.now());
      await page.locator(`button[aria-label^="${label}. Drag"]`).first().hover();
      await page.waitForTimeout(90);
    }
    hoverStarts.push(Date.now());
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    const swept = await readStats(page);
    expect(swept.cachedPosters, "hover sweep did not evict any poster").toBeGreaterThanOrEqual(quiet.cachedPosters);
    expect(swept.cachedBytes).toBeLessThanOrEqual(48 * 1024 * 1024);
    // A visit renders a handful of frames ahead of playback (HOVER_LEAD) plus what playback itself consumes at 12 fps
    // while the pointer is there, and never more than the card's 24-frame window. A regression that decodes the whole
    // window of every card on a brief hover (24 each) still exceeds the budget of a short visit.
    const HOVER_LEAD = 8;
    const PREVIEW_FPS = 12;
    const WINDOW_FRAMES = 24;
    const hoverBudget = hoverStarts.slice(1).reduce((sum, end, i) => {
      const dwellSeconds = (end - hoverStarts[i]) / 1000;
      return sum + Math.min(WINDOW_FRAMES, HOVER_LEAD + Math.ceil(dwellSeconds * PREVIEW_FPS));
    }, 0);
    const hoverRenders = swept.rendersStarted - quiet.rendersStarted;
    console.log(`[hover-sweep ${project}] renders ${hoverRenders}, budget ${hoverBudget}, dwell ms ${hoverStarts.slice(1).map((end, i) => end - hoverStarts[i]).join(",")}`);
    expect(hoverRenders, "bounded hover work during a sweep").toBeLessThanOrEqual(hoverBudget);
    expect((await readCard(page, "Black & white")).state).toBe("poster");

    // ── scrubbing with the panel open: preview work is held, long tasks are recorded ───────────────────────
    const beforeScrub = await readStats(page);
    const openTasks = await scrubLongTasks(page);
    const afterScrub = await readStats(page);
    expect(afterScrub.rendersStarted - beforeScrub.rendersStarted, "no card render starts while scrubbing").toBeLessThanOrEqual(2);
    const summary = `panel closed: ${describeTasks(closedTasks)}; panel open: ${describeTasks(openTasks)}`;
    testInfo.annotations.push({ type: "scrub-long-tasks", description: summary });
    console.log(`[scrub-long-tasks ${project}] ${summary}`);
    // The settled playhead re-points the cards once; posters come back afterwards.
    await seekAndSettle(page, 0.5);
    await waitForPoster(page, "Black & white");
  });

  test("Every transition card is a real two-sided render; dips rest on footage; filter chips have honest empty states", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    mkdirSync(SHOTS, { recursive: true });
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);
    await seek(page, 1.0);
    await page.getByRole("button", { name: "Transitions", exact: true }).first().click();
    await settle(page, 600);
    const project = testInfo.project.name;

    const reads = new Map<string, CardRead>();
    for (const category of ["Dissolve", "Wipe", "Slide", "Zoom", "Glitch"]) {
      await page.getByRole("group", { name: "Transition categories" }).getByRole("button", { name: category, exact: true }).click();
      await settle(page, 300);
      const labels = await page
        .locator('button[aria-label$="double-click to apply to the selected cut."]')
        .evaluateAll((nodes) => nodes.map((n) => (n.getAttribute("aria-label") ?? "").split(". Drag")[0]));
      expect(labels.length, `${category} lists transitions`).toBeGreaterThan(0);
      for (const label of labels) {
        const read = await waitForPoster(page, label);
        reads.set(label, read);
        expect(read.source, `${label} renders footage`).toBe("footage");
      }
      await page.screenshot({ path: `${SHOTS}/${project}-transitions-${category.toLowerCase()}.png` });
    }
    console.log(
      [...reads].map(([l, r]) => `${l}: std=${r.std.toFixed(1)} red=${r.redShare.toFixed(2)} other=${r.otherShare.toFixed(2)}`).join("\n"),
    );
    for (const [label, read] of reads) {
      expect(read.std, `${label} poster has image structure (not a flat swatch)`).toBeGreaterThan(4);
    }
    expect(reads.size, "the whole transition catalogue was checked").toBeGreaterThan(15);
    await page.getByRole("group", { name: "Transition categories" }).getByRole("button", { name: "Dissolve", exact: true }).click();
    await settle(page, 300);
    await waitForPoster(page, "Dip to black");

    // The dips used to rest at progress 0.5: a solid black / white square. Now both footage and the dip colour show.
    for (const label of ["Dip to black", "Dip to white"]) {
      const read = reads.get(label);
      expect(read, `${label} card exists`).toBeTruthy();
      expect(read!.std, `${label} is not a solid square`).toBeGreaterThan(8);
    }
    const black = reads.get("Dip to black")!;
    const white = reads.get("Dip to white")!;
    expect(black.mean[0] + black.mean[1] + black.mean[2], "dip to black still shows the footage").toBeGreaterThan(30);
    expect(white.mean[0] + white.mean[1] + white.mean[2], "dip to white is not blown out").toBeLessThan(740);
    expect(signatureDiff(black.signature, white.signature), "dip to black and white differ").toBeGreaterThan(20);

    // Cards look different from each other (the old catalogue shared a handful of stills). A few pairs are the
    // same transition by design (Linear Dissolve is the default Cross dissolve; Wipe is Wipe left).
    const seen: string[] = [];
    const twins: string[] = [];
    for (const [label, read] of reads) {
      for (const other of seen) {
        if (signatureDiff(read.signature, reads.get(other)!.signature) < 0.2) twins.push(`${label} = ${other}`);
      }
      seen.push(label);
    }
    console.log(`identical posters: ${twins.join("; ") || "none"}`);
    // Geometric siblings must read differently: the incoming shot is a real second scene, so each wipe / slide
    // / push shows its own geometry. (They used to coincide: Radial Wipe = Wipe Right, Slide Up = Wipe Down ...)
    const family = ["Wipe left", "Wipe Right", "Wipe Up", "Wipe Down", "Iris", "Radial Wipe", "Diamond Reveal", "Split Horizontal", "Split Vertical", "Slide Left", "Slide Right", "Slide Up", "Slide Down", "Spin Clockwise", "Spin Counterclockwise"];
    for (let i = 0; i < family.length; i++) {
      for (let j = i + 1; j < family.length; j++) {
        const a = reads.get(family[i]);
        const b = reads.get(family[j]);
        if (!a || !b) continue;
        expect(signatureDiff(a.signature, b.signature), `${family[i]} and ${family[j]} posters differ`).toBeGreaterThan(1.5);
      }
    }
    const distinct: CardRead[] = [];
    for (const read of reads.values()) {
      if (distinct.every((d) => signatureDiff(d.signature, read.signature) >= 0.2)) distinct.push(read);
    }
    expect(distinct.length, `distinct transition posters of ${reads.size}`).toBeGreaterThanOrEqual(40);

    // ── filter chips ─────────────────────────────────────────────────────────────────────────────────────
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await settle(page, 500);
    const search = page.getByRole("textbox", { name: "Search effects" });
    const noMatch = page.getByText(/No effects match/);
    const chip = (name: string) => page.getByRole("group", { name: "Effect categories" }).getByRole("button", { name, exact: true });

    await chip("Plugins").click();
    await expect(page.getByText("No plugins installed", { exact: false })).toBeVisible();
    await expect(noMatch, "no 'No effects match \"\"' with an empty query").toHaveCount(0);
    await expect(search).toHaveAttribute("placeholder", /Search 0 plugin effects/);
    await search.fill("zzz");
    await expect(noMatch).toHaveCount(1);
    await search.fill("");

    await chip("Keying").click();
    const keyCard = page.locator('button[aria-label^="Chroma key. Drag"]');
    await expect(keyCard, "Chroma key lives in the grid with the other keyers").toHaveCount(1);
    await expect(page.locator('button[aria-label^="Luma Key. Drag"]')).toHaveCount(1);
    const keyBox = await keyCard.boundingBox();
    const lumaBox = await page.locator('button[aria-label^="Luma Key. Drag"]').boundingBox();
    expect(Math.abs((keyBox?.y ?? 0) - (lumaBox?.y ?? 99999)) < 200, "same grid").toBe(true);
    const configureBox = await page.getByRole("button", { name: "Configure chroma key" }).boundingBox();
    expect(configureBox?.y ?? 0, "the configure button sits below the grid, not floating above it").toBeGreaterThan(keyBox?.y ?? 99999);
    await expect(search).toHaveAttribute("placeholder", /Search \d+ keying effects/);
    await page.screenshot({ path: `${SHOTS}/${project}-chip-keying.png` });

    await chip("Audio").click();
    await expect(search).toHaveAttribute("placeholder", /Audio effects/);
    await expect(search).toBeDisabled();
    await expect(noMatch).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/${project}-chip-audio.png` });
  });

  test("Transition cards blend towards the next clip on the cut; hover and keyboard focus play the sweep", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
    await openEditor(page);
    await splitIntoThree(page);
    // Clip 1 is the moving testsrc2 scene; clip 2 (the next cut) starts on the solid red scene.
    const [first] = clipsOf(await readState(page), "Main");
    await clickClip(page, first.id);
    await seek(page, 0.2);
    await page.getByRole("button", { name: "Transitions", exact: true }).first().click();
    await settle(page, 600);
    const project = testInfo.project.name;
    for (const label of ["Wipe left", "Iris"]) {
      const card = await waitForPoster(page, label);
      expect(card.source).toBe("footage");
      // A moment of the same clip 1 s later is still testsrc2: only the next clip's first frame is red.
      expect(card.redShare, `${label}: incoming shot is the next clip`).toBeGreaterThan(0.3);
      expect(card.otherShare, `${label}: outgoing shot still shows`).toBeGreaterThan(0.08);
    }
    await page.screenshot({ path: `${SHOTS}/${project}-transitions-next-clip.png` });

    const iris = page.locator('button[aria-label^="Iris. Drag"]').first();
    await iris.hover();
    await expect.poll(async () => (await readCard(page, "Iris")).state, { timeout: 30_000 }).toBe("playing");
    const seen: CardRead[] = [];
    for (let i = 0; i < 12; i++) {
      seen.push(await readCard(page, "Iris"));
      await page.waitForTimeout(150);
    }
    expect(new Set(seen.map((f) => f.frame)).size, "hover shows several frames").toBeGreaterThanOrEqual(3);
    const reds = seen.map((f) => f.redShare);
    expect(Math.max(...reds) - Math.min(...reds), "hover sweeps from the outgoing to the incoming shot").toBeGreaterThan(0.3);
    await page.mouse.move(5, 5);
    await expect.poll(async () => (await readCard(page, "Iris")).state, { timeout: 5_000 }).toBe("poster");

    // Keyboard focus plays the same sweep.
    await page.locator('button[aria-label^="Wipe left. Drag"]').first().focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect.poll(async () => (await readCard(page, "Wipe left")).state, { timeout: 30_000 }).toBe("playing");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect.poll(async () => (await readCard(page, "Wipe left")).state, { timeout: 5_000 }).toBe("poster");
  });

  test("Spin and flip cards read as turning footage (large, lit), not small dark tiles", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);
    // 0.2 s: the moving testsrc2 scene, full of structure everywhere in the frame.
    await seek(page, 0.2);
    await page.getByRole("button", { name: "Transitions", exact: true }).first().click();
    await page.getByRole("group", { name: "Transition categories" }).getByRole("button", { name: "Slide", exact: true }).click();
    await settle(page, 600);
    const reads: Record<string, CardRead> = {};
    for (const label of ["Spin Clockwise", "Spin Counterclockwise", "Flip Horizontal", "Flip Vertical"]) {
      const card = await waitForPoster(page, label);
      reads[label] = card;
      expect(card.source).toBe("footage");
      // At the old resting points (0.3) a spin was a small faded tile on black (>= 55% dark) and a horizontal
      // flip a sliver (60% of the width empty); now most of the card is the shot.
      const dark = await darkShare(page, label);
      console.log(`${label} dark=${dark.toFixed(3)} std=${card.std.toFixed(1)}`);
      expect(dark, `${label}: most of the card shows footage`).toBeLessThan(0.34);
      expect(card.std, `${label}: has image structure`).toBeGreaterThan(20);
    }
    expect(
      signatureDiff(reads["Spin Clockwise"].signature, reads["Spin Counterclockwise"].signature),
      "clockwise and counterclockwise turn opposite ways",
    ).toBeGreaterThan(4);
    expect(
      signatureDiff(reads["Flip Horizontal"].signature, reads["Flip Vertical"].signature),
      "horizontal and vertical flips squeeze different axes",
    ).toBeGreaterThan(4);
    await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-spin-flip-posters.png` });
  });

  test("The incoming shot of a transition card moves during hover when it is footage (same-track next clip, real footage)", async ({ page }, testInfo) => {
    test.skip(!existsSync(`${REAL_FOOTAGE}/Interview_Office.mp4`), "real footage folder not available");
    test.setTimeout(300_000);
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      try {
        localStorage.setItem("openreel-onboarding-complete", "true");
        localStorage.setItem("openreel-mograph-tour-complete", "true");
      } catch {
        /* the tour just shows */
      }
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Horizontal/ }).click();
    await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
    await placeRealFootage(page, ["Interview_Office.mp4", "Ocean_Gold.mp4"]);
    const state = await readState(page);
    const main = track(state, "Main");
    expect(main.clips, "both clips are on the same track").toHaveLength(2);
    await clickClip(page, main.clips[0].id);
    await seek(page, 1.0);
    await page.getByRole("button", { name: "Transitions", exact: true }).first().click();
    await settle(page, 1_000);
    const project = testInfo.project.name;
    const poster = await waitForPoster(page, "Cross dissolve");
    expect(poster.source).toBe("footage");
    await page.screenshot({ path: `${SHOTS}/${project}-real-same-track-poster.png` });

    await page.locator('button[aria-label^="Cross dissolve. Drag"]').first().hover();
    await expect.poll(async () => (await readCard(page, "Cross dissolve")).state, { timeout: 30_000 }).toBe("playing");
    // The last frames of the loop hold the blend at 1: only the incoming shot is visible, and on its own
    // timeline it moves. A frozen incoming frame would make every one of these frames identical.
    const tail = new Map<string, CardRead>();
    const head = new Map<string, CardRead>();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && (tail.size < 3 || head.size < 2)) {
      const read = await readCard(page, "Cross dissolve");
      const index = Number(read.frame);
      if (index >= 21) tail.set(read.frame ?? "", read);
      if (index === 0 || index === 1) head.set(read.frame ?? "", read);
      await page.waitForTimeout(40);
    }
    expect(tail.size, "saw several frames of the held incoming shot").toBeGreaterThanOrEqual(2);
    const frames = [...tail.values()];
    let spread = 0;
    for (const a of frames) for (const b of frames) spread = Math.max(spread, signatureDiff(a.signature, b.signature));
    expect(spread, "the incoming footage changes between the held end frames").toBeGreaterThan(0.4);
    await page.screenshot({ path: `${SHOTS}/${project}-real-same-track-hover.png` });
    await page.mouse.move(5, 5);
    await expect.poll(async () => (await readCard(page, "Cross dissolve")).state, { timeout: 5_000 }).toBe("poster");
  });

}
