import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import {
  planTrackSelect,
  zoomAtPoint,
  zoomToRange,
  type TrackSelectItem,
  type ViewState,
} from "@openreel/core";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore, ZOOM_PRESETS } from "../../../stores/timeline-store";
import { useUIStore, type SelectionItem } from "../../../stores/ui-store";

/** Click zoom step; matches the toolbar's Zoom in button. */
const CLICK_ZOOM = 1.5;
/** Pointer travel (px) before a Zoom-tool press becomes a range drag. */
const DRAG_THRESHOLD = 4;
const LIMITS = { min: ZOOM_PRESETS.MIN, max: ZOOM_PRESETS.MAX };

export type TimelineToolName = ReturnType<
  typeof useEditorWorkspaceStore.getState
>["timelineTool"];

export function trackSelectDirection(
  tool: TimelineToolName,
): "forward" | "backward" | null {
  return tool === "trackSelectForward"
    ? "forward"
    : tool === "trackSelectBackward"
      ? "backward"
      : null;
}

const selectionType = (item: TrackSelectItem): SelectionItem["type"] =>
  item.kind === "media" ? "clip" : item.kind === "text" ? "text-clip" : "shape-clip";

/**
 * Track Select: select `anchorId` and everything after (forward) or before
 * (backward) it on every unlocked track, or only on its own track (shift).
 * Selection only; the project is untouched until the user moves or deletes.
 */
export function applyTrackSelect(
  anchorId: string,
  direction: "forward" | "backward",
  trackOnly: boolean,
): void {
  const project = useProjectStore.getState().getFullProject();
  const items = planTrackSelect(project, anchorId, { direction, trackOnly });
  useUIStore.getState().selectMultiple(
    items.map((item) => ({ id: item.id, trackId: item.trackId, type: selectionType(item) })),
  );
}

/**
 * Hand tool (drag to pan), Zoom tool (click zoom in, alt-click zoom out, drag a
 * range to fit it) and the Track Select tools' pointer-down selection, as
 * capture-phase handlers for the timeline's scroll container. Selection on
 * pointer-down (rather than click) lets a following drag move the whole
 * selection as the one move gesture.
 */
export function useTimelineNavTools(
  scroll: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const tool = useEditorWorkspaceStore((state) => state.timelineTool);
  const [zoomBand, setZoomBand] = useState<{ left: number; width: number } | null>(null);
  const cancelActive = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelActive.current?.(), [tool]);

  // Alt flips the Zoom tool's cursor to zoom-out.
  useEffect(() => {
    if (tool !== "zoom") return;
    const sync = (event: KeyboardEvent) =>
      scroll.current?.setAttribute("data-zoom-out", String(event.altKey));
    const clear = () => scroll.current?.setAttribute("data-zoom-out", "false");
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
      clear();
    };
  }, [tool, scroll]);

  const applyView = useCallback(
    (el: HTMLElement, view: ViewState) => {
      useTimelineStore.getState().setZoom(view.pixelsPerSecond);
      // The lanes widen on the next render; set the scroll once they have.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          el.scrollLeft = view.scrollX;
        }),
      );
    },
    [],
  );

  const startPan = (el: HTMLElement, event: ReactMouseEvent) => {
    const origin = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
    const previousCursor = document.body.style.cursor;
    const move = (input: MouseEvent) => {
      el.scrollLeft = origin.left - (input.clientX - origin.x);
      el.scrollTop = origin.top - (input.clientY - origin.y);
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("blur", stop);
      document.body.style.cursor = previousCursor;
      cancelActive.current = null;
    };
    document.body.style.cursor = "grabbing";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", stop);
    cancelActive.current = stop;
  };

  const startZoom = (el: HTMLElement, event: ReactMouseEvent) => {
    const rect = el.getBoundingClientRect();
    const startX = event.clientX - rect.left;
    const startContentX = startX + el.scrollLeft;
    let dragged = false;
    let lastX = startX;
    const move = (input: MouseEvent) => {
      lastX = Math.max(0, Math.min(el.clientWidth, input.clientX - rect.left));
      if (!dragged && Math.abs(lastX - startX) >= DRAG_THRESHOLD) dragged = true;
      if (dragged) {
        const endContentX = lastX + el.scrollLeft;
        setZoomBand({
          left: Math.min(startContentX, endContentX),
          width: Math.abs(endContentX - startContentX),
        });
      }
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", stop);
      setZoomBand(null);
      cancelActive.current = null;
    };
    const finish = (input: MouseEvent) => {
      const { pixelsPerSecond, scrollX } = useTimelineStore.getState();
      if (dragged) {
        const endContentX = lastX + el.scrollLeft;
        const view = zoomToRange(
          Math.min(startContentX, endContentX) / pixelsPerSecond,
          Math.max(startContentX, endContentX) / pixelsPerSecond,
          el.clientWidth,
          LIMITS,
        );
        if (view) applyView(el, view);
      } else {
        const factor = input.altKey ? 1 / CLICK_ZOOM : CLICK_ZOOM;
        const view = zoomAtPoint({ pixelsPerSecond, scrollX: el.scrollLeft || scrollX }, startX, factor, LIMITS);
        if (view.pixelsPerSecond !== pixelsPerSecond) applyView(el, view);
      }
      stop();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", finish);
    window.addEventListener("blur", stop);
    cancelActive.current = stop;
  };

  const onMouseDownCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0) return;
    const el = scroll.current;
    if (!el) return;
    const direction = trackSelectDirection(tool);
    if (direction) {
      const target = event.target as Element;
      if (target.closest("[data-timeline-trim]")) return;
      const id = target.closest<HTMLElement>("[data-timeline-item-id]")?.dataset.timelineItemId;
      if (id) applyTrackSelect(id, direction, event.shiftKey);
      return;
    }
    if (tool !== "hand" && tool !== "zoom") return;
    // Leave the scrollbars alone.
    const rect = el.getBoundingClientRect();
    if (event.clientX - rect.left > el.clientWidth || event.clientY - rect.top > el.clientHeight) return;
    event.preventDefault();
    event.stopPropagation();
    cancelActive.current?.();
    if (tool === "hand") startPan(el, event);
    else startZoom(el, event);
  };

  // These tools never select or open anything by clicking a clip.
  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!enabled || (tool !== "hand" && tool !== "zoom")) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return { tool, zoomBand, handlers: { onMouseDownCapture, onClickCapture } };
}
