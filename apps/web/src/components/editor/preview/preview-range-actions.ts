import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { resolvePlaybackLoop } from "../../../utils/playback-loop";
import { editingFrameStepSeconds } from "../editing-frame-rate";

/** Shared by the monitor transport and timeline's existing In/Out controls. */
export function markPreviewRange(edge: "in" | "out", duration: number, frameRate: number): void {
  const state = useTimelineStore.getState();
  if (state.playbackLockedReason || useUIStore.getState().exportState.isExporting) return;
  const range = resolvePlaybackLoop({ ...state, loopEnabled: true }, duration);
  if (!range) return;
  const frame = editingFrameStepSeconds(frameRate);
  const time = Math.min(duration, Math.max(0, Math.round(state.playheadPosition / frame) * frame));
  if (edge === "in") {
    const start = Math.min(time, Math.max(0, duration - frame));
    state.setLoopRange(start, range.end > start ? range.end : duration);
  } else {
    const end = Math.max(Math.min(frame, duration), time);
    state.setLoopRange(range.start < end ? range.start : 0, end);
  }
}
