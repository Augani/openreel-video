// Motion path types and SVG path helpers. Kept free of gsap so the preview overlay can use them without loading the animation library.

export interface GSAPMotionPathPoint {
  x: number;
  y: number;
  time: number;
  controlPoints?: {
    cp1: { x: number; y: number };
    cp2: { x: number; y: number };
  };
}

export interface MotionPathConfig {
  clipId: string;
  enabled: boolean;
  pathType: "linear" | "bezier" | "catmull-rom";
  points: GSAPMotionPathPoint[];
  showPath: boolean;
  autoOrient: boolean;
  alignOrigin: [number, number];
}


export function generateBezierPath(points: GSAPMotionPathPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const sortedPoints = [...points].sort((a, b) => a.time - b.time);
  let path = `M ${sortedPoints[0].x} ${sortedPoints[0].y}`;

  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const p0 = sortedPoints[i];
    const p1 = sortedPoints[i + 1];

    if (p0.controlPoints && p1.controlPoints) {
      path += ` C ${p0.controlPoints.cp2.x} ${p0.controlPoints.cp2.y}, ${p1.controlPoints.cp1.x} ${p1.controlPoints.cp1.y}, ${p1.x} ${p1.y}`;
    } else {
      const cp1x = p0.x + (p1.x - p0.x) / 3;
      const cp1y = p0.y + (p1.y - p0.y) / 3;
      const cp2x = p0.x + (2 * (p1.x - p0.x)) / 3;
      const cp2y = p0.y + (2 * (p1.y - p0.y)) / 3;
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
    }
  }

  return path;
}

export function generateDefaultControlPoints(
  points: GSAPMotionPathPoint[]
): GSAPMotionPathPoint[] {
  if (points.length < 2) return points;

  const sortedPoints = [...points].sort((a, b) => a.time - b.time);

  return sortedPoints.map((point, i) => {
    if (point.controlPoints) return point;

    const prev = sortedPoints[i - 1];
    const next = sortedPoints[i + 1];

    let tangentX = 0;
    let tangentY = 0;

    if (prev && next) {
      tangentX = (next.x - prev.x) / 4;
      tangentY = (next.y - prev.y) / 4;
    } else if (next) {
      tangentX = (next.x - point.x) / 3;
      tangentY = (next.y - point.y) / 3;
    } else if (prev) {
      tangentX = (point.x - prev.x) / 3;
      tangentY = (point.y - prev.y) / 3;
    }

    return {
      ...point,
      controlPoints: {
        cp1: { x: point.x - tangentX, y: point.y - tangentY },
        cp2: { x: point.x + tangentX, y: point.y + tangentY },
      },
    };
  });
}
