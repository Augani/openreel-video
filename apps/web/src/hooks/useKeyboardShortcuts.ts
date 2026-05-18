import { useEffect, useCallback, useState } from "react";
import {
  keyboardShortcuts,
  type ShortcutHandler,
} from "../services/keyboard-shortcuts";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useEngineStore } from "../stores/engine-store";

export function useKeyboardShortcuts() {
  const [showShortcutsOverlay, setShowShortcutsOverlay] = useState(false);

  const {
    undo,
    redo,
    splitClip,
    removeClip,
    rippleDeleteClip,
    copyClips,
    pasteClips,
    duplicateClip,
    getClip,
    project,
    addMarker,
    deleteTextClip,
    deleteShapeClip,
    deleteSVGClip,
  } = useProjectStore();

  const { getSelectedClipIds, clearSelection, toggleSnap, select } =
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
    let maxEnd = 0;
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        const end = clip.startTime + clip.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }
    seekTo(maxEnd);
  }, [seekTo, project.timeline.tracks]);

  const handlePrevClip = useCallback(() => {
    const currentTime = playheadPosition;
    let prevEdge = 0;

    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        const endTime = clip.startTime + clip.duration;
        if (clip.startTime < currentTime - 0.001 && clip.startTime > prevEdge) {
          prevEdge = clip.startTime;
        }
        if (endTime < currentTime - 0.001 && endTime > prevEdge) {
          prevEdge = endTime;
        }
      }
    }

    seekTo(prevEdge);
  }, [seekTo, project.timeline.tracks, playheadPosition]);

  const handleNextClip = useCallback(() => {
    const currentTime = playheadPosition;
    let nextEdge = Infinity;

    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        const endTime = clip.startTime + clip.duration;
        if (clip.startTime > currentTime + 0.001 && clip.startTime < nextEdge) {
          nextEdge = clip.startTime;
        }
        if (endTime > currentTime + 0.001 && endTime < nextEdge) {
          nextEdge = endTime;
        }
      }
    }

    if (nextEdge !== Infinity) {
      seekTo(nextEdge);
    }
  }, [seekTo, project.timeline.tracks, playheadPosition]);

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
      selectedIds.forEach((id) => removeClip(id));
    }
  }, [getSelectedClipIds, copyClips, removeClip]);

  const handlePaste = useCallback(() => {
    const currentTime = playheadPosition;
    const firstTrack = project.timeline.tracks[0];
    if (firstTrack) {
      pasteClips(firstTrack.id, currentTime);
    }
  }, [pasteClips, playheadPosition, project.timeline.tracks]);

  const handleDuplicate = useCallback(() => {
    const selectedIds = getSelectedClipIds();
    if (selectedIds.length === 1) {
      duplicateClip(selectedIds[0]);
    }
  }, [getSelectedClipIds, duplicateClip]);

  const handleDelete = useCallback(() => {
    const selectedIds = getSelectedClipIds();
    if (selectedIds.length === 0) return;

    const titleEngine = useEngineStore.getState().getTitleEngine();
    const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

    const allTextClips = titleEngine?.getAllTextClips() ?? [];
    const allShapeClips = graphicsEngine
      ? [
          ...(graphicsEngine.getAllShapeClips() ?? []),
          ...(graphicsEngine.getAllSVGClips() ?? []),
          ...(graphicsEngine.getAllStickerClips() ?? []),
        ]
      : [];

    selectedIds.forEach((id) => {
      const textClip = allTextClips.find((tc) => tc.id === id);
      if (textClip) {
        deleteTextClip(id);
        return;
      }

      const graphicClip = allShapeClips.find((gc) => gc.id === id);
      if (graphicClip) {
        if (graphicClip.type === "svg") {
          deleteSVGClip(id);
        } else {
          deleteShapeClip(id);
        }
        return;
      }

      removeClip(id);
    });
    clearSelection();
  }, [
    getSelectedClipIds,
    removeClip,
    clearSelection,
    deleteTextClip,
    deleteShapeClip,
    deleteSVGClip,
  ]);

  const handleRippleDelete = useCallback(() => {
    const selectedIds = getSelectedClipIds();
    selectedIds.forEach((id) => rippleDeleteClip(id));
    clearSelection();
  }, [getSelectedClipIds, rippleDeleteClip, clearSelection]);

  const handleSplit = useCallback(() => {
    const selectedIds = getSelectedClipIds();
    if (selectedIds.length === 1) {
      const currentTime = playheadPosition;
      const clip = getClip(selectedIds[0]);
      if (
        clip &&
        currentTime > clip.startTime &&
        currentTime < clip.startTime + clip.duration
      ) {
        splitClip(selectedIds[0], currentTime);
      }
    }
  }, [getSelectedClipIds, playheadPosition, getClip, splitClip]);

  const handleTrimStart = useCallback(() => {
    const selectedIds = getSelectedClipIds();
    if (selectedIds.length === 1) {
      const currentTime = playheadPosition;
      useProjectStore
        .getState()
        .trimToPlayhead(selectedIds[0], currentTime, true);
    }
  }, [getSelectedClipIds, playheadPosition]);

  const handleTrimEnd = useCallback(() => {
    const selectedIds = getSelectedClipIds();
    if (selectedIds.length === 1) {
      const currentTime = playheadPosition;
      useProjectStore
        .getState()
        .trimToPlayhead(selectedIds[0], currentTime, false);
    }
  }, [getSelectedClipIds, playheadPosition]);

  const handleSelectAll = useCallback(() => {
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        select({ id: clip.id, type: "clip" });
      }
    }
  }, [select, project.timeline.tracks]);

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
    let maxEnd = 0;
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        const end = clip.startTime + clip.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }
    zoomToFit(maxEnd || 60);
  }, [zoomToFit, project.timeline.tracks]);

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
