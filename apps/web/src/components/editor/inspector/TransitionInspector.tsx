import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { MockToggle } from "./shell/InspectorControls";
import { PropertySlider } from "./shell/PropertySlider";
import {
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  X,
  Check,
} from "@/icons/lucide-compat";
import {
  getTransitionBridge,
  type TransitionTypeInfo,
} from "../../../bridges/transition-bridge";
import type { Transition, Clip, TransitionEdge } from "@openreel/core";
import type { TransitionType } from "@openreel/core";
import { toast } from "../../../stores/notification-store";

const TransitionSlider: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}> = ({ label, value, onChange, min, max, step = 1, unit = "" }) => (
  <PropertySlider
    label={label}
    value={value}
    onChange={onChange}
    min={min}
    max={max}
    step={step}
    formatValue={(nextValue) =>
      `${step < 1 ? Number(nextValue.toFixed(2)) : Math.round(nextValue)}${unit}`
    }
  />
);

/**
 * Direction Selector Component
 */
const DirectionSelector: React.FC<{
  value: string;
  onChange: (direction: string) => void;
  options?: string[];
}> = ({ value, onChange, options = ["left", "right", "up", "down"] }) => {
  const directionIcons: Record<string, React.ReactNode> = {
    left: <ArrowLeft size={14} />,
    right: <ArrowRight size={14} />,
    up: <ArrowUp size={14} />,
    down: <ArrowDown size={14} />,
  };

  return (
    <div className="space-y-1">
      <Text type="supporting" color="secondary" className="text-[10px]">
        Direction
      </Text>
      <div className="grid grid-cols-4 gap-1">
        {options.map((dir) => (
          <IconButton
            key={dir}
            label={dir.charAt(0).toUpperCase() + dir.slice(1)}
            icon={(directionIcons[dir] || dir) as any}
            variant={value === dir ? "primary" : "secondary"}
            size="sm"
            onClick={() => onChange(dir)}
            className={`p-2 rounded-lg border transition-colors flex items-center justify-center ${
              value === dir
                ? "bg-primary/20 border-primary text-primary"
                : "bg-bg-2 border-border text-fg-2 hover:text-fg"
            }`}
          />
        ))}
      </div>
    </div>
  );
};

const Toggle: React.FC<{
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between">
    <Text type="supporting" color="secondary" className="text-[10px]">
      {label}
    </Text>
    <MockToggle ariaLabel={label} checked={value} onChange={onChange} />
  </div>
);

/**
 * Transition Preview Animation Component
 */
const TransitionPreview: React.FC<{
  type: TransitionType;
  isPlaying: boolean;
}> = ({ type, isPlaying }) => {
  const [progress, setProgress] = React.useState(0.45);

  React.useEffect(() => {
    if (!isPlaying) {
      setProgress(0.45);
      return;
    }

    const duration = 1000;
    const startTime = Date.now();
    let animationFrame: number;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const p = Math.min(elapsed / duration, 1);
      setProgress(p);

      if (p < 1) {
        animationFrame = requestAnimationFrame(animate);
      } else {
        setTimeout(() => setProgress(0), 200);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying]);

  const getTransitionStyle = (): {
    clipA: React.CSSProperties;
    clipB: React.CSSProperties;
  } => {
    const p = progress;
    switch (type) {
      case "crossfade":
        return {
          clipA: { opacity: 1 - p },
          clipB: { opacity: p },
        };
      case "wipe":
        return {
          clipA: { clipPath: `inset(0 ${p * 100}% 0 0)` },
          clipB: { clipPath: `inset(0 0 0 ${(1 - p) * 100}%)` },
        };
      case "slide":
        return {
          clipA: { transform: `translateX(${-p * 100}%)` },
          clipB: { transform: `translateX(${(1 - p) * 100}%)` },
        };
      case "push":
        return {
          clipA: { transform: `translateX(${-p * 100}%)` },
          clipB: { transform: `translateX(${(1 - p) * 100}%)` },
        };
      case "zoom":
        return {
          clipA: { transform: `scale(${1 + p * 2})`, opacity: 1 - p },
          clipB: { transform: `scale(${2 - p})`, opacity: p },
        };
      case "dipToBlack":
        return {
          clipA: { opacity: p < 0.5 ? 1 - p * 2 : 0 },
          clipB: { opacity: p > 0.5 ? (p - 0.5) * 2 : 0 },
        };
      case "dipToWhite":
        return {
          clipA: { opacity: p < 0.5 ? 1 - p * 2 : 0 },
          clipB: { opacity: p > 0.5 ? (p - 0.5) * 2 : 0 },
        };
      case "circleReveal":
        return {
          clipA: {},
          clipB: { clipPath: `circle(${p * 75}% at 50% 50%)` },
        };
      case "blur": {
        const blur = Math.sin(p * Math.PI) * 12;
        return {
          clipA: { opacity: 1 - p, filter: `blur(${blur}px)` },
          clipB: { opacity: p, filter: `blur(${blur}px)` },
        };
      }
      case "whipPan": {
        const blur = Math.sin(p * Math.PI) * 10;
        return {
          clipA: {
            transform: `translateX(${-p * 100}%)`,
            filter: `blur(${blur}px)`,
          },
          clipB: {
            transform: `translateX(${(1 - p) * 100}%)`,
            filter: `blur(${blur}px)`,
          },
        };
      }
      case "radialWipe": {
        const mask = `conic-gradient(from -90deg,#000 ${p * 360}deg,transparent 0deg)`;
        return {
          clipA: {},
          clipB: { maskImage: mask, WebkitMaskImage: mask },
        };
      }
      case "pixelate": {
        const amount = Math.max(1, Math.round(Math.sin(p * Math.PI) * 10));
        return {
          clipA: {
            opacity: 1 - p,
            imageRendering: "pixelated",
            transform: `scale(${1 + amount / 400})`,
          },
          clipB: {
            opacity: p,
            imageRendering: "pixelated",
            transform: `scale(${1 + amount / 400})`,
          },
        };
      }
      case "glitch": {
        const amount = Math.sin(p * Math.PI) * 16;
        return {
          clipA: {
            opacity: 1 - p * 0.7,
            transform: `translateX(${-amount}px)`,
            filter: `hue-rotate(${-amount * 2}deg)`,
          },
          clipB: {
            opacity: p,
            transform: `translateX(${amount}px)`,
            clipPath:
              "polygon(0 0,100% 0,100% 22%,0 22%,0 36%,100% 36%,100% 58%,0 58%,0 72%,100% 72%,100% 90%,0 90%)",
          },
        };
      }
      case "blinds": {
        const open = Math.max(0.5, p * 16);
        const mask = `repeating-linear-gradient(90deg,#000 0 ${open}px,transparent ${open}px 16px)`;
        return {
          clipA: {},
          clipB: { maskImage: mask, WebkitMaskImage: mask },
        };
      }
      case "diamondReveal":
        return {
          clipA: {},
          clipB: {
            clipPath: `polygon(50% ${50 - p * 70}%, ${50 + p * 70}% 50%, 50% ${50 + p * 70}%, ${50 - p * 70}% 50%)`,
          },
        };
      case "spin": {
        const easedIncoming = Math.max(0, Math.min(1, p));
        return {
          clipA: {
            opacity: 1 - easedIncoming,
            transform: `scale(${1 + easedIncoming * 0.35}) rotate(${easedIncoming * 180}deg)`,
          },
          clipB: {
            opacity: easedIncoming,
            transform: `scale(${0.65 + easedIncoming * 0.35}) rotate(${(easedIncoming - 1) * 180}deg)`,
          },
        };
      }
      case "flip": {
        const outgoingAngle = p * 90;
        const incomingAngle = (1 - p) * -90;
        return {
          clipA: {
            opacity: p < 0.55 ? 1 : 0,
            transform: `perspective(240px) rotateY(${outgoingAngle}deg)`,
            transformOrigin: "center",
          },
          clipB: {
            opacity: p > 0.45 ? 1 : 0,
            transform: `perspective(240px) rotateY(${incomingAngle}deg)`,
            transformOrigin: "center",
          },
        };
      }
      case "splitReveal": {
        const edge = p * 50;
        return {
          clipA: {},
          clipB: {
            clipPath: `polygon(0 ${50 - edge}%,100% ${50 - edge}%,100% ${50 + edge}%,0 ${50 + edge}%)`,
          },
        };
      }
      case "flash": {
        const flashAmount = Math.max(0, 1 - Math.abs(p - 0.5) * 2);
        return {
          clipA: {
            opacity: 1 - p,
            filter: `brightness(${1 + flashAmount * 4})`,
          },
          clipB: {
            opacity: p,
            filter: `brightness(${1 + flashAmount * 4})`,
          },
        };
      }
      case "filmBurn": {
        const burn = Math.max(0, 1 - Math.abs(p - 0.5) * 2);
        return {
          clipA: {
            opacity: 1 - p,
            filter: `sepia(${burn}) saturate(${1 + burn * 2}) brightness(${1 + burn * 1.5})`,
          },
          clipB: {
            opacity: p,
            filter: `sepia(${burn}) saturate(${1 + burn * 2}) brightness(${1 + burn * 1.5})`,
          },
        };
      }
      case "mosaic": {
        const reveal = Math.round(p * 100);
        const mask = `linear-gradient(135deg,#000 ${reveal}%,transparent ${Math.min(100, reveal + 18)}%)`;
        return {
          clipA: {},
          clipB: {
            maskImage: mask,
            WebkitMaskImage: mask,
            imageRendering: "pixelated",
          },
        };
      }
      case "ripple": {
        const wave = Math.sin(p * Math.PI) * 8;
        return {
          clipA: {
            opacity: 1 - p,
            transform: `translateX(${-wave}px) skewY(${wave * 0.25}deg)`,
          },
          clipB: {
            opacity: p,
            transform: `translateX(${wave}px) skewY(${-wave * 0.25}deg)`,
          },
        };
      }
      case "pageTurn":
        return {
          clipA: {
            transform: `perspective(260px) rotateY(${p * 88}deg)`,
            transformOrigin: "left center",
            filter: `brightness(${1 - Math.sin(p * Math.PI) * 0.25})`,
          },
          clipB: {},
        };
      case "colorSplit": {
        const split = Math.sin(p * Math.PI) * 10;
        return {
          clipA: {
            opacity: 1 - p,
            transform: `translateX(${-split}px)`,
            filter: `hue-rotate(${-split * 3}deg)`,
          },
          clipB: {
            opacity: p,
            transform: `translateX(${split}px)`,
            filter: `hue-rotate(${split * 3}deg)`,
          },
        };
      }
      default:
        return { clipA: {}, clipB: {} };
    }
  };

  const styles = getTransitionStyle();
  const dipColor = type === "dipToWhite" ? "bg-white" : "bg-black";

  return (
    <div
      data-transition-preview={type}
      data-preview-progress={progress.toFixed(2)}
      className="relative w-full h-8 rounded overflow-hidden bg-bg-1 mb-2"
    >
      <div
        className="absolute inset-0 bg-primary/20"
        style={{ ...styles.clipA, transition: "none" }}
      />
      <div
        className="absolute inset-0 bg-green-500/30"
        style={{ ...styles.clipB, transition: "none" }}
      />
      {(type === "dipToBlack" || type === "dipToWhite") && (
        <div
          className={`absolute inset-0 ${dipColor}`}
          style={{
            opacity: progress < 0.5 ? progress * 2 : (1 - progress) * 2,
            transition: "none",
          }}
        />
      )}
    </div>
  );
};

/**
 * Transition Type Card Component with Preview
 */
const TransitionTypeCard: React.FC<{
  typeInfo: TransitionTypeInfo;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ typeInfo, isSelected, onSelect }) => {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <ClickableCard
      label={typeInfo.name}
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`p-3 rounded-lg border transition-all text-left ${
        isSelected
          ? "bg-primary/20 border-primary"
          : "bg-bg-2 border-border hover:border-text-secondary"
      }`}
    >
      <TransitionPreview
        type={typeInfo.type}
        isPlaying={isHovered || isSelected}
      />
      <div className="flex items-center justify-between mb-1">
        <Text
          type="supporting"
          className={`text-[10px] font-medium ${
            isSelected ? "text-primary" : "text-fg"
          }`}
        >
          {typeInfo.name}
        </Text>
        {isSelected && <Check size={12} className="text-primary" />}
      </div>
      <Text type="supporting" color="secondary" className="text-[9px]">
        {typeInfo.description}
      </Text>
    </ClickableCard>
  );
};

/**
 * TransitionInspector Props
 */
interface TransitionInspectorProps {
  clipA: Clip;
  clipB?: Clip;
  edge?: TransitionEdge;
  transition?: Transition;
  onTransitionCreate?: (transition: Transition) => void;
  onTransitionUpdate?: (
    transitionId: string,
    updates: Partial<Transition>,
  ) => void;
  onTransitionRemove?: (transitionId: string) => void;
}

/**
 * TransitionInspector Component
 *
 * - 12.1: Display available transition types
 * - 12.2: Apply transition with specified duration
 * - 12.3: Update blend timing when duration is adjusted
 */
export const TransitionInspector: React.FC<TransitionInspectorProps> = ({
  clipA,
  clipB,
  edge,
  transition,
  onTransitionCreate,
  onTransitionUpdate,
  onTransitionRemove,
}) => {
  const bridge = getTransitionBridge();
  const transitionTypes = useMemo(
    () => bridge.getAvailableTransitionTypes(),
    [],
  );

  // Local state for creating new transitions
  const [selectedType, setSelectedType] = useState<TransitionType>(
    transition?.type || "crossfade",
  );
  const [duration, setDuration] = useState<number>(transition?.duration || 1.0);
  const [params, setParams] = useState<Record<string, unknown>>(
    transition?.params || bridge.getDefaultParams(selectedType),
  );

  useEffect(() => {
    const nextType = transition?.type || "crossfade";
    setSelectedType(nextType);
    setDuration(transition?.duration || 1.0);
    setParams(transition?.params || bridge.getDefaultParams(nextType));
  }, [bridge, clipA.id, clipB?.id, edge, transition]);

  // Validate transition
  const validation = useMemo(() => {
    if (!bridge.isInitialized()) {
      bridge.initialize();
    }
    if (edge) {
      return bridge.validateClipEdgeTransition(clipA, duration);
    }
    if (!clipB) {
      return {
        valid: false,
        error: "A second clip is required for clip-to-clip transitions",
      };
    }
    return bridge.validateTransition(clipA, clipB, duration);
  }, [bridge, clipA, clipB, duration, edge]);

  // Handle type change
  const handleTypeChange = useCallback(
    (type: TransitionType) => {
      setSelectedType(type);
      const defaultParams = bridge.getDefaultParams(type);
      const nextParams = {
        ...defaultParams,
        ...(typeof params.audioFade === "boolean"
          ? { audioFade: params.audioFade }
          : {}),
      };
      setParams(nextParams);

      if (transition) {
        onTransitionUpdate?.(transition.id, { type, params: nextParams });
      }
    },
    [bridge, params.audioFade, transition, onTransitionUpdate],
  );

  // Handle duration change
  const handleDurationChange = useCallback(
    (newDuration: number) => {
      const clampedDuration = validation.maxDuration
        ? Math.min(newDuration, validation.maxDuration)
        : newDuration;
      setDuration(clampedDuration);

      if (transition) {
        onTransitionUpdate?.(transition.id, { duration: clampedDuration });
      }
    },
    [transition, validation.maxDuration, onTransitionUpdate],
  );

  // Handle param change
  const handleParamChange = useCallback(
    (key: string, value: unknown) => {
      const newParams = { ...params, [key]: value };
      setParams(newParams);

      if (transition) {
        onTransitionUpdate?.(transition.id, { params: newParams });
      }
    },
    [params, transition, onTransitionUpdate],
  );

  // Handle create transition
  const handleCreate = useCallback(() => {
    const result = edge
      ? bridge.createClipEdgeTransition(clipA, edge, selectedType, duration, params)
      : clipB
        ? bridge.createTransition(clipA, clipB, selectedType, duration, params)
        : {
            success: false,
            error: "A second clip is required",
            transitionId: undefined,
          };

    if (result.success && result.transitionId) {
      const newTransition = bridge.getTransition(result.transitionId);
      if (newTransition) {
        onTransitionCreate?.(newTransition);
        toast.success(
          "Transition Applied",
          `${selectedType} transition added (${duration}s)`,
        );
      }
    } else {
      toast.error(
        "Transition Failed",
        result.error || "Could not apply transition",
      );
    }
  }, [bridge, clipA, clipB, edge, selectedType, duration, params, onTransitionCreate]);

  // Handle remove transition
  const handleRemove = useCallback(() => {
    if (transition) {
      bridge.removeTransition(transition.id);
      onTransitionRemove?.(transition.id);
      toast.success("Transition Removed");
    }
  }, [transition, onTransitionRemove]);

  // Render type-specific parameters
  const renderTypeParams = () => {
    const center =
      params.center && typeof params.center === "object"
        ? (params.center as { x?: number; y?: number })
        : {};
    const centerX = typeof center.x === "number" ? center.x : 0.5;
    const centerY = typeof center.y === "number" ? center.y : 0.5;
    const renderCenterControls = () => (
      <div className="grid grid-cols-2 gap-2">
        <TransitionSlider
          label="Center X"
          value={centerX * 100}
          onChange={(value) =>
            handleParamChange("center", { x: value / 100, y: centerY })
          }
          min={0}
          max={100}
          unit="%"
        />
        <TransitionSlider
          label="Center Y"
          value={centerY * 100}
          onChange={(value) =>
            handleParamChange("center", { x: centerX, y: value / 100 })
          }
          min={0}
          max={100}
          unit="%"
        />
      </div>
    );
    switch (selectedType) {
      case "wipe":
        return (
          <>
            <DirectionSelector
              value={(params.direction as string) || "left"}
              onChange={(dir) => handleParamChange("direction", dir)}
              options={["left", "right", "up", "down"]}
            />
            <TransitionSlider
              label="Softness"
              value={((params.softness as number) || 0) * 100}
              onChange={(v) => handleParamChange("softness", v / 100)}
              min={0}
              max={100}
              unit="%"
            />
          </>
        );

      case "slide":
        return (
          <>
            <DirectionSelector
              value={(params.direction as string) || "left"}
              onChange={(dir) => handleParamChange("direction", dir)}
            />
            <Toggle
              label="Push Out"
              value={(params.pushOut as boolean) || false}
              onChange={(v) => handleParamChange("pushOut", v)}
            />
          </>
        );

      case "push":
        return (
          <DirectionSelector
            value={(params.direction as string) || "left"}
            onChange={(dir) => handleParamChange("direction", dir)}
          />
        );

      case "blur":
        return (
          <TransitionSlider
            label="Blur Strength"
            value={((params.intensity as number) ?? 1) * 100}
            onChange={(value) => handleParamChange("intensity", value / 100)}
            min={0}
            max={200}
            step={5}
            unit="%"
          />
        );

      case "whipPan":
        return (
          <>
            <DirectionSelector
              value={(params.direction as string) || "left"}
              onChange={(direction) => handleParamChange("direction", direction)}
            />
            <TransitionSlider
              label="Motion Blur"
              value={((params.blurIntensity as number) ?? 1) * 100}
              onChange={(value) =>
                handleParamChange("blurIntensity", value / 100)
              }
              min={0}
              max={200}
              step={5}
              unit="%"
            />
          </>
        );

      case "radialWipe":
        return (
          <>
            <TransitionSlider
              label="Start Angle"
              value={(params.startAngle as number) ?? -90}
              onChange={(value) => handleParamChange("startAngle", value)}
              min={-180}
              max={180}
              step={1}
              unit="°"
            />
            <Toggle
              label="Clockwise"
              value={(params.clockwise as boolean) ?? true}
              onChange={(value) => handleParamChange("clockwise", value)}
            />
          </>
        );

      case "zoom":
        return (
          <>
            <TransitionSlider
              label="Scale"
              value={(params.scale as number) || 2}
              onChange={(v) => handleParamChange("scale", v)}
              min={1.1}
              max={4}
              step={0.1}
              unit="x"
            />
            {renderCenterControls()}
          </>
        );

      case "circleReveal":
      case "diamondReveal":
        return renderCenterControls();

      case "dipToBlack":
      case "dipToWhite":
        return (
          <TransitionSlider
            label="Hold Duration"
            value={(params.holdDuration as number) || 0.1}
            onChange={(v) => handleParamChange("holdDuration", v)}
            min={0}
            max={1}
            step={0.05}
            unit="s"
          />
        );

      case "pixelate":
        return (
          <TransitionSlider
            label="Maximum Pixel Size"
            value={(params.maxPixelSize as number) || 48}
            onChange={(v) => handleParamChange("maxPixelSize", v)}
            min={4}
            max={128}
            step={2}
            unit="px"
          />
        );

      case "glitch":
        return (
          <>
            <TransitionSlider
              label="Intensity"
              value={((params.intensity as number) || 0.08) * 100}
              onChange={(v) => handleParamChange("intensity", v / 100)}
              min={1}
              max={25}
              unit="%"
            />
            <TransitionSlider
              label="Slices"
              value={(params.slices as number) || 12}
              onChange={(v) => handleParamChange("slices", v)}
              min={4}
              max={40}
              step={1}
            />
          </>
        );

      case "blinds":
        return (
          <>
            <DirectionSelector
              value={(params.direction as string) || "vertical"}
              onChange={(direction) =>
                handleParamChange("direction", direction)
              }
              options={["vertical", "horizontal"]}
            />
            <TransitionSlider
              label="Slats"
              value={(params.count as number) || 8}
              onChange={(v) => handleParamChange("count", v)}
              min={2}
              max={32}
              step={1}
            />
          </>
        );

      case "spin":
        return (
          <TransitionSlider
            label="Rotations"
            value={(params.rotations as number) ?? 1}
            onChange={(value) => handleParamChange("rotations", value)}
            min={-2}
            max={2}
            step={0.25}
          />
        );

      case "flip":
        return (
          <DirectionSelector
            value={(params.axis as string) || "horizontal"}
            onChange={(axis) => handleParamChange("axis", axis)}
            options={["horizontal", "vertical"]}
          />
        );

      case "splitReveal":
        return (
          <DirectionSelector
            value={(params.orientation as string) || "horizontal"}
            onChange={(orientation) =>
              handleParamChange("orientation", orientation)
            }
            options={["horizontal", "vertical"]}
          />
        );

      case "flash":
        return (
          <TransitionSlider
            label="Flash Intensity"
            value={((params.intensity as number) ?? 1) * 100}
            onChange={(value) => handleParamChange("intensity", value / 100)}
            min={0}
            max={150}
            step={5}
            unit="%"
          />
        );

      case "filmBurn":
        return (
          <>
            <TransitionSlider
              label="Burn Intensity"
              value={((params.intensity as number) ?? 1) * 100}
              onChange={(value) => handleParamChange("intensity", value / 100)}
              min={0}
              max={200}
              step={5}
              unit="%"
            />
            <TransitionSlider
              label="Warmth"
              value={((params.warmth as number) ?? 0.75) * 100}
              onChange={(value) => handleParamChange("warmth", value / 100)}
              min={0}
              max={100}
              step={5}
              unit="%"
            />
          </>
        );

      case "mosaic":
        return (
          <>
            <TransitionSlider
              label="Tile Columns"
              value={(params.tiles as number) ?? 8}
              onChange={(value) => handleParamChange("tiles", value)}
              min={2}
              max={24}
              step={1}
            />
            <TransitionSlider
              label="Randomness"
              value={((params.randomness as number) ?? 0.85) * 100}
              onChange={(value) => handleParamChange("randomness", value / 100)}
              min={0}
              max={100}
              step={5}
              unit="%"
            />
          </>
        );

      case "ripple":
        return (
          <>
            <TransitionSlider
              label="Amplitude"
              value={((params.amplitude as number) ?? 0.04) * 100}
              onChange={(value) => handleParamChange("amplitude", value / 100)}
              min={0}
              max={20}
              step={0.5}
              unit="%"
            />
            <TransitionSlider
              label="Waves"
              value={(params.waves as number) ?? 3}
              onChange={(value) => handleParamChange("waves", value)}
              min={0.5}
              max={12}
              step={0.5}
            />
          </>
        );

      case "pageTurn":
        return (
          <>
            <DirectionSelector
              value={(params.direction as string) || "left"}
              onChange={(direction) => handleParamChange("direction", direction)}
              options={["left", "right"]}
            />
            <TransitionSlider
              label="Fold Shadow"
              value={((params.shadow as number) ?? 0.55) * 100}
              onChange={(value) => handleParamChange("shadow", value / 100)}
              min={0}
              max={100}
              step={5}
              unit="%"
            />
          </>
        );

      case "colorSplit":
        return (
          <>
            <TransitionSlider
              label="Maximum Offset"
              value={(params.maxOffset as number) ?? 18}
              onChange={(value) => handleParamChange("maxOffset", value)}
              min={0}
              max={80}
              step={1}
              unit="px"
            />
            <TransitionSlider
              label="Angle"
              value={(params.angle as number) ?? 0}
              onChange={(value) => handleParamChange("angle", value)}
              min={0}
              max={360}
              step={5}
              unit="°"
            />
          </>
        );

      case "crossfade":
      default:
        return null;
    }
  };

  const selectedTypeInfo = transitionTypes.find((t) => t.type === selectedType);
  const fromLabel = edge === "in" ? "Background" : `${clipA.id.substring(0, 12)}...`;
  const toLabel =
    edge === "out"
      ? "Background"
      : `${(clipB ?? clipA).id.substring(0, 12)}...`;

  return (
    <div className="space-y-4">
      {/* Clip Info */}
      <Card variant="muted" padding={2} className="flex items-center gap-2 border border-border">
        <div className="flex-1 min-w-0 flex flex-col items-center gap-0.5 text-center">
          <Text type="supporting" color="secondary" display="block" className="text-[9px]">
            From
          </Text>
          <Text type="supporting" color="primary" display="block" maxLines={1} className="w-full truncate text-[10px]">
            {fromLabel}
          </Text>
        </div>
        <ArrowRight size={14} className="text-fg-3" />
        <div className="flex-1 min-w-0 flex flex-col items-center gap-0.5 text-center">
          <Text type="supporting" color="secondary" display="block" className="text-[9px]">
            To
          </Text>
          <Text type="supporting" color="primary" display="block" maxLines={1} className="w-full truncate text-[10px]">
            {toLabel}
          </Text>
        </div>
      </Card>

      {/* Validation Warning */}
      {validation.warning && (
        <Card variant="muted" padding={2} className="border border-yellow-500/30 bg-yellow-500/10">
          <Text type="supporting" className="text-[10px] text-yellow-500">
            {validation.warning}
          </Text>
        </Card>
      )}

      {/* Transition Type Selector */}
      <div className="space-y-2">
        <Text type="supporting" color="secondary" className="text-[10px] font-medium">
          Transition Type
        </Text>
        <div className="grid grid-cols-2 gap-2">
          {transitionTypes.map((typeInfo) => (
            <TransitionTypeCard
              key={typeInfo.type}
              typeInfo={typeInfo}
              isSelected={selectedType === typeInfo.type}
              onSelect={() => handleTypeChange(typeInfo.type)}
            />
          ))}
        </div>
      </div>

      {/* Duration Slider */}
      <TransitionSlider
        label="Duration"
        value={duration}
        onChange={handleDurationChange}
        min={0.1}
        max={validation.maxDuration || 5}
        step={0.1}
        unit="s"
      />

      <Toggle
        label={edge ? "Fade clip audio" : "Smooth transition audio"}
        value={(params.audioFade as boolean) ?? false}
        onChange={(value) => handleParamChange("audioFade", value)}
      />

      {/* Type-specific Parameters */}
      {selectedTypeInfo?.hasCustomParams && (
        <div className="space-y-3 pt-2 border-t border-border">
          <Text type="supporting" color="secondary" className="text-[10px] font-medium">
            Parameters
          </Text>
          {renderTypeParams()}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2 pt-2">
        {transition ? (
          <Button
            label="Remove Transition"
            icon={<X size={12} />}
            variant="secondary"
            size="sm"
            onClick={handleRemove}
            className="flex-1 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-[10px] text-red-400 hover:bg-red-500/20 transition-colors flex items-center justify-center gap-1"
          />
        ) : (
          <Button
            label="Apply Transition"
            icon={<Check size={12} />}
            variant={validation.valid ? "primary" : "secondary"}
            size="sm"
            onClick={handleCreate}
            isDisabled={!validation.valid}
            className={`flex-1 py-2 rounded-lg text-[10px] transition-colors flex items-center justify-center gap-1 ${
              validation.valid
                ? "bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20"
                : "bg-bg-2 border border-border text-fg-3 cursor-not-allowed"
            }`}
          />
        )}
      </div>

      {/* Error Message */}
      {!validation.valid && validation.error && (
        <Text type="supporting" className="block text-center text-[10px] text-red-400">
          {validation.error}
        </Text>
      )}
    </div>
  );
};

export default TransitionInspector;
