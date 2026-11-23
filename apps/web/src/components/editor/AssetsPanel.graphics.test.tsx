import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEngineStore } from "../../stores/engine-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { EditorActionRail } from "./EditorActionRail";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { AssetsPanel } from "./AssetsPanel";

describe("AssetsPanel graphics workflow", () => {
  beforeEach(() => {
    useEditorWorkspaceStore.getState().setSection("media");
    useEngineStore.getState().getGraphicsEngine()?.clearCache();
    useProjectStore.setState({
      hasOpenProject: true,
      project: createEmptyProject("Graphics workflow"),
    });
    useTimelineStore.setState({ playheadPosition: 2.25 });
    useUIStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
    useEngineStore.getState().getGraphicsEngine()?.clearCache();
    useUIStore.getState().clearSelection();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("places a new shape at the playhead and opens it in the inspector", async () => {
    render(<><EditorActionRail /><AssetsPanel /></>);
    fireEvent.click(screen.getByRole("button", { name: "Graphics" }));

    // the graphics panel is a lazy chunk
    expect(
      await screen.findByRole("button", { name: "Import & Add Sticker" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rectangle" }));

    await waitFor(() => {
      const shapes =
        useEngineStore.getState().getGraphicsEngine()?.getAllShapeClips() ?? [];
      expect(shapes).toHaveLength(1);
      expect(shapes[0]).toMatchObject({
        shapeType: "rectangle",
        startTime: 2.25,
      });
      expect(useUIStore.getState().getSelectedClipIds()).toEqual([shapes[0]?.id]);
    });
  });
});
