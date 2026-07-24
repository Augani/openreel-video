import type {
  FillStyle,
  GradientStop,
  ShapeStyle,
  StrokeStyle,
} from "../graphics/types";
import { evaluateMotionPropertyValueAtTime } from "./motion-expressions";
import { defaultMotionShaderParams, getMotionShaderDef } from "./shaders";
import type { MotionComposition, MotionShapeLayer } from "./types";

export interface MotionGradientLine {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface MotionRadialGradientSpec {
  readonly x0: number;
  readonly y0: number;
  readonly r0: number;
  readonly x1: number;
  readonly y1: number;
  readonly r1: number;
}

export interface MotionNormalizedStroke {
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly dashArray: readonly number[];
  readonly dashOffset: number;
  readonly lineCap: CanvasLineCap;
  readonly lineJoin: CanvasLineJoin;
}

export function normalizeMotionGradientStops(
  stops: readonly GradientStop[] | undefined,
): GradientStop[] {
  const normalized = (stops ?? [])
    .map((stop) => ({
      offset: clamp(stop.offset, 0, 1),
      color: stop.color || "#ffffff",
    }))
    .sort((a, b) => a.offset - b.offset);

  if (normalized.length === 0) {
    return [
      { offset: 0, color: "#14b8a6" },
      { offset: 1, color: "#ffffff" },
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

export function getMotionLinearGradientLine(
  width: number,
  height: number,
  angleDegrees = 0,
): MotionGradientLine {
  const safeWidth = Math.max(1, finite(width, 1));
  const safeHeight = Math.max(1, finite(height, 1));
  const radians = (finite(angleDegrees, 0) * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const halfLength = Math.sqrt(safeWidth ** 2 + safeHeight ** 2) / 2;
  return {
    x0: round(-dx * halfLength),
    y0: round(-dy * halfLength),
    x1: round(dx * halfLength),
    y1: round(dy * halfLength),
  };
}

export function getMotionRadialGradientSpec(
  width: number,
  height: number,
): MotionRadialGradientSpec {
  const safeWidth = Math.max(1, finite(width, 1));
  const safeHeight = Math.max(1, finite(height, 1));
  return {
    x0: 0,
    y0: 0,
    r0: 0,
    x1: 0,
    y1: 0,
    r1: round(Math.sqrt(safeWidth ** 2 + safeHeight ** 2) / 2),
  };
}

export function normalizeMotionStroke(
  stroke: StrokeStyle,
): MotionNormalizedStroke {
  return {
    color: stroke.color || "#ffffff",
    width: Math.max(0, finite(stroke.width, 0)),
    opacity: clamp(stroke.opacity, 0, 1),
    dashArray: (stroke.dashArray ?? [])
      .map((dash) => Math.max(0, finite(dash, 0)))
      .filter((dash) => dash > 0),
    dashOffset: finite(stroke.dashOffset, 0),
    lineCap: stroke.lineCap ?? "butt",
    lineJoin: stroke.lineJoin ?? "miter",
  };
}

export function isGradientFill(fill: FillStyle): boolean {
  return fill.type === "gradient" && Boolean(fill.gradient);
}

export function createDefaultMotionGradientFill(
  color = "#14b8a6",
  accent = "#ffffff",
): FillStyle {
  return {
    type: "gradient",
    opacity: 1,
    gradient: {
      type: "linear",
      angle: 0,
      stops: [
        { offset: 0, color },
        { offset: 1, color: accent },
      ],
    },
  };
}

export function createSolidMotionFill(color = "#14b8a6"): FillStyle {
  return {
    type: "solid",
    color,
    opacity: 1,
  };
}

export function isShaderFill(fill: FillStyle): boolean {
  return fill.type === "shader";
}

export function createDefaultMotionShaderFill(shaderId: string): FillStyle {
  const def = getMotionShaderDef(shaderId);
  if (!def) {
    throw new Error(`Unsupported motion shader fill: ${shaderId}`);
  }
  return {
    type: "shader",
    opacity: 1,
    shader: {
      shaderId,
      params: defaultMotionShaderParams(def),
    },
  };
}

export function hasAdvancedMotionShapeStyle(style: ShapeStyle): boolean {
  return (
    isGradientFill(style.fill) ||
    Boolean(style.stroke.dashArray?.length) ||
    Boolean(style.stroke.dashOffset) ||
    Boolean(style.stroke.lineCap && style.stroke.lineCap !== "butt") ||
    Boolean(style.stroke.lineJoin && style.stroke.lineJoin !== "miter")
  );
}

export function evaluateMotionShapeLayerStyleAtTime<T extends MotionShapeLayer>(
  layer: T,
  localTime: number,
  composition?: MotionComposition,
): T {
  const context = composition ? { composition, layer } : undefined;
  const value = (property: string, fallback: number): number =>
    evaluateMotionPropertyValueAtTime({
      keyframes: layer.keyframes,
      expressions: layer.expressions,
      property,
      localTime,
      fallback,
      duration: layer.duration,
      context,
    });
  const fillOpacity = clamp(
    value("shape.fill.opacity", layer.style.fill.opacity),
    0,
    1,
  );
  const strokeOpacity = clamp(
    value("shape.stroke.opacity", layer.style.stroke.opacity),
    0,
    1,
  );
  const gradient =
    layer.style.fill.type === "gradient" && layer.style.fill.gradient
      ? {
          ...layer.style.fill.gradient,
          angle: value(
            "shape.gradient.angle",
            layer.style.fill.gradient.angle ?? 0,
          ),
        }
      : layer.style.fill.gradient;

  return {
    ...layer,
    width: Math.max(1, value("shape.width", layer.width)),
    height: Math.max(1, value("shape.height", layer.height)),
    style: {
      ...layer.style,
      cornerRadius: Math.max(
        0,
        value("shape.cornerRadius", layer.style.cornerRadius ?? 0),
      ),
      fill: {
        ...layer.style.fill,
        opacity: fillOpacity,
        ...(gradient ? { gradient } : {}),
      },
      stroke: {
        ...layer.style.stroke,
        width: Math.max(
          0,
          value("shape.stroke.width", layer.style.stroke.width),
        ),
        opacity: strokeOpacity,
        dashOffset: value(
          "shape.stroke.dashOffset",
          layer.style.stroke.dashOffset ?? 0,
        ),
      },
    },
  };
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function round(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
