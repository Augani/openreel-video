import { describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";
import type { ProjectState } from "../stores/project-store";
import {
  deleteTimelineItem,
  duplicateTimelineItem,
  getTimelineItemRanges,
  getSplittableTimelineItemIds,
  getTimelineMarqueeSelection,
  getTimelineSelectionItems,
  getTimelineTrackSelection,
  splitTimelineItem,
  trimTimelineItemToPlayhead,
} from "./timeline-item-actions";

function createStore(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    getClip: vi.fn(),
    getTextClip: vi.fn(),
    getShapeClip: vi.fn(),
    getSVGClip: vi.fn(),
    getStickerClip: vi.fn(),
    removeClip: vi.fn().mockResolvedValue({ success: true }),
    deleteTextClip: vi.fn().mockReturnValue(true),
    deleteShapeClip: vi.fn().mockReturnValue(true),
    deleteSVGClip: vi.fn().mockReturnValue(true),
    deleteStickerClip: vi.fn().mockReturnValue(true),
    duplicateClip: vi.fn().mockResolvedValue({ success: true }),
    duplicateOverlayClip: vi.fn().mockReturnValue(null),
    splitClip: vi.fn().mockResolvedValue({ success: true }),
    splitOverlayClip: vi.fn().mockReturnValue(null),
    trimToPlayhead: vi.fn().mockResolvedValue({ success: true }),
    trimOverlayToPlayhead: vi.fn().mockReturnValue(null),
    ...overrides,
  } as unknown as ProjectState;
}

describe("timeline item actions", () => {
  it.each([
    ["media", "getClip", "removeClip"],
    ["text", "getTextClip", "deleteTextClip"],
    ["shape", "getShapeClip", "deleteShapeClip"],
    ["svg", "getSVGClip", "deleteSVGClip"],
    ["sticker", "getStickerClip", "deleteStickerClip"],
  ] as const)("routes %s deletion to its matching action", async (
    kind,
    getter,
    remover,
  ) => {
    const id = `${kind}-1`;
    const store = createStore({
      [getter]: vi.fn().mockReturnValue({ id }),
    });

    await expect(deleteTimelineItem(store, id)).resolves.toBe(true);
    expect(store[remover]).toHaveBeenCalledWith(id);

    const otherRemovers = [
      "removeClip",
      "deleteTextClip",
      "deleteShapeClip",
      "deleteSVGClip",
      "deleteStickerClip",
    ] as const;
    for (const otherRemover of otherRemovers) {
      if (otherRemover !== remover) {
        expect(store[otherRemover]).not.toHaveBeenCalled();
      }
    }
  });

  it("duplicates both media and overlay timeline items", async () => {
    const mediaStore = createStore({
      getClip: vi.fn().mockReturnValue({ id: "media-1" }),
    });
    const textStore = createStore({
      getTextClip: vi.fn().mockReturnValue({ id: "text-1" }),
      duplicateOverlayClip: vi.fn().mockReturnValue({ id: "text-copy" }),
    });

    await expect(duplicateTimelineItem(mediaStore, "media-1")).resolves.toBe(
      true,
    );
    await expect(duplicateTimelineItem(textStore, "text-1")).resolves.toBe(
      true,
    );
    expect(mediaStore.duplicateClip).toHaveBeenCalledWith("media-1");
    expect(textStore.duplicateOverlayClip).toHaveBeenCalledWith("text-1");
  });

  it("routes split and trim operations to overlay timing actions", async () => {
    const store = createStore({
      getTextClip: vi.fn().mockReturnValue({ id: "text-1" }),
      splitOverlayClip: vi.fn().mockReturnValue({
        left: { id: "text-1" },
        right: { id: "text-2" },
      }),
      trimOverlayToPlayhead: vi.fn().mockReturnValue({ id: "text-1" }),
    });

    await expect(splitTimelineItem(store, "text-1", 2)).resolves.toBe(true);
    await expect(
      trimTimelineItemToPlayhead(store, "text-1", 3, false),
    ).resolves.toBe(true);
    expect(store.splitOverlayClip).toHaveBeenCalledWith("text-1", 2);
    expect(store.trimOverlayToPlayhead).toHaveBeenCalledWith(
      "text-1",
      3,
      false,
    );
    expect(store.splitClip).not.toHaveBeenCalled();
    expect(store.trimToPlayhead).not.toHaveBeenCalled();
  });

  it("includes every clip family in timeline navigation and select all", () => {
    const project = {
      timeline: {
        tracks: [
          {
            id: "track-1",
            clips: [{ id: "media-1", startTime: 0, duration: 3 }],
          },
        ],
      },
      textClips: [
        { id: "text-1", trackId: "text-track", startTime: 4, duration: 2 },
      ],
      shapeClips: [
        {
          id: "shape-1",
          trackId: "graphics-track",
          startTime: 7,
          duration: 2,
        },
      ],
      svgClips: [
        { id: "svg-1", trackId: "graphics-track", startTime: 10, duration: 2 },
      ],
      stickerClips: [
        {
          id: "sticker-1",
          trackId: "graphics-track",
          startTime: 13,
          duration: 2,
        },
      ],
    } as unknown as Project;

    expect(getTimelineItemRanges(project).map((item) => item.kind)).toEqual([
      "media",
      "text",
      "shape",
      "svg",
      "sticker",
    ]);
    expect(getTimelineSelectionItems(project)).toEqual([
      { id: "media-1", trackId: "track-1", type: "clip" },
      { id: "text-1", trackId: "text-track", type: "text-clip" },
      { id: "shape-1", trackId: "graphics-track", type: "shape-clip" },
      { id: "svg-1", trackId: "graphics-track", type: "shape-clip" },
      { id: "sticker-1", trackId: "graphics-track", type: "shape-clip" },
    ]);
  });

  it("selects every clip family on one track in timeline order", () => {
    const project = {
      timeline: {
        tracks: [
          {
            id: "caption-track",
            clips: [
              {
                id: "media-caption",
                trackId: "caption-track",
                startTime: 3,
                duration: 1,
              },
            ],
          },
          {
            id: "other-track",
            clips: [
              {
                id: "other-media",
                trackId: "other-track",
                startTime: 0,
                duration: 1,
              },
            ],
          },
        ],
      },
      textClips: [
        {
          id: "caption-late",
          trackId: "caption-track",
          startTime: 5,
          duration: 1,
        },
        {
          id: "caption-early",
          trackId: "caption-track",
          startTime: 1,
          duration: 1,
        },
      ],
      shapeClips: [
        {
          id: "caption-shape",
          trackId: "caption-track",
          startTime: 4,
          duration: 1,
        },
      ],
    } as unknown as Project;

    expect(getTimelineTrackSelection(project, "caption-track")).toEqual([
      { id: "caption-early", trackId: "caption-track", type: "text-clip" },
      { id: "media-caption", trackId: "caption-track", type: "clip" },
      { id: "caption-shape", trackId: "caption-track", type: "shape-clip" },
      { id: "caption-late", trackId: "caption-track", type: "text-clip" },
    ]);
  });

  it("finds every selected media or overlay item crossing the playhead", () => {
    const project = {
      timeline: {
        tracks: [
          {
            id: "track-1",
            clips: [
              { id: "media-1", trackId: "track-1", startTime: 0, duration: 4 },
              { id: "media-late", trackId: "track-1", startTime: 5, duration: 2 },
            ],
          },
        ],
      },
      textClips: [
        { id: "text-1", trackId: "text-track", startTime: 1, duration: 4 },
      ],
    } as Project;

    expect(
      getSplittableTimelineItemIds(
        project,
        ["media-1", "media-late", "text-1"],
        2,
      ),
    ).toEqual(["media-1", "text-1"]);
  });

  it("marquee-selects media and every overlay family by time and track geometry", () => {
    const project = {
      timeline: {
        tracks: [
          { id: "video-track", type: "video", clips: [
            { id: "media-1", trackId: "video-track", startTime: 0, duration: 3 },
          ] },
          { id: "text-track", type: "text", clips: [] },
          { id: "graphics-track", type: "graphics", clips: [] },
        ],
      },
      textClips: [
        { id: "text-1", trackId: "text-track", startTime: 2, duration: 3 },
      ],
      shapeClips: [
        { id: "shape-1", trackId: "graphics-track", startTime: 3, duration: 2 },
      ],
      svgClips: [
        { id: "svg-late", trackId: "graphics-track", startTime: 6, duration: 1 },
      ],
      stickerClips: [
        { id: "sticker-1", trackId: "graphics-track", startTime: 1.5, duration: 1 },
      ],
    } as unknown as Project;

    expect(
      getTimelineMarqueeSelection(
        project,
        { minTime: 1, maxTime: 4, minY: 0, maxY: 150 },
        () => 50,
      ),
    ).toEqual([
      { id: "media-1", trackId: "video-track", type: "clip" },
      { id: "text-1", trackId: "text-track", type: "text-clip" },
      { id: "shape-1", trackId: "graphics-track", type: "shape-clip" },
      { id: "sticker-1", trackId: "graphics-track", type: "shape-clip" },
    ]);
  });
});
