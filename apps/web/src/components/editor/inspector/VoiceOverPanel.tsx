import React, { useEffect, useMemo } from "react";
import { Button, Card } from "@openreel/ui";
import { AlertCircle, Mic, Square } from "@/icons/lucide-compat";
import { useUIStore } from "../../../stores/ui-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useVoiceOverStore } from "../../../services/voiceover/voiceover-recorder";
import {
  MAX_PRE_ROLL_SECONDS,
  audioTrackChoices,
  formatClock,
  listVoiceOverTakes,
  peakLevel,
  punchRange,
  resolveRecordPlan,
  selectVoiceOverMimeType as selectMimeType,
  type PlacementTrack,
} from "../../../services/voiceover/voiceover-logic";

export { listVoiceOverTakes, peakLevel };

export function selectVoiceOverMimeType(
  supports: (mimeType: string) => boolean = MediaRecorder.isTypeSupported,
): { mimeType: string; extension: string } | null {
  return selectMimeType(supports);
}

const INPUT_METER_BARS = 24;

/** Segmented live input meter; `level` is 0..1. */
export const VoiceOverMeter: React.FC<{ level: number; active: boolean }> = ({ level, active }) => {
  const lit = Math.round(level * INPUT_METER_BARS);
  return (
    <div
      className="flex h-3 items-stretch gap-[2px]"
      role="meter"
      aria-label="Microphone input level"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(level.toFixed(2))}
      data-testid="voiceover-meter"
    >
      {Array.from({ length: INPUT_METER_BARS }, (_, i) => {
        const on = active && i < lit;
        const hot = i >= INPUT_METER_BARS - 3;
        const warm = i >= INPUT_METER_BARS - 7;
        return (
          <span
            key={i}
            className={`flex-1 rounded-[1px] ${
              on ? (hot ? "bg-status-error" : warm ? "bg-status-warning" : "bg-accent") : "bg-bg-3"
            }`}
          />
        );
      })}
    </div>
  );
};

const FIELD = "h-7 min-w-0 flex-1 truncate rounded-md border border-border bg-bg-1 px-2 text-[11px] text-fg disabled:opacity-60";
const ROW = "flex items-center justify-between gap-2";
const LABEL = "text-[11px] font-semibold text-fg shrink-0";

const Toggle: React.FC<{
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  hint: string;
}> = ({ id, checked, disabled, onChange, title, hint }) => (
  <label htmlFor={id} className={`flex cursor-pointer items-start gap-2 ${disabled ? "opacity-60" : ""}`}>
    <input
      id={id}
      data-testid={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent,#3b82f6)]"
    />
    <span className="min-w-0">
      <span className="block text-[11px] font-semibold text-fg">{title}</span>
      <span className="block text-[9px] text-fg-muted">{hint}</span>
    </span>
  </label>
);

function timecode(seconds: number): string {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${(whole - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

export const VoiceOverPanel: React.FC = () => {
  const phase = useVoiceOverStore((state) => state.phase);
  const countdown = useVoiceOverStore((state) => state.countdown);
  const elapsedMs = useVoiceOverStore((state) => state.elapsedMs);
  const level = useVoiceOverStore((state) => state.level);
  const error = useVoiceOverStore((state) => state.error);
  const errorKind = useVoiceOverStore((state) => state.errorKind);
  const devices = useVoiceOverStore((state) => state.devices);
  const prefs = useVoiceOverStore((state) => state.prefs);
  const lastTake = useVoiceOverStore((state) => state.lastTake);
  const setPrefs = useVoiceOverStore((state) => state.setPrefs);
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const mediaItems = useProjectStore((state) => state.project.mediaLibrary.items);
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const markIn = useTimelineStore((state) => state.loopStart);
  const markOut = useTimelineStore((state) => state.loopEnd);

  const busy = phase === "countdown" || phase === "recording" || phase === "saving";
  const range = punchRange(markIn, markOut);
  const audioTracks = useMemo(() => audioTrackChoices(tracks as unknown as PlacementTrack[]), [tracks]);
  const takes = useMemo(
    () => listVoiceOverTakes(tracks, new Map(mediaItems.map((item) => [item.id, item.name]))),
    [tracks, mediaItems],
  );
  const plan = resolveRecordPlan({ playhead, preRoll: prefs.preRoll, punch: prefs.punch, markIn, markOut });
  const targetName = audioTracks.find((track) => track.id === prefs.targetTrackId)?.name ?? "a new Voice Over track";
  const savedDeviceMissing = Boolean(prefs.deviceId) && devices.length > 0 && !devices.some((device) => device.deviceId === prefs.deviceId);

  useEffect(() => {
    const media = navigator.mediaDevices;
    void useVoiceOverStore.getState().refreshDevices();
    const refresh = () => void useVoiceOverStore.getState().refreshDevices();
    media?.addEventListener?.("devicechange", refresh);
    return () => {
      media?.removeEventListener?.("devicechange", refresh);
      // A level check holds the microphone open; a take in progress must keep running when the panel closes.
      useVoiceOverStore.getState().stopMonitor();
    };
  }, []);

  useEffect(() => {
    if (phase !== "countdown" && phase !== "recording") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        useVoiceOverStore.getState().cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  const headline =
    phase === "countdown"
      ? "Get ready"
      : phase === "recording"
        ? plan.punched ? "Recording punch" : "Recording"
        : phase === "saving"
          ? "Adding to timeline"
          : "Record at playhead";
  const subline =
    phase === "countdown"
      ? `Recording starts at ${timecode(plan.recordStart)}. Playback is running.`
      : phase === "recording"
        ? plan.recordEnd !== null
          ? `Stops automatically at ${timecode(plan.recordEnd)}.`
          : "Press Stop when you are done."
        : plan.punched
          ? `Punches ${timecode(plan.recordStart)} to ${timecode(plan.recordEnd ?? plan.recordStart)} on ${targetName}.`
          : `Starts at ${timecode(plan.recordStart)} on ${targetName}.`;

  return (
    <div className="space-y-3" data-testid="voiceover-panel" data-phase={phase}>
      <Card className="min-w-0 rounded-[7px] shadow-none bg-bg-2 text-fg p-3 flex items-center justify-between gap-3 border border-border">
        <div className="min-w-0">
          <span className="font-bold block text-[11px] text-fg">{headline}</span>
          <span className="text-fg-2 font-normal block text-[9px]" data-testid="voiceover-subline">{subline}</span>
        </div>
        {phase === "countdown" ? (
          <span
            className="font-mono text-2xl font-bold leading-none text-status-warning tabular-nums"
            role="timer"
            aria-live="assertive"
            data-testid="voiceover-countdown"
          >
            {countdown}
          </span>
        ) : (
          <span
            className={`flex items-center gap-1.5 font-mono text-sm tabular-nums ${phase === "recording" ? "text-red-400" : "text-fg-2"}`}
            data-testid="voiceover-elapsed"
          >
            {phase === "recording" && <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />}
            {formatClock(elapsedMs)}
          </span>
        )}
      </Card>

      {phase === "countdown" ? (
        <Button
          onClick={() => useVoiceOverStore.getState().cancel()}
          type="button"
          aria-label="Cancel recording"
          className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring h-8 px-3 text-[12px] w-full justify-center bg-bg-3 text-fg hover:bg-bg-3/80"
        >
          <span className="truncate">Cancel (Esc)</span>
        </Button>
      ) : phase === "recording" ? (
        <Button
          onClick={() => useVoiceOverStore.getState().stop()}
          type="button"
          aria-label="Stop & Add to Timeline"
          className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] text-accent-fg w-full justify-center bg-red-500 hover:bg-red-600"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center"><Square size={13} aria-hidden /></span>
          <span className="truncate">Stop & Add to Timeline</span>
        </Button>
      ) : (
        <Button
          onClick={() => void useVoiceOverStore.getState().start()}
          type="button"
          aria-label={phase === "saving" ? "Adding Voice Over…" : "Record Voice Over"}
          disabled={phase === "saving"}
          className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 w-full justify-center"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center"><Mic size={14} aria-hidden /></span>
          <span className="truncate">{phase === "saving" ? "Adding Voice Over…" : "Record Voice Over"}</span>
        </Button>
      )}

      {error && (
        <Card
          className="min-w-0 rounded-[7px] shadow-none text-fg p-2 flex items-start gap-2 border border-red-500/30 bg-red-500/10"
          role="alert"
          data-testid="voiceover-error"
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" aria-hidden />
          <div className="min-w-0 space-y-1">
            <span className="block font-normal text-[10px] text-red-400">{error}</span>
            {(errorKind === "blocked" || errorKind === "denied") && typeof window !== "undefined" && window.openreel?.microphone && (
              <button
                type="button"
                data-testid="voiceover-open-settings"
                onClick={() => void window.openreel?.microphone?.openSettings()}
                className="rounded-md border border-red-500/40 px-2 py-0.5 text-[10px] font-semibold text-red-300 hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open microphone settings
              </button>
            )}
          </div>
        </Card>
      )}
      {lastTake?.note && (
        <p className="text-[10px] text-fg-2" data-testid="voiceover-note">{lastTake.note}</p>
      )}

      <div className="space-y-2 rounded-[7px] border border-border bg-bg-2 p-3">
        <div className={ROW}>
          <label htmlFor="voiceover-input" className={LABEL}>Input</label>
          <select
            id="voiceover-input"
            data-testid="voiceover-device"
            value={devices.some((device) => device.deviceId === prefs.deviceId) ? prefs.deviceId : ""}
            disabled={busy}
            onChange={(event) => setPrefs({ deviceId: event.target.value })}
            className={FIELD}
          >
            <option value="">System default microphone</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
            ))}
          </select>
        </div>
        {savedDeviceMissing && (
          <p className="text-[9px] text-status-warning" data-testid="voiceover-device-missing">
            Your saved microphone is not connected. The system default will be used.
          </p>
        )}
        <VoiceOverMeter level={level} active={phase !== "idle" && phase !== "saving"} />
        <div className={ROW}>
          <p className="text-[9px] text-fg-muted">
            {phase === "idle" ? "Check your level before recording." : "Live input level. Keep peaks out of the red."}
          </p>
          {(
            <button
              type="button"
              disabled={busy}
              data-testid="voiceover-monitor"
              onClick={() => (phase === "monitoring" ? useVoiceOverStore.getState().stopMonitor() : void useVoiceOverStore.getState().startMonitor())}
              className="shrink-0 rounded-md border border-border bg-bg-1 px-2 py-1 text-[10px] font-semibold text-fg hover:bg-bg-3 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            >
              {phase === "monitoring" ? "Stop check" : "Check level"}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2 rounded-[7px] border border-border bg-bg-2 p-3">
        <div className={ROW}>
          <label htmlFor="voiceover-track" className={LABEL}>Record to</label>
          <select
            id="voiceover-track"
            data-testid="voiceover-track"
            value={audioTracks.some((track) => track.id === prefs.targetTrackId) ? prefs.targetTrackId : ""}
            disabled={busy}
            onChange={(event) => setPrefs({ targetTrackId: event.target.value })}
            className={FIELD}
          >
            <option value="">New Voice Over track</option>
            {audioTracks.map((track) => (
              <option key={track.id} value={track.id}>{track.name}</option>
            ))}
          </select>
        </div>
        <div className={ROW}>
          <label htmlFor="voiceover-preroll" className={LABEL}>Pre-roll</label>
          <select
            id="voiceover-preroll"
            data-testid="voiceover-preroll"
            value={prefs.preRoll}
            disabled={busy}
            onChange={(event) => setPrefs({ preRoll: Number(event.target.value) })}
            className={FIELD}
          >
            {Array.from({ length: MAX_PRE_ROLL_SECONDS + 1 }, (_, seconds) => (
              <option key={seconds} value={seconds}>{seconds === 0 ? "None" : `${seconds} s countdown`}</option>
            ))}
          </select>
        </div>
        <Toggle
          id="voiceover-punch"
          checked={prefs.punch && range !== null}
          disabled={busy || range === null}
          onChange={(punch) => setPrefs({ punch })}
          title="Punch in / out"
          hint={
            range
              ? `Record only between In ${timecode(range.start)} and Out ${timecode(range.end)}.`
              : "Set In and Out marks (I and O) on the timeline to enable."
          }
        />
        <Toggle
          id="voiceover-mute"
          checked={prefs.muteDuringRecord}
          disabled={busy}
          onChange={(muteDuringRecord) => setPrefs({ muteDuringRecord })}
          title="Mute playback while recording"
          hint="Silences the timeline once recording starts so speakers do not feed back into the microphone."
        />
      </div>

      {takes.length > 0 && (
        <section aria-label="Takes" data-testid="voiceover-takes" className="space-y-1">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">Takes · {takes.length}</h4>
          {takes.map((take) => (
            <button
              key={take.clipId}
              type="button"
              data-testid="voiceover-take"
              onClick={() => {
                useTimelineStore.getState().seekTo(take.startTime);
                useUIStore.getState().select({ type: "clip", id: take.clipId, trackId: take.trackId });
              }}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-bg-2 px-2.5 py-1.5 text-left text-[11px] text-fg hover:bg-bg-3 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 truncate">{take.name}</span>
              <span className="shrink-0 font-mono text-fg-muted">
                {timecode(take.startTime)} · {formatClock(take.duration * 1000)}
              </span>
            </button>
          ))}
        </section>
      )}
      <span className="text-fg-2 font-normal block text-center text-[9px]">
        Recorded audio stays in this project and exports with the rest of the mix.
      </span>
    </div>
  );
};
