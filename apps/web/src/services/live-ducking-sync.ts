import { liveDuckingSignature, type Project } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

/**
 * Live ducking is computed from the dialogue clips' positions. While the
 * transport is running the audio graph has already scheduled each clip's volume
 * lane, so when a dialogue clip is moved, trimmed, added, removed or muted (or
 * the edit is undone) the ducked clips must be rescheduled. This watches the
 * duck signature of every live-ducked clip and asks the preview to re-seek its
 * audio when one changes. Projects without a live duck cost one cheap scan.
 */

/** One string covering every live-ducked clip's current dip; empty when nothing is ducked. */
export function projectLiveDuckingSignature(project: Pick<Project, "timeline">): string {
  const parts: string[] = [];
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (!clip.metadata?.liveDucking) continue;
      parts.push(`${clip.id}:${liveDuckingSignature(clip, project.timeline)}`);
    }
  }
  return parts.join("|");
}

export const LIVE_DUCKING_RESYNC_DELAY_MS = 120;

/** Starts watching the project store; returns the stop function. */
export function startLiveDuckingSync(
  notify: () => void = () => window.dispatchEvent(new CustomEvent("openreel:preview-invalidate", { detail: { audioOnly: true } })),
): () => void {
  let last = projectLiveDuckingSignature(useProjectStore.getState().project);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useProjectStore.subscribe((state, previous) => {
    if (state.project === previous.project) return;
    const next = projectLiveDuckingSignature(state.project);
    if (next === last) return;
    last = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      notify();
    }, LIVE_DUCKING_RESYNC_DELAY_MS);
  });
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
