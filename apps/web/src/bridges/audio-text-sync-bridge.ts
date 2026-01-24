import {
  getBeatSyncEngine,
  type ClipTiming,
  type ClipInfo,
  type SyncProgress,
  type BeatSyncConfig,
  type BeatAnalysisResult,
  DEFAULT_BEAT_SYNC_CONFIG,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

export interface BeatSyncState {
  isProcessing: boolean;
  progress: SyncProgress | null;
  beatAnalysis: BeatAnalysisResult | null;
  selectedAudioClipId: string | null;
  selectedTrackIds: string[];
  clipsToSync: ClipInfo[];
  previewTimings: ClipTiming[];
  config: BeatSyncConfig;
  error: string | null;
}

type StateListener = (state: BeatSyncState) => void;

const initialState: BeatSyncState = {
  isProcessing: false,
  progress: null,
  beatAnalysis: null,
  selectedAudioClipId: null,
  selectedTrackIds: [],
  clipsToSync: [],
  previewTimings: [],
  config: DEFAULT_BEAT_SYNC_CONFIG,
  error: null,
};

export class BeatSyncBridge {
  private state: BeatSyncState = { ...initialState };
  private listeners: Set<StateListener> = new Set();
  private audioContext: AudioContext | null = null;

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private setState(updates: Partial<BeatSyncState>): void {
    this.state = { ...this.state, ...updates };
    this.listeners.forEach((listener) => listener(this.state));
  }

  getState(): BeatSyncState {
    return this.state;
  }

  setSelectedAudioClip(clipId: string | null): void {
    this.setState({
      selectedAudioClipId: clipId,
      beatAnalysis: null,
      previewTimings: [],
      error: null,
    });
  }

  setSelectedTracks(trackIds: string[]): void {
    this.setState({ selectedTrackIds: trackIds });
    this.updateClipsToSync();
    this.updatePreview();
  }

  toggleTrackSelection(trackId: string): void {
    const { selectedTrackIds } = this.state;
    const newIds = selectedTrackIds.includes(trackId)
      ? selectedTrackIds.filter((id) => id !== trackId)
      : [...selectedTrackIds, trackId];
    this.setSelectedTracks(newIds);
  }

  updateConfig(updates: Partial<BeatSyncConfig>): void {
    this.setState({
      config: { ...this.state.config, ...updates } as BeatSyncConfig,
    });
    this.updatePreview();
  }

  private updateClipsToSync(): void {
    const { selectedTrackIds } = this.state;
    const store = useProjectStore.getState();
    const { project } = store;

    const clips: ClipInfo[] = [];

    for (const track of project.timeline.tracks) {
      if (selectedTrackIds.includes(track.id)) {
        for (const clip of track.clips) {
          clips.push({
            id: clip.id,
            startTime: clip.startTime,
            duration: clip.duration,
            trackId: track.id,
          });
        }
      }
    }

    this.setState({ clipsToSync: clips });
  }

  private updatePreview(): void {
    const { beatAnalysis, clipsToSync, config, selectedAudioClipId } = this.state;
    if (!beatAnalysis || clipsToSync.length === 0) {
      this.setState({ previewTimings: [] });
      return;
    }

    const store = useProjectStore.getState();
    const audioClip = selectedAudioClipId ? store.getClip(selectedAudioClipId) : null;
    const audioStartTime = audioClip?.startTime ?? 0;

    const engine = getBeatSyncEngine();
    const timings = engine.calculateSyncedTimings(
      clipsToSync,
      beatAnalysis,
      audioStartTime,
      config,
    );

    this.setState({ previewTimings: timings });
  }

  async analyzeBeats(): Promise<void> {
    const { selectedAudioClipId } = this.state;
    if (!selectedAudioClipId) {
      this.setState({ error: "No audio clip selected" });
      return;
    }

    const store = useProjectStore.getState();
    const clip = store.getClip(selectedAudioClipId);
    if (!clip) {
      this.setState({ error: "Clip not found" });
      return;
    }

    const mediaItem = store.getMediaItem(clip.mediaId);
    if (!mediaItem?.blob) {
      this.setState({ error: "Media blob not found" });
      return;
    }

    this.setState({ isProcessing: true, error: null });

    try {
      const audioBlob = await this.extractAudioFromBlob(
        mediaItem.blob,
        clip.inPoint ?? 0,
        clip.outPoint ?? clip.duration,
      );

      const engine = getBeatSyncEngine();
      const beatAnalysis = await engine.analyzeBeats(audioBlob, (progress) =>
        this.setState({ progress }),
      );

      this.setState({
        beatAnalysis,
        isProcessing: false,
        progress: null,
      });

      this.updatePreview();
    } catch (error) {
      this.setState({
        isProcessing: false,
        error: error instanceof Error ? error.message : "Beat analysis failed",
        progress: null,
      });
    }
  }

  async applySync(): Promise<boolean> {
    const { previewTimings } = this.state;
    if (previewTimings.length === 0) {
      this.setState({ error: "No clips to sync" });
      return false;
    }

    const store = useProjectStore.getState();

    this.setState({ isProcessing: true, error: null });

    try {
      for (const timing of previewTimings) {
        await store.moveClip(timing.clipId, timing.newStartTime);

        const clip = store.getClip(timing.clipId);
        if (clip && this.state.config.syncMode !== "preserve-duration") {
          const newOutPoint = (clip.inPoint ?? 0) + timing.newDuration;
          await store.trimClip(timing.clipId, clip.inPoint, newOutPoint);
        }
      }

      this.setState({
        isProcessing: false,
        progress: {
          phase: "complete",
          percent: 100,
          message: `Synced ${previewTimings.length} clips to beats`,
        },
      });

      return true;
    } catch (error) {
      this.setState({
        isProcessing: false,
        error: error instanceof Error ? error.message : "Failed to apply sync",
      });
      return false;
    }
  }

  getAvailableTracks(): Array<{ id: string; name: string; type: string; clipCount: number }> {
    const store = useProjectStore.getState();
    const { project } = store;
    const { selectedAudioClipId } = this.state;

    const audioClip = selectedAudioClipId ? store.getClip(selectedAudioClipId) : null;
    const audioTrackId = audioClip
      ? project.timeline.tracks.find((t) => t.clips.some((c) => c.id === selectedAudioClipId))?.id
      : null;

    return project.timeline.tracks
      .filter((track) => track.id !== audioTrackId && track.clips.length > 0)
      .map((track) => ({
        id: track.id,
        name: track.name,
        type: track.type,
        clipCount: track.clips.length,
      }));
  }

  private async extractAudioFromBlob(
    blob: Blob,
    inPoint: number,
    outPoint: number,
  ): Promise<Blob> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

    const duration = Math.min(outPoint - inPoint, audioBuffer.duration - inPoint);
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(inPoint * sampleRate);
    const numSamples = Math.floor(duration * sampleRate);

    const offlineContext = new OfflineAudioContext(1, numSamples, sampleRate);
    const trimmedBuffer = offlineContext.createBuffer(1, numSamples, sampleRate);
    const channelData = trimmedBuffer.getChannelData(0);
    const sourceData = audioBuffer.getChannelData(0);

    for (let i = 0; i < numSamples; i++) {
      channelData[i] = sourceData[startSample + i] || 0;
    }

    const source = offlineContext.createBufferSource();
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

    const channelDataArr = buffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, channelDataArr[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  reset(): void {
    this.setState({ ...initialState });
  }

  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.listeners.clear();
  }
}

let bridgeInstance: BeatSyncBridge | null = null;

export function getBeatSyncBridge(): BeatSyncBridge {
  if (!bridgeInstance) {
    bridgeInstance = new BeatSyncBridge();
  }
  return bridgeInstance;
}

export function disposeBeatSyncBridge(): void {
  if (bridgeInstance) {
    bridgeInstance.dispose();
    bridgeInstance = null;
  }
}

export { DEFAULT_BEAT_SYNC_CONFIG, type BeatSyncConfig, type ClipTiming, type BeatAnalysisResult };
