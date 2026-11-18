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
    const placementTrack = state.project.timeline.tracks.find(
      (track) => track.mode === "standard",
    );
    expect(placementTrack).toBeDefined();
    const stickers =
      useEngineStore.getState().getGraphicsEngine()?.getAllStickerClips() ?? [];
    expect(stickers).toHaveLength(1);
    expect(stickers[0]).toMatchObject({
      name: "spark",
      trackId: placementTrack?.id,
      startTime: 3.5,
      duration: 5,
    });
    expect(stickers[0]?.imageUrl).toMatch(/^data:image\/png;base64,/);
    expect(useUIStore.getState().getSelectedClipIds()).toEqual([stickers[0]?.id]);
    expect(state.project.stickerClips).toHaveLength(1);

    await state.undo();
    expect(useProjectStore.getState().project.stickerClips).toHaveLength(0);
    expect(useProjectStore.getState().project.timeline.tracks).toHaveLength(0);
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
      useProjectStore.getState().project.timeline.tracks,
    ).toHaveLength(0);
  });

  it("ships a populated vector sticker pack with icon category chips and no text-initial fallbacks", () => {
    render(<StickerPickerPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Stickers" }));
    expect(screen.queryByText(/No stickers yet/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Starburst" })).toBeInTheDocument();
    // Category chips are icon-only: named for assistive tech, never a truncated text label.
    const arrows = screen.getByRole("button", { name: "Arrows" });
    expect(arrows).toHaveAttribute("title", "Arrows");
    expect(arrows).toHaveTextContent("");
    fireEvent.click(arrows);
    expect(screen.queryByRole("button", { name: "Add Starburst" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Chevrons" })).toBeInTheDocument();
  });

  it("separates the empty search message into two lines", () => {
    render(<StickerPickerPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Stickers" }));
    fireEvent.change(screen.getByLabelText("Search stickers"), { target: { value: "zzzz-nothing" } });
    const title = screen.getByText("No stickers found");
    expect(title.tagName).toBe("SPAN");
    expect(title.className).toContain("block");
  });
});
