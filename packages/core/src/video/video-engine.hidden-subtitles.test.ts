import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Subtitle } from "../types";

const drawn: string[] = [];
vi.mock("../captions/caption-layout", async (orig) => ({
  ...(await orig<typeof import("../captions/caption-layout")>()),
  drawCaption: (_ctx: unknown, sub: Subtitle) => {
    drawn.push(sub.id);
  },
}));

beforeEach(() => {
  drawn.length = 0;
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

const cue = (id: string, hidden?: boolean): Subtitle =>
  ({ id, text: id, startTime: 0, endTime: 5, ...(hidden ? { hidden: true } : {}) }) as Subtitle;

describe("hidden caption cues", () => {
  it("renderFrame draws visible cues and skips hidden (translated) cues", async () => {
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
    Object.assign(engine, {
      ensureInitialized: vi.fn(),
      compositeCanvas: { width: 640, height: 360 },
      compositeCtx: ctx,
    });
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 640, height: 360, close: vi.fn() })));
    const project = {
      id: "p",
      name: "p",
      createdAt: 0,
      modifiedAt: 0,
      settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
      mediaLibrary: { items: [] },
      timeline: {
        tracks: [],
        duration: 5,
        subtitles: [cue("shown"), cue("translated", true)],
        markers: [],
      },
    } as unknown as Project;
    await engine.renderFrame(project, 1, 640, 360);
    expect(drawn).toEqual(["shown"]);
  });
});
