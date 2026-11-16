import { describe, it, expect, beforeEach, vi } from "vitest";
import { useProjectStore } from "../stores/project-store";
import type { Project, Clip, Track } from "@openreel/core";

vi.mock("../services/auto-save", () => ({
  autoSaveManager: {
    startAutoSave: vi.fn(),
    stopAutoSave: vi.fn(),
    triggerSave: vi.fn(),
    getRecentSaves: vi.fn().mockResolvedValue([]),
    loadSave: vi.fn(),
    deleteSave: vi.fn(),
  },
  initializeAutoSave: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../bridges/media-bridge", () => ({
  getMediaBridge: vi.fn(() => ({
    isInitialized: vi.fn().mockReturnValue(true),
    importFile: vi.fn().mockResolvedValue({
      success: true,
      media: {
        id: "test-media-id",
        name: "test-video.mp4",
        type: "video",
        metadata: {
          duration: 10,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 1000000,
        },
      },
    }),
  })),
  initializeMediaBridge: vi.fn().mockResolvedValue(undefined),
}));

const createTestClip = (overrides?: Partial<Clip>): Clip => ({
  id: `clip-${Date.now()}`,
  mediaId: "media-1",
  trackId: "track-1",
  startTime: 0,
  duration: 5,
  inPoint: 0,
  outPoint: 5,
  effects: [],
  audioEffects: [],
  transform: {
    position: { x: 0.5, y: 0.5 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
  volume: 1,
  keyframes: [],
  ...overrides,
});

const createTestTrack = (overrides?: Partial<Track>): Track => ({
  id: "track-1",
  type: "video",
  name: "Video 1",
  clips: [],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...overrides,
});

describe("Export Readiness - Project Validation", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject();
  });

  it("should calculate correct timeline duration from clips", () => {
    const store = useProjectStore.getState();
    const { project } = store;

    const projectWithClips: Project = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: [
          createTestTrack({
            id: "track-1",
            clips: [
              createTestClip({ id: "c1", startTime: 0, duration: 10 }),
              createTestClip({ id: "c2", startTime: 10, duration: 5 }),
            ],
          }),
          createTestTrack({
            id: "track-2",
            type: "audio",
            clips: [createTestClip({ id: "c3", startTime: 5, duration: 20 })],
          }),
        ],
        duration: 25,
      },
    };

    store.loadProject(projectWithClips);
    const duration = store.getTimelineDuration();

    expect(duration).toBe(25);
  });

  it("should return zero duration for empty timeline", () => {
    const duration = useProjectStore.getState().getTimelineDuration();
    expect(duration).toBe(0);
  });

  it("should apply custom project settings correctly", () => {
    useProjectStore.getState().createNewProject("4K Project", {
      width: 3840,
      height: 2160,
      frameRate: 60,
    });

    const { project } = useProjectStore.getState();

    expect(project.name).toBe("4K Project");
    expect(project.settings.width).toBe(3840);
    expect(project.settings.height).toBe(2160);
    expect(project.settings.frameRate).toBe(60);
    expect(project.settings.sampleRate).toBe(48000);
    expect(project.settings.channels).toBe(2);
  });

});

describe("Export Readiness - Marker Preservation", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject();
  });

  it("should preserve marker data for export", async () => {
    const store = useProjectStore.getState();

    await store.addMarker(5.0, "Scene 1", "#ff0000");
    await store.addMarker(10.5, "Scene 2", "#00ff00");

    const markers = store.getMarkers();

    expect(markers.length).toBe(2);

    const scene1 = markers.find((m) => m.label === "Scene 1");
    const scene2 = markers.find((m) => m.label === "Scene 2");

    expect(scene1?.time).toBe(5.0);
    expect(scene1?.color).toBe("#ff0000");
    expect(scene2?.time).toBe(10.5);
    expect(scene2?.color).toBe("#00ff00");
  });

  it("should update marker and preserve changes", async () => {
    const store = useProjectStore.getState();

    await store.addMarker(5.0, "Original Label");
    const markers = store.getMarkers();
    const markerId = markers[0].id;

    await store.updateMarker(markerId, { label: "Updated Label", time: 7.5 });

    const updated = store.getMarker(markerId);

    expect(updated?.label).toBe("Updated Label");
    expect(updated?.time).toBe(7.5);
  });

  it("should remove marker correctly", async () => {
    const store = useProjectStore.getState();

    await store.addMarker(5.0, "To Remove");
    const markers = store.getMarkers();
    const markerId = markers[0].id;

    await store.removeMarker(markerId);

    expect(store.getMarker(markerId)).toBeUndefined();
    expect(store.getMarkers().length).toBe(0);
  });
});
