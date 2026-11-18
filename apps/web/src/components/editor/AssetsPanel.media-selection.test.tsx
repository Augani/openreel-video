import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import { AssetsPanel } from "./AssetsPanel";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useSourceMonitorStore } from "../../stores/source-monitor-store";

const media: MediaItem[] = ["First video", "Second video"].map((name, index) => ({
  id: `video-${index}`, name, type: "video", blob: null, fileHandle: null,
  thumbnailUrl: `blob:thumbnail-${index}`, waveformData: null,
  metadata: { duration: 5, width: 1920, height: 1080, frameRate: 30, codec: "vp9",
    sampleRate: 0, channels: 0, fileSize: 1024, hasVideo: true, hasAudio: false },
}));

describe("asset selection and insertion", () => {
  beforeEach(() => {
    const project = createEmptyProject("Media selection");
    useProjectStore.setState({ hasOpenProject: true, project: {
      ...project, settings: { ...project.settings, width: 1920, height: 1080 },
      mediaLibrary: { items: [...media] },
    } });
    useUIStore.getState().clearSelection();
    useTimelineStore.setState({ playheadPosition: 2 });
    useProjectStore.getState().actionExecutor.getHistory().clear();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); useUIStore.getState().clearSelection(); });

  it("refreshes the total through actual media deletion and Undo", async () => {
    const view = render(<AssetsPanel />);
    const footer = () => view.container.querySelector(".workspace-panel-footer");
    expect(footer()).toHaveTextContent("2 items · 2.0 KB");
    await act(async () => { await useProjectStore.getState().deleteMedia(media[1].id); });
    expect(footer()).toHaveTextContent("1 item · 1.0 KB");
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(footer()).toHaveTextContent("2 items · 2.0 KB");
  });

  it("keeps a populated media library idle during playback and inserts at the current time", async () => {
    const project = useProjectStore.getState().project;
    useProjectStore.setState({ project: { ...project, mediaLibrary: {
      items: Array.from({ length: 64 }, (_, index) => ({ ...media[0], id: `asset-${index}`, name: `Asset ${index}` })),
    } } });
    const insert = vi.spyOn(useProjectStore.getState(), "placeMediaClip").mockResolvedValue({ success: true });
    const commits = vi.fn();
    const view = render(<Profiler id="media-library" onRender={commits}><AssetsPanel /></Profiler>);
    commits.mockClear();
    for (let frame = 1; frame <= 60; frame++) {
      act(() => useTimelineStore.getState().setPlayheadPosition(2 + frame / 60));
    }
    act(() => useTimelineStore.getState().setPlayheadPosition(9.25));
    expect(commits).not.toHaveBeenCalled();
    // Double-click loads the Source monitor; it does not touch the timeline.
    fireEvent.doubleClick(view.getByRole("button", { name: "Select media Asset 0" }));
    expect(insert).not.toHaveBeenCalled();
    expect(useSourceMonitorStore.getState()).toMatchObject({ tab: "source", mediaId: "asset-0" });
    // The actions menu places it at the current time.
    fireEvent.keyDown(view.getByRole("button", { name: "Media actions for Asset 0" }), { key: "ArrowDown" });
    fireEvent.click(await view.findByRole("menuitem", { name: "Add to timeline" }));
    expect(insert).toHaveBeenCalledWith("asset-0", undefined, 9.25);
    fireEvent.click(view.getByRole("button", { name: "Select media Asset 1" }));
    expect(commits).toHaveBeenCalled();
  });
});
