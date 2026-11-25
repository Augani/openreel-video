/**
 * WGSL for the WebGPU grade chain (gpu-grade-chain.ts).
 *
 * Every entry point is a line-for-line port of an existing reference and works on 8-bit values, exactly like the
 * path it replaces: each pass reads an rgba8unorm texture and writes an rgba8unorm texture, so the rounding that the
 * Canvas2D / WebGL path applied between stages (one ImageBitmap per stage) is applied here between passes, in the
 * same places. References:
 *
 *  - fs_wb         applyTemperature / applyTint (video-effects-engine.ts)
 *  - fs_fused      FUSED_SHADER / COLOR_WHEELS_SHADER / HUE_CURVES_GLSL (color-grading-engine.ts, hue-curves.ts)
 *  - fs_tone8      applyToneToData (tone-curve.ts)
 *  - fs_vignette   applyVignetteToData (tone-curve.ts)
 *  - fs_curves     applyCurvesToData (color-grading-engine.ts)
 *  - fs_lut3/1     LUT_SHADER / applyLutToData / applyCurve1dToData (color-grading-engine.ts)
 *  - fs_hsl        applyHslToData (color-grading-engine.ts)
 *  - fs_hslsec     HSL_SECONDARY (pro-effect-shaders.ts, reference hsl-secondary.ts)
 *  - fs_creative   LUMETRI_CREATIVE, fs_lens LENS_CORRECTION (pro-effect-shaders-creative.ts)
 *  - fs_dehaze / fs_deflicker / fs_deband   (pro-effect-shaders-repair.ts)
 *
 * Alpha is straight (un-premultiplied) in every intermediate; fs_present premultiplies into the canvas.
 * Pixel coordinates are integer, origin top-left, like the CPU buffers.
 */

/** Names of the uniforms each pro-effect pass reads, in the order they are packed into the uniform array. */
export const GPU_PRO_UNIFORM_ORDER = {
  "hsl-secondary": ["hMin", "hMax", "hSoft", "sMin", "sMax", "sSoft", "lMin", "lMax", "lSoft", "radius", "denoise", "invert", "mShape", "mCx", "mCy", "mHx", "mHy", "mFeather", "mInvert", "tempR", "tempG", "tempB", "wheelR", "wheelG", "wheelB", "contrast", "saturation", "sharpen", "view"],
  "lumetri-creative": ["lift", "sharpen", "vibrance", "shR", "shG", "shB", "hiR", "hiG", "hiB", "pivot"],
  "lens-correction": ["k1", "k2", "p1", "p2", "invScale", "redScale", "blueScale", "vig"],
  dehaze: ["amount", "step", "sky"],
  deflicker: ["gr", "gg", "gb"],
  deband: ["thr", "radius", "iters", "amp"],
} as const;

export type GpuProEffectType = keyof typeof GPU_PRO_UNIFORM_ORDER;

export const GPU_PRO_ENTRY: Readonly<Record<GpuProEffectType, string>> = {
  "hsl-secondary": "fs_hslsec",
  "lumetri-creative": "fs_creative",
  "lens-correction": "fs_lens",
  dehaze: "fs_dehaze",
  deflicker: "fs_deflicker",
  deband: "fs_deband",
};

/** Floats of uniform space per pass (16 vec4). */
export const GPU_UNIFORM_FLOATS = 64;

const COMMON = /* wgsl */ `
struct Params { v: array<vec4f, 16> };
@group(0) @binding(0) var<uniform> u: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var tbl: texture_2d<f32>;
@group(0) @binding(4) var lut3: texture_3d<f32>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn U(i: u32) -> f32 { return u.v[i / 4u][i % 4u]; }
fn U3(i: u32) -> vec3f { return vec3f(U(i), U(i + 1u), U(i + 2u)); }
fn res() -> vec2f { return vec2f(textureDimensions(src)); }
fn gmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }
fn q8(x: vec3f) -> vec3f { return floor(clamp(x, vec3f(0.0), vec3f(1.0)) * 255.0 + 0.5) / 255.0; }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }
fn sstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
// Texel at an integer pixel position, edge clamped.
fn fetchPx(p: vec2f) -> vec4f {
  let d = vec2i(textureDimensions(src));
  return textureLoad(src, clamp(vec2i(floor(p)), vec2i(0), d - vec2i(1)), 0);
}
// Bilinear at texel-centre coordinates (hardware edge clamp), like the GLSL fetchCont.
fn fetchCont(p: vec2f) -> vec4f { return textureSampleLevel(src, smp, (p + 0.5) / res(), 0.0); }
fn px(fc: vec4f) -> vec2f { return floor(fc.xy); }
fn outRgb(rgb: vec3f, a: f32) -> vec4f { return vec4f(q8(rgb), a); }

fn rgbToHsl01(c: vec3f) -> vec3f {
  let mx = max(max(c.r, c.g), c.b);
  let mn = min(min(c.r, c.g), c.b);
  let l = (mx + mn) / 2.0;
  if (mx == mn) { return vec3f(0.0, 0.0, l); }
  let d = mx - mn;
  var s = d / (mx + mn);
  if (l > 0.5) { s = d / (2.0 - mx - mn); }
  var h: f32;
  if (mx == c.r) { h = (c.g - c.b) / d + select(0.0, 6.0, c.g < c.b); }
  else if (mx == c.g) { h = (c.b - c.r) / d + 2.0; }
  else { h = (c.r - c.g) / d + 4.0; }
  return vec3f(h / 6.0, s, l);
}
fn hueCh(p: f32, q: f32, t0: f32) -> f32 {
  var t = t0;
  if (t < 0.0) { t += 1.0; }
  if (t > 1.0) { t -= 1.0; }
  if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
  if (t < 1.0 / 2.0) { return q; }
  if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
  return p;
}
fn hslToRgb01(hsl: vec3f) -> vec3f {
  if (hsl.y == 0.0) { return vec3f(hsl.z); }
  var q = hsl.z + hsl.y - hsl.z * hsl.y;
  if (hsl.z < 0.5) { q = hsl.z * (1.0 + hsl.y); }
  let p = 2.0 * hsl.z - q;
  return vec3f(hueCh(p, q, hsl.x + 1.0 / 3.0), hueCh(p, q, hsl.x), hueCh(p, q, hsl.x - 1.0 / 3.0));
}
`;

const GRADE = /* wgsl */ `
// ---- white balance: temperature then tint, each rounded to 8 bits like the two CPU passes -------------------------
@fragment fn fs_wb(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let s = textureLoad(src, vec2i(px(fc)), 0);
  var v = floor(s.rgb * 255.0 + 0.5);
  let t = U(0u) / 100.0;
  if (U(0u) != 0.0) {
    if (t > 0.0) {
      v = vec3f(min(255.0, v.r + t * 51.0), min(255.0, v.g + t * 25.5), max(0.0, v.b - t * 51.0));
    } else {
      v = vec3f(max(0.0, v.r + t * 51.0), max(0.0, v.g + t * 12.75), min(255.0, v.b - t * 51.0));
    }
    v = floor(v + 0.5);
  }
  let n = U(1u) / 100.0;
  if (U(1u) != 0.0) {
    v = vec3f(clamp(v.r + n * 25.5, 0.0, 255.0), clamp(v.g - n * 51.0, 0.0, 255.0), clamp(v.b + n * 25.5, 0.0, 255.0));
    v = floor(v + 0.5);
  }
  return vec4f(v / 255.0, s.a);
}

// ---- fused float pass: tone curve -> colour wheels -> hue curves; tbl row 0 = tone (r), row 1 = hue luts ---------
fn toneSample(x: f32) -> f32 {
  let position = clamp(x, 0.0, 1.0) * 255.0;
  let lower = floor(position);
  let fraction = position - lower;
  let i0 = i32(lower);
  let i1 = min(255, i0 + 1);
  let a = textureLoad(tbl, vec2i(i0, 0), 0).r;
  let b = textureLoad(tbl, vec2i(i1, 0), 0).r;
  return a + (b - a) * fraction;
}
fn hcFetch(i: i32) -> vec4f { return textureLoad(tbl, vec2i(i, 1), 0); }
fn hcSamplePeriodic(x: f32) -> vec4f {
  let wrapped = x - floor(x);
  let position = wrapped * 256.0;
  let lower = floor(position);
  let fraction = position - lower;
  let i0 = i32(lower) % 256;
  let i1 = (i0 + 1) % 256;
  return mix(hcFetch(i0), hcFetch(i1), fraction);
}
fn hcSampleClamped(x: f32) -> vec4f {
  let position = clamp(x, 0.0, 1.0) * 255.0;
  let lower = floor(position);
  let fraction = position - lower;
  let i0 = i32(lower);
  let i1 = min(255, i0 + 1);
  return mix(hcFetch(i0), hcFetch(i1), fraction);
}
fn applyHueCurves(rgb: vec3f) -> vec3f {
  let c = clamp(rgb, vec3f(0.0), vec3f(1.0));
  let lumaY = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let hsl = rgbToHsl01(c);
  let weight = smoothstep(0.0, 0.08, hsl.y);
  let byHue = hcSamplePeriodic(hsl.x);
  let byLuma = hcSampleClamped(lumaY);
  let satGain = (1.0 + (2.0 * byHue.r - 1.0) * weight) * (2.0 * byLuma.a);
  let nextHue = hsl.x + (byHue.g - 0.5) * 0.5 * weight;
  let nextSat = clamp(hsl.y * satGain, 0.0, 1.0);
  let nextLight = clamp(hsl.z + (byHue.b - 0.5) * 0.5 * weight, 0.0, 1.0);
  return hslToRgb01(vec3f(nextHue - floor(nextHue), nextSat, nextLight));
}
@fragment fn fs_fused(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let s = textureLoad(src, vec2i(px(fc)), 0);
  var rgb = s.rgb;
  if (U(0u) > 0.5) { rgb = vec3f(toneSample(rgb.r), toneSample(rgb.g), toneSample(rgb.b)); }
  if (U(1u) > 0.5) {
    let lm = dot(rgb, vec3f(0.299, 0.587, 0.114));
    let shadowWeight = 1.0 - smoothstep(0.0, 0.5, lm);
    let highlightWeight = smoothstep(0.5, 1.0, lm);
    let midtoneWeight = 1.0 - shadowWeight - highlightWeight;
    var w = rgb;
    w += U3(4u) * shadowWeight;
    w += U3(8u) * midtoneWeight;
    w += U3(12u) * highlightWeight;
    w += U(7u) * shadowWeight;
    w = pow(max(w, vec3f(0.0)), vec3f(1.0 / U(11u)));
    w = w * (1.0 + (U(15u) - 1.0) * highlightWeight);
    rgb = clamp(w, vec3f(0.0), vec3f(1.0));
  }
  if (U(2u) > 0.5) { rgb = applyHueCurves(rgb); }
  return outRgb(rgb, s.a);
}

// ---- version 1 Basic Correction: the 8-bit tone table (tbl row 0, r) ----------------------------------------------
@fragment fn fs_tone8(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let s = textureLoad(src, vec2i(px(fc)), 0);
  let v = vec3i(floor(s.rgb * 255.0 + 0.5));
  let o = vec3f(
    textureLoad(tbl, vec2i(v.r, 0), 0).r,
    textureLoad(tbl, vec2i(v.g, 0), 0).r,
    textureLoad(tbl, vec2i(v.b, 0), 0).r);
  return outRgb(o, s.a);
}

// ---- vignette on 8-bit values; v0 = (amount, midpoint, roundness, feather), v1 = (aspect, width, height) ---------
fn vignetteWeight(nx: f32, ny: f32, aspect: f32) -> f32 {
  let ellipse = length(vec2f(nx, ny)) / sqrt(2.0);
  let circle = length(vec2f(nx * aspect, ny)) / length(vec2f(aspect, 1.0));
  let rect = max(abs(nx), abs(ny));
  let roundness = clamp(U(2u), -1.0, 1.0);
  var dist = ellipse + (rect - ellipse) * -roundness;
  if (roundness >= 0.0) { dist = ellipse + (circle - ellipse) * roundness; }
  let midpoint = clamp(U(1u), 0.0, 1.0);
  let feather = clamp(U(3u), 0.0, 1.0);
  let edge0 = clamp(midpoint - feather * 0.5, 0.0, 1.0);
  let edge1 = max(edge0 + 1e-3, midpoint + feather * 0.5);
  return sstep(edge0, edge1, dist);
}
@fragment fn fs_vignette(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = px(fc);
  let s = textureLoad(src, vec2i(p), 0);
  let amount = clamp(U(0u), -1.0, 1.0);
  let nx = ((p.x + 0.5) / U(5u)) * 2.0 - 1.0;
  let ny = ((p.y + 0.5) / U(6u)) * 2.0 - 1.0;
  let weight = vignetteWeight(nx, ny, U(4u));
  if (weight == 0.0) { return s; }
  let v = floor(s.rgb * 255.0 + 0.5);
  var o: vec3f;
  if (amount < 0.0) {
    o = floor(v * (1.0 + amount * weight) + 0.5);
  } else {
    o = floor(v + (255.0 - v) * (amount * weight) + 0.5);
  }
  return vec4f(clamp(o, vec3f(0.0), vec3f(255.0)) / 255.0, s.a);
}

// ---- RGB curves: tbl row 0 = (red, green, blue, master) byte tables -------------------------------------------------
@fragment fn fs_curves(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let s = textureLoad(src, vec2i(px(fc)), 0);
  let v = vec3i(floor(s.rgb * 255.0 + 0.5));
  let r = textureLoad(tbl, vec2i(v.r, 0), 0).r;
  let g = textureLoad(tbl, vec2i(v.g, 0), 0).g;
  let b = textureLoad(tbl, vec2i(v.b, 0), 0).b;
  let mr = vec3i(floor(vec3f(r, g, b) * 255.0 + 0.5));
  return vec4f(
    textureLoad(tbl, vec2i(mr.x, 0), 0).a,
    textureLoad(tbl, vec2i(mr.y, 0), 0).a,
    textureLoad(tbl, vec2i(mr.z, 0), 0).a,
    s.a);
}

// ---- hue / sat / lum bands: v0..v1 hue (deg), v2..v3 saturation, v4..v5 luminance ---------------------------------
@fragment fn fs_hsl(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let s = textureLoad(src, vec2i(px(fc)), 0);
  let c = floor(s.rgb * 255.0 + 0.5) / 255.0;
  var hsl = rgbToHsl01(c);
  let idx = u32(floor(hsl.x * 8.0)) % 8u;
  hsl.x = gmod(hsl.x + U(idx) / 360.0 + 1.0, 1.0);
  hsl.y = clamp(hsl.y + U(8u + idx), 0.0, 1.0);
  hsl.z = clamp(hsl.z + U(16u + idx), 0.0, 1.0);
  return outRgb(hslToRgb01(hsl), s.a);
}

// ---- LUTs: v0 = (size, intensity); 3D table in lut3 (red fastest) ---------------------------------------------------
fn lutTexel(p: vec3i) -> vec3f { return textureLoad(lut3, p, 0).rgb; }
fn sampleLut3d(c: vec3f) -> vec3f {
  let m = U(0u) - 1.0;
  let idx = clamp(c, vec3f(0.0), vec3f(1.0)) * m;
  let f0 = floor(idx);
  let fr = idx - f0;
  let i0 = vec3i(f0);
  let i1 = min(i0 + vec3i(1), vec3i(i32(m)));
  let c00 = mix(lutTexel(vec3i(i0.x, i0.y, i0.z)), lutTexel(vec3i(i1.x, i0.y, i0.z)), fr.x);
  let c10 = mix(lutTexel(vec3i(i0.x, i1.y, i0.z)), lutTexel(vec3i(i1.x, i1.y, i0.z)), fr.x);
  let c01 = mix(lutTexel(vec3i(i0.x, i0.y, i1.z)), lutTexel(vec3i(i1.x, i0.y, i1.z)), fr.x);
  let c11 = mix(lutTexel(vec3i(i0.x, i1.y, i1.z)), lutTexel(vec3i(i1.x, i1.y, i1.z)), fr.x);
  return mix(mix(c00, c10, fr.y), mix(c01, c11, fr.y), fr.z);
}
@fragment fn fs_lut3(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let s = textureLoad(src, vec2i(px(fc)), 0);
  let c = floor(s.rgb * 255.0 + 0.5) / 255.0;
  let k = U(1u);
  return outRgb(c * (1.0 - k) + sampleLut3d(c) * k, s.a);
}
// Exact 1D per-channel curve over the file's domain (tbl row 0); v1 = domainMin, v2 = domainMax.
fn curveCh(v: f32, ch: u32, m: f32, dmin: f32, dmax: f32) -> f32 {
  let t = clamp((v - dmin) / (dmax - dmin), 0.0, 1.0);
  let p = t * m;
  let i0 = i32(min(floor(p), m));
  let i1 = min(i0 + 1, i32(m));
  let f = p - f32(i0);
  let a = textureLoad(tbl, vec2i(i0, 0), 0);
  let b = textureLoad(tbl, vec2i(i1, 0), 0);
  var x = a.r;
  var y = b.r;
  if (ch == 1u) { x = a.g; y = b.g; }
  if (ch == 2u) { x = a.b; y = b.b; }
  return x * (1.0 - f) + y * f;
}
@fragment fn fs_lut1(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let s = textureLoad(src, vec2i(px(fc)), 0);
  let c = floor(s.rgb * 255.0 + 0.5) / 255.0;
  let m = U(0u) - 1.0;
  let k = U(1u);
  let dmin = U3(4u);
  let dmax = U3(8u);
  let o = vec3f(curveCh(c.r, 0u, m, dmin.x, dmax.x), curveCh(c.g, 1u, m, dmin.y, dmax.y), curveCh(c.b, 2u, m, dmin.z, dmax.z));
  return outRgb(c * (1.0 - k) + o * k, s.a);
}
`;

const PRO = /* wgsl */ `
fn lumaOf(p: vec2f) -> f32 { return luma(fetchPx(p).rgb); }

// ---- HSL Secondary (qualifier + matte + correction) ----------------------------------------------------------------
fn hs_rgb2hsl(c: vec3f) -> vec3f {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  let l = (mx + mn) * 0.5;
  let d = mx - mn;
  var s = 0.0;
  var h = 0.0;
  if (d > 0.0) {
    s = d / (mx + mn);
    if (l > 0.5) { s = d / (2.0 - mx - mn); }
    if (mx == c.r) { h = gmod((c.g - c.b) / d, 6.0); }
    else if (mx == c.g) { h = (c.b - c.r) / d + 2.0; }
    else { h = (c.r - c.g) / d + 4.0; }
    h = h * 60.0;
  }
  return vec3f(h, s, l);
}
fn circDist(a: f32, b: f32) -> f32 { let d = abs(a - b); return min(d, 360.0 - d); }
fn linW(v: f32, lo: f32, hi: f32, soft: f32) -> f32 {
  if (v >= lo && v <= hi) { return 1.0; }
  if (soft <= 0.0) { return 0.0; }
  var d = v - hi;
  if (v < lo) { d = lo - v; }
  return clamp(1.0 - d / soft, 0.0, 1.0);
}
fn hueW(h: f32) -> f32 {
  let hMin = U(0u);
  let hMax = U(1u);
  let hSoft = U(2u);
  if (hMax - hMin >= 359.999) { return 1.0; }
  var inside = h >= hMin || h <= hMax;
  if (hMin <= hMax) { inside = h >= hMin && h <= hMax; }
  if (inside) { return 1.0; }
  if (hSoft <= 0.0) { return 0.0; }
  let d = min(circDist(h, hMin), circDist(h, hMax));
  return clamp(1.0 - d / hSoft, 0.0, 1.0);
}
fn rawAt(p: vec2f) -> f32 {
  let hsl = hs_rgb2hsl(fetchPx(p).rgb);
  return hueW(hsl.x) * linW(hsl.y, U(3u), U(4u), U(5u)) * linW(hsl.z, U(6u), U(7u), U(8u));
}
fn latOff(k: f32) -> f32 {
  let m = floor(abs(k) * U(9u) / 2.0 + 0.5);
  return select(m, -m, k < 0.0);
}
fn maskCover(p: vec2f) -> f32 {
  let c = vec2f(U(13u), U(14u)) * res();
  let h = vec2f(U(15u), U(16u)) * res();
  var cover = 0.0;
  if (h.x > 0.0 && h.y > 0.0) {
    var inside: f32;
    if (U(12u) > 1.5) {
      inside = min(h.x - abs(p.x - c.x), h.y - abs(p.y - c.y));
    } else {
      let q = length((p - c) / h);
      inside = (1.0 - q) * min(h.x, h.y);
    }
    let feather = U(17u);
    if (feather <= 0.0) { cover = select(0.0, 1.0, inside >= 0.0); }
    else { cover = clamp(0.5 + inside / feather, 0.0, 1.0); }
  }
  if (U(18u) > 0.5) { return 1.0 - cover; }
  return cover;
}
fn matteAt(p: vec2f) -> f32 {
  var m: f32;
  if (U(9u) > 0.0) {
    var sum = 0.0;
    for (var j: i32 = -2; j <= 2; j++) {
      for (var i: i32 = -2; i <= 2; i++) {
        sum += rawAt(p + vec2f(latOff(f32(i)), latOff(f32(j))));
      }
    }
    m = sum / 25.0;
    if (U(10u) > 0.0) {
      let lo = 0.45 * U(10u);
      m = smoothstep(lo, 1.0 - lo, m);
    }
  } else {
    m = rawAt(p);
  }
  if (U(11u) > 0.5) { m = 1.0 - m; }
  if (U(12u) > 0.5) { m = m * maskCover(p + 0.5); }
  return m;
}
@fragment fn fs_hslsec(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = px(fc);
  let s = fetchPx(p);
  let view = U(28u);
  if (view > 3.5) { return outRgb(s.rgb, s.a); }
  let m = matteAt(p);
  if (view > 0.5) {
    var o: vec3f;
    if (view < 1.5) { o = s.rgb * 0.5 * (1.0 - m * 0.7) + vec3f(1.0, 0.2, 0.4) * m * 0.7; }
    else if (view < 2.5) { o = vec3f(m); }
    else { o = vec3f(select(0.0, 1.0, m >= 0.5)); }
    return outRgb(o, s.a);
  }
  var c = s.rgb + vec3f(U(19u) + U(22u), U(20u) + U(23u), U(21u) + U(24u));
  c = (c - 0.5) * U(25u) + 0.5;
  let y = luma(c);
  c = vec3f(y) + (c - vec3f(y)) * U(26u);
  if (U(27u) > 0.0) {
    var acc = vec3f(0.0);
    for (var dy: i32 = -1; dy <= 1; dy++) {
      for (var dx: i32 = -1; dx <= 1; dx++) {
        acc += fetchPx(p + vec2f(f32(dx), f32(dy))).rgb;
      }
    }
    c += U(27u) * (s.rgb - acc / 9.0);
  }
  c = clamp(c, vec3f(0.0), vec3f(1.0));
  return outRgb(mix(s.rgb, c, m), s.a);
}

// ---- Lumetri Creative: lift, sharpen, vibrance, shadow / highlight tint --------------------------------------------
fn hueDeg(c: vec3f) -> f32 {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  let d = mx - mn;
  if (d <= 0.0) { return 0.0; }
  var h: f32;
  if (mx == c.r) {
    h = (c.g - c.b) / d;
    if (h < 0.0) { h += 6.0; }
  } else if (mx == c.g) { h = (c.b - c.r) / d + 2.0; }
  else { h = (c.r - c.g) / d + 4.0; }
  return h * 60.0;
}
fn skinWeight(h: f32) -> f32 {
  let dh = abs(gmod(gmod(h - 25.0 + 180.0, 360.0) + 360.0, 360.0) - 180.0);
  return 1.0 - sstep(20.0, 50.0, dh);
}
@fragment fn fs_creative(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = px(fc);
  let s = fetchPx(p);
  var c = s.rgb;
  let lift = U(0u);
  let sharpen = U(1u);
  let vibrance = U(2u);
  if (sharpen > 0.0) {
    var blur = 0.0;
    for (var j: i32 = -1; j <= 1; j++) {
      for (var i: i32 = -1; i <= 1; i++) {
        let w = select(1.0, 2.0, i == 0) * select(1.0, 2.0, j == 0);
        blur += lumaOf(p + vec2f(f32(i), f32(j))) * w;
      }
    }
    blur = blur / 16.0;
    c = clamp(c + sharpen * (luma(c) - blur), vec3f(0.0), vec3f(1.0));
  }
  if (lift > 0.0) { c = vec3f(lift) + c * (1.0 - lift); }
  if (vibrance != 0.0) {
    let mx = max(c.r, max(c.g, c.b));
    let mn = min(c.r, min(c.g, c.b));
    var sat = 0.0;
    if (mx > 0.0) { sat = (mx - mn) / mx; }
    let protect = 1.0 - 0.8 * skinWeight(hueDeg(c));
    var kk = vibrance * sat;
    if (vibrance > 0.0) { kk = vibrance * (1.0 - sat); }
    let k = 1.0 + kk * protect;
    let y = luma(c);
    c = vec3f(y) + (c - vec3f(y)) * k;
  }
  let sh = U3(3u);
  let hi = U3(6u);
  if (any(sh != vec3f(0.0)) || any(hi != vec3f(0.0))) {
    let y = clamp(luma(c), 0.0, 1.0);
    let ws = 1.0 - sstep(0.0, U(9u), y);
    let wh = sstep(U(9u), 1.0, y);
    c = c + sh * ws + hi * wh;
  }
  return outRgb(c, s.a);
}

// ---- Lens correction -----------------------------------------------------------------------------------------------
@fragment fn fs_lens(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let r = res();
  let hf = r * 0.5;
  let norm = length(r) * 0.5;
  let q = ((px(fc) + 0.5 - hf) / norm) * U(4u);
  let r2 = dot(q, q);
  let k1 = U(0u);
  let k2 = U(1u);
  let p1 = U(2u);
  let p2 = U(3u);
  let radial = 1.0 + k1 * r2 + k2 * r2 * r2;
  let d = vec2f(
    q.x * radial + 2.0 * p1 * q.x * q.y + p2 * (r2 + 2.0 * q.x * q.x),
    q.y * radial + p1 * (r2 + 2.0 * q.y * q.y) + 2.0 * p2 * q.x * q.y);
  let g = fetchCont(hf + d * norm - 0.5);
  let rr = fetchCont(hf + d * (norm * U(5u)) - 0.5).r;
  let bb = fetchCont(hf + d * (norm * U(6u)) - 0.5).b;
  let gain = 1.0 + U(7u) * dot(d, d);
  return outRgb(vec3f(rr, g.g, bb) * gain, g.a);
}

// ---- Repair: Dehaze ------------------------------------------------------------------------------------------------
@fragment fn fs_dehaze(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = px(fc);
  let s = fetchPx(p);
  let amount = U(0u);
  let stepPx = U(1u);
  let sky = U(2u);
  if (amount == 0.0) { return outRgb(s.rgb, s.a); }
  let r = res();
  var best = -1.0;
  var light = vec3f(1.0);
  for (var j: i32 = 0; j < 8; j++) {
    for (var i: i32 = 0; i < 8; i++) {
      let q = min(floor((vec2f(f32(i), f32(j)) + 0.5) / 8.0 * r), r - 1.0);
      let c = fetchPx(q).rgb;
      let m = min(c.r, min(c.g, c.b));
      if (m > best) { best = m; light = c; }
    }
  }
  light = max(light, vec3f(0.55));
  if (amount < 0.0) {
    let h = -amount * 0.6;
    return outRgb(s.rgb * (1.0 - h) + light * h, s.a);
  }
  let omega = 0.95 * amount;
  var mn = 1.0;
  var sum = 0.0;
  for (var j: i32 = -2; j <= 2; j++) {
    for (var i: i32 = -2; i <= 2; i++) {
      let off = floor(vec2f(f32(i), f32(j)) * stepPx + 0.5);
      let c = fetchPx(p + off).rgb / light;
      let v = min(c.r, min(c.g, c.b));
      mn = min(mn, v);
      sum += v;
    }
  }
  let d = clamp(mn + (sum / 25.0 - mn) * 0.35, 0.0, 1.0);
  var t = max(1.0 - omega * d, 0.25);
  t = t + (1.0 - t) * (sky * sstep(0.8, 0.98, d));
  return outRgb((s.rgb - light) / t + light, s.a);
}

// ---- Repair: Deflicker (per-channel gain; the gains are measured on the CPU from a thumbnail) -----------------------
@fragment fn fs_deflicker(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let c = textureLoad(src, vec2i(px(fc)), 0);
  return outRgb(c.rgb * U3(0u), c.a);
}

// ---- Repair: Deband -------------------------------------------------------------------------------------------------
fn hashU(a: i32, b: i32, c: i32) -> f32 {
  var h = u32(a) * 374761393u + u32(b) * 668265263u;
  h += u32(c) * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= (h >> 16u);
  return f32(h) / 4294967296.0;
}
@fragment fn fs_deband(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = px(fc);
  let s = fetchPx(p);
  var c = s.rgb;
  let ix = i32(p.x);
  let iy = i32(p.y);
  let thr = U(0u);
  let radius = U(1u);
  let iters = U(2u);
  let amp = U(3u);
  if (thr > 0.0) {
    for (var it: i32 = 1; it <= 4; it++) {
      if (f32(it) > iters) { break; }
      let theta = hashU(ix, iy, 2 * it) * 6.283185307179586;
      let rho = max(1.0, radius * (f32(it) / iters) * (0.5 + 0.5 * hashU(ix, iy, 2 * it + 1)));
      let d = vec2f(cos(theta), sin(theta)) * rho;
      let e = vec2f(-d.y, d.x);
      let t0 = fetchPx(floor(p + d + 0.5)).rgb;
      let t1 = fetchPx(floor(p - d + 0.5)).rgb;
      let t2 = fetchPx(floor(p + e + 0.5)).rgb;
      let t3 = fetchPx(floor(p - e + 0.5)).rgb;
      let m = max(max(abs(t0 - c), abs(t1 - c)), max(abs(t2 - c), abs(t3 - c)));
      if (max(m.r, max(m.g, m.b)) < thr) { c = (t0 + t1 + t2 + t3) * 0.25; }
    }
  }
  if (amp > 0.0) { c = c + (hashU(ix, iy, 977) * 2.0 - 1.0) * amp; }
  return outRgb(c, s.a);
}

// ---- Present: straight 8-bit rgba -> premultiplied canvas ----------------------------------------------------------
@fragment fn fs_present(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let s = textureLoad(src, vec2i(px(fc)), 0);
  return vec4f(s.rgb * s.a, s.a);
}
`;

export const GPU_GRADE_WGSL = COMMON + GRADE + PRO;

/** Every fragment entry point in GPU_GRADE_WGSL. */
export const GPU_GRADE_ENTRIES = [
  "fs_wb",
  "fs_fused",
  "fs_tone8",
  "fs_vignette",
  "fs_curves",
  "fs_hsl",
  "fs_lut3",
  "fs_lut1",
  "fs_hslsec",
  "fs_creative",
  "fs_lens",
  "fs_dehaze",
  "fs_deflicker",
  "fs_deband",
  "fs_present",
] as const;

export type GpuGradeEntry = (typeof GPU_GRADE_ENTRIES)[number];
