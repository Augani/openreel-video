import { useEffect, useRef } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
} from "react";
import {
  chooseNudgeEdge,
  NUDGE_FRAMES,
  NUDGE_FRAMES_LARGE,
  prepareEdgeMove,
  prepareMultiRateStretch,
  prepareTimelineToolEdit,
  sideOfTrack,
  type TimelineToolMode,
} from "@openreel/core";
import { v4 as uuidv4 } from "uuid";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { toast } from "../../../stores/notification-store";
import { getLinkedTimelineSelection } from "../../../utils/linked-timeline-selection";
import { describeToolPreview, formatSignedDelta } from "./timeline-tool-readout";
import { commitNudgePlan } from "../../../services/timeline-tool-nudge";
import { useTimelineToolPreview } from "./timeline-tool-preview";

const EDGE_MODES = ["ripple", "roll", "stretch"];
const BODY_MODES = ["slip", "slide"];
const isToolMode = (mode: string): mode is TimelineToolMode =>
  EDGE_MODES.includes(mode) || BODY_MODES.includes(mode);
const locked = () =>
  Boolean(useTimelineStore.getState().playbackLockedReason) ||
  useUIStore.getState().exportState.isExporting;
export function useTimelineToolGesture(
  lane: RefObject<HTMLDivElement | null>,
  pixelsPerSecond: number,
  onSelect: (id: string, additive: boolean) => void,
) {
  const mode = useEditorWorkspaceStore((state) => state.timelineTool);
  const active = useRef<{ cancel: () => void } | null>(null);
  const suppressClick = useRef(false),
    ignoreMouseUntil = useRef(0);
  useEffect(() => () => active.current?.cancel(), [mode]);
  const prepare = (
    id: string,
    tool: TimelineToolMode,
    edge: "left" | "right",
    unlinked = false,
    ripple = true,
  ) => {
    const state = useProjectStore.getState();
    const project = state.getFullProject();
    if (unlinked) {
      // Alt-drag: this clip's edge only (a rolling edit of just its track at a
      // cut). Its linked partners stay put, so the pair becomes a J/L split.
      const edit = prepareEdgeMove(project, { clipId: id, edge });
      return {
        prepared: {
          primary: edit.primary as ReturnType<typeof prepareTimelineToolEdit>["primary"],
          mode: tool,
          preview: edit.preview,
          plan: edit.plan,
        },
        owner: state.project,
        executor: state.actionExecutor,
        tracks: state.project.timeline.tracks,
        modifiedAt: state.project.modifiedAt,
      };
    }
    const linkedIds = getLinkedTimelineSelection(
      project,
      [id],
      useEditorWorkspaceStore.getState().linkedSelection,
    );
    // Rate Stretch on a multi-selection: every selected clip (and linked
    // audio) is scaled by the primary's drag, trailing clips ripple.
    const selection = new Set(useUIStore.getState().getSelectedClipIds());
    const mediaSelected = project.timeline.tracks
      .flatMap((track) => track.clips)
      .filter((clip) => selection.has(clip.id));
    if (tool === "stretch" && mediaSelected.length > 1 && selection.has(id)) {
      const multi = prepareMultiRateStretch(project, {
        itemId: id,
        // Linked audio always stretches with its picture.
        clipIds: getLinkedTimelineSelection(project, mediaSelected.map((clip) => clip.id), true),
        edge,
        ripple,
      });
      const primary = project.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id)!;
      return {
        prepared: {
          primary: primary as ReturnType<typeof prepareTimelineToolEdit>["primary"],
          mode: tool,
          preview: multi.preview,
          plan: (delta: number) => multi.plan(delta, uuidv4()),
        },
        owner: state.project,
        executor: state.actionExecutor,
        tracks: state.project.timeline.tracks,
        modifiedAt: state.project.modifiedAt,
      };
    }
    return {
      prepared: prepareTimelineToolEdit(project, {
        mode: tool,
        itemId: id,
        linkedIds,
        edge,
      }),
      owner: state.project,
      executor: state.actionExecutor,
      tracks: state.project.timeline.tracks,
      modifiedAt: state.project.modifiedAt,
    };
  };
  const start = (
    event: ReactMouseEvent<HTMLDivElement> | ReactPointerEvent<HTMLDivElement>,
    pointerId: number | null,
  ) => {
    suppressClick.current = false;
    const element = (event.target as Element).closest<HTMLElement>(
      "[data-timeline-item-id]",
    );
    const edge = (event.target as Element).closest<HTMLElement>(
      "[data-timeline-trim]",
    )?.dataset.timelineTrim as "left" | "right" | undefined;
    // Alt-drag on a clip's trim handle (Selection tool): trim only this side of
    // a linked pair, the basis of J-cuts and L-cuts.
    const altSplit = event.altKey && mode === "select" && Boolean(edge);
    if (!isToolMode(mode) && !altSplit) return;
    if (!element || !lane.current?.contains(element) || event.button !== 0)
      return;
    const id = element.dataset.timelineItemId!;
    // Edge tools never edit from the clip body; only their trim handles do.
    if (EDGE_MODES.includes(mode) && !edge) {
      event.stopPropagation();
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    if (locked() || active.current) return;
    let context: ReturnType<typeof prepare>;
    try {
      // Alt on the Rate Stretch tool switches ripple off for a multi-selection.
      context = prepare(
        id,
        altSplit ? "roll" : (mode as TimelineToolMode),
        edge ?? "right",
        altSplit,
        !(mode === "stretch" && event.altKey),
      );
    } catch (error) {
      toast.warning(
        "Cannot edit this item",
        error instanceof Error ? error.message : "Try again.",
      );
      return;
    }
    const noRipple = mode === "stretch" && event.altKey;
    const startX = event.clientX;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const initialX = startX - lane.current.getBoundingClientRect().left;
    const sign =
      mode === "slip"
        ? "reversed" in context.prepared.primary &&
          context.prepared.primary.reversed
          ? 1
          : -1
        : 1;
    let moved = false,
      raf: number | null = null,
      lastX = event.clientX,
      stopped = false;
    const cursor = document.body.style.cursor;
    const owns = () => {
      const state = useProjectStore.getState();
      return (
        !locked() &&
        state.hasOpenProject &&
        state.project === context.owner &&
        state.actionExecutor === context.executor &&
        state.project.timeline.tracks === context.tracks &&
        state.project.modifiedAt === context.modifiedAt
      );
    };
    const delta = () =>
      ((lastX - (lane.current?.getBoundingClientRect().left ?? 0) - initialX) /
        pixelsPerSecond) *
      sign;
    const preview = () => {
      if (stopped || !moved) return;
      if (!owns()) {
        cleanup();
        return;
      }
      const value = context.prepared.preview(delta());
      const rate = context.owner.settings.frameRate;
      const readout = describeToolPreview(altSplit ? "roll" : (mode as TimelineToolMode), value, rate);
      if (altSplit) {
        const own = context.owner.timeline.tracks.find(
          (track) => track.id === context.prepared.primary.trackId,
        );
        const side = own && sideOfTrack(own) === "audio" ? "Audio" : "Video";
        readout.label = `${side} only ${formatSignedDelta(value.delta, rate)} (${Math.round(value.delta * rate)}f)`;
      }
      const neighbors = (value.neighbors ?? (value.neighbor ? [value.neighbor] : [])).map(
        (neighbor, index) => ({ ...neighbor, label: readout.neighbors[index] }),
      );
      if (mode === "stretch" && noRipple && (value.neighbors?.length ?? 0) > 0)
        readout.label += " · no ripple";
      useTimelineToolPreview.getState().setGhost({
        trackId: context.prepared.primary.trackId!,
        startTime: value.startTime,
        duration: value.duration,
        neighbor: neighbors[0],
        neighbors,
        label: readout.label,
      });
    };
    const match = (input: MouseEvent | PointerEvent) =>
      pointerId === null
        ? !("pointerId" in input)
        : "pointerId" in input && input.pointerId === pointerId;
    const move = (input: MouseEvent | PointerEvent) => {
      if (!match(input) || stopped) return;
      if (!owns()) {
        cleanup();
        return;
      }
      lastX = input.clientX;
      if (!moved && Math.abs(lastX - startX) >= 3) {
        moved = true;
        onSelect(id, additive);
      }
      if (moved && raf === null)
        raf = requestAnimationFrame(() => {
          raf = null;
          preview();
        });
    };
    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      if (raf !== null) cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      if (pointerId !== null && lane.current?.hasPointerCapture?.(pointerId))
        lane.current.releasePointerCapture?.(pointerId);
      document.body.style.cursor = cursor;
      useTimelineToolPreview.getState().setGhost(null);
      active.current = null;
    };
    const finish = (input: MouseEvent | PointerEvent) => {
      if (!match(input) || stopped) return;
      lastX = input.clientX;
      suppressClick.current = moved;
      if (moved && owns()) {
        try {
          const result = useProjectStore
            .getState()
            .commitTimelineToolEdit(context.prepared.plan(delta()));
          if (!result.success)
            throw new Error(
              result.error?.message ?? "The edit could not be applied.",
            );
        } catch (error) {
          toast.error(
            "Timeline edit failed",
            error instanceof Error ? error.message : "Try again.",
          );
        }
      }
      cleanup();
    };
    const cancel = (input?: Event) => {
      if (
        input &&
        "pointerId" in input &&
        (input as PointerEvent).pointerId !== pointerId
      )
        return;
      cleanup();
    };
    const key = (input: globalThis.KeyboardEvent) => {
      if (
        input.key === "Escape" ||
        ((input.metaKey || input.ctrlKey) && input.key.toLowerCase() === "z")
      ) {
        cleanup();
        if (input.key === "Escape") {
          input.preventDefault();
          input.stopPropagation();
        }
      }
    };
    active.current = { cancel };
    document.body.style.cursor = !altSplit && BODY_MODES.includes(mode) ? "col-resize" : "ew-resize";
    useTimelineStore.getState().pause();
    if (pointerId !== null) lane.current.setPointerCapture?.(pointerId);
    window.addEventListener("mousemove", move);
    window.addEventListener("pointermove", move);
    window.addEventListener("mouseup", finish);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
  };
  return {
    onMouseDownCapture(event: ReactMouseEvent<HTMLDivElement>) {
      suppressClick.current = false;
      if (
        performance.now() < ignoreMouseUntil.current &&
        isToolMode(mode)
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      start(event, null);
    },
    onPointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
      suppressClick.current = false;
      if (event.pointerType && event.pointerType !== "mouse") {
        ignoreMouseUntil.current = performance.now() + 1000;
        start(event, event.pointerId);
      }
    },
    onClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
      if (suppressClick.current) {
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onKeyDownCapture(event: ReactKeyboardEvent<HTMLDivElement>) {
      if (
        !isToolMode(mode) ||
        event.metaKey ||
        event.ctrlKey ||
        !["ArrowLeft", "ArrowRight"].includes(event.key)
      )
        return;
      const element = (event.target as Element).closest<HTMLElement>(
        "[data-timeline-item-id]",
      );
      if (!element || locked()) return;
      event.preventDefault();
      event.stopPropagation();
      active.current?.cancel();
      try {
        const itemId = element.dataset.timelineItemId!;
        let context = prepare(itemId, mode, "right");
        // Alt+Arrow is the global nudge: edit point nearest the playhead, 1 or
        // 5 frames. Plain arrows keep the 1/10-frame right-edge behaviour.
        if (
          event.altKey &&
          chooseNudgeEdge(
            context.prepared.primary,
            useTimelineStore.getState().playheadPosition,
          ) === "left"
        )
          context = prepare(itemId, mode, "left");
        const sign =
          mode === "slip"
            ? "reversed" in context.prepared.primary &&
              context.prepared.primary.reversed
              ? 1
              : -1
            : 1;
        const amount =
          ((event.key === "ArrowRight" ? 1 : -1) *
            sign *
            (event.altKey
              ? event.shiftKey
                ? NUDGE_FRAMES_LARGE
                : NUDGE_FRAMES
              : event.shiftKey
                ? 10
                : 1)) /
          context.owner.settings.frameRate;
        const result = commitNudgePlan(context.prepared.plan(amount));
        if (!result.success) throw new Error(result.error?.message);
      } catch (error) {
        toast.warning(
          "Cannot edit this item",
          error instanceof Error ? error.message : "Try again.",
        );
      }
    },
  };
}
