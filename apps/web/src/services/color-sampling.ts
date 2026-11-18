/**
 * Frame sampling for Auto Tone and Match Color. Frames come from the Program
 * monitor canvas (the same source the scopes read), downsampled so analysis
 * cost does not depend on the project resolution.
 */
import {
  computeAutoTone,
  computeColorMatch,
  computeColorStats,
  DEFAULT_HSL,
  DEFAULT_TONE,
  type AutoToneResult,
  type ClipColorGrading,
  type ColorMatchResult,
  type ColorStats,
  type HSLValues,
  type ScopeImageLike,
} from "@openreel/core";
import { captureProgramFrame } from "./comparison-service";
import { getPreviewCanvas } from "../components/editor/scopes/preview-canvas-registry";

const SAMPLE_WIDTH = 256;

function bitmapToImageData(bitmap: ImageBitmap): ScopeImageLike | null {
  const width = Math.min(SAMPLE_WIDTH, bitmap.width);
  const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { data, width, height };
}

/** The Program frame at `time` as ImageData-like pixels, or null when it cannot be rendered now. */
export async function sampleProgramFrame(
  options: { time?: number; bypass?: boolean } = {},
): Promise<ScopeImageLike | null> {
  const bitmap = await captureProgramFrame(options);
  if (!bitmap) return null;
  try {
    return bitmapToImageData(bitmap);
  } finally {
    bitmap.close();
  }
}

/** Synchronous read of whatever the Program canvas shows right now. */
export function readProgramCanvas(): ScopeImageLike | null {
  const canvas = getPreviewCanvas();
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
  const width = Math.min(SAMPLE_WIDTH, canvas.width);
  const height = Math.max(1, Math.round((canvas.height / canvas.width) * width));
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { data, width, height };
}

/** Auto Tone from the ungraded Program frame at the playhead (or `time`). */
export async function measureAutoTone(time?: number): Promise<AutoToneResult | null> {
  const frame = await sampleProgramFrame({ time, bypass: true });
  return frame ? computeAutoTone(frame) : null;
}

export interface ColorMatchMeasurement {
  reference: ColorStats;
  source: ColorStats;
}

/**
 * Colour statistics for Match Color: the reference as it looks (graded) at
 * `referenceTime`, the source ungraded at `sourceTime`.
 */
export async function measureColorMatch(
  referenceTime: number,
  sourceTime: number,
): Promise<ColorMatchMeasurement | null> {
  const referenceFrame = await sampleProgramFrame({ time: referenceTime, bypass: false });
  const sourceFrame = await sampleProgramFrame({ time: sourceTime, bypass: true });
  if (!referenceFrame || !sourceFrame) return null;
  const reference = computeColorStats(referenceFrame);
  const source = computeColorStats(sourceFrame);
  return reference && source ? { reference, source } : null;
}

/**
 * The grade that applying a colour match produces: wheels and the contrast
 * tone slider are replaced, saturation is added to every HSL band.
 */
export function applyColorMatchToGrade(
  grade: Pick<ClipColorGrading, "hsl" | "tone">,
  measurement: ColorMatchMeasurement,
  intensity: number,
): Pick<ClipColorGrading, "colorWheels" | "tone" | "hsl"> {
  const match: ColorMatchResult = computeColorMatch(measurement.reference, measurement.source, intensity);
  const hsl: HSLValues = grade.hsl ?? { ...DEFAULT_HSL };
  return {
    colorWheels: match.colorWheels,
    tone: { ...DEFAULT_TONE, ...grade.tone, contrast: match.tone.contrast },
    hsl: {
      ...hsl,
      saturation: DEFAULT_HSL.saturation.map((_, index) =>
        Math.max(-1, Math.min(1, (hsl.saturation[index] ?? 0) + match.saturationDelta)),
      ),
    },
  };
}
