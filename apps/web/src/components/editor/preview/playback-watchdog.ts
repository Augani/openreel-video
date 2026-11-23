/**
 * Playback loop watchdog.
 *
 * The multi-track playback loop handles one frame at a time and only schedules the next one when the current
 * frame finishes. If any await inside a frame never settles (a decoder that stops answering while a clip opens,
 * a GPU upload on a lost context), the loop stops for good: the Program monitor and the playhead freeze while the
 * audio clock runs on. The soak saw this twice without a console message (docs/known-limitations.md, Memory:
 * playhead stuck at 17.1 s of 46 s on a build without any of the w17 changes, and at 24.9 s on one with them),
 * so the hang site is unknown; this records where the frame was waiting and gets playback going again.
 */
export const FRAME_STALL_MS = 5000;

export interface PlaybackStall {
  stage: string;
  stalledMs: number;
  atPlayhead: number;
}

const stalls: PlaybackStall[] = [];

export function recordPlaybackStall(stall: PlaybackStall): void {
  stalls.push(stall);
  if (stalls.length > 50) stalls.shift();
}

export function getPlaybackStalls(): readonly PlaybackStall[] {
  return stalls;
}

export function clearPlaybackStalls(): void {
  stalls.length = 0;
}

/**
 * A short ring of playback lifecycle events (effect restarts, clock start, loop armed, loop exits) so a freeze
 * that leaves no console message can be placed: the e2e hook exposes it to the soak specs.
 */
export interface PlaybackEvent {
  at: number;
  kind: string;
  playhead: number;
}

const events: PlaybackEvent[] = [];

export function recordPlaybackEvent(kind: string, playhead: number): void {
  events.push({ at: Math.round(performance.now()), kind, playhead: Math.round(playhead * 100) / 100 });
  if (events.length > 200) events.shift();
}

/**
 * Slow stages of the playback frame loop (a stage that took longer than STAGE_TRACE_MIN_MS), kept in a short ring so a
 * stall can be attributed to the stage that caused it (decoder open, decode, effects, transition render).
 */
export const STAGE_TRACE_MIN_MS = 16;
export interface PlaybackStageTrace {
  at: number;
  stage: string;
  ms: number;
  playhead: number;
}
const stageTraces: PlaybackStageTrace[] = [];

export function tracePlaybackStage(stage: string, startedAt: number, playhead: number): void {
  const ms = performance.now() - startedAt;
  if (ms < STAGE_TRACE_MIN_MS) return;
  stageTraces.push({ at: Math.round(performance.now()), stage, ms: Math.round(ms * 10) / 10, playhead: Math.round(playhead * 100) / 100 });
  if (stageTraces.length > 1500) stageTraces.shift();
}

/** A frame that started this long after the previous one is a frame-loop gap worth naming. */
export const LOOP_GAP_TRACE_MS = 120;

export function tracePlaybackLoopGap(previousStage: string, gapMs: number, playheadDelta: number, playhead: number): void {
  if (gapMs < LOOP_GAP_TRACE_MS) return;
  stageTraces.push({
    at: Math.round(performance.now()),
    stage: `loop-gap(after:${previousStage}) playheadDelta=${Math.round(playheadDelta * 1000)}ms`,
    ms: Math.round(gapMs * 10) / 10,
    playhead: Math.round(playhead * 100) / 100,
  });
  if (stageTraces.length > 1500) stageTraces.shift();
}

export function getPlaybackStageTraces(): readonly PlaybackStageTrace[] {
  return stageTraces;
}

export function getPlaybackEvents(): readonly PlaybackEvent[] {
  return events;
}

export interface FrameWatchdogOptions {
  /** True while a frame is being processed. */
  isProcessing: () => boolean;
  /** performance.now() at which the current frame started. */
  frameStartedAt: () => number;
  /** What the current frame is waiting on. */
  stage: () => string;
  playhead: () => number;
  /** Abandons the hung frame and restarts the loop. */
  recover: (stall: PlaybackStall) => void;
  now?: () => number;
  stallMs?: number;
  intervalMs?: number;
}

/** Starts the watchdog; the returned function stops it. */
export function startFrameWatchdog(options: FrameWatchdogOptions): () => void {
  const now = options.now ?? (() => performance.now());
  const stallMs = options.stallMs ?? FRAME_STALL_MS;
  const timer = setInterval(() => {
    if (!options.isProcessing()) return;
    const waited = now() - options.frameStartedAt();
    if (waited < stallMs) return;
    const stall: PlaybackStall = { stage: options.stage(), stalledMs: Math.round(waited), atPlayhead: options.playhead() };
    recordPlaybackStall(stall);
    options.recover(stall);
  }, options.intervalMs ?? 1000);
  return () => clearInterval(timer);
}
