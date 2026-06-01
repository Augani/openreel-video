export interface MaskPoint {
  x: number;
  y: number;
}

export interface BezierPoint extends MaskPoint {
  handleIn?: MaskPoint;
  handleOut?: MaskPoint;
}

export interface BezierPath {
  points: BezierPoint[];
  closed: boolean;
}

export type MaskShapeType = "rectangle" | "ellipse" | "polygon" | "bezier";

export interface RectangleMaskShape {
  type: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius?: number;
}

export interface EllipseMaskShape {
  type: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface PolygonMaskShape {
  type: "polygon";
  points: MaskPoint[];
}

export type MaskShape =
  | RectangleMaskShape
  | EllipseMaskShape
  | PolygonMaskShape;

export interface MaskKeyframe {
  id: string;
  time: number;
  path: BezierPath;
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

export interface Mask {
  id: string;
  clipId: string;
  type: "shape" | "drawn" | "track-matte";
  path: BezierPath;
  feathering: number;
  inverted: boolean;
  expansion: number;
  opacity: number;
  keyframes: MaskKeyframe[];
  /**
   * For "track-matte" masks, the id of the source clip whose
   * rendered alpha (or bounding box, for layers without alpha) is
   * used to drive the mask shape. Equivalent to Premiere's Track
   * Matte Key — the source acts as the matte, this clip is the fill.
   */
  sourceClipId?: string;
  /**
   * Which channel of the source clip drives the matte:
   *   - "alpha"     : use the source's alpha channel directly
   *   - "luminance" : use the source's brightness (white = visible)
   *   - "bounds"    : use the source's bounding box (no per-pixel
   *                   sampling required — works for any clip type and
   *                   animates via the source's keyframes)
   * Default is "bounds" since it requires no GPU plumbing.
   */
  matteSource?: "alpha" | "luminance" | "bounds";
}

export interface MaskDefinition {
  id: string;
  type: MaskShapeType;
  points: MaskPoint[];
  bezierPoints?: BezierPoint[];
  feather: number;
  inverted: boolean;
  expansion: number;
  opacity: number;
}

export interface MaskResult {
  image: ImageBitmap;
  processingTime: number;
  gpuAccelerated: boolean;
}

export interface MaskEngineConfig {
  width: number;
  height: number;
  useGPU?: boolean;
}

function generateId(): string {
  return `mask-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function shapeToPath(shape: MaskShape): BezierPath {
  switch (shape.type) {
    case "rectangle": {
      const { x, y, width, height } = shape;
      return {
        points: [
          { x, y },
          { x: x + width, y },
          { x: x + width, y: y + height },
          { x, y: y + height },
        ],
        closed: true,
      };
    }
    case "ellipse": {
      const { cx, cy, rx, ry } = shape;
      // Approximate ellipse with bezier curves (4 points)
      const k = 0.5522847498; // Magic number for bezier circle approximation
      return {
        points: [
          {
            x: cx,
            y: cy - ry,
            handleIn: { x: cx - rx * k, y: cy - ry },
            handleOut: { x: cx + rx * k, y: cy - ry },
          },
          {
            x: cx + rx,
            y: cy,
            handleIn: { x: cx + rx, y: cy - ry * k },
            handleOut: { x: cx + rx, y: cy + ry * k },
          },
          {
            x: cx,
            y: cy + ry,
            handleIn: { x: cx + rx * k, y: cy + ry },
            handleOut: { x: cx - rx * k, y: cy + ry },
          },
          {
            x: cx - rx,
            y: cy,
            handleIn: { x: cx - rx, y: cy + ry * k },
            handleOut: { x: cx - rx, y: cy - ry * k },
          },
        ],
        closed: true,
      };
    }
    case "polygon": {
      return {
        points: shape.points.map((p) => ({ x: p.x, y: p.y })),
        closed: true,
      };
    }
  }
}

export function createDefaultMask(
  type: MaskShapeType,
  id: string = generateId(),
): MaskDefinition {
  const basePoints: Record<MaskShapeType, MaskPoint[]> = {
    rectangle: [
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.75 },
      { x: 0.25, y: 0.75 },
    ],
    ellipse: [
      { x: 0.5, y: 0.5 }, // center
      { x: 0.25, y: 0.25 }, // radius as width/height from center
    ],
    polygon: [
      { x: 0.5, y: 0.2 },
      { x: 0.8, y: 0.5 },
      { x: 0.5, y: 0.8 },
      { x: 0.2, y: 0.5 },
    ],
    bezier: [
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.75 },
      { x: 0.25, y: 0.75 },
    ],
  };

  return {
    id,
    type,
    points: basePoints[type],
    feather: 0,
    inverted: false,
    expansion: 0,
    opacity: 1,
  };
}

export function createDefaultPath(): BezierPath {
  return {
    points: [
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.75 },
      { x: 0.25, y: 0.75 },
    ],
    closed: true,
  };
}

/**
 * Derive a rectangular BezierPath that fits the bounding box of a
 * clip with the given normalized transform (position is the clip's
 * center in 0..1 space, scale is relative to a 1x1 frame).
 *
 * Used by the track-matte rendering path: the source clip's bounds
 * become the mask shape, so the mask animates as the source clip
 * moves / scales / has its keyframes interpolated.
 *
 * Width/Height are the source clip's natural aspect inside the canvas;
 * we approximate them with the scale factors. For a more accurate
 * track matte the caller can use the source clip's actual rendered
 * extent.
 */
export function boundsPathFromTransform(transform: {
  position: { x: number; y: number };
  scale: { x: number; y: number };
}): BezierPath {
  // The clip occupies a normalized 0..1 box. A scale of 1,1 means it
  // covers the full frame; smaller scales make the box smaller.
  // Position is the box's center.
  const halfW = 0.5 * Math.max(0.01, Math.abs(transform.scale.x));
  const halfH = 0.5 * Math.max(0.01, Math.abs(transform.scale.y));
  const cx = transform.position.x;
  const cy = transform.position.y;
  return {
    points: [
      { x: cx - halfW, y: cy - halfH },
      { x: cx + halfW, y: cy - halfH },
      { x: cx + halfW, y: cy + halfH },
      { x: cx - halfW, y: cy + halfH },
    ],
    closed: true,
  };
}

export function interpolatePaths(
  pathA: BezierPath,
  pathB: BezierPath,
  t: number,
): BezierPath {
  t = Math.max(0, Math.min(1, t));
  const maxPoints = Math.max(pathA.points.length, pathB.points.length);
  const interpolatedPoints: BezierPoint[] = [];

  for (let i = 0; i < maxPoints; i++) {
    const pointA = pathA.points[i % pathA.points.length];
    const pointB = pathB.points[i % pathB.points.length];

    const interpolatedPoint: BezierPoint = {
      x: pointA.x + (pointB.x - pointA.x) * t,
      y: pointA.y + (pointB.y - pointA.y) * t,
    };
    if (pointA.handleIn || pointB.handleIn) {
      const handleInA = pointA.handleIn || { x: pointA.x, y: pointA.y };
      const handleInB = pointB.handleIn || { x: pointB.x, y: pointB.y };
      interpolatedPoint.handleIn = {
        x: handleInA.x + (handleInB.x - handleInA.x) * t,
        y: handleInA.y + (handleInB.y - handleInA.y) * t,
      };
    }

    if (pointA.handleOut || pointB.handleOut) {
      const handleOutA = pointA.handleOut || { x: pointA.x, y: pointA.y };
      const handleOutB = pointB.handleOut || { x: pointB.x, y: pointB.y };
      interpolatedPoint.handleOut = {
        x: handleOutA.x + (handleOutB.x - handleOutA.x) * t,
        y: handleOutA.y + (handleOutB.y - handleOutA.y) * t,
      };
    }

    interpolatedPoints.push(interpolatedPoint);
  }

  return {
    points: interpolatedPoints,
    closed: pathA.closed || pathB.closed,
  };
}

export function applyEasing(
  t: number,
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out",
): number {
  switch (easing) {
    case "linear":
      return t;
    case "ease-in":
      return t * t;
    case "ease-out":
      return 1 - (1 - t) * (1 - t);
    case "ease-in-out":
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    default:
      return t;
  }
}

export function pointsToDrawnPath(
  points: MaskPoint[],
  smoothing: number = 0.3,
  closed: boolean = true,
): BezierPath {
  if (points.length < 2) {
    return { points: [], closed };
  }

  // Simplify points if there are too many (reduce noise from drawing)
  const simplifiedPoints = simplifyPoints(points, 0.005);
  const bezierPoints: BezierPoint[] = simplifiedPoints.map((point, i) => {
    const prev =
      simplifiedPoints[
        (i - 1 + simplifiedPoints.length) % simplifiedPoints.length
      ];
    const next = simplifiedPoints[(i + 1) % simplifiedPoints.length];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len === 0) {
      return { x: point.x, y: point.y };
    }

    // Normalize and scale by smoothing factor
    const scale = smoothing * len * 0.5;
    const tx = (dx / len) * scale;
    const ty = (dy / len) * scale;

    return {
      x: point.x,
      y: point.y,
      handleIn: { x: point.x - tx, y: point.y - ty },
      handleOut: { x: point.x + tx, y: point.y + ty },
    };
  });

  return {
    points: bezierPoints,
    closed,
  };
}

function simplifyPoints(points: MaskPoint[], tolerance: number): MaskPoint[] {
  if (points.length <= 2) {
    return points;
  }

  const result: MaskPoint[] = [points[0]];
  let lastPoint = points[0];

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    const dx = point.x - lastPoint.x;
    const dy = point.y - lastPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist >= tolerance) {
      result.push(point);
      lastPoint = point;
    }
  }

  // Always include the last point
  if (result[result.length - 1] !== points[points.length - 1]) {
    result.push(points[points.length - 1]);
  }

  return result;
}

export class MaskEngine {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private maskCanvas: OffscreenCanvas;
  private maskCtx: OffscreenCanvasRenderingContext2D;
  private width: number;
  private height: number;
  private masks: Map<string, Mask> = new Map();

  constructor(config: MaskEngineConfig) {
    this.width = config.width;
    this.height = config.height;

    this.canvas = new OffscreenCanvas(config.width, config.height);
    this.ctx = this.canvas.getContext("2d")!;

    this.maskCanvas = new OffscreenCanvas(config.width, config.height);
    this.maskCtx = this.maskCanvas.getContext("2d")!;
  }

  // Match the working canvases to the incoming frame so the source is masked at
  // its native resolution/aspect (the drawImage(...,this.width,this.height)
  // calls become 1:1) instead of being stretched to the fixed engine size. The
  // normalized 0..1 mask path then scales to the frame and stays aligned.
  private resizeTo(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.maskCanvas.width = width;
    this.maskCanvas.height = height;
  }

  createShapeMask(clipId: string, shape: MaskShape): Mask {
    const path = shapeToPath(shape);
    const mask: Mask = {
      id: generateId(),
      clipId,
      type: "shape",
      path,
      feathering: 0,
      inverted: false,
      expansion: 0,
      opacity: 1,
      keyframes: [],
    };

    this.masks.set(mask.id, mask);
    return mask;
  }

  createDrawnMask(clipId: string, path: BezierPath): Mask {
    const mask: Mask = {
      id: generateId(),
      clipId,
      type: "drawn",
      path,
      feathering: 0,
      inverted: false,
      expansion: 0,
      opacity: 1,
      keyframes: [],
    };

    this.masks.set(mask.id, mask);
    return mask;
  }

  /**
   * Create a track-matte mask that derives its shape from another
   * clip on the timeline (Premiere "Track Matte Key" equivalent).
   * The mask path starts as a full-frame rectangle; the renderer is
   * responsible for replacing it at compositing time with the
   * source clip's actual alpha / luminance / bounds (per matteSource).
   */
  createTrackMatteMask(
    clipId: string,
    sourceClipId: string,
    matteSource: "alpha" | "luminance" | "bounds" = "bounds",
  ): Mask {
    const mask: Mask = {
      id: generateId(),
      clipId,
      type: "track-matte",
      path: createDefaultPath(),
      feathering: 0,
      inverted: false,
      expansion: 0,
      opacity: 1,
      keyframes: [],
      sourceClipId,
      matteSource,
    };

    this.masks.set(mask.id, mask);
    return mask;
  }

  /** Update the source clip a track-matte mask is bound to. */
  setMatteSource(
    maskId: string,
    sourceClipId: string,
    matteSource?: "alpha" | "luminance" | "bounds",
  ): void {
    const mask = this.masks.get(maskId);
    if (mask) {
      this.masks.set(maskId, {
        ...mask,
        sourceClipId,
        matteSource: matteSource ?? mask.matteSource,
      });
    }
  }

  getMask(maskId: string): Mask | undefined {
    return this.masks.get(maskId);
  }

  getMasksForClip(clipId: string): Mask[] {
    return Array.from(this.masks.values()).filter((m) => m.clipId === clipId);
  }

  updateMaskPath(maskId: string, path: BezierPath): void {
    const mask = this.masks.get(maskId);
    if (mask) {
      this.masks.set(maskId, { ...mask, path });
    }
  }

  setFeathering(maskId: string, amount: number): void {
    const mask = this.masks.get(maskId);
    if (mask) {
      this.masks.set(maskId, {
        ...mask,
        feathering: Math.max(0, Math.min(100, amount)),
      });
    }
  }

  setInverted(maskId: string, inverted: boolean): void {
    const mask = this.masks.get(maskId);
    if (mask) {
      this.masks.set(maskId, { ...mask, inverted });
    }
  }

  setExpansion(maskId: string, pixels: number): void {
    const mask = this.masks.get(maskId);
    if (mask) {
      this.masks.set(maskId, {
        ...mask,
        expansion: Math.max(-100, Math.min(100, pixels)),
      });
    }
  }

  addMaskKeyframe(
    maskId: string,
    time: number,
    path: BezierPath,
  ): MaskKeyframe | null {
    const mask = this.masks.get(maskId);
    if (!mask) return null;

    const keyframe: MaskKeyframe = {
      id: generateId(),
      time,
      path,
      easing: "linear",
    };
    const keyframes = [...mask.keyframes, keyframe].sort(
      (a, b) => a.time - b.time,
    );
    this.masks.set(maskId, { ...mask, keyframes });

    return keyframe;
  }

  removeMaskKeyframe(maskId: string, keyframeId: string): void {
    const mask = this.masks.get(maskId);
    if (mask) {
      const keyframes = mask.keyframes.filter((k) => k.id !== keyframeId);
      this.masks.set(maskId, { ...mask, keyframes });
    }
  }

  setKeyframeEasing(
    maskId: string,
    keyframeId: string,
    easing: "linear" | "ease-in" | "ease-out" | "ease-in-out",
  ): void {
    const mask = this.masks.get(maskId);
    if (mask) {
      const keyframes = mask.keyframes.map((k) =>
        k.id === keyframeId ? { ...k, easing } : k,
      );
      this.masks.set(maskId, { ...mask, keyframes });
    }
  }

  getMaskAtTime(maskId: string, time: number): BezierPath | null {
    const mask = this.masks.get(maskId);
    if (!mask) return null;
    if (mask.keyframes.length === 0) {
      return mask.path;
    }
    if (mask.keyframes.length === 1) {
      return mask.keyframes[0].path;
    }
    let prevKeyframe: MaskKeyframe | null = null;
    let nextKeyframe: MaskKeyframe | null = null;

    for (const keyframe of mask.keyframes) {
      if (keyframe.time <= time) {
        prevKeyframe = keyframe;
      } else if (!nextKeyframe) {
        nextKeyframe = keyframe;
        break;
      }
    }
    if (!prevKeyframe) {
      return mask.keyframes[0].path;
    }
    if (!nextKeyframe) {
      return prevKeyframe.path;
    }
    const duration = nextKeyframe.time - prevKeyframe.time;
    const elapsed = time - prevKeyframe.time;
    const t = duration > 0 ? elapsed / duration : 0;
    const easedT = applyEasing(t, prevKeyframe.easing);

    return interpolatePaths(prevKeyframe.path, nextKeyframe.path, easedT);
  }

  deleteMask(maskId: string): void {
    this.masks.delete(maskId);
  }

  deleteMasksForClip(clipId: string): void {
    for (const [id, mask] of this.masks) {
      if (mask.clipId === clipId) {
        this.masks.delete(id);
      }
    }
  }

  async applyMask(
    image: ImageBitmap,
    mask: Mask,
    time?: number,
  ): Promise<MaskResult> {
    const startTime = performance.now();
    this.resizeTo(image.width, image.height);
    const path =
      time !== undefined
        ? this.getMaskAtTime(mask.id, time) || mask.path
        : mask.path;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.maskCtx.clearRect(0, 0, this.width, this.height);
    this.generateMaskFromPath(path, mask.inverted);
    if (mask.feathering > 0) {
      this.applyFeathering(mask.feathering);
    }
    if (mask.expansion !== 0) {
      this.applyExpansion(mask.expansion);
    }

    // Draw source image
    this.ctx.drawImage(image, 0, 0, this.width, this.height);
    this.ctx.globalCompositeOperation = "destination-in";
    this.ctx.drawImage(this.maskCanvas, 0, 0);
    this.ctx.globalCompositeOperation = "source-over";
    if (mask.opacity < 1) {
      const tempCanvas = new OffscreenCanvas(this.width, this.height);
      const tempCtx = tempCanvas.getContext("2d")!;
      tempCtx.globalAlpha = mask.opacity;
      tempCtx.drawImage(this.canvas, 0, 0);
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.ctx.drawImage(tempCanvas, 0, 0);
    }

    const result = await createImageBitmap(this.canvas);

    return {
      image: result,
      processingTime: performance.now() - startTime,
      gpuAccelerated: false,
    };
  }

  async applyMaskDefinition(
    image: ImageBitmap,
    mask: MaskDefinition,
  ): Promise<MaskResult> {
    const startTime = performance.now();
    this.resizeTo(image.width, image.height);
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.maskCtx.clearRect(0, 0, this.width, this.height);
    this.generateMaskShape(mask);
    if (mask.feather > 0) {
      this.applyFeathering(mask.feather);
    }
    if (mask.expansion !== 0) {
      this.applyExpansion(mask.expansion);
    }

    // Draw source image
    this.ctx.drawImage(image, 0, 0, this.width, this.height);
    this.ctx.globalCompositeOperation = "destination-in";
    this.ctx.drawImage(this.maskCanvas, 0, 0);
    this.ctx.globalCompositeOperation = "source-over";
    if (mask.opacity < 1) {
      this.ctx.globalAlpha = mask.opacity;
      this.ctx.drawImage(this.canvas, 0, 0);
      this.ctx.globalAlpha = 1;
    }

    const result = await createImageBitmap(this.canvas);

    return {
      image: result,
      processingTime: performance.now() - startTime,
      gpuAccelerated: false,
    };
  }

  private generateMaskFromPath(path: BezierPath, inverted: boolean): void {
    const ctx = this.maskCtx;

    // Fill with white for inverted masks, black otherwise
    if (inverted) {
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.fillStyle = "black";
    } else {
      ctx.fillStyle = "white";
    }

    ctx.beginPath();
    this.drawBezierPath(ctx, path);
    ctx.closePath();
    ctx.fill();
  }

  private drawBezierPath(
    ctx: OffscreenCanvasRenderingContext2D,
    path: BezierPath,
  ): void {
    if (path.points.length < 2) return;

    const points = path.points;
    ctx.moveTo(points[0].x * this.width, points[0].y * this.height);

    for (let i = 0; i < points.length; i++) {
      const current = points[i];
      const next = points[(i + 1) % points.length];

      // Skip the last segment if path is not closed
      if (!path.closed && i === points.length - 1) break;
      const cp1: MaskPoint = current.handleOut || {
        x: current.x + (next.x - current.x) * 0.3,
        y: current.y + (next.y - current.y) * 0.3,
      };
      const cp2: MaskPoint = next.handleIn || {
        x: next.x - (next.x - current.x) * 0.3,
        y: next.y - (next.y - current.y) * 0.3,
      };

      ctx.bezierCurveTo(
        cp1.x * this.width,
        cp1.y * this.height,
        cp2.x * this.width,
        cp2.y * this.height,
        next.x * this.width,
        next.y * this.height,
      );
    }
  }

  private generateMaskShape(mask: MaskDefinition): void {
    const ctx = this.maskCtx;

    // Fill with white for inverted masks, black otherwise
    if (mask.inverted) {
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.fillStyle = "black";
    } else {
      ctx.fillStyle = "white";
    }

    ctx.beginPath();

    switch (mask.type) {
      case "rectangle":
        this.drawRectangleMask(ctx, mask.points);
        break;
      case "ellipse":
        this.drawEllipseMask(ctx, mask.points);
        break;
      case "polygon":
        this.drawPolygonMask(ctx, mask.points);
        break;
      case "bezier":
        this.drawBezierMask(ctx, mask.points, mask.bezierPoints);
        break;
    }

    ctx.closePath();
    ctx.fill();
  }

  private drawRectangleMask(
    ctx: OffscreenCanvasRenderingContext2D,
    points: MaskPoint[],
  ): void {
    if (points.length < 2) return;

    const x1 = Math.min(
      points[0].x,
      points.length > 1 ? points[1].x : points[0].x,
    );
    const y1 = Math.min(
      points[0].y,
      points.length > 1 ? points[1].y : points[0].y,
    );
    const x2 = Math.max(
      points.length > 2 ? points[2].x : points[1].x,
      points.length > 1 ? points[1].x : points[0].x,
    );
    const y2 = Math.max(
      points.length > 2 ? points[2].y : points[1].y,
      points.length > 3
        ? points[3].y
        : points.length > 1
          ? points[1].y
          : points[0].y,
    );

    const px1 = x1 * this.width;
    const py1 = y1 * this.height;
    const px2 = x2 * this.width;
    const py2 = y2 * this.height;

    ctx.rect(px1, py1, px2 - px1, py2 - py1);
  }

  private drawEllipseMask(
    ctx: OffscreenCanvasRenderingContext2D,
    points: MaskPoint[],
  ): void {
    if (points.length < 2) return;

    const centerX = points[0].x * this.width;
    const centerY = points[0].y * this.height;
    const radiusX = Math.abs(points[1].x - points[0].x) * this.width;
    const radiusY = Math.abs(points[1].y - points[0].y) * this.height;

    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
  }

  private drawPolygonMask(
    ctx: OffscreenCanvasRenderingContext2D,
    points: MaskPoint[],
  ): void {
    if (points.length < 3) return;

    ctx.moveTo(points[0].x * this.width, points[0].y * this.height);

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * this.width, points[i].y * this.height);
    }
  }

  private drawBezierMask(
    ctx: OffscreenCanvasRenderingContext2D,
    points: MaskPoint[],
    bezierPoints?: BezierPoint[],
  ): void {
    if (points.length < 2) return;

    const bp: BezierPoint[] =
      bezierPoints || points.map((p) => ({ x: p.x, y: p.y }));

    ctx.moveTo(bp[0].x * this.width, bp[0].y * this.height);

    for (let i = 0; i < bp.length; i++) {
      const current = bp[i];
      const next = bp[(i + 1) % bp.length];

      const cp1: MaskPoint = current.handleOut || {
        x: current.x + (next.x - current.x) * 0.3,
        y: current.y + (next.y - current.y) * 0.3,
      };
      const cp2: MaskPoint = next.handleIn || {
        x: next.x - (next.x - current.x) * 0.3,
        y: next.y - (next.y - current.y) * 0.3,
      };

      ctx.bezierCurveTo(
        cp1.x * this.width,
        cp1.y * this.height,
        cp2.x * this.width,
        cp2.y * this.height,
        next.x * this.width,
        next.y * this.height,
      );
    }
  }

  private applyFeathering(feather: number): void {
    const tempCanvas = new OffscreenCanvas(this.width, this.height);
    const tempCtx = tempCanvas.getContext("2d")!;

    tempCtx.filter = `blur(${feather}px)`;
    tempCtx.drawImage(this.maskCanvas, 0, 0);

    this.maskCtx.clearRect(0, 0, this.width, this.height);
    this.maskCtx.drawImage(tempCanvas, 0, 0);
  }

  private applyExpansion(expansion: number): void {
    if (expansion === 0) return;

    const imageData = this.maskCtx.getImageData(0, 0, this.width, this.height);
    const data = imageData.data;
    const result = new Uint8ClampedArray(data.length);
    result.set(data);

    const radius = Math.abs(expansion);
    const expand = expansion > 0;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = (y * this.width + x) * 4;
        let found = false;

        for (let dy = -radius; dy <= radius && !found; dy++) {
          for (let dx = -radius; dx <= radius && !found; dx++) {
            const nx = x + dx;
            const ny = y + dy;

            if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
              const nidx = (ny * this.width + nx) * 4;
              const dist = Math.sqrt(dx * dx + dy * dy);

              if (dist <= radius) {
                if (expand && data[nidx + 3] > 128) {
                  found = true;
                } else if (!expand && data[nidx + 3] < 128) {
                  found = true;
                }
              }
            }
          }
        }

        if (expand && found) {
          result[idx + 3] = 255;
        } else if (!expand && found) {
          result[idx + 3] = 0;
        }
      }
    }

    const resultData = new ImageData(result, this.width, this.height);
    this.maskCtx.putImageData(resultData, 0, 0);
  }

  invertMask(mask: MaskDefinition): MaskDefinition {
    return {
      ...mask,
      inverted: !mask.inverted,
    };
  }

  setFeather(mask: MaskDefinition, feather: number): MaskDefinition {
    return {
      ...mask,
      feather: Math.max(0, Math.min(100, feather)),
    };
  }

  updatePoints(mask: MaskDefinition, points: MaskPoint[]): MaskDefinition {
    return {
      ...mask,
      points,
    };
  }

  addPoint(
    mask: MaskDefinition,
    point: MaskPoint,
    index?: number,
  ): MaskDefinition {
    const newPoints = [...mask.points];
    if (index !== undefined && index >= 0 && index <= newPoints.length) {
      newPoints.splice(index, 0, point);
    } else {
      newPoints.push(point);
    }
    return {
      ...mask,
      points: newPoints,
    };
  }

  removePoint(mask: MaskDefinition, index: number): MaskDefinition {
    if (mask.points.length <= 3) {
      return mask;
    }
    const newPoints = [...mask.points];
    newPoints.splice(index, 1);
    return {
      ...mask,
      points: newPoints,
    };
  }

  isPointInMask(mask: MaskDefinition, point: MaskPoint): boolean {
    this.maskCtx.clearRect(0, 0, this.width, this.height);
    this.generateMaskShape({ ...mask, inverted: false });

    const px = Math.floor(point.x * this.width);
    const py = Math.floor(point.y * this.height);

    const imageData = this.maskCtx.getImageData(px, py, 1, 1);
    const isInside = imageData.data[3] > 128;

    return mask.inverted ? !isInside : isInside;
  }

  getMaskBounds(mask: MaskDefinition): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    if (mask.type === "ellipse" && mask.points.length >= 2) {
      const centerX = mask.points[0].x;
      const centerY = mask.points[0].y;
      const radiusX = Math.abs(mask.points[1].x - mask.points[0].x);
      const radiusY = Math.abs(mask.points[1].y - mask.points[0].y);

      return {
        x: centerX - radiusX,
        y: centerY - radiusY,
        width: radiusX * 2,
        height: radiusY * 2,
      };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const point of mask.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.maskCanvas.width = width;
    this.maskCanvas.height = height;
  }

  getDimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  clearAllMasks(): void {
    this.masks.clear();
  }
}
