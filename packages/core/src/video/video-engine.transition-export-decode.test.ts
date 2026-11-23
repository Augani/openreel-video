import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, MediaItem, Project, Track, Transition } from "../types";

beforeEach(() => {
  vi.stubGlobal("self", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Two positions of ONE file: a jump cut with a transition on it. */
const blob = new Blob(["x"]);
const media = { id: "m1", type: "video", blob, name: "a.mp4", metadata: { duration: 20, width: 640, height: 360, frameRate: 30 } } as unknown as MediaItem;

function clip(id: string, startTime: number, inPoint: number): Clip {
  return {
    id,
    mediaId: "m1",
    trackId: "v",
    startTime,
    duration: 5,
    inPoint,
    outPoint: inPoint + 5,
    volume: 1,
    effects: [],
    audioEffects: [],
    keyframes: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  } as Clip;
}

const transition: Transition = { id: "t", clipAId: "a", clipBId: "b", type: "crossDissolve", duration: 1, params: {} } as unknown as Transition;

function setup() {
  const a = clip("a", 0, 0);
  const b = clip("b", 5, 10);
  const track = { id: "v", name: "V", type: "video", clips: [a, b], transitions: [transition], muted: false, solo: false, hidden: false, locked: false } as unknown as Track;
  return { a, b, track, settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 } as Project["settings"] };
}

async function run(exportMode: boolean) {
  const { VideoEngine } = await import("./video-engine");
  const engine = new VideoEngine();
  const { a, b, track, settings } = setup();
  engine.exportMode = exportMode;

  // The export decoder hands every caller the same reusable canvas: whichever decode finishes last has overwritten the
  // content the other one was given. `shared.source` is the clip whose frame the canvas currently holds.
  const shared = { source: "", width: 640, height: 360, close: vi.fn() };
  let inFlight = 0;
  let maxInFlight = 0;
  const decode = vi.fn(async (c: Clip) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 1));
    shared.source = c.id;
    // Handing the canvas out ends the decode; a caller that awaited sequentially has already read its own frame by now.
    inFlight--;
    return shared;
  });
  const renderTransition = vi.fn(async () => ({ frame: null }));
  // Snapshot what each side held at the moment the engine finished its own decode.
  const handed: Record<string, string> = {};
  const wrappedDecode = vi.fn(async (c: Clip, ...rest: unknown[]) => {
    const bitmap = (await (decode as unknown as (c: Clip, ...r: unknown[]) => Promise<typeof shared>)(c, ...rest)) as typeof shared;
    handed[c.id] = bitmap.source;
    return bitmap;
  });
  Object.assign(engine, {
    decodeClipBitmap: wrappedDecode,
    applyClipVideoProcessing: vi.fn(async (_id: string, image: unknown) => image),
    findActiveTransition: vi.fn(() => ({ transition, clipA: a, clipB: b, progress: 0.5 })),
    transitionEngine: { getEngineDimensions: () => ({ width: 640, height: 360 }), renderTransition },
  });
  const ctx = { drawImage: vi.fn() } as unknown as OffscreenCanvasRenderingContext2D;
  const rendered = await (engine as unknown as {
    renderActiveTransition: (t: Track, time: number, lib: Project["mediaLibrary"], s: Project["settings"], w: number, h: number, c: OffscreenCanvasRenderingContext2D) => Promise<Set<string>>;
  }).renderActiveTransition(track, 5, { items: [media] } as Project["mediaLibrary"], settings, 640, 360, ctx);
  return { rendered, maxInFlight, decode: wrappedDecode, order: wrappedDecode.mock.calls.map((call) => (call[0] as Clip).id), handed };
}

describe("renderActiveTransition decodes both sides of a same-file transition separately in export mode", () => {
  it("export: the two decodes never overlap, outgoing first then incoming, each from its own clip", async () => {
    const result = await run(true);
    expect(result.rendered).toEqual(new Set(["a", "b"]));
    expect(result.decode).toHaveBeenCalledTimes(2);
    expect(result.order).toEqual(["a", "b"]);
    // A shared reusable canvas can only hold one frame at a time: overlapping requests would see the other's frame.
    expect(result.maxInFlight).toBe(1);
    expect(result.handed).toEqual({ a: "a", b: "b" });
  });

  it("preview: the two sides are still decoded concurrently", async () => {
    const result = await run(false);
    expect(result.decode).toHaveBeenCalledTimes(2);
    expect(result.maxInFlight).toBe(2);
  });
});
