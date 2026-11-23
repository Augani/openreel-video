/**
 * Look-ahead scheduling for playback (the Premiere "pre-roll" behaviour).
 *
 * A clip is needed on screen when its own start is reached, or earlier when a transition into it begins: a centred
 * transition shows the incoming clip half its duration BEFORE the cut, and an "end"-aligned one a full duration
 * before. Scheduling on the clip's start alone gave the decoder (and the transition) a head start that the
 * transition had already eaten into. This module decides, from the timeline alone, which clips to open and which
 * transitions to warm, ordered by when they are needed. It does no I/O, so it is unit tested without a browser.
 */

export const PLAYBACK_LOOKAHEAD_S = 2;
/** Holding a look-ahead decoder longer than this multiple of the horizon past its need point means a seek or loop left it behind. */
export const LOOKAHEAD_STALE_FACTOR = 3;

export interface LookaheadClip {
  id: string;
  startTime: number;
  duration: number;
}

export interface LookaheadTransition {
  id: string;
  type: string;
  clipAId: string;
  clipBId?: string;
}

export interface LookaheadTrack {
  hidden?: boolean;
  clips: readonly LookaheadClip[];
}

export interface LookaheadTarget {
  clipId: string;
  trackIndex: number;
  /** Timeline time at which the clip first has to be on screen (its start, or the start of the transition into it). */
  needAt: number;
  reason: "start" | "transition";
  /** The transition that pulls the need point forward, when reason is "transition". */
  transitionId?: string;
}

export interface TransitionWarmTarget {
  transitionId: string;
  type: string;
  clipAId: string;
  clipBId: string;
  trackIndex: number;
  /** Timeline time at which the transition's first frame is rendered. */
  needAt: number;
}

export interface LookaheadPlanInput {
  tracks: readonly LookaheadTrack[];
  /** Transitions of each track, in the same order as `tracks`. */
  transitionsByTrack: ReadonlyArray<readonly LookaheadTransition[]>;
  time: number;
  /** How far ahead of its need point a clip is opened. Defaults to PLAYBACK_LOOKAHEAD_S. */
  horizonS?: number;
  /** Timeline window the transition covers (the engine's own rule, so preview and export agree). */
  transitionWindow: (transition: LookaheadTransition, clipA: LookaheadClip) => { start: number; end: number };
  /** False for clips that never get a decoder (hidden, audio only, still images...). */
  isDecodable: (clip: LookaheadClip) => boolean;
}

export interface LookaheadPlan {
  /** Clips to open, most urgent first. */
  clips: LookaheadTarget[];
  /** Transitions whose first frame is inside the horizon, most urgent first. */
  transitions: TransitionWarmTarget[];
}

export function planLookahead(input: LookaheadPlanInput): LookaheadPlan {
  const horizon = input.horizonS ?? PLAYBACK_LOOKAHEAD_S;
  const { time } = input;
  const byClip = new Map<string, LookaheadTarget>();
  const transitions: TransitionWarmTarget[] = [];

  // The earliest moment each clip is needed, over its own start and every transition that shows it first.
  const note = (target: LookaheadTarget) => {
    const known = byClip.get(target.clipId);
    if (!known || target.needAt < known.needAt) byClip.set(target.clipId, target);
  };

  input.tracks.forEach((track, trackIndex) => {
    if (track.hidden) return;
    for (const clip of track.clips) {
      if (!input.isDecodable(clip)) continue;
      note({ clipId: clip.id, trackIndex, needAt: clip.startTime, reason: "start" });
    }
    for (const transition of input.transitionsByTrack[trackIndex] ?? []) {
      const clipA = track.clips.find((c) => c.id === transition.clipAId);
      const clipB = transition.clipBId ? track.clips.find((c) => c.id === transition.clipBId) : undefined;
      if (!clipA || !clipB || !input.isDecodable(clipA) || !input.isDecodable(clipB)) continue;
      const { start } = input.transitionWindow(transition, clipA);
      // The outgoing clip is on screen before the transition begins; only the incoming clip is pulled forward.
      if (start < clipB.startTime) note({ clipId: clipB.id, trackIndex, needAt: start, reason: "transition", transitionId: transition.id });
      if (start > time && start - time <= horizon) {
        transitions.push({ transitionId: transition.id, type: transition.type, clipAId: clipA.id, clipBId: clipB.id, trackIndex, needAt: start });
      }
    }
  });

  // Already needed (the frame loop opens it on demand) or too far away to open yet.
  for (const [id, target] of byClip) {
    if (target.needAt <= time || target.needAt - time > horizon) byClip.delete(id);
  }

  const clips = [...byClip.values()].sort((a, b) => a.needAt - b.needAt || a.trackIndex - b.trackIndex);
  transitions.sort((a, b) => a.needAt - b.needAt || a.trackIndex - b.trackIndex);
  return { clips, transitions };
}

/** True when a held look-ahead decoder was left behind by a seek or loop and should be released. */
export function isLookaheadStale(entry: { needAt: number; endTime: number }, time: number, horizonS = PLAYBACK_LOOKAHEAD_S): boolean {
  return entry.needAt - time > horizonS * LOOKAHEAD_STALE_FACTOR || time >= entry.endTime;
}
