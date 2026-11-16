import React, { useCallback, useMemo } from "react";
import { ToggleGroup, ToggleGroupItem, Label, Input, Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from "@openreel/ui";
import { useShallow } from "zustand/react/shallow";
import { useNumericDraft } from "./shell/useNumericDraft";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { Button, cn } from "@openreel/ui";
import { Card } from "@openreel/ui";

import {
  Square,
  Circle,
  Triangle,
  Star,
  Hexagon,
  ArrowRight,
} from "@/icons/lucide-compat";
import { PropertySlider } from "./shell/PropertySlider";
import { useProjectStore } from "../../../stores/project-store";
import type {
  MotionShaderFill,
  MotionShaderParamValue,
  ShapeStyle,
  FillStyle,
  StrokeStyle,
} from "@openreel/core";
import {
  getMotionShaderDef,
  getMotionShaderFillDefs,
} from "@openreel/core";
import {
  createDefaultEditorShader,
  groupShaderDefsByCollection,
  ShaderParamFields,
} from "./ShaderControls";
import { ColorSelector } from "../../../motion/components/primitives";

const ColorField: React.FC<{
  label: string;
  value: string;
  onChange: (color: string) => void;
  showAlpha?: boolean;
}> = ({ label, value, onChange, showAlpha = false }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-[12px] leading-5 text-fg-2 font-normal">
      {label}
    </span>
    <div className="flex max-w-[190px] items-center">
      <ColorSelector
        value={value}
        onChange={onChange}
        label={`Select ${label.toLowerCase()}`}
        showAlpha={showAlpha}
      />
    </div>
  </div>
);

const NumberInput: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}> = ({ label, value, onChange, min = 0, max = 1000, step = 1, unit = "" }) => {
  const input = useNumericDraft({ value, onChange, min, max, step });
  return <Label className="flex min-w-0 items-center justify-between gap-3 text-[12px] font-normal text-fg-2">
    <span>{label}</span>
    <span className="flex h-[30px] w-[120px] min-w-0 items-center gap-1 rounded-[6px] border border-border bg-bg-1 px-2 focus-within:border-accent">
      <Input {...input} type="text" inputMode="decimal" role="spinbutton" aria-label={label}
        aria-valuenow={Number.isFinite(value) ? value : 0} aria-valuemin={min} aria-valuemax={max}
        className="h-5 min-w-0 border-0 bg-transparent p-0 text-right font-mono text-[11px] shadow-none focus-visible:ring-0" />
      {unit && <span className="text-[10.5px] text-fg-3">{unit}</span>}
    </span>
  </Label>;
};

const SliderField: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}> = ({ label, value, onChange, min = 0, max = 100, step = 1, unit = "" }) => (
  <PropertySlider
    label={label}
    min={min}
    max={max}
    step={step}
    value={value}
    onChange={onChange}
    formatValue={(nextValue) => `${nextValue}${unit}`}
  />
);

const StrokeStyleSelector: React.FC<{
  value: number[] | undefined;
  onChange: (dashArray: number[] | undefined) => void;
}> = ({ value, onChange }) => {
  const styles = [
    { value: undefined, label: "Solid", preview: "────" },
    { value: [5, 5], label: "Dashed", preview: "- - -" },
    { value: [2, 2], label: "Dotted", preview: "• • •" },
  ];

  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] leading-5 text-fg-2 font-normal">
        Style
      </span>
      <div className="flex gap-1">
        {styles.map((style, index) => (
          <Button key={index} onClick={() => onChange(style.value)} type="button" aria-label={`${style.label} stroke`} aria-pressed={(style.value === undefined && value === undefined) || !!(style.value && value && style.value[0] === value[0])} className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", ((style.value === undefined && value === undefined) ||
              (style.value && value && style.value[0] === value[0]) ? "bg-accent text-accent-fg hover:bg-accent/90" : "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"))}>
            {(style.preview) ? <span className="truncate">{style.preview}</span> : null}
          </Button>
        ))}
      </div>
    </div>
  );
};

const ShapeTypeDisplay: React.FC<{
  shapeType: string;
}> = ({ shapeType }) => {
  const shapeIcons: Record<string, React.ReactNode> = {
    rectangle: <Square size={16} />,
    circle: <Circle size={16} />,
    ellipse: <Circle size={16} />,
    triangle: <Triangle size={16} />,
    star: <Star size={16} />,
    polygon: <Hexagon size={16} />,
    arrow: <ArrowRight size={16} />,
  };

  return (
    <div className="flex items-center gap-2 p-2 bg-bg-2 rounded-lg">
      <div className="p-1.5 bg-bg-1 rounded">
        {shapeIcons[shapeType] || <Square size={16} />}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] leading-5 text-fg font-medium capitalize">
          {shapeType}
        </span>
        <span className="text-fg-2 font-normal text-[9px]">
          Shape clip
        </span>
      </div>
    </div>
  );
};

function firstShapeShaderFillId(): string {
  return getMotionShaderFillDefs()[0]?.id ?? "liquid-metal";
}

interface ShapeSectionProps {
  clipId: string;
}

export const ShapeSection: React.FC<ShapeSectionProps> = ({ clipId }) => {
  const { getShapeClip, project } = useProjectStore(useShallow(state => ({ getShapeClip: state.getShapeClip, project: state.project })));
  const exporting = useUIStore(state => state.exportState.isExporting);
  const operationLocked = useTimelineStore(state => Boolean(state.playbackLockedReason));

  const shapeClip = getShapeClip(clipId);

  const defaultFill: FillStyle = {
    type: "solid",
    color: "#3b82f6",
    opacity: 1,
  };

  const defaultStroke: StrokeStyle = {
    color: "#1d4ed8",
    width: 2,
    opacity: 1,
  };

  const defaultStyle: ShapeStyle = {
    fill: defaultFill,
    stroke: defaultStroke,
  };

  const style = shapeClip?.style || defaultStyle;
  const shapeType = shapeClip?.shapeType || "rectangle";

  const handleStyleChange = useCallback(
    (changes: Partial<ShapeStyle>) => {
      const state = useProjectStore.getState();
      const current = state.getShapeClip(clipId);
      if (state.project.id !== project.id || !current
        || !state.project.timeline.tracks.some(track => track.id === current.trackId && !track.locked)
        || useUIStore.getState().exportState.isExporting || useTimelineStore.getState().playbackLockedReason) return;
      state.updateShapeStyle(clipId, changes);
    },
    [clipId, project.id],
  );

  if (!shapeClip) {
    return (
      <div className="p-4 text-center">
        <Square size={24} className="mx-auto mb-2 text-fg-3" />
        <span className="text-[12px] leading-5 text-fg-2 font-normal">
          No shape clip selected
        </span>
      </div>
    );
  }

  return (
    <fieldset key={`${project.id}:${clipId}`} className="min-w-0 space-y-4 border-0 p-0" disabled={exporting || operationLocked || !project.timeline.tracks.some(track => track.id === shapeClip.trackId && !track.locked)}>
      <ShapeTypeDisplay shapeType={shapeType} />

      <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3">
        <div className="space-y-2">
          <span className="text-[12px] leading-5 text-fg font-medium">
            Fill
          </span>
          <ToggleGroup type="single"
            aria-label="Fill Type" className="grid grid-cols-2 gap-1"
            value={style.fill?.type === "shader" ? "shader" : "solid"}
            onValueChange={(fillType) => {
              if (fillType !== "solid" && fillType !== "shader") return;
              if (fillType === "shader") {
                const shader = createDefaultEditorShader(
                  style.fill?.shader?.shaderId ?? firstShapeShaderFillId(),
                );
                if (!shader) return;
                handleStyleChange({
                  fill: {
                    ...style.fill,
                    type: "shader",
                    opacity: style.fill?.opacity ?? 1,
                    shader,
                  },
                });
                return;
              }
              handleStyleChange({
                fill: {
                  ...style.fill,
                  type: "solid",
                  color: style.fill?.color || "#14b8a6",
                  opacity: style.fill?.opacity ?? 1,
                },
              });
            }}
          >
            <ToggleGroupItem value="solid" className="h-[30px] text-xs">Solid</ToggleGroupItem>
            <ToggleGroupItem value="shader" className="h-[30px] text-xs">Shader</ToggleGroupItem>
          </ToggleGroup>
          {style.fill?.type === "shader" && style.fill.shader ? (
            <ShapeShaderFillControls
              historyKey={`${project.id}:${clipId}`}
              shader={style.fill.shader}
              onChange={(shader) =>
                handleStyleChange({
                  fill: {
                    ...style.fill,
                    type: "shader",
                    opacity: style.fill?.opacity ?? 1,
                    shader,
                  },
                })
              }
            />
          ) : (
            <ColorField
              label="Color"
              value={style.fill?.color || "#3b82f6"}
              onChange={(color) =>
                handleStyleChange({
                  fill: {
                    ...style.fill,
                    color,
                    type: "solid",
                    opacity: style.fill?.opacity ?? 1,
                  },
                })
              }
            />
          )}
          <SliderField
            label="Opacity"
            value={(style.fill?.opacity ?? 1) * 100}
            onChange={(opacity) =>
              handleStyleChange({
                fill: {
                  ...style.fill,
                  opacity: opacity / 100,
                  type: style.fill?.type || "solid",
                },
              })
            }
            min={0}
            max={100}
            unit="%"
          />
        </div>
      </Card>

      <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3">
        <div className="space-y-2">
          <span className="text-[12px] leading-5 text-fg font-medium">
            Stroke
          </span>
          <ColorField
            label="Color"
            value={style.stroke?.color || "#1d4ed8"}
            onChange={(color) =>
              handleStyleChange({
                stroke: {
                  ...style.stroke,
                  color,
                  width: style.stroke?.width ?? 2,
                  opacity: style.stroke?.opacity ?? 1,
                },
              })
            }
          />
          <NumberInput
            label="Width"
            value={style.stroke?.width ?? 0}
            onChange={(width) =>
              handleStyleChange({
                stroke: {
                  ...style.stroke,
                  width,
                  color: style.stroke?.color || "#1d4ed8",
                  opacity: style.stroke?.opacity ?? 1,
                },
              })
            }
            min={0}
            max={50}
            unit="px"
          />
          <StrokeStyleSelector
            value={style.stroke?.dashArray}
            onChange={(dashArray) =>
              handleStyleChange({
                stroke: {
                  ...style.stroke,
                  dashArray,
                  color: style.stroke?.color || "#1d4ed8",
                  width: style.stroke?.width ?? 2,
                  opacity: style.stroke?.opacity ?? 1,
                },
              })
            }
          />
        </div>
      </Card>

      {shapeType === "rectangle" && (
        <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3">
          <div className="space-y-2">
            <span className="text-[12px] leading-5 text-fg font-medium">
              Corners
            </span>
            <SliderField
              label="Radius"
              value={style.cornerRadius || 0}
              onChange={(cornerRadius) => handleStyleChange({ cornerRadius })}
              min={0}
              max={100}
              unit="px"
            />
          </div>
        </Card>
      )}

      <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3">
        <div className="space-y-2">
          <span className="text-[12px] leading-5 text-fg font-medium">
            Shadow
          </span>
          <ColorField
            label="Color"
            value={style.shadow?.color || "#000000"}
            onChange={(color) =>
              handleStyleChange({
                shadow: {
                  color,
                  offsetX: style.shadow?.offsetX || 0,
                  offsetY: style.shadow?.offsetY || 0,
                  blur: style.shadow?.blur || 0,
                },
              })
            }
            showAlpha
          />
          <NumberInput
            label="Offset X"
            value={style.shadow?.offsetX || 0}
            onChange={(offsetX) =>
              handleStyleChange({
                shadow: {
                  offsetX,
                  color: style.shadow?.color || "#000000",
                  offsetY: style.shadow?.offsetY || 0,
                  blur: style.shadow?.blur || 0,
                },
              })
            }
            min={-50}
            max={50}
            unit="px"
          />
          <NumberInput
            label="Offset Y"
            value={style.shadow?.offsetY || 0}
            onChange={(offsetY) =>
              handleStyleChange({
                shadow: {
                  offsetY,
                  color: style.shadow?.color || "#000000",
                  offsetX: style.shadow?.offsetX || 0,
                  blur: style.shadow?.blur || 0,
                },
              })
            }
            min={-50}
            max={50}
            unit="px"
          />
          <SliderField
            label="Blur"
            value={style.shadow?.blur || 0}
            onChange={(blur) =>
              handleStyleChange({
                shadow: {
                  blur,
                  color: style.shadow?.color || "#000000",
                  offsetX: style.shadow?.offsetX || 0,
                  offsetY: style.shadow?.offsetY || 0,
                },
              })
            }
            min={0}
            max={50}
            unit="px"
          />
        </div>
      </Card>
    </fieldset>
  );
};

const ShapeShaderFillControls: React.FC<{
  historyKey: string;
  shader: MotionShaderFill;
  onChange: (shader: MotionShaderFill) => void;
}> = ({ historyKey, shader, onChange }) => {
  const shaderOptions = useMemo(
    () => groupShaderDefsByCollection(getMotionShaderFillDefs()),
    [],
  );
  const def = getMotionShaderDef(shader.shaderId);

  const handleShaderSelect = useCallback(
    (shaderId: string) => {
      const next = createDefaultEditorShader(shaderId);
      if (!next) return;
      const nextDef = getMotionShaderDef(shaderId);
      if (!nextDef || nextDef.category !== "fill") return;
      onChange(next);
    },
    [onChange],
  );

  const updateParam = useCallback(
    (name: string, value: MotionShaderParamValue) => {
      onChange({
        ...shader,
        params: {
          ...shader.params,
          [name]: value,
        },
      });
    },
    [onChange, shader],
  );

  return (
    <div className="space-y-2 rounded border border-border/70 bg-bg-2 p-2">
      <Select value={shader.shaderId} onValueChange={handleShaderSelect}>
        <SelectTrigger aria-label="Shader Fill" className="h-[30px] min-w-0 text-xs"><SelectValue>{def?.name ?? shader.shaderId}</SelectValue></SelectTrigger>
        <SelectContent>{shaderOptions.map(group => <SelectGroup key={group.title}>
          <SelectLabel>{group.title}</SelectLabel>
          {group.options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectGroup>)}</SelectContent>
      </Select>
      {def ? (
        <ShaderParamFields
          historyKey={historyKey}
          def={def}
          params={shader.params}
          onChange={updateParam}
        />
      ) : null}
    </div>
  );
};
