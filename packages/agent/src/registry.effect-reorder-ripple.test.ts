import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import { createMotionEffect } from "@openreel/core/motion/motion-effects";
import type {
  MotionComposition,
  MotionEffect,
  MotionLayer,
  MotionShapeLayer,
} from "@openreel/core/motion/types";
import type { Project } from "@openreel/core/types/project";

const COMP_ID = "comp-reorder-ripple";

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

function effect(id: string): MotionEffect {
  return createMotionEffect("blur", id);
}

function shapeLayer(id: string, overrides: Partial<MotionShapeLayer> = {}): MotionShapeLayer {
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
    ...overrides,
  } as MotionShapeLayer;
}

function projectWith(layers: MotionLayer[]): Project {
  const composition: MotionComposition = {
    id: COMP_ID,
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 10,
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

function layerById<T extends MotionLayer = MotionLayer>(host: HeadlessHost, id: string): T {
  return comp(host).layers.find((layer) => layer.id === id) as T;
}

describe("#16 reorder_motion_effect", () => {
  it("moves an effect up in the stack", async () => {
    const host = new HeadlessHost(
      projectWith([shapeLayer("s1", { effects: [effect("e1"), effect("e2")] }) as MotionLayer]),
    );
    const res = await executeTool(
      "reorder_motion_effect",
      { compositionId: COMP_ID, layerId: "s1", effectId: "e2", direction: "up" },
      host,
    );
    expect(res.ok).toBe(true);
    const order = (layerById(host, "s1").effects ?? []).map((e) => e.id);
    expect(order).toEqual(["e2", "e1"]);
  });

  it("moves an effect down in the stack", async () => {
    const host = new HeadlessHost(
      projectWith([shapeLayer("s1", { effects: [effect("e1"), effect("e2")] }) as MotionLayer]),
    );
    const res = await executeTool(
      "reorder_motion_effect",
      { compositionId: COMP_ID, layerId: "s1", effectId: "e1", direction: "down" },
      host,
    );
    expect(res.ok).toBe(true);
    const order = (layerById(host, "s1").effects ?? []).map((e) => e.id);
    expect(order).toEqual(["e2", "e1"]);
  });

  it("fails when the move would go out of bounds", async () => {
    const host = new HeadlessHost(
      projectWith([shapeLayer("s1", { effects: [effect("e1"), effect("e2")] }) as MotionLayer]),
    );
    const res = await executeTool(
      "reorder_motion_effect",
      { compositionId: COMP_ID, layerId: "s1", effectId: "e1", direction: "up" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects an invalid direction", async () => {
    const host = new HeadlessHost(
      projectWith([shapeLayer("s1", { effects: [effect("e1"), effect("e2")] }) as MotionLayer]),
    );
    const res = await executeTool(
      "reorder_motion_effect",
      { compositionId: COMP_ID, layerId: "s1", effectId: "e1", direction: "sideways" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("fails when the effect does not exist", async () => {
    const host = new HeadlessHost(
      projectWith([shapeLayer("s1", { effects: [effect("e1")] }) as MotionLayer]),
    );
    const res = await executeTool(
      "reorder_motion_effect",
      { compositionId: COMP_ID, layerId: "s1", effectId: "nope", direction: "up" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

describe("#45 ripple_motion_layers", () => {
  it("shifts layers at or after fromTime by delta", async () => {
    const host = new HeadlessHost(
      projectWith([
        shapeLayer("a", { startTime: 0, duration: 2 }) as MotionLayer,
        shapeLayer("b", { startTime: 2, duration: 2 }) as MotionLayer,
        shapeLayer("c", { startTime: 4, duration: 2 }) as MotionLayer,
      ]),
    );
    const res = await executeTool(
      "ripple_motion_layers",
      { compositionId: COMP_ID, fromTime: 2, delta: 1 },
      host,
    );
    expect(res.ok).toBe(true);
    expect(layerById(host, "a").startTime).toBeCloseTo(0);
    expect(layerById(host, "b").startTime).toBeCloseTo(3);
    expect(layerById(host, "c").startTime).toBeCloseTo(5);
  });

  it("excludes named layers from the shift", async () => {
    const host = new HeadlessHost(
      projectWith([
        shapeLayer("b", { startTime: 2, duration: 2 }) as MotionLayer,
        shapeLayer("c", { startTime: 4, duration: 2 }) as MotionLayer,
      ]),
    );
    const res = await executeTool(
      "ripple_motion_layers",
      { compositionId: COMP_ID, fromTime: 0, delta: 1, excludeLayerIds: ["b"] },
      host,
    );
    expect(res.ok).toBe(true);
    expect(layerById(host, "b").startTime).toBeCloseTo(2);
    expect(layerById(host, "c").startTime).toBeCloseTo(5);
  });

  it("requires a finite fromTime and delta", async () => {
    const host = new HeadlessHost(
      projectWith([shapeLayer("a", { startTime: 0, duration: 2 }) as MotionLayer]),
    );
    const res = await executeTool(
      "ripple_motion_layers",
      { compositionId: COMP_ID, fromTime: 2 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects a zero delta as a no-op", async () => {
    const host = new HeadlessHost(
      projectWith([shapeLayer("a", { startTime: 0, duration: 2 }) as MotionLayer]),
    );
    const res = await executeTool(
      "ripple_motion_layers",
      { compositionId: COMP_ID, fromTime: 0, delta: 0 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("fails for a missing composition", async () => {
    const host = new HeadlessHost(projectWith([]));
    const res = await executeTool(
      "ripple_motion_layers",
      { compositionId: "nope", fromTime: 0, delta: 1 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});
