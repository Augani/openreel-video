import "../../test/install-local-storage-mock";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GraphicsEngine, TitleEngine } from "@openreel/core";
import { useEngineStore } from "../../stores/engine-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useInspectorNavigationStore } from "../../stores/inspector-navigation-store";
import { InspectorPanel } from "./InspectorPanel";


describe("InspectorPanel tab navigation and clip controls", () => {
  afterEach(() => {
    cleanup();
    useUIStore.getState().clearSelection();
    useInspectorNavigationStore.getState().clearRequest();
    useProjectStore.setState({ project: createEmptyProject("Reset") });
    vi.restoreAllMocks();
  });

  function seedGraphic(kind: "shape" | "svg" | "sticker") {
    useEngineStore.setState({ graphicsEngine: new GraphicsEngine(), titleEngine: new TitleEngine() });
    useProjectStore.getState().createNewProject("Graphic inspector navigation");
    const state = useProjectStore.getState();
    const track = state.project.timeline.tracks[0];
    const clip = kind === "shape" ? state.createShapeClip(track.id, 0, "rectangle", 5)!
      : kind === "svg" ? state.importSVG('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>', track.id, 0, 5)!
      : state.createStickerClip({ id: "sticker-nav", trackId: track.id, startTime: 0, duration: 5, type: "emoji", imageUrl: "data:image/png;base64,AA==",
        transform: { position: { x: .5, y: .5 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } }, keyframes: [], effects: [] })!;
    useUIStore.getState().select({ type: "shape-clip", id: clip.id, trackId: clip.trackId });
    return clip;
  }

  it("updates the graphic effect count even when edits share a timestamp", async () => {
    const clip = seedGraphic("shape");
    const timestamp = useProjectStore.getState().project.modifiedAt;
    vi.spyOn(Date, "now").mockReturnValue(timestamp);
    render(<InspectorPanel />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Effects" }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("button", { name: "Collapse Effects · 0 section" })).toBeInTheDocument();
    await act(async () => { await useProjectStore.getState().addVideoEffect(clip.id, "blur", { radius: 3 }); });
    expect(useProjectStore.getState().project.modifiedAt).toBe(timestamp);
    expect(screen.getByRole("button", { name: "Collapse Effects · 1 section" })).toBeInTheDocument();
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(screen.getByRole("button", { name: "Collapse Effects · 0 section" })).toBeInTheDocument();
  });

  it("resets the tab for a replacement project that reuses the selected clip ID", () => {
    const clip = seedGraphic("svg");
    const { container } = render(<InspectorPanel />);
    act(() => useInspectorNavigationStore.getState().requestSection("video-effects", clip.id));
    expect(screen.getByRole("tab", { name: "Effects" })).toHaveAttribute("aria-selected", "true");
    act(() => useProjectStore.setState(state => ({ project: { ...state.project, id: "replacement-project" } })));
    expect(screen.getByRole("tab", { name: "SVG" })).toHaveAttribute("aria-selected", "true");
    expect(useInspectorNavigationStore.getState().request).toBeNull();
    expect(container.querySelector('[data-section-id="effects-overview"]')).toBeNull();
  });

});
