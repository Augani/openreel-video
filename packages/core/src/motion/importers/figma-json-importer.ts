import { DEFAULT_SHAPE_STYLE } from "../../graphics/types";
import { motionEngine } from "../motion-engine";
import type {
  MotionComposition,
  MotionLayer,
  MotionShapeLayer,
  MotionTextLayer,
} from "../types";
import { DEFAULT_MOTION_TRANSFORM } from "../types";
import { centerMotionPathData } from "../motion-shape-path";

interface FigmaBoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface FigmaNode {
  readonly type: string;
  readonly name?: string;
  readonly absoluteBoundingBox?: FigmaBoundingBox;
  readonly fills?: readonly FigmaPaint[];
  readonly children?: readonly FigmaNode[];
  readonly characters?: string;
  readonly style?: FigmaTextStyle;
  readonly cornerRadius?: number;
  readonly opacity?: number;
  readonly visible?: boolean;
  readonly fillGeometry?: readonly { readonly path?: string }[];
}

interface FigmaPaint {
  readonly type?: string;
  readonly color?: { readonly r: number; readonly g: number; readonly b: number; readonly a?: number };
  readonly opacity?: number;
  readonly visible?: boolean;
}

interface FigmaTextStyle {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: number;
  readonly textAlignHorizontal?: string;
  readonly lineHeightPx?: number;
  readonly letterSpacing?: number;
}

const SHAPE_NODE_TYPES = new Set([
  "RECTANGLE",
  "ELLIPSE",
  "VECTOR",
  "FRAME",
  "GROUP",
  "COMPONENT",
  "INSTANCE",
  "LINE",
  "REGULAR_POLYGON",
  "STAR",
  "BOOLEAN_OPERATION",
]);

export function importFigmaJsonAsMotionComposition(
  figmaJson: unknown,
  name = "Imported Figma Motion",
): MotionComposition {
  const rootFrame = findRootFrame(figmaJson);
  const frameBox = rootFrame?.absoluteBoundingBox ?? { x: 0, y: 0, width: 1920, height: 1080 };
  const width = positiveNumber(frameBox.width) ?? 1920;
  const height = positiveNumber(frameBox.height) ?? 1080;

  const composition = motionEngine.createComposition({
    name,
    width,
    height,
    backgroundColor: resolveBackgroundColor(rootFrame),
  });

  const counter = { value: 0 };
  const childNodes = rootFrame?.children ?? collectTopLevelNodes(figmaJson);
  const layers = childNodes.flatMap((child) =>
    convertFigmaNode(child, frameBox, composition, counter),
  );

  return {
    ...composition,
    assets: [
      {
        id: `asset-figma-${Date.now()}`,
        type: "figma",
        name,
        data: figmaJson,
        width,
        height,
      },
    ],
    layers,
  };
}

function convertFigmaNode(
  node: FigmaNode,
  frameBox: FigmaBoundingBox,
  composition: MotionComposition,
  counter: { value: number },
): MotionLayer[] {
  if (node.visible === false) return [];

  if (node.type === "TEXT" && node.characters) {
    const textLayer = buildTextLayer(node, frameBox, composition, counter);
    return textLayer ? [textLayer] : [];
  }

  if (node.type === "GROUP" || node.type === "FRAME") {
    const children = node.children ?? [];
    if (children.length === 0) {
      const shape = buildShapeLayer(node, frameBox, composition, counter);
      return shape ? [shape] : [];
    }
    return children.flatMap((child) =>
      convertFigmaNode(child, frameBox, composition, counter),
    );
  }

  if (SHAPE_NODE_TYPES.has(node.type)) {
    const shape = buildShapeLayer(node, frameBox, composition, counter);
    if (shape) return [shape];
  }

  const children = node.children ?? [];
  if (children.length > 0) {
    return children.flatMap((child) =>
      convertFigmaNode(child, frameBox, composition, counter),
    );
  }
  return [];
}

function buildShapeLayer(
  node: FigmaNode,
  frameBox: FigmaBoundingBox,
  composition: MotionComposition,
  counter: { value: number },
): MotionShapeLayer | null {
  const box = node.absoluteBoundingBox;
  if (!box || box.width <= 0 || box.height <= 0) return null;
  const center = centerInFrame(box, frameBox);
  const index = counter.value;
  counter.value += 1;
  const fillColor = resolveSolidFill(node.fills) ?? "#3b82f6";
  const base = {
    id: uid("figma-shape"),
    type: "shape" as const,
    name: node.name ?? "Figma Shape",
    startTime: 0,
    duration: composition.duration,
    visible: true,
    locked: false,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: center,
      opacity: clamp01(node.opacity ?? 1),
    },
    keyframes: entranceKeyframes(index),
    style: {
      ...DEFAULT_SHAPE_STYLE,
      fill: { type: "solid" as const, color: fillColor, opacity: 1 },
      stroke: { color: fillColor, width: 0, opacity: 0 },
      cornerRadius: Math.max(0, node.cornerRadius ?? 0),
    },
  };

  const geometry = node.fillGeometry?.find((entry) => entry.path)?.path;
  if (node.type === "VECTOR" && geometry) {
    const centered = centerMotionPathData(geometry);
    if (centered) {
      return {
        ...base,
        shapeType: "path",
        pathData: centered.pathData,
        pathClosed: centered.closed,
        width: centered.width,
        height: centered.height,
      };
    }
  }

  return {
    ...base,
    shapeType: node.type === "ELLIPSE" ? "ellipse" : "rectangle",
    width: box.width,
    height: box.height,
  };
}

function buildTextLayer(
  node: FigmaNode,
  frameBox: FigmaBoundingBox,
  composition: MotionComposition,
  counter: { value: number },
): MotionTextLayer | null {
  const box = node.absoluteBoundingBox;
  if (!box) return null;
  const center = centerInFrame(box, frameBox);
  const index = counter.value;
  counter.value += 1;
  const fontSize = positiveNumber(node.style?.fontSize) ?? 48;
  return {
    id: uid("figma-text"),
    type: "text",
    name: node.name ?? node.characters ?? "Figma Text",
    startTime: 0,
    duration: composition.duration,
    visible: true,
    locked: false,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: center,
      opacity: clamp01(node.opacity ?? 1),
    },
    keyframes: entranceKeyframes(index),
    text: node.characters ?? "",
    style: {
      fontFamily: node.style?.fontFamily ?? "Inter",
      fontSize,
      fontWeight: node.style?.fontWeight ?? 600,
      color: resolveSolidFill(node.fills) ?? "#ffffff",
      align: resolveTextAlign(node.style?.textAlignHorizontal),
      lineHeight:
        node.style?.lineHeightPx && fontSize > 0
          ? node.style.lineHeightPx / fontSize
          : 1.2,
      letterSpacing: node.style?.letterSpacing,
    },
  };
}

function findRootFrame(value: unknown): FigmaNode | null {
  const node = asNode(value);
  if (!node) return null;

  if (
    (node.type === "FRAME" || node.type === "COMPONENT") &&
    node.absoluteBoundingBox
  ) {
    return node;
  }

  if (node.type === "DOCUMENT" || node.type === "CANVAS") {
    for (const child of node.children ?? []) {
      const frame = findRootFrame(child);
      if (frame) return frame;
    }
  }

  if (node.absoluteBoundingBox && (node.children?.length ?? 0) > 0) {
    return node;
  }

  for (const child of node.children ?? []) {
    const frame = findRootFrame(child);
    if (frame) return frame;
  }

  return node.absoluteBoundingBox ? node : null;
}

function collectTopLevelNodes(value: unknown): FigmaNode[] {
  const node = asNode(value);
  if (!node) return [];
  if (node.children?.length) return [...node.children];
  return [node];
}

function asNode(value: unknown): FigmaNode | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string") {
    if (record.document && typeof record.document === "object") {
      return asNode(record.document);
    }
    return null;
  }
  return value as FigmaNode;
}

function centerInFrame(
  box: FigmaBoundingBox,
  frameBox: FigmaBoundingBox,
): { x: number; y: number } {
  return {
    x: box.x - frameBox.x + box.width / 2,
    y: box.y - frameBox.y + box.height / 2,
  };
}

function resolveSolidFill(fills: readonly FigmaPaint[] | undefined): string | null {
  if (!fills) return null;
  for (const paint of fills) {
    if (paint.visible === false) continue;
    if (paint.type && paint.type !== "SOLID") continue;
    if (!paint.color) continue;
    return figmaColorToHex(paint.color);
  }
  return null;
}

function resolveBackgroundColor(frame: FigmaNode | null): string {
  if (!frame) return "#111827";
  const fill = resolveSolidFill(frame.fills);
  return fill ?? "#111827";
}

function figmaColorToHex(color: {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}): string {
  const channels = [color.r, color.g, color.b].map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel * 255))),
  );
  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function resolveTextAlign(value: string | undefined): CanvasTextAlign {
  if (value === "LEFT") return "left";
  if (value === "RIGHT") return "right";
  return "center";
}

function entranceKeyframes(index: number): MotionLayer["keyframes"] {
  const start = Math.min(0.6, index * 0.04);
  return [
    {
      id: uid("figma-kf"),
      property: "transform.opacity",
      time: start,
      value: 0,
      easing: "ease-out",
    },
    {
      id: uid("figma-kf"),
      property: "transform.opacity",
      time: start + 0.35,
      value: 1,
      easing: "ease-out",
    },
  ];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
