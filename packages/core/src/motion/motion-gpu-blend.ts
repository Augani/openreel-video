import type { BlendMode } from "../video/types";

export interface MotionRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface MotionRgba extends MotionRgb {
  readonly a: number;
}

export const MOTION_GPU_BLEND_INDEX: Record<BlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
  "color-dodge": 6,
  "color-burn": 7,
  "hard-light": 8,
  "soft-light": 9,
  difference: 10,
  exclusion: 11,
  hue: 12,
  saturation: 13,
  color: 14,
  luminosity: 15,
  add: 16,
  "linear-dodge": 16,
  "linear-burn": 17,
  "darker-color": 18,
  "lighter-color": 19,
  "linear-light": 20,
  "vivid-light": 21,
  "pin-light": 22,
  "hard-mix": 23,
  subtract: 24,
  divide: 25,
  dissolve: 26,
};

const DARKER_COLOR = 18;
const LIGHTER_COLOR = 19;
const DISSOLVE = 26;

const NON_SEPARABLE_THRESHOLD = 12;
const ADDITIVE_MODE = 16;

export function motionBlendIndex(mode: BlendMode | undefined): number {
  if (mode === undefined) return 0;
  return MOTION_GPU_BLEND_INDEX[mode] ?? 0;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function blendSeparableChannel(mode: number, cb: number, cs: number): number {
  switch (mode) {
    case 1:
      return cb * cs;
    case 2:
      return cb + cs - cb * cs;
    case 3:
      return cb <= 0.5
        ? 2 * cb * cs
        : 1 - 2 * (1 - cb) * (1 - cs);
    case 4:
      return Math.min(cb, cs);
    case 5:
      return Math.max(cb, cs);
    case 6:
      if (cb <= 0) return 0;
      if (cs >= 1) return 1;
      return Math.min(1, cb / (1 - cs));
    case 7:
      if (cb >= 1) return 1;
      if (cs <= 0) return 0;
      return 1 - Math.min(1, (1 - cb) / cs);
    case 8:
      return cs <= 0.5
        ? 2 * cb * cs
        : 1 - 2 * (1 - cb) * (1 - cs);
    case 9: {
      if (cs <= 0.5) {
        return cb - (1 - 2 * cs) * cb * (1 - cb);
      }
      const d =
        cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cb + (2 * cs - 1) * (d - cb);
    }
    case 10:
      return Math.abs(cb - cs);
    case 11:
      return cb + cs - 2 * cb * cs;
    case ADDITIVE_MODE:
      return Math.min(1, cb + cs);
    case 17:
      return Math.max(0, cb + cs - 1);
    case 20:
      return clamp01(cb + 2 * cs - 1);
    case 21: {
      if (cs <= 0.5) {
        const s2 = 2 * cs;
        if (cb >= 1) return 1;
        if (s2 <= 0) return 0;
        return 1 - Math.min(1, (1 - cb) / s2);
      }
      const s2 = 2 * cs - 1;
      if (cb <= 0) return 0;
      if (s2 >= 1) return 1;
      return Math.min(1, cb / (1 - s2));
    }
    case 22:
      return cs < 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1);
    case 23:
      return cb + cs >= 1 ? 1 : 0;
    case 24:
      return Math.max(0, cb - cs);
    case 25:
      return cs <= 0 ? 1 : Math.min(1, cb / cs);
    default:
      return cs;
  }
}

function luminance(color: MotionRgb): number {
  return 0.3 * color.r + 0.59 * color.g + 0.11 * color.b;
}

function clipColor(color: MotionRgb): MotionRgb {
  const lum = luminance(color);
  const min = Math.min(color.r, color.g, color.b);
  const max = Math.max(color.r, color.g, color.b);
  let { r, g, b } = color;
  if (min < 0) {
    const scale = lum / (lum - min);
    r = lum + (r - lum) * scale;
    g = lum + (g - lum) * scale;
    b = lum + (b - lum) * scale;
  }
  if (max > 1) {
    const scale = (1 - lum) / (max - lum);
    r = lum + (r - lum) * scale;
    g = lum + (g - lum) * scale;
    b = lum + (b - lum) * scale;
  }
  return { r, g, b };
}

function setLuminance(color: MotionRgb, target: number): MotionRgb {
  const delta = target - luminance(color);
  return clipColor({
    r: color.r + delta,
    g: color.g + delta,
    b: color.b + delta,
  });
}

function saturation(color: MotionRgb): number {
  return (
    Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)
  );
}

function setSaturation(color: MotionRgb, target: number): MotionRgb {
  const channels: Array<{ key: "r" | "g" | "b"; value: number }> = [
    { key: "r", value: color.r },
    { key: "g", value: color.g },
    { key: "b", value: color.b },
  ];
  channels.sort((a, b) => a.value - b.value);
  const [min, mid, max] = channels;
  const result: Record<"r" | "g" | "b", number> = { r: 0, g: 0, b: 0 };
  if (max.value > min.value) {
    result[mid.key] =
      ((mid.value - min.value) * target) / (max.value - min.value);
    result[max.key] = target;
  } else {
    result[mid.key] = 0;
    result[max.key] = 0;
  }
  result[min.key] = 0;
  return result;
}

function blendNonSeparable(
  mode: number,
  cb: MotionRgb,
  cs: MotionRgb,
): MotionRgb {
  switch (mode) {
    case 12:
      return setLuminance(setSaturation(cs, saturation(cb)), luminance(cb));
    case 13:
      return setLuminance(setSaturation(cb, saturation(cs)), luminance(cb));
    case 14:
      return setLuminance(cs, luminance(cb));
    case 15:
      return setLuminance(cb, luminance(cs));
    default:
      return cs;
  }
}

export function blendMotionColor(
  mode: BlendMode,
  backdrop: MotionRgb,
  source: MotionRgb,
): MotionRgb {
  const index = MOTION_GPU_BLEND_INDEX[mode] ?? 0;
  if (index === DARKER_COLOR) {
    return luminance(source) < luminance(backdrop) ? source : backdrop;
  }
  if (index === LIGHTER_COLOR) {
    return luminance(source) > luminance(backdrop) ? source : backdrop;
  }
  if (index >= NON_SEPARABLE_THRESHOLD && index < ADDITIVE_MODE) {
    return blendNonSeparable(index, backdrop, source);
  }
  return {
    r: blendSeparableChannel(index, backdrop.r, source.r),
    g: blendSeparableChannel(index, backdrop.g, source.g),
    b: blendSeparableChannel(index, backdrop.b, source.b),
  };
}

/** Dissolve noise: same integer hash as dissolveNoise() in the WGSL below. */
export function motionDissolveNoise(x: number, y: number): number {
  let h = (Math.imul(x >>> 0, 374761393) + Math.imul(y >>> 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffff) / 65536;
}

export function compositeMotionColor(
  backdrop: MotionRgba,
  source: MotionRgba,
  mode: BlendMode,
  pixelX = 0,
  pixelY = 0,
): MotionRgba {
  if (MOTION_GPU_BLEND_INDEX[mode] === DISSOLVE) {
    source = {
      ...source,
      a: motionDissolveNoise(pixelX, pixelY) < source.a ? 1 : 0,
    };
  }
  const blended = blendMotionColor(mode, backdrop, source);
  const sourceR = (1 - backdrop.a) * source.r + backdrop.a * blended.r;
  const sourceG = (1 - backdrop.a) * source.g + backdrop.a * blended.g;
  const sourceB = (1 - backdrop.a) * source.b + backdrop.a * blended.b;
  const outAlpha = source.a + backdrop.a * (1 - source.a);
  if (outAlpha <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const premultR = source.a * sourceR + (1 - source.a) * backdrop.a * backdrop.r;
  const premultG = source.a * sourceG + (1 - source.a) * backdrop.a * backdrop.g;
  const premultB = source.a * sourceB + (1 - source.a) * backdrop.a * backdrop.b;
  return {
    r: clamp01(premultR / outAlpha),
    g: clamp01(premultG / outAlpha),
    b: clamp01(premultB / outAlpha),
    a: clamp01(outAlpha),
  };
}

export function buildMotionBlendWgsl(): string {
  return `fn motionLuminance(c: vec3<f32>) -> f32 {
  return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
}

fn motionClipColor(c: vec3<f32>) -> vec3<f32> {
  let lum = motionLuminance(c);
  let mn = min(c.r, min(c.g, c.b));
  let mx = max(c.r, max(c.g, c.b));
  var result = c;
  if (mn < 0.0) {
    result = vec3<f32>(lum) + (result - vec3<f32>(lum)) * (lum / (lum - mn));
  }
  if (mx > 1.0) {
    result = vec3<f32>(lum) + (result - vec3<f32>(lum)) * ((1.0 - lum) / (mx - lum));
  }
  return result;
}

fn motionSetLum(c: vec3<f32>, l: f32) -> vec3<f32> {
  let d = l - motionLuminance(c);
  return motionClipColor(c + vec3<f32>(d));
}

fn motionSat(c: vec3<f32>) -> f32 {
  return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
}

fn motionSetSat(c: vec3<f32>, s: f32) -> vec3<f32> {
  let mn = min(c.r, min(c.g, c.b));
  let mx = max(c.r, max(c.g, c.b));
  if (mx <= mn) {
    return vec3<f32>(0.0);
  }
  return (c - vec3<f32>(mn)) * (s / (mx - mn));
}

fn motionBlendChannel(mode: u32, cb: f32, cs: f32) -> f32 {
  if (mode == 1u) { return cb * cs; }
  if (mode == 2u) { return cb + cs - cb * cs; }
  if (mode == 3u) {
    if (cb <= 0.5) { return 2.0 * cb * cs; }
    return 1.0 - 2.0 * (1.0 - cb) * (1.0 - cs);
  }
  if (mode == 4u) { return min(cb, cs); }
  if (mode == 5u) { return max(cb, cs); }
  if (mode == 6u) {
    if (cb <= 0.0) { return 0.0; }
    if (cs >= 1.0) { return 1.0; }
    return min(1.0, cb / (1.0 - cs));
  }
  if (mode == 7u) {
    if (cb >= 1.0) { return 1.0; }
    if (cs <= 0.0) { return 0.0; }
    return 1.0 - min(1.0, (1.0 - cb) / cs);
  }
  if (mode == 8u) {
    if (cs <= 0.5) { return 2.0 * cb * cs; }
    return 1.0 - 2.0 * (1.0 - cb) * (1.0 - cs);
  }
  if (mode == 9u) {
    if (cs <= 0.5) {
      return cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
    }
    var d = sqrt(cb);
    if (cb <= 0.25) {
      d = ((16.0 * cb - 12.0) * cb + 4.0) * cb;
    }
    return cb + (2.0 * cs - 1.0) * (d - cb);
  }
  if (mode == 10u) { return abs(cb - cs); }
  if (mode == 11u) { return cb + cs - 2.0 * cb * cs; }
  if (mode == 16u) { return min(1.0, cb + cs); }
  if (mode == 17u) { return max(0.0, cb + cs - 1.0); }
  if (mode == 20u) { return clamp(cb + 2.0 * cs - 1.0, 0.0, 1.0); }
  if (mode == 21u) {
    if (cs <= 0.5) {
      let s2 = 2.0 * cs;
      if (cb >= 1.0) { return 1.0; }
      if (s2 <= 0.0) { return 0.0; }
      return 1.0 - min(1.0, (1.0 - cb) / s2);
    }
    let s3 = 2.0 * cs - 1.0;
    if (cb <= 0.0) { return 0.0; }
    if (s3 >= 1.0) { return 1.0; }
    return min(1.0, cb / (1.0 - s3));
  }
  if (mode == 22u) {
    if (cs < 0.5) { return min(cb, 2.0 * cs); }
    return max(cb, 2.0 * cs - 1.0);
  }
  if (mode == 23u) {
    if (cb + cs >= 1.0) { return 1.0; }
    return 0.0;
  }
  if (mode == 24u) { return max(0.0, cb - cs); }
  if (mode == 25u) {
    if (cs <= 0.0) { return 1.0; }
    return min(1.0, cb / cs);
  }
  return cs;
}

fn dissolveNoise(x: u32, y: u32) -> f32 {
  var h = x * 374761393u + y * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return f32(h & 65535u) / 65536.0;
}

fn motionBlend(mode: u32, cb: vec3<f32>, cs: vec3<f32>) -> vec3<f32> {
  if (mode == 12u) { return motionSetLum(motionSetSat(cs, motionSat(cb)), motionLuminance(cb)); }
  if (mode == 13u) { return motionSetLum(motionSetSat(cb, motionSat(cs)), motionLuminance(cb)); }
  if (mode == 14u) { return motionSetLum(cs, motionLuminance(cb)); }
  if (mode == 15u) { return motionSetLum(cb, motionLuminance(cs)); }
  if (mode == 18u) {
    if (motionLuminance(cs) < motionLuminance(cb)) { return cs; }
    return cb;
  }
  if (mode == 19u) {
    if (motionLuminance(cs) > motionLuminance(cb)) { return cs; }
    return cb;
  }
  if (mode == 16u) {
    return vec3<f32>(
      min(1.0, cb.r + cs.r),
      min(1.0, cb.g + cs.g),
      min(1.0, cb.b + cs.b),
    );
  }
  return vec3<f32>(
    motionBlendChannel(mode, cb.r, cs.r),
    motionBlendChannel(mode, cb.g, cs.g),
    motionBlendChannel(mode, cb.b, cs.b),
  );
}

fn motionComposite(backdrop: vec4<f32>, source0: vec4<f32>, mode: u32, px: vec2<u32>) -> vec4<f32> {
  var source = source0;
  if (mode == 26u) {
    if (dissolveNoise(px.x, px.y) < source.a) { source.a = 1.0; } else { source.a = 0.0; }
  }
  let blended = motionBlend(mode, backdrop.rgb, source.rgb);
  let srcRgb = mix(source.rgb, blended, backdrop.a);
  let outAlpha = source.a + backdrop.a * (1.0 - source.a);
  if (outAlpha <= 0.0) {
    return vec4<f32>(0.0);
  }
  let premult = source.a * srcRgb + (1.0 - source.a) * backdrop.a * backdrop.rgb;
  return vec4<f32>(clamp(premult / outAlpha, vec3<f32>(0.0), vec3<f32>(1.0)), clamp(outAlpha, 0.0, 1.0));
}
`;
}
