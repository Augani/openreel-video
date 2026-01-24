import React, { useMemo, useCallback } from "react";
import type { Keyframe, Clip } from "@openreel/core";
import { KeyframeMarker } from "./KeyframeMarker";
import { EasingCurve } from "./EasingCurve";

const PROPERTY_COLORS: Record<string, string> = {
  "position.x": "#22d3ee",
  "position.y": "#a78bfa",
  "scale.x": "#4ade80",
  "scale.y": "#86efac",
  rotation: "#f472b6",
  opacity: "#fbbf24",
  borderRadius: "#94a3b8",
  default: "#64748b",
};

const PROPERTY_LABELS: Record<string, string> = {
  "position.x": "Position X",
  "position.y": "Position Y",
  "scale.x": "Scale X",
  "scale.y": "Scale Y",
  rotation: "Rotation",
  opacity: "Opacity",
  borderRadius: "Border Radius",
};

interface KeyframeTrackProps {
  clip: Clip;
  pixelsPerSecond: number;
  onKeyframeSelect: (keyframeId: string, addToSelection: boolean) => void;
  onKeyframeMove: (keyframeId: string, newTime: number) => void;
  onKeyframeDelete: (keyframeId: string) => void;
  selectedKeyframeIds: string[];
}

interface PropertyGroup {
  property: string;
  keyframes: Keyframe[];
  color: string;
  label: string;
}

export const KeyframeTrack: React.FC<KeyframeTrackProps> = ({
  clip,
  pixelsPerSecond,
  onKeyframeSelect,
  onKeyframeMove,
  onKeyframeDelete,
  selectedKeyframeIds,
}) => {

  const propertyGroups = useMemo((): PropertyGroup[] => {
    const groups = new Map<string, Keyframe[]>();

    for (const kf of clip.keyframes) {
      const existing = groups.get(kf.property) || [];
      existing.push(kf);
      groups.set(kf.property, existing);
    }

    return Array.from(groups.entries())
      .map(([property, keyframes]) => ({
        property,
        keyframes: keyframes.sort((a, b) => a.time - b.time),
        color: PROPERTY_COLORS[property] || PROPERTY_COLORS.default,
        label: PROPERTY_LABELS[property] || property,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [clip.keyframes]);

  const handleKeyframeMove = useCallback(
    (keyframeId: string, deltaPixels: number) => {
      const deltaTime = deltaPixels / pixelsPerSecond;
      const keyframe = clip.keyframes.find((kf) => kf.id === keyframeId);
      if (!keyframe) return;

      const newTime = Math.max(0, Math.min(clip.duration, keyframe.time + deltaTime));
      onKeyframeMove(keyframeId, newTime);
    },
    [clip.keyframes, clip.duration, pixelsPerSecond, onKeyframeMove]
  );

  if (propertyGroups.length === 0) {
    return (
      <div className="h-8 flex items-center justify-center text-[9px] text-text-muted">
        No keyframes
      </div>
    );
  }

  const PROPERTY_ROW_HEIGHT = 24;

  return (
    <div className="bg-background-tertiary/30 border-t border-border/30">
      {propertyGroups.map((group) => (
        <div
          key={group.property}
          className="relative border-b border-border/20 last:border-b-0"
          style={{ height: PROPERTY_ROW_HEIGHT }}
        >
          <div className="absolute left-0 top-0 bottom-0 w-20 flex items-center px-2 bg-background-tertiary/50 border-r border-border/30 z-10">
            <div
              className="w-2 h-2 rounded-full mr-1.5 flex-shrink-0"
              style={{ backgroundColor: group.color }}
            />
            <span className="text-[9px] text-text-muted truncate">
              {group.label}
            </span>
          </div>

          <div className="absolute left-20 right-0 top-0 bottom-0">
            {group.keyframes.map((keyframe, index) => {
              const nextKeyframe = group.keyframes[index + 1];
              const xPos = keyframe.time * pixelsPerSecond;

              return (
                <React.Fragment key={keyframe.id}>
                  {nextKeyframe && (
                    <EasingCurve
                      startX={xPos}
                      endX={nextKeyframe.time * pixelsPerSecond}
                      easing={keyframe.easing}
                      color={group.color}
                      height={PROPERTY_ROW_HEIGHT}
                    />
                  )}
                  <KeyframeMarker
                    keyframe={keyframe}
                    xPosition={xPos}
                    color={group.color}
                    isSelected={selectedKeyframeIds.includes(keyframe.id)}
                    onSelect={(addToSelection) =>
                      onKeyframeSelect(keyframe.id, addToSelection)
                    }
                    onMove={(deltaPixels) =>
                      handleKeyframeMove(keyframe.id, deltaPixels)
                    }
                    onDelete={() => onKeyframeDelete(keyframe.id)}
                  />
                </React.Fragment>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default KeyframeTrack;
