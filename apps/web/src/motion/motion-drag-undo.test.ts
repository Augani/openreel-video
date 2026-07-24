import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MOTION_TRANSFORM,
  DEFAULT_SHAPE_STYLE,
  buildMotionPathData,
  type MotionComposition,
  type MotionShapePathPoint,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { createEmptyProject } from "../stores/project/project-helpers";

function baseComposition(): MotionComposition {
  return {
    id: "comp-drag",
    name: "Drag Composition",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 5,
    backgroundColor: "transparent",
    layers: [
      {
        id: "layer-1",
        type: "shape",
        name: "Box",
        startTime: 0,
        duration: 5,
        visible: true,
        locked: false,
        transform: {
          ...DEFAULT_MOTION_TRANSFORM,
          position: { x: 0, y: 0 },
        },
        keyframes: [],
        shapeType: "rectangle",
        width: 100,
        height: 100,
        style: DEFAULT_SHAPE_STYLE,
      },
    ],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  } as MotionComposition;
}

function moveLayerX(composition: MotionComposition, x: number): MotionComposition {
  return {
    ...composition,
    layers: composition.layers.map((layer) =>
      layer.id === "layer-1"
        ? {
            ...layer,
            transform: {
              ...layer.transform,
              position: { ...layer.transform.position, x },
            },
          }
        : layer,
    ),
  };
}

function getComposition(id: string): MotionComposition {
  const composition = (
    useProjectStore.getState().project.motionCompositions ?? []
  ).find((candidate) => candidate.id === id);
  if (!composition) {
    throw new Error(`Composition ${id} not found`);
  }
  return composition;
}

function undoStackSize(): number {
  return useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();
}

describe("motion drag undo coalescing", () => {
  beforeEach(async () => {
    useProjectStore.setState({ project: createEmptyProject("Drag Test") });
    useProjectStore.getState().actionExecutor.getHistory().clear();
    await useProjectStore.getState().upsertMotionComposition(baseComposition());
  });

  it("preview updates re-render state without adding undo entries", () => {
    const before = getComposition("comp-drag");
    const startSize = undoStackSize();

    for (let step = 1; step <= 5; step += 1) {
      useProjectStore
        .getState()
        .updateMotionCompositionPreview(moveLayerX(before, step * 10));
    }

    expect(undoStackSize()).toBe(startSize);
    expect(getComposition("comp-drag").layers[0].transform.position.x).toBe(50);
  });

  it("commits a coalesced gesture as exactly one undoable action", async () => {
    const before = getComposition("comp-drag");
    const startSize = undoStackSize();

    for (let step = 1; step <= 5; step += 1) {
      useProjectStore
        .getState()
        .updateMotionCompositionPreview(moveLayerX(before, step * 10));
    }

    const after = getComposition("comp-drag");
    await useProjectStore
      .getState()
      .commitMotionCompositionGesture(before, after);

    expect(undoStackSize()).toBe(startSize + 1);
    expect(getComposition("comp-drag").layers[0].transform.position.x).toBe(50);

    await useProjectStore.getState().undo();

    expect(undoStackSize()).toBe(startSize);
    expect(getComposition("comp-drag").layers[0].transform.position.x).toBe(0);
  });

  it("skips the commit when the gesture did not change the composition", async () => {
    const before = getComposition("comp-drag");
    const startSize = undoStackSize();

    await useProjectStore
      .getState()
      .commitMotionCompositionGesture(before, before);

    expect(undoStackSize()).toBe(startSize);
  });
});

function withPathLayer(
  composition: MotionComposition,
  points: readonly MotionShapePathPoint[],
): MotionComposition {
  return {
    ...composition,
    layers: [
      ...composition.layers,
      {
        id: "pen-layer",
        type: "shape",
        name: "Path Layer",
        startTime: 0,
        duration: 5,
        visible: true,
        locked: false,
        transform: { ...DEFAULT_MOTION_TRANSFORM },
        keyframes: [],
        shapeType: "path",
        width: 4,
        height: 4,
        pathData: buildMotionPathData(points),
        pathClosed: false,
        style: DEFAULT_SHAPE_STYLE,
      },
    ],
  } as MotionComposition;
}

function setPenLayerPath(
  composition: MotionComposition,
  points: readonly MotionShapePathPoint[],
): MotionComposition {
  return {
    ...composition,
    layers: composition.layers.map((layer) =>
      layer.id === "pen-layer"
        ? { ...layer, pathData: buildMotionPathData(points) }
        : layer,
    ),
  };
}

describe("pen draft undo coalescing", () => {
  beforeEach(async () => {
    useProjectStore.setState({ project: createEmptyProject("Pen Test") });
    useProjectStore.getState().actionExecutor.getHistory().clear();
    await useProjectStore.getState().upsertMotionComposition(baseComposition());
  });

  it("commits a full vertex curve-pull as exactly one undoable action", async () => {
    const before = getComposition("comp-drag");
    const startSize = undoStackSize();

    const anchor: MotionShapePathPoint = { x: 100, y: 100 };
    const withVertex = withPathLayer(before, [anchor]);
    useProjectStore.getState().updateMotionCompositionPreview(withVertex);

    for (let step = 1; step <= 6; step += 1) {
      const dragged: MotionShapePathPoint = {
        ...anchor,
        outX: anchor.x + step * 5,
        outY: anchor.y + step * 5,
        inX: anchor.x - step * 5,
        inY: anchor.y - step * 5,
      };
      useProjectStore
        .getState()
        .updateMotionCompositionPreview(setPenLayerPath(withVertex, [dragged]));
    }

    const after = getComposition("comp-drag");
    await useProjectStore
      .getState()
      .commitMotionCompositionGesture(before, after);

    expect(undoStackSize()).toBe(startSize + 1);
    expect(
      getComposition("comp-drag").layers.some(
        (layer) => layer.id === "pen-layer",
      ),
    ).toBe(true);

    await useProjectStore.getState().undo();

    expect(undoStackSize()).toBe(startSize);
    expect(
      getComposition("comp-drag").layers.some(
        (layer) => layer.id === "pen-layer",
      ),
    ).toBe(false);
  });

  it("previews the draft without adding undo entries until commit", () => {
    const before = getComposition("comp-drag");
    const startSize = undoStackSize();

    for (let step = 1; step <= 4; step += 1) {
      const points: MotionShapePathPoint[] = Array.from(
        { length: step },
        (_unused, index) => ({ x: index * 20, y: 0 }),
      );
      useProjectStore
        .getState()
        .updateMotionCompositionPreview(withPathLayer(before, points));
    }

    expect(undoStackSize()).toBe(startSize);
  });
});
