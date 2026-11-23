import React, { useCallback, useEffect, useRef } from "react";
import { isVrProperties, type VrFrameLayout } from "@openreel/core";
import { DEFAULT_VR_VIEW, vrViewWindow, VR_VIEW_FOV_RANGE } from "@openreel/core/video/vr-view-params";
import { useProjectStore } from "../../../stores/project-store";
import { useVrViewStore, type VrViewStore } from "../../../stores/vr-view-store";
import { getPreviewCanvas } from "../scopes/preview-canvas-registry";

/**
 * Program monitor VR view (Premiere's "Toggle VR Video Display"): a rectilinear window onto the equirectangular
 * program frame. Drag to pan and tilt, scroll to change the field of view, Reset to go back to straight ahead.
 * DOM-only like the comparison view: the Program canvas, the scopes and every export keep the real equirect frame, and
 * nothing here is stored in the project.
 */
type VrViewModule = typeof import("@openreel/core/video/vr-view");

const FRAME_INTERVAL_MS = 1000 / 30;

interface VrViewProps {
  layout: VrFrameLayout;
  /** The equirect frame to look into (the Program canvas, or a canvas the Source monitor draws its video into). */
  getSource: () => HTMLCanvasElement | null;
  store: VrViewStore;
  /** Test id prefix: "vr" (Program monitor) or "source-vr". */
  idPrefix: string;
  label: string;
}

export const VrView: React.FC<VrViewProps> = ({ layout, getSource, store, idPrefix, label }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const moduleRef = useRef<VrViewModule | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const view = store((state) => state.view);
  const nudge = store((state) => state.nudge);
  const setFov = store((state) => state.setFov);
  const reset = store((state) => state.reset);
  const setEnabled = store((state) => state.setEnabled);

  useEffect(() => {
    let cancelled = false;
    // The view renders with the VR effects runtime (a lazy chunk): it is ready before the first draw.
    void import("@openreel/core/video/vr-view").then(async (mod) => {
      await mod.prepareVrView();
      if (!cancelled) moduleRef.current = mod;
    });
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < FRAME_INTERVAL_MS) return;
      last = now;
      const mod = moduleRef.current;
      const overlay = canvasRef.current;
      const source = getSource();
      if (!mod || !overlay || !source || !source.width || !source.height) return;
      const current = store.getState().view;
      const params = { ...DEFAULT_VR_VIEW, ...current, layout };
      const result = mod.renderVrView(source, params);
      if (!result) return;
      const win = vrViewWindow(source.width, source.height, params.aspect);
      const w = Math.max(1, Math.round(win.w));
      const h = Math.max(1, Math.round(win.h));
      if (overlay.width !== w || overlay.height !== h) {
        overlay.width = w;
        overlay.height = h;
      }
      const ctx = overlay.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(result as HTMLCanvasElement, win.x, win.y, win.w, win.h, 0, 0, w, h);
      overlay.dataset.drawn = String(Number(overlay.dataset.drawn ?? 0) + 1);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [layout, getSource, store]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY };
  }, []);
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const fov = store.getState().view.fov;
      const vFov = fov * (rect.height / Math.max(1, rect.width));
      // Dragging moves the picture with the pointer, so the camera moves the other way.
      nudge(-((event.clientX - drag.x) / Math.max(1, rect.width)) * fov, ((event.clientY - drag.y) / Math.max(1, rect.height)) * vFov);
      dragRef.current = { x: event.clientX, y: event.clientY };
    },
    [nudge, store],
  );
  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);
  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const fov = store.getState().view.fov;
      setFov(fov * (event.deltaY > 0 ? 1.06 : 1 / 1.06));
    },
    [setFov, store],
  );

  return (
    <div
      data-testid={`${idPrefix}-monitor-overlay`}
      data-pan={view.pan.toFixed(2)}
      data-tilt={view.tilt.toFixed(2)}
      data-fov={view.fov.toFixed(2)}
      className="absolute inset-0 z-10 cursor-grab overflow-hidden rounded-[10px] bg-black active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <canvas ref={canvasRef} aria-label={`VR view of the ${label} frame`} className="h-full w-full object-contain" />
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/85">
        VR view: pan {view.pan.toFixed(0)}° tilt {view.tilt.toFixed(0)}° fov {view.fov.toFixed(0)}°
      </div>
      <div className="absolute right-2 top-2 flex gap-1" onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          data-testid={`${idPrefix}-view-reset`}
          className="rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white/90 hover:bg-black/80"
          onClick={reset}
        >
          Reset view
        </button>
        <button
          type="button"
          data-testid={`${idPrefix}-view-close`}
          className="rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white/90 hover:bg-black/80"
          onClick={() => setEnabled(false)}
        >
          Exit VR view
        </button>
      </div>
      <span className="sr-only">Field of view limits {VR_VIEW_FOV_RANGE.min} to {VR_VIEW_FOV_RANGE.max} degrees</span>
    </div>
  );
};

/** Mounted in the Program monitor; renders only while the VR view is on and the sequence is a VR sequence. */
export const VrMonitorOverlay: React.FC = () => {
  const enabled = useVrViewStore((state) => state.enabled);
  const vr = useProjectStore((state) => state.project.settings.vr);
  if (!enabled || !isVrProperties(vr)) return null;
  return <VrView layout={vr.layout} getSource={getPreviewCanvas} store={useVrViewStore} idPrefix="vr" label="program" />;
};
