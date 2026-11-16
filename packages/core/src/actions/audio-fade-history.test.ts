import { describe, expect, it, vi } from "vitest";
import { ActionExecutor } from "./action-executor";
import type { Clip, ClipFade, Project } from "../types";
import {
  createPortableEdit,
  materializePortableEdit,
  parsePortableEdit,
} from "../editing/portable-project";

function fixture(fade?: ClipFade): Project {
  const clip: Clip = {
    id: "clip",
    mediaId: "media",
    trackId: "track",
    startTime: 0,
    duration: 2,
    inPoint: 4,
    outPoint: 6,
    volume: 0.75,
    effects: [],
    audioEffects: [],
    keyframes: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      anchor: { x: 0.5, y: 0.5 },
    },
    ...(fade ? { fade } : {}),
  };
  return {
    id: "project",
    name: "Fade history",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 640,
      height: 360,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: {
      tracks: [
        {
          id: "track",
          name: "Audio",
          type: "audio",
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
          clips: [clip],
          transitions: [],
        },
      ],
      duration: 2,
      markers: [],
      subtitles: [],
    },
    mediaLibrary: {
      items: [
        {
          id: "media",
          name: "Source.wav",
          type: "audio",
          blob: new Blob(["source"]),
          fileHandle: null,
          thumbnailUrl: null,
          waveformData: new Float32Array(100000),
          metadata: {
            duration: 12,
            sampleRate: 48000,
            channels: 2,
            width: 0,
            height: 0,
            frameRate: 0,
            codec: "pcm",
            fileSize: 6,
          },
        },
      ],
    },
  };
}
const current = (project: Project) => project.timeline.tracks[0].clips[0];
const set = (
  executor: ActionExecutor,
  project: Project,
  params: { fadeIn?: number; fadeOut?: number },
) =>
  executor.execute(
    {
      type: "audio/setFade",
      id: crypto.randomUUID(),
      timestamp: 1,
      params: { clipId: "clip", ...params },
    },
    project,
  );

describe("complete audio fade history and portability", () => {
  it.each<ClipFade | undefined>([
    undefined,
    { fadeIn: 0, fadeOut: 0 },
    { fadeIn: 5, fadeOut: 4, origin: { offset: 4, duration: 12 } },
  ])(
    "restores the full prior fade including absence and original clock %#",
    async (fade) => {
      const project = fixture(fade),
        executor = new ActionExecutor();
      const before = structuredClone(current(project)),
        media = project.mediaLibrary.items[0];
      expect((await set(executor, project, { fadeIn: 0.9 })).success).toBe(
        true,
      );
      const changed = structuredClone(current(project));
      expect(changed.fade?.fadeIn).toBe(0.9);
      expect(changed.fade?.fadeOut).toBe(fade?.fadeOut ?? 0);
      if (fade?.origin)
        expect(changed.fade?.origin).toEqual({ ...fade.origin, fadeIn: false });
      expect((await executor.undo(project)).success).toBe(true);
      expect(current(project)).toEqual(before);
      expect(Object.hasOwn(current(project), "fade")).toBe(fade !== undefined);
      expect((await executor.redo(project)).success).toBe(true);
      expect(current(project)).toEqual(changed);
      expect(project.mediaLibrary.items[0]).toBe(media);
    },
  );

  it("anchors only an edited edge locally and removes the origin once both edges are edited", async () => {
    const project = fixture({
        fadeIn: 5,
        fadeOut: 4,
        origin: { offset: 4, duration: 12 },
      }),
      executor = new ActionExecutor();
    executor.getHistory().beginGroup("Edit fade in");
    await set(executor, project, { fadeIn: 0.5 });
    executor.getHistory().endGroup();
    const first = structuredClone(current(project).fade);
    expect(first?.origin).toEqual({ offset: 4, duration: 12, fadeIn: false });
    executor.getHistory().beginGroup("Edit fade out");
    await set(executor, project, { fadeOut: 0.75 });
    executor.getHistory().endGroup();
    expect(current(project).fade).toEqual({ fadeIn: 0.5, fadeOut: 0.75 });
    await executor.undo(project);
    expect(current(project).fade).toEqual(first);
    await executor.undo(project);
    expect(current(project).fade?.origin).toEqual({ offset: 4, duration: 12 });
  });

  it("restores absence when rapid edge changes share one Undo group", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      const project = fixture(),
        executor = new ActionExecutor();
      await set(executor, project, { fadeIn: 0.5 });
      await set(executor, project, { fadeOut: 0.75 });
      await executor.undo(project);
      expect(current(project)).not.toHaveProperty("fade");
      await executor.redo(project);
      expect(current(project).fade).toEqual({ fadeIn: 0.5, fadeOut: 0.75 });
    } finally {
      now.mockRestore();
    }
  });

  it.each([NaN, -1])(
    "rejects invalid fade duration %s atomically",
    async (value) => {
      const project = fixture(),
        executor = new ActionExecutor(),
        before = current(project);
      expect((await set(executor, project, { fadeIn: value })).success).toBe(
        false,
      );
      expect((await set(executor, project, { fadeOut: value })).success).toBe(
        false,
      );
      expect(current(project)).toBe(before);
      expect(executor.getHistory().getUndoStackSize()).toBe(0);
    },
  );

  it.each([
    { offset: NaN, duration: 10 },
    { offset: 1, duration: 10, fadeIn: "false" },
  ])("rejects malformed restored original clocks %#", async (origin) => {
    const project = fixture(),
      executor = new ActionExecutor();
    const result = await executor.execute(
      {
        type: "audio/restoreFade",
        id: "restore",
        timestamp: 1,
        params: { clipId: "clip", fade: { fadeIn: 1, fadeOut: 1, origin } },
      },
      project,
    );
    expect(result.success).toBe(false);
    expect(current(project)).not.toHaveProperty("fade");
  });

  it.each([
    { fadeIn: 5, fadeOut: 4, origin: { offset: 4, duration: 12 } },
    {
      fadeIn: 0.5,
      fadeOut: 4,
      origin: { offset: -1, duration: 12, fadeIn: false },
    },
  ])("roundtrips original-clock fades explicitly in portable v4 %#", (fade) => {
    const project = fixture(fade),
      doc = createPortableEdit(project);
    expect(doc.version).toBe(4);
    const parsed = parsePortableEdit(JSON.stringify(doc));
    const restored = materializePortableEdit(parsed, project);
    expect(restored.missing).toEqual([]);
    expect(current(restored.project).fade).toEqual(fade);
    expect(restored.project.mediaLibrary.items[0].blob).toBe(
      project.mediaLibrary.items[0].blob,
    );
    expect(() =>
      parsePortableEdit(JSON.stringify({ ...doc, version: 3 })),
    ).toThrow(/version 4/);
  });

  it("keeps ordinary fades on the existing portable v3 contract", () => {
    const project = fixture({ fadeIn: 0.5, fadeOut: 0.75 }),
      doc = createPortableEdit(project);
    expect(doc.version).toBe(3);
    expect(
      current(
        materializePortableEdit(parsePortableEdit(JSON.stringify(doc)), project)
          .project,
      ).fade,
    ).toEqual(current(project).fade);
  });
});
