/**
 * Track mute / solo / solo-safe audibility.
 *
 * One rule shared by the live graph, the offline mixdown (preview render and export) and the
 * mixer UI so they can never disagree:
 *
 *   audible = !muted && (!anySolo || solo || soloSafe)
 *
 * - Mute always wins: a muted track is silent even if it is solo-safe or soloed.
 * - Solo on any track silences every other track...
 * - ...except solo-safe tracks (Premiere's "Solo Safe"): they keep playing while others are soloed.
 * - A solo-safe track that is itself soloed is just soloed; solo-safe never makes a track "a solo".
 */
export interface TrackAudibilityInput {
  readonly muted: boolean;
  readonly solo: boolean;
  /** Absent = false (projects saved before solo-safe existed). */
  readonly soloSafe?: boolean;
}

/** True when at least one of the tracks is soloed (solo-safe alone does not count). */
export function hasAnySoloedTrack(tracks: Iterable<Pick<TrackAudibilityInput, "solo">>): boolean {
  for (const track of tracks) if (track.solo) return true;
  return false;
}

export function isTrackAudible(track: TrackAudibilityInput, anySolo: boolean): boolean {
  if (track.muted) return false;
  if (!anySolo) return true;
  return track.solo || track.soloSafe === true;
}

/** True when solo on another track is silencing this track (it is not muted, soloed or solo-safe). */
export function isTrackSoloSuppressed(track: TrackAudibilityInput, anySolo: boolean): boolean {
  return anySolo && !track.muted && !track.solo && track.soloSafe !== true;
}

export function computeTrackAudibility<T extends TrackAudibilityInput & { readonly id: string }>(
  tracks: readonly T[],
): Map<string, boolean> {
  const anySolo = hasAnySoloedTrack(tracks);
  return new Map(tracks.map((track) => [track.id, isTrackAudible(track, anySolo)]));
}
