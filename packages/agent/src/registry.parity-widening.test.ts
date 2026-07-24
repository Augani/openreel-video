import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import type {
  MotionComposition,
  MotionLayer,
  MotionScene3DLayer,
  MotionShapeLayer,
  MotionTextLayer,
} from "@openreel/core/motion/types";
import type { ImportedMediaRef } from "./host";
import type { MediaItem, Project } from "@openreel/core/types/project";

const COMP_ID = "comp-parity";

function baseLayer(id: string): Omit<MotionLayer, "type"> {
  return {
    id,
    name: id,
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
  } as Omit<MotionLayer, "type">;
}

function textLayer(id: string): MotionTextLayer {
  return {
    ...baseLayer(id),
    type: "text",
    text: "Hello",
    style: {
      fontFamily: "Inter",
      fontSize: 96,
      fontWeight: 800,
      color: "#ffffff",
      align: "center",
      lineHeight: 1.05,
    },
  } as MotionTextLayer;
}

function shapeLayer(id: string): MotionShapeLayer {
  return {
    ...baseLayer(id),
    type: "shape",
    shapeType: "rectangle",
    width: 200,
    height: 120,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 1 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
    },
  } as MotionShapeLayer;
}

function projectWith(layers: MotionLayer[]): Project {
  const composition: MotionComposition = {
    id: COMP_ID,
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers,
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
  return {
    ...makeEmptyProject(),
    motionCompositions: [composition],
  } as unknown as Project;
}

function comp(host: HeadlessHost): MotionComposition {
  return host
    .getProject()
    .motionCompositions!.find((candidate) => candidate.id === COMP_ID)!;
}

function layerById<T extends MotionLayer = MotionLayer>(
  host: HeadlessHost,
  id: string,
): T {
  return comp(host).layers.find((layer) => layer.id === id) as T;
}

function data(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("Expected data record");
  return value as Record<string, unknown>;
}

describe("#7 attach_motion_expression tuned preset params", () => {
  it("applies amplitude/frequency/phase/seed/decay overrides", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "attach_motion_expression",
      {
        compositionId: COMP_ID,
        layerId: "s1",
        property: "transform.position.x",
        expressionType: "wiggle",
        amplitude: 60,
        frequency: 0.5,
        phase: 2,
        seed: 9,
        decay: 5,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const expr = (layerById(host, "s1").expressions ?? [])[0];
    expect(expr.amplitude).toBe(60);
    expect(expr.frequency).toBe(0.5);
    expect(expr.phase).toBe(2);
    expect(expr.seed).toBe(9);
    expect(expr.decay).toBe(5);
  });

  it("keeps preset defaults when overrides omitted", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    await executeTool(
      "attach_motion_expression",
      {
        compositionId: COMP_ID,
        layerId: "s1",
        property: "transform.position.x",
        expressionType: "wiggle",
      },
      host,
    );
    const expr = (layerById(host, "s1").expressions ?? [])[0];
    expect(Number.isFinite(expr.amplitude)).toBe(true);
    expect(expr.frequency).toBeGreaterThan(0);
  });
});

describe("#15 update_motion_effect accepts control value", () => {
  it("sets the value parameter on an expression-control effect", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const added = await executeTool(
      "add_motion_expression_control",
      { compositionId: COMP_ID, layerId: "s1", controlType: "slider", value: 1 },
      host,
    );
    expect(added.ok).toBe(true);
    const effectId = String(data(added.data).effectId);
    const res = await executeTool(
      "update_motion_effect",
      {
        compositionId: COMP_ID,
        layerId: "s1",
        effectId,
        parameter: "value",
        value: 42,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const effect = (layerById(host, "s1").effects ?? []).find(
      (candidate) => candidate.id === effectId,
    );
    expect(effect).toBeDefined();
    expect((effect as { value?: number }).value).toBe(42);
  });
});

describe("#19/#44 set_motion_scene_object geometry + PBR material", () => {
  async function sceneHost(): Promise<{ host: HeadlessHost; objectId: string }> {
    const host = new HeadlessHost(projectWith([]));
    const res = await executeTool(
      "add_motion_3d_scene",
      {
        compositionId: COMP_ID,
        objects: [{ kind: "text3d", text: "A", name: "Hero" }],
      },
      host,
    );
    expect(res.ok).toBe(true);
    const layerId = String(data(res.data).layerId);
    const layer = layerById<MotionScene3DLayer>(host, layerId);
    return { host, objectId: layer.objects![0].id };
  }

  it("edits text3d content, extrude, aspect, and lidAngle", async () => {
    const { host, objectId } = await sceneHost();
    const layer = comp(host).layers.find((l) => l.type === "scene3d") as MotionScene3DLayer;
    const res = await executeTool(
      "set_motion_scene_object",
      {
        compositionId: COMP_ID,
        layerId: layer.id,
        objectId,
        geometry: { text: "REVISED", extrude: 0.5, aspect: 1.6 },
        lidAngle: 45,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const obj = (
      comp(host).layers.find((l) => l.type === "scene3d") as MotionScene3DLayer
    ).objects!.find((o) => o.id === objectId)!;
    expect(obj.object.text).toBe("REVISED");
    expect(obj.object.extrude).toBe(0.5);
    expect(obj.object.aspect).toBe(1.6);
    expect(obj.lidAngle).toBe(45);
  });

  it("sets advanced PBR fields and materialKind", async () => {
    const { host, objectId } = await sceneHost();
    const layer = comp(host).layers.find((l) => l.type === "scene3d") as MotionScene3DLayer;
    const res = await executeTool(
      "set_motion_scene_object",
      {
        compositionId: COMP_ID,
        layerId: layer.id,
        objectId,
        material: {
          emissiveIntensity: 2,
          transmission: 0.8,
          ior: 1.5,
          clearcoat: 1,
          materialKind: "physical",
          normalMapAssetId: "asset-normal",
        },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const obj = (
      comp(host).layers.find((l) => l.type === "scene3d") as MotionScene3DLayer
    ).objects!.find((o) => o.id === objectId)!;
    expect(obj.material?.emissiveIntensity).toBe(2);
    expect(obj.material?.transmission).toBe(0.8);
    expect(obj.material?.ior).toBe(1.5);
    expect(obj.material?.clearcoat).toBe(1);
    expect(obj.material?.kind).toBe("physical");
    expect(obj.material?.normalMapAssetId).toBe("asset-normal");
  });

  it("rejects an invalid materialKind", async () => {
    const { host, objectId } = await sceneHost();
    const layer = comp(host).layers.find((l) => l.type === "scene3d") as MotionScene3DLayer;
    const res = await executeTool(
      "set_motion_scene_object",
      {
        compositionId: COMP_ID,
        layerId: layer.id,
        objectId,
        material: { materialKind: "chrome" },
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("#20 add_motion_layer scene3d", () => {
  it("creates a blank scene3d layer with a default object", async () => {
    const host = new HeadlessHost(projectWith([]));
    const res = await executeTool(
      "add_motion_layer",
      { compositionId: COMP_ID, layerType: "scene3d", name: "My Scene" },
      host,
    );
    expect(res.ok).toBe(true);
    const layerId = String(data(res.data).layerId);
    const layer = layerById<MotionScene3DLayer>(host, layerId);
    expect(layer.type).toBe("scene3d");
    expect(layer.objects?.length).toBe(1);
    expect(layer.camera?.fov).toBe(35);
  });
});

describe("#22 set_motion_layer_transform 3D fields", () => {
  it("writes position.z, rotation3d, and perspective", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "set_motion_layer_transform",
      {
        compositionId: COMP_ID,
        layerId: "s1",
        z: 120,
        rotationX: 15,
        rotationY: 30,
        rotationZ: 45,
        perspective: 800,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const t = layerById(host, "s1").transform;
    expect(t.position.z).toBe(120);
    expect(t.rotation3d?.x).toBe(15);
    expect(t.rotation3d?.y).toBe(30);
    expect(t.rotation3d?.z).toBe(45);
    expect(t.perspective).toBe(800);
  });

  it("leaves rotation3d/perspective untouched when not passed", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    await executeTool(
      "set_motion_layer_transform",
      { compositionId: COMP_ID, layerId: "s1", x: 10 },
      host,
    );
    const t = layerById(host, "s1").transform;
    expect(t.position.x).toBe(10);
    expect(t.rotation3d).toEqual(DEFAULT_MOTION_TRANSFORM.rotation3d);
    expect(t.perspective).toBe(DEFAULT_MOTION_TRANSFORM.perspective);
  });
});

describe("#33 set_motion_scene_camera near/far", () => {
  it("merges near and far onto the camera", async () => {
    const host = new HeadlessHost(projectWith([]));
    const scene = await executeTool(
      "add_motion_3d_scene",
      { compositionId: COMP_ID, objects: [{ kind: "box" }] },
      host,
    );
    const layerId = String(data(scene.data).layerId);
    const res = await executeTool(
      "set_motion_scene_camera",
      { compositionId: COMP_ID, layerId, near: 0.5, far: 500 },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = layerById<MotionScene3DLayer>(host, layerId);
    expect(layer.camera?.near).toBe(0.5);
    expect(layer.camera?.far).toBe(500);
  });
});

describe("#34 add_motion_light shadow/falloff/z", () => {
  it("passes falloff, z, castsShadow, shadowOpacity, shadowSoftness", async () => {
    const host = new HeadlessHost(projectWith([]));
    const res = await executeTool(
      "add_motion_light",
      {
        compositionId: COMP_ID,
        lightType: "point",
        z: 240,
        falloff: 2,
        castsShadow: true,
        shadowOpacity: 0.7,
        shadowSoftness: 32,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const lightId = String(data(res.data).lightId);
    const light = (comp(host).lights ?? []).find((l) => l.id === lightId)!;
    expect(light.position.z).toBe(240);
    expect(light.falloff).toBe(2);
    expect(light.castsShadow).toBe(true);
    expect(light.shadowOpacity).toBeCloseTo(0.7);
    expect(light.shadowSoftness).toBe(32);
  });
});

describe("#39 set_motion_track_matte enabled + clear", () => {
  async function twoLayerHost(): Promise<HeadlessHost> {
    return new HeadlessHost(
      projectWith([shapeLayer("target") as MotionLayer, shapeLayer("src") as MotionLayer]),
    );
  }

  it("sets a matte then disables it via enabled=false", async () => {
    const host = await twoLayerHost();
    await executeTool(
      "set_motion_track_matte",
      { compositionId: COMP_ID, layerId: "target", sourceLayerId: "src", type: "alpha" },
      host,
    );
    expect(layerById(host, "target").trackMatte?.enabled).toBe(true);
    const res = await executeTool(
      "set_motion_track_matte",
      { compositionId: COMP_ID, layerId: "target", enabled: false },
      host,
    );
    expect(res.ok).toBe(true);
    expect(layerById(host, "target").trackMatte?.enabled).toBe(false);
    expect(layerById(host, "target").trackMatte?.sourceLayerId).toBe("src");
  });

  it("clears the matte when sourceLayerId is null", async () => {
    const host = await twoLayerHost();
    await executeTool(
      "set_motion_track_matte",
      { compositionId: COMP_ID, layerId: "target", sourceLayerId: "src", type: "luma" },
      host,
    );
    const res = await executeTool(
      "set_motion_track_matte",
      { compositionId: COMP_ID, layerId: "target", sourceLayerId: null },
      host,
    );
    expect(res.ok).toBe(true);
    expect(data(res.data).cleared).toBe(true);
    expect(layerById(host, "target").trackMatte).toBeUndefined();
  });

  it("requires a source when no matte exists yet", async () => {
    const host = await twoLayerHost();
    const res = await executeTool(
      "set_motion_track_matte",
      { compositionId: COMP_ID, layerId: "target", enabled: true },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("#40 add_motion_mask expansion/opacity", () => {
  it("stores expansion and opacity on the created mask", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "add_motion_mask",
      {
        compositionId: COMP_ID,
        layerId: "s1",
        shape: "ellipse",
        expansion: 24,
        opacity: 0.5,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const mask = (layerById(host, "s1").masks ?? [])[0];
    expect(mask.expansion).toBe(24);
    expect(mask.opacity).toBeCloseTo(0.5);
  });
});

describe("#41 update_motion_shape_modifier enabled", () => {
  it("toggles the modifier enabled flag", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const added = await executeTool(
      "add_motion_shape_modifier",
      { compositionId: COMP_ID, layerId: "s1", modifierType: "trim-paths" },
      host,
    );
    const modifierId = String(data(added.data).modifierId);
    const res = await executeTool(
      "update_motion_shape_modifier",
      { compositionId: COMP_ID, layerId: "s1", modifierId, enabled: false },
      host,
    );
    expect(res.ok).toBe(true);
    const modifier = (layerById<MotionShapeLayer>(host, "s1").modifiers ?? []).find(
      (m) => m.id === modifierId,
    )!;
    expect(modifier.enabled).toBe(false);
  });

  it("requires fields or enabled", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const added = await executeTool(
      "add_motion_shape_modifier",
      { compositionId: COMP_ID, layerId: "s1", modifierType: "repeater" },
      host,
    );
    const modifierId = String(data(added.data).modifierId);
    const res = await executeTool(
      "update_motion_shape_modifier",
      { compositionId: COMP_ID, layerId: "s1", modifierId },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("add_motion_shape_modifier accepts the new operators at layer level", () => {
  it("adds a twist modifier with defaults", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "add_motion_shape_modifier",
      { compositionId: COMP_ID, layerId: "s1", modifierType: "twist" },
      host,
    );
    expect(res.ok).toBe(true);
    const modifierId = String(data(res.data).modifierId);
    const modifier = (layerById<MotionShapeLayer>(host, "s1").modifiers ?? []).find(
      (m) => m.id === modifierId,
    );
    expect(modifier?.type).toBe("twist");
    if (modifier?.type === "twist") {
      expect(modifier.angle).toBe(0);
      expect(modifier.center).toEqual({ x: 0, y: 0 });
    }
  });

  it("adds offset-paths and pucker-bloat modifiers", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    for (const modifierType of ["offset-paths", "pucker-bloat"] as const) {
      const res = await executeTool(
        "add_motion_shape_modifier",
        { compositionId: COMP_ID, layerId: "s1", modifierType },
        host,
      );
      expect(res.ok).toBe(true);
    }
    const types = (layerById<MotionShapeLayer>(host, "s1").modifiers ?? []).map(
      (m) => m.type,
    );
    expect(types).toContain("offset-paths");
    expect(types).toContain("pucker-bloat");
  });
});

describe("#43 add_motion_text_shader_animator clear", () => {
  it("clears the shader when shaderId is empty", async () => {
    const host = new HeadlessHost(projectWith([textLayer("t1") as MotionLayer]));
    const shaders = await executeTool(
      "list_motion_shaders",
      { category: "text" },
      host,
    );
    const list = data(shaders.data).text as { id: string }[];
    const shaderId = list[0].id;
    const added = await executeTool(
      "add_motion_text_shader_animator",
      { compositionId: COMP_ID, layerId: "t1", shaderId },
      host,
    );
    expect(added.ok).toBe(true);
    const withShader = layerById<MotionTextLayer>(host, "t1").textAnimators ?? [];
    expect(withShader.some((a) => a.shader !== undefined)).toBe(true);
    const cleared = await executeTool(
      "add_motion_text_shader_animator",
      { compositionId: COMP_ID, layerId: "t1", shaderId: "" },
      host,
    );
    expect(cleared.ok).toBe(true);
    expect(data(cleared.data).cleared).toBe(true);
    const after = layerById<MotionTextLayer>(host, "t1").textAnimators ?? [];
    expect(after.some((a) => a.shader !== undefined)).toBe(false);
  });
});

describe("#50 render_motion_frame quality", () => {
  it("maps quality=final to scale 2 and draft to scale 1", async () => {
    const scales: number[] = [];
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]), {
      jobRunner: async (_kind, params) => {
        scales.push(typeof params.scale === "number" ? params.scale : -1);
        return {
          ok: true,
          data: {
            dataUrl: "data:image/png;base64,AAAA",
            width: 1280,
            height: 720,
          },
        };
      },
    });
    const final = await executeTool(
      "render_motion_frame",
      { compositionId: COMP_ID, quality: "final" },
      host,
    );
    expect(final.ok).toBe(true);
    const draft = await executeTool(
      "render_motion_frame",
      { compositionId: COMP_ID, quality: "draft" },
      host,
    );
    expect(draft.ok).toBe(true);
    expect(scales).toEqual([2, 1]);
  });

  it("lets an explicit scale override quality", async () => {
    const scales: number[] = [];
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]), {
      jobRunner: async (_kind, params) => {
        scales.push(typeof params.scale === "number" ? params.scale : -1);
        return {
          ok: true,
          data: { dataUrl: "data:image/png;base64,AAAA", width: 640, height: 360 },
        };
      },
    });
    await executeTool(
      "render_motion_frame",
      { compositionId: COMP_ID, quality: "draft", scale: 2 },
      host,
    );
    expect(scales).toEqual([2]);
  });
});

class ImageImportHost extends HeadlessHost {
  async importMediaFromUrl(
    _url: string,
    options?: { name?: string },
  ): Promise<ImportedMediaRef> {
    const project = this.getProject();
    const media: MediaItem = {
      id: "media-img",
      name: options?.name ?? "logo.png",
      type: "image",
      fileHandle: null,
      blob: null,
      metadata: {
        duration: 0,
        width: 512,
        height: 512,
        frameRate: 0,
        codec: "png",
        sampleRate: 0,
        channels: 0,
        fileSize: 1024,
      },
      thumbnailUrl: null,
      waveformData: null,
    };
    this.setProject({
      ...project,
      mediaLibrary: {
        ...project.mediaLibrary,
        items: [...project.mediaLibrary.items, media],
      },
    });
    return {
      mediaId: media.id,
      name: media.name,
      type: "image",
      durationSec: 0,
      width: 512,
      height: 512,
    };
  }
}

describe("#51 import_image_layer timing + transform", () => {
  it("honors startTime, duration, rotation, opacity", async () => {
    const host = new ImageImportHost(projectWith([]));
    const res = await executeTool(
      "import_image_layer",
      {
        compositionId: COMP_ID,
        url: "https://example.com/logo.png",
        startTime: 1.5,
        duration: 2,
        rotation: 30,
        opacity: 0.5,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const layerId = String(data(res.data).layerId);
    const layer = layerById(host, layerId);
    expect(layer.startTime).toBe(1.5);
    expect(layer.duration).toBe(2);
    expect(layer.transform.rotation).toBe(30);
    expect(layer.transform.opacity).toBeCloseTo(0.5);
  });
});

describe("#18 mask keyframe property enumeration (verification)", () => {
  it("list_motion_animatable_properties surfaces mask.<id>.<prop> ids", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const added = await executeTool(
      "add_motion_mask",
      { compositionId: COMP_ID, layerId: "s1", shape: "rectangle" },
      host,
    );
    const maskId = String(data(added.data).maskId);
    const listed = await executeTool(
      "list_motion_animatable_properties",
      { compositionId: COMP_ID, layerId: "s1" },
      host,
    );
    expect(listed.ok).toBe(true);
    const props = (data(listed.data).properties as { property: string }[]).map(
      (p) => p.property,
    );
    expect(props).toContain(`mask.${maskId}.opacity`);
    expect(props).toContain(`mask.${maskId}.expansion`);
  });
});
