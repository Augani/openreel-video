import "../../../test/install-local-storage-mock";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Clip, Transition } from "@openreel/core";
import { TransitionHandle } from "./TransitionHandle";
import type { ResolvedTransitionHandle } from "./transition-handles";

function makeHandle(): ResolvedTransitionHandle {
  return {
    transition: {
      id: "tr-1",
      clipAId: "a",
      clipBId: "b",
      type: "crossfade",
      duration: 1.5,
      params: {},
    } as Transition,
    clipA: { id: "a", startTime: 0, duration: 2 } as unknown as Clip,
    clipB: { id: "b", startTime: 2, duration: 2 } as unknown as Clip,
    centerX: 100,
  };
}

function makeEdgeHandle(): ResolvedTransitionHandle {
  return {
    transition: {
      id: "tr-out",
      clipAId: "a",
      edge: "out",
      type: "crossfade",
      duration: 1,
      params: {},
    } as Transition,
    clipA: { id: "a", startTime: 0, duration: 2 } as unknown as Clip,
    edge: "out",
    centerX: 100,
  };
}

describe("TransitionHandle", () => {
  it("renders a labeled button positioned on the cut", () => {
    render(
      <TransitionHandle
        handle={makeHandle()}
        trackId="track-1"
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: /crossfade/i });
    expect(button).toBeTruthy();
    expect(button.getAttribute("title")).toContain("1.5s");
  });

  it("calls onSelect with transition id and track id on click", () => {
    const onSelect = vi.fn();
    render(
      <TransitionHandle
        handle={makeHandle()}
        trackId="track-1"
        isSelected={false}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /crossfade/i }));
    expect(onSelect).toHaveBeenCalledWith("tr-1", "track-1");
  });

  it("opens a transition picker menu on click", () => {
    render(
      <TransitionHandle
        handle={makeHandle()}
        trackId="track-1"
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /crossfade/i }));
    expect(screen.getByText("Remove transition")).toBeTruthy();
    expect(screen.getByText("Dip to Black")).toBeTruthy();
    expect(screen.getByText("Wipe")).toBeTruthy();
  });

  it("labels single-clip edge transitions by edge", () => {
    render(
      <TransitionHandle
        handle={makeEdgeHandle()}
        trackId="track-1"
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /outro transition/i }),
    ).toBeTruthy();
  });
});
