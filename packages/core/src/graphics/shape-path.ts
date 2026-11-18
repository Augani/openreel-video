/**
 * Vector path support for the "path" shape type.
 *
 * SVG path data (M L H V C S Q T A Z, absolute and relative) is parsed into a
 * normalized list of absolute segments (M, L, C, Q, Z; arcs become cubics) that
 * can be replayed onto any Canvas2D-like context, measured, or flattened.
 */

export type PathSegment =
  | { readonly type: "M"; readonly x: number; readonly y: number }
  | { readonly type: "L"; readonly x: number; readonly y: number }
  | {
      readonly type: "C";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: "Q";
      readonly x1: number;
      readonly y1: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: "Z" };

export interface PathBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface PathDrawTarget {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  closePath(): void;
}

const ARG_COUNTS: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

const COMMAND_RE = /[MmLlHhVvCcSsQqTtAaZz]/;
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/**
 * Scan path data into commands and numbers. Arc flags (args 3 and 4 of A/a)
 * are single 0/1 characters and may be written without separators, as in
 * minified icon paths (`a1 1 0 011 1`).
 */
function tokenize(d: string): Array<string | number> | null {
  const tokens: Array<string | number> = [];
  let i = 0;
  let cmd = "";
  let argIndex = 0;
  while (i < d.length) {
    const ch = d[i];
    if (ch === " " || ch === "," || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f") {
      i++;
      continue;
    }
    if (COMMAND_RE.test(ch)) {
      cmd = ch;
      argIndex = 0;
      tokens.push(ch);
      i++;
      continue;
    }
    if ((cmd === "a" || cmd === "A") && (argIndex % 7 === 3 || argIndex % 7 === 4)) {
      if (ch !== "0" && ch !== "1") return null;
      tokens.push(ch === "1" ? 1 : 0);
      argIndex++;
      i++;
      continue;
    }
    const m = NUMBER_RE.exec(d.slice(i));
    if (!m) return null;
    tokens.push(parseFloat(m[0]));
    argIndex++;
    i += m[0].length;
  }
  return tokens;
}

function arcToCubics(
  x0: number,
  y0: number,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x: number,
  y: number,
): PathSegment[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if ((x0 === x && y0 === y) || rx === 0 || ry === 0) {
    return [{ type: "L", x, y }];
  }
  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;

  const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / count;
  const t = (4 / 3) * Math.tan(step / 4);
  const out: PathSegment[] = [];
  let a1 = theta1;
  const point = (a: number): [number, number] => [
    cx + rx * Math.cos(a) * cosPhi - ry * Math.sin(a) * sinPhi,
    cy + rx * Math.cos(a) * sinPhi + ry * Math.sin(a) * cosPhi,
  ];
  const deriv = (a: number): [number, number] => [
    -rx * Math.sin(a) * cosPhi - ry * Math.cos(a) * sinPhi,
    -rx * Math.sin(a) * sinPhi + ry * Math.cos(a) * cosPhi,
  ];
  for (let i = 0; i < count; i++) {
    const a2 = a1 + step;
    const [px1, py1] = point(a1);
    const [d1x, d1y] = deriv(a1);
    const [px2, py2] = i === count - 1 ? [x, y] : point(a2);
    const [d2x, d2y] = deriv(a2);
    out.push({
      type: "C",
      x1: px1 + t * d1x,
      y1: py1 + t * d1y,
      x2: px2 - t * d2x,
      y2: py2 - t * d2y,
      x: px2,
      y: py2,
    });
    a1 = a2;
  }
  return out;
}

/**
 * Parse SVG path data. Returns an empty list when the data is malformed
 * (unknown tokens, wrong argument counts, or not starting with a moveto).
 */
export function parseShapeSvgPath(d: string): PathSegment[] {
  const tokens = tokenize(d);
  if (!tokens || tokens.length === 0) return [];

  const out: PathSegment[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let prevCmd = "";
  let lastCtrlX = 0;
  let lastCtrlY = 0;
  let cmd = "";

  while (i < tokens.length) {
    const tok = tokens[i];
    if (typeof tok === "string") {
      cmd = tok;
      i++;
      if (cmd === "Z" || cmd === "z") {
        if (out.length === 0) return [];
        out.push({ type: "Z" });
        cx = startX;
        cy = startY;
        prevCmd = "z";
        continue;
      }
    } else if (cmd === "" || cmd === "Z" || cmd === "z") {
      return [];
    }
    if (out.length === 0 && cmd !== "M" && cmd !== "m") return [];

    const lower = cmd.toLowerCase();
    const n = ARG_COUNTS[lower];
    if (n === undefined) return [];
    const args: number[] = [];
    for (let k = 0; k < n; k++) {
      const v = tokens[i + k];
      if (typeof v !== "number") return [];
      args.push(v);
    }
    i += n;
    const rel = cmd === lower;
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    let thisCmd = lower;

    switch (lower) {
      case "m": {
        cx = args[0] + ox;
        cy = args[1] + oy;
        startX = cx;
        startY = cy;
        out.push({ type: "M", x: cx, y: cy });
        cmd = rel ? "l" : "L"; // implicit lineto
        break;
      }
      case "l":
        cx = args[0] + ox;
        cy = args[1] + oy;
        out.push({ type: "L", x: cx, y: cy });
        break;
      case "h":
        cx = args[0] + ox;
        out.push({ type: "L", x: cx, y: cy });
        break;
      case "v":
        cy = args[0] + oy;
        out.push({ type: "L", x: cx, y: cy });
        break;
      case "c": {
        const seg = {
          type: "C" as const,
          x1: args[0] + ox,
          y1: args[1] + oy,
          x2: args[2] + ox,
          y2: args[3] + oy,
          x: args[4] + ox,
          y: args[5] + oy,
        };
        out.push(seg);
        lastCtrlX = seg.x2;
        lastCtrlY = seg.y2;
        cx = seg.x;
        cy = seg.y;
        break;
      }
      case "s": {
        const reflect = prevCmd === "c" || prevCmd === "s";
        const seg = {
          type: "C" as const,
          x1: reflect ? 2 * cx - lastCtrlX : cx,
          y1: reflect ? 2 * cy - lastCtrlY : cy,
          x2: args[0] + ox,
          y2: args[1] + oy,
          x: args[2] + ox,
          y: args[3] + oy,
        };
        out.push(seg);
        lastCtrlX = seg.x2;
        lastCtrlY = seg.y2;
        cx = seg.x;
        cy = seg.y;
        break;
      }
      case "q": {
        const seg = {
          type: "Q" as const,
          x1: args[0] + ox,
          y1: args[1] + oy,
          x: args[2] + ox,
          y: args[3] + oy,
        };
        out.push(seg);
        lastCtrlX = seg.x1;
        lastCtrlY = seg.y1;
        cx = seg.x;
        cy = seg.y;
        break;
      }
      case "t": {
        const reflect = prevCmd === "q" || prevCmd === "t";
        const seg = {
          type: "Q" as const,
          x1: reflect ? 2 * cx - lastCtrlX : cx,
          y1: reflect ? 2 * cy - lastCtrlY : cy,
          x: args[0] + ox,
          y: args[1] + oy,
        };
        out.push(seg);
        lastCtrlX = seg.x1;
        lastCtrlY = seg.y1;
        cx = seg.x;
        cy = seg.y;
        break;
      }
      case "a": {
        const ex = args[5] + ox;
        const ey = args[6] + oy;
        out.push(
          ...arcToCubics(cx, cy, args[0], args[1], args[2], args[3] !== 0, args[4] !== 0, ex, ey),
        );
        cx = ex;
        cy = ey;
        break;
      }
    }
    if (thisCmd === "m") thisCmd = "l";
    prevCmd = thisCmd;
  }
  return out;
}

/** Build path segments from a list of points (open unless `closed`). */
export function pathFromPoints(
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  closed: boolean,
): PathSegment[] {
  if (points.length < 2) return [];
  const out: PathSegment[] = [{ type: "M", x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i++) {
    out.push({ type: "L", x: points[i].x, y: points[i].y });
  }
  if (closed) out.push({ type: "Z" });
  return out;
}

/** True when any subpath in the segments is explicitly closed. */
export function pathHasClosedSubpath(segments: readonly PathSegment[]): boolean {
  return segments.some((s) => s.type === "Z");
}

/** Replay segments on a context after mapping every coordinate through `map`. */
export function drawPathSegments(
  target: PathDrawTarget,
  segments: readonly PathSegment[],
  map: (x: number, y: number) => [number, number] = (x, y) => [x, y],
): void {
  for (const s of segments) {
    switch (s.type) {
      case "M": {
        const [x, y] = map(s.x, s.y);
        target.moveTo(x, y);
        break;
      }
      case "L": {
        const [x, y] = map(s.x, s.y);
        target.lineTo(x, y);
        break;
      }
      case "C": {
        const [x1, y1] = map(s.x1, s.y1);
        const [x2, y2] = map(s.x2, s.y2);
        const [x, y] = map(s.x, s.y);
        target.bezierCurveTo(x1, y1, x2, y2, x, y);
        break;
      }
      case "Q": {
        const [x1, y1] = map(s.x1, s.y1);
        const [x, y] = map(s.x, s.y);
        target.quadraticCurveTo(x1, y1, x, y);
        break;
      }
      case "Z":
        target.closePath();
        break;
    }
  }
}

interface FlatSubpath {
  readonly points: Array<[number, number]>;
  readonly closed: boolean;
}

/** Flatten segments to polylines (one per subpath). */
export function flattenShapePath(
  segments: readonly PathSegment[],
  curveSteps = 16,
): FlatSubpath[] {
  const result: FlatSubpath[] = [];
  let current: Array<[number, number]> | null = null;
  let cx = 0;
  let cy = 0;
  for (const s of segments) {
    if (!current && s.type !== "M" && s.type !== "Z" && result.length > 0) {
      // After Z, drawing continues from the previous subpath start.
      current = [[cx, cy]];
    }
    if (s.type === "M") {
      if (current && current.length > 0) result.push({ points: current, closed: false });
      current = [[s.x, s.y]];
      cx = s.x;
      cy = s.y;
    } else if (!current) {
      continue;
    } else if (s.type === "L") {
      current.push([s.x, s.y]);
      cx = s.x;
      cy = s.y;
    } else if (s.type === "C") {
      for (let k = 1; k <= curveSteps; k++) {
        const t = k / curveSteps;
        const u = 1 - t;
        current.push([
          u * u * u * cx + 3 * u * u * t * s.x1 + 3 * u * t * t * s.x2 + t * t * t * s.x,
          u * u * u * cy + 3 * u * u * t * s.y1 + 3 * u * t * t * s.y2 + t * t * t * s.y,
        ]);
      }
      cx = s.x;
      cy = s.y;
    } else if (s.type === "Q") {
      for (let k = 1; k <= curveSteps; k++) {
        const t = k / curveSteps;
        const u = 1 - t;
        current.push([
          u * u * cx + 2 * u * t * s.x1 + t * t * s.x,
          u * u * cy + 2 * u * t * s.y1 + t * t * s.y,
        ]);
      }
      cx = s.x;
      cy = s.y;
    } else {
      result.push({ points: current, closed: true });
      cx = current[0][0];
      cy = current[0][1];
      current = null;
    }
  }
  if (current && current.length > 0) result.push({ points: current, closed: false });
  return result;
}

/** Tight bounds of the flattened path, or null if it has no geometry. */
export function getShapePathBounds(segments: readonly PathSegment[]): PathBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const sub of flattenShapePath(segments)) {
    for (const [x, y] of sub.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/** Non-zero winding point-in-path test over the (implicitly closed) fill area. */
export function isPointInShapePath(
  segments: readonly PathSegment[],
  px: number,
  py: number,
): boolean {
  let winding = 0;
  for (const sub of flattenShapePath(segments)) {
    const pts = sub.points;
    if (pts.length < 3) continue;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      const cross = (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1);
      if (y1 <= py) {
        if (y2 > py && cross > 0) winding++;
      } else if (y2 <= py && cross < 0) {
        winding--;
      }
    }
  }
  return winding !== 0;
}

/**
 * Resolve the segments a path shape should draw: SVG `pathData` wins, then a
 * point list (normalized 0..1 coordinates, like polygons).
 */
export function resolveShapePath(shape: {
  readonly pathData?: string;
  readonly points?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly closed?: boolean;
}): PathSegment[] {
  if (shape.pathData && shape.pathData.trim() !== "") {
    const parsed = parseShapeSvgPath(shape.pathData);
    if (parsed.length > 0 && shape.closed === true && !pathHasClosedSubpath(parsed)) {
      return [...parsed, { type: "Z" }];
    }
    return parsed;
  }
  if (shape.points && shape.points.length >= 2) {
    return pathFromPoints(shape.points, shape.closed ?? false);
  }
  return [];
}

/**
 * Draw a path shape centered on the origin inside a `size` box. Path data is
 * fit uniformly (preserving aspect) and centered; point lists use normalized
 * 0..1 coordinates. Shared by the export engine and the live preview.
 */
export function drawShapePathCentered(
  target: PathDrawTarget,
  shape: {
    readonly pathData?: string;
    readonly points?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
    readonly closed?: boolean;
  },
  size: number,
): void {
  const segments = resolveShapePath(shape);
  if (segments.length === 0) return;
  const half = size / 2;
  if (!shape.pathData || shape.pathData.trim() === "") {
    drawPathSegments(target, segments, (x, y) => [x * size - half, y * size - half]);
    return;
  }
  const bounds = getShapePathBounds(segments);
  if (!bounds) return;
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const scale = extent > 0 ? size / extent : 1;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  drawPathSegments(target, segments, (x, y) => [(x - cx) * scale, (y - cy) * scale]);
}
