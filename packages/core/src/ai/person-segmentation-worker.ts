import type {
  FilesetResolver as FilesetResolverType,
  ImageSegmenter,
} from "@mediapipe/tasks-vision";
import type {
  SegmentationWorkerFrameRequest,
  SegmentationWorkerRequest,
  SegmentationWorkerResponse,
} from "./person-segmentation-protocol";

// Keep worker-local declarations out of the global lexical scope. MediaPipe's
// classic CJS bundle is loaded with importScripts and has its own top-level
// declarations; isolating ours prevents collisions between the two scripts.
(() => {
const HIGH_QUALITY_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";
const FAST_FALLBACK_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const TASKS_VISION_BUNDLE_URL =
  "https://unpkg.com/@mediapipe/tasks-vision@0.10.35/vision_bundle.cjs";
const TASKS_VISION_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const SEGMENTATION_LONG_EDGE = 384;
const DISCONTINUITY_THRESHOLD_MS = 500;
const MAX_STREAM_STATES = 4;
const FOREGROUND_FLOOR = 0.15;
const MAX_FRAME_TRANSLATION = 0.18;

interface MaskCentroid {
  x: number;
  y: number;
  weight: number;
}

interface TemporalPersonMaskState {
  values: Float32Array;
  width: number;
  height: number;
  centroid: MaskCentroid | null;
}

interface WorkerStreamState {
  temporalMask: TemporalPersonMaskState | null;
  lastTimestampMs: number;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<SegmentationWorkerRequest>) => void) | null;
  postMessage: (message: SegmentationWorkerResponse, transfer?: Transferable[]) => void;
  importScripts: (...urls: string[]) => void;
  exports?: Record<string, unknown>;
};

let segmenter: ImageSegmenter | null = null;
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let lastModelTimestamp = 0;
const streamStates = new Map<string, WorkerStreamState>();

function post(message: SegmentationWorkerResponse, transfer?: Transferable[]): void {
  workerScope.postMessage(message, transfer);
}

function loadVisionTasks(): {
  FilesetResolver: typeof FilesetResolverType;
  ImageSegmenter: typeof import("@mediapipe/tasks-vision").ImageSegmenter;
} {
  const previousExports = workerScope.exports;
  const cjsExports: Record<string, unknown> = {};
  workerScope.exports = cjsExports;
  try {
    workerScope.importScripts(TASKS_VISION_BUNDLE_URL);
  } finally {
    workerScope.exports = previousExports;
  }

  const FilesetResolver = cjsExports.FilesetResolver as
    | typeof FilesetResolverType
    | undefined;
  const ImageSegmenterConstructor = cjsExports.ImageSegmenter as
    | typeof import("@mediapipe/tasks-vision").ImageSegmenter
    | undefined;
  if (!FilesetResolver || !ImageSegmenterConstructor) {
    throw new Error("MediaPipe vision bundle did not initialize");
  }
  return {
    FilesetResolver,
    ImageSegmenter: ImageSegmenterConstructor,
  };
}

async function initialize(): Promise<void> {
  if (segmenter) return;

  const { FilesetResolver, ImageSegmenter } = loadVisionTasks();
  const vision = await FilesetResolver.forVisionTasks(TASKS_VISION_WASM_URL);
  const createSegmenter = (
    modelAssetPath: string,
    delegate: "GPU" | "CPU",
  ) =>
    ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate },
      runningMode: "VIDEO",
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });

  try {
    segmenter = await createSegmenter(HIGH_QUALITY_MODEL_URL, "GPU");
  } catch {
    try {
      segmenter = await createSegmenter(FAST_FALLBACK_MODEL_URL, "GPU");
    } catch {
      segmenter = await createSegmenter(FAST_FALLBACK_MODEL_URL, "CPU");
    }
  }

  canvas = new OffscreenCanvas(1, 1);
  context = canvas.getContext("2d", { willReadFrequently: true });
}

function getSegmentationSize(
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  if (sourceWidth >= sourceHeight) {
    return {
      width: SEGMENTATION_LONG_EDGE,
      height: Math.max(
        1,
        Math.round(SEGMENTATION_LONG_EDGE * (sourceHeight / sourceWidth)),
      ),
    };
  }
  return {
    width: Math.max(
      1,
      Math.round(SEGMENTATION_LONG_EDGE * (sourceWidth / sourceHeight)),
    ),
    height: SEGMENTATION_LONG_EDGE,
  };
}

function getStreamState(streamId: string): WorkerStreamState {
  const existing = streamStates.get(streamId);
  if (existing) {
    streamStates.delete(streamId);
    streamStates.set(streamId, existing);
    return existing;
  }

  while (streamStates.size >= MAX_STREAM_STATES) {
    const oldest = streamStates.keys().next().value;
    if (oldest === undefined) break;
    streamStates.delete(oldest);
  }
  const created: WorkerStreamState = {
    temporalMask: null,
    lastTimestampMs: Number.NEGATIVE_INFINITY,
  };
  streamStates.set(streamId, created);
  return created;
}

const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, value));

function measureCentroid(
  values: Float32Array,
  width: number,
  height: number,
): MaskCentroid | null {
  let weightedX = 0;
  let weightedY = 0;
  let weight = 0;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const confidence = Math.max(0, values[row + x] - FOREGROUND_FLOOR);
      weightedX += x * confidence;
      weightedY += y * confidence;
      weight += confidence;
    }
  }

  if (weight < width * height * 0.001) return null;
  return { x: weightedX / weight, y: weightedY / weight, weight };
}

function stabilizePersonMask(
  currentValues: Float32Array,
  width: number,
  height: number,
  previous: TemporalPersonMaskState | null,
): TemporalPersonMaskState {
  const current = new Float32Array(currentValues.length);
  for (let i = 0; i < currentValues.length; i++) {
    current[i] = clamp01(currentValues[i]);
  }

  const centroid = measureCentroid(current, width, height);
  if (
    !previous ||
    previous.width !== width ||
    previous.height !== height ||
    previous.values.length !== current.length
  ) {
    return { values: current, width, height, centroid };
  }

  let offsetX = 0;
  let offsetY = 0;
  if (centroid && previous.centroid) {
    const rawOffsetX = Math.round(centroid.x - previous.centroid.x);
    const rawOffsetY = Math.round(centroid.y - previous.centroid.y);
    const maxOffsetX = Math.max(2, Math.round(width * MAX_FRAME_TRANSLATION));
    const maxOffsetY = Math.max(2, Math.round(height * MAX_FRAME_TRANSLATION));
    if (
      Math.abs(rawOffsetX) > maxOffsetX ||
      Math.abs(rawOffsetY) > maxOffsetY
    ) {
      return { values: current, width, height, centroid };
    }
    offsetX = rawOffsetX;
    offsetY = rawOffsetY;
  }

  const stabilized = new Float32Array(current.length);
  for (let y = 0; y < height; y++) {
    const previousY = y - offsetY;
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const previousX = x - offsetX;
      const prior =
        previousX >= 0 &&
        previousX < width &&
        previousY >= 0 &&
        previousY < height
          ? previous.values[previousY * width + previousX]
          : 0;
      const value = current[index];
      const difference = value - prior;
      if (Math.abs(difference) <= 0.04) {
        stabilized[index] = prior + difference * 0.55;
      } else if (difference > 0 || value <= 0.2) {
        stabilized[index] = value;
      } else {
        stabilized[index] = prior + difference * 0.85;
      }
    }
  }

  return {
    values: stabilized,
    width,
    height,
    centroid: measureCentroid(stabilized, width, height),
  };
}

function createProtectivePersonMask(
  current: TemporalPersonMaskState,
  _previous: TemporalPersonMaskState | null,
): Float32Array {
  // Never move or enlarge the silhouette. Projecting the old matte onto the
  // current frame copies background pixels from the subject's former position
  // and is the main cause of bright motion fringes.
  return new Float32Array(current.values);
}

function refinePersonMaskEdges(
  values: Float32Array,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
): Float32Array {
  if (
    values.length !== width * height ||
    rgba.length !== sourceWidth * sourceHeight * 4
  ) {
    return new Float32Array(values);
  }

  const refined = new Float32Array(values.length);
  const radius = 2;
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.floor(((y + 0.5) * sourceHeight) / height),
    );
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.floor(((x + 0.5) * sourceWidth) / width),
      );
      const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
      const centerR = rgba[sourceIndex];
      const centerG = rgba[sourceIndex + 1];
      const centerB = rgba[sourceIndex + 2];
      let weightedMask = 0;
      let totalWeight = 0;

      for (let offsetY = -radius; offsetY <= radius; offsetY++) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offsetY));
        const sampleSourceY = Math.min(
          sourceHeight - 1,
          Math.floor(((sampleY + 0.5) * sourceHeight) / height),
        );
        for (let offsetX = -radius; offsetX <= radius; offsetX++) {
          const sampleX = Math.max(0, Math.min(width - 1, x + offsetX));
          const sampleSourceX = Math.min(
            sourceWidth - 1,
            Math.floor(((sampleX + 0.5) * sourceWidth) / width),
          );
          const sampleSourceIndex =
            (sampleSourceY * sourceWidth + sampleSourceX) * 4;
          const deltaR = rgba[sampleSourceIndex] - centerR;
          const deltaG = rgba[sampleSourceIndex + 1] - centerG;
          const deltaB = rgba[sampleSourceIndex + 2] - centerB;
          const colorDistance =
            deltaR * deltaR + deltaG * deltaG + deltaB * deltaB;
          const spatialWeight =
            1 / (1 + offsetX * offsetX + offsetY * offsetY);
          const colorWeight = 1 / (1 + colorDistance / 1800);
          const weight = spatialWeight * colorWeight;
          weightedMask += values[sampleY * width + sampleX] * weight;
          totalWeight += weight;
        }
      }
      refined[y * width + x] = totalWeight > 0
        ? weightedMask / totalWeight
        : values[y * width + x];
    }
  }
  return refined;
}

function shapePersonMaskAlpha(values: Float32Array): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(values.length);
  // Coverage-first curve for occlusion. This changes confidence only; unlike
  // dilation it never adds pixels outside the model's predicted silhouette.
  const low = 0.28;
  const high = 0.52;
  for (let i = 0; i < values.length; i++) {
    const normalized = Math.max(
      0,
      Math.min(1, (values[i] - low) / (high - low)),
    );
    const shaped = 1 - (1 - normalized) * (1 - normalized);
    alpha[i] = Math.round(shaped * 255);
  }
  return alpha;
}

async function segmentFrame(
  request: SegmentationWorkerFrameRequest,
): Promise<void> {
  if (!segmenter || !canvas || !context) {
    throw new Error("Person segmentation worker is not initialized");
  }

  const sourceWidth = request.bitmap.width;
  const sourceHeight = request.bitmap.height;
  const size = getSegmentationSize(sourceWidth, sourceHeight);
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
  }
  context.clearRect(0, 0, size.width, size.height);
  context.drawImage(request.bitmap, 0, 0, size.width, size.height);
  request.bitmap.close();
  const sourceImage = context.getImageData(0, 0, size.width, size.height);

  const state = getStreamState(request.streamId);
  const timeDelta = request.timestampMs - state.lastTimestampMs;
  if (
    request.reset ||
    (state.lastTimestampMs !== Number.NEGATIVE_INFINITY &&
      (timeDelta < -1 || timeDelta > DISCONTINUITY_THRESHOLD_MS))
  ) {
    state.temporalMask = null;
  }
  state.lastTimestampMs = request.timestampMs;

  let rawMask: Float32Array | null = null;
  let maskWidth = size.width;
  let maskHeight = size.height;
  const modelTimestamp = Math.max(
    Math.round(performance.now()),
    lastModelTimestamp + 1,
  );
  lastModelTimestamp = modelTimestamp;

  segmenter.segmentForVideo(canvas, modelTimestamp, (result) => {
    const confidenceMasks = result.confidenceMasks;
    if (!confidenceMasks?.length) return;

    try {
      if (confidenceMasks.length === 1) {
        const foregroundMask = confidenceMasks[0];
        rawMask = new Float32Array(foregroundMask.getAsFloat32Array());
        maskWidth = foregroundMask.width;
        maskHeight = foregroundMask.height;
        return;
      }

      // SelfieMulticlass returns background, hair, body/skin, face/skin,
      // clothes, and accessories as separate masks. Every non-background
      // category belongs in the subject matte, so use 1 - background instead
      // of selecting just one category (which would cut out clothes or hair).
      const labels = segmenter?.getLabels() ?? [];
      const labelledBackgroundIndex = labels.findIndex((label) =>
        /^background$/i.test(label.trim()),
      );
      const backgroundIndex = labelledBackgroundIndex >= 0
        ? labelledBackgroundIndex
        : 0;
      const backgroundMask =
        confidenceMasks[backgroundIndex] ?? confidenceMasks[0];
      const backgroundValues = backgroundMask.getAsFloat32Array();
      const foregroundValues = new Float32Array(backgroundValues.length);
      for (let index = 0; index < backgroundValues.length; index++) {
        foregroundValues[index] = clamp01(1 - backgroundValues[index]);
      }
      rawMask = foregroundValues;
      maskWidth = backgroundMask.width;
      maskHeight = backgroundMask.height;
    } finally {
      for (const confidenceMask of confidenceMasks) confidenceMask.close();
    }
  });

  if (!rawMask) throw new Error("The person model returned no confidence mask");

  const refined = refinePersonMaskEdges(
    rawMask,
    maskWidth,
    maskHeight,
    sourceImage.data,
    size.width,
    size.height,
  );
  const previous = state.temporalMask;
  const stabilized = stabilizePersonMask(
    refined,
    maskWidth,
    maskHeight,
    previous,
  );
  state.temporalMask = stabilized;
  const protective = createProtectivePersonMask(stabilized, previous);
  const alpha = shapePersonMaskAlpha(protective);

  post(
    {
      type: "result",
      requestId: request.requestId,
      streamId: request.streamId,
      timestampMs: request.timestampMs,
      width: maskWidth,
      height: maskHeight,
      alpha,
      referenceRgba: sourceImage.data,
      referenceWidth: size.width,
      referenceHeight: size.height,
    },
    [alpha.buffer, sourceImage.data.buffer],
  );
}

workerScope.onmessage = (event): void => {
  const request = event.data;
  if (request.type === "init") {
    void initialize()
      .then(() => post({ type: "ready" }))
      .catch((error: unknown) =>
        post({
          type: "error",
          message: error instanceof Error ? error.message : "Initialization failed",
        }),
      );
    return;
  }

  if (request.type === "dispose") {
    segmenter?.close();
    segmenter = null;
    streamStates.clear();
    return;
  }

  void segmentFrame(request).catch((error: unknown) => {
    request.bitmap.close();
    post({
      type: "error",
      requestId: request.requestId,
      streamId: request.streamId,
      message: error instanceof Error ? error.message : "Segmentation failed",
    });
  });
};
})();
