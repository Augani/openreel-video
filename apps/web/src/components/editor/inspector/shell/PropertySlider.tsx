import React from "react";
import { ToolcraftSliderControl } from "@openreel/ui";

export interface PropertySliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  formatValue: (value: number) => string;
  isDisabled?: boolean;
  description?: string;
  className?: string;
}

export const PropertySlider: React.FC<PropertySliderProps> = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  formatValue,
  isDisabled = false,
  description,
  className,
}) => (
  <div className={className}>
    <ToolcraftSliderControl
      label={label}
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      step={step}
      disabled={isDisabled}
      formatValue={formatValue}
    />
    {description ? (
      <p className="mt-1 text-[11px] text-fg-muted">{description}</p>
    ) : null}
  </div>
);
