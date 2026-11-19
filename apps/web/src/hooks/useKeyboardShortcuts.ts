import { addClipMarkerAtPlayhead } from "../services/clip-marker-commands";
import { v4 as uuidv4 } from "uuid";
import { planRippleTrimToPlayhead } from "@openreel/core";
import { useColorMonitorStore } from "../stores/color-monitor-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { renderCacheService } from "../services/render-cache-service";
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
import { editGraphicSelection, selectionHasGraphics } from "../services/graphic-commands";
import {
  deleteTimelineItem,
  getTimelineItemKind,
  getTimelineItemRanges,
  getSplittableTimelineItemIds,
  getTimelineSelectionItem,
  getTimelineSelectionItems,
  splitTimelineItem,
} from "../utils/timeline-item-actions";
import { stepEditingFrame, editingFrameStepSeconds } from "../components/editor/editing-frame-rate";
import { editableTimelineIds, editTimelineSelection } from "../services/linked-timeline-edit";
import { getLinkedTimelineSelection } from "../utils/linked-timeline-selection";
import { resolvePlaybackLoop } from "../utils/playback-loop";
import { openMediaImport } from "../services/open-media-import";
import {
  addMarkerAtPlayhead,
  clearAllMarkers,
  clearMarkerAtPlayhead,
  editMarkerAtPlayhead,
  goToNextMarker,
  goToPreviousMarker,
} from "../services/marker-commands";
import { openClipSpeedDialog } from "../services/clip-speed-multi";
import { flushEditorFieldDrafts } from "../services/editor-field-drafts";
import {
  addEditToAllTracks,
  addEditToTargetedTracks,
  extractRange,
  insertSelectedMedia,
  liftRange,
  matchFrame,
  reverseMatchFrame,
  overwriteSelectedMedia,
  pasteInsertClips,
  commit,
  getTargetedTrackIds,
  pickPasteTrack,
  runWithToast,
} from "../services/premiere-edit-commands";
import { fitToFillFromSource, replaceFromSource } from "../services/source-monitor-commands";
import {
  toggleSyncLockOnSelectedTrack,
  toggleTargetOnSelectedTrack,
} from "../services/track-targeting-commands";
import {
  openSelectedLinkedComposition,
  replaceSelectionWithLinkedComposition,
  restoreSelectedLinkedComposition,
} from "../services/linked-comp-commands";
import { renderSelectedLinkedComposition } from "../services/linked-comp-render";
import { toggleGainKeyframeAtPlayhead } from "../services/clip-gain-edit";
import { nudgeSelectedToolEdit } from "../services/timeline-tool-nudge";
import { useCollabStore } from "../services/collab/collab-store";
import { useEditPointStore } from "../stores/edit-point-store";
import {
  clearInOut,
  deleteSelectedGap,
  goToMark,
  markClip,
  trimSelectedEditPoint,
  trimStepFrames,
} from "../services/edit-point-commands";
import {
  cancelDynamicTrim,
  commitDynamicTrim,
  dynamicTrimAvailable,
  dynamicTrimFrameStep,
  dynamicTrimShuttle,
  isDynamicTrimActive,
} from "../services/dynamic-trim";
import {
  extendSelectedEdit,
  makeSplitEdit,
  nudgeSelectedEditSide,
} from "../services/split-edit-commands";

export function useKeyboardShortcuts() {
  const [showShortcutsOverlay, setShowShortcutsOverlay] = useState(false);

  useEffect(() => {
    // Read live state when a command runs. Subscribing this hook to the entire
    // timeline used to rerender the editor and reinstall every handler per frame.
    let editInFlight = false;
    let saveInFlight = false;
    const runSave = (asNew: boolean): void => {
      if (saveInFlight) return;
      saveInFlight = true;
      const state = useProjectStore.getState(), scope = { projectId: state.project.id, history: state.actionHistory };
      let project = state.project;
      let pending: Promise<void> | undefined;
      try { pending = flushEditorFieldDrafts(scope); project = useProjectStore.getState().getFullProject(); }
      catch (error) { saveInFlight = false; toast.error("Could not save project", error instanceof Error ? error.message : "Finish the current edit and try again."); return; }
      // Reserve the picker/stream in this key event; resolve queued edits before writing.
      const resolveProject = pending ? async () => {
        await pending;
        const latest = useProjectStore.getState();
        if (latest.project.id !== scope.projectId || latest.actionHistory !== scope.history) throw new Error("The project changed before its edits finished. Save the current project again.");
        project = latest.getFullProject(); return project;
      } : undefined;
      const saving = resolveProject ? (asNew ? projectManager.saveProjectAs(project, resolveProject) : projectManager.saveProject(project, resolveProject)) : (asNew ? projectManager.saveProjectAs(project) : projectManager.saveProject(project));
      void saving.then((saved) => {
        if (saved) toast.success(asNew ? "Project saved as a new file" : "Project saved", project.name);
      }).catch((error: unknown) => {
        toast.error("Could not save project", error instanceof Error ? error.message : "Please try again.");
      }).finally(() => { saveInFlight = false; });
    };
    const timelineEnd = () => useProjectStore.getState().getTimelineDuration();
    const editableIds = () => editableTimelineIds(useUIStore.getState().getSelectedClipIds());
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
        // A graphic is one bar: its layers are removed together, as one undo step.
        const graphics = selectionHasGraphics(ids)
          ? await editGraphicSelection(ids, "delete", 0)
          : { handled: false, ok: true, remaining: ids };
        if (graphics.handled && graphics.ok) {
          const rest = new Set(graphics.remaining);
          for (const id of ids) if (!rest.has(id)) removed.add(id);
        }
        for (const id of graphics.handled ? graphics.remaining : ids) {
          if (await deleteTimelineItem(useProjectStore.getState(), id)) removed.add(id);
        }
        const currentUI = useUIStore.getState();
        currentUI.selectMultiple(currentUI.selectedItems.filter((item) => !removed.has(item.id)));
      });
    };
    const splitAtPlayhead = () => {
      const time = useTimelineStore.getState().playheadPosition;
      const ids = getSplittableTimelineItemIds(useProjectStore.getState().project, editableIds(), time);
      if (!ids.length) return;
      void runEdit("Split clips", async () => {
        for (const id of ids) await splitTimelineItem(useProjectStore.getState(), id, time);
      });
    };
    // Q / W: Premiere "Ripple Trim Previous/Next Edit to Playhead". Selected
    // items under the playhead (with their linked partners) win; otherwise the
    // targeted tracks. One planned edit, so one undo step.
    const rippleTrimAtPlayhead = (trimStart: boolean) => {
      if (editInFlight) return;
      const time = useTimelineStore.getState().playheadPosition;
      const rawSelection = useUIStore.getState().getSelectedClipIds();
      const hasSelection = rawSelection.length > 0;
      const editable = hasSelection ? editableTimelineIds(rawSelection) : [];
      // A selection on a locked track must not fall back to every targeted track.
      if (hasSelection && !editable.length) return;
      const before = useProjectStore.getState().project;
      const selected = getSplittableTimelineItemIds(before, editable, time);
      const origins = new Map<string, { trackId: string; startTime: number }>();
      for (const track of before.timeline.tracks)
        for (const clip of track.clips)
          if (selected.includes(clip.id)) origins.set(clip.id, { trackId: track.id, startTime: clip.startTime });
      // A selection that is not under the playhead must not fall back to every targeted track.
      if (hasSelection && !selected.length) {
        toast.warning("Ripple trim blocked", "Nothing under the playhead to trim.");
        return;
      }
      const outcome = commit(
        (project) => planRippleTrimToPlayhead(
          project,
          time,
          trimStart,
          selected.length ? { itemIds: selected } : { trackIds: getTargetedTrackIds(project) },
          uuidv4(),
        ),
        "Nothing under the playhead to trim.",
      );
      if (!outcome.success && outcome.message) toast.warning("Ripple trim blocked", outcome.message);
      if (outcome.success && origins.size) keepTrimmedClipsSelected(origins);
    };
    // The splitter replaces the surviving piece (Q), so reselect whatever now
    // sits at the trimmed clip's original start; W can then follow Q.
    const keepTrimmedClipsSelected = (origins: Map<string, { trackId: string; startTime: number }>) => {
      const project = useProjectStore.getState().project;
      const ui = useUIStore.getState();
      const items = ui.selectedItems.filter((item) => !origins.has(item.id));
      const added: typeof items = [];
      for (const [id, origin] of origins) {
        const track = project.timeline.tracks.find((t) => t.id === origin.trackId);
        const clip = track?.clips.find((c) => c.id === id)
          ?? track?.clips.find((c) => Math.abs(c.startTime - origin.startTime) < 1e-3);
        if (clip) added.push({ id: clip.id, trackId: origin.trackId, type: "clip" } as (typeof items)[number]);
      }
      if (added.length) ui.selectMultiple([...items, ...added]);
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

    // Trim mode: with an edit point selected, , . < > trim it (Insert and
    // Overwrite keep , and . whenever no edit point is selected). A selected
    // gap takes Delete / Shift+Delete as a ripple delete.
    const editPointSelected = () => useEditPointStore.getState().selection?.type === "edit";
    const gapSelected = () => useEditPointStore.getState().selection?.type === "gap";
    const trimEditPoint = (direction: -1 | 1, large: boolean) =>
      runWithToast("Trim edit point", () => trimSelectedEditPoint(trimStepFrames(direction, large)));
    const deleteGap = () => runWithToast("Delete gap", deleteSelectedGap);

    // Dynamic trimming: with an edit point selected, J/L shuttle the trim, K or
    // Space commits it, and K held with J/L steps one frame.
    let kHeld = false;
    let stopKey = "k";
    const releaseK = () => { kHeld = false; };
    // The key comes from the (possibly rebound) Shuttle Stop binding; a blur
    // or a hidden tab would otherwise leave K "held" and J/L frame-stepping.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === stopKey) releaseK();
    };
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseK);
    document.addEventListener("visibilitychange", releaseK);
    const dynamicShuttle = (direction: -1 | 1): boolean => {
      if (!dynamicTrimAvailable()) return false;
      if (kHeld && !isDynamicTrimActive()) {
        runWithToast("Trim edit point", () => dynamicTrimFrameStep(direction));
      } else {
        runWithToast("Trim edit point", () => dynamicTrimShuttle(direction));
      }
      return true;
    };

    const handlers: Array<[string, ShortcutHandler]> = [
      ["playback.playPause", () => {
        if (isDynamicTrimActive()) {
          runWithToast("Trim edit point", () => commitDynamicTrim() ?? { success: true });
          return;
        }
        useTimelineStore.getState().togglePlayback();
      }],
      ["playback.shuttleBack", () => {
        if (dynamicShuttle(-1)) return;
        const state = useTimelineStore.getState();
        // No reverse playback engine: J halves a fast forward shuttle,
        // otherwise pauses and rewinds one second.
        if (state.playbackState === "playing" && state.playbackRate > 1) {
          state.setPlaybackRate(state.playbackRate / 2);
          return;
        }
        state.pause();
        state.setPlaybackRate(1);
        seekRelative(-1);
      }],
      ["playback.shuttleStop", (event) => {
        kHeld = true;
        if (event.key) stopKey = event.key.toLowerCase();
        if (isDynamicTrimActive()) {
          runWithToast("Trim edit point", () => commitDynamicTrim() ?? { success: true });
          return;
        }
        const state = useTimelineStore.getState();
        state.pause();
        state.setPlaybackRate(1);
      }],
      ["playback.shuttleForward", () => {
        if (dynamicShuttle(1)) return;
        const state = useTimelineStore.getState();
        if (state.playbackState === "playing") {
          state.setPlaybackRate(Math.min(4, state.playbackRate * 2));
          return;
        }
        state.setPlaybackRate(1);
        state.play();
      }],
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
      ["playback.markLoopStart", () => {
        if (timelineEnd() === 0) openMediaImport();
        else markLoopRange(true);
      }],
      ["playback.markLoopEnd", () => markLoopRange(false)],
      ["playback.markClip", () => runWithToast("Mark clip", markClip)],
      ["playback.goToIn", () => runWithToast("Go to In", () => goToMark("in"))],
      ["playback.goToOut", () => runWithToast("Go to Out", () => goToMark("out"))],
      ["playback.clearInOut", () => runWithToast("Clear In and Out", clearInOut)],
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
        const store = useProjectStore.getState();
        const ids = getLinkedTimelineSelection(store.project, useUIStore.getState().getSelectedClipIds(), useEditorWorkspaceStore.getState().linkedSelection);
        if (ids.length) store.copyClips(ids);
      }],
      ["editing.cut", () => void deleteSelection(true)],
      ["editing.paste", () => {
        const ui = useUIStore.getState();
        const store = useProjectStore.getState();
        const selectedTrackId = ui.selectedItems[0]?.trackId;
        // Targeted tracks win, then the selected track, then the first unlocked one.
        const destination = pickPasteTrack(store.project)
          ?? store.project.timeline.tracks.find((track) => track.id === selectedTrackId && !track.locked)
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
      ["editing.pasteInsert", () => runWithToast("Paste insert", pasteInsertClips)],
      ["editing.duplicate", () => {
        const ids = editableIds();
        if (!ids.length) return;
        void runEdit("Duplicate clips", async () => {
          await editTimelineSelection(ids, "duplicate");
        });
      }],
      ["editing.delete", () => { if (gapSelected()) deleteGap(); else void deleteSelection(false); }],
      ["editing.rippleDelete", () => {
        if (gapSelected()) { deleteGap(); return; }
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
          // One plan, one undo step; sync-locked tracks follow or block it.
          const result = await useProjectStore.getState().rippleDeleteClips(ids);
          if (!result.success) {
            toast.warning("Ripple delete blocked", result.error?.message);
            return;
          }
          const removed = new Set(ids);
          const ui = useUIStore.getState();
          ui.selectMultiple(ui.selectedItems.filter((item) => !removed.has(item.id)));
        });
      }],
      ["editing.addGainKeyframe", () => void toggleGainKeyframeAtPlayhead()],
      ["editing.split", () => splitAtPlayhead()],
      ["editing.trimStart", () => rippleTrimAtPlayhead(true)],
      ["editing.trimEnd", () => rippleTrimAtPlayhead(false)],
      ["editing.insert", () => {
        if (editPointSelected()) trimEditPoint(-1, false);
        else runWithToast("Insert", insertSelectedMedia);
      }],
      ["editing.overwrite", () => {
        if (editPointSelected()) trimEditPoint(1, false);
        else runWithToast("Overwrite", overwriteSelectedMedia);
      }],
      ["editing.replaceEdit", () => runWithToast("Replace", () => replaceFromSource())],
      ["editing.fitToFill", () => runWithToast("Fit to Fill", () => fitToFillFromSource())],
      ["editing.trimEditLeftLarge", () => trimEditPoint(-1, true)],
      ["editing.trimEditRightLarge", () => trimEditPoint(1, true)],
      ["editing.lift", () => runWithToast("Lift", liftRange)],
      ["editing.extract", () => runWithToast("Extract", extractRange)],
      ["editing.nudgeLeft", () => runWithToast("Nudge edit", () => nudgeSelectedToolEdit(-1, false))],
      ["editing.nudgeRight", () => runWithToast("Nudge edit", () => nudgeSelectedToolEdit(1, false))],
      ["editing.nudgeLeftLarge", () => runWithToast("Nudge edit", () => nudgeSelectedToolEdit(-1, true))],
      ["editing.nudgeRightLarge", () => runWithToast("Nudge edit", () => nudgeSelectedToolEdit(1, true))],
      ["editing.nudgeSideLeft", () => runWithToast("Nudge edit", () => nudgeSelectedEditSide(-1, false))],
      ["editing.nudgeSideRight", () => runWithToast("Nudge edit", () => nudgeSelectedEditSide(1, false))],
      ["editing.nudgeSideLeftLarge", () => runWithToast("Nudge edit", () => nudgeSelectedEditSide(-1, true))],
      ["editing.nudgeSideRightLarge", () => runWithToast("Nudge edit", () => nudgeSelectedEditSide(1, true))],
      ["editing.extendEdit", () => runWithToast("Extend edit", () => extendSelectedEdit("both"))],
      ["editing.extendEditVideo", () => runWithToast("Extend video edit", () => extendSelectedEdit("video"))],
      ["editing.extendEditAudio", () => runWithToast("Extend audio edit", () => extendSelectedEdit("audio"))],
      ["editing.jCut", () => runWithToast("J-cut", () => makeSplitEdit("j"))],
      ["editing.lCut", () => runWithToast("L-cut", () => makeSplitEdit("l"))],
      ["editing.addEditAllTracks", () => runWithToast("Add edit", addEditToAllTracks)],
      ["editing.addEdit", () => runWithToast("Add edit", addEditToTargetedTracks)],
      ["tracks.toggleTarget", () => runWithToast("Track target", toggleTargetOnSelectedTrack)],
      ["tracks.toggleSyncLock", () => void toggleSyncLockOnSelectedTrack().then((outcome) => {
        if (!outcome.success) toast.warning("Sync Lock", outcome.message);
      })],
      ["editing.matchFrame", () => runWithToast("Match frame", matchFrame)],
      ["editing.reverseMatchFrame", () => runWithToast("Reverse match frame", reverseMatchFrame)],
      ["editing.speedDuration", () => runWithToast("Speed/Duration", openClipSpeedDialog)],
      ["linked.replace", () => void replaceSelectionWithLinkedComposition()],
      ["linked.open", () => void openSelectedLinkedComposition()],
      ["linked.render", () => void renderSelectedLinkedComposition()],
      ["linked.restore", () => void restoreSelectedLinkedComposition()],
      ["selection.selectAll", () => useUIStore.getState().selectMultiple(getTimelineSelectionItems(useProjectStore.getState().project))],
      ["selection.deselect", () => {
        if (cancelDynamicTrim()) return;
        useEditPointStore.getState().clear();
        useUIStore.getState().clearSelection();
      }],
      ["timeline.selectionTool", () => useEditorWorkspaceStore.getState().setTimelineTool("select")],
      ["timeline.bladeTool", () => useEditorWorkspaceStore.getState().setTimelineTool("blade")],
      ["timeline.rippleTool", () => useEditorWorkspaceStore.getState().setTimelineTool("ripple")],
      ["timeline.slipTool", () => useEditorWorkspaceStore.getState().setTimelineTool("slip")],
      ["timeline.rollTool", () => useEditorWorkspaceStore.getState().setTimelineTool("roll")],
      ["timeline.slideTool", () => useEditorWorkspaceStore.getState().setTimelineTool("slide")],
      ["timeline.stretchTool", () => useEditorWorkspaceStore.getState().setTimelineTool("stretch")],
      ["timeline.trackSelectForwardTool", () => useEditorWorkspaceStore.getState().setTimelineTool("trackSelectForward")],
      ["timeline.trackSelectBackwardTool", () => useEditorWorkspaceStore.getState().setTimelineTool("trackSelectBackward")],
      ["timeline.handTool", () => useEditorWorkspaceStore.getState().setTimelineTool("hand")],
      ["timeline.zoomTool", () => useEditorWorkspaceStore.getState().setTimelineTool("zoom")],
      ["timeline.toggleSnap", () => useUIStore.getState().toggleSnap()],
      ["timeline.zoomIn", () => useTimelineStore.getState().zoomIn()],
      ["timeline.zoomOut", () => useTimelineStore.getState().zoomOut()],
      ["timeline.fitTimeline", () => useTimelineStore.getState().zoomToFit(timelineEnd() || 60)],
      ["sequence.renderInToOut", () => void renderCacheService.renderInToOut()],
      ["view.toggleScopes", () => useUIStore.getState().toggleScopes()],
      ["view.toggleProxies", () => { void import("../components/editor/preview/ProxyToggleButton").then((m) => m.toggleProxiesWithFeedback()); }],
      ["view.toggleComparison", () => useColorMonitorStore.getState().toggleComparison()],
      ["view.showShortcuts", () => setShowShortcutsOverlay((open) => !open)],
      ["file.saveAs", () => runSave(true)],
      ["collab.open", () => useCollabStore.getState().openDialog()],
      ["file.save", () => runSave(false)],
      ["file.import", openMediaImport],
      ["file.export", () => { if (window.openreel?.platform === "desktop") window.dispatchEvent(new CustomEvent("openreel:menu:export")); else useUIStore.getState().openModal("export"); }],
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
      ["tools.addMarker", () => { void addMarkerAtPlayhead(); }],
      ["tools.addClipMarker", () => { void addClipMarkerAtPlayhead(); }],
      ["tools.editMarker", editMarkerAtPlayhead],
      ["tools.nextMarker", () => { goToNextMarker(); }],
      ["tools.prevMarker", () => { goToPreviousMarker(); }],
      ["tools.clearMarker", () => { void clearMarkerAtPlayhead(); }],
      ["tools.clearAllMarkers", () => { void clearAllMarkers(); }],
    ];
    const unsubscribes = handlers.map(([action, handler]) => keyboardShortcuts.registerHandler(action, handler));
    keyboardShortcuts.startListening();
    return () => {
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseK);
      document.removeEventListener("visibilitychange", releaseK);
      cancelDynamicTrim();
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      keyboardShortcuts.stopListening();
    };
  }, []);

  return { showShortcutsOverlay, setShowShortcutsOverlay };
}
