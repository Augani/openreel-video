import React from "react";
import {
  ToolcraftNumberFieldGroup,
  ToolcraftSliderControl,
  ToolcraftSwitchControl,
} from "@openreel/ui";

export interface NumberFieldEntry {
  axis: string;
  value: string;
  onChange: (next: string) => void;
}

export interface NumberFieldProps {
  label: string;
  fields: NumberFieldEntry[];
  className?: string;
}

export const NumberField: React.FC<NumberFieldProps> = ({
  label,
  fields,
  className,
}) => (
  <ToolcraftNumberFieldGroup
    label={label}
    fields={fields}
    className={className}
  />
);

export interface MockSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  formatValue?: (value: number) => string;
  showValueBox?: boolean;
  isDisabled?: boolean;
  className?: string;
}

export const MockSlider: React.FC<MockSliderProps> = ({
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue,
  showValueBox = false,
  isDisabled = false,
  className,
}) => (
  <ToolcraftSliderControl
    value={value}
    onChange={onChange}
    min={min}
    max={max}
    step={step}
    disabled={isDisabled}
    showValueLabel={showValueBox}
    formatValue={formatValue}
    className={className}
  />
);

export interface MockToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
  isDisabled?: boolean;
}

export const MockToggle: React.FC<MockToggleProps> = ({
  checked,
  onChange,
  ariaLabel,
  isDisabled = false,
}) => (
  <ToolcraftSwitchControl
    checked={checked}
    onCheckedChange={onChange}
    ariaLabel={ariaLabel}
    disabled={isDisabled}
    showLabel={false}
  />
);
