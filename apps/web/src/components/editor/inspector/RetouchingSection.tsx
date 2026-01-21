import React, { useMemo } from "react";
import { Eraser, Copy, Eye, Target, MousePointer2 } from "lucide-react";
import { LabeledSlider as Slider } from "@openreel/ui";

export type RetouchingTool = "spotHeal" | "cloneStamp" | "redEyeRemoval";

export interface BrushConfig {
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
}

export interface CloneSource {
  x: number;
  y: number;
  layerId: string | null;
}

/**
 * Tool Button Component
 */
const ToolButton: React.FC<{
  tool: RetouchingTool;
  isActive: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}> = ({ isActive, onClick, icon, label, description }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-3 w-full p-3 rounded-lg transition-colors ${
      isActive
        ? "bg-primary/20 border border-primary"
        : "bg-background-tertiary border border-transparent hover:border-border"
    }`}
  >
    <div
      className={`p-2 rounded-lg ${
        isActive
          ? "bg-primary text-white"
          : "bg-background-secondary text-text-secondary"
      }`}
    >
      {icon}
    </div>
    <div className="text-left">
      <span
        className={`text-[11px] font-medium block ${
          isActive ? "text-primary" : "text-text-primary"
        }`}
      >
        {label}
      </span>
      <span className="text-[9px] text-text-muted">{description}</span>
    </div>
  </button>
);

/**
 * Brush Preview Component
 */
const BrushPreview: React.FC<{
  size: number;
  hardness: number;
}> = ({ size, hardness }) => {
  // Scale size for preview (max 60px display)
  const displaySize = Math.min(size, 60);

  return (
    <div className="flex items-center justify-center p-4 bg-background-tertiary rounded-lg">
      <div
        className="relative rounded-full"
        style={{
          width: displaySize,
          height: displaySize,
          background: `radial-gradient(circle, rgba(255,255,255,${hardness}) 0%, rgba(255,255,255,0) 100%)`,
          border: "1px solid rgba(255,255,255,0.3)",
        }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle, rgba(59,130,246,1) ${
              hardness * 100
            }%, rgba(59,130,246,0) 100%)`,
          }}
        />
      </div>
      <span className="ml-3 text-[10px] text-text-muted">
        {size}px @ {Math.round(hardness * 100)}%
      </span>
    </div>
  );
};

/**
 * Clone Source Indicator Component
 */
const CloneSourceIndicator: React.FC<{
  source: CloneSource | null;
  onClear: () => void;
}> = ({ source, onClear }) => {
  if (!source) {
    return (
      <div className="p-3 bg-background-tertiary rounded-lg text-center">
        <Target size={20} className="mx-auto mb-1 text-text-muted" />
        <p className="text-[10px] text-text-muted">
          Alt+Click to set clone source
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 bg-background-tertiary rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target size={14} className="text-primary" />
          <span className="text-[10px] text-text-primary">Clone Source</span>
        </div>
        <button
          onClick={onClear}
          className="text-[9px] text-text-muted hover:text-error transition-colors"
        >
          Clear
        </button>
      </div>
      <div className="mt-2 flex items-center gap-4">
        <span className="text-[9px] text-text-muted">
          X:{" "}
          <span className="text-text-primary font-mono">
            {Math.round(source.x)}
          </span>
        </span>
        <span className="text-[9px] text-text-muted">
          Y:{" "}
          <span className="text-text-primary font-mono">
            {Math.round(source.y)}
          </span>
        </span>
      </div>
    </div>
  );
};

/**
 * RetouchingSection Props
 */
interface RetouchingSectionProps {
  activeTool: RetouchingTool;
  brushConfig: BrushConfig;
  cloneSource: CloneSource | null;
  onToolChange: (tool: RetouchingTool) => void;
  onBrushSizeChange: (size: number) => void;
  onBrushHardnessChange: (hardness: number) => void;
  onBrushOpacityChange: (opacity: number) => void;
  onBrushFlowChange: (flow: number) => void;
  onClearCloneSource: () => void;
}

/**
 * RetouchingSection Component
 *
 * - 19.1: Spot healing tool samples surrounding pixels and blends
 * - 19.2: Clone stamp tool copies pixels from source to target
 * - 19.3: Red-eye removal tool detects and desaturates red pixels
 * - 19.4: Brush size updates area of effect
 * - 19.5: Brush hardness modifies edge falloff
 */
export const RetouchingSection: React.FC<RetouchingSectionProps> = ({
  activeTool,
  brushConfig,
  cloneSource,
  onToolChange,
  onBrushSizeChange,
  onBrushHardnessChange,
  onBrushOpacityChange,
  onBrushFlowChange,
  onClearCloneSource,
}) => {
  // Tool definitions
  const tools = useMemo(
    () => [
      {
        id: "spotHeal" as RetouchingTool,
        icon: <Eraser size={16} />,
        label: "Spot Healing",
        description: "Remove blemishes by sampling surrounding pixels",
      },
      {
        id: "cloneStamp" as RetouchingTool,
        icon: <Copy size={16} />,
        label: "Clone Stamp",
        description: "Copy pixels from source to target",
      },
      {
        id: "redEyeRemoval" as RetouchingTool,
        icon: <Eye size={16} />,
        label: "Red-Eye Removal",
        description: "Remove red-eye from photos",
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      {/* Tool Selection */}
      <div className="space-y-2">
        <span className="text-[10px] text-text-secondary font-medium">
          Retouching Tools
        </span>
        <div className="space-y-2">
          {tools.map((tool) => (
            <ToolButton
              key={tool.id}
              tool={tool.id}
              isActive={activeTool === tool.id}
              onClick={() => onToolChange(tool.id)}
              icon={tool.icon}
              label={tool.label}
              description={tool.description}
            />
          ))}
        </div>
      </div>

      {/* Clone Source (only for clone stamp) */}
      {activeTool === "cloneStamp" && (
        <div className="space-y-2">
          <span className="text-[10px] text-text-secondary font-medium">
            Clone Source
          </span>
          <CloneSourceIndicator
            source={cloneSource}
            onClear={onClearCloneSource}
          />
        </div>
      )}

      {/* Brush Settings */}
      <div className="space-y-3 p-3 bg-background-tertiary rounded-lg">
        <span className="text-[10px] text-text-secondary font-medium">
          Brush Settings
        </span>

        {/* Brush Preview */}
        <BrushPreview size={brushConfig.size} hardness={brushConfig.hardness} />

        {/* Size Slider */}
        <Slider
          label="Size"
          value={brushConfig.size}
          onChange={onBrushSizeChange}
          min={1}
          max={500}
          step={1}
          unit="px"
        />

        {/* Hardness Slider */}
        <Slider
          label="Hardness"
          value={brushConfig.hardness * 100}
          onChange={(value) => onBrushHardnessChange(value / 100)}
          min={0}
          max={100}
          step={1}
          unit="%"
        />

        {/* Opacity Slider */}
        <Slider
          label="Opacity"
          value={brushConfig.opacity * 100}
          onChange={(value) => onBrushOpacityChange(value / 100)}
          min={0}
          max={100}
          step={1}
          unit="%"
        />

        {/* Flow Slider (for spot healing and clone stamp) */}
        {(activeTool === "spotHeal" || activeTool === "cloneStamp") && (
          <Slider
            label="Flow"
            value={brushConfig.flow * 100}
            onChange={(value) => onBrushFlowChange(value / 100)}
            min={0}
            max={100}
            step={1}
            unit="%"
          />
        )}
      </div>

      {/* Tool-specific instructions */}
      <div className="p-3 bg-background-secondary rounded-lg border border-border">
        <div className="flex items-start gap-2">
          <MousePointer2 size={14} className="text-text-muted mt-0.5" />
          <div>
            <span className="text-[10px] text-text-primary font-medium block">
              How to use
            </span>
            <p className="text-[9px] text-text-muted mt-1">
              {activeTool === "spotHeal" &&
                "Click and drag over blemishes to remove them. The tool samples surrounding pixels to blend seamlessly."}
              {activeTool === "cloneStamp" &&
                "Alt+Click to set source point, then paint to copy pixels from source to target."}
              {activeTool === "redEyeRemoval" &&
                "Click on red eyes to automatically detect and remove the red-eye effect."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RetouchingSection;
