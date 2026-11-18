import { describe, expect, it, vi } from "vitest";
import { PlaybackController } from "./playback-controller";
import { DEFAULT_PLAYBACK_CONFIG } from "./types";
import type { Project } from "../types";

function makeController(renderStillFrames: boolean) {
  // Skip the constructor: it creates a real AudioContext-backed master clock.
  const controller: PlaybackController = Object.create(PlaybackController.prototype);
  const renderFrame = vi.fn(async () => ({ image: { close: vi.fn() }, timestamp: 0, width: 4, height: 4 }));
  const masterClock = { seek: vi.fn(), reportVideoTime: vi.fn() };
  const audioGraph = { seekTo: vi.fn() };
  Object.assign(controller, {
    config: { ...DEFAULT_PLAYBACK_CONFIG, renderStillFrames },
    project: { timeline: { duration: 10 } } as unknown as Project,
    videoEngine: { renderFrame },
    masterClock,
    realtimeAudioGraph: audioGraph,
    state: "paused",
    eventListeners: new Map(),
    droppedFrameCounter: { increment: vi.fn() },
  });
  return { controller, renderFrame, masterClock, audioGraph };
}

describe("PlaybackController still frames on seek and scrub", () => {
  it("renders a frame per seek/scrub by default", async () => {
    const { controller, renderFrame } = makeController(true);
    await controller.seek(2);
    await controller.scrubTo(3);
    expect(renderFrame).toHaveBeenCalledTimes(2);
  });

  it("only moves the clock and audio when still frames are off", async () => {
    const { controller, renderFrame, masterClock, audioGraph } = makeController(false);
    const events: string[] = [];
    controller.addEventListener("seek", (e) => events.push(`seek@${e.time}`));
    await controller.seek(2);
    const scrub = await controller.scrubTo(3);
    expect(renderFrame).not.toHaveBeenCalled();
    expect(scrub).toEqual({ frame: null, renderTime: 0, fromCache: false, timedOut: false });
    expect(masterClock.seek).toHaveBeenCalledWith(2);
    expect(masterClock.seek).toHaveBeenCalledWith(3);
    expect(masterClock.reportVideoTime).toHaveBeenCalledWith(2);
    expect(audioGraph.seekTo).toHaveBeenCalledWith(3);
    expect(events).toEqual(["seek@2"]);
  });

  it("still renders when a display canvas can show the frame", async () => {
    const { controller, renderFrame } = makeController(false);
    controller.setDisplayCanvas({ getContext: () => ({ drawImage: vi.fn() }), width: 4, height: 4 } as unknown as HTMLCanvasElement);
    await controller.scrubTo(1);
    expect(renderFrame).toHaveBeenCalledTimes(1);
  });

  it("setRenderStillFrames flips the behavior at runtime", async () => {
    const { controller, renderFrame } = makeController(true);
    controller.setRenderStillFrames(false);
    await controller.scrubTo(1);
    expect(renderFrame).not.toHaveBeenCalled();
  });
});
