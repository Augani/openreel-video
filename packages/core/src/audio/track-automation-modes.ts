import type { AutomationPoint, Track, TrackAutomation, TrackAutomationMode } from "../types/timeline";
import { sanitizeTrackLane, TRACK_LANE_RANGE, type TrackAutomationLane } from "./track-automation";
import { laneValueAt } from "./rack-effect-automation";

/**
 * Premiere-style track automation modes and the recording math behind them. Pure: the mixer UI feeds fader / pan
 * samples in, and gets the replacement lane points out, which are committed as ONE undoable action per pass.
 */

export const TRACK_AUTOMATION_MODES: readonly TrackAutomationMode[] = ["off", "read", "write", "touch", "latch"];

export const isTrackAutomationMode = (value: unknown): value is TrackAutomationMode =>
  typeof value === "string" && (TRACK_AUTOMATION_MODES as readonly string[]).includes(value);

export const TRACK_AUTOMATION_MODE_LABELS: Record<TrackAutomationMode, string> = {
  off: "Off",
  read: "Read",
  write: "Write",
  touch: "Touch",
  latch: "Latch",
};

export const trackAutomationMode = (track: Pick<Track, "automationMode">): TrackAutomationMode =>
  track.automationMode ?? "read";

/** Modes that record fader / pan moves during playback. */
export const isRecordingMode = (mode: TrackAutomationMode): boolean =>
  mode === "write" || mode === "touch" || mode === "latch";

/**
 * The lanes that play: none in Off, otherwise the stored lanes (Write / Touch / Latch play the existing curve until
 * the recorder takes over a lane for the span it is writing).
 */
export function effectiveTrackAutomation(track: Pick<Track, "automation" | "automationMode">): TrackAutomation | undefined {
  return trackAutomationMode(track) === "off" ? undefined : track.automation;
}

export const hasEffectiveTrackAutomation = (track: Pick<Track, "automation" | "automationMode">): boolean => {
  const lanes = effectiveTrackAutomation(track);
  return !!lanes && ((lanes.volume?.length ?? 0) > 0 || (lanes.pan?.length ?? 0) > 0);
};

/* ------------------------------------------------------------------ */
/* Point thinning                                                      */
/* ------------------------------------------------------------------ */

/** Default thinning tolerance: 0.25 dB on the fader, 0.02 (1% of the half range) on pan. */
export const THIN_TOLERANCE_DB = 0.25;
export const THIN_TOLERANCE_PAN = 0.02;

const DB_FLOOR = -60;
const toDb = (linear: number): number => (linear > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(linear)) : DB_FLOOR);

/**
 * Ramer-Douglas-Peucker thinning. Volume lanes are measured in dB (the lane interpolates linearly in gain, the
 * error is what you hear: the dB difference between the thinned line and the dropped point). Pan is measured in
 * its own units. Both end points are kept and every dropped point stays within `tolerance` of the result.
 */
export function thinLanePoints(
  lane: TrackAutomationLane,
  points: readonly AutomationPoint[],
  tolerance: number = lane === "volume" ? THIN_TOLERANCE_DB : THIN_TOLERANCE_PAN,
): AutomationPoint[] {
  const list = sanitizeTrackLane(lane, points);
  if (list.length <= 2 || !(tolerance > 0)) return list;
  const measure = lane === "volume" ? toDb : (v: number) => v;
  const keep = new Array<boolean>(list.length).fill(false);
  keep[0] = true;
  keep[list.length - 1] = true;
  const stack: Array<[number, number]> = [[0, list.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop() as [number, number];
    const a = list[from];
    const b = list[to];
    let worst = -1;
    let worstError = 0;
    for (let i = from + 1; i < to; i += 1) {
      const progress = (list[i].time - a.time) / (b.time - a.time);
      const interpolated = a.value + (b.value - a.value) * progress;
      const error = Math.abs(measure(list[i].value) - measure(interpolated));
      if (error > worstError) {
        worstError = error;
        worst = i;
      }
    }
    if (worst >= 0 && worstError > tolerance) {
      keep[worst] = true;
      stack.push([from, worst], [worst, to]);
    }
  }
  return list.filter((_, i) => keep[i]);
}

/* ------------------------------------------------------------------ */
/* Recording a pass                                                    */
/* ------------------------------------------------------------------ */

/** Seconds a Touch pass takes to ramp from the released value back onto the existing curve. */
export const TOUCH_RETURN_SECONDS = 0.1;
/** Smallest time gap between recorded samples (a faster stream is dropped, not queued). */
export const RECORD_MIN_INTERVAL = 0.01;

export interface LanePassInput {
  readonly lane: TrackAutomationLane;
  readonly mode: TrackAutomationMode;
  /** The lane's points when the pass began. */
  readonly existing: readonly AutomationPoint[] | undefined;
  /** Raw (time, value) samples of the control while the pass wrote, in time order. */
  readonly spans: readonly RecordedSpan[];
  readonly tolerance?: number;
}

/** One continuous write: from `start` to `end`, with the samples taken in between. */
export interface RecordedSpan {
  readonly start: number;
  readonly end: number;
  readonly samples: readonly AutomationPoint[];
  /** Touch only: the span ended because the control was released, so the lane returns to the existing curve. */
  readonly released?: boolean;
}

/**
 * The lane after a pass. The recorded spans replace whatever the lane held inside them (with thinned points);
 * everything outside stays. Spans apply in order, so a later loop lap overwrites an earlier one. Touch ramps back onto the existing curve over TOUCH_RETURN_SECONDS after release, so
 * "returns to the existing curve". Latch / Write spans simply run to the end of the pass.
 */
export function applyRecordedPass(input: LanePassInput): AutomationPoint[] {
  const { lane, mode, spans } = input;
  const existing = sanitizeTrackLane(lane, input.existing);
  if (spans.length === 0 || mode === "off" || mode === "read") return existing;
  const rest = TRACK_LANE_RANGE[lane].rest;
  let result = existing;
  for (const span of spans) {
    const samples = sanitizeTrackLane(lane, span.samples).filter((p) => p.time >= span.start && p.time <= span.end);
    if (samples.length === 0) continue;
    const written = thinLanePoints(lane, samples, input.tolerance);
    const first = written[0];
    const last = written[written.length - 1];
    const spanEnd = Math.max(span.end, last.time);
    // A Touch release ramps back to the curve as it was before this span; Write / Latch end where the pass ends.
    const returnsToCurve = mode === "touch" && span.released === true;
    const returnTime = spanEnd + TOUCH_RETURN_SECONDS;
    const returnValue = returnsToCurve ? laneValueAt(result, returnTime, rest) : undefined;
    const outside = result.filter((p) => p.time < first.time || p.time > (returnsToCurve ? returnTime : spanEnd));
    const merged = [...outside, ...written];
    if (returnValue !== undefined && result.length > 0) merged.push({ time: returnTime, value: returnValue });
    result = sanitizeTrackLane(lane, merged);
  }
  return result;
}

/**
 * Stateful recorder for one lane. The mixer calls `touch` / `release` / `value` as the control moves and `finish` when
 * the pass ends; `finish` returns the lane to commit (or null when nothing was written).
 *
 * - write: records from the pass start whether or not the control is held (the control's current value).
 * - touch: records only while the control is held.
 * - latch: starts on the first touch and keeps writing the last value until the pass ends.
 */
export class LaneRecorder {
  private readonly spans: { start: number; end: number; samples: AutomationPoint[]; released?: boolean }[] = [];
  private open: { start: number; end: number; samples: AutomationPoint[]; released?: boolean } | null = null;
  private latestValue: number;
  private touching = false;
  private latched = false;
  private lastSampleTime = -Infinity;

  constructor(
    readonly lane: TrackAutomationLane,
    readonly mode: TrackAutomationMode,
    private readonly existing: readonly AutomationPoint[] | undefined,
    initialValue: number,
    passStart: number,
    private readonly tolerance?: number,
  ) {
    this.latestValue = initialValue;
    if (mode === "write") this.beginSpan(passStart, initialValue);
  }

  get isWriting(): boolean {
    return this.open !== null;
  }

  private beginSpan(time: number, value: number): void {
    this.open = { start: time, end: time, samples: [{ time, value }] };
    this.lastSampleTime = time;
  }

  /** The control was grabbed at `time`. */
  touch(time: number, value: number): void {
    this.touching = true;
    this.latestValue = value;
    if (this.mode === "touch" && !this.open) this.beginSpan(time, value);
    if (this.mode === "latch") {
      this.latched = true;
      if (!this.open) this.beginSpan(time, value);
    }
  }

  /** The control moved to `value` at `time`. */
  value(time: number, value: number): void {
    this.latestValue = value;
    const open = this.open;
    if (!open) return;
    const writing = this.mode === "write" || this.latched || this.touching;
    if (!writing) return;
    if (time - this.lastSampleTime < RECORD_MIN_INTERVAL) {
      // Too soon after the last kept sample: a single provisional trailing sample follows the newest value.
      const last = open.samples.length - 1;
      const tail = open.samples[last];
      if (tail && tail.time > this.lastSampleTime) open.samples[last] = { time: Math.max(tail.time, time), value };
      else if (tail && time > tail.time) open.samples.push({ time, value });
      else if (tail) open.samples[last] = { time: tail.time, value };
    } else {
      open.samples.push({ time, value });
      this.lastSampleTime = time;
    }
    open.end = Math.max(open.end, time);
  }

  /** The control was let go at `time`. Touch closes its span; Latch and Write keep holding. */
  release(time: number): void {
    this.touching = false;
    if (this.mode === "touch" && this.open) {
      this.open.samples.push({ time, value: this.latestValue });
      this.open.end = Math.max(this.open.end, time);
      this.open.released = true;
      this.spans.push(this.open);
      this.open = null;
    }
  }

  /** The playhead jumped from `from` to `to` (loop wrap, seek): the span so far is closed, a held value carries on at `to`. */
  jump(from: number, to: number): void {
    const open = this.open;
    if (!open) return;
    open.samples.push({ time: Math.max(from, open.end), value: this.latestValue });
    open.end = Math.max(open.end, from);
    this.spans.push(open);
    this.open = null;
    if (this.mode === "write" || this.latched || (this.mode === "touch" && this.touching)) this.beginSpan(to, this.latestValue);
  }

  /** The playhead moved to `time`; Write and Latch spans extend with the held value (a flat line, thinned away). */
  advance(time: number): void {
    if (!this.open) return;
    if (this.mode === "write" || this.latched) this.value(time, this.latestValue);
  }

  /** Ends the pass at `passEnd`. Returns the lane to commit, or null when the pass wrote nothing. */
  finish(passEnd: number): AutomationPoint[] | null {
    if (this.open) {
      this.open.samples.push({ time: Math.max(passEnd, this.open.end), value: this.latestValue });
      this.open.end = Math.max(this.open.end, passEnd);
      this.spans.push(this.open);
      this.open = null;
    }
    if (this.spans.length === 0) return null;
    return applyRecordedPass({
      lane: this.lane,
      mode: this.mode,
      existing: this.existing,
      spans: this.spans,
      tolerance: this.tolerance,
    });
  }
}

/** One track's share of a recording pass: replacement lane points (null clears) and effect keyframes. */
export interface TrackAutomationPass {
  readonly trackId: string;
  readonly lanes?: { readonly volume?: AutomationPoint[] | null; readonly pan?: AutomationPoint[] | null };
  readonly effects?: readonly { readonly effectId: string; readonly param: string; readonly points: AutomationPoint[] | null }[];
}
