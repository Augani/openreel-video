import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clip, Track } from "@openreel/core";
import { openContextMenu } from "../../../test/open-context-menu";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { ClipContextMenu } from "./ClipContextMenu";

const state = () => useProjectStore.getState();
const makeClip = (id: string): Clip => ({
  id, trackId: "main", mediaId: "source", startTime: 0, duration: 8, inPoint: 0, outPoint: 8,
  speed: 0.25, effects: [], audioEffects: [], keyframes: [], volume: 1,
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } },
});
const tracks = (): Track[] => [{ id: "main", type: "video", clips: [makeClip("a"), { ...makeClip("b"), startTime: 8 }], name: "main", transitions: [], locked: false, hidden: false, muted: false, solo: false }];

beforeEach(() => {
  state().createNewProject("Time interpolation menu");
  const project = state().project;
  useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, duration: 16, tracks: tracks() },
    mediaLibrary: { items: [{ id: "source", name: "Source.mp4", type: "video", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null,
      metadata: { duration: 20, width: 640, height: 360, frameRate: 25, sampleRate: 48000, channels: 2, codec: "h264", fileSize: 1 } }] } } });
  useTimelineStore.setState({ playbackLockedReason: null });
  useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  state().actionHistory.clear();
  state().actionHistory.setAutoGroupWindow(0);
});
afterEach(() => { cleanup(); useUIStore.getState().clearSelection(); });

describe("clip context menu: Time Interpolation", () => {
  it("lists the three modes with the current one checked and applies a choice to the selection as one undo step", async () => {
    useUIStore.getState().selectMultiple([{ type: "clip", id: "a" }, { type: "clip", id: "b" }]);
    const clip = state().getClip("a")!;
    openContextMenu(<ClipContextMenu clip={clip} track={state().project.timeline.tracks[0]} />);
    const trigger = await screen.findByTestId("clip-time-interpolation-menu");
    await act(async () => { fireEvent.keyDown(trigger, { key: "ArrowRight" }); fireEvent.click(trigger); });
    const sampling = await screen.findByRole("menuitemradio", { name: "Frame Sampling" });
    expect(sampling).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Frame Blending" })).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("menuitemradio", { name: "Optical Flow" })));
    await waitFor(() => expect(state().getClip("a")?.timeInterpolation).toBe("opticalFlow"));
    expect(state().getClip("b")?.timeInterpolation).toBe("opticalFlow");
    await act(async () => { await state().undo(); });
    expect(state().getClip("a")?.timeInterpolation).toBeUndefined();
    expect(state().getClip("b")?.timeInterpolation).toBeUndefined();
    expect(state().canUndo()).toBe(false);
    await act(async () => { await state().redo(); });
    expect(state().getClip("b")?.timeInterpolation).toBe("opticalFlow");
  });
});
