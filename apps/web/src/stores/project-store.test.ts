import { describe, it, expect, beforeEach, vi } from "vitest";
import { useProjectStore, registerSmoothKeyframeRefresh } from "./project-store";
import { useEngineStore } from "./engine-store";
import { useTimelineStore } from "./timeline-store";
import { useUIStore } from "./ui-store";
import {
  textAnimationEngine,
  isProEffectNeutral,
  getAnimatedVideoEffects,
  getPluginRegistry,
  parsePluginPackage,
  applyKeyframeInterpolation,
  refreshSmoothKeyframesAfterEdit,
} from "@openreel/core";
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
import { extractAudioTracks } from "../services/separate-audio";
import { saveMediaBlob, deleteMediaBlob } from "../services/media-storage";

vi.mock("../services/separate-audio", () => ({ extractAudioTracks: vi.fn() }));
vi.mock("../services/media-storage", () => ({
  saveMediaBlob: vi.fn(async () => {}),
  deleteMediaBlob: vi.fn(async () => {}),
}));

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
    it("starts a fresh timeline instead of retaining the previous project's playback and range", () => {
      useTimelineStore.setState({
        playheadPosition: 570,
        playbackState: "playing",
        loopEnabled: true,
        loopStart: 540,
        loopEnd: 570,
        scrollX: 1200,
        scrollY: 240,
      });
      useUIStore.getState().select({ type: "clip", id: "previous-project-clip" });

      useProjectStore.getState().createNewProject("Fresh edit");

      expect(useTimelineStore.getState()).toMatchObject({
        playheadPosition: 0,
        playbackState: "stopped",
        loopEnabled: false,
        loopStart: 0,
        loopEnd: 0,
        scrollX: 0,
        scrollY: 0,
      });
      expect(useUIStore.getState().selectedItems).toEqual([]);
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

    it("createShapeClip keeps path geometry and undo of a delete restores it", async () => {
      const trackId = await addGraphicsTrack();
      const clip = useProjectStore
        .getState()
        .createShapeClip(trackId, 0, "path", 5, undefined, {
          pathData: "M 0 0 L 1 0 L 1 1 Z",
          points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          closed: true,
        })!;
      expect(clip).toMatchObject({ pathData: "M 0 0 L 1 0 L 1 1 Z", closed: true });

      useProjectStore.getState().deleteShapeClip(clip.id);
      await useProjectStore.getState().undo();

      const restored = useProjectStore
        .getState()
        .project.shapeClips?.find((c) => c.shapeType === "path");
      expect(restored).toMatchObject({
        pathData: "M 0 0 L 1 0 L 1 1 Z",
        points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        closed: true,
      });
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

    it("places media on the exact newly created track when default empty tracks already exist", async () => {
      await useProjectStore.getState().createNewProject("Placement regression");
      const before = useProjectStore.getState().project;
      expect(before.timeline.tracks.map(track => track.name)).toEqual(["Titles","B-roll","Main","Dialogue","Music"]);
      const media: MediaItem = {id:"placement-video",name:"Placement.mp4",type:"video",fileHandle:null,blob:null,metadata:{duration:5,width:1920,height:1080,frameRate:30,codec:"h264",sampleRate:48000,channels:2,fileSize:1},thumbnailUrl:null,waveformData:null};
      useProjectStore.setState({project:{...before,mediaLibrary:{items:[media]}}});
      const result = await useProjectStore.getState().addClipToNewTrack(media.id,2);
      expect(result.success).toBe(true);
      const after = useProjectStore.getState().project;
      const created = after.timeline.tracks.find(track => !before.timeline.tracks.some(existing => existing.id === track.id));
      expect(created?.clips).toHaveLength(1);
      expect(created?.clips[0]).toMatchObject({mediaId:media.id,startTime:2,trackId:created?.id});
      expect(after.timeline.tracks.filter(track => before.timeline.tracks.some(existing => existing.id === track.id)).every(track => track.clips.length === 0)).toBe(true);
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

  describe("universal timeline placement", () => {
    const mixedPlacementProject = (): Project =>
      ({
        id: "mixed-placement",
        name: "Mixed placement",
        createdAt: 0,
        modifiedAt: 0,
        settings: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          sampleRate: 48_000,
          channels: 2,
        },
        mediaLibrary: {
          items: [
            {
              id: "video-media",
              name: "Video",
              type: "video",
              fileHandle: null,
              blob: null,
              metadata: {
                duration: 5,
                width: 1920,
                height: 1080,
                frameRate: 30,
                codec: "h264",
                sampleRate: 48_000,
                channels: 2,
                fileSize: 1,
              },
              thumbnailUrl: null,
              waveformData: null,
            },
            {
              id: "image-media",
              name: "Image",
              type: "image",
              fileHandle: null,
              blob: null,
              metadata: {
                duration: 0,
                width: 1280,
                height: 720,
                frameRate: 0,
                codec: "png",
                sampleRate: 0,
                channels: 0,
                fileSize: 1,
              },
              thumbnailUrl: null,
              waveformData: null,
            },
          ],
        },
        timeline: {
          duration: 5,
          subtitles: [],
          markers: [],
          tracks: [
            {
              id: "target",
              type: "video",
              name: "Track 1",
              clips: [
                {
                  id: "existing",
                  mediaId: "video-media",
                  trackId: "target",
                  startTime: 0,
                  duration: 5,
                  inPoint: 0,
                  outPoint: 5,
                  effects: [],
                  audioEffects: [],
                  keyframes: [],
                  transform: {},
                  volume: 1,
                },
              ],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
            },
          ],
        },
      }) as unknown as Project;

    it("auto-stacks an occupied drop and undoes the clip and row together", async () => {
      useProjectStore.getState().loadProject(mixedPlacementProject());

      const result = await useProjectStore
        .getState()
        .placeMediaClip("image-media", "target", 1);

      expect(result.success).toBe(true);
      let project = useProjectStore.getState().project;
      expect(project.timeline.tracks).toHaveLength(2);
      expect(project.timeline.tracks[0].mode).toBe("standard");
      expect(project.timeline.tracks[0].clips[0]?.mediaId).toBe("image-media");
      expect(project.capabilities).toContain("universal-tracks-v1");

      await useProjectStore.getState().undo();
      project = useProjectStore.getState().project;
      expect(project.timeline.tracks).toHaveLength(1);
      expect(project.timeline.tracks[0].id).toBe("target");
      expect(project.timeline.tracks[0].clips.map((clip) => clip.id)).toEqual([
        "existing",
      ]);
    });

    it("moves a text item onto any unlocked row and restores it on undo", async () => {
      const project = {
        ...mixedPlacementProject(),
        timeline: {
          ...mixedPlacementProject().timeline,
          tracks: [
            ...mixedPlacementProject().timeline.tracks,
            {
              id: "destination",
              type: "audio" as const,
              name: "Destination",
              clips: [],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
            },
          ],
        },
        textClips: [
          {
            id: "title",
            trackId: "target",
            startTime: 0,
            duration: 1,
            text: "Title",
          },
        ],
      } as unknown as Project;
      useProjectStore.getState().loadProject(project);

      const result = await useProjectStore
        .getState()
        .moveTimelineItem("title", 2, "destination");
      expect(result.success).toBe(true);
      expect(useProjectStore.getState().project.textClips?.[0]).toMatchObject({
        trackId: "destination",
        startTime: 2,
      });

      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.textClips?.[0]).toMatchObject({
        trackId: "target",
        startTime: 0,
      });
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

    it("seeds visible defaults when a legacy effect is added without params", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip());

      const blur = await useProjectStore
        .getState()
        .addVideoEffect("video-clip-1", "blur");
      expect(Number(blur?.params.radius)).toBeGreaterThan(0);
      const vignette = await useProjectStore
        .getState()
        .addVideoEffect("video-clip-1", "vignette");
      expect(Number(vignette?.params.amount)).toBeGreaterThan(0);
      const explicit = await useProjectStore
        .getState()
        .addVideoEffect("video-clip-1", "blur", { radius: 0 });
      expect(explicit?.params.radius).toBe(0);
    });

    it("seeds visible defaults when a pro effect is added without params, and undoes in one step", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip());

      const added = await useProjectStore
        .getState()
        .addVideoEffect("video-clip-1", "mosaic");

      expect(added?.params).toEqual({ size: 12 });
      expect(isProEffectNeutral("mosaic", added!.params)).toBe(false);
      const explicit = await useProjectStore
        .getState()
        .addVideoEffect("video-clip-1", "posterize", { levels: 3 });
      expect(explicit?.params.levels).toBe(3);

      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().getVideoEffects("video-clip-1")).toHaveLength(1);
    });

    it("adds, edits and keyframes a plugin effect with undo, and keeps it when the plugin is missing", async () => {
      const parsed = parsePluginPackage(
        new Map([
          [
            "plugin.json",
            JSON.stringify({
              apiVersion: 1,
              id: "store-demo",
              name: "Store Demo",
              version: "2.3.0",
              category: "Stylize",
              parameters: [{ key: "amount", type: "float", min: 0, max: 100, default: 25 }],
              cpu: { file: "cpu.js" },
            }),
          ],
          ["cpu.js", "function process(frame) {}"],
        ]),
      );
      if (!parsed.ok) throw new Error(parsed.errors.join("; "));
      getPluginRegistry().register(parsed.plugin);
      try {
        useProjectStore.getState().loadProject(createProjectWithVideoClip());

        // Adding seeds every manifest default plus the plugin version.
        const added = await useProjectStore.getState().addVideoEffect("video-clip-1", "plugin:store-demo");
        expect(added?.params).toEqual({ amount: 25, __pluginVersion: "2.3.0" });

        // Parameter edits go through the action system and undo one step at a time.
        await useProjectStore.getState().updateVideoEffect("video-clip-1", added!.id, { amount: 60 });
        expect(useProjectStore.getState().getClip("video-clip-1")?.effects[0].params.amount).toBe(60);
        await useProjectStore.getState().undo();
        expect(useProjectStore.getState().getClip("video-clip-1")?.effects[0].params.amount).toBe(25);
        await useProjectStore.getState().redo();

        // Keyframes ride the shared keyframe store and interpolate at render time.
        const keyframes = [
          { id: "k1", time: 0, property: "effect.plugin:store-demo.amount", value: 0, easing: "linear" },
          { id: "k2", time: 4, property: "effect.plugin:store-demo.amount", value: 100, easing: "linear" },
        ] as never;
        expect(useProjectStore.getState().updateClipKeyframes("video-clip-1", keyframes)).toBe(true);
        const clip = useProjectStore.getState().getClip("video-clip-1")!;
        expect(getAnimatedVideoEffects(clip, 1)[0].params.amount).toBeCloseTo(25, 6);
        expect(getAnimatedVideoEffects(clip, 2)[0].params.amount).toBeCloseTo(50, 6);

        // Removing the plugin leaves the effect, its parameters and keyframes untouched.
        await getPluginRegistry().uninstall("store-demo");
        const kept = useProjectStore.getState().getClip("video-clip-1")!;
        expect(kept.effects[0]).toMatchObject({ type: "plugin:store-demo", params: { amount: 60, __pluginVersion: "2.3.0" } });
        expect(kept.keyframes).toHaveLength(2);
        expect(getAnimatedVideoEffects(kept, 2)[0].params.amount).toBe(60);

        await useProjectStore.getState().undo();
      } finally {
        await getPluginRegistry().uninstall("store-demo");
      }
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

    it("keeps the project's overlay lists (what the preview draws) in step with applied template overlays", () => {
      useProjectStore.getState().loadProject(createProjectWithEditableClip());
      const applicationId = useProjectStore.getState().applyEditingTemplate("branding-lower-third", "video-clip-1");
      expect(applicationId).toBeTruthy();
      const applied = useProjectStore.getState().project;
      expect(applied.shapeClips).toHaveLength(1);
      expect(applied.textClips).toHaveLength(2);
      // The template's width and height survive onto the clip, so the preview and export draw it at its authored size.
      expect(applied.shapeClips?.[0].extent).toEqual({
        width: expect.any(Number),
        height: expect.any(Number),
      });
      useProjectStore.getState().removeEditingTemplateApplication("video-clip-1", applicationId!);
      expect(useProjectStore.getState().project.shapeClips).toHaveLength(0);
      expect(useProjectStore.getState().project.textClips).toHaveLength(0);
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

    it("should remove a marker", async () => {
      await useProjectStore.getState().addMarker(5, "Scene 1");
      const markers = useProjectStore.getState().getMarkers();
      const markerId = markers[0].id;

      await useProjectStore.getState().removeMarker(markerId);

      const updatedMarkers = useProjectStore.getState().getMarkers();
      expect(updatedMarkers.length).toBe(0);
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

  describe("clipboard operations", () => {

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

      const tracksBeforePaste = useProjectStore.getState().project.timeline.tracks.map((track) => track.id);
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
      const pastedShape = useProjectStore
        .getState()
        .getShapeClip(pastedIds[1]);
      expect(pastedShape).toMatchObject({
        startTime: 12,
      });
      expect(pastedShape?.trackId).not.toBe(textTrack.id);
      const stackedTrack = useProjectStore
        .getState()
        .project.timeline.tracks.find((track) => track.id === pastedShape?.trackId);
      expect(stackedTrack?.mode).toBe("standard");
      expect(
        useProjectStore.getState().project.timeline.tracks.indexOf(stackedTrack!),
      ).toBeLessThan(
        useProjectStore.getState().project.timeline.tracks.findIndex(
          (track) => track.id === textTrack.id,
        ),
      );

      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.textClips).toHaveLength(1);
      expect(useProjectStore.getState().project.shapeClips).toHaveLength(1);
      expect(useProjectStore.getState().project.timeline.tracks.map((track) => track.id)).toEqual(tracksBeforePaste);
    });
  });

  describe("separateAudio", () => {
    beforeEach(() => {
      vi.mocked(saveMediaBlob).mockReset().mockResolvedValue(undefined);
      vi.mocked(deleteMediaBlob).mockClear();
      vi.mocked(extractAudioTracks).mockReset().mockImplementation(async (media) =>
        Array.from({ length: media.metadata.audioTrackCount ?? 1 }, (_, index) => ({
          ...media,
          id: `extracted-audio-${index}`,
          name: `Audio ${index + 1}.wav`,
          type: "audio" as const,
          blob: new Blob([`stream-${index}`], { type: "audio/wav" }),
          metadata: { ...media.metadata, hasVideo: false, hasAudio: true, audioTrackCount: 1 },
          waveformData: new Float32Array([index / 10, 0.5]),
        })),
      );
    });

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
      expect(audioTracks[0].clips[0].mediaId).toBe("extracted-audio-0");
      expect(project.mediaLibrary.items.find((media) => media.id === "extracted-audio-0")?.type).toBe("audio");
      expect(saveMediaBlob).toHaveBeenCalledOnce();
    });

    it("should preserve the video clip source range in separated audio", async () => {
      const project = createProjectWithVideoClip(1);
      const videoTrack = project.timeline.tracks[0];
      const trimmedVideoClip = {
        ...videoTrack.clips[0],
        startTime: 4,
        duration: 3,
        inPoint: 2,
        outPoint: 5,
        speed: 1.5,
        reversed: true,
      };
      const trimmedProject = {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: [{ ...videoTrack, clips: [trimmedVideoClip] }],
        },
      };

      useProjectStore.getState().loadProject(trimmedProject);
      const result = await useProjectStore.getState().separateAudio("video-clip-1");

      expect(result.success).toBe(true);
      const audioClip = useProjectStore
        .getState()
        .project.timeline.tracks.find((track) => track.type === "audio")
        ?.clips[0];
      expect(audioClip).toMatchObject({
        startTime: 4,
        duration: 3,
        inPoint: 2,
        outPoint: 5,
        speed: 1.5,
        reversed: true,
      });
    });

    it("should create multiple audio clips when media has multiple audio tracks", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip(3));
      const result = await useProjectStore.getState().separateAudio("video-clip-1");

      expect(result.success).toBe(true);
      const { project } = useProjectStore.getState();
      const audioTracks = project.timeline.tracks.filter((t) => t.type === "audio");
      expect(audioTracks.length).toBe(3);

      // Each source is audio-only: it has one stream, always addressed as 0.
      for (let i = 0; i < 3; i++) {
        expect(audioTracks[i].clips.length).toBe(1);
        expect(audioTracks[i].clips[0].mediaId).toBe(`extracted-audio-${i}`);
        expect(audioTracks[i].clips[0].audioTrackIndex).toBe(0);
        expect(audioTracks[i].clips[0].metadata?.sourceAudioTrackIndex).toBe(i);
      }
      expect(project.timeline.tracks[0].clips[0].volume).toBe(0);
      expect(saveMediaBlob).toHaveBeenCalledTimes(3);
    });

    it("undoes separation and restores video volume in a single step, then redoes it", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip(3));
      expect((await useProjectStore.getState().separateAudio("video-clip-1")).success).toBe(true);
      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.timeline.tracks).toHaveLength(1);
      expect(useProjectStore.getState().getClip("video-clip-1")?.volume).toBe(1);
      await useProjectStore.getState().redo();
      const { project } = useProjectStore.getState();
      expect(project.timeline.tracks.filter((track) => track.type === "audio")).toHaveLength(3);
      expect(useProjectStore.getState().getClip("video-clip-1")?.volume).toBe(0);
    });

    it("leaves the timeline and original audio unchanged when extraction fails", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip(3));
      const before = useProjectStore.getState().project;
      vi.mocked(extractAudioTracks).mockRejectedValueOnce(new Error("Missing stream"));
      const result = await useProjectStore.getState().separateAudio("video-clip-1");
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("Missing stream");
      expect(useProjectStore.getState().project).toBe(before);
      expect(saveMediaBlob).not.toHaveBeenCalled();
    });

    it("leaves the timeline unchanged and cleans stored files if persistence fails", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip(3));
      const before = useProjectStore.getState().project;
      vi.mocked(saveMediaBlob).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Storage quota exceeded"));
      expect((await useProjectStore.getState().separateAudio("video-clip-1")).success).toBe(false);
      expect(useProjectStore.getState().project).toBe(before);
      expect(deleteMediaBlob).toHaveBeenCalledWith("extracted-audio-0");
      expect(deleteMediaBlob).toHaveBeenCalledWith("extracted-audio-1");
    });

    it("keeps edits made while decoding and uses the current clip range", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip(1));
      const extract = vi.mocked(extractAudioTracks).getMockImplementation()!;
      vi.mocked(extractAudioTracks).mockImplementationOnce(async (media) => {
        await useProjectStore.getState().trimClip("video-clip-1", 2, 7);
        await useProjectStore.getState().renameProject("Edited during extraction");
        return extract(media);
      });
      expect((await useProjectStore.getState().separateAudio("video-clip-1")).success).toBe(true);
      const { project } = useProjectStore.getState();
      expect(project.name).toBe("Edited during extraction");
      expect(project.timeline.tracks.find((track) => track.type === "audio")?.clips[0]).toMatchObject({ inPoint: 2, outPoint: 7, duration: 5 });
    });

    it("does not reopen a project that was closed during extraction", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip(1));
      const extract = vi.mocked(extractAudioTracks).getMockImplementation()!;
      vi.mocked(extractAudioTracks).mockImplementationOnce(async (media) => {
        useProjectStore.getState().createNewProject("New project");
        return extract(media);
      });
      expect((await useProjectStore.getState().separateAudio("video-clip-1")).success).toBe(false);
      expect(useProjectStore.getState().project.name).toBe("New project");
      expect(deleteMediaBlob).toHaveBeenCalledWith("extracted-audio-0");
    });

    it("does not duplicate an already separated clip", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip(2));
      expect((await useProjectStore.getState().separateAudio("video-clip-1")).success).toBe(true);
      expect((await useProjectStore.getState().separateAudio("video-clip-1")).success).toBe(false);
      expect(extractAudioTracks).toHaveBeenCalledOnce();
    });

    it("keeps newly separated audio linked to a split segment's durable source", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip(1));
      await useProjectStore.getState().splitClip("video-clip-1", 4);
      const segment = useProjectStore.getState().project.timeline.tracks[0].clips.find((clip) => clip.startTime === 4)!;
      expect((await useProjectStore.getState().separateAudio(segment.id)).success).toBe(true);
      const audio = useProjectStore.getState().project.timeline.tracks.find((track) => track.type === "audio")!.clips[0];
      expect(audio.metadata?.separatedFromClipId).toBe("video-clip-1");
      expect(audio).toMatchObject({ startTime: 4, inPoint: 4, duration: 6 });
      expect((await useProjectStore.getState().separateAudio(segment.id)).success).toBe(false);
      expect(extractAudioTracks).toHaveBeenCalledOnce();
    });

    it("avoids occupied and locked audio tracks", async () => {
      const initial = createProjectWithVideoClip(2);
      const occupied = {
        ...initial.timeline.tracks[0], id: "occupied-audio", type: "audio" as const,
        clips: [{ ...initial.timeline.tracks[0].clips[0], id: "existing-audio", trackId: "occupied-audio" }],
      };
      initial.timeline.tracks.push(occupied, { ...occupied, id: "locked-audio", clips: [], locked: true });
      useProjectStore.getState().loadProject(initial);
      const result = await useProjectStore.getState().separateAudio("video-clip-1");
      expect(result.success).toBe(true);
      const tracks = useProjectStore.getState().project.timeline.tracks;
      expect(tracks.find((track) => track.id === "occupied-audio")?.clips).toHaveLength(1);
      expect(tracks.find((track) => track.id === "locked-audio")?.clips).toHaveLength(0);
      expect(tracks.filter((track) => track.type === "audio")).toHaveLength(4);
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

  it("creates editable Pop words captions using the shared word animation renderer", async () => {
    await useProjectStore
      .getState()
      .addSubtitle(
        {
          id: "pop-caption",
          text: "One two three",
          startTime: 1,
          endTime: 4,
          animationStyle: "word-by-word",
        },
        { captionSource: "whisper" },
      );
    const caption = useProjectStore
      .getState()
      .getAllTextClips()
      .find((clip) => clip.text === "One two three")!;
    expect(caption.animation).toMatchObject({
      preset: "pop",
      unit: "word",
      stagger: 1,
      inDuration: 2.12,
      outDuration: 0,
    });
    const wordOpacity = (index: number, time: number) =>
      textAnimationEngine.getAnimatedState(caption, time).characterStates?.[
        [0, 4, 8][index]
      ].opacity;
    expect([0, 1, 2].map((index) => wordOpacity(index, 0.5))).toEqual([1, 0, 0]);
    expect([0, 1, 2].map((index) => wordOpacity(index, 1.5))).toEqual([1, 1, 0]);
    expect([0, 1, 2].map((index) => wordOpacity(index, 2.5))).toEqual([1, 1, 1]);
    const animated = textAnimationEngine.getAnimatedState(
      {
        ...caption,
        keyframes: [
          {
            id: "opacity",
            time: 0,
            property: "opacity",
            value: 0.5,
            easing: "linear",
          },
        ],
      },
      0.5,
    );
    expect(animated.opacity).toBe(0.5);
    expect(animated.characterStates?.[4].opacity).toBe(0);
    expect(caption.metadata?.captionSource).toBe("whisper");
    expect(
      useEngineStore.getState().getTitleEngine()?.getTextClip(caption.id)
        ?.animation,
    ).toEqual(caption.animation);
    const saved = structuredClone(useProjectStore.getState().project);
    useProjectStore.getState().loadProject(saved);
    expect(useProjectStore.getState().getTextClip(caption.id)?.animation).toEqual(
      caption.animation,
    );
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
      (track) => track.role === "captions" && track.name === "Captions",
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
      (track) => track.role === "captions" && track.name === "Captions",
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

describe("ProjectStore - smooth keyframe interpolation", () => {
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

  const key = (id: string, time: number, value: number) => ({ id, time, property: "opacity", value, easing: "linear" as const });
  const keysOf = () => useProjectStore.getState().getClip("video-clip-1")!.keyframes!;

  beforeEach(() => {
    useProjectStore.getState().loadProject(createProjectWithVideoClip());
    registerSmoothKeyframeRefresh(refreshSmoothKeyframesAfterEdit);
  });

  it("re-derives Auto Bezier sides when a neighbour changes, whichever path edits the keys", () => {
    const store = useProjectStore.getState();
    const auto = applyKeyframeInterpolation([key("a", 0, 0), key("b", 1, 1), key("c", 2, 3)], ["b"], "auto-bezier");
    store.updateClipKeyframes("video-clip-1", auto, { derived: true });
    const before = keysOf().find((k) => k.id === "b")!.bezierHandles;
    store.updateClipKeyframes("video-clip-1", keysOf().map((k) => (k.id === "c" ? { ...k, value: 9 } : k)));
    expect(keysOf().find((k) => k.id === "b")!.bezierHandles).not.toEqual(before);
    expect(keysOf().find((k) => k.id === "b")).toMatchObject({ interpolationIn: "auto-bezier", interpolationOut: "auto-bezier" });
  });

  it("an easing change through any path drops the stale Auto tag so the label matches the curve", () => {
    const store = useProjectStore.getState();
    store.updateClipKeyframes("video-clip-1", applyKeyframeInterpolation([key("a", 0, 0), key("b", 1, 1), key("c", 2, 3)], ["b"], "auto-bezier"), { derived: true });
    store.updateClipKeyframes("video-clip-1", keysOf().map((k) => (k.id === "b" ? { ...k, easing: "ease-out" as const } : k)));
    const b = keysOf().find((k) => k.id === "b")!;
    expect(b.easing).toBe("ease-out");
    expect(b.interpolationOut).toBeUndefined();
    expect(b.interpolationIn).toBe("auto-bezier");
  });

  it("leaves legacy keyframes untouched", () => {
    const legacy = [key("a", 0, 0), key("b", 1, 1)];
    useProjectStore.getState().updateClipKeyframes("video-clip-1", legacy);
    expect(keysOf()).toEqual(legacy);
  });

  describe("spatial position path edits", () => {
    const pos = (id: string, property: "position.x" | "position.y", time: number, value: number) => ({ id, time, property, value, easing: "linear" as const });
    const seed = () => useProjectStore.getState().updateClipKeyframes("video-clip-1", [
      pos("x0", "position.x", 0, 0), pos("y0", "position.y", 0, 0),
      pos("x1", "position.x", 1, 100), pos("y1", "position.y", 1, 80),
      pos("x2", "position.x", 2, 200), pos("y2", "position.y", 2, 0),
    ]);

    it("applies a spatial type, drags a handle and moves a key as one undo step each, persisted on the clip", async () => {
      const { applySpatialInterpolationToClip, setSpatialHandleOnClip, moveSpatialVertexOnClip } = await import("../services/spatial-path-edit");
      seed();
      const depth = () => useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();
      const base = depth();
      expect(applySpatialInterpolationToClip("video-clip-1", ["y1"], "auto-bezier")).toBe(true);
      expect(keysOf().find((k) => k.id === "x1")!.spatialMode).toBe("auto-bezier");
      expect(depth()).toBe(base + 1);
      expect(setSpatialHandleOnClip("video-clip-1", "x1", "out", { x: 10, y: 70 })).toBe(true);
      expect(keysOf().find((k) => k.id === "x1")).toMatchObject({ spatialMode: "continuous-bezier", spatialOut: { x: 10, y: 70 } });
      expect(depth()).toBe(base + 2);
      expect(moveSpatialVertexOnClip("video-clip-1", 1, 120, 90)).toBe(true);
      expect(keysOf().find((k) => k.id === "x1")!.value).toBe(120);
      expect(keysOf().find((k) => k.id === "y1")!.value).toBe(90);
      expect(depth()).toBe(base + 3);
      await useProjectStore.getState().undo();
      expect(keysOf().find((k) => k.id === "x1")!.value).toBe(100);
      await useProjectStore.getState().undo();
      expect(keysOf().find((k) => k.id === "x1")!.spatialMode).toBe("auto-bezier");
      await useProjectStore.getState().undo();
      expect(keysOf().find((k) => k.id === "x1")!.spatialMode).toBeUndefined();
    });

    it("refuses edits on a locked track, with no path, or for a missing clip", async () => {
      const { applySpatialInterpolationToClip, setSpatialHandleOnClip } = await import("../services/spatial-path-edit");
      expect(applySpatialInterpolationToClip("video-clip-1", ["x0"], "bezier")).toBe(false); // no keyframes yet
      expect(applySpatialInterpolationToClip("nope", ["x0"], "bezier")).toBe(false);
      seed();
      const project = useProjectStore.getState().project;
      useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map((t) => ({ ...t, locked: true })) } } });
      expect(setSpatialHandleOnClip("video-clip-1", "x1", "out", { x: 1, y: 1 })).toBe(false);
      expect(keysOf().find((k) => k.id === "x1")!.spatialMode).toBeUndefined();
    });
  });
});
