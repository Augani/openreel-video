import React from "react";
import { ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftSliderControl } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import type { EditingTemplate, EditingTemplatePrimitive } from "@openreel/core";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
                <Text type="label" weight="bold" display="block" className="text-[11px]">
                  {t(control.label)}
                </Text>
                <span className="rounded-full bg-background-tertiary px-2 py-0.5 text-[10px] text-text-secondary">
                  {value}
                </span>
              </div>
              <ToolcraftSliderControl
                label={t(control.label)}
                isLabelHidden
                min={control.min ?? 0}
                max={control.max ?? 100}
                step={control.step ?? 1}
                value={Number(value)}
                isDisabled={disabled}
                onChange={(nextValue: number) => onChange(control.id, nextValue)}
                valueDisplay="none"
                className="w-full disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          );
        }

        if (control.type === "toggle") {
          return (
            <div key={control.id} className="flex items-center justify-between gap-3">
              <Text type="label" weight="bold" display="block" className="text-[11px]">
                {t(control.label)}
              </Text>
              <ToolcraftSwitchControl
                ariaLabel={t(control.label)}
                checked={Boolean(value)}
                disabled={disabled}
                onCheckedChange={(nextValue) => onChange(control.id, nextValue)}
                showLabel={false}
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
              <Text type="label" weight="bold" display="block" className="text-[11px]">
                {t(control.label)}
              </Text>
              <Selector
                label={t(control.label)}
                isLabelHidden
                width="100%"
                value={`${selectedIndex}`}
                isDisabled={disabled}
                options={options.map((option, index) => ({
                  value: `${index}`,
                  label: t(option.label),
                }))}
                onChange={(nextValue) => {
                  const option = options[Number(nextValue)];
                  if (option) {
                    onChange(control.id, option.value);
                  }
                }}
                className="h-10 w-full rounded-xl border border-border bg-background-tertiary px-3 text-xs text-text-primary focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          );
        }

        if (control.type === "color") {
          return (
            <div key={control.id} className="space-y-2">
              <Text type="label" weight="bold" display="block" className="text-[11px]">
                {t(control.label)}
              </Text>
              <div className="flex items-center gap-3">
                <span
                  className="h-10 w-12 rounded-lg border border-border"
                  style={{ backgroundColor: String(value) }}
                  aria-hidden
                />
                <ToolcraftTextInputControl
                  label={t(control.label)}
                  isLabelHidden
                  value={String(value)}
                  isDisabled={disabled}
                  onChange={(nextValue) => onChange(control.id, nextValue)}
                  className="h-10 flex-1 rounded-xl border border-border bg-background-tertiary px-3 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>
          );
        }

        return (
          <div key={control.id} className="space-y-2">
            <Text type="label" weight="bold" display="block" className="text-[11px]">
              {t(control.label)}
            </Text>
            <ToolcraftTextInputControl
              label={t(control.label)}
              isLabelHidden
              value={String(value)}
              isDisabled={disabled}
              onChange={(nextValue) => onChange(control.id, nextValue)}
              className="h-10 w-full rounded-xl border border-border bg-background-tertiary px-3 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        );
      })}
    </div>
  );
};
