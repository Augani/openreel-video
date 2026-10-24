/**
 * Clip tools of the phone editor (stage 3): split, trim to the playhead, speed, volume, silence cut,
 * duplicate and delete on the selected clip. Every tool goes through the same project-store actions as
 * the desktop editor, so undo, autosave and export see ordinary edits; multi-step tools run as one
 * undo group.
 */
import { getSpeedEngine, type Clip, type Project } from "@openreel/core";
import type { EditingHost } from "@openreel/agent";
import { useProjectStore } from "../../stores/project-store";
import { analyseSilence, applySilenceCuts, SILENCE_DEFAULTS, type Region } from "../silence-tools";

/** A cut closer than this to a clip edge would leave a sliver; the tools refuse it. */
export const EDGE = 0.05;

export type Target =
  | { kind: "clip"; id: string; clip: Clip; trackType: string }
  | { kind: "text-clip"; id: string; start: number; duration: number };

/** The single selected timeline item the clip tools act on, or null. */
export function selectedTarget(project: Pick<Project, "timeline"> & { textClips?: Project["textClips"] }, selected: readonly { type: string; id: string }[]): Target | null {
  const item = selected.length === 1 ? selected[0] : null;
  if (!item) return null;
  if (item.type === "clip") {
    for (const track of project.timeline.tracks) {
      const clip = track.clips.find((c) => c.id === item.id);
      if (clip) return { kind: "clip", id: clip.id, clip, trackType: track.type };
    }
  }
  if (item.type === "text-clip") {
    const t = (project.textClips ?? []).find((c) => c.id === item.id);
    if (t) return { kind: "text-clip", id: t.id, start: t.startTime, duration: t.duration };
  }
  return null;
}

const span = (t: Target) => (t.kind === "clip" ? { start: t.clip.startTime, duration: t.clip.duration } : { start: t.start, duration: t.duration });

/** Whether the playhead lies inside the target far enough from both edges to cut there. */
export function canCutAt(t: Target, time: number): boolean {
  const { start, duration } = span(t);
  return time > start + EDGE && time < start + duration - EDGE;
}

export const NOT_UNDER_PLAYHEAD = "حرّك المؤشر الأبيض لداخل اللقطة أولاً.";
export const FAILED = "تعذّر التنفيذ، حاول مرة ثانية.";

const store = () => useProjectStore.getState();

async function grouped<T>(label: string, run: () => Promise<T>): Promise<T> {
  store().beginHistoryGroup(label);
  try { return await run(); } finally { store().endHistoryGroup(); }
}

/** Splits the target at the playhead. Returns an Arabic error or null. */
export async function splitAt(t: Target, time: number): Promise<string | null> {
  if (!canCutAt(t, time)) return NOT_UNDER_PLAYHEAD;
  if (t.kind === "text-clip") return store().splitOverlayClip(t.id, time) ? null : FAILED;
  return (await store().splitClip(t.id, time)).success ? null : FAILED;
}

/**
 * Trims the part before (`start`) or after (`end`) the playhead. For video and audio the clip keeps
 * its place and later clips on the same track slide left to close the gap, like a ripple delete
 * (CapCut's main track). Only actions on existing clip IDs are used — split + delete would break redo,
 * which replays a split under a new ID. Text clips are trimmed in place.
 */
export async function trimAt(t: Target, time: number, side: "start" | "end"): Promise<string | null> {
  if (!canCutAt(t, time)) return NOT_UNDER_PLAYHEAD;
  if (t.kind === "text-clip") return store().trimOverlayToPlayhead(t.id, time, side === "start") ? null : FAILED;
  const { clip } = t;
  const end = clip.startTime + clip.duration;
  const removed = side === "start" ? time - clip.startTime : end - time;
  const later = (store().project.timeline.tracks.find((tr) => tr.id === clip.trackId)?.clips ?? [])
    .filter((c) => c.id !== clip.id && c.startTime >= end - 0.001)
    .sort((a, b) => a.startTime - b.startTime);
  const act = (type: string, params: Record<string, unknown>) =>
    store().executeAction({ type, id: crypto.randomUUID(), timestamp: Date.now(), params } as Parameters<ReturnType<typeof store>["executeAction"]>[0]);
  return grouped("Trim clip", async () => {
    if (!(await act("clip/trimToPlayhead", { clipId: clip.id, playheadTime: time, trimStart: side === "start" })).success) return FAILED;
    if (side === "start" && !(await act("clip/move", { clipId: clip.id, startTime: clip.startTime })).success) return FAILED;
    for (const c of later) {
      if (!(await act("clip/move", { clipId: c.id, startTime: c.startTime - removed })).success) return FAILED;
    }
    return null;
  });
}

export const SPEEDS = [0.5, 1, 1.5, 2, 3] as const;

export async function setSpeed(clip: Clip, speed: number): Promise<string | null> {
  getSpeedEngine().setClipSpeed(clip.id, speed, clip.outPoint - clip.inPoint);
  const res = await store().executeAction({ type: "clip/setSpeed", id: crypto.randomUUID(), timestamp: Date.now(), params: { clipId: clip.id, speed } });
  return res.success ? null : FAILED;
}

/** `volume` is a gain: 1 = 100%, 0 = muted, up to 2 = 200%. */
export async function setVolume(clipId: string, volume: number): Promise<string | null> {
  const res = await store().executeAction({ type: "audio/setVolume", id: crypto.randomUUID(), timestamp: Date.now(), params: { clipId, volume } });
  return res.success ? null : FAILED;
}

export async function duplicate(t: Target): Promise<string | null> {
  if (t.kind !== "clip") return FAILED;
  return (await store().duplicateClip(t.id)).success ? null : FAILED;
}

export async function remove(t: Target): Promise<string | null> {
  if (t.kind === "text-clip") return store().deleteTextClip(t.id) ? null : FAILED;
  return (await store().removeClip(t.id)).success ? null : FAILED;
}

const SILENCE_ERRORS: Record<string, string> = {
  "Only video or audio clips have sound to analyse": "هذه اللقطة ما فيها صوت.",
  "Cut silences before changing the clip's speed or reversing it": "قص السكتات قبل تغيير السرعة. رجّع السرعة 1× وجرب.",
  "The clip's media file is not available in this browser": "ملف اللقطة غير موجود على هذا الجهاز.",
  "This clip has no decodable audio": "تعذّر قراءة صوت اللقطة.",
};

export const silenceTotal = (regions: readonly Region[]) => Math.round(regions.reduce((s, r) => s + (r.end - r.start), 0) * 10) / 10;

/** Silent pauses in the clip (timeline ranges), with the editor's default settings. */
export async function findSilences(clipId: string): Promise<{ regions: Region[] } | { error: string }> {
  const res = await analyseSilence(store().project, clipId, SILENCE_DEFAULTS);
  if ("error" in res) return { error: SILENCE_ERRORS[res.error] ?? FAILED };
  return { regions: res.regions };
}

/** Removes the pauses from the live project as one undo step. */
export async function cutSilences(clipId: string, regions: readonly Region[]): Promise<string | null> {
  const host = {
    getProject: () => store().project,
    applyAction: (action: Parameters<EditingHost["applyAction"]>[0]) => store().executeAction(action),
  } as unknown as EditingHost;
  const error = await grouped("Cut silence", () => applySilenceCuts(host, clipId, regions));
  return error ? FAILED : null;
}
