import { describe, expect, it, vi } from "vitest";
import type { Clip, Project, TextClip } from "@openreel/core";
import {
  getLinkedCaptions,
  moveLinkedCaptions,
  trimLinkedCaptions,
  type LinkedCaptionEditStore,
} from "./linked-caption-edit";

const source = {
  id: "video-1",
  trackId: "video-track",
  startTime: 2,
  duration: 8,
} as Clip;
const captions = [
  { id: "c1", trackId: "captions", startTime: 2, duration: 2, metadata: {} },
  { id: "c2", trackId: "captions", startTime: 8, duration: 2, metadata: {} },
  {
    id: "explicit",
    trackId: "other-text",
    startTime: 30,
    duration: 2,
    metadata: { captionSourceClipId: "video-1" },
  },
] as TextClip[];
const project = {
  timeline: {
    tracks: [
      { id: "video-track", groupId: "g1" },
      { id: "captions", groupId: "g1" },
      { id: "other-text" },
    ],
  },
} as Project;

function makeStore(): LinkedCaptionEditStore {
  return {
    project,
    getAllTextClips: () => captions,
    updateOverlayClipTiming: vi.fn(),
    deleteTextClip: vi.fn(() => true),
  };
}

describe("linked caption edits", () => {
  it("finds grouped overlapping captions and explicit source links", () => {
    expect(getLinkedCaptions(makeStore(), source).map((clip) => clip.id)).toEqual([
      "c1",
      "c2",
      "explicit",
    ]);
  });

  it("moves linked captions by the source clip delta", () => {
    const store = makeStore();
    moveLinkedCaptions(store, source, 5);
    expect(store.updateOverlayClipTiming).toHaveBeenCalledWith("c1", {
      startTime: 5,
    });
    expect(store.updateOverlayClipTiming).toHaveBeenCalledWith("c2", {
      startTime: 11,
    });
  });

  it("clips partial captions and removes captions outside a trim", () => {
    const store = makeStore();
    trimLinkedCaptions(store, source, 3, 8.5);
    expect(store.updateOverlayClipTiming).toHaveBeenCalledWith("c1", {
      startTime: 3,
      duration: 1,
    });
    expect(store.updateOverlayClipTiming).toHaveBeenCalledWith("c2", {
      startTime: 8,
      duration: 0.5,
    });
    expect(store.deleteTextClip).toHaveBeenCalledWith("explicit");
  });
});
