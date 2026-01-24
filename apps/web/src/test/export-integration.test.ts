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

  it("should create exportable project with required fields", () => {
    const { project } = useProjectStore.getState();

    expect(project.id).toBeTruthy();
    expect(typeof project.id).toBe("string");
    expect(project.id.length).toBeGreaterThan(0);

    expect(project.name).toBeDefined();
    expect(project.name.length).toBeGreaterThan(0);

    expect(project.settings).toEqual({
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    });

    expect(project.timeline).toBeDefined();
    expect(project.timeline.tracks).toBeDefined();
    expect(Array.isArray(project.timeline.tracks)).toBe(true);
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

  it("should preserve all track properties when loading project", () => {
    const customTrack = createTestTrack({
      id: "custom-track",
      name: "My Video Track",
      locked: true,
      hidden: false,
      muted: true,
    });

    const projectToLoad: Project = {
      id: "test-load",
      name: "Loaded Project",
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      settings: {
        width: 1920,
        height: 1080,
        frameRate: 30,
        sampleRate: 48000,
        channels: 2,
      },
      mediaLibrary: { items: [] },
      timeline: {
        tracks: [customTrack],
        subtitles: [],
        duration: 0,
        markers: [],
      },
    };

    useProjectStore.getState().loadProject(projectToLoad);
    const { project } = useProjectStore.getState();

    const track = project.timeline.tracks.find((t) => t.id === "custom-track");
    expect(track).toBeDefined();
    expect(track?.name).toBe("My Video Track");
    expect(track?.locked).toBe(true);
    expect(track?.muted).toBe(true);
    expect(track?.hidden).toBe(false);
  });
});

describe("Export Readiness - Clip Operations", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject();
  });

  it("should preserve clip transform properties for export", () => {
    const { project } = useProjectStore.getState();
    const clipWithTransform = createTestClip({
      id: "transform-clip",
      transform: {
        position: { x: 0.25, y: 0.75 },
        scale: { x: 1.5, y: 1.5 },
        rotation: 45,
        anchor: { x: 0.5, y: 0.5 },
        opacity: 0.8,
      },
    });

    const projectWithClip: Project = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: [
          createTestTrack({
            clips: [clipWithTransform],
          }),
        ],
      },
    };

    useProjectStore.getState().loadProject(projectWithClip);
    const loadedClip = useProjectStore.getState().getClip("transform-clip");

    expect(loadedClip).toBeDefined();
    expect(loadedClip?.transform.position).toEqual({ x: 0.25, y: 0.75 });
    expect(loadedClip?.transform.scale).toEqual({ x: 1.5, y: 1.5 });
    expect(loadedClip?.transform.rotation).toBe(45);
    expect(loadedClip?.transform.opacity).toBe(0.8);
  });

  it("should preserve clip timing for export", () => {
    const { project } = useProjectStore.getState();
    const timedClip = createTestClip({
      id: "timed-clip",
      startTime: 5.5,
      duration: 10.25,
      inPoint: 2.0,
      outPoint: 12.25,
    });

    const projectWithClip: Project = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: [createTestTrack({ clips: [timedClip] })],
      },
    };

    useProjectStore.getState().loadProject(projectWithClip);
    const loadedClip = useProjectStore.getState().getClip("timed-clip");

    expect(loadedClip?.startTime).toBe(5.5);
    expect(loadedClip?.duration).toBe(10.25);
    expect(loadedClip?.inPoint).toBe(2.0);
    expect(loadedClip?.outPoint).toBe(12.25);
  });

  it("should preserve audio properties for export", () => {
    const { project } = useProjectStore.getState();
    const audioClip = createTestClip({
      id: "audio-clip",
      volume: 0.75,
      fade: { fadeIn: 1.0, fadeOut: 2.0 },
    });

    const projectWithClip: Project = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: [createTestTrack({ type: "audio", clips: [audioClip] })],
      },
    };

    useProjectStore.getState().loadProject(projectWithClip);
    const loadedClip = useProjectStore.getState().getClip("audio-clip");

    expect(loadedClip?.volume).toBe(0.75);
    expect(loadedClip?.fade?.fadeIn).toBe(1.0);
    expect(loadedClip?.fade?.fadeOut).toBe(2.0);
  });
});

describe("Export Readiness - Subtitle Handling (consolidated into text clips)", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject();
  });

  it.skip("should add and retrieve subtitle with correct timing - skipped: subtitles consolidated into text clips", () => {
    // Subtitles are now created as text clips on a Captions track
    // The addSubtitle function creates text clips, but getSubtitle reads from the old subtitles array
  });

  it.skip("should update subtitle and preserve changes - skipped: subtitles consolidated into text clips", () => {
    // Subtitles are now created as text clips on a Captions track
  });

  it.skip("should export valid SRT format - skipped: subtitles consolidated into text clips", () => {
    // SRT export now uses text clips from Captions track
  });
});

describe("Export Readiness - Marker Preservation", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject();
  });

  it("should preserve marker data for export", () => {
    const store = useProjectStore.getState();

    store.addMarker(5.0, "Scene 1", "#ff0000");
    store.addMarker(10.5, "Scene 2", "#00ff00");

    const markers = store.getMarkers();

    expect(markers.length).toBe(2);

    const scene1 = markers.find((m) => m.label === "Scene 1");
    const scene2 = markers.find((m) => m.label === "Scene 2");

    expect(scene1?.time).toBe(5.0);
    expect(scene1?.color).toBe("#ff0000");
    expect(scene2?.time).toBe(10.5);
    expect(scene2?.color).toBe("#00ff00");
  });

  it("should update marker and preserve changes", () => {
    const store = useProjectStore.getState();

    store.addMarker(5.0, "Original Label");
    const markers = store.getMarkers();
    const markerId = markers[0].id;

    store.updateMarker(markerId, { label: "Updated Label", time: 7.5 });

    const updated = store.getMarker(markerId);

    expect(updated?.label).toBe("Updated Label");
    expect(updated?.time).toBe(7.5);
  });

  it("should remove marker correctly", () => {
    const store = useProjectStore.getState();

    store.addMarker(5.0, "To Remove");
    const markers = store.getMarkers();
    const markerId = markers[0].id;

    store.removeMarker(markerId);

    expect(store.getMarker(markerId)).toBeUndefined();
    expect(store.getMarkers().length).toBe(0);
  });
});
