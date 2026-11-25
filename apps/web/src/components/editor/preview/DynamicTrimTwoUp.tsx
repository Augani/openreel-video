import React, { useEffect, useMemo, useRef } from "react";
import { useEditPointStore } from "../../../stores/edit-point-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTrimMonitorStore } from "../../../stores/trim-monitor-store";
import { captureProgramFrame } from "../../../services/comparison-service";
import { dynamicTrimTwoUpTimes } from "../../../services/dynamic-trim";

/** Quiet period before a capture starts: coalesces the shuttle's ticks and lets the Program monitor settle first. */
const CAPTURE_DELAY_MS = 40;

function paint(canvas: HTMLCanvasElement | null, bitmap: ImageBitmap | null): void {
  if (!canvas) return;
  if (!bitmap) {
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
  }
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
}

export interface TwoUpPanesProps {
  /** Project time of the outgoing clip's last frame; null when there is no outgoing clip. */
  outgoing: number | null;
  /** Project time of the incoming clip's first frame; null when there is no incoming clip. */
  incoming: number | null;
  /** Anything that changes when the pictures at those times may have changed (the preview project). */
  refreshKey: unknown;
  /** data-testid prefix: `<prefix>-outgoing`, `<prefix>-incoming`. */
  prefix: string;
  className?: string;
}

/**
 * Outgoing | incoming frames, both captures of the Program canvas at two project times (DOM only, like the
 * comparison view: nothing here reaches the project, the render cache or an export).
 */
export const TwoUpPanes: React.FC<TwoUpPanesProps> = ({ outgoing, incoming, refreshKey, prefix, className }) => {
  const outgoingRef = useRef<HTMLCanvasElement>(null);
  const incomingRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ outgoing, incoming });
  latest.current = { outgoing, incoming };
  const busy = useRef(false);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    const run = async (): Promise<void> => {
      if (busy.current) {
        dirty.current = true;
        return;
      }
      busy.current = true;
      try {
        do {
          dirty.current = false;
          const want = latest.current;
          const out = want.outgoing === null ? null : await captureProgramFrame({ time: want.outgoing });
          const inc = want.incoming === null ? null : await captureProgramFrame({ time: want.incoming });
          if (alive.current) {
            paint(outgoingRef.current, out);
            paint(incomingRef.current, inc);
          }
          out?.close();
          inc?.close();
        } while (dirty.current && alive.current);
      } finally {
        busy.current = false;
      }
    };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), CAPTURE_DELAY_MS);
  }, [outgoing, incoming, refreshKey]);

  return (
    <div className={className ?? "grid h-full w-full grid-cols-2 gap-px bg-[var(--screen-bg)]"}>
      <figure className="relative m-0 min-w-0">
        <canvas
          ref={outgoingRef}
          data-testid={`${prefix}-outgoing`}
          aria-label="Outgoing clip, last frame"
          className="h-full w-full bg-[var(--screen-bg)] object-contain"
        />
        <figcaption className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/85">
          Outgoing
        </figcaption>
      </figure>
      <figure className="relative m-0 min-w-0">
        <canvas
          ref={incomingRef}
          data-testid={`${prefix}-incoming`}
          aria-label="Incoming clip, first frame"
          className="h-full w-full bg-[var(--screen-bg)] object-contain"
        />
        <figcaption className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/85">
          Incoming
        </figcaption>
      </figure>
    </div>
  );
};

/**
 * Premiere-style two-up for a dynamic (JKL) trim at a cut: the outgoing clip's last frame on the left and the
 * incoming clip's first frame on the right, both read from the live trimmed preview. A trim on a free edge has
 * no second clip, so it keeps the single Program frame. While the Trim Monitor is open it owns this view.
 */
export const DynamicTrimTwoUp: React.FC = () => {
  const session = useEditPointStore((state) => state.dynamicTrim);
  const neighborId = useEditPointStore((state) => (state.selection?.type === "edit" ? state.selection.neighborId : null));
  const storedProject = useProjectStore((state) => state.project);
  const monitorOpen = useTrimMonitorStore((state) => state.open);

  const times = useMemo(
    () =>
      session && neighborId
        ? dynamicTrimTwoUpTimes(session.previewProject ?? storedProject, session.clipId, neighborId, session.edge)
        : null,
    [session, neighborId, storedProject],
  );

  if (!times || monitorOpen) return null;
  return (
    <div
      data-testid="dynamic-trim-two-up"
      className="pointer-events-none absolute inset-0 z-30 rounded-[10px] bg-[var(--screen-bg)]"
    >
      <TwoUpPanes
        outgoing={times.outgoing}
        incoming={times.incoming}
        refreshKey={session?.previewProject}
        prefix="dynamic-trim"
      />
    </div>
  );
};
