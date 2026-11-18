import React, { memo, useCallback, useMemo } from "react";
import { Button, cn } from "@openreel/ui";


import { RotateCcw, Target, Zap, Clock } from "@/icons/lucide-compat";
import { InlineSlider, InspectorToggle } from "./shell/InspectorControls";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import { DEFAULT_TEXT_STYLE, type EmphasisAnimation, type EmphasisAnimationType } from "@openreel/core";
import {
  EffectLivePreview,
  EffectPreviewProvider,
  useLivePreviewActivity,
} from "../panels/effect-previews/EffectLivePreview";
import { emphasisPreviewDef, type PreviewTextSource } from "../panels/effect-previews/kind-defs";

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return mins > 0 ? `${mins}:${secs.padStart(4, "0")}` : `${secs}s`;
};

interface EmphasisAnimationSectionProps {
  clipId: string;
}

const EMPHASIS_ANIMATIONS: {
  category: string;
  animations: {
    type: EmphasisAnimationType;
    label: string;
    description: string;
  }[];
}[] = [
  {
    category: "Attention",
    animations: [
      {
        type: "pulse",
        label: "Pulse",
        description: "Gentle scale breathing effect",
      },
      {
        type: "heartbeat",
        label: "Heartbeat",
        description: "Double-beat pulse like a heart",
      },
      { type: "flash", label: "Flash", description: "Opacity pulsing effect" },
      { type: "glow", label: "Glow", description: "Scale and opacity pulse" },
      {
        type: "breathe",
        label: "Breathe",
        description: "Slow, calming scale effect",
      },
    ],
  },
  {
    category: "Movement",
    animations: [
      {
        type: "shake",
        label: "Shake",
        description: "Quick side-to-side shake",
      },
      { type: "bounce", label: "Bounce", description: "Bouncing up and down" },
      { type: "float", label: "Float", description: "Gentle floating motion" },
      {
        type: "vibrate",
        label: "Vibrate",
        description: "Random small movements",
      },
      { type: "wave", label: "Wave", description: "Wave-like motion" },
    ],
  },
  {
    category: "Rotation",
    animations: [
      { type: "spin", label: "Spin", description: "Continuous rotation" },
      { type: "swing", label: "Swing", description: "Pendulum-like rotation" },
      {
        type: "wobble",
        label: "Wobble",
        description: "Wobbling with rotation",
      },
      { type: "tilt", label: "Tilt", description: "Slow tilting motion" },
      { type: "tada", label: "Tada", description: "Attention-grabbing wiggle" },
    ],
  },
  {
    category: "Distortion",
    animations: [
      {
        type: "jello",
        label: "Jello",
        description: "Jelly-like squish effect",
      },
      {
        type: "rubber-band",
        label: "Rubber Band",
        description: "Stretchy rubber effect",
      },
      {
        type: "flicker",
        label: "Flicker",
        description: "Random visibility flicker",
      },
    ],
  },
  {
    category: "Zoom & Pan",
    animations: [
      {
        type: "zoom-pulse",
        label: "Zoom Pulse",
        description: "Scale in and out",
      },
      {
        type: "focus-zoom",
        label: "Focus Zoom",
        description: "Zoom to point and back",
      },
      {
        type: "ken-burns",
        label: "Ken Burns",
        description: "Slow zoom with pan",
      },
      {
        type: "pan-left",
        label: "Pan Left",
        description: "Slow pan to the left",
      },
      {
        type: "pan-right",
        label: "Pan Right",
        description: "Slow pan to the right",
      },
      { type: "pan-up", label: "Pan Up", description: "Slow pan upward" },
      { type: "pan-down", label: "Pan Down", description: "Slow pan downward" },
    ],
  },
];

const DEFAULT_EMPHASIS: EmphasisAnimation = {
  type: "none",
  speed: 1,
  intensity: 1,
  loop: true,
};

/** The animation a tile shows: its own type with the speed / intensity the clip uses, and the defaults "apply" sets. */
function tileAnimation(type: EmphasisAnimationType, current: EmphasisAnimation): EmphasisAnimation {
  const base = { ...current, type };
  if (type === "focus-zoom") return { ...base, focusPoint: { x: 0.5, y: 0.5 }, zoomScale: 1.5, holdDuration: 0.3, loop: false };
  if (type === "ken-burns") return { ...base, loop: false };
  return base;
}

const EmphasisTile = memo(function EmphasisTile({
  label,
  type,
  current,
  selected,
  source,
  onSelect,
}: {
  label: string;
  type: EmphasisAnimationType;
  current: EmphasisAnimation;
  selected: boolean;
  source: PreviewTextSource | null;
  onSelect: (type: EmphasisAnimationType) => void;
}) {
  const { active, handlers } = useLivePreviewActivity();
  const def = useMemo(() => emphasisPreviewDef(tileAnimation(type, current), source), [type, current, source]);
  return (
    <Button
      variant="ghost"
      onClick={() => onSelect(type)}
      type="button"
      aria-label={label}
      aria-pressed={selected}
      {...handlers}
      className={cn(
        "block h-auto min-w-0 overflow-hidden whitespace-normal rounded-lg border p-1.5 text-left text-[10px] font-normal transition-colors",
        selected ? "border-primary bg-primary/10 text-fg" : "border-border bg-bg-2 text-fg-2 hover:border-primary/50 hover:text-fg",
      )}
    >
      <span data-emphasis-preview={type} aria-hidden="true" className="relative mb-1.5 block aspect-video overflow-hidden rounded-md bg-bg-3">
        <EffectLivePreview def={def} active={active} />
      </span>
      <span className="block truncate font-semibold">{label}</span>
    </Button>
  );
});

const Slider: React.FC<{
  ariaLabel: string;
  min: number;
  max: number;
  step?: number;
  value: number[];
  onValueChange: (value: number[]) => void;
}> = ({ ariaLabel, min, max, step = 1, value, onValueChange }) => (
  <InlineSlider
    ariaLabel={ariaLabel}
    min={min}
    max={max}
    step={step}
    value={value[0]}
    onChange={(nextValue: number) => onValueChange([nextValue])}
  />
);

const ValueText: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-fg font-normal font-mono text-[10px] bg-bg-2 px-1.5 py-0.5 rounded border border-border"
  >
    {children as any}
  </span>
);

export const EmphasisAnimationSection: React.FC<
  EmphasisAnimationSectionProps
> = ({ clipId }) => {
  const { project, updateClipEmphasisAnimation } = useProjectStore();
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);
  const previewText = useProjectStore((state) => state.project.textClips?.find((clip) => clip.id === clipId)?.text);
  const previewStyle = useProjectStore((state) => state.project.textClips?.find((clip) => clip.id === clipId)?.style);
  const previewTransform = useProjectStore((state) => state.project.textClips?.find((clip) => clip.id === clipId)?.transform);
  const previewSource = useMemo<PreviewTextSource | null>(
    () =>
      previewText !== undefined
        ? { text: previewText, style: previewStyle ?? DEFAULT_TEXT_STYLE, transform: previewTransform }
        : null,
    [previewText, previewStyle, previewTransform],
  );

  const clipDuration = useMemo((): number => {
    const clip = project.timeline.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === clipId);
    if (clip) return clip.duration;

    const titleEngine = getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip) return textClip.duration;

    const graphicsEngine = getGraphicsEngine();
    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip) return shapeClip.duration;

    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip) return svgClip.duration;

    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip) return stickerClip.duration;

    return 5;
  }, [
    clipId,
    project.timeline.tracks,
    getTitleEngine,
    getGraphicsEngine,
    project.modifiedAt,
  ]);

  const currentAnimation = useMemo((): EmphasisAnimation => {
    const clip = project.timeline.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === clipId);

    if (clip?.emphasisAnimation) {
      return clip.emphasisAnimation;
    }

    const titleEngine = getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip?.emphasisAnimation) {
      return textClip.emphasisAnimation;
    }

    const graphicsEngine = getGraphicsEngine();
    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip?.emphasisAnimation) {
      return shapeClip.emphasisAnimation;
    }

    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip?.emphasisAnimation) {
      return svgClip.emphasisAnimation;
    }

    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip?.emphasisAnimation) {
      return stickerClip.emphasisAnimation;
    }

    return DEFAULT_EMPHASIS;
  }, [
    clipId,
    project.timeline.tracks,
    getTitleEngine,
    getGraphicsEngine,
    project.modifiedAt,
  ]);

  const handleAnimationChange = useCallback(
    (updates: Partial<EmphasisAnimation>) => {
      const newAnimation = { ...currentAnimation, ...updates };
      updateClipEmphasisAnimation(clipId, newAnimation);
    },
    [clipId, currentAnimation, updateClipEmphasisAnimation],
  );

  const handleTypeChange = useCallback(
    (type: EmphasisAnimationType) => {
      if (type === "focus-zoom") {
        handleAnimationChange({
          type,
          focusPoint: { x: 0.5, y: 0.5 },
          zoomScale: 1.5,
          holdDuration: 0.3,
          loop: false,
        });
      } else if (type === "ken-burns") {
        handleAnimationChange({ type, loop: false });
      } else {
        handleAnimationChange({ type });
      }
    },
    [handleAnimationChange],
  );

  const handleReset = useCallback(() => {
    handleAnimationChange(DEFAULT_EMPHASIS);
  }, [handleAnimationChange]);

  const selectedAnimation = EMPHASIS_ANIMATIONS.flatMap(
    (cat) => cat.animations,
  ).find((a) => a.type === currentAnimation.type);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => handleTypeChange("none")} type="button" aria-label="None" className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", (currentAnimation.type === "none" ? "bg-accent text-accent-fg hover:bg-accent/90" : "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"), `py-2 rounded-lg text-[10px] font-medium transition-all ${
            currentAnimation.type === "none"
              ? "bg-primary text-white"
              : "bg-bg-2 border border-border text-fg-2 hover:text-fg"
          }`)}>
          <span className="truncate">{"None"}</span>
        </Button>
        <Button onClick={handleReset} type="button" aria-label="Reset" className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 hover:bg-bg-3 py-2 rounded-lg text-[10px] font-medium bg-bg-2 border border-border text-fg-2 hover:text-fg transition-all flex items-center justify-center gap-1">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<RotateCcw size={10} />}</span>
          <span className="truncate">{"Reset"}</span>
        </Button>
      </div>

      <EffectPreviewProvider>
        {EMPHASIS_ANIMATIONS.map((category) => (
          <div key={category.category}>
            <span className="text-fg-2 mb-2 block text-[10px] font-medium">
              {category.category}
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {category.animations.map((anim) => (
                <EmphasisTile
                  key={anim.type}
                  label={anim.label}
                  type={anim.type}
                  current={currentAnimation}
                  selected={currentAnimation.type === anim.type}
                  source={previewSource}
                  onSelect={handleTypeChange}
                />
              ))}
            </div>
          </div>
        ))}
      </EffectPreviewProvider>

      {currentAnimation.type !== "none" && (
        <>
          <div className="pt-3 border-t border-border space-y-3">
            {selectedAnimation && (
              <span className="text-fg-2 font-normal text-[10px] italic">
                {selectedAnimation.description}
              </span>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-fg-2 font-normal text-[10px]">
                  Speed
                </span>
                <ValueText>
                  {currentAnimation.speed.toFixed(1)}x
                </ValueText>
              </div>
              <Slider
                ariaLabel="Speed"
                min={0.1}
                max={3}
                step={0.1}
                value={[currentAnimation.speed]}
                onValueChange={(value) =>
                  handleAnimationChange({ speed: value[0] })
                }
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-fg-2 font-normal text-[10px]">
                  Intensity
                </span>
                <ValueText>
                  {Math.round(currentAnimation.intensity * 100)}%
                </ValueText>
              </div>
              <Slider
                ariaLabel="Intensity"
                min={0.1}
                max={2}
                step={0.1}
                value={[currentAnimation.intensity]}
                onValueChange={(value) =>
                  handleAnimationChange({
                    intensity: value[0],
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-fg-2 font-normal text-[10px]">
                Loop Animation
              </span>
              <InspectorToggle
                ariaLabel="Loop Animation"
                checked={currentAnimation.loop}
                onChange={() =>
                  handleAnimationChange({ loop: !currentAnimation.loop })
                }
              />
            </div>
          </div>

          <div className="pt-3 border-t border-border space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <Clock size={12} />
              <span className="text-[10px] font-medium text-primary">
                Timing
              </span>
              <span className="text-fg-2 font-normal ml-auto text-[9px]">
                Clip: {formatTime(clipDuration)}
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-fg-2 font-normal text-[10px]">
                  Start Time
                </span>
                <ValueText>
                  {formatTime(currentAnimation.startTime ?? 0)}
                </ValueText>
              </div>
              <Slider
                ariaLabel="Start Time"
                min={0}
                max={clipDuration}
                step={0.1}
                value={[currentAnimation.startTime ?? 0]}
                onValueChange={(value) =>
                  handleAnimationChange({
                    startTime: value[0],
                  })
                }
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-fg-2 font-normal text-[10px]">
                  Duration
                </span>
                <ValueText>
                  {currentAnimation.animationDuration
                    ? formatTime(currentAnimation.animationDuration)
                    : "Full clip"}
                </ValueText>
              </div>
              <Slider
                ariaLabel="Duration"
                min={0}
                max={clipDuration - (currentAnimation.startTime ?? 0)}
                step={0.1}
                value={[
                  currentAnimation.animationDuration ??
                  clipDuration - (currentAnimation.startTime ?? 0)
                ]}
                onValueChange={(value) => {
                  const val = value[0];
                  handleAnimationChange({
                    animationDuration: val > 0 ? val : undefined,
                  });
                }}
              />
              <div className="flex justify-between text-[9px] text-fg-3">
                <span className="text-[12px] leading-5 text-fg-2 font-normal">
                  0s
                </span>
                <Button onClick={() =>
                    handleAnimationChange({
                      startTime: 0,
                      animationDuration: undefined,
                    })
                  } type="button" aria-label="Reset to full clip" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-transparent hover:bg-bg-2 hover:text-fg text-primary hover:underline">
                  <span className="truncate">{"Reset to full clip"}</span>
                </Button>
                <span className="text-[12px] leading-5 text-fg-2 font-normal">
                  {formatTime(clipDuration - (currentAnimation.startTime ?? 0))}
                </span>
              </div>
            </div>
          </div>

          {currentAnimation.type === "focus-zoom" && (
            <div className="pt-3 border-t border-border space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <Target size={12} />
              <span className="text-[10px] font-medium text-primary">
                Focus Zoom Settings
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                  <span className="text-fg-2 font-normal text-[10px]">
                    Zoom Scale
                  </span>
                  <ValueText>
                    {(currentAnimation.zoomScale || 1.5).toFixed(1)}x
                  </ValueText>
                </div>
                <Slider
                  ariaLabel="Zoom Scale"
                  min={1.1}
                  max={3}
                  step={0.1}
                  value={[currentAnimation.zoomScale || 1.5]}
                  onValueChange={(value) =>
                    handleAnimationChange({
                      zoomScale: value[0],
                    })
                  }
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-fg-2 font-normal text-[10px]">
                    Hold Duration
                  </span>
                  <ValueText>
                    {((currentAnimation.holdDuration || 0.3) * 100).toFixed(0)}%
                  </ValueText>
                </div>
                <Slider
                  ariaLabel="Hold Duration"
                  min={0}
                  max={1}
                  step={0.05}
                  value={[currentAnimation.holdDuration || 0.3]}
                  onValueChange={(value) =>
                    handleAnimationChange({
                      holdDuration: value[0],
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <span className="text-fg-2 font-normal text-[10px]">
                  Focus Point
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <span className="text-fg-2 font-normal text-[9px]">
                      X Position
                    </span>
                    <Slider
                      ariaLabel="Focus Point X"
                      min={0}
                      max={1}
                      step={0.05}
                      value={[currentAnimation.focusPoint?.x || 0.5]}
                      onValueChange={(value) =>
                        handleAnimationChange({
                          focusPoint: {
                            x: value[0],
                            y: currentAnimation.focusPoint?.y || 0.5,
                          },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-fg-2 font-normal text-[9px]">
                      Y Position
                    </span>
                    <Slider
                      ariaLabel="Focus Point Y"
                      min={0}
                      max={1}
                      step={0.05}
                      value={[currentAnimation.focusPoint?.y || 0.5]}
                      onValueChange={(value) =>
                        handleAnimationChange({
                          focusPoint: {
                            x: currentAnimation.focusPoint?.x || 0.5,
                            y: value[0],
                          },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1 mt-2">
                  {[
                    { x: 0, y: 0, label: "TL" },
                    { x: 0.5, y: 0, label: "TC" },
                    { x: 1, y: 0, label: "TR" },
                    { x: 0, y: 0.5, label: "ML" },
                    { x: 0.5, y: 0.5, label: "C" },
                    { x: 1, y: 0.5, label: "MR" },
                    { x: 0, y: 1, label: "BL" },
                    { x: 0.5, y: 1, label: "BC" },
                    { x: 1, y: 1, label: "BR" },
                  ].map((preset) => (
                    <Button variant="ghost" key={preset.label} onClick={() =>
                        handleAnimationChange({
                          focusPoint: { x: preset.x, y: preset.y },
                        })
                      } type="button" aria-label={`Focus ${preset.label}`} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", "border-border bg-bg-1 hover:bg-bg-2", "p-3", `py-1.5 rounded text-[9px] transition-all ${
                        currentAnimation.focusPoint?.x === preset.x &&
                        currentAnimation.focusPoint?.y === preset.y
                          ? "bg-primary text-white"
                        : "bg-bg-2 border border-border text-fg-3 hover:text-fg"
                      }`)}>
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="pt-3 border-t border-border">
        <div className="flex items-center gap-2 text-fg-3">
          <Zap size={10} />
          <span className="text-fg-2 font-normal text-[9px]">
            Emphasis animations play while the clip is visible (not during
            entry/exit)
          </span>
        </div>
      </div>
    </div>
  );
};

