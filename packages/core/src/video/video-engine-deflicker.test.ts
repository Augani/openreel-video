import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../types/project";
import type { Clip, Effect, Transform } from "../types/timeline";

const mocks = vi.hoisted(() => ({
  effectsApply: vi.fn(),
  compose: vi.fn(),
}));

vi.mock("./video-effects-engine", async () => {
  const actual = await vi.importActual<typeof import("./video-effects-engine")>("./video-effects-engine");
  return {
    ...actual,
    VideoEffectsEngine: vi.fn().mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue(true),
      applyEffects: mocks.effectsApply,
      dispose: vi.fn(),
    })),
  };
});

vi.mock("./echo-compositor", () => ({
  EchoCompositor: vi.fn().mockImplementation(() => ({ compose: mocks.compose, dispose: vi.fn() })),
}));

let bitmapId = 0;
const makeBitmap = (label: string): ImageBitmap =>
  ({ label, id: bitmapId++, width: 640, height: 360, close: vi.fn() }) as unknown as ImageBitmap;

const transform: Transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
  fitMode: "contain",
};

const makeProject = (clip: Clip): Project =>
  ({
    id: "p",
    name: "Temporal",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: {
      items: [
        {
          id: "media-1",
          name: "clip.mp4",
          type: "video",
          fileHandle: null,
          blob: new Blob(["video"]),
          metadata: { duration: 20, width: 640, height: 360, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
          thumbnailUrl: null,
          waveformData: null,
        },
      ],
    },
    timeline: {
      tracks: [
        { id: "track-1", type: "video", name: "V", clips: [clip], transitions: [], locked: false, hidden: false, muted: false, solo: false },
      ],
      subtitles: [],
      duration: 10,
      markers: [],
    },
  }) as unknown as Project;

const makeClip = (effects: Effect[], extra: Partial<Clip> = {}): Clip => ({
  id: "clip-1",
  mediaId: "media-1",
  trackId: "track-1",
  startTime: 1,
  duration: 8,
  inPoint: 2,
  outPoint: 10,
  effects,
  audioEffects: [],
  transform,
  volume: 1,
  keyframes: [],
  ...extra,
});

import { deflickerGains, THUMB_H, THUMB_W, type FrameStats } from "./deflicker";

/** Source time at which the (synthetic) footage cuts from one shot to the next. */
const CUT = 5.5;

const labelTime = (bitmap: ImageBitmap): number => Number((bitmap as unknown as { label: string }).label.split("@")[1]);

/** Brightness of the source frame at `t`: alternating flicker, a brighter second shot, with a distinct picture structure. */
function statsAt(t: number): FrameStats {
  const second = t >= CUT;
  const frameIndex = Math.round(t * 30);
  const y = (second ? 0.6 : 0.3) * (frameIndex % 2 === 0 ? 1.2 : 0.8);
  const thumb = new Float32Array(THUMB_W * THUMB_H).map((_, i) => (second ? (i % 2 ? 1.5 : 0.5) : i / (THUMB_W * THUMB_H) + 0.5) * y);
  return { y, r: y, g: y, b: y, thumb };
}

describe("VideoEngine deflicker", { timeout: 60_000 }, () => {
  const ctx = new Proxy({}, { get: () => vi.fn(), set: () => true });

  beforeEach(() => {
    vi.clearAllMocks();
    bitmapId = 0;
    class MockOffscreenCanvas {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return ctx;
      }
    }
    vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => makeBitmap("copy")));
    vi.stubGlobal("self", { onmessage: null, postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    mocks.effectsApply.mockImplementation(async (image: ImageBitmap) => ({ image, processingTime: 0, gpuAccelerated: false }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function engineFor(exportMode = false) {
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine();
    Object.assign(engine as unknown as Record<string, unknown>, { initialized: true, mediabunny: {} });
    engine.exportMode = exportMode;
    const decode = vi
      .spyOn(engine as unknown as { decodeFrameWithMediaBunny: (...a: unknown[]) => Promise<ImageBitmap | null> }, "decodeFrameWithMediaBunny")
      .mockImplementation(async (_blob, time) => makeBitmap(`frame@${(time as number).toFixed(4)}`));
    vi.spyOn(engine as unknown as { measureFrame: (b: ImageBitmap) => FrameStats }, "measureFrame").mockImplementation((b) => statsAt(labelTime(b)));
    return { engine, decode };
  }

  const deflicker = (params: Record<string, unknown> = {}): Effect => ({
    id: "df",
    type: "deflicker",
    enabled: true,
    params: { window: 5, luma: 100, color: 0, sensitivity: 50, limit: 50, ...params },
  });
  const decodedTimes = (decode: { mock: { calls: unknown[][] } }) => decode.mock.calls.map((call) => call[1] as number);
  const appliedGains = (): number[] => {
    const call = mocks.effectsApply.mock.calls.at(-1);
    const effect = (call?.[1] as Effect[]).find((e) => e.type === "deflicker");
    return [effect?.params.gainR, effect?.params.gainG, effect?.params.gainB] as number[];
  };

  it("reads the neighbour frames of the window and hands the effect the gain that evens them out", async () => {
    const { engine, decode } = await engineFor();
    // clip-local 3.0 -> source 5.0 (inPoint 2); window +-2 frames of 30 fps -> source 5 -+ 1/30, 2/30
    await engine.renderFrame(makeProject(makeClip([deflicker()])), 4, 640, 360);
    const times = decodedTimes(decode).map((t) => Number(t.toFixed(4))).sort((a, b) => a - b);
    expect(times).toEqual([4.9333, 4.9667, 5, 5.0333, 5.0667]);
    const expected = deflickerGains(
      [4.9333, 4.9667, 5, 5.0333, 5.0667].map(statsAt),
      [-2, -1, 0, 1, 2],
      deflicker().params,
    );
    const gains = appliedGains();
    expect(gains[0]).toBeCloseTo(expected.r, 9);
    expect(gains[0]).not.toBeCloseTo(1, 2);
    engine.dispose();
  });

  it("does not use frames across a scene cut", async () => {
    const { engine } = await engineFor();
    // source 5.5 is the first frame of the second shot (clip-local 3.5, timeline 4.5)
    await engine.renderFrame(makeProject(makeClip([deflicker()])), 4.5, 640, 360);
    const secondShot = [5.5, 5.5333, 5.5667].map(statsAt);
    const expected = deflickerGains(secondShot, [0, 1, 2], deflicker().params);
    expect(appliedGains()[0]).toBeCloseTo(expected.r, 9);
    engine.dispose();
  });

  it("gives the identical gain in preview and export, whatever was rendered before", async () => {
    const project = makeProject(makeClip([deflicker({ window: 7 })]));
    const runs: number[][] = [];
    for (const exportMode of [false, true]) {
      const { engine } = await engineFor(exportMode);
      for (const t of [2.1, 7.4, 4.3]) await engine.renderFrame(project, t, 640, 360);
      runs.push(appliedGains());
      engine.dispose();
    }
    const fresh = await engineFor();
    await fresh.engine.renderFrame(project, 4.3, 640, 360);
    expect(runs[0]).toEqual(runs[1]);
    expect(appliedGains()).toEqual(runs[0]);
    fresh.engine.dispose();
  });

  it("is a plain frame when Deflicker is neutral or off", async () => {
    const { engine, decode } = await engineFor();
    await engine.renderFrame(makeProject(makeClip([deflicker({ luma: 0, color: 0 })])), 4, 640, 360);
    await engine.renderFrame(makeProject(makeClip([{ ...deflicker(), enabled: false }])), 4, 640, 360);
    expect(decode).toHaveBeenCalledTimes(2);
    engine.dispose();
  });

  it("does not read neighbours past the start of the clip", async () => {
    const { engine, decode } = await engineFor();
    await engine.renderFrame(makeProject(makeClip([deflicker({ window: 7 })])), 1, 640, 360);
    // clip-local 0 -> frames 0..3 only; source = inPoint 2 + n / 30
    const times = decodedTimes(decode).map((t) => Number(t.toFixed(4))).sort((a, b) => a - b);
    expect(times).toEqual([2, 2.0333, 2.0667, 2.1]);
    engine.dispose();
  });
});
