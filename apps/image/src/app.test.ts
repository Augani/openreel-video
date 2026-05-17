import { describe, it, expect } from 'vitest';
import { parseProject } from './services/project-schema';
import { migrateProject, CURRENT_VERSION } from './services/project-migration';

// ── App smoke tests ──────────────────────────────────────────────────────────
//
// These tests exercise the integration seam between the project schema,
// migration utilities, and the store to confirm the whole pipeline is wired up
// and importing correctly.

describe('OpenReel Image – baseline smoke tests', () => {
  // Schema is importable.
  it('project schema module is importable', () => {
    expect(typeof parseProject).toBe('function');
  });

  // Migration is importable and exposes the current version constant.
  it('migration module exposes CURRENT_VERSION', () => {
    expect(typeof CURRENT_VERSION).toBe('number');
    expect(CURRENT_VERSION).toBeGreaterThanOrEqual(1);
  });

  // A minimal valid project document passes schema validation.
  it('validates a minimal valid project', () => {
    const baseLayer = {
      id: 'l1',
      name: 'Layer',
      type: 'text' as const,
      visible: true,
      locked: false,
      transform: {
        x: 0, y: 0, width: 200, height: 50, rotation: 0,
        scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, opacity: 1,
      },
      blendMode: { mode: 'normal' as const },
      shadow: { enabled: false, color: 'rgba(0,0,0,0.5)', blur: 10, offsetX: 0, offsetY: 4 },
      innerShadow: { enabled: false, color: 'rgba(0,0,0,0.5)', blur: 10, offsetX: 2, offsetY: 2 },
      stroke: { enabled: false, color: '#000000', width: 1, style: 'solid' as const },
      glow: { enabled: false, color: '#ffffff', blur: 20, intensity: 1 },
      filters: {
        brightness: 100, contrast: 100, saturation: 100, hue: 0, exposure: 0,
        vibrance: 0, highlights: 0, shadows: 0, clarity: 0, blur: 0,
        blurType: 'gaussian' as const, blurAngle: 0, sharpen: 0, vignette: 0,
        grain: 0, sepia: 0, invert: 0,
      },
      parentId: null,
      flipHorizontal: false,
      flipVertical: false,
      mask: null,
      clippingMask: false,
      levels: {
        enabled: false,
        master: { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 },
        red:    { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 },
        green:  { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 },
        blue:   { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 },
      },
      curves: {
        enabled: false,
        master: { points: [{ input: 0, output: 0 }, { input: 255, output: 255 }] },
        red:    { points: [{ input: 0, output: 0 }, { input: 255, output: 255 }] },
        green:  { points: [{ input: 0, output: 0 }, { input: 255, output: 255 }] },
        blue:   { points: [{ input: 0, output: 0 }, { input: 255, output: 255 }] },
      },
      colorBalance: {
        enabled: false,
        shadows:    { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
        midtones:   { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
        highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
        preserveLuminosity: true,
      },
      selectiveColor: {
        enabled: false, method: 'relative' as const,
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
        enabled: false, reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20,
        magentas: 80, tintEnabled: false, tintHue: 35, tintSaturation: 25,
      },
      photoFilter: {
        enabled: false, filter: 'warming-85' as const, color: '#ec8a00',
        density: 25, preserveLuminosity: true,
      },
      channelMixer: {
        enabled: false, monochrome: false,
        red:   { red: 100, green: 0, blue: 0, constant: 0 },
        green: { red: 0, green: 100, blue: 0, constant: 0 },
        blue:  { red: 0, green: 0, blue: 100, constant: 0 },
      },
      gradientMap: {
        enabled: false,
        stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
        reverse: false, dither: false,
      },
      posterize: { enabled: false, levels: 4 },
      threshold: { enabled: false, level: 128 },
      content: 'Hello',
      style: {
        fontFamily: 'Inter', fontSize: 24, fontWeight: 400,
        fontStyle: 'normal' as const, textDecoration: 'none' as const,
        textAlign: 'left' as const, verticalAlign: 'top' as const,
        lineHeight: 1.4, letterSpacing: 0, fillType: 'solid' as const,
        color: '#ffffff', gradient: null, strokeColor: null, strokeWidth: 0,
        backgroundColor: null, backgroundPadding: 8, backgroundRadius: 4,
        textShadow: { enabled: false, color: 'rgba(0,0,0,0.5)', blur: 4, offsetX: 0, offsetY: 2 },
      },
      autoSize: true,
    };

    const validProject = {
      id: 'p1',
      name: 'Smoke Test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      artboards: [
        {
          id: 'ab1',
          name: 'Artboard 1',
          size: { width: 1080, height: 1080 },
          background: { type: 'color', color: '#ffffff' },
          layerIds: ['l1'],
          position: { x: 0, y: 0 },
        },
      ],
      layers: { l1: baseLayer },
      assets: {},
      activeArtboardId: 'ab1',
    };

    const result = parseProject(validProject);
    expect(result.success).toBe(true);
  });

  // An invalid document is rejected.
  it('rejects an invalid project document', () => {
    const result = parseProject({ id: 42, broken: true });
    expect(result.success).toBe(false);
  });

  // Migration promotes a v0 document to v1.
  it('migrates a v0 project to v1', () => {
    const v0 = {
      id: 'old',
      name: 'Legacy',
      createdAt: 0,
      updatedAt: 0,
      artboards: [{ id: 'ab-old', name: 'Page 1' }],
      layers: {},
      assets: {},
    };

    const migrated = migrateProject(v0 as Record<string, unknown>);
    expect(migrated.version).toBe(1);
    expect(migrated.activeArtboardId).toBe('ab-old');
  });

  // A project that already has version 1 is returned unchanged.
  it('does not re-migrate a current-version project', () => {
    const v1 = {
      id: 'current',
      name: 'New',
      createdAt: 0,
      updatedAt: 0,
      version: 1,
      artboards: [],
      layers: {},
      assets: {},
      activeArtboardId: null,
    };

    const migrated = migrateProject(v1 as Record<string, unknown>);
    expect(migrated.version).toBe(1);
  });
});

