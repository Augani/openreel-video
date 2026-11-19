import { describe, expect, it, vi } from "vitest";
import {
  EffectPreviewEngine,
  previewDefKey,
  type EffectRenderer,
  type PreviewEffectDef,
  type PreviewWindow,
  type WindowLoader,
} from "./preview-engine";
import type { PreviewSource } from "./source-selection";

const bitmap = (width = 8, height = 4) =>
  ({ width, height, close: vi.fn() }) as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };

const defs: PreviewEffectDef[] = Array.from({ length: 10 }, (_, i) => ({ id: `fx${i}`, type: "grayscale" }));

const source = (clipId: string, poster = 0): PreviewSource => ({
  clipId,
  mediaId: `media-${clipId}`,
  mediaType: "video",
  origin: "playhead",
  posterSourceTime: poster,
  windowStart: poster,
  windowSeconds: 2,
});

function fakeWindow(frames = 24): PreviewWindow & { frameBitmaps: ImageBitmap[]; disposed: boolean } {
  const frameBitmaps = Array.from({ length: frames }, () => bitmap());
  const incoming = bitmap();
  const w = {
    key: "w",
    origin: "footage" as const,
    fps: 12,
    times: frameBitmaps.map((_, i) => i / 12),
    count: frames,
    width: 8,
    height: 4,
    posterIndex: 0,
    animated: frames > 1,
    frameBitmaps,
    disposed: false,
    frame: (index: number) => Promise.resolve(frameBitmaps[index] ?? null),
    partnerAsked: [] as number[],
    partner: (index = 0) => {
      w.partnerAsked.push(index);
      return Promise.resolve(incoming);
    },
    dispose() {
      w.disposed = true;
    },
  };
  return w;
}

function setup(options: { concurrency?: number; cacheBytes?: number; hoverShare?: number; delay?: boolean } = {}) {
  const windows: ReturnType<typeof fakeWindow>[] = [];
  const loader: WindowLoader = {
    load: vi.fn(async () => {
      const w = fakeWindow();
      windows.push(w);
      return w;
    }),
  };
  let live = 0;
  let peak = 0;
  const gates: Array<() => void> = [];
  const rendered: Array<{ def: string; slot: number; progress: number; partner: ImageBitmap | null; frame: ImageBitmap; poster?: boolean }> = [];
  const renderer: EffectRenderer = {
    render: vi.fn(async (slot, def, input) => {
      live++;
      peak = Math.max(peak, live);
      rendered.push({ def: def.id ?? def.type, slot, progress: input.progress, partner: input.partner, frame: input.frame, poster: input.poster });
      if (options.delay) await new Promise<void>((resolve) => gates.push(resolve));
      live--;
      return bitmap();
    }),
    dispose: vi.fn(),
  };
  const engine = new EffectPreviewEngine({
    loader,
    renderer,
    concurrency: options.concurrency,
    cacheBytes: options.cacheBytes,
    hoverShare: options.hoverShare,
    beforeStart: async () => undefined,
  });
  return { engine, loader, renderer, windows, rendered, gates, peak: () => peak };
}

describe("EffectPreviewEngine", () => {
  it("decodes the window once and shares it across all cards", async () => {
    const { engine, loader } = setup();
    await Promise.all(defs.map((def) => engine.renderPoster(def)));
    expect(loader.load).toHaveBeenCalledTimes(1);
    expect(engine.stats.windowsLoaded).toBe(1);
    expect(engine.stats.rendersStarted).toBe(10);
  });

  it("renders each (effect, source window, frame) once and serves repeats from the LRU", async () => {
    const { engine, renderer } = setup();
    const a = await engine.renderPoster(defs[0]);
    const b = await engine.renderPoster(defs[0]);
    expect(b).toBe(a);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(engine.stats.cacheHits).toBe(1);
    expect(engine.peek(defs[0], 0)).toBe(a);
  });

  it("hands Echo cards the earlier window frames, and Posterize Time cards the held frame", async () => {
    const { engine, renderer, windows } = setup();
    await engine.getWindow();
    const frames = windows[0].frameBitmaps;
    const echo: PreviewEffectDef = { id: "pro-echo", type: "echo" };
    await engine.render(echo, 9, "hover");
    const echoInput = vi.mocked(renderer.render).mock.calls.at(-1)?.[2];
    expect(echoInput?.frame).toBe(frames[9]);
    expect(echoInput?.trail?.map((entry) => entry.frame)).toEqual([frames[7], frames[5]]);
    expect(echoInput?.trail?.map((entry) => entry.weight)).toEqual([0.5, 0.25]);
    expect(echoInput?.temporal?.echo?.operator).toBe("add");

    const poster = await engine.renderPoster(echo);
    expect(poster).not.toBeNull();
    const posterInput = vi.mocked(renderer.render).mock.calls.at(-1)?.[2];
    expect(posterInput?.frame).toBe(frames[4]);
    expect(posterInput?.trail).toHaveLength(2);

    await engine.render({ id: "pro-posterize-time", type: "posterize-time" }, 4, "hover");
    const heldInput = vi.mocked(renderer.render).mock.calls.at(-1)?.[2];
    expect(heldInput?.frame).toBe(frames[3]);
    expect(heldInput?.trail).toBeUndefined();

    // Every other card keeps rendering the frame it is asked for
    await engine.render(defs[0], 4, "hover");
    expect(vi.mocked(renderer.render).mock.calls.at(-1)?.[2].frame).toBe(frames[4]);
  });

  it("coalesces concurrent requests for the same frame", async () => {
    const { engine, renderer } = setup();
    const [a, b] = await Promise.all([engine.renderPoster(defs[1]), engine.renderPoster(defs[1])]);
    expect(a).toBe(b);
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  async function drain(ctx: ReturnType<typeof setup>, pending: Array<Promise<unknown>>) {
    let done = false;
    void Promise.all(pending).then(() => {
      done = true;
    });
    while (!done) {
      ctx.gates.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  it("limits concurrent hover renders to the lane count (and gives each lane its own slot)", async () => {
    const ctx = setup({ concurrency: 2, delay: true });
    const pending = Array.from({ length: 10 }, (_, i) => ctx.engine.render(defs[0], i, "hover"));
    await vi.waitFor(() => expect(ctx.gates.length).toBe(2));
    expect(ctx.peak()).toBe(2);
    expect(new Set(ctx.rendered.map((r) => r.slot)).size).toBe(2);
    await drain(ctx, pending);
    expect(ctx.peak()).toBe(2);
    expect(ctx.engine.peakConcurrency).toBe(2);
  });

  it("runs background poster renders one at a time so the main thread gets a gap after each", async () => {
    const ctx = setup({ concurrency: 2, delay: true });
    const pending = defs.map((def) => ctx.engine.renderPoster(def));
    await vi.waitFor(() => expect(ctx.gates.length).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ctx.peak()).toBe(1);
    await drain(ctx, pending);
    expect(ctx.peak()).toBe(1);
  });

  it("holds new renders while the playhead is scrubbed and resumes on release", async () => {
    const { engine, renderer } = setup();
    await engine.getWindow();
    engine.hold();
    expect(engine.held).toBe(true);
    const poster = engine.renderPoster(defs[0]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(renderer.render).not.toHaveBeenCalled();
    engine.release();
    expect(engine.held).toBe(false);
    expect(await poster).not.toBeNull();
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it("keeps card posters when one card plays: hover frames live in their own budget", async () => {
    // Poster budget 2 frames, hover budget 3 frames.
    const frameBytes = 8 * 4 * 4;
    const { engine } = setup({ cacheBytes: frameBytes * 5, hoverShare: 3 / 5 });
    const first = await engine.renderPoster(defs[0]);
    const second = await engine.renderPoster(defs[1]);
    for (let i = 1; i < 24; i++) await engine.render(defs[2], i, "hover");
    expect(engine.peekPoster(defs[0])).toBe(first);
    expect(engine.peekPoster(defs[1])).toBe(second);
    expect(engine.cachedPosters).toBe(2);
    expect(engine.cachedBytes).toBeLessThanOrEqual(frameBytes * 5);
    // Posters still evict each other (bounded).
    await engine.renderPoster(defs[3]);
    expect(engine.cachedPosters).toBe(2);
    expect(engine.peekPoster(defs[0])).toBeNull();
  });

  it("tells the renderer whether a render is the poster or a hover frame (looping cards pick their poster instants by it)", async () => {
    const ctx = setup();
    const def: PreviewEffectDef = { kind: "emphasis", id: "pulse", type: "emphasis", loop: { frames: 20, seconds: 2.4, posterProgress: 0.2 } };
    await ctx.engine.renderPoster(def);
    await ctx.engine.render(def, 7, "hover");
    expect(ctx.rendered.map((r) => r.poster)).toEqual([true, false]);
    expect(ctx.rendered[0].progress).toBeCloseTo(0.2);
  });

  it("renders a transition card between the footage and its incoming shot", async () => {
    const ctx = setup();
    const tdef: PreviewEffectDef = { kind: "transition", id: "wipe-left", type: "wipe", params: { direction: "left" } };
    const poster = await ctx.engine.renderPoster(tdef);
    expect(poster).not.toBeNull();
    const [r] = ctx.rendered;
    expect(r.progress).toBe(0.5);
    expect(r.partner).not.toBeNull();
    expect(r.partner).not.toBe(r.frame);
    // Hover frames sweep the blend from start to end, holding at both ends.
    for (const i of [0, 12, 23]) await ctx.engine.render(tdef, i, "hover");
    const progress = ctx.rendered.slice(1).map((x) => x.progress);
    expect(progress[0]).toBe(0);
    expect(progress[1]).toBeGreaterThan(0.3);
    expect(progress[1]).toBeLessThan(0.7);
    expect(progress[2]).toBe(1);
    // An effect with the same id as a transition does not share its cache entries.
    const effect: PreviewEffectDef = { id: "wipe-left", type: "grayscale" };
    expect(ctx.engine.peekPoster(effect)).toBeNull();
    expect(ctx.engine.peekPoster(tdef)).toBe(poster);
  });

  it("asks for the incoming frame that matches the hover frame (the poster uses the first)", async () => {
    const ctx = setup();
    const tdef: PreviewEffectDef = { kind: "transition", id: "wipe-left", type: "wipe", params: { direction: "left" } };
    await ctx.engine.renderPoster(tdef);
    for (const i of [5, 17]) await ctx.engine.render(tdef, i, "hover");
    const window = (await ctx.engine.getWindow()) as unknown as { partnerAsked: number[] };
    expect(window.partnerAsked).toEqual([0, 5, 17]);
  });

  it("keeps rendered-frame memory under the cache budget", async () => {
    const budget = 8 * 4 * 4 * 5; // five 8x4 frames
    const { engine } = setup({ cacheBytes: budget, hoverShare: 1 });
    const window = await engine.getWindow();
    expect(window).not.toBeNull();
    for (let i = 0; i < 24; i++) await engine.render(defs[0], i, "hover");
    expect(engine.cachedBytes).toBeLessThanOrEqual(budget);
    expect(engine.cachedFrames).toBe(5);
    // The oldest were evicted and closed.
    expect(engine.peek(defs[0], 0)).toBeNull();
    expect(engine.peek(defs[0], 23)).not.toBeNull();
  });

  it("is a no-op for the same clip within half a second, and invalidates for a different clip", async () => {
    const { engine, loader, windows } = setup();
    engine.setSource(source("a", 1));
    await engine.renderPoster(defs[0]);
    const version = engine.version;
    engine.setSource(source("a", 1.3)); // same clip, small move
    expect(engine.version).toBe(version);
    expect(loader.load).toHaveBeenCalledTimes(1);

    engine.setSource(source("b", 1)); // different clip
    expect(engine.version).toBe(version + 1);
    expect(windows[0].disposed, "old window released").toBe(true);
    expect(engine.cachedFrames, "cache cleared").toBe(0);
    await engine.renderPoster(defs[0]);
    expect(loader.load).toHaveBeenCalledTimes(2);

    engine.setSource(source("b", 5)); // same clip, far away
    expect(engine.version).toBe(version + 2);
  });

  it("closes evicted and invalidated bitmaps", async () => {
    const { engine } = setup();
    const first = (await engine.renderPoster(defs[0])) as ImageBitmap & { close: ReturnType<typeof vi.fn> };
    engine.setSource(source("z", 0));
    expect(first.close).toHaveBeenCalled();
  });

  it("drops a render that finishes after the source changed", async () => {
    const ctx = setup({ delay: true });
    ctx.engine.setSource(source("a", 0));
    const stale = ctx.engine.renderPoster(defs[0]);
    await vi.waitFor(() => expect(ctx.gates.length).toBe(1));
    ctx.engine.setSource(source("b", 0));
    ctx.gates.shift()?.();
    expect(await stale).toBeNull();
    expect(ctx.engine.cachedFrames).toBe(0);
  });

  it("does not start queued work for an aborted request and stops everything on dispose", async () => {
    const ctx = setup({ concurrency: 1, delay: true });
    const abort = new AbortController();
    const first = ctx.engine.renderPoster(defs[0]);
    await vi.waitFor(() => expect(ctx.gates.length).toBe(1));
    const queued = ctx.engine.renderPoster(defs[1], abort.signal);
    const other = ctx.engine.renderPoster(defs[2]);
    abort.abort();
    expect(await queued).toBeNull();
    ctx.engine.dispose();
    ctx.gates.shift()?.();
    expect(await other).toBeNull();
    await first;
    expect(ctx.renderer.render).toHaveBeenCalledTimes(1);
    expect(ctx.renderer.dispose).toHaveBeenCalled();
    expect(await ctx.engine.renderPoster(defs[3])).toBeNull();
  });

  it("hover frames jump ahead of queued posters", async () => {
    const ctx = setup({ concurrency: 1, delay: true });
    const blocker = ctx.engine.renderPoster(defs[0]);
    await vi.waitFor(() => expect(ctx.gates.length).toBe(1));
    const posters = [1, 2, 3].map((i) => ctx.engine.renderPoster(defs[i]));
    const hover = ctx.engine.render(defs[9], 3, "hover");
    ctx.gates.shift()?.();
    await vi.waitFor(() => expect(ctx.gates.length).toBe(1));
    expect(ctx.rendered[1].def).toBe("fx9");
    // Drain.
    for (let i = 0; i < 5; i++) {
      ctx.gates.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all([blocker, hover, ...posters]);
  });

  it("falls back to the implicit sample scene when the first source is null (no retarget)", async () => {
    const { engine, loader } = setup();
    engine.setSource(null);
    expect(engine.version).toBe(0);
    await engine.renderPoster(defs[0]);
    expect(loader.load).toHaveBeenCalledWith(null, expect.any(AbortSignal));
  });
});

describe("look cards", () => {
  it("keys a look apart from an effect or transition with the same id, and per look id", () => {
    const base = { id: "x", type: "grayscale" };
    const keys = new Set([
      previewDefKey(base),
      previewDefKey({ ...base, kind: "transition" }),
      previewDefKey({ ...base, kind: "look" }),
      previewDefKey({ id: "y", type: "grayscale", kind: "look" }),
    ]);
    expect(keys.size).toBe(4);
  });
});
