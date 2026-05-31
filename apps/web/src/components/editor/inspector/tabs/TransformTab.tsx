import React from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "@/icons/lucide-compat";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import type { Clip, FitMode, Transform } from "@openreel/core";
import { KeyframableControl } from "../KeyframableControl";
import {
  CropSection,
  AlignmentSection,
  BlendingSection,
  Transform3DSection,
} from "../";
import { InspectorSection } from "../shell/InspectorSection";
import {
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

              <KeyframableControl
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
                defaultValue={100}
                clipId={clipId}
                property="transform.scale.x"
                displayScale={100}
              />
              <KeyframableControl
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
                defaultValue={100}
                clipId={clipId}
                property="transform.scale.y"
                displayScale={100}
              />
              <KeyframableControl
                label="Rotation"
                value={transform.rotation}
                onChange={(rotation) => handleTransformChange({ rotation })}
                min={-180}
                max={180}
                step={1}
                unit="°"
                defaultValue={0}
                clipId={clipId}
                property="transform.rotation"
                displayScale={1}
              />
              <KeyframableControl
                label="Opacity"
                value={transform.opacity * 100}
                onChange={(opacity) =>
                  handleTransformChange({ opacity: opacity / 100 })
                }
                min={0}
                max={100}
                step={1}
                unit="%"
                defaultValue={100}
                clipId={clipId}
                property="transform.opacity"
                displayScale={100}
              />
              <KeyframableControl
                label="Border Radius"
                value={transform.borderRadius || 0}
                onChange={(borderRadius) =>
                  handleTransformChange({ borderRadius })
                }
                min={0}
                max={200}
                step={1}
                unit="px"
                defaultValue={0}
                clipId={clipId}
                property="transform.borderRadius"
                displayScale={1}
              />

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