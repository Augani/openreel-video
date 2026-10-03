import { useEffect, useState } from "react";
import {
  keyboardShortcuts,
  type ShortcutHandler,
} from "../services/keyboard-shortcuts";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { toast } from "../stores/notification-store";
import { projectManager } from "../services/project-manager";
import { insertTimelineOverlay } from "../stores/project/insert-timeline-overlay";
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
import { stepEditingFrame, editingFrameStepSeconds } from "../components/editor/editing-frame-rate";
import { resolvePlaybackLoop } from "../utils/playback-loop";

export function useKeyboardShortcuts() {
  const [showShortcutsOverlay, setShowShortcutsOverlay] = useState(false);

  useEffect(() => {
    // Read live state when a command runs. Subscribing this hook to the entire
    // timeline used to rerender the editor and reinstall every handler per frame.
    let editInFlight = false;
    let saveInFlight = false;
    const timelineEnd = () => useProjectStore.getState().getTimelineDuration();
    const editableIds = () => {
      const { project } = useProjectStore.getState();
      const unlockedTracks = new Set(
        project.timeline.tracks.filter((track) => !track.locked).map((track) => track.id),
      );
      const editableItems = new Set(
        getTimelineItemRanges(project)
          .filter((item) => unlockedTracks.has(item.trackId))
          .map((item) => item.id),
      );
      return useUIStore.getState().getSelectedClipIds().filter((id) => editableItems.has(id));
    };
    const runEdit = async (
      description: string,
      operation: () => Promise<void>,
      group = true,
    ) => {
      if (editInFlight) return;
      editInFlight = true;
      const store = useProjectStore.getState();
      if (group) store.beginHistoryGroup(description);
      try {
        await operation();
      } catch (error) {
        toast.error(description + " failed", error instanceof Error ? error.message : "Please try again.");
      } finally {
        if (group) store.endHistoryGroup();
        editInFlight = false;
      }
    };
    const seek = (position: number) => {
      const timeline = useTimelineStore.getState();
      timeline.pause();
      timeline.seekTo(Math.min(timelineEnd(), Math.max(0, position)));
      useTimelineStore.getState().scrollToPlayhead();
    };
    const seekRelative = (delta: number) => {
      seek(useTimelineStore.getState().playheadPosition + delta);
    };
    const stepFrame = (direction: -1 | 1) => {
      seek(stepEditingFrame(
        useTimelineStore.getState().playheadPosition,
        direction,
        useProjectStore.getState().project.settings.frameRate,
      ));
    };
    const seekClipEdge = (direction: -1 | 1) => {
      const position = useTimelineStore.getState().playheadPosition;
      const edges = getTimelineItemRanges(useProjectStore.getState().project)
        .flatMap((item) => [item.startTime, item.startTime + item.duration]);
      const candidates = edges.filter((edge) => direction === -1
        ? edge < position - 0.001
        : edge > position + 0.001);
      if (direction === -1) seek(Math.max(0, ...candidates));
      else if (candidates.length) seek(Math.min(...candidates));
    };
    const deleteSelection = async (cut: boolean) => {
      const ids = editableIds();
      const ui = useUIStore.getState();
      const transitionItems = cut ? [] : ui.selectedItems.filter((item) =>
        item.type === "transition" &&
        !useProjectStore.getState().project.timeline.tracks.find((track) => track.id === item.trackId)?.locked,
      );
      if (!ids.length && !transitionItems.length) return;
      await runEdit(cut ? "Cut clips" : "Delete selection", async () => {
        if (cut) useProjectStore.getState().copyClips(ids);
        const removed = new Set<string>();
        for (const item of transitionItems) {
          if (await useProjectStore.getState().removeClipTransition(item.id)) removed.add(item.id);
        }
        for (const id of ids) {
          if (await deleteTimelineItem(useProjectStore.getState(), id)) removed.add(id);
        }
        const currentUI = useUIStore.getState();
        currentUI.selectMultiple(currentUI.selectedItems.filter((item) => !removed.has(item.id)));
      });
    };
    const editAtPlayhead = (trimStart?: boolean) => {
      const time = useTimelineStore.getState().playheadPosition;
      const ids = getSplittableTimelineItemIds(useProjectStore.getState().project, editableIds(), time);
      if (!ids.length) return;
      void runEdit(trimStart === undefined ? "Split clips" : "Trim clips", async () => {
        for (const id of ids) {
          const store = useProjectStore.getState();
          if (trimStart === undefined) await splitTimelineItem(store, id, time);
          else await trimTimelineItemToPlayhead(store, id, time, trimStart);
        }
      });
    };
    const markLoopRange = (markStart: boolean) => {
      const state = useTimelineStore.getState();
      const duration = timelineEnd();
      const range = resolvePlaybackLoop({ ...state, loopEnabled: true }, duration);
      if (!range) return;
      const frame = editingFrameStepSeconds(useProjectStore.getState().project.settings.frameRate);
      const time = Math.min(duration, Math.max(0, state.playheadPosition));
      if (markStart) {
        const start = Math.min(time, Math.max(0, duration - frame));
        state.setLoopRange(start, range.end > start ? range.end : duration);
      } else {
        const end = Math.min(duration, Math.max(frame, time));
        state.setLoopRange(range.start < end ? range.start : 0, end);
      }
    };

    const handlers: Array<[string, ShortcutHandler]> = [
      ["playback.playPause", () => useTimelineStore.getState().togglePlayback()],
      ["playback.frameBack", () => stepFrame(-1)],
      ["playback.frameForward", () => stepFrame(1)],
      ["playback.secondBack", () => seekRelative(-1)],
      ["playback.secondForward", () => seekRelative(1)],
      ["playback.jump5Back", () => seekRelative(-5)],
      ["playback.jump5Forward", () => seekRelative(5)],
      ["playback.goToStart", () => seek(0)],
      ["playback.goToEnd", () => seek(timelineEnd())],
      ["playback.prevClip", () => seekClipEdge(-1)],
      ["playback.nextClip", () => seekClipEdge(1)],
      ["playback.markLoopStart", () => markLoopRange(true)],
      ["playback.markLoopEnd", () => markLoopRange(false)],
      ["playback.toggleLoop", () => {
        const state = useTimelineStore.getState();
        const range = resolvePlaybackLoop({ ...state, loopEnabled: true }, timelineEnd());
        if (!range) return;
        state.setLoopRange(range.start, range.end);
        state.setLoopEnabled(!state.loopEnabled);
      }],
      ["editing.undo", () => void runEdit("Undo", async () => { await useProjectStore.getState().undo(); }, false)],
      ["editing.redo", () => void runEdit("Redo", async () => { await useProjectStore.getState().redo(); }, false)],
      ["editing.copy", () => {
        const ids = useUIStore.getState().getSelectedClipIds();
        if (ids.length) useProjectStore.getState().copyClips(ids);
      }],
      ["editing.cut", () => void deleteSelection(true)],
      ["editing.paste", () => {
        const ui = useUIStore.getState();
        const store = useProjectStore.getState();
        const selectedTrackId = ui.selectedItems[0]?.trackId;
        const destination = store.project.timeline.tracks.find((track) => track.id === selectedTrackId && !track.locked)
          ?? store.project.timeline.tracks.find((track) => !track.locked);
        if (!destination) return;
        const time = useTimelineStore.getState().playheadPosition;
        void runEdit("Paste clips", async () => {
          await useProjectStore.getState().pasteClips(destination.id, time);
          const state = useProjectStore.getState();
          const pasted = state.lastPastedClipIds
            .map((id) => getTimelineSelectionItem(state, id))
            .filter((item): item is NonNullable<typeof item> => item !== null);
          if (pasted.length) useUIStore.getState().selectMultiple(pasted);
        });
      }],
      ["editing.duplicate", () => {
        const ids = editableIds();
        if (!ids.length) return;
        void runEdit("Duplicate clips", async () => {
          for (const id of ids) await duplicateTimelineItem(useProjectStore.getState(), id);
        });
      }],
      ["editing.delete", () => void deleteSelection(false)],
      ["editing.rippleDelete", () => {
        const store = useProjectStore.getState();
        const selected = new Set(editableIds());
        // Delete from right to left so closing earlier gaps never changes the
        // timing of another selected clip before it is processed.
        const ids = getTimelineItemRanges(store.project)
          .filter((item) => selected.has(item.id) && getTimelineItemKind(store, item.id) === "media")
          .sort((a, b) => b.startTime - a.startTime)
          .map((item) => item.id);
        if (!ids.length) return;
        void runEdit("Ripple delete clips", async () => {
          const removed = new Set<string>();
          for (const id of ids) {
            if ((await useProjectStore.getState().rippleDeleteClip(id)).success) removed.add(id);
          }
          const ui = useUIStore.getState();
          ui.selectMultiple(ui.selectedItems.filter((item) => !removed.has(item.id)));
        });
      }],
      ["editing.split", () => editAtPlayhead()],
      ["editing.trimStart", () => editAtPlayhead(true)],
      ["editing.trimEnd", () => editAtPlayhead(false)],
      ["selection.selectAll", () => useUIStore.getState().selectMultiple(getTimelineSelectionItems(useProjectStore.getState().project))],
      ["selection.deselect", () => useUIStore.getState().clearSelection()],
      ["timeline.toggleSnap", () => useUIStore.getState().toggleSnap()],
      ["timeline.zoomIn", () => useTimelineStore.getState().zoomIn()],
      ["timeline.zoomOut", () => useTimelineStore.getState().zoomOut()],
      ["timeline.fitTimeline", () => useTimelineStore.getState().zoomToFit(timelineEnd() || 60)],
      ["view.showShortcuts", () => setShowShortcutsOverlay((open) => !open)],
      ["file.save", () => {
        if (saveInFlight) return;
        saveInFlight = true;
        // Invoke the picker in the initiating key event to retain user activation.
        const project = useProjectStore.getState().getFullProject();
        void projectManager.saveProject(project).then((saved) => {
          if (saved) toast.success("Project saved", project.name);
        }).catch((error: unknown) => {
          toast.error("Could not save project", error instanceof Error ? error.message : "Please try again.");
        }).finally(() => { saveInFlight = false; });
      }],
      ["file.export", () => useUIStore.getState().openModal("export")],
      ["tools.addText", () => {
        const time = useTimelineStore.getState().playheadPosition;
        void runEdit("Add title", async () => {
          const created = await insertTimelineOverlay(time, 5, (trackId) =>
            useProjectStore.getState().createTextClip(trackId, time, "New Title", 5, {
              fontSize: 96, fontWeight: 800, letterSpacing: -1,
            }),
          );
          if (created) {
            const ui = useUIStore.getState();
            ui.select({ id: created.id, trackId: created.trackId, type: "text-clip" });
            ui.setPanelVisible("inspector", true);
          }
        });
      }],
      ["tools.addMarker", () => {
        const store = useProjectStore.getState();
        store.addMarker(useTimelineStore.getState().playheadPosition, `Marker ${store.project.timeline.markers.length + 1}`, "#3b82f6");
      }],
    ];
    const unsubscribes = handlers.map(([action, handler]) => keyboardShortcuts.registerHandler(action, handler));
    keyboardShortcuts.startListening();
    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      keyboardShortcuts.stopListening();
    };
  }, []);

  return { showShortcutsOverlay, setShowShortcutsOverlay };
}
