import { z } from 'zod';

// ── Primitives ──────────────────────────────────────────────────────────────

const TransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  skewX: z.number(),
  skewY: z.number(),
  opacity: z.number(),
});

const BlendModeSchema = z.object({
  mode: z.enum([
    'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
    'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
  ]),
});

const ShadowSchema = z.object({
  enabled: z.boolean(),
  color: z.string(),
  blur: z.number(),
  offsetX: z.number(),
  offsetY: z.number(),
});

const InnerShadowSchema = z.object({
  enabled: z.boolean(),
  color: z.string(),
  blur: z.number(),
  offsetX: z.number(),
  offsetY: z.number(),
});

const StrokeSchema = z.object({
  enabled: z.boolean(),
  color: z.string(),
  width: z.number(),
  style: z.enum(['solid', 'dashed', 'dotted']),
});

const GlowSchema = z.object({
  enabled: z.boolean(),
  color: z.string(),
  blur: z.number(),
  intensity: z.number(),
});

const FilterSchema = z.object({
  brightness: z.number(),
  contrast: z.number(),
  saturation: z.number(),
  hue: z.number(),
  exposure: z.number(),
  vibrance: z.number(),
  highlights: z.number(),
  shadows: z.number(),
  clarity: z.number(),
  blur: z.number(),
  blurType: z.enum(['gaussian', 'motion', 'radial']),
  blurAngle: z.number(),
  sharpen: z.number(),
  vignette: z.number(),
  grain: z.number(),
  sepia: z.number(),
  invert: z.number(),
});

// ── Adjustments ──────────────────────────────────────────────────────────────

const LevelsChannelSchema = z.object({
  inputBlack: z.number(),
  inputWhite: z.number(),
  gamma: z.number(),
  outputBlack: z.number(),
  outputWhite: z.number(),
});

const LevelsSchema = z.object({
  enabled: z.boolean(),
  master: LevelsChannelSchema,
  red: LevelsChannelSchema,
  green: LevelsChannelSchema,
  blue: LevelsChannelSchema,
});

const CurvePointSchema = z.object({ input: z.number(), output: z.number() });

const CurvesChannelSchema = z.object({ points: z.array(CurvePointSchema) });

const CurvesSchema = z.object({
  enabled: z.boolean(),
  master: CurvesChannelSchema,
  red: CurvesChannelSchema,
  green: CurvesChannelSchema,
  blue: CurvesChannelSchema,
});

const ColorBalanceValuesSchema = z.object({
  cyanRed: z.number(),
  magentaGreen: z.number(),
  yellowBlue: z.number(),
});

const ColorBalanceSchema = z.object({
  enabled: z.boolean(),
  shadows: ColorBalanceValuesSchema,
  midtones: ColorBalanceValuesSchema,
  highlights: ColorBalanceValuesSchema,
  preserveLuminosity: z.boolean(),
});

const SelectiveColorValuesSchema = z.object({
  cyan: z.number(),
  magenta: z.number(),
  yellow: z.number(),
  black: z.number(),
});

const SelectiveColorSchema = z.object({
  enabled: z.boolean(),
  method: z.enum(['relative', 'absolute']),
  reds: SelectiveColorValuesSchema,
  yellows: SelectiveColorValuesSchema,
  greens: SelectiveColorValuesSchema,
  cyans: SelectiveColorValuesSchema,
  blues: SelectiveColorValuesSchema,
  magentas: SelectiveColorValuesSchema,
  whites: SelectiveColorValuesSchema,
  neutrals: SelectiveColorValuesSchema,
  blacks: SelectiveColorValuesSchema,
});

const BlackWhiteSchema = z.object({
  enabled: z.boolean(),
  reds: z.number(),
  yellows: z.number(),
  greens: z.number(),
  cyans: z.number(),
  blues: z.number(),
  magentas: z.number(),
  tintEnabled: z.boolean(),
  tintHue: z.number(),
  tintSaturation: z.number(),
});

const PhotoFilterSchema = z.object({
  enabled: z.boolean(),
  filter: z.enum(['warming-85', 'warming-81', 'cooling-80', 'cooling-82', 'custom']),
  color: z.string(),
  density: z.number(),
  preserveLuminosity: z.boolean(),
});

const ChannelMixerChannelSchema = z.object({
  red: z.number(),
  green: z.number(),
  blue: z.number(),
  constant: z.number(),
});

const ChannelMixerSchema = z.object({
  enabled: z.boolean(),
  monochrome: z.boolean(),
  red: ChannelMixerChannelSchema,
  green: ChannelMixerChannelSchema,
  blue: ChannelMixerChannelSchema,
});

const GradientMapStopSchema = z.object({ position: z.number(), color: z.string() });

const GradientMapSchema = z.object({
  enabled: z.boolean(),
  stops: z.array(GradientMapStopSchema),
  reverse: z.boolean(),
  dither: z.boolean(),
});

const PosterizeSchema = z.object({
  enabled: z.boolean(),
  levels: z.number(),
});

const ThresholdSchema = z.object({
  enabled: z.boolean(),
  level: z.number(),
});

// ── Mask ──────────────────────────────────────────────────────────────────────

const LayerMaskSchema = z.object({
  id: z.string(),
  type: z.enum(['pixel', 'vector']),
  enabled: z.boolean(),
  linked: z.boolean(),
  density: z.number(),
  feather: z.number(),
  invert: z.boolean(),
  data: z.string().nullable(),
  vectorPath: z.array(z.object({ x: z.number(), y: z.number() })).nullable(),
});

// ── Layer base ────────────────────────────────────────────────────────────────

const BaseLayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['image', 'text', 'shape', 'group']),
  visible: z.boolean(),
  locked: z.boolean(),
  transform: TransformSchema,
  blendMode: BlendModeSchema,
  shadow: ShadowSchema,
  innerShadow: InnerShadowSchema,
  stroke: StrokeSchema,
  glow: GlowSchema,
  filters: FilterSchema,
  parentId: z.string().nullable(),
  flipHorizontal: z.boolean(),
  flipVertical: z.boolean(),
  mask: LayerMaskSchema.nullable(),
  clippingMask: z.boolean(),
  levels: LevelsSchema,
  curves: CurvesSchema,
  colorBalance: ColorBalanceSchema,
  selectiveColor: SelectiveColorSchema,
  blackWhite: BlackWhiteSchema,
  photoFilter: PhotoFilterSchema,
  channelMixer: ChannelMixerSchema,
  gradientMap: GradientMapSchema,
  posterize: PosterizeSchema,
  threshold: ThresholdSchema,
});

// ── Layer variants ────────────────────────────────────────────────────────────

const ImageLayerSchema = BaseLayerSchema.extend({
  type: z.literal('image'),
  sourceId: z.string(),
  cropRect: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullable(),
});

const GradientStopSchema = z.object({ offset: z.number(), color: z.string() });

const GradientSchema = z.object({
  type: z.enum(['linear', 'radial']),
  angle: z.number(),
  stops: z.array(GradientStopSchema),
});

const TextShadowSchema = z.object({
  enabled: z.boolean(),
  color: z.string(),
  blur: z.number(),
  offsetX: z.number(),
  offsetY: z.number(),
});

const TextStyleSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  fontWeight: z.number(),
  fontStyle: z.enum(['normal', 'italic']),
  textDecoration: z.enum(['none', 'underline', 'line-through']),
  textAlign: z.enum(['left', 'center', 'right', 'justify']),
  verticalAlign: z.enum(['top', 'middle', 'bottom']),
  lineHeight: z.number(),
  letterSpacing: z.number(),
  fillType: z.enum(['solid', 'gradient']),
  color: z.string(),
  gradient: GradientSchema.nullable(),
  strokeColor: z.string().nullable(),
  strokeWidth: z.number(),
  backgroundColor: z.string().nullable(),
  backgroundPadding: z.number(),
  backgroundRadius: z.number(),
  textShadow: TextShadowSchema,
});

const TextLayerSchema = BaseLayerSchema.extend({
  type: z.literal('text'),
  content: z.string(),
  style: TextStyleSchema,
  autoSize: z.boolean(),
});

const CornerRadiusSchema = z.object({
  topLeft: z.number(),
  topRight: z.number(),
  bottomRight: z.number(),
  bottomLeft: z.number(),
});

const NoiseFillSchema = z.object({
  baseColor: z.string(),
  noiseColor: z.string(),
  density: z.number(),
  size: z.number(),
});

const ShapeStyleSchema = z.object({
  fillType: z.enum(['solid', 'gradient', 'noise']),
  fill: z.string().nullable(),
  gradient: GradientSchema.nullable(),
  noise: NoiseFillSchema.nullable(),
  fillOpacity: z.number(),
  stroke: z.string().nullable(),
  strokeWidth: z.number(),
  strokeOpacity: z.number(),
  strokeDash: z.enum(['solid', 'dashed', 'dotted', 'dash-dot', 'long-dash']),
  cornerRadius: z.number(),
  individualCorners: z.boolean(),
  corners: CornerRadiusSchema,
});

const ShapeLayerSchema = BaseLayerSchema.extend({
  type: z.literal('shape'),
  shapeType: z.enum([
    'rectangle', 'ellipse', 'triangle', 'polygon', 'star', 'line', 'arrow', 'path',
  ]),
  shapeStyle: ShapeStyleSchema,
  points: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  sides: z.number().optional(),
  innerRadius: z.number().optional(),
});

const GroupLayerSchema = BaseLayerSchema.extend({
  type: z.literal('group'),
  childIds: z.array(z.string()),
  expanded: z.boolean(),
});

export const LayerSchema = z.discriminatedUnion('type', [
  ImageLayerSchema,
  TextLayerSchema,
  ShapeLayerSchema,
  GroupLayerSchema,
]);

// ── Project types ─────────────────────────────────────────────────────────────

const CanvasSizeSchema = z.object({ width: z.number(), height: z.number() });

const CanvasBackgroundSchema = z.object({
  type: z.enum(['color', 'gradient', 'image', 'transparent']),
  color: z.string().optional(),
  gradient: z
    .object({
      type: z.enum(['linear', 'radial']),
      angle: z.number(),
      stops: z.array(z.object({ offset: z.number(), color: z.string() })),
    })
    .optional(),
  imageId: z.string().optional(),
});

export const ArtboardSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: CanvasSizeSchema,
  background: CanvasBackgroundSchema,
  layerIds: z.array(z.string()),
  position: z.object({ x: z.number(), y: z.number() }),
});

const MediaAssetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['image', 'svg']),
  mimeType: z.string(),
  size: z.number(),
  width: z.number(),
  height: z.number(),
  thumbnailUrl: z.string(),
  dataUrl: z.string().optional(),
  blobUrl: z.string().optional(),
});

/** Current project schema (version 1). */
export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  version: z.number(),
  artboards: z.array(ArtboardSchema),
  layers: z.record(z.string(), LayerSchema),
  assets: z.record(z.string(), MediaAssetSchema),
  activeArtboardId: z.string().nullable(),
});

export type ParsedProject = z.infer<typeof ProjectSchema>;

/**
 * Validate an unknown value against the Project schema.
 * Returns `{ success: true, data }` on success or `{ success: false, error }` on failure.
 */
export function parseProject(
  raw: unknown,
): { success: true; data: ParsedProject } | { success: false; error: string } {
  const result = ProjectSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}
