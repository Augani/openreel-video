import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@openreel/ui";
import { AlertCircle, Mic, Square } from "@/icons/lucide-compat";
import { useUIStore } from "../../../stores/ui-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";

export function selectVoiceOverMimeType(
  supports: (mimeType: string) => boolean = MediaRecorder.isTypeSupported,
): { mimeType: string; extension: string } | null {
  const candidates = [
    { mimeType: "audio/webm;codecs=opus", extension: "webm" },
    { mimeType: "audio/mp4", extension: "m4a" },
    { mimeType: "audio/webm", extension: "webm" },
    { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  ];
  return candidates.find((candidate) => supports(candidate.mimeType)) ?? null;
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
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

export interface VoiceOverTake {
  clipId: string;
  trackId: string;
  startTime: number;
  duration: number;
}

/** Clips on the "Voice Over" tracks, newest position last. */
export function listVoiceOverTakes(
  tracks: ReadonlyArray<{ id: string; name: string; clips: ReadonlyArray<{ id: string; startTime: number; duration: number }> }>,
): VoiceOverTake[] {
  return tracks
    .filter((track) => track.name === "Voice Over")
    .flatMap((track) =>
      track.clips.map((clip) => ({
        clipId: clip.id,
        trackId: track.id,
        startTime: clip.startTime,
        duration: clip.duration,
      })),
    )
    .sort((a, b) => a.startTime - b.startTime);
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

export const VoiceOverPanel: React.FC = () => {
  const importMedia = useProjectStore((state) => state.importMedia);
  const addClipToNewTrack = useProjectStore((state) => state.addClipToNewTrack);
  const renameTrack = useProjectStore((state) => state.renameTrack);
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const saveRecordingRef = useRef(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const takes = useMemo(() => listVoiceOverTakes(tracks), [tracks]);
  const meterRef = useRef<{ context: AudioContext; frame: number } | null>(null);

  const stopMeter = useCallback(() => {
    if (meterRef.current) {
      cancelAnimationFrame(meterRef.current.frame);
      void meterRef.current.context.close().catch(() => undefined);
      meterRef.current = null;
    }
    setLevel(0);
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const state = { context, frame: 0 };
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        setLevel((previous) => Math.max(peakLevel(data), previous * 0.85));
        state.frame = requestAnimationFrame(tick);
      };
      state.frame = requestAnimationFrame(tick);
      meterRef.current = state;
    } catch {
      // The meter is informational; recording works without it.
    }
  }, []);

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    let active = true;
    const refresh = () => {
      media
        .enumerateDevices()
        .then((list) => {
          if (!active) return;
          const inputs = list.filter((device) => device.kind === "audioinput" && device.deviceId);
          setDevices(inputs);
          setDeviceId((current) => (inputs.some((device) => device.deviceId === current) ? current : ""));
        })
        .catch(() => undefined);
    };
    refresh();
    media.addEventListener?.("devicechange", refresh);
    return () => {
      active = false;
      media.removeEventListener?.("devicechange", refresh);
    };
  }, [isRecording]);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    stopMeter();
  }, [stopMeter]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(
      () => setElapsed(Date.now() - startedAtRef.current),
      200,
    );
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(
    () => () => {
      saveRecordingRef.current = false;
      if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
      releaseStream();
    },
    [releaseStream],
  );

  const saveVoiceOver = useCallback(
    async (blob: Blob, extension: string, startTime: number) => {
      if (blob.size === 0) throw new Error("The microphone recording was empty.");
      setIsSaving(true);
      const beforeMediaIds = new Set(
        useProjectStore.getState().project.mediaLibrary.items.map((item) => item.id),
      );
      const file = new File(
        [blob],
        `Voice-over ${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
        { type: blob.type, lastModified: Date.now() },
      );
      const importResult = await importMedia(file);
      if (!importResult.success) {
        throw new Error(importResult.error?.message ?? "Could not import the recording.");
      }
      const mediaItem = useProjectStore
        .getState()
        .project.mediaLibrary.items.find((item) => !beforeMediaIds.has(item.id));
      if (!mediaItem) throw new Error("The recorded audio could not be found after import.");
      const addResult = await addClipToNewTrack(mediaItem.id, startTime);
      if (!addResult.success) {
        throw new Error(addResult.error?.message ?? "Could not add the voice over to the timeline.");
      }
      const voiceTrack = useProjectStore
        .getState()
        .project.timeline.tracks.find((track) =>
          track.clips.some((clip) => clip.mediaId === mediaItem.id),
        );
      if (voiceTrack) await renameTrack(voiceTrack.id, "Voice Over");
    },
    [addClipToNewTrack, importMedia, renameTrack],
  );

  const startRecording = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice-over recording is not supported by this browser.");
      return;
    }
    const format = selectVoiceOverMimeType();
    if (!format) {
      setError("This browser does not provide a supported microphone recording format.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const recorder = new MediaRecorder(stream, {
        mimeType: format.mimeType,
        audioBitsPerSecond: 128_000,
      });
      const timelineStart = playheadPosition;
      chunksRef.current = [];
      saveRecordingRef.current = true;
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("The microphone recording stopped unexpectedly.");
      };
      recorder.onstop = () => {
        const shouldSave = saveRecordingRef.current;
        const blob = new Blob(chunksRef.current, { type: format.mimeType });
        chunksRef.current = [];
        releaseStream();
        setIsRecording(false);
        if (!shouldSave) return;
        void saveVoiceOver(blob, format.extension, timelineStart)
          .catch((reason) => {
            setError(reason instanceof Error ? reason.message : "Could not save the voice over.");
          })
          .finally(() => setIsSaving(false));
      };
      startedAtRef.current = Date.now();
      setElapsed(0);
      recorder.start(250);
      startMeter(stream);
      setIsRecording(true);
    } catch (reason) {
      releaseStream();
      setError(
        reason instanceof DOMException && reason.name === "NotAllowedError"
          ? "Allow microphone access to record a voice over."
          : reason instanceof Error
            ? reason.message
            : "Could not start microphone recording.",
      );
    }
  }, [deviceId, playheadPosition, releaseStream, saveVoiceOver, startMeter]);

  const stopRecording = () => {
    saveRecordingRef.current = true;
    recorderRef.current?.stop();
  };

  return (
    <div className="space-y-3">
      <Card className="min-w-0 rounded-[7px] shadow-none bg-bg-2 text-fg p-3 flex items-center justify-between border border-border">
        <div>
          <span className="font-bold block text-[11px] text-fg">
            Record at playhead
          </span>
          <span className="text-fg-2 font-normal block text-[9px]">
            Starts at {playheadPosition.toFixed(1)}s on a new Voice Over track.
          </span>
        </div>
        <span className={`font-mono text-sm ${isRecording ? "text-red-400" : "text-fg-2"}`}>
          {formatElapsed(elapsed)}
        </span>
      </Card>
      <div className="space-y-1.5 rounded-[7px] border border-border bg-bg-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="voiceover-input" className="text-[11px] font-semibold text-fg">
            Input
          </label>
          <select
            id="voiceover-input"
            data-testid="voiceover-device"
            value={deviceId}
            disabled={isRecording}
            onChange={(event) => setDeviceId(event.target.value)}
            className="h-7 min-w-0 max-w-[190px] flex-1 truncate rounded-md border border-border bg-bg-1 px-2 text-[11px] text-fg disabled:opacity-60"
          >
            <option value="">System default microphone</option>
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${index + 1}`}
              </option>
            ))}
          </select>
        </div>
        <VoiceOverMeter level={level} active={isRecording} />
        <p className="text-[9px] text-fg-muted">
          {isRecording ? "Live input level. Keep peaks out of the red." : "The level meter moves while you record."}
        </p>
      </div>
      {error && (
        <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-2 flex items-start gap-2 border border-red-500/30 bg-red-500/10">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" aria-hidden />
          <span className="font-normal text-[10px] text-red-400">{error}</span>
        </Card>
      )}
      {isRecording ? (
        <Button onClick={stopRecording} type="button" aria-label="Stop & Add to Timeline" className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] text-accent-fg w-full justify-center bg-red-500 hover:bg-red-600">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Square size={13} aria-hidden />}</span>
          <span className="truncate">{"Stop & Add to Timeline"}</span>
        </Button>
      ) : (
        <Button onClick={startRecording} type="button" aria-label={(isSaving ? "Adding Voice Over…" : "Record Voice Over").trim() || undefined} disabled={(isSaving)} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 w-full justify-center">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Mic size={14} aria-hidden />}</span>
          <span className="truncate">{isSaving ? "Adding Voice Over…" : "Record Voice Over"}</span>
        </Button>
      )}
      {takes.length > 0 && (
        <section aria-label="Takes" data-testid="voiceover-takes" className="space-y-1">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
            Takes · {takes.length}
          </h4>
          {takes.map((take, index) => (
            <button
              key={take.clipId}
              type="button"
              onClick={() => {
                useTimelineStore.getState().seekTo(take.startTime);
                useUIStore.getState().select({ type: "clip", id: take.clipId, trackId: take.trackId });
              }}
              className="flex w-full items-center justify-between rounded-md border border-border bg-bg-2 px-2.5 py-1.5 text-left text-[11px] text-fg hover:bg-bg-3 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>Take {index + 1}</span>
              <span className="font-mono text-fg-muted">
                {formatElapsed(take.startTime * 1000)} · {formatElapsed(take.duration * 1000)} long
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
