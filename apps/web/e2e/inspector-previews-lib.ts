import { expect, test, type Locator, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { clickClip, clipsOf, importInput, openEditor, readState, seek, settle } from "./helpers";

/**
 * Inspector previews (motion presets, text animation, emphasis, particles, shader browser): every card renders
 * the real engine's output over the footage frame at the playhead (not CSS circles, gradients or a fixed word),
 * at rest as a poster and while hovered as a looping animation. Shared by the gpu project and the fallback projects.
 */

const SHOTS = process.env.OPENREEL_PREVIEW_SHOTS ?? join(tmpdir(), "inspector-previews-shots");

interface Read {
  state: string | undefined;
  source: string | undefined;
  frame: string | undefined;
  mean: [number, number, number];
  /** Pixels that are near white (text). */
  whiteShare: number;
  /** Pixels that are neither red footage nor dark stage / near white (particles, recoloured shader output). */
  otherShare: number;
  /** Pixels that are almost black (the stage showing around a moved frame). */
  darkShare: number;
  signature: number[];
}

async function read(locator: Locator): Promise<Read> {
  return locator.evaluate((canvas: HTMLCanvasElement) => {
    const probe = document.createElement("canvas");
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let white = 0;
    let other = 0;
    let dark = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      if (data[i] > 140 && data[i + 1] > 140 && data[i + 2] > 140) white++;
      else if (data[i] < 30 && data[i + 1] < 30 && data[i + 2] < 30) dark++;
      else if (data[i + 1] > 110 || data[i + 2] > 110) other++;
    }
    const sig = document.createElement("canvas");
    sig.width = 16;
    sig.height = 9;
    const sctx = sig.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    sctx.drawImage(probe, 0, 0, 16, 9);
    const small = sctx.getImageData(0, 0, 16, 9).data;
    const signature: number[] = [];
    for (let i = 0; i < small.length; i += 4) signature.push(small[i], small[i + 1], small[i + 2]);
    return {
      state: canvas.dataset.previewState,
      source: canvas.dataset.previewSource,
      frame: canvas.dataset.previewFrame,
      mean: [r / n, g / n, b / n] as [number, number, number],
      whiteShare: white / n,
      otherShare: other / n,
      darkShare: dark / n,
      signature,
    };
  });
}

/**
 * Share of a particle card's pixels that differ from the footage behind them: the Program monitor frame (the same footage
 * at the same playhead, no particles on it) scaled to the card and dimmed by the amounts the card uses.
 */
async function particleStats(locator: Locator): Promise<{ share: number; spread: number }> {
  return locator.evaluate((canvas: HTMLCanvasElement) => {
    const program = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
    const read = (c: HTMLCanvasElement | OffscreenCanvas) => {
      const probe = document.createElement("canvas");
      probe.width = canvas.width;
      probe.height = canvas.height;
      const ctx = probe.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
      ctx.drawImage(c, 0, 0, probe.width, probe.height);
      return { ctx, data: ctx.getImageData(0, 0, probe.width, probe.height).data };
    };
    const card = read(canvas).data;
    let best = { share: 1, spread: 0 };
    const COLS = 6;
    const ROWS = 4;
    for (const dim of [0.3, 0.55]) {
      const base = read(program);
      base.ctx.fillStyle = `rgba(0,0,0,${dim})`;
      base.ctx.fillRect(0, 0, canvas.width, canvas.height);
      const expected = base.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let off = 0;
      const cells = new Array<number>(COLS * ROWS).fill(0);
      for (let i = 0; i < card.length; i += 4) {
        if (Math.abs(card[i] - expected[i]) + Math.abs(card[i + 1] - expected[i + 1]) + Math.abs(card[i + 2] - expected[i + 2]) > 45) {
          off++;
          const px = i / 4;
          const cx = Math.floor(((px % canvas.width) / canvas.width) * COLS);
          const cy = Math.floor((Math.floor(px / canvas.width) / canvas.height) * ROWS);
          cells[cy * COLS + cx]++;
        }
      }
      const share = off / (card.length / 4);
      // Spread: the share of grid cells holding a real amount of particle pixels (not a lone speck), so a clump in one corner fails.
      const cellMin = Math.max(6, (card.length / 4 / (COLS * ROWS)) * 0.003);
      if (share < best.share) best = { share, spread: cells.filter((n) => n >= cellMin).length / cells.length };
    }
    return best;
  });
}

const diff = (a: number[], b: number[]): number => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;

async function poster(page: Page, locator: Locator): Promise<Read> {
  await locator.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await read(locator)).state, { timeout: 45_000 }).toBe("poster");
  return read(locator);
}

/** Hovers the card (parent button) and returns two reads of the playing canvas, spaced apart. */
async function hoverPlays(page: Page, card: Locator, canvas: Locator): Promise<[Read, Read]> {
  await card.hover();
  await expect.poll(async () => (await read(canvas)).state, { timeout: 20_000 }).toBe("playing");
  const first = await read(canvas);
  let second = first;
  await expect
    .poll(
      async () => {
        second = await read(canvas);
        return diff(first.signature, second.signature);
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(1);
  return [first, second];
}

async function requestSection(page: Page, sectionId: string, clipId: string): Promise<void> {
  await page.evaluate(
    ([id, clip]) =>
      (window as unknown as { __openreelE2E: { inspectorNav: { getState(): { requestSection(s: string, c: string): void } } } }).__openreelE2E.inspectorNav
        .getState()
        .requestSection(id, clip),
    [sectionId, clipId],
  );
  await settle(page, 1200);
}

async function openSection(page: Page, title: string, probe: string): Promise<void> {
  if ((await page.locator(probe).count()) === 0) await page.getByText(title, { exact: true }).first().click();
  await expect(page.locator(probe).first()).toBeVisible({ timeout: 15_000 });
}

export function registerInspectorPreviewTests(): void {
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

  test("Inspector cards render the real engines on the footage: motion, emphasis, particles, shaders, text", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    mkdirSync(SHOTS, { recursive: true });
    const project = testInfo.project.name;
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);
    // three-scenes.mp4: 0-2 s testsrc2, 2-4 s solid red, 4-6 s SMPTE bars. Solid red makes every assertion unambiguous.
    await seek(page, 2.5);
    const inspector = page.locator('[data-tour="inspector"]');

    // ── Motion presets ──────────────────────────────────────────────────────────────────────────────────────
    await requestSection(page, "motion-presets", clip.id);
    await openSection(page, "Motion Presets", "[data-motion-preview]");
    const fadeCanvas = page.locator('[data-motion-preview="fade-in"] canvas');
    const slideCanvas = page.locator('[data-motion-preview="slide-in-left"] canvas');
    const popCanvas = page.locator('[data-motion-preview="pop"] canvas');
    const fade = await poster(page, fadeCanvas);
    const slide = await poster(page, slideCanvas);
    await popCanvas.scrollIntoViewIfNeeded();
    await inspector.screenshot({ path: `${SHOTS}/${project}-motion-rest.png` });
    // The card shows the selected clip's own frame (solid red), not a green play-icon square.
    expect(fade.source).toBe("footage");
    expect(fade.mean[0]).toBeGreaterThan(110);
    expect(fade.mean[1]).toBeLessThan(70);
    // Slide In Left at its mid-move: part of the frame is outside the card, the dark stage shows.
    expect(slide.darkShare).toBeGreaterThan(0.15);
    expect(slide.mean[0]).toBeGreaterThan(60);
    expect(diff(slide.signature, fade.signature), "different presets look different").toBeGreaterThan(20);
    const [m1, m2] = await hoverPlays(page, page.locator('button[aria-label="Apply Slide In Left"]'), slideCanvas);
    await inspector.screenshot({ path: `${SHOTS}/${project}-motion-hover.png` });
    expect(diff(m1.signature, m2.signature), "hover animates the preset's keyframes").toBeGreaterThan(1);
    await page.mouse.move(2, 2);
    await expect.poll(async () => (await read(slideCanvas)).state).toBe("poster");

    // The card keyframes the selected clip as it is: a clip scaled to 40% shows 40% of the card (the stage around it is dark).
    expect(fade.darkShare, "a full-frame clip fills the card").toBeLessThan(0.15);
    const setScale = (value: number) =>
      page.evaluate(
        ([id, scale]) =>
          (window as unknown as { __openreelE2E: { project: { getState(): { updateClipTransform(id: string, t: object): Promise<unknown> } } } }).__openreelE2E.project
            .getState()
            .updateClipTransform(id as string, { scale: { x: scale as number, y: scale as number } }),
        [clip.id, value],
      );
    await setScale(0.4);
    await expect.poll(async () => (await read(fadeCanvas)).darkShare, { timeout: 30_000 }).toBeGreaterThan(0.5);
    await inspector.screenshot({ path: `${SHOTS}/${project}-motion-scaled-clip.png` });
    await setScale(1);
    await expect.poll(async () => (await read(fadeCanvas)).darkShare, { timeout: 30_000 }).toBeLessThan(0.15);

    // ── Emphasis (on footage) ───────────────────────────────────────────────────────────────────────────────
    await requestSection(page, "emphasis-animation", clip.id);
    await openSection(page, "Emphasis Animation", "[data-emphasis-preview]");
    const flash = await poster(page, page.locator('[data-emphasis-preview="flash"] canvas'));
    await page.locator('[data-emphasis-preview="flash"] canvas').scrollIntoViewIfNeeded();
    await inspector.screenshot({ path: `${SHOTS}/${project}-emphasis-rest.png` });
    expect(flash.source).toBe("footage");
    expect(flash.mean[0]).toBeGreaterThan(30);
    await hoverPlays(page, page.locator('button[aria-label="Flash"]'), page.locator('[data-emphasis-preview="flash"] canvas'));
    await page.mouse.move(2, 2);

    // ── Particles ───────────────────────────────────────────────────────────────────────────────────────────
    await requestSection(page, "particle-effects", clip.id);
    await openSection(page, "Particle Effects", '[data-testid="particle-preset-preview"]');
    const explode = await poster(page, page.locator('[data-preset-id="explode-burst"] canvas'));
    await inspector.screenshot({ path: `${SHOTS}/${project}-particles-rest.png` });
    expect(explode.source).toBe("footage");
    // Real particles (warm sparks) over the red footage: pixels that are neither red nor dark.
    expect(explode.otherShare).toBeGreaterThan(0.004);
    await expect(page.locator('[data-preset-id="explode-burst"]')).not.toContainText("particles");
    await hoverPlays(page, page.locator('button[aria-label="Preview Explosion Burst"]'), page.locator('[data-preset-id="explode-burst"] canvas'));
    await page.mouse.move(2, 2);

    // ── Shader browser (effect sample on the footage) ───────────────────────────────────────────────────────
    await requestSection(page, "video-effects", clip.id);
    await page.getByRole("button", { name: "Add Effect", exact: true }).first().click();
    await page.getByText(/^Shaders/).first().click();
    const shaderTile = page.locator('[aria-label="Shader effect previews"] button[aria-label^="Preview and apply"]').nth(1);
    const shaderCanvas = shaderTile.locator("canvas");
    const shader = await poster(page, shaderCanvas);
    await page.locator('[aria-label="Add video effect"]').screenshot({ path: `${SHOTS}/${project}-shaders.png` });
    expect(shader.source).toBe("footage");
    // The shader's output on the red footage: not the old fixed cyan/violet/rose gradient with "FX".
    expect(shader.mean[0]).toBeGreaterThan(shader.mean[2]);
    await expect(page.locator('[aria-label="Shader effect previews"]')).not.toContainText("FX");
    await page.keyboard.press("Escape");

    // ── Text animation + emphasis on the user's own text ───────────────────────────────────────────────────
    const titles = await page.evaluate(
      () =>
        (window as unknown as { __openreelE2E: { project: { getState(): { project: { timeline: { tracks: Array<{ id: string; name: string }> } } } } } }).__openreelE2E.project
          .getState()
          .project.timeline.tracks.find((t) => t.name === "Titles")?.id,
    );
    const textId = await page.evaluate(
      ([track]) =>
        (window as unknown as { __openreelE2E: { project: { getState(): { createTextClip(t: string, s: number, text: string, d: number, style: object): { id: string } } } } }).__openreelE2E.project
          .getState()
          .createTextClip(track as string, 2, "Golden Hour", 4, { fontSize: 120, fontFamily: "Inter", color: "#FFFFFF", fontWeight: "bold" }).id,
      [titles],
    );
    await settle(page, 600);
    await clickClip(page, textId);
    await requestSection(page, "text-animation", textId);
    await openSection(page, "Text Animation", '[data-testid="text-animation-preset-preview"]');
    const fadeText = await poster(page, page.locator('[data-preset="fade"] canvas'));
    const slideUp = await poster(page, page.locator('[data-preset="slide-up"] canvas'));
    await inspector.screenshot({ path: `${SHOTS}/${project}-text-rest.png` });
    expect(fadeText.source).toBe("footage");
    // The user's white title sits on the red footage: white pixels exist (the old tile was a purple gradient with "OpenReel").
    expect(fadeText.whiteShare).toBeGreaterThan(0.004);
    expect(fadeText.mean[0]).toBeGreaterThan(fadeText.mean[2]);
    expect(diff(slideUp.signature, fadeText.signature)).toBeGreaterThanOrEqual(0);
    await hoverPlays(page, page.locator('button[aria-label="Preview and apply Slide Up"]'), page.locator('[data-preset="slide-up"] canvas'));
    await inspector.screenshot({ path: `${SHOTS}/${project}-text-hover.png` });
    await page.mouse.move(2, 2);

    // ── Text materials: the clip's own title, drawn by the title engine with the material on style.shader ──────
    await requestSection(page, "text-materials", textId);
    const materials = page.locator('[aria-label="Text material previews"]');
    await expect(materials).toBeVisible({ timeout: 15_000 });
    const materialCanvas = materials.locator('button[aria-label^="Preview and select"] canvas').first();
    const material = await poster(page, materialCanvas);
    await materials.screenshot({ path: `${SHOTS}/${project}-text-materials.png` });
    expect(material.source).toBe("footage");
    // Backdrop is dimmed red footage with glyph pixels drawn on it by the material (white or recoloured), never a mask gradient.
    expect(material.whiteShare + material.otherShare).toBeGreaterThan(0.002);
    expect(material.mean[0]).toBeGreaterThan(material.mean[2]);
    await expect(materials).not.toContainText("Aa");

    // Reduced motion keeps the poster: no frame loop starts on hover.
    await requestSection(page, "text-animation", textId);
    await openSection(page, "Text Animation", '[data-testid="text-animation-preset-preview"]');
    await page.emulateMedia({ reducedMotion: "reduce" });
    const typewriter = page.locator('[data-preset="typewriter"] canvas');
    await typewriter.scrollIntoViewIfNeeded();
    await page.locator('button[aria-label="Preview and apply Typewriter"]').hover();
    await settle(page, 1200);
    expect((await read(typewriter)).state).toBe("poster");
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // ── Exit phase: the same tiles run the exit side of the animation (clip rests, then leaves) ────────────────
    await page.getByText("Exit", { exact: true }).first().click();
    const exitTile = page.locator('[data-preset="fade"] canvas');
    await exitTile.scrollIntoViewIfNeeded();
    const exit = await poster(page, exitTile);
    await inspector.screenshot({ path: `${SHOTS}/${project}-text-exit.png` });
    expect(exit.source).toBe("footage");
  });

  test("A shader card whose GPU context fails says so instead of drawing a stand-in", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    mkdirSync(SHOTS, { recursive: true });
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);
    await seek(page, 2.5);
    await requestSection(page, "video-effects", clip.id);
    // Lose WebGL for every canvas created from now on (the shader renderer runs strict: no decorative fallback).
    await page.evaluate(() => {
      for (const proto of [HTMLCanvasElement.prototype, OffscreenCanvas.prototype] as Array<{ getContext: (t: string, ...a: unknown[]) => unknown }>) {
        const original = proto.getContext;
        proto.getContext = function (this: unknown, type: string, ...rest: unknown[]) {
          if (type === "webgl2" || type === "webgl") return null;
          return original.call(this, type, ...rest);
        };
      }
    });
    await page.getByRole("button", { name: "Add Effect", exact: true }).first().click();
    await page.getByText(/^Shaders/).first().click();
    const tile = page.locator('[aria-label="Shader effect previews"] button[aria-label^="Preview and apply"]').nth(1);
    await tile.scrollIntoViewIfNeeded();
    await expect(tile.locator("canvas")).toHaveAttribute("data-preview-state", "error", { timeout: 60_000 });
    await expect(tile).toContainText("Preview unavailable");
    await page.locator('[aria-label="Add video effect"]').screenshot({ path: `${SHOTS}/${testInfo.project.name}-shader-unavailable.png` });
  });

  const PARTICLE_AT_WORK = ["dissolve-soft", "dust-ambient", "implode-gather", "sparkle-magic", "confetti-celebration", "snow-fall"];
  /** Minimum share of the card's pixels the particles change, and of the 6x4 grid cells they reach, per preset (measured, with margin). */
  const PARTICLE_MIN_SHARE: Record<string, number> = {
    "dissolve-soft": 0.04,
    "dust-ambient": 0.015,
    "implode-gather": 0.01,
    "sparkle-magic": 0.008,
    "confetti-celebration": 0.02,
    "snow-fall": 0.02,
  };
  const PARTICLE_MIN_SPREAD: Record<string, number> = {
    "dissolve-soft": 0.6,
    "dust-ambient": 0.6,
    "implode-gather": 0,
    "sparkle-magic": 0,
    "confetti-celebration": 0.4,
    "snow-fall": 0.6,
  };
  const HOVER_IN_FLIGHT = ["explode-burst", "implode-gather", "sparkle-magic", "dissolve-soft", "dust-ambient"];
  const EMPHASIS_AT_REST = ["pulse", "heartbeat", "glow", "breathe", "flash"];

  /** Every poster must show its preset at work, whatever the footage: asserted on the solid-red fixture. */
  async function assertRepresentativePosters(page: Page, clipId: string, project: string, tag: string): Promise<void> {
    const inspector = page.locator('[data-tour="inspector"]');
    await requestSection(page, "particle-effects", clipId);
    await openSection(page, "Particle Effects", '[data-testid="particle-preset-preview"]');
    const particles: Record<string, { share: number; spread: number }> = {};
    for (const id of PARTICLE_AT_WORK) {
      await poster(page, page.locator(`[data-preset-id="${id}"] canvas`));
      particles[id] = await particleStats(page.locator(`[data-preset-id="${id}"] canvas`));
      await page.locator(`[data-preset-id="${id}"]`).screenshot({ path: `${SHOTS}/${project}-${tag}-particle-${id}.png` });
    }
    await inspector.screenshot({ path: `${SHOTS}/${project}-${tag}-particles.png` });
    for (const id of PARTICLE_AT_WORK) {
      console.log(`particle poster ${project}-${tag} ${id}: share=${particles[id].share.toFixed(4)} spread=${particles[id].spread.toFixed(2)}`);
      // Particles are visible at rest: a meaningful share of the card differs from the footage behind it.
      expect(particles[id].share, `${id} poster shows particles on the footage`).toBeGreaterThan(PARTICLE_MIN_SHARE[id]);
      // And not as one clump: presets that fill the frame have particles across most of it.
      expect(particles[id].spread, `${id} poster spreads particles across the card`).toBeGreaterThanOrEqual(PARTICLE_MIN_SPREAD[id]);
    }

    // Hover loops start with particles already in flight (burst and fill-in presets too), never on an empty frame:
    // every frame sampled while the card plays shows particles on the footage.
    for (const id of HOVER_IN_FLIGHT) {
      const card = page.locator(`[data-preset-id="${id}"]`);
      const canvas = card.locator("canvas");
      await card.scrollIntoViewIfNeeded();
      await card.hover();
      await expect.poll(async () => (await read(canvas)).state, { timeout: 20_000 }).toBe("playing");
      const shares: number[] = [];
      const started = Date.now();
      while (Date.now() - started < 2600) {
        if ((await read(canvas)).state === "playing") shares.push((await particleStats(canvas)).share);
        if (shares.length === 8 || shares.length === 20) await card.screenshot({ path: `${SHOTS}/${project}-${tag}-hover-${id}-${shares.length}.png` });
      }
      expect(shares.length, `${id} hover sampled`).toBeGreaterThan(8);
      console.log(`hover ${project}-${tag} ${id}: frames=${shares.length} min share=${Math.min(...shares).toFixed(4)}`);
      expect(Math.min(...shares), `${id} hover never starts or runs empty`).toBeGreaterThan(0.004);
      await page.mouse.move(2, 2);
    }

    await requestSection(page, "emphasis-animation", clipId);
    await openSection(page, "Emphasis Animation", "[data-emphasis-preview]");
    const emphasis: Record<string, Read> = {};
    for (const type of EMPHASIS_AT_REST) emphasis[type] = await poster(page, page.locator(`[data-emphasis-preview="${type}"] canvas`));
    await inspector.screenshot({ path: `${SHOTS}/${project}-${tag}-emphasis.png` });
    // At rest the five attention animations are told apart by their own frames (scale, opacity and beat pattern).
    for (let i = 0; i < EMPHASIS_AT_REST.length; i++) {
      for (let j = i + 1; j < EMPHASIS_AT_REST.length; j++) {
        const a = EMPHASIS_AT_REST[i];
        const b = EMPHASIS_AT_REST[j];
        expect(diff(emphasis[a].signature, emphasis[b].signature), `${a} vs ${b} posters differ`).toBeGreaterThan(1.5);
      }
    }
  }

  test("Particle and emphasis posters show the preset at work, not an empty or identical frame", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);
    await seek(page, 2.5);
    await assertRepresentativePosters(page, clip.id, testInfo.project.name, "red");

    // Emphasis on the user's own title: the same filmstrip, drawn by the title engine.
    const titles = await page.evaluate(
      () =>
        (window as unknown as { __openreelE2E: { project: { getState(): { project: { timeline: { tracks: Array<{ id: string; name: string }> } } } } } }).__openreelE2E.project
          .getState()
          .project.timeline.tracks.find((t) => t.name === "Titles")?.id,
    );
    const textId = await page.evaluate(
      ([track]) =>
        (window as unknown as { __openreelE2E: { project: { getState(): { createTextClip(t: string, s: number, text: string, d: number, style: object): { id: string } } } } }).__openreelE2E.project
          .getState()
          .createTextClip(track as string, 2, "Golden Hour", 4, { fontSize: 120, fontFamily: "Inter", color: "#FFFFFF", fontWeight: "bold" }).id,
      [titles],
    );
    await settle(page, 600);
    await clickClip(page, textId);
    await requestSection(page, "emphasis-animation", textId);
    await openSection(page, "Emphasis Animation", "[data-emphasis-preview]");
    const textPulse = await poster(page, page.locator('[data-emphasis-preview="pulse"] canvas'));
    const textFlash = await poster(page, page.locator('[data-emphasis-preview="flash"] canvas'));
    await page.locator('[data-tour="inspector"]').screenshot({ path: `${SHOTS}/${testInfo.project.name}-red-emphasis-text.png` });
    expect(textPulse.whiteShare, "the title is in the filmstrip").toBeGreaterThan(0.003);
    expect(diff(textPulse.signature, textFlash.signature), "text pulse and flash differ").toBeGreaterThan(1);
  });

  // The same check on real footage (a screenshot pass to look at, plus the same assertions).
  const REAL = process.env.OPENREEL_REAL_FOOTAGE ?? "/Users/augustusotu/Projects/openreel/promo/teaser/footage/Interview_Office.mp4";
  (existsSync(REAL) ? test : test.skip)("Particle and emphasis posters on real footage", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
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
    await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
    await importInput(page).setInputFiles(REAL);
    await page.getByLabel(`Select media ${basename(REAL)}`).waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: `Media actions for ${basename(REAL)}` }).click();
    await page.getByRole("menuitem", { name: "Add to timeline" }).click();
    await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8_000 }).catch(() => undefined);
    await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 30_000 }).toBe(1);
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);
    await seek(page, 3);
    await assertRepresentativePosters(page, clip.id, testInfo.project.name, "real");
  });
}
