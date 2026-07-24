import { describe, it, expect } from "vitest";
import { motionEngine } from "./motion-engine";
import {
  arrangeMotionLayersInGrid,
  arrangeMotionLayersInStack,
  buildMotionFillStyle,
  buildMotionShapeStyle,
  buildMotionUiComponent,
  buildMotionUiLayers,
  computeMotionGridPositions,
  computeMotionStackPositions,
  reflowMotionGroupAutoLayout,
  setMotionGroupAutoLayout,
  type BuildMotionUiLayerContext,
  type MotionUiLayerSpec,
} from "./motion-ui-builder";
import type {
  MotionComposition,
  MotionGroupLayer,
  MotionLayer,
  MotionShapeLayer,
} from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";

function autoLayoutComposition(): MotionComposition {
  const shape = (id: string): MotionShapeLayer => ({
    id,
    type: "shape",
    name: id,
    startTime: 0,
    duration: 5,
    visible: true,
    locked: false,
    parentId: "grp",
    transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 0, y: 0, z: 0 } },
    keyframes: [],
    shapeType: "rectangle",
    width: 100,
    height: 60,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 1 },
      stroke: { color: "#14b8a6", width: 0, opacity: 0 },
      cornerRadius: 0,
    },
  });
  const group: MotionGroupLayer = {
    id: "grp",
    type: "group",
    name: "Group",
    startTime: 0,
    duration: 5,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    children: ["a", "b"],
  };
  const layers: MotionLayer[] = [group, shape("a"), shape("b")];
  return {
    id: "comp",
    name: "Comp",
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
  };
}

describe("group auto-layout", () => {
  it("arranges children in a centered horizontal row (parent-local)", () => {
    const next = setMotionGroupAutoLayout(autoLayoutComposition(), "grp", {
      direction: "horizontal",
      gap: 24,
      align: "center",
    });
    const a = next.layers.find((layer) => layer.id === "a")!;
    const b = next.layers.find((layer) => layer.id === "b")!;
    // total = 100 + 24 + 100 = 224, centered on 0 -> centers at -62 and 62
    expect(a.transform.position.x).toBeCloseTo(-62, 3);
    expect(b.transform.position.x).toBeCloseTo(62, 3);
    expect(a.transform.position.y).toBeCloseTo(0, 3);
  });

  it("is idempotent and clears with null", () => {
    const on = setMotionGroupAutoLayout(autoLayoutComposition(), "grp", {
      direction: "vertical",
      gap: 10,
      align: "center",
    });
    const again = reflowMotionGroupAutoLayout(on, "grp");
    expect(again.layers.find((l) => l.id === "a")!.transform.position.y).toBeCloseTo(
      on.layers.find((l) => l.id === "a")!.transform.position.y,
      5,
    );
    const off = setMotionGroupAutoLayout(on, "grp", null);
    expect(
      (off.layers.find((l) => l.id === "grp") as MotionGroupLayer).autoLayout,
    ).toBeUndefined();
  });

  it("does not reposition a locked child", () => {
    const source = autoLayoutComposition();
    const base: MotionComposition = {
      ...source,
      layers: source.layers.map((layer) =>
        layer.id === "a"
          ? {
              ...layer,
              locked: true,
              transform: {
                ...layer.transform,
                position: { x: 300, y: 12, z: 0 },
              },
            }
          : layer,
      ),
    };
    const next = setMotionGroupAutoLayout(base, "grp", {
      direction: "horizontal",
      gap: 24,
      align: "center",
    });
    const a = next.layers.find((layer) => layer.id === "a")!;
    expect(a.transform.position.x).toBe(300);
    expect(a.transform.position.y).toBe(12);
  });

  it("does not reposition a child with position keyframes", () => {
    const source = autoLayoutComposition();
    const base: MotionComposition = {
      ...source,
      layers: source.layers.map((layer) =>
        layer.id === "a"
          ? {
              ...layer,
              transform: {
                ...layer.transform,
                position: { x: 500, y: 0, z: 0 },
              },
              keyframes: [
                {
                  id: "kf-1",
                  property: "transform.position.x",
                  time: 0,
                  value: 500,
                  easing: "linear",
                },
              ],
            }
          : layer,
      ),
    };
    const next = setMotionGroupAutoLayout(base, "grp", {
      direction: "horizontal",
      gap: 24,
      align: "center",
    });
    expect(
      next.layers.find((layer) => layer.id === "a")!.transform.position.x,
    ).toBe(500);
  });

  it("measures a nested group child by its real content extent", () => {
    const innerShape: MotionShapeLayer = {
      id: "inner-shape",
      type: "shape",
      name: "inner-shape",
      startTime: 0,
      duration: 5,
      visible: true,
      locked: false,
      parentId: "inner",
      transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 0, y: 0, z: 0 } },
      keyframes: [],
      shapeType: "rectangle",
      width: 400,
      height: 400,
      style: {
        fill: { type: "solid", color: "#14b8a6", opacity: 1 },
        stroke: { color: "#14b8a6", width: 0, opacity: 0 },
        cornerRadius: 0,
      },
    };
    const inner: MotionGroupLayer = {
      id: "inner",
      type: "group",
      name: "inner",
      startTime: 0,
      duration: 5,
      visible: true,
      locked: false,
      parentId: "outer",
      transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 0, y: 0, z: 0 } },
      keyframes: [],
      children: ["inner-shape"],
    };
    const shapeB: MotionShapeLayer = {
      id: "b",
      type: "shape",
      name: "b",
      startTime: 0,
      duration: 5,
      visible: true,
      locked: false,
      parentId: "outer",
      transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 0, y: 0, z: 0 } },
      keyframes: [],
      shapeType: "rectangle",
      width: 100,
      height: 100,
      style: {
        fill: { type: "solid", color: "#14b8a6", opacity: 1 },
        stroke: { color: "#14b8a6", width: 0, opacity: 0 },
        cornerRadius: 0,
      },
    };
    const outer: MotionGroupLayer = {
      id: "outer",
      type: "group",
      name: "outer",
      startTime: 0,
      duration: 5,
      visible: true,
      locked: false,
      transform: DEFAULT_MOTION_TRANSFORM,
      keyframes: [],
      children: ["inner", "b"],
    };
    const composition: MotionComposition = {
      ...autoLayoutComposition(),
      layers: [outer, inner, innerShape, shapeB],
    };
    const next = setMotionGroupAutoLayout(composition, "outer", {
      direction: "horizontal",
      gap: 24,
      align: "center",
    });
    // inner extent 400 + gap 24 + b 100 => b center far from the placeholder-16 result (~20)
    expect(next.layers.find((l) => l.id === "b")!.transform.position.x).toBeCloseTo(
      212,
      3,
    );
  });

  it("returns the same composition reference when positions are already stable", () => {
    const on = setMotionGroupAutoLayout(autoLayoutComposition(), "grp", {
      direction: "horizontal",
      gap: 24,
      align: "center",
    });
    expect(reflowMotionGroupAutoLayout(on, "grp")).toBe(on);
  });
});

let counter = 0;
function makeContext(
  composition: MotionComposition,
): BuildMotionUiLayerContext {
  counter = 0;
  return {
    compositionWidth: composition.width,
    compositionHeight: composition.height,
    compositionDuration: composition.duration,
    idFactory: () => `layer-${++counter}`,
  };
}

function makeComposition(): MotionComposition {
  return {
    ...motionEngine.createStarterComposition({
      name: "UI",
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 5,
    }),
    layers: [],
  };
}

describe("motion-ui-builder fill/stroke", () => {
  it("builds a linear gradient fill with sorted, clamped stops", () => {
    const fill = buildMotionFillStyle({
      type: "gradient",
      gradient: {
        type: "linear",
        angle: 45,
        stops: [
          { offset: 1.4, color: "#ffffff" },
          { offset: -0.2, color: "#000000" },
        ],
      },
    });
    expect(fill.type).toBe("gradient");
    expect(fill.gradient?.type).toBe("linear");
    expect(fill.gradient?.angle).toBe(45);
    expect(fill.gradient?.stops.map((stop) => stop.offset)).toEqual([0, 1]);
  });

  it("applies a shadow and corner radius to the shape style", () => {
    const style = buildMotionShapeStyle({
      cornerRadius: 24,
      shadow: { blur: 30, offsetY: 16 },
    });
    expect(style.cornerRadius).toBe(24);
    expect(style.shadow?.blur).toBe(30);
    expect(style.shadow?.offsetY).toBe(16);
  });
});

describe("motion-ui-builder layer batches", () => {
  it("resolves parentKey references to created layer ids", () => {
    const composition = makeComposition();
    const specs: MotionUiLayerSpec[] = [
      { key: "group", type: "group", name: "Hero" },
      { key: "title", type: "text", text: "Headline", parentKey: "group" },
      { key: "cta", type: "shape", shapeType: "rectangle", parentKey: "group" },
    ];
    const { layers, keyToId } = buildMotionUiLayers(specs, makeContext(composition));
    expect(layers).toHaveLength(3);
    const group = keyToId.group;
    expect(layers.find((layer) => layer.id === keyToId.title)?.parentId).toBe(group);
    expect(layers.find((layer) => layer.id === keyToId.cta)?.parentId).toBe(group);
  });

  it("throws on duplicate keys and unknown parentKey", () => {
    const composition = makeComposition();
    expect(() =>
      buildMotionUiLayers(
        [
          { key: "dup", type: "shape" },
          { key: "dup", type: "shape" },
        ],
        makeContext(composition),
      ),
    ).toThrow(/Duplicate/);
    expect(() =>
      buildMotionUiLayers(
        [{ key: "a", type: "shape", parentKey: "missing" }],
        makeContext(composition),
      ),
    ).toThrow(/parentKey/);
  });
});

describe("motion-ui-builder layout math", () => {
  it("stacks vertically with gaps using layer centers", () => {
    const positions = computeMotionStackPositions(
      [
        { width: 100, height: 50 },
        { width: 100, height: 50 },
        { width: 100, height: 50 },
      ],
      { direction: "vertical", gap: 20, originX: 0, originY: 0 },
    );
    expect(positions.map((position) => position.y)).toEqual([25, 95, 165]);
    expect(positions.every((position) => position.x === 0)).toBe(true);
  });

  it("places grid cells across columns and rows", () => {
    const positions = computeMotionGridPositions(
      [
        { width: 100, height: 80 },
        { width: 100, height: 80 },
        { width: 100, height: 80 },
        { width: 100, height: 80 },
      ],
      { columns: 2, gap: 20, originX: 0, originY: 0 },
    );
    expect(positions[0]).toEqual({ x: 50, y: 40 });
    expect(positions[1]).toEqual({ x: 170, y: 40 });
    expect(positions[2]).toEqual({ x: 50, y: 140 });
    expect(positions[3]).toEqual({ x: 170, y: 140 });
  });

  it("arranges existing layers in a horizontal stack", () => {
    const composition = makeComposition();
    const specs: MotionUiLayerSpec[] = [
      { key: "a", type: "shape", width: 120, height: 60 },
      { key: "b", type: "shape", width: 120, height: 60 },
    ];
    const { layers, keyToId } = buildMotionUiLayers(specs, makeContext(composition));
    const withLayers: MotionComposition = { ...composition, layers: [...layers] };
    const arranged = arrangeMotionLayersInStack(
      withLayers,
      [keyToId.a, keyToId.b],
      { direction: "horizontal", gap: 40, originX: 0, originY: 100 },
    );
    const a = arranged.layers.find((layer) => layer.id === keyToId.a);
    const b = arranged.layers.find((layer) => layer.id === keyToId.b);
    expect(a?.transform.position.x).toBe(60);
    expect(b?.transform.position.x).toBe(220);
    expect(a?.transform.position.y).toBe(100);
  });

  it("arranges existing layers in a grid", () => {
    const composition = makeComposition();
    const specs: MotionUiLayerSpec[] = [
      { key: "a", type: "shape", width: 100, height: 100 },
      { key: "b", type: "shape", width: 100, height: 100 },
      { key: "c", type: "shape", width: 100, height: 100 },
    ];
    const { layers, keyToId } = buildMotionUiLayers(specs, makeContext(composition));
    const withLayers: MotionComposition = { ...composition, layers: [...layers] };
    const arranged = arrangeMotionLayersInGrid(
      withLayers,
      [keyToId.a, keyToId.b, keyToId.c],
      { columns: 2, gap: 20, originX: 0, originY: 0 },
    );
    const c = arranged.layers.find((layer) => layer.id === keyToId.c);
    expect(c?.transform.position).toMatchObject({ x: 50, y: 170 });
  });
});

describe("motion-ui-builder components", () => {
  it("builds a button group with background + label children parented to the group", () => {
    const composition = makeComposition();
    const result = buildMotionUiComponent(
      "button",
      { label: "Sign up", x: 400, y: 300, accentColor: "#22c55e" },
      makeContext(composition),
    );
    expect(result.childIds).toHaveLength(2);
    const group = result.layers.find((layer) => layer.id === result.groupId);
    expect(group?.type).toBe("group");
    const children = result.layers.filter((layer) => layer.id !== result.groupId);
    expect(children.every((layer) => layer.parentId === result.groupId)).toBe(true);
    expect(children.some((layer) => layer.type === "shape")).toBe(true);
    const label = children.find((layer) => layer.type === "text");
    expect(label && label.type === "text" ? label.text : "").toBe("Sign up");
  });

  it("builds a card with background, title and body", () => {
    const composition = makeComposition();
    const result = buildMotionUiComponent(
      "card",
      { title: "Fast", body: "Render in seconds", shadow: true },
      makeContext(composition),
    );
    const types = result.layers.map((layer) => layer.type);
    expect(types).toContain("group");
    expect(types.filter((type) => type === "text")).toHaveLength(2);
    const background = result.layers.find(
      (layer): layer is MotionShapeLayer => layer.type === "shape",
    );
    expect(background?.style.shadow).toBeDefined();
  });

  it("positions component children relative to the group origin (no double-translation)", () => {
    const composition = makeComposition();
    const width = 980;
    const result = buildMotionUiComponent(
      "card",
      { title: "Hi", body: "There", x: 960, y: 360, width, height: 280 },
      makeContext(composition),
    );
    const group = result.layers.find((layer) => layer.id === result.groupId);
    expect(group?.transform.position).toMatchObject({ x: 960, y: 360 });

    const children = result.layers.filter(
      (layer) => layer.id !== result.groupId,
    );
    const background = children.find(
      (layer): layer is MotionShapeLayer => layer.type === "shape",
    );
    expect(background?.transform.position).toMatchObject({ x: 0, y: 0 });

    const groupX = group?.transform.position.x ?? 0;
    const groupY = group?.transform.position.y ?? 0;
    for (const child of children) {
      const worldX = groupX + child.transform.position.x;
      const worldY = groupY + child.transform.position.y;
      expect(worldX).toBeGreaterThanOrEqual(960 - width / 2 - 1);
      expect(worldX).toBeLessThanOrEqual(960 + width / 2 + 1);
      expect(worldY).toBeGreaterThanOrEqual(360 - 280 / 2 - 1);
      expect(worldY).toBeLessThanOrEqual(360 + 280 / 2 + 1);
    }
  });
});
