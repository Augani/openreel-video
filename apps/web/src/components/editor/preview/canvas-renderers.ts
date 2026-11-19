import { currentBurnInSource } from "../../../utils/burn-in-source";
import {
  titleEngine,
  getAnimatedVideoEffects,
  hasAnimatedVideoEffects,
  hasAnimatedColorGrading,
  getAnimatedColorGrading,
  isRenderableVideoEffect,
  applyIrisMaskToContext,
  isIrisShape,
  type VideoEffectSource,
  type Effect,
  type TextClip,
  type ShapeClip,
  type SVGClip,
  type StickerClip,
  type Subtitle,
  renderAnimatedCaption,
  type WordSegment,
  getBackgroundRemovalEngine,
  AnimationEngine,
  type Keyframe,
  type EmphasisAnimation,
  isNeutralColorGrading,
  type TransitionEdge,
  resolveCanvasFitDimensions,
  planSvgRaster,
  padSvgForRaster,
  SVG_RASTER_PAD,
  type Clip,
  applyInputTransformToBitmap,
  drawShapePathCentered,
} from "@openreel/core";
import type { SubtitleStyle } from "@openreel/core";
import { overlayBlendAlpha } from "@openreel/core";
import { displayLayoutWidth, normalizeSequencePar, withDisplaySpace } from "@openreel/core/video/sequence-par";
import {
  DEFAULT_CAPTION_FONT_SIZE,
  captionFont,
  drawCaption,
  drawCaptionText,
  fillCaptionBox,
  layoutCaption,
} from "@openreel/core/captions/caption-layout";
import type * as THREE from "three";

type GraphicClipUnion = ShapeClip | SVGClip | StickerClip;
import { getEffectsBridge } from "../../../bridges/effects-bridge";
import { isColorBypassed, withPreviewOverrides } from "./program-frame-control";
import { inputTransformForClip } from "./clip-input-transform";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import type { ClipTransform } from "./types";
import { DEFAULT_TRANSFORM } from "./types";
import type { ThreeJSLayerRenderer } from "./threejs-layer-renderer";

let lastEffectsLogTime = 0;
let threeJSRenderer: ThreeJSLayerRenderer | null = null;
let threeJSModule: Promise<typeof import("./threejs-layer-renderer")> | null = null;
let threeJSGeneration = 0;
let irisFallbackCanvas: OffscreenCanvas | null = null;
const animationEngine = new AnimationEngine();

let previewSequencePar = 1;

/**
 * Sequence pixel aspect ratio of the project the Program monitor is drawing. Overlays (titles, shapes, SVG,
 * stickers, captions) are laid out in display space and squeezed into the stored-pixel canvas, exactly like the
 * export compositor, while the monitor frame is shown at the display aspect, so a circle stays a circle.
 */
export const setPreviewSequencePar = (par: number | undefined | null): void => {
  previewSequencePar = normalizeSequencePar(par);
};

export const getPreviewSequencePar = (): number => previewSequencePar;

async function getThreeJSRenderer(
  width: number,
  height: number,
): Promise<ThreeJSLayerRenderer | null> {
  const generation = threeJSGeneration;
  if (!threeJSRenderer) {
    threeJSModule ??= import("./threejs-layer-renderer").catch((error: unknown) => {
      threeJSModule = null;
      throw error;
    });
    const { ThreeJSLayerRenderer } = await threeJSModule;
    if (generation !== threeJSGeneration) return null;
    if (!threeJSRenderer) {
      threeJSRenderer = new ThreeJSLayerRenderer(width, height);
      threeJSRenderer.setFontReadyCallback(() => imageLoadCallback?.());
    }
  }
  if (threeJSRenderer.canvas.width !== width || threeJSRenderer.canvas.height !== height) {
    threeJSRenderer.resize(width, height);
  }
  return threeJSRenderer;
}

export function disposePreview3DRenderer(): void {
  threeJSGeneration += 1;
  threeJSRenderer?.dispose();
  threeJSRenderer = null;
  // The same preview host owns the optional cold-start 2D surface.
  irisFallbackCanvas = null;
}

interface EmphasisState {
  opacity: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
}

const DEFAULT_EMPHASIS_STATE: EmphasisState = {
  opacity: 1,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
};

export const applyEmphasisAnimation = (
  animation: EmphasisAnimation,
  time: number,
): EmphasisState => {
  const { type, speed, intensity, loop, startTime, animationDuration } =
    animation;

  const animStart = startTime ?? 0;
  if (time < animStart) {
    return DEFAULT_EMPHASIS_STATE;
  }

  if (animationDuration !== undefined && animationDuration > 0) {
    const animEnd = animStart + animationDuration;
    if (time > animEnd) {
      return DEFAULT_EMPHASIS_STATE;
    }
  }

  const adjustedTime = time - animStart;
  const cycleTime = loop
    ? (adjustedTime * speed) % 1
    : Math.min(adjustedTime * speed, 1);
  const t = cycleTime * Math.PI * 2;

  switch (type) {
    case "pulse": {
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
    }

    case "shake": {
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
    }

    case "bounce": {
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
    }

    case "float": {
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
    }

    case "spin": {
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
    }

    case "flash": {
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
    }

    case "heartbeat": {
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
    }

    case "swing": {
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
    }

    case "wobble": {
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
    }

    case "jello": {
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
    }

    case "rubber-band": {
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
    }

    case "tada": {
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
    }

    case "vibrate": {
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
    }

    case "flicker": {
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
    }

    case "glow": {
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
    }

    case "breathe": {
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
    }

    case "wave": {
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
    }

    case "tilt": {
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
    }

    case "zoom-pulse": {
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
    }

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

    case "pan-left": {
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
    }

    case "pan-right": {
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
    }

    case "pan-up": {
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
    }

    case "pan-down": {
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
    }

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
};

export const getAnimatedTransform = (
  baseTransform: ClipTransform,
  keyframes: Keyframe[] | undefined,
  clipLocalTime: number,
): ClipTransform => {
  if (!keyframes || keyframes.length === 0) {
    return baseTransform;
  }

  const result: ClipTransform = { ...baseTransform };

  // Group keyframes by property to efficiently interpolate each transform component
  const posXKeyframes = keyframes.filter((kf) => kf.property === "position.x");
  const posYKeyframes = keyframes.filter((kf) => kf.property === "position.y");
  const scaleXKeyframes = keyframes.filter((kf) => kf.property === "scale.x");
  const scaleYKeyframes = keyframes.filter((kf) => kf.property === "scale.y");
  const rotationKeyframes = keyframes.filter(
    (kf) => kf.property === "rotation",
  );
  const opacityKeyframes = keyframes.filter((kf) => kf.property === "opacity");

  if (posXKeyframes.length > 0) {
    const { value } = animationEngine.getValueAtTime(
      posXKeyframes,
      clipLocalTime,
    );
    if (typeof value === "number") {
      result.position = { ...result.position, x: value };
    }
  }

  if (posYKeyframes.length > 0) {
    const { value } = animationEngine.getValueAtTime(
      posYKeyframes,
      clipLocalTime,
    );
    if (typeof value === "number") {
      result.position = { ...result.position, y: value };
    }
  }

  if (scaleXKeyframes.length > 0) {
    const { value } = animationEngine.getValueAtTime(
      scaleXKeyframes,
      clipLocalTime,
    );
    if (typeof value === "number") {
      result.scale = { ...result.scale, x: value };
    }
  }

  if (scaleYKeyframes.length > 0) {
    const { value } = animationEngine.getValueAtTime(
      scaleYKeyframes,
      clipLocalTime,
    );
    if (typeof value === "number") {
      result.scale = { ...result.scale, y: value };
    }
  }

  if (rotationKeyframes.length > 0) {
    const { value } = animationEngine.getValueAtTime(
      rotationKeyframes,
      clipLocalTime,
    );
    if (typeof value === "number") {
      result.rotation = value;
    }
  }

  if (opacityKeyframes.length > 0) {
    const { value } = animationEngine.getValueAtTime(
      opacityKeyframes,
      clipLocalTime,
    );
    if (typeof value === "number") {
      result.opacity = value;
    }
  }

  return result;
};

export const renderTextClipToCanvas = (
  ctx: CanvasRenderingContext2D,
  textClip: TextClip,
  storedWidth: number,
  canvasHeight: number,
  time: number,
): void | Promise<void> => {
  // Lay out in display space (stored width x PAR), then squeeze into the stored canvas.
  const canvasWidth = displayLayoutWidth(storedWidth, previewSequencePar);
  const clipLocalTime = time - textClip.startTime;
  const { opacity, transform, style, visibleText } = titleEngine.getAnimatedTextState(textClip, clipLocalTime);
  if (opacity <= 0 || visibleText.length === 0) return;

  // 3D transforms, 3D extrusion, or blend modes require THREE.js
  // rendering since Canvas 2D can't support them. This ensures proper
  // perspective, depth, and blending that Canvas 2D doesn't natively
  // support.
  const has3DTransforms =
    transform.rotate3d &&
    (transform.rotate3d.x !== 0 || transform.rotate3d.y !== 0);
  const hasBlendMode = textClip.blendMode && textClip.blendMode !== "normal";
  const has3DText = textClip.text3d?.enabled === true;

  if (has3DTransforms || hasBlendMode || has3DText) {
    const animatedTextClip: TextClip = {
      ...textClip,
      text: visibleText,
      style: style,
      transform: {
        ...transform,
        opacity: opacity,
      },
    };

    return getThreeJSRenderer(canvasWidth, canvasHeight).then((renderer) => {
      if (!renderer || renderer !== threeJSRenderer) return;
      renderer.clear();
      const mesh = renderer.renderTextClip(animatedTextClip, canvasWidth, canvasHeight);
      if (mesh) {
        renderer.getScene().add(mesh);
        ctx.drawImage(renderer.render(), 0, 0, storedWidth, canvasHeight);
      }
    });
  }

  // Use the same title renderer as export. Keeping one 2D text path is
  // essential for shader fidelity: Paper fills, animated glyph shaders,
  // masking, shadows, and per-character animation must produce the same
  // pixels on the editor stage and in the encoded video.
  const rendered = titleEngine.renderText(
    textClip,
    canvasWidth,
    canvasHeight,
    clipLocalTime,
  );
  ctx.drawImage(rendered.canvas, 0, 0, storedWidth, canvasHeight);
};

export const getActiveTextClips = (
  allTextClips: TextClip[],
  currentTime: number,
): TextClip[] => {
  return allTextClips.filter((clip) => {
    const clipEnd = clip.startTime + clip.duration;
    return currentTime >= clip.startTime && currentTime < clipEnd;
  });
};

export const getActiveShapeClips = (
  allShapeClips: GraphicClipUnion[],
  currentTime: number,
): GraphicClipUnion[] => {
  return allShapeClips.filter((clip) => {
    const clipEnd = clip.startTime + clip.duration;
    return currentTime >= clip.startTime && currentTime < clipEnd;
  });
};

const svgImageCache = new Map<string, HTMLImageElement>();
const stickerImageCache = new Map<string, HTMLImageElement>();

let imageLoadCallback: (() => void) | null = null;

export const setImageLoadCallback = (callback: (() => void) | null): void => {
  imageLoadCallback = callback;
};



const renderStickerClip = (
  ctx: CanvasRenderingContext2D,
  stickerClip: StickerClip,
  canvasWidth: number,
  canvasHeight: number,
  currentTime: number,
): void => {
  const { imageUrl, transform, keyframes } = stickerClip;

  const clipLocalTime = currentTime - stickerClip.startTime;
  const animatedTransform =
    keyframes && keyframes.length > 0
      ? getAnimatedTransform(transform, keyframes, clipLocalTime)
      : transform;

  ctx.save();

  const posX = animatedTransform.position.x * canvasWidth;
  const posY = animatedTransform.position.y * canvasHeight;

  ctx.translate(posX, posY);
  ctx.rotate((animatedTransform.rotation * Math.PI) / 180);
  // Blend opacity (0-100) like the export compositor; non-normal blend modes go through the three.js path instead.
  ctx.globalAlpha = animatedTransform.opacity * overlayBlendAlpha(stickerClip);

  let img = stickerImageCache.get(imageUrl);
  if (!img) {
    img = new Image();
    img.onload = () => imageLoadCallback?.();
    img.src = imageUrl;
    stickerImageCache.set(imageUrl, img);
  }

  if (img.complete && img.naturalHeight !== 0) {
    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;
    const scaleX = animatedTransform.scale.x;
    const scaleY = animatedTransform.scale.y;

    const anchorX = animatedTransform.anchor?.x ?? 0.5;
    const anchorY = animatedTransform.anchor?.y ?? 0.5;

    if (animatedTransform.crop) {
      const sx = animatedTransform.crop.x * imgWidth;
      const sy = animatedTransform.crop.y * imgHeight;
      const sWidth = animatedTransform.crop.width * imgWidth;
      const sHeight = animatedTransform.crop.height * imgHeight;

      ctx.drawImage(
        img,
        sx,
        sy,
        sWidth,
        sHeight,
        -sWidth * scaleX * anchorX,
        -sHeight * scaleY * anchorY,
        sWidth * scaleX,
        sHeight * scaleY,
      );
    } else {
      ctx.drawImage(
        img,
        -imgWidth * scaleX * anchorX,
        -imgHeight * scaleY * anchorY,
        imgWidth * scaleX,
        imgHeight * scaleY,
      );
    }
  }

  ctx.restore();
};

const renderSVGClip = (
  ctx: CanvasRenderingContext2D,
  svgClip: SVGClip,
  canvasWidth: number,
  canvasHeight: number,
  currentTime: number,
): void => {
  const {
    svgContent,
    viewBox,
    colorStyle,
    entryAnimation,
    exitAnimation,
  } = svgClip;

  const clipLocalTime = currentTime - svgClip.startTime;

  let transform = svgClip.transform;
  if (svgClip.keyframes && svgClip.keyframes.length > 0) {
    transform = getAnimatedTransform(svgClip.transform, svgClip.keyframes, clipLocalTime);
  }

  ctx.save();

  // Sub-pixel exact (no pixel snapping): the export compositor draws at the exact position, so
  // snapping here shifted thin strokes by up to half a pixel against the export.
  const posX = transform.position.x * canvasWidth;
  const posY = transform.position.y * canvasHeight;

  let animationScale = { x: transform.scale.x, y: transform.scale.y };
  let animationOpacity = transform.opacity * overlayBlendAlpha(svgClip);
  let animationTranslateX = 0;
  let animationTranslateY = 0;

  const clipEndLocalTime = svgClip.duration;

  let clipRect: { x: number; y: number; width: number; height: number } | null =
    null;
  let drawProgress = 0;

  // Apply entry animation if clip is in entry phase
  if (entryAnimation && clipLocalTime < entryAnimation.duration) {
    const progress = clipLocalTime / entryAnimation.duration;
    const eased = progress;

    switch (entryAnimation.type) {
      case "fade":
        animationOpacity *= eased;
        break;
      case "scale":
        const scale = eased;
        animationScale = {
          x: animationScale.x * scale,
          y: animationScale.y * scale,
        };
        break;
      case "slide-left":
        animationTranslateX = -(1 - eased) * canvasWidth;
        break;
      case "slide-right":
        animationTranslateX = (1 - eased) * canvasWidth;
        break;
      case "slide-up":
        animationTranslateY = -(1 - eased) * canvasHeight;
        break;
      case "slide-down":
        animationTranslateY = (1 - eased) * canvasHeight;
        break;
      case "rotate":
        ctx.rotate((1 - eased) * Math.PI * 2);
        animationOpacity *= eased;
        break;
      case "bounce":
        const bounceProgress =
          eased < 0.5 ? 2 * eased * eased : 1 - Math.pow(-2 * eased + 2, 2) / 2;
        animationScale = {
          x: animationScale.x * bounceProgress,
          y: animationScale.y * bounceProgress,
        };
        animationOpacity *= eased;
        break;
      case "pop":
        const popScale = eased < 0.5 ? eased * 2.2 : 1 + (1 - eased) * 0.2;
        animationScale = {
          x: animationScale.x * popScale,
          y: animationScale.y * popScale,
        };
        break;
      case "draw":
        drawProgress = eased;
        animationOpacity *= Math.min(1, eased * 2);
        break;
      case "wipe-left":
        clipRect = {
          x: 0,
          y: 0,
          width: (viewBox?.width || 200) * eased,
          height: viewBox?.height || 200,
        };
        break;
      case "wipe-right":
        clipRect = {
          x: (viewBox?.width || 200) * (1 - eased),
          y: 0,
          width: (viewBox?.width || 200) * eased,
          height: viewBox?.height || 200,
        };
        break;
      case "wipe-up":
        clipRect = {
          x: 0,
          y: (viewBox?.height || 200) * (1 - eased),
          width: viewBox?.width || 200,
          height: (viewBox?.height || 200) * eased,
        };
        break;
      case "wipe-down":
        clipRect = {
          x: 0,
          y: 0,
          width: viewBox?.width || 200,
          height: (viewBox?.height || 200) * eased,
        };
        break;
      case "reveal-center":
        const centerScale = eased;
        animationScale = {
          x: animationScale.x * centerScale,
          y: animationScale.y * centerScale,
        };
        clipRect = {
          x: (viewBox?.width || 200) * (1 - eased) * 0.5,
          y: (viewBox?.height || 200) * (1 - eased) * 0.5,
          width: (viewBox?.width || 200) * eased,
          height: (viewBox?.height || 200) * eased,
        };
        break;
      case "reveal-edges":
        clipRect = {
          x: (viewBox?.width || 200) * eased * 0.5,
          y: (viewBox?.height || 200) * eased * 0.5,
          width: (viewBox?.width || 200) * (1 - eased),
          height: (viewBox?.height || 200) * (1 - eased),
        };
        break;
      case "elastic":
        const elasticScale =
          eased < 0.5
            ? 4 * eased * eased * eased
            : 1 - Math.pow(-2 * eased + 2, 3) / 2;
        const overshoot = elasticScale > 1 ? elasticScale : elasticScale;
        animationScale = {
          x: animationScale.x * overshoot,
          y: animationScale.y * overshoot,
        };
        break;
      case "flip-horizontal":
        animationScale = {
          x: animationScale.x * Math.cos(eased * Math.PI),
          y: animationScale.y,
        };
        animationOpacity *= Math.abs(Math.cos((eased * Math.PI) / 2));
        break;
      case "flip-vertical":
        animationScale = {
          x: animationScale.x,
          y: animationScale.y * Math.cos(eased * Math.PI),
        };
        animationOpacity *= Math.abs(Math.cos((eased * Math.PI) / 2));
        break;
    }
  }

  if (
    exitAnimation &&
    clipLocalTime > clipEndLocalTime - exitAnimation.duration
  ) {
    const exitStartTime = clipEndLocalTime - exitAnimation.duration;
    const exitProgress =
      (clipLocalTime - exitStartTime) / exitAnimation.duration;
    const eased = exitProgress;

    switch (exitAnimation.type) {
      case "fade":
        animationOpacity *= 1 - eased;
        break;
      case "scale":
        const scale = 1 - eased;
        animationScale = {
          x: animationScale.x * scale,
          y: animationScale.y * scale,
        };
        break;
      case "slide-left":
        animationTranslateX = -eased * canvasWidth;
        break;
      case "slide-right":
        animationTranslateX = eased * canvasWidth;
        break;
      case "slide-up":
        animationTranslateY = -eased * canvasHeight;
        break;
      case "slide-down":
        animationTranslateY = eased * canvasHeight;
        break;
      case "rotate":
        ctx.rotate(eased * Math.PI * 2);
        animationOpacity *= 1 - eased;
        break;
      case "bounce":
        const bounceOut =
          1 -
          (eased < 0.5
            ? 2 * eased * eased
            : 1 - Math.pow(-2 * eased + 2, 2) / 2);
        animationScale = {
          x: animationScale.x * bounceOut,
          y: animationScale.y * bounceOut,
        };
        animationOpacity *= 1 - eased;
        break;
      case "pop":
        const popOutScale = eased < 0.5 ? 1 - eased * 0.2 : 1 - eased * 2.2;
        animationScale = {
          x: animationScale.x * Math.max(0, popOutScale),
          y: animationScale.y * Math.max(0, popOutScale),
        };
        break;
      case "draw":
        drawProgress = 1 - eased;
        animationOpacity *= Math.max(0, 1 - eased * 2);
        break;
      case "wipe-left":
        clipRect = {
          x: (viewBox?.width || 200) * eased,
          y: 0,
          width: (viewBox?.width || 200) * (1 - eased),
          height: viewBox?.height || 200,
        };
        break;
      case "wipe-right":
        clipRect = {
          x: 0,
          y: 0,
          width: (viewBox?.width || 200) * (1 - eased),
          height: viewBox?.height || 200,
        };
        break;
      case "wipe-up":
        clipRect = {
          x: 0,
          y: 0,
          width: viewBox?.width || 200,
          height: (viewBox?.height || 200) * (1 - eased),
        };
        break;
      case "wipe-down":
        clipRect = {
          x: 0,
          y: (viewBox?.height || 200) * eased,
          width: viewBox?.width || 200,
          height: (viewBox?.height || 200) * (1 - eased),
        };
        break;
      case "reveal-center":
        clipRect = {
          x: (viewBox?.width || 200) * eased * 0.5,
          y: (viewBox?.height || 200) * eased * 0.5,
          width: (viewBox?.width || 200) * (1 - eased),
          height: (viewBox?.height || 200) * (1 - eased),
        };
        break;
      case "reveal-edges":
        clipRect = {
          x: (viewBox?.width || 200) * (1 - eased) * 0.5,
          y: (viewBox?.height || 200) * (1 - eased) * 0.5,
          width: (viewBox?.width || 200) * eased,
          height: (viewBox?.height || 200) * eased,
        };
        break;
      case "elastic":
        const elasticOut =
          1 -
          (eased < 0.5
            ? 4 * eased * eased * eased
            : 1 - Math.pow(-2 * eased + 2, 3) / 2);
        animationScale = {
          x: animationScale.x * Math.max(0, elasticOut),
          y: animationScale.y * Math.max(0, elasticOut),
        };
        break;
      case "flip-horizontal":
        animationScale = {
          x: animationScale.x * Math.cos((1 - eased) * Math.PI + Math.PI),
          y: animationScale.y,
        };
        animationOpacity *= Math.abs(Math.cos(((1 - eased) * Math.PI) / 2));
        break;
      case "flip-vertical":
        animationScale = {
          x: animationScale.x,
          y: animationScale.y * Math.cos((1 - eased) * Math.PI + Math.PI),
        };
        animationOpacity *= Math.abs(Math.cos(((1 - eased) * Math.PI) / 2));
        break;
    }
  }

  ctx.translate(
    posX + animationTranslateX,
    posY + animationTranslateY,
  );
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(animationScale.x, animationScale.y);
  ctx.globalAlpha = animationOpacity;

  const svgWidth = viewBox?.width || 200;
  const svgHeight = viewBox?.height || 200;
  // One plan shared with the export compositor (graphics-engine): same raster scale, same margin.
  const plan = planSvgRaster(viewBox, canvasWidth, canvasHeight, animationScale.x, animationScale.y);
  const { renderWidth, renderHeight, paddedWidth, paddedHeight } = plan;
  const cacheKey = `${svgClip.id}_${renderWidth}x${renderHeight}`;
  let img = svgImageCache.get(cacheKey);

  if (!img) {
    const scaledContent = padSvgForRaster(
      svgContent,
      plan,
      viewBox ? { minX: viewBox.minX, minY: viewBox.minY, width: svgWidth, height: svgHeight } : undefined,
    );

    img = new Image();
    const blob = new Blob([scaledContent], { type: "image/svg+xml" });
    img.onload = () => imageLoadCallback?.();
    img.src = URL.createObjectURL(blob);
    svgImageCache.set(cacheKey, img);
    if (svgImageCache.size > 50) {
      const firstKey = svgImageCache.keys().next().value;
      if (firstKey) {
        const oldImg = svgImageCache.get(firstKey);
        if (oldImg?.src?.startsWith("blob:")) {
          URL.revokeObjectURL(oldImg.src);
        }
        svgImageCache.delete(firstKey);
      }
    }
  }

  if (img.complete && img.naturalWidth > 0) {
    const { drawWidth, drawHeight, padDraw } = plan;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const needsTempCanvas =
      (colorStyle && colorStyle.colorMode && colorStyle.colorMode !== "none") ||
      (drawProgress > 0 && drawProgress < 1);

    if (clipRect) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        -drawWidth / 2 + (clipRect.x / svgWidth) * drawWidth,
        -drawHeight / 2 + (clipRect.y / svgHeight) * drawHeight,
        (clipRect.width / svgWidth) * drawWidth,
        (clipRect.height / svgHeight) * drawHeight,
      );
      ctx.clip();
    }

    if (needsTempCanvas) {
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = paddedWidth;
      tempCanvas.height = paddedHeight;
      const tempCtx = tempCanvas.getContext("2d");

      if (tempCtx) {
        tempCtx.drawImage(img, 0, 0, paddedWidth, paddedHeight);

        if (
          colorStyle &&
          colorStyle.colorMode &&
          colorStyle.colorMode !== "none"
        ) {
          if (
            colorStyle.colorMode === "tint" ||
            colorStyle.colorMode === "replace"
          ) {
            tempCtx.globalCompositeOperation = "source-in";
            tempCtx.fillStyle = colorStyle.tintColor || "#ffffff";
            tempCtx.globalAlpha = colorStyle.tintOpacity ?? 1;
            tempCtx.fillRect(0, 0, paddedWidth, paddedHeight);
          }
        }

        if (drawProgress > 0 && drawProgress < 1) {
          const dashLength = Math.max(renderWidth, renderHeight) * 4;
          const offset = dashLength * (1 - drawProgress);
          tempCtx.globalCompositeOperation = "destination-in";
          tempCtx.strokeStyle = "#000";
          tempCtx.lineWidth = Math.max(renderWidth, renderHeight);
          tempCtx.setLineDash([dashLength]);
          tempCtx.lineDashOffset = offset;
          tempCtx.strokeRect(SVG_RASTER_PAD, SVG_RASTER_PAD, renderWidth, renderHeight);
          tempCtx.setLineDash([]);
        }

        ctx.drawImage(
          tempCanvas,
          -(drawWidth / 2 + padDraw),
          -(drawHeight / 2 + padDraw),
          drawWidth + padDraw * 2,
          drawHeight + padDraw * 2,
        );
      }
    } else {
      ctx.drawImage(
        img,
        -(drawWidth / 2 + padDraw),
        -(drawHeight / 2 + padDraw),
        drawWidth + padDraw * 2,
        drawHeight + padDraw * 2,
      );
    }

    if (clipRect) {
      ctx.restore();
    }
  }

  ctx.restore();
};

const renderShapeOnly = (
  ctx: CanvasRenderingContext2D,
  shapeClip: ShapeClip,
  canvasWidth: number,
  canvasHeight: number,
): void => {
  const { shapeType, style, transform } = shapeClip;

  ctx.save();

  const posX = transform.position.x * canvasWidth;
  const posY = transform.position.y * canvasHeight;

  ctx.translate(posX, posY);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.scale.x, transform.scale.y);
  const alpha = transform.opacity * overlayBlendAlpha(shapeClip);
  ctx.globalAlpha = alpha;

  if (style.shadow?.blur && style.shadow.blur > 0) {
    ctx.shadowColor = style.shadow.color || "#000000";
    ctx.shadowBlur = style.shadow.blur;
    ctx.shadowOffsetX = style.shadow.offsetX || 0;
    ctx.shadowOffsetY = style.shadow.offsetY || 0;
  }

  const baseSize = Math.min(canvasWidth, canvasHeight);
  const shapeSize = baseSize * 0.15;
  const halfSize = shapeSize / 2;
  // An authored extent (editing-template overlays) sizes the box in 1080-line units; the anchor sits on the position.
  const box =
    shapeClip.extent && (shapeType === "rectangle" || shapeType === "circle" || shapeType === "ellipse" || shapeType === "line")
      ? { w: (shapeClip.extent.width * baseSize) / 1080, h: (shapeClip.extent.height * baseSize) / 1080 }
      : null;
  const boxX = box ? (0.5 - (transform.anchor?.x ?? 0.5)) * box.w : 0;
  const boxY = box ? (0.5 - (transform.anchor?.y ?? 0.5)) * box.h : 0;

  const strokeScale = baseSize / 1080;
  ctx.fillStyle = style.fill?.color || "#3b82f6";
  ctx.strokeStyle = style.stroke?.color || "#1d4ed8";
  ctx.lineWidth = (style.stroke?.width || 2) * strokeScale;

  if (style.stroke?.dashArray && style.stroke.dashArray.length > 0) {
    ctx.setLineDash(style.stroke.dashArray);
  }

  ctx.beginPath();

  switch (shapeType) {
    case "rectangle": {
      const radius = style.cornerRadius || 0;
      if (box) {
        if (radius > 0) ctx.roundRect(boxX - box.w / 2, boxY - box.h / 2, box.w, box.h, Math.min(radius, box.w / 2, box.h / 2));
        else ctx.rect(boxX - box.w / 2, boxY - box.h / 2, box.w, box.h);
      } else if (radius > 0) {
        ctx.roundRect(-halfSize, -halfSize, shapeSize, shapeSize, Math.min(radius, halfSize));
      } else {
        ctx.rect(-halfSize, -halfSize, shapeSize, shapeSize);
      }
      break;
    }
    case "circle":
    case "ellipse": {
      if (box) ctx.ellipse(boxX, boxY, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
      else ctx.ellipse(0, 0, halfSize, halfSize, 0, 0, Math.PI * 2);
      break;
    }
    case "triangle": {
      ctx.moveTo(0, -halfSize);
      ctx.lineTo(halfSize, halfSize);
      ctx.lineTo(-halfSize, halfSize);
      ctx.closePath();
      break;
    }
    case "star": {
      const points = style.points || 5;
      const innerRadius = (style.innerRadius || 0.5) * halfSize;
      for (let i = 0; i < points * 2; i++) {
        const radius = i % 2 === 0 ? halfSize : innerRadius;
        const angle = (i * Math.PI) / points - Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case "arrow": {
      ctx.moveTo(-halfSize, 0);
      ctx.lineTo(halfSize * 0.3, 0);
      ctx.lineTo(halfSize * 0.3, -halfSize * 0.4);
      ctx.lineTo(halfSize, 0);
      ctx.lineTo(halfSize * 0.3, halfSize * 0.4);
      ctx.lineTo(halfSize * 0.3, 0);
      ctx.closePath();
      break;
    }
    case "line": {
      if (box) {
        ctx.moveTo(boxX - box.w / 2, boxY);
        ctx.lineTo(boxX + box.w / 2, boxY);
      } else {
        ctx.moveTo(-halfSize, 0);
        ctx.lineTo(halfSize, 0);
      }
      break;
    }
    case "path": {
      drawShapePathCentered(ctx, shapeClip, shapeSize);
      break;
    }
    default: {
      ctx.rect(-halfSize, -halfSize, shapeSize, shapeSize);
    }
  }

  ctx.globalAlpha = alpha * (style.fill?.opacity ?? 1);
  ctx.fill();

  if (style.stroke?.width && style.stroke.width > 0) {
    ctx.globalAlpha = alpha * (style.stroke?.opacity ?? 1);
    ctx.stroke();
  }

  ctx.restore();
};

export const renderShapeClipToCanvas = (
  ctx: CanvasRenderingContext2D,
  clip: GraphicClipUnion,
  storedWidth: number,
  canvasHeight: number,
  time: number,
): void | Promise<void> => {
  // Lay out in display space (stored width x PAR), then squeeze into the stored canvas.
  const canvasWidth = displayLayoutWidth(storedWidth, previewSequencePar);
  const clipLocalTime = time - clip.startTime;

  let baseTransform = clip.transform;
  if (clip.keyframes && clip.keyframes.length > 0) {
    baseTransform = getAnimatedTransform(clip.transform, clip.keyframes, clipLocalTime);
  }

  let transformedClip = { ...clip, transform: baseTransform } as GraphicClipUnion;

  if (clip.emphasisAnimation && clip.emphasisAnimation.type !== "none") {
    const emphasisState = applyEmphasisAnimation(
      clip.emphasisAnimation,
      clipLocalTime,
    );
    transformedClip = {
      ...transformedClip,
      transform: {
        ...baseTransform,
        opacity: baseTransform.opacity * emphasisState.opacity,
        scale: {
          x:
            baseTransform.scale.x * emphasisState.scale * emphasisState.scaleX,
          y:
            baseTransform.scale.y * emphasisState.scale * emphasisState.scaleY,
        },
        position: {
          x: baseTransform.position.x + emphasisState.offsetX,
          y: baseTransform.position.y + emphasisState.offsetY,
        },
        rotation: baseTransform.rotation + emphasisState.rotation,
      },
    } as GraphicClipUnion;
  }

  const has3DTransforms =
    transformedClip.transform.rotate3d &&
    (transformedClip.transform.rotate3d.x !== 0 ||
      transformedClip.transform.rotate3d.y !== 0);
  const hasBlendMode =
    transformedClip.blendMode && transformedClip.blendMode !== "normal";
  // Mesh-primitive shapes are inherently 3D, so always route them
  // through the THREE pipeline, even without an explicit rotation.
  const isShape3D =
    transformedClip.type === "shape" &&
    (transformedClip as ShapeClip).shapeType.startsWith("mesh-");

  if (has3DTransforms || hasBlendMode || isShape3D) {
    return getThreeJSRenderer(canvasWidth, canvasHeight).then((renderer) => {
      if (!renderer || renderer !== threeJSRenderer) return;
      renderer.clear();
      let mesh: THREE.Mesh | THREE.Group | null = null;
      if (transformedClip.type === "svg") {
        mesh = renderer.renderSVGClip(
          transformedClip as SVGClip,
          canvasWidth,
          canvasHeight,
        );
      } else if (
        transformedClip.type === "sticker" ||
        transformedClip.type === "emoji"
      ) {
        mesh = renderer.renderStickerClip(
          transformedClip as StickerClip,
          canvasWidth,
          canvasHeight,
        );
      } else {
        mesh = renderer.renderShapeClip(
          transformedClip as ShapeClip,
          canvasWidth,
          canvasHeight,
        );
      }
      if (mesh) {
        renderer.getScene().add(mesh);
        ctx.drawImage(renderer.render(), 0, 0, storedWidth, canvasHeight);
      }
    });
  }

  withDisplaySpace(ctx, storedWidth, previewSequencePar, () => {
    if (transformedClip.type === "svg") {
      renderSVGClip(
        ctx,
        transformedClip as SVGClip,
        canvasWidth,
        canvasHeight,
        time,
      );
    } else if (
      transformedClip.type === "sticker" ||
      transformedClip.type === "emoji"
    ) {
      renderStickerClip(
        ctx,
        transformedClip as StickerClip,
        canvasWidth,
        canvasHeight,
        time,
      );
    } else {
      renderShapeOnly(
        ctx,
        transformedClip as ShapeClip,
        canvasWidth,
        canvasHeight,
      );
    }
  });
};

export const getActiveSubtitles = (
  subtitles: Subtitle[],
  currentTime: number,
): Subtitle[] => {
  return subtitles.filter((sub) => {
    return currentTime >= sub.startTime && currentTime < sub.endTime;
  });
};

export const renderSubtitleToCanvas = (
  ctx: CanvasRenderingContext2D,
  subtitle: Subtitle,
  storedWidth: number,
  canvasHeight: number,
  currentTime?: number,
): void => {
  withDisplaySpace(ctx, storedWidth, previewSequencePar, (canvasWidth) => {
    renderSubtitleInDisplaySpace(ctx, subtitle, canvasWidth, canvasHeight, currentTime);
  });
};

const renderSubtitleInDisplaySpace = (
  ctx: CanvasRenderingContext2D,
  subtitle: Subtitle,
  canvasWidth: number,
  canvasHeight: number,
  currentTime?: number,
): void => {
  const { text, animationStyle, words } = subtitle;
  if (!text || text.trim().length === 0) return;

  const hasAnimation =
    animationStyle && animationStyle !== "none" && words && words.length > 0;
  const time = currentTime ?? subtitle.startTime;

  if (hasAnimation) {
    renderAnimatedSubtitle(ctx, subtitle, canvasWidth, canvasHeight, time);
  } else {
    renderStaticSubtitle(ctx, subtitle, canvasWidth, canvasHeight);
  }
};

const renderStaticSubtitle = (
  ctx: CanvasRenderingContext2D,
  subtitle: Subtitle,
  canvasWidth: number,
  canvasHeight: number,
): void => {
  // Same drawing path as the export renderer.
  drawCaption(ctx, subtitle, canvasWidth, canvasHeight);
};

const renderAnimatedSubtitle = (
  ctx: CanvasRenderingContext2D,
  subtitle: Subtitle,
  canvasWidth: number,
  canvasHeight: number,
  currentTime: number,
): void => {
  const frame = renderAnimatedCaption(subtitle, currentTime);

  if (!frame.visible || frame.segments.length === 0) {
    return;
  }

  ctx.save();

  const style: Partial<SubtitleStyle> = subtitle.style ?? {};
  const fontSize = style.fontSize || DEFAULT_CAPTION_FONT_SIZE;
  const fontFamily = style.fontFamily || "Inter";
  const baseColor = style.color || "#ffffff";

  ctx.font = captionFont(fontSize, fontFamily);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  // Same layout as the export renderer (placement, wrapping, safe margin, cue
  // settings); only the per-word animation is drawn here.
  const layout = layoutCaption(
    subtitle,
    canvasWidth,
    canvasHeight,
    (t) => ctx.measureText(t).width,
    frame.segments.map((s) => s.text).join(" "),
  );
  layout.boxes.forEach((box) => fillCaptionBox(ctx, box, style));

  let segmentIndex = 0;
  for (const line of layout.lines) {
    let xOffset = line.x;
    const wordCount = line.text.split(" ").length;
    const lineSegments = frame.segments.slice(segmentIndex, segmentIndex + wordCount);
    segmentIndex += wordCount;
    for (const segment of lineSegments) {
      const segmentWidth = ctx.measureText(segment.text + " ").width;

      ctx.save();
      ctx.globalAlpha = segment.opacity;

      const centerX = xOffset + ctx.measureText(segment.text).width / 2;
      const centerY = line.y + segment.offsetY;

      ctx.translate(centerX, centerY);
      ctx.scale(segment.scale, segment.scale);
      ctx.translate(-centerX, -centerY);

      const segmentColor = getSegmentColor(segment, baseColor, style.highlightColor);
      drawCaptionText(ctx, segment.text, xOffset, centerY, segmentColor, style);

      ctx.restore();
      xOffset += segmentWidth;
    }
  }

  ctx.restore();
};

const getSegmentColor = (
  segment: WordSegment,
  baseColor: string,
  highlightColor?: string,
): string => {
  if (segment.color) {
    if (segment.color.startsWith("linear-gradient")) {
      return highlightColor || "#ffff00";
    }
    if (segment.color === "transparent") {
      return "rgba(0,0,0,0)";
    }
    return segment.color;
  }

  switch (segment.style) {
    case "highlighted":
    case "active":
      return highlightColor || "#ffff00";
    case "hidden":
      return "rgba(0,0,0,0)";
    default:
      return baseColor;
  }
};

export const drawFrameWithTransform = (
  ctx: CanvasRenderingContext2D,
  frame: ImageBitmap | OffscreenCanvas | HTMLCanvasElement | HTMLVideoElement,
  transform: ClipTransform | undefined,
  canvasWidth: number,
  canvasHeight: number,
  filter?: string,
): void => {
  const t: ClipTransform = {
    ...DEFAULT_TRANSFORM,
    ...transform,
    position: {
      x: transform?.position?.x ?? DEFAULT_TRANSFORM.position.x,
      y: transform?.position?.y ?? DEFAULT_TRANSFORM.position.y,
    },
    scale: {
      x: transform?.scale?.x ?? DEFAULT_TRANSFORM.scale.x,
      y: transform?.scale?.y ?? DEFAULT_TRANSFORM.scale.y,
    },
    anchor: {
      x: transform?.anchor?.x ?? DEFAULT_TRANSFORM.anchor.x,
      y: transform?.anchor?.y ?? DEFAULT_TRANSFORM.anchor.y,
    },
  };

  // A non-square sequence pixel: lay out in display space, then squeeze back to stored pixels (as the export compositor does).
  const layoutWidth = displayLayoutWidth(canvasWidth, previewSequencePar);
  const sequencePar = layoutWidth / canvasWidth;

  if (filter && sequencePar !== 1) {
    // ctx.filter radii are device pixels and ignore the transform, so a blur set under the 1/PAR squeeze runs on stored
    // pixels and is anisotropic once displayed. Draw (and filter) into a display-space layer, then squeeze it, which is
    // what export does (effects run on the display-space frame, then layout squeezes).
    const layer = createDisplayLayer(layoutWidth, canvasHeight);
    if (layer) {
      drawLaidOutFrame(layer.ctx, frame, t, canvasWidth, canvasHeight, layoutWidth, 1, filter);
      ctx.save();
      ctx.globalAlpha = t.opacity ?? 1;
      ctx.drawImage(layer.canvas, 0, 0, canvasWidth, canvasHeight);
      ctx.restore();
      return;
    }
  }

  ctx.save();
  ctx.globalAlpha = t.opacity ?? 1;
  drawLaidOutFrame(ctx, frame, t, canvasWidth, canvasHeight, layoutWidth, sequencePar, filter);
  ctx.restore();
};

const createDisplayLayer = (
  width: number,
  height: number,
): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null => {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      return ctx ? { canvas, ctx } : null;
    }
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      return ctx ? { canvas, ctx } : null;
    }
  } catch {
    return null;
  }
  return null;
};

/** Draws `frame` laid out in a `layoutWidth` x `canvasHeight` space; `sequencePar` > 0 squeezes that space by 1/par into `ctx`. */
const drawLaidOutFrame = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: ImageBitmap | OffscreenCanvas | HTMLCanvasElement | HTMLVideoElement,
  t: ClipTransform,
  canvasWidth: number,
  canvasHeight: number,
  layoutWidth: number,
  sequencePar: number,
  filter?: string,
): void => {
  ctx.save();
  if (filter) {
    ctx.filter = filter;
  }
  if (sequencePar !== 1) ctx.scale(1 / sequencePar, 1);
  const centerX = layoutWidth / 2;
  const centerY = canvasHeight / 2;

  ctx.translate(centerX + t.position.x * sequencePar, centerY + t.position.y);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.scale.x, t.scale.y);

  let sourceWidth: number;
  let sourceHeight: number;
  if (frame instanceof HTMLVideoElement) {
    sourceWidth = frame.videoWidth || canvasWidth;
    sourceHeight = frame.videoHeight || canvasHeight;
  } else {
    sourceWidth = "width" in frame ? frame.width : canvasWidth;
    sourceHeight = "height" in frame ? frame.height : canvasHeight;
  }

  const crop = t.crop;
  const visibleSourceWidth = crop ? crop.width * sourceWidth : sourceWidth;
  const visibleSourceHeight = crop ? crop.height * sourceHeight : sourceHeight;
  const { width: drawWidth, height: drawHeight } =
    resolveCanvasFitDimensions(
      t.fitMode,
      visibleSourceWidth,
      visibleSourceHeight,
      layoutWidth,
      canvasHeight,
    );

  const drawX = -drawWidth * t.anchor.x;
  const drawY = -drawHeight * t.anchor.y;

  const borderRadius = t.borderRadius || 0;
  if (borderRadius > 0) {
    ctx.beginPath();
    const radius = Math.min(borderRadius, drawWidth / 2, drawHeight / 2);
    ctx.roundRect(drawX, drawY, drawWidth, drawHeight, radius);
    ctx.clip();
  }

  if (crop) {
    const sx = crop.x * sourceWidth;
    const sy = crop.y * sourceHeight;

    ctx.drawImage(
      frame,
      sx,
      sy,
      visibleSourceWidth,
      visibleSourceHeight,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
    );
  } else {
    ctx.drawImage(frame, drawX, drawY, drawWidth, drawHeight);
  }

  ctx.restore();
};

export interface PreviewEffectFrame {
  clip: VideoEffectSource & { startTime: number };
  time: number;
}

/**
 * Source colour management first (it is colour interpretation, not a grade, so
 * the ungraded comparison keeps it), then effects and grading. Plain SDR
 * footage has no transform and takes the original path untouched.
 */
export const applyEffectsToFrame = async (
  clipId: string,
  frame: ImageBitmap,
  effectFrame?: PreviewEffectFrame,
): Promise<ImageBitmap> => {
  const transform = inputTransformForClip(clipId);
  if (!transform) return applyEffectsToFrameGraded(clipId, frame, effectFrame);
  let interpreted: ImageBitmap;
  try {
    interpreted = await applyInputTransformToBitmap(frame, transform);
  } catch {
    return applyEffectsToFrameGraded(clipId, frame, effectFrame);
  }
  const graded = await applyEffectsToFrameGraded(clipId, interpreted, effectFrame);
  if (graded !== interpreted) interpreted.close();
  return graded;
};

const applyEffectsToFrameGraded = async (
  clipId: string,
  frame: ImageBitmap,
  effectFrame?: PreviewEffectFrame,
): Promise<ImageBitmap> => {
  // The ungraded comparison reference renders the picture without effects or grading.
  if (isColorBypassed()) return frame;
  let processedFrame = frame;
  const adopt = (next: ImageBitmap | null | undefined) => {
    if (!next || next === processedFrame || next === frame) return;
    if (next.width <= 0 || next.height <= 0) { next.close(); return; }
    if (processedFrame !== frame) processedFrame.close();
    processedFrame = next;
  };
  try {

    const bgEngine = getBackgroundRemovalEngine();
    if (bgEngine && bgEngine.isInitialized()) {
      const settings = bgEngine.getSettings(clipId);
      if (settings.enabled) {
        try {
          const bgResult = await bgEngine.processFrame(
            clipId,
            processedFrame,
            processedFrame.width,
            processedFrame.height,
          );
          adopt(bgResult);
        } catch {}
      }
    }

    const effectsBridge = getEffectsBridge();
    const animated = effectFrame && hasAnimatedVideoEffects(effectFrame.clip)
      ? getAnimatedVideoEffects(effectFrame.clip, effectFrame.time - effectFrame.clip.startTime, currentBurnInSource())
      : null;
    const isInit = effectsBridge.isInitialized();
    if (!isInit) {
      const irisEffects = animated?.filter(effect => effect.type === "mask" && isIrisShape(effect.params.irisShape)) ?? [];
      if (irisEffects.length) {
        const { width, height } = processedFrame;
        if (!irisFallbackCanvas || irisFallbackCanvas.width !== width || irisFallbackCanvas.height !== height) irisFallbackCanvas = new OffscreenCanvas(width, height);
        const maskCtx = irisFallbackCanvas.getContext("2d");
        if (maskCtx) {
          maskCtx.clearRect(0, 0, width, height);
          maskCtx.drawImage(processedFrame, 0, 0);
          for (const effect of irisEffects) applyIrisMaskToContext(maskCtx, effect.params, width, height);
          adopt(await createImageBitmap(irisFallbackCanvas));
        }
      }
      return processedFrame;
    }
    irisFallbackCanvas = null;
    const effects = animated ?? effectsBridge.getEffects(clipId);
    const colorGrading = effectsBridge.getColorGrading(clipId);

    const now = Date.now();
    if (now - lastEffectsLogTime > 5000) {
      lastEffectsLogTime = now;
    }

    const enabledEffects = effects
      .map((effect) => withPreviewOverrides(effectsBridge, effect))
      .filter(isRenderableVideoEffect);
    if (enabledEffects.length > 0) {
      try {
        const effectsResult = animated
          ? { image: await effectsBridge.processEffectList(processedFrame, animated) }
          : await effectsBridge.processEffects(clipId, processedFrame);
        adopt(effectsResult.image);
      } catch {}
    }

    const sampledGrading = effectFrame && hasAnimatedColorGrading(effectFrame.clip)
      ? getAnimatedColorGrading({ keyframes: effectFrame.clip.keyframes, colorGrading }, effectFrame.time - effectFrame.clip.startTime)
      : undefined;
    const sampled = sampledGrading
      ? { tone: sampledGrading.tone, vignette: sampledGrading.vignette, temperature: sampledGrading.temperature, tint: sampledGrading.tint, hueCurves: sampledGrading.hueCurves }
      : undefined;
    if (
      Object.keys(colorGrading).length > 0 || sampled
    ) {
      const effective = { ...colorGrading, ...sampled };
      if (isNeutralColorGrading(effective)) return processedFrame;
      try {
        const colorGradingResult = sampled
          ? await effectsBridge.processColorGrading(clipId, processedFrame, sampled)
          : await effectsBridge.processColorGrading(clipId, processedFrame);
        adopt(colorGradingResult.image);
      } catch {}
    }

    return processedFrame;
  } catch {
    if (processedFrame !== frame) processedFrame.close();
    return frame;
  }
};

export const applyEffectsToFrameCanvas = async (
  clipId: string,
  frame: ImageBitmap,
  effectFrame?: PreviewEffectFrame,
): Promise<OffscreenCanvas | null> => {
  // Sampled stacks use the bitmap path; the cached canvas bridge holds static parameters.
  if (effectFrame && hasAnimatedVideoEffects(effectFrame.clip)) return null;
  // Footage that needs an input transform takes the bitmap path, which applies it first.
  if (inputTransformForClip(clipId)) return null;
  if (isColorBypassed()) return null;
  const bgEngine = getBackgroundRemovalEngine();
  if (
    bgEngine &&
    bgEngine.isInitialized() &&
    bgEngine.getSettings(clipId).enabled
  ) {
    return null;
  }

  const effectsBridge = getEffectsBridge();
  if (!effectsBridge.isInitialized()) {
    return null;
  }

  const colorGrading = effectsBridge.getColorGrading(clipId);
  const gradingActive =
    Object.keys(colorGrading).length > 0 &&
    !isNeutralColorGrading(colorGrading);

  const enabledEffects = effectsBridge
    .getEffects(clipId)
    .filter((e) => e.enabled);
  const effectsActive = enabledEffects.length > 0;

  if (!gradingActive && !effectsActive) {
    return null;
  }

  if (gradingActive && !effectsBridge.gradingYieldsCanvas(clipId)) {
    return null;
  }

  try {
    if (gradingActive) {
      let fxBitmap = frame;
      if (effectsActive) {
        const effectsResult = await effectsBridge.processEffects(
          clipId,
          frame,
        );
        if (
          effectsResult.image &&
          effectsResult.image.width > 0 &&
          effectsResult.image.height > 0
        ) {
          fxBitmap = effectsResult.image;
        }
      }

      try {
        return await effectsBridge.processColorGradingToCanvas(
          clipId,
          fxBitmap,
        );
      } finally {
        if (fxBitmap !== frame) {
          fxBitmap.close();
        }
      }
    }

    return await effectsBridge.processEffectsToCanvas(clipId, frame);
  } catch {
    return null;
  }
};

interface TransitionRenderInfo {
  clipA: {
    id: string;
    startTime: number;
    duration: number;
    mediaId: string;
    inPoint?: number;
    effects?: Effect[];
    keyframes?: Keyframe[];
  };
  clipB: {
    id: string;
    startTime: number;
    duration: number;
    mediaId: string;
    inPoint?: number;
    effects?: Effect[];
    keyframes?: Keyframe[];
  } | null;
  edge?: TransitionEdge;
  transitionId: string;
  progress: number;
}

export const getTransitionAtTime = (
  time: number,
  tracks: Array<{
    id: string;
    type: string;
    clips: Clip[];
  }>,
  isEligibleClip: (clip: Clip) => boolean = () => true,
): TransitionRenderInfo | null => {
  try {
    const transitionBridge = getTransitionBridge();
    if (!transitionBridge.isInitialized()) {
      return null;
    }

    for (const track of tracks) {
      const transitions = transitionBridge.getTransitionsForTrack(track.id);

      for (const transition of transitions) {
        const clipA = track.clips.find((c) => c.id === transition.clipAId);
        const clipB = transition.clipBId
          ? track.clips.find((c) => c.id === transition.clipBId)
          : undefined;

        if (
          !clipA ||
          !isEligibleClip(clipA) ||
          (transition.clipBId && (!clipB || !isEligibleClip(clipB)))
        ) {
          continue;
        }

        if (
          transitionBridge.isTimeInTransition(
            transition,
            clipA as Parameters<typeof transitionBridge.isTimeInTransition>[1],
            time,
          )
        ) {
          const progress = transitionBridge.calculateProgress(
            transition,
            clipA as Parameters<typeof transitionBridge.calculateProgress>[1],
            time,
          );
          return {
            clipA: {
              id: clipA.id,
              startTime: clipA.startTime,
              duration: clipA.duration,
              mediaId: clipA.mediaId,
              inPoint: clipA.inPoint,
              effects: clipA.effects,
              keyframes: clipA.keyframes,
            },
            clipB: clipB
              ? {
                  id: clipB.id,
                  startTime: clipB.startTime,
                  duration: clipB.duration,
                  mediaId: clipB.mediaId,
                  inPoint: clipB.inPoint,
                  effects: clipB.effects,
                  keyframes: clipB.keyframes,
                }
              : null,
            edge: transition.edge,
            transitionId: transition.id,
            progress,
          };
        }
      }
    }

    return null;
  } catch {
    return null;
  }
};

export const renderTransitionFrame = async (
  transitionInfo: TransitionRenderInfo,
  outgoingFrame: ImageBitmap,
  incomingFrame: ImageBitmap,
): Promise<ImageBitmap> => {
  try {
    const transitionBridge = getTransitionBridge();
    if (!transitionBridge.isInitialized()) {
      return transitionInfo.progress < 0.5 ? outgoingFrame : incomingFrame;
    }

    const transition = transitionBridge.getTransition(
      transitionInfo.transitionId,
    );
    if (!transition) {
      return transitionInfo.progress < 0.5 ? outgoingFrame : incomingFrame;
    }

    const result = await transitionBridge.renderTransition(
      outgoingFrame,
      incomingFrame,
      transition,
      transitionInfo.progress,
    );

    if (
      result &&
      result.frame &&
      result.frame.width > 0 &&
      result.frame.height > 0
    ) {
      return result.frame;
    }

    return transitionInfo.progress < 0.5 ? outgoingFrame : incomingFrame;
  } catch {
    return transitionInfo.progress < 0.5 ? outgoingFrame : incomingFrame;
  }
};

export const renderTransitionCanvas = async (
  transitionInfo: TransitionRenderInfo,
  outgoingFrame: globalThis.CanvasImageSource,
  incomingFrame: globalThis.CanvasImageSource,
): Promise<globalThis.CanvasImageSource> => {
  try {
    const transitionBridge = getTransitionBridge();
    if (!transitionBridge.isInitialized()) {
      return transitionInfo.progress < 0.5 ? outgoingFrame : incomingFrame;
    }

    const transition = transitionBridge.getTransition(
      transitionInfo.transitionId,
    );
    if (!transition) {
      return transitionInfo.progress < 0.5 ? outgoingFrame : incomingFrame;
    }

    const canvas = await transitionBridge.renderTransitionToCanvas(
      outgoingFrame,
      incomingFrame,
      transition,
      transitionInfo.progress,
    );

    if (canvas && canvas.width > 0 && canvas.height > 0) {
      return canvas;
    }

    return transitionInfo.progress < 0.5 ? outgoingFrame : incomingFrame;
  } catch {
    return transitionInfo.progress < 0.5 ? outgoingFrame : incomingFrame;
  }
};
