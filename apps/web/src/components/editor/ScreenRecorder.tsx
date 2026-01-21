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
} from "lucide-react";
import { useRecorderStore } from "../../stores/recorder-store";
import {
  ScreenRecorderService,
  type VideoResolution,
  type FrameRate,
  type WebcamResolution,
} from "../../services/screen-recorder";
import { RecordingCountdown } from "./RecordingCountdown";
import { RecordingControls } from "./RecordingControls";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@openreel/ui";

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
    <Dialog open onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="max-w-2xl p-0 gap-0 bg-background-secondary border-border overflow-hidden">
        <DialogHeader className="p-4 border-b border-border bg-background-tertiary space-y-0">
          <div className="flex items-center gap-3">
            <Circle size={20} className="text-error fill-error animate-pulse" />
            <DialogTitle className="text-lg font-bold text-text-primary">
              Screen Recording
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-6">
          {!isSupported && (
            <div className="flex items-start gap-3 p-4 bg-error/10 border border-error/30 rounded-lg">
              <AlertCircle
                size={20}
                className="text-error flex-shrink-0 mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-error">
                  Screen recording not supported
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Your browser doesn't support screen recording. Please use
                  Chrome, Edge, or Firefox.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 p-4 bg-error/10 border border-error/30 rounded-lg">
              <AlertCircle
                size={20}
                className="text-error flex-shrink-0 mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-error">
                  Recording Error
                </p>
                <p className="text-xs text-text-muted mt-1">{error}</p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Monitor size={16} />
              <span>Video Settings</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-muted mb-2">
                  Resolution
                </label>
                <Select
                  value={options.video.resolution}
                  onValueChange={(v) => setVideoOption("resolution", v as VideoResolution)}
                  disabled={!isSupported}
                >
                  <SelectTrigger className="w-full bg-background-tertiary border-border text-text-primary">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background-secondary border-border">
                    {RESOLUTION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-text-muted mt-1">
                  {
                    RESOLUTION_OPTIONS.find(
                      (o) => o.value === options.video.resolution,
                    )?.desc
                  }
                </p>
              </div>

              <div>
                <label className="block text-xs text-text-muted mb-2">
                  Frame Rate
                </label>
                <Select
                  value={String(options.video.frameRate)}
                  onValueChange={(v) => setVideoOption("frameRate", parseInt(v) as FrameRate)}
                  disabled={!isSupported}
                >
                  <SelectTrigger className="w-full bg-background-tertiary border-border text-text-primary">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background-secondary border-border">
                    {FRAMERATE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Settings size={16} />
              <span>Audio Settings</span>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() =>
                  setAudioOption("systemAudio", !options.audio.systemAudio)
                }
                disabled={!isSupported || !features.systemAudio}
                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition-all ${
                  options.audio.systemAudio
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-background-tertiary border-border text-text-secondary hover:border-text-muted"
                } ${(!isSupported || !features.systemAudio) && "opacity-50 cursor-not-allowed"}`}
              >
                {options.audio.systemAudio ? (
                  <Volume2 size={18} />
                ) : (
                  <VolumeX size={18} />
                )}
                <span className="text-sm">System Audio</span>
              </button>

              <button
                onClick={() =>
                  setAudioOption("microphone", !options.audio.microphone)
                }
                disabled={!isSupported}
                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition-all ${
                  options.audio.microphone
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-background-tertiary border-border text-text-secondary hover:border-text-muted"
                } ${!isSupported && "opacity-50 cursor-not-allowed"}`}
              >
                {options.audio.microphone ? (
                  <Mic size={18} />
                ) : (
                  <MicOff size={18} />
                )}
                <span className="text-sm">Microphone</span>
              </button>
            </div>

            {!features.systemAudio && (
              <p className="text-[10px] text-text-muted">
                System audio capture is only available in Chrome and Edge
                browsers.
              </p>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Camera size={16} />
                <span>Webcam Recording</span>
              </div>
              <button
                onClick={() =>
                  setWebcamOption("enabled", !options.webcam.enabled)
                }
                disabled={!isSupported || !features.webcam}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  options.webcam.enabled
                    ? "bg-primary"
                    : "bg-background-tertiary"
                } ${(!isSupported || !features.webcam) && "opacity-50 cursor-not-allowed"}`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    options.webcam.enabled ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {options.webcam.enabled && (
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs text-text-muted mb-2">
                    Webcam Resolution
                  </label>
                  <Select
                    value={options.webcam.resolution}
                    onValueChange={(v) => setWebcamOption("resolution", v as WebcamResolution)}
                  >
                    <SelectTrigger className="w-full bg-background-tertiary border-border text-text-primary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background-secondary border-border">
                      {WEBCAM_RESOLUTION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

            <p className="text-[10px] text-text-muted">
              Webcam will be recorded as a separate file, giving you full
              control in the editor.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between p-4 border-t border-border bg-background-tertiary">
          <p className="text-xs text-text-muted">
            Recording will start after a 3-second countdown
          </p>

          <div className="flex gap-3">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleStartRecording}
              disabled={!isSupported || status === "requesting"}
              className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === "requesting" ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Requesting Access...</span>
                </>
              ) : (
                <>
                  <Circle size={14} className="fill-current" />
                  <span>Start Recording</span>
                </>
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
