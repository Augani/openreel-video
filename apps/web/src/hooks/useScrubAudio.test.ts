import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScrubAudio, type ScrubAudioTarget } from "./useScrubAudio";
import { useScrubAudioStore } from "../stores/scrub-audio-store";

const setup = (initial: { scrubbing: boolean; position: number | null }) => {
  const graph: ScrubAudioTarget = {
    playScrubGrains: vi.fn(() => 1),
    stopScrubGrains: vi.fn(),
    resume: vi.fn(() => Promise.resolve()),
  };
  const getSchedules = vi.fn(() => []);
  let clock = 0;
  const hook = renderHook(
    (props: { scrubbing: boolean; position: number | null }) =>
      useScrubAudio({ ...props, getSchedules, getGraph: () => graph, now: () => clock }),
    { initialProps: initial },
  );
  return { graph, getSchedules, hook, tick: (seconds: number) => { clock += seconds; } };
};

describe("useScrubAudio", () => {
  beforeEach(() => {
    useScrubAudioStore.setState({ enabled: true });
  });

  it("is on by default", () => {
    expect(useScrubAudioStore.getState().enabled).toBe(true);
  });

  it("plays a grain per playhead move while scrubbing, rate limited", () => {
    const { graph, hook, tick } = setup({ scrubbing: true, position: 1 });
    expect(graph.playScrubGrains).toHaveBeenCalledTimes(1);
    expect(graph.playScrubGrains).toHaveBeenLastCalledWith([], 1);
    tick(0.01);
    hook.rerender({ scrubbing: true, position: 1.1 });
    expect(graph.playScrubGrains).toHaveBeenCalledTimes(1);
    tick(0.1);
    hook.rerender({ scrubbing: true, position: 1.2 });
    expect(graph.playScrubGrains).toHaveBeenCalledTimes(2);
  });

  it("plays nothing when not scrubbing, and stops the grains when scrubbing ends", () => {
    const { graph, hook, tick } = setup({ scrubbing: false, position: 1 });
    expect(graph.playScrubGrains).not.toHaveBeenCalled();
    expect(graph.stopScrubGrains).not.toHaveBeenCalled();
    hook.rerender({ scrubbing: true, position: 2 });
    expect(graph.playScrubGrains).toHaveBeenCalledTimes(1);
    tick(0.1);
    hook.rerender({ scrubbing: false, position: null });
    expect(graph.stopScrubGrains).toHaveBeenCalledTimes(1);
  });

  it("respects the user toggle", () => {
    useScrubAudioStore.setState({ enabled: false });
    const { graph, hook, tick } = setup({ scrubbing: true, position: 1 });
    tick(0.1);
    hook.rerender({ scrubbing: true, position: 2 });
    expect(graph.playScrubGrains).not.toHaveBeenCalled();
    act(() => useScrubAudioStore.getState().setEnabled(true));
    tick(0.1);
    hook.rerender({ scrubbing: true, position: 3 });
    expect(graph.playScrubGrains).toHaveBeenLastCalledWith([], 3);
  });
});
