import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, MediaItem, Project, Track, Transition } from "../types";
import type { Mask } from "./mask-engine";

const bitmaps: Array<{ label: string; width: number; height: number; close: ReturnType<typeof vi.fn> }> = [];
const makeBitmap = (label: string) => {
  const bitmap = { label, width: 640, height: 360, close: vi.fn() };
  bitmaps.push(bitmap);
  return bitmap;
};

beforeEach(() => {
  bitmaps.length = 0;
  vi.stubGlobal("self", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("OffscreenCanvas", class { width = 640; height = 360; getContext() { return { drawImage: vi.fn() }; } });
  vi.stubGlobal("createImageBitmap", vi.fn(async () => makeBitmap("copy")));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const media = { id: "m1", type: "video", blob: new Blob(["x"]), name: "a.mp4", metadata: { duration: 20, width: 640, height: 360, frameRate: 30 } } as unknown as MediaItem;

function clip(id: string, startTime: number, extra: Partial<Clip> = {}): Clip {
  return {
    id, mediaId: "m1", trackId: "v", startTime, duration: 5, inPoint: 0, outPoint: 5, volume: 1,
    effects: [], audioEffects: [], keyframes: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
    ...extra,
  } as Clip;
}

const mask = (id: string, clipId: string, appliesTo?: "effects"): Mask =>
  ({ id, clipId, type: "shape", path: { closed: true, points: [] }, feathering: 0, expansion: 0, opacity: 1, inverted: false, keyframes: [], ...(appliesTo ? { appliesTo } : {}) }) as unknown as Mask;

const transition = { id: "t", clipAId: "a", clipBId: "b", type: "crossDissolve", duration: 1, params: {} } as unknown as Transition;

async function run(masks: Mask[], clips: { a?: Partial<Clip>; b?: Partial<Clip> } = {}) {
  const { VideoEngine } = await import("./video-engine");
  const engine = new VideoEngine();
  const a = clip("a", 0, clips.a);
  const b = clip("b", 5, clips.b);
  const track = { id: "v", name: "V", type: "video", clips: [a, b], transitions: [transition], muted: false, solo: false, hidden: false, locked: false } as unknown as Track;
  const settings = { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 } as Project["settings"];
  const renderTransition = vi.fn(async () => ({ frame: null }));
  const applyMasks = vi.fn(async (image: { label: string }, list: readonly Mask[]) => ({ image: makeBitmap(`cut(${image.label}|${list.map((m) => m.id).join(",")})`), processingTime: 0, gpuAccelerated: false }));
  const composeEffectMasks = vi.fn(async (processed: { label?: string }, base: { label?: string }, list: readonly Mask[]) => makeBitmap(`mix(${processed.label ?? "canvas"}|${base.label ?? "canvas"}|${list.map((m) => m.id).join(",")})`));
  const loadMasks = vi.fn();
  const decoded = new Map<string, ReturnType<typeof makeBitmap>>();
  Object.assign(engine, {
    decodeClipBitmap: vi.fn(async (c: Clip) => { const bitmap = makeBitmap(`raw-${c.id}`); decoded.set(c.id, bitmap); return bitmap; }),
    applyClipVideoProcessing: vi.fn(async (id: string, image: { label: string }) => makeBitmap(`fx-${id}(${image.label})`)),
    findActiveTransition: vi.fn(() => ({ transition, clipA: a, clipB: b, progress: 0.5 })),
    transitionEngine: { getEngineDimensions: () => ({ width: 640, height: 360 }), renderTransition },
    maskEngine: { loadMasks, applyMasks, composeEffectMasks },
  });
  const ctx = { drawImage: vi.fn() } as unknown as OffscreenCanvasRenderingContext2D;
  await (engine as unknown as {
    renderActiveTransition: (t: Track, time: number, lib: Project["mediaLibrary"], s: Project["settings"], w: number, h: number, c: OffscreenCanvasRenderingContext2D, m?: readonly Mask[]) => Promise<Set<string>>;
  }).renderActiveTransition(track, 5, { items: [media] } as Project["mediaLibrary"], settings, 640, 360, ctx, masks);
  const [outgoing, incoming] = renderTransition.mock.calls[0] as unknown as Array<{ label: string }>;
  return { outgoing: outgoing.label, incoming: incoming.label, applyMasks, composeEffectMasks };
}

describe("clip masks in the transition render path", () => {
  it("a visibility mask cuts its own side of the transition and nothing else", async () => {
    const result = await run([mask("m-a", "a")]);
    expect(result.outgoing).toBe("cut(fx-a(raw-a)|m-a)");
    expect(result.incoming).toBe("fx-b(raw-b)");
    expect(result.applyMasks).toHaveBeenCalledTimes(1);
  });

  it("each side gets only its own masks", async () => {
    const result = await run([mask("m-a", "a"), mask("m-b1", "b"), mask("m-b2", "b"), mask("other", "zzz")]);
    expect(result.outgoing).toBe("cut(fx-a(raw-a)|m-a)");
    expect(result.incoming).toBe("cut(fx-b(raw-b)|m-b1,m-b2)");
  });

  it("an effects-only mask keeps working: effects inside the matte, the unprocessed picture outside", async () => {
    const result = await run([mask("fx-mask", "a", "effects")]);
    expect(result.composeEffectMasks).toHaveBeenCalledTimes(1);
    const [processed, base, list] = result.composeEffectMasks.mock.calls[0] as unknown as [unknown, unknown, Mask[]];
    expect(list.map((m) => m.id)).toEqual(["fx-mask"]);
    expect(processed).toBeDefined();
    expect(base).toBeDefined();
    expect(result.outgoing).toMatch(/^mix\(/);
    expect(result.applyMasks).not.toHaveBeenCalled();
    expect(result.incoming).toBe("fx-b(raw-b)");
  });

  it("clips without masks are untouched", async () => {
    const result = await run([]);
    expect(result.outgoing).toBe("fx-a(raw-a)");
    expect(result.applyMasks).not.toHaveBeenCalled();
    expect(result.composeEffectMasks).not.toHaveBeenCalled();
  });

  it("the mask Remove Object consumes does not also cut the clip", async () => {
    const removal = { enabled: true, maskId: "m-a", analysisKey: "k", dilate: 10, feather: 5 };
    const result = await run([mask("m-a", "a"), mask("keep", "a")], { a: { objectRemoval: removal } });
    expect(result.outgoing).toBe("cut(fx-a(raw-a)|keep)");
  });
});
