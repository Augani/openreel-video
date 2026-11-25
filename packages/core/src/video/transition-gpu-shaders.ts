/**
 * WGSL for the WebGPU transition renderer.
 *
 * Every pixel-function transition is one fragment function `shade(pos)` that composes the two shots from their
 * textures (premultiplied alpha, like the Canvas2D engine they mirror). `pos` is the pixel centre in the engine's
 * pixel space; the shots are letterboxed into that space by the `fit` rectangles, so a shot of another aspect keeps
 * its orientation without an intermediate scratch canvas. Parameters arrive in four vec4s (`u.a` .. `u.d`), per-slice
 * constants the Canvas2D engine evaluates in double precision (mosaic thresholds, glitch slices, ripple offsets) in
 * the `aux` storage buffer, and the mask transitions' coverage in `texM`.
 */

export const GPU_UNIFORM_FLOATS = 28;
export const GPU_AUX_FLOATS = 4096;

const PRELUDE = /* wgsl */ `
struct U {
  size: vec2f,
  p: f32,
  flag: f32,
  fitA: vec4f,
  fitB: vec4f,
  a: vec4f,
  b: vec4f,
  c: vec4f,
  d: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var texA: texture_2d<f32>;
@group(0) @binding(3) var texB: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> aux: array<f32>;
@group(0) @binding(5) var texM: texture_2d<f32>;

const TAU: f32 = 6.283185307179586;

fn tap(t: texture_2d<f32>, fit: vec4f, pos: vec2f) -> vec4f {
  let q = (pos / u.size - fit.xy) / fit.zw;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { return vec4f(0.0); }
  return textureSampleLevel(t, smp, q, 0.0);
}
fn sa(pos: vec2f) -> vec4f { return tap(texA, u.fitA, pos); }
fn sb(pos: vec2f) -> vec4f { return tap(texB, u.fitB, pos); }

// Source-over of premultiplied colours.
fn over(s: vec4f, d: vec4f) -> vec4f { return s + d * (1.0 - s.a); }

fn unpremul(c: vec4f) -> vec3f { return select(vec3f(0.0), c.rgb / c.a, c.a > 0.0); }

// Canvas "screen" blend of a straight colour at coverage sa over a premultiplied destination.
fn screenOver(cs: vec3f, sa_: f32, d: vec4f) -> vec4f {
  let cb = unpremul(d);
  let blended = cb + cs - cb * cs;
  let ao = sa_ + d.a * (1.0 - sa_);
  let rgb = cs * sa_ * (1.0 - d.a) + d.rgb * (1.0 - sa_) + sa_ * d.a * blended;
  return vec4f(rgb, ao);
}

fn crossfadeAt(pos: vec2f) -> vec4f {
  return over(sb(pos) * u.p, sa(pos) * (1.0 - u.p));
}

// A gaussian blur of sigma pixels (a CSS blur(): sigma is the standard deviation), 64 taps on a golden-angle spiral
// whose radii follow the gaussian's own distribution, so the taps are equally weighted.
fn blurTap(t: texture_2d<f32>, fit: vec4f, pos: vec2f, sigma: f32) -> vec4f {
  if (sigma < 0.35) { return tap(t, fit, pos); }
  var acc = vec4f(0.0);
  for (var i = 0; i < 64; i = i + 1) {
    let f = (f32(i) + 0.5) / 64.0;
    let r = sigma * sqrt(-2.0 * log(1.0 - f));
    let th = f32(i) * 2.399963229728653;
    acc = acc + tap(t, fit, pos + r * vec2f(cos(th), sin(th)));
  }
  return acc / 64.0;
}

fn linearOf(c: vec3f) -> vec3f {
  let lo = c / 12.92;
  let hi = pow((c + vec3f(0.055)) / 1.055, vec3f(2.4));
  return select(hi, lo, c <= vec3f(0.04045));
}
fn srgbOf(l: vec3f) -> vec3f {
  let lo = l * 12.92;
  let hi = 1.055 * pow(l, vec3f(1.0 / 2.4)) - vec3f(0.055);
  return select(hi, lo, l <= vec3f(0.0031308));
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  return shade(fc.xy);
}
`;

/** Shader bodies keyed by the pipeline that runs them. Each defines \`fn shade(pos: vec2f) -> vec4f\`. */
export const GPU_TRANSITION_BODIES = {
  crossfade: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f { return crossfadeAt(pos); }`,

  // a.x hold, a.y 1 for white
  dip: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  let p = u.p;
  let col = vec4f(vec3f(u.a.y), 1.0);
  let phases = 2.0 + u.a.x;
  let fadeOutEnd = 1.0 / phases;
  let holdEnd = (1.0 + u.a.x) / phases;
  if (p < fadeOutEnd) { return over(col * (p / fadeOutEnd), sa(pos)); }
  if (p < holdEnd) { return col; }
  return over(sb(pos) * ((p - holdEnd) / (1.0 - holdEnd)), col);
}`,

  // a.x direction (0 left, 1 right, 2 up, 3 down, 4 diagonal), a.y softness
  wipe: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  let p = u.p;
  let W = u.size.x;
  let H = u.size.y;
  let code = u.a.x;
  let feather = u.a.y;
  let base = sa(pos);
  if (p >= 1.0) { return over(sb(pos), base); }
  if (p <= 0.0) { return base; }
  var cover = 0.0;
  if (feather > 0.0 && code < 3.5) {
    let horizontal = code < 1.5;
    let c = select(pos.y, pos.x, horizontal);
    let len = select(H, W, horizontal);
    let rev = code == 1.0 || code == 3.0;
    let edge = select(len * p, len * (1.0 - p), rev);
    let fsz = max(1.0, len * feather * 0.25);
    if (!rev) {
      let fs0 = max(0.0, edge - fsz);
      if (c < fs0) { cover = 1.0; }
      else if (c < edge) {
        let i = min(floor((c - fs0) / (edge - fs0) * 20.0), 19.0);
        cover = 1.0 - (i + 0.5) / 20.0;
      }
    } else {
      let fe = min(len, edge + fsz);
      if (c >= fe) { cover = 1.0; }
      else if (c >= edge) {
        let i = min(floor((c - edge) / (fe - edge) * 20.0), 19.0);
        cover = (i + 0.5) / 20.0;
      }
    }
  } else if (code < 0.5) {
    cover = clamp(W * p - (pos.x - 0.5), 0.0, 1.0);
  } else if (code < 1.5) {
    cover = clamp((pos.x + 0.5) - W * (1.0 - p), 0.0, 1.0);
  } else if (code < 2.5) {
    cover = clamp(H * p - (pos.y - 0.5), 0.0, 1.0);
  } else if (code < 3.5) {
    cover = clamp((pos.y + 0.5) - H * (1.0 - p), 0.0, 1.0);
  } else {
    cover = clamp(((W + H) * p - (pos.x + pos.y)) * 0.70710678 + 0.5, 0.0, 1.0);
  }
  return over(sb(pos) * cover, base);
}`,

  // a.xy outgoing offset, a.zw incoming offset (px); flag 1 draws the outgoing shot
  slide: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  var col = vec4f(0.0);
  if (u.flag > 0.5) { col = sa(pos - u.a.xy); }
  return over(sb(pos - u.a.zw), col);
}`,

  // a.x outgoing scale, a.y incoming scale, a.zw centre px
  zoom: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  let c = u.a.zw;
  let pa = c + (pos - c) / u.a.x;
  let pb = c + (pos - c) / u.a.y;
  return over(sb(pb) * u.p, sa(pa) * (1.0 - u.p));
}`,

  // a.xy centre px, a.z max radius
  circleReveal: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  let d = length(pos - u.a.xy);
  let cover = clamp(u.a.z * u.p - d + 0.5, 0.0, 1.0);
  return over(sb(pos) * cover, sa(pos));
}`,

  // a.x sigma px
  blur: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  let p = u.p;
  return over(blurTap(texB, u.fitB, pos, u.a.x) * p, blurTap(texA, u.fitA, pos, u.a.x) * (1.0 - p));
}`,

  // a.xy outgoing offset, a.zw incoming offset, b.x sigma
  whipPan: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  let ca = blurTap(texA, u.fitA, pos - u.a.xy, u.b.x);
  let cb = blurTap(texB, u.fitB, pos - u.a.zw, u.b.x);
  return over(cb, ca);
}`,

  // a.x start angle (rad), a.y 1 clockwise / -1 anticlockwise, a.zw centre px
  radialWipe: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  let base = sa(pos);
  if (u.p >= 1.0) { return over(sb(pos), base); }
  if (u.p <= 0.0) { return base; }
  let d = pos - u.a.zw;
  let ang = atan2(d.y, d.x);
  var rel = select(u.a.x - ang, ang - u.a.x, u.a.y > 0.0);
  rel = rel - TAU * floor(rel / TAU);
  let sweep = u.p * TAU;
  let dist = max(length(d), 1.0);
  let cover = clamp(min(rel, sweep - rel) * dist + 0.5, 0.0, 1.0);
  return over(sb(pos) * cover, base);
}`,

  // a.xy cell size px. The Canvas2D engine downsamples with one bilinear tap per cell, so this does too.
  pixelate: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  let q = (floor(pos / u.a.xy) + 0.5) * u.a.xy;
  return over(sb(q) * u.p, sa(q) * (1.0 - u.p));
}`,

  // a.x slice count, a.y slice alpha; aux: per slice [top, bottom, x offset, 1 when the slice shows the incoming shot]
  glitch: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  var col = crossfadeAt(pos);
  let n = i32(u.a.x);
  let k = floor(pos.y);
  for (var i = 0; i < n; i = i + 1) {
    let top = aux[i * 4];
    let bottom = aux[i * 4 + 1];
    if (k >= top && k < bottom) {
      let off = aux[i * 4 + 2];
      let q = vec2f(pos.x - off, pos.y);
      let src = select(sa(q), sb(q), aux[i * 4 + 3] > 0.5);
      col = over(src * u.a.y, col);
    }
  }
  return col;
}`,

  // a.x 1 when the strips stack vertically (horizontal blinds), a.y strip count
  blinds: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  let base = sa(pos);
  var inside = 0.0;
  if (u.a.x > 0.5) {
    let strip = u.size.y / u.a.y;
    let within = pos.y - floor(pos.y / strip) * strip;
    inside = clamp(strip * u.p - (within - 0.5), 0.0, 1.0);
  } else {
    let strip = u.size.x / u.a.y;
    let within = pos.x - floor(pos.x / strip) * strip;
    inside = clamp(strip * u.p - (within - 0.5), 0.0, 1.0);
  }
  return over(sb(pos) * inside, base);
}`,

  // a.xy centre px, a.z max reach
  diamondReveal: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  let d = abs(pos - u.a.xy);
  let cover = clamp((u.a.z * u.p - (d.x + d.y)) * 0.70710678 + 0.5, 0.0, 1.0);
  return over(sb(pos) * cover, sa(pos));
}`,

  // a.xy centre, a.z outgoing scale, a.w outgoing rotation; b.x incoming scale, b.y incoming rotation
  spin: /* wgsl */ `
fn invRot(pos: vec2f, c: vec2f, s: f32, r: f32) -> vec2f {
  let d = pos - c;
  let cs = cos(r);
  let sn = sin(r);
  return c + vec2f(cs * d.x + sn * d.y, -sn * d.x + cs * d.y) / s;
}
fn shade(pos: vec2f) -> vec4f {
  let c = u.a.xy;
  return over(sb(invRot(pos, c, u.b.x, u.b.y)) * u.p, sa(invRot(pos, c, u.a.z, u.a.w)) * (1.0 - u.p));
}`,

  // a.x 1 horizontal, a.y axis scale, a.z 1 shows the incoming shot
  flip: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  let c = u.size * 0.5;
  var q = pos;
  if (u.a.x > 0.5) { q.x = c.x + (pos.x - c.x) / u.a.y; } else { q.y = c.y + (pos.y - c.y) / u.a.y; }
  return select(sa(q), sb(q), u.a.z > 0.5);
}`,

  // a.x 1 vertical
  splitReveal: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  let half_ = u.size * 0.5;
  var cover = 0.0;
  if (u.a.x > 0.5) {
    cover = clamp(u.size.y * u.p * 0.5 - abs(pos.y - half_.y) + 0.5, 0.0, 1.0);
  } else {
    cover = clamp(u.size.x * u.p * 0.5 - abs(pos.x - half_.x) + 0.5, 0.0, 1.0);
  }
  return over(sb(pos) * cover, sa(pos));
}`,

  // a.x white alpha
  flash: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  return over(vec4f(u.a.x), crossfadeAt(pos));
}`,

  // a.xyz burn colour, a.w its alpha, b.x white alpha
  filmBurn: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  var col = crossfadeAt(pos);
  col = screenOver(u.a.xyz, u.a.w, col);
  return screenOver(vec3f(1.0), u.b.x, col);
}`,

  // a.x columns, a.y rows, a.zw tile size px; aux: per tile threshold
  mosaic: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  let base = sa(pos);
  if (u.p <= 0.0) { return base; }
  if (u.p >= 1.0) { return over(sb(pos), base); }
  let cols = i32(u.a.x);
  let rows = i32(u.a.y);
  let c0 = i32(floor(pos.x / u.a.z));
  let r0 = i32(floor(pos.y / u.a.w));
  var show = 0.0;
  for (var dr = 0; dr < 2; dr = dr + 1) {
    for (var dc = 0; dc < 2; dc = dc + 1) {
      let c = c0 - dc;
      let r = r0 - dr;
      if (c < 0 || r < 0 || c >= cols || r >= rows) { continue; }
      if (pos.x < f32(c) * u.a.z + ceil(u.a.z) + 1.0 && pos.y < f32(r) * u.a.w + ceil(u.a.w) + 1.0 && u.p >= aux[r * cols + c]) {
        show = 1.0;
      }
    }
  }
  return over(sb(pos) * show, base);
}`,

  // a.x slice count, a.y slice height px; aux: per slice x offset
  ripple: /* wgsl */ `
fn rippleSlice(i: i32, pos: vec2f, dst: vec4f) -> vec4f {
  let off = aux[i];
  var col = over(sa(pos - vec2f(off, 0.0)) * (1.0 - u.p), dst);
  col = over(sb(pos + vec2f(off, 0.0)) * u.p, col);
  return col;
}
fn shade(pos: vec2f) -> vec4f {
  if (u.p <= 0.0) { return sa(pos); }
  if (u.p >= 1.0) { return sb(pos); }
  let n = i32(u.a.x);
  let i0 = i32(floor(pos.y / u.a.y));
  var col = vec4f(0.0);
  if (i0 >= 1 && i0 - 1 < n && pos.y < f32(i0) * u.a.y + 1.0) { col = rippleSlice(i0 - 1, pos, col); }
  if (i0 < n) { col = rippleSlice(i0, pos, col); }
  return col;
}`,

  // a.x 1 turns left, a.y remaining width fraction, a.z shadow alpha, a.w shadow width px; b.x shadow left edge px
  pageTurn: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  if (u.p <= 0.0) { return sa(pos); }
  if (u.p >= 1.0) { return sb(pos); }
  let W = u.size.x;
  let rem = u.a.y;
  var sx = pos.x / rem;
  if (u.a.x < 0.5) { sx = W + (pos.x - W) / rem; }
  var col = over(sa(vec2f(sx, pos.y)), sb(pos));
  let inShadow = clamp(min(pos.x + 0.5 - u.b.x, u.b.x + u.a.w - (pos.x - 0.5)), 0.0, 1.0);
  col = over(vec4f(0.0, 0.0, 0.0, u.a.z * inShadow), col);
  return col;
}`,

  // a.xy offset px, a.z screen alpha
  colorSplit: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  var col = crossfadeAt(pos);
  let ca = sa(pos + u.a.xy);
  col = screenOver(unpremul(ca), ca.a * u.a.z, col);
  let cb = sb(pos - u.a.xy);
  col = screenOver(unpremul(cb), cb.a * u.a.z, col);
  return col;
}`,

  // Mixes in linear light.
  filmDissolve: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  if (u.p <= 0.0) { return sa(pos); }
  if (u.p >= 1.0) { return sb(pos); }
  let ca = sa(pos);
  let cb = sb(pos);
  let mixed = (1.0 - u.p) * linearOf(unpremul(ca)) + u.p * linearOf(unpremul(cb));
  let alpha = (1.0 - u.p) * ca.a + u.p * cb.a;
  let rgb = srgbOf(min(mixed, vec3f(1.0)));
  return vec4f(rgb * alpha, alpha);
}`,

  // a.x outgoing weight, a.y incoming weight
  additiveDissolve: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  var col = min(vec4f(0.0, 0.0, 0.0, 1.0) + sa(pos) * u.a.x, vec4f(1.0));
  col = min(col + sb(pos) * u.a.y, vec4f(1.0));
  return col;
}`,

  // a.xyz border colour, a.w 1 when there is a border; texM: r incoming coverage, g border coverage
  mask: /* wgsl */ `
fn shade(pos: vec2f) -> vec4f {
  var col = sa(pos);
  if (u.p <= 0.0) { return col; }
  if (u.p >= 1.0) { return over(sb(pos), col); }
  let m = textureSampleLevel(texM, smp, pos / u.size, 0.0);
  if (u.a.w > 0.5) { col = over(vec4f(u.a.xyz, 1.0) * m.g, col); }
  return over(sb(pos) * m.r, col);
}`,
} as const;

export type GpuPixelShader = keyof typeof GPU_TRANSITION_BODIES;

/** The complete module source of one pixel-function transition. */
export function pixelShaderSource(shader: GpuPixelShader): string {
  return `${PRELUDE}\n${GPU_TRANSITION_BODIES[shader]}`;
}

/**
 * The geometric transitions run a draw plan: textured / flat / gradient polygons drawn with source-over blending.
 * Vertex: position px, source px (or the gradient's t), mode (0 outgoing, 1 incoming, 2 flat, 3 gradient), alpha,
 * colour. Four-sample MSAA gives the polygon edges the antialiasing a canvas clip has.
 */
export const GPU_PLAN_SHADER = /* wgsl */ `
struct U {
  size: vec2f,
  p: f32,
  flag: f32,
  fitA: vec4f,
  fitB: vec4f,
  a: vec4f,
  b: vec4f,
  c: vec4f,
  d: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var texA: texture_2d<f32>;
@group(0) @binding(3) var texB: texture_2d<f32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) src: vec2f,
  @location(1) @interpolate(flat) mode: f32,
  @location(2) @interpolate(flat) alpha: f32,
  @location(3) @interpolate(flat) color: vec3f,
};

@vertex
fn vs(@location(0) pos: vec2f, @location(1) src: vec2f, @location(2) info: vec2f, @location(3) color: vec3f) -> VOut {
  var o: VOut;
  o.pos = vec4f(pos.x / u.size.x * 2.0 - 1.0, 1.0 - pos.y / u.size.y * 2.0, 0.0, 1.0);
  o.src = src;
  o.mode = info.x;
  o.alpha = info.y;
  o.color = color;
  return o;
}

fn tap(t: texture_2d<f32>, fit: vec4f, pos: vec2f) -> vec4f {
  let q = (pos / u.size - fit.xy) / fit.zw;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { return vec4f(0.0); }
  return textureSampleLevel(t, smp, q, 0.0);
}

@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  if (i.mode < 0.5) { return tap(texA, u.fitA, i.src) * i.alpha; }
  if (i.mode < 1.5) { return tap(texB, u.fitB, i.src) * i.alpha; }
  if (i.mode < 2.5) { return vec4f(i.color * i.alpha, i.alpha); }
  // gradient: src.x is the unclamped t along the gradient, colour.xy the alphas at its two ends
  let a = mix(i.color.x, i.color.y, clamp(i.src.x, 0.0, 1.0));
  return vec4f(0.0, 0.0, 0.0, a);
}
`;
