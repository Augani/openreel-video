import { trackOpticalFlowStep, type OpticalFlowPoint } from "@openreel/core";

export interface AutoTrackFrame {
  readonly time: number;
  readonly position: { readonly x: number; readonly y: number };
  readonly confidence: number;
}

export interface AutoTrackVideoOptions {
  readonly blob: Blob;
  readonly startPosition: OpticalFlowPoint;
  readonly compositionWidth: number;
  readonly compositionHeight: number;
  readonly duration: number;
  readonly frameStep: number;
  readonly startTime?: number;
  readonly maxFrames?: number;
  readonly analysisWidth?: number;
}

export async function autoTrackVideoFeature(
  options: AutoTrackVideoOptions,
): Promise<AutoTrackFrame[]> {
  if (typeof document === "undefined") return [];
  const objectUrl = URL.createObjectURL(options.blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = objectUrl;

  try {
    const ready = await waitForVideoReady(video);
    if (!ready) return [];
    const analysisWidth = Math.max(64, Math.round(options.analysisWidth ?? 480));
    const sourceWidth = video.videoWidth || analysisWidth;
    const sourceHeight = video.videoHeight || analysisWidth;
    const scale = analysisWidth / sourceWidth;
    const analysisHeight = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = new OffscreenCanvas(analysisWidth, analysisHeight);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];

    const compToAnalysisX = analysisWidth / Math.max(1, options.compositionWidth);
    const compToAnalysisY = analysisHeight / Math.max(1, options.compositionHeight);

    const startTime = Math.max(0, options.startTime ?? 0);
    const frameStep = Math.max(1 / 60, options.frameStep);
    const maxFrames = Math.max(2, Math.min(600, options.maxFrames ?? 300));
    const endTime = Math.min(
      options.duration,
      Number.isFinite(video.duration) ? video.duration : options.duration,
    );

    const times: number[] = [];
    for (let time = startTime; time <= endTime && times.length < maxFrames; time += frameStep) {
      times.push(Number(time.toFixed(4)));
    }
    if (times.length < 2) return [];

    const results: AutoTrackFrame[] = [];
    let previousImage: ImageData | null = null;
    let analysisPosition = {
      x: options.startPosition.x * compToAnalysisX,
      y: options.startPosition.y * compToAnalysisY,
    };

    for (const time of times) {
      await seekVideo(video, time);
      ctx.drawImage(video, 0, 0, analysisWidth, analysisHeight);
      const image = ctx.getImageData(0, 0, analysisWidth, analysisHeight);
      if (previousImage) {
        const sample = trackOpticalFlowStep(previousImage, image, analysisPosition, {
          blockRadius: 7,
          searchRadius: 18,
        });
        analysisPosition = { x: sample.x, y: sample.y };
        results.push({
          time,
          position: {
            x: analysisPosition.x / compToAnalysisX,
            y: analysisPosition.y / compToAnalysisY,
          },
          confidence: sample.confidence,
        });
      } else {
        results.push({
          time,
          position: { x: options.startPosition.x, y: options.startPosition.y },
          confidence: 1,
        });
      }
      previousImage = image;
    }
    return results;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

function waitForVideoReady(video: HTMLVideoElement): Promise<boolean> {
  return new Promise((resolve) => {
    const onReady = (): void => {
      cleanup();
      resolve(true);
    };
    const onError = (): void => {
      cleanup();
      resolve(false);
    };
    const cleanup = (): void => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
      clearTimeout(timeout);
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve(video.readyState >= 2);
    }, 8000);
    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.load();
  });
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const target = Number.isFinite(video.duration)
    ? Math.min(Math.max(0, time), Math.max(0, video.duration - 0.001))
    : Math.max(0, time);
  if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onSeeked = (): void => {
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      video.removeEventListener("seeked", onSeeked);
      clearTimeout(timeout);
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, 2000);
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = target;
  });
}
