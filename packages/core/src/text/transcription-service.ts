import type { Subtitle, SubtitleStyle, Clip } from "../types/timeline";
import type { MediaItem } from "../types/project";

export interface CloudflareWhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface CloudflareWhisperResponse {
  text: string;
  word_count?: number;
  words?: CloudflareWhisperWord[];
  vtt?: string;
}

export interface WhisperTranscriptionProgress {
  phase:
    | "extracting"
    | "uploading"
    | "transcribing"
    | "processing"
    | "complete"
    | "error";
  progress: number;
  message: string;
}

export interface TranscriptionConfig {
  apiEndpoint: string;
  apiKey?: string;
  language?: string;
  targetLanguage?: string;
  maxSegmentDuration?: number;
  maxWordsPerSegment?: number;
}

const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: "Arial",
  fontSize: 24,
  color: "#ffffff",
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  position: "bottom",
};

export class TranscriptionService {
  private config: TranscriptionConfig;
  private audioContext: AudioContext | null = null;

  constructor(config: TranscriptionConfig) {
    this.config = {
      maxSegmentDuration: 5,
      maxWordsPerSegment: 10,
      ...config,
    };
  }

  async transcribeClip(
    clip: Clip,
    mediaItem: MediaItem,
    onProgress?: (progress: WhisperTranscriptionProgress) => void,
  ): Promise<Subtitle[]> {
    try {
      onProgress?.({
        phase: "extracting",
        progress: 0,
        message: "Extracting audio from video...",
      });

      const audioBlob = await this.extractAudioFromClip(clip, mediaItem);

      onProgress?.({
        phase: "uploading",
        progress: 25,
        message: "Uploading audio for transcription...",
      });

      const whisperResponse = await this.sendToWhisper(audioBlob, onProgress);

      onProgress?.({
        phase: "processing",
        progress: 90,
        message: "Processing transcription...",
      });

      const subtitles = this.convertToSubtitles(whisperResponse, clip);

      onProgress?.({
        phase: "complete",
        progress: 100,
        message: `Generated ${subtitles.length} subtitles`,
      });

      return subtitles;
    } catch (error) {
      onProgress?.({
        phase: "error",
        progress: 0,
        message:
          error instanceof Error ? error.message : "Transcription failed",
      });
      throw error;
    }
  }

  private async extractAudioFromClip(
    clip: Clip,
    mediaItem: MediaItem,
  ): Promise<Blob> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    let arrayBuffer: ArrayBuffer;

    if (mediaItem.blob) {
      arrayBuffer = await mediaItem.blob.arrayBuffer();
    } else if (mediaItem.fileHandle) {
      const file = await mediaItem.fileHandle.getFile();
      arrayBuffer = await file.arrayBuffer();
    } else {
      throw new Error("No media source available for audio extraction");
    }

    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

    const inPoint = clip.inPoint || 0;
    const outPoint = clip.outPoint || audioBuffer.duration;
    const duration = Math.min(outPoint - inPoint, clip.duration);

    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(inPoint * sampleRate);
    const endSample = Math.floor((inPoint + duration) * sampleRate);
    const numSamples = endSample - startSample;

    const offlineContext = new OfflineAudioContext(1, numSamples, sampleRate);
    const source = offlineContext.createBufferSource();

    const trimmedBuffer = offlineContext.createBuffer(
      1,
      numSamples,
      sampleRate,
    );
    const channelData = trimmedBuffer.getChannelData(0);
    const sourceData = audioBuffer.getChannelData(0);

    for (let i = 0; i < numSamples; i++) {
      channelData[i] = sourceData[startSample + i] || 0;
    }

    source.buffer = trimmedBuffer;
    source.connect(offlineContext.destination);
    source.start(0);

    const renderedBuffer = await offlineContext.startRendering();
    return this.audioBufferToWav(renderedBuffer);
  }

  private audioBufferToWav(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1;
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = buffer.length * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, totalSize - 8, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    const channelData = buffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  private async sendToWhisper(
    audioBlob: Blob,
    onProgress?: (progress: WhisperTranscriptionProgress) => void,
  ): Promise<CloudflareWhisperResponse> {
    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.wav");

    if (this.config.language) {
      formData.append("language", this.config.language);
    }
    if (this.config.targetLanguage) {
      formData.append("target_language", this.config.targetLanguage);
    }

    onProgress?.({
      phase: "transcribing",
      progress: 30,
      message: "Uploading audio...",
    });

    const response = await fetch(this.config.apiEndpoint, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(
          "Rate limit reached. Please wait a minute before transcribing more audio. This free service is limited to 10 requests per minute.",
        );
      }
      const errorText = await response.text();
      throw new Error(
        `Transcription failed: ${response.status} - ${errorText}`,
      );
    }

    const submitResult = await response.json();

    if (!submitResult.jobId) {
      return submitResult as CloudflareWhisperResponse;
    }

    const baseUrl = this.config.apiEndpoint.replace(/\/transcribe$/, "").replace(/\/$/, "");
    const pollUrl = `${baseUrl}/jobs/${submitResult.jobId}`;

    return this.pollForResult(pollUrl, onProgress);
  }

  private async pollForResult(
    pollUrl: string,
    onProgress?: (progress: WhisperTranscriptionProgress) => void,
  ): Promise<CloudflareWhisperResponse> {
    const maxAttempts = 120;
    const pollInterval = 3000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));

      const response = await fetch(pollUrl);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Transcription job not found");
        }
        continue;
      }

      const job = await response.json();

      if (job.status === "processing") {
        const progress = 30 + Math.round((job.progress || 0) * 0.6);
        onProgress?.({
          phase: "transcribing",
          progress,
          message: this.config.targetLanguage
            ? `Transcribing and translating to ${this.config.targetLanguage}...`
            : "Transcribing audio...",
        });
        continue;
      }

      if (job.status === "completed" && job.result) {
        return job.result as CloudflareWhisperResponse;
      }

      if (job.status === "failed") {
        throw new Error(job.error || "Transcription failed on server");
      }
    }

    throw new Error("Transcription timed out after 6 minutes");
  }

  private convertToSubtitles(
    response: CloudflareWhisperResponse,
    clip: Clip,
  ): Subtitle[] {
    if (!response.words || response.words.length === 0) {
      if (!response.text) return [];

      return [
        {
          id: this.generateId(),
          text: response.text.trim(),
          startTime: clip.startTime,
          endTime: clip.startTime + clip.duration,
          style: DEFAULT_SUBTITLE_STYLE,
          words: undefined,
          animationStyle: "none",
        },
      ];
    }

    return this.groupWordsIntoSubtitles(response.words, clip.startTime);
  }

  private groupWordsIntoSubtitles(
    words: CloudflareWhisperWord[],
    clipStartTime: number,
  ): Subtitle[] {
    const subtitles: Subtitle[] = [];
    const maxWords = this.config.maxWordsPerSegment || 10;
    const maxDuration = this.config.maxSegmentDuration || 5;

    let currentWords: CloudflareWhisperWord[] = [];
    let groupStart = 0;

    for (const word of words) {
      if (currentWords.length === 0) {
        groupStart = word.start;
      }

      const wouldExceedWords = currentWords.length >= maxWords;
      const wouldExceedDuration = word.end - groupStart > maxDuration;
      const isPunctuation = /[.!?]$/.test(word.word);

      if (
        (wouldExceedWords || wouldExceedDuration) &&
        currentWords.length > 0
      ) {
        subtitles.push(
          this.createSubtitleFromWords(currentWords, clipStartTime),
        );
        currentWords = [word];
        groupStart = word.start;
      } else {
        currentWords.push(word);

        if (isPunctuation && currentWords.length >= 3) {
          subtitles.push(
            this.createSubtitleFromWords(currentWords, clipStartTime),
          );
          currentWords = [];
        }
      }
    }

    if (currentWords.length > 0) {
      subtitles.push(this.createSubtitleFromWords(currentWords, clipStartTime));
    }

    return subtitles;
  }

  private createSubtitleFromWords(
    words: CloudflareWhisperWord[],
    clipStartTime: number,
  ): Subtitle {
    const text = words
      .map((w) => w.word)
      .join(" ")
      .trim();
    const startTime = clipStartTime + words[0].start;
    const endTime = clipStartTime + words[words.length - 1].end;

    return {
      id: this.generateId(),
      text,
      startTime,
      endTime,
      style: DEFAULT_SUBTITLE_STYLE,
      words: words.map((w) => ({
        text: w.word,
        startTime: clipStartTime + w.start,
        endTime: clipStartTime + w.end,
      })),
      animationStyle: "none",
    };
  }

  private generateId(): string {
    return `sub-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

let transcriptionServiceInstance: TranscriptionService | null = null;

export function getTranscriptionService(): TranscriptionService | null {
  return transcriptionServiceInstance;
}

export function initializeTranscriptionService(
  config: TranscriptionConfig,
): TranscriptionService {
  if (transcriptionServiceInstance) {
    transcriptionServiceInstance.dispose();
  }
  transcriptionServiceInstance = new TranscriptionService(config);
  return transcriptionServiceInstance;
}

export function disposeTranscriptionService(): void {
  if (transcriptionServiceInstance) {
    transcriptionServiceInstance.dispose();
    transcriptionServiceInstance = null;
  }
}
