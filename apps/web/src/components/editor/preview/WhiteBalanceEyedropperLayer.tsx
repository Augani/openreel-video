import React, { useCallback, useEffect, useRef, useState } from "react";
import { useColorMonitorStore } from "../../../stores/color-monitor-store";
import { getPreviewCanvas } from "../scopes/preview-canvas-registry";
import { toast } from "../../../stores/notification-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useProjectStore } from "../../../stores/project-store";
import { captureWhiteBalanceInputFrame } from "../../../services/comparison-service";
import {
  applyWhiteBalancePick,
  clipNeedsWhiteBalanceInputFrame,
  previewWhiteBalancePick,
  readCanvasSample,
  WHITE_BALANCE_PICK_MESSAGES,
  type WhiteBalancePickResult,
} from "../../../services/white-balance-eyedropper";

/**
 * White Balance eyedropper over the Program monitor. Crosshair cursor, a
 * footprint box and a live read-out of what Temperature / Tint a click would
 * set. Click applies (one undo step) and disarms; Esc or right-click cancels.
 * DOM-only: the Program canvas, scopes and exports are untouched.
 */

interface HoverState {
  /** Overlay-relative pixel position of the cursor. */
  left: number;
  top: number;
  /** Footprint box size in overlay pixels. */
  box: number;
  rgb: [number, number, number] | null;
  result: WhiteBalancePickResult;
  /** The stage input frame is still rendering. */
  preparing: boolean;
}

/** Maps a pointer position to canvas pixels, honouring `object-fit: contain` letterboxing. */
function toCanvasPoint(
  rect: DOMRect,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number; scale: number } | null {
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  if (!(scale > 0)) return null;
  const offsetX = (rect.width - canvas.width * scale) / 2;
  const offsetY = (rect.height - canvas.height * scale) / 2;
  const x = (clientX - rect.left - offsetX) / scale;
  const y = (clientY - rect.top - offsetY) / scale;
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  return { x, y, scale };
}

const fmt = (value: number): string => `${value > 0 ? "+" : ""}${Math.round(value)}`;

export const WhiteBalanceEyedropperLayer: React.FC = () => {
  const pick = useColorMonitorStore((state) => state.whiteBalancePick);
  const size = useColorMonitorStore((state) => state.whiteBalanceSize);
  const setPick = useColorMonitorStore((state) => state.setWhiteBalancePick);
  const [hover, setHover] = useState<HoverState | null>(null);
  const frame = useRef(0);
  const project = useProjectStore((state) => state.project);
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const playing = useTimelineStore((state) => state.playbackState === "playing");
  const holdRef = useRef<HTMLCanvasElement>(null);
  const snapshot = useRef<ImageBitmap | null>(null);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const generation = useRef(0);
  // The Program pixel only equals the white balance stage input on a plain clip; otherwise the
  // stage input is rendered once per frame (transient, preview-only) and the picker samples that.
  const needsInput = pick ? clipNeedsWhiteBalanceInputFrame(pick.clipId) : false;
  const inputMode = needsInput && !playing;

  /** Renders the clip's white balance stage input; the picture on screen is held still meanwhile. */
  const captureInput = useCallback(async (clipId: string): Promise<ImageBitmap | null> => {
    const program = getPreviewCanvas();
    const hold = holdRef.current;
    if (hold && program && program.width > 0 && program.height > 0) {
      hold.width = program.width;
      hold.height = program.height;
      hold.getContext("2d")?.drawImage(program, 0, 0);
      hold.style.visibility = "visible";
    }
    try {
      return await captureWhiteBalanceInputFrame(clipId);
    } finally {
      if (hold) hold.style.visibility = "hidden";
    }
  }, []);

  useEffect(() => {
    snapshot.current?.close();
    snapshot.current = null;
    setSnapshotReady(false);
    if (!pick || !inputMode) return;
    const id = ++generation.current;
    const timer = window.setTimeout(() => {
      void captureInput(pick.clipId).then((bitmap) => {
        if (id !== generation.current) {
          bitmap?.close();
          return;
        }
        snapshot.current = bitmap;
        setSnapshotReady(bitmap !== null);
      });
    }, 120);
    return () => {
      generation.current++;
      window.clearTimeout(timer);
    };
  }, [pick, inputMode, playhead, project, captureInput]);

  useEffect(
    () => () => {
      snapshot.current?.close();
      snapshot.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!pick) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPick(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(frame.current);
    };
  }, [pick, setPick]);

  useEffect(() => {
    if (!pick) setHover(null);
  }, [pick]);

  const sampleAt = useCallback(
    (target: HTMLDivElement, clientX: number, clientY: number, source?: ImageBitmap | null) => {
      const canvas = getPreviewCanvas();
      if (!canvas || !pick) return null;
      const rect = target.getBoundingClientRect();
      const point = toCanvasPoint(rect, canvas, clientX, clientY);
      if (!point) return null;
      const input = source ?? (inputMode ? snapshot.current : null);
      const rgb = inputMode && !input ? null : readCanvasSample(input ?? canvas, point.x, point.y, size);
      return { point, rgb, rect, inputFrame: input !== null };
    },
    [pick, size, inputMode],
  );

  if (!pick) return null;

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const { clientX, clientY } = event;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const hit = sampleAt(target, clientX, clientY);
      if (!hit) {
        setHover(null);
        return;
      }
      setHover({
        left: clientX - hit.rect.left,
        top: clientY - hit.rect.top,
        box: Math.max(6, size * hit.point.scale),
        rgb: hit.rgb,
        result: previewWhiteBalancePick(pick.clipId, hit.rgb, hit.inputFrame),
        preparing: inputMode && !hit.inputFrame,
      });
    });
  };

  const onDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button === 2) {
      setPick(null);
      return;
    }
    if (event.button !== 0) return;
    const { clientX, clientY } = event;
    const target = event.currentTarget;
    void (async () => {
      // A click before the stage input finished rendering renders it now.
      let source: ImageBitmap | null = snapshot.current;
      if (inputMode && !source) source = await captureInput(pick.clipId);
      const hit = sampleAt(target, clientX, clientY, source);
      if (!hit) {
        if (source && source !== snapshot.current) source.close();
        return;
      }
      const result = await applyWhiteBalancePick(pick.clipId, hit.rgb, hit.inputFrame);
      if (source && source !== snapshot.current) source.close();
      if (result.ok) {
        setPick(null);
        const message = `Temperature ${fmt(result.solution.temperature)}, Tint ${fmt(result.solution.tint)}${
          result.solution.clamped ? " (limited to the slider range)" : ""
        }`;
        if (result.farFromNeutral) {
          toast.warning("White balance set from a coloured area", `${message}. That area was far from neutral; undo and pick a grey or white surface for a truer result.`);
        } else {
          toast.success("White balance set", message);
        }
      } else if (result.reason === "unusable-sample" || result.reason === "outside-clip") {
        // Stay armed so the user can pick a better spot.
        toast.warning("White balance", WHITE_BALANCE_PICK_MESSAGES[result.reason]);
      } else {
        setPick(null);
        toast.warning("White balance", WHITE_BALANCE_PICK_MESSAGES[result.reason]);
      }
    })();
  };

  const usable = hover?.result.ok === true;
  const swatch = hover?.rgb
    ? `rgb(${hover.rgb.map((v) => Math.round(v * 255)).join(",")})`
    : "transparent";

  return (
    <div
      data-testid="wb-eyedropper-layer"
      data-input-frame={inputMode ? (snapshotReady ? "ready" : "pending") : "live"}
      role="application"
      aria-label={`White balance eyedropper. Click a neutral area of the Program monitor to set Temperature and Tint. Escape cancels.`}
      className="absolute inset-0 z-40 cursor-crosshair rounded-[10px] ring-2 ring-accent"
      onPointerMove={onMove}
      onPointerLeave={() => {
        cancelAnimationFrame(frame.current);
        setHover(null);
      }}
      onPointerDown={onDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <canvas
        ref={holdRef}
        aria-hidden
        data-testid="wb-eyedropper-hold"
        className="pointer-events-none absolute inset-0 h-full w-full rounded-[10px] bg-black object-contain"
        style={{ visibility: "hidden" }}
      />
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px] font-medium text-white/90">
        White balance: click a neutral grey or white area. Esc cancels.
      </div>
      {hover ? (
        <>
          <div
            aria-hidden
            data-testid="wb-eyedropper-box"
            className="pointer-events-none absolute border border-white mix-blend-difference"
            style={{
              left: hover.left - hover.box / 2,
              top: hover.top - hover.box / 2,
              width: hover.box,
              height: hover.box,
            }}
          />
          <div
            data-testid="wb-eyedropper-readout"
            className="pointer-events-none absolute flex items-center gap-1.5 whitespace-nowrap rounded bg-black/80 px-1.5 py-1 text-[10px] text-white"
            style={{ left: hover.left + 14, top: hover.top + 14 }}
          >
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-sm border border-white/60"
              style={{ background: swatch }}
            />
            {hover.preparing ? (
              <span className="text-white/70">Preparing frame...</span>
            ) : hover.result.ok ? (
              <span className={hover.result.farFromNeutral ? "text-amber-300" : undefined}>
                Temp {fmt(hover.result.solution.temperature)} · Tint {fmt(hover.result.solution.tint)}
                {hover.result.solution.clamped ? " (limit)" : ""}
                {hover.result.farFromNeutral ? " · not neutral" : ""}
              </span>
            ) : (
              <span className="text-white/70">
                {hover.result.reason === "unusable-sample" ? "Clipped: pick another area" : "Cannot pick here"}
              </span>
            )}
          </div>
        </>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {usable ? "Neutral sample ready" : ""}
      </span>
    </div>
  );
};
