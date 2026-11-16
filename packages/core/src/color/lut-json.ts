/**
 * Conversion between the engine's typed-array LUT and the JSON-safe form stored
 * on clips, in the LUT library and in saved looks, plus .cube export.
 */
import type { ClipLutJson, LUTData } from "../video/color-grading-engine";
import { resolveLut3dRgb, sampleCurve1dChannel } from "./lut-tables";

export function lutToJson(lut: LUTData): ClipLutJson {
  const { floatData, curve1d, data, ...rest } = lut;
  return {
    ...rest,
    data: Array.from(data),
    ...(floatData ? { floatData: Array.from(floatData) } : {}),
    ...(curve1d
      ? { curve1d: { ...curve1d, data: Array.from(curve1d.data) } }
      : {}),
  };
}

export function lutFromJson(lut: ClipLutJson): LUTData {
  const { floatData, curve1d, data, ...rest } = lut;
  return {
    ...rest,
    data: new Uint8Array(data),
    ...(floatData ? { floatData: Float32Array.from(floatData) } : {}),
    ...(curve1d
      ? { curve1d: { ...curve1d, data: Float32Array.from(curve1d.data) } }
      : {}),
  };
}

function fmt(v: number): string {
  return (Math.round(v * 1e6) / 1e6).toFixed(6);
}

function cubeTitle(title: string): string {
  return title.replace(/["\r\n]/g, " ").trim() || "OpenReel LUT";
}

/**
 * Serialise a LUT as an Adobe/Resolve .cube file. Exact 1D curves are written
 * as LUT_1D_SIZE (with their domain), everything else as LUT_3D_SIZE over
 * 0..1. The intensity is baked in so the file reproduces what the clip shows;
 * pass `bakeIntensity: false` for the raw table.
 */
export function serializeCubeLut(
  lut: LUTData,
  options: { title?: string; bakeIntensity?: boolean } = {},
): string {
  const bake = options.bakeIntensity ?? true;
  const k = bake ? Math.min(1, Math.max(0, lut.intensity)) : 1;
  const lines: string[] = [`TITLE "${cubeTitle(options.title ?? "OpenReel LUT")}"`];

  if (lut.curve1d) {
    const c = lut.curve1d;
    lines.push(`LUT_1D_SIZE ${c.size}`);
    lines.push(`DOMAIN_MIN ${c.domainMin.map(fmt).join(" ")}`);
    lines.push(`DOMAIN_MAX ${c.domainMax.map(fmt).join(" ")}`);
    for (let i = 0; i < c.size; i++) {
      const t = c.size === 1 ? 0 : i / (c.size - 1);
      const row = [0, 1, 2].map((ch) => {
        const input = c.domainMin[ch] + t * (c.domainMax[ch] - c.domainMin[ch]);
        const out = sampleCurve1dChannel(c, ch, input);
        return fmt(input + (out - input) * k);
      });
      lines.push(row.join(" "));
    }
    return lines.join("\n") + "\n";
  }

  const size = lut.size;
  const rgb = resolveLut3dRgb(lut);
  lines.push(`LUT_3D_SIZE ${size}`);
  const m = size - 1;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const i = (b * size * size + g * size + r) * 3;
        const id = [r / m, g / m, b / m];
        lines.push(
          [0, 1, 2].map((ch) => fmt(id[ch] + (rgb[i + ch] - id[ch]) * k)).join(" "),
        );
      }
    }
  }
  return lines.join("\n") + "\n";
}
