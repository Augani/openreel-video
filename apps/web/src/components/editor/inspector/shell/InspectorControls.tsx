import React from "react";
import { Input, Label, Switch, cn } from "@openreel/ui";
import { useProjectStore } from "../../../../stores/project-store";
import { useInspectorSelection } from "./InspectorSelection";
import { PropertySlider } from "./PropertySlider";
import { useNumericDraft } from "./useNumericDraft";

interface NumberFieldEntry {
  axis: string;
  value: string;
  numericValue?: number;
  onChange: (next: string) => void;
}

interface NumberFieldProps {
  label: string;
  fields: NumberFieldEntry[];
  className?: string;
}

function NumberAxisInput({ label, field }: { label: string; field: NumberFieldEntry }) {
  const input = useNumericDraft({
    value: field.numericValue ?? Number.parseFloat(field.value),
    displayValue: field.value,
    onChange: next => field.onChange(String(next)),
  });
  return <Label className="flex min-w-0 items-center gap-1.5 rounded-[7px] border border-border bg-bg-1 px-2 py-1.5 text-[12px] font-normal leading-[1.4] transition-colors focus-within:border-accent">
    <span className="shrink-0 text-[11px] font-semibold uppercase text-fg-muted">{field.axis}</span>
    <Input {...input} aria-label={`${label} ${field.axis}`} inputMode="decimal" type="text"
      className="h-5 w-full min-w-0 border-0 rounded-none p-0 bg-transparent text-[12px] font-medium text-fg-2 outline-none"
    />
  </Label>;
}

export const NumberField: React.FC<NumberFieldProps> = ({ label, fields, className }) => {
  const projectId = useProjectStore(state => state.project.id);
  const selectedItems = useInspectorSelection();
  const scope = `${projectId}:${selectedItems.map(item => `${item.type}:${item.id}`).join("|")}:${label}`;
  return <div className={cn("workspace-inspector-number-group flex min-w-0 items-center gap-3", className)}>
    <span className="w-[90px] flex-none truncate text-[12px] font-medium text-fg-3">{label}</span>
    <div className="grid min-w-0 flex-1 gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(fields.length, 1)}, minmax(0, 1fr))` }}>
      {fields.map(field => <NumberAxisInput key={`${scope}:${field.axis}`} label={label} field={field}/>)}
    </div>
  </div>;
};

interface InlineSliderProps {
  ariaLabel: string;
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

export const InlineSlider: React.FC<InlineSliderProps> = ({ showValueBox = false, ...props }) =>
  <PropertySlider {...props} showValueLabel={showValueBox}/>;

interface InspectorToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
  isDisabled?: boolean;
}

export const InspectorToggle: React.FC<InspectorToggleProps> = ({ checked, onChange, ariaLabel = "Toggle", isDisabled = false }) =>
  <div className="flex min-w-0 items-center justify-between gap-3 py-1">
    <Switch checked={checked} onCheckedChange={onChange} aria-label={ariaLabel} disabled={isDisabled} className="workspace-switch flex-none"/>
  </div>;
