export type VideoResolution = "720p" | "1080p" | "1440p" | "4k";
export type FrameRate = 30 | 60;
export type WebcamResolution = "480p" | "720p" | "1080p";
export type RecordingStatus =
  | "idle"
  | "requesting"
  | "countdown"
  | "recording"
  | "paused"
  | "processing"
  | "error";

export interface RecordingOptions {
  video: {
    resolution: VideoResolution;
    frameRate: FrameRate;
    displaySurface?: "monitor" | "window" | "browser";
  };
  audio: {
    systemAudio: boolean;
    microphone: boolean;
  };
  webcam: {
    enabled: boolean;
    resolution: WebcamResolution;
  };
}

export interface RecordingResult {
  screenBlob: Blob;
  webcamBlob?: Blob;
}

const RESOLUTION_MAP: Record<
  VideoResolution | WebcamResolution,
  { width: number; height: number }
> = {
  "480p": { width: 854, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  "4k": { width: 3840, height: 2160 },
};

const BITRATE_MAP: Record<VideoResolution | WebcamResolution, number> = {
  "480p": 2_500_000,
  "720p": 5_000_000,
  "1080p": 12_000_000,
  "1440p": 20_000_000,
  "4k": 40_000_000,
};

type RecordingEventType =
  | "start"
  | "stop"
  | "pause"
  | "resume"
  | "error"
  | "duration";
type RecordingEventHandler = (data?: unknown) => void;

export class ScreenRecorderService {
  private screenRecorder: MediaRecorder | null = null;
  private webcamRecorder: MediaRecorder | null = null;
  private screenChunks: Blob[] = [];
  private webcamChunks: Blob[] = [];
  private screenStream: MediaStream | null = null;
  private webcamStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private startTime: number = 0;
  private pausedDuration: number = 0;
  private pauseStartTime: number = 0;
  private durationInterval: number | null = null;
  private eventHandlers: Map<RecordingEventType, Set<RecordingEventHandler>> =
    new Map();
  private isStopping: boolean = false;
  private lastResult: RecordingResult | null = null;

  on(event: RecordingEventType, handler: RecordingEventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    return () => this.eventHandlers.get(event)?.delete(handler);
  }

  private emit(event: RecordingEventType, data?: unknown): void {
    this.eventHandlers.get(event)?.forEach((handler) => handler(data));
  }

  async requestPermissions(
    options: RecordingOptions,
  ): Promise<{ screenStream: MediaStream; webcamStream?: MediaStream }> {
    const resolution = RESOLUTION_MAP[options.video.resolution];

    const displayMediaOptions = {
      video: {
        width: { ideal: resolution.width },
        height: { ideal: resolution.height },
        frameRate: { ideal: options.video.frameRate },
      },
      audio: options.audio.systemAudio,
    };

    this.screenStream =
      await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

    if (options.audio.microphone) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        console.warn("Microphone access denied, continuing without microphone");
      }
    }

    if (options.webcam.enabled) {
      const webcamRes = RESOLUTION_MAP[options.webcam.resolution];
      try {
        this.webcamStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: webcamRes.width },
            height: { ideal: webcamRes.height },
            facingMode: "user",
          },
          audio: false,
        });
      } catch {
        console.warn("Webcam access denied, continuing without webcam");
      }
    }

    return {
      screenStream: this.screenStream,
      webcamStream: this.webcamStream || undefined,
    };
  }

  async startRecording(options: RecordingOptions): Promise<void> {
    if (!this.screenStream) {
      throw new Error(
        "Screen stream not initialized. Call requestPermissions first.",
      );
    }

    this.screenChunks = [];
    this.webcamChunks = [];
    this.isStopping = false;
    this.lastResult = null;

    const combinedStream = new MediaStream();
    this.screenStream
      .getVideoTracks()
      .forEach((track) => combinedStream.addTrack(track));

    if (this.screenStream.getAudioTracks().length > 0) {
      this.screenStream
        .getAudioTracks()
        .forEach((track) => combinedStream.addTrack(track));
    }

    if (this.micStream) {
      this.micStream
        .getAudioTracks()
        .forEach((track) => combinedStream.addTrack(track));
    }

    const screenMimeType = this.getBestMimeType();
    const screenBitrate = BITRATE_MAP[options.video.resolution];

    this.screenRecorder = new MediaRecorder(combinedStream, {
      mimeType: screenMimeType,
      videoBitsPerSecond: screenBitrate,
    });

    this.screenRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.screenChunks.push(e.data);
      }
    };

    this.screenRecorder.onerror = (e) => {
      this.emit("error", e);
    };

    this.screenStream.getVideoTracks()[0].onended = () => {
      this.stopRecording();
    };

    if (this.webcamStream && options.webcam.enabled) {
      const webcamMimeType = this.getBestMimeType();
      const webcamBitrate = BITRATE_MAP[options.webcam.resolution];

      this.webcamRecorder = new MediaRecorder(this.webcamStream, {
        mimeType: webcamMimeType,
        videoBitsPerSecond: webcamBitrate,
      });

      this.webcamRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.webcamChunks.push(e.data);
        }
      };

      this.webcamRecorder.start(1000);
    }

    this.screenRecorder.start(1000);
    this.startTime = Date.now();
    this.pausedDuration = 0;

    this.durationInterval = window.setInterval(() => {
      const elapsed = Date.now() - this.startTime - this.pausedDuration;
      this.emit("duration", elapsed);
    }, 100);

    this.emit("start");
  }

  pauseRecording(): void {
    if (this.screenRecorder?.state === "recording") {
      this.screenRecorder.pause();
      this.pauseStartTime = Date.now();
    }
    if (this.webcamRecorder?.state === "recording") {
      this.webcamRecorder.pause();
    }
    this.emit("pause");
  }

  resumeRecording(): void {
    if (this.screenRecorder?.state === "paused") {
      this.screenRecorder.resume();
      this.pausedDuration += Date.now() - this.pauseStartTime;
    }
    if (this.webcamRecorder?.state === "paused") {
      this.webcamRecorder.resume();
    }
    this.emit("resume");
  }

  async stopRecording(): Promise<RecordingResult> {
    if (this.lastResult) {
      return this.lastResult;
    }

    if (this.isStopping) {
      await new Promise<void>((resolve) => {
        const checkResult = setInterval(() => {
          if (this.lastResult) {
            clearInterval(checkResult);
            resolve();
          }
        }, 50);
        setTimeout(() => {
          clearInterval(checkResult);
          resolve();
        }, 5000);
      });
      return this.lastResult || { screenBlob: new Blob() };
    }

    this.isStopping = true;

    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }

    const results: RecordingResult = {
      screenBlob: new Blob(),
    };

    const stopPromises: Promise<void>[] = [];

    if (this.screenRecorder && this.screenRecorder.state !== "inactive") {
      stopPromises.push(
        this.stopRecorder(this.screenRecorder, this.screenChunks).then(
          (blob) => {
            results.screenBlob = blob;
          },
        ),
      );
    } else if (this.screenChunks.length > 0) {
      results.screenBlob = new Blob(this.screenChunks, { type: "video/webm" });
    }

    if (this.webcamRecorder && this.webcamRecorder.state !== "inactive") {
      stopPromises.push(
        this.stopRecorder(this.webcamRecorder, this.webcamChunks).then(
          (blob) => {
            results.webcamBlob = blob;
          },
        ),
      );
    } else if (this.webcamChunks.length > 0) {
      results.webcamBlob = new Blob(this.webcamChunks, { type: "video/webm" });
    }

    await Promise.all(stopPromises);
    this.lastResult = results;
    this.cleanup();
    this.emit("stop", results);
    return results;
  }

  cancelRecording(): void {
    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }

    if (this.screenRecorder && this.screenRecorder.state !== "inactive") {
      this.screenRecorder.stop();
    }
    if (this.webcamRecorder && this.webcamRecorder.state !== "inactive") {
      this.webcamRecorder.stop();
    }

    this.cleanup();
  }

  getRecordingState(): "inactive" | "recording" | "paused" {
    return this.screenRecorder?.state || "inactive";
  }

  isRecording(): boolean {
    return this.screenRecorder?.state === "recording";
  }

  isPaused(): boolean {
    return this.screenRecorder?.state === "paused";
  }

  private stopRecorder(recorder: MediaRecorder, chunks: Blob[]): Promise<Blob> {
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "video/webm";
        resolve(new Blob(chunks, { type: mimeType }));
      };
      recorder.stop();
    });
  }

  private getBestMimeType(): string {
    const types = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=h264,opus",
      "video/webm",
      "video/mp4",
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return "video/webm";
  }

  private cleanup(): void {
    this.screenStream?.getTracks().forEach((track) => track.stop());
    this.webcamStream?.getTracks().forEach((track) => track.stop());
    this.micStream?.getTracks().forEach((track) => track.stop());

    this.screenStream = null;
    this.webcamStream = null;
    this.micStream = null;
    this.screenRecorder = null;
    this.webcamRecorder = null;
    this.screenChunks = [];
    this.webcamChunks = [];
  }

  static isSupported(): boolean {
    const hasDisplayMedia =
      typeof navigator.mediaDevices?.getDisplayMedia === "function";
    const hasMediaRecorder = typeof MediaRecorder !== "undefined";
    const supportsWebm =
      hasMediaRecorder && MediaRecorder.isTypeSupported("video/webm");
    return hasDisplayMedia && supportsWebm;
  }

  static getSupportedFeatures(): {
    screenCapture: boolean;
    systemAudio: boolean;
    webcam: boolean;
    vp9: boolean;
    h264: boolean;
  } {
    const isChromium = /Chrome|Chromium|Edge/.test(navigator.userAgent);
    const isSafari =
      /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);

    return {
      screenCapture: !!navigator.mediaDevices?.getDisplayMedia,
      systemAudio: isChromium,
      webcam: !!navigator.mediaDevices?.getUserMedia,
      vp9: MediaRecorder.isTypeSupported("video/webm;codecs=vp9"),
      h264: MediaRecorder.isTypeSupported("video/webm;codecs=h264") || isSafari,
    };
  }
}

export const screenRecorderService = new ScreenRecorderService();

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export const DEFAULT_RECORDING_OPTIONS: RecordingOptions = {
  video: {
    resolution: "1080p",
    frameRate: 30,
  },
  audio: {
    systemAudio: true,
    microphone: false,
  },
  webcam: {
    enabled: false,
    resolution: "720p",
  },
};
