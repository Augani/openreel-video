import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stickerLibrary } from "@openreel/core";
import { useEngineStore } from "../../../stores/engine-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { StickerPickerPanel } from "./StickerPickerPanel";

describe("StickerPickerPanel custom sticker workflow", () => {
  beforeEach(() => {
    stickerLibrary.clearCustomStickers();
    useEngineStore.getState().getGraphicsEngine()?.clearCache();
    useProjectStore.setState({
      hasOpenProject: true,
      project: createEmptyProject("Custom sticker"),
    });
    useTimelineStore.setState({ playheadPosition: 3.5 });
    useUIStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
    stickerLibrary.clearCustomStickers();
    useEngineStore.getState().getGraphicsEngine()?.clearCache();
    useUIStore.getState().clearSelection();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("imports, places, and selects a custom sticker at the playhead", async () => {
    render(<StickerPickerPanel />);
    const file = new File([new Uint8Array([137, 80, 78, 71])], "spark.png", {
      type: "image/png",
    });

    fireEvent.change(
      screen.getByLabelText("Choose custom sticker image"),
      { target: { files: [file] } },
    );

    await waitFor(() => {
      expect(screen.getByText("spark added at 00:03:15")).toBeInTheDocument();
    });
    const state = useProjectStore.getState();
    const graphicsTrack = state.project.timeline.tracks.find(
      (track) => track.type === "graphics",
    );
    expect(graphicsTrack).toBeDefined();
    const stickers =
      useEngineStore.getState().getGraphicsEngine()?.getAllStickerClips() ?? [];
    expect(stickers).toHaveLength(1);
    expect(stickers[0]).toMatchObject({
      name: "spark",
      trackId: graphicsTrack?.id,
      startTime: 3.5,
      duration: 5,
    });
    expect(stickers[0]?.imageUrl).toMatch(/^data:image\/png;base64,/);
    expect(useUIStore.getState().getSelectedClipIds()).toEqual([stickers[0]?.id]);
    expect(state.project.stickerClips).toHaveLength(1);
  });

  it("rejects non-image files without changing the timeline", async () => {
    render(<StickerPickerPanel />);
    const file = new File(["not an image"], "notes.txt", {
      type: "text/plain",
    });

    fireEvent.change(
      screen.getByLabelText("Choose custom sticker image"),
      { target: { files: [file] } },
    );

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("Choose a PNG, JPEG, WebP, GIF, or SVG image.");
    expect(
      useProjectStore.getState().project.timeline.tracks.some(
        (track) => track.type === "graphics",
      ),
    ).toBe(false);
  });
});
