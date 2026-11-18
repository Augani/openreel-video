import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphicsEngine, TitleEngine } from "@openreel/core";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { ShapeSection } from "./ShapeSection";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";

const state = () => useProjectStore.getState();
beforeEach(() => {
  useEngineStore.setState({ graphicsEngine: new GraphicsEngine(), titleEngine: new TitleEngine() });
  state().createNewProject("Graphics controls");
  state().actionHistory.setAutoGroupWindow(0);
  useTimelineStore.setState({ playbackLockedReason: null });
  useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("zero-opacity graphics properties", () => {
  it("keeps a transparent fill when changing from solid to shader", () => {
    const clip = state().createShapeClip(state().project.timeline.tracks[0].id, 0, "rectangle", 5, {
      fill: { type: "solid", color: "#14b8a6", opacity: 0 },
    })!;
    render(<ShapeSection clipId={clip.id} />);
    expect(screen.getByRole("slider", { name: "Opacity" })).toHaveAttribute("aria-valuenow", "0");
    fireEvent.click(screen.getByRole("radio", { name: "Shader" }));
    expect(state().getShapeClip(clip.id)?.style.fill.opacity).toBe(0);
  });

});
