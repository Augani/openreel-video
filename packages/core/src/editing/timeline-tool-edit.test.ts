import { describe, expect, it, vi } from "vitest";
import { TitleEngine } from "../text/title-engine";
import {
  MOTION_SHADER_LIBRARY,
  defaultMotionShaderParams,
} from "../motion/shaders";
import { ActionExecutor } from "../actions/action-executor";
import type { Clip, Track } from "../types/timeline";
import type { Project, MediaItem } from "../types/project";
import {
  applyTimelineToolEdits,
  invertTimelineToolEdits,
  prepareTimelineToolEdit,
  validateTimelineToolEdits,
} from "./timeline-tool-edit";
const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};
const clip = (id: string, trackId: string, startTime = 10): Clip => ({
  id,
  trackId,
  mediaId: "source",
  startTime,
  duration: 4,
  inPoint: 4,
  outPoint: 12,
  speed: 2,
  effects: [],
  audioEffects: [],
  transform,
  volume: 1,
  keyframes: [],
});
const track = (id: string, clips: Clip[]): Track => ({
  id,
  name: id,
  type: "video",
  clips,
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
});
function fixture(): Project {
  const media: MediaItem = {
    id: "source",
    name: "Source.mp4",
    type: "video",
    fileHandle: null,
    blob: new Blob(["source"]),
    thumbnailUrl: null,
    waveformData: new Float32Array(100000),
    metadata: {
      duration: 20,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      sampleRate: 48000,
      channels: 2,
      fileSize: 6,
    },
  };
  return {
    id: "project",
    name: "Tool edit",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    mediaLibrary: { items: [media] },
    timeline: {
      tracks: [
        track("main", [clip("primary", "main"), clip("tail", "main", 14)]),
        track("dialogue", [
          clip("audio", "dialogue"),
          clip("audio-tail", "dialogue", 14),
        ]),
      ],
      duration: 18,
      markers: [],
      subtitles: [],
    },
    textClips: [],
  };
}
const find = (p: Project, id: string) =>
  p.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
describe("existing clip/slip action", () => {
  it.each([-100, 1, 100])(
    "preserves the actual source span at speed two for delta %s and restores Undo/Redo",
    async (delta) => {
      const project = fixture(),
        original = { ...find(project, "primary") },
        executor = new ActionExecutor();
      Object.assign(project.mediaLibrary.items[0].waveformData!, {
        toJSON() {
          throw new Error("Do not serialize waveforms");
        },
      });
      const result = await executor.execute(
        {
          type: "clip/slip",
          id: "slip",
          timestamp: 1,
          params: { clipId: "primary", delta },
        },
        project,
      );
      expect(result.success).toBe(true);
      const inPoint = Math.max(0, Math.min(12, 4 + delta));
      expect(find(project, "primary")).toMatchObject({
        inPoint,
        outPoint: inPoint + 8,
        duration: 4,
        startTime: 10,
      });
      expect((await executor.undo(project)).success).toBe(true);
      expect(find(project, "primary")).toEqual(original);
      expect((await executor.redo(project)).success).toBe(true);
      expect(find(project, "primary").inPoint).toBe(inPoint);
    },
  );
  it.each(["locked", "infinite", "short-source"])(
    "rejects %s without changing project or history",
    async (reason) => {
      const project = fixture(),
        executor = new ActionExecutor();
      if (reason === "locked")
        project.timeline.tracks[0] = {
          ...project.timeline.tracks[0],
          locked: true,
        };
      if (reason === "short-source")
        project.mediaLibrary.items[0] = {
          ...project.mediaLibrary.items[0],
          metadata: { ...project.mediaLibrary.items[0].metadata, duration: 6 },
        };
      const original = { ...find(project, "primary") };
      expect(
        (
          await executor.execute(
            {
              type: "clip/slip",
              id: "slip",
              timestamp: 1,
              params: {
                clipId: "primary",
                delta: reason === "infinite" ? Infinity : 1,
              },
            },
            project,
          )
        ).success,
      ).toBe(false);
      expect(find(project, "primary")).toEqual(original);
      expect(executor.getHistory().canUndo()).toBe(false);
    },
  );
  it("keeps compound clip and nested-instance source bounds identical through Undo", async () => {
    const project = fixture(),
      executor = new ActionExecutor();
    project.timeline.tracks[0].clips[0] = {
      ...find(project, "primary"),
      metadata: { compoundClipId: "compound" },
    };
    Object.assign(project, {
      compoundClips: [{ id: "compound", content: { duration: 16 } }],
      nestedInstances: [
        {
          id: "primary",
          compoundClipId: "compound",
          trackId: "main",
          startTime: 10,
          duration: 4,
          inPoint: 4,
          outPoint: 12,
        },
      ],
    });
    expect(
      (
        await executor.execute(
          {
            type: "clip/slip",
            id: "slip",
            timestamp: 1,
            params: { clipId: "primary", delta: 100 },
          },
          project,
        )
      ).success,
    ).toBe(true);
    expect(project.nestedInstances?.[0]).toMatchObject({
      inPoint: 8,
      outPoint: 16,
    });
    await executor.undo(project);
    expect(project.nestedInstances?.[0]).toMatchObject({
      inPoint: 4,
      outPoint: 12,
    });
  });
});
function edit(
  p: Project,
  mode: "slip" | "ripple",
  delta: number,
  edge: "left" | "right" = "right",
  linkedIds = ["audio"],
) {
  const plan = prepareTimelineToolEdit(p, {
    mode,
    itemId: "primary",
    linkedIds,
    edge,
  }).plan(delta);
  validateTimelineToolEdits(p, plan.edits);
  return { plan, next: applyTimelineToolEdits(p, plan.edits) };
}
describe("timeline tool timing plans", () => {
  it("slips linked streams without moving clips, changing source span or touching followers", () => {
    const p = fixture(),
      { next } = edit(p, "slip", 1);
    for (const id of ["primary", "audio"])
      expect(find(next, id)).toMatchObject({
        startTime: 10,
        duration: 4,
        inPoint: 6,
        outPoint: 14,
        speed: 2,
      });
    expect(find(next, "tail")).toBe(find(p, "tail"));
    expect(p.mediaLibrary).toBe(next.mediaLibrary);
    expect(find(p, "primary").inPoint).toBe(4);
  });
  it.each([
    [-100, 0, 8],
    [100, 12, 20],
  ])(
    "clamps a slip of %s to the common source handles",
    (delta, input, output) => {
      const { next } = edit(fixture(), "slip", delta);
      expect(find(next, "primary")).toMatchObject({
        inPoint: input,
        outPoint: output,
        duration: 4,
      });
    },
  );
  it("uses the tightest linked source bound", () => {
    const p = fixture();
    p.timeline.tracks[1].clips[0] = { ...find(p, "audio"), mediaId: "short" };
    p.mediaLibrary.items.push({
      ...p.mediaLibrary.items[0],
      id: "short",
      metadata: { ...p.mediaLibrary.items[0].metadata, duration: 14 },
    });
    const { plan, next } = edit(p, "slip", 100);
    expect(plan.delta).toBe(1);
    expect(find(next, "primary").outPoint).toBe(14);
  });
  it.each(["left", "right"] as const)(
    "ripple trims the %s edge and shifts downstream linked tracks once",
    (edge) => {
      const p = fixture(),
        { next } = edit(p, "ripple", 1, edge);
      const delta = edge === "left" ? -1 : 1;
      expect(find(next, "primary")).toMatchObject({
        startTime: 10,
        duration: 4 + delta,
        inPoint: edge === "left" ? 6 : 4,
        outPoint: edge === "right" ? 14 : 12,
      });
      expect(find(next, "tail").startTime).toBe(14 + delta);
      expect(find(next, "audio-tail").startTime).toBe(14 + delta);
      expect(next.timeline.duration).toBe(18 + delta);
    },
  );
  it.each(["left", "right"] as const)(
    "trims the correct source bound for a reversed %s edge",
    (edge) => {
      const p = fixture();
      p.timeline.tracks.forEach((t) => {
        t.clips[0] = { ...t.clips[0], reversed: true };
      });
      const { next } = edit(p, "ripple", 1, edge);
      expect(find(next, "primary")).toMatchObject(
        edge === "left"
          ? { inPoint: 4, outPoint: 10, duration: 3 }
          : { inPoint: 2, outPoint: 12, duration: 5 },
      );
    },
  );
  it("keeps a one-frame minimum and generated exit keys finite", () => {
    const p = fixture();
    p.timeline.tracks[0].clips[0] = {
      ...find(p, "primary"),
      keyframes: [
        {
          id: "kf-exit-a",
          time: 3.5,
          property: "opacity",
          value: 1,
          easing: "linear",
        },
      ],
    };
    const { next } = edit(p, "ripple", -100);
    expect(find(next, "primary").duration).toBeCloseTo(1 / 30);
    expect(find(next, "primary").keyframes[0].time).toBe(0);
  });
  it("lets still images extend without inventing a video source bound", () => {
    const p = fixture();
    p.mediaLibrary.items[0] = {
      ...p.mediaLibrary.items[0],
      type: "image",
      metadata: { ...p.mediaLibrary.items[0].metadata, duration: 0 },
    };
    const { next } = edit(p, "ripple", 20, "right", []);
    expect(find(next, "primary").duration).toBe(24);
    expect(() => edit(p, "slip", 1, "right", [])).toThrow(/Slip requires/);
  });
  it("moves every universal-track follower kind and retains unrelated track content", () => {
    const p = fixture();
    // An unrelated track only stays put when Sync Lock is off (default is on).
    p.timeline.tracks[1] = { ...p.timeline.tracks[1], syncLock: false };
    for (const field of [
      "textClips",
      "shapeClips",
      "svgClips",
      "stickerClips",
      "adjustmentLayers",
      "motionInstances",
    ] as const)
      Object.assign(p, {
        [field]: [{ id: field, trackId: "main", startTime: 14, duration: 2 }],
      });
    const { next } = edit(p, "ripple", 1, "right", []);
    for (const field of [
      "textClips",
      "shapeClips",
      "svgClips",
      "stickerClips",
      "adjustmentLayers",
      "motionInstances",
    ] as const)
      expect(next[field]?.[0].startTime).toBe(15);
    expect(find(next, "audio-tail").startTime).toBe(14);
  });
  it("retimes and removes linked captions without losing their styles on Undo", () => {
    const p = fixture();
    Object.assign(p, {
      textClips: [
        {
          id: "early",
          trackId: "main",
          startTime: 10,
          duration: 1,
          text: "Early",
          style: { fontFamily: "Inter" },
          metadata: { captionSourceClipId: "primary" },
          keyframes: [],
        },
        {
          id: "late",
          trackId: "main",
          startTime: 12,
          duration: 2,
          text: "Late",
          style: { color: "red" },
          metadata: { captionSourceClipId: "primary" },
          keyframes: [],
        },
      ],
    });
    const { plan, next } = edit(p, "slip", 1);
    expect(next.textClips?.map((c) => c.id)).toEqual(["late"]);
    expect(next.textClips?.[0]).toMatchObject({
      startTime: 11,
      duration: 2,
      style: { color: "red" },
    });
    const restored = applyTimelineToolEdits(
      next,
      invertTimelineToolEdits(plan.edits),
    );
    expect(restored.textClips).toEqual(p.textClips);
  });
  it("refuses locked linked or grouped follower tracks atomically", () => {
    const p = fixture();
    p.timeline.tracks[1] = { ...p.timeline.tracks[1], locked: true };
    expect(() => edit(p, "ripple", 1)).toThrow(/Unlock/);
    p.timeline.tracks[0] = { ...p.timeline.tracks[0], groupId: "g" };
    p.timeline.tracks[1] = { ...p.timeline.tracks[1], groupId: "g" };
    expect(() => edit(p, "ripple", 1, "right", [])).toThrow(/Unlock/);
    expect(find(p, "tail").startTime).toBe(14);
  });
  it("rejects stale entity data and mismatched linked cut points without applying a partial edit", () => {
    const p = fixture(),
      plan = prepareTimelineToolEdit(p, {
        mode: "slip",
        itemId: "primary",
      }).plan(1);
    p.timeline.tracks[0].clips[0] = { ...find(p, "primary"), volume: 0.5 };
    expect(() => validateTimelineToolEdits(p, plan.edits)).toThrow(/changed/);
    p.timeline.tracks[1].clips[0] = {
      ...find(p, "audio"),
      startTime: 0,
      duration: 20,
    };
    expect(() => edit(p, "ripple", 1)).toThrow(/linked edit points differ/);
  });
  it("keeps the compound instance timing aligned and bounds slips to compound content", () => {
    const p = fixture();
    p.timeline.tracks[0].clips[0] = {
      ...find(p, "primary"),
      metadata: { compoundClipId: "compound" },
      mediaId: "compound",
    };
    Object.assign(p, {
      compoundClips: [{ id: "compound", content: { duration: 16 } }],
      nestedInstances: [
        {
          id: "primary",
          compoundClipId: "compound",
          trackId: "main",
          startTime: 10,
          duration: 4,
          inPoint: 4,
          outPoint: 12,
        },
      ],
    });
    const { next } = edit(p, "slip", 100, "right", []);
    expect(find(next, "primary").outPoint).toBe(16);
    expect(next.nestedInstances?.[0]).toMatchObject({
      inPoint: 8,
      outPoint: 16,
      duration: 4,
    });
  });
  it("records bounded, owned actions and restores source/timeline bounds through real Undo and Redo", async () => {
    const p = fixture();
    Object.defineProperty(p.mediaLibrary.items[0].waveformData!, "toJSON", {
      value: () => {
        throw new Error("Waveform traversed");
      },
    });
    const executor = new ActionExecutor(),
      plan = prepareTimelineToolEdit(p, {
        mode: "ripple",
        itemId: "primary",
        linkedIds: ["audio"],
      }).plan(1);
    const action = {
      type: "timeline/toolEdit",
      id: "edit",
      timestamp: 1,
      params: { edits: plan.edits, label: plan.label },
    };
    expect((await executor.execute(action, p)).success).toBe(true);
    expect(find(p, "tail").startTime).toBe(15);
    expect(executor.getHistory().getDisplayHistory()).toHaveLength(1);
    // Mutating the caller's plan must not change the recorded redo action.
    (plan.edits[0].after as { duration: number }).duration = 99;
    expect((await executor.undo(p)).success).toBe(true);
    expect(find(p, "primary")).toMatchObject({
      duration: 4,
      inPoint: 4,
      outPoint: 12,
    });
    expect(find(p, "tail").startTime).toBe(14);
    expect((await executor.redo(p)).success).toBe(true);
    expect(find(p, "primary").duration).toBe(5);
    expect(p.mediaLibrary.items[0].blob).toBeInstanceOf(Blob);
  });
  it("returns no edit at zero delta and previews without walking or serializing project data", () => {
    const p = fixture(),
      prepared = prepareTimelineToolEdit(p, {
        mode: "slip",
        itemId: "primary",
      });
    expect(prepared.plan(0).edits).toEqual([]);
    const stringify = JSON.stringify;
    Object.defineProperty(p.mediaLibrary.items[0], "toJSON", {
      value: () => {
        throw new Error("Media traversed");
      },
    });
    for (let i = 0; i < 60; i++)
      expect(prepared.preview(i / 60).duration).toBe(4);
    expect(JSON.stringify).toBe(stringify);
  });
});

describe("group captions and prepared preview ownership", () => {
  function captionProject() {
    const p = fixture();
    Object.assign(p.timeline, {
      tracks: p.timeline.tracks.map((track) => ({
        ...track,
        groupId: "g",
      })),
    });
    p.timeline.tracks.push({
      ...track("captions", []),
      type: "text",
      groupId: "g",
    });
    Object.assign(p, {
      textClips: [
        new TitleEngine().createTextClip({
          id: "caption",
          trackId: "captions",
          startTime: 10.5,
          duration: 1,
          text: "Keep every material",
        }),
      ],
    });
    return p;
  }
  it.each(MOTION_SHADER_LIBRARY.map((def) => [def.id, def] as const))(
    "preserves the complete %s material record through a group-only Slip and Undo/Redo",
    async (_id, def) => {
      const p = captionProject(),
        executor = new ActionExecutor();
      Object.assign(p, {
        textClips: [
          {
            ...p.textClips![0],
            style: {
              ...p.textClips![0].style,
              shader: {
                shaderId: def.id,
                params: defaultMotionShaderParams(def),
                progress: 0.37,
              },
            },
          },
        ],
      });
      const original = structuredClone(p.textClips![0]);
      const plan = prepareTimelineToolEdit(p, {
        mode: "slip",
        itemId: "primary",
        linkedIds: ["audio"],
      }).plan(0.5);
      expect(plan.edits.filter((edit) => edit.id === "caption")).toHaveLength(
        1,
      );
      expect(
        (
          await executor.execute(
            {
              type: "timeline/toolEdit",
              id: `material-${def.id}`,
              timestamp: 1,
              params: { edits: plan.edits },
            },
            p,
          )
        ).success,
      ).toBe(true);
      expect(p.textClips![0]).toMatchObject({
        startTime: 10,
        duration: 1,
        style: original.style,
      });
      expect((await executor.undo(p)).success).toBe(true);
      expect(p.textClips![0]).toEqual(original);
      expect((await executor.redo(p)).success).toBe(true);
      expect(p.textClips![0].style).toEqual(original.style);
    },
  );
  it("moves a grouped follower caption once and leaves foreign explicit source provenance alone", () => {
    const p = captionProject();
    Object.assign(p, {
      textClips: [
        {
          ...p.textClips![0],
          id: "follower-caption",
          startTime: 14.5,
          metadata: { captionSourceClipId: "tail" },
        },
        {
          ...p.textClips![0],
          id: "foreign-caption",
          metadata: { captionSourceClipId: "audio" },
        },
      ],
    });
    const next = edit(p, "slip", 0.5, "right", []).next;
    expect(next.textClips).toEqual(p.textClips);
    const ripple = edit(p, "ripple", 1, "right", []).next;
    expect(ripple.textClips![0].startTime).toBe(15.5);
    expect(ripple.textClips![1]).toEqual(p.textClips![1]);
  });
  it("does not snapshot unchanged captions or reject a no-op caption on a locked track", () => {
    const p = captionProject();
    p.timeline.tracks[2] = { ...p.timeline.tracks[2], locked: true };
    const { plan, next } = edit(p, "ripple", 1);
    expect(plan.edits.some((edit) => edit.id === "caption")).toBe(false);
    expect(next.textClips).toBe(p.textClips);
  });
  it("rejects an actual linked-caption edit on a locked track atomically", () => {
    const p = captionProject();
    p.timeline.tracks[2] = { ...p.timeline.tracks[2], locked: true };
    expect(() => edit(p, "slip", 0.5)).toThrow(/Unlock/);
    expect(p.textClips![0].startTime).toBe(10.5);
  });
  it("retains short existing caption cues instead of deleting them for being shorter than a video frame", () => {
    const p = captionProject();
    Object.assign(p, { textClips: [{ ...p.textClips![0], duration: 0.01 }] });
    const { next } = edit(p, "slip", 0.1);
    expect(next.textClips).toHaveLength(1);
    expect(next.textClips![0].startTime).toBeCloseTo(10.4);
    expect(next.textClips![0].duration).toBeCloseTo(0.01);
  });
  it("ignores group text that does not overlap an edited source", () => {
    const p = captionProject();
    Object.assign(p, { textClips: [{ ...p.textClips![0], startTime: 30 }] });
    const { next } = edit(p, "slip", 0.5);
    expect(next.textClips![0]).toBe(p.textClips![0]);
  });
  it.each([NaN, Infinity, -1])(
    "rejects invalid initial source bounds %s before previewing",
    (value) => {
      const p = fixture();
      p.timeline.tracks[0].clips[0] = { ...find(p, "primary"), inPoint: value };
      expect(() =>
        prepareTimelineToolEdit(p, { mode: "slip", itemId: "primary" }),
      ).toThrow(/source bounds/);
    },
  );
  it("resolves legacy compound media IDs and retains unrelated instance identity", () => {
    const p = fixture();
    p.timeline.tracks[0].clips[0] = {
      ...find(p, "primary"),
      mediaId: "compound:compound",
    };
    Object.assign(p, {
      compoundClips: [{ id: "compound", content: { duration: 16 } }],
      nestedInstances: [
        {
          id: "primary",
          compoundClipId: "compound",
          trackId: "main",
          startTime: 10,
          duration: 4,
          inPoint: 4,
          outPoint: 12,
        },
        {
          id: "audio",
          compoundClipId: "compound",
          trackId: "dialogue",
          startTime: 10,
          duration: 4,
          inPoint: 4,
          outPoint: 12,
        },
      ],
    });
    const { next } = edit(p, "slip", 100, "right", []);
    expect(find(next, "primary").outPoint).toBe(16);
    expect(next.nestedInstances![1]).toBe(p.nestedInstances![1]);
  });
  it("does not search the media library during repeated preview frames", () => {
    const p = fixture();
    Object.assign(p.mediaLibrary, {
      items: Array.from({ length: 5000 }, (_, index) => ({
        ...p.mediaLibrary.items[0],
        id: index === 4999 ? "source" : `library-${index}`,
      })),
    });
    const prepared = prepareTimelineToolEdit(p, {
      mode: "ripple",
      itemId: "primary",
    });
    const findMedia = vi
      .spyOn(p.mediaLibrary.items, "find")
      .mockImplementation(() => {
        throw new Error("Per-frame media lookup");
      });
    for (let frame = 0; frame < 12000; frame++)
      expect(
        prepared.preview((frame % 30) / 30).duration,
      ).toBeGreaterThanOrEqual(4);
    expect(findMedia).not.toHaveBeenCalled();
    findMedia.mockRestore();
  });
});
