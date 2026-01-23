import { BlendMode, blendPixel } from './blend-modes';

export interface ContourPoint {
  input: number;
  output: number;
}

export interface ContourCurve {
  points: ContourPoint[];
  cornerAtPoint: boolean[];
}

export const DEFAULT_CONTOUR: ContourCurve = {
  points: [
    { input: 0, output: 0 },
    { input: 255, output: 255 },
  ],
  cornerAtPoint: [false, false],
};

export interface GradientStop {
  position: number;
  color: string;
  opacity: number;
}

export interface GradientDef {
  stops: GradientStop[];
  type: 'linear' | 'radial';
  angle?: number;
  reverse?: boolean;
}

export interface PatternDef {
  id: string;
  name: string;
  data: ImageData;
  scale: number;
}

export interface BevelEmbossSettings {
  enabled: boolean;
  style: 'outer-bevel' | 'inner-bevel' | 'emboss' | 'pillow-emboss' | 'stroke-emboss';
  technique: 'smooth' | 'chisel-hard' | 'chisel-soft';
  depth: number;
  direction: 'up' | 'down';
  size: number;
  soften: number;
  angle: number;
  altitude: number;
  highlightMode: BlendMode;
  highlightColor: string;
  highlightOpacity: number;
  shadowMode: BlendMode;
  shadowColor: string;
  shadowOpacity: number;
  glossContour: ContourCurve;
  contour: ContourCurve;
  antiAlias: boolean;
}

export const DEFAULT_BEVEL_EMBOSS: BevelEmbossSettings = {
  enabled: false,
  style: 'inner-bevel',
  technique: 'smooth',
  depth: 100,
  direction: 'up',
  size: 5,
  soften: 0,
  angle: 120,
  altitude: 30,
  highlightMode: 'screen',
  highlightColor: '#ffffff',
  highlightOpacity: 75,
  shadowMode: 'multiply',
  shadowColor: '#000000',
  shadowOpacity: 75,
  glossContour: DEFAULT_CONTOUR,
  contour: DEFAULT_CONTOUR,
  antiAlias: true,
};

export interface InnerGlowSettings {
  enabled: boolean;
  blendMode: BlendMode;
  opacity: number;
  noise: number;
  color: string;
  gradient?: GradientDef;
  technique: 'softer' | 'precise';
  source: 'center' | 'edge';
  choke: number;
  size: number;
  contour: ContourCurve;
  antiAlias: boolean;
  range: number;
  jitter: number;
}

export const DEFAULT_INNER_GLOW: InnerGlowSettings = {
  enabled: false,
  blendMode: 'screen',
  opacity: 75,
  noise: 0,
  color: '#ffffbe',
  technique: 'softer',
  source: 'edge',
  choke: 0,
  size: 5,
  contour: DEFAULT_CONTOUR,
  antiAlias: false,
  range: 50,
  jitter: 0,
};

export interface ColorOverlaySettings {
  enabled: boolean;
  blendMode: BlendMode;
  color: string;
  opacity: number;
}

export const DEFAULT_COLOR_OVERLAY: ColorOverlaySettings = {
  enabled: false,
  blendMode: 'normal',
  color: '#ff0000',
  opacity: 100,
};

export interface GradientOverlaySettings {
  enabled: boolean;
  blendMode: BlendMode;
  opacity: number;
  gradient: GradientDef;
  style: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
  alignWithLayer: boolean;
  angle: number;
  scale: number;
  reverse: boolean;
  dither: boolean;
}

export const DEFAULT_GRADIENT_OVERLAY: GradientOverlaySettings = {
  enabled: false,
  blendMode: 'normal',
  opacity: 100,
  gradient: {
    stops: [
      { position: 0, color: '#000000', opacity: 100 },
      { position: 100, color: '#ffffff', opacity: 100 },
    ],
    type: 'linear',
  },
  style: 'linear',
  alignWithLayer: true,
  angle: 90,
  scale: 100,
  reverse: false,
  dither: false,
};

export interface PatternOverlaySettings {
  enabled: boolean;
  blendMode: BlendMode;
  opacity: number;
  pattern: PatternDef | null;
  scale: number;
  linkWithLayer: boolean;
}

export const DEFAULT_PATTERN_OVERLAY: PatternOverlaySettings = {
  enabled: false,
  blendMode: 'normal',
  opacity: 100,
  pattern: null,
  scale: 100,
  linkWithLayer: true,
};

export interface SatinSettings {
  enabled: boolean;
  blendMode: BlendMode;
  color: string;
  opacity: number;
  angle: number;
  distance: number;
  size: number;
  contour: ContourCurve;
  antiAlias: boolean;
  invert: boolean;
}

export const DEFAULT_SATIN: SatinSettings = {
  enabled: false,
  blendMode: 'multiply',
  color: '#000000',
  opacity: 50,
  angle: 19,
  distance: 11,
  size: 14,
  contour: DEFAULT_CONTOUR,
  antiAlias: true,
  invert: false,
};

export interface LayerStyles {
  bevelEmboss: BevelEmbossSettings;
  innerGlow: InnerGlowSettings;
  colorOverlay: ColorOverlaySettings;
  gradientOverlay: GradientOverlaySettings;
  patternOverlay: PatternOverlaySettings;
  satin: SatinSettings;
}

export const DEFAULT_LAYER_STYLES: LayerStyles = {
  bevelEmboss: DEFAULT_BEVEL_EMBOSS,
  innerGlow: DEFAULT_INNER_GLOW,
  colorOverlay: DEFAULT_COLOR_OVERLAY,
  gradientOverlay: DEFAULT_GRADIENT_OVERLAY,
  patternOverlay: DEFAULT_PATTERN_OVERLAY,
  satin: DEFAULT_SATIN,
};

function parseColor(color: string): { r: number; g: number; b: number } {
  const match = color.match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (match) {
    return {
      r: parseInt(match[1], 16),
      g: parseInt(match[2], 16),
      b: parseInt(match[3], 16),
    };
  }
  return { r: 0, g: 0, b: 0 };
}

function evaluateContour(contour: ContourCurve, input: number): number {
  const { points } = contour;
  if (points.length === 0) return input;

  input = Math.max(0, Math.min(255, input));

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    if (input >= p1.input && input <= p2.input) {
      const t = (input - p1.input) / (p2.input - p1.input || 1);
      return p1.output + (p2.output - p1.output) * t;
    }
  }

  return points[points.length - 1].output;
}

function getEdgeDistance(
  imageData: ImageData,
  x: number,
  y: number,
  maxDistance: number,
  fromEdge: boolean = true
): number {
  const { width, height, data } = imageData;
  const centerAlpha = data[(y * width + x) * 4 + 3];

  if (fromEdge) {
    if (centerAlpha === 0) return maxDistance;
  } else {
    if (centerAlpha === 255) return maxDistance;
  }

  let minDist = maxDistance;

  for (let dy = -maxDistance; dy <= maxDistance; dy++) {
    for (let dx = -maxDistance; dx <= maxDistance; dx++) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const neighborAlpha = data[(ny * width + nx) * 4 + 3];

      if (fromEdge ? neighborAlpha === 0 : neighborAlpha > 0) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) {
          minDist = dist;
        }
      }
    }
  }

  return minDist;
}

export function applyBevelEmboss(
  ctx: OffscreenCanvasRenderingContext2D,
  settings: BevelEmbossSettings,
  layerBounds: { x: number; y: number; width: number; height: number }
): void {
  if (!settings.enabled) return;

  const { width, height } = layerBounds;
  const imageData = ctx.getImageData(layerBounds.x, layerBounds.y, width, height);
  const data = imageData.data;

  const angleRad = (settings.angle * Math.PI) / 180;
  const altitudeRad = (settings.altitude * Math.PI) / 180;
  const lightX = Math.cos(angleRad) * Math.cos(altitudeRad);
  const lightY = Math.sin(angleRad) * Math.cos(altitudeRad);

  const highlightColor = parseColor(settings.highlightColor);
  const shadowColor = parseColor(settings.shadowColor);
  const size = settings.size;
  const depth = settings.depth / 100;

  const resultData = new Uint8ClampedArray(data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];

      if (alpha === 0) continue;

      const edgeDist = getEdgeDistance(imageData, x, y, size, true);

      if (edgeDist >= size) continue;

      const bevelFactor = 1 - edgeDist / size;
      const smoothedFactor = settings.technique === 'smooth'
        ? Math.sin(bevelFactor * Math.PI / 2)
        : settings.technique === 'chisel-hard'
          ? bevelFactor > 0.5 ? 1 : 0
          : bevelFactor;

      const nx = x > 0 ? data[((y) * width + (x - 1)) * 4 + 3] - data[((y) * width + (x + 1)) * 4 + 3] : 0;
      const ny = y > 0 ? data[((y - 1) * width + x) * 4 + 3] - data[((y + 1) * width + x) * 4 + 3] : 0;

      const normalLen = Math.sqrt(nx * nx + ny * ny + 1);
      const normalX = nx / normalLen;
      const normalY = ny / normalLen;

      let lighting = normalX * lightX + normalY * lightY;
      lighting = settings.direction === 'down' ? -lighting : lighting;
      lighting *= smoothedFactor * depth;

      const contourValue = evaluateContour(settings.contour, Math.abs(lighting) * 255);
      lighting = (lighting >= 0 ? 1 : -1) * (contourValue / 255);

      if (lighting > 0) {
        const opacity = lighting * (settings.highlightOpacity / 100);
        const [r, g, b, a] = blendPixel(
          resultData[idx], resultData[idx + 1], resultData[idx + 2], resultData[idx + 3],
          highlightColor.r, highlightColor.g, highlightColor.b, Math.round(255 * opacity),
          settings.highlightMode
        );
        resultData[idx] = r;
        resultData[idx + 1] = g;
        resultData[idx + 2] = b;
        resultData[idx + 3] = a;
      } else {
        const opacity = -lighting * (settings.shadowOpacity / 100);
        const [r, g, b, a] = blendPixel(
          resultData[idx], resultData[idx + 1], resultData[idx + 2], resultData[idx + 3],
          shadowColor.r, shadowColor.g, shadowColor.b, Math.round(255 * opacity),
          settings.shadowMode
        );
        resultData[idx] = r;
        resultData[idx + 1] = g;
        resultData[idx + 2] = b;
        resultData[idx + 3] = a;
      }
    }
  }

  const resultImage = new ImageData(resultData, width, height);
  ctx.putImageData(resultImage, layerBounds.x, layerBounds.y);
}

export function applyInnerGlow(
  ctx: OffscreenCanvasRenderingContext2D,
  settings: InnerGlowSettings,
  layerBounds: { x: number; y: number; width: number; height: number }
): void {
  if (!settings.enabled) return;

  const { width, height } = layerBounds;
  const imageData = ctx.getImageData(layerBounds.x, layerBounds.y, width, height);
  const data = imageData.data;

  const glowColor = parseColor(settings.color);
  const size = settings.size;
  const choke = settings.choke / 100;

  const resultData = new Uint8ClampedArray(data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];

      if (alpha === 0) continue;

      const fromEdge = settings.source === 'edge';
      const edgeDist = fromEdge
        ? getEdgeDistance(imageData, x, y, size, true)
        : Math.min(
            x, y,
            width - x - 1, height - y - 1,
            size
          );

      const effectiveSize = size * (1 - choke);
      if (edgeDist >= effectiveSize) continue;

      let intensity = 1 - edgeDist / effectiveSize;

      if (settings.technique === 'softer') {
        intensity = Math.sin(intensity * Math.PI / 2);
      }

      intensity = evaluateContour(settings.contour, intensity * 255) / 255;

      if (settings.noise > 0) {
        intensity *= 1 - (Math.random() * settings.noise / 100);
      }

      const opacity = intensity * (settings.opacity / 100);

      const [r, g, b, a] = blendPixel(
        resultData[idx], resultData[idx + 1], resultData[idx + 2], resultData[idx + 3],
        glowColor.r, glowColor.g, glowColor.b, Math.round(255 * opacity),
        settings.blendMode
      );

      resultData[idx] = r;
      resultData[idx + 1] = g;
      resultData[idx + 2] = b;
      resultData[idx + 3] = a;
    }
  }

  const resultImage = new ImageData(resultData, width, height);
  ctx.putImageData(resultImage, layerBounds.x, layerBounds.y);
}

export function applyColorOverlay(
  ctx: OffscreenCanvasRenderingContext2D,
  settings: ColorOverlaySettings,
  layerBounds: { x: number; y: number; width: number; height: number }
): void {
  if (!settings.enabled) return;

  const { width, height } = layerBounds;
  const imageData = ctx.getImageData(layerBounds.x, layerBounds.y, width, height);
  const data = imageData.data;

  const overlayColor = parseColor(settings.color);
  const opacity = settings.opacity / 100;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;

    const [r, g, b, a] = blendPixel(
      data[i], data[i + 1], data[i + 2], data[i + 3],
      overlayColor.r, overlayColor.g, overlayColor.b, Math.round(255 * opacity),
      settings.blendMode
    );

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }

  ctx.putImageData(imageData, layerBounds.x, layerBounds.y);
}

export function applyGradientOverlay(
  ctx: OffscreenCanvasRenderingContext2D,
  settings: GradientOverlaySettings,
  layerBounds: { x: number; y: number; width: number; height: number }
): void {
  if (!settings.enabled) return;

  const { width, height } = layerBounds;
  const imageData = ctx.getImageData(layerBounds.x, layerBounds.y, width, height);
  const data = imageData.data;

  const angleRad = (settings.angle * Math.PI) / 180;
  const centerX = width / 2;
  const centerY = height / 2;
  const diagonal = Math.sqrt(width * width + height * height);
  const scale = settings.scale / 100;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] === 0) continue;

      let gradientPos: number;

      switch (settings.style) {
        case 'linear': {
          const dx = x - centerX;
          const dy = y - centerY;
          const projected = dx * Math.cos(angleRad) + dy * Math.sin(angleRad);
          gradientPos = (projected / (diagonal * scale) + 0.5);
          break;
        }
        case 'radial': {
          const dx = (x - centerX) / scale;
          const dy = (y - centerY) / scale;
          gradientPos = Math.sqrt(dx * dx + dy * dy) / (diagonal / 2);
          break;
        }
        case 'angle': {
          const dx = x - centerX;
          const dy = y - centerY;
          gradientPos = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
          break;
        }
        case 'reflected': {
          const dx = x - centerX;
          const dy = y - centerY;
          const projected = dx * Math.cos(angleRad) + dy * Math.sin(angleRad);
          gradientPos = Math.abs(projected / (diagonal * scale / 2));
          break;
        }
        case 'diamond': {
          const dx = Math.abs(x - centerX) / scale;
          const dy = Math.abs(y - centerY) / scale;
          gradientPos = (dx + dy) / diagonal;
          break;
        }
        default:
          gradientPos = 0;
      }

      if (settings.reverse) {
        gradientPos = 1 - gradientPos;
      }

      gradientPos = Math.max(0, Math.min(1, gradientPos));

      const { r: gradR, g: gradG, b: gradB, a: gradA } = interpolateGradient(
        settings.gradient,
        gradientPos
      );

      const opacity = (settings.opacity / 100) * (gradA / 255);
      const [r, g, b, a] = blendPixel(
        data[idx], data[idx + 1], data[idx + 2], data[idx + 3],
        gradR, gradG, gradB, Math.round(255 * opacity),
        settings.blendMode
      );

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }

  ctx.putImageData(imageData, layerBounds.x, layerBounds.y);
}

function interpolateGradient(
  gradient: GradientDef,
  position: number
): { r: number; g: number; b: number; a: number } {
  const { stops } = gradient;
  if (stops.length === 0) return { r: 0, g: 0, b: 0, a: 255 };

  const pos = position * 100;

  let stop1 = stops[0];
  let stop2 = stops[stops.length - 1];

  for (let i = 0; i < stops.length - 1; i++) {
    if (pos >= stops[i].position && pos <= stops[i + 1].position) {
      stop1 = stops[i];
      stop2 = stops[i + 1];
      break;
    }
  }

  const t = stop1.position === stop2.position
    ? 0
    : (pos - stop1.position) / (stop2.position - stop1.position);

  const c1 = parseColor(stop1.color);
  const c2 = parseColor(stop2.color);

  return {
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t),
    a: Math.round((stop1.opacity + (stop2.opacity - stop1.opacity) * t) * 2.55),
  };
}

export function applyPatternOverlay(
  ctx: OffscreenCanvasRenderingContext2D,
  settings: PatternOverlaySettings,
  layerBounds: { x: number; y: number; width: number; height: number }
): void {
  if (!settings.enabled || !settings.pattern) return;

  const { width, height } = layerBounds;
  const imageData = ctx.getImageData(layerBounds.x, layerBounds.y, width, height);
  const data = imageData.data;

  const pattern = settings.pattern;
  const patternData = pattern.data.data;
  const patternWidth = pattern.data.width;
  const patternHeight = pattern.data.height;
  const scale = (settings.scale / 100) * pattern.scale;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] === 0) continue;

      const px = Math.floor((x / scale) % patternWidth);
      const py = Math.floor((y / scale) % patternHeight);
      const pIdx = (py * patternWidth + px) * 4;

      const opacity = (settings.opacity / 100) * (patternData[pIdx + 3] / 255);
      const [r, g, b, a] = blendPixel(
        data[idx], data[idx + 1], data[idx + 2], data[idx + 3],
        patternData[pIdx], patternData[pIdx + 1], patternData[pIdx + 2], Math.round(255 * opacity),
        settings.blendMode
      );

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }

  ctx.putImageData(imageData, layerBounds.x, layerBounds.y);
}

export function applySatin(
  ctx: OffscreenCanvasRenderingContext2D,
  settings: SatinSettings,
  layerBounds: { x: number; y: number; width: number; height: number }
): void {
  if (!settings.enabled) return;

  const { width, height } = layerBounds;
  const imageData = ctx.getImageData(layerBounds.x, layerBounds.y, width, height);
  const data = imageData.data;

  const satinColor = parseColor(settings.color);
  const angleRad = (settings.angle * Math.PI) / 180;
  const offsetX = Math.cos(angleRad) * settings.distance;
  const offsetY = Math.sin(angleRad) * settings.distance;

  const resultData = new Uint8ClampedArray(data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] === 0) continue;

      const x1 = Math.round(x + offsetX);
      const y1 = Math.round(y + offsetY);
      const x2 = Math.round(x - offsetX);
      const y2 = Math.round(y - offsetY);

      let alpha1 = 0;
      let alpha2 = 0;

      if (x1 >= 0 && x1 < width && y1 >= 0 && y1 < height) {
        alpha1 = data[(y1 * width + x1) * 4 + 3];
      }
      if (x2 >= 0 && x2 < width && y2 >= 0 && y2 < height) {
        alpha2 = data[(y2 * width + x2) * 4 + 3];
      }

      let satinIntensity = Math.abs(alpha1 - alpha2) / 255;

      const dist1 = getEdgeDistance(imageData, x, y, settings.size, true);
      const distFactor = 1 - Math.min(dist1, settings.size) / settings.size;
      satinIntensity *= distFactor;

      satinIntensity = evaluateContour(settings.contour, satinIntensity * 255) / 255;

      if (settings.invert) {
        satinIntensity = 1 - satinIntensity;
      }

      const opacity = satinIntensity * (settings.opacity / 100);

      const [r, g, b, a] = blendPixel(
        resultData[idx], resultData[idx + 1], resultData[idx + 2], resultData[idx + 3],
        satinColor.r, satinColor.g, satinColor.b, Math.round(255 * opacity),
        settings.blendMode
      );

      resultData[idx] = r;
      resultData[idx + 1] = g;
      resultData[idx + 2] = b;
      resultData[idx + 3] = a;
    }
  }

  const resultImage = new ImageData(resultData, width, height);
  ctx.putImageData(resultImage, layerBounds.x, layerBounds.y);
}

export function applyLayerStyles(
  ctx: OffscreenCanvasRenderingContext2D,
  styles: Partial<LayerStyles>,
  layerBounds: { x: number; y: number; width: number; height: number }
): void {
  if (styles.patternOverlay) {
    applyPatternOverlay(ctx, { ...DEFAULT_PATTERN_OVERLAY, ...styles.patternOverlay }, layerBounds);
  }

  if (styles.gradientOverlay) {
    applyGradientOverlay(ctx, { ...DEFAULT_GRADIENT_OVERLAY, ...styles.gradientOverlay }, layerBounds);
  }

  if (styles.colorOverlay) {
    applyColorOverlay(ctx, { ...DEFAULT_COLOR_OVERLAY, ...styles.colorOverlay }, layerBounds);
  }

  if (styles.satin) {
    applySatin(ctx, { ...DEFAULT_SATIN, ...styles.satin }, layerBounds);
  }

  if (styles.innerGlow) {
    applyInnerGlow(ctx, { ...DEFAULT_INNER_GLOW, ...styles.innerGlow }, layerBounds);
  }

  if (styles.bevelEmboss) {
    applyBevelEmboss(ctx, { ...DEFAULT_BEVEL_EMBOSS, ...styles.bevelEmboss }, layerBounds);
  }
}
