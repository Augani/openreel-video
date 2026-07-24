import React from "react";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import {
  defaultMotionShaderParams,
  getMotionShaderDef,
  type MotionShaderDef,
  type MotionShaderParamDef,
  type MotionShaderParamValue,
} from "@openreel/core";
import { PropertySlider } from "./shell/PropertySlider";
import { ColorSelector } from "../../../motion/components/primitives";

export interface EditorShaderRef {
  readonly shaderId: string;
  readonly params: Record<string, MotionShaderParamValue>;
}

export function createDefaultEditorShader(
  shaderId: string,
): EditorShaderRef | null {
  const def = getMotionShaderDef(shaderId);
  if (!def) return null;
  return {
    shaderId,
    params: defaultMotionShaderParams(def),
  };
}

export function groupShaderDefsByCollection(
  defs: readonly MotionShaderDef[],
  leading: Array<{ value: string; label: string }> = [],
): Array<{
  type: "section";
  title: string;
  options: Array<{ value: string; label: string }>;
}> {
  const order: string[] = [];
  const buckets = new Map<string, Array<{ value: string; label: string }>>();

  for (const def of defs) {
    const title = def.collection ?? "Built-in";
    const bucket = buckets.get(title);
    const option = {
      value: def.id,
      label: def.origin === "generated" ? `${def.name} (AI)` : def.name,
    };
    if (bucket) {
      bucket.push(option);
    } else {
      order.push(title);
      buckets.set(title, [option]);
    }
  }

  const sections = order.map((title) => ({
    type: "section" as const,
    title,
    options: buckets.get(title) ?? [],
  }));

  if (leading.length === 0) return sections;
  return [
    {
      type: "section" as const,
      title: "General",
      options: leading,
    },
    ...sections,
  ];
}

function shaderParamUsesSlider(param: MotionShaderParamDef): boolean {
  if (param.control) return param.control === "slider";
  return param.min === 0 && param.max === 1;
}

function shaderNumberValue(
  value: MotionShaderParamValue | undefined,
  fallback: number | string,
): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  return 0;
}

function shaderColorValue(
  value: MotionShaderParamValue | undefined,
  fallback: number | string,
): string {
  if (typeof value === "string") return value;
  if (typeof fallback === "string") return fallback;
  return "#ffffff";
}

const ShaderColorField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between gap-2">
    <Text type="supporting" color="secondary">
      {label}
    </Text>
    <div className="flex max-w-[190px] items-center">
      <ColorSelector
        value={value}
        onChange={onChange}
        label={`Select ${label.toLowerCase()}`}
      />
    </div>
  </div>
);

const ShaderNumberField: React.FC<{
  param: MotionShaderParamDef;
  value: number;
  onChange: (value: number) => void;
}> = ({ param, value, onChange }) =>
  shaderParamUsesSlider(param) ? (
    <PropertySlider
      label={param.label}
      value={value}
      onChange={onChange}
      min={param.min}
      max={param.max}
      step={param.step}
      formatValue={(nextValue) =>
        param.step < 1
          ? String(Number(nextValue.toFixed(2)))
          : String(Math.round(nextValue))
      }
    />
  ) : (
    <ToolcraftNumberInputControl
      label={param.label}
      size="sm"
      width="100%"
      value={value}
      onChange={onChange}
      min={param.min}
      max={param.max}
      step={param.step}
    />
  );

export const ShaderParamFields: React.FC<{
  def: MotionShaderDef;
  params: Record<string, MotionShaderParamValue>;
  onChange: (name: string, value: MotionShaderParamValue) => void;
}> = ({ def, params, onChange }) => (
  <>
    {def.params.map((param) =>
      param.type === "color" ? (
        <ShaderColorField
          key={param.name}
          label={param.label}
          value={shaderColorValue(params[param.name], param.default)}
          onChange={(value) => onChange(param.name, value)}
        />
      ) : (
        <ShaderNumberField
          key={param.name}
          param={param}
          value={shaderNumberValue(params[param.name], param.default)}
          onChange={(value) => onChange(param.name, value)}
        />
      ),
    )}
  </>
);
