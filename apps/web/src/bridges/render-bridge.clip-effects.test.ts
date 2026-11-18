import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderBridge } from "./render-bridge";

const mocks = vi.hoisted(() => ({
  applyEffects: vi.fn(),
  project: vi.fn(),
  playhead: vi.fn(),
}));
vi.mock("../stores/engine-store", () => ({
  useEngineStore: { getState: () => ({ initialized: true, videoEngine: {} }), setState: vi.fn() },
}));
vi.mock("../stores/project-store", () => ({
  useProjectStore: { getState: mocks.project },
}));
vi.mock("../stores/timeline-store", () => ({
  useTimelineStore: { getState: () => ({ playheadPosition: mocks.playhead() }) },
}));
vi.mock("@openreel/core", async (original) => ({
  ...(await original<typeof import("@openreel/core")>()),
  getVideoEffectsEngine: () => ({ applyEffects: mocks.applyEffects }),
  createTransitionEngine: () => ({}),
}));

const frame = {} as ImageBitmap;
const vhs = { id: "fx", type: "vhs-glitch", enabled: true, params: { jitter: 6, time: 1 } };
let bridge: RenderBridge;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.applyEffects.mockImplementation(async (image: ImageBitmap) => ({ image }));
  mocks.project.mockReturnValue({
    project: {
      settings: { width: 100, height: 100 },
      timeline: {
        tracks: [{ clips: [{ id: "clip", startTime: 10, effects: [vhs], keyframes: [] }] }],
      },
    },
  });
  mocks.playhead.mockReturnValue(12.5);
  bridge = new RenderBridge();
  await bridge.initialize();
});

describe("RenderBridge.applyClipEffects clip-local time", () => {
  it("adds the explicit clip-local time to time-driven effects (VHS animates)", async () => {
    await bridge.applyClipEffects(frame, "clip", 2);
    const [, effects] = mocks.applyEffects.mock.calls[0];
    expect(effects[0].params.time).toBe(3);
    expect(vhs.params.time).toBe(1);
  });

  it("defaults to the playhead minus the clip start and never goes negative", async () => {
    await bridge.applyClipEffects(frame, "clip");
    expect(mocks.applyEffects.mock.calls[0][1][0].params.time).toBe(3.5);
    mocks.playhead.mockReturnValue(4);
    await bridge.applyClipEffects(frame, "clip");
    expect(mocks.applyEffects.mock.calls[1][1][0].params.time).toBe(1);
  });

  it("returns the frame untouched when the clip has no effects", async () => {
    mocks.project.mockReturnValue({
      project: { timeline: { tracks: [{ clips: [{ id: "clip", startTime: 0, effects: [] }] }] } },
    });
    expect(await bridge.applyClipEffects(frame, "clip", 1)).toBe(frame);
    expect(mocks.applyEffects).not.toHaveBeenCalled();
  });
});
