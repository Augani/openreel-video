import { useEffect } from 'react';
import { useUIStore } from '../stores/ui-store';
import { useProjectStore } from '../stores/project-store';
import { useHistoryStore } from '../stores/history-store';

export function useKeyboardShortcuts() {
  const { setActiveTool, zoomIn, zoomOut, zoomToFit, toggleGrid, toggleGuides, toggleShortcutsPanel, openSettingsDialog } = useUIStore();
  const {
    selectedLayerIds,
    removeLayer,
    copyLayers,
    cutLayers,
    pasteLayers,
    duplicateLayer,
    selectAllLayers,
    deselectAllLayers,
    moveLayerUp,
    moveLayerDown,
    moveLayerToTop,
    moveLayerToBottom,
    groupLayers,
    ungroupLayers,
    project,
  } = useProjectStore();
  const { undo, redo, canUndo, canRedo } = useHistoryStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const isMod = e.metaKey || e.ctrlKey;

      if (!isMod && !e.shiftKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'v':
            setActiveTool('select');
            break;
          case 'h':
            setActiveTool('hand');
            break;
          case 't':
            setActiveTool('text');
            break;
          case 's':
            setActiveTool('shape');
            break;
          case 'p':
            setActiveTool('pen');
            break;
          case 'i':
            setActiveTool('eyedropper');
            break;
          case 'z':
            setActiveTool('zoom');
            break;
          case 'delete':
          case 'backspace':
            if (selectedLayerIds.length > 0) {
              e.preventDefault();
              selectedLayerIds.forEach((id) => removeLayer(id));
            }
            break;
        }
      }

      if (isMod) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) {
              if (canRedo()) {
                const state = redo();
                if (state) useProjectStore.getState().loadProject(state);
              }
            } else {
              if (canUndo()) {
                const state = undo();
                if (state) useProjectStore.getState().loadProject(state);
              }
            }
            break;

          case 'c':
            e.preventDefault();
            copyLayers();
            break;

          case 'x':
            e.preventDefault();
            cutLayers();
            break;

          case 'v':
            e.preventDefault();
            pasteLayers();
            break;

          case 'd':
            e.preventDefault();
            if (selectedLayerIds.length > 0) {
              selectedLayerIds.forEach((id) => duplicateLayer(id));
            }
            break;

          case 'a':
            e.preventDefault();
            selectAllLayers();
            break;

          case 'g':
            e.preventDefault();
            if (e.shiftKey) {
              if (selectedLayerIds.length === 1) {
                const layer = project?.layers[selectedLayerIds[0]];
                if (layer?.type === 'group') {
                  ungroupLayers(selectedLayerIds[0]);
                }
              }
            } else if (selectedLayerIds.length > 1) {
              groupLayers(selectedLayerIds);
            }
            break;

          case ']':
            e.preventDefault();
            if (selectedLayerIds.length === 1) {
              if (e.shiftKey) {
                moveLayerToTop(selectedLayerIds[0]);
              } else {
                moveLayerUp(selectedLayerIds[0]);
              }
            }
            break;

          case '[':
            e.preventDefault();
            if (selectedLayerIds.length === 1) {
              if (e.shiftKey) {
                moveLayerToBottom(selectedLayerIds[0]);
              } else {
                moveLayerDown(selectedLayerIds[0]);
              }
            }
            break;

          case '=':
          case '+':
            e.preventDefault();
            zoomIn();
            break;

          case '-':
            e.preventDefault();
            zoomOut();
            break;

          case '0':
            e.preventDefault();
            zoomToFit();
            break;

          case "'":
            e.preventDefault();
            toggleGrid();
            break;

          case ';':
            e.preventDefault();
            toggleGuides();
            break;

          case ',':
            e.preventDefault();
            openSettingsDialog();
            break;

          case 's':
            e.preventDefault();
            if (project) {
              const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${project.name.replace(/[^a-zA-Z0-9]/g, '_')}.orimg`;
              a.click();
              URL.revokeObjectURL(url);
            }
            break;
        }
      }

      if (e.key === 'Escape') {
        deselectAllLayers();
      }

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        toggleShortcutsPanel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedLayerIds,
    setActiveTool,
    removeLayer,
    copyLayers,
    cutLayers,
    pasteLayers,
    duplicateLayer,
    selectAllLayers,
    deselectAllLayers,
    moveLayerUp,
    moveLayerDown,
    moveLayerToTop,
    moveLayerToBottom,
    groupLayers,
    ungroupLayers,
    zoomIn,
    zoomOut,
    zoomToFit,
    toggleGrid,
    toggleGuides,
    toggleShortcutsPanel,
    openSettingsDialog,
    undo,
    redo,
    canUndo,
    canRedo,
    project,
  ]);
}
