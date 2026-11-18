import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, Transition } from "@openreel/core";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import { TransitionInspector } from "./TransitionInspector";
import { useProjectStore } from "../../../stores/project-store";

const clip = (id: string, startTime: number): Clip => ({
  id,
  mediaId: `media-${id}`,
  trackId: "track-1",
  startTime,
  duration: 4,
  inPoint: 0,
  outPoint: 4,
  effects: [],
  audioEffects: [],
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
  volume: 1,
  keyframes: [],
});

describe("TransitionInspector directional transitions", () => {
  beforeEach(() => {
    const bridge = getTransitionBridge();
    if (!bridge.isInitialized()) bridge.initialize(320, 180);
  });

  it("does not remove a transition from a track locked after opening the inspector", () => {
    const store = useProjectStore.getState();
    store.createNewProject("Locked transitions");
    const track = useProjectStore.getState().project.timeline.tracks[0];
    const a = { ...clip("locked-a", 0), trackId: track.id };
    const b = { ...clip("locked-b", 4), trackId: track.id };
    const bridge = getTransitionBridge();
    const created = bridge.createTransition(a, b, "crossfade", 0.8, {});
    const transition = bridge.getTransition(created.transitionId!)!;
    const onTransitionRemove = vi.fn();
    render(<TransitionInspector clipA={a} clipB={b} transition={transition} onTransitionRemove={onTransitionRemove} />);
    act(() => { useProjectStore.setState((state) => ({ project: { ...state.project, timeline: {
      ...state.project.timeline, tracks: state.project.timeline.tracks.map((item) => item.id === track.id ? { ...item, locked: true } : item),
    } } })); });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onTransitionRemove).not.toHaveBeenCalled();
    expect(bridge.getTransition(transition.id)).toEqual(transition);
    bridge.removeTransition(transition.id);
  });

  it("authors an explicit clip-to-clip audio smoothing envelope", () => {
    const onTransitionUpdate = vi.fn();
    const transition: Transition = {
      id: "transition-audio",
      clipAId: "clip-a",
      clipBId: "clip-b",
      type: "crossfade",
      duration: 1,
      params: { curve: "ease" },
    };
    render(
      <TransitionInspector
        clipA={clip("clip-a", 0)}
        clipB={clip("clip-b", 4)}
        transition={transition}
        onTransitionUpdate={onTransitionUpdate}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Also blend audio (crossfade)" }),
    );
    expect(onTransitionUpdate).toHaveBeenCalledWith(transition.id, {
      params: { curve: "ease", audioFade: true },
    });
  });

  it("persists alignment and frame-accurate duration without dropping other parameters", () => {
    const onTransitionUpdate = vi.fn();
    const transition: Transition = {
      id: "t",
      clipAId: "a",
      clipBId: "b",
      type: "crossfade",
      duration: 1,
      params: { curve: "ease-in", audioFade: true },
    };
    render(
      <TransitionInspector
        clipA={clip("a", 0)}
        clipB={clip("b", 4)}
        transition={transition}
        onTransitionUpdate={onTransitionUpdate}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "End" }));
    expect(onTransitionUpdate).toHaveBeenLastCalledWith("t", {
      duration: 1,
      params: { curve: "ease-in", audioFade: true, alignment: "end" },
    });
    const duration = screen.getByRole("textbox", {
      name: "Transition duration",
    });
    fireEvent.change(duration, { target: { value: "00:00:00:15" } });
    fireEvent.blur(duration);
    expect(onTransitionUpdate).toHaveBeenLastCalledWith("t", { duration: 0.5 });
  });

});
