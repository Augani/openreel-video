import { describe, expect, it } from 'vitest';
import { parseProject } from './schema';

const baseLayer = {
  id: 'layer-1',
  name: 'Layer 1',
  visible: true,
  locked: false,
  transform: {
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
  },
  blendMode: { mode: 'normal' as const },
  shadow: { enabled: false, color: 'rgba(0,0,0,0.5)', blur: 10, offsetX: 0, offsetY: 4 },
  innerShadow: { enabled: false, color: 'rgba(0,0,0,0.5)', blur: 10, offsetX: 2, offsetY: 2 },
  stroke: { enabled: false, color: '#000000', width: 1, style: 'solid' as const },
  glow: { enabled: false, color: '#ffffff', blur: 20, intensity: 1 },
  filters: {
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
    blurType: 'gaussian' as const,
    blurAngle: 0,
    sharpen: 0,
    vignette: 0,
    grain: 0,
    sepia: 0,
    invert: 0,
  },
  parentId: null,
  flipHorizontal: false,
  flipVertical: false,
  mask: null,
  clippingMask: false,
  levels: {
    enabled: false,
    master: { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 },
    red: { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 },
    green: { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 },
    blue: { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 },
  },
  curves: {
    enabled: false,
    master: { points: [{ input: 0, output: 0 }, { input: 255, output: 255 }] },
    red: { points: [{ input: 0, output: 0 }, { input: 255, output: 255 }] },
    green: { points: [{ input: 0, output: 0 }, { input: 255, output: 255 }] },
    blue: { points: [{ input: 0, output: 0 }, { input: 255, output: 255 }] },
  },
  colorBalance: {
    enabled: false,
    shadows: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
    midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
    highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
    preserveLuminosity: true,
  },
  selectiveColor: {
    enabled: false,
    method: 'relative' as const,
    reds: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    yellows: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    greens: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    cyans: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    blues: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    magentas: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    whites: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    neutrals: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    blacks: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
  },
  blackWhite: {
    enabled: false,
    reds: 40,
    yellows: 60,
    greens: 40,
    cyans: 60,
    blues: 20,
    magentas: 80,
    tintEnabled: false,
    tintHue: 35,
    tintSaturation: 25,
  },
  photoFilter: {
    enabled: false,
    filter: 'warming-85' as const,
    color: '#ec8a00',
    density: 25,
    preserveLuminosity: true,
  },
  channelMixer: {
    enabled: false,
    monochrome: false,
    red: { red: 100, green: 0, blue: 0, constant: 0 },
    green: { red: 0, green: 100, blue: 0, constant: 0 },
    blue: { red: 0, green: 0, blue: 100, constant: 0 },
  },
  gradientMap: {
    enabled: false,
    stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
    reverse: false,
    dither: false,
  },
  posterize: { enabled: false, levels: 4 },
  threshold: { enabled: false, level: 128 },
};

describe('ProjectSchema', () => {
  it('accepts smart object layers and export presets', () => {
    const result = parseProject({
      id: 'project-1',
      name: 'Smart Object Project',
      createdAt: 1,
      updatedAt: 1,
      version: 1,
      artboards: [
        {
          id: 'artboard-1',
          name: 'Artboard 1',
          size: { width: 1200, height: 800 },
          background: { type: 'transparent' },
          layerIds: ['layer-1'],
          position: { x: 0, y: 0 },
        },
      ],
      layers: {
        'layer-1': {
          ...baseLayer,
          type: 'smart-object',
          sourceProjectId: 'linked-project-1',
        },
      },
      assets: {},
      exportPresets: [
        {
          id: 'preset-1',
          name: 'Review PNG',
          format: 'png',
          quality: 100,
          scale: 2,
          artboardFilter: {
            mode: 'include',
            artboardIds: ['artboard-1'],
          },
          backgroundMode: 'transparent',
        },
      ],
      activeArtboardId: 'artboard-1',
    });

    expect(result.success).toBe(true);
  });

  it('defaults missing export presets to an empty array', () => {
    const result = parseProject({
      id: 'project-1',
      name: 'Legacy Project',
      createdAt: 1,
      updatedAt: 1,
      version: 1,
      artboards: [],
      layers: {},
      assets: {},
      activeArtboardId: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exportPresets).toEqual([]);
    }
  });

  it('rejects a smart object layer without a source reference', () => {
    const result = parseProject({
      id: 'project-1',
      name: 'Invalid Smart Object Project',
      createdAt: 1,
      updatedAt: 1,
      version: 1,
      artboards: [
        {
          id: 'artboard-1',
          name: 'Artboard 1',
          size: { width: 1200, height: 800 },
          background: { type: 'transparent' },
          layerIds: ['layer-1'],
          position: { x: 0, y: 0 },
        },
      ],
      layers: {
        'layer-1': {
          ...baseLayer,
          type: 'smart-object',
        },
      },
      assets: {},
      exportPresets: [],
      activeArtboardId: 'artboard-1',
    });

    expect(result.success).toBe(false);
  });
});
