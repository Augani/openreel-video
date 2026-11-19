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

describe("VideoEngine temporal effects", { timeout: 60_000 }, () => {
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
    mocks.compose.mockImplementation(async () => makeBitmap("composed"));
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
    return { engine, decode };
  }

  const decodedTimes = (decode: { mock: { calls: unknown[][] } }) => decode.mock.calls.map((call) => call[1] as number);

  describe("Posterize Time", () => {
    const posterize = (frameRate: number): Effect => ({ id: "pt", type: "posterize-time", enabled: true, params: { frameRate } });

    it("reads the source at the start of the held frame", async () => {
      const { engine, decode } = await engineFor();
      const project = makeProject(makeClip([posterize(4)]));
      // timeline 2.10 / 2.20 / 2.24 are clip-local 1.10 / 1.20 / 1.24 -> held at 1.00 -> source 2 + 1.00
      for (const t of [2.1, 2.2, 2.24]) await engine.renderFrame(project, t, 640, 360);
      expect(decodedTimes(decode)).toEqual([3, 3, 3]);
      decode.mockClear();
      await engine.renderFrame(project, 2.25, 640, 360);
      expect(decodedTimes(decode)).toEqual([3.25]);
      engine.dispose();
    });

    it("is off at a rate of 0 and when the effect is disabled", async () => {
      const { engine, decode } = await engineFor();
      await engine.renderFrame(makeProject(makeClip([posterize(0)])), 2.1, 640, 360);
      await engine.renderFrame(makeProject(makeClip([{ ...posterize(4), enabled: false }])), 2.1, 640, 360);
      expect(decodedTimes(decode)).toEqual([expect.closeTo(3.1, 9), expect.closeTo(3.1, 9)]);
      engine.dispose();
    });

    it("follows a keyframed frame rate", async () => {
      const { engine, decode } = await engineFor();
      const clip = makeClip([posterize(30)], {
        keyframes: [
          { id: "a", time: 0, property: "effect.posterize-time.frameRate", value: 1, easing: "linear" },
          { id: "b", time: 4, property: "effect.posterize-time.frameRate", value: 5, easing: "linear" },
        ],
      });
      // clip-local 2.0: rate 3 -> frame 6 -> 2.0 exactly; clip-local 2.2 -> 2.0 (3 fps interval 0.333)
      await engine.renderFrame(makeProject(clip), 3.2, 640, 360);
      const held = decodedTimes(decode)[0];
      const rate = 1 + (2.2 / 4) * 4;
      expect(held).toBeCloseTo(2 + Math.floor(2.2 * rate + 1e-6) / rate, 9);
      engine.dispose();
    });

    it("picks the same frame regardless of render order or export mode", async () => {
      const project = makeProject(makeClip([posterize(6)]));
      const times = [4.01, 2.5, 6.99, 2.5, 4.01];
      const runs: number[][] = [];
      for (const exportMode of [false, true]) {
        const { engine, decode } = await engineFor(exportMode);
        for (const t of times) await engine.renderFrame(project, t, 640, 360);
        runs.push(decodedTimes(decode));
        engine.dispose();
      }
      expect(runs[0]).toEqual(runs[1]);
      expect(runs[0][1]).toBe(runs[0][3]);
      expect(runs[0][0]).toBe(runs[0][4]);
    });
  });

  describe("Echo", () => {
    const echo = (params: Record<string, unknown>): Effect => ({
      id: "echo-1",
      type: "echo",
      enabled: true,
      params: { echoTime: 0.1, echoes: 2, startIntensity: 1, decay: 0.5, operator: "add", ...params },
    });

    it("decodes the frames at t - k * echoTime and composites them with their intensities", async () => {
      const { engine, decode } = await engineFor();
      await engine.renderFrame(makeProject(makeClip([echo({})])), 4, 640, 360);
      // clip-local 3 -> source 5; echoes at clip-local 2.9, 2.8 -> source 4.9, 4.8
      expect(decodedTimes(decode)).toEqual([5, expect.closeTo(4.9, 9), expect.closeTo(4.8, 9)]);
      expect(mocks.compose).toHaveBeenCalledTimes(1);
      const [base, frames, params] = mocks.compose.mock.calls[0];
      expect((base as { label: string }).label).toBe("frame@5.0000");
      expect(frames.map((f: { weight: number }) => f.weight)).toEqual([0.5, 0.25]);
      expect(frames.map((f: { image: { label: string } }) => f.image.label)).toEqual(["frame@4.9000", "frame@4.8000"]);
      expect(params).toMatchObject({ operator: "add", startIntensity: 1 });
      engine.dispose();
    });

    it("does not decode echoes that fall before the clip's first frame", async () => {
      const { engine, decode } = await engineFor();
      // clip-local 0.15: echo 1 at 0.05 is inside the clip, echo 2 at -0.05 is not
      await engine.renderFrame(makeProject(makeClip([echo({})])), 1.15, 640, 360);
      expect(decodedTimes(decode)).toHaveLength(2);
      expect(decodedTimes(decode)[1]).toBeCloseTo(2.05, 9);
      // first frame of the clip: nothing to echo, no composite
      mocks.compose.mockClear();
      await engine.renderFrame(makeProject(makeClip([echo({})])), 1, 640, 360);
      expect(mocks.compose).not.toHaveBeenCalled();
      engine.dispose();
    });

    it("reaches into the future with a negative echo time", async () => {
      const { engine, decode } = await engineFor();
      await engine.renderFrame(makeProject(makeClip([echo({ echoTime: -0.25, echoes: 2 })])), 4, 640, 360);
      expect(decodedTimes(decode)).toEqual([5, 5.25, 5.5]);
      engine.dispose();
    });

    it("builds the echo on posterized time", async () => {
      const { engine, decode } = await engineFor();
      const clip = makeClip([
        { id: "pt", type: "posterize-time", enabled: true, params: { frameRate: 2 } },
        echo({ echoTime: 1, echoes: 1 }),
      ]);
      // clip-local 3.3 holds at 3.0 -> source 5; the echo is one second earlier
      await engine.renderFrame(makeProject(clip), 4.3, 640, 360);
      expect(decodedTimes(decode)).toEqual([5, 4]);
      engine.dispose();
    });

    it("follows keyframed echo parameters", async () => {
      const { engine, decode } = await engineFor();
      const clip = makeClip([echo({ echoes: 1 })], {
        keyframes: [
          { id: "a", time: 0, property: "effect.echo.echoes", value: 1, easing: "linear" },
          { id: "b", time: 4, property: "effect.echo.echoes", value: 5, easing: "linear" },
        ],
      });
      await engine.renderFrame(makeProject(clip), 5, 640, 360); // clip-local 4: 5 echoes
      expect(decodedTimes(decode)).toHaveLength(6);
      decode.mockClear();
      await engine.renderFrame(makeProject(clip), 3, 640, 360); // clip-local 2: 3 echoes
      expect(decodedTimes(decode)).toHaveLength(4);
      engine.dispose();
    });

    it("samples the same frames in preview, scrubbing and export", async () => {
      const project = makeProject(makeClip([echo({ echoes: 3 })]));
      const times = [6, 3.5, 6, 8.9];
      const runs: number[][] = [];
      for (const exportMode of [false, true]) {
        const { engine, decode } = await engineFor(exportMode);
        for (const t of times) {
          decode.mockClear();
          await engine.renderFrame(project, t, 640, 360);
          runs.push(decodedTimes(decode));
        }
        engine.dispose();
      }
      expect(runs.slice(0, 4)).toEqual(runs.slice(4));
      expect(runs[0]).toEqual(runs[2]);
    });

    it("applies the effects above the echo to every echo frame and the ones below to the result", async () => {
      const { engine } = await engineFor();
      const clip = makeClip([
        { id: "bright", type: "brightness", enabled: true, params: { value: 10 } },
        echo({ echoes: 2 }),
        { id: "contrast", type: "contrast", enabled: true, params: { value: 1.2 } },
      ]);
      await engine.renderFrame(makeProject(clip), 4, 640, 360);
      const stacks = mocks.effectsApply.mock.calls.map((call) => (call[1] as Effect[]).map((e) => e.type));
      // current frame, echo 1, echo 2 each get the brightness above the echo; the composite gets contrast
      expect(stacks).toEqual([["brightness"], ["brightness"], ["brightness"], ["contrast"]]);
      engine.dispose();
    });

    it("fails an export frame instead of silently dropping an echo that cannot be decoded", async () => {
      const { engine, decode } = await engineFor(true);
      decode.mockImplementation(async (_blob, time) => ((time as number) < 5 ? null : makeBitmap("ok")));
      // the fallback decoder is not available in the test: stub it out too
      vi.spyOn(engine as unknown as { decodeFrameWithVideoElement: () => Promise<null> }, "decodeFrameWithVideoElement").mockResolvedValue(null);
      await expect(engine.renderFrame(makeProject(makeClip([echo({})])), 4, 640, 360)).rejects.toThrow(/Echo frame/);
      engine.dispose();
    });
  });
});
