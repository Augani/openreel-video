import { formatFrameTimecode } from "../../utils/frame-timecode";
import { clipSourceTimecodeRange } from "../../services/source-timecode";
import { WorkspaceTabs, workspaceTabPanel } from "./WorkspacePrimitives";
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore, type SelectionItem } from "../../stores/ui-store";
import { InspectorSelectionProvider } from "./inspector/shell/InspectorSelection";
import { useEngineStore } from "../../stores/engine-store";
import type { Transform, EditingTemplatePrimitive } from "@openreel/core";
import {
  ChromaKeyEngine,
  getProjectClipCapabilities,
} from "@openreel/core";
import { mergeEditingTemplateControlValues } from "./panels/EditingTemplateControls";
import {
  getAudioBridgeEffects,
  initializeAudioBridgeEffects,
  DEFAULT_NOISE_REDUCTION,
} from "../../bridges/audio-bridge-effects";
import { toast } from "../../stores/notification-store";
import { getNoiseReductionPreset } from "./inspector/noise-reduction-presets";
import { ScrollArea } from "@openreel/ui";
import { SubtitleInspector } from "./inspector/SubtitleInspector";
import {
  getTabIdsForClipType,
  getInspectorTabOptions,
  getInspectorTabForSection,
  ANIMATION_SECTION_IDS,
  EFFECT_SECTION_IDS,
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
import { QuickEditBar } from "./QuickEditBar";
import { useInspectorNavigationStore } from "../../stores/inspector-navigation-store";
import { getTrackBadge } from "./timeline/track-badge";
import { resetClipTransform } from "../../services/reset-clip-transform";
import { GraphicInspector } from "./graphics/GraphicInspector";
import { selectedGraphicInstance } from "../../services/graphic-commands";
import { linkedInstanceOfBakedClip } from "@openreel/core";

const MultiCameraPanel = React.lazy(
  () => import("./inspector/MultiCameraPanel"),
);

// Initialize engines as singletons
const chromaKeyEngine = new ChromaKeyEngine({ width: 1920, height: 1080 });

const Section = InspectorSection;

const EmptyState: React.FC = () => (
  <div className="workspace-inspector-empty">
    <h2>Nothing selected</h2>
    <p>Select a clip, title or transition to edit it here.</p>
    <div className="workspace-shortcuts">
      <h3>KEYBOARD SHORTCUTS</h3>
      {[
        ["Play / pause", "Space"],
        ["Shuttle", "J K L"],
        ["Mark in / out", "I O"],
        ["Blade tool", "B"],
        ["Selection tool", "V"],
        ["Add marker", "M"],
        ["Undo", "⌘ Z"],
      ].map(([label, key]) => (
        <div key={label}>
          <span>{label}</span>
          <kbd>{key}</kbd>
        </div>
      ))}
    </div>
  </div>
);

interface InspectorPanelBodyProps {
  selectedItems: SelectionItem[];
}

const InspectorPanelBody = React.memo(function InspectorPanelBody({ selectedItems }: InspectorPanelBodyProps) {
  // Stores
  const {
    getClip,
    getClipTransition,
    updateClipTransition,
    removeClipTransition,
    importSRT,
    getSubtitle,
    getEditingTemplate,
    updateEditingTemplateApplication,
    removeEditingTemplateApplication,
  } = useProjectStore(
    useShallow((state) => ({
      getClip: state.getClip,
      getClipTransition: state.getClipTransition,
      updateClipTransition: state.updateClipTransition,
      removeClipTransition: state.removeClipTransition,
      importSRT: state.importSRT,
      getSubtitle: state.getSubtitle,
      getEditingTemplate: state.getEditingTemplate,
      updateEditingTemplateApplication: state.updateEditingTemplateApplication,
      removeEditingTemplateApplication: state.removeEditingTemplateApplication,
    })),
  );
  const project = useProjectStore((state) => state.project);
  const clearSelection = useUIStore((state) => state.clearSelection);
  const effectApplicationClipId = useUIStore(
    (state) => state.effectApplicationClipId,
  );
  const startEffectApplication = useUIStore(
    (state) => state.startEffectApplication,
  );
  const finishEffectApplication = useUIStore(
    (state) => state.finishEffectApplication,
  );
  const selectedClipIds = useMemo(
    () =>
      selectedItems
        .filter(
          (item) =>
            item.type === "clip" ||
            item.type === "text-clip" ||
            item.type === "shape-clip",
        )
        .map((item) => item.id),
    [selectedItems],
  );
  const pausePlayback = useTimelineStore((state) => state.pause);
  const lockPlayback = useTimelineStore((state) => state.lockPlayback);
  const unlockPlayback = useTimelineStore((state) => state.unlockPlayback);
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);

  const [expandedRecipeApplicationId, setExpandedRecipeApplicationId] =
    useState<string | null>(null);
  const [captionWordsPerLine, setCaptionWordsPerLine] = useState(5);
  const [recipeControlValues, setRecipeControlValues] = useState<
    Record<string, Record<string, EditingTemplatePrimitive>>
  >({});
  const srtInputRef = useRef<HTMLInputElement>(null);
  const selectionScope = JSON.stringify([project.id, selectedClipIds]);
  const navigationOwner = useRef(selectionScope);

  useEffect(() => {
    setExpandedRecipeApplicationId(null);
    if (navigationOwner.current !== selectionScope) {
      navigationOwner.current = selectionScope;
      useInspectorNavigationStore.getState().clearRequest();
    }
  }, [selectionScope]);

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
    () =>
      selectedTransition ? (getClip(selectedTransition.clipAId) ?? null) : null,
    [selectedTransition, getClip, project.modifiedAt],
  );
  const transitionClipB = useMemo(
    () =>
      selectedTransition?.clipBId
        ? (getClip(selectedTransition.clipBId) ?? null)
        : null,
    [selectedTransition, getClip, project.modifiedAt],
  );

  const selectedTimelineClip = useMemo(() => {
    if (selectedClipIds.length !== 1) return null;
    return getClip(selectedClipIds[0]) || null;
  }, [getClip, project, selectedClipIds]);

  // Get selected clip (check regular clips, text clips, and shape clips)
  const selectedClip = useMemo(() => {
    if (selectedClipIds.length !== 1) return null;
    const clipId = selectedClipIds[0];
    const titleEngine = getTitleEngine();
    const textClip = project.textClips?.find(clip => clip.id === clipId) ?? titleEngine?.getTextClip(clipId);
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
        effects: textClip.effects ?? [],
        text: textClip.text,
        trackId: textClip.trackId,
      };
    }
    const graphicsEngine = getGraphicsEngine();
    const shapeClip = project.shapeClips?.find(clip => clip.id === clipId) ?? graphicsEngine?.getShapeClip(clipId);
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
        effects: shapeClip.effects ?? [],
        shapeType: shapeClip.shapeType,
        trackId: shapeClip.trackId,
      };
    }
    const svgClip = project.svgClips?.find(clip => clip.id === clipId) ?? graphicsEngine?.getSVGClip(clipId);
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
        effects: svgClip.effects ?? [],
        svgContent: svgClip.svgContent,
        trackId: svgClip.trackId,
      };
    }
    const stickerClip = project.stickerClips?.find(clip => clip.id === clipId) ?? graphicsEngine?.getStickerClip(clipId);
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
        effects: stickerClip.effects ?? [],
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
    project,
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
  } = useProjectStore(
    useShallow((state) => ({
      addVideoEffect: state.addVideoEffect,
      updateVideoEffect: state.updateVideoEffect,
      getAudioEffects: state.getAudioEffects,
      updateAudioEffect: state.updateAudioEffect,
      toggleAudioEffect: state.toggleAudioEffect,
    })),
  );

  const [isEnhancingAudio, setIsEnhancingAudio] = useState(false);
  const [audioEnhanced, setAudioEnhanced] = useState(false);
  const isApplyingSelectedClipEffect =
    effectApplicationClipId !== null &&
    effectApplicationClipId === selectedClip?.id;

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
      // "project": the edit is a tracked project change (the render cache already
      // invalidated exactly its frames); "audio": no pixels change.
      // Default "engine": pixel state lives outside the project, flush render files.
      pixelScope: "engine" | "project" | "audio" = "engine",
    ) => {
      const store = useProjectStore.getState();
      const currentClip =
        store.getClip(clipId) ??
        store.getTextClip(clipId) ??
        store.getShapeClip(clipId) ??
        store.getSVGClip(clipId) ??
        store.getStickerClip(clipId);
      const track = store.project.timeline.tracks.find(
        (candidate) => candidate.id === currentClip?.trackId,
      );
      if (
        !currentClip ||
        !track ||
        track.locked ||
        useUIStore.getState().exportState.isExporting ||
        useUIStore.getState().effectApplicationClipId !== null ||
        useTimelineStore.getState().playbackLockedReason
      )
        return;
      const projectId = store.project.id;
      pausePlayback();
      lockPlayback(label);
      startEffectApplication(clipId, label);

      try {
        await waitForEffectApplicationPaint();
        if (useProjectStore.getState().project.id !== projectId) return;
        await apply();
        window.dispatchEvent(
          new CustomEvent(
            "openreel:preview-invalidate",
            pixelScope === "engine" ? undefined : { detail: { audioOnly: true } },
          ),
        );
        await waitForEffectApplicationPaint();
      } finally {
        if (useUIStore.getState().effectApplicationClipId === clipId) {
          finishEffectApplication();
          if (useTimelineStore.getState().playbackLockedReason === label)
            unlockPlayback();
        }
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
        "audio",
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
      "project",
    );
  }, [
    addVideoEffect,
    applyClipEffectWithPlaybackLock,
    selectedClip,
    updateVideoEffect,
  ]);

  const handleSRTImport = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const srtContent = await file.text();
        const result = await importSRT(srtContent, {
          sourceClipId: selectedTimelineClip?.id,
          maxWordsPerLine: captionWordsPerLine,
        });

        if (result.success) {
          if (result.errors.length > 0) {
            toast.warning(
              "Captions imported with warnings",
              `${result.errors.length} subtitle segment(s) were skipped.`,
            );
          } else {
            toast.success(
              "Captions imported",
              "Each cue is now an editable text clip on the Captions track.",
            );
          }
        } else {
          toast.error(
            "Caption import failed",
            result.errors[0] || "No valid captions found.",
          );
        }
      } catch {
        toast.error(
          "Caption import failed",
          "Could not read the selected subtitle file.",
        );
      } finally {
        event.target.value = "";
      }
    },
    [captionWordsPerLine, importSRT, selectedTimelineClip?.id],
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
  const tolerance = (chromaKeySettings?.tolerance ?? 0.3) * 100;

  /** Detect clip type from the selected item itself, not its owning track. */
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

    const mediaItem = project.mediaLibrary.items.find(
      (item) => item.id === selectedClip.mediaId,
    );

    if (mediaItem?.type === "audio") {
      return "audio";
    }

    if (mediaItem?.type === "image") {
      return "image";
    }

    return "video";
  }, [selectedClip, project.mediaLibrary.items]);

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
  const selectedMediaCapabilities = selectedTimelineClip
    ? getProjectClipCapabilities(project, selectedTimelineClip) : { visual: false, audio: false };
  const showAudioEffects =
    clipType === "audio" || selectedMediaCapabilities.audio;
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
    (
      applicationId: string,
      templateId: string,
      controlValues?: Record<string, unknown>,
    ) => {
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
    (
      applicationId: string,
      templateId: string,
      controlValues?: Record<string, unknown>,
    ) => {
      const template = getEditingTemplate(templateId);
      if (!template) {
        return;
      }

      setRecipeControlValues((current) => ({
        ...current,
        [applicationId]: mergeEditingTemplateControlValues(
          template,
          controlValues,
        ),
      }));
    },
    [getEditingTemplate],
  );
  const handleUpdateRecipeControls = useCallback(
    (
      applicationId: string,
      templateId: string,
      controlValues?: Record<string, unknown>,
    ) => {
      if (!selectedTimelineClip) {
        return;
      }

      const template = getEditingTemplate(templateId);
      if (!template) {
        toast.error(
          "Recipe unavailable",
          "This recipe definition is no longer available.",
        );
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
        toast.error(
          "Could not update recipe",
          "The recipe controls could not be saved for this clip.",
        );
        return;
      }

      toast.success(
        "Recipe updated",
        `${template.name} was updated on this clip.`,
      );
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

  const requestedSection = useInspectorNavigationStore((s) => s.request);
  const inspectorTabs = useMemo(() => getInspectorTabOptions(clipType as InspectorClipType | null), [clipType]);
  const inspectorScope = `${project.id}:${clipType ?? "none"}:${clipId}`;
  const [inspectorTabState, setInspectorTabState] = useState({ scope: "", value: "transform", effectsVisited: false });
  const selectInspectorTab = useCallback((value: string) => {
    setInspectorTabState(previous => ({ scope: inspectorScope, value,
      effectsVisited: value === "effects" || (previous.scope === inspectorScope && previous.effectsVisited) }));
  }, [inspectorScope]);
  useEffect(() => {
    setInspectorTabState(previous => previous.scope === inspectorScope ? previous
      : { scope: inspectorScope, value: inspectorTabs[0]?.value ?? "transform", effectsVisited: false });
  }, [inspectorScope, inspectorTabs]);
  useEffect(() => {
    if (!requestedSection || requestedSection.clipId !== clipId
      || useInspectorNavigationStore.getState().request !== requestedSection) return;
    const tab = getInspectorTabForSection(clipType as InspectorClipType | null, requestedSection.sectionId);
    if (tab) selectInspectorTab(tab);
  }, [requestedSection, clipId, clipType, selectInspectorTab]);
  const visibleInspectorTab = inspectorTabState.scope === inspectorScope && inspectorTabs.some(tab => tab.value === inspectorTabState.value)
    ? inspectorTabState.value : inspectorTabs[0]?.value ?? "transform";
  const hasEffectsTab = inspectorTabs.some(tab => tab.value === "effects");
  const mountGraphicEffects = !hasEffectsTab || visibleInspectorTab === "effects"
    || (inspectorTabState.scope === inspectorScope && inspectorTabState.effectsVisited);

  const effectsControls = tabIds.includes("effects") ? (
    <div
      className="workspace-inspector-effects-group"
      hidden={visibleInspectorTab !== (hasEffectsTab ? "effects" : "transform")}
    >
      <InspectorSection
        defaultOpen={hasEffectsTab}
        title={`Effects · ${(selectedClip?.effects?.length ?? 0) + (selectedTimelineClip?.colorGrading?.lut ? 1 : 0)}`}
        sectionId="effects-overview"
        sectionIds={[...EFFECT_SECTION_IDS, ...(showVideoControls ? ANIMATION_SECTION_IDS : [])]}
      >
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
          removeEditingTemplateApplication={
            removeEditingTemplateApplication
          }
          expandedRecipeApplicationId={
            expandedRecipeApplicationId
          }
          setExpandedRecipeApplicationId={
            setExpandedRecipeApplicationId
          }
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
        {showVideoControls && tabIds.includes("animate") && (
          <div
            hidden={
              !(
                visibleInspectorTab === "animate" ||
                visibleInspectorTab === "transform"
              )
            }
          >
            <AnimateTab
              clipId={clipId}
              clipType={clipType}
              showTextSection={showTextSection}
            />
          </div>
        )}
      </InspectorSection>
    </div>
  ) : null;

  // Essential Graphics: a selected graphic shows only the controls its author exposed.
  const graphicInstance =
    project.graphicInstances?.length && selectedClipIds.length > 0
      ? selectedGraphicInstance(project, selectedClipIds) ??
        // A rendered linked composition is an ordinary media clip; its inspector offers Restore Unrendered.
        selectedClipIds.map((id) => linkedInstanceOfBakedClip(project, id)).find((instance) => instance !== undefined)
      : undefined;
  if (graphicInstance) {
    return (
      <div data-tour="inspector" data-clip-type="graphic" className="w-full min-w-0 bg-bg-1 flex flex-col h-full overflow-hidden">
        <ScrollArea className="flex-1 min-h-0">
          <GraphicInspector key={graphicInstance.id} instance={graphicInstance} />
        </ScrollArea>
      </div>
    );
  }

  return (
    <div
      data-tour="inspector"
      data-clip-type={clipType ?? undefined}
      className="w-full min-w-0 bg-bg-1 flex flex-col h-full overflow-hidden"
    >
      {selectedTransition ? <h2 className="workspace-transition-heading">Transition</h2> : selectedClip && (
        <WorkspaceTabs
          label="Inspector sections"
          value={visibleInspectorTab}
          onChange={selectInspectorTab}
          options={inspectorTabs}
        />
      )}
      {selectedClip && tabIds.length > 0 && (
        <InspectorClipHeader
          name={
            project.mediaLibrary.items.find(
              (m) => m.id === selectedClip.mediaId,
            )?.name ??
            (typeof selectedTimelineClip?.metadata?.compoundClipName === "string" ? selectedTimelineClip.metadata.compoundClipName : undefined) ??
            (clipType === "text"
              ? `Title · ${useProjectStore.getState().getTextClip(clipId)?.text ?? "Text"}`
              : clipType
                ? clipType.charAt(0).toUpperCase() + clipType.slice(1)
                : "Clip")
          }
          durationSeconds={selectedClip.duration}
          typeLabel={clipType ?? "clip"}
          trackBadge={getTrackBadge(project.timeline.tracks, selectedClip.trackId)}
          thumbnailUrl={
            project.mediaLibrary.items.find(
              (m) => m.id === selectedClip.mediaId,
            )?.thumbnailUrl
          }
          timeRange={`${formatFrameTimecode(selectedClip.startTime ?? 0, project.settings.frameRate)} → ${formatFrameTimecode((selectedClip.startTime ?? 0) + selectedClip.duration, project.settings.frameRate)}`}
          sourceRange={clipSourceTimecodeRange(project.mediaLibrary.items.find((m) => m.id === selectedClip.mediaId), selectedClip)}
          onReset={clipType === "text" || clipType === "audio" ? undefined : () => { void resetClipTransform(selectedClip.id); }}
        />
      )}

      <ScrollArea className={`flex-1 min-h-0 ${selectedTransition ? "workspace-transition-scroll" : ""}`}>
        <div
          {...(selectedClip
            ? workspaceTabPanel("Inspector sections", visibleInspectorTab)
            : {})}
          className="workspace-inspector-content"
        >
          {visibleInspectorTab === "ai" &&
            selectedTimelineClip &&
            selectedClipIds.length === 1 && (
              <QuickEditBar
                clipId={selectedTimelineClip.id}
                onCleanAudio={handleEnhanceAudio}
                isCleaningAudio={isEnhancingAudio}
              />
            )}
          <div hidden={!selectedClip || visibleInspectorTab !== "ai"}>
            <Section title="Multi-Camera Editing" sectionId="multicam">
              <InspectorTabErrorBoundary>
                <React.Suspense
                  fallback={<p role="status">Loading camera tools…</p>}
                >
                  <MultiCameraPanel key={project.id} />
                </React.Suspense>
              </InspectorTabErrorBoundary>
            </Section>
          </div>
          {selectedClipIds.length > 1 ? (
            <MultiClipInspector clipIds={selectedClipIds} />
          ) : selectedClip ? (
            <InspectorTabErrorBoundary key={`${project.id}:${clipId}`}>
              <div className="workspace-inspector-tab-stack" data-clip-type={clipType}>
                {tabIds.includes("transform") && (
                  <div
                    className="workspace-inspector-transform-group"
                    hidden={!(visibleInspectorTab === "transform")}
                  >
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
                      afterPrimary={effectsControls}
                    />
                  </div>
                )}

                {tabIds.includes("style") && (
                  <div
                    hidden={
                      visibleInspectorTab !== "style"
                    }
                  >
                    <StyleTab
                      clipId={clipId}
                      showTextSection={showTextSection}
                      showShapeSection={showShapeSection}
                      showSVGSection={showSVGSection}
                    />
                  </div>
                )}

                {tabIds.includes("color") && (
                  <div hidden={!(visibleInspectorTab === "color")}>
                    <ColorTab
                      clipId={clipId}
                      showColorGrading={showColorGrading}
                    />
                  </div>
                )}

                {!showVideoControls && mountGraphicEffects && effectsControls}

                {tabIds.includes("audio") && (
                  <div hidden={!(visibleInspectorTab === "audio")}>
                    <AudioTab
                      clipId={clipId}
                      clipType={clipType}
                      showAudioEffects={showAudioEffects}
                      noiseReductionSectionTitle={noiseReductionSectionTitle}
                      selectedNoiseReductionEffect={
                        selectedNoiseReductionEffect
                      }
                    />
                  </div>
                )}

                {tabIds.includes("speed") && (
                  <div hidden={!(visibleInspectorTab === "speed")}>
                    <SpeedTab
                      showVideoControls={showVideoControls}
                      showSpeedControls={showVideoControls || clipType === "audio"}
                      selectedClip={selectedClip}
                    />
                  </div>
                )}

                {!showVideoControls && tabIds.includes("animate") && (
                  <div
                    hidden={
                      visibleInspectorTab !== "animate"
                    }
                  >
                    <AnimateTab
                      clipId={clipId}
                      clipType={clipType}
                      showTextSection={showTextSection}
                    />
                  </div>
                )}

                {tabIds.includes("ai") && (
                  <div hidden={!(visibleInspectorTab === "ai")}>
                    <AiTab
                      clipId={clipId}
                      clipType={clipType}
                      showVideoControls={showVideoControls}
                      showAudioEffects={showAudioEffects}
                      showVideoEffects={showVideoEffects}
                      handleSRTImport={handleSRTImport}
                      srtInputRef={srtInputRef}
                      handleRemoveBackground={handleRemoveBackground}
                      handleEnhanceAudio={handleEnhanceAudio}
                      handleAutoColor={handleAutoColor}
                      isEnhancingAudio={isEnhancingAudio}
                      audioEnhanced={audioEnhanced}
                      isApplyingSelectedClipEffect={
                        isApplyingSelectedClipEffect
                      }
                      captionWordsPerLine={captionWordsPerLine}
                      onCaptionWordsPerLineChange={setCaptionWordsPerLine}
                    />
                  </div>
                )}
              </div>
            </InspectorTabErrorBoundary>
          ) : selectedTransition && transitionClipA ? (
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
          ) : selectedSubtitle ? (
            <SubtitleInspector key={selectedSubtitle.id} subtitle={selectedSubtitle} />
          ) : (
            <EmptyState />
          )}
        </div>
      </ScrollArea>
    </div>
  );
});

export const InspectorPanel: React.FC = () => {
  // Deferred: the timeline paints the new selection first, the (large) inspector tree follows
  // in a low-priority pass that React can interrupt if another click arrives. The tree lives in a
  // memoised body fed the deferred value, so the urgent selection render stops at this shell
  // instead of re-running the whole inspector against the previous selection.
  const selectedItems = useDeferredValue(useUIStore((state) => state.selectedItems));
  return (
    <InspectorSelectionProvider value={selectedItems}>
      <InspectorPanelBody selectedItems={selectedItems} />
    </InspectorSelectionProvider>
  );
};

