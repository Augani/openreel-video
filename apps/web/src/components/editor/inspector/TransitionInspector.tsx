import React, { useCallback, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  X,
  Check,
} from "lucide-react";
import {
  getTransitionBridge,
  type TransitionTypeInfo,
} from "../../../bridges/transition-bridge";
import type { Transition, Clip } from "@openreel/core";
import type { TransitionType } from "@openreel/core";
import { toast } from "../../../stores/notification-store";
import { LabeledSlider, Switch } from "@openreel/ui";

const TransitionSlider = LabeledSlider;

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
      <span className="text-[10px] text-text-secondary">Direction</span>
      <div className="grid grid-cols-4 gap-1">
        {options.map((dir) => (
          <button
            key={dir}
            onClick={() => onChange(dir)}
            className={`p-2 rounded-lg border transition-colors flex items-center justify-center ${
              value === dir
                ? "bg-primary/20 border-primary text-primary"
                : "bg-background-tertiary border-border text-text-secondary hover:text-text-primary"
            }`}
            title={dir.charAt(0).toUpperCase() + dir.slice(1)}
          >
            {directionIcons[dir] || dir}
          </button>
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
    <span className="text-[10px] text-text-secondary">{label}</span>
    <Switch checked={value} onCheckedChange={onChange} />
  </div>
);

/**
 * Transition Preview Animation Component
 */
const TransitionPreview: React.FC<{
  type: TransitionType;
  isPlaying: boolean;
}> = ({ type, isPlaying }) => {
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    if (!isPlaying) {
      setProgress(0);
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
      default:
        return { clipA: {}, clipB: {} };
    }
  };

  const styles = getTransitionStyle();
  const dipColor = type === "dipToWhite" ? "bg-white" : "bg-black";

  return (
    <div className="relative w-full h-8 rounded overflow-hidden bg-background-secondary mb-2">
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
    <button
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`p-3 rounded-lg border transition-all text-left ${
        isSelected
          ? "bg-primary/20 border-primary"
          : "bg-background-tertiary border-border hover:border-text-secondary"
      }`}
    >
      <TransitionPreview
        type={typeInfo.type}
        isPlaying={isHovered || isSelected}
      />
      <div className="flex items-center justify-between mb-1">
        <span
          className={`text-[10px] font-medium ${
            isSelected ? "text-primary" : "text-text-primary"
          }`}
        >
          {typeInfo.name}
        </span>
        {isSelected && <Check size={12} className="text-primary" />}
      </div>
      <p className="text-[9px] text-text-muted">{typeInfo.description}</p>
    </button>
  );
};

/**
 * TransitionInspector Props
 */
interface TransitionInspectorProps {
  clipA: Clip;
  clipB: Clip;
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

  // Validate transition
  const validation = useMemo(() => {
    if (!bridge.isInitialized()) {
      bridge.initialize();
    }
    return bridge.validateTransition(clipA, clipB, duration);
  }, [clipA, clipB, duration]);

  // Handle type change
  const handleTypeChange = useCallback(
    (type: TransitionType) => {
      setSelectedType(type);
      const defaultParams = bridge.getDefaultParams(type);
      setParams(defaultParams);

      if (transition) {
        onTransitionUpdate?.(transition.id, { type, params: defaultParams });
      }
    },
    [transition, onTransitionUpdate],
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
    const result = bridge.createTransition(
      clipA,
      clipB,
      selectedType,
      duration,
      params,
    );

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
  }, [clipA, clipB, selectedType, duration, params, onTransitionCreate]);

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

      case "zoom":
        return (
          <TransitionSlider
            label="Scale"
            value={(params.scale as number) || 2}
            onChange={(v) => handleParamChange("scale", v)}
            min={1.1}
            max={4}
            step={0.1}
            unit="x"
          />
        );

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

      case "crossfade":
      default:
        return null;
    }
  };

  const selectedTypeInfo = transitionTypes.find((t) => t.type === selectedType);

  return (
    <div className="space-y-4">
      {/* Clip Info */}
      <div className="flex items-center gap-2 p-2 bg-background-tertiary rounded-lg border border-border">
        <div className="flex-1 text-center">
          <p className="text-[9px] text-text-muted">From</p>
          <p className="text-[10px] text-text-primary truncate">
            {clipA.id.substring(0, 12)}...
          </p>
        </div>
        <ArrowRight size={14} className="text-text-muted" />
        <div className="flex-1 text-center">
          <p className="text-[9px] text-text-muted">To</p>
          <p className="text-[10px] text-text-primary truncate">
            {clipB.id.substring(0, 12)}...
          </p>
        </div>
      </div>

      {/* Validation Warning */}
      {validation.warning && (
        <div className="p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <p className="text-[10px] text-yellow-500">{validation.warning}</p>
        </div>
      )}

      {/* Transition Type Selector */}
      <div className="space-y-2">
        <span className="text-[10px] text-text-secondary font-medium">
          Transition Type
        </span>
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

      {/* Type-specific Parameters */}
      {selectedTypeInfo?.hasCustomParams && (
        <div className="space-y-3 pt-2 border-t border-border">
          <span className="text-[10px] text-text-secondary font-medium">
            Parameters
          </span>
          {renderTypeParams()}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2 pt-2">
        {transition ? (
          <button
            onClick={handleRemove}
            className="flex-1 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-[10px] text-red-400 hover:bg-red-500/20 transition-colors flex items-center justify-center gap-1"
          >
            <X size={12} />
            Remove Transition
          </button>
        ) : (
          <button
            onClick={handleCreate}
            disabled={!validation.valid}
            className={`flex-1 py-2 rounded-lg text-[10px] transition-colors flex items-center justify-center gap-1 ${
              validation.valid
                ? "bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20"
                : "bg-background-tertiary border border-border text-text-muted cursor-not-allowed"
            }`}
          >
            <Check size={12} />
            Apply Transition
          </button>
        )}
      </div>

      {/* Error Message */}
      {!validation.valid && validation.error && (
        <p className="text-[10px] text-red-400 text-center">
          {validation.error}
        </p>
      )}
    </div>
  );
};

export default TransitionInspector;
