import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Captions, Shuffle } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useEngineStore } from "../../stores/engine-store";
import type { Transform, EditingTemplatePrimitive } from "@openreel/core";
import {
  ChromaKeyEngine,
  initializeTranscriptionService,
  type WhisperTranscriptionProgress,
  type CaptionAnimationStyle,
  CAPTION_ANIMATION_STYLES,
  getAnimationStyleDisplayName,
} from "@openreel/core";
import { OPENREEL_TRANSCRIBE_URL } from "../../config/api-endpoints";
import { mergeEditingTemplateControlValues } from "./panels/EditingTemplateControls";
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
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftFileDropControl as FileInput } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { ColorSelector } from "../../motion/components/primitives";
import {
  getTabIdsForClipType,
  type InspectorClipType,
} from "./inspector/clip-tabs.config";
import { InspectorClipHeader } from "./inspector/shell/InspectorClipHeader";
import { InspectorTabErrorBoundary } from "./inspector/shell/InspectorTabErrorBoundary";
import { InspectorSection } from "./inspector/shell/InspectorSection";
import { ColorTab } from "./inspector/tabs/ColorTab";
import { AudioTab } from "./inspector/tabs/AudioTab";
import { TransformTab } from "./inspector/tabs/TransformTab";
import { SpeedTab } from "./inspector/tabs/SpeedTab";
import { AnimateTab } from "./inspector/tabs/AnimateTab";
import { StyleTab } from "./inspector/tabs/StyleTab";
import { EffectsTab } from "./inspector/tabs/EffectsTab";
import { AiTab } from "./inspector/tabs/AiTab";
import { TransitionInspector } from "./inspector/TransitionInspector";
import { MultiClipInspector } from "./inspector/MultiClipInspector";

// Initialize engines as singletons
const chromaKeyEngine = new ChromaKeyEngine({ width: 1920, height: 1080 });

const Section = InspectorSection;

const componentToHex = (value: number): string =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");

const cssColorToHex = (value: string | undefined, fallback: string): string => {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      const [, r, g, b] = trimmed;
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return trimmed.toLowerCase();
  }

  const rgba = trimmed.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i,
  );
  if (!rgba) return fallback;

  return `#${componentToHex(Number(rgba[1]))}${componentToHex(
    Number(rgba[2]),
  )}${componentToHex(Number(rgba[3]))}`;
};

const cssColorAlpha = (
  value: string | undefined,
  fallback: "0" | "0.5" | "0.7" | "1" = "0.7",
): "0" | "0.5" | "0.7" | "1" => {
  const alpha = value?.match(/rgba?\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/i)?.[1];
  if (alpha === "0" || alpha === "0.5" || alpha === "0.7" || alpha === "1") {
    return alpha;
  }
  return fallback;
};

const rgbaFromHex = (hex: string, alpha: string): string => {
  const value = cssColorToHex(hex, "#000000");
  const r = parseInt(value.slice(1, 3), 16);
  const g = parseInt(value.slice(3, 5), 16);
  const b = parseInt(value.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const EmptyState: React.FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
    <Text type="body" weight="semibold" display="block" className="mb-1.5 text-sm text-fg">
      No selection
    </Text>
    <Text type="supporting" display="block" className="text-xs text-fg-muted">
      Select a clip to view its properties
    </Text>
  </div>
);

export const InspectorPanel: React.FC = () => {
  // Stores
  const {
    getClip,
    getClipTransition,
    updateClipTransition,
    removeClipTransition,
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
  const { getSelectedClipIds, clearSelection } = useUIStore();
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

  const selectedTransitionId = useMemo(() => {
    return selectedItems.find((item) => item.type === "transition")?.id ?? null;
  }, [selectedItems]);

  const selectedTransition = useMemo(() => {
    if (!selectedTransitionId) return null;
    return getClipTransition(selectedTransitionId) ?? null;
  }, [selectedTransitionId, getClipTransition, project.modifiedAt]);

  const transitionClipA = useMemo(
    () => (selectedTransition ? getClip(selectedTransition.clipAId) ?? null : null),
    [selectedTransition, getClip, project.modifiedAt],
  );
  const transitionClipB = useMemo(
    () =>
      selectedTransition?.clipBId
        ? getClip(selectedTransition.clipBId) ?? null
        : null,
    [selectedTransition, getClip, project.modifiedAt],
  );

  const selectedTimelineClip = useMemo(() => {
    if (selectedClipIds.length !== 1) return null;
    return getClip(selectedClipIds[0]) || null;
  }, [getClip, project.modifiedAt, selectedClipIds]);

  // Get selected clip (check regular clips, text clips, and shape clips)
  const selectedClip = useMemo(() => {
    if (selectedClipIds.length !== 1) return null;
    const clipId = selectedClipIds[0];
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
    return getClip(clipId) ?? null;
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
  const updateTextTransform = useProjectStore(
    (state) => state.updateTextTransform,
  );
  const updateShapeTransform = useProjectStore(
    (state) => state.updateShapeTransform,
  );

  // Transform handlers
  const handleTransformChange = useCallback(
    (changes: Partial<Transform>) => {
      if (!selectedClip) return;
      const titleEngine = getTitleEngine();
      const graphicsEngine = getGraphicsEngine();
      if (titleEngine?.getTextClip(selectedClip.id)) {
        updateTextTransform(selectedClip.id, changes);
        return;
      }
      if (
        graphicsEngine?.getShapeClip(selectedClip.id) ||
        graphicsEngine?.getSVGClip(selectedClip.id) ||
        graphicsEngine?.getStickerClip(selectedClip.id)
      ) {
        updateShapeTransform(selectedClip.id, changes);
        return;
      }
      void updateClipTransform(selectedClip.id, changes);
    },
    [
      getGraphicsEngine,
      getTitleEngine,
      selectedClip,
      updateClipTransform,
      updateShapeTransform,
      updateTextTransform,
    ],
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
      "Applying background removal",
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
        "Applying audio cleanup",
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
            await updateAudioEffect(
              selectedClip.id,
              existingNoiseReduction.id,
              noiseCleanupConfig as unknown as Record<string, unknown>,
            );
            await toggleAudioEffect(
              selectedClip.id,
              existingNoiseReduction.id,
              true,
            );
          } else {
            const result = bridge.applyNoiseReduction(
              selectedClip.id,
              noiseCleanupConfig,
            );

            if (!result.success) {
              throw new Error(result.error ?? "Failed to apply noise cleanup");
            }
          }

          setAudioEnhanced(true);
          setTimeout(() => setAudioEnhanced(false), 2000);
          toast.success(
            "Noise cleanup applied",
            "Fine-tune or switch presets in Background Noise Removal.",
          );

          forceUpdate();
        },
      );
    } catch (error) {
      console.error("Failed to enhance audio:", error);
      toast.error(
        "Could not clean up audio",
        error instanceof Error
          ? error.message
          : "Noise cleanup could not be applied to this clip.",
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
      "Applying auto color",
      async () => {
        const satEffect = await addVideoEffect(selectedClip.id, "saturation");
        const contEffect = await addVideoEffect(selectedClip.id, "contrast");
        const brightEffect = await addVideoEffect(
          selectedClip.id,
          "brightness",
        );
        if (satEffect) {
          await updateVideoEffect(selectedClip.id, satEffect.id, {
            value: 1.15,
          });
        }
        if (contEffect) {
          await updateVideoEffect(selectedClip.id, contEffect.id, {
            value: 1.1,
          });
        }
        if (brightEffect) {
          await updateVideoEffect(selectedClip.id, brightEffect.id, {
            value: 5,
          });
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
      message: "Preparing audio...",
    });

    try {
      const transcriptionService = initializeTranscriptionService({
        apiEndpoint: `${OPENREEL_TRANSCRIBE_URL}/transcribe`,
        targetLanguage: targetLanguage !== "none" ? targetLanguage : undefined,
      });

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
              "SRT imported with warnings",
              `${result.errors.length} subtitle segment(s) were skipped.`,
            );
          } else {
            toast.success("SRT imported", "Subtitles were added to the Captions track.");
          }
        } else {
          toast.error("SRT import failed", result.errors[0] || "No valid subtitles found.");
        }
      } catch {
        toast.error("SRT import failed", "Could not read the selected subtitle file.");
      } finally {
        event.target.value = "";
      }
    },
    [importSRT],
  );

  const handleSubtitleFontUpload = useCallback(
    async (file: File) => {
      if (!file || !selectedSubtitle) return;

      const result = await registerCustomFont(file);
      if (!result.success) {
        toast.error("Font upload failed", result.error ?? "Unknown error.");
      } else {
        updateSubtitle(selectedSubtitle.id, {
          style: {
            ...(selectedSubtitle.style || {}),
            fontFamily: result.fontFamily,
          } as typeof selectedSubtitle.style,
        });
        toast.success("Custom font uploaded", `${result.fontFamily} is ready to use.`);
      }
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
  const showVideoEffects =
    clipType === "video" ||
    clipType === "image" ||
    clipType === "text" ||
    clipType === "shape" ||
    clipType === "svg" ||
    clipType === "sticker";
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
      ? "Background Noise Removal (Active)"
      : "Background Noise Removal (Configured)"
    : "Background Noise Removal";
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
        toast.error("Recipe unavailable", "This recipe definition is no longer available.");
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
        toast.error("Could not update recipe", "The recipe controls could not be saved for this clip.");
        return;
      }

      toast.success("Recipe updated", `${template.name} was updated on this clip.`);
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

  const tabIds = useMemo(
    () => getTabIdsForClipType(clipType as InspectorClipType | null),
    [clipType],
  );

  return (
    <div
      data-tour="inspector"
      className="w-full min-w-0 bg-bg-1 flex flex-col h-full overflow-hidden"
    >
      {selectedClip && tabIds.length > 0 && (
        <InspectorClipHeader
          name={
            project.mediaLibrary.items.find(
              (m) => m.id === selectedClip.mediaId,
            )?.name ??
            (clipType
              ? clipType.charAt(0).toUpperCase() + clipType.slice(1)
              : "Clip")
          }
          durationSeconds={selectedClip.duration}
          typeLabel={clipType ?? "clip"}
        />
      )}

      <div className="overflow-y-auto flex-1 min-h-0 custom-scrollbar">
      <div className="py-[18px] px-5">
        {selectedClipIds.length > 1 ? (
          <MultiClipInspector clipIds={selectedClipIds} />
        ) : selectedClip ? (
          <InspectorTabErrorBoundary key={clipId}>
            <div className="space-y-4">
              {tabIds.includes("transform") && (
                <TransformTab
                  clipId={clipId}
                  clipType={clipType}
                  selectedClip={selectedClip}
                  showTransformControls={showTransformControls}
                  showVideoControls={showVideoControls}
                  transform={transform}
                  canvasWidth={project.settings.width}
                  canvasHeight={project.settings.height}
                  handleTransformChange={handleTransformChange}
                />
              )}

              {tabIds.includes("style") && (
                <StyleTab
                  clipId={clipId}
                  showTextSection={showTextSection}
                  showShapeSection={showShapeSection}
                  showSVGSection={showSVGSection}
                />
              )}

              {tabIds.includes("color") && (
                <ColorTab clipId={clipId} showColorGrading={showColorGrading} />
              )}

              {tabIds.includes("effects") && (
                <EffectsTab
                  clipId={clipId}
                  clipType={clipType}
                  selectedClip={selectedClip}
                  selectedTimelineClip={selectedTimelineClip}
                  showVideoControls={showVideoControls}
                  showVideoEffects={showVideoEffects}
                  showTextSection={showTextSection}
                  appliedEditingTemplates={appliedEditingTemplates}
                  getEditingTemplate={getEditingTemplate}
                  removeEditingTemplateApplication={removeEditingTemplateApplication}
                  expandedRecipeApplicationId={expandedRecipeApplicationId}
                  setExpandedRecipeApplicationId={setExpandedRecipeApplicationId}
                  recipeControlValues={recipeControlValues}
                  setRecipeControlValues={setRecipeControlValues}
                  handleRecipeControlChange={handleRecipeControlChange}
                  handleToggleRecipeControls={handleToggleRecipeControls}
                  handleResetRecipeControls={handleResetRecipeControls}
                  handleUpdateRecipeControls={handleUpdateRecipeControls}
                  chromaKeyEnabled={chromaKeyEnabled}
                  keyColor={keyColor}
                  tolerance={tolerance}
                  handleChromaKeyToggle={handleChromaKeyToggle}
                  handleKeyColorChange={handleKeyColorChange}
                  handleToleranceChange={handleToleranceChange}
                />
              )}

              {tabIds.includes("audio") && (
                <AudioTab
                  clipId={clipId}
                  clipType={clipType}
                  showAudioEffects={showAudioEffects}
                  noiseReductionSectionTitle={noiseReductionSectionTitle}
                  selectedNoiseReductionEffect={selectedNoiseReductionEffect}
                />
              )}

              {tabIds.includes("speed") && (
                <SpeedTab
                  showVideoControls={showVideoControls}
                  selectedClip={selectedClip}
                />
              )}

              {tabIds.includes("animate") && (
                <AnimateTab
                  clipId={clipId}
                  clipType={clipType}
                  showTextSection={showTextSection}
                />
              )}

              {tabIds.includes("ai") && (
                <AiTab
                  clipId={clipId}
                  clipType={clipType}
                  showVideoControls={showVideoControls}
                  showAudioEffects={showAudioEffects}
                  showVideoEffects={showVideoEffects}
                  transcriptionProgress={transcriptionProgress}
                  isTranscribing={isTranscribing}
                  targetLanguage={targetLanguage}
                  setTargetLanguage={setTargetLanguage}
                  defaultAnimationStyle={defaultAnimationStyle}
                  setDefaultAnimationStyle={setDefaultAnimationStyle}
                  handleGenerateSubtitles={handleGenerateSubtitles}
                  handleSRTImport={handleSRTImport}
                  srtInputRef={srtInputRef}
                  handleRemoveBackground={handleRemoveBackground}
                  handleEnhanceAudio={handleEnhanceAudio}
                  handleAutoColor={handleAutoColor}
                  isEnhancingAudio={isEnhancingAudio}
                  audioEnhanced={audioEnhanced}
                  isApplyingSelectedClipEffect={isApplyingSelectedClipEffect}
                />
              )}
            </div>
          </InspectorTabErrorBoundary>
        ) : selectedTransition && transitionClipA ? (
          <div className="space-y-3">
            <Card variant="green" padding={3} className="rounded-lg border border-accent/30 bg-accent-soft">
              <div className="flex items-center gap-2">
                <Shuffle size={14} className="text-accent" aria-hidden />
                <Text type="supporting" weight="bold" className="text-fg">
                  {selectedTransition.edge === "in"
                    ? "Intro Transition"
                    : selectedTransition.edge === "out"
                      ? "Outro Transition"
                      : "Transition"}
                </Text>
              </div>
              <Text type="supporting" display="block" className="mt-1 text-[10px] text-fg-3">
                {selectedTransition.edge === "in"
                  ? "From the project background into this clip"
                  : selectedTransition.edge === "out"
                    ? "From this clip into the project background"
                    : "Between two clips - centered on the cut"}
              </Text>
            </Card>
            <TransitionInspector
              clipA={transitionClipA}
              clipB={transitionClipB ?? undefined}
              edge={selectedTransition.edge}
              transition={selectedTransition}
              onTransitionUpdate={(id, updates) => {
                void updateClipTransition(id, updates);
              }}
              onTransitionRemove={(id) => {
                void removeClipTransition(id);
                clearSelection();
              }}
            />
          </div>
        ) : selectedSubtitle ? (
          <>
            {/* Subtitle Info */}
            <Card variant="green" padding={3} className="mb-4 rounded-lg border border-accent/30 bg-accent-soft">
              <div className="flex items-center gap-2 mb-1">
                <Captions size={14} className="text-accent" aria-hidden />
                <Text type="supporting" weight="bold" className="text-accent">
                  Subtitle
                </Text>
              </div>
              <Text type="supporting" display="block" className="text-[10px] text-fg-3">
                {selectedSubtitle.startTime.toFixed(2)}s -{" "}
                {selectedSubtitle.endTime.toFixed(2)}s
              </Text>
            </Card>

            {/* Subtitle Text Editor */}
            <Section title="Text Content">
              <div className="space-y-3">
                <ToolcraftTextAreaControl
                  label="Subtitle text"
                  isLabelHidden
                  value={selectedSubtitle.text}
                  onChange={(text) =>
                    updateSubtitle(selectedSubtitle.id, {
                      text,
                    })
                  }
                  rows={4}
                  placeholder="Enter subtitle text..."
                  width="100%"
                />
              </div>
            </Section>

            {/* Subtitle Timing */}
            <Section title="Timing">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    Start Time
                  </Text>
                  <ToolcraftNumberInputControl
                    label="Start Time"
                    isLabelHidden
                    step={0.1}
                    value={selectedSubtitle.startTime}
                    onChange={(value) =>
                      updateSubtitle(selectedSubtitle.id, {
                        startTime: value || 0,
                      })
                    }
                    size="sm"
                    width={80}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    End Time
                  </Text>
                  <ToolcraftNumberInputControl
                    label="End Time"
                    isLabelHidden
                    step={0.1}
                    value={selectedSubtitle.endTime}
                    onChange={(value) =>
                      updateSubtitle(selectedSubtitle.id, {
                        endTime: value || 0,
                      })
                    }
                    size="sm"
                    width={80}
                  />
                </div>
              </div>
            </Section>

            {/* Subtitle Position */}
            <Section title="Position">
              <div className="grid grid-cols-3 gap-2">
                {(["top", "center", "bottom"] as const).map((pos) => (
                  <SelectableCard
                    key={pos}
                    label={pos}
                    isSelected={(selectedSubtitle.style?.position || "bottom") === pos}
                    onChange={() =>
                      updateSubtitle(selectedSubtitle.id, {
                        style: {
                          ...(selectedSubtitle.style || {}),
                          position: pos,
                        } as typeof selectedSubtitle.style,
                      })
                    }
                    padding={2}
                    variant={(selectedSubtitle.style?.position || "bottom") === pos ? "green" : "muted"}
                    className="text-center capitalize"
                  >
                    {pos}
                  </SelectableCard>
                ))}
              </div>
            </Section>

            {/* Subtitle Animation Style */}
            <Section title="Animation">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    Style
                  </Text>
                  <Selector
                    label="Animation style"
                    isLabelHidden
                    value={selectedSubtitle.animationStyle || "none"}
                    onChange={(v) =>
                      updateSubtitle(selectedSubtitle.id, {
                        animationStyle: v as CaptionAnimationStyle,
                      })
                    }
                    options={CAPTION_ANIMATION_STYLES.map((style) => ({
                      value: style,
                      label: getAnimationStyleDisplayName(style),
                    }))}
                    size="sm"
                    width={140}
                  />
                </div>
                <Text type="supporting" color="secondary" display="block" className="text-[9px]">
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
                </Text>
                {selectedSubtitle.animationStyle &&
                  selectedSubtitle.animationStyle !== "none" &&
                  !selectedSubtitle.words?.length && (
                    <Card variant="muted" padding={2} className="bg-amber-400/10">
                      <Text type="supporting" display="block" className="text-[9px] text-amber-400">
                      No word-level timing data. Re-generate captions to
                      enable animation.
                      </Text>
                    </Card>
                  )}
                {selectedSubtitle.animationStyle &&
                  selectedSubtitle.animationStyle !== "none" &&
                  selectedSubtitle.animationStyle !== "typewriter" &&
                  selectedSubtitle.animationStyle !== "word-by-word" && (
                    <div className="pt-2 border-t border-border space-y-2">
                      <div className="flex items-center justify-between">
                        <Text type="supporting" color="secondary" className="text-[10px]">
                          Highlight Color
                        </Text>
                        <div className="flex items-center gap-2">
                          <ColorSelector
                            value={
                              selectedSubtitle.style?.highlightColor ||
                              "#ffff00"
                            }
                            label="Select highlight color"
                            onChange={(highlightColor) =>
                              updateSubtitle(selectedSubtitle.id, {
                                style: {
                                  ...(selectedSubtitle.style || {}),
                                  highlightColor,
                                } as typeof selectedSubtitle.style,
                              })
                            }
                          />
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
                          <Button
                            key={color}
                            label={color}
                            onClick={() =>
                              updateSubtitle(selectedSubtitle.id, {
                                style: {
                                  ...(selectedSubtitle.style || {}),
                                  highlightColor: color,
                                } as typeof selectedSubtitle.style,
                              })
                            }
                            variant="ghost"
                            size="sm"
                            className={`h-6 w-6 rounded border-2 p-0 transition-transform hover:scale-110 ${
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
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    Font Family
                  </Text>
                  <Selector
                    label="Font family"
                    isLabelHidden
                    value={selectedSubtitle.style?.fontFamily || "Inter"}
                    onChange={(v) =>
                      updateSubtitle(selectedSubtitle.id, {
                        style: {
                          ...(selectedSubtitle.style || {}),
                          fontFamily: v,
                        } as typeof selectedSubtitle.style,
                      })
                    }
                    options={[
                      ...Object.entries(FONT_CATEGORIES).flatMap(([category, fonts]) =>
                        fonts.map((font) => ({
                          value: font,
                          label: `${font} (${category})`,
                        })),
                      ),
                      ...customFonts.map((font) => ({
                        value: font,
                        label: `${font} (Custom)`,
                      })),
                    ]}
                    size="sm"
                    width={160}
                  />
                </div>
                <FileInput
                  label="Upload Custom Font"
                  isLabelHidden
                  value={null}
                  onChange={(picked) => {
                    if (picked instanceof File) {
                      void handleSubtitleFontUpload(picked);
                    }
                  }}
                  accept={FONT_FILE_ACCEPT}
                  mode="input"
                  placeholder="Upload Custom Font"
                  width="100%"
                />
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    Font Size
                  </Text>
                  <ToolcraftNumberInputControl
                    label="Font Size"
                    isLabelHidden
                    min={12}
                    max={72}
                    value={selectedSubtitle.style?.fontSize || 24}
                    onChange={(value) =>
                      updateSubtitle(selectedSubtitle.id, {
                        style: {
                          ...(selectedSubtitle.style || {}),
                          fontSize: value || 24,
                        } as typeof selectedSubtitle.style,
                      })
                    }
                    size="sm"
                    width={80}
                  />
                </div>
              </div>
            </Section>

            {/* Subtitle Colors */}
            <Section title="Colors">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    Text Color
                  </Text>
                  <div className="flex items-center gap-2">
                    <ColorSelector
                      value={selectedSubtitle.style?.color || "#ffffff"}
                      label="Select subtitle text color"
                      onChange={(color) =>
                        updateSubtitle(selectedSubtitle.id, {
                          style: {
                            ...(selectedSubtitle.style || {}),
                            color,
                          } as typeof selectedSubtitle.style,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    Background
                  </Text>
                  <div className="flex items-center gap-2">
                    <ColorSelector
                      value={cssColorToHex(
                        selectedSubtitle.style?.backgroundColor,
                        "#000000",
                      )}
                      label="Select subtitle background color"
                      onChange={(hex) => {
                        updateSubtitle(selectedSubtitle.id, {
                          style: {
                            ...(selectedSubtitle.style || {}),
                            backgroundColor: rgbaFromHex(
                              hex,
                              cssColorAlpha(
                                selectedSubtitle.style?.backgroundColor,
                              ),
                            ),
                          } as typeof selectedSubtitle.style,
                        });
                      }}
                    />
                    <Selector
                      label="Background opacity"
                      isLabelHidden
                      value={
                        cssColorAlpha(selectedSubtitle.style?.backgroundColor)
                      }
                      onChange={(v) => {
                        const nextAlpha = v as "0" | "0.5" | "0.7" | "1";
                        const newBg = rgbaFromHex(
                          cssColorToHex(
                            selectedSubtitle.style?.backgroundColor,
                            "#000000",
                          ),
                          nextAlpha,
                        );
                        updateSubtitle(selectedSubtitle.id, {
                          style: {
                            ...(selectedSubtitle.style || {}),
                            backgroundColor: newBg,
                          } as typeof selectedSubtitle.style,
                        });
                      }}
                      options={[
                        { value: "0", label: "None" },
                        { value: "0.5", label: "50%" },
                        { value: "0.7", label: "70%" },
                        { value: "1", label: "100%" },
                      ]}
                      size="sm"
                      width={80}
                    />
                  </div>
                </div>
              </div>
            </Section>

            {/* Delete Subtitle */}
            <div className="pt-4 border-t border-border">
              <Button
                label="Delete Subtitle"
                onClick={() => {
                  const { removeSubtitle } = useProjectStore.getState();
                  removeSubtitle(selectedSubtitle.id);
                }}
                variant="destructive"
                className="w-full border border-red-500/30 bg-red-500/20 text-red-400 hover:bg-red-500/30"
              />
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </div>
      </div>
    </div>
  );
};

export default InspectorPanel;
