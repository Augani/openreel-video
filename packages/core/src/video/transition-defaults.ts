const RANGES: Record<string, [number, number]> = {
  startPct: [0, 100],
  endPct: [0, 100],
  feather: [0, 1],
  borderWidth: [0, 100],
  bands: [2, 64],
  startAngle: [-360, 360],
  tiles: [2, 64],
  seed: [0, 999999],
};
const ENUMS: Record<string, string[]> = {
  alignment: ["start", "center", "end"],
  curve: ["linear", "ease", "ease-in", "ease-out", "ease-in-out"],
  corner: ["topLeft", "topRight", "bottomLeft", "bottomRight"],
  /** Morph Cut analysis detail. */
  quality: ["low", "medium", "high"],
};

/**
 * Checks the parameters every transition shares (alignment, start / end percentage, feather, border, reverse,
 * easing). Returns the first problem, or null. Type-specific keys are not checked here.
 */
export function validateTransitionParams(params: unknown): string | null {
  if (params === undefined) return null;
  if (!params || typeof params !== "object" || Array.isArray(params)) return "params must be an object";
  const p = params as Record<string, unknown>;
  for (const key in RANGES) {
    const v = p[key];
    if (v !== undefined && !(typeof v === "number" && v >= RANGES[key]![0] && v <= RANGES[key]![1])) return `bad ${key}`;
  }
  for (const key in ENUMS) if (p[key] !== undefined && !ENUMS[key]!.includes(p[key] as string)) return `bad ${key}`;
  if (typeof p.startPct === "number" && typeof p.endPct === "number" && p.startPct > p.endPct) return "startPct > endPct";
  if (p.reverse !== undefined && typeof p.reverse !== "boolean") return "bad reverse";
  if (p.borderColor !== undefined && (typeof p.borderColor !== "string" || p.borderColor.length > 32)) return "bad borderColor";
  return null;
}

/**
 * Border width is stored in pixels of the project frame. A frame rendered at another size (a scaled-down preview, a
 * thumbnail) scales it, so the border covers the same part of the picture in the preview and in the export.
 */
export function scaleBorderToFrame(
  params: Record<string, unknown>,
  frameWidth: number,
  referenceWidth: number,
): Record<string, unknown> {
  const width = params.borderWidth;
  if (typeof width !== "number" || !(width > 0) || !(frameWidth > 0) || !(referenceWidth > 0) || frameWidth === referenceWidth) {
    return params;
  }
  return { ...params, borderWidth: (width * frameWidth) / referenceWidth };
}
