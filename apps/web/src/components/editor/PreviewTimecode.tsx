import { useId, useRef, useState } from "react";
import { useTimelineStore } from "../../stores/timeline-store";
import { formatFrameTimecode, parseFrameTimecode } from "../../utils/frame-timecode";
import { stepEditingFrame } from "./editing-frame-rate";

export function PreviewTimecode({ position, duration, frameRate, disabled = false }: {
  position: number; duration: number; frameRate: number; disabled?: boolean;
}) {
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
    <input aria-label="Playhead timecode" aria-describedby={id} title={`Go to a frame · ${frameRate} fps · HH:MM:SS:FF (non-drop-frame). You can also enter seconds.`}
      disabled={disabled} value={editing ? draft : formatFrameTimecode(position, frameRate)}
      aria-invalid={error} spellCheck={false}
      className="w-[104px] rounded border border-transparent bg-transparent px-1 py-2 text-fg-2 outline-none hover:border-border focus:border-accent disabled:opacity-50"
      onFocus={() => { cancel.current = false; setError(false); setDraft(formatFrameTimecode(position, frameRate)); setEditing(true); useTimelineStore.getState().pause(); }}
      onChange={(event) => { setDraft(event.currentTarget.value); setError(false); }}
      onBlur={() => {
        setEditing(false);
        if (cancel.current) { cancel.current = false; return; }
        const time = parseFrameTimecode(draft, frameRate);
        if (time === null) { setError(true); return; }
        seek(time);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        else if (event.key === "Escape") { event.preventDefault(); cancel.current = true; setError(false); event.currentTarget.blur(); }
        else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const direction = event.key === "ArrowUp" ? 1 : -1;
          let time = parseFrameTimecode(draft, frameRate) ?? position;
          for (let count = 0; count < (event.shiftKey ? 10 : 1); count++) time = stepEditingFrame(time, direction, frameRate);
          time = Math.min(duration, time);
          setDraft(formatFrameTimecode(time, frameRate)); seek(time);
        }
      }} />
    <span aria-hidden className="text-fg-muted">/</span>
    <span className="text-fg-muted" aria-label="Project duration">{formatFrameTimecode(duration, frameRate)}</span>
    <span id={id} className="sr-only">Enter a timecode or seconds. Up and Down move one frame; Shift moves ten frames.</span>
    {error && <span role="alert" className="absolute bottom-full left-0 z-30 mb-1 w-60 rounded border border-status-error/30 bg-bg-2 p-2 font-sans text-xs text-status-error">Enter HH:MM:SS:FF or seconds, for example 12.5.</span>}
  </div>;
}
