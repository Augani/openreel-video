import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { KeyframableControl } from "./KeyframableControl";

const clipId = "c1";
function seed() {
  const p = createEmptyProject("t");
  const seeded = { ...p, timeline: { ...p.timeline, duration: 10, tracks: [{ id: "tr", type: "video", name: "v", clips: [{
    id: clipId, mediaId: "m", trackId: "tr", startTime: 2, duration: 8, inPoint: 0, outPoint: 8,
    effects: [], audioEffects: [], keyframes: [], volume: 1,
    transform: { position:{x:0,y:0}, scale:{x:1,y:1}, rotation:0, anchor:{x:0.5,y:0.5}, opacity:1 },
  }], transitions: [], locked:false, hidden:false, muted:false, solo:false }] } };
  useProjectStore.setState({ project: seeded as never });
  useTimelineStore.setState({ playheadPosition: 4 });
}

describe("KeyframableControl", () => {
  beforeEach(seed);
  afterEach(() => { cleanup(); useProjectStore.setState({ project: createEmptyProject("r") as never }); });

  it("enabling adds a keyframe at clip-local time with the canonical value", () => {
    render(<KeyframableControl clipId={clipId} property="transform.opacity" label="Opacity" value={100} onChange={() => {}} min={0} max={100} step={1} unit="%" displayScale={100} />);
    fireEvent.click(screen.getByRole("button", { name: /keyframe Opacity/i }));
    const kfs = useProjectStore.getState().getClip(clipId)!.keyframes;
    expect(kfs).toHaveLength(1);
    expect(kfs[0]).toMatchObject({ property: "transform.opacity", time: 2, value: 1 });
  });

  it("shows pressed state when already keyframed", () => {
    useProjectStore.getState().updateClipKeyframes(clipId, [{ id:"k", property:"transform.opacity", time:0, value:0.5, easing:"linear" }]);
    render(<KeyframableControl clipId={clipId} property="transform.opacity" label="Opacity" value={100} onChange={() => {}} min={0} max={100} step={1} unit="%" displayScale={100} />);
    expect(screen.getByRole("button", { name: /keyframe Opacity/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to a plain slider with no clipId/property", () => {
    render(<KeyframableControl label="Plain" value={5} onChange={() => {}} min={0} max={10} />);
    expect(screen.queryByRole("button", { name: /keyframe/i })).toBeNull();
  });
});
