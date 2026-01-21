import React, { useCallback, useMemo } from "react";
import { RotateCcw, Target, Zap, Clock } from "lucide-react";
import { Slider } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import type { EmphasisAnimation, EmphasisAnimationType } from "@openreel/core";

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

export const EmphasisAnimationSection: React.FC<
  EmphasisAnimationSectionProps
> = ({ clipId }) => {
  const { project, updateClipEmphasisAnimation } = useProjectStore();
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);

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
        <button
          onClick={() => handleTypeChange("none")}
          className={`py-2 rounded-lg text-[10px] font-medium transition-all ${
            currentAnimation.type === "none"
              ? "bg-primary text-white"
              : "bg-background-tertiary border border-border text-text-secondary hover:text-text-primary"
          }`}
        >
          None
        </button>
        <button
          onClick={handleReset}
          className="py-2 rounded-lg text-[10px] font-medium bg-background-tertiary border border-border text-text-secondary hover:text-text-primary transition-all flex items-center justify-center gap-1"
        >
          <RotateCcw size={10} />
          Reset
        </button>
      </div>

      {EMPHASIS_ANIMATIONS.map((category) => (
        <div key={category.category}>
          <h4 className="text-[10px] font-medium text-text-muted mb-2">
            {category.category}
          </h4>
          <div className="grid grid-cols-2 gap-1.5">
            {category.animations.map((anim) => (
              <button
                key={anim.type}
                onClick={() => handleTypeChange(anim.type)}
                className={`py-2 px-2 rounded-lg text-[10px] transition-all text-left ${
                  currentAnimation.type === anim.type
                    ? "bg-primary text-white"
                    : "bg-background-tertiary border border-border text-text-secondary hover:text-text-primary hover:border-primary/50"
                }`}
              >
                {anim.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {currentAnimation.type !== "none" && (
        <>
          <div className="pt-3 border-t border-border space-y-3">
            {selectedAnimation && (
              <p className="text-[10px] text-text-muted italic">
                {selectedAnimation.description}
              </p>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-secondary">Speed</span>
                <span className="text-[10px] font-mono text-text-primary bg-background-tertiary px-1.5 py-0.5 rounded border border-border">
                  {currentAnimation.speed.toFixed(1)}x
                </span>
              </div>
              <Slider
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
                <span className="text-[10px] text-text-secondary">
                  Intensity
                </span>
                <span className="text-[10px] font-mono text-text-primary bg-background-tertiary px-1.5 py-0.5 rounded border border-border">
                  {Math.round(currentAnimation.intensity * 100)}%
                </span>
              </div>
              <Slider
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
              <span className="text-[10px] text-text-secondary">
                Loop Animation
              </span>
              <button
                onClick={() =>
                  handleAnimationChange({ loop: !currentAnimation.loop })
                }
                className={`w-10 h-5 rounded-full transition-colors ${
                  currentAnimation.loop
                    ? "bg-primary"
                    : "bg-background-tertiary border border-border"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                    currentAnimation.loop ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-border space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <Clock size={12} />
              <span className="text-[10px] font-medium">Timing</span>
              <span className="text-[9px] text-text-muted ml-auto">
                Clip: {formatTime(clipDuration)}
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-secondary">
                  Start Time
                </span>
                <span className="text-[10px] font-mono text-text-primary bg-background-tertiary px-1.5 py-0.5 rounded border border-border">
                  {formatTime(currentAnimation.startTime ?? 0)}
                </span>
              </div>
              <Slider
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
                <span className="text-[10px] text-text-secondary">
                  Duration
                </span>
                <span className="text-[10px] font-mono text-text-primary bg-background-tertiary px-1.5 py-0.5 rounded border border-border">
                  {currentAnimation.animationDuration
                    ? formatTime(currentAnimation.animationDuration)
                    : "Full clip"}
                </span>
              </div>
              <Slider
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
              <div className="flex justify-between text-[9px] text-text-muted">
                <span>0s</span>
                <button
                  onClick={() =>
                    handleAnimationChange({
                      startTime: 0,
                      animationDuration: undefined,
                    })
                  }
                  className="text-primary hover:underline"
                >
                  Reset to full clip
                </button>
                <span>
                  {formatTime(clipDuration - (currentAnimation.startTime ?? 0))}
                </span>
              </div>
            </div>
          </div>

          {currentAnimation.type === "focus-zoom" && (
            <div className="pt-3 border-t border-border space-y-3">
              <div className="flex items-center gap-2 text-primary">
                <Target size={12} />
                <span className="text-[10px] font-medium">
                  Focus Zoom Settings
                </span>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">
                    Zoom Scale
                  </span>
                  <span className="text-[10px] font-mono text-text-primary bg-background-tertiary px-1.5 py-0.5 rounded border border-border">
                    {(currentAnimation.zoomScale || 1.5).toFixed(1)}x
                  </span>
                </div>
                <Slider
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
                  <span className="text-[10px] text-text-secondary">
                    Hold Duration
                  </span>
                  <span className="text-[10px] font-mono text-text-primary bg-background-tertiary px-1.5 py-0.5 rounded border border-border">
                    {((currentAnimation.holdDuration || 0.3) * 100).toFixed(0)}%
                  </span>
                </div>
                <Slider
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
                <span className="text-[10px] text-text-secondary">
                  Focus Point
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <span className="text-[9px] text-text-muted">
                      X Position
                    </span>
                    <Slider
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
                    <span className="text-[9px] text-text-muted">
                      Y Position
                    </span>
                    <Slider
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
                    <button
                      key={preset.label}
                      onClick={() =>
                        handleAnimationChange({
                          focusPoint: { x: preset.x, y: preset.y },
                        })
                      }
                      className={`py-1.5 rounded text-[9px] transition-all ${
                        currentAnimation.focusPoint?.x === preset.x &&
                        currentAnimation.focusPoint?.y === preset.y
                          ? "bg-primary text-white"
                          : "bg-background-tertiary border border-border text-text-muted hover:text-text-primary"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="pt-3 border-t border-border">
        <div className="flex items-center gap-2 text-text-muted">
          <Zap size={10} />
          <span className="text-[9px]">
            Emphasis animations play while the clip is visible (not during
            entry/exit)
          </span>
        </div>
      </div>
    </div>
  );
};

export default EmphasisAnimationSection;
