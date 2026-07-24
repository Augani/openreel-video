import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import { getMotionLayerPropertyKeyframes } from "@openreel/core/motion/motion-keyframes";
import type {
  MotionComposition,
  MotionLayer,
  MotionShapeLayer,
} from "@openreel/core/motion/types";
import type { Keyframe } from "@openreel/core/types/timeline";
import type { Project } from "@openreel/core/types/project";

const COMPOSITION_ID = "comp-roving-kf";
const LAYER_ID = "layer-shape";
const PROPERTY = "transform.position.x";

function projectWithShape(): Project {
  const shape: MotionShapeLayer = {
    id: LAYER_ID,
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
  const composition: MotionComposition = {
    id: COMPOSITION_ID,
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [shape as MotionLayer],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
  return { ...makeEmptyProject(), motionCompositions: [composition] } as unknown as Project;
}

function shapeLayer(host: HeadlessHost): MotionShapeLayer {
  const comp = host
    .getProject()
    .motionCompositions!.find((candidate) => candidate.id === COMPOSITION_ID)!;
  return comp.layers.find((layer) => layer.id === LAYER_ID) as MotionShapeLayer;
}

async function addKeyframe(
  host: HeadlessHost,
  time: number,
  value: number,
  extra: Record<string, unknown> = {},
): Promise<{ ok: boolean }> {
  return executeTool(
    "add_motion_keyframe",
    { compositionId: COMPOSITION_ID, layerId: LAYER_ID, property: PROPERTY, time, value, ...extra },
    host,
  );
}

function propertyKeyframes(host: HeadlessHost): Keyframe[] {
  return getMotionLayerPropertyKeyframes(shapeLayer(host), PROPERTY);
}

describe("add_motion_keyframe roving", () => {
  it("sets roving:true on a middle keyframe and re-derives its time to the constant-speed position", async () => {
    const host = new HeadlessHost(projectWithShape());
    expect((await addKeyframe(host, 0, 0)).ok).toBe(true);
    expect((await addKeyframe(host, 1, 100)).ok).toBe(true);
    expect((await addKeyframe(host, 2, 200)).ok).toBe(true);
    expect((await addKeyframe(host, 3, 300)).ok).toBe(true);

    const result = await addKeyframe(host, 1, 100, { roving: true });
    expect(result.ok).toBe(true);

    const keyframes = propertyKeyframes(host);
    const middle = keyframes.find((keyframe) => keyframe.value === 100);
    expect(middle).toBeDefined();
    expect(middle!.roving).toBe(true);
    expect(middle!.time).toBeCloseTo(1, 6);
  });

  it("re-derives a roving keyframe time after it is placed off the constant-speed line", async () => {
    const host = new HeadlessHost(projectWithShape());
    expect((await addKeyframe(host, 0, 0)).ok).toBe(true);
    expect((await addKeyframe(host, 2, 100)).ok).toBe(true);
    expect((await addKeyframe(host, 3, 300)).ok).toBe(true);

    const result = await addKeyframe(host, 2, 100, { roving: true });
    expect(result.ok).toBe(true);

    const keyframes = propertyKeyframes(host);
    const middle = keyframes.find((keyframe) => keyframe.value === 100);
    expect(middle).toBeDefined();
    expect(middle!.roving).toBe(true);
    expect(middle!.time).toBeCloseTo(1, 6);
  });

  it("is a no-op when roving is requested on an endpoint keyframe", async () => {
    const host = new HeadlessHost(projectWithShape());
    expect((await addKeyframe(host, 0, 0)).ok).toBe(true);
    expect((await addKeyframe(host, 1, 100)).ok).toBe(true);
    expect((await addKeyframe(host, 2, 200)).ok).toBe(true);

    const result = await addKeyframe(host, 2, 200, { roving: true });
    expect(result.ok).toBe(true);

    const keyframes = propertyKeyframes(host);
    const last = keyframes[keyframes.length - 1];
    expect(last.value).toBe(200);
    expect(last.roving).toBeUndefined();
  });

  it("applies roving on a middle keyframe requested at a non-normalized time", async () => {
    const host = new HeadlessHost(projectWithShape());
    expect((await addKeyframe(host, 0, 0)).ok).toBe(true);
    expect((await addKeyframe(host, 1, 100)).ok).toBe(true);
    expect((await addKeyframe(host, 2, 200)).ok).toBe(true);
    expect((await addKeyframe(host, 3, 300)).ok).toBe(true);

    const result = await addKeyframe(host, 1.00004, 100, { roving: true });
    expect(result.ok).toBe(true);

    const keyframes = propertyKeyframes(host);
    const middle = keyframes.find((keyframe) => keyframe.value === 100);
    expect(middle).toBeDefined();
    expect(middle!.roving).toBe(true);
    expect(middle!.time).toBeCloseTo(1, 6);
  });

  it("ignores a non-boolean roving value", async () => {
    const host = new HeadlessHost(projectWithShape());
    expect((await addKeyframe(host, 0, 0)).ok).toBe(true);
    expect((await addKeyframe(host, 1, 100)).ok).toBe(true);
    expect((await addKeyframe(host, 2, 200)).ok).toBe(true);

    const result = await addKeyframe(host, 1, 100, { roving: "yes" });
    expect(result.ok).toBe(true);

    const keyframes = propertyKeyframes(host);
    const middle = keyframes.find((keyframe) => keyframe.value === 100);
    expect(middle).toBeDefined();
    expect(middle!.roving).toBeUndefined();
  });
});
