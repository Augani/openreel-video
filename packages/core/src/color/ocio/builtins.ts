import { BUILTIN_OPS } from "./builtins-data";
import { registerFixedFunctions } from "./fixed";
import { fixedStyleOf, hasFixed, OcioUnsupportedError, type AnalyticId, type Op } from "./ops";

/**
 * OCIO `BuiltinTransform` styles. Most are matrices, exponents, log curves and fixed functions, tabulated in
 * `builtins-data.ts` (generated from OpenColorIO itself, so the numbers are OCIO's). A few are tables inside OCIO
 * (1D LUTs for PQ / HLG / Canon Log) or grading splines (the ACES 1.x output transforms); those are evaluated analytically
 * here (and the ACES output ones by the existing, OCIO-checked RRT / ODT code in `color/aces-output.ts`), and the rest
 * (ADX, Apple Log, ACES 2.0 outputs, the other ACES 1.x output variants) are reported as unsupported.
 */

/** For styles whose data has a 1D LUT marker: the analytic curves replacing those markers, in order. */
const LUT_REPLACEMENTS: Readonly<Record<string, readonly AnalyticId[]>> = {
  "ACEScc_to_ACES2065-1": ["acescc_decode"],
  "CURVE - ST-2084_to_LINEAR": ["pq_eotf"],
  "CURVE - LINEAR_to_ST-2084": ["pq_oetf"],
  "DISPLAY - CIE-XYZ-D65_to_REC.2100-PQ": ["pq_oetf"],
  "DISPLAY - CIE-XYZ-D65_to_ST2084-P3-D65": ["pq_oetf"],
  "DISPLAY - CIE-XYZ-D65_to_ST2084-DCDM-D65": ["pq_oetf"],
  "CURVE - HLG-OETF": ["hlg_oetf"],
  "CURVE - HLG-OETF-INVERSE": ["hlg_oetf_inv"],
  "DISPLAY - CIE-XYZ-D65_to_REC.2100-HLG-1000nit": ["hlg_oetf"],
};

registerFixedFunctions();

const ACES_OUTPUT_PREFIX = "ACES-OUTPUT - ACES2065-1_to_CIE-XYZ-D65 - ";

/** ACES 1.x output transforms evaluated analytically (and what they are). */
const ACES_OUTPUTS: Readonly<Record<string, AnalyticId>> = {
  [`${ACES_OUTPUT_PREFIX}SDR-VIDEO_1.0`]: "aces13_sdr_video",
  [`${ACES_OUTPUT_PREFIX}HDR-VIDEO-1000nit-15nit-REC2020lim_1.1`]: "aces13_hdr_1000_rec2020",
};

const byLowerName = new Map<string, string>();
for (const key of Object.keys(BUILTIN_OPS)) byLowerName.set(key.toLowerCase(), key);
for (const key of Object.keys(ACES_OUTPUTS)) byLowerName.set(key.toLowerCase(), key);
for (const key of Object.keys(LUT_REPLACEMENTS)) byLowerName.set(key.toLowerCase(), key);

/** The ops of a builtin style (forward direction), or an `OcioUnsupportedError` naming what is missing. */
export function builtinOps(style: string): Op[] {
  const key = byLowerName.get(style.trim().toLowerCase());
  if (key && ACES_OUTPUTS[key]) return [{ k: "analytic", id: ACES_OUTPUTS[key] }];
  const data = key ? BUILTIN_OPS[key] : undefined;
  if (!key || !data) {
    if (style.includes("_2.0")) throw new OcioUnsupportedError(`BuiltinTransform "${style}" is an ACES 2.0 output transform, which is not implemented.`);
    if (style.startsWith(ACES_OUTPUT_PREFIX)) throw new OcioUnsupportedError(`BuiltinTransform "${style.slice(ACES_OUTPUT_PREFIX.length)}" (an ACES 1.x output transform variant) is not implemented; only SDR-VIDEO_1.0 and HDR-VIDEO-1000nit-15nit-REC2020lim_1.1 are.`);
    throw new OcioUnsupportedError(`BuiltinTransform "${style}" is not implemented.`);
  }
  const replacements = [...(LUT_REPLACEMENTS[key] ?? [])];
  const out: Op[] = [];
  for (const op of data) {
    // ACEScc: OCIO's Range maps the code to its LUT's 0..1 domain; the analytic decode takes the code itself, so this range
    // only clamps to the LUT's span.
    if (key === "ACEScc_to_ACES2065-1" && op.k === "range" && op.maxOut === 1) {
      out.push({ ...op, minOut: op.minIn, maxOut: op.maxIn });
      continue;
    }
    if ((op as { k: string }).k === "unsupported") {
      const id = replacements.shift();
      if (!id) throw new OcioUnsupportedError(`BuiltinTransform "${style}" is a table inside OpenColorIO (ADX, Apple Log, Canon Log 2 / 3) that is not implemented.`);
      out.push({ k: "analytic", id });
    } else if (op.k === "fixed") {
      const style = fixedStyleOf(op.style);
      if (!style || !hasFixed(style)) throw new OcioUnsupportedError(`BuiltinTransform "${key}" uses the fixed function ${op.style}, which is not implemented.`);
      out.push({ ...op, style });
    } else out.push(op);
  }
  return out;
}

export function isKnownBuiltin(style: string): boolean {
  try {
    builtinOps(style);
    return true;
  } catch {
    return false;
  }
}
