import { describe, expect, it } from "vitest";
import {
  addShapeItem,
  collectShapeItemIds,
  createShapeGroupItem,
  createShapePathItem,
  findShapeItem,
  getMotionShapeContents,
  hasExplicitShapeContents,
  materializeShapeContents,
  moveShapeItem,
  removeShapeItem,
  updateShapeItem,
} from "./motion-shape-contents";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import type {
  MotionShapeGroupItem,
  MotionShapeItem,
  MotionShapeLayer,
  MotionShapePathItem,
} from "./types";
import type { ShapeStyle } from "../graphics/types";

const STYLE: ShapeStyle = {
  fill: { type: "solid", color: "#ffffff", opacity: 1 },
  stroke: { color: "#000000", width: 2, opacity: 1 },
  cornerRadius: 4,
};

const makeLayer = (
  overrides: Partial<MotionShapeLayer> = {},
): MotionShapeLayer => ({
  id: "layer-1",
  type: "shape",
  name: "Rectangle",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  shapeType: "rectangle",
  width: 120,
  height: 80,
  pathData: "M0 0 L1 1",
  pathClosed: true,
  style: STYLE,
  ...overrides,
});

const path = (id: string, name = id): MotionShapePathItem => ({
  kind: "path",
  id,
  name,
  shapeType: "rectangle",
  width: 40,
  height: 30,
  position: { x: 0, y: 0 },
});

const group = (
  id: string,
  items: readonly MotionShapeItem[] = [],
): MotionShapeGroupItem => ({
  kind: "group",
  id,
  name: id,
  transform: {
    anchor: { x: 0, y: 0 },
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
  },
  items,
});

describe("getMotionShapeContents", () => {
  it("synthesizes an implicit __root path item for legacy layers", () => {
    const layer = makeLayer();
    const contents = getMotionShapeContents(layer);
    expect(contents).toHaveLength(1);
    const root = contents[0];
    expect(root.kind).toBe("path");
    expect(root.id).toBe("__root");
    expect(root.name).toBe("Rectangle");
    if (root.kind !== "path") throw new Error("expected path");
    expect(root.shapeType).toBe("rectangle");
    expect(root.width).toBe(120);
    expect(root.height).toBe(80);
    expect(root.position).toEqual({ x: 0, y: 0 });
    expect(root.pathData).toBe("M0 0 L1 1");
    expect(root.pathClosed).toBe(true);
    expect(root.style).toBeUndefined();
  });

  it("passes through explicit contents unchanged", () => {
    const explicit = [group("g1", [path("p1")])];
    const layer = makeLayer({ contents: explicit });
    const contents = getMotionShapeContents(layer);
    expect(contents).toBe(explicit);
    expect(hasExplicitShapeContents(layer)).toBe(true);
    expect(hasExplicitShapeContents(makeLayer())).toBe(false);
  });
});

describe("findShapeItem / collectShapeItemIds", () => {
  it("finds a nested item and returns null for a miss", () => {
    const contents = [group("g1", [path("p1"), group("g2", [path("p2")])])];
    const hit = findShapeItem(contents, "p2");
    expect(hit?.id).toBe("p2");
    expect(findShapeItem(contents, "nope")).toBeNull();
  });

  it("collects every id in document order", () => {
    const contents = [group("g1", [path("p1"), group("g2", [path("p2")])])];
    expect(collectShapeItemIds(contents)).toEqual(["g1", "p1", "g2", "p2"]);
  });
});

describe("addShapeItem", () => {
  it("adds to the root when parent is null", () => {
    const layer = makeLayer({ contents: [path("p1")] });
    const next = addShapeItem(layer, null, path("p2"));
    expect(next.contents).toHaveLength(2);
    expect(next.contents?.[1]?.id).toBe("p2");
    expect(layer.contents).toHaveLength(1);
  });

  it("adds to a nested group", () => {
    const layer = makeLayer({ contents: [group("g1", [path("p1")])] });
    const next = addShapeItem(layer, "g1", path("p2"));
    const g1 = next.contents?.[0];
    if (!g1 || g1.kind !== "group") throw new Error("expected group");
    expect(g1.items.map((it) => it.id)).toEqual(["p1", "p2"]);
    const original = layer.contents?.[0];
    if (!original || original.kind !== "group") throw new Error("group");
    expect(original.items).toHaveLength(1);
  });

  it("throws on duplicate id insert", () => {
    const layer = makeLayer({ contents: [path("p1")] });
    expect(() => addShapeItem(layer, null, path("p1"))).toThrow();
  });

  it("throws when adding to a group at the depth cap (8 nested groups)", () => {
    let inner: MotionShapeItem = group("g8", []);
    for (let i = 7; i >= 1; i -= 1) {
      inner = group(`g${i}`, [inner]);
    }
    const layer = makeLayer({ contents: [inner] });
    expect(collectShapeItemIds(layer.contents ?? [])).toContain("g8");
    expect(() => addShapeItem(layer, "g8", path("x"))).toThrow(
      /depth cap exceeded/i,
    );
  });

  it("allows adding to a group at depth 7 (one below the cap)", () => {
    let inner: MotionShapeItem = group("g8", []);
    for (let i = 7; i >= 1; i -= 1) {
      inner = group(`g${i}`, [inner]);
    }
    const layer = makeLayer({ contents: [inner] });
    const next = addShapeItem(layer, "g7", path("x"));
    const found = findShapeItem(next.contents ?? [], "g7");
    if (!found || found.kind !== "group") throw new Error("expected group g7");
    expect(found.items.some((it) => it.id === "x")).toBe(true);
  });
});

describe("updateShapeItem", () => {
  it("patches immutably without touching the original", () => {
    const layer = makeLayer({ contents: [path("p1", "Old")] });
    const next = updateShapeItem(layer, "p1", { name: "New", width: 99 });
    const updated = next.contents?.[0];
    if (!updated || updated.kind !== "path") throw new Error("path");
    expect(updated.name).toBe("New");
    expect(updated.width).toBe(99);
    const original = layer.contents?.[0];
    if (!original || original.kind !== "path") throw new Error("path");
    expect(original.name).toBe("Old");
    expect(original.width).toBe(40);
  });

  it("rejects a kind-changing patch", () => {
    const layer = makeLayer({ contents: [path("p1")] });
    expect(() =>
      updateShapeItem(layer, "p1", { kind: "group" } as never),
    ).toThrow();
  });

  it("throws when the id is not found", () => {
    const layer = makeLayer({ contents: [path("p1")] });
    expect(() => updateShapeItem(layer, "nope", { name: "x" })).toThrow();
  });
});

describe("removeShapeItem", () => {
  it("prunes a nested item and leaves siblings", () => {
    const layer = makeLayer({
      contents: [group("g1", [path("p1"), path("p2")])],
    });
    const next = removeShapeItem(layer, "p1");
    const g1 = next.contents?.[0];
    if (!g1 || g1.kind !== "group") throw new Error("group");
    expect(g1.items.map((it) => it.id)).toEqual(["p2"]);
  });

  it("prunes a whole group subtree", () => {
    const layer = makeLayer({
      contents: [group("g1", [path("p1")]), path("p2")],
    });
    const next = removeShapeItem(layer, "g1");
    expect(collectShapeItemIds(next.contents ?? [])).toEqual(["p2"]);
  });
});

describe("moveShapeItem", () => {
  it("moves up and down within its parent", () => {
    const layer = makeLayer({
      contents: [group("g1", [path("a"), path("b"), path("c")])],
    });
    const up = moveShapeItem(layer, "c", "up");
    const g1 = up.contents?.[0];
    if (!g1 || g1.kind !== "group") throw new Error("group");
    expect(g1.items.map((it) => it.id)).toEqual(["a", "c", "b"]);

    const down = moveShapeItem(up, "c", "down");
    const g1b = down.contents?.[0];
    if (!g1b || g1b.kind !== "group") throw new Error("group");
    expect(g1b.items.map((it) => it.id)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op at the boundary", () => {
    const layer = makeLayer({ contents: [path("a"), path("b")] });
    const next = moveShapeItem(layer, "a", "up");
    expect(next.contents?.map((it) => it.id)).toEqual(["a", "b"]);
  });
});

describe("materializeShapeContents", () => {
  it("wraps the implicit item in Group 1 and preserves geometry fields", () => {
    const layer = makeLayer();
    const next = materializeShapeContents(layer);
    expect(hasExplicitShapeContents(next)).toBe(true);
    const g = next.contents?.[0];
    if (!g || g.kind !== "group") throw new Error("group");
    expect(g.name).toBe("Group 1");
    expect(g.transform).toEqual({
      anchor: { x: 0, y: 0 },
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
    });
    const child = g.items[0];
    if (!child || child.kind !== "path") throw new Error("path");
    expect(child.shapeType).toBe("rectangle");
    expect(child.width).toBe(120);
    expect(child.height).toBe(80);
    expect(child.pathData).toBe("M0 0 L1 1");
    expect(child.pathClosed).toBe(true);
  });

  it("is a no-op when contents already explicit", () => {
    const explicit = [group("g1", [path("p1")])];
    const layer = makeLayer({ contents: explicit });
    expect(materializeShapeContents(layer).contents).toBe(explicit);
  });
});

describe("createShapeGroupItem / createShapePathItem", () => {
  it("creates a group with unique id and default transform", () => {
    const g = createShapeGroupItem("My Group");
    expect(g.kind).toBe("group");
    expect(g.name).toBe("My Group");
    expect(g.items).toEqual([]);
    expect(g.transform.scale).toEqual({ x: 1, y: 1 });
    expect(g.transform.opacity).toBe(1);
    expect(createShapeGroupItem("X").id).not.toBe(g.id);
  });

  it("creates a path item honouring init overrides", () => {
    const p = createShapePathItem({ name: "Circle", shapeType: "circle", width: 50 });
    expect(p.kind).toBe("path");
    expect(p.name).toBe("Circle");
    expect(p.shapeType).toBe("circle");
    expect(p.width).toBe(50);
    expect(p.position).toEqual({ x: 0, y: 0 });
    expect(createShapePathItem({}).id).not.toBe(p.id);
  });
});
