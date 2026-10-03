import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasterTimelineClock } from "@openreel/core";
import { PlaybackBridge } from "./playback-bridge";
import { useTimelineStore } from "../stores/timeline-store";

const mocks = vi.hoisted(() => ({ engine: vi.fn(), project: vi.fn(), subscribe: vi.fn(() => vi.fn()) }));
vi.mock("../stores/engine-store", () => ({ useEngineStore: { getState: mocks.engine, setState: vi.fn() } }));
vi.mock("../stores/project-store", () => ({ useProjectStore: { getState: mocks.project, subscribe: mocks.subscribe } }));

let clock: MasterTimelineClock;
let bridge: PlaybackBridge;
let audioContext: { currentTime: number; state: string; resume: () => Promise<void> };
let audio: { seekTo: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.clearAllMocks();
  useTimelineStore.setState({ loopEnabled: false, loopStart: 0, loopEnd: 0, playheadPosition: 0, playbackState: "paused", isScrubbing: false });
  audioContext = { currentTime: 0, state: "running", resume: vi.fn(async () => {}) };
  clock = new MasterTimelineClock({ audioContext: audioContext as unknown as AudioContext });
  clock.setDuration(10);
  audio = { seekTo: vi.fn() };
  const controller = {
    setProject: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    getMasterClock: () => clock,
    getRealtimeAudioGraph: () => audio,
    getIsScrubbing: () => false,
    play: () => clock.play(),
    seek: async (time: number) => { clock.seek(time); },
  };
  mocks.engine.mockReturnValue({ initialized: true, playbackController: controller });
  mocks.project.mockReturnValue({ project: { timeline: { duration: 10 } }, getTimelineDuration: () => 10 });
  bridge = new PlaybackBridge();
  await bridge.initialize();
});
afterEach(() => {
  bridge.dispose();
  clock.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PlaybackBridge preview loops", () => {
  it("wraps the shared clock and reschedules audio at the marked in point", async () => {
    useTimelineStore.getState().setLoopRange(2, 4);
    useTimelineStore.getState().setLoopEnabled(true);
    await bridge.play();
    expect(clock.currentTime).toBe(2);
    clock.seek(3.9);
    audioContext.currentTime = 0.2;
    vi.advanceTimersByTime(20);
    expect(clock.currentTime).toBeCloseTo(2.1, 10);
    expect(useTimelineStore.getState().playbackState).toBe("playing");
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(2.1, 10);
    expect(audio.seekTo).toHaveBeenCalledWith(expect.closeTo(2.1, 10));
  });

  it("loops the full project and clamps out points to the project duration", async () => {
    useTimelineStore.getState().setLoopRange(-4, 50);
    useTimelineStore.getState().setLoopEnabled(true);
    await bridge.play();
    clock.seek(9.9);
    audioContext.currentTime = 0.3;
    vi.advanceTimersByTime(20);
    expect(clock.currentTime).toBeCloseTo(0.2, 10);
    expect(clock.isPlaying).toBe(true);
  });

  it.each([2.1, 6.1])("reschedules audio after a delayed tick skips %s seconds of looping", async (elapsed) => {
    useTimelineStore.getState().setLoopRange(2, 4);
    useTimelineStore.getState().setLoopEnabled(true);
    await bridge.play();
    clock.seek(2.1);
    audio.seekTo.mockClear();
    // Modulo time moves forward (2.1 to 2.2), although one or more complete
    // iterations elapsed. Backward-time detection alone misses this wrap.
    audioContext.currentTime = elapsed;
    vi.advanceTimersByTime(20);
    expect(clock.currentTime).toBeCloseTo(2.2, 10);
    expect(clock.loopIteration).toBe(Math.floor(elapsed / 2));
    expect(audio.seekTo).toHaveBeenCalledOnce();
    expect(audio.seekTo.mock.calls[0][0]).toBeCloseTo(2.2, 10);
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(2.2, 10);
  });

  it("preserves the visible position when looping is disabled mid-playback", async () => {
    useTimelineStore.getState().setLoopRange(2, 4);
    useTimelineStore.getState().setLoopEnabled(true);
    await bridge.play();
    clock.seek(3.9);
    audioContext.currentTime = 0.2;
    vi.advanceTimersByTime(20);
    useTimelineStore.getState().setLoopEnabled(false);
    expect(clock.currentTime).toBeCloseTo(2.1, 10);
    audioContext.currentTime = 0.5;
    expect(clock.currentTime).toBeCloseTo(2.4, 10);
  });

  it("does not reschedule audio for manual scrubbing", async () => {
    useTimelineStore.getState().setLoopRange(2, 4);
    useTimelineStore.getState().setLoopEnabled(true);
    await bridge.play();
    clock.seek(3.5);
    audio.seekTo.mockClear();
    useTimelineStore.setState({ isScrubbing: true });
    clock.seek(2.5);
    expect(audio.seekTo).not.toHaveBeenCalled();
  });

  it("removes loop subscriptions when the editor is disposed", async () => {
    useTimelineStore.getState().setLoopRange(2, 4);
    useTimelineStore.getState().setLoopEnabled(true);
    bridge.dispose();
    useTimelineStore.getState().setLoopEnabled(false);
    useTimelineStore.getState().setLoopEnabled(true);
    await clock.play();
    clock.seek(9.9);
    audioContext.currentTime = 0.2;
    vi.advanceTimersByTime(20);
    expect(clock.isPlaying).toBe(false);
    expect(audio.seekTo).not.toHaveBeenCalled();
  });
});
