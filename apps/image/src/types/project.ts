import type { LayerMask } from './mask';
import type {
  LevelsAdjustment,
  CurvesAdjustment,
  ColorBalanceAdjustment,
} from './adjustments';

export type LayerType = 'image' | 'text' | 'shape' | 'group';

export interface Transform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  opacity: number;
}

export interface BlendMode {
  mode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion';
}

export interface Shadow {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export interface Stroke {
  enabled: boolean;
  color: string;
  width: number;
  style: 'solid' | 'dashed' | 'dotted';
}

export interface Glow {
  enabled: boolean;
  color: string;
  blur: number;
  intensity: number;
}

export interface InnerShadow {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export type BlurType = 'gaussian' | 'motion' | 'radial';

export interface Filter {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  exposure: number;
  vibrance: number;
  highlights: number;
  shadows: number;
  clarity: number;
  blur: number;
  blurType: BlurType;
  blurAngle: number;
  sharpen: number;
  vignette: number;
  grain: number;
  sepia: number;
  invert: number;
}

export interface BaseLayer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  transform: Transform;
  blendMode: BlendMode;
  shadow: Shadow;
  innerShadow: InnerShadow;
  stroke: Stroke;
  glow: Glow;
  filters: Filter;
  parentId: string | null;
  flipHorizontal: boolean;
  flipVertical: boolean;
  mask: LayerMask | null;
  clippingMask: boolean;
  levels: LevelsAdjustment;
  curves: CurvesAdjustment;
  colorBalance: ColorBalanceAdjustment;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  sourceId: string;
  cropRect: { x: number; y: number; width: number; height: number } | null;
}

export type TextFillType = 'solid' | 'gradient';

export interface TextShadow {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  textDecoration: 'none' | 'underline' | 'line-through';
  textAlign: 'left' | 'center' | 'right' | 'justify';
  verticalAlign: 'top' | 'middle' | 'bottom';
  lineHeight: number;
  letterSpacing: number;
  fillType: TextFillType;
  color: string;
  gradient: Gradient | null;
  strokeColor: string | null;
  strokeWidth: number;
  backgroundColor: string | null;
  backgroundPadding: number;
  backgroundRadius: number;
  textShadow: TextShadow;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  content: string;
  style: TextStyle;
  autoSize: boolean;
}

export type ShapeType = 'rectangle' | 'ellipse' | 'triangle' | 'polygon' | 'star' | 'line' | 'arrow' | 'path';

export interface GradientStop {
  offset: number;
  color: string;
}

export interface Gradient {
  type: 'linear' | 'radial';
  angle: number;
  stops: GradientStop[];
}

export type FillType = 'solid' | 'gradient' | 'noise';

export type StrokeDashType = 'solid' | 'dashed' | 'dotted' | 'dash-dot' | 'long-dash';

export interface CornerRadius {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface NoiseFill {
  baseColor: string;
  noiseColor: string;
  density: number;
  size: number;
}

export interface ShapeStyle {
  fillType: FillType;
  fill: string | null;
  gradient: Gradient | null;
  noise: NoiseFill | null;
  fillOpacity: number;
  stroke: string | null;
  strokeWidth: number;
  strokeOpacity: number;
  strokeDash: StrokeDashType;
  cornerRadius: number;
  individualCorners: boolean;
  corners: CornerRadius;
}

export interface ShapeLayer extends BaseLayer {
  type: 'shape';
  shapeType: ShapeType;
  shapeStyle: ShapeStyle;
  points?: { x: number; y: number }[];
  sides?: number;
  innerRadius?: number;
}

export interface GroupLayer extends BaseLayer {
  type: 'group';
  childIds: string[];
  expanded: boolean;
}

export type Layer = ImageLayer | TextLayer | ShapeLayer | GroupLayer;

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasBackground {
  type: 'color' | 'gradient' | 'image' | 'transparent';
  color?: string;
  gradient?: {
    type: 'linear' | 'radial';
    angle: number;
    stops: { offset: number; color: string }[];
  };
  imageId?: string;
}

export interface Artboard {
  id: string;
  name: string;
  size: CanvasSize;
  background: CanvasBackground;
  layerIds: string[];
  position: { x: number; y: number };
}

export interface MediaAsset {
  id: string;
  name: string;
  type: 'image' | 'svg';
  mimeType: string;
  size: number;
  width: number;
  height: number;
  thumbnailUrl: string;
  dataUrl?: string;
  blobUrl?: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  artboards: Artboard[];
  layers: Record<string, Layer>;
  assets: Record<string, MediaAsset>;
  activeArtboardId: string | null;
}

export interface ProjectMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnailUrl: string | null;
}

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  opacity: 1,
};

export const DEFAULT_BLEND_MODE: BlendMode = {
  mode: 'normal',
};

export const DEFAULT_SHADOW: Shadow = {
  enabled: false,
  color: 'rgba(0, 0, 0, 0.5)',
  blur: 10,
  offsetX: 0,
  offsetY: 4,
};

export const DEFAULT_STROKE: Stroke = {
  enabled: false,
  color: '#000000',
  width: 1,
  style: 'solid',
};

export const DEFAULT_GLOW: Glow = {
  enabled: false,
  color: '#ffffff',
  blur: 20,
  intensity: 1,
};

export const DEFAULT_INNER_SHADOW: InnerShadow = {
  enabled: false,
  color: 'rgba(0, 0, 0, 0.5)',
  blur: 10,
  offsetX: 2,
  offsetY: 2,
};

export { DEFAULT_LAYER_MASK } from './mask';
export { DEFAULT_LEVELS, DEFAULT_CURVES, DEFAULT_COLOR_BALANCE } from './adjustments';

export const DEFAULT_FILTER: Filter = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  exposure: 0,
  vibrance: 0,
  highlights: 0,
  shadows: 0,
  clarity: 0,
  blur: 0,
  blurType: 'gaussian',
  blurAngle: 0,
  sharpen: 0,
  vignette: 0,
  grain: 0,
  sepia: 0,
  invert: 0,
};

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  fontWeight: 400,
  fontStyle: 'normal',
  textDecoration: 'none',
  textAlign: 'left',
  verticalAlign: 'top',
  lineHeight: 1.4,
  letterSpacing: 0,
  fillType: 'solid',
  color: '#ffffff',
  gradient: null,
  strokeColor: null,
  strokeWidth: 0,
  backgroundColor: null,
  backgroundPadding: 8,
  backgroundRadius: 4,
  textShadow: {
    enabled: false,
    color: 'rgba(0, 0, 0, 0.5)',
    blur: 4,
    offsetX: 0,
    offsetY: 2,
  },
};

export const DEFAULT_NOISE_FILL: NoiseFill = {
  baseColor: '#3b82f6',
  noiseColor: '#1e40af',
  density: 0.5,
  size: 2,
};

export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  fillType: 'solid',
  fill: '#3b82f6',
  gradient: null,
  noise: null,
  fillOpacity: 1,
  stroke: null,
  strokeWidth: 2,
  strokeOpacity: 1,
  strokeDash: 'solid',
  cornerRadius: 0,
  individualCorners: false,
  corners: {
    topLeft: 0,
    topRight: 0,
    bottomRight: 0,
    bottomLeft: 0,
  },
};

export const CANVAS_PRESETS: { name: string; width: number; height: number; category: string }[] = [
  { name: 'Instagram Post', width: 1080, height: 1080, category: 'Social Media' },
  { name: 'Instagram Story', width: 1080, height: 1920, category: 'Social Media' },
  { name: 'Facebook Post', width: 1200, height: 630, category: 'Social Media' },
  { name: 'Twitter Post', width: 1200, height: 675, category: 'Social Media' },
  { name: 'LinkedIn Post', width: 1200, height: 627, category: 'Social Media' },
  { name: 'YouTube Thumbnail', width: 1280, height: 720, category: 'Social Media' },
  { name: 'TikTok Video', width: 1080, height: 1920, category: 'Social Media' },
  { name: 'Pinterest Pin', width: 1000, height: 1500, category: 'Social Media' },
  { name: 'Presentation 16:9', width: 1920, height: 1080, category: 'Presentation' },
  { name: 'Presentation 4:3', width: 1024, height: 768, category: 'Presentation' },
  { name: 'A4 Portrait', width: 2480, height: 3508, category: 'Print' },
  { name: 'A4 Landscape', width: 3508, height: 2480, category: 'Print' },
  { name: 'Letter Portrait', width: 2550, height: 3300, category: 'Print' },
  { name: 'Business Card', width: 1050, height: 600, category: 'Print' },
  { name: 'Poster 18x24', width: 5400, height: 7200, category: 'Print' },
  { name: 'Desktop Wallpaper', width: 1920, height: 1080, category: 'Desktop' },
  { name: '4K Wallpaper', width: 3840, height: 2160, category: 'Desktop' },
  { name: 'Mobile Wallpaper', width: 1080, height: 1920, category: 'Mobile' },
  { name: 'Logo Square', width: 500, height: 500, category: 'Logo' },
  { name: 'Favicon', width: 512, height: 512, category: 'Logo' },
];
