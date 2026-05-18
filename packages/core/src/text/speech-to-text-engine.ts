import type { Subtitle, SubtitleStyle } from "../types/timeline";

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
  readonly resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export interface TranscriptionSegment {
  readonly text: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly confidence: number;
}

export interface TranscriptionResult {
  readonly success: boolean;
  readonly segments: TranscriptionSegment[];
  readonly error?: string;
  readonly language?: string;
}

export interface SpeechToTextOptions {
  readonly language: string;
  readonly continuous: boolean;
  readonly interimResults: boolean;
  readonly maxAlternatives: number;
}

export type TranscriptionStatus =
  | "idle"
  | "preparing"
  | "transcribing"
  | "completed"
  | "error";

export interface TranscriptionProgress {
  readonly status: TranscriptionStatus;
  readonly progress: number;
  readonly currentTime: number;
  readonly totalDuration: number;
  readonly segmentsFound: number;
}

type ProgressCallback = (progress: TranscriptionProgress) => void;
type SegmentCallback = (segment: TranscriptionSegment) => void;

const SUPPORTED_LANGUAGES = [
  { code: "en-US", name: "English (US)" },
  { code: "en-GB", name: "English (UK)" },
  { code: "es-ES", name: "Spanish (Spain)" },
  { code: "es-MX", name: "Spanish (Mexico)" },
  { code: "fr-FR", name: "French" },
  { code: "de-DE", name: "German" },
  { code: "it-IT", name: "Italian" },
  { code: "pt-BR", name: "Portuguese (Brazil)" },
  { code: "pt-PT", name: "Portuguese (Portugal)" },
  { code: "ja-JP", name: "Japanese" },
  { code: "ko-KR", name: "Korean" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "ru-RU", name: "Russian" },
  { code: "ar-SA", name: "Arabic" },
  { code: "hi-IN", name: "Hindi" },
  { code: "nl-NL", name: "Dutch" },
  { code: "pl-PL", name: "Polish" },
  { code: "sv-SE", name: "Swedish" },
  { code: "da-DK", name: "Danish" },
  { code: "fi-FI", name: "Finnish" },
  { code: "no-NO", name: "Norwegian" },
  { code: "tr-TR", name: "Turkish" },
  { code: "th-TH", name: "Thai" },
  { code: "vi-VN", name: "Vietnamese" },
  { code: "id-ID", name: "Indonesian" },
  { code: "ms-MY", name: "Malay" },
  { code: "el-GR", name: "Greek" },
  { code: "cs-CZ", name: "Czech" },
  { code: "ro-RO", name: "Romanian" },
  { code: "hu-HU", name: "Hungarian" },
  { code: "uk-UA", name: "Ukrainian" },
  { code: "he-IL", name: "Hebrew" },
];

const DEFAULT_OPTIONS: SpeechToTextOptions = {
  language: "en-US",
  continuous: true,
  interimResults: false,
  maxAlternatives: 1,
};

const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: "Arial",
  fontSize: 45,
  color: "#ffffff",
  backgroundColor: "transparent",
  position: "bottom",
};

export class SpeechToTextEngine {
  private recognition: SpeechRecognitionInstance | null = null;
  private audioContext: AudioContext | null = null;
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private segments: TranscriptionSegment[] = [];
  private isTranscribing = false;
  private currentOptions: SpeechToTextOptions = DEFAULT_OPTIONS;
  private progressCallback: ProgressCallback | null = null;
  private segmentCallback: SegmentCallback | null = null;
  private startTime = 0;
  private segmentStartTime = 0;

  static isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
    );
  }

  static getSupportedLanguages(): Array<{ code: string; name: string }> {
    return [...SUPPORTED_LANGUAGES];
  }

  constructor() {
    this.initRecognition();
  }

  private initRecognition(): void {
    if (!SpeechToTextEngine.isSupported()) {
      return;
    }

    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      return;
    }

    this.recognition = new SpeechRecognitionAPI();
    this.setupRecognitionHandlers();
  }

  private setupRecognitionHandlers(): void {
    if (!this.recognition) return;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[event.results.length - 1];
      if (!result.isFinal) return;

      const transcript = result[0].transcript.trim();
      if (!transcript) return;

      const currentTime = this.getCurrentTime();
      const segment: TranscriptionSegment = {
        text: transcript,
        startTime: this.segmentStartTime,
        endTime: currentTime,
        confidence: result[0].confidence,
      };

      this.segments.push(segment);
      this.segmentStartTime = currentTime;

      if (this.segmentCallback) {
        this.segmentCallback(segment);
      }

      this.reportProgress("transcribing");
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech" || event.error === "aborted") {
        return;
      }
      console.error("Speech recognition error:", event.error);
    };

    this.recognition.onend = () => {
      if (this.isTranscribing && this.recognition) {
        try {
          this.recognition.start();
        } catch {
          this.isTranscribing = false;
          this.reportProgress("completed");
        }
      }
    };
  }

  private getCurrentTime(): number {
    return (performance.now() - this.startTime) / 1000;
  }

  private reportProgress(status: TranscriptionStatus): void {
    if (!this.progressCallback) return;

    this.progressCallback({
      status,
      progress: status === "completed" ? 100 : 50,
      currentTime: this.getCurrentTime(),
      totalDuration: 0,
      segmentsFound: this.segments.length,
    });
  }

  setOptions(options: Partial<SpeechToTextOptions>): void {
    this.currentOptions = { ...this.currentOptions, ...options };
    this.applyOptions();
  }

  private applyOptions(): void {
    if (!this.recognition) return;

    this.recognition.lang = this.currentOptions.language;
    this.recognition.continuous = this.currentOptions.continuous;
    this.recognition.interimResults = this.currentOptions.interimResults;
    this.recognition.maxAlternatives = this.currentOptions.maxAlternatives;
  }

  onProgress(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  onSegment(callback: SegmentCallback): void {
    this.segmentCallback = callback;
  }

  async startLiveTranscription(): Promise<void> {
    if (!this.recognition) {
      throw new Error("Speech recognition not supported in this browser");
    }

    if (this.isTranscribing) {
      return;
    }

    this.segments = [];
    this.isTranscribing = true;
    this.startTime = performance.now();
    this.segmentStartTime = 0;

    this.applyOptions();
    this.reportProgress("transcribing");

    try {
      this.recognition.start();
    } catch (error) {
      this.isTranscribing = false;
      throw error;
    }
  }

  stopTranscription(): TranscriptionResult {
    if (!this.isTranscribing) {
      return {
        success: true,
        segments: this.segments,
        language: this.currentOptions.language,
      };
    }

    this.isTranscribing = false;

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore stop errors
      }
    }

    this.reportProgress("completed");

    return {
      success: true,
      segments: [...this.segments],
      language: this.currentOptions.language,
    };
  }

  async transcribeAudioElement(
    audioElement: HTMLAudioElement | HTMLVideoElement,
    startOffset: number = 0,
    duration?: number,
  ): Promise<TranscriptionResult> {
    if (!this.recognition) {
      return {
        success: false,
        segments: [],
        error: "Speech recognition not supported. Try Chrome or Edge browser.",
      };
    }

    return new Promise((resolve) => {
      this.segments = [];
      this.isTranscribing = true;
      this.startTime = performance.now();
      this.segmentStartTime = startOffset;

      const handleEnded = () => {
        cleanup();
        resolve(this.stopTranscription());
      };

      const handleTimeUpdate = () => {
        if (duration && audioElement.currentTime >= startOffset + duration) {
          handleEnded();
        }
      };

      const cleanup = () => {
        audioElement.removeEventListener("ended", handleEnded);
        audioElement.removeEventListener("timeupdate", handleTimeUpdate);
      };

      audioElement.addEventListener("ended", handleEnded);
      audioElement.addEventListener("timeupdate", handleTimeUpdate);

      this.applyOptions();
      this.reportProgress("transcribing");

      audioElement.currentTime = startOffset;
      audioElement.play().catch(() => {
        cleanup();
        resolve({
          success: false,
          segments: [],
          error: "Failed to play audio for transcription",
        });
      });

      if (!this.recognition) {
        cleanup();
        resolve({
          success: false,
          segments: [],
          error: "Speech recognition not available",
        });
        return;
      }

      try {
        this.recognition.start();
      } catch {
        cleanup();
        resolve({
          success: false,
          segments: [],
          error: "Failed to start speech recognition",
        });
      }
    });
  }

  segmentsToSubtitles(
    segments: TranscriptionSegment[],
    style?: Partial<SubtitleStyle>,
  ): Subtitle[] {
    const subtitleStyle: SubtitleStyle = {
      ...DEFAULT_SUBTITLE_STYLE,
      ...style,
    };

    return segments.map((segment, index) => ({
      id: `auto-caption-${Date.now()}-${index}`,
      text: segment.text,
      startTime: segment.startTime,
      endTime: segment.endTime,
      style: subtitleStyle,
    }));
  }

  getSegments(): TranscriptionSegment[] {
    return [...this.segments];
  }

  clearSegments(): void {
    this.segments = [];
  }

  isActive(): boolean {
    return this.isTranscribing;
  }

  dispose(): void {
    this.stopTranscription();

    if (this.mediaSource) {
      this.mediaSource.disconnect();
      this.mediaSource = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.recognition = null;
    this.progressCallback = null;
    this.segmentCallback = null;
  }
}

export const createSpeechToTextEngine = (): SpeechToTextEngine => {
  return new SpeechToTextEngine();
};
