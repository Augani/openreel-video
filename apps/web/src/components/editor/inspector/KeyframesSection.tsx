import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Key,
  Plus,
  Trash2,
  ChevronDown,
  Diamond,
  DiamondIcon,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftPopover as Popover } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useEngineStore } from "../../../stores/engine-store";
import {
  KeyframeEngine,
  EASING_CATEGORIES,
  getStaticDescriptor,
  type EasingName,
} from "@openreel/core";
import type { Keyframe, EasingType } from "@openreel/core";

const keyframeEngine = new KeyframeEngine();

interface AnimatableProperty {
  id: string;
  label: string;
  category: string;
  defaultValue: unknown;
  min?: number;
  max?: number;
  step?: number;
}

const ANIMATABLE_PROPERTIES: AnimatableProperty[] = [
  {
    id: "position.x",
    label: "Position X",
    category: "Transform",
    defaultValue: 0,
    min: -2000,
    max: 2000,
  },
  {
    id: "position.y",
    label: "Position Y",
    category: "Transform",
    defaultValue: 0,
    min: -2000,
    max: 2000,
  },
  {
    id: "scale.x",
    label: "Scale X",
    category: "Transform",
    defaultValue: 1,
    min: 0,
    max: 10,
    step: 0.01,
  },
  {
    id: "scale.y",
    label: "Scale Y",
    category: "Transform",
    defaultValue: 1,
    min: 0,
    max: 10,
    step: 0.01,
  },
  {
    id: "rotation",
    label: "Rotation",
    category: "Transform",
    defaultValue: 0,
    min: -360,
    max: 360,
  },
  {
    id: "opacity",
    label: "Opacity",
    category: "Transform",
    defaultValue: 1,
    min: 0,
    max: 1,
    step: 0.01,
  },
  // Effect parameters
  {
    id: "effect.brightness",
    label: "Brightness",
    category: "Effects",
    defaultValue: 0,
    min: -100,
    max: 100,
  },
  {
    id: "effect.contrast",
    label: "Contrast",
    category: "Effects",
    defaultValue: 1,
    min: 0,
    max: 2,
    step: 0.01,
  },
  {
    id: "effect.saturation",
    label: "Saturation",
    category: "Effects",
    defaultValue: 1,
    min: 0,
    max: 2,
    step: 0.01,
  },
  {
    id: "effect.blur",
    label: "Blur",
    category: "Effects",
    defaultValue: 0,
    min: 0,
    max: 100,
  },
  {
    id: "volume",
    label: "Volume",
    category: "Audio",
    defaultValue: 1,
    min: 0,
    max: 2,
    step: 0.01,
  },
  {
    id: "pan",
    label: "Pan",
    category: "Audio",
    defaultValue: 0,
    min: -1,
    max: 1,
    step: 0.01,
  },
];

const formatEasingLabel = (easing: string): string => {
  return (
    easing
      .replace(/([A-Z])/g, " $1")
      .replace(/^ease/, "")
      .trim() || easing
  );
};

const propertyLabel = (property: string): string => {
  const known = ANIMATABLE_PROPERTIES.find((p) => p.id === property)?.label;
  if (known) return known;
  const descriptor = getStaticDescriptor(property)?.label;
  if (descriptor) return descriptor;
  const segments = property.split(".");
  return segments[segments.length - 1] || property;
};

const PropertySelector: React.FC<{
  selectedProperty: string | null;
  onSelect: (propertyId: string) => void;
  existingProperties: string[];
}> = ({ selectedProperty, onSelect, existingProperties }) => {
  const [isOpen, setIsOpen] = useState(false);

  const categories = [...new Set(ANIMATABLE_PROPERTIES.map((p) => p.category))];

  const selectedLabel = selectedProperty
    ? propertyLabel(selectedProperty)
    : "Select Property";

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      placement="below"
      alignment="start"
      width="min(260px, 100vw - 32px)"
      label="Animate property"
      content={
        <div className="max-h-64 overflow-y-auto p-1.5">
          {existingProperties.length > 0 && (
            <div className="mb-1.5 space-y-1 border-b border-border pb-1.5">
              <div className="px-2 py-1 bg-bg-2">
                <Text type="supporting" color="secondary" weight="bold">
                  On this clip
                </Text>
              </div>
              {existingProperties.map((propId) => (
                <ClickableCard
                  key={propId}
                  label={`Select ${propertyLabel(propId)}`}
                  onClick={() => {
                    onSelect(propId);
                    setIsOpen(false);
                  }}
                  padding={2}
                  variant={selectedProperty === propId ? "green" : "transparent"}
                  className="w-full"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Text type="supporting" color="primary">
                      {propertyLabel(propId)}
                    </Text>
                    <Diamond
                      size={10}
                      className="text-primary fill-primary"
                      aria-hidden
                    />
                  </div>
                </ClickableCard>
              ))}
            </div>
          )}
          {categories.map((category) => (
            <div key={category} className="space-y-1">
              <div className="px-2 py-1 bg-bg-2">
                <Text type="supporting" color="secondary" weight="bold">
                  {category}
                </Text>
              </div>
              {ANIMATABLE_PROPERTIES.filter(
                (p) => p.category === category,
              ).map((prop) => {
                const hasKeyframes = existingProperties.includes(prop.id);
                return (
                  <ClickableCard
                    key={prop.id}
                    label={`Select ${prop.label}`}
                    onClick={() => {
                      onSelect(prop.id);
                      setIsOpen(false);
                    }}
                    padding={2}
                    variant={selectedProperty === prop.id ? "green" : "transparent"}
                    className="w-full"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Text type="supporting" color="primary">
                        {prop.label}
                      </Text>
                      {hasKeyframes && (
                        <Diamond
                          size={10}
                          className="text-primary fill-primary"
                          aria-hidden
                        />
                      )}
                    </div>
                  </ClickableCard>
                );
              })}
            </div>
          ))}
        </div>
      }
    >
      <Button
        label={selectedLabel}
        variant="secondary"
        size="sm"
        endContent={
          <ChevronDown
            size={12}
            className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
            aria-hidden
          />
        }
        className="w-full justify-between"
      />
    </Popover>
  );
};

const EasingCurvePreview: React.FC<{ easing: string; size?: number }> = ({
  easing,
  size = 16,
}) => {
  const getPath = (easingType: string): string => {
    const easingPaths: Record<string, string> = {
      linear: "M0,16 L16,0",
      easeIn: "M0,16 Q8,16 16,0",
      easeOut: "M0,16 Q8,0 16,0",
      easeInOut: "M0,16 Q4,16 8,8 Q12,0 16,0",
      easeInQuad: "M0,16 C0,16 12,16 16,0",
      easeOutQuad: "M0,16 C4,0 16,0 16,0",
      easeInOutQuad: "M0,16 C0,16 6,16 8,8 C10,0 16,0 16,0",
      easeInCubic: "M0,16 C0,16 14,16 16,0",
      easeOutCubic: "M0,16 C2,0 16,0 16,0",
      easeInOutCubic: "M0,16 C0,16 5,16 8,8 C11,0 16,0 16,0",
      easeInElastic: "M0,16 Q2,18 4,16 Q6,14 8,16 Q12,8 16,0",
      easeOutElastic: "M0,16 Q4,8 8,0 Q10,2 12,0 Q14,-2 16,0",
      easeInBounce: "M0,16 L4,16 L6,14 L8,16 L12,8 L16,0",
      easeOutBounce: "M0,16 L4,8 L8,0 L10,2 L12,0 L14,2 L16,0",
    };
    return easingPaths[easingType] || easingPaths.linear;
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="text-primary"
    >
      <path
        d={getPath(easing)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
};

const EasingSelector: React.FC<{
  value: EasingType;
  onChange: (easing: EasingName) => void;
}> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);

  const currentLabel = formatEasingLabel(value);

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      placement="below"
      alignment="end"
      width={208}
      label={`Easing: ${currentLabel}`}
      content={
        <div className="max-h-64 overflow-y-auto p-1.5">
          {EASING_CATEGORIES.map((category) => (
            <div key={category.name} className="space-y-1">
              <div className="sticky top-0 px-2 py-1 bg-bg-2">
                <Text type="supporting" color="secondary" weight="bold">
                  {category.name}
                </Text>
              </div>
              {category.easings.map((easing) => (
                <ClickableCard
                  key={easing}
                  label={`Use ${formatEasingLabel(easing)} easing`}
                  onClick={() => {
                    onChange(easing);
                    setIsOpen(false);
                  }}
                  padding={2}
                  variant={value === easing ? "green" : "transparent"}
                >
                  <div className="flex items-center gap-2">
                    <EasingCurvePreview easing={easing} size={14} />
                    <Text type="supporting" color="primary">
                      {formatEasingLabel(easing)}
                    </Text>
                  </div>
                </ClickableCard>
              ))}
            </div>
          ))}
        </div>
      }
    >
      <Button
        label={currentLabel}
        variant="secondary"
        size="sm"
        icon={<EasingCurvePreview easing={value} size={14} />}
        endContent={<ChevronDown size={10} aria-hidden />}
      />
    </Popover>
  );
};

const KeyframeItem: React.FC<{
  keyframe: Keyframe;
  onUpdate: (updates: Partial<Omit<Keyframe, "id">>) => void;
  onDelete: () => void;
  onEasingChange: (easing: EasingName) => void;
  property: AnimatableProperty | undefined;
}> = ({ keyframe, onUpdate, onDelete, onEasingChange, property }) => {
  const _formatValue = (value: unknown): string => {
    if (typeof value === "number") {
      return value.toFixed(property?.step && property.step < 1 ? 2 : 0);
    }
    return String(value);
  };
  void _formatValue;

  return (
    <Card
      variant="muted"
      padding={2}
      className="flex items-center gap-2 border border-border"
    >
      <DiamondIcon
        size={12}
        className="text-primary fill-primary flex-shrink-0"
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary">
            {keyframe.time.toFixed(2)}s
          </Text>
          <Text type="supporting" color="secondary">
            •
          </Text>
          <ToolcraftNumberInputControl
            label="Keyframe value"
            isLabelHidden
            value={typeof keyframe.value === "number" ? keyframe.value : 0}
            onChange={(value) => onUpdate({ value: value ?? 0 })}
            min={property?.min}
            max={property?.max}
            step={property?.step || 1}
            size="sm"
            width={72}
          />
        </div>
      </div>
      <EasingSelector value={keyframe.easing} onChange={onEasingChange} />
      <IconButton
        label="Delete keyframe"
        icon={<Trash2 size={12} aria-hidden />}
        variant="ghost"
        size="sm"
        onClick={onDelete}
      />
    </Card>
  );
};

interface KeyframesSectionProps {
  clipId: string;
}

/**
 * KeyframesSection Component
 *
 * - 20.1: Add keyframes at specific times with values
 * - 20.2: Select easing type for keyframe interpolation
 */
export const KeyframesSection: React.FC<KeyframesSectionProps> = ({
  clipId,
}) => {
  const { getClip, updateClipKeyframes, project } = useProjectStore();
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);

  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);

  const clip = useMemo(() => {
    const timelineClip = getClip(clipId);
    if (timelineClip) return timelineClip;

    const graphicsEngine = getGraphicsEngine();
    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip) return svgClip;

    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip) return shapeClip;

    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip) return stickerClip;

    const titleEngine = getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip) return textClip;

    return undefined;
  }, [clipId, getClip, getGraphicsEngine, getTitleEngine, project.modifiedAt]);
  const keyframes = clip?.keyframes || [];
  const localTime = playheadPosition - (clip?.startTime ?? 0);

  const propertiesWithKeyframes = useMemo(() => {
    return [...new Set(keyframes.map((kf) => kf.property))];
  }, [keyframes]);

  useEffect(() => {
    const props = [
      ...new Set((getClip(clipId)?.keyframes ?? []).map((kf) => kf.property)),
    ];
    setSelectedProperty(props.length > 0 ? props[0] : null);
  }, [clipId, getClip]);

  const propertyKeyframes = useMemo(() => {
    if (!selectedProperty) return [];
    return keyframeEngine.getKeyframesForProperty(keyframes, selectedProperty);
  }, [keyframes, selectedProperty]);

  const propertyDef = useMemo(() => {
    return ANIMATABLE_PROPERTIES.find((p) => p.id === selectedProperty);
  }, [selectedProperty]);

  const currentValue = useMemo(() => {
    if (!selectedProperty || propertyKeyframes.length === 0) {
      return propertyDef?.defaultValue ?? 0;
    }
    const result = keyframeEngine.getValueAtTime(
      propertyKeyframes,
      localTime,
    );
    return result.value;
  }, [selectedProperty, propertyKeyframes, localTime, propertyDef]);

  const hasKeyframeAtPlayhead = useMemo(() => {
    if (!selectedProperty) return false;
    return propertyKeyframes.some(
      (kf) => Math.abs(kf.time - localTime) < 0.01,
    );
  }, [selectedProperty, propertyKeyframes, localTime]);

  const handleAddKeyframe = useCallback(() => {
    if (!selectedProperty || !clip) return;

    const newKeyframe = keyframeEngine.addKeyframe(
      clipId,
      selectedProperty,
      localTime,
      currentValue,
      "linear",
    );

    const updatedKeyframes = [...keyframes, newKeyframe].sort(
      (a, b) => a.time - b.time,
    );
    updateClipKeyframes(clipId, updatedKeyframes);
  }, [
    clipId,
    clip,
    selectedProperty,
    localTime,
    currentValue,
    keyframes,
    updateClipKeyframes,
  ]);

  const handleUpdateKeyframe = useCallback(
    (keyframeId: string, updates: Partial<Omit<Keyframe, "id">>) => {
      const updatedKeyframes = keyframeEngine.updateKeyframe(
        keyframes,
        keyframeId,
        updates,
      );
      updateClipKeyframes(clipId, updatedKeyframes);
    },
    [clipId, keyframes, updateClipKeyframes],
  );

  const handleDeleteKeyframe = useCallback(
    (keyframeId: string) => {
      const updatedKeyframes = keyframeEngine.removeKeyframe(
        keyframes,
        keyframeId,
      );
      updateClipKeyframes(clipId, updatedKeyframes);
    },
    [clipId, keyframes, updateClipKeyframes],
  );

  const handleEasingChange = useCallback(
    (keyframeId: string, easing: EasingName) => {
      const updatedKeyframes = keyframeEngine.updateKeyframe(
        keyframes,
        keyframeId,
        { easing: easing as EasingType },
      );
      updateClipKeyframes(clipId, updatedKeyframes);
    },
    [clipId, keyframes, updateClipKeyframes],
  );

  if (!clip) {
    return (
      <Text type="supporting" color="secondary" className="block text-center py-4">
        No clip selected
      </Text>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Text type="supporting" color="secondary" weight="bold" className="block">
          Animate Property
        </Text>
        <PropertySelector
          selectedProperty={selectedProperty}
          onSelect={setSelectedProperty}
          existingProperties={propertiesWithKeyframes}
        />
      </div>

      {selectedProperty && (
        <Card
          variant="muted"
          padding={2}
          className="flex items-center justify-between gap-3 border border-border"
        >
          <Text type="supporting" color="secondary">
            Value at {playheadPosition.toFixed(2)}s
          </Text>
          <Text type="supporting" color="primary" className="font-mono">
            {typeof currentValue === "number"
              ? currentValue.toFixed(2)
              : String(currentValue)}
          </Text>
        </Card>
      )}

      {selectedProperty && (
        <Button
          label={
            hasKeyframeAtPlayhead
              ? `Keyframe exists at ${playheadPosition.toFixed(2)}s`
              : `Add Keyframe at ${playheadPosition.toFixed(2)}s`
          }
          icon={
            hasKeyframeAtPlayhead ? (
              <Key size={12} aria-hidden />
            ) : (
              <Plus size={12} aria-hidden />
            )
          }
          variant={hasKeyframeAtPlayhead ? "secondary" : "primary"}
          size="sm"
          isDisabled={hasKeyframeAtPlayhead}
          onClick={handleAddKeyframe}
          className="w-full"
        />
      )}

      {selectedProperty && propertyKeyframes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary" weight="bold">
              Keyframes ({propertyKeyframes.length})
            </Text>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {propertyKeyframes.map((kf) => (
              <KeyframeItem
                key={kf.id}
                keyframe={kf}
                property={propertyDef}
                onUpdate={(updates) => handleUpdateKeyframe(kf.id, updates)}
                onDelete={() => handleDeleteKeyframe(kf.id)}
                onEasingChange={(easing) => handleEasingChange(kf.id, easing)}
              />
            ))}
          </div>
        </div>
      )}

      {!selectedProperty && (
        <div className="text-center py-4">
          <Key size={24} className="mx-auto text-fg-3 mb-2" aria-hidden />
          <Text type="supporting" color="secondary">
            Select a property to animate
          </Text>
        </div>
      )}

      {selectedProperty && propertyKeyframes.length === 0 && (
        <Text type="supporting" color="secondary" className="block text-center py-2">
          No keyframes for this property. Add one to start animating.
        </Text>
      )}
    </div>
  );
};

export default KeyframesSection;
