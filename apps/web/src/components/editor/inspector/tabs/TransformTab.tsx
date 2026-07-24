import React from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "@/icons/lucide-compat";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import type { Clip, FitMode, Transform } from "@openreel/core";
import {
  CropSection,
  AlignmentSection,
  BlendingSection,
  Transform3DSection,
} from "../";
import { InspectorSection } from "../shell/InspectorSection";
import {
  MockSlider,
  NumberField,
} from "../shell/InspectorControls";

interface TransformTabClip {
  id: string;
  mediaId: string;
}

export interface TransformTabProps {
  clipId: string;
  clipType: string | null;
  selectedClip: TransformTabClip | null;
  showTransformControls: boolean;
  showVideoControls: boolean;
  transform: Transform;
  canvasWidth: number;
  canvasHeight: number;
  handleTransformChange: (changes: Partial<Transform>) => void;
}

const parseNumber = (raw: string, fallback: number): number => {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stepRotation = (current: number, delta: number): number => {
  const next = current + delta;
  if (next > 180) return 180;
  if (next < -180) return -180;
  return next;
};

export const TransformTab: React.FC<TransformTabProps> = ({
  clipId,
  clipType,
  selectedClip,
  showTransformControls,
  showVideoControls,
  transform,
  canvasWidth,
  canvasHeight,
  handleTransformChange,
}) => {
  const usesNormalizedPosition =
    clipType === "text" ||
    clipType === "shape" ||
    clipType === "svg" ||
    clipType === "sticker";
  const displayedPosition = {
    x: usesNormalizedPosition
      ? transform.position.x * canvasWidth
      : transform.position.x,
    y: usesNormalizedPosition
      ? transform.position.y * canvasHeight
      : transform.position.y,
  };
  const updateDisplayedPosition = (axis: "x" | "y", value: number) => {
    const dimension = axis === "x" ? canvasWidth : canvasHeight;
    handleTransformChange({
      position: {
        ...transform.position,
        [axis]: usesNormalizedPosition ? value / Math.max(1, dimension) : value,
      },
    });
  };
  const nudgePosition = (x: number, y: number) => {
    handleTransformChange({
      position: {
        x:
          transform.position.x +
          (usesNormalizedPosition ? x / Math.max(1, canvasWidth) : x),
        y:
          transform.position.y +
          (usesNormalizedPosition ? y / Math.max(1, canvasHeight) : y),
      },
    });
  };

  return (
    <>
      {showTransformControls && (
        <>
          <InspectorSection
            title="Transform"
            sectionId="transform"
            defaultOpen
          >
            <div className="space-y-3">
              <NumberField
                label="Position"
                fields={[
                  {
                    axis: "X",
                    value: `${Math.round(displayedPosition.x)}`,
                    onChange: (next) =>
                      updateDisplayedPosition(
                        "x",
                        parseNumber(next, displayedPosition.x),
                      ),
                  },
                  {
                    axis: "Y",
                    value: `${Math.round(displayedPosition.y)}`,
                    onChange: (next) =>
                      updateDisplayedPosition(
                        "y",
                        parseNumber(next, displayedPosition.y),
                      ),
                  },
                ]}
              />
              <div className="flex items-center gap-2">
                <span className="w-[90px] flex-none text-[11px] font-medium text-fg-muted">
                  {usesNormalizedPosition ? "Canvas pixels" : "Offset pixels"}
                </span>
                <div className="grid flex-1 grid-cols-4 gap-1" role="group" aria-label="Nudge position by one pixel">
                  {([
                    ["Nudge left 1 pixel", ArrowLeft, -1, 0],
                    ["Nudge up 1 pixel", ArrowUp, 0, -1],
                    ["Nudge down 1 pixel", ArrowDown, 0, 1],
                    ["Nudge right 1 pixel", ArrowRight, 1, 0],
                  ] as const).map(([label, Icon, x, y]) => (
                    <button
                      key={label}
                      type="button"
                      aria-label={label}
                      title={label}
                      onClick={() => nudgePosition(x, y)}
                      className="flex h-7 items-center justify-center rounded-[6px] border border-border bg-bg-2 text-fg-muted transition-colors hover:border-accent/50 hover:text-accent"
                    >
                      <Icon size={13} aria-hidden />
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center">
                <span className="w-[90px] flex-none text-[13px] font-medium text-fg-3">
                  Scale
                </span>
                <MockSlider
                  className="flex-1"
                  value={transform.scale.x * 100}
                  min={0}
                  max={300}
                  onChange={(next) =>
                    handleTransformChange({
                      scale: { x: next / 100, y: next / 100 },
                    })
                  }
                  showValueBox
                  formatValue={(value) => `${Math.round(value)}%`}
                />
              </div>

              <div className="flex items-center">
                <span className="w-[90px] flex-none text-[13px] font-medium text-fg-3">
                  Rotation
                </span>
                <div className="flex flex-1 items-center justify-between rounded-[7px] border border-border px-[10px] py-[7px] focus-within:border-accent">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={`${Math.round(transform.rotation)}°`}
                    onChange={(event) =>
                      handleTransformChange({
                        rotation: parseNumber(
                          event.target.value,
                          transform.rotation,
                        ),
                      })
                    }
                    className="w-full min-w-0 bg-transparent text-[13px] font-medium text-fg-2 outline-none"
                  />
                  <div className="flex flex-none flex-col">
                    <button
                      type="button"
                      aria-label="Increase rotation"
                      onClick={() =>
                        handleTransformChange({
                          rotation: stepRotation(transform.rotation, 1),
                        })
                      }
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--fg-muted)"
                        strokeWidth="2.2"
                        aria-hidden
                      >
                        <path d="M8 15l4-4 4 4" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      aria-label="Decrease rotation"
                      onClick={() =>
                        handleTransformChange({
                          rotation: stepRotation(transform.rotation, -1),
                        })
                      }
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--fg-muted)"
                        strokeWidth="2.2"
                        aria-hidden
                      >
                        <path d="M8 9l4 4 4-4" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <NumberField
                label="Anchor Point"
                fields={[
                  {
                    axis: "X",
                    value: `${Math.round(transform.anchor.x * 100)}%`,
                    onChange: (next) =>
                      handleTransformChange({
                        anchor: {
                          ...transform.anchor,
                          x: parseNumber(next, transform.anchor.x * 100) / 100,
                        },
                      }),
                  },
                  {
                    axis: "Y",
                    value: `${Math.round(transform.anchor.y * 100)}%`,
                    onChange: (next) =>
                      handleTransformChange({
                        anchor: {
                          ...transform.anchor,
                          y: parseNumber(next, transform.anchor.y * 100) / 100,
                        },
                      }),
                  },
                ]}
              />

              <div className="h-px bg-border" />

              <div className="flex items-center">
                <span className="w-[90px] flex-none text-[13px] font-medium text-fg-3">
                  Opacity
                </span>
                <MockSlider
                  className="flex-1"
                  value={transform.opacity * 100}
                  min={0}
                  max={100}
                  onChange={(next) =>
                    handleTransformChange({ opacity: next / 100 })
                  }
                  showValueBox
                  formatValue={(value) => `${Math.round(value)}%`}
                />
              </div>

              <div className="flex items-center">
                <span className="w-[90px] flex-none text-[13px] font-medium text-fg-3">
                  Radius
                </span>
                <MockSlider
                  className="flex-1"
                  value={transform.borderRadius || 0}
                  min={0}
                  max={200}
                  onChange={(borderRadius) =>
                    handleTransformChange({ borderRadius })
                  }
                  showValueBox
                  formatValue={(value) => `${Math.round(value)}px`}
                />
              </div>

              {(clipType === "image" || clipType === "video") && (
                <div className="space-y-2 border-t border-border pt-3">
                  <Text
                    type="supporting"
                    color="secondary"
                    className="text-[11px] text-fg-3"
                  >
                    Fit Mode
                  </Text>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["contain", "cover", "stretch"] as FitMode[]).map(
                      (mode) => {
                        const activeMode =
                          !transform.fitMode || transform.fitMode === "none"
                            ? "contain"
                            : transform.fitMode;
                        return (
                          <ClickableCard
                            key={mode}
                            label={`Set fit mode to ${mode}`}
                            onClick={() =>
                              handleTransformChange({ fitMode: mode })
                            }
                            className={`py-2 rounded-lg text-[12px] font-medium text-center capitalize transition-colors ${
                              activeMode === mode
                                ? "bg-accent text-accent-fg"
                                : "bg-bg-2 border border-border text-fg-3 hover:text-fg"
                            }`}
                          >
                            {mode === "contain"
                              ? "Fit"
                              : mode === "cover"
                                ? "Fill"
                                : mode}
                          </ClickableCard>
                        );
                      },
                    )}
                  </div>
                </div>
              )}
            </div>
          </InspectorSection>
        </>
      )}

      {showVideoControls &&
        selectedClip &&
        !selectedClip.mediaId.startsWith("text-") &&
        !selectedClip.mediaId.startsWith("shape-") &&
        !selectedClip.mediaId.startsWith("svg-") &&
        !selectedClip.mediaId.startsWith("sticker-") && (
          <InspectorSection title="Crop" sectionId="crop" defaultOpen={false}>
            <CropSection clip={selectedClip as Clip} />
          </InspectorSection>
        )}

      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "text" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <InspectorSection
          title="Alignment"
          sectionId="alignment"
          defaultOpen={false}
        >
          <AlignmentSection
            clipType={clipType}
            transform={transform}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            onTransformChange={handleTransformChange}
          />
        </InspectorSection>
      )}

      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "text" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <div className="mb-4" data-section-id="blending">
          <BlendingSection clipId={clipId} />
        </div>
      )}

      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "text" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <InspectorSection
          title="3D Transforms"
          sectionId="transform-3d"
          defaultOpen={false}
        >
          <Transform3DSection clipId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
