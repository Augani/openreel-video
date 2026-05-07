import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLACK_WHITE,
  DEFAULT_BLEND_MODE,
  DEFAULT_COLOR_BALANCE,
  DEFAULT_CURVES,
  DEFAULT_CHANNEL_MIXER,
  DEFAULT_FILTER,
  DEFAULT_GRADIENT_MAP,
  DEFAULT_GLOW,
  DEFAULT_INNER_SHADOW,
  DEFAULT_LEVELS,
  DEFAULT_PHOTO_FILTER,
  DEFAULT_POSTERIZE,
  DEFAULT_SELECTIVE_COLOR,
  DEFAULT_SHADOW,
  DEFAULT_SHAPE_STYLE,
  DEFAULT_STROKE,
  DEFAULT_TEXT_STYLE,
  DEFAULT_THRESHOLD,
  DEFAULT_TRANSFORM,
  type GroupLayer,
  type ShapeLayer,
  type TextLayer,
} from './project';
import {
  addLayerToProject,
  createProjectDocument,
  deserializeProject,
  duplicateLayerInProject,
  removeLayerFromProject,
  reorderArtboardLayers,
  serializeProject,
  updateLayerInProject,
  validateLayerTree,
} from './operations';

const DEFAULT_SIZE = { width: 1080, height: 1080 };
const DEFAULT_BG = { type: 'color' as const, color: '#ffffff' };

function createTextLayer(id: string, name = 'Text'): TextLayer {
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

function createShapeLayer(id: string, parentId: string | null = null): ShapeLayer {
  return {
    id,
    name: 'Shape',
    type: 'shape',
    visible: true,
    locked: false,
    transform: { ...DEFAULT_TRANSFORM },
    blendMode: { ...DEFAULT_BLEND_MODE },
    shadow: { ...DEFAULT_SHADOW },
    innerShadow: { ...DEFAULT_INNER_SHADOW },
    stroke: { ...DEFAULT_STROKE },
    glow: { ...DEFAULT_GLOW },
    filters: { ...DEFAULT_FILTER },
    parentId,
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

function createGroupLayer(id: string, childIds: string[]): GroupLayer {
  return {
    id,
    name: 'Group',
    type: 'group',
    visible: true,
    locked: false,
    transform: { ...DEFAULT_TRANSFORM },
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
    childIds,
    expanded: true,
  };
}

describe('image-core document operations', () => {
  it('serializes and deserializes a valid project document', () => {
    const project = createProjectDocument({
      id: 'project-1',
      artboardId: 'artboard-1',
      name: 'Document',
      size: DEFAULT_SIZE,
      background: DEFAULT_BG,
      timestamp: 1,
    });

    const withLayer = addLayerToProject(project, 'artboard-1', createTextLayer('layer-1'), 0, 2);
    const serialized = serializeProject(withLayer);
    const parsed = deserializeProject(serialized);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.layers['layer-1']?.type).toBe('text');
      expect(parsed.data.updatedAt).toBe(2);
    }
  });

  it('duplicates, reorders, and removes layers without mutating the original project', () => {
    const project = createProjectDocument({
      id: 'project-1',
      artboardId: 'artboard-1',
      name: 'Document',
      size: DEFAULT_SIZE,
      background: DEFAULT_BG,
      timestamp: 1,
    });

    const withFirst = addLayerToProject(project, 'artboard-1', createTextLayer('layer-1'), 0, 2);
    const withSecond = addLayerToProject(withFirst, 'artboard-1', createTextLayer('layer-2'), 0, 3);
    const duplicated = duplicateLayerInProject(withSecond, 'artboard-1', 'layer-2', 'layer-3');

    expect(duplicated).not.toBeNull();
    expect(withSecond.artboards[0]?.layerIds).toEqual(['layer-2', 'layer-1']);

    const reordered = reorderArtboardLayers(
      duplicated!.project,
      'artboard-1',
      ['layer-1', 'layer-2', 'layer-3'],
      4,
    );
    const removed = removeLayerFromProject(reordered, 'layer-2', 5);

    expect(reordered.artboards[0]?.layerIds).toEqual(['layer-1', 'layer-2', 'layer-3']);
    expect(removed.artboards[0]?.layerIds).toEqual(['layer-1', 'layer-3']);
    expect(removed.layers['layer-2']).toBeUndefined();
    expect(duplicated!.project.layers['layer-2']).toBeDefined();
  });

  it('ignores prototype-polluting keys during layer updates', () => {
    const project = createProjectDocument({
      id: 'project-1',
      artboardId: 'artboard-1',
      name: 'Document',
      size: DEFAULT_SIZE,
      background: DEFAULT_BG,
      timestamp: 1,
    });

    const withLayer = addLayerToProject(project, 'artboard-1', createTextLayer('layer-1'), 0, 2);
    const updated = updateLayerInProject(
      withLayer,
      'layer-1',
      JSON.parse('{"__proto__":{"polluted":true},"name":"Renamed"}') as never,
      3,
    );

    expect(updated.layers['layer-1']?.name).toBe('Renamed');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('reports invalid layer tree invariants', () => {
    const project = createProjectDocument({
      id: 'project-1',
      artboardId: 'artboard-1',
      name: 'Document',
      size: DEFAULT_SIZE,
      background: DEFAULT_BG,
      timestamp: 1,
    });

    const child = createShapeLayer('child-1', 'group-1');
    const group = createGroupLayer('group-1', ['missing-child']);

    const broken = addLayerToProject(
      addLayerToProject(project, 'artboard-1', group, 0, 2),
      'artboard-1',
      child,
      1,
      3,
    );
    broken.activeArtboardId = 'missing-artboard';

    expect(validateLayerTree(broken)).toEqual(
      expect.arrayContaining([
        'Active artboard "missing-artboard" does not exist.',
        'Group "group-1" references missing child "missing-child".',
      ]),
    );
  });
});
