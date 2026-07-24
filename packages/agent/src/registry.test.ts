import { describe, it, expect } from "vitest";
import {
  listTools,
  toAnthropicTools,
  toOpenAITools,
  toMcpTools,
  toCapabilityDoc,
  getTool,
} from "./registry";
import type { EditingHost, HumanoidRigRequest, ModelInspectionRequest } from "./host";

describe("tool registry", () => {
  it("has unique tool names", () => {
    const names = listTools().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(40);
  });

  it("every tool has an object input schema", () => {
    for (const t of listTools()) {
      expect(t.inputSchema.type).toBe("object");
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("read tools are read-only and never destructive", () => {
    for (const t of listTools()) {
      if (t.domain === "read") {
        expect(t.readOnly).toBe(true);
        expect(t.destructive).toBe(false);
      }
    }
  });

  it("includes the escape hatch + key domains", () => {
    expect(getTool("execute_action")).toBeTruthy();
    expect(getTool("batch_actions")).toBeTruthy();
    expect(getTool("get_capabilities")).toBeTruthy();
    expect(getTool("duplicate_track")).toBeTruthy();
    expect(getTool("transfer_motion_effect_stack")).toBeTruthy();
    expect(getTool("transfer_motion_mask_stack")).toBeTruthy();
    expect(getTool("group_motion_layers")).toBeTruthy();
    expect(getTool("ungroup_motion_layers")).toBeTruthy();
    expect(getTool("set_motion_group_auto_layout")).toBeTruthy();
    expect(getTool("precompose_motion_layers")).toBeTruthy();
    expect(getTool("add_motion_component_instance")).toBeTruthy();
    expect(getTool("set_motion_instance_overrides")).toBeTruthy();
    expect(getTool("disintegrate_motion_layer")).toBeTruthy();
    expect(getTool("morph_motion_layers")).toBeTruthy();
    expect(getTool("add_motion_cursor_click")).toBeTruthy();
    expect(getTool("get_creation_capabilities")).toBeTruthy();
    expect(getTool("probe_rigging_backend")).toBeTruthy();
    expect(getTool("inspect_3d_model")).toBeTruthy();
    expect(getTool("rig_humanoid_model")).toBeTruthy();
    expect(getTool("create_creation_3d_scene")).toBeTruthy();
    expect(getTool("sync_creation_scene_to_motion")).toBeTruthy();
    expect(getTool("add_creation_scene_object")).toBeTruthy();
    expect(getTool("add_creation_product_part")).toBeTruthy();
    expect(getTool("add_creation_screen_stack")).toBeTruthy();
    expect(getTool("add_creation_camera_module")).toBeTruthy();
    expect(getTool("add_creation_product_internals")).toBeTruthy();
    expect(getTool("add_creation_product_callout")).toBeTruthy();
    expect(getTool("create_product_cinematic_scene")).toBeTruthy();
    expect(getTool("list_creation_assets")).toBeTruthy();
    expect(getTool("list_creation_scenes")).toBeTruthy();
    expect(getTool("validate_creation_state")).toBeTruthy();
    expect(getTool("inspect_creation_product_parts")).toBeTruthy();
    expect(getTool("render_creation_preview")).toBeTruthy();
    expect(getTool("set_creation_object_transform")).toBeTruthy();
    expect(getTool("set_creation_object_material")).toBeTruthy();
    expect(getTool("apply_creation_material_preset")).toBeTruthy();
    expect(getTool("apply_creation_xray_material")).toBeTruthy();
    expect(getTool("apply_creation_surface_detail")).toBeTruthy();
    expect(getTool("set_creation_object_geometry")).toBeTruthy();
    expect(getTool("apply_creation_bevel")).toBeTruthy();
    expect(getTool("apply_creation_displacement")).toBeTruthy();
    expect(getTool("remove_creation_scene_object")).toBeTruthy();
    expect(getTool("set_creation_scene_environment")).toBeTruthy();
    expect(getTool("set_creation_camera")).toBeTruthy();
    expect(getTool("animate_creation_camera")).toBeTruthy();
    expect(getTool("animate_creation_object")).toBeTruthy();
    expect(getTool("animate_creation_exploded_view")).toBeTruthy();
    expect(getTool("apply_creation_cloth_wave")).toBeTruthy();
    expect(getTool("add_creation_cutaway_plane")).toBeTruthy();
    expect(getTool("add_creation_decal")).toBeTruthy();
    expect(getTool("add_creation_ui_panel")).toBeTruthy();
    expect(getTool("add_creation_light_sweep")).toBeTruthy();
    expect(getTool("scatter_creation_objects")).toBeTruthy();
    const domains = new Set(listTools().map((t) => t.domain));
    for (const d of ["read", "clip", "track", "effect", "color", "audio", "subtitle", "raw"]) {
      expect(domains.has(d as never)).toBe(true);
    }
  });

  it("projects to all three provider formats with matching names", () => {
    const base = listTools().map((t) => t.name).sort();
    expect(toAnthropicTools().map((t) => t.name).sort()).toEqual(base);
    expect(toOpenAITools().map((t) => t.function.name).sort()).toEqual(base);
    expect(toMcpTools().map((t) => t.name).sort()).toEqual(base);
  });

  it("generates a capability doc", () => {
    const doc = toCapabilityDoc();
    expect(doc).toContain("OpenReel Agent Tools");
    expect(doc).toContain("execute_action");
  });

  it("reports rigging probe as unavailable when the host has no desktop backend", async () => {
    const tool = getTool("probe_rigging_backend");
    expect(tool).toBeTruthy();

    const result = await tool!.handler({}, {} as EditingHost);
    expect(result.ok).toBe(true);
    expect((result.data as { available?: boolean }).available).toBe(false);
  });

  it("uses the host rigging probe when present", async () => {
    const tool = getTool("probe_rigging_backend");
    const result = await tool!.handler(
      {},
      {
        probeRiggingBackend: async () => ({
          available: true,
          provider: "blender",
          mode: "system",
          version: "4.3.2",
        }),
      } as unknown as EditingHost,
    );
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("available");
    expect((result.data as { version?: string }).version).toBe("4.3.2");
  });

  it("reports model inspection as unavailable when the host has no model loader", async () => {
    const tool = getTool("inspect_3d_model");
    expect(tool).toBeTruthy();

    const result = await tool!.handler(
      { modelUrl: "file:///models/astronaut.glb" },
      {} as EditingHost,
    );
    expect(result.ok).toBe(true);
    expect((result.data as { available?: boolean }).available).toBe(false);
  });

  it("uses the host model inspector when present", async () => {
    const tool = getTool("inspect_3d_model");
    const result = await tool!.handler(
      { modelUrl: "file:///models/astronaut.glb", name: "Astronaut" },
      {
        inspectModel: async (request: ModelInspectionRequest) => ({
          modelUrl: request.modelUrl,
          name: request.name,
          source: request.source,
          meshCount: 2,
          materialCount: 3,
          textureCount: 1,
          animationCount: 1,
          vertexCount: 1200,
          triangleCount: 800,
          meshes: [],
          materials: [],
          textures: [],
          animations: [
            {
              name: "Wave",
              duration: 2.4,
              trackCount: 18,
              targetCount: 6,
              tracks: [],
            },
          ],
          armature: {
            hasSkinnedMesh: true,
            skinnedMeshCount: 1,
            boneCount: 42,
            rootBones: ["Hips"],
            sampleBones: ["Hips", "Spine", "Head"],
          },
          warnings: [],
          suggestedNextTools: ["set_model_animation", "retarget_animation_clip"],
        }),
      } as unknown as EditingHost,
    );
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("1 animation");
    expect((result.data as { available?: boolean; animationCount?: number }).available).toBe(true);
    expect((result.data as { animationCount?: number }).animationCount).toBe(1);
  });

  it("uses the host humanoid rigging job when present", async () => {
    const tool = getTool("rig_humanoid_model");
    expect(tool).toBeTruthy();

    const result = await tool!.handler(
      {
        modelUrl: "file:///models/astronaut.glb",
        name: "Astronaut",
        outputPath: "/tmp/astronaut-rigged.glb",
        overwriteExisting: true,
      },
      {
        rigHumanoidModel: async (request: HumanoidRigRequest) => ({
          ok: true,
          provider: "blender",
          inputUrl: request.modelUrl,
          outputPath: request.outputPath,
          outputUrl: "file:///tmp/astronaut-rigged.glb",
          armatureName: "Astronaut Armature",
          createdArmature: true,
          preservedExistingArmature: false,
          skinnedMeshCount: 1,
          meshCount: 1,
          boneCount: 16,
          warnings: [],
        }),
      } as unknown as EditingHost,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("16 bone");
    expect(result.data).toMatchObject({
      ok: true,
      modelUrl: "file:///models/astronaut.glb",
      outputUrl: "file:///tmp/astronaut-rigged.glb",
      createdArmature: true,
      boneCount: 16,
    });
  });

  it("creates product cinematic scenes through the motion composition action path", async () => {
    const tool = getTool("create_product_cinematic_scene");
    expect(tool).toBeTruthy();

    const actions: Array<{ type: string; params: Record<string, unknown> }> = [];
    const result = await tool!.handler(
      { name: "Agent Product Reveal", duration: 5, includeInternals: true },
      {
        requireOpenProject: () => undefined,
        getProject: () => ({
          id: "project-1",
          name: "Test Project",
          createdAt: 0,
          modifiedAt: 0,
          settings: {
            width: 1280,
            height: 720,
            frameRate: 24,
            sampleRate: 48000,
            channels: 2,
          },
          mediaLibrary: { items: [] },
          timeline: { tracks: [], subtitles: [], duration: 0, markers: [] },
          motionCompositions: [],
        }),
        applyAction: async (action) => {
          actions.push({ type: action.type, params: action.params });
          return { success: true };
        },
        beginTransaction: () => ({ id: "tx-1" }),
        commitTransaction: () => undefined,
        rollbackTransaction: async () => undefined,
        runJob: async () => ({ ok: true }),
        capabilities: () => ({}) as ReturnType<EditingHost["capabilities"]>,
      } as EditingHost,
    );

    expect(result.ok).toBe(true);
    expect(actions.map((action) => action.type)).toEqual([
      "creation/applyOperation",
      "creation/applyOperation",
      "creation/applyOperation",
      "motion/createComposition",
    ]);
    expect(
      actions
        .slice(0, 3)
        .map((action) => (action.params.operation as { type?: string }).type),
    ).toEqual(["asset/upsert", "scene/upsert", "scene/set-active"]);

    const composition = actions[3]?.params.composition as {
      readonly layers?: readonly { readonly type: string; readonly objects?: readonly unknown[] }[];
    };
    expect(composition.layers?.[0]?.type).toBe("scene3d");
    expect(composition.layers?.[0]?.objects?.length).toBeGreaterThan(10);
    expect(
      (result.data as { creationSceneId?: string }).creationSceneId,
    ).toBe("scene-product-phone-cinematic");
    expect((result.data as { partCount?: number }).partCount).toBeGreaterThan(10);
  });
});
