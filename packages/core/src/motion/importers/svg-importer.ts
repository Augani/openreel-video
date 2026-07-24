import { DEFAULT_SHAPE_STYLE } from "../../graphics/types";
import type { FillStyle, GradientStop } from "../../graphics/types";
import { motionEngine } from "../motion-engine";
import type {
  MotionComposition,
  MotionLayer,
  MotionShapeLayer,
  MotionTextLayer,
} from "../types";
import { DEFAULT_MOTION_TRANSFORM } from "../types";
import { centerMotionPathData } from "../motion-shape-path";

interface AffineMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

interface SvgGradient {
  readonly type: "linear" | "radial";
  readonly angle: number;
  readonly stops: GradientStop[];
}

const IDENTITY_MATRIX: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export interface SvgMotionImportOptions {
  readonly name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly duration?: number;
  readonly frameRate?: number;
}

interface SvgBounds {
  readonly width: number;
  readonly height: number;
  readonly viewBoxX: number;
  readonly viewBoxY: number;
  readonly viewBoxWidth: number;
  readonly viewBoxHeight: number;
}

export function importSvgAsMotionComposition(
  svgContent: string,
  options: SvgMotionImportOptions = {},
): MotionComposition {
  const bounds = parseSvgBounds(svgContent, options);
  const duration = options.duration ?? 5;
  const composition = motionEngine.createComposition({
    name: options.name ?? "Imported SVG Motion",
    width: options.width ?? bounds.width,
    height: options.height ?? bounds.height,
    frameRate: options.frameRate ?? 30,
    duration,
    backgroundColor: "transparent",
  });
  const scaleX = composition.width / bounds.viewBoxWidth;
  const scaleY = composition.height / bounds.viewBoxHeight;
  const gradients = parseSvgGradients(svgContent);
  const baseMatrix: AffineMatrix = {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: -bounds.viewBoxX * scaleX,
    f: -bounds.viewBoxY * scaleY,
  };
  const context: SvgParseContext = { composition, bounds, gradients, counter: { value: 0 } };
  const layers = parseSvgNodes(svgBody(svgContent), baseMatrix, context);

  return {
    ...composition,
    assets: [
      {
        id: uid("asset-svg"),
        type: "svg",
        name: options.name ?? "Imported SVG",
        data: svgContent,
        width: bounds.width,
        height: bounds.height,
      },
    ],
    layers: layers.length > 0 ? layers : [fallbackSvgFrame(composition)],
    modifiedAt: Date.now(),
  };
}

interface SvgParseContext {
  readonly composition: MotionComposition;
  readonly bounds: SvgBounds;
  readonly gradients: Map<string, SvgGradient>;
  readonly counter: { value: number };
}

interface SvgElement {
  readonly tag: string;
  readonly attrs: Record<string, string>;
  readonly inner: string;
}

function parseSvgNodes(
  content: string,
  parentMatrix: AffineMatrix,
  context: SvgParseContext,
): MotionLayer[] {
  const layers: MotionLayer[] = [];
  for (const element of iterateSvgElements(content)) {
    if (element.tag === "g") {
      const matrix = multiplyMatrix(
        parentMatrix,
        parseTransformMatrix(element.attrs.transform),
      );
      layers.push(...parseSvgNodes(element.inner, matrix, context));
      continue;
    }
    const matrix = multiplyMatrix(
      parentMatrix,
      parseTransformMatrix(element.attrs.transform),
    );
    const layer = convertSvgElement(element, matrix, context);
    if (layer) layers.push(layer);
  }
  return layers;
}

function convertSvgElement(
  element: SvgElement,
  matrix: AffineMatrix,
  context: SvgParseContext,
): MotionLayer | null {
  const { attrs } = element;
  const index = context.counter.value;
  const scale = matrixScale(matrix);

  if (element.tag === "rect") {
    const rawWidth = readNumber(attrs.width, 0);
    const rawHeight = readNumber(attrs.height, 0);
    if (rawWidth <= 0 || rawHeight <= 0) return null;
    const center = applyMatrix(matrix, {
      x: readNumber(attrs.x, 0) + rawWidth / 2,
      y: readNumber(attrs.y, 0) + rawHeight / 2,
    });
    context.counter.value += 1;
    return shapeLayer(context.composition, attrs, index, context, {
      name: attrs.id ?? "SVG Rectangle",
      shapeType: "rectangle",
      x: center.x,
      y: center.y,
      width: rawWidth * scale.x,
      height: rawHeight * scale.y,
      cornerRadius: readNumber(attrs.rx, readNumber(attrs.ry, 0)) * scale.x,
    });
  }

  if (element.tag === "circle") {
    const radius = readNumber(attrs.r, 0);
    if (radius <= 0) return null;
    const center = applyMatrix(matrix, {
      x: readNumber(attrs.cx, 0),
      y: readNumber(attrs.cy, 0),
    });
    context.counter.value += 1;
    return shapeLayer(context.composition, attrs, index, context, {
      name: attrs.id ?? "SVG Circle",
      shapeType: "ellipse",
      x: center.x,
      y: center.y,
      width: radius * 2 * scale.x,
      height: radius * 2 * scale.y,
    });
  }

  if (element.tag === "ellipse") {
    const rx = readNumber(attrs.rx, 0);
    const ry = readNumber(attrs.ry, 0);
    if (rx <= 0 || ry <= 0) return null;
    const center = applyMatrix(matrix, {
      x: readNumber(attrs.cx, 0),
      y: readNumber(attrs.cy, 0),
    });
    context.counter.value += 1;
    return shapeLayer(context.composition, attrs, index, context, {
      name: attrs.id ?? "SVG Ellipse",
      shapeType: "ellipse",
      x: center.x,
      y: center.y,
      width: rx * 2 * scale.x,
      height: ry * 2 * scale.y,
    });
  }

  if (element.tag === "line") {
    const start = applyMatrix(matrix, {
      x: readNumber(attrs.x1, 0),
      y: readNumber(attrs.y1, 0),
    });
    const end = applyMatrix(matrix, {
      x: readNumber(attrs.x2, 0),
      y: readNumber(attrs.y2, 0),
    });
    context.counter.value += 1;
    return pathLayerFromPoints(
      [start, end],
      false,
      attrs.id ?? "SVG Line",
      attrs,
      index,
      context,
    );
  }

  if (element.tag === "polyline" || element.tag === "polygon") {
    const rawPoints = parsePointList(attrs.points);
    if (rawPoints.length < 2) return null;
    const points = rawPoints.map((point) => applyMatrix(matrix, point));
    const closed = element.tag === "polygon";
    context.counter.value += 1;
    return pathLayerFromPoints(
      points,
      closed,
      attrs.id ?? (closed ? "SVG Polygon" : "SVG Polyline"),
      attrs,
      index,
      context,
    );
  }

  if (element.tag === "path") {
    const pathData = attrs.d;
    if (!pathData) return null;
    const centeredPath = centerMotionPathData(pathData, {
      scaleX: matrix.a,
      scaleY: matrix.d,
      translateX: matrix.e,
      translateY: matrix.f,
    });
    if (!centeredPath) return null;
    context.counter.value += 1;
    return shapeLayer(context.composition, attrs, index, context, {
      name: attrs.id ?? "SVG Path",
      shapeType: "path",
      x: centeredPath.centerX,
      y: centeredPath.centerY,
      width: centeredPath.width,
      height: centeredPath.height,
      pathData: centeredPath.pathData,
      pathClosed: centeredPath.closed,
    });
  }

  if (element.tag === "text") {
    const text = decodeXmlText(stripTags(element.inner).trim());
    if (!text) return null;
    const position = applyMatrix(matrix, {
      x: readNumber(attrs.x, context.bounds.viewBoxWidth / 2),
      y: readNumber(attrs.y, context.bounds.viewBoxHeight / 2),
    });
    context.counter.value += 1;
    return textLayer(context.composition, attrs, index, {
      name: attrs.id ?? "SVG Text",
      text,
      x: position.x,
      y: position.y,
      fontSize: readNumber(attrs["font-size"], 48) * Math.min(scale.x, scale.y),
    });
  }

  return null;
}

function pathLayerFromPoints(
  points: readonly { x: number; y: number }[],
  closed: boolean,
  name: string,
  attrs: Record<string, string>,
  index: number,
  context: SvgParseContext,
): MotionShapeLayer | null {
  const closedPoints = closed ? [...points, points[0]] : points;
  if (closedPoints.length < 2) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of closedPoints) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const pathData = closedPoints
    .map(
      (point, pointIndex) =>
        `${pointIndex === 0 ? "M" : "L"} ${round(point.x - centerX)} ${round(
          point.y - centerY,
        )}`,
    )
    .join(" ");
  return shapeLayer(context.composition, attrs, index, context, {
    name,
    shapeType: "path",
    x: centerX,
    y: centerY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    pathData,
    pathClosed: closed,
  });
}

function* iterateSvgElements(content: string): Generator<SvgElement> {
  const elementRe =
    /<(g|rect|circle|ellipse|line|polyline|polygon|path|text)\b([^>]*?)(\/?)>/gi;
  let match: RegExpExecArray | null;
  while ((match = elementRe.exec(content)) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = parseAttributes(match[2]);
    const selfClosing = match[3] === "/";
    if (selfClosing) {
      yield { tag, attrs, inner: "" };
      continue;
    }
    const closeTag = `</${tag}>`;
    const closeIndex = findMatchingClose(content, tag, elementRe.lastIndex);
    if (closeIndex < 0) {
      yield { tag, attrs, inner: "" };
      continue;
    }
    yield { tag, attrs, inner: content.slice(elementRe.lastIndex, closeIndex) };
    elementRe.lastIndex = closeIndex + closeTag.length;
  }
}

function findMatchingClose(
  content: string,
  tag: string,
  fromIndex: number,
): number {
  const openRe = new RegExp(`<${tag}\\b[^>]*?(/?)>`, "gi");
  const closeRe = new RegExp(`</${tag}>`, "gi");
  let depth = 1;
  let cursor = fromIndex;
  while (depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const openMatch = openRe.exec(content);
    const closeMatch = closeRe.exec(content);
    if (!closeMatch) return -1;
    if (openMatch && openMatch.index < closeMatch.index) {
      if (openMatch[1] !== "/") depth += 1;
      cursor = openMatch.index + openMatch[0].length;
    } else {
      depth -= 1;
      if (depth === 0) return closeMatch.index;
      cursor = closeMatch.index + closeMatch[0].length;
    }
  }
  return -1;
}

function shapeLayer(
  composition: MotionComposition,
  attrs: Record<string, string>,
  index: number,
  context: SvgParseContext | null,
  options: {
    readonly name: string;
    readonly shapeType: MotionShapeLayer["shapeType"];
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly cornerRadius?: number;
    readonly pathData?: string;
    readonly pathClosed?: boolean;
  },
): MotionShapeLayer {
  const solidFill = attrs.fill && attrs.fill !== "none" ? attrs.fill : "#14b8a6";
  const stroke = attrs.stroke && attrs.stroke !== "none" ? attrs.stroke : solidFill;
  const opacity = readNumber(attrs.opacity, readNumber(attrs["fill-opacity"], 1));
  return {
    id: uid("svg-layer"),
    type: "shape",
    name: options.name,
    startTime: 0,
    duration: composition.duration,
    visible: true,
    locked: false,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: { x: options.x, y: options.y },
      opacity,
    },
    keyframes: entranceKeyframes(index),
    shapeType: options.shapeType,
    width: options.width,
    height: options.height,
    pathData: options.pathData,
    pathClosed: options.pathClosed,
    style: {
      ...DEFAULT_SHAPE_STYLE,
      fill: resolveFillStyle(attrs, solidFill, context),
      stroke: {
        color: stroke,
        width: readNumber(attrs["stroke-width"], 0),
        opacity: attrs.stroke === "none" ? 0 : readNumber(attrs["stroke-opacity"], 1),
      },
      cornerRadius: options.cornerRadius ?? 0,
    },
  };
}

function resolveFillStyle(
  attrs: Record<string, string>,
  solidFill: string,
  context: SvgParseContext | null,
): FillStyle {
  const fillValue = attrs.fill?.trim();
  const fillOpacity = readNumber(attrs["fill-opacity"], 1);
  if (fillValue === "none") {
    return { type: "none", color: solidFill, opacity: fillOpacity };
  }
  const gradientId = parseUrlReference(fillValue);
  if (gradientId && context) {
    const gradient = context.gradients.get(gradientId);
    if (gradient && gradient.stops.length > 0) {
      return {
        type: "gradient",
        color: gradient.stops[0].color,
        opacity: fillOpacity,
        gradient: {
          type: gradient.type,
          angle: gradient.angle,
          stops: gradient.stops,
        },
      };
    }
  }
  return { type: "solid", color: solidFill, opacity: fillOpacity };
}

function parseUrlReference(value: string | undefined): string | null {
  if (!value) return null;
  const match = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/i.exec(value);
  return match ? match[1] : null;
}

function parseSvgGradients(svgContent: string): Map<string, SvgGradient> {
  const gradients = new Map<string, SvgGradient>();
  const gradientRe =
    /<(linearGradient|radialGradient)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of svgContent.matchAll(gradientRe)) {
    const type = match[1].toLowerCase() === "radialgradient" ? "radial" : "linear";
    const attrs = parseAttributes(match[2]);
    const id = attrs.id;
    if (!id) continue;
    const stops = parseGradientStops(match[3]);
    if (stops.length === 0) continue;
    gradients.set(id, {
      type,
      angle: gradientAngle(attrs),
      stops,
    });
  }
  return gradients;
}

function parseGradientStops(inner: string): GradientStop[] {
  const stops: GradientStop[] = [];
  for (const match of inner.matchAll(/<stop\b([^>]*)\/?>/gi)) {
    const attrs = parseAttributes(match[1]);
    const offsetRaw = attrs.offset ?? "0";
    const offset = offsetRaw.includes("%")
      ? readNumber(offsetRaw, 0) / 100
      : readNumber(offsetRaw, 0);
    const color = attrs["stop-color"] ?? "#ffffff";
    stops.push({
      offset: Math.min(1, Math.max(0, offset)),
      color,
    });
  }
  return stops;
}

function gradientAngle(attrs: Record<string, string>): number {
  const x1 = readNumber(attrs.x1, 0);
  const y1 = readNumber(attrs.y1, 0);
  const x2 = readNumber(attrs.x2, 1);
  const y2 = readNumber(attrs.y2, 0);
  return (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
}

function textLayer(
  composition: MotionComposition,
  attrs: Record<string, string>,
  index: number,
  options: {
    readonly name: string;
    readonly text: string;
    readonly x: number;
    readonly y: number;
    readonly fontSize: number;
  },
): MotionTextLayer {
  return {
    id: uid("svg-text"),
    type: "text",
    name: options.name,
    startTime: 0,
    duration: composition.duration,
    visible: true,
    locked: false,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: { x: options.x, y: options.y },
      opacity: readNumber(attrs.opacity, readNumber(attrs["fill-opacity"], 1)),
    },
    keyframes: entranceKeyframes(index),
    text: options.text,
    style: {
      fontFamily: attrs["font-family"] ?? "Inter",
      fontSize: options.fontSize,
      fontWeight: attrs["font-weight"] ?? 700,
      color: attrs.fill && attrs.fill !== "none" ? attrs.fill : "#ffffff",
      align: readTextAnchor(attrs["text-anchor"]),
      lineHeight: 1.05,
    },
  };
}

function fallbackSvgFrame(composition: MotionComposition): MotionShapeLayer {
  return shapeLayer(
    composition,
    { fill: "none", stroke: "#14b8a6", "stroke-width": "4" },
    0,
    null,
    {
      name: "SVG Frame",
      shapeType: "rectangle",
      x: composition.width / 2,
      y: composition.height / 2,
      width: Math.min(composition.width * 0.5, 720),
      height: Math.min(composition.height * 0.32, 360),
      cornerRadius: 24,
    },
  );
}

function svgBody(svgContent: string): string {
  const openMatch = svgContent.match(/<svg\b[^>]*>/i);
  const start = openMatch ? (openMatch.index ?? 0) + openMatch[0].length : 0;
  const closeIndex = svgContent.lastIndexOf("</svg>");
  const body =
    closeIndex >= 0 ? svgContent.slice(start, closeIndex) : svgContent.slice(start);
  return stripDefsAndContent(body);
}

function stripDefsAndContent(body: string): string {
  return body
    .replace(/<defs\b[^>]*>[\s\S]*?<\/defs>/gi, "")
    .replace(
      /<(linearGradient|radialGradient)\b[^>]*>[\s\S]*?<\/\1>/gi,
      "",
    )
    .replace(/<clipPath\b[^>]*>[\s\S]*?<\/clipPath>/gi, "")
    .replace(/<mask\b[^>]*>[\s\S]*?<\/mask>/gi, "");
}

function parsePointList(value: string | undefined): { x: number; y: number }[] {
  if (!value) return [];
  const numbers = value
    .trim()
    .split(/[\s,]+/)
    .map((entry) => Number.parseFloat(entry))
    .filter((entry) => Number.isFinite(entry));
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }
  return points;
}

function parseTransformMatrix(transform: string | undefined): AffineMatrix {
  if (!transform?.trim()) return IDENTITY_MATRIX;
  let matrix = IDENTITY_MATRIX;
  const transformRe = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/gi;
  for (const match of transform.matchAll(transformRe)) {
    const command = match[1].toLowerCase();
    const args = match[2]
      .trim()
      .split(/[\s,]+/)
      .map((entry) => Number.parseFloat(entry))
      .filter((entry) => Number.isFinite(entry));
    matrix = multiplyMatrix(matrix, transformCommandMatrix(command, args));
  }
  return matrix;
}

function transformCommandMatrix(command: string, args: number[]): AffineMatrix {
  if (command === "translate") {
    return { ...IDENTITY_MATRIX, e: args[0] ?? 0, f: args[1] ?? 0 };
  }
  if (command === "scale") {
    const sx = args[0] ?? 1;
    const sy = args[1] ?? sx;
    return { ...IDENTITY_MATRIX, a: sx, d: sy };
  }
  if (command === "rotate") {
    const angle = ((args[0] ?? 0) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cx = args[1] ?? 0;
    const cy = args[2] ?? 0;
    const rotation: AffineMatrix = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
    if (cx === 0 && cy === 0) return rotation;
    return multiplyMatrix(
      { ...IDENTITY_MATRIX, e: cx, f: cy },
      multiplyMatrix(rotation, { ...IDENTITY_MATRIX, e: -cx, f: -cy }),
    );
  }
  if (command === "matrix" && args.length >= 6) {
    return { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
  }
  return IDENTITY_MATRIX;
}

function multiplyMatrix(first: AffineMatrix, second: AffineMatrix): AffineMatrix {
  return {
    a: first.a * second.a + first.c * second.b,
    b: first.b * second.a + first.d * second.b,
    c: first.a * second.c + first.c * second.d,
    d: first.b * second.c + first.d * second.d,
    e: first.a * second.e + first.c * second.f + first.e,
    f: first.b * second.e + first.d * second.f + first.f,
  };
}

function applyMatrix(
  matrix: AffineMatrix,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

function matrixScale(matrix: AffineMatrix): { x: number; y: number } {
  return {
    x: Math.hypot(matrix.a, matrix.b),
    y: Math.hypot(matrix.c, matrix.d),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function parseSvgBounds(
  svgContent: string,
  options: SvgMotionImportOptions,
): SvgBounds {
  const svgMatch = svgContent.match(/<svg\b([^>]*)>/i);
  const attrs = svgMatch ? parseAttributes(svgMatch[1]) : {};
  const viewBox = attrs.viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map((value) => Number(value));
  const viewBoxX = viewBox?.[0] ?? 0;
  const viewBoxY = viewBox?.[1] ?? 0;
  const viewBoxWidth = positiveNumber(viewBox?.[2]) ?? readNumber(attrs.width, 1920);
  const viewBoxHeight = positiveNumber(viewBox?.[3]) ?? readNumber(attrs.height, 1080);
  const width = options.width ?? readNumber(attrs.width, viewBoxWidth);
  const height = options.height ?? readNumber(attrs.height, viewBoxHeight);
  return {
    width: positiveNumber(width) ?? 1920,
    height: positiveNumber(height) ?? 1080,
    viewBoxX,
    viewBoxY,
    viewBoxWidth: positiveNumber(viewBoxWidth) ?? 1920,
    viewBoxHeight: positiveNumber(viewBoxHeight) ?? 1080,
  };
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[match[1]] = match[3] ?? match[4] ?? "";
  }
  const style = attrs.style;
  if (style) {
    for (const declaration of style.split(";")) {
      const [key, value] = declaration.split(":").map((part) => part.trim());
      if (key && value && attrs[key] === undefined) {
        attrs[key] = value;
      }
    }
  }
  return attrs;
}

function entranceKeyframes(index: number): MotionLayer["keyframes"] {
  const start = Math.min(0.6, index * 0.04);
  return [
    {
      id: uid("svg-kf"),
      property: "transform.opacity",
      time: start,
      value: 0,
      easing: "ease-out",
    },
    {
      id: uid("svg-kf"),
      property: "transform.opacity",
      time: start + 0.35,
      value: 1,
      easing: "ease-out",
    },
  ];
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value.replace(/px$/i, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function readTextAnchor(value: string | undefined): CanvasTextAlign {
  if (value === "start") return "left";
  if (value === "end") return "right";
  return "center";
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
