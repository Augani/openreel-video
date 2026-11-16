/**
 * Pure .cube LUT parser and resampler (Adobe/Resolve "Cube LUT" spec).
 *
 * Supports LUT_1D_SIZE and LUT_3D_SIZE, DOMAIN_MIN / DOMAIN_MAX, TITLE,
 * comments and blank lines. Table values stay in Float32Array: nothing is
 * quantised to 8 bits here. Malformed files throw {@link CubeLutError}.
 */

import type { LUTData } from "../video/color-grading-engine";

export const CUBE_LUT_MIN_SIZE = 2;
export const CUBE_LUT_MAX_1D_SIZE = 65536;
export const CUBE_LUT_MAX_3D_SIZE = 256;

export type CubeVec3 = readonly [number, number, number];

export interface CubeLut {
  title: string | null;
  kind: "1d" | "3d";
  size: number;
  domainMin: CubeVec3;
  domainMax: CubeVec3;
  /**
   * Interleaved RGB floats as written in the file (raw output values, not
   * clamped). 1D: `size` entries. 3D: `size^3` entries, red fastest.
   */
  data: Float32Array;
  /** Non-fatal notes, e.g. ignored optional keywords. */
  warnings: string[];
}

export class CubeLutError extends Error {
  readonly line?: number;
  constructor(message: string, line?: number) {
    super(line === undefined ? message : `${message} (line ${line})`);
    this.name = "CubeLutError";
    this.line = line;
  }
}

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseNumber(token: string, line: number, what: string): number {
  if (!NUMBER_RE.test(token)) {
    throw new CubeLutError(`Invalid number "${token}" in ${what}`, line);
  }
  const value = Number(token);
  if (!Number.isFinite(value)) {
    throw new CubeLutError(`Invalid number "${token}" in ${what}`, line);
  }
  return value;
}

function parseSize(
  token: string | undefined,
  line: number,
  kind: "1d" | "3d",
): number {
  const max = kind === "1d" ? CUBE_LUT_MAX_1D_SIZE : CUBE_LUT_MAX_3D_SIZE;
  const label = kind === "1d" ? "LUT_1D_SIZE" : "LUT_3D_SIZE";
  if (token === undefined || !/^\d+$/.test(token)) {
    throw new CubeLutError(`Invalid ${label}: ${token ?? "(missing)"}`, line);
  }
  const size = Number(token);
  if (size < CUBE_LUT_MIN_SIZE || size > max) {
    throw new CubeLutError(
      `${label} ${size} is out of range (${CUBE_LUT_MIN_SIZE}-${max})`,
      line,
    );
  }
  return size;
}

function parseVec3(tokens: string[], line: number, what: string): CubeVec3 {
  if (tokens.length !== 3) {
    throw new CubeLutError(`${what} needs exactly 3 values`, line);
  }
  return [
    parseNumber(tokens[0], line, what),
    parseNumber(tokens[1], line, what),
    parseNumber(tokens[2], line, what),
  ];
}

export function parseCubeLut(content: string): CubeLut {
  const lines = content.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  let title: string | null = null;
  let kind: "1d" | "3d" | null = null;
  let size = 0;
  let domainMin: CubeVec3 = [0, 0, 0];
  let domainMax: CubeVec3 = [1, 1, 1];
  const warnings: string[] = [];
  let values: Float32Array | null = null;
  let count = 0; // floats written so far

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let line = lines[i];
    // TITLE may contain '#' inside its quotes, so handle it before stripping comments.
    if (/^\s*TITLE\b/.test(line)) {
      const quoted = /^\s*TITLE\s+"([^"]*)"/.exec(line);
      title = quoted
        ? quoted[1]
        : line.replace(/^\s*TITLE\s*/, "").replace(/#.*$/, "").trim();
      continue;
    }
    const hash = line.indexOf("#");
    if (hash >= 0) line = line.slice(0, hash);
    line = line.trim();
    if (line === "") continue;

    const tokens = line.split(/\s+/);
    const keyword = tokens[0];

    if (/^[A-Za-z_]/.test(keyword)) {
      switch (keyword) {
        case "LUT_1D_SIZE":
        case "LUT_3D_SIZE": {
          const k = keyword === "LUT_1D_SIZE" ? "1d" : "3d";
          if (kind !== null) {
            throw new CubeLutError(
              kind === k
                ? `Duplicate ${keyword}`
                : "File declares both LUT_1D_SIZE and LUT_3D_SIZE",
              lineNo,
            );
          }
          if (tokens.length !== 2) {
            throw new CubeLutError(
              `${keyword} needs exactly one value`,
              lineNo,
            );
          }
          kind = k;
          size = parseSize(tokens[1], lineNo, k);
          values = new Float32Array((k === "1d" ? size : size ** 3) * 3);
          break;
        }
        case "DOMAIN_MIN":
          domainMin = parseVec3(tokens.slice(1), lineNo, "DOMAIN_MIN");
          break;
        case "DOMAIN_MAX":
          domainMax = parseVec3(tokens.slice(1), lineNo, "DOMAIN_MAX");
          break;
        case "LUT_1D_INPUT_RANGE":
        case "LUT_3D_INPUT_RANGE":
        case "LUT_IN_VIDEO_RANGE":
        case "LUT_OUT_VIDEO_RANGE":
          warnings.push(`Ignored optional keyword ${keyword} (line ${lineNo})`);
          break;
        default:
          if (/^(?:[+-]?(?:nan|inf|infinity))$/i.test(keyword)) {
            throw new CubeLutError(
              `Invalid number "${keyword}" in table data`,
              lineNo,
            );
          }
          warnings.push(`Ignored unknown keyword "${keyword}" (line ${lineNo})`);
      }
      continue;
    }

    if (tokens.length !== 3) {
      throw new CubeLutError(
        `Expected 3 values per table row, got ${tokens.length}`,
        lineNo,
      );
    }
    if (values === null) {
      throw new CubeLutError(
        "Table data found before LUT_1D_SIZE / LUT_3D_SIZE",
        lineNo,
      );
    }
    if (count + 3 > values.length) {
      throw new CubeLutError(
        `Too many table rows for ${(kind as string).toUpperCase()} size ${size} (expected ${values.length / 3})`,
        lineNo,
      );
    }
    values[count++] = parseNumber(tokens[0], lineNo, "table data");
    values[count++] = parseNumber(tokens[1], lineNo, "table data");
    values[count++] = parseNumber(tokens[2], lineNo, "table data");
  }

  if (kind === null || values === null) {
    throw new CubeLutError(
      "LUT size not specified (missing LUT_1D_SIZE or LUT_3D_SIZE)",
    );
  }
  for (let c = 0; c < 3; c++) {
    if (!(domainMax[c] > domainMin[c])) {
      throw new CubeLutError(
        `DOMAIN_MAX must be greater than DOMAIN_MIN on every channel (channel ${c}: ${domainMin[c]} .. ${domainMax[c]})`,
      );
    }
  }

  if (count !== values.length) {
    throw new CubeLutError(
      `Invalid LUT data: expected ${values.length / 3} rows (${values.length} values) for ${kind.toUpperCase()} size ${size}, got ${count / 3} rows`,
    );
  }

  return {
    title,
    kind,
    size,
    domainMin,
    domainMax,
    data: values,
    warnings,
  };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Sample a parsed cube LUT at an input RGB expressed in the file's domain.
 * Linear (1D) / trilinear (3D). Input is clamped to the domain.
 */
export function sampleCubeLut(
  lut: CubeLut,
  rgb: CubeVec3,
): [number, number, number] {
  const { size, data, domainMin, domainMax } = lut;
  const t: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    t[c] = clamp01((rgb[c] - domainMin[c]) / (domainMax[c] - domainMin[c]));
  }
  const m = size - 1;
  const out: [number, number, number] = [0, 0, 0];
  if (lut.kind === "1d") {
    for (let c = 0; c < 3; c++) {
      const p = t[c] * m;
      const i0 = Math.min(Math.floor(p), m);
      const i1 = Math.min(i0 + 1, m);
      const f = p - i0;
      out[c] = data[i0 * 3 + c] * (1 - f) + data[i1 * 3 + c] * f;
    }
    return out;
  }
  const px = t[0] * m;
  const py = t[1] * m;
  const pz = t[2] * m;
  const x0 = Math.min(Math.floor(px), m);
  const y0 = Math.min(Math.floor(py), m);
  const z0 = Math.min(Math.floor(pz), m);
  const x1 = Math.min(x0 + 1, m);
  const y1 = Math.min(y0 + 1, m);
  const z1 = Math.min(z0 + 1, m);
  const fx = px - x0;
  const fy = py - y0;
  const fz = pz - z0;
  const at = (x: number, y: number, z: number, c: number): number =>
    data[((z * size + y) * size + x) * 3 + c];
  for (let c = 0; c < 3; c++) {
    const c00 = at(x0, y0, z0, c) * (1 - fx) + at(x1, y0, z0, c) * fx;
    const c10 = at(x0, y1, z0, c) * (1 - fx) + at(x1, y1, z0, c) * fx;
    const c01 = at(x0, y0, z1, c) * (1 - fx) + at(x1, y0, z1, c) * fx;
    const c11 = at(x0, y1, z1, c) * (1 - fx) + at(x1, y1, z1, c) * fx;
    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;
    out[c] = c0 * (1 - fz) + c1 * fz;
  }
  return out;
}

export interface CubeLutTable {
  /** Edge length of the 3D table. */
  size: number;
  /**
   * Float RGB table, red fastest, indexed by input normalised to [0,1] over
   * the file's DOMAIN_MIN..DOMAIN_MAX. Output values are NOT clamped.
   */
  floatData: Float32Array;
}

export const DEFAULT_RESAMPLED_3D_SIZE = 33;

/**
 * Convert any cube LUT to a normalised-input 3D float table. A default-domain
 * 3D LUT is copied as is; 1D LUTs and non-default domains are resampled so
 * downstream code can treat input as 0..1. The domain remap is baked in.
 */
export function cubeLutToTable(
  lut: CubeLut,
  resampledSize: number = DEFAULT_RESAMPLED_3D_SIZE,
): CubeLutTable {
  const defaultDomain =
    lut.domainMin.every((v) => v === 0) && lut.domainMax.every((v) => v === 1);
  if (lut.kind === "3d" && defaultDomain) {
    return { size: lut.size, floatData: lut.data };
  }
  const size = lut.kind === "3d" ? lut.size : resampledSize;
  const out = new Float32Array(size * size * size * 3);
  const m = size - 1;
  let o = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const rgb: CubeVec3 = [
          lut.domainMin[0] + (r / m) * (lut.domainMax[0] - lut.domainMin[0]),
          lut.domainMin[1] + (g / m) * (lut.domainMax[1] - lut.domainMin[1]),
          lut.domainMin[2] + (b / m) * (lut.domainMax[2] - lut.domainMin[2]),
        ];
        const s = sampleCubeLut(lut, rgb);
        out[o++] = s[0];
        out[o++] = s[1];
        out[o++] = s[2];
      }
    }
  }
  return { size, floatData: out };
}

/** 8-bit quantisation of a float table, for the legacy persisted/GPU byte path only. */
export function quantizeTable(floatData: Float32Array): Uint8Array {
  const out = new Uint8Array(floatData.length);
  for (let i = 0; i < floatData.length; i++) {
    out[i] = Math.round(clamp01(floatData[i]) * 255);
  }
  return out;
}

/**
 * Parse .cube text straight into the engine's LUT shape (float table plus 8-bit
 * fallback). 1D files also carry `curve1d`, the exact per-channel curve, which
 * the CPU, WebGL and HDR paths apply natively; `data`/`floatData` hold a resampled 3D
 * approximation for consumers that only understand 3D tables.
 */
export function parseCubeToLutData(content: string): LUTData {
  const lut = parseCubeLut(content);
  const table = cubeLutToTable(lut);
  const result: LUTData = {
    data: quantizeTable(table.floatData),
    floatData: table.floatData,
    size: table.size,
    intensity: 1,
  };
  if (lut.kind === "1d") {
    result.curve1d = {
      size: lut.size,
      domainMin: [...lut.domainMin],
      domainMax: [...lut.domainMax],
      data: lut.data,
    };
  }
  return result;
}
