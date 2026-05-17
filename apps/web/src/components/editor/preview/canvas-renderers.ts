import {
  textAnimationEngine,
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
} from "@openreel/core";
import * as THREE from "three";

type GraphicClipUnion = ShapeClip | SVGClip | StickerClip;
import { getEffectsBridge } from "../../../bridges/effects-bridge";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import type { ClipTransform } from "./types";
import { DEFAULT_TRANSFORM } from "./types";
import { ThreeJSLayerRenderer } from "./threejs-layer-renderer";

let lastEffectsLogTime = 0;
let threeJSRenderer: ThreeJSLayerRenderer | null = null;
const animationEngine = new AnimationEngine();

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

const fontLoadingPromises = new Map<string, Promise<void>>();

const ensureFontLoaded = async (
  fontFamily: string,
  fontSize: number,
): Promise<void> => {
  const fontKey = `${fontSize}px "${fontFamily}"`;

  if (!fontLoadingPromises.has(fontKey)) {
    const loadPromise = document.fonts.load(fontKey).then(() => {});
    fontLoadingPromises.set(fontKey, loadPromise);
    setTimeout(() => fontLoadingPromises.delete(fontKey), 30000);
  }

  try {
    await Promise.race([
      fontLoadingPromises.get(fontKey),
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
  } catch {
    // Font load failed, continue with fallback
  }
};

export const renderTextClipToCanvas = (
  ctx: CanvasRenderingContext2D,
  textClip: TextClip,
  canvasWidth: number,
  canvasHeight: number,
  time: number,
): void => {
  const clipLocalTime = time - textClip.startTime;
  const animatedState = textAnimationEngine.getAnimatedState(
    textClip,
    clipLocalTime,
  );
  let { opacity, transform, style, visibleText, characterStates } =
    animatedState;

  if (opacity <= 0 || visibleText.length === 0) {
    return;
  }

  if (
    textClip.emphasisAnimation &&
    textClip.emphasisAnimation.type !== "none"
  ) {
    const emphasisState = applyEmphasisAnimation(
      textClip.emphasisAnimation,
      clipLocalTime,
    );
    opacity = opacity * emphasisState.opacity;
    transform = {
      ...transform,
      scale: {
        x: transform.scale.x * emphasisState.scale * emphasisState.scaleX,
        y: transform.scale.y * emphasisState.scale * emphasisState.scaleY,
      },
      position: {
        x: transform.position.x + emphasisState.offsetX,
        y: transform.position.y + emphasisState.offsetY,
      },
      rotation: transform.rotation + emphasisState.rotation,
    };
  }

  // 3D transforms or blend modes require THREE.js rendering since Canvas 2D can't support them
  // This ensures proper perspective and blending that Canvas 2D doesn't natively support
  const has3DTransforms =
    transform.rotate3d &&
    (transform.rotate3d.x !== 0 || transform.rotate3d.y !== 0);
  const hasBlendMode = textClip.blendMode && textClip.blendMode !== "normal";

  if (has3DTransforms || hasBlendMode) {
    // Lazy-initialize THREE.js renderer (reused for all 3D text rendering)
    if (!threeJSRenderer) {
      threeJSRenderer = new ThreeJSLayerRenderer(canvasWidth, canvasHeight);
    }

    if (
      threeJSRenderer.canvas.width !== canvasWidth ||
      threeJSRenderer.canvas.height !== canvasHeight
    ) {
      threeJSRenderer.resize(canvasWidth, canvasHeight);
    }

    threeJSRenderer.clear();

    const animatedTextClip: TextClip = {
      ...textClip,
      text: visibleText,
      style: style,
      transform: {
        ...transform,
        opacity: opacity,
      },
    };

    const mesh = threeJSRenderer.renderTextClip(
      animatedTextClip,
      canvasWidth,
      canvasHeight,
    );
    if (mesh) {
      threeJSRenderer.getScene().add(mesh);
      const threeCanvas = threeJSRenderer.render();
      ctx.drawImage(threeCanvas, 0, 0);
    }
    return;
  }

  ensureFontLoaded(style.fontFamily, style.fontSize);

  ctx.save();

  const posX = transform.position.x * canvasWidth;
  const posY = transform.position.y * canvasHeight;

  ctx.translate(posX, posY);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.scale.x, transform.scale.y);
  ctx.globalAlpha = opacity;

  const fontWeight =
    typeof style.fontWeight === "number"
      ? style.fontWeight
      : style.fontWeight === "bold"
        ? 700
        : 400;
  ctx.font = `${style.fontStyle} ${fontWeight} ${style.fontSize}px "${style.fontFamily}"`;
  ctx.textAlign = style.textAlign as CanvasTextAlign;
  ctx.textBaseline = "middle";

  if (style.shadowColor && style.shadowBlur) {
    ctx.shadowColor = style.shadowColor;
    ctx.shadowBlur = style.shadowBlur;
    ctx.shadowOffsetX = style.shadowOffsetX || 0;
    ctx.shadowOffsetY = style.shadowOffsetY || 0;
  }

  const lines = visibleText.split("\n");
  const lineHeight = style.fontSize * style.lineHeight;
  const totalHeight = lines.length * lineHeight;
  let startY = -totalHeight / 2 + lineHeight / 2;

  if (style.verticalAlign === "top") {
    startY = 0;
  } else if (style.verticalAlign === "bottom") {
    startY = -totalHeight;
  }

  if (characterStates && characterStates.length > 0) {
    // Render text with per-character animations (rotation, scale, opacity, offset)
    // Each character is transformed around its center before drawing
    let charIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const y = startY + i * lineHeight;
      let xOffset = 0;

      const lineWidth = ctx.measureText(line).width;
      const startX =
        style.textAlign === "center"
          ? -lineWidth / 2
          : style.textAlign === "right"
            ? -lineWidth
            : 0;

      for (const char of line) {
        if (charIdx < characterStates.length) {
          const charState = characterStates[charIdx];
          const charWidth = ctx.measureText(char).width;

          ctx.save();
          ctx.globalAlpha = opacity * charState.opacity;
          // Translate to character center, apply transforms, then draw at origin
          ctx.translate(
            startX + xOffset + charState.offsetX + charWidth / 2,
            y + charState.offsetY,
          );
          ctx.rotate((charState.rotation * Math.PI) / 180);
          ctx.scale(charState.scale, charState.scale);

          if (style.strokeColor && style.strokeWidth) {
            ctx.strokeStyle = style.strokeColor;
            ctx.lineWidth = style.strokeWidth;
            ctx.strokeText(char, 0, 0);
          }
          ctx.fillStyle = style.color;
          ctx.fillText(char, 0, 0);
          ctx.restore();

          xOffset += charWidth;
        }
        charIdx++;
      }
      charIdx++;
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const y = startY + i * lineHeight;

      if (style.backgroundColor) {
        const metrics = ctx.measureText(line);
        const bgWidth = metrics.width + 20;
        const bgHeight = lineHeight;
        ctx.fillStyle = style.backgroundColor;
        ctx.fillRect(-bgWidth / 2, y - bgHeight / 2, bgWidth, bgHeight);
      }

      if (style.strokeColor && style.strokeWidth) {
        ctx.strokeStyle = style.strokeColor;
        ctx.lineWidth = style.strokeWidth;
        ctx.strokeText(line, 0, y);
      }

      ctx.fillStyle = style.color;
      ctx.fillText(line, 0, y);
    }
  }

  ctx.restore();
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

const wrapSVGWithTransparentPadding = (
  svgContent: string,
  width: number,
  height: number,
  padding: number,
  viewBox?: { minX: number; minY: number; width: number; height: number },
): string => {
  if (padding <= 0) {
    return svgContent;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, "image/svg+xml");
  const svgEl = doc.querySelector("svg");

  if (!svgEl) {
    return svgContent;
  }

  const vbMinX = viewBox?.minX ?? 0;
  const vbMinY = viewBox?.minY ?? 0;
  const vbWidth = viewBox?.width ?? width;
  const vbHeight = viewBox?.height ?? height;

  const padX = (padding / width) * vbWidth;
  const padY = (padding / height) * vbHeight;

  const paddedWidth = width + padding * 2;
  const paddedHeight = height + padding * 2;

  svgEl.setAttribute("width", String(paddedWidth));
  svgEl.setAttribute("height", String(paddedHeight));
  svgEl.setAttribute(
    "viewBox",
    `${vbMinX - padX} ${vbMinY - padY} ${vbWidth + padX * 2} ${vbHeight + padY * 2}`,
  );
  svgEl.setAttribute("overflow", "visible");

  return new XMLSerializer().serializeToString(svgEl);
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
  ctx.globalAlpha = animatedTransform.opacity;

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

  const posX = Math.round(transform.position.x * canvasWidth);
  const posY = Math.round(transform.position.y * canvasHeight);

  let animationScale = { x: transform.scale.x, y: transform.scale.y };
  let animationOpacity = transform.opacity;
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
    posX + Math.round(animationTranslateX),
    posY + Math.round(animationTranslateY),
  );
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(animationScale.x, animationScale.y);
  ctx.globalAlpha = animationOpacity;

  const svgWidth = viewBox?.width || 200;
  const svgHeight = viewBox?.height || 200;
  const svgAspect = svgWidth / svgHeight;
  const maxScale = Math.max(
    Math.abs(animationScale.x),
    Math.abs(animationScale.y),
    1,
  );
  const scaleBucket = Math.ceil(maxScale * 2) / 2;

  let renderWidth: number;
  let renderHeight: number;
  if (svgAspect > 1) {
    renderWidth = Math.ceil(canvasWidth * scaleBucket);
    renderHeight = Math.ceil(renderWidth / svgAspect);
  } else {
    renderHeight = Math.ceil(canvasHeight * scaleBucket);
    renderWidth = Math.ceil(renderHeight * svgAspect);
  }

  const svgPad = 16;
  const paddedWidth = renderWidth + svgPad * 2;
  const paddedHeight = renderHeight + svgPad * 2;
  const cacheKey = `${svgClip.id}_${renderWidth}x${renderHeight}`;
  let img = svgImageCache.get(cacheKey);

  if (!img) {
    const scaledContent = wrapSVGWithTransparentPadding(
      svgContent,
      renderWidth,
      renderHeight,
      svgPad,
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
    const drawWidth = renderWidth / scaleBucket;
    const drawHeight = renderHeight / scaleBucket;
    const padDraw = svgPad / scaleBucket;

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
          tempCtx.strokeRect(svgPad, svgPad, renderWidth, renderHeight);
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
  ctx.globalAlpha = transform.opacity;

  if (style.shadow?.blur && style.shadow.blur > 0) {
    ctx.shadowColor = style.shadow.color || "#000000";
    ctx.shadowBlur = style.shadow.blur;
    ctx.shadowOffsetX = style.shadow.offsetX || 0;
    ctx.shadowOffsetY = style.shadow.offsetY || 0;
  }

  const baseSize = Math.min(canvasWidth, canvasHeight);
  const shapeSize = baseSize * 0.15;
  const halfSize = shapeSize / 2;

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
      if (radius > 0) {
        ctx.roundRect(
          -halfSize,
          -halfSize,
          shapeSize,
          shapeSize,
          Math.min(radius, halfSize),
        );
      } else {
        ctx.rect(-halfSize, -halfSize, shapeSize, shapeSize);
      }
      break;
    }
    case "circle":
    case "ellipse": {
      ctx.ellipse(0, 0, halfSize, halfSize, 0, 0, Math.PI * 2);
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
      ctx.moveTo(-halfSize, 0);
      ctx.lineTo(halfSize, 0);
      break;
    }
    default: {
      ctx.rect(-halfSize, -halfSize, shapeSize, shapeSize);
    }
  }

  ctx.globalAlpha = transform.opacity * (style.fill?.opacity ?? 1);
  ctx.fill();

  if (style.stroke?.width && style.stroke.width > 0) {
    ctx.globalAlpha = transform.opacity * (style.stroke?.opacity ?? 1);
    ctx.stroke();
  }

  ctx.restore();
};

export const renderShapeClipToCanvas = (
  ctx: CanvasRenderingContext2D,
  clip: GraphicClipUnion,
  canvasWidth: number,
  canvasHeight: number,
  time: number,
): void => {
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

  if (has3DTransforms || hasBlendMode) {
    if (!threeJSRenderer) {
      threeJSRenderer = new ThreeJSLayerRenderer(canvasWidth, canvasHeight);
    }

    if (
      threeJSRenderer.canvas.width !== canvasWidth ||
      threeJSRenderer.canvas.height !== canvasHeight
    ) {
      threeJSRenderer.resize(canvasWidth, canvasHeight);
    }

    threeJSRenderer.clear();

    let mesh: THREE.Mesh | null = null;
    if (transformedClip.type === "svg") {
      mesh = threeJSRenderer.renderSVGClip(
        transformedClip as SVGClip,
        canvasWidth,
        canvasHeight,
      );
    } else if (
      transformedClip.type === "sticker" ||
      transformedClip.type === "emoji"
    ) {
      mesh = threeJSRenderer.renderStickerClip(
        transformedClip as StickerClip,
        canvasWidth,
        canvasHeight,
      );
    } else {
      mesh = threeJSRenderer.renderShapeClip(
        transformedClip as ShapeClip,
        canvasWidth,
        canvasHeight,
      );
    }

    if (mesh) {
      threeJSRenderer.getScene().add(mesh);
      const threeCanvas = threeJSRenderer.render();
      ctx.drawImage(threeCanvas, 0, 0);
    }
    return;
  }

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
  const { text, style } = subtitle;

  ctx.save();

  const fontSize = style?.fontSize || 24;
  const fontFamily = style?.fontFamily || "Inter";
  const color = style?.color || "#ffffff";
  const backgroundColor = style?.backgroundColor || "rgba(0, 0, 0, 0.7)";
  const position = style?.position || "bottom";

  ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = text.split("\n");
  const lineHeight = fontSize * 1.3;
  const totalHeight = lines.length * lineHeight;

  let baseY: number;
  if (position === "top") {
    baseY = fontSize * 2;
  } else if (position === "center") {
    baseY = canvasHeight / 2 - totalHeight / 2;
  } else {
    baseY = canvasHeight - fontSize * 2 - totalHeight;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;

    const y = baseY + i * lineHeight + lineHeight / 2;
    const metrics = ctx.measureText(line);
    const bgWidth = metrics.width + 20;
    const bgHeight = lineHeight;

    ctx.fillStyle = backgroundColor;
    ctx.fillRect(
      canvasWidth / 2 - bgWidth / 2,
      y - bgHeight / 2,
      bgWidth,
      bgHeight,
    );

    ctx.fillStyle = color;
    ctx.fillText(line, canvasWidth / 2, y);
  }

  ctx.restore();
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

  const style = subtitle.style;
  const fontSize = style?.fontSize || 24;
  const fontFamily = style?.fontFamily || "Inter";
  const baseColor = style?.color || "#ffffff";
  const backgroundColor = style?.backgroundColor || "rgba(0, 0, 0, 0.7)";
  const position = style?.position || "bottom";

  ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  ctx.textBaseline = "middle";

  const lineHeight = fontSize * 1.3;

  let baseY: number;
  if (position === "top") {
    baseY = fontSize * 2 + lineHeight / 2;
  } else if (position === "center") {
    baseY = canvasHeight / 2;
  } else {
    baseY = canvasHeight - fontSize * 2 - lineHeight / 2;
  }

  const totalText = frame.segments.map((s) => s.text).join(" ");
  const totalWidth = ctx.measureText(totalText).width;
  const bgWidth = totalWidth + 30;
  const bgHeight = lineHeight + 10;

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(
    canvasWidth / 2 - bgWidth / 2,
    baseY - bgHeight / 2,
    bgWidth,
    bgHeight,
  );

  let xOffset = canvasWidth / 2 - totalWidth / 2;

  for (const segment of frame.segments) {
    const segmentWidth = ctx.measureText(segment.text + " ").width;

    ctx.save();
    ctx.globalAlpha = segment.opacity;

    const centerX = xOffset + ctx.measureText(segment.text).width / 2;
    const centerY = baseY + segment.offsetY;

    ctx.translate(centerX, centerY);
    ctx.scale(segment.scale, segment.scale);
    ctx.translate(-centerX, -centerY);

    const segmentColor = getSegmentColor(
      segment,
      baseColor,
      style?.highlightColor,
    );
    ctx.fillStyle = segmentColor;
    ctx.textAlign = "left";
    ctx.fillText(segment.text, xOffset, baseY + segment.offsetY);

    ctx.restore();

    xOffset += segmentWidth;
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

  ctx.save();
  ctx.globalAlpha = t.opacity ?? 1;

  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  ctx.translate(centerX + t.position.x, centerY + t.position.y);
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

  // Calculate draw size to fit frame within canvas while preserving aspect ratio (contain)
  const sourceAspect = sourceWidth / sourceHeight;
  const canvasAspect = canvasWidth / canvasHeight;

  let drawWidth: number;
  let drawHeight: number;

  if (sourceAspect > canvasAspect) {
    drawWidth = canvasWidth;
    drawHeight = canvasWidth / sourceAspect;
  } else {
    drawHeight = canvasHeight;
    drawWidth = canvasHeight * sourceAspect;
  }

  const drawX = -drawWidth * t.anchor.x;
  const drawY = -drawHeight * t.anchor.y;

  const borderRadius = t.borderRadius || 0;
  if (borderRadius > 0) {
    ctx.beginPath();
    const radius = Math.min(borderRadius, drawWidth / 2, drawHeight / 2);
    ctx.roundRect(drawX, drawY, drawWidth, drawHeight, radius);
    ctx.clip();
  }

  if (t.crop) {
    const sx = t.crop.x * sourceWidth;
    const sy = t.crop.y * sourceHeight;
    const sWidth = t.crop.width * sourceWidth;
    const sHeight = t.crop.height * sourceHeight;

    const croppedAspect = sWidth / sHeight;
    let cropDrawWidth: number;
    let cropDrawHeight: number;

    if (croppedAspect > canvasAspect) {
      cropDrawWidth = canvasWidth;
      cropDrawHeight = canvasWidth / croppedAspect;
    } else {
      cropDrawHeight = canvasHeight;
      cropDrawWidth = canvasHeight * croppedAspect;
    }

    const cropDrawX = -cropDrawWidth * t.anchor.x;
    const cropDrawY = -cropDrawHeight * t.anchor.y;

    ctx.drawImage(
      frame,
      sx,
      sy,
      sWidth,
      sHeight,
      cropDrawX,
      cropDrawY,
      cropDrawWidth,
      cropDrawHeight,
    );
  } else {
    ctx.drawImage(frame, drawX, drawY, drawWidth, drawHeight);
  }

  ctx.restore();
};

export const applyEffectsToFrame = async (
  clipId: string,
  frame: ImageBitmap,
): Promise<ImageBitmap> => {
  try {
    let processedFrame = frame;

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
          if (bgResult && bgResult.width > 0 && bgResult.height > 0) {
            processedFrame = bgResult;
          }
        } catch {}
      }
    }

    const effectsBridge = getEffectsBridge();
    const isInit = effectsBridge.isInitialized();
    if (!isInit) {
      return processedFrame;
    }

    const effects = effectsBridge.getEffects(clipId);
    const colorGrading = effectsBridge.getColorGrading(clipId);

    const now = Date.now();
    if (now - lastEffectsLogTime > 5000) {
      lastEffectsLogTime = now;
    }

    const enabledEffects = effects.filter((e) => e.enabled);
    if (enabledEffects.length > 0) {
      try {
        const effectsResult = await effectsBridge.processEffects(
          clipId,
          processedFrame,
        );
        if (
          effectsResult.image &&
          effectsResult.image.width > 0 &&
          effectsResult.image.height > 0
        ) {
          processedFrame = effectsResult.image;
        }
      } catch {}
    }

    if (Object.keys(colorGrading).length > 0) {
      try {
        const colorGradingResult = await effectsBridge.processColorGrading(
          clipId,
          processedFrame,
        );
        if (
          colorGradingResult.image &&
          colorGradingResult.image.width > 0 &&
          colorGradingResult.image.height > 0
        ) {
          processedFrame = colorGradingResult.image;
        }
      } catch {}
    }

    return processedFrame;
  } catch {
    return frame;
  }
};

export interface TransitionRenderInfo {
  clipA: {
    id: string;
    startTime: number;
    duration: number;
    mediaId: string;
    inPoint?: number;
  };
  clipB: {
    id: string;
    startTime: number;
    duration: number;
    mediaId: string;
    inPoint?: number;
  };
  transitionId: string;
  progress: number;
}

export const getTransitionAtTime = (
  time: number,
  tracks: Array<{
    id: string;
    type: string;
    clips: Array<{
      id: string;
      startTime: number;
      duration: number;
      mediaId: string;
      inPoint?: number;
    }>;
  }>,
): TransitionRenderInfo | null => {
  try {
    const transitionBridge = getTransitionBridge();
    if (!transitionBridge.isInitialized()) {
      return null;
    }

    const videoTracks = tracks.filter(
      (t) => t.type === "video" || t.type === "image",
    );

    for (const track of videoTracks) {
      const transitions = transitionBridge.getTransitionsForTrack(track.id);

      for (const transition of transitions) {
        const clipA = track.clips.find((c) => c.id === transition.clipAId);
        const clipB = track.clips.find((c) => c.id === transition.clipBId);

        if (!clipA || !clipB) continue;

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
            },
            clipB: {
              id: clipB.id,
              startTime: clipB.startTime,
              duration: clipB.duration,
              mediaId: clipB.mediaId,
              inPoint: clipB.inPoint,
            },
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
