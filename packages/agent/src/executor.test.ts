import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { HeadlessHost } from "./headless-host";
import { executeTool, isDestructive } from "./executor";
import { makeEmptyProject, makeProjectWithClip } from "./test-fixtures";
import type { EditorStateView, ClipView } from "./serialize";
import { getMotionLayerPropertyValueAtTime } from "@openreel/core/motion/motion-keyframes";
import type { MotionLayer } from "@openreel/core/motion/types";

function decodePngDataUri(dataUri: string): { width: number; height: number; rgba: Uint8Array } {
  const encoded = dataUri.replace(/^data:image\/png;base64,/, "");
  const png = Buffer.from(encoded, "base64");
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === "IHDR") {
      width = png.readUInt32BE(dataStart);
      height = png.readUInt32BE(dataStart + 4);
    } else if (type === "IDAT") {
      idat.push(png.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rowLength = width * 4;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowLength + 1);
    if (raw[rowStart] !== 0) throw new Error("Only PNG filter type 0 is supported in tests");
    rgba.set(raw.subarray(rowStart + 1, rowStart + 1 + rowLength), y * rowLength);
  }
  return { width, height, rgba };
}

describe("executeTool", () => {
  it("runs a read tool (get_editor_state)", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const res = await executeTool("get_editor_state", {}, host);
    expect(res.ok).toBe(true);
    const data = res.data as EditorStateView;
    expect(data.trackCount).toBe(1);
    expect(data.clipCount).toBe(1);
  });

  it("runs an action tool (add_track)", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const res = await executeTool("add_track", { trackType: "video" }, host);
    expect(res.ok).toBe(true);
    expect(host.getProject().timeline.tracks).toHaveLength(1);
  });

  it("duplicates a timeline track through a dedicated tool", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const res = await executeTool(
      "duplicate_track",
      { sourceTrackId: "t1" },
      host,
    );
    expect(res.ok).toBe(true);
    const tracks = host.getProject().timeline.tracks;
    expect(tracks).toHaveLength(2);
    expect(tracks[1].name).toBe(`${tracks[0].name} Copy`);
    expect(tracks[1].clips[0].id).not.toBe(tracks[0].clips[0].id);
    expect(tracks[1].clips[0].trackId).toBe(tracks[1].id);
  });

  it("sets clip speed by clipId and recomputes duration", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const res = await executeTool("set_clip_speed", { clipId: "c1", speed: 2 }, host);
    expect(res.ok).toBe(true);
    expect(host.getProject().timeline.tracks[0].clips[0].speed).toBe(2);
  });

  it("resolves a clip by clipIndex when clipId is absent", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const res = await executeTool("set_clip_reverse", { clipIndex: 0, reversed: true }, host);
    expect(res.ok).toBe(true);
    expect(host.getProject().timeline.tracks[0].clips[0].reversed).toBe(true);
  });

  it("filters clips in list_clips", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const inRange = (await executeTool("list_clips", { fromSec: 0, toSec: 1 }, host)).data as ClipView[];
    const outRange = (await executeTool("list_clips", { fromSec: 100, toSec: 200 }, host)).data as ClipView[];
    expect(inRange).toHaveLength(1);
    expect(outRange).toHaveLength(0);
  });

  it("supports the execute_action escape hatch", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const res = await executeTool(
      "execute_action",
      { type: "clip/setStabilization", params: { clipId: "c1", stabilization: { enabled: true } } },
      host,
    );
    expect(res.ok).toBe(true);
    expect(host.getProject().timeline.tracks[0].clips[0].stabilization?.enabled).toBe(true);
  });

  it("returns an error for an unknown tool", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const res = await executeTool("nope", {}, host);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("UNKNOWN_TOOL");
  });

  it("flags destructive tools", () => {
    expect(isDestructive("remove_clip")).toBe(true);
    expect(isDestructive("get_editor_state")).toBe(false);
    expect(isDestructive("execute_action")).toBe(true);
  });

  it("get_capabilities returns the manifest", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const res = await executeTool("get_capabilities", {}, host);
    expect(res.ok).toBe(true);
    expect((res.data as { blendModes: string[] }).blendModes.length).toBeGreaterThan(0);
  });

  it("get_creation_capabilities returns agent-native creation vocabulary", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const res = await executeTool("get_creation_capabilities", {}, host);
    expect(res.ok).toBe(true);
    const data = res.data as {
      objectKinds: string[];
      materialModels: string[];
      materialPresets: string[];
      texturePatterns: string[];
      productPartRoles: string[];
      characterStyles: string[];
      characterPartRoles: string[];
      characterPoses: string[];
      particleKinds: string[];
      environmentKinds: string[];
      animationChannels: string[];
      coreWorkflow: string[];
      recoveryWorkflow: string[];
    };
    expect(data.objectKinds).toContain("text3d");
    expect(data.objectKinds).toContain("model");
    expect(data.materialModels).toContain("emissive");
    expect(data.materialPresets).toContain("brushed-titanium");
    expect(data.materialPresets).toContain("silicon-chip");
    expect(data.productPartRoles).toContain("battery");
    expect(data.productPartRoles).toContain("camera-module");
    expect(data.environmentKinds).toContain("space");
    expect(data.animationChannels).toContain("camera.target");
    expect(data.coreWorkflow).toContain("create_creation_3d_scene");
    expect(data.coreWorkflow).toContain("render_creation_preview");
    expect(data.coreWorkflow).toContain("inspect_creation_product_parts");
    expect(data.coreWorkflow).toContain("inspect_3d_model");
    expect(data.coreWorkflow).toContain("rig_humanoid_model");
    expect(data.coreWorkflow).toContain("add_creation_product_part");
    expect(data.coreWorkflow).toContain("add_creation_screen_stack");
    expect(data.coreWorkflow).toContain("add_creation_camera_module");
    expect(data.coreWorkflow).toContain("add_creation_product_internals");
    expect(data.coreWorkflow).toContain("scatter_creation_objects");
    expect(data.coreWorkflow).toContain("apply_creation_material_preset");
    expect(data.coreWorkflow).toContain("apply_creation_xray_material");
    expect(data.coreWorkflow).toContain("apply_creation_surface_detail");
    expect(data.coreWorkflow).toContain("apply_creation_bevel");
    expect(data.coreWorkflow).toContain("apply_creation_displacement");
    expect(data.coreWorkflow).toContain("apply_creation_cloth_wave");
    expect(data.coreWorkflow).toContain("animate_creation_exploded_view");
    expect(data.coreWorkflow).toContain("add_creation_cutaway_plane");
    expect(data.coreWorkflow).toContain("add_creation_decal");
    expect(data.coreWorkflow).toContain("add_creation_ui_panel");
    expect(data.coreWorkflow).toContain("add_creation_light_sweep");
    expect(data.coreWorkflow).toContain("add_creation_product_callout");
    expect(data.coreWorkflow).toContain("add_creation_character");
    expect(data.coreWorkflow).toContain("pose_creation_character");
    expect(data.coreWorkflow).toContain("add_creation_particle_system");
    expect(data.coreWorkflow).toContain("simulate_creation_rigid_drop");
    expect(data.coreWorkflow).toContain("duplicate_creation_object");
    expect(data.coreWorkflow).toContain("add_creation_procedural_texture");
    expect(data.coreWorkflow).toContain("bake_creation_asset");
    expect(data.coreWorkflow).toContain("bake_creation_texture");
    expect(data.coreWorkflow).toContain("animate_creation_camera");
    expect(data.texturePatterns).toContain("circuit");
    expect(data.characterStyles).toContain("astronaut");
    expect(data.characterPartRoles).toContain("upper-arm");
    expect(data.characterPoses).toContain("wave");
    expect(data.particleKinds).toContain("stars");
    expect(data.recoveryWorkflow).toContain("inspect_creation_product_parts");
    expect(data.recoveryWorkflow).toContain("sync_creation_scene_to_motion");
    expect(data.recoveryWorkflow).toContain("bake_creation_asset");
    expect(data.recoveryWorkflow).toContain("export_creation_scene_gltf");
    expect(data.recoveryWorkflow).toContain("render_creation_scene_image");
    expect(data.recoveryWorkflow).toContain("critique_creation_scene");
    expect(data.recoveryWorkflow).toContain("get_creation_history");
  });

  it("exposes the CPU creation engine via compute tools (IK, material graph, cloth)", async () => {
    const host = new HeadlessHost(makeEmptyProject());

    const ik = await executeTool(
      "solve_creation_ik",
      {
        root: { x: 0, y: 2, z: 0 },
        target: { x: 0, y: 0, z: 0 },
        upperLength: 1,
        lowerLength: 1,
      },
      host,
    );
    expect(ik.ok).toBe(true);
    const ikData = ik.data as { elbow: { x: number; y: number }; reachable: boolean };
    expect(ikData.reachable).toBe(true);
    expect(ikData.elbow.y).toBeCloseTo(1, 5);

    const material = await executeTool(
      "evaluate_creation_material_graph",
      {
        graph: {
          output: "out",
          nodes: [
            { id: "red", type: "color", params: { color: "#ff0000" } },
            { id: "blue", type: "color", params: { color: "#0000ff" } },
            { id: "mixed", type: "mix", inputs: ["red", "blue"], params: { factor: 0.5 } },
            { id: "out", type: "output", inputs: ["mixed"], params: { metallic: 0.5 } },
          ],
        },
      },
      host,
    );
    expect(material.ok).toBe(true);
    expect((material.data as { baseColor: string }).baseColor).toBe("#800080");

    const cloth = await executeTool(
      "simulate_creation_cloth",
      { columns: 5, rows: 5, pin: "left", steps: 40, plane: "xy" },
      host,
    );
    expect(cloth.ok).toBe(true);
    const clothData = cloth.data as { vertexCount: number; triangleCount: number; pin: string };
    expect(clothData.vertexCount).toBe(25);
    expect(clothData.triangleCount).toBe(32);
    expect(clothData.pin).toBe("left");
  });

  it("critiques a creation scene and lists its operation history", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-review",
        compositionId: "comp-review",
        layerId: "layer-review",
        name: "Review Scene",
        duration: 4,
        objects: [
          {
            key: "hero",
            partId: "hero",
            kind: "rounded-box",
            name: "Hero",
            color: "#3b82f6",
            materialModel: "metal",
            tags: ["hero"],
          },
        ],
      },
      host,
    );

    const critique = await executeTool(
      "critique_creation_scene",
      { sceneId: "scene-review" },
      host,
    );
    expect(critique.ok).toBe(true);
    const critiqueData = critique.data as {
      ok: boolean;
      errorCount: number;
      issues: Array<{ code: string; severity: string; suggestion: string }>;
    };
    expect(critiqueData.errorCount).toBe(0);
    expect(critiqueData.ok).toBe(true);
    expect(critiqueData.issues.some((issue) => issue.code === "UNBAKED_MESHES")).toBe(true);

    const history = await executeTool("get_creation_history", { sceneId: "scene-review" }, host);
    expect(history.ok).toBe(true);
    const historyData = history.data as {
      operations: Array<{ type: string; source: string }>;
      returned: number;
    };
    expect(historyData.returned).toBeGreaterThan(0);
    expect(historyData.operations.some((operation) => operation.type === "scene/upsert")).toBe(true);
    expect(historyData.operations.every((operation) => operation.source === "agent")).toBe(true);

    const missing = await executeTool(
      "critique_creation_scene",
      { sceneId: "does-not-exist" },
      host,
    );
    expect((missing.data as { error?: string }).error).toBeTruthy();
  });

  it("flags stale creation render bindings whose Motion target is missing", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-stale-render",
        compositionId: "comp-stale-render",
        layerId: "layer-stale-render",
        name: "Stale Render Scene",
        objects: [{ key: "cube", kind: "box", name: "Cube" }],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const project = structuredClone(host.getProject());
    host.setProject({ ...project, motionCompositions: [] });

    const missingComposition = await executeTool(
      "critique_creation_scene",
      { sceneId: "scene-stale-render" },
      host,
    );
    expect(missingComposition.ok).toBe(true);
    const missingCompositionData = missingComposition.data as {
      ok: boolean;
      errorCount: number;
      issues: Array<{ code: string; severity: string; suggestion: string }>;
    };
    expect(missingCompositionData.ok).toBe(false);
    expect(missingCompositionData.errorCount).toBe(1);
    expect(missingCompositionData.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_RENDER_COMPOSITION",
        severity: "error",
        suggestion: "sync_creation_scene_to_motion",
      }),
    );

    host.setProject({
      ...project,
      motionCompositions: project.motionCompositions?.map((composition) =>
        composition.id === "comp-stale-render"
          ? { ...composition, layers: [] }
          : composition,
      ),
    });

    const missingLayer = await executeTool(
      "critique_creation_scene",
      { sceneId: "scene-stale-render" },
      host,
    );
    expect(missingLayer.ok).toBe(true);
    const missingLayerData = missingLayer.data as {
      ok: boolean;
      errorCount: number;
      issues: Array<{ code: string; severity: string; suggestion: string }>;
    };
    expect(missingLayerData.ok).toBe(false);
    expect(missingLayerData.errorCount).toBe(1);
    expect(missingLayerData.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_RENDER_LAYER",
        severity: "error",
        suggestion: "sync_creation_scene_to_motion",
      }),
    );
  });

  it("validates creation render bindings against actual Motion targets", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-validate-render",
        compositionId: "comp-validate-render",
        layerId: "layer-validate-render",
        name: "Validate Render Scene",
        objects: [{ key: "cube", kind: "box", name: "Cube" }],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const project = structuredClone(host.getProject());
    host.setProject({ ...project, motionCompositions: [] });
    const missingComposition = (await executeTool("validate_creation_state", {}, host))
      .data as { issues: Array<{ code: string; severity: string; path?: string }> };
    expect(missingComposition.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_RENDER_COMPOSITION",
        severity: "error",
      }),
    );

    host.setProject({
      ...project,
      motionCompositions: project.motionCompositions?.map((composition) =>
        composition.id === "comp-validate-render"
          ? { ...composition, layers: [] }
          : composition,
      ),
    });
    const missingLayer = (await executeTool("validate_creation_state", {}, host))
      .data as { issues: Array<{ code: string; severity: string; path?: string }> };
    expect(missingLayer.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_RENDER_LAYER",
        severity: "error",
      }),
    );

    host.setProject({
      ...project,
      motionCompositions: project.motionCompositions?.map((composition) =>
        composition.id === "comp-validate-render"
          ? {
              ...composition,
              layers: composition.layers.map((layer) =>
                layer.id === "layer-validate-render" && layer.type === "scene3d"
                  ? { ...layer, objects: [] }
                  : layer,
              ),
            }
          : composition,
      ),
    });
    const missingObject = (await executeTool("validate_creation_state", {}, host))
      .data as { issues: Array<{ code: string; severity: string; path?: string }> };
    expect(missingObject.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_RENDER_OBJECT",
        severity: "error",
      }),
    );
  });

  it("creates and lists motion compositions", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_motion_composition",
      { name: "Launch Scene", duration: 4 },
      host,
    );
    expect(created.ok).toBe(true);

    const listed = await executeTool("list_motion_compositions", {}, host);
    expect(listed.ok).toBe(true);
    const data = listed.data as {
      compositions: Array<{ id: string; name: string; duration: number }>;
    };
    expect(data.compositions).toHaveLength(1);
    expect(data.compositions[0]).toMatchObject({
      name: "Launch Scene",
      duration: 4,
    });
  });

  it("builds a Figma-style flow: group -> auto-layout -> component -> instance -> override", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const comp = await executeTool(
      "create_motion_composition",
      { name: "UI", duration: 4 },
      host,
    );
    const compositionId = (comp.data as { compositionId: string }).compositionId;

    const a = await executeTool(
      "add_motion_layer",
      { compositionId, layerType: "shape", name: "A", shapeType: "rectangle", width: 100, height: 60 },
      host,
    );
    const b = await executeTool(
      "add_motion_layer",
      { compositionId, layerType: "shape", name: "B", shapeType: "rectangle", width: 100, height: 60 },
      host,
    );
    const aId = (a.data as { layerId: string }).layerId;
    const bId = (b.data as { layerId: string }).layerId;

    const grouped = await executeTool(
      "group_motion_layers",
      { compositionId, layerIds: [aId, bId], name: "Row" },
      host,
    );
    expect(grouped.ok).toBe(true);
    const groupId = (grouped.data as { groupId: string }).groupId;
    const compsAfterGroup = host.getProject().motionCompositions ?? [];
    const afterGroup = compsAfterGroup.find((c) => c.id === compositionId)!;
    expect(afterGroup.layers.find((l) => l.id === aId)?.parentId).toBe(groupId);

    const layout = await executeTool(
      "set_motion_group_auto_layout",
      { compositionId, groupId, direction: "horizontal", gap: 24, align: "center" },
      host,
    );
    expect(layout.ok).toBe(true);
    const afterLayout = (host.getProject().motionCompositions ?? []).find(
      (c) => c.id === compositionId,
    )!;
    const ax = afterLayout.layers.find((l) => l.id === aId)!.transform.position.x;
    const bx = afterLayout.layers.find((l) => l.id === bId)!.transform.position.x;
    expect(ax).toBeCloseTo(-62, 1);
    expect(bx).toBeCloseTo(62, 1);

    const pre = await executeTool(
      "precompose_motion_layers",
      { compositionId, layerIds: [groupId], name: "Button" },
      host,
    );
    expect(pre.ok).toBe(true);
    const { componentId, precompLayerId } = pre.data as {
      componentId: string;
      precompLayerId: string;
    };
    const compositions = host.getProject().motionCompositions ?? [];
    expect(compositions.some((c) => c.id === componentId)).toBe(true);
    const hostComp = compositions.find((c) => c.id === compositionId)!;
    expect(hostComp.layers.find((l) => l.id === precompLayerId)?.type).toBe(
      "composition",
    );

    const inst = await executeTool(
      "add_motion_component_instance",
      { compositionId, instanceLayerId: precompLayerId },
      host,
    );
    expect(inst.ok).toBe(true);
    const newInstanceId = (inst.data as { instanceLayerId: string }).instanceLayerId;
    const withInstance = (host.getProject().motionCompositions ?? []).find(
      (c) => c.id === compositionId,
    )!;
    expect(withInstance.layers.filter((l) => l.type === "composition")).toHaveLength(2);

    const master = (host.getProject().motionCompositions ?? []).find(
      (c) => c.id === componentId,
    )!;
    const childShape = master.layers.find((l) => l.type === "shape")!;
    const ov = await executeTool(
      "set_motion_instance_overrides",
      {
        compositionId,
        instanceLayerId: newInstanceId,
        overrides: [{ childLayerId: childShape.id, color: "#ff0000" }],
      },
      host,
    );
    expect(ov.ok).toBe(true);
    const finalComp = (host.getProject().motionCompositions ?? []).find(
      (c) => c.id === compositionId,
    )!;
    const overridden = finalComp.layers.find(
      (l) => l.id === newInstanceId,
    ) as MotionLayer & { overrides?: Record<string, { color?: string }> };
    expect(overridden.overrides?.[childShape.id]?.color).toBe("#ff0000");
  });

  it("runs AE choreography tools: cursor click, morph, disintegrate", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const comp = await executeTool(
      "create_motion_composition",
      { name: "AE", duration: 6 },
      host,
    );
    const compositionId = (comp.data as { compositionId: string }).compositionId;
    const a = await executeTool(
      "add_motion_layer",
      { compositionId, layerType: "shape", name: "A", shapeType: "rectangle", width: 200, height: 80 },
      host,
    );
    const b = await executeTool(
      "add_motion_layer",
      { compositionId, layerType: "shape", name: "B", shapeType: "ellipse", width: 200, height: 80 },
      host,
    );
    const aId = (a.data as { layerId: string }).layerId;
    const bId = (b.data as { layerId: string }).layerId;

    const cursor = await executeTool(
      "add_motion_cursor_click",
      { compositionId, targetLayerId: aId, time: 0, travel: 0.8 },
      host,
    );
    expect(cursor.ok).toBe(true);
    const cursorLayerId = (cursor.data as { cursorLayerId: string }).cursorLayerId;
    const afterCursor = (host.getProject().motionCompositions ?? []).find(
      (c) => c.id === compositionId,
    )!;
    expect(afterCursor.layers.find((l) => l.id === cursorLayerId)?.type).toBe("image");

    const morph = await executeTool(
      "morph_motion_layers",
      { compositionId, fromLayerId: aId, toLayerId: bId, time: 1, duration: 0.6 },
      host,
    );
    expect(morph.ok).toBe(true);
    const afterMorph = (host.getProject().motionCompositions ?? []).find(
      (c) => c.id === compositionId,
    )!;
    expect(
      afterMorph.layers
        .find((l) => l.id === bId)
        ?.keyframes.some((kf) => kf.property === "transform.opacity"),
    ).toBe(true);

    const dis = await executeTool(
      "disintegrate_motion_layer",
      { compositionId, layerId: bId, time: 2 },
      host,
    );
    expect(dis.ok).toBe(true);
    const particleLayerId = (dis.data as { particleLayerId: string }).particleLayerId;
    const afterDis = (host.getProject().motionCompositions ?? []).find(
      (c) => c.id === compositionId,
    )!;
    expect(afterDis.layers.find((l) => l.id === particleLayerId)?.type).toBe("particle");

    const morphSame = await executeTool(
      "morph_motion_layers",
      { compositionId, fromLayerId: aId, toLayerId: aId },
      host,
    );
    expect(morphSame.ok).toBe(false);
  });

  it("authors a graph-editor keyframe animation on an existing motion layer (hero zoom)", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const comp = await executeTool(
      "create_motion_composition",
      { name: "Toast", width: 1920, height: 1080, frameRate: 60, duration: 4 },
      host,
    );
    const compositionId = (comp.data as { compositionId: string }).compositionId;
    const layerRes = await executeTool(
      "add_motion_layer",
      { compositionId, layerType: "shape", name: "Card", shapeType: "rectangle", width: 980, height: 180 },
      host,
    );
    const layerId = (layerRes.data as { layerId: string }).layerId;

    // discover animatable properties
    const props = await executeTool(
      "list_motion_animatable_properties",
      { compositionId, layerId },
      host,
    );
    expect(props.ok).toBe(true);
    const propData = props.data as { properties: Array<{ property: string }> };
    expect(propData.properties.map((p) => p.property)).toContain("transform.scale.x");

    // hero zoom: scale 1 -> 5 -> 1 with a graph-editor bezier on the middle key
    await executeTool("add_motion_keyframe", { compositionId, layerId, property: "transform.scale.x", time: 0, value: 1, easing: "ease-out" }, host);
    const mid = await executeTool(
      "add_motion_keyframe",
      {
        compositionId,
        layerId,
        property: "transform.scale.x",
        time: 0.6,
        value: 5,
        bezierIn: { x: 0.4, y: 0 },
        bezierOut: { x: 0.6, y: 1 },
      },
      host,
    );
    expect(mid.ok).toBe(true);
    expect((mid.data as { bezier: boolean }).bezier).toBe(true);
    await executeTool("add_motion_keyframe", { compositionId, layerId, property: "transform.scale.x", time: 1.2, value: 1, easing: "ease-in" }, host);

    // the layer now actually interpolates (engine honors the authored keyframes)
    const layer = host
      .getProject()
      .motionCompositions?.find((c) => c.id === compositionId)
      ?.layers.find((l) => l.id === layerId) as MotionLayer;
    expect(getMotionLayerPropertyValueAtTime(layer, "transform.scale.x", 0)).toBeCloseTo(1, 5);
    expect(getMotionLayerPropertyValueAtTime(layer, "transform.scale.x", 0.6)).toBeCloseTo(5, 5);
    const mid03 = getMotionLayerPropertyValueAtTime(layer, "transform.scale.x", 0.3);
    expect(mid03).toBeGreaterThan(1);
    expect(mid03).toBeLessThan(5);
    const scaleKf = layer.keyframes.filter((k) => k.property === "transform.scale.x");
    expect(scaleKf).toHaveLength(3);
    const bezierKf = scaleKf.find((k) => k.bezierHandles);
    expect(bezierKf?.easing).toBe("bezier");
    expect(bezierKf?.bezierHandles?.out).toEqual({ x: 0.6, y: 1 });

    // granular ops: move + remove a single key by id
    const moveTarget = scaleKf.find((k) => k.time === 1.2)!;
    const moved = await executeTool(
      "move_motion_keyframe",
      { compositionId, layerId, keyframeId: moveTarget.id, time: 1.5 },
      host,
    );
    expect(moved.ok).toBe(true);
    const removed = await executeTool(
      "remove_motion_keyframe",
      { compositionId, layerId, keyframeId: moveTarget.id },
      host,
    );
    expect(removed.ok).toBe(true);
    const layerAfter = host
      .getProject()
      .motionCompositions?.find((c) => c.id === compositionId)
      ?.layers.find((l) => l.id === layerId) as MotionLayer;
    expect(layerAfter.keyframes.filter((k) => k.property === "transform.scale.x")).toHaveLength(2);
  });

  it("creates generic agent-native 3D scenes with semantic render bindings", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-moon-flag",
        compositionId: "comp-moon-flag",
        layerId: "layer-moon-flag",
        name: "Moon Flag Test",
        duration: 4,
        environment: "studio",
        groundShadow: true,
        insertIntoEditor: true,
        insertStartTime: 0.5,
        insertName: "Moon Flag Timeline Clip",
        camera: { posX: 0, posY: 2.4, posZ: 8, targetX: 0, targetY: 0, targetZ: 0, fov: 34 },
        objects: [
          {
            key: "moon",
            kind: "sphere",
            name: "Moon terrain",
            y: -1,
            scaleX: 5,
            scaleY: 0.32,
            scaleZ: 5,
            color: "#d1d5db",
            roughness: 0.88,
            assetKind: "environment",
            tags: ["terrain"],
          },
          {
            key: "flag",
            kind: "plane",
            name: "Ghana flag panel",
            x: 0.8,
            y: 0.4,
            z: 0.2,
            rotationY: -10,
            scaleX: 0.72,
            scaleY: 0.46,
            color: "#facc15",
            materialModel: "fabric",
            tags: ["flag", "cloth"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);
    const data = created.data as {
      sceneId: string;
      compositionId: string;
      layerId: string;
      objectIdsByKey: Record<string, string>;
      renderObjectIdsByKey: Record<string, string>;
      objectCount: number;
      insertedInstanceId?: string;
      insertedClipId?: string;
    };
    expect(data).toMatchObject({
      sceneId: "scene-moon-flag",
      compositionId: "comp-moon-flag",
      layerId: "layer-moon-flag",
      objectCount: 2,
    });
    expect(data.objectIdsByKey.flag).toBe("object-scene-moon-flag-flag");
    expect(data.renderObjectIdsByKey.flag).toBe("obj-scene-moon-flag-flag");
    expect(data.insertedInstanceId).toMatch(/^motion-instance-/);
    expect(data.insertedClipId).toBe(`motion-clip-${data.insertedInstanceId}`);

    const editorState = (await executeTool("get_editor_state", {}, host)).data as EditorStateView;
    expect(editorState.trackCount).toBe(1);
    expect(editorState.clipCount).toBe(1);
    expect(editorState.durationSec).toBe(4.5);
    expect(editorState.creation).toMatchObject({
      assetCount: 2,
      sceneCount: 1,
      activeSceneId: "scene-moon-flag",
      operationCount: 4,
    });
    expect(host.getProject().motionInstances?.[0]).toMatchObject({
      id: data.insertedInstanceId,
      compositionId: "comp-moon-flag",
      name: "Moon Flag Timeline Clip",
      startTime: 0.5,
      duration: 4,
    });
    expect(host.getProject().timeline.tracks[0]).toMatchObject({
      type: "graphics",
      name: "Motion",
    });
    expect(host.getProject().timeline.tracks[0]?.clips[0]).toMatchObject({
      id: data.insertedClipId,
      startTime: 0.5,
      duration: 4,
      metadata: {
        motionInstanceId: data.insertedInstanceId,
        motionCompositionId: "comp-moon-flag",
      },
    });

    const creationScene = host.getProject().creation?.scenes[0];
    expect(creationScene?.objects.map((object) => object.id)).toEqual([
      "object-scene-moon-flag-moon",
      "object-scene-moon-flag-flag",
    ]);
    expect(creationScene?.renderBindings[0]?.objectBindings).toEqual([
      {
        sceneObjectId: "object-scene-moon-flag-moon",
        renderObjectId: "obj-scene-moon-flag-moon",
      },
      {
        sceneObjectId: "object-scene-moon-flag-flag",
        renderObjectId: "obj-scene-moon-flag-flag",
      },
    ]);
    const composition = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === "comp-moon-flag");
    const layer = composition?.layers.find((candidate) => candidate.type === "scene3d");
    expect(layer?.type).toBe("scene3d");
    expect(layer?.objects?.map((object) => object.id)).toEqual([
      "obj-scene-moon-flag-moon",
      "obj-scene-moon-flag-flag",
    ]);

    const environmentEdited = await executeTool(
      "set_creation_scene_environment",
      {
        sceneId: data.sceneId,
        creationEnvironment: "space",
        backgroundColor: "#020617",
        groundShadow: true,
        groundColor: "#1e293b",
        renderEnvironment: "dark",
        ambient: 0.22,
        keyIntensity: 3.6,
        keyColor: "#fff7dd",
        rimIntensity: 1.1,
        room: {
          enabled: true,
          size: 18,
          wallColor: "#020617",
          floorColor: "#1e293b",
        },
        lights: [
          {
            id: "light-space-fill",
            kind: "ambient",
            name: "Space fill",
            color: "#b7c7ff",
            intensity: 0.22,
          },
          {
            id: "light-sun-key",
            kind: "directional",
            name: "Sun key",
            color: "#fff7dd",
            intensity: 3.6,
            x: 5,
            y: 8,
            z: 3,
            targetX: 0,
            targetY: 0,
            targetZ: 0,
          },
        ],
      },
      host,
    );
    expect(environmentEdited.ok).toBe(true);
    expect(host.getProject().creation?.operationHistory).toHaveLength(5);
    const environmentScene = host.getProject().creation?.scenes[0];
    expect(environmentScene?.environment).toMatchObject({
      kind: "space",
      backgroundColor: "#020617",
      groundEnabled: true,
      groundColor: "#1e293b",
    });
    expect(environmentScene?.lights.map((light) => light.id)).toEqual([
      "light-space-fill",
      "light-sun-key",
    ]);
    const environmentComposition = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === "comp-moon-flag");
    const environmentLayer = environmentComposition?.layers.find(
      (candidate) => candidate.type === "scene3d",
    );
    expect(environmentComposition?.backgroundColor).toBe("#020617");
    expect(environmentLayer?.lighting).toMatchObject({
      environment: "dark",
      groundShadow: true,
      ambient: 0.22,
      keyIntensity: 3.6,
      keyColor: "#fff7dd",
      rimIntensity: 1.1,
    });
    expect(environmentLayer?.room).toMatchObject({
      enabled: true,
      size: 18,
      wallColor: "#020617",
      floorColor: "#1e293b",
    });

    const addedObject = await executeTool(
      "add_creation_scene_object",
      {
        sceneId: data.sceneId,
        key: "pole",
        kind: "cylinder",
        name: "Flag pole",
        x: 0.62,
        y: -0.18,
        z: 0.18,
        scaleX: 0.045,
        scaleY: 1.7,
        scaleZ: 0.045,
        color: "#e5e7eb",
        metalness: 0.72,
        roughness: 0.2,
        materialModel: "metal",
        tags: ["flag", "stand"],
      },
      host,
    );
    expect(addedObject.ok).toBe(true);
    const addedObjectData = addedObject.data as {
      objectId: string;
      renderObjectId: string;
      assetId: string;
      materialId: string;
    };
    expect(addedObjectData).toMatchObject({
      objectId: "object-scene-moon-flag-pole",
      renderObjectId: "obj-scene-moon-flag-pole",
      assetId: "asset-scene-moon-flag-pole",
      materialId: "mat-scene-moon-flag-pole",
    });
    expect(host.getProject().creation?.assets).toHaveLength(3);
    expect(host.getProject().creation?.operationHistory).toHaveLength(7);
    const sceneAfterAdd = host.getProject().creation?.scenes[0];
    expect(sceneAfterAdd?.objects.map((object) => object.id)).toContain(
      addedObjectData.objectId,
    );
    expect(sceneAfterAdd?.renderBindings[0]?.objectBindings).toContainEqual({
      sceneObjectId: addedObjectData.objectId,
      renderObjectId: addedObjectData.renderObjectId,
    });
    const layerAfterAdd = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === "comp-moon-flag")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      layerAfterAdd?.objects?.some((object) => object.id === addedObjectData.renderObjectId),
    ).toBe(true);

    const geometryEdited = await executeTool(
      "set_creation_object_geometry",
      {
        objectId: addedObjectData.objectId,
        kind: "text3d",
        name: "Mission label",
        text: "AKWAABA",
        size: 0.34,
        extrude: 0.06,
        opacity: 0.88,
      },
      host,
    );
    expect(geometryEdited.ok).toBe(true);
    expect(host.getProject().creation?.operationHistory).toHaveLength(9);
    const geometryScene = host.getProject().creation?.scenes[0];
    expect(
      geometryScene?.objects.find((object) => object.id === addedObjectData.objectId)
        ?.name,
    ).toBe("Mission label");
    const geometryAsset = host
      .getProject()
      .creation?.assets.find((asset) => asset.id === addedObjectData.assetId);
    expect(geometryAsset?.parameters).toMatchObject({
      motionObjectKind: "text3d",
      text: "AKWAABA",
      extrude: 0.06,
      opacity: 0.88,
    });
    expect(geometryAsset?.caches[0]?.status).toBe("dirty");
    const geometryLayer = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === "comp-moon-flag")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    const geometryRenderObject = geometryLayer?.objects?.find(
      (object) => object.id === addedObjectData.renderObjectId,
    );
    expect(geometryRenderObject?.object).toMatchObject({
      kind: "text3d",
      text: "AKWAABA",
      size: 0.34,
      extrude: 0.06,
    });
    expect(geometryRenderObject?.opacity).toBe(0.88);

    const moved = await executeTool(
      "set_creation_object_transform",
      {
        objectId: addedObjectData.objectId,
        position: { x: 0.66, y: 0.02, z: 0.22 },
      },
      host,
    );
    expect(moved.ok).toBe(true);
    const movedLayer = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === "comp-moon-flag")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      movedLayer?.objects?.find((object) => object.id === addedObjectData.renderObjectId)
        ?.transform3d?.position,
    ).toEqual({ x: 0.66, y: 0.02, z: 0.22 });

    const animated = await executeTool(
      "animate_creation_object",
      {
        objectId: addedObjectData.objectId,
        rotation: [
          { time: 0, x: 0, y: 0, z: 0 },
          { time: 1, x: 0, y: 0, z: 8, easing: "ease-in-out" },
        ],
      },
      host,
    );
    expect(animated.ok).toBe(true);
    const animationScene = host.getProject().creation?.scenes[0];
    expect(animationScene?.animations[0]?.tracks[0]).toMatchObject({
      targetId: addedObjectData.objectId,
      channel: "rotation",
    });
    const animatedLayer = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === "comp-moon-flag")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      animatedLayer?.keyframes
        .filter(
          (keyframe) =>
            keyframe.property ===
            "scene.object.obj-scene-moon-flag-pole.rotation.z",
        )
        .map((keyframe) => keyframe.value),
    ).toEqual([0, 8]);

    const removed = await executeTool(
      "remove_creation_scene_object",
      {
        objectId: addedObjectData.objectId,
        removeAsset: true,
      },
      host,
    );
    expect(removed.ok).toBe(true);
    expect(host.getProject().creation?.operationHistory).toHaveLength(13);
    const sceneAfterRemove = host.getProject().creation?.scenes[0];
    expect(
      sceneAfterRemove?.objects.some((object) => object.id === addedObjectData.objectId),
    ).toBe(false);
    expect(
      sceneAfterRemove?.renderBindings[0]?.objectBindings.some(
        (binding) => binding.sceneObjectId === addedObjectData.objectId,
      ),
    ).toBe(false);
    expect(
      sceneAfterRemove?.animations.some((clip) =>
        clip.tracks.some((track) => track.targetId === addedObjectData.objectId),
      ),
    ).toBe(false);
    expect(
      host
        .getProject()
        .creation?.assets.some((asset) => asset.id === addedObjectData.assetId),
    ).toBe(false);
    const layerAfterRemove = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === "comp-moon-flag")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      layerAfterRemove?.objects?.some(
        (object) => object.id === addedObjectData.renderObjectId,
      ),
    ).toBe(false);
    expect(
      layerAfterRemove?.keyframes.some((keyframe) =>
        keyframe.property.startsWith(
          `scene.object.${addedObjectData.renderObjectId}.`,
        ),
      ),
    ).toBe(false);
    const validationAfterRemove = (await executeTool("validate_creation_state", {}, host))
      .data as { issues: unknown[] };
    expect(validationAfterRemove.issues).toEqual([]);
  });

  it("adds semantic product parts with role metadata and recovers render bindings", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-product-parts",
        compositionId: "comp-product-parts",
        layerId: "layer-product-parts",
        name: "Product Part Assembly",
        duration: 4,
        objects: [
          {
            key: "shell",
            partId: "shell",
            kind: "rounded-box",
            name: "Phone shell",
            x: 0,
            y: 0,
            z: 0,
            scaleX: 1.2,
            scaleY: 0.16,
            scaleZ: 0.72,
            color: "#475569",
            materialModel: "metal",
            tags: ["product-part", "shell"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const board = await executeTool(
      "add_creation_product_part",
      {
        sceneId: "scene-product-parts",
        role: "board",
        key: "logic-board",
        partId: "logic-board",
        parentKey: "shell",
        anchor: { x: 0.1, y: 0.12, z: 0.16 },
        semanticLayer: "internals",
      },
      host,
    );
    expect(board.ok).toBe(true);
    expect(board.data).toMatchObject({
      sceneId: "scene-product-parts",
      role: "board",
      objectId: "object-scene-product-parts-logic-board",
      partId: "logic-board",
      parentId: "object-scene-product-parts-shell",
      renderObjectId: "obj-scene-product-parts-logic-board",
      assetId: "asset-scene-product-parts-logic-board",
      materialId: "mat-scene-product-parts-logic-board",
      productPart: {
        source: "agent-product-part",
        role: "board",
        objectId: "object-scene-product-parts-logic-board",
        partId: "logic-board",
        parentId: "object-scene-product-parts-shell",
        calloutAnchor: { x: 0.1, y: 0.12, z: 0.16 },
        semanticLayer: "internals",
        exactness: "plausible-editable",
      },
    });

    const chip = await executeTool(
      "add_creation_product_part",
      {
        sceneId: "scene-product-parts",
        role: "chip",
        key: "processor",
        partId: "processor",
        parentKey: "logic-board",
        name: "A-series processor",
      },
      host,
    );
    expect(chip.ok).toBe(true);
    expect(chip.data).toMatchObject({
      sceneId: "scene-product-parts",
      role: "chip",
      objectId: "object-scene-product-parts-processor",
      partId: "processor",
      parentId: "object-scene-product-parts-logic-board",
      renderObjectId: "obj-scene-product-parts-processor",
      assetId: "asset-scene-product-parts-processor",
      materialId: "mat-scene-product-parts-processor",
    });

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-product-parts");
    expect(scene?.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "object-scene-product-parts-logic-board",
          parentId: "object-scene-product-parts-shell",
          partId: "logic-board",
          tags: expect.arrayContaining(["product-part", "board", "internal"]),
          transform: {
            position: { x: 0, y: 0, z: 0.04 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 0.76, y: 0.05, z: 0.42 },
          },
        }),
        expect.objectContaining({
          id: "object-scene-product-parts-processor",
          parentId: "object-scene-product-parts-logic-board",
          partId: "processor",
          tags: expect.arrayContaining(["product-part", "chip", "internal"]),
          transform: {
            position: { x: 0.24, y: 0.04, z: 0.12 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 0.22, y: 0.045, z: 0.18 },
          },
        }),
      ]),
    );
    expect(scene?.renderBindings[0]?.objectBindings).toEqual(
      expect.arrayContaining([
        {
          sceneObjectId: "object-scene-product-parts-logic-board",
          renderObjectId: "obj-scene-product-parts-logic-board",
        },
        {
          sceneObjectId: "object-scene-product-parts-processor",
          renderObjectId: "obj-scene-product-parts-processor",
        },
      ]),
    );

    const boardAsset = host
      .getProject()
      .creation?.assets.find(
        (asset) => asset.id === "asset-scene-product-parts-logic-board",
      );
    expect(boardAsset?.kind).toBe("product");
    expect(boardAsset?.parameters).toMatchObject({
      productPartRole: "board",
      productPartId: "logic-board",
      productPart: {
        role: "board",
        semanticLayer: "internals",
      },
    });
    expect(boardAsset?.nodes.some((node) => node.type === "product-part")).toBe(true);
    expect(boardAsset?.caches[0]?.status).toBe("dirty");

    const chipAsset = host
      .getProject()
      .creation?.assets.find(
        (asset) => asset.id === "asset-scene-product-parts-processor",
      );
    expect(chipAsset?.parameters.productPartRole).toBe("chip");
    expect(
      chipAsset?.materials.find(
        (material) => material.id === "mat-scene-product-parts-processor",
      ),
    ).toMatchObject({
      model: "pbr",
      baseColor: "#111827",
      emissive: "#22c55e",
    });

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-product-parts")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      layer?.objects?.find((object) => object.id === "obj-scene-product-parts-logic-board"),
    ).toMatchObject({
      object: { kind: "rounded-box", cornerRadius: 0.025 },
      material: { color: "#064e3b", roughness: 0.56 },
      transform3d: {
        position: { x: 0, y: 0, z: 0.04 },
        scale: { x: 0.76, y: 0.05, z: 0.42 },
      },
    });
    expect(
      layer?.objects?.find((object) => object.id === "obj-scene-product-parts-processor"),
    ).toMatchObject({
      object: { kind: "rounded-box", cornerRadius: 0.018 },
      material: { color: "#111827", emissive: "#22c55e" },
      transform3d: {
        position: { x: 0.24, y: 0.04, z: 0.12 },
        scale: { x: 0.22, y: 0.045, z: 0.18 },
      },
    });

    const inspected = await executeTool(
      "inspect_creation_product_parts",
      { sceneId: "scene-product-parts", partIds: ["logic-board", "processor"] },
      host,
    );
    expect(inspected.ok).toBe(true);
    const inspectedParts = (inspected.data as {
      parts: Array<{ partId?: string; recipeFeatures: { productPartRole?: string } }>;
    }).parts;
    expect(
      inspectedParts.find((part) => part.partId === "logic-board")?.recipeFeatures
        .productPartRole,
    ).toBe("board");
    expect(
      inspectedParts.find((part) => part.partId === "processor")?.recipeFeatures
        .productPartRole,
    ).toBe("chip");

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-product-parts" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recovered = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-product-parts")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      recovered?.objects?.find(
        (object) => object.id === "obj-scene-product-parts-processor",
      ),
    ).toMatchObject({
      object: { kind: "rounded-box", cornerRadius: 0.018 },
      material: { color: "#111827", emissive: "#22c55e" },
    });
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("adds editable product screen stacks and recovers layered render bindings", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-screen-stack",
        compositionId: "comp-screen-stack",
        layerId: "layer-screen-stack",
        name: "Screen Stack Product",
        duration: 4,
        objects: [
          {
            key: "shell",
            partId: "shell",
            kind: "rounded-box",
            name: "Phone body",
            x: 0,
            y: 0,
            z: 0,
            scaleX: 1.12,
            scaleY: 0.14,
            scaleZ: 0.68,
            color: "#334155",
            materialModel: "metal",
            tags: ["product-part", "shell"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const stack = await executeTool(
      "add_creation_screen_stack",
      {
        sceneId: "scene-screen-stack",
        key: "display-stack",
        stackId: "display-stack",
        targetPartId: "shell",
        width: 0.92,
        height: 0.52,
        offset: 0.08,
        spacing: 0.03,
        normalZ: 1,
        mapAssetId: "asset-display-ui-map",
      },
      host,
    );
    expect(stack.ok).toBe(true);
    expect(stack.data).toMatchObject({
      sceneId: "scene-screen-stack",
      stackId: "display-stack",
      objectIds: [
        "object-scene-screen-stack-display-stack-cover-glass",
        "object-scene-screen-stack-display-stack-oled",
        "object-scene-screen-stack-display-stack-digitizer",
        "object-scene-screen-stack-display-stack-backplate",
      ],
      renderObjectIds: [
        "obj-scene-screen-stack-display-stack-cover-glass",
        "obj-scene-screen-stack-display-stack-oled",
        "obj-scene-screen-stack-display-stack-digitizer",
        "obj-scene-screen-stack-display-stack-backplate",
      ],
      objectIdsByLayerKey: {
        "cover-glass": "object-scene-screen-stack-display-stack-cover-glass",
        oled: "object-scene-screen-stack-display-stack-oled",
        digitizer: "object-scene-screen-stack-display-stack-digitizer",
        backplate: "object-scene-screen-stack-display-stack-backplate",
      },
      partIdsByLayerKey: {
        "cover-glass": "display-stack-cover-glass",
        oled: "display-stack-oled",
        digitizer: "display-stack-digitizer",
        backplate: "display-stack-backplate",
      },
      targetObjectIds: ["object-scene-screen-stack-shell"],
      targetPartIds: ["shell"],
      parentId: "object-scene-screen-stack-shell",
      normal: { x: 0, y: 0, z: 1 },
      offset: 0.08,
      width: 0.92,
      height: 0.52,
      spacing: 0.03,
    });

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-screen-stack");
    expect(scene?.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "object-scene-screen-stack-display-stack-cover-glass",
          parentId: "object-scene-screen-stack-shell",
          partId: "display-stack-cover-glass",
          tags: expect.arrayContaining([
            "product-part",
            "screen",
            "screen-stack",
            "cover-glass",
            "display-cover",
          ]),
          transform: {
            position: { x: 0, y: 0, z: 0.08 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 0.92, y: 0.52, z: 0.012 },
          },
        }),
        expect.objectContaining({
          id: "object-scene-screen-stack-display-stack-oled",
          parentId: "object-scene-screen-stack-shell",
          partId: "display-stack-oled",
          tags: expect.arrayContaining(["screen-stack", "oled", "display-emissive"]),
          transform: {
            position: { x: 0, y: 0, z: 0.05 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 0.9016000000000001, y: 0.5096, z: 0.018 },
          },
        }),
      ]),
    );
    expect(scene?.renderBindings[0]?.objectBindings).toEqual(
      expect.arrayContaining([
        {
          sceneObjectId: "object-scene-screen-stack-display-stack-cover-glass",
          renderObjectId: "obj-scene-screen-stack-display-stack-cover-glass",
        },
        {
          sceneObjectId: "object-scene-screen-stack-display-stack-oled",
          renderObjectId: "obj-scene-screen-stack-display-stack-oled",
        },
      ]),
    );

    const oledAsset = host
      .getProject()
      .creation?.assets.find(
        (asset) => asset.id === "asset-scene-screen-stack-display-stack-oled",
      );
    expect(oledAsset?.kind).toBe("product");
    expect(oledAsset?.parameters).toMatchObject({
      productPartRole: "screen",
      productPartId: "display-stack-oled",
      screenStackId: "display-stack",
      screenStackLayerKey: "oled",
      screenStack: {
        source: "agent-screen-stack",
        stackId: "display-stack",
        layerKey: "oled",
        layerIndex: 1,
        layerCount: 4,
        targetObjectIds: ["object-scene-screen-stack-shell"],
        targetPartIds: ["shell"],
        width: 0.92,
        height: 0.52,
        spacing: 0.03,
        localZ: -0.03,
        mapAssetId: "asset-display-ui-map",
      },
    });
    expect(oledAsset?.nodes.some((node) => node.type === "product-part")).toBe(true);
    expect(oledAsset?.nodes.some((node) => node.type === "array")).toBe(true);
    expect(oledAsset?.caches[0]?.status).toBe("dirty");

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-screen-stack")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      layer?.objects?.find((object) => object.id === "obj-scene-screen-stack-display-stack-oled"),
    ).toMatchObject({
      object: { kind: "rounded-box", depth: 0.018, cornerRadius: 0.03 },
      material: {
        color: "#020617",
        roughness: 0.16,
        emissive: "#38bdf8",
        emissiveIntensity: 0.78,
        mapAssetId: "asset-display-ui-map",
      },
      opacity: 0.96,
      transform3d: {
        position: { x: 0, y: 0, z: 0.05 },
        scale: { x: 0.9016000000000001, y: 0.5096, z: 0.018 },
      },
    });

    const inspected = await executeTool(
      "inspect_creation_product_parts",
      { sceneId: "scene-screen-stack", partIds: ["display-stack-oled"] },
      host,
    );
    expect(inspected.ok).toBe(true);
    const inspectedPart = (inspected.data as {
      parts: Array<{
        recipeFeatures: {
          productPartRole?: string;
          screenStack?: unknown;
          screenStackLayerKey?: string;
        };
      }>;
    }).parts[0];
    expect(inspectedPart.recipeFeatures.productPartRole).toBe("screen");
    expect(inspectedPart.recipeFeatures.screenStack).toBeTruthy();
    expect(inspectedPart.recipeFeatures.screenStackLayerKey).toBe("oled");

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-screen-stack" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredLayer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-screen-stack")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      recoveredLayer?.objects?.find(
        (object) => object.id === "obj-scene-screen-stack-display-stack-oled",
      ),
    ).toMatchObject({
      object: { kind: "rounded-box", depth: 0.018, cornerRadius: 0.03 },
      material: { color: "#020617", emissive: "#38bdf8" },
      opacity: 0.96,
    });
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("adds editable product camera modules and recovers component render bindings", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-camera-module",
        compositionId: "comp-camera-module",
        layerId: "layer-camera-module",
        name: "Camera Module Product",
        duration: 4,
        objects: [
          {
            key: "shell",
            partId: "shell",
            kind: "rounded-box",
            name: "Phone back shell",
            x: 0,
            y: 0,
            z: 0,
            scaleX: 1.15,
            scaleY: 0.16,
            scaleZ: 0.7,
            color: "#475569",
            materialModel: "metal",
            tags: ["product-part", "shell"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const module = await executeTool(
      "add_creation_camera_module",
      {
        sceneId: "scene-camera-module",
        key: "camera-island",
        moduleId: "camera-island",
        targetPartId: "shell",
        width: 0.5,
        height: 0.38,
        depth: 0.08,
        lensCount: 2,
        offset: 0.12,
        normalZ: 1,
        includeDepthSensor: true,
      },
      host,
    );
    expect(module.ok).toBe(true);
    expect(module.data).toMatchObject({
      sceneId: "scene-camera-module",
      moduleId: "camera-island",
      objectIdsByComponentKey: {
        island: "object-scene-camera-module-camera-island-island",
        "lens-1-ring": "object-scene-camera-module-camera-island-lens-1-ring",
        "lens-1-glass": "object-scene-camera-module-camera-island-lens-1-glass",
        "lens-1-sensor": "object-scene-camera-module-camera-island-lens-1-sensor",
        "lens-2-ring": "object-scene-camera-module-camera-island-lens-2-ring",
        "lens-2-glass": "object-scene-camera-module-camera-island-lens-2-glass",
        "lens-2-sensor": "object-scene-camera-module-camera-island-lens-2-sensor",
        flash: "object-scene-camera-module-camera-island-flash",
        "depth-sensor": "object-scene-camera-module-camera-island-depth-sensor",
      },
      partIdsByComponentKey: {
        island: "camera-island-island",
        "lens-1-ring": "camera-island-lens-1-ring",
        "lens-1-glass": "camera-island-lens-1-glass",
        "lens-1-sensor": "camera-island-lens-1-sensor",
        "lens-2-ring": "camera-island-lens-2-ring",
        "lens-2-glass": "camera-island-lens-2-glass",
        "lens-2-sensor": "camera-island-lens-2-sensor",
        flash: "camera-island-flash",
        "depth-sensor": "camera-island-depth-sensor",
      },
      targetObjectIds: ["object-scene-camera-module-shell"],
      targetPartIds: ["shell"],
      parentId: "object-scene-camera-module-shell",
      normal: { x: 0, y: 0, z: 1 },
      offset: 0.12,
      width: 0.5,
      height: 0.38,
      depth: 0.08,
      lensCount: 2,
    });

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-camera-module");
    expect(scene?.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "object-scene-camera-module-camera-island-island",
          parentId: "object-scene-camera-module-shell",
          partId: "camera-island-island",
          tags: expect.arrayContaining([
            "product-part",
            "camera-module",
            "island",
            "camera-housing",
          ]),
          transform: {
            position: { x: 0, y: 0, z: 0.12 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 0.5, y: 0.38, z: 0.08 },
          },
        }),
        expect.objectContaining({
          id: "object-scene-camera-module-camera-island-lens-1-glass",
          parentId: "object-scene-camera-module-shell",
          partId: "camera-island-lens-1-glass",
          tags: expect.arrayContaining([
            "camera-module",
            "lens-1-glass",
            "camera-lens-glass",
          ]),
          transform: {
            position: { x: -0.1, y: 0.0608, z: 0.1784 },
            rotation: { x: 90, y: 0, z: 0 },
            scale: { x: 0.1216, y: 0.044000000000000004, z: 0.1216 },
          },
        }),
        expect.objectContaining({
          id: "object-scene-camera-module-camera-island-depth-sensor",
          partId: "camera-island-depth-sensor",
          tags: expect.arrayContaining(["camera-depth-sensor", "depth-sensor"]),
        }),
      ]),
    );
    expect(scene?.renderBindings[0]?.objectBindings).toEqual(
      expect.arrayContaining([
        {
          sceneObjectId: "object-scene-camera-module-camera-island-island",
          renderObjectId: "obj-scene-camera-module-camera-island-island",
        },
        {
          sceneObjectId: "object-scene-camera-module-camera-island-lens-1-glass",
          renderObjectId: "obj-scene-camera-module-camera-island-lens-1-glass",
        },
      ]),
    );

    const lensAsset = host
      .getProject()
      .creation?.assets.find(
        (asset) => asset.id === "asset-scene-camera-module-camera-island-lens-1-glass",
      );
    expect(lensAsset?.kind).toBe("product");
    expect(lensAsset?.parameters).toMatchObject({
      productPartRole: "lens",
      productPartId: "camera-island-lens-1-glass",
      cameraModuleId: "camera-island",
      cameraModuleComponentKey: "lens-1-glass",
      cameraModule: {
        source: "agent-camera-module",
        moduleId: "camera-island",
        componentKey: "lens-1-glass",
        componentRole: "lens",
        componentIndex: 2,
        lensIndex: 1,
        lensCount: 2,
        targetObjectIds: ["object-scene-camera-module-shell"],
        targetPartIds: ["shell"],
        width: 0.5,
        height: 0.38,
        depth: 0.08,
        localX: -0.1,
        localY: 0.0608,
        localZ: 0.058399999999999994,
      },
    });
    expect(lensAsset?.nodes.some((node) => node.type === "product-part")).toBe(true);
    expect(lensAsset?.nodes.some((node) => node.type === "array")).toBe(true);
    expect(lensAsset?.caches[0]?.status).toBe("dirty");

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-camera-module")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      layer?.objects?.find(
        (object) => object.id === "obj-scene-camera-module-camera-island-lens-1-glass",
      ),
    ).toMatchObject({
      object: { kind: "cylinder", depth: 0.1216 },
      material: {
        color: "#020617",
        roughness: 0.05,
        emissive: "#1e293b",
        emissiveIntensity: 0.18,
      },
      opacity: 0.86,
      transform3d: {
        position: { x: -0.1, y: 0.0608, z: 0.1784 },
        rotation: { x: 90, y: 0, z: 0 },
      },
    });

    const inspected = await executeTool(
      "inspect_creation_product_parts",
      { sceneId: "scene-camera-module", partIds: ["camera-island-lens-1-glass"] },
      host,
    );
    expect(inspected.ok).toBe(true);
    const inspectedPart = (inspected.data as {
      parts: Array<{
        recipeFeatures: {
          productPartRole?: string;
          cameraModule?: unknown;
          cameraModuleComponentKey?: string;
        };
      }>;
    }).parts[0];
    expect(inspectedPart.recipeFeatures.productPartRole).toBe("lens");
    expect(inspectedPart.recipeFeatures.cameraModule).toBeTruthy();
    expect(inspectedPart.recipeFeatures.cameraModuleComponentKey).toBe("lens-1-glass");

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-camera-module" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredLayer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-camera-module")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      recoveredLayer?.objects?.find(
        (object) => object.id === "obj-scene-camera-module-camera-island-lens-1-glass",
      ),
    ).toMatchObject({
      object: { kind: "cylinder", depth: 0.1216 },
      material: { color: "#020617", emissive: "#1e293b" },
      opacity: 0.86,
    });
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("builds an editable humanoid character and syncs every part into the bound scene3d layer", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-character",
        compositionId: "comp-character",
        layerId: "layer-character",
        name: "Character Scene",
        duration: 6,
        objects: [
          {
            key: "ground",
            partId: "ground",
            kind: "plane",
            name: "Ground",
            x: 0,
            y: 0,
            z: 0,
            scaleX: 8,
            scaleY: 8,
            scaleZ: 1,
            color: "#1e293b",
            tags: ["ground"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const character = await executeTool(
      "add_creation_character",
      {
        sceneId: "scene-character",
        characterId: "hero",
        style: "astronaut",
        x: 0,
        y: 0,
        z: 0,
      },
      host,
    );
    expect(character.ok).toBe(true);
    expect(character.data).toMatchObject({
      sceneId: "scene-character",
      characterId: "hero",
      style: "astronaut",
      partCount: 19,
      objectIdsByPartKey: {
        pelvis: "object-scene-character-hero-pelvis",
        head: "object-scene-character-hero-head",
        helmet: "object-scene-character-hero-helmet",
        visor: "object-scene-character-hero-visor",
        backpack: "object-scene-character-hero-backpack",
        "arm-right-upper": "object-scene-character-hero-arm-right-upper",
        "arm-right-forearm": "object-scene-character-hero-arm-right-forearm",
        "foot-left": "object-scene-character-hero-foot-left",
      },
      bonesByPartKey: {
        "arm-right-upper": "upperarm.R",
        "foot-left": "foot.L",
      },
    });

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-character");
    expect(scene?.objects).toHaveLength(20);
    const head = scene?.objects.find(
      (object) => object.id === "object-scene-character-hero-head",
    );
    expect(head?.tags).toEqual(expect.arrayContaining(["character", "hero", "head", "astronaut"]));

    const headAsset = host
      .getProject()
      .creation?.assets.find(
        (asset) => asset.id === "asset-scene-character-hero-head",
      );
    expect(headAsset?.kind).toBe("character");
    expect(headAsset?.parameters).toMatchObject({
      characterId: "hero",
      characterStyle: "astronaut",
      characterPartRole: "head",
    });
    expect(headAsset?.nodes.some((node) => node.type === "skeleton")).toBe(true);

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-character")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      layer?.objects?.some(
        (object) => object.id === "obj-scene-character-hero-arm-right-upper",
      ),
    ).toBe(true);
    expect(scene?.renderBindings[0]?.objectBindings).toEqual(
      expect.arrayContaining([
        {
          sceneObjectId: "object-scene-character-hero-visor",
          renderObjectId: "obj-scene-character-hero-visor",
        },
      ]),
    );

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("poses a creation character with a wave gesture and recovers the animation", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-wave",
        compositionId: "comp-wave",
        layerId: "layer-wave",
        name: "Wave Scene",
        duration: 6,
        objects: [
          {
            key: "ground",
            partId: "ground",
            kind: "plane",
            name: "Ground",
            scaleX: 8,
            scaleY: 8,
            color: "#0f172a",
            tags: ["ground"],
          },
        ],
      },
      host,
    );
    await executeTool(
      "add_creation_character",
      { sceneId: "scene-wave", characterId: "astro", style: "astronaut" },
      host,
    );

    const posed = await executeTool(
      "pose_creation_character",
      { sceneId: "scene-wave", characterId: "astro", pose: "wave", side: "right" },
      host,
    );
    expect(posed.ok).toBe(true);
    expect(posed.data).toMatchObject({
      sceneId: "scene-wave",
      characterId: "astro",
      pose: "wave",
      side: "right",
      clipId: "anim-astro-wave",
      channels: ["rotation"],
    });
    const posedData = posed.data as {
      objectIds: string[];
      syncedRenderObjectIds: string[];
      renderKeyframeCount: number;
    };
    expect(posedData.objectIds).toEqual(
      expect.arrayContaining([
        "object-scene-wave-astro-arm-right-upper",
        "object-scene-wave-astro-arm-right-forearm",
      ]),
    );
    expect(posedData.renderKeyframeCount).toBeGreaterThan(0);

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-wave");
    const clip = scene?.animations.find((candidate) => candidate.id === "anim-astro-wave");
    expect(clip?.tracks.some((track) => track.channel === "rotation")).toBe(true);
    expect(
      clip?.tracks.some(
        (track) => track.targetId === "object-scene-wave-astro-arm-right-upper",
      ),
    ).toBe(true);

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-wave")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      layer?.keyframes?.some(
        (keyframe) =>
          keyframe.property ===
          "scene.object.obj-scene-wave-astro-arm-right-upper.rotation.z",
      ),
    ).toBe(true);

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({ ...projectWithoutComposition, motionCompositions: [] });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-wave" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredLayer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-wave")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      recoveredLayer?.keyframes?.some(
        (keyframe) =>
          keyframe.property ===
          "scene.object.obj-scene-wave-astro-arm-right-upper.rotation.z",
      ),
    ).toBe(true);

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("adds a deterministic particle system with editable twinkle animation and recovers it", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-stars",
        compositionId: "comp-stars",
        layerId: "layer-stars",
        name: "Starfield Scene",
        duration: 4,
        environment: "space",
        objects: [
          {
            key: "ground",
            partId: "ground",
            kind: "plane",
            name: "Ground",
            scaleX: 8,
            scaleY: 8,
            color: "#020617",
            tags: ["ground"],
          },
        ],
      },
      host,
    );

    const particles = await executeTool(
      "add_creation_particle_system",
      {
        sceneId: "scene-stars",
        particleSystemId: "stars",
        kind: "stars",
        count: 24,
        seed: "fixed-seed",
        shape: "box",
      },
      host,
    );
    expect(particles.ok).toBe(true);
    expect(particles.data).toMatchObject({
      sceneId: "scene-stars",
      particleSystemId: "stars",
      kind: "stars",
      count: 24,
      animated: true,
      clipId: "anim-stars",
      assetId: "asset-scene-stars-stars",
    });
    const particleData = particles.data as { objectIds: string[]; renderObjectIds: string[] };
    expect(particleData.objectIds).toHaveLength(24);
    expect(particleData.renderObjectIds).toHaveLength(24);

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-stars");
    expect(scene?.objects).toHaveLength(25);
    const clip = scene?.animations.find((candidate) => candidate.id === "anim-stars");
    expect(clip?.tracks.some((track) => track.channel === "opacity")).toBe(true);

    const particleAsset = host
      .getProject()
      .creation?.assets.find((asset) => asset.id === "asset-scene-stars-stars");
    expect(particleAsset?.parameters).toMatchObject({
      particleSystemId: "stars",
      particleSystem: { source: "agent-particle-system", kind: "stars", count: 24 },
    });
    expect(particleAsset?.nodes.some((node) => node.type === "scatter")).toBe(true);

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-stars")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(layer?.objects?.filter((object) => object.id.startsWith("obj-scene-stars-stars"))).toHaveLength(24);
    expect(
      layer?.keyframes?.some((keyframe) => keyframe.property.endsWith(".opacity")),
    ).toBe(true);

    const determinismHost = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-stars",
        compositionId: "comp-stars",
        layerId: "layer-stars",
        name: "Starfield Scene",
        duration: 4,
        objects: [{ key: "ground", kind: "plane", name: "Ground", color: "#020617" }],
      },
      determinismHost,
    );
    await executeTool(
      "add_creation_particle_system",
      { sceneId: "scene-stars", particleSystemId: "stars", kind: "stars", count: 24, seed: "fixed-seed", shape: "box" },
      determinismHost,
    );
    const firstParticle = host
      .getProject()
      .creation?.scenes.find((s) => s.id === "scene-stars")
      ?.objects.find((object) => object.id === "object-scene-stars-stars-1");
    const determinismParticle = determinismHost
      .getProject()
      .creation?.scenes.find((s) => s.id === "scene-stars")
      ?.objects.find((object) => object.id === "object-scene-stars-stars-1");
    expect(determinismParticle?.transform).toEqual(firstParticle?.transform);

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({ ...projectWithoutComposition, motionCompositions: [] });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-stars" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredLayer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-stars")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      recoveredLayer?.keyframes?.some((keyframe) => keyframe.property.endsWith(".opacity")),
    ).toBe(true);

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("duplicates a creation object into an independent recolored variant and recovers it", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-variant",
        compositionId: "comp-variant",
        layerId: "layer-variant",
        name: "Variant Scene",
        duration: 4,
        objects: [
          {
            key: "phone",
            partId: "phone",
            kind: "rounded-box",
            name: "Phone shell",
            x: 0,
            y: 0,
            z: 0,
            scaleX: 0.8,
            scaleY: 1.6,
            scaleZ: 0.1,
            color: "#94a3b8",
            materialModel: "metal",
            tags: ["product-part", "shell"],
          },
        ],
      },
      host,
    );

    const variant = await executeTool(
      "duplicate_creation_object",
      {
        sceneId: "scene-variant",
        sourcePartId: "phone",
        key: "phone-black",
        name: "Phone shell black",
        offsetX: 1.2,
        color: "#0b1120",
        roughness: 0.2,
      },
      host,
    );
    expect(variant.ok).toBe(true);
    expect(variant.data).toMatchObject({
      sceneId: "scene-variant",
      sourceObjectId: "object-scene-variant-phone",
      objectId: "object-scene-variant-phone-black",
      assetId: "asset-scene-variant-phone-black",
      materialId: "mat-scene-variant-phone-black",
      position: { x: 1.2, y: 0, z: 0 },
    });

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-variant");
    expect(scene?.objects).toHaveLength(2);
    const variantObject = scene?.objects.find(
      (object) => object.id === "object-scene-variant-phone-black",
    );
    expect(variantObject?.assetId).toBe("asset-scene-variant-phone-black");
    expect(variantObject?.tags).toEqual(expect.arrayContaining(["variant", "shell"]));

    const variantAsset = host
      .getProject()
      .creation?.assets.find((asset) => asset.id === "asset-scene-variant-phone-black");
    expect(variantAsset?.parameters).toMatchObject({
      variantOf: "asset-scene-variant-phone",
      variantSourceObjectId: "object-scene-variant-phone",
    });
    expect(
      variantAsset?.materials.find((material) => material.id === "mat-scene-variant-phone-black")
        ?.baseColor,
    ).toBe("#0b1120");

    const layerObject = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-variant")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-variant-phone-black");
    expect(layerObject).toMatchObject({
      object: { kind: "rounded-box" },
      material: { color: "#0b1120" },
      transform3d: { position: { x: 1.2, y: 0, z: 0 } },
    });

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({ ...projectWithoutComposition, motionCompositions: [] });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-variant" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recovered = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-variant")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-variant-phone-black");
    expect(recovered).toMatchObject({ material: { color: "#0b1120" } });

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("bakes a rigid-body drop simulation onto creation objects and recovers it", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-drop",
        compositionId: "comp-drop",
        layerId: "layer-drop",
        name: "Drop Scene",
        duration: 4,
        objects: [
          {
            key: "cube-a",
            partId: "cube-a",
            kind: "rounded-box",
            name: "Cube A",
            x: -0.5,
            y: 0,
            z: 0,
            scaleX: 0.4,
            scaleY: 0.4,
            scaleZ: 0.4,
            color: "#f59e0b",
            tags: ["drop-target"],
          },
          {
            key: "cube-b",
            partId: "cube-b",
            kind: "rounded-box",
            name: "Cube B",
            x: 0.5,
            y: 0,
            z: 0,
            scaleX: 0.4,
            scaleY: 0.4,
            scaleZ: 0.4,
            color: "#3b82f6",
            tags: ["drop-target"],
          },
        ],
      },
      host,
    );

    const dropped = await executeTool(
      "simulate_creation_rigid_drop",
      {
        sceneId: "scene-drop",
        tags: ["drop-target"],
        dropHeight: 2,
        bounces: 2,
        restitution: 0.4,
        stagger: 0.1,
      },
      host,
    );
    expect(dropped.ok).toBe(true);
    expect(dropped.data).toMatchObject({
      sceneId: "scene-drop",
      clipId: "anim-scene-drop-rigid-drop",
      channels: ["position"],
      dropHeight: 2,
      bounces: 2,
      restitution: 0.4,
    });
    const dropData = dropped.data as { objectIds: string[]; renderKeyframeCount: number };
    expect(dropData.objectIds).toEqual(
      expect.arrayContaining(["object-scene-drop-cube-a", "object-scene-drop-cube-b"]),
    );
    expect(dropData.renderKeyframeCount).toBeGreaterThan(0);

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-drop");
    const clip = scene?.animations.find((candidate) => candidate.id === "anim-scene-drop-rigid-drop");
    const cubeATrack = clip?.tracks.find(
      (track) => track.targetId === "object-scene-drop-cube-a",
    );
    expect(cubeATrack?.channel).toBe("position");
    const lastKeyframe = cubeATrack?.keyframes[cubeATrack.keyframes.length - 1];
    expect((lastKeyframe?.value as { y: number }).y).toBeCloseTo(0, 5);
    const firstKeyframe = cubeATrack?.keyframes[0];
    expect((firstKeyframe?.value as { y: number }).y).toBeCloseTo(2, 5);

    const dropAsset = host
      .getProject()
      .creation?.assets.find((asset) => asset.id === "asset-scene-drop-cube-a");
    expect(dropAsset?.parameters.rigidDrop).toMatchObject({
      source: "agent-rigid-drop",
      gravity: 9.8,
      bounces: 2,
    });
    expect(dropAsset?.nodes.some((node) => node.type === "bake")).toBe(true);

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-drop")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      layer?.keyframes?.some(
        (keyframe) =>
          keyframe.property === "scene.object.obj-scene-drop-cube-a.position.y",
      ),
    ).toBe(true);

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({ ...projectWithoutComposition, motionCompositions: [] });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-drop" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredLayer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-drop")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      recoveredLayer?.keyframes?.some(
        (keyframe) =>
          keyframe.property === "scene.object.obj-scene-drop-cube-a.position.y",
      ),
    ).toBe(true);

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("applies an editable procedural texture to a creation object and syncs the preview", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-texture",
        compositionId: "comp-texture",
        layerId: "layer-texture",
        name: "Texture Scene",
        duration: 4,
        objects: [
          {
            key: "chip",
            partId: "chip",
            kind: "rounded-box",
            name: "Chip",
            scaleX: 0.4,
            scaleY: 0.4,
            scaleZ: 0.05,
            color: "#111827",
            materialModel: "pbr",
            tags: ["chip"],
          },
        ],
      },
      host,
    );

    const textured = await executeTool(
      "add_creation_procedural_texture",
      { sceneId: "scene-texture", partIds: ["chip"], pattern: "circuit" },
      host,
    );
    expect(textured.ok).toBe(true);
    expect(textured.data).toMatchObject({
      sceneId: "scene-texture",
      pattern: "circuit",
      objectIds: ["object-scene-texture-chip"],
    });

    const asset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-texture-chip");
    const material = asset?.materials.find((candidate) => candidate.id === "mat-scene-texture-chip");
    expect(material?.baseColor).toBe("#064e3b");
    expect(material?.textureCacheId).toBe("texture-mat-scene-texture-chip-circuit");
    expect((material?.parameters?.proceduralTexture as { pattern?: string })?.pattern).toBe("circuit");
    expect(asset?.nodes.some((node) => node.type === "material" && node.name.includes("circuit"))).toBe(true);

    const layerObject = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-texture")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-texture-chip");
    expect(layerObject?.material).toMatchObject({ color: "#064e3b", emissive: "#22c55e" });

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({ ...projectWithoutComposition, motionCompositions: [] });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-texture" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recovered = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-texture")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-texture-chip");
    expect(recovered?.material).toMatchObject({ color: "#064e3b" });

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("bakes a creation asset recipe into a real mesh cache with stats and glTF", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-bake",
        compositionId: "comp-bake",
        layerId: "layer-bake",
        name: "Bake Scene",
        duration: 4,
        objects: [
          {
            key: "ball",
            partId: "ball",
            objectId: "object-scene-bake-ball",
            assetId: "asset-scene-bake-ball",
            kind: "sphere",
            name: "Ball",
            size: 2,
            color: "#ef4444",
            tags: ["prop"],
          },
        ],
      },
      host,
    );

    const baked = await executeTool(
      "bake_creation_asset",
      { assetId: "asset-scene-bake-ball", quality: "preview", includeGltf: true },
      host,
    );
    expect(baked.ok).toBe(true);
    expect(baked.data).toMatchObject({
      assetId: "asset-scene-bake-ball",
      kind: "sphere",
      quality: "preview",
      placeholder: false,
      cacheStatus: "ready",
    });
    const bakeData = baked.data as {
      vertexCount: number;
      triangleCount: number;
      gltf?: { buffers: Array<{ uri: string }> };
    };
    expect(bakeData.vertexCount).toBeGreaterThan(0);
    expect(bakeData.triangleCount).toBeGreaterThan(0);
    expect(bakeData.gltf?.buffers[0]?.uri.startsWith("data:application/octet-stream;base64,")).toBe(
      true,
    );

    const asset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-bake-ball");
    const cache = asset?.caches.find((candidate) => candidate.kind === "preview-mesh");
    expect(cache?.status).toBe("ready");
    expect(cache?.bounds).toBeTruthy();
    expect(asset?.parameters.bakedMesh).toMatchObject({ kind: "sphere", placeholder: false });

    const welded = await executeTool(
      "bake_creation_asset",
      { assetId: "asset-scene-bake-ball", quality: "preview", weld: true, smoothNormals: true },
      host,
    );
    expect(welded.ok).toBe(true);
    expect((welded.data as { vertexCount: number }).vertexCount).toBeLessThan(bakeData.vertexCount);

    const objectBake = await executeTool(
      "bake_creation_asset",
      { sceneId: "scene-bake", partId: "ball", quality: "final" },
      host,
    );
    expect(objectBake.ok).toBe(true);
    const finalAsset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-bake-ball");
    expect(finalAsset?.caches.some((candidate) => candidate.kind === "final-mesh")).toBe(true);

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);

    const exported = await executeTool(
      "export_creation_scene_gltf",
      { sceneId: "scene-bake", quality: "preview" },
      host,
    );
    expect(exported.ok).toBe(true);
    const exportData = exported.data as {
      vertexCount: number;
      triangleCount: number;
      objectCount: number;
      gltf?: { asset: { version: string }; buffers: Array<{ uri: string }> };
    };
    expect(exportData.objectCount).toBeGreaterThan(0);
    expect(exportData.vertexCount).toBeGreaterThan(0);
    expect(exportData.gltf?.asset.version).toBe("2.0");
    expect(exportData.gltf?.buffers[0]?.uri.startsWith("data:application/octet-stream;base64,")).toBe(
      true,
    );

    const glbExport = await executeTool(
      "export_creation_scene_gltf",
      { sceneId: "scene-bake", format: "glb" },
      host,
    );
    expect(glbExport.ok).toBe(true);
    const glbData = glbExport.data as { format: string; glbBase64?: string; gltf?: unknown };
    expect(glbData.format).toBe("glb");
    expect(typeof glbData.glbBase64).toBe("string");
    expect((glbData.glbBase64 ?? "").length).toBeGreaterThan(0);
    expect(glbData.gltf).toBeUndefined();

    const rendered = await executeTool(
      "render_creation_scene_image",
      { sceneId: "scene-bake", width: 48, height: 48, includePng: true },
      host,
    );
    expect(rendered.ok).toBe(true);
    const renderData = rendered.data as { coveredPixels: number; dataUri?: string };
    expect(renderData.coveredPixels).toBeGreaterThan(0);
    expect(renderData.dataUri?.startsWith("data:image/png;base64,")).toBe(true);

    const rayTraced = await executeTool(
      "render_creation_scene_image",
      { sceneId: "scene-bake", width: 48, height: 48, mode: "raytrace", includePng: false },
      host,
    );
    expect(rayTraced.ok).toBe(true);
    const rayData = rayTraced.data as { mode: string; coveredPixels: number };
    expect(rayData.mode).toBe("raytrace");
    expect(rayData.coveredPixels).toBeGreaterThan(0);

    const auto = await executeTool(
      "render_creation_scene_image",
      { sceneId: "scene-bake", width: 48, height: 48, mode: "auto", includePng: false },
      host,
    );
    expect(auto.ok).toBe(true);
    const autoData = auto.data as { mode: string; backend: string; coveredPixels: number };
    expect(autoData.mode).toBe("auto");
    expect(autoData.backend).toBe("cpu");
    expect(autoData.coveredPixels).toBeGreaterThan(0);
  });

  it("renders multi-object creation scene PNGs with per-object material colors", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-render-colors",
        compositionId: "comp-render-colors",
        layerId: "layer-render-colors",
        name: "Render Colors",
        duration: 3,
        backgroundColor: "#020617",
        camera: {
          position: { x: 0, y: 1.4, z: 5 },
          target: { x: 0, y: 0, z: 0 },
          fov: 42,
        },
        objects: [
          {
            key: "red-cube",
            kind: "box",
            name: "Red cube",
            x: -0.9,
            y: 0,
            z: 0,
            scaleX: 0.8,
            scaleY: 0.8,
            scaleZ: 0.8,
            color: "#ef4444",
          },
          {
            key: "green-cube",
            kind: "box",
            name: "Green cube",
            x: 0.9,
            y: 0,
            z: 0,
            scaleX: 0.8,
            scaleY: 0.8,
            scaleZ: 0.8,
            color: "#22c55e",
          },
        ],
      },
      host,
    );

    const rendered = await executeTool(
      "render_creation_scene_image",
      {
        sceneId: "scene-render-colors",
        width: 96,
        height: 64,
        background: "#020617",
        includePng: true,
      },
      host,
    );
    expect(rendered.ok).toBe(true);
    const renderData = rendered.data as { dataUri?: string };
    expect(renderData.dataUri).toBeTruthy();
    const image = decodePngDataUri(renderData.dataUri!);
    let redPixels = 0;
    let greenPixels = 0;
    for (let i = 0; i < image.rgba.length; i += 4) {
      const r = image.rgba[i] ?? 0;
      const g = image.rgba[i + 1] ?? 0;
      const b = image.rgba[i + 2] ?? 0;
      if (r > 35 && r > g * 1.35 && r > b * 1.35) redPixels += 1;
      if (g > 35 && g > r * 1.25 && g > b * 1.25) greenPixels += 1;
    }
    expect(redPixels).toBeGreaterThan(0);
    expect(greenPixels).toBeGreaterThan(0);
  });

  it("renders semantic creation animation at the requested CPU preview time", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-render-animation",
        compositionId: "comp-render-animation",
        layerId: "layer-render-animation",
        name: "Render Animation",
        duration: 3,
        backgroundColor: "#020617",
        camera: {
          position: { x: 0, y: 1.5, z: 5 },
          target: { x: 0, y: 0, z: 0 },
          fov: 42,
        },
        objects: [
          {
            key: "red-cube",
            objectId: "object-render-animation-red-cube",
            kind: "box",
            name: "Red cube",
            x: -1.1,
            y: 0,
            z: 0,
            color: "#ef4444",
          },
        ],
      },
      host,
    );
    const animated = await executeTool(
      "animate_creation_object",
      {
        sceneId: "scene-render-animation",
        objectId: "object-render-animation-red-cube",
        duration: 2,
        position: [
          { time: 0, x: -1.1, y: 0, z: 0, easing: "linear" },
          { time: 2, x: 1.1, y: 0, z: 0, easing: "linear" },
        ],
      },
      host,
    );
    expect(animated.ok).toBe(true);
    expect(animated.data).toMatchObject({
      syncedCompositionId: "comp-render-animation",
      syncedLayerId: "layer-render-animation",
    });

    const startFrame = await executeTool(
      "render_creation_scene_image",
      {
        sceneId: "scene-render-animation",
        width: 96,
        height: 64,
        timeSeconds: 0,
        includePng: true,
      },
      host,
    );
    const endFrame = await executeTool(
      "render_creation_scene_image",
      {
        sceneId: "scene-render-animation",
        width: 96,
        height: 64,
        timeSeconds: 2,
        includePng: true,
      },
      host,
    );

    expect(startFrame.ok).toBe(true);
    expect(endFrame.ok).toBe(true);
    const startData = startFrame.data as { dataUri?: string; timeSeconds: number };
    const endData = endFrame.data as { dataUri?: string; timeSeconds: number };
    expect(startData.timeSeconds).toBe(0);
    expect(endData.timeSeconds).toBe(2);
    expect(startData.dataUri).toBeTruthy();
    expect(endData.dataUri).toBeTruthy();
    expect(startData.dataUri).not.toBe(endData.dataUri);
  });

  it("binds GLB model animation clips to editable creation scene objects", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-model-animation",
        compositionId: "comp-model-animation",
        layerId: "layer-model-animation",
        name: "Animated Model Scene",
        duration: 4,
        objects: [
          {
            key: "astronaut",
            objectId: "object-model-animation-astronaut",
            kind: "model",
            name: "Rigged astronaut",
            modelUrl: "file:///models/astronaut.glb",
            animationClipName: "Idle",
            animationTimeOffset: 0.25,
            animationPlaybackRate: 1,
            animationLoop: true,
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);
    const createdData = created.data as {
      renderObjectIdsByKey: Record<string, string>;
    };
    const renderObjectId = createdData.renderObjectIdsByKey.astronaut;
    expect(renderObjectId).toBeTruthy();

    const initialLayer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-model-animation")
      ?.layers.find((layer) => layer.id === "layer-model-animation");
    expect(initialLayer?.type).toBe("scene3d");
    const initialObject =
      initialLayer?.type === "scene3d"
        ? initialLayer.objects?.find((object) => object.id === renderObjectId)
        : undefined;
    expect(initialObject?.object.animation).toMatchObject({
      clipName: "Idle",
      timeOffset: 0.25,
      playbackRate: 1,
      loop: true,
    });

    const updated = await executeTool(
      "set_model_animation",
      {
        compositionId: "comp-model-animation",
        layerId: "layer-model-animation",
        objectId: renderObjectId,
        clipName: "Wave",
        timeOffset: 0.5,
        playbackRate: 0.75,
        loop: false,
      },
      host,
    );
    expect(updated.ok).toBe(true);
    expect(updated.data).toMatchObject({
      compositionId: "comp-model-animation",
      layerId: "layer-model-animation",
      objectId: renderObjectId,
      animation: {
        clipName: "Wave",
        timeOffset: 0.5,
        playbackRate: 0.75,
        loop: false,
      },
      syncedCreationObjectId: "object-model-animation-astronaut",
    });

    const updatedLayer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-model-animation")
      ?.layers.find((layer) => layer.id === "layer-model-animation");
    const updatedObject =
      updatedLayer?.type === "scene3d"
        ? updatedLayer.objects?.find((object) => object.id === renderObjectId)
        : undefined;
    expect(updatedObject?.object.animation).toMatchObject({
      clipName: "Wave",
      timeOffset: 0.5,
      playbackRate: 0.75,
      loop: false,
    });

    const asset = host
      .getProject()
      .creation?.assets.find((candidate) =>
        candidate.parameters.modelUrl === "file:///models/astronaut.glb",
      );
    expect(asset?.parameters.animation).toMatchObject({
      clipName: "Wave",
      timeOffset: 0.5,
      playbackRate: 0.75,
      loop: false,
    });
  });

  it("inspects GLB models resolved from editable creation scene objects", async () => {
    const host = new HeadlessHost(makeEmptyProject()) as HeadlessHost & {
      inspectModel: NonNullable<import("./host").EditingHost["inspectModel"]>;
    };
    const inspected: Array<{ modelUrl: string; name?: string; source?: string }> = [];
    host.inspectModel = async (request) => {
      inspected.push(request);
      return {
        modelUrl: request.modelUrl,
        name: request.name,
        source: request.source,
        meshCount: 1,
        materialCount: 2,
        textureCount: 1,
        animationCount: 2,
        vertexCount: 2400,
        triangleCount: 1600,
        bounds: {
          min: { x: -1, y: 0, z: -1 },
          max: { x: 1, y: 2, z: 1 },
          size: { x: 2, y: 2, z: 2 },
          center: { x: 0, y: 1, z: 0 },
        },
        meshes: [
          {
            name: "Astronaut suit",
            vertexCount: 2400,
            triangleCount: 1600,
            skinned: true,
            materialNames: ["Suit", "Visor"],
          },
        ],
        materials: [],
        textures: [],
        animations: [
          { name: "Idle", duration: 1.2, trackCount: 10, targetCount: 4, tracks: [] },
          { name: "Wave", duration: 2.1, trackCount: 18, targetCount: 7, tracks: [] },
        ],
        armature: {
          hasSkinnedMesh: true,
          skinnedMeshCount: 1,
          boneCount: 38,
          rootBones: ["Hips"],
          sampleBones: ["Hips", "Spine", "Head", "Hand.R"],
        },
        warnings: [],
        suggestedNextTools: ["set_model_animation", "retarget_animation_clip"],
      };
    };

    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-inspect-model",
        compositionId: "comp-inspect-model",
        layerId: "layer-inspect-model",
        name: "Inspectable Model Scene",
        objects: [
          {
            key: "astronaut",
            objectId: "object-inspect-astronaut",
            kind: "model",
            name: "Inspectable astronaut",
            modelUrl: "file:///models/astronaut.glb",
          },
        ],
      },
      host,
    );

    const result = await executeTool(
      "inspect_3d_model",
      {
        sceneId: "scene-inspect-model",
        creationObjectId: "object-inspect-astronaut",
      },
      host,
    );

    expect(result.ok).toBe(true);
    expect(inspected).toEqual([
      {
        modelUrl: "file:///models/astronaut.glb",
        name: "Inspectable astronaut",
        source: "creation-scene-object",
      },
    ]);
    expect(result.data).toMatchObject({
      available: true,
      source: "creation-scene-object",
      sceneId: "scene-inspect-model",
      creationObjectId: "object-inspect-astronaut",
      meshCount: 1,
      animationCount: 2,
      armature: {
        hasSkinnedMesh: true,
        boneCount: 38,
      },
    });
  });

  it("runs humanoid rigging for GLB models resolved from editable creation scenes", async () => {
    const host = new HeadlessHost(makeEmptyProject()) as HeadlessHost & {
      rigHumanoidModel: NonNullable<import("./host").EditingHost["rigHumanoidModel"]>;
    };
    const rigged: Array<{ modelUrl: string; name?: string; outputPath?: string }> = [];
    host.rigHumanoidModel = async (request) => {
      rigged.push({
        modelUrl: request.modelUrl,
        name: request.name,
        outputPath: request.outputPath,
      });
      return {
        ok: true,
        provider: "blender",
        inputUrl: request.modelUrl,
        outputPath: request.outputPath ?? "/tmp/astronaut-rigged.glb",
        outputUrl: "file:///tmp/astronaut-rigged.glb",
        armatureName: "Inspectable astronaut Armature",
        createdArmature: true,
        preservedExistingArmature: false,
        skinnedMeshCount: 1,
        meshCount: 1,
        boneCount: 16,
        warnings: [],
      };
    };

    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-rig-model",
        compositionId: "comp-rig-model",
        layerId: "layer-rig-model",
        name: "Rig Model Scene",
        objects: [
          {
            key: "astronaut",
            objectId: "object-rig-astronaut",
            kind: "model",
            name: "Rig me astronaut",
            modelUrl: "file:///models/astronaut.glb",
          },
        ],
      },
      host,
    );

    const result = await executeTool(
      "rig_humanoid_model",
      {
        sceneId: "scene-rig-model",
        creationObjectId: "object-rig-astronaut",
        outputPath: "/tmp/astronaut-rigged.glb",
      },
      host,
    );

    expect(result.ok).toBe(true);
    expect(rigged).toEqual([
      {
        modelUrl: "file:///models/astronaut.glb",
        name: "Rig me astronaut",
        outputPath: "/tmp/astronaut-rigged.glb",
      },
    ]);
    expect(result.data).toMatchObject({
      ok: true,
      source: "creation-scene-object",
      sceneId: "scene-rig-model",
      creationObjectId: "object-rig-astronaut",
      outputUrl: "file:///tmp/astronaut-rigged.glb",
      createdArmature: true,
      boneCount: 16,
    });
  });

  it("bakes a procedural texture for a material into a real image and average color", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-tex",
        compositionId: "comp-tex",
        layerId: "layer-tex",
        name: "Texture Bake Scene",
        duration: 4,
        objects: [
          {
            key: "chip",
            partId: "chip",
            objectId: "object-scene-tex-chip",
            assetId: "asset-scene-tex-chip",
            materialId: "mat-scene-tex-chip",
            kind: "rounded-box",
            name: "Chip",
            scaleX: 0.4,
            scaleY: 0.4,
            scaleZ: 0.05,
            color: "#111827",
            materialModel: "pbr",
            tags: ["chip"],
          },
        ],
      },
      host,
    );
    await executeTool(
      "add_creation_procedural_texture",
      { sceneId: "scene-tex", partIds: ["chip"], pattern: "circuit" },
      host,
    );

    const baked = await executeTool(
      "bake_creation_texture",
      { sceneId: "scene-tex", partId: "chip", size: 32, includePng: true },
      host,
    );
    expect(baked.ok).toBe(true);
    const bakeData = baked.data as {
      pattern: string;
      averageColor: string;
      textureCacheId: string;
      syncedRenderObjectId?: string;
      dataUri?: string;
    };
    expect(bakeData.pattern).toBe("circuit");
    expect(bakeData.averageColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(bakeData.textureCacheId).toBe("texture-mat-scene-tex-chip-circuit");
    expect(bakeData.syncedRenderObjectId).toBe("obj-scene-tex-chip");
    expect(bakeData.dataUri?.startsWith("data:image/png;base64,")).toBe(true);

    const asset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-tex-chip");
    const material = asset?.materials.find((candidate) => candidate.id === "mat-scene-tex-chip");
    expect(material?.textureCacheId).toBe("texture-mat-scene-tex-chip-circuit");
    expect(material?.baseColor).toBe(bakeData.averageColor);
    expect(asset?.caches.some((cache) => cache.kind === "texture-atlas" && cache.status === "ready")).toBe(
      true,
    );

    const layerObject = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-tex")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((o) => o.id === "obj-scene-tex-chip");
    expect(layerObject?.material?.color).toBe(bakeData.averageColor);

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("adds editable product internals and recovers component render bindings", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-product-internals",
        compositionId: "comp-product-internals",
        layerId: "layer-product-internals",
        name: "Product Internals",
        duration: 4,
        objects: [
          {
            key: "shell",
            partId: "shell",
            kind: "rounded-box",
            name: "Open phone shell",
            x: 0,
            y: 0,
            z: 0,
            scaleX: 1.15,
            scaleY: 0.16,
            scaleZ: 0.72,
            color: "#475569",
            materialModel: "metal",
            tags: ["product-part", "shell"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const internals = await executeTool(
      "add_creation_product_internals",
      {
        sceneId: "scene-product-internals",
        key: "phone-internals",
        layoutId: "phone-internals",
        targetPartId: "shell",
        width: 0.9,
        height: 0.55,
        depth: 0.08,
        offset: 0.09,
        normalZ: 1,
        chipCount: 2,
        connectorCount: 2,
        screwCount: 4,
      },
      host,
    );
    expect(internals.ok).toBe(true);
    expect(internals.data).toMatchObject({
      sceneId: "scene-product-internals",
      layoutId: "phone-internals",
      objectIdsByComponentKey: {
        "thermal-layer": "object-scene-product-internals-phone-internals-thermal-layer",
        "logic-board": "object-scene-product-internals-phone-internals-logic-board",
        "battery-pack": "object-scene-product-internals-phone-internals-battery-pack",
        "chip-1": "object-scene-product-internals-phone-internals-chip-1",
        "chip-2": "object-scene-product-internals-phone-internals-chip-2",
        "connector-1": "object-scene-product-internals-phone-internals-connector-1",
        "connector-2": "object-scene-product-internals-phone-internals-connector-2",
        "screw-1": "object-scene-product-internals-phone-internals-screw-1",
        "screw-2": "object-scene-product-internals-phone-internals-screw-2",
        "screw-3": "object-scene-product-internals-phone-internals-screw-3",
        "screw-4": "object-scene-product-internals-phone-internals-screw-4",
      },
      partIdsByComponentKey: {
        "logic-board": "phone-internals-logic-board",
        "battery-pack": "phone-internals-battery-pack",
        "chip-1": "phone-internals-chip-1",
        "connector-1": "phone-internals-connector-1",
        "screw-1": "phone-internals-screw-1",
      },
      targetObjectIds: ["object-scene-product-internals-shell"],
      targetPartIds: ["shell"],
      parentId: "object-scene-product-internals-shell",
      normal: { x: 0, y: 0, z: 1 },
      offset: 0.09,
      width: 0.9,
      height: 0.55,
      depth: 0.08,
    });

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-product-internals");
    expect(scene?.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "object-scene-product-internals-phone-internals-logic-board",
          parentId: "object-scene-product-internals-shell",
          partId: "phone-internals-logic-board",
          tags: expect.arrayContaining([
            "product-part",
            "product-internals",
            "logic-board",
            "internal-board",
          ]),
          transform: {
            position: { x: 0.162, y: 0.022000000000000002, z: 0.118 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 0.396, y: 0.275, z: 0.024 },
          },
        }),
        expect.objectContaining({
          id: "object-scene-product-internals-phone-internals-battery-pack",
          parentId: "object-scene-product-internals-shell",
          partId: "phone-internals-battery-pack",
          tags: expect.arrayContaining(["battery-pack", "internal-power"]),
          transform: {
            position: { x: -0.198, y: -0.022000000000000002, z: 0.1164 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 0.342, y: 0.341, z: 0.0256 },
          },
        }),
        expect.objectContaining({
          id: "object-scene-product-internals-phone-internals-chip-1",
          parentId: "object-scene-product-internals-shell",
          partId: "phone-internals-chip-1",
          tags: expect.arrayContaining(["chip-1", "internal-chip", "processor"]),
          transform: {
            position: { x: 0.11052000000000001, y: 0.022000000000000002, z: 0.1444 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 0.07128, y: 0.0495, z: 0.0144 },
          },
        }),
        expect.objectContaining({
          id: "object-scene-product-internals-phone-internals-screw-1",
          partId: "phone-internals-screw-1",
          tags: expect.arrayContaining(["screw-1", "internal-fastener"]),
          transform: {
            position: { x: -0.342, y: 0.18700000000000003, z: 0.1396 },
            rotation: { x: 90, y: 0, z: 0 },
            scale: { x: 0.03150000000000001, y: 0.0128, z: 0.03150000000000001 },
          },
        }),
      ]),
    );
    expect(scene?.renderBindings[0]?.objectBindings).toEqual(
      expect.arrayContaining([
        {
          sceneObjectId: "object-scene-product-internals-phone-internals-logic-board",
          renderObjectId: "obj-scene-product-internals-phone-internals-logic-board",
        },
        {
          sceneObjectId: "object-scene-product-internals-phone-internals-chip-1",
          renderObjectId: "obj-scene-product-internals-phone-internals-chip-1",
        },
      ]),
    );

    const chipAsset = host
      .getProject()
      .creation?.assets.find(
        (asset) => asset.id === "asset-scene-product-internals-phone-internals-chip-1",
      );
    expect(chipAsset?.kind).toBe("product");
    expect(chipAsset?.parameters).toMatchObject({
      productPartRole: "chip",
      productPartId: "phone-internals-chip-1",
      productInternalsId: "phone-internals",
      productInternalsComponentKey: "chip-1",
      productInternals: {
        source: "agent-product-internals",
        layoutId: "phone-internals",
        componentKey: "chip-1",
        componentRole: "chip",
        componentIndex: 3,
        targetObjectIds: ["object-scene-product-internals-shell"],
        targetPartIds: ["shell"],
        width: 0.9,
        height: 0.55,
        depth: 0.08,
        localX: 0.11052000000000001,
        localY: 0.022000000000000002,
        localZ: 0.054400000000000004,
      },
    });
    expect(chipAsset?.nodes.some((node) => node.type === "product-part")).toBe(true);
    expect(chipAsset?.nodes.some((node) => node.type === "array")).toBe(true);
    expect(chipAsset?.caches[0]?.status).toBe("dirty");

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-product-internals")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      layer?.objects?.find(
        (object) => object.id === "obj-scene-product-internals-phone-internals-chip-1",
      ),
    ).toMatchObject({
      object: { kind: "rounded-box", depth: 0.0144, cornerRadius: 0.012 },
      material: {
        color: "#111827",
        roughness: 0.38,
        emissive: "#22c55e",
        emissiveIntensity: 0.16,
      },
      transform3d: {
        position: { x: 0.11052000000000001, y: 0.022000000000000002, z: 0.1444 },
        scale: { x: 0.07128, y: 0.0495, z: 0.0144 },
      },
    });

    const inspected = await executeTool(
      "inspect_creation_product_parts",
      { sceneId: "scene-product-internals", partIds: ["phone-internals-chip-1"] },
      host,
    );
    expect(inspected.ok).toBe(true);
    const inspectedPart = (inspected.data as {
      parts: Array<{
        recipeFeatures: {
          productPartRole?: string;
          productInternals?: unknown;
          productInternalsComponentKey?: string;
        };
      }>;
    }).parts[0];
    expect(inspectedPart.recipeFeatures.productPartRole).toBe("chip");
    expect(inspectedPart.recipeFeatures.productInternals).toBeTruthy();
    expect(inspectedPart.recipeFeatures.productInternalsComponentKey).toBe("chip-1");

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-product-internals" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredLayer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-product-internals")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      recoveredLayer?.objects?.find(
        (object) => object.id === "obj-scene-product-internals-phone-internals-chip-1",
      ),
    ).toMatchObject({
      object: { kind: "rounded-box", depth: 0.0144, cornerRadius: 0.012 },
      material: { color: "#111827", emissive: "#22c55e" },
    });
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("adds semantic light sweeps with recoverable animation keyframes", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-light-sweep",
        compositionId: "comp-light-sweep",
        layerId: "layer-light-sweep",
        name: "Light Sweep Product",
        duration: 4,
        objects: [
          {
            key: "shell",
            partId: "shell",
            kind: "rounded-box",
            name: "Titanium shell",
            x: 0,
            y: 0,
            z: 0,
            scaleX: 1.2,
            scaleY: 0.16,
            scaleZ: 0.72,
            color: "#94a3b8",
            materialModel: "metal",
            tags: ["product-part", "shell"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const sweep = await executeTool(
      "add_creation_light_sweep",
      {
        sceneId: "scene-light-sweep",
        key: "hero-sweep",
        partId: "hero-sweep",
        targetPartId: "shell",
        sweepWidth: 0.11,
        sweepHeight: 0.86,
        travelDistance: 1.4,
        offset: 0.12,
        normalZ: 1,
        startTime: 0.4,
        duration: 1.2,
        fadeDuration: 0.2,
        maxOpacity: 0.62,
        color: "#f8fafc",
        emissiveIntensity: 1.6,
      },
      host,
    );
    expect(sweep.ok).toBe(true);
    expect(sweep.data).toMatchObject({
      sceneId: "scene-light-sweep",
      objectId: "object-scene-light-sweep-hero-sweep",
      partId: "hero-sweep",
      renderObjectId: "obj-scene-light-sweep-hero-sweep",
      assetId: "asset-scene-light-sweep-hero-sweep",
      materialId: "mat-scene-light-sweep-hero-sweep",
      clipId: "anim-object-scene-light-sweep-hero-sweep-light-sweep",
      trackIds: [
        "anim-object-scene-light-sweep-hero-sweep-light-sweep-object-scene-light-sweep-hero-sweep-light-sweep-position",
        "anim-object-scene-light-sweep-hero-sweep-light-sweep-object-scene-light-sweep-hero-sweep-light-sweep-opacity",
      ],
      targetObjectIds: ["object-scene-light-sweep-shell"],
      targetPartIds: ["shell"],
      parentId: "object-scene-light-sweep-shell",
      normal: { x: 0, y: 0, z: 1 },
      startPosition: { x: -0.7, y: 0, z: 0.12 },
      endPosition: { x: 0.7, y: 0, z: 0.12 },
      width: 0.11,
      height: 0.86,
      travelDistance: 1.4,
      maxOpacity: 0.62,
    });

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-light-sweep");
    const sweepObject = scene?.objects.find(
      (object) => object.id === "object-scene-light-sweep-hero-sweep",
    );
    expect(sweepObject).toMatchObject({
      parentId: "object-scene-light-sweep-shell",
      partId: "hero-sweep",
      tags: expect.arrayContaining([
        "light-sweep",
        "highlight-sweep",
        "cinematic-polish",
      ]),
      transform: {
        position: { x: -0.7, y: 0, z: 0.12 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 0.11, y: 0.86, z: 1 },
      },
    });
    const clip = scene?.animations.find(
      (candidate) => candidate.id === "anim-object-scene-light-sweep-hero-sweep-light-sweep",
    );
    expect(clip).toMatchObject({
      name: "Light sweep",
      duration: 4,
      tracks: [
        expect.objectContaining({
          channel: "position",
          targetId: "object-scene-light-sweep-hero-sweep",
          keyframes: [
            {
              time: 0.4,
              value: { x: -0.7, y: 0, z: 0.12 },
              easing: "ease-in-out",
            },
            {
              time: 1.6,
              value: { x: 0.7, y: 0, z: 0.12 },
              easing: "ease-in-out",
            },
          ],
        }),
        expect.objectContaining({
          channel: "opacity",
          targetId: "object-scene-light-sweep-hero-sweep",
        }),
      ],
    });

    const asset = host
      .getProject()
      .creation?.assets.find(
        (candidate) => candidate.id === "asset-scene-light-sweep-hero-sweep",
      );
    expect(asset?.parameters).toMatchObject({
      lightSweep: {
        source: "agent-light-sweep",
        clipId: "anim-object-scene-light-sweep-hero-sweep-light-sweep",
        targetObjectIds: ["object-scene-light-sweep-shell"],
        targetPartIds: ["shell"],
        normal: { x: 0, y: 0, z: 1 },
        startPosition: { x: -0.7, y: 0, z: 0.12 },
        endPosition: { x: 0.7, y: 0, z: 0.12 },
        width: 0.11,
        height: 0.86,
        travelDistance: 1.4,
        maxOpacity: 0.62,
        startTime: 0.4,
        endTime: 1.6,
        fadeDuration: 0.2,
        color: "#f8fafc",
      },
    });
    expect(asset?.nodes.some((node) => node.type === "decal")).toBe(true);
    expect(asset?.caches[0]?.status).toBe("dirty");

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-light-sweep")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      layer?.objects?.find((object) => object.id === "obj-scene-light-sweep-hero-sweep"),
    ).toMatchObject({
      object: { kind: "plane" },
      material: {
        kind: "basic",
        color: "#f8fafc",
        emissive: "#f8fafc",
        emissiveIntensity: 1.6,
      },
      opacity: 0,
      transform3d: {
        position: { x: -0.7, y: 0, z: 0.12 },
        scale: { x: 0.11, y: 0.86, z: 1 },
      },
    });
    expect(layer?.keyframes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: "scene.object.obj-scene-light-sweep-hero-sweep.position.x",
          time: 0.4,
          value: -0.7,
        }),
        expect.objectContaining({
          property: "scene.object.obj-scene-light-sweep-hero-sweep.position.x",
          time: 1.6,
          value: 0.7,
        }),
        expect.objectContaining({
          property: "scene.object.obj-scene-light-sweep-hero-sweep.opacity",
          time: 0.6000000000000001,
          value: 0.62,
        }),
      ]),
    );

    const inspected = await executeTool(
      "inspect_creation_product_parts",
      { sceneId: "scene-light-sweep", partIds: ["hero-sweep"], includeAllObjects: true },
      host,
    );
    expect(inspected.ok).toBe(true);
    const inspectedPart = (inspected.data as {
      parts: Array<{ recipeFeatures: { lightSweep?: unknown } }>;
    }).parts[0];
    expect(inspectedPart.recipeFeatures.lightSweep).toBeTruthy();

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-light-sweep" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredLayer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-light-sweep")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      recoveredLayer?.objects?.find(
        (object) => object.id === "obj-scene-light-sweep-hero-sweep",
      ),
    ).toMatchObject({
      object: { kind: "plane" },
      material: { color: "#f8fafc", emissive: "#f8fafc" },
      opacity: 0,
    });
    expect(recoveredLayer?.keyframes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: "scene.object.obj-scene-light-sweep-hero-sweep.position.x",
          time: 1.6,
          value: 0.7,
        }),
        expect.objectContaining({
          property: "scene.object.obj-scene-light-sweep-hero-sweep.opacity",
          time: 1.6,
          value: 0,
        }),
      ]),
    );
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("applies procedural cloth wave metadata and recoverable flag keyframes", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-flag-wave",
        compositionId: "comp-flag-wave",
        layerId: "layer-flag-wave",
        name: "Flag Wave Scene",
        duration: 2,
        objects: [
          {
            key: "flag",
            kind: "plane",
            name: "Ghana flag cloth",
            x: 0.4,
            y: 0.5,
            z: 0,
            scaleX: 0.9,
            scaleY: 0.55,
            color: "#facc15",
            materialModel: "fabric",
            tags: ["flag", "cloth"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const waved = await executeTool(
      "apply_creation_cloth_wave",
      {
        sceneId: "scene-flag-wave",
        objectId: "object-scene-flag-wave-flag",
        duration: 2,
        cycles: 1,
        samples: 5,
        amplitudeDegrees: 6,
        axis: "y",
        pinnedEdge: "left",
        windStrength: 0.8,
      },
      host,
    );
    expect(waved.ok).toBe(true);
    expect(waved.data).toMatchObject({
      sceneId: "scene-flag-wave",
      objectId: "object-scene-flag-wave-flag",
      assetId: "asset-scene-flag-wave-flag",
      sampleCount: 5,
      syncedRenderObjectId: "obj-scene-flag-wave-flag",
    });
    expect(host.getProject().creation?.operationHistory).toHaveLength(5);
    const flagAsset = host
      .getProject()
      .creation?.assets.find((asset) => asset.id === "asset-scene-flag-wave-flag");
    expect(flagAsset?.parameters).toMatchObject({
      clothWave: {
        source: "agent-procedural-cloth-wave",
        pinnedEdge: "left",
        windStrength: 0.8,
        amplitudeDegrees: 6,
        axis: "y",
      },
    });
    expect(flagAsset?.nodes.some((node) => node.type === "cloth")).toBe(true);
    expect(flagAsset?.caches[0]?.status).toBe("dirty");

    const flagScene = host
      .getProject()
      .creation?.scenes.find((scene) => scene.id === "scene-flag-wave");
    const clip = flagScene?.animations.find(
      (animation) => animation.id === "anim-object-scene-flag-wave-flag-cloth-wave",
    );
    expect(clip?.tracks[0]).toMatchObject({
      targetId: "object-scene-flag-wave-flag",
      channel: "rotation",
    });
    expect(clip?.tracks[0]?.keyframes).toHaveLength(5);
    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-flag-wave")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    const waveValues = layer?.keyframes
      .filter(
        (keyframe) =>
          keyframe.property === "scene.object.obj-scene-flag-wave-flag.rotation.y",
      )
      .map((keyframe) => keyframe.value as number);
    expect(waveValues).toHaveLength(5);
    expect(waveValues?.[0]).toBeCloseTo(0, 5);
    expect(waveValues?.[1]).toBeCloseTo(6, 5);
    expect(waveValues?.[3]).toBeCloseTo(-6, 5);

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-flag-wave" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredLayer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-flag-wave")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      recoveredLayer?.keyframes.filter(
        (keyframe) =>
          keyframe.property === "scene.object.obj-scene-flag-wave-flag.rotation.y",
      ),
    ).toHaveLength(5);
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("creates semantic 3D scenes from nested object and camera transforms", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-nested-transforms",
        compositionId: "comp-nested-transforms",
        layerId: "layer-nested-transforms",
        name: "Nested Transform Scene",
        duration: 3,
        objects: [
          {
            key: "flag",
            kind: "rounded-box",
            name: "Nested flag",
            position: { x: 0.7, y: 0.45, z: 0.1 },
            rotation: { x: 0.1, y: 0.2, z: 0.3 },
            scale: { x: 0.9, y: 0.5, z: 0.04 },
            color: "#facc15",
            materialModel: "fabric",
          },
        ],
        camera: {
          position: { x: 2.4, y: 1.4, z: 5.4 },
          target: { x: -0.2, y: 0.25, z: 0 },
          fov: 34,
        },
      },
      host,
    );
    expect(created.ok).toBe(true);

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-nested-transforms");
    expect(scene?.objects[0]?.transform).toMatchObject({
      position: { x: 0.7, y: 0.45, z: 0.1 },
      rotation: { x: 0.1, y: 0.2, z: 0.3 },
      scale: { x: 0.9, y: 0.5, z: 0.04 },
    });
    expect(scene?.cameras[0]).toMatchObject({
      position: { x: 2.4, y: 1.4, z: 5.4 },
      target: { x: -0.2, y: 0.25, z: 0 },
      fov: 34,
    });

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-nested-transforms")
      ?.layers.find((candidate) => candidate.id === "layer-nested-transforms");
    expect(layer?.type).toBe("scene3d");
    if (layer?.type !== "scene3d") throw new Error("Expected scene3d layer");
    expect(layer.objects?.[0]?.transform3d).toMatchObject({
      position: { x: 0.7, y: 0.45, z: 0.1 },
      rotation: { x: 0.1, y: 0.2, z: 0.3 },
      scale: { x: 0.9, y: 0.5, z: 0.04 },
    });
    expect(layer.camera).toMatchObject({
      position: { x: 2.4, y: 1.4, z: 5.4 },
      target: { x: -0.2, y: 0.25, z: 0 },
      fov: 34,
    });
  });

  it("creates semantic exploded-view motion and recovers render keyframes", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-exploded-edit",
        compositionId: "comp-exploded-edit",
        layerId: "layer-exploded-edit",
        name: "Editable Exploded View",
        duration: 3,
        objects: [
          {
            key: "shell",
            partId: "shell",
            kind: "rounded-box",
            name: "Outer shell",
            x: -0.35,
            y: 0,
            z: 0,
            scaleX: 1.2,
            scaleY: 0.08,
            scaleZ: 0.7,
            color: "#94a3b8",
            materialModel: "metal",
            tags: ["product-part", "shell"],
          },
          {
            key: "chip",
            partId: "chip",
            kind: "box",
            name: "Logic board",
            x: 0.35,
            y: 0,
            z: 0,
            scaleX: 0.7,
            scaleY: 0.06,
            scaleZ: 0.42,
            color: "#111827",
            materialModel: "pbr",
            tags: ["product-part", "chip"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const exploded = await executeTool(
      "animate_creation_exploded_view",
      {
        sceneId: "scene-exploded-edit",
        partIds: ["shell", "chip"],
        axis: "z",
        distance: 1.2,
        spacing: 0.2,
        startTime: 0.2,
        duration: 0.8,
        stagger: 0.1,
        returnToAssembled: true,
        holdTime: 0.2,
        returnDuration: 0.5,
      },
      host,
    );
    expect(exploded.ok).toBe(true);
    expect(exploded.data).toMatchObject({
      sceneId: "scene-exploded-edit",
      clipId: "anim-scene-exploded-edit-exploded-view",
      objectIds: [
        "object-scene-exploded-edit-shell",
        "object-scene-exploded-edit-chip",
      ],
      assetIds: [
        "asset-scene-exploded-edit-shell",
        "asset-scene-exploded-edit-chip",
      ],
      axis: "z",
      distance: 1.2,
      spacing: 0.2,
      syncedRenderObjectIds: [
        "obj-scene-exploded-edit-shell",
        "obj-scene-exploded-edit-chip",
      ],
      renderKeyframeCount: 24,
    });
    expect(host.getProject().creation?.operationHistory).toHaveLength(7);

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-exploded-edit");
    const clip = scene?.animations.find(
      (candidate) => candidate.id === "anim-scene-exploded-edit-exploded-view",
    );
    expect(clip?.tracks.map((track) => track.targetId)).toEqual([
      "object-scene-exploded-edit-shell",
      "object-scene-exploded-edit-chip",
    ]);
    expect(clip?.tracks.every((track) => track.channel === "position")).toBe(true);
    expect(clip?.tracks[0]?.keyframes).toHaveLength(4);
    expect(clip?.duration).toBe(3);

    const shellAsset = host
      .getProject()
      .creation?.assets.find((asset) => asset.id === "asset-scene-exploded-edit-shell");
    expect(shellAsset?.parameters).toMatchObject({
      explodedView: {
        source: "agent-exploded-view",
        clipId: "anim-scene-exploded-edit-exploded-view",
        axis: "z",
        distance: 1.2,
        spacing: 0.2,
        returnToAssembled: true,
      },
      explodedViewByObject: {
        "object-scene-exploded-edit-shell": {
          explodedPosition: { x: -0.35, y: 0, z: 1.2 },
        },
      },
    });
    expect(shellAsset?.nodes.some((node) => node.type === "deform")).toBe(true);
    expect(shellAsset?.caches[0]?.status).toBe("dirty");

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-exploded-edit")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    const shellZ = layer?.keyframes.filter(
      (keyframe) =>
        keyframe.property === "scene.object.obj-scene-exploded-edit-shell.position.z",
    );
    expect(shellZ?.map((keyframe) => keyframe.value)).toEqual([0, 1.2, 1.2, 0]);
    expect(shellZ?.map((keyframe) => keyframe.time)).toEqual([0.2, 1, 1.2, 1.7]);
    const chipZ = layer?.keyframes.filter(
      (keyframe) =>
        keyframe.property === "scene.object.obj-scene-exploded-edit-chip.position.z",
    );
    expect(chipZ?.map((keyframe) => keyframe.value)).toEqual([0, 1.4, 1.4, 0]);
    expect(chipZ?.[0]?.time).toBeCloseTo(0.3, 5);
    expect(chipZ?.[1]?.time).toBeCloseTo(1.1, 5);
    expect(chipZ?.[2]?.time).toBeCloseTo(1.3, 5);
    expect(chipZ?.[3]?.time).toBeCloseTo(1.8, 5);

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-exploded-edit" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredLayer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-exploded-edit")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      recoveredLayer?.keyframes
        .filter(
          (keyframe) =>
            keyframe.property ===
            "scene.object.obj-scene-exploded-edit-shell.position.z",
        )
        .map((keyframe) => keyframe.value),
    ).toEqual([0, 1.2, 1.2, 0]);
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("applies semantic material presets and syncs bound scene3d materials", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-material-preset",
        compositionId: "comp-material-preset",
        layerId: "layer-material-preset",
        name: "Material Preset Scene",
        objects: [
          {
            key: "chip",
            kind: "rounded-box",
            name: "Logic chip",
            color: "#334155",
            materialModel: "plastic",
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const applied = await executeTool(
      "apply_creation_material_preset",
      {
        sceneId: "scene-material-preset",
        objectId: "object-scene-material-preset-chip",
        presetId: "silicon-chip",
        wear: 0.15,
        scratches: 0.2,
      },
      host,
    );
    expect(applied.ok).toBe(true);
    expect(applied.data).toMatchObject({
      sceneId: "scene-material-preset",
      objectId: "object-scene-material-preset-chip",
      assetId: "asset-scene-material-preset-chip",
      materialId: "mat-scene-material-preset-chip",
      presetId: "silicon-chip",
      syncedRenderObjectId: "obj-scene-material-preset-chip",
    });
    expect(host.getProject().creation?.operationHistory).toHaveLength(5);
    const asset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-material-preset-chip");
    const material = asset?.materials.find(
      (candidate) => candidate.id === "mat-scene-material-preset-chip",
    );
    expect(material).toMatchObject({
      name: "Silicon chip",
      model: "pbr",
      baseColor: "#111827",
      metallic: 0.25,
      roughness: 0.38,
      emissive: "#22c55e",
      emissiveIntensity: 0.18,
      parameters: {
        presetId: "silicon-chip",
        proceduralTexture: "circuit-traces",
        wear: 0.15,
        scratches: 0.2,
      },
    });
    expect(asset?.parameters).toMatchObject({
      materialPresetId: "silicon-chip",
      materialPresetTexture: "circuit-traces",
    });
    expect(asset?.nodes.some((node) => node.type === "material")).toBe(true);
    expect(asset?.caches[0]?.status).toBe("dirty");
    const renderObject = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-material-preset")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-material-preset-chip");
    expect(renderObject?.material).toMatchObject({
      color: "#111827",
      metalness: 0.25,
      roughness: 0.38,
      emissive: "#22c55e",
      emissiveIntensity: 0.18,
    });
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("applies semantic bevels and recovers rounded geometry previews", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-bevel-detail",
        compositionId: "comp-bevel-detail",
        layerId: "layer-bevel-detail",
        name: "Bevel Detail Scene",
        objects: [
          {
            key: "body",
            partId: "body",
            kind: "box",
            name: "Product body",
            x: 0,
            y: 0,
            z: 0,
            scaleX: 1.4,
            scaleY: 0.18,
            scaleZ: 0.8,
            color: "#475569",
            materialModel: "metal",
            tags: ["product-part", "body"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const beveled = await executeTool(
      "apply_creation_bevel",
      {
        sceneId: "scene-bevel-detail",
        partIds: ["body"],
        radius: 0.12,
        segments: 8,
        profile: "round",
        affectedEdges: "outer",
        hardenNormals: true,
      },
      host,
    );
    expect(beveled.ok).toBe(true);
    expect(beveled.data).toMatchObject({
      sceneId: "scene-bevel-detail",
      selectedObjectIds: ["object-scene-bevel-detail-body"],
      objectIds: ["object-scene-bevel-detail-body"],
      partIds: ["body"],
      assetIds: ["asset-scene-bevel-detail-body"],
      radius: 0.12,
      segments: 8,
      syncedRenderObjectIds: ["obj-scene-bevel-detail-body"],
      syncedCompositionIds: ["comp-bevel-detail"],
    });
    expect((beveled.data as { operationIds: string[] }).operationIds).toHaveLength(1);

    const asset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-bevel-detail-body");
    expect(asset?.parameters).toMatchObject({
      motionObjectKind: "rounded-box",
      cornerRadius: 0.12,
      bevel: {
        source: "agent-bevel",
        radius: 0.12,
        segments: 8,
        profile: "round",
        hardenNormals: true,
        affectedEdges: "outer",
        objectIds: ["object-scene-bevel-detail-body"],
        partIds: ["body"],
        previewRoundedBox: true,
      },
    });
    expect(asset?.parameters.bevelsByObjectId).toMatchObject({
      "object-scene-bevel-detail-body": {
        radius: 0.12,
        segments: 8,
      },
    });
    expect(asset?.nodes.some((node) => node.type === "bevel")).toBe(true);
    expect(
      asset?.nodes.find((node) => node.type === "primitive")?.parameters,
    ).toMatchObject({
      kind: "rounded-box",
      cornerRadius: 0.12,
    });
    expect(asset?.caches[0]?.status).toBe("dirty");

    const renderObject = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-bevel-detail")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-bevel-detail-body");
    expect(renderObject).toMatchObject({
      object: {
        kind: "rounded-box",
        cornerRadius: 0.12,
      },
    });

    const inspected = await executeTool(
      "inspect_creation_product_parts",
      { sceneId: "scene-bevel-detail", partIds: ["body"] },
      host,
    );
    expect(inspected.ok).toBe(true);
    const inspectedPart = (inspected.data as {
      parts: Array<{ recipeFeatures: { bevel?: unknown } }>;
    }).parts[0];
    expect(inspectedPart.recipeFeatures.bevel).toBeTruthy();

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-bevel-detail" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recovered = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-bevel-detail")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-bevel-detail-body");
    expect(recovered).toMatchObject({
      object: {
        kind: "rounded-box",
        cornerRadius: 0.12,
      },
    });
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("applies semantic displacement for terrain and recovers preview geometry", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-displacement-detail",
        compositionId: "comp-displacement-detail",
        layerId: "layer-displacement-detail",
        name: "Displacement Terrain Scene",
        objects: [
          {
            key: "terrain",
            partId: "terrain",
            kind: "plane",
            name: "Moon terrain",
            x: 0,
            y: -0.2,
            z: 0,
            scaleX: 3,
            scaleY: 2,
            color: "#b8b2a6",
            roughness: 0.94,
            materialModel: "procedural",
            tags: ["terrain", "moon"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const displaced = await executeTool(
      "apply_creation_displacement",
      {
        sceneId: "scene-displacement-detail",
        partIds: ["terrain"],
        kind: "craters",
        amplitude: 0.18,
        previewDepth: 0.18,
        frequency: 2.4,
        octaves: 5,
        seed: "moon-crater-seed",
        craterCount: 18,
        craterRadius: 0.22,
        erosion: 0.35,
        smoothing: 0.18,
        previewAsSlab: true,
      },
      host,
    );
    expect(displaced.ok).toBe(true);
    expect(displaced.data).toMatchObject({
      sceneId: "scene-displacement-detail",
      selectedObjectIds: ["object-scene-displacement-detail-terrain"],
      objectIds: ["object-scene-displacement-detail-terrain"],
      partIds: ["terrain"],
      assetIds: ["asset-scene-displacement-detail-terrain"],
      kind: "craters",
      amplitude: 0.18,
      previewDepth: 0.18,
      syncedRenderObjectIds: ["obj-scene-displacement-detail-terrain"],
      syncedCompositionIds: ["comp-displacement-detail"],
    });
    expect((displaced.data as { operationIds: string[] }).operationIds).toHaveLength(1);

    const asset = host
      .getProject()
      .creation?.assets.find(
        (candidate) => candidate.id === "asset-scene-displacement-detail-terrain",
      );
    expect(asset?.parameters).toMatchObject({
      motionObjectKind: "box",
      depth: 0.18,
      displacement: {
        source: "agent-displacement",
        kind: "craters",
        amplitude: 0.18,
        previewDepth: 0.18,
        previewAsSlab: true,
        frequency: 2.4,
        octaves: 5,
        seed: "moon-crater-seed",
        craterCount: 18,
        craterRadius: 0.22,
        erosion: 0.35,
        smoothing: 0.18,
        bakeTarget: "geometry-cache",
        objectIds: ["object-scene-displacement-detail-terrain"],
        partIds: ["terrain"],
      },
    });
    expect(asset?.parameters.displacementsByObjectId).toMatchObject({
      "object-scene-displacement-detail-terrain": {
        kind: "craters",
        amplitude: 0.18,
      },
    });
    expect(asset?.nodes.some((node) => node.type === "deform")).toBe(true);
    expect(
      asset?.nodes.find((node) => node.type === "primitive")?.parameters,
    ).toMatchObject({
      kind: "box",
      depth: 0.18,
      displacement: {
        kind: "craters",
        amplitude: 0.18,
      },
    });
    expect(asset?.caches[0]?.status).toBe("dirty");

    const renderObject = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-displacement-detail")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-displacement-detail-terrain");
    expect(renderObject).toMatchObject({
      object: {
        kind: "box",
        depth: 0.18,
      },
      material: {
        roughness: 0.94,
      },
    });

    const inspected = await executeTool(
      "inspect_creation_product_parts",
      { sceneId: "scene-displacement-detail", partIds: ["terrain"] },
      host,
    );
    expect(inspected.ok).toBe(true);
    const inspectedPart = (inspected.data as {
      parts: Array<{ recipeFeatures: { displacement?: unknown } }>;
    }).parts[0];
    expect(inspectedPart.recipeFeatures.displacement).toBeTruthy();

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-displacement-detail" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recovered = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-displacement-detail")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-displacement-detail-terrain") as
      | {
          object: { kind: string; depth?: number; mesh?: { positions: number[]; indices: number[] } };
          material: { roughness: number };
        }
      | undefined;
    expect(recovered).toMatchObject({
      object: {
        kind: "box",
        depth: 0.18,
      },
      material: {
        roughness: 0.94,
      },
    });
    expect(recovered?.object.mesh?.positions.length).toBeGreaterThanOrEqual(9);
    expect(recovered?.object.mesh?.indices.length).toBeGreaterThanOrEqual(3);
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("repeats an object into a baked array of copies in the bound scene3d render object", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-array",
        compositionId: "comp-array",
        layerId: "layer-array",
        name: "Array Scene",
        objects: [
          { key: "post", partId: "post", kind: "box", name: "Post", size: 1, tags: ["post"] },
        ],
      },
      host,
    );

    const arrayed = await executeTool(
      "apply_creation_array",
      { sceneId: "scene-array", partIds: ["post"], count: 4, offsetX: 1.5 },
      host,
    );
    expect(arrayed.ok).toBe(true);
    expect(arrayed.data).toMatchObject({ sceneId: "scene-array", count: 4 });
    expect((arrayed.data as { renderSyncCount: number }).renderSyncCount).toBe(1);

    const mesh = (
      host
        .getProject()
        .motionCompositions?.find((composition) => composition.id === "comp-array")
        ?.layers.find((candidate) => candidate.type === "scene3d")
        ?.objects?.find((object) => object.id === "obj-scene-array-post") as
        | { object: { mesh?: { positions: number[]; indices: number[] } } }
        | undefined
    )?.object.mesh;
    expect(mesh).toBeTruthy();
    if (!mesh) throw new Error("expected array mesh");
    let minX = Infinity;
    let maxX = -Infinity;
    for (let v = 0; v < mesh.positions.length / 3; v += 1) {
      minX = Math.min(minX, mesh.positions[v * 3]!);
      maxX = Math.max(maxX, mesh.positions[v * 3]!);
    }
    expect(maxX - minX).toBeGreaterThan(4);

    const arrayAsset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-array-post");
    expect(arrayAsset?.nodes.some((node) => node.type === "array")).toBe(true);

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("applies a procedural texture as a real surface map and survives re-sync", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-tex",
        compositionId: "comp-tex",
        layerId: "layer-tex",
        name: "Texture Scene",
        objects: [
          {
            key: "panel",
            partId: "panel",
            kind: "box",
            name: "Panel",
            size: 1,
            color: "#445566",
            materialModel: "metal",
            tags: ["panel"],
          },
        ],
      },
      host,
    );

    const applied = await executeTool(
      "apply_creation_texture_map",
      { sceneId: "scene-tex", partIds: ["panel"], pattern: "circuit", colorA: "#11aa33", colorB: "#001122", scale: 6 },
      host,
    );
    expect(applied.ok).toBe(true);
    const textureAssetId = (applied.data as { textureAssetId: string }).textureAssetId;
    expect(textureAssetId).toBeTruthy();

    const composition = () =>
      host.getProject().motionCompositions?.find((candidate) => candidate.id === "comp-tex");
    const imageAsset = composition()?.assets.find((candidate) => candidate.id === textureAssetId);
    expect(imageAsset?.type).toBe("image");
    expect(imageAsset?.url?.startsWith("data:image/png;base64,")).toBe(true);

    const renderMapId = () =>
      (
        composition()
          ?.layers.find((candidate) => candidate.type === "scene3d")
          ?.objects?.find((object) => object.id === "obj-scene-tex-panel") as
          | { material?: { mapAssetId?: string } }
          | undefined
      )?.material?.mapAssetId;
    expect(renderMapId()).toBe(textureAssetId);

    const texAsset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-tex-panel");
    expect(texAsset?.materials[0]?.parameters?.mapAssetId).toBe(textureAssetId);

    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-tex" },
      host,
    );
    expect(synced.ok).toBe(true);
    expect(renderMapId()).toBe(textureAssetId);

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("carves a real SDF boolean mesh into the bound scene3d render object", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-boolean",
        compositionId: "comp-boolean",
        layerId: "layer-boolean",
        name: "Boolean Scene",
        objects: [
          {
            key: "body",
            partId: "body",
            kind: "box",
            name: "Bracket",
            size: 2,
            color: "#9aa0a6",
            tags: ["body"],
          },
        ],
      },
      host,
    );

    const readBody = () =>
      host
        .getProject()
        .motionCompositions?.find((composition) => composition.id === "comp-boolean")
        ?.layers.find((candidate) => candidate.type === "scene3d")
        ?.objects?.find((object) => object.id === "obj-scene-boolean-body") as
        | { object: { kind: string; mesh?: { positions: number[]; indices: number[] } } }
        | undefined;

    expect(readBody()?.object.mesh).toBeUndefined();

    const carved = await executeTool(
      "apply_creation_boolean",
      {
        sceneId: "scene-boolean",
        partIds: ["body"],
        operation: "subtract",
        toolShape: "sphere",
        toolRadius: 1.1,
      },
      host,
    );
    expect(carved.ok).toBe(true);
    expect(carved.data).toMatchObject({
      sceneId: "scene-boolean",
      operation: "subtract",
      partIds: ["body"],
      syncedRenderObjectIds: ["obj-scene-boolean-body"],
    });
    expect((carved.data as { renderSyncCount: number }).renderSyncCount).toBeGreaterThanOrEqual(1);

    const mesh = readBody()?.object.mesh;
    expect(mesh).toBeTruthy();
    if (!mesh) throw new Error("expected carved mesh on bound render object");
    expect(mesh.positions.length).toBeGreaterThanOrEqual(9);
    expect(mesh.positions.length % 3).toBe(0);
    expect(mesh.indices.length).toBeGreaterThanOrEqual(3);
    const maxIndex = mesh.indices.reduce((max, value) => Math.max(max, value), 0);
    expect(maxIndex).toBeLessThan(mesh.positions.length / 3);

    const asset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-boolean-body");
    expect(asset?.nodes.some((node) => node.type === "boolean")).toBe(true);
    expect(asset?.nodes.filter((node) => node.type === "sdf").length).toBeGreaterThanOrEqual(2);

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("chains multiple boolean cutouts and survives same-key re-apply without losing geometry", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-multibool",
        compositionId: "comp-multibool",
        layerId: "layer-multibool",
        name: "Multi Boolean Scene",
        objects: [
          { key: "body", partId: "body", kind: "box", name: "Bracket", size: 2, tags: ["body"] },
        ],
      },
      host,
    );
    const booleanCount = () =>
      host
        .getProject()
        .creation?.assets.find((candidate) => candidate.id === "asset-scene-multibool-body")
        ?.nodes.filter((node) => node.type === "boolean").length ?? 0;
    const bodyMesh = () =>
      host
        .getProject()
        .motionCompositions?.find((composition) => composition.id === "comp-multibool")
        ?.layers.find((candidate) => candidate.type === "scene3d")
        ?.objects?.find((object) => object.id === "obj-scene-multibool-body") as
        | { object: { mesh?: { positions: number[] } } }
        | undefined;

    const cut = (offsetX: number, key?: string) =>
      executeTool(
        "apply_creation_boolean",
        {
          sceneId: "scene-multibool",
          partIds: ["body"],
          operation: "subtract",
          toolShape: "sphere",
          toolRadius: 0.5,
          toolOffset: { x: offsetX, y: 0, z: 0 },
          ...(key ? { key } : {}),
        },
        host,
      );

    expect((await cut(-0.7)).ok).toBe(true);
    expect((await cut(0.7)).ok).toBe(true);
    expect(booleanCount()).toBe(2);
    expect(bodyMesh()?.object.mesh?.positions.length).toBeGreaterThanOrEqual(9);

    expect((await cut(0, "lens")).ok).toBe(true);
    expect((await cut(0.4, "vent")).ok).toBe(true);
    expect(booleanCount()).toBe(4);

    const reapply = await cut(0.1, "lens");
    expect(reapply.ok).toBe(true);
    expect(booleanCount()).toBe(4);
    expect(bodyMesh()?.object.mesh?.positions.length).toBeGreaterThanOrEqual(9);
  });

  it("reports body approximation when carving a non-box/sphere primitive", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-approx",
        compositionId: "comp-approx",
        layerId: "layer-approx",
        name: "Approx Scene",
        objects: [
          { key: "barrel", partId: "barrel", kind: "cylinder", name: "Barrel", size: 2, tags: ["barrel"] },
        ],
      },
      host,
    );
    const carved = await executeTool(
      "apply_creation_boolean",
      { sceneId: "scene-approx", partIds: ["barrel"], operation: "subtract", toolShape: "sphere", toolRadius: 0.6 },
      host,
    );
    expect(carved.ok).toBe(true);
    expect((carved.data as { approximatedBodyObjectIds: string[] }).approximatedBodyObjectIds).toEqual([
      "object-scene-approx-barrel",
    ]);
  });

  it("bakes a real rigid-body simulation with inter-body collision into the bound scene3d layer", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-rb",
        compositionId: "comp-rb",
        layerId: "layer-rb",
        name: "Rigid Bodies Scene",
        objects: [
          { key: "ball-a", partId: "ball-a", objectId: "object-scene-rb-ball-a", kind: "sphere", name: "Ball A", x: 0, y: 0, z: 0, tags: ["rb"] },
          { key: "ball-b", partId: "ball-b", objectId: "object-scene-rb-ball-b", kind: "sphere", name: "Ball B", x: 0.2, y: 0, z: 0, tags: ["rb"] },
        ],
      },
      host,
    );

    const result = await executeTool(
      "simulate_creation_rigid_bodies",
      {
        sceneId: "scene-rb",
        tags: ["rb"],
        dropHeight: 3,
        groundY: 0,
        gravity: 9.8,
        restitution: 0.2,
        simDuration: 3,
        startTime: 0,
        radius: 0.5,
      },
      host,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      sceneId: "scene-rb",
      collideEachOther: true,
      groundY: 0,
    });
    expect((result.data as { renderKeyframeCount: number }).renderKeyframeCount).toBeGreaterThan(0);

    const scene = host.getProject().creation?.scenes.find((candidate) => candidate.id === "scene-rb");
    const clip = scene?.animations.find((candidate) => candidate.id === "anim-scene-rb-rigid-bodies");
    const finalPosition = (objectId: string): { x: number; y: number; z: number } => {
      const track = clip?.tracks.find((candidate) => candidate.targetId === objectId);
      const last = track?.keyframes[track.keyframes.length - 1];
      return last?.value as { x: number; y: number; z: number };
    };
    const a = finalPosition("object-scene-rb-ball-a");
    const b = finalPosition("object-scene-rb-ball-b");
    expect(Math.min(a.y, b.y)).toBeGreaterThanOrEqual(0.4);
    const separation = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    expect(separation).toBeGreaterThan(0.8);

    const asset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-rb-ball-a");
    expect(asset?.parameters.rigidDrop).toMatchObject({ solver: "rigid-body-solver" });
  });

  it("bakes a per-frame cloth mesh sequence that deforms over time into the bound scene3d object", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-cloth",
        compositionId: "comp-cloth",
        layerId: "layer-cloth",
        name: "Cloth Scene",
        objects: [
          { key: "flag", partId: "flag", kind: "plane", name: "Flag", size: 2, tags: ["flag"] },
        ],
      },
      host,
    );

    const baked = await executeTool(
      "bake_creation_cloth",
      {
        sceneId: "scene-cloth",
        partIds: ["flag"],
        plane: "xy",
        pin: "left",
        windZ: 5,
        fps: 24,
        simDuration: 1.2,
      },
      host,
    );
    expect(baked.ok).toBe(true);
    expect(baked.data).toMatchObject({ sceneId: "scene-cloth", partIds: ["flag"] });
    expect((baked.data as { frameCount: number }).frameCount).toBeGreaterThan(1);
    expect((baked.data as { renderSyncCount: number }).renderSyncCount).toBe(1);

    const renderObject = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-cloth")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-cloth-flag") as
      | { object: { meshFrames?: { fps: number; indices: number[]; frames: number[][] } } }
      | undefined;
    const meshFrames = renderObject?.object.meshFrames;
    expect(meshFrames).toBeTruthy();
    if (!meshFrames) throw new Error("expected meshFrames on bound render object");
    expect(meshFrames.frames.length).toBeGreaterThan(1);
    expect(meshFrames.indices.length).toBeGreaterThanOrEqual(3);
    expect(meshFrames.frames[0]!.length).toBe(meshFrames.frames[meshFrames.frames.length - 1]!.length);
    expect(meshFrames.frames[0]).not.toEqual(meshFrames.frames[meshFrames.frames.length - 1]);

    const lastFrame = meshFrames.frames[meshFrames.frames.length - 1]!;
    let maxAbsZ = 0;
    for (let i = 2; i < lastFrame.length; i += 3) {
      maxAbsZ = Math.max(maxAbsZ, Math.abs(lastFrame[i]!));
    }
    expect(maxAbsZ).toBeGreaterThan(0.05);

    const clothAsset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-cloth-flag");
    expect(clothAsset?.nodes.some((node) => node.type === "cloth")).toBe(true);

    const opacityEdit = await executeTool(
      "set_creation_object_geometry",
      { sceneId: "scene-cloth", objectId: "object-scene-cloth-flag", opacity: 0.6 },
      host,
    );
    expect(opacityEdit.ok).toBe(true);
    const meshFramesAfterEdit = (
      host
        .getProject()
        .motionCompositions?.find((composition) => composition.id === "comp-cloth")
        ?.layers.find((candidate) => candidate.type === "scene3d")
        ?.objects?.find((object) => object.id === "obj-scene-cloth-flag") as
        | { object: { meshFrames?: { frames: number[][] } } }
        | undefined
    )?.object.meshFrames;
    expect(meshFramesAfterEdit?.frames.length).toBeGreaterThan(1);

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("bakes a smoothly-deforming skinned limb into a per-frame mesh sequence", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-limb",
        compositionId: "comp-limb",
        layerId: "layer-limb",
        name: "Limb Scene",
        objects: [
          { key: "tentacle", partId: "tentacle", kind: "cylinder", name: "Tentacle", size: 2, tags: ["limb"] },
        ],
      },
      host,
    );

    const baked = await executeTool(
      "bake_creation_skinned_limb",
      {
        sceneId: "scene-limb",
        partIds: ["tentacle"],
        segments: 8,
        amplitudeDegrees: 16,
        axis: "z",
        fps: 24,
        simDuration: 1.5,
      },
      host,
    );
    expect(baked.ok).toBe(true);
    expect((baked.data as { renderSyncCount: number }).renderSyncCount).toBe(1);
    expect((baked.data as { frameCount: number }).frameCount).toBeGreaterThan(1);

    const meshFrames = (
      host
        .getProject()
        .motionCompositions?.find((composition) => composition.id === "comp-limb")
        ?.layers.find((candidate) => candidate.type === "scene3d")
        ?.objects?.find((object) => object.id === "obj-scene-limb-tentacle") as
        | { object: { meshFrames?: { frames: number[][]; loop?: boolean } } }
        | undefined
    )?.object.meshFrames;
    expect(meshFrames).toBeTruthy();
    if (!meshFrames) throw new Error("expected limb meshFrames");
    expect(meshFrames.frames.length).toBeGreaterThan(1);
    expect(meshFrames.frames[0]).not.toEqual(meshFrames.frames[meshFrames.frames.length - 1]);

    const vertexCount = meshFrames.frames[0]!.length / 3;
    let maxXRange = 0;
    for (let v = 0; v < vertexCount; v += 1) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const frame of meshFrames.frames) {
        const x = frame[v * 3]!;
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      maxXRange = Math.max(maxXRange, hi - lo);
    }
    expect(maxXRange).toBeGreaterThan(0.2);

    const limbAsset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-limb-tentacle");
    expect(limbAsset?.nodes.some((node) => node.type === "skeleton")).toBe(true);
  });

  it("bakes a skinned waving humanoid character into a per-frame mesh sequence", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-human",
        compositionId: "comp-human",
        layerId: "layer-human",
        name: "Humanoid Scene",
        objects: [
          { key: "figure", partId: "figure", kind: "box", name: "Figure", size: 2, tags: ["figure"] },
        ],
      },
      host,
    );

    const baked = await executeTool(
      "bake_creation_humanoid",
      { sceneId: "scene-human", partIds: ["figure"], animation: "walk", speed: 6, fps: 20, simDuration: 2 },
      host,
    );
    expect(baked.ok).toBe(true);
    expect((baked.data as { renderSyncCount: number }).renderSyncCount).toBe(1);
    expect((baked.data as { frameCount: number }).frameCount).toBeGreaterThan(1);

    const meshFrames = (
      host
        .getProject()
        .motionCompositions?.find((composition) => composition.id === "comp-human")
        ?.layers.find((candidate) => candidate.type === "scene3d")
        ?.objects?.find((object) => object.id === "obj-scene-human-figure") as
        | { object: { meshFrames?: { frames: number[][] } } }
        | undefined
    )?.object.meshFrames;
    expect(meshFrames).toBeTruthy();
    if (!meshFrames) throw new Error("expected humanoid meshFrames");
    expect(meshFrames.frames.length).toBeGreaterThan(1);
    expect(meshFrames.frames[0]).not.toEqual(meshFrames.frames[meshFrames.frames.length - 1]);

    const frame = meshFrames.frames[0]!;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let v = 0; v < frame.length / 3; v += 1) {
      minX = Math.min(minX, frame[v * 3]!);
      maxX = Math.max(maxX, frame[v * 3]!);
      minY = Math.min(minY, frame[v * 3 + 1]!);
      maxY = Math.max(maxY, frame[v * 3 + 1]!);
    }
    expect(maxY - minY).toBeGreaterThan(2);
    expect(maxX - minX).toBeGreaterThan(1);

    const humanAsset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-human-figure");
    expect(humanAsset?.nodes.some((node) => node.type === "skeleton")).toBe(true);
    expect(humanAsset?.parameters.humanoid).toMatchObject({
      solver: "linear-blend-skinning",
      animation: "walk",
    });
  });

  it("bakes a real particle burst that expands over time into a per-frame point cloud", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-particles",
        compositionId: "comp-particles",
        layerId: "layer-particles",
        name: "Particles Scene",
        objects: [
          { key: "burst", partId: "burst", kind: "sphere", name: "Burst", size: 2, tags: ["fx"] },
        ],
      },
      host,
    );

    const baked = await executeTool(
      "bake_creation_particles",
      {
        sceneId: "scene-particles",
        partIds: ["burst"],
        count: 60,
        speed: 3,
        gravity: 2,
        simDuration: 2,
        seed: "burst-seed",
      },
      host,
    );
    expect(baked.ok).toBe(true);
    expect((baked.data as { renderSyncCount: number }).renderSyncCount).toBe(1);

    const meshFrames = (
      host
        .getProject()
        .motionCompositions?.find((composition) => composition.id === "comp-particles")
        ?.layers.find((candidate) => candidate.type === "scene3d")
        ?.objects?.find((object) => object.id === "obj-scene-particles-burst") as
        | { object: { meshFrames?: { frames: number[][] } } }
        | undefined
    )?.object.meshFrames;
    expect(meshFrames).toBeTruthy();
    if (!meshFrames) throw new Error("expected particle meshFrames");
    expect(meshFrames.frames.length).toBeGreaterThan(1);

    const extent = (frame: number[]): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const value of frame) {
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
      return hi - lo;
    };
    const firstExtent = extent(meshFrames.frames[0]!);
    const lastExtent = extent(meshFrames.frames[meshFrames.frames.length - 1]!);
    expect(lastExtent).toBeGreaterThan(firstExtent * 3);
    expect(lastExtent).toBeGreaterThan(1);

    const fxAsset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-particles-burst");
    expect(fxAsset?.parameters.particles).toMatchObject({ solver: "euler-particles" });
  });

  it("bakes a real displaced BufferGeometry mesh into the bound scene3d render object", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-mesh-bridge",
        compositionId: "comp-mesh-bridge",
        layerId: "layer-mesh-bridge",
        name: "Mesh Bridge Scene",
        objects: [
          {
            key: "terrain",
            partId: "terrain",
            kind: "plane",
            name: "Relief terrain",
            scaleX: 3,
            scaleY: 2,
            color: "#b8b2a6",
            materialModel: "procedural",
            tags: ["terrain"],
          },
        ],
      },
      host,
    );

    const readRenderObject = () =>
      host
        .getProject()
        .motionCompositions?.find((composition) => composition.id === "comp-mesh-bridge")
        ?.layers.find((candidate) => candidate.type === "scene3d")
        ?.objects?.find((object) => object.id === "obj-scene-mesh-bridge-terrain") as
        | {
            object: {
              kind: string;
              mesh?: {
                positions: number[];
                indices: number[];
                normals?: number[];
                uvs?: number[];
              };
            };
          }
        | undefined;

    expect(readRenderObject()?.object.mesh).toBeUndefined();

    const displaced = await executeTool(
      "apply_creation_displacement",
      {
        sceneId: "scene-mesh-bridge",
        partIds: ["terrain"],
        kind: "terrain",
        amplitude: 0.2,
        frequency: 2,
        previewAsSlab: false,
      },
      host,
    );
    expect(displaced.ok).toBe(true);

    const mesh = readRenderObject()?.object.mesh;
    expect(mesh).toBeTruthy();
    if (!mesh) throw new Error("expected baked mesh on bound render object");
    expect(mesh.positions.length).toBeGreaterThanOrEqual(9);
    expect(mesh.positions.length % 3).toBe(0);
    expect(mesh.indices.length).toBeGreaterThanOrEqual(3);
    expect(mesh.indices.length % 3).toBe(0);
    const maxIndex = mesh.indices.reduce((max, value) => Math.max(max, value), 0);
    expect(maxIndex).toBeLessThan(mesh.positions.length / 3);

    const yValues: number[] = [];
    for (let i = 1; i < mesh.positions.length; i += 3) {
      yValues.push(mesh.positions[i]!);
    }
    const reliefExtent =
      Math.max(...yValues) - Math.min(...yValues);
    expect(reliefExtent).toBeGreaterThan(0.02);
    expect(mesh.positions.length / 3).toBeGreaterThan(4);

    const baked = await executeTool(
      "bake_creation_asset",
      { assetId: "asset-scene-mesh-bridge-terrain", quality: "final" },
      host,
    );
    expect(baked.ok).toBe(true);
    expect((baked.data as { placeholder: boolean }).placeholder).toBe(false);
    expect((baked.data as { renderSyncCount: number }).renderSyncCount).toBeGreaterThanOrEqual(1);

    const meshAfterBake = readRenderObject()?.object.mesh;
    expect(meshAfterBake).toBeTruthy();
    expect(meshAfterBake!.positions.length).toBeGreaterThanOrEqual(9);

    const opacityEdit = await executeTool(
      "set_creation_object_geometry",
      { sceneId: "scene-mesh-bridge", objectId: "object-scene-mesh-bridge-terrain", opacity: 0.5 },
      host,
    );
    expect(opacityEdit.ok).toBe(true);
    expect(readRenderObject()?.object.mesh).toBeTruthy();

    const geometryEdit = await executeTool(
      "set_creation_object_geometry",
      { sceneId: "scene-mesh-bridge", objectId: "object-scene-mesh-bridge-terrain", size: 4 },
      host,
    );
    expect(geometryEdit.ok).toBe(true);
    expect(readRenderObject()?.object.mesh?.positions.length).toBeGreaterThanOrEqual(9);

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("applies semantic surface detail and recovers render material previews", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-surface-detail",
        compositionId: "comp-surface-detail",
        layerId: "layer-surface-detail",
        name: "Surface Detail Scene",
        objects: [
          {
            key: "shell",
            partId: "shell",
            kind: "rounded-box",
            name: "Brushed shell",
            color: "#64748b",
            roughness: 0.28,
            metalness: 0.7,
            materialModel: "metal",
            tags: ["product-part", "shell"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const applied = await executeTool(
      "apply_creation_surface_detail",
      {
        sceneId: "scene-surface-detail",
        partIds: ["shell"],
        kind: "scratches",
        intensity: 0.6,
        density: 0.4,
        scale: 0.25,
        seed: "scratch-seed-1",
        color: "#e2e8f0",
        roughness: 0.46,
        roughnessBoost: 0.3,
        scratchLength: 0.7,
      },
      host,
    );
    expect(applied.ok).toBe(true);
    expect(applied.data).toMatchObject({
      sceneId: "scene-surface-detail",
      objectIds: ["object-scene-surface-detail-shell"],
      partIds: ["shell"],
      assetIds: ["asset-scene-surface-detail-shell"],
      materialIdsByObjectId: {
        "object-scene-surface-detail-shell": "mat-scene-surface-detail-shell",
      },
      syncedRenderObjectIds: ["obj-scene-surface-detail-shell"],
      surfaceDetail: {
        kind: "scratches",
        intensity: 0.6,
        density: 0.4,
        scale: 0.25,
        color: "#e2e8f0",
      },
    });
    expect(host.getProject().creation?.operationHistory).toHaveLength(4);

    const asset = host
      .getProject()
      .creation?.assets.find((candidate) => candidate.id === "asset-scene-surface-detail-shell");
    const material = asset?.materials.find(
      (candidate) => candidate.id === "mat-scene-surface-detail-shell",
    );
    expect(material).toMatchObject({
      roughness: 0.46,
      metallic: 0.7,
      parameters: {
        source: "agent-surface-detail",
        surfaceDetail: {
          source: "agent-surface-detail",
          kind: "scratches",
          intensity: 0.6,
          density: 0.4,
          scale: 0.25,
          color: "#e2e8f0",
          seed: "scratch-seed-1",
          pattern: "scratches",
          scratchLength: 0.7,
          roughnessBoost: 0.3,
          bakeTarget: "material-texture",
        },
      },
    });
    expect(asset?.parameters).toMatchObject({
      surfaceDetail: {
        source: "agent-surface-detail",
        materialIds: ["mat-scene-surface-detail-shell"],
        kind: "scratches",
        intensity: 0.6,
        density: 0.4,
        scale: 0.25,
        color: "#e2e8f0",
        seed: "scratch-seed-1",
      },
      surfaceDetailsByMaterialId: {
        "mat-scene-surface-detail-shell": {
          source: "agent-surface-detail",
          materialId: "mat-scene-surface-detail-shell",
          kind: "scratches",
          roughness: 0.46,
        },
      },
    });
    expect(asset?.nodes.some((node) => node.type === "material")).toBe(true);
    expect(asset?.caches[0]?.status).toBe("dirty");

    const renderObject = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-surface-detail")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-surface-detail-shell");
    expect(renderObject?.material).toMatchObject({
      color: "#64748b",
      metalness: 0.7,
      roughness: 0.46,
    });

    const roughnessMapAssetId = (applied.data as { roughnessMapAssetId?: string })
      .roughnessMapAssetId;
    expect(roughnessMapAssetId).toMatch(/^rough-/);
    expect(
      (renderObject?.material as { roughnessMapAssetId?: string } | undefined)
        ?.roughnessMapAssetId,
    ).toBe(roughnessMapAssetId);
    const detailComposition = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-surface-detail");
    expect(
      detailComposition?.assets.some(
        (candidate) => candidate.id === roughnessMapAssetId && candidate.type === "image",
      ),
    ).toBe(true);

    const inspected = await executeTool(
      "inspect_creation_product_parts",
      { sceneId: "scene-surface-detail", partIds: ["shell"] },
      host,
    );
    expect(inspected.ok).toBe(true);
    const inspectedPart = (inspected.data as {
      parts: Array<{
        material?: { surfaceDetail?: unknown };
        recipeFeatures: { surfaceDetail?: unknown };
      }>;
    }).parts[0];
    expect(inspectedPart.material?.surfaceDetail).toBeTruthy();
    expect(inspectedPart.recipeFeatures.surfaceDetail).toBeTruthy();

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-surface-detail" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredObject = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-surface-detail")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-surface-detail-shell");
    expect(recoveredObject?.material).toMatchObject({
      color: "#64748b",
      roughness: 0.46,
    });
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("applies an evaluated material graph onto bound creation objects", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-mat-graph",
        compositionId: "comp-mat-graph",
        layerId: "layer-mat-graph",
        name: "Material Graph Scene",
        objects: [
          {
            key: "panel",
            partId: "panel",
            kind: "rounded-box",
            name: "Panel",
            color: "#202020",
            materialModel: "plastic",
            tags: ["panel"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const applied = await executeTool(
      "apply_creation_material_graph",
      {
        sceneId: "scene-mat-graph",
        partIds: ["panel"],
        graph: {
          output: "out",
          nodes: [
            {
              id: "out",
              type: "output",
              params: { baseColor: "#3b82f6", metallic: 0.2, roughness: 0.6, emissive: "#111111" },
            },
          ],
        },
      },
      host,
    );
    expect(applied.ok).toBe(true);
    expect(applied.data).toMatchObject({
      sceneId: "scene-mat-graph",
      syncedRenderObjectIds: ["obj-scene-mat-graph-panel"],
      evaluated: { baseColor: "#3b82f6", roughness: 0.6, emissive: "#111111" },
    });

    const renderObject = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-mat-graph")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-mat-graph-panel");
    expect(renderObject?.material).toMatchObject({
      color: "#3b82f6",
      roughness: 0.6,
      emissive: "#111111",
    });
  });

  it("applies semantic X-ray materials for product internal reveals", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-xray-reveal",
        compositionId: "comp-xray-reveal",
        layerId: "layer-xray-reveal",
        name: "X-ray Product Reveal",
        objects: [
          {
            key: "shell",
            partId: "shell",
            kind: "rounded-box",
            name: "Outer titanium shell",
            x: 0,
            y: 0,
            z: 0,
            scaleX: 1.4,
            scaleY: 0.12,
            scaleZ: 0.8,
            color: "#94a3b8",
            materialModel: "metal",
            tags: ["product-part", "shell"],
          },
          {
            key: "board",
            partId: "board",
            kind: "box",
            name: "Internal logic board",
            x: 0,
            y: 0,
            z: 0.08,
            scaleX: 0.9,
            scaleY: 0.05,
            scaleZ: 0.45,
            color: "#064e3b",
            materialModel: "pbr",
            tags: ["product-part", "internal", "board"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const applied = await executeTool(
      "apply_creation_xray_material",
      {
        sceneId: "scene-xray-reveal",
        partIds: ["shell"],
        tint: "#7dd3fc",
        opacity: 0.26,
        transmission: 0.82,
        edgeGlow: 0.35,
        style: "ghosted-shell",
      },
      host,
    );
    expect(applied.ok).toBe(true);
    expect(applied.data).toMatchObject({
      sceneId: "scene-xray-reveal",
      objectIds: ["object-scene-xray-reveal-shell"],
      assetIds: ["asset-scene-xray-reveal-shell"],
      materialIdsByObjectId: {
        "object-scene-xray-reveal-shell": "mat-scene-xray-reveal-shell",
      },
      syncedRenderObjectIds: ["obj-scene-xray-reveal-shell"],
      xray: {
        opacity: 0.26,
        transmission: 0.82,
        tint: "#7dd3fc",
        edgeGlow: 0.35,
      },
    });
    expect(host.getProject().creation?.operationHistory).toHaveLength(5);

    const shellAsset = host
      .getProject()
      .creation?.assets.find((asset) => asset.id === "asset-scene-xray-reveal-shell");
    const shellMaterial = shellAsset?.materials.find(
      (material) => material.id === "mat-scene-xray-reveal-shell",
    );
    expect(shellMaterial).toMatchObject({
      name: "X-ray Outer titanium shell material",
      model: "glass",
      baseColor: "#7dd3fc",
      roughness: 0.08,
      opacity: 0.26,
      transmission: 0.82,
      clearcoat: 0.7,
      emissive: "#7dd3fc",
      emissiveIntensity: 0.35,
      parameters: {
        source: "agent-xray-material",
        xrayMaterial: {
          source: "agent-xray-material",
          style: "ghosted-shell",
          tint: "#7dd3fc",
          opacity: 0.26,
          transmission: 0.82,
          edgeGlow: 0.35,
          revealInternals: true,
        },
      },
    });
    expect(shellAsset?.parameters).toMatchObject({
      xrayMaterial: {
        source: "agent-xray-material",
        materialIds: ["mat-scene-xray-reveal-shell"],
        style: "ghosted-shell",
        opacity: 0.26,
        transmission: 0.82,
        edgeGlow: 0.35,
      },
      xrayMaterialsById: {
        "mat-scene-xray-reveal-shell": {
          source: "agent-xray-material",
          opacity: 0.26,
          transmission: 0.82,
          baseColor: "#7dd3fc",
        },
      },
    });
    expect(shellAsset?.nodes.some((node) => node.type === "material")).toBe(true);
    expect(shellAsset?.caches[0]?.status).toBe("dirty");

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-xray-reveal")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    const shellRenderObject = layer?.objects?.find(
      (object) => object.id === "obj-scene-xray-reveal-shell",
    );
    expect(shellRenderObject?.material).toMatchObject({
      color: "#7dd3fc",
      roughness: 0.08,
      opacity: 0.26,
      emissive: "#7dd3fc",
      emissiveIntensity: 0.35,
      transmission: 0.82,
      clearcoat: 0.7,
    });
    expect(shellRenderObject?.opacity).toBe(0.26);
    const boardRenderObject = layer?.objects?.find(
      (object) => object.id === "obj-scene-xray-reveal-board",
    );
    expect(boardRenderObject?.material?.color).toBe("#064e3b");
    expect(boardRenderObject?.opacity).toBeUndefined();

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-xray-reveal" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredShell = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-xray-reveal")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-xray-reveal-shell");
    expect(recoveredShell?.material).toMatchObject({
      color: "#7dd3fc",
      opacity: 0.26,
    });
    expect(recoveredShell?.opacity).toBe(0.26);
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("adds semantic cutaway planes and recovers render bindings", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-cutaway-plane",
        compositionId: "comp-cutaway-plane",
        layerId: "layer-cutaway-plane",
        name: "Cutaway Product Reveal",
        duration: 3,
        objects: [
          {
            key: "shell",
            partId: "shell",
            kind: "rounded-box",
            name: "Outer shell",
            x: 0,
            y: 0,
            z: 0,
            scaleX: 1.3,
            scaleY: 0.1,
            scaleZ: 0.8,
            color: "#94a3b8",
            materialModel: "metal",
            tags: ["product-part", "shell"],
          },
          {
            key: "board",
            partId: "board",
            kind: "box",
            name: "Internal board",
            x: 0,
            y: 0,
            z: 0.1,
            scaleX: 0.8,
            scaleY: 0.05,
            scaleZ: 0.45,
            color: "#064e3b",
            materialModel: "pbr",
            tags: ["product-part", "internal", "board"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const cutaway = await executeTool(
      "add_creation_cutaway_plane",
      {
        sceneId: "scene-cutaway-plane",
        key: "section-a",
        partId: "section-a",
        targetPartIds: ["shell", "board"],
        axis: "z",
        offset: 0.18,
        size: 1.7,
        tint: "#38bdf8",
        opacity: 0.24,
        mode: "half-section-preview",
      },
      host,
    );
    expect(cutaway.ok).toBe(true);
    expect(cutaway.data).toMatchObject({
      sceneId: "scene-cutaway-plane",
      objectId: "object-scene-cutaway-plane-section-a",
      partId: "section-a",
      renderObjectId: "obj-scene-cutaway-plane-section-a",
      assetId: "asset-scene-cutaway-plane-section-a",
      materialId: "mat-scene-cutaway-plane-section-a",
      targetObjectIds: [
        "object-scene-cutaway-plane-shell",
        "object-scene-cutaway-plane-board",
      ],
      targetPartIds: ["shell", "board"],
      normal: { x: 0, y: 0, z: 1 },
      offset: 0.18,
    });
    expect(host.getProject().creation?.operationHistory).toHaveLength(6);

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-cutaway-plane");
    expect(scene?.objects.map((object) => object.id)).toContain(
      "object-scene-cutaway-plane-section-a",
    );
    expect(scene?.renderBindings[0]?.objectBindings).toContainEqual({
      sceneObjectId: "object-scene-cutaway-plane-section-a",
      renderObjectId: "obj-scene-cutaway-plane-section-a",
    });
    const cutawayAsset = host
      .getProject()
      .creation?.assets.find((asset) => asset.id === "asset-scene-cutaway-plane-section-a");
    expect(cutawayAsset?.parameters).toMatchObject({
      cutawayPlane: {
        source: "agent-cutaway-plane",
        mode: "half-section-preview",
        normal: { x: 0, y: 0, z: 1 },
        offset: 0.18,
        targetObjectIds: [
          "object-scene-cutaway-plane-shell",
          "object-scene-cutaway-plane-board",
        ],
        targetPartIds: ["shell", "board"],
        previewOnly: true,
        tint: "#38bdf8",
        opacity: 0.24,
      },
    });
    expect(cutawayAsset?.nodes.some((node) => node.type === "boolean")).toBe(true);
    expect(cutawayAsset?.caches[0]?.status).toBe("dirty");
    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-cutaway-plane")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    const renderObject = layer?.objects?.find(
      (object) => object.id === "obj-scene-cutaway-plane-section-a",
    );
    expect(renderObject).toMatchObject({
      object: { kind: "plane" },
      material: {
        color: "#38bdf8",
        emissive: "#38bdf8",
        emissiveIntensity: 0.28,
      },
      opacity: 0.24,
      transform3d: {
        position: { x: 0, y: 0, z: 0.18 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1.7, y: 1.7, z: 1 },
      },
    });

    const inspected = await executeTool(
      "inspect_creation_product_parts",
      { sceneId: "scene-cutaway-plane", partIds: ["section-a"] },
      host,
    );
    expect(inspected.ok).toBe(true);
    const inspectedPart = (inspected.data as {
      parts: Array<{ recipeFeatures: { cutawayPlane?: unknown } }>;
    }).parts[0];
    expect(inspectedPart.recipeFeatures.cutawayPlane).toBeTruthy();

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-cutaway-plane" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredCutaway = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-cutaway-plane")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-cutaway-plane-section-a");
    expect(recoveredCutaway).toMatchObject({
      object: { kind: "plane" },
      material: { color: "#38bdf8", opacity: 0.24 },
      opacity: 0.24,
    });
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("adds semantic decals and recovers render bindings", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-decal-detail",
        compositionId: "comp-decal-detail",
        layerId: "layer-decal-detail",
        name: "Decal Product Detail",
        duration: 3,
        objects: [
          {
            key: "shell",
            partId: "shell",
            kind: "rounded-box",
            name: "Product shell",
            x: 0,
            y: 0,
            z: 0,
            scaleX: 1.2,
            scaleY: 0.12,
            scaleZ: 0.7,
            color: "#475569",
            materialModel: "metal",
            tags: ["product-part", "shell"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const decal = await executeTool(
      "add_creation_decal",
      {
        sceneId: "scene-decal-detail",
        key: "brand-mark",
        partId: "brand-mark",
        targetPartId: "shell",
        text: "OPENREEL",
        normalZ: 1,
        offset: 0.09,
        width: 0.6,
        height: 0.16,
        tint: "#f8fafc",
        emissiveIntensity: 0.75,
        opacity: 0.92,
      },
      host,
    );
    expect(decal.ok).toBe(true);
    expect(decal.data).toMatchObject({
      sceneId: "scene-decal-detail",
      objectId: "object-scene-decal-detail-brand-mark",
      partId: "brand-mark",
      renderObjectId: "obj-scene-decal-detail-brand-mark",
      assetId: "asset-scene-decal-detail-brand-mark",
      materialId: "mat-scene-decal-detail-brand-mark",
      targetObjectIds: ["object-scene-decal-detail-shell"],
      targetPartIds: ["shell"],
      normal: { x: 0, y: 0, z: 1 },
      offset: 0.09,
    });
    expect(host.getProject().creation?.operationHistory).toHaveLength(5);

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-decal-detail");
    const decalObject = scene?.objects.find(
      (object) => object.id === "object-scene-decal-detail-brand-mark",
    );
    expect(decalObject).toMatchObject({
      partId: "brand-mark",
      parentId: "object-scene-decal-detail-shell",
      tags: expect.arrayContaining(["decal", "surface-decal", "text3d"]),
    });
    expect(scene?.renderBindings[0]?.objectBindings).toContainEqual({
      sceneObjectId: "object-scene-decal-detail-brand-mark",
      renderObjectId: "obj-scene-decal-detail-brand-mark",
    });

    const decalAsset = host
      .getProject()
      .creation?.assets.find((asset) => asset.id === "asset-scene-decal-detail-brand-mark");
    expect(decalAsset?.parameters).toMatchObject({
      decal: {
        source: "agent-decal",
        projection: "surface",
        targetObjectIds: ["object-scene-decal-detail-shell"],
        targetPartIds: ["shell"],
        normal: { x: 0, y: 0, z: 1 },
        offset: 0.09,
        text: "OPENREEL",
        tint: "#f8fafc",
        opacity: 0.92,
        wrap: "flat",
        bakeTarget: "material-texture",
      },
    });
    expect(decalAsset?.nodes.some((node) => node.type === "decal")).toBe(true);
    expect(decalAsset?.caches[0]?.status).toBe("dirty");

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-decal-detail")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    const renderObject = layer?.objects?.find(
      (object) => object.id === "obj-scene-decal-detail-brand-mark",
    );
    expect(renderObject).toMatchObject({
      object: { kind: "text3d", text: "OPENREEL", extrude: 0.015 },
      material: {
        color: "#f8fafc",
        emissive: "#f8fafc",
        emissiveIntensity: 0.75,
      },
      opacity: 0.92,
      transform3d: {
        position: { x: 0, y: 0, z: 0.09 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 0.6, y: 0.16, z: 1 },
      },
    });

    const inspected = await executeTool(
      "inspect_creation_product_parts",
      { sceneId: "scene-decal-detail", partIds: ["brand-mark"] },
      host,
    );
    expect(inspected.ok).toBe(true);
    const inspectedPart = (inspected.data as {
      parts: Array<{ recipeFeatures: { decal?: unknown } }>;
    }).parts[0];
    expect(inspectedPart.recipeFeatures.decal).toBeTruthy();

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-decal-detail" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredDecal = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-decal-detail")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-decal-detail-brand-mark");
    expect(recoveredDecal).toMatchObject({
      object: { kind: "text3d", text: "OPENREEL" },
      material: { color: "#f8fafc", emissive: "#f8fafc" },
      opacity: 0.92,
    });
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("adds semantic 3D UI panels and recovers render bindings", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-ui-panel-detail",
        compositionId: "comp-ui-panel-detail",
        layerId: "layer-ui-panel-detail",
        name: "UI Panel Product Detail",
        duration: 3,
        objects: [
          {
            key: "device",
            partId: "device",
            kind: "rounded-box",
            name: "Product body",
            x: 0,
            y: 0,
            z: 0,
            scaleX: 1.2,
            scaleY: 0.16,
            scaleZ: 0.72,
            color: "#111827",
            materialModel: "metal",
            tags: ["product-part", "device"],
          },
          {
            key: "screen",
            partId: "screen",
            kind: "plane",
            name: "Device screen",
            x: 0,
            y: 0,
            z: 0.09,
            scaleX: 0.94,
            scaleY: 0.5,
            color: "#020617",
            materialModel: "screen",
            tags: ["product-part", "screen"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const panel = await executeTool(
      "add_creation_ui_panel",
      {
        sceneId: "scene-ui-panel-detail",
        key: "launch-dashboard",
        partId: "launch-dashboard",
        targetPartId: "screen",
        title: "ORBIT OS",
        subtitle: "Launch controls",
        items: [
          { key: "status", text: "Status: Ready" },
          { key: "battery", text: "Battery 92%" },
        ],
        normalZ: 1,
        offset: 0.06,
        width: 0.88,
        height: 0.46,
        backgroundColor: "#020617",
        textColor: "#bae6fd",
        style: "screen",
        fontSize: 0.075,
      },
      host,
    );
    expect(panel.ok).toBe(true);
    expect(panel.data).toMatchObject({
      sceneId: "scene-ui-panel-detail",
      objectId: "object-scene-ui-panel-detail-launch-dashboard",
      partId: "launch-dashboard",
      renderObjectId: "obj-scene-ui-panel-detail-launch-dashboard",
      assetId: "asset-scene-ui-panel-detail-launch-dashboard",
      materialId: "mat-scene-ui-panel-detail-launch-dashboard",
      rowObjectIds: [
        "object-scene-ui-panel-detail-launch-dashboard-orbit-os",
        "object-scene-ui-panel-detail-launch-dashboard-launch-controls",
        "object-scene-ui-panel-detail-launch-dashboard-status",
        "object-scene-ui-panel-detail-launch-dashboard-battery",
      ],
      rowRenderObjectIds: [
        "obj-scene-ui-panel-detail-launch-dashboard-orbit-os",
        "obj-scene-ui-panel-detail-launch-dashboard-launch-controls",
        "obj-scene-ui-panel-detail-launch-dashboard-status",
        "obj-scene-ui-panel-detail-launch-dashboard-battery",
      ],
      targetObjectIds: ["object-scene-ui-panel-detail-screen"],
      targetPartIds: ["screen"],
      normal: { x: 0, y: 0, z: 1 },
      offset: 0.06,
      width: 0.88,
      height: 0.46,
    });

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-ui-panel-detail");
    const panelObject = scene?.objects.find(
      (object) => object.id === "object-scene-ui-panel-detail-launch-dashboard",
    );
    expect(panelObject).toMatchObject({
      partId: "launch-dashboard",
      parentId: "object-scene-ui-panel-detail-screen",
      tags: expect.arrayContaining(["ui-panel", "screen-panel", "screen"]),
    });
    expect(scene?.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "object-scene-ui-panel-detail-launch-dashboard-status",
          parentId: "object-scene-ui-panel-detail-launch-dashboard",
          tags: expect.arrayContaining(["ui-panel-text", "text3d"]),
        }),
      ]),
    );
    expect(scene?.renderBindings[0]?.objectBindings).toEqual(
      expect.arrayContaining([
        {
          sceneObjectId: "object-scene-ui-panel-detail-launch-dashboard",
          renderObjectId: "obj-scene-ui-panel-detail-launch-dashboard",
        },
        {
          sceneObjectId: "object-scene-ui-panel-detail-launch-dashboard-status",
          renderObjectId: "obj-scene-ui-panel-detail-launch-dashboard-status",
        },
      ]),
    );

    const panelAsset = host
      .getProject()
      .creation?.assets.find(
        (asset) => asset.id === "asset-scene-ui-panel-detail-launch-dashboard",
      );
    expect(panelAsset?.parameters).toMatchObject({
      uiPanel: {
        source: "agent-ui-panel",
        style: "screen",
        targetObjectIds: ["object-scene-ui-panel-detail-screen"],
        targetPartIds: ["screen"],
        normal: { x: 0, y: 0, z: 1 },
        offset: 0.06,
        width: 0.88,
        height: 0.46,
        rowObjectIds: [
          "object-scene-ui-panel-detail-launch-dashboard-orbit-os",
          "object-scene-ui-panel-detail-launch-dashboard-launch-controls",
          "object-scene-ui-panel-detail-launch-dashboard-status",
          "object-scene-ui-panel-detail-launch-dashboard-battery",
        ],
        rowAssetIds: [
          "asset-scene-ui-panel-detail-launch-dashboard-orbit-os",
          "asset-scene-ui-panel-detail-launch-dashboard-launch-controls",
          "asset-scene-ui-panel-detail-launch-dashboard-status",
          "asset-scene-ui-panel-detail-launch-dashboard-battery",
        ],
        title: "ORBIT OS",
        subtitle: "Launch controls",
        backgroundColor: "#020617",
        textColor: "#bae6fd",
        opacity: 0.86,
        editable: true,
        bakeTarget: "ui-texture-atlas",
      },
    });
    expect(panelAsset?.nodes.some((node) => node.type === "decal")).toBe(true);
    expect(panelAsset?.caches[0]?.status).toBe("dirty");

    const rowAsset = host
      .getProject()
      .creation?.assets.find(
        (asset) => asset.id === "asset-scene-ui-panel-detail-launch-dashboard-status",
      );
    expect(rowAsset?.parameters).toMatchObject({
      uiPanelText: {
        source: "agent-ui-panel-text",
        panelObjectId: "object-scene-ui-panel-detail-launch-dashboard",
        panelAssetId: "asset-scene-ui-panel-detail-launch-dashboard",
        rowKey: "status",
        text: "Status: Ready",
        color: "#bae6fd",
      },
    });

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-ui-panel-detail")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    const renderPanel = layer?.objects?.find(
      (object) => object.id === "obj-scene-ui-panel-detail-launch-dashboard",
    );
    expect(renderPanel).toMatchObject({
      object: { kind: "plane" },
      material: {
        color: "#020617",
        emissive: "#020617",
        emissiveIntensity: 0.55,
      },
      opacity: 0.86,
      transform3d: {
        position: { x: 0, y: 0, z: 0.15 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 0.88, y: 0.46, z: 1 },
      },
    });
    const renderRow = layer?.objects?.find(
      (object) => object.id === "obj-scene-ui-panel-detail-launch-dashboard-status",
    );
    expect(renderRow).toMatchObject({
      object: { kind: "text3d", text: "Status: Ready", extrude: 0.01 },
      material: { color: "#bae6fd", emissive: "#bae6fd" },
    });

    const inspected = await executeTool(
      "inspect_creation_product_parts",
      { sceneId: "scene-ui-panel-detail", partIds: ["launch-dashboard"] },
      host,
    );
    expect(inspected.ok).toBe(true);
    const inspectedPart = (inspected.data as {
      parts: Array<{ recipeFeatures: { uiPanel?: unknown } }>;
    }).parts[0];
    expect(inspectedPart.recipeFeatures.uiPanel).toBeTruthy();

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-ui-panel-detail" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredLayer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-ui-panel-detail")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      recoveredLayer?.objects?.find(
        (object) => object.id === "obj-scene-ui-panel-detail-launch-dashboard",
      ),
    ).toMatchObject({
      object: { kind: "plane" },
      material: { color: "#020617", emissive: "#020617" },
      opacity: 0.86,
    });
    expect(
      recoveredLayer?.objects?.find(
        (object) => object.id === "obj-scene-ui-panel-detail-launch-dashboard-status",
      ),
    ).toMatchObject({
      object: { kind: "text3d", text: "Status: Ready" },
      material: { color: "#bae6fd", emissive: "#bae6fd" },
    });
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("scatters semantic creation objects and recovers render bindings", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-scatter-detail",
        compositionId: "comp-scatter-detail",
        layerId: "layer-scatter-detail",
        name: "Scatter Terrain Detail",
        duration: 3,
        environment: "dark",
        objects: [
          {
            key: "rock",
            partId: "rock",
            kind: "sphere",
            name: "Lunar rock",
            x: 0,
            y: 0.03,
            z: 0,
            scaleX: 0.12,
            scaleY: 0.07,
            scaleZ: 0.1,
            color: "#b8b2a6",
            roughness: 0.92,
            materialModel: "procedural",
            tags: ["terrain-detail", "rock"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const scatter = await executeTool(
      "scatter_creation_objects",
      {
        sceneId: "scene-scatter-detail",
        sourcePartId: "rock",
        key: "pebbles",
        count: 4,
        pattern: "grid",
        columns: 2,
        spacingX: 0.8,
        spacingZ: 0.4,
        namePrefix: "Pebble",
        tags: ["moon-field"],
      },
      host,
    );
    expect(scatter.ok).toBe(true);
    expect(scatter.data).toMatchObject({
      sceneId: "scene-scatter-detail",
      sourceObjectId: "object-scene-scatter-detail-rock",
      sourcePartId: "rock",
      sourceAssetId: "asset-scene-scatter-detail-rock",
      groupId: "scatter-scene-scatter-detail-pebbles",
      pattern: "grid",
      count: 4,
      objectIds: [
        "object-scene-scatter-detail-pebbles-1",
        "object-scene-scatter-detail-pebbles-2",
        "object-scene-scatter-detail-pebbles-3",
        "object-scene-scatter-detail-pebbles-4",
      ],
      renderObjectIds: [
        "obj-scene-scatter-detail-pebbles-1",
        "obj-scene-scatter-detail-pebbles-2",
        "obj-scene-scatter-detail-pebbles-3",
        "obj-scene-scatter-detail-pebbles-4",
      ],
    });
    expect((scatter.data as { operationIds: string[] }).operationIds).toHaveLength(2);

    const scene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === "scene-scatter-detail");
    expect(scene?.objects).toHaveLength(5);
    expect(scene?.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "object-scene-scatter-detail-pebbles-1",
          assetId: "asset-scene-scatter-detail-rock",
          partId: "pebbles-1",
          transform: {
            position: { x: -0.4, y: 0.03, z: -0.2 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 0.12, y: 0.07, z: 0.1 },
          },
          tags: expect.arrayContaining(["scatter-instance", "grid", "moon-field"]),
        }),
        expect.objectContaining({
          id: "object-scene-scatter-detail-pebbles-4",
          transform: expect.objectContaining({
            position: { x: 0.4, y: 0.03, z: 0.2 },
          }),
        }),
      ]),
    );
    expect(scene?.renderBindings[0]?.objectBindings).toEqual(
      expect.arrayContaining([
        {
          sceneObjectId: "object-scene-scatter-detail-pebbles-1",
          renderObjectId: "obj-scene-scatter-detail-pebbles-1",
        },
        {
          sceneObjectId: "object-scene-scatter-detail-pebbles-4",
          renderObjectId: "obj-scene-scatter-detail-pebbles-4",
        },
      ]),
    );

    const sourceAsset = host
      .getProject()
      .creation?.assets.find((asset) => asset.id === "asset-scene-scatter-detail-rock");
    expect(sourceAsset?.parameters.scatterGroup).toMatchObject({
      source: "agent-scatter",
      groupId: "scatter-scene-scatter-detail-pebbles",
      sourceObjectId: "object-scene-scatter-detail-rock",
      sourcePartId: "rock",
      pattern: "grid",
      count: 4,
      instanceObjectIds: [
        "object-scene-scatter-detail-pebbles-1",
        "object-scene-scatter-detail-pebbles-2",
        "object-scene-scatter-detail-pebbles-3",
        "object-scene-scatter-detail-pebbles-4",
      ],
      spacingX: 0.8,
      spacingZ: 0.4,
    });
    expect(
      (sourceAsset?.parameters.scatterGroup as { transforms?: unknown[] } | undefined)
        ?.transforms,
    ).toHaveLength(4);
    expect(sourceAsset?.nodes.some((node) => node.type === "scatter")).toBe(true);
    expect(sourceAsset?.caches[0]?.status).toBe("dirty");

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-scatter-detail")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      layer?.objects?.find((object) => object.id === "obj-scene-scatter-detail-pebbles-1"),
    ).toMatchObject({
      object: { kind: "sphere" },
      material: { color: "#b8b2a6", roughness: 0.92 },
      transform3d: {
        position: { x: -0.4, y: 0.03, z: -0.2 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 0.12, y: 0.07, z: 0.1 },
      },
    });

    const inspected = await executeTool(
      "inspect_creation_product_parts",
      { sceneId: "scene-scatter-detail", partIds: ["pebbles-1"] },
      host,
    );
    expect(inspected.ok).toBe(true);
    const inspectedPart = (inspected.data as {
      parts: Array<{ recipeFeatures: { scatterGroup?: unknown } }>;
    }).parts[0];
    expect(inspectedPart.recipeFeatures.scatterGroup).toBeTruthy();

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-scatter-detail" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recovered = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-scatter-detail")
      ?.layers.find((candidate) => candidate.type === "scene3d")
      ?.objects?.find((object) => object.id === "obj-scene-scatter-detail-pebbles-1");
    expect(recovered).toMatchObject({
      object: { kind: "sphere" },
      material: { color: "#b8b2a6" },
      transform3d: {
        position: { x: -0.4, y: 0.03, z: -0.2 },
      },
    });
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("inspects product parts with materials, bindings, recipe features, and animations", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-inspect-parts",
        compositionId: "comp-inspect-parts",
        layerId: "layer-inspect-parts",
        name: "Inspectable Product Parts",
        duration: 3,
        objects: [
          {
            key: "shell",
            partId: "shell",
            kind: "rounded-box",
            name: "Outer shell",
            x: -0.25,
            y: 0,
            z: 0,
            color: "#94a3b8",
            materialModel: "metal",
            tags: ["product-part", "shell"],
          },
          {
            key: "chip",
            partId: "chip",
            kind: "box",
            name: "A-series chip",
            x: 0.25,
            y: 0,
            z: 0,
            color: "#111827",
            materialModel: "pbr",
            tags: ["product-part", "internal", "chip"],
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    expect(
      (
        await executeTool(
          "apply_creation_material_preset",
          {
            sceneId: "scene-inspect-parts",
            objectId: "object-scene-inspect-parts-chip",
            presetId: "silicon-chip",
          },
          host,
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await executeTool(
          "apply_creation_xray_material",
          {
            sceneId: "scene-inspect-parts",
            partIds: ["shell"],
            tint: "#67e8f9",
            opacity: 0.3,
          },
          host,
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await executeTool(
          "animate_creation_exploded_view",
          {
            sceneId: "scene-inspect-parts",
            partIds: ["shell", "chip"],
            axis: "z",
            distance: 1,
            duration: 0.75,
          },
          host,
        )
      ).ok,
    ).toBe(true);

    const inspected = await executeTool(
      "inspect_creation_product_parts",
      { sceneId: "scene-inspect-parts" },
      host,
    );
    expect(inspected.ok).toBe(true);
    const data = inspected.data as {
      partCount: number;
      objectIdsByPartId: Record<string, string>;
      renderObjectIdsByPartId: Record<string, string>;
      parts: Array<{
        objectId: string;
        partId?: string;
        asset?: {
          assetId: string;
          kind: string;
          nodeTypes: string[];
          cacheStatus: { dirty: number };
        };
        material?: {
          materialId: string;
          model: string;
          baseColor: string;
          opacity?: number;
          presetId?: string;
          xrayMaterial?: unknown;
        };
        renderBinding?: {
          compositionId: string;
          layerId: string;
          renderObjectId: string;
        };
        recipeFeatures: {
          explodedView?: unknown;
          xrayMaterial?: unknown;
          materialPresetId?: unknown;
        };
        animations: Array<{
          clipId: string;
          channels: string[];
          keyframeCount: number;
        }>;
      }>;
    };
    expect(data.partCount).toBe(2);
    expect(data.objectIdsByPartId).toMatchObject({
      shell: "object-scene-inspect-parts-shell",
      chip: "object-scene-inspect-parts-chip",
    });
    expect(data.renderObjectIdsByPartId).toMatchObject({
      shell: "obj-scene-inspect-parts-shell",
      chip: "obj-scene-inspect-parts-chip",
    });
    const shell = data.parts.find((part) => part.partId === "shell");
    const chip = data.parts.find((part) => part.partId === "chip");
    expect(shell?.asset).toMatchObject({
      assetId: "asset-scene-inspect-parts-shell",
      kind: "prop",
    });
    expect(shell?.asset?.nodeTypes).toContain("material");
    expect(shell?.asset?.nodeTypes).toContain("deform");
    expect(shell?.material).toMatchObject({
      materialId: "mat-scene-inspect-parts-shell",
      model: "glass",
      baseColor: "#67e8f9",
      opacity: 0.3,
    });
    expect(shell?.material?.xrayMaterial).toBeTruthy();
    expect(shell?.recipeFeatures.xrayMaterial).toBeTruthy();
    expect(shell?.recipeFeatures.explodedView).toBeTruthy();
    expect(shell?.renderBinding).toMatchObject({
      compositionId: "comp-inspect-parts",
      layerId: "layer-inspect-parts",
      renderObjectId: "obj-scene-inspect-parts-shell",
    });
    expect(shell?.animations[0]).toMatchObject({
      clipId: "anim-scene-inspect-parts-exploded-view",
      channels: ["position"],
      keyframeCount: 2,
    });
    expect(chip?.material).toMatchObject({
      materialId: "mat-scene-inspect-parts-chip",
      presetId: "silicon-chip",
      baseColor: "#111827",
    });
    expect(chip?.recipeFeatures.materialPresetId).toBe("silicon-chip");
    expect(chip?.recipeFeatures.explodedView).toBeTruthy();

    const filtered = await executeTool(
      "inspect_creation_product_parts",
      { sceneId: "scene-inspect-parts", partIds: ["chip"] },
      host,
    );
    expect(filtered.ok).toBe(true);
    expect((filtered.data as { partCount: number; parts: Array<{ partId?: string }> }).partCount).toBe(1);
    expect((filtered.data as { parts: Array<{ partId?: string }> }).parts[0]?.partId).toBe("chip");
  });

  it("syncs persisted creation scenes back into renderable Motion scene3d layers", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-sync-recovery",
        compositionId: "comp-original-sync",
        layerId: "layer-original-sync",
        name: "Recovered Agent Scene",
        duration: 3.5,
        creationEnvironment: "stage",
        backgroundColor: "#111827",
        camera: { posX: 0, posY: 2.2, posZ: 7, targetX: 0, targetY: 0, targetZ: 0, fov: 32 },
        objects: [
          {
            key: "panel",
            kind: "rounded-box",
            name: "Floating product panel",
            x: -0.35,
            y: 0.2,
            z: 0,
            size: 0.5,
            depth: 0.08,
            aspect: 0.62,
            cornerRadius: 0.08,
            color: "#14b8a6",
            roughness: 0.32,
            materialModel: "plastic",
          },
          {
            key: "label",
            kind: "text3d",
            name: "Panel label",
            text: "OPENREEL",
            x: 0.32,
            y: 0.26,
            z: 0.12,
            size: 0.24,
            extrude: 0.04,
            color: "#f8fafc",
            materialModel: "emissive",
            emissive: "#99f6e4",
            emissiveIntensity: 1.4,
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const animated = await executeTool(
      "animate_creation_object",
      {
        sceneId: "scene-sync-recovery",
        objectId: "object-scene-sync-recovery-panel",
        rotation: [
          { time: 0, x: 0, y: -12, z: 0 },
          { time: 1.2, x: 0, y: 18, z: 20, easing: "ease-in-out" },
        ],
      },
      host,
    );
    expect(animated.ok).toBe(true);

    const projectWithoutRender = structuredClone(host.getProject());
    const creation = projectWithoutRender.creation;
    expect(creation).toBeTruthy();
    host.setProject({
      ...projectWithoutRender,
      creation: {
        ...creation!,
        scenes: creation!.scenes.map((scene) =>
          scene.id === "scene-sync-recovery"
            ? { ...scene, renderBindings: [] }
            : scene,
        ),
      },
      motionCompositions: [],
      motionInstances: [],
      timeline: {
        ...projectWithoutRender.timeline,
        tracks: [],
      },
    });

    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      {
        sceneId: "scene-sync-recovery",
        compositionId: "comp-recovered-sync",
        layerId: "layer-recovered-sync",
        insertIntoEditor: true,
        insertStartTime: 0.25,
        insertName: "Recovered Agent Clip",
      },
      host,
    );
    expect(synced.ok).toBe(true);
    const syncData = synced.data as {
      compositionId: string;
      layerId: string;
      createdRenderBinding: boolean;
      createdComposition: boolean;
      repairedLayer: boolean;
      insertedInstanceId?: string;
      insertedClipId?: string;
      renderObjectIdsBySceneObjectId: Record<string, string>;
      missingAssetObjectIds: string[];
    };
    expect(syncData).toMatchObject({
      compositionId: "comp-recovered-sync",
      layerId: "layer-recovered-sync",
      createdRenderBinding: true,
      createdComposition: true,
      repairedLayer: true,
      missingAssetObjectIds: [],
    });
    expect(syncData.renderObjectIdsBySceneObjectId).toMatchObject({
      "object-scene-sync-recovery-panel": "obj-scene-sync-recovery-panel",
      "object-scene-sync-recovery-label": "obj-scene-sync-recovery-label",
    });
    expect(syncData.insertedInstanceId).toMatch(/^motion-instance-/);
    expect(syncData.insertedClipId).toBe(`motion-clip-${syncData.insertedInstanceId}`);

    const recoveredScene = host
      .getProject()
      .creation?.scenes.find((scene) => scene.id === "scene-sync-recovery");
    expect(recoveredScene?.renderBindings[0]).toMatchObject({
      kind: "motion-scene3d",
      compositionId: "comp-recovered-sync",
      layerId: "layer-recovered-sync",
      objectBindings: [
        {
          sceneObjectId: "object-scene-sync-recovery-panel",
          renderObjectId: "obj-scene-sync-recovery-panel",
        },
        {
          sceneObjectId: "object-scene-sync-recovery-label",
          renderObjectId: "obj-scene-sync-recovery-label",
        },
      ],
    });
    const recoveredComposition = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-recovered-sync");
    const recoveredLayer = recoveredComposition?.layers.find(
      (layer) => layer.id === "layer-recovered-sync" && layer.type === "scene3d",
    );
    expect(recoveredLayer?.type).toBe("scene3d");
    const recoveredObjects = recoveredLayer?.type === "scene3d" ? recoveredLayer.objects ?? [] : [];
    expect(recoveredObjects.map((object) => object.id)).toEqual([
      "obj-scene-sync-recovery-panel",
      "obj-scene-sync-recovery-label",
    ]);
    expect(recoveredObjects[0]).toMatchObject({
      object: {
        kind: "rounded-box",
        size: 0.5,
        depth: 0.08,
        aspect: 0.62,
        cornerRadius: 0.08,
      },
      material: {
        color: "#14b8a6",
        roughness: 0.32,
      },
      transform3d: {
        position: { x: -0.35, y: 0.2, z: 0 },
      },
    });
    expect(recoveredObjects[1]).toMatchObject({
      object: {
        kind: "text3d",
        text: "OPENREEL",
        size: 0.24,
        extrude: 0.04,
      },
      material: {
        emissive: "#99f6e4",
        emissiveIntensity: 1.4,
      },
    });
    expect(
      recoveredLayer?.keyframes
        .filter(
          (keyframe) =>
            keyframe.property ===
            "scene.object.obj-scene-sync-recovery-panel.rotation.z",
        )
        .map((keyframe) => keyframe.value),
    ).toEqual([0, 20]);
    expect(host.getProject().motionInstances?.[0]).toMatchObject({
      id: syncData.insertedInstanceId,
      compositionId: "comp-recovered-sync",
      name: "Recovered Agent Clip",
      startTime: 0.25,
      duration: 3.5,
    });
    expect(host.getProject().timeline.tracks[0]?.clips[0]).toMatchObject({
      id: syncData.insertedClipId,
      metadata: {
        motionInstanceId: syncData.insertedInstanceId,
        motionCompositionId: "comp-recovered-sync",
      },
    });
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("animates semantic creation cameras and rebuilds camera keyframes during sync", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-camera-orbit",
        compositionId: "comp-camera-orbit",
        layerId: "layer-camera-orbit",
        name: "Camera Orbit Scene",
        duration: 3,
        camera: {
          id: "camera-main",
          name: "Main camera",
          posX: 0,
          posY: 2,
          posZ: 6,
          targetX: 0,
          targetY: 0,
          targetZ: 0,
          fov: 40,
        },
        objects: [
          {
            key: "hero",
            kind: "sphere",
            name: "Hero subject",
            color: "#facc15",
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const animated = await executeTool(
      "animate_creation_camera",
      {
        sceneId: "scene-camera-orbit",
        cameraId: "camera-main",
        mode: "orbit",
        clipId: "anim-camera-hero-orbit",
        name: "Hero camera orbit",
        startTime: 0,
        endTime: 2,
        targetX: 0,
        targetY: 0,
        targetZ: 0,
        orbitDegrees: 90,
        radiusStart: 6,
        radiusEnd: 3,
        height: 2,
        fovStart: 40,
        fovEnd: 28,
        samples: 5,
      },
      host,
    );
    expect(animated.ok).toBe(true);
    const animatedData = animated.data as {
      channels: string[];
      renderKeyframeCount: number;
    };
    expect(animatedData.channels).toEqual([
      "camera.position",
      "camera.target",
      "camera.fov",
    ]);
    expect(animatedData.renderKeyframeCount).toBe(23);

    const cameraScene = host
      .getProject()
      .creation?.scenes.find((scene) => scene.id === "scene-camera-orbit");
    const cameraClip = cameraScene?.animations.find(
      (clip) => clip.id === "anim-camera-hero-orbit",
    );
    expect(cameraClip?.tracks.map((track) => track.channel)).toEqual([
      "camera.position",
      "camera.target",
      "camera.fov",
    ]);
    expect(cameraScene?.activeCameraId).toBe("camera-main");
    expect(cameraScene?.cameras[0]).toMatchObject({
      id: "camera-main",
      name: "Main camera",
    });
    expect(cameraClip?.tracks[0]?.targetId).toBe("camera-main");
    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-camera-orbit")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      layer?.keyframes
        .filter((keyframe) => keyframe.property === "scene.camera.fov")
        .map((keyframe) => keyframe.value),
    ).toEqual([40, 28]);
    const cameraXValues = layer?.keyframes
      .filter((keyframe) => keyframe.property === "scene.camera.position.x")
      .map((keyframe) => keyframe.value);
    expect(cameraXValues).toHaveLength(5);
    expect(cameraXValues?.[0]).toBeCloseTo(0, 5);
    expect(cameraXValues?.[4]).toBeCloseTo(-3, 5);

    const projectWithoutComposition = structuredClone(host.getProject());
    host.setProject({
      ...projectWithoutComposition,
      motionCompositions: [],
    });
    const synced = await executeTool(
      "sync_creation_scene_to_motion",
      { sceneId: "scene-camera-orbit" },
      host,
    );
    expect(synced.ok).toBe(true);
    const recoveredLayer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === "comp-camera-orbit")
      ?.layers.find((candidate) => candidate.type === "scene3d");
    expect(
      recoveredLayer?.keyframes
        .filter((keyframe) => keyframe.property === "scene.camera.fov")
        .map((keyframe) => keyframe.value),
    ).toEqual([40, 28]);
    expect(
      recoveredLayer?.keyframes
        .filter((keyframe) => keyframe.property === "scene.camera.position.x")
        .map((keyframe) => keyframe.value),
    ).toHaveLength(5);
    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("creates product cinematics and exposes persisted creation state", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_product_cinematic_scene",
      {
        name: "Agent Product Reveal",
        duration: 5,
        includeInternals: true,
        insertIntoEditor: true,
        insertStartTime: 1.25,
        insertName: "Product Reveal Timeline Clip",
      },
      host,
    );
    expect(created.ok).toBe(true);
    const createdData = created.data as {
      compositionId: string;
      insertedInstanceId?: string;
      insertedClipId?: string;
    };
    expect(createdData.insertedInstanceId).toMatch(/^motion-instance-/);
    expect(createdData.insertedClipId).toBe(`motion-clip-${createdData.insertedInstanceId}`);

    const editorState = (await executeTool("get_editor_state", {}, host)).data as EditorStateView;
    expect(editorState.trackCount).toBe(1);
    expect(editorState.clipCount).toBe(1);
    expect(editorState.durationSec).toBe(6.25);
    expect(editorState.creation).toMatchObject({
      assetCount: 1,
      sceneCount: 1,
      operationCount: 3,
    });
    expect(host.getProject().motionInstances?.[0]).toMatchObject({
      id: createdData.insertedInstanceId,
      compositionId: createdData.compositionId,
      name: "Product Reveal Timeline Clip",
      startTime: 1.25,
      duration: 5,
    });
    expect(host.getProject().timeline.tracks[0]?.clips[0]).toMatchObject({
      id: createdData.insertedClipId,
      startTime: 1.25,
      duration: 5,
      metadata: {
        motionInstanceId: createdData.insertedInstanceId,
        motionCompositionId: createdData.compositionId,
      },
    });

    const assets = (await executeTool("list_creation_assets", {}, host)).data as {
      assets: Array<{ id: string; kind: string; nodeCount: number }>;
    };
    expect(assets.assets[0]).toMatchObject({
      id: "asset-phone-product",
      kind: "product",
    });
    expect(assets.assets[0]?.nodeCount).toBeGreaterThan(5);

    const scenes = (await executeTool("list_creation_scenes", {}, host)).data as {
      scenes: Array<{ id: string; active: boolean; objectCount: number }>;
    };
    expect(scenes.scenes[0]).toMatchObject({
      id: "scene-product-phone-cinematic",
      active: true,
    });
    expect(scenes.scenes[0]?.objectCount).toBeGreaterThan(10);

    const scene = (await executeTool("get_creation_scene", {}, host)).data as {
      scene?: { objects: Array<{ partId?: string }> };
    };
    expect(scene.scene?.objects.some((object) => object.partId === "part-a-chip")).toBe(true);

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);

    const addedCallout = await executeTool(
      "add_creation_product_callout",
      {
        sceneId: "scene-product-phone-cinematic",
        partId: "part-a-chip",
        label: "Neural engine",
        offsetX: 390,
        offsetY: -150,
        revealTime: 1.4,
      },
      host,
    );
    expect(addedCallout.ok).toBe(true);
    const addedCalloutData = addedCallout.data as {
      layerId: string;
      targetObjectId?: string;
      calloutLayerIds: string[];
    };
    expect(addedCalloutData.targetObjectId).toBe("object-part-a-chip");
    expect(addedCalloutData.calloutLayerIds).toContain(addedCalloutData.layerId);
    expect(host.getProject().creation?.operationHistory).toHaveLength(4);
    const calloutScene = host.getProject().creation?.scenes[0];
    expect(calloutScene?.renderBindings[0]?.calloutLayerIds).toContain(
      addedCalloutData.layerId,
    );
    const calloutLayer = host
      .getProject()
      .motionCompositions?.[0]?.layers.find(
        (layer) => layer.id === addedCalloutData.layerId,
      );
    expect(calloutLayer).toMatchObject({
      type: "text",
      text: "Neural engine",
      transform: {
        position: { x: 1350, y: 390 },
      },
    });
    expect(calloutLayer?.keyframes.some((keyframe) => keyframe.time === 1.4)).toBe(true);

    const beforeLayer = host
      .getProject()
      .motionCompositions?.[0]?.layers.find((layer) => layer.type === "scene3d");
    const beforeKeyframe = beforeLayer?.keyframes.find(
      (keyframe) =>
        keyframe.property === "scene.object.obj-part-a-chip.position.x" &&
        keyframe.time === 0,
    );
    expect(typeof beforeKeyframe?.value).toBe("number");

    const edited = await executeTool(
      "set_creation_object_transform",
      {
        objectId: "object-part-a-chip",
        position: { x: 1.12, y: 0.44, z: 0.03 },
      },
      host,
    );
    expect(edited.ok).toBe(true);

    const editedScene = host.getProject().creation?.scenes[0];
    const editedObject = editedScene?.objects.find(
      (object) => object.id === "object-part-a-chip",
    );
    expect(editedObject?.transform.position.x).toBe(1.12);
    expect(host.getProject().creation?.operationHistory).toHaveLength(5);

    const afterLayer = host
      .getProject()
      .motionCompositions?.[0]?.layers.find((layer) => layer.type === "scene3d");
    const renderedObject = afterLayer?.objects?.find(
      (object) => object.id === "obj-part-a-chip",
    );
    expect(renderedObject?.transform3d?.position?.x).toBe(1.12);
    const afterKeyframe = afterLayer?.keyframes.find(
      (keyframe) =>
        keyframe.property === "scene.object.obj-part-a-chip.position.x" &&
        keyframe.time === 0,
    );
    expect(afterKeyframe?.value).toBeCloseTo((beforeKeyframe?.value as number) + 1);

    const materialEdited = await executeTool(
      "set_creation_object_material",
      {
        objectId: "object-part-a-chip",
        color: "#ffcc00",
        roughness: 0.18,
        emissive: "#332200",
        emissiveIntensity: 0.4,
      },
      host,
    );
    expect(materialEdited.ok).toBe(true);
    const editedAsset = host.getProject().creation?.assets[0];
    const chipMaterial = editedAsset?.materials.find((material) => material.id === "mat-chip");
    expect(chipMaterial).toMatchObject({
      baseColor: "#ffcc00",
      roughness: 0.18,
      emissive: "#332200",
      emissiveIntensity: 0.4,
    });
    expect(host.getProject().creation?.operationHistory).toHaveLength(7);
    const materialLayer = host
      .getProject()
      .motionCompositions?.[0]?.layers.find((layer) => layer.type === "scene3d");
    const materialRenderObject = materialLayer?.objects?.find(
      (object) => object.id === "obj-part-a-chip",
    );
    expect(materialRenderObject?.material).toMatchObject({
      color: "#ffcc00",
      roughness: 0.18,
      emissive: "#332200",
      emissiveIntensity: 0.4,
    });

    const beforeCameraLayer = host
      .getProject()
      .motionCompositions?.[0]?.layers.find((layer) => layer.type === "scene3d");
    const beforeCameraKeyframe = beforeCameraLayer?.keyframes.find(
      (keyframe) => keyframe.property === "scene.camera.position.z" && keyframe.time === 0,
    );
    expect(typeof beforeCameraKeyframe?.value).toBe("number");

    const cameraEdited = await executeTool(
      "set_creation_camera",
      {
        posX: 1.1,
        posY: 0.9,
        posZ: 7.4,
        targetX: 0.15,
        targetY: 0.05,
        targetZ: 0,
        fov: 30,
      },
      host,
    );
    expect(cameraEdited.ok).toBe(true);
    const editedCamera = host.getProject().creation?.scenes[0]?.cameras[0];
    expect(editedCamera?.position).toEqual({ x: 1.1, y: 0.9, z: 7.4 });
    expect(editedCamera?.target).toEqual({ x: 0.15, y: 0.05, z: 0 });
    expect(editedCamera?.fov).toBe(30);
    expect(host.getProject().creation?.operationHistory).toHaveLength(8);

    const afterCameraLayer = host
      .getProject()
      .motionCompositions?.[0]?.layers.find((layer) => layer.type === "scene3d");
    expect(afterCameraLayer?.camera?.position).toEqual({ x: 1.1, y: 0.9, z: 7.4 });
    expect(afterCameraLayer?.camera?.target).toEqual({ x: 0.15, y: 0.05, z: 0 });
    expect(afterCameraLayer?.camera?.fov).toBe(30);
    expect(afterCameraLayer?.fov).toBe(30);
    const afterCameraKeyframe = afterCameraLayer?.keyframes.find(
      (keyframe) => keyframe.property === "scene.camera.position.z" && keyframe.time === 0,
    );
    expect(afterCameraKeyframe?.value).toBeCloseTo(
      (beforeCameraKeyframe?.value as number) + 2.6,
    );

    const objectAnimated = await executeTool(
      "animate_creation_object",
      {
        objectId: "object-part-a-chip",
        position: [
          { time: 0, x: 1.12, y: 0.44, z: 0.03, easing: "ease-out" },
          { time: 1, x: 1.4, y: 0.7, z: 0.4, easing: "ease-in-out" },
        ],
        opacity: [
          { time: 0, value: 1 },
          { time: 1, value: 0.65, easing: "ease-in" },
        ],
      },
      host,
    );
    expect(objectAnimated.ok).toBe(true);
    const animationScene = host.getProject().creation?.scenes[0];
    const animationClip = animationScene?.animations.find(
      (clip) => clip.id === "anim-object-part-a-chip-agent-motion",
    );
    expect(animationClip?.tracks.map((track) => track.channel)).toEqual(
      expect.arrayContaining(["position", "opacity"]),
    );
    expect(
      animationClip?.tracks.find((track) => track.channel === "position")?.targetId,
    ).toBe("object-part-a-chip");
    expect(host.getProject().creation?.operationHistory).toHaveLength(9);

    const animatedLayer = host
      .getProject()
      .motionCompositions?.[0]?.layers.find((layer) => layer.type === "scene3d");
    expect(
      animatedLayer?.keyframes
        .filter(
          (keyframe) =>
            keyframe.property === "scene.object.obj-part-a-chip.position.x",
        )
        .map((keyframe) => keyframe.value),
    ).toEqual([1.12, 1.4]);
    expect(
      animatedLayer?.keyframes
        .filter(
          (keyframe) => keyframe.property === "scene.object.obj-part-a-chip.opacity",
        )
        .map((keyframe) => keyframe.value),
    ).toEqual([1, 0.65]);
  });

  it("adds and validates motion layer animation keyframes", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool("create_motion_composition", {}, host);
    const compositionId = (created.data as { compositionId: string }).compositionId;
    const added = await executeTool(
      "add_motion_layer",
      { compositionId, type: "shape", name: "Card" },
      host,
    );
    const layerId = (added.data as { layerId: string }).layerId;

    const animated = await executeTool(
      "animate_layer",
      {
        compositionId,
        layerId,
        property: "transform.position.x",
        from: 100,
        to: 500,
        startTime: 0,
        endTime: 1,
      },
      host,
    );
    expect(animated.ok).toBe(true);

    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === compositionId)
      ?.layers.find((candidate) => candidate.id === layerId);
    expect(
      layer?.keyframes
        .filter((keyframe) => keyframe.property === "transform.position.x")
        .map((keyframe) => keyframe.value),
    ).toEqual([100, 500]);

    const invalid = await executeTool(
      "animate_layer",
      {
        compositionId,
        layerId,
        property: "text.content",
        from: "a",
        to: "b",
      },
      host,
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.error?.code).toBe("INVALID_PARAMS");
  });

  it("generates variable-driven motion ad scenes", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const generated = await executeTool(
      "generate_ad_scene",
      {
        headline: "Ship motion ads",
        subheadline: "Create launch videos from product screens",
        ctaText: "Try OpenReel",
        brandColor: "#22c55e",
        duration: 8,
        intensity: 0.9,
      },
      host,
    );
    expect(generated.ok).toBe(true);

    const composition = host.getProject().motionCompositions?.[0];
    expect(composition?.variables.map((variable) => variable.name)).toEqual(
      expect.arrayContaining([
        "Headline",
        "Subheadline",
        "CTA",
        "Brand color",
        "Animation intensity",
      ]),
    );
    expect(composition?.layers.length).toBeGreaterThanOrEqual(5);
    expect(
      composition?.layers.some(
        (layer) => (layer.variableBindings ?? []).length > 0,
      ),
    ).toBe(true);
  });

  it("syncs motion compositions to BPM beat markers", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_motion_composition",
      { duration: 4 },
      host,
    );
    const compositionId = (created.data as { compositionId: string }).compositionId;

    const synced = await executeTool(
      "sync_motion_to_audio",
      { compositionId, bpm: 120, intensity: 0.8, audioClipId: "audio-1" },
      host,
    );
    expect(synced.ok).toBe(true);

    const composition = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId);
    expect(composition?.beatAnalysis?.bpm).toBe(120);
    expect(composition?.beatAnalysis?.sourceClipId).toBe("audio-1");
    expect(composition?.beatMarkers?.length).toBeGreaterThan(4);
    expect(
      composition?.variables.find((variable) => variable.id === "audio-intensity")
        ?.value,
    ).toBe(0.8);
  });

  async function createComp(host: HeadlessHost): Promise<string> {
    const created = await executeTool("create_motion_composition", {}, host);
    return (created.data as { compositionId: string }).compositionId;
  }

  async function addShape(
    host: HeadlessHost,
    compositionId: string,
    name = "Card",
  ): Promise<string> {
    const added = await executeTool(
      "add_motion_layer",
      { compositionId, layerType: "shape", name },
      host,
    );
    return (added.data as { layerId: string }).layerId;
  }

  it("keeps legacy motion 3D scene tools backed by editable creation state", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);

    const created = await executeTool(
      "add_motion_3d_scene",
      {
        compositionId,
        sceneId: "scene-legacy-moon",
        name: "Legacy Moon Flag",
        duration: 6,
        environment: "dark",
        groundShadow: true,
        objects: [
          {
            key: "moon",
            kind: "sphere",
            name: "Moon surface",
            y: -0.45,
            scaleX: 3,
            scaleY: 0.32,
            scaleZ: 3,
            color: "#d6d3c8",
            materialModel: "procedural",
            tags: ["terrain", "moon"],
          },
          {
            key: "flag",
            kind: "plane",
            name: "Ghana flag",
            x: 0.7,
            y: 0.45,
            z: 0.1,
            scaleX: 0.9,
            scaleY: 0.5,
            scaleZ: 1,
            color: "#facc15",
            materialModel: "fabric",
            tags: ["flag", "ghana"],
          },
        ],
        camera: { posX: 0, posY: 1.8, posZ: 7, targetX: 0, targetY: 0, targetZ: 0 },
      },
      host,
    );
    expect(created.ok).toBe(true);
    const createdData = created.data as {
      sceneId: string;
      layerId: string;
      objectIds: string[];
      objectIdsByKey: Record<string, string>;
      renderObjectIdsByKey: Record<string, string>;
    };
    expect(createdData.sceneId).toBe("scene-legacy-moon");
    expect(createdData.objectIdsByKey.flag).toBe("object-scene-legacy-moon-flag");
    expect(createdData.renderObjectIdsByKey.flag).toBe(createdData.objectIds[1]);

    const scene = host.getProject().creation?.scenes.find((candidate) => candidate.id === createdData.sceneId);
    expect(scene?.objects.map((object) => object.id)).toEqual([
      "object-scene-legacy-moon-moon",
      "object-scene-legacy-moon-flag",
    ]);
    expect(scene?.renderBindings[0]).toMatchObject({
      compositionId,
      layerId: createdData.layerId,
      objectBindings: [
        {
          sceneObjectId: "object-scene-legacy-moon-moon",
          renderObjectId: createdData.renderObjectIdsByKey.moon,
        },
        {
          sceneObjectId: "object-scene-legacy-moon-flag",
          renderObjectId: createdData.renderObjectIdsByKey.flag,
        },
      ],
    });
    expect(host.getProject().creation?.assets).toHaveLength(2);

    const added = await executeTool(
      "add_scene_object",
      {
        compositionId,
        layerId: createdData.layerId,
        key: "pole",
        kind: "cylinder",
        name: "Flag pole",
        x: 0.42,
        y: 0.05,
        z: 0.08,
        scaleX: 0.04,
        scaleY: 1.4,
        scaleZ: 0.04,
        color: "#e5e7eb",
        materialModel: "metal",
      },
      host,
    );
    expect(added.ok).toBe(true);
    const addedData = added.data as {
      objectId: string;
      creationObjectId: string;
      assetId: string;
      renderBindingId: string;
    };
    expect(addedData.creationObjectId).toBe("object-scene-legacy-moon-pole");
    expect(host.getProject().creation?.assets).toHaveLength(3);
    expect(
      host
        .getProject()
        .creation?.scenes.find((candidate) => candidate.id === createdData.sceneId)
        ?.renderBindings[0]?.objectBindings,
    ).toContainEqual({
      sceneObjectId: addedData.creationObjectId,
      renderObjectId: addedData.objectId,
    });

    const objectAnimated = await executeTool(
      "animate_scene_object",
      {
        compositionId,
        layerId: createdData.layerId,
        objectId: addedData.objectId,
        clipId: "anim-legacy-pole-wave",
        rotation: [
          { time: 0, x: 0, y: 0, z: -4 },
          { time: 1, x: 0, y: 0, z: 8, easing: "ease-in-out" },
        ],
        opacity: [
          { time: 0, value: 1 },
          { time: 1, value: 0.8 },
        ],
      },
      host,
    );
    expect(objectAnimated.ok).toBe(true);
    const animatedScene = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === createdData.sceneId);
    const objectClip = animatedScene?.animations.find(
      (clip) => clip.id === "anim-legacy-pole-wave",
    );
    expect(objectClip?.tracks.map((track) => track.channel)).toEqual(
      expect.arrayContaining(["rotation", "opacity"]),
    );
    expect(objectClip?.tracks[0]?.targetId).toBe(addedData.creationObjectId);

    const cameraAnimated = await executeTool(
      "animate_scene_camera",
      {
        compositionId,
        layerId: createdData.layerId,
        clipId: "anim-legacy-camera-orbit",
        position: [
          { time: 0, x: 0, y: 1.8, z: 7 },
          { time: 2, x: 3, y: 1.5, z: 4, easing: "ease-in-out" },
        ],
        target: [
          { time: 0, x: 0, y: 0, z: 0 },
          { time: 2, x: 0.4, y: 0.1, z: 0 },
        ],
        fov: [
          { time: 0, value: 42 },
          { time: 2, value: 28 },
        ],
      },
      host,
    );
    expect(cameraAnimated.ok).toBe(true);
    const cameraClip = host
      .getProject()
      .creation?.scenes.find((candidate) => candidate.id === createdData.sceneId)
      ?.animations.find((clip) => clip.id === "anim-legacy-camera-orbit");
    expect(cameraClip?.tracks.map((track) => track.channel)).toEqual(
      expect.arrayContaining(["camera.position", "camera.target", "camera.fov"]),
    );

    const validation = (await executeTool("validate_creation_state", {}, host)).data as {
      issues: unknown[];
    };
    expect(validation.issues).toEqual([]);
  });

  it("recovers an existing motion-only scene3d layer into creation state", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const created = await executeTool(
      "add_motion_3d_scene",
      {
        compositionId,
        name: "Recovered Existing Scene",
        objects: [
          {
            key: "product",
            kind: "rounded-box",
            name: "Product body",
            scaleX: 1.4,
            scaleY: 0.14,
            scaleZ: 0.8,
            color: "#94a3b8",
          },
          {
            key: "screen",
            kind: "plane",
            name: "Screen glass",
            y: 0.09,
            scaleX: 1.2,
            scaleY: 0.68,
            scaleZ: 1,
            color: "#020617",
            emissive: "#38bdf8",
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);
    const createdData = created.data as {
      layerId: string;
      renderObjectIdsByKey: Record<string, string>;
    };

    const legacyProject = structuredClone(host.getProject());
    host.setProject({ ...legacyProject, creation: undefined });
    expect(host.getProject().creation).toBeUndefined();

    const recovered = await executeTool(
      "recover_motion_scene3d_to_creation",
      {
        compositionId,
        layerId: createdData.layerId,
        sceneId: "scene-recovered-existing",
        name: "Recovered Semantic Scene",
      },
      host,
    );
    expect(recovered.ok).toBe(true);
    const recoveredData = recovered.data as {
      sceneId: string;
      objectIdsByKey: Record<string, string>;
      renderObjectIdsByKey: Record<string, string>;
      objectCount: number;
    };
    expect(recoveredData).toMatchObject({
      sceneId: "scene-recovered-existing",
      objectCount: 2,
      objectIdsByKey: {
        "product-body": "object-scene-recovered-existing-product-body",
        "screen-glass": "object-scene-recovered-existing-screen-glass",
      },
      renderObjectIdsByKey: {
        "product-body": createdData.renderObjectIdsByKey.product,
        "screen-glass": createdData.renderObjectIdsByKey.screen,
      },
    });
    expect(host.getProject().creation?.activeSceneId).toBe("scene-recovered-existing");
    expect(host.getProject().creation?.assets).toHaveLength(2);
    const recoveredScene = host.getProject().creation?.scenes[0];
    expect(recoveredScene?.renderBindings[0]).toMatchObject({
      compositionId,
      layerId: createdData.layerId,
      objectBindings: [
        {
          sceneObjectId: "object-scene-recovered-existing-product-body",
          renderObjectId: createdData.renderObjectIdsByKey.product,
        },
        {
          sceneObjectId: "object-scene-recovered-existing-screen-glass",
          renderObjectId: createdData.renderObjectIdsByKey.screen,
        },
      ],
    });

    const secondRecovery = await executeTool(
      "recover_motion_scene3d_to_creation",
      { compositionId, layerId: createdData.layerId },
      host,
    );
    expect(secondRecovery.ok).toBe(true);
    expect((secondRecovery.data as { alreadyRecovered: boolean }).alreadyRecovered).toBe(true);
  });

  it("get_motion_composition returns layer ids and detail", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const layerId = await addShape(host, compositionId);

    const detail = await executeTool(
      "get_motion_composition",
      { compositionId },
      host,
    );
    expect(detail.ok).toBe(true);
    const data = detail.data as {
      id: string;
      layers: Array<{ id: string; type: string }>;
    };
    expect(data.id).toBe(compositionId);
    expect(data.layers.some((layer) => layer.id === layerId)).toBe(true);
  });

  it("adds an image motion layer from media and rejects unsupported types", async () => {
    const project = makeEmptyProject();
    (project.mediaLibrary.items as unknown[]).push({
      id: "img-1",
      name: "Logo",
      type: "image",
      fileHandle: null,
      blob: null,
      metadata: {
        duration: 0,
        width: 512,
        height: 512,
        frameRate: 0,
        codec: "",
        sampleRate: 0,
      },
      thumbnailUrl: null,
      waveformData: null,
    });
    const host = new HeadlessHost(project);
    const compositionId = await createComp(host);

    const image = await executeTool(
      "add_motion_layer",
      { compositionId, layerType: "image", mediaId: "img-1" },
      host,
    );
    expect(image.ok).toBe(true);
    const composition = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId);
    const imageLayer = composition?.layers.find(
      (layer) => layer.id === (image.data as { layerId: string }).layerId,
    );
    expect(imageLayer?.type).toBe("image");

    const unsupported = await executeTool(
      "add_motion_layer",
      { compositionId, layerType: "video" },
      host,
    );
    expect(unsupported.ok).toBe(false);
    expect(unsupported.error?.code).toBe("INVALID_PARAMS");
  });

  it("animates a layer from a keyframes array and rejects invalid easing", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const layerId = await addShape(host, compositionId);

    const animated = await executeTool(
      "animate_layer",
      {
        compositionId,
        layerId,
        property: "transform.opacity",
        keyframes: [
          { time: 0, value: 0, easing: "ease-out" },
          { time: 0.5, value: 1, easing: "ease-in" },
          { time: 1, value: 0.5 },
        ],
      },
      host,
    );
    expect(animated.ok).toBe(true);
    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === compositionId)
      ?.layers.find((candidate) => candidate.id === layerId);
    expect(
      layer?.keyframes
        .filter((keyframe) => keyframe.property === "transform.opacity")
        .map((keyframe) => keyframe.value),
    ).toEqual([0, 1, 0.5]);

    const badEasing = await executeTool(
      "animate_layer",
      {
        compositionId,
        layerId,
        property: "transform.opacity",
        from: 0,
        to: 1,
        easing: "made-up-easing",
      },
      host,
    );
    expect(badEasing.ok).toBe(false);
    expect(badEasing.error?.code).toBe("INVALID_PARAMS");
  });

  it("adds a motion effect to a layer", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const layerId = await addShape(host, compositionId);

    const added = await executeTool(
      "add_motion_effect",
      { compositionId, layerId, effectType: "drop-shadow" },
      host,
    );
    expect(added.ok).toBe(true);
    const effectId = (added.data as { effectId: string }).effectId;
    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === compositionId)
      ?.layers.find((candidate) => candidate.id === layerId);
    expect(layer?.effects?.some((effect) => effect.id === effectId)).toBe(true);

    const badEffect = await executeTool(
      "add_motion_effect",
      { compositionId, layerId, effectType: "nope" },
      host,
    );
    expect(badEffect.ok).toBe(false);
    expect(badEffect.error?.code).toBe("INVALID_PARAMS");
  });

  it("adds a motion mask to a layer", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const layerId = await addShape(host, compositionId);

    const added = await executeTool(
      "add_motion_mask",
      { compositionId, layerId, shape: "ellipse", mode: "subtract", feather: 12 },
      host,
    );
    expect(added.ok).toBe(true);
    const maskId = (added.data as { maskId: string }).maskId;
    const layer = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === compositionId)
      ?.layers.find((candidate) => candidate.id === layerId);
    const mask = layer?.masks?.find((candidate) => candidate.id === maskId);
    expect(mask?.shape).toBe("ellipse");
    expect(mask?.mode).toBe("subtract");
  });

  it("transfers independent effect and mask stacks to multiple layers", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const sourceLayerId = await addShape(host, compositionId, "Source");
    const targetA = await addShape(host, compositionId, "Target A");
    const targetB = await addShape(host, compositionId, "Target B");

    const effect = await executeTool(
      "add_motion_effect",
      { compositionId, layerId: sourceLayerId, effectType: "glow" },
      host,
    );
    const mask = await executeTool(
      "add_motion_mask",
      { compositionId, layerId: sourceLayerId, shape: "ellipse", feather: 8 },
      host,
    );
    expect(effect.ok).toBe(true);
    expect(mask.ok).toBe(true);

    const effectsTransferred = await executeTool(
      "transfer_motion_effect_stack",
      {
        compositionId,
        sourceLayerId,
        targetLayerIds: [targetA, targetB],
        mode: "replace",
      },
      host,
    );
    const masksTransferred = await executeTool(
      "transfer_motion_mask_stack",
      {
        compositionId,
        sourceLayerId,
        targetLayerIds: [targetA, targetB],
        mode: "replace",
      },
      host,
    );
    expect(effectsTransferred.ok).toBe(true);
    expect(masksTransferred.ok).toBe(true);

    const composition = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId);
    const source = composition?.layers.find((layer) => layer.id === sourceLayerId);
    const targets = [targetA, targetB].map((id) =>
      composition?.layers.find((layer) => layer.id === id),
    );
    expect(targets.every((layer) => layer?.effects?.length === 1)).toBe(true);
    expect(targets.every((layer) => layer?.masks?.length === 1)).toBe(true);
    expect(targets[0]?.effects?.[0].id).not.toBe(source?.effects?.[0].id);
    expect(targets[1]?.effects?.[0].id).not.toBe(targets[0]?.effects?.[0].id);
    expect(targets[0]?.masks?.[0].id).not.toBe(source?.masks?.[0].id);
    expect(targets[1]?.masks?.[0].id).not.toBe(targets[0]?.masks?.[0].id);
  });

  it("sets a motion layer parent and rejects cycles", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const parentId = await addShape(host, compositionId, "Parent");
    const childId = await addShape(host, compositionId, "Child");

    const parented = await executeTool(
      "set_motion_layer_parent",
      { compositionId, layerId: childId, parentId },
      host,
    );
    expect(parented.ok).toBe(true);
    const child = host
      .getProject()
      .motionCompositions?.find((composition) => composition.id === compositionId)
      ?.layers.find((candidate) => candidate.id === childId);
    expect(child?.parentId).toBe(parentId);

    const cycle = await executeTool(
      "set_motion_layer_parent",
      { compositionId, layerId: parentId, parentId: childId },
      host,
    );
    expect(cycle.ok).toBe(false);
    expect(cycle.error?.code).toBe("INVALID_PARAMS");
  });

  it("imports an SVG as a motion composition", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">' +
      '<rect x="10" y="10" width="80" height="40" fill="#14b8a6" />' +
      '<circle cx="150" cy="60" r="30" fill="#ffffff" />' +
      "</svg>";

    const imported = await executeTool(
      "import_svg_composition",
      { svgContent: svg, name: "Logo SVG" },
      host,
    );
    expect(imported.ok).toBe(true);
    const data = imported.data as { compositionId: string; layerCount: number };
    expect(data.layerCount).toBeGreaterThan(0);
    const composition = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === data.compositionId);
    expect(composition?.name).toBe("Logo SVG");
  });

  it("exposes the motion capability catalog", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const caps = await executeTool("get_capabilities", {}, host);
    const motion = (caps.data as { motion?: { presets: unknown[]; layerTypes: string[] } }).motion;
    expect(motion?.layerTypes).toContain("particle");
    expect((motion?.presets.length ?? 0)).toBeGreaterThan(0);
  });

  it("exposes ui-build discovery info in the motion capability catalog", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const caps = await executeTool("get_capabilities", {}, host);
    const motion = (
      caps.data as {
        motion?: {
          shapeTypes: string[];
          animationPresets: Array<{ id: string }>;
          uiComponentTypes: string[];
          layoutModes: string[];
          fontFamilies: string[];
        };
      }
    ).motion;
    expect(motion?.shapeTypes).toContain("star");
    expect(motion?.animationPresets.some((preset) => preset.id === "slide-up-in")).toBe(true);
    expect(motion?.uiComponentTypes).toContain("card");
    expect(motion?.layoutModes).toContain("grid");
    expect((motion?.fontFamilies.length ?? 0)).toBeGreaterThan(0);
  });

  it("creates N layers in one call and returns ids keyed by spec key", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const res = await executeTool(
      "add_motion_layers",
      {
        compositionId,
        layers: [
          { key: "group", type: "group", name: "Hero" },
          { key: "title", type: "text", text: "Headline", parentKey: "group" },
          { key: "card", type: "shape", shapeType: "rectangle", parentKey: "group" },
        ],
      },
      host,
    );
    expect(res.ok).toBe(true);
    const data = res.data as {
      layerIds: Record<string, string>;
      createdLayerIds: string[];
    };
    expect(data.createdLayerIds).toHaveLength(3);
    expect(Object.keys(data.layerIds)).toEqual(
      expect.arrayContaining(["group", "title", "card"]),
    );
    const composition = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId);
    const title = composition?.layers.find(
      (layer) => layer.id === data.layerIds.title,
    );
    expect(title?.parentId).toBe(data.layerIds.group);

    const bad = await executeTool(
      "add_motion_layers",
      { compositionId, layers: [{ type: "image" }] },
      host,
    );
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("INVALID_PARAMS");
  });

  it("sets a gradient fill via set_motion_shape_style", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const layerId = await addShape(host, compositionId);

    const res = await executeTool(
      "set_motion_shape_style",
      {
        compositionId,
        layerId,
        cornerRadius: 32,
        fill: {
          type: "gradient",
          gradient: {
            type: "linear",
            angle: 90,
            stops: [
              { offset: 0, color: "#6366f1" },
              { offset: 1, color: "#14b8a6" },
            ],
          },
        },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId)
      ?.layers.find((candidate) => candidate.id === layerId);
    expect(layer?.type).toBe("shape");
    if (layer?.type === "shape") {
      expect(layer.style.fill.type).toBe("gradient");
      expect(layer.style.fill.gradient?.angle).toBe(90);
      expect(layer.style.fill.gradient?.stops).toHaveLength(2);
      expect(layer.style.cornerRadius).toBe(32);
    }

    const text = await executeTool(
      "add_motion_layer",
      { compositionId, layerType: "text" },
      host,
    );
    const textId = (text.data as { layerId: string }).layerId;
    const rejected = await executeTool(
      "set_motion_shape_style",
      { compositionId, layerId: textId, cornerRadius: 10 },
      host,
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBe("INVALID_PARAMS");
  });

  it("builds a button component group with the expected children", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);

    const res = await executeTool(
      "add_motion_ui_component",
      {
        compositionId,
        componentType: "button",
        props: { label: "Get started", x: 600, y: 400, accentColor: "#22c55e" },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const data = res.data as { groupId: string; childIds: string[] };
    expect(data.childIds).toHaveLength(2);
    const composition = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId);
    const group = composition?.layers.find((layer) => layer.id === data.groupId);
    expect(group?.type).toBe("group");
    const children = composition?.layers.filter((layer) =>
      data.childIds.includes(layer.id),
    );
    expect(children?.every((layer) => layer.parentId === data.groupId)).toBe(true);
    expect(children?.some((layer) => layer.type === "shape")).toBe(true);
    expect(children?.some((layer) => layer.type === "text")).toBe(true);
  });

  it("builds a card component with title and body text", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const res = await executeTool(
      "add_motion_ui_component",
      {
        compositionId,
        componentType: "card",
        props: { title: "Fast", body: "Render in seconds", shadow: true },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const data = res.data as { groupId: string; childIds: string[] };
    const composition = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId);
    const children = composition?.layers.filter((layer) =>
      data.childIds.includes(layer.id),
    );
    expect(children?.filter((layer) => layer.type === "text")).toHaveLength(2);

    const bad = await executeTool(
      "add_motion_ui_component",
      { compositionId, componentType: "nope" },
      host,
    );
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("INVALID_PARAMS");
  });

  it("arranges layers in a vertical stack with a gap", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const added = await executeTool(
      "add_motion_layers",
      {
        compositionId,
        layers: [
          { key: "a", type: "shape", width: 200, height: 80 },
          { key: "b", type: "shape", width: 200, height: 80 },
          { key: "c", type: "shape", width: 200, height: 80 },
        ],
      },
      host,
    );
    const ids = (added.data as { layerIds: Record<string, string> }).layerIds;

    const res = await executeTool(
      "arrange_motion_layers",
      {
        compositionId,
        layerIds: [ids.a, ids.b, ids.c],
        mode: "stack-vertical",
        gap: 40,
        originX: 500,
        originY: 100,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const composition = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId);
    const positions = [ids.a, ids.b, ids.c].map(
      (id) =>
        composition?.layers.find((layer) => layer.id === id)?.transform.position.y,
    );
    expect(positions).toEqual([140, 260, 380]);
  });

  it("imports an image layer from a URL", async () => {
    const project = makeEmptyProject();
    const host = new HeadlessHost(project);
    const compositionId = await createComp(host);
    (host as unknown as {
      importMediaFromUrl: (url: string, options?: { name?: string }) => Promise<unknown>;
    }).importMediaFromUrl = async (_url, options) => {
      const mediaId = "media-logo";
      (host.getProject().mediaLibrary.items as unknown[]).push({
        id: mediaId,
        name: options?.name ?? "Logo",
        type: "image",
        fileHandle: null,
        blob: null,
        metadata: {
          duration: 0,
          width: 256,
          height: 256,
          frameRate: 0,
          codec: "",
          sampleRate: 0,
        },
        thumbnailUrl: null,
        waveformData: null,
      });
      return {
        mediaId,
        name: options?.name ?? "Logo",
        type: "image",
        durationSec: 0,
        width: 256,
        height: 256,
      };
    };
    const res = await executeTool(
      "import_image_layer",
      {
        compositionId,
        url: "https://example.com/logo.png",
        name: "Logo",
        x: 200,
        y: 200,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const data = res.data as { layerId: string; assetId: string };
    const composition = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId);
    expect(composition?.assets.some((asset) => asset.id === data.assetId)).toBe(true);
    const layer = composition?.layers.find((candidate) => candidate.id === data.layerId);
    expect(layer?.type).toBe("image");
    if (layer?.type === "image") {
      expect(layer.assetId).toBe(data.assetId);
    }
  });

  it("applies an animation preset to multiple layers with a stagger", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const added = await executeTool(
      "add_motion_layers",
      {
        compositionId,
        layers: [
          { key: "a", type: "shape" },
          { key: "b", type: "shape" },
        ],
      },
      host,
    );
    const ids = (added.data as { layerIds: Record<string, string> }).layerIds;

    const res = await executeTool(
      "animate_motion_layers",
      {
        compositionId,
        layerIds: [ids.a, ids.b],
        presetId: "slide-up-in",
        stagger: 0.2,
        startTime: 0,
        duration: 0.6,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const data = res.data as { appliedLayerIds: string[] };
    expect(data.appliedLayerIds).toHaveLength(2);
    const composition = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId);
    const layerB = composition?.layers.find((layer) => layer.id === ids.b);
    expect((layerB?.keyframes.length ?? 0)).toBeGreaterThan(0);
    const earliestB = Math.min(
      ...(layerB?.keyframes.map((keyframe) => keyframe.time) ?? [0]),
    );
    expect(earliestB).toBeCloseTo(0.2, 3);

    const bad = await executeTool(
      "animate_motion_layers",
      { compositionId, layerIds: [ids.a], presetId: "made-up" },
      host,
    );
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("INVALID_PARAMS");
  });

  it("renders a motion frame and attaches the image", async () => {
    const host = new HeadlessHost(makeEmptyProject(), {
      jobRunner: async (kind, params) => {
        expect(kind).toBe("exportFrame");
        expect(params.compositionId).toBeTypeOf("string");
        return {
          ok: true,
          data: {
            dataUrl: "data:image/png;base64,AAAA",
            width: 1920,
            height: 1080,
          },
        };
      },
    });
    const compositionId = await createComp(host);

    const res = await executeTool(
      "render_motion_frame",
      { compositionId, timeSeconds: 0.5, scale: 2 },
      host,
    );
    expect(res.ok).toBe(true);
    expect(res.image?.dataUrl).toBe("data:image/png;base64,AAAA");
    expect(res.image?.mimeType).toBe("image/png");
    expect((res.data as { width: number; height: number }).width).toBe(1920);
  });

  it("render_motion_frame fails when the composition is missing", async () => {
    const host = new HeadlessHost(makeEmptyProject(), {
      jobRunner: async () => ({ ok: true, data: { dataUrl: "x" } }),
    });
    const res = await executeTool(
      "render_motion_frame",
      { compositionId: "nope" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });

  it("renders a semantic creation preview through its bound scene3d composition", async () => {
    const host = new HeadlessHost(makeEmptyProject(), {
      jobRunner: async (kind, params) => {
        expect(kind).toBe("exportFrame");
        expect(params).toMatchObject({
          compositionId: "comp-creation-preview",
          timeSeconds: 1,
          scale: 1.5,
        });
        return {
          ok: true,
          data: {
            dataUrl: "data:image/png;base64,BBBB",
            width: 1280,
            height: 720,
          },
        };
      },
    });
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-creation-preview",
        compositionId: "comp-creation-preview",
        layerId: "layer-creation-preview",
        name: "Creation Preview",
        duration: 2,
        objects: [
          {
            key: "cube",
            kind: "box",
            name: "Preview cube",
            color: "#38bdf8",
          },
        ],
      },
      host,
    );
    expect(created.ok).toBe(true);

    const rendered = await executeTool(
      "render_creation_preview",
      {
        sceneId: "scene-creation-preview",
        timeSeconds: 1,
        scale: 1.5,
      },
      host,
    );
    expect(rendered.ok).toBe(true);
    expect(rendered.image?.dataUrl).toBe("data:image/png;base64,BBBB");
    expect(rendered.data).toMatchObject({
      sceneId: "scene-creation-preview",
      compositionId: "comp-creation-preview",
      layerId: "layer-creation-preview",
      objectCount: 1,
      width: 1280,
      height: 720,
      timeSeconds: 1,
    });
  });

  it("render_creation_preview asks for sync when the render binding is missing", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const created = await executeTool(
      "create_creation_3d_scene",
      {
        sceneId: "scene-preview-missing-binding",
        compositionId: "comp-preview-missing-binding",
        layerId: "layer-preview-missing-binding",
        objects: [{ key: "cube", kind: "box" }],
      },
      host,
    );
    expect(created.ok).toBe(true);
    const project = structuredClone(host.getProject());
    host.setProject({
      ...project,
      creation: {
        ...project.creation!,
        scenes: project.creation!.scenes.map((scene) =>
          scene.id === "scene-preview-missing-binding"
            ? { ...scene, renderBindings: [] }
            : scene,
        ),
      },
    });

    const rendered = await executeTool(
      "render_creation_preview",
      { sceneId: "scene-preview-missing-binding" },
      host,
    );
    expect(rendered.ok).toBe(false);
    expect(rendered.error?.code).toBe("NOT_FOUND");
    expect(rendered.summary).toContain("sync_creation_scene_to_motion");
  });

  it("sets a static layer transform without keyframes", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const layerId = await addShape(host, compositionId);

    const res = await executeTool(
      "set_motion_layer_transform",
      {
        compositionId,
        layerId,
        x: 320,
        y: 240,
        scale: 1.5,
        rotation: 45,
        opacity: 0.5,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId)
      ?.layers.find((candidate) => candidate.id === layerId);
    expect(layer?.transform.position).toEqual({ x: 320, y: 240 });
    expect(layer?.transform.scale).toEqual({ x: 1.5, y: 1.5 });
    expect(layer?.transform.rotation).toBe(45);
    expect(layer?.transform.opacity).toBe(0.5);
    expect(layer?.keyframes).toHaveLength(0);
  });

  it("reorders a motion layer to the front and to an index", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const added = await executeTool(
      "add_motion_layers",
      {
        compositionId,
        layers: [
          { key: "a", type: "shape" },
          { key: "b", type: "shape" },
          { key: "c", type: "shape" },
        ],
      },
      host,
    );
    const ids = (added.data as { layerIds: Record<string, string> }).layerIds;

    const front = await executeTool(
      "reorder_motion_layer",
      { compositionId, layerId: ids.a, mode: "front" },
      host,
    );
    expect(front.ok).toBe(true);
    const layersAfterFront = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId)
      ?.layers.map((layer) => layer.id);
    expect(layersAfterFront?.at(-1)).toBe(ids.a);

    const toIndex = await executeTool(
      "reorder_motion_layer",
      { compositionId, layerId: ids.a, mode: "to-index", index: 0 },
      host,
    );
    expect(toIndex.ok).toBe(true);
    const layersAfterIndex = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId)
      ?.layers.map((layer) => layer.id);
    expect(layersAfterIndex?.[0]).toBe(ids.a);

    const bad = await executeTool(
      "reorder_motion_layer",
      { compositionId, layerId: ids.a, mode: "nope" },
      host,
    );
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("INVALID_PARAMS");
  });

  it("removes layers (with children) and clears matte references", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const added = await executeTool(
      "add_motion_layers",
      {
        compositionId,
        layers: [
          { key: "group", type: "group" },
          { key: "child", type: "shape", parentKey: "group" },
          { key: "keeper", type: "shape" },
        ],
      },
      host,
    );
    const ids = (added.data as { layerIds: Record<string, string> }).layerIds;

    const removed = await executeTool(
      "remove_motion_layer",
      { compositionId, layerId: ids.group },
      host,
    );
    expect(removed.ok).toBe(true);
    const remaining = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId)
      ?.layers.map((layer) => layer.id);
    expect(remaining).toContain(ids.keeper);
    expect(remaining).not.toContain(ids.group);
    expect(remaining).not.toContain(ids.child);

    const missing = await executeTool(
      "remove_motion_layer",
      { compositionId, layerId: "does-not-exist" },
      host,
    );
    expect(missing.ok).toBe(false);
    expect(missing.error?.code).toBe("NOT_FOUND");

    const empty = await executeTool(
      "remove_motion_layer",
      { compositionId },
      host,
    );
    expect(empty.ok).toBe(false);
    expect(empty.error?.code).toBe("INVALID_PARAMS");
  });

  it("updates first-class composition settings", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const res = await executeTool(
      "update_motion_composition",
      {
        compositionId,
        name: "Renamed scene",
        width: 1080,
        height: 1080,
        duration: 7,
        backgroundColor: "#101010",
      },
      host,
    );
    expect(res.ok).toBe(true);
    const composition = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId);
    expect(composition?.name).toBe("Renamed scene");
    expect(composition?.width).toBe(1080);
    expect(composition?.height).toBe(1080);
    expect(composition?.duration).toBe(7);
    expect(composition?.backgroundColor).toBe("#101010");
  });

  it("imports a custom font onto a composition", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const res = await executeTool(
      "import_motion_font",
      {
        compositionId,
        family: "Brand Sans",
        source: "https://example.com/brand.woff2",
        weight: 700,
        style: "italic",
      },
      host,
    );
    expect(res.ok).toBe(true);
    const composition = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId);
    expect(composition?.fonts).toEqual([
      {
        family: "Brand Sans",
        source: "https://example.com/brand.woff2",
        weight: 700,
        style: "italic",
      },
    ]);

    const bad = await executeTool(
      "import_motion_font",
      { compositionId, family: "X", source: "" },
      host,
    );
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("INVALID_PARAMS");
  });

  it("sets per-corner radii, a conic gradient, and a shadow spread via set_motion_shape_style", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const layerId = await addShape(host, compositionId);

    const res = await executeTool(
      "set_motion_shape_style",
      {
        compositionId,
        layerId,
        cornerRadii: {
          topLeft: 24,
          topRight: 24,
          bottomRight: 0,
          bottomLeft: 0,
        },
        shadow: {
          color: "#000000",
          blur: 12,
          offsetX: 0,
          offsetY: 6,
          spread: 4,
          inset: true,
        },
        fill: {
          type: "gradient",
          gradient: {
            type: "conic",
            angle: 120,
            center: { x: 0.5, y: 0.5 },
            stops: [
              { offset: 0, color: "#6366f1", opacity: 0.8 },
              { offset: 1, color: "#14b8a6" },
            ],
          },
        },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId)
      ?.layers.find((candidate) => candidate.id === layerId);
    expect(layer?.type).toBe("shape");
    if (layer?.type === "shape") {
      expect(layer.style.cornerRadii).toEqual({
        topLeft: 24,
        topRight: 24,
        bottomRight: 0,
        bottomLeft: 0,
      });
      expect(layer.style.shadow?.spread).toBe(4);
      expect(layer.style.shadow?.inset).toBe(true);
      expect(layer.style.fill.gradient?.type).toBe("conic");
      expect(layer.style.fill.gradient?.center).toEqual({ x: 0.5, y: 0.5 });
      expect(layer.style.fill.gradient?.stops[0].opacity).toBe(0.8);
    }
  });

  it("sets text wrap and a gradient fill via set_motion_text_style", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const added = await executeTool(
      "add_motion_layer",
      { compositionId, layerType: "text", text: "Hello" },
      host,
    );
    const layerId = (added.data as { layerId: string }).layerId;

    const res = await executeTool(
      "set_motion_text_style",
      {
        compositionId,
        layerId,
        maxWidth: 480,
        verticalAlign: "middle",
        backgroundColor: "#222222",
        backgroundPadding: 16,
        backgroundRadius: 12,
        fillGradient: {
          type: "linear",
          angle: 45,
          stops: [
            { offset: 0, color: "#f59e0b" },
            { offset: 1, color: "#ef4444" },
          ],
        },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId)
      ?.layers.find((candidate) => candidate.id === layerId);
    expect(layer?.type).toBe("text");
    if (layer?.type === "text") {
      expect(layer.style.maxWidth).toBe(480);
      expect(layer.style.verticalAlign).toBe("middle");
      expect(layer.style.backgroundColor).toBe("#222222");
      expect(layer.style.backgroundRadius).toBe(12);
      expect(layer.style.fillGradient?.type).toBe("linear");
      expect(layer.style.fillGradient?.stops).toHaveLength(2);
    }

    const rejected = await executeTool(
      "set_motion_text_style",
      { compositionId, layerId, verticalAlign: "sideways" },
      host,
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBe("INVALID_PARAMS");
  });

  it("adds a backdrop-blur motion effect", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const compositionId = await createComp(host);
    const layerId = await addShape(host, compositionId);

    const res = await executeTool(
      "add_motion_effect",
      { compositionId, layerId, effectType: "backdrop-blur" },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = host
      .getProject()
      .motionCompositions?.find((candidate) => candidate.id === compositionId)
      ?.layers.find((candidate) => candidate.id === layerId);
    const effect = (layer?.effects ?? []).find(
      (candidate) => candidate.type === "backdrop-blur",
    );
    expect(effect).toBeDefined();
  });
});
