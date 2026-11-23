import { describe, expect, it } from "vitest";
import type { MediaItem, Project } from "../types/project";
import type { Clip, Track, Transition } from "../types/timeline";
import { MemoryChunkStore } from "./chunk-store";
import type { FrameCodec } from "./frame-codec";
import { buildPixelModel } from "./pixel-entities";
import { createChunkIndexStore, parseIndex, serializeIndex } from "./persistent-index";
import { RenderCache } from "./render-cache-engine";
import { createSegmentHasher, hashString } from "./segment-hash";

class FakeBitmap {
  constructor(readonly width: number, readonly height: number, readonly tag: string) {}
  close(): void {}
}

class FakeCodec implements FrameCodec {
  constructor(
    readonly id: string,
    readonly width: number,
    readonly height: number,
    private readonly bytesPerFrame = 100,
  ) {}
  async encode(image: ImageBitmap): Promise<{ data: ArrayBuffer }> {
    const data = new TextEncoder().encode((image as unknown as FakeBitmap).tag.padEnd(this.bytesPerFrame, "."));
    return { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer };
  }
  async decodeBatch(frames: readonly { data: ArrayBuffer }[]): Promise<ImageBitmap[]> {
    return frames.map(
      (f) => new FakeBitmap(this.width, this.height, new TextDecoder().decode(f.data).replace(/\.+$/, "")) as unknown as ImageBitmap,
    );
  }
  dispose(): void {}
}

const FPS = 10;
const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 };

function media(id: string, size = 1): MediaItem {
  return {
    id,
    name: id,
    type: "video",
    fileHandle: null,
    blob: new Blob([new Uint8Array(size)]),
    metadata: { duration: 60, width: 640, height: 360, frameRate: FPS, codec: "h264", sampleRate: 0, channels: 0, fileSize: size },
    thumbnailUrl: null,
    waveformData: null,
  };
}

function clip(id: string, trackId: string, mediaId: string, start: number, duration: number, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaId,
    trackId,
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

function track(id: string, clips: Clip[], extra: Partial<Track> = {}): Track {
  return { id, type: "video", name: id, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra };
}

function base(): Project {
  return {
    id: "proj-1",
    name: "t",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: FPS, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media("m1"), media("m2")] },
    timeline: {
      tracks: [
        track("v1", [clip("c1", "v1", "m1", 0, 4), clip("c2", "v1", "m2", 4, 4), clip("c3", "v1", "m1", 10, 2)]),
        track("v2", [clip("o1", "v2", "m2", 2, 3)]),
      ],
      subtitles: [],
      markers: [],
      duration: 12,
    },
  };
}

const withTracks = (p: Project, tracks: Track[]): Project => ({ ...p, timeline: { ...p.timeline, tracks } });
const mapClip = (p: Project, id: string, fn: (c: Clip) => Clip): Project =>
  withTracks(p, p.timeline.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === id ? fn(c) : c)) })));
const fxGlow = (radius: number) => [{ id: "fx", type: "glow", params: { radius }, enabled: true }];

const TOTAL_FRAMES = 140;
function changedSpans(a: Project, b: Project): Array<[number, number]> {
  const ha = createSegmentHasher(buildPixelModel(a, { stableMedia: true }), FPS);
  const hb = createSegmentHasher(buildPixelModel(b, { stableMedia: true }), FPS);
  const changed: number[] = [];
  for (let f = 0; f < TOTAL_FRAMES; f++) if (ha.hashAt(f) !== hb.hashAt(f)) changed.push(f);
  const out: Array<[number, number]> = [];
  for (const f of changed) {
    const last = out[out.length - 1];
    if (last && f === last[1] + 1) last[1] = f;
    else out.push([f, f]);
  }
  return out.map(([s, e]) => [s / FPS, (e + 1) / FPS]);
}

describe("segment content hash invalidation table", () => {
  const b = base();
  const table: Array<{ name: string; edit: (p: Project) => Project; expected: Array<[number, number]> | "all" | "none" }> = [
    { name: "effect param on c2", edit: (p) => mapClip(mapClip(p, "c2", (c) => ({ ...c, effects: fxGlow(4) })), "c2", (c) => ({ ...c, effects: fxGlow(9) })), expected: [[4, 8]] },
    {
      name: "effect added to c2",
      edit: (p) => mapClip(p, "c2", (c) => ({ ...c, effects: fxGlow(4) })),
      expected: [[4, 8]],
    },
    {
      name: "keyframe added to c1",
      edit: (p) => mapClip(p, "c1", (c) => ({ ...c, keyframes: [{ id: "k", time: 1, property: "opacity", value: 0.5, easing: "linear" }] as unknown as Clip["keyframes"] })),
      expected: [[0, 4]],
    },
    { name: "trim tail of c1 (4s to 3s)", edit: (p) => mapClip(p, "c1", (c) => ({ ...c, duration: 3, outPoint: 3 })), expected: [[0, 4]] },
    { name: "move c3 earlier by 1s", edit: (p) => mapClip(p, "c3", (c) => ({ ...c, startTime: 9 })), expected: [[9, 12]] },
    { name: "colour grade on o1", edit: (p) => mapClip(p, "o1", (c) => ({ ...c, colorGrading: { temperature: 12 } } as unknown as Clip)), expected: [[2, 5]] },
    {
      name: "transition between c1 and c2",
      edit: (p) =>
        withTracks(
          p,
          p.timeline.tracks.map((t) =>
            t.id === "v1" ? { ...t, transitions: [{ id: "tr", type: "crossfade", duration: 0.5, clipAId: "c1", clipBId: "c2", params: {} } as unknown as Transition] } : t,
          ),
        ),
      expected: [[3.5, 4.5]],
    },
    {
      name: "adjustment layer added",
      edit: (p) => ({ ...p, adjustmentLayers: [{ id: "adj", startTime: 1, duration: 2, trackId: "v2", effects: [] }] } as unknown as Project),
      expected: [[1, 3]],
    },
    {
      name: "text clip added",
      edit: (p) => ({ ...p, textClips: [{ id: "t1", startTime: 6, duration: 2, text: "hi", trackId: "v2" }] } as unknown as Project),
      expected: [[6, 8]],
    },
    { name: "hide track v2", edit: (p) => withTracks(p, p.timeline.tracks.map((t) => (t.id === "v2" ? { ...t, hidden: true } : t))), expected: [[2, 5]] },
    {
      name: "replace the media file used by c2 and o1",
      edit: (p) => ({ ...p, mediaLibrary: { items: [p.mediaLibrary.items[0], media("m2", 99)] } }),
      expected: [[2, 8]],
    },
    { name: "audio-only edit (volume)", edit: (p) => mapClip(p, "c1", (c) => ({ ...c, volume: 0.2 })), expected: "none" },
    { name: "marker and rename", edit: (p) => ({ ...p, name: "x", timeline: { ...p.timeline, markers: [{ id: "m", time: 1, label: "a" }] as never } }), expected: "none" },
    {
      name: "save and reload adding sequence bookkeeping and empty lists (no pixel change)",
      edit: (p) => ({ ...p, generatedShaders: [], activeSequenceId: "seq_main", openSequenceIds: ["seq_main"], sequences: [{ id: "seq_main", name: "Sequence 1", settings: p.settings, timeline: p.timeline }] } as unknown as Project),
      expected: "none",
    },
    { name: "canvas size change", edit: (p) => ({ ...p, settings: { ...p.settings, width: 1280 } }), expected: "all" },
    { name: "frame rate change is a different grid", edit: (p) => ({ ...p, settings: { ...p.settings, frameRate: 24 } }), expected: "all" },
  ];
  for (const row of table) {
    it(`${row.name} invalidates ${row.expected === "all" ? "every frame" : row.expected === "none" ? "nothing" : JSON.stringify(row.expected)}`, () => {
      const after = row.edit(b);
      if (row.expected === "all") {
        const ha = createSegmentHasher(buildPixelModel(b, { stableMedia: true }), FPS);
        const hb = createSegmentHasher(buildPixelModel(after, { stableMedia: true }), FPS);
        for (const f of [0, 20, 45, 79, 105, 119]) expect(hb.hashAt(f)).not.toBe(ha.hashAt(f));
      } else if (row.expected === "none") {
        expect(changedSpans(b, after)).toEqual([]);
      } else {
        expect(changedSpans(b, after)).toEqual(row.expected);
      }
    });
  }

  it("a source file replaced at the same path (new size or mtime on disk) invalidates the clips that use it", () => {
    const native = (p: Project): Project => ({
      ...p,
      mediaLibrary: {
        items: p.mediaLibrary.items.map((m) =>
          m.id === "m2" ? ({ ...m, blob: null, nativeSource: { path: "/media/m2.mov", codec: "prores", width: 640, height: 360, frameRate: FPS } } as MediaItem) : m,
        ),
      },
    });
    const hash = (stamp: string, f: number) =>
      createSegmentHasher(buildPixelModel(native(base()), { stableMedia: true, mediaStamps: new Map([["m2", stamp]]) }), FPS).hashAt(f);
    expect(hash("100:1", 45)).toBe(hash("100:1", 45));
    expect(hash("100:1", 45)).not.toBe(hash("100:2", 45)); // o1 + c2 use m2
    expect(hash("100:1", 5)).toBe(hash("100:2", 5)); // [0,2) is c1 only (m1)
    expect(hash("100:1", 105)).toBe(hash("100:2", 105)); // c3 uses m1
  });

  it("segment hashes do not depend on process-local identities", () => {
    const again = base();
    const ha = createSegmentHasher(buildPixelModel(b, { stableMedia: true }), FPS);
    const hb = createSegmentHasher(buildPixelModel(again, { stableMedia: true }), FPS);
    for (let f = 0; f < TOTAL_FRAMES; f += 7) expect(hb.hashAt(f)).toBe(ha.hashAt(f));
  });

  it("hashString is deterministic and separates near inputs", () => {
    expect(hashString("a")).toBe(hashString("a"));
    expect(hashString("a")).not.toBe(hashString("b"));
    expect(hashString("")).toHaveLength(27);
  });
});

describe("persisted index format", () => {
  it("round-trips and dedupes hashes", () => {
    const index = serializeIndex({ projectKey: "p", codec: "c", width: 2, height: 2, frameRate: 10 }, [
      { frame: 1, bytes: 5, used: 1, hash: "h1" },
      { frame: 2, bytes: 5, used: 2, hash: "h1" },
      { frame: 3, bytes: 5, used: 3, hash: "h2" },
    ], 0);
    expect(index.hashes).toEqual(["h1", "h2"]);
    expect(parseIndex(JSON.parse(JSON.stringify(index)))).toEqual(index);
  });

  it("rejects truncated, mistyped and future-version indexes", () => {
    const good = serializeIndex({ projectKey: "p", codec: "c", width: 2, height: 2, frameRate: 10 }, [{ frame: 1, bytes: 5, used: 1, hash: "h" }], 0);
    expect(parseIndex(undefined)).toBeUndefined();
    expect(parseIndex({ ...good, version: 2 })).toBeUndefined();
    expect(parseIndex({ ...good, frames: [[1, 5, 1, 7]] })).toBeUndefined();
    expect(parseIndex({ ...good, frames: [[1, 5]] })).toBeUndefined();
    expect(parseIndex({ ...good, frameRate: 0 })).toBeUndefined();
  });

  it("an index store over a chunk store ignores garbage", async () => {
    const store = new MemoryChunkStore();
    await store.put("__index__", new TextEncoder().encode("{not json").buffer as ArrayBuffer);
    expect(await createChunkIndexStore(store).load()).toBeUndefined();
  });
});

function makeCache(store: MemoryChunkStore, opts: { maxBytes?: number; codecId?: string; bytes?: number; key?: string } = {}) {
  const codec = new FakeCodec(opts.codecId ?? "fake", 640, 360, opts.bytes ?? 100);
  const rendered: number[] = [];
  const cache = new RenderCache(
    {
      store,
      createCodec: async () => codec,
      renderFrame: async (p, time, w, h) => {
        rendered.push(Math.round(time * p.settings.frameRate));
        return new FakeBitmap(w, h, `t${time.toFixed(2)}`) as unknown as ImageBitmap;
      },
      yieldToUi: async () => undefined,
    },
    { maxBytes: opts.maxBytes ?? 1_000_000, persistence: { projectKey: opts.key ?? "proj-1", saveDelayMs: 5 } },
  );
  return { cache, rendered, codec };
}

describe("render cache persistence across restart", () => {
  async function renderedStore(): Promise<MemoryChunkStore> {
    const store = new MemoryChunkStore();
    const { cache } = makeCache(store);
    cache.setProject(base());
    await cache.renderRange({ start: 0, end: 8 });
    await cache.flushIndex();
    return store;
  }

  it("a new session restores every frame and plays them back", async () => {
    const store = await renderedStore();
    const { cache, rendered } = makeCache(store);
    const live = base();
    const summary = await cache.restore(live);
    expect(summary).toMatchObject({ restored: 80, droppedStale: 0, droppedMissing: 0, orphansDeleted: 0 });
    expect(cache.getSnapshot().cachedRuns).toEqual([{ start: 0, end: 79 }]);
    const bitmap = (await cache.takeFrame(2.5)) as unknown as FakeBitmap;
    expect(bitmap.tag).toBe("t2.50");
    // Rendering the same range again is all skips: nothing is recomputed after a restart.
    cache.setProject(live);
    const again = await cache.renderRange({ start: 0, end: 8 });
    expect(again.framesRendered).toBe(0);
    expect(again.framesSkipped).toBe(80);
    expect(rendered).toEqual([]);
  });

  it("only the edited range is lost when the project changed while the app was closed", async () => {
    const store = await renderedStore();
    const { cache } = makeCache(store);
    const edited = mapClip(base(), "c2", (c) => ({ ...c, effects: fxGlow(3) }));
    const summary = await cache.restore(edited);
    expect(summary.restored).toBe(40);
    expect(summary.droppedStale).toBe(40);
    expect(cache.getSnapshot().cachedRuns).toEqual([{ start: 0, end: 39 }]);
    // the dropped frames' files are gone from the store, not just hidden
    expect((await store.list()).filter((e) => e.key.startsWith("f")).length).toBe(40);
  });

  it("an audio-only edit made while closed keeps everything", async () => {
    const store = await renderedStore();
    const { cache } = makeCache(store);
    expect((await cache.restore(mapClip(base(), "c1", (c) => ({ ...c, volume: 0.3 })))).restored).toBe(80);
  });

  it("drops frames whose file is missing or torn and deletes orphan files", async () => {
    const store = await renderedStore();
    await store.delete(["f3", "f4"]);
    await store.put("f10", new ArrayBuffer(7));
    await store.put("f999", new ArrayBuffer(100));
    const { cache } = makeCache(store);
    const summary = await cache.restore(base());
    expect(summary.droppedMissing).toBe(3);
    expect(summary.orphansDeleted).toBe(1);
    expect(summary.restored).toBe(77);
    expect(cache.hasFrameAt(0.3)).toBe(false);
    expect(cache.hasFrameAt(0.5)).toBe(true);
    expect(await store.get("f999")).toBeUndefined();
  });

  it("discards everything when the codec, frame size, frame rate or project differs", async () => {
    for (const variant of ["codec", "size", "fps", "project"] as const) {
      const store = await renderedStore();
      const { cache } = makeCache(store, { codecId: variant === "codec" ? "other" : "fake", key: variant === "project" ? "proj-2" : "proj-1" });
      const p = base();
      const project = variant === "size" ? { ...p, settings: { ...p.settings, width: 320, height: 180 } } : variant === "fps" ? { ...p, settings: { ...p.settings, frameRate: 24 } } : p;
      const summary = await cache.restore(project);
      expect(summary.restored, variant).toBe(0);
      expect((await store.list()).filter((e) => e.key !== "__index__").length, variant).toBe(0);
    }
  });

  it("starts empty when no index exists and removes stray frame files", async () => {
    const store = new MemoryChunkStore();
    await store.put("f1", new ArrayBuffer(10));
    const { cache } = makeCache(store);
    const summary = await cache.restore(base());
    expect(summary.restored).toBe(0);
    expect(summary.orphansDeleted).toBe(1);
  });

  it("edits after a restore invalidate only the changed range and persist", async () => {
    const store = await renderedStore();
    const first = makeCache(store);
    const live = base();
    await first.cache.restore(live);
    first.cache.setProject(mapClip(live, "c1", (c) => ({ ...c, effects: fxGlow(2) })));
    expect(first.cache.getSnapshot().cachedRuns).toEqual([{ start: 40, end: 79 }]);
    await first.cache.flushIndex();
    const second = makeCache(store);
    expect((await second.cache.restore(mapClip(base(), "c1", (c) => ({ ...c, effects: fxGlow(2) })))).restored).toBe(40);
  });

  it("deleting render files empties the persisted index too", async () => {
    const store = await renderedStore();
    const { cache } = makeCache(store);
    await cache.restore(base());
    expect(await cache.deleteAll()).toBe(80);
    const next = makeCache(store);
    expect((await next.cache.restore(base())).restored).toBe(0);
  });
});

describe("size cap and LRU eviction (persisted)", () => {
  it("evicts the least recently played frames first and remembers recency across a restart", async () => {
    const store = new MemoryChunkStore();
    const { cache } = makeCache(store, { maxBytes: 1500 });
    cache.setProject(base());
    await cache.renderRange({ start: 0, end: 1 }); // frames 0..9
    for (let f = 0; f < 5; f++) await cache.takeFrame(f / FPS); // 0..4 are now recent
    await cache.renderRange({ start: 2, end: 3 }); // 20..29 needs 5 frames of room
    const runs = cache.getSnapshot().cachedRuns;
    expect(runs).toEqual([{ start: 0, end: 4 }, { start: 20, end: 29 }]);
    expect(cache.getSnapshot().bytes).toBeLessThanOrEqual(1500);
    await cache.flushIndex();

    const small = makeCache(store, { maxBytes: 1000 });
    const summary = await small.cache.restore(base());
    // 15 frames saved, 10 fit: the 5 least recent (0..4 were used before 20..29 were written) go.
    expect(summary.restored).toBe(10);
    expect(small.cache.getSnapshot().cachedRuns).toEqual([{ start: 20, end: 29 }]);
    expect((await store.list()).filter((e) => e.key !== "__index__").length).toBe(10);
  });

  it("refuses to evict the range being rendered and reports the cache is full", async () => {
    const { cache } = makeCache(new MemoryChunkStore(), { maxBytes: 500 });
    cache.setProject(base());
    const summary = await cache.renderRange({ start: 0, end: 1 });
    expect(summary.status).toBe("failed");
    expect(summary.message).toMatch(/full/i);
  });
});

describe("renderRanges", () => {
  it("renders several disjoint ranges as one job with one progress", async () => {
    const { cache, rendered } = makeCache(new MemoryChunkStore());
    cache.setProject(base());
    const seen: number[] = [];
    const summary = await cache.renderRanges([{ start: 1, end: 2 }, { start: 5, end: 6 }], { onProgress: (p) => seen.push(p.total) });
    expect(summary).toMatchObject({ status: "completed", framesRendered: 20, totalFrames: 20 });
    expect(new Set(seen)).toEqual(new Set([20]));
    expect(rendered[0]).toBe(10);
    expect(rendered.at(-1)).toBe(59);
  });
});

describe("playback switching between cached and live", () => {
  it("serves exactly the cached frames from cache, in order, and never a stale or wrong frame", async () => {
    const { cache } = makeCache(new MemoryChunkStore());
    cache.setProject(base());
    await cache.renderRange({ start: 1, end: 2 }); // frames 10..19
    const played: Array<{ frame: number; source: "cache" | "live"; tag?: string }> = [];
    cache.warm(0.9);
    for (let frame = 0; frame < 30; frame++) {
      const t = frame / FPS;
      const bmp = cache.hasFrameAt(t) ? ((await cache.takeFrame(t)) as unknown as FakeBitmap | undefined) : undefined;
      played.push(bmp ? { frame, source: "cache", tag: bmp.tag } : { frame, source: "live" });
    }
    expect(played.map((p) => p.frame)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(played.filter((p) => p.source === "cache").map((p) => p.frame)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    for (const p of played.filter((x) => x.source === "cache")) expect(p.tag).toBe(`t${(p.frame / FPS).toFixed(2)}`);
  });

  it("an edit during playback sends the changed frames to the live path at once", async () => {
    const { cache } = makeCache(new MemoryChunkStore());
    const p = base();
    cache.setProject(p);
    await cache.renderRange({ start: 0, end: 4 }); // clip c1 only
    cache.warm(0);
    const sources: string[] = [];
    for (let frame = 0; frame < 40; frame++) {
      if (frame === 15) cache.setProject(mapClip(p, "c1", (c) => ({ ...c, effects: fxGlow(5) })));
      const t = frame / FPS;
      const bmp = cache.hasFrameAt(t) ? await cache.takeFrame(t) : undefined;
      sources.push(bmp ? "cache" : "live");
    }
    expect(sources.slice(0, 15).every((s) => s === "cache")).toBe(true);
    expect(sources.slice(15).every((s) => s === "live")).toBe(true);
  });
});
