import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionComposition,
  type MotionLayer,
  type Project,
} from "@openreel/core";
import {
  createCreationScene,
  createEmptyCreationState,
} from "@openreel/core/creation/index";
import {
  resolveMotionCreatorCompositionId,
  resolveMotionCreatorPreviewTime,
} from "./composition-selection";

function composition(
  id: string,
  layers: MotionComposition["layers"] = [],
): MotionComposition {
  return {
    id,
    name: id,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 5,
    backgroundColor: "transparent",
    layers,
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function scene3dLayer(id: string): Extract<MotionLayer, { type: "scene3d" }> {
  return {
    id,
    type: "scene3d",
    name: id,
    startTime: 0,
    duration: 5,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    object: { kind: "sphere", size: 1 },
  };
}

function scene3dLayerWithKeyframes(
  id: string,
  keyframes: Extract<MotionLayer, { type: "scene3d" }>["keyframes"],
): Extract<MotionLayer, { type: "scene3d" }> {
  return {
    ...scene3dLayer(id),
    keyframes,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "project",
    name: "Project",
    createdAt: 1,
    modifiedAt: 1,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    mediaLibrary: { items: [] },
    timeline: { tracks: [], duration: 0 },
    motionCompositions: [],
    motionInstances: [],
    ...overrides,
  } as Project;
}

describe("resolveMotionCreatorCompositionId", () => {
  it("keeps a valid explicit route composition ahead of timeline usage", () => {
    const starter = composition("starter");
    const timeline = composition("timeline", [scene3dLayer("scene")]);

    expect(
      resolveMotionCreatorCompositionId({
        project: project({
          motionInstances: [
            {
              id: "instance",
              compositionId: "timeline",
              startTime: 0,
              duration: 5,
              transform: DEFAULT_MOTION_TRANSFORM,
              opacity: 1,
            },
          ],
        }),
        compositions: [starter, timeline],
        routeCompositionId: "starter",
      }),
    ).toBe("starter");
  });

  it("prefers timeline-inserted MCP compositions over starter scenes", () => {
    const starter = composition("starter");
    const mcpScene = composition("mcp-scene", [scene3dLayer("astronaut")]);

    expect(
      resolveMotionCreatorCompositionId({
        project: project({
          motionInstances: [
            {
              id: "instance",
              compositionId: "mcp-scene",
              startTime: 0,
              duration: 8,
              transform: DEFAULT_MOTION_TRANSFORM,
              opacity: 1,
            },
          ],
        }),
        compositions: [starter, mcpScene],
      }),
    ).toBe("mcp-scene");
  });

  it("prefers active creation render bindings when no timeline instance exists", () => {
    const starter = composition("starter");
    const boundScene = composition("bound-scene", [scene3dLayer("product")]);
    const creationScene = {
      ...createCreationScene({
        id: "creation-scene",
        name: "Creation Scene",
        now: 1,
      }),
      renderBindings: [
        {
          id: "binding",
          kind: "motion-scene3d" as const,
          compositionId: "bound-scene",
          layerId: "product",
          objectBindings: [],
          createdAt: 1,
          modifiedAt: 1,
        },
      ],
    };

    expect(
      resolveMotionCreatorCompositionId({
        project: project({
          creation: {
            ...createEmptyCreationState({ activeSceneId: "creation-scene" }),
            activeSceneId: "creation-scene",
            scenes: [creationScene],
          },
        }),
        compositions: [starter, boundScene],
      }),
    ).toBe("bound-scene");
  });

  it("falls back to any 3D composition before a plain starter scene", () => {
    const starter = composition("starter");
    const scene = composition("scene3d", [scene3dLayer("object")]);

    expect(
      resolveMotionCreatorCompositionId({
        project: project(),
        compositions: [starter, scene],
      }),
    ).toBe("scene3d");
  });
});

describe("resolveMotionCreatorPreviewTime", () => {
  it("opens regular motion scenes near the middle", () => {
    expect(resolveMotionCreatorPreviewTime(composition("regular"))).toBe(2.5);
  });

  it("opens scene3d compositions on the first visibly opaque object keyframe", () => {
    expect(
      resolveMotionCreatorPreviewTime(
        {
          ...composition("scene", [
            scene3dLayerWithKeyframes("scene-layer", [
              {
                id: "hidden",
                property: "scene.object.astronaut.opacity",
                time: 1,
                value: 0,
                easing: "linear",
              },
              {
                id: "visible",
                property: "scene.object.astronaut.opacity",
                time: 6.4,
                value: 1,
                easing: "linear",
              },
            ]),
          ]),
          duration: 8,
        },
      ),
    ).toBe(7.9);
  });

  it("falls back late for scene3d compositions without opacity cues", () => {
    expect(
      resolveMotionCreatorPreviewTime(
        composition("scene", [scene3dLayer("scene-layer")]),
      ),
    ).toBe(4.25);
  });
});
