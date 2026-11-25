import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
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
  MaskEngine,
  NestedSequenceEngine,
  AdjustmentLayerEngine,
} from "@openreel/core";
import "../services/content-fill-cache";
import { loadEngineModules, loadOptionalEngineModules, onEngineModulesLoaded } from "../services/lazy-engines";
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

interface AudioLevelData {
  peaks: Map<string, number>;
  rms: Map<string, number>;
  masterPeak: number;
  masterRms: number;
  isClipping: boolean;
  isWarning: boolean;
}

interface PlaybackStats {
  currentTime: number;
  duration: number;
  state: "stopped" | "playing" | "paused";
  fps: number;
  droppedFrames: number;
  audioBufferHealth: number;
  videoBufferHealth: number;
  avgFrameRenderTime: number;
}

interface EngineState {
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
const AUDIO_THRESHOLDS = {
  /** Warning threshold: -6dB = 10^(-6/20) ≈ 0.501 */
  WARNING_DB: -6,
  WARNING_LINEAR: Math.pow(10, -6 / 20), // ~0.501

  /** Clipping threshold: 0dB = 1.0 */
  CLIPPING_DB: 0,
  CLIPPING_LINEAR: 1.0,
} as const;

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
function detectThresholds(level: number): {
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

export const useEngineStore = create<EngineState>()(
  subscribeWithSelector((set, get) => ({
    initialized: false,
    initializing: false,
    initError: null,

    videoEngine: null,
    audioEngine: null,
    playbackController: null,
    // The title/graphics singletons live in the lazily loaded engine modules;
    // they are hydrated below as soon as that import resolves.
    titleEngine: null,
    subtitleEngine: null,
    graphicsEngine: null,
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
        const engines = await loadEngineModules();
        const initMark = (name: string): void => {
          try {
            performance.mark(`openreel:engine:${name}`);
          } catch {
            // Marks are diagnostics only.
          }
        };
        initMark("modules");
        const videoEngine = engines.getVideoEngine();
        const audioEngine = engines.getAudioEngine();
        const playbackController = engines.getPlaybackController();
        const photoEngine = engines.getPhotoEngine();
        const exportEngine = engines.getExportEngine();
        const coreTitleEngine = engines.titleEngine;
        const coreGraphicsEngine = engines.graphicsEngine;

        coreTitleEngine.initialize(1920, 1080);

        initMark("start");
        await videoEngine.initialize();
        initMark("video");
        // Decoded-frame cache: never above the shared media memory budget (scaled from device
        // memory, refined by the desktop hardware probe), and on desktop never above the RAM-scaled
        // frame-cache budget either. Frames are budgeted in bytes, so 4K holds fewer than 1080p.
        const applyFrameBudget = (maxSizeBytes: number, maxFrames?: number): void => {
          videoEngine.setCacheConfig(
            maxFrames === undefined ? { maxSizeBytes } : { maxSizeBytes, maxFrames },
          );
        };
        let desktopFrameBytes = Number.POSITIVE_INFINITY;
        let desktopFrames: number | undefined;
        const applyCombined = (): void => {
          applyFrameBudget(
            Math.min(desktopFrameBytes, engines.getMediaMemoryBudget().videoFrameBytes),
            desktopFrames,
          );
        };
        applyCombined();
        engines.subscribeMediaMemoryBudget(applyCombined);
        // Memory governor: counts the frame cache and the open decoders, and under pressure shrinks every
        // media cache (through the shared budget above) and lowers the number of decoder elements.
        const governor = engines.getMemoryGovernor();
        governor.registerConsumer("video-frames", { bytes: () => videoEngine.getCacheStats().sizeBytes });
        governor.subscribe((policy) => videoEngine.setMaxVideoElements(policy.maxDecoderElements));
        videoEngine.setMaxVideoElements(governor.policy.maxDecoderElements);
        governor.start();
        if (window.openreel?.platform === "desktop") {
          const heap = (performance as unknown as {
            memory?: { usedJSHeapSize?: number };
          }).memory?.usedJSHeapSize;
          // The hardware probe can take seconds on some machines; apply the
          // budget when it arrives instead of holding up editor init.
          void engines.getRecommendedCacheBudget(heap ?? 0)
            .then((budget) => {
              desktopFrameBytes = budget.maxSizeBytes;
              desktopFrames = budget.maxFrames;
              applyCombined();
            })
            .catch((error) => {
              console.warn("[EngineStore] Cache budget unavailable:", error);
            });
        }
        await audioEngine.initialize();
        initMark("audio");
        await playbackController.initialize(videoEngine, audioEngine);
        initMark("playback");
        await exportEngine.initialize();
        initMark("export");

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
      getOrCreateEngine("subtitle", async () => new (await loadOptionalEngineModules()).SubtitleEngine()),
    getGraphicsEngine: () => get().graphicsEngine,
    getPhotoEngine: () => get().photoEngine,
    getExportEngine: () => get().exportEngine,
    getSpeechToTextEngine: () =>
      getOrCreateEngine("speechToText", async () => new (await loadOptionalEngineModules()).SpeechToTextEngine()),
    getTemplateEngine: () =>
      getOrCreateEngine("template", async () => new (await loadOptionalEngineModules()).TemplateEngine()),
    getSoundLibraryEngine: () =>
      getOrCreateEngine("soundLibrary", async () => new (await loadOptionalEngineModules()).SoundLibraryEngine()),
    getChromaKeyEngine: () =>
      getOrCreateEngine(
        "chromaKey",
        async () => new (await loadEngineModules()).ChromaKeyEngine({ width: 1920, height: 1080 })
      ),
    getMultiCamEngine: () =>
      getOrCreateEngine("multiCam", async () => (await loadOptionalEngineModules()).multicamEngine),
    getMaskEngine: () =>
      getOrCreateEngine(
        "mask",
        async () => new (await loadEngineModules()).MaskEngine({ width: 1920, height: 1080 })
      ),
    getNestedSequenceEngine: () =>
      getOrCreateEngine("nestedSequence", async () => new (await loadEngineModules()).NestedSequenceEngine()),
    getAdjustmentLayerEngine: () =>
      getOrCreateEngine("adjustmentLayer", async () => new (await loadEngineModules()).AdjustmentLayerEngine()),
  })),
);

// Hydrate the overlay engines as soon as the engine modules resolve (they are
// not a static import: see services/lazy-engines). Does not start the load.
onEngineModulesLoaded((engines) => {
  engines.titleEngine.initialize(1920, 1080);
  useEngineStore.setState((state) => ({
    titleEngine: state.titleEngine ?? engines.titleEngine,
    graphicsEngine: state.graphicsEngine ?? engines.graphicsEngine,
  }));
});
