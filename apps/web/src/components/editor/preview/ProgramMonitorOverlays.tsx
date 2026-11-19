import React, { useCallback, useEffect, useRef } from "react";
import {
  ultraKeyColorFromSample,
  qualifierFromSample,
  readQualifier,
  sampleAverageRgb,
  MATTE_VIEW_BYPASS,
} from "@openreel/core";
import { getEffectsBridge } from "../../../bridges/effects-bridge";
import { useColorMonitorStore } from "../../../stores/color-monitor-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import {
  getReferenceImage,
  refreshReference,
} from "../../../services/comparison-service";
import { getPreviewCanvas } from "../scopes/preview-canvas-registry";
import { applyFalseColor, FALSE_COLOR_BANDS } from "@openreel/core/video/scopes-extra";
import { refreshProgramFrame } from "./program-frame-control";
import { DroppedFrameIndicator } from "./DroppedFrameIndicator";
import { WhiteBalanceEyedropperLayer } from "./WhiteBalanceEyedropperLayer";

/**
 * Program monitor overlays: the comparison view (side by side / wipe) and the
 * HSL Secondary eyedropper. Both are DOM-only: the Program canvas, the scopes
 * and every export keep reading the real graded frame.
 */

/** Keeps the effects bridge in step with the matte view / eyedropper state. */
function useSecondaryViewSync(): void {
  const secondary = useColorMonitorStore((state) => state.secondary);
  const lastEffectId = useRef<string | null>(null);

  useEffect(() => {
    const bridge = getEffectsBridge();
    if (lastEffectId.current && lastEffectId.current !== secondary.effectId) {
      bridge.setTransientEffectParams(lastEffectId.current, null);
    }
    lastEffectId.current = secondary.effectId;
    if (!secondary.effectId) return;
    const view = secondary.eyedropper ? MATTE_VIEW_BYPASS : secondary.matteView;
    bridge.setTransientEffectParams(
      secondary.effectId,
      view === 0 ? null : { matteView: view },
    );
    void refreshProgramFrame(useTimelineStore.getState().playheadPosition);
  }, [secondary]);

  useEffect(
    () => () => {
      if (lastEffectId.current) {
        getEffectsBridge().setTransientEffectParams(lastEffectId.current, null);
      }
    },
    [],
  );
}

/**
 * While the Ultra Key picker is armed the keyed effect shows its source, so the pick samples the
 * unkeyed frame; disarming (or leaving the clip) restores the live key.
 */
function useKeyPickerSync(): void {
  const picker = useColorMonitorStore((state) => state.keyPicker);
  useEffect(() => {
    if (!picker) return undefined;
    const bridge = getEffectsBridge();
    bridge.setTransientEffectParams(picker.effectId, { output: "source" });
    void refreshProgramFrame(useTimelineStore.getState().playheadPosition);
    return () => {
      bridge.setTransientEffectParams(picker.effectId, null);
      void refreshProgramFrame(useTimelineStore.getState().playheadPosition);
    };
  }, [picker]);
}

const KeyPickerLayer: React.FC = () => {
  const picker = useColorMonitorStore((state) => state.keyPicker);
  const setKeyPicker = useColorMonitorStore((state) => state.setKeyPicker);

  useEffect(() => {
    if (!picker) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setKeyPicker(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picker, setKeyPicker]);

  if (!picker) return null;

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const source = getPreviewCanvas();
    if (!source || source.width === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * source.width;
    const y = ((event.clientY - rect.top) / rect.height) * source.height;
    const scratch = document.createElement("canvas");
    scratch.width = source.width;
    scratch.height = source.height;
    const ctx = scratch.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(source, 0, 0);
    const image = ctx.getImageData(0, 0, scratch.width, scratch.height);
    const [r, g, b] = sampleAverageRgb(image.data, image.width, image.height, x, y, 3);
    const store = useProjectStore.getState();
    const effect = store.getVideoEffect(picker.clipId, picker.effectId);
    setKeyPicker(null);
    if (!effect) return;
    void store.updateVideoEffect(
      picker.clipId,
      picker.effectId,
      ultraKeyColorFromSample({ r: r * 255, g: g * 255, b: b * 255 }),
    );
  };

  return (
    <div
      data-testid="ultra-key-picker-layer"
      aria-label="Key colour picker. Click the Program monitor to sample the key colour, Escape cancels."
      className="absolute inset-0 z-40 cursor-crosshair rounded-[10px] ring-2 ring-accent"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        pick(event);
      }}
    />
  );
};

/**
 * Mounted only while a comparison mode is on, so the playhead / project
 * subscriptions below never re-render the Program monitor on every tick when
 * the comparison view is closed.
 */
const ComparisonOverlayGate: React.FC = () => {
  const mode = useColorMonitorStore((state) => state.comparison.mode);
  const wasActive = useRef(false);
  useEffect(() => {
    // Closing the view drops the held reference frame.
    if (wasActive.current && mode === "off") void refreshReference();
    wasActive.current = mode !== "off";
  }, [mode]);
  return mode === "off" ? null : <ComparisonOverlay />;
};

const ComparisonOverlay: React.FC = () => {
  const comparison = useColorMonitorStore((state) => state.comparison);
  const setComparison = useColorMonitorStore((state) => state.setComparison);
  const busy = useColorMonitorStore((state) => state.captureBusy);
  const stills = useColorMonitorStore((state) => state.stills);
  const referenceRevision = useColorMonitorStore((state) => state.referenceRevision);
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const project = useProjectStore((state) => state.project);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasReferenceRef = useRef(false);
  const active = true;

  // Keep the live reference (ungraded / pinned playhead) current.
  const refreshKey = `${comparison.reference}|${comparison.refTime}|${comparison.reference === "bypass" ? playhead : 0}`;
  useEffect(() => {
    if (!active || comparison.reference === "still") return;
    const timer = window.setTimeout(() => void refreshReference(), 160);
    return () => window.clearTimeout(timer);
    // `project` re-captures after edits; refreshKey after playhead / reference changes.
  }, [active, comparison.reference, refreshKey, project]);

  const draw = useCallback(() => {
    const overlay = canvasRef.current;
    const source = getPreviewCanvas();
    if (!overlay || !source || source.width === 0 || source.height === 0) return;
    const w = source.width;
    const h = source.height;
    const reference = getReferenceImage();
    hasReferenceRef.current = reference !== null;
    const side = comparison.mode === "side";
    const width = side ? w * 2 : w;
    if (overlay.width !== width || overlay.height !== h) {
      overlay.width = width;
      overlay.height = h;
    }
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, h);
    if (side) {
      if (reference) ctx.drawImage(reference, 0, 0, w, h);
      ctx.drawImage(source, w, 0, w, h);
      return;
    }
    ctx.drawImage(source, 0, 0, w, h);
    if (!reference) return;
    ctx.save();
    ctx.beginPath();
    if (comparison.mode === "split-v") ctx.rect(0, 0, w * comparison.split, h);
    else ctx.rect(0, 0, w, h * comparison.split);
    ctx.clip();
    ctx.drawImage(reference, 0, 0, w, h);
    ctx.restore();
  }, [comparison.mode, comparison.split]);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      if (!useColorMonitorStore.getState().captureBusy) draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, draw, busy, stills, referenceRevision]);

  const dragTo = useCallback(
    (event: React.PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const ratio =
        comparison.mode === "split-v"
          ? (event.clientX - rect.left) / rect.width
          : (event.clientY - rect.top) / rect.height;
      setComparison({ split: ratio });
    },
    [comparison.mode, setComparison],
  );

  if (!active) return null;
  const vertical = comparison.mode === "split-v";
  const showDivider = comparison.mode !== "side";
  const referenceLabel =
    comparison.reference === "bypass"
      ? "Ungraded"
      : comparison.reference === "still"
        ? (stills.find((still) => still.id === comparison.stillId)?.label ?? "No still")
        : `Playhead ${(comparison.refTime ?? playhead).toFixed(2)}s`;

  return (
    <div
      ref={rootRef}
      data-testid="comparison-overlay"
      data-mode={comparison.mode}
      data-reference={comparison.reference}
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[10px] bg-black"
    >
      <canvas
        ref={canvasRef}
        aria-label="Comparison view"
        className="h-full w-full object-contain"
      />
      <span className="absolute left-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/85">
        {referenceLabel}
      </span>
      <span className="absolute right-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/85">
        Current
      </span>
      {showDivider ? (
        <div
          data-testid="comparison-divider"
          role="slider"
          aria-label="Comparison wipe"
          aria-orientation={vertical ? "horizontal" : "vertical"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(comparison.split * 100)}
          tabIndex={0}
          className={`pointer-events-auto absolute z-10 ${
            vertical
              ? "top-0 h-full w-3 -translate-x-1/2 cursor-col-resize"
              : "left-0 h-3 w-full -translate-y-1/2 cursor-row-resize"
          }`}
          style={vertical ? { left: `${comparison.split * 100}%` } : { top: `${comparison.split * 100}%` }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragTo(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) dragTo(event);
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.1 : 0.02;
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") setComparison({ split: comparison.split - step });
            if (event.key === "ArrowRight" || event.key === "ArrowDown") setComparison({ split: comparison.split + step });
          }}
        >
          <span
            className={`absolute bg-white shadow-[0_0_2px_rgba(0,0,0,0.9)] ${
              vertical ? "left-1/2 top-0 h-full w-px -translate-x-1/2" : "left-0 top-1/2 h-px w-full -translate-y-1/2"
            }`}
          />
          <span className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-black/70" />
        </div>
      ) : null}
    </div>
  );
};

/** Width the false-colour overlay is computed at; it is scaled to the monitor by CSS. */
const FALSE_COLOR_WIDTH = 640;

/**
 * False-colour exposure overlay: IRE bands painted over a grey copy of the
 * graded Program frame. DOM-only like the comparison view, so exports and
 * scopes keep reading the real frame.
 */
const FalseColorOverlay: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const scratch = document.createElement("canvas");
    const render = () => {
      const overlay = canvasRef.current;
      const source = getPreviewCanvas();
      if (!overlay || !source || source.width === 0 || source.height === 0) return;
      const w = Math.min(FALSE_COLOR_WIDTH, source.width);
      const h = Math.max(1, Math.round((source.height / source.width) * w));
      scratch.width = w;
      scratch.height = h;
      const sctx = scratch.getContext("2d", { willReadFrequently: true });
      const octx = overlay.getContext("2d");
      if (!sctx || !octx) return;
      try {
        sctx.drawImage(source, 0, 0, w, h);
        const frame = sctx.getImageData(0, 0, w, h);
        if (overlay.width !== w || overlay.height !== h) {
          overlay.width = w;
          overlay.height = h;
        }
        octx.putImageData(
          new ImageData(new Uint8ClampedArray(applyFalseColor(frame)), w, h),
          0,
          0,
        );
      } catch {
        // tainted or not-yet-ready canvas: keep the previous overlay frame
      }
    };
    // Redraw when the frame can have changed (playhead moved, project edited), not on a fixed timer.
    // The preview paints asynchronously, so a trailing redraw catches the finished frame.
    let raf = 0;
    let trailing = 0;
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        render();
      });
      window.clearTimeout(trailing);
      trailing = window.setTimeout(render, 150);
    };
    schedule();
    const unsubTimeline = useTimelineStore.subscribe((state, prev) => {
      if (state.playheadPosition !== prev.playheadPosition) schedule();
    });
    const unsubProject = useProjectStore.subscribe((state, prev) => {
      if (state.project.modifiedAt !== prev.project.modifiedAt) schedule();
    });
    return () => {
      unsubTimeline();
      unsubProject();
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(trailing);
    };
  }, []);
  return (
    <div
      data-testid="false-color-overlay"
      className="pointer-events-none absolute inset-0 z-[11] overflow-hidden rounded-[10px] bg-black"
    >
      <canvas
        ref={canvasRef}
        aria-label="False colour"
        className="h-full w-full object-contain"
      />
      <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
        {FALSE_COLOR_BANDS.map((band) => (
          <span
            key={band.label}
            className="rounded bg-black/65 px-1 py-0.5 text-[9px] text-white/85"
          >
            <span
              className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
              style={{ background: `rgb(${band.rgb.join(",")})` }}
            />
            {band.label}
          </span>
        ))}
      </div>
    </div>
  );
};

const FalseColorToggle: React.FC = () => {
  const on = useColorMonitorStore((state) => state.falseColor);
  const set = useColorMonitorStore((state) => state.setFalseColor);
  return (
    <>
      {on ? <FalseColorOverlay /> : null}
      <button
        type="button"
        aria-label="Toggle false colour"
        aria-pressed={on}
        title="False colour (IRE bands)"
        onClick={() => set(!on)}
        className={`absolute right-2 top-2 z-[12] rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
          on ? "bg-accent text-white" : "bg-black/55 text-white/70 hover:text-white"
        }`}
      >
        FC
      </button>
    </>
  );
};

const EyedropperLayer: React.FC = () => {
  const eyedropper = useColorMonitorStore((state) => state.secondary.eyedropper);
  const setSecondaryView = useColorMonitorStore((state) => state.setSecondaryView);

  useEffect(() => {
    if (!eyedropper) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSecondaryView({ eyedropper: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [eyedropper, setSecondaryView]);

  if (!eyedropper) return null;

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const { secondary } = useColorMonitorStore.getState();
    const source = getPreviewCanvas();
    if (!source || !secondary.clipId || !secondary.effectId || source.width === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * source.width;
    const y = ((event.clientY - rect.top) / rect.height) * source.height;
    const scratch = document.createElement("canvas");
    scratch.width = source.width;
    scratch.height = source.height;
    const ctx = scratch.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(source, 0, 0);
    const image = ctx.getImageData(0, 0, scratch.width, scratch.height);
    const rgb = sampleAverageRgb(image.data, image.width, image.height, x, y, 2);
    const store = useProjectStore.getState();
    const effect = store.getVideoEffect(secondary.clipId, secondary.effectId);
    if (!effect) return;
    const next = qualifierFromSample(readQualifier(effect.params), rgb, eyedropper);
    setSecondaryView({ eyedropper: null });
    void store.updateVideoEffect(secondary.clipId, secondary.effectId, { ...next });
  };

  return (
    <div
      data-testid="secondary-eyedropper-layer"
      aria-label={`Eyedropper (${eyedropper}). Click the Program monitor to sample a colour.`}
      className="absolute inset-0 z-40 cursor-crosshair rounded-[10px] ring-2 ring-accent"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        pick(event);
      }}
    />
  );
};

export const ProgramMonitorOverlays: React.FC = () => {
  useSecondaryViewSync();
  useKeyPickerSync();
  return (
    <>
      <KeyPickerLayer />
      <ComparisonOverlayGate />
      <FalseColorToggle />
      <EyedropperLayer />
      <WhiteBalanceEyedropperLayer />
      <DroppedFrameIndicator />
    </>
  );
};
