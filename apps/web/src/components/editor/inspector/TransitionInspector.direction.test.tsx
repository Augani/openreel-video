import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, Transition } from "@openreel/core";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import { TransitionInspector } from "./TransitionInspector";

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

  it.each(["push", "whipPan"] as const)(
    "exposes and persists direction for %s",
    (type) => {
      const onTransitionUpdate = vi.fn();
      const transition: Transition = {
        id: `transition-${type}`,
        clipAId: "clip-a",
        clipBId: "clip-b",
        type,
        duration: 0.8,
        params: { direction: "left" },
      };

      render(
        <TransitionInspector
          clipA={clip("clip-a", 0)}
          clipB={clip("clip-b", 4)}
          transition={transition}
          onTransitionUpdate={onTransitionUpdate}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Right" }));

      expect(onTransitionUpdate).toHaveBeenCalledWith(transition.id, {
        params: { direction: "right" },
      });
    },
  );

  it("exposes renderer-backed blur and radial wipe parameters", () => {
    const onTransitionUpdate = vi.fn();
    const transition: Transition = {
      id: "transition-radial",
      clipAId: "clip-a",
      clipBId: "clip-b",
      type: "radialWipe",
      duration: 0.8,
      params: { startAngle: -90, clockwise: true },
    };
    const view = render(
      <TransitionInspector
        clipA={clip("clip-a", 0)}
        clipB={clip("clip-b", 4)}
        transition={transition}
        onTransitionUpdate={onTransitionUpdate}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Clockwise" }));
    expect(onTransitionUpdate).toHaveBeenCalledWith(transition.id, {
      params: { startAngle: -90, clockwise: false },
    });

    view.rerender(
      <TransitionInspector
        clipA={clip("clip-a", 0)}
        clipB={clip("clip-b", 4)}
        transition={{ ...transition, type: "blur", params: { intensity: 1 } }}
        onTransitionUpdate={onTransitionUpdate}
      />,
    );
    expect(screen.getByText("Blur Strength")).toBeInTheDocument();
  });

  it.each(["zoom", "circleReveal", "diamondReveal"] as const)(
    "exposes focal center controls for %s",
    (type) => {
      const onTransitionUpdate = vi.fn();
      const transition: Transition = {
        id: `transition-${type}`,
        clipAId: "clip-a",
        clipBId: "clip-b",
        type,
        duration: 0.8,
        params: {
          ...(type === "zoom" ? { scale: 2 } : {}),
          center: { x: 0.5, y: 0.5 },
        },
      };
      render(
        <TransitionInspector
          clipA={clip("clip-a", 0)}
          clipB={clip("clip-b", 4)}
          transition={transition}
          onTransitionUpdate={onTransitionUpdate}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Edit Center X value" }));
      const input = screen.getByRole("textbox", { name: "Center X value" });
      fireEvent.change(input, { target: { value: "25" } });
      fireEvent.blur(input);

      expect(onTransitionUpdate).toHaveBeenCalledWith(transition.id, {
        params: {
          ...(type === "zoom" ? { scale: 2 } : {}),
          center: { x: 0.25, y: 0.5 },
        },
      });
    },
  );

  it("exposes Film Burn previews and renderer-backed controls", () => {
    render(
      <TransitionInspector
        clipA={clip("clip-a", 0)}
        clipB={clip("clip-b", 4)}
        transition={{
          id: "transition-film-burn",
          clipAId: "clip-a",
          clipBId: "clip-b",
          type: "filmBurn",
          duration: 0.8,
          params: { intensity: 1, warmth: 0.75 },
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Film Burn" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Burn Intensity")).toBeInTheDocument();
    expect(screen.getByText("Warmth")).toBeInTheDocument();
    const preview = screen
      .getByRole("button", { name: "Flash Cut" })
      .querySelector('[data-transition-preview="flash"]');
    expect(preview).toHaveAttribute("data-preview-progress", "0.45");
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
      screen.getByRole("switch", { name: "Smooth transition audio" }),
    );
    expect(onTransitionUpdate).toHaveBeenCalledWith(transition.id, {
      params: { curve: "ease", audioFade: true },
    });
  });
});
