import type { Transform, Keyframe } from "../types/timeline";
import type {
  TextClip,
  TextStyle,
  TextAnimation,
  TextRenderResult,
  TextMetrics,
  TextLineMetrics,
} from "./types";
import { DEFAULT_TEXT_STYLE, DEFAULT_TEXT_TRANSFORM } from "./types";
import { textAnimationEngine } from "./text-animation";

export interface CreateTextClipOptions {
  id?: string;
  trackId: string;
  startTime: number;
  duration?: number;
  text: string;
  style?: Partial<TextStyle>;
  transform?: Partial<Transform>;
  animation?: TextAnimation;
}

export interface UpdateTextClipOptions {
  text?: string;
  style?: Partial<TextStyle>;
  transform?: Partial<Transform>;
  startTime?: number;
  duration?: number;
  animation?: TextAnimation;
  keyframes?: Keyframe[];
  blendMode?: import("../video/types").BlendMode;
  blendOpacity?: number;
  emphasisAnimation?: import("../graphics/types").EmphasisAnimation;
  behindSubject?: boolean;
}

export class TitleEngine {
  private textClips: Map<string, TextClip> = new Map();
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private ctx:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null = null;

  initialize(width: number = 1920, height: number = 1080): void {
    if (typeof OffscreenCanvas !== "undefined") {
      this.canvas = new OffscreenCanvas(width, height);
    } else {
      this.canvas = document.createElement("canvas");
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.ctx = this.canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D;
  }

  createTextClip(options: CreateTextClipOptions): TextClip {
    const id = options.id || this.generateId();

    const style: TextStyle = {
      ...DEFAULT_TEXT_STYLE,
      ...options.style,
    };

    const transform: Transform = {
      ...DEFAULT_TEXT_TRANSFORM,
      ...options.transform,
    };

    const textClip: TextClip = {
      id,
      trackId: options.trackId,
      startTime: options.startTime,
      duration: options.duration ?? 5, // Default 5 seconds
      text: options.text,
      style,
      transform,
      animation: options.animation,
      keyframes: [],
    };

    this.textClips.set(id, textClip);
    return textClip;
  }

  getTextClip(id: string): TextClip | undefined {
    return this.textClips.get(id);
  }

  getAllTextClips(): TextClip[] {
    return Array.from(this.textClips.values());
  }

  getTextClipsForTrack(trackId: string): TextClip[] {
    return Array.from(this.textClips.values()).filter(
      (clip) => clip.trackId === trackId,
    );
  }

  updateTextClip(
    id: string,
    updates: UpdateTextClipOptions,
  ): TextClip | undefined {
    const existing = this.textClips.get(id);
    if (!existing) {
      return undefined;
    }

    const updatedClip: TextClip = {
      ...existing,
      text: updates.text ?? existing.text,
      startTime: updates.startTime ?? existing.startTime,
      duration: updates.duration ?? existing.duration,
      style: updates.style
        ? { ...existing.style, ...updates.style }
        : existing.style,
      transform: updates.transform
        ? { ...existing.transform, ...updates.transform }
        : existing.transform,
      animation: updates.animation ?? existing.animation,
      keyframes: updates.keyframes ?? existing.keyframes,
      blendMode: updates.blendMode ?? existing.blendMode,
      blendOpacity: updates.blendOpacity ?? existing.blendOpacity,
      emphasisAnimation:
        updates.emphasisAnimation ?? existing.emphasisAnimation,
      behindSubject:
        updates.behindSubject ?? existing.behindSubject,
    };

    this.textClips.set(id, updatedClip);
    return updatedClip;
  }

  updateText(id: string, text: string): TextClip | undefined {
    return this.updateTextClip(id, { text });
  }

  updateStyle(id: string, style: Partial<TextStyle>): TextClip | undefined {
    return this.updateTextClip(id, { style });
  }

  updatePosition(
    id: string,
    position: { x: number; y: number },
  ): TextClip | undefined {
    return this.updateTextClip(id, {
      transform: { position },
    });
  }

  deleteTextClip(id: string): boolean {
    return this.textClips.delete(id);
  }

  addKeyframe(clipId: string, keyframe: Keyframe): TextClip | undefined {
    const clip = this.textClips.get(clipId);
    if (!clip) {
      return undefined;
    }
    const existingIndex = clip.keyframes.findIndex(
      (kf) => kf.time === keyframe.time && kf.property === keyframe.property,
    );

    let newKeyframes: Keyframe[];
    if (existingIndex >= 0) {
      newKeyframes = [...clip.keyframes];
      newKeyframes[existingIndex] = keyframe;
    } else {
      newKeyframes = [...clip.keyframes, keyframe].sort(
        (a, b) => a.time - b.time,
      );
    }

    const updatedClip: TextClip = {
      ...clip,
      keyframes: newKeyframes,
    };

    this.textClips.set(clipId, updatedClip);
    return updatedClip;
  }

  removeKeyframe(clipId: string, keyframeId: string): TextClip | undefined {
    const clip = this.textClips.get(clipId);
    if (!clip) {
      return undefined;
    }

    const updatedClip: TextClip = {
      ...clip,
      keyframes: clip.keyframes.filter((kf) => kf.id !== keyframeId),
    };

    this.textClips.set(clipId, updatedClip);
    return updatedClip;
  }

  renderText(
    clip: TextClip,
    width: number,
    height: number,
    time: number = 0,
  ): TextRenderResult {
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(width, height);
    } else {
      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
    }
    ctx = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D;

    ctx.clearRect(0, 0, width, height);

    const animatedState = textAnimationEngine.getAnimatedState(clip, time);
    let { opacity, transform, style, visibleText, characterStates } =
      animatedState;

    if (clip.emphasisAnimation && clip.emphasisAnimation.type !== "none") {
      const emphasisState = this.applyEmphasisAnimation(
        clip.emphasisAnimation,
        time,
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

    if (opacity <= 0 || visibleText.length === 0) {
      return {
        canvas,
        width,
        height,
        textMetrics: this.measureText("", clip.style, width),
      };
    }

    const metrics = this.measureText(visibleText, style, width);

    ctx.save();

    const posX = transform.position.x * width;
    const posY = transform.position.y * height;

    ctx.translate(posX, posY);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(transform.scale.x, transform.scale.y);
    ctx.globalAlpha = opacity;

    this.applyTextStyle(ctx, style);

    const lines = visibleText.split("\n");
    const lineHeight = style.fontSize * style.lineHeight;
    const totalHeight = lines.length * lineHeight;
    let startY = -totalHeight / 2 + lineHeight / 2;

    if (style.verticalAlign === "top") {
      startY = 0;
    } else if (style.verticalAlign === "bottom") {
      startY = -totalHeight;
    }

    if (style.backgroundColor) {
      const bgWidth = metrics.width + 20;
      const bgHeight = totalHeight;
      ctx.fillStyle = style.backgroundColor;
      ctx.fillRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight);
    }

    if (characterStates && characterStates.length > 0) {
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
          const lineMetrics = ctx.measureText(line);
          const bgWidth = lineMetrics.width + 20;
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

    return {
      canvas,
      width,
      height,
      textMetrics: metrics,
    };
  }

  measureText(text: string, style: TextStyle, maxWidth?: number): TextMetrics {
    if (!this.ctx) {
      this.initialize();
    }

    const ctx = this.ctx!;
    this.applyTextStyle(ctx, style);

    const lines = this.wrapText(text, style, maxWidth);
    const lineHeight = style.fontSize * style.lineHeight;

    const lineMetrics: TextLineMetrics[] = lines.map((lineText) => {
      const measured = ctx.measureText(lineText);
      return {
        text: lineText,
        width: measured.width,
        height: lineHeight,
        baseline: style.fontSize * 0.8, // Approximate baseline
      };
    });

    const totalWidth = Math.max(...lineMetrics.map((l) => l.width));
    const totalHeight = lineMetrics.reduce((sum, l) => sum + l.height, 0);

    return {
      width: totalWidth,
      height: totalHeight,
      lines: lineMetrics,
    };
  }

  private wrapText(
    text: string,
    style: TextStyle,
    maxWidth?: number,
  ): string[] {
    if (!maxWidth) {
      return text.split("\n");
    }

    if (!this.ctx) {
      this.initialize();
    }

    const ctx = this.ctx!;
    this.applyTextStyle(ctx, style);

    const paragraphs = text.split("\n");
    const lines: string[] = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.split(" ");
      let currentLine = "";

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const metrics = ctx.measureText(testLine);

        if (metrics.width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        lines.push(currentLine);
      }
    }

    return lines.length > 0 ? lines : [""];
  }

  private applyTextStyle(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    style: TextStyle,
  ): void {
    const fontWeight =
      typeof style.fontWeight === "number"
        ? style.fontWeight.toString()
        : style.fontWeight;

    ctx.font = `${style.fontStyle} ${fontWeight} ${style.fontSize}px "${style.fontFamily}"`;
    ctx.fillStyle = style.color;
    ctx.textAlign = style.textAlign as CanvasTextAlign;
    ctx.textBaseline = "middle";
    if (style.shadowColor) {
      ctx.shadowColor = style.shadowColor;
      ctx.shadowBlur = style.shadowBlur ?? 0;
      ctx.shadowOffsetX = style.shadowOffsetX ?? 0;
      ctx.shadowOffsetY = style.shadowOffsetY ?? 0;
    } else {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
    if ("letterSpacing" in ctx && style.letterSpacing !== 0) {
      (ctx as CanvasRenderingContext2D).letterSpacing =
        `${style.letterSpacing}px`;
    }
  }

  private generateId(): string {
    return `text-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  clear(): void {
    this.textClips.clear();
  }

  loadTextClips(clips: TextClip[]): void {
    this.textClips.clear();
    for (const clip of clips) {
      this.textClips.set(clip.id, clip);
    }
  }

  exportTextClips(): TextClip[] {
    return Array.from(this.textClips.values());
  }

  private applyEmphasisAnimation(
    animation: import("../graphics/types").EmphasisAnimation,
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
        const waveY = Math.sin(t + adjustedTime * 2) * 0.03 * intensity;
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
  }
}
export const titleEngine = new TitleEngine();
