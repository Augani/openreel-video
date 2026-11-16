import { PropertySlider } from "../inspector/shell/PropertySlider";
import {
  Select as ShadcnSelect,
  SelectTrigger as ShadcnSelectTrigger,
  SelectContent as ShadcnSelectContent,
  SelectValue as ShadcnSelectValue,
  SelectItem as ShadcnSelectItem,
  Switch as ShadcnSwitch,
  Input as ShadcnInput,
  cn as uiCn,
} from "@openreel/ui";

import React from "react";





import type { EditingTemplate, EditingTemplatePrimitive } from "@openreel/core";

export const getEditingTemplateDefaultControlValues = (
  template: EditingTemplate,
): Record<string, EditingTemplatePrimitive> =>
  (template.controls || []).reduce<Record<string, EditingTemplatePrimitive>>(
    (values, control) => {
      values[control.id] = control.defaultValue;
      return values;
    },
    {},
  );

export const mergeEditingTemplateControlValues = (
  template: EditingTemplate,
  overrides: Readonly<Record<string, unknown>> | undefined,
): Record<string, EditingTemplatePrimitive> => {
  const values = getEditingTemplateDefaultControlValues(template);

  for (const control of template.controls || []) {
    const override = overrides?.[control.id];
    if (
      typeof override === "string" ||
      typeof override === "number" ||
      typeof override === "boolean"
    ) {
      values[control.id] = override;
    }
  }

  return values;
};

interface EditingTemplateControlsProps {
  template: EditingTemplate;
  values: Record<string, EditingTemplatePrimitive>;
  onChange: (controlId: string, value: EditingTemplatePrimitive) => void;
  disabled?: boolean;
  className?: string;
}

export const EditingTemplateControls: React.FC<EditingTemplateControlsProps> = ({
  template,
  values,
  onChange,
  disabled = false,
  className,
}) => {
  if (!template.controls || template.controls.length === 0) {
    return null;
  }

  return (
    <div className={className || "space-y-3"}>
      {template.controls.map((control) => {
        const value = values[control.id] ?? control.defaultValue;

        if (control.type === "number") {
          return (
            <div key={control.id} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-fg-2 font-bold block text-[11px]">
                  {control.label}
                </span>
                <span className="rounded-full bg-background-tertiary px-2 py-0.5 text-[10px] text-text-secondary">
                  {value}
                </span>
              </div>
              <PropertySlider ariaLabel={control.label}
value={Number(value)}
min={control.min ?? 0}
max={control.max ?? 100}
step={control.step ?? 1}
onChange={(nextValue: number) => onChange(control.id, nextValue)}
isDisabled={disabled}
showValueLabel={false}
className="w-full disabled:cursor-not-allowed disabled:opacity-60" />
            </div>
          );
        }

        if (control.type === "toggle") {
          return (
            <div key={control.id} className="flex items-center justify-between gap-3">
              <span className="text-fg-2 font-bold block text-[11px]">
                {control.label}
              </span>
              <ShadcnSwitch
                aria-label={control.label}
                checked={Boolean(value)}
                disabled={disabled}
                onCheckedChange={(nextValue) => onChange(control.id, nextValue)}
                className="workspace-switch flex-none"
              />
            </div>
          );
        }

        if (control.type === "select") {
          const options = control.options || [];
          const selectedIndex = Math.max(
            0,
            options.findIndex((option) => option.value === value),
          );

          return (
            <div key={control.id} className="space-y-2">
              <span className="text-fg-2 font-bold block text-[11px]">
                {control.label}
              </span>
              <ShadcnSelect
                value={`${selectedIndex}` || "__openreel_empty_option__"}
                disabled={disabled}
                onValueChange={(selection) => {
                  const nextValue =
                    selection === "__openreel_empty_option__" ? "" : selection;
                  const option = options[Number(nextValue)];
                  if (option) {
                    onChange(control.id, option.value);
                  }
                }}
              >
                <ShadcnSelectTrigger
                  aria-label={control.label}
                  className={uiCn(
                    "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-50",
                    "h-10 w-full rounded-xl border border-border bg-background-tertiary px-3 text-xs text-text-primary focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60",
                    undefined,
                  )}
                >
                  <ShadcnSelectValue placeholder={undefined} />
                </ShadcnSelectTrigger>
                <ShadcnSelectContent>
                  {options
                    .map((option, index) => ({
                      value: `${index}`,
                      label: option.label,
                    }))
                    .map((option) => (
                      <ShadcnSelectItem
                        key={option.value}
                        value={option.value || "__openreel_empty_option__"}
                        disabled={"disabled" in option && option.disabled === true}
                      >
                        {option.label}
                      </ShadcnSelectItem>
                    ))}
                </ShadcnSelectContent>
              </ShadcnSelect>
            </div>
          );
        }

        if (control.type === "color") {
          return (
            <div key={control.id} className="space-y-2">
              <span className="text-fg-2 font-bold block text-[11px]">
                {control.label}
              </span>
              <div className="flex items-center gap-3">
                <span
                  className="h-10 w-12 rounded-lg border border-border"
                  style={{ backgroundColor: String(value) }}
                  aria-hidden
                />
                <ShadcnInput
                  value={String(value)}
                  aria-label={control.label}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value;
                    return onChange(control.id, nextValue);
                  }}
                  disabled={disabled}
                  className={uiCn(
                    "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors placeholder:text-fg-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 md:text-[13px]",
                    "h-10 flex-1 rounded-xl border border-border bg-background-tertiary px-3 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 md:text-xs",
                  )}
                />
              </div>
            </div>
          );
        }

        return (
          <div key={control.id} className="space-y-2">
            <span className="text-fg-2 font-bold block text-[11px]">
              {control.label}
            </span>
            <ShadcnInput
              value={String(value)}
              aria-label={control.label}
              onChange={(event) => {
                const nextValue = event.currentTarget.value;
                return onChange(control.id, nextValue);
              }}
              disabled={disabled}
              className={uiCn(
                "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors placeholder:text-fg-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 md:text-[13px]",
                "h-10 w-full rounded-xl border border-border bg-background-tertiary px-3 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 md:text-xs",
              )}
            />
          </div>
        );
      })}
    </div>
  );
};
