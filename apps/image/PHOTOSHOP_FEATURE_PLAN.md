# OpenReel Image - Photoshop Feature Implementation Plan

## Executive Summary

This document outlines a comprehensive plan to implement Photoshop-equivalent features in OpenReel Image. Based on detailed research of Photoshop's feature set and audit of current OpenReel capabilities, this plan prioritizes features by impact and complexity.

---

## Current State vs Photoshop Comparison

### Layer System

| Feature | Photoshop | OpenReel | Gap |
|---------|-----------|----------|-----|
| Pixel Layers | ✓ | ✓ (image) | - |
| Adjustment Layers | 16+ types | 11 types | 5+ missing |
| Fill Layers | Solid, Gradient, Pattern | Partial | Pattern fill |
| Shape Layers | ✓ | ✓ | - |
| Text Layers | ✓ | ✓ | - |
| Smart Objects | Full | Basic | Non-destructive editing |
| 3D Layers | ✓ | ✗ | Full feature |
| Video Layers | ✓ | ✗ | Full feature |

### Blend Modes

| Category | Photoshop | OpenReel | Missing |
|----------|-----------|----------|---------|
| Normal | Normal, Dissolve | Normal | Dissolve |
| Darken | 5 modes | 3 modes | Linear Burn, Darker Color |
| Lighten | 5 modes | 3 modes | Linear Dodge, Lighter Color |
| Contrast | 8 modes | 3 modes | Vivid/Linear/Pin Light, Hard Mix |
| Comparative | 4 modes | 3 modes | Divide |
| Component | 4 modes | 4 modes | - |
| **Total** | **27+** | **12** | **15+** |

### Selection Tools

| Tool | Photoshop | OpenReel | Priority |
|------|-----------|----------|----------|
| Rectangular Marquee | ✓ | ✓ (basic) | Enhance |
| Elliptical Marquee | ✓ | ✗ | High |
| Lasso (Free) | ✓ | ✗ | High |
| Polygonal Lasso | ✓ | ✗ | High |
| Magnetic Lasso | ✓ | ✗ | Medium |
| Magic Wand | ✓ | ✗ | High |
| Quick Selection | ✓ | ✗ | Medium |
| Object Selection | ✓ | ✗ | Medium |
| Select Subject (AI) | ✓ | ✓ (BG removal) | Partial |
| Color Range | ✓ | ✗ | Medium |

### Brush & Paint Tools

| Tool | Photoshop | OpenReel | Priority |
|------|-----------|----------|----------|
| Brush Tool | Full dynamics | Basic pen | Enhance |
| Pencil Tool | ✓ | ✗ | Medium |
| Eraser Tool | ✓ | ✗ | High |
| Clone Stamp | ✓ | ✗ | High |
| Healing Brush | ✓ | ✗ | High |
| Spot Healing | ✓ | ✗ | High |
| Patch Tool | ✓ | ✗ | Medium |
| Content-Aware Fill | ✓ | ✗ | High (AI) |
| Red Eye Tool | ✓ | ✗ | Low |

### Retouching Tools

| Tool | Photoshop | OpenReel | Priority |
|------|-----------|----------|----------|
| Dodge (Lighten) | ✓ | ✗ | High |
| Burn (Darken) | ✓ | ✗ | High |
| Sponge (Saturation) | ✓ | ✗ | Medium |
| Blur Brush | ✓ | ✗ | Medium |
| Sharpen Brush | ✓ | ✗ | Medium |
| Smudge Tool | ✓ | ✗ | Medium |

### Transform Tools

| Tool | Photoshop | OpenReel | Priority |
|------|-----------|----------|----------|
| Free Transform | ✓ | ✓ | - |
| Warp | ✓ | ✗ | High |
| Perspective | ✓ | ✗ | High |
| Puppet Warp | ✓ | ✗ | Low |
| Content-Aware Scale | ✓ | ✗ | Medium |
| Liquify | ✓ | ✗ | Medium |

### Layer Effects/Styles

| Effect | Photoshop | OpenReel | Priority |
|--------|-----------|----------|----------|
| Drop Shadow | Full | Basic | Enhance (spread, contour) |
| Inner Shadow | Full | Basic | Enhance (contour) |
| Outer Glow | Full | Basic | Enhance (contour, spread) |
| Inner Glow | ✓ | ✗ | High |
| Bevel & Emboss | ✓ | ✗ | High |
| Satin | ✓ | ✗ | Medium |
| Color Overlay | ✓ | ✗ | High |
| Gradient Overlay | ✓ | ✗ | High |
| Pattern Overlay | ✓ | ✗ | Medium |
| Stroke | Full | Basic | Enhance (position, gradient) |

### Filters

| Category | Photoshop | OpenReel | Gap |
|----------|-----------|----------|-----|
| Blur | 14+ types | 3 types | 11+ |
| Sharpen | 4 types | 1 type | 3 |
| Noise | 5 types | 1 type | 4 |
| Distort | 12+ types | 0 | All |
| Stylize | 8+ types | 0 | All |
| Render | 8+ types | 0 | All |
| Neural/AI | 10+ types | 1 (BG remove) | 9+ |

### Adjustments

| Adjustment | Photoshop | OpenReel | Priority |
|------------|-----------|----------|----------|
| Brightness/Contrast | ✓ | ✓ | - |
| Levels | ✓ | ✗ | Critical |
| Curves | ✓ | ✗ | Critical |
| Exposure | ✓ | ✓ | - |
| Vibrance | ✓ | ✓ | - |
| Hue/Saturation | ✓ | ✓ | - |
| Color Balance | ✓ | ✗ | High |
| Black & White | ✓ | ✗ | High |
| Photo Filter | ✓ | ✗ | Medium |
| Channel Mixer | ✓ | ✗ | Medium |
| Color Lookup (LUT) | ✓ | ✗ | High |
| Invert | ✓ | ✓ | - |
| Posterize | ✓ | ✗ | Medium |
| Threshold | ✓ | ✗ | Medium |
| Gradient Map | ✓ | ✗ | Medium |
| Selective Color | ✓ | ✗ | High |

### Masks

| Mask Type | Photoshop | OpenReel | Priority |
|-----------|-----------|----------|----------|
| Pixel Masks | ✓ | ✗ | Critical |
| Vector Masks | ✓ | ✗ | High |
| Clipping Masks | ✓ | ✗ | High |
| Quick Mask | ✓ | ✗ | Medium |

### Text Features

| Feature | Photoshop | OpenReel | Priority |
|---------|-----------|----------|----------|
| Basic Formatting | ✓ | ✓ | - |
| Paragraph Styles | ✓ | ✓ | - |
| OpenType Features | ✓ | ✗ | Medium |
| Variable Fonts | ✓ | ✗ | Low |
| Text on Path | ✓ | ✗ | High |
| Text in Shape | ✓ | ✗ | Medium |
| Warp Text | ✓ | ✗ | High |

### History & Actions

| Feature | Photoshop | OpenReel | Priority |
|---------|-----------|----------|----------|
| History Panel | ✓ | Basic undo | Enhance |
| History Brush | ✓ | ✗ | Medium |
| Snapshots | ✓ | ✗ | Medium |
| Actions | ✓ | ✗ | High |
| Batch Processing | ✓ | ✗ | Medium |

---

## Implementation Phases

### Phase 1: Critical Foundation (Core Editing)

**Priority: CRITICAL | Effort: Large**

#### 1.1 Selection System
```typescript
interface Selection {
  id: string;
  type: 'rectangular' | 'elliptical' | 'lasso' | 'polygonal' | 'magic-wand' | 'color-range';
  path: Path2D | null;
  bounds: BoundingBox;
  feather: number;
  antiAlias: boolean;
  marching: boolean; // marching ants animation
}

interface SelectionStore {
  activeSelection: Selection | null;
  savedSelections: Selection[];
  selectionMode: 'new' | 'add' | 'subtract' | 'intersect';
}
```

**Tools to implement:**
- Rectangular Marquee with feather, anti-alias
- Elliptical Marquee
- Lasso (freehand)
- Polygonal Lasso
- Magic Wand (tolerance-based color selection)

#### 1.2 Layer Masks
```typescript
interface LayerMask {
  id: string;
  type: 'pixel' | 'vector';
  data: ImageData | Path2D;
  enabled: boolean;
  linked: boolean; // linked to layer transform
  density: number; // 0-100%
  feather: number;
}

interface Layer {
  // ... existing
  mask: LayerMask | null;
  clippingMask: boolean; // clips to layer below
}
```

#### 1.3 Levels & Curves Adjustments
```typescript
interface LevelsAdjustment {
  channel: 'rgb' | 'red' | 'green' | 'blue';
  inputBlack: number;   // 0-255
  inputWhite: number;   // 0-255
  gamma: number;        // 0.1-10
  outputBlack: number;  // 0-255
  outputWhite: number;  // 0-255
}

interface CurvesAdjustment {
  channel: 'rgb' | 'red' | 'green' | 'blue';
  points: Array<{ input: number; output: number }>; // up to 14 points
}
```

#### 1.4 History System Enhancement
```typescript
interface HistoryState {
  id: string;
  name: string;
  timestamp: number;
  snapshot: ProjectSnapshot;
  thumbnail?: string;
}

interface HistoryStore {
  states: HistoryState[];
  currentIndex: number;
  maxStates: number; // default 50
  snapshots: Map<string, HistoryState>; // named snapshots
}
```

---

### Phase 2: Essential Tools (Retouching & Paint)

**Priority: HIGH | Effort: Large**

#### 2.1 Brush Engine Enhancement
```typescript
interface BrushSettings {
  size: number;
  hardness: number;      // 0-100%
  opacity: number;       // 0-100%
  flow: number;          // 0-100%
  spacing: number;       // 1-1000%
  angle: number;
  roundness: number;     // 0-100%

  // Dynamics
  sizeDynamics: BrushDynamics;
  opacityDynamics: BrushDynamics;
  flowDynamics: BrushDynamics;

  // Shape
  tip: 'round' | 'square' | 'custom';
  customTip?: ImageData;

  // Transfer
  buildUp: boolean;
  smoothing: number;     // 0-100%
}

interface BrushDynamics {
  control: 'off' | 'fade' | 'pen-pressure' | 'pen-tilt' | 'rotation';
  minValue: number;
  jitter: number;
}
```

#### 2.2 Clone Stamp & Healing
```typescript
interface CloneStampTool {
  sourcePoint: { x: number; y: number } | null;
  sourceLayer: string | null;
  aligned: boolean;
  sampleMode: 'current' | 'current-below' | 'all';
  blendMode: BlendMode;
  opacity: number;
}

interface HealingBrushTool extends CloneStampTool {
  healingMode: 'normal' | 'content-aware' | 'proximity';
  diffusion: number; // for high-frequency areas
}

interface SpotHealingTool {
  type: 'proximity-match' | 'content-aware' | 'create-texture';
  sampleAllLayers: boolean;
}
```

#### 2.3 Eraser Tool
```typescript
interface EraserTool {
  mode: 'brush' | 'pencil' | 'block';
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  eraseToHistory: boolean; // restore from history state
}
```

#### 2.4 Dodge, Burn, Sponge
```typescript
interface DodgeBurnTool {
  type: 'dodge' | 'burn';
  range: 'shadows' | 'midtones' | 'highlights';
  exposure: number; // 0-100%
  protectTones: boolean;
}

interface SpongeTool {
  mode: 'saturate' | 'desaturate';
  flow: number; // 0-100%
  vibrance: boolean; // protect skin tones
}
```

---

### Phase 3: Advanced Effects & Filters

**Priority: HIGH | Effort: Medium-Large**

#### 3.1 Additional Blend Modes
```typescript
type BlendMode =
  // Existing
  | 'normal' | 'multiply' | 'screen' | 'overlay'
  | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'hard-light' | 'soft-light' | 'difference' | 'exclusion'

  // New - Darken Group
  | 'linear-burn' | 'darker-color'

  // New - Lighten Group
  | 'linear-dodge' | 'lighter-color'

  // New - Contrast Group
  | 'vivid-light' | 'linear-light' | 'pin-light' | 'hard-mix'

  // New - Other
  | 'dissolve' | 'divide';
```

#### 3.2 Layer Style Enhancements
```typescript
interface DropShadow {
  enabled: boolean;
  blendMode: BlendMode;
  color: string;
  opacity: number;
  angle: number;
  distance: number;
  spread: number;        // NEW: 0-100%
  size: number;
  contour: ContourCurve; // NEW: custom curve
  antiAlias: boolean;
  noise: number;
  layerKnockout: boolean;
}

interface BevelEmboss {
  enabled: boolean;
  style: 'outer-bevel' | 'inner-bevel' | 'emboss' | 'pillow-emboss' | 'stroke-emboss';
  technique: 'smooth' | 'chisel-hard' | 'chisel-soft';
  depth: number;
  direction: 'up' | 'down';
  size: number;
  soften: number;

  // Shading
  angle: number;
  altitude: number;
  highlightMode: BlendMode;
  highlightColor: string;
  highlightOpacity: number;
  shadowMode: BlendMode;
  shadowColor: string;
  shadowOpacity: number;

  // Contour
  gloss: ContourCurve;
  contour: ContourCurve;
  antiAlias: boolean;
}

interface InnerGlow {
  enabled: boolean;
  blendMode: BlendMode;
  opacity: number;
  noise: number;
  color: string | GradientDef;
  technique: 'softer' | 'precise';
  source: 'center' | 'edge';
  choke: number;
  size: number;
  contour: ContourCurve;
  antiAlias: boolean;
  range: number;
  jitter: number;
}

interface ColorOverlay {
  enabled: boolean;
  blendMode: BlendMode;
  color: string;
  opacity: number;
}

interface GradientOverlay {
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

interface PatternOverlay {
  enabled: boolean;
  blendMode: BlendMode;
  opacity: number;
  pattern: PatternDef;
  scale: number;
  linkWithLayer: boolean;
}

interface Satin {
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
```

#### 3.3 Filter System
```typescript
// Blur Filters
interface GaussianBlur { radius: number; }
interface MotionBlur { angle: number; distance: number; }
interface RadialBlur { amount: number; method: 'spin' | 'zoom'; quality: 'draft' | 'better' | 'best'; center: Point; }
interface LensBlur { radius: number; irisShape: number; irisRotation: number; iriscurvature: number; highlight: { brightness: number; threshold: number; }; }
interface SurfaceBlur { radius: number; threshold: number; }
interface TiltShift { blur: number; focusLine: { start: Point; end: Point }; transition: number; }

// Sharpen Filters
interface UnsharpMask { amount: number; radius: number; threshold: number; }
interface SmartSharpen { amount: number; radius: number; removeBlur: 'gaussian' | 'lens' | 'motion'; noiseReduction: number; }
interface HighPass { radius: number; } // Applied with overlay blend mode

// Distort Filters
interface Spherize { amount: number; mode: 'normal' | 'horizontal' | 'vertical'; }
interface Pinch { amount: number; }
interface Twirl { angle: number; }
interface Wave { generators: number; wavelength: { min: number; max: number }; amplitude: { min: number; max: number }; scale: { x: number; y: number }; type: 'sine' | 'triangle' | 'square'; }
interface Ripple { amount: number; size: 'small' | 'medium' | 'large'; }
interface ZigZag { amount: number; ridges: number; style: 'around-center' | 'out-from-center' | 'pond-ripples'; }
interface PolarCoordinates { mode: 'rectangular-to-polar' | 'polar-to-rectangular'; }

// Noise Filters
interface AddNoise { amount: number; distribution: 'uniform' | 'gaussian'; monochromatic: boolean; }
interface ReduceNoise { strength: number; preserveDetails: number; reduceColorNoise: number; sharpenDetails: number; }
interface DustScratches { radius: number; threshold: number; }
interface Median { radius: number; }

// Stylize Filters
interface OilPaint { stylization: number; cleanliness: number; scale: number; bristleDetail: number; angularDirection: number; }
interface Emboss { angle: number; height: number; amount: number; }
interface FindEdges { /* no params */ }
interface Wind { method: 'wind' | 'blast' | 'stagger'; direction: 'left' | 'right'; }

// Render Filters
interface Clouds { /* uses foreground/background colors */ }
interface DifferenceClouds { /* blends with existing content */ }
interface Fibers { variance: number; strength: number; }
interface LensFlare { brightness: number; flareCenter: Point; lensType: '50-300mm-zoom' | '35mm-prime' | '105mm-prime' | 'movie-prime'; }
```

#### 3.4 Liquify Tool
```typescript
interface LiquifySettings {
  brushSize: number;
  brushDensity: number;
  brushPressure: number;
  brushRate: number;

  // Face-Aware
  faceAware: boolean;
  faceControls?: {
    eyeSize: number;
    eyeHeight: number;
    eyeWidth: number;
    eyeTilt: number;
    eyeDistance: number;
    noseHeight: number;
    noseWidth: number;
    mouthSmile: number;
    mouthHeight: number;
    mouthWidth: number;
    jawline: number;
    faceWidth: number;
    forehead: number;
    chinHeight: number;
  };
}

type LiquifyTool =
  | 'warp'           // Forward Warp
  | 'reconstruct'    // Restore
  | 'smooth'         // Smooth
  | 'twirl-cw'       // Twirl Clockwise
  | 'twirl-ccw'      // Twirl Counter-Clockwise
  | 'pucker'         // Contract
  | 'bloat'          // Expand
  | 'push-left'      // Shift Pixels
  | 'freeze'         // Protect area
  | 'thaw';          // Unprotect area
```

---

### Phase 4: Color & Adjustments

**Priority: HIGH | Effort: Medium**

#### 4.1 Advanced Adjustments
```typescript
interface ColorBalance {
  shadows: { cyan_red: number; magenta_green: number; yellow_blue: number };
  midtones: { cyan_red: number; magenta_green: number; yellow_blue: number };
  highlights: { cyan_red: number; magenta_green: number; yellow_blue: number };
  preserveLuminosity: boolean;
}

interface SelectiveColor {
  colors: 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas' | 'whites' | 'neutrals' | 'blacks';
  cyan: number;    // -100 to +100
  magenta: number;
  yellow: number;
  black: number;
  method: 'relative' | 'absolute';
}

interface BlackWhite {
  reds: number;
  yellows: number;
  greens: number;
  cyans: number;
  blues: number;
  magentas: number;
  tint: { enabled: boolean; hue: number; saturation: number };
}

interface PhotoFilter {
  filter: 'warming-85' | 'warming-81' | 'cooling-80' | 'cooling-82' | 'custom';
  color: string;
  density: number;
  preserveLuminosity: boolean;
}

interface ChannelMixer {
  outputChannel: 'red' | 'green' | 'blue';
  red: number;
  green: number;
  blue: number;
  constant: number;
  monochrome: boolean;
}

interface ColorLookup {
  lutFile: string;       // .cube, .3dl, .look file
  lutData: Float32Array; // 3D LUT data
  strength: number;
}

interface GradientMap {
  gradient: GradientDef;
  dither: boolean;
  reverse: boolean;
}

interface Posterize {
  levels: number; // 2-255
}

interface Threshold {
  level: number; // 0-255
}
```

#### 4.2 Histogram & Info Panel
```typescript
interface Histogram {
  data: {
    red: Uint32Array;
    green: Uint32Array;
    blue: Uint32Array;
    luminosity: Uint32Array;
  };
  clipping: {
    shadowsClipped: number;    // percentage
    highlightsClipped: number;
  };
  statistics: {
    mean: number;
    stdDev: number;
    median: number;
    pixelCount: number;
  };
}

interface ColorInfo {
  rgb: { r: number; g: number; b: number };
  hsb: { h: number; s: number; b: number };
  lab: { l: number; a: number; b: number };
  cmyk: { c: number; m: number; y: number; k: number };
  hex: string;
}
```

---

### Phase 5: Text & Vector

**Priority: MEDIUM | Effort: Medium**

#### 5.1 Text on Path
```typescript
interface TextOnPath {
  path: Path2D | SVGPath;
  startOffset: number;     // 0-100%
  alignment: 'left' | 'center' | 'right';
  orientation: 'upright' | 'tangent';
  flipText: boolean;
}
```

#### 5.2 Warp Text
```typescript
type WarpStyle =
  | 'arc' | 'arc-lower' | 'arc-upper' | 'arch' | 'bulge'
  | 'shell-lower' | 'shell-upper' | 'flag' | 'wave' | 'fish'
  | 'rise' | 'fish-eye' | 'inflate' | 'squeeze' | 'twist';

interface WarpText {
  style: WarpStyle;
  orientation: 'horizontal' | 'vertical';
  bend: number;           // -100 to +100
  horizontalDistortion: number;
  verticalDistortion: number;
}
```

#### 5.3 OpenType Features
```typescript
interface OpenTypeFeatures {
  ligatures: 'none' | 'standard' | 'discretionary' | 'historical';
  contextualAlternates: boolean;
  stylisticAlternates: boolean;
  swash: boolean;
  titlingAlternates: boolean;
  ordinals: boolean;
  fractions: boolean;
  slashedZero: boolean;
}
```

---

### Phase 6: Automation & Workflow

**Priority: MEDIUM | Effort: Large**

#### 6.1 Actions System
```typescript
interface Action {
  id: string;
  name: string;
  steps: ActionStep[];
  shortcut?: string;
}

interface ActionStep {
  id: string;
  type: string;           // tool/filter/adjustment type
  parameters: Record<string, unknown>;
  enabled: boolean;
  dialog: boolean;        // show dialog on playback
}

interface ActionSet {
  id: string;
  name: string;
  actions: Action[];
}

interface ActionStore {
  sets: ActionSet[];
  recording: boolean;
  currentAction: Action | null;
}
```

#### 6.2 Batch Processing
```typescript
interface BatchProcess {
  source: 'folder' | 'open-files';
  sourcePath?: string;
  includeSubfolders: boolean;
  action: string;
  destination: 'same' | 'folder' | 'save-close';
  destinationPath?: string;
  fileNaming: {
    template: string;
    startNumber: number;
    compatibility: 'windows' | 'mac' | 'unix';
  };
  errors: 'stop' | 'log' | 'skip';
}
```

#### 6.3 Presets System
```typescript
interface PresetLibrary {
  brushes: BrushPreset[];
  gradients: GradientPreset[];
  patterns: PatternPreset[];
  layerStyles: LayerStylePreset[];
  filters: FilterPreset[];
  adjustments: AdjustmentPreset[];
  tools: ToolPreset[];
  exports: ExportPreset[];
}
```

---

## Implementation Priority Matrix

### Tier 1: Critical (Implement First)
1. **Selection Tools** - Rectangular, Elliptical, Lasso, Magic Wand
2. **Layer Masks** - Pixel masks with feather, density
3. **Levels Adjustment** - Input/output levels, gamma
4. **Curves Adjustment** - Multi-point curve editing
5. **Eraser Tool** - Basic erasing with brush settings
6. **Enhanced History** - Visual history panel, snapshots

### Tier 2: High Priority
1. **Clone Stamp** - Source point, aligned mode
2. **Healing Brush** - Texture blending
3. **Spot Healing** - Content-aware healing
4. **Dodge/Burn** - Exposure-based lightening/darkening
5. **Additional Blend Modes** - Complete the 27 modes
6. **Layer Effects** - Bevel & Emboss, Inner Glow, Overlays
7. **Color Balance** - Shadows/Midtones/Highlights
8. **Selective Color** - CMYK-based color targeting
9. **Warp Transform** - Mesh-based warping
10. **Text on Path** - Path-following text

### Tier 3: Medium Priority
1. **Blur Filters** - Lens blur, surface blur, tilt-shift
2. **Sharpen Filters** - Unsharp mask, smart sharpen
3. **Distort Filters** - Spherize, pinch, twirl, wave
4. **Liquify** - Face-aware warping
5. **Noise Filters** - Add/reduce noise
6. **Vector Masks** - Path-based masks
7. **Clipping Masks** - Clip to layer below
8. **Color Lookup (LUT)** - 3D LUT support
9. **Gradient Map** - Tone-to-color mapping
10. **Warp Text** - 15 warp styles

### Tier 4: Lower Priority
1. **Stylize Filters** - Oil paint, emboss, find edges
2. **Render Filters** - Clouds, lens flare
3. **Actions System** - Record and playback
4. **Batch Processing** - Multi-file automation
5. **Variable Fonts** - Axis controls
6. **OpenType Features** - Ligatures, alternates
7. **Content-Aware Fill** - AI-powered fill (requires ML)
8. **Neural Filters** - AI-powered effects (requires ML)
9. **Puppet Warp** - Pin-based warping
10. **3D Layers** - Basic 3D support

---

## Technical Architecture

### Canvas Rendering Pipeline
```
Layer Stack
    ↓
For each layer:
    Apply masks (pixel/vector)
    ↓
    Apply clipping mask (if enabled)
    ↓
    Render layer content
    ↓
    Apply layer effects (shadow, glow, etc.)
    ↓
    Apply blend mode with layer below
    ↓
Composite to canvas
```

### Filter Processing Pipeline
```
Selection (optional)
    ↓
Source pixels
    ↓
Apply filter kernel/algorithm
    ↓
Apply feather (if selection)
    ↓
Blend with original (based on filter opacity)
    ↓
Output pixels
```

### Recommended File Structure
```
apps/image/src/
├── tools/
│   ├── selection/
│   │   ├── rectangular-marquee.ts
│   │   ├── elliptical-marquee.ts
│   │   ├── lasso.ts
│   │   ├── polygonal-lasso.ts
│   │   ├── magic-wand.ts
│   │   └── color-range.ts
│   ├── paint/
│   │   ├── brush.ts
│   │   ├── eraser.ts
│   │   ├── clone-stamp.ts
│   │   ├── healing-brush.ts
│   │   └── spot-healing.ts
│   ├── retouch/
│   │   ├── dodge.ts
│   │   ├── burn.ts
│   │   ├── sponge.ts
│   │   └── smudge.ts
│   └── transform/
│       ├── warp.ts
│       ├── perspective.ts
│       └── liquify.ts
├── filters/
│   ├── blur/
│   ├── sharpen/
│   ├── distort/
│   ├── noise/
│   ├── stylize/
│   └── render/
├── adjustments/
│   ├── levels.ts
│   ├── curves.ts
│   ├── color-balance.ts
│   ├── selective-color.ts
│   ├── channel-mixer.ts
│   └── color-lookup.ts
├── masks/
│   ├── pixel-mask.ts
│   ├── vector-mask.ts
│   └── clipping-mask.ts
├── effects/
│   ├── blend-modes.ts
│   ├── layer-styles.ts
│   └── contours.ts
└── automation/
    ├── actions.ts
    ├── history.ts
    └── presets.ts
```

---

## Estimated Effort Summary

| Phase | Features | Complexity | Files |
|-------|----------|------------|-------|
| Phase 1 | Selection, Masks, Levels, Curves, History | High | 15-20 |
| Phase 2 | Paint Tools, Retouching | High | 12-15 |
| Phase 3 | Blend Modes, Effects, Filters | Medium-High | 25-30 |
| Phase 4 | Color Adjustments, Histogram | Medium | 10-12 |
| Phase 5 | Text, Vector | Medium | 8-10 |
| Phase 6 | Actions, Automation | Medium-High | 10-12 |

**Total: 80-100 new/modified files**

---

## Next Steps

1. **Start with Phase 1** - Build foundation with selection system and masks
2. **Create tool architecture** - Abstract base classes for tool types
3. **Implement WebGL/WebGPU shaders** - For filter processing performance
4. **Build UI components** - Inspector panels for new features
5. **Add keyboard shortcuts** - Standard Photoshop shortcuts where possible
6. **Write tests** - Unit tests for algorithms, integration tests for tools

---

## Resources

- [Adobe Photoshop User Guide](https://helpx.adobe.com/photoshop/user-guide.html)
- [Photoshop Blend Mode Math](https://www.w3.org/TR/compositing-1/#blending)
- [Image Processing Algorithms](https://homepages.inf.ed.ac.uk/rbf/HIPR2/)
- [WebGL Fundamentals](https://webglfundamentals.org/)
