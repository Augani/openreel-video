import type { Project, Clip } from "@openreel/core";
import type { EditingHost, ToolResult } from "@openreel/agent";

const ADJACENCY_TOLERANCE = 0.01;
const describeClip = (clip: Clip) => ({ id: clip.id, trackId: clip.trackId, startTime: clip.startTime, endTime: clip.startTime + clip.duration, duration: clip.duration });

export function getTransitionOptions(project: Project, clipId?: string) {
  return project.timeline.tracks.filter((track) => !track.locked).flatMap((track) => {
    const clips = [...track.clips].sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
    return clips.slice(0, -1).flatMap((a, index) => {
      const b = clips[index + 1]!;
      if (clipId && a.id !== clipId && b.id !== clipId || Math.abs(a.startTime + a.duration - b.startTime) > ADJACENCY_TOLERANCE) return [];
      return [{ trackId: track.id, trackName: track.name, clipAId: a.id, clipBId: b.id, cutTime: a.startTime + a.duration, maxDuration: Math.min(a.duration, b.duration, 30) }];
    });
  });
}

/** Failed preflight checks leave the isolated draft unchanged. */
export async function addEditingTransition(args: Record<string, unknown>, host: EditingHost): Promise<ToolResult> {
  const project = host.getProject();
  const clips = project.timeline.tracks.flatMap((track) => track.clips);
  const first = clips.find((clip) => clip.id === args.clipAId);
  const second = clips.find((clip) => clip.id === args.clipBId);
  const reject = (code: string, message: string): ToolResult => ({
    ok: false, summary: "Transition needs correction",
    error: { code, message, recoverable: true },
    data: { clipA: first ? describeClip(first) : null, clipB: second ? describeClip(second) : null, availablePairs: getTransitionOptions(project, first?.id ?? second?.id).slice(0, 20) },
  });
  if (!first || !second) return reject("TRANSITION_CLIP_NOT_FOUND", "A timeline clip ID was not found. Use list_clips or get_transition_options for clip IDs; media IDs and action IDs are not clip IDs.");
  if (first.id === second.id) return reject("TRANSITION_SAME_CLIP", "Choose two different adjacent clips for a transition.");
  if (first.trackId !== second.trackId) return reject("TRANSITION_DIFFERENT_TRACKS", "The clips are on different tracks. Use an adjacent pair from get_transition_options. Do not move clips between tracks unless the user requested a layout change.");
  const [a, b] = first.startTime <= second.startTime ? [first, second] : [second, first];
  const gap = b.startTime - (a.startTime + a.duration);
  if (Math.abs(gap) > ADJACENCY_TOLERANCE) {
    const seconds = Number(Math.abs(gap).toFixed(6));
    return reject("TRANSITION_NOT_ADJACENT", `The clips ${gap > 0 ? `have a ${seconds}s gap` : `overlap by ${seconds}s`}. The later clip starts at ${b.startTime}s; adjacency requires ${a.startTime + a.duration}s. Choose an adjacent pair from get_transition_options, or correct the timing only if the user requested joining these clips.`);
  }
  const requestedDuration = Number(args.duration);
  const duration = Math.min(requestedDuration, a.duration, b.duration);
  const transition = { id: `transition-${crypto.randomUUID()}`, type: args.transitionType, clipAId: a.id, clipBId: b.id, duration, params: args.params ?? {} };
  const result = await host.applyAction({ type: "transition/set", id: crypto.randomUUID(), timestamp: Date.now(), params: { transition } });
  return result.success ? {
    ok: true,
    summary: duration < requestedDuration ? `Transition applied; duration shortened from ${requestedDuration}s to ${duration}s to fit both clips` : "Transition applied",
    data: { transitionId: transition.id, trackId: a.trackId, clipAId: a.id, clipBId: b.id, duration, requestedDuration, reordered: a.id !== first.id },
  } : { ok: false, summary: "Transition failed", error: { code: "INVALID_EDIT", message: result.error?.message ?? "Transition failed" } };
}
