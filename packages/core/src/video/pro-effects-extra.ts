/**
 * Wave 7 effects batch: 27 more Premiere-staple video effects that plug into
 * the pro effects library (pro-effects.ts). Everything an effect needs lives
 * here, next to each other:
 *
 *  - EXTRA_PRO_EFFECT_SPECS: label, category, parameter ranges, defaults and
 *    the neutral (exact no-op) value of every parameter. Numeric parameters
 *    are keyframable unless flagged otherwise.
 *  - applyExtraProEffect: the pure CPU reference (the Canvas2D / software
 *    fallback and the reference the GLSL ports in pro-effect-shaders-extra.ts
 *    are written against). Straight-alpha RGBA, origin top-left, pixel centre
 *    at integer coordinates, bilinear sampling with edge clamp.
 *  - extraProEffectGpuUniforms: the single mapping from stored params to the
 *    shader uniforms, so derived values (homography, wave phase, strobe gate,
 *    noise frame) are computed exactly once for both paths.
 *
 * Colour parameters are stored as separate 0-255 channel numbers so that they
 * can be keyframed, validated and exposed to agents like any other number.
 * All randomness is a pure hash of (seed, clip-local time, position).
 */
import {
  applyUltraKey,
  isUltraKeyNeutral,
  ultraKeyGpuUniforms,
  type UltraKeyParams,
} from "./ultra-key";
import type {
  ProEffectCategory,
  ProEffectParamSpec,
  ProEffectSpec,
  ResolvedProParams,
} from "./pro-effects";

export const EXTRA_PRO_EFFECT_TYPES = [
  "camera-blur",
  "channel-blur",
  "tilt-shift",
  "luma-key",
  "color-key",
  "ultra-key",
  "alpha-adjust",
  "leave-color",
  "change-to-color",
  "solarize",
  "levels",
  "channel-mixer",
  "tint-map",
  "spherize",
  "twirl",
  "ripple",
  "turbulent-displace",
  "offset",
  "corner-pin",
  "polar-coordinates",
  "replicate",
  "color-emboss",
  "noise",
  "bevel-alpha",
  "four-color-gradient",
  "lens-flare",
  "strobe-light",
  "grid",
] as const;

export type ExtraProEffectType = (typeof EXTRA_PRO_EFFECT_TYPES)[number];

const EXTRA_SET: ReadonlySet<string> = new Set(EXTRA_PRO_EFFECT_TYPES);

export function isExtraProEffectType(type: string): type is ExtraProEffectType {
  return EXTRA_SET.has(type);
}

/** Extra effects that legitimately write alpha. */
export const EXTRA_EFFECTS_WRITING_ALPHA: readonly ExtraProEffectType[] = [
  "luma-key",
  "color-key",
  "ultra-key",
  "alpha-adjust",
  "corner-pin",
];

/** Effects whose output depends on the clip-local playback time. */
export const EXTRA_TIME_DRIVEN: readonly ExtraProEffectType[] = [
  "ripple",
  "noise",
  "strobe-light",
];

const num = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
  neutral: number,
  unit?: string,
  keyframable = true,
): ProEffectParamSpec => ({
  key,
  label,
  kind: "number",
  min,
  max,
  step,
  unit,
  default: def,
  neutral,
  keyframable,
});

const toggle = (
  key: string,
  label: string,
  def: boolean,
  neutral: boolean,
): ProEffectParamSpec => ({ key, label, kind: "toggle", default: def, neutral });

const select = (
  key: string,
  label: string,
  def: string,
  neutral: string,
  options: readonly (readonly [string, string])[],
): ProEffectParamSpec => ({
  key,
  label,
  kind: "select",
  default: def,
  neutral,
  options: options.map(([value, text]) => ({ value, label: text })),
});

/** Three 0-255 channel params labelled "<label> R/G/B". */
const rgb = (
  prefix: string,
  label: string,
  def: readonly [number, number, number],
  neutral: readonly [number, number, number] = def,
): ProEffectParamSpec[] =>
  (["r", "g", "b"] as const).map((ch, i) =>
    num(
      `${prefix}${ch.toUpperCase()}`,
      `${label} ${ch.toUpperCase()}`,
      0,
      255,
      1,
      def[i],
      neutral[i],
    ),
  );

const timeParam = num("time", "Time offset", 0, 3600, 0.1, 0, 0, "s", false);
const seedParam = (): ProEffectParamSpec =>
  num("seed", "Seed", 0, 9999, 1, 1, 1, undefined, false);

const spec = (
  type: ExtraProEffectType,
  label: string,
  description: string,
  category: ProEffectCategory,
  params: ProEffectParamSpec[],
): ProEffectSpec => ({ type, label, description, category, params });

const PIN_NEUTRAL = [0, 0, 100, 0, 100, 100, 0, 100] as const;
const PIN_DEFAULT = [10, 8, 92, 0, 100, 100, 0, 92] as const;
const PIN_NAMES = ["Top left", "Top right", "Bottom right", "Bottom left"];
const pinParams = (): ProEffectParamSpec[] =>
  PIN_NAMES.flatMap((name, i) => [
    num(`x${i}`, `${name} X`, -100, 200, 0.5, PIN_DEFAULT[i * 2], PIN_NEUTRAL[i * 2], "%"),
    num(`y${i}`, `${name} Y`, -100, 200, 0.5, PIN_DEFAULT[i * 2 + 1], PIN_NEUTRAL[i * 2 + 1], "%"),
  ]);

const mixerParams = (): ProEffectParamSpec[] => {
  const rows: readonly (readonly [string, string, readonly number[], readonly number[]])[] = [
    ["r", "Red", [50, 0, 50], [100, 0, 0]],
    ["g", "Green", [0, 100, 0], [0, 100, 0]],
    ["b", "Blue", [50, 0, 50], [0, 0, 100]],
  ];
  return rows.flatMap(([row, name, def, neutral]) =>
    (["r", "g", "b"] as const).map((src, i) =>
      num(`${row}${src}`, `${name} from ${src.toUpperCase()}`, -200, 200, 1, def[i], neutral[i], "%"),
    ),
  );
};

export const EXTRA_PRO_EFFECT_SPECS: Readonly<
  Record<ExtraProEffectType, ProEffectSpec>
> = {
  "camera-blur": spec(
    "camera-blur",
    "Camera Blur",
    "Lens-style disc blur with a round bokeh kernel",
    "Blur",
    [num("radius", "Radius", 0, 60, 0.5, 12, 0, "px")],
  ),
  "channel-blur": spec(
    "channel-blur",
    "Channel Blur",
    "Blur the red, green, blue and alpha channels independently",
    "Blur",
    [
      num("red", "Red", 0, 60, 0.5, 10, 0, "px"),
      num("green", "Green", 0, 60, 0.5, 0, 0, "px"),
      num("blue", "Blue", 0, 60, 0.5, 0, 0, "px"),
      num("alpha", "Alpha", 0, 60, 0.5, 0, 0, "px"),
    ],
  ),
  "tilt-shift": spec(
    "tilt-shift",
    "Tilt-Shift Blur",
    "Miniature-style blur that grows away from a sharp focus band",
    "Blur",
    [
      num("blur", "Blur", 0, 40, 0.5, 14, 0, "px"),
      num("angle", "Angle", 0, 360, 1, 0, 0, "°"),
      num("center", "Focus position", 0, 100, 1, 50, 50, "%"),
      num("focus", "Focus band", 0, 100, 1, 20, 20, "%"),
      num("falloff", "Falloff", 1, 100, 1, 30, 30, "%"),
    ],
  ),
  "luma-key": spec(
    "luma-key",
    "Luma Key",
    "Key out the darkest or brightest parts of the picture",
    "Keying",
    [
      select("mode", "Key out", "darker", "none", [
        ["none", "Off"],
        ["darker", "Darker"],
        ["brighter", "Brighter"],
      ]),
      num("threshold", "Threshold", 0, 100, 1, 20, 0, "%"),
      num("softness", "Softness", 0, 100, 1, 10, 0, "%"),
    ],
  ),
  "color-key": spec(
    "color-key",
    "Color Key",
    "Make a chosen colour transparent with tolerance and soft edges",
    "Keying",
    [
      ...rgb("key", "Key", [0, 255, 0]),
      num("tolerance", "Tolerance", 0, 100, 1, 40, 0, "%"),
      num("softness", "Edge softness", 0, 100, 1, 10, 0, "%"),
      toggle("invert", "Keep key colour", false, false),
    ],
  ),
  "ultra-key": spec(
    "ultra-key",
    "Ultra Key",
    "Premiere-style chroma keyer: matte, cleanup, spill suppression and colour correction",
    "Keying",
    [
      ...rgb("key", "Key", [0, 255, 0]),
      num("transparency", "Transparency", 0, 100, 1, 45, 0, "%"),
      num("highlight", "Highlight", 0, 100, 1, 10, 0, "%"),
      num("shadow", "Shadow", 0, 100, 1, 50, 0, "%"),
      num("tolerance", "Tolerance", 0, 100, 1, 50, 0, "%"),
      num("pedestal", "Pedestal", 0, 100, 1, 0, 0, "%"),
      num("choke", "Choke", 0, 100, 1, 0, 0),
      num("soften", "Soften", 0, 100, 1, 0, 0),
      num("contrast", "Contrast", 0, 100, 1, 0, 0),
      num("midPoint", "Mid point", 0, 100, 1, 50, 50, "%"),
      num("desaturate", "Desaturate", 0, 100, 1, 15, 0, "%"),
      num("range", "Range", 0, 100, 1, 50, 0, "%"),
      num("spill", "Spill", 0, 100, 1, 50, 0, "%"),
      num("luma", "Luma", 0, 100, 1, 50, 0, "%"),
      num("saturation", "Saturation", 0, 200, 1, 100, 100, "%"),
      num("hue", "Hue", -180, 180, 1, 0, 0, "°"),
      num("luminance", "Luminance", 0, 200, 1, 100, 100, "%"),
      select("output", "Output", "composite", "composite", [
        ["composite", "Composite"],
        ["alpha", "Alpha channel"],
        ["color", "Color channel"],
        ["source", "Source (key picker)"],
      ]),
    ],
  ),
  "alpha-adjust": spec(
    "alpha-adjust",
    "Alpha Adjust",
    "Opacity, ignore alpha, invert alpha or show the matte",
    "Keying",
    [
      num("opacity", "Opacity", 0, 100, 1, 60, 100, "%"),
      toggle("ignore", "Ignore alpha", false, false),
      toggle("invert", "Invert alpha", false, false),
      toggle("matte", "Matte only", false, false),
    ],
  ),
  "leave-color": spec(
    "leave-color",
    "Leave Color",
    "Desaturate everything except a chosen colour",
    "Color",
    [
      ...rgb("key", "Colour", [255, 0, 0]),
      num("amount", "Amount to decolour", 0, 100, 1, 100, 0, "%"),
      num("tolerance", "Tolerance", 0, 100, 1, 30, 30, "%"),
      num("softness", "Softness", 0, 100, 1, 20, 20, "%"),
    ],
  ),
  "change-to-color": spec(
    "change-to-color",
    "Change to Color",
    "Shift one colour range to another while keeping its detail",
    "Color",
    [
      ...rgb("from", "From", [0, 200, 0], [0, 200, 0]),
      ...rgb("to", "To", [255, 0, 160], [0, 200, 0]),
      num("tolerance", "Tolerance", 0, 100, 1, 45, 0, "%"),
      num("softness", "Softness", 0, 100, 1, 25, 0, "%"),
    ],
  ),
  solarize: spec(
    "solarize",
    "Solarize",
    "Invert every channel value above a threshold",
    "Color",
    [num("threshold", "Threshold", 0, 100, 1, 50, 100, "%")],
  ),
  levels: spec(
    "levels",
    "Levels",
    "Input black and white points, gamma and output range",
    "Color",
    [
      num("inBlack", "Input black", 0, 254, 1, 24, 0),
      num("inWhite", "Input white", 1, 255, 1, 225, 255),
      num("gamma", "Gamma", 0.1, 10, 0.01, 1.15, 1),
      num("outBlack", "Output black", 0, 255, 1, 0, 0),
      num("outWhite", "Output white", 0, 255, 1, 255, 255),
    ],
  ),
  "channel-mixer": spec(
    "channel-mixer",
    "Channel Mixer",
    "Rebuild each output channel from the input red, green and blue",
    "Color",
    [...mixerParams(), toggle("mono", "Monochrome", false, false)],
  ),
  "tint-map": spec(
    "tint-map",
    "Tint (Map Black/White)",
    "Map black and white to two colours",
    "Color",
    [
      ...rgb("black", "Black to", [10, 20, 60], [0, 0, 0]),
      ...rgb("white", "White to", [255, 230, 190], [255, 255, 255]),
      num("amount", "Amount", 0, 100, 1, 100, 0, "%"),
    ],
  ),
  spherize: spec(
    "spherize",
    "Spherize",
    "Bulge or pinch the picture around a point",
    "Distort",
    [
      num("amount", "Amount", -100, 100, 1, 60, 0),
      num("radius", "Radius", 1, 200, 1, 100, 100, "%"),
      num("centerX", "Center X", 0, 100, 0.5, 50, 50, "%"),
      num("centerY", "Center Y", 0, 100, 0.5, 50, 50, "%"),
    ],
  ),
  twirl: spec(
    "twirl",
    "Twirl",
    "Swirl the picture around a point",
    "Distort",
    [
      num("angle", "Angle", -720, 720, 1, 120, 0, "°"),
      num("radius", "Radius", 1, 200, 1, 80, 80, "%"),
      num("centerX", "Center X", 0, 100, 0.5, 50, 50, "%"),
      num("centerY", "Center Y", 0, 100, 0.5, 50, 50, "%"),
    ],
  ),
  ripple: spec(
    "ripple",
    "Wave Ripple",
    "Sine wave displacement with adjustable direction, length and speed",
    "Distort",
    [
      num("amplitude", "Amplitude", 0, 200, 0.5, 15, 0, "px"),
      num("wavelength", "Wavelength", 4, 1000, 1, 80, 80, "px"),
      num("angle", "Wave direction", 0, 360, 1, 0, 0, "°"),
      num("phase", "Phase", 0, 360, 1, 0, 0, "°"),
      num("speed", "Speed", -10, 10, 0.1, 0, 0, " cyc/s"),
      timeParam,
    ],
  ),
  "turbulent-displace": spec(
    "turbulent-displace",
    "Turbulent Displace",
    "Organic noise-driven warp that can evolve over time",
    "Distort",
    [
      num("amount", "Amount", 0, 300, 0.5, 40, 0, "px"),
      num("size", "Size", 4, 1000, 1, 120, 120, "px"),
      num("complexity", "Complexity", 1, 4, 1, 2, 2),
      num("evolution", "Evolution", 0, 1000, 0.1, 0, 0),
      seedParam(),
    ],
  ),
  offset: spec(
    "offset",
    "Offset",
    "Shift the picture; wrap around, repeat the edge or leave a gap",
    "Distort",
    [
      num("shiftX", "Shift X", -100, 100, 0.5, 20, 0, "%"),
      num("shiftY", "Shift Y", -100, 100, 0.5, 0, 0, "%"),
      select("edge", "Edges", "wrap", "wrap", [
        ["wrap", "Wrap around"],
        ["clamp", "Repeat edge"],
        ["transparent", "Transparent"],
      ]),
    ],
  ),
  "corner-pin": spec(
    "corner-pin",
    "Corner Pin",
    "Pull the four corners for perspective and keystone corrections",
    "Distort",
    pinParams(),
  ),
  "polar-coordinates": spec(
    "polar-coordinates",
    "Polar Coordinates",
    "Convert between rectangular and polar space",
    "Distort",
    [
      select("mode", "Conversion", "rect-to-polar", "rect-to-polar", [
        ["rect-to-polar", "Rect to polar"],
        ["polar-to-rect", "Polar to rect"],
      ]),
      num("amount", "Interpolation", 0, 100, 1, 100, 0, "%"),
    ],
  ),
  replicate: spec(
    "replicate",
    "Replicate",
    "Tile the picture into a grid of copies",
    "Distort",
    [num("count", "Tiles per side", 1, 16, 1, 2, 1)],
  ),
  "color-emboss": spec(
    "color-emboss",
    "Color Emboss",
    "Relief that keeps the original colours",
    "Stylize",
    [
      num("amount", "Blend", 0, 100, 1, 100, 0, "%"),
      num("angle", "Light angle", 0, 360, 1, 135, 135, "°"),
      num("relief", "Relief", 0, 10, 0.1, 1, 1),
    ],
  ),
  noise: spec(
    "noise",
    "Noise",
    "Add animated mono or colour noise",
    "Stylize",
    [
      num("amount", "Amount", 0, 100, 1, 25, 0, "%"),
      num("size", "Grain size", 1, 32, 1, 1, 1, "px"),
      toggle("mono", "Monochrome", false, false),
      timeParam,
      seedParam(),
    ],
  ),
  "bevel-alpha": spec(
    "bevel-alpha",
    "Bevel Alpha",
    "Light and shade the edges of the alpha channel for a raised look",
    "Stylize",
    [
      num("thickness", "Edge thickness", 1, 50, 1, 12, 12, "px"),
      num("angle", "Light angle", 0, 360, 1, 135, 135, "°"),
      num("intensity", "Intensity", 0, 100, 1, 70, 0, "%"),
    ],
  ),
  "four-color-gradient": spec(
    "four-color-gradient",
    "4-Color Gradient",
    "Blend a four-corner colour gradient over the picture",
    "Generate",
    [
      ...rgb("c1", "Top left", [255, 60, 90]),
      ...rgb("c2", "Top right", [255, 200, 40]),
      ...rgb("c3", "Bottom left", [40, 120, 255]),
      ...rgb("c4", "Bottom right", [120, 40, 200]),
      num("opacity", "Opacity", 0, 100, 1, 50, 0, "%"),
      select("blend", "Blend", "normal", "normal", [
        ["normal", "Normal"],
        ["multiply", "Multiply"],
        ["screen", "Screen"],
        ["add", "Add"],
      ]),
    ],
  ),
  "lens-flare": spec(
    "lens-flare",
    "Lens Flare",
    "Bright light source with halo, ring and ghost reflections",
    "Generate",
    [
      num("centerX", "Light X", 0, 100, 0.5, 70, 70, "%"),
      num("centerY", "Light Y", 0, 100, 0.5, 30, 30, "%"),
      num("brightness", "Brightness", 0, 200, 1, 100, 0, "%"),
      num("size", "Size", 1, 200, 1, 100, 100, "%"),
    ],
  ),
  "strobe-light": spec(
    "strobe-light",
    "Strobe Light",
    "Periodic colour flash",
    "Generate",
    [
      ...rgb("flash", "Flash", [255, 255, 255]),
      num("opacity", "Opacity", 0, 100, 1, 80, 0, "%"),
      num("period", "Period", 0.05, 10, 0.05, 0.5, 0.5, "s"),
      num("duration", "Flash length", 0, 10, 0.01, 0.1, 0.1, "s"),
      num("phase", "Phase", -10, 10, 0.01, 0.05, 0.05, "s"),
      select("blend", "Blend", "normal", "normal", [
        ["normal", "Normal"],
        ["add", "Add"],
      ]),
      timeParam,
    ],
  ),
  grid: spec(
    "grid",
    "Grid",
    "Overlay a line grid for alignment or a graphic look",
    "Generate",
    [
      num("size", "Cell size", 4, 500, 1, 64, 64, "px"),
      num("border", "Line width", 1, 50, 1, 2, 2, "px"),
      ...rgb("line", "Line", [255, 255, 255]),
      num("opacity", "Opacity", 0, 100, 1, 60, 0, "%"),
    ],
  ),
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Same bit-exact hash as pro-effects.ts hash01 (duplicated to avoid a value cycle). */
function hashUnit(a: number, c: number, d: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(c | 0, 668265263)) | 0;
  h = (h + Math.imul(d | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return Math.fround(h >>> 0) / 4294967296;
}

const frameIndex = (time: number): number =>
  Math.floor(Math.max(0, Number.isFinite(time) ? time : 0) * 24 + 1e-6);

const seedInt = (seed: number): number => {
  const s = Math.floor(Number.isFinite(seed) ? seed : 0);
  return ((s % 16777216) + 16777216) % 16777216;
};

const luma255 = (r: number, g: number, b: number): number =>
  0.299 * r + 0.587 * g + 0.114 * b;

const RGB_DIAG = 441.6729559300637;

function colorDistancePct(
  r: number,
  g: number,
  b: number,
  kr: number,
  kg: number,
  kb: number,
): number {
  return (Math.hypot(r - kr, g - kg, b - kb) / RGB_DIAG) * 100;
}

/** 1 within `tol`, ramping to 0 over `soft` (hard edge when soft is 0). */
function matchWeight(dist: number, tol: number, soft: number): number {
  if (soft <= 0) return dist <= tol ? 1 : 0;
  return 1 - clamp((dist - tol) / soft, 0, 1);
}

function sampleBilinear(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  fx: number,
  fy: number,
  out: number[],
): void {
  const x = clamp(fx, 0, width - 1);
  const y = clamp(fy, 0, height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  for (let ch = 0; ch < 4; ch++) {
    const top =
      src[(y0 * width + x0) * 4 + ch] * (1 - tx) +
      src[(y0 * width + x1) * 4 + ch] * tx;
    const bottom =
      src[(y1 * width + x0) * 4 + ch] * (1 - tx) +
      src[(y1 * width + x1) * 4 + ch] * tx;
    out[ch] = top * (1 - ty) + bottom * ty;
  }
}

function put(data: Uint8ClampedArray, o: number, px: readonly number[]): void {
  data[o] = Math.round(px[0]);
  data[o + 1] = Math.round(px[1]);
  data[o + 2] = Math.round(px[2]);
  data[o + 3] = Math.round(px[3]);
}

type Params = ResolvedProParams;
const n = (p: Params, key: string): number => p[key] as number;
const b = (p: Params, key: string): boolean => p[key] === true;

/** Clamps every numeric param into its spec range (CPU and GPU share this). */
export function normalizeExtraParams(
  type: ExtraProEffectType,
  p: Params,
): Params {
  const out: Params = { ...p };
  for (const s of EXTRA_PRO_EFFECT_SPECS[type].params) {
    if (s.kind === "number") {
      out[s.key] = clamp(p[s.key] as number, s.min ?? -Infinity, s.max ?? Infinity);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Neutral detection                                                           */
/* -------------------------------------------------------------------------- */

/** True when the (already resolved) params leave the picture unchanged. */
export function isExtraNeutral(type: ExtraProEffectType, resolved: Params): boolean {
  const p = normalizeExtraParams(type, resolved);
  switch (type) {
    case "camera-blur":
      return n(p, "radius") < 0.5;
    case "channel-blur":
      return ["red", "green", "blue", "alpha"].every((k) => n(p, k) < 0.5);
    case "tilt-shift":
      return n(p, "blur") < 0.5;
    case "luma-key":
      return p.mode === "none";
    case "color-key":
      return n(p, "tolerance") === 0 && n(p, "softness") === 0 && !b(p, "invert");
    case "ultra-key":
      return isUltraKeyNeutral(p as unknown as UltraKeyParams);
    case "alpha-adjust":
      return (
        n(p, "opacity") === 100 && !b(p, "ignore") && !b(p, "invert") && !b(p, "matte")
      );
    case "leave-color":
      return n(p, "amount") === 0;
    case "change-to-color":
      return n(p, "tolerance") === 0 && n(p, "softness") === 0;
    case "solarize":
      return n(p, "threshold") >= 100;
    case "levels":
      return (
        n(p, "inBlack") === 0 &&
        n(p, "inWhite") === 255 &&
        n(p, "gamma") === 1 &&
        n(p, "outBlack") === 0 &&
        n(p, "outWhite") === 255
      );
    case "channel-mixer": {
      if (b(p, "mono")) return false;
      const ident: Record<string, number> = { rr: 100, gg: 100, bb: 100 };
      return ["rr", "rg", "rb", "gr", "gg", "gb", "br", "bg", "bb"].every(
        (k) => n(p, k) === (ident[k] ?? 0),
      );
    }
    case "tint-map":
      return n(p, "amount") === 0;
    case "spherize":
      return n(p, "amount") === 0;
    case "twirl":
      return n(p, "angle") === 0;
    case "ripple":
      return n(p, "amplitude") === 0;
    case "turbulent-displace":
      return n(p, "amount") === 0;
    case "offset":
      return n(p, "shiftX") === 0 && n(p, "shiftY") === 0;
    case "corner-pin":
      return PIN_NEUTRAL.every((v, i) => n(p, `${i % 2 === 0 ? "x" : "y"}${i >> 1}`) === v);
    case "polar-coordinates":
      return n(p, "amount") === 0;
    case "replicate":
      return Math.round(n(p, "count")) <= 1;
    case "color-emboss":
      return n(p, "amount") === 0;
    case "noise":
      return n(p, "amount") === 0;
    case "bevel-alpha":
      return n(p, "intensity") === 0;
    case "four-color-gradient":
      return n(p, "opacity") === 0;
    case "lens-flare":
      return n(p, "brightness") === 0;
    case "strobe-light":
      return n(p, "opacity") === 0;
    case "grid":
      return n(p, "opacity") === 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Shared derived values                                                       */
/* -------------------------------------------------------------------------- */

/** Disc-blur sample count: the golden-angle spiral used on CPU and GPU. */
export function discSampleCount(radius: number): number {
  return Math.min(96, Math.max(12, Math.ceil(radius * 2) + 8));
}
const GOLDEN_ANGLE = 2.399963229728653;

/** Strided gaussian layout the GPU uses (taps per side, stride). */
function gaussianLayout(radius: number): { sigma: number; stride: number; taps: number } {
  const extent = Math.ceil(radius);
  const stride = Math.max(1, extent / 6);
  return { sigma: Math.max(0.1, radius / 2), stride, taps: Math.ceil(extent / stride) };
}
export { gaussianLayout as extraGaussianLayout };

/** Projective matrix mapping the unit square onto the quad (Heckbert). */
function squareToQuad(q: readonly number[]): number[] {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
    return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
  }
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / det;
  const h = (dx1 * sy - sx * dy1) / det;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

function invert3(m: readonly number[]): number[] | null {
  const [a, bb, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = c * h - bb * i;
  const C = bb * f - c * e;
  const det = a * A + d * B + g * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    A * inv,
    B * inv,
    C * inv,
    (f * g - d * i) * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    (d * h - e * g) * inv,
    (bb * g - a * h) * inv,
    (a * e - bb * d) * inv,
  ];
}

/**
 * Row-major inverse homography taking a normalised output position (0-1) to
 * the normalised source position, or null for a degenerate quad.
 */
export function cornerPinInverse(p: Readonly<Record<string, number>>): number[] | null {
  const quad: number[] = [];
  for (let i = 0; i < 4; i++) quad.push(p[`x${i}`] / 100, p[`y${i}`] / 100);
  return invert3(squareToQuad(quad));
}

/** Wave phase in radians, folding in speed x clip-local time. */
export function ripplePhase(phaseDeg: number, speed: number, time: number): number {
  return ((phaseDeg + 360 * speed * time) * Math.PI) / 180;
}

/** 1 while the strobe flash is on. */
export function strobeOn(time: number, period: number, duration: number, phase: number): number {
  const t = time + phase;
  const m = t - Math.floor(t / period) * period;
  return m < duration ? 1 : 0;
}

const BLEND_FLAGS: Readonly<Record<string, number>> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  add: 3,
};

/* -------------------------------------------------------------------------- */
/* CPU reference implementations                                               */
/* -------------------------------------------------------------------------- */

function mapSample(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  mapper: (x: number, y: number, out: number[]) => boolean,
): void {
  const copy = new Uint8ClampedArray(data);
  const px = [0, 0, 0, 0];
  const pos = [0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (!mapper(x, y, pos)) {
        data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
        continue;
      }
      sampleBilinear(copy, width, height, pos[0], pos[1], px);
      put(data, o, px);
    }
  }
}

function discAverage(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  r: number,
  count: number,
  tmp: number[],
  out: number[],
): void {
  out[0] = out[1] = out[2] = out[3] = 0;
  for (let i = 0; i < count; i++) {
    const rho = r * Math.sqrt((i + 0.5) / count);
    const th = i * GOLDEN_ANGLE;
    sampleBilinear(src, width, height, x + rho * Math.cos(th), y + rho * Math.sin(th), tmp);
    const w = tmp[3];
    out[0] += tmp[0] * w;
    out[1] += tmp[1] * w;
    out[2] += tmp[2] * w;
    out[3] += w;
  }
  // Alpha-weighted colour: transparent samples (stored as rgb 0) must not darken the edge.
  const wsum = out[3];
  for (let c = 0; c < 3; c++) out[c] = wsum > 0 ? out[c] / wsum : 0;
  out[3] = wsum / count;
}

function gaussianChannel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  ch: number,
  radius: number,
): void {
  if (radius < 0.5) return;
  const sigma = Math.max(0.1, radius / 2);
  const half = Math.max(1, Math.ceil(radius));
  const kernel = new Float32Array(half * 2 + 1);
  let sum = 0;
  for (let i = 0; i < kernel.length; i++) {
    const d = i - half;
    kernel[i] = Math.exp(-(d * d) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const tmp = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < kernel.length; k++) {
        acc += data[(y * width + clamp(x + k - half, 0, width - 1)) * 4 + ch] * kernel[k];
      }
      tmp[y * width + x] = acc;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < kernel.length; k++) {
        acc += tmp[clamp(y + k - half, 0, height - 1) * width + x] * kernel[k];
      }
      data[(y * width + x) * 4 + ch] = Math.round(acc);
    }
  }
}

function valueNoise(x: number, y: number, seed: number, salt: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hashUnit(seed + xi, yi, salt);
  const bq = hashUnit(seed + xi + 1, yi, salt);
  const c = hashUnit(seed + xi, yi + 1, salt);
  const d = hashUnit(seed + xi + 1, yi + 1, salt);
  return a + (bq - a) * ux + (c - a) * uy + (a - bq - c + d) * ux * uy;
}

function fbm(x: number, y: number, seed: number, salt: number, octaves: number): number {
  let sum = 0;
  let norm = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 4; o++) {
    if (o >= octaves) break;
    sum += amp * valueNoise(x * freq, y * freq, seed, salt + o * 2);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function polarSource(
  x: number,
  y: number,
  width: number,
  height: number,
  mode: string,
  amount: number,
  out: number[],
): void {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const rmax = Math.max(1e-6, Math.hypot(cx, cy));
  let mx: number;
  let my: number;
  if (mode === "rect-to-polar") {
    const dx = x - cx;
    const dy = y - cy;
    mx = (Math.atan2(dy, dx) / (2 * Math.PI) + 0.5) * (width - 1);
    my = (Math.hypot(dx, dy) / rmax) * (height - 1);
  } else {
    const th = (x / Math.max(1, width - 1) - 0.5) * 2 * Math.PI;
    const rho = (y / Math.max(1, height - 1)) * rmax;
    mx = cx + rho * Math.cos(th);
    my = cy + rho * Math.sin(th);
  }
  out[0] = x + (mx - x) * amount;
  out[1] = y + (my - y) * amount;
}

const FLARE_GHOSTS = [
  { t: 0.55, r: 0.9, i: 0.3, c: [0.4, 1.0, 0.6] },
  { t: 1.0, r: 0.5, i: 0.22, c: [1.0, 0.6, 0.5] },
  { t: 1.45, r: 1.3, i: 0.16, c: [0.5, 0.6, 1.0] },
] as const;

/** Linear-in-8bit flare colour at pixel (x, y). */
function flareAt(
  x: number,
  y: number,
  width: number,
  height: number,
  p: Params,
  out: number[],
): void {
  const s = (n(p, "size") / 100) * 0.06 * Math.min(width, height);
  const fx = (n(p, "centerX") / 100) * width;
  const fy = (n(p, "centerY") / 100) * height;
  const d = Math.hypot(x - fx, y - fy);
  const core = Math.exp(-((d / s) * (d / s)));
  const halo = 0.35 * Math.exp(-((d / (4 * s)) * (d / (4 * s))));
  const rg = (d - 5 * s) / (0.6 * s);
  const ring = 0.25 * Math.exp(-rg * rg);
  out[0] = core * 1.0 + halo * 1.0 + ring * 0.6;
  out[1] = core * 0.93 + halo * 0.75 + ring * 0.8;
  out[2] = core * 0.8 + halo * 0.45 + ring * 1.0;
  const ax = width / 2 - fx;
  const ay = height / 2 - fy;
  for (const g of FLARE_GHOSTS) {
    const gd = Math.hypot(x - (fx + ax * g.t), y - (fy + ay * g.t));
    const rr = g.r * s;
    const w = g.i * Math.exp(-((gd / rr) * (gd / rr)));
    out[0] += w * g.c[0];
    out[1] += w * g.c[1];
    out[2] += w * g.c[2];
  }
}

/**
 * Applies one of the wave 7 effects in place. `resolved` must already be
 * resolved against the spec (missing values neutral). Returns false when
 * `type` is not an extra effect.
 */
export function applyExtraProEffect(
  type: string,
  resolved: Params,
  data: Uint8ClampedArray,
  width: number,
  height: number,
): boolean {
  if (!isExtraProEffectType(type)) return false;
  if (isExtraNeutral(type, resolved)) return true;
  const p = normalizeExtraParams(type, resolved);
  const total = width * height;
  switch (type) {
    case "camera-blur": {
      const r = n(p, "radius");
      const count = discSampleCount(r);
      const copy = new Uint8ClampedArray(data);
      const tmp = [0, 0, 0, 0];
      const acc = [0, 0, 0, 0];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          discAverage(copy, width, height, x, y, r, count, tmp, acc);
          put(data, (y * width + x) * 4, acc);
        }
      }
      break;
    }
    case "channel-blur": {
      const radii = [n(p, "red"), n(p, "green"), n(p, "blue"), n(p, "alpha")];
      const copy = new Uint8ClampedArray(data);
      radii.forEach((r, ch) => {
        if (r < 0.5) return;
        const work = new Uint8ClampedArray(copy);
        gaussianChannel(work, width, height, ch, r);
        for (let i = 0; i < total; i++) data[i * 4 + ch] = work[i * 4 + ch];
      });
      break;
    }
    case "tilt-shift": {
      const maxR = n(p, "blur");
      const count = discSampleCount(maxR);
      const rad = (n(p, "angle") * Math.PI) / 180;
      const nx = -Math.sin(rad);
      const ny = Math.cos(rad);
      const span = Math.abs(width * nx) + Math.abs(height * ny);
      const shift = ((n(p, "center") - 50) / 100) * span;
      const halfBand = ((n(p, "focus") / 100) * span) / 2;
      const fade = Math.max(((n(p, "falloff") / 100) * span) / 2, 1e-3);
      const cx = (width - 1) / 2;
      const cy = (height - 1) / 2;
      const copy = new Uint8ClampedArray(data);
      const tmp = [0, 0, 0, 0];
      const acc = [0, 0, 0, 0];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const d = (x - cx) * nx + (y - cy) * ny - shift;
          const t = clamp((Math.abs(d) - halfBand) / fade, 0, 1);
          const r = maxR * t;
          if (r < 0.5) continue;
          discAverage(copy, width, height, x, y, r, count, tmp, acc);
          put(data, (y * width + x) * 4, acc);
        }
      }
      break;
    }
    case "luma-key": {
      const dark = p.mode === "darker";
      const t = n(p, "threshold") / 100;
      const s = n(p, "softness") / 100;
      for (let o = 0; o < data.length; o += 4) {
        const l = luma255(data[o], data[o + 1], data[o + 2]) / 255;
        const edge = dark ? l - t : t - l;
        const cov = s <= 0 ? (edge >= 0 ? 1 : 0) : clamp(edge / s, 0, 1);
        if (cov < 1) data[o + 3] = Math.round(data[o + 3] * cov);
      }
      break;
    }
    case "color-key": {
      const kr = n(p, "keyR");
      const kg = n(p, "keyG");
      const kb = n(p, "keyB");
      const tol = n(p, "tolerance");
      const soft = n(p, "softness");
      const invert = b(p, "invert");
      for (let o = 0; o < data.length; o += 4) {
        const dist = colorDistancePct(data[o], data[o + 1], data[o + 2], kr, kg, kb);
        let cov = 1 - matchWeight(dist, tol, soft);
        if (invert) cov = 1 - cov;
        if (cov < 1) data[o + 3] = Math.round(data[o + 3] * cov);
      }
      break;
    }
    case "ultra-key":
      applyUltraKey(data, width, height, p as unknown as UltraKeyParams);
      break;
    case "alpha-adjust": {
      const opacity = n(p, "opacity") / 100;
      for (let o = 0; o < data.length; o += 4) {
        let a = b(p, "ignore") ? 255 : data[o + 3];
        if (b(p, "invert")) a = 255 - a;
        a *= opacity;
        if (b(p, "matte")) {
          const v = Math.round(a);
          data[o] = data[o + 1] = data[o + 2] = v;
          data[o + 3] = 255;
        } else {
          data[o + 3] = Math.round(a);
        }
      }
      break;
    }
    case "leave-color": {
      const kr = n(p, "keyR");
      const kg = n(p, "keyG");
      const kb = n(p, "keyB");
      const amount = n(p, "amount") / 100;
      const tol = n(p, "tolerance");
      const soft = n(p, "softness");
      for (let o = 0; o < data.length; o += 4) {
        const r = data[o];
        const g = data[o + 1];
        const bl = data[o + 2];
        const w = matchWeight(colorDistancePct(r, g, bl, kr, kg, kb), tol, soft);
        const k = amount * (1 - w);
        const y = luma255(r, g, bl);
        data[o] = Math.round(r + (y - r) * k);
        data[o + 1] = Math.round(g + (y - g) * k);
        data[o + 2] = Math.round(bl + (y - bl) * k);
      }
      break;
    }
    case "change-to-color": {
      const fr = n(p, "fromR");
      const fg = n(p, "fromG");
      const fb = n(p, "fromB");
      const dr = n(p, "toR") - fr;
      const dg = n(p, "toG") - fg;
      const db = n(p, "toB") - fb;
      const tol = n(p, "tolerance");
      const soft = n(p, "softness");
      for (let o = 0; o < data.length; o += 4) {
        const w = matchWeight(
          colorDistancePct(data[o], data[o + 1], data[o + 2], fr, fg, fb),
          tol,
          soft,
        );
        data[o] = Math.round(clamp(data[o] + dr * w, 0, 255));
        data[o + 1] = Math.round(clamp(data[o + 1] + dg * w, 0, 255));
        data[o + 2] = Math.round(clamp(data[o + 2] + db * w, 0, 255));
      }
      break;
    }
    case "solarize": {
      const t = (n(p, "threshold") / 100) * 255;
      for (let o = 0; o < data.length; o += 4) {
        for (let ch = 0; ch < 3; ch++) if (data[o + ch] > t) data[o + ch] = 255 - data[o + ch];
      }
      break;
    }
    case "levels": {
      const ib = n(p, "inBlack");
      const iw = n(p, "inWhite");
      const inv = 1 / n(p, "gamma");
      const ob = n(p, "outBlack");
      const ow = n(p, "outWhite");
      const range = Math.max(iw - ib, 1);
      for (let o = 0; o < data.length; o += 4) {
        for (let ch = 0; ch < 3; ch++) {
          const v = Math.pow(clamp((data[o + ch] - ib) / range, 0, 1), inv);
          data[o + ch] = Math.round(clamp(ob + (ow - ob) * v, 0, 255));
        }
      }
      break;
    }
    case "channel-mixer": {
      const m = ["rr", "rg", "rb", "gr", "gg", "gb", "br", "bg", "bb"].map((k) => n(p, k) / 100);
      const mono = b(p, "mono");
      for (let o = 0; o < data.length; o += 4) {
        const r = data[o];
        const g = data[o + 1];
        const bl = data[o + 2];
        let or = clamp(m[0] * r + m[1] * g + m[2] * bl, 0, 255);
        let og = clamp(m[3] * r + m[4] * g + m[5] * bl, 0, 255);
        let ob = clamp(m[6] * r + m[7] * g + m[8] * bl, 0, 255);
        if (mono) or = og = ob = luma255(or, og, ob);
        data[o] = Math.round(or);
        data[o + 1] = Math.round(og);
        data[o + 2] = Math.round(ob);
      }
      break;
    }
    case "tint-map": {
      const bk = [n(p, "blackR"), n(p, "blackG"), n(p, "blackB")];
      const wh = [n(p, "whiteR"), n(p, "whiteG"), n(p, "whiteB")];
      const amt = n(p, "amount") / 100;
      for (let o = 0; o < data.length; o += 4) {
        const l = luma255(data[o], data[o + 1], data[o + 2]) / 255;
        for (let ch = 0; ch < 3; ch++) {
          const mapped = bk[ch] + (wh[ch] - bk[ch]) * l;
          data[o + ch] = Math.round(data[o + ch] + (mapped - data[o + ch]) * amt);
        }
      }
      break;
    }
    case "spherize": {
      const cx = (n(p, "centerX") / 100) * (width - 1);
      const cy = (n(p, "centerY") / 100) * (height - 1);
      const R = (n(p, "radius") / 100) * (Math.min(width, height) / 2);
      const a = n(p, "amount") / 100;
      const e = a >= 0 ? 1 + a * 2 : 1 / (1 - a * 2);
      mapSample(data, width, height, (x, y, out) => {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy);
        if (r >= R || r === 0) {
          out[0] = x;
          out[1] = y;
          return true;
        }
        const k = (R * Math.pow(r / R, e)) / r;
        out[0] = cx + dx * k;
        out[1] = cy + dy * k;
        return true;
      });
      break;
    }
    case "twirl": {
      const cx = (n(p, "centerX") / 100) * (width - 1);
      const cy = (n(p, "centerY") / 100) * (height - 1);
      const R = (n(p, "radius") / 100) * (Math.min(width, height) / 2);
      const ang = (n(p, "angle") * Math.PI) / 180;
      mapSample(data, width, height, (x, y, out) => {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy);
        if (r >= R) {
          out[0] = x;
          out[1] = y;
          return true;
        }
        const t = 1 - r / R;
        const th = ang * t * t;
        const cs = Math.cos(th);
        const sn = Math.sin(th);
        out[0] = cx + dx * cs + dy * sn;
        out[1] = cy - dx * sn + dy * cs;
        return true;
      });
      break;
    }
    case "ripple": {
      const rad = (n(p, "angle") * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      const phase = ripplePhase(n(p, "phase"), n(p, "speed"), n(p, "time"));
      const amp = n(p, "amplitude");
      const k = (2 * Math.PI) / n(p, "wavelength");
      mapSample(data, width, height, (x, y, out) => {
        const disp = amp * Math.sin((x * dx + y * dy) * k + phase);
        out[0] = x - dy * disp;
        out[1] = y + dx * disp;
        return true;
      });
      break;
    }
    case "turbulent-displace": {
      const amt = n(p, "amount");
      const size = n(p, "size");
      const oct = Math.round(n(p, "complexity"));
      const evo = n(p, "evolution") * 0.05;
      const seed = seedInt(n(p, "seed")) % 65536;
      mapSample(data, width, height, (x, y, out) => {
        const gx = x / size + evo;
        const gy = y / size + evo;
        out[0] = x + (fbm(gx, gy, seed, 0, oct) - 0.5) * 2 * amt;
        out[1] = y + (fbm(gx, gy, seed, 1000, oct) - 0.5) * 2 * amt;
        return true;
      });
      break;
    }
    case "offset": {
      const sx = Math.round((n(p, "shiftX") / 100) * width);
      const sy = Math.round((n(p, "shiftY") / 100) * height);
      const mode = p.edge as string;
      const copy = new Uint8ClampedArray(data);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let qx = x - sx;
          let qy = y - sy;
          const o = (y * width + x) * 4;
          if (mode === "wrap") {
            qx = ((qx % width) + width) % width;
            qy = ((qy % height) + height) % height;
          } else if (qx < 0 || qx >= width || qy < 0 || qy >= height) {
            if (mode === "transparent") {
              data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
              continue;
            }
            qx = clamp(qx, 0, width - 1);
            qy = clamp(qy, 0, height - 1);
          }
          const s = (qy * width + qx) * 4;
          data[o] = copy[s];
          data[o + 1] = copy[s + 1];
          data[o + 2] = copy[s + 2];
          data[o + 3] = copy[s + 3];
        }
      }
      break;
    }
    case "corner-pin": {
      const h = cornerPinInverse(p as Record<string, number>);
      mapSample(data, width, height, (x, y, out) => {
        if (!h) return false;
        const X = (x + 0.5) / width;
        const Y = (y + 0.5) / height;
        const w = h[6] * X + h[7] * Y + h[8];
        if (!(Math.abs(w) > 1e-9)) return false;
        const u = (h[0] * X + h[1] * Y + h[2]) / w;
        const v = (h[3] * X + h[4] * Y + h[5]) / w;
        if (u < 0 || u > 1 || v < 0 || v > 1) return false;
        out[0] = u * width - 0.5;
        out[1] = v * height - 0.5;
        return true;
      });
      break;
    }
    case "polar-coordinates": {
      const amt = n(p, "amount") / 100;
      const mode = p.mode as string;
      mapSample(data, width, height, (x, y, out) => {
        polarSource(x, y, width, height, mode, amt, out);
        return true;
      });
      break;
    }
    case "replicate": {
      const c = Math.round(n(p, "count"));
      const copy = new Uint8ClampedArray(data);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const s = (((y * c) % height) * width + ((x * c) % width)) * 4;
          const o = (y * width + x) * 4;
          data[o] = copy[s];
          data[o + 1] = copy[s + 1];
          data[o + 2] = copy[s + 2];
          data[o + 3] = copy[s + 3];
        }
      }
      break;
    }
    case "color-emboss": {
      const rad = (n(p, "angle") * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      const k = n(p, "relief") * (n(p, "amount") / 100);
      const copy = new Uint8ClampedArray(data);
      const at = (qx: number, qy: number): number =>
        (clamp(qy, 0, height - 1) * width + clamp(qx, 0, width - 1)) * 4;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const a = at(Math.floor(x + dx + 0.5), Math.floor(y + dy + 0.5));
          const bb = at(Math.floor(x - dx + 0.5), Math.floor(y - dy + 0.5));
          const o = (y * width + x) * 4;
          for (let ch = 0; ch < 3; ch++) {
            data[o + ch] = Math.round(clamp(copy[o + ch] + (copy[a + ch] - copy[bb + ch]) * k, 0, 255));
          }
        }
      }
      break;
    }
    case "noise": {
      const amt = (n(p, "amount") / 100) * 0.5 * 255;
      const size = Math.max(1, Math.round(n(p, "size")));
      const frame = frameIndex(n(p, "time"));
      const seed = seedInt(n(p, "seed"));
      const mono = b(p, "mono");
      for (let y = 0; y < height; y++) {
        const by = Math.floor(y / size);
        for (let x = 0; x < width; x++) {
          const bx = Math.floor(x / size);
          const o = (y * width + x) * 4;
          for (let ch = 0; ch < 3; ch++) {
            const salt = mono ? 0 : ch * 7919;
            const nz = (hashUnit(seed + salt + bx, frame, by) * 2 - 1) * amt;
            data[o + ch] = Math.round(clamp(data[o + ch] + nz, 0, 255));
          }
        }
      }
      break;
    }
    case "bevel-alpha": {
      const T = n(p, "thickness");
      const rad = (n(p, "angle") * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      const intensity = n(p, "intensity") / 100;
      const src = new Uint8ClampedArray(data);
      const alpha = (qx: number, qy: number): number =>
        qx < 0 || qx >= width || qy < 0 || qy >= height
          ? 0
          : src[(qy * width + qx) * 4 + 3] / 255;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let g = 0;
          for (let k = 1; k <= 4; k++) {
            const off = (T * k) / 4;
            g +=
              alpha(Math.floor(x - dx * off + 0.5), Math.floor(y - dy * off + 0.5)) -
              alpha(Math.floor(x + dx * off + 0.5), Math.floor(y + dy * off + 0.5));
          }
          const o = (y * width + x) * 4;
          g = (g / 4) * (src[o + 3] / 255);
          for (let ch = 0; ch < 3; ch++) {
            const c = src[o + ch];
            const target = g > 0 ? 255 - c : c;
            data[o + ch] = Math.round(clamp(c + g * intensity * target, 0, 255));
          }
        }
      }
      break;
    }
    case "four-color-gradient": {
      const col = (i: number): number[] => [n(p, `c${i}R`), n(p, `c${i}G`), n(p, `c${i}B`)];
      const [c1, c2, c3, c4] = [col(1), col(2), col(3), col(4)];
      const opacity = n(p, "opacity") / 100;
      const blend = BLEND_FLAGS[p.blend as string] ?? 0;
      for (let y = 0; y < height; y++) {
        const v = (y + 0.5) / height;
        for (let x = 0; x < width; x++) {
          const u = (x + 0.5) / width;
          const o = (y * width + x) * 4;
          for (let ch = 0; ch < 3; ch++) {
            const top = c1[ch] + (c2[ch] - c1[ch]) * u;
            const bot = c3[ch] + (c4[ch] - c3[ch]) * u;
            const g = top + (bot - top) * v;
            const c = data[o + ch];
            const mixed =
              blend === 1
                ? (c * g) / 255
                : blend === 2
                  ? 255 - ((255 - c) * (255 - g)) / 255
                  : blend === 3
                    ? Math.min(c + g, 255)
                    : g;
            data[o + ch] = Math.round(c + (mixed - c) * opacity);
          }
        }
      }
      break;
    }
    case "lens-flare": {
      const L = n(p, "brightness") / 100;
      const f = [0, 0, 0];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          flareAt(x, y, width, height, p, f);
          const o = (y * width + x) * 4;
          for (let ch = 0; ch < 3; ch++) {
            data[o + ch] = Math.round(clamp(data[o + ch] + f[ch] * L * 255, 0, 255));
          }
        }
      }
      break;
    }
    case "strobe-light": {
      const on = strobeOn(n(p, "time"), n(p, "period"), n(p, "duration"), n(p, "phase"));
      if (!on) break;
      const col = [n(p, "flashR"), n(p, "flashG"), n(p, "flashB")];
      const op = n(p, "opacity") / 100;
      const add = p.blend === "add";
      for (let o = 0; o < data.length; o += 4) {
        for (let ch = 0; ch < 3; ch++) {
          data[o + ch] = Math.round(
            add
              ? clamp(data[o + ch] + col[ch] * op, 0, 255)
              : data[o + ch] + (col[ch] - data[o + ch]) * op,
          );
        }
      }
      break;
    }
    case "grid": {
      const size = Math.floor(n(p, "size"));
      const border = Math.floor(n(p, "border"));
      const col = [n(p, "lineR"), n(p, "lineG"), n(p, "lineB")];
      const op = n(p, "opacity") / 100;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (x % size >= border && y % size >= border) continue;
          const o = (y * width + x) * 4;
          for (let ch = 0; ch < 3; ch++) {
            data[o + ch] = Math.round(data[o + ch] + (col[ch] - data[o + ch]) * op);
          }
        }
      }
      break;
    }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* GPU uniform mapping                                                         */
/* -------------------------------------------------------------------------- */

const rgbU = (p: Params, prefix: string, name: string): Record<string, number> => ({
  [`${name}R`]: n(p, `${prefix}R`) / 255,
  [`${name}G`]: n(p, `${prefix}G`) / 255,
  [`${name}B`]: n(p, `${prefix}B`) / 255,
});

/** Uniforms for the GLSL port of an extra effect (names without `u_`). */
export function extraProEffectGpuUniforms(
  type: ExtraProEffectType,
  resolved: Params,
): Record<string, number> {
  const p = normalizeExtraParams(type, resolved);
  switch (type) {
    case "camera-blur":
      return { radius: n(p, "radius"), count: discSampleCount(n(p, "radius")) };
    case "channel-blur":
      return {
        red: n(p, "red"),
        green: n(p, "green"),
        blue: n(p, "blue"),
        alpha: n(p, "alpha"),
      };
    case "tilt-shift": {
      const rad = (n(p, "angle") * Math.PI) / 180;
      const nx = -Math.sin(rad);
      const ny = Math.cos(rad);
      return {
        blur: n(p, "blur"),
        count: discSampleCount(n(p, "blur")),
        nx,
        ny,
        shiftPct: (n(p, "center") - 50) / 100,
        bandPct: n(p, "focus") / 100,
        fadePct: n(p, "falloff") / 100,
      };
    }
    case "luma-key":
      return {
        dark: p.mode === "darker" ? 1 : 0,
        threshold: n(p, "threshold") / 100,
        softness: n(p, "softness") / 100,
      };
    case "color-key":
      return {
        ...rgbU(p, "key", "key"),
        tolerance: n(p, "tolerance"),
        softness: n(p, "softness"),
        invert: b(p, "invert") ? 1 : 0,
      };
    case "ultra-key":
      return ultraKeyGpuUniforms(p as unknown as UltraKeyParams);
    case "alpha-adjust":
      return {
        opacity: n(p, "opacity") / 100,
        ignore: b(p, "ignore") ? 1 : 0,
        invert: b(p, "invert") ? 1 : 0,
        matte: b(p, "matte") ? 1 : 0,
      };
    case "leave-color":
      return {
        ...rgbU(p, "key", "key"),
        amount: n(p, "amount") / 100,
        tolerance: n(p, "tolerance"),
        softness: n(p, "softness"),
      };
    case "change-to-color":
      return {
        fromR: n(p, "fromR") / 255,
        fromG: n(p, "fromG") / 255,
        fromB: n(p, "fromB") / 255,
        dR: (n(p, "toR") - n(p, "fromR")) / 255,
        dG: (n(p, "toG") - n(p, "fromG")) / 255,
        dB: (n(p, "toB") - n(p, "fromB")) / 255,
        tolerance: n(p, "tolerance"),
        softness: n(p, "softness"),
      };
    case "solarize":
      return { threshold: n(p, "threshold") / 100 };
    case "levels":
      return {
        inBlack: n(p, "inBlack"),
        inWhite: n(p, "inWhite"),
        invGamma: 1 / n(p, "gamma"),
        outBlack: n(p, "outBlack"),
        outWhite: n(p, "outWhite"),
      };
    case "channel-mixer": {
      const out: Record<string, number> = { mono: b(p, "mono") ? 1 : 0 };
      for (const k of ["rr", "rg", "rb", "gr", "gg", "gb", "br", "bg", "bb"]) {
        out[k] = n(p, k) / 100;
      }
      return out;
    }
    case "tint-map":
      return {
        ...rgbU(p, "black", "black"),
        ...rgbU(p, "white", "white"),
        amount: n(p, "amount") / 100,
      };
    case "spherize": {
      const a = n(p, "amount") / 100;
      return {
        e: a >= 0 ? 1 + a * 2 : 1 / (1 - a * 2),
        radiusPct: n(p, "radius") / 100,
        cx: n(p, "centerX") / 100,
        cy: n(p, "centerY") / 100,
      };
    }
    case "twirl":
      return {
        angle: (n(p, "angle") * Math.PI) / 180,
        radiusPct: n(p, "radius") / 100,
        cx: n(p, "centerX") / 100,
        cy: n(p, "centerY") / 100,
      };
    case "ripple": {
      const rad = (n(p, "angle") * Math.PI) / 180;
      return {
        dx: Math.cos(rad),
        dy: Math.sin(rad),
        amp: n(p, "amplitude"),
        k: (2 * Math.PI) / n(p, "wavelength"),
        phase: ripplePhase(n(p, "phase"), n(p, "speed"), n(p, "time")),
      };
    }
    case "turbulent-displace":
      return {
        amount: n(p, "amount"),
        size: n(p, "size"),
        octaves: Math.round(n(p, "complexity")),
        evo: n(p, "evolution") * 0.05,
        seed: seedInt(n(p, "seed")) % 65536,
      };
    case "offset":
      return {
        sxPct: n(p, "shiftX") / 100,
        syPct: n(p, "shiftY") / 100,
        mode: p.edge === "wrap" ? 0 : p.edge === "clamp" ? 1 : 2,
      };
    case "corner-pin": {
      const h = cornerPinInverse(p as Record<string, number>);
      const out: Record<string, number> = { valid: h ? 1 : 0 };
      for (let i = 0; i < 9; i++) out[`h${i}`] = h ? h[i] : 0;
      return out;
    }
    case "polar-coordinates":
      return {
        toPolar: p.mode === "rect-to-polar" ? 1 : 0,
        amount: n(p, "amount") / 100,
      };
    case "replicate":
      return { count: Math.round(n(p, "count")) };
    case "color-emboss": {
      const rad = (n(p, "angle") * Math.PI) / 180;
      return {
        dx: Math.cos(rad),
        dy: Math.sin(rad),
        k: n(p, "relief") * (n(p, "amount") / 100),
      };
    }
    case "noise":
      return {
        amt: (n(p, "amount") / 100) * 0.5,
        size: Math.max(1, Math.round(n(p, "size"))),
        mono: b(p, "mono") ? 1 : 0,
        frame: frameIndex(n(p, "time")),
        seed: seedInt(n(p, "seed")),
      };
    case "bevel-alpha": {
      const rad = (n(p, "angle") * Math.PI) / 180;
      return {
        thickness: n(p, "thickness"),
        dx: Math.cos(rad),
        dy: Math.sin(rad),
        intensity: n(p, "intensity") / 100,
      };
    }
    case "four-color-gradient":
      return {
        ...rgbU(p, "c1", "c1"),
        ...rgbU(p, "c2", "c2"),
        ...rgbU(p, "c3", "c3"),
        ...rgbU(p, "c4", "c4"),
        opacity: n(p, "opacity") / 100,
        blend: BLEND_FLAGS[p.blend as string] ?? 0,
      };
    case "lens-flare":
      return {
        cx: n(p, "centerX") / 100,
        cy: n(p, "centerY") / 100,
        light: n(p, "brightness") / 100,
        sizePct: n(p, "size") / 100,
      };
    case "strobe-light":
      return {
        ...rgbU(p, "flash", "flash"),
        opacity: n(p, "opacity") / 100,
        on: strobeOn(n(p, "time"), n(p, "period"), n(p, "duration"), n(p, "phase")),
        add: p.blend === "add" ? 1 : 0,
      };
    case "grid":
      return {
        size: Math.floor(n(p, "size")),
        border: Math.floor(n(p, "border")),
        ...rgbU(p, "line", "line"),
        opacity: n(p, "opacity") / 100,
      };
  }
}
