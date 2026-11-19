/**
 * Pure timing, placement and naming rules for voice-over recording. Nothing here touches the DOM,
 * the stores or the clock, so the rules are unit-tested on their own (voiceover-logic.test.ts) and the
 * recorder service only wires them to MediaRecorder, the transport and the action system.
 */

export const MAX_PRE_ROLL_SECONDS = 5;
/** Shortest In/Out range that counts as a punch range. */
export const MIN_PUNCH_SECONDS = 0.05;
/** Largest input latency we compensate for when placing a take. */
export const MAX_LATENCY_COMPENSATION_SECONDS = 0.25;
const OVERLAP_EPSILON = 1e-4;

export const VOICE_OVER_TRACK_NAME = "Voice Over";

export interface VoiceOverPrefs {
  /** Chosen input device; "" is the system default. */
  deviceId: string;
  /** Seconds of countdown with playback running before recording starts, 0..5. */
  preRoll: number;
  /** Record only between the In and Out marks. */
  punch: boolean;
  /** Mute timeline playback while recording so speakers do not bleed into the microphone. */
  muteDuringRecord: boolean;
  /** Destination audio track id; "" creates a new Voice Over track. */
  targetTrackId: string;
}

export const DEFAULT_VOICE_OVER_PREFS: VoiceOverPrefs = {
  deviceId: "",
  preRoll: 3,
  punch: false,
  muteDuringRecord: true,
  targetTrackId: "",
};

export const VOICE_OVER_PREFS_KEY = "openreel:voiceover:prefs:v1";

export function clampPreRoll(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_VOICE_OVER_PREFS.preRoll;
  return Math.min(MAX_PRE_ROLL_SECONDS, Math.max(0, Math.round(n)));
}

/** Reads remembered preferences defensively: anything missing or malformed falls back to the default. */
export function parseVoiceOverPrefs(raw: string | null | undefined): VoiceOverPrefs {
  if (!raw) return { ...DEFAULT_VOICE_OVER_PREFS };
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof VoiceOverPrefs, unknown>> | null;
    if (!value || typeof value !== "object") return { ...DEFAULT_VOICE_OVER_PREFS };
    return {
      deviceId: typeof value.deviceId === "string" ? value.deviceId : DEFAULT_VOICE_OVER_PREFS.deviceId,
      preRoll: value.preRoll === undefined ? DEFAULT_VOICE_OVER_PREFS.preRoll : clampPreRoll(value.preRoll),
      punch: typeof value.punch === "boolean" ? value.punch : DEFAULT_VOICE_OVER_PREFS.punch,
      muteDuringRecord:
        typeof value.muteDuringRecord === "boolean" ? value.muteDuringRecord : DEFAULT_VOICE_OVER_PREFS.muteDuringRecord,
      targetTrackId: typeof value.targetTrackId === "string" ? value.targetTrackId : DEFAULT_VOICE_OVER_PREFS.targetTrackId,
    };
  } catch {
    return { ...DEFAULT_VOICE_OVER_PREFS };
  }
}

/** The In/Out marks (the timeline's loop range) are a punch range only when Out is after In. */
export function punchRange(markIn: number, markOut: number): { start: number; end: number } | null {
  if (!Number.isFinite(markIn) || !Number.isFinite(markOut)) return null;
  if (markOut - markIn < MIN_PUNCH_SECONDS) return null;
  return { start: Math.max(0, markIn), end: markOut };
}

export interface RecordPlanInput {
  playhead: number;
  preRoll: number;
  punch: boolean;
  markIn: number;
  markOut: number;
}

export interface RecordPlan {
  /** Whether recording is bounded by the In/Out marks. */
  punched: boolean;
  /** Timeline time at which recording starts; where the take is placed. */
  recordStart: number;
  /** Timeline time at which recording stops by itself; null records until stopped. */
  recordEnd: number | null;
  /** Countdown length in seconds (always the configured pre-roll). */
  preRoll: number;
  /** Timeline time playback starts from during the pre-roll. */
  playFrom: number;
  /** Seconds the transport waits before playing; > 0 only when the start is closer to 0 than the pre-roll. */
  playDelay: number;
}

/**
 * With a punch range, recording runs from In to Out and the pre-roll lead-in precedes In. Otherwise it
 * starts at the playhead and runs until stopped. Playback starts `preRoll` seconds before the start; when
 * that would be before 0 the playhead waits at 0 for the difference, so the countdown always lasts the
 * configured time and playback reaches the start exactly when recording begins.
 */
export function resolveRecordPlan(input: RecordPlanInput): RecordPlan {
  const preRoll = clampPreRoll(input.preRoll);
  const range = input.punch ? punchRange(input.markIn, input.markOut) : null;
  const recordStart = range ? range.start : Math.max(0, input.playhead);
  const playFrom = Math.max(0, recordStart - preRoll);
  return {
    punched: range !== null,
    recordStart,
    recordEnd: range ? range.end : null,
    preRoll,
    playFrom,
    playDelay: Math.max(0, preRoll - (recordStart - playFrom)),
  };
}

/** Seconds from "record" until the recorder starts, then how long a punched take runs. */
export function planTimings(plan: RecordPlan): { startAfterMs: number; autoStopAfterMs: number | null } {
  return {
    startAfterMs: Math.round(plan.preRoll * 1000),
    autoStopAfterMs: plan.recordEnd === null ? null : Math.round((plan.recordEnd - plan.recordStart) * 1000),
  };
}

/** Whole seconds shown on the countdown ("3 2 1"); 0 once recording may begin. */
export function countdownSeconds(remainingMs: number): number {
  return remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 1000);
}

/**
 * Where a take lands on the timeline: the planned start moved earlier by the input's reported latency
 * (sound captured at time T reaches the recorder at T + latency), never before 0 or by more than the cap.
 */
export function takeTimelineStart(recordStart: number, inputLatencySeconds: number | undefined): number {
  const latency =
    typeof inputLatencySeconds === "number" && Number.isFinite(inputLatencySeconds)
      ? Math.min(MAX_LATENCY_COMPENSATION_SECONDS, Math.max(0, inputLatencySeconds))
      : 0;
  return Math.max(0, recordStart - latency);
}

const TAKE_NAME = /^Voice Over Take (\d+)(?:\.\w+)?$/;
const LEGACY_NAME = /^Voice-over \d{4}-/;

export function takeName(number: number): string {
  return `Voice Over Take ${number}`;
}

/** Take number parsed from a media name; null for anything that is not a voice-over take. */
export function parseTakeNumber(name: string): number | null {
  const match = TAKE_NAME.exec(name.trim());
  return match ? Number(match[1]) : null;
}

/** True for takes recorded by this panel and for older date-stamped voice-overs. */
export function isVoiceOverMediaName(name: string): boolean {
  return TAKE_NAME.test(name.trim()) || LEGACY_NAME.test(name.trim());
}

/** The next free take number across every media name in the project. */
export function nextTakeNumber(mediaNames: Iterable<string>): number {
  let highest = 0;
  for (const name of mediaNames) {
    const n = parseTakeNumber(name);
    if (n !== null && n > highest) highest = n;
  }
  return highest + 1;
}

interface PlacementClip {
  startTime: number;
  duration: number;
}

export interface PlacementTrack {
  id: string;
  name: string;
  type: string;
  locked: boolean;
  clips: ReadonlyArray<PlacementClip>;
}

/** Unlocked audio tracks a take can be recorded to. */
export function audioTrackChoices<T extends PlacementTrack>(tracks: ReadonlyArray<T>): T[] {
  return tracks.filter((track) => track.type === "audio" && !track.locked);
}

export function rangeOccupied(clips: ReadonlyArray<PlacementClip>, start: number, end: number): boolean {
  return clips.some((clip) => start < clip.startTime + clip.duration - OVERLAP_EPSILON && clip.startTime < end - OVERLAP_EPSILON);
}

export type TakePlacement =
  | { kind: "existing"; trackId: string }
  | { kind: "new"; trackName: string; reason: "requested" | "occupied" | "unavailable" };

/** "Voice Over", then "Voice Over 2", "Voice Over 3"... (the first free name among the project's tracks). */
export function nextVoiceTrackName(tracks: ReadonlyArray<{ name: string }>): string {
  const used = new Set(tracks.map((track) => track.name));
  if (!used.has(VOICE_OVER_TRACK_NAME)) return VOICE_OVER_TRACK_NAME;
  for (let n = 2; ; n++) {
    const candidate = `${VOICE_OVER_TRACK_NAME} ${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Takes stack: a take goes on the chosen track when its time range is free there, otherwise on a new
 * track below, so a re-take never overwrites or overlaps an earlier take.
 */
export function chooseTakeTrack(
  tracks: ReadonlyArray<PlacementTrack>,
  targetTrackId: string,
  start: number,
  end: number,
): TakePlacement {
  const newName = nextVoiceTrackName(tracks);
  if (!targetTrackId) return { kind: "new", trackName: newName, reason: "requested" };
  const target = tracks.find((track) => track.id === targetTrackId);
  if (!target || target.type !== "audio" || target.locked) {
    return { kind: "new", trackName: newName, reason: "unavailable" };
  }
  if (rangeOccupied(target.clips, start, end)) return { kind: "new", trackName: newName, reason: "occupied" };
  return { kind: "existing", trackId: target.id };
}

export interface VoiceOverTake {
  clipId: string;
  trackId: string;
  mediaId: string;
  name: string;
  /** Recording order; null for older date-stamped voice-overs. */
  number: number | null;
  startTime: number;
  duration: number;
}

/** Every voice-over clip in the project, takes in recording order and older recordings by position. */
export function listVoiceOverTakes(
  tracks: ReadonlyArray<{ id: string; clips: ReadonlyArray<{ id: string; mediaId: string; startTime: number; duration: number }> }>,
  mediaNames: ReadonlyMap<string, string>,
): VoiceOverTake[] {
  const takes: VoiceOverTake[] = [];
  for (const track of tracks) {
    for (const clip of track.clips) {
      const name = mediaNames.get(clip.mediaId);
      if (!name || !isVoiceOverMediaName(name)) continue;
      takes.push({
        clipId: clip.id,
        trackId: track.id,
        mediaId: clip.mediaId,
        name: name.replace(/\.\w+$/, ""),
        number: parseTakeNumber(name),
        startTime: clip.startTime,
        duration: clip.duration,
      });
    }
  }
  return takes.sort((a, b) => {
    if (a.number !== null && b.number !== null) return a.number - b.number;
    if (a.number !== null) return 1;
    if (b.number !== null) return -1;
    return a.startTime - b.startTime;
  });
}

/** Peak level 0..1 of 8-bit time-domain samples (128 is silence). */
export function peakLevel(samples: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i] - 128) / 128;
    if (v > peak) peak = v;
  }
  return Math.min(1, peak);
}

export function selectVoiceOverMimeType(
  supports: (mimeType: string) => boolean,
): { mimeType: string; extension: string } | null {
  const candidates = [
    { mimeType: "audio/webm;codecs=opus", extension: "webm" },
    { mimeType: "audio/mp4", extension: "m4a" },
    { mimeType: "audio/webm", extension: "webm" },
    { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  ];
  return candidates.find((candidate) => supports(candidate.mimeType)) ?? null;
}

export function formatClock(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
