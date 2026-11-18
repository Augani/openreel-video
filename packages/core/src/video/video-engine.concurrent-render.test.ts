import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, Project } from "../types";
import type { RenderedFrame } from "./types";

beforeEach(() => {
  vi.stubGlobal("self", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function sourceImage(tag: string) {
  return { tag, width: 640, height: 360, close: vi.fn() };
}
function project(): Project {
  const clip: Clip = {
    id: "instance",
    mediaId: "compound:nested",
    trackId: "video",
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    volume: 1,
    effects: [],
    audioEffects: [],
    keyframes: [],
    metadata: { compoundClipId: "nested" },
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
  };
  return {
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
      duration: 5,
      subtitles: [],
      markers: [],
      tracks: [
        {
          id: "video",
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
}

async function compositor(
  renderNested: (project: Project, time: number) => Promise<RenderedFrame>,
) {
  const { VideoEngine } = await import("./video-engine");
  const engine = new VideoEngine();
  let pixels: string[] = [];
  const canvas = { width: 640, height: 360 };
  const ctx = {
    canvas,
    fillRect: vi.fn(() => {
      pixels = [];
    }),
    clearRect: vi.fn(() => {
      pixels = [];
    }),
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
  };
  Object.assign(engine, {
    ensureInitialized: vi.fn(),
    compositeCanvas: canvas,
    compositeCtx: ctx,
    compoundEngines: new Map([["nested", { renderFrame: renderNested }]]),
    applyClipVideoProcessing: vi.fn(async (_id, image) => image),
    drawClipFrameToContext: vi.fn(async (_ctx, image) => {
      pixels.push(image.tag);
    }),
  });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({
      width: 640,
      height: 360,
      tags: [...pixels],
      close: vi.fn(),
    })),
  );
  return engine;
}
const nestedFrame = (tag: string): RenderedFrame => ({
  image: sourceImage(tag) as unknown as ImageBitmap,
  timestamp: 0,
  width: 640,
  height: 360,
});
function tags(frame: RenderedFrame) {
  return (frame.image as unknown as { tags: string[] }).tags;
}

describe("one compositor owns its canvas until a complete frame is copied", () => {
  it("does not turn an overlapping compound render into a blank frame", async () => {
    const pending = deferred<RenderedFrame>();
    const nested = vi
      .fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(nestedFrame("second source"));
    const engine = await compositor(nested);
    const first = engine.renderFrame(project(), 1);
    await vi.waitFor(() => expect(nested).toHaveBeenCalledOnce());
    const second = engine.renderFrame(project(), 2);
    await Promise.resolve();
    pending.resolve(nestedFrame("first source"));
    const [a, b] = await Promise.all([first, second]);
    expect(tags(a)).toEqual(["first source"]);
    expect(tags(b)).toEqual(["second source"]);
    expect(nested).toHaveBeenCalledTimes(2);
  });
  it("releases a failed render so the next complete compound frame can render", async () => {
    const pending = deferred<RenderedFrame>();
    const nested = vi
      .fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(nestedFrame("recovered source"));
    const engine = await compositor(nested);
    const first = engine.renderFrame(project(), 1);
    const failed = expect(first).rejects.toThrow("Decoder interrupted");
    await vi.waitFor(() => expect(nested).toHaveBeenCalledOnce());
    const second = engine.renderFrame(project(), 2);
    pending.reject(new Error("Decoder interrupted"));
    await failed;
    expect(tags(await second)).toEqual(["recovered source"]);
  });
});
