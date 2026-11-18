import React, { useEffect, useMemo, useRef } from "react";
import { useEditPointStore } from "../../../stores/edit-point-store";
import { useProjectStore } from "../../../stores/project-store";
import { captureProgramFrame } from "../../../services/comparison-service";
import { dynamicTrimTwoUpTimes } from "../../../services/dynamic-trim";

/** Quiet period before a capture starts: coalesces the shuttle's ticks and lets the Program monitor settle first. */
const CAPTURE_DELAY_MS = 40;

function paint(canvas: HTMLCanvasElement | null, bitmap: ImageBitmap | null): void {
  if (!canvas || !bitmap) return;
  if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
  }
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
}

/**
 * Premiere-style two-up for a dynamic (JKL) trim at a cut: the outgoing clip's last frame on the left and the
 * incoming clip's first frame on the right, both read from the live trimmed preview. DOM only, like the
 * comparison view: both halves are captures of the Program canvas, which keeps rendering the playhead frame
 * underneath, and nothing here reaches the project, the render cache or an export. A trim on a free edge has
 * no second clip, so it keeps the single Program frame.
 */
export const DynamicTrimTwoUp: React.FC = () => {
  const session = useEditPointStore((state) => state.dynamicTrim);
  const neighborId = useEditPointStore((state) => (state.selection?.type === "edit" ? state.selection.neighborId : null));
  const storedProject = useProjectStore((state) => state.project);
  const outgoingRef = useRef<HTMLCanvasElement>(null);
  const incomingRef = useRef<HTMLCanvasElement>(null);

  const times = useMemo(
    () =>
      session && neighborId
        ? dynamicTrimTwoUpTimes(session.previewProject ?? storedProject, session.clipId, neighborId, session.edge)
        : null,
    [session, neighborId, storedProject],
  );
  const outgoingTime = times?.outgoing ?? null;
  const incomingTime = times?.incoming ?? null;

  const latest = useRef({ outgoing: outgoingTime, incoming: incomingTime });
  latest.current = { outgoing: outgoingTime, incoming: incomingTime };
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
    if (outgoingTime === null || incomingTime === null) return;
    const run = async (): Promise<void> => {
      if (busy.current) {
        dirty.current = true;
        return;
      }
      busy.current = true;
      try {
        do {
          dirty.current = false;
          const { outgoing, incoming } = latest.current;
          if (outgoing === null || incoming === null) break;
          const out = await captureProgramFrame({ time: outgoing });
          const inc = await captureProgramFrame({ time: incoming });
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
  }, [outgoingTime, incomingTime, session?.previewProject]);

  if (!times) return null;
  return (
    <div
      data-testid="dynamic-trim-two-up"
      className="pointer-events-none absolute inset-0 z-30 grid grid-cols-2 gap-px rounded-[10px] bg-[var(--screen-bg)]"
    >
      <figure className="relative m-0 min-w-0">
        <canvas
          ref={outgoingRef}
          data-testid="dynamic-trim-outgoing"
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
          data-testid="dynamic-trim-incoming"
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
