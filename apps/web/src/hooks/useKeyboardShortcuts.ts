import { useEffect, useCallback, useState } from "react";
import {
  keyboardShortcuts,
  type ShortcutHandler,
} from "../services/keyboard-shortcuts";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import {
  deleteTimelineItem,
  duplicateTimelineItem,
  getTimelineItemKind,
  getTimelineItemRanges,
  getSplittableTimelineItemIds,
  getTimelineSelectionItem,
  getTimelineSelectionItems,
  splitTimelineItem,
  trimTimelineItemToPlayhead,
} from "../utils/timeline-item-actions";

export function useKeyboardShortcuts() {
  const [showShortcutsOverlay, setShowShortcutsOverlay] = useState(false);

  const {
    undo,
    redo,
    rippleDeleteClip,
    copyClips,
    pasteClips,
    project,
    addMarker,
  } = useProjectStore();

  const { getSelectedClipIds, clearSelection, toggleSnap, selectMultiple } =
    useUIStore();
  const {
    togglePlayback,
    seekRelative,
    seekTo,
    playheadPosition,
    zoomIn,
    zoomOut,
    zoomToFit,
  } = useTimelineStore();

  const handlePlayPause = useCallback(() => {
    togglePlayback();
  }, [togglePlayback]);

  const handleFrameBack = useCallback(() => {
    seekRelative(-1 / 30);
  }, [seekRelative]);

  const handleFrameForward = useCallback(() => {
    seekRelative(1 / 30);
  }, [seekRelative]);

  const handleSecondBack = useCallback(() => {
    seekRelative(-1);
  }, [seekRelative]);

  const handleSecondForward = useCallback(() => {
    seekRelative(1);
  }, [seekRelative]);

  const handleJump5Back = useCallback(() => {
    seekRelative(-5);
  }, [seekRelative]);

  const handleJump5Forward = useCallback(() => {
    seekRelative(5);
  }, [seekRelative]);

  const handleGoToStart = useCallback(() => {
    seekTo(0);
  }, [seekTo]);

  const handleGoToEnd = useCallback(() => {
    const maxEnd = getTimelineItemRanges(project).reduce(
      (latest, item) => Math.max(latest, item.startTime + item.duration),
      0,
    );
    seekTo(maxEnd);
  }, [seekTo, project]);

  const handlePrevClip = useCallback(() => {
    const currentTime = playheadPosition;
    let prevEdge = 0;

    for (const clip of getTimelineItemRanges(project)) {
      const endTime = clip.startTime + clip.duration;
      if (clip.startTime < currentTime - 0.001 && clip.startTime > prevEdge) {
        prevEdge = clip.startTime;
      }
      if (endTime < currentTime - 0.001 && endTime > prevEdge) {
        prevEdge = endTime;
      }
    }

    seekTo(prevEdge);
  }, [seekTo, project, playheadPosition]);

  const handleNextClip = useCallback(() => {
    const currentTime = playheadPosition;
    let nextEdge = Infinity;

    for (const clip of getTimelineItemRanges(project)) {
      const endTime = clip.startTime + clip.duration;
      if (clip.startTime > currentTime + 0.001 && clip.startTime < nextEdge) {
        nextEdge = clip.startTime;
      }
      if (endTime > currentTime + 0.001 && endTime < nextEdge) {
        nextEdge = endTime;
      }
    }

    if (nextEdge !== Infinity) {
      seekTo(nextEdge);
    }
  }, [seekTo, project, playheadPosition]);

  const handleUndo = useCallback(() => {
    undo();
  }, [undo]);

  const handleRedo = useCallback(() => {
    redo();
  }, [redo]);

  const handleCopy = useCallback(() => {
    const selectedIds = getSelectedClipIds();
    if (selectedIds.length > 0) {
      copyClips(selectedIds);
    }
  }, [getSelectedClipIds, copyClips]);

  const handleCut = useCallback(() => {
    const selectedIds = getSelectedClipIds();
    if (selectedIds.length > 0) {
      copyClips(selectedIds);
      const store = useProjectStore.getState();
      void Promise.all(
        selectedIds.map((id) => deleteTimelineItem(store, id)),
      ).then(() => clearSelection());
    }
  }, [getSelectedClipIds, copyClips, clearSelection]);

  const handlePaste = useCallback(() => {
    const currentTime = playheadPosition;
    const firstTrack = project.timeline.tracks[0];
    if (firstTrack) {
      void pasteClips(firstTrack.id, currentTime).then(() => {
        const store = useProjectStore.getState();
        const pastedSelection = store.lastPastedClipIds
          .map((id) => getTimelineSelectionItem(store, id))
          .filter((item): item is NonNullable<typeof item> => item !== null);
        if (pastedSelection.length > 0) selectMultiple(pastedSelection);
      });
    }
  }, [pasteClips, playheadPosition, project.timeline.tracks, selectMultiple]);

  const handleDuplicate = useCallback(() => {
    const selectedIds = getSelectedClipIds();
    const store = useProjectStore.getState();
    selectedIds.forEach((id) => void duplicateTimelineItem(store, id));
  }, [getSelectedClipIds]);

  const handleDelete = useCallback(() => {
    const transitionItems = useUIStore
      .getState()
      .selectedItems.filter((item) => item.type === "transition");
    if (transitionItems.length > 0) {
      const { removeClipTransition } = useProjectStore.getState();
      transitionItems.forEach((item) => {
        void removeClipTransition(item.id);
      });
    }
    const selectedIds = getSelectedClipIds();
    const store = useProjectStore.getState();
    selectedIds.forEach((id) => void deleteTimelineItem(store, id));
    clearSelection();
  }, [getSelectedClipIds, clearSelection]);

  const handleRippleDelete = useCallback(() => {
    const selectedIds = getSelectedClipIds();
    const store = useProjectStore.getState();
    selectedIds
      .filter((id) => getTimelineItemKind(store, id) === "media")
      .forEach((id) => rippleDeleteClip(id));
    clearSelection();
  }, [getSelectedClipIds, rippleDeleteClip, clearSelection]);

  const handleSplit = useCallback(() => {
    const selectedIds = getSelectedClipIds();
    const splittableIds = getSplittableTimelineItemIds(
      project,
      selectedIds,
      playheadPosition,
    );
    const store = useProjectStore.getState();
    void Promise.all(
      splittableIds.map((id) => splitTimelineItem(store, id, playheadPosition)),
    );
  }, [getSelectedClipIds, playheadPosition, project]);

  const handleTrimStart = useCallback(() => {
    const selectedIds = getSelectedClipIds();
    const trimmableIds = getSplittableTimelineItemIds(
      project,
      selectedIds,
      playheadPosition,
    );
    const store = useProjectStore.getState();
    void Promise.all(
      trimmableIds.map((id) =>
        trimTimelineItemToPlayhead(store, id, playheadPosition, true),
      ),
    );
  }, [getSelectedClipIds, playheadPosition, project]);

  const handleTrimEnd = useCallback(() => {
    const selectedIds = getSelectedClipIds();
    const trimmableIds = getSplittableTimelineItemIds(
      project,
      selectedIds,
      playheadPosition,
    );
    const store = useProjectStore.getState();
    void Promise.all(
      trimmableIds.map((id) =>
        trimTimelineItemToPlayhead(store, id, playheadPosition, false),
      ),
    );
  }, [getSelectedClipIds, playheadPosition, project]);

  const handleSelectAll = useCallback(() => {
    selectMultiple(getTimelineSelectionItems(project));
  }, [selectMultiple, project]);

  const handleDeselect = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const handleToggleSnap = useCallback(() => {
    toggleSnap();
  }, [toggleSnap]);

  const handleZoomIn = useCallback(() => {
    zoomIn();
  }, [zoomIn]);

  const handleZoomOut = useCallback(() => {
    zoomOut();
  }, [zoomOut]);

  const handleFitTimeline = useCallback(() => {
    const maxEnd = getTimelineItemRanges(project).reduce(
      (latest, item) => Math.max(latest, item.startTime + item.duration),
      0,
    );
    zoomToFit(maxEnd || 60);
  }, [zoomToFit, project]);

  const handleShowShortcuts = useCallback(() => {
    setShowShortcutsOverlay(true);
  }, []);

  const handleSave = useCallback(() => {}, []);

  const handleExport = useCallback(() => {}, []);

  const handleAddText = useCallback(() => {}, []);

  const handleAddMarker = useCallback(() => {
    const currentTime = playheadPosition;
    const markerCount = project.timeline.markers.length;
    addMarker(currentTime, `Marker ${markerCount + 1}`, "#3b82f6");
  }, [playheadPosition, project.timeline.markers.length, addMarker]);

  useEffect(() => {
    const handlers: Array<[string, ShortcutHandler]> = [
      ["playback.playPause", handlePlayPause],
      ["playback.frameBack", handleFrameBack],
      ["playback.frameForward", handleFrameForward],
      ["playback.secondBack", handleSecondBack],
      ["playback.secondForward", handleSecondForward],
      ["playback.jump5Back", handleJump5Back],
      ["playback.jump5Forward", handleJump5Forward],
      ["playback.goToStart", handleGoToStart],
      ["playback.goToEnd", handleGoToEnd],
      ["playback.prevClip", handlePrevClip],
      ["playback.nextClip", handleNextClip],
      ["editing.undo", handleUndo],
      ["editing.redo", handleRedo],
      ["editing.cut", handleCut],
      ["editing.copy", handleCopy],
      ["editing.paste", handlePaste],
      ["editing.duplicate", handleDuplicate],
      ["editing.delete", handleDelete],
      ["editing.rippleDelete", handleRippleDelete],
      ["editing.split", handleSplit],
      ["editing.trimStart", handleTrimStart],
      ["editing.trimEnd", handleTrimEnd],
      ["selection.selectAll", handleSelectAll],
      ["selection.deselect", handleDeselect],
      ["timeline.toggleSnap", handleToggleSnap],
      ["timeline.zoomIn", handleZoomIn],
      ["timeline.zoomOut", handleZoomOut],
      ["timeline.fitTimeline", handleFitTimeline],
      ["view.showShortcuts", handleShowShortcuts],
      ["file.save", handleSave],
      ["file.export", handleExport],
      ["tools.addText", handleAddText],
      ["tools.addMarker", handleAddMarker],
    ];

    const unsubscribes = handlers.map(([action, handler]) =>
      keyboardShortcuts.registerHandler(action, handler),
    );

    keyboardShortcuts.startListening();

    return () => {
      unsubscribes.forEach((unsub) => unsub());
      keyboardShortcuts.stopListening();
    };
  }, [
    handlePlayPause,
    handleFrameBack,
    handleFrameForward,
    handleSecondBack,
    handleSecondForward,
    handleJump5Back,
    handleJump5Forward,
    handleGoToStart,
    handleGoToEnd,
    handlePrevClip,
    handleNextClip,
    handleUndo,
    handleRedo,
    handleCut,
    handleCopy,
    handlePaste,
    handleDuplicate,
    handleDelete,
    handleRippleDelete,
    handleSplit,
    handleTrimStart,
    handleTrimEnd,
    handleSelectAll,
    handleDeselect,
    handleToggleSnap,
    handleZoomIn,
    handleZoomOut,
    handleFitTimeline,
    handleShowShortcuts,
    handleSave,
    handleExport,
    handleAddText,
    handleAddMarker,
  ]);

  return {
    showShortcutsOverlay,
    setShowShortcutsOverlay,
  };
}
