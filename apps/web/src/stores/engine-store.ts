import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import {
  VideoEngine,
  AudioEngine,
  PlaybackController,
  TitleEngine,
  SubtitleEngine,
  GraphicsEngine,
  PhotoEngine,
  ExportEngine,
  SpeechToTextEngine,
  TemplateEngine,
  SoundLibraryEngine,
  ChromaKeyEngine,
  MultiCamEngine,
  multicamEngine,
  MaskEngine,
  NestedSequenceEngine,
  AdjustmentLayerEngine,
  getVideoEngine,
  getAudioEngine,
  getPlaybackController,
  getPhotoEngine,
  getExportEngine,
  titleEngine as coreTitleEngine,
  graphicsEngine as coreGraphicsEngine,
} from "@openreel/core";
import type { RenderedFrame } from "@openreel/core";

const lazyEngineCache = new Map<string, unknown>();

async function getOrCreateEngine<T>(
  key: string,
  factory: () => T | Promise<T>
): Promise<T> {
  if (!lazyEngineCache.has(key)) {
    lazyEngineCache.set(key, Promise.resolve(factory()));
  }
  return lazyEngineCache.get(key) as Promise<T>;
}

export interface AudioLevelData {
  peaks: Map<string, number>;
  rms: Map<string, number>;
  masterPeak: number;
  masterRms: number;
  isClipping: boolean;
  isWarning: boolean;
}

export interface PlaybackStats {
  currentTime: number;
  duration: number;
  state: "stopped" | "playing" | "paused";
  fps: number;
  droppedFrames: number;
  audioBufferHealth: number;
  videoBufferHealth: number;
  avgFrameRenderTime: number;
}

export interface EngineState {
  initialized: boolean;
  initializing: boolean;
  initError: string | null;
  videoEngine: VideoEngine | null;
  audioEngine: AudioEngine | null;
  playbackController: PlaybackController | null;
  titleEngine: TitleEngine | null;
  subtitleEngine: SubtitleEngine | null;
  graphicsEngine: GraphicsEngine | null;
  photoEngine: PhotoEngine | null;
  exportEngine: ExportEngine | null;
  speechToTextEngine: SpeechToTextEngine | null;
  templateEngine: TemplateEngine | null;
  soundLibraryEngine: SoundLibraryEngine | null;
  chromaKeyEngine: ChromaKeyEngine | null;
  multiCamEngine: MultiCamEngine | null;
  maskEngine: MaskEngine | null;
  nestedSequenceEngine: NestedSequenceEngine | null;
  adjustmentLayerEngine: AdjustmentLayerEngine | null;
  currentFrame: RenderedFrame | null;
  playbackStats: PlaybackStats | null;
  audioLevels: AudioLevelData | null;
  initialize: () => Promise<void>;
  dispose: () => void;
  renderFrame: (time: number) => Promise<RenderedFrame | null>;
  getAudioLevels: () => AudioLevelData;
  updateAudioLevels: (
    trackLevels: Map<string, { peak: number; rms: number }>,
  ) => void;
  resetAudioLevels: () => void;
  getVideoEngine: () => VideoEngine | null;
  getAudioEngine: () => AudioEngine | null;
  getPlaybackController: () => PlaybackController | null;
  getTitleEngine: () => TitleEngine | null;
  getSubtitleEngine: () => Promise<SubtitleEngine>;
  getGraphicsEngine: () => GraphicsEngine | null;
  getPhotoEngine: () => PhotoEngine | null;
  getExportEngine: () => ExportEngine | null;
  getSpeechToTextEngine: () => Promise<SpeechToTextEngine>;
  getTemplateEngine: () => Promise<TemplateEngine>;
  getSoundLibraryEngine: () => Promise<SoundLibraryEngine>;
  getChromaKeyEngine: () => Promise<ChromaKeyEngine>;
  getMultiCamEngine: () => Promise<MultiCamEngine>;
  getMaskEngine: () => Promise<MaskEngine>;
  getNestedSequenceEngine: () => Promise<NestedSequenceEngine>;
  getAdjustmentLayerEngine: () => Promise<AdjustmentLayerEngine>;
}

/**
 * Audio level threshold constants (in linear scale, converted from dB)
 *
 * Warning and clipping thresholds
 * Feature: core-ui-integration, Property 20: Audio Level Threshold Detection
 */
export const AUDIO_THRESHOLDS = {
  /** Warning threshold: -6dB = 10^(-6/20) ≈ 0.501 */
  WARNING_DB: -6,
  WARNING_LINEAR: Math.pow(10, -6 / 20), // ~0.501

  /** Clipping threshold: 0dB = 1.0 */
  CLIPPING_DB: 0,
  CLIPPING_LINEAR: 1.0,
} as const;

/**
 * Convert linear amplitude to decibels
 * @param linear - Linear amplitude value (0-1+)
 * @returns Decibel value
 */
export function linearToDb(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

/**
 * Convert decibels to linear amplitude
 * @param db - Decibel value
 * @returns Linear amplitude value
 */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Detect audio level threshold violations
 *
 * Warning indicator when levels exceed -6dB
 * Clipping indicator when levels exceed 0dB
 * Feature: core-ui-integration, Property 20: Audio Level Threshold Detection
 *
 * @param level - Audio level in linear scale (0-1+)
 * @returns Object with isWarning and isClipping flags
 */
export function detectThresholds(level: number): {
  isWarning: boolean;
  isClipping: boolean;
} {
  return {
    isWarning: level > AUDIO_THRESHOLDS.WARNING_LINEAR,
    isClipping: level >= AUDIO_THRESHOLDS.CLIPPING_LINEAR,
  };
}

const DEFAULT_AUDIO_LEVELS: AudioLevelData = {
  peaks: new Map(),
  rms: new Map(),
  masterPeak: 0,
  masterRms: 0,
  isClipping: false,
  isWarning: false,
};

const DEFAULT_PLAYBACK_STATS: PlaybackStats = {
  currentTime: 0,
  duration: 0,
  state: "stopped",
  fps: 0,
  droppedFrames: 0,
  audioBufferHealth: 1,
  videoBufferHealth: 1,
  avgFrameRenderTime: 0,
};

coreTitleEngine.initialize(1920, 1080);

export const useEngineStore = create<EngineState>()(
  subscribeWithSelector((set, get) => ({
    initialized: false,
    initializing: false,
    initError: null,

    videoEngine: null,
    audioEngine: null,
    playbackController: null,
    titleEngine: coreTitleEngine,
    subtitleEngine: null,
    graphicsEngine: coreGraphicsEngine,
    photoEngine: null,
    exportEngine: null,
    speechToTextEngine: null,
    templateEngine: null,
    soundLibraryEngine: null,
    chromaKeyEngine: null,
    multiCamEngine: null,
    maskEngine: null,
    nestedSequenceEngine: null,
    adjustmentLayerEngine: null,

    currentFrame: null,
    playbackStats: DEFAULT_PLAYBACK_STATS,
    audioLevels: DEFAULT_AUDIO_LEVELS,

    initialize: async () => {
      const state = get();

      if (state.initialized || state.initializing) {
        return;
      }

      set({ initializing: true, initError: null });

      try {
        const videoEngine = getVideoEngine();
        const audioEngine = getAudioEngine();
        const playbackController = getPlaybackController();
        const photoEngine = getPhotoEngine();
        const exportEngine = getExportEngine();

        coreTitleEngine.initialize(1920, 1080);

        await videoEngine.initialize();
        await audioEngine.initialize();
        await playbackController.initialize(videoEngine, audioEngine);
        await exportEngine.initialize();

        set({
          initialized: true,
          initializing: false,
          initError: null,
          videoEngine,
          audioEngine,
          playbackController,
          titleEngine: coreTitleEngine,
          graphicsEngine: coreGraphicsEngine,
          photoEngine,
          exportEngine,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Unknown initialization error";
        set({
          initialized: false,
          initializing: false,
          initError: errorMessage,
        });
        throw error;
      }
    },

    dispose: () => {
      const state = get();

      state.videoEngine?.dispose();
      state.audioEngine?.dispose();
      state.playbackController?.dispose();
      state.photoEngine?.dispose();
      state.exportEngine?.dispose();
      state.graphicsEngine?.clearCache();

      if (state.currentFrame) {
        state.currentFrame.image.close();
      }

      lazyEngineCache.clear();

      set({
        initialized: false,
        initializing: false,
        initError: null,
        videoEngine: null,
        audioEngine: null,
        playbackController: null,
        titleEngine: null,
        subtitleEngine: null,
        graphicsEngine: null,
        photoEngine: null,
        exportEngine: null,
        speechToTextEngine: null,
        soundLibraryEngine: null,
        chromaKeyEngine: null,
        multiCamEngine: null,
        maskEngine: null,
        nestedSequenceEngine: null,
        adjustmentLayerEngine: null,
        currentFrame: null,
        playbackStats: DEFAULT_PLAYBACK_STATS,
        audioLevels: DEFAULT_AUDIO_LEVELS,
      });
    },

    /**
     * Render a frame at the specified time
     * Note: This is a placeholder - actual rendering requires a project
     * and will be implemented in the RenderBridge
     */
    renderFrame: async (_time: number) => {
      const { videoEngine, initialized } = get();

      if (!initialized || !videoEngine) {
        return null;
      }

      // The actual implementation will be in the RenderBridge
      // which has access to the project store
      return null;
    },

    getAudioLevels: () => {
      const { audioLevels } = get();
      return audioLevels || DEFAULT_AUDIO_LEVELS;
    },

    updateAudioLevels: (
      trackLevels: Map<string, { peak: number; rms: number }>,
    ) => {
      const peaks = new Map<string, number>();
      const rms = new Map<string, number>();
      let masterPeak = 0;
      let masterRms = 0;
      let isClipping = false;
      let isWarning = false;

      for (const [trackId, levels] of trackLevels) {
        peaks.set(trackId, levels.peak);
        rms.set(trackId, levels.rms);

        masterPeak = Math.max(masterPeak, levels.peak);
        masterRms = Math.max(masterRms, levels.rms);

        const thresholds = detectThresholds(levels.peak);
        if (thresholds.isClipping) isClipping = true;
        if (thresholds.isWarning) isWarning = true;
      }

      const masterThresholds = detectThresholds(masterPeak);
      if (masterThresholds.isClipping) isClipping = true;
      if (masterThresholds.isWarning) isWarning = true;

      set({
        audioLevels: {
          peaks,
          rms,
          masterPeak,
          masterRms,
          isClipping,
          isWarning,
        },
      });
    },

    resetAudioLevels: () => {
      set({
        audioLevels: DEFAULT_AUDIO_LEVELS,
      });
    },

    getVideoEngine: () => get().videoEngine,
    getAudioEngine: () => get().audioEngine,
    getPlaybackController: () => get().playbackController,
    getTitleEngine: () => get().titleEngine,
    getSubtitleEngine: () =>
      getOrCreateEngine("subtitle", () => new SubtitleEngine()),
    getGraphicsEngine: () => get().graphicsEngine,
    getPhotoEngine: () => get().photoEngine,
    getExportEngine: () => get().exportEngine,
    getSpeechToTextEngine: () =>
      getOrCreateEngine("speechToText", () => new SpeechToTextEngine()),
    getTemplateEngine: () =>
      getOrCreateEngine("template", () => new TemplateEngine()),
    getSoundLibraryEngine: () =>
      getOrCreateEngine("soundLibrary", () => new SoundLibraryEngine()),
    getChromaKeyEngine: () =>
      getOrCreateEngine(
        "chromaKey",
        () => new ChromaKeyEngine({ width: 1920, height: 1080 })
      ),
    getMultiCamEngine: () =>
      getOrCreateEngine("multiCam", () => multicamEngine),
    getMaskEngine: () =>
      getOrCreateEngine(
        "mask",
        () => new MaskEngine({ width: 1920, height: 1080 })
      ),
    getNestedSequenceEngine: () =>
      getOrCreateEngine("nestedSequence", () => new NestedSequenceEngine()),
    getAdjustmentLayerEngine: () =>
      getOrCreateEngine("adjustmentLayer", () => new AdjustmentLayerEngine()),
  })),
);
