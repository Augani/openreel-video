import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLEND_MODE,
  DEFAULT_CURVES,
  DEFAULT_FILTER,
  DEFAULT_GLOW,
  DEFAULT_INNER_SHADOW,
  DEFAULT_LEVELS,
  DEFAULT_SHAPE_STYLE,
  DEFAULT_SHADOW,
  DEFAULT_STROKE,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRANSFORM,
  DEFAULT_COLOR_BALANCE,
  DEFAULT_SELECTIVE_COLOR,
  DEFAULT_BLACK_WHITE,
  DEFAULT_PHOTO_FILTER,
  DEFAULT_CHANNEL_MIXER,
  DEFAULT_GRADIENT_MAP,
  DEFAULT_POSTERIZE,
  DEFAULT_THRESHOLD,
  type GroupLayer,
  type ShapeLayer,
  type TextLayer,
} from './project';
import { DEFAULT_LAYER_MASK } from './mask';
import { createProjectDocument } from './operations';
import {
  AddArtboardCommand,
  AddLayerCommand,
  ApplyAdjustmentCommand,
  ApplyMaskCommand,
  DuplicateLayerCommand,
  GroupLayersCommand,
  PasteLayersCommand,
  RasterEditCommand,
  RemoveArtboardCommand,
  RemoveLayerCommand,
  ReorderLayerCommand,
  SetProjectNameCommand,
  UngroupLayersCommand,
  UpdateArtboardCommand,
  UpdateLayerStyleCommand,
  UpdateLayerTransformCommand,
  UpdateTextCommand,
} from './commands';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SIZE = { width: 1080, height: 1080 };
const AB_ID = 'ab-1';

function makeProject() {
  return createProjectDocument({
    id: 'proj-1',
    artboardId: AB_ID,
    name: 'Test',
    size: SIZE,
  });
}

function makeTextLayer(id: string, name = 'Text'): TextLayer {
  return {
    id,
    name,
    type: 'text',
    visible: true,
    locked: false,
    transform: { ...DEFAULT_TRANSFORM, width: 200, height: 50 },
    blendMode: { ...DEFAULT_BLEND_MODE },
    shadow: { ...DEFAULT_SHADOW },
    innerShadow: { ...DEFAULT_INNER_SHADOW },
    stroke: { ...DEFAULT_STROKE },
    glow: { ...DEFAULT_GLOW },
    filters: { ...DEFAULT_FILTER },
    parentId: null,
    flipHorizontal: false,
    flipVertical: false,
    mask: null,
    clippingMask: false,
    levels: { ...DEFAULT_LEVELS },
    curves: { ...DEFAULT_CURVES },
    colorBalance: { ...DEFAULT_COLOR_BALANCE },
    selectiveColor: { ...DEFAULT_SELECTIVE_COLOR },
    blackWhite: { ...DEFAULT_BLACK_WHITE },
    photoFilter: { ...DEFAULT_PHOTO_FILTER },
    channelMixer: { ...DEFAULT_CHANNEL_MIXER },
    gradientMap: { ...DEFAULT_GRADIENT_MAP },
    posterize: { ...DEFAULT_POSTERIZE },
    threshold: { ...DEFAULT_THRESHOLD },
    content: name,
    style: { ...DEFAULT_TEXT_STYLE },
    autoSize: true,
  };
}

function makeShapeLayer(id: string): ShapeLayer {
  return {
    id,
    name: 'Shape',
    type: 'shape',
    visible: true,
    locked: false,
    transform: { ...DEFAULT_TRANSFORM, x: 10, y: 20, width: 100, height: 100 },
    blendMode: { ...DEFAULT_BLEND_MODE },
    shadow: { ...DEFAULT_SHADOW },
    innerShadow: { ...DEFAULT_INNER_SHADOW },
    stroke: { ...DEFAULT_STROKE },
    glow: { ...DEFAULT_GLOW },
    filters: { ...DEFAULT_FILTER },
    parentId: null,
    flipHorizontal: false,
    flipVertical: false,
    mask: null,
    clippingMask: false,
    levels: { ...DEFAULT_LEVELS },
    curves: { ...DEFAULT_CURVES },
    colorBalance: { ...DEFAULT_COLOR_BALANCE },
    selectiveColor: { ...DEFAULT_SELECTIVE_COLOR },
    blackWhite: { ...DEFAULT_BLACK_WHITE },
    photoFilter: { ...DEFAULT_PHOTO_FILTER },
    channelMixer: { ...DEFAULT_CHANNEL_MIXER },
    gradientMap: { ...DEFAULT_GRADIENT_MAP },
    posterize: { ...DEFAULT_POSTERIZE },
    threshold: { ...DEFAULT_THRESHOLD },
    shapeType: 'rectangle',
    shapeStyle: { ...DEFAULT_SHAPE_STYLE },
  };
}

// ── Helper: apply then invert ─────────────────────────────────────────────────

/**
 * Applies cmd to project, then applies the inverse to the result.
 * The final project should equal the original (deep-equal data).
 */
function roundTrip<T>(project: T, cmd: { apply: (p: T) => T; invert: () => { apply: (p: T) => T } }): T {
  const after = cmd.apply(project);
  const inverse = cmd.invert();
  return inverse.apply(after);
}

// ── SetProjectNameCommand ─────────────────────────────────────────────────────

describe('SetProjectNameCommand', () => {
  it('renames the project', () => {
    const project = makeProject();
    const cmd = new SetProjectNameCommand('New Name', 'Test');
    const next = cmd.apply(project);
    expect(next.name).toBe('New Name');
  });

  it('inverse restores the original name', () => {
    const project = makeProject();
    const cmd = new SetProjectNameCommand('New Name', 'Test');
    const restored = roundTrip(project, cmd);
    expect(restored.name).toBe('Test');
  });

  it('has a descriptive description', () => {
    const cmd = new SetProjectNameCommand('Foo', 'Bar');
    expect(cmd.description).toMatch(/Foo/);
  });
});

// ── AddArtboardCommand ────────────────────────────────────────────────────────

describe('AddArtboardCommand', () => {
  it('adds an artboard to the project', () => {
    const project = makeProject();
    const artboard = { id: 'ab-2', name: 'Page 2', size: SIZE, background: { type: 'color' as const, color: '#fff' }, layerIds: [], position: { x: 0, y: 0 } };
    const cmd = new AddArtboardCommand(artboard);
    const next = cmd.apply(project);
    expect(next.artboards).toHaveLength(2);
    expect(next.artboards.find((a) => a.id === 'ab-2')).toBeDefined();
  });

  it('inverse removes the artboard', () => {
    const project = makeProject();
    const artboard = { id: 'ab-2', name: 'Page 2', size: SIZE, background: { type: 'color' as const, color: '#fff' }, layerIds: [], position: { x: 0, y: 0 } };
    const cmd = new AddArtboardCommand(artboard);
    const restored = roundTrip(project, cmd);
    expect(restored.artboards).toHaveLength(1);
    expect(restored.artboards.find((a) => a.id === 'ab-2')).toBeUndefined();
  });
});

// ── RemoveArtboardCommand ─────────────────────────────────────────────────────

describe('RemoveArtboardCommand', () => {
  it('removes the artboard from the project', () => {
    const base = makeProject();
    const artboard = base.artboards[0];
    const cmd = new RemoveArtboardCommand(AB_ID, artboard, {}, 0);
    const next = cmd.apply(base);
    expect(next.artboards.find((a) => a.id === AB_ID)).toBeUndefined();
  });

  it('inverse restores the artboard', () => {
    const project = makeProject();
    const artboard = project.artboards[0];
    const cmd = new RemoveArtboardCommand(AB_ID, artboard, {}, 0);
    const restored = roundTrip(project, cmd);
    expect(restored.artboards.find((a) => a.id === AB_ID)).toBeDefined();
  });

  it('inverse restores removed layers', () => {
    let project = makeProject();
    const layer = makeTextLayer('l-1');
    const addCmd = new AddLayerCommand(AB_ID, layer, 0);
    project = addCmd.apply(project);

    const artboard = project.artboards[0];
    const removedLayers = { 'l-1': project.layers['l-1'] };
    const cmd = new RemoveArtboardCommand(AB_ID, artboard, removedLayers, 0);
    const after = cmd.apply(project);
    expect(after.layers['l-1']).toBeUndefined();

    const restored = cmd.invert().apply(after);
    expect(restored.layers['l-1']).toBeDefined();
  });
});

// ── UpdateArtboardCommand ─────────────────────────────────────────────────────

describe('UpdateArtboardCommand', () => {
  it('updates artboard fields', () => {
    const project = makeProject();
    const cmd = new UpdateArtboardCommand(AB_ID, { name: 'Renamed' }, { name: 'Artboard 1' });
    const next = cmd.apply(project);
    expect(next.artboards[0].name).toBe('Renamed');
  });

  it('inverse restores original fields', () => {
    const project = makeProject();
    const cmd = new UpdateArtboardCommand(AB_ID, { name: 'Renamed' }, { name: project.artboards[0].name });
    const restored = roundTrip(project, cmd);
    expect(restored.artboards[0].name).toBe('Artboard 1');
  });
});

// ── AddLayerCommand ───────────────────────────────────────────────────────────

describe('AddLayerCommand', () => {
  it('adds a layer to the artboard', () => {
    const project = makeProject();
    const layer = makeTextLayer('l-1');
    const cmd = new AddLayerCommand(AB_ID, layer, 0);
    const next = cmd.apply(project);
    expect(next.layers['l-1']).toBeDefined();
    expect(next.artboards[0].layerIds).toContain('l-1');
  });

  it('inverse removes the layer', () => {
    const project = makeProject();
    const layer = makeTextLayer('l-1');
    const cmd = new AddLayerCommand(AB_ID, layer, 0);
    const restored = roundTrip(project, cmd);
    expect(restored.layers['l-1']).toBeUndefined();
    expect(restored.artboards[0].layerIds).not.toContain('l-1');
  });

  it('has a descriptive description', () => {
    const layer = makeTextLayer('l-1', 'My Text');
    const cmd = new AddLayerCommand(AB_ID, layer, 0);
    expect(cmd.description).toMatch(/text/i);
    expect(cmd.description).toMatch(/My Text/);
  });
});

// ── RemoveLayerCommand ────────────────────────────────────────────────────────

describe('RemoveLayerCommand', () => {
  it('removes a layer from the project', () => {
    let project = makeProject();
    const layer = makeTextLayer('l-1');
    project = new AddLayerCommand(AB_ID, layer, 0).apply(project);

    const cmd = new RemoveLayerCommand('l-1', AB_ID, layer, 0);
    const next = cmd.apply(project);
    expect(next.layers['l-1']).toBeUndefined();
  });

  it('inverse restores the layer at the correct index', () => {
    let project = makeProject();
    const layer = makeTextLayer('l-1');
    project = new AddLayerCommand(AB_ID, layer, 0).apply(project);

    const cmd = new RemoveLayerCommand('l-1', AB_ID, layer, 0);
    const after = cmd.apply(project);
    const restored = cmd.invert().apply(after);
    expect(restored.layers['l-1']).toBeDefined();
    expect(restored.artboards[0].layerIds).toContain('l-1');
  });
});

// ── DuplicateLayerCommand ─────────────────────────────────────────────────────

describe('DuplicateLayerCommand', () => {
  it('adds the duplicated layer to the artboard', () => {
    const project = makeProject();
    const dup = makeTextLayer('dup-1', 'Original copy');
    const cmd = new DuplicateLayerCommand(AB_ID, dup, 0);
    const next = cmd.apply(project);
    expect(next.layers['dup-1']).toBeDefined();
  });

  it('inverse removes the duplicate', () => {
    const project = makeProject();
    const dup = makeTextLayer('dup-1', 'Original copy');
    const cmd = new DuplicateLayerCommand(AB_ID, dup, 0);
    const restored = roundTrip(project, cmd);
    expect(restored.layers['dup-1']).toBeUndefined();
  });
});

// ── ReorderLayerCommand ───────────────────────────────────────────────────────

describe('ReorderLayerCommand', () => {
  it('reorders artboard layer IDs', () => {
    let project = makeProject();
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-1'), 0).apply(project);
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-2'), 0).apply(project);
    // current: ['l-2', 'l-1']

    const cmd = new ReorderLayerCommand(AB_ID, ['l-1', 'l-2'], ['l-2', 'l-1']);
    const next = cmd.apply(project);
    expect(next.artboards[0].layerIds).toEqual(['l-1', 'l-2']);
  });

  it('inverse restores the original order', () => {
    let project = makeProject();
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-1'), 0).apply(project);
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-2'), 0).apply(project);
    const prev = project.artboards[0].layerIds;

    const cmd = new ReorderLayerCommand(AB_ID, ['l-1', 'l-2'], [...prev]);
    const after = cmd.apply(project);
    const restored = cmd.invert().apply(after);
    expect(restored.artboards[0].layerIds).toEqual(prev);
  });
});

// ── UpdateLayerTransformCommand ───────────────────────────────────────────────

describe('UpdateLayerTransformCommand', () => {
  it('applies the new transform', () => {
    let project = makeProject();
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-1'), 0).apply(project);

    const cmd = new UpdateLayerTransformCommand('l-1', { x: 100, y: 200 }, { x: 0, y: 0 });
    const next = cmd.apply(project);
    expect(next.layers['l-1'].transform.x).toBe(100);
    expect(next.layers['l-1'].transform.y).toBe(200);
  });

  it('inverse restores the old transform', () => {
    let project = makeProject();
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-1'), 0).apply(project);

    const cmd = new UpdateLayerTransformCommand('l-1', { x: 100, y: 200 }, { x: 0, y: 0 });
    const restored = roundTrip(project, cmd);
    expect(restored.layers['l-1'].transform.x).toBe(0);
    expect(restored.layers['l-1'].transform.y).toBe(0);
  });

  it('merges consecutive transform commands on the same layer', () => {
    let project = makeProject();
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-1'), 0).apply(project);

    const cmd1 = new UpdateLayerTransformCommand('l-1', { x: 50 }, { x: 0 });
    const cmd2 = new UpdateLayerTransformCommand('l-1', { x: 100 }, { x: 50 });
    const merged = cmd1.merge!(cmd2);

    expect(merged).not.toBeNull();
    const next = merged!.apply(project);
    expect(next.layers['l-1'].transform.x).toBe(100);

    // Undoing the merged command returns to original x=0
    const restored = merged!.invert().apply(next);
    expect(restored.layers['l-1'].transform.x).toBe(0);
  });

  it('does not merge transform commands on different layers', () => {
    const cmd1 = new UpdateLayerTransformCommand('l-1', { x: 50 }, { x: 0 });
    const cmd2 = new UpdateLayerTransformCommand('l-2', { x: 50 }, { x: 0 });
    expect(cmd1.merge!(cmd2)).toBeNull();
  });
});

// ── UpdateLayerStyleCommand ───────────────────────────────────────────────────

describe('UpdateLayerStyleCommand', () => {
  it('applies style updates', () => {
    let project = makeProject();
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-1'), 0).apply(project);

    const cmd = new UpdateLayerStyleCommand(
      'l-1',
      { visible: false },
      { visible: true },
    );
    const next = cmd.apply(project);
    expect(next.layers['l-1'].visible).toBe(false);
  });

  it('inverse restores original style', () => {
    let project = makeProject();
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-1'), 0).apply(project);

    const cmd = new UpdateLayerStyleCommand('l-1', { visible: false }, { visible: true });
    const restored = roundTrip(project, cmd);
    expect(restored.layers['l-1'].visible).toBe(true);
  });

  it('merges style updates on the same layer', () => {
    let project = makeProject();
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-1'), 0).apply(project);

    const cmd1 = new UpdateLayerStyleCommand('l-1', { visible: false }, { visible: true });
    const cmd2 = new UpdateLayerStyleCommand('l-1', { locked: true }, { locked: false });
    const merged = cmd1.merge!(cmd2);
    expect(merged).not.toBeNull();

    const next = merged!.apply(project);
    expect(next.layers['l-1'].visible).toBe(false);
    expect(next.layers['l-1'].locked).toBe(true);

    const restored = merged!.invert().apply(next);
    expect(restored.layers['l-1'].visible).toBe(true);
    expect(restored.layers['l-1'].locked).toBe(false);
  });
});

// ── UpdateTextCommand ─────────────────────────────────────────────────────────

describe('UpdateTextCommand', () => {
  it('updates text content', () => {
    let project = makeProject();
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-1', 'Hello'), 0).apply(project);

    const cmd = new UpdateTextCommand('l-1', 'World', 'Hello', null, null);
    const next = cmd.apply(project);
    expect((next.layers['l-1'] as TextLayer).content).toBe('World');
  });

  it('inverse restores the previous content', () => {
    let project = makeProject();
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-1', 'Hello'), 0).apply(project);

    const cmd = new UpdateTextCommand('l-1', 'World', 'Hello', null, null);
    const restored = roundTrip(project, cmd);
    expect((restored.layers['l-1'] as TextLayer).content).toBe('Hello');
  });

  it('merges consecutive text edits on the same layer', () => {
    let project = makeProject();
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-1', 'A'), 0).apply(project);

    const cmd1 = new UpdateTextCommand('l-1', 'AB', 'A', null, null);
    const cmd2 = new UpdateTextCommand('l-1', 'ABC', 'AB', null, null);
    const merged = cmd1.merge!(cmd2)!;
    expect(merged).not.toBeNull();

    const next = merged.apply(project);
    expect((next.layers['l-1'] as TextLayer).content).toBe('ABC');

    const restored = merged.invert().apply(next);
    expect((restored.layers['l-1'] as TextLayer).content).toBe('A');
  });
});

// ── ApplyAdjustmentCommand ────────────────────────────────────────────────────

describe('ApplyAdjustmentCommand', () => {
  it('applies an adjustment value', () => {
    let project = makeProject();
    const layer = makeShapeLayer('l-1');
    project = new AddLayerCommand(AB_ID, layer, 0).apply(project);

    const cmd = new ApplyAdjustmentCommand('l-1', 'visible', false, true);
    const next = cmd.apply(project);
    expect(next.layers['l-1'].visible).toBe(false);
  });

  it('inverse restores the original adjustment value', () => {
    let project = makeProject();
    const layer = makeShapeLayer('l-1');
    project = new AddLayerCommand(AB_ID, layer, 0).apply(project);

    const cmd = new ApplyAdjustmentCommand('l-1', 'visible', false, true);
    const restored = roundTrip(project, cmd);
    expect(restored.layers['l-1'].visible).toBe(true);
  });

  it('merges same adjustment on same layer', () => {
    let project = makeProject();
    project = new AddLayerCommand(AB_ID, makeShapeLayer('l-1'), 0).apply(project);

    const cmd1 = new ApplyAdjustmentCommand('l-1', 'visible', false, true);
    const cmd2 = new ApplyAdjustmentCommand('l-1', 'visible', true, false);
    const merged = cmd1.merge!(cmd2)!;
    expect(merged).not.toBeNull();

    const next = merged.apply(project);
    expect(next.layers['l-1'].visible).toBe(true);

    const restored = merged.invert().apply(next);
    expect(restored.layers['l-1'].visible).toBe(true); // original was true
  });

  it('does not merge different adjustments', () => {
    const cmd1 = new ApplyAdjustmentCommand('l-1', 'visible', false, true);
    const cmd2 = new ApplyAdjustmentCommand('l-1', 'locked', true, false);
    expect(cmd1.merge!(cmd2)).toBeNull();
  });
});

// ── ApplyMaskCommand ──────────────────────────────────────────────────────────

describe('ApplyMaskCommand', () => {
  it('applies a mask to the layer', () => {
    let project = makeProject();
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-1'), 0).apply(project);

    const mask = { ...DEFAULT_LAYER_MASK, id: 'mask-1', type: 'vector' as const };
    const cmd = new ApplyMaskCommand('l-1', mask, null);
    const next = cmd.apply(project);
    expect(next.layers['l-1'].mask).toEqual(mask);
  });

  it('inverse removes the mask', () => {
    let project = makeProject();
    project = new AddLayerCommand(AB_ID, makeTextLayer('l-1'), 0).apply(project);

    const mask = { ...DEFAULT_LAYER_MASK, id: 'mask-1', type: 'vector' as const };
    const cmd = new ApplyMaskCommand('l-1', mask, null);
    const restored = roundTrip(project, cmd);
    expect(restored.layers['l-1'].mask).toBeNull();
  });

  it('description mentions "Apply mask" when setting a mask', () => {
    const mask = { ...DEFAULT_LAYER_MASK, id: 'mask-1' };
    const cmd = new ApplyMaskCommand('l-1', mask, null);
    expect(cmd.description).toMatch(/apply mask/i);
  });

  it('description mentions "Remove mask" when clearing a mask', () => {
    const mask = { ...DEFAULT_LAYER_MASK, id: 'mask-1' };
    const cmd = new ApplyMaskCommand('l-1', null, mask);
    expect(cmd.description).toMatch(/remove mask/i);
  });
});

// ── RasterEditCommand ─────────────────────────────────────────────────────────

describe('RasterEditCommand', () => {
  it('replaces layer data with after-state', () => {
    let project = makeProject();
    const before = makeShapeLayer('l-1');
    project = new AddLayerCommand(AB_ID, before, 0).apply(project);
    const after = { ...before, name: 'After raster' };

    const cmd = new RasterEditCommand(
      'l-1',
      AB_ID,
      JSON.stringify(after),
      JSON.stringify(before),
    );
    const next = cmd.apply(project);
    expect(next.layers['l-1'].name).toBe('After raster');
  });

  it('inverse restores the before-state', () => {
    let project = makeProject();
    const before = makeShapeLayer('l-1');
    project = new AddLayerCommand(AB_ID, before, 0).apply(project);
    const after = { ...before, name: 'After raster' };

    const cmd = new RasterEditCommand(
      'l-1',
      AB_ID,
      JSON.stringify(after),
      JSON.stringify(before),
    );
    const restored = roundTrip(project, cmd);
    expect(restored.layers['l-1'].name).toBe('Shape');
  });
});

// ── GroupLayersCommand / UngroupLayersCommand ─────────────────────────────────

describe('GroupLayersCommand / UngroupLayersCommand', () => {
  function makeGroupSetup() {
    let project = makeProject();
    const shape1 = makeShapeLayer('s-1');
    const shape2 = makeShapeLayer('s-2');
    project = new AddLayerCommand(AB_ID, shape1, 0).apply(project);
    project = new AddLayerCommand(AB_ID, shape2, 0).apply(project);
    return project;
  }

  it('group adds a group layer containing the children', () => {
    let project = makeGroupSetup();
    const artboard = project.artboards[0];
    const adjustedChildren: Record<string, import('./project').Layer> = {};
    ['s-1', 's-2'].forEach((id) => {
      adjustedChildren[id] = { ...project.layers[id], parentId: 'g-1' };
    });
    const groupLayer: GroupLayer = {
      id: 'g-1',
      name: 'Group',
      type: 'group',
      visible: true,
      locked: false,
      transform: { ...DEFAULT_TRANSFORM, x: 10, y: 20, width: 100, height: 100 },
      blendMode: { ...DEFAULT_BLEND_MODE },
      shadow: { ...DEFAULT_SHADOW },
      innerShadow: { ...DEFAULT_INNER_SHADOW },
      stroke: { ...DEFAULT_STROKE },
      glow: { ...DEFAULT_GLOW },
      filters: { ...DEFAULT_FILTER },
      parentId: null,
      flipHorizontal: false,
      flipVertical: false,
      mask: null,
      clippingMask: false,
      levels: { ...DEFAULT_LEVELS },
      curves: { ...DEFAULT_CURVES },
      colorBalance: { ...DEFAULT_COLOR_BALANCE },
      selectiveColor: { ...DEFAULT_SELECTIVE_COLOR },
      blackWhite: { ...DEFAULT_BLACK_WHITE },
      photoFilter: { ...DEFAULT_PHOTO_FILTER },
      channelMixer: { ...DEFAULT_CHANNEL_MIXER },
      gradientMap: { ...DEFAULT_GRADIENT_MAP },
      posterize: { ...DEFAULT_POSTERIZE },
      threshold: { ...DEFAULT_THRESHOLD },
      childIds: ['s-1', 's-2'],
      expanded: true,
    };
    const cmd = new GroupLayersCommand(AB_ID, groupLayer, 0, [...artboard.layerIds], adjustedChildren);
    const next = cmd.apply(project);
    expect(next.layers['g-1']).toBeDefined();
    expect(next.artboards[0].layerIds).toContain('g-1');
  });

  it('ungroup restores children to artboard', () => {
    let project = makeGroupSetup();
    const artboard = project.artboards[0];
    const adjustedChildren: Record<string, import('./project').Layer> = {};
    ['s-1', 's-2'].forEach((id) => {
      adjustedChildren[id] = { ...project.layers[id], parentId: 'g-1' };
    });
    const groupLayer: GroupLayer = {
      id: 'g-1',
      name: 'Group',
      type: 'group',
      visible: true,
      locked: false,
      transform: { ...DEFAULT_TRANSFORM, x: 10, y: 20, width: 100, height: 100 },
      blendMode: { ...DEFAULT_BLEND_MODE },
      shadow: { ...DEFAULT_SHADOW },
      innerShadow: { ...DEFAULT_INNER_SHADOW },
      stroke: { ...DEFAULT_STROKE },
      glow: { ...DEFAULT_GLOW },
      filters: { ...DEFAULT_FILTER },
      parentId: null,
      flipHorizontal: false,
      flipVertical: false,
      mask: null,
      clippingMask: false,
      levels: { ...DEFAULT_LEVELS },
      curves: { ...DEFAULT_CURVES },
      colorBalance: { ...DEFAULT_COLOR_BALANCE },
      selectiveColor: { ...DEFAULT_SELECTIVE_COLOR },
      blackWhite: { ...DEFAULT_BLACK_WHITE },
      photoFilter: { ...DEFAULT_PHOTO_FILTER },
      channelMixer: { ...DEFAULT_CHANNEL_MIXER },
      gradientMap: { ...DEFAULT_GRADIENT_MAP },
      posterize: { ...DEFAULT_POSTERIZE },
      threshold: { ...DEFAULT_THRESHOLD },
      childIds: ['s-1', 's-2'],
      expanded: true,
    };
    const prevIds = [...artboard.layerIds];
    const groupCmd = new GroupLayersCommand(AB_ID, groupLayer, 0, prevIds, adjustedChildren);
    const grouped = groupCmd.apply(project);

    const ungroupCmd = new UngroupLayersCommand(
      AB_ID,
      'g-1',
      groupLayer,
      prevIds,
      { 's-1': project.layers['s-1'], 's-2': project.layers['s-2'] },
    );
    const ungrouped = ungroupCmd.apply(grouped);
    expect(ungrouped.layers['g-1']).toBeUndefined();
    expect(ungrouped.artboards[0].layerIds).toContain('s-1');
    expect(ungrouped.artboards[0].layerIds).toContain('s-2');
  });
});

// ── PasteLayersCommand ────────────────────────────────────────────────────────

describe('PasteLayersCommand', () => {
  it('pastes layers into the artboard', () => {
    const project = makeProject();
    const pasted = [makeTextLayer('p-1', 'Pasted')];
    const cmd = new PasteLayersCommand(AB_ID, pasted, []);
    const next = cmd.apply(project);
    expect(next.layers['p-1']).toBeDefined();
    expect(next.artboards[0].layerIds).toContain('p-1');
  });

  it('inverse removes the pasted layers', () => {
    const project = makeProject();
    const pasted = [makeTextLayer('p-1', 'Pasted')];
    const cmd = new PasteLayersCommand(AB_ID, pasted, []);
    const restored = roundTrip(project, cmd);
    expect(restored.layers['p-1']).toBeUndefined();
    expect(restored.artboards[0].layerIds).not.toContain('p-1');
  });
});
