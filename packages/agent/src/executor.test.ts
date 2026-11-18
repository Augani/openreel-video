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

});
