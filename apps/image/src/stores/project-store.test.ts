import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './project-store';

const DEFAULT_SIZE = { width: 1080, height: 1080 };
const DEFAULT_BG = { type: 'color' as const, color: '#ffffff' };

/**
 * Reset the store to a pristine state before each test so tests are isolated.
 */
function resetStore() {
  useProjectStore.setState({
    project: null,
    selectedLayerIds: [],
    selectedArtboardId: null,
    copiedLayers: [],
    copiedStyle: null,
    isDirty: false,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function createProject(name = 'Test') {
  useProjectStore.getState().createProject(name, DEFAULT_SIZE, DEFAULT_BG);
  return useProjectStore.getState();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('project-store', () => {
  beforeEach(resetStore);

  // ── Project lifecycle ───────────────────────────────────────────────────

  describe('createProject', () => {
    it('creates a project with the given name', () => {
      createProject('My Design');
      const { project } = useProjectStore.getState();
      expect(project).not.toBeNull();
      expect(project?.name).toBe('My Design');
    });

    it('initialises project with version 1', () => {
      createProject();
      expect(useProjectStore.getState().project?.version).toBe(1);
    });

    it('creates one default artboard', () => {
      createProject();
      const { project } = useProjectStore.getState();
      expect(project?.artboards).toHaveLength(1);
    });

    it('sets the active artboard to the initial artboard', () => {
      createProject();
      const { project, selectedArtboardId } = useProjectStore.getState();
      expect(project?.activeArtboardId).toBe(selectedArtboardId);
    });

    it('starts with an empty layers map', () => {
      createProject();
      expect(useProjectStore.getState().project?.layers).toEqual({});
    });

    it('marks the project as dirty', () => {
      createProject();
      expect(useProjectStore.getState().isDirty).toBe(true);
    });

    it('applies a custom background colour', () => {
      useProjectStore.getState().createProject('bg-test', DEFAULT_SIZE, {
        type: 'color',
        color: '#ff0000',
      });
      const artboard = useProjectStore.getState().project?.artboards[0];
      expect(artboard?.background).toEqual({ type: 'color', color: '#ff0000' });
    });
  });

  describe('loadProject', () => {
    it('loads a valid project', () => {
      createProject('Original');
      const snapshot = useProjectStore.getState().project!;

      resetStore();
      useProjectStore.getState().loadProject(snapshot);

      expect(useProjectStore.getState().project?.name).toBe('Original');
      expect(useProjectStore.getState().isDirty).toBe(false);
    });

    it('rejects a project with missing required fields and keeps state null', () => {
      resetStore();
      // Supply an invalid/incomplete object – loadProject should reject it.
      useProjectStore
        .getState()
        .loadProject({ id: 'bad', name: 'broken' } as never);
      expect(useProjectStore.getState().project).toBeNull();
    });
  });

  describe('closeProject', () => {
    it('clears the project', () => {
      createProject();
      useProjectStore.getState().closeProject();
      expect(useProjectStore.getState().project).toBeNull();
      expect(useProjectStore.getState().isDirty).toBe(false);
    });
  });

  describe('setProjectName', () => {
    it('updates the project name', () => {
      createProject('Old');
      useProjectStore.getState().setProjectName('New');
      expect(useProjectStore.getState().project?.name).toBe('New');
      expect(useProjectStore.getState().isDirty).toBe(true);
    });
  });

  // ── Artboard operations ──────────────────────────────────────────────────

  describe('addArtboard', () => {
    it('adds a second artboard', () => {
      createProject();
      useProjectStore.getState().addArtboard('Page 2', DEFAULT_SIZE);
      expect(useProjectStore.getState().project?.artboards).toHaveLength(2);
    });

    it('returns the new artboard id', () => {
      createProject();
      const id = useProjectStore.getState().addArtboard('Page 2', DEFAULT_SIZE);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('uses the provided position', () => {
      createProject();
      const id = useProjectStore
        .getState()
        .addArtboard('Pos', DEFAULT_SIZE, { x: 200, y: 300 });
      const artboard = useProjectStore
        .getState()
        .project?.artboards.find((a) => a.id === id);
      expect(artboard?.position).toEqual({ x: 200, y: 300 });
    });
  });

  describe('removeArtboard', () => {
    it('removes an artboard when more than one exists', () => {
      createProject();
      const id = useProjectStore.getState().addArtboard('Extra', DEFAULT_SIZE);
      useProjectStore.getState().removeArtboard(id);
      expect(
        useProjectStore.getState().project?.artboards.find((a) => a.id === id),
      ).toBeUndefined();
    });

    it('does not remove the last artboard', () => {
      createProject();
      const { project } = useProjectStore.getState();
      const onlyId = project!.artboards[0].id;
      useProjectStore.getState().removeArtboard(onlyId);
      expect(useProjectStore.getState().project?.artboards).toHaveLength(1);
    });
  });

  describe('updateArtboard', () => {
    it('updates the artboard name', () => {
      createProject();
      const { selectedArtboardId } = useProjectStore.getState();
      useProjectStore
        .getState()
        .updateArtboard(selectedArtboardId!, { name: 'Renamed' });
      const updated = useProjectStore
        .getState()
        .project?.artboards.find((a) => a.id === selectedArtboardId);
      expect(updated?.name).toBe('Renamed');
    });

    it('updates the artboard size', () => {
      createProject();
      const { selectedArtboardId } = useProjectStore.getState();
      const newSize = { width: 800, height: 600 };
      useProjectStore
        .getState()
        .updateArtboard(selectedArtboardId!, { size: newSize });
      const updated = useProjectStore
        .getState()
        .project?.artboards.find((a) => a.id === selectedArtboardId);
      expect(updated?.size).toEqual(newSize);
    });
  });

  // ── Layer operations ──────────────────────────────────────────────────────

  describe('addTextLayer', () => {
    it('adds a text layer to the active artboard', () => {
      createProject();
      useProjectStore.getState().addTextLayer('Hello');
      const { project, selectedArtboardId } = useProjectStore.getState();
      const artboard = project?.artboards.find((a) => a.id === selectedArtboardId);
      expect(artboard?.layerIds).toHaveLength(1);
    });

    it('returns the new layer id', () => {
      createProject();
      const id = useProjectStore.getState().addTextLayer('Hi');
      expect(typeof id).toBe('string');
    });

    it('stores the layer in the layers map', () => {
      createProject();
      const id = useProjectStore.getState().addTextLayer('World');
      const layer = useProjectStore.getState().project?.layers[id];
      expect(layer?.type).toBe('text');
      expect((layer as { content: string })?.content).toBe('World');
    });
  });

  describe('addShapeLayer', () => {
    it('adds a shape layer with the given shape type', () => {
      createProject();
      const id = useProjectStore.getState().addShapeLayer('rectangle');
      const layer = useProjectStore.getState().project?.layers[id];
      expect(layer?.type).toBe('shape');
    });
  });

  describe('removeLayer', () => {
    it('removes the layer from the artboard', () => {
      createProject();
      const id = useProjectStore.getState().addTextLayer('Delete me');
      useProjectStore.getState().removeLayer(id);
      const { project, selectedArtboardId } = useProjectStore.getState();
      const artboard = project?.artboards.find((a) => a.id === selectedArtboardId);
      expect(artboard?.layerIds).not.toContain(id);
      expect(project?.layers[id]).toBeUndefined();
    });

    it('deselects the removed layer', () => {
      createProject();
      const id = useProjectStore.getState().addTextLayer('Remove select');
      useProjectStore.getState().selectLayer(id);
      useProjectStore.getState().removeLayer(id);
      expect(useProjectStore.getState().selectedLayerIds).not.toContain(id);
    });
  });

  describe('duplicateLayer', () => {
    it('creates a copy of the layer', () => {
      createProject();
      const id = useProjectStore.getState().addTextLayer('Original');
      const newId = useProjectStore.getState().duplicateLayer(id);
      expect(newId).not.toBeNull();
      expect(newId).not.toBe(id);
      const copy = useProjectStore.getState().project?.layers[newId!];
      expect(copy?.type).toBe('text');
    });

    it('names the copy with " copy" suffix', () => {
      createProject();
      const id = useProjectStore.getState().addTextLayer('Layer');
      const newId = useProjectStore.getState().duplicateLayer(id);
      const copy = useProjectStore.getState().project?.layers[newId!];
      expect(copy?.name.endsWith('copy')).toBe(true);
    });

    it('offsets the duplicate position by 20', () => {
      createProject();
      const id = useProjectStore.getState().addTextLayer('Offset');
      const orig = useProjectStore.getState().project?.layers[id];
      const newId = useProjectStore.getState().duplicateLayer(id);
      const copy = useProjectStore.getState().project?.layers[newId!];
      expect(copy?.transform.x).toBe(orig!.transform.x + 20);
      expect(copy?.transform.y).toBe(orig!.transform.y + 20);
    });

    it('adds the duplicate to the artboard layer list', () => {
      createProject();
      const id = useProjectStore.getState().addTextLayer('Dup');
      const newId = useProjectStore.getState().duplicateLayer(id);
      const { project, selectedArtboardId } = useProjectStore.getState();
      const artboard = project?.artboards.find((a) => a.id === selectedArtboardId);
      expect(artboard?.layerIds).toContain(newId!);
    });
  });

  describe('reorder layers', () => {
    it('moveLayerDown moves the layer one position down in the list', () => {
      createProject();
      const id1 = useProjectStore.getState().addTextLayer('A');
      const id2 = useProjectStore.getState().addTextLayer('B');

      // After adding, order is [id2, id1] (newest on top).
      const { project, selectedArtboardId } = useProjectStore.getState();
      const artboard = project!.artboards.find((a) => a.id === selectedArtboardId)!;
      expect(artboard.layerIds[0]).toBe(id2);

      useProjectStore.getState().moveLayerDown(id2);
      const updated = useProjectStore
        .getState()
        .project!.artboards.find((a) => a.id === selectedArtboardId)!;
      expect(updated.layerIds[0]).toBe(id1);
      expect(updated.layerIds[1]).toBe(id2);
    });

    it('moveLayerUp moves the layer one position up in the list', () => {
      createProject();
      const id1 = useProjectStore.getState().addTextLayer('A');
      const id2 = useProjectStore.getState().addTextLayer('B');

      // order: [id2, id1]
      useProjectStore.getState().moveLayerUp(id1);
      const updated = useProjectStore
        .getState()
        .project!.artboards.find(
          (a) => a.id === useProjectStore.getState().selectedArtboardId,
        )!;
      expect(updated.layerIds[0]).toBe(id1);
      expect(updated.layerIds[1]).toBe(id2);
    });

    it('moveLayerToTop moves the layer to position 0', () => {
      createProject();
      const id1 = useProjectStore.getState().addTextLayer('A');
      useProjectStore.getState().addTextLayer('B');
      useProjectStore.getState().addTextLayer('C');

      useProjectStore.getState().moveLayerToTop(id1);
      const artboard = useProjectStore
        .getState()
        .project!.artboards.find(
          (a) => a.id === useProjectStore.getState().selectedArtboardId,
        )!;
      expect(artboard.layerIds[0]).toBe(id1);
    });

    it('moveLayerToBottom moves the layer to the last position', () => {
      createProject();
      useProjectStore.getState().addTextLayer('A');
      useProjectStore.getState().addTextLayer('B');
      const id3 = useProjectStore.getState().addTextLayer('C');

      useProjectStore.getState().moveLayerToBottom(id3);
      const artboard = useProjectStore
        .getState()
        .project!.artboards.find(
          (a) => a.id === useProjectStore.getState().selectedArtboardId,
        )!;
      expect(artboard.layerIds[artboard.layerIds.length - 1]).toBe(id3);
    });

    it('reorderLayers replaces the full layer order', () => {
      createProject();
      const id1 = useProjectStore.getState().addTextLayer('A');
      const id2 = useProjectStore.getState().addTextLayer('B');

      useProjectStore.getState().reorderLayers([id1, id2]);
      const artboard = useProjectStore
        .getState()
        .project!.artboards.find(
          (a) => a.id === useProjectStore.getState().selectedArtboardId,
        )!;
      expect(artboard.layerIds).toEqual([id1, id2]);
    });
  });

  describe('groupLayers / ungroupLayers', () => {
    it('groups two layers into a group layer', () => {
      createProject();
      const id1 = useProjectStore.getState().addShapeLayer('rectangle');
      const id2 = useProjectStore.getState().addShapeLayer('ellipse');
      const groupId = useProjectStore.getState().groupLayers([id1, id2]);
      expect(groupId).not.toBeNull();
      const group = useProjectStore.getState().project?.layers[groupId!];
      expect(group?.type).toBe('group');
    });

    it('ungroups a group layer and restores children to the artboard', () => {
      createProject();
      const id1 = useProjectStore.getState().addShapeLayer('rectangle');
      const id2 = useProjectStore.getState().addShapeLayer('ellipse');
      const groupId = useProjectStore.getState().groupLayers([id1, id2])!;
      useProjectStore.getState().ungroupLayers(groupId);

      const { project, selectedArtboardId } = useProjectStore.getState();
      const artboard = project!.artboards.find((a) => a.id === selectedArtboardId)!;
      expect(artboard.layerIds).toContain(id1);
      expect(artboard.layerIds).toContain(id2);
      expect(project?.layers[groupId]).toBeUndefined();
    });
  });
});
