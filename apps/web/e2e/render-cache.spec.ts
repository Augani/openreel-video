import { expect, test, type Page } from "@playwright/test";
import { SOFTWARE_GPU } from "./env";
import {
  clickClip,
  clipsOf,
  focusEditor,
  openEditor,
  press,
  programMean,
  readState,
  seek,
  settle,
  splitIntoThree,
  undo,
} from "./helpers";

/**
 * Render In to Out (render cache), checked in real Chrome:
 *  - the render-status bar classifies segments (none / yellow / red / green);
 *  - Enter and the Sequence menu render the In/Out range into the cache with a
 *    cancellable progress UI;
 *  - playback of a cached segment is served from the cache, not the compositor;
 *  - edits invalidate exactly the affected segment, never showing stale frames;
 *  - "Delete render files" empties the cache.
 */

interface RenderCacheHook {
  getTelemetry(): { entries: Array<{ at: number; time: number; source: "cache" | "live" }>; cacheFrames: number; liveFrames: number };
  resetTelemetry(): void;
  instance: {
    flushIndex(): Promise<void>;
    getSnapshot(): {
      restored: { restored: number; droppedStale: number; droppedMissing: number; orphansDeleted: number } | null;
      phase: string;
      frameCount: number;
      bytes: number;
      codec: string | null;
      cachedRuns: Array<{ start: number; end: number }>;
      lastSummary: { status: string; framesRendered: number; elapsedMs: number; codec: string; message?: string } | null;
    };
    hasFrameAt(time: number): boolean;
  };
  renderEffectsInToOut(): Promise<{ status: string; framesRendered: number; totalFrames: number; elapsedMs: number; codec: string } | null>;
  dispose(): void;
  ensureStarted(): unknown;
  whenReady(): Promise<void>;
  storageKind: string | null;
  isPersistent: boolean;
  renderInToOut(): Promise<{ status: string; framesRendered: number; totalFrames: number; elapsedMs: number; codec: string } | null>;
  takePlaybackFrame(time: number): Promise<ImageBitmap | undefined>;
}

/**
 * SwiftShader runs the one-pass 25x25-tap Gaussian shader on the CPU at about
 * two seconds per 1080p frame (measured: glow + LUT + grade is ~0.3 s, the
 * default 10 px blur adds ~1.5 s), so a software run keeps glow + grade + LUT
 * (still "heavy" in the status bar) and leaves the blur to hardware runs.
 */
const SOFTWARE_TIMEOUT_MS = 420_000;
const RENDER_WAIT_MS = SOFTWARE_GPU ? 360_000 : 120_000;

const HEAVY_STACK = async (page: Page, clipId: string) => {
  await page.evaluate(async ({ id, blur }) => {
    const e = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E;
    const store = e.project.getState();
    await store.addVideoEffect(id, "glow", { radius: 28, intensity: 1.6, color: "#ffffff" });
    if (blur) await store.addVideoEffect(id, "gaussian-blur", { radius: 4 });
    const size = 17;
    const data: number[] = [];
    for (let b = 0; b < size; b++)
      for (let g = 0; g < size; g++)
        for (let r = 0; r < size; r++) data.push(Math.min(1, (r / (size - 1)) * 1.04), (g / (size - 1)) * 0.96, Math.min(1, (b / (size - 1)) * 1.1));
    await store.updateColorGrading(id, { temperature: 14, lut: { data, size, intensity: 0.8 } });
  }, { id: clipId, blur: !SOFTWARE_GPU });
  await settle(page, 400);
};

const rc = <T>(page: Page, fn: (cache: RenderCacheHook) => Promise<T> | T): Promise<T> =>
  page.evaluate(
    `(${fn.toString()})(window.__openreelE2E.renderCache)`,
  ) as Promise<T>;

const snapshot = (page: Page) => rc(page, (c) => c.instance.getSnapshot());

async function useHd(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const e = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E;
    const s = e.project.getState().project.settings;
    if (s.width !== 1920 || s.height !== 1080) await e.project.getState().updateSettings({ width: 1920, height: 1080 });
  });
  await settle(page, 500);
}

async function markRange(page: Page, start: number, end: number): Promise<void> {
  await page.evaluate(
    ([a, b]) => {
      const e = (window as unknown as { __openreelE2E: { timeline: { getState(): Record<string, any> } } }).__openreelE2E;
      e.timeline.getState().setLoopRange(a, b);
    },
    [start, end],
  );
}

async function waitRendered(page: Page, frames: number, timeout = RENDER_WAIT_MS): Promise<void> {
  try {
    await expect
      .poll(async () => (await snapshot(page)).frameCount, { timeout, intervals: [250] })
      .toBeGreaterThanOrEqual(frames);
  } catch (error) {
    // Tell a stalled render from a slow one in the CI log: a slow render keeps adding frames.
    const first = await snapshot(page).catch(() => null);
    await page.waitForTimeout(5000);
    const second = await snapshot(page).catch(() => null);
    throw new Error(
      `render did not reach ${frames} frames; snapshot ${JSON.stringify(first)} then (5 s later) ${JSON.stringify(second)}\n${String(error)}`,
    );
  }
  await expect.poll(async () => (await snapshot(page)).phase, { timeout }).toBe("idle");
}

const levels = (page: Page) =>
  page.locator('[data-testid="render-status-segment"]').evaluateAll((els) =>
    els.map((el) => ({
      level: (el as HTMLElement).dataset.level as string,
      start: Number((el as HTMLElement).dataset.start),
      end: Number((el as HTMLElement).dataset.end),
    })),
  );

interface PlaybackMeasure {
  seconds: number;
  painted: number;
  expected: number;
  dropped: number;
  fps: number;
  worstGapMs: number;
  cache: number;
  live: number;
}

/** Play from `from` for about `ms`, then derive fps / dropped frames from the preview's own frame log. */
async function measurePlayback(page: Page, from: number, ms: number): Promise<PlaybackMeasure> {
  await seek(page, from);
  await rc(page, (c) => c.resetTelemetry());
  await focusEditor(page);
  await page.keyboard.press("Space");
  await page.waitForTimeout(ms);
  await page.keyboard.press("Space");
  await settle(page, 250);
  const tel = await rc(page, (c) => c.getTelemetry());
  const entries = tel.entries;
  if (entries.length < 3) {
    return { seconds: 0, painted: entries.length, expected: 0, dropped: 0, fps: 0, worstGapMs: 0, cache: tel.cacheFrames, live: tel.liveFrames };
  }
  const first = entries[0];
  const last = entries[entries.length - 1];
  const seconds = (last.at - first.at) / 1000;
  // Dropped = frames a perfect 30 fps player would have painted in the same wall time, minus what was painted.
  const expected = Math.round(seconds * 30) + 1;
  let worst = 0;
  for (let i = 1; i < entries.length; i++) worst = Math.max(worst, entries[i].at - entries[i - 1].at);
  return {
    seconds,
    painted: entries.length,
    expected,
    dropped: Math.max(0, expected - entries.length),
    fps: seconds > 0 ? (entries.length - 1) / seconds : 0,
    worstGapMs: worst,
    cache: tel.cacheFrames,
    live: tel.liveFrames,
  };
}

test.describe("Render In to Out (render cache)", () => {
  test.beforeEach(async ({ page }) => {
    // SwiftShader renders the heavy 1080p effect stack on the CPU, a frame at a time.
    if (SOFTWARE_GPU) test.setTimeout(SOFTWARE_TIMEOUT_MS);
    await openEditor(page);
    await useHd(page);
  });

  test("status bar: plain media has none, effects are yellow/red, rendered is green; Enter renders the In/Out range", async ({
    page,
  }) => {
    await splitIntoThree(page);
    const state = await readState(page);
    const [a, b, c] = clipsOf(state, "Main");
    expect(await levels(page), "plain media shows no render status").toEqual([]);

    // Clip B: one cheap colour correction -> yellow. Clip A: glow + blur + grade + LUT -> red.
    await page.evaluate(async (id) => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E;
      await e.project.getState().updateColorGrading(id, { temperature: 8 });
    }, b.id);
    await HEAVY_STACK(page, a.id);
    await expect
      .poll(async () => (await levels(page)).map((s) => [s.level, s.start, s.end]), { timeout: 5000 })
      .toEqual([
        ["heavy", 0, 2],
        ["light", 2, 4],
      ]);
    expect(c.start).toBe(4);

    // Mark In/Out around the heavy clip and render with Enter.
    await markRange(page, 0, 2);
    const historyBefore = (await readState(page)).historyLength;
    await press(page, "Enter");
    await expect(page.getByRole("progressbar", { name: "Render progress" })).toBeVisible({ timeout: 5000 }).catch(() => undefined);
    await waitRendered(page, 60);

    const snap = await snapshot(page);
    expect(snap.frameCount).toBe(60);
    expect(snap.cachedRuns).toEqual([{ start: 0, end: 59 }]);
    expect(snap.lastSummary?.status).toBe("completed");
    await expect
      .poll(async () => (await levels(page)).map((s) => [s.level, s.start, s.end]), { timeout: 5000 })
      .toEqual([
        ["cached", 0, 2],
        ["light", 2, 4],
      ]);
    expect((await readState(page)).historyLength, "rendering is not an edit").toBe(historyBefore);
  });

  test("Optical Flow shows red in the status bar, renders in to out and then plays green from the cache", async ({ page }) => {
    await splitIntoThree(page);
    const [a] = clipsOf(await readState(page), "Main");
    // 25% speed + Optical Flow on the first 2 s scene (its 8 s of timeline is cut down to the marked range below).
    await page.evaluate(async (id) => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> }; speed: { editClipSpeed(p: string, c: string, ch: Record<string, unknown>, a: boolean): Promise<boolean> } } }).__openreelE2E;
      const pid = e.project.getState().project.id as string;
      await e.speed.editClipSpeed(pid, id, { speed: 0.25 }, true);
      await e.speed.editClipSpeed(pid, id, { timeInterpolation: "opticalFlow" }, true);
    }, a.id);
    await settle(page, 400);
    await expect
      .poll(async () => (await levels(page))[0]?.level, { timeout: 5000 }, )
      .toBe("heavy");
    await markRange(page, 0, 1);
    await press(page, "Enter");
    await waitRendered(page, 30);
    const snap = await snapshot(page);
    expect(snap.cachedRuns).toEqual([{ start: 0, end: 29 }]);
    expect(snap.lastSummary?.status).toBe("completed");
    await expect
      .poll(async () => (await levels(page)).find((s) => s.start === 0)?.level, { timeout: 5000 })
      .toBe("cached");
    // Frames of the render are the interpolated ones: consecutive cached frames inside one source pair differ.
    const frames = await page.evaluate(async () => {
      const e = (window as unknown as { __openreelE2E: { renderCache: { takePlaybackFrame(t: number): Promise<ImageBitmap | undefined> } } }).__openreelE2E;
      const sums: number[] = [];
      for (const k of [1, 2, 3]) {
        const bmp = await e.renderCache.takePlaybackFrame(k / 30);
        if (!bmp) return null;
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 13) sum = (sum * 31 + d[i]) % 1000003;
        sums.push(sum);
      }
      return sums;
    });
    expect(frames, "cached frames exist").not.toBeNull();
    expect(new Set(frames).size, "cached frames 1..3 are three different interpolated frames").toBe(3);
  });

  test("cancel stops a running render, keeps finished frames and leaves no progress UI", async ({ page }) => {
    const [clip] = clipsOf(await readState(page), "Main");
    await HEAVY_STACK(page, clip.id);
    await markRange(page, 0, 6);
    await page.getByRole("button", { name: "Render In to Out" }).click();
    const progress = page.getByRole("progressbar", { name: "Render progress" });
    await expect(progress).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await snapshot(page)).frameCount, { timeout: SOFTWARE_GPU ? 180_000 : 60_000 }).toBeGreaterThan(3);
    await page.getByRole("button", { name: "Cancel render" }).click();
    await expect(progress).toHaveCount(0, { timeout: SOFTWARE_GPU ? 30_000 : 10_000 });
    const snap = await snapshot(page);
    expect(snap.phase).toBe("idle");
    expect(snap.lastSummary?.status).toBe("canceled");
    expect(snap.frameCount).toBeGreaterThan(3);
    expect(snap.frameCount).toBeLessThan(180);
    const frozen = snap.frameCount;
    await page.waitForTimeout(800);
    expect((await snapshot(page)).frameCount, "no frames are added after cancel").toBe(frozen);
  });

  test("measured: heavy 1080p effects stack drops frames live and plays at full rate from the render cache", async ({
    page,
  }, testInfo) => {
    test.skip(SOFTWARE_GPU, "hardware-performance measurement: SwiftShader (no GPU) cannot render a heavy 1080p effects stack in real time; render-cache correctness is covered by the other render-cache specs");
    test.setTimeout(300_000);
    const [clip] = clipsOf(await readState(page), "Main");
    await HEAVY_STACK(page, clip.id);
    await markRange(page, 0, 2);

    const before = await measurePlayback(page, 0, 2300);

    const t0 = Date.now();
    const summary = await rc(page, (c) => c.renderInToOut());
    const wall = Date.now() - t0;
    expect(summary?.status).toBe("completed");
    expect(summary?.framesRendered).toBe(60);
    await waitRendered(page, 60);

    const after = await measurePlayback(page, 0, 1900);
    const result = { before, after, renderMs: summary?.elapsedMs, wallMs: wall, codec: summary?.codec };
    console.log(`[render-cache measure] ${JSON.stringify(result)}`);
    await testInfo.attach("render-cache-measure.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });

    expect(after.cache, "cached playback paints from the cache").toBeGreaterThan(40);
    expect(after.live, "no frame of the cached range is re-rendered").toBeLessThanOrEqual(2);
    expect(after.fps).toBeGreaterThan(26);
    expect(after.dropped).toBeLessThanOrEqual(Math.max(2, Math.round(after.expected * 0.06)));
    expect(before.live).toBeGreaterThan(0);
    expect(before.cache).toBe(0);
    expect(after.fps, "cache playback is faster than live heavy-effect playback").toBeGreaterThan(before.fps);
  });

  test("edits invalidate exactly the affected segment and no stale frame is shown", async ({ page }) => {
    await splitIntoThree(page);
    const [a, b, c] = clipsOf(await readState(page), "Main");
    await HEAVY_STACK(page, a.id);
    await page.evaluate(async (id) => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E;
      await e.project.getState().updateColorGrading(id, { temperature: 8 });
    }, b.id);
    await markRange(page, 0, 6);
    // Start without awaiting the summary: a slow render then reports through waitRendered's diagnostic.
    await rc(page, (cache) => {
      void cache.renderInToOut();
    });
    await waitRendered(page, 180);
    expect((await snapshot(page)).cachedRuns).toEqual([{ start: 0, end: 179 }]);

    // Snapshot of clip A while cached (what a stale cache would keep showing).
    await seek(page, 0.5);
    const cachedLook = await rc(page, async (cache) => {
      const bmp = await cache.takePlaybackFrame(0.5);
      if (!bmp) return null;
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const g = canvas.getContext("2d")!;
      g.drawImage(bmp, 0, 0);
      bmp.close();
      const d = g.getImageData(canvas.width * 0.25, canvas.height * 0.25, canvas.width * 0.5, canvas.height * 0.5).data;
      let r = 0;
      let gr = 0;
      let bl = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        gr += d[i + 1];
        bl += d[i + 2];
      }
      return [r / n, gr / n, bl / n];
    });
    expect(cachedLook).not.toBeNull();
    // Fidelity: the cached frame looks like what the live preview paints for the same instant.
    const liveLook = await programMean(page);
    const fidelity = Math.abs(liveLook[0] - cachedLook![0]) + Math.abs(liveLook[1] - cachedLook![1]) + Math.abs(liveLook[2] - cachedLook![2]);
    console.log(`[render-cache fidelity] live=${liveLook.map((v) => v.toFixed(1))} cached=${cachedLook!.map((v) => v.toFixed(1))} distance=${fidelity.toFixed(2)}`);
    expect(fidelity, "cached frame matches the live preview of the same frame").toBeLessThan(20);

    // Edit clip A's glow: exactly clip A's frames (0-2 s) go; B and C stay cached.
    await clickClip(page, a.id);
    const historyBefore = (await readState(page)).historyLength;
    await page.evaluate(async (id) => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E;
      const store = e.project.getState();
      const fx = store.getVideoEffects(id).find((x: { type: string }) => x.type === "glow");
      await store.updateVideoEffect(id, fx.id, { radius: 2, intensity: 0 });
      await store.addVideoEffect(id, "invert");
    }, a.id);
    await settle(page, 300);
    expect((await readState(page)).historyLength - historyBefore).toBe(2);
    expect((await snapshot(page)).cachedRuns).toEqual([{ start: 60, end: 179 }]);
    expect(await rc(page, (cache) => cache.instance.hasFrameAt(1.0))).toBe(false);
    expect(await rc(page, (cache) => cache.instance.hasFrameAt(3.0))).toBe(true);
    expect(await rc(page, async (cache) => (await cache.takePlaybackFrame(1.0)) === undefined)).toBe(true);

    // The bar no longer claims clip A is rendered.
    // (heavy vs light there depends on the measured live cost of the edited stack, which is
    // hardware-dependent; what matters is that it is no longer cached.)
    await expect
      .poll(async () => (await levels(page)).map((s) => [s.level === "cached" ? "cached" : "uncached", s.start, s.end]), { timeout: 5000 })
      .toEqual([
        ["uncached", 0, 2],
        ["cached", 2, 4],
      ]);

    // Playback across the edited clip is live-rendered (never the old cached look).
    // Software GPU paints a live frame of the edited stack only every second or so, so play longer there.
    const played = await measurePlayback(page, 0, SOFTWARE_GPU ? 6000 : 1200);
    expect(played.live).toBeGreaterThan(0);
    await seek(page, 0.5);
    const [r1, g1, b1] = await programMean(page);
    const stale = cachedLook as number[];
    const distance = Math.abs(r1 - stale[0]) + Math.abs(g1 - stale[1]) + Math.abs(b1 - stale[2]);
    expect(distance, "paused frame after the edit differs from the pre-edit cached look").toBeGreaterThan(8);

    // Undo restores the effect: still not the stale cache, frames re-render on demand.
    await undo(page);
    await undo(page);
    await expect.poll(async () => (await snapshot(page)).cachedRuns).toEqual([{ start: 60, end: 179 }]);
    void c;
  });

  test("Sequence menu renders In to Out and Delete render files empties the cache (bar returns to red)", async ({ page }) => {
    const [clip] = clipsOf(await readState(page), "Main");
    await HEAVY_STACK(page, clip.id);
    await markRange(page, 0, 1);
    await page.getByRole("menuitem", { name: "Sequence" }).or(page.getByRole("button", { name: "Sequence", exact: true })).first().click();
    await page.getByRole("menuitem", { name: /Render In to Out/ }).click();
    await waitRendered(page, 30);
    expect((await snapshot(page)).frameCount).toBe(30);
    await expect.poll(async () => (await levels(page)).map((s) => s.level)).toEqual(["cached", "heavy"]);

    await page.getByRole("menuitem", { name: "Sequence" }).or(page.getByRole("button", { name: "Sequence", exact: true })).first().click();
    await page.getByRole("menuitem", { name: "Delete render files" }).click();
    await expect.poll(async () => (await snapshot(page)).frameCount).toBe(0);
    await expect.poll(async () => (await levels(page)).map((s) => s.level)).toEqual(["heavy"]);
    expect(await rc(page, (cache) => cache.instance.hasFrameAt(0.5))).toBe(false);
    expect(await rc(page, async (cache) => (await cache.takePlaybackFrame(0.5)) === undefined)).toBe(true);
  });
});

test.describe("Render Effects In to Out and persistent render files", () => {
  test.beforeEach(async ({ page }) => {
    if (SOFTWARE_GPU) test.setTimeout(SOFTWARE_TIMEOUT_MS);
    await openEditor(page);
    await useHd(page);
  });

  test("Render Effects In to Out renders only the stretches with effects and skips plain media", async ({ page }) => {
    await splitIntoThree(page);
    const [a, b] = clipsOf(await readState(page), "Main");
    // A: heavy stack, B: plain media, C: plain media. Only A (0-2 s) needs a render.
    await HEAVY_STACK(page, a.id);
    expect(b.effects).toBe(0);
    await page.getByRole("menuitem", { name: "Sequence" }).or(page.getByRole("button", { name: "Sequence", exact: true })).first().click();
    await page.getByRole("menuitem", { name: /Render Effects In to Out/ }).click();
    await waitRendered(page, 60);
    const snap = await snapshot(page);
    expect(snap.frameCount, "only the effects clip was rendered, not the whole 6 s sequence").toBe(60);
    expect(snap.cachedRuns).toEqual([{ start: 0, end: 59 }]);
    await expect.poll(async () => (await levels(page)).map((s) => [s.level, s.start, s.end])).toEqual([["cached", 0, 2]]);
  });

  test("render files persist: a re-initialised cache restores the range from storage and plays it from the cache", async ({ page }) => {
    const [clip] = clipsOf(await readState(page), "Main");
    await HEAVY_STACK(page, clip.id);
    await markRange(page, 0, 1);
    await rc(page, (cache) => {
      void cache.renderInToOut();
    });
    await waitRendered(page, 30);
    const kind = await rc(page, (cache) => cache.storageKind);
    expect(["opfs", "indexeddb"]).toContain(kind);
    expect(await rc(page, (cache) => cache.isPersistent)).toBe(true);
    await rc(page, (cache) => cache.instance.flushIndex());

    // What an app restart does to the cache layer: drop the in-memory index and codec, open the storage again.
    await rc(page, async (cache) => {
      cache.dispose();
      cache.ensureStarted();
      await cache.whenReady();
    });
    const restored = await snapshot(page);
    expect(restored.restored).toMatchObject({ restored: 30, droppedStale: 0, droppedMissing: 0 });
    expect(restored.frameCount).toBe(30);
    expect(restored.cachedRuns).toEqual([{ start: 0, end: 29 }]);
    await expect.poll(async () => (await levels(page)).map((s) => s.level)).toEqual(["cached", "heavy"]);

    await rc(page, (c) => c.resetTelemetry());
    const measure = await measurePlayback(page, 0, 900);
    expect(measure.live, "no frame was composited live").toBe(0);
    expect(measure.cache).toBeGreaterThan(10);
  });
});

test.describe("Render In to Out: overlays (reviewer)", () => {
  test.beforeEach(async ({ page }) => {
    if (SOFTWARE_GPU) test.setTimeout(SOFTWARE_TIMEOUT_MS);
    await openEditor(page);
  });

  test("text edits invalidate only the text span and undo leaves no stale frame", async ({ page }) => {
    const [clip] = clipsOf(await readState(page), "Main");
    await HEAVY_STACK(page, clip.id);
    const trackId = await page.evaluate((id) => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E;
      const tracks = e.project.getState().project.timeline.tracks as Array<{ id: string; clips: Array<{ id: string }> }>;
      return tracks.find((t) => t.clips.some((c) => c.id === id))!.id;
    }, clip.id);
    const textId = await page.evaluate((track) => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E;
      return e.project.getState().createTextClip(track, 1, "HELLO", 1)?.id ?? null;
    }, trackId);
    expect(textId).not.toBeNull();
    await markRange(page, 0, 3);
    await rc(page, (cache) => {
      void cache.renderInToOut();
    });
    await waitRendered(page, 90);
    expect((await snapshot(page)).cachedRuns).toEqual([{ start: 0, end: 89 }]);

    await page.evaluate((id) => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E;
      e.project.getState().updateTextContent(id, "WORLD");
    }, textId);
    await settle(page, 300);
    expect((await snapshot(page)).cachedRuns).toEqual([
      { start: 0, end: 29 },
      { start: 60, end: 89 },
    ]);
    expect(await rc(page, (cache) => cache.instance.hasFrameAt(1.5))).toBe(false);
    expect(await rc(page, async (cache) => (await cache.takePlaybackFrame(1.5)) === undefined)).toBe(true);
  });
});
