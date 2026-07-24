import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  executeTool: vi.fn(),
  getTool: vi.fn(),
  isDestructive: vi.fn(() => false),
  isExpensive: vi.fn(() => false),
  toMcpTools: vi.fn(() => [
    { name: "list_clips", description: "List", inputSchema: { type: "object" } },
  ]),
  autoAllow: false,
  motionState: {
    activeCompositionId: "starter",
    setActiveCompositionId: vi.fn(),
    setPlayhead: vi.fn(),
    selectLayer: vi.fn(),
  },
  setDesktopPage: vi.fn(),
}));

vi.mock("@openreel/agent", () => ({
  executeTool: h.executeTool,
  getTool: h.getTool,
  isDestructive: h.isDestructive,
  isExpensive: h.isExpensive,
  toMcpTools: h.toMcpTools,
}));

vi.mock("./host-singleton", () => ({
  getLiveEditorHost: () => ({ id: "host" }),
  runExclusive: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../../stores/settings-store", () => ({
  useSettingsStore: {
    getState: () => ({ mcpAutoAllowTrustedLocal: h.autoAllow }),
  },
}));

vi.mock("../../motion/stores/motion-store", () => ({
  useMotionStore: {
    getState: () => h.motionState,
  },
}));

vi.mock("../../stores/ui-store", () => ({
  useUIStore: {
    getState: () => ({ setDesktopPage: h.setDesktopPage }),
  },
}));

import { handleMcpBridgeRequest } from "./mcp-listener";

describe("handleMcpBridgeRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isDestructive.mockReturnValue(false);
    h.isExpensive.mockReturnValue(false);
    h.getTool.mockReturnValue({ domain: "read" });
    h.toMcpTools.mockReturnValue([
      { name: "list_clips", description: "List", inputSchema: { type: "object" } },
    ]);
    h.autoAllow = false;
    h.motionState.activeCompositionId = "starter";
    h.motionState.setActiveCompositionId.mockClear();
    h.motionState.setPlayhead.mockClear();
    h.motionState.selectLayer.mockClear();
    h.setDesktopPage.mockClear();
  });

  it("returns the registry for listTools", async () => {
    const res = await handleMcpBridgeRequest({ callId: "c1", kind: "listTools" });
    expect(res.ok).toBe(true);
    expect(res.result).toHaveLength(1);
    expect(h.executeTool).not.toHaveBeenCalled();
  });

  it("executes a safe tool against the shared host", async () => {
    h.executeTool.mockResolvedValue({ ok: true, summary: "Listed" });
    const res = await handleMcpBridgeRequest({
      callId: "c2",
      kind: "callTool",
      name: "list_clips",
      args: { trackId: "t1" },
    });
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ ok: true, summary: "Listed" });
    expect(h.executeTool).toHaveBeenCalledWith("list_clips", { trackId: "t1" }, { id: "host" });
  });

  it("gates destructive tools when auto-allow is off", async () => {
    h.isDestructive.mockReturnValue(true);
    const res = await handleMcpBridgeRequest({
      callId: "c3",
      kind: "callTool",
      name: "delete_media",
    });
    expect(res.ok).toBe(true);
    expect(h.executeTool).not.toHaveBeenCalled();
    expect((res.result as { error?: { code: string } }).error?.code).toBe(
      "CONFIRMATION_REQUIRED",
    );
  });

  it("permits destructive tools when auto-allow is on", async () => {
    h.isDestructive.mockReturnValue(true);
    h.autoAllow = true;
    h.executeTool.mockResolvedValue({ ok: true, summary: "Deleted" });
    const res = await handleMcpBridgeRequest({
      callId: "c4",
      kind: "callTool",
      name: "delete_media",
    });
    expect(h.executeTool).toHaveBeenCalled();
    expect(res.result).toEqual({ ok: true, summary: "Deleted" });
  });

  it("focuses the Motion Creator surface after successful MCP motion edits", async () => {
    h.getTool.mockReturnValue({ domain: "motion" });
    h.executeTool.mockResolvedValue({
      ok: true,
      summary: "Created 3D scene",
      data: { compositionId: "comp-agent", layerId: "layer-scene" },
    });

    const res = await handleMcpBridgeRequest({
      callId: "c-motion",
      kind: "callTool",
      name: "add_motion_3d_scene",
      args: { compositionId: "comp-agent", startTime: 1.25 },
    });

    expect(res.ok).toBe(true);
    expect(h.motionState.setActiveCompositionId).toHaveBeenCalledWith(
      "comp-agent",
    );
    expect(h.motionState.setPlayhead).toHaveBeenCalledWith(1.25);
    expect(h.motionState.selectLayer).toHaveBeenCalledWith("layer-scene");
    expect(h.setDesktopPage).toHaveBeenCalledWith("motion");
  });

  it("opens newly activated scene3d compositions on their resolved preview frame", async () => {
    h.getTool.mockReturnValue({ domain: "motion" });
    h.executeTool.mockResolvedValue({
      ok: true,
      summary: "Synced scene",
      data: {
        compositionId: "comp-scene3d",
        layerId: "layer-scene3d",
        composition: {
          id: "comp-scene3d",
          name: "Agent 3D Scene",
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: 10,
          backgroundColor: "#05070d",
          layers: [
            {
              id: "layer-scene3d",
              type: "scene3d",
              name: "Agent 3D Scene",
              startTime: 0,
              duration: 10,
              visible: true,
              locked: false,
              transform: { position: { x: 960, y: 540 }, scale: { x: 1, y: 1 } },
              keyframes: [],
              object: { kind: "sphere", radius: 1 },
            },
          ],
          assets: [],
          variables: [],
          markers: [],
          createdAt: 1,
          modifiedAt: 1,
        },
      },
    });

    const res = await handleMcpBridgeRequest({
      callId: "c-scene3d",
      kind: "callTool",
      name: "sync_creation_scene_to_motion",
      args: { sceneId: "scene-1" },
    });

    expect(res.ok).toBe(true);
    expect(h.motionState.setActiveCompositionId).toHaveBeenCalledWith(
      "comp-scene3d",
    );
    expect(h.motionState.setPlayhead).toHaveBeenCalledWith(8.5);
    expect(h.motionState.selectLayer).toHaveBeenCalledWith("layer-scene3d");
  });

  it("follows synced creation composition and layer ids from MCP edit tools", async () => {
    h.getTool.mockReturnValue({ domain: "motion" });
    h.executeTool.mockResolvedValue({
      ok: true,
      summary: "Animated object",
      data: {
        syncedCompositionId: "comp-synced-creation",
        syncedLayerId: "layer-synced-scene",
      },
    });

    const res = await handleMcpBridgeRequest({
      callId: "c-synced-edit",
      kind: "callTool",
      name: "animate_creation_object",
      args: {
        sceneId: "scene-creation",
        objectId: "object-creation",
        position: [{ time: 2.5, x: 1, y: 0, z: 0 }],
      },
    });

    expect(res.ok).toBe(true);
    expect(h.motionState.setActiveCompositionId).toHaveBeenCalledWith(
      "comp-synced-creation",
    );
    expect(h.motionState.setPlayhead).toHaveBeenCalledWith(2.5);
    expect(h.motionState.selectLayer).toHaveBeenCalledWith("layer-synced-scene");
    expect(h.setDesktopPage).toHaveBeenCalledWith("motion");
  });

  it("focuses the editor after an MCP motion insert", async () => {
    h.getTool.mockReturnValue({ domain: "motion" });
    h.executeTool.mockResolvedValue({
      ok: true,
      summary: "Inserted motion scene",
      data: { compositionId: "comp-agent", instanceId: "instance-1" },
    });

    const res = await handleMcpBridgeRequest({
      callId: "c-insert",
      kind: "callTool",
      name: "insert_motion_into_editor",
      args: { compositionId: "comp-agent", startTime: 0 },
    });

    expect(res.ok).toBe(true);
    expect(h.setDesktopPage).toHaveBeenCalledWith("edit");
    expect(h.motionState.setActiveCompositionId).toHaveBeenCalledWith(
      "comp-agent",
    );
    expect(h.motionState.setPlayhead).toHaveBeenCalledWith(0);
  });

  it("focuses the editor after a motion tool creates an inserted timeline instance", async () => {
    h.getTool.mockReturnValue({ domain: "motion" });
    h.executeTool.mockResolvedValue({
      ok: true,
      summary: "Created product cinematic",
      data: {
        compositionId: "comp-product",
        sceneLayerId: "scene-layer",
        insertedInstanceId: "instance-product",
        insertedClipId: "motion-clip-instance-product",
      },
    });

    await handleMcpBridgeRequest({
      callId: "c-product",
      kind: "callTool",
      name: "create_product_cinematic_scene",
      args: { insertIntoEditor: true },
    });

    expect(h.setDesktopPage).toHaveBeenCalledWith("edit");
    expect(h.motionState.setActiveCompositionId).toHaveBeenCalledWith(
      "comp-product",
    );
    expect(h.motionState.selectLayer).not.toHaveBeenCalled();
  });

  it("does not move Motion Creator focus for non-motion tools", async () => {
    h.getTool.mockReturnValue({ domain: "clip" });
    h.executeTool.mockResolvedValue({
      ok: true,
      summary: "Added clip",
      data: { compositionId: "comp-agent", layerId: "layer-scene" },
    });

    await handleMcpBridgeRequest({
      callId: "c-clip",
      kind: "callTool",
      name: "add_clip",
      args: { compositionId: "comp-agent" },
    });

    expect(h.motionState.setActiveCompositionId).not.toHaveBeenCalled();
    expect(h.motionState.setPlayhead).not.toHaveBeenCalled();
    expect(h.motionState.selectLayer).not.toHaveBeenCalled();
    expect(h.setDesktopPage).not.toHaveBeenCalled();
  });

  it("errors when callTool is missing a name", async () => {
    const res = await handleMcpBridgeRequest({ callId: "c5", kind: "callTool" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/name/i);
  });
});
