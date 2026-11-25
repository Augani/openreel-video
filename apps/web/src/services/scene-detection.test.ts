import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import {
  applySceneCuts,
  planSceneCuts,
  sceneDetectionBlockReason,
  sourceToTimelineTime,
  type SceneAnalysis,
} from "./scene-detection";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
  rotation: 0,
};

function clip(id: string, trackId: string, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    trackId,
    mediaId: "video",
    startTime: 0,
    duration: 5,
    inPoint: 10,
    outPoint: 20,
    speed: 2,
    volume: 1,
    fade: { fadeIn: 0.5, fadeOut: 0.5 },
    effects: [],
    audioEffects: [],
    keyframes: [],
    transform,
    ...extra,
  };
}

function track(id: string, type: Track["type"], clips: Clip[], locked = false): Track {
  return { id, name: id, type, hidden: false, locked, muted: false, solo: false, transitions: [], clips };
}

function fixture(options: { audioLocked?: boolean; videoExtra?: Partial<Clip> } = {}): Project {
  const base = createEmptyProject("Scenes");
  return {
    ...base,
    settings: { ...base.settings, frameRate: 30 },
    mediaLibrary: {
      items: [
        {
          id: "video",
          name: "Source.mp4",
          type: "video",
          fileHandle: null,
          blob: new Blob(["video"]),
          thumbnailUrl: null,
          waveformData: null,
          metadata: { duration: 30, width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2, codec: "h264", fileSize: 5 },
        },
      ],
    },
    timeline: {
      ...base.timeline,
      duration: 5,
      markers: [],
      tracks: [
        track("v", "video", [clip("vid", "v", options.videoExtra)]),
        track("a", "audio", [
          clip("aud", "a", { metadata: { separatedFromClipId: "vid" } }),
        ], options.audioLocked),
      ],
    },
  };
}

const analysisFor = (cuts: number[], over: Partial<SceneAnalysis> = {}): SceneAnalysis => ({
  projectId: useProjectStore.getState().project.id,
  clipId: "vid",
  mediaId: "video",
  cuts: cuts.map((time) => ({ time, score: 0.9 })),
  ...over,
});
const clipsOf = (id: string) =>
  useProjectStore.getState().project.timeline.tracks.find((t) => t.id === id)!.clips;

beforeEach(() => {
  useProjectStore.getState().loadProject(fixture());
  useEditorWorkspaceStore.getState().setLinkedSelection(true);
});

describe("source to timeline mapping", () => {
  it("honours clip speed and in point", () => {
    const c = clip("c", "v", { startTime: 3 });
    expect(sourceToTimelineTime(c, 14)).toBe(5);
  });
  it("inverts a speed ramp", () => {
    const c = clip("c", "v", {
      speed: 1,
      inPoint: 0,
      outPoint: 10,
      duration: 10,
      speedKeyframes: [
        { id: "k0", time: 0, speed: 1, easing: "linear" },
        { id: "k1", time: 10, speed: 1, easing: "linear" },
      ],
    });
    expect(sourceToTimelineTime(c, 4)).toBeCloseTo(4, 3);
  });
});

describe("applySceneCuts", () => {
  it("splits video and linked audio in exactly one undo step, preserving source ranges", async () => {
    const before = useProjectStore.getState().project.timeline.tracks.map((t) => t.clips);
    // Source 14 => 2s, source 18 => 4s on the timeline at speed 2.
    const result = await applySceneCuts(analysisFor([14, 18]), { splitClip: true, addMarkers: false });
    expect(result).toMatchObject({ splits: 2, markers: 0, skippedLockedLinked: 0 });
    const video = clipsOf("v");
    expect(video).toHaveLength(3);
    expect(video.map((c) => [c.startTime, c.duration, c.inPoint, c.outPoint])).toEqual([
      [0, 2, 10, 14],
      [2, 2, 14, 18],
      [4, 1, 18, 20],
    ]);
    expect(clipsOf("a")).toHaveLength(3);
    expect(video.every((c) => c.speed === 2)).toBe(true);

    await useProjectStore.getState().undo();
    expect(clipsOf("v")).toEqual(before[0]);
    expect(clipsOf("a")).toEqual(before[1]);
    await useProjectStore.getState().redo();
    expect(clipsOf("v")).toHaveLength(3);
  });

  it("adds markers and splits together as one undo step", async () => {
    await applySceneCuts(analysisFor([14]), { splitClip: true, addMarkers: true });
    expect(useProjectStore.getState().project.timeline.markers.map((m) => m.time)).toEqual([2]);
    expect(clipsOf("v")).toHaveLength(2);
    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.timeline.markers).toHaveLength(0);
    expect(clipsOf("v")).toHaveLength(1);
  });

  it("can add markers without splitting", async () => {
    const result = await applySceneCuts(analysisFor([14]), { splitClip: false, addMarkers: true });
    expect(result).toMatchObject({ splits: 0, markers: 1 });
    expect(clipsOf("v")).toHaveLength(1);
  });

  it("recomputes cut times when the clip moved or was trimmed since analysis", async () => {
    // Move the clip 10s later: timeline cut must follow.
    const project = useProjectStore.getState().project;
    project.timeline.tracks[0].clips[0] = { ...project.timeline.tracks[0].clips[0], startTime: 10 };
    project.timeline.tracks[1].clips[0] = { ...project.timeline.tracks[1].clips[0], startTime: 10 };
    useProjectStore.getState().loadProject({ ...project });
    const result = await applySceneCuts(analysisFor([14, 25]), { splitClip: true, addMarkers: false });
    expect(result.splits).toBe(1);
    expect(result.droppedCuts).toBe(1); // 25 is outside the clip's source range
    expect(clipsOf("v").map((c) => c.startTime)).toEqual([10, 12]);
  });

  it("skips and reports linked audio on a locked track", async () => {
    useProjectStore.getState().loadProject(fixture({ audioLocked: true }));
    const result = await applySceneCuts(analysisFor([14]), { splitClip: true, addMarkers: false });
    expect(result.skippedLockedLinked).toBe(1);
    expect(clipsOf("v")).toHaveLength(2);
    expect(clipsOf("a")).toHaveLength(1);
  });

  it("leaves audio alone when linked selection is off", async () => {
    useEditorWorkspaceStore.getState().setLinkedSelection(false);
    await applySceneCuts(analysisFor([14]), { splitClip: true, addMarkers: false });
    expect(clipsOf("v")).toHaveLength(2);
    expect(clipsOf("a")).toHaveLength(1);
  });

  it("refuses a locked video track", async () => {
    const project = fixture();
    project.timeline.tracks[0] = { ...project.timeline.tracks[0], locked: true };
    useProjectStore.getState().loadProject(project);
    await expect(
      applySceneCuts(analysisFor([14]), { splitClip: true, addMarkers: false }),
    ).rejects.toThrow(/Unlock/);
  });

  it("rejects stale analyses from another project or source", async () => {
    await expect(
      applySceneCuts(analysisFor([14], { projectId: "other" }), { splitClip: true, addMarkers: false }),
    ).rejects.toThrow(/project changed/);
    await expect(
      applySceneCuts(analysisFor([14], { mediaId: "other" }), { splitClip: true, addMarkers: false }),
    ).rejects.toThrow(/source changed/);
  });

  it("rejects reversed clips", async () => {
    useProjectStore.getState().loadProject(fixture({ videoExtra: { reversed: true } }));
    expect(sceneDetectionBlockReason(useProjectStore.getState().project, "vid")).toMatch(/Reversed/);
    expect(() =>
      planSceneCuts(useProjectStore.getState().project, analysisFor([14]), true),
    ).toThrow(/Reversed/);
    await expect(
      applySceneCuts(analysisFor([14]), { splitClip: true, addMarkers: false }),
    ).rejects.toThrow(/Reversed/);
  });
});

describe("dissolves, fades and subclips", () => {
  const edits = [
    { kind: "cut" as const, time: 12, start: 12, end: 12, score: 0.9 },
    { kind: "dissolve" as const, time: 15, start: 14.5, end: 15.5, score: 0.8 },
    { kind: "fade-through-black" as const, time: 18, start: 17.5, end: 18.5, score: 1 },
  ];
  const withEdits = () => analysisFor([12], { edits });

  it("plans every kind of edit, not only hard cuts, in timeline time", () => {
    const plan = planSceneCuts(useProjectStore.getState().project, withEdits(), true);
    // Speed 2, in point 10: source 12 / 15 / 18 map to 1 / 2.5 / 4 seconds on the timeline.
    expect(plan.times).toEqual([1, 2.5, 4]);
    expect(plan.kinds).toEqual(["cut", "dissolve", "fade-through-black"]);
  });

  it("applies cuts and labelled markers together as one undo step", async () => {
    const result = await applySceneCuts(withEdits(), { splitClip: true, addMarkers: true });
    expect(result).toMatchObject({ splits: 3, markers: 3 });
    expect(clipsOf("v")).toHaveLength(4);
    expect(useProjectStore.getState().project.timeline.markers.map((m) => m.label)).toEqual(["Cut 1", "Dissolve 2", "Fade 3"]);
    await useProjectStore.getState().undo();
    expect(clipsOf("v")).toHaveLength(1);
    expect(useProjectStore.getState().project.timeline.markers).toHaveLength(0);
  });

  it("creates one bin subclip per scene, without touching the timeline, in one undo step", async () => {
    const before = useProjectStore.getState().project.mediaLibrary.items.length;
    const result = await applySceneCuts(withEdits(), { splitClip: false, addMarkers: false, createSubclips: true });
    expect(result).toMatchObject({ splits: 0, markers: 0, subclips: 4 });
    expect(clipsOf("v")).toHaveLength(1);
    const items = useProjectStore.getState().project.mediaLibrary.items;
    expect(items).toHaveLength(before + 4);
    const subclips = items.filter((i) => i.subclip).map((i) => [i.subclip!.parentId, i.subclip!.inPoint, i.subclip!.outPoint]);
    expect(subclips).toEqual([["video", 10, 12], ["video", 12, 15], ["video", 15, 18], ["video", 18, 20]]);
    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.mediaLibrary.items).toHaveLength(before);
  });

  it("does everything at once as a single history entry", async () => {
    const history = () => useProjectStore.getState().actionHistory.getHistory().length;
    const h = history();
    await applySceneCuts(withEdits(), { splitClip: true, addMarkers: true, createSubclips: true });
    expect(history()).toBe(h + 1);
  });
});
