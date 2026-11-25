import React, { useEffect, useMemo, useState } from "react";
import {
  TRIM_MONITOR_MODE_LABELS,
  availableTrimMonitorModes,
  resolveTrimMonitorEdit,
  type TrimMonitorMode,
} from "@openreel/core";
import { useEditPointStore } from "../../../stores/edit-point-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTrimMonitorStore } from "../../../stores/trim-monitor-store";
import { isDynamicTrimActive } from "../../../services/dynamic-trim";
import {
  closeTrimMonitor,
  parseTrimOffset,
  setTrimMonitorMode,
  setTrimMonitorSide,
  togglePlayAround,
  trimMonitorNavigate,
  trimMonitorOffset,
  trimMonitorTimes,
} from "../../../services/trim-monitor";
import { toast } from "../../../stores/notification-store";
import { formatFrameTimecode } from "../../../utils/frame-timecode";
import { TwoUpPanes } from "./DynamicTrimTwoUp";

const STEPS = [-5, -1, 1, 5] as const;

const buttonClass =
  "rounded border border-white/15 bg-white/10 px-2 py-1 text-[11px] font-semibold text-white/90 hover:bg-white/20 disabled:opacity-40";

const MODE_HINTS: Record<TrimMonitorMode, string> = {
  roll: "Move the cut: the outgoing clip's tail and the incoming clip's head change together",
  "ripple-out": "Trim the outgoing clip's tail and close up what follows",
  "ripple-in": "Trim the incoming clip's head and close up what follows",
  slip: "Shift the source window inside the clip without moving it",
  slide: "Move the clip between its neighbours",
};

function report(outcome: { success: boolean; message?: string }): void {
  if (!outcome.success && outcome.message) toast.error("Trim", outcome.message);
}

/**
 * Premiere's Trim Monitor: a dual-view Program-monitor mode for one edit point. Outgoing (last frame) on
 * the left, incoming (first frame) on the right, with rolling, ripple in / out, slip and slide, numeric
 * and -5 / -1 / +1 / +5 offsets, JKL dynamic trimming (the keys work as soon as the monitor is open),
 * edit-point navigation and Play Around Edit. It owns no edit logic: see services/trim-monitor.ts.
 */
export const TrimMonitor: React.FC = () => {
  const open = useTrimMonitorStore((state) => state.open);
  return open ? <TrimMonitorView /> : null;
};

const TrimMonitorView: React.FC = () => {
  const mode = useTrimMonitorStore((state) => state.mode);
  const side = useTrimMonitorStore((state) => state.side);
  const playingAround = useTrimMonitorStore((state) => state.playingAround);
  const lastOffset = useTrimMonitorStore((state) => state.lastOffset);
  const notice = useTrimMonitorStore((state) => state.notice);
  const selection = useEditPointStore((state) => state.selection);
  const session = useEditPointStore((state) => state.dynamicTrim);
  const project = useProjectStore((state) => state.project);
  const frameRate = project.settings.frameRate;
  const [offsetText, setOffsetText] = useState("");

  const ref = selection?.type === "edit" ? { clipId: selection.clipId, edge: selection.edge } : null;
  const viewProject = session?.previewProject ?? project;
  const edit = useMemo(() => (ref ? resolveTrimMonitorEdit(viewProject, ref) : null), [ref?.clipId, ref?.edge, viewProject]); // eslint-disable-line react-hooks/exhaustive-deps
  const times = useMemo(() => (ref ? trimMonitorTimes(viewProject, ref, frameRate) : null), [ref?.clipId, ref?.edge, viewProject, frameRate]); // eslint-disable-line react-hooks/exhaustive-deps

  // The monitor follows the edit point: when it is deselected or gone, the monitor closes.
  useEffect(() => {
    if (!edit) closeTrimMonitor();
  }, [edit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowUp") report(trimMonitorNavigate(-1));
      else if (event.key === "ArrowDown") report(trimMonitorNavigate(1));
      // Space commits a running JKL trim (the global handler does that); otherwise it plays around the edit.
      else if (event.key === " " && !isDynamicTrimActive()) report(togglePlayAround());
      else if (event.key === "Escape" && !isDynamicTrimActive()) closeTrimMonitor();
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  if (!edit || !times) return null;
  const modes = availableTrimMonitorModes(edit);
  const live = session && session.appliedFrames !== 0 ? session.appliedFrames : null;
  const submitOffset = (): void => {
    const frames = parseTrimOffset(offsetText);
    if (frames === null) {
      toast.error("Trim", "Enter a whole number of frames, such as -3 or +5.");
      return;
    }
    const outcome = trimMonitorOffset(frames);
    report(outcome);
    if (outcome.success) setOffsetText("");
  };
  const signed = (n: number): string => `${n > 0 ? "+" : ""}${n}`;

  return (
    <div
      data-testid="trim-monitor"
      role="group"
      aria-label="Trim Monitor"
      className={`pointer-events-none absolute inset-0 z-30 flex flex-col rounded-[10px] ${playingAround ? "" : "bg-[var(--screen-bg)]"}`}
    >
      <div className={`min-h-0 flex-1 ${playingAround ? "invisible" : ""}`} aria-hidden={playingAround}>
        <TwoUpPanes outgoing={times.outgoing} incoming={times.incoming} refreshKey={viewProject} prefix="trim-monitor" />
      </div>
      <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-white/10 bg-black/70 px-2 py-1.5 text-white">
        <div className="flex items-center gap-1">
          <button type="button" className={buttonClass} data-testid="trim-monitor-prev" aria-label="Previous edit point" title="Previous edit point (Up)" onClick={() => report(trimMonitorNavigate(-1))}>
            Prev edit
          </button>
          <button type="button" className={buttonClass} data-testid="trim-monitor-next" aria-label="Next edit point" title="Next edit point (Down)" onClick={() => report(trimMonitorNavigate(1))}>
            Next edit
          </button>
        </div>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Trim mode">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              data-testid={`trim-monitor-mode-${m}`}
              title={MODE_HINTS[m]}
              className={`${buttonClass} ${mode === m ? "!border-amber-300 !bg-amber-400/30" : ""}`}
              onClick={() => report(setTrimMonitorMode(m))}
            >
              {TRIM_MONITOR_MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {mode === "slip" || mode === "slide" ? (
          <div className="flex items-center gap-1" role="radiogroup" aria-label={`${TRIM_MONITOR_MODE_LABELS[mode]} target`}>
            {(["outgoing", "incoming"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={(edit[s] ? side === s : side !== s)}
                disabled={!edit[s]}
                data-testid={`trim-monitor-side-${s}`}
                className={`${buttonClass} ${edit[s] && side === s ? "!border-sky-300 !bg-sky-400/30" : ""}`}
                onClick={() => report(setTrimMonitorSide(s))}
              >
                {s === "outgoing" ? "Outgoing clip" : "Incoming clip"}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-1" aria-label="Trim by frames">
          {STEPS.map((n) => (
            <button
              key={n}
              type="button"
              className={buttonClass}
              data-testid={`trim-monitor-step-${n}`}
              aria-label={`Trim ${signed(n)} frame${Math.abs(n) === 1 ? "" : "s"}`}
              onClick={() => report(trimMonitorOffset(n))}
            >
              {signed(n)}
            </button>
          ))}
          <input
            data-testid="trim-monitor-offset"
            aria-label="Trim offset in frames"
            inputMode="numeric"
            placeholder="±frames"
            value={offsetText}
            onChange={(event) => setOffsetText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitOffset();
              }
              event.stopPropagation();
            }}
            className="w-16 rounded border border-white/20 bg-black/40 px-1.5 py-1 text-[11px] text-white placeholder:text-white/40"
          />
          <button type="button" className={buttonClass} data-testid="trim-monitor-apply" onClick={submitOffset}>
            Apply
          </button>
        </div>
        <button
          type="button"
          aria-pressed={playingAround}
          data-testid="trim-monitor-play-around"
          className={`${buttonClass} ${playingAround ? "!border-green-300 !bg-green-500/30" : ""}`}
          title="Play around the edit and loop (Space)"
          onClick={() => report(togglePlayAround())}
        >
          {playingAround ? "Stop" : "Play Around Edit"}
        </button>
        <span data-testid="trim-monitor-readout" role="status" aria-live="polite" className="ml-auto text-[11px] tabular-nums text-white/80">
          {formatFrameTimecode(edit.time, frameRate)} · {TRIM_MONITOR_MODE_LABELS[mode]}
          {live !== null ? ` · ${signed(live)}f live` : lastOffset !== null ? ` · ${signed(lastOffset)}f` : ""}
          {notice ? ` · ${notice}` : ""}
        </span>
        <button type="button" className={buttonClass} data-testid="trim-monitor-close" aria-label="Close Trim Monitor" onClick={() => closeTrimMonitor()}>
          Close
        </button>
      </div>
    </div>
  );
};
