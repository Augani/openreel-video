import { create } from "zustand";
import { getRealtimeAudioGraph } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import {
  DEFAULT_VOICE_OVER_PREFS,
  VOICE_OVER_PREFS_KEY,
  chooseTakeTrack,
  clampPreRoll,
  countdownSeconds,
  nextTakeNumber,
  parseVoiceOverPrefs,
  peakLevel,
  planTimings,
  resolveRecordPlan,
  selectVoiceOverMimeType,
  takeName,
  takeTimelineStart,
  type PlacementTrack,
  type RecordPlan,
  type VoiceOverPrefs,
} from "./voiceover-logic";

export type VoiceOverPhase = "idle" | "monitoring" | "countdown" | "recording" | "saving";
export type VoiceOverErrorKind = "unsupported" | "blocked" | "denied" | "no-device" | "failed";

export interface VoiceOverDevice {
  deviceId: string;
  label: string;
}

export interface VoiceOverLastTake {
  clipId: string;
  trackId: string;
  name: string;
  /** Set when the take could not go on the chosen track and was stacked onto a new one. */
  note: string | null;
}

interface VoiceOverState {
  phase: VoiceOverPhase;
  /** Whole seconds left of the pre-roll countdown. */
  countdown: number;
  elapsedMs: number;
  /** Smoothed input peak, 0..1. */
  level: number;
  error: string | null;
  errorKind: VoiceOverErrorKind | null;
  devices: VoiceOverDevice[];
  prefs: VoiceOverPrefs;
  lastTake: VoiceOverLastTake | null;
  setPrefs: (patch: Partial<VoiceOverPrefs>) => void;
  refreshDevices: () => Promise<void>;
  startMonitor: () => Promise<void>;
  stopMonitor: () => void;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

class VoiceOverError extends Error {
  constructor(
    readonly kind: VoiceOverErrorKind,
    message: string,
  ) {
    super(message);
  }
}

interface Runtime {
  stream: MediaStream | null;
  /** The device and echo setting the open stream was created with. */
  streamKey: string;
  recorder: MediaRecorder | null;
  format: { mimeType: string; extension: string } | null;
  chunks: Blob[];
  meter: { context: AudioContext; source: MediaStreamAudioSourceNode; owned: boolean; frame: number } | null;
  plan: RecordPlan | null;
  originalPlayhead: number;
  startedAt: number;
  latency: number | undefined;
  save: boolean;
  tick: number | null;
  playTimer: number | null;
  stopTimer: number | null;
  elapsedTimer: number | null;
  /** Guards against a second start while the first is still opening the device. */
  starting: boolean;
}

const rt: Runtime = {
  stream: null,
  streamKey: "",
  recorder: null,
  format: null,
  chunks: [],
  meter: null,
  plan: null,
  originalPlayhead: 0,
  startedAt: 0,
  latency: undefined,
  save: true,
  tick: null,
  playTimer: null,
  stopTimer: null,
  elapsedTimer: null,
  starting: false,
};

function readStoredPrefs(): VoiceOverPrefs {
  try {
    return parseVoiceOverPrefs(window.localStorage.getItem(VOICE_OVER_PREFS_KEY));
  } catch {
    return { ...DEFAULT_VOICE_OVER_PREFS };
  }
}

function storePrefs(prefs: VoiceOverPrefs): void {
  try {
    window.localStorage.setItem(VOICE_OVER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Remembering the settings is a convenience; recording works without it.
  }
}

function streamKeyFor(prefs: VoiceOverPrefs): string {
  return `${prefs.deviceId}|${prefs.muteDuringRecord ? 1 : 0}`;
}

function clearTimers(): void {
  for (const key of ["tick", "playTimer", "stopTimer", "elapsedTimer"] as const) {
    const handle = rt[key];
    if (handle !== null) {
      window.clearTimeout(handle);
      window.clearInterval(handle);
      rt[key] = null;
    }
  }
}

function stopMeter(): void {
  if (rt.meter) {
    cancelAnimationFrame(rt.meter.frame);
    try {
      rt.meter.source.disconnect();
    } catch {
      // Already disconnected.
    }
    if (rt.meter.owned) void rt.meter.context.close().catch(() => undefined);
    rt.meter = null;
  }
}

function releaseStream(): void {
  rt.stream?.getTracks().forEach((track) => track.stop());
  rt.stream = null;
  rt.streamKey = "";
  rt.recorder = null;
  stopMeter();
  useVoiceOverStore.setState({ level: 0 });
}

/**
 * Meters the live input on the editor's own AudioContext (opening another context per take is slow and can
 * stall on some audio hardware); a private context is only the fallback when the shared one is unavailable.
 */
function startMeter(stream: MediaStream): void {
  stopMeter();
  try {
    let context: AudioContext;
    let owned = false;
    try {
      context = getRealtimeAudioGraph().getAudioContext();
    } catch {
      context = new AudioContext();
      owned = true;
    }
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const state = { context, source, owned, frame: 0 };
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      const previous = useVoiceOverStore.getState().level;
      const next = Math.max(peakLevel(data), previous * 0.85);
      if (Math.abs(next - previous) > 0.01) useVoiceOverStore.setState({ level: next });
      state.frame = requestAnimationFrame(tick);
    };
    state.frame = requestAnimationFrame(tick);
    rt.meter = state;
  } catch {
    // The meter is informational; recording works without it.
  }
}

/** Desktop only: have the OS grant (or explain the refusal of) microphone access before the page asks. */
async function ensureDesktopMicrophone(): Promise<void> {
  const microphone = typeof window !== "undefined" ? window.openreel?.microphone : undefined;
  if (!microphone) return;
  try {
    let status = await microphone.status();
    if (status === "not-determined") status = await microphone.request();
    if (status === "denied" || status === "restricted") {
      throw new VoiceOverError(
        "blocked",
        status === "restricted"
          ? "Microphone access is restricted on this computer by a system policy."
          : "Microphone access is turned off for OpenReel. Allow it in your system privacy settings, then try again.",
      );
    }
  } catch (reason) {
    if (reason instanceof VoiceOverError) throw reason;
    // A bridge failure must not block recording; the browser prompt below still decides.
  }
}

async function openStream(prefs: VoiceOverPrefs): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new VoiceOverError("unsupported", "Voice-over recording is not supported by this browser.");
  }
  const constraints = (deviceId: string): Parameters<MediaDevices["getUserMedia"]>[0] => ({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      // Echo cancellation only helps when the timeline is audible on speakers; it colours a clean take.
      echoCancellation: !prefs.muteDuringRecord,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  try {
    return await navigator.mediaDevices.getUserMedia(constraints(prefs.deviceId));
  } catch (reason) {
    const name = reason instanceof DOMException ? reason.name : "";
    if (prefs.deviceId && (name === "OverconstrainedError" || name === "NotFoundError")) {
      // The remembered microphone is unplugged: fall back to the system default instead of failing.
      useVoiceOverStore.getState().setPrefs({ deviceId: "" });
      return navigator.mediaDevices.getUserMedia(constraints(""));
    }
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new VoiceOverError("denied", "Microphone access was denied. Allow it for this site (or in your system privacy settings) and try again.");
    }
    if (name === "NotFoundError" || name === "NotReadableError") {
      throw new VoiceOverError("no-device", name === "NotReadableError" ? "The microphone is in use by another application." : "No microphone was found.");
    }
    throw new VoiceOverError("failed", reason instanceof Error ? reason.message : "Could not start microphone recording.");
  }
}

function fail(reason: unknown): void {
  const kind = reason instanceof VoiceOverError ? reason.kind : "failed";
  useVoiceOverStore.setState({
    error: reason instanceof Error ? reason.message : "Could not start microphone recording.",
    errorKind: kind,
  });
}

function pausePlayback(): void {
  useTimelineStore.getState().pause();
}

function resetToIdle(): void {
  clearTimers();
  rt.plan = null;
  rt.starting = false;
  useVoiceOverStore.setState({ phase: "idle", countdown: 0, elapsedMs: 0 });
}

function beginRecording(): void {
  if (rt.tick !== null) {
    window.clearInterval(rt.tick);
    rt.tick = null;
  }
  const stream = rt.stream;
  const plan = rt.plan;
  if (!stream || !plan) return;
  try {
    const format = rt.format ?? selectVoiceOverMimeType((type) => MediaRecorder.isTypeSupported(type));
    if (!format) throw new VoiceOverError("unsupported", "This browser does not provide a supported microphone recording format.");
    rt.format = format;
    const recorder = new MediaRecorder(stream, { mimeType: format.mimeType, audioBitsPerSecond: 128_000 });
    rt.chunks = [];
    rt.save = true;
    rt.recorder = recorder;
    rt.latency = (stream.getAudioTracks()[0]?.getSettings() as { latency?: number } | undefined)?.latency;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) rt.chunks.push(event.data);
    };
    recorder.onerror = () => {
      useVoiceOverStore.setState({ error: "The microphone recording stopped unexpectedly.", errorKind: "failed" });
    };
    recorder.onstop = () => void finishRecording(format);
    rt.startedAt = Date.now();
    recorder.start(250);
    useVoiceOverStore.setState({ phase: "recording", countdown: 0, elapsedMs: 0 });
    rt.elapsedTimer = window.setInterval(() => {
      useVoiceOverStore.setState({ elapsedMs: Date.now() - rt.startedAt });
    }, 100);
    const { autoStopAfterMs } = planTimings(plan);
    if (autoStopAfterMs !== null) rt.stopTimer = window.setTimeout(() => useVoiceOverStore.getState().stop(), autoStopAfterMs);
  } catch (reason) {
    pausePlayback();
    useTimelineStore.getState().seekTo(rt.originalPlayhead);
    releaseStream();
    resetToIdle();
    fail(reason);
  }
}

async function finishRecording(format: { mimeType: string; extension: string }): Promise<void> {
  const shouldSave = rt.save;
  const plan = rt.plan;
  const elapsedSeconds = (Date.now() - rt.startedAt) / 1000;
  const blob = new Blob(rt.chunks, { type: format.mimeType });
  const latency = rt.latency;
  rt.chunks = [];
  clearTimers();
  pausePlayback();
  releaseStream();
  if (!shouldSave || !plan) {
    resetToIdle();
    return;
  }
  useVoiceOverStore.setState({ phase: "saving", elapsedMs: 0 });
  try {
    await saveTake(blob, format.extension, takeTimelineStart(plan.recordStart, latency), elapsedSeconds);
  } catch (reason) {
    fail(reason);
  } finally {
    resetToIdle();
  }
}

/**
 * Imports the recording as media named "Voice Over Take N" and places it as an ordinary audio clip on the
 * chosen track (or a new "Voice Over" track when that range is taken). The track creation, rename and clip
 * add are one history group, so a single undo removes the whole take.
 */
export async function saveTake(blob: Blob, extension: string, startTime: number, durationHint: number): Promise<void> {
  if (blob.size === 0) throw new Error("The microphone recording was empty.");
  const store = useProjectStore.getState();
  const name = takeName(nextTakeNumber(store.project.mediaLibrary.items.map((item) => item.name)));
  const file = new File([blob], `${name}.${extension}`, { type: blob.type, lastModified: Date.now() });
  const imported = await store.importMedia(file, undefined, { recordedTake: "voiceover" });
  if (!imported.success) throw new Error(imported.error?.message ?? "Could not import the recording.");
  const media = useProjectStore.getState().project.mediaLibrary.items.find((item) => item.id === imported.actionId);
  if (!media) throw new Error("The recorded audio could not be found after import.");

  const prefs = useVoiceOverStore.getState().prefs;
  const duration = media.metadata.duration > 0 ? media.metadata.duration : durationHint;
  const tracks = useProjectStore.getState().project.timeline.tracks as unknown as PlacementTrack[];
  const placement = chooseTakeTrack(tracks, prefs.targetTrackId, startTime, startTime + duration);

  const history = useProjectStore.getState().actionExecutor.getHistory();
  history.beginGroup("Record voice-over");
  let clipTrackId: string | null = null;
  try {
    const api = useProjectStore.getState();
    if (placement.kind === "existing") {
      const result = await api.addClip(placement.trackId, media.id, startTime);
      if (!result.success) throw new Error(result.error?.message ?? "Could not add the voice-over to the timeline.");
      clipTrackId = placement.trackId;
    } else {
      const result = await api.addClipToNewTrack(media.id, startTime);
      if (!result.success) throw new Error(result.error?.message ?? "Could not add the voice-over to the timeline.");
      const created = useProjectStore.getState().project.timeline.tracks.find((track) => track.clips.some((clip) => clip.mediaId === media.id));
      if (created) {
        clipTrackId = created.id;
        await useProjectStore.getState().renameTrack(created.id, placement.trackName);
      }
    }
    // The imported media carries the file's extension; show the clean take name instead.
    await useProjectStore.getState().renameMedia(media.id, name);
  } finally {
    history.endGroup();
  }
  const track = clipTrackId ? useProjectStore.getState().project.timeline.tracks.find((t) => t.id === clipTrackId) : undefined;
  const clip = track?.clips.find((c) => c.mediaId === media.id);
  if (track && clip) {
    useUIStore.getState().select({ type: "clip", id: clip.id, trackId: track.id });
    useVoiceOverStore.setState({
      lastTake: {
        clipId: clip.id,
        trackId: track.id,
        name,
        note:
          placement.kind === "new" && placement.reason === "occupied"
            ? `That range was already recorded, so ${name} was stacked on a new track.`
            : placement.kind === "new" && placement.reason === "unavailable"
              ? `The chosen track was not available, so ${name} went on a new track.`
              : null,
      },
    });
  }
}

export const useVoiceOverStore = create<VoiceOverState>((set, get) => ({
  phase: "idle",
  countdown: 0,
  elapsedMs: 0,
  level: 0,
  error: null,
  errorKind: null,
  devices: [],
  prefs: readStoredPrefs(),
  lastTake: null,

  setPrefs: (patch) => {
    const next: VoiceOverPrefs = { ...get().prefs, ...patch };
    next.preRoll = clampPreRoll(next.preRoll);
    storePrefs(next);
    set({ prefs: next });
    // A level check holds the old device open: reopen it so the meter and the take use the new choice.
    if (get().phase === "monitoring" && !rt.starting && rt.streamKey !== streamKeyFor(next)) {
      get().stopMonitor();
      void get().startMonitor();
    }
  },

  refreshDevices: async () => {
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media?.enumerateDevices) return;
    try {
      const list = await media.enumerateDevices();
      set({
        devices: list
          .filter((device) => device.kind === "audioinput" && device.deviceId && device.deviceId !== "communications" && device.deviceId !== "default")
          .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Microphone ${index + 1}` })),
      });
    } catch {
      // Listing devices is best-effort.
    }
  },

  startMonitor: async () => {
    if (get().phase !== "idle" || rt.starting) return;
    rt.starting = true;
    set({ error: null, errorKind: null });
    try {
      await ensureDesktopMicrophone();
      rt.stream = await openStream(get().prefs);
      rt.streamKey = streamKeyFor(get().prefs);
      startMeter(rt.stream);
      set({ phase: "monitoring" });
      void get().refreshDevices();
    } catch (reason) {
      releaseStream();
      fail(reason);
    } finally {
      rt.starting = false;
    }
  },

  stopMonitor: () => {
    if (get().phase !== "monitoring") return;
    releaseStream();
    set({ phase: "idle" });
  },

  start: async () => {
    const phase = get().phase;
    if ((phase !== "idle" && phase !== "monitoring") || rt.starting) return;
    rt.starting = true;
    set({ error: null, errorKind: null, lastTake: null });
    try {
      if (rt.stream && rt.streamKey !== streamKeyFor(get().prefs)) releaseStream();
      if (!rt.stream || phase === "idle") {
        await ensureDesktopMicrophone();
        rt.stream = await openStream(get().prefs);
        rt.streamKey = streamKeyFor(get().prefs);
        startMeter(rt.stream);
        void get().refreshDevices();
      }
      if (!selectVoiceOverMimeType((type) => MediaRecorder.isTypeSupported(type))) {
        throw new VoiceOverError("unsupported", "This browser does not provide a supported microphone recording format.");
      }
      const timeline = useTimelineStore.getState();
      const { prefs } = get();
      const plan = resolveRecordPlan({
        playhead: timeline.playheadPosition,
        preRoll: prefs.preRoll,
        punch: prefs.punch,
        markIn: timeline.loopStart,
        markOut: timeline.loopEnd,
      });
      rt.plan = plan;
      rt.originalPlayhead = timeline.playheadPosition;
      timeline.pause();
      timeline.seekTo(plan.playFrom);
      const { startAfterMs } = planTimings(plan);
      const startedAt = performance.now();
      set({ phase: "countdown", countdown: countdownSeconds(startAfterMs), elapsedMs: 0 });
      // Playback runs through the pre-roll so the narrator hears the lead-in, arriving at the start as recording begins.
      rt.playTimer = window.setTimeout(() => useTimelineStore.getState().play(), Math.round(plan.playDelay * 1000));
      if (startAfterMs <= 0) {
        beginRecording();
      } else {
        rt.tick = window.setInterval(() => {
          const remaining = startAfterMs - (performance.now() - startedAt);
          if (remaining <= 0) beginRecording();
          else set({ countdown: countdownSeconds(remaining) });
        }, 50);
      }
    } catch (reason) {
      releaseStream();
      resetToIdle();
      fail(reason);
    } finally {
      rt.starting = false;
    }
  },

  stop: () => {
    const { phase } = get();
    if (phase === "countdown") {
      get().cancel();
      return;
    }
    if (phase !== "recording") return;
    if (rt.stopTimer !== null) {
      window.clearTimeout(rt.stopTimer);
      rt.stopTimer = null;
    }
    rt.save = true;
    if (rt.recorder && rt.recorder.state !== "inactive") rt.recorder.stop();
  },

  cancel: () => {
    const { phase } = get();
    if (phase === "recording") {
      rt.save = false;
      if (rt.recorder && rt.recorder.state !== "inactive") rt.recorder.stop();
      useTimelineStore.getState().seekTo(rt.originalPlayhead);
      return;
    }
    if (phase !== "countdown") return;
    clearTimers();
    pausePlayback();
    useTimelineStore.getState().seekTo(rt.originalPlayhead);
    releaseStream();
    resetToIdle();
  },
}));

/** True while timeline playback must be silent: recording with "mute playback while recording" on. */
export function selectVoiceOverPlaybackMuted(state: Pick<VoiceOverState, "phase" | "prefs">): boolean {
  return state.phase === "recording" && state.prefs.muteDuringRecord;
}
