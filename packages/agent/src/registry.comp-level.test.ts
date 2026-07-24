import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import type {
  MotionComposition,
  MotionCompositionLayer,
  MotionLayer,
  MotionLight,
  MotionShapeLayer,
} from "@openreel/core/motion/types";
import { MOTION_COMPOSITION_TIME_PROPERTY } from "@openreel/core/motion/motion-precomps";
import type { Project } from "@openreel/core/types/project";

const COMP_ID = "comp-e";
const SHAPE_ID = "layer-shape";
const LIGHT_ID = "light-1";

function shapeLayer(): MotionShapeLayer {
  return {
    id: SHAPE_ID,
    type: "shape",
    name: "Shape",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 200,
    height: 120,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 0.8 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
    },
  };
}

function pointLight(): MotionLight {
  return {
    id: LIGHT_ID,
    type: "point",
    name: "Point Light",
    enabled: true,
    color: "#ffffff",
    intensity: 1,
    position: { x: 640, y: 360, z: 400 },
    radius: 1000,
    falloff: 2,
    angle: 135,
    castsShadow: true,
    shadowOpacity: 0.22,
    shadowSoftness: 30,
    keyframes: [],
  };
}

function baseComposition(overrides: Partial<MotionComposition> = {}): MotionComposition {
  return {
    id: COMP_ID,
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 6,
    backgroundColor: "#101820",
    layers: [shapeLayer() as MotionLayer],
    assets: [],
    variables: [],
    markers: [],
    lights: [pointLight()],
    createdAt: 1,
    modifiedAt: 1,
    ...overrides,
  };
}

function projectWith(composition: MotionComposition): Project {
  return {
    ...makeEmptyProject(),
    motionCompositions: [composition],
  } as unknown as Project;
}

function compFrom(host: HeadlessHost, id = COMP_ID): MotionComposition {
  return host
    .getProject()
    .motionCompositions!.find((candidate) => candidate.id === id)!;
}

function layerFrom(host: HeadlessHost, layerId = SHAPE_ID): MotionLayer {
  return compFrom(host).layers.find((layer) => layer.id === layerId)!;
}

function dataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("Expected data object");
  return value as Record<string, unknown>;
}

describe("motion markers CRUD (gap 12)", () => {
  it("adds, updates, and removes a composition marker", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const added = await executeTool(
      "add_motion_marker",
      { compositionId: COMP_ID, time: 2.5, label: "Beat drop", color: "#ff0044" },
      host,
    );
    expect(added.ok).toBe(true);
    const markerId = dataRecord(added.data).markerId as string;
    expect(markerId).toBeTruthy();
    let markers = compFrom(host).markers;
    expect(markers.length).toBe(1);
    expect(markers[0].time).toBeCloseTo(2.5, 3);
    expect(markers[0].label).toBe("Beat drop");

    const updated = await executeTool(
      "update_motion_marker",
      { compositionId: COMP_ID, markerId, label: "Chorus", time: 3 },
      host,
    );
    expect(updated.ok).toBe(true);
    markers = compFrom(host).markers;
    expect(markers[0].label).toBe("Chorus");
    expect(markers[0].time).toBeCloseTo(3, 3);

    const removed = await executeTool(
      "remove_motion_marker",
      { compositionId: COMP_ID, markerId },
      host,
    );
    expect(removed.ok).toBe(true);
    expect(compFrom(host).markers.length).toBe(0);
  });

  it("rejects update for a missing marker", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const res = await executeTool(
      "update_motion_marker",
      { compositionId: COMP_ID, markerId: "nope", label: "x" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

describe("animate_motion_camera (gap 6)", () => {
  it("keyframes camera position and zoom and applies DOF fields", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const res = await executeTool(
      "animate_motion_camera",
      {
        compositionId: COMP_ID,
        position: [
          { time: 0, x: 640, y: 360, z: 0 },
          { time: 3, x: 640, y: 360, z: -400, easing: "ease-in-out" },
        ],
        zoom: [
          { time: 0, value: 1 },
          { time: 3, value: 1.8 },
        ],
        depthOfField: { focusDistance: 400, aperture: 2.4, maxBlur: 30 },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const camera = compFrom(host).camera!;
    expect(camera.enabled).toBe(true);
    const cameraKeyframes = camera.keyframes ?? [];
    const zKeys = cameraKeyframes.filter(
      (kf) => kf.property === "camera.position.z",
    );
    expect(zKeys.length).toBe(2);
    expect(zKeys.find((kf) => kf.time === 3)?.value).toBeCloseTo(-400, 3);
    const zoomKeys = cameraKeyframes.filter((kf) => kf.property === "camera.zoom");
    expect(zoomKeys.length).toBe(2);
    expect(camera.depthOfField?.aperture).toBeCloseTo(2.4, 3);
  });

  it("rejects when no keyframe arrays are provided", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const res = await executeTool(
      "animate_motion_camera",
      { compositionId: COMP_ID },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("animate_motion_light (gap 13)", () => {
  it("keyframes a light property", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const res = await executeTool(
      "animate_motion_light",
      {
        compositionId: COMP_ID,
        lightId: LIGHT_ID,
        property: "light.intensity",
        keyframes: [
          { time: 0, value: 0 },
          { time: 2, value: 3, easing: "ease" },
        ],
      },
      host,
    );
    expect(res.ok).toBe(true);
    const light = compFrom(host).lights!.find((entry) => entry.id === LIGHT_ID)!;
    const kf = light.keyframes ?? [];
    expect(kf.filter((entry) => entry.property === "light.intensity").length).toBe(2);
  });

  it("rejects an invalid light property", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const res = await executeTool(
      "animate_motion_light",
      {
        compositionId: COMP_ID,
        lightId: LIGHT_ID,
        property: "light.bogus",
        keyframes: [{ time: 0, value: 1 }],
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("set_motion_light_style (gap 9)", () => {
  it("updates color, castsShadow, name, enabled", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const res = await executeTool(
      "set_motion_light_style",
      {
        compositionId: COMP_ID,
        lightId: LIGHT_ID,
        color: "#ff8800",
        castsShadow: false,
        name: "Key",
        enabled: false,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const light = compFrom(host).lights!.find((entry) => entry.id === LIGHT_ID)!;
    expect(light.color).toBe("#ff8800");
    expect(light.castsShadow).toBe(false);
    expect(light.name).toBe("Key");
    expect(light.enabled).toBe(false);
  });

  it("changes the light type and renormalizes", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const res = await executeTool(
      "set_motion_light_style",
      { compositionId: COMP_ID, lightId: LIGHT_ID, type: "directional" },
      host,
    );
    expect(res.ok).toBe(true);
    const light = compFrom(host).lights!.find((entry) => entry.id === LIGHT_ID)!;
    expect(light.type).toBe("directional");
  });

  it("clears shadows when retargeting a point light to ambient", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const before = compFrom(host).lights!.find((entry) => entry.id === LIGHT_ID)!;
    expect(before.castsShadow).toBe(true);
    expect(before.shadowOpacity).toBeGreaterThan(0);
    const res = await executeTool(
      "set_motion_light_style",
      { compositionId: COMP_ID, lightId: LIGHT_ID, type: "ambient" },
      host,
    );
    expect(res.ok).toBe(true);
    const light = compFrom(host).lights!.find((entry) => entry.id === LIGHT_ID)!;
    expect(light.type).toBe("ambient");
    expect(light.castsShadow).toBe(false);
    expect(light.shadowOpacity).toBe(0);
  });

  it("rejects an unknown type", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const res = await executeTool(
      "set_motion_light_style",
      { compositionId: COMP_ID, lightId: LIGHT_ID, type: "laser" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("set_motion_blur (gap 24)", () => {
  it("merges composition motion blur settings", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const res = await executeTool(
      "set_motion_blur",
      { compositionId: COMP_ID, enabled: true, shutterAngle: 200, samples: 12 },
      host,
    );
    expect(res.ok).toBe(true);
    const blur = compFrom(host).motionBlur!;
    expect(blur.enabled).toBe(true);
    expect(blur.shutterAngle).toBe(200);
    expect(blur.samples).toBe(12);
    expect(blur.shutterPhase).toBe(-90);
  });
});

describe("set_motion_layer_motion_blur (gap 25)", () => {
  it("toggles the per-layer motion blur flag", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const res = await executeTool(
      "set_motion_layer_motion_blur",
      { compositionId: COMP_ID, layerId: SHAPE_ID, enabled: true },
      host,
    );
    expect(res.ok).toBe(true);
    expect(layerFrom(host).motionBlur).toBe(true);
  });
});

describe("delete_motion_composition (gap 31)", () => {
  it("removes the composition from the project", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const res = await executeTool(
      "delete_motion_composition",
      { compositionId: COMP_ID },
      host,
    );
    expect(res.ok).toBe(true);
    expect(
      (host.getProject().motionCompositions ?? []).some((c) => c.id === COMP_ID),
    ).toBe(false);
  });

  it("returns NOT_FOUND for a missing composition", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const res = await executeTool(
      "delete_motion_composition",
      { compositionId: "missing" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

describe("duplicate_motion_composition (gap 49)", () => {
  it("deep clones with fresh layer and keyframe ids", async () => {
    const withKeyframe = baseComposition();
    const shape = withKeyframe.layers[0] as MotionShapeLayer;
    const cloned: MotionComposition = {
      ...withKeyframe,
      layers: [
        {
          ...shape,
          keyframes: [
            {
              id: "kf-orig",
              property: "transform.opacity",
              time: 0,
              value: 1,
              easing: "ease",
            },
          ],
        } as MotionLayer,
      ],
    };
    const host = new HeadlessHost(projectWith(cloned));
    const res = await executeTool(
      "duplicate_motion_composition",
      { compositionId: COMP_ID, name: "Copy" },
      host,
    );
    expect(res.ok).toBe(true);
    const newId = dataRecord(res.data).compositionId as string;
    expect(newId).not.toBe(COMP_ID);
    const dup = compFrom(host, newId);
    expect(dup.name).toBe("Copy");
    expect(dup.layers.length).toBe(1);
    expect(dup.layers[0].id).not.toBe(SHAPE_ID);
    expect(dup.layers[0].keyframes[0].id).not.toBe("kf-orig");
    expect(compFrom(host, COMP_ID).layers[0].id).toBe(SHAPE_ID);
  });

  it("regenerates nested mask/effect/expression ids and rewrites references", async () => {
    const base = baseComposition();
    const shape = base.layers[0] as MotionShapeLayer;
    const layerWithNested: MotionLayer = {
      ...shape,
      masks: [
        {
          id: "mask-orig",
          name: "Mask",
          enabled: true,
          shape: "rectangle",
          mode: "add",
          inverted: false,
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          rotation: 0,
        },
      ],
      effects: [
        {
          id: "effect-orig",
          type: "blur",
          name: "Blur",
          enabled: true,
          radius: 4,
        },
      ],
      expressions: [
        {
          id: "expr-orig",
          property: "effect.effect-orig.radius",
          type: "wiggle",
          name: "Wiggle",
          enabled: true,
          amplitude: 10,
          frequency: 2,
          phase: 0,
          seed: 1,
          decay: 0,
        },
      ],
      keyframes: [
        {
          id: "kf-mask",
          property: "mask.mask-orig.opacity",
          time: 0,
          value: 1,
          easing: "ease",
        },
        {
          id: "kf-effect",
          property: "effect.effect-orig.radius",
          time: 0,
          value: 4,
          easing: "ease",
        },
      ],
    } as MotionLayer;
    const withNested: MotionComposition = { ...base, layers: [layerWithNested] };
    const host = new HeadlessHost(projectWith(withNested));
    const res = await executeTool(
      "duplicate_motion_composition",
      { compositionId: COMP_ID, name: "Copy" },
      host,
    );
    expect(res.ok).toBe(true);
    const newId = dataRecord(res.data).compositionId as string;
    const dupLayer = compFrom(host, newId).layers[0] as MotionShapeLayer;

    const newMaskId = dupLayer.masks![0].id;
    const newEffectId = dupLayer.effects![0].id;
    expect(newMaskId).not.toBe("mask-orig");
    expect(newEffectId).not.toBe("effect-orig");
    expect(dupLayer.expressions![0].id).not.toBe("expr-orig");

    const maskKey = dupLayer.keyframes.find((kf) => kf.property.startsWith("mask."))!;
    const effectKey = dupLayer.keyframes.find((kf) =>
      kf.property.startsWith("effect."),
    )!;
    expect(maskKey.property).toBe(`mask.${newMaskId}.opacity`);
    expect(effectKey.property).toBe(`effect.${newEffectId}.radius`);
    expect(dupLayer.expressions![0].property).toBe(`effect.${newEffectId}.radius`);

    const original = compFrom(host, COMP_ID).layers[0] as MotionShapeLayer;
    expect(original.masks![0].id).toBe("mask-orig");
    expect(original.effects![0].id).toBe("effect-orig");
    expect(original.expressions![0].id).toBe("expr-orig");
  });
});

describe("beat markers CRUD + sync returns times (gap 46, 28)", () => {
  it("sets and removes an individual beat marker", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const setRes = await executeTool(
      "set_motion_beat_markers",
      { compositionId: COMP_ID, times: [0, 0.5, 1, 1.5] },
      host,
    );
    expect(setRes.ok).toBe(true);
    expect(compFrom(host).beatMarkers?.length).toBe(4);

    const removeRes = await executeTool(
      "remove_motion_beat_marker",
      { compositionId: COMP_ID, index: 1 },
      host,
    );
    expect(removeRes.ok).toBe(true);
    expect(compFrom(host).beatMarkers?.length).toBe(3);
  });

  it("sync_motion_to_audio returns detected/generated marker times", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const res = await executeTool(
      "sync_motion_to_audio",
      { compositionId: COMP_ID, bpm: 120, sensitivity: 0.7, startTime: 0.25 },
      host,
    );
    expect(res.ok).toBe(true);
    const times = dataRecord(res.data).markerTimes;
    expect(Array.isArray(times)).toBe(true);
    expect((times as number[]).length).toBeGreaterThan(0);
  });
});

describe("apply_motion_preset_to_beats (gap 28)", () => {
  it("applies a preset at each beat", async () => {
    const host = new HeadlessHost(
      projectWith(
        baseComposition({
          beatMarkers: [
            { time: 0, strength: 1, index: 0, isDownbeat: true },
            { time: 1, strength: 0.7, index: 1, isDownbeat: false },
            { time: 2, strength: 1, index: 2, isDownbeat: true },
          ],
        }),
      ),
    );
    const res = await executeTool(
      "apply_motion_preset_to_beats",
      { compositionId: COMP_ID, layerId: SHAPE_ID, presetId: "pulse" },
      host,
    );
    expect(res.ok).toBe(true);
    expect(layerFrom(host).keyframes.length).toBeGreaterThan(0);
  });
});

describe("variable type/delete (gap 47)", () => {
  it("changes the variable type and deletes a variable", async () => {
    const withVar = baseComposition({
      variables: [{ id: "var-1", name: "Speed", type: "number", value: 5 }],
    });
    const host = new HeadlessHost(projectWith(withVar));
    const res = await executeTool(
      "update_motion_variable",
      { compositionId: COMP_ID, variableId: "var-1", variableType: "text", value: "hello" },
      host,
    );
    expect(res.ok).toBe(true);
    const variable = compFrom(host).variables.find((v) => v.id === "var-1")!;
    expect(variable.type).toBe("text");
    expect(variable.value).toBe("hello");

    const del = await executeTool(
      "delete_motion_variable",
      { compositionId: COMP_ID, variableId: "var-1" },
      host,
    );
    expect(del.ok).toBe(true);
    expect(compFrom(host).variables.length).toBe(0);
  });
});

describe("update_motion_shape_modifier repeater transform routing (gap 26)", () => {
  it("routes nested repeater transform.* fields into the modifier transform", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const add = await executeTool(
      "add_motion_shape_modifier",
      { compositionId: COMP_ID, layerId: SHAPE_ID, modifierType: "repeater" },
      host,
    );
    expect(add.ok).toBe(true);
    const modifierId = dataRecord(add.data).modifierId as string;
    const res = await executeTool(
      "update_motion_shape_modifier",
      {
        compositionId: COMP_ID,
        layerId: SHAPE_ID,
        modifierId,
        fields: {
          copies: 8,
          "position.x": 120,
          "scale.y": 1.5,
          rotation: 30,
        },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = layerFrom(host) as MotionShapeLayer;
    const modifier = (layer.modifiers ?? []).find((m) => m.id === modifierId);
    expect(modifier?.type).toBe("repeater");
    if (modifier?.type === "repeater") {
      expect(modifier.copies).toBe(8);
      expect(modifier.transform.position.x).toBe(120);
      expect(modifier.transform.scale.y).toBeCloseTo(1.5, 3);
      expect(modifier.transform.rotation).toBe(30);
    }
  });
});

describe("set_motion_time_remap (gap 27)", () => {
  function compWithPrecomp(): MotionComposition {
    const precomp: MotionCompositionLayer = {
      id: "precomp-1",
      type: "composition",
      name: "Precomp",
      startTime: 0,
      duration: 6,
      visible: true,
      locked: false,
      transform: DEFAULT_MOTION_TRANSFORM,
      keyframes: [],
      compositionId: "nested-comp",
      width: 1280,
      height: 720,
      timeOffset: 0,
      playbackRate: 1,
      fit: "fill",
    };
    return baseComposition({ layers: [precomp as MotionLayer] });
  }

  it("enables time remap keyframes on a composition layer", async () => {
    const host = new HeadlessHost(projectWith(compWithPrecomp()));
    const res = await executeTool(
      "set_motion_time_remap",
      { compositionId: COMP_ID, compositionLayerId: "precomp-1", enable: true },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = layerFrom(host, "precomp-1");
    const remapKeys = layer.keyframes.filter(
      (kf) => kf.property === MOTION_COMPOSITION_TIME_PROPERTY,
    );
    expect(remapKeys.length).toBeGreaterThanOrEqual(2);
  });

  it("reverses time remap so the first value exceeds the last", async () => {
    const host = new HeadlessHost(projectWith(compWithPrecomp()));
    const res = await executeTool(
      "set_motion_time_remap",
      { compositionId: COMP_ID, compositionLayerId: "precomp-1", reverse: true },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = layerFrom(host, "precomp-1");
    const remapKeys = layer.keyframes
      .filter((kf) => kf.property === MOTION_COMPOSITION_TIME_PROPERTY)
      .sort((a, b) => a.time - b.time);
    expect(remapKeys[0].value as number).toBeGreaterThan(
      remapKeys[remapKeys.length - 1].value as number,
    );
  });

  it("rejects a non-composition layer", async () => {
    const host = new HeadlessHost(projectWith(baseComposition()));
    const res = await executeTool(
      "set_motion_time_remap",
      { compositionId: COMP_ID, compositionLayerId: SHAPE_ID, enable: true },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});
