import { acesGlslCore } from "../../video/aces-glsl";
import { fixedCallGlsl, fixedLibGlsl } from "./fixed";
import { FLT_MIN, lut1dFlatEnds, OcioUnsupportedError, type Op, type V3 } from "./ops";

/**
 * GLSL ES 3.00 for an op list: one self-contained snippet defining `vec3 ocioTransform(vec3 c)` (scene colour in,
 * colour out, alpha untouched by the caller) and, when the list has LUTs, `uniform sampler2D ocioLut;` backed by an RGBA32F
 * data texture read with `texelFetch` (so no float-linear extension is needed and interpolation, trilinear or tetrahedral,
 * is done here exactly as the CPU does it). A program includes one snippet.
 */

export const OCIO_LUT_TEXTURE_WIDTH = 2048;
const MAX_TEXELS = OCIO_LUT_TEXTURE_WIDTH * 4096;

export interface OcioLutTexture {
  readonly data: Float32Array;
  readonly width: number;
  readonly height: number;
}

export interface OcioGlsl {
  readonly source: string;
  readonly lut: OcioLutTexture | null;
}

function glf(v: number): string {
  if (v === 0) return Object.is(v, -0) ? "-0.0" : "0.0";
  if (!Number.isFinite(v)) throw new OcioUnsupportedError("A transform parameter is not finite.");
  const s = String(Number(v.toPrecision(17)));
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

const vec3 = (v: V3): string => `vec3(${glf(v[0])}, ${glf(v[1])}, ${glf(v[2])})`;

const LIB = `
float ocioPow(float x, float g) { return x <= 0.0 ? 0.0 : pow(x, g); }
float ocioExp1(float x, float g, int style) {
  if (style == 1) return x < 0.0 ? -ocioPow(-x, g) : ocioPow(x, g);
  if (style == 2) return x < 0.0 ? x : ocioPow(x, g);
  return x < 0.0 ? 0.0 : ocioPow(x, g);
}
float ocioExplin1(float x, float g, float off, bool mirror, bool inv) {
  float s = (mirror && x < 0.0) ? -1.0 : 1.0;
  float v = s * x;
  float slope = pow((g - 1.0) / off, g - 1.0) * pow((1.0 + off) / g, g);
  float brk = off / (g - 1.0);
  float r;
  if (!inv) r = v >= brk ? pow((v + off) / (1.0 + off), g) : v / slope;
  else r = v >= brk / slope ? (1.0 + off) * ocioPow(v, 1.0 / g) - off : v * slope;
  return s * r;
}
float ocioLog1(float x, float base, float ls, float lo, float ns, float no, float brk, float lslope, float loff, float logBrk, bool hasBrk, bool inv) {
  float ln = log(base);
  if (!inv) {
    if (hasBrk && x < brk) return lslope * x + loff;
    return ls * (log(max(ns * x + no, ${glf(FLT_MIN)})) / ln) + lo;
  }
  if (hasBrk && x < logBrk) return (x - loff) / lslope;
  return (exp(((x - lo) / ls) * ln) - no) / ns;
}
float ocioPqOetf(float x) {
  float p = pow(max(x * 0.01, 0.0), 0.1593017578125);
  return pow((0.8359375 + 18.8515625 * p) / (1.0 + 18.6875 * p), 78.84375);
}
float ocioPqEotf(float e) {
  float p = pow(max(e, 0.0), 1.0 / 78.84375);
  return pow(max(p - 0.8359375, 0.0) / (18.8515625 - 18.6875 * p), 1.0 / 0.1593017578125) * 100.0;
}
float ocioHlgOetf(float x) {
  float v = max(x / 3.0, 0.0);
  return v <= 1.0 / 12.0 ? sqrt(3.0 * v) : 0.17883277 * log(12.0 * v - 0.28466892) + 0.55991073;
}
float ocioHlgInv(float y) {
  float v = max(y, 0.0);
  return 3.0 * (v <= 0.5 ? v * v / 3.0 : (exp((v - 0.55991073) / 0.17883277) + 0.28466892) / 12.0);
}
float ocioAcescc(float y) {
  if (y < (9.72 - 15.0) / 17.52) return (exp2(y * 17.52 - 9.72) - exp2(-16.0)) * 2.0;
  return exp2(y * 17.52 - 9.72);
}
float ocioOdd(float x, int fn) {
  float a = abs(x);
  float r = fn == 0 ? ocioPqOetf(a) : fn == 1 ? ocioPqEotf(a) : fn == 2 ? ocioHlgOetf(a) : ocioHlgInv(a);
  return x < 0.0 ? -r : r;
}
`;

const LUT_LIB = `
uniform sampler2D ocioLut;
vec3 ocioFetch(int idx) { return texelFetch(ocioLut, ivec2(idx & ${OCIO_LUT_TEXTURE_WIDTH - 1}, idx >> 11), 0).rgb; }
float ocioLut1dCh(float x, int off, int n, int ch) {
  float t = clamp(x, 0.0, 1.0) * float(n - 1);
  int i0 = min(int(t), n - 2);
  float f = t - float(i0);
  return mix(ocioFetch(off + i0)[ch], ocioFetch(off + i0 + 1)[ch], f);
}
float ocioLut1dInvCh(float y, int off, int n, int ch, int sIdx, int eIdx) {
  float first = ocioFetch(off)[ch];
  float last = ocioFetch(off + n - 1)[ch];
  bool inc = last >= first;
  if (inc ? y <= first : y >= first) return float(sIdx) / float(n - 1);
  if (inc ? y >= last : y <= last) return float(eIdx) / float(n - 1);
  int lo = 0;
  int hi = n - 1;
  for (int it = 0; it < 24; it++) {
    if (hi - lo <= 1) break;
    int mid = (lo + hi) / 2;
    float v = ocioFetch(off + mid)[ch];
    if (inc ? v <= y : v >= y) lo = mid; else hi = mid;
  }
  float a = ocioFetch(off + lo)[ch];
  float b = ocioFetch(off + hi)[ch];
  float f = b == a ? 0.0 : (y - a) / (b - a);
  return (float(lo) + f) / float(n - 1);
}
vec3 ocioLut3d(vec3 rgb, int off, int n, bool tetra) {
  vec3 p = clamp(rgb, 0.0, 1.0) * float(n - 1);
  ivec3 i0 = min(ivec3(p), ivec3(n - 2));
  vec3 f = p - vec3(i0);
  int base = off + i0.r + n * (i0.g + n * i0.b);
  int sg = n;
  int sb = n * n;
  vec3 v000 = ocioFetch(base);
  vec3 v111 = ocioFetch(base + 1 + sg + sb);
  if (!tetra) {
    vec3 v100 = ocioFetch(base + 1);
    vec3 v010 = ocioFetch(base + sg);
    vec3 v110 = ocioFetch(base + 1 + sg);
    vec3 v001 = ocioFetch(base + sb);
    vec3 v101 = ocioFetch(base + 1 + sb);
    vec3 v011 = ocioFetch(base + sg + sb);
    vec3 c00 = mix(v000, v100, f.r);
    vec3 c10 = mix(v010, v110, f.r);
    vec3 c01 = mix(v001, v101, f.r);
    vec3 c11 = mix(v011, v111, f.r);
    return mix(mix(c00, c10, f.g), mix(c01, c11, f.g), f.b);
  }
  float fr = f.r;
  float fg = f.g;
  float fb = f.b;
  if (fr > fg) {
    if (fg > fb) return (1.0 - fr) * v000 + (fr - fg) * ocioFetch(base + 1) + (fg - fb) * ocioFetch(base + 1 + sg) + fb * v111;
    if (fr > fb) return (1.0 - fr) * v000 + (fr - fb) * ocioFetch(base + 1) + (fb - fg) * ocioFetch(base + 1 + sb) + fg * v111;
    return (1.0 - fb) * v000 + (fb - fr) * ocioFetch(base + sb) + (fr - fg) * ocioFetch(base + 1 + sb) + fg * v111;
  }
  if (fb > fg) return (1.0 - fb) * v000 + (fb - fg) * ocioFetch(base + sb) + (fg - fr) * ocioFetch(base + sg + sb) + fr * v111;
  if (fb > fr) return (1.0 - fg) * v000 + (fg - fb) * ocioFetch(base + sg) + (fb - fr) * ocioFetch(base + sg + sb) + fr * v111;
  return (1.0 - fg) * v000 + (fg - fr) * ocioFetch(base + sg) + (fr - fb) * ocioFetch(base + 1 + sg) + fb * v111;
}
`;

const ACES_EXTRA = `
vec3 ocioAces13SdrVideo(vec3 ap0) { return acesSdrXyz(ap0); }
vec3 ocioAces13Hdr1000(vec3 ap0) { return acesHdrXyz(ap0) * 10.0; }
`;

function logParams(op: Extract<Op, { k: "log" }>, ch: 0 | 1 | 2): string {
  const ln = Math.log(op.base);
  const ls = op.ls[ch];
  const lo = op.lo[ch];
  const ns = op.ns[ch];
  const no = op.no[ch];
  let brk = 0;
  let lslope = 1;
  let loff = 0;
  let logBrk = 0;
  const hasBrk = op.brk !== null;
  if (op.brk !== null) {
    brk = op.brk[ch];
    const atBreak = ls * (Math.log(Math.max(ns * brk + no, FLT_MIN)) / ln) + lo;
    lslope = op.lslope ? op.lslope[ch] : (ls * ns) / ((ns * brk + no) * ln);
    loff = atBreak - lslope * brk;
    logBrk = atBreak;
  }
  return [op.base, ls, lo, ns, no, brk, lslope, loff, logBrk].map(glf).join(", ") + `, ${hasBrk ? "true" : "false"}`;
}

export function generateOcioGlsl(ops: readonly Op[]): OcioGlsl {
  const body: string[] = [];
  let needsLut = false;
  let needsFixed = false;
  let needsAces = false;
  const lutChunks: Float32Array[] = [];
  let lutTexels = 0;
  const addLut = (data: Float32Array): number => {
    const offset = lutTexels;
    lutChunks.push(data);
    lutTexels += data.length / 3;
    return offset;
  };

  for (const op of ops) {
    switch (op.k) {
      case "mat": {
        const m = op.m;
        // GLSL mat3 is column-major.
        body.push(`  c = mat3(${[m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]].map(glf).join(", ")}) * c + ${vec3(op.o)};`);
        break;
      }
      case "exp": {
        const g = op.inv ? ([1 / op.g[0], 1 / op.g[1], 1 / op.g[2]] as const) : op.g;
        const style = op.style === "mirror" ? 1 : op.style === "pass" ? 2 : 0;
        body.push(`  c = vec3(ocioExp1(c.r, ${glf(g[0])}, ${style}), ocioExp1(c.g, ${glf(g[1])}, ${style}), ocioExp1(c.b, ${glf(g[2])}, ${style}));`);
        break;
      }
      case "explin": {
        const mirror = op.style === "mirror" ? "true" : "false";
        const inv = op.inv ? "true" : "false";
        if (op.off.every((o) => o <= 0)) {
          // No linear segment: a plain power law (the CPU evaluator does the same).
          const g = op.inv ? ([1 / op.g[0], 1 / op.g[1], 1 / op.g[2]] as const) : op.g;
          const style = op.style === "mirror" ? 1 : 0;
          body.push(`  c = vec3(ocioExp1(c.r, ${glf(g[0])}, ${style}), ocioExp1(c.g, ${glf(g[1])}, ${style}), ocioExp1(c.b, ${glf(g[2])}, ${style}));`);
          break;
        }
        if (op.off.some((o) => o <= 0)) throw new OcioUnsupportedError("An ExponentWithLinearTransform with a zero offset on some channels only is not evaluated on the GPU.");
        body.push(`  c = vec3(ocioExplin1(c.r, ${glf(op.g[0])}, ${glf(op.off[0])}, ${mirror}, ${inv}), ocioExplin1(c.g, ${glf(op.g[1])}, ${glf(op.off[1])}, ${mirror}, ${inv}), ocioExplin1(c.b, ${glf(op.g[2])}, ${glf(op.off[2])}, ${mirror}, ${inv}));`);
        break;
      }
      case "log": {
        const inv = op.inv ? "true" : "false";
        body.push(`  c = vec3(ocioLog1(c.r, ${logParams(op, 0)}, ${inv}), ocioLog1(c.g, ${logParams(op, 1)}, ${inv}), ocioLog1(c.b, ${logParams(op, 2)}, ${inv}));`);
        break;
      }
      case "cdl": {
        const cl = (e: string): string => (op.noclamp ? e : `clamp(${e}, 0.0, 1.0)`);
        const pw = (e: string, p: string): string => (op.noclamp ? `vec3(ocioNcPow((${e}).r, (${p}).r), ocioNcPow((${e}).g, (${p}).g), ocioNcPow((${e}).b, (${p}).b))` : `pow(${e}, ${p})`);
        body.push("  {");
        body.push(`    vec3 slope = ${vec3(op.slope)}; vec3 offs = ${vec3(op.offset)}; vec3 pwr = ${vec3(op.power)}; float sat = ${glf(op.sat)};`);
        if (!op.inv) {
          body.push(`    c = ${pw(cl("c * slope + offs"), "pwr")};`);
          body.push("    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));");
          body.push(`    c = ${cl("vec3(luma) + sat * (c - vec3(luma))")};`);
        } else {
          body.push(`    c = ${cl("c")};`);
          body.push("    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));");
          body.push(`    c = ${cl("vec3(luma) + (c - vec3(luma)) / sat")};`);
          body.push(`    c = ${cl(`(${pw("c", "(vec3(1.0) / pwr)")} - offs) / slope`)};`);
        }
        body.push("  }");
        break;
      }
      case "range": {
        const { minIn, maxIn, minOut, maxOut } = op;
        const scaling = minIn !== null && maxIn !== null && minOut !== null && maxOut !== null;
        if (scaling) {
          const scale = (maxOut - minOut) / (maxIn - minIn);
          const offset = minOut - minIn * scale;
          body.push(`  c = c * ${glf(scale)} + ${glf(offset)};`);
        }
        if (!op.noclamp) {
          const lo = minOut ?? (scaling ? null : minIn);
          const hi = maxOut ?? (scaling ? null : maxIn);
          if (lo !== null) body.push(`  c = max(c, vec3(${glf(lo)}));`);
          if (hi !== null) body.push(`  c = min(c, vec3(${glf(hi)}));`);
        }
        break;
      }
      case "fixed": {
        const call = fixedCallGlsl(op.style, op.params, op.inv);
        if (!call) throw new OcioUnsupportedError(`The fixed function ${op.style} has no shader form.`);
        needsFixed = true;
        body.push(`  ${call}`);
        break;
      }
      case "lut1d": {
        needsLut = true;
        const off = addLut(op.lut.data);
        const fn = op.inv ? "ocioLut1dInvCh" : "ocioLut1dCh";
        body.push(
          `  c = vec3(${[0, 1, 2]
            .map((ch) => {
              if (!op.inv) return `${fn}(c[${ch}], ${off}, ${op.lut.size}, ${ch})`;
              const ends = lut1dFlatEnds(op.lut, ch);
              return `${fn}(c[${ch}], ${off}, ${op.lut.size}, ${ch}, ${ends.start}, ${ends.end})`;
            })
            .join(", ")});`,
        );
        break;
      }
      case "lut3d": {
        needsLut = true;
        const off = addLut(op.lut.data);
        body.push(`  c = ocioLut3d(c, ${off}, ${op.lut.size}, ${op.tetra ? "true" : "false"});`);
        break;
      }
      case "analytic": {
        switch (op.id) {
          case "pq_oetf":
            body.push("  c = vec3(ocioOdd(c.r, 0), ocioOdd(c.g, 0), ocioOdd(c.b, 0));");
            break;
          case "pq_eotf":
            body.push("  c = vec3(ocioOdd(c.r, 1), ocioOdd(c.g, 1), ocioOdd(c.b, 1));");
            break;
          case "hlg_oetf":
            body.push("  c = vec3(ocioOdd(c.r, 2), ocioOdd(c.g, 2), ocioOdd(c.b, 2));");
            break;
          case "hlg_oetf_inv":
            body.push("  c = vec3(ocioOdd(c.r, 3), ocioOdd(c.g, 3), ocioOdd(c.b, 3));");
            break;
          case "acescc_decode":
            body.push("  c = vec3(ocioAcescc(c.r), ocioAcescc(c.g), ocioAcescc(c.b));");
            break;
          case "aces13_sdr_video":
            needsAces = true;
            body.push("  c = ocioAces13SdrVideo(c);");
            break;
          case "aces13_hdr_1000_rec2020":
            needsAces = true;
            body.push("  c = ocioAces13Hdr1000(c);");
            break;
        }
        break;
      }
    }
  }

  let lut: OcioLutTexture | null = null;
  if (needsLut) {
    if (lutTexels > MAX_TEXELS) throw new OcioUnsupportedError("The LUTs of this transform are too large for one GPU texture.");
    const width = OCIO_LUT_TEXTURE_WIDTH;
    const height = Math.max(1, Math.ceil(lutTexels / width));
    const data = new Float32Array(width * height * 4);
    let texel = 0;
    for (const chunk of lutChunks) {
      for (let i = 0; i < chunk.length; i += 3, texel++) {
        data[texel * 4] = chunk[i];
        data[texel * 4 + 1] = chunk[i + 1];
        data[texel * 4 + 2] = chunk[i + 2];
        data[texel * 4 + 3] = 1;
      }
    }
    lut = { data, width, height };
  }

  const usesNcPow = ops.some((o) => o.k === "cdl" && o.noclamp);
  const source = [
    LIB,
    usesNcPow ? "float ocioNcPow(float x, float p) { return x < 0.0 ? x : ocioPow(x, p); }" : "",
    needsLut ? LUT_LIB : "",
    needsFixed ? fixedLibGlsl() : "",
    needsAces ? `${acesGlslCore()}\n${ACES_EXTRA}` : "",
    "vec3 ocioTransform(vec3 c) {",
    ...body,
    "  return c;",
    "}",
  ].join("\n");
  return { source, lut };
}
