import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { getPlaybackBridge } from "../../../bridges/playback-bridge";
import { useTimelineStore, ZOOM_PRESETS } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";

/** Keep the phone's centered view separate from the desktop's scroll and zoom. */
export function usePhoneTimeline(
  phone: boolean,
  viewport: RefObject<HTMLDivElement | null>,
  pixelsPerSecond: number,
  width: number,
) {
  const views = useRef({ desktop: { zoom: pixelsPerSecond, scroll: useTimelineStore.getState().scrollX }, phone: { zoom: 24, scroll: 0 } });
  const scrubEnd = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrolling = useRef(false);
  const pinching = useRef(false);

  const endScroll = useCallback(() => {
    if (scrubEnd.current !== null) clearTimeout(scrubEnd.current);
    scrubEnd.current = null;
    if (scrolling.current) {
      scrolling.current = false;
      getPlaybackBridge().endScrubbing();
    }
  }, []);

  useLayoutEffect(() => {
    const element = viewport.current;
    const view = views.current[phone ? "phone" : "desktop"];
    useTimelineStore.getState().setZoom(view.zoom);
    if (!phone && element) {
      element.scrollLeft = view.scroll;
      useTimelineStore.getState().setScrollX(view.scroll);
    }
    return () => {
      const state = useTimelineStore.getState();
      view.zoom = state.pixelsPerSecond;
      view.scroll = element?.scrollLeft ?? state.scrollX;
      endScroll();
    };
  }, [phone, viewport, endScroll]);

  useLayoutEffect(() => {
    const follow = () => {
      const element = viewport.current;
      if (!element) return;
      const state = useTimelineStore.getState();
      const target = state.playheadPosition * state.pixelsPerSecond;
      if (phone) {
        if (scrolling.current || pinching.current) return;
        element.scrollLeft = target;
        if (Math.abs(state.scrollX - target) > 0.5) state.setScrollX(target);
      } else if (state.playbackState === "playing") {
        const margin = Math.min(Math.max(width * 0.12, 60), 220);
        if (target > state.scrollX + width - margin || target < state.scrollX) {
          element.scrollLeft = Math.max(0, target - margin);
        }
      }
    };
    follow();
    // Playback moves the viewport directly. Editing controls do not need a
    // React render for every frame; only an actual scroll changes their view.
    return useTimelineStore.subscribe(follow);
  }, [phone, viewport, pixelsPerSecond, width]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!phone || !element) return;
    const observer = new ResizeObserver(() => {
      // A display:none timeline cannot accept a scroll offset. Restore the
      // latest preview position when its retained panel becomes visible again.
      if (!element.clientWidth || scrolling.current || pinching.current) return;
      const state = useTimelineStore.getState();
      element.scrollLeft = state.playheadPosition * state.pixelsPerSecond;
      if (Math.abs(state.scrollX - element.scrollLeft) > 0.5) state.setScrollX(element.scrollLeft);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [phone, viewport]);

  const onScroll = useCallback((left: number) => {
    if (!phone || pinching.current) return;
    const state = useTimelineStore.getState();
    // Some engines round scrollLeft to a whole CSS pixel.
    if (Math.abs(left - state.playheadPosition * state.pixelsPerSecond) <= 1) return;
    if (state.playbackLockedReason || useUIStore.getState().exportState.isExporting) {
      if (viewport.current) viewport.current.scrollLeft = state.playheadPosition * state.pixelsPerSecond;
      return;
    }
    if (!scrolling.current) {
      scrolling.current = true;
      getPlaybackBridge().startScrubbing();
    }
    getPlaybackBridge().scrubTo(left / state.pixelsPerSecond);
    if (scrubEnd.current !== null) clearTimeout(scrubEnd.current);
    // Includes inertial scrolling after the finger lifts.
    scrubEnd.current = setTimeout(endScroll, 120);
  }, [phone, endScroll, viewport]);

  useEffect(() => {
    const element = viewport.current;
    if (!phone || !element) return;
    let initial: { distance: number; zoom: number } | null = null;
    const distance = (touches: TouchList) => Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      // A trim/move handle owns its finger until release. Do not change the
      // zoom beneath its time conversion when another finger touches down.
      if (Array.from(event.touches).some(touch => touch.target instanceof Element
        && touch.target.closest("[data-timeline-trim], [data-timeline-move]"))) return;
      event.preventDefault();
      endScroll();
      pinching.current = true;
      initial = { distance: Math.max(1, distance(event.touches)), zoom: useTimelineStore.getState().pixelsPerSecond };
    };
    const move = (event: TouchEvent) => {
      if (!initial || event.touches.length !== 2) return;
      event.preventDefault();
      const state = useTimelineStore.getState();
      const zoom = Math.max(ZOOM_PRESETS.MIN, Math.min(ZOOM_PRESETS.MAX,
        initial.zoom * distance(event.touches) / initial.distance));
      state.setZoom(zoom);
      // The playhead remains the anchor as the thumbnails spread beneath it.
      element.scrollLeft = state.playheadPosition * zoom;
      state.setScrollX(element.scrollLeft);
    };
    const end = (event: TouchEvent) => {
      if (event.touches.length >= 2) return;
      initial = null;
      pinching.current = false;
    };
    element.addEventListener("touchstart", start, { passive: false });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end);
    element.addEventListener("touchcancel", end);
    return () => {
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", end);
      pinching.current = false;
      endScroll();
    };
  }, [phone, viewport, endScroll]);

  return onScroll;
}
