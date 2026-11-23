import { FLOW_CONSTANTS as K } from "./types";

/**
 * WGSL kernels of the dense optical-flow interpolator. Each one mirrors a stage of the CPU reference in
 * optical-flow-cpu.ts (same formulas, same constants, same border clamping); floating-point summation order is the
 * only difference, so GPU and CPU agree within a small tolerance (checked in the browser e2e).
 * Buffers are f32 storage, flow fields interleave (dx, dy).
 */
const lit = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

const PRELUDE = /* wgsl */ `
fn clf(v: f32, lo: f32, hi: f32) -> f32 { return min(max(v, lo), hi); }
fn cli(v: i32, lo: i32, hi: i32) -> i32 { return min(max(v, lo), hi); }
`;

/** Bilinear read of a w x h f32 plane held in the storage array `buf`. */
const planeFns = (buf: string, pre: string): string => /* wgsl */ `
fn ${pre}at(w: i32, h: i32, x: i32, y: i32) -> f32 { return ${buf}[u32(cli(y, 0, h - 1) * w + cli(x, 0, w - 1))]; }
fn ${pre}bil(w: i32, h: i32, x: f32, y: f32) -> f32 {
  let xc = clf(x, 0.0, f32(w - 1));
  let yc = clf(y, 0.0, f32(h - 1));
  let x0 = i32(floor(xc));
  let y0 = i32(floor(yc));
  let x1 = min(w - 1, x0 + 1);
  let y1 = min(h - 1, y0 + 1);
  let fx = xc - f32(x0);
  let fy = yc - f32(y0);
  let top = ${buf}[u32(y0 * w + x0)] * (1.0 - fx) + ${buf}[u32(y0 * w + x1)] * fx;
  let bot = ${buf}[u32(y1 * w + x0)] * (1.0 - fx) + ${buf}[u32(y1 * w + x1)] * fx;
  return top * (1.0 - fy) + bot * fy;
}
`;

/** Bilinear read of a w x h interleaved 2-channel field, result (c0, c1). */
const fieldFns = (buf: string, pre: string): string => /* wgsl */ `
fn ${pre}field(w: i32, h: i32, u: f32, v: f32) -> vec2<f32> {
  let uc = clf(u, 0.0, f32(w - 1));
  let vc = clf(v, 0.0, f32(h - 1));
  let x0 = i32(floor(uc));
  let y0 = i32(floor(vc));
  let x1 = min(w - 1, x0 + 1);
  let y1 = min(h - 1, y0 + 1);
  let fx = uc - f32(x0);
  let fy = vc - f32(y0);
  let a = vec2<f32>(${buf}[u32((y0 * w + x0) * 2)], ${buf}[u32((y0 * w + x0) * 2 + 1)]);
  let b = vec2<f32>(${buf}[u32((y0 * w + x1) * 2)], ${buf}[u32((y0 * w + x1) * 2 + 1)]);
  let c = vec2<f32>(${buf}[u32((y1 * w + x0) * 2)], ${buf}[u32((y1 * w + x0) * 2 + 1)]);
  let d = vec2<f32>(${buf}[u32((y1 * w + x1) * 2)], ${buf}[u32((y1 * w + x1) * 2 + 1)]);
  return (a * (1.0 - fx) + b * fx) * (1.0 - fy) + (c * (1.0 - fx) + d * fx) * fy;
}
`;

export const LUMA_DOWN_WGSL = /* wgsl */ `
struct P { w: u32, h: u32, factor: u32, srcW: u32, srcH: u32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.w || g.y >= p.h) { return; }
  var sum = 0.0;
  var count = 0.0;
  let y1 = min(p.srcH, (g.y + 1u) * p.factor);
  let x1 = min(p.srcW, (g.x + 1u) * p.factor);
  for (var yy = g.y * p.factor; yy < y1; yy++) {
    for (var xx = g.x * p.factor; xx < x1; xx++) {
      let c = textureLoad(src, vec2<i32>(i32(xx), i32(yy)), 0) * 255.0;
      sum += 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
      count += 1.0;
    }
  }
  dst[g.y * p.w + g.x] = sum / (count * 255.0);
}
`;

export const HALVE_WGSL = /* wgsl */ `
struct P { sw: u32, sh: u32, w: u32, h: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.w || g.y >= p.h) { return; }
  let x0 = min(p.sw - 1u, g.x * 2u);
  let x1 = min(p.sw - 1u, g.x * 2u + 1u);
  let y0 = min(p.sh - 1u, g.y * 2u);
  let y1 = min(p.sh - 1u, g.y * 2u + 1u);
  dst[g.y * p.w + g.x] = (src[y0 * p.sw + x0] + src[y0 * p.sw + x1] + src[y1 * p.sw + x0] + src[y1 * p.sw + x1]) * 0.25;
}
`;

export const NORMALIZE_WGSL = /* wgsl */ `
${PRELUDE}
struct P { w: i32, h: i32, r: i32, pad: i32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (x >= p.w || y >= p.h) { return; }
  var s = 0.0;
  var q = 0.0;
  for (var dy = -p.r; dy <= p.r; dy++) {
    for (var dx = -p.r; dx <= p.r; dx++) {
      let v = src[u32(cli(y + dy, 0, p.h - 1) * p.w + cli(x + dx, 0, p.w - 1))];
      s += v;
      q += v * v;
    }
  }
  let taps = f32((2 * p.r + 1) * (2 * p.r + 1));
  let mean = s / taps;
  let variance = max(0.0, q / taps - mean * mean);
  dst[u32(y * p.w + x)] = (src[u32(y * p.w + x)] - mean) / sqrt(variance + ${lit(K.normEps * K.normEps)});
}
`;

export const UPSAMPLE_WGSL = /* wgsl */ `
${PRELUDE}
struct P { cw: i32, ch: i32, w: i32, h: i32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> coarse: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
${fieldFns("coarse", "c_")}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (x >= p.w || y >= p.h) { return; }
  let v = c_field(p.cw, p.ch, (f32(x) + 0.5) / 2.0 - 0.5, (f32(y) + 0.5) / 2.0 - 0.5) * 2.0;
  dst[u32((y * p.w + x) * 2)] = v.x;
  dst[u32((y * p.w + x) * 2 + 1)] = v.y;
}
`;

export const PRODUCTS_WGSL = /* wgsl */ `
${PRELUDE}
struct P { w: i32, h: i32, pad0: i32, pad1: i32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> planeA: array<f32>;
@group(0) @binding(2) var<storage, read> planeB: array<f32>;
@group(0) @binding(3) var<storage, read> flow: array<f32>;
@group(0) @binding(4) var<storage, read_write> prod: array<f32>;
${planeFns("planeA", "a_")}
${planeFns("planeB", "b_")}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (x >= p.w || y >= p.h) { return; }
  let i = y * p.w + x;
  let bx = f32(x) + flow[u32(i * 2)];
  let by = f32(y) + flow[u32(i * 2 + 1)];
  let gAx = (a_at(p.w, p.h, x + 1, y) - a_at(p.w, p.h, x - 1, y)) * 0.5;
  let gAy = (a_at(p.w, p.h, x, y + 1) - a_at(p.w, p.h, x, y - 1)) * 0.5;
  let gBx = (b_bil(p.w, p.h, bx + 1.0, by) - b_bil(p.w, p.h, bx - 1.0, by)) * 0.5;
  let gBy = (b_bil(p.w, p.h, bx, by + 1.0) - b_bil(p.w, p.h, bx, by - 1.0)) * 0.5;
  let ix = 0.5 * (gAx + gBx);
  let iy = 0.5 * (gAy + gBy);
  let it = b_bil(p.w, p.h, bx, by) - planeA[u32(i)];
  let o = u32(i * 5);
  prod[o] = ix * ix;
  prod[o + 1u] = ix * iy;
  prod[o + 2u] = iy * iy;
  prod[o + 3u] = ix * it;
  prod[o + 4u] = iy * it;
}
`;

export const SOLVE_WGSL = /* wgsl */ `
${PRELUDE}
struct P { w: i32, h: i32, r: i32, pad: i32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> prod: array<f32>;
@group(0) @binding(2) var<storage, read_write> flow: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (x >= p.w || y >= p.h) { return; }
  var s0 = 0.0; var s1 = 0.0; var s2 = 0.0; var s3 = 0.0; var s4 = 0.0;
  for (var dy = -p.r; dy <= p.r; dy++) {
    for (var dx = -p.r; dx <= p.r; dx++) {
      let o = u32((cli(y + dy, 0, p.h - 1) * p.w + cli(x + dx, 0, p.w - 1)) * 5);
      s0 += prod[o]; s1 += prod[o + 1u]; s2 += prod[o + 2u]; s3 += prod[o + 3u]; s4 += prod[o + 4u];
    }
  }
  let taps = f32((2 * p.r + 1) * (2 * p.r + 1));
  let lambda = ${lit(K.lambdaPerTap)} * taps;
  let sxx = s0 + lambda;
  let sxy = s1;
  let syy = s2 + lambda;
  let det = sxx * syy - sxy * sxy;
  let dxv = -(syy * s3 - sxy * s4) / det;
  let dyv = -(sxx * s4 - sxy * s3) / det;
  let i = u32((y * p.w + x) * 2);
  flow[i] = flow[i] + clf(dxv, -${lit(K.maxStep)}, ${lit(K.maxStep)});
  flow[i + 1u] = flow[i + 1u] + clf(dyv, -${lit(K.maxStep)}, ${lit(K.maxStep)});
}
`;

export const MEDIAN_WGSL = /* wgsl */ `
${PRELUDE}
struct P { w: i32, h: i32, pad0: i32, pad1: i32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (x >= p.w || y >= p.h) { return; }
  for (var c = 0; c < 2; c++) {
    var win: array<f32, 9>;
    var k = 0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        win[k] = src[u32((cli(y + dy, 0, p.h - 1) * p.w + cli(x + dx, 0, p.w - 1)) * 2 + c)];
        k++;
      }
    }
    for (var i = 1; i < 9; i++) {
      let v = win[i];
      var j = i - 1;
      loop {
        if (j < 0 || win[j] <= v) { break; }
        win[j + 1] = win[j];
        j--;
      }
      win[j + 1] = v;
    }
    dst[u32((y * p.w + x) * 2 + c)] = win[4];
  }
}
`;

export const MATCH_ERR_WGSL = /* wgsl */ `
${PRELUDE}
struct P { w: i32, h: i32, pad0: i32, pad1: i32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> planeA: array<f32>;
@group(0) @binding(2) var<storage, read> planeB: array<f32>;
@group(0) @binding(3) var<storage, read> flow: array<f32>;
@group(0) @binding(4) var<storage, read_write> err: array<f32>;
${planeFns("planeB", "b_")}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (x >= p.w || y >= p.h) { return; }
  let i = u32(y * p.w + x);
  err[i] = abs(planeA[i] - b_bil(p.w, p.h, f32(x) + flow[i * 2u], f32(y) + flow[i * 2u + 1u]));
}
`;

export const MATCH_CONF_WGSL = /* wgsl */ `
${PRELUDE}
struct P { w: i32, h: i32, r: i32, pad: i32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> err: array<f32>;
@group(0) @binding(2) var<storage, read_write> matchOut: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (x >= p.w || y >= p.h) { return; }
  var s = 0.0;
  for (var dy = -p.r; dy <= p.r; dy++) {
    for (var dx = -p.r; dx <= p.r; dx++) {
      s += err[u32(cli(y + dy, 0, p.h - 1) * p.w + cli(x + dx, 0, p.w - 1))];
    }
  }
  let taps = f32((2 * p.r + 1) * (2 * p.r + 1));
  matchOut[u32(y * p.w + x)] = clf((${lit(K.matchHi)} - s / taps) / (${lit(K.matchHi - K.matchLo)}), 0.0, 1.0);
}
`;

export const CONSISTENCY_WGSL = /* wgsl */ `
${PRELUDE}
struct P { w: i32, h: i32, pad0: i32, pad1: i32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> flowA: array<f32>;
@group(0) @binding(2) var<storage, read> flowB: array<f32>;
@group(0) @binding(3) var<storage, read> matchIn: array<f32>;
@group(0) @binding(4) var<storage, read_write> conf: array<f32>;
${fieldFns("flowB", "b_")}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (x >= p.w || y >= p.h) { return; }
  let i = u32(y * p.w + x);
  let f = vec2<f32>(flowA[i * 2u], flowA[i * 2u + 1u]);
  let gg = b_field(p.w, p.h, f32(x) + f.x, f32(y) + f.y);
  let e = f + gg;
  let e2 = dot(e, e);
  let thr = ${lit(K.consistencyBase)} + ${lit(K.consistencyRel)} * (dot(f, f) + dot(gg, gg));
  conf[i] = clf(2.0 - e2 / thr, 0.0, 1.0) * matchIn[i];
}
`;

export const SYNTH_WGSL = /* wgsl */ `
${PRELUDE}
struct P { W: i32, H: i32, fw: i32, fh: i32, factor: f32, t: f32, pad0: f32, pad1: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var texA: texture_2d<f32>;
@group(0) @binding(2) var texB: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> flowAB: array<f32>;
@group(0) @binding(4) var<storage, read> flowBA: array<f32>;
@group(0) @binding(5) var<storage, read> confAB: array<f32>;
@group(0) @binding(6) var<storage, read> confBA: array<f32>;
@group(0) @binding(7) var<storage, read_write> outPx: array<u32>;
${fieldFns("flowAB", "ab_")}
${fieldFns("flowBA", "ba_")}
${planeFns("confAB", "cab_")}
${planeFns("confBA", "cba_")}

fn texAt(tex: texture_2d<f32>, x: i32, y: i32) -> vec4<f32> {
  return textureLoad(tex, vec2<i32>(cli(x, 0, p.W - 1), cli(y, 0, p.H - 1)), 0) * 255.0;
}
fn texBil(tex: texture_2d<f32>, x: f32, y: f32) -> vec4<f32> {
  let xc = clf(x, 0.0, f32(p.W - 1));
  let yc = clf(y, 0.0, f32(p.H - 1));
  let x0 = i32(floor(xc));
  let y0 = i32(floor(yc));
  let x1 = min(p.W - 1, x0 + 1);
  let y1 = min(p.H - 1, y0 + 1);
  let fx = xc - f32(x0);
  let fy = yc - f32(y0);
  let top = texAt(tex, x0, y0) * (1.0 - fx) + texAt(tex, x1, y0) * fx;
  let bot = texAt(tex, x0, y1) * (1.0 - fx) + texAt(tex, x1, y1) * fx;
  return top * (1.0 - fy) + bot * fy;
}
fn diff3(a: vec4<f32>, b: vec4<f32>) -> f32 {
  return (abs(a.x - b.x) + abs(a.y - b.y) + abs(a.z - b.z)) / (3.0 * 255.0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (x >= p.W || y >= p.H) { return; }
  let t = p.t;
  let f = p.factor;
  let pos = vec2<f32>(f32(x), f32(y));
  let sigma2 = ${lit(K.photometricSigma * K.photometricSigma)};

  let z0 = texBil(texA, pos.x, pos.y);
  let z1 = texBil(texB, pos.x, pos.y);
  let dZero = diff3(z0, z1);
  let colZ = z0 * (1.0 - t) + z1 * t;

  var q = pos;
  for (var it = 0; it < ${K.fixedPointIterations}; it++) {
    let v = ab_field(p.fw, p.fh, (q.x + 0.5) / f - 0.5, (q.y + 0.5) / f - 0.5);
    q = pos - t * v * f;
  }
  let uvf = (q + vec2<f32>(0.5, 0.5)) / f - vec2<f32>(0.5, 0.5);
  let fd = ab_field(p.fw, p.fh, uvf.x, uvf.y) * f;
  let cf = cab_bil(p.fw, p.fh, uvf.x, uvf.y);
  let c0 = texBil(texA, pos.x - t * fd.x, pos.y - t * fd.y);
  let c1 = texBil(texB, pos.x + (1.0 - t) * fd.x, pos.y + (1.0 - t) * fd.y);
  let df = diff3(c0, c1);
  let gf = clf((${lit(K.gateRatio)} - df / (dZero + 0.02)) / ${lit(K.gateSoftness)}, 0.0, 1.0);
  let wf = cf * exp(-(df * df) / sigma2) * gf;
  let colF = c0 * (1.0 - t) + c1 * t;

  q = pos;
  for (var it = 0; it < ${K.fixedPointIterations}; it++) {
    let v = ba_field(p.fw, p.fh, (q.x + 0.5) / f - 0.5, (q.y + 0.5) / f - 0.5);
    q = pos - (1.0 - t) * v * f;
  }
  let uvb = (q + vec2<f32>(0.5, 0.5)) / f - vec2<f32>(0.5, 0.5);
  let bd = ba_field(p.fw, p.fh, uvb.x, uvb.y) * f;
  let cb = cba_bil(p.fw, p.fh, uvb.x, uvb.y);
  let c2 = texBil(texB, pos.x - (1.0 - t) * bd.x, pos.y - (1.0 - t) * bd.y);
  let c3 = texBil(texA, pos.x + t * bd.x, pos.y + t * bd.y);
  let db = diff3(c3, c2);
  let gb = clf((${lit(K.gateRatio)} - db / (dZero + 0.02)) / ${lit(K.gateSoftness)}, 0.0, 1.0);
  let wb = cb * exp(-(db * db) / sigma2) * gb;
  let colB = c3 * (1.0 - t) + c2 * t;

  let wz = ${lit(K.blendFloor)};
  let v = (wf * colF + wb * colB + wz * colZ) / (wf + wb + wz);
  let r = vec4<u32>(vec4<f32>(clamp(floor(v + vec4<f32>(0.5)), vec4<f32>(0.0), vec4<f32>(255.0))));
  outPx[u32(y * p.W + x)] = r.x | (r.y << 8u) | (r.z << 16u) | (r.w << 24u);
}
`;
