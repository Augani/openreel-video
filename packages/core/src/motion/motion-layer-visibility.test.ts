import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  getMotionSoloLayerIds,
  hasMotionSoloLayers,
  isMotionGuideLayer,
  isMotionLayerContentVisible,
  isMotionLayerTreeVisible,
} from "./motion-layer-visibility";

const makeLayer = (
  id: string,
  updates: Partial<MotionLayer> = {},
): MotionLayer =>
  ({
    id,
    type: "shape",
    name: id,
    startTime: 0,
    duration: 5,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 100,
    height: 100,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 1 },
      stroke: { color: "#14b8a6", width: 0, opacity: 0 },
      cornerRadius: 0,
    },
    ...updates,
  }) as MotionLayer;

const makeComposition = (layers: MotionLayer[]): MotionComposition => ({
  id: "motion-1",
  name: "Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers,
  assets: [],
  variables: [],
  markers: [],
  createdAt: 0,
  modifiedAt: 0,
});

describe("motion layer visibility", () => {
  it("keeps normal layers visible and skips guide layer render content", () => {
    const normal = makeLayer("normal");
    const guide = makeLayer("guide", { guideLayer: true });
    const composition = makeComposition([normal, guide]);
    const soloLayerIds = getMotionSoloLayerIds(composition);

    expect(hasMotionSoloLayers(composition)).toBe(false);
    expect(isMotionLayerTreeVisible(composition, normal, soloLayerIds)).toBe(
      true,
    );
    expect(isMotionLayerContentVisible(composition, normal, soloLayerIds)).toBe(
      true,
    );
    expect(isMotionGuideLayer(guide)).toBe(true);
    expect(isMotionLayerTreeVisible(composition, guide, soloLayerIds)).toBe(
      true,
    );
    expect(isMotionLayerContentVisible(composition, guide, soloLayerIds)).toBe(
      false,
    );
  });

  it("keeps a solo child parent tree visible without rendering parent content", () => {
    const parent = makeLayer("parent");
    const child = makeLayer("child", { parentId: "parent", solo: true });
    const sibling = makeLayer("sibling");
    const composition = makeComposition([parent, child, sibling]);
    const soloLayerIds = getMotionSoloLayerIds(composition);

    expect([...soloLayerIds]).toEqual(["child"]);
    expect(hasMotionSoloLayers(composition)).toBe(true);
    expect(isMotionLayerTreeVisible(composition, parent, soloLayerIds)).toBe(
      true,
    );
    expect(isMotionLayerContentVisible(composition, parent, soloLayerIds)).toBe(
      false,
    );
    expect(isMotionLayerTreeVisible(composition, child, soloLayerIds)).toBe(
      true,
    );
    expect(isMotionLayerContentVisible(composition, child, soloLayerIds)).toBe(
      true,
    );
    expect(isMotionLayerTreeVisible(composition, sibling, soloLayerIds)).toBe(
      false,
    );
    expect(isMotionLayerContentVisible(composition, sibling, soloLayerIds)).toBe(
      false,
    );
  });

  it("renders descendant content when an ancestor is soloed", () => {
    const parent = makeLayer("parent", { solo: true });
    const child = makeLayer("child", { parentId: "parent" });
    const grandchild = makeLayer("grandchild", { parentId: "child" });
    const composition = makeComposition([parent, child, grandchild]);
    const soloLayerIds = getMotionSoloLayerIds(composition);

    expect(isMotionLayerContentVisible(composition, parent, soloLayerIds)).toBe(
      true,
    );
    expect(isMotionLayerTreeVisible(composition, child, soloLayerIds)).toBe(
      true,
    );
    expect(isMotionLayerContentVisible(composition, child, soloLayerIds)).toBe(
      true,
    );
    expect(
      isMotionLayerContentVisible(composition, grandchild, soloLayerIds),
    ).toBe(true);
  });

  it("keeps guide layers out of rendered content even when soloed", () => {
    const guide = makeLayer("guide", { guideLayer: true, solo: true });
    const composition = makeComposition([guide]);
    const soloLayerIds = getMotionSoloLayerIds(composition);

    expect(isMotionLayerTreeVisible(composition, guide, soloLayerIds)).toBe(
      true,
    );
    expect(isMotionLayerContentVisible(composition, guide, soloLayerIds)).toBe(
      false,
    );
  });
});
