import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import type {
  MotionComposition,
  MotionCompositionLayer,
  MotionLayer,
  MotionShapeLayer,
} from "@openreel/core/motion/types";
import type { Project } from "@openreel/core/types/project";

const COMP_ID = "comp-layer-ops";

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

describe("#10 set_motion_layer_name", () => {
  it("renames a layer", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "set_motion_layer_name",
      { compositionId: COMP_ID, layerId: "s1", name: "Hero Card" },
      host,
    );
    expect(res.ok).toBe(true);
    expect(layerById(host, "s1").name).toBe("Hero Card");
  });

  it("rejects empty names", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "set_motion_layer_name",
      { compositionId: COMP_ID, layerId: "s1", name: "   " },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("fails for missing layer", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "set_motion_layer_name",
      { compositionId: COMP_ID, layerId: "nope", name: "X" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

describe("#11 duplicate_motion_layer", () => {
  it("duplicates a single layer and returns duplicatedLayerIds", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "duplicate_motion_layer",
      { compositionId: COMP_ID, layerId: "s1" },
      host,
    );
    expect(res.ok).toBe(true);
    const ids = data(res.data).duplicatedLayerIds as string[];
    expect(ids.length).toBe(1);
    expect(comp(host).layers.length).toBe(2);
    expect(layerById(host, ids[0]).name).toBe("s1 Copy");
  });

  it("duplicates multiple layers via layerIds", async () => {
    const host = new HeadlessHost(
      projectWith([shapeLayer("s1") as MotionLayer, shapeLayer("s2") as MotionLayer]),
    );
    const res = await executeTool(
      "duplicate_motion_layer",
      { compositionId: COMP_ID, layerIds: ["s1", "s2"] },
      host,
    );
    expect(res.ok).toBe(true);
    const ids = data(res.data).duplicatedLayerIds as string[];
    expect(ids.length).toBe(2);
    expect(comp(host).layers.length).toBe(4);
  });

  it("requires layerId or layerIds", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "duplicate_motion_layer",
      { compositionId: COMP_ID },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("#21 set_motion_layer_solo", () => {
  it("solos a layer", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "set_motion_layer_solo",
      { compositionId: COMP_ID, layerId: "s1", solo: true },
      host,
    );
    expect(res.ok).toBe(true);
    expect(layerById(host, "s1").solo).toBe(true);
  });

  it("clears solo", async () => {
    const host = new HeadlessHost(
      projectWith([shapeLayer("s1", { solo: true }) as MotionLayer]),
    );
    const res = await executeTool(
      "set_motion_layer_solo",
      { compositionId: COMP_ID, layerId: "s1", solo: false },
      host,
    );
    expect(res.ok).toBe(true);
    expect(layerById(host, "s1").solo).toBe(false);
  });

  it("requires the solo boolean", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "set_motion_layer_solo",
      { compositionId: COMP_ID, layerId: "s1" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("#36 set_motion_layer_guide", () => {
  it("toggles guideLayer on", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "set_motion_layer_guide",
      { compositionId: COMP_ID, layerId: "s1", guideLayer: true },
      host,
    );
    expect(res.ok).toBe(true);
    expect(layerById(host, "s1").guideLayer).toBe(true);
  });

  it("requires the guideLayer boolean", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "set_motion_layer_guide",
      { compositionId: COMP_ID, layerId: "s1" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("#23 set_motion_layer_3d", () => {
  it("enables preserve-3d", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "set_motion_layer_3d",
      { compositionId: COMP_ID, layerId: "s1", preserve3d: true },
      host,
    );
    expect(res.ok).toBe(true);
    expect(layerById(host, "s1").transform.transformStyle).toBe("preserve-3d");
  });

  it("resets to flat", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    await executeTool(
      "set_motion_layer_3d",
      { compositionId: COMP_ID, layerId: "s1", preserve3d: true },
      host,
    );
    const res = await executeTool(
      "set_motion_layer_3d",
      { compositionId: COMP_ID, layerId: "s1", preserve3d: false },
      host,
    );
    expect(res.ok).toBe(true);
    expect(layerById(host, "s1").transform.transformStyle).toBe("flat");
  });

  it("requires preserve3d", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "set_motion_layer_3d",
      { compositionId: COMP_ID, layerId: "s1" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("#5 set_motion_layer_timing", () => {
  it("moves startTime and duration", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "set_motion_layer_timing",
      { compositionId: COMP_ID, layerId: "s1", startTime: 2, duration: 3 },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = layerById(host, "s1");
    expect(layer.startTime).toBe(2);
    expect(layer.duration).toBe(3);
  });

  it("only changes fields provided", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "set_motion_layer_timing",
      { compositionId: COMP_ID, layerId: "s1", startTime: 1 },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = layerById(host, "s1");
    expect(layer.startTime).toBe(1);
    expect(layer.duration).toBe(4);
  });

  it("requires at least one of startTime/duration", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "set_motion_layer_timing",
      { compositionId: COMP_ID, layerId: "s1" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("#5 trim_motion_layer", () => {
  it("trims the in point", async () => {
    const host = new HeadlessHost(
      projectWith([shapeLayer("s1", { startTime: 1, duration: 5 }) as MotionLayer]),
    );
    const res = await executeTool(
      "trim_motion_layer",
      { compositionId: COMP_ID, layerId: "s1", edge: "in", time: 2 },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = layerById(host, "s1");
    expect(layer.startTime).toBe(2);
    expect(layer.duration).toBe(4);
  });

  it("trims the out point", async () => {
    const host = new HeadlessHost(
      projectWith([shapeLayer("s1", { startTime: 1, duration: 5 }) as MotionLayer]),
    );
    const res = await executeTool(
      "trim_motion_layer",
      { compositionId: COMP_ID, layerId: "s1", edge: "out", time: 4 },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = layerById(host, "s1");
    expect(layer.startTime).toBe(1);
    expect(layer.duration).toBe(3);
  });

  it("rejects an invalid edge", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "trim_motion_layer",
      { compositionId: COMP_ID, layerId: "s1", edge: "middle", time: 2 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("#5 split_motion_layer", () => {
  it("splits and returns both layer ids", async () => {
    const host = new HeadlessHost(
      projectWith([shapeLayer("s1", { startTime: 0, duration: 6 }) as MotionLayer]),
    );
    const res = await executeTool(
      "split_motion_layer",
      { compositionId: COMP_ID, layerId: "s1", time: 3 },
      host,
    );
    expect(res.ok).toBe(true);
    const ids = data(res.data).layerIds as string[];
    expect(ids.length).toBe(2);
    expect(comp(host).layers.length).toBe(2);
    const first = layerById(host, ids[0]);
    const second = layerById(host, ids[1]);
    expect(first.duration).toBeCloseTo(3);
    expect(second.startTime).toBeCloseTo(3);
  });

  it("fails when the time is outside the layer span", async () => {
    const host = new HeadlessHost(
      projectWith([shapeLayer("s1", { startTime: 0, duration: 6 }) as MotionLayer]),
    );
    const res = await executeTool(
      "split_motion_layer",
      { compositionId: COMP_ID, layerId: "s1", time: 20 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

function precompLayer(id: string): MotionCompositionLayer {
  return {
    ...baseLayer(id),
    type: "composition",
    compositionId: "referenced",
    width: 640,
    height: 360,
    timeOffset: 0,
    playbackRate: 1,
    startTime: 1,
    duration: 4,
  } as MotionCompositionLayer;
}

describe("#45 slip_motion_layer", () => {
  it("shifts the timeOffset without moving startTime/duration", async () => {
    const host = new HeadlessHost(
      projectWith([precompLayer("p1") as MotionLayer]),
    );
    const res = await executeTool(
      "slip_motion_layer",
      { compositionId: COMP_ID, layerId: "p1", delta: 0.5 },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = layerById(host, "p1") as MotionCompositionLayer;
    expect(layer.startTime).toBe(1);
    expect(layer.duration).toBe(4);
    expect(layer.timeOffset).toBeCloseTo(0.5);
  });

  it("scales the timeOffset shift by the layer playbackRate", async () => {
    const host = new HeadlessHost(
      projectWith([
        { ...precompLayer("p1"), playbackRate: 2 } as MotionLayer,
      ]),
    );
    const res = await executeTool(
      "slip_motion_layer",
      { compositionId: COMP_ID, layerId: "p1", delta: 0.5 },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = layerById(host, "p1") as MotionCompositionLayer;
    expect(layer.startTime).toBe(1);
    expect(layer.duration).toBe(4);
    expect(layer.timeOffset).toBeCloseTo(1);
  });

  it("requires a finite delta", async () => {
    const host = new HeadlessHost(
      projectWith([precompLayer("p1") as MotionLayer]),
    );
    const res = await executeTool(
      "slip_motion_layer",
      { compositionId: COMP_ID, layerId: "p1" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects layers without a source time offset", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "slip_motion_layer",
      { compositionId: COMP_ID, layerId: "s1", delta: 0.5 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("#45 ripple_delete_motion_layer", () => {
  it("removes the layer and closes the gap for later layers", async () => {
    const host = new HeadlessHost(
      projectWith([
        shapeLayer("a", { startTime: 0, duration: 2 }) as MotionLayer,
        shapeLayer("b", { startTime: 2, duration: 2 }) as MotionLayer,
        shapeLayer("c", { startTime: 4, duration: 2 }) as MotionLayer,
      ]),
    );
    const res = await executeTool(
      "ripple_delete_motion_layer",
      { compositionId: COMP_ID, layerId: "b" },
      host,
    );
    expect(res.ok).toBe(true);
    expect(comp(host).layers.find((l) => l.id === "b")).toBeUndefined();
    expect(layerById(host, "c").startTime).toBeCloseTo(2);
  });

  it("fails for a missing layer", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("a") as MotionLayer]));
    const res = await executeTool(
      "ripple_delete_motion_layer",
      { compositionId: COMP_ID, layerId: "nope" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

describe("#37 create_motion_null_controller", () => {
  it("creates a null controller parenting the selected layers", async () => {
    const host = new HeadlessHost(
      projectWith([shapeLayer("s1") as MotionLayer, shapeLayer("s2") as MotionLayer]),
    );
    const res = await executeTool(
      "create_motion_null_controller",
      { compositionId: COMP_ID, layerIds: ["s1", "s2"], name: "Rig" },
      host,
    );
    expect(res.ok).toBe(true);
    const controllerId = String(data(res.data).controllerLayerId);
    const controller = layerById(host, controllerId);
    expect(controller.type).toBe("null");
    expect(layerById(host, "s1").parentId).toBe(controllerId);
    expect(layerById(host, "s2").parentId).toBe(controllerId);
  });

  it("requires at least one non-null layer", async () => {
    const host = new HeadlessHost(projectWith([shapeLayer("s1") as MotionLayer]));
    const res = await executeTool(
      "create_motion_null_controller",
      { compositionId: COMP_ID, layerIds: [] },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("#38 add/move/remove_motion_guide", () => {
  it("adds a guide", async () => {
    const host = new HeadlessHost(projectWith([]));
    const res = await executeTool(
      "add_motion_guide",
      { compositionId: COMP_ID, orientation: "vertical", position: 640 },
      host,
    );
    expect(res.ok).toBe(true);
    const guideId = String(data(res.data).guideId);
    const guide = (comp(host).guides ?? []).find((g) => g.id === guideId)!;
    expect(guide.orientation).toBe("vertical");
    expect(guide.position).toBe(640);
  });

  it("moves a guide", async () => {
    const host = new HeadlessHost(projectWith([]));
    const added = await executeTool(
      "add_motion_guide",
      { compositionId: COMP_ID, orientation: "horizontal", position: 100 },
      host,
    );
    const guideId = String(data(added.data).guideId);
    const res = await executeTool(
      "move_motion_guide",
      { compositionId: COMP_ID, guideId, position: 250 },
      host,
    );
    expect(res.ok).toBe(true);
    const guide = (comp(host).guides ?? []).find((g) => g.id === guideId)!;
    expect(guide.position).toBe(250);
  });

  it("removes a guide", async () => {
    const host = new HeadlessHost(projectWith([]));
    const added = await executeTool(
      "add_motion_guide",
      { compositionId: COMP_ID, orientation: "vertical", position: 300 },
      host,
    );
    const guideId = String(data(added.data).guideId);
    const res = await executeTool(
      "remove_motion_guide",
      { compositionId: COMP_ID, guideId },
      host,
    );
    expect(res.ok).toBe(true);
    expect((comp(host).guides ?? []).find((g) => g.id === guideId)).toBeUndefined();
  });

  it("rejects an invalid orientation", async () => {
    const host = new HeadlessHost(projectWith([]));
    const res = await executeTool(
      "add_motion_guide",
      { compositionId: COMP_ID, orientation: "diagonal", position: 100 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});
