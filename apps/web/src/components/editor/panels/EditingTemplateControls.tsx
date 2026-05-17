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
                <label className="text-[11px] font-medium text-text-primary">
                  {control.label}
                </label>
                <span className="rounded-full bg-background-tertiary px-2 py-0.5 text-[10px] text-text-secondary">
                  {value}
                </span>
              </div>
              <input
                type="range"
                min={control.min ?? 0}
                max={control.max ?? 100}
                step={control.step ?? 1}
                value={Number(value)}
                disabled={disabled}
                onChange={(event) => onChange(control.id, Number(event.target.value))}
                className="w-full accent-[var(--color-primary,#22c55e)] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          );
        }

        if (control.type === "toggle") {
          return (
            <div key={control.id} className="flex items-center justify-between gap-3">
              <label className="text-[11px] font-medium text-text-primary">
                {control.label}
              </label>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(control.id, !Boolean(value))}
                className={`inline-flex h-7 w-12 items-center rounded-full px-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  Boolean(value)
                    ? "justify-end bg-primary"
                    : "justify-start bg-background-tertiary"
                }`}
              >
                <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
              </button>
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
              <label className="text-[11px] font-medium text-text-primary">
                {control.label}
              </label>
              <select
                value={`${selectedIndex}`}
                disabled={disabled}
                onChange={(event) => {
                  const option = options[Number(event.target.value)];
                  if (option) {
                    onChange(control.id, option.value);
                  }
                }}
                className="h-10 w-full rounded-xl border border-border bg-background-tertiary px-3 text-xs text-text-primary focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {options.map((option, index) => (
                  <option key={option.label} value={`${index}`}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (control.type === "color") {
          return (
            <div key={control.id} className="space-y-2">
              <label className="text-[11px] font-medium text-text-primary">
                {control.label}
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={String(value)}
                  disabled={disabled}
                  onChange={(event) => onChange(control.id, event.target.value)}
                  className="h-10 w-12 rounded-lg border border-border bg-transparent disabled:cursor-not-allowed disabled:opacity-60"
                />
                <input
                  type="text"
                  value={String(value)}
                  disabled={disabled}
                  onChange={(event) => onChange(control.id, event.target.value)}
                  className="h-10 flex-1 rounded-xl border border-border bg-background-tertiary px-3 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>
          );
        }

        return (
          <div key={control.id} className="space-y-2">
            <label className="text-[11px] font-medium text-text-primary">
              {control.label}
            </label>
            <input
              type="text"
              value={String(value)}
              disabled={disabled}
              onChange={(event) => onChange(control.id, event.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-background-tertiary px-3 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        );
      })}
    </div>
  );
};