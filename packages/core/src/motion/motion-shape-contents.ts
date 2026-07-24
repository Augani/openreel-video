import type { ShapeStyle } from "../graphics/types";
import { flattenPathPointsToRing } from "./motion-shape-boolean";
import { buildMotionShapePolyline } from "./motion-shape-modifiers";
import type {
  MotionShapeGroupItem,
  MotionShapeGroupTransform,
  MotionShapeItem,
  MotionShapeLayer,
  MotionShapePathItem,
  MotionVector2,
} from "./types";

const MAX_SHAPE_CONTENTS_DEPTH = 8;

const IMPLICIT_ROOT_ITEM_ID = "__root";

const DEFAULT_GROUP_TRANSFORM: MotionShapeGroupTransform = {
  anchor: { x: 0, y: 0 },
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  opacity: 1,
};

const createShapeItemId = (prefix: "group" | "path"): string =>
  `motion-shape-${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;

export function hasExplicitShapeContents(layer: MotionShapeLayer): boolean {
  return Array.isArray(layer.contents) && layer.contents.length > 0;
}

export function getMotionShapeContents(
  layer: MotionShapeLayer,
): readonly MotionShapeItem[] {
  if (hasExplicitShapeContents(layer) && layer.contents) {
    return layer.contents;
  }
  const root: MotionShapePathItem = {
    kind: "path",
    id: IMPLICIT_ROOT_ITEM_ID,
    name: layer.name,
    shapeType: layer.shapeType,
    width: layer.width,
    height: layer.height,
    position: { x: 0, y: 0 },
    pathData: layer.pathData,
    pathClosed: layer.pathClosed,
    style: undefined,
  };
  return [root];
}

export function findShapeItem(
  contents: readonly MotionShapeItem[],
  id: string,
): MotionShapeItem | null {
  for (const item of contents) {
    if (item.id === id) {
      return item;
    }
    if (item.kind === "group") {
      const nested = findShapeItem(item.items, id);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

export function collectShapeItemIds(
  contents: readonly MotionShapeItem[],
): string[] {
  const ids: string[] = [];
  for (const item of contents) {
    ids.push(item.id);
    if (item.kind === "group") {
      ids.push(...collectShapeItemIds(item.items));
    }
  }
  return ids;
}

function assertNoDuplicateIds(
  contents: readonly MotionShapeItem[],
  incoming: MotionShapeItem,
): void {
  const existing = new Set(collectShapeItemIds(contents));
  const incomingIds = [incoming.id, ...collectShapeItemIds([incoming])];
  for (const candidate of incomingIds) {
    if (existing.has(candidate)) {
      throw new Error(
        `Duplicate shape item id "${candidate}" cannot be inserted`,
      );
    }
  }
}

function depthOf(item: MotionShapeItem): number {
  if (item.kind !== "group" || item.items.length === 0) {
    return 1;
  }
  let deepest = 0;
  for (const child of item.items) {
    const childDepth = depthOf(child);
    if (childDepth > deepest) {
      deepest = childDepth;
    }
  }
  return deepest + 1;
}

function findDepth(
  contents: readonly MotionShapeItem[],
  id: string,
  depth: number,
): number | null {
  for (const item of contents) {
    if (item.id === id) {
      return depth;
    }
    if (item.kind === "group") {
      const nested = findDepth(item.items, id, depth + 1);
      if (nested !== null) {
        return nested;
      }
    }
  }
  return null;
}

export function addShapeItem(
  layer: MotionShapeLayer,
  parentGroupId: string | null,
  item: MotionShapeItem,
): MotionShapeLayer {
  const contents = layer.contents ?? [];
  assertNoDuplicateIds(contents, item);

  if (parentGroupId === null) {
    if (depthOf(item) > MAX_SHAPE_CONTENTS_DEPTH) {
      throw new Error("Shape contents depth cap exceeded");
    }
    return { ...layer, contents: [...contents, item] };
  }

  const parent = findShapeItem(contents, parentGroupId);
  if (!parent) {
    throw new Error(`Parent group "${parentGroupId}" not found`);
  }
  if (parent.kind !== "group") {
    throw new Error(`Item "${parentGroupId}" is not a group`);
  }

  const parentDepth = findDepth(contents, parentGroupId, 1);
  if (parentDepth === null) {
    throw new Error(`Parent group "${parentGroupId}" not found`);
  }
  if (parentDepth + depthOf(item) > MAX_SHAPE_CONTENTS_DEPTH) {
    throw new Error("Shape contents depth cap exceeded");
  }

  const next = mapItems(contents, (candidate) => {
    if (candidate.kind === "group" && candidate.id === parentGroupId) {
      return { ...candidate, items: [...candidate.items, item] };
    }
    return candidate;
  });
  return { ...layer, contents: next };
}

function mapItems(
  contents: readonly MotionShapeItem[],
  transform: (item: MotionShapeItem) => MotionShapeItem,
): MotionShapeItem[] {
  return contents.map((item) => {
    const mapped = transform(item);
    if (mapped.kind === "group") {
      return { ...mapped, items: mapItems(mapped.items, transform) };
    }
    return mapped;
  });
}

type GroupPatch = Partial<Omit<MotionShapeGroupItem, "kind" | "id">>;
type PathPatch = Partial<Omit<MotionShapePathItem, "kind" | "id">>;
type ShapeItemPatch = (GroupPatch | PathPatch) & { readonly kind?: never };

export function updateShapeItem(
  layer: MotionShapeLayer,
  id: string,
  patch: ShapeItemPatch,
): MotionShapeLayer {
  const contents = layer.contents ?? [];
  const target = findShapeItem(contents, id);
  if (!target) {
    throw new Error(`Shape item "${id}" not found`);
  }
  if ("kind" in patch && patch.kind !== undefined && patch.kind !== target.kind) {
    throw new Error("Cannot change the kind of a shape item");
  }

  const next = mapItems(contents, (item) => {
    if (item.id !== id) {
      return item;
    }
    if (item.kind === "group") {
      const groupPatch = patch as GroupPatch;
      return { ...item, ...groupPatch, kind: "group", id: item.id };
    }
    const pathPatch = patch as PathPatch;
    return { ...item, ...pathPatch, kind: "path", id: item.id };
  });
  return { ...layer, contents: next };
}

function filterItems(
  contents: readonly MotionShapeItem[],
  id: string,
): MotionShapeItem[] {
  const result: MotionShapeItem[] = [];
  for (const item of contents) {
    if (item.id === id) {
      continue;
    }
    if (item.kind === "group") {
      result.push({ ...item, items: filterItems(item.items, id) });
    } else {
      result.push(item);
    }
  }
  return result;
}

export function removeShapeItem(
  layer: MotionShapeLayer,
  id: string,
): MotionShapeLayer {
  const contents = layer.contents ?? [];
  if (!findShapeItem(contents, id)) {
    throw new Error(`Shape item "${id}" not found`);
  }
  return { ...layer, contents: filterItems(contents, id) };
}

function reorderSiblings(
  siblings: readonly MotionShapeItem[],
  id: string,
  direction: "up" | "down",
): MotionShapeItem[] | null {
  const index = siblings.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= siblings.length) {
    return [...siblings];
  }
  const next = [...siblings];
  const moved = next[swapWith];
  const target = next[index];
  if (moved === undefined || target === undefined) {
    return [...siblings];
  }
  next[swapWith] = target;
  next[index] = moved;
  return next;
}

function moveWithin(
  contents: readonly MotionShapeItem[],
  id: string,
  direction: "up" | "down",
): { readonly items: MotionShapeItem[]; readonly moved: boolean } {
  const reordered = reorderSiblings(contents, id, direction);
  if (reordered) {
    return { items: reordered, moved: true };
  }
  const items = contents.map((item) => {
    if (item.kind !== "group") {
      return item;
    }
    const nested = moveWithin(item.items, id, direction);
    if (nested.moved) {
      return { ...item, items: nested.items };
    }
    return item;
  });
  const moved = items.some((item, i) => item !== contents[i]);
  return { items, moved };
}

export function moveShapeItem(
  layer: MotionShapeLayer,
  id: string,
  direction: "up" | "down",
): MotionShapeLayer {
  const contents = layer.contents ?? [];
  if (!findShapeItem(contents, id)) {
    throw new Error(`Shape item "${id}" not found`);
  }
  const result = moveWithin(contents, id, direction);
  return { ...layer, contents: result.items };
}

export function createShapeGroupItem(name: string): MotionShapeGroupItem {
  return {
    kind: "group",
    id: createShapeItemId("group"),
    name,
    transform: DEFAULT_GROUP_TRANSFORM,
    items: [],
  };
}

export interface CreateShapePathItemInit {
  readonly name?: string;
  readonly shapeType?: MotionShapePathItem["shapeType"];
  readonly width?: number;
  readonly height?: number;
  readonly position?: MotionShapePathItem["position"];
  readonly pathData?: string;
  readonly pathClosed?: boolean;
  readonly style?: MotionShapePathItem["style"];
  readonly visible?: boolean;
}

export function createShapePathItem(
  init: CreateShapePathItemInit,
): MotionShapePathItem {
  return {
    kind: "path",
    id: createShapeItemId("path"),
    name: init.name ?? "Shape",
    shapeType: init.shapeType ?? "rectangle",
    width: init.width ?? 100,
    height: init.height ?? 100,
    position: init.position ?? { x: 0, y: 0 },
    pathData: init.pathData,
    pathClosed: init.pathClosed,
    style: init.style,
    visible: init.visible,
  };
}

export function materializeShapeContents(
  layer: MotionShapeLayer,
): MotionShapeLayer {
  if (hasExplicitShapeContents(layer)) {
    return layer;
  }
  const [root] = getMotionShapeContents(layer);
  if (!root) {
    throw new Error("Failed to synthesize implicit shape item");
  }
  const group: MotionShapeGroupItem = {
    kind: "group",
    id: createShapeItemId("group"),
    name: "Group 1",
    transform: DEFAULT_GROUP_TRANSFORM,
    items: [root],
  };
  return { ...layer, contents: [group] };
}

export type ShapeAffineMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

export const SHAPE_IDENTITY_MATRIX: ShapeAffineMatrix = [1, 0, 0, 1, 0, 0];

export function multiplyShapeMatrices(
  left: ShapeAffineMatrix,
  right: ShapeAffineMatrix,
): ShapeAffineMatrix {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function applyShapeMatrix(
  matrix: ShapeAffineMatrix,
  point: MotionVector2,
): MotionVector2 {
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * point.x + c * point.y + e,
    y: b * point.x + d * point.y + f,
  };
}

export function shapeGroupTransformToMatrix(
  transform: MotionShapeGroupTransform,
): ShapeAffineMatrix {
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scaleX = transform.scale.x;
  const scaleY = transform.scale.y;
  const rotationScale: ShapeAffineMatrix = [
    cos * scaleX,
    sin * scaleX,
    -sin * scaleY,
    cos * scaleY,
    transform.position.x,
    transform.position.y,
  ];
  const anchor: ShapeAffineMatrix = [
    1,
    0,
    0,
    1,
    -transform.anchor.x,
    -transform.anchor.y,
  ];
  return multiplyShapeMatrices(rotationScale, anchor);
}

export function shapePathItemTranslationMatrix(
  item: MotionShapePathItem,
): ShapeAffineMatrix {
  return [1, 0, 0, 1, item.position.x, item.position.y];
}

export interface ShapeItemRingEntry {
  readonly rings: MotionVector2[][];
  readonly style: ShapeStyle | undefined;
  readonly opacity: number;
  readonly closed: boolean;
}

const isGroupGeometryMerged = (group: MotionShapeGroupItem): boolean =>
  (group.mergeMode !== undefined && group.mergeMode !== "none") ||
  (group.operators !== undefined && group.operators.length > 0);

function buildPathItemRing(
  item: MotionShapePathItem,
  baseLayer: MotionShapeLayer,
): MotionVector2[] {
  const geometryLayer: MotionShapeLayer = {
    ...baseLayer,
    shapeType: item.shapeType,
    width: item.width,
    height: item.height,
    pathData: item.pathData,
    pathClosed: item.pathClosed,
    modifiers: [],
    puppetPins: [],
    contents: undefined,
  };
  const closed = item.pathClosed ?? true;
  const points = buildMotionShapePolyline(geometryLayer, 96);
  return flattenPathPointsToRing(points, closed);
}

export function collectShapeItemRings(
  item: MotionShapeItem,
  baseLayer: MotionShapeLayer,
  parentMatrix: ShapeAffineMatrix,
  parentOpacity: number,
  inheritedStyle: ShapeStyle | undefined,
): ShapeItemRingEntry[] {
  if (item.visible === false) {
    return [];
  }

  if (item.kind === "path") {
    const matrix = multiplyShapeMatrices(
      parentMatrix,
      shapePathItemTranslationMatrix(item),
    );
    const ring = buildPathItemRing(item, baseLayer).map((point) =>
      applyShapeMatrix(matrix, point),
    );
    if (ring.length === 0) {
      return [];
    }
    return [
      {
        rings: [ring],
        style: item.style ?? inheritedStyle,
        opacity: parentOpacity,
        closed: item.pathClosed ?? true,
      },
    ];
  }

  const matrix = multiplyShapeMatrices(
    parentMatrix,
    shapeGroupTransformToMatrix(item.transform),
  );
  const opacity = parentOpacity * item.transform.opacity;
  const childStyle = item.style ?? inheritedStyle;
  const entries: ShapeItemRingEntry[] = [];
  for (const child of item.items) {
    entries.push(
      ...collectShapeItemRings(child, baseLayer, matrix, opacity, childStyle),
    );
  }
  return entries;
}

export function shouldMergeShapeGroup(group: MotionShapeGroupItem): boolean {
  return isGroupGeometryMerged(group);
}
