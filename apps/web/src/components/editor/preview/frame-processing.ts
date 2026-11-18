import { getBackgroundRemovalEngine, hasAnimatedVideoEffects, getAnimatedVideoEffects, getAnimatedIrisEffects, isRenderableVideoEffect, isNeutralColorGrading, hasAnimatedColorGrading, getAnimatedColorGrading, type Clip } from "@openreel/core";
import { getEffectsBridge } from "../../../bridges/effects-bridge";
import { applyEffectsToFrame, applyEffectsToFrameCanvas, type PreviewEffectFrame } from "./canvas-renderers";
import { isColorBypassed, withPreviewOverrides } from "./program-frame-control";
import { inputTransformForClip } from "./clip-input-transform";

interface PreparedPreviewFrame {
  frame: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
  cleanup: () => void;
}

export const clipNeedsFrameProcessing = (
  clipId: string,
  clip?: Partial<Pick<Clip, "keyframes" | "effects">>,
  localTime?: number,
): boolean => {
  // Source colour management is interpretation, not grading: it applies even in the ungraded comparison.
  if (inputTransformForClip(clipId)) return true;
  if (isColorBypassed()) return false;
  const animated = clip && hasAnimatedVideoEffects(clip);
  if (animated && localTime === undefined) return true;
  if (clip && localTime !== undefined && getAnimatedIrisEffects({ id: clipId, ...clip }, localTime).length) return true;
  const bgEngine = getBackgroundRemovalEngine();
  if (bgEngine?.isInitialized() && bgEngine.getSettings(clipId).enabled) {
    return true;
  }

  const effectsBridge = getEffectsBridge();
  if (!effectsBridge.isInitialized()) {
    return false;
  }

  const effects = animated && localTime !== undefined
    ? getAnimatedVideoEffects({ id: clipId, ...clip }, localTime)
    : effectsBridge.getEffects(clipId);
  if (effects.map((effect) => withPreviewOverrides(effectsBridge, effect)).some(isRenderableVideoEffect)) return true;

  let grading = effectsBridge.getColorGrading(clipId);
  if (clip && localTime !== undefined && hasAnimatedColorGrading(clip)) {
    const sampled = getAnimatedColorGrading({ keyframes: clip.keyframes, colorGrading: grading }, localTime);
    if (sampled) grading = { ...grading, ...sampled };
  }
  return Object.keys(grading).length > 0 && !isNeutralColorGrading(grading);
};

export const preparePreviewFrame = async (
  clipId: string,
  frameCanvas: HTMLCanvasElement | OffscreenCanvas,
  preferBitmap: boolean,
  allowCanvasByRef = false,
  effectFrame?: PreviewEffectFrame,
): Promise<PreparedPreviewFrame> => {
  const needsProcessing = clipNeedsFrameProcessing(clipId, effectFrame?.clip, effectFrame ? effectFrame.time - effectFrame.clip.startTime : undefined);
  if (!preferBitmap && !needsProcessing) {
    return {
      frame: frameCanvas,
      cleanup: () => {},
    };
  }

  let frameBitmap: ImageBitmap | null = null;
  let processedFrame: ImageBitmap | null = null;

  try {
    frameBitmap = await createImageBitmap(frameCanvas);

    if (!needsProcessing) {
      return {
        frame: frameBitmap,
        cleanup: () => {
          frameBitmap?.close();
        },
      };
    }

    if (allowCanvasByRef) {
      const effectsCanvas = await applyEffectsToFrameCanvas(
        clipId,
        frameBitmap,
        effectFrame,
      );
      if (effectsCanvas) {
        const sourceBitmap = frameBitmap;
        return {
          frame: effectsCanvas,
          cleanup: () => {
            sourceBitmap.close();
          },
        };
      }
    }

    processedFrame = await applyEffectsToFrame(clipId, frameBitmap, effectFrame);
    if (processedFrame === frameBitmap) {
      return {
        frame: frameBitmap,
        cleanup: () => {
          frameBitmap?.close();
        },
      };
    }

    return {
      frame: processedFrame,
      cleanup: () => {
        processedFrame?.close();
        frameBitmap?.close();
      },
    };
  } catch {
    processedFrame?.close();
    frameBitmap?.close();

    return {
      frame: frameCanvas,
      cleanup: () => {},
    };
  }
};

export const renderOverlayLayerWithEffects = async (
  ctx: CanvasRenderingContext2D,
  clipId: string,
  canvasWidth: number,
  canvasHeight: number,
  render: (layerCtx: CanvasRenderingContext2D) => void | Promise<void>,
  effectFrame?: PreviewEffectFrame,
): Promise<void> => {
  if (!clipNeedsFrameProcessing(clipId, effectFrame?.clip, effectFrame ? effectFrame.time - effectFrame.clip.startTime : undefined)) {
    await render(ctx);
    return;
  }
  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = canvasWidth;
  layerCanvas.height = canvasHeight;
  const layerCtx = layerCanvas.getContext("2d");
  if (!layerCtx) return;
  await render(layerCtx);
  const prepared = await preparePreviewFrame(
    clipId,
    layerCanvas,
    false,
    true,
    effectFrame,
  );
  try {
    ctx.drawImage(prepared.frame, 0, 0, canvasWidth, canvasHeight);
  } finally {
    prepared.cleanup();
  }
};

