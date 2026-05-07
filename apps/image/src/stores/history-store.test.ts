import { describe, it, expect, beforeEach } from 'vitest';
import { useHistoryStore } from './history-store';
import { useProjectStore } from './project-store';

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

describe('history-store (command-based)', () => {
  beforeEach(resetStores);

  // ── execute / canUndo / canRedo ──────────────────────────────────────────

  describe('execute', () => {
    it('executes a command and records it in the undo stack', () => {
      createProject();
      useProjectStore.getState().addTextLayer('Hello');
      expect(useHistoryStore.getState().undoStack).toHaveLength(1);
      expect(useHistoryStore.getState().redoStack).toHaveLength(0);
    });

    it('clears the redo stack on new command', () => {
      createProject();

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
      useProjectStore.getState().addTextLayer('First');
      useProjectStore.getState().addTextLayer('Second');

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
