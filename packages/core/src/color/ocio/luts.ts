/**
 * LUT file readers for the formats an OCIO FileTransform commonly points at: `.cube` (1D and 3D, Resolve / Adobe),
 * `.spi1d` / `.spi3d` (Sony Pictures Imageworks) and `.csp` (Cinespace, with its per-channel pre-LUT).
 * A reader returns the tables plus the input domain; `ops.ts` turns a domain other than 0..1 into a matrix in front of
 * the table, as OpenColorIO does.
 */

export class LutParseError extends Error {}

export interface Lut1D {
  readonly kind: "lut1d";
  readonly size: number;
  /** size * 3 floats (R, G, B per entry). A one-component file is expanded. */
  readonly data: Float32Array;
  readonly domainMin: readonly [number, number, number];
  readonly domainMax: readonly [number, number, number];
}

export interface Lut3D {
  readonly kind: "lut3d";
  readonly size: number;
  /** size^3 * 3 floats, red index fastest then green then blue. */
  readonly data: Float32Array;
  readonly domainMin: readonly [number, number, number];
  readonly domainMax: readonly [number, number, number];
}

/** A Cinespace pre-LUT: per channel a piecewise linear curve from `inputs` to `outputs`. */
export interface PreLut {
  readonly kind: "prelut";
  readonly inputs: readonly [Float64Array, Float64Array, Float64Array];
  readonly outputs: readonly [Float64Array, Float64Array, Float64Array];
}

export type LutFile = { readonly format: string; readonly parts: readonly (Lut1D | Lut3D | PreLut)[] };

export const MAX_LUT_ENTRIES = 4_000_000;

function numbersOf(line: string): number[] {
  return line.trim().split(/\s+/).map(Number);
}

function allFinite(values: readonly number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

export function parseCube(text: string): LutFile {
  let size1 = 0;
  let size3 = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const rows: number[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const first = line.charCodeAt(0);
    const isNumeric = (first >= 48 && first <= 57) || first === 45 || first === 43 || first === 46;
    if (!isNumeric) {
      const [key, ...rest] = line.split(/\s+/);
      switch (key.toUpperCase()) {
        case "TITLE":
          break;
        case "LUT_1D_SIZE":
          size1 = Number.parseInt(rest[0], 10);
          break;
        case "LUT_3D_SIZE":
          size3 = Number.parseInt(rest[0], 10);
          break;
        case "DOMAIN_MIN": {
          const v = rest.map(Number);
          if (v.length === 3 && allFinite(v)) domainMin = v as [number, number, number];
          else throw new LutParseError("Bad DOMAIN_MIN in the .cube file.");
          break;
        }
        case "DOMAIN_MAX": {
          const v = rest.map(Number);
          if (v.length === 3 && allFinite(v)) domainMax = v as [number, number, number];
          else throw new LutParseError("Bad DOMAIN_MAX in the .cube file.");
          break;
        }
        case "LUT_1D_INPUT_RANGE":
        case "LUT_3D_INPUT_RANGE": {
          const v = rest.map(Number);
          if (v.length === 2 && allFinite(v)) {
            domainMin = [v[0], v[0], v[0]];
            domainMax = [v[1], v[1], v[1]];
          }
          break;
        }
        default:
          throw new LutParseError(`Unknown .cube keyword "${key}".`);
      }
      continue;
    }
    const v = numbersOf(line);
    if (v.length < 3 || !allFinite(v)) throw new LutParseError("Bad data row in the .cube file.");
    rows.push(v[0], v[1], v[2]);
  }
  if (size1 < 0 || size3 < 0 || (size1 === 0 && size3 === 0) || Number.isNaN(size1) || Number.isNaN(size3)) {
    throw new LutParseError("The .cube file has no valid LUT_1D_SIZE or LUT_3D_SIZE.");
  }
  const n1 = size1 > 0 ? size1 : 0;
  const n3 = size3 > 0 ? size3 * size3 * size3 : 0;
  if (n1 + n3 > MAX_LUT_ENTRIES) throw new LutParseError("The .cube file is too large.");
  if (rows.length !== (n1 + n3) * 3) {
    throw new LutParseError(`The .cube file has ${rows.length / 3} data rows, expected ${n1 + n3}.`);
  }
  const parts: (Lut1D | Lut3D)[] = [];
  if (n1 > 0) parts.push({ kind: "lut1d", size: size1, data: Float32Array.from(rows.slice(0, n1 * 3)), domainMin, domainMax });
  if (n3 > 0) parts.push({ kind: "lut3d", size: size3, data: Float32Array.from(rows.slice(n1 * 3)), domainMin, domainMax });
  return { format: "cube", parts };
}

export function parseSpi1d(text: string): LutFile {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let from: [number, number] = [0, 1];
  let length = 0;
  let components = 1;
  let i = 0;
  if (!/^Version\s+1/i.test(lines[0] ?? "")) throw new LutParseError("Not an .spi1d file.");
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === "{") {
      i++;
      break;
    }
    const m = /^(\w+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "from") {
      const v = numbersOf(m[2]);
      if (v.length === 2 && allFinite(v)) from = [v[0], v[1]];
    } else if (key === "length") length = Number.parseInt(m[2], 10);
    else if (key === "components") components = Number.parseInt(m[2], 10);
  }
  if (!(length > 1) || (components !== 1 && components !== 3)) throw new LutParseError("Bad .spi1d header.");
  if (length > MAX_LUT_ENTRIES) throw new LutParseError("The .spi1d file is too large.");
  const data = new Float32Array(length * 3);
  let n = 0;
  for (; i < lines.length && lines[i] !== "}" && n < length; i++) {
    if (!lines[i]) continue;
    const v = numbersOf(lines[i]);
    if (!allFinite(v) || v.length < components) throw new LutParseError("Bad data row in the .spi1d file.");
    if (components === 1) data.set([v[0], v[0], v[0]], n * 3);
    else data.set([v[0], v[1], v[2]], n * 3);
    n++;
  }
  if (n !== length) throw new LutParseError(`The .spi1d file has ${n} entries, expected ${length}.`);
  return {
    format: "spi1d",
    parts: [{ kind: "lut1d", size: length, data, domainMin: [from[0], from[0], from[0]], domainMax: [from[1], from[1], from[1]] }],
  };
}

export function parseSpi3d(text: string): LutFile {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!/^SPILUT/i.test(lines[0] ?? "")) throw new LutParseError("Not an .spi3d file.");
  const dims = numbersOf(lines[2] ?? "");
  if (dims.length !== 3 || dims[0] !== dims[1] || dims[1] !== dims[2] || !(dims[0] > 1)) throw new LutParseError("The .spi3d file must be a cube of one size.");
  const size = dims[0];
  const total = size * size * size;
  if (total > MAX_LUT_ENTRIES) throw new LutParseError("The .spi3d file is too large.");
  const data = new Float32Array(total * 3);
  const seen = new Uint8Array(total);
  let count = 0;
  for (let i = 3; i < lines.length; i++) {
    const v = numbersOf(lines[i]);
    if (v.length !== 6 || !allFinite(v)) throw new LutParseError("Bad data row in the .spi3d file.");
    const [ri, gi, bi] = v;
    if (![ri, gi, bi].every((x) => Number.isInteger(x) && x >= 0 && x < size)) throw new LutParseError("Index out of range in the .spi3d file.");
    const idx = ri + size * (gi + size * bi);
    if (!seen[idx]) count++;
    seen[idx] = 1;
    data.set([v[3], v[4], v[5]], idx * 3);
  }
  if (count !== total) throw new LutParseError(`The .spi3d file has ${count} of ${total} entries.`);
  return { format: "spi3d", parts: [{ kind: "lut3d", size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }] };
}

export function parseCsp(text: string): LutFile {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let i = 0;
  const next = (): string => {
    while (i < lines.length && lines[i] === "") i++;
    if (i >= lines.length) throw new LutParseError("The .csp file ends early.");
    return lines[i++];
  };
  if (!/^CSPLUTV100/.test(next())) throw new LutParseError("Not a .csp file.");
  const kind = next().toUpperCase();
  if (kind !== "3D" && kind !== "1D") throw new LutParseError("The .csp file is neither 1D nor 3D.");
  let line = next();
  if (/^BEGIN METADATA/i.test(line)) {
    while (!/^END METADATA/i.test(next())) {
      /* skip */
    }
    line = next();
  }
  const inputs: Float64Array[] = [];
  const outputs: Float64Array[] = [];
  for (let c = 0; c < 3; c++) {
    const count = Number.parseInt(c === 0 ? line : next(), 10);
    if (!(count >= 2) || count > 65536) throw new LutParseError("Bad pre-LUT size in the .csp file.");
    const ins = numbersOf(next());
    const outs = numbersOf(next());
    if (ins.length !== count || outs.length !== count || !allFinite(ins) || !allFinite(outs)) throw new LutParseError("Bad pre-LUT in the .csp file.");
    inputs.push(Float64Array.from(ins));
    outputs.push(Float64Array.from(outs));
  }
  const prelut: PreLut = {
    kind: "prelut",
    inputs: inputs as unknown as PreLut["inputs"],
    outputs: outputs as unknown as PreLut["outputs"],
  };
  const parts: (PreLut | Lut1D | Lut3D)[] = [prelut];
  if (kind === "3D") {
    const dims = numbersOf(next());
    if (dims.length !== 3 || dims[0] !== dims[1] || dims[1] !== dims[2] || !(dims[0] > 1)) throw new LutParseError("The .csp 3D LUT must be a cube of one size.");
    const size = dims[0];
    const total = size * size * size;
    if (total > MAX_LUT_ENTRIES) throw new LutParseError("The .csp file is too large.");
    const data = new Float32Array(total * 3);
    for (let n = 0; n < total; n++) {
      const v = numbersOf(next());
      if (v.length < 3 || !allFinite(v)) throw new LutParseError("Bad data row in the .csp file.");
      data.set([v[0], v[1], v[2]], n * 3);
    }
    parts.push({ kind: "lut3d", size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
  } else {
    const size = Number.parseInt(next(), 10);
    if (!(size > 1) || size > MAX_LUT_ENTRIES) throw new LutParseError("Bad 1D size in the .csp file.");
    const data = new Float32Array(size * 3);
    for (let n = 0; n < size; n++) {
      const v = numbersOf(next());
      if (v.length < 3 || !allFinite(v)) throw new LutParseError("Bad data row in the .csp file.");
      data.set([v[0], v[1], v[2]], n * 3);
    }
    parts.push({ kind: "lut1d", size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
  }
  return { format: "csp", parts };
}

export const SUPPORTED_LUT_EXTENSIONS = ["cube", "spi1d", "spi3d", "csp"] as const;

export function lutExtension(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : "";
}

export function parseLutFile(path: string, text: string): LutFile {
  switch (lutExtension(path)) {
    case "cube":
      return parseCube(text);
    case "spi1d":
      return parseSpi1d(text);
    case "spi3d":
      return parseSpi3d(text);
    case "csp":
      return parseCsp(text);
    default:
      throw new LutParseError(`The ".${lutExtension(path) || "?"}" LUT format is not supported (supported: ${SUPPORTED_LUT_EXTENSIONS.join(", ")}).`);
  }
}
