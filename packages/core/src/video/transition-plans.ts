/**
 * Draw plans for the geometric transitions (cube spin, flip over, split, cross zoom, page peel).
 *
 * Each transition is computed as a pure list of layers (image rectangles, clipped and transformed images, fills,
 * strokes) from its parameters and progress. The Canvas2D transition engine executes the plan with drawImage, and the
 * tests (and the browser parity spec) execute the same plan on a tiny software rasteriser, so the geometry is checked
 * without a canvas and the preview and the export, which both go through the engine, draw the same plan.
 */

export type Pt = readonly [number, number];
/** x, y, width, height in pixels. */
export type Rect = readonly [number, number, number, number];
/** Canvas affine matrix [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = readonly [number, number, number, number, number, number];
export type PlanSource = "A" | "B";

export type PlanLayer =
  | { readonly kind: "rect"; readonly src: PlanSource; readonly s: Rect; readonly d: Rect; readonly alpha?: number }
  | {
      readonly kind: "poly";
      readonly src: PlanSource;
      /** Clip in destination pixels. */
      readonly poly: readonly Pt[];
      /** Source to destination, default identity. */
      readonly matrix?: Matrix;
      readonly alpha?: number;
      /** A flat colour laid over the layer (the back of a peeled page). */
      readonly tint?: { readonly color: string; readonly alpha: number };
    }
  | { readonly kind: "fill"; readonly color: string; readonly poly: readonly Pt[]; readonly alpha?: number }
  | { readonly kind: "stroke"; readonly poly: readonly Pt[]; readonly width: number; readonly color: string }
  | {
      readonly kind: "gradient";
      readonly poly: readonly Pt[];
      readonly from: Pt;
      readonly to: Pt;
      readonly color: string;
      readonly alpha0: number;
      readonly alpha1: number;
    };

export type DrawPlan = readonly PlanLayer[];

const num = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const frameRect = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];
const full = (w: number, h: number): Rect => [0, 0, w, h];

export const BLACK_FILL = "#000000";

// ── Cube spin and flip over: exact perspective columns ──────────────────────────────────────────────────────────
//
// A face turning about an axis perpendicular to the motion axis projects every line parallel to that axis onto a
// line parallel to it, with a scale that depends only on depth. So each screen column (row, for up / down) shows one
// source column scaled by 1 / depth: the perspective is exact, not an approximation by strips.

/** Camera distance from the cube / card centre, in units of the motion-axis length. */
export const CUBE_CAMERA_DISTANCE = 3;
export const FLIP_CAMERA_DISTANCE = 2.5;

/** A face as linear functions of the source coordinate u (0..1): xr = a0 + a1 u, depth = b0 + b1 u (both in motion-axis lengths). */
export interface PerspectiveFace {
  readonly src: PlanSource;
  readonly a0: number;
  readonly a1: number;
  readonly b0: number;
  readonly b1: number;
  /** The face is seen from behind: its source runs the other way (flip over's back). */
  readonly mirrored: boolean;
}

export interface FaceColumn {
  /** Index of the screen column (row) along the motion axis. */
  readonly index: number;
  /** Source span as fractions of the motion axis, from < to. */
  readonly from: number;
  readonly to: number;
  /** Cross-axis scale (1 = the frame's own height). */
  readonly scale: number;
}

export interface SolvedFace {
  readonly face: PerspectiveFace;
  readonly columns: FaceColumn[];
  /** Screen span along the motion axis as fractions of the frame (0 = start edge, 1 = end edge), and the scale at its two ends. */
  readonly start: number;
  readonly end: number;
  readonly scaleStart: number;
  readonly scaleEnd: number;
  /** Whether the source runs with the screen axis (true) or against it (a mirrored back face). */
  readonly orientation: number;
}

/** Projected screen position (fractions of the motion axis, 0 = centre) and scale of a face point. */
export function projectFacePoint(face: PerspectiveFace, focal: number, u: number): { x: number; scale: number } {
  const depth = face.b0 + face.b1 * u;
  return { x: (focal * (face.a0 + face.a1 * u)) / depth, scale: focal / depth };
}

/** Determinant of the face's projection: its sign says whether the face is seen from the front (> 0) or from behind (< 0). */
export const faceOrientation = (face: PerspectiveFace): number => face.a1 * face.b0 - face.a0 * face.b1;

/**
 * The columns of a face on a screen `pixels` wide along the motion axis. A face seen from behind that is not
 * `mirrored` (an outgoing or side face that has turned away) is culled.
 */
export function solveFaceColumns(face: PerspectiveFace, focal: number, pixels: number): SolvedFace | null {
  const orientation = faceOrientation(face);
  if (orientation <= 1e-9 && !face.mirrored) return null;
  if (orientation >= -1e-9 && face.mirrored) return null;
  const p0 = projectFacePoint(face, focal, 0);
  const p1 = projectFacePoint(face, focal, 1);
  const lo = Math.min(p0.x, p1.x);
  const hi = Math.max(p0.x, p1.x);
  const first = Math.max(0, Math.floor((lo + 0.5) * pixels));
  const last = Math.min(pixels - 1, Math.ceil((hi + 0.5) * pixels) - 1);
  const columns: FaceColumn[] = [];
  const uAt = (x: number): number => {
    const denominator = x * face.b1 - focal * face.a1;
    return Math.abs(denominator) < 1e-12 ? 0 : (focal * face.a0 - x * face.b0) / denominator;
  };
  for (let index = first; index <= last; index += 1) {
    const x0 = (index) / pixels - 0.5;
    const x1 = (index + 1) / pixels - 0.5;
    const xc = (index + 0.5) / pixels - 0.5;
    if (xc < lo || xc > hi) continue;
    let u0 = clamp(uAt(clamp(x0, lo, hi)), 0, 1);
    let u1 = clamp(uAt(clamp(x1, lo, hi)), 0, 1);
    if (u0 > u1) [u0, u1] = [u1, u0];
    if (u1 - u0 < 1e-9) continue;
    const uc = clamp(uAt(xc), 0, 1);
    columns.push({
      index,
      from: face.mirrored ? 1 - u1 : u0,
      to: face.mirrored ? 1 - u0 : u1,
      scale: focal / (face.b0 + face.b1 * uc),
    });
  }
  return { face, columns, start: lo + 0.5, end: hi + 0.5, scaleStart: p0.scale, scaleEnd: p1.scale, orientation };
}

/** The faces of a cube turned by `progress` * 90 degrees; sign +1 turns the outgoing shot to the left (or up). */
export function cubeFaces(progress: number, sign: 1 | -1): { faces: PerspectiveFace[]; focal: number } {
  const theta = (clamp(progress, 0, 1) * Math.PI) / 2;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const D = CUBE_CAMERA_DISTANCE;
  // The cube moves back by what its near corner swings forward, so that corner stays at the frame's own depth and the
  // turning cube never grows past the frame.
  const back = 0.5 * (cos + sin - 1);
  const focal = D - 0.5;
  return {
    focal,
    faces: [
      { src: "A", a0: -0.5 * (cos + sign * sin), a1: cos, b0: D + back + 0.5 * sign * sin - 0.5 * cos, b1: -sign * sin, mirrored: false },
      { src: "B", a0: 0.5 * sign * cos - 0.5 * sin, a1: sin, b0: D + back - 0.5 * sin - 0.5 * sign * cos, b1: sign * cos, mirrored: false },
    ],
  };
}

/** The two sides of a card turned by `progress` * 180 degrees; the outgoing shot on the front, the incoming on the back. */
export function flipFaces(progress: number, sign: 1 | -1): { faces: PerspectiveFace[]; focal: number } {
  const phi = clamp(progress, 0, 1) * Math.PI;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const D = FLIP_CAMERA_DISTANCE;
  const back = 0.5 * sin;
  const card = { a0: -0.5 * cos, a1: cos, b0: D + back + 0.5 * sign * sin, b1: -sign * sin };
  return { focal: D, faces: [{ src: "A", ...card, mirrored: false }, { src: "B", ...card, mirrored: true }] };
}

export interface PerspectiveOptions {
  readonly progress: number;
  readonly direction: string;
  readonly width: number;
  readonly height: number;
  readonly borderWidth: number;
  readonly borderColor: string;
}

function perspectivePlan(kind: "cube" | "flip", o: PerspectiveOptions): DrawPlan {
  const { width: w, height: h } = o;
  const layers: PlanLayer[] = [{ kind: "fill", color: BLACK_FILL, poly: frameRect(w, h) }];
  const p = clamp(o.progress, 0, 1);
  if (p <= 0) return [{ kind: "rect", src: "A", s: full(w, h), d: full(w, h) }];
  if (p >= 1) return [{ kind: "rect", src: "B", s: full(w, h), d: full(w, h) }];
  const vertical = o.direction === "up" || o.direction === "down";
  const sign: 1 | -1 = o.direction === "right" || o.direction === "down" ? -1 : 1;
  const length = vertical ? h : w;
  const cross = vertical ? w : h;
  const { faces, focal } = kind === "cube" ? cubeFaces(p, sign) : flipFaces(p, sign);
  const outlines: Pt[][] = [];
  for (const face of faces) {
    // Flip over: the front shows until the card is edge-on, the back after.
    if (kind === "flip" && face.mirrored !== p > 0.5) continue;
    const solved = solveFaceColumns(face, focal, length);
    if (!solved) continue;
    for (const column of solved.columns) {
      const size = cross * column.scale;
      const offset = (cross - size) / 2;
      const s0 = column.from * length;
      const sw = (column.to - column.from) * length;
      const d0 = column.index;
      layers.push(
        vertical
          ? { kind: "rect", src: face.src, s: [0, s0, w, sw], d: [offset, d0, size, 1] }
          : { kind: "rect", src: face.src, s: [s0, 0, sw, h], d: [d0, offset, 1, size] },
      );
    }
    const c = cross / 2;
    const left = projectFacePoint(face, focal, 0);
    const right = projectFacePoint(face, focal, 1);
    const xl = (left.x + 0.5) * length;
    const xr = (right.x + 0.5) * length;
    const hl = (cross * left.scale) / 2;
    const hr = (cross * right.scale) / 2;
    outlines.push(
      vertical
        ? [[c - hl, xl], [c + hl, xl], [c + hr, xr], [c - hr, xr]]
        : [[xl, c - hl], [xr, c - hr], [xr, c + hr], [xl, c + hl]],
    );
  }
  if (o.borderWidth > 0) {
    for (const poly of outlines) layers.push({ kind: "stroke", poly, width: o.borderWidth, color: o.borderColor });
  }
  return layers;
}

export const cubeSpinPlan = (options: PerspectiveOptions): DrawPlan => perspectivePlan("cube", options);
export const flipOverPlan = (options: PerspectiveOptions): DrawPlan => perspectivePlan("flip", options);

// ── Split ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function splitPlan(o: {
  progress: number;
  orientation: string;
  reverse: boolean;
  width: number;
  height: number;
  borderWidth: number;
  borderColor: string;
}): DrawPlan {
  const { width: w, height: h } = o;
  const p = clamp(o.progress, 0, 1);
  const vertical = o.orientation === "vertical"; // halves part along a horizontal seam
  if (p <= 0) return [{ kind: "rect", src: "A", s: full(w, h), d: full(w, h) }];
  if (p >= 1) return [{ kind: "rect", src: "B", s: full(w, h), d: full(w, h) }];
  const base: PlanSource = o.reverse ? "A" : "B";
  const moving: PlanSource = o.reverse ? "B" : "A";
  // Moving halves sit at offset o (0 = closed, 1 = fully apart); reverse brings the incoming halves in.
  const apart = o.reverse ? 1 - p : p;
  const layers: PlanLayer[] = [{ kind: "rect", src: base, s: full(w, h), d: full(w, h) }];
  const span = vertical ? h : w;
  const half = span / 2;
  const shift = apart * half;
  const firstSource: Rect = vertical ? [0, 0, w, half] : [0, 0, half, h];
  const secondSource: Rect = vertical ? [0, half, w, half] : [half, 0, half, h];
  const firstDest: Rect = vertical ? [0, -shift, w, half] : [-shift, 0, half, h];
  const secondDest: Rect = vertical ? [0, half + shift, w, half] : [half + shift, 0, half, h];
  layers.push({ kind: "rect", src: moving, s: firstSource, d: firstDest });
  layers.push({ kind: "rect", src: moving, s: secondSource, d: secondDest });
  if (o.borderWidth > 0 && apart > 0 && apart < 1) {
    const bw = o.borderWidth;
    const edgeA = half - shift; // inner edge of the first half
    const edgeB = half + shift;
    const strip = (from: number, size: number): readonly Pt[] =>
      vertical ? [[0, from], [w, from], [w, from + size], [0, from + size]] : [[from, 0], [from + size, 0], [from + size, h], [from, h]];
    layers.push({ kind: "fill", color: o.borderColor, poly: strip(edgeA - bw, bw) });
    layers.push({ kind: "fill", color: o.borderColor, poly: strip(edgeB, bw) });
  }
  return layers;
}

// ── Cross zoom ────────────────────────────────────────────────────────────────────────────────────────────────────

export const CROSS_ZOOM_SAMPLES = 12;

/** Outgoing and incoming zoom (scale factors) and the incoming shot's weight at `progress`. They meet at the same zoom half way. */
export function crossZoomState(progress: number, intensity: number): { zoomA: number; zoomB: number; weightB: number; blur: number } {
  const p = clamp(progress, 0, 1);
  const amount = 1.5 * clamp(intensity, 0, 3);
  const a = Math.min(1, p / 0.65);
  const b = 1 - Math.min(1, Math.max(0, (p - 0.35) / 0.65));
  const t = clamp((p - 0.35) / 0.3, 0, 1);
  return {
    zoomA: 1 + amount * a * a,
    zoomB: 1 + amount * b * b,
    weightB: t * t * (3 - 2 * t),
    blur: 0.25 * clamp(intensity, 0, 3) * Math.sin(Math.PI * p),
  };
}

export function crossZoomPlan(o: { progress: number; center: { x: number; y: number }; intensity: number; width: number; height: number }): DrawPlan {
  const { width: w, height: h } = o;
  const p = clamp(o.progress, 0, 1);
  if (p <= 0) return [{ kind: "rect", src: "A", s: full(w, h), d: full(w, h) }];
  if (p >= 1) return [{ kind: "rect", src: "B", s: full(w, h), d: full(w, h) }];
  const state = crossZoomState(p, o.intensity);
  const cx = clamp(num(o.center.x, 0.5), 0, 1) * w;
  const cy = clamp(num(o.center.y, 0.5), 0, 1) * h;
  const layers: PlanLayer[] = [];
  const N = CROSS_ZOOM_SAMPLES;
  const scaled = (zoom: number): Rect => [cx - zoom * cx, cy - zoom * cy, zoom * w, zoom * h];
  const sampleZoom = (zoom: number, j: number): number => Math.max(1, zoom * (1 + state.blur * (j / (N - 1) - 0.5)));
  // Outgoing: the average of N zoom samples (each drawn with alpha 1 / (j + 1) is the running mean).
  for (let j = 0; j < N; j += 1) {
    layers.push({ kind: "rect", src: "A", s: full(w, h), d: scaled(sampleZoom(state.zoomA, j)), alpha: 1 / (j + 1) });
  }
  const wb = state.weightB;
  if (wb > 0) {
    for (let j = 0; j < N; j += 1) {
      const alpha = wb / N / (1 - wb + ((j + 1) * wb) / N);
      layers.push({ kind: "rect", src: "B", s: full(w, h), d: scaled(sampleZoom(state.zoomB, j)), alpha });
    }
  }
  return layers;
}

// ── Page peel ─────────────────────────────────────────────────────────────────────────────────────────────────────

const CORNERS: Record<string, readonly [number, number]> = {
  topLeft: [0, 0],
  topRight: [1, 0],
  bottomLeft: [0, 1],
  bottomRight: [1, 1],
};

/** Clips a convex polygon to the half plane nx * x + ny * y >= c. */
export function clipPolygon(poly: readonly Pt[], nx: number, ny: number, c: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const da = nx * a[0] + ny * a[1] - c;
    const db = nx * b[0] + ny * b[1] - c;
    if (da >= 0) out.push(a);
    if ((da >= 0 && db < 0) || (da < 0 && db >= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export interface PeelGeometry {
  /** Unit vector from the peeled corner towards the opposite one. */
  readonly d: Pt;
  readonly corner: Pt;
  /** Distance of the fold from the corner along d, and the distance at which the whole page has peeled. */
  readonly fold: number;
  readonly total: number;
}

export function peelGeometry(corner: string, progress: number, width: number, height: number): PeelGeometry {
  const origin = CORNERS[corner] ?? CORNERS.bottomRight!;
  const c: Pt = [origin[0] * width, origin[1] * height];
  const o: Pt = [(1 - origin[0]) * width, (1 - origin[1]) * height];
  const total = Math.hypot(o[0] - c[0], o[1] - c[1]);
  return { d: [(o[0] - c[0]) / total, (o[1] - c[1]) / total], corner: c, fold: clamp(progress, 0, 1) * total, total };
}

export function pagePeelPlan(o: { progress: number; corner: string; shadow: number; width: number; height: number }): DrawPlan {
  const { width: w, height: h } = o;
  const p = clamp(o.progress, 0, 1);
  if (p <= 0) return [{ kind: "rect", src: "A", s: full(w, h), d: full(w, h) }];
  if (p >= 1) return [{ kind: "rect", src: "B", s: full(w, h), d: full(w, h) }];
  const g = peelGeometry(o.corner, p, w, h);
  const [dx, dy] = g.d;
  const along = (g.corner[0] * dx + g.corner[1] * dy) + g.fold; // fold line: d . x = along
  const frame = frameRect(w, h);
  const remaining = clipPolygon(frame, dx, dy, along);
  const peeled = clipPolygon(frame, -dx, -dy, -along);
  const layers: PlanLayer[] = [{ kind: "rect", src: "B", s: full(w, h), d: full(w, h) }];
  const shadow = clamp(num(o.shadow, 0.55), 0, 1);
  if (shadow > 0) {
    // The page casts a soft shadow on the new shot beside the fold, which fades with the peel.
    const reach = g.total * 0.12;
    layers.push({
      kind: "gradient",
      poly: peeled,
      from: [g.corner[0] + dx * g.fold, g.corner[1] + dy * g.fold],
      to: [g.corner[0] + dx * (g.fold - reach), g.corner[1] + dy * (g.fold - reach)],
      color: "#000000",
      alpha0: 0.45 * shadow * Math.sin(Math.PI * p),
      alpha1: 0,
    });
  }
  if (remaining.length >= 3) layers.push({ kind: "poly", src: "A", poly: remaining });
  // The lifted flap: the peeled part of the page reflected across the fold, showing the page's back.
  const k = 2 * along;
  const matrix: Matrix = [1 - 2 * dx * dx, -2 * dx * dy, -2 * dx * dy, 1 - 2 * dy * dy, k * dx, k * dy];
  const reflected = peeled.map(([x, y]): Pt => {
    const dist = dx * x + dy * y - along;
    return [x - 2 * dist * dx, y - 2 * dist * dy];
  });
  const flap = [0, 1, 2, 3].reduce<Pt[]>(
    (poly, side) => {
      if (poly.length < 3) return poly;
      return side === 0 ? clipPolygon(poly, 1, 0, 0) : side === 1 ? clipPolygon(poly, -1, 0, -w) : side === 2 ? clipPolygon(poly, 0, 1, 0) : clipPolygon(poly, 0, -1, -h);
    },
    reflected,
  );
  if (flap.length >= 3) {
    layers.push({ kind: "poly", src: "A", poly: flap, matrix, tint: { color: "#ffffff", alpha: 0.28 } });
  }
  return layers;
}

// ── Software reference ─────────────────────────────────────────────────────────────────────────────────────────────

function parseHex(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [255, 255, 255];
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function inPolygon(poly: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : clamp(((px - a[0]) * vx + (py - a[1]) * vy) / len2, 0, 1);
  return Math.hypot(px - (a[0] + vx * t), py - (a[1] + vy * t));
}

/**
 * Executes a plan on solid-colour shots (A and B are flat colours), returning RGB per pixel. Pixel centres are tested
 * against each layer (no antialiasing), so it is exact for flat shots and a close reference for the canvas.
 * Gradients (shadows) are not drawn.
 */
export function rasterizePlan(
  plan: DrawPlan,
  width: number,
  height: number,
  colors: { A: readonly [number, number, number]; B: readonly [number, number, number] },
): Float64Array {
  const out = new Float64Array(width * height * 3);
  const blend = (index: number, color: readonly number[], alpha: number): void => {
    for (let c = 0; c < 3; c += 1) out[index * 3 + c] = out[index * 3 + c]! * (1 - alpha) + color[c]! * alpha;
  };
  for (const layer of plan) {
    if (layer.kind === "gradient") continue;
    const fillColor = layer.kind === "fill" ? parseHex(layer.color) : null;
    const stroke = layer.kind === "stroke" ? parseHex(layer.color) : null;
    const strokeEdges: [Pt, Pt][] =
      layer.kind === "stroke" ? layer.poly.map((point, i) => [point, layer.poly[(i + 1) % layer.poly.length]!] as [Pt, Pt]) : [];
    // Only the pixels inside the layer's bounding box can change.
    const points: readonly Pt[] =
      layer.kind === "rect" ? [[layer.d[0], layer.d[1]], [layer.d[0] + layer.d[2], layer.d[1] + layer.d[3]]] : layer.poly;
    const pad = layer.kind === "stroke" ? layer.width / 2 + 1 : 1;
    const x0 = clamp(Math.floor(Math.min(...points.map((q) => q[0])) - pad), 0, width);
    const x1 = clamp(Math.ceil(Math.max(...points.map((q) => q[0])) + pad), 0, width);
    const y0 = clamp(Math.floor(Math.min(...points.map((q) => q[1])) - pad), 0, height);
    const y1 = clamp(Math.ceil(Math.max(...points.map((q) => q[1])) + pad), 0, height);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const cx = x + 0.5;
        const cy = y + 0.5;
        const index = y * width + x;
        switch (layer.kind) {
          case "rect": {
            const [dx, dy, dw, dh] = layer.d;
            if (cx >= dx && cx < dx + dw && cy >= dy && cy < dy + dh) blend(index, colors[layer.src], layer.alpha ?? 1);
            break;
          }
          case "poly":
            if (inPolygon(layer.poly, cx, cy)) {
              blend(index, colors[layer.src], layer.alpha ?? 1);
              if (layer.tint) blend(index, parseHex(layer.tint.color), layer.tint.alpha);
            }
            break;
          case "fill":
            if (inPolygon(layer.poly, cx, cy)) blend(index, fillColor!, layer.alpha ?? 1);
            break;
          case "stroke":
            if (strokeEdges.some(([e0, e1]) => distanceToSegment(cx, cy, e0, e1) <= layer.width / 2)) blend(index, stroke!, 1);
            break;
        }
      }
    }
  }
  return out;
}
