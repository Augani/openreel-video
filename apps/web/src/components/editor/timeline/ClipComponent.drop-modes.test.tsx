import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, MediaItem, Track } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { Timeline } from "../Timeline";

const mk = (id: string, startTime: number, duration: number): Clip => ({
  id, mediaId: "source", trackId: "main", startTime, duration, inPoint: 0, outPoint: duration,
  volume: 1, effects: [], audioEffects: [], keyframes: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
});
const media: MediaItem = {
  id: "source", name: "Source.mp4", type: "video", fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration: 20, width: 640, height: 360, frameRate: 30, codec: "h264", fileSize: 0, sampleRate: 0, channels: 0 },
};

beforeEach(() => {
  useEditorWorkspaceStore.setState({ linkedSelection: false });
  const base = createEmptyProject("Drop modes");
  // A: 0-4 (dragged), B: 5-9 (underneath after the drag), C: 10-14 (later clip).
  const track: Track = {
    id: "main", name: "Main", type: "video", clips: [mk("a", 0, 4), mk("b", 5, 4), mk("c", 10, 4)],
    transitions: [], locked: false, hidden: false, muted: false, solo: false,
  };
  useProjectStore.getState().loadProject({ ...base, timeline: { ...base.timeline, tracks: [track] }, mediaLibrary: { items: [media] } });
  useUIStore.setState({ selectedItems: [] });
  useUIStore.setState({ snapSettings: { ...useUIStore.getState().snapSettings, enabled: false } });
  useTimelineStore.setState({ pixelsPerSecond: 50, scrollX: 0, scrollY: 0, playheadPosition: 0, viewportWidth: 1000, viewportHeight: 100, playbackLockedReason: null });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return this.hasAttribute("data-timeline-clip") ? new DOMRect(0, 4, 200, 60) : new DOMRect(0, 0, 1000, 100);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function dragA(modifiers: { altKey?: boolean; metaKey?: boolean }) {
  render(<Timeline />);
  const button = screen.getAllByRole("button", { name: "Select clip Source.mp4" })[0];
  fireEvent.mouseDown(button, { button: 0, clientX: 20, clientY: 20 });
  fireEvent.mouseMove(window, { buttons: 1, clientX: 120, clientY: 20 });
  await waitFor(() => expect(useProjectStore.getState().getClip("a")?.startTime).toBe(2));
  fireEvent.mouseMove(window, { buttons: 1, clientX: 220, clientY: 20 });
  await waitFor(() => expect(useProjectStore.getState().getClip("a")?.startTime).toBe(4));
  await act(async () => { fireEvent.mouseUp(window, { button: 0, clientX: 220, clientY: 20, ...modifiers }); });
  await waitFor(() => expect(document.querySelector(".cursor-grabbing")).toBeNull());
}
const spans = () =>
  [...useProjectStore.getState().getFullProject().timeline.tracks.find((t) => t.id === "main")!.clips]
    .map((c) => [c.startTime, +(c.startTime + c.duration).toFixed(6)])
    .sort((x, y) => x[0] - y[0]);
const noOverlap = () => {
  const s = spans();
  for (let i = 1; i < s.length; i++) expect(s[i][0]).toBeGreaterThanOrEqual(s[i - 1][1] - 1e-6);
};

describe("timeline clip drop modes (real project store)", () => {

  it("overwrites by default and undoes in one step", async () => {
    await dragA({});
    noOverlap();
    expect(spans()).toEqual([[4, 8], [8, 9], [10, 14]]);
    expect(useProjectStore.getState().actionHistory.getDisplayHistory()).toHaveLength(1);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(spans()).toEqual([[0, 4], [5, 9], [10, 14]]);
  });

  it("inserts with Cmd held, rippling later clips, and undoes in one step", async () => {
    await dragA({ metaKey: true });
    noOverlap();
    expect(useProjectStore.getState().getClip("a")?.startTime).toBe(4);
    expect(spans().at(-1)).toEqual([14, 18]);
    expect(useProjectStore.getState().actionHistory.getDisplayHistory()).toHaveLength(1);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(spans()).toEqual([[0, 4], [5, 9], [10, 14]]);
  });

  it("copies with Alt held, leaving the original and resolving overlaps", async () => {
    await dragA({ altKey: true });
    noOverlap();
    expect(useProjectStore.getState().getClip("a")?.startTime).toBe(0);
    expect(spans()).toEqual([[0, 4], [4, 8], [8, 9], [10, 14]]);
  });

  const loadWithAudio = (extraVideo: Clip[] = []) => {
    const project = useProjectStore.getState().getFullProject();
    const audio: Track = {
      id: "audio", name: "Audio", type: "audio",
      clips: [{ ...mk("a-audio", 0, 4), trackId: "audio", metadata: { separatedFromClipId: "a" } } as Clip],
      transitions: [], locked: false, hidden: false, muted: false, solo: false,
    };
    const [main] = project.timeline.tracks;
    useProjectStore.getState().loadProject({
      ...project,
      timeline: { ...project.timeline, tracks: [{ ...main, clips: [...main.clips, ...extraVideo] }, audio] },
    });
  };
  const startOf = (id: string) => useProjectStore.getState().getClip(id)?.startTime;

  it("drags a linked A/V pair together and undoes both in one step", async () => {
    loadWithAudio();
    useEditorWorkspaceStore.setState({ linkedSelection: true });
    useUIStore.setState({ selectedItems: [{ id: "a", trackId: "main", type: "clip" }] });
    await dragA({});
    expect(startOf("a")).toBe(4);
    expect(startOf("a-audio")).toBe(4);
    noOverlap();
    expect(spans()).toEqual([[4, 8], [8, 9], [10, 14]]);
    expect(useProjectStore.getState().actionHistory.getDisplayHistory()).toHaveLength(1);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(startOf("a")).toBe(0);
    expect(startOf("a-audio")).toBe(0);
  });

  it("leaves the partner behind when linked selection is off", async () => {
    loadWithAudio();
    useUIStore.setState({ selectedItems: [{ id: "a", trackId: "main", type: "clip" }] });
    await dragA({});
    expect(startOf("a")).toBe(4);
    expect(startOf("a-audio")).toBe(0);
  });

  it("drags a multi-clip selection together without overlaps", async () => {
    useUIStore.setState({ selectedItems: [
      { id: "a", trackId: "main", type: "clip" },
      { id: "c", trackId: "main", type: "clip" },
    ] });
    await dragA({});
    expect(startOf("a")).toBe(4);
    expect(startOf("c")).toBe(14);
    noOverlap();
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(spans()).toEqual([[0, 4], [5, 9], [10, 14]]);
  });
});
