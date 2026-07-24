import React, { useMemo } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { Eraser, Copy, Eye, Target, MousePointer2 } from "@/icons/lucide-compat";

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
  <ClickableCard
    label={label}
    onClick={onClick}
    className={`flex items-center gap-3 w-full p-3 rounded-lg transition-colors ${
      isActive
        ? "bg-primary/20 border border-primary"
        : "bg-bg-2 border border-transparent hover:border-border"
    }`}
  >
    <div
      className={`p-2 rounded-lg ${
        isActive
          ? "bg-primary text-white"
          : "bg-bg-1 text-fg-2"
      }`}
    >
      {icon}
    </div>
    <div className="text-left">
      <Text
        type="supporting"
        weight="medium"
        className={`text-[11px] font-medium block ${
          isActive ? "text-primary" : "text-fg"
        }`}
      >
        {label}
      </Text>
      <Text type="supporting" color="secondary" className="text-[9px]">
        {description}
      </Text>
    </div>
  </ClickableCard>
);

const BrushSlider: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
}> = ({ label, value, onChange, min, max, step, unit }) => (
  <PropertySlider
    label={label}
    value={value}
    onChange={onChange}
    min={min}
    max={max}
    step={step}
    formatValue={(nextValue) => `${Math.round(nextValue)}${unit}`}
  />
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
    <div className="flex items-center justify-center p-4 bg-bg-2 rounded-lg">
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
      <Text type="supporting" color="secondary" className="ml-3 text-[10px]">
        {size}px @ {Math.round(hardness * 100)}%
      </Text>
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
      <div className="p-3 bg-bg-2 rounded-lg text-center">
        <Target size={20} className="mx-auto mb-1 text-fg-3" />
        <Text type="supporting" color="secondary">
          Alt+Click to set clone source
        </Text>
      </div>
    );
  }

  return (
    <div className="p-3 bg-bg-2 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target size={14} className="text-primary" />
          <Text type="supporting" color="primary">
            Clone Source
          </Text>
        </div>
        <Button
          label="Clear"
          size="sm"
          variant="ghost"
          onClick={onClear}
          className="text-[9px] text-fg-3 hover:text-error transition-colors"
        />
      </div>
      <div className="mt-2 flex items-center gap-4">
        <div className="flex items-center gap-1">
          <Text type="supporting" color="secondary" className="text-[9px]">
            X:
          </Text>
          <Text type="supporting" color="primary" className="text-[9px] font-mono">
            {Math.round(source.x)}
          </Text>
        </div>
        <div className="flex items-center gap-1">
          <Text type="supporting" color="secondary" className="text-[9px]">
            Y:
          </Text>
          <Text type="supporting" color="primary" className="text-[9px] font-mono">
            {Math.round(source.y)}
          </Text>
        </div>
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
        <Text type="supporting" color="secondary" weight="medium">
          Retouching Tools
        </Text>
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
          <Text type="supporting" color="secondary" weight="medium">
            Clone Source
          </Text>
          <CloneSourceIndicator
            source={cloneSource}
            onClear={onClearCloneSource}
          />
        </div>
      )}

      {/* Brush Settings */}
      <Card variant="muted" padding={3}>
        <div className="space-y-3">
          <Text type="supporting" color="secondary" weight="medium">
            Brush Settings
          </Text>

          {/* Brush Preview */}
          <BrushPreview size={brushConfig.size} hardness={brushConfig.hardness} />

          {/* Size Slider */}
          <BrushSlider
            label="Size"
            value={brushConfig.size}
            onChange={onBrushSizeChange}
            min={1}
            max={500}
            step={1}
            unit="px"
          />

          {/* Hardness Slider */}
          <BrushSlider
            label="Hardness"
            value={brushConfig.hardness * 100}
            onChange={(value) => onBrushHardnessChange(value / 100)}
            min={0}
            max={100}
            step={1}
            unit="%"
          />

          {/* Opacity Slider */}
          <BrushSlider
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
            <BrushSlider
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
      </Card>

      {/* Tool-specific instructions */}
      <Card variant="muted" padding={3}>
        <div className="flex items-start gap-2">
          <MousePointer2 size={14} className="text-fg-3 mt-0.5" />
          <div className="flex flex-col gap-1">
            <Text type="supporting" color="primary" weight="medium">
              How to use
            </Text>
            <Text type="supporting" color="secondary" className="mt-1 text-[9px]">
              {activeTool === "spotHeal" &&
                "Click and drag over blemishes to remove them. The tool samples surrounding pixels to blend seamlessly."}
              {activeTool === "cloneStamp" &&
                "Alt+Click to set source point, then paint to copy pixels from source to target."}
              {activeTool === "redEyeRemoval" &&
                "Click on red eyes to automatically detect and remove the red-eye effect."}
            </Text>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default RetouchingSection;
