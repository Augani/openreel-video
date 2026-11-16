import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import type { Clip } from "../types/timeline";
import { IndexedDbChunkStore, MemoryChunkStore } from "./chunk-store";
import type { FrameCodec } from "./frame-codec";
import { FrameIndex } from "./frame-index";
import { framesInRange } from "./time-ranges";
import { RenderCache, cacheFrameSize } from "./render-cache-engine";
import {
  PlaybackFrameStats,
  buildRenderStatusSegments,
  classifyCost,
} from "./render-status";

class FakeBitmap {
  closed = 0;
  constructor(
    readonly width: number,
    readonly height: number,
    readonly tag: string,
  ) {}
  close(): void {
    this.closed++;
  }
}

class FakeCodec implements FrameCodec {
  readonly id = "fake";
  encodes = 0;
  constructor(
    readonly width: number,
    readonly height: number,
    private readonly bytesPerFrame = 100,
  ) {}
  async encode(image: ImageBitmap): Promise<{ data: ArrayBuffer }> {
    this.encodes++;
    const tag = (image as unknown as FakeBitmap).tag;
    const data = new TextEncoder().encode(tag.padEnd(this.bytesPerFrame, "."));
    return { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer };
  }
  async decodeBatch(frames: readonly { data: ArrayBuffer }[]): Promise<ImageBitmap[]> {
    return frames.map(
      (frame) =>
        new FakeBitmap(this.width, this.height, new TextDecoder().decode(frame.data).replace(/\.+$/, "")) as unknown as ImageBitmap,
    );
  }
  dispose(): void {}
}

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 };

function clip(id: string, start: number, duration: number, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaId: "m1",
    trackId: "v1",
    startTime: start,
    duration,
    inPoint: 0,
    outPoint: duration,
    effects: [],
    audioEffects: [],
    transform,
    volume: 1,
    keyframes: [],
    ...extra,
  };
}

function project(clips: Clip[], settings: Partial<Project["settings"]> = {}): Project {
  return {
    id: "p",
    name: "p",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 10, sampleRate: 48000, channels: 2, ...settings },
    mediaLibrary: {
      items: [
        {
          id: "m1",
          name: "m1",
          type: "video",
          fileHandle: null,
          blob: null,
          metadata: { duration: 60, width: 640, height: 360, frameRate: 10, codec: "h264", sampleRate: 0, channels: 0, fileSize: 1 },
          thumbnailUrl: null,
          waveformData: null,
        },
      ],
    },
    timeline: {
      tracks: [
        { id: "v1", type: "video", name: "v1", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false },
      ],
      subtitles: [],
      markers: [],
      duration: Math.max(...clips.map((c) => c.startTime + c.duration), 0),
    },
  };
}

function makeCache(maxBytes = 1_000_000, bytesPerFrame = 100) {
  const store = new MemoryChunkStore();
  const rendered: number[] = [];
  const codec = new FakeCodec(640, 360, bytesPerFrame);
  const cache = new RenderCache(
    {
      store,
      createCodec: async () => codec,
      renderFrame: async (p, time, w, h) => {
        rendered.push(Math.round(time * p.settings.frameRate));
        const opacity = p.timeline.tracks[0].clips[0]?.transform.opacity;
        return new FakeBitmap(w, h, `t${time.toFixed(2)}-o${opacity}`) as unknown as ImageBitmap;
      },
      yieldToUi: async () => undefined,
    },
    { maxBytes },
  );
  return { cache, store, rendered, codec };
}

describe("RenderCache", () => {
  it("renders the requested range into the cache and reports progress", async () => {
    const { cache, rendered } = makeCache();
    cache.setProject(project([clip("a", 0, 4)]));
    const progress: number[] = [];
    const summary = await cache.renderRange({ start: 1, end: 2 }, { onProgress: (p) => progress.push(p.done) });
    expect(summary.status).toBe("completed");
    expect(rendered).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(progress.at(-1)).toBe(10);
    expect(cache.getSnapshot().cachedRuns).toEqual([{ start: 10, end: 19 }]);
    expect(cache.hasFrameAt(1.5)).toBe(true);
    expect(cache.hasFrameAt(2.5)).toBe(false);
  });

  it("skips frames that are already cached when rendering an overlapping range", async () => {
    const { cache, rendered } = makeCache();
    cache.setProject(project([clip("a", 0, 4)]));
    await cache.renderRange({ start: 0, end: 1 });
    rendered.length = 0;
    const summary = await cache.renderRange({ start: 0.5, end: 1.5 });
    expect(rendered).toEqual([10, 11, 12, 13, 14]);
    expect(summary.framesSkipped).toBe(5);
    expect(cache.getSnapshot().cachedRuns).toEqual([{ start: 0, end: 14 }]);
  });

  it("can be canceled mid-render and keeps the frames already finished", async () => {
    const { cache } = makeCache();
    cache.setProject(project([clip("a", 0, 4)]));
    const controller = new AbortController();
    const summary = await cache.renderRange(
      { start: 0, end: 3 },
      { signal: controller.signal, onProgress: (p) => p.done === 5 && controller.abort() },
    );
    expect(summary.status).toBe("canceled");
    expect(cache.getSnapshot().frameCount).toBe(5);
    expect(cache.isRendering()).toBe(false);
  });

  it("invalidates exactly the frames of an edited clip and nothing else", async () => {
    const { cache } = makeCache();
    const base = project([clip("a", 0, 2), clip("b", 2, 2)]);
    cache.setProject(base);
    await cache.renderRange({ start: 0, end: 4 });
    expect(cache.getSnapshot().frameCount).toBe(40);

    const edited = project([clip("a", 0, 2), clip("b", 2, 2, { effects: [{ id: "x", type: "glow", params: { radius: 9 }, enabled: true }] })]);
    cache.setProject(edited);
    const runs = cache.getSnapshot().cachedRuns;
    expect(runs).toEqual([{ start: 0, end: 19 }]);
    expect(cache.hasFrameAt(1.9)).toBe(true);
    expect(cache.hasFrameAt(2.0)).toBe(false);
  });

  it("moving a clip drops the old and new spans", async () => {
    const { cache } = makeCache();
    cache.setProject(project([clip("a", 0, 2), clip("b", 3, 1)]));
    await cache.renderRange({ start: 0, end: 5 });
    cache.setProject(project([clip("a", 0, 2), clip("b", 4, 1)]));
    expect(cache.getSnapshot().cachedRuns).toEqual([{ start: 0, end: 29 }]);
  });

  it("detects edits the editor applies by mutating project objects in place", async () => {
    const { cache } = makeCache();
    const live = project([clip("a", 0, 2), clip("b", 2, 2)]);
    cache.setProject(live);
    await cache.renderRange({ start: 0, end: 4 });
    const clipB = live.timeline.tracks[0].clips[1] as { effects: Clip["effects"] };
    clipB.effects = [{ id: "x", type: "glow", params: { radius: 9 }, enabled: true }];
    cache.setProject({ ...live });
    expect(cache.getSnapshot().cachedRuns).toEqual([{ start: 0, end: 19 }]);
    (live.timeline.tracks[0].clips[0] as { effects: Clip["effects"] }).effects = [
      { id: "y", type: "blur", params: { radius: 3 }, enabled: true },
    ];
    cache.setProject({ ...live });
    expect(cache.getSnapshot().frameCount).toBe(0);
  });

  it("an audio-only edit keeps every cached frame", async () => {
    const { cache } = makeCache();
    cache.setProject(project([clip("a", 0, 2)]));
    await cache.renderRange({ start: 0, end: 2 });
    cache.setProject(project([clip("a", 0, 2, { volume: 0.2 })]));
    expect(cache.getSnapshot().frameCount).toBe(20);
  });

  it("changing the frame rate or canvas size clears everything", async () => {
    const { cache } = makeCache();
    cache.setProject(project([clip("a", 0, 2)]));
    await cache.renderRange({ start: 0, end: 2 });
    cache.setProject(project([clip("a", 0, 2)], { width: 1280, height: 720 }));
    expect(cache.getSnapshot().frameCount).toBe(0);
  });

  it("never stores a frame whose range was edited while it was rendering", async () => {
    const store = new MemoryChunkStore();
    const codec = new FakeCodec(640, 360);
    let cache!: RenderCache;
    let editedOnce = false;
    cache = new RenderCache({
      store,
      createCodec: async () => codec,
      renderFrame: async (p, time, w, h) => {
        const frame = Math.round(time * 10);
        const opacity = p.timeline.tracks[0].clips[0].transform.opacity;
        if (frame === 3 && !editedOnce) {
          editedOnce = true;
          cache.setProject(project([clip("a", 0, 2, { transform: { ...transform, opacity: 0.25 } })]));
        }
        return new FakeBitmap(w, h, `f${frame}-o${opacity}`) as unknown as ImageBitmap;
      },
      yieldToUi: async () => undefined,
    });
    cache.setProject(project([clip("a", 0, 2)]));
    const summary = await cache.renderRange({ start: 0, end: 1 });
    expect(summary.status).toBe("completed");
    for (let f = 0; f < 10; f++) {
      const bitmap = await cache.takeFrame(f / 10);
      if (f < 3) {
        expect(bitmap, `frame ${f} was invalidated by the edit`).toBeUndefined();
        continue;
      }
      expect(bitmap, `frame ${f}`).toBeDefined();
      const tag = (bitmap as unknown as FakeBitmap).tag;
      expect(tag.endsWith("o0.25"), `frame ${f} rendered from stale project: ${tag}`).toBe(true);
    }
  });

  it("takeFrame returns decoded frames and undefined for uncached or invalidated ones", async () => {
    const { cache } = makeCache();
    cache.setProject(project([clip("a", 0, 2)]));
    await cache.renderRange({ start: 0, end: 1 });
    const bitmap = await cache.takeFrame(0.3);
    expect((bitmap as unknown as FakeBitmap).tag).toContain("t0.30");
    expect(await cache.takeFrame(1.5)).toBeUndefined();
    cache.setProject(project([clip("a", 0, 2, { transform: { ...transform, opacity: 0.5 } })]));
    expect(await cache.takeFrame(0.3)).toBeUndefined();
  });

  it("prefetched decodes are closed when their frames are invalidated", async () => {
    const { cache } = makeCache();
    cache.setProject(project([clip("a", 0, 2)]));
    await cache.renderRange({ start: 0, end: 1 });
    cache.warm(0);
    await new Promise((r) => setTimeout(r, 5));
    cache.setProject(project([clip("a", 0, 2, { transform: { ...transform, opacity: 0.5 } })]));
    expect(await cache.takeFrame(0.2)).toBeUndefined();
  });

  it("evicts least recently used frames to stay inside the byte budget", async () => {
    const { cache, store } = makeCache(1000, 100);
    cache.setProject(project([clip("a", 0, 5)]));
    const a = await cache.renderRange({ start: 0, end: 0.8 });
    expect(a.status).toBe("completed");
    expect(cache.getSnapshot().bytes).toBe(800);
    await cache.takeFrame(0.0);
    const b = await cache.renderRange({ start: 2, end: 2.5 });
    expect(b.status).toBe("completed");
    const snap = cache.getSnapshot();
    expect(snap.bytes).toBeLessThanOrEqual(1000);
    expect(snap.frameCount).toBe(10);
    expect(cache.hasFrameAt(0)).toBe(true);
    expect((await store.size?.()) ?? 0).toBeLessThanOrEqual(1000);
  });

  it("fails with a clear message instead of evicting its own output", async () => {
    const { cache } = makeCache(500, 100);
    cache.setProject(project([clip("a", 0, 5)]));
    const summary = await cache.renderRange({ start: 0, end: 2 });
    expect(summary.status).toBe("failed");
    expect(summary.message).toMatch(/cache is full/i);
    expect(cache.getSnapshot().frameCount).toBe(5);
  });

  it("namespaces stored keys so tabs sharing a store do not delete each other's frames", async () => {
    const store = new MemoryChunkStore();
    const mk = (prefix: string) =>
      new RenderCache(
        {
          store,
          createCodec: async () => new FakeCodec(640, 360),
          renderFrame: async (_p, time, w, h) => new FakeBitmap(w, h, `t${time}`) as unknown as ImageBitmap,
          yieldToUi: async () => undefined,
        },
        { keyPrefix: prefix },
      );
    const a = mk("A:");
    const b = mk("B:");
    a.setProject(project([clip("a", 0, 1)]));
    b.setProject(project([clip("a", 0, 1)]));
    await a.renderRange({ start: 0, end: 1 });
    await b.renderRange({ start: 0, end: 1 });
    expect(store.keys.filter((k) => k.startsWith("A:")).length).toBe(10);
    await a.deleteAll();
    expect(store.keys.filter((k) => k.startsWith("A:")).length).toBe(0);
    expect(store.keys.filter((k) => k.startsWith("B:")).length).toBe(10);
    expect(await b.takeFrame(0.3)).toBeDefined();
  });

  it("deleteAll removes every frame and the stored bytes", async () => {
    const { cache, store } = makeCache();
    cache.setProject(project([clip("a", 0, 2)]));
    await cache.renderRange({ start: 0, end: 2 });
    expect(await cache.deleteAll()).toBe(20);
    expect(cache.getSnapshot().frameCount).toBe(0);
    expect(await store.size?.()).toBe(0);
    expect(await cache.takeFrame(0.5)).toBeUndefined();
  });

  it("deleteAll while rendering cancels the render first", async () => {
    const { cache } = makeCache();
    cache.setProject(project([clip("a", 0, 5)]));
    const running = cache.renderRange({ start: 0, end: 5 });
    await cache.deleteAll();
    const summary = await running;
    expect(summary.status).toBe("canceled");
    expect(cache.getSnapshot().frameCount).toBe(0);
  });

  it("notifies subscribers with a new snapshot on change", async () => {
    const { cache } = makeCache();
    let calls = 0;
    cache.subscribe(() => calls++);
    const before = cache.getSnapshot();
    cache.setProject(project([clip("a", 0, 1)]));
    await cache.renderRange({ start: 0, end: 1 });
    expect(calls).toBeGreaterThan(0);
    expect(cache.getSnapshot()).not.toBe(before);
  });
});

describe("cacheFrameSize", () => {
  it("caps width at 1920 and keeps even dimensions", () => {
    expect(cacheFrameSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(cacheFrameSize(1280, 720)).toEqual({ width: 1280, height: 720 });
    expect(cacheFrameSize(641, 361)).toEqual({ width: 642, height: 362 });
  });
});

describe("framesInRange", () => {
  it("uses the renderer's exact activity test, including float-noisy clip edges", () => {
    const fps = 30;
    const start = 0.1 + 0.2;
    const span = framesInRange({ start, end: start + 1 }, fps)!;
    for (let f = span.start - 2; f <= span.end + 2; f++) {
      const t = f / fps;
      expect(f >= span.start && f <= span.end).toBe(t >= start && t < start + 1);
    }
    expect(framesInRange({ start: 1, end: 2 }, 10)).toEqual({ start: 10, end: 19 });
    expect(framesInRange({ start: 1.01, end: 1.05 }, 10)).toBeNull();
  });
});

describe("FrameIndex", () => {
  it("merges runs, evicts LRU and respects protection", () => {
    const index = new FrameIndex(300, 10);
    for (const f of [1, 2, 3]) expect(index.put(f, 100).stored).toBe(true);
    index.touch(1);
    const r = index.put(10, 100);
    expect(r.evicted).toEqual([2]);
    expect(index.cachedRuns()).toEqual([{ start: 1, end: 1 }, { start: 3, end: 3 }, { start: 10, end: 10 }]);
    const refused = index.put(11, 100, () => true);
    expect(refused.stored).toBe(false);
    expect(index.bytes).toBe(300);
  });

  it("invalidates by time range", () => {
    const index = new FrameIndex(1e6, 10);
    for (let f = 0; f < 30; f++) index.put(f, 1);
    const removed = index.invalidateRanges([{ start: 1, end: 2 }]);
    expect(removed.length).toBe(10);
    expect(index.has(9)).toBe(true);
    expect(index.has(10)).toBe(false);
    expect(index.has(19)).toBe(false);
    expect(index.has(20)).toBe(true);
  });
});

describe("IndexedDbChunkStore", () => {
  it("round-trips, deletes and clears", async () => {
    const store = new IndexedDbChunkStore(`t-${Math.random()}`);
    const data = new Uint8Array([1, 2, 3]).buffer;
    await store.put("a", data);
    await store.put("b", data);
    expect(new Uint8Array((await store.get("a"))!)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store.size()).toBe(6);
    await store.delete(["a"]);
    expect(await store.get("a")).toBeUndefined();
    await store.put("keep:1", data);
    await store.put("drop:1", data);
    expect(await store.purge((key) => key.startsWith("keep:"))).toBe(2);
    expect(await store.get("keep:1")).toBeDefined();
    expect(await store.get("b")).toBeUndefined();
    await store.clear();
    expect(await store.get("keep:1")).toBeUndefined();
    store.close();
  });
});

describe("render status", () => {
  const heavy = (id: string, start: number, d: number): Clip =>
    clip(id, start, d, {
      effects: [
        { id: "1", type: "glow", params: { radius: 30 }, enabled: true },
        { id: "2", type: "gaussian-blur", params: { radius: 20 }, enabled: true },
      ],
      colorGrading: { lut: { data: [0], size: 1, intensity: 1 }, temperature: 5 },
    });
  const fps30 = { frameRate: 30, width: 1920, height: 1080 };

  it("plain media has no status", () => {
    const segments = buildRenderStatusSegments(project([clip("a", 0, 4)], fps30), { cachedRuns: [] });
    expect(segments.map((s) => s.level)).toEqual(["none"]);
  });

  it("a single cheap grade is yellow and a glow+blur+LUT stack is red", () => {
    const light = project([clip("a", 0, 2, { colorGrading: { temperature: 10 } }), heavy("b", 2, 2)], fps30);
    const segments = buildRenderStatusSegments(light, { cachedRuns: [] });
    expect(segments.map((s) => [s.start, s.end, s.level])).toEqual([[0, 2, "light"], [2, 4, "heavy"]]);
    expect(segments[1].reasons).toEqual(expect.arrayContaining(["glow", "gaussian-blur", "LUT"]));
  });

  it("fully cached stretches turn green and partially cached ones split", () => {
    const p = project([heavy("a", 0, 4)], fps30);
    const green = buildRenderStatusSegments(p, { cachedRuns: [{ start: 0, end: 59 }] });
    expect(green.map((s) => [s.start, s.end, s.level])).toEqual([[0, 2, "cached"], [2, 4, "heavy"]]);
    const all = buildRenderStatusSegments(p, { cachedRuns: [{ start: 0, end: 119 }] });
    expect(all.map((s) => s.level)).toEqual(["cached"]);
  });

  it("measured frame cost overrides the estimate", () => {
    const p = project([heavy("a", 0, 2)], fps30);
    const fast = buildRenderStatusSegments(p, { cachedRuns: [], measuredMs: () => 12 });
    expect(fast[0].level).toBe("light");
    const slow = buildRenderStatusSegments(project([clip("a", 0, 2, { colorGrading: { temperature: 5 } })], fps30), {
      cachedRuns: [],
      measuredMs: () => 80,
    });
    expect(slow[0].level).toBe("heavy");
    expect(classifyCost(5, undefined, 30)).toBe("light");
  });

  it("an edit that removes the effects drops the status back to none", () => {
    const withFx = buildRenderStatusSegments(project([heavy("a", 0, 2)], fps30), { cachedRuns: [] });
    const without = buildRenderStatusSegments(project([clip("a", 0, 2)], fps30), { cachedRuns: [] });
    expect(withFx[0].level).toBe("heavy");
    expect(without[0].level).toBe("none");
  });

  it("PlaybackFrameStats averages per bucket and forgets edited ranges", () => {
    const stats = new PlaybackFrameStats(0.5, 3);
    for (let i = 0; i < 5; i++) stats.record(1.1, 40);
    expect(stats.mean({ start: 1, end: 1.5 })).toBeCloseTo(40, 0);
    expect(stats.mean({ start: 3, end: 4 })).toBeUndefined();
    stats.invalidate([{ start: 1, end: 1.2 }]);
    expect(stats.mean({ start: 1, end: 1.5 })).toBeUndefined();
  });
});

describe("RenderCache decoded-frame retention", () => {
  it("does not keep prefetched bitmaps from earlier playback positions alive", async () => {
    const { cache } = makeCache();
    cache.setProject(project([clip("a", 0, 10)]));
    await cache.renderRange({ start: 0, end: 10 });
    const retained = () => (cache as unknown as { decoded: Map<number, unknown> }).decoded.size;
    for (const start of [0, 40, 80, 20, 60, 5, 95]) {
      const bitmap = await cache.takeFrame(start / 10);
      (bitmap as unknown as { close(): void } | undefined)?.close();
    }
    // Only the look-ahead window after the last position may stay decoded.
    expect(retained()).toBeLessThanOrEqual(16);
  });
});
