import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import {
  Play,
  ArrowRight,
  ArrowLeft,
  Zap,
  RefreshCw,
  Check,
} from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useEngineStore } from "../../../stores/engine-store";
import { toast } from "../../../stores/notification-store";
import {
  getPresetLibrary,
  type MotionPreset,
  type PresetCategory,
} from "../../../services/motion-presets";
import type {
  Keyframe,
  EasingType,
  Transform,
  GraphicClip,
} from "@openreel/core";
import { v4 as uuid } from "uuid";

type MutableGraphicClip = {
  -readonly [K in keyof GraphicClip]: GraphicClip[K];
};

const CATEGORY_CONFIG: {
  id: PresetCategory;
  name: string;
  icon: React.ElementType;
}[] = [
  { id: "entrance", name: "In", icon: ArrowRight },
  { id: "exit", name: "Out", icon: ArrowLeft },
  { id: "emphasis", name: "Emphasis", icon: Zap },
  { id: "transition", name: "Transition", icon: RefreshCw },
];

function easingToType(easing: string): EasingType {
  const mappings: Record<string, EasingType> = {
    linear: "linear",
    ease: "ease-in-out",
    "ease-in": "ease-in",
    "ease-out": "ease-out",
    "ease-in-out": "ease-in-out",
    "ease-in-cubic": "ease-in",
    "ease-out-cubic": "ease-out",
    "ease-in-out-cubic": "ease-in-out",
    "ease-out-back": "ease-out",
    "ease-in-back": "ease-in",
  };
  return mappings[easing] || "ease-in-out";
}

interface CanvasDimensions {
  width: number;
  height: number;
}

function generateKeyframesFromPreset(
  preset: MotionPreset,
  clipDuration: number,
  baseTransform: Transform,
  category: PresetCategory,
  customDuration?: number,
  canvas?: CanvasDimensions,
): Keyframe[] {
  const keyframes: Keyframe[] = [];
  const presetDuration = customDuration || preset.duration;
  const prefix =
    category === "entrance"
      ? "motion-in"
      : category === "exit"
        ? "motion-out"
        : "motion-emphasis";

  let timeOffset = 0;
  if (category === "exit") {
    timeOffset = clipDuration - presetDuration;
  } else if (category === "emphasis") {
    timeOffset = (clipDuration - presetDuration) / 2;
  }

  const timeScale = customDuration ? customDuration / preset.duration : 1;
  const canvasWidth = canvas?.width || 1920;
  const canvasHeight = canvas?.height || 1080;

  for (const track of preset.tracks) {
    for (let i = 0; i < track.keyframes.length; i++) {
      const kf = track.keyframes[i];
      const time = Math.min(clipDuration, timeOffset + kf.time * timeScale);
      const easing = easingToType(kf.easing || "ease-out");
      let value = kf.value;

      if (track.relative) {
        switch (track.property) {
          case "position.x": {
            if (kf.value !== 0) {
              const direction = kf.value > 0 ? 1 : -1;
              const minOffset = canvasWidth + 100;
              value = baseTransform.position.x + direction * minOffset;
            } else {
              value = baseTransform.position.x;
            }
            break;
          }
          case "position.y": {
            if (kf.value !== 0) {
              const direction = kf.value > 0 ? 1 : -1;
              const minOffset = canvasHeight + 100;
              value = baseTransform.position.y + direction * minOffset;
            } else {
              value = baseTransform.position.y;
            }
            break;
          }
          case "rotation":
            value = baseTransform.rotation + kf.value;
            break;
        }
      } else if (track.property === "opacity" && kf.value === 1) {
        value = baseTransform.opacity;
      } else if (
        (track.property === "scale.x" || track.property === "scale") &&
        kf.value === 1
      ) {
        value = baseTransform.scale.x;
      } else if (track.property === "scale.y" && kf.value === 1) {
        value = baseTransform.scale.y;
      }

      keyframes.push({
        id: `${prefix}-${track.property}-${i}-${uuid().slice(0, 4)}`,
        time,
        property: track.property as Keyframe["property"],
        value,
        easing,
      });
    }
  }

  return keyframes;
}

function buildPreviewCSSKeyframes(preset: MotionPreset): globalThis.Keyframe[] {
  const keyframes: globalThis.Keyframe[] = [];
  const steps = 10;

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const time = progress * preset.duration;

    let opacity = 1;
    let translateX = 0;
    let translateY = 0;
    let scaleX = 1;
    let scaleY = 1;
    let rotation = 0;

    for (const track of preset.tracks) {
      let value = 0;
      const keyframesBefore = track.keyframes.filter((kf) => kf.time <= time);
      const keyframesAfter = track.keyframes.filter((kf) => kf.time > time);

      if (keyframesBefore.length > 0 && keyframesAfter.length > 0) {
        const before = keyframesBefore[keyframesBefore.length - 1];
        const after = keyframesAfter[0];
        const localProgress = (time - before.time) / (after.time - before.time);
        value = before.value + (after.value - before.value) * localProgress;
      } else if (keyframesBefore.length > 0) {
        value = keyframesBefore[keyframesBefore.length - 1].value;
      } else if (keyframesAfter.length > 0) {
        value = keyframesAfter[0].value;
      }

      switch (track.property) {
        case "opacity":
          opacity = value;
          break;
        case "position.x":
          translateX = value * 0.3;
          break;
        case "position.y":
          translateY = value * 0.3;
          break;
        case "scale":
        case "scale.x":
          scaleX = value;
          break;
        case "scale.y":
          scaleY = value;
          break;
        case "rotation":
          rotation = value;
          break;
      }
    }

    keyframes.push({
      opacity,
      transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY}) rotate(${rotation}deg)`,
      offset: progress,
    });
  }

  return keyframes;
}

interface PresetCardProps {
  preset: MotionPreset;
  isApplied: boolean;
  onApply: () => void;
}

const PresetCard: React.FC<PresetCardProps> = ({
  preset,
  isApplied,
  onApply,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<Animation | null>(null);

  useEffect(() => {
    if (!isHovered || !previewRef.current) {
      if (animationRef.current) {
        animationRef.current.cancel();
        animationRef.current = null;
      }
      return;
    }

    const element = previewRef.current;
    const keyframes = buildPreviewCSSKeyframes(preset);

    animationRef.current = element.animate(keyframes, {
      duration: preset.duration * 1000,
      iterations: Infinity,
      easing: "ease-in-out",
    });

    return () => {
      animationRef.current?.cancel();
    };
  }, [isHovered, preset]);

  return (
    <button
      onClick={onApply}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative w-full rounded-lg border transition-all overflow-hidden ${
        isApplied
          ? "border-primary bg-primary/10"
          : "border-border bg-background-tertiary hover:border-primary/50"
      }`}
    >
      <div className="relative h-20 bg-gradient-to-br from-background-secondary to-background-tertiary flex items-center justify-center overflow-hidden">
        <div
          ref={previewRef}
          className="w-10 h-10 rounded bg-primary/80 flex items-center justify-center"
        >
          <Play size={16} className="text-white" />
        </div>
        {isApplied && (
          <div className="absolute top-2 right-2">
            <Check size={14} className="text-primary" />
          </div>
        )}
        {isHovered && !isApplied && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <span className="text-[10px] text-white font-medium px-2 py-1 bg-primary rounded">
              Apply
            </span>
          </div>
        )}
      </div>
      <div className="p-2 text-left">
        <span className="text-[10px] font-medium text-text-primary block truncate">
          {preset.name}
        </span>
        <span className="text-[8px] text-text-muted">{preset.duration}s</span>
      </div>
    </button>
  );
};

interface ClipLike {
  id: string;
  duration: number;
  transform: Transform;
  keyframes?: Keyframe[];
}

interface MotionPresetsPanelProps {
  clipId?: string;
}

export const MotionPresetsPanel: React.FC<MotionPresetsPanelProps> = ({
  clipId,
}) => {
  const selectedClipIds = useUIStore((state) => state.getSelectedClipIds());
  const project = useProjectStore((state) => state.project);
  const updateClipKeyframes = useProjectStore(
    (state) => state.updateClipKeyframes,
  );
  const updateTextClipKeyframes = useProjectStore(
    (state) => state.updateTextClipKeyframes,
  );
  const getTextClip = useProjectStore((state) => state.getTextClip);
  const getShapeClip = useProjectStore((state) => state.getShapeClip);
  const getSVGClip = useProjectStore((state) => state.getSVGClip);
  const getStickerClip = useProjectStore((state) => state.getStickerClip);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);

  const [selectedCategory, setSelectedCategory] =
    useState<PresetCategory>("entrance");
  const customDurations: Record<string, number> = {};

  const targetClipId = clipId || selectedClipIds[0];
  const presetLibrary = useMemo(() => getPresetLibrary(), []);
  const presets = presetLibrary[selectedCategory] || [];

  const clip = useMemo((): { type: string; data: ClipLike } | null => {
    if (!targetClipId) return null;

    const regularClip = project.timeline.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === targetClipId);
    if (regularClip) return { type: "regular", data: regularClip as ClipLike };

    const textClip = getTextClip(targetClipId);
    if (textClip) return { type: "text", data: textClip as ClipLike };

    const shapeClip = getShapeClip(targetClipId);
    if (shapeClip) return { type: "shape", data: shapeClip as ClipLike };

    const svgClip = getSVGClip(targetClipId);
    if (svgClip) return { type: "svg", data: svgClip as ClipLike };

    const stickerClip = getStickerClip(targetClipId);
    if (stickerClip) return { type: "sticker", data: stickerClip as ClipLike };

    return null;
  }, [
    targetClipId,
    project.timeline.tracks,
    getTextClip,
    getShapeClip,
    getSVGClip,
    getStickerClip,
    project.modifiedAt,
  ]);

  const detectAppliedPresets = useCallback(() => {
    if (!clip) return { entrance: null, exit: null, emphasis: null };

    const keyframes = clip.data.keyframes || [];
    const hasIn = keyframes.some((kf) => kf.id.startsWith("motion-in-"));
    const hasOut = keyframes.some((kf) => kf.id.startsWith("motion-out-"));
    const hasEmphasis = keyframes.some((kf) =>
      kf.id.startsWith("motion-emphasis-"),
    );

    return {
      entrance: hasIn ? "applied" : null,
      exit: hasOut ? "applied" : null,
      emphasis: hasEmphasis ? "applied" : null,
    };
  }, [clip]);

  const appliedState = detectAppliedPresets();

  const handleApplyPreset = useCallback(
    (preset: MotionPreset) => {
      if (!clip || !targetClipId) return;

      const prefix =
        preset.category === "entrance"
          ? "motion-in-"
          : preset.category === "exit"
            ? "motion-out-"
            : "motion-emphasis-";

      const existingKeyframes = (clip.data.keyframes || []).filter(
        (kf) => !kf.id.startsWith(prefix),
      );

      const baseTransform = clip.data.transform || {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
        anchor: { x: 0.5, y: 0.5 },
      };

      const customDuration = customDurations[preset.id];
      const canvas = {
        width: project.settings.width,
        height: project.settings.height,
      };
      const newKeyframes = generateKeyframesFromPreset(
        preset,
        clip.data.duration,
        baseTransform,
        preset.category,
        customDuration,
        canvas,
      );

      const allKeyframes = [...existingKeyframes, ...newKeyframes];

      if (clip.type === "text") {
        updateTextClipKeyframes(targetClipId, allKeyframes);
      } else if (
        clip.type === "shape" ||
        clip.type === "svg" ||
        clip.type === "sticker"
      ) {
        const graphicsEngine = getGraphicsEngine();
        if (graphicsEngine) {
          const graphicsClip =
            clip.type === "shape"
              ? graphicsEngine.getShapeClip(targetClipId)
              : clip.type === "svg"
                ? graphicsEngine.getSVGClip(targetClipId)
                : graphicsEngine.getStickerClip(targetClipId);

          if (graphicsClip) {
            (graphicsClip as MutableGraphicClip).keyframes = allKeyframes;
            useProjectStore.setState((state) => ({
              project: { ...state.project, modifiedAt: Date.now() },
            }));
          }
        }
      } else {
        updateClipKeyframes(targetClipId, allKeyframes);
      }

      toast.success("Motion Preset Applied", `${preset.name} added to clip`);
    },
    [
      clip,
      targetClipId,
      customDurations,
      updateClipKeyframes,
      updateTextClipKeyframes,
      getGraphicsEngine,
      project.settings,
    ],
  );

  const handleRemovePresets = useCallback(
    (category: PresetCategory) => {
      if (!clip || !targetClipId) return;

      const prefix =
        category === "entrance"
          ? "motion-in-"
          : category === "exit"
            ? "motion-out-"
            : "motion-emphasis-";

      const filteredKeyframes = (clip.data.keyframes || []).filter(
        (kf) => !kf.id.startsWith(prefix),
      );

      if (clip.type === "text") {
        updateTextClipKeyframes(targetClipId, filteredKeyframes);
      } else if (
        clip.type === "shape" ||
        clip.type === "svg" ||
        clip.type === "sticker"
      ) {
        const graphicsEngine = getGraphicsEngine();
        if (graphicsEngine) {
          const graphicsClip =
            clip.type === "shape"
              ? graphicsEngine.getShapeClip(targetClipId)
              : clip.type === "svg"
                ? graphicsEngine.getSVGClip(targetClipId)
                : graphicsEngine.getStickerClip(targetClipId);

          if (graphicsClip) {
            (graphicsClip as MutableGraphicClip).keyframes = filteredKeyframes;
            useProjectStore.setState((state) => ({
              project: { ...state.project, modifiedAt: Date.now() },
            }));
          }
        }
      } else {
        updateClipKeyframes(targetClipId, filteredKeyframes);
      }

      toast.info("Preset Removed");
    },
    [
      clip,
      targetClipId,
      updateClipKeyframes,
      updateTextClipKeyframes,
      getGraphicsEngine,
    ],
  );

  if (!targetClipId) {
    return (
      <div className="p-4 text-center">
        <Zap size={24} className="mx-auto mb-2 text-text-muted" />
        <p className="text-[10px] text-text-muted">
          Select a clip to apply motion presets
        </p>
      </div>
    );
  }

  if (!clip) {
    return (
      <div className="p-4 text-center">
        <Zap size={24} className="mx-auto mb-2 text-text-muted" />
        <p className="text-[10px] text-text-muted">Clip not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Zap size={16} className="text-primary" />
        <div>
          <span className="text-[11px] font-medium text-text-primary">
            Motion Presets
          </span>
          <p className="text-[9px] text-text-muted">
            Animate clips with presets
          </p>
        </div>
      </div>

      {(appliedState.entrance ||
        appliedState.exit ||
        appliedState.emphasis) && (
        <div className="space-y-1 p-2 bg-background-tertiary rounded-lg border border-border">
          <span className="text-[10px] text-text-secondary font-medium">
            Applied Animations
          </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {appliedState.entrance && (
              <button
                onClick={() => handleRemovePresets("entrance")}
                className="flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-400 rounded text-[9px] hover:bg-green-500/30"
              >
                <ArrowRight size={10} />
                Entry ×
              </button>
            )}
            {appliedState.exit && (
              <button
                onClick={() => handleRemovePresets("exit")}
                className="flex items-center gap-1 px-2 py-1 bg-red-500/20 text-red-400 rounded text-[9px] hover:bg-red-500/30"
              >
                <ArrowLeft size={10} />
                Exit ×
              </button>
            )}
            {appliedState.emphasis && (
              <button
                onClick={() => handleRemovePresets("emphasis")}
                className="flex items-center gap-1 px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-[9px] hover:bg-yellow-500/30"
              >
                <Zap size={10} />
                Emphasis ×
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-1">
        {CATEGORY_CONFIG.map((category) => {
          const Icon = category.icon;
          const isApplied =
            (category.id === "entrance" && appliedState.entrance) ||
            (category.id === "exit" && appliedState.exit) ||
            (category.id === "emphasis" && appliedState.emphasis) ||
            (category.id === "transition" && appliedState.emphasis);

          return (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] whitespace-nowrap transition-colors relative ${
                selectedCategory === category.id
                  ? "bg-primary text-white font-medium"
                  : "bg-background-tertiary text-text-secondary hover:text-text-primary"
              }`}
            >
              <Icon size={12} />
              {category.name}
              {isApplied && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto">
        {presets.map((preset) => {
          const categoryKey =
            preset.category === "entrance"
              ? "entrance"
              : preset.category === "exit"
                ? "exit"
                : "emphasis";

          return (
            <PresetCard
              key={preset.id}
              preset={preset}
              isApplied={!!appliedState[categoryKey]}
              onApply={() => handleApplyPreset(preset)}
            />
          );
        })}
      </div>

      <p className="text-[9px] text-text-muted text-center">
        {presets.length} presets in {selectedCategory}
      </p>
    </div>
  );
};

export default MotionPresetsPanel;
