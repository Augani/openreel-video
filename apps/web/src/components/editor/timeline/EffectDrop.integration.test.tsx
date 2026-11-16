import "../../../test/install-local-storage-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Clip, Track, MediaItem } from "@openreel/core";
import { EffectsPanel } from "../panels/EffectsTransitionsPanel";
import { Timeline } from "../Timeline";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useInspectorNavigationStore } from "../../../stores/inspector-navigation-store";
import { useNotificationStore } from "../../../stores/notification-store";

afterEach(cleanup);
describe("effect tile to real timeline clip", () => {
  it.each([
    { tile: "LUT · Warm", plainTextOnly: false },
    { tile: "Stabilize", plainTextOnly: false },
    { tile: "LUT · Warm", plainTextOnly: true },
    { tile: "Stabilize", plainTextOnly: true },
  ])("carries $tile through the real drop handlers (plain-text transport: $plainTextOnly)", async ({ tile, plainTextOnly }) => {
    useProjectStore.getState().createNewProject("Effect drop QA");
    useUIStore.getState().clearSelection();
    useInspectorNavigationStore.getState().clearRequest();
    useNotificationStore.getState().clearAll();
    const project = useProjectStore.getState().project;
    const clip: Clip = {
      id: "clip",
      mediaId: "media",
      trackId: "main",
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      volume: 1,
      keyframes: [],
      effects: [],
      audioEffects: [],
      transform: {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        anchor: { x: 0.5, y: 0.5 },
        rotation: 0,
        opacity: 1,
      },
    };
    const track: Track = {
      id: "main",
      name: "Main",
      type: "video",
      clips: [clip],
      transitions: [],
      locked: false,
      muted: false,
      hidden: false,
      solo: false,
    };
    const media: MediaItem = {
      id: "media",
      name: "Source.mp4",
      type: "video",
      fileHandle: null,
      blob: null,
      thumbnailUrl: null,
      waveformData: null,
      metadata: {
        duration: 5,
        width: 640,
        height: 360,
        frameRate: 30,
        codec: "h264",
        sampleRate: 48000,
        channels: 2,
        fileSize: 0,
      },
    };
    useProjectStore.setState({
      project: {
        ...project,
        mediaLibrary: { items: [media] },
        timeline: { ...project.timeline, duration: 5, tracks: [track] },
      },
    });
    render(
      <>
        <EffectsPanel />
        <Timeline />
      </>,
    );
    const payloads = new Map<string, string>();
    let protectedDrag = false;
    const transfer = {
      effectAllowed: "none",
      dropEffect: "none",
      types: [] as string[],
      setData(type: string, value: string) {
        payloads.set(type, value);
        this.types = Array.from(payloads.keys());
      },
      getData(type: string) {
        // Browsers hide payload data during drag-over. Some transports also
        // expose only the compatibility type until the actual drop.
        if (protectedDrag || (plainTextOnly && type !== "text/plain")) return "";
        return payloads.get(type) ?? "";
      },
    };
    fireEvent.dragStart(screen.getByRole("button", { name: new RegExp(`^${tile}\\.`) }), {
      dataTransfer: transfer,
    });
    const target = screen.getByRole("button", {
      name: "Select clip Source.mp4",
    });
    if (plainTextOnly) transfer.types = ["text/plain"];
    protectedDrag = true;
    expect(fireEvent.dragOver(target, { dataTransfer: transfer })).toBe(false);
    expect(transfer.dropEffect).toBe("copy");
    protectedDrag = false;
    const beforeDrop = useProjectStore.getState().project;
    await act(async () => { fireEvent.drop(target, { dataTransfer: transfer }); });
    if (tile === "Stabilize") {
      expect(useInspectorNavigationStore.getState().request).toMatchObject({ clipId: clip.id, sectionId: "stabilization" });
      expect(useUIStore.getState().getSelectedClipIds()).toEqual([clip.id]);
      expect(useProjectStore.getState().project).toBe(beforeDrop);
      expect(useProjectStore.getState().canUndo()).toBe(false);
      expect(useNotificationStore.getState().notifications).toEqual([]);
      expect(screen.queryByRole("img", { name: "Video effects configured" })).toBeNull();
      return;
    }
    await waitFor(() =>
      expect(
        useProjectStore.getState().getClip(clip.id)?.colorGrading?.lut?.size,
      ).toBe(17),
    );
    expect(useUIStore.getState().getSelectedClipIds()).toEqual([clip.id]);
    expect(screen.getByRole("img", { name: "Video effects configured" })).toHaveTextContent("fx");
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(
      useProjectStore.getState().getClip(clip.id)?.colorGrading,
    ).toBeUndefined();
    expect(screen.queryByRole("img", { name: "Video effects configured" })).toBeNull();
  });
});
