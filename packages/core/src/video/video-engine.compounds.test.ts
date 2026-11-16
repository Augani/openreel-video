import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, Project } from "../types";

beforeEach(() => {
  vi.stubGlobal("self", {
    onmessage: null,
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("compound timeline composition", () => {
  it("reaches the compound renderer without requiring a fake media-library asset", async () => {
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine();
    const ctx = {
      canvas: {},
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
    };
    const image = { width: 640, height: 360, close: vi.fn() };
    const nested = vi.fn(async () => image);
    const draw = vi.fn(async () => undefined);
    Object.assign(engine, {
      ensureInitialized: vi.fn(),
      compositeCanvas: { width: 640, height: 360 },
      compositeCtx: ctx,
      renderCompoundFrame: nested,
      applyClipVideoProcessing: vi.fn(async () => image),
      drawClipFrameToContext: draw,
    });
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 640, height: 360, close: vi.fn() })),
    );
    const clip: Clip = {
      id: "instance",
      mediaId: "compound:nested",
      trackId: "track",
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      volume: 1,
      effects: [],
      audioEffects: [],
      keyframes: [],
      transform: {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        anchor: { x: 0.5, y: 0.5 },
        opacity: 1,
      },
      metadata: { compoundClipId: "nested" },
    };
    const project: Project = {
      id: "project",
      name: "Nested",
      createdAt: 0,
      modifiedAt: 0,
      settings: {
        width: 640,
        height: 360,
        frameRate: 30,
        sampleRate: 48000,
        channels: 2,
      },
      mediaLibrary: { items: [] },
      timeline: {
        tracks: [
          {
            id: "track",
            name: "Video",
            type: "video",
            clips: [clip],
            transitions: [],
            muted: false,
            solo: false,
            hidden: false,
            locked: false,
          },
        ],
        duration: 5,
        subtitles: [],
        markers: [],
      },
      compoundClips: [
        {
          id: "nested",
          name: "Nested",
          createdAt: 0,
          modifiedAt: 0,
          color: "#8b5cf6",
          content: { clips: [], tracks: [], duration: 5 },
        },
      ],
    };
    await engine.renderFrame(project, 1, 640, 360);
    expect(nested).toHaveBeenCalledWith(project, "nested", 1, 640, 360);
    expect(draw).toHaveBeenCalledOnce();
  });
});
