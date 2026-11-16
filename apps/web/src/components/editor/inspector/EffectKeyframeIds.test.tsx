import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clip, Effect } from "@openreel/core";
import { HslSecondarySection } from "./HslSecondarySection";
import { KeyframesSection } from "./KeyframesSection";
import { KeyframeTrack } from "../timeline/KeyframeTrack";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";

const secondary = (id: string): Effect => ({ id, type: "hsl-secondary" as Effect["type"], enabled: true, params: {} });
const blur = (id: string): Effect => ({ id, type: "blur", enabled: true, params: { radius: 3 } });

const base: Clip = {
  id: "video", trackId: "main", mediaId: "media", startTime: 10, duration: 10,
  inPoint: 0, outPoint: 10, volume: 1, effects: [], audioEffects: [], keyframes: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
};
const current = () => useProjectStore.getState().getClip(base.id)!;

function seed(effects: Effect[]) {
  useProjectStore.getState().createNewProject("Effect keyframe ids");
  const project = useProjectStore.getState().project;
  useProjectStore.setState({
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        duration: 20,
        tracks: [{
          id: "main", name: "Main", type: "video", transitions: [], locked: false, hidden: false, muted: false, solo: false,
          clips: [{ ...structuredClone(base), effects }],
        }],
      },
    },
  });
  useTimelineStore.setState({ playheadPosition: 12, playbackState: "stopped" });
}

afterEach(cleanup);

describe("HSL Secondary keyframes are instance keyed", () => {
  beforeEach(() => seed([secondary("s1"), secondary("s2")]));

  it("writes fx:<effectId>:<param> for the first secondary", () => {
    render(<HslSecondarySection clipId="video" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Keyframe saturation" })[0]!);
    expect(current().keyframes).toEqual([expect.objectContaining({ property: "fx:s1:saturation", time: 2 })]);
  });

  it("lets the second secondary animate independently", () => {
    render(<HslSecondarySection clipId="video" />);
    const buttons = screen.getAllByRole("button", { name: "Keyframe saturation" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    expect(current().keyframes.map((k) => k.property)).toEqual(["fx:s2:saturation"]);
  });
});

describe("KeyframesSection lists instance-keyed effect channels", () => {
  beforeEach(() => seed([blur("b1"), blur("b2")]));

  it("offers each effect copy separately and keyframes the chosen instance", async () => {
    render(<KeyframesSection clipId="video" />);
    fireEvent.click(screen.getByRole("button", { name: "Select Property" }));
    fireEvent.click(await screen.findByRole("button", { name: "Select Blur 2: Radius" }));
    fireEvent.click(screen.getByRole("button", { name: /Add Keyframe at/ }));
    await waitFor(() => expect(current().keyframes).toHaveLength(1));
    expect(current().keyframes[0]).toMatchObject({ property: "fx:b2:radius", value: 3 });
  });

  it("no longer offers type-keyed effect ids", async () => {
    render(<KeyframesSection clipId="video" />);
    fireEvent.click(screen.getByRole("button", { name: "Select Property" }));
    await screen.findByRole("button", { name: "Select Blur 1: Radius" });
    expect(screen.queryByRole("button", { name: "Select Brightness" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Select Blur" })).toBeNull();
  });
});

describe("KeyframesSection effect hint", () => {
  it("tells the user to add the effect first, with or without effects on the clip", async () => {
    for (const effects of [[], [blur("b1")]]) {
      seed(effects);
      const { unmount } = render(<KeyframesSection clipId="video" />);
      fireEvent.click(screen.getByRole("button", { name: "Select Property" }));
      const hint = await screen.findByTestId("keyframes-effect-hint");
      expect(hint.textContent).toMatch(/Add the effect first/);
      unmount();
    }
  });
});

describe("timeline keyframe lane labels", () => {
  it("names instance-keyed lanes after the effect and parameter", () => {
    seed([blur("b1"), blur("b2")]);
    const clip: Clip = {
      ...current(),
      keyframes: [{ id: "k", time: 1, property: "fx:b2:radius", value: 4, easing: "linear" }],
    };
    act(() => undefined);
    render(
      <KeyframeTrack clip={clip} pixelsPerSecond={50} selectedKeyframeIds={[]}
        onKeyframeSelect={() => undefined} onKeyframeMove={() => undefined} onKeyframeDelete={() => undefined} />,
    );
    expect(screen.getByText("Blur 2: Radius")).toBeTruthy();
  });
});
