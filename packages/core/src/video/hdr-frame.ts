import type { Clip, Transform } from "../types/timeline";
import type { HdrTransfer } from "../export/types";
import { outputColorForExport, withBitDepth10, type OutputColorSpec } from "../export/color-output";
import type { Project } from "../types/project";
import { effectiveTimeInterpolation } from "./time-interpolation/types";
import {
  CpuHdrCompositor,
  encodedRgbToYuv,
  hdrGradeSupported,
  type HdrCompositor,
  type HdrPayload,
} from "../color/hdr-working";
import { resolveHdrEffects, type HdrEffectInput } from "../color/hdr-effects";
import { HdrLightLevelMeter } from "../color/hdr-light-level";
import type { ClipColorGrading } from "./color-grading-engine";
import { isNeutralLut } from "./color-grading-defaults";
import { GpuHdrCompositor, isGpuHdrAvailable } from "./hdr-gpu";

/**
 * Glue between the video engine and the scene-referred HDR compositor.
 *
 * `VideoEngine.composeFrame` runs the HDR path when the project works in
 * Rec.2020 or an HDR export is running. Eligible video / image clips are drawn
 * into the half-float image, with their whole grade (LUT, HSL and vignette
 * included), blur / sharpen / glow effects, and crossfade / dip transitions.
 * Everything else (text, shapes, motion, subtitles, other effects, masks, other
 * transitions, compound clips) renders on the 8-bit canvas and is merged in at
 * graphics white (203 nit unless the project sets another) after each track,
 * so track order is kept.
 */

/** What an HDR export asks the engine to produce beside the preview bitmap. */
export interface HdrExportTarget {
  readonly spec: OutputColorSpec;
  readonly chroma: "420" | "444";
  /** PQ exports only: measures MaxCLL / MaxFALL from the frames as they are encoded. */
  readonly meter?: HdrLightLevelMeter;
}

export function hdrOfTarget(target: HdrExportTarget | null): HdrTransfer | undefined {
  return target && target.spec.transfer !== "bt709" ? target.spec.transfer : undefined;
}

export interface HdrClipFacts {
  readonly clip: Pick<Clip, "smoothSlowMo" | "timeInterpolation" | "speed" | "emphasisAnimation" | "stabilization">;
  readonly effects: readonly HdrEffectInput[];
  readonly hasMasks: boolean;
  readonly grading: ClipColorGrading | undefined;
  readonly transform: Transform;
  /** Background removal or an applied stabilizer: both rewrite the frame on the 8-bit path. */
  readonly rewritesFrame: boolean;
}

/** Whether a clip can be composed in float. Anything else keeps the 8-bit path (graphics white). */
export function isHdrEligibleClip(facts: HdrClipFacts): boolean {
  const { clip, transform } = facts;
  if (facts.rewritesFrame || facts.hasMasks) return false;
  if (resolveHdrEffects(facts.effects).unsupported) return false;
  if (effectiveTimeInterpolation(clip) !== "frameSampling") return false;
  if (clip.stabilization?.enabled) return false;
  const emphasis = clip.emphasisAnimation as { type?: string } | undefined;
  if (emphasis && emphasis.type && emphasis.type !== "none") return false;
  if (transform.borderRadius || transform.rotate3d || transform.perspective) return false;
  // The float path has no Input LUT stage; a clip with one keeps the 8-bit path, which applies it.
  if (facts.grading?.inputLut && !isNeutralLut(facts.grading.inputLut as never)) return false;
  return hdrGradeSupported(facts.grading);
}

export function createHdrCompositor(allowGpu: boolean): HdrCompositor {
  if (allowGpu && isGpuHdrAvailable()) {
    try {
      return new GpuHdrCompositor();
    } catch (error) {
      console.warn("[hdr] GPU half-float compositor unavailable, using the CPU reference:", error);
    }
  }
  return new CpuHdrCompositor();
}

/** The planes an export backend sends, from the compositor's output-encoded read-back. */
export function exportPayload(comp: HdrCompositor, target: HdrExportTarget, width: number, height: number): HdrPayload {
  const rgb = comp.readEncodedRgb(target.spec);
  if (target.spec.transfer === "pq") target.meter?.add(rgb);
  return { yuv: encodedRgbToYuv(rgb, width, height, target.spec.bitDepth, target.chroma), spec: target.spec };
}

/**
 * The colour space and chroma layout of an export's frames, or null for the classic 8-bit path. Shared by the
 * engine (which renders float frames to it) and the backends (which send the planes), so they cannot disagree.
 */
export function hdrExportTargetFor(
  project: Pick<Project, "settings">,
  settings: { readonly hdr?: HdrTransfer; readonly codec?: string },
): HdrExportTarget | null {
  const spec = outputColorForExport(project, settings.hdr);
  if (!spec) return null;
  const prores = settings.codec === "prores";
  const finalSpec = prores ? withBitDepth10(spec) : spec;
  return {
    spec: finalSpec,
    chroma: prores ? "444" : "420",
    meter: finalSpec.transfer === "pq" ? new HdrLightLevelMeter() : undefined,
  };
}
