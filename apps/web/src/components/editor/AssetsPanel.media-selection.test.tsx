import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import { AssetsPanel } from "./AssetsPanel";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";

const media: MediaItem[] = ["First video", "Second video"].map((name, index) => ({
  id: `video-${index}`, name, type: "video", blob: null, fileHandle: null,
  thumbnailUrl: `blob:thumbnail-${index}`, waveformData: null,
  metadata: { duration: 5, width: 1920, height: 1080, frameRate: 30, codec: "vp9",
    sampleRate: 0, channels: 0, fileSize: 1024, hasVideo: true, hasAudio: false },
}));

describe("asset selection and insertion", () => {
  beforeEach(() => {
    const project = createEmptyProject("Media selection");
    useProjectStore.setState({ hasOpenProject: true, project: {
      ...project, settings: { ...project.settings, width: 1920, height: 1080 },
      mediaLibrary: { items: media },
    } });
    useUIStore.getState().clearSelection();
    useTimelineStore.setState({ playheadPosition: 2 });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); useUIStore.getState().clearSelection(); });

  it("keeps all thumbnails ahead of selection tools and inserts on the first double-click sequence", () => {
    const insert = vi.spyOn(useProjectStore.getState(), "addClipToNewTrack").mockResolvedValue({ success: true });
    const view = render(<AssetsPanel />);
    const first = view.getByRole("img", { name: media[0].name });
    const second = view.getByRole("img", { name: media[1].name });
    // The common gallery containing both cards must keep its preceding layout
    // blocks unchanged when selection reveals editing controls.
    let gallery = first.parentElement;
    while (gallery && !gallery.contains(second)) gallery = gallery.parentElement;
    if (!gallery?.parentElement) throw new Error("Missing media gallery");
    const mediaGallery = gallery;
    const precedingBlocks = () => Array.from(mediaGallery.parentElement!.children)
      .slice(0, Array.from(mediaGallery.parentElement!.children).indexOf(mediaGallery));
    const beforeSelection = precedingBlocks();

    fireEvent.click(first, { detail: 1 });
    const tools = view.getByRole("region", { name: `Preview performance for ${media[0].name}` });
    expect(precedingBlocks()).toEqual(beforeSelection);
    expect(mediaGallery.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.getByRole("img", { name: media[0].name })).toBe(first);
    fireEvent.click(first, { detail: 2 });
    fireEvent.doubleClick(first, { detail: 2 });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(media[0].id, 2);

    fireEvent.click(second);
    const nextTools = view.getByRole("region", { name: `Preview performance for ${media[1].name}` });
    expect(precedingBlocks()).toEqual(beforeSelection);
    expect(mediaGallery.compareDocumentPosition(nextTools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.getByRole("img", { name: media[1].name })).toBe(second);
  });
});
