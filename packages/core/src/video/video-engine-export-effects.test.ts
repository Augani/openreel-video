import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../types/project";
import type { Clip, Effect, Transform } from "../types/timeline";
import type {
  ClipColorGrading,
  ColorWheelValues,
  CurvesValues,
  HSLValues,
} from "./color-grading-engine";

const mocks = vi.hoisted(() => {
  const effectsInitialize = vi.fn();
  const effectsApply = vi.fn();
  const effectsDispose = vi.fn();
  const colorGradingInitialize = vi.fn();
  const applyColorWheels = vi.fn();
  const applyCpuGrading = vi.fn();
  const colorGradingDispose = vi.fn();

  return {
    effectsInitialize,
    effectsApply,
    effectsDispose,
    colorGradingInitialize,
    applyColorWheels,
    applyCpuGrading,
    colorGradingDispose,
    VideoEffectsEngine: vi.fn().mockImplementation(() => ({
      initialize: effectsInitialize,
      applyEffects: effectsApply,
      dispose: effectsDispose,
    })),
    ColorGradingEngine: vi.fn().mockImplementation(() => ({
      initialize: colorGradingInitialize,
      applyColorWheels,
      applyCpuGrading,
      dispose: colorGradingDispose,
    })),
  };
});

vi.mock("./video-effects-engine", async () => {
  const actual = await vi.importActual<typeof import("./video-effects-engine")>(
    "./video-effects-engine",
  );
  return {
    ...actual,
    VideoEffectsEngine: mocks.VideoEffectsEngine,
  };
});

vi.mock("./color-grading-engine", async () => {
  const actual = await vi.importActual<typeof import("./color-grading-engine")>(
    "./color-grading-engine",
  );
  return {
    ...actual,
    ColorGradingEngine: mocks.ColorGradingEngine,
  };
});

const makeBitmap = (id: string, width = 640, height = 360): ImageBitmap =>
  ({
    id,
    width,
    height,
    close: vi.fn(),
  }) as unknown as ImageBitmap;

const transform: Transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
  fitMode: "contain",
};

const curves: CurvesValues = {
  rgb: [
    { x: 0, y: 0 },
    { x: 1, y: 0.85 },
  ],
  red: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  green: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  blue: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
};

const colorWheels: ColorWheelValues = {
  shadows: { r: 0.12, g: -0.04, b: -0.08 },
  midtones: { r: 0, g: 0, b: 0 },
  highlights: { r: 0, g: 0, b: 0 },
  shadowsLift: 0,
  midtonesGamma: 1,
  highlightsGain: 1,
};

const hsl: HSLValues = {
  hue: [12, 0, 0, 0, 0, 0, 0, 0],
  saturation: [0, 0.2, 0, 0, 0, 0, 0, 0],
  luminance: [0, 0, -0.1, 0, 0, 0, 0, 0],
};

const lut = {
  data: [0, 0, 0, 255, 255, 255],
  size: 2,
  intensity: 0.5,
};

const makeClip = (
  effects: Effect[],
  colorGrading: ClipColorGrading,
): Clip => ({
  id: "clip-1",
  mediaId: "media-1",
  trackId: "track-1",
  startTime: 0,
  duration: 5,
  inPoint: 0,
  outPoint: 5,
  effects,
  audioEffects: [],
  transform,
  colorGrading,
  volume: 1,
  keyframes: [],
});

const makeProject = (clip: Clip): Project => ({
  id: "project-1",
  name: "Export effects",
  createdAt: 0,
  modifiedAt: 0,
  settings: {
    width: 640,
    height: 360,
    frameRate: 30,
    sampleRate: 48000,
    channels: 2,
  },
  mediaLibrary: {
    items: [
      {
        id: "media-1",
        name: "clip.mp4",
        type: "video",
        fileHandle: null,
        blob: new Blob(["video"]),
        metadata: {
          duration: 5,
          width: 640,
          height: 360,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 1024,
        },
        thumbnailUrl: null,
        waveformData: null,
      },
    ],
  },
  timeline: {
    tracks: [
      {
        id: "track-1",
        type: "video",
        name: "Video",
        clips: [clip],
        transitions: [],
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
      },
    ],
    subtitles: [],
    duration: 5,
    markers: [],
  },
});

describe("VideoEngine export frame effects", () => {
  const ctx = {
    fillStyle: "",
    globalAlpha: 1,
    globalCompositeOperation: "source-over" as GlobalCompositeOperation,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    fillText: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.effectsInitialize.mockResolvedValue(true);
    mocks.colorGradingInitialize.mockReturnValue(undefined);

    class MockOffscreenCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext(): typeof ctx {
        return ctx;
      }
    }

    vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);
    vi.stubGlobal("self", {
      onmessage: null,
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    [false, false], [false, true], [true, false], [true, true],
  ])("renders local temperature keyframes in exportMode=%s with base effect=%s", async (exportMode, hasBase) => {
    const source = makeBitmap("source");
    const final = makeBitmap("final");
    mocks.effectsApply.mockImplementation(async (image: ImageBitmap) => ({ image, processingTime: 0, gpuAccelerated: false }));
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(final));
    const clip: Clip = {
      ...makeClip(hasBase ? [{ id: "temperature", type: "temperature", enabled: true, params: { value: 50 } }] : [], {}),
      startTime: 2,
      keyframes: [
      { id: "t0", time: 0, property: "effect.temperature", value: -6, easing: "linear" },
      { id: "t4", time: 4, property: "effect.temperature", value: 14, easing: "linear" },
      ],
    };
    const project = makeProject(clip);
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine();
    Object.assign(engine as unknown as Record<string, unknown>, { initialized: true, mediabunny: {} });
    engine.exportMode = exportMode;
    vi.spyOn(engine as unknown as { decodeFrameWithMediaBunny: () => Promise<ImageBitmap> }, "decodeFrameWithMediaBunny").mockResolvedValue(source);
    await engine.renderFrame(project, 4, 640, 360);
    expect(mocks.effectsApply).toHaveBeenCalledWith(source, [expect.objectContaining({
      id: hasBase ? "temperature" : "kf-synth-clip-1-temperature", type: "temperature", params: { value: 4 },
    })]);
    expect(clip.effects).toEqual(hasBase ? [{ id: "temperature", type: "temperature", enabled: true, params: { value: 50 } }] : []);
    engine.dispose();
  });

  it("exports active clip effects and every color-grading stage", async () => {
    const sourceBitmap = makeBitmap("source");
    const effectsBitmap = makeBitmap("effects");
    const colorWheelsBitmap = makeBitmap("color-wheels");
    const cpuGradedBitmap = makeBitmap("cpu-graded");
    const whiteBalancedBitmap = makeBitmap("white-balanced");
    const finalBitmap = makeBitmap("final");

    mocks.effectsApply.mockImplementation(
      async (_image: ImageBitmap, effects: Effect[]) => ({
        image: effects.some((effect) => effect.id.startsWith("wb-"))
          ? whiteBalancedBitmap
          : effectsBitmap,
        processingTime: 1,
        gpuAccelerated: false,
      }),
    );
    mocks.applyColorWheels.mockResolvedValue({
      image: colorWheelsBitmap,
      processingTime: 1,
    });
    mocks.applyCpuGrading.mockResolvedValue({
      image: cpuGradedBitmap,
      processingTime: 1,
    });
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(finalBitmap));

    const clipEffect: Effect = {
      id: "brightness-1",
      type: "brightness",
      enabled: true,
      params: { value: 1.2 },
    };
    const colorGrading: ClipColorGrading = {
      colorWheels,
      curves,
      lut,
      hsl,
      temperature: 22,
      tint: -14,
    };
    const clip = makeClip([clipEffect], colorGrading);
    const project = makeProject(clip);
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine();

    Object.assign(engine as unknown as Record<string, unknown>, {
      initialized: true,
      mediabunny: {},
    });
    vi.spyOn(
      engine as unknown as {
        decodeFrameWithMediaBunny: () => Promise<ImageBitmap>;
      },
      "decodeFrameWithMediaBunny",
    ).mockResolvedValue(sourceBitmap);

    const result = await engine.renderFrame(project, 1, 640, 360);

    expect(result.image).toBe(finalBitmap);
    expect(mocks.effectsApply).toHaveBeenNthCalledWith(1, sourceBitmap, [
      clipEffect,
    ]);
    expect(mocks.applyColorWheels).toHaveBeenCalledWith(
      effectsBitmap,
      colorWheels,
    );
    expect(mocks.applyCpuGrading).toHaveBeenCalledWith(colorWheelsBitmap, {
      curves,
      lut: {
        ...lut,
        data: new Uint8Array(lut.data),
      },
      hsl,
    });
    expect(mocks.effectsApply).toHaveBeenNthCalledWith(2, cpuGradedBitmap, [
      {
        id: "wb-temperature",
        type: "temperature",
        enabled: true,
        params: { value: 22 },
      },
      {
        id: "wb-tint",
        type: "tint",
        enabled: true,
        params: { value: -14 },
      },
    ]);
    expect(ctx.drawImage).toHaveBeenCalledWith(
      whiteBalancedBitmap,
      -320,
      -180,
      640,
      360,
    );
    expect(sourceBitmap.close).toHaveBeenCalledTimes(1);
    expect(effectsBitmap.close).toHaveBeenCalledTimes(1);
    expect(colorWheelsBitmap.close).toHaveBeenCalledTimes(1);
    expect(cpuGradedBitmap.close).toHaveBeenCalledTimes(1);
    expect(whiteBalancedBitmap.close).toHaveBeenCalledTimes(1);
  });

  it("does not scale an output-sized decoded frame twice", async () => {
    const outputSizedBitmap = makeBitmap("output-sized", 320, 180);
    const finalBitmap = makeBitmap("scaled-final", 320, 180);
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(finalBitmap));

    const project = makeProject(makeClip([], {} as ClipColorGrading));
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine();
    Object.assign(engine as unknown as Record<string, unknown>, {
      initialized: true,
      mediabunny: {},
    });
    vi.spyOn(
      engine as unknown as {
        decodeFrameWithMediaBunny: () => Promise<ImageBitmap>;
      },
      "decodeFrameWithMediaBunny",
    ).mockResolvedValue(outputSizedBitmap);

    await engine.renderFrame(project, 1, 320, 180);

    expect(ctx.scale).toHaveBeenCalledWith(1, 1);
    expect(ctx.scale).not.toHaveBeenCalledWith(0.5, 0.5);
    expect(ctx.drawImage).toHaveBeenCalledWith(
      outputSizedBitmap,
      -160,
      -90,
      320,
      180,
    );
  });

  it("recreates the effects engine and retries a transient export failure", async () => {
    const sourceBitmap = makeBitmap("retry-source");
    const processedBitmap = makeBitmap("retry-processed");
    const finalBitmap = makeBitmap("retry-final");
    const clipEffect: Effect = {
      id: "contrast-retry",
      type: "contrast",
      enabled: true,
      params: { value: 1.2 },
    };

    mocks.effectsApply
      .mockRejectedValueOnce(new Error("transient effects failure"))
      .mockResolvedValueOnce({
        image: processedBitmap,
        processingTime: 1,
        gpuAccelerated: false,
      });
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(finalBitmap));

    const project = makeProject(makeClip([clipEffect], {} as ClipColorGrading));
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine();
    engine.exportMode = true;
    Object.assign(engine as unknown as Record<string, unknown>, {
      initialized: true,
      mediabunny: {},
    });
    vi.spyOn(
      engine as unknown as {
        decodeFrameWithMediaBunny: () => Promise<ImageBitmap>;
      },
      "decodeFrameWithMediaBunny",
    ).mockResolvedValue(sourceBitmap);

    const result = await engine.renderFrame(project, 1, 640, 360);

    expect(result.image).toBe(finalBitmap);
    expect(mocks.effectsApply).toHaveBeenCalledTimes(2);
    expect(mocks.effectsDispose).toHaveBeenCalledTimes(1);
    expect(mocks.VideoEffectsEngine).toHaveBeenCalledTimes(2);
    expect(ctx.drawImage).toHaveBeenCalledWith(
      processedBitmap,
      -320,
      -180,
      640,
      360,
    );
  });

  it("applies ordered effects to isolated overlay canvases before compositing", async () => {
    const sourceBitmap = makeBitmap("overlay-source");
    const processedBitmap = makeBitmap("overlay-processed");
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(sourceBitmap));
    mocks.effectsApply.mockResolvedValue({
      image: processedBitmap,
      processingTime: 1,
      gpuAccelerated: false,
    });
    const effects: Effect[] = [
      {
        id: "shader-first",
        type: "shader",
        enabled: true,
        params: { shaderId: "paper-halftone-dots" },
      },
      {
        id: "brightness-second",
        type: "brightness",
        enabled: true,
        params: { value: 20 },
      },
    ];
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine() as unknown as {
      drawOverlayCanvasWithEffects: (
        context: typeof ctx,
        source: OffscreenCanvas,
        overlayEffects: readonly Effect[],
        width: number,
        height: number,
      ) => Promise<void>;
    };
    const overlayCanvas = new OffscreenCanvas(640, 360);

    await engine.drawOverlayCanvasWithEffects(
      ctx,
      overlayCanvas,
      effects,
      640,
      360,
    );

    expect(mocks.effectsApply).toHaveBeenCalledWith(sourceBitmap, effects);
    expect(ctx.drawImage).toHaveBeenCalledWith(
      processedBitmap,
      0,
      0,
      640,
      360,
    );
    expect(sourceBitmap.close).toHaveBeenCalledTimes(1);
    expect(processedBitmap.close).toHaveBeenCalledTimes(1);
  });

  it("renders active adjustment-layer effects into the final preview/export composite", async () => {
    const sourceBitmap = makeBitmap("adjustment-clip");
    const compositeSnapshot = makeBitmap("adjustment-source");
    const adjustedBitmap = makeBitmap("adjustment-result");
    const finalBitmap = makeBitmap("adjustment-final");
    const adjustmentEffect: Effect = {
      id: "adjustment-contrast",
      type: "contrast",
      enabled: true,
      params: { value: 1.35 },
    };
    mocks.effectsApply.mockResolvedValue({
      image: adjustedBitmap,
      processingTime: 1,
      gpuAccelerated: false,
    });
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn()
        .mockResolvedValueOnce(compositeSnapshot)
        .mockResolvedValueOnce(finalBitmap),
    );

    const base = makeProject(makeClip([], {} as ClipColorGrading));
    // The layer sits on an empty track above the footage track, so the footage is below it.
    const project: Project = {
      ...base,
      timeline: {
        ...base.timeline,
        tracks: [{ ...base.timeline.tracks[0], id: "track-0", clips: [] }, ...base.timeline.tracks],
      },
      adjustmentLayers: [{
        id: "adjustment-1",
        trackId: "track-0",
        name: "Section grade",
        startTime: 0,
        duration: 4,
        effects: [adjustmentEffect],
        opacity: 0.4,
        blendMode: "difference",
        enabled: true,
        affectedTracks: "all",
        transform,
      }],
    };
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine();
    Object.assign(engine as unknown as Record<string, unknown>, {
      initialized: true,
      mediabunny: {},
    });
    vi.spyOn(
      engine as unknown as { decodeFrameWithMediaBunny: () => Promise<ImageBitmap> },
      "decodeFrameWithMediaBunny",
    ).mockResolvedValue(sourceBitmap);

    const result = await engine.renderFrame(project, 1, 640, 360);

    expect(result.image).toBe(finalBitmap);
    expect(mocks.effectsApply).toHaveBeenCalledWith(compositeSnapshot, [adjustmentEffect]);
    expect(ctx.drawImage).toHaveBeenCalledWith(adjustedBitmap, 0, 0, 640, 360);
    expect(ctx.globalAlpha).toBe(0.4);
    expect(ctx.globalCompositeOperation).toBe("difference");
    expect(compositeSnapshot.close).toHaveBeenCalledTimes(1);
    expect(adjustedBitmap.close).toHaveBeenCalledTimes(1);
  });

  describe("adjustment-layer stacking", () => {
    const adjustmentEffect: Effect = {
      id: "adjustment-contrast",
      type: "contrast",
      enabled: true,
      params: { value: 1.35 },
    };

    // Ordered log of the observable draw/effect events of one frame.
    let log: string[] = [];

    afterEach(() => {
      ctx.clearRect.mockReset();
      ctx.drawImage.mockReset();
    });

    const renderWithLayer = async (
      layerTrackId: string,
      affectedTracks: string[] | "all",
      textTrackIds: string[] = [],
    ): Promise<void> => {
      log = [];
      const adjustedBitmap = makeBitmap("adjustment-result");
      mocks.effectsApply.mockImplementation(async () => {
        log.push("effects");
        return { image: adjustedBitmap, processingTime: 1, gpuAccelerated: false };
      });
      ctx.clearRect.mockImplementation(() => {
        log.push("clearRect");
      });
      ctx.drawImage.mockImplementation((image: { id?: string }) => {
        log.push(`drawImage:${image.id ?? "?"}:${ctx.globalCompositeOperation}`);
      });
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn().mockImplementation(async () => {
          log.push("snapshot");
          return makeBitmap("snapshot");
        }),
      );
      const base = makeProject(makeClip([], {} as ClipColorGrading));
      // track-0 (front, empty) / track-1 (footage) / track-2 (back, empty)
      const project: Project = {
        ...base,
        timeline: {
          ...base.timeline,
          tracks: [
            { ...base.timeline.tracks[0], id: "track-0", clips: [] },
            ...base.timeline.tracks,
            { ...base.timeline.tracks[0], id: "track-2", clips: [] },
          ],
        },
        adjustmentLayers: [{
          id: "adjustment-1",
          trackId: layerTrackId,
          name: "Grade",
          startTime: 0,
          duration: 4,
          effects: [adjustmentEffect],
          opacity: 1,
          blendMode: "normal",
          enabled: true,
          affectedTracks,
          transform,
        }],
      };
      const { VideoEngine } = await import("./video-engine");
      const { titleEngine } = await import("../text/title-engine");
      vi.spyOn(titleEngine, "getAllTextClips").mockReturnValue(
        textTrackIds.map((trackId) => ({
          id: `text-${trackId}`,
          trackId,
          startTime: 0,
          duration: 4,
        })) as unknown as ReturnType<typeof titleEngine.getAllTextClips>,
      );
      const engine = new VideoEngine();
      Object.assign(engine as unknown as Record<string, unknown>, { initialized: true, mediabunny: {} });
      vi.spyOn(
        engine as unknown as { decodeFrameWithMediaBunny: () => Promise<ImageBitmap> },
        "decodeFrameWithMediaBunny",
      ).mockImplementation(async () => {
        log.push("footage");
        return makeBitmap("adjustment-clip");
      });
      vi.spyOn(
        engine as unknown as { renderTextClipWithSubjectMask: () => Promise<void> },
        "renderTextClipWithSubjectMask",
      ).mockImplementation(async function (this: unknown, ...args: unknown[]) {
        log.push(`text:${(args[1] as { trackId: string }).trackId}`);
      });
      await engine.renderFrame(project, 1, 640, 360);
    };

    it("adjusts only what is painted before the layer's own track (footage on that track is untouched)", async () => {
      await renderWithLayer("track-1", "all");
      expect(log.filter((e) => e === "effects")).toHaveLength(1);
      expect(log.indexOf("effects")).toBeLessThan(log.indexOf("footage"));
    });

    it("adjusts footage and text on tracks below the layer, but not text above it", async () => {
      await renderWithLayer("track-0", "all", ["track-0", "track-2"]);
      const effects = log.indexOf("effects");
      expect(log.filter((e) => e === "effects")).toHaveLength(1);
      expect(log.indexOf("footage")).toBeLessThan(effects);
      // Title below the layer is adjusted; the title on the layer's own track paints afterwards, untouched.
      expect(log.indexOf("text:track-2")).toBeLessThan(effects);
      expect(log.indexOf("text:track-0")).toBeGreaterThan(effects);
      // Effects read a snapshot taken after the lower tracks were drawn.
      const snapshot = log.lastIndexOf("snapshot", effects);
      expect(snapshot).toBeGreaterThan(log.indexOf("footage"));
      expect(snapshot).toBeGreaterThan(log.indexOf("text:track-2"));
    });

    it("honors affectedTracks: restricted away from the footage track means untouched", async () => {
      await renderWithLayer("track-0", ["track-2"]);
      expect(mocks.effectsApply).not.toHaveBeenCalled();
    });

    it("ignores affectedTracks entries that sit above the layer", async () => {
      await renderWithLayer("track-1", ["track-0"], ["track-0"]);
      expect(mocks.effectsApply).not.toHaveBeenCalled();
    });

    it("honors affectedTracks: isolates the listed track and leaves content above it untouched", async () => {
      await renderWithLayer("track-0", ["track-1"], ["track-0"]);
      expect(log.filter((e) => e === "effects")).toHaveLength(1);
      const effects = log.indexOf("effects");
      const snapshot = log.indexOf("snapshot");
      const clear = log.indexOf("clearRect", snapshot);
      // Backdrop snapshot, clear, then the track alone is painted...
      expect(snapshot).toBeGreaterThanOrEqual(0);
      expect(clear).toBeGreaterThan(snapshot);
      expect(log.indexOf("footage")).toBeGreaterThan(clear);
      // ...the effects run on that isolated track, and only then is the backdrop restored beneath it.
      expect(effects).toBeGreaterThan(log.indexOf("footage"));
      const restore = log.indexOf("drawImage:snapshot:destination-over");
      expect(restore).toBeGreaterThan(effects);
      // The title on the layer's own (higher) track paints after the whole adjusted stack is restored.
      expect(log.indexOf("text:track-0")).toBeGreaterThan(restore);
    });
  });
});
