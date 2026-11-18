import {
  Dialog as ShadcnDialog,
  DialogContent as ShadcnDialogContent,
  DialogFooter as ShadcnDialogFooter,
  DialogHeader as ShadcnDialogHeader,
  DialogTitle as ShadcnDialogTitle,
  DialogDescription as ShadcnDialogDescription,
  DialogClose as ShadcnDialogClose,
  Select as ShadcnSelect,
  SelectTrigger as ShadcnSelectTrigger,
  SelectContent as ShadcnSelectContent,
  SelectValue as ShadcnSelectValue,
  SelectItem as ShadcnSelectItem,
  Label as ShadcnLabel,
  Switch as ShadcnSwitch,
  Button,
  Card,
  cn,
} from "@openreel/ui";

import {
  X as DialogCloseIcon,
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

import React, { useEffect, useRef } from "react";

import { useRecorderStore } from "../../stores/recorder-store";
import {
  ScreenRecorderService,
  type VideoResolution,
  type FrameRate,
  type WebcamResolution,
} from "../../services/screen-recorder";
import { RecordingCountdown } from "./RecordingCountdown";
import { RecordingControls } from "./RecordingControls";

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
    <ShadcnDialog open={true} onOpenChange={(open) => !open && handleCancel()}>
      <ShadcnDialogContent
        hideCloseButton
        className="!p-0 gap-0 overflow-hidden border-border bg-bg-1 text-fg shadow-xl"
        style={{ maxWidth: 672, width: "calc(100vw - 32px)" }}
      >
        <div className="flex max-h-[90vh] min-h-0 flex-col">
          {
            <ShadcnDialogHeader className="flex-row items-start gap-3 space-y-0 border-b border-border bg-bg-1 px-5 py-4">
              <span className="mt-0.5 flex shrink-0 items-center justify-center">
                {
                  <Circle
                    size={20}
                    className="text-error fill-error animate-pulse"
                    aria-hidden
                  />
                }
              </span>
              <div className="min-w-0 flex-1">
                <ShadcnDialogTitle className="truncate text-[15px] font-semibold leading-5 text-fg">
                  {"Screen Recording"}
                </ShadcnDialogTitle>
                <ShadcnDialogDescription className="sr-only">
                  {"Screen Recording"}
                </ShadcnDialogDescription>
              </div>
              <ShadcnDialogClose asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  aria-label="Close dialog"
                  className="size-7 shrink-0 rounded-[7px] p-0 text-fg-muted hover:bg-bg-2 hover:text-fg"
                >
                  <DialogCloseIcon size={15} aria-hidden />
                </Button>
              </ShadcnDialogClose>
            </ShadcnDialogHeader>
          }
          {
            <div
              className={cn(
                "min-h-0 flex-1 overflow-auto p-4",
                false,
                "space-y-6",
              )}
            >
              {!isSupported && (
                <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-4 flex items-start gap-3 border border-error/30 bg-error/10">
                  <AlertCircle
                    size={20}
                    className="text-error flex-shrink-0 mt-0.5"
                    aria-hidden
                  />
                  <div>
                    <span className="text-[13px] leading-5 font-bold block text-error">
                      Screen recording not supported
                    </span>
                    <span className="text-[12px] leading-5 text-fg-2 font-normal block mt-1">
                      Your browser doesn't support screen recording. Please use
                      Chrome, Edge, or Firefox.
                    </span>
                  </div>
                </Card>
              )}

              {error && (
                <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-4 flex items-start gap-3 border border-error/30 bg-error/10">
                  <AlertCircle
                    size={20}
                    className="text-error flex-shrink-0 mt-0.5"
                    aria-hidden
                  />
                  <div>
                    <span className="text-[13px] leading-5 font-bold block text-error">
                      Recording Error
                    </span>
                    <span className="text-[12px] leading-5 text-fg-2 font-normal block mt-1">
                      {error}
                    </span>
                  </div>
                </Card>
              )}

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Monitor size={16} aria-hidden />
                  <span className="text-[13px] leading-5 text-fg-2 font-bold">
                    Video Settings
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <ShadcnLabel className="block min-w-0 space-y-1.5">
                      <span className="block truncate text-[11px] font-medium text-text-secondary">
                        {"Resolution"}
                      </span>
                      <ShadcnSelect
                        value={
                          options.video.resolution ||
                          "__openreel_empty_option__"
                        }
                        disabled={!isSupported}
                        onValueChange={(nextValue) => {
                          const value =
                            nextValue === "__openreel_empty_option__"
                              ? ""
                              : nextValue;
                          return setVideoOption(
                            "resolution",
                            value as VideoResolution,
                          );
                        }}
                      >
                        <ShadcnSelectTrigger
                          aria-label={"Resolution"}
                          className={cn(
                            "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-50",
                            "h-7 text-[12px]",
                            undefined,
                            undefined,
                          )}
                        >
                          <ShadcnSelectValue placeholder={undefined} />
                        </ShadcnSelectTrigger>
                        <ShadcnSelectContent>
                          {RESOLUTION_OPTIONS.map((opt) => ({
                            value: opt.value,
                            label: opt.label,
                          })).map((option) => (
                            <ShadcnSelectItem
                              key={option.value}
                              value={
                                option.value || "__openreel_empty_option__"
                              }
                              disabled={
                                "disabled" in option && option.disabled === true
                              }
                            >
                              {option.label}
                            </ShadcnSelectItem>
                          ))}
                        </ShadcnSelectContent>
                      </ShadcnSelect>
                    </ShadcnLabel>
                    <span className="text-fg-2 font-normal block mt-1 text-[10px]">
                      {
                        RESOLUTION_OPTIONS.find(
                          (o) => o.value === options.video.resolution,
                        )?.desc
                      }
                    </span>
                  </div>

                  <div>
                    <ShadcnLabel className="block min-w-0 space-y-1.5">
                      <span className="block truncate text-[11px] font-medium text-text-secondary">
                        {"Frame Rate"}
                      </span>
                      <ShadcnSelect
                        value={
                          String(options.video.frameRate) ||
                          "__openreel_empty_option__"
                        }
                        disabled={!isSupported}
                        onValueChange={(nextValue) => {
                          const value =
                            nextValue === "__openreel_empty_option__"
                              ? ""
                              : nextValue;
                          return setVideoOption(
                            "frameRate",
                            parseInt(value, 10) as FrameRate,
                          );
                        }}
                      >
                        <ShadcnSelectTrigger
                          aria-label={"Frame Rate"}
                          className={cn(
                            "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-50",
                            "h-7 text-[12px]",
                            undefined,
                            undefined,
                          )}
                        >
                          <ShadcnSelectValue placeholder={undefined} />
                        </ShadcnSelectTrigger>
                        <ShadcnSelectContent>
                          {FRAMERATE_OPTIONS.map((opt) => ({
                            value: String(opt.value),
                            label: opt.label,
                          })).map((option) => (
                            <ShadcnSelectItem
                              key={option.value}
                              value={
                                option.value || "__openreel_empty_option__"
                              }
                              disabled={
                                "disabled" in option && option.disabled === true
                              }
                            >
                              {option.label}
                            </ShadcnSelectItem>
                          ))}
                        </ShadcnSelectContent>
                      </ShadcnSelect>
                    </ShadcnLabel>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Settings size={16} aria-hidden />
                  <span className="text-[13px] leading-5 text-fg-2 font-bold">
                    Audio Settings
                  </span>
                </div>

                <div className="flex gap-4">
                  <Button
                    variant="ghost"
                    type="button"
                    aria-label="System Audio"
                    disabled={!isSupported || !features.systemAudio}
                    onClick={() =>
                      setAudioOption("systemAudio", !options.audio.systemAudio)
                    }
                    role="checkbox"
                    aria-checked={options.audio.systemAudio}
                    data-selected={
                      options.audio.systemAudio ? "true" : undefined
                    }
                    className={cn(
                      "group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                      options.audio.systemAudio
                        ? "border-status-success/25 bg-status-success/10 text-fg hover:bg-status-success/15"
                        : "border-transparent bg-bg-2 text-fg hover:bg-bg-3",
                      options.audio.systemAudio &&
                        "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
                      "p-3",
                      "flex-1",
                    )}
                  >
                    {options.audio.systemAudio ? (
                      <Volume2 size={18} aria-hidden />
                    ) : (
                      <VolumeX size={18} aria-hidden />
                    )}
                    <span className="text-fg-2 font-normal ml-2 text-sm">
                      System Audio
                    </span>
                  </Button>

                  <Button
                    variant="ghost"
                    type="button"
                    aria-label="Microphone"
                    disabled={!isSupported}
                    onClick={() =>
                      setAudioOption("microphone", !options.audio.microphone)
                    }
                    role="checkbox"
                    aria-checked={options.audio.microphone}
                    data-selected={
                      options.audio.microphone ? "true" : undefined
                    }
                    className={cn(
                      "group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                      options.audio.microphone
                        ? "border-status-success/25 bg-status-success/10 text-fg hover:bg-status-success/15"
                        : "border-transparent bg-bg-2 text-fg hover:bg-bg-3",
                      options.audio.microphone &&
                        "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
                      "p-3",
                      "flex-1",
                    )}
                  >
                    {options.audio.microphone ? (
                      <Mic size={18} aria-hidden />
                    ) : (
                      <MicOff size={18} aria-hidden />
                    )}
                    <span className="text-fg-2 font-normal ml-2 text-sm">
                      Microphone
                    </span>
                  </Button>
                </div>

                {!features.systemAudio && (
                  <span className="text-fg-2 font-normal block text-[10px]">
                    System audio capture is only available in Chrome and Edge
                    browsers.
                  </span>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Camera size={16} aria-hidden />
                    <span className="text-[13px] leading-5 text-fg-2 font-bold">
                      Webcam Recording
                    </span>
                  </div>
                  <ShadcnSwitch
                    aria-label={"Webcam recording"}
                    checked={options.webcam.enabled}
                    disabled={!isSupported || !features.webcam}
                    onCheckedChange={(enabled) =>
                      setWebcamOption("enabled", enabled)
                    }
                    className="workspace-switch flex-none"
                  />
                </div>

                {options.webcam.enabled && (
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <ShadcnLabel className="block min-w-0 space-y-1.5">
                        <span className="block truncate text-[11px] font-medium text-text-secondary">
                          {"Webcam Resolution"}
                        </span>
                        <ShadcnSelect
                          value={
                            options.webcam.resolution ||
                            "__openreel_empty_option__"
                          }
                          disabled={false}
                          onValueChange={(nextValue) => {
                            const value =
                              nextValue === "__openreel_empty_option__"
                                ? ""
                                : nextValue;
                            return setWebcamOption(
                              "resolution",
                              value as WebcamResolution,
                            );
                          }}
                        >
                          <ShadcnSelectTrigger
                            aria-label={"Webcam Resolution"}
                            className={cn(
                              "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-50",
                              "h-7 text-[12px]",
                              undefined,
                              undefined,
                            )}
                          >
                            <ShadcnSelectValue placeholder={undefined} />
                          </ShadcnSelectTrigger>
                          <ShadcnSelectContent>
                            {WEBCAM_RESOLUTION_OPTIONS.map((opt) => ({
                              value: opt.value,
                              label: opt.label,
                            })).map((option) => (
                              <ShadcnSelectItem
                                key={option.value}
                                value={
                                  option.value || "__openreel_empty_option__"
                                }
                                disabled={
                                  "disabled" in option &&
                                  option.disabled === true
                                }
                              >
                                {option.label}
                              </ShadcnSelectItem>
                            ))}
                          </ShadcnSelectContent>
                        </ShadcnSelect>
                      </ShadcnLabel>
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

                <span className="text-fg-2 font-normal block text-[10px]">
                  Webcam will be recorded as a separate file, giving you full
                  control in the editor.
                </span>
              </div>
            </div>
          }
          {
            <ShadcnDialogFooter
              className={cn(
                "flex shrink-0 items-center justify-end gap-2 bg-bg-1 px-5 py-4",
                "border-t border-border",
                undefined,
              )}
            >
              <div className="flex items-center justify-between gap-4">
                <span className="text-fg-2 font-normal text-xs">
                  Recording will start after a 3-second countdown
                </span>

                <div className="flex gap-3">
                  <Button
                    onClick={handleCancel}
                    type="button"
                    aria-label="Cancel"
                    className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-transparent text-fg-2 hover:bg-bg-2 hover:text-fg"
                  >
                    <span className="truncate">{"Cancel"}</span>
                  </Button>
                  <Button
                    onClick={handleStartRecording}
                    type="button"
                    aria-label={
                      (status === "requesting"
                        ? "Requesting Access..."
                        : "Start Recording"
                      ).trim() || undefined
                    }
                    disabled={!isSupported || status === "requesting"}
                    className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-red-600 font-bold text-white hover:bg-red-700"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {status === "requesting" ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      ) : (
                        <Circle
                          size={14}
                          className="fill-current"
                          aria-hidden
                        />
                      )}
                    </span>
                    <span className="truncate">
                      {status === "requesting"
                        ? "Requesting Access..."
                        : "Start Recording"}
                    </span>
                  </Button>
                </div>
              </div>
            </ShadcnDialogFooter>
          }
        </div>
      </ShadcnDialogContent>
    </ShadcnDialog>
  );
};
