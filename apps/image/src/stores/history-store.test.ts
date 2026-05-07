import { describe, it, expect, beforeEach } from 'vitest';
import { useHistoryStore } from './history-store';
import { useProjectStore } from './project-store';
import {
  AddLayerCommand,
  UpdateLayerTransformCommand,
} from '@openreel/image-core/commands';

const DEFAULT_SIZE = { width: 1080, height: 1080 };

function resetStores() {
  useHistoryStore.setState({
    undoStack: [],
    redoStack: [],
    baseProject: null,
    maxSize: 50,
    snapshots: [],
  });
  useProjectStore.setState({
    project: null,
    selectedLayerIds: [],
    selectedArtboardId: null,
    copiedLayers: [],
    copiedStyle: null,
    isDirty: false,
  });
}

function createProject() {
  useProjectStore.getState().createProject('Test', DEFAULT_SIZE, { type: 'color', color: '#fff' });
}

function getProject() {
  return useProjectStore.getState().project!;
}

function getArtboardId() {
  return useProjectStore.getState().selectedArtboardId!;
}

describe('history-store (command-based)', () => {
  beforeEach(resetStores);

  // ── execute / canUndo / canRedo ──────────────────────────────────────────

  describe('execute', () => {
    it('executes a command and records it', () => {
      createProject();
      const project = getProject();
      const artboardId = getArtboardId();

      const layer = {
        id: 'l-1',
        name: 'T',
        type: 'text' as const,
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, width: 100, height: 50, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, opacity: 1 },
        blendMode: { mode: 'normal' as const },
        shadow: { enabled: false, color: '#000', blur: 10, offsetX: 0, offsetY: 4 },
        innerShadow: { enabled: false, color: '#000', blur: 10, offsetX: 0, offsetY: 4 },
        stroke: { enabled: false, color: '#000', width: 1, style: 'solid' as const },
        glow: { enabled: false, color: '#fff', blur: 20, intensity: 1 },
        filters: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, vibrance: 0, highlights: 0, shadows: 0, clarity: 0, blur: 0, blurType: 'gaussian' as const, blurAngle: 0, sharpen: 0, vignette: 0, grain: 0, sepia: 0, invert: 0 },
        parentId: null,
        flipHorizontal: false,
        flipVertical: false,
        mask: null,
        clippingMask: false,
        levels: { enabled: false, inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 },
        curves: { enabled: false, points: [] },
        colorBalance: { enabled: false, shadows: [0,0,0] as [number,number,number], midtones: [0,0,0] as [number,number,number], highlights: [0,0,0] as [number,number,number], preserveLuminosity: true },
        selectiveColor: { enabled: false, colors: {} },
        blackWhite: { enabled: false, reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tintEnabled: false, tintColor: '#e0c9a0' },
        photoFilter: { enabled: false, color: '#f0a000', density: 25, luminosity: true },
        channelMixer: { enabled: false, red: [100,0,0,0] as [number,number,number,number], green: [0,100,0,0] as [number,number,number,number], blue: [0,0,100,0] as [number,number,number,number], monochrome: false },
        gradientMap: { enabled: false, stops: [] },
        posterize: { enabled: false, levels: 4 },
        threshold: { enabled: false, level: 128 },
        content: 'T',
        style: { fontFamily: 'Inter', fontSize: 16, fontWeight: 400, fontStyle: 'normal' as const, textDecoration: 'none' as const, textAlign: 'left' as const, verticalAlign: 'top' as const, lineHeight: 1.4, letterSpacing: 0, fillType: 'solid' as const, color: '#000000', gradient: null, strokeColor: null, strokeWidth: 0, backgroundColor: null, backgroundPadding: 4, backgroundRadius: 2, textShadow: { enabled: false, color: 'rgba(0,0,0,0.5)', blur: 4, offsetX: 2, offsetY: 2 } },
        autoSize: true,
      };
      const cmd = new AddLayerCommand(artboardId, layer, 0);
      useHistoryStore.getState().execute(cmd, project);

      expect(useHistoryStore.getState().undoStack).toHaveLength(1);
      expect(useHistoryStore.getState().redoStack).toHaveLength(0);
    });

    it('clears the redo stack on new command', () => {
      createProject();
      const project = getProject();
      const artboardId = getArtboardId();

      // Create a simple command, execute, undo, then execute another → redo should clear.
      useProjectStore.getState().addTextLayer('A');
      const hs = useHistoryStore.getState();
      expect(hs.undoStack.length).toBeGreaterThanOrEqual(1);

      useProjectStore.getState().undo();
      expect(useHistoryStore.getState().redoStack.length).toBeGreaterThanOrEqual(1);

      useProjectStore.getState().addTextLayer('B');
      expect(useHistoryStore.getState().redoStack).toHaveLength(0);
    });
  });

  describe('canUndo / canRedo', () => {
    it('canUndo returns false when no commands have been executed', () => {
      expect(useHistoryStore.getState().canUndo()).toBe(false);
    });

    it('canRedo returns false when no commands have been undone', () => {
      expect(useHistoryStore.getState().canRedo()).toBe(false);
    });

    it('canUndo returns true after executing a command via project-store', () => {
      createProject();
      useProjectStore.getState().addTextLayer('Hello');
      expect(useHistoryStore.getState().canUndo()).toBe(true);
    });

    it('canRedo returns true after undoing', () => {
      createProject();
      useProjectStore.getState().addTextLayer('Hello');
      useProjectStore.getState().undo();
      expect(useHistoryStore.getState().canRedo()).toBe(true);
    });
  });

  // ── undo ─────────────────────────────────────────────────────────────────

  describe('undo', () => {
    it('undoes an add-layer command', () => {
      createProject();
      useProjectStore.getState().addTextLayer('Hello');
      const idBefore = useProjectStore.getState().project!.artboards[0].layerIds;
      expect(idBefore.length).toBe(1);

      useProjectStore.getState().undo();
      const idAfter = useProjectStore.getState().project!.artboards[0].layerIds;
      expect(idAfter.length).toBe(0);
    });

    it('moves the command from undoStack to redoStack', () => {
      createProject();
      useProjectStore.getState().addTextLayer('Hello');
      useProjectStore.getState().undo();
      expect(useHistoryStore.getState().undoStack).toHaveLength(0);
      expect(useHistoryStore.getState().redoStack).toHaveLength(1);
    });

    it('returns null when there is nothing to undo (via project-store)', () => {
      createProject();
      // No commands executed, undo should be no-op
      const projectBefore = useProjectStore.getState().project;
      useProjectStore.getState().undo();
      // Project should remain unchanged
      expect(useProjectStore.getState().project?.name).toBe(projectBefore?.name);
    });
  });

  // ── redo ─────────────────────────────────────────────────────────────────

  describe('redo', () => {
    it('re-applies an undone command', () => {
      createProject();
      useProjectStore.getState().addTextLayer('Hello');
      useProjectStore.getState().undo();
      expect(useProjectStore.getState().project!.artboards[0].layerIds).toHaveLength(0);

      useProjectStore.getState().redo();
      expect(useProjectStore.getState().project!.artboards[0].layerIds).toHaveLength(1);
    });

    it('moves command back to undoStack', () => {
      createProject();
      useProjectStore.getState().addTextLayer('Hello');
      useProjectStore.getState().undo();
      useProjectStore.getState().redo();
      expect(useHistoryStore.getState().undoStack).toHaveLength(1);
      expect(useHistoryStore.getState().redoStack).toHaveLength(0);
    });
  });

  // ── getEntries ────────────────────────────────────────────────────────────

  describe('getEntries', () => {
    it('returns an empty array initially', () => {
      expect(useHistoryStore.getState().getEntries()).toHaveLength(0);
    });

    it('returns one entry per executed command', () => {
      createProject();
      useProjectStore.getState().addTextLayer('A');
      useProjectStore.getState().addShapeLayer('rectangle');
      const entries = useHistoryStore.getState().getEntries();
      expect(entries).toHaveLength(2);
    });

    it('entries have meaningful descriptions', () => {
      createProject();
      useProjectStore.getState().addTextLayer('My Text');
      const entries = useHistoryStore.getState().getEntries();
      expect(entries[0].description).toBeTruthy();
      expect(typeof entries[0].description).toBe('string');
    });
  });

  // ── getUndoDescription / getRedoDescription ───────────────────────────────

  describe('getUndoDescription / getRedoDescription', () => {
    it('getUndoDescription returns the description of the last command', () => {
      createProject();
      useProjectStore.getState().addTextLayer('Hello');
      const desc = useHistoryStore.getState().getUndoDescription();
      expect(desc).toBeTruthy();
      expect(typeof desc).toBe('string');
    });

    it('getRedoDescription returns null when nothing to redo', () => {
      createProject();
      expect(useHistoryStore.getState().getRedoDescription()).toBeNull();
    });

    it('getRedoDescription returns description after undo', () => {
      createProject();
      useProjectStore.getState().addTextLayer('Hello');
      useProjectStore.getState().undo();
      const desc = useHistoryStore.getState().getRedoDescription();
      expect(desc).toBeTruthy();
    });
  });

  // ── Command coalescing ────────────────────────────────────────────────────

  describe('command coalescing', () => {
    it('merges consecutive transform commands on the same layer into one undo step', () => {
      createProject();
      const id = useProjectStore.getState().addTextLayer('Drag me');

      // Capture the initial x position (layer is centered in the 1080px artboard)
      const initialX = useProjectStore.getState().project!.layers[id].transform.x;

      // Simulate a drag: multiple transform updates
      useProjectStore.getState().updateLayerTransform(id, { x: initialX + 10 });
      useProjectStore.getState().updateLayerTransform(id, { x: initialX + 20 });
      useProjectStore.getState().updateLayerTransform(id, { x: initialX + 30 });

      // All three should have coalesced into one undo step
      expect(useHistoryStore.getState().undoStack).toHaveLength(2); // 1 AddLayer + 1 merged Transform

      // Undo once should get back to the state before any transform
      useProjectStore.getState().undo();
      const layer = useProjectStore.getState().project!.layers[id];
      expect(layer.transform.x).toBe(initialX); // original x
    });
  });

  // ── goToEntry ─────────────────────────────────────────────────────────────

  describe('goToEntry', () => {
    it('jumps to a specific history position', () => {
      createProject();
      useProjectStore.getState().addTextLayer('First');
      useProjectStore.getState().addTextLayer('Second');
      // undoStack should have 2 entries (index 0 and 1)
      expect(useHistoryStore.getState().undoStack).toHaveLength(2);

      // Jump to index 0 (after the first command)
      const state = useHistoryStore.getState().goToEntry(0);
      expect(state).not.toBeNull();
      // Only the first layer should exist
      if (state) {
        const artboard = state.artboards[0];
        expect(artboard.layerIds).toHaveLength(1);
      }
    });

    it('returns null for an invalid index', () => {
      createProject();
      expect(useHistoryStore.getState().goToEntry(-1)).toBeNull();
      expect(useHistoryStore.getState().goToEntry(999)).toBeNull();
    });
  });

  // ── clear ─────────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('clears the undo/redo stacks', () => {
      createProject();
      useProjectStore.getState().addTextLayer('A');
      useProjectStore.getState().addTextLayer('B');
      useHistoryStore.getState().clear();
      expect(useHistoryStore.getState().undoStack).toHaveLength(0);
      expect(useHistoryStore.getState().redoStack).toHaveLength(0);
    });
  });

  // ── Snapshots ─────────────────────────────────────────────────────────────

  describe('snapshots', () => {
    it('creates a named snapshot', () => {
      createProject();
      useHistoryStore.getState().createSnapshot('My Snapshot', getProject());
      expect(useHistoryStore.getState().getSnapshots()).toHaveLength(1);
      expect(useHistoryStore.getState().getSnapshots()[0].name).toBe('My Snapshot');
    });

    it('restores a snapshot', () => {
      createProject();
      const snapshot = getProject();
      useHistoryStore.getState().createSnapshot('Before changes', snapshot);

      useProjectStore.getState().addTextLayer('Added after snapshot');

      const snapId = useHistoryStore.getState().getSnapshots()[0].id;
      const restored = useHistoryStore.getState().restoreSnapshot(snapId);
      expect(restored).not.toBeNull();
      // The restored project should have no layers (since snapshot was taken before adding)
      if (restored) {
        expect(restored.artboards[0].layerIds).toHaveLength(0);
      }
    });

    it('deletes a snapshot', () => {
      createProject();
      useHistoryStore.getState().createSnapshot('Snap', getProject());
      const snapId = useHistoryStore.getState().getSnapshots()[0].id;
      useHistoryStore.getState().deleteSnapshot(snapId);
      expect(useHistoryStore.getState().getSnapshots()).toHaveLength(0);
    });

    it('renames a snapshot', () => {
      createProject();
      useHistoryStore.getState().createSnapshot('Old Name', getProject());
      const snapId = useHistoryStore.getState().getSnapshots()[0].id;
      useHistoryStore.getState().renameSnapshot(snapId, 'New Name');
      expect(useHistoryStore.getState().getSnapshots()[0].name).toBe('New Name');
    });

    it('returns null when restoring a non-existent snapshot', () => {
      expect(useHistoryStore.getState().restoreSnapshot('no-such-id')).toBeNull();
    });
  });

  // ── Multiple undo/redo operations ─────────────────────────────────────────

  describe('multiple undo/redo', () => {
    it('can undo and redo multiple steps in sequence', () => {
      createProject();
      const id1 = useProjectStore.getState().addTextLayer('First');
      const id2 = useProjectStore.getState().addTextLayer('Second');

      // Undo twice
      useProjectStore.getState().undo();
      useProjectStore.getState().undo();
      expect(useProjectStore.getState().project!.artboards[0].layerIds).toHaveLength(0);

      // Redo twice
      useProjectStore.getState().redo();
      useProjectStore.getState().redo();
      expect(useProjectStore.getState().project!.artboards[0].layerIds).toHaveLength(2);
    });

    it('project-store undo/redo round-trip preserves layer content', () => {
      createProject();
      const id = useProjectStore.getState().addTextLayer('Original');
      // addTextLayer uses content as name, so name is 'Original'
      expect(useProjectStore.getState().project!.layers[id]?.name).toBe('Original');

      useProjectStore.getState().updateLayer(id, { name: 'Updated' });
      expect(useProjectStore.getState().project!.layers[id]?.name).toBe('Updated');

      useProjectStore.getState().undo(); // undo rename
      expect(useProjectStore.getState().project!.layers[id]?.name).toBe('Original');

      useProjectStore.getState().redo(); // redo rename
      expect(useProjectStore.getState().project!.layers[id]?.name).toBe('Updated');
    });
  });
});
