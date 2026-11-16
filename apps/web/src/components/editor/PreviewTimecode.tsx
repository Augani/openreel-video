import { useId, useRef, useState } from "react";
import { Input } from "@openreel/ui";
import { sequencePositionOf, sequenceTimecodeAt } from "@openreel/core";
import { useTimelineStore } from "../../stores/timeline-store";
import { formatFrameTimecode, parseFrameTimecode } from "../../utils/frame-timecode";
import { stepEditingFrame } from "./editing-frame-rate";

export function PreviewTimecode({ position, duration, frameRate, disabled = false, startTimecode }: {
  position: number; duration: number; frameRate: number; disabled?: boolean;
  /** Sequence start timecode (e.g. 10:00:00:00): the readout then shows the timecode the exported file carries. */
  startTimecode?: string;
}) {
  const label = (seconds: number): string => sequenceTimecodeAt(seconds, startTimecode, frameRate) ?? formatFrameTimecode(seconds, frameRate);
  // A full HH:MM:SS:FF is a sequence timecode (before the start is an error); seconds and shorter forms stay relative to the sequence.
  const parse = (text: string): number | null =>
    startTimecode && /^\s*\d+:\d+:\d+[:;.]\d+\s*$/.test(text) ? sequencePositionOf(text, startTimecode, frameRate) : parseFrameTimecode(text, frameRate);
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);
  const cancel = useRef(false);
  const seek = (seconds: number) => {
    const timeline = useTimelineStore.getState();
    if (disabled || timeline.playbackLockedReason) return;
    timeline.pause();
    timeline.seekTo(Math.min(duration, Math.max(0, seconds)));
    timeline.scrollToPlayhead();
  };
  return <div className="relative flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums">
    <Input aria-label="Playhead timecode" aria-describedby={id} title={startTimecode ? `Go to a frame · ${frameRate} fps · sequence timecode starting at ${startTimecode}. You can also enter seconds.` : `Go to a frame · ${frameRate} fps · HH:MM:SS:FF (non-drop-frame). You can also enter seconds.`}
      disabled={disabled} value={editing ? draft : label(position)}
      aria-invalid={error} spellCheck={false}
      className="h-auto w-[104px] rounded border border-transparent bg-transparent px-1 py-2 text-[length:inherit] leading-[inherit] text-fg-2 outline-none hover:border-border focus:border-accent disabled:opacity-50 md:text-[length:inherit]"
      onFocus={() => { cancel.current = false; setError(false); setDraft(label(position)); setEditing(true); useTimelineStore.getState().pause(); }}
      onChange={(event) => { setDraft(event.currentTarget.value); setError(false); }}
      onBlur={() => {
        setEditing(false);
        if (cancel.current) { cancel.current = false; return; }
        const time = parse(draft);
        if (time === null) { setError(true); return; }
        seek(time);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        else if (event.key === "Escape") { event.preventDefault(); cancel.current = true; setError(false); event.currentTarget.blur(); }
        else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const direction = event.key === "ArrowUp" ? 1 : -1;
          let time = parse(draft) ?? position;
          for (let count = 0; count < (event.shiftKey ? 10 : 1); count++) time = stepEditingFrame(time, direction, frameRate);
          time = Math.min(duration, time);
          setDraft(label(time)); seek(time);
        }
      }} />
    <span className="text-fg-muted whitespace-pre"><span aria-hidden>/ </span><span aria-label="Project duration">{formatFrameTimecode(duration, frameRate)}</span></span>
    <span id={id} className="sr-only">Enter a timecode or seconds. Up and Down move one frame; Shift moves ten frames.</span>
    {error && <span role="alert" className="absolute bottom-full left-0 z-30 mb-1 w-60 rounded border border-status-error/30 bg-bg-2 p-2 font-sans text-xs text-status-error">Enter HH:MM:SS:FF or seconds, for example 12.5.</span>}
  </div>;
}
