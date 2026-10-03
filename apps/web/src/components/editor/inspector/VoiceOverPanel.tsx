import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ToolcraftButton as Button,
  ToolcraftCard as Card,
  ToolcraftText as Text,
} from "@openreel/ui";
import { AlertCircle, Mic, Square } from "@/icons/lucide-compat";
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

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

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
  }, [playheadPosition, releaseStream, saveVoiceOver]);

  const stopRecording = () => {
    saveRecordingRef.current = true;
    recorderRef.current?.stop();
  };

  return (
    <div className="space-y-3">
      <Card variant="muted" padding={3} className="flex items-center justify-between border border-border">
        <div>
          <Text type="supporting" weight="bold" className="block text-[11px] text-fg">
            Record at playhead
          </Text>
          <Text type="supporting" color="secondary" className="block text-[9px]">
            Starts at {playheadPosition.toFixed(1)}s on a new Voice Over track.
          </Text>
        </div>
        <span className={`font-mono text-sm ${isRecording ? "text-red-400" : "text-fg-2"}`}>
          {formatElapsed(elapsed)}
        </span>
      </Card>
      {error && (
        <Card variant="muted" padding={2} className="flex items-start gap-2 border border-red-500/30 bg-red-500/10">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" aria-hidden />
          <Text type="supporting" className="text-[10px] text-red-400">{error}</Text>
        </Card>
      )}
      {isRecording ? (
        <Button
          label="Stop & Add to Timeline"
          icon={<Square size={13} aria-hidden />}
          variant="primary"
          size="md"
          onClick={stopRecording}
          className="w-full justify-center bg-red-500 hover:bg-red-600"
        />
      ) : (
        <Button
          label={isSaving ? "Adding Voice Over…" : "Record Voice Over"}
          icon={<Mic size={14} aria-hidden />}
          variant="primary"
          size="md"
          onClick={startRecording}
          isDisabled={isSaving}
          className="w-full justify-center"
        />
      )}
      <Text type="supporting" color="secondary" className="block text-center text-[9px]">
        Recorded audio stays in this project and exports with the rest of the mix.
      </Text>
    </div>
  );
};

export default VoiceOverPanel;
