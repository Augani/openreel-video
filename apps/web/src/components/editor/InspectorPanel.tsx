import React, { useCallback, useMemo, useState } from "react";
import { ChevronDown, Zap, Captions, Loader2 } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useEngineStore } from "../../stores/engine-store";
import type { Transform, FitMode, Clip } from "@openreel/core";
import {
  ChromaKeyEngine,
  getTranscriptionService,
  initializeTranscriptionService,
  type WhisperTranscriptionProgress,
  type CaptionAnimationStyle,
  CAPTION_ANIMATION_STYLES,
  getAnimationStyleDisplayName,
} from "@openreel/core";
import {
  VideoEffectsSection,
  GreenScreenSection,
  PiPSection,
  SpeedRampSection,
  MaskSection,
  ColorGradingSection,
  AudioEffectsSection,
  TextSection,
  TextAnimationSection,
  ShapeSection,
  SVGSection,
  KeyframesSection,
  BlendingSection,
  Transform3DSection,
  MotionTrackingSection,
  AudioDuckingSection,
  NestedSequenceSection,
  AdjustmentLayerSection,
  ClipTransitionSection,
  BackgroundRemovalSection,
  AutoReframeSection,
  AutoCutSilenceSection,
  CropSection,
  SpeedSection,
  MotionPresetsPanel,
  EmphasisAnimationSection,
} from "./inspector";
import {
  getAudioBridgeEffects,
  initializeAudioBridgeEffects,
  DEFAULT_EQ_BANDS,
} from "../../bridges/audio-bridge-effects";
import {
  Input,
  LabeledSlider,
  Switch,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from "@openreel/ui";

// Initialize engines as singletons
const chromaKeyEngine = new ChromaKeyEngine({ width: 1920, height: 1080 });

const Section: React.FC<{
  title: string;
  defaultOpen?: boolean;
  sectionId?: string;
  children: React.ReactNode;
}> = ({ title, defaultOpen = false, sectionId, children }) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <div className="mb-6 transition-all" data-section-id={sectionId}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors mb-3 w-full group"
      >
        <ChevronDown
          size={12}
          className={`transition-transform duration-200 ${
            isOpen ? "" : "-rotate-90"
          } text-text-muted group-hover:text-text-primary`}
        />
        <span className="text-xs font-medium">{title}</span>
      </button>
      {isOpen && (
        <div className="animate-in slide-in-from-top-2 duration-200">
          {children}
        </div>
      )}
    </div>
  );
};

const EmptyState: React.FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center opacity-50">
    <p className="text-sm text-text-secondary mb-2">No selection</p>
    <p className="text-xs text-text-muted">
      Select a clip to view its properties
    </p>
  </div>
);

export const InspectorPanel: React.FC = () => {
  // Stores
  const { getClip, getMediaItem, addSubtitle, updateSubtitle, getSubtitle } =
    useProjectStore();
  const project = useProjectStore((state) => state.project);
  const { getSelectedClipIds } = useUIStore();
  const selectedItems = useUIStore((state) => state.selectedItems);
  const selectedClipIds = getSelectedClipIds();
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);

  // Transcription state
  const [transcriptionProgress, setTranscriptionProgress] =
    useState<WhisperTranscriptionProgress | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [defaultAnimationStyle, setDefaultAnimationStyle] =
    useState<CaptionAnimationStyle>("word-highlight");

  // Check if a subtitle is selected
  const selectedSubtitleId = useMemo(() => {
    const subtitleSelection = selectedItems.find(
      (item) => item.type === "subtitle",
    );
    return subtitleSelection?.id || null;
  }, [selectedItems]);

  const selectedSubtitle = useMemo(() => {
    if (!selectedSubtitleId) return null;
    return getSubtitle(selectedSubtitleId) || null;
  }, [selectedSubtitleId, getSubtitle, project.timeline.subtitles]);

  // Get selected clip (check regular clips, text clips, and shape clips)
  const selectedClip = useMemo(() => {
    if (selectedClipIds.length !== 1) return null;
    const clipId = selectedClipIds[0];
    const regularClip = getClip(clipId);
    if (regularClip) return regularClip;
    const titleEngine = getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip) {
      return {
        id: textClip.id,
        mediaId: `text-${textClip.id}`,
        startTime: textClip.startTime,
        duration: textClip.duration,
        inPoint: 0,
        outPoint: textClip.duration,
        transform: textClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        text: textClip.text,
        trackId: textClip.trackId,
      };
    }
    const graphicsEngine = getGraphicsEngine();
    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip) {
      return {
        id: shapeClip.id,
        mediaId: `shape-${shapeClip.id}`,
        startTime: shapeClip.startTime,
        duration: shapeClip.duration,
        inPoint: 0,
        outPoint: shapeClip.duration,
        transform: shapeClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        shapeType: shapeClip.shapeType,
        trackId: shapeClip.trackId,
      };
    }
    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip) {
      return {
        id: svgClip.id,
        mediaId: `svg-${svgClip.id}`,
        startTime: svgClip.startTime,
        duration: svgClip.duration,
        inPoint: 0,
        outPoint: svgClip.duration,
        transform: svgClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        svgContent: svgClip.svgContent,
        trackId: svgClip.trackId,
      };
    }
    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip) {
      return {
        id: stickerClip.id,
        mediaId: `sticker-${stickerClip.id}`,
        startTime: stickerClip.startTime,
        duration: stickerClip.duration,
        inPoint: 0,
        outPoint: stickerClip.duration,
        transform: stickerClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        imageUrl: stickerClip.imageUrl,
        trackId: stickerClip.trackId,
      };
    }
    return null;
  }, [
    selectedClipIds,
    getClip,
    getTitleEngine,
    getGraphicsEngine,
    project.modifiedAt,
  ]);

  // Force re-render trigger - increment to force recalculation of engine values
  const [updateCounter, forceUpdate] = React.useReducer((x) => x + 1, 0);

  // Get current values from engines - recalculate when updateCounter changes
  const clipId = selectedClip?.id || "";

  const chromaKeySettings = useMemo(() => {
    return clipId ? chromaKeyEngine.getSettings(clipId) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, updateCounter]);

  // Get updateClipTransform from store
  const updateClipTransform = useProjectStore(
    (state) => state.updateClipTransform,
  );

  // Transform handlers
  const handleTransformChange = useCallback(
    (changes: Partial<Transform>) => {
      if (!selectedClip) return;
      updateClipTransform(selectedClip.id, changes);
    },
    [selectedClip, updateClipTransform],
  );

  // Chroma Key handlers using ChromaKeyEngine
  const handleChromaKeyToggle = useCallback(
    (enabled: boolean) => {
      if (!selectedClip) return;
      if (enabled) {
        chromaKeyEngine.enableChromaKey(selectedClip.id);
      } else {
        chromaKeyEngine.disableChromaKey(selectedClip.id);
      }
      forceUpdate();
    },
    [selectedClip],
  );

  const handleKeyColorChange = useCallback(
    (hexColor: string) => {
      if (!selectedClip) return;
      const hex = hexColor.replace("#", "");
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      chromaKeyEngine.setKeyColor(selectedClip.id, { r, g, b });
      forceUpdate();
    },
    [selectedClip],
  );

  const handleToleranceChange = useCallback(
    (tolerance: number) => {
      if (!selectedClip) return;
      chromaKeyEngine.setTolerance(selectedClip.id, tolerance / 100);
      forceUpdate();
    },
    [selectedClip],
  );

  const { addVideoEffect, updateVideoEffect } = useProjectStore();

  const handleRemoveBackground = useCallback(() => {
    if (!selectedClip) return;
    chromaKeyEngine.enableChromaKey(selectedClip.id);
    chromaKeyEngine.setKeyColor(selectedClip.id, { r: 0, g: 1, b: 0 });
    chromaKeyEngine.setTolerance(selectedClip.id, 0.35);
    forceUpdate();
  }, [selectedClip]);

  const [isEnhancingAudio, setIsEnhancingAudio] = useState(false);
  const [audioEnhanced, setAudioEnhanced] = useState(false);

  const handleEnhanceAudio = useCallback(async () => {
    if (!selectedClip) return;
    setIsEnhancingAudio(true);
    try {
      await initializeAudioBridgeEffects();
      const bridge = getAudioBridgeEffects();
      const speechEQBands = DEFAULT_EQ_BANDS.map((band, i) => {
        let gain = 0;
        if (i === 0) gain = -3;
        if (i === 1) gain = 2;
        if (i === 2) gain = 4;
        if (i === 3) gain = 3;
        if (i === 4) gain = -2;
        return { ...band, gain };
      });
      const eqResult = bridge.applyEQ(selectedClip.id, speechEQBands);
      const compResult = bridge.applyCompressor(selectedClip.id, {
        threshold: -18,
        ratio: 3,
        attack: 0.005,
        release: 0.15,
      });
      if (eqResult.success && compResult.success) {
        setAudioEnhanced(true);
        setTimeout(() => setAudioEnhanced(false), 2000);
      }
      forceUpdate();
    } catch (error) {
      console.error("Failed to enhance audio:", error);
    } finally {
      setIsEnhancingAudio(false);
    }
  }, [selectedClip, forceUpdate]);

  const handleAutoColor = useCallback(() => {
    if (!selectedClip) return;
    addVideoEffect(selectedClip.id, "saturation");
    addVideoEffect(selectedClip.id, "contrast");
    addVideoEffect(selectedClip.id, "brightness");
    const effects = useProjectStore.getState().getVideoEffects(selectedClip.id);
    const satEffect = effects.find((e) => e.type === "saturation");
    const contEffect = effects.find((e) => e.type === "contrast");
    const brightEffect = effects.find((e) => e.type === "brightness");
    if (satEffect)
      updateVideoEffect(selectedClip.id, satEffect.id, { value: 1.15 });
    if (contEffect)
      updateVideoEffect(selectedClip.id, contEffect.id, { value: 1.1 });
    if (brightEffect)
      updateVideoEffect(selectedClip.id, brightEffect.id, { value: 5 });
  }, [selectedClip, addVideoEffect, updateVideoEffect]);

  const handleGenerateSubtitles = useCallback(async () => {
    if (!selectedClip || isTranscribing) return;

    const mediaItem = getMediaItem(selectedClip.mediaId);
    if (!mediaItem) {
      console.error("[Subtitles] No media item found for clip");
      return;
    }

    setIsTranscribing(true);
    setTranscriptionProgress({
      phase: "extracting",
      progress: 0,
      message: "Preparing audio...",
    });

    try {
      let transcriptionService = getTranscriptionService();
      if (!transcriptionService) {
        transcriptionService = initializeTranscriptionService({
          apiEndpoint: "https://transcribe.openreel.video",
        });
      }

      const regularClip = getClip(selectedClip.id);
      if (!regularClip) {
        throw new Error("Could not find clip data");
      }

      const subtitles = await transcriptionService.transcribeClip(
        regularClip,
        mediaItem,
        setTranscriptionProgress,
      );

      for (const subtitle of subtitles) {
        addSubtitle({
          ...subtitle,
          animationStyle: defaultAnimationStyle,
        });
      }

      setTranscriptionProgress({
        phase: "complete",
        progress: 100,
        message: `Added ${subtitles.length} subtitles`,
      });

      setTimeout(() => {
        setTranscriptionProgress(null);
        setIsTranscribing(false);
      }, 2000);
    } catch (error) {
      console.error("[Subtitles] Transcription failed:", error);
      setTranscriptionProgress({
        phase: "error",
        progress: 0,
        message:
          error instanceof Error ? error.message : "Transcription failed",
      });
      setTimeout(() => {
        setTranscriptionProgress(null);
        setIsTranscribing(false);
      }, 3000);
    }
  }, [
    selectedClip,
    isTranscribing,
    getMediaItem,
    getClip,
    addSubtitle,
    defaultAnimationStyle,
  ]);

  // Default transform
  const defaultTransform: Transform = {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    anchor: { x: 0.5, y: 0.5 },
    borderRadius: 0,
  };
  const transform = selectedClip?.transform || defaultTransform;

  // Derive UI state from engines
  const chromaKeyEnabled = chromaKeySettings?.enabled || false;
  const keyColor = chromaKeySettings
    ? `#${Math.round(chromaKeySettings.keyColor.r * 255)
        .toString(16)
        .padStart(2, "0")}${Math.round(chromaKeySettings.keyColor.g * 255)
        .toString(16)
        .padStart(2, "0")}${Math.round(chromaKeySettings.keyColor.b * 255)
        .toString(16)
        .padStart(2, "0")}`
    : "#00ff00";
  const tolerance = (chromaKeySettings?.tolerance || 0.3) * 100;

  /**
   * Detect clip type based on track type and clip properties
   */
  const clipType = useMemo(() => {
    if (!selectedClip) return null;

    // Check mediaId prefix first for text, shape, and SVG clips (they may not be in timeline tracks)
    if (selectedClip.mediaId.startsWith("text-")) {
      return "text";
    }

    if (selectedClip.mediaId.startsWith("shape-")) {
      return "shape";
    }

    if (selectedClip.mediaId.startsWith("svg-")) {
      return "svg";
    }

    if (
      selectedClip.mediaId.startsWith("sticker-") ||
      selectedClip.mediaId.startsWith("emoji-")
    ) {
      return "sticker";
    }

    // Find the track this clip belongs to
    const track = project.timeline.tracks.find((t) =>
      t.clips.some((c) => c.id === selectedClip.id),
    );

    if (!track) return "video";

    // Check for clip types based on track type and media
    const mediaItem = project.mediaLibrary.items.find(
      (item) => item.id === selectedClip.mediaId,
    );

    if (track.type === "audio") {
      return "audio";
    }

    if (track.type === "image" || mediaItem?.type === "image") {
      return "image";
    }

    // Default to video for video tracks
    return "video";
  }, [selectedClip, project.timeline.tracks, project.mediaLibrary.items]);

  /**
   * Determine which sections to show based on clip type
   */
  const showVideoEffects = clipType === "video" || clipType === "image";
  const showColorGrading = clipType === "video" || clipType === "image";
  const showAudioEffects = clipType === "video" || clipType === "audio";
  const showTextSection = clipType === "text";
  const showShapeSection = clipType === "shape";
  const showSVGSection = clipType === "svg";
  const showVideoControls = clipType === "video" || clipType === "image";
  const showTransformControls =
    clipType === "video" ||
    clipType === "image" ||
    clipType === "text" ||
    clipType === "shape" ||
    clipType === "svg" ||
    clipType === "sticker";

  return (
    <div className="w-80 bg-background-secondary border-l border-border flex flex-col overflow-y-auto h-full custom-scrollbar">
      <div className="p-5">
        <h3 className="text-sm font-bold text-text-primary mb-5 tracking-tight">
          Inspector
        </h3>

        {selectedClip ? (
          <>
            {/* Clip Info */}
            <div className="mb-4 p-3 bg-background-tertiary rounded-lg border border-border">
              <p className="text-xs text-text-primary font-medium truncate">
                {selectedClip.id.substring(0, 20)}...
              </p>
              <p className="text-[10px] text-text-muted">
                Duration: {selectedClip.duration.toFixed(2)}s
              </p>
            </div>

            {/* Generate Subtitles Section - Video clips only - Prominent position */}
            {clipType === "video" && (
              <div className="mb-4 p-3 bg-primary/10 rounded-lg border border-primary/30">
                <div className="flex items-center gap-2 mb-3">
                  <Captions size={14} className="text-primary" />
                  <span className="text-xs font-bold text-primary">
                    AI Auto-Captions
                  </span>
                </div>

                {/* Animation Style Selector */}
                <div className="mb-3">
                  <label className="text-[10px] text-text-secondary block mb-1">
                    Animation Style
                  </label>
                  <Select
                    value={defaultAnimationStyle}
                    onValueChange={(v) => setDefaultAnimationStyle(v as CaptionAnimationStyle)}
                    disabled={isTranscribing}
                  >
                    <SelectTrigger className="w-full bg-background-secondary border-border text-text-primary text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background-secondary border-border">
                      {CAPTION_ANIMATION_STYLES.map((style) => (
                        <SelectItem key={style} value={style}>
                          {getAnimationStyleDisplayName(style)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {transcriptionProgress ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Loader2
                        size={12}
                        className="animate-spin text-primary"
                      />
                      <span className="text-[10px] text-text-primary">
                        {transcriptionProgress.message}
                      </span>
                    </div>
                    <div className="h-1.5 bg-background-tertiary rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          transcriptionProgress.phase === "error"
                            ? "bg-red-500"
                            : transcriptionProgress.phase === "complete"
                              ? "bg-green-500"
                              : "bg-primary"
                        }`}
                        style={{ width: `${transcriptionProgress.progress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleGenerateSubtitles}
                    disabled={isTranscribing}
                    className="w-full py-2 bg-primary hover:bg-primary/80 text-black rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-2"
                  >
                    <Captions size={14} />
                    Generate Captions
                  </button>
                )}
              </div>
            )}

            {/* AI Background Removal - Video clips only */}
            {clipType === "video" && (
              <div className="mb-4">
                <BackgroundRemovalSection clipId={clipId} />
              </div>
            )}

            {/* AI Auto Reframe - Video clips only */}
            {clipType === "video" && (
              <div className="mb-4">
                <AutoReframeSection clipId={clipId} />
              </div>
            )}

            {/* AI Auto Cut Silence - Video and Audio clips */}
            {showAudioEffects && (
              <div className="mb-4">
                <AutoCutSilenceSection clipId={clipId} />
              </div>
            )}

            {/* Transform */}
            {showTransformControls && (
              <Section title="Transform" sectionId="transform">
                <div className="space-y-3">
                  <LabeledSlider
                    label="Position X"
                    value={transform.position.x}
                    onChange={(x) =>
                      handleTransformChange({
                        position: { ...transform.position, x },
                      })
                    }
                    min={-1920}
                    max={1920}
                    step={1}
                    unit="px"
                  />
                  <LabeledSlider
                    label="Position Y"
                    value={transform.position.y}
                    onChange={(y) =>
                      handleTransformChange({
                        position: { ...transform.position, y },
                      })
                    }
                    min={-1080}
                    max={1080}
                    step={1}
                    unit="px"
                  />
                  <LabeledSlider
                    label="Scale X"
                    value={transform.scale.x * 100}
                    onChange={(x) =>
                      handleTransformChange({
                        scale: { ...transform.scale, x: x / 100 },
                      })
                    }
                    min={0}
                    max={300}
                    step={1}
                    unit="%"
                  />
                  <LabeledSlider
                    label="Scale Y"
                    value={transform.scale.y * 100}
                    onChange={(y) =>
                      handleTransformChange({
                        scale: { ...transform.scale, y: y / 100 },
                      })
                    }
                    min={0}
                    max={300}
                    step={1}
                    unit="%"
                  />
                  <LabeledSlider
                    label="Rotation"
                    value={transform.rotation}
                    onChange={(rotation) => handleTransformChange({ rotation })}
                    min={-180}
                    max={180}
                    step={1}
                    unit="°"
                  />
                  <LabeledSlider
                    label="Opacity"
                    value={transform.opacity * 100}
                    onChange={(opacity) =>
                      handleTransformChange({ opacity: opacity / 100 })
                    }
                    min={0}
                    max={100}
                    step={1}
                    unit="%"
                  />
                  <LabeledSlider
                    label="Border Radius"
                    value={transform.borderRadius || 0}
                    onChange={(borderRadius) =>
                      handleTransformChange({ borderRadius })
                    }
                    min={0}
                    max={200}
                    step={1}
                    unit="px"
                  />
                  {clipType === "image" && (
                    <div className="space-y-1 pt-2 border-t border-border">
                      <span className="text-[10px] text-text-secondary">
                        Fit Mode
                      </span>
                      <div className="grid grid-cols-4 gap-1">
                        {(
                          ["contain", "cover", "stretch", "none"] as FitMode[]
                        ).map((mode) => (
                          <button
                            key={mode}
                            onClick={() =>
                              handleTransformChange({ fitMode: mode })
                            }
                            className={`py-1.5 rounded text-[9px] capitalize transition-colors ${
                              (transform.fitMode || "none") === mode
                                ? "bg-primary text-white"
                                : "bg-background-tertiary border border-border text-text-secondary hover:text-text-primary"
                            }`}
                          >
                            {mode === "contain"
                              ? "Fit"
                              : mode === "cover"
                                ? "Fill"
                                : mode}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* Crop */}
            {showVideoControls &&
              selectedClip &&
              !selectedClip.mediaId.startsWith("text-") &&
              !selectedClip.mediaId.startsWith("shape-") &&
              !selectedClip.mediaId.startsWith("svg-") &&
              !selectedClip.mediaId.startsWith("sticker-") && (
                <Section title="Crop" sectionId="crop" defaultOpen={false}>
                  <CropSection clip={selectedClip as Clip} />
                </Section>
              )}

            {/* Speed & Direction */}
            {showVideoControls &&
              selectedClip &&
              !selectedClip.mediaId.startsWith("text-") &&
              !selectedClip.mediaId.startsWith("shape-") &&
              !selectedClip.mediaId.startsWith("svg-") &&
              !selectedClip.mediaId.startsWith("sticker-") && (
                <Section
                  title="Speed & Direction"
                  sectionId="speed"
                  defaultOpen={true}
                >
                  <SpeedSection clip={selectedClip as Clip} />
                </Section>
              )}

            {/* Blending - Layer compositing blend modes */}
            {(clipType === "video" ||
              clipType === "image" ||
              clipType === "text" ||
              clipType === "shape" ||
              clipType === "svg" ||
              clipType === "sticker") && (
              <Section
                title="Blending"
                sectionId="blending"
                defaultOpen={false}
              >
                <BlendingSection clipId={clipId} />
              </Section>
            )}

            {/* 3D Transforms - After Effects-style 3D rotation */}
            {(clipType === "video" ||
              clipType === "image" ||
              clipType === "text" ||
              clipType === "shape" ||
              clipType === "svg" ||
              clipType === "sticker") && (
              <Section
                title="3D Transforms"
                sectionId="transform-3d"
                defaultOpen={false}
              >
                <Transform3DSection clipId={clipId} />
              </Section>
            )}

            {/* Keyframes - Using KeyframeEngine */}
            <Section title="Keyframes" sectionId="keyframes">
              <KeyframesSection clipId={clipId} />
            </Section>

            {/* Entry/Exit Transitions - For all visual clips */}
            {(clipType === "video" ||
              clipType === "image" ||
              clipType === "text" ||
              clipType === "shape" ||
              clipType === "svg" ||
              clipType === "sticker") && (
              <Section
                title="Entry/Exit Transitions"
                sectionId="transitions"
                defaultOpen={false}
              >
                <ClipTransitionSection clipId={clipId} />
              </Section>
            )}

            {/* Motion Presets - Advanced animation presets */}
            {(clipType === "video" ||
              clipType === "image" ||
              clipType === "shape" ||
              clipType === "svg" ||
              clipType === "sticker") && (
              <Section
                title="Motion Presets"
                sectionId="motion-presets"
                defaultOpen={false}
              >
                <MotionPresetsPanel clipId={clipId} />
              </Section>
            )}

            {/* Emphasis Animation - Looping animations while clip is visible */}
            {(clipType === "video" ||
              clipType === "image" ||
              clipType === "text" ||
              clipType === "shape" ||
              clipType === "svg" ||
              clipType === "sticker") && (
              <Section
                title="Emphasis Animation"
                sectionId="emphasis-animation"
                defaultOpen={false}
              >
                <EmphasisAnimationSection clipId={clipId} />
              </Section>
            )}

            {/* Chroma Key - Using ChromaKeyEngine - Only for video/image */}
            {showVideoControls && (
              <Section title="Chroma Key (Green Screen)">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-secondary">
                      Enable
                    </span>
                    <Switch
                      checked={chromaKeyEnabled}
                      onCheckedChange={handleChromaKeyToggle}
                    />
                  </div>
                  {chromaKeyEnabled && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-text-secondary">
                          Key Color
                        </span>
                        <input
                          type="color"
                          value={keyColor}
                          onChange={(e) => handleKeyColorChange(e.target.value)}
                          className="w-8 h-6 rounded border border-border cursor-pointer"
                        />
                      </div>
                      <LabeledSlider
                        label="Tolerance"
                        value={tolerance}
                        onChange={handleToleranceChange}
                        unit="%"
                      />
                    </>
                  )}
                </div>
              </Section>
            )}

            {/* Motion Tracking - Using MotionTrackingEngine - Only for video/image */}
            {showVideoControls && (
              <Section title="Motion Tracking" sectionId="motion-tracking">
                <MotionTrackingSection clipId={clipId} />
              </Section>
            )}

            {showVideoEffects && (
              <Section title="Video Effects" sectionId="video-effects">
                <VideoEffectsSection clipId={clipId} />
              </Section>
            )}

            {showVideoEffects && (
              <Section
                title="Green Screen"
                sectionId="green-screen"
                defaultOpen={false}
              >
                <GreenScreenSection clipId={clipId} />
              </Section>
            )}

            {/* Picture-in-Picture Section */}
            {showVideoControls && (
              <Section
                title="Picture-in-Picture"
                sectionId="pip"
                defaultOpen={false}
              >
                <PiPSection clipId={clipId} />
              </Section>
            )}

            {showVideoControls && selectedClip && (
              <Section title="Speed & Time" defaultOpen={false}>
                <SpeedRampSection clip={selectedClip} />
              </Section>
            )}

            {showVideoControls && (
              <Section title="Masking" sectionId="masking" defaultOpen={false}>
                <MaskSection clipId={clipId} />
              </Section>
            )}

            {showVideoControls && (
              <Section title="Nested Sequences" defaultOpen={false}>
                <NestedSequenceSection clipId={clipId} />
              </Section>
            )}

            {showVideoControls && (
              <Section title="Adjustment Layers" defaultOpen={false}>
                <AdjustmentLayerSection clipId={clipId} />
              </Section>
            )}

            {showColorGrading && (
              <Section
                title="Color Grading"
                sectionId="color-grading"
                defaultOpen={false}
              >
                <ColorGradingSection clipId={clipId} />
              </Section>
            )}

            {showAudioEffects && (
              <Section
                title="Audio Effects"
                sectionId="audio-effects"
                defaultOpen={false}
              >
                <AudioEffectsSection clipId={clipId} />
              </Section>
            )}

            {showAudioEffects && (
              <Section
                title="Audio Ducking"
                sectionId="audio-ducking"
                defaultOpen={false}
              >
                <AudioDuckingSection clipId={clipId} />
              </Section>
            )}

            {showTextSection && (
              <Section title="Text Properties" sectionId="text-properties">
                <TextSection clipId={clipId} />
              </Section>
            )}

            {showTextSection && (
              <Section
                title="Text Animation"
                sectionId="text-animation"
                defaultOpen={false}
              >
                <TextAnimationSection clipId={clipId} />
              </Section>
            )}

            {showShapeSection && (
              <Section title="Shape Properties" sectionId="shape-properties">
                <ShapeSection clipId={clipId} />
              </Section>
            )}

            {/* SVG Section */}
            {showSVGSection && (
              <Section title="SVG Properties">
                <SVGSection clipId={clipId} />
              </Section>
            )}

            {/* Quick Actions - Only show when there are actions available */}
            {(showVideoControls || showAudioEffects || showVideoEffects) && (
              <div className="border border-primary/30 bg-primary/5 rounded-xl p-4 relative overflow-hidden">
                <div className="flex items-center gap-2 text-primary mb-3">
                  <Zap size={14} />
                  <span className="text-xs font-bold">Quick Actions</span>
                </div>
                <div className="space-y-2">
                  {showVideoControls && (
                    <button
                      onClick={handleRemoveBackground}
                      className="w-full py-2 bg-background-tertiary hover:bg-primary hover:text-white border border-border hover:border-primary rounded-lg text-[10px] transition-all"
                    >
                      Remove Background
                    </button>
                  )}
                  {showAudioEffects && (
                    <button
                      onClick={handleEnhanceAudio}
                      disabled={isEnhancingAudio}
                      className={`w-full py-2 border rounded-lg text-[10px] transition-all flex items-center justify-center gap-1.5 ${
                        audioEnhanced
                          ? "bg-green-500/20 border-green-500 text-green-400"
                          : isEnhancingAudio
                            ? "bg-background-tertiary border-border text-text-muted cursor-not-allowed"
                            : "bg-background-tertiary hover:bg-primary hover:text-white border-border hover:border-primary"
                      }`}
                    >
                      {isEnhancingAudio ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          Enhancing...
                        </>
                      ) : audioEnhanced ? (
                        "✓ Enhanced"
                      ) : (
                        "Enhance Audio"
                      )}
                    </button>
                  )}
                  {showVideoEffects && (
                    <button
                      onClick={handleAutoColor}
                      className="w-full py-2 bg-background-tertiary hover:bg-primary hover:text-white border border-border hover:border-primary rounded-lg text-[10px] transition-all"
                    >
                      Auto-Color
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        ) : selectedSubtitle ? (
          <>
            {/* Subtitle Info */}
            <div className="mb-4 p-3 bg-primary/10 rounded-lg border border-primary/30">
              <div className="flex items-center gap-2 mb-1">
                <Captions size={14} className="text-primary" />
                <span className="text-xs font-bold text-primary">Subtitle</span>
              </div>
              <p className="text-[10px] text-text-muted">
                {selectedSubtitle.startTime.toFixed(2)}s -{" "}
                {selectedSubtitle.endTime.toFixed(2)}s
              </p>
            </div>

            {/* Subtitle Text Editor */}
            <Section title="Text Content">
              <div className="space-y-3">
                <textarea
                  value={selectedSubtitle.text}
                  onChange={(e) =>
                    updateSubtitle(selectedSubtitle.id, {
                      text: e.target.value,
                    })
                  }
                  className="w-full h-24 px-3 py-2 bg-background-tertiary border border-border rounded-lg text-xs text-text-primary resize-none focus:outline-none focus:border-primary"
                  placeholder="Enter subtitle text..."
                />
              </div>
            </Section>

            {/* Subtitle Timing */}
            <Section title="Timing">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">
                    Start Time
                  </span>
                  <Input
                    type="number"
                    step="0.1"
                    value={selectedSubtitle.startTime.toFixed(2)}
                    onChange={(e) =>
                      updateSubtitle(selectedSubtitle.id, {
                        startTime: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-20 h-7 text-[10px] bg-background-tertiary border-border text-text-primary text-right"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">
                    End Time
                  </span>
                  <Input
                    type="number"
                    step="0.1"
                    value={selectedSubtitle.endTime.toFixed(2)}
                    onChange={(e) =>
                      updateSubtitle(selectedSubtitle.id, {
                        endTime: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-20 h-7 text-[10px] bg-background-tertiary border-border text-text-primary text-right"
                  />
                </div>
              </div>
            </Section>

            {/* Subtitle Position */}
            <Section title="Position">
              <div className="grid grid-cols-3 gap-2">
                {(["top", "center", "bottom"] as const).map((pos) => (
                  <button
                    key={pos}
                    onClick={() =>
                      updateSubtitle(selectedSubtitle.id, {
                        style: {
                          ...(selectedSubtitle.style || {}),
                          position: pos,
                        } as typeof selectedSubtitle.style,
                      })
                    }
                    className={`py-1.5 rounded text-[10px] capitalize transition-colors ${
                      (selectedSubtitle.style?.position || "bottom") === pos
                        ? "bg-primary text-white"
                        : "bg-background-tertiary border border-border text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </Section>

            {/* Subtitle Animation Style */}
            <Section title="Animation">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">Style</span>
                  <Select
                    value={selectedSubtitle.animationStyle || "none"}
                    onValueChange={(v) =>
                      updateSubtitle(selectedSubtitle.id, {
                        animationStyle: v as CaptionAnimationStyle,
                      })
                    }
                  >
                    <SelectTrigger className="w-auto min-w-[100px] bg-background-tertiary border-border text-text-primary text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background-secondary border-border">
                      {CAPTION_ANIMATION_STYLES.map((style) => (
                        <SelectItem key={style} value={style}>
                          {getAnimationStyleDisplayName(style)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[9px] text-text-muted">
                  {selectedSubtitle.animationStyle === "karaoke" &&
                    "Words fill with color as they're spoken"}
                  {selectedSubtitle.animationStyle === "word-highlight" &&
                    "Current word is highlighted and scaled"}
                  {selectedSubtitle.animationStyle === "word-by-word" &&
                    "Shows one word at a time"}
                  {selectedSubtitle.animationStyle === "bounce" &&
                    "Words bounce in as they appear"}
                  {selectedSubtitle.animationStyle === "typewriter" &&
                    "Words appear progressively like typing"}
                  {(!selectedSubtitle.animationStyle ||
                    selectedSubtitle.animationStyle === "none") &&
                    "Static text, no animation"}
                </p>
                {selectedSubtitle.animationStyle &&
                  selectedSubtitle.animationStyle !== "none" &&
                  !selectedSubtitle.words?.length && (
                    <p className="text-[9px] text-amber-400 bg-amber-400/10 p-2 rounded">
                      ⚠️ No word-level timing data. Re-generate captions to
                      enable animation.
                    </p>
                  )}
                {selectedSubtitle.animationStyle &&
                  selectedSubtitle.animationStyle !== "none" &&
                  selectedSubtitle.animationStyle !== "typewriter" &&
                  selectedSubtitle.animationStyle !== "word-by-word" && (
                    <div className="pt-2 border-t border-border space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-text-secondary">
                          Highlight Color
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={
                              selectedSubtitle.style?.highlightColor ||
                              "#ffff00"
                            }
                            onChange={(e) =>
                              updateSubtitle(selectedSubtitle.id, {
                                style: {
                                  ...(selectedSubtitle.style || {}),
                                  highlightColor: e.target.value,
                                } as typeof selectedSubtitle.style,
                              })
                            }
                            className="w-6 h-6 rounded border border-border cursor-pointer"
                          />
                          <span className="text-[9px] font-mono text-text-muted uppercase">
                            {selectedSubtitle.style?.highlightColor ||
                              "#ffff00"}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-6 gap-1">
                        {[
                          "#ffff00",
                          "#00ff00",
                          "#ff6b6b",
                          "#4ecdc4",
                          "#ff9f43",
                          "#a55eea",
                        ].map((color) => (
                          <button
                            key={color}
                            onClick={() =>
                              updateSubtitle(selectedSubtitle.id, {
                                style: {
                                  ...(selectedSubtitle.style || {}),
                                  highlightColor: color,
                                } as typeof selectedSubtitle.style,
                              })
                            }
                            className={`w-6 h-6 rounded border-2 transition-transform hover:scale-110 ${
                              (selectedSubtitle.style?.highlightColor ||
                                "#ffff00") === color
                                ? "border-white"
                                : "border-transparent"
                            }`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            </Section>

            {/* Subtitle Font Settings */}
            <Section title="Font">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">
                    Font Family
                  </span>
                  <Select
                    value={selectedSubtitle.style?.fontFamily || "Inter"}
                    onValueChange={(v) =>
                      updateSubtitle(selectedSubtitle.id, {
                        style: {
                          ...(selectedSubtitle.style || {}),
                          fontFamily: v,
                        } as typeof selectedSubtitle.style,
                      })
                    }
                  >
                    <SelectTrigger className="max-w-[120px] bg-background-tertiary border-border text-text-primary text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background-secondary border-border max-h-60">
                      <SelectGroup>
                        <SelectLabel className="text-text-muted text-[10px] font-medium">Popular</SelectLabel>
                        {["Inter", "Poppins", "Montserrat", "Roboto", "Open Sans", "Lato", "DM Sans"].map((font) => (
                          <SelectItem key={font} value={font} style={{ fontFamily: font }}>
                            {font}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel className="text-text-muted text-[10px] font-medium">Display</SelectLabel>
                        {["Bebas Neue", "Anton", "Oswald", "Teko", "Staatliches", "Alfa Slab One"].map((font) => (
                          <SelectItem key={font} value={font} style={{ fontFamily: font }}>
                            {font}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel className="text-text-muted text-[10px] font-medium">Elegant</SelectLabel>
                        {["Playfair Display", "Cinzel", "Lora", "Merriweather", "DM Serif Display"].map((font) => (
                          <SelectItem key={font} value={font} style={{ fontFamily: font }}>
                            {font}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel className="text-text-muted text-[10px] font-medium">Handwritten</SelectLabel>
                        {["Pacifico", "Lobster", "Dancing Script", "Caveat", "Permanent Marker"].map((font) => (
                          <SelectItem key={font} value={font} style={{ fontFamily: font }}>
                            {font}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">
                    Font Size
                  </span>
                  <Input
                    type="number"
                    min={12}
                    max={72}
                    value={selectedSubtitle.style?.fontSize || 24}
                    onChange={(e) =>
                      updateSubtitle(selectedSubtitle.id, {
                        style: {
                          ...(selectedSubtitle.style || {}),
                          fontSize: parseInt(e.target.value) || 24,
                        } as typeof selectedSubtitle.style,
                      })
                    }
                    className="w-16 h-7 text-[10px] bg-background-tertiary border-border text-text-primary text-right"
                  />
                </div>
              </div>
            </Section>

            {/* Subtitle Colors */}
            <Section title="Colors">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">
                    Text Color
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={selectedSubtitle.style?.color || "#ffffff"}
                      onChange={(e) =>
                        updateSubtitle(selectedSubtitle.id, {
                          style: {
                            ...(selectedSubtitle.style || {}),
                            color: e.target.value,
                          } as typeof selectedSubtitle.style,
                        })
                      }
                      className="w-6 h-6 rounded border border-border cursor-pointer"
                    />
                    <span className="text-[10px] font-mono text-text-muted uppercase">
                      {selectedSubtitle.style?.color || "#ffffff"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">
                    Background
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={
                        selectedSubtitle.style?.backgroundColor?.replace(
                          /rgba?\([^)]+\)/,
                          "#000000",
                        ) || "#000000"
                      }
                      onChange={(e) => {
                        const hex = e.target.value;
                        const r = parseInt(hex.slice(1, 3), 16);
                        const g = parseInt(hex.slice(3, 5), 16);
                        const b = parseInt(hex.slice(5, 7), 16);
                        updateSubtitle(selectedSubtitle.id, {
                          style: {
                            ...(selectedSubtitle.style || {}),
                            backgroundColor: `rgba(${r}, ${g}, ${b}, 0.7)`,
                          } as typeof selectedSubtitle.style,
                        });
                      }}
                      className="w-6 h-6 rounded border border-border cursor-pointer"
                    />
                    <Select
                      value={
                        selectedSubtitle.style?.backgroundColor?.includes("0.7")
                          ? "0.7"
                          : selectedSubtitle.style?.backgroundColor?.includes("0.5")
                            ? "0.5"
                            : "1"
                      }
                      onValueChange={(v) => {
                        const currentBg =
                          selectedSubtitle.style?.backgroundColor ||
                          "rgba(0, 0, 0, 0.7)";
                        const newBg = currentBg.replace(
                          /[\d.]+\)$/,
                          `${v})`,
                        );
                        updateSubtitle(selectedSubtitle.id, {
                          style: {
                            ...(selectedSubtitle.style || {}),
                            backgroundColor: newBg,
                          } as typeof selectedSubtitle.style,
                        });
                      }}
                    >
                      <SelectTrigger className="w-auto min-w-[50px] bg-background-tertiary border-border text-text-primary text-[9px] h-6">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background-secondary border-border">
                        <SelectItem value="0">None</SelectItem>
                        <SelectItem value="0.5">50%</SelectItem>
                        <SelectItem value="0.7">70%</SelectItem>
                        <SelectItem value="1">100%</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </Section>

            {/* Delete Subtitle */}
            <div className="pt-4 border-t border-border">
              <button
                onClick={() => {
                  const { removeSubtitle } = useProjectStore.getState();
                  removeSubtitle(selectedSubtitle.id);
                }}
                className="w-full py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-lg text-[10px] transition-all"
              >
                Delete Subtitle
              </button>
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
};

export default InspectorPanel;
