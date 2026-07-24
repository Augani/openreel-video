import type { Transform } from "../types/timeline";
import type {
  TextClip,
  TextAnimation,
  TextAnimationPreset,
  TextAnimationParams,
  TextStyle,
} from "./types";
import { AnimationEngine } from "../video/animation-engine";

export interface AnimatedTextState {
  readonly opacity: number;
  readonly transform: Transform;
  readonly style: TextStyle;
  readonly visibleText: string;
  readonly characterStates?: CharacterAnimationState[];
}

export interface CharacterAnimationState {
  readonly char: string;
  readonly index: number;
  readonly opacity: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scale: number;
  readonly rotation: number;
}

export class TextAnimationEngine {
  private animationEngine: AnimationEngine;

  constructor() {
    this.animationEngine = new AnimationEngine();
  }

  getAnimatedState(clip: TextClip, time: number): AnimatedTextState {
    const { animation, style, transform, text, keyframes } = clip;

    // First check for keyframe-based animations (entry/exit transitions)
    if (keyframes && keyframes.length > 0) {
      return this.applyKeyframeAnimation(clip, time);
    }
    if (!animation || animation.preset === "none") {
      return {
        opacity: transform.opacity,
        transform,
        style,
        visibleText: text,
      };
    }
    const duration = clip.duration;
    const inDuration = animation.inDuration;
    const outDuration = animation.outDuration;
    const holdEnd = duration - outDuration;

    let inProgress = 1;
    let outProgress = 0;

    if (time < inDuration) {
      inProgress = inDuration > 0 ? time / inDuration : 1;
    }

    if (time > holdEnd && outDuration > 0) {
      outProgress = (time - holdEnd) / outDuration;
    }
    const easing = animation.params.easing ?? "ease-out";
    const easedInProgress = this.animationEngine.applyEasing(
      inProgress,
      easing,
    );
    const easedOutProgress = this.animationEngine.applyEasing(
      outProgress,
      easing,
    );
    return this.applyPreset(
      clip,
      animation.preset,
      animation.params,
      easedInProgress,
      easedOutProgress,
      time,
    );
  }

  private applyKeyframeAnimation(
    clip: TextClip,
    time: number,
  ): AnimatedTextState {
    const { style, transform, text, keyframes } = clip;

    let positionX = transform.position.x;
    let positionY = transform.position.y;
    let scaleX = transform.scale.x;
    let scaleY = transform.scale.y;
    let rotation = transform.rotation;
    let opacity = transform.opacity;

    const propertyGroups = new Map<string, typeof keyframes>();
    for (const kf of keyframes!) {
      if (!propertyGroups.has(kf.property)) {
        propertyGroups.set(kf.property, []);
      }
      propertyGroups.get(kf.property)!.push(kf);
    }

    for (const [property, kfs] of propertyGroups) {
      const result = this.animationEngine.getValueAtTime(kfs, time);
      if (result.value !== undefined && typeof result.value === "number") {
        switch (property) {
          case "opacity":
            opacity = Math.max(0, Math.min(1, result.value));
            break;
          case "position.x":
            positionX = result.value;
            break;
          case "position.y":
            positionY = result.value;
            break;
          case "scale.x":
            scaleX = result.value;
            break;
          case "scale.y":
            scaleY = result.value;
            break;
          case "rotation":
            rotation = result.value;
            break;
        }
      }
    }

    const animatedTransform: Transform = {
      position: { x: positionX, y: positionY },
      scale: { x: scaleX, y: scaleY },
      rotation,
      opacity,
      anchor: { ...transform.anchor },
    };

    return {
      opacity: animatedTransform.opacity,
      transform: animatedTransform,
      style,
      visibleText: text,
    };
  }

  private applyPreset(
    clip: TextClip,
    preset: TextAnimationPreset,
    params: TextAnimationParams,
    inProgress: number,
    outProgress: number,
    time: number,
  ): AnimatedTextState {
    const { style, transform, text } = clip;

    switch (preset) {
      case "typewriter":
        return this.applyTypewriter(clip, inProgress, outProgress, time);

      case "fade":
        return this.applyFade(clip, inProgress, outProgress, params);

      case "slide-left":
        return this.applySlide(clip, inProgress, outProgress, params, "left");

      case "slide-right":
        return this.applySlide(clip, inProgress, outProgress, params, "right");

      case "slide-up":
        return this.applySlide(clip, inProgress, outProgress, params, "up");

      case "slide-down":
        return this.applySlide(clip, inProgress, outProgress, params, "down");

      case "scale":
        return this.applyScale(clip, inProgress, outProgress, params);

      case "blur":
        return this.applyBlur(clip, inProgress, outProgress, params);

      case "bounce":
        return this.applyBounce(clip, inProgress, outProgress, params);

      case "rotate":
        return this.applyRotate(clip, inProgress, outProgress, params);

      case "wave":
        return this.applyWave(clip, inProgress, outProgress, params, time);

      case "shake":
        return this.applyShake(clip, inProgress, outProgress, params, time);

      case "pop":
        return this.applyPop(clip, inProgress, outProgress, params);

      case "glitch":
        return this.applyGlitch(clip, inProgress, outProgress, params, time);

      case "split":
        return this.applySplit(clip, inProgress, outProgress, params);

      case "flip":
        return this.applyFlip(clip, inProgress, outProgress, params);

      case "word-by-word":
        return this.applyWordByWord(
          clip,
          inProgress,
          outProgress,
          params,
          time,
        );

      case "rainbow":
        return this.applyRainbow(clip, inProgress, outProgress, params, time);

      case "rise":
      case "drop":
      case "elastic":
      case "swing":
      case "zoom-blur":
      case "cascade":
        return this.applyPolishedEntrance(
          clip,
          inProgress,
          outProgress,
          params,
          preset,
        );

      default:
        return {
          opacity: transform.opacity,
          transform,
          style,
          visibleText: text,
        };
    }
  }

  private applyTypewriter(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    _time: number,
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const totalChars = text.length;
    const visibleChars = Math.floor(inProgress * totalChars);
    const visibleText = text.substring(0, visibleChars);
    const opacity = transform.opacity * (1 - outProgress);

    return {
      opacity,
      transform: { ...transform, opacity },
      style,
      visibleText,
    };
  }

  private applyFade(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    params: TextAnimationParams,
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const startOpacity = params.fadeOpacity?.start ?? 0;
    const endOpacity = params.fadeOpacity?.end ?? 1;
    let opacity = startOpacity + (endOpacity - startOpacity) * inProgress;
    opacity = opacity * (1 - outProgress);

    return {
      opacity,
      transform: { ...transform, opacity },
      style,
      visibleText: text,
    };
  }

  private applySlide(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    params: TextAnimationParams,
    direction: "left" | "right" | "up" | "down",
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const distance = params.slideDistance ?? 0.2; // Normalized distance

    let offsetX = 0;
    let offsetY = 0;
    switch (direction) {
      case "left":
        offsetX = -distance * (1 - inProgress) + distance * outProgress;
        break;
      case "right":
        offsetX = distance * (1 - inProgress) - distance * outProgress;
        break;
      case "up":
        offsetY = -distance * (1 - inProgress) + distance * outProgress;
        break;
      case "down":
        offsetY = distance * (1 - inProgress) - distance * outProgress;
        break;
    }
    const opacity = transform.opacity * inProgress * (1 - outProgress);

    const newTransform: Transform = {
      ...transform,
      position: {
        x: transform.position.x + offsetX,
        y: transform.position.y + offsetY,
      },
      opacity,
    };

    return {
      opacity,
      transform: newTransform,
      style,
      visibleText: text,
    };
  }

  private applyScale(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    params: TextAnimationParams,
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const scaleFrom = params.scaleFrom ?? 0;
    const scaleTo = params.scaleTo ?? 1;
    let scale = scaleFrom + (scaleTo - scaleFrom) * inProgress;
    scale = scale * (1 - outProgress) + scaleFrom * outProgress;

    const opacity = transform.opacity * inProgress * (1 - outProgress);

    const newTransform: Transform = {
      ...transform,
      scale: { x: scale, y: scale },
      opacity,
    };

    return {
      opacity,
      transform: newTransform,
      style,
      visibleText: text,
    };
  }

  private applyBlur(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    params: TextAnimationParams,
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const blurAmount = params.blurAmount ?? 10;
    const currentBlur =
      blurAmount * (1 - inProgress) + blurAmount * outProgress;

    const opacity = transform.opacity * inProgress * (1 - outProgress);
    const newStyle: TextStyle = {
      ...style,
      shadowColor: style.color,
      shadowBlur: currentBlur,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    };

    return {
      opacity,
      transform: { ...transform, opacity },
      style: newStyle,
      visibleText: text,
    };
  }

  private applyPolishedEntrance(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    params: TextAnimationParams,
    preset:
      | "rise"
      | "drop"
      | "elastic"
      | "swing"
      | "zoom-blur"
      | "cascade",
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const progress = Math.max(
      0,
      Math.min(1, Math.min(inProgress, 1 - outProgress)),
    );
    const eased = 1 - Math.pow(1 - progress, 3);
    const distance = (params.slideDistance ?? 36) / 250;
    const angle = params.rotateAngle ?? 16;
    let offsetX = 0;
    let offsetY = 0;
    let scale = 1;
    let rotation = 0;
    let blur = 0;

    if (preset === "rise") {
      offsetY = distance * (1 - eased);
      scale = 0.88 + eased * 0.12;
      blur = (params.blurAmount ?? 8) * (1 - progress);
    } else if (preset === "drop") {
      const landing =
        1 - Math.abs(Math.cos(progress * Math.PI * 2.5)) * (1 - progress);
      offsetY = -distance * (1 - landing);
      rotation = angle * (1 - landing);
    } else if (preset === "elastic") {
      const elastic =
        progress === 1
          ? 1
          : 1 - Math.cos(progress * Math.PI * 3.5) * Math.exp(-progress * 5);
      const from = params.scaleFrom ?? 0.15;
      scale = Math.max(0, from + (1 - from) * elastic);
    } else if (preset === "swing") {
      rotation = Math.cos(progress * Math.PI * 3) * angle * (1 - progress);
      offsetY = -distance * 0.5 * (1 - eased);
    } else if (preset === "zoom-blur") {
      const from = params.scaleFrom ?? 1.65;
      scale = from + (1 - from) * eased;
      blur = (params.blurAmount ?? 14) * (1 - progress);
    } else {
      offsetX = -distance * 0.35 * (1 - eased);
      offsetY = distance * (1 - eased);
      rotation = -angle * (1 - eased);
      scale = 0.9 + eased * 0.1;
    }

    const opacity = transform.opacity * progress;
    const newStyle: TextStyle =
      blur > 0
        ? {
            ...style,
            shadowColor: style.color,
            shadowBlur: blur,
            shadowOffsetX: 0,
            shadowOffsetY: 0,
          }
        : style;
    const characterStates =
      preset === "cascade"
        ? text.split("").map((char, index) => {
            const delay =
              text.length > 1 ? (index / (text.length - 1)) * 0.42 : 0;
            const local = Math.max(
              0,
              Math.min(
                1,
                (progress - delay) / Math.max(0.01, 1 - delay),
              ),
            );
            const localEased = 1 - Math.pow(1 - local, 3);
            const direction = index % 2 === 0 ? -1 : 1;
            return {
              char,
              index,
              opacity: transform.opacity * local,
              offsetX: direction * distance * 0.35 * (1 - localEased),
              offsetY: distance * (1 - localEased),
              scale: 0.9 + localEased * 0.1,
              rotation: direction * angle * (1 - localEased),
            };
          })
        : undefined;

    return {
      opacity,
      transform: {
        ...transform,
        position: {
          x: transform.position.x + offsetX,
          y: transform.position.y + offsetY,
        },
        scale: {
          x: transform.scale.x * scale,
          y: transform.scale.y * scale,
        },
        rotation: transform.rotation + rotation,
        opacity,
      },
      style: newStyle,
      visibleText: text,
      characterStates,
    };
  }

  private applyBounce(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    params: TextAnimationParams,
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const bounceHeight = params.bounceHeight ?? 0.1;
    const bounceCount = params.bounceCount ?? 3;
    let offsetY = 0;
    if (inProgress < 1) {
      const t = inProgress * Math.PI * bounceCount;
      const damping = 1 - inProgress;
      offsetY = -Math.abs(Math.sin(t)) * bounceHeight * damping;
    }
    if (outProgress > 0) {
      const t = outProgress * Math.PI;
      offsetY = Math.sin(t) * bounceHeight * outProgress;
    }

    const opacity =
      transform.opacity * Math.min(inProgress * 2, 1) * (1 - outProgress);

    const newTransform: Transform = {
      ...transform,
      position: {
        x: transform.position.x,
        y: transform.position.y + offsetY,
      },
      opacity,
    };

    return {
      opacity,
      transform: newTransform,
      style,
      visibleText: text,
    };
  }

  private applyRotate(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    params: TextAnimationParams,
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const rotateAngle = params.rotateAngle ?? 360;
    let rotation = transform.rotation + rotateAngle * (1 - inProgress);
    rotation = rotation - rotateAngle * outProgress;

    const opacity = transform.opacity * inProgress * (1 - outProgress);

    const newTransform: Transform = {
      ...transform,
      rotation,
      opacity,
    };

    return {
      opacity,
      transform: newTransform,
      style,
      visibleText: text,
    };
  }

  private applyWave(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    params: TextAnimationParams,
    time: number,
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const amplitude = params.waveAmplitude ?? 0.02;
    const frequency = params.waveFrequency ?? 2;

    const opacity = transform.opacity * inProgress * (1 - outProgress);
    const characterStates: CharacterAnimationState[] = text
      .split("")
      .map((char, index) => {
        const phase = (index / text.length) * Math.PI * 2 * frequency;
        const waveOffset = Math.sin(time * 5 + phase) * amplitude * inProgress;

        return {
          char,
          index,
          opacity: opacity,
          offsetX: 0,
          offsetY: waveOffset,
          scale: 1,
          rotation: 0,
        };
      });

    return {
      opacity,
      transform: { ...transform, opacity },
      style,
      visibleText: text,
      characterStates,
    };
  }

  private applyShake(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    params: TextAnimationParams,
    time: number,
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const intensity = params.shakeIntensity ?? 0.01;
    const speed = params.shakeSpeed ?? 20;

    const shakeX =
      Math.sin(time * speed) * intensity * inProgress * (1 - outProgress);
    const shakeY =
      Math.cos(time * speed * 1.3) * intensity * inProgress * (1 - outProgress);
    const opacity = transform.opacity * inProgress * (1 - outProgress);

    const newTransform: Transform = {
      ...transform,
      position: {
        x: transform.position.x + shakeX,
        y: transform.position.y + shakeY,
      },
      opacity,
    };

    return {
      opacity,
      transform: newTransform,
      style,
      visibleText: text,
    };
  }

  private applyPop(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    params: TextAnimationParams,
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const overshoot = params.popOvershoot ?? 1.2;

    let scale = 0;
    if (inProgress < 0.5) {
      scale = inProgress * 2 * overshoot;
    } else if (inProgress < 0.7) {
      scale = overshoot - ((inProgress - 0.5) * (overshoot - 1)) / 0.2;
    } else {
      scale = 1;
    }

    scale = scale * (1 - outProgress);
    const opacity =
      transform.opacity * Math.min(inProgress * 2, 1) * (1 - outProgress);

    const newTransform: Transform = {
      ...transform,
      scale: { x: scale, y: scale },
      opacity,
    };

    return {
      opacity,
      transform: newTransform,
      style,
      visibleText: text,
    };
  }

  private applyGlitch(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    params: TextAnimationParams,
    time: number,
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const intensity = params.glitchIntensity ?? 0.02;
    const speed = params.glitchSpeed ?? 10;

    const glitchActive = Math.sin(time * speed) > 0.7;
    const glitchOffsetX = glitchActive ? (Math.random() - 0.5) * intensity : 0;
    const glitchSkew = glitchActive ? (Math.random() - 0.5) * 5 : 0;

    const opacity = transform.opacity * inProgress * (1 - outProgress);

    const newTransform: Transform = {
      ...transform,
      position: {
        x: transform.position.x + glitchOffsetX * inProgress,
        y: transform.position.y,
      },
      rotation: transform.rotation + glitchSkew * inProgress,
      opacity,
    };

    const newStyle: TextStyle = {
      ...style,
      letterSpacing:
        style.letterSpacing + (glitchActive ? Math.random() * 2 : 0),
    };

    return {
      opacity,
      transform: newTransform,
      style: newStyle,
      visibleText: text,
    };
  }

  private applySplit(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    params: TextAnimationParams,
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const direction = params.splitDirection ?? "horizontal";

    const splitOffset = 0.1 * (1 - inProgress) + 0.1 * outProgress;
    const opacity = transform.opacity * inProgress * (1 - outProgress);

    const characterStates: CharacterAnimationState[] = text
      .split("")
      .map((char, index) => {
        const isFirstHalf = index < text.length / 2;
        const offset =
          direction === "horizontal"
            ? { x: isFirstHalf ? -splitOffset : splitOffset, y: 0 }
            : { x: 0, y: isFirstHalf ? -splitOffset : splitOffset };

        return {
          char,
          index,
          opacity,
          offsetX: offset.x,
          offsetY: offset.y,
          scale: 1,
          rotation: 0,
        };
      });

    return {
      opacity,
      transform: { ...transform, opacity },
      style,
      visibleText: text,
      characterStates,
    };
  }

  private applyFlip(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    params: TextAnimationParams,
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const axis = params.flipAxis ?? "y";

    const flipProgress = (1 - inProgress) * Math.PI + outProgress * Math.PI;
    const scaleValue = Math.abs(Math.cos(flipProgress));
    const opacity = transform.opacity * inProgress * (1 - outProgress);

    const newTransform: Transform = {
      ...transform,
      scale:
        axis === "y"
          ? { x: scaleValue, y: transform.scale.y }
          : { x: transform.scale.x, y: scaleValue },
      opacity,
    };

    return {
      opacity,
      transform: newTransform,
      style,
      visibleText: text,
    };
  }

  private applyWordByWord(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    _params: TextAnimationParams,
    _time: number,
  ): AnimatedTextState {
    const { style, transform, text } = clip;

    const words = text.split(" ");
    const visibleWordCount = Math.ceil(inProgress * words.length);
    const visibleText = words.slice(0, visibleWordCount).join(" ");

    const opacity = transform.opacity * (1 - outProgress);

    return {
      opacity,
      transform: { ...transform, opacity },
      style,
      visibleText,
    };
  }

  private applyRainbow(
    clip: TextClip,
    inProgress: number,
    outProgress: number,
    params: TextAnimationParams,
    time: number,
  ): AnimatedTextState {
    const { style, transform, text } = clip;
    const speed = params.rainbowSpeed ?? 1;

    const hue = (time * speed * 100) % 360;
    const opacity = transform.opacity * inProgress * (1 - outProgress);

    const characterStates: CharacterAnimationState[] = text
      .split("")
      .map((char, index) => ({
        char,
        index,
        opacity,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        rotation: 0,
      }));

    const newStyle: TextStyle = {
      ...style,
      color: `hsl(${hue}, 100%, 50%)`,
    };

    return {
      opacity,
      transform: { ...transform, opacity },
      style: newStyle,
      visibleText: text,
      characterStates,
    };
  }

  createAnimationPreset(
    preset: TextAnimationPreset,
    inDuration: number = 0.5,
    outDuration: number = 0.5,
    params: Partial<TextAnimationParams> = {},
  ): TextAnimation {
    const defaultParams = this.getDefaultParams(preset);

    return {
      preset,
      params: { ...defaultParams, ...params },
      inDuration,
      outDuration,
    };
  }

  private getDefaultParams(preset: TextAnimationPreset): TextAnimationParams {
    switch (preset) {
      case "fade":
        return {
          fadeOpacity: { start: 0, end: 1 },
          easing: "ease-out",
        };

      case "slide-left":
      case "slide-right":
      case "slide-up":
      case "slide-down":
        return {
          slideDistance: 0.2,
          easing: "ease-out",
        };

      case "scale":
        return {
          scaleFrom: 0,
          scaleTo: 1,
          easing: "ease-out",
        };

      case "blur":
        return {
          blurAmount: 10,
          easing: "ease-out",
        };

      case "bounce":
        return {
          bounceHeight: 0.1,
          bounceCount: 3,
          easing: "ease-out",
        };

      case "rotate":
        return {
          rotateAngle: 360,
          easing: "ease-out",
        };

      case "wave":
        return {
          waveAmplitude: 0.02,
          waveFrequency: 2,
          easing: "linear",
        };

      case "typewriter":
        return {
          easing: "linear",
        };

      case "shake":
        return {
          shakeIntensity: 0.01,
          shakeSpeed: 20,
          easing: "linear",
        };

      case "pop":
        return {
          popOvershoot: 1.2,
          easing: "ease-out",
        };

      case "glitch":
        return {
          glitchIntensity: 0.02,
          glitchSpeed: 10,
          easing: "linear",
        };

      case "split":
        return {
          splitDirection: "horizontal",
          easing: "ease-out",
        };

      case "flip":
        return {
          flipAxis: "y",
          easing: "ease-out",
        };

      case "word-by-word":
        return {
          wordDelay: 0.2,
          easing: "linear",
        };

      case "rainbow":
        return {
          rainbowSpeed: 1,
          easing: "linear",
        };

      case "rise":
        return {
          slideDistance: 36,
          blurAmount: 8,
          easing: "ease-out",
        };

      case "drop":
        return {
          slideDistance: 60,
          rotateAngle: 10,
          easing: "ease-out",
        };

      case "elastic":
        return {
          scaleFrom: 0.15,
          popOvershoot: 1.25,
          easing: "ease-out",
        };

      case "swing":
        return {
          rotateAngle: 28,
          slideDistance: 20,
          easing: "ease-out",
        };

      case "zoom-blur":
        return {
          scaleFrom: 1.65,
          blurAmount: 14,
          easing: "ease-out",
        };

      case "cascade":
        return {
          slideDistance: 48,
          rotateAngle: 8,
          easing: "ease-out",
        };

      default:
        return {
          easing: "ease-out",
        };
    }
  }

  getAvailablePresets(): TextAnimationPreset[] {
    return [
      "none",
      "typewriter",
      "fade",
      "slide-left",
      "slide-right",
      "slide-up",
      "slide-down",
      "scale",
      "blur",
      "bounce",
      "rotate",
      "wave",
      "shake",
      "pop",
      "glitch",
      "split",
      "flip",
      "word-by-word",
      "rainbow",
      "rise",
      "drop",
      "elastic",
      "swing",
      "zoom-blur",
      "cascade",
    ];
  }
}
export const textAnimationEngine = new TextAnimationEngine();
