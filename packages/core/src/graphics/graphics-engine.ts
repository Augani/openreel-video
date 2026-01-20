import type {
  GraphicClip,
  ShapeClip,
  SVGClip,
  StickerClip,
  ShapeStyle,
  FillStyle,
  StrokeStyle,
  GradientStyle,
  Point2D,
  ViewBox,
  ArrowProperties,
  CreateShapeParams,
  SVGImportResult,
  GraphicRenderResult,
  SVGColorStyle,
  GraphicAnimation,
  GraphicAnimationType,
  EmphasisAnimation,
} from "./types";
import { DEFAULT_SHAPE_STYLE, DEFAULT_GRAPHIC_TRANSFORM } from "./types";
import type { Transform, Keyframe } from "../types/timeline";
import { AnimationEngine } from "../video/animation-engine";

interface AnimatedGraphicState {
  transform: Transform;
  opacity: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  blur: number;
  scaleX?: number;
  scaleY?: number;
}

/**
 * GraphicsEngine manages creation and rendering of graphic elements in video.
 * Handles shapes, SVG imports, stickers, animations, and styling.
 *
 * Usage:
 * ```ts
 * const engine = new GraphicsEngine();
 * const rect = engine.createRectangle(trackId, 0, 2, 100, 50);
 * const styled = engine.updateFill(rect, { color: '#FF0000' });
 * const rendered = await engine.renderGraphic(styled, 1.5, 1920, 1080);
 * ```
 */
export class GraphicsEngine {
  private animationEngine: AnimationEngine;
  private svgCache: Map<string, SVGElement> = new Map();
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private shapeClips: Map<string, ShapeClip> = new Map();
  private svgClips: Map<string, SVGClip> = new Map();
  private stickerClips: Map<string, StickerClip> = new Map();

  /**
   * Creates a new GraphicsEngine instance.
   *
   * @param animationEngine - Optional AnimationEngine for handling animations. If not provided, a new one is created.
   */
  constructor(animationEngine?: AnimationEngine) {
    this.animationEngine = animationEngine || new AnimationEngine();
  }

  /**
   * Creates a shape graphic with specified parameters.
   *
   * @param params - Shape parameters including type, dimensions, and styling
   * @param trackId - ID of the track to add the shape to
   * @param startTime - Start time in seconds
   * @param duration - Duration in seconds
   * @returns The created ShapeClip
   */
  createShape(
    params: CreateShapeParams,
    trackId: string,
    startTime: number,
    duration: number,
  ): ShapeClip {
    const id = this.generateId();
    const style: ShapeStyle = {
      ...DEFAULT_SHAPE_STYLE,
      ...params.style,
      fill: { ...DEFAULT_SHAPE_STYLE.fill, ...params.style?.fill },
      stroke: { ...DEFAULT_SHAPE_STYLE.stroke, ...params.style?.stroke },
    };

    const shapeClip: ShapeClip = {
      id,
      trackId,
      startTime,
      duration,
      type: "shape",
      shapeType: params.shapeType,
      style,
      transform: { ...DEFAULT_GRAPHIC_TRANSFORM },
      keyframes: [],
      points: params.points,
    };

    this.shapeClips.set(id, shapeClip);

    return shapeClip;
  }

  /**
   * Creates a rectangle shape.
   *
   * @param trackId - ID of the track to add the rectangle to
   * @param startTime - Start time in seconds
   * @param duration - Duration in seconds
   * @param width - Width in pixels
   * @param height - Height in pixels
   * @param style - Optional styling overrides
   * @returns The created ShapeClip
   */
  createRectangle(
    trackId: string,
    startTime: number,
    duration: number,
    width: number,
    height: number,
    style?: Partial<ShapeStyle>,
  ): ShapeClip {
    return this.createShape(
      { shapeType: "rectangle", width, height, style },
      trackId,
      startTime,
      duration,
    );
  }

  /**
   * Creates a circle shape.
   *
   * @param trackId - ID of the track to add the circle to
   * @param startTime - Start time in seconds
   * @param duration - Duration in seconds
   * @param radius - Radius in pixels
   * @param style - Optional styling overrides
   * @returns The created ShapeClip
   */
  createCircle(
    trackId: string,
    startTime: number,
    duration: number,
    radius: number,
    style?: Partial<ShapeStyle>,
  ): ShapeClip {
    return this.createShape(
      { shapeType: "circle", width: radius * 2, height: radius * 2, style },
      trackId,
      startTime,
      duration,
    );
  }

  /**
   * Creates an arrow shape with customizable properties.
   *
   * @param trackId - ID of the track to add the arrow to
   * @param startTime - Start time in seconds
   * @param duration - Duration in seconds
   * @param width - Width in pixels
   * @param height - Height in pixels
   * @param arrowProps - Optional arrow-specific properties (head/tail dimensions, curvature)
   * @param style - Optional styling overrides
   * @returns The created ShapeClip
   */
  createArrow(
    trackId: string,
    startTime: number,
    duration: number,
    width: number,
    height: number,
    arrowProps?: Partial<ArrowProperties>,
    style?: Partial<ShapeStyle>,
  ): ShapeClip {
    const defaultArrowProps: ArrowProperties = {
      headWidth: height * 0.6,
      headLength: width * 0.3,
      tailWidth: height * 0.3,
      curved: false,
      doubleHeaded: false,
    };

    return this.createShape(
      {
        shapeType: "arrow",
        width,
        height,
        style,
        arrowProps: { ...defaultArrowProps, ...arrowProps },
      },
      trackId,
      startTime,
      duration,
    );
  }

  /**
   * Updates the styling of a shape clip.
   *
   * @param shape - The shape to update
   * @param updates - Partial styling updates (fill, stroke, shadows, etc.)
   * @returns The updated ShapeClip
   */
  updateShapeStyle(shape: ShapeClip, updates: Partial<ShapeStyle>): ShapeClip {
    const updatedClip: ShapeClip = {
      ...shape,
      style: {
        ...shape.style,
        ...updates,
        fill: updates.fill
          ? { ...shape.style.fill, ...updates.fill }
          : shape.style.fill,
        stroke: updates.stroke
          ? { ...shape.style.stroke, ...updates.stroke }
          : shape.style.stroke,
      },
    };

    this.shapeClips.set(updatedClip.id, updatedClip);

    return updatedClip;
  }

  /**
   * Updates the fill style of a shape.
   *
   * @param shape - The shape to update
   * @param fill - Fill style updates (color, opacity, gradient)
   * @returns The updated ShapeClip
   */
  updateFill(shape: ShapeClip, fill: Partial<FillStyle>): ShapeClip {
    return this.updateShapeStyle(shape, {
      fill: { ...shape.style.fill, ...fill },
    });
  }

  /**
   * Updates the stroke style of a shape.
   *
   * @param shape - The shape to update
   * @param stroke - Stroke style updates (color, width, dash pattern)
   * @returns The updated ShapeClip
   */
  updateStroke(shape: ShapeClip, stroke: Partial<StrokeStyle>): ShapeClip {
    return this.updateShapeStyle(shape, {
      stroke: { ...shape.style.stroke, ...stroke },
    });
  }

  /**
   * Updates a shape clip by ID with new properties.
   *
   * @param id - ID of the shape clip to update
   * @param updates - Properties to update (timing, transform, blending)
   * @returns The updated ShapeClip, or undefined if not found
   */
  updateShapeClip(
    id: string,
    updates: {
      startTime?: number;
      duration?: number;
      transform?: Partial<Transform>;
      blendMode?: import("../video/types").BlendMode;
      blendOpacity?: number;
      emphasisAnimation?: EmphasisAnimation;
    },
  ): ShapeClip | undefined {
    const existing = this.shapeClips.get(id);
    if (!existing) return undefined;

    const updatedClip: ShapeClip = {
      ...existing,
      startTime: updates.startTime ?? existing.startTime,
      duration: updates.duration ?? existing.duration,
      transform: updates.transform
        ? { ...existing.transform, ...updates.transform }
        : existing.transform,
      blendMode: updates.blendMode ?? existing.blendMode,
      blendOpacity: updates.blendOpacity ?? existing.blendOpacity,
      emphasisAnimation:
        updates.emphasisAnimation ?? existing.emphasisAnimation,
    };

    this.shapeClips.set(id, updatedClip);
    return updatedClip;
  }

  /**
   * Updates the transform of a graphic (position, scale, rotation, opacity).
   *
   * @param graphic - The graphic to transform
   * @param transform - Partial transform updates
   * @returns The graphic with updated transform
   */
  updateTransform(
    graphic: GraphicClip,
    transform: Partial<Transform>,
  ): GraphicClip {
    return {
      ...graphic,
      transform: { ...graphic.transform, ...transform },
    };
  }

  /**
   * Imports an SVG graphic into the timeline.
   *
   * @param svgContent - Raw SVG XML string
   * @param trackId - ID of the track to add the SVG to
   * @param startTime - Start time in seconds
   * @param duration - Duration in seconds
   * @returns The created SVGClip
   * @throws Error if SVG content is invalid
   */
  importSVG(
    svgContent: string,
    trackId: string,
    startTime: number,
    duration: number,
  ): SVGClip {
    const parsed = this.parseSVG(svgContent);
    const id = this.generateId();

    const svgClip: SVGClip = {
      id,
      trackId,
      startTime,
      duration,
      type: "svg",
      svgContent: parsed.svgContent,
      viewBox: parsed.viewBox,
      preserveAspectRatio: "xMidYMid",
      transform: { ...DEFAULT_GRAPHIC_TRANSFORM },
      keyframes: [],
      colorStyle: {
        colorMode: "none",
        tintColor: "#ffffff",
        tintOpacity: 1,
      },
      entryAnimation: {
        type: "none",
        duration: 0.5,
        easing: "ease-out",
      },
      exitAnimation: {
        type: "none",
        duration: 0.5,
        easing: "ease-in",
      },
    };

    this.svgClips.set(id, svgClip);

    return svgClip;
  }

  /**
   * Parses SVG content and extracts viewBox and dimensions.
   *
   * @param svgContent - Raw SVG XML string
   * @returns Parsed SVG information including viewBox and dimensions
   * @throws Error if SVG content is invalid
   */
  parseSVG(svgContent: string): SVGImportResult {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, "image/svg+xml");
    const svgElement = doc.querySelector("svg");

    if (!svgElement) {
      throw new Error("Invalid SVG content: no svg element found");
    }

    const viewBoxAttr = svgElement.getAttribute("viewBox");
    let viewBox: ViewBox = { minX: 0, minY: 0, width: 100, height: 100 };

    if (viewBoxAttr) {
      const parts = viewBoxAttr.split(/[\s,]+/).map(Number);
      if (parts.length === 4) {
        viewBox = {
          minX: parts[0],
          minY: parts[1],
          width: parts[2],
          height: parts[3],
        };
      }
    } else {
      const width = parseFloat(svgElement.getAttribute("width") || "100");
      const height = parseFloat(svgElement.getAttribute("height") || "100");
      viewBox = { minX: 0, minY: 0, width, height };
    }

    return {
      svgContent,
      viewBox,
      width: viewBox.width,
      height: viewBox.height,
    };
  }

  /**
   * Renders a graphic to a canvas at a specific time with animations applied.
   *
   * @param graphic - The graphic to render
   * @param time - Time in seconds to render at (for animations)
   * @param width - Canvas width in pixels
   * @param height - Canvas height in pixels
   * @returns Rendered canvas and dimensions
   */
  async renderGraphic(
    graphic: GraphicClip,
    time: number,
    width: number,
    height: number,
  ): Promise<GraphicRenderResult> {
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : document.createElement("canvas");

    if (canvas instanceof HTMLCanvasElement) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D;

    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }

    const animatedState = this.getAnimatedGraphicState(graphic, time);
    if (animatedState.opacity <= 0) {
      return { canvas, width, height };
    }

    this.applyTransform(ctx, animatedState.transform, width, height);

    switch (graphic.type) {
      case "shape":
        this.renderShape(ctx, graphic as ShapeClip, width, height);
        break;
      case "svg":
        await this.renderSVG(
          ctx,
          graphic as SVGClip,
          width,
          height,
          animatedState,
        );
        break;
      case "sticker":
      case "emoji":
        await this.renderSticker(ctx, graphic as StickerClip, width, height);
        break;
    }

    return { canvas, width, height };
  }

  private renderShape(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    shape: ShapeClip,
    width: number,
    height: number,
  ): void {
    const { style, shapeType } = shape;
    const baseSize = Math.min(width, height);
    const shapeSize = baseSize * 0.15;
    const halfSize = shapeSize / 2;

    ctx.save();

    if (style.shadow) {
      ctx.shadowColor = style.shadow.color;
      ctx.shadowBlur = style.shadow.blur;
      ctx.shadowOffsetX = style.shadow.offsetX;
      ctx.shadowOffsetY = style.shadow.offsetY;
    }

    ctx.beginPath();

    switch (shapeType) {
      case "rectangle":
        this.drawRectangle(ctx, 0, 0, shapeSize, shapeSize, style.cornerRadius);
        break;
      case "circle":
        this.drawCircle(ctx, 0, 0, halfSize);
        break;
      case "ellipse":
        this.drawEllipse(ctx, 0, 0, halfSize, halfSize);
        break;
      case "triangle":
        this.drawTriangle(ctx, 0, 0, shapeSize, shapeSize);
        break;
      case "arrow":
        this.drawArrow(ctx, 0, 0, shapeSize, shapeSize);
        break;
      case "line":
        this.drawLine(ctx, -halfSize, 0, halfSize, 0);
        break;
      case "star":
        this.drawStar(
          ctx,
          0,
          0,
          halfSize,
          style.points || 5,
          style.innerRadius || 0.5,
        );
        break;
      case "polygon":
        if (shape.points && shape.points.length > 0) {
          this.drawPolygonCentered(ctx, shape.points, shapeSize);
        }
        break;
    }

    if (style.fill.type !== "none") {
      ctx.globalAlpha = style.fill.opacity;
      if (style.fill.type === "gradient" && style.fill.gradient) {
        ctx.fillStyle = this.createGradient(
          ctx,
          style.fill.gradient,
          shapeSize,
          shapeSize,
        );
      } else {
        ctx.fillStyle = style.fill.color || "#000000";
      }
      ctx.fill();
    }

    if (style.stroke.width > 0) {
      ctx.globalAlpha = style.stroke.opacity;
      ctx.strokeStyle = style.stroke.color;
      ctx.lineWidth = style.stroke.width;
      ctx.lineCap = style.stroke.lineCap || "butt";
      ctx.lineJoin = style.stroke.lineJoin || "miter";
      if (style.stroke.dashArray) {
        ctx.setLineDash(style.stroke.dashArray);
        ctx.lineDashOffset = style.stroke.dashOffset || 0;
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Renders SVG with aspect ratio preservation (letterboxing).
   * Algorithm: Compare aspect ratios to determine orientation (portrait/landscape mismatch).
   * Scale to fit canvas while maintaining aspect ratio, then center.
   *
   * Note: SVG must be converted to image blob first due to canvas limitations with direct SVG rendering.
   * URL.createObjectURL is revoked in finally to prevent memory leaks.
   */
  private async renderSVG(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    svg: SVGClip,
    _width: number,
    _height: number,
    animatedState: AnimatedGraphicState,
  ): Promise<void> {
    const svgContent = svg.svgContent;

    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);

    try {
      const img = await this.loadImage(url);

      const svgWidth = svg.viewBox.width;
      const svgHeight = svg.viewBox.height;

      if (animatedState.blur > 0) {
        ctx.filter = `blur(${animatedState.blur}px)`;
      }

      if (
        svg.colorStyle &&
        svg.colorStyle.colorMode !== "none" &&
        (svg.colorStyle.colorMode === "tint" ||
          svg.colorStyle.colorMode === "replace")
      ) {
        const tempCanvas = new OffscreenCanvas(svgWidth, svgHeight);
        const tempCtx = tempCanvas.getContext("2d");
        if (tempCtx) {
          tempCtx.drawImage(img, 0, 0, svgWidth, svgHeight);
          tempCtx.globalCompositeOperation = "source-in";
          tempCtx.fillStyle = svg.colorStyle.tintColor || "#ffffff";
          tempCtx.globalAlpha = svg.colorStyle.tintOpacity ?? 1;
          tempCtx.fillRect(0, 0, svgWidth, svgHeight);
          ctx.drawImage(tempCanvas, -svgWidth / 2, -svgHeight / 2);
        } else {
          ctx.drawImage(img, -svgWidth / 2, -svgHeight / 2, svgWidth, svgHeight);
        }
      } else {
        ctx.drawImage(img, -svgWidth / 2, -svgHeight / 2, svgWidth, svgHeight);
      }

      ctx.filter = "none";
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private async renderSticker(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    sticker: StickerClip,
    _width: number,
    _height: number,
  ): Promise<void> {
    const img = await this.loadImage(sticker.imageUrl);

    const imgWidth = img.width;
    const imgHeight = img.height;

    const anchorX = sticker.transform.anchor?.x ?? 0.5;
    const anchorY = sticker.transform.anchor?.y ?? 0.5;

    ctx.drawImage(
      img,
      -imgWidth * anchorX,
      -imgHeight * anchorY,
      imgWidth,
      imgHeight,
    );
  }

  private drawRectangle(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    cx: number,
    cy: number,
    width: number,
    height: number,
    cornerRadius?: number,
  ): void {
    const x = cx - width / 2;
    const y = cy - height / 2;

    if (cornerRadius && cornerRadius > 0) {
      const r = Math.min(cornerRadius, width / 2, height / 2);
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + width - r, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + r);
      ctx.lineTo(x + width, y + height - r);
      ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
      ctx.lineTo(x + r, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
    } else {
      ctx.rect(x, y, width, height);
    }
  }

  private drawCircle(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
  ): void {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  }

  private drawEllipse(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    cx: number,
    cy: number,
    radiusX: number,
    radiusY: number,
  ): void {
    ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
  }

  private drawTriangle(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    cx: number,
    cy: number,
    width: number,
    height: number,
  ): void {
    ctx.moveTo(cx, cy - height / 2);
    ctx.lineTo(cx + width / 2, cy + height / 2);
    ctx.lineTo(cx - width / 2, cy + height / 2);
    ctx.closePath();
  }

  private drawArrow(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    cx: number,
    cy: number,
    width: number,
    height: number,
  ): void {
    const headWidth = height * 0.6;
    const headLength = width * 0.3;
    const tailWidth = height * 0.3;

    const left = cx - width / 2;
    const right = cx + width / 2;
    const headStart = right - headLength;

    ctx.moveTo(left, cy - tailWidth / 2);
    ctx.lineTo(headStart, cy - tailWidth / 2);
    ctx.lineTo(headStart, cy - headWidth / 2);
    ctx.lineTo(right, cy);
    ctx.lineTo(headStart, cy + headWidth / 2);
    ctx.lineTo(headStart, cy + tailWidth / 2);
    ctx.lineTo(left, cy + tailWidth / 2);
    ctx.closePath();
  }

  private drawLine(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }

  private drawStar(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    cx: number,
    cy: number,
    outerRadius: number,
    points: number,
    innerRadiusRatio: number,
  ): void {
    const innerRadius = outerRadius * innerRadiusRatio;
    const step = Math.PI / points;

    ctx.moveTo(cx, cy - outerRadius);

    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = -Math.PI / 2 + i * step;
      ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    }

    ctx.closePath();
  }

  private drawPolygonCentered(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    points: Point2D[],
    size: number,
  ): void {
    if (points.length < 2) return;

    const halfSize = size / 2;
    ctx.moveTo(points[0].x * size - halfSize, points[0].y * size - halfSize);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * size - halfSize, points[i].y * size - halfSize);
    }
    ctx.closePath();
  }

  private createGradient(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    gradient: GradientStyle,
    width: number,
    height: number,
  ): CanvasGradient {
    let canvasGradient: CanvasGradient;

    if (gradient.type === "linear") {
      const angle = ((gradient.angle || 0) * Math.PI) / 180;
      const x1 = width / 2 - (Math.cos(angle) * width) / 2;
      const y1 = height / 2 - (Math.sin(angle) * height) / 2;
      const x2 = width / 2 + (Math.cos(angle) * width) / 2;
      const y2 = height / 2 + (Math.sin(angle) * height) / 2;
      canvasGradient = ctx.createLinearGradient(x1, y1, x2, y2);
    } else {
      canvasGradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        0,
        width / 2,
        height / 2,
        Math.max(width, height) / 2,
      );
    }

    for (const stop of gradient.stops) {
      canvasGradient.addColorStop(stop.offset, stop.color);
    }

    return canvasGradient;
  }

  private getAnimatedGraphicState(
    graphic: GraphicClip,
    time: number,
  ): AnimatedGraphicState {
    let transform = { ...graphic.transform };
    let opacity = transform.opacity;
    let scale = 1;
    let scaleX = 1;
    let scaleY = 1;
    let offsetX = 0;
    let offsetY = 0;
    let rotation = 0;
    let blur = 0;

    if (graphic.keyframes.length > 0) {
      transform = this.getAnimatedTransform(graphic, time);
      opacity = transform.opacity;
    }

    let isInEntryPhase = false;
    let isInExitPhase = false;

    if (graphic.type === "svg") {
      const svg = graphic as SVGClip;
      const entryAnim = svg.entryAnimation;
      const exitAnim = svg.exitAnimation;

      if (entryAnim || exitAnim) {
        const entryDuration = entryAnim?.duration || 0;
        const exitDuration = exitAnim?.duration || 0;
        const duration = graphic.duration;
        const exitStartTime = duration - exitDuration;

        if (entryAnim && time < entryDuration) {
          isInEntryPhase = true;
          const inProgress = entryDuration > 0 ? time / entryDuration : 1;
          const animState = this.applyGraphicAnimation(
            entryAnim.type,
            inProgress,
            entryAnim.easing,
            true,
          );
          scale *= animState.scale;
          offsetX += animState.offsetX;
          offsetY += animState.offsetY;
          rotation += animState.rotation;
          opacity *= animState.opacity;
          blur = animState.blur;
        }

        if (exitAnim && time >= exitStartTime) {
          isInExitPhase = true;
          const outProgress =
            exitDuration > 0 ? (time - exitStartTime) / exitDuration : 1;
          const animState = this.applyGraphicAnimation(
            exitAnim.type,
            outProgress,
            exitAnim.easing,
            false,
          );
          scale *= animState.scale;
          offsetX += animState.offsetX;
          offsetY += animState.offsetY;
          rotation += animState.rotation;
          opacity *= animState.opacity;
          blur = Math.max(blur, animState.blur);
        }
      }
    }

    if (
      graphic.emphasisAnimation &&
      graphic.emphasisAnimation.type !== "none" &&
      !isInEntryPhase &&
      !isInExitPhase
    ) {
      const emphasisState = this.applyEmphasisAnimation(
        graphic.emphasisAnimation,
        time,
      );
      scale *= emphasisState.scale;
      scaleX *= emphasisState.scaleX;
      scaleY *= emphasisState.scaleY;
      offsetX += emphasisState.offsetX;
      offsetY += emphasisState.offsetY;
      rotation += emphasisState.rotation;
      opacity *= emphasisState.opacity;
    }

    return {
      transform: {
        ...transform,
        position: {
          x: transform.position.x + offsetX,
          y: transform.position.y + offsetY,
        },
        scale: {
          x: transform.scale.x * scale * scaleX,
          y: transform.scale.y * scale * scaleY,
        },
        rotation: transform.rotation + rotation,
        opacity,
        anchor: transform.anchor,
      },
      opacity,
      scale,
      scaleX,
      scaleY,
      offsetX,
      offsetY,
      rotation,
      blur,
    };
  }

  private applyEmphasisAnimation(
    animation: EmphasisAnimation,
    time: number,
  ): {
    opacity: number;
    scale: number;
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
    rotation: number;
  } {
    const { type, speed, intensity, loop, startTime, animationDuration } =
      animation;

    const animStart = startTime ?? 0;
    if (time < animStart) {
      return {
        opacity: 1,
        scale: 1,
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
      };
    }

    if (animationDuration !== undefined && animationDuration > 0) {
      const animEnd = animStart + animationDuration;
      if (time > animEnd) {
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };
      }
    }

    const adjustedTime = time - animStart;
    const cycleTime = loop
      ? (adjustedTime * speed) % 1
      : Math.min(adjustedTime * speed, 1);
    const t = cycleTime * Math.PI * 2;

    switch (type) {
      case "pulse":
        const pulseScale = 1 + Math.sin(t) * 0.1 * intensity;
        return {
          opacity: 1,
          scale: pulseScale,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };

      case "shake":
        const shakeX = Math.sin(t * 5) * 0.02 * intensity;
        const shakeY = Math.cos(t * 5) * 0.02 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: shakeX,
          offsetY: shakeY,
          rotation: 0,
        };

      case "bounce":
        const bounceY = Math.abs(Math.sin(t)) * -0.05 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: bounceY,
          rotation: 0,
        };

      case "float":
        const floatY = Math.sin(t) * 0.03 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: floatY,
          rotation: 0,
        };

      case "spin":
        const spinRotation = cycleTime * 360 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: spinRotation,
        };

      case "flash":
        const flashOpacity = 0.5 + Math.abs(Math.sin(t)) * 0.5;
        return {
          opacity: flashOpacity,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };

      case "heartbeat":
        const phase = cycleTime * 4;
        let heartScale = 1;
        if (phase < 1)
          heartScale = 1 + 0.15 * intensity * Math.sin(phase * Math.PI);
        else if (phase < 2)
          heartScale = 1 + 0.1 * intensity * Math.sin((phase - 1) * Math.PI);
        return {
          opacity: 1,
          scale: heartScale,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };

      case "swing":
        const swingRotation = Math.sin(t) * 15 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: swingRotation,
        };

      case "wobble":
        const wobbleRotation = Math.sin(t * 3) * 5 * intensity;
        const wobbleX = Math.sin(t) * 0.02 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: wobbleX,
          offsetY: 0,
          rotation: wobbleRotation,
        };

      case "jello":
        const jelloScaleX = 1 + Math.sin(t * 2) * 0.1 * intensity;
        const jelloScaleY = 1 - Math.sin(t * 2) * 0.1 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: jelloScaleX,
          scaleY: jelloScaleY,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };

      case "rubber-band":
        const rubberScaleX = 1 + Math.sin(t) * 0.2 * intensity;
        const rubberScaleY = 1 - Math.sin(t) * 0.1 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: rubberScaleX,
          scaleY: rubberScaleY,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };

      case "tada":
        const tadaRotation = Math.sin(t * 4) * 10 * intensity;
        const tadaScale = 1 + Math.sin(t * 2) * 0.1 * intensity;
        return {
          opacity: 1,
          scale: tadaScale,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: tadaRotation,
        };

      case "vibrate":
        const vibrateX = (Math.random() - 0.5) * 0.02 * intensity;
        const vibrateY = (Math.random() - 0.5) * 0.02 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: vibrateX,
          offsetY: vibrateY,
          rotation: 0,
        };

      case "flicker":
        const flickerOpacity = Math.random() > 0.1 ? 1 : 0.3;
        return {
          opacity: flickerOpacity,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };

      case "glow":
        const glowScale = 1 + Math.sin(t) * 0.05 * intensity;
        const glowOpacity = 0.8 + Math.sin(t) * 0.2;
        return {
          opacity: glowOpacity,
          scale: glowScale,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };

      case "breathe":
        const breatheScale = 1 + Math.sin(t * 0.5) * 0.08 * intensity;
        return {
          opacity: 1,
          scale: breatheScale,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };

      case "wave":
        const waveY = Math.sin(t + time * 2) * 0.03 * intensity;
        const waveRotation = Math.sin(t) * 5 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: waveY,
          rotation: waveRotation,
        };

      case "tilt":
        const tiltRotation = Math.sin(t * 0.5) * 10 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: tiltRotation,
        };

      case "zoom-pulse":
        const zoomScale = 1 + Math.sin(t) * 0.15 * intensity;
        return {
          opacity: 1,
          scale: zoomScale,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };

      case "focus-zoom": {
        const focusPoint = animation.focusPoint || { x: 0.5, y: 0.5 };
        const zoomAmount = animation.zoomScale || 1.5;
        const holdDuration = animation.holdDuration || 0.3;
        const zoomInPhase = 0.3;
        const zoomOutPhase = 1 - holdDuration - zoomInPhase;

        let focusScale = 1;
        let focusOffsetX = 0;
        let focusOffsetY = 0;

        if (cycleTime < zoomInPhase) {
          const zoomProgress = cycleTime / zoomInPhase;
          const eased = 1 - Math.pow(1 - zoomProgress, 3);
          focusScale = 1 + (zoomAmount - 1) * eased * intensity;
          focusOffsetX = (0.5 - focusPoint.x) * (focusScale - 1);
          focusOffsetY = (0.5 - focusPoint.y) * (focusScale - 1);
        } else if (cycleTime < zoomInPhase + holdDuration) {
          focusScale = zoomAmount * intensity;
          focusOffsetX = (0.5 - focusPoint.x) * (focusScale - 1);
          focusOffsetY = (0.5 - focusPoint.y) * (focusScale - 1);
        } else {
          const zoomOutProgress =
            (cycleTime - zoomInPhase - holdDuration) / zoomOutPhase;
          const eased = Math.pow(zoomOutProgress, 3);
          focusScale = zoomAmount - (zoomAmount - 1) * eased * intensity;
          focusOffsetX = (0.5 - focusPoint.x) * (focusScale - 1);
          focusOffsetY = (0.5 - focusPoint.y) * (focusScale - 1);
        }

        return {
          opacity: 1,
          scale: focusScale,
          scaleX: 1,
          scaleY: 1,
          offsetX: focusOffsetX,
          offsetY: focusOffsetY,
          rotation: 0,
        };
      }

      case "pan-left":
        const panLeftX = -cycleTime * 0.2 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: panLeftX,
          offsetY: 0,
          rotation: 0,
        };

      case "pan-right":
        const panRightX = cycleTime * 0.2 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: panRightX,
          offsetY: 0,
          rotation: 0,
        };

      case "pan-up":
        const panUpY = -cycleTime * 0.2 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: panUpY,
          rotation: 0,
        };

      case "pan-down":
        const panDownY = cycleTime * 0.2 * intensity;
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: panDownY,
          rotation: 0,
        };

      case "ken-burns": {
        const kbZoom = 1 + cycleTime * 0.3 * intensity;
        const kbX = cycleTime * 0.1 * intensity;
        const kbY = cycleTime * 0.05 * intensity;
        return {
          opacity: 1,
          scale: kbZoom,
          scaleX: 1,
          scaleY: 1,
          offsetX: kbX,
          offsetY: kbY,
          rotation: 0,
        };
      }

      case "none":
      default:
        return {
          opacity: 1,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };
    }
  }

  private applyGraphicAnimation(
    type: GraphicAnimationType,
    progress: number,
    easing: string,
    isEntry: boolean,
  ): {
    opacity: number;
    scale: number;
    offsetX: number;
    offsetY: number;
    rotation: number;
    blur: number;
  } {
    const easedProgress = this.animationEngine.applyEasing(
      progress,
      easing as any,
    );
    const animProgress = isEntry ? easedProgress : 1 - easedProgress;

    switch (type) {
      case "fade":
        return {
          opacity: animProgress,
          scale: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
          blur: 0,
        };

      case "slide-left":
        return {
          opacity: animProgress,
          scale: 1,
          offsetX: (1 - animProgress) * -1.0,
          offsetY: 0,
          rotation: 0,
          blur: 0,
        };

      case "slide-right":
        return {
          opacity: animProgress,
          scale: 1,
          offsetX: (1 - animProgress) * 1.0,
          offsetY: 0,
          rotation: 0,
          blur: 0,
        };

      case "slide-up":
        return {
          opacity: animProgress,
          scale: 1,
          offsetX: 0,
          offsetY: (1 - animProgress) * -1.0,
          rotation: 0,
          blur: 0,
        };

      case "slide-down":
        return {
          opacity: animProgress,
          scale: 1,
          offsetX: 0,
          offsetY: (1 - animProgress) * 1.0,
          rotation: 0,
          blur: 0,
        };

      case "scale":
        return {
          opacity: animProgress,
          scale: animProgress,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
          blur: 0,
        };

      case "rotate":
        return {
          opacity: animProgress,
          scale: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: (1 - animProgress) * (isEntry ? -180 : 180),
          blur: 0,
        };

      case "bounce":
        const bounceProgress =
          Math.abs(Math.sin(animProgress * Math.PI * 3)) * (1 - animProgress);
        return {
          opacity: animProgress,
          scale: 1,
          offsetX: 0,
          offsetY: bounceProgress * -0.1,
          rotation: 0,
          blur: 0,
        };

      case "pop":
        // Pop animation: quick scale-up with overshoot, then settle to 1.0
        const overshoot = 1.2;
        let popScale = 0;
        // Phase 1 (0-0.5): accelerate to overshoot value
        if (animProgress < 0.5) {
          popScale = animProgress * 2 * overshoot;
        }
        // Phase 2 (0.5-0.7): decelerate from overshoot back to 1.0
        else if (animProgress < 0.7) {
          // Linear interpolation from overshoot to 1.0 over 0.2 duration
          popScale = overshoot - ((animProgress - 0.5) * (overshoot - 1)) / 0.2;
        }
        // Phase 3 (0.7-1.0): settled at full scale
        else {
          popScale = 1;
        }
        return {
          opacity: Math.min(animProgress * 2, 1),
          scale: popScale,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
          blur: 0,
        };

      case "none":
      default:
        return {
          opacity: 1,
          scale: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
          blur: 0,
        };
    }
  }

  private getAnimatedTransform(graphic: GraphicClip, time: number): Transform {
    if (graphic.keyframes.length === 0) {
      return graphic.transform;
    }

    const transform = { ...graphic.transform };

    const properties = [
      "position.x",
      "position.y",
      "scale.x",
      "scale.y",
      "rotation",
      "opacity",
    ];

    for (const prop of properties) {
      const keyframes = this.animationEngine.getKeyframesForProperty(
        graphic.keyframes,
        prop,
      );

      if (keyframes.length > 0) {
        const result = this.animationEngine.getValueAtTime(keyframes, time);
        if (result.value !== undefined) {
          this.setNestedProperty(transform, prop, result.value);
        }
      }
    }

    return transform;
  }

  private applyTransform(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    transform: Transform,
    width: number,
    height: number,
  ): void {
    const posX = transform.position.x * width;
    const posY = transform.position.y * height;

    ctx.translate(posX, posY);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(transform.scale.x, transform.scale.y);
    ctx.globalAlpha = transform.opacity;
  }

  private setNestedProperty(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    const parts = path.split(".");
    let current = obj as Record<string, unknown>;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * Adds a keyframe to a graphic for animation.
   *
   * @param graphic - The graphic to add a keyframe to
   * @param keyframe - The keyframe to add
   * @returns The graphic with the new keyframe
   */
  addKeyframe<T extends GraphicClip>(graphic: T, keyframe: Keyframe): T {
    return {
      ...graphic,
      keyframes: this.animationEngine.addKeyframe(graphic.keyframes, keyframe),
    };
  }

  /**
   * Removes a keyframe from a graphic.
   *
   * @param graphic - The graphic to remove the keyframe from
   * @param keyframeId - ID of the keyframe to remove
   * @returns The graphic without the keyframe
   */
  removeKeyframe<T extends GraphicClip>(graphic: T, keyframeId: string): T {
    return {
      ...graphic,
      keyframes: this.animationEngine.removeKeyframe(
        graphic.keyframes,
        keyframeId,
      ),
    };
  }

  /**
   * Updates a keyframe in a graphic.
   *
   * @param graphic - The graphic containing the keyframe
   * @param keyframeId - ID of the keyframe to update
   * @param updates - Properties to update on the keyframe
   * @returns The graphic with the updated keyframe
   */
  updateKeyframe<T extends GraphicClip>(
    graphic: T,
    keyframeId: string,
    updates: Partial<Omit<Keyframe, "id">>,
  ): T {
    return {
      ...graphic,
      keyframes: this.animationEngine.updateKeyframe(
        graphic.keyframes,
        keyframeId,
        updates,
      ),
    };
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    const cached = this.imageCache.get(url);
    if (cached) {
      return Promise.resolve(cached);
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.imageCache.set(url, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }

  private generateId(): string {
    return `graphic_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Retrieves a shape clip by ID.
   *
   * @param id - ID of the shape clip
   * @returns The ShapeClip, or undefined if not found
   */
  getShapeClip(id: string): ShapeClip | undefined {
    return this.shapeClips.get(id);
  }

  /**
   * Retrieves an SVG clip by ID.
   *
   * @param id - ID of the SVG clip
   * @returns The SVGClip, or undefined if not found
   */
  getSVGClip(id: string): SVGClip | undefined {
    return this.svgClips.get(id);
  }

  /**
   * Returns all shape clips in the engine.
   *
   * @returns Array of all ShapeClips
   */
  getAllShapeClips(): ShapeClip[] {
    return Array.from(this.shapeClips.values());
  }

  /**
   * Returns all SVG clips in the engine.
   *
   * @returns Array of all SVGClips
   */
  getAllSVGClips(): SVGClip[] {
    return Array.from(this.svgClips.values());
  }

  /**
   * Returns all shape clips on a specific track.
   *
   * @param trackId - ID of the track
   * @returns Array of ShapeClips on the track
   */
  getShapeClipsForTrack(trackId: string): ShapeClip[] {
    return Array.from(this.shapeClips.values()).filter(
      (clip) => clip.trackId === trackId,
    );
  }

  /**
   * Returns all SVG clips on a specific track.
   *
   * @param trackId - ID of the track
   * @returns Array of SVGClips on the track
   */
  getSVGClipsForTrack(trackId: string): SVGClip[] {
    return Array.from(this.svgClips.values()).filter(
      (clip) => clip.trackId === trackId,
    );
  }

  /**
   * Deletes a shape clip by ID.
   *
   * @param id - ID of the shape clip to delete
   * @returns true if the clip was deleted, false if not found
   */
  deleteShapeClip(id: string): boolean {
    return this.shapeClips.delete(id);
  }

  /**
   * Deletes an SVG clip by ID.
   *
   * @param id - ID of the SVG clip to delete
   * @returns true if the clip was deleted, false if not found
   */
  deleteSVGClip(id: string): boolean {
    return this.svgClips.delete(id);
  }

  /**
   * Updates an SVG clip by ID with new properties.
   *
   * @param id - ID of the SVG clip to update
   * @param updates - Properties to update (timing, animation, colors, blending)
   * @returns The updated SVGClip, or undefined if not found
   */
  updateSVGClip(
    id: string,
    updates: {
      startTime?: number;
      duration?: number;
      transform?: Partial<Transform>;
      entryAnimation?: GraphicAnimation;
      exitAnimation?: GraphicAnimation;
      colorStyle?: SVGColorStyle;
      blendMode?: import("../video/types").BlendMode;
      blendOpacity?: number;
      emphasisAnimation?: EmphasisAnimation;
    },
  ): SVGClip | undefined {
    const existing = this.svgClips.get(id);
    if (!existing) {
      console.warn(`[GraphicsEngine] SVG clip not found: ${id}`);
      return undefined;
    }

    const updatedClip: SVGClip = {
      ...existing,
      startTime: updates.startTime ?? existing.startTime,
      duration: updates.duration ?? existing.duration,
      transform: updates.transform
        ? { ...existing.transform, ...updates.transform }
        : existing.transform,
      entryAnimation: updates.entryAnimation ?? existing.entryAnimation,
      exitAnimation: updates.exitAnimation ?? existing.exitAnimation,
      colorStyle: updates.colorStyle ?? existing.colorStyle,
      blendMode: updates.blendMode ?? existing.blendMode,
      blendOpacity: updates.blendOpacity ?? existing.blendOpacity,
      emphasisAnimation:
        updates.emphasisAnimation ?? existing.emphasisAnimation,
    };

    this.svgClips.set(id, updatedClip);
    return updatedClip;
  }

  /**
   * Sets the entry or exit animation for an SVG clip.
   *
   * @param svg - The SVG clip to animate
   * @param type - Animation type: "entry" for appearing, "exit" for disappearing
   * @param animation - Animation configuration
   * @returns The updated SVGClip
   */
  setSVGAnimation(
    svg: SVGClip,
    type: "entry" | "exit",
    animation: GraphicAnimation,
  ): SVGClip {
    const updated: SVGClip = {
      ...svg,
      [type === "entry" ? "entryAnimation" : "exitAnimation"]: animation,
    };

    this.svgClips.set(svg.id, updated);
    return updated;
  }

  /**
   * Sets the color style for an SVG clip (tint, replace, or no color mode).
   *
   * @param svg - The SVG clip to style
   * @param colorStyle - Color style configuration
   * @returns The updated SVGClip
   */
  setSVGColorStyle(svg: SVGClip, colorStyle: SVGColorStyle): SVGClip {
    const updated: SVGClip = {
      ...svg,
      colorStyle,
    };

    this.svgClips.set(svg.id, updated);
    return updated;
  }

  /**
   * Adds a sticker clip to the engine.
   *
   * @param clip - The sticker clip to add
   */
  addStickerClip(clip: StickerClip): void {
    this.stickerClips.set(clip.id, clip);
  }

  /**
   * Retrieves a sticker clip by ID.
   *
   * @param id - ID of the sticker clip
   * @returns The StickerClip, or undefined if not found
   */
  getStickerClip(id: string): StickerClip | undefined {
    return this.stickerClips.get(id);
  }

  /**
   * Returns all sticker clips in the engine.
   *
   * @returns Array of all StickerClips
   */
  getAllStickerClips(): StickerClip[] {
    return Array.from(this.stickerClips.values());
  }

  /**
   * Returns all sticker clips on a specific track.
   *
   * @param trackId - ID of the track
   * @returns Array of StickerClips on the track
   */
  getStickerClipsForTrack(trackId: string): StickerClip[] {
    return Array.from(this.stickerClips.values()).filter(
      (clip) => clip.trackId === trackId,
    );
  }

  /**
   * Deletes a sticker clip by ID.
   *
   * @param id - ID of the sticker clip to delete
   * @returns true if the clip was deleted, false if not found
   */
  deleteStickerClip(id: string): boolean {
    return this.stickerClips.delete(id);
  }

  /**
   * Updates a sticker clip by ID with new properties.
   *
   * @param id - ID of the sticker clip to update
   * @param updates - Properties to update (timing, transform, blending)
   * @returns The updated StickerClip, or undefined if not found
   */
  updateStickerClip(
    id: string,
    updates: {
      startTime?: number;
      duration?: number;
      transform?: Partial<Transform>;
      blendMode?: import("../video/types").BlendMode;
      blendOpacity?: number;
      emphasisAnimation?: EmphasisAnimation;
    },
  ): StickerClip | undefined {
    const existing = this.stickerClips.get(id);
    if (!existing) {
      console.warn(`[GraphicsEngine] Sticker clip not found: ${id}`);
      return undefined;
    }

    const updatedClip: StickerClip = {
      ...existing,
      startTime: updates.startTime ?? existing.startTime,
      duration: updates.duration ?? existing.duration,
      transform: updates.transform
        ? { ...existing.transform, ...updates.transform }
        : existing.transform,
      blendMode: updates.blendMode ?? existing.blendMode,
      blendOpacity: updates.blendOpacity ?? existing.blendOpacity,
      emphasisAnimation:
        updates.emphasisAnimation ?? existing.emphasisAnimation,
    };

    this.stickerClips.set(id, updatedClip);
    return updatedClip;
  }

  /**
   * Clears all cached data and clips from the engine.
   * Use when resetting the engine or freeing memory.
   */
  clearCache(): void {
    this.svgCache.clear();
    this.imageCache.clear();
    this.shapeClips.clear();
    this.svgClips.clear();
    this.stickerClips.clear();
    this.animationEngine.clearCache();
  }

  loadShapeClips(clips: ShapeClip[]): void {
    this.shapeClips.clear();
    for (const clip of clips) {
      this.shapeClips.set(clip.id, clip);
    }
  }

  loadSVGClips(clips: SVGClip[]): void {
    this.svgClips.clear();
    for (const clip of clips) {
      this.svgClips.set(clip.id, clip);
    }
  }

  loadStickerClips(clips: StickerClip[]): void {
    this.stickerClips.clear();
    for (const clip of clips) {
      this.stickerClips.set(clip.id, clip);
    }
  }

  /**
   * Creates a graphic animation configuration.
   *
   * @param type - Animation type (fade, slide, scale, rotate, bounce, pop, etc.)
   * @param duration - Duration in seconds (default: 0.5)
   * @param easing - Easing function name (default: ease-out)
   * @returns GraphicAnimation configuration object
   */
  createGraphicAnimation(
    type: GraphicAnimationType,
    duration: number = 0.5,
    easing: string = "ease-out",
  ): GraphicAnimation {
    return {
      type,
      duration,
      easing,
    };
  }
}

export const graphicsEngine = new GraphicsEngine();
