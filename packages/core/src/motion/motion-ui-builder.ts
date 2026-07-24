import type {
  FillStyle,
  GradientStop,
  ShapeStyle,
  ShapeType,
  StrokeStyle,
} from "../graphics/types";
import { DEFAULT_SHAPE_STYLE } from "../graphics/types";
import type {
  MotionAutoLayout,
  MotionComposition,
  MotionGroupLayer,
  MotionLayer,
  MotionShapeLayer,
  MotionTextLayer,
  MotionTransform,
  MotionVector2,
} from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import { getMotionLayerVisualBounds } from "./motion-masks";

export type MotionUiFillType = "solid" | "gradient" | "none";
export type MotionUiGradientType = "linear" | "radial";

export interface MotionUiGradientSpec {
  readonly type?: MotionUiGradientType;
  readonly angle?: number;
  readonly stops: readonly { readonly offset: number; readonly color: string }[];
}

export interface MotionUiFillSpec {
  readonly type?: MotionUiFillType;
  readonly color?: string;
  readonly opacity?: number;
  readonly gradient?: MotionUiGradientSpec;
}

export interface MotionUiStrokeSpec {
  readonly color?: string;
  readonly width?: number;
  readonly opacity?: number;
  readonly dashArray?: readonly number[];
  readonly dashOffset?: number;
  readonly lineCap?: "butt" | "round" | "square";
  readonly lineJoin?: "miter" | "round" | "bevel";
}

export interface MotionUiShadowSpec {
  readonly color?: string;
  readonly blur?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
}

export interface MotionUiShapeStyleSpec {
  readonly fill?: MotionUiFillSpec;
  readonly stroke?: MotionUiStrokeSpec;
  readonly shadow?: MotionUiShadowSpec;
  readonly cornerRadius?: number;
  readonly points?: number;
  readonly innerRadius?: number;
}

const round4 = (value: number): number => Number(value.toFixed(4));

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function buildMotionGradientStops(
  stops: readonly { readonly offset: number; readonly color: string }[] | undefined,
): GradientStop[] {
  const normalized = (stops ?? [])
    .filter(
      (stop): stop is { offset: number; color: string } =>
        typeof stop?.offset === "number" &&
        Number.isFinite(stop.offset) &&
        typeof stop?.color === "string" &&
        stop.color.length > 0,
    )
    .map((stop) => ({
      offset: clamp(stop.offset, 0, 1),
      color: stop.color,
    }))
    .sort((a, b) => a.offset - b.offset);

  if (normalized.length === 0) {
    return [
      { offset: 0, color: "#14b8a6" },
      { offset: 1, color: "#0f172a" },
    ];
  }
  if (normalized.length === 1) {
    return [
      { offset: 0, color: normalized[0].color },
      { offset: 1, color: normalized[0].color },
    ];
  }
  return normalized;
}

export function buildMotionFillStyle(
  spec: MotionUiFillSpec | undefined,
  fallback: FillStyle = DEFAULT_SHAPE_STYLE.fill,
): FillStyle {
  if (!spec) return fallback;
  const opacity = clamp(finiteOr(spec.opacity, fallback.opacity ?? 1), 0, 1);
  const type: MotionUiFillType = spec.type ?? (spec.gradient ? "gradient" : "solid");
  if (type === "none") {
    return { type: "none", opacity };
  }
  if (type === "gradient" && spec.gradient) {
    return {
      type: "gradient",
      opacity,
      color: spec.color ?? fallback.color,
      gradient: {
        type: spec.gradient.type ?? "linear",
        angle: finiteOr(spec.gradient.angle, 0),
        stops: buildMotionGradientStops(spec.gradient.stops),
      },
    };
  }
  return {
    type: "solid",
    color: spec.color ?? fallback.color ?? "#14b8a6",
    opacity,
  };
}

export function buildMotionStrokeStyle(
  spec: MotionUiStrokeSpec | undefined,
  fallback: StrokeStyle = DEFAULT_SHAPE_STYLE.stroke,
): StrokeStyle {
  if (!spec) return fallback;
  return {
    color: spec.color ?? fallback.color,
    width: Math.max(0, finiteOr(spec.width, fallback.width)),
    opacity: clamp(finiteOr(spec.opacity, fallback.opacity), 0, 1),
    dashArray:
      spec.dashArray && spec.dashArray.length > 0
        ? spec.dashArray.map((dash) => Math.max(0, finiteOr(dash, 0)))
        : fallback.dashArray,
    dashOffset: spec.dashOffset !== undefined ? finiteOr(spec.dashOffset, 0) : fallback.dashOffset,
    lineCap: spec.lineCap ?? fallback.lineCap,
    lineJoin: spec.lineJoin ?? fallback.lineJoin,
  };
}

export function buildMotionShapeStyle(
  spec: MotionUiShapeStyleSpec | undefined,
  base: ShapeStyle = DEFAULT_SHAPE_STYLE,
): ShapeStyle {
  if (!spec) return base;
  const next: {
    fill: FillStyle;
    stroke: StrokeStyle;
    shadow?: ShapeStyle["shadow"];
    cornerRadius?: number;
    points?: number;
    innerRadius?: number;
    material3d?: ShapeStyle["material3d"];
  } = {
    fill: spec.fill ? buildMotionFillStyle(spec.fill, base.fill) : base.fill,
    stroke: spec.stroke ? buildMotionStrokeStyle(spec.stroke, base.stroke) : base.stroke,
    shadow: base.shadow,
    cornerRadius: base.cornerRadius,
    points: base.points,
    innerRadius: base.innerRadius,
    material3d: base.material3d,
  };
  if (spec.shadow) {
    next.shadow = {
      color: spec.shadow.color ?? "#000000",
      blur: Math.max(0, finiteOr(spec.shadow.blur, 24)),
      offsetX: finiteOr(spec.shadow.offsetX, 0),
      offsetY: finiteOr(spec.shadow.offsetY, 12),
    };
  }
  if (spec.cornerRadius !== undefined) {
    next.cornerRadius = Math.max(0, finiteOr(spec.cornerRadius, 0));
  }
  if (spec.points !== undefined) {
    next.points = Math.max(3, Math.round(finiteOr(spec.points, 5)));
  }
  if (spec.innerRadius !== undefined) {
    next.innerRadius = clamp(finiteOr(spec.innerRadius, 0.5), 0, 1);
  }
  return next;
}

export interface MotionUiTextStyleSpec {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: string | number;
  readonly color?: string;
  readonly align?: CanvasTextAlign;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
}

export function buildMotionTextStyle(
  spec: MotionUiTextStyleSpec | undefined,
): MotionTextLayer["style"] {
  return {
    fontFamily: spec?.fontFamily ?? "Inter",
    fontSize: Math.max(1, finiteOr(spec?.fontSize, 48)),
    fontWeight: spec?.fontWeight ?? 600,
    color: spec?.color ?? "#ffffff",
    align: spec?.align ?? "center",
    lineHeight: spec?.lineHeight !== undefined ? Math.max(0.1, finiteOr(spec.lineHeight, 1.2)) : 1.2,
    letterSpacing:
      spec?.letterSpacing !== undefined ? finiteOr(spec.letterSpacing, 0) : undefined,
  };
}

export type MotionUiLayerType =
  | "text"
  | "shape"
  | "image"
  | "group"
  | "null"
  | "adjustment";

export interface MotionUiLayerSpec {
  readonly key?: string;
  readonly type: MotionUiLayerType;
  readonly name?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly startTime?: number;
  readonly duration?: number;
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly rotation?: number;
  readonly opacity?: number;
  readonly parentKey?: string;
  readonly parentId?: string;
  readonly shapeType?: ShapeType;
  readonly style?: MotionUiShapeStyleSpec;
  readonly text?: string;
  readonly textStyle?: MotionUiTextStyleSpec;
  readonly assetId?: string;
  readonly fit?: "contain" | "cover" | "fill";
}

export interface BuildMotionUiLayerContext {
  readonly compositionWidth: number;
  readonly compositionHeight: number;
  readonly compositionDuration: number;
  readonly idFactory: () => string;
}

function buildBaseTransform(
  spec: MotionUiLayerSpec,
  context: BuildMotionUiLayerContext,
): MotionTransform {
  return {
    ...DEFAULT_MOTION_TRANSFORM,
    position: {
      x: round4(finiteOr(spec.x, context.compositionWidth / 2)),
      y: round4(finiteOr(spec.y, context.compositionHeight / 2)),
      z: 0,
    },
    rotation: finiteOr(spec.rotation, 0),
    opacity: clamp(finiteOr(spec.opacity, 1), 0, 1),
  };
}

export function buildMotionUiLayer(
  spec: MotionUiLayerSpec,
  context: BuildMotionUiLayerContext,
): MotionLayer {
  const id = context.idFactory();
  const startTime = Math.max(0, finiteOr(spec.startTime, 0));
  const duration = Math.max(
    0.001,
    finiteOr(spec.duration, Math.max(0.001, context.compositionDuration - startTime)),
  );
  const base = {
    id,
    name: spec.name ?? defaultLayerName(spec.type),
    startTime,
    duration,
    visible: spec.visible !== false,
    locked: spec.locked === true,
    transform: buildBaseTransform(spec, context),
    keyframes: [],
    parentId: spec.parentId,
  };

  switch (spec.type) {
    case "text":
      return {
        ...base,
        type: "text",
        text: spec.text ?? "Text",
        style: buildMotionTextStyle(spec.textStyle),
      } satisfies MotionTextLayer;
    case "shape":
      return {
        ...base,
        type: "shape",
        shapeType: spec.shapeType ?? "rectangle",
        width: Math.max(1, finiteOr(spec.width, 320)),
        height: Math.max(1, finiteOr(spec.height, 160)),
        style: buildMotionShapeStyle(spec.style),
      } satisfies MotionShapeLayer;
    case "image":
      if (!spec.assetId) {
        throw new Error("image layer spec requires an assetId");
      }
      return {
        ...base,
        type: "image",
        assetId: spec.assetId,
        width: spec.width !== undefined ? Math.max(1, finiteOr(spec.width, 320)) : undefined,
        height: spec.height !== undefined ? Math.max(1, finiteOr(spec.height, 180)) : undefined,
        fit: spec.fit ?? "contain",
      };
    case "adjustment":
      return {
        ...base,
        type: "adjustment",
        width: Math.max(1, finiteOr(spec.width, context.compositionWidth)),
        height: Math.max(1, finiteOr(spec.height, context.compositionHeight)),
      };
    case "null":
      return {
        ...base,
        type: "null",
      };
    case "group":
      return {
        ...base,
        type: "group",
        children: [],
      } satisfies MotionGroupLayer;
    default:
      throw new Error(`Unsupported motion UI layer type: ${String(spec.type)}`);
  }
}

export interface BuildMotionUiLayersResult {
  readonly layers: readonly MotionLayer[];
  readonly keyToId: Readonly<Record<string, string>>;
}

export function buildMotionUiLayers(
  specs: readonly MotionUiLayerSpec[],
  context: BuildMotionUiLayerContext,
): BuildMotionUiLayersResult {
  if (specs.length === 0) {
    return { layers: [], keyToId: {} };
  }
  const keyToId: Record<string, string> = {};
  const built = specs.map((spec) => {
    const layer = buildMotionUiLayer(spec, context);
    if (spec.key) {
      if (keyToId[spec.key]) {
        throw new Error(`Duplicate layer key: ${spec.key}`);
      }
      keyToId[spec.key] = layer.id;
    }
    return { spec, layer };
  });

  const layers = built.map(({ spec, layer }) => {
    const parentId = spec.parentKey
      ? keyToId[spec.parentKey]
      : spec.parentId;
    if (spec.parentKey && !parentId) {
      throw new Error(`Unknown parentKey: ${spec.parentKey}`);
    }
    return parentId ? ({ ...layer, parentId } as MotionLayer) : layer;
  });

  return { layers, keyToId };
}

export type MotionUiStackDirection = "vertical" | "horizontal";
export type MotionUiStackAlign = "start" | "center" | "end";

export interface ArrangeMotionStackOptions {
  readonly direction: MotionUiStackDirection;
  readonly gap?: number;
  readonly align?: MotionUiStackAlign;
  readonly originX?: number;
  readonly originY?: number;
}

export interface ArrangeMotionGridOptions {
  readonly columns: number;
  readonly gap?: number;
  readonly rowGap?: number;
  readonly originX?: number;
  readonly originY?: number;
}

interface LayerExtent {
  readonly width: number;
  readonly height: number;
}

function getMotionLayerExtent(layer: MotionLayer): LayerExtent {
  const bounds = getMotionLayerVisualBounds(layer);
  const scaleX = Math.abs(finiteOr(layer.transform.scale.x, 1));
  const scaleY = Math.abs(finiteOr(layer.transform.scale.y, 1));
  return {
    width: Math.max(0, bounds.width * scaleX),
    height: Math.max(0, bounds.height * scaleY),
  };
}

function getMotionLayerExtentInComposition(
  composition: MotionComposition,
  layer: MotionLayer,
): LayerExtent {
  if (layer.type !== "group" || layer.children.length === 0) {
    return getMotionLayerExtent(layer);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const childId of layer.children) {
    const child = composition.layers.find((candidate) => candidate.id === childId);
    if (!child) continue;
    const childExtent = getMotionLayerExtentInComposition(composition, child);
    const cx = child.transform.position.x;
    const cy = child.transform.position.y;
    minX = Math.min(minX, cx - childExtent.width / 2);
    maxX = Math.max(maxX, cx + childExtent.width / 2);
    minY = Math.min(minY, cy - childExtent.height / 2);
    maxY = Math.max(maxY, cy + childExtent.height / 2);
  }
  if (!Number.isFinite(minX)) return getMotionLayerExtent(layer);
  const scaleX = Math.abs(finiteOr(layer.transform.scale.x, 1));
  const scaleY = Math.abs(finiteOr(layer.transform.scale.y, 1));
  return {
    width: Math.max(0, (maxX - minX) * scaleX),
    height: Math.max(0, (maxY - minY) * scaleY),
  };
}

function hasMotionPositionKeyframes(layer: MotionLayer): boolean {
  return layer.keyframes.some(
    (keyframe) =>
      keyframe.property === "transform.position.x" ||
      keyframe.property === "transform.position.y",
  );
}

function getMotionGroupNestingDepth(
  composition: MotionComposition,
  layerId: string,
): number {
  let depth = 0;
  let current = composition.layers.find((layer) => layer.id === layerId);
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    depth += 1;
    const parentId: string = current.parentId;
    current = composition.layers.find((layer) => layer.id === parentId);
  }
  return depth;
}

function withMotionLayerPosition<T extends MotionLayer>(
  layer: T,
  position: MotionVector2,
): T {
  return {
    ...layer,
    transform: {
      ...layer.transform,
      position: {
        x: round4(position.x),
        y: round4(position.y),
        z: layer.transform.position.z,
      },
    },
  } as T;
}

export function computeMotionStackPositions(
  extents: readonly LayerExtent[],
  options: ArrangeMotionStackOptions,
): MotionVector2[] {
  const gap = Math.max(0, finiteOr(options.gap, 24));
  const align: MotionUiStackAlign = options.align ?? "center";
  const originX = finiteOr(options.originX, 0);
  const originY = finiteOr(options.originY, 0);
  const positions: MotionVector2[] = [];

  if (options.direction === "vertical") {
    let cursor = originY;
    for (const extent of extents) {
      const centerY = cursor + extent.height / 2;
      const centerX =
        align === "start"
          ? originX + extent.width / 2
          : align === "end"
            ? originX - extent.width / 2
            : originX;
      positions.push({ x: centerX, y: centerY });
      cursor += extent.height + gap;
    }
  } else {
    let cursor = originX;
    for (const extent of extents) {
      const centerX = cursor + extent.width / 2;
      const centerY =
        align === "start"
          ? originY + extent.height / 2
          : align === "end"
            ? originY - extent.height / 2
            : originY;
      positions.push({ x: centerX, y: centerY });
      cursor += extent.width + gap;
    }
  }
  return positions;
}

export function computeMotionGridPositions(
  extents: readonly LayerExtent[],
  options: ArrangeMotionGridOptions,
): MotionVector2[] {
  const columns = Math.max(1, Math.round(finiteOr(options.columns, 1)));
  const columnGap = Math.max(0, finiteOr(options.gap, 24));
  const rowGap = Math.max(0, finiteOr(options.rowGap ?? options.gap, 24));
  const originX = finiteOr(options.originX, 0);
  const originY = finiteOr(options.originY, 0);
  const rows = Math.ceil(extents.length / columns);

  const columnWidths: number[] = new Array(columns).fill(0);
  const rowHeights: number[] = new Array(rows).fill(0);
  extents.forEach((extent, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column], extent.width);
    rowHeights[row] = Math.max(rowHeights[row], extent.height);
  });

  const columnOffsets: number[] = [];
  let xCursor = originX;
  for (let column = 0; column < columns; column += 1) {
    columnOffsets.push(xCursor);
    xCursor += columnWidths[column] + columnGap;
  }
  const rowOffsets: number[] = [];
  let yCursor = originY;
  for (let row = 0; row < rows; row += 1) {
    rowOffsets.push(yCursor);
    yCursor += rowHeights[row] + rowGap;
  }

  return extents.map((_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: columnOffsets[column] + columnWidths[column] / 2,
      y: rowOffsets[row] + rowHeights[row] / 2,
    };
  });
}

export function arrangeMotionLayersInStack(
  composition: MotionComposition,
  layerIds: readonly string[],
  options: ArrangeMotionStackOptions,
): MotionComposition {
  const ordered = layerIds
    .map((id) => composition.layers.find((layer) => layer.id === id))
    .filter((layer): layer is MotionLayer => Boolean(layer));
  if (ordered.length === 0) return composition;

  const extents = ordered.map((layer) =>
    getMotionLayerExtentInComposition(composition, layer),
  );
  const positions = computeMotionStackPositions(extents, options);
  const targets = new Map<string, MotionVector2>();
  ordered.forEach((layer, index) => targets.set(layer.id, positions[index]));

  let changed = false;
  const layers = composition.layers.map((layer) => {
    const target = targets.get(layer.id);
    if (!target) return layer;
    const current = layer.transform.position;
    if (round4(target.x) === current.x && round4(target.y) === current.y) {
      return layer;
    }
    changed = true;
    return withMotionLayerPosition(layer, target);
  });

  return changed ? { ...composition, layers, modifiedAt: Date.now() } : composition;
}

export function reflowMotionGroupAutoLayout(
  composition: MotionComposition,
  groupId: string,
): MotionComposition {
  const group = composition.layers.find(
    (layer): layer is MotionGroupLayer =>
      layer.id === groupId && layer.type === "group",
  );
  if (!group || !group.autoLayout || group.children.length === 0) {
    return composition;
  }
  const { direction, gap, align } = group.autoLayout;
  const children = group.children
    .map((id) => composition.layers.find((layer) => layer.id === id))
    .filter(
      (layer): layer is MotionLayer =>
        layer != null && !layer.locked && !hasMotionPositionKeyframes(layer),
    );
  if (children.length === 0) return composition;
  const extents = children.map((layer) =>
    getMotionLayerExtentInComposition(composition, layer),
  );
  const total =
    direction === "vertical"
      ? extents.reduce((sum, extent) => sum + extent.height, 0) +
        gap * (extents.length - 1)
      : extents.reduce((sum, extent) => sum + extent.width, 0) +
        gap * (extents.length - 1);
  const origin =
    direction === "vertical"
      ? { originX: 0, originY: -total / 2 }
      : { originX: -total / 2, originY: 0 };
  return arrangeMotionLayersInStack(
    composition,
    children.map((layer) => layer.id),
    { direction, gap, align, ...origin },
  );
}

export function reflowMotionAutoLayoutGroups(
  composition: MotionComposition,
): MotionComposition {
  const autoGroups = composition.layers.filter(
    (layer): layer is MotionGroupLayer =>
      layer.type === "group" && Boolean(layer.autoLayout),
  );
  if (autoGroups.length === 0) return composition;
  const ordered = [...autoGroups].sort(
    (a, b) =>
      getMotionGroupNestingDepth(composition, b.id) -
      getMotionGroupNestingDepth(composition, a.id),
  );
  let next = composition;
  for (const group of ordered) {
    next = reflowMotionGroupAutoLayout(next, group.id);
  }
  return next;
}

export function setMotionGroupAutoLayout(
  composition: MotionComposition,
  groupId: string,
  autoLayout: MotionAutoLayout | null,
): MotionComposition {
  const withConfig: MotionComposition = {
    ...composition,
    layers: composition.layers.map((layer) =>
      layer.id === groupId && layer.type === "group"
        ? ({ ...layer, autoLayout: autoLayout ?? undefined } as MotionGroupLayer)
        : layer,
    ),
    modifiedAt: Date.now(),
  };
  return autoLayout
    ? reflowMotionGroupAutoLayout(withConfig, groupId)
    : withConfig;
}

export function arrangeMotionLayersInGrid(
  composition: MotionComposition,
  layerIds: readonly string[],
  options: ArrangeMotionGridOptions,
): MotionComposition {
  const ordered = layerIds
    .map((id) => composition.layers.find((layer) => layer.id === id))
    .filter((layer): layer is MotionLayer => Boolean(layer));
  if (ordered.length === 0) return composition;

  const extents = ordered.map(getMotionLayerExtent);
  const positions = computeMotionGridPositions(extents, options);
  const targets = new Map<string, MotionVector2>();
  ordered.forEach((layer, index) => targets.set(layer.id, positions[index]));

  return {
    ...composition,
    layers: composition.layers.map((layer) => {
      const target = targets.get(layer.id);
      return target ? withMotionLayerPosition(layer, target) : layer;
    }),
    modifiedAt: Date.now(),
  };
}

export type MotionUiComponentType =
  | "button"
  | "card"
  | "input"
  | "nav-bar"
  | "avatar"
  | "badge"
  | "icon-button";

export interface MotionUiComponentProps {
  readonly name?: string;
  readonly label?: string;
  readonly title?: string;
  readonly body?: string;
  readonly placeholder?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly cornerRadius?: number;
  readonly backgroundColor?: string;
  readonly textColor?: string;
  readonly accentColor?: string;
  readonly fontSize?: number;
  readonly shadow?: boolean;
  readonly items?: readonly string[];
  readonly assetIdForAvatar?: string;
  readonly startTime?: number;
  readonly duration?: number;
}

export interface BuildMotionUiComponentResult {
  readonly layers: readonly MotionLayer[];
  readonly groupId: string;
  readonly childIds: readonly string[];
}

const SHADOW_DEFAULT: MotionUiShadowSpec = {
  color: "rgba(15,23,42,0.35)",
  blur: 32,
  offsetX: 0,
  offsetY: 18,
};

export function buildMotionUiComponent(
  type: MotionUiComponentType,
  props: MotionUiComponentProps,
  context: BuildMotionUiLayerContext,
): BuildMotionUiComponentResult {
  const centerX = finiteOr(props.x, context.compositionWidth / 2);
  const centerY = finiteOr(props.y, context.compositionHeight / 2);
  const startTime = Math.max(0, finiteOr(props.startTime, 0));
  const duration = Math.max(
    0.001,
    finiteOr(props.duration, Math.max(0.001, context.compositionDuration - startTime)),
  );

  const specs = buildComponentSpecs(type, props, { centerX, centerY });
  const namedGroupKey = "__component_group__";
  const groupSpec: MotionUiLayerSpec = {
    key: namedGroupKey,
    type: "group",
    name: props.name ?? defaultComponentName(type),
    x: centerX,
    y: centerY,
    startTime,
    duration,
  };
  const childSpecs = specs.map((spec) => ({
    ...spec,
    x: round4(finiteOr(spec.x, centerX) - centerX),
    y: round4(finiteOr(spec.y, centerY) - centerY),
    parentKey: namedGroupKey,
    startTime,
    duration,
  }));

  const { layers, keyToId } = buildMotionUiLayers(
    [groupSpec, ...childSpecs],
    context,
  );
  const groupId = keyToId[namedGroupKey];
  const childIds = layers
    .filter((layer) => layer.id !== groupId)
    .map((layer) => layer.id);
  return { layers, groupId, childIds };
}

function buildComponentSpecs(
  type: MotionUiComponentType,
  props: MotionUiComponentProps,
  center: { readonly centerX: number; readonly centerY: number },
): MotionUiLayerSpec[] {
  const { centerX, centerY } = center;
  const accent = props.accentColor ?? props.backgroundColor ?? "#14b8a6";
  const textColor = props.textColor ?? "#ffffff";
  const shadow = props.shadow ? SHADOW_DEFAULT : undefined;

  switch (type) {
    case "button": {
      const width = Math.max(1, finiteOr(props.width, 280));
      const height = Math.max(1, finiteOr(props.height, 72));
      return [
        {
          type: "shape",
          name: "Button background",
          x: centerX,
          y: centerY,
          width,
          height,
          shapeType: "rectangle",
          style: {
            fill: { type: "solid", color: accent, opacity: 1 },
            stroke: { color: accent, width: 0, opacity: 0 },
            cornerRadius: finiteOr(props.cornerRadius, height / 2),
            ...(shadow ? { shadow } : {}),
          },
        },
        {
          type: "text",
          name: "Button label",
          x: centerX,
          y: centerY,
          text: props.label ?? "Get started",
          textStyle: {
            color: textColor,
            fontSize: finiteOr(props.fontSize, Math.round(height * 0.34)),
            fontWeight: 700,
            align: "center",
          },
        },
      ];
    }
    case "card": {
      const width = Math.max(1, finiteOr(props.width, 360));
      const height = Math.max(1, finiteOr(props.height, 280));
      const padding = Math.min(width, height) * 0.12;
      const specs: MotionUiLayerSpec[] = [
        {
          type: "shape",
          name: "Card background",
          x: centerX,
          y: centerY,
          width,
          height,
          shapeType: "rectangle",
          style: {
            fill: { type: "solid", color: props.backgroundColor ?? "#1f2937", opacity: 1 },
            stroke: { color: "#334155", width: 1, opacity: 0.6 },
            cornerRadius: finiteOr(props.cornerRadius, 24),
            ...(shadow ? { shadow } : {}),
          },
        },
      ];
      if (props.title) {
        specs.push({
          type: "text",
          name: "Card title",
          x: centerX - width / 2 + padding,
          y: centerY - height / 2 + padding + finiteOr(props.fontSize, 28),
          text: props.title,
          textStyle: {
            color: textColor,
            fontSize: finiteOr(props.fontSize, 28),
            fontWeight: 700,
            align: "left",
          },
        });
      }
      if (props.body) {
        specs.push({
          type: "text",
          name: "Card body",
          x: centerX - width / 2 + padding,
          y: centerY,
          text: props.body,
          textStyle: {
            color: "#cbd5e1",
            fontSize: Math.round(finiteOr(props.fontSize, 28) * 0.62),
            fontWeight: 400,
            align: "left",
            lineHeight: 1.3,
          },
        });
      }
      return specs;
    }
    case "input": {
      const width = Math.max(1, finiteOr(props.width, 360));
      const height = Math.max(1, finiteOr(props.height, 64));
      const padding = height * 0.4;
      return [
        {
          type: "shape",
          name: "Input field",
          x: centerX,
          y: centerY,
          width,
          height,
          shapeType: "rectangle",
          style: {
            fill: { type: "solid", color: props.backgroundColor ?? "#0f172a", opacity: 1 },
            stroke: { color: accent, width: 1.5, opacity: 0.8 },
            cornerRadius: finiteOr(props.cornerRadius, 12),
          },
        },
        {
          type: "text",
          name: "Input placeholder",
          x: centerX - width / 2 + padding,
          y: centerY,
          text: props.placeholder ?? "Enter your email",
          textStyle: {
            color: "#94a3b8",
            fontSize: finiteOr(props.fontSize, Math.round(height * 0.42)),
            fontWeight: 400,
            align: "left",
          },
        },
      ];
    }
    case "nav-bar": {
      const width = Math.max(1, finiteOr(props.width, 1280));
      const height = Math.max(1, finiteOr(props.height, 88));
      const padding = height * 0.6;
      const items = props.items ?? ["Home", "Features", "Pricing"];
      const specs: MotionUiLayerSpec[] = [
        {
          type: "shape",
          name: "Nav background",
          x: centerX,
          y: centerY,
          width,
          height,
          shapeType: "rectangle",
          style: {
            fill: { type: "solid", color: props.backgroundColor ?? "#0b1120", opacity: 1 },
            stroke: { color: "#1e293b", width: 0, opacity: 0 },
            cornerRadius: finiteOr(props.cornerRadius, 0),
            ...(shadow ? { shadow } : {}),
          },
        },
        {
          type: "text",
          name: "Nav logo",
          x: centerX - width / 2 + padding,
          y: centerY,
          text: props.title ?? props.label ?? "Brand",
          textStyle: {
            color: textColor,
            fontSize: finiteOr(props.fontSize, Math.round(height * 0.36)),
            fontWeight: 800,
            align: "left",
          },
        },
      ];
      const itemFontSize = Math.round(finiteOr(props.fontSize, Math.round(height * 0.3)) * 0.82);
      const itemGap = width * 0.12;
      items.forEach((item, index) => {
        specs.push({
          type: "text",
          name: `Nav item ${index + 1}`,
          x: centerX + width / 2 - padding - itemGap * (items.length - 1 - index),
          y: centerY,
          text: item,
          textStyle: {
            color: "#cbd5e1",
            fontSize: itemFontSize,
            fontWeight: 500,
            align: "center",
          },
        });
      });
      return specs;
    }
    case "avatar": {
      const size = Math.max(1, finiteOr(props.width ?? props.height, 96));
      const specs: MotionUiLayerSpec[] = [];
      if (props.assetIdForAvatar) {
        specs.push({
          type: "image",
          name: "Avatar image",
          x: centerX,
          y: centerY,
          width: size,
          height: size,
          assetId: props.assetIdForAvatar,
          fit: "cover",
        });
      }
      specs.unshift({
        type: "shape",
        name: "Avatar",
        x: centerX,
        y: centerY,
        width: size,
        height: size,
        shapeType: "circle",
        style: {
          fill: { type: "solid", color: accent, opacity: 1 },
          stroke: { color: "#ffffff", width: 2, opacity: 0.8 },
        },
      });
      return specs;
    }
    case "badge": {
      const width = Math.max(1, finiteOr(props.width, 120));
      const height = Math.max(1, finiteOr(props.height, 40));
      return [
        {
          type: "shape",
          name: "Badge background",
          x: centerX,
          y: centerY,
          width,
          height,
          shapeType: "rectangle",
          style: {
            fill: { type: "solid", color: accent, opacity: 1 },
            stroke: { color: accent, width: 0, opacity: 0 },
            cornerRadius: finiteOr(props.cornerRadius, height / 2),
          },
        },
        {
          type: "text",
          name: "Badge label",
          x: centerX,
          y: centerY,
          text: props.label ?? "New",
          textStyle: {
            color: textColor,
            fontSize: finiteOr(props.fontSize, Math.round(height * 0.45)),
            fontWeight: 700,
            align: "center",
          },
        },
      ];
    }
    case "icon-button": {
      const size = Math.max(1, finiteOr(props.width ?? props.height, 56));
      return [
        {
          type: "shape",
          name: "Icon button",
          x: centerX,
          y: centerY,
          width: size,
          height: size,
          shapeType: "rectangle",
          style: {
            fill: { type: "solid", color: props.backgroundColor ?? "#1f2937", opacity: 1 },
            stroke: { color: accent, width: 1, opacity: 0.7 },
            cornerRadius: finiteOr(props.cornerRadius, size / 4),
          },
        },
        {
          type: "text",
          name: "Icon glyph",
          x: centerX,
          y: centerY,
          text: props.label ?? "+",
          textStyle: {
            color: textColor,
            fontSize: finiteOr(props.fontSize, Math.round(size * 0.5)),
            fontWeight: 700,
            align: "center",
          },
        },
      ];
    }
    default:
      throw new Error(`Unsupported motion UI component: ${String(type)}`);
  }
}

function defaultLayerName(type: MotionUiLayerType): string {
  switch (type) {
    case "text":
      return "Text";
    case "shape":
      return "Shape";
    case "image":
      return "Image";
    case "group":
      return "Group";
    case "null":
      return "Null";
    case "adjustment":
      return "Adjustment";
    default:
      return "Layer";
  }
}

function defaultComponentName(type: MotionUiComponentType): string {
  switch (type) {
    case "button":
      return "Button";
    case "card":
      return "Card";
    case "input":
      return "Input field";
    case "nav-bar":
      return "Nav bar";
    case "avatar":
      return "Avatar";
    case "badge":
      return "Badge";
    case "icon-button":
      return "Icon button";
    default:
      return "Component";
  }
}

export const MOTION_UI_COMPONENT_TYPES: readonly MotionUiComponentType[] = [
  "button",
  "card",
  "input",
  "nav-bar",
  "avatar",
  "badge",
  "icon-button",
];

export const MOTION_UI_LAYOUT_MODES: readonly string[] = [
  "stack-vertical",
  "stack-horizontal",
  "grid",
];
