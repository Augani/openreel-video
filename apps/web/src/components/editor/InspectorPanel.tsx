import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Zap, Captions, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useEngineStore } from "../../stores/engine-store";
import type { Transform, FitMode, Clip, EditingTemplatePrimitive } from "@openreel/core";
import {
  ChromaKeyEngine,
  initializeTranscriptionService,
  type WhisperTranscriptionProgress,
  type CaptionAnimationStyle,
  CAPTION_ANIMATION_STYLES,
  getAnimationStyleDisplayName,
  getParticleEngine,
  type ParticleEffect,
  type ParticleConfig,
} from "@openreel/core";
import {
  VideoEffectsSection,
  GreenScreenSection,
  PiPSection,
  MaskSection,
  ColorGradingSection,
  AudioEffectsSection,
  NoiseReductionSection,
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
  StabilizationSection,
  SpeedRampSection,
  MotionPresetsPanel,
  EmphasisAnimationSection,
  MotionPathSection,
  ParticleEffectsSection,
  AudioTextSyncPanel,
  AlignmentSection,
  BehindSubjectSection,
} from "./inspector";
import { OPENREEL_TRANSCRIBE_URL } from "../../config/api-endpoints";
import { AutoEditPanel } from "./panels/AutoEditPanel";
import { HighlightExtractorPanel } from "./panels/HighlightExtractorPanel";
import {
  EditingTemplateControls,
  mergeEditingTemplateControlValues,
} from "./panels/EditingTemplateControls";
import {
  getAudioBridgeEffects,
  initializeAudioBridgeEffects,
  DEFAULT_NOISE_REDUCTION,
} from "../../bridges/audio-bridge-effects";
import { toast } from "../../stores/notification-store";
import {
  FONT_CATEGORIES,
  FONT_FILE_ACCEPT,
  registerCustomFont,
  useCustomFonts,
} from "./inspector/font-options";
import { getNoiseReductionPreset } from "./inspector/noise-reduction-presets";
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

const EmptyState: React.FC = () => {
  const { t } = useTranslation();
  return (
  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center opacity-50">
    <p className="text-sm text-text-secondary mb-2">{t("inspector.noSelection")}</p>
    <p className="text-xs text-text-muted">
      {t("inspector.selectToViewProperties")}
    </p>
  </div>
  );
};

const ParticleEffectsSectionWrapper: React.FC<{
  clipId: string;
  clipDuration: number;
  clipStartTime: number;
}> = ({ clipId, clipDuration, clipStartTime }) => {
  const [updateTrigger, setUpdateTrigger] = React.useState(0);
  const particleEngine = React.useMemo(() => getParticleEngine(), []);

  const effects = React.useMemo(() => {
    return particleEngine.getEffectsForClip(clipId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, particleEngine, updateTrigger]);

  const handleAddEffect = React.useCallback(
    (effect: ParticleEffect) => {
      particleEngine.addEffect(effect);
      setUpdateTrigger((v) => v + 1);
    },
    [particleEngine]
  );

  const handleUpdateEffect = React.useCallback(
    (effectId: string, config: Partial<ParticleConfig>) => {
      particleEngine.updateEffect(effectId, config);
      setUpdateTrigger((v) => v + 1);
    },
    [particleEngine]
  );

  const handleRemoveEffect = React.useCallback(
    (effectId: string) => {
      particleEngine.removeEffect(effectId);
      setUpdateTrigger((v) => v + 1);
    },
    [particleEngine]
  );

  const handleToggleEffect = React.useCallback(
    (effectId: string, enabled: boolean) => {
      particleEngine.toggleEffect(effectId, enabled);
      setUpdateTrigger((v) => v + 1);
    },
    [particleEngine]
  );

  const handleUpdateTiming = React.useCallback(
    (effectId: string, startTime: number, duration: number) => {
      particleEngine.updateEffectTiming(effectId, startTime, duration);
      setUpdateTrigger((v) => v + 1);
    },
    [particleEngine]
  );

  return (
    <ParticleEffectsSection
      clipId={clipId}
      clipDuration={clipDuration}
      clipStartTime={clipStartTime}
      effects={effects}
      onAddEffect={handleAddEffect}
      onUpdateEffect={handleUpdateEffect}
      onRemoveEffect={handleRemoveEffect}
      onToggleEffect={handleToggleEffect}
      onUpdateTiming={handleUpdateTiming}
    />
  );
};

export const InspectorPanel: React.FC = () => {
  const { t } = useTranslation();
  // Stores
  const {
    getClip,
    getMediaItem,
    addSubtitle,
    importSRT,
    updateSubtitle,
    getSubtitle,
    getEditingTemplate,
    updateEditingTemplateApplication,
    removeEditingTemplateApplication,
  } = useProjectStore();
  const project = useProjectStore((state) => state.project);
  const { getSelectedClipIds } = useUIStore();
  const selectedItems = useUIStore((state) => state.selectedItems);
  const effectApplicationClipId = useUIStore(
    (state) => state.effectApplicationClipId,
  );
  const startEffectApplication = useUIStore(
    (state) => state.startEffectApplication,
  );
  const finishEffectApplication = useUIStore(
    (state) => state.finishEffectApplication,
  );
  const selectedClipIds = getSelectedClipIds();
  const pausePlayback = useTimelineStore((state) => state.pause);
  const lockPlayback = useTimelineStore((state) => state.lockPlayback);
  const unlockPlayback = useTimelineStore((state) => state.unlockPlayback);
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);

  // Transcription state
  const [transcriptionProgress, setTranscriptionProgress] =
    useState<WhisperTranscriptionProgress | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState("none");
  const [defaultAnimationStyle, setDefaultAnimationStyle] =
    useState<CaptionAnimationStyle>("word-highlight");
  const [expandedRecipeApplicationId, setExpandedRecipeApplicationId] =
    useState<string | null>(null);
  const [recipeControlValues, setRecipeControlValues] = useState<
    Record<string, Record<string, EditingTemplatePrimitive>>
  >({});
  const srtInputRef = useRef<HTMLInputElement>(null);
  const subtitleFontInputRef = useRef<HTMLInputElement>(null);
  const customFonts = useCustomFonts();

  useEffect(() => {
    setExpandedRecipeApplicationId(null);
  }, [selectedClipIds.join("|")]);

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

  const selectedTimelineClip = useMemo(() => {
    if (selectedClipIds.length !== 1) return null;
    return getClip(selectedClipIds[0]) || null;
  }, [getClip, project.modifiedAt, selectedClipIds]);

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

  const {
    addVideoEffect,
    updateVideoEffect,
    getAudioEffects,
    updateAudioEffect,
    toggleAudioEffect,
  } = useProjectStore();

  const [isEnhancingAudio, setIsEnhancingAudio] = useState(false);
  const [audioEnhanced, setAudioEnhanced] = useState(false);
  const isApplyingSelectedClipEffect =
    effectApplicationClipId !== null && effectApplicationClipId === selectedClip?.id;

  const waitForEffectApplicationPaint = useCallback(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
    [],
  );

  const applyClipEffectWithPlaybackLock = useCallback(
    async (
      clipId: string,
      label: string,
      apply: () => void | Promise<void>,
    ) => {
      pausePlayback();
      lockPlayback(label);
      startEffectApplication(clipId, label);

      try {
        await waitForEffectApplicationPaint();
        await apply();
        window.dispatchEvent(new CustomEvent("openreel:preview-invalidate"));
        await waitForEffectApplicationPaint();
      } finally {
        finishEffectApplication();
        unlockPlayback();
      }
    },
    [
      finishEffectApplication,
      lockPlayback,
      pausePlayback,
      startEffectApplication,
      unlockPlayback,
      waitForEffectApplicationPaint,
    ],
  );

  const handleRemoveBackground = useCallback(() => {
    if (!selectedClip) return;
    void applyClipEffectWithPlaybackLock(
      selectedClip.id,
      t("inspector.applyingBackgroundRemoval"),
      () => {
        chromaKeyEngine.enableChromaKey(selectedClip.id);
        chromaKeyEngine.setKeyColor(selectedClip.id, { r: 0, g: 1, b: 0 });
        chromaKeyEngine.setTolerance(selectedClip.id, 0.35);
        forceUpdate();
      },
    );
  }, [applyClipEffectWithPlaybackLock, forceUpdate, selectedClip]);

  const handleEnhanceAudio = useCallback(async () => {
    if (!selectedClip) return;
    setIsEnhancingAudio(true);
    try {
      await applyClipEffectWithPlaybackLock(
        selectedClip.id,
        t("inspector.applyingAudioCleanup"),
        async () => {
          await initializeAudioBridgeEffects();
          const bridge = getAudioBridgeEffects();
          const noiseCleanupConfig = {
            ...DEFAULT_NOISE_REDUCTION,
            ...getNoiseReductionPreset("speech").config,
          };

          const existingNoiseReduction = getAudioEffects(selectedClip.id).find(
            (effect) => effect.type === "noiseReduction",
          );

          if (existingNoiseReduction) {
            updateAudioEffect(
              selectedClip.id,
              existingNoiseReduction.id,
              noiseCleanupConfig as unknown as Record<string, unknown>,
            );
            toggleAudioEffect(selectedClip.id, existingNoiseReduction.id, true);
          } else {
            const result = bridge.applyNoiseReduction(
              selectedClip.id,
              noiseCleanupConfig,
            );

            if (!result.success) {
              throw new Error(result.error ?? t("inspector.failedToApplyNoiseCleanup"));
            }
          }

          setAudioEnhanced(true);
          setTimeout(() => setAudioEnhanced(false), 2000);
          toast.success(
            t("inspector.noiseCleanupApplied"),
            t("inspector.noiseCleanupAppliedDescription"),
          );

          forceUpdate();
        },
      );
    } catch (error) {
      console.error("Failed to enhance audio:", error);
      toast.error(
        t("inspector.couldNotCleanUpAudio"),
        error instanceof Error
          ? error.message
          : t("inspector.noiseCleanupFailedDescription"),
      );
    } finally {
      setIsEnhancingAudio(false);
    }
  }, [
    applyClipEffectWithPlaybackLock,
    selectedClip,
    forceUpdate,
    getAudioEffects,
    toggleAudioEffect,
    updateAudioEffect,
  ]);

  const handleAutoColor = useCallback(async () => {
    if (!selectedClip) return;
    await applyClipEffectWithPlaybackLock(
      selectedClip.id,
      t("inspector.applyingAutoColor"),
      () => {
        addVideoEffect(selectedClip.id, "saturation");
        addVideoEffect(selectedClip.id, "contrast");
        addVideoEffect(selectedClip.id, "brightness");
        const effects = useProjectStore.getState().getVideoEffects(selectedClip.id);
        const satEffect = effects.find((e) => e.type === "saturation");
        const contEffect = effects.find((e) => e.type === "contrast");
        const brightEffect = effects.find((e) => e.type === "brightness");
        if (satEffect) {
          updateVideoEffect(selectedClip.id, satEffect.id, { value: 1.15 });
        }
        if (contEffect) {
          updateVideoEffect(selectedClip.id, contEffect.id, { value: 1.1 });
        }
        if (brightEffect) {
          updateVideoEffect(selectedClip.id, brightEffect.id, { value: 5 });
        }
      },
    );
  }, [
    addVideoEffect,
    applyClipEffectWithPlaybackLock,
    selectedClip,
    updateVideoEffect,
  ]);

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
      message: t("inspector.preparingAudio"),
    });

    try {
      const transcriptionService = initializeTranscriptionService({
        apiEndpoint: `${OPENREEL_TRANSCRIBE_URL}/transcribe`,
        targetLanguage: targetLanguage !== "none" ? targetLanguage : undefined,
      });

      const regularClip = getClip(selectedClip.id);
      if (!regularClip) {
        throw new Error(t("inspector.couldNotFindClipData"));
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
        message: t("inspector.addedSubtitles", { count: subtitles.length }),
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
          error instanceof Error ? error.message : t("inspector.transcriptionFailed"),
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
    targetLanguage,
  ]);

  const handleSRTImport = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const srtContent = await file.text();
        const result = await importSRT(srtContent);

        if (result.success) {
          if (result.errors.length > 0) {
            toast.warning(
              t("inspector.srtImportedWithWarnings"),
              t("inspector.srtSegmentsSkipped", { count: result.errors.length }),
            );
          } else {
            toast.success(t("inspector.srtImported"), t("inspector.srtImportedDescription"));
          }
        } else {
          toast.error(t("inspector.srtImportFailed"), result.errors[0] || t("inspector.srtNoValidSubtitles"));
        }
      } catch {
        toast.error(t("inspector.srtImportFailed"), t("inspector.srtCouldNotReadFile"));
      } finally {
        event.target.value = "";
      }
    },
    [importSRT],
  );

  const handleSubtitleFontUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !selectedSubtitle) return;

      const result = await registerCustomFont(file);
      if (!result.success) {
        toast.error(t("inspector.fontUploadFailed"), result.error ?? t("inspector.fontUploadUnknownError"));
      } else {
        updateSubtitle(selectedSubtitle.id, {
          style: {
            ...(selectedSubtitle.style || {}),
            fontFamily: result.fontFamily,
          } as typeof selectedSubtitle.style,
        });
        toast.success(t("inspector.customFontUploaded"), t("inspector.fontReadyToUse", { fontFamily: result.fontFamily }));
      }

      event.target.value = "";
    },
    [selectedSubtitle, updateSubtitle],
  );

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
  const selectedNoiseReductionEffect = selectedTimelineClip?.audioEffects?.find(
    (effect) => effect.type === "noiseReduction",
  );
  const noiseReductionSectionTitle = selectedNoiseReductionEffect
    ? selectedNoiseReductionEffect.enabled
      ? t("inspector.backgroundNoiseRemovalActive")
      : t("inspector.backgroundNoiseRemovalConfigured")
    : t("inspector.backgroundNoiseRemoval");
  const appliedEditingTemplates =
    selectedTimelineClip?.metadata?.appliedTemplates || [];
  const handleRecipeControlChange = useCallback(
    (
      applicationId: string,
      controlId: string,
      value: EditingTemplatePrimitive,
    ) => {
      setRecipeControlValues((current) => ({
        ...current,
        [applicationId]: {
          ...(current[applicationId] || {}),
          [controlId]: value,
        },
      }));
    },
    [],
  );
  const handleToggleRecipeControls = useCallback(
    (applicationId: string, templateId: string, controlValues?: Record<string, unknown>) => {
      const template = getEditingTemplate(templateId);
      if (!template || !template.controls || template.controls.length === 0) {
        return;
      }

      setExpandedRecipeApplicationId((current) =>
        current === applicationId ? null : applicationId,
      );
      setRecipeControlValues((current) =>
        current[applicationId]
          ? current
          : {
              ...current,
              [applicationId]: mergeEditingTemplateControlValues(
                template,
                controlValues,
              ),
            },
      );
    },
    [getEditingTemplate],
  );
  const handleResetRecipeControls = useCallback(
    (applicationId: string, templateId: string, controlValues?: Record<string, unknown>) => {
      const template = getEditingTemplate(templateId);
      if (!template) {
        return;
      }

      setRecipeControlValues((current) => ({
        ...current,
        [applicationId]: mergeEditingTemplateControlValues(template, controlValues),
      }));
    },
    [getEditingTemplate],
  );
  const handleUpdateRecipeControls = useCallback(
    (applicationId: string, templateId: string, controlValues?: Record<string, unknown>) => {
      if (!selectedTimelineClip) {
        return;
      }

      const template = getEditingTemplate(templateId);
      if (!template) {
        toast.error(t("inspector.recipeUnavailable"), t("inspector.recipeDefinitionUnavailable"));
        return;
      }

      const nextControlValues =
        recipeControlValues[applicationId] ||
        mergeEditingTemplateControlValues(template, controlValues);
      const updated = updateEditingTemplateApplication(
        selectedTimelineClip.id,
        applicationId,
        nextControlValues,
      );

      if (!updated) {
        toast.error(t("inspector.couldNotUpdateRecipe"), t("inspector.recipeControlsNotSaved"));
        return;
      }

      toast.success(t("inspector.recipeUpdated"), t("inspector.recipeUpdatedDescription", { name: template.name }));
    },
    [
      getEditingTemplate,
      recipeControlValues,
      selectedTimelineClip,
      updateEditingTemplateApplication,
    ],
  );
  const showVideoControls = clipType === "video" || clipType === "image";
  const showTransformControls =
    clipType === "video" ||
    clipType === "image" ||
    clipType === "text" ||
    clipType === "shape" ||
    clipType === "svg" ||
    clipType === "sticker";

  return (
    <div
      data-tour="inspector"
      className="w-full min-w-0 bg-background-secondary border-l border-border flex flex-col overflow-y-auto h-full custom-scrollbar"
    >
      <div className="p-5">
          <h3 className="text-sm font-bold text-text-primary mb-5 tracking-tight">
            {t("tour.inspector")}
          </h3>

        {selectedClip ? (
          <>
            {/* Clip Info */}
            <div className="mb-4 p-3 bg-background-tertiary rounded-lg border border-border">
              <p className="text-xs text-text-primary font-medium truncate">
                {selectedClip.id.substring(0, 20)}...
              </p>
              <p className="text-[10px] text-text-muted">
                {t("inspector.duration")} {selectedClip.duration.toFixed(2)}s
              </p>
            </div>

            {showVideoControls && selectedTimelineClip && (appliedEditingTemplates.length > 0 || (selectedTimelineClip.effects && selectedTimelineClip.effects.length > 0)) && (
              <Section
                title={t("inspector.applied", { count: appliedEditingTemplates.length + (selectedTimelineClip.effects?.filter((e: { metadata?: { templateSource?: unknown } }) => !e.metadata?.templateSource).length || 0) })}
                sectionId="applied-effects"
                defaultOpen={true}
              >
                <div className="space-y-2">
                  {appliedEditingTemplates.map((application) => {
                    const template = getEditingTemplate(application.templateId);
                    const canEdit = Boolean(template?.controls?.length);
                    const isExpanded =
                      expandedRecipeApplicationId === application.applicationId;
                    const currentControlValues = template
                      ? recipeControlValues[application.applicationId] ||
                        mergeEditingTemplateControlValues(
                          template,
                          application.controlValues,
                        )
                      : undefined;

                    return (
                      <div
                        key={application.applicationId}
                        className="rounded-lg border border-border bg-background-tertiary/70 px-2.5 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1 flex items-center gap-2">
                            <Sparkles size={11} className="text-primary shrink-0" />
                            <p className="truncate text-[11px] font-medium text-text-primary">
                              {application.name}
                            </p>
                            <span className="text-[9px] text-text-muted capitalize shrink-0">
                              {application.category?.replace(/-/g, " ") || t("inspector.recipe")}
                            </span>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            {canEdit && (
                              <button
                                onClick={() =>
                                  handleToggleRecipeControls(
                                    application.applicationId,
                                    application.templateId,
                                    application.controlValues,
                                  )
                                }
                                className={`h-6 px-1.5 rounded text-[9px] font-medium transition-colors ${
                                  isExpanded
                                    ? "bg-primary/15 text-primary"
                                    : "text-text-muted hover:text-text-primary"
                                }`}
                              >
                                {t("inspector.edit")}
                              </button>
                            )}
                            <button
                              onClick={() => {
                                const removed = removeEditingTemplateApplication(
                                  selectedTimelineClip.id,
                                  application.applicationId,
                                );
                                if (!removed) {
                                  toast.error(t("inspector.couldNotRemoveRecipe"), t("inspector.recipeNotRemoved"));
                                  return;
                                }
                                setRecipeControlValues((current) => {
                                  const next = { ...current };
                                  delete next[application.applicationId];
                                  return next;
                                });
                                if (expandedRecipeApplicationId === application.applicationId) {
                                  setExpandedRecipeApplicationId(null);
                                }
                              }}
                              className="h-6 px-1.5 rounded text-text-muted hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>

                        {isExpanded && template && currentControlValues && (
                          <div className="mt-2 space-y-3 rounded-lg border border-border/80 bg-background-secondary/80 p-2.5">
                            <EditingTemplateControls
                              template={template}
                              values={currentControlValues}
                              onChange={(controlId, value) =>
                                handleRecipeControlChange(
                                  application.applicationId,
                                  controlId,
                                  value,
                                )
                              }
                            />
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={() =>
                                  handleResetRecipeControls(
                                    application.applicationId,
                                    application.templateId,
                                    application.controlValues,
                                  )
                                }
                                className="h-6 px-2.5 rounded border border-border text-[9px] font-medium text-text-secondary hover:text-text-primary transition-colors"
                              >
                                {t("inspector.reset")}
                              </button>
                              <button
                                onClick={() =>
                                  handleUpdateRecipeControls(
                                    application.applicationId,
                                    application.templateId,
                                    application.controlValues,
                                  )
                                }
                                className="h-6 px-2.5 rounded bg-primary text-[9px] font-semibold text-black hover:bg-primary/85 transition-colors"
                              >
                                {t("inspector.update")}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {selectedTimelineClip.effects
                    ?.filter((e: { metadata?: { templateSource?: unknown } }) => !e.metadata?.templateSource)
                    .map((effect: { id: string; type: string; enabled?: boolean }) => (
                      <div
                        key={effect.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background-tertiary/70 px-2.5 py-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Zap size={11} className="text-amber-400 shrink-0" />
                          <p className="truncate text-[11px] font-medium text-text-primary capitalize">
                            {effect.type.replace(/-/g, " ")}
                          </p>
                        </div>
                        <span className={`text-[9px] font-medium ${effect.enabled !== false ? "text-green-400" : "text-text-muted"}`}>
                          {effect.enabled !== false ? t("inspector.on") : t("inspector.off")}
                        </span>
                      </div>
                    ))}
                </div>
              </Section>
            )}

            {clipType === "video" && (
              <Section title={t("inspector.aiAutoCaptions")} sectionId="auto-captions" defaultOpen={false}>
                <div className="space-y-3">
                  <input
                    ref={srtInputRef}
                    type="file"
                    accept=".srt,text/srt,text/plain"
                    onChange={handleSRTImport}
                    className="hidden"
                  />
                  <div>
                    <label className="text-[10px] text-text-secondary block mb-1">
                      {t("inspector.animationStyle")}
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

                  <div>
                    <label className="text-[10px] text-text-secondary block mb-1">
                      {t("inspector.targetLanguage")}
                    </label>
                    <Select
                      value={targetLanguage}
                      onValueChange={setTargetLanguage}
                      disabled={isTranscribing}
                    >
                      <SelectTrigger className="w-full bg-background-secondary border-border text-text-primary text-[11px]">
                        <SelectValue placeholder={t("inspector.noTranslation")} />
                      </SelectTrigger>
                      <SelectContent className="bg-background-secondary border-border">
                        <SelectItem value="none">{t("inspector.noTranslation")}</SelectItem>
                        <SelectGroup>
                          <SelectLabel className="text-[10px]">{t("inspector.translateTo")}</SelectLabel>
                          <SelectItem value="en">{t("inspector.languages.en")}</SelectItem>
                          <SelectItem value="es">{t("inspector.languages.es")}</SelectItem>
                          <SelectItem value="fr">{t("inspector.languages.fr")}</SelectItem>
                          <SelectItem value="de">{t("inspector.languages.de")}</SelectItem>
                          <SelectItem value="pt">{t("inspector.languages.pt")}</SelectItem>
                          <SelectItem value="it">{t("inspector.languages.it")}</SelectItem>
                          <SelectItem value="nl">{t("inspector.languages.nl")}</SelectItem>
                          <SelectItem value="ru">{t("inspector.languages.ru")}</SelectItem>
                          <SelectItem value="zh">{t("inspector.languages.zh")}</SelectItem>
                          <SelectItem value="ja">{t("inspector.languages.ja")}</SelectItem>
                          <SelectItem value="ko">{t("inspector.languages.ko")}</SelectItem>
                          <SelectItem value="ar">{t("inspector.languages.ar")}</SelectItem>
                          <SelectItem value="hi">{t("inspector.languages.hi")}</SelectItem>
                          <SelectItem value="tr">{t("inspector.languages.tr")}</SelectItem>
                          <SelectItem value="pl">{t("inspector.languages.pl")}</SelectItem>
                          <SelectItem value="sv">{t("inspector.languages.sv")}</SelectItem>
                        </SelectGroup>
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
                      {t("inspector.generateCaptions")}
                    </button>
                  )}
                  <button
                    onClick={() => srtInputRef.current?.click()}
                    disabled={isTranscribing}
                    className="w-full py-2 bg-background-tertiary hover:bg-background-tertiary/80 border border-border text-text-primary rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Upload size={13} />
                    {t("inspector.importSRTFile")}
                  </button>
                </div>
              </Section>
            )}

            {clipType === "video" && (
              <Section title={t("inspector.backgroundRemoval")} sectionId="background-removal" defaultOpen={false}>
                <BackgroundRemovalSection clipId={clipId} />
              </Section>
            )}

            {clipType === "video" && (
              <Section title={t("inspector.autoReframe")} sectionId="auto-reframe" defaultOpen={false}>
                <AutoReframeSection clipId={clipId} />
              </Section>
            )}

            {showAudioEffects && (
              <Section title={t("inspector.autoCutSilence")} sectionId="auto-cut-silence" defaultOpen={false}>
                <AutoCutSilenceSection clipId={clipId} />
              </Section>
            )}

            {/* Beat Sync - Sync other clips to this audio's beats */}
            {clipType === "audio" && (
              <Section title={t("inspector.beatSync")} sectionId="beat-sync" defaultOpen={false}>
                <AudioTextSyncPanel clipId={clipId} />
              </Section>
            )}

            {/* Auto-Edit - Cut video clips to audio beats */}
            {showAudioEffects && (
              <Section title={t("inspector.beatSyncedAutoEdit")} sectionId="auto-edit" defaultOpen={false}>
                <AutoEditPanel onClose={() => {}} />
              </Section>
            )}

            {/* AI Highlight Extractor */}
            {showAudioEffects && (
              <Section title={t("inspector.aiHighlights")} sectionId="ai-highlights" defaultOpen={false}>
                <HighlightExtractorPanel clipId={clipId} />
              </Section>
            )}

            {/* Transform */}
            {showTransformControls && (
              <Section title={t("inspector.transform")} sectionId="transform">
                <div className="space-y-3">
                  <LabeledSlider
                    label={t("inspector.positionX")}
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
                    label={t("inspector.positionY")}
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
                    label={t("inspector.scaleX")}
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
                    label={t("inspector.scaleY")}
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
                    label={t("inspector.rotation")}
                    value={transform.rotation}
                    onChange={(rotation) => handleTransformChange({ rotation })}
                    min={-180}
                    max={180}
                    step={1}
                    unit="°"
                  />
                  <LabeledSlider
                    label={t("inspector.opacity")}
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
                    label={t("inspector.borderRadius")}
                    value={transform.borderRadius || 0}
                    onChange={(borderRadius) =>
                      handleTransformChange({ borderRadius })
                    }
                    min={0}
                    max={200}
                    step={1}
                    unit="px"
                  />
                  {(clipType === "image" || clipType === "video") && (
                    <div className="space-y-1 pt-2 border-t border-border">
                      <span className="text-[10px] text-text-secondary">
                        {t("inspector.fitMode")}
                      </span>
                      <div className="grid grid-cols-4 gap-1">
                        {(
                          ["none", "contain", "cover", "stretch"] as FitMode[]
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
                              ? t("inspector.fit")
                              : mode === "cover"
                                ? t("inspector.fill")
                                : mode === "none"
                                  ? t("inspector.original")
                                  : mode === "stretch"
                                    ? t("inspector.stretch")
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
                <Section title={t("inspector.crop")} sectionId="crop" defaultOpen={false}>
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
                  title={t("inspector.speedDirection")}
                  sectionId="speed"
                  defaultOpen={true}
                >
                  <SpeedSection clip={selectedClip as Clip} />
                </Section>
              )}

            {/* Stabilization */}
            {showVideoControls &&
              selectedClip &&
              !selectedClip.mediaId.startsWith("text-") &&
              !selectedClip.mediaId.startsWith("shape-") &&
              !selectedClip.mediaId.startsWith("svg-") &&
              !selectedClip.mediaId.startsWith("sticker-") && (
                <Section
                  title={t("inspector.stabilization")}
                  sectionId="stabilization"
                  defaultOpen={false}
                >
                  <StabilizationSection clip={selectedClip as Clip} />
                </Section>
              )}

            {/* Speed Curves */}
            {showVideoControls &&
              selectedClip &&
              !selectedClip.mediaId.startsWith("text-") &&
              !selectedClip.mediaId.startsWith("shape-") &&
              !selectedClip.mediaId.startsWith("svg-") &&
              !selectedClip.mediaId.startsWith("sticker-") && (
                <Section
                  title={t("inspector.speedCurves")}
                  sectionId="speed-curves"
                  defaultOpen={false}
                >
                  <SpeedRampSection clip={selectedClip as Clip} />
                </Section>
              )}

            {/* Alignment - Position element on canvas */}
            {(clipType === "video" ||
              clipType === "image" ||
              clipType === "text" ||
              clipType === "shape" ||
              clipType === "svg" ||
              clipType === "sticker") && (
              <Section
                title={t("inspector.alignment")}
                sectionId="alignment"
                defaultOpen={false}
              >
                <AlignmentSection clipId={clipId} />
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
                title={t("inspector.blending")}
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
                title={t("inspector.transform3D")}
                sectionId="transform-3d"
                defaultOpen={false}
              >
                <Transform3DSection clipId={clipId} />
              </Section>
            )}

            {/* Keyframes - Using KeyframeEngine */}
            <Section title={t("inspector.keyframes")} sectionId="keyframes">
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
                title={t("inspector.transitions")}
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
                title={t("inspector.motionPresets")}
                sectionId="motion-presets"
                defaultOpen={false}
              >
                <MotionPresetsPanel clipId={clipId} />
              </Section>
            )}

            {/* Motion Path - Animate position along a path */}
            {(clipType === "video" ||
              clipType === "image" ||
              clipType === "text" ||
              clipType === "shape" ||
              clipType === "svg" ||
              clipType === "sticker") && (
              <Section
                title={t("inspector.motionPath")}
                sectionId="motion-path"
                defaultOpen={false}
              >
                <MotionPathSection clipId={clipId} />
              </Section>
            )}

            {/* Particle Effects - Visual particle systems */}
            {(clipType === "video" ||
              clipType === "image" ||
              clipType === "text" ||
              clipType === "shape" ||
              clipType === "svg" ||
              clipType === "sticker") &&
              selectedClip && (
                <Section
                  title={t("inspector.particleEffects")}
                  sectionId="particle-effects"
                  defaultOpen={false}
                >
                  <ParticleEffectsSectionWrapper
                    clipId={clipId}
                    clipDuration={selectedClip.duration}
                    clipStartTime={selectedClip.startTime}
                  />
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
                title={t("inspector.emphasisAnimation")}
                sectionId="emphasis-animation"
                defaultOpen={false}
              >
                <EmphasisAnimationSection clipId={clipId} />
              </Section>
            )}

            {/* Chroma Key - Using ChromaKeyEngine - Only for video/image */}
            {showVideoControls && (
              <Section title={t("inspector.chromaKey")}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-secondary">
                      {t("inspector.enable")}
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
                          {t("inspector.keyColor")}
                        </span>
                        <input
                          type="color"
                          value={keyColor}
                          onChange={(e) => handleKeyColorChange(e.target.value)}
                          className="w-8 h-6 rounded border border-border cursor-pointer"
                        />
                      </div>
                      <LabeledSlider
                        label={t("inspector.tolerance")}
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
              <Section title={t("inspector.motionTracking")} sectionId="motion-tracking">
                <MotionTrackingSection clipId={clipId} />
              </Section>
            )}

            {showVideoEffects && (
              <Section title={t("inspector.videoEffects")} sectionId="video-effects">
                <VideoEffectsSection clipId={clipId} />
              </Section>
            )}

            {showVideoEffects && (
              <Section
                title={t("inspector.greenScreen")}
                sectionId="green-screen"
                defaultOpen={false}
              >
                <GreenScreenSection clipId={clipId} />
              </Section>
            )}

            {/* Picture-in-Picture Section */}
            {showVideoControls && (
              <Section
                title={t("inspector.pip")}
                sectionId="pip"
                defaultOpen={false}
              >
                <PiPSection clipId={clipId} />
              </Section>
            )}

            {showVideoControls && (
              <Section title={t("inspector.masking")} sectionId="masking" defaultOpen={false}>
                <MaskSection clipId={clipId} />
              </Section>
            )}

            {showVideoControls && (
              <Section title={t("inspector.nestedSequences")} defaultOpen={false}>
                <NestedSequenceSection clipId={clipId} />
              </Section>
            )}

            {showVideoControls && (
              <Section title={t("inspector.adjustmentLayers")} defaultOpen={false}>
                <AdjustmentLayerSection clipId={clipId} />
              </Section>
            )}

            {showColorGrading && (
              <Section
                title={t("inspector.colorGrading")}
                sectionId="color-grading"
                defaultOpen={false}
              >
                <ColorGradingSection clipId={clipId} />
              </Section>
            )}

            {showAudioEffects && (
              <Section
                title={noiseReductionSectionTitle}
                sectionId="background-noise-removal"
                defaultOpen={Boolean(selectedNoiseReductionEffect)}
              >
                <NoiseReductionSection clipId={clipId} />
              </Section>
            )}

            {showAudioEffects && (
              <Section
                title={t("inspector.audioEffects")}
                sectionId="audio-effects"
                defaultOpen={false}
              >
                <AudioEffectsSection clipId={clipId} />
              </Section>
            )}

            {showAudioEffects && (
              <Section
                title={t("inspector.audioDucking")}
                sectionId="audio-ducking"
                defaultOpen={false}
              >
                <AudioDuckingSection clipId={clipId} />
              </Section>
            )}

            {showTextSection && (
              <Section title={t("inspector.textProperties")} sectionId="text-properties">
                <TextSection clipId={clipId} />
              </Section>
            )}

            {showTextSection && (
              <Section
                title={t("inspector.textAnimation")}
                sectionId="text-animation"
                defaultOpen={false}
              >
                <TextAnimationSection clipId={clipId} />
              </Section>
            )}

            {showTextSection && (
              <Section
                title={t("inspector.textBehindSubject")}
                sectionId="text-behind-subject"
                defaultOpen={false}
              >
                <BehindSubjectSection clipId={clipId} />
              </Section>
            )}

            {showShapeSection && (
              <Section title={t("inspector.shapeProperties")} sectionId="shape-properties">
                <ShapeSection clipId={clipId} />
              </Section>
            )}

            {/* SVG Section */}
            {showSVGSection && (
              <Section title={t("inspector.svgProperties")}>
                <SVGSection clipId={clipId} />
              </Section>
            )}

            {/* Quick Actions - Only show when there are actions available */}
            {(showVideoControls || showAudioEffects || showVideoEffects) && (
              <div className="border border-primary/30 bg-primary/5 rounded-xl p-4 relative overflow-hidden">
                <div className="flex items-center gap-2 text-primary mb-3">
                  <Zap size={14} />
                  <span className="text-xs font-bold">{t("inspector.quickActions")}</span>
                </div>
                <div className="space-y-2">
                  {showVideoControls && (
                    <button
                      onClick={handleRemoveBackground}
                      disabled={isApplyingSelectedClipEffect}
                      className={`w-full py-2 border rounded-lg text-[10px] transition-all ${
                        isApplyingSelectedClipEffect
                          ? "bg-background-tertiary border-border text-text-muted cursor-not-allowed"
                          : "bg-background-tertiary hover:bg-primary hover:text-white border-border hover:border-primary"
                      }`}
                    >
                      {t("inspector.removeBackground")}
                    </button>
                  )}
                  {showAudioEffects && (
                    <button
                      onClick={handleEnhanceAudio}
                      disabled={isEnhancingAudio || isApplyingSelectedClipEffect}
                      className={`w-full py-2 border rounded-lg text-[10px] transition-all flex items-center justify-center gap-1.5 ${
                        audioEnhanced
                          ? "bg-green-500/20 border-green-500 text-green-400"
                          : isEnhancingAudio || isApplyingSelectedClipEffect
                            ? "bg-background-tertiary border-border text-text-muted cursor-not-allowed"
                            : "bg-background-tertiary hover:bg-primary hover:text-white border-border hover:border-primary"
                      }`}
                    >
                      {isEnhancingAudio ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          {t("inspector.cleaningUp")}
                        </>
                      ) : audioEnhanced ? (
                        t("inspector.noiseReduced")
                      ) : (
                        t("inspector.quickDialogueCleanup")
                      )}
                    </button>
                  )}
                  {showVideoEffects && (
                    <button
                      onClick={handleAutoColor}
                      disabled={isApplyingSelectedClipEffect}
                      className={`w-full py-2 border rounded-lg text-[10px] transition-all ${
                        isApplyingSelectedClipEffect
                          ? "bg-background-tertiary border-border text-text-muted cursor-not-allowed"
                          : "bg-background-tertiary hover:bg-primary hover:text-white border-border hover:border-primary"
                      }`}
                    >
                      {isApplyingSelectedClipEffect ? t("inspector.applying") : t("inspector.autoColor")}
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
                <span className="text-xs font-bold text-primary">{t("inspector.subtitle")}</span>
              </div>
              <p className="text-[10px] text-text-muted">
                {selectedSubtitle.startTime.toFixed(2)}s -{" "}
                {selectedSubtitle.endTime.toFixed(2)}s
              </p>
            </div>

            {/* Subtitle Text Editor */}
            <Section title={t("inspector.textContent")}>
              <div className="space-y-3">
                <textarea
                  value={selectedSubtitle.text}
                  onChange={(e) =>
                    updateSubtitle(selectedSubtitle.id, {
                      text: e.target.value,
                    })
                  }
                  className="w-full h-24 px-3 py-2 bg-background-tertiary border border-border rounded-lg text-xs text-text-primary resize-none focus:outline-none focus:border-primary"
                  placeholder={t("inspector.enterSubtitle")}
                />
              </div>
            </Section>

            {/* Subtitle Timing */}
            <Section title={t("inspector.timing")}>
              <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-secondary">
                      {t("inspector.startTime")}
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
                    {t("inspector.endTime")}
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
            <Section title={t("inspector.position")}>
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
                    {pos === "top" ? t("inspector.top") : pos === "center" ? t("inspector.center") : t("inspector.bottom")}
                  </button>
                ))}
              </div>
            </Section>

            {/* Subtitle Animation Style */}
            <Section title={t("inspector.animation")}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">{t("inspector.style")}</span>
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
                    t("inspector.animationDescKaraoke")}
                  {selectedSubtitle.animationStyle === "word-highlight" &&
                    t("inspector.animationDescWordHighlight")}
                  {selectedSubtitle.animationStyle === "word-by-word" &&
                    t("inspector.animationDescWordByWord")}
                  {selectedSubtitle.animationStyle === "bounce" &&
                    t("inspector.animationDescBounce")}
                  {selectedSubtitle.animationStyle === "typewriter" &&
                    t("inspector.animationDescTypewriter")}
                  {(!selectedSubtitle.animationStyle ||
                    selectedSubtitle.animationStyle === "none") &&
                    t("inspector.animationDescNone")}
                </p>
                {selectedSubtitle.animationStyle &&
                  selectedSubtitle.animationStyle !== "none" &&
                  !selectedSubtitle.words?.length && (
                    <p className="text-[9px] text-amber-400 bg-amber-400/10 p-2 rounded">
                      {t("inspector.animationNoWordTiming")}
                    </p>
                  )}
                {selectedSubtitle.animationStyle &&
                  selectedSubtitle.animationStyle !== "none" &&
                  selectedSubtitle.animationStyle !== "typewriter" &&
                  selectedSubtitle.animationStyle !== "word-by-word" && (
                    <div className="pt-2 border-t border-border space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-text-secondary">
                          {t("inspector.highlightColor")}
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
            <Section title={t("inspector.font")}>
              <div className="space-y-3">
                <input
                  ref={subtitleFontInputRef}
                  type="file"
                  accept={FONT_FILE_ACCEPT}
                  onChange={handleSubtitleFontUpload}
                  className="hidden"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">
                    {t("inspector.fontFamily")}
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
                      {Object.entries(FONT_CATEGORIES).map(([category, fonts]) => (
                        <SelectGroup key={category}>
                          <SelectLabel className="text-text-muted text-[10px] font-medium">
                            {category}
                          </SelectLabel>
                          {fonts.map((font) => (
                            <SelectItem key={font} value={font} style={{ fontFamily: font }}>
                              {font}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                      {customFonts.length > 0 && (
                        <SelectGroup>
                          <SelectLabel className="text-text-muted text-[10px] font-medium">
                            {t("inspector.customUploads")}
                          </SelectLabel>
                          {customFonts.map((font) => (
                            <SelectItem key={font} value={font} style={{ fontFamily: font }}>
                              {font}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <button
                  onClick={() => subtitleFontInputRef.current?.click()}
                  className="w-full py-1.5 px-2 bg-background-secondary border border-border rounded text-[10px] text-text-secondary hover:text-text-primary transition-colors flex items-center justify-center gap-1.5"
                >
                  <Upload size={11} />
                  {t("inspector.uploadCustomFont")}
                </button>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">
                    {t("inspector.fontSize")}
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
            <Section title={t("inspector.colors")}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">
                    {t("inspector.textColor")}
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
                    {t("inspector.background")}
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
                        <SelectItem value="0">{t("inspector.none")}</SelectItem>
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
                {t("inspector.deleteSubtitle")}
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
