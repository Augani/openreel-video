import { describe, it, expect, beforeEach, vi } from "vitest";
import { useProjectStore } from "./project-store";
import { useEngineStore } from "./engine-store";
import type {
  Project,
  Clip,
  MediaItem,
  MotionShaderDef,
  Transition,
} from "@openreel/core";
import {
  clearGeneratedMotionShaders,
  getMotionShaderDef,
  listGeneratedMotionShaders,
} from "@openreel/core/motion/shaders";
import { createEmptyProject } from "./project/project-helpers";

const {
  mockEffectsBridge,
  mockEffectsBridgeState,
  mockTransitionBridge,
  mockTransitionBridgeState,
} = vi.hoisted(() => {
  const clipEffects = new Map<string, Array<{
    id: string;
    type: string;
    enabled: boolean;
    params: Record<string, unknown>;
    order: number;
  }>>();

  const getDefaultParams = (effectType: string): Record<string, unknown> => {
    switch (effectType) {
      case "brightness":
        return { value: 0 };
      case "contrast":
        return { value: 1 };
      case "saturation":
        return { value: 1 };
      case "blur":
        return { radius: 0, type: "gaussian" };
      default:
        return {};
    }
  };

  const effectsBridge = {
    isInitialized: vi.fn(() => true),
    applyVideoEffect: vi.fn(
      (clipId: string, effectType: string, params: Record<string, unknown> = {}) => {
        const effects = clipEffects.get(clipId) || [];
        const effect = {
          id: `effect-${effects.length + 1}`,
          type: effectType,
          enabled: true,
          params: { ...getDefaultParams(effectType), ...params },
          order: effects.length,
        };
        clipEffects.set(clipId, [...effects, effect]);
        return { success: true, effectId: effect.id };
      },
    ),
    getEffects: vi.fn((clipId: string) => [...(clipEffects.get(clipId) || [])]),
    getEffect: vi.fn((clipId: string, effectId: string) =>
      (clipEffects.get(clipId) || []).find((effect) => effect.id === effectId),
    ),
    deserializeEffects: vi.fn(
      (
        clipId: string,
        data: {
          effects: Array<{
            id: string;
            type: string;
            enabled: boolean;
            params: Record<string, unknown>;
            order: number;
          }>;
        },
      ) => {
        clipEffects.set(
          clipId,
          data.effects.map((effect) => ({ ...effect })),
        );
        return { success: true };
      },
    ),
    clearEffects: vi.fn((clipId: string) => {
      clipEffects.delete(clipId);
    }),
    getColorGrading: vi.fn(() => ({})),
  };

  const trackTransitions = new Map<string, Transition[]>();
  const transitionBridge = {
    isInitialized: vi.fn(() => true),
    setTransitionsForTrack: vi.fn(
      (trackId: string, transitions: Transition[]) => {
        trackTransitions.set(
          trackId,
          transitions.map((transition) => ({
            ...transition,
            params: { ...transition.params },
          })),
        );
      },
    ),
    clearTransitionsForTrack: vi.fn((trackId: string) => {
      trackTransitions.delete(trackId);
    }),
  };

  return {
    mockEffectsBridge: effectsBridge,
    mockEffectsBridgeState: { clipEffects },
    mockTransitionBridge: transitionBridge,
    mockTransitionBridgeState: { trackTransitions },
  };
});

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
        id: "mock-media-id",
        name: "test-video.mp4",
        type: "video",
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
      },
    }),
  })),
  initializeMediaBridge: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../bridges/effects-bridge", () => ({
  getEffectsBridge: vi.fn(() => mockEffectsBridge),
}));

vi.mock("../bridges/transition-bridge", () => ({
  getTransitionBridge: vi.fn(() => mockTransitionBridge),
}));

describe("ProjectStore", () => {
  beforeEach(() => {
    mockEffectsBridgeState.clipEffects.clear();
    mockTransitionBridgeState.trackTransitions.clear();
    useProjectStore.getState().createNewProject();
  });

  describe("project creation", () => {
    it("should create a new project with default settings", () => {
      const { project } = useProjectStore.getState();

      expect(project).toBeDefined();
      expect(project.name).toBeDefined();
      expect(project.name.length).toBeGreaterThan(0);
      expect(project.settings.width).toBe(1920);
      expect(project.settings.height).toBe(1080);
      expect(project.settings.frameRate).toBe(30);
    });

    it("should create project with custom name", () => {
      useProjectStore.getState().createNewProject("My Custom Project");
      const { project } = useProjectStore.getState();

      expect(project.name).toBe("My Custom Project");
    });

    it("should create project with custom settings", () => {
      useProjectStore.getState().createNewProject("4K Project", {
        width: 3840,
        height: 2160,
        frameRate: 60,
      });
      const { project } = useProjectStore.getState();

      expect(project.settings.width).toBe(3840);
      expect(project.settings.height).toBe(2160);
      expect(project.settings.frameRate).toBe(60);
    });

    it("should create project with empty timeline", () => {
      const { project } = useProjectStore.getState();

      expect(project.timeline).toBeDefined();
      expect(project.timeline.tracks).toBeDefined();
      expect(Array.isArray(project.timeline.tracks)).toBe(true);
    });

    it("should have unique project id", () => {
      const firstProject = useProjectStore.getState().project;
      useProjectStore.getState().createNewProject();
      const secondProject = useProjectStore.getState().project;

      expect(firstProject.id).not.toBe(secondProject.id);
    });

    it("should reset action history on new project", () => {
      const store = useProjectStore.getState();
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);
    });
  });

  describe("requireOpenProject guard", () => {
    it("rejects executeAction when no project is open", async () => {
      useProjectStore.setState({ hasOpenProject: false });
      const result = await useProjectStore.getState().executeAction({
        type: "track/add",
        id: "guard-1",
        timestamp: Date.now(),
        params: { trackType: "video" },
      });
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("No project is open");
    });

    it("allows executeAction when a project is open", async () => {
      const result = await useProjectStore.getState().executeAction({
        type: "track/add",
        id: "guard-2",
        timestamp: Date.now(),
        params: { trackType: "video" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("text overlay clips (project-authoritative)", () => {
    async function addTextTrack(): Promise<string> {
      await useProjectStore.getState().addTrack("text");
      const track = useProjectStore
        .getState()
        .project.timeline.tracks.find((t) => t.type === "text");
      if (!track) throw new Error("text track not created");
      return track.id;
    }

    it("createTextClip writes to project.textClips and is undoable/redoable", async () => {
      const trackId = await addTextTrack();
      const clip = useProjectStore.getState().createTextClip(trackId, 0, "Hello", 5);
      expect(clip).toBeTruthy();
      const id = clip!.id;

      expect(useProjectStore.getState().project.textClips?.some((c) => c.id === id)).toBe(true);
      expect(useProjectStore.getState().getAllTextClips().some((c) => c.id === id)).toBe(true);
      expect(useProjectStore.getState().project.timeline.duration).toBe(5);

      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.textClips?.some((c) => c.id === id) ?? false).toBe(false);
      expect(useProjectStore.getState().getAllTextClips().some((c) => c.id === id)).toBe(false);
      expect(useProjectStore.getState().project.timeline.duration).toBe(0);

      await useProjectStore.getState().redo();
      expect(useProjectStore.getState().project.textClips?.some((c) => c.id === id)).toBe(true);
      expect(useProjectStore.getState().getAllTextClips().some((c) => c.id === id)).toBe(true);
      expect(useProjectStore.getState().project.timeline.duration).toBe(5);
    });

    it("updateTextContent is undoable and restores the prior text", async () => {
      const trackId = await addTextTrack();
      const clip = useProjectStore.getState().createTextClip(trackId, 0, "First", 5)!;

      useProjectStore.getState().updateTextContent(clip.id, "Second");
      expect(useProjectStore.getState().project.textClips?.find((c) => c.id === clip.id)?.text).toBe("Second");
      expect(useProjectStore.getState().getAllTextClips().find((c) => c.id === clip.id)?.text).toBe("Second");

      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.textClips?.find((c) => c.id === clip.id)?.text).toBe("First");
      expect(useProjectStore.getState().getAllTextClips().find((c) => c.id === clip.id)?.text).toBe("First");
    });

    it("deleteTextClip is undoable", async () => {
      const trackId = await addTextTrack();
      const clip = useProjectStore.getState().createTextClip(trackId, 0, "Bye", 5)!;

      useProjectStore.getState().deleteTextClip(clip.id);
      expect(useProjectStore.getState().project.textClips?.some((c) => c.id === clip.id) ?? false).toBe(false);
      expect(useProjectStore.getState().project.timeline.duration).toBe(0);

      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.textClips?.some((c) => c.id === clip.id)).toBe(true);
      expect(useProjectStore.getState().getAllTextClips().some((c) => c.id === clip.id)).toBe(true);
      expect(useProjectStore.getState().project.timeline.duration).toBe(5);
    });

    it("places duplicated text clips in the next available timeline gap", async () => {
      const trackId = await addTextTrack();
      const first = useProjectStore
        .getState()
        .createTextClip(trackId, 0, "First", 5)!;
      useProjectStore.getState().createTextClip(trackId, 5, "Occupied", 3);

      const duplicate = useProjectStore
        .getState()
        .duplicateOverlayClip(first.id);

      expect(duplicate).toBeTruthy();
      expect(duplicate?.startTime).toBe(8);
      expect(duplicate?.duration).toBe(5);
    });

    it("persists overlay timing edits and restores them with undo", async () => {
      const trackId = await addTextTrack();
      const clip = useProjectStore
        .getState()
        .createTextClip(trackId, 1, "Move me", 5)!;

      useProjectStore.getState().updateOverlayClipTiming(clip.id, {
        startTime: 3,
        duration: 2,
      });

      expect(useProjectStore.getState().getTextClip(clip.id)?.startTime).toBe(3);
      expect(
        useProjectStore.getState().project.textClips?.find((item) => item.id === clip.id),
      ).toMatchObject({ startTime: 3, duration: 2 });

      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().getTextClip(clip.id)).toMatchObject({
        startTime: 1,
        duration: 5,
      });
    });

    it("splits an overlay into two clips and undoes the split as one action", async () => {
      const trackId = await addTextTrack();
      const clip = useProjectStore
        .getState()
        .createTextClip(trackId, 0, "Split me", 5)!;

      const split = useProjectStore.getState().splitOverlayClip(clip.id, 2);

      expect(split?.left).toMatchObject({ startTime: 0, duration: 2 });
      expect(split?.right).toMatchObject({ startTime: 2, duration: 3 });
      expect(useProjectStore.getState().project.textClips).toHaveLength(2);

      const modifiedBeforeUndo = useProjectStore.getState().project.modifiedAt;
      await new Promise((resolve) => setTimeout(resolve, 2));
      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.textClips).toHaveLength(1);
      expect(useProjectStore.getState().getAllTextClips()).toHaveLength(1);
      expect(useProjectStore.getState().project.modifiedAt).toBeGreaterThan(
        modifiedBeforeUndo,
      );
      expect(useProjectStore.getState().getTextClip(clip.id)).toMatchObject({
        startTime: 0,
        duration: 5,
      });

      await useProjectStore.getState().redo();
      expect(useProjectStore.getState().project.textClips).toHaveLength(2);
    });
  });

  describe("shape overlay clips (project-authoritative)", () => {
    async function addGraphicsTrack(): Promise<string> {
      await useProjectStore.getState().addTrack("graphics");
      const track = useProjectStore
        .getState()
        .project.timeline.tracks.find((t) => t.type === "graphics");
      if (!track) throw new Error("graphics track not created");
      return track.id;
    }

    it("createShapeClip writes to project.shapeClips and is undoable/redoable", async () => {
      const trackId = await addGraphicsTrack();
      const clip = useProjectStore
        .getState()
        .createShapeClip(trackId, 0, "rectangle", 5);
      expect(clip).toBeTruthy();
      const id = clip!.id;

      expect(useProjectStore.getState().project.shapeClips?.some((c) => c.id === id)).toBe(true);

      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.shapeClips?.some((c) => c.id === id) ?? false).toBe(false);

      await useProjectStore.getState().redo();
      expect(useProjectStore.getState().project.shapeClips?.some((c) => c.id === id)).toBe(true);
    });

    it("deleteShapeClip is undoable", async () => {
      const trackId = await addGraphicsTrack();
      const clip = useProjectStore
        .getState()
        .createShapeClip(trackId, 0, "rectangle", 5)!;

      useProjectStore.getState().deleteShapeClip(clip.id);
      expect(useProjectStore.getState().project.shapeClips?.some((c) => c.id === clip.id) ?? false).toBe(false);

      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.shapeClips?.some((c) => c.id === clip.id)).toBe(true);
    });

    it("trims and splits graphic overlays through the project timing path", async () => {
      const trackId = await addGraphicsTrack();
      const clip = useProjectStore
        .getState()
        .createShapeClip(trackId, 0, "rectangle", 6)!;

      const trimmed = useProjectStore
        .getState()
        .trimOverlayToPlayhead(clip.id, 5, false);
      expect(trimmed).toMatchObject({ startTime: 0, duration: 5 });
      expect(
        useProjectStore.getState().project.shapeClips?.find((item) => item.id === clip.id),
      ).toMatchObject({ duration: 5 });

      const split = useProjectStore.getState().splitOverlayClip(clip.id, 2);
      expect(split?.left).toMatchObject({ startTime: 0, duration: 2 });
      expect(split?.right).toMatchObject({ startTime: 2, duration: 3 });
      expect(useProjectStore.getState().project.shapeClips).toHaveLength(2);
    });
  });

  describe("project loading", () => {
    it("should load an existing project", () => {
      const existingProject: Project = {
        id: "existing-project-id",
        name: "Loaded Project",
        createdAt: Date.now() - 1000,
        modifiedAt: Date.now(),
        settings: {
          width: 1280,
          height: 720,
          frameRate: 24,
          sampleRate: 44100,
          channels: 2,
        },
        mediaLibrary: { items: [] },
        timeline: {
          tracks: [],
          subtitles: [],
          duration: 0,
          markers: [],
        },
      };

      useProjectStore.getState().loadProject(existingProject);
      const { project } = useProjectStore.getState();

      expect(project.id).toBe("existing-project-id");
      expect(project.name).toBe("Loaded Project");
      expect(project.settings.width).toBe(1280);
    });

    it("should preserve project data on load", () => {
      const mockMediaItem: MediaItem = {
        id: "media-1",
        name: "test.mp4",
        type: "video",
        fileHandle: null,
        blob: null,
        metadata: {
          duration: 30,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 1000000,
        },
        thumbnailUrl: null,
        waveformData: null,
      };

      const projectWithMedia: Project = {
        id: "project-with-media",
        name: "Media Project",
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        settings: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          sampleRate: 48000,
          channels: 2,
        },
        mediaLibrary: { items: [mockMediaItem] },
        timeline: {
          tracks: [
            {
              id: "track-1",
              type: "video",
              name: "Video 1",
              clips: [],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
            },
          ],
          subtitles: [],
          duration: 30,
          markers: [],
        },
      };

      useProjectStore.getState().loadProject(projectWithMedia);
      const { project } = useProjectStore.getState();

      expect(project.mediaLibrary.items.length).toBe(1);
      expect(project.mediaLibrary.items[0].name).toBe("test.mp4");
    });
  });

  describe("project renaming", () => {
    it("should rename project", async () => {
      const result = await useProjectStore.getState().renameProject("New Name");

      expect(result.success).toBe(true);

      const { project } = useProjectStore.getState();
      expect(project.name).toBe("New Name");
    });

    it("should preserve other project properties when renaming", async () => {
      const originalProject = useProjectStore.getState().project;
      const originalId = originalProject.id;
      const originalSettings = { ...originalProject.settings };

      await useProjectStore.getState().renameProject("Renamed Project");

      const { project } = useProjectStore.getState();
      expect(project.id).toBe(originalId);
      expect(project.settings).toEqual(originalSettings);
    });
  });

  describe("settings update", () => {
    it("should update project settings", async () => {
      const result = await useProjectStore.getState().updateSettings({
        width: 2560,
        height: 1440,
      });

      expect(result.success).toBe(true);

      const { project } = useProjectStore.getState();
      expect(project.settings.width).toBe(2560);
      expect(project.settings.height).toBe(1440);
    });

    it("should preserve unmodified settings", async () => {
      const originalFrameRate =
        useProjectStore.getState().project.settings.frameRate;
      const originalSampleRate =
        useProjectStore.getState().project.settings.sampleRate;

      await useProjectStore.getState().updateSettings({
        width: 3840,
        height: 2160,
      });

      const { project } = useProjectStore.getState();
      expect(project.settings.frameRate).toBe(originalFrameRate);
      expect(project.settings.sampleRate).toBe(originalSampleRate);
    });
  });

  describe("track operations", () => {
    it("should add a video track", async () => {
      const initialTrackCount =
        useProjectStore.getState().project.timeline.tracks.length;

      const result = await useProjectStore.getState().addTrack("video");

      expect(result.success).toBe(true);

      const newTrackCount =
        useProjectStore.getState().project.timeline.tracks.length;
      expect(newTrackCount).toBe(initialTrackCount + 1);
    });

    it("should add an audio track", async () => {
      const result = await useProjectStore.getState().addTrack("audio");
      expect(result.success).toBe(true);
    });

    it("should get track by id", async () => {
      await useProjectStore.getState().addTrack("video");
      const { project } = useProjectStore.getState();
      const trackId = project.timeline.tracks[0].id;

      const track = useProjectStore.getState().getTrack(trackId);
      expect(track).toBeDefined();
      expect(track?.id).toBe(trackId);
    });

    it("should return undefined for non-existent track", () => {
      const track = useProjectStore.getState().getTrack("non-existent-id");
      expect(track).toBeUndefined();
    });

    it("should lock a track", async () => {
      await useProjectStore.getState().addTrack("video");
      const { project } = useProjectStore.getState();
      const trackId = project.timeline.tracks[0].id;

      const result = await useProjectStore.getState().lockTrack(trackId, true);
      expect(result.success).toBe(true);

      const lockedTrack = useProjectStore.getState().getTrack(trackId);
      expect(lockedTrack?.locked).toBe(true);
    });

    it("should unlock a track", async () => {
      await useProjectStore.getState().addTrack("video");
      const { project } = useProjectStore.getState();
      const trackId = project.timeline.tracks[0].id;

      await useProjectStore.getState().lockTrack(trackId, true);
      await useProjectStore.getState().lockTrack(trackId, false);

      const unlockedTrack = useProjectStore.getState().getTrack(trackId);
      expect(unlockedTrack?.locked).toBe(false);
    });

    it("should mute a track", async () => {
      const { project } = useProjectStore.getState();
      const audioTrack = project.timeline.tracks.find(
        (t) => t.type === "audio",
      );

      if (audioTrack) {
        const result = await useProjectStore
          .getState()
          .muteTrack(audioTrack.id, true);
        expect(result.success).toBe(true);

        const mutedTrack = useProjectStore.getState().getTrack(audioTrack.id);
        expect(mutedTrack?.muted).toBe(true);
      }
    });

    it("should unmute a track", async () => {
      const { project } = useProjectStore.getState();
      const audioTrack = project.timeline.tracks.find(
        (t) => t.type === "audio",
      );

      if (audioTrack) {
        await useProjectStore.getState().muteTrack(audioTrack.id, true);
        await useProjectStore.getState().muteTrack(audioTrack.id, false);

        const unmutedTrack = useProjectStore.getState().getTrack(audioTrack.id);
        expect(unmutedTrack?.muted).toBe(false);
      }
    });

    it("should hide a track", async () => {
      await useProjectStore.getState().addTrack("video");
      const { project } = useProjectStore.getState();
      const trackId = project.timeline.tracks[0].id;

      const result = await useProjectStore.getState().hideTrack(trackId, true);
      expect(result.success).toBe(true);

      const hiddenTrack = useProjectStore.getState().getTrack(trackId);
      expect(hiddenTrack?.hidden).toBe(true);
    });

    it("should show a hidden track", async () => {
      await useProjectStore.getState().addTrack("video");
      const { project } = useProjectStore.getState();
      const trackId = project.timeline.tracks[0].id;

      await useProjectStore.getState().hideTrack(trackId, true);
      await useProjectStore.getState().hideTrack(trackId, false);

      const visibleTrack = useProjectStore.getState().getTrack(trackId);
      expect(visibleTrack?.hidden).toBe(false);
    });
  });

  describe("media operations", () => {
    it("should get media item by id", () => {
      const projectWithMedia: Project = {
        id: "test-project",
        name: "Test",
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        settings: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          sampleRate: 48000,
          channels: 2,
        },
        mediaLibrary: {
          items: [
            {
              id: "media-123",
              name: "video.mp4",
              type: "video",
              fileHandle: null,
              blob: null,
              metadata: {
                duration: 10,
                width: 1920,
                height: 1080,
                frameRate: 30,
                codec: "h264",
                sampleRate: 48000,
                channels: 2,
                fileSize: 500000,
              },
              thumbnailUrl: null,
              waveformData: null,
            },
          ],
        },
        timeline: {
          tracks: [],
          subtitles: [],
          duration: 0,
          markers: [],
        },
      };

      useProjectStore.getState().loadProject(projectWithMedia);

      const media = useProjectStore.getState().getMediaItem("media-123");
      expect(media).toBeDefined();
      expect(media?.name).toBe("video.mp4");
    });

    it("should return undefined for non-existent media", () => {
      const media = useProjectStore.getState().getMediaItem("non-existent");
      expect(media).toBeUndefined();
    });
  });

  describe("timeline duration", () => {
    it("should calculate timeline duration from clips", () => {
      const projectWithClips: Project = {
        id: "test-project",
        name: "Test",
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
          tracks: [
            {
              id: "track-1",
              type: "video",
              name: "Video",
              clips: [
                {
                  id: "clip-1",
                  mediaId: "media-1",
                  trackId: "track-1",
                  startTime: 0,
                  duration: 10,
                  inPoint: 0,
                  outPoint: 10,
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
                },
                {
                  id: "clip-2",
                  mediaId: "media-2",
                  trackId: "track-1",
                  startTime: 10,
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
                },
              ],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
            },
          ],
          subtitles: [],
          duration: 15,
          markers: [],
        },
      };

      useProjectStore.getState().loadProject(projectWithClips);

      const duration = useProjectStore.getState().getTimelineDuration();
      expect(duration).toBe(15);
    });
  });

  describe("video effects", () => {
    const createProjectWithVideoClip = (): Project => ({
      id: "effects-project",
      name: "Effects Project",
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
        tracks: [
          {
            id: "video-track-1",
            type: "video",
            name: "Video",
            clips: [
              {
                id: "video-clip-1",
                mediaId: "video-media-1",
                trackId: "video-track-1",
                startTime: 0,
                duration: 8,
                inPoint: 0,
                outPoint: 8,
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
              },
            ],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          },
        ],
        subtitles: [],
        duration: 8,
        markers: [],
      },
    });

    it("should persist video effects to the clip timeline state", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip());

      const addedEffect = await useProjectStore
        .getState()
        .addVideoEffect("video-clip-1", "brightness", { value: 15 });

      expect(addedEffect).not.toBeNull();
      expect(useProjectStore.getState().getClip("video-clip-1")?.effects).toEqual([
        {
          id: addedEffect!.id,
          type: "brightness",
          enabled: true,
          params: { value: 15 },
        },
      ]);
      expect(useProjectStore.getState().getVideoEffects("video-clip-1")).toHaveLength(1);
    });

    it("duplicates a tuned clip effect beside its source with one-step undo", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip());
      const source = await useProjectStore
        .getState()
        .addVideoEffect("video-clip-1", "blur", { radius: 18 });
      if (!source) throw new Error("source effect not created");
      await useProjectStore
        .getState()
        .toggleVideoEffect("video-clip-1", source.id, false);

      const copy = await useProjectStore
        .getState()
        .duplicateVideoEffect("video-clip-1", source.id);

      expect(copy).toMatchObject({
        type: "blur",
        enabled: false,
        params: { radius: 18 },
      });
      expect(copy?.id).not.toBe(source.id);
      expect(
        useProjectStore.getState().getVideoEffects("video-clip-1").map((effect) => effect.id),
      ).toEqual([source.id, copy!.id]);

      await useProjectStore.getState().undo();
      expect(
        useProjectStore.getState().getVideoEffects("video-clip-1").map((effect) => effect.id),
      ).toEqual([source.id]);
    });

    it("replaces the full clip effect stack with one-step undo", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip());
      const first = await useProjectStore
        .getState()
        .addVideoEffect("video-clip-1", "brightness", { value: 12 });
      if (!first) throw new Error("effect not created");

      expect(
        await useProjectStore.getState().replaceVideoEffects("video-clip-1", []),
      ).toBe(true);
      expect(useProjectStore.getState().getVideoEffects("video-clip-1")).toEqual([]);

      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().getVideoEffects("video-clip-1")).toEqual([
        first,
      ]);
    });

    it("should keep clip effects synchronized across update, toggle, reorder, and remove", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip());

      const brightness = await useProjectStore
        .getState()
        .addVideoEffect("video-clip-1", "brightness", { value: 10 });
      const contrast = await useProjectStore
        .getState()
        .addVideoEffect("video-clip-1", "contrast", { value: 1.2 });

      expect(brightness).not.toBeNull();
      expect(contrast).not.toBeNull();

      const updated = await useProjectStore
        .getState()
        .updateVideoEffect("video-clip-1", brightness!.id, { value: 20 });
      const toggled = await useProjectStore
        .getState()
        .toggleVideoEffect("video-clip-1", brightness!.id, false);
      const reordered = useProjectStore
        .getState()
        .reorderVideoEffects("video-clip-1", [contrast!.id, brightness!.id]);
      const removed = await useProjectStore
        .getState()
        .removeVideoEffect("video-clip-1", contrast!.id);

      expect(updated?.params).toEqual({ value: 20 });
      expect(toggled?.enabled).toBe(false);
      expect(reordered).toBe(true);
      expect(removed).toBe(true);
      expect(useProjectStore.getState().getClip("video-clip-1")?.effects).toEqual([
        {
          id: brightness!.id,
          type: "brightness",
          enabled: false,
          params: { value: 20 },
        },
      ]);
    });

    it("treats text overlays as first-class ordered effect owners", async () => {
      useProjectStore.getState().createNewProject("Text Effects");
      await useProjectStore.getState().addTrack("text");
      const track = useProjectStore
        .getState()
        .project.timeline.tracks.find((candidate) => candidate.type === "text");
      if (!track) throw new Error("text track not created");
      const textClip = useProjectStore
        .getState()
        .createTextClip(track.id, 0, "Shader title", 5);
      if (!textClip) throw new Error("text clip not created");

      const shader = await useProjectStore
        .getState()
        .addVideoEffect(textClip.id, "shader", {
          shaderId: "paper-halftone-dots",
          size: 0.6,
        });
      const brightness = await useProjectStore
        .getState()
        .addVideoEffect(textClip.id, "brightness", { value: 20 });

      expect(shader).not.toBeNull();
      expect(brightness).not.toBeNull();
      expect(
        useProjectStore.getState().reorderVideoEffects(textClip.id, [
          brightness!.id,
          shader!.id,
        ]),
      ).toBe(true);
      expect(
        useProjectStore
          .getState()
          .project.textClips?.find((clip) => clip.id === textClip.id)
          ?.effects?.map((effect) => effect.id),
      ).toEqual([brightness!.id, shader!.id]);
      expect(
        useEngineStore
          .getState()
          .getTitleEngine()
          ?.getTextClip(textClip.id)
          ?.effects?.map((effect) => effect.id),
      ).toEqual([brightness!.id, shader!.id]);

      await useProjectStore.getState().undo();
      expect(
        useProjectStore
          .getState()
          .project.textClips?.find((clip) => clip.id === textClip.id)
          ?.effects?.map((effect) => effect.id),
      ).toEqual([shader!.id, brightness!.id]);

      await useProjectStore.getState().redo();
      expect(
        useProjectStore
          .getState()
          .project.textClips?.find((clip) => clip.id === textClip.id)
          ?.effects?.map((effect) => effect.id),
      ).toEqual([brightness!.id, shader!.id]);
    });
  });

  describe("editing templates", () => {
    const createProjectWithEditableClip = (): Project => {
      const mediaItem: MediaItem = {
        id: "video-media-1",
        name: "hero-shot.mp4",
        type: "video",
        fileHandle: null,
        blob: null,
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
        thumbnailUrl: null,
        waveformData: null,
      };

      const clip: Clip = {
        id: "video-clip-1",
        mediaId: mediaItem.id,
        trackId: "video-track-1",
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
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
      };

      return {
        id: "editing-template-project",
        name: "Editing Template Project",
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        settings: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          sampleRate: 48000,
          channels: 2,
        },
        mediaLibrary: { items: [mediaItem] },
        timeline: {
          tracks: [
            {
              id: "video-track-1",
              type: "video",
              name: "Video",
              clips: [clip],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
            },
          ],
          subtitles: [],
          duration: 10,
          markers: [],
        },
      };
    };

    beforeEach(() => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

      titleEngine?.loadTextClips([]);
      graphicsEngine?.loadShapeClips([]);
      graphicsEngine?.loadSVGClips([]);
      graphicsEngine?.loadStickerClips([]);
    });

    const getRecipeTextValues = (applicationId: string): string[] =>
      (useEngineStore.getState().getTitleEngine()?.getAllTextClips() || [])
        .filter(
          (clip) => clip.metadata?.templateSource?.applicationId === applicationId,
        )
        .map((clip) => clip.text)
        .sort();

    it("applies a clip-scoped recipe and records metadata plus overlays", () => {
      useProjectStore.getState().loadProject(createProjectWithEditableClip());

      const applicationId = useProjectStore.getState().applyEditingTemplate(
        "branding-lower-third",
        "video-clip-1",
        {
          name: "Ada Lovelace",
          role: "Director",
        },
      );

      expect(applicationId).toBeTruthy();

      const clip = useProjectStore.getState().getClip("video-clip-1");
      expect(clip?.metadata?.appliedTemplates).toEqual([
        expect.objectContaining({
          templateId: "branding-lower-third",
          applicationId,
          controlValues: expect.objectContaining({
            name: "Ada Lovelace",
            role: "Director",
          }),
        }),
      ]);
      expect(
        useProjectStore
          .getState()
          .project.timeline.tracks.map((track) => track.type),
      ).toEqual(["text", "graphics", "video"]);
      expect(
        useEngineStore.getState().getGraphicsEngine()?.getAllShapeClips(),
      ).toHaveLength(1);
      expect(
        useEngineStore.getState().getTitleEngine()?.getAllTextClips(),
      ).toHaveLength(2);
    });

    it("removes a clip-scoped recipe and cleans up its generated tracks", () => {
      useProjectStore.getState().loadProject(createProjectWithEditableClip());

      const applicationId = useProjectStore.getState().applyEditingTemplate(
        "branding-lower-third",
        "video-clip-1",
      );

      expect(applicationId).toBeTruthy();
      expect(
        useProjectStore.getState().removeEditingTemplateApplication(
          "video-clip-1",
          applicationId!,
        ),
      ).toBe(true);

      const clip = useProjectStore.getState().getClip("video-clip-1");
      expect(clip?.metadata?.appliedTemplates || []).toHaveLength(0);
      expect(
        useProjectStore
          .getState()
          .project.timeline.tracks.map((track) => track.type),
      ).toEqual(["video"]);
      expect(
        useEngineStore.getState().getGraphicsEngine()?.getAllShapeClips(),
      ).toHaveLength(0);
      expect(
        useEngineStore.getState().getTitleEngine()?.getAllTextClips(),
      ).toHaveLength(0);
    });

    it("updates an applied recipe in place and keeps its application id", () => {
      useProjectStore.getState().loadProject(createProjectWithEditableClip());

      const applicationId = useProjectStore.getState().applyEditingTemplate(
        "branding-lower-third",
        "video-clip-1",
        {
          name: "Ada Lovelace",
          role: "Director",
        },
      );

      expect(applicationId).toBeTruthy();
      expect(
        useProjectStore.getState().updateEditingTemplateApplication(
          "video-clip-1",
          applicationId!,
          {
            name: "Grace Hopper",
            role: "Engineer",
          },
        ),
      ).toBe(true);

      const clip = useProjectStore.getState().getClip("video-clip-1");
      expect(clip?.metadata?.appliedTemplates).toEqual([
        expect.objectContaining({
          applicationId,
          controlValues: expect.objectContaining({
            name: "Grace Hopper",
            role: "Engineer",
          }),
        }),
      ]);
      expect(getRecipeTextValues(applicationId!)).toEqual([
        "Engineer",
        "Grace Hopper",
      ]);
      expect(
        useEngineStore
          .getState()
          .getGraphicsEngine()
          ?.getAllShapeClips()
          .filter(
            (clip) => clip.metadata?.templateSource?.applicationId === applicationId,
          ),
      ).toHaveLength(1);
    });

    it("undos and redoes a recipe update between previous and current controls", async () => {
      useProjectStore.getState().loadProject(createProjectWithEditableClip());

      const applicationId = useProjectStore.getState().applyEditingTemplate(
        "branding-lower-third",
        "video-clip-1",
        {
          name: "Ada Lovelace",
          role: "Director",
        },
      );

      expect(applicationId).toBeTruthy();
      expect(
        useProjectStore.getState().updateEditingTemplateApplication(
          "video-clip-1",
          applicationId!,
          {
            name: "Grace Hopper",
            role: "Engineer",
          },
        ),
      ).toBe(true);
      expect(getRecipeTextValues(applicationId!)).toEqual([
        "Engineer",
        "Grace Hopper",
      ]);

      await useProjectStore.getState().undo();
      expect(getRecipeTextValues(applicationId!)).toEqual([
        "Ada Lovelace",
        "Director",
      ]);
      expect(
        useProjectStore.getState().getClip("video-clip-1")?.metadata?.appliedTemplates,
      ).toEqual([
        expect.objectContaining({
          applicationId,
          controlValues: expect.objectContaining({
            name: "Ada Lovelace",
            role: "Director",
          }),
        }),
      ]);

      await useProjectStore.getState().redo();
      expect(getRecipeTextValues(applicationId!)).toEqual([
        "Engineer",
        "Grace Hopper",
      ]);
      expect(
        useProjectStore.getState().getClip("video-clip-1")?.metadata?.appliedTemplates,
      ).toEqual([
        expect.objectContaining({
          applicationId,
          controlValues: expect.objectContaining({
            name: "Grace Hopper",
            role: "Engineer",
          }),
        }),
      ]);
    });

    it("undos newer timeline actions before undoing a recipe and can redo the recipe", async () => {
      useProjectStore.getState().loadProject(createProjectWithEditableClip());

      const applicationId = useProjectStore.getState().applyEditingTemplate(
        "branding-lower-third",
        "video-clip-1",
      );

      expect(applicationId).toBeTruthy();
      expect(useProjectStore.getState().project.timeline.tracks).toHaveLength(3);

      await useProjectStore.getState().addTrack("audio");
      expect(useProjectStore.getState().project.timeline.tracks).toHaveLength(4);

      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.timeline.tracks).toHaveLength(3);
      expect(
        useProjectStore.getState().getClip("video-clip-1")?.metadata?.appliedTemplates,
      ).toHaveLength(1);

      await useProjectStore.getState().undo();
      expect(
        useProjectStore.getState().getClip("video-clip-1")?.metadata?.appliedTemplates || [],
      ).toHaveLength(0);
      expect(
        useEngineStore.getState().getGraphicsEngine()?.getAllShapeClips(),
      ).toHaveLength(0);
      expect(
        useEngineStore.getState().getTitleEngine()?.getAllTextClips(),
      ).toHaveLength(0);

      await useProjectStore.getState().redo();
      expect(
        useProjectStore.getState().getClip("video-clip-1")?.metadata?.appliedTemplates,
      ).toHaveLength(1);
      expect(
        useEngineStore.getState().getGraphicsEngine()?.getAllShapeClips(),
      ).toHaveLength(1);
      expect(
        useEngineStore.getState().getTitleEngine()?.getAllTextClips(),
      ).toHaveLength(2);
    });
  });

  describe("clip transitions", () => {
    const createProjectWithAdjacentClips = (): Project => ({
      id: "transition-project",
      name: "Transition Project",
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
        tracks: [
          {
            id: "video-track-1",
            type: "video",
            name: "Video",
            clips: [
              {
                id: "clip-a",
                mediaId: "video-a",
                trackId: "video-track-1",
                startTime: 0,
                duration: 4,
                inPoint: 0,
                outPoint: 4,
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
              },
              {
                id: "clip-b",
                mediaId: "video-b",
                trackId: "video-track-1",
                startTime: 4,
                duration: 4,
                inPoint: 0,
                outPoint: 4,
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
              },
            ],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          },
        ],
        subtitles: [],
        duration: 8,
        markers: [],
      },
    });

    it("should persist adjacent clip transitions and mirror them into the transition bridge", async () => {
      useProjectStore.getState().loadProject(createProjectWithAdjacentClips());

      const transition: Transition = {
        id: "transition-1",
        clipAId: "clip-a",
        clipBId: "clip-b",
        type: "crossfade",
        duration: 0.5,
        params: { curve: "ease" },
      };

      const addedTransition = await useProjectStore
        .getState()
        .addClipTransition(transition);
      const updatedTransition = await useProjectStore
        .getState()
        .updateClipTransition("transition-1", {
          duration: 0.75,
          params: { curve: "linear" },
        });

      expect(addedTransition).toEqual(transition);
      expect(useProjectStore.getState().getClipTransitionBetweenClips("clip-a", "clip-b")).toEqual({
        id: "transition-1",
        clipAId: "clip-a",
        clipBId: "clip-b",
        type: "crossfade",
        duration: 0.75,
        params: { curve: "linear" },
      });
      expect(updatedTransition).toEqual({
        id: "transition-1",
        clipAId: "clip-a",
        clipBId: "clip-b",
        type: "crossfade",
        duration: 0.75,
        params: { curve: "linear" },
      });
      expect(mockTransitionBridgeState.trackTransitions.get("video-track-1")).toEqual([
        {
          id: "transition-1",
          clipAId: "clip-a",
          clipBId: "clip-b",
          type: "crossfade",
          duration: 0.75,
          params: { curve: "linear" },
        },
      ]);

      const removedTransition = await useProjectStore
        .getState()
        .removeClipTransition("transition-1");

      expect(removedTransition).toBe(true);
      expect(useProjectStore.getState().getClipTransition("transition-1")).toBeUndefined();
      expect(mockTransitionBridgeState.trackTransitions.get("video-track-1")).toEqual([]);
    });

    it("should replace single-clip edge transitions at the same clip edge", async () => {
      useProjectStore.getState().loadProject(createProjectWithAdjacentClips());

      const firstOutro: Transition = {
        id: "transition-out-1",
        clipAId: "clip-a",
        edge: "out",
        type: "crossfade",
        duration: 0.5,
        params: { curve: "ease" },
      };
      const secondOutro: Transition = {
        ...firstOutro,
        id: "transition-out-2",
        type: "dipToBlack",
        params: { holdDuration: 0.1 },
      };

      await useProjectStore.getState().addClipTransition(firstOutro);
      await useProjectStore.getState().addClipTransition(secondOutro);

      const transitions =
        useProjectStore.getState().project.timeline.tracks[0].transitions;
      expect(transitions).toEqual([secondOutro]);
      expect(mockTransitionBridgeState.trackTransitions.get("video-track-1")).toEqual([
        secondOutro,
      ]);
    });
  });

  describe("marker operations", () => {
    it("should add a marker", async () => {
      await useProjectStore.getState().addMarker(5, "Scene 1", "#ff0000");

      const markers = useProjectStore.getState().getMarkers();
      expect(markers.length).toBe(1);
      expect(markers[0].time).toBe(5);
      expect(markers[0].label).toBe("Scene 1");
    });

    it("should remove a marker", async () => {
      await useProjectStore.getState().addMarker(5, "Scene 1");
      const markers = useProjectStore.getState().getMarkers();
      const markerId = markers[0].id;

      await useProjectStore.getState().removeMarker(markerId);

      const updatedMarkers = useProjectStore.getState().getMarkers();
      expect(updatedMarkers.length).toBe(0);
    });

    it("should get marker by id", async () => {
      await useProjectStore.getState().addMarker(10, "Marker Test");
      const markers = useProjectStore.getState().getMarkers();
      const markerId = markers[0].id;

      const marker = useProjectStore.getState().getMarker(markerId);
      expect(marker).toBeDefined();
      expect(marker?.time).toBe(10);
    });

    it("should restore a removed marker on undo", async () => {
      const store = useProjectStore.getState();
      await store.addMarker(5, "Scene 1", "#ff0000");
      const markerId = store.getMarkers()[0].id;

      await store.removeMarker(markerId);
      expect(store.getMarkers().length).toBe(0);

      await store.undo();
      const restored = useProjectStore.getState().getMarkers();
      expect(restored.length).toBe(1);
      expect(restored[0].label).toBe("Scene 1");
      expect(restored[0].time).toBe(5);
    });

    it("should revert a marker update on undo", async () => {
      const store = useProjectStore.getState();
      await store.addMarker(5, "Original", "#ff0000");
      const markerId = store.getMarkers()[0].id;

      await store.updateMarker(markerId, { label: "Edited", time: 8 });
      expect(useProjectStore.getState().getMarker(markerId)?.label).toBe(
        "Edited",
      );

      await useProjectStore.getState().undo();
      const reverted = useProjectStore.getState().getMarker(markerId);
      expect(reverted?.label).toBe("Original");
      expect(reverted?.time).toBe(5);
    });
  });

  describe("undo/redo", () => {
    it("should not be able to undo without actions", () => {
      expect(useProjectStore.getState().canUndo()).toBe(false);
    });

    it("should not be able to redo without undone actions", () => {
      expect(useProjectStore.getState().canRedo()).toBe(false);
    });

    it("should be able to undo after an action", async () => {
      await useProjectStore.getState().addTrack("video");
      expect(useProjectStore.getState().canUndo()).toBe(true);
    });
  });

  describe("clipboard operations", () => {
    it("should start with empty clipboard", () => {
      expect(useProjectStore.getState().clipboard).toEqual([]);
    });

    it("copies and pastes full media clip state", async () => {
      const mockClip: Clip = {
        id: "clip-to-copy",
        mediaId: "media-1",
        trackId: "track-1",
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        effects: [],
        audioEffects: [
          {
            id: "audio-fx-1",
            type: "compressor",
            enabled: true,
            params: { threshold: -12 },
          },
        ],
        transform: {
          position: { x: 0.5, y: 0.5 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        volume: 1,
        keyframes: [],
        fade: { fadeIn: 0.25, fadeOut: 0.5 },
        speed: 1.5,
      };

      const projectWithClip: Project = {
        id: "test",
        name: "Test",
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        settings: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          sampleRate: 48000,
          channels: 2,
        },
        mediaLibrary: {
          items: [
            {
              id: "media-1",
              name: "clipboard.mp4",
              type: "video",
              fileHandle: null,
              blob: null,
              metadata: {
                duration: 5,
                width: 1920,
                height: 1080,
                frameRate: 30,
                codec: "h264",
                sampleRate: 48000,
                channels: 2,
                fileSize: 1024,
              },
              thumbnailUrl: null,
              waveformData: null,
            },
          ],
        },
        timeline: {
          tracks: [
            {
              id: "track-1",
              type: "video",
              name: "Video",
              clips: [mockClip],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
            },
          ],
          subtitles: [],
          duration: 5,
          markers: [],
        },
      };

      useProjectStore.getState().loadProject(projectWithClip);
      useProjectStore.getState().copyClips(["clip-to-copy"]);

      expect(useProjectStore.getState().clipboard.length).toBe(1);
      expect(useProjectStore.getState().clipboard[0]?.kind).toBe("media");

      const results = await useProjectStore
        .getState()
        .pasteClips("track-1", 6);
      expect(results[0]?.success).toBe(true);
      const pasted = useProjectStore
        .getState()
        .getClip(useProjectStore.getState().lastPastedClipIds[0]);
      expect(pasted).toMatchObject({
        startTime: 6,
        speed: 1.5,
        fade: { fadeIn: 0.25, fadeOut: 0.5 },
        transform: mockClip.transform,
        audioEffects: mockClip.audioEffects,
      });
    });

    it("copies and pastes mixed overlays with relative timing and one-step undo", async () => {
      await useProjectStore.getState().addTrack("text");
      await useProjectStore.getState().addTrack("graphics");
      const project = useProjectStore.getState().project;
      const textTrack = project.timeline.tracks.find(
        (track) => track.type === "text",
      )!;
      const graphicsTrack = project.timeline.tracks.find(
        (track) => track.type === "graphics",
      )!;
      const text = useProjectStore
        .getState()
        .createTextClip(textTrack.id, 1, "Clipboard title", 4)!;
      const shape = useProjectStore
        .getState()
        .createShapeClip(graphicsTrack.id, 3, "rectangle", 2)!;

      useProjectStore.getState().copyClips([text.id, shape.id]);
      expect(useProjectStore.getState().clipboard.map((item) => item.kind)).toEqual([
        "text",
        "shape",
      ]);

      const results = await useProjectStore
        .getState()
        .pasteClips(textTrack.id, 10);
      expect(results).toEqual([{ success: true }, { success: true }]);
      const pastedIds = useProjectStore.getState().lastPastedClipIds;
      expect(pastedIds).toHaveLength(2);
      expect(useProjectStore.getState().getTextClip(pastedIds[0])).toMatchObject({
        startTime: 10,
        trackId: textTrack.id,
      });
      expect(useProjectStore.getState().getShapeClip(pastedIds[1])).toMatchObject({
        startTime: 12,
        trackId: graphicsTrack.id,
      });

      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.textClips).toHaveLength(1);
      expect(useProjectStore.getState().project.shapeClips).toHaveLength(1);
    });
  });

  describe("separateAudio", () => {
    const createProjectWithVideoClip = (audioTrackCount?: number): Project => {
      const mediaItem: MediaItem = {
        id: "video-media-1",
        name: "multi-audio.mp4",
        type: "video",
        fileHandle: null,
        blob: null,
        metadata: {
          duration: 10,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 1000000,
          audioTrackCount,
        },
        thumbnailUrl: null,
        waveformData: null,
      };

      const videoClip: Clip = {
        id: "video-clip-1",
        mediaId: "video-media-1",
        trackId: "video-track-1",
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
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
      };

      return {
        id: "test-project",
        name: "Test",
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        settings: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          sampleRate: 48000,
          channels: 2,
        },
        mediaLibrary: { items: [mediaItem] },
        timeline: {
          tracks: [
            {
              id: "video-track-1",
              type: "video",
              name: "Video",
              clips: [videoClip],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
            },
          ],
          subtitles: [],
          duration: 10,
          markers: [],
        },
      };
    };

    it("should create one audio clip when media has a single audio track", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip(1));
      const result = await useProjectStore.getState().separateAudio("video-clip-1");

      expect(result.success).toBe(true);
      const { project } = useProjectStore.getState();
      const audioTracks = project.timeline.tracks.filter((t) => t.type === "audio");
      expect(audioTracks.length).toBe(1);
      expect(audioTracks[0].clips.length).toBe(1);
      expect(audioTracks[0].clips[0].mediaId).toBe("video-media-1");
    });

    it("should create multiple audio clips when media has multiple audio tracks", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip(3));
      const result = await useProjectStore.getState().separateAudio("video-clip-1");

      expect(result.success).toBe(true);
      const { project } = useProjectStore.getState();
      const audioTracks = project.timeline.tracks.filter((t) => t.type === "audio");
      expect(audioTracks.length).toBe(3);

      // Each audio track should have one clip with the correct audioTrackIndex
      for (let i = 0; i < 3; i++) {
        expect(audioTracks[i].clips.length).toBe(1);
        expect(audioTracks[i].clips[0].mediaId).toBe("video-media-1");
        expect(audioTracks[i].clips[0].audioTrackIndex).toBe(i);
      }
    });

    it("should default to one audio track when audioTrackCount is undefined", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip(undefined));
      const result = await useProjectStore.getState().separateAudio("video-clip-1");

      expect(result.success).toBe(true);
      const { project } = useProjectStore.getState();
      const audioTracks = project.timeline.tracks.filter((t) => t.type === "audio");
      expect(audioTracks.length).toBe(1);
    });

    it("should return an error when clip is not found", async () => {
      useProjectStore.getState().createNewProject();
      const result = await useProjectStore.getState().separateAudio("non-existent-clip");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("CLIP_NOT_FOUND");
    });
  });
});

describe("ProjectStore - Text Clips", () => {
  beforeEach(async () => {
    useProjectStore.getState().createNewProject();
    await useProjectStore.getState().addTrack("text");
  });

  it("should create a text clip", async () => {
    const { project } = useProjectStore.getState();
    const trackId = project.timeline.tracks[0].id;

    const textClip = useProjectStore
      .getState()
      .createTextClip(trackId, 0, "Hello World", 5);

    expect(textClip).toBeDefined();
    expect(textClip?.text).toBe("Hello World");
    expect(textClip?.duration).toBe(5);
  });

  it("should get all text clips", async () => {
    const { project } = useProjectStore.getState();
    const trackId = project.timeline.tracks[0].id;

    const initialCount = useProjectStore.getState().getAllTextClips().length;

    useProjectStore.getState().createTextClip(trackId, 0, "First", 3);
    useProjectStore.getState().createTextClip(trackId, 3, "Second", 3);

    const allTextClips = useProjectStore.getState().getAllTextClips();
    expect(allTextClips.length).toBe(initialCount + 2);
  });

  it("should get available animation presets", () => {
    const presets = useProjectStore.getState().getAvailableAnimationPresets();
    expect(Array.isArray(presets)).toBe(true);
  });

  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  it("undoes a text content edit without deleting the clip, and redoes it", async () => {
    const { project } = useProjectStore.getState();
    const trackId = project.timeline.tracks[0].id;

    const textClip = useProjectStore
      .getState()
      .createTextClip(trackId, 0, "Original", 5);
    expect(textClip).toBeDefined();
    const clipId = textClip!.id;

    // Ensure the edit's history timestamp is strictly after the create's so
    // the unified (timestamp-ordered) undo targets the edit first.
    await tick();
    useProjectStore.getState().updateTextContent(clipId, "Edited");
    const titleEngine = () => useEngineStore.getState().getTitleEngine();
    expect(titleEngine()?.getTextClip(clipId)?.text).toBe("Edited");

    await useProjectStore.getState().undo();
    const afterUndo = titleEngine()?.getTextClip(clipId);
    expect(afterUndo).toBeDefined();
    expect(afterUndo?.text).toBe("Original");

    await useProjectStore.getState().redo();
    expect(titleEngine()?.getTextClip(clipId)?.text).toBe("Edited");
  });

  it("undoes a text style edit in place", async () => {
    const { project } = useProjectStore.getState();
    const trackId = project.timeline.tracks[0].id;

    const textClip = useProjectStore
      .getState()
      .createTextClip(trackId, 0, "Styled", 5);
    const clipId = textClip!.id;
    const originalSize = textClip!.style.fontSize;

    await tick();
    useProjectStore.getState().updateTextStyle(clipId, { fontSize: 99 });
    const titleEngine = () => useEngineStore.getState().getTitleEngine();
    expect(titleEngine()?.getTextClip(clipId)?.style.fontSize).toBe(99);

    await useProjectStore.getState().undo();
    const afterUndo = titleEngine()?.getTextClip(clipId);
    expect(afterUndo).toBeDefined();
    expect(afterUndo?.style.fontSize).toBe(originalSize);
  });
});

describe("ProjectStore - Subtitles (consolidated into text clips)", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject();
    const titleEngine = useEngineStore.getState().getTitleEngine();
    const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
    titleEngine?.loadTextClips([]);
    graphicsEngine?.loadShapeClips([]);
    graphicsEngine?.loadSVGClips([]);
    graphicsEngine?.loadStickerClips([]);
  });

  it.skip("should add a subtitle - skipped: subtitles consolidated into text clips", () => {
    // Subtitles are now created as text clips on a Captions track
    // The addSubtitle function creates text clips, but getSubtitle reads from the old subtitles array
    // This test is skipped until the API is fully migrated
  });

  it.skip("should remove a subtitle - skipped: subtitles consolidated into text clips", () => {
    // Subtitles are now created as text clips on a Captions track
  });

  it.skip("should update a subtitle - skipped: subtitles consolidated into text clips", () => {
    // Subtitles are now created as text clips on a Captions track
  });

  it.skip("should export SRT - skipped: subtitles consolidated into text clips", () => {
    // SRT export now uses text clips from Captions track
  });

  it("should get subtitle style presets", async () => {
    const presets = await useProjectStore.getState().getSubtitleStylePresets();
    expect(Array.isArray(presets)).toBe(true);
  });

  it("imports SRT subtitles into a Captions text track", async () => {
    const srt = `1
00:00:00,000 --> 00:00:02,000
Hello world

2
00:00:02,500 --> 00:00:04,000
Second caption`;

    const result = await useProjectStore.getState().importSRT(srt);

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);

    const state = useProjectStore.getState();
    const captionsTrack = state.project.timeline.tracks.find(
      (track) => track.type === "text" && track.name === "Captions",
    );
    expect(captionsTrack).toBeDefined();

    const captionClips = state
      .getAllTextClips()
      .filter((clip) => clip.trackId === captionsTrack?.id)
      .sort((a, b) => a.startTime - b.startTime);

    expect(captionClips).toHaveLength(2);
    expect(captionClips[0]?.text).toBe("Hello world");
    expect(captionClips[0]?.startTime).toBe(0);
    expect(captionClips[0]?.duration).toBe(2);
    expect(captionClips[1]?.text).toBe("Second caption");
    expect(captionClips[1]?.startTime).toBe(2.5);
    expect(captionClips[1]?.duration).toBe(1.5);
  });

  it("returns warnings when an SRT has invalid segments but still imports valid captions", async () => {
    const srt = `1
00:00:00,000 --> 00:00:02,000
Hello world

bad-index
00:00:03,000 --> 00:00:04,000
Ignored block`;

    const result = await useProjectStore.getState().importSRT(srt);

    expect(result.success).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);

    const state = useProjectStore.getState();
    const captionsTrack = state.project.timeline.tracks.find(
      (track) => track.type === "text" && track.name === "Captions",
    );
    const captionClips = state
      .getAllTextClips()
      .filter((clip) => clip.trackId === captionsTrack?.id);

    expect(captionClips).toHaveLength(1);
    expect(captionClips[0]?.text).toBe("Hello world");
  });

  it("imports long SRT cues as sequential single-line caption clips", async () => {
    const result = await useProjectStore.getState().importSRT(
      `1
00:00:10,000 --> 00:00:17,000
one two three four five six seven`,
      { maxWordsPerLine: 5 },
    );

    expect(result.success).toBe(true);
    const captionClips = useProjectStore
      .getState()
      .getAllTextClips()
      .sort((left, right) => left.startTime - right.startTime);
    expect(captionClips).toHaveLength(2);
    expect(captionClips.map((clip) => clip.text)).toEqual([
      "one two three four five",
      "six seven",
    ]);
    expect(captionClips.map((clip) => [clip.startTime, clip.duration])).toEqual([
      [10, 5],
      [15, 2],
    ]);
    expect(captionClips.every((clip) => !clip.text.includes("\n"))).toBe(true);
  });

  it("exports edited caption text clips back to SRT", async () => {
    await useProjectStore.getState().importSRT(`1
00:00:01,000 --> 00:00:03,000
Original caption`);
    const caption = useProjectStore.getState().getAllTextClips()[0];
    useProjectStore.getState().updateTextContent(caption.id, "Edited caption");

    const exported = await useProjectStore.getState().exportSRT();

    expect(exported).toContain("00:00:01,000 --> 00:00:03,000");
    expect(exported).toContain("Edited caption");
  });
});

describe("ProjectStore - generated shader registry lifecycle", () => {
  const shaderA: MotionShaderDef = {
    id: "ai-project-a-shader",
    name: "Project A Shader",
    category: "fill",
    glsl: "#version 300 es\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){ fragColor=vec4(vUv,0.0,1.0); }",
    params: [],
    origin: "generated",
  };

  const shaderB: MotionShaderDef = {
    id: "ai-project-b-shader",
    name: "Project B Shader",
    category: "effect",
    glsl: "#version 300 es\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){ fragColor=vec4(1.0); }",
    params: [],
    origin: "generated",
  };

  const projectWith = (
    name: string,
    generatedShaders: readonly MotionShaderDef[],
  ): Project => ({
    ...createEmptyProject(name),
    generatedShaders,
  });

  beforeEach(() => {
    clearGeneratedMotionShaders();
  });

  it("rehydrates the registry from generatedShaders on loadProject", () => {
    useProjectStore.getState().loadProject(projectWith("A", [shaderA]));

    expect(getMotionShaderDef(shaderA.id)?.id).toBe(shaderA.id);
    expect(listGeneratedMotionShaders().map((d) => d.id)).toContain(shaderA.id);
  });

  it("isolates the registry when loading a different project", () => {
    useProjectStore.getState().loadProject(projectWith("A", [shaderA]));
    expect(getMotionShaderDef(shaderA.id)?.id).toBe(shaderA.id);

    useProjectStore.getState().loadProject(projectWith("B", [shaderB]));

    expect(getMotionShaderDef(shaderA.id)).toBeUndefined();
    expect(getMotionShaderDef(shaderB.id)?.id).toBe(shaderB.id);
    expect(listGeneratedMotionShaders().map((d) => d.id)).toEqual([shaderB.id]);
  });

  it("clears the prior project's shaders on createNewProject", () => {
    useProjectStore.getState().loadProject(projectWith("A", [shaderA]));
    expect(getMotionShaderDef(shaderA.id)?.id).toBe(shaderA.id);

    useProjectStore.getState().createNewProject();

    expect(getMotionShaderDef(shaderA.id)).toBeUndefined();
    expect(listGeneratedMotionShaders()).toEqual([]);
  });

  it("drops malformed generated shaders during loadProject normalization", () => {
    const malformed = { id: "", name: "Broken", category: "fill", glsl: "", params: [] };
    const project = {
      ...createEmptyProject("Malformed"),
      generatedShaders: [malformed, shaderA] as unknown as readonly MotionShaderDef[],
    };

    useProjectStore.getState().loadProject(project);

    expect(getMotionShaderDef(shaderA.id)?.id).toBe(shaderA.id);
    expect(listGeneratedMotionShaders().map((d) => d.id)).toEqual([shaderA.id]);
    expect(
      useProjectStore.getState().project.generatedShaders?.map((d) => d.id),
    ).toEqual([shaderA.id]);
  });
});
