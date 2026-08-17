import React, { useEffect, useRef } from "react";
import {
  Monitor,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Camera,
  Circle,
  Settings,
  AlertCircle,
} from "@/icons/lucide-compat";
import { useRecorderStore } from "../../stores/recorder-store";
import {
  ScreenRecorderService,
  type VideoResolution,
  type FrameRate,
  type WebcamResolution,
} from "../../services/screen-recorder";
import { RecordingCountdown } from "./RecordingCountdown";
import { RecordingControls } from "./RecordingControls";
import { ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useTranslation } from "react-i18next";

interface ScreenRecorderProps {
  isOpen: boolean;
  onClose: () => void;
  onRecordingComplete: (screenBlob: Blob, webcamBlob?: Blob) => void;
}

const RESOLUTION_OPTIONS: {
  value: VideoResolution;
  label: string;
  desc: string;
}[] = [
  { value: "720p", label: "720p HD", desc: "1280×720 - Smaller files" },
  { value: "1080p", label: "1080p Full HD", desc: "1920×1080 - Recommended" },
  { value: "1440p", label: "1440p QHD", desc: "2560×1440 - High quality" },
  { value: "4k", label: "4K Ultra HD", desc: "3840×2160 - Maximum quality" },
];

const FRAMERATE_OPTIONS: { value: FrameRate; label: string }[] = [
  { value: 30, label: "30 fps" },
  { value: 60, label: "60 fps" },
];

const WEBCAM_RESOLUTION_OPTIONS: { value: WebcamResolution; label: string }[] =
  [
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
  ];

export const ScreenRecorder: React.FC<ScreenRecorderProps> = ({
  isOpen,
  onClose,
  onRecordingComplete,
}) => {
  const { t } = useTranslation();
  const {
    status,
    options,
    webcamStream,
    error,
    setVideoOption,
    setAudioOption,
    setWebcamOption,
    requestPermissions,
    startRecording,
    stopRecording,
    cancelRecording,
    pauseRecording,
    resumeRecording,
    reset,
  } = useRecorderStore();

  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const isSupported = ScreenRecorderService.isSupported();
  const features = ScreenRecorderService.getSupportedFeatures();

  useEffect(() => {
    if (webcamVideoRef.current && webcamStream) {
      webcamVideoRef.current.srcObject = webcamStream;
    }
  }, [webcamStream]);

  useEffect(() => {
    if (!isOpen) {
      if (status === "idle" || status === "error") {
        reset();
      }
    }
  }, [isOpen, status, reset]);

  const handleStartRecording = async () => {
    const hasPermissions = await requestPermissions();
    if (hasPermissions) {
      await startRecording();
    }
  };

  const handleStopRecording = async () => {
    const result = await stopRecording();
    if (result) {
      onRecordingComplete(result.screenBlob, result.webcamBlob);
      onClose();
    }
  };

  const handleCancel = () => {
    cancelRecording();
    onClose();
  };

  if (!isOpen) return null;

  if (status === "countdown") {
    return <RecordingCountdown />;
  }

  if (status === "recording" || status === "paused") {
    return (
      <RecordingControls
        onStop={handleStopRecording}
        onPause={pauseRecording}
        onResume={resumeRecording}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <Dialog isOpen onOpenChange={(open) => !open && handleCancel()} width={672} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t("Screen Recording")}
            onOpenChange={(open) => !open && handleCancel()}
            startContent={<Circle size={20} className="text-error fill-error animate-pulse" aria-hidden />}
          />
        }
        content={
          <LayoutContent className="space-y-6">
          {!isSupported && (
            <Card variant="muted" padding={4} className="flex items-start gap-3 border border-error/30 bg-error/10">
              <AlertCircle
                size={20}
                className="text-error flex-shrink-0 mt-0.5"
                aria-hidden
              />
              <div>
                <Text type="body" weight="bold" display="block" className="text-error">
                  {t("Screen recording not supported")}</Text>
                <Text type="supporting" color="secondary" display="block" className="mt-1">
                  {t("Your browser doesn't support screen recording. Please use Chrome, Edge, or Firefox.")}</Text>
              </div>
            </Card>
          )}

          {error && (
            <Card variant="muted" padding={4} className="flex items-start gap-3 border border-error/30 bg-error/10">
              <AlertCircle
                size={20}
                className="text-error flex-shrink-0 mt-0.5"
                aria-hidden
              />
              <div>
                <Text type="body" weight="bold" display="block" className="text-error">
                  {t("Recording Error")}</Text>
                <Text type="supporting" color="secondary" display="block" className="mt-1">
                  {error}
                </Text>
              </div>
            </Card>
          )}

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Monitor size={16} aria-hidden />
              <Text type="body" weight="bold">
                {t("Video Settings")}</Text>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Selector
                  label={t("Resolution")}
                  value={options.video.resolution}
                  onChange={(value) => setVideoOption("resolution", value as VideoResolution)}
                  isDisabled={!isSupported}
                  options={RESOLUTION_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: t(opt.label),
                  }))}
                  size="sm"
                  width="100%"
                />
                <Text type="supporting" color="secondary" display="block" className="mt-1 text-[10px]">
                  {
                    RESOLUTION_OPTIONS.find(
                      (o) => o.value === options.video.resolution,
                    )?.desc
                  }
                </Text>
              </div>

              <div>
                <Selector
                  label={t("Frame Rate")}
                  value={String(options.video.frameRate)}
                  onChange={(value) => setVideoOption("frameRate", parseInt(value, 10) as FrameRate)}
                  isDisabled={!isSupported}
                  options={FRAMERATE_OPTIONS.map((opt) => ({
                    value: String(opt.value),
                    label: t(opt.label),
                  }))}
                  size="sm"
                  width="100%"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Settings size={16} aria-hidden />
              <Text type="body" weight="bold">
                {t("Audio Settings")}</Text>
            </div>

            <div className="flex gap-4">
              <SelectableCard
                label={t("System Audio")}
                isSelected={options.audio.systemAudio}
                onChange={() => setAudioOption("systemAudio", !options.audio.systemAudio)}
                isDisabled={!isSupported || !features.systemAudio}
                padding={3}
                variant={options.audio.systemAudio ? "green" : "muted"}
                className="flex-1"
              >
                {options.audio.systemAudio ? (
                  <Volume2 size={18} aria-hidden />
                ) : (
                  <VolumeX size={18} aria-hidden />
                )}
                <Text type="body" className="ml-2 text-sm">
                  {t("System Audio")}</Text>
              </SelectableCard>

              <SelectableCard
                label={t("Microphone")}
                isSelected={options.audio.microphone}
                onChange={() => setAudioOption("microphone", !options.audio.microphone)}
                isDisabled={!isSupported}
                padding={3}
                variant={options.audio.microphone ? "green" : "muted"}
                className="flex-1"
              >
                {options.audio.microphone ? (
                  <Mic size={18} aria-hidden />
                ) : (
                  <MicOff size={18} aria-hidden />
                )}
                <Text type="body" className="ml-2 text-sm">
                  {t("Microphone")}</Text>
              </SelectableCard>
            </div>

            {!features.systemAudio && (
              <Text type="supporting" color="secondary" display="block" className="text-[10px]">
                {t("System audio capture is only available in Chrome and Edge browsers.")}</Text>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera size={16} aria-hidden />
                <Text type="body" weight="bold">
                  {t("Webcam Recording")}</Text>
              </div>
              <ToolcraftSwitchControl
                ariaLabel={t("Webcam recording")}
                checked={options.webcam.enabled}
                onCheckedChange={(enabled) => setWebcamOption("enabled", enabled)}
                disabled={!isSupported || !features.webcam}
                showLabel={false}
              />
            </div>

            {options.webcam.enabled && (
              <div className="flex gap-4">
                <div className="flex-1">
                  <Selector
                    label={t("Webcam Resolution")}
                    value={options.webcam.resolution}
                    onChange={(value) => setWebcamOption("resolution", value as WebcamResolution)}
                    options={WEBCAM_RESOLUTION_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.label),
                    }))}
                    size="sm"
                    width="100%"
                  />
                </div>

                {webcamStream && (
                  <div className="w-32 h-24 bg-background-tertiary rounded-lg overflow-hidden border border-border">
                    <video
                      ref={webcamVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
              </div>
            )}

            <Text type="supporting" color="secondary" display="block" className="text-[10px]">
              {t("Webcam will be recorded as a separate file, giving you full control in the editor.")}</Text>
          </div>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex items-center justify-between gap-4">
              <Text type="supporting" color="secondary" className="text-xs">
                {t("Recording will start after a 3-second countdown")}</Text>

              <div className="flex gap-3">
                <Button
                  label={t("Cancel")}
                  variant="ghost"
                  onClick={handleCancel}
                />
                <Button
                  label={status === "requesting" ? t("Requesting Access...") : t("Start Recording")}
                  variant="primary"
                  icon={
                    status === "requesting" ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    ) : (
                      <Circle size={14} className="fill-current" aria-hidden />
                    )
                  }
                  onClick={handleStartRecording}
                  isDisabled={!isSupported || status === "requesting"}
                  className="bg-red-600 font-bold text-white hover:bg-red-700"
                />
              </div>
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};
