import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import type { Clip, MediaItem, Track } from "@openreel/core";
import { resolveAudibleAudioTarget } from "@openreel/core/audio/clip-audio-resolution";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import {
  getEditableTimelineSelection,
  getLinkedTimelineSelection,
} from "../utils/linked-timeline-selection";
import {
  editTimelineSelection,
  moveLinkedTimelineClips,
  trimLinkedTimelineClips,
  timelineDragRepresentatives,
} from "./linked-timeline-edit";

const makeClip = (
  id: string,
  trackId: string,
  overrides: Partial<Clip> = {},
): Clip => ({
  id,
  trackId,
  mediaId: trackId === "main" ? "video" : "wav",
  startTime: 2,
  duration: 8,
  inPoint: 0,
  outPoint: 8,
  effects: [],
  audioEffects: [],
  keyframes: [],
  volume: trackId === "main" ? 0 : 1,
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    anchor: { x: 0.5, y: 0.5 },
    rotation: 0,
    opacity: 1,
  },
  ...(trackId !== "main"
    ? {
        metadata: {
          separatedFromClipId: "v",
          sourceAudioTrackIndex: trackId === "dialogue2" ? 1 : 0,
        },
      }
    : {}),
  ...overrides,
});
const track = (id: string, clips: Clip[]): Track => ({
  id,
  clips,
  name: id,
  type: id === "main" ? "video" : "audio",
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
});
const media = (id: string): MediaItem => ({
  id,
  type: id === "video" ? "video" : "audio",
  name: id,
  blob: null,
  fileHandle: null,
  thumbnailUrl: null,
  waveformData: null,
  metadata: {
    duration: 20,
    width: 640,
    height: 360,
    frameRate: 30,
    sampleRate: 48000,
    channels: 2,
    codec: "h264",
    fileSize: 0,
  },
});
const state = () => useProjectStore.getState();
const clip = (id: string) => state().getClip(id)!;
const ids = (selected = ["v"]) =>
  getLinkedTimelineSelection(
    state().project,
    selected,
    useEditorWorkspaceStore.getState().linkedSelection,
  );
beforeEach(() => {
  state().createNewProject("Linked selection QA");
  useEditorWorkspaceStore.setState({ linkedSelection: true });
  const project = state().project;
  useProjectStore.setState({
    project: {
      ...project,
      mediaLibrary: { items: [media("video"), media("wav")] },
      timeline: {
        ...project.timeline,
        duration: 10,
        tracks: [
          track("main", [makeClip("v", "main")]),
          track("dialogue", [makeClip("a", "dialogue")]),
          track("dialogue2", [makeClip("a2", "dialogue2")]),
        ],
      },
    },
  });
  useUIStore.getState().select({ id: "v", type: "clip", trackId: "main" });
});

describe("linked timeline editing", () => {
  it("expands every separated stream in either direction without changing inspector selection", () => {
    expect(ids()).toEqual(["v", "a", "a2"]);
    expect(ids(["a", "v"])).toEqual(["a", "v", "a2"]);
    expect(useUIStore.getState().getSelectedClipIds()).toEqual(["v"]);
    expect(
      timelineDragRepresentatives(state().project, ["v", "a", "a2"], "v"),
    ).toEqual([]);
    useEditorWorkspaceStore.setState({ linkedSelection: false });
    expect(ids()).toEqual(["v"]);
    expect(
      timelineDragRepresentatives(state().project, ["v", "a"], "v"),
    ).toEqual(["a"]);
  });
  it("keeps partial trims linked and excludes another use of the same footage", () => {
    const project = state().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((t) =>
            t.id === "dialogue"
              ? {
                  ...t,
                  clips: [
                    {
                      ...clip("a"),
                      startTime: 3,
                      inPoint: 1,
                      duration: 6,
                      outPoint: 7,
                    },
                  ],
                }
              : t.id === "main"
                ? {
                    ...t,
                    clips: [
                      ...t.clips,
                      makeClip("different-take", "main", { startTime: 12 }),
                    ],
                  }
                : t,
          ),
        },
      },
    });
    expect(ids()).toEqual(["v", "a", "a2"]);
    expect(ids(["different-take"])).toEqual(["different-take"]);
  });
  it("splits all streams once, persists the right-side relationship after deleting the left, and undoes as one edit", async () => {
    expect(await editTimelineSelection(["v", "a"], "split", 6)).toBe(true);
    expect(state().project.timeline.tracks.map((t) => t.clips.length)).toEqual([
      2, 2, 2,
    ]);
    const right = state().project.timeline.tracks.map(
      (t) => t.clips.find((c) => c.startTime === 6)!,
    );
    expect(ids([right[0].id])).toEqual(right.map((c) => c.id));
    expect(
      resolveAudibleAudioTarget(right[0], state().project.timeline).id,
    ).toBe(right[1].id);
    await state().undo();
    expect(state().project.timeline.tracks.map((t) => t.clips.length)).toEqual([
      1, 1, 1,
    ]);
    await state().redo();
    await editTimelineSelection(["v"], "delete");
    state().loadProject(JSON.parse(JSON.stringify(state().project)));
    const surviving = state().project.timeline.tracks.map((t) => t.clips[0]);
    expect(ids([surviving[0].id])).toEqual(surviving.map((c) => c.id));
  });
  it("blocks an entire linked edit on a locked companion and allows an explicit unlinked edit", async () => {
    const project = state().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((t) =>
            t.id === "dialogue" ? { ...t, locked: true } : t,
          ),
        },
      },
    });
    expect(getEditableTimelineSelection(state().project, ["v"], true)).toEqual({
      ids: [],
      blocked: true,
    });
    expect(await editTimelineSelection(["v"], "delete")).toBe(false);
    expect(clip("v")).toBeDefined();
    useEditorWorkspaceStore.setState({ linkedSelection: false });
    expect(await editTimelineSelection(["v"], "split", 6)).toBe(true);
    expect(state().project.timeline.tracks.map((t) => t.clips.length)).toEqual([
      2, 1, 1,
    ]);
  });
  it("moves the linked group together, clamps its earliest start, and restores all positions with one Undo", async () => {
    expect(await moveLinkedTimelineClips("v", -3)).toBe(true);
    expect([
      clip("v").startTime,
      clip("a").startTime,
      clip("a2").startTime,
    ]).toEqual([0, 0, 0]);
    await state().undo();
    expect([clip("v").startTime, clip("a").startTime]).toEqual([2, 2]);
    expect(await moveLinkedTimelineClips("v", 12, "dialogue2")).toBe(true);
    expect(clip("v").trackId).not.toBe("dialogue2");
    expect(clip("v").startTime).toBe(12);
    expect(clip("a").trackId).toBe("dialogue");
    expect(ids()).toEqual(["v", "a", "a2"]);
    await state().undo();
    expect(clip("v").trackId).toBe("main");
  });
  it("trims source points and timing on every stream and records a reversible edit", async () => {
    await trimLinkedTimelineClips("v", "left", 4);
    for (const id of ["v", "a", "a2"])
      expect(clip(id)).toMatchObject({
        startTime: 4,
        duration: 6,
        inPoint: 2,
        outPoint: 8,
      });
    await state().undo();
    expect(clip("v")).toMatchObject({ startTime: 2, duration: 8, inPoint: 0 });
    await trimLinkedTimelineClips("a", "right", 12);
    for (const id of ["v", "a", "a2"])
      expect(clip(id)).toMatchObject({
        startTime: 2,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
      });
  });
  it("duplicates linked clips at one free offset and preserves grades and new source links", async () => {
    const project = state().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((t) =>
            t.id === "main"
              ? {
                  ...t,
                  clips: [
                    { ...clip("v"), colorGrading: { temperature: 12 } },
                    makeClip("obstacle", "main", {
                      startTime: 10,
                      duration: 4,
                      outPoint: 4,
                    }),
                  ],
                }
              : t,
          ),
        },
      },
    });
    expect(await editTimelineSelection(["v"], "duplicate")).toBe(true);
    const duplicate = state().project.timeline.tracks.map(
      (t) => t.clips.find((c) => c.startTime === 14)!,
    );
    expect(duplicate.every(Boolean)).toBe(true);
    expect(duplicate[0].colorGrading?.temperature).toBe(12);
    expect(ids([duplicate[0].id])).toEqual(duplicate.map((c) => c.id));
    expect(ids()).toEqual(["v", "a", "a2"]);
    await state().undo();
    expect(state().project.timeline.tracks.map((t) => t.clips.length)).toEqual([
      2, 1, 1,
    ]);
  });
  it("pastes linked copies onto the same relative tracks with fresh source relationships", async () => {
    state().copyClips(ids());
    const results = await state().pasteClips("main", 12);
    expect(results.every((result) => result.success)).toBe(true);
    const pasted = state().project.timeline.tracks.map(
      (t) => t.clips.find((c) => c.startTime === 12)!,
    );
    expect(pasted.every(Boolean)).toBe(true);
    expect(ids([pasted[0].id])).toEqual(pasted.map((c) => c.id));
    expect(pasted[1].metadata?.separatedFromClipId).toBe(pasted[0].id);
    expect(ids()).toEqual(["v", "a", "a2"]);
    await state().undo();
    expect(state().project.timeline.tracks.map((t) => t.clips.length)).toEqual([
      1, 1, 1,
    ]);
  });
});
