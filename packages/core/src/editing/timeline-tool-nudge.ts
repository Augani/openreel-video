import type { Project } from "../types/project";
import type { Clip } from "../types/timeline";
import {
  applyTimelineToolEdits,
  collections,
  createRippleContext,
  narrowRippleBounds,
  prepareTimelineToolEdit,
  rippleResizeItem,
  type TimelineToolItemEdit,
  type TimelineToolMode,
  type TimelineToolPlan,
} from "./timeline-tool-edit";

export const NUDGE_FRAMES = 1;
export const NUDGE_FRAMES_LARGE = 5;

/** The edit point nearest the playhead: the clip's head or its tail. */
export function chooseNudgeEdge(
  clip: { startTime: number; duration: number },
  playhead: number,
): "left" | "right" {
  const toStart = Math.abs(playhead - clip.startTime);
  const toEnd = Math.abs(playhead - (clip.startTime + clip.duration));
  return toStart < toEnd ? "left" : "right";
}

/**
 * Plans a keyboard nudge of the active tool's edit by whole frames. Positive
 * `frames` is a rightward gesture, matching a drag: later in time for ripple,
 * roll, slide and stretch; for slip the content moves the opposite way (as in
 * a drag), unless the clip is reversed. Bounds are the same as a drag, so a
 * nudge past a handle or neighbour is clamped (an empty plan if nothing moves).
 */
export function planToolNudge(
  project: Project,
  options: {
    mode: TimelineToolMode;
    itemId: string;
    linkedIds?: readonly string[];
    edge?: "left" | "right";
    frames: number;
  },
): TimelineToolPlan {
  const { frames, ...rest } = options;
  if (!Number.isFinite(frames)) throw new Error("The nudge must be finite.");
  const prepared = prepareTimelineToolEdit(project, rest);
  const rate =
    Number.isFinite(project.settings.frameRate) && project.settings.frameRate > 0
      ? project.settings.frameRate
      : 30;
  const reversed = "reversed" in prepared.primary && Boolean((prepared.primary as Clip).reversed);
  const sign = options.mode === "slip" && !reversed ? -1 : 1;
  return prepared.plan((sign * frames) / rate);
}

export interface ToolNudgeSelectionResult {
  /** ONE plan for the whole selection (commit it as one `timeline/toolEdit`: one store commit, one undo step). */
  plan: TimelineToolPlan;
  /** Edit points (or, for slip, the one slip) that moved. */
  nudged: number;
  /** Edit points that could not move (locked track, source handle, misaligned linked clips), with the first reason. */
  skipped: number;
  firstError?: string;
}

const alignKey = (clip: { startTime: number; duration: number }) =>
  `${Math.round(clip.startTime * 1e6)}|${Math.round(clip.duration * 1e6)}`;

/**
 * Nudges the active tool's edit on EVERY selected clip by the same number of frames, as one plan.
 *
 * The single-clip planner edits one edit point (the clip plus its linked partners, which must share the same start and
 * length). A selection of unaligned clips is therefore planned as one edit point per distinct (start, length), right to
 * left, each against the project the previous ones already produced (so a ripple's shift is seen by the clips to its
 * left), and the per-item results are composed: for every item the first `before` and the last `after`. Slip needs no
 * alignment and is planned once for all selected clips (the delta is bounded by the tightest clip, as for linked clips).
 * Edit points that cannot move are skipped and counted, they never fail the others.
 */
export function planToolNudgeSelection(
  project: Project,
  options: {
    mode: TimelineToolMode;
    /** Selected clip ids, in selection order. */
    itemIds: readonly string[];
    /** Linked partners of a clip (any order, may include the clip itself). */
    linkedIdsOf?: (id: string) => readonly string[];
    playhead: number;
    frames: number;
    /** Plan one edit point after the other even when the batched ripple planner applies (the reference the tests compare it to). */
    forceSequential?: boolean;
  },
): ToolNudgeSelectionResult {
  const clipsById = new Map<string, Clip>();
  for (const track of project.timeline.tracks) for (const clip of track.clips) clipsById.set(clip.id, clip);
  const selected = [...new Set(options.itemIds)].filter((id) => clipsById.has(id));
  if (selected.length === 0) throw new Error("Select a clip to nudge its edit.");
  const partnersOf = (id: string) => (options.linkedIdsOf?.(id) ?? []).filter((other) => other !== id && clipsById.has(other));

  const groups: Array<{ primary: string; members: string[] }> = [];
  if (options.mode === "slip") {
    const members = new Set<string>(selected);
    for (const id of selected) for (const partner of partnersOf(id)) members.add(partner);
    const [primary, ...rest] = [...members];
    groups.push({ primary, members: rest });
  } else {
    const byKey = new Map<string, string[]>();
    for (const id of selected) {
      const key = alignKey(clipsById.get(id)!);
      const list = byKey.get(key);
      if (list) list.push(id);
      else byKey.set(key, [id]);
    }
    for (const ids of byKey.values()) {
      const members = new Set<string>(ids);
      for (const id of ids) for (const partner of partnersOf(id)) members.add(partner);
      const [primary, ...rest] = [...members];
      groups.push({ primary, members: rest });
    }
    // Right to left: the clips already edited sit to the right, so a ripple's shift never moves an edit point still to be planned.
    groups.sort((a, b) => clipsById.get(b.primary)!.startTime - clipsById.get(a.primary)!.startTime);
  }

  if (options.mode === "ripple" && !options.forceSequential) {
    const batched = planRippleSelectionBatched(project, groups, clipsById, options.playhead, options.frames);
    if (batched) return batched;
  }
  return planGroupsSequentially(project, groups, options);
}

/**
 * The reference planner: one edit point after the other, each planned against the project the previous ones produced.
 * Exported for the equality tests; `planToolNudgeSelection` uses it whenever the batched ripple planner does not apply.
 */
export function planGroupsSequentially(
  project: Project,
  groups: ReadonlyArray<{ primary: string; members: string[] }>,
  options: { mode: TimelineToolMode; playhead: number; frames: number },
): ToolNudgeSelectionResult {
  const composed = new Map<string, TimelineToolItemEdit>();
  let label = "";
  let delta = 0;
  let work = project;
  let nudged = 0;
  let skipped = 0;
  let firstError: string | undefined;
  for (let i = 0; i < groups.length; i++) {
    const { primary, members } = groups[i];
    const clip = (work.timeline.tracks.flatMap((track) => track.clips).find((c) => c.id === primary)) as Clip | undefined;
    try {
      if (!clip) throw new Error("This timeline item is no longer available.");
      const plan = planToolNudge(work, {
        mode: options.mode,
        itemId: primary,
        linkedIds: members,
        edge: chooseNudgeEdge(clip, options.playhead),
        frames: options.frames,
      });
      if (plan.edits.length === 0) {
        skipped++;
        firstError ??= BLOCKED_MESSAGE;
        continue;
      }
      nudged++;
      if (!label) ({ label, delta } = plan);
      for (const edit of plan.edits) {
        const key = `${edit.kind}:${edit.id}`;
        const earlier = composed.get(key);
        composed.set(key, earlier ? { ...earlier, after: edit.after } : edit);
      }
      if (i < groups.length - 1) work = applyTimelineToolEdits(work, plan.edits);
    } catch (error) {
      skipped++;
      firstError ??= error instanceof Error ? error.message : "The edit failed.";
    }
  }
  const edits = [...composed.values()].filter((edit) => edit.after !== edit.before);
  return { plan: { label: label || "Nudge edit", delta, edits }, nudged, skipped, ...(firstError ? { firstError } : {}) };
}


const EPS = 1e-7;
const BLOCKED_MESSAGE = "The edit point cannot move that way (source handle, neighbour or one-frame minimum).";

/**
 * Ripple nudge of a whole selection planned in ONE pass over the timeline instead of one full-project plan per edit point.
 *
 * It replays exactly what the sequential planner does (edit points right to left; each ripple shifts every item of its
 * tracks that starts at or after its cut, with the same bounds, the same frame rounding and the same floating-point
 * additions in the same order) but on plain numbers, and builds the edit objects once at the end. Cost: O(items x edit
 * points) additions without allocation, instead of O(items x edit points) cloned clips, maps and projects.
 *
 * It only handles the shape of project where nothing else follows a ripple: every edit point is made of plain media
 * clips on distinct unlocked tracks (no overlap between edit points), no transitions, no text / shape / sticker /
 * adjustment / motion items, no track groups, and no sync-locked track outside an edit point that holds clips (those
 * would be split and shifted too). Anything else, and any edit point that would throw in the sequential planner, returns
 * null so the sequential planner runs and reports exactly what it always did.
 */
function planRippleSelectionBatched(
  project: Project,
  groups: ReadonlyArray<{ primary: string; members: string[] }>,
  clipsById: ReadonlyMap<string, Clip>,
  playhead: number,
  frames: number,
): ToolNudgeSelectionResult | null {
  if (!Number.isFinite(frames) || groups.length === 0) return null;
  for (const field of Object.values(collections)) {
    if ((project[field as keyof Project] as readonly unknown[] | undefined)?.length) return null;
  }
  const tracks = project.timeline.tracks;
  const clips: Clip[] = [];
  const trackOf: number[] = [];
  const indexInTrack: number[] = [];
  const flatOf = new Map<string, number>();
  for (let t = 0; t < tracks.length; t++) {
    const track = tracks[t];
    if (track.groupId || track.transitions.length > 0) return null;
    for (let c = 0; c < track.clips.length; c++) {
      const clip = track.clips[c];
      flatOf.set(clip.id, clips.length);
      clips.push(clip);
      trackOf.push(t);
      indexInTrack.push(c);
    }
  }
  const total = clips.length;
  const populatedSynced = new Set<number>();
  tracks.forEach((track, t) => {
    if (!track.locked && track.syncLock !== false && track.clips.length > 0) populatedSynced.add(t);
  });

  const mediaById = new Map(project.mediaLibrary.items.map((media) => [media.id, media]));
  const compoundsById = new Map((project.compoundClips ?? []).map((compound) => [compound.id, compound]));
  const ctx = createRippleContext(mediaById, compoundsById);
  const rateRaw = project.settings.frameRate;
  const rate = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : 30;
  const requested = frames / rate;

  const start = new Float64Array(total);
  const duration = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    start[i] = clips[i].startTime;
    duration[i] = clips[i].duration;
  }
  const owner = new Int32Array(total).fill(-1);
  const resized: Array<Clip | undefined> = new Array(total);
  const touched = new Uint8Array(total);
  const order: number[] = [];
  const touch = (i: number) => {
    if (!touched[i]) {
      touched[i] = 1;
      order.push(i);
    }
  };

  const memberLists: number[][] = [];
  for (let g = 0; g < groups.length; g++) {
    const ids = [...new Set([groups[g].primary, ...groups[g].members])];
    const list: number[] = [];
    const used = new Set<number>();
    for (const id of ids) {
      const flat = flatOf.get(id);
      if (flat === undefined || !clipsById.has(id) || owner[flat] !== -1) return null;
      if (used.has(trackOf[flat])) return null;
      used.add(trackOf[flat]);
      owner[flat] = g;
      list.push(flat);
    }
    memberLists.push(list);
  }

  let label = "";
  let delta = 0;
  let nudged = 0;
  let skipped = 0;
  let firstError: string | undefined;
  const cutOfTrack = new Float64Array(tracks.length);
  const hasCut = new Uint8Array(tracks.length);

  for (let g = 0; g < groups.length; g++) {
    const list = memberLists[g];
    const primary = flatOf.get(groups[g].primary)!;
    const memberTracks = new Set(list.map((i) => trackOf[i]));
    for (const t of populatedSynced) if (!memberTracks.has(t)) return null;
    for (const i of list) {
      const clip = clips[i];
      if (tracks[trackOf[i]].locked) return null;
      if (!Number.isFinite(start[i]) || start[i] < 0 || !Number.isFinite(duration[i]) || duration[i] <= 0) return null;
      const speedValue = clip.speed ?? 1;
      if (!Number.isFinite(speedValue) || speedValue <= 0) return null;
      if (!Number.isFinite(clip.inPoint) || clip.inPoint < 0 || !Number.isFinite(clip.outPoint) || clip.outPoint < clip.inPoint) return null;
      if (Math.abs(start[i] - start[primary]) > EPS || Math.abs(duration[i] - duration[primary]) > EPS) return null;
    }
    const frame = list.reduce((minimum, i) => Math.min(minimum, duration[i]), 1 / rate);
    const bounds = { minimum: -Infinity, maximum: Infinity };
    const edge = chooseNudgeEdge({ startTime: start[primary], duration: duration[primary] }, playhead);
    for (const i of list) narrowRippleBounds(bounds, { ...clips[i], startTime: start[i] }, "media", edge, frame, ctx);
    if (bounds.minimum > EPS || bounds.maximum < -EPS || bounds.minimum > bounds.maximum + EPS) return null;
    const bounded = Math.max(bounds.minimum, Math.min(bounds.maximum, Math.round(requested / frame) * frame));
    const value = Math.abs(bounded) < EPS ? 0 : bounded;
    if (!value) {
      skipped++;
      firstError ??= BLOCKED_MESSAGE;
      continue;
    }
    nudged++;
    if (!label) {
      label = "Ripple trim";
      delta = value;
    }
    const durationDelta = edge === "left" ? -value : value;
    hasCut.fill(0);
    for (const i of list) {
      hasCut[trackOf[i]] = 1;
      cutOfTrack[trackOf[i]] = start[i] + duration[i];
      const current = start[i] === clips[i].startTime ? clips[i] : { ...clips[i], startTime: start[i] };
      const next = rippleResizeItem(current, "media", edge, value, durationDelta, ctx) as Clip;
      resized[i] = next;
      duration[i] = next.duration;
    }
    for (let i = 0; i < total; i++) {
      if (owner[i] === g) {
        touch(i);
        continue;
      }
      const t = trackOf[i];
      if (hasCut[t] && start[i] >= cutOfTrack[t] - EPS) {
        start[i] = start[i] + durationDelta;
        touch(i);
      }
    }
  }

  const edits: TimelineToolItemEdit[] = [];
  for (const i of order) {
    const before = clips[i];
    let after: Clip = resized[i] ?? before;
    if (start[i] !== after.startTime) after = { ...after, startTime: start[i] };
    if (after === before) continue;
    edits.push({ kind: "media", id: before.id, trackId: before.trackId, index: indexInTrack[i], before, after });
  }
  return { plan: { label: label || "Nudge edit", delta, edits }, nudged, skipped, ...(firstError ? { firstError } : {}) };
}
