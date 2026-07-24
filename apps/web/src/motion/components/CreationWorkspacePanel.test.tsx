import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CreationProjectState, CreationScene } from "@openreel/core/creation/index";
import { IDENTITY_TRANSFORM } from "@openreel/core/creation/index";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { CreationWorkspacePanel } from "./CreationWorkspacePanel";

const h = vi.hoisted(() => ({
  executeTool: vi.fn(),
  host: { id: "host" },
  runExclusive: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@openreel/agent", () => ({
  executeTool: h.executeTool,
}));

vi.mock("../../services/agent/host-singleton", () => ({
  getLiveEditorHost: () => h.host,
  runExclusive: h.runExclusive,
}));

function creationScene(): CreationScene {
  return {
    id: "scene-sync",
    name: "Unsynced Scene",
    duration: 4,
    frameRate: 30,
    objects: [
      {
        id: "object-1",
        name: "Renderable object",
        assetId: "asset-1",
        materialId: "mat-1",
        transform: IDENTITY_TRANSFORM,
        visible: true,
        selectable: true,
        tags: ["agent-created"],
      },
    ],
    cameras: [
      {
        id: "camera-1",
        name: "Hero camera",
        position: { x: 0, y: 1, z: 5 },
        target: { x: 0, y: 0, z: 0 },
        fov: 35,
      },
    ],
    activeCameraId: "camera-1",
    lights: [],
    animations: [],
    environment: { kind: "studio", backgroundColor: "#101522" },
    renderBindings: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function projectCreation(): CreationProjectState {
  return {
    version: "0.1.0",
    assets: [
      {
        id: "asset-1",
        name: "Asset",
        kind: "prop",
        seed: "asset",
        parameters: {},
        nodes: [],
        materials: [
          {
            id: "mat-1",
            name: "Material",
            model: "pbr",
            baseColor: "#ffffff",
          },
        ],
        dependencies: [],
        caches: [],
        createdAt: 1,
        modifiedAt: 1,
      },
    ],
    scenes: [creationScene()],
    activeSceneId: "scene-sync",
    operationHistory: [],
  };
}

describe("CreationWorkspacePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Creation sync test"),
        creation: projectCreation(),
        motionCompositions: [],
      },
    });
    useMotionStore.setState({
      activeCompositionId: null,
      selectedLayerId: null,
      selectedLayerIds: [],
      leftTab: "creation",
      rightTab: "properties",
      playhead: 0,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("syncs an unbound creation scene through the shared MCP motion tool", async () => {
    h.executeTool.mockResolvedValue({
      ok: true,
      summary: "Synced",
      data: { compositionId: "comp-synced", layerId: "layer-synced" },
    });

    render(<CreationWorkspacePanel />);

    fireEvent.click(screen.getByRole("button", { name: "Sync render scene" }));

    await waitFor(() => {
      expect(h.executeTool).toHaveBeenCalledWith(
        "sync_creation_scene_to_motion",
        { sceneId: "scene-sync" },
        h.host,
      );
    });
    expect(h.runExclusive).toHaveBeenCalledTimes(1);
    expect(useMotionStore.getState().activeCompositionId).toBe("comp-synced");
    expect(useMotionStore.getState().selectedLayerId).toBe("layer-synced");
    expect(useMotionStore.getState().leftTab).toBe("layers");
    expect(useMotionStore.getState().rightTab).toBe("properties");
  });

  it("reports sync errors without leaving the creation workspace", async () => {
    h.executeTool.mockResolvedValue({
      ok: false,
      summary: "Creation scene has no objects to render",
      error: {
        code: "INVALID_PARAMS",
        message: "Creation scene has no objects to render",
      },
    });

    render(<CreationWorkspacePanel />);

    fireEvent.click(screen.getByRole("button", { name: "Sync render scene" }));

    expect(
      await screen.findByText("Creation scene has no objects to render"),
    ).toBeInTheDocument();
    expect(useMotionStore.getState().leftTab).toBe("creation");
  });
});
